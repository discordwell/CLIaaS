/**
 * C++ Behavioral Parity Tests — shadow.ts vs display.cpp Cell_Shadow()
 *
 * Ground truth: the static `_shadow[256]` array from display.cpp lines 1318-1354,
 * and the bit assignments from lines 1384-1399 of Cell_Shadow().
 *
 * C++ reference: CnC_and_Red_Alert/RA/display.cpp:1316-1404
 *
 * Bit layout (from display.cpp:1381-1382, 1384-1399):
 *   "Bit numbering starts at the upper-right corner and goes around the cell
 *    clockwise, so 0x80 = directly north."
 *
 *   Pointer walk from (cell - MAP_CELL_W - 1):
 *     NW → 0x40   (line 1385)
 *     N  → 0x80   (line 1387)
 *     NE → 0x01   (line 1389)
 *     W  → 0x20   (line 1391)
 *     E  → 0x02   (line 1393)
 *     SW → 0x10   (line 1395)
 *     S  → 0x08   (line 1397)
 *     SE → 0x04   (line 1399)
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
// C++ ground truth — verbatim from display.cpp:1318-1354
// ============================================================

/**
 * Exact copy of the C++ `_shadow[256]` array.
 * Source: display.cpp lines 1318-1354
 *
 * ```cpp
 * static signed char const _shadow[256]={
 *   -1,33, 2, 2,34,37, 2, 2,
 *    4,26, 6, 6, 4,26, 6, 6,
 *   35,45,17,17,38,41,17,17,
 *    4,26, 6, 6, 4,26, 6, 6,
 *    8,21,10,10,27,31,10,10,
 *   12,23,14,14,12,23,14,14,
 *    8,21,10,10,27,31,10,10,
 *   12,23,14,14,12,23,14,14,
 *
 *   32,36,25,25,44,40,25,25,
 *   19,30,20,20,19,30,20,20,
 *   39,43,29,29,42,46,29,29,
 *   19,30,20,20,19,30,20,20,
 *    8,21,10,10,27,31,10,10,
 *   12,23,14,14,12,23,14,14,
 *    8,21,10,10,27,31,10,10,
 *   12,23,14,14,12,23,14,14,
 *
 *    1, 1, 3, 3,16,16, 3, 3,
 *    5, 5, 7, 7, 5, 5, 7, 7,
 *   24,24,18,18,28,28,18,18,
 *    5, 5, 7, 7, 5, 5, 7, 7,
 *    9, 9,11,11,22,22,11,11,
 *   13,13,-2,-2,13,13,-2,-2,
 *    9, 9,11,11,22,22,11,11,
 *   13,13,-2,-2,13,13,-2,-2,
 *
 *    1, 1, 3, 3,16,16, 3, 3,
 *    5, 5, 7, 7, 5, 5, 7, 7,
 *   24,24,18,18,28,28,18,18,
 *    5, 5, 7, 7, 5, 5, 7, 7,
 *    9, 9,11,11,22,22,11,11,
 *   13,13,-2,-2,13,13,-2,-2,
 *    9, 9,11,11,22,22,11,11,
 *   13,13,-2,-2,13,13,-2,-2
 * };
 * ```
 */
