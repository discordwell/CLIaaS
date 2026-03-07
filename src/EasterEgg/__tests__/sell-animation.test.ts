import { describe, it, expect } from 'vitest';

/**
 * Tests for sell animation frame selection logic.
 *
 * In C++ Red Alert, selling a building plays its construction frames in reverse.
 * The BUILDING_FRAME_TABLE's damageFrame value tells us how many construction
 * frames exist (0..damageFrame-1). During sell:
 *   - sellProgress=0 → frame = damageFrame-1 (fully built)
 *   - sellProgress=1 → frame = 0 (fully deconstructed)
 */

// Mirror of BUILDING_FRAME_TABLE from renderer.ts (subset for testing)
const BUILDING_FRAME_TABLE: Record<string, { idleFrame: number; damageFrame: number; idleAnimCount: number }> = {
  fact: { idleFrame: 0, damageFrame: 26, idleAnimCount: 0 },
  weap: { idleFrame: 0, damageFrame: 16, idleAnimCount: 0 },
  barr: { idleFrame: 0, damageFrame: 10, idleAnimCount: 0 },
  powr: { idleFrame: 0, damageFrame: 4, idleAnimCount: 0 },
  hbox: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },
  tsla: { idleFrame: 0, damageFrame: 10, idleAnimCount: 10 },
};

/** Replicates the sell frame selection logic from renderer.ts */
function sellFrame(image: string, sellProgress: number): number {
  const entry = BUILDING_FRAME_TABLE[image];
  if (entry && entry.damageFrame > 1) {
    const maxFrame = entry.damageFrame - 1;
    return Math.max(0, Math.floor((1 - sellProgress) * maxFrame));
  }
  // Buildings with damageFrame <= 1 have no construction frames to cycle
  return 0;
}

/** Replicates the construction frame selection logic from renderer.ts */
function constructionFrame(image: string, buildProgress: number): number {
  const entry = BUILDING_FRAME_TABLE[image];
  if (entry && entry.damageFrame > 1) {
    const maxFrame = entry.damageFrame - 1;
    return Math.min(Math.floor(buildProgress * maxFrame), maxFrame);
  }
  return 0;
}

describe('Sell animation frame cycling', () => {
  it('factory cycles through 26 construction frames in reverse during sell', () => {
    // At sell start: show last construction frame (fully built)
    expect(sellFrame('fact', 0)).toBe(25);
    // At sell end: show first frame (deconstructed)
    expect(sellFrame('fact', 1)).toBe(0);
    // Midway: approximately half
    const mid = sellFrame('fact', 0.5);
    expect(mid).toBeGreaterThanOrEqual(11);
    expect(mid).toBeLessThanOrEqual(13);
  });

  it('weapons factory cycles through 16 frames in reverse', () => {
    expect(sellFrame('weap', 0)).toBe(15);
    expect(sellFrame('weap', 1)).toBe(0);
  });

  it('barracks cycles through 10 frames in reverse', () => {
    expect(sellFrame('barr', 0)).toBe(9);
    expect(sellFrame('barr', 1)).toBe(0);
  });

  it('power plant cycles through 4 frames in reverse', () => {
    expect(sellFrame('powr', 0)).toBe(3);
    expect(sellFrame('powr', 1)).toBe(0);
  });

  it('pillbox with damageFrame=1 stays at frame 0 (no construction frames)', () => {
    expect(sellFrame('hbox', 0)).toBe(0);
    expect(sellFrame('hbox', 0.5)).toBe(0);
    expect(sellFrame('hbox', 1)).toBe(0);
  });

  it('animated buildings (tsla) also cycle construction frames during sell', () => {
    expect(sellFrame('tsla', 0)).toBe(9);
    expect(sellFrame('tsla', 1)).toBe(0);
  });

  it('frame decreases monotonically as sellProgress increases', () => {
    let prev = sellFrame('fact', 0);
    for (let p = 0.05; p <= 1.0; p += 0.05) {
      const f = sellFrame('fact', p);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });

  it('unknown building returns frame 0', () => {
    expect(sellFrame('unknown_building', 0.5)).toBe(0);
  });
});

describe('Construction animation frame cycling', () => {
  it('factory cycles 0→25 as buildProgress 0→1', () => {
    expect(constructionFrame('fact', 0)).toBe(0);
    expect(constructionFrame('fact', 1)).toBe(25);
  });

  it('frame increases monotonically as buildProgress increases', () => {
    let prev = constructionFrame('fact', 0);
    for (let p = 0.05; p <= 1.0; p += 0.05) {
      const f = constructionFrame('fact', p);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it('construction and sell are inverses at endpoints', () => {
    for (const key of ['fact', 'weap', 'barr', 'powr'] as const) {
      // Construction complete = sell start → same frame
      expect(constructionFrame(key, 1)).toBe(sellFrame(key, 0));
      // Construction start = sell end → same frame
      expect(constructionFrame(key, 0)).toBe(sellFrame(key, 1));
    }
  });
});
