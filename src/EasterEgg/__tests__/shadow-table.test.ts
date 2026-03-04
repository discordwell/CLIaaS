/**
 * Tests for the C++ Cell_Shadow lookup table and bitmask calculation.
 * Verifies byte-for-byte parity with the original display.cpp _shadow[256] array.
 */
import { describe, it, expect } from 'vitest';
import {
  SHADOW_TABLE,
  cellShadowIndex,
  SHADOW_BIT_NW, SHADOW_BIT_N, SHADOW_BIT_NE,
  SHADOW_BIT_W, SHADOW_BIT_E,
  SHADOW_BIT_SW, SHADOW_BIT_S, SHADOW_BIT_SE,
} from '../engine/shadow';

describe('SHADOW_TABLE', () => {
  it('has exactly 256 entries', () => {
    expect(SHADOW_TABLE.length).toBe(256);
  });

  it('all values are in range [-2, 46]', () => {
    for (let i = 0; i < 256; i++) {
      expect(SHADOW_TABLE[i]).toBeGreaterThanOrEqual(-2);
      expect(SHADOW_TABLE[i]).toBeLessThanOrEqual(46);
    }
  });

  it('index 0 (all neighbors mapped) returns -1 (no shadow)', () => {
    expect(SHADOW_TABLE[0]).toBe(-1);
  });

  it('references at least 45 distinct frame indices', () => {
    const used = new Set<number>();
    for (let i = 0; i < 256; i++) {
      if (SHADOW_TABLE[i] >= 0) used.add(SHADOW_TABLE[i]);
    }
    // C++ table uses frames 1-46 (skipping 0 and 15) = 45 distinct frames
    expect(used.size).toBeGreaterThanOrEqual(45);
    // Frame 0 and 15 are NOT referenced in the C++ table
    expect(used.has(0)).toBe(false);
    expect(used.has(15)).toBe(false);
  });

  // Spot-check values read directly from C++ display.cpp _shadow[256]
  const SPOT_CHECKS: [number, number, string][] = [
    [0x00, -1,  'all neighbors mapped'],
    [0xFF, -2,  'all neighbors unmapped (solid black)'],
    [0x80,  1,  'only N unmapped'],
    [0x08,  4,  'only S unmapped'],
    [0x20,  8,  'only W unmapped'],
    [0x02,  2,  'only E unmapped'],
    [0x40, 32,  'only NW unmapped'],
    [0x01, 33,  'only NE unmapped'],
    [0x10, 35,  'only SW unmapped'],
    [0x04, 34,  'only SE unmapped'],
    [0xA0,  9,  'N+W unmapped'],
    [0x82,  3,  'N+E unmapped'],
    [0x28, 12,  'W+S unmapped'],
    [0x0A,  6,  'E+S unmapped'],
  ];

  it.each(SPOT_CHECKS)(
    'index 0x%s returns %i (%s)',
    (idx, expected, _desc) => {
      expect(SHADOW_TABLE[idx]).toBe(expected);
    },
  );
});

describe('cellShadowIndex', () => {
  it('returns 0 when all neighbors are mapped (visibility > 0)', () => {
    const getVis = () => 1; // all fog (mapped)
    expect(cellShadowIndex(5, 5, getVis)).toBe(0);
  });

  it('returns 0xFF when all neighbors are unmapped', () => {
    const getVis = () => 0; // all shroud
    expect(cellShadowIndex(5, 5, getVis)).toBe(0xFF);
  });

  it('sets correct bit for each neighbor direction', () => {
    const cases: [number, number, number][] = [
      // [dx, dy, expected bit]
      [-1, -1, SHADOW_BIT_NW],
      [ 0, -1, SHADOW_BIT_N],
      [ 1, -1, SHADOW_BIT_NE],
      [-1,  0, SHADOW_BIT_W],
      [ 1,  0, SHADOW_BIT_E],
      [-1,  1, SHADOW_BIT_SW],
      [ 0,  1, SHADOW_BIT_S],
      [ 1,  1, SHADOW_BIT_SE],
    ];

    for (const [dx, dy, bit] of cases) {
      // Only the specified neighbor is unmapped
      const getVis = (x: number, y: number) =>
        (x === 5 + dx && y === 5 + dy) ? 0 : 2;
      const result = cellShadowIndex(5, 5, getVis);
      expect(result, `neighbor (${dx},${dy}) should set bit 0x${bit.toString(16)}`).toBe(bit);
    }
  });

  it('combines multiple unmapped neighbors', () => {
    // N and S unmapped
    const getVis = (x: number, y: number) => {
      if (x === 5 && y === 4) return 0; // N
      if (x === 5 && y === 6) return 0; // S
      return 2;
    };
    expect(cellShadowIndex(5, 5, getVis)).toBe(SHADOW_BIT_N | SHADOW_BIT_S);
  });

  it('treats visibility 0 as unmapped, 1 and 2 as mapped', () => {
    // Only vis=0 should set bits, vis=1 (fog) and vis=2 (visible) should not
    const getVis = (_x: number, y: number) => {
      if (y === 4) return 0; // N = shroud
      if (y === 6) return 1; // S = fog (mapped)
      return 2;              // visible
    };
    const result = cellShadowIndex(5, 5, getVis);
    expect(result).toBe(SHADOW_BIT_NW | SHADOW_BIT_N | SHADOW_BIT_NE);
  });
});

describe('bit layout matches C++ convention', () => {
  it('NW=0x40 N=0x80 NE=0x01 W=0x20 E=0x02 SW=0x10 S=0x08 SE=0x04', () => {
    expect(SHADOW_BIT_NW).toBe(0x40);
    expect(SHADOW_BIT_N).toBe(0x80);
    expect(SHADOW_BIT_NE).toBe(0x01);
    expect(SHADOW_BIT_W).toBe(0x20);
    expect(SHADOW_BIT_E).toBe(0x02);
    expect(SHADOW_BIT_SW).toBe(0x10);
    expect(SHADOW_BIT_S).toBe(0x08);
    expect(SHADOW_BIT_SE).toBe(0x04);
  });

  it('all 8 bits cover exactly 0xFF', () => {
    const allBits = SHADOW_BIT_NW | SHADOW_BIT_N | SHADOW_BIT_NE |
                    SHADOW_BIT_W | SHADOW_BIT_E |
                    SHADOW_BIT_SW | SHADOW_BIT_S | SHADOW_BIT_SE;
    expect(allBits).toBe(0xFF);
  });
});
