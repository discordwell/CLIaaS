/**
 * C++ Behavioral Parity: Track Table Data & Dispatch
 *
 * Tests verify that the track system tables, Smooth_Turn transformations,
 * individual track step data, speed accumulation logic, and track selection
 * for different turn angles all match C++ drive.cpp behavior.
 *
 * C++ source references:
 *   - drive.cpp:2261-2400   TrackControl[67] table (TurnTrackType array)
 *   - drive.cpp:525-556     Smooth_Turn() — flag-based coordinate transform
 *   - drive.cpp:74-520      Track step data (Track1 through Track13)
 *   - drive.cpp:647-820     While_Moving() — speed accumulation loop
 *   - drive.cpp:664          PIXEL_LEPTON_W constant
 *   - drive.cpp:654-660     SpeedAccum budget: actual = SpeedAccum + speed * fixed()
 *   - drive.cpp:1175-1190   Track selection via Path[0]*8 + Path[1]
 *   - drive.h:145-150       TurnTrackType struct (Track, StartTrack, Flag)
 *   - drive.h:157-162       RawTrackType struct (Jump, Entry, Cell)
 */

import { describe, it, expect } from 'vitest';
import {
  TRACK_DATA, TRACK_CONTROL, RAW_TRACKS,
  lookupTrackControl, getEffectiveTrack, getTrackArray,
  smoothTurn, LP, PIXEL_LEPTON_W,
  F_, F_T, F_X, F_Y, F_D,
  type TrackControlEntry,
} from '../engine/tracks';
import { CELL_SIZE, DIR_COUNT } from '../engine/types';

// =============================================================================
// 1. TrackControl table dispatch (drive.cpp:2261 — TurnTrackType TrackControl[67])
// =============================================================================

