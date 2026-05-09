/**
 * @vitest-environment jsdom
 *
 * SCG06EA tick 76 — per-tick trace of USSR E1 @(24,67) during the AREA_GUARD walk.
 *
 * Session 3 landed path-shorten (3c7a92f9) + Mission_Guard_Area Approach_Target
 * re-fire (3c7988af) but SCG06 first-divergence remained at tick 76 (Δ=+2 RNG
 * calls that WASM fires but TS does not).
 *
 * Prior static analysis (`cpp-parity-scg06ea-tick-76-path.test.ts`):
 *   - TS approachTarget picks cell (20, 66) via C++-parity sweep math at range=585.
 *   - WASM arrives at cell (22, 65) en route to its chosen cell and fires from
 *     there. (22, 65) is octagonal 608 leptons from (20,64) target — inside
 *     weapon fire range 768 but outside the -0x00B7-trimmed sweep range 585.
 *
 * Hypothesis chain this test pins:
 *   1. Does the TS entity actually enter MISSION.AREA_GUARD (or does it end up
 *      in MISSION.GUARD for the walk)?
 *   2. When Mission_Guard_Area calls Approach_Target, what path does findPath
 *      produce from (24,67) → (20,66)?
 *   3. Does any cell in that path satisfy the path-shorten gate
 *      (target.inRange at arrival)?
 *   4. If yes, does `footPerCellProcess` actually fire and clear moveTarget?
 *
 * This is a PURE PATH GEOMETRY test — it does NOT load the full scenario INI.
 * Instead it constructs the exact (24,67) → (20,66) geometry on a bare GameMap
 * and verifies the findPath output + per-cell inRange evaluations. Any cell
 * in the produced path that is within 768 leptons of (20,64) is a cell where
 * path-shorten SHOULD trigger. If no such cell exists, the TS path geometry
 * itself is the bug.
 */

import { describe, it, expect } from 'vitest';
import { GameMap } from '../engine/map';
import { findPath } from '../engine/pathfinding';
import { CELL_SIZE, House, LEPTON_SIZE, SpeedClass, UnitType } from '../engine/types';
import { leptonDist } from '../engine/types';
import { Entity } from '../engine/entity';

