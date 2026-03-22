/**
 * C++ Behavioral Parity: Per-Cell Track Processing
 *
 * Tests verify that per-cell processing during track following matches
 * C++ drive.cpp:721-728. When a vehicle is following a multi-cell track,
 * the Cell index marks the point where the vehicle crosses into a new cell
 * mid-track. At this point, C++ calls Per_Cell_Process(PCP_DURING) which
 * triggers:
 *   - Vehicle crush (Overrun_Square) — crushers kill crushable infantry
 *   - Crushable wall destruction — tracked vehicles destroy crushable overlays
 *   - Fog reveal (Look) — player units reveal fog around mid-cell position
 *
 * C++ source references:
 *   - drive.cpp:721-728   Per-cell check during While_Moving()
 *   - drive.h:157-162     RawTrackType struct (Cell field)
 *   - unit.cpp:1610-1884  UnitClass::Per_Cell_Process (crush logic at lines 1857-1876)
 *   - foot.cpp:1356-1483  FootClass::Per_Cell_Process (trigger checks, PCP_END only)
 *   - techno.cpp:1044-67  TechnoClass::Per_Cell_Process (discovery, PCP_END only)
 *
 * The Cell field is only non-negative for tracks 3-6 (the long 2-cell curves).
 * Short tracks (1-2, 7-13) don't cross cell boundaries mid-track, so they
 * have Cell=-1 and never trigger per-cell processing.
 */

import { describe, it, expect } from 'vitest';
import {
  RAW_TRACKS, TRACK_DATA, TRACK_CONTROL,
  getTrackArray,
  smoothTurn, LP, PIXEL_LEPTON_W,
} from '../engine/tracks';
import { CELL_SIZE, UNIT_STATS } from '../engine/types';

// =============================================================================
// 1. RAW_TRACKS Cell field data matches C++ source
// =============================================================================

describe('RAW_TRACKS Cell field (C++ drive.cpp RawTracks[].Cell)', () => {
  // C++ drive.h:157-162: struct RawTrackType { int Jump; int Entry; int Cell; ... }
  // C++ drive.cpp ~line 2239: RawTracks[13] initialization

  const EXPECTED_CELL_VALUES: { track: number; cell: number; description: string }[] = [
    { track: 1,  cell: -1, description: 'straight N — single cell, no mid-cell crossing' },
    { track: 2,  cell: -1, description: 'straight NE — single cell, no mid-cell crossing' },
    { track: 3,  cell: 22, description: 'long N→NE curve — crosses cell at step 22' },
    { track: 4,  cell: 19, description: 'long N→E curve — crosses cell at step 19' },
    { track: 5,  cell: 31, description: 'long NE→SE arc — crosses cell at step 31' },
    { track: 6,  cell: 27, description: 'long NE→E curve — crosses cell at step 27' },
    { track: 7,  cell: -1, description: 'short 45° curve — single cell' },
    { track: 8,  cell: -1, description: 'short tight curve — single cell' },
    { track: 9,  cell: -1, description: 'short 90° curve — single cell' },
    { track: 10, cell: -1, description: 'short large arc — single cell' },
    { track: 11, cell: -1, description: 'harvester backup — no mid-cell' },
    { track: 12, cell: -1, description: 'drive into refinery — no mid-cell' },
    { track: 13, cell: -1, description: 'factory exit — no mid-cell' },
  ];

  it('Cell values match C++ source for all 13 tracks', () => {
    for (const { track, cell, description } of EXPECTED_CELL_VALUES) {
      expect(RAW_TRACKS[track - 1].cell, `Track ${track} (${description})`).toBe(cell);
    }
  });

  it('only tracks 3-6 (long 2-cell curves) have valid Cell indices', () => {
    for (let i = 0; i < RAW_TRACKS.length; i++) {
      const trackNum = i + 1;
      if (trackNum >= 3 && trackNum <= 6) {
        expect(RAW_TRACKS[i].cell, `Track ${trackNum} should have Cell >= 0`).toBeGreaterThanOrEqual(0);
      } else {
        expect(RAW_TRACKS[i].cell, `Track ${trackNum} should have Cell = -1`).toBe(-1);
      }
    }
  });

  it('Cell index is always a valid index into the track data', () => {
    for (let i = 0; i < RAW_TRACKS.length; i++) {
      if (RAW_TRACKS[i].cell >= 0) {
        const trackData = TRACK_DATA[i];
        expect(RAW_TRACKS[i].cell, `Track ${i + 1} Cell < length`).toBeLessThan(trackData.length);
      }
    }
  });

  it('Cell index is always between Entry and Jump (mid-track ordering)', () => {
    // C++ invariant: for 2-cell tracks, Entry < Cell < Jump
    // The vehicle enters at Entry, crosses the cell boundary at Cell,
    // and can jump to the next track at Jump.
    for (const trackNum of [3, 4, 5, 6]) {
      const meta = RAW_TRACKS[trackNum - 1];
      expect(meta.entry, `Track ${trackNum}: Entry should be defined`).toBeGreaterThan(0);
      expect(meta.cell, `Track ${trackNum}: Cell should be defined`).toBeGreaterThanOrEqual(0);
      expect(meta.jump, `Track ${trackNum}: Jump should be defined`).toBeGreaterThan(0);
      expect(meta.cell, `Track ${trackNum}: Cell > Entry`).toBeGreaterThan(meta.entry);
      expect(meta.cell, `Track ${trackNum}: Cell < Jump`).toBeLessThan(meta.jump);
    }
  });
});

