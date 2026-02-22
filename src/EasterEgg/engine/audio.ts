/**
 * Audio system — Web Audio API synthesized sound effects.
 * Generates RA-style retro sounds using oscillators, noise, and filters.
 * No external audio files needed.
 */

type SoundName =
  | 'rifle' | 'machinegun' | 'cannon' | 'artillery'
  | 'mandible' | 'teslazap' | 'fireball' | 'flamethrower'
  | 'grenade' | 'bazooka' | 'dogjaw'
  | 'explode_sm' | 'explode_lg'
  | 'die_infantry' | 'die_vehicle' | 'die_ant'
  | 'move_ack' | 'attack_ack' | 'select'
  | 'unit_lost' | 'building_explode' | 'heal';

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private volume = 0.35;
  private muted = false;
  private lastPlayed = new Map<string, number>();
  private readonly MIN_INTERVAL = 40; // ms between same sound

  /** Initialize audio context (must be called from user gesture) */
  init(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
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
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain) this.masterGain.gain.value = this.muted ? 0 : this.volume;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.masterGain) this.masterGain.gain.value = this.muted ? 0 : this.volume;
    return this.muted;
  }

  /** Play a named sound effect */
  play(name: SoundName): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (this.ctx.state === 'suspended') return;

    // Rate-limit same sounds
    const now = performance.now();
    const last = this.lastPlayed.get(name) ?? 0;
    if (now - last < this.MIN_INTERVAL) return;
    this.lastPlayed.set(name, now);

    const t = this.ctx.currentTime;
    const out = this.masterGain;

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
      case 'move_ack': this.synthAck(t, out, 800 + (Math.random() - 0.5) * 200); break;
      case 'attack_ack': this.synthAck(t, out, 600 + (Math.random() - 0.5) * 150); break;
      case 'select': this.synthSelect(t, out); break;
      case 'unit_lost': this.synthUnitLost(t, out); break;
      case 'building_explode': this.synthBuildingExplode(t, out); break;
      case 'heal': this.synthHeal(t, out); break;
    }
  }

  /** Map weapon name to sound */
  weaponSound(weaponName: string): SoundName {
    switch (weaponName) {
      case 'Mandible': return 'mandible';
      case 'TeslaZap': case 'TeslaCannon': return 'teslazap';
      case 'FireballLauncher': return 'fireball';
      case 'Flamethrower': return 'flamethrower';
      case 'Rifle': return 'rifle';
      case 'MachineGun': return 'machinegun';
      case 'TankGun': case 'MammothTusk': return 'cannon';
      case 'ArtilleryShell': return 'artillery';
      case 'Grenade': return 'grenade';
      case 'Bazooka': return 'bazooka';
      case 'DogJaw': return 'dogjaw';
      default: return 'rifle';
    }
  }

  destroy(): void {
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
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
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
    const pitchVar = 1 + (Math.random() - 0.5) * 0.15;
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
}
