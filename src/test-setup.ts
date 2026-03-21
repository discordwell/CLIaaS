import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// ── Global audio suppression ────────────────────────────────────────────
// Prevent ANY test from accidentally playing real audio through speakers.
// Individual test files can override with vi.stubGlobal() if they need
// specific mock behavior (e.g. audio-pipeline.test.ts).

vi.stubGlobal('Audio', class SilentAudio {
  src = '';
  volume = 0;
  preload = '';
  currentTime = 0;
  muted = true;
  loop = false;
  addEventListener(): void {}
  removeEventListener(): void {}
  play(): Promise<void> { return Promise.resolve(); }
  pause(): void {}
  cloneNode(): SilentAudio { return new SilentAudio(); }
});

vi.stubGlobal('AudioContext', class SilentAudioContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 44100;
  destination = {};
  resume(): Promise<void> { return Promise.resolve(); }
  close(): Promise<void> { return Promise.resolve(); }
  createGain() {
    return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() { return this; }, disconnect() {} };
  }
  createBufferSource() {
    return { buffer: null, loop: false, connect() { return this; }, start() {}, stop() {}, disconnect() {}, addEventListener() {} };
  }
  createOscillator() {
    return { type: 'sine', frequency: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() { return this; }, start() {}, stop() {}, disconnect() {} };
  }
  createBiquadFilter() {
    return { type: 'lowpass', frequency: { value: 350, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: { value: 1 }, connect() { return this; }, disconnect() {} };
  }
  createStereoPanner() {
    return { pan: { value: 0 }, connect() { return this; }, disconnect() {} };
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const arrays = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (ch: number) => arrays[ch] };
  }
  decodeAudioData() {
    const buf = new Float32Array(1024);
    return Promise.resolve({ numberOfChannels: 1, length: 1024, sampleRate: 22050, duration: 1024 / 22050, getChannelData: () => buf });
  }
});