const CPP_SHADOW: readonly number[] = [
  // display.cpp:1319-1326
  -1,33, 2, 2,34,37, 2, 2,
   4,26, 6, 6, 4,26, 6, 6,
  35,45,17,17,38,41,17,17,
   4,26, 6, 6, 4,26, 6, 6,
   8,21,10,10,27,31,10,10,
  12,23,14,14,12,23,14,14,
   8,21,10,10,27,31,10,10,
  12,23,14,14,12,23,14,14,

  // display.cpp:1328-1335
  32,36,25,25,44,40,25,25,
  19,30,20,20,19,30,20,20,
  39,43,29,29,42,46,29,29,
  19,30,20,20,19,30,20,20,
   8,21,10,10,27,31,10,10,
  12,23,14,14,12,23,14,14,
   8,21,10,10,27,31,10,10,
  12,23,14,14,12,23,14,14,

  // display.cpp:1337-1344
   1, 1, 3, 3,16,16, 3, 3,
   5, 5, 7, 7, 5, 5, 7, 7,
  24,24,18,18,28,28,18,18,
   5, 5, 7, 7, 5, 5, 7, 7,
   9, 9,11,11,22,22,11,11,
  13,13,-2,-2,13,13,-2,-2,
   9, 9,11,11,22,22,11,11,
  13,13,-2,-2,13,13,-2,-2,

  // display.cpp:1346-1353
   1, 1, 3, 3,16,16, 3, 3,
   5, 5, 7, 7, 5, 5, 7, 7,
  24,24,18,18,28,28,18,18,
   5, 5, 7, 7, 5, 5, 7, 7,
   9, 9,11,11,22,22,11,11,
  13,13,-2,-2,13,13,-2,-2,
   9, 9,11,11,22,22,11,11,
  13,13,-2,-2,13,13,-2,-2,
];

// ============================================================
// C++ bit position ground truth — display.cpp:1384-1399
// ============================================================
const CPP_BIT_NW = 0x40; // line 1385
const CPP_BIT_N  = 0x80; // line 1387
const CPP_BIT_NE = 0x01; // line 1389
const CPP_BIT_W  = 0x20; // line 1391
const CPP_BIT_E  = 0x02; // line 1393
const CPP_BIT_SW = 0x10; // line 1395
const CPP_BIT_S  = 0x08; // line 1397
const CPP_BIT_SE = 0x04; // line 1399

// ============================================================
// Section 1: Full 256-entry table comparison — byte-for-byte
// ============================================================
describe('full 256-entry table: C++ _shadow[] vs TS SHADOW_TABLE (display.cpp:1318-1354)', () => {
  it('C++ ground truth array has exactly 256 entries', () => {
    expect(CPP_SHADOW.length).toBe(256);
  });

  it('TS SHADOW_TABLE has exactly 256 entries', () => {
    expect(SHADOW_TABLE.length).toBe(256);
  });

  it('byte-for-byte parity: every entry matches C++ _shadow[]', () => {
    const mismatches: string[] = [];
    for (let i = 0; i < 256; i++) {
      if (SHADOW_TABLE[i] !== CPP_SHADOW[i]) {
        mismatches.push(
          `index ${i} (0x${i.toString(16).padStart(2, '0')}): ` +
          `C++=${CPP_SHADOW[i]}, TS=${SHADOW_TABLE[i]}`
        );
      }
    }
    expect(mismatches, `PARITY GAPS:\n${mismatches.join('\n')}`).toHaveLength(0);
  });

  // Break table into 4 quadrants of 64 entries each for finer diagnostics
  it('quadrant 0 (indices 0-63) matches C++', () => {
    for (let i = 0; i < 64; i++) {
      expect(
        SHADOW_TABLE[i],
        `index ${i} (0x${i.toString(16).padStart(2, '0')}): C++=${CPP_SHADOW[i]}`
      ).toBe(CPP_SHADOW[i]);
    }
  });

  it('quadrant 1 (indices 64-127) matches C++', () => {
    for (let i = 64; i < 128; i++) {
      expect(
        SHADOW_TABLE[i],
        `index ${i} (0x${i.toString(16).padStart(2, '0')}): C++=${CPP_SHADOW[i]}`
      ).toBe(CPP_SHADOW[i]);
    }
  });

  it('quadrant 2 (indices 128-191) matches C++', () => {
    for (let i = 128; i < 192; i++) {
      expect(
        SHADOW_TABLE[i],
        `index ${i} (0x${i.toString(16).padStart(2, '0')}): C++=${CPP_SHADOW[i]}`
      ).toBe(CPP_SHADOW[i]);
    }
  });

  it('quadrant 3 (indices 192-255) matches C++', () => {
    for (let i = 192; i < 256; i++) {
      expect(
        SHADOW_TABLE[i],
        `index ${i} (0x${i.toString(16).padStart(2, '0')}): C++=${CPP_SHADOW[i]}`
      ).toBe(CPP_SHADOW[i]);
    }
  });
});

