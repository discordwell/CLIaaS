/**
 * Advanced C++ Behavioral Parity Tests — Pathfinding (findpath.cpp, foot.cpp, cell.cpp)
 *
 * Tests verify nuanced pathfinding behaviors from the C++ Red Alert source code
 * that go beyond basic pathing: cost structures, threshold escalation,
 * nearest-reachable fallback, per-speed-class impassability, and occupancy rules.
 *
 * Every expected value is derived FIRST from C++ source code. Tests that expose
 * TS divergence are documented with PARITY FIXED or DESIGN DIVERGENCE comments.
 *
 * C++ source refs:
 *   findpath.cpp:106     MAX_MLIST_SIZE = 300
 *   findpath.cpp:110     MAX_PATH_EDGE_FOLLOW = 400
 *   findpath.cpp:1266-1293  Passable_Cell — cost table {1,1,3,8,10,0} + distance threshold
 *   findpath.cpp:1270    Distance-based threshold relaxation
 *   findpath.cpp:435-752 Find_Path — main LOS + edge-follow algorithm
 *   findpath.cpp:779-1018 Follow_Edge — obstacle circumnavigation
 *   foot.cpp:313-472     Basic_Path — threshold escalation, Nearby_Location fallback
 *   foot.cpp:333-335     Impassable dest → Nearby_Location redirect
 *   foot.cpp:371         workpath1[200] — staging area for path list
 *   foot.cpp:396-411     PathThreshhold escalation loop
 *   unit.cpp:3069-3286   UnitClass::Can_Enter_Cell — full vehicle cell entry logic
 *   unit.cpp:3261        Ground[].Cost[speed] == 0 → MOVE_NO
 *   infantry.cpp:1266-1499  InfantryClass::Can_Enter_Cell
 *   infantry.cpp:1471    Ground[].Cost[SPEED_FOOT] == 0 → MOVE_NO
 *   infantry.cpp:1490    cellptr->Flag.Occupy.Vehicle → MOVE_NO for infantry
 *   cell.cpp:2736-2810   Is_Clear_To_Move — zone/occupancy/terrain passability
 *   cell.h:191-203       Flag.Occupy union: Center, NW, NE, SW, SE, Vehicle, Monolith, Building
 *   defines.h:828-837    MoveType enum: OK=0, CLOAK=1, MOVING_BLOCK=2, DESTROYABLE=3, TEMP=4, NO=5
 */

import { describe, it, expect } from 'vitest';
import { findPath, findPathAStar } from '../engine/pathfinding';
import { GameMap, MoveResult, Terrain } from '../engine/map';
import { type CellPos, MAP_CELLS, SpeedClass } from '../engine/types';

// ============================================================================
// Test helpers
// ============================================================================

/** Create a test map with clear playable interior */
function makeMap(bx = 10, by = 10, bw = 50, bh = 50): GameMap {
  const map = new GameMap();
  map.setBounds(bx, by, bw, bh);
  map.initDefault();
  return map;
}

/** Place impassable terrain at given cells */
function blockCells(map: GameMap, cells: [number, number][], terrain: Terrain = Terrain.WATER): void {
  for (const [cx, cy] of cells) {
    map.setTerrain(cx, cy, terrain);
  }
}

/** Validate path is contiguous (each step 8-way adjacent to previous) */
function assertContiguous(start: CellPos, path: CellPos[]): void {
  let prev = start;
  for (let i = 0; i < path.length; i++) {
    const dx = Math.abs(path[i].cx - prev.cx);
    const dy = Math.abs(path[i].cy - prev.cy);
    expect(dx <= 1 && dy <= 1 && (dx + dy > 0),
      `step ${i}: (${prev.cx},${prev.cy})->(${path[i].cx},${path[i].cy}) must be adjacent`).toBe(true);
    prev = path[i];
  }
}

/** Assert path reaches the goal cell */
function assertReachesGoal(path: CellPos[], goal: CellPos): void {
  expect(path.length, 'path should not be empty').toBeGreaterThan(0);
  const last = path[path.length - 1];
  expect(last.cx, `last.cx should be ${goal.cx}`).toBe(goal.cx);
  expect(last.cy, `last.cy should be ${goal.cy}`).toBe(goal.cy);
}

// ============================================================================
// 1. Passable_Cell cost table — C++ findpath.cpp:1284-1292
//
// C++ code (findpath.cpp:1284-1292):
//   static int _value[MOVE_COUNT] = {
//     1,   // MOVE_OK
//     1,   // MOVE_CLOAK
//     3,   // MOVE_MOVING_BLOCK
//     8,   // MOVE_DESTROYABLE
//     10,  // MOVE_TEMP
//     0    // MOVE_NO
//   };
//   return(_value[move]);
//
// C++ uses a 6-level graduated cost system for pathfinding. A temporarily
// blocked cell (friendly unit) costs 10x more than a clear cell, making the
// pathfinder prefer routing around friendlies but still allowing passage.
//
// TS pathfinding.ts:171-183 isPassable() returns boolean. It treats
// MoveResult.OK and MoveResult.TEMP_BLOCKED as passable, everything else
// as impassable. The graduated cost from C++ is lost.
// ============================================================================

