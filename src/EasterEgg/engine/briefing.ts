/**
 * Mission Briefing Cutscene Renderer
 *
 * Renders animated pre-mission briefings on the 640x400 game canvas.
 * Styled as Cold War military command briefings with a 1950s B-movie aesthetic
 * to match the campy tone of the original "It Came From Red Alert" ant missions.
 *
 * All rendering is procedural via Canvas 2D — no external assets required.
 * Audio is synthesized via Web Audio API.
 */

// === Briefing Sequence Data ===

interface BriefingStep {
  /** Duration in seconds before auto-advancing (after text finishes) */
  duration: number;
  /** Text lines to typewrite (empty = no text this step) */
  text: string[];
  /** Visual effect to render during this step */
  visual: 'static_burst' | 'classified' | 'radar' | 'map_outpost' | 'map_villages'
    | 'intel_report' | 'specialist' | 'dark_tunnel' | 'queen_reveal'
    | 'map_nests' | 'gas_canister' | 'power_warning' | 'fade_out';
  /** Optional sub-label drawn small at top of frame */
  label?: string;
}

interface MissionBriefing {
  steps: BriefingStep[];
}

const BRIEFINGS: Record<string, MissionBriefing> = {
  SCA01EA: {
    steps: [
      { duration: 1.5, text: [], visual: 'static_burst', label: 'SIGNAL INTERCEPTED' },
      { duration: 2.5, text: [], visual: 'classified' },
      {
        duration: 4.0,
        text: [
          'We\'ve lost contact with one of our',
          'outposts. The last transmission mentioned',
          'something about... giant ants.',
        ],
        visual: 'radar',
        label: 'ALLIED COMMAND — PRIORITY ALPHA',
      },
      {
        duration: 4.0,
        text: [
          'Scout the area and bring the outpost',
          'back online. Eliminate any threat.',
          '',
          'Keep radio contact open — we can\'t',
          'afford to lose another post.',
        ],
        visual: 'map_outpost',
        label: 'MISSION OBJECTIVE',
      },
      { duration: 1.0, text: [], visual: 'fade_out' },
    ],
  },
  SCA02EA: {
    steps: [
      { duration: 1.2, text: [], visual: 'static_burst', label: 'INCOMING TRANSMISSION' },
      {
        duration: 4.0,
        text: [
          'Giant ants confirmed. God help us.',
          '',
          'Two civilian villages are in the',
          'immediate area. They won\'t survive.',
        ],
        visual: 'map_villages',
        label: 'ALLIED COMMAND — EMERGENCY',
      },
      {
        duration: 4.5,
        text: [
          'Evacuate civilians to the island',
          'in the northwest. Destroy all bridges',
          'to halt the ant advance.',
          '',
          'At least one civilian from each',
          'town must make it out alive.',
        ],
        visual: 'map_villages',
        label: 'EVACUATION ORDER',
      },
      { duration: 1.0, text: [], visual: 'fade_out' },
    ],
  },
  SCA03EA: {
    steps: [
      { duration: 1.2, text: [], visual: 'static_burst', label: 'INTELLIGENCE REPORT' },
      {
        duration: 3.5,
        text: [
          'The source of ant activity has been',
          'pinpointed. Their nests are in this',
          'sector — they must be destroyed.',
        ],
        visual: 'map_nests',
        label: 'TARGET ANALYSIS',
      },
      {
        duration: 3.0,
        text: [
          'A team of civilian specialists',
          'are en route with gas equipment.',
          'Use them to fumigate all nests.',
        ],
        visual: 'specialist',
        label: 'CHAN SPECIALIST UNIT',
      },
      {
        duration: 3.0,
        text: [
          'Be careful — these things can',
          'chew through anything.',
          '',
          'Good luck, Commander.',
        ],
        visual: 'gas_canister',
        label: 'WEAPONS AUTHORIZATION',
      },
      { duration: 1.0, text: [], visual: 'fade_out' },
    ],
  },
  SCA04EA: {
    steps: [
      { duration: 1.5, text: [], visual: 'static_burst', label: 'FINAL BRIEFING' },
      {
        duration: 3.5,
        text: [
          'We\'ve discovered tunnels beneath',
          'the ruined base. Their escape',
          'routes have been sealed.',
        ],
        visual: 'dark_tunnel',
        label: 'SUBTERRANEAN SURVEY',
      },
      {
        duration: 3.0,
        text: [
          'Tunnel power is offline.',
          'Visibility will be limited.',
          'Find the generator controls.',
        ],
        visual: 'power_warning',
        label: 'WARNING — POWER OFFLINE',
      },
      {
        duration: 4.0,
        text: [
          'Sweep and clear all tunnels.',
          'Find the source of these',
          'abominations.',
          '',
          'Destroy anything that isn\'t human.',
        ],
        visual: 'queen_reveal',
        label: 'SEARCH AND DESTROY',
      },
      { duration: 1.0, text: [], visual: 'fade_out' },
    ],
  },
};

// === Briefing Audio ===

class BriefingAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private droneNode: OscillatorNode | null = null;
  private droneNode2: OscillatorNode | null = null;
  private droneGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;

  init(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.3;
      this.masterGain.connect(this.ctx.destination);
    } catch {
      // Web Audio unavailable
    }
  }

  resume(): void {
    if (this.ctx?.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /** Low tension drone — atmospheric background hum */
  startDrone(): void {
    if (!this.ctx || !this.masterGain || this.droneNode) return;
    const t = this.ctx.currentTime;

    // Deep filtered oscillator pair for ominous hum
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55; // low A

    const osc2 = this.ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 82.5; // slight detune for tension

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 200;
    filter.Q.value = 2;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 1.5);

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(this.masterGain);

    osc.start(t);
    osc2.start(t);

    this.droneNode = osc;
    this.droneNode2 = osc2;
    this.droneGain = gain;
    this.droneFilter = filter;

    // Slow filter sweep for movement
    filter.frequency.setValueAtTime(200, t);
    filter.frequency.linearRampToValueAtTime(300, t + 8);
    filter.frequency.linearRampToValueAtTime(150, t + 16);
  }

  stopDrone(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.droneGain) {
      this.droneGain.gain.linearRampToValueAtTime(0, t + 0.5);
    }
    if (this.droneNode) {
      this.droneNode.stop(t + 0.6);
      this.droneNode = null;
    }
    if (this.droneNode2) {
      this.droneNode2.stop(t + 0.6);
      this.droneNode2 = null;
    }
    this.droneGain = null;
    this.droneFilter = null;
  }

  /** Typewriter click — short percussive tick */
  typeClick(): void {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;

    const len = 0.012;
    const buf = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * len), this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.15));
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 4000;
    filter.Q.value = 3;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + len);

    src.connect(filter).connect(gain).connect(this.masterGain);
    src.start(t);
    src.stop(t + len);
  }

  /** Radar ping — clean sine sweep */
  radarPing(): void {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1800, t);
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.15);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

    osc.connect(gain).connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  /** Static burst — harsh noise crackle */
  staticBurst(): void {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;

    const dur = 0.3;
    const len = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.3));
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2000;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    src.connect(filter).connect(gain).connect(this.masterGain);
    src.start(t);
    src.stop(t + dur);
  }

  /** Stamp sound — thud for CLASSIFIED stamp */
  stamp(): void {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.1);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    osc.connect(gain).connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.15);

    // Paper impact noise
    const dur = 0.06;
    const len = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.2));
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g2 = this.ctx.createGain();
    g2.gain.setValueAtTime(0.3, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(g2).connect(this.masterGain);
    src.start(t);
    src.stop(t + dur);
  }

  /** Warning alarm — alternating tones for power warning */
  warningTone(): void {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;

    for (let i = 0; i < 3; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = i % 2 === 0 ? 440 : 520;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, t + i * 0.15);
      gain.gain.linearRampToValueAtTime(0.08, t + i * 0.15 + 0.02);
      gain.gain.linearRampToValueAtTime(0, t + i * 0.15 + 0.12);
      osc.connect(gain).connect(this.masterGain);
      osc.start(t + i * 0.15);
      osc.stop(t + i * 0.15 + 0.15);
    }
  }

  destroy(): void {
    this.stopDrone();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
      this.masterGain = null;
    }
  }
}

// === Scan Line + Static Helpers ===

/** Pseudo-random deterministic hash for consistent static patterns */
function staticHash(x: number, y: number, seed: number): number {
  let h = (x * 374761 + y * 668265 + seed * 982451) | 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  return ((h >> 16) ^ h) & 0xff;
}

// === Colors ===
const COL_OD_DARK = '#2a2f1e';     // olive drab dark
const COL_OD_MED = '#3d4a2a';      // olive drab medium
const COL_OD_LIGHT = '#566b38';    // olive drab light
const COL_AMBER = '#cc8833';       // amber CRT
const COL_AMBER_DIM = '#886622';   // dim amber
const COL_GREEN = '#33cc44';       // radar green
const COL_GREEN_DIM = '#1a6622';   // dim radar green
const COL_RED = '#cc2222';         // alert red
const COL_RED_BRIGHT = '#ff3333';  // bright red
const COL_TEXT = '#ccbb99';        // document text
const COL_TEXT_DIM = '#887755';    // dim text

// === Main Briefing Renderer ===

export type BriefingState = 'playing' | 'done';

export class BriefingRenderer {
  private ctx: CanvasRenderingContext2D;
  private width = 640;
  private height = 400;
  private audio: BriefingAudio;

  // Sequence state
  private scenarioId = '';
  private steps: BriefingStep[] = [];
  private stepIndex = 0;
  private stepTime = 0;          // seconds elapsed in current step
  private totalTime = 0;         // total elapsed seconds
  private charIndex = 0;         // characters revealed so far
  private totalChars = 0;        // total chars in current step's text
  private textComplete = false;  // all text revealed this step
  private skipping = false;      // user pressed skip
  private animFrame = 0;
  private lastFrameTime = 0;

  // Radar sweep
  private radarAngle = 0;
  private radarBlips: Array<{ x: number; y: number; age: number; bright: number }> = [];
  private lastPingTime = 0;

  // Classified stamp
  private stampPlayed = false;
  private stampScale = 3.0;

  // Transition
  private fadeAlpha = 0;

  // Static noise buffer (pre-generated for consistency)
  private staticSeed = 0;

  // Tunnel flashlight
  private flashlightAngle = 0;

  // Queen reveal
  private queenRevealProgress = 0;