// ============================================================
// Section 2: Bit layout parity — display.cpp:1384-1399
// ============================================================
describe('bit position constants: C++ display.cpp:1384-1399 vs TS shadow.ts', () => {
  it('SHADOW_BIT_NW matches C++ 0x40 (display.cpp:1385)', () => {
    expect(SHADOW_BIT_NW).toBe(CPP_BIT_NW);
  });

  it('SHADOW_BIT_N matches C++ 0x80 (display.cpp:1387)', () => {
    expect(SHADOW_BIT_N).toBe(CPP_BIT_N);
  });

  it('SHADOW_BIT_NE matches C++ 0x01 (display.cpp:1389)', () => {
    expect(SHADOW_BIT_NE).toBe(CPP_BIT_NE);
  });

  it('SHADOW_BIT_W matches C++ 0x20 (display.cpp:1391)', () => {
    expect(SHADOW_BIT_W).toBe(CPP_BIT_W);
  });

  it('SHADOW_BIT_E matches C++ 0x02 (display.cpp:1393)', () => {
    expect(SHADOW_BIT_E).toBe(CPP_BIT_E);
  });

  it('SHADOW_BIT_SW matches C++ 0x10 (display.cpp:1395)', () => {
    expect(SHADOW_BIT_SW).toBe(CPP_BIT_SW);
  });

  it('SHADOW_BIT_S matches C++ 0x08 (display.cpp:1397)', () => {
    expect(SHADOW_BIT_S).toBe(CPP_BIT_S);
  });

  it('SHADOW_BIT_SE matches C++ 0x04 (display.cpp:1399)', () => {
    expect(SHADOW_BIT_SE).toBe(CPP_BIT_SE);
  });

  it('all 8 C++ bits OR to exactly 0xFF', () => {
    const allCpp = CPP_BIT_NW | CPP_BIT_N | CPP_BIT_NE |
                   CPP_BIT_W | CPP_BIT_E |
                   CPP_BIT_SW | CPP_BIT_S | CPP_BIT_SE;
    expect(allCpp).toBe(0xFF);
  });

  it('all 8 TS bits OR to exactly 0xFF', () => {
    const allTs = SHADOW_BIT_NW | SHADOW_BIT_N | SHADOW_BIT_NE |
                  SHADOW_BIT_W | SHADOW_BIT_E |
                  SHADOW_BIT_SW | SHADOW_BIT_S | SHADOW_BIT_SE;
    expect(allTs).toBe(0xFF);
  });

  it('all 8 bit positions are distinct powers or non-overlapping', () => {
    const bits = [
      SHADOW_BIT_NW, SHADOW_BIT_N, SHADOW_BIT_NE,
      SHADOW_BIT_W, SHADOW_BIT_E,
      SHADOW_BIT_SW, SHADOW_BIT_S, SHADOW_BIT_SE,
    ];
    // Each bit should be a single bit (power of 2)
    for (const b of bits) {
      expect(b & (b - 1), `0x${b.toString(16)} is not a power of 2`).toBe(0);
      expect(b, `bit should be > 0`).toBeGreaterThan(0);
    }
    // All 8 should be distinct
    const uniqueBits = new Set(bits);
    expect(uniqueBits.size).toBe(8);
  });
});

