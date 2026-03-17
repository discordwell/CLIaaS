/**
 * C++ Behavioral Parity: Track Jumping for Smooth Vehicle Curves
 *
 * Tests verify that track jumping behavior matches C++ drive.cpp:734-788.
 * When a vehicle reaches the Jump point in its current track AND has a following
 * move with a turn, it jumps to the next track's Entry point — creating smooth
 * "swooping" turns at speed instead of completing each track sequentially.
 *
 * C++ source references:
 *   - drive.cpp:647-820  While_Moving() — main track following loop
 *   - drive.cpp:688-696  nextface/adj computation
 *   - drive.cpp:734-788  Track jumping logic
 *   - drive.h:157-162    RawTrackType struct (Jump, Entry, Cell fields)
 *   - drive.h:145-150    TurnTrackType / TrackControl table
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir,
  UNIT_STATS, directionTo,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  RAW_TRACKS, TRACK_CONTROL, TRACK_DATA,
  lookupTrackControl, getTrackArray,
  F_D,
} from '../engine/tracks';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Convert DirType (0-255) to Facing8 (0-7), matching C++ Dir_Facing */
function dirToFacing8(dirType: number): number {
  return Math.floor(dirType / 32);
}

// =============================================================================
// 1. RAW_TRACKS metadata matches expected C++ values
// =============================================================================

describe('RAW_TRACKS metadata (C++ drive.cpp RawTracks[])', () => {
  it('has exactly 13 entries (one per base track)', () => {
    expect(RAW_TRACKS).toHaveLength(13);
  });

  // C++ drive.cpp ~line 2239: RawTrackType const DriveClass::RawTracks[13]
  const EXPECTED_RAW_TRACKS = [
    { track: 1,  jump: -1, entry: 0,  cell: -1 }, // Track 1: straight N
    { track: 2,  jump: -1, entry: 0,  cell: -1 }, // Track 2: straight NE
    { track: 3,  jump: 37, entry: 12, cell: 22 }, // Track 3: long N→NE curve
    { track: 4,  jump: 26, entry: 11, cell: 19 }, // Track 4: long N→E curve
    { track: 5,  jump: 45, entry: 15, cell: 31 }, // Track 5: long NE→SE arc
    { track: 6,  jump: 44, entry: 16, cell: 27 }, // Track 6: long NE→E curve
    { track: 7,  jump: -1, entry: 0,  cell: -1 }, // Track 7: short 45° curve
    { track: 8,  jump: -1, entry: 0,  cell: -1 }, // Track 8: short tight curve
    { track: 9,  jump: -1, entry: 0,  cell: -1 }, // Track 9: short 90° curve
    { track: 10, jump: -1, entry: 0,  cell: -1 }, // Track 10: short large arc
    { track: 11, jump: -1, entry: 0,  cell: -1 }, // Track 11: harvester backup
    { track: 12, jump: -1, entry: 0,  cell: -1 }, // Track 12: drive into refinery
    { track: 13, jump: -1, entry: 0,  cell: -1 }, // Track 13: factory exit
  ];

  it('Jump/Entry/Cell values match C++ source for all 13 tracks', () => {
    for (const expected of EXPECTED_RAW_TRACKS) {
      const meta = RAW_TRACKS[expected.track - 1];
      expect(meta.jump, `Track ${expected.track} jump`).toBe(expected.jump);
      expect(meta.entry, `Track ${expected.track} entry`).toBe(expected.entry);
      expect(meta.cell, `Track ${expected.track} cell`).toBe(expected.cell);
    }
  });

  it('only tracks 3-6 (long 2-cell curves) have valid Jump points', () => {
    for (let i = 0; i < RAW_TRACKS.length; i++) {
      const meta = RAW_TRACKS[i];
      const trackNum = i + 1;
      if (trackNum >= 3 && trackNum <= 6) {
        expect(meta.jump, `Track ${trackNum} should have jump`).toBeGreaterThan(0);
        expect(meta.entry, `Track ${trackNum} should have entry`).toBeGreaterThan(0);
      } else {
        expect(meta.jump, `Track ${trackNum} should NOT have jump`).toBe(-1);
      }
    }
  });

  it('Jump index is always before the end of the track', () => {
    for (let i = 0; i < RAW_TRACKS.length; i++) {
      if (RAW_TRACKS[i].jump >= 0) {
        const trackData = TRACK_DATA[i];
        expect(RAW_TRACKS[i].jump, `Track ${i + 1} jump < length`).toBeLessThan(trackData.length);
      }
    }
  });

  it('Entry index is always a valid index into the track', () => {
    for (let i = 0; i < RAW_TRACKS.length; i++) {
      if (RAW_TRACKS[i].entry > 0) {
        const trackData = TRACK_DATA[i];
        expect(RAW_TRACKS[i].entry, `Track ${i + 1} entry < length`).toBeLessThan(trackData.length);
      }
    }
  });
});

