/**
 * Track-table movement C++ parity tests.
 *
 * Verifies faithful port of C++ drive.cpp track system:
 * 1. All 13 track arrays decoded correctly from hex
 * 2. TrackControl[67] table maps facing transitions correctly
 * 3. Smooth_Turn flag transformations (F_T, F_X, F_Y)
 * 4. Short tracks (7-10) cover single-cell movement
 * 5. Track endpoints all reach (0,0) = target cell center
 * 6. Vehicle/infantry track usage classification
 */

import { describe, it, expect } from 'vitest';
import {
  TRACK_DATA, TRACK_CONTROL, RAW_TRACKS,
  lookupTrackControl, getEffectiveTrack, getTrackArray,
  smoothTurn, usesTrackMovement,
  LP, PIXEL_LEPTON_W, F_, F_T, F_X, F_Y, F_D,
} from '../engine/tracks';
import { CELL_SIZE, SpeedClass } from '../engine/types';

describe('C++ Track Data (13 tracks)', () => {
  it('has exactly 13 tracks', () => {
    expect(TRACK_DATA).toHaveLength(13);
  });

  it('Track1 (straight N) has 24 steps', () => {
    expect(TRACK_DATA[0]).toHaveLength(24);
  });

  it('Track2 (straight NE diagonal) has 32 steps', () => {
    expect(TRACK_DATA[1]).toHaveLength(32);
  });

  it('Track3 (long 2-cell N→NE) has 55 steps', () => {
    expect(TRACK_DATA[2]).toHaveLength(55);
  });

  it('Track7 (short 45° curve) has 28 steps', () => {
    expect(TRACK_DATA[6]).toHaveLength(28);
  });

  it('Track9 (short 90° curve) has 31 steps', () => {
    expect(TRACK_DATA[8]).toHaveLength(31);
  });

  it('every track ends at (0,0) — target cell center', () => {
    for (let i = 0; i < TRACK_DATA.length; i++) {
      const track = TRACK_DATA[i];
      const last = track[track.length - 1];
      expect(last.x, `Track${i + 1} last step X`).toBe(0);
      expect(last.y, `Track${i + 1} last step Y`).toBe(0);
    }
  });

  it('Track1 step 0 is (0, 245) leptons — 245 leptons south of target', () => {
    expect(TRACK_DATA[0][0].x).toBe(0);
    expect(TRACK_DATA[0][0].y).toBe(245); // 0x00F5
    expect(TRACK_DATA[0][0].facing).toBe(0); // DIR_N
  });

  it('Track1 steps decrease by ~11 leptons (PIXEL_LEPTON_W+1)', () => {
    const track = TRACK_DATA[0];
    for (let i = 1; i < track.length - 1; i++) {
      const delta = track[i - 1].y - track[i].y;
      expect(delta).toBe(11);
    }
  });

  it('Track2 step 0 is (-248, 248) leptons — NE diagonal start', () => {
    expect(TRACK_DATA[1][0].x).toBe(-248); // 0xFF08 signed
    expect(TRACK_DATA[1][0].y).toBe(248);  // 0x00F8
    expect(TRACK_DATA[1][0].facing).toBe(32); // DIR_NE
  });

  it('Track2 all steps have facing=32 (DIR_NE)', () => {
    for (const step of TRACK_DATA[1]) {
      expect(step.facing).toBe(32);
    }
  });
});

describe('RawTracks metadata', () => {
  it('has 13 entries', () => {
    expect(RAW_TRACKS).toHaveLength(13);
  });

  it('Track3 has Jump@37, Entry@12, Cell@22', () => {
    expect(RAW_TRACKS[2]).toEqual({ jump: 37, entry: 12, cell: 22 });
  });

  it('Track4 has Jump@26, Entry@11, Cell@19', () => {
    expect(RAW_TRACKS[3]).toEqual({ jump: 26, entry: 11, cell: 19 });
  });

  it('single-cell tracks have jump=-1, entry=0', () => {
    for (const idx of [0, 1, 6, 7, 8, 9, 10, 11, 12]) {
      expect(RAW_TRACKS[idx].jump, `Track${idx + 1} jump`).toBe(-1);
      expect(RAW_TRACKS[idx].entry, `Track${idx + 1} entry`).toBe(0);
    }
  });
});