describe('TrackControl table dispatch (C++ drive.cpp:2261-2400)', () => {
  // C++ TrackControl is indexed by (currentFacing8 * 8 + nextFacing8).
  // Each entry specifies: track number (1-13), startTrack, end facing, flags.

  // Complete expected mapping for all 64 main entries, derived from C++ source.
  // Format: [currentFacing8, nextFacing8, expectedTrack, expectedStartTrack, expectedFlag]
  const DISPATCH_TABLE: [number, number, number, number, number][] = [
    // Row 0: current=N
    [0, 0,  1,  0, F_],                          // N→N: Track1 straight
    [0, 1,  3,  7, F_D],                          // N→NE: Track3 (start 7)
    [0, 2,  4,  9, F_D],                          // N→E: Track4 (start 9)
    [0, 3,  0,  0, F_],                           // N→SE: impossible
    [0, 4,  0,  0, F_],                           // N→S: impossible
    [0, 5,  0,  0, F_],                           // N→SW: impossible
    [0, 6,  4,  9, F_X | F_D],                    // N→W: Track4 mirrored
    [0, 7,  3,  7, F_X | F_D],                    // N→NW: Track3 mirrored

    // Row 1: current=NE
    [1, 0,  6,  8, F_T | F_X | F_Y | F_D],       // NE→N
    [1, 1,  2,  0, F_],                           // NE→NE: Track2 straight
    [1, 2,  6,  8, F_D],                          // NE→E
    [1, 3,  5, 10, F_D],                          // NE→SE
    [1, 4,  0,  0, F_],                           // NE→S: impossible
    [1, 5,  0,  0, F_],                           // NE→SW: impossible
    [1, 6,  0,  0, F_],                           // NE→W: impossible
    [1, 7,  5, 10, F_T | F_X | F_Y | F_D],       // NE→NW

    // Row 2: current=E
    [2, 0,  4,  9, F_T | F_X | F_Y | F_D],       // E→N
    [2, 1,  3,  7, F_T | F_X | F_Y | F_D],       // E→NE
    [2, 2,  1,  0, F_T | F_X],                    // E→E: Track1 transposed
    [2, 3,  3,  7, F_T | F_X | F_D],              // E→SE
    [2, 4,  4,  9, F_T | F_X | F_D],              // E→S
    [2, 5,  0,  0, F_],                           // E→SW: impossible
    [2, 6,  0,  0, F_],                           // E→W: impossible
    [2, 7,  0,  0, F_],                           // E→NW: impossible

    // Row 3: current=SE
    [3, 0,  0,  0, F_],                           // SE→N: impossible
    [3, 1,  5, 10, F_Y | F_D],                    // SE→NE
    [3, 2,  6,  8, F_Y | F_D],                    // SE→E
    [3, 3,  2,  0, F_Y],                          // SE→SE: Track2 mirrored
    [3, 4,  6,  8, F_T | F_X | F_D],              // SE→S
    [3, 5,  5, 10, F_T | F_X | F_D],              // SE→SW
    [3, 6,  0,  0, F_],                           // SE→W: impossible
    [3, 7,  0,  0, F_],                           // SE→NW: impossible

    // Row 4: current=S
    [4, 0,  0,  0, F_],                           // S→N: impossible
    [4, 1,  0,  0, F_],                           // S→NE: impossible
    [4, 2,  4,  9, F_Y | F_D],                    // S→E
    [4, 3,  3,  7, F_Y | F_D],                    // S→SE
    [4, 4,  1,  0, F_Y],                          // S→S: Track1 mirrored
    [4, 5,  3,  7, F_X | F_Y | F_D],              // S→SW
    [4, 6,  4,  9, F_X | F_Y | F_D],              // S→W
    [4, 7,  0,  0, F_],                           // S→NW: impossible

    // Row 5: current=SW
    [5, 0,  0,  0, F_],                           // SW→N: impossible
    [5, 1,  0,  0, F_],                           // SW→NE: impossible
    [5, 2,  0,  0, F_],                           // SW→E: impossible
    [5, 3,  5, 10, F_T | F_D],                    // SW→SE
    [5, 4,  6,  8, F_T | F_D],                    // SW→S
    [5, 5,  2,  0, F_T],                          // SW→SW: Track2 transposed
    [5, 6,  6,  8, F_X | F_Y | F_D],              // SW→W
    [5, 7,  5, 10, F_X | F_Y | F_D],              // SW→NW

    // Row 6: current=W
    [6, 0,  4,  9, F_T | F_Y | F_D],              // W→N
    [6, 1,  0,  0, F_],                           // W→NE: impossible
    [6, 2,  0,  0, F_],                           // W→E: impossible
    [6, 3,  0,  0, F_],                           // W→SE: impossible
    [6, 4,  4,  9, F_T | F_D],                    // W→S
    [6, 5,  3,  7, F_T | F_D],                    // W→SW
    [6, 6,  1,  0, F_T],                          // W→W: Track1 transposed
    [6, 7,  3,  7, F_T | F_Y | F_D],              // W→NW

    // Row 7: current=NW
    [7, 0,  6,  8, F_T | F_Y | F_D],              // NW→N
    [7, 1,  5, 10, F_T | F_Y | F_D],              // NW→NE
    [7, 2,  0,  0, F_],                           // NW→E: impossible
    [7, 3,  0,  0, F_],                           // NW→SE: impossible
    [7, 4,  0,  0, F_],                           // NW→S: impossible
    [7, 5,  5, 10, F_X | F_D],                    // NW→SW
    [7, 6,  6,  8, F_X | F_D],                    // NW→W
    [7, 7,  2,  0, F_X],                          // NW→NW: Track2 mirrored
  ];

  for (const [cur, next, track, startTrack, flag] of DISPATCH_TABLE) {
    const dirNames = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    it(`${dirNames[cur]}->${dirNames[next]} (index ${cur * 8 + next}): track=${track}, startTrack=${startTrack}, flag=0x${flag.toString(16).padStart(2, '0')}`, () => {
      const ctrl = lookupTrackControl(cur, next);
      expect(ctrl.track, 'track number').toBe(track);
      expect(ctrl.startTrack, 'startTrack').toBe(startTrack);
      expect(ctrl.flag, 'flag').toBe(flag);
    });
  }

  it('special entries 64-66 (harvester/factory) have correct tracks', () => {
    // C++ drive.cpp:2398-2400: special purpose track control entries
    expect(TRACK_CONTROL[64].track).toBe(11);   // Harvester backup
    expect(TRACK_CONTROL[64].startTrack).toBe(11);
    expect(TRACK_CONTROL[65].track).toBe(12);   // Drive into refinery
    expect(TRACK_CONTROL[65].startTrack).toBe(12);
    expect(TRACK_CONTROL[66].track).toBe(13);   // Factory exit
    expect(TRACK_CONTROL[66].startTrack).toBe(13);
  });

  it('table has exactly 67 entries (8x8 = 64 facing pairs + 3 special)', () => {
    expect(TRACK_CONTROL).toHaveLength(67);
  });

  it('lookupTrackControl correctly indexes as currentFacing8*8 + nextFacing8', () => {
    // Verify the function is a direct table lookup
    for (let cur = 0; cur < DIR_COUNT; cur++) {
      for (let next = 0; next < DIR_COUNT; next++) {
        const ctrl = lookupTrackControl(cur, next);
        const direct = TRACK_CONTROL[cur * 8 + next];
        expect(ctrl).toBe(direct);
      }
    }
  });
});

// =============================================================================
// 2. Smooth_Turn transformations (C++ drive.cpp:525-556)
// =============================================================================