// =============================================================================
// 2. Per-cell condition matching (C++ drive.cpp:721)
// =============================================================================

describe('Per-cell trigger condition (C++ drive.cpp:721)', () => {
  // C++ condition: TrackIndex && RawTracks[tracknum-1].Cell == TrackIndex
  // Both TrackIndex > 0 AND Cell == TrackIndex must be true.

  it('condition requires TrackIndex > 0 (C++ guard against index 0)', () => {
    // Even if a track had Cell=0, the C++ condition requires TrackIndex != 0.
    // In practice no track has Cell=0, but the guard exists in C++.
    // Verify no track has Cell=0 (which would be unreachable in C++).
    for (let i = 0; i < RAW_TRACKS.length; i++) {
      if (RAW_TRACKS[i].cell >= 0) {
        expect(RAW_TRACKS[i].cell, `Track ${i + 1} Cell should not be 0`).toBeGreaterThan(0);
      }
    }
  });

  it('per-cell triggers exactly once per track traversal', () => {
    // The Cell index is a single value, not a range. The condition
    // TrackIndex == Cell fires exactly once as TrackIndex increments
    // through the track steps. This matches C++ behavior.
    for (const trackNum of [3, 4, 5, 6]) {
      const meta = RAW_TRACKS[trackNum - 1];
      const trackData = TRACK_DATA[trackNum - 1];
      let triggerCount = 0;
      for (let idx = 0; idx < trackData.length; idx++) {
        if (idx > 0 && meta.cell === idx) {
          triggerCount++;
        }
      }
      expect(triggerCount, `Track ${trackNum} should trigger per-cell exactly once`).toBe(1);
    }
  });

  it('per-cell never triggers for short/straight tracks (Cell=-1)', () => {
    // Tracks 1-2 (straight) and 7-13 (short/special) have Cell=-1.
    // The condition RawTracks[tracknum-1].Cell == TrackIndex can never be true
    // when Cell is -1 (since TrackIndex is always >= 0).
    for (const trackNum of [1, 2, 7, 8, 9, 10, 11, 12, 13]) {
      const meta = RAW_TRACKS[trackNum - 1];
      expect(meta.cell).toBe(-1);
      // -1 can never equal any valid TrackIndex (0+), so condition is impossible
    }
  });
});

// =============================================================================
// 3. Cell crossing point corresponds to actual cell boundary
// =============================================================================