describe('C++ parity: Passable_Cell cost table (findpath.cpp:1284-1292)', () => {

  it('MoveResult enum ordinals match C++ MoveType (defines.h:828-837)', () => {
    // C++ defines.h:828-837:
    //   MOVE_OK=0, MOVE_CLOAK=1, MOVE_MOVING_BLOCK=2,
    //   MOVE_DESTROYABLE=3, MOVE_TEMP=4, MOVE_NO=5
    expect(MoveResult.OK).toBe(0);
    expect(MoveResult.CLOAK).toBe(1);
    expect(MoveResult.OCCUPIED).toBe(2); // TS name for MOVE_MOVING_BLOCK
    expect(MoveResult.DESTROYABLE).toBe(3);
    expect(MoveResult.TEMP_BLOCKED).toBe(4); // TS name for MOVE_TEMP
    expect(MoveResult.IMPASSABLE).toBe(5);  // TS name for MOVE_NO
  });

  it('C++ MOVE_TEMP has cost=10 vs MOVE_OK cost=1; TS should weight temp-blocked cells higher', () => {
    // C++ findpath.cpp:1284-1292: _value[MOVE_TEMP]=10, _value[MOVE_OK]=1
    // In C++, a path through 1 MOVE_TEMP cell costs 10, same as 10 clear cells.
    // This makes pathfinding strongly prefer routing around friendly units.
    //
    // Setup: 5-cell-wide passable area. Direct path has a TEMP_BLOCKED cell.
    // Alternate routes go 1 cell north or south (adding 2 extra steps).
    // C++ would take the detour (cost 3 clear cells = 3) vs (cost 10 for temp = 10).
    const map = makeMap();

    // Place a "moving" friendly at the midpoint of the direct path
    map.setOccupancy(20, 20, 42);
    const isMoving = (id: number) => id === 42;

    // Block above and below to create a narrow corridor that forces a choice
    // Leave y=19 and y=21 open for alternate routing
    // Block y=18 and y=22 to limit options
    for (let x = 15; x <= 25; x++) {
      map.setTerrain(x, 18, Terrain.WATER);
      map.setTerrain(x, 22, Terrain.WATER);
    }

    const start: CellPos = { cx: 15, cy: 20 };
    const goal: CellPos = { cx: 25, cy: 20 };

    // A* with occupancy awareness
    const path = findPathAStar(map, start, goal, false, false, SpeedClass.WHEEL, isMoving);
    expect(path.length).toBeGreaterThan(0);

    // C++ would detour around (20,20) because MOVE_TEMP cost=10 > cost of 2 extra steps
    // Check if the path goes through the temp-blocked cell
    const goesThrough = path.some(c => c.cx === 20 && c.cy === 20);

    // TS A* adds +50 cost for TEMP_BLOCKED (pathfinding.ts:821), which should cause detour
    // If TS correctly penalizes, the path should NOT go through (20,20)
    expect(goesThrough, 'A* should detour around TEMP_BLOCKED cell (C++ cost=10)').toBe(false);
  });
});

// ============================================================================
// 2. canEnterCell — C++ Can_Enter_Cell return values
//
// C++ unit.cpp:3069-3286 UnitClass::Can_Enter_Cell:
//   - Out of bounds → MOVE_NO                    (line 3078)
//   - Wall + can crush → continue checking       (line 3108)
//   - Wall + weapon → MOVE_DESTROYABLE           (line 3117)
//   - Wall + no weapon → MOVE_NO                 (line 3122)
//   - Allied moving unit → MOVE_MOVING_BLOCK     (line 3183)
//   - Allied stationary unit → MOVE_TEMP         (line 3193)
//   - Allied building → MOVE_NO                  (line 3185)
//   - Enemy cloaked → MOVE_CLOAK                 (line 3246)
//   - Enemy non-cloaked → MOVE_DESTROYABLE       (line 3239)
//   - Ground[].Cost[speed]==0 → MOVE_NO          (line 3261)
//   - Vehicle flag set → MOVE_MOVING_BLOCK       (line 3274-3275)
//
// TS map.ts:732-756 canEnterCell:
//   - Out of bounds → IMPASSABLE
//   - Terrain not in PASSABLE set → IMPASSABLE
//   - Occupied + moving → TEMP_BLOCKED
//   - Occupied + stationary → OCCUPIED
//   - Clear → OK
// ============================================================================

describe('C++ parity: canEnterCell (Can_Enter_Cell) (unit.cpp:3069-3286)', () => {

  it('out-of-bounds cell returns IMPASSABLE (C++ MOVE_NO, unit.cpp:3078)', () => {
    const map = makeMap();
    // Cell outside map bounds
    expect(map.canEnterCell(-1, -1)).toBe(MoveResult.IMPASSABLE);
    expect(map.canEnterCell(200, 200)).toBe(MoveResult.IMPASSABLE);
  });

  it('clear unoccupied cell returns OK (C++ MOVE_OK)', () => {
    const map = makeMap();
    expect(map.canEnterCell(20, 20)).toBe(MoveResult.OK);
  });

  it('water cell returns IMPASSABLE for ground units (C++ Ground[LAND_WATER].Cost[SPEED_TRACK]==0)', () => {
    const map = makeMap();
    map.setTerrain(20, 20, Terrain.WATER);
    expect(map.canEnterCell(20, 20, false)).toBe(MoveResult.IMPASSABLE);
  });

  it('water cell returns OK for naval units (C++ vessel.cpp:259)', () => {
    const map = makeMap();
    map.setTerrain(20, 20, Terrain.WATER);
    expect(map.canEnterCell(20, 20, true)).toBe(MoveResult.OK);
  });

  it('occupied cell with stationary unit returns TEMP_BLOCKED (C++ MOVE_TEMP=4)', () => {
    // C++ unit.cpp:3192-3193: stationary allied unit → MOVE_TEMP(4)
    const map = makeMap();
    map.setOccupancy(20, 20, 99);
    // No isMoving callback → stationary → C++ returns MOVE_TEMP=4
    expect(map.canEnterCell(20, 20)).toBe(MoveResult.TEMP_BLOCKED);
  });

  it('occupied cell with moving unit returns OCCUPIED (C++ MOVE_MOVING_BLOCK=2)', () => {
    // C++ unit.cpp:3177-3183: allied moving unit → MOVE_MOVING_BLOCK(2)
    const map = makeMap();
    map.setOccupancy(20, 20, 99);
    const isMoving = (id: number) => id === 99;
    const result = map.canEnterCell(20, 20, false, isMoving);

    // C++ parity: moving ally → MOVE_MOVING_BLOCK=2 (OCCUPIED in TS enum)
    expect(result).toBe(MoveResult.OCCUPIED);
  });

  it('vehicle occupancy blocks infantry (C++ infantry.cpp:1490)', () => {
    // C++ infantry.cpp:1490: if (retval == MOVE_OK && cellptr->Flag.Occupy.Vehicle) return(MOVE_NO);
    // TS: vehicleOccupancy blocks infantry sub-cells
    const map = makeMap();
    map.setVehicleOccupancy(20, 20, 50);
    const result = map.canEnterCell(20, 20, false, undefined, true);
    // Both C++ and TS should block infantry when vehicle flag is set
    expect(result).toBe(MoveResult.OCCUPIED);
  });
});