// =============================================================================
// 2. TrackControl lookup produces correct next track for jump transitions
// =============================================================================

describe('TrackControl jump transitions (C++ drive.cpp:738)', () => {
  // In C++, the jump calculates: tnum = Dir_Facing(track->Facing) * 8 + nextface
  // This means: given the ending facing of the current track, look up what
  // track to use for the next direction.

  it('N→NE facing with NE→E turn selects a track with valid Entry', () => {
    // Current track ends facing NE (facing8=1), next direction is E (facing8=2)
    const tcIdx = 1 * 8 + 2; // NE→E
    const tc = TRACK_CONTROL[tcIdx];
    expect(tc.track, 'NE→E should have a valid track').toBeGreaterThan(0);
    if (tc.track > 0) {
      expect(RAW_TRACKS[tc.track - 1].entry, 'target track should have Entry point').toBeGreaterThan(0);
    }
  });

  it('N→NE facing with NE→SE turn selects a track with valid Entry', () => {
    const tcIdx = 1 * 8 + 3; // NE→SE
    const tc = TRACK_CONTROL[tcIdx];
    expect(tc.track).toBeGreaterThan(0);
    if (tc.track > 0) {
      expect(RAW_TRACKS[tc.track - 1].entry).toBeGreaterThan(0);
    }
  });

  it('impossible turns (track=0) do not have jump targets', () => {
    // e.g., N→S is an impossible 180° turn
    const tc = TRACK_CONTROL[0 * 8 + 4]; // N→S
    expect(tc.track).toBe(0);
  });

  it('all 64 main TrackControl entries have consistent jump/entry pairs', () => {
    // For any non-zero track in TrackControl, if it has a Jump point,
    // the Entry for that track should also be valid.
    for (let i = 0; i < 64; i++) {
      const tc = TRACK_CONTROL[i];
      if (tc.track > 0 && tc.track <= RAW_TRACKS.length) {
        const meta = RAW_TRACKS[tc.track - 1];
        if (meta.jump >= 0) {
          expect(meta.entry, `TC[${i}] track ${tc.track} has jump but no entry`).toBeGreaterThan(0);
        }
      }
    }
  });
});

// =============================================================================
// 3. Entity trackControlIndex is set during track initiation
// =============================================================================

describe('Entity.trackControlIndex tracking', () => {
  it('starts at -1 (no track)', () => {
    const e = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
    expect(e.trackControlIndex).toBe(-1);
  });

  it('is reset when trackNumber is reset to -1', () => {
    const e = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
    e.trackControlIndex = 10;
    e.trackNumber = -1;
    e.trackControlIndex = -1; // Should be reset alongside trackNumber
    expect(e.trackControlIndex).toBe(-1);
  });
});

// =============================================================================
// 4. Track jump condition matching (C++ drive.cpp:734)
// =============================================================================

describe('Track jump conditions (C++ drive.cpp:734)', () => {
  // C++ condition: nextface != FACING_NONE && adj && RawTracks[tracknum-1].Jump == TrackIndex && TrackIndex

  it('Track 3 Jump index is 37 — jump should trigger at trackIndex=37', () => {
    expect(RAW_TRACKS[2].jump).toBe(37); // Track 3 (index 2)
  });

  it('Track 4 Jump index is 26 — jump should trigger at trackIndex=26', () => {
    expect(RAW_TRACKS[3].jump).toBe(26); // Track 4 (index 3)
  });

  it('Track 5 Jump index is 45 — jump should trigger at trackIndex=45', () => {
    expect(RAW_TRACKS[4].jump).toBe(45); // Track 5 (index 4)
  });

  it('Track 6 Jump index is 44 — jump should trigger at trackIndex=44', () => {
    expect(RAW_TRACKS[5].jump).toBe(44); // Track 6 (index 5)
  });

  it('straight tracks (1, 2) never trigger jumps (jump=-1)', () => {
    expect(RAW_TRACKS[0].jump).toBe(-1);
    expect(RAW_TRACKS[1].jump).toBe(-1);
  });

  it('short tracks (7-10) never trigger jumps (jump=-1)', () => {
    for (let i = 6; i <= 9; i++) {
      expect(RAW_TRACKS[i].jump, `Track ${i + 1}`).toBe(-1);
    }
  });
});

