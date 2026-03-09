/**
 * Track-Table Movement Parity Tests — C++ drive.cpp verification.
 *
 * Verifies:
 * - 7 track types with 8 steps each (correct North-reference data)
 * - rotateTrackOffset() exact transforms for all 8 directions
 * - selectTrack() angular thresholds for turn type selection
 * - Track symmetry (45L mirrors 45R, 90L mirrors 90R, 180L mirrors 180R)
 * - usesTrackMovement() eligibility filtering
 * - Lepton-to-pixel conversion factor LP = CELL_SIZE / 256
 */

import { describe, it, expect } from 'vitest';
import {
  TRACKS, selectTrack, rotateTrackOffset, usesTrackMovement,
} from '../engine/tracks';
import type { TrackStep } from '../engine/tracks';
import { CELL_SIZE, SpeedClass } from '../engine/types';

const LP = CELL_SIZE / 256; // lepton-to-pixel conversion

// ============================================================
// Section 1: Track structure — 7 tracks × 8 steps
// ============================================================
describe('track data structure', () => {
  it('exactly 7 track types', () => {
    expect(TRACKS.length).toBe(7);
  });

  it('each track has exactly 8 steps', () => {
    for (let i = 0; i < TRACKS.length; i++) {
      expect(TRACKS[i].length, `track ${i} should have 8 steps`).toBe(8);
    }
  });

  it('each step has x, y, and facing properties', () => {
    for (let i = 0; i < TRACKS.length; i++) {
      for (let j = 0; j < TRACKS[i].length; j++) {
        const step = TRACKS[i][j];
        expect(typeof step.x, `track ${i} step ${j} x`).toBe('number');
        expect(typeof step.y, `track ${i} step ${j} y`).toBe('number');
        expect(typeof step.facing, `track ${i} step ${j} facing`).toBe('number');
      }
    }
  });
});

// ============================================================
// Section 2: Track 0 (Straight) — pure Y movement, facing constant
// ============================================================
describe('track 0 — straight movement', () => {
  it('all X offsets are 0 (no lateral movement)', () => {
    for (const step of TRACKS[0]) {
      expect(step.x).toBe(0);
    }
  });

  it('all facings stay at 0 (North)', () => {
    for (const step of TRACKS[0]) {
      expect(step.facing).toBe(0);
    }
  });

  it('Y progresses from -32LP to -256LP (one full cell North)', () => {
    expect(TRACKS[0][0].y).toBeCloseTo(-32 * LP, 10);
    expect(TRACKS[0][7].y).toBeCloseTo(-256 * LP, 10);
  });

  it('last step Y = -CELL_SIZE (moved exactly one cell)', () => {
    expect(TRACKS[0][7].y).toBeCloseTo(-CELL_SIZE, 10);
  });

  it('Y is monotonically decreasing (always moving North)', () => {
    for (let i = 1; i < 8; i++) {
      expect(TRACKS[0][i].y).toBeLessThan(TRACKS[0][i - 1].y);
    }
  });
});

// ============================================================
// Section 3: Track symmetry — left mirrors right
// ============================================================
describe('track symmetry — left mirrors right', () => {
  // Track 1 (45R) and Track 2 (45L) should be X-mirrored
  it('45° tracks: 45L.x = -45R.x at each step', () => {
    for (let i = 0; i < 8; i++) {
      expect(TRACKS[2][i].x).toBeCloseTo(-TRACKS[1][i].x, 10);
    }
  });

  it('45° tracks: same Y values', () => {
    for (let i = 0; i < 8; i++) {
      expect(TRACKS[2][i].y).toBeCloseTo(TRACKS[1][i].y, 10);
    }
  });

  // Track 3 (90R) and Track 4 (90L) should be X-mirrored
  it('90° tracks: 90L.x = -90R.x at each step', () => {
    for (let i = 0; i < 8; i++) {
      expect(TRACKS[4][i].x).toBeCloseTo(-TRACKS[3][i].x, 10);
    }
  });

  it('90° tracks: same Y values', () => {
    for (let i = 0; i < 8; i++) {
      expect(TRACKS[4][i].y).toBeCloseTo(TRACKS[3][i].y, 10);
    }
  });

  // Track 5 (180R) and Track 6 (180L) should be X-mirrored
  it('180° tracks: 180L.x = -180R.x at each step', () => {
    for (let i = 0; i < 8; i++) {
      expect(TRACKS[6][i].x).toBeCloseTo(-TRACKS[5][i].x, 10);
    }
  });

  it('180° tracks: same Y values', () => {
    for (let i = 0; i < 8; i++) {
      expect(TRACKS[6][i].y).toBeCloseTo(TRACKS[5][i].y, 10);
    }
  });
});

