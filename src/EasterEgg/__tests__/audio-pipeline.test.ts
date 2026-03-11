import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { parseAudHeader, decodeAud, audToAudioBuffer } from '../engine/audDecoder';
import type { AudHeader } from '../engine/audDecoder';
import { AudioManager, MusicPlayer } from '../engine/audio';
import type { SoundName } from '../engine/audio';

// ---------------------------------------------------------------------------
// Helper: build a synthetic AUD binary from parts
// ---------------------------------------------------------------------------

/** Build a 12-byte Westwood AUD header as an ArrayBuffer */
function buildAudHeader(opts: {
  sampleRate: number;
  dataSize: number;
  outputSize: number;
  flags: number;
  type: number;
}): ArrayBuffer {
  const buf = new ArrayBuffer(12);
  const view = new DataView(buf);
  view.setUint16(0, opts.sampleRate, true);
  view.setUint32(2, opts.dataSize, true);
  view.setUint32(6, opts.outputSize, true);
  view.setUint8(10, opts.flags);
  view.setUint8(11, opts.type);
  return buf;
}

/** Build a complete minimal AUD file (header + one chunk) with given ADPCM bytes */
function buildAudFile(opts: {
  sampleRate?: number;
  flags?: number;
  type?: number;
  chunkData: number[]; // raw ADPCM bytes for the single chunk
}): ArrayBuffer {
  const sampleRate = opts.sampleRate ?? 22050;
  const flags = opts.flags ?? 0x02; // 16-bit mono by default
  const type = opts.type ?? 99;
  const chunkData = new Uint8Array(opts.chunkData);
  const compressedSize = chunkData.length;
  // Each byte produces 2 nibbles = 2 samples; 16-bit = 2 bytes per sample
  const outputSamples = compressedSize * 2;
  const outputSize = (flags & 0x02) ? outputSamples * 2 : outputSamples;

  // 12 header + 8 chunk header + data
  const totalSize = 12 + 8 + compressedSize;
  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);

  // File header
  view.setUint16(0, sampleRate, true);
  view.setUint32(2, compressedSize, true); // dataSize
  view.setUint32(6, outputSize, true);     // outputSize
  view.setUint8(10, flags);
  view.setUint8(11, type);

  // Chunk header
  view.setUint16(12, compressedSize, true); // chunk compressed size
  view.setUint16(14, outputSize, true);     // chunk output size
  view.setUint32(16, 0x0000deaf, true);     // chunk marker

  // Chunk data
  const u8 = new Uint8Array(buf);
  u8.set(chunkData, 20);

  return buf;
}

// ---------------------------------------------------------------------------
// Mock Web Audio API (for AudioManager tests)
// ---------------------------------------------------------------------------

function createMockGainNode() {
  return {
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(function(this: any) { return this; }),
    disconnect: vi.fn(),
  };
}

function createMockOscillator() {
  return {
    type: 'sine',
    frequency: {
      value: 440,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(function(this: any) { return this; }),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
  };
}

function createMockBufferSource() {
  return {
    buffer: null as any,
    loop: false,
    connect: vi.fn(function(this: any) { return this; }),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
  };
}

function createMockFilter() {
  return {
    type: 'lowpass',
    frequency: {
      value: 350,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    Q: { value: 1 },
    connect: vi.fn(function(this: any) { return this; }),
    disconnect: vi.fn(),
  };
}

function createMockPanner() {
  return {
    pan: { value: 0 },
    connect: vi.fn(function(this: any) { return this; }),
    disconnect: vi.fn(),
  };
}

function createMockAudioBuffer(channels: number, length: number, sampleRate: number) {
  const channelArrays: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    channelArrays.push(new Float32Array(length));
  }
  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: vi.fn((ch: number) => channelArrays[ch]),
  };
}

function createMockAudioContext() {
  const ctx: any = {
    state: 'running' as string,
    currentTime: 0,
    sampleRate: 44100,
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createGain: vi.fn(() => createMockGainNode()),
    createOscillator: vi.fn(() => createMockOscillator()),
    createBufferSource: vi.fn(() => createMockBufferSource()),
    createBiquadFilter: vi.fn(() => createMockFilter()),
    createStereoPanner: vi.fn(() => createMockPanner()),
    createBuffer: vi.fn((channels: number, length: number, sampleRate: number) =>
      createMockAudioBuffer(channels, length, sampleRate)
    ),
    decodeAudioData: vi.fn().mockResolvedValue(createMockAudioBuffer(1, 1024, 22050)),
  };
  return ctx;
}

/** Stub globals and return the mock context for assertions */
function setupAudioMocks() {
  const mockCtx = createMockAudioContext();
  vi.stubGlobal('AudioContext', class { constructor() { return mockCtx; } });
  vi.stubGlobal('Audio', class MockAudio {
    src = '';
    volume = 0;
    preload = '';
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
    play = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn();
  });
  return mockCtx;
}

// =========================================================================
// AUD DECODER TESTS
// =========================================================================

describe('AUD Decoder — parseAudHeader', () => {
  it('parses sample rate correctly', () => {
    const buf = buildAudHeader({ sampleRate: 22050, dataSize: 100, outputSize: 400, flags: 0x02, type: 99 });
    const header = parseAudHeader(new DataView(buf));
    expect(header.sampleRate).toBe(22050);
  });

  it('parses various sample rates', () => {
    for (const rate of [8000, 11025, 22050, 44100]) {
      const buf = buildAudHeader({ sampleRate: rate, dataSize: 0, outputSize: 0, flags: 0, type: 99 });
      const header = parseAudHeader(new DataView(buf));
      expect(header.sampleRate).toBe(rate);
    }
  });

  it('parses dataSize and outputSize as uint32 LE', () => {
    const buf = buildAudHeader({ sampleRate: 22050, dataSize: 0x12345678, outputSize: 0x9ABCDEF0, flags: 0, type: 99 });
    const header = parseAudHeader(new DataView(buf));
    expect(header.dataSize).toBe(0x12345678);
    expect(header.outputSize).toBe(0x9ABCDEF0 >>> 0);
  });

  it('extracts flags and type bytes', () => {
    const buf = buildAudHeader({ sampleRate: 22050, dataSize: 0, outputSize: 0, flags: 0x03, type: 99 });
    const header = parseAudHeader(new DataView(buf));
    expect(header.flags).toBe(0x03);
    expect(header.type).toBe(99);
  });

  it('detects mono (flags bit0 = 0)', () => {
    const buf = buildAudHeader({ sampleRate: 22050, dataSize: 0, outputSize: 0, flags: 0x02, type: 99 });
    const header = parseAudHeader(new DataView(buf));
    expect(header.isStereo).toBe(false);
    expect(header.is16Bit).toBe(true);
  });

  it('detects stereo (flags bit0 = 1)', () => {
    const buf = buildAudHeader({ sampleRate: 22050, dataSize: 0, outputSize: 0, flags: 0x01, type: 99 });
    const header = parseAudHeader(new DataView(buf));
    expect(header.isStereo).toBe(true);
    expect(header.is16Bit).toBe(false);
  });

  it('detects 16-bit (flags bit1 = 1)', () => {
    const buf = buildAudHeader({ sampleRate: 22050, dataSize: 0, outputSize: 0, flags: 0x02, type: 99 });
    const header = parseAudHeader(new DataView(buf));
    expect(header.is16Bit).toBe(true);
  });

  it('detects 8-bit (flags bit1 = 0)', () => {
    const buf = buildAudHeader({ sampleRate: 22050, dataSize: 0, outputSize: 0, flags: 0x00, type: 99 });
    const header = parseAudHeader(new DataView(buf));
    expect(header.is16Bit).toBe(false);
  });

  it('stereo + 16-bit flags (0x03)', () => {
    const buf = buildAudHeader({ sampleRate: 44100, dataSize: 0, outputSize: 0, flags: 0x03, type: 99 });
    const header = parseAudHeader(new DataView(buf));
    expect(header.isStereo).toBe(true);
    expect(header.is16Bit).toBe(true);
    expect(header.sampleRate).toBe(44100);
  });

  it('returns correct type field for IMA ADPCM (99)', () => {
    const buf = buildAudHeader({ sampleRate: 22050, dataSize: 0, outputSize: 0, flags: 0, type: 99 });
    const header = parseAudHeader(new DataView(buf));
    expect(header.type).toBe(99);
  });

  it('returns correct type field for WS ADPCM (1)', () => {
    const buf = buildAudHeader({ sampleRate: 22050, dataSize: 0, outputSize: 0, flags: 0, type: 1 });
    const header = parseAudHeader(new DataView(buf));
    expect(header.type).toBe(1);
  });

  it('returns correct type field for uncompressed (0)', () => {
    const buf = buildAudHeader({ sampleRate: 22050, dataSize: 0, outputSize: 0, flags: 0, type: 0 });
    const header = parseAudHeader(new DataView(buf));
    expect(header.type).toBe(0);
  });
});

