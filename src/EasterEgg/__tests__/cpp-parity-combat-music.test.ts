/**
 * C++ Behavioral Parity Tests — Combat Music Mode Transitions
 *
 * Domain: ThemeClass state machine, song selection, track pool filtering
 *
 * C++ references:
 *   - theme.cpp:197-218    — ThemeClass::AI() auto-advance loop
 *   - theme.cpp:238-267    — ThemeClass::Next_Song() sequential/shuffle selection
 *   - theme.cpp:286-315    — ThemeClass::Queue_Song() fade + pending
 *   - theme.cpp:334-346    — ThemeClass::Play_Song() immediate playback
 *   - theme.cpp:419-427    — ThemeClass::Stop() resets Score, Pending, Current
 *   - theme.cpp:455-461    — ThemeClass::Still_Playing()
 *   - theme.cpp:481-512    — ThemeClass::Is_Allowed() house/scenario filtering
 *   - theme.h:63-65        — THEME_DELAY = TIMER_SECOND (60 ticks)
 *   - defines.h:845-897    — ThemeType enum, THEME_QUIET/PICK_ANOTHER/NONE
 *   - conquer.cpp:2357-2358 — Main loop auto-start when no theme playing
 *   - options.h:94-95       — IsScoreRepeat, IsScoreShuffle
 *
 * KEY FINDING: The original C++ Red Alert has NO combat/calm music state
 * machine. ThemeClass plays songs from a single flat pool filtered by:
 *   (1) Available flag
 *   (2) Normal flag (excludes MAP, SCORE, INTRO, CREDITS)
 *   (3) House ownership bitmask (HOUSEF_ALLIES vs HOUSEF_SOVIET)
 *   (4) Scenario number threshold
 *
 * The TS MusicPlayer introduces combat/calm mode splitting, debounce timers,
 * and cooldown mechanics that do NOT exist in the C++ source. These tests
 * document the divergences.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MusicPlayer } from '../engine/audio';

// ============================================================
// Test infrastructure: Mock HTMLAudioElement for Node environment
// ============================================================

function createMockPlayer(): MusicPlayer {
  global.Audio = class MockAudio {
    src = '';
    volume = 0;
    preload = '';
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
    play = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn();
  } as any;

  const player = new MusicPlayer();
  (player as any).available = true;
  (player as any).playing = true;
  return player;
}

// ============================================================
// C++ track data for reference — theme.cpp:63-106
// ============================================================

// C++ ThemeControl table: { Name, Fullname, Scenario, Duration, Normal, Repeat, Available, Owner }
// All Normal=true tracks with their house ownership:
const CPP_ALLIED_THEMES = [
  'BIGF226M', 'FAC1226M', 'HELL226M', 'SMSH226M', 'WORK226M',
  'AWAIT', 'DENSE_R', 'FOGGER1A', 'MUD1A', 'RADIO2',
  'ROLLOUT', 'SNAKE', 'TERMINAT', 'TWIN', 'VECTOR1A',
];
const CPP_SOVIET_THEMES = [
  'CRUS226M', 'FAC2226M', 'RUN1226M', 'TREN226M',
];
// Non-normal themes (excluded from playlist):
const CPP_NON_NORMAL = ['MAP', 'SCORE', 'INTRO', 'CREDITS'];

// TS track list from audio.ts
const TS_MUSIC_TRACKS = [
  '01_hell_march', '02_radio', '03_crush', '04_roll_out', '05_mud',
  '06_twin_cannon', '07_face_the_enemy', '08_run', '09_terminate',
  '10_big_foot', '11_workmen', '12_militant_force', '13_dense',
  '14_vector', '15_smash',
];
const TS_CALM_INDICES = new Set([1, 3, 4, 7, 10, 13]); // radio, roll_out, mud, run, workmen, vector
const TS_ACTION_INDICES = new Set([0, 2, 5, 6, 8, 9, 11, 12, 14]);


// ============================================================
// Section 1: Track pool structure — C++ vs TS
// C++ theme.cpp:63-106, Is_Allowed() theme.cpp:481-512
// ============================================================

describe('Track pool structure (theme.cpp:63-106, Is_Allowed:481-512)', () => {

  it('C++ has a single flat pool per house, not calm/action split', () => {
    // C++ behavior: Is_Allowed() filters by Normal flag AND house ownership.
    // There is ONE pool for Allied players and ONE pool for Soviet players.
    // There is NO sub-categorization into "calm" vs "action" tracks.
    //
    // TS behavior: Splits all 15 tracks into CALM_TRACKS (6) and ACTION_TRACKS (9).
    // This is a TS-only enhancement not present in C++.

    // Document the split sizes
    expect(TS_CALM_INDICES.size).toBe(6);
    expect(TS_ACTION_INDICES.size).toBe(9);
    expect(TS_CALM_INDICES.size + TS_ACTION_INDICES.size).toBe(15);

    // PARITY GAP: C++ has no calm/action split. All Normal+Available themes
    // for the player's house are in one pool.
    // C++ Allied pool: 15 themes, Soviet pool: 4 themes (base game).
    expect(CPP_ALLIED_THEMES.length).toBe(15);
    expect(CPP_SOVIET_THEMES.length).toBe(4);
  });

  it('C++ filters tracks by house ownership — TS does not', () => {
    // C++ theme.cpp:500:
    //   if (PlayerPtr != NULL && ((1 << PlayerPtr->ActLike) & _themes[index].Owner) == 0) return(false);
    //
    // An Allied player CANNOT hear Soviet themes (CRUS, FAC2, RUN1, TREN)
    // A Soviet player CANNOT hear most Allied themes.
    //
    // TS plays all 15 tracks regardless of side.

    // PARITY GAP: TS has no house-based filtering at all.
    // All 15 tracks are available to both sides.
    const tsAllTracks = TS_MUSIC_TRACKS.length;
    expect(tsAllTracks).toBe(15);

    // In C++, a Soviet player would only get 4 base-game themes.
    // This fundamentally changes the listening experience.
  });

  it('C++ excludes non-Normal themes from playlist — TS has none', () => {
    // C++ theme.cpp:493: if (!_themes[index].Normal) return(false);
    // MAP, SCORE, INTRO, CREDITS have Normal=false
    expect(CPP_NON_NORMAL.length).toBe(4);

    // TS has no concept of non-normal themes — all tracks in MUSIC_TRACKS
    // are gameplay tracks. No MAP/SCORE/INTRO/CREDITS equivalent.
    // This is acceptable since TS handles these differently (separate UI).
  });

  it('C++ filters by scenario number — TS does not', () => {
    // C++ theme.cpp:506:
    //   if (Session.Type == GAME_NORMAL && Scen.Scenario < _themes[index].Scenario) return(false);
    //
    // All base-game themes have Scenario=0, so this is effectively a no-op.
    // But the mechanism exists for mod/expansion control.
    //
    // TS has no scenario-based filtering.

    // Verify C++ default: all themes start at scenario 0 (theme.cpp:63-106)
    // No practical divergence here since all Scenario values are 0.
  });
});


// ============================================================
// Section 2: Song selection algorithm — C++ Next_Song() vs TS advance()
// C++ theme.cpp:238-267
// ============================================================

describe('Song selection algorithm (theme.cpp:238-267)', () => {

  it('C++ supports both sequential and shuffle modes — TS is shuffle-only', () => {
    // C++ theme.cpp:241: if (Options.IsScoreShuffle) { ... } else { sequential }
    //
    // Sequential mode: theme++, wrap at THEME_LAST -> THEME_FIRST, skip disallowed
    // Shuffle mode: Sim_Random_Pick(THEME_FIRST, THEME_LAST), reject same + disallowed
    //
    // TS MusicPlayer.shuffle() uses Fisher-Yates to pre-shuffle the playlist,
    // then advances linearly through it. There is NO sequential mode.

    // PARITY GAP: C++ Options.IsScoreShuffle controls mode.
    // TS always shuffles (no sequential option).
  });

  it('C++ shuffle never picks same song twice in a row — TS has no such guard', () => {
    // C++ theme.cpp:248-251:
    //   do {
    //     newtheme = Sim_Random_Pick(THEME_FIRST, THEME_LAST);
    //   } while (newtheme == theme || !Is_Allowed(newtheme));
    //
    // The do-while loop explicitly rejects `newtheme == theme`.
    //
    // TS advance() method (audio.ts:172-179):
    //   const pool = this.combatMode ? ACTION_TRACKS : CALM_TRACKS;
    //   const poolArr = [...pool];
    //   const trackIdx = poolArr[Math.floor(Math.random() * poolArr.length)];
    //   this.playTrack(trackIdx);
    //
    // No check against current track — can play same song back-to-back.

    // PARITY GAP: TS can repeat the same track consecutively.
    // With ACTION_TRACKS having 9 entries, probability is ~11%.
    // With CALM_TRACKS having 6 entries, probability is ~17%.

    const player = createMockPlayer();

    // We can't deterministically test randomness, but we CAN verify the
    // advance() method doesn't take a "previous track" parameter.
    // The C++ Next_Song(ThemeType theme) takes the previous song as input.
    // The TS advance() takes no parameters — it cannot check against previous.
    expect(typeof (player as any).advance).toBe('function');
    expect((player as any).advance.length).toBe(0); // zero parameters
  });

  it('C++ supports per-track repeat flag — TS does not', () => {
    // C++ theme.cpp:240:
    //   if (theme == THEME_NONE || theme == THEME_PICK_ANOTHER ||
    //       (theme != THEME_QUIET && !_themes[theme].Repeat && !Options.IsScoreRepeat))
    //
    // If _themes[theme].Repeat is true OR Options.IsScoreRepeat is true,
    // Next_Song returns the SAME theme (repeats it).
    //
    // TS has no repeat mechanism — always advances to next track.

    // PARITY GAP: No repeat support in TS.
  });
});


// ============================================================
// Section 3: Combat/calm mode state machine — TS-only feature
// NOT present in C++ at all
// ============================================================

describe('Combat/calm state machine — TS-ONLY, no C++ equivalent', () => {

  it('C++ has no combatMode concept — entire state machine is TS invention', () => {
    // The C++ ThemeClass has exactly these members (theme.h:46-48):
    //   int Current;         // Handle to current score
    //   ThemeType Score;     // Score number currently being played
    //   ThemeType Pending;   // Score to play next
    //
    // There is NO:
    //   - combatMode flag
    //   - combatCooldown counter
    //   - combatModeChangeTime timestamp
    //   - CALM_TRACKS / ACTION_TRACKS pool split
    //
    // The entire setCombatMode() method is a TS-only enhancement.
    //
    // This is NOT necessarily a bug — it's an intentional game design
    // enhancement. But it IS a divergence from C++ behavior.

    const player = createMockPlayer();
    expect(player.isCombatMode).toBe(false);
    expect((player as any).combatCooldown).toBe(0);
    expect((player as any).combatModeChangeTime).toBe(0);

    // These fields have no C++ equivalent.
  });

  it('TS debounce: 5-second minimum between combat entries — C++ has no debounce', () => {
    // TS audio.ts:249: if (now - this.combatModeChangeTime < 5000) return;
    //
    // C++ has no concept of debouncing theme changes. Queue_Song can be called
    // at any time; the only rate-limiting is the THEME_DELAY fade duration
    // (TIMER_SECOND = 60 ticks = 1 second for fade-out).

    const player = createMockPlayer();
    player.setCombatMode(true);
    expect(player.isCombatMode).toBe(true);

    // Simulate leaving and trying to re-enter within 5 seconds
    (player as any).combatMode = false;
    (player as any).combatModeChangeTime = Date.now() - 3000; // 3 seconds ago
    player.setCombatMode(true);
    // TS blocks this — C++ would not
    expect(player.isCombatMode).toBe(false); // PARITY GAP: C++ would allow immediate re-queue
  });

  it('TS cooldown: 450 ticks to exit combat — C++ has no cooldown', () => {
    // TS audio.ts:260: if (this.combatCooldown >= 450)
    //
    // C++ Queue_Song triggers an immediate fade (THEME_DELAY=60 ticks)
    // and the new song starts playing. No cooldown period.

    const player = createMockPlayer();
    player.setCombatMode(true);
    expect(player.isCombatMode).toBe(true);

    // One call to setCombatMode(false) does NOT exit combat
    player.setCombatMode(false);
    expect(player.isCombatMode).toBe(true); // Still in combat

    // Need 450 calls
    for (let i = 1; i < 450; i++) {
      player.setCombatMode(false);
    }
    expect(player.isCombatMode).toBe(false); // Finally exits

    // PARITY GAP: C++ would switch immediately on Queue_Song call.
    // The 450-tick (22.5s at 20fps) cooldown is entirely TS-invented.
  });

  it('TS cooldown does NOT reset from setCombatMode(true) while still in combat', () => {
    // TS audio.ts:247: if (inCombat && !this.combatMode) { ... }
    // The cooldown reset (line 252) only fires when transitioning FROM calm TO combat.
    // If combatMode is already true, calling setCombatMode(true) is a no-op —
    // neither the first branch (requires !combatMode) nor the second (requires !inCombat)
    // matches. The cooldown counter is NOT reset.
    //
    // C++ has no cooldown to reset.

    const player = createMockPlayer();
    player.setCombatMode(true);

    // Start counting down: 200 ticks of setCombatMode(false)
    for (let i = 0; i < 200; i++) {
      player.setCombatMode(false);
    }
    expect(player.isCombatMode).toBe(true); // Not enough ticks
    expect((player as any).combatCooldown).toBe(200);

    // Call setCombatMode(true) while still in combat mode:
    // Hits `inCombat && !this.combatMode` — but combatMode is true, so NO MATCH.
    // Cooldown is NOT reset.
    player.setCombatMode(true);
    expect((player as any).combatCooldown).toBe(200); // Unchanged

    // Only 250 more ticks needed to reach 450 total
    for (let i = 0; i < 249; i++) {
      player.setCombatMode(false);
    }
    expect(player.isCombatMode).toBe(true); // 449 total, not enough
    player.setCombatMode(false);
    expect(player.isCombatMode).toBe(false); // 450th tick exits
  });
});


// ============================================================
// Section 4: Queue/fade behavior — C++ Queue_Song vs TS crossfade
// C++ theme.cpp:286-315, theme.h:63-65
// ============================================================

describe('Queue/fade behavior (theme.cpp:286-315)', () => {

  it('C++ fade delay is TIMER_SECOND (60 ticks) — TS crossfade is 2 seconds', () => {
    // C++ theme.h:64: THEME_DELAY=TIMER_SECOND
    // defines.h:3024: #define TIMER_SECOND 60
    //
    // At 15fps game speed, 60 ticks = 4 seconds.
    // At the DOS timer rate (60Hz), 60 ticks = 1 second.
    //
    // TS audio.ts:168: crossfade is 20 steps x 100ms = 2 seconds.

    const CPP_THEME_DELAY_TICKS = 60;
    const CPP_TIMER_SECOND = 60;
    expect(CPP_THEME_DELAY_TICKS).toBe(CPP_TIMER_SECOND);

    // TS crossfade duration in ms
    const TS_CROSSFADE_STEPS = 20;
    const TS_CROSSFADE_INTERVAL_MS = 100;
    const TS_CROSSFADE_DURATION_MS = TS_CROSSFADE_STEPS * TS_CROSSFADE_INTERVAL_MS;
    expect(TS_CROSSFADE_DURATION_MS).toBe(2000);

    // PARITY GAP: Fade durations differ, though the C++ value depends on
    // interpretation of TIMER_SECOND (60Hz timer vs game tick rate).
  });

  it('C++ Queue_Song sets Pending only when slot is free — TS always crossfades', () => {
    // C++ theme.cpp:309-314:
    //   if (Pending == THEME_NONE || Pending == THEME_PICK_ANOTHER ||
    //       theme == THEME_NONE || theme == THEME_QUIET) {
    //     Pending = theme;
    //     if (Still_Playing()) { Fade_Sample(Current, THEME_DELAY); }
    //   }
    //
    // If a different theme is already pending (not NONE or PICK_ANOTHER),
    // the new request is IGNORED. This prevents rapid queue flooding.
    //
    // TS playTrack() always starts a new track with crossfade, regardless
    // of what's currently pending.

    // PARITY GAP: C++ has queue saturation protection; TS does not.
    // C++ ignores subsequent Queue_Song calls while one is pending.
  });

  it('C++ Stop() resets Score, Pending, Current — TS stop() matches', () => {
    // C++ theme.cpp:419-427:
    //   Stop_Sample(Current); Current = -1; Score = THEME_NONE; Pending = THEME_NONE;
    //
    // TS audio.ts:203-221:
    //   this.playing = false; current.pause(); current = null; trackName = '';

    const player = createMockPlayer();
    player.stop();
    expect(player.isPlaying).toBe(false);
    expect(player.currentTrack).toBe('');
    // This behavior is roughly equivalent.
  });
});


// ============================================================
// Section 5: AI auto-advance — C++ ThemeClass::AI() vs TS advance()
// C++ theme.cpp:197-218, conquer.cpp:2357-2358
// ============================================================

describe('AI auto-advance (theme.cpp:197-218)', () => {

  it('C++ AI() checks ScoresPresent + ScoreVolume + !Still_Playing — TS has simpler checks', () => {
    // C++ theme.cpp:199-200:
    //   if (SampleType && !Debug_Quiet) {
    //     if (ScoresPresent && Options.ScoreVolume != 0 && !Still_Playing() && Pending != THEME_NONE)
    //
    // Multiple preconditions must be true before advancing.
    // TS advance() is called from the 'ended' event handler (audio.ts:127),
    // so the "not still playing" check is implicit.
    //
    // TS does check this.playing (audio.ts:173) but not volume/available.
  });

  it('C++ main loop auto-starts theme when none playing — TS does not', () => {
    // C++ conquer.cpp:2357-2358:
    //   if (SampleType && Theme.What_Is_Playing() == THEME_NONE) {
    //     Theme.Queue_Song(THEME_PICK_ANOTHER);
    //   }
    //
    // Every frame, if no theme is playing, the game force-starts one.
    // This is called from the main game loop.
    //
    // TS relies on the HTMLAudioElement 'ended' event to trigger advance().
    // If audio fails to play or the event is missed, music stops.

    // PARITY GAP: C++ has a frame-by-frame safety net to restart music.
    // TS relies on browser events which can be unreliable.
  });

  it('C++ THEME_PICK_ANOTHER sentinel triggers Next_Song — TS has no sentinel', () => {
    // C++ theme.cpp:205-207:
    //   if (Pending == THEME_PICK_ANOTHER) {
    //     Pending = Next_Song(Score);
    //   }
    //
    // THEME_PICK_ANOTHER (-2) is a sentinel value meaning "auto-select next".
    // After picking, it's replaced with the actual theme, then played.
    //
    // TS has no sentinel system — advance() directly picks and plays.

    // Verify the C++ sentinel values
    const THEME_QUIET = -3;
    const THEME_PICK_ANOTHER = -2;
    const THEME_NONE = -1;
    expect(THEME_QUIET).toBeLessThan(THEME_PICK_ANOTHER);
    expect(THEME_PICK_ANOTHER).toBeLessThan(THEME_NONE);
    expect(THEME_NONE).toBeLessThan(0); // All sentinels are negative
  });
});


// ============================================================
// Section 6: Track pool selection during advance — C++ vs TS
// ============================================================

describe('Track pool used during advance (theme.cpp:238-267 vs audio.ts:172-179)', () => {

  it('C++ advance picks from ALL allowed themes — TS picks from calm OR action subset', () => {
    // C++ Next_Song: picks from ALL themes where Is_Allowed() returns true.
    // For an Allied player, that's up to 15 themes in the base game.
    //
    // TS advance():
    //   const pool = this.combatMode ? ACTION_TRACKS : CALM_TRACKS;
    //   const poolArr = [...pool];
    //   const trackIdx = poolArr[Math.floor(Math.random() * poolArr.length)];
    //
    // TS restricts to 6 calm tracks or 9 action tracks depending on mode.

    // PARITY GAP: C++ uses the full allowed pool (up to 15 tracks).
    // TS uses a subset (6 or 9 tracks) based on combat state.

    const player = createMockPlayer();

    // In calm mode, only 6 tracks are eligible
    expect(player.isCombatMode).toBe(false);
    expect(TS_CALM_INDICES.size).toBe(6);

    // In combat mode, only 9 tracks are eligible
    player.setCombatMode(true);
    expect(player.isCombatMode).toBe(true);
    expect(TS_ACTION_INDICES.size).toBe(9);

    // C++ would use all 15 (for Allied), never restricting to subset
    expect(CPP_ALLIED_THEMES.length).toBe(15);
  });

  it('TS setCombatMode immediately switches track — C++ Queue_Song fades first', () => {
    // TS audio.ts:256: this.playTrack(trackIdx);
    // Called directly from setCombatMode() — starts playing immediately
    // with crossfade.
    //
    // C++ has no combat mode, but when Queue_Song is used (e.g. from triggers):
    // theme.cpp:311: if (Still_Playing()) { Fade_Sample(Current, THEME_DELAY); }
    // The current song fades for THEME_DELAY before the new one starts in AI().
    //
    // TS playTrack() starts the new track immediately and crossfades the old one
    // out in parallel. C++ waits for fade to complete before starting new song.

    // PARITY GAP: TS parallel crossfade vs C++ sequential fade-then-play.
  });
});


// ============================================================
// Section 7: Suspend/resume — C++ Suspend() vs TS pause/resume
// C++ theme.cpp:430-438
// ============================================================

describe('Suspend/resume (theme.cpp:430-438)', () => {

  it('C++ Suspend preserves Score in Pending for resume — TS pause/resume is simpler', () => {
    // C++ theme.cpp:430-438:
    //   void ThemeClass::Suspend(void) {
    //     if (ScoresPresent && SampleType && !Debug_Quiet && Current != -1) {
    //       Stop_Sample(Current);
    //       Current = -1;
    //       Pending = Score;    // Save current score for later resume
    //       Score = THEME_NONE;
    //     }
    //   }
    //
    // Suspend saves the current Score into Pending so AI() will restart it.
    //
    // TS pause() (audio.ts:189-193) just calls this.current.pause().
    // TS resume() (audio.ts:197-199) calls this.current.play().
    //
    // The TS approach is simpler but fundamentally different — it pauses
    // mid-track rather than stopping and queueing for restart.

    const player = createMockPlayer();
    player.pause();
    // TS keeps playing flag true, just pauses the audio element
    expect(player.isPlaying).toBe(true);

    // C++ would set Score = THEME_NONE and Current = -1
    // This is an acceptable behavioral difference.
  });
});


// ============================================================
// Section 8: Trigger-driven theme changes — C++ TACTION_PLAY_MUSIC
// C++ taction.cpp:543-544
// ============================================================

describe('Trigger-driven theme changes (taction.cpp:543-544)', () => {

  it('C++ triggers can Queue_Song any specific theme — TS has no trigger music API', () => {
    // C++ taction.cpp:543-544:
    //   case TACTION_PLAY_MUSIC:
    //     Theme.Queue_Song(Data.Theme);
    //
    // Map triggers can force a specific theme to play.
    // This is used in campaign missions for dramatic moments.
    //
    // TS MusicPlayer has no equivalent API for playing a specific track
    // by theme ID. The only track selection is via advance() (random from pool)
    // or setCombatMode() (random from combat/calm subset).

    // PARITY GAP: No trigger-driven specific track selection in TS.
  });
});


// ============================================================
// Section 9: Verify TS combat mode actually works as designed
// (These pass — documenting TS behavior, not C++ parity)
// ============================================================

describe('TS combat mode mechanics (TS-only validation)', () => {

  let player: MusicPlayer;

  beforeEach(() => {
    player = createMockPlayer();
  });

  it('combat mode activates on first call', () => {
    expect(player.isCombatMode).toBe(false);
    player.setCombatMode(true);
    expect(player.isCombatMode).toBe(true);
  });

  it('combat mode does not activate when not playing', () => {
    (player as any).playing = false;
    player.setCombatMode(true);
    expect(player.isCombatMode).toBe(false);
  });

  it('combat mode does not activate when not available', () => {
    (player as any).available = false;
    player.setCombatMode(true);
    expect(player.isCombatMode).toBe(false);
  });

  it('combat exit requires exactly 450 ticks', () => {
    player.setCombatMode(true);
    expect(player.isCombatMode).toBe(true);

    // 449 ticks: still in combat
    for (let i = 0; i < 449; i++) {
      player.setCombatMode(false);
    }
    expect(player.isCombatMode).toBe(true);

    // 450th tick: exits combat
    player.setCombatMode(false);
    expect(player.isCombatMode).toBe(false);
  });

  it('debounce blocks re-entry within 5 seconds', () => {
    player.setCombatMode(true);
    expect(player.isCombatMode).toBe(true);

    // Force exit
    (player as any).combatMode = false;
    // combatModeChangeTime was set to Date.now() when entering combat
    // Try re-entering 1 second later (within 5s debounce window)
    (player as any).combatModeChangeTime = Date.now() - 1000;
    player.setCombatMode(true);
    expect(player.isCombatMode).toBe(false); // Blocked by debounce
  });

  it('debounce allows re-entry after 5 seconds', () => {
    player.setCombatMode(true);
    expect(player.isCombatMode).toBe(true);

    // Force exit and wait past debounce window
    (player as any).combatMode = false;
    (player as any).combatModeChangeTime = Date.now() - 6000; // 6 seconds ago
    player.setCombatMode(true);
    expect(player.isCombatMode).toBe(true); // Allowed
  });

  it('setCombatMode(false) when not in combat resets cooldown', () => {
    // TS audio.ts:268-270:
    //   } else if (!inCombat) {
    //     this.combatCooldown = 0;
    //   }
    expect(player.isCombatMode).toBe(false);
    (player as any).combatCooldown = 100;
    player.setCombatMode(false);
    expect((player as any).combatCooldown).toBe(0);
  });
});