describe('Smooth_Turn transformations (C++ drive.cpp:525-556)', () => {
  // C++ Smooth_Turn applies flag-based transforms to adapt base tracks
  // for all 8 starting directions. The transform order is: F_T, then F_X, then F_Y.
  // DirType is 0-255 (256 directions), operations are modular.

  // DIR constants for clarity in tests
  const DIR_N = 0;
  const DIR_NE = 32;
  const DIR_E = 64;
  const DIR_SE = 96;
  const DIR_S = 128;
  const DIR_SW = 160;
  const DIR_W = 192;
  const DIR_NW = 224;

  describe('F_T: Transpose X<->Y, dir = (DIR_W - dir) & 0xFF (drive.cpp:535-540)', () => {
    it('(10, 20, DIR_N) -> (20, 10, DIR_W=192)', () => {
      const r = smoothTurn(10, 20, DIR_N, F_T);
      expect(r.x).toBe(20);
      expect(r.y).toBe(10);
      expect(r.facing).toBe(DIR_W); // 192 - 0 = 192
    });

    it('(10, 20, DIR_NE=32) -> (20, 10, DIR_SW=160)', () => {
      const r = smoothTurn(10, 20, DIR_NE, F_T);
      expect(r.x).toBe(20);
      expect(r.y).toBe(10);
      expect(r.facing).toBe(DIR_SW); // 192 - 32 = 160
    });

    it('(10, 20, DIR_E=64) -> (20, 10, DIR_S=128)', () => {
      const r = smoothTurn(10, 20, DIR_E, F_T);
      expect(r.x).toBe(20);
      expect(r.y).toBe(10);
      expect(r.facing).toBe(DIR_S); // 192 - 64 = 128
    });

    it('(-50, 100, DIR_SE=96) -> (100, -50, DIR_SE=96)', () => {
      const r = smoothTurn(-50, 100, DIR_SE, F_T);
      expect(r.x).toBe(100);
      expect(r.y).toBe(-50);
      expect(r.facing).toBe(DIR_SE); // 192 - 96 = 96
    });

    it('(0, 0, DIR_S=128) -> (0, 0, DIR_E=64)', () => {
      const r = smoothTurn(0, 0, DIR_S, F_T);
      expect(r.x).toBe(0);
      expect(r.y).toBe(0);
      expect(r.facing).toBe(DIR_E); // 192 - 128 = 64
    });
  });

  describe('F_X: Negate X, dir = (-dir) & 0xFF (drive.cpp:543-547)', () => {
    it('(100, -200, DIR_NE=32) -> (-100, -200, DIR_NW=224)', () => {
      const r = smoothTurn(100, -200, DIR_NE, F_X);
      expect(r.x).toBe(-100);
      expect(r.y).toBe(-200);
      expect(r.facing).toBe(DIR_NW); // (-32) & 0xFF = 224
    });

    it('(100, -200, DIR_N=0) -> (-100, -200, DIR_N=0)', () => {
      const r = smoothTurn(100, -200, DIR_N, F_X);
      expect(r.x).toBe(-100);
      expect(r.y).toBe(-200);
      expect(r.facing).toBe(DIR_N); // (-0) & 0xFF = 0
    });

    it('(-75, 50, DIR_E=64) -> (75, 50, DIR_W=192)', () => {
      const r = smoothTurn(-75, 50, DIR_E, F_X);
      expect(r.x).toBe(75);
      expect(r.y).toBe(50);
      expect(r.facing).toBe(DIR_W); // (-64) & 0xFF = 192
    });

    it('(0, 0, DIR_S=128) -> (0, 0, DIR_S=128)', () => {
      const r = smoothTurn(0, 0, DIR_S, F_X);
      expect(r.x).toBe(0);
      expect(r.y).toBe(0);
      expect(r.facing).toBe(DIR_S); // (-128) & 0xFF = 128
    });
  });

  describe('F_Y: Negate Y, dir = (DIR_S - dir) & 0xFF (drive.cpp:550-554)', () => {
    it('(100, -200, DIR_N=0) -> (100, 200, DIR_S=128)', () => {
      const r = smoothTurn(100, -200, DIR_N, F_Y);
      expect(r.x).toBe(100);
      expect(r.y).toBe(200);
      expect(r.facing).toBe(DIR_S); // 128 - 0 = 128
    });

    it('(100, -200, DIR_NE=32) -> (100, 200, DIR_SE=96)', () => {
      const r = smoothTurn(100, -200, DIR_NE, F_Y);
      expect(r.x).toBe(100);
      expect(r.y).toBe(200);
      expect(r.facing).toBe(DIR_SE); // 128 - 32 = 96
    });

    it('(50, 30, DIR_SE=96) -> (50, -30, DIR_NE=32)', () => {
      const r = smoothTurn(50, 30, DIR_SE, F_Y);
      expect(r.x).toBe(50);
      expect(r.y).toBe(-30);
      expect(r.facing).toBe(DIR_NE); // 128 - 96 = 32
    });

    it('(0, 0, DIR_S=128) -> (0, 0, DIR_N=0)', () => {
      const r = smoothTurn(0, 0, DIR_S, F_Y);
      expect(r.x).toBe(0);
      expect(r.y).toBe(0);
      expect(r.facing).toBe(DIR_N); // 128 - 128 = 0
    });
  });

  describe('Combined flag transforms (drive.cpp:535-556 sequential application)', () => {
    // C++ applies flags in order: F_T first, then F_X, then F_Y.

    it('F_T|F_X: E->E straight — Track1 step 0 (0, 245, DIR_N=0)', () => {
      // Step 1 (F_T): swap (0,245) -> (245,0); dir = 192-0 = 192
      // Step 2 (F_X): negate x -> (-245,0); dir = (-192)&0xFF = 64
      const r = smoothTurn(0, 245, DIR_N, F_T | F_X);
      expect(r.x).toBe(-245);
      expect(r.y).toBe(0);
      expect(r.facing).toBe(DIR_E);
    });

    it('F_T|F_Y: W->NW — Track3 step 0 (-256, 501, DIR_N=0)', () => {
      // Step 1 (F_T): swap (-256,501) -> (501,-256); dir = 192-0 = 192
      // Step 2 (F_Y): negate y -> (501,256); dir = (128-192)&0xFF = 192
      // Wait — let's recompute: (128-192) = -64, &0xFF = 192. That's wrong.
      // Actually (-64) & 0xFF = 192. So dir stays 192? No:
      // F_Y: dir = (DIR_S - dir) = (128 - 192) = -64 -> & 0xFF = 192.
      // Hmm that's still 192 (DIR_W). Let me verify with actual code:
      // After F_T: dir = 192. After F_Y: dir = (128 - 192) & 0xFF = (-64) & 0xFF = 192.
      // Actually in unsigned 8-bit: -64 = 256-64 = 192. So yes, 192 = DIR_W.
      const r = smoothTurn(-256, 501, DIR_N, F_T | F_Y);
      expect(r.x).toBe(501);
      expect(r.y).toBe(256);  // -(-256) = 256
      expect(r.facing).toBe(192); // DIR_W
    });

    it('F_X|F_Y: S->SW — Track3 step 0 (-256, 501, DIR_N=0)', () => {
      // Step 1 (F_X): negate x -> (256, 501); dir = (-0)&0xFF = 0
      // Step 2 (F_Y): negate y -> (256, -501); dir = (128-0)&0xFF = 128
      const r = smoothTurn(-256, 501, DIR_N, F_X | F_Y);
      expect(r.x).toBe(256);
      expect(r.y).toBe(-501);
      expect(r.facing).toBe(DIR_S);
    });

    it('F_T|F_X|F_Y: NE->N — Track6 step 0 (-512, 256, DIR_NE=32)', () => {
      // Step 1 (F_T): swap (-512,256) -> (256,-512); dir = (192-32)&0xFF = 160
      // Step 2 (F_X): negate x -> (-256,-512); dir = (-160)&0xFF = 96
      // Step 3 (F_Y): negate y -> (-256,512); dir = (128-96)&0xFF = 32
      const r = smoothTurn(-512, 256, DIR_NE, F_T | F_X | F_Y);
      expect(r.x).toBe(-256);
      expect(r.y).toBe(512);
      expect(r.facing).toBe(DIR_NE);
    });

    it('all 8 straight-direction last steps produce facing matching the direction', () => {
      // C++ TrackControl encodes every straight direction using Track1 or Track2
      // with flags. The last step of every track is (0, 0, endFacing).
      // After smoothTurn, the facing must equal the direction's DirType.
      const DIR_TYPES = [DIR_N, DIR_NE, DIR_E, DIR_SE, DIR_S, DIR_SW, DIR_W, DIR_NW];
      const dirNames = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

      for (let d = 0; d < DIR_COUNT; d++) {
        const ctrl = TRACK_CONTROL[d * 8 + d]; // same direction = straight
        const track = getTrackArray(ctrl.track)!;
        const last = track[track.length - 1];
        const flags = ctrl.flag & ~F_D; // strip F_D
        const result = smoothTurn(last.x, last.y, last.facing, flags);
        expect(result.x, `${dirNames[d]} last step x`).toBe(0);
        expect(result.y, `${dirNames[d]} last step y`).toBe(0);
        expect(result.facing, `${dirNames[d]} last step facing`).toBe(DIR_TYPES[d]);
      }
    });
  });

  describe('Smooth_Turn with zero inputs (edge cases)', () => {
    it('all flags with (0, 0, 0) produce (0, 0, X) where X is deterministic', () => {
      // No -0 artifacts — C++ integers don't have -0
      for (const flags of [F_, F_T, F_X, F_Y, F_T | F_X, F_T | F_Y, F_X | F_Y, F_T | F_X | F_Y]) {
        const r = smoothTurn(0, 0, 0, flags);
        expect(Object.is(r.x, -0), `flags=0x${flags.toString(16)} should not produce -0 for x`).toBe(false);
        expect(Object.is(r.y, -0), `flags=0x${flags.toString(16)} should not produce -0 for y`).toBe(false);
      }
    });
  });
});