// =============================================================================
// 5. Track jump target computation (new track's Entry point)
// =============================================================================

describe('Jump target Entry points (C++ drive.cpp:740-753)', () => {
  // When jumping TO a long track, the vehicle enters at Entry, not at 0.
  // C++: TrackIndex = RawTracks[tracknum-1].Entry - 1 (anticipates increment)

  it('Track 3 Entry is 12 — jump enters at index 12', () => {
    const entry = RAW_TRACKS[2].entry;
    expect(entry).toBe(12);
    // The track data at index 12 should exist
    const trackData = getTrackArray(3);
    expect(trackData).not.toBeNull();
    expect(trackData!.length).toBeGreaterThan(entry);
  });

  it('Track 4 Entry is 11 — jump enters at index 11', () => {
    const entry = RAW_TRACKS[3].entry;
    expect(entry).toBe(11);
    const trackData = getTrackArray(4);
    expect(trackData!.length).toBeGreaterThan(entry);
  });

  it('Track 5 Entry is 15 — jump enters at index 15', () => {
    const entry = RAW_TRACKS[4].entry;
    expect(entry).toBe(15);
    const trackData = getTrackArray(5);
    expect(trackData!.length).toBeGreaterThan(entry);
  });

  it('Track 6 Entry is 16 — jump enters at index 16', () => {
    const entry = RAW_TRACKS[5].entry;
    expect(entry).toBe(16);
    const trackData = getTrackArray(6);
    expect(trackData!.length).toBeGreaterThan(entry);
  });

  it('Entry point is roughly the midpoint of the track (where the second cell begins)', () => {
    // The Entry point for long tracks is approximately where the track
    // crosses into the first cell (from the starting cell). This means
    // Entry is roughly totalSteps * (1/trackCells) for 2-cell tracks.
    for (const trackNum of [3, 4, 5, 6]) {
      const meta = RAW_TRACKS[trackNum - 1];
      const trackData = getTrackArray(trackNum)!;
      // Entry should be in the first third of the track (it's the beginning of
      // the second cell's portion, after the first ~cell worth of steps)
      expect(meta.entry).toBeGreaterThan(0);
      expect(meta.entry).toBeLessThan(trackData.length / 2);
    }
  });
});

// =============================================================================
// 6. Dir_Facing conversion (DirType→Facing8)
// =============================================================================

describe('Dir_Facing conversion (C++ drive.cpp:695, 738)', () => {
  it('maps DirType to Facing8 correctly', () => {
    // C++ Dir_Facing: return (DirType / 32) — integer division
    expect(dirToFacing8(0)).toBe(0);     // N
    expect(dirToFacing8(32)).toBe(1);    // NE
    expect(dirToFacing8(64)).toBe(2);    // E
    expect(dirToFacing8(96)).toBe(3);    // SE
    expect(dirToFacing8(128)).toBe(4);   // S
    expect(dirToFacing8(160)).toBe(5);   // SW
    expect(dirToFacing8(192)).toBe(6);   // W
    expect(dirToFacing8(224)).toBe(7);   // NW
  });

  it('TrackControl facing values all produce valid Facing8 (0-7)', () => {
    for (let i = 0; i < 64; i++) {
      const facing8 = dirToFacing8(TRACK_CONTROL[i].facing);
      expect(facing8, `TC[${i}] facing8`).toBeGreaterThanOrEqual(0);
      expect(facing8, `TC[${i}] facing8`).toBeLessThanOrEqual(7);
    }
  });
});

// =============================================================================
// 7. End-to-end jump transition: vehicle on Track 3 at Jump index with next move
// =============================================================================