  // Callback
  onComplete?: () => void;
  state: BriefingState = 'playing';

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.audio = new BriefingAudio();
  }

  /** Start a briefing sequence for a given scenario */
  start(scenarioId: string): void {
    const briefing = BRIEFINGS[scenarioId];
    if (!briefing) {
      // No briefing defined — skip directly
      this.state = 'done';
      this.onComplete?.();
      return;
    }

    this.scenarioId = scenarioId;
    this.steps = briefing.steps;
    this.stepIndex = 0;
    this.stepTime = 0;
    this.totalTime = 0;
    this.charIndex = 0;
    this.textComplete = false;
    this.skipping = false;
    this.animFrame = 0;
    this.fadeAlpha = 0;
    this.stampPlayed = false;
    this.stampScale = 3.0;
    this.radarAngle = 0;
    this.radarBlips = [];
    this.lastPingTime = 0;
    this.flashlightAngle = 0;
    this.queenRevealProgress = 0;
    this.staticSeed = Math.floor(Math.random() * 10000);
    this.state = 'playing';

    this.totalChars = this.countChars(this.steps[0]);

    // Init audio
    this.audio.init();
    this.audio.resume();
    this.audio.startDrone();

    // Play initial step sound
    if (this.steps[0]?.visual === 'static_burst') {
      this.audio.staticBurst();
    }

    this.lastFrameTime = performance.now();
    this.loop();
  }

  /** Stop and clean up */
  stop(): void {
    this.state = 'done';
    this.audio.destroy();
  }

  /** Advance text or skip to next step. Called on click/space. */
  advance(): void {
    if (this.state !== 'playing') return;

    if (!this.textComplete && this.totalChars > 0) {
      // Reveal all text immediately
      this.charIndex = this.totalChars;
      this.textComplete = true;
    } else {
      // Move to next step (or advance past no-text step)
      this.nextStep();
    }
  }

  /** Skip entire briefing. Called on Escape. */
  skip(): void {
    this.skipping = true;
    this.state = 'done';
    this.audio.stopDrone();
    this.audio.destroy();
    this.onComplete?.();
  }

  // --- Internal ---

  private countChars(step: BriefingStep): number {
    return step.text.reduce((sum, line) => sum + line.length, 0);
  }

  private nextStep(): void {
    this.stepIndex++;
    if (this.stepIndex >= this.steps.length) {
      this.state = 'done';
      this.audio.stopDrone();
      this.audio.destroy();
      this.onComplete?.();
      return;
    }
    this.stepTime = 0;
    this.charIndex = 0;
    this.textComplete = false;
    this.stampPlayed = false;
    this.stampScale = 3.0;
    this.totalChars = this.countChars(this.steps[this.stepIndex]);

    const step = this.steps[this.stepIndex];
    if (step.visual === 'static_burst') {
      this.audio.staticBurst();
    }
  }

  private loop = (): void => {
    if (this.state !== 'playing') return;

    const now = performance.now();
    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.1); // cap at 100ms
    this.lastFrameTime = now;

    this.stepTime += dt;
    this.totalTime += dt;
    this.animFrame++;

    const step = this.steps[this.stepIndex];
    if (!step) {
      this.state = 'done';
      this.audio.stopDrone();
      this.audio.destroy();
      this.onComplete?.();
      return;
    }

    // Typewriter effect: ~30 chars/sec
    if (!this.textComplete && this.totalChars > 0) {
      const prevChar = this.charIndex;
      this.charIndex = Math.min(this.totalChars, Math.floor(this.stepTime * 30));
      if (this.charIndex >= this.totalChars) {
        this.textComplete = true;
      }
      // Type click sound for each new character
      if (this.charIndex > prevChar && this.charIndex % 2 === 0) {
        this.audio.typeClick();
      }
    }

    // Auto-advance after text complete + pause
    if (this.totalChars === 0) {
      // Steps with no text auto-advance after their duration
      if (this.stepTime >= step.duration) {
        this.nextStep();
        requestAnimationFrame(this.loop);
        return;
      }
    } else if (this.textComplete) {
      // Text steps: wait 2.5s after text finishes, then advance
      const charsTime = this.totalChars / 30;
      if (this.stepTime >= charsTime + 2.5) {
        this.nextStep();
        requestAnimationFrame(this.loop);
        return;
      }
    }

    // Render
    this.render(step, dt);

    requestAnimationFrame(this.loop);
  };

  private render(step: BriefingStep, dt: number): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Clear to black
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    // Render visual
    switch (step.visual) {
      case 'static_burst': this.renderStaticBurst(dt); break;
      case 'classified': this.renderClassified(dt); break;
      case 'radar': this.renderRadar(dt); break;
      case 'map_outpost': this.renderMapOutpost(dt); break;
      case 'map_villages': this.renderMapVillages(dt); break;
      case 'map_nests': this.renderMapNests(dt); break;
      case 'intel_report': this.renderIntelReport(dt); break;
      case 'specialist': this.renderSpecialist(dt); break;
      case 'gas_canister': this.renderGasCanister(dt); break;
      case 'dark_tunnel': this.renderDarkTunnel(dt); break;
      case 'power_warning': this.renderPowerWarning(dt); break;
      case 'queen_reveal': this.renderQueenReveal(dt); break;
      case 'fade_out': this.renderFadeOut(dt); break;
    }

    // Label at top
    if (step.label) {
      this.renderLabel(step.label);
    }

    // Typewriter text
    if (step.text.length > 0 && this.charIndex > 0) {
      this.renderText(step.text);
    }

    // Scan lines overlay (always)
    this.renderScanLines();

    // Vignette
    this.renderVignette();

    // Skip hint
    this.renderSkipHint();
  }

  // === Visual Renderers ===

  private renderStaticBurst(_dt: number): void {
    const ctx = this.ctx;
    const intensity = Math.max(0, 1 - this.stepTime / 1.2);
    if (intensity <= 0) return;

    // Draw static noise
    const blockSize = 4;
    for (let y = 0; y < this.height; y += blockSize) {
      for (let x = 0; x < this.width; x += blockSize) {
        const v = staticHash(x, y, this.animFrame) / 255;
        const bright = Math.floor(v * 180 * intensity);
        ctx.fillStyle = `rgb(${bright},${bright},${bright})`;
        ctx.fillRect(x, y, blockSize, blockSize);
      }
    }
  }

  private renderClassified(dt: number): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Dark olive background with paper texture
    ctx.fillStyle = COL_OD_DARK;
    ctx.fillRect(0, 0, w, h);

    // Paper texture noise
    for (let y = 0; y < h; y += 8) {
      for (let x = 0; x < w; x += 8) {
        const v = staticHash(x, y, 42) / 255;
        ctx.fillStyle = `rgba(${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},${v > 0.5 ? 200 : 0},0.02)`;
        ctx.fillRect(x, y, 8, 8);
      }
    }

    // Document border lines
    ctx.strokeStyle = COL_OD_LIGHT;
    ctx.lineWidth = 2;
    ctx.strokeRect(40, 30, w - 80, h - 60);
    ctx.strokeRect(44, 34, w - 88, h - 68);

    // "TOP SECRET" header
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = COL_TEXT_DIM;
    ctx.textAlign = 'center';
    ctx.fillText('TOP SECRET // ALLIED COMMAND // EYES ONLY', w / 2, 60);

    // Horizontal rule
    ctx.beginPath();
    ctx.moveTo(80, 75);
    ctx.lineTo(w - 80, 75);
    ctx.strokeStyle = COL_OD_LIGHT;
    ctx.lineWidth = 1;
    ctx.stroke();

    // CLASSIFIED stamp — appears with animation
    if (!this.stampPlayed && this.stepTime > 0.3) {
      this.stampPlayed = true;
      this.stampScale = 3.0;
      this.audio.stamp();
    }

    if (this.stampPlayed) {
      // Animate stamp scale: snaps down from 3x to 1x
      this.stampScale = Math.max(1.0, this.stampScale - dt * 12);
      const scale = this.stampScale;

      ctx.save();
      ctx.translate(w / 2, h / 2 - 20);
      ctx.rotate(-0.15); // slight angle
      ctx.scale(scale, scale);

      // Stamp rectangle
      ctx.fillStyle = 'rgba(180,20,20,0.85)';
      ctx.fillRect(-120, -28, 240, 56);

      // Stamp border
      ctx.strokeStyle = '#cc3333';
      ctx.lineWidth = 3;
      ctx.strokeRect(-120, -28, 240, 56);
      ctx.strokeRect(-116, -24, 232, 48);

      // Stamp text
      ctx.font = 'bold 36px monospace';
      ctx.fillStyle = '#ff4444';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('CLASSIFIED', 0, 2);

      ctx.restore();
    }

    // Footer
    ctx.font = '10px monospace';
    ctx.fillStyle = COL_TEXT_DIM;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('UNAUTHORIZED DISCLOSURE SUBJECT TO PENALTIES UNDER ESPIONAGE ACT', w / 2, h - 45);
  }

  private renderRadar(dt: number): void {
    const ctx = this.ctx;
    const cx = 160;
    const cy = 200;
    const r = 120;

    // Dark background
    ctx.fillStyle = '#0a120a';
    ctx.fillRect(0, 0, this.width, this.height);

    // Radar circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#0a1a0a';
    ctx.fill();
    ctx.strokeStyle = COL_GREEN_DIM;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Grid rings
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * i / 3, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(51,204,68,${0.15})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Cross hairs
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.strokeStyle = 'rgba(51,204,68,0.15)';
    ctx.stroke();

    // Sweep line
    this.radarAngle += dt * 2.0; // ~2 rad/sec
    const sx = cx + Math.cos(this.radarAngle) * r;
    const sy = cy + Math.sin(this.radarAngle) * r;

    // Sweep gradient trail
    const sweepAngle = this.radarAngle;
    for (let i = 0; i < 20; i++) {
      const a = sweepAngle - i * 0.04;
      const alpha = (1 - i / 20) * 0.3;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.strokeStyle = `rgba(51,204,68,${alpha})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Bright sweep line
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(sx, sy);
    ctx.strokeStyle = COL_GREEN;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Blips — add new ones periodically
    if (this.totalTime - this.lastPingTime > 1.5) {
      this.lastPingTime = this.totalTime;
      const angle = Math.random() * Math.PI * 2;
      const dist = 0.3 + Math.random() * 0.6;
      this.radarBlips.push({
        x: cx + Math.cos(angle) * r * dist,
        y: cy + Math.sin(angle) * r * dist,
        age: 0,
        bright: 0.7 + Math.random() * 0.3,
      });
      this.audio.radarPing();
    }

    // Update and render blips
    for (let i = this.radarBlips.length - 1; i >= 0; i--) {
      const blip = this.radarBlips[i];
      blip.age += dt;
      if (blip.age > 3.0) {
        this.radarBlips.splice(i, 1);
        continue;
      }
      const alpha = Math.max(0, blip.bright * (1 - blip.age / 3.0));
      // Pulsing glow
      const pulse = 1 + Math.sin(blip.age * 8) * 0.3;
      const sz = 3 * pulse;
      ctx.beginPath();
      ctx.arc(blip.x, blip.y, sz + 4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(51,204,68,${alpha * 0.15})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(blip.x, blip.y, sz, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(100,255,120,${alpha})`;
      ctx.fill();
    }

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = COL_GREEN;
    ctx.fill();

    // Radar label
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = COL_GREEN_DIM;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('SECTOR SCAN — CONTACTS DETECTED', cx, cy + r + 20);
  }

  private renderMapOutpost(dt: number): void {
    this.renderTacticalMap(dt, [
      { x: 160, y: 180, label: 'OUTPOST', type: 'base', alert: true },
      { x: 100, y: 140, label: 'RECON TEAM', type: 'friendly' },
    ]);
  }

  private renderMapVillages(dt: number): void {
    this.renderTacticalMap(dt, [
      { x: 120, y: 150, label: 'VILLAGE A', type: 'civilian', alert: true },
      { x: 200, y: 220, label: 'VILLAGE B', type: 'civilian', alert: true },
      { x: 80, y: 100, label: 'EVAC ISLAND', type: 'base' },
      { x: 160, y: 185, label: 'BRIDGE', type: 'target' },
      { x: 140, y: 240, label: 'BRIDGE', type: 'target' },
    ]);
  }

  private renderMapNests(dt: number): void {
    this.renderTacticalMap(dt, [
      { x: 180, y: 160, label: 'NEST ALPHA', type: 'target', alert: true },
      { x: 120, y: 220, label: 'NEST BRAVO', type: 'target', alert: true },
      { x: 220, y: 240, label: 'NEST CHARLIE', type: 'target', alert: true },
      { x: 140, y: 140, label: 'BASE', type: 'base' },
    ]);
  }

  private renderTacticalMap(dt: number, markers: Array<{ x: number; y: number; label: string; type: string; alert?: boolean }>): void {
    const ctx = this.ctx;
    const w = this.width;
    // Map area: left portion of screen (0 to 320)
    const mapW = 300;
    const mapH = 300;
    const mapX = 10;
    const mapY = 50;

    // Dark map background
    ctx.fillStyle = '#0a0f0a';
    ctx.fillRect(0, 0, w, this.height);

    // Map border
    ctx.strokeStyle = COL_GREEN_DIM;
    ctx.lineWidth = 1;
    ctx.strokeRect(mapX, mapY, mapW, mapH);

    // Grid lines
    ctx.strokeStyle = 'rgba(51,204,68,0.08)';
    for (let i = 1; i < 6; i++) {
      const gx = mapX + (mapW / 6) * i;
      const gy = mapY + (mapH / 6) * i;
      ctx.beginPath();
      ctx.moveTo(gx, mapY);
      ctx.lineTo(gx, mapY + mapH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mapX, gy);
      ctx.lineTo(mapX + mapW, gy);
      ctx.stroke();
    }

    // Topographic-style contour lines
    ctx.strokeStyle = 'rgba(51,204,68,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const cx = mapX + 80 + Math.sin(i * 1.2) * 60;
      const cy = mapY + 80 + Math.cos(i * 0.9) * 50;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 40 + i * 25, 30 + i * 18, i * 0.3, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Render markers
    const pulse = Math.sin(this.totalTime * 4) * 0.5 + 0.5;
    for (const m of markers) {
      const mx = mapX + m.x;
      const my = mapY + m.y;

      let color = COL_GREEN;
      let symbolSize = 4;
      if (m.type === 'target') { color = COL_RED_BRIGHT; symbolSize = 5; }
      if (m.type === 'civilian') { color = COL_AMBER; symbolSize = 4; }
      if (m.type === 'base') { color = COL_GREEN; symbolSize = 6; }
      if (m.type === 'friendly') { color = '#44aaff'; symbolSize = 4; }

      // Alert pulse ring
      if (m.alert) {
        const ringR = symbolSize + 4 + pulse * 6;
        ctx.beginPath();
        ctx.arc(mx, my, ringR, 0, Math.PI * 2);
        // Parse hex color to rgba with pulse alpha
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.3 * pulse})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Symbol: diamond for targets, square for bases, circle for units
      ctx.fillStyle = color;
      if (m.type === 'target') {
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-symbolSize, -symbolSize, symbolSize * 2, symbolSize * 2);
        ctx.restore();
      } else if (m.type === 'base') {
        ctx.fillRect(mx - symbolSize, my - symbolSize, symbolSize * 2, symbolSize * 2);
      } else {
        ctx.beginPath();
        ctx.arc(mx, my, symbolSize, 0, Math.PI * 2);
        ctx.fill();
      }

      // Label
      ctx.font = 'bold 9px monospace';
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(m.label, mx, my + symbolSize + 12);
    }

    // Map title
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = COL_GREEN_DIM;
    ctx.textAlign = 'left';
    ctx.fillText('TACTICAL MAP — SECTOR 7G', mapX, mapY - 8);
  }

  private renderIntelReport(_dt: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#0a0a08';
    ctx.fillRect(0, 0, this.width, this.height);

    // Intel document frame
    ctx.strokeStyle = COL_AMBER_DIM;
    ctx.lineWidth = 1;
    ctx.strokeRect(30, 40, this.width - 60, this.height - 80);

    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = COL_AMBER;
    ctx.textAlign = 'center';
    ctx.fillText('INTELLIGENCE ASSESSMENT', this.width / 2, 65);
  }

  private renderSpecialist(dt: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#0a0a08';
    ctx.fillRect(0, 0, this.width, this.height);

    // Left side: personnel silhouette
    const sx = 110;
    const sy = 200;

    // Head
    ctx.beginPath();
    ctx.arc(sx, sy - 60, 18, 0, Math.PI * 2);
    ctx.fillStyle = '#1a2a1a';
    ctx.fill();
    ctx.strokeStyle = COL_GREEN_DIM;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Body
    ctx.beginPath();
    ctx.moveTo(sx - 20, sy - 40);
    ctx.lineTo(sx + 20, sy - 40);
    ctx.lineTo(sx + 25, sy + 30);
    ctx.lineTo(sx - 25, sy + 30);
    ctx.closePath();
    ctx.fillStyle = '#1a2a1a';
    ctx.fill();
    ctx.strokeStyle = COL_GREEN_DIM;
    ctx.stroke();

    // Gas mask detail
    ctx.beginPath();
    ctx.arc(sx, sy - 55, 8, 0, Math.PI);
    ctx.strokeStyle = COL_GREEN;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Canister on back
    ctx.fillStyle = '#2a2a1a';
    ctx.fillRect(sx + 22, sy - 35, 10, 40);
    ctx.strokeStyle = COL_GREEN_DIM;
    ctx.strokeRect(sx + 22, sy - 35, 10, 40);

    // Label
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = COL_GREEN;
    ctx.textAlign = 'center';
    ctx.fillText('CHAN SPECIALIST', sx, sy + 50);
    ctx.font = '9px monospace';
    ctx.fillStyle = COL_GREEN_DIM;
    ctx.fillText('GAS DISPERSAL UNIT', sx, sy + 63);

    // Equipment box - right side
    ctx.strokeStyle = COL_OD_LIGHT;
    ctx.lineWidth = 1;
    ctx.strokeRect(220, 100, 120, 80);
    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = COL_AMBER;
    ctx.textAlign = 'left';
    ctx.fillText('EQUIPMENT:', 228, 118);
    ctx.font = '9px monospace';
    ctx.fillStyle = COL_TEXT_DIM;
    ctx.fillText('MK-IV Gas Canister', 228, 135);
    ctx.fillText('Filtration Mask', 228, 148);
    ctx.fillText('Dispersal Nozzle', 228, 161);

    // Pulsing readiness indicator
    const pulse = Math.sin(this.totalTime * 3) * 0.5 + 0.5;
    ctx.beginPath();
    ctx.arc(236, 175, 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(51,204,68,${0.5 + pulse * 0.5})`;
    ctx.fill();
    ctx.font = '9px monospace';
    ctx.fillStyle = COL_GREEN;
    ctx.fillText('EN ROUTE', 244, 178);
  }

  private renderGasCanister(dt: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#0a0a08';
    ctx.fillRect(0, 0, this.width, this.height);

    const cx = 130;
    const cy = 200;

    // Gas canister — cylindrical shape
    ctx.fillStyle = '#2a3a1a';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 40, 20, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - 20, cy - 40, 40, 80);
    ctx.beginPath();
    ctx.ellipse(cx, cy + 40, 20, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hazard stripe
    ctx.fillStyle = '#cc8822';
    ctx.fillRect(cx - 20, cy - 8, 40, 16);
    ctx.fillStyle = '#0a0a08';
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(cx - 20 + i * 16, cy - 8, 8, 16);
    }

    // Label on canister
    ctx.font = 'bold 8px monospace';
    ctx.fillStyle = COL_RED;
    ctx.textAlign = 'center';
    ctx.fillText('MK-IV TOXIN', cx, cy + 18);

    // Skull and crossbones (simple)
    ctx.strokeStyle = COL_RED;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy - 22, 6, 0, Math.PI * 2);
    ctx.stroke();
    // Eyes
    ctx.fillStyle = COL_RED;
    ctx.fillRect(cx - 3, cy - 24, 2, 2);
    ctx.fillRect(cx + 1, cy - 24, 2, 2);

    // Gas dispersion animation
    const gasAlpha = 0.1 + Math.sin(this.totalTime * 2) * 0.05;
    for (let i = 0; i < 6; i++) {
      const angle = (this.totalTime * 0.5 + i * 1.05) % (Math.PI * 2);
      const dist = 40 + Math.sin(this.totalTime + i) * 15;
      const gx = cx + Math.cos(angle) * dist;
      const gy = cy + Math.sin(angle) * dist * 0.6;
      const gr = 15 + i * 5;
      const gradient = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      gradient.addColorStop(0, `rgba(80,160,60,${gasAlpha})`);
      gradient.addColorStop(1, 'rgba(80,160,60,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
    }

    // Authorization text
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = COL_RED;
    ctx.textAlign = 'center';
    ctx.fillText('WEAPONS AUTHORIZATION GRANTED', cx, cy + 60);
  }

  private renderDarkTunnel(dt: number): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Very dark background
    ctx.fillStyle = '#020202';
    ctx.fillRect(0, 0, w, h);

    // Flashlight sweep
    this.flashlightAngle += dt * 0.4;
    const flX = w * 0.35 + Math.cos(this.flashlightAngle) * 80;
    const flY = h * 0.45 + Math.sin(this.flashlightAngle * 0.7) * 40;
    const flR = 100;

    // Flashlight cone
    const gradient = ctx.createRadialGradient(flX, flY, 0, flX, flY, flR);
    gradient.addColorStop(0, 'rgba(200,180,120,0.15)');
    gradient.addColorStop(0.5, 'rgba(150,130,80,0.06)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // Tunnel wireframe — perspective grid
    ctx.strokeStyle = 'rgba(100,80,40,0.12)';
    ctx.lineWidth = 1;

    // Converging lines (tunnel perspective)
    const vanishX = w * 0.4;
    const vanishY = h * 0.4;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const ex = vanishX + Math.cos(angle) * 400;
      const ey = vanishY + Math.sin(angle) * 300;
      ctx.beginPath();
      ctx.moveTo(vanishX, vanishY);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }

    // Depth rings
    for (let i = 1; i <= 5; i++) {
      const scale = i / 5;
      const rx = 40 + scale * 200;
      const ry = 30 + scale * 150;
      ctx.beginPath();
      ctx.ellipse(vanishX, vanishY, rx, ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(100,80,40,${0.04 + scale * 0.06})`;
      ctx.stroke();
    }

    // Rock texture hints (small dots in flashlight area)
    for (let i = 0; i < 30; i++) {
      const rx = flX + (staticHash(i, 0, this.staticSeed) - 128) * 0.8;
      const ry = flY + (staticHash(0, i, this.staticSeed) - 128) * 0.6;
      const dist = Math.hypot(rx - flX, ry - flY);
      if (dist < flR * 0.8) {
        const alpha = 0.05 * (1 - dist / (flR * 0.8));
        ctx.fillStyle = `rgba(150,130,100,${alpha})`;
        ctx.fillRect(rx, ry, 2, 2);
      }
    }
  }

  private renderPowerWarning(dt: number): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Dark with flickering
    const flicker = Math.random() > 0.92 ? 0.08 : 0;
    ctx.fillStyle = `rgb(${Math.floor(flicker * 30)},${Math.floor(flicker * 20)},${Math.floor(flicker * 10)})`;
    ctx.fillRect(0, 0, w, h);

    // WARNING border flash
    const pulse = Math.sin(this.totalTime * 6) * 0.5 + 0.5;
    if (pulse > 0.6) {
      ctx.strokeStyle = `rgba(255,60,20,${(pulse - 0.6) * 2})`;
      ctx.lineWidth = 4;
      ctx.strokeRect(20, 20, w - 40, h - 40);
    }

    // Power status display
    const centerY = h / 2 - 30;
    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = COL_RED_BRIGHT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Blinking WARNING
    if (Math.floor(this.totalTime * 3) % 2 === 0) {
      ctx.fillText('WARNING', w / 2, centerY - 40);
    }

    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = COL_RED;
    ctx.fillText('POWER SYSTEMS OFFLINE', w / 2, centerY);

    // Power bar — empty
    const barW = 200;
    const barH = 16;
    const barX = w / 2 - barW / 2;
    const barY = centerY + 25;
    ctx.strokeStyle = COL_RED;
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);

    // Tiny flicker of power
    if (flicker > 0) {
      ctx.fillStyle = 'rgba(255,60,20,0.3)';
      ctx.fillRect(barX + 2, barY + 2, Math.random() * 20, barH - 4);
    }

    ctx.font = '10px monospace';
    ctx.fillStyle = COL_RED;
    ctx.fillText('VISIBILITY LIMITED', w / 2, barY + barH + 20);
    ctx.fillText('LOCATE GENERATOR CONTROLS', w / 2, barY + barH + 35);

    // Play warning sound once
    if (this.stepTime < dt * 2) {
      this.audio.warningTone();
    }
  }

  private renderQueenReveal(dt: number): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Very dark
    ctx.fillStyle = '#010101';
    ctx.fillRect(0, 0, w, h);

    // Slowly revealing queen silhouette
    this.queenRevealProgress = Math.min(1, this.queenRevealProgress + dt * 0.25);
    const reveal = this.queenRevealProgress;

    const qx = 140;
    const qy = 200;

    // Dramatic back-lighting
    if (reveal > 0.3) {
      const glowR = 80 + reveal * 40;
      const gradient = ctx.createRadialGradient(qx, qy, 0, qx, qy, glowR);
      gradient.addColorStop(0, `rgba(180,40,20,${reveal * 0.15})`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    }

    // Queen ant silhouette — drawn as segments
    const alpha = Math.min(1, reveal * 1.5);
    ctx.fillStyle = `rgba(20,10,5,${alpha})`;
    ctx.strokeStyle = `rgba(120,40,20,${alpha * 0.8})`;
    ctx.lineWidth = 2;

    // Abdomen (large back segment)
    if (reveal > 0.1) {
      ctx.beginPath();
      ctx.ellipse(qx + 35, qy + 10, 30, 22, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Thorax (middle)
    if (reveal > 0.2) {
      ctx.beginPath();
      ctx.ellipse(qx, qy, 18, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Head
    if (reveal > 0.3) {
      ctx.beginPath();
      ctx.ellipse(qx - 28, qy - 5, 14, 12, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Mandibles
      if (reveal > 0.5) {
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(qx - 40, qy - 8);
        ctx.quadraticCurveTo(qx - 55, qy - 20, qx - 50, qy - 5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(qx - 40, qy + 2);
        ctx.quadraticCurveTo(qx - 55, qy + 15, qx - 50, qy + 2);
        ctx.stroke();
      }

      // Eyes — menacing red glow
      if (reveal > 0.6) {
        const eyeGlow = Math.sin(this.totalTime * 4) * 0.3 + 0.7;
        ctx.fillStyle = `rgba(255,30,10,${alpha * eyeGlow})`;
        ctx.beginPath();
        ctx.arc(qx - 33, qy - 10, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(qx - 33, qy + 2, 3, 0, Math.PI * 2);
        ctx.fill();

        // Eye glow
        const eyeGrad = ctx.createRadialGradient(qx - 33, qy - 4, 0, qx - 33, qy - 4, 15);
        eyeGrad.addColorStop(0, `rgba(255,30,10,${alpha * eyeGlow * 0.2})`);
        eyeGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = eyeGrad;
        ctx.fillRect(qx - 50, qy - 20, 34, 32);
      }
    }

    // Legs
    if (reveal > 0.4) {
      ctx.strokeStyle = `rgba(80,30,15,${alpha * 0.9})`;
      ctx.lineWidth = 2;
      const legPairs = [
        { bx: qx - 10, by: qy },
        { bx: qx + 5, by: qy + 2 },
        { bx: qx + 20, by: qy + 5 },
      ];
      for (const lp of legPairs) {
        // Left leg
        ctx.beginPath();
        ctx.moveTo(lp.bx, lp.by);
        ctx.quadraticCurveTo(lp.bx - 20, lp.by + 20, lp.bx - 30, lp.by + 35);
        ctx.stroke();
        // Right leg (mirrored down)
        ctx.beginPath();
        ctx.moveTo(lp.bx, lp.by);
        ctx.quadraticCurveTo(lp.bx - 15, lp.by - 20, lp.bx - 25, lp.by - 30);
        ctx.stroke();
      }
    }

    // Antennae
    if (reveal > 0.7) {
      ctx.strokeStyle = `rgba(100,40,20,${alpha * 0.7})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(qx - 38, qy - 14);
      ctx.quadraticCurveTo(qx - 55, qy - 40, qx - 65, qy - 45);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(qx - 36, qy - 16);
      ctx.quadraticCurveTo(qx - 50, qy - 45, qx - 58, qy - 55);
      ctx.stroke();
    }

    // Label
    if (reveal > 0.8) {
      const labelAlpha = (reveal - 0.8) * 5;
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = `rgba(204,34,34,${labelAlpha})`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('TARGET: QUEEN ANT', qx, qy + 70);
      ctx.font = '10px monospace';
      ctx.fillStyle = `rgba(204,34,34,${labelAlpha * 0.7})`;
      ctx.fillText('DESTROY AT ALL COSTS', qx, qy + 85);
    }
  }

  private renderFadeOut(dt: number): void {
    this.fadeAlpha = Math.min(1, this.fadeAlpha + dt * 1.5);
    this.ctx.fillStyle = `rgba(0,0,0,${this.fadeAlpha})`;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  // === Overlay Renderers ===

  private renderLabel(label: string): void {
    const ctx = this.ctx;

    // Semi-transparent bar at top
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, this.width, 32);

    // Bottom edge line
    ctx.beginPath();
    ctx.moveTo(0, 32);
    ctx.lineTo(this.width, 32);
    ctx.strokeStyle = COL_OD_LIGHT;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Label text
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = COL_AMBER;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, this.width / 2, 16);
  }

  private renderText(lines: string[]): void {
    const ctx = this.ctx;
    const w = this.width;

    // Text area: right side of screen or bottom
    const textX = 340;
    const textY = 80;
    const lineH = 20;

    // Semi-transparent text background
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(textX - 16, textY - 16, w - textX + 8, lines.length * lineH + 36);

    // Border
    ctx.strokeStyle = COL_OD_LIGHT;
    ctx.lineWidth = 1;
    ctx.strokeRect(textX - 16, textY - 16, w - textX + 8, lines.length * lineH + 36);

    ctx.font = '13px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    let charsRemaining = this.charIndex;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (charsRemaining <= 0) break;

      const visibleLen = Math.min(line.length, charsRemaining);
      const visibleText = line.substring(0, visibleLen);
      charsRemaining -= line.length;

      ctx.fillStyle = COL_TEXT;
      ctx.fillText(visibleText, textX, textY + i * lineH);

      // Blinking cursor at end of current line
      if (visibleLen < line.length && !this.textComplete) {
        if (Math.floor(this.totalTime * 3) % 2 === 0) {
          const cursorX = textX + ctx.measureText(visibleText).width;
          ctx.fillStyle = COL_AMBER;
          ctx.fillRect(cursorX + 1, textY + i * lineH - 11, 7, 14);
        }
      }
    }
  }

  private renderScanLines(): void {
    const ctx = this.ctx;
    // Horizontal scan lines — very subtle CRT effect
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    for (let y = 0; y < this.height; y += 3) {
      ctx.fillRect(0, y, this.width, 1);
    }

    // Rolling scan line
    const scanY = (this.totalTime * 60) % this.height;
    ctx.fillStyle = 'rgba(255,255,255,0.015)';
    ctx.fillRect(0, scanY, this.width, 3);
  }

  private renderVignette(): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Corner vignette
    const gradient = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.7);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }

  private renderSkipHint(): void {
    const ctx = this.ctx;
    // Fade in after 1 second
    const alpha = Math.min(0.5, Math.max(0, (this.totalTime - 1.0) * 0.5));
    if (alpha <= 0) return;

    ctx.font = '9px monospace';
    ctx.fillStyle = `rgba(100,100,100,${alpha})`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('SPACE to advance | ESC to skip', this.width - 16, this.height - 10);
  }
}