// ============================================================
// Section 3: Key bitmask → frame transitions from C++ table
// These are derived by reading C++ _shadow[] at specific indices
// ============================================================
describe('key bitmask → frame transitions (derived from C++ _shadow[])', () => {
  // ---- Single-neighbor cases ----
  // When only one neighbor is unmapped, the C++ table gives a specific frame
  const SINGLE_NEIGHBOR_CASES: [string, number, number][] = [
    // [description, bitmask, C++ _shadow[bitmask]]
    ['only NE unmapped',  CPP_BIT_NE,  CPP_SHADOW[CPP_BIT_NE]],   // 0x01 → 33
    ['only E unmapped',   CPP_BIT_E,   CPP_SHADOW[CPP_BIT_E]],    // 0x02 → 2
    ['only SE unmapped',  CPP_BIT_SE,  CPP_SHADOW[CPP_BIT_SE]],   // 0x04 → 34
    ['only S unmapped',   CPP_BIT_S,   CPP_SHADOW[CPP_BIT_S]],    // 0x08 → 4
    ['only SW unmapped',  CPP_BIT_SW,  CPP_SHADOW[CPP_BIT_SW]],   // 0x10 → 35
    ['only W unmapped',   CPP_BIT_W,   CPP_SHADOW[CPP_BIT_W]],    // 0x20 → 8
    ['only NW unmapped',  CPP_BIT_NW,  CPP_SHADOW[CPP_BIT_NW]],   // 0x40 → 32
    ['only N unmapped',   CPP_BIT_N,   CPP_SHADOW[CPP_BIT_N]],    // 0x80 → 1
  ];

  for (const [desc, mask, cppValue] of SINGLE_NEIGHBOR_CASES) {
    it(`${desc} (0x${mask.toString(16).padStart(2, '0')}) → frame ${cppValue}`, () => {
      expect(SHADOW_TABLE[mask]).toBe(cppValue);
    });
  }

  // ---- Cardinal edge pairs ----
  const CARDINAL_PAIRS: [string, number, number][] = [
    ['N+W unmapped',  CPP_BIT_N | CPP_BIT_W,  CPP_SHADOW[CPP_BIT_N | CPP_BIT_W]],   // 0xA0 → 9
    ['N+E unmapped',  CPP_BIT_N | CPP_BIT_E,  CPP_SHADOW[CPP_BIT_N | CPP_BIT_E]],   // 0x82 → 3
    ['S+W unmapped',  CPP_BIT_S | CPP_BIT_W,  CPP_SHADOW[CPP_BIT_S | CPP_BIT_W]],   // 0x28 → 12
    ['S+E unmapped',  CPP_BIT_S | CPP_BIT_E,  CPP_SHADOW[CPP_BIT_S | CPP_BIT_E]],   // 0x0A → 6
  ];

  for (const [desc, mask, cppValue] of CARDINAL_PAIRS) {
    it(`${desc} (0x${mask.toString(16).padStart(2, '0')}) → frame ${cppValue}`, () => {
      expect(SHADOW_TABLE[mask]).toBe(cppValue);
    });
  }

  // ---- Terminal cases ----
  it('all neighbors mapped (0x00) → -1 (no shadow)', () => {
    expect(SHADOW_TABLE[0x00]).toBe(-1);
    expect(CPP_SHADOW[0x00]).toBe(-1);
  });

  it('all neighbors unmapped (0xFF) → -2 (solid black)', () => {
    expect(SHADOW_TABLE[0xFF]).toBe(-2);
    expect(CPP_SHADOW[0xFF]).toBe(-2);
  });

  // ---- Full cardinal directions (all four of one side + corners) ----
  it('entire north side unmapped (N+NW+NE = 0xC1): C++ returns frame 1 (same as N-only)', () => {
    // C++ _shadow[0xC1] = 1 — diagonal corners don't change the shadow frame
    // when the adjacent cardinal (N) is already unmapped.
    const mask = CPP_BIT_N | CPP_BIT_NW | CPP_BIT_NE; // 0x80 | 0x40 | 0x01 = 0xC1
    expect(SHADOW_TABLE[mask]).toBe(CPP_SHADOW[mask]);
    expect(CPP_SHADOW[mask]).toBe(1);
  });

  it('entire south side unmapped (S+SW+SE = 0x1C): C++ returns frame 4 (same as S-only)', () => {
    // C++ _shadow[0x1C] = 4 — diagonal corners are subsumed by the cardinal S edge
    const mask = CPP_BIT_S | CPP_BIT_SW | CPP_BIT_SE; // 0x08 | 0x10 | 0x04 = 0x1C
    expect(SHADOW_TABLE[mask]).toBe(CPP_SHADOW[mask]);
    expect(CPP_SHADOW[mask]).toBe(4);
  });

  it('entire west side unmapped (W+NW+SW = 0x70): C++ returns frame 8 (same as W-only)', () => {
    // C++ _shadow[0x70] = 8 — diagonal corners are subsumed by the cardinal W edge
    const mask = CPP_BIT_W | CPP_BIT_NW | CPP_BIT_SW; // 0x20 | 0x40 | 0x10 = 0x70
    expect(SHADOW_TABLE[mask]).toBe(CPP_SHADOW[mask]);
    expect(CPP_SHADOW[mask]).toBe(8);
  });

  it('entire east side unmapped (E+NE+SE = 0x07): C++ returns frame 2 (same as E-only)', () => {
    // C++ _shadow[0x07] = 2 — diagonal corners are subsumed by the cardinal E edge
    const mask = CPP_BIT_E | CPP_BIT_NE | CPP_BIT_SE; // 0x02 | 0x01 | 0x04 = 0x07
    expect(SHADOW_TABLE[mask]).toBe(CPP_SHADOW[mask]);
    expect(CPP_SHADOW[0x07]).toBe(2);
  });

  it('frame 16 at index 0x84 (N+SE): diagonal corners create unique shadow shapes', () => {
    // C++ _shadow[0x84] = 16. Index 0x84 = N(0x80) + SE(0x04).
    // Frame 16 appears at: 0x84, 0x85, 0xC4, 0xC5
    expect(CPP_SHADOW[0x84]).toBe(16);
    expect(SHADOW_TABLE[0x84]).toBe(CPP_SHADOW[0x84]);
  });

  it('frame 27 at index 0x24 (W+SE): cross-diagonal shadow', () => {
    // C++ _shadow[0x24] = 27. Index 0x24 = W(0x20) + SE(0x04).
    // Frame 27 appears at: 0x24, 0x34, 0x64, 0x74
    expect(CPP_SHADOW[0x24]).toBe(27);
    expect(SHADOW_TABLE[0x24]).toBe(CPP_SHADOW[0x24]);
  });

  it('frame 39 at index 0x50 (NW+SW): both west corners without W cardinal', () => {
    // C++ _shadow[0x50] = 39. Index 0x50 = NW(0x40) + SW(0x10).
    // Frame 39 only appears at index 0x50
    expect(CPP_SHADOW[0x50]).toBe(39);
    expect(SHADOW_TABLE[0x50]).toBe(CPP_SHADOW[0x50]);
  });

  it('frame 38 at index 0x14 (SW+SE): both south corners without S cardinal', () => {
    // C++ _shadow[0x14] = 38. Index 0x14 = SW(0x10) + SE(0x04).
    expect(CPP_SHADOW[0x14]).toBe(38);
    expect(SHADOW_TABLE[0x14]).toBe(CPP_SHADOW[0x14]);
  });
});

