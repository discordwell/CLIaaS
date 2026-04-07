/**
 * C++ behavioral parity tests: Integer lepton distance (coord.cpp Distance()).
 *
 * C++ coord.cpp:124-136 Distance():
 *   diff1 = |Coord_Y(coord1) - Coord_Y(coord2)|
 *   diff2 = |Coord_X(coord1) - Coord_X(coord2)|
 *   if (diff1 > diff2) return diff1 + (unsigned)diff2 / 2
 *   return diff2 + (unsigned)diff1 / 2
 *
 * This is the "octagonal approximation" (a.k.a. "Dragon Strike method").
 * It approximates Euclidean distance with integer math only.
 *
 * worldDist() wraps leptonDist() and returns cells (leptonDist / 256).
 * Both functions now use this C++ approximation instead of Euclidean sqrt.
 *
 * C++ source refs:
 *   - coord.cpp:124-136 — Distance(COORDINATE, COORDINATE)
 *   - coord.cpp:101-104 — Distance(TARGET, TARGET) delegates to Distance(COORDINATE, COORDINATE)
 *   - techno.cpp:1313-1318 — In_Range() uses Distance() <= Weapon_Range()
 *   - techno.cpp:3599-3619 — Weapon_Range() returns weapon->Range (in leptons)
 */

import { describe, it, expect } from 'vitest';
import { worldDist, leptonDist, CELL_SIZE, LEPTON_SIZE } from '../engine/types';
import { LP } from '../engine/tracks';

describe('leptonDist — C++ coord.cpp Distance() integer approximation', () => {
  it('zero distance', () => {
    expect(leptonDist(100, 200, 100, 200)).toBe(0);
  });

  it('cardinal distance (pure X)', () => {
    // 256 leptons = 1 cell
    expect(leptonDist(0, 0, 256, 0)).toBe(256);
    expect(leptonDist(0, 0, 512, 0)).toBe(512);
  });

  it('cardinal distance (pure Y)', () => {
    expect(leptonDist(0, 0, 0, 256)).toBe(256);
    expect(leptonDist(0, 0, 0, 1024)).toBe(1024);
  });

  it('diagonal distance: max + min/2 (C++ octagonal approximation)', () => {
    // dx=256, dy=256 → max=256, min=256 → 256 + 128 = 384
    expect(leptonDist(0, 0, 256, 256)).toBe(384);
    // Contrast with Euclidean: sqrt(256^2 + 256^2) ≈ 362 — ~6% smaller
  });

  it('asymmetric distance: larger axis dominates', () => {
    // dx=768, dy=256 → max=768, min=256 → 768 + 128 = 896
    expect(leptonDist(0, 0, 768, 256)).toBe(896);
    // Euclidean: sqrt(768^2 + 256^2) ≈ 809
  });

  it('integer truncation: (unsigned)min / 2 truncates', () => {
    // dx=3, dy=1 → max=3, min=1 → 3 + 0 = 3 (1/2 truncates to 0)
    expect(leptonDist(0, 0, 3, 1)).toBe(3);
    // dx=5, dy=3 → max=5, min=3 → 5 + 1 = 6 (3/2 truncates to 1)
    expect(leptonDist(0, 0, 5, 3)).toBe(6);
  });

  it('symmetric: distance is same regardless of order', () => {
    expect(leptonDist(100, 200, 400, 600)).toBe(leptonDist(400, 600, 100, 200));
  });

  it('negative coordinates work correctly', () => {
    // C++ takes absolute values of diffs
    expect(leptonDist(-100, -200, 100, 200)).toBe(leptonDist(0, 0, 200, 400));
  });
});

describe('worldDist — C++ Distance() approximation returning cells', () => {
  it('1 cell apart horizontally = 1.0 cells', () => {
    expect(worldDist({ x: 0, y: 0 }, { x: CELL_SIZE, y: 0 })).toBe(1);
  });

  it('2 cells apart horizontally = 2.0 cells', () => {
    expect(worldDist({ x: 0, y: 0 }, { x: 2 * CELL_SIZE, y: 0 })).toBe(2);
  });

  it('1 cell diagonal = 1.5 cells (C++ octagonal)', () => {
    // C++ max(256,256) + min(256,256)/2 = 256+128 = 384 = 1.5 cells
    expect(worldDist({ x: 0, y: 0 }, { x: CELL_SIZE, y: CELL_SIZE })).toBe(1.5);
  });

  it('3×4 offset = 5.5 cells (C++ octagonal, NOT Euclidean 5.0)', () => {
    // C++ max(4*256, 3*256) + min(4*256, 3*256)/2 = 1024+384 = 1408 = 5.5 cells
    expect(worldDist(
      { x: 0, y: 0 },
      { x: 3 * CELL_SIZE, y: 4 * CELL_SIZE },
    )).toBe(5.5);
  });

  it('entity lepton positions round-trip correctly', () => {
    // Entity at (100, 200): leptonX = trunc(100/LP), pos.x = leptonX * LP
    const lx = Math.trunc(100 / LP);
    const ly = Math.trunc(200 / LP);
    const px = lx * LP;
    const py = ly * LP;
    // Distance from origin should use the lepton-quantized position
    const distCells = worldDist({ x: 0, y: 0 }, { x: px, y: py });
    const expectedLeptons = leptonDist(0, 0, lx, ly);
    expect(distCells).toBeCloseTo(expectedLeptons / LEPTON_SIZE, 6);
  });

  it('truncation vs rounding: trunc(x / LP) matches C++ integer conversion', () => {
    // 100 / LP = 1066.666... → trunc = 1066, round = 1067
    // C++ would store 1066 leptons (integer truncation toward zero)
    const px = 100;
    const leptons = Math.trunc(px / LP);
    expect(leptons).toBe(1066);
    // Recovered pixel position
    expect(leptons * LP).toBe(99.9375);
  });
});

describe('worldDist vs leptonDist consistency', () => {
  it('worldDist equals leptonDist / LEPTON_SIZE for cell-aligned positions', () => {
    for (let dx = 0; dx <= 5; dx++) {
      for (let dy = 0; dy <= 5; dy++) {
        const wd = worldDist(
          { x: 0, y: 0 },
          { x: dx * CELL_SIZE, y: dy * CELL_SIZE },
        );
        const ld = leptonDist(0, 0, dx * LEPTON_SIZE, dy * LEPTON_SIZE);
        expect(wd).toBe(ld / LEPTON_SIZE);
      }
    }
  });
});