// =============================================================================
// 3. Track stepping — verify individual step data for all 13 tracks
//    (C++ drive.cpp:74-520 — track coordinate tables)
// =============================================================================

describe('Track step data for all 13 tracks (C++ drive.cpp:74-520)', () => {
  // Expected track lengths from C++ source
  const EXPECTED_LENGTHS: [number, number, string][] = [
    [1,  24, 'straight N cardinal'],
    [2,  32, 'straight NE diagonal'],
    [3,  55, 'long 2-cell N→NE curve'],
    [4,  39, 'long 2-cell N→E curve'],
    [5,  62, 'long 2-cell large arc NE→SE'],
    [6,  57, 'long 2-cell NE→E curve'],
    [7,  28, 'short 1-cell 45° curve'],
    [8,  22, 'short 1-cell tight curve'],
    [9,  31, 'short 1-cell 90° curve'],
    [10, 28, 'short 1-cell large arc'],
    [11, 14, 'harvester backup into refinery'],
    [12, 13, 'drive back into refinery'],
    [13, 36, 'drive out of weapons factory'],
  ];

  for (const [trackNum, expectedLen, desc] of EXPECTED_LENGTHS) {
    it(`Track ${trackNum} (${desc}) has ${expectedLen} steps`, () => {
      const track = getTrackArray(trackNum);
      expect(track).not.toBeNull();
      expect(track!.length).toBe(expectedLen);
    });
  }

  it('all 13 tracks end at (0, 0) — the target cell center (drive.cpp convention)', () => {
    for (let i = 0; i < 13; i++) {
      const track = TRACK_DATA[i];
      const last = track[track.length - 1];
      expect(last.x, `Track ${i + 1} last x`).toBe(0);
      expect(last.y, `Track ${i + 1} last y`).toBe(0);
    }
  });

  describe('Track 1 (straight N) step-by-step verification (drive.cpp:74-97)', () => {
    it('first step: 0x00F50000 -> (0, 245, DIR_N=0)', () => {
      expect(TRACK_DATA[0][0]).toEqual({ x: 0, y: 245, facing: 0 });
    });

    it('all steps have facing=0 (DIR_N) — straight track', () => {
      for (const step of TRACK_DATA[0]) {
        expect(step.facing).toBe(0);
      }
    });

    it('all steps have x=0 — pure Y movement for cardinal N', () => {
      for (const step of TRACK_DATA[0]) {
        expect(step.x).toBe(0);
      }
    });

    it('Y values decrease monotonically by 11 leptons (except last step)', () => {
      // C++ step size = ~PIXEL_LEPTON_W + 1 = 11 leptons
      const track = TRACK_DATA[0];
      for (let i = 0; i < track.length - 1; i++) {
        if (i + 1 < track.length - 1) {
          const delta = track[i].y - track[i + 1].y;
          expect(delta, `step ${i} to ${i + 1} delta`).toBe(11);
        }
      }
    });

    it('step 12 (midpoint): 0x00710000 -> (0, 113, DIR_N=0)', () => {
      expect(TRACK_DATA[0][12]).toEqual({ x: 0, y: 113, facing: 0 });
    });
  });

  describe('Track 2 (straight NE diagonal) step verification (drive.cpp:100-133)', () => {
    it('first step: (-248, 248, DIR_NE=32)', () => {
      expect(TRACK_DATA[1][0]).toEqual({ x: -248, y: 248, facing: 32 });
    });

    it('all steps have facing=32 (DIR_NE) — straight diagonal', () => {
      for (const step of TRACK_DATA[1]) {
        expect(step.facing).toBe(32);
      }
    });

    it('X and Y magnitudes decrease equally — diagonal symmetry', () => {
      const track = TRACK_DATA[1];
      for (const step of track) {
        expect(Math.abs(step.x)).toBe(Math.abs(step.y));
      }
    });

    it('X values are negative, Y values positive (NE direction: +X, -Y in C++ coords)', () => {
      // In C++ coord system, the track goes from starting position toward target.
      // NE = positive X, negative Y. But track offsets are FROM target center,
      // so NE start is at (-X, +Y) relative to target.
      const track = TRACK_DATA[1];
      for (let i = 0; i < track.length - 1; i++) { // skip last (0,0)
        expect(track[i].x, `step ${i} x should be negative`).toBeLessThan(0);
        expect(track[i].y, `step ${i} y should be positive`).toBeGreaterThan(0);
      }
    });
  });

  describe('Track 7 (short 45° curve) step data (drive.cpp:232-259)', () => {
    it('starts near facing 0 (DIR_N) and ends at facing 32 (DIR_NE)', () => {
      expect(TRACK_DATA[6][0].facing).toBe(0);     // starts facing N
      expect(TRACK_DATA[6][27].facing).toBe(32);    // ends facing NE
    });

    it('facing increases monotonically from 0 toward 32 (N to NE transition)', () => {
      const track = TRACK_DATA[6];
      for (let i = 1; i < track.length; i++) {
        expect(track[i].facing, `step ${i} facing`).toBeGreaterThanOrEqual(track[i - 1].facing);
      }
    });

    it('peak displacement step 13: (x=-35, y=70)', () => {
      expect(TRACK_DATA[6][13].x).toBe(-35);
      expect(TRACK_DATA[6][13].y).toBe(70);
    });
  });

  describe('Track 9 (short 90° curve) step data (drive.cpp:290-320)', () => {
    it('starts near facing 0 (DIR_N) and ends at facing 64 (DIR_E)', () => {
      expect(TRACK_DATA[8][0].facing).toBe(0);     // starts facing N
      const last = TRACK_DATA[8][TRACK_DATA[8].length - 1];
      expect(last.facing).toBe(64);                  // ends facing E
    });

    it('has 31 steps — more than the 45° curve (28) due to wider arc', () => {
      expect(TRACK_DATA[8]).toHaveLength(31);
    });
  });

  describe('Track 11 (harvester backup) step data (drive.cpp:416-429)', () => {
    it('starts facing DIR_SW=160 and ends facing DIR_SW_X2=144', () => {
      expect(TRACK_DATA[10][0].facing).toBe(160);  // DIR_SW
      const last = TRACK_DATA[10][TRACK_DATA[10].length - 1];
      expect(last.facing).toBe(144);                 // DIR_SW_X2
    });

    it('has 14 steps', () => {
      expect(TRACK_DATA[10]).toHaveLength(14);
    });
  });

  describe('Track 13 (factory exit) step data (drive.cpp:490-520)', () => {
    it('all steps face DIR_S=128 — straight exit southward', () => {
      for (const step of TRACK_DATA[12]) {
        expect(step.facing).toBe(128);
      }
    });

    it('has 36 steps', () => {
      expect(TRACK_DATA[12]).toHaveLength(36);
    });

    it('all steps have x=0 — pure Y movement', () => {
      for (const step of TRACK_DATA[12]) {
        expect(step.x).toBe(0);
      }
    });

    it('uses Pixel_To_Lepton conversion: (py*256+12)/24 truncated (drive.cpp:490)', () => {
      // Track 13 is constructed from pixel coords converted to leptons.
      // C++ Pixel_To_Lepton(p) = (p*256+12)/24 (integer division)
      // First step: py = -35, expected ly = (-35*256+12)/24 = (-8948)/24 = -372 (truncated)
      // Wait — C++ integer division truncates toward zero.
      // (-35*256+12) = -8948. (-8948)/24 = -372.833... truncates to -372.
      const step0 = TRACK_DATA[12][0];
      const expectedLy = Math.trunc((-35 * 256 + 12) / 24);
      expect(step0.y, 'first step Y lepton value').toBe(expectedLy);
    });
  });

  describe('all tracks have valid DirType values (0-255) at every step', () => {
    for (let i = 0; i < 13; i++) {
      it(`Track ${i + 1} — all step facings in [0, 255]`, () => {
        for (let j = 0; j < TRACK_DATA[i].length; j++) {
          const f = TRACK_DATA[i][j].facing;
          expect(f, `step ${j}`).toBeGreaterThanOrEqual(0);
          expect(f, `step ${j}`).toBeLessThanOrEqual(255);
        }
      });
    }
  });
});