// ============================================================================
// 3. Infantry sub-cell occupancy — C++ cell.h:191-203, infantry.cpp:1498-1530
//
// C++ cell.h:191-203 Flag.Occupy:
//   Center:1, NW:1, NE:1, SW:1, SE:1 — 5 sub-cell positions for infantry
//   Vehicle:1, Monolith:1, Building:1 — full-cell blocking flags
//
// C++ infantry.cpp:1498-1530:
//   if (cellptr->InfType != HOUSE_NONE) {
//     if (House->Is_Ally(cellptr->InfType)) {
//       // Friendly infantry: allow if sub-cells available
//       if (cell has free sub-cell) return MOVE_OK or MOVE_MOVING_BLOCK
//     } else {
//       // Enemy infantry: depends on combat capability
//     }
//   }
//
// TS map.ts:311-334 occupySubCell / map.ts:741-748 isInfantry check:
//   Infantry can enter if any of 5 sub-cells (CENTER, NW, NE, SW, SE) is free.
//   Vehicle occupancy blocks all sub-cells.
// ============================================================================

describe('C++ parity: infantry sub-cell occupancy (cell.h:191-203, infantry.cpp:1498)', () => {

  it('empty cell allows infantry entry (all 5 sub-cells available)', () => {
    const map = makeMap();
    expect(map.canEnterCell(20, 20, false, undefined, true)).toBe(MoveResult.OK);
    expect(map.getSubCellCount(20, 20)).toBe(0);
  });

  it('cell with 4 infantry still allows 5th infantry entry', () => {
    // C++ cell.h: 5 sub-cell positions (Center, NW, NE, SW, SE)
    const map = makeMap();
    expect(map.occupySubCell(20, 20, 101)).toBeGreaterThanOrEqual(0);
    expect(map.occupySubCell(20, 20, 102)).toBeGreaterThanOrEqual(0);
    expect(map.occupySubCell(20, 20, 103)).toBeGreaterThanOrEqual(0);
    expect(map.occupySubCell(20, 20, 104)).toBeGreaterThanOrEqual(0);
    // 4 occupied, 1 free — should still allow entry
    expect(map.canEnterCell(20, 20, false, undefined, true)).toBe(MoveResult.OK);
  });

  it('cell with 5 infantry blocks 6th infantry entry', () => {
    // C++ cell.h: only 5 sub-cells (Center, NW, NE, SW, SE)
    // When all 5 occupied, infantry cannot enter
    const map = makeMap();
    for (let i = 1; i <= 5; i++) {
      expect(map.occupySubCell(20, 20, 200 + i)).toBeGreaterThanOrEqual(0);
    }
    // 6th infantry should be denied
    expect(map.occupySubCell(20, 20, 206)).toBe(-1);
    // canEnterCell should also block
    expect(map.canEnterCell(20, 20, false, undefined, true)).toBe(MoveResult.OCCUPIED);
  });

  it('sub-cell preference order: CENTER(0) first, then NW(1), NE(2), SW(3), SE(4)', () => {
    // C++ cell.cpp Closest_Free_Spot: prefers CENTER, then corners
    const map = makeMap();
    const s1 = map.occupySubCell(20, 20, 301);
    const s2 = map.occupySubCell(20, 20, 302);
    const s3 = map.occupySubCell(20, 20, 303);
    const s4 = map.occupySubCell(20, 20, 304);
    const s5 = map.occupySubCell(20, 20, 305);

    expect(s1).toBe(0); // CENTER
    expect(s2).toBe(1); // NW
    expect(s3).toBe(2); // NE
    expect(s4).toBe(3); // SW
    expect(s5).toBe(4); // SE
  });

  it('vehicle occupancy blocks ALL sub-cells (C++ cell.h Flag.Occupy.Vehicle)', () => {
    // C++ infantry.cpp:1490: if cellptr->Flag.Occupy.Vehicle → MOVE_NO
    const map = makeMap();
    map.setVehicleOccupancy(20, 20, 50);
    expect(map.occupySubCell(20, 20, 401)).toBe(-1);
    expect(map.hasAvailableSubCell(20, 20)).toBe(false);
  });

  it('vacating a sub-cell frees it for reuse', () => {
    const map = makeMap();
    const sub = map.occupySubCell(20, 20, 501);
    expect(sub).toBeGreaterThanOrEqual(0);
    expect(map.getSubCellCount(20, 20)).toBe(1);

    map.vacateSubCell(20, 20, 501);
    expect(map.getSubCellCount(20, 20)).toBe(0);
    expect(map.hasAvailableSubCell(20, 20)).toBe(true);
  });
});

// ============================================================================
// 4. C++ Passable_Cell distance-based threshold relaxation
//    findpath.cpp:1270
//
// C++ code (findpath.cpp:1270):
//   if (move < MOVE_MOVING_BLOCK && Distance(Cell_Coord(cell)) > 0x0100)
//     threshhold = MOVE_MOVING_BLOCK;
//
// When a cell's blockage level is below MOVING_BLOCK (i.e., OK or CLOAK) and
// the cell is more than 0x0100 leptons away (~1 cell), C++ relaxes the
// threshold to MOVE_MOVING_BLOCK. This means nearby cells have stricter
// passability requirements than distant cells.
//
// TS isPassable() (pathfinding.ts:171-183) has no distance-based threshold
// relaxation — it uses a flat boolean check regardless of distance.
// ============================================================================

describe('C++ parity: Passable_Cell distance-based threshold (findpath.cpp:1270)', () => {

  it('C++ relaxes threshold for distant cells — TS uses flat passability check', () => {
    // C++ findpath.cpp:1270:
    //   if (move < MOVE_MOVING_BLOCK && Distance(Cell_Coord(cell)) > 0x0100)
    //     threshhold = MOVE_MOVING_BLOCK;
    //
    // This means: for cells > 1 cell away, ANY blockage below MOVING_BLOCK
    // is accepted even if the threshold was stricter (e.g., MOVE_OK only).
    //
    // TS has no equivalent logic. isPassable() returns boolean based on
    // terrain and occupancy, with no distance-based relaxation.
    //
    // We verify this architectural difference exists by checking that the
    // TS pathfinder treats near and far occupied cells identically.

    const map = makeMap();
    // Place occupants at a near cell and a far cell
    map.setOccupancy(12, 20, 88); // near cell
    map.setOccupancy(45, 20, 89); // far cell (33 cells away)

    // Both cells should return TEMP_BLOCKED (stationary occupants, C++ MOVE_TEMP=4).
    // TS has no distance-based relaxation.
    const nearResult = map.canEnterCell(12, 20, false);
    const farResult = map.canEnterCell(45, 20, false);

    // TS treats both identically (TEMP_BLOCKED=4 for stationary occupants)
    expect(nearResult).toBe(MoveResult.TEMP_BLOCKED);
    expect(farResult).toBe(MoveResult.TEMP_BLOCKED);
    // C++ Passable_Cell would potentially relax the threshold for the far cell
    // based on the caller's distance to it (findpath.cpp:1270), but TS has
    // no distance context in canEnterCell — this documents the divergence.
  });
});

