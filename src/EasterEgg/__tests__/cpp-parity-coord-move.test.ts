/**
 * C++ Behavioral Parity: Coord_Move and Desired_Facing256
 *
 * Verifies that TS moveToward() uses the same integer lepton arithmetic as
 * C++ coord.cpp Coord_Move and face.cpp Desired_Facing256.
 *
 * C++ source references:
 *   face.cpp:150-227    — Desired_Facing256: integer 256-step direction computation
 *   coord.cpp:440-554   — Move_Point: applies COS/SIN table lookup with >>7 shift
 *   coord.cpp:405-438   — calcx/calcy: (table_value * distance) >> 7 (integer)
 *   coord.cpp:442-516   — CosTable/SinTable: 256-entry signed byte lookup tables
 *
 * Key behavioral difference from the old 8-dir sinFactor approach:
 *   - Old: sinFactor = isDiagonal ? 90 : 127 (approximate)
 *   - New: COS_TABLE_256[dir256] / SIN_TABLE_256[dir256] (exact C++ tables)
 *   - NE (dir256=32): table value = 89 (not 90), giving 6 leptons at speed 10
 *   - Pure E: Desired_Facing256 returns 63 (not 64), COS[63]=126 (not 127)
 */

import { describe, it, expect } from 'vitest';
import {
  directionToLeptons256, COS_TABLE_256, SIN_TABLE_256,
} from '../engine/types';

describe('C++ Desired_Facing256 (face.cpp:150-227)', () => {
  it('pure north → dir256 = 0', () => {
    expect(directionToLeptons256(100, 100, 100, 0)).toBe(0);
  });

  it('pure south → dir256 = 127 (integer rounding effect)', () => {
    // C++ Desired_Facing256 for pure south: xdiff=0, ydiff negative
    // adder = 0x40, xdiff > ydiff? No → frac = (0x40 - 0) - 1 = 63
    // composite = 0x40 + 63 = 127, not 128
    expect(directionToLeptons256(0, 100, 0, 200)).toBe(127);
  });

  it('pure east → dir256 = 63 (not 64 — integer arithmetic effect)', () => {
    // C++ frac calculation: smaller=0, bigger=xdiff, frac=0
    // adder = 0x40 (after xdiff > ydiff xor), composite += (0x40 - 0) - 1 = 63
    expect(directionToLeptons256(0, 0, 100, 0)).toBe(63);
  });

  it('pure west → dir256 = 192', () => {
    expect(directionToLeptons256(100, 0, 0, 0)).toBe(192);
  });

  it('exact NE (equal dx/dy) → dir256 = 32', () => {
    // equal axes: frac = (smaller*32)/bigger = 32, adder=0 → composite = 32
    expect(directionToLeptons256(0, 100, 100, 0)).toBe(32);
  });

  it('exact SE (equal dx, negative dy) → dir256 = 95', () => {
    // SE: xdiff=100, ydiff=0-100=-100 (south). Result is near 96 but
    // integer frac gives 95 (same integer rounding as pure E → 63).
    expect(directionToLeptons256(0, 0, 100, 100)).toBe(95);
  });

  it('exact SW → dir256 = 160', () => {
    expect(directionToLeptons256(100, 0, 0, 100)).toBe(160);
  });

  it('exact NW → dir256 = 223', () => {
    // NW: composite starts at 0xC0 = 192, frac gives 31, total = 223
    expect(directionToLeptons256(100, 100, 0, 0)).toBe(223);
  });

  it('same position → dir256 = 0 (safe default)', () => {
    // C++ returns 0xFF for same position; we return 0 as a safe default
    expect(directionToLeptons256(50, 50, 50, 50)).toBe(0);
  });

  it('nearly-east with slight north → dir between N and E', () => {
    // xdiff=1000, ydiff=1 → nearly pure east
    const dir = directionToLeptons256(0, 1, 1000, 0);
    expect(dir).toBeGreaterThanOrEqual(60);
    expect(dir).toBeLessThanOrEqual(63);
  });

  it('asymmetric diagonal values match C++ integer arithmetic', () => {
    // NE = 32, but SE = 95 (not 96), NW = 223 (not 224)
    // This is because the frac calculation in the complementary quadrant
    // uses (adder - frac) - 1, which is off-by-one from the theoretical values.
    // Pure N=0, Pure E=63, Pure S=127, Pure W=192
    // NE=32, SE=95, SW=160, NW=223
    // The pattern: N→E spans 0..63, E→S spans 64..127, etc.
    const n = directionToLeptons256(0, 100, 0, 0);
    const e = directionToLeptons256(0, 0, 100, 0);
    const ne = directionToLeptons256(0, 100, 100, 0);
    expect(n).toBe(0);
    expect(ne).toBe(32);
    expect(e).toBe(63);
  });
});