// ============================================================
// Section 4: cellShadowIndex — TS helper vs C++ Cell_Shadow bitmask logic
// C++ display.cpp:1384-1399
// ============================================================
describe('cellShadowIndex: TS bitmask builder vs C++ Cell_Shadow logic (display.cpp:1384-1399)', () => {
  /**
   * C++ builds the index by pointer-walking 8 neighbors starting from NW,
   * checking `!cellptr->IsMapped` and OR-ing the corresponding bit.
   * TS uses getVis(x,y) === 0 as the equivalent of `!IsMapped`.
   */

  it('all mapped → index 0 (C++ line 1356: "int index = 0")', () => {
    // All neighbors mapped: no bits set
    const idx = cellShadowIndex(5, 5, () => 1);
    expect(idx).toBe(0);
  });

  it('all unmapped → index 0xFF', () => {
    const idx = cellShadowIndex(5, 5, () => 0);
    expect(idx).toBe(0xFF);
  });

  // Verify each direction maps to the correct C++ bit
  const DIRECTION_TESTS: [string, number, number, number][] = [
    // [name, dx, dy, expected C++ bit]
    ['NW', -1, -1, CPP_BIT_NW],
    ['N',   0, -1, CPP_BIT_N],
    ['NE',  1, -1, CPP_BIT_NE],
    ['W',  -1,  0, CPP_BIT_W],
    ['E',   1,  0, CPP_BIT_E],
    ['SW', -1,  1, CPP_BIT_SW],
    ['S',   0,  1, CPP_BIT_S],
    ['SE',  1,  1, CPP_BIT_SE],
  ];

  for (const [name, dx, dy, expectedBit] of DIRECTION_TESTS) {
    it(`${name} unmapped at (cx${dx >= 0 ? '+' : ''}${dx}, cy${dy >= 0 ? '+' : ''}${dy}) sets bit 0x${expectedBit.toString(16).padStart(2, '0')}`, () => {
      const cx = 10, cy = 10;
      const getVis = (x: number, y: number) =>
        (x === cx + dx && y === cy + dy) ? 0 : 2;
      const idx = cellShadowIndex(cx, cy, getVis);
      expect(idx).toBe(expectedBit);
    });
  }

  it('C++ pointer walk order: NW→N→NE→W→E→SW→S→SE produces correct composite', () => {
    // Unmapped: NW, E, S (C++ would set 0x40 | 0x02 | 0x08 = 0x4A)
    const cx = 10, cy = 10;
    const unmapped = new Set([
      `${cx - 1},${cy - 1}`, // NW
      `${cx + 1},${cy}`,     // E
      `${cx},${cy + 1}`,     // S
    ]);
    const getVis = (x: number, y: number) => unmapped.has(`${x},${y}`) ? 0 : 2;
    const idx = cellShadowIndex(cx, cy, getVis);
    expect(idx).toBe(CPP_BIT_NW | CPP_BIT_E | CPP_BIT_S);
    expect(idx).toBe(0x4A);
  });

  it('visibility=1 (fog) counts as mapped (not shrouded), same as C++ IsMapped=true', () => {
    // C++ checks `!cellptr->IsMapped`; IsMapped=true means the cell IS mapped.
    // In TS, vis=1 means fog (mapped), vis=0 means shroud (unmapped).
    const cx = 10, cy = 10;
    // All neighbors have vis=1 (fog), only center N has vis=0 (shroud)
    const getVis = (x: number, y: number) => {
      if (x === cx && y === cy - 1) return 0; // N = shroud
      return 1; // fog = mapped
    };
    const idx = cellShadowIndex(cx, cy, getVis);
    expect(idx).toBe(CPP_BIT_N);
  });

  it('visibility=2 (fully visible) also counts as mapped', () => {
    const cx = 10, cy = 10;
    const getVis = (x: number, y: number) => {
      if (x === cx + 1 && y === cy + 1) return 0; // SE = shroud
      return 2; // visible = mapped
    };
    const idx = cellShadowIndex(cx, cy, getVis);
    expect(idx).toBe(CPP_BIT_SE);
  });
});