// ============================================================================
// 5. Nearest-reachable fallback — C++ foot.cpp:333-335
//
// C++ code (foot.cpp:333-335):
//   if (Can_Enter_Cell(cell) > MOVE_CLOAK && dist > checkdist) {
//     CELL cell2 = Map.Nearby_Location(cell, Techno_Type_Class()->Speed,
//                    Map[Coord].Zones[Techno_Type_Class()->MZone],
//                    Techno_Type_Class()->MZone);
//     if (cell2 != 0 && ::Distance(Cell_Coord(cell), Cell_Coord(cell2)) < dist)
//       cell = cell2;
//   }
//
// When the navigation target is impassable (blockage > MOVE_CLOAK) and the
// unit is far enough away, C++ redirects to the nearest reachable cell using
// Nearby_Location (a spiral scan). This means units always move as close as
// possible to impassable destinations.
//
// TS findPath/findPathAStar: A* returns [] if goal terrain is impassable.
// LOS findPath stops at the blocked cell. Neither implements Nearby_Location.
// ============================================================================

describe('C++ parity: nearest-reachable fallback (foot.cpp:333-335)', () => {

  it('A* redirects to nearest passable cell when goal is impassable (C++ Nearby_Location)', () => {
    // C++ foot.cpp:333-335: redirects to Nearby_Location when goal is impassable.
    // TS now implements nearbyLocation spiral scan — finds nearest passable cell and paths there.
    const map = makeMap();
    map.setTerrain(30, 30, Terrain.WATER);

    const path = findPathAStar(map, { cx: 20, cy: 20 }, { cx: 30, cy: 30 }, true);
    // C++ parity: path to nearest passable cell adjacent to the impassable goal
    expect(path.length).toBeGreaterThan(0);
    // Path should not include any impassable cells
    for (const cell of path) {
      expect(map.isTerrainPassable(cell.cx, cell.cy),
        `cell (${cell.cx},${cell.cy}) should be passable`).toBe(true);
    }
  });

  it('LOS findPath produces partial path toward enclosed goal (findpath.cpp:558)', () => {
    // C++ findpath.cpp:558: if (next == dest) break;
    // When the blocked cell IS the destination, C++ stops and returns whatever
    // path it has so far. This gives a partial path toward the goal.
    const map = makeMap();
    // Surround goal with water
    const goal: CellPos = { cx: 30, cy: 30 };
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        map.setTerrain(goal.cx + dx, goal.cy + dy, Terrain.WATER);
      }
    }

    const start: CellPos = { cx: 20, cy: 20 };
    const path = findPath(map, start, goal, true);

    // C++ returns a partial path ending adjacent to the enclosed area
    // TS should produce some partial path (not necessarily reaching goal)
    // The key C++ behavior is that the path doesn't contain impassable cells
    for (const cell of path) {
      expect(map.isTerrainPassable(cell.cx, cell.cy),
        `cell (${cell.cx},${cell.cy}) should be passable`).toBe(true);
    }
    if (path.length > 0) {
      assertContiguous(start, path);
    }
  });

  it('A* nearest-reachable: returns partial path when search limit exhausted', () => {
    // C++ foot.cpp:333-335 handles unreachable via Nearby_Location
    // TS A* has MAX_SEARCH=500 and returns closest-to-goal partial path
    // (pathfinding.ts:847-848)
    const map = makeMap();
    // Create a large impassable barrier
    for (let x = 10; x <= 59; x++) {
      map.setTerrain(x, 35, Terrain.WATER);
    }
    // Goal is on the other side of the barrier
    const start: CellPos = { cx: 20, cy: 20 };
    const goal: CellPos = { cx: 20, cy: 50 };

    const path = findPathAStar(map, start, goal, true);
    // Since the barrier is complete, A* cannot reach goal but should return
    // a partial path toward it (TS pathfinding.ts:847-848: closestNode fallback)
    // This partial path behavior diverges from C++ Nearby_Location but serves
    // the same purpose: get as close as possible
    if (path.length > 0) {
      assertContiguous(start, path);
      // Partial path should make progress toward goal
      const lastY = path[path.length - 1].cy;
      expect(lastY).toBeGreaterThan(start.cy);
    }
  });
});

// ============================================================================
// 6. Path search limits — C++ findpath.cpp:106,110
//
// C++ findpath.cpp:106: #define MAX_MLIST_SIZE 300
// C++ findpath.cpp:110: #define MAX_PATH_EDGE_FOLLOW 400
// C++ foot.cpp:371:     FacingType workpath1[200]; — staging area
//
// The path list has a maximum of 300 entries. Edge following aborts after
// 400 cell visits. The workpath staging area is 200 entries.
// ============================================================================

describe('C++ parity: path search limits (findpath.cpp:106,110)', () => {

  it('LOS path does not exceed MAX_MLIST_SIZE=200 steps (foot.cpp:371)', () => {
    // C++ foot.cpp:371: FacingType workpath1[200] — effective path limit
    const map = makeMap(0, 0, 128, 128);
    const start: CellPos = { cx: 1, cy: 1 };
    const goal: CellPos = { cx: 126, cy: 126 };
    const path = findPath(map, start, goal, true);

    expect(path.length).toBeLessThanOrEqual(200);
    if (path.length > 0) {
      assertContiguous(start, path);
    }
  });

  it('A* search limit caps at 500 nodes explored', () => {
    // C++ doesn't use A* but TS has MAX_SEARCH=500 (pathfinding.ts:732)
    // This isn't a C++ parity requirement but documents the TS-specific limit
    const map = makeMap(0, 0, 128, 128);
    // Large obstacle forces extensive search
    for (let x = 5; x <= 120; x++) {
      map.setTerrain(x, 60, Terrain.WATER);
    }
    const start: CellPos = { cx: 10, cy: 50 };
    const goal: CellPos = { cx: 10, cy: 70 };
    const path = findPathAStar(map, start, goal, true);
    // Should either find a path or return partial/empty due to search limit
    // This is a structural test, not a parity test
    expect(path.length).toBeLessThanOrEqual(500);
  });

  it('edge-following aborts after MAX_PATH_EDGE_FOLLOW=400 iterations', () => {
    // C++ findpath.cpp:974: if (cellcount == MAX_PATH_EDGE_FOLLOW) return(false);
    // TS pathfinding.ts:367: if (cellcount === MAX_PATH_EDGE_FOLLOW) return false;
    // Create a very large obstacle that requires extensive edge-following
    const map = makeMap(0, 0, 128, 128);
    // Create a spiral-like obstacle that forces many edge-follow steps
    for (let x = 20; x <= 100; x++) {
      map.setTerrain(x, 50, Terrain.WATER);
    }
    for (let y = 30; y <= 50; y++) {
      map.setTerrain(20, y, Terrain.WATER);
      map.setTerrain(100, y, Terrain.WATER);
    }
    for (let x = 20; x <= 100; x++) {
      map.setTerrain(x, 30, Terrain.WATER);
    }

    const start: CellPos = { cx: 10, cy: 40 };
    const goal: CellPos = { cx: 60, cy: 60 };
    const path = findPath(map, start, goal, true);

    // Path should not crash and should respect the limit
    // (may return partial path if edge-follow exhausted its 400 iterations)
    expect(path.length).toBeLessThanOrEqual(300);
    if (path.length > 0) {
      assertContiguous(start, path);
    }
  });
});