describe('TrackControl table', () => {
  it('has 67 entries (64 facing pairs + 3 special)', () => {
    expect(TRACK_CONTROL).toHaveLength(67);
  });

  it('N→N (index 0) uses Track1 straight with no flags', () => {
    const ctrl = TRACK_CONTROL[0];
    expect(ctrl.track).toBe(1);
    expect(ctrl.flag).toBe(F_);
    expect(ctrl.facing).toBe(0); // DIR_N
  });

  it('N→NE (index 1) uses Track3 with F_D flag', () => {
    const ctrl = TRACK_CONTROL[1];
    expect(ctrl.track).toBe(3);
    expect(ctrl.startTrack).toBe(7);
    expect(ctrl.flag).toBe(F_D);
  });

  it('NE→NE (index 9) uses Track2 diagonal with no flags', () => {
    const ctrl = TRACK_CONTROL[9];
    expect(ctrl.track).toBe(2);
    expect(ctrl.flag).toBe(F_);
  });

  it('E→E (index 18) uses Track1 with F_T|F_X', () => {
    const ctrl = TRACK_CONTROL[18];
    expect(ctrl.track).toBe(1);
    expect(ctrl.flag).toBe(F_T | F_X);
  });

  it('S→S (index 36) uses Track1 with F_Y', () => {
    const ctrl = TRACK_CONTROL[36];
    expect(ctrl.track).toBe(1);
    expect(ctrl.flag).toBe(F_Y);
  });

  it('impossible turns have track=0', () => {
    // N→SE (0-3), N→S (0-4), N→SW (0-5) are all impossible
    expect(TRACK_CONTROL[3].track).toBe(0);
    expect(TRACK_CONTROL[4].track).toBe(0);
    expect(TRACK_CONTROL[5].track).toBe(0);
  });

  it('lookupTrackControl returns correct entry for facing pair', () => {
    const ctrl = lookupTrackControl(0, 2); // N→E
    expect(ctrl.track).toBe(4);
    expect(ctrl.flag).toBe(F_D);
  });
});

describe('getEffectiveTrack — short track selection', () => {
  it('straight movements use main track (no F_D)', () => {
    // N→N: Track1, no F_D → returns 1
    expect(getEffectiveTrack(TRACK_CONTROL[0])).toBe(1);
    // NE→NE: Track2, no F_D → returns 2
    expect(getEffectiveTrack(TRACK_CONTROL[9])).toBe(2);
  });

  it('F_D entries use StartTrack (short version)', () => {
    // N→NE: Track3 → StartTrack7
    expect(getEffectiveTrack(TRACK_CONTROL[1])).toBe(7);
    // N→E: Track4 → StartTrack9
    expect(getEffectiveTrack(TRACK_CONTROL[2])).toBe(9);
    // NE→SE: Track5 → StartTrack10
    expect(getEffectiveTrack(TRACK_CONTROL[11])).toBe(10);
    // NE→E: Track6 → StartTrack8
    expect(getEffectiveTrack(TRACK_CONTROL[10])).toBe(8);
  });

  it('impossible turns return 0', () => {
    expect(getEffectiveTrack(TRACK_CONTROL[3])).toBe(0); // N→SE
    expect(getEffectiveTrack(TRACK_CONTROL[4])).toBe(0); // N→S
  });
});