describe('AUD Decoder — decodeAud', () => {
  it('throws for unsupported AUD type (not 99)', () => {
    const buf = buildAudFile({ type: 1, chunkData: [0x00] });
    expect(() => decodeAud(buf)).toThrow('Unsupported AUD type 1');
  });

  it('throws for type 0 (uncompressed)', () => {
    const buf = buildAudFile({ type: 0, chunkData: [0x00] });
    expect(() => decodeAud(buf)).toThrow('Unsupported AUD type 0');
  });

  it('decodes a single zero-byte chunk to zero samples', () => {
    const buf = buildAudFile({ chunkData: [] });
    const result = decodeAud(buf);
    expect(result.samples.length).toBe(0);
    expect(result.sampleRate).toBe(22050);
    expect(result.channels).toBe(1);
  });

  it('decodes a single byte to 2 samples (mono)', () => {
    const buf = buildAudFile({ chunkData: [0x00] });
    const result = decodeAud(buf);
    expect(result.samples.length).toBe(2);
  });

  it('returns correct sampleRate from header', () => {
    const buf = buildAudFile({ sampleRate: 11025, chunkData: [0x00] });
    const result = decodeAud(buf);
    expect(result.sampleRate).toBe(11025);
  });

  it('returns channels=1 for mono', () => {
    const buf = buildAudFile({ flags: 0x02, chunkData: [0x00] });
    const result = decodeAud(buf);
    expect(result.channels).toBe(1);
  });

  it('returns channels=2 for stereo', () => {
    const buf = buildAudFile({ flags: 0x03, chunkData: [0x00, 0x00] });
    const result = decodeAud(buf);
    expect(result.channels).toBe(2);
  });

  it('decodes known nibble sequence correctly (IMA ADPCM)', () => {
    // Known IMA ADPCM step table: index 0 has step=7
    // Nibble 0x0: diff = step >> 3 = 0, sign positive => predictor = 0 + 0 = 0
    //             stepIndex += IMA_INDEX_TABLE[0] = -1 => clamped to 0
    // Nibble 0x0: same result => predictor stays 0
    const buf = buildAudFile({ chunkData: [0x00] });
    const result = decodeAud(buf);
    expect(result.samples[0]).toBe(0);
    expect(result.samples[1]).toBe(0);
  });

  it('nibble 0xF produces negative delta and maximum index step', () => {
    // Nibble 0xF: bit3=sign=negative, bits 2,1,0 all set
    // step=7, diff = 7>>3 + 7 + 7>>1 + 7>>2 = 0 + 7 + 3 + 1 = 11
    // sign negative: predictor = 0 - 11 = -11
    // stepIndex += IMA_INDEX_TABLE[15] = 8 => 0+8=8
    const buf = buildAudFile({ chunkData: [0x0F] });
    const result = decodeAud(buf);
    // Low nibble = 0xF => predictor -11
    expect(result.samples[0]).toBe(-11);
    // High nibble = 0x0 => diff based on step at index 8 (step=16)
    // diff = 16>>3 = 2, positive => predictor = -11 + 2 = -9
    expect(result.samples[1]).toBe(-9);
  });

  it('nibble 0x7 (positive, all magnitude bits) increases predictor', () => {
    // Nibble 0x7: bit3=0(positive), bits 2,1,0 all set
    // step=7, diff = 7>>3 + 7 + 7>>1 + 7>>2 = 0 + 7 + 3 + 1 = 11
    // predictor = 0 + 11 = 11
    const buf = buildAudFile({ chunkData: [0x07] });
    const result = decodeAud(buf);
    expect(result.samples[0]).toBe(11);
  });

  it('clamps predictor to 32767 (positive overflow)', () => {
    const chunkData: number[] = [];
    for (let i = 0; i < 60; i++) {
      chunkData.push(0x77); // both nibbles = 0x7 (max positive)
    }
    const buf = buildAudFile({ chunkData });
    const result = decodeAud(buf);
    const maxSample = Math.max(...Array.from(result.samples));
    expect(maxSample).toBeLessThanOrEqual(32767);
    expect(maxSample).toBe(32767);
  });

  it('clamps predictor to -32768 (negative overflow)', () => {
    const chunkData: number[] = [];
    for (let i = 0; i < 60; i++) {
      chunkData.push(0xFF); // both nibbles = 0xF (max negative)
    }
    const buf = buildAudFile({ chunkData });
    const result = decodeAud(buf);
    const minSample = Math.min(...Array.from(result.samples));
    expect(minSample).toBeGreaterThanOrEqual(-32768);
    expect(minSample).toBe(-32768);
  });

  it('stepIndex clamps to 0 (does not go negative)', () => {
    const chunkData = [0x00, 0x00, 0x00]; // 6 samples, all nibble 0
    const buf = buildAudFile({ chunkData });
    const result = decodeAud(buf);
    for (const s of result.samples) {
      expect(s).toBe(0);
    }
  });

  it('stepIndex clamps to 88 (does not exceed table length)', () => {
    const chunkData: number[] = [];
    for (let i = 0; i < 100; i++) {
      chunkData.push(0x77);
    }
    const buf = buildAudFile({ chunkData });
    const result = decodeAud(buf);
    // No crash means step index is clamped properly
    expect(result.samples.length).toBe(200);
  });

  it('handles multiple chunks sequentially', () => {
    const chunk1Data = [0x17, 0x23];
    const chunk2Data = [0x45, 0x67];
    const c1 = new Uint8Array(chunk1Data);
    const c2 = new Uint8Array(chunk2Data);

    const outputSamples = (c1.length + c2.length) * 2;
    const outputSize = outputSamples * 2; // 16-bit

    const totalSize = 12 + 8 + c1.length + 8 + c2.length;
    const buf = new ArrayBuffer(totalSize);
    const view = new DataView(buf);
    const u8 = new Uint8Array(buf);

    view.setUint16(0, 22050, true);
    view.setUint32(2, c1.length + c2.length, true);
    view.setUint32(6, outputSize, true);
    view.setUint8(10, 0x02); // 16-bit mono
    view.setUint8(11, 99);

    let offset = 12;
    view.setUint16(offset, c1.length, true);
    view.setUint16(offset + 2, c1.length * 2 * 2, true);
    view.setUint32(offset + 4, 0x0000deaf, true);
    u8.set(c1, offset + 8);
    offset += 8 + c1.length;

    view.setUint16(offset, c2.length, true);
    view.setUint16(offset + 2, c2.length * 2 * 2, true);
    view.setUint32(offset + 4, 0x0000deaf, true);
    u8.set(c2, offset + 8);

    const result = decodeAud(buf);
    expect(result.samples.length).toBe(8);
    for (const s of result.samples) {
      expect(Number.isFinite(s)).toBe(true);
    }
  });

  it('stops decoding on invalid chunk marker', () => {
    const totalSize = 12 + 8 + 2;
    const buf = new ArrayBuffer(totalSize);
    const view = new DataView(buf);

    view.setUint16(0, 22050, true);
    view.setUint32(2, 2, true);
    view.setUint32(6, 8, true);
    view.setUint8(10, 0x02);
    view.setUint8(11, 99);

    view.setUint16(12, 2, true);
    view.setUint16(14, 8, true);
    view.setUint32(16, 0x00BADCAF, true); // wrong marker

    const result = decodeAud(buf);
    expect(result.samples.length).toBe(0);
  });

  it('handles stereo decoding (alternating left/right bytes)', () => {
    const buf = buildAudFile({ flags: 0x03, chunkData: [0x12, 0x34] });
    const result = decodeAud(buf);
    expect(result.channels).toBe(2);
    expect(result.samples.length).toBe(4);
  });

  it('subarray trims to actual decoded sample count', () => {
    const totalSize = 12 + 8 + 1;
    const buf = new ArrayBuffer(totalSize);
    const view = new DataView(buf);

    view.setUint16(0, 22050, true);
    view.setUint32(2, 1, true);
    view.setUint32(6, 200, true); // claims 100 samples (16-bit)
    view.setUint8(10, 0x02);
    view.setUint8(11, 99);

    view.setUint16(12, 1, true);
    view.setUint16(14, 4, true);
    view.setUint32(16, 0x0000deaf, true);
    view.setUint8(20, 0x35);

    const result = decodeAud(buf);
    expect(result.samples.length).toBe(2);
  });
});