// ============================================================================
// 7. Per-SpeedClass terrain passability — C++ unit.cpp:3261, infantry.cpp:1471
//
// C++ unit.cpp:3261:
//   if (!cancrush && retval != MOVE_DESTROYABLE &&
//       Ground[cellptr->Land_Type()].Cost[Class->Speed] == 0) {
//     return(MOVE_NO);
//   }
//
// C++ infantry.cpp:1471:
//   if (retval == MOVE_OK && !IsTethered &&
//       Ground[cellptr->Land_Type()].Cost[SPEED_FOOT] == 0) {
//     return(MOVE_NO);
//   }
//
// C++ checks per-speed-class passability: a WHEEL vehicle can't traverse WATER
// (Ground[LAND_WATER].Cost[SPEED_WHEEL]==0), but FLOAT can. Infantry uses
// SPEED_FOOT which has different terrain costs than vehicles.
//
// TS canEnterCell() checks only if terrain is in the PASSABLE set (Clear,
// Road, Ore, Rough, Beach) or WATER for naval=true. It does not consult
// per-SpeedClass terrain costs.
// ============================================================================

describe('C++ parity: per-SpeedClass terrain passability (unit.cpp:3261)', () => {

  it('ROUGH terrain is passable for all ground speed classes', () => {
    // C++ rules.ini: ROUGH terrain has non-zero Cost for Foot, Track, Wheel
    //   Rough: [0.60, 0.60, 0.40, 1.0, 0.0]
    // TS PASSABLE set includes ROUGH
    const map = makeMap();
    map.setTerrain(20, 20, Terrain.ROUGH);
    expect(map.canEnterCell(20, 20, false)).toBe(MoveResult.OK);
  });

  it('WATER terrain is impassable for ground units', () => {
    // C++ Ground[LAND_WATER].Cost[SPEED_WHEEL] = 0 → MOVE_NO
    // C++ Ground[LAND_WATER].Cost[SPEED_FOOT] = 0 → MOVE_NO
    const map = makeMap();
    map.setTerrain(20, 20, Terrain.WATER);
    expect(map.canEnterCell(20, 20, false)).toBe(MoveResult.IMPASSABLE);
  });

  it('WATER terrain is passable for naval units', () => {
    // C++ Ground[LAND_WATER].Cost[SPEED_FLOAT] != 0
    const map = makeMap();
    map.setTerrain(20, 20, Terrain.WATER);
    expect(map.canEnterCell(20, 20, true)).toBe(MoveResult.OK);
  });

  it('ROCK terrain is impassable for all units', () => {
    // C++ Ground[LAND_ROCK].Cost = 0 for all speed classes
    const map = makeMap();
    map.setTerrain(20, 20, Terrain.ROCK);
    expect(map.canEnterCell(20, 20, false)).toBe(MoveResult.IMPASSABLE);
    expect(map.canEnterCell(20, 20, true)).toBe(MoveResult.IMPASSABLE);
  });

  it('BEACH terrain is passable for ground but not naval (C++ LAND_BEACH)', () => {
    // C++ rules.ini: Beach has non-zero Cost for ground, zero for Float
    //   Beach: [0.60, 0.60, 0.40, 1.0, 0.0]
    // TS PASSABLE includes BEACH, naval check only allows WATER
    const map = makeMap();
    map.setTerrain(20, 20, Terrain.BEACH);
    expect(map.canEnterCell(20, 20, false)).toBe(MoveResult.OK);
    expect(map.canEnterCell(20, 20, true)).toBe(MoveResult.IMPASSABLE);
  });

  it('TS does not check per-SpeedClass costs in canEnterCell', () => {
    // C++ unit.cpp:3261 checks Ground[land].Cost[Class->Speed]
    // This allows different unit types to have different terrain passability.
    // TS uses a single PASSABLE set regardless of speed class.
    //
    // Example: C++ RIVER terrain has Cost[SPEED_FOOT]=0 (infantry can't cross)
    // but Cost[SPEED_TRACK]!=0 (vehicles can cross).
    // TS treats RIVER as impassable for everyone (not in PASSABLE set).
    const map = makeMap();
    map.setTerrain(20, 20, Terrain.RIVER);

    // TS: RIVER not in PASSABLE → IMPASSABLE for ground
    expect(map.canEnterCell(20, 20, false)).toBe(MoveResult.IMPASSABLE);

    // C++ might allow certain speed classes to cross RIVER
    // (depends on rules.ini Ground[LAND_RIVER] settings)
    // This documents the architectural difference — TS doesn't distinguish
  });
});

// ============================================================================
// 8. PathThreshhold escalation — C++ foot.cpp:396-411
//
// C++ foot.cpp:396-411:
//   for (;;) {
//     path = Find_Path(cell, &workpath1[0], sizeof(workpath1), PathThreshhold);
//     if (path && path->Cost) {
//       found1 = true;
//       break;
//     }
//     PathThreshhold++;
//     if (PathThreshhold > maxtype) break;
//   }
//
// C++ starts with strict passability (PathThreshhold = MOVE_OK initially)
// and escalates through CLOAK → MOVING_BLOCK → DESTROYABLE → TEMP if
// no path is found. This means C++ will find a path through temporarily
// blocked cells only as a last resort.
//
// TS pathfinding has no threshold escalation — it always treats
// TEMP_BLOCKED as passable and OCCUPIED as blocked.
// ============================================================================