// ============================================================
// Section 4: Track endpoints verify correct cell displacement
// ============================================================
describe('track endpoints — correct cell displacement', () => {
  it('track 0 (straight N): ends at (0, -1 cell)', () => {
    const last = TRACKS[0][7];
    expect(last.x).toBeCloseTo(0, 10);
    expect(last.y).toBeCloseTo(-CELL_SIZE, 10);
  });

  it('track 1 (45R, N→NE): ends at approx (+0.5, -0.5 cell) diagonal', () => {
    const last = TRACKS[1][7];
    // 128 leptons in X = 0.5 cells, -128 leptons in Y = -0.5 cells
    expect(last.x).toBeCloseTo(128 * LP, 10);
    expect(last.y).toBeCloseTo(-128 * LP, 10);
  });

  it('track 3 (90R, N→E): ends at (+1 cell, 0)', () => {
    const last = TRACKS[3][7];
    expect(last.x).toBeCloseTo(256 * LP, 10);
    expect(last.y).toBeCloseTo(0, 10);
  });

  it('track 5 (180R, N→S): ends at (0, +1 cell)', () => {
    const last = TRACKS[5][7];
    expect(last.x).toBeCloseTo(0, 10);
    expect(last.y).toBeCloseTo(256 * LP, 10);
  });
});

// ============================================================
// Section 5: Track facing progression
// ============================================================
describe('track facing progression', () => {
  it('track 0 (straight): all facings = 0 (no turn)', () => {
    for (const step of TRACKS[0]) {
      expect(step.facing).toBe(0);
    }
  });

  it('track 1 (45R): ends at facing 4 (NE in 32-step)', () => {
    expect(TRACKS[1][7].facing).toBe(4);
  });

  it('track 2 (45L): ends at facing 28 (NW in 32-step)', () => {
    expect(TRACKS[2][7].facing).toBe(28);
  });

  it('track 3 (90R): ends at facing 8 (E in 32-step)', () => {
    expect(TRACKS[3][7].facing).toBe(8);
  });

  it('track 4 (90L): ends at facing 24 (W in 32-step)', () => {
    expect(TRACKS[4][7].facing).toBe(24);
  });

  it('track 5 (180R): ends at facing 16 (S in 32-step)', () => {
    expect(TRACKS[5][7].facing).toBe(16);
  });

  it('track 6 (180L): ends at facing 16 (S in 32-step)', () => {
    expect(TRACKS[6][7].facing).toBe(16);
  });

  it('facing values never exceed 31', () => {
    for (const track of TRACKS) {
      for (const step of track) {
        expect(step.facing).toBeGreaterThanOrEqual(0);
        expect(step.facing).toBeLessThanOrEqual(31);
      }
    }
  });
});

// ============================================================
// Section 6: selectTrack — angular thresholds
// ============================================================
describe('selectTrack — turn type selection', () => {
  it('same facing → track 0 (straight)', () => {
    expect(selectTrack(0, 0)).toBe(0);
    expect(selectTrack(16, 16)).toBe(0);
  });

  // 45° turn: diff ≤ 4
  it('1-4 steps right → track 1 (45° right)', () => {
    expect(selectTrack(0, 1)).toBe(1);
    expect(selectTrack(0, 4)).toBe(1);
  });

  it('1-4 steps left → track 2 (45° left)', () => {
    expect(selectTrack(0, 31)).toBe(2);
    expect(selectTrack(0, 28)).toBe(2);
  });

  // 90° turn: 5 ≤ diff ≤ 12
  it('5-12 steps right → track 3 (90° right)', () => {
    expect(selectTrack(0, 5)).toBe(3);
    expect(selectTrack(0, 8)).toBe(3);
    expect(selectTrack(0, 12)).toBe(3);
  });

  it('5-12 steps left → track 4 (90° left)', () => {
    expect(selectTrack(0, 27)).toBe(4);
    expect(selectTrack(0, 24)).toBe(4);
    expect(selectTrack(0, 20)).toBe(4);
  });

  // 180° turn: diff > 12
  it('13-16 steps right → track 5 (180° right)', () => {
    expect(selectTrack(0, 13)).toBe(5);
    expect(selectTrack(0, 16)).toBe(5);
  });

  it('13-16 steps left → track 6 (180° left)', () => {
    expect(selectTrack(0, 19)).toBe(6);
  });

  // Wrapping: test from non-zero starting facing
  it('wraps correctly (facing 30 → 2 = 4 steps right → 45R)', () => {
    expect(selectTrack(30, 2)).toBe(1); // diff = (2-30+32)%32 = 4
  });

  it('wraps correctly (facing 2 → 30 = 4 steps left → 45L)', () => {
    expect(selectTrack(2, 30)).toBe(2); // diff = (30-2+32)%32 = 28, isRight=false, absDiff=4
  });
});