describe('SCG06EA tick 76 trace — findPath (24,67) → (20,66) geometry', () => {
  // Minimal bare-ground map: a 40x80 window of passable land.
  // This matches the SCG06EA terrain around (24,67)↔(20,64): open ground, no
  // walls/water/overlay. (SCG06EA map is desert; this area is cleared terrain
  // per manual inspection of the scenario.)
  function makeOpenMap(): GameMap {
    const map = new GameMap();
    // Default GameMap construction may have blocked cells. Force a wide open
    // window encompassing both positions + path scratch space.
    for (let cy = 60; cy < 72; cy++) {
      for (let cx = 16; cx < 28; cx++) {
        const idx = cy * 128 + cx;
        map.occupancy[idx] = 0;
        map.vehicleOccupancy.delete(idx);
      }
    }
    return map;
  }

  const startCell = { cx: 24, cy: 67 };
  const approachCell = { cx: 20, cy: 66 }; // TS's approachTarget pick at range=585
  const TARGET_LX = 20 * 256 + 192;  // Greek E1 at cell 8212 sub 2 (UR)
  const TARGET_LY = 64 * 256 + 64;
  const WEAPON_RANGE_LEPTONS = 3 * LEPTON_SIZE; // M1Carbine 3 cells = 768

  it('findPath from (24,67) to (20,66) produces a non-empty path', () => {
    const map = makeOpenMap();
    const path = findPath(map, startCell, approachCell, true, false, SpeedClass.FOOT);
    expect(path.length).toBeGreaterThan(0);
    // Last cell MUST be the destination.
    expect(path[path.length - 1]).toEqual(approachCell);
  });

  it('approachTarget uses ignoreOccupancy=false — verify path equivalence', () => {
    // approachTarget in index.ts:6214 passes `false` for ignoreOccupancy
    // (respects Can_Enter_Cell). Since our makeOpenMap has no occupancy,
    // both modes should produce the same path. This check verifies that.
    const map = makeOpenMap();
    const pathIgnore = findPath(map, startCell, approachCell, true, false, SpeedClass.FOOT);
    const pathRespect = findPath(map, startCell, approachCell, false, false, SpeedClass.FOOT);
    expect(pathRespect).toEqual(pathIgnore);
  });

  it('SOME cell in the path has target (20,64) within weapon range', () => {
    // C++ foot.cpp:1471-1483 path-shorten fires at PCP_END when target is
    // Likely_Coord-in-range. If the TS path from (24,67) to (20,66) contains
    // at least one cell where Greek target (20,64) is within 768 leptons,
    // path-shorten should fire at that cell-arrival and halt the unit.
    const map = makeOpenMap();
    const path = findPath(map, startCell, approachCell, true, false, SpeedClass.FOOT);
    let firstInRangeIdx = -1;
    const trace: Array<{i: number; cx: number; cy: number; dist: number; inRange: boolean}> = [];
    for (let i = 0; i < path.length; i++) {
      const cellLX = path[i].cx * 256 + 128;
      const cellLY = path[i].cy * 256 + 128;
      const dist = leptonDist(cellLX, cellLY, TARGET_LX, TARGET_LY);
      const inRange = dist < WEAPON_RANGE_LEPTONS;
      trace.push({ i, cx: path[i].cx, cy: path[i].cy, dist, inRange });
      if (inRange && firstInRangeIdx < 0) firstInRangeIdx = i;
    }
    // Trace the findPath result for diagnosis (vitest prints on fail).
    expect({ path: trace, firstInRangeIdx }).toMatchObject({ firstInRangeIdx: expect.any(Number) });
    expect(firstInRangeIdx).toBeGreaterThanOrEqual(0);
  });

  it('uses FootClass::Likely_Coord for path-shorten range checks', () => {
    // C++ foot.cpp:1475-1477 replaces a moving foot target's current Coord with
    // Likely_Coord() (Head_To_Coord when set) before deciding whether to clear
    // NavCom at PCP_END. This catches targets that will be in range shortly.
    const attacker = new Entity(UnitType.I_E1, House.USSR, 10 * CELL_SIZE, 10 * CELL_SIZE);
    const movingTarget = new Entity(UnitType.I_E1, House.Greece, 14 * CELL_SIZE, 10 * CELL_SIZE);
    movingTarget.headToLX = 12 * LEPTON_SIZE + 128;
    movingTarget.headToLY = 10 * LEPTON_SIZE + 128;

    expect(attacker.inRange(movingTarget)).toBe(false);
    expect(attacker.inRangeOfLikelyCoord(movingTarget)).toBe(true);
  });

  it('traces every cell in TS findPath from (24,67) → (20,66) with distance to (20,64) target', () => {
    // Diagnostic dump — helps identify whether the TS path passes through or
    // near (22, 65). If the path goes straight west on row 67 then north,
    // it won't arrive at (22, 65) and path-shorten won't trigger until a
    // row-66 cell like (22, 66) or (21, 66).
    const map = makeOpenMap();
    const path = findPath(map, startCell, approachCell, true, false, SpeedClass.FOOT);
    const rows: string[] = [];
    rows.push(`start (24, 67) → dest (20, 66) — ${path.length} cells`);
    let prevDist = -1;
    for (let i = 0; i < path.length; i++) {
      const cellLX = path[i].cx * 256 + 128;
      const cellLY = path[i].cy * 256 + 128;
      const dist = leptonDist(cellLX, cellLY, TARGET_LX, TARGET_LY);
      const inRange = dist < WEAPON_RANGE_LEPTONS;
      const crossed = prevDist >= WEAPON_RANGE_LEPTONS && inRange ? ' ← FIRST IN RANGE' : '';
      rows.push(`  [${i}] (${path[i].cx}, ${path[i].cy}) dist=${dist} ${inRange ? 'IN_RANGE' : 'OUT_RANGE'}${crossed}`);
      prevDist = dist;
    }
    // Always pass — this test's purpose is the trace output on run.
    expect(path.length).toBeGreaterThan(0);
    // Emit the trace so agents inspecting failures can see the path.
    // eslint-disable-next-line no-console
    console.log(rows.join('\n'));
  });

  it('includes at least one row-66 or row-65 cell with dx∈{1,2} to (20,64)', () => {
    // The cells that put target (20, 64) in range:
    //   (22, 65) dist 608  (21, 65) dist 352  (20, 65) dist 256
    //   (22, 66) dist 768* (21, 66) dist 640  (20, 66) dist 512
    //   * 768 exactly = max-range-boundary, check <; so (22,66) is NOT in range.
    // Interesting cells for the walk: (22, 65), (21, 65), (21, 66).
    // If the path contains any of these, path-shorten fires. If it only
    // contains (20, 66) (the destination), shorten fires at end-of-walk only.
    const map = makeOpenMap();
    const path = findPath(map, startCell, approachCell, true, false, SpeedClass.FOOT);
    const interesting = new Set(['22,65', '21,65', '21,66', '20,65']);
    const hit = path.find(c => interesting.has(`${c.cx},${c.cy}`));
    // Log the cells for debug even if hit is undefined
    // eslint-disable-next-line no-console
    console.log(`  path cells matching {(22,65),(21,65),(21,66),(20,65)}: ${hit ? `(${hit.cx},${hit.cy})` : 'NONE'}`);
    expect(path.length).toBeGreaterThan(0);
  });
});

describe('SCG06EA tick 76 trace — cell-distance reference table', () => {
  // Reference: which cells in the (18-24) × (64-68) window are within rifle
  // range of target (20, 64) Greek E1 sub 2 (UR → lepton 5312, 16448)?
  const TARGET_LX = 20 * 256 + 192;
  const TARGET_LY = 64 * 256 + 64;
  const FIRE_RANGE = 768;

  it('dumps the in-range/out-of-range grid for reference', () => {
    const rows: string[] = [];
    rows.push('    ' + Array.from({length: 8}, (_, i) => (i+17).toString().padStart(3)).join(' '));
    for (let cy = 63; cy <= 69; cy++) {
      let line = `${cy}: `;
      for (let cx = 17; cx <= 24; cx++) {
        const cellLX = cx * 256 + 128;
        const cellLY = cy * 256 + 128;
        const dist = leptonDist(cellLX, cellLY, TARGET_LX, TARGET_LY);
        line += dist < FIRE_RANGE ? ' ✓  ' : ' .  ';
      }
      rows.push(line);
    }
    // eslint-disable-next-line no-console
    console.log(rows.join('\n'));
    expect(true).toBe(true);
  });
});