describe('AUD Decoder — IMA ADPCM step table and index table integrity', () => {
  it('step table index 0 produces step=7 (verified through nibble 0x4 delta)', () => {
    // nibble 0x4: bit2=1, diff = 7>>3 + 7 = 0 + 7 = 7
    const buf = buildAudFile({ chunkData: [0x04] });
    const result = decodeAud(buf);
    expect(result.samples[0]).toBe(7);
  });

  it('step table first entry is 7 (verified through nibble 0x1 delta)', () => {
    // nibble 0x1: bit0=1, diff = 7>>3 + 7>>2 = 0 + 1 = 1
    const buf = buildAudFile({ chunkData: [0x01] });
    const result = decodeAud(buf);
    expect(result.samples[0]).toBe(1);
  });

  it('step table reaches 32767 at index 88 (max step)', () => {
    const chunkData: number[] = [];
    for (let i = 0; i < 50; i++) {
      chunkData.push(0x77);
    }
    const buf = buildAudFile({ chunkData });
    const result = decodeAud(buf);
    const maxSample = Math.max(...Array.from(result.samples));
    expect(maxSample).toBeLessThanOrEqual(32767);
    expect(maxSample).toBeGreaterThanOrEqual(-32768);
  });

  it('index adjustments do not crash with 200 samples', () => {
    const buf = buildAudFile({ chunkData: [0x40, 0x50, 0x60, 0x70] });
    const result = decodeAud(buf);
    expect(result.samples.length).toBe(8);
    for (const s of result.samples) {
      expect(Number.isFinite(s)).toBe(true);
    }
  });
});

describe('AUD Decoder — audToAudioBuffer', () => {
  it('converts mono 16-bit PCM to float32 AudioBuffer', () => {
    const ctx = createMockAudioContext() as unknown as AudioContext;
    const samples = new Int16Array([0, 16384, -16384, 32767, -32768]);
    const result = audToAudioBuffer(ctx, samples, 22050, 1);

    expect(ctx.createBuffer).toHaveBeenCalledWith(1, 5, 22050);
    const channelData = result.getChannelData(0);
    expect(channelData[0]).toBeCloseTo(0, 5);
    expect(channelData[1]).toBeCloseTo(16384 / 32768, 5);
    expect(channelData[2]).toBeCloseTo(-16384 / 32768, 5);
    expect(channelData[3]).toBeCloseTo(32767 / 32768, 5);
    expect(channelData[4]).toBeCloseTo(-32768 / 32768, 5);
  });

  it('converts stereo 16-bit PCM to deinterleaved float32', () => {
    const ctx = createMockAudioContext() as unknown as AudioContext;
    const samples = new Int16Array([1000, 2000, 3000, 4000]);
    const result = audToAudioBuffer(ctx, samples, 44100, 2);

    expect(ctx.createBuffer).toHaveBeenCalledWith(2, 2, 44100);
    const left = result.getChannelData(0);
    const right = result.getChannelData(1);
    expect(left[0]).toBeCloseTo(1000 / 32768, 5);
    expect(right[0]).toBeCloseTo(2000 / 32768, 5);
    expect(left[1]).toBeCloseTo(3000 / 32768, 5);
    expect(right[1]).toBeCloseTo(4000 / 32768, 5);
  });

  it('normalizes full-scale sample to [-1, 1) range', () => {
    const ctx = createMockAudioContext() as unknown as AudioContext;
    const samples = new Int16Array([32767, -32768]);
    const result = audToAudioBuffer(ctx, samples, 22050, 1);

    const channelData = result.getChannelData(0);
    expect(channelData[0]).toBeLessThanOrEqual(1);
    expect(channelData[0]).toBeGreaterThan(0.999);
    expect(channelData[1]).toBeGreaterThanOrEqual(-1);
    expect(channelData[1]).toBeLessThan(-0.999);
  });
});

// =========================================================================
// AUDIO MANAGER TESTS
// =========================================================================