// ============================================================
// Section 7: rotateTrackOffset — exact transforms
// ============================================================
describe('rotateTrackOffset — coordinate rotation', () => {
  const S = Math.SQRT2 / 2;

  // Use a known offset to test each direction
  const testX = 10;
  const testY = -20;

  it('facing8=0 (N): identity — (x, y) unchanged', () => {
    const [rx, ry] = rotateTrackOffset(testX, testY, 0);
    expect(rx).toBe(testX);
    expect(ry).toBe(testY);
  });

  it('facing8=2 (E): 90° CW — (-y, x)', () => {
    const [rx, ry] = rotateTrackOffset(testX, testY, 2);
    expect(rx).toBe(-testY); // 20
    expect(ry).toBe(testX);  // 10
  });

  it('facing8=4 (S): 180° — (-x, -y)', () => {
    const [rx, ry] = rotateTrackOffset(testX, testY, 4);
    expect(rx).toBe(-testX); // -10
    expect(ry).toBe(-testY); // 20
  });

  it('facing8=6 (W): 270° CW — (y, -x)', () => {
    const [rx, ry] = rotateTrackOffset(testX, testY, 6);
    expect(rx).toBe(testY);  // -20
    expect(ry).toBe(-testX); // -10
  });

  // Diagonal directions use √2/2 scaling
  it('facing8=1 (NE): 45° CW — ((x-y)×S, (x+y)×S)', () => {
    const [rx, ry] = rotateTrackOffset(testX, testY, 1);
    expect(rx).toBeCloseTo((testX - testY) * S, 10);
    expect(ry).toBeCloseTo((testX + testY) * S, 10);
  });

  it('facing8=3 (SE): 135° CW — ((-x-y)×S, (x-y)×S)', () => {
    const [rx, ry] = rotateTrackOffset(testX, testY, 3);
    expect(rx).toBeCloseTo((-testX - testY) * S, 10);
    expect(ry).toBeCloseTo((testX - testY) * S, 10);
  });

  it('facing8=5 (SW): 225° CW — ((y-x)×S, (-x-y)×S)', () => {
    const [rx, ry] = rotateTrackOffset(testX, testY, 5);
    expect(rx).toBeCloseTo((testY - testX) * S, 10);
    expect(ry).toBeCloseTo((-testX - testY) * S, 10);
  });

  it('facing8=7 (NW): 315° CW — ((x+y)×S, (y-x)×S)', () => {
    const [rx, ry] = rotateTrackOffset(testX, testY, 7);
    expect(rx).toBeCloseTo((testX + testY) * S, 10);
    expect(ry).toBeCloseTo((testY - testX) * S, 10);
  });

  // Cardinal directions produce exact integers (no floating-point error)
  it('cardinal rotations are exact integers (no precision loss)', () => {
    const [rx2, ry2] = rotateTrackOffset(7, -13, 2);
    expect(rx2).toBe(13);
    expect(ry2).toBe(7);

    const [rx4, ry4] = rotateTrackOffset(7, -13, 4);
    expect(rx4).toBe(-7);
    expect(ry4).toBe(13);

    const [rx6, ry6] = rotateTrackOffset(7, -13, 6);
    expect(rx6).toBe(-13);
    expect(ry6).toBe(-7);
  });

  // Full rotation: applying all 8 rotations to the same input and back
  it('360° composition: 8 successive 45° rotations return to original', () => {
    let x = 100;
    let y = -50;
    // Rotate facing8=1 (45° CW) eight times should return to original
    for (let i = 0; i < 8; i++) {
      [x, y] = rotateTrackOffset(x, y, 1);
    }
    expect(x).toBeCloseTo(100, 5);
    expect(y).toBeCloseTo(-50, 5);
  });

  // Default case
  it('invalid facing8 returns identity', () => {
    const [rx, ry] = rotateTrackOffset(10, -20, 99);
    expect(rx).toBe(10);
    expect(ry).toBe(-20);
  });
});

// ============================================================
// Section 8: usesTrackMovement — eligibility
// ============================================================
describe('usesTrackMovement — eligibility filtering', () => {
  it('TRACK speedClass, non-infantry, non-aircraft → true', () => {
    expect(usesTrackMovement(SpeedClass.TRACK, false, false)).toBe(true);
  });

  it('WHEEL speedClass → true', () => {
    expect(usesTrackMovement(SpeedClass.WHEEL, false, false)).toBe(true);
  });

  it('FLOAT speedClass → true (naval units)', () => {
    expect(usesTrackMovement(SpeedClass.FLOAT, false, false)).toBe(true);
  });

  it('infantry always excluded', () => {
    expect(usesTrackMovement(SpeedClass.FOOT, true, false)).toBe(false);
    expect(usesTrackMovement(SpeedClass.TRACK, true, false)).toBe(false);
  });

  it('aircraft always excluded', () => {
    expect(usesTrackMovement(SpeedClass.WINGED, false, true)).toBe(false);
    expect(usesTrackMovement(SpeedClass.FLOAT, false, true)).toBe(false);
  });

  it('FOOT speedClass (non-infantry) → false', () => {
    expect(usesTrackMovement(SpeedClass.FOOT, false, false)).toBe(false);
  });
});

// ============================================================
// Section 9: Lepton-to-pixel conversion factor
// ============================================================
describe('lepton-to-pixel conversion', () => {
  it('LP = CELL_SIZE / 256', () => {
    expect(LP).toBe(CELL_SIZE / 256);
  });

  it('256 leptons = 1 cell = CELL_SIZE pixels', () => {
    expect(256 * LP).toBe(CELL_SIZE);
  });

  it('LP = 0.09375 (24/256)', () => {
    expect(LP).toBeCloseTo(0.09375, 10);
  });
});