// ============================================================
// Section 5: End-to-end — cellShadowIndex → SHADOW_TABLE lookup vs C++
// ============================================================
describe('end-to-end: cellShadowIndex → SHADOW_TABLE vs C++ _shadow[] (display.cpp:1401)', () => {
  /**
   * C++ display.cpp:1401: value = _shadow[index];
   * We replicate the full Cell_Shadow flow: build bitmask, then look up.
   */

  it('all mapped → SHADOW_TABLE[0] = -1 (no shadow needed)', () => {
    const idx = cellShadowIndex(5, 5, () => 2);
    expect(SHADOW_TABLE[idx]).toBe(-1);
  });

  it('all shrouded → SHADOW_TABLE[0xFF] = -2 (solid black)', () => {
    const idx = cellShadowIndex(5, 5, () => 0);
    expect(SHADOW_TABLE[idx]).toBe(-2);
  });

  it('only N shrouded → frame 1 (edge shadow at top)', () => {
    const cx = 5, cy = 5;
    const getVis = (x: number, y: number) =>
      (x === cx && y === cy - 1) ? 0 : 2;
    const idx = cellShadowIndex(cx, cy, getVis);
    expect(idx).toBe(0x80);
    expect(SHADOW_TABLE[idx]).toBe(1);
    expect(SHADOW_TABLE[idx]).toBe(CPP_SHADOW[idx]);
  });

  it('only S shrouded → frame 4 (edge shadow at bottom)', () => {
    const cx = 5, cy = 5;
    const getVis = (x: number, y: number) =>
      (x === cx && y === cy + 1) ? 0 : 2;
    const idx = cellShadowIndex(cx, cy, getVis);
    expect(idx).toBe(0x08);
    expect(SHADOW_TABLE[idx]).toBe(4);
    expect(SHADOW_TABLE[idx]).toBe(CPP_SHADOW[idx]);
  });

  it('N+W shrouded → frame 9 (NW corner shadow)', () => {
    const cx = 5, cy = 5;
    const getVis = (x: number, y: number) => {
      if (x === cx && y === cy - 1) return 0;     // N
      if (x === cx - 1 && y === cy) return 0;     // W
      return 2;
    };
    const idx = cellShadowIndex(cx, cy, getVis);
    expect(idx).toBe(CPP_BIT_N | CPP_BIT_W); // 0xA0
    expect(SHADOW_TABLE[idx]).toBe(9);
    expect(SHADOW_TABLE[idx]).toBe(CPP_SHADOW[idx]);
  });

  it('S+E shrouded → frame 6 (SE corner shadow)', () => {
    const cx = 5, cy = 5;
    const getVis = (x: number, y: number) => {
      if (x === cx && y === cy + 1) return 0;     // S
      if (x === cx + 1 && y === cy) return 0;     // E
      return 2;
    };
    const idx = cellShadowIndex(cx, cy, getVis);
    expect(idx).toBe(CPP_BIT_S | CPP_BIT_E); // 0x0A
    expect(SHADOW_TABLE[idx]).toBe(6);
    expect(SHADOW_TABLE[idx]).toBe(CPP_SHADOW[idx]);
  });
});

