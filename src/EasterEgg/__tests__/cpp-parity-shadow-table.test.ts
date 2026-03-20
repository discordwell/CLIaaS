/**
 * C++ Behavioral Parity Tests — DisplayClass::Cell_Shadow (display.cpp)
 *
 * Verifies the 256-entry shadow lookup table and bitmask builder match
 * the C++ _shadow[256] array and Cell_Shadow neighbor enumeration.
 *
 * C++ reference: CnC_and_Red_Alert/RA/display.cpp
 *   - _shadow[256] static array definition (display.cpp:~line 100-120)
 *   - Cell_Shadow() method that builds 8-neighbor bitmask (display.cpp:~line 1200)
 *   - Bit layout: NW=bit6(0x40) N=bit7(0x80) NE=bit0(0x01)
 *                 W=bit5(0x20)               E=bit1(0x02)
 *                 SW=bit4(0x10) S=bit3(0x08) SE=bit2(0x04)
 *
 * Return values from _shadow[]:
 *   -1 = no shadow (all 8 neighbors are mapped/revealed)
 *   -2 = solid black (cell is fully surrounded by unmapped/shroud)
 *   0-46 = SHADOW.SHP frame index for partial edge transition
 *
 * Note: frames 0 and 15 are NOT used in the C++ table.
 */

import { describe, it, expect } from 'vitest';
import {
  SHADOW_TABLE,
  cellShadowIndex,
  SHADOW_BIT_NW, SHADOW_BIT_N, SHADOW_BIT_NE,
  SHADOW_BIT_W, SHADOW_BIT_E,
  SHADOW_BIT_SW, SHADOW_BIT_S, SHADOW_BIT_SE,
} from '../engine/shadow';

// ============================================================
// Helper: rotate a bitmask 90 degrees clockwise
// NW->NE->SE->SW->NW, N->E->S->W->N
// ============================================================
function rotateCW90(bitmask: number): number {
  let out = 0;
  // Edges: N->E, E->S, S->W, W->N
  if (bitmask & SHADOW_BIT_N)  out |= SHADOW_BIT_E;
  if (bitmask & SHADOW_BIT_E)  out |= SHADOW_BIT_S;
  if (bitmask & SHADOW_BIT_S)  out |= SHADOW_BIT_W;
  if (bitmask & SHADOW_BIT_W)  out |= SHADOW_BIT_N;
  // Corners: NW->NE, NE->SE, SE->SW, SW->NW
  if (bitmask & SHADOW_BIT_NW) out |= SHADOW_BIT_NE;
  if (bitmask & SHADOW_BIT_NE) out |= SHADOW_BIT_SE;
  if (bitmask & SHADOW_BIT_SE) out |= SHADOW_BIT_SW;
  if (bitmask & SHADOW_BIT_SW) out |= SHADOW_BIT_NW;
  return out;
}

// ============================================================
// Section 1: SHADOW_TABLE 256-entry correctness
// C++ display.cpp _shadow[256] — byte-for-byte table verification
// ============================================================
describe('SHADOW_TABLE 256-entry correctness (display.cpp _shadow[])', () => {
  // Complete C++ _shadow[256] expected values, read from display.cpp
  // Organized as 16 rows of 16 entries matching the C++ source layout
  const CPP_SHADOW: number[] = [
    // Row 0x00..0x0F
    -1,33, 2, 2,34,37, 2, 2,  4,26, 6, 6, 4,26, 6, 6,
    // Row 0x10..0x1F
    35,45,17,17,38,41,17,17,  4,26, 6, 6, 4,26, 6, 6,
    // Row 0x20..0x2F
     8,21,10,10,27,31,10,10, 12,23,14,14,12,23,14,14,
    // Row 0x30..0x3F
     8,21,10,10,27,31,10,10, 12,23,14,14,12,23,14,14,
    // Row 0x40..0x4F
    32,36,25,25,44,40,25,25, 19,30,20,20,19,30,20,20,
    // Row 0x50..0x5F
    39,43,29,29,42,46,29,29, 19,30,20,20,19,30,20,20,
    // Row 0x60..0x6F
     8,21,10,10,27,31,10,10, 12,23,14,14,12,23,14,14,
    // Row 0x70..0x7F
     8,21,10,10,27,31,10,10, 12,23,14,14,12,23,14,14,
    // Row 0x80..0x8F
     1, 1, 3, 3,16,16, 3, 3,  5, 5, 7, 7, 5, 5, 7, 7,
    // Row 0x90..0x9F
    24,24,18,18,28,28,18,18,  5, 5, 7, 7, 5, 5, 7, 7,
    // Row 0xA0..0xAF
     9, 9,11,11,22,22,11,11, 13,13,-2,-2,13,13,-2,-2,
    // Row 0xB0..0xBF
     9, 9,11,11,22,22,11,11, 13,13,-2,-2,13,13,-2,-2,
    // Row 0xC0..0xCF
     1, 1, 3, 3,16,16, 3, 3,  5, 5, 7, 7, 5, 5, 7, 7,
    // Row 0xD0..0xDF
    24,24,18,18,28,28,18,18,  5, 5, 7, 7, 5, 5, 7, 7,
    // Row 0xE0..0xEF
     9, 9,11,11,22,22,11,11, 13,13,-2,-2,13,13,-2,-2,
    // Row 0xF0..0xFF
     9, 9,11,11,22,22,11,11, 13,13,-2,-2,13,13,-2,-2,
  ];

  it('has exactly 256 entries matching C++ _shadow[] length', () => {
    expect(SHADOW_TABLE.length).toBe(256);
    expect(CPP_SHADOW.length).toBe(256);
  });

  it('every entry matches C++ _shadow[] byte-for-byte', () => {
    for (let i = 0; i < 256; i++) {
      expect(
        SHADOW_TABLE[i],
        `SHADOW_TABLE[0x${i.toString(16).padStart(2, '0')}] = ${SHADOW_TABLE[i]}, ` +
        `expected C++ _shadow[${i}] = ${CPP_SHADOW[i]}`
      ).toBe(CPP_SHADOW[i]);
    }
  });

  it('uses exactly 47 distinct values: -2, -1, and frames 1-46 (skipping 0 and 15)', () => {
    const distinct = new Set<number>();
    for (let i = 0; i < 256; i++) distinct.add(SHADOW_TABLE[i]);
    // -2, -1, plus frames 1..46 minus frame 0 and 15 = 45 frame indices + 2 special = 47
    expect(distinct.size).toBe(47);
    expect(distinct.has(-1)).toBe(true);
    expect(distinct.has(-2)).toBe(true);
    // Frame 0 and 15 are NOT referenced in the C++ table
    expect(distinct.has(0)).toBe(false);
    expect(distinct.has(15)).toBe(false);
  });

  it('only index 0x00 maps to -1 (no shadow)', () => {
    // C++ only returns -1 when all 8 neighbors are mapped (bitmask=0)
    let count = 0;
    for (let i = 0; i < 256; i++) {
      if (SHADOW_TABLE[i] === -1) count++;
    }
    expect(count).toBe(1);
    expect(SHADOW_TABLE[0]).toBe(-1);
  });

  it('solid black (-2) occurs for all fully-shrouded bitmask combinations', () => {
    // -2 entries: all cardinal directions (N,E,S,W) are unmapped, so only
    // corner variations remain. Count how many indices map to -2.
    const solidBlackIndices: number[] = [];
    for (let i = 0; i < 256; i++) {
      if (SHADOW_TABLE[i] === -2) solidBlackIndices.push(i);
    }
    // 0xFF must be among them
    expect(solidBlackIndices).toContain(0xFF);
    // Every solid-black index must have N, E, S, W bits all set
    // (the 4 cardinal edges must be unmapped for solid black)
    for (const idx of solidBlackIndices) {
      expect(
        idx & (SHADOW_BIT_N | SHADOW_BIT_E | SHADOW_BIT_S | SHADOW_BIT_W),
        `solid black index 0x${idx.toString(16)} should have all 4 cardinal bits set`
      ).toBe(SHADOW_BIT_N | SHADOW_BIT_E | SHADOW_BIT_S | SHADOW_BIT_W);
    }
  });
});

