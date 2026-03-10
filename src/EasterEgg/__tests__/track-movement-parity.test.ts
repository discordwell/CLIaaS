/**
 * Track-table movement parity verification tests.
 *
 * Verifies the C++ drive.cpp track system is faithfully ported:
 * 1. Track data matches C++ hex values
 * 2. Smooth_Turn produces correct world positions
 * 3. All 8 straight-direction variants work correctly
 * 4. TrackControl flag combinations are complete
 */

import { describe, it, expect } from 'vitest';
import {
  TRACK_DATA, TRACK_CONTROL,
  lookupTrackControl, getEffectiveTrack, getTrackArray,
  smoothTurn, LP, F_, F_T, F_X, F_Y, F_D,
} from '../engine/tracks';
import { CELL_SIZE } from '../engine/types';

describe('Track data hex verification', () => {
  it('Track1 step 0: 0x00F50000 decodes to (0, 245)', () => {
    expect(TRACK_DATA[0][0]).toEqual({ x: 0, y: 245, facing: 0 });
  });

  it('Track1 step 23 (last): 0x00000000 decodes to (0, 0)', () => {
    expect(TRACK_DATA[0][23]).toEqual({ x: 0, y: 0, facing: 0 });
  });

  it('Track2 step 0: 0x00F8FF08 decodes to (-248, 248)', () => {
    expect(TRACK_DATA[1][0]).toEqual({ x: -248, y: 248, facing: 32 });
  });

  it('Track3 step 0: 0x01F5FF00 decodes to (-256, 501)', () => {
    expect(TRACK_DATA[2][0]).toEqual({ x: -256, y: 501, facing: 0 });
  });

  it('Track4 last step: 0x00000000 decodes to (0, 0) with dir=64', () => {
    const last = TRACK_DATA[3][TRACK_DATA[3].length - 1];
    expect(last).toEqual({ x: 0, y: 0, facing: 64 });
  });

  it('Track7 step 13 (peak): 0x0046FFDD decodes to (-35, 70)', () => {
    expect(TRACK_DATA[6][13].x).toBe(-35);
    expect(TRACK_DATA[6][13].y).toBe(70);
  });
});

describe('Smooth_Turn produces correct world positions for all 8 directions', () => {
  const straightEntries = [
    { name: 'N→N',   idx: 0,  expectDir: 0 },
    { name: 'NE→NE', idx: 9,  expectDir: 32 },
    { name: 'E→E',   idx: 18, expectDir: 64 },
    { name: 'SE→SE', idx: 27, expectDir: 96 },
    { name: 'S→S',   idx: 36, expectDir: 128 },
    { name: 'SW→SW', idx: 45, expectDir: 160 },
    { name: 'W→W',   idx: 54, expectDir: 192 },
    { name: 'NW→NW', idx: 63, expectDir: 224 },
  ];

  for (const { name, idx, expectDir } of straightEntries) {
    it(`${name} straight: last step transform gives dir=${expectDir}`, () => {
      const ctrl = TRACK_CONTROL[idx];
      const track = getTrackArray(ctrl.track)!;
      const lastStep = track[track.length - 1];
      const result = smoothTurn(lastStep.x, lastStep.y, lastStep.facing, ctrl.flag & ~F_D);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
      expect(result.facing).toBe(expectDir);
    });
  }
});

describe('TrackControl coverage', () => {
  it('all 64 facing pairs have entries', () => {
    for (let cur = 0; cur < 8; cur++) {
      for (let next = 0; next < 8; next++) {
        const idx = cur * 8 + next;
        expect(TRACK_CONTROL[idx]).toBeDefined();
      }
    }
  });

  it('all valid non-F_D tracks are single-cell (Track1, Track2)', () => {
    for (let i = 0; i < 64; i++) {
      const ctrl = TRACK_CONTROL[i];
      if (ctrl.track > 0 && !(ctrl.flag & F_D)) {
        expect([1, 2]).toContain(ctrl.track);
      }
    }
  });

  it('all F_D entries have a non-zero StartTrack', () => {
    for (let i = 0; i < 64; i++) {
      const ctrl = TRACK_CONTROL[i];
      if (ctrl.track > 0 && (ctrl.flag & F_D)) {
        expect(ctrl.startTrack, `index ${i}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('Path lookahead track selection parity (C++ Path[0]*8+Path[1])', () => {
  // C++ drive.cpp:1175-1190: TrackNumber = Path[0]*8 + Path[1]
  // Path[0] = current movement direction, Path[1] = next movement direction
  // This creates smooth lead-in curves that anticipate upcoming turns.

  const LOOKAHEAD_CASES: [string, number, number, number][] = [
    // [description, currentDir, nextDir, expectedTrack (after getEffectiveTrack)]
    ['N then NE: 45° curve',  0, 1, 7],  // Track7 short 45°
    ['N then E: 90° curve',   0, 2, 9],  // Track9 short 90°
    ['NE then E: 45° curve',  1, 2, 8],  // Track8 short 45°
    ['NE then SE: 90° curve', 1, 3, 10], // Track10 short 90°
    ['N then N: straight',    0, 0, 1],  // Track1 straight
    ['NE then NE: diagonal',  1, 1, 2],  // Track2 diagonal
  ];

  for (const [desc, curDir, nextDir, expectedTrack] of LOOKAHEAD_CASES) {
    it(`${desc} → Track${expectedTrack}`, () => {
      const ctrl = lookupTrackControl(curDir, nextDir);
      expect(getEffectiveTrack(ctrl)).toBe(expectedTrack);
    });
  }

  it('lookahead vs no-lookahead: curves vs straight for N→NE transition', () => {
    // Old code: lookupTrackControl(entity.facing, dirToNextCell) → N,N → straight
    // New code: lookupTrackControl(dirToNextCell, dirToFollowingCell) → N,NE → curve
    const oldBehavior = getEffectiveTrack(lookupTrackControl(0, 0)); // N→N straight
    const newBehavior = getEffectiveTrack(lookupTrackControl(0, 1)); // N→NE curve
    expect(oldBehavior).toBe(1); // Track1 straight
    expect(newBehavior).toBe(7); // Track7 curve — smoother transition
    expect(newBehavior).not.toBe(oldBehavior);
  });

  it('all 8 directions have valid straight self-lookahead', () => {
    // When no following cell exists, C++ defaults nextface = facing → straight track.
    for (let d = 0; d < 8; d++) {
      const ctrl = lookupTrackControl(d, d);
      expect(getEffectiveTrack(ctrl), `dir ${d}`).toBeGreaterThan(0);
    }
  });
});

describe('End facing parity', () => {
  it('N→NE turn ends facing NE (DirType 32)', () => {
    expect(TRACK_CONTROL[1].facing).toBe(32);
  });

  it('N→W turn ends facing W (DirType 192)', () => {
    expect(TRACK_CONTROL[6].facing).toBe(192);
  });

  it('SE→SW turn ends facing SW (DirType 160)', () => {
    expect(TRACK_CONTROL[29].facing).toBe(160);
  });
});