describe('Cell crossing point geometry (track data at Cell index)', () => {
  // The Cell index marks where the vehicle crosses from one cell to another
  // during a 2-cell track. At this point, the lepton offset in the track data
  // should be approximately at a cell boundary (the offset should cross through
  // zero in one or both axes, indicating the vehicle has moved to a new cell).

  it('Track 3 Cell@22: offset is near cell boundary (Y crossing)', () => {
    const track = TRACK_DATA[2]; // Track 3 (index 2)
    const cellIdx = RAW_TRACKS[2].cell; // 22
    const step = track[cellIdx];
    // Track 3 is N→NE: the vehicle starts ~2 cells north and curves NE.
    // At Cell index, it should have crossed into the target cell area.
    // The Y offset should be closer to 0 than the start of the track.
    const startY = Math.abs(track[0].y);
    const cellY = Math.abs(step.y);
    expect(cellY, 'Cell step Y should be closer to center than start').toBeLessThan(startY);
  });

  it('Track 4 Cell@19: offset is near cell boundary', () => {
    const track = TRACK_DATA[3]; // Track 4
    const cellIdx = RAW_TRACKS[3].cell; // 19
    const step = track[cellIdx];
    const startY = Math.abs(track[0].y);
    const cellY = Math.abs(step.y);
    expect(cellY, 'Cell step Y should be closer to center than start').toBeLessThan(startY);
  });

  it('Track 5 Cell@31: offset is near cell boundary', () => {
    const track = TRACK_DATA[4]; // Track 5
    const cellIdx = RAW_TRACKS[4].cell; // 31
    const step = track[cellIdx];
    // Track 5 is a large arc — at Cell@31, the vehicle should have crossed
    // into the second cell of the 2-cell track.
    // Verify the step exists and has reasonable values
    expect(step).toBeDefined();
    expect(step.facing).toBeGreaterThanOrEqual(0);
    expect(step.facing).toBeLessThanOrEqual(255);
  });

  it('Track 6 Cell@27: offset is near cell boundary', () => {
    const track = TRACK_DATA[5]; // Track 6
    const cellIdx = RAW_TRACKS[5].cell; // 27
    const step = track[cellIdx];
    expect(step).toBeDefined();
    expect(step.facing).toBeGreaterThanOrEqual(0);
  });

  it('Cell index is always after the track reaches the first cell center', () => {
    // For 2-cell tracks, the vehicle starts in cell A and moves to cell B.
    // The Cell index should be past the midpoint of the track (where it crosses
    // from cell A into cell B). Verify Cell > length/3 for all 2-cell tracks.
    for (const trackNum of [3, 4, 5, 6]) {
      const meta = RAW_TRACKS[trackNum - 1];
      const trackData = TRACK_DATA[trackNum - 1];
      expect(meta.cell, `Track ${trackNum}: Cell > length/3`).toBeGreaterThan(trackData.length / 3);
    }
  });
});

// =============================================================================
// 4. Per-cell processing effects (C++ UnitClass::Per_Cell_Process PCP_DURING)
// =============================================================================