// ============================================================
// Section 2: Bit layout verification
// C++ Cell_Shadow enumeration order — display.cpp
// ============================================================
describe('bit layout matches C++ Cell_Shadow convention (display.cpp)', () => {
  it('each direction maps to the correct single-bit value', () => {
    // C++ bit layout (clockwise from NW):
    //   bit6=0x40(NW) bit7=0x80(N) bit0=0x01(NE)
    //   bit5=0x20(W)               bit1=0x02(E)
    //   bit4=0x10(SW) bit3=0x08(S) bit2=0x04(SE)
    expect(SHADOW_BIT_NW).toBe(0x40); // bit 6
    expect(SHADOW_BIT_N).toBe(0x80);  // bit 7
    expect(SHADOW_BIT_NE).toBe(0x01); // bit 0
    expect(SHADOW_BIT_W).toBe(0x20);  // bit 5
    expect(SHADOW_BIT_E).toBe(0x02);  // bit 1
    expect(SHADOW_BIT_SW).toBe(0x10); // bit 4
    expect(SHADOW_BIT_S).toBe(0x08);  // bit 3
    expect(SHADOW_BIT_SE).toBe(0x04); // bit 2
  });

  it('all 8 bits are distinct powers of 2', () => {
    const bits = [
      SHADOW_BIT_NW, SHADOW_BIT_N, SHADOW_BIT_NE,
      SHADOW_BIT_W, SHADOW_BIT_E,
      SHADOW_BIT_SW, SHADOW_BIT_S, SHADOW_BIT_SE,
    ];
    for (const b of bits) {
      expect(b & (b - 1), `0x${b.toString(16)} should be a power of 2`).toBe(0);
      expect(b).toBeGreaterThan(0);
    }
    // All distinct
    expect(new Set(bits).size).toBe(8);
  });

  it('all 8 bits OR together to exactly 0xFF (full byte coverage)', () => {
    const allBits = SHADOW_BIT_NW | SHADOW_BIT_N | SHADOW_BIT_NE |
                    SHADOW_BIT_W | SHADOW_BIT_E |
                    SHADOW_BIT_SW | SHADOW_BIT_S | SHADOW_BIT_SE;
    expect(allBits).toBe(0xFF);
  });

  it('bit ordering follows C++ clockwise enumeration: NE=low, N=high', () => {
    // C++ enumerates bits starting from NE at bit 0, going clockwise:
    // NE(0) E(1) SE(2) S(3) SW(4) W(5) NW(6) N(7)
    // This is a non-obvious ordering — N is the MSB, not bit 0
    expect(SHADOW_BIT_NE).toBe(1 << 0); // bit 0
    expect(SHADOW_BIT_E).toBe(1 << 1);  // bit 1
    expect(SHADOW_BIT_SE).toBe(1 << 2); // bit 2
    expect(SHADOW_BIT_S).toBe(1 << 3);  // bit 3
    expect(SHADOW_BIT_SW).toBe(1 << 4); // bit 4
    expect(SHADOW_BIT_W).toBe(1 << 5);  // bit 5
    expect(SHADOW_BIT_NW).toBe(1 << 6); // bit 6
    expect(SHADOW_BIT_N).toBe(1 << 7);  // bit 7
  });
});

