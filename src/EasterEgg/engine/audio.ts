/**
 * Audio system — real Red Alert .AUD samples + synthesized fallback.
 *
 * SFX priority:
 *   1. Pre-extracted WAV files from public/ra/audio/ (decoded from original .AUD)
 *   2. Synthesized sounds via Web Audio oscillators/noise (fallback)
 *
 * The extraction pipeline (scripts/extract-ra-audio.ts) decodes Westwood IMA
 * ADPCM from SOUNDS.MIX, SPEECH.MIX, and Aftermath expansion files into
 * browser-compatible 16-bit PCM WAV files.
 *
 * Music: Streams original Red Alert soundtrack MP3s from public/ra/music/.
 */

import { NonCriticalRandom } from './random';

/** Track list for the Red Alert soundtrack (Frank Klepacki, 1996) */
const MUSIC_TRACKS = [
  '01_hell_march',
  '02_radio',
  '03_crush',
  '04_roll_out',
  '05_mud',
  '06_twin_cannon',
  '07_face_the_enemy',
  '08_run',
  '09_terminate',
  '10_big_foot',
  '11_workmen',
  '12_militant_force',
  '13_dense',
  '14_vector',
  '15_smash',
  '16_score',  // C++ THEME_SCORE — score screen music (theme.cpp:84)
];

/**
 * C++ parity: House ownership bitmask per track (theme.cpp:63-106).
 * HOUSEF_ALLIES = 1, HOUSEF_SOVIET = 2, HOUSEF_ALLIES|HOUSEF_SOVIET = 3
 * C++ Is_Allowed() (theme.cpp:500): filters by (1 << ActLike) & Owner.
 * Allied player gets all tracks with bit 0 set (~15 tracks).
 * Soviet player gets all tracks with bit 1 set (~4 tracks).
 */
const HOUSEF_ALLIES = 1;
const HOUSEF_SOVIET = 2;

/** Per-track metadata matching C++ ThemeControl table (theme.cpp:63-106) */
const TRACK_META: { owner: number; normal: boolean; repeat: boolean }[] = [
  /* 00 hell_march      BIGF226M  */ { owner: HOUSEF_ALLIES, normal: true, repeat: false },
  /* 01 radio           RADIO2    */ { owner: HOUSEF_ALLIES, normal: true, repeat: false },
  /* 02 crush           CRUS226M  */ { owner: HOUSEF_SOVIET, normal: true, repeat: false },
  /* 03 roll_out        ROLLOUT   */ { owner: HOUSEF_ALLIES, normal: true, repeat: false },
  /* 04 mud             MUD1A     */ { owner: HOUSEF_ALLIES, normal: true, repeat: false },
  /* 05 twin_cannon     TWIN      */ { owner: HOUSEF_ALLIES, normal: true, repeat: false },
  /* 06 face_the_enemy  FAC1226M  */ { owner: HOUSEF_ALLIES, normal: true, repeat: false },
  /* 07 run             RUN1226M  */ { owner: HOUSEF_SOVIET, normal: true, repeat: false },
  /* 08 terminate       TERMINAT  */ { owner: HOUSEF_ALLIES, normal: true, repeat: false },
  /* 09 big_foot        BIGF226M  */ { owner: HOUSEF_ALLIES, normal: true, repeat: false },
  /* 10 workmen         WORK226M  */ { owner: HOUSEF_ALLIES, normal: true, repeat: false },
  /* 11 militant_force  FAC2226M  */ { owner: HOUSEF_SOVIET, normal: true, repeat: false },
  /* 12 dense           DENSE_R   */ { owner: HOUSEF_ALLIES, normal: true, repeat: false },
  /* 13 vector          VECTOR1A  */ { owner: HOUSEF_ALLIES, normal: true, repeat: false },
  /* 14 smash           SMSH226M  */ { owner: HOUSEF_ALLIES, normal: true, repeat: false },
  /* 15 score           SCORE     */ { owner: HOUSEF_ALLIES | HOUSEF_SOVIET, normal: false, repeat: true },
];

/** Player faction type for house-based track filtering */
export type MusicFaction = 'allied' | 'soviet';

/**
 * Get the set of track indices allowed for a given house.
 * C++ parity: Is_Allowed() (theme.cpp:481-512) filters by Normal flag AND house ownership.
 */
function getAllowedTracks(faction: MusicFaction): number[] {
  const houseBit = faction === 'allied' ? HOUSEF_ALLIES : HOUSEF_SOVIET;
  const allowed: number[] = [];
  for (let i = 0; i < TRACK_META.length; i++) {
    const meta = TRACK_META[i];
    if (!meta.normal) continue; // C++ theme.cpp:493: if (!_themes[index].Normal) return(false)
    if ((meta.owner & houseBit) === 0) continue; // C++ theme.cpp:500: house ownership filter
    allowed.push(i);
  }
  return allowed;
}

/**
 * Music player — streams MP3 soundtrack files via HTML5 Audio.
 * C++ parity: house-based track filtering, no-repeat shuffle, sequential mode.
 * Features: shuffled/sequential playlist, crossfade, volume/mute sync, pause/resume.
 */
export class MusicPlayer {
  private basePath: string;
  private playlist: number[] = [];
  private playlistIndex = 0;
  private current: HTMLAudioElement | null = null;
  private fading: HTMLAudioElement | null = null; // outgoing track during crossfade
  private volume = 0.4;
  private muted = true; // Sound off by default — human-requested
  private playing = false;
  private available = false; // true once we confirm at least one track loads
  private pendingPlay = false; // play() called before probe completed
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private pendingTrack = -1; // C++ parity: queue saturation guard (theme.cpp:309-314)
  private trackName = ''; // current track display name
  private combatMode = false;
  private combatCooldown = 0; // ticks since combat ended (for cooldown)
  private combatModeChangeTime = 0; // timestamp of last mode change
  private lastPlayedTrack = -1; // C++ parity: no-repeat guard (theme.cpp:248-251)
  private shuffleEnabled = true; // C++ Options.IsScoreShuffle (options.h:95)
  private scoreRepeat = false;   // C++ Options.IsScoreRepeat (options.h:94)
  private faction: MusicFaction = 'allied'; // C++ parity: house ownership filter

  constructor(basePath = '/ra/music') {
    this.basePath = basePath;
    this.buildPlaylist();
    // Probe first track to see if music files are present
    this.probe();
  }