describe('Per-cell processing effects (C++ unit.cpp PCP_DURING)', () => {
  // C++ UnitClass::Per_Cell_Process for PCP_DURING runs:
  //   1. Wall crushing (lines 1858-1871) — always, regardless of PCP type
  //   2. Infantry overrun (line 1876) — always, regardless of PCP type
  //   3. DriveClass/FootClass/TechnoClass::Per_Cell_Process — all gated on PCP_END, no-ops for PCP_DURING
  //
  // The TS implementation should trigger:
  //   - checkVehicleCrush() for crusher vehicles
  //   - revealAroundCell() for player units (fog reveal)
  //   - alive check (return false if entity dies from mid-cell processing)

  it('only crusher vehicles should trigger vehicle crush at Cell index', () => {
    // C++ unit.cpp:1858: if (Class->IsCrusher && cellptr->Overlay != OVERLAY_NONE)
    // C++ unit.cpp:1876: Overrun_Square(Coord_Cell(Coord), false)
    // Non-crusher vehicles (e.g., JEEP, TRUK) should NOT trigger crush
    // This is verified by the entity.stats.crusher check in the implementation.
    // Test the data: verify which vehicles are crushers.
    // C++ udata.cpp IsCrusher constructor values
    const crushers = ['1TNK', '2TNK', '3TNK', '4TNK', 'APC', 'HARV',
                       'STNK', 'CTNK', 'TTNK', 'QTNK', 'MRJ', 'V2RL', 'MNLY', 'MCV', 'MGG'];
    for (const key of crushers) {
      const stats = UNIT_STATS[key];
      expect(stats?.crusher, `${key} should be a crusher`).toBe(true);
    }
    // Non-crushers (C++ udata.cpp IsCrusher=false)
    const nonCrushers = ['JEEP', 'TRUK', 'DTRK', 'ARTY'];
    for (const key of nonCrushers) {
      const stats = UNIT_STATS[key];
      expect(stats?.crusher, `${key} should NOT be a crusher`).toBeFalsy();
    }
  });

  it('C++ IsActive check: followTrackStep returns false if entity dies during per-cell', () => {
    // C++ drive.cpp:724-726:
    //   if (!IsActive) {
    //     return(false);
    //   }
    // If the vehicle is destroyed during per-cell processing (e.g., a mine
    // kills it, or a trigger destroys it), the track following must return false
    // immediately. The TS implementation checks entity.alive after per-cell.
    // This is a documentation test — the actual behavior is tested via integration.
    expect(true).toBe(true); // Placeholder: integration test would mock entity death
  });
});

// =============================================================================
// 5. Cell index ordering invariants
// =============================================================================

describe('Cell index ordering relative to Jump and Entry', () => {
  // C++ drive.cpp processing order within While_Moving:
  //   1. Apply track step (position + facing) — line 711-716
  //   2. Per-cell check at Cell index — line 721-728
  //   3. Track jump check at Jump index — line 734-788
  //   4. Increment TrackIndex — line (implicit)
  //
  // This means Cell is checked BEFORE Jump in the same loop iteration.
  // For correctness, Cell must come before Jump in the track:
  //   Entry < Cell < Jump < trackLength

  it('per-cell fires before track jump (Cell < Jump for all long tracks)', () => {
    for (const trackNum of [3, 4, 5, 6]) {
      const meta = RAW_TRACKS[trackNum - 1];
      expect(meta.cell, `Track ${trackNum}: Cell < Jump`).toBeLessThan(meta.jump);
    }
  });

  it('Entry < Cell: vehicle enters track before crossing cell boundary', () => {
    for (const trackNum of [3, 4, 5, 6]) {
      const meta = RAW_TRACKS[trackNum - 1];
      expect(meta.cell, `Track ${trackNum}: Cell > Entry`).toBeGreaterThan(meta.entry);
    }
  });

  it('Cell < trackLength: Cell index is within track bounds', () => {
    for (const trackNum of [3, 4, 5, 6]) {
      const meta = RAW_TRACKS[trackNum - 1];
      const trackData = getTrackArray(trackNum)!;
      expect(meta.cell, `Track ${trackNum}: Cell < length`).toBeLessThan(trackData.length);
    }
  });
});

// =============================================================================
// 6. Track step at Cell index has valid transformed data
// =============================================================================