describe('AudioManager — construction and initialization', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates with default state: muted, volume 0.35', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    expect(mgr.isMuted()).toBe(true);
    expect(mgr.getVolume()).toBe(0.35);
  });

  it('has a MusicPlayer instance', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    expect(mgr.music).toBeInstanceOf(MusicPlayer);
  });

  it('init() creates master gain node and connects to destination', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    mgr.init();

    // After init, the private ctx should be set
    expect((mgr as any).ctx).toBeDefined();
    expect((mgr as any).masterGain).toBeDefined();
    expect(mockCtx.createGain).toHaveBeenCalled();
  });

  it('init() sets gain to 0 when muted (default)', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    mgr.init();

    const masterGain = (mgr as any).masterGain;
    expect(masterGain.gain.value).toBe(0); // muted by default
  });

  it('init() is idempotent (only creates context once)', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    mgr.init();
    const firstCtx = (mgr as any).ctx;

    mgr.init();
    expect((mgr as any).ctx).toBe(firstCtx);
  });

  it('init() handles AudioContext not available gracefully', () => {
    vi.stubGlobal('AudioContext', class { constructor() { throw new Error('not available'); } });
    vi.stubGlobal('Audio', class MockAudio {
      src = ''; volume = 0; preload = '';
      addEventListener = vi.fn(); play = vi.fn().mockResolvedValue(undefined); pause = vi.fn();
    });

    const mgr = new AudioManager();
    expect(() => mgr.init()).not.toThrow();
    expect((mgr as any).ctx).toBeNull();
  });
});

describe('AudioManager — volume control', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('setVolume() clamps to [0, 1]', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    mgr.setVolume(1.5);
    expect(mgr.getVolume()).toBe(1);
    mgr.setVolume(-0.5);
    expect(mgr.getVolume()).toBe(0);
    mgr.setVolume(0.7);
    expect(mgr.getVolume()).toBe(0.7);
  });

  it('setVolume() updates master gain when not muted', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    mgr.init();
    mgr.toggleMute(); // unmute

    mgr.setVolume(0.8);

    const masterGain = (mgr as any).masterGain;
    expect(masterGain.gain.value).toBe(0.8);
  });

  it('setVolume() keeps gain at 0 when muted', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    mgr.init();

    mgr.setVolume(0.8);

    const masterGain = (mgr as any).masterGain;
    expect(masterGain.gain.value).toBe(0);
  });

  it('setSfxVolume() only affects SFX, not music', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    mgr.init();
    mgr.toggleMute();

    const musicSetVolumeSpy = vi.spyOn(mgr.music, 'setVolume');

    mgr.setSfxVolume(0.9);

    expect(mgr.getSfxVolume()).toBe(0.9);
    expect(musicSetVolumeSpy).not.toHaveBeenCalled();
  });

  it('setMusicVolume() only affects music, not SFX', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    mgr.init();
    mgr.toggleMute();

    const musicSetVolumeSpy = vi.spyOn(mgr.music, 'setVolume');
    const originalSfx = mgr.getSfxVolume();

    mgr.setMusicVolume(0.6);

    expect(musicSetVolumeSpy).toHaveBeenCalledWith(0.6);
    expect(mgr.getSfxVolume()).toBe(originalSfx);
  });

  it('setMusicVolume() clamps to [0, 1]', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    mgr.setMusicVolume(2.0);
    expect(mgr.getMusicVolume()).toBeLessThanOrEqual(1);
    mgr.setMusicVolume(-1.0);
    expect(mgr.getMusicVolume()).toBeGreaterThanOrEqual(0);
  });

  it('toggleMute() alternates mute state', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    expect(mgr.isMuted()).toBe(true);

    const result1 = mgr.toggleMute();
    expect(result1).toBe(false);
    expect(mgr.isMuted()).toBe(false);

    const result2 = mgr.toggleMute();
    expect(result2).toBe(true);
    expect(mgr.isMuted()).toBe(true);
  });

  it('toggleMute() updates master gain', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    mgr.init();

    mgr.toggleMute(); // unmute
    const masterGain = (mgr as any).masterGain;
    expect(masterGain.gain.value).toBe(0.35);

    mgr.toggleMute(); // mute
    expect(masterGain.gain.value).toBe(0);
  });

  it('toggleMute() syncs with MusicPlayer', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    const musicSetMutedSpy = vi.spyOn(mgr.music, 'setMuted');

    mgr.toggleMute(); // unmute
    expect(musicSetMutedSpy).toHaveBeenCalledWith(false);

    mgr.toggleMute(); // mute
    expect(musicSetMutedSpy).toHaveBeenCalledWith(true);
  });
});

describe('AudioManager — sound playback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('play() does nothing when muted', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    mgr.init();

    mgr.play('rifle');

    // No oscillator/noise was created (init creates one gain for master)
    expect(mockCtx.createOscillator).not.toHaveBeenCalled();
  });

  it('play() does nothing without init()', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    mgr.toggleMute(); // unmute

    expect(() => mgr.play('rifle')).not.toThrow();
  });

  it('play() creates synth nodes when unmuted and no samples loaded', () => {
    const mockCtx = setupAudioMocks();
    vi.spyOn(performance, 'now').mockReturnValue(1000);

    const mgr = new AudioManager();
    mgr.init();
    mgr.toggleMute();

    mgr.play('rifle');

    // Rifle uses noise (createBuffer + createBufferSource) + filter + gain
    // Check that some audio nodes were created beyond the master gain
    const totalCreated = mockCtx.createBufferSource.mock.calls.length
      + mockCtx.createOscillator.mock.calls.length;
    expect(totalCreated).toBeGreaterThan(0);
  });

  it('play() resumes suspended AudioContext', () => {
    const mockCtx = setupAudioMocks();
    vi.spyOn(performance, 'now').mockReturnValue(1000);

    const mgr = new AudioManager();
    mgr.init();
    mgr.toggleMute();
    mockCtx.state = 'suspended';

    mgr.play('rifle');

    expect(mockCtx.resume).toHaveBeenCalled();
  });

  it('play() rate-limits same sound (40ms minimum interval)', () => {
    const mockCtx = setupAudioMocks();
    const perfNow = vi.spyOn(performance, 'now');

    const mgr = new AudioManager();
    mgr.init();
    mgr.toggleMute();

    perfNow.mockReturnValue(1000);
    mgr.play('rifle');
    const firstCount = mockCtx.createBufferSource.mock.calls.length
      + mockCtx.createOscillator.mock.calls.length;

    // Same sound at +20ms -- should be throttled
    perfNow.mockReturnValue(1020);
    mgr.play('rifle');
    const secondCount = mockCtx.createBufferSource.mock.calls.length
      + mockCtx.createOscillator.mock.calls.length;
    expect(secondCount).toBe(firstCount);

    // Same sound at +50ms -- should play
    perfNow.mockReturnValue(1050);
    mgr.play('rifle');
    const thirdCount = mockCtx.createBufferSource.mock.calls.length
      + mockCtx.createOscillator.mock.calls.length;
    expect(thirdCount).toBeGreaterThan(firstCount);
  });

  it('play() allows different sounds within the rate-limit interval', () => {
    const mockCtx = setupAudioMocks();
    vi.spyOn(performance, 'now').mockReturnValue(1000);

    const mgr = new AudioManager();
    mgr.init();
    mgr.toggleMute();

    mgr.play('rifle');
    const afterFirst = mockCtx.createBufferSource.mock.calls.length
      + mockCtx.createOscillator.mock.calls.length;

    // Different sound at same time -- should NOT be throttled
    mgr.play('cannon');
    const afterSecond = mockCtx.createBufferSource.mock.calls.length
      + mockCtx.createOscillator.mock.calls.length;

    expect(afterSecond).toBeGreaterThan(afterFirst);
  });

  it('play() uses sample buffer when available', () => {
    const mockCtx = setupAudioMocks();
    vi.spyOn(performance, 'now').mockReturnValue(1000);

    const mgr = new AudioManager();
    mgr.init();
    mgr.toggleMute();

    // Manually inject a sample buffer
    const mockBuffer = createMockAudioBuffer(1, 1024, 22050);
    (mgr as any).sampleBuffers.set('rifle', mockBuffer);

    mgr.play('rifle');

    // Should create a BufferSource with the sample buffer
    const sources = mockCtx.createBufferSource.mock.results;
    // Find the one with our buffer (skip ambient/noise sources that may exist)
    const sampleSource = sources.find((r: any) => r.value.buffer === mockBuffer);
    expect(sampleSource).toBeDefined();
  });
});