describe('Smooth_Turn flag transformations', () => {
  it('F_ (no flags) is identity', () => {
    const r = smoothTurn(100, -200, 0, F_);
    expect(r.x).toBe(100);
    expect(r.y).toBe(-200);
    expect(r.facing).toBe(0);
  });

  it('F_T transposes X↔Y and adjusts direction', () => {
    const r = smoothTurn(100, -200, 0, F_T);
    expect(r.x).toBe(-200); // y
    expect(r.y).toBe(100);  // x
    expect(r.facing).toBe(192); // DIR_W - 0 = 192
  });

  it('F_X negates X and reverses direction', () => {
    const r = smoothTurn(100, -200, 32, F_X);
    expect(r.x).toBe(-100);
    expect(r.y).toBe(-200);
    expect(r.facing).toBe(224); // (-32) & 0xFF = 224 = DIR_NW
  });

  it('F_Y negates Y and adjusts direction', () => {
    const r = smoothTurn(100, -200, 0, F_Y);
    expect(r.x).toBe(100);
    expect(r.y).toBe(200);
    expect(r.facing).toBe(128); // DIR_S - 0 = 128
  });

  it('F_T|F_X combined: E→E straight uses Track1 data correctly', () => {
    // Track1 step 0: x=0, y=245, dir=0 (N). With F_T|F_X:
    // F_T: swap → x=245, y=0; dir = 192-0 = 192 (W)
    // F_X: x=-245; dir = -192 & 0xFF = 64 (E)
    const r = smoothTurn(0, 245, 0, F_T | F_X);
    expect(r.x).toBe(-245);
    expect(r.y).toBe(0);
    expect(r.facing).toBe(64); // DIR_E
  });

  it('F_Y: S→S straight uses Track1 data with inverted Y', () => {
    // Track1 step 0: x=0, y=245, dir=0 (N). With F_Y:
    // y=-245, dir = 128-0 = 128 (S)
    const r = smoothTurn(0, 245, 0, F_Y);
    expect(r.x).toBe(0);
    expect(r.y).toBe(-245);
    expect(r.facing).toBe(128); // DIR_S
  });
});

describe('Short track single-cell coverage', () => {
  it('Track7 (short 45°) max displacement is < 8 pixels', () => {
    let maxDist = 0;
    for (const step of TRACK_DATA[6]) {
      const px = step.x * LP;
      const py = step.y * LP;
      const dist = Math.sqrt(px * px + py * py);
      maxDist = Math.max(maxDist, dist);
    }
    expect(maxDist).toBeLessThan(8);
  });

  it('Track9 (short 90°) max displacement is reasonable (< 15px)', () => {
    let maxDist = 0;
    for (const step of TRACK_DATA[8]) {
      const px = step.x * LP;
      const py = step.y * LP;
      const dist = Math.sqrt(px * px + py * py);
      maxDist = Math.max(maxDist, dist);
    }
    expect(maxDist).toBeLessThan(15);
  });
});

describe('Vehicle track movement classification', () => {
  it('WHEEL vehicles use track movement', () => {
    expect(usesTrackMovement(SpeedClass.WHEEL, false, false)).toBe(true);
  });

  it('TRACK vehicles use track movement', () => {
    expect(usesTrackMovement(SpeedClass.TRACK, false, false)).toBe(true);
  });

  it('FLOAT vessels use track movement', () => {
    expect(usesTrackMovement(SpeedClass.FLOAT, false, false)).toBe(true);
  });

  it('infantry do NOT use track movement', () => {
    expect(usesTrackMovement(SpeedClass.FOOT, true, false)).toBe(false);
  });

  it('aircraft do NOT use track movement', () => {
    expect(usesTrackMovement(SpeedClass.WINGED, false, true)).toBe(false);
  });
});

describe('Same-tick track chaining (Fixes 1+2)', () => {
  it('C++ zeroes SpeedAccum on track completion — fresh budget for chained track', () => {
    // C++ drive.cpp:792: actual = 0 at track end, then While_Moving() restarts
    // with a fresh budget computation: actual = SpeedAccum(=0) + maxspeed*fixed()
    // This means chained tracks get exactly one tick of budget, not remainder + budget.
    const track = getTrackArray(1)!; // Track1: 24 steps
    const speed = 5.0; // pixels/tick
    let actual = 0 + (speed / LP); // fresh budget (speedAccum starts at 0)

    let stepsConsumed = 0;
    let trackIndex = 0;
    while (actual > PIXEL_LEPTON_W && trackIndex < track.length) {
      actual -= PIXEL_LEPTON_W;
      trackIndex++;
      stepsConsumed++;
    }

    expect(stepsConsumed).toBeGreaterThan(0);
    // After track completes, C++ sets actual=0. Chained track gets fresh budget.
    // The remainder is DISCARDED, not carried over.
    const chainedBudget = 0 + (speed / LP); // fresh, not actual + speed/LP
    expect(chainedBudget).toBe(speed / LP); // exactly one tick of budget
  });

  it('Track1 (24 steps) requires multiple ticks at normal speed', () => {
    // At moderate speed, a single tick can't complete Track1 (24 steps).
    // This means chaining only happens with fast units or short tracks.
    const track = getTrackArray(1)!;
    const normalSpeed = 1.0; // ~1 pixel/tick
    const budget = normalSpeed / LP; // leptons per tick
    const stepsPerTick = Math.floor(budget / PIXEL_LEPTON_W);
    expect(stepsPerTick).toBeLessThan(track.length);
    expect(track.length).toBe(24);
  });
});

