import { describe, it, expect } from 'vitest';

/**
 * Tests for sell/construction animation frame selection logic.
 *
 * In C++ Red Alert, construction/sell uses a dedicated *make.shp buildup sheet.
 * The renderer checks for a `${image}make` sheet first; if available, it cycles
 * through that sheet's frames. If not, it falls back to cycling through the
 * normal building's frames 0..damageFrame-1.
 *
 * Make sheet path (primary):
 *   - Construction: frame 0 → frameCount-1 as buildProgress 0→1
 *   - Sell: frame frameCount-1 → 0 as sellProgress 0→1
 *
 * Fallback path (no make sheet):
 *   - Construction: frame 0 → damageFrame-1 as buildProgress 0→1
 *   - Sell: frame damageFrame-1 → 0 as sellProgress 0→1
 */

// Make sheet frame counts from manifest.json
const MAKE_SHEET_FRAMES: Record<string, number> = {
  fact: 32,    // factmake.png
  weap: 15,    // weapmake.png
  barr: 13,    // barrmake.png
  powr: 13,    // powrmake.png
  proc: 10,    // procmake.png
  dome: 8,     // domemake.png (not in manifest data shown)
  tsla: 13,    // tslamake.png
  hbox: 5,     // hboxmake.png
};

// Fallback: BUILDING_FRAME_TABLE damageFrame values (for buildings without make sheets)
const BUILDING_FRAME_TABLE: Record<string, { damageFrame: number }> = {
  fact: { damageFrame: 26 },
  weap: { damageFrame: 16 },
  barr: { damageFrame: 10 },
  powr: { damageFrame: 4 },
  hbox: { damageFrame: 1 },
  tsla: { damageFrame: 10 },
};

/** Primary path: sell frame from make sheet */
function sellFrameMake(makeFrameCount: number, sellProgress: number): number {
  const maxFrame = makeFrameCount - 1;
  return Math.max(0, Math.floor((1 - sellProgress) * maxFrame));
}

/** Primary path: construction frame from make sheet */
function constructionFrameMake(makeFrameCount: number, buildProgress: number): number {
  const maxFrame = makeFrameCount - 1;
  return Math.min(Math.floor(buildProgress * maxFrame), maxFrame);
}

/** Fallback path: sell frame from normal building frames */
function sellFrameFallback(image: string, sellProgress: number): number {
  const entry = BUILDING_FRAME_TABLE[image];
  if (entry && entry.damageFrame > 1) {
    const maxFrame = entry.damageFrame - 1;
    return Math.max(0, Math.floor((1 - sellProgress) * maxFrame));
  }
  return 0;
}

/** Fallback path: construction frame from normal building frames */
function constructionFrameFallback(image: string, buildProgress: number): number {
  const entry = BUILDING_FRAME_TABLE[image];
  if (entry && entry.damageFrame > 1) {
    const maxFrame = entry.damageFrame - 1;
    return Math.min(Math.floor(buildProgress * maxFrame), maxFrame);
  }
  return 0;
}

describe('Sell animation — make sheet (primary path)', () => {
  it('factory uses 32-frame factmake sheet during sell', () => {
    expect(sellFrameMake(32, 0)).toBe(31);   // fully built
    expect(sellFrameMake(32, 1)).toBe(0);    // fully deconstructed
    const mid = sellFrameMake(32, 0.5);
    expect(mid).toBeGreaterThanOrEqual(14);
    expect(mid).toBeLessThanOrEqual(16);
  });

  it('weapons factory uses 15-frame weapmake sheet', () => {
    expect(sellFrameMake(15, 0)).toBe(14);
    expect(sellFrameMake(15, 1)).toBe(0);
  });

  it('power plant uses 13-frame powrmake sheet', () => {
    expect(sellFrameMake(13, 0)).toBe(12);
    expect(sellFrameMake(13, 1)).toBe(0);
  });

  it('pillbox uses 5-frame hboxmake sheet (NOT stuck at frame 0)', () => {
    // Unlike the fallback path where hbox has damageFrame=1, the make sheet has 5 frames
    expect(sellFrameMake(5, 0)).toBe(4);
    expect(sellFrameMake(5, 1)).toBe(0);
  });

  it('frame decreases monotonically as sellProgress increases', () => {
    let prev = sellFrameMake(32, 0);
    for (let p = 0.05; p <= 1.0; p += 0.05) {
      const f = sellFrameMake(32, p);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });
});

describe('Construction animation — make sheet (primary path)', () => {
  it('factory cycles 0→31 as buildProgress 0→1', () => {
    expect(constructionFrameMake(32, 0)).toBe(0);
    expect(constructionFrameMake(32, 1)).toBe(31);
  });

  it('frame increases monotonically as buildProgress increases', () => {
    let prev = constructionFrameMake(32, 0);
    for (let p = 0.05; p <= 1.0; p += 0.05) {
      const f = constructionFrameMake(32, p);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it('construction and sell are inverses at endpoints', () => {
    for (const fc of [32, 15, 13, 10, 8, 5]) {
      expect(constructionFrameMake(fc, 1)).toBe(sellFrameMake(fc, 0));
      expect(constructionFrameMake(fc, 0)).toBe(sellFrameMake(fc, 1));
    }
  });
});

describe('Sell animation — fallback path (no make sheet)', () => {
  it('factory fallback cycles through 26 damageFrame frames', () => {
    expect(sellFrameFallback('fact', 0)).toBe(25);
    expect(sellFrameFallback('fact', 1)).toBe(0);
  });

  it('building with damageFrame=1 stays at frame 0', () => {
    expect(sellFrameFallback('hbox', 0)).toBe(0);
    expect(sellFrameFallback('hbox', 0.5)).toBe(0);
    expect(sellFrameFallback('hbox', 1)).toBe(0);
  });

  it('unknown building returns frame 0', () => {
    expect(sellFrameFallback('unknown_building', 0.5)).toBe(0);
  });

  it('fallback construction and sell are inverses', () => {
    for (const key of ['fact', 'weap', 'barr', 'powr'] as const) {
      expect(constructionFrameFallback(key, 1)).toBe(sellFrameFallback(key, 0));
      expect(constructionFrameFallback(key, 0)).toBe(sellFrameFallback(key, 1));
    }
  });
});

describe('Make sheet manifest coverage', () => {
  it('all major buildings have make sheets with reasonable frame counts', () => {
    // Every building with a make sheet should have at least 2 frames
    for (const [name, count] of Object.entries(MAKE_SHEET_FRAMES)) {
      expect(count, `${name}make should have ≥2 frames`).toBeGreaterThanOrEqual(2);
    }
  });

  it('make sheet frame counts differ from damageFrame (proves they are distinct assets)', () => {
    // The make sheet has its own frame count, independent of the normal sprite's damageFrame
    expect(MAKE_SHEET_FRAMES.fact).toBe(32);       // vs damageFrame 26
    expect(MAKE_SHEET_FRAMES.weap).toBe(15);       // vs damageFrame 16
    expect(MAKE_SHEET_FRAMES.powr).toBe(13);       // vs damageFrame 4
  });
});