// ============================================================
// Section 3: Key shadow transitions — bitmask -> frame index
// C++ display.cpp _shadow[] spot checks for known edge cases
// ============================================================
describe('key shadow transitions (display.cpp _shadow[])', () => {
  // ---- Boundary conditions ----
  describe('boundary: all-mapped and all-unmapped', () => {
    it('bitmask=0x00 (all neighbors mapped) -> -1 (no shadow)', () => {
      expect(SHADOW_TABLE[0x00]).toBe(-1);
    });

    it('bitmask=0xFF (all neighbors unmapped) -> -2 (solid black)', () => {
      expect(SHADOW_TABLE[0xFF]).toBe(-2);
    });
  });

  // ---- Single cardinal edge transitions ----
  describe('single cardinal edge unmapped', () => {
    const CARDINAL_CASES: [number, number, string][] = [
      [SHADOW_BIT_N,   1, 'only N unmapped -> frame 1 (top edge shadow)'],
      [SHADOW_BIT_E,   2, 'only E unmapped -> frame 2 (right edge shadow)'],
      [SHADOW_BIT_S,   4, 'only S unmapped -> frame 4 (bottom edge shadow)'],
      [SHADOW_BIT_W,   8, 'only W unmapped -> frame 8 (left edge shadow)'],
    ];

    for (const [bitmask, frame, desc] of CARDINAL_CASES) {
      it(desc, () => {
        expect(
          SHADOW_TABLE[bitmask],
          `bitmask=0x${bitmask.toString(16)} -> frame ${frame}`
        ).toBe(frame);
      });
    }
  });

  // ---- Single corner transitions ----
  describe('single corner unmapped', () => {
    const CORNER_CASES: [number, number, string][] = [
      [SHADOW_BIT_NE, 33, 'only NE unmapped -> frame 33'],
      [SHADOW_BIT_NW, 32, 'only NW unmapped -> frame 32'],
      [SHADOW_BIT_SE, 34, 'only SE unmapped -> frame 34'],
      [SHADOW_BIT_SW, 35, 'only SW unmapped -> frame 35'],
    ];

    for (const [bitmask, frame, desc] of CORNER_CASES) {
      it(desc, () => {
        expect(
          SHADOW_TABLE[bitmask],
          `bitmask=0x${bitmask.toString(16)} -> frame ${frame}`
        ).toBe(frame);
      });
    }
  });

  // ---- Compound cardinal edge transitions (two adjacent cardinals) ----
  describe('two adjacent cardinal edges unmapped', () => {
    const COMPOUND_CASES: [number, number, string][] = [
      [SHADOW_BIT_N | SHADOW_BIT_E,   3,  'N+E unmapped -> frame 3 (top-right L-shadow)'],
      [SHADOW_BIT_N | SHADOW_BIT_W,   9,  'N+W unmapped -> frame 9 (top-left L-shadow)'],
      [SHADOW_BIT_S | SHADOW_BIT_E,   6,  'S+E unmapped -> frame 6 (bottom-right L-shadow)'],
      [SHADOW_BIT_S | SHADOW_BIT_W,  12,  'S+W unmapped -> frame 12 (bottom-left L-shadow)'],
    ];

    for (const [bitmask, frame, desc] of COMPOUND_CASES) {
      it(desc, () => {
        expect(
          SHADOW_TABLE[bitmask],
          `bitmask=0x${bitmask.toString(16)} -> frame ${frame}`
        ).toBe(frame);
      });
    }
  });

  // ---- Opposite cardinal pairs ----
  describe('two opposite cardinal edges unmapped', () => {
    const OPPOSITE_CASES: [number, number, string][] = [
      [SHADOW_BIT_N | SHADOW_BIT_S,   5,  'N+S unmapped -> frame 5 (vertical strip)'],
      [SHADOW_BIT_E | SHADOW_BIT_W,  10,  'E+W unmapped -> frame 10 (horizontal strip)'],
    ];

    for (const [bitmask, frame, desc] of OPPOSITE_CASES) {
      it(desc, () => {
        expect(
          SHADOW_TABLE[bitmask],
          `bitmask=0x${bitmask.toString(16)} -> frame ${frame}`
        ).toBe(frame);
      });
    }
  });

  // ---- Three cardinal edges unmapped ----
  describe('three cardinal edges unmapped (one side exposed)', () => {
    const THREE_CARDINAL_CASES: [number, number, string][] = [
      [SHADOW_BIT_N | SHADOW_BIT_E | SHADOW_BIT_S,   7,  'N+E+S -> frame 7 (W side exposed)'],
      [SHADOW_BIT_N | SHADOW_BIT_W | SHADOW_BIT_S,  13,  'N+W+S -> frame 13 (E side exposed)'],
      [SHADOW_BIT_N | SHADOW_BIT_E | SHADOW_BIT_W,  11,  'N+E+W -> frame 11 (S side exposed)'],
      [SHADOW_BIT_E | SHADOW_BIT_S | SHADOW_BIT_W,  14,  'E+S+W -> frame 14 (N side exposed)'],
    ];

    for (const [bitmask, frame, desc] of THREE_CARDINAL_CASES) {
      it(desc, () => {
        expect(
          SHADOW_TABLE[bitmask],
          `bitmask=0x${bitmask.toString(16)} -> frame ${frame}`
        ).toBe(frame);
      });
    }
  });

  // ---- Cardinal edge + adjacent corner combinations ----
  describe('cardinal edge with adjacent corner', () => {
    const EDGE_CORNER_CASES: [number, number, string][] = [
      [SHADOW_BIT_N | SHADOW_BIT_NE,  1, 'N+NE -> frame 1 (corner absorbed by edge)'],
      [SHADOW_BIT_N | SHADOW_BIT_NW,  1, 'N+NW -> frame 1 (corner absorbed by edge)'],
      [SHADOW_BIT_E | SHADOW_BIT_NE,  2, 'E+NE -> frame 2 (corner absorbed by edge)'],
      [SHADOW_BIT_E | SHADOW_BIT_SE,  2, 'E+SE -> frame 2 (corner absorbed by edge)'],
      [SHADOW_BIT_S | SHADOW_BIT_SE,  4, 'S+SE -> frame 4 (corner absorbed by edge)'],
      [SHADOW_BIT_S | SHADOW_BIT_SW,  4, 'S+SW -> frame 4 (corner absorbed by edge)'],
      [SHADOW_BIT_W | SHADOW_BIT_NW,  8, 'W+NW -> frame 8 (corner absorbed by edge)'],
      [SHADOW_BIT_W | SHADOW_BIT_SW,  8, 'W+SW -> frame 8 (corner absorbed by edge)'],
    ];

    for (const [bitmask, frame, desc] of EDGE_CORNER_CASES) {
      it(desc, () => {
        expect(
          SHADOW_TABLE[bitmask],
          `bitmask=0x${bitmask.toString(16)} -> frame ${frame}`
        ).toBe(frame);
      });
    }
  });

  // ---- Corner + non-adjacent corner (diagonal pair) ----
  describe('two diagonal corners unmapped', () => {
    // Actual values read from C++ _shadow[] table:
    // Two corners that are NOT adjacent to the same cardinal edge get
    // dedicated compound frames (not the same as single-corner frames)
    const DIAG_CASES: [number, number, string][] = [
      [SHADOW_BIT_NE | SHADOW_BIT_SW, 45, 'NE+SW (opposite corners) -> frame 45'],
      [SHADOW_BIT_NW | SHADOW_BIT_SE, 44, 'NW+SE (opposite corners) -> frame 44'],
      [SHADOW_BIT_NE | SHADOW_BIT_SE, 37, 'NE+SE (east-side corners) -> frame 37'],
      [SHADOW_BIT_NW | SHADOW_BIT_SW, 39, 'NW+SW (west-side corners) -> frame 39'],
      [SHADOW_BIT_NE | SHADOW_BIT_NW, 36, 'NE+NW (top corners) -> frame 36'],
      [SHADOW_BIT_SE | SHADOW_BIT_SW, 38, 'SE+SW (bottom corners) -> frame 38'],
    ];

    for (const [bitmask, frame, desc] of DIAG_CASES) {
      it(`${desc} -> frame ${frame}`, () => {
        expect(SHADOW_TABLE[bitmask]).toBe(frame);
      });
    }
  });

  // ---- All four cardinals unmapped (corners vary) ----
  describe('all four cardinals unmapped, corners vary', () => {
    it('N+E+S+W (no corners) -> -2 (solid black)', () => {
      const bitmask = SHADOW_BIT_N | SHADOW_BIT_E | SHADOW_BIT_S | SHADOW_BIT_W;
      expect(SHADOW_TABLE[bitmask]).toBe(-2);
    });

    it('N+E+S+W+NE -> -2 (solid black, one corner extra)', () => {
      const bitmask = SHADOW_BIT_N | SHADOW_BIT_E | SHADOW_BIT_S | SHADOW_BIT_W | SHADOW_BIT_NE;
      expect(SHADOW_TABLE[bitmask]).toBe(-2);
    });

    it('0xFF -> -2 (solid black, all bits set)', () => {
      expect(SHADOW_TABLE[0xFF]).toBe(-2);
    });
  });

  // ---- Extended spot checks: frame indices from C++ with complex masks ----
  describe('extended C++ spot checks', () => {
    // These are hand-verified against the C++ _shadow[] table
    const EXTENDED_CHECKS: [number, number, string][] = [
      [0x41, 36, 'NW + NE -> frame 36'],
      [0x50, 39, 'NW(6) replaced by SW(4) + SW -> frame 39... actually 0x50=SW+NW'],
      [0x14, 38, 'SW + SE -> frame 38'],
      [0x05, 37, 'NE + SE -> frame 37'],
      [0x55, 46, 'NE + SE + SW + NW (all 4 corners, no cardinals) -> frame 46'],
      [0x11, 45, 'SW + NE -> frame 45'],
      [0x44, 44, 'NW + SE -> frame 44'],
      [0x15, 41, 'NE + SE + SW -> frame 41'],
      [0x45, 40, 'NE + SE + NW -> frame 40'],
      [0x54, 42, 'SW + NW + SE (3 corners) -> frame 42'],
      [0x51, 43, 'SW + NW + NE (3 corners) -> frame 43'],
    ];

    for (const [bitmask, frame, desc] of EXTENDED_CHECKS) {
      it(`0x${bitmask.toString(16).padStart(2, '0')} (${desc}) -> frame ${frame}`, () => {
        expect(SHADOW_TABLE[bitmask]).toBe(frame);
      });
    }
  });
});