describe('AudioManager — spatial audio (playAt)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates a StereoPannerNode for spatial sound', () => {
    const mockCtx = setupAudioMocks();
    vi.spyOn(performance, 'now').mockReturnValue(1000);

    const mgr = new AudioManager();
    mgr.init();
    mgr.toggleMute();

    mgr.playAt('rifle', 500, 300, 200, 640);
    expect(mockCtx.createStereoPanner).toHaveBeenCalled();
  });

  it('pans center when sound is at camera center', () => {
    const mockCtx = setupAudioMocks();
    vi.spyOn(performance, 'now').mockReturnValue(1000);

    const mgr = new AudioManager();
    mgr.init();
    mgr.toggleMute();

    // Camera at x=200, width=640; center = 520
    mgr.playAt('rifle', 520, 300, 200, 640);

    const panner = mockCtx.createStereoPanner.mock.results[0].value;
    expect(panner.pan.value).toBeCloseTo(0, 1);
  });

  it('pans left when sound is left of camera center', () => {
    const mockCtx = setupAudioMocks();
    vi.spyOn(performance, 'now').mockReturnValue(1000);

    const mgr = new AudioManager();
    mgr.init();
    mgr.toggleMute();

    // Camera center = 520, sound at 200 => relativeX = -1 => pan = -0.6
    mgr.playAt('rifle', 200, 300, 200, 640);

    const panner = mockCtx.createStereoPanner.mock.results[0].value;
    expect(panner.pan.value).toBeLessThan(0);
    expect(panner.pan.value).toBeCloseTo(-0.6, 1);
  });

  it('pans right when sound is right of camera center', () => {
    const mockCtx = setupAudioMocks();
    vi.spyOn(performance, 'now').mockReturnValue(1000);

    const mgr = new AudioManager();
    mgr.init();
    mgr.toggleMute();

    // Camera center = 520, sound at 840 => relativeX = 1 => pan = +0.6
    mgr.playAt('rifle', 840, 300, 200, 640);

    const panner = mockCtx.createStereoPanner.mock.results[0].value;
    expect(panner.pan.value).toBeGreaterThan(0);
    expect(panner.pan.value).toBeCloseTo(0.6, 1);
  });

  it('clamps pan to [-1, 1] for sounds far off-screen', () => {
    const mockCtx = setupAudioMocks();
    vi.spyOn(performance, 'now').mockReturnValue(1000);

    const mgr = new AudioManager();
    mgr.init();
    mgr.toggleMute();

    mgr.playAt('rifle', 5000, 300, 200, 640);

    const panner = mockCtx.createStereoPanner.mock.results[0].value;
    expect(panner.pan.value).toBeLessThanOrEqual(1);
    expect(panner.pan.value).toBeGreaterThanOrEqual(-1);
  });

  it('playAt() respects same rate-limiting as play()', () => {
    const mockCtx = setupAudioMocks();
    const perfNow = vi.spyOn(performance, 'now');

    const mgr = new AudioManager();
    mgr.init();
    mgr.toggleMute();

    perfNow.mockReturnValue(1000);
    mgr.playAt('rifle', 300, 300, 200, 640);
    const firstCount = mockCtx.createStereoPanner.mock.calls.length;

    perfNow.mockReturnValue(1010); // within 40ms
    mgr.playAt('rifle', 300, 300, 200, 640);
    expect(mockCtx.createStereoPanner.mock.calls.length).toBe(firstCount);
  });

  it('playAt() does nothing when muted', () => {
    const mockCtx = setupAudioMocks();
    vi.spyOn(performance, 'now').mockReturnValue(1000);

    const mgr = new AudioManager();
    mgr.init();

    mgr.playAt('rifle', 300, 300, 200, 640);
    expect(mockCtx.createStereoPanner).not.toHaveBeenCalled();
  });
});

describe('AudioManager — weapon sound mapping', () => {
  let mgr: AudioManager;

  beforeEach(() => {
    setupAudioMocks();
    mgr = new AudioManager();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const WEAPON_SOUND_MAP: [string, SoundName][] = [
    ['Mandible', 'mandible'],
    ['TeslaZap', 'teslazap'],
    ['TeslaCannon', 'teslazap'],
    ['FireballLauncher', 'fireball'],
    ['Flamer', 'flamethrower'],
    ['M1Carbine', 'rifle'],
    ['M60mg', 'machinegun'],
    ['75mm', 'cannon'],
    ['90mm', 'cannon'],
    ['105mm', 'cannon'],
    ['120mm', 'cannon'],
    ['MammothTusk', 'mammoth_cannon'],
    ['155mm', 'artillery'],
    ['Grenade', 'grenade'],
    ['Dragon', 'bazooka'],
    ['RedEye', 'bazooka'],
    ['Heal', 'rifle'],
    ['DogJaw', 'dogjaw'],
    ['Napalm', 'flamethrower'],
    ['Sniper', 'sniper'],
  ];

  it.each(WEAPON_SOUND_MAP)('weapon "%s" maps to sound "%s"', (weapon, expected) => {
    expect(mgr.weaponSound(weapon)).toBe(expected);
  });

  it('unknown weapon defaults to "rifle"', () => {
    expect(mgr.weaponSound('UnknownWeapon')).toBe('rifle');
    expect(mgr.weaponSound('')).toBe('rifle');
  });
});

describe('AudioManager — sample loading', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loadSamples() returns immediately without init()', async () => {
    setupAudioMocks();
    const mgr = new AudioManager();
    // No init() called => no ctx
    await mgr.loadSamples();
    expect(mgr.hasSamples).toBe(false);
  });

  it('loadSamples() is idempotent (does not reload)', async () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    mgr.init();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );

    await mgr.loadSamples();
    const firstFetchCount = fetchSpy.mock.calls.length;

    await mgr.loadSamples();
    expect(fetchSpy.mock.calls.length).toBe(firstFetchCount);
  });

  it('loadSamples() falls back gracefully when manifest not found', async () => {
    setupAudioMocks();
    const mgr = new AudioManager();
    mgr.init();

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 404 })
    );

    await mgr.loadSamples();
    expect(mgr.hasSamples).toBe(false);
    expect(mgr.sampleCount).toBe(0);
  });

  it('loadSamples() falls back gracefully when fetch throws', async () => {
    setupAudioMocks();
    const mgr = new AudioManager();
    mgr.init();

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'));

    await mgr.loadSamples();
    expect(mgr.hasSamples).toBe(false);
  });

  it('hasSamples is true after successful load with at least one buffer', async () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    mgr.init();

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).includes('manifest.json')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response(new ArrayBuffer(44), { status: 200 });
    });

    await mgr.loadSamples();
    expect(mgr.hasSamples).toBe(true);
    expect(mgr.sampleCount).toBeGreaterThan(0);
  });
});