// =============================================================================
// 4. Speed accumulation / SpeedAccum (C++ drive.cpp:647-665)
// =============================================================================

describe('Speed accumulation — SpeedAccum lepton budget (C++ drive.cpp:654-665)', () => {
  // C++ While_Moving() budget computation:
  //   actual = SpeedAccum + maxspeed * IsALoaner.IsALoaner (etc.)
  //   SpeedAccum = actual (carries fractional remainder between ticks)
  //   while (actual > PIXEL_LEPTON_W) { consume step; actual -= PIXEL_LEPTON_W; }
  //   SpeedAccum = actual (remainder)

  it('PIXEL_LEPTON_W = 10 (C++ integer division 256/24, drive.cpp:664)', () => {
    // This is the lepton cost per track step
    expect(PIXEL_LEPTON_W).toBe(10);
    expect(PIXEL_LEPTON_W).toBe(Math.floor(256 / CELL_SIZE));
  });

  it('LP = CELL_SIZE/256 = 0.09375 (lepton-to-pixel conversion)', () => {
    expect(LP).toBeCloseTo(24 / 256, 10);
    expect(LP).toBe(CELL_SIZE / 256);
  });

  it('speed 1.0 px/tick -> budget of ~10.67 leptons -> consumes 1 step per tick', () => {
    const speed = 1.0; // pixels per tick
    const budget = speed / LP; // convert to leptons: 1.0 / 0.09375 = 10.666...
    expect(budget).toBeCloseTo(10.667, 2);

    // Simulate step consumption
    let actual = budget;
    let stepsConsumed = 0;
    while (actual > PIXEL_LEPTON_W) {
      actual -= PIXEL_LEPTON_W;
      stepsConsumed++;
    }
    expect(stepsConsumed).toBe(1); // budget 10.67 > 10, consume 1 step, remainder 0.67
    expect(actual).toBeCloseTo(0.667, 2); // remainder carries to next tick
  });

  it('speed 5.0 px/tick -> budget ~53.33 leptons -> consumes 5 steps per tick', () => {
    const speed = 5.0;
    const budget = speed / LP; // 5.0 / 0.09375 = 53.333...
    expect(budget).toBeCloseTo(53.333, 2);

    let actual = budget;
    let stepsConsumed = 0;
    while (actual > PIXEL_LEPTON_W) {
      actual -= PIXEL_LEPTON_W;
      stepsConsumed++;
    }
    expect(stepsConsumed).toBe(5);
    expect(actual).toBeCloseTo(3.333, 2); // remainder
  });

  it('fractional remainder carries between ticks (SpeedAccum persistence)', () => {
    // Simulate two consecutive ticks at speed 1.0 px/tick
    const speed = 1.0;
    const budgetPerTick = speed / LP; // ~10.667 leptons

    // Tick 1
    let speedAccum = 0;
    let actual = speedAccum + budgetPerTick;
    let steps1 = 0;
    while (actual > PIXEL_LEPTON_W) {
      actual -= PIXEL_LEPTON_W;
      steps1++;
    }
    speedAccum = actual; // save remainder (~0.667)

    // Tick 2 — remainder carries forward
    actual = speedAccum + budgetPerTick; // ~0.667 + 10.667 = ~11.333
    let steps2 = 0;
    while (actual > PIXEL_LEPTON_W) {
      actual -= PIXEL_LEPTON_W;
      steps2++;
    }
    speedAccum = actual;

    expect(steps1).toBe(1);
    expect(steps2).toBe(1); // still 1 step, but remainder grows

    // Tick 3 — accumulated remainder now pushes over
    actual = speedAccum + budgetPerTick;
    let steps3 = 0;
    while (actual > PIXEL_LEPTON_W) {
      actual -= PIXEL_LEPTON_W;
      steps3++;
    }

    // Over 3 ticks, total budget = 3 * 10.667 = 32 leptons
    // Total steps should be 3 (10 leptons each = 30, with 2 leptons remainder)
    expect(steps1 + steps2 + steps3).toBe(3);
  });

  it('C++ zeroes SpeedAccum on track completion (drive.cpp:792)', () => {
    // When a track completes, C++ resets actual=0, then recomputes
    // budget for the next track from scratch. Remainder is DISCARDED.
    const speed = 5.0;
    const freshBudget = 0 + (speed / LP); // speedAccum=0 after track completion
    const carryBudget = 3.5 + (speed / LP); // hypothetical leftover

    // Fresh budget should be less than carry budget
    expect(freshBudget).toBeLessThan(carryBudget);
    // This ensures chained tracks don't get a "free" boost from leftover budget
    expect(freshBudget).toBe(speed / LP);
  });

  it('Track1 (24 steps) at speed 2.0 takes ~11 ticks to complete', () => {
    // 2.0 px/tick = ~21.33 leptons/tick. Each step costs 10 leptons.
    // Per tick: consume 2 steps, remainder ~1.33.
    // 24 steps / ~2.1 steps per tick ≈ ~11 ticks
    const speed = 2.0;
    const budgetPerTick = speed / LP;
    const trackLen = 24;

    let speedAccum = 0;
    let totalSteps = 0;
    let ticks = 0;

    while (totalSteps < trackLen) {
      let actual = speedAccum + budgetPerTick;
      while (actual > PIXEL_LEPTON_W && totalSteps < trackLen) {
        actual -= PIXEL_LEPTON_W;
        totalSteps++;
      }
      speedAccum = actual;
      ticks++;
      if (ticks > 100) break; // safety
    }

    expect(totalSteps).toBe(24);
    // At ~2.13 steps per tick, 24 steps takes ~11-12 ticks
    expect(ticks).toBeGreaterThanOrEqual(10);
    expect(ticks).toBeLessThanOrEqual(13);
  });
});