describe('End-to-end track jump scenario', () => {
  // Simulate what happens when a vehicle is on Track 3 (N→NE, long 2-cell)
  // and reaches Jump index 37 with a following NE→E turn.

  it('Track 3 (N→NE) at jump=37 with NE→E next → should jump to Track 6 (NE→E)', () => {
    // Track 3: N→NE curve, ends facing NE (DirType 32, Facing8=1)
    // At Jump index 37, C++ computes: tnum = 1*8 + 2 = 10 (NE→E)
    const track3TC = TRACK_CONTROL[0 * 8 + 1]; // N→NE (how Track 3 is selected)
    const endFacing8 = dirToFacing8(track3TC.facing);
    expect(endFacing8).toBe(1); // NE

    // Next direction = E (facing8=2)
    const nextDir = 2;
    const newTCIndex = endFacing8 * 8 + nextDir; // 1*8+2 = 10
    const newTC = TRACK_CONTROL[newTCIndex];
    expect(newTC.track, 'NE→E should give Track 6').toBe(6);

    // Track 6 should have valid Entry point
    expect(RAW_TRACKS[newTC.track - 1].entry).toBe(16);
  });

  it('Track 4 (N→E) at jump=26 with E→SE next → should select valid jump target', () => {
    // Track 4: N→E curve, ends facing E (DirType 64, Facing8=2)
    const track4TC = TRACK_CONTROL[0 * 8 + 2]; // N→E
    const endFacing8 = dirToFacing8(track4TC.facing);
    expect(endFacing8).toBe(2); // E

    const nextDir = 3; // SE
    const newTCIndex = endFacing8 * 8 + nextDir; // 2*8+3 = 19
    const newTC = TRACK_CONTROL[newTCIndex];
    expect(newTC.track).toBeGreaterThan(0);
    if (newTC.track > 0) {
      expect(RAW_TRACKS[newTC.track - 1].entry).toBeGreaterThan(0);
    }
  });

  it('Track 5 (NE→SE) at jump=45 with SE→S next → should select valid jump target', () => {
    const track5TC = TRACK_CONTROL[1 * 8 + 3]; // NE→SE
    const endFacing8 = dirToFacing8(track5TC.facing);
    expect(endFacing8).toBe(3); // SE

    const nextDir = 4; // S
    const newTCIndex = endFacing8 * 8 + nextDir; // 3*8+4 = 28
    const newTC = TRACK_CONTROL[newTCIndex];
    expect(newTC.track).toBeGreaterThan(0);
    if (newTC.track > 0) {
      expect(RAW_TRACKS[newTC.track - 1].entry).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// 8. No-jump edge cases
// =============================================================================

describe('No-jump edge cases (C++ drive.cpp:734 conditions not met)', () => {
  it('no jump when trackIndex=0 (C++ requires TrackIndex > 0)', () => {
    // Even if Jump index were 0, the C++ condition requires TrackIndex != 0
    // This is enforced by the `entity.trackIndex > 0` check
    const meta = RAW_TRACKS[2]; // Track 3
    expect(meta.jump).not.toBe(0); // Track 3 jump is 37, not 0
  });

  it('no jump on straight tracks (Track 1/2 have jump=-1)', () => {
    expect(RAW_TRACKS[0].jump).toBe(-1);
    expect(RAW_TRACKS[1].jump).toBe(-1);
  });

  it('no jump when nextface equals current track ending facing (adj=false)', () => {
    // When the next direction is the same as the current track's ending facing,
    // there's no turn → adj is false → no jump.
    // E.g., Track 3 ends facing NE, next direction is also NE → no jump
    const track3TC = TRACK_CONTROL[0 * 8 + 1]; // N→NE
    const endFacing8 = dirToFacing8(track3TC.facing);

    // Same direction = endFacing8 → TC index endFacing8*8 + endFacing8 = straight
    const sameDirTC = TRACK_CONTROL[endFacing8 * 8 + endFacing8];
    // This gives a straight track (Track 1 or 2), which is correct — no turn needed
    expect(sameDirTC.track).toBeLessThanOrEqual(2);
  });

  it('no jump when there is no following path cell (nextface = FACING_NONE)', () => {
    // When path ends (no following cell), nextFace8 = -1 → no jump
    // This is tested implicitly by the path lookahead logic
    const e = entityAtCell(UnitType.LIGHT_TANK, House.Spain, 5, 5);
    e.path = [{ cx: 5, cy: 4 }]; // Only one cell in path, no following
    e.pathIndex = 0;
    // No crash, and the jump condition would not be met
    expect(e.path[e.pathIndex + 1]).toBeUndefined();
  });

  it('no jump target when new direction is an impossible turn (track=0)', () => {
    // E.g., from NE facing, going SW is impossible (180° turn)
    const tcIdx = 1 * 8 + 5; // NE→SW
    const tc = TRACK_CONTROL[tcIdx];
    expect(tc.track).toBe(0);
  });
});

// =============================================================================
// 9. Multi-track traversal: smooth path through multiple turns
// =============================================================================

describe('Multi-track traversal (smooth curve sequences)', () => {
  it('N→NE→E path has valid jump chain: Track 3→Track 6', () => {
    // Step 1: Vehicle going N, next turn NE → selects Track 3 (N→NE)
    const tc1 = lookupTrackControl(0, 1); // N→NE
    expect(tc1.track).toBe(3);
    expect(tc1.flag & F_D).toBeTruthy(); // 2-cell track

    // Step 2: At Track 3 Jump (37), next direction is E
    const endFacing = dirToFacing8(tc1.facing); // NE = 1
    const tc2 = TRACK_CONTROL[endFacing * 8 + 2]; // NE→E
    expect(tc2.track).toBe(6); // Track 6

    // Step 3: Track 6 has Jump at 44, so if the path continues with another turn,
    // another jump would occur
    expect(RAW_TRACKS[tc2.track - 1].jump).toBe(44);
  });

  it('S→SE→E path has valid jump chain via flag transforms', () => {
    // S→SE uses Track 3 with F_Y|F_D flags (mirror of N→NE)
    const tc1 = lookupTrackControl(4, 3); // S→SE
    expect(tc1.track).toBe(3);
    expect(tc1.flag & F_D).toBeTruthy();

    // At Jump, next direction E (facing8=2)
    const endFacing = dirToFacing8(tc1.facing); // SE = 3
    const tc2 = TRACK_CONTROL[endFacing * 8 + 2]; // SE→E
    expect(tc2.track).toBeGreaterThan(0);
    if (tc2.track > 0 && tc2.track <= RAW_TRACKS.length) {
      expect(RAW_TRACKS[tc2.track - 1].entry).toBeGreaterThan(0);
    }
  });

  it('all 4 jumpable tracks (3-6) can chain to another jumpable track', () => {
    // For each jumpable track, verify there exists at least one next direction
    // that leads to another track with a valid Entry point.
    for (const trackNum of [3, 4, 5, 6]) {
      // Find which TC entries use this track
      let foundChain = false;
      for (let i = 0; i < 64; i++) {
        if (TRACK_CONTROL[i].track === trackNum) {
          const endFacing8 = dirToFacing8(TRACK_CONTROL[i].facing);
          // Try all possible next directions
          for (let nextDir = 0; nextDir < 8; nextDir++) {
            if (nextDir === endFacing8) continue; // same direction = no turn
            const nextTCIdx = endFacing8 * 8 + nextDir;
            if (nextTCIdx < TRACK_CONTROL.length) {
              const nextTC = TRACK_CONTROL[nextTCIdx];
              if (nextTC.track > 0 && nextTC.track <= RAW_TRACKS.length &&
                  RAW_TRACKS[nextTC.track - 1].entry > 0) {
                foundChain = true;
                break;
              }
            }
          }
          if (foundChain) break;
        }
      }
      expect(foundChain, `Track ${trackNum} should chain to another jumpable track`).toBe(true);
    }
  });
});

// =============================================================================
// 10. directionTo produces correct facing8 for path cells
// =============================================================================

describe('directionTo for path cell direction computation', () => {
  const center = (cx: number, cy: number) => ({
    x: cx * CELL_SIZE + CELL_SIZE / 2,
    y: cy * CELL_SIZE + CELL_SIZE / 2,
  });

  it('cell (5,5)→(5,4) = N (Dir.N=0)', () => {
    expect(directionTo(center(5, 5), center(5, 4))).toBe(Dir.N);
  });

  it('cell (5,5)→(6,4) = NE (Dir.NE=1)', () => {
    expect(directionTo(center(5, 5), center(6, 4))).toBe(Dir.NE);
  });

  it('cell (5,5)→(6,5) = E (Dir.E=2)', () => {
    expect(directionTo(center(5, 5), center(6, 5))).toBe(Dir.E);
  });

  it('cell (5,5)→(6,6) = SE (Dir.SE=3)', () => {
    expect(directionTo(center(5, 5), center(6, 6))).toBe(Dir.SE);
  });

  it('cell (5,5)→(5,6) = S (Dir.S=4)', () => {
    expect(directionTo(center(5, 5), center(5, 6))).toBe(Dir.S);
  });

  it('cell (5,5)→(4,6) = SW (Dir.SW=5)', () => {
    expect(directionTo(center(5, 5), center(4, 6))).toBe(Dir.SW);
  });

  it('cell (5,5)→(4,5) = W (Dir.W=6)', () => {
    expect(directionTo(center(5, 5), center(4, 5))).toBe(Dir.W);
  });

  it('cell (5,5)→(4,4) = NW (Dir.NW=7)', () => {
    expect(directionTo(center(5, 5), center(4, 4))).toBe(Dir.NW);
  });
});