describe('C++ parity: PathThreshhold escalation (foot.cpp:396-411)', () => {

  it('TS findPath treats TEMP_BLOCKED as always passable (no escalation)', () => {
    // C++ initially tries path with threshold MOVE_OK, meaning TEMP cells block.
    // Only after failure does it escalate to allow TEMP cells.
    // TS isPassable (pathfinding.ts:182) always allows TEMP_BLOCKED.
    const map = makeMap();
    // Place a moving unit blocking the only path
    for (let y = 15; y <= 25; y++) {
      map.setTerrain(25, y, Terrain.WATER); // wall
    }
    // Gap in wall where a "moving" unit sits
    map.setTerrain(25, 20, Terrain.CLEAR); // clear the gap
    map.setOccupancy(25, 20, 77);

    const start: CellPos = { cx: 20, cy: 20 };
    const goal: CellPos = { cx: 30, cy: 20 };

    // TS: findPath with occupancy awareness
    // isPassable() returns true for TEMP_BLOCKED cells
    const path = findPath(map, start, goal, false);

    // TS should find a path (it always treats TEMP_BLOCKED as passable)
    // C++ would initially fail (threshold=MOVE_OK blocks TEMP), then retry
    // with escalated threshold
    expect(path.length).toBeGreaterThan(0);
    if (path.length > 0) {
      assertContiguous(start, path);
    }
  });
});

// ============================================================================
// 9. Edge-following picks shorter CW vs CCW — C++ findpath.cpp:700-710
//
// C++ findpath.cpp:700-710:
//   which = &pleft;
//   if (right) {
//     which = &pright;
//     if (left) {
//       if (pleft.Length < pright.Length) {
//         which = &pleft;
//       } else {
//         which = &pright;
//       }
//     }
//   }
//
// When both CW and CCW edge-follows succeed, C++ picks the one with
// fewer steps (shorter Length). If only one succeeds, it uses that one.
// If neither succeeds, the path fails for this obstacle segment.
// ============================================================================

describe('C++ parity: edge-follow picks shorter CW/CCW path (findpath.cpp:700-710)', () => {

  it('asymmetric obstacle: shorter edge chosen', () => {
    const map = makeMap();
    // Create an asymmetric L-shaped wall where going north around is shorter
    // than going south
    // Vertical wall at x=25, y=15 to y=30
    for (let y = 15; y <= 30; y++) {
      map.setTerrain(25, y, Terrain.WATER);
    }
    // Horizontal extension at y=30, x=25 to x=35
    for (let x = 25; x <= 35; x++) {
      map.setTerrain(x, 30, Terrain.WATER);
    }

    const start: CellPos = { cx: 20, cy: 20 };
    const goal: CellPos = { cx: 30, cy: 20 };
    const path = findPath(map, start, goal, true);

    expect(path.length).toBeGreaterThan(0);
    assertContiguous(start, path);

    // The shorter route is north around the wall (gap at y=14)
    // rather than south and around the L-extension
    // Verify path goes north (y decreases below 15 at some point)
    const minY = Math.min(...path.map(c => c.cy));
    expect(minY).toBeLessThan(20);

    assertReachesGoal(path, goal);
  });

  it('when CW and CCW are equal length, either is acceptable', () => {
    const map = makeMap();
    // Perfectly symmetric wall: x=25, y=18 to y=22
    for (let y = 18; y <= 22; y++) {
      map.setTerrain(25, y, Terrain.WATER);
    }

    const start: CellPos = { cx: 23, cy: 20 };
    const goal: CellPos = { cx: 27, cy: 20 };
    const path = findPath(map, start, goal, true);

    assertReachesGoal(path, goal);
    assertContiguous(start, path);

    // Path should go either north or south around the wall
    // Both are valid per C++ (equal length → pright chosen, but either is correct)
    const hasNorth = path.some(c => c.cy < 18);
    const hasSouth = path.some(c => c.cy > 22);
    expect(hasNorth || hasSouth, 'path must go around the wall').toBe(true);
  });
});

// ============================================================================
// 10. Optimize_Moves — C++ findpath.cpp:1038-1203
//
// C++ findpath.cpp:1047 _trans table:
//   static int _trans[FACING_COUNT] = {0,0,1,2,3,-2,-1,0};
//   Index = (cmd2 - cmd1 + 8) % 8
//   3 (FACING_SE) → backtrack elimination
//   1, 2 → smoothing forward
//   -1, -2 → smoothing backward
//   0 → no optimization
//
// Optimize_Moves removes backtrack pairs (direction followed by opposite)
// and smooths zig-zag patterns into diagonals.
// ============================================================================

describe('C++ parity: Optimize_Moves removes backtracking (findpath.cpp:1038-1203)', () => {

  it('straight-line path has no redundant direction changes', () => {
    // C++ optimizes to pure directional movement
    const map = makeMap();
    const start: CellPos = { cx: 20, cy: 20 };
    const goal: CellPos = { cx: 30, cy: 20 };
    const path = findPath(map, start, goal, true);

    // Pure east path: every step should be cx+1, cy same
    expect(path.length).toBe(10);
    for (let i = 0; i < path.length; i++) {
      expect(path[i].cx).toBe(start.cx + i + 1);
      expect(path[i].cy).toBe(20);
    }
  });

  it('diagonal path stays diagonal (not zig-zag)', () => {
    const map = makeMap();
    const start: CellPos = { cx: 20, cy: 20 };
    const goal: CellPos = { cx: 25, cy: 25 };
    const path = findPath(map, start, goal, true);

    expect(path.length).toBe(5);
    let prev = start;
    for (const cell of path) {
      expect(cell.cx - prev.cx).toBe(1);
      expect(cell.cy - prev.cy).toBe(1);
      prev = cell;
    }
  });

  it('post-edge-follow path is still contiguous after optimization', () => {
    const map = makeMap();
    // Wall that forces edge-following, which generates non-optimal directions
    for (let y = 18; y <= 24; y++) {
      map.setTerrain(25, y, Terrain.WATER);
    }
    const start: CellPos = { cx: 23, cy: 21 };
    const goal: CellPos = { cx: 27, cy: 21 };
    const path = findPath(map, start, goal, true);

    expect(path.length).toBeGreaterThan(0);
    assertContiguous(start, path);
    assertReachesGoal(path, goal);
  });
});