  /** Check if music files exist (non-blocking) */
  private probe(): void {
    const audio = new Audio();
    const idx = this.playlist[0];
    audio.src = `${this.basePath}/${MUSIC_TRACKS[idx]}.mp3`;
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => {
      this.available = true;
      // If play() was called before probe completed, start now
      if (this.pendingPlay) {
        this.pendingPlay = false;
        this.play();
      }
      audio.src = ''; // release
    }, { once: true });
    audio.addEventListener('error', () => {
      this.available = false;
      this.pendingPlay = false;
    }, { once: true });
  }

  /** Whether music files are present */
  get isAvailable(): boolean { return this.available; }

  /** Current track human-readable name */
  get currentTrack(): string { return this.trackName; }

  /** Whether music is actively playing */
  get isPlaying(): boolean { return this.playing; }

  /**
   * Build the playlist from house-allowed tracks.
   * C++ parity: Is_Allowed() (theme.cpp:481-512) filters by Normal + house ownership.
   * Supports both shuffle (Fisher-Yates) and sequential (theme++, wrap) modes.
   */
  private buildPlaylist(): void {
    this.playlist = getAllowedTracks(this.faction);
    if (this.shuffleEnabled) {
      // C++ theme.cpp:244-252: shuffle mode — Fisher-Yates
      for (let i = this.playlist.length - 1; i > 0; i--) {
        const j = NonCriticalRandom.nextInRange(0, i);
        [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
      }
    }
    // Sequential mode: playlist is already in index order from getAllowedTracks
    this.playlistIndex = 0;
  }

  /** Set the player's faction for house-based track filtering (C++ theme.cpp:500) */
  setFaction(faction: MusicFaction): void {
    if (faction === this.faction) return;
    this.faction = faction;
    this.buildPlaylist();
  }

  /** Get current faction */
  getFaction(): MusicFaction { return this.faction; }

  /**
   * Set shuffle mode (C++ Options.IsScoreShuffle, options.h:95).
   * true = shuffle (random order), false = sequential (theme++, skip disallowed, wrap).
   */
  setShuffleMode(enabled: boolean): void {
    if (enabled === this.shuffleEnabled) return;
    this.shuffleEnabled = enabled;
    this.buildPlaylist();
  }

  /** Whether shuffle mode is enabled */
  get isShuffleMode(): boolean { return this.shuffleEnabled; }

  /** Start playing music */
  play(): void {
    if (this.playing) return;
    if (!this.available) {
      // Probe still in progress — defer until it completes
      this.pendingPlay = true;
      return;
    }
    this.playing = true;
    this.playTrack(this.playlist[this.playlistIndex]);
  }

  /** Play a specific track by index.
   *  C++ parity (theme.cpp:309-314): Queue_Song ignores requests when a different
   *  theme is already pending (not NONE or PICK_ANOTHER). This prevents rapid
   *  queue flooding from combat mode transitions or triggers. */
  private playTrack(trackIdx: number): void {
    // C++ queue saturation guard: if a track is already pending (crossfading in),
    // ignore subsequent requests to prevent flooding.
    if (this.pendingTrack >= 0 && this.pendingTrack !== trackIdx) {
      return;
    }

    const name = MUSIC_TRACKS[trackIdx];
    this.trackName = name.replace(/^\d+_/, '').replace(/_/g, ' ');
    this.lastPlayedTrack = trackIdx; // C++ parity: track last-played for no-repeat guard
    this.pendingTrack = trackIdx; // Mark as pending during crossfade

    const audio = new Audio(`${this.basePath}/${name}.mp3`);
    audio.volume = this.muted ? 0 : this.volume;
    audio.addEventListener('ended', () => { this.pendingTrack = -1; this.advance(); });
    audio.addEventListener('error', () => { this.pendingTrack = -1; this.advance(); }); // skip broken tracks

    // Start crossfade if currently playing
    if (this.current) {
      this.crossfadeOut(this.current);
    }

    this.current = audio;
    audio.play().catch(() => {
      // Autoplay blocked — will retry on next user interaction
      this.playing = false;
      this.pendingTrack = -1;
    });
  }

  /** Crossfade outgoing track */
  private crossfadeOut(audio: HTMLAudioElement): void {
    // Clean up any previous fade completely first
    if (this.fadeTimer) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
    if (this.fading) {
      this.fading.pause();
      this.fading.src = '';
      this.fading = null;
    }
    this.fading = audio;
    const startVol = audio.volume;
    const steps = 10;
    let step = 0;
    this.fadeTimer = setInterval(() => {
      step++;
      audio.volume = Math.max(0, startVol * (1 - step / steps));
      if (step >= steps) {
        clearInterval(this.fadeTimer!);
        this.fadeTimer = null;
        audio.pause();
        audio.src = '';
        if (this.fading === audio) this.fading = null;
      }
    }, 100); // C++ THEME_DELAY = TIMER_SECOND = 1 second (10 steps x 100ms)
  }

  /**
   * Advance to next track in playlist.
   * C++ parity (theme.cpp:238-267): supports both sequential and shuffle modes.
   * House-filtered pool replaces calm/action split (theme.cpp:481-512).
   * No-repeat guard: C++ do-while rejects newtheme == theme (theme.cpp:248-251).
   */
  private advance(): void {
    if (!this.playing) return;
    const pool = this.playlist;
    if (pool.length === 0) return;
    // Clear pending state — this is an internal track transition (current ended),
    // not an external queue request. The saturation guard only blocks external calls.
    this.pendingTrack = -1;

    // C++ theme.cpp:240: if per-track Repeat or global IsScoreRepeat, replay same track
    if (this.lastPlayedTrack >= 0) {
      const meta = TRACK_META[this.lastPlayedTrack];
      if (meta && (meta.repeat || this.scoreRepeat)) {
        this.playTrack(this.lastPlayedTrack);
        return;
      }
    }

    if (this.shuffleEnabled) {
      // C++ shuffle mode (theme.cpp:244-252): random pick, reject same song
      if (pool.length === 1) {
        // Only one track available — must play it
        this.playTrack(pool[0]);
        return;
      }
      let trackIdx: number;
      let attempts = 0;
      do {
        trackIdx = pool[NonCriticalRandom.nextInRange(0, pool.length - 1)];
        attempts++;
      } while (trackIdx === this.lastPlayedTrack && attempts < 20);
      this.playTrack(trackIdx);
    } else {
      // C++ sequential mode (theme.cpp:253-266): theme++, skip disallowed, wrap
      this.playlistIndex = (this.playlistIndex + 1) % pool.length;
      this.playTrack(pool[this.playlistIndex]);
    }
  }

  /** Skip to next track */
  next(): void {
    if (!this.available) return;
    this.playing = true;
    this.advance();
  }

  /** Play a specific track by name (for score screen, map screen, etc.)
   *  C++ Theme.Queue_Song(THEME_SCORE) — score.cpp:412 */
  playSpecific(trackName: string): void {
    const idx = MUSIC_TRACKS.findIndex(t => t.includes(trackName));
    if (idx >= 0 && this.available) {
      this.playing = true;
      this.playTrack(idx);
    }
  }

  /** Play a specific track by ID — callable from trigger actions.
   *  C++ taction.cpp:543-544: case TACTION_PLAY_MUSIC: Theme.Queue_Song(Data.Theme);
   *  Accepts a track ID string (partial match against MUSIC_TRACKS filenames).
   *  Returns true if the track was found and queued. */
  playTrackByName(trackId: string): boolean {
    if (!this.available) return false;
    const idx = MUSIC_TRACKS.findIndex(t => t.includes(trackId));
    if (idx < 0) return false;
    this.playing = true;
    this.pendingTrack = -1; // C++ Queue_Song overrides pending with explicit theme
    this.playTrack(idx);
    return true;
  }

  /** Pause music */
  pause(): void {
    if (this.current && this.playing) {
      this.current.pause();
    }
  }

  /** Resume music */
  resume(): void {
    if (this.current && this.playing) {
      this.current.play().catch(() => {});
    }
  }

  /** Stop music completely */
  stop(): void {
    this.playing = false;
    this.pendingPlay = false;
    this.pendingTrack = -1; // C++ parity: clear pending on stop (theme.cpp:419-427)
    if (this.fadeTimer) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
    if (this.current) {
      this.current.pause();
      this.current.src = '';
      this.current = null;
    }
    if (this.fading) {
      this.fading.pause();
      this.fading.src = '';
      this.fading = null;
    }
    this.trackName = '';
  }

  /** Set volume (0-1) */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    const vol = this.muted ? 0 : this.volume;
    if (this.current) this.current.volume = vol;
    if (this.fading) this.fading.volume = Math.min(this.fading.volume, vol);
  }

  /** Set muted state */
  setMuted(m: boolean): void {
    this.muted = m;
    const vol = m ? 0 : this.volume;
    if (this.current) this.current.volume = vol;
    if (this.fading) this.fading.volume = vol;
  }

  /** Get current volume */
  getVolume(): number { return this.volume; }

  /**
   * Switch between calm and action music based on combat state.
   * NOTE: The combat/calm mode split is a TS-only enhancement not present in C++.
   * C++ has no combatMode concept (theme.cpp). However, we keep this mechanism
   * as a gameplay enhancement while using house-filtered pools instead of
   * hardcoded calm/action track lists.
   */
  setCombatMode(inCombat: boolean): void {
    if (!this.available || !this.playing) return;
    const now = Date.now();

    if (inCombat && !this.combatMode) {
      // Enter combat — crossfade to a different track from the house pool
      if (now - this.combatModeChangeTime < 5000) return; // debounce
      this.combatMode = true;
      this.combatModeChangeTime = now;
      this.combatCooldown = 0;
      // Pick a random allowed track (with no-repeat guard)
      const pool = this.playlist;
      if (pool.length > 0) {
        let trackIdx: number;
        let attempts = 0;
        do {
          trackIdx = pool[NonCriticalRandom.nextInRange(0, pool.length - 1)];
          attempts++;
        } while (trackIdx === this.lastPlayedTrack && pool.length > 1 && attempts < 20);
        this.playTrack(trackIdx);
      }
    } else if (!inCombat && this.combatMode) {
      // Leave combat with cooldown (called once per tick)
      this.combatCooldown++;
      if (this.combatCooldown >= 450) { // 450 ticks = 30s at 15fps
        this.combatMode = false;
        this.combatModeChangeTime = now;
        // Pick a random allowed track (with no-repeat guard)
        const pool = this.playlist;
        if (pool.length > 0) {
          let trackIdx: number;
          let attempts = 0;
          do {
            trackIdx = pool[NonCriticalRandom.nextInRange(0, pool.length - 1)];
            attempts++;
          } while (trackIdx === this.lastPlayedTrack && pool.length > 1 && attempts < 20);
          this.playTrack(trackIdx);
        }
      }
    } else if (!inCombat) {
      this.combatCooldown = 0; // reset cooldown when not in combat mode
    }
  }

  /** Whether combat mode is active */
  get isCombatMode(): boolean { return this.combatMode; }

  /** Whether a track is currently pending (queue saturation guard). */
  get hasPendingTrack(): boolean { return this.pendingTrack >= 0; }

  /**
   * Tick-based music restart safety net.
   * C++ conquer.cpp:2357-2358: every frame, if no theme is playing, force-start one:
   *   if (SampleType && Theme.What_Is_Playing() == THEME_NONE) {
   *     Theme.Queue_Song(THEME_PICK_ANOTHER);
   *   }
   * TS relies on HTMLAudioElement 'ended' events which can be unreliable.
   * Call this once per game tick to restart music if it stopped unexpectedly.
   */
  tickMusicCheck(): void {
    if (!this.available || !this.playing) return;
    // If current audio element exists, is not paused, and has not ended, all good
    if (this.current) {
      const audio = this.current;
      if (!audio.paused || !audio.ended) return;
    }
    // No active audio but we should be playing — restart
    // C++ equivalent: Theme.Queue_Song(THEME_PICK_ANOTHER) → Next_Song → play
    this.pendingTrack = -1; // clear pending so advance can proceed
    this.advance();
  }

  /** Clean up */
  destroy(): void {
    this.stop();
  }
}