// ============================================================
// Section 6: Table structural properties (from C++ analysis)
// ============================================================
describe('C++ table structural properties', () => {
  it('index 0 is the ONLY entry returning -1 (no shadow)', () => {
    // C++ _shadow[0] = -1; all other entries are >= -2
    const noShadowIndices: number[] = [];
    for (let i = 0; i < 256; i++) {
      if (CPP_SHADOW[i] === -1) noShadowIndices.push(i);
    }
    expect(noShadowIndices).toEqual([0]);

    // TS must match
    const tsNoShadow: number[] = [];
    for (let i = 0; i < 256; i++) {
      if (SHADOW_TABLE[i] === -1) tsNoShadow.push(i);
    }
    expect(tsNoShadow).toEqual([0]);
  });

  it('C++ uses frames 1-46 (skipping 0 and 15)', () => {
    const cppFrames = new Set<number>();
    for (let i = 0; i < 256; i++) {
      if (CPP_SHADOW[i] >= 0) cppFrames.add(CPP_SHADOW[i]);
    }

    // Frame 0 is not used (would conflict with "no shadow")
    expect(cppFrames.has(0)).toBe(false);
    // Frame 15 is not used in the C++ table
    expect(cppFrames.has(15)).toBe(false);
    // Frames 1-14 and 16-46 should all be present (45 frames total)
    expect(cppFrames.size).toBe(45);

    // TS must use exactly the same set of frame indices
    const tsFrames = new Set<number>();
    for (let i = 0; i < 256; i++) {
      if (SHADOW_TABLE[i] >= 0) tsFrames.add(SHADOW_TABLE[i]);
    }
    expect(tsFrames.size).toBe(cppFrames.size);
    for (const f of cppFrames) {
      expect(tsFrames.has(f), `TS missing frame ${f}`).toBe(true);
    }
  });

  it('C++ table upper half (indices 128-255) mirrors lower half (0-127) for N-bit', () => {
    // The N bit (0x80) divides the table into two halves.
    // Indices 128-255 have N=unmapped. Within each half, the same 7-bit
    // pattern repeats. Let's verify the C++ table has this structure.
    // Specifically: _shadow[i] === _shadow[i + 128] for i in [128..191]
    // (The upper two quadrants are identical pairs)
    for (let i = 128; i < 192; i++) {
      expect(
        CPP_SHADOW[i],
        `C++ upper half mirror at ${i}: ${CPP_SHADOW[i]} vs ${CPP_SHADOW[i + 64]}`
      ).toBe(CPP_SHADOW[i + 64]);
    }
    // Also verify TS matches this structure
    for (let i = 128; i < 192; i++) {
      expect(
        SHADOW_TABLE[i],
        `TS upper half mirror at ${i}: ${SHADOW_TABLE[i]} vs ${SHADOW_TABLE[i + 64]}`
      ).toBe(SHADOW_TABLE[i + 64]);
    }
  });

  it('-2 (solid black) entries count matches between C++ and TS', () => {
    let cppCount = 0;
    let tsCount = 0;
    const cppBlackIndices: number[] = [];
    const tsBlackIndices: number[] = [];

    for (let i = 0; i < 256; i++) {
      if (CPP_SHADOW[i] === -2) { cppCount++; cppBlackIndices.push(i); }
      if (SHADOW_TABLE[i] === -2) { tsCount++; tsBlackIndices.push(i); }
    }

    expect(tsCount, 'solid-black entry count mismatch').toBe(cppCount);
    expect(tsBlackIndices).toEqual(cppBlackIndices);
  });
});