describe('C++ Coord_Move calcx/calcy (coord.cpp:405-438)', () => {
  it('cardinal N: COS=0, SIN=127 → moves only in Y', () => {
    const dir = 0;
    const distance = 10;
    const dx = (COS_TABLE_256[dir] * distance) >> 7;
    const dy = -((SIN_TABLE_256[dir] * distance) >> 7);
    expect(dx).toBe(0);
    expect(dy).toBe(-9); // -(127*10>>7) = -9
  });

  it('cardinal E (dir=64): COS=127, SIN=0 → moves only in X', () => {
    const dir = 64;
    const distance = 10;
    const dx = (COS_TABLE_256[dir] * distance) >> 7;
    const dy = -((SIN_TABLE_256[dir] * distance) >> 7);
    expect(dx).toBe(9); // (127*10)>>7 = 9
    expect(dy + 0).toBe(0); // +0 coerces JS -0 to 0
  });

  it('diagonal NE (dir=32): COS=89, SIN=89 → 6 leptons per axis at dist=10', () => {
    // This was the key discrepancy: old code used sinFactor=90 giving 7
    const dir = 32;
    const distance = 10;
    const dx = (COS_TABLE_256[dir] * distance) >> 7;
    const dy = -((SIN_TABLE_256[dir] * distance) >> 7);
    expect(dx).toBe(6); // (89*10)>>7 = 890>>7 = 6
    expect(dy).toBe(-6);
  });

  it('diagonal SE (dir=96): calcy negation asymmetry with negative SIN', () => {
    // COS[96]=89, SIN[96]=-89
    // calcx(89, 20) = (89*20)>>7 = 1780>>7 = 13
    // calcy(-89, 20) = -((-89*20)>>7) = -((-1780)>>7) = -(-14) = 14
    // Arithmetic right shift of negative numbers rounds toward -infinity
    const dir = 96;
    const distance = 20;
    const dx = (COS_TABLE_256[dir] * distance) >> 7;
    const dy = -((SIN_TABLE_256[dir] * distance) >> 7);
    expect(dx).toBe(13);
    expect(dy).toBe(14); // 1 lepton more due to signed shift + negation
  });

  it('pure east via Desired_Facing256 (dir=63): COS=126, not 127', () => {
    // Desired_Facing256 for pure east gives 63, not 64.
    // COS_TABLE_256[63] = 126, which means movement is slightly less than
    // with the theoretical COS[64]=127.
    expect(COS_TABLE_256[63]).toBe(126);
    expect(COS_TABLE_256[64]).toBe(127);
    // At distance=80: 126*80>>7 = 78 vs 127*80>>7 = 79 (1 lepton difference)
    expect((COS_TABLE_256[63] * 80) >> 7).toBe(78);
    expect((COS_TABLE_256[64] * 80) >> 7).toBe(79);
  });

  it('COS table has 256 entries in [-126..127] range', () => {
    expect(COS_TABLE_256.length).toBe(256);
    for (let i = 0; i < 256; i++) {
      expect(COS_TABLE_256[i]).toBeGreaterThanOrEqual(-126);
      expect(COS_TABLE_256[i]).toBeLessThanOrEqual(127);
    }
  });

  it('SIN table has 256 entries in [-126..127] range', () => {
    expect(SIN_TABLE_256.length).toBe(256);
    for (let i = 0; i < 256; i++) {
      expect(SIN_TABLE_256[i]).toBeGreaterThanOrEqual(-126);
      expect(SIN_TABLE_256[i]).toBeLessThanOrEqual(127);
    }
  });
});