export type SoundName =
  | 'rifle' | 'machinegun' | 'cannon' | 'artillery'
  | 'mandible' | 'teslazap' | 'fireball' | 'flamethrower'
  | 'grenade' | 'bazooka' | 'dogjaw'
  | 'explode_sm' | 'explode_lg'
  | 'die_infantry' | 'die_vehicle' | 'die_ant'
  | 'move_ack' | 'attack_ack' | 'select'
  | 'select_infantry' | 'select_vehicle' | 'select_dog'
  | 'move_ack_infantry' | 'move_ack_vehicle' | 'move_ack_dog'
  | 'unit_lost' | 'building_explode' | 'heal'
  | 'eva_unit_lost' | 'eva_base_attack' | 'eva_acknowledged'
  | 'eva_construction_complete' | 'eva_unit_ready' | 'eva_low_power'
  | 'eva_new_options' | 'eva_building' | 'repair' | 'sell'
  | 'victory_fanfare' | 'defeat_sting' | 'crate_pickup' | 'eva_mission_accomplished'
  | 'eva_reinforcements' | 'eva_mission_warning' | 'tesla_charge'
  | 'sniper' | 'building_placed' | 'mammoth_cannon'
  | 'eva_building_captured' | 'eva_insufficient_funds' | 'eva_silos_needed'
  | 'chrono' | 'iron_curtain' | 'nuke_launch' | 'nuke_explode'
  | 'score_beep' | 'score_swoosh';

/** Base path for extracted audio WAV files */
const AUDIO_BASE_URL = '/ra/audio';

/**
 * Sound names that have extracted WAV files available.
 * This list matches the output of scripts/extract-ra-audio.ts.
 * If a WAV file doesn't exist, the synthesized fallback is used.
 */