// ============================================================
// Section 4: cellShadowIndex helper (C++ Cell_Shadow bitmask builder)
// C++ display.cpp Cell_Shadow() — builds 8-neighbor bitmask
// ============================================================
describe('cellShadowIndex (display.cpp Cell_Shadow bitmask builder)', () => {
  it('returns 0 when all 8 neighbors are visible (vis=2)', () => {
    expect(cellShadowIndex(5, 5, () => 2)).toBe(0);
  });

  it('returns 0 when all 8 neighbors are fogged (vis=1, still mapped)', () => {
    expect(cellShadowIndex(5, 5, () => 1)).toBe(0);
  });

  it('returns 0xFF when all 8 neighbors are shrouded (vis=0)', () => {
    expect(cellShadowIndex(5, 5, () => 0)).toBe(0xFF);
  });

  it('only vis=0 sets bits; vis=1 and vis=2 do not', () => {
    // C++ Cell_Shadow checks IsVisible() which returns false only for shroud (vis=0)
    // Fog of war (vis=1) is still "mapped" and does not create shadow
    for (const visLevel of [1, 2, 3, 255]) {
      expect(
        cellShadowIndex(5, 5, () => visLevel),
        `vis=${visLevel} should not set any bits`
      ).toBe(0);
    }
  });

  describe('each neighbor direction sets the correct single bit', () => {
    // C++ Cell_Shadow checks the 8 adjacent cells in this order:
    // (-1,-1)=NW, (0,-1)=N, (+1,-1)=NE, (-1,0)=W, (+1,0)=E,
    // (-1,+1)=SW, (0,+1)=S, (+1,+1)=SE
    const DIRECTION_CASES: [number, number, number, string][] = [
      [-1, -1, SHADOW_BIT_NW, 'NW neighbor (-1,-1) -> bit 0x40'],
      [ 0, -1, SHADOW_BIT_N,  'N neighbor (0,-1) -> bit 0x80'],
      [+1, -1, SHADOW_BIT_NE, 'NE neighbor (+1,-1) -> bit 0x01'],
      [-1,  0, SHADOW_BIT_W,  'W neighbor (-1,0) -> bit 0x20'],
      [+1,  0, SHADOW_BIT_E,  'E neighbor (+1,0) -> bit 0x02'],
      [-1, +1, SHADOW_BIT_SW, 'SW neighbor (-1,+1) -> bit 0x10'],
      [ 0, +1, SHADOW_BIT_S,  'S neighbor (0,+1) -> bit 0x08'],
      [+1, +1, SHADOW_BIT_SE, 'SE neighbor (+1,+1) -> bit 0x04'],
    ];

    for (const [dx, dy, expectedBit, desc] of DIRECTION_CASES) {
      it(desc, () => {
        const getVis = (x: number, y: number) =>
          (x === 10 + dx && y === 10 + dy) ? 0 : 2;
        expect(cellShadowIndex(10, 10, getVis)).toBe(expectedBit);
      });
    }
  });

  it('correctly combines multiple unmapped neighbors into bitmask', () => {
    // N + S + NW unmapped = 0x80 | 0x08 | 0x40 = 0xC8
    const unmapped = new Set([
      '10,9',  // N
      '10,11', // S
      '9,9',   // NW
    ]);
    const getVis = (x: number, y: number) =>
      unmapped.has(`${x},${y}`) ? 0 : 2;
    expect(cellShadowIndex(10, 10, getVis)).toBe(
      SHADOW_BIT_N | SHADOW_BIT_S | SHADOW_BIT_NW
    );
  });

  it('passes the correct neighbor coordinates to getVis', () => {
    // Record all coordinates queried by cellShadowIndex
    const queries: [number, number][] = [];
    const getVis = (x: number, y: number) => {
      queries.push([x, y]);
      return 2;
    };
    cellShadowIndex(7, 3, getVis);

    // C++ queries exactly these 8 neighbors (not the center cell itself)
    const expectedNeighbors = new Set([
      '6,2', '7,2', '8,2',  // NW, N, NE (y-1)
      '6,3',        '8,3',  // W, E (y=3)
      '6,4', '7,4', '8,4',  // SW, S, SE (y+1)
    ]);

    expect(queries.length).toBe(8);
    for (const [qx, qy] of queries) {
      expect(
        expectedNeighbors.has(`${qx},${qy}`),
        `unexpected query at (${qx},${qy})`
      ).toBe(true);
    }
    // Center cell (7,3) should NOT be queried
    expect(queries.some(([x, y]) => x === 7 && y === 3)).toBe(false);
  });

  it('works at origin (0,0) — queries negative coordinates for NW/N/NE/W/SW', () => {
    const queries: [number, number][] = [];
    const getVis = (x: number, y: number) => {
      queries.push([x, y]);
      return 2; // all mapped
    };
    cellShadowIndex(0, 0, getVis);

    // Should query negative coordinates without crashing
    expect(queries).toContainEqual([-1, -1]); // NW
    expect(queries).toContainEqual([0, -1]);  // N
    expect(queries).toContainEqual([1, -1]);  // NE
    expect(queries).toContainEqual([-1, 0]);  // W
    expect(queries).toContainEqual([1, 0]);   // E
    expect(queries).toContainEqual([-1, 1]);  // SW
    expect(queries).toContainEqual([0, 1]);   // S
    expect(queries).toContainEqual([1, 1]);   // SE
  });
});

