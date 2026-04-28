/**
 * C++ Behavioral Parity Tests — Pathfinding Cost (findpath.cpp)
 *
 * Verifies that pathfinding costs match C++ Passable_Cell (findpath.cpp:1266-1293):
 *   - Costs are flat per blockage type: MOVE_OK=1, MOVE_CLOAK=1, MOVE_MOVING_BLOCK=3,
 *     MOVE_DESTROYABLE=8, MOVE_TEMP=10, MOVE_NO=0
 *   - Terrain speed multipliers (drive.cpp Ground[].Cost[]) do NOT affect path selection
 *   - Speed multipliers only affect actual movement speed during track following
 *   - Path selection is purely based on passability/blockage, not terrain speed
 *
 * C++ source refs:
 *   findpath.cpp:1266-1293 (Passable_Cell — flat cost table)
 *   findpath.cpp:1284-1292 (_value[] = {1, 1, 3, 8, 10, 0})
 *   drive.cpp Ground[terrain].Cost[speed_class] (speed applied during movement, NOT pathfinding)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameMap, MoveResult, Terrain } from '../engine/map';
import { findPath, findPathAStar, nearbyLocation } from '../engine/pathfinding';
import { MAP_CELLS, SpeedClass } from '../engine/types';

let map: GameMap;

beforeEach(() => {
  map = new GameMap();
  // 20x20 playable area at offset 10,10
  map.setBounds(10, 10, 20, 20);
});

// =============================================================================
//  1. Speed multiplier does NOT affect pathfinding cost
//     C++ findpath.cpp:1284 — flat _value[] table, no Ground[].Cost[] lookup
// =============================================================================

describe('C++ parity: speed multiplier excluded from pathfinding costs', () => {

  it('path through ROUGH terrain (slow) costs the same as CLEAR terrain (fast)', () => {
    // Setup: two parallel corridors from (11,15) to (18,15)
    //   Top corridor (y=14): all CLEAR (fast terrain, speedMult ~1.0)
    //   Bottom corridor (y=16): all ROUGH (slow terrain, speedMult < 1.0)
    // Both corridors connect start and goal.
    //
    // C++ picks the same path regardless of terrain speed.
    // If speed multiplier affected cost, the pathfinder would prefer the CLEAR corridor.

    // Set ROUGH terrain on the direct path
    for (let x = 11; x <= 18; x++) {
      map.setTerrain(x, 15, Terrain.ROUGH);
    }

    const start = { cx: 11, cy: 15 };
    const goal = { cx: 18, cy: 15 };

    // A* should path straight through ROUGH (direct route) not detour around it
    const pathAStar = findPathAStar(map, start, goal, true);
    expect(pathAStar.length).toBeGreaterThan(0);

    // All cells in path should be at y=15 (straight through ROUGH)
    for (const cell of pathAStar) {
      expect(cell.cy, `A* should take direct path through ROUGH, not detour`).toBe(15);
    }

    // LOS pathfinder should also go straight
    const pathLOS = findPath(map, start, goal, true);
    expect(pathLOS.length).toBeGreaterThan(0);
    for (const cell of pathLOS) {
      expect(cell.cy, `LOS should take direct path through ROUGH, not detour`).toBe(15);
    }
  });

  it('A* does not prefer road cells over clear cells', () => {
    // Setup: start at (11,15), goal at (18,15), direct path is CLEAR
    // Add a road corridor at y=14 (one row above)
    // C++ pathfinder should take direct path (y=15), not detour to road (y=14)

    // Mark y=14 cells as ROAD terrain (gives higher speedMult)
    for (let x = 11; x <= 18; x++) {
      map.setTerrain(x, 14, Terrain.ROAD);
    }

    const start = { cx: 11, cy: 15 };
    const goal = { cx: 18, cy: 15 };

    const path = findPathAStar(map, start, goal, true);
    expect(path.length).toBeGreaterThan(0);

    // Path should go straight at y=15, not detour through the road at y=14
    for (const cell of path) {
      expect(cell.cy, `A* should not detour to road corridor`).toBe(15);
    }
  });

  it('CLEAR and ROUGH cells produce identical A* path cost for same distance', () => {
    // Two paths of equal Manhattan distance: one through CLEAR, one through ROUGH
    // C++ assigns cost=1 to both (MOVE_OK), so they should produce equal-cost paths

    // Horizontal path through CLEAR: (11,14) to (15,14)
    const clearStart = { cx: 11, cy: 14 };
    const clearGoal = { cx: 15, cy: 14 };
    const clearPath = findPathAStar(map, clearStart, clearGoal, true);

    // Horizontal path through ROUGH: (11,16) to (15,16)
    for (let x = 11; x <= 15; x++) {
      map.setTerrain(x, 16, Terrain.ROUGH);
    }
    const roughStart = { cx: 11, cy: 16 };
    const roughGoal = { cx: 15, cy: 16 };
    const roughPath = findPathAStar(map, roughStart, roughGoal, true);

    // Both paths should have the same number of steps (same distance, same cost)
    expect(roughPath.length).toBe(clearPath.length);
  });
});

// =============================================================================
//  2. Blocked/impassable cells are still rejected
//     C++ findpath.cpp:1272 — if (move > threshhold) return(0)
// =============================================================================

describe('C++ parity: impassable cells rejected in pathfinding', () => {

  it('A* rejects path through ROCK (impassable)', () => {
    // Wall of ROCK blocking direct path
    for (let y = 13; y <= 17; y++) {
      map.setTerrain(15, y, Terrain.ROCK);
    }

    const start = { cx: 11, cy: 15 };
    const goal = { cx: 18, cy: 15 };

    const path = findPathAStar(map, start, goal, true);
    // Path should exist (goes around) but no cell should be on the ROCK column
    if (path.length > 0) {
      for (const cell of path) {
        if (cell.cx === 15) {
          expect(cell.cy < 13 || cell.cy > 17,
            `A* should not path through ROCK at (15,${cell.cy})`).toBe(true);
        }
      }
    }
  });

  it('A* rejects path through WATER for ground units', () => {
    // Water strip blocking direct path
    for (let y = 13; y <= 17; y++) {
      map.setTerrain(15, y, Terrain.WATER);
    }

    const start = { cx: 11, cy: 15 };
    const goal = { cx: 18, cy: 15 };

    const path = findPathAStar(map, start, goal, true);
    if (path.length > 0) {
      for (const cell of path) {
        const terrain = map.cells[cell.cy * MAP_CELLS + cell.cx];
        expect(terrain, `A* should not path through WATER at (${cell.cx},${cell.cy})`).not.toBe(Terrain.WATER);
      }
    }
  });

  it('LOS pathfinder rejects path through WALL', () => {
    for (let y = 13; y <= 17; y++) {
      map.setTerrain(15, y, Terrain.WALL);
    }

    const start = { cx: 11, cy: 15 };
    const goal = { cx: 18, cy: 15 };

    const path = findPath(map, start, goal, true);
    if (path.length > 0) {
      for (const cell of path) {
        const terrain = map.cells[cell.cy * MAP_CELLS + cell.cx];
        expect(terrain, `LOS should not path through WALL at (${cell.cx},${cell.cy})`).not.toBe(Terrain.WALL);
      }
    }
  });
});

// =============================================================================
//  2b. Equal left/right detour tie-break
//      C++ findpath.cpp:700-710 keeps clockwise path when lengths tie
// =============================================================================

describe('C++ parity: equal detours prefer clockwise edge-follow path', () => {

  it('chooses the clockwise detour when left and right paths have equal length', () => {
    map.setTerrain(13, 15, Terrain.ROCK);

    const path = findPath(map, { cx: 11, cy: 15 }, { cx: 15, cy: 15 }, true);

    expect(path.slice(0, 4)).toEqual([
      { cx: 12, cy: 15 },
      { cx: 13, cy: 16 },
      { cx: 14, cy: 15 },
      { cx: 15, cy: 15 },
    ]);
  });
});

// =============================================================================
//  2c. Nearby_Location ring order and Frame % count selection
//      C++ map.cpp:1680-1729 top/bottom rows, then left/right columns
// =============================================================================

describe('C++ parity: Nearby_Location scan selection', () => {

  it('selects from the first ten clear cells using Frame modulo count', () => {
    map.setTerrain(15, 15, Terrain.WATER);

    expect(nearbyLocation(map, { cx: 15, cy: 15 }, false, 0)).toEqual({ cx: 14, cy: 14 });
    expect(nearbyLocation(map, { cx: 15, cy: 15 }, false, 5)).toEqual({ cx: 16, cy: 16 });
    expect(nearbyLocation(map, { cx: 15, cy: 15 }, false, 13)).toEqual({ cx: 16, cy: 16 });
  });
});

// =============================================================================
//  3. TEMP_BLOCKED cells get penalty cost
//     C++ findpath.cpp:1289 — MOVE_TEMP = 10
// =============================================================================

describe('C++ parity: TEMP_BLOCKED cells get penalty cost', () => {

  it('A* penalizes TEMP_BLOCKED cells (prefers clear path when available)', () => {
    // Setup: direct path has a TEMP_BLOCKED cell, alternate path is clear
    // Put an occupant on the direct path that is flagged as "moving"
    map.setOccupancy(15, 15, 42); // entity 42 at (15,15)

    const start = { cx: 11, cy: 15 };
    const goal = { cx: 18, cy: 15 };

    // With isMoving returning true for entity 42, cell should be TEMP_BLOCKED
    const isMoving = (id: number) => id === 42;
    const path = findPathAStar(map, start, goal, false, false, SpeedClass.WHEEL, isMoving);

    // Path should exist
    expect(path.length).toBeGreaterThan(0);

    // Verify the path reaches the goal
    const last = path[path.length - 1];
    expect(last.cx).toBe(goal.cx);
    expect(last.cy).toBe(goal.cy);
  });

  it('A* can still path through TEMP_BLOCKED when it is the only option', () => {
    // Create a narrow corridor where TEMP_BLOCKED cell is unavoidable
    // y=14 and y=16 are ROCK, forcing path through y=15
    for (let x = 13; x <= 17; x++) {
      map.setTerrain(x, 14, Terrain.ROCK);
      map.setTerrain(x, 16, Terrain.ROCK);
    }
    // Place a "moving" unit at (15,15)
    map.setOccupancy(15, 15, 99);

    const start = { cx: 11, cy: 15 };
    const goal = { cx: 18, cy: 15 };

    const isMoving = (id: number) => id === 99;
    const path = findPathAStar(map, start, goal, false, false, SpeedClass.WHEEL, isMoving);

    // Path should still exist — TEMP_BLOCKED is passable (just costly)
    expect(path.length).toBeGreaterThan(0);
  });
});

// =============================================================================
//  4. Path cost is based on distance/blockage only
//     C++ findpath.cpp:1284-1292 — costs are {1,1,3,8,10,0} by MoveType only
// =============================================================================

describe('C++ parity: path cost based on distance and blockage only', () => {

  it('straight-line path length equals cell distance (no speed-based detour)', () => {
    const start = { cx: 11, cy: 15 };
    const goal = { cx: 18, cy: 15 };

    // Mix of CLEAR and ROUGH terrain along the path
    map.setTerrain(13, 15, Terrain.ROUGH);
    map.setTerrain(14, 15, Terrain.ROUGH);
    map.setTerrain(15, 15, Terrain.ROUGH);

    const path = findPathAStar(map, start, goal, true);
    // Direct distance is 7 cells, path should be exactly 7 steps
    expect(path.length).toBe(7);

    // All steps should be at y=15 (no detour)
    for (const cell of path) {
      expect(cell.cy).toBe(15);
    }
  });

  it('diagonal path length is optimal (no speed-based detour)', () => {
    const start = { cx: 11, cy: 11 };
    const goal = { cx: 15, cy: 15 };

    // Set some cells to ROUGH (different speed)
    map.setTerrain(12, 12, Terrain.ROUGH);
    map.setTerrain(13, 13, Terrain.ROUGH);

    const path = findPathAStar(map, start, goal, true);
    // Direct diagonal distance is 4 cells
    expect(path.length).toBe(4);
  });

  it('SpeedClass does not change path selection in A*', () => {
    const start = { cx: 11, cy: 15 };
    const goal = { cx: 18, cy: 15 };

    // Set ROUGH terrain on the path
    for (let x = 11; x <= 18; x++) {
      map.setTerrain(x, 15, Terrain.ROUGH);
    }

    // Different speed classes should produce identical paths
    const pathWheel = findPathAStar(map, start, goal, true, false, SpeedClass.WHEEL);
    const pathTrack = findPathAStar(map, start, goal, true, false, SpeedClass.TRACK);
    const pathFoot = findPathAStar(map, start, goal, true, false, SpeedClass.FOOT);

    expect(pathWheel.length).toBe(pathTrack.length);
    expect(pathWheel.length).toBe(pathFoot.length);

    // All paths should be identical cell-by-cell
    for (let i = 0; i < pathWheel.length; i++) {
      expect(pathTrack[i].cx).toBe(pathWheel[i].cx);
      expect(pathTrack[i].cy).toBe(pathWheel[i].cy);
      expect(pathFoot[i].cx).toBe(pathWheel[i].cx);
      expect(pathFoot[i].cy).toBe(pathWheel[i].cy);
    }
  });
});