// ============================================================
// Section 7: C++ Cell_Shadow initial value logic (display.cpp:1356, 1375-1377)
// ============================================================
describe('Cell_Shadow initial value logic (display.cpp:1356, 1375-1377)', () => {
  /**
   * C++ logic:
   *   int index = 0, value = -1;                          // line 1356
   *   if (!cellptr->IsVisible && !cellptr->IsMapped)       // line 1375
   *     value = -2;
   *   if (cellptr->IsMapped) { ... build index ... }       // line 1377
   *
   * This means:
   *   - If cell itself is unmapped AND invisible → return -2 (solid black)
   *   - If cell itself is mapped → compute shadow from neighbors
   *   - The function only queries neighbors when the cell itself is mapped
   *
   * The TS cellShadowIndex function only builds the bitmask; it does NOT
   * handle the "is this cell itself mapped" logic. That's the caller's
   * responsibility. This test documents that architectural difference.
   */

  it('cellShadowIndex is a pure bitmask builder — caller handles cell-self logic', () => {
    // cellShadowIndex always returns a value [0, 255], never -1 or -2
    const idx = cellShadowIndex(5, 5, () => 2);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThanOrEqual(255);
  });

  it('SHADOW_TABLE handles -2 for solid black (C++ line 1375 equivalent)', () => {
    // When index indicates "surrounded by unmapped," table returns -2
    // This is the table's equivalent of the C++ solid-black case
    expect(SHADOW_TABLE[0xFF]).toBe(-2);
  });

  it('SHADOW_TABLE handles -1 for no shadow (C++ line 1356 default equivalent)', () => {
    expect(SHADOW_TABLE[0x00]).toBe(-1);
  });
});