// ============================================================
// Section 5: Symmetry properties
// The shadow table should exhibit rotational symmetry for edge frames
// ============================================================
describe('symmetry properties (display.cpp _shadow[] rotational invariants)', () => {
  it('single cardinal edge: 90-degree rotation maps to the correct rotated frame', () => {
    // N(frame 1) -> E(frame 2) -> S(frame 4) -> W(frame 8) under 90-degree CW rotation
    // These are the 4 cardinal edge shadow frames
    const n = SHADOW_TABLE[SHADOW_BIT_N];   // 1
    const e = SHADOW_TABLE[SHADOW_BIT_E];   // 2
    const s = SHADOW_TABLE[SHADOW_BIT_S];   // 4
    const w = SHADOW_TABLE[SHADOW_BIT_W];   // 8

    // Verify we get different frames for each (they are distinct shapes)
    expect(new Set([n, e, s, w]).size).toBe(4);

    // The rotated bitmask should give the rotated frame
    expect(SHADOW_TABLE[rotateCW90(SHADOW_BIT_N)]).toBe(e);  // N rotated -> E
    expect(SHADOW_TABLE[rotateCW90(SHADOW_BIT_E)]).toBe(s);  // E rotated -> S
    expect(SHADOW_TABLE[rotateCW90(SHADOW_BIT_S)]).toBe(w);  // S rotated -> W
    expect(SHADOW_TABLE[rotateCW90(SHADOW_BIT_W)]).toBe(n);  // W rotated -> N
  });

  it('single corner: 90-degree rotation maps correctly', () => {
    // NE(33) -> SE(34) -> SW(35) -> NW(32) under 90-degree CW rotation
    const ne = SHADOW_TABLE[SHADOW_BIT_NE]; // 33
    const se = SHADOW_TABLE[SHADOW_BIT_SE]; // 34
    const sw = SHADOW_TABLE[SHADOW_BIT_SW]; // 35
    const nw = SHADOW_TABLE[SHADOW_BIT_NW]; // 32

    expect(new Set([ne, se, sw, nw]).size).toBe(4);

    expect(SHADOW_TABLE[rotateCW90(SHADOW_BIT_NE)]).toBe(se);
    expect(SHADOW_TABLE[rotateCW90(SHADOW_BIT_SE)]).toBe(sw);
    expect(SHADOW_TABLE[rotateCW90(SHADOW_BIT_SW)]).toBe(nw);
    expect(SHADOW_TABLE[rotateCW90(SHADOW_BIT_NW)]).toBe(ne);
  });

  it('L-shaped pairs: rotating N+E gives E+S, etc.', () => {
    // N+E(frame 3) -> E+S(frame 6) -> S+W(frame 12) -> W+N(frame 9)
    const ne = SHADOW_BIT_N | SHADOW_BIT_E;  // frame 3
    const es = SHADOW_BIT_E | SHADOW_BIT_S;  // frame 6
    const sw = SHADOW_BIT_S | SHADOW_BIT_W;  // frame 12
    const wn = SHADOW_BIT_W | SHADOW_BIT_N;  // frame 9

    expect(SHADOW_TABLE[rotateCW90(ne)]).toBe(SHADOW_TABLE[es]);
    expect(SHADOW_TABLE[rotateCW90(es)]).toBe(SHADOW_TABLE[sw]);
    expect(SHADOW_TABLE[rotateCW90(sw)]).toBe(SHADOW_TABLE[wn]);
    expect(SHADOW_TABLE[rotateCW90(wn)]).toBe(SHADOW_TABLE[ne]);
  });

  it('opposite cardinal pairs: N+S and E+W are symmetric under 90-degree rotation', () => {
    const ns = SHADOW_BIT_N | SHADOW_BIT_S; // frame 5
    const ew = SHADOW_BIT_E | SHADOW_BIT_W; // frame 10

    // Rotating N+S by 90 gives E+W
    expect(SHADOW_TABLE[rotateCW90(ns)]).toBe(SHADOW_TABLE[ew]);
    // Rotating E+W by 90 gives N+S
    expect(SHADOW_TABLE[rotateCW90(ew)]).toBe(SHADOW_TABLE[ns]);
  });

  it('three cardinal edges: rotating gives the correct rotated triple', () => {
    // N+E+S(frame 7) -> E+S+W(frame 14) -> S+W+N(frame 13) -> W+N+E(frame 11)
    const nes = SHADOW_BIT_N | SHADOW_BIT_E | SHADOW_BIT_S;  // 7
    const esw = SHADOW_BIT_E | SHADOW_BIT_S | SHADOW_BIT_W;  // 14
    const swn = SHADOW_BIT_S | SHADOW_BIT_W | SHADOW_BIT_N;  // 13
    const wne = SHADOW_BIT_W | SHADOW_BIT_N | SHADOW_BIT_E;  // 11

    expect(SHADOW_TABLE[rotateCW90(nes)]).toBe(SHADOW_TABLE[esw]);
    expect(SHADOW_TABLE[rotateCW90(esw)]).toBe(SHADOW_TABLE[swn]);
    expect(SHADOW_TABLE[rotateCW90(swn)]).toBe(SHADOW_TABLE[wne]);
    expect(SHADOW_TABLE[rotateCW90(wne)]).toBe(SHADOW_TABLE[nes]);
  });

  it('0x00 and 0xFF are rotationally invariant', () => {
    // All-mapped and all-unmapped look the same from any rotation
    expect(SHADOW_TABLE[rotateCW90(0x00)]).toBe(SHADOW_TABLE[0x00]);
    expect(SHADOW_TABLE[rotateCW90(0xFF)]).toBe(SHADOW_TABLE[0xFF]);
  });

  it('all 4 cardinal bits set is rotationally invariant -> solid black', () => {
    const fourCardinals = SHADOW_BIT_N | SHADOW_BIT_E | SHADOW_BIT_S | SHADOW_BIT_W;
    expect(rotateCW90(fourCardinals)).toBe(fourCardinals);
    expect(SHADOW_TABLE[fourCardinals]).toBe(-2);
  });
});

