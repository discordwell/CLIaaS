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