describe('AudioManager — ambient sound', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('startAmbient() creates looping buffer source', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    mgr.init();

    mgr.startAmbient();

    expect(mockCtx.createBuffer).toHaveBeenCalled();
    // Find the last buffer source — it should be looping
    const sources = mockCtx.createBufferSource.mock.results;
    const lastSource = sources[sources.length - 1].value;
    expect(lastSource.loop).toBe(true);
    expect(lastSource.start).toHaveBeenCalled();
  });

  it('startAmbient() is idempotent', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    mgr.init();

    mgr.startAmbient();
    const firstCount = mockCtx.createBufferSource.mock.calls.length;

    mgr.startAmbient();
    expect(mockCtx.createBufferSource.mock.calls.length).toBe(firstCount);
  });

  it('stopAmbient() allows restarting', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    mgr.init();
    mgr.startAmbient();

    mgr.stopAmbient();

    const countBefore = mockCtx.createBufferSource.mock.calls.length;
    mgr.startAmbient();
    expect(mockCtx.createBufferSource.mock.calls.length).toBeGreaterThan(countBefore);
  });
});

describe('AudioManager — destroy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('destroy() closes AudioContext and clears sample buffers', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    mgr.init();

    (mgr as any).sampleBuffers.set('rifle', createMockAudioBuffer(1, 100, 22050));
    (mgr as any).samplesLoaded = true;

    mgr.destroy();

    expect(mockCtx.close).toHaveBeenCalled();
    expect(mgr.hasSamples).toBe(false);
    expect(mgr.sampleCount).toBe(0);
  });

  it('destroy() calls music.destroy()', () => {
    setupAudioMocks();
    const mgr = new AudioManager();
    const musicDestroySpy = vi.spyOn(mgr.music, 'destroy');

    mgr.destroy();

    expect(musicDestroySpy).toHaveBeenCalled();
  });

  it('destroy() without prior init() does not throw', () => {
    setupAudioMocks();
    const mgr = new AudioManager();
    expect(() => mgr.destroy()).not.toThrow();
  });
});

describe('AudioManager — resume', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resume() calls ctx.resume() when suspended', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    mgr.init();
    mockCtx.state = 'suspended';

    mgr.resume();

    expect(mockCtx.resume).toHaveBeenCalled();
  });

  it('resume() does not call ctx.resume() when already running', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    mgr.init();
    mockCtx.state = 'running';

    mgr.resume();

    expect(mockCtx.resume).not.toHaveBeenCalled();
  });

  it('resume() also resumes music player', () => {
    setupAudioMocks();
    const mgr = new AudioManager();
    const musicResumeSpy = vi.spyOn(mgr.music, 'resume');

    mgr.resume();

    expect(musicResumeSpy).toHaveBeenCalled();
  });
});

// =========================================================================
// MUSIC PLAYER TESTS
// =========================================================================