// ============================================================
// Section 6: Boundary conditions — map edges and out-of-bounds neighbors
// C++ display.cpp Cell_Shadow — out-of-bounds cells are treated as shrouded
// ============================================================
describe('boundary conditions — edge cells and out-of-bounds neighbors', () => {
  it('getVis returning 0 for out-of-bounds produces correct bitmask for top-left corner', () => {
    // Cell at (0,0): NW(-1,-1), N(0,-1), NE(1,-1), W(-1,0), SW(-1,1) are out of bounds
    // If out-of-bounds returns 0 (shrouded), those 5 directions set bits
    const getVis = (x: number, y: number) => {
      if (x < 0 || y < 0) return 0; // out-of-bounds = shrouded
      return 2; // in-bounds = visible
    };
    const expected = SHADOW_BIT_NW | SHADOW_BIT_N | SHADOW_BIT_NE |
                     SHADOW_BIT_W | SHADOW_BIT_SW;
    expect(cellShadowIndex(0, 0, getVis)).toBe(expected);
  });

  it('getVis returning 0 for out-of-bounds produces correct bitmask for top-right corner', () => {
    // Cell at (127,0): NW(126,-1), N(127,-1), NE(128,-1) out of bounds (y<0),
    //                  E(128,0) out of bounds, SE(128,1) out of bounds
    const MAP_MAX = 127;
    const getVis = (x: number, y: number) => {
      if (x < 0 || y < 0 || x > MAP_MAX) return 0;
      return 2;
    };
    const expected = SHADOW_BIT_NW | SHADOW_BIT_N | SHADOW_BIT_NE |
                     SHADOW_BIT_E | SHADOW_BIT_SE;
    expect(cellShadowIndex(MAP_MAX, 0, getVis)).toBe(expected);
  });

  it('getVis returning 0 for out-of-bounds produces correct bitmask for bottom-left corner', () => {
    const MAP_MAX = 127;
    const getVis = (x: number, y: number) => {
      if (x < 0 || y > MAP_MAX) return 0;
      return 2;
    };
    const expected = SHADOW_BIT_W | SHADOW_BIT_SW | SHADOW_BIT_S |
                     SHADOW_BIT_SE | SHADOW_BIT_NW;
    // NW has x=-1, so also out of bounds
    expect(cellShadowIndex(0, MAP_MAX, getVis)).toBe(expected);
  });

  it('getVis returning 0 for out-of-bounds produces correct bitmask for bottom-right corner', () => {
    const MAP_MAX = 127;
    const getVis = (x: number, y: number) => {
      if (x > MAP_MAX || y > MAP_MAX) return 0;
      return 2;
    };
    const expected = SHADOW_BIT_E | SHADOW_BIT_SE | SHADOW_BIT_S |
                     SHADOW_BIT_NE | SHADOW_BIT_SW;
    // NE has x=128, SE has both >MAX, S has y=128, SW has y=128
    // Wait, let's be precise:
    // Cell at (127, 127):
    //   NW(126,126) -> in bounds -> vis=2
    //   N(127,126) -> in bounds -> vis=2
    //   NE(128,126) -> x>127 -> vis=0 -> NE bit
    //   W(126,127) -> in bounds -> vis=2
    //   E(128,127) -> x>127 -> vis=0 -> E bit
    //   SW(126,128) -> y>127 -> vis=0 -> SW bit
    //   S(127,128) -> y>127 -> vis=0 -> S bit
    //   SE(128,128) -> both>127 -> vis=0 -> SE bit
    const corrected = SHADOW_BIT_NE | SHADOW_BIT_E |
                      SHADOW_BIT_SW | SHADOW_BIT_S | SHADOW_BIT_SE;
    expect(cellShadowIndex(MAP_MAX, MAP_MAX, getVis)).toBe(corrected);
  });

  it('top edge: cells along y=0 have N/NW/NE neighbors at y=-1', () => {
    // All y<0 returns shroud, everything else visible
    const getVis = (_x: number, y: number) => (y < 0) ? 0 : 2;
    // For any x on the top row, the 3 northern neighbors are shrouded
    const expected = SHADOW_BIT_NW | SHADOW_BIT_N | SHADOW_BIT_NE;
    expect(cellShadowIndex(50, 0, getVis)).toBe(expected);
  });

  it('left edge: cells along x=0 have W/NW/SW neighbors at x=-1', () => {
    const getVis = (x: number, _y: number) => (x < 0) ? 0 : 2;
    const expected = SHADOW_BIT_NW | SHADOW_BIT_W | SHADOW_BIT_SW;
    expect(cellShadowIndex(0, 50, getVis)).toBe(expected);
  });

  it('cellShadowIndex does not clamp coordinates — delegates to getVis', () => {
    // The function should pass negative/large coordinates through to getVis
    // without any internal clamping — boundary handling is the caller's job
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    const getVis = (x: number, y: number) => {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      return 2;
    };
    cellShadowIndex(0, 0, getVis);
    // Should query (-1,-1) through (1,1) without clamping
    expect(minX).toBe(-1);
    expect(maxX).toBe(1);
    expect(minY).toBe(-1);
    expect(maxY).toBe(1);
  });

  it('interior cell with all neighbors visible has no shadow', () => {
    // A cell in the middle of the map with all neighbors visible
    const getVis = () => 2;
    const bitmask = cellShadowIndex(64, 64, getVis);
    expect(bitmask).toBe(0);
    expect(SHADOW_TABLE[bitmask]).toBe(-1); // no shadow
  });

  it('interior cell with all neighbors shrouded is solid black', () => {
    const getVis = () => 0;
    const bitmask = cellShadowIndex(64, 64, getVis);
    expect(bitmask).toBe(0xFF);
    expect(SHADOW_TABLE[bitmask]).toBe(-2); // solid black
  });
});