const SAMPLE_SOUND_NAMES: SoundName[] = [
  // Weapons
  'rifle', 'machinegun', 'cannon', 'artillery', 'teslazap',
  'grenade', 'bazooka', 'mandible', 'fireball', 'flamethrower', 'dogjaw', 'sniper',
  // Explosions / deaths
  'explode_sm', 'explode_lg', 'building_explode', 'die_ant',
  // Unit acknowledgments
  'move_ack', 'attack_ack', 'select',
  'move_ack_infantry', 'move_ack_vehicle', 'move_ack_dog',
  'select_infantry', 'select_vehicle', 'select_dog',
  // UI / building
  'heal', 'sell', 'repair', 'crate_pickup', 'tesla_charge', 'building_placed',
  // Heavy weapons
  'mammoth_cannon',
  // EVA voice lines
  'eva_acknowledged', 'eva_unit_lost', 'eva_base_attack',
  'eva_construction_complete', 'eva_unit_ready', 'eva_low_power',
  'eva_new_options', 'eva_building', 'eva_mission_accomplished',
  'eva_reinforcements', 'eva_mission_warning',
  'eva_building_captured', 'eva_insufficient_funds', 'eva_silos_needed',
  // Victory / defeat
  'victory_fanfare', 'defeat_sting',
];

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private volume = 0.35;
  private muted = true; // Sound off by default — human-requested
  private lastPlayed = new Map<string, number>();
  private readonly MIN_INTERVAL = 40; // ms between same sound
  // Sampled audio system — loaded from extracted WAV files
  private sampleBuffers = new Map<string, AudioBuffer>();
  private samplesLoaded = false;
  private samplesLoading = false;
  // Ambient sound system
  private ambientNode: AudioBufferSourceNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientRunning = false;
  // Music player
  readonly music: MusicPlayer;

  constructor() {
    this.music = new MusicPlayer();
  }

  /** Initialize audio context (must be called from user gesture) */
  init(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
      this.masterGain.connect(this.ctx.destination);
    } catch {
      // Web Audio not available
    }
  }

  /** Resume context if suspended (browsers require user gesture) */
  resume(): void {
    if (this.ctx?.state === 'suspended') {
      this.ctx.resume();
    }
    // Also resume HTML5 music player in case it was paused by browser throttle
    this.music.resume();
  }

  /**
   * Load extracted WAV samples from public/ra/audio/.
   * Non-blocking: starts loading in background. Sounds that haven't loaded
   * yet will use synthesized fallback. Call after init().
   */
  async loadSamples(): Promise<void> {
    if (!this.ctx || this.samplesLoaded || this.samplesLoading) return;
    this.samplesLoading = true;

    // First check if audio manifest exists (indicates extraction was run)
    try {
      const manifestRes = await fetch(`${AUDIO_BASE_URL}/manifest.json`);
      if (!manifestRes.ok) {
        // No extracted audio available — synth-only mode
        this.samplesLoading = false;
        return;
      }
      // manifest.json exists, proceed to load WAV files
    } catch {
      this.samplesLoading = false;
      return;
    }

    const ctx = this.ctx;

    // Load all WAV files in parallel, silently skipping failures
    const loadPromises = SAMPLE_SOUND_NAMES.map(async (name) => {
      try {
        const response = await fetch(`${AUDIO_BASE_URL}/${name}.wav`);
        if (!response.ok) return; // file not available, will use synth
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        this.sampleBuffers.set(name, audioBuffer);
      } catch {
        // Failed to load/decode — synth fallback will be used
      }
    });

    await Promise.all(loadPromises);
    this.samplesLoaded = true;
    this.samplesLoading = false;
  }

  /** Whether real audio samples have been loaded */
  get hasSamples(): boolean { return this.samplesLoaded && this.sampleBuffers.size > 0; }

  /** Number of loaded sample buffers */
  get sampleCount(): number { return this.sampleBuffers.size; }

  /**
   * Play a sampled sound through Web Audio.
   * Returns true if the sample was found and played, false otherwise.
   */
  private playSample(name: string, out: AudioNode): boolean {
    const buffer = this.sampleBuffers.get(name);
    if (!buffer || !this.ctx) return false;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    // Apply a gain node to normalize volume for sampled sounds
    // (original RA samples tend to be loud; scale to match synth levels)
    const sampleGain = this.ctx.createGain();
    sampleGain.gain.value = 0.6;
    source.connect(sampleGain).connect(out);
    source.start();
    return true;
  }

  getVolume(): number { return this.volume; }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain) this.masterGain.gain.value = this.muted ? 0 : this.volume;
    this.music.setVolume(v);
  }

  /** Get SFX volume (master gain level, independent of music) */
  getSfxVolume(): number { return this.volume; }

  /** Set SFX volume only (does not affect music) */
  setSfxVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain) this.masterGain.gain.value = this.muted ? 0 : this.volume;
  }

  /** Get music volume */
  getMusicVolume(): number { return this.music.getVolume(); }

  /** Set music volume only (does not affect SFX) */
  setMusicVolume(v: number): void {
    this.music.setVolume(Math.max(0, Math.min(1, v)));
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.masterGain) this.masterGain.gain.value = this.muted ? 0 : this.volume;
    this.music.setMuted(this.muted);
    return this.muted;
  }

  isMuted(): boolean { return this.muted; }

  /** Play a named sound effect. Prefers real samples, falls back to synthesis. */
  play(name: SoundName): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (this.ctx.state === 'suspended') { this.ctx.resume(); return; }

    // Rate-limit same sounds
    const now = performance.now();
    const last = this.lastPlayed.get(name) ?? 0;
    if (now - last < this.MIN_INTERVAL) return;
    this.lastPlayed.set(name, now);

    const out = this.masterGain;

    // Try playing from loaded sample first
    if (this.playSample(name, out)) return;

    // Fall back to synthesized audio
    const t = this.ctx.currentTime;
    this.playSynth(name, t, out);
  }

  /** Play a sound at a world position with stereo panning based on camera center */
  playAt(name: SoundName, worldX: number, worldY: number, cameraX: number, cameraW: number): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (this.ctx.state === 'suspended') { this.ctx.resume(); return; }

    // Rate-limit same sounds
    const now = performance.now();
    const last = this.lastPlayed.get(name) ?? 0;
    if (now - last < this.MIN_INTERVAL) return;
    this.lastPlayed.set(name, now);

    // Calculate stereo pan based on world position relative to camera center
    const cameraCenterX = cameraX + cameraW / 2;
    const relativeX = (worldX - cameraCenterX) / (cameraW / 2); // -1 to +1
    const pan = Math.max(-1, Math.min(1, relativeX * 0.6)); // 60% strength

    // Create panner node
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.masterGain);

    // Auto-disconnect panner after sound finishes (prevent audio graph leak)
    setTimeout(() => { try { panner.disconnect(); } catch { /* already disconnected */ } }, 3000);

    // Try playing from loaded sample first
    if (this.playSample(name, panner)) return;

    // Fall back to synthesized audio
    const t = this.ctx.currentTime;
    this.playSynth(name, t, panner);
  }

  /** Route to the appropriate synthesis function (used as fallback) */
  private playSynth(name: SoundName, t: number, out: AudioNode): void {
    switch (name) {
      case 'rifle': this.synthRifle(t, out); break;
      case 'machinegun': this.synthMachinegun(t, out); break;
      case 'cannon': this.synthCannon(t, out); break;
      case 'artillery': this.synthArtillery(t, out); break;
      case 'mandible': this.synthMandible(t, out); break;
      case 'teslazap': this.synthTesla(t, out); break;
      case 'fireball': this.synthFireball(t, out); break;
      case 'flamethrower': this.synthFlamethrower(t, out); break;
      case 'grenade': this.synthGrenade(t, out); break;
      case 'bazooka': this.synthBazooka(t, out); break;
      case 'dogjaw': this.synthDogJaw(t, out); break;
      case 'explode_sm': this.synthExplode(t, out, 0.15, 0.25); break;
      case 'explode_lg': this.synthExplode(t, out, 0.3, 0.45); break;
      case 'die_infantry': this.synthDieInfantry(t, out); break;
      case 'die_vehicle': this.synthDieVehicle(t, out); break;
      case 'die_ant': this.synthDieAnt(t, out); break;
      case 'move_ack': this.synthAck(t, out, 800 + (NonCriticalRandom.float() - 0.5) * 200); break;
      case 'move_ack_infantry': this.synthAck(t, out, 900 + (NonCriticalRandom.float() - 0.5) * 150); break;
      case 'move_ack_vehicle': this.synthAckVehicle(t, out); break;
      case 'move_ack_dog': this.synthAckDog(t, out); break;
      case 'attack_ack': this.synthAck(t, out, 600 + (NonCriticalRandom.float() - 0.5) * 150); break;
      case 'select': this.synthSelect(t, out); break;
      case 'select_infantry': this.synthSelectInfantry(t, out); break;
      case 'select_vehicle': this.synthSelectVehicle(t, out); break;
      case 'select_dog': this.synthSelectDog(t, out); break;
      case 'unit_lost': this.synthUnitLost(t, out); break;
      case 'building_explode': this.synthBuildingExplode(t, out); break;
      case 'heal': this.synthHeal(t, out); break;
      case 'eva_unit_lost': this.synthEvaUnitLost(t, out); break;
      case 'eva_base_attack': this.synthEvaBaseAttack(t, out); break;
      case 'eva_acknowledged': this.synthEvaAcknowledged(t, out); break;
      case 'eva_construction_complete': this.synthEvaConstructionComplete(t, out); break;
      case 'eva_unit_ready': this.synthEvaUnitReady(t, out); break;
      case 'eva_low_power': this.synthEvaLowPower(t, out); break;
      case 'eva_new_options': this.synthEvaNewOptions(t, out); break;
      case 'eva_building': this.synthEvaBuilding(t, out); break;
      case 'repair': this.synthRepair(t, out); break;
      case 'sell': this.synthSell(t, out); break;
      case 'victory_fanfare': this.synthVictoryFanfare(t, out); break;
      case 'defeat_sting': this.synthDefeatSting(t, out); break;
      case 'crate_pickup': this.synthCratePickup(t, out); break;
      case 'eva_mission_accomplished': this.synthEvaMissionAccomplished(t, out); break;
      case 'eva_reinforcements': this.synthEvaReinforcements(t, out); break;
      case 'eva_mission_warning': this.synthEvaMissionWarning(t, out); break;
      case 'tesla_charge': this.synthTeslaCharge(t, out); break;
      case 'sniper': this.synthSniper(t, out); break;
      case 'building_placed': this.synthBuildingPlaced(t, out); break;
      case 'mammoth_cannon': this.synthMammothCannon(t, out); break;
      case 'eva_building_captured': this.synthEvaBuildingCaptured(t, out); break;
      case 'eva_insufficient_funds': this.synthEvaInsufficientFunds(t, out); break;
      case 'eva_silos_needed': this.synthEvaSilosNeeded(t, out); break;
      case 'chrono': this.synthChrono(t, out); break;
      case 'iron_curtain': this.synthIronCurtain(t, out); break;
      case 'nuke_launch': this.synthNukeLaunch(t, out); break;
      case 'nuke_explode': this.synthNukeExplode(t, out); break;
      case 'score_beep': this.synthScoreBeep(t, out); break;
      case 'score_swoosh': this.synthScoreSwoosh(t, out); break;
    }
  }

  /** Map weapon name to sound */
  weaponSound(weaponName: string): SoundName {
    switch (weaponName) {
      case 'Mandible': return 'mandible';
      case 'TeslaZap': case 'TeslaCannon': return 'teslazap';
      case 'FireballLauncher': return 'fireball';
      case 'Flamer': return 'flamethrower';
      case 'M1Carbine': return 'rifle';
      case 'M60mg': return 'machinegun';
      case '75mm': case '90mm': case '105mm': case '120mm': return 'cannon';
      case 'MammothTusk': return 'mammoth_cannon';
      case '155mm': return 'artillery';
      case 'Grenade': return 'grenade';
      case 'Dragon': case 'RedEye': return 'bazooka';
      case 'Heal': return 'rifle';
      case 'DogJaw': return 'dogjaw';
      case 'Napalm': return 'flamethrower';
      case 'Sniper': return 'sniper';
      default: return 'rifle';
    }
  }

  /** Start looping ambient background sound (wind + nature) */
  startAmbient(): void {
    if (!this.ctx || !this.masterGain || this.ambientRunning) return;
    this.ambientRunning = true;
    const ctx = this.ctx;
    // Generate a looping ambient buffer: filtered pink-ish noise (wind)
    const duration = 4; // 4-second loop
    const len = Math.ceil(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Simple 1/f approximation for wind-like noise
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = NonCriticalRandom.float() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      data[i] = (b0 + b1 + b2 + white * 0.5362) * 0.11;
    }
    // Crossfade seam: blend tail into head for seamless looping
    const fade = Math.ceil(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      data[i] = data[i] * t + data[len - fade + i] * (1 - t);
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0.06; // very subtle background
    src.connect(g).connect(this.masterGain);
    src.start();
    this.ambientNode = src;
    this.ambientGain = g;
  }

  /** Stop ambient background sound */
  stopAmbient(): void {
    if (this.ambientNode) {
      try { this.ambientNode.stop(); } catch { /* already stopped */ }
      this.ambientNode.disconnect();
      this.ambientNode = null;
    }
    if (this.ambientGain) {
      this.ambientGain.disconnect();
      this.ambientGain = null;
    }
    this.ambientRunning = false;
  }

  destroy(): void {
    this.stopAmbient();
    this.music.destroy();
    this.sampleBuffers.clear();
    this.samplesLoaded = false;
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
      this.masterGain = null;
    }
  }

  // === Sound Synthesis ===

  private noise(duration: number): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const len = Math.ceil(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = NonCriticalRandom.float() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  private osc(type: OscillatorType, freq: number): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    return o;
  }

  private gain(v: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = v;
    return g;
  }

  private filter(type: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  // --- Weapon sounds ---

  private synthRifle(t: number, out: AudioNode): void {
    const n = this.noise(0.06);
    const g = this.gain(0.4);
    const f = this.filter('bandpass', 3000, 2);
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    n.connect(f).connect(g).connect(out);
    n.start(t); n.stop(t + 0.06);
  }

  private synthMachinegun(t: number, out: AudioNode): void {
    const n = this.noise(0.04);
    const g = this.gain(0.35);
    const f = this.filter('highpass', 2000);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    n.connect(f).connect(g).connect(out);
    n.start(t); n.stop(t + 0.04);
  }

  private synthCannon(t: number, out: AudioNode): void {
    // Low thump + noise burst
    const o = this.osc('sine', 80);
    const og = this.gain(0.5);
    og.gain.setValueAtTime(0.5, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.frequency.setValueAtTime(80, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.15);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 0.15);

    const n = this.noise(0.08);
    const ng = this.gain(0.3);
    const nf = this.filter('lowpass', 1500);
    ng.gain.setValueAtTime(0.3, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    n.connect(nf).connect(ng).connect(out);
    n.start(t); n.stop(t + 0.08);
  }

  private synthArtillery(t: number, out: AudioNode): void {
    const o = this.osc('sine', 60);
    const og = this.gain(0.6);
    og.gain.setValueAtTime(0.6, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.frequency.setValueAtTime(60, t);
    o.frequency.exponentialRampToValueAtTime(20, t + 0.2);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 0.2);

    const n = this.noise(0.12);
    const ng = this.gain(0.4);
    const nf = this.filter('lowpass', 800);
    ng.gain.setValueAtTime(0.4, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    n.connect(nf).connect(ng).connect(out);
    n.start(t); n.stop(t + 0.12);
  }

  private synthMandible(t: number, out: AudioNode): void {
    // Crunchy bite: short noise burst + low click
    const n = this.noise(0.05);
    const ng = this.gain(0.45);
    const nf = this.filter('bandpass', 600, 3);
    ng.gain.setValueAtTime(0.45, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    n.connect(nf).connect(ng).connect(out);
    n.start(t); n.stop(t + 0.05);

    const o = this.osc('square', 120);
    const og = this.gain(0.2);
    og.gain.setValueAtTime(0.2, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 0.03);
  }

  private synthTesla(t: number, out: AudioNode): void {
    // Electric zap: saw oscillator with rapid frequency sweep + noise
    const o = this.osc('sawtooth', 2000);
    const og = this.gain(0.3);
    og.gain.setValueAtTime(0.3, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.frequency.setValueAtTime(2000, t);
    o.frequency.exponentialRampToValueAtTime(200, t + 0.15);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 0.15);

    const n = this.noise(0.1);
    const ng = this.gain(0.15);
    const nf = this.filter('highpass', 3000);
    ng.gain.setValueAtTime(0.15, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    n.connect(nf).connect(ng).connect(out);
    n.start(t); n.stop(t + 0.1);
  }

  private synthFireball(t: number, out: AudioNode): void {
    // Whoosh + crackle
    const n = this.noise(0.2);
    const ng = this.gain(0.3);
    const nf = this.filter('bandpass', 400, 2);
    ng.gain.setValueAtTime(0.1, t);
    ng.gain.linearRampToValueAtTime(0.3, t + 0.05);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    nf.frequency.setValueAtTime(400, t);
    nf.frequency.exponentialRampToValueAtTime(150, t + 0.2);
    n.connect(nf).connect(ng).connect(out);
    n.start(t); n.stop(t + 0.2);
  }

  private synthFlamethrower(t: number, out: AudioNode): void {
    const n = this.noise(0.15);
    const ng = this.gain(0.25);
    const nf = this.filter('bandpass', 800, 1.5);
    ng.gain.setValueAtTime(0.25, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    n.connect(nf).connect(ng).connect(out);
    n.start(t); n.stop(t + 0.15);
  }

  private synthGrenade(t: number, out: AudioNode): void {
    // Pop + whistle
    const n = this.noise(0.04);
    const ng = this.gain(0.3);
    ng.gain.setValueAtTime(0.3, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    n.connect(ng).connect(out);
    n.start(t); n.stop(t + 0.04);
  }

  private synthBazooka(t: number, out: AudioNode): void {
    // Woosh launch
    const n = this.noise(0.12);
    const ng = this.gain(0.35);
    const nf = this.filter('bandpass', 600, 2);
    ng.gain.setValueAtTime(0.35, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    nf.frequency.setValueAtTime(600, t);
    nf.frequency.exponentialRampToValueAtTime(1200, t + 0.12);
    n.connect(nf).connect(ng).connect(out);
    n.start(t); n.stop(t + 0.12);
  }

  private synthDogJaw(t: number, out: AudioNode): void {
    // Sharp bark/snap
    const o = this.osc('square', 300);
    const og = this.gain(0.3);
    og.gain.setValueAtTime(0.3, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.06);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 0.06);
  }

  private synthSniper(t: number, out: AudioNode): void {
    // Sharp crack with echo — high-pitched snap
    const n = this.noise(0.03);
    const ng = this.gain(0.5);
    const nf = this.filter('highpass', 4000);
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    n.connect(nf).connect(ng).connect(out);
    n.start(t); n.stop(t + 0.03);
    // Echo
    const n2 = this.noise(0.06);
    const ng2 = this.gain(0.15);
    const nf2 = this.filter('bandpass', 2000, 2);
    ng2.gain.setValueAtTime(0.15, t + 0.08);
    ng2.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    n2.connect(nf2).connect(ng2).connect(out);
    n2.start(t + 0.08); n2.stop(t + 0.14);
  }

  // --- Explosion ---

  private synthExplode(t: number, out: AudioNode, vol: number, dur: number): void {
    // Low rumble + noise burst
    const o = this.osc('sine', 50);
    const og = this.gain(vol);
    og.gain.setValueAtTime(vol, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.frequency.setValueAtTime(50, t);
    o.frequency.exponentialRampToValueAtTime(15, t + dur);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + dur);

    const n = this.noise(dur * 0.7);
    const ng = this.gain(vol * 0.8);
    const nf = this.filter('lowpass', 2000);
    ng.gain.setValueAtTime(vol * 0.8, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.7);
    nf.frequency.setValueAtTime(2000, t);
    nf.frequency.exponentialRampToValueAtTime(200, t + dur * 0.7);
    n.connect(nf).connect(ng).connect(out);
    n.start(t); n.stop(t + dur * 0.7);
  }

  // --- Death sounds ---

  private synthDieInfantry(t: number, out: AudioNode): void {
    // Brief scream-like: descending tone
    const o = this.osc('sawtooth', 500);
    const og = this.gain(0.15);
    og.gain.setValueAtTime(0.15, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.frequency.setValueAtTime(500, t);
    o.frequency.exponentialRampToValueAtTime(200, t + 0.2);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 0.2);
  }

  private synthDieVehicle(t: number, out: AudioNode): void {
    // Metal crunch + explosion
    this.synthExplode(t, out, 0.25, 0.4);
    const n = this.noise(0.08);
    const ng = this.gain(0.2);
    const nf = this.filter('highpass', 2000);
    ng.gain.setValueAtTime(0.2, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    n.connect(nf).connect(ng).connect(out);
    n.start(t); n.stop(t + 0.08);
  }

  private synthDieAnt(t: number, out: AudioNode): void {
    // Squelch: low noise burst
    const n = this.noise(0.12);
    const ng = this.gain(0.35);
    const nf = this.filter('lowpass', 500);
    ng.gain.setValueAtTime(0.35, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    nf.frequency.setValueAtTime(500, t);
    nf.frequency.exponentialRampToValueAtTime(100, t + 0.12);
    n.connect(nf).connect(ng).connect(out);
    n.start(t); n.stop(t + 0.12);
  }

  // --- UI sounds ---

  private synthAck(t: number, out: AudioNode, freq: number): void {
    // Short blip
    const o = this.osc('sine', freq);
    const og = this.gain(0.12);
    og.gain.setValueAtTime(0.12, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 0.06);
  }

  private synthSelect(t: number, out: AudioNode): void {
    // Double blip with slight pitch variation
    const pitchVar = 1 + (NonCriticalRandom.float() - 0.5) * 0.15;
    const o1 = this.osc('sine', 700 * pitchVar);
    const g1 = this.gain(0.1);
    g1.gain.setValueAtTime(0.1, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    o1.connect(g1).connect(out);
    o1.start(t); o1.stop(t + 0.04);

    const o2 = this.osc('sine', 900 * pitchVar);
    const g2 = this.gain(0.1);
    g2.gain.setValueAtTime(0.1, t + 0.05);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o2.connect(g2).connect(out);
    o2.start(t + 0.05); o2.stop(t + 0.09);
  }

  private synthSelectInfantry(t: number, out: AudioNode): void {
    // Crisp click-blip (infantry reports)
    const pitchVar = 1 + (NonCriticalRandom.float() - 0.5) * 0.1;
    const o = this.osc('square', 600 * pitchVar);
    const g = this.gain(0.08);
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.05);
  }

  private synthSelectVehicle(t: number, out: AudioNode): void {
    // Low thunk (heavy machinery)
    const pitchVar = 1 + (NonCriticalRandom.float() - 0.5) * 0.1;
    const o = this.osc('triangle', 350 * pitchVar);
    const g = this.gain(0.12);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.07);
  }

  private synthAckVehicle(t: number, out: AudioNode): void {
    // Low engine rumble acknowledgment
    const o = this.osc('sawtooth', 200 + NonCriticalRandom.float() * 50);
    const g = this.gain(0.06);
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.1);
  }

  private synthAckDog(t: number, out: AudioNode): void {
    // Quick bark: descending chirp
    const o = this.osc('sine', 1400);
    const g = this.gain(0.07);
    g.gain.setValueAtTime(0.07, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.frequency.exponentialRampToValueAtTime(800, t + 0.06);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.06);
  }

  private synthSelectDog(t: number, out: AudioNode): void {
    // Quick yip (two rapid high notes)
    const o1 = this.osc('sine', 1200);
    const g1 = this.gain(0.08);
    g1.gain.setValueAtTime(0.08, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    o1.connect(g1).connect(out);
    o1.start(t); o1.stop(t + 0.03);
    const o2 = this.osc('sine', 1500);
    const g2 = this.gain(0.08);
    g2.gain.setValueAtTime(0.08, t + 0.04);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    o2.connect(g2).connect(out);
    o2.start(t + 0.04); o2.stop(t + 0.07);
  }

  // --- Notification sounds ---

  private synthUnitLost(t: number, out: AudioNode): void {
    // RA-style descending two-note warning tone
    const o1 = this.osc('sine', 600);
    const g1 = this.gain(0.2);
    g1.gain.setValueAtTime(0.2, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o1.connect(g1).connect(out);
    o1.start(t); o1.stop(t + 0.15);

    const o2 = this.osc('sine', 400);
    const g2 = this.gain(0.2);
    g2.gain.setValueAtTime(0.2, t + 0.15);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o2.connect(g2).connect(out);
    o2.start(t + 0.15); o2.stop(t + 0.35);
  }

  private synthBuildingExplode(t: number, out: AudioNode): void {
    // Heavy explosion with sustained rumble
    this.synthExplode(t, out, 0.4, 0.6);
    // Additional crumble: low-freq noise
    const n = this.noise(0.4);
    const ng = this.gain(0.2);
    const nf = this.filter('lowpass', 300);
    ng.gain.setValueAtTime(0.1, t + 0.2);
    ng.gain.linearRampToValueAtTime(0.2, t + 0.3);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    n.connect(nf).connect(ng).connect(out);
    n.start(t + 0.15); n.stop(t + 0.6);
  }

  private synthHeal(t: number, out: AudioNode): void {
    // Soft ascending tone
    const o = this.osc('sine', 500);
    const og = this.gain(0.08);
    og.gain.setValueAtTime(0.08, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.frequency.setValueAtTime(500, t);
    o.frequency.linearRampToValueAtTime(800, t + 0.12);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 0.12);
  }

  // --- EVA announcements (robotic multi-tone sequences) ---

  private synthEvaUnitLost(t: number, out: AudioNode): void {
    // "Unit lost" — descending three-note robotic sequence
    const notes = [700, 500, 350];
    notes.forEach((freq, i) => {
      const dt = t + i * 0.12;
      const o = this.osc('square', freq);
      const g = this.gain(0.12);
      g.gain.setValueAtTime(0.12, dt);
      g.gain.exponentialRampToValueAtTime(0.001, dt + 0.1);
      o.connect(g).connect(out);
      o.start(dt); o.stop(dt + 0.1);
    });
  }

  private synthEvaBaseAttack(t: number, out: AudioNode): void {
    // "Base under attack" — urgent alternating two-note alarm
    for (let i = 0; i < 4; i++) {
      const dt = t + i * 0.1;
      const freq = i % 2 === 0 ? 900 : 700;
      const o = this.osc('square', freq);
      const g = this.gain(0.15);
      g.gain.setValueAtTime(0.15, dt);
      g.gain.exponentialRampToValueAtTime(0.001, dt + 0.08);
      o.connect(g).connect(out);
      o.start(dt); o.stop(dt + 0.08);
    }
  }

  private synthEvaAcknowledged(t: number, out: AudioNode): void {
    // "Acknowledged" — ascending two-note confirmation
    const o1 = this.osc('square', 500);
    const g1 = this.gain(0.1);
    g1.gain.setValueAtTime(0.1, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o1.connect(g1).connect(out);
    o1.start(t); o1.stop(t + 0.08);

    const o2 = this.osc('square', 800);
    const g2 = this.gain(0.1);
    g2.gain.setValueAtTime(0.1, t + 0.1);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o2.connect(g2).connect(out);
    o2.start(t + 0.1); o2.stop(t + 0.18);
  }

  private synthEvaConstructionComplete(t: number, out: AudioNode): void {
    // "Construction complete" — triumphant ascending four-note fanfare
    const notes = [400, 500, 600, 800];
    notes.forEach((freq, i) => {
      const dt = t + i * 0.1;
      const o = this.osc('square', freq);
      const g = this.gain(0.13);
      g.gain.setValueAtTime(0.13, dt);
      g.gain.exponentialRampToValueAtTime(0.001, dt + 0.12);
      o.connect(g).connect(out);
      o.start(dt); o.stop(dt + 0.12);
    });
  }

  private synthEvaUnitReady(t: number, out: AudioNode): void {
    // "Unit ready" — two quick ascending pips
    const o1 = this.osc('square', 600);
    const g1 = this.gain(0.1);
    g1.gain.setValueAtTime(0.1, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o1.connect(g1).connect(out);
    o1.start(t); o1.stop(t + 0.06);

    const o2 = this.osc('square', 900);
    const g2 = this.gain(0.12);
    g2.gain.setValueAtTime(0.12, t + 0.08);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o2.connect(g2).connect(out);
    o2.start(t + 0.08); o2.stop(t + 0.16);
  }

  private synthEvaLowPower(t: number, out: AudioNode): void {
    // "Low power" — descending two-note warning
    const o1 = this.osc('sawtooth', 600);
    const g1 = this.gain(0.12);
    g1.gain.setValueAtTime(0.12, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o1.connect(g1).connect(out);
    o1.start(t); o1.stop(t + 0.15);

    const o2 = this.osc('sawtooth', 350);
    const g2 = this.gain(0.12);
    g2.gain.setValueAtTime(0.12, t + 0.18);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o2.connect(g2).connect(out);
    o2.start(t + 0.18); o2.stop(t + 0.35);
  }

  private synthEvaNewOptions(t: number, out: AudioNode): void {
    // "New construction options" — ascending three-note excited sequence
    const notes = [500, 700, 1000];
    notes.forEach((freq, i) => {
      const dt = t + i * 0.1;
      const o = this.osc('square', freq);
      const g = this.gain(0.11);
      g.gain.setValueAtTime(0.11, dt);
      g.gain.exponentialRampToValueAtTime(0.001, dt + 0.1);
      o.connect(g).connect(out);
      o.start(dt); o.stop(dt + 0.1);
    });
  }

  private synthEvaBuilding(t: number, out: AudioNode): void {
    // "Building" — single low confirming tone
    const o = this.osc('square', 400);
    const g = this.gain(0.1);
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.12);
  }

  private synthSell(t: number, out: AudioNode): void {
    // Descending metallic crunch — building being dismantled
    const o = this.osc('sawtooth', 300);
    const og = this.gain(0.2);
    og.gain.setValueAtTime(0.2, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(80, t + 0.25);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 0.25);
    // Metal crunch noise
    const n = this.noise(0.15);
    const ng = this.gain(0.15);
    const nf = this.filter('bandpass', 1500, 2);
    ng.gain.setValueAtTime(0.15, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    n.connect(nf).connect(ng).connect(out);
    n.start(t); n.stop(t + 0.15);
  }

  private synthRepair(t: number, out: AudioNode): void {
    // Wrench sound: quick metallic tapping
    for (let i = 0; i < 2; i++) {
      const dt = t + i * 0.06;
      const o = this.osc('triangle', 1800 - i * 300);
      const g = this.gain(0.06);
      g.gain.setValueAtTime(0.06, dt);
      g.gain.exponentialRampToValueAtTime(0.001, dt + 0.04);
      o.connect(g).connect(out);
      o.start(dt); o.stop(dt + 0.04);
    }
  }

  private synthVictoryFanfare(t: number, out: AudioNode): void {
    // Ascending triumph: C-E-G-C major arpeggio with brass timbre
    const notes = [523, 659, 784, 1047]; // C5-E5-G5-C6
    notes.forEach((freq, i) => {
      const dt = t + i * 0.15;
      const o = this.osc('sawtooth', freq);
      const g = this.gain(0.12);
      const f = this.filter('lowpass', 2000, 1);
      g.gain.setValueAtTime(0.12, dt);
      g.gain.setValueAtTime(0.12, dt + 0.12);
      g.gain.exponentialRampToValueAtTime(0.001, dt + (i === 3 ? 0.6 : 0.13));
      o.connect(f).connect(g).connect(out);
      o.start(dt); o.stop(dt + (i === 3 ? 0.6 : 0.14));
    });
  }

  private synthDefeatSting(t: number, out: AudioNode): void {
    // Descending minor: dramatic low brass descending
    const notes = [440, 370, 311, 220]; // A4-F#4-Eb4-A3
    notes.forEach((freq, i) => {
      const dt = t + i * 0.2;
      const o = this.osc('sawtooth', freq);
      const g = this.gain(0.1);
      const f = this.filter('lowpass', 1200, 1);
      g.gain.setValueAtTime(0.1, dt);
      g.gain.exponentialRampToValueAtTime(0.001, dt + 0.35);
      o.connect(f).connect(g).connect(out);
      o.start(dt); o.stop(dt + 0.35);
    });
  }

  private synthCratePickup(t: number, out: AudioNode): void {
    // Quick chime: ascending two-tone sparkle
    const o1 = this.osc('sine', 800);
    const o2 = this.osc('sine', 1200);
    const g1 = this.gain(0.08);
    const g2 = this.gain(0.08);
    g1.gain.setValueAtTime(0.08, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    g2.gain.setValueAtTime(0.08, t + 0.05);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o1.connect(g1).connect(out);
    o2.connect(g2).connect(out);
    o1.start(t); o1.stop(t + 0.1);
    o2.start(t + 0.05); o2.stop(t + 0.15);
  }

  private synthEvaMissionAccomplished(t: number, out: AudioNode): void {
    // "Mission Accomplished" — two rising confirmatory tones
    const o1 = this.osc('square', 600);
    const o2 = this.osc('square', 800);
    const g1 = this.gain(0.08);
    const g2 = this.gain(0.08);
    g1.gain.setValueAtTime(0.08, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    g2.gain.setValueAtTime(0.08, t + 0.15);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o1.connect(g1).connect(out);
    o2.connect(g2).connect(out);
    o1.start(t); o1.stop(t + 0.15);
    o2.start(t + 0.15); o2.stop(t + 0.35);
  }

  private synthEvaReinforcements(t: number, out: AudioNode): void {
    // "Reinforcements have arrived" — ascending hopeful three-note sequence
    const notes = [500, 650, 900];
    notes.forEach((freq, i) => {
      const dt = t + i * 0.12;
      const o = this.osc('square', freq);
      const g = this.gain(0.12);
      g.gain.setValueAtTime(0.12, dt);
      g.gain.exponentialRampToValueAtTime(0.001, dt + 0.1);
      o.connect(g).connect(out);
      o.start(dt); o.stop(dt + 0.1);
    });
  }

  private synthEvaMissionWarning(t: number, out: AudioNode): void {
    // "Warning" — urgent descending alarm with sawtooth edge
    for (let i = 0; i < 3; i++) {
      const dt = t + i * 0.15;
      const freq = 800 - i * 150;
      const o = this.osc('sawtooth', freq);
      const g = this.gain(0.14);
      g.gain.setValueAtTime(0.14, dt);
      g.gain.exponentialRampToValueAtTime(0.001, dt + 0.12);
      o.connect(g).connect(out);
      o.start(dt); o.stop(dt + 0.12);
    }
  }

  private synthTeslaCharge(t: number, out: AudioNode): void {
    // Tesla coil charging: rising electric hum with crackle overlay
    const o = this.osc('sawtooth', 100);
    const og = this.gain(0.15);
    og.gain.setValueAtTime(0.05, t);
    og.gain.linearRampToValueAtTime(0.15, t + 0.3);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.frequency.setValueAtTime(100, t);
    o.frequency.exponentialRampToValueAtTime(1500, t + 0.3);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 0.35);

    const n = this.noise(0.25);
    const ng = this.gain(0.08);
    const nf = this.filter('highpass', 4000);
    ng.gain.setValueAtTime(0.02, t);
    ng.gain.linearRampToValueAtTime(0.08, t + 0.25);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    n.connect(nf).connect(ng).connect(out);
    n.start(t); n.stop(t + 0.3);
  }

  private synthBuildingPlaced(t: number, out: AudioNode): void {
    // Hammer thunk + rising confirmation tone
    const n = this.noise(0.06);
    const ng = this.gain(0.35);
    const nf = this.filter('lowpass', 800);
    ng.gain.setValueAtTime(0.35, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    n.connect(nf).connect(ng).connect(out);
    n.start(t); n.stop(t + 0.06);
    // Rising tone
    const o = this.osc('sine', 400);
    const og = this.gain(0.1);
    og.gain.setValueAtTime(0.1, t + 0.05);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.frequency.setValueAtTime(400, t + 0.05);
    o.frequency.linearRampToValueAtTime(700, t + 0.15);
    o.connect(og).connect(out);
    o.start(t + 0.05); o.stop(t + 0.15);
  }

  private synthMammothCannon(t: number, out: AudioNode): void {
    // Deep boom with sub-bass rumble
    const o = this.osc('sine', 40);
    const og = this.gain(0.6);
    og.gain.setValueAtTime(0.6, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.frequency.setValueAtTime(40, t);
    o.frequency.exponentialRampToValueAtTime(15, t + 0.3);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 0.3);
    // Impact noise
    const n = this.noise(0.12);
    const ng = this.gain(0.4);
    const nf = this.filter('lowpass', 600);
    ng.gain.setValueAtTime(0.4, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    n.connect(nf).connect(ng).connect(out);
    n.start(t); n.stop(t + 0.12);
  }

  private synthEvaBuildingCaptured(t: number, out: AudioNode): void {
    // "Building captured" — triumphant ascending three-note sequence
    const notes = [600, 800, 1000];
    notes.forEach((freq, i) => {
      const dt = t + i * 0.1;
      const o = this.osc('square', freq);
      const g = this.gain(0.12);
      g.gain.setValueAtTime(0.12, dt);
      g.gain.exponentialRampToValueAtTime(0.001, dt + 0.1);
      o.connect(g).connect(out);
      o.start(dt); o.stop(dt + 0.1);
    });
  }

  private synthEvaInsufficientFunds(t: number, out: AudioNode): void {
    // "Insufficient funds" — descending negative two-note
    const o1 = this.osc('sawtooth', 500);
    const g1 = this.gain(0.12);
    g1.gain.setValueAtTime(0.12, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o1.connect(g1).connect(out);
    o1.start(t); o1.stop(t + 0.15);

    const o2 = this.osc('sawtooth', 300);
    const g2 = this.gain(0.12);
    g2.gain.setValueAtTime(0.12, t + 0.18);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o2.connect(g2).connect(out);
    o2.start(t + 0.18); o2.stop(t + 0.35);
  }

  private synthEvaSilosNeeded(t: number, out: AudioNode): void {
    // "Silos needed" — urgent repeating warning tone
    for (let i = 0; i < 3; i++) {
      const dt = t + i * 0.12;
      const o = this.osc('square', 700);
      const g = this.gain(0.13);
      g.gain.setValueAtTime(0.13, dt);
      g.gain.exponentialRampToValueAtTime(0.001, dt + 0.1);
      o.connect(g).connect(out);
      o.start(dt); o.stop(dt + 0.1);
    }
  }

  private synthChrono(t: number, out: AudioNode): void {
    // Chronosphere teleport — rising sci-fi sweep
    const o = this.osc('sine', 200);
    o.frequency.exponentialRampToValueAtTime(2000, t + 0.4);
    const g = this.gain(0.2);
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.5);
  }

  private synthIronCurtain(t: number, out: AudioNode): void {
    // Iron Curtain — deep resonant hum
    const o = this.osc('sawtooth', 80);
    const g = this.gain(0.15);
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.6);
  }

  private synthNukeLaunch(t: number, out: AudioNode): void {
    // Nuke launch — ascending rocket roar
    const o = this.osc('sawtooth', 100);
    o.frequency.exponentialRampToValueAtTime(800, t + 1.0);
    const g = this.gain(0.2);
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 1.2);
  }

  private synthNukeExplode(t: number, out: AudioNode): void {
    // Nuclear explosion — deep rumbling boom
    const o = this.osc('sawtooth', 40);
    const g = this.gain(0.3);
    g.gain.setValueAtTime(0.3, t);
    g.gain.linearRampToValueAtTime(0.15, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.0);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 2.0);
  }

  /** C++ Beepy6 — short tick during score count-up (score.cpp:612) */
  private synthScoreBeep(t: number, out: AudioNode): void {
    const o = this.osc('square', 880);
    const g = this.gain(0.04);
    g.gain.setValueAtTime(0.04, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.04);
  }

  /** C++ sfx4 — section transition swoosh (score.cpp:521,646) */
  private synthScoreSwoosh(t: number, out: AudioNode): void {
    const o = this.osc('sawtooth', 200);
    const g = this.gain(0.06);
    const f = this.filter('lowpass', 1500, 2);
    o.frequency.exponentialRampToValueAtTime(800, t + 0.15);
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(f).connect(g).connect(out);
    o.start(t); o.stop(t + 0.25);
  }
}