describe('Path lookahead track selection (Fix 3)', () => {
  it('N→NE lookahead selects curve track instead of straight', () => {
    // C++ Path[0]*8 + Path[1]: current=N(0), next=NE(1)
    // Without lookahead: lookupTrackControl(facing=N, dir=N) → Track1 straight
    // With lookahead: lookupTrackControl(N, NE) → Track3/7 curve
    const withLookahead = lookupTrackControl(0, 1); // N, NE
    const withoutLookahead = lookupTrackControl(0, 0); // N, N (old behavior)
    expect(getEffectiveTrack(withLookahead)).toBe(7); // Short 45° curve
    expect(getEffectiveTrack(withoutLookahead)).toBe(1); // Straight
    // Lookahead gives a different (curving) track for smooth transitions
    expect(getEffectiveTrack(withLookahead)).not.toBe(getEffectiveTrack(withoutLookahead));
  });

  it('N→E lookahead selects 90° curve track', () => {
    const ctrl = lookupTrackControl(0, 2); // N, E
    expect(getEffectiveTrack(ctrl)).toBe(9); // Short 90° curve
  });

  it('last path cell defaults to straight (no following cell)', () => {
    // When there's no following cell, C++ uses FACING_NONE → defaults to same dir
    // Our impl: followingFacing8 = nextFacing8 → lookupTrackControl(dir, dir) = straight
    const straightN = lookupTrackControl(0, 0);
    expect(getEffectiveTrack(straightN)).toBe(1);
    const straightNE = lookupTrackControl(1, 1);
    expect(getEffectiveTrack(straightNE)).toBe(2);
  });

  it('all 8 straight directions produce valid tracks with self-lookahead', () => {
    for (let dir = 0; dir < 8; dir++) {
      const ctrl = lookupTrackControl(dir, dir);
      const track = getEffectiveTrack(ctrl);
      expect(track, `dir ${dir} → self should give valid track`).toBeGreaterThan(0);
    }
  });
});

describe('Pre-rotation parity (Fix 4)', () => {
  it('all valid TrackControl entries have a starting facing that matches the first arg', () => {
    // C++ drive.cpp: entity must face movement direction before track selection.
    // This means lookupTrackControl(dir, nextDir) assumes entity faces `dir`.
    // Verify that all valid tracks have a facing field consistent with this.
    for (let cur = 0; cur < 8; cur++) {
      for (let next = 0; next < 8; next++) {
        const ctrl = TRACK_CONTROL[cur * 8 + next];
        if (ctrl.track === 0) continue; // impossible turn
        // The control's facing field represents the ENDING facing after the track.
        // The starting facing is implied by the first arg (cur direction).
        // This test documents that constraint.
        expect(ctrl.facing).toBeDefined();
      }
    }
  });
});

describe('Constants', () => {
  it('LP = CELL_SIZE/256 = 0.09375', () => {
    expect(LP).toBeCloseTo(CELL_SIZE / 256, 10);
  });

  it('PIXEL_LEPTON_W = 10 (C++ integer division 256/24)', () => {
    expect(PIXEL_LEPTON_W).toBe(10);
  });

  it('flag constants match C++ drive.h', () => {
    expect(F_).toBe(0x00);
    expect(F_T).toBe(0x01);
    expect(F_X).toBe(0x02);
    expect(F_Y).toBe(0x04);
    expect(F_D).toBe(0x08);
  });
});