// ============================================================
// Section 7: Integration — cellShadowIndex -> SHADOW_TABLE pipeline
// Verifies the full lookup pipeline: build bitmask, then look up frame
// ============================================================
describe('full pipeline: cellShadowIndex -> SHADOW_TABLE', () => {
  it('revealed circle: center cell surrounded by visible has no shadow', () => {
    const getVis = () => 2;
    const frame = SHADOW_TABLE[cellShadowIndex(5, 5, getVis)];
    expect(frame).toBe(-1);
  });

  it('fog boundary: shroud to the north produces correct edge frame', () => {
    // Only N neighbor is shrouded
    const getVis = (x: number, y: number) =>
      (x === 5 && y === 4) ? 0 : 2;
    const bitmask = cellShadowIndex(5, 5, getVis);
    expect(bitmask).toBe(SHADOW_BIT_N);
    expect(SHADOW_TABLE[bitmask]).toBe(1); // frame 1 = north edge shadow
  });

  it('corner reveal: only NE corner is shrouded', () => {
    const getVis = (x: number, y: number) =>
      (x === 6 && y === 4) ? 0 : 2;
    const bitmask = cellShadowIndex(5, 5, getVis);
    expect(bitmask).toBe(SHADOW_BIT_NE);
    expect(SHADOW_TABLE[bitmask]).toBe(33); // frame 33 = NE corner shadow
  });

  it('L-shaped shroud: N and W shrouded produces concave shadow', () => {
    const getVis = (x: number, y: number) => {
      if (x === 5 && y === 4) return 0; // N
      if (x === 4 && y === 5) return 0; // W
      return 2;
    };
    const bitmask = cellShadowIndex(5, 5, getVis);
    expect(bitmask).toBe(SHADOW_BIT_N | SHADOW_BIT_W);
    expect(SHADOW_TABLE[bitmask]).toBe(9); // frame 9 = N+W L-shadow
  });

  it('all cardinal edges shrouded = solid black regardless of corners', () => {
    // N, E, S, W shrouded; corners visible
    const getVis = (x: number, y: number) => {
      const dx = x - 5, dy = y - 5;
      // Cardinal neighbors
      if (dx === 0 && dy === -1) return 0; // N
      if (dx === 1 && dy === 0) return 0;  // E
      if (dx === 0 && dy === 1) return 0;  // S
      if (dx === -1 && dy === 0) return 0; // W
      return 2; // corners visible
    };
    const bitmask = cellShadowIndex(5, 5, getVis);
    expect(bitmask).toBe(SHADOW_BIT_N | SHADOW_BIT_E | SHADOW_BIT_S | SHADOW_BIT_W);
    expect(SHADOW_TABLE[bitmask]).toBe(-2); // solid black
  });
});