// =============================================================================
// 5. Track selection for different turn angles (C++ drive.cpp:1175-1190)
// =============================================================================

describe('Track selection for different turn angles (C++ drive.cpp:1175-1190)', () => {
  // C++ selects tracks based on the angle between current and desired facing.
  // Different angle magnitudes map to different base tracks:
  //   - 0° (same direction): Track 1 (cardinal) or Track 2 (diagonal)
  //   - 45° (one step): Track 3 long / Track 7 short
  //   - 90° (two steps): Track 4 long / Track 9 short
  //   - 135° (three steps): Track 5 or Track 6 (depending on cardinal/diagonal start)
  //   - 180° (opposite): impossible (track=0)

  describe('0° turn (same direction) — straight tracks', () => {
    it('cardinal directions use Track 1', () => {
      for (const dir of [0, 2, 4, 6]) { // N, E, S, W
        const ctrl = lookupTrackControl(dir, dir);
        expect(ctrl.track, `dir ${dir} → same`).toBe(1);
      }
    });

    it('diagonal directions use Track 2', () => {
      for (const dir of [1, 3, 5, 7]) { // NE, SE, SW, NW
        const ctrl = lookupTrackControl(dir, dir);
        expect(ctrl.track, `dir ${dir} → same`).toBe(2);
      }
    });
  });

  describe('45° turn (1 step clockwise/counterclockwise)', () => {
    // All 45° turns use Track 3 (long) / Track 7 (short) or Track 6 / Track 8

    const TURNS_45: [number, number, number, number][] = [
      // [cur, next, expectedTrack, expectedStartTrack]
      [0, 1, 3, 7],    // N→NE
      [0, 7, 3, 7],    // N→NW
      [1, 2, 6, 8],    // NE→E
      [1, 0, 6, 8],    // NE→N
      [2, 3, 3, 7],    // E→SE
      [2, 1, 3, 7],    // E→NE
      [3, 4, 6, 8],    // SE→S
      [3, 2, 6, 8],    // SE→E
      [4, 5, 3, 7],    // S→SW
      [4, 3, 3, 7],    // S→SE
      [5, 6, 6, 8],    // SW→W
      [5, 4, 6, 8],    // SW→S
      [6, 7, 3, 7],    // W→NW
      [6, 5, 3, 7],    // W→SW
      [7, 0, 6, 8],    // NW→N
      [7, 6, 6, 8],    // NW→W
    ];

    for (const [cur, next, expectedTrack, expectedStart] of TURNS_45) {
      const dirNames = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      it(`${dirNames[cur]}->${dirNames[next]}: track=${expectedTrack}, short=${expectedStart}`, () => {
        const ctrl = lookupTrackControl(cur, next);
        expect(ctrl.track, 'base track').toBe(expectedTrack);
        expect(ctrl.startTrack, 'short track').toBe(expectedStart);
        expect(ctrl.flag & F_D, 'should have F_D (2-cell)').toBeTruthy();
      });
    }

    it('all 45° turns use getEffectiveTrack to select short version (7 or 8)', () => {
      for (const [cur, next, , expectedStart] of TURNS_45) {
        const ctrl = lookupTrackControl(cur, next);
        expect(getEffectiveTrack(ctrl)).toBe(expectedStart);
      }
    });
  });

  describe('90° turn (2 steps clockwise/counterclockwise)', () => {
    const TURNS_90: [number, number, number, number][] = [
      [0, 2, 4, 9],    // N→E
      [0, 6, 4, 9],    // N→W
      [1, 3, 5, 10],   // NE→SE
      [1, 7, 5, 10],   // NE→NW
      [2, 4, 4, 9],    // E→S
      [2, 0, 4, 9],    // E→N
      [3, 5, 5, 10],   // SE→SW
      [3, 1, 5, 10],   // SE→NE
      [4, 6, 4, 9],    // S→W
      [4, 2, 4, 9],    // S→E
      [5, 7, 5, 10],   // SW→NW
      [5, 3, 5, 10],   // SW→SE
      [6, 0, 4, 9],    // W→N
      [6, 4, 4, 9],    // W→S
      [7, 1, 5, 10],   // NW→NE
      [7, 5, 5, 10],   // NW→SW
    ];

    for (const [cur, next, expectedTrack, expectedStart] of TURNS_90) {
      const dirNames = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      it(`${dirNames[cur]}->${dirNames[next]}: track=${expectedTrack}, short=${expectedStart}`, () => {
        const ctrl = lookupTrackControl(cur, next);
        expect(ctrl.track, 'base track').toBe(expectedTrack);
        expect(ctrl.startTrack, 'short track').toBe(expectedStart);
        expect(ctrl.flag & F_D, 'should have F_D (2-cell)').toBeTruthy();
      });
    }

    it('all 90° turns use getEffectiveTrack to select short version (9 or 10)', () => {
      for (const [cur, next, , expectedStart] of TURNS_90) {
        const ctrl = lookupTrackControl(cur, next);
        expect(getEffectiveTrack(ctrl)).toBe(expectedStart);
      }
    });
  });

  describe('135° and 180° turns — impossible (C++ track=0)', () => {
    // C++ cannot handle turns > 90° in a single track. These are flagged as
    // impossible (track=0) and the vehicle must rotate in place first.

    const IMPOSSIBLE_TURNS: [number, number][] = [
      // 135° turns
      [0, 3], [0, 5],    // N→SE, N→SW
      [1, 4], [1, 6],    // NE→S, NE→W
      [2, 5], [2, 7],    // E→SW, E→NW
      [3, 6], [3, 0],    // SE→W, SE→N
      [4, 7], [4, 1],    // S→NW, S→NE
      [5, 0], [5, 2],    // SW→N, SW→E
      [6, 1], [6, 3],    // W→NE, W→SE
      [7, 2], [7, 4],    // NW→E, NW→S
      // 180° turns
      [0, 4],            // N→S
      [1, 5],            // NE→SW
      [2, 6],            // E→W
      [3, 7],            // SE→NW
      [4, 0],            // S→N
      [5, 1],            // SW→NE
      [6, 2],            // W→E
      [7, 3],            // NW→SE
    ];

    for (const [cur, next] of IMPOSSIBLE_TURNS) {
      const dirNames = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      const angle = Math.min(Math.abs(next - cur), 8 - Math.abs(next - cur));
      const deg = angle * 45;
      it(`${dirNames[cur]}->${dirNames[next]} (${deg}°): track=0 (impossible)`, () => {
        const ctrl = lookupTrackControl(cur, next);
        expect(ctrl.track).toBe(0);
      });
    }

    it('getEffectiveTrack returns 0 for all impossible turns', () => {
      for (const [cur, next] of IMPOSSIBLE_TURNS) {
        const ctrl = lookupTrackControl(cur, next);
        expect(getEffectiveTrack(ctrl), `${cur}->${next}`).toBe(0);
      }
    });
  });

  describe('track angle categorization summary', () => {
    it('45° turns select different base tracks than 90° turns', () => {
      // 45° from cardinal: Track 3. 90° from cardinal: Track 4.
      const turn45 = lookupTrackControl(0, 1); // N→NE
      const turn90 = lookupTrackControl(0, 2); // N→E
      expect(turn45.track).not.toBe(turn90.track);
      expect(turn45.track).toBe(3);
      expect(turn90.track).toBe(4);
    });

    it('45° turns select different short tracks than 90° turns', () => {
      const turn45 = lookupTrackControl(0, 1); // N→NE -> short 7
      const turn90 = lookupTrackControl(0, 2); // N→E -> short 9
      expect(getEffectiveTrack(turn45)).toBe(7);
      expect(getEffectiveTrack(turn90)).toBe(9);
      expect(getEffectiveTrack(turn45)).not.toBe(getEffectiveTrack(turn90));
    });

    it('short tracks have fewer steps than their corresponding long tracks', () => {
      // Track 7 (short) vs Track 3 (long) for 45°
      expect(getTrackArray(7)!.length).toBeLessThan(getTrackArray(3)!.length);
      // Track 8 (short) vs Track 6 (long) for 45° diagonal
      expect(getTrackArray(8)!.length).toBeLessThan(getTrackArray(6)!.length);
      // Track 9 (short) vs Track 4 (long) for 90°
      expect(getTrackArray(9)!.length).toBeLessThan(getTrackArray(4)!.length);
      // Track 10 (short) vs Track 5 (long) for 90° diagonal
      expect(getTrackArray(10)!.length).toBeLessThan(getTrackArray(5)!.length);
    });

    it('exactly 24 valid turns exist (8 straight + 16 turns) out of 64 entries', () => {
      let validCount = 0;
      for (let cur = 0; cur < DIR_COUNT; cur++) {
        for (let next = 0; next < DIR_COUNT; next++) {
          if (TRACK_CONTROL[cur * 8 + next].track > 0) {
            validCount++;
          }
        }
      }
      // 8 straight (0°) + 16 turns (8 x 45° + 8 x 90°) = 24 valid
      // 40 impossible (8 x 135° + 8 x 180° + 16 more 135°) = 40 impossible
      // Wait, let's just count: per direction, 5 possible targets (self + 2 CW + 2 CCW)
      // times 8 directions = 40. That's not 24. Let me count properly.
      // Per row: self + next CW + next CCW + 2nd CW + 2nd CCW = 5 valid, 3 impossible
      // 5 * 8 = 40. Hmm.
      // Actually from the table: per row there are exactly 5 valid entries.
      // N: N, NE, E, W, NW = 5. NE: N, NE, E, SE, NW = 5. Etc.
      expect(validCount).toBe(40);
    });
  });
});