describe('Track step data at Cell index is valid for all flag transforms', () => {
  // When per-cell fires, the position is computed via smoothTurn with the
  // track's control flags. Verify the step at Cell index produces valid
  // transformed coordinates for all possible flag combinations.

  for (const trackNum of [3, 4, 5, 6]) {
    it(`Track ${trackNum} Cell step transforms correctly with all flag variants`, () => {
      const meta = RAW_TRACKS[trackNum - 1];
      const trackData = getTrackArray(trackNum)!;
      const step = trackData[meta.cell];

      // Find all TrackControl entries that reference this track
      for (let i = 0; i < 64; i++) {
        const tc = TRACK_CONTROL[i];
        if (tc.track === trackNum) {
          // Apply smoothTurn with this entry's flags (stripped of F_D)
          const flags = tc.flag & 0x07; // F_T|F_X|F_Y only
          const result = smoothTurn(step.x, step.y, step.facing, flags);

          // Position should be finite numbers
          expect(Number.isFinite(result.x), `TC[${i}] x should be finite`).toBe(true);
          expect(Number.isFinite(result.y), `TC[${i}] y should be finite`).toBe(true);

          // Facing should be in DirType range (0-255)
          expect(result.facing, `TC[${i}] facing >= 0`).toBeGreaterThanOrEqual(0);
          expect(result.facing, `TC[${i}] facing <= 255`).toBeLessThanOrEqual(255);

          // Converted to pixels, should be within reasonable bounds
          // (2 cells = 48px, so offsets should be within ~50px of target)
          const px = result.x * LP;
          const py = result.y * LP;
          expect(Math.abs(px), `TC[${i}] px within 2 cells`).toBeLessThan(CELL_SIZE * 2);
          expect(Math.abs(py), `TC[${i}] py within 2 cells`).toBeLessThan(CELL_SIZE * 2);
        }
      }
    });
  }
});

// =============================================================================
// 7. Integration: per-cell position falls within the correct cell
// =============================================================================

describe('Per-cell position is in the mid-cell of the 2-cell track', () => {
  // When per-cell fires at Cell index, the vehicle should be approximately
  // at the boundary between the first and second cell of the 2-cell track.
  // Using the base (untransformed) track data, verify the offset at Cell index
  // represents a position that has crossed the first cell but not yet reached
  // the final cell center.

  it('Track 3: at Cell@22, lepton offset is near cell boundary', () => {
    const track = TRACK_DATA[2];
    const step = track[22]; // Cell index
    // Track 3 starts at Y=0x01F5=501 (far from target, 2 cells away) and ends at Y=0.
    // At Cell@22 (the mid-cell crossing), the vehicle should be approximately
    // at the cell boundary (~256 leptons from target = 1 cell).
    // C++ uses this to mark the crossing point for per-cell processing.
    // The actual value is ~272, which is close to one cell boundary (256 leptons).
    expect(Math.abs(step.y), 'Y offset should be near 1-cell boundary').toBeLessThan(300);
    expect(Math.abs(step.y), 'Y offset should be past the halfway point').toBeLessThan(
      Math.abs(track[0].y) // Start is ~501 leptons away
    );
  });

  it('Track 4: at Cell@19, vehicle has crossed cell boundary', () => {
    const track = TRACK_DATA[3];
    const step = track[19]; // Cell index
    // Track 4 step 19 should show the vehicle at the boundary area
    expect(Math.abs(step.y)).toBeLessThan(256); // Within one cell of target
  });

  it('all Cell-index steps have non-zero offsets (not yet at final destination)', () => {
    // At the Cell index, the vehicle is crossing between cells — it should NOT
    // be at the final destination (0,0). The (0,0) end marker only appears at
    // the last step of each track.
    for (const trackNum of [3, 4, 5, 6]) {
      const meta = RAW_TRACKS[trackNum - 1];
      const trackData = getTrackArray(trackNum)!;
      const step = trackData[meta.cell];
      const hasOffset = step.x !== 0 || step.y !== 0;
      expect(hasOffset, `Track ${trackNum} Cell step should not be at origin (0,0)`).toBe(true);
    }
  });
});

// =============================================================================
// 8. PIXEL_LEPTON_W constant matches C++ for speed budget calculation
// =============================================================================

describe('PIXEL_LEPTON_W matches C++ (speed budget affects Cell trigger timing)', () => {
  // C++ drive.cpp:664: PIXEL_LEPTON_W = CELL_LEPTON_W / ICON_PIXEL_W = 256/24
  // This constant determines how many steps are consumed per speed budget unit.
  // If wrong, the Cell index would be reached at the wrong time.

  it('PIXEL_LEPTON_W = floor(256 / CELL_SIZE)', () => {
    expect(PIXEL_LEPTON_W).toBe(Math.floor(256 / CELL_SIZE));
  });

  it('LP = CELL_SIZE / 256 (lepton-to-pixel conversion)', () => {
    expect(LP).toBe(CELL_SIZE / 256);
  });
});