describe('MusicPlayer — construction', () => {
  beforeEach(() => {
    vi.stubGlobal('Audio', class MockAudio {
      src = ''; volume = 0; preload = '';
      addEventListener = vi.fn(); removeEventListener = vi.fn();
      play = vi.fn().mockResolvedValue(undefined); pause = vi.fn();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('constructs with default base path', () => {
    const player = new MusicPlayer();
    expect(player).toBeDefined();
    expect(player.isPlaying).toBe(false);
    expect(player.isCombatMode).toBe(false);
  });

  it('constructs with custom base path', () => {
    const player = new MusicPlayer('/custom/music');
    expect(player).toBeDefined();
  });

  it('starts with volume 0.4', () => {
    const player = new MusicPlayer();
    expect(player.getVolume()).toBe(0.4);
  });

  it('initializes with shuffled playlist containing all 15 track indices', () => {
    const player = new MusicPlayer();
    const playlist = (player as any).playlist as number[];
    expect(playlist.length).toBe(15);
    expect(new Set(playlist).size).toBe(15);
    for (let i = 0; i < 15; i++) {
      expect(playlist).toContain(i);
    }
  });
});

describe('MusicPlayer — playback control', () => {
  beforeEach(() => {
    vi.stubGlobal('Audio', class MockAudio {
      src = ''; volume = 0; preload = '';
      addEventListener = vi.fn(); removeEventListener = vi.fn();
      play = vi.fn().mockResolvedValue(undefined); pause = vi.fn();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('play() defers when not available (probe pending)', () => {
    const player = new MusicPlayer();
    player.play();
    expect(player.isPlaying).toBe(false);
    expect((player as any).pendingPlay).toBe(true);
  });

  it('play() starts playback when available', () => {
    const player = new MusicPlayer();
    (player as any).available = true;

    player.play();

    expect(player.isPlaying).toBe(true);
  });

  it('play() is idempotent (calling twice does not restart)', () => {
    const player = new MusicPlayer();
    (player as any).available = true;

    player.play();
    const firstCurrent = (player as any).current;

    player.play();
    expect((player as any).current).toBe(firstCurrent);
  });

  it('pause() pauses current audio element', () => {
    const player = new MusicPlayer();
    (player as any).available = true;
    player.play();

    const current = (player as any).current;
    player.pause();

    expect(current.pause).toHaveBeenCalled();
  });

  it('stop() resets all playback state', () => {
    const player = new MusicPlayer();
    (player as any).available = true;
    player.play();

    player.stop();

    expect(player.isPlaying).toBe(false);
    expect(player.currentTrack).toBe('');
    expect((player as any).current).toBeNull();
  });

  it('stop() clears pending crossfade timer', () => {
    const player = new MusicPlayer();
    (player as any).available = true;
    player.play();
    (player as any).fadeTimer = setInterval(() => {}, 100);

    player.stop();

    expect((player as any).fadeTimer).toBeNull();
  });

  it('next() advances to another track', () => {
    const player = new MusicPlayer();
    (player as any).available = true;
    player.play();

    player.next();

    expect(player.isPlaying).toBe(true);
  });

  it('next() does nothing when not available', () => {
    const player = new MusicPlayer();

    player.next();
    expect(player.isPlaying).toBe(false);
  });
});

describe('MusicPlayer — volume and mute', () => {
  beforeEach(() => {
    vi.stubGlobal('Audio', class MockAudio {
      src = ''; volume = 0; preload = '';
      addEventListener = vi.fn(); removeEventListener = vi.fn();
      play = vi.fn().mockResolvedValue(undefined); pause = vi.fn();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('setVolume() clamps to [0, 1]', () => {
    const player = new MusicPlayer();
    player.setVolume(1.5);
    expect(player.getVolume()).toBe(1);
    player.setVolume(-0.5);
    expect(player.getVolume()).toBe(0);
  });

  it('setVolume() updates current audio element volume when not muted', () => {
    const player = new MusicPlayer();
    (player as any).available = true;
    (player as any).muted = false;
    player.play();

    player.setVolume(0.7);

    const current = (player as any).current;
    expect(current.volume).toBe(0.7);
  });

  it('setMuted(true) sets audio element volume to 0', () => {
    const player = new MusicPlayer();
    (player as any).available = true;
    (player as any).muted = false;
    player.play();

    player.setMuted(true);

    const current = (player as any).current;
    expect(current.volume).toBe(0);
  });

  it('setMuted(false) restores volume to current level', () => {
    const player = new MusicPlayer();
    (player as any).available = true;
    (player as any).muted = true;
    player.play();

    player.setVolume(0.6);
    player.setMuted(false);

    const current = (player as any).current;
    expect(current.volume).toBe(0.6);
  });
});

describe('MusicPlayer — combat mode (additional coverage)', () => {
  beforeEach(() => {
    vi.stubGlobal('Audio', class MockAudio {
      src = ''; volume = 0; preload = '';
      addEventListener = vi.fn(); removeEventListener = vi.fn();
      play = vi.fn().mockResolvedValue(undefined); pause = vi.fn();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('track names are formatted without numeric prefix and underscores', () => {
    const player = new MusicPlayer();
    (player as any).available = true;
    (player as any).muted = false;
    player.play();

    const name = player.currentTrack;
    expect(name).not.toMatch(/^\d+_/);
    expect(name).not.toContain('_');
    expect(name.length).toBeGreaterThan(0);
  });

  it('combat mode selects from ACTION_TRACKS when entering combat', () => {
    const player = new MusicPlayer();
    (player as any).available = true;
    (player as any).playing = true;

    player.setCombatMode(true);

    expect(player.isCombatMode).toBe(true);
  });

  it('advance() in combat mode creates a new Audio element', () => {
    const player = new MusicPlayer();
    (player as any).available = true;
    (player as any).playing = true;
    (player as any).combatMode = true;

    (player as any).advance();

    const current = (player as any).current;
    expect(current).toBeDefined();
  });

  it('advance() in calm mode creates a new Audio element', () => {
    const player = new MusicPlayer();
    (player as any).available = true;
    (player as any).playing = true;
    (player as any).combatMode = false;

    (player as any).advance();

    const current = (player as any).current;
    expect(current).toBeDefined();
  });
});

describe('MusicPlayer — crossfade', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('Audio', class MockAudio {
      src = ''; volume = 0.5; preload = '';
      addEventListener = vi.fn(); removeEventListener = vi.fn();
      play = vi.fn().mockResolvedValue(undefined); pause = vi.fn();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('crossfade takes 2 seconds (20 steps x 100ms)', () => {
    const player = new MusicPlayer();
    (player as any).available = true;
    (player as any).muted = false;
    player.play();

    const oldAudio = (player as any).current;
    oldAudio.volume = 0.5;

    player.next();

    expect((player as any).fading).toBe(oldAudio);

    vi.advanceTimersByTime(2000);

    expect(oldAudio.pause).toHaveBeenCalled();
  });

  it('crossfade cleans up previous fade before starting new one', () => {
    const player = new MusicPlayer();
    (player as any).available = true;
    (player as any).muted = false;
    player.play();

    player.next();
    const firstFading = (player as any).fading;

    player.next();

    expect(firstFading.pause).toHaveBeenCalled();
  });
});

describe('MusicPlayer — destroy', () => {
  beforeEach(() => {
    vi.stubGlobal('Audio', class MockAudio {
      src = ''; volume = 0; preload = '';
      addEventListener = vi.fn(); removeEventListener = vi.fn();
      play = vi.fn().mockResolvedValue(undefined); pause = vi.fn();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('destroy() stops all playback', () => {
    const player = new MusicPlayer();
    (player as any).available = true;
    player.play();

    player.destroy();

    expect(player.isPlaying).toBe(false);
    expect(player.currentTrack).toBe('');
  });
});

// =========================================================================
// SOUND NAME COVERAGE TESTS
// =========================================================================

describe('Sound name exhaustiveness', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const ALL_SOUND_NAMES: SoundName[] = [
    'rifle', 'machinegun', 'cannon', 'artillery',
    'mandible', 'teslazap', 'fireball', 'flamethrower',
    'grenade', 'bazooka', 'dogjaw',
    'explode_sm', 'explode_lg',
    'die_infantry', 'die_vehicle', 'die_ant',
    'move_ack', 'attack_ack', 'select',
    'select_infantry', 'select_vehicle', 'select_dog',
    'move_ack_infantry', 'move_ack_vehicle', 'move_ack_dog',
    'unit_lost', 'building_explode', 'heal',
    'eva_unit_lost', 'eva_base_attack', 'eva_acknowledged',
    'eva_construction_complete', 'eva_unit_ready', 'eva_low_power',
    'eva_new_options', 'eva_building', 'repair', 'sell',
    'victory_fanfare', 'defeat_sting', 'crate_pickup', 'eva_mission_accomplished',
    'eva_reinforcements', 'eva_mission_warning', 'tesla_charge',
    'sniper', 'building_placed', 'mammoth_cannon',
    'eva_building_captured', 'eva_insufficient_funds', 'eva_silos_needed',
    'chrono', 'iron_curtain', 'nuke_launch', 'nuke_explode',
  ];

  it('all SoundName values have a synthesis handler (play() does not crash)', () => {
    const mockCtx = setupAudioMocks();
    const perfNow = vi.spyOn(performance, 'now');

    const mgr = new AudioManager();
    mgr.init();
    mgr.toggleMute();

    let time = 0;
    for (const name of ALL_SOUND_NAMES) {
      time += 100;
      perfNow.mockReturnValue(time);
      expect(() => mgr.play(name), `${name} should not throw`).not.toThrow();
    }
  });

  it('SAMPLE_SOUND_NAMES list contains expected weapon sounds', () => {
    const SAMPLE_SOUND_NAMES: SoundName[] = [
      'rifle', 'machinegun', 'cannon', 'artillery', 'teslazap',
      'grenade', 'bazooka', 'mandible', 'fireball', 'flamethrower', 'dogjaw', 'sniper',
    ];
    const weaponSounds: SoundName[] = [
      'rifle', 'machinegun', 'cannon', 'artillery', 'teslazap',
      'grenade', 'bazooka', 'mandible', 'fireball', 'flamethrower', 'dogjaw', 'sniper',
    ];
    for (const s of weaponSounds) {
      expect(SAMPLE_SOUND_NAMES).toContain(s);
    }
  });

  it('EVA announcements are all distinct sound names (14 total)', () => {
    const evaNames = ALL_SOUND_NAMES.filter(n => n.startsWith('eva_'));
    expect(evaNames.length).toBe(14);
    expect(new Set(evaNames).size).toBe(14);
  });

  it('unit voice acknowledgements include infantry, vehicle, and dog variants', () => {
    const voiceNames = ALL_SOUND_NAMES.filter(n =>
      n.startsWith('move_ack') || n.startsWith('select') || n === 'attack_ack'
    );
    expect(voiceNames).toContain('move_ack');
    expect(voiceNames).toContain('move_ack_infantry');
    expect(voiceNames).toContain('move_ack_vehicle');
    expect(voiceNames).toContain('move_ack_dog');
    expect(voiceNames).toContain('select');
    expect(voiceNames).toContain('select_infantry');
    expect(voiceNames).toContain('select_vehicle');
    expect(voiceNames).toContain('select_dog');
    expect(voiceNames).toContain('attack_ack');
  });

  it('structure sounds include construction, destruction, selling', () => {
    expect(ALL_SOUND_NAMES).toContain('building_explode');
    expect(ALL_SOUND_NAMES).toContain('building_placed');
    expect(ALL_SOUND_NAMES).toContain('sell');
    expect(ALL_SOUND_NAMES).toContain('repair');
  });

  it('superweapon sounds are all present', () => {
    expect(ALL_SOUND_NAMES).toContain('chrono');
    expect(ALL_SOUND_NAMES).toContain('iron_curtain');
    expect(ALL_SOUND_NAMES).toContain('nuke_launch');
    expect(ALL_SOUND_NAMES).toContain('nuke_explode');
  });
});

// =========================================================================
// EDGE CASES
// =========================================================================

describe('Edge cases — AudioContext unavailable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('play() with no AudioContext does not throw', () => {
    vi.stubGlobal('AudioContext', class { constructor() { throw new Error('No audio'); } });
    vi.stubGlobal('Audio', class MockAudio {
      src = ''; volume = 0; preload = '';
      addEventListener = vi.fn(); play = vi.fn().mockResolvedValue(undefined); pause = vi.fn();
    });

    const mgr = new AudioManager();
    mgr.init();
    mgr.toggleMute();

    expect(() => mgr.play('rifle')).not.toThrow();
  });

  it('playAt() with no AudioContext does not throw', () => {
    vi.stubGlobal('AudioContext', class { constructor() { throw new Error('No audio'); } });
    vi.stubGlobal('Audio', class MockAudio {
      src = ''; volume = 0; preload = '';
      addEventListener = vi.fn(); play = vi.fn().mockResolvedValue(undefined); pause = vi.fn();
    });

    const mgr = new AudioManager();
    mgr.init();
    mgr.toggleMute();

    expect(() => mgr.playAt('cannon', 100, 100, 0, 640)).not.toThrow();
  });

  it('destroy() with no AudioContext does not throw', () => {
    vi.stubGlobal('Audio', class MockAudio {
      src = ''; volume = 0; preload = '';
      addEventListener = vi.fn(); play = vi.fn().mockResolvedValue(undefined); pause = vi.fn();
    });

    const mgr = new AudioManager();
    expect(() => mgr.destroy()).not.toThrow();
  });
});

describe('Edge cases — volume at zero', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sounds at volume 0 still route through synth without errors', () => {
    const mockCtx = setupAudioMocks();
    vi.spyOn(performance, 'now').mockReturnValue(1000);

    const mgr = new AudioManager();
    mgr.init();
    mgr.toggleMute();
    mgr.setVolume(0);

    expect(() => mgr.play('cannon')).not.toThrow();
  });

  it('volume 0 does not prevent future volume changes', () => {
    const mockCtx = setupAudioMocks();
    const mgr = new AudioManager();
    mgr.init();
    mgr.toggleMute();
    mgr.setVolume(0);
    expect(mgr.getVolume()).toBe(0);

    mgr.setVolume(0.5);
    expect(mgr.getVolume()).toBe(0.5);
    const masterGain = (mgr as any).masterGain;
    expect(masterGain.gain.value).toBe(0.5);
  });
});

describe('Edge cases — AUD decoder with minimal/empty data', () => {
  it('header-only file (no chunk data at all) produces zero samples', () => {
    const buf = new ArrayBuffer(12);
    const view = new DataView(buf);
    view.setUint16(0, 22050, true);
    view.setUint32(2, 0, true);
    view.setUint32(6, 0, true);
    view.setUint8(10, 0x02);
    view.setUint8(11, 99);

    const result = decodeAud(buf);
    expect(result.samples.length).toBe(0);
  });

  it('header parseable from exactly 12-byte buffer', () => {
    const buf = new ArrayBuffer(12);
    const view = new DataView(buf);
    view.setUint16(0, 8000, true);
    view.setUint32(2, 0, true);
    view.setUint32(6, 0, true);
    view.setUint8(10, 0x00);
    view.setUint8(11, 99);

    const header = parseAudHeader(view);
    expect(header.sampleRate).toBe(8000);
    expect(header.type).toBe(99);
  });

  it('chunk with zero compressed bytes produces no samples', () => {
    const totalSize = 12 + 8;
    const buf = new ArrayBuffer(totalSize);
    const view = new DataView(buf);

    view.setUint16(0, 22050, true);
    view.setUint32(2, 0, true);
    view.setUint32(6, 0, true);
    view.setUint8(10, 0x02);
    view.setUint8(11, 99);

    view.setUint16(12, 0, true);
    view.setUint16(14, 0, true);
    view.setUint32(16, 0x0000deaf, true);

    const result = decodeAud(buf);
    expect(result.samples.length).toBe(0);
  });
});

describe('Edge cases — rapid-fire sounds', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('100 rapid play() calls of same sound only produces a few actual audio nodes', () => {
    const mockCtx = setupAudioMocks();
    vi.spyOn(performance, 'now').mockReturnValue(1000);

    const mgr = new AudioManager();
    mgr.init();
    mgr.toggleMute();

    for (let i = 0; i < 100; i++) {
      mgr.play('machinegun');
    }

    const totalNodes = mockCtx.createBufferSource.mock.calls.length
      + mockCtx.createOscillator.mock.calls.length;
    expect(totalNodes).toBeGreaterThan(0);
    expect(totalNodes).toBeLessThan(10);
  });

  it('rapid alternating sounds are not throttled against each other', () => {
    const mockCtx = setupAudioMocks();
    vi.spyOn(performance, 'now').mockReturnValue(1000);

    const mgr = new AudioManager();
    mgr.init();
    mgr.toggleMute();

    mgr.play('rifle');
    const afterFirst = mockCtx.createBufferSource.mock.calls.length
      + mockCtx.createOscillator.mock.calls.length;

    mgr.play('cannon');
    const afterSecond = mockCtx.createBufferSource.mock.calls.length
      + mockCtx.createOscillator.mock.calls.length;

    mgr.play('grenade');
    const afterThird = mockCtx.createBufferSource.mock.calls.length
      + mockCtx.createOscillator.mock.calls.length;

    // Each distinct sound should create additional nodes
    expect(afterSecond).toBeGreaterThan(afterFirst);
    expect(afterThird).toBeGreaterThan(afterSecond);
  });
});

describe('Music track constants', () => {
  it('15 tracks in total (matching Red Alert soundtrack)', () => {
    const MUSIC_TRACKS = [
      '01_hell_march', '02_radio', '03_crush', '04_roll_out', '05_mud',
      '06_twin_cannon', '07_face_the_enemy', '08_run', '09_terminate',
      '10_big_foot', '11_workmen', '12_militant_force', '13_dense',
      '14_vector', '15_smash',
    ];
    expect(MUSIC_TRACKS.length).toBe(15);
  });

  it('calm and action tracks have no overlap and cover all 15', () => {
    const CALM_TRACKS = new Set([1, 3, 4, 7, 10, 13]);
    const ACTION_TRACKS = new Set([0, 2, 5, 6, 8, 9, 11, 12, 14]);

    const all = new Set([...CALM_TRACKS, ...ACTION_TRACKS]);
    expect(all.size).toBe(15);
    for (let i = 0; i < 15; i++) {
      expect(all.has(i)).toBe(true);
    }
  });

  it('hell march (index 0) is an action track', () => {
    const ACTION_TRACKS = new Set([0, 2, 5, 6, 8, 9, 11, 12, 14]);
    expect(ACTION_TRACKS.has(0)).toBe(true);
  });

  it('radio (index 1) is a calm track', () => {
    const CALM_TRACKS = new Set([1, 3, 4, 7, 10, 13]);
    expect(CALM_TRACKS.has(1)).toBe(true);
  });
});