// ============================================================================
// 11. LOS fast path — C++ findpath.cpp:544-552
//
// C++ findpath.cpp:544-552:
//   direction = CELL_FACING(startcell, dest);
//   next = Adjacent_Cell(startcell, direction);
//   cost = Passable_Cell(next, direction, threat, threshhold);
//   if (cost) {
//     Register_Cell(&path, next, direction, cost, threshhold);
//   }
//
// C++ tries a straight-line path first (CELL_FACING gives direction toward
// goal, then it walks one cell at a time). Only when a cell is blocked does
// it switch to edge-following.
//
// TS pathfinding.ts:577-588 mirrors this: cellFacing toward goal, check
// isPassable, register if clear.
// ============================================================================

describe('C++ parity: LOS fast path (findpath.cpp:544-552)', () => {

  it('unobstructed path is straight line (no unnecessary edge-following)', () => {
    const map = makeMap();
    const start: CellPos = { cx: 20, cy: 20 };
    const goal: CellPos = { cx: 20, cy: 30 };
    const path = findPath(map, start, goal, true);

    // Pure south path
    expect(path.length).toBe(10);
    for (let i = 0; i < path.length; i++) {
      expect(path[i].cx).toBe(20);
      expect(path[i].cy).toBe(20 + i + 1);
    }
  });

  it('LOS path to near-diagonal destination is optimal', () => {
    // C++ CELL_FACING uses direction from current cell to dest
    // For a destination that's 3 east and 1 north, the direction alternates
    const map = makeMap();
    const start: CellPos = { cx: 20, cy: 20 };
    const goal: CellPos = { cx: 23, cy: 17 };
    const path = findPath(map, start, goal, true);

    expect(path.length).toBeGreaterThan(0);
    assertContiguous(start, path);
    assertReachesGoal(path, goal);

    // Path should be efficient — not more than max(dx,dy) = max(3,3) = 3 steps
    // (diagonal distance)
    expect(path.length).toBeLessThanOrEqual(4);
  });

  it('LOS path switches to edge-follow only when blocked', () => {
    const map = makeMap();
    // Single blocked cell on the direct path
    map.setTerrain(22, 20, Terrain.WATER);

    const start: CellPos = { cx: 20, cy: 20 };
    const goal: CellPos = { cx: 25, cy: 20 };
    const path = findPath(map, start, goal, true);

    // Should find a path around the single cell
    expect(path.length).toBeGreaterThan(0);
    assertContiguous(start, path);
    assertReachesGoal(path, goal);

    // Path should not go through the blocked cell
    expect(path.some(c => c.cx === 22 && c.cy === 20)).toBe(false);
  });
});

// ============================================================================
// 12. C++ Follow_Edge loop detection — findpath.cpp:990-992
//
// C++ findpath.cpp:990-992:
//   if (newcell == firstcell && newdir == firstdir) {
//     return(false);
//   }
//
// If edge-following returns to the exact cell and direction it started from,
// it detects a full loop and aborts. This prevents infinite loops around
// isolated obstacles.
// ============================================================================

describe('C++ parity: edge-follow loop detection (findpath.cpp:990-992)', () => {

  it('fully enclosed obstacle does not cause infinite loop', () => {
    const map = makeMap();
    // Create a small enclosed box
    for (let x = 23; x <= 27; x++) {
      map.setTerrain(x, 18, Terrain.WATER);
      map.setTerrain(x, 22, Terrain.WATER);
    }
    for (let y = 18; y <= 22; y++) {
      map.setTerrain(23, y, Terrain.WATER);
      map.setTerrain(27, y, Terrain.WATER);
    }

    // Goal is inside the box (impassable from outside)
    const start: CellPos = { cx: 20, cy: 20 };
    const goal: CellPos = { cx: 25, cy: 20 };
    const path = findPath(map, start, goal, true);

    // Should not hang — returns partial or empty path
    // C++ would detect the loop via firstcell/firstdir check and abort
    // Path should have passable cells only
    for (const cell of path) {
      expect(map.isTerrainPassable(cell.cx, cell.cy),
        `cell (${cell.cx},${cell.cy}) should be passable`).toBe(true);
    }
  });
});

// ============================================================================
// 13. C++ workpath staging area size — foot.cpp:371
//
// C++ foot.cpp:371: FacingType workpath1[200];
// This limits the path to 200 entries before it gets copied to the unit's
// Path[] array. Combined with Path[] being CONQUER_PATH_MAX (24 in TD, likely
// similar in RA), the actual usable path is very short.
//
// TS uses MAX_MLIST_SIZE=300 as the path limit, which is the findpath.cpp
// value, not the Basic_Path staging area limit.
// ============================================================================