// ============================================================
// Section 8: Corner absorption property
// C++ behavior: when a cardinal edge is shrouded, its adjacent corner
// bits don't change the frame index (the edge shadow subsumes the corner)
// ============================================================
describe('corner absorption (display.cpp _shadow[] property)', () => {
  it('N edge absorbs NW and NE corners', () => {
    // N alone, N+NW, N+NE, N+NW+NE should all give the same frame
    const nOnly = SHADOW_TABLE[SHADOW_BIT_N];
    expect(SHADOW_TABLE[SHADOW_BIT_N | SHADOW_BIT_NW]).toBe(nOnly);
    expect(SHADOW_TABLE[SHADOW_BIT_N | SHADOW_BIT_NE]).toBe(nOnly);
    expect(SHADOW_TABLE[SHADOW_BIT_N | SHADOW_BIT_NW | SHADOW_BIT_NE]).toBe(nOnly);
  });

  it('E edge absorbs NE and SE corners', () => {
    const eOnly = SHADOW_TABLE[SHADOW_BIT_E];
    expect(SHADOW_TABLE[SHADOW_BIT_E | SHADOW_BIT_NE]).toBe(eOnly);
    expect(SHADOW_TABLE[SHADOW_BIT_E | SHADOW_BIT_SE]).toBe(eOnly);
    expect(SHADOW_TABLE[SHADOW_BIT_E | SHADOW_BIT_NE | SHADOW_BIT_SE]).toBe(eOnly);
  });

  it('S edge absorbs SE and SW corners', () => {
    const sOnly = SHADOW_TABLE[SHADOW_BIT_S];
    expect(SHADOW_TABLE[SHADOW_BIT_S | SHADOW_BIT_SE]).toBe(sOnly);
    expect(SHADOW_TABLE[SHADOW_BIT_S | SHADOW_BIT_SW]).toBe(sOnly);
    expect(SHADOW_TABLE[SHADOW_BIT_S | SHADOW_BIT_SE | SHADOW_BIT_SW]).toBe(sOnly);
  });

  it('W edge absorbs NW and SW corners', () => {
    const wOnly = SHADOW_TABLE[SHADOW_BIT_W];
    expect(SHADOW_TABLE[SHADOW_BIT_W | SHADOW_BIT_NW]).toBe(wOnly);
    expect(SHADOW_TABLE[SHADOW_BIT_W | SHADOW_BIT_SW]).toBe(wOnly);
    expect(SHADOW_TABLE[SHADOW_BIT_W | SHADOW_BIT_NW | SHADOW_BIT_SW]).toBe(wOnly);
  });

  it('N+E compound absorbs all 3 adjacent corners (NW, NE, SE)', () => {
    const base = SHADOW_TABLE[SHADOW_BIT_N | SHADOW_BIT_E];
    // Adding any combination of NW, NE, SE should not change the frame
    for (let corners = 0; corners < 8; corners++) {
      let mask = SHADOW_BIT_N | SHADOW_BIT_E;
      if (corners & 1) mask |= SHADOW_BIT_NW;
      if (corners & 2) mask |= SHADOW_BIT_NE;
      if (corners & 4) mask |= SHADOW_BIT_SE;
      expect(
        SHADOW_TABLE[mask],
        `N+E + corners=${corners.toString(2)} should still be frame ${base}`
      ).toBe(base);
    }
  });

  it('all four cardinals absorb all four corners -> always solid black', () => {
    const allCardinals = SHADOW_BIT_N | SHADOW_BIT_E | SHADOW_BIT_S | SHADOW_BIT_W;
    // Adding any combination of corners should still be solid black
    for (let corners = 0; corners < 16; corners++) {
      let mask = allCardinals;
      if (corners & 1) mask |= SHADOW_BIT_NW;
      if (corners & 2) mask |= SHADOW_BIT_NE;
      if (corners & 4) mask |= SHADOW_BIT_SE;
      if (corners & 8) mask |= SHADOW_BIT_SW;
      expect(
        SHADOW_TABLE[mask],
        `all cardinals + corners=${corners.toString(2).padStart(4, '0')} -> solid black`
      ).toBe(-2);
    }
  });
});

// ============================================================
// Section 9: Frame index range and exclusion verification
// ============================================================
describe('frame index range and exclusions (display.cpp _shadow[])', () => {
  it('all frame indices are in [-2, 46]', () => {
    for (let i = 0; i < 256; i++) {
      const frame = SHADOW_TABLE[i];
      expect(frame, `index ${i}`).toBeGreaterThanOrEqual(-2);
      expect(frame, `index ${i}`).toBeLessThanOrEqual(46);
    }
  });

  it('frame 0 is never used (reserved for no-shadow in SHADOW.SHP)', () => {
    for (let i = 0; i < 256; i++) {
      expect(
        SHADOW_TABLE[i],
        `index 0x${i.toString(16)} should not be frame 0`
      ).not.toBe(0);
    }
  });

  it('frame 15 is never used (reserved in SHADOW.SHP)', () => {
    for (let i = 0; i < 256; i++) {
      expect(
        SHADOW_TABLE[i],
        `index 0x${i.toString(16)} should not be frame 15`
      ).not.toBe(15);
    }
  });

  it('every frame index 1-46 (except 15) appears at least once', () => {
    const used = new Set<number>();
    for (let i = 0; i < 256; i++) {
      if (SHADOW_TABLE[i] >= 0) used.add(SHADOW_TABLE[i]);
    }
    for (let f = 1; f <= 46; f++) {
      if (f === 15) {
        expect(used.has(f), `frame ${f} should NOT be used`).toBe(false);
      } else {
        expect(used.has(f), `frame ${f} should be used at least once`).toBe(true);
      }
    }
  });
});