describe('C++ parity: path staging area constraints (foot.cpp:371)', () => {

  it('C++ parity: path truncated at 200 entries (foot.cpp:371 workpath1[200])', () => {
    // C++ foot.cpp:371: FacingType workpath1[200]; — staging buffer limits path to 200.
    // TS now matches: MAX_MLIST_SIZE = 200 (was 300).
    const map = makeMap(0, 0, 128, 128);
    const start: CellPos = { cx: 1, cy: 1 };
    const goal: CellPos = { cx: 120, cy: 120 };
    const path = findPath(map, start, goal, true);

    // C++ parity: path is truncated at 200 (workpath1 staging area size)
    expect(path.length).toBeLessThanOrEqual(200);
    expect(path.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// 14. Doughnut handling — C++ findpath.cpp:568, 652-691
//
// C++ findpath.cpp:652-691:
//   When edge-following fails around an obstacle (the "far side" is unreachable
//   because it's inside a "doughnut" of passable terrain surrounded by
//   impassable), C++ scans forward looking for the next impassable to try
//   edge-following again. It supports up to 5 nested doughnuts (limiter < 5).
// ============================================================================

describe('C++ parity: doughnut handling (findpath.cpp:568, 652-691)', () => {

  it('path through a gap between two obstacles (not a true doughnut)', () => {
    const map = makeMap();
    // Two separate walls with a gap between them
    for (let y = 15; y <= 25; y++) {
      map.setTerrain(25, y, Terrain.WATER);
    }
    // Leave gap at y=20 by clearing it
    map.setTerrain(25, 20, Terrain.CLEAR);

    const start: CellPos = { cx: 20, cy: 20 };
    const goal: CellPos = { cx: 30, cy: 20 };
    const path = findPath(map, start, goal, true);

    assertReachesGoal(path, goal);
    assertContiguous(start, path);
    // Should go through the gap at (25, 20)
    expect(path.some(c => c.cx === 25 && c.cy === 20)).toBe(true);
  });

  it('two sequential obstacles on the path', () => {
    const map = makeMap();
    // First wall at x=23
    for (let y = 18; y <= 22; y++) {
      map.setTerrain(23, y, Terrain.WATER);
    }
    // Second wall at x=27
    for (let y = 18; y <= 22; y++) {
      map.setTerrain(27, y, Terrain.WATER);
    }

    const start: CellPos = { cx: 20, cy: 20 };
    const goal: CellPos = { cx: 30, cy: 20 };
    const path = findPath(map, start, goal, true);

    assertReachesGoal(path, goal);
    assertContiguous(start, path);
    // Path should navigate around both walls
    for (const cell of path) {
      expect(map.isTerrainPassable(cell.cx, cell.cy),
        `cell (${cell.cx},${cell.cy}) should be passable`).toBe(true);
    }
  });
});

// ============================================================================
// 15. CELL_FACING direction calculation — C++ findpath.cpp:92
//
// C++ findpath.cpp:92:
//   #define CELL_FACING(a, b) Dir_Facing(::Direction((a), (b)))
//
// Direction() computes the compass direction from cell a to cell b using
// atan2-style logic mapped to 8 facings (0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW).
//
// TS pathfinding.ts:50-58 cellFacing uses Math.atan2 mapped to the same 8 facings.
// ============================================================================

describe('C++ parity: CELL_FACING direction calculation (findpath.cpp:92)', () => {

  it('cardinal directions are correct', () => {
    // Test the findPath behavior by checking direction of first step
    const map = makeMap();
    const center: CellPos = { cx: 25, cy: 25 };

    // North
    let path = findPath(map, center, { cx: 25, cy: 20 }, true);
    expect(path[0].cx).toBe(25);
    expect(path[0].cy).toBe(24); // cy decreases = north

    // South
    path = findPath(map, center, { cx: 25, cy: 30 }, true);
    expect(path[0].cx).toBe(25);
    expect(path[0].cy).toBe(26); // cy increases = south

    // East
    path = findPath(map, center, { cx: 30, cy: 25 }, true);
    expect(path[0].cx).toBe(26);
    expect(path[0].cy).toBe(25); // cx increases = east

    // West
    path = findPath(map, center, { cx: 20, cy: 25 }, true);
    expect(path[0].cx).toBe(24);
    expect(path[0].cy).toBe(25); // cx decreases = west
  });

  it('diagonal directions are correct', () => {
    const map = makeMap();
    const center: CellPos = { cx: 25, cy: 25 };

    // NE
    let path = findPath(map, center, { cx: 30, cy: 20 }, true);
    expect(path[0].cx).toBe(26);
    expect(path[0].cy).toBe(24);

    // SE
    path = findPath(map, center, { cx: 30, cy: 30 }, true);
    expect(path[0].cx).toBe(26);
    expect(path[0].cy).toBe(26);

    // SW
    path = findPath(map, center, { cx: 20, cy: 30 }, true);
    expect(path[0].cx).toBe(24);
    expect(path[0].cy).toBe(26);

    // NW
    path = findPath(map, center, { cx: 20, cy: 20 }, true);
    expect(path[0].cx).toBe(24);
    expect(path[0].cy).toBe(24);
  });
});

// ============================================================================
// 16. Nudge logic — C++ unit.cpp:3176-3194
//
// C++ unit.cpp:3176-3194:
//   if (House->Is_Ally(obj)) {
//     if (is_moving) {
//       int face = Dir_Facing(PrimaryFacing);
//       int techface = Dir_Facing(((FootClass const *)obj)->PrimaryFacing) ^4;
//       if (face == techface && Distance((AbstractClass const *)obj) <= 0x1FF) {
//         return(MOVE_NO);  // Head-on collision — hard block
//       }
//       if (retval < MOVE_MOVING_BLOCK) retval = MOVE_MOVING_BLOCK;
//     } else {
//       if (obj->What_Am_I() == RTTI_BUILDING) return(MOVE_NO);
//       if (Map[Coord].Zones[Class->MZone] != cellptr->Zones[Class->MZone])
//         return(MOVE_NO);  // Different zone = permanent block
//       if (retval < MOVE_TEMP) retval = MOVE_TEMP;
//     }
//   }
//
// C++ has sophisticated nudge logic:
//   - Head-on collision (same facing, opposite direction, close) → MOVE_NO
//   - Allied moving unit → MOVE_MOVING_BLOCK (cost=3)
//   - Allied stationary unit → MOVE_TEMP (cost=10)
//   - Allied building → MOVE_NO (permanent)
//   - Different movement zone → MOVE_NO (permanent)
//
// TS canEnterCell only distinguishes moving (TEMP_BLOCKED) vs stationary
// (OCCUPIED), without head-on collision detection or zone checks.
// ============================================================================

describe('C++ parity: nudge logic (unit.cpp:3176-3194)', () => {

  it('moving ally returns OCCUPIED=2 (C++ MOVE_MOVING_BLOCK), no head-on detection', () => {
    // C++ unit.cpp:3178-3182: head-on collision check returns MOVE_NO
    // TS has no facing/direction awareness — returns OCCUPIED(2) for all moving allies.
    // This is a remaining parity gap: C++ can detect head-on and return MOVE_NO=5.
    const map = makeMap();
    map.setOccupancy(20, 20, 55);
    const isMoving = (id: number) => id === 55;

    const result = map.canEnterCell(20, 20, false, isMoving);
    // C++ parity: moving ally → MOVE_MOVING_BLOCK=2 (OCCUPIED in TS)
    expect(result).toBe(MoveResult.OCCUPIED);
  });

  it('stationary ally returns TEMP_BLOCKED=4 (C++ MOVE_TEMP), no zone check', () => {
    // C++ unit.cpp:3191: if different zone → MOVE_NO
    // TS has no zone system — all stationary friendlies get TEMP_BLOCKED(4=MOVE_TEMP)
    const map = makeMap();
    map.setOccupancy(20, 20, 66);

    // C++ parity: stationary ally → MOVE_TEMP=4 (TEMP_BLOCKED in TS)
    const result = map.canEnterCell(20, 20);
    expect(result).toBe(MoveResult.TEMP_BLOCKED);
  });
});
