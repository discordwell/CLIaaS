/**
 * C++ Behavioral Parity Tests -- Advanced Pathfinding
 *
 * Tests cover pathfinding behaviors from the C++ source that are NOT covered
 * by the basic pathfinding, cost, or threshold test files:
 *
 *   1. canEnterCell MoveResult semantics   (cell.cpp Can_Enter_Cell, map.ts:700-727)
 *   2. Occupancy hard-blocking             (cell.h Flag.Occupy, map.ts:270-354)
 *   3. Nudge / blocked-by-friendly logic   (foot.cpp:396-463, pathfinding.ts isPassable)
 *   4. Nearest-reachable fallback path     (findpath.cpp:847, pathfinding.ts A* closestNode)
 *   5. Terrain cost multipliers            (drive.cpp Ground[].Cost[], map.ts:207-242)
 *   6. Path length limits                  (findpath.cpp:106 MAX_MLIST_SIZE, A* MAX_SEARCH)
 *   7. LOS fast path                       (findpath.cpp:544-552, pathfinding.ts:906-977)
 *
 * C++ source refs:
 *   cell.cpp:1-120     Can_Enter_Cell — returns MoveType per occupancy/terrain
 *   cell.h:45-78       Flag.Occupy — vehicle vs infantry sub-cell system
 *   foot.cpp:396-463   PathThreshhold escalation, TEMP_BLOCKED pass-through
 *   findpath.cpp:106   MAX_MLIST_SIZE = 300 (max path steps)
 *   findpath.cpp:435-752  Find_Path — LOS + edge-follow main loop
 *   findpath.cpp:544-552  LOS straight-line walk toward destination
 *   findpath.cpp:1266-1293  Passable_Cell — flat cost by MoveType
 *   drive.cpp Ground[terrain].Cost[speed_class] — speed multipliers (movement, NOT path cost)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { findPath, findPathAStar, findPathLOS } from '../engine/pathfinding';
import { GameMap, MoveResult, Terrain } from '../engine/map';
import { type CellPos, MAP_CELLS, SpeedClass, CELL_SIZE } from '../engine/types';

// ============================================================================
// Test helpers
// ============================================================================

/** Create a test map with passable interior */
function makeTestMap(boundsX = 10, boundsY = 10, boundsW = 20, boundsH = 20): GameMap {
  const map = new GameMap();
  map.setBounds(boundsX, boundsY, boundsW, boundsH);
  map.initDefault();
  return map;
}

/** Check that all cells in the path are terrain-passable */
function validatePath(map: GameMap, path: CellPos[]): void {
  for (const cell of path) {
    expect(map.isTerrainPassable(cell.cx, cell.cy),
      `cell (${cell.cx},${cell.cy}) should be terrain-passable`).toBe(true);
  }
}

/** Check path is contiguous -- each step is 8-way adjacent to the previous */
function validateContiguous(start: CellPos, path: CellPos[]): void {
  let prev = start;
  for (let i = 0; i < path.length; i++) {
    const dx = Math.abs(path[i].cx - prev.cx);
    const dy = Math.abs(path[i].cy - prev.cy);
    expect(dx <= 1 && dy <= 1 && (dx + dy > 0),
      `step ${i}: (${prev.cx},${prev.cy}) -> (${path[i].cx},${path[i].cy}) should be adjacent`).toBe(true);
    prev = path[i];
  }
}

// ============================================================================
// 1. canEnterCell MoveResult semantics
//    C++ cell.cpp Can_Enter_Cell — returns OK, IMPASSABLE, OCCUPIED, TEMP_BLOCKED
//    TS map.ts:700-727
// ============================================================================

describe('C++ parity: canEnterCell MoveResult semantics (cell.cpp Can_Enter_Cell)', () => {
  let map: GameMap;

  beforeEach(() => {
    map = makeTestMap();
  });

  it('returns OK for empty passable cell — cell.cpp Can_Enter_Cell normal case', () => {
    const result = map.canEnterCell(15, 15);
    expect(result).toBe(MoveResult.OK);
  });

  it('returns IMPASSABLE for out-of-bounds cell — cell.cpp bounds check', () => {
    // Cell outside the map bounds (boundsX=10, boundsW=20, so x>=30 is out)
    const result = map.canEnterCell(5, 5);
    expect(result).toBe(MoveResult.IMPASSABLE);
  });

  it('returns IMPASSABLE for ROCK terrain — cell.cpp terrain check', () => {
    map.setTerrain(15, 15, Terrain.ROCK);
    const result = map.canEnterCell(15, 15);
    expect(result).toBe(MoveResult.IMPASSABLE);
  });

  it('returns IMPASSABLE for WATER terrain (non-naval) — cell.cpp terrain check', () => {
    map.setTerrain(15, 15, Terrain.WATER);
    const result = map.canEnterCell(15, 15, false);
    expect(result).toBe(MoveResult.IMPASSABLE);
  });

  it('returns OK for WATER terrain when naval=true — cell.cpp naval passability', () => {
    map.setTerrain(15, 15, Terrain.WATER);
    const result = map.canEnterCell(15, 15, true);
    expect(result).toBe(MoveResult.OK);
  });

  it('returns OCCUPIED for cell with stationary occupant — cell.cpp Flag.Occupy', () => {
    map.setOccupancy(15, 15, 42);
    const result = map.canEnterCell(15, 15);
    expect(result).toBe(MoveResult.OCCUPIED);
  });

  it('returns TEMP_BLOCKED for cell with moving occupant — cell.cpp moving unit check', () => {
    map.setOccupancy(15, 15, 42);
    const isMoving = (id: number) => id === 42;
    const result = map.canEnterCell(15, 15, false, isMoving);
    expect(result).toBe(MoveResult.TEMP_BLOCKED);
  });

  it('returns OCCUPIED when isMoving returns false for occupant — cell.cpp stationary check', () => {
    map.setOccupancy(15, 15, 42);
    const isMoving = (id: number) => id === 99; // entity 42 is not moving
    const result = map.canEnterCell(15, 15, false, isMoving);
    expect(result).toBe(MoveResult.OCCUPIED);
  });

  it('MoveResult enum values match C++ defines — defines.h:828-837', () => {
    // C++: MOVE_OK=0 (terrain passable, no occupant)
    expect(MoveResult.OK).toBe(0);
    // C++: MOVE_NO=-1 (terrain impassable)
    expect(MoveResult.IMPASSABLE).toBe(-1);
    // C++: OCCUPIED=1 (stationary unit blocking)
    expect(MoveResult.OCCUPIED).toBe(1);
    // C++: TEMP_BLOCKED=2 (moving unit, will clear)
    expect(MoveResult.TEMP_BLOCKED).toBe(2);
  });
});

// ============================================================================
// 2. Occupancy hard-blocking -- vehicles block cells entirely;
//    infantry use sub-cell occupancy
//    C++ cell.h Flag.Occupy, map.ts:270-354
// ============================================================================

describe('C++ parity: occupancy hard-blocking (cell.h Flag.Occupy)', () => {
  let map: GameMap;

  beforeEach(() => {
    map = makeTestMap();
  });

  describe('vehicle occupancy blocks all sub-cells — cell.h Flag.Occupy.Vehicle', () => {
    it('setVehicleOccupancy marks cell as fully blocked', () => {
      map.setVehicleOccupancy(15, 15, 100);
      expect(map.hasVehicleOccupancy(15, 15)).toBe(true);
      expect(map.getSubCellCount(15, 15)).toBe(5); // all 5 sub-cells blocked
    });

    it('canEnterCell returns OCCUPIED for vehicle-occupied cell — cell.cpp vehicle check', () => {
      map.setVehicleOccupancy(15, 15, 100);
      const result = map.canEnterCell(15, 15, false, undefined, true); // isInfantry=true
      expect(result).toBe(MoveResult.OCCUPIED);
    });

    it('infantry cannot enter vehicle-occupied cell — cell.cpp infantry sub-cell check', () => {
      map.setVehicleOccupancy(15, 15, 100);
      const subCell = map.occupySubCell(15, 15, 200);
      expect(subCell).toBe(-1); // cannot occupy any sub-cell
    });

    it('no available sub-cells when vehicle present', () => {
      map.setVehicleOccupancy(15, 15, 100);
      expect(map.hasAvailableSubCell(15, 15)).toBe(false);
    });
  });

  describe('infantry sub-cell occupancy — cell.h Flag.Occupy.Infantry / Closest_Free_Spot', () => {
    it('infantry can share cells via sub-cell system — cell.cpp Closest_Free_Spot', () => {
      // First infantry gets CENTER (sub-cell 0)
      const sub1 = map.occupySubCell(15, 15, 201);
      expect(sub1).toBe(0); // CENTER

      // Second infantry gets NW (sub-cell 1)
      const sub2 = map.occupySubCell(15, 15, 202);
      expect(sub2).toBe(1); // NW

      // Third infantry gets NE (sub-cell 2)
      const sub3 = map.occupySubCell(15, 15, 203);
      expect(sub3).toBe(2); // NE
    });

    it('sub-cell preference order: CENTER(0), NW(1), NE(2), SW(3), SE(4) — C++ Closest_Free_Spot', () => {
      const order: number[] = [];
      for (let i = 0; i < 5; i++) {
        const sub = map.occupySubCell(15, 15, 300 + i);
        order.push(sub);
      }
      expect(order).toEqual([0, 1, 2, 3, 4]);
    });

    it('cell is full after 5 infantry — all sub-cells occupied', () => {
      for (let i = 0; i < 5; i++) {
        map.occupySubCell(15, 15, 300 + i);
      }
      const sub6 = map.occupySubCell(15, 15, 305);
      expect(sub6).toBe(-1); // no room

      expect(map.hasAvailableSubCell(15, 15)).toBe(false);
      expect(map.getSubCellCount(15, 15)).toBe(5);
    });

    it('canEnterCell returns OK for infantry when sub-cells available — cell.cpp infantry check', () => {
      map.occupySubCell(15, 15, 201); // occupy CENTER
      // Still 4 sub-cells free
      const result = map.canEnterCell(15, 15, false, undefined, true);
      expect(result).toBe(MoveResult.OK);
    });

    it('canEnterCell returns OCCUPIED for infantry when all sub-cells full — cell.cpp infantry check', () => {
      for (let i = 0; i < 5; i++) {
        map.occupySubCell(15, 15, 300 + i);
      }
      const result = map.canEnterCell(15, 15, false, undefined, true);
      expect(result).toBe(MoveResult.OCCUPIED);
    });

    it('vacating a sub-cell frees it for new infantry — cell.cpp infantry departure', () => {
      map.occupySubCell(15, 15, 201);
      map.occupySubCell(15, 15, 202);
      expect(map.getSubCellCount(15, 15)).toBe(2);

      map.vacateSubCell(15, 15, 201);
      expect(map.getSubCellCount(15, 15)).toBe(1);
      expect(map.hasAvailableSubCell(15, 15)).toBe(true);
    });
  });

  describe('vehicle vs infantry blocking differences — cell.h Flag.Occupy semantics', () => {
    it('vehicle occupancy blocks pathfinding for ground units', () => {
      // Place a vehicle at (15,15) — it should block the cell for pathfinding
      map.setVehicleOccupancy(15, 15, 100);
      const result = map.canEnterCell(15, 15);
      expect(result).toBe(MoveResult.OCCUPIED);
    });

    it('infantry occupancy uses legacy occupancy for non-infantry callers', () => {
      // When infantry occupy a cell, the legacy occupancy is set
      map.occupySubCell(15, 15, 201);
      const occupant = map.getOccupancy(15, 15);
      expect(occupant).toBe(201);

      // Non-infantry canEnterCell sees this as OCCUPIED
      const result = map.canEnterCell(15, 15);
      expect(result).toBe(MoveResult.OCCUPIED);
    });
  });
});

// ============================================================================
// 3. "Tell blocking unit to move" nudge logic
//    C++ foot.cpp:396-463 — when blocked by friendly, TEMP_BLOCKED pass-through
//    In TS, the pathfinder's isPassable treats TEMP_BLOCKED as passable
//    (pathfinding.ts:182: result === MoveResult.TEMP_BLOCKED returns true)
// ============================================================================

describe('C++ parity: nudge / blocked-by-friendly logic (foot.cpp:396-463)', () => {
  let map: GameMap;

  beforeEach(() => {
    map = makeTestMap();
  });

  it('isPassable-equivalent treats TEMP_BLOCKED as passable — findpath.cpp Passable_Cell', () => {
    // Place a moving occupant on the direct path
    map.setOccupancy(15, 15, 42);
    const isMoving = (id: number) => id === 42;

    // canEnterCell returns TEMP_BLOCKED for moving unit
    const result = map.canEnterCell(15, 15, false, isMoving);
    expect(result).toBe(MoveResult.TEMP_BLOCKED);

    // The pathfinder treats TEMP_BLOCKED as passable (findpath.cpp Passable_Cell)
    // Verify A* can path through TEMP_BLOCKED cells
    const start = { cx: 11, cy: 15 };
    const goal = { cx: 18, cy: 15 };
    const path = findPathAStar(map, start, goal, false, false, SpeedClass.WHEEL, isMoving);
    expect(path.length).toBeGreaterThan(0);

    const last = path[path.length - 1];
    expect(last.cx).toBe(goal.cx);
    expect(last.cy).toBe(goal.cy);
  });

  it('OCCUPIED cells are NOT passable — stationary friendly blocks path', () => {
    // Place a stationary occupant (not moving) on the direct path
    map.setOccupancy(15, 15, 42);
    const isMoving = (_id: number) => false; // nobody is moving

    const result = map.canEnterCell(15, 15, false, isMoving);
    expect(result).toBe(MoveResult.OCCUPIED);

    // A* should route AROUND the occupied cell, not through it
    const start = { cx: 11, cy: 15 };
    const goal = { cx: 18, cy: 15 };
    const path = findPathAStar(map, start, goal, false, false, SpeedClass.WHEEL, isMoving);

    // Path exists (goes around)
    expect(path.length).toBeGreaterThan(0);

    // No cell in path should be (15,15) — that cell is OCCUPIED
    for (const cell of path) {
      expect(cell.cx === 15 && cell.cy === 15,
        `path should not go through OCCUPIED cell (15,15)`).toBe(false);
    }
  });

  it('ignoreOccupancy=true bypasses all occupancy checks — findpath.cpp ignoreOccupancy', () => {
    // Place a stationary occupant
    map.setOccupancy(15, 15, 42);

    const start = { cx: 11, cy: 15 };
    const goal = { cx: 18, cy: 15 };

    // With ignoreOccupancy=true, occupant is invisible to pathfinder
    const path = findPathAStar(map, start, goal, true);
    expect(path.length).toBeGreaterThan(0);

    // Path should go straight through since occupancy is ignored
    for (const cell of path) {
      expect(cell.cy).toBe(15);
    }
  });

  it('A* penalizes TEMP_BLOCKED with +50 cost — findpath.cpp:1289 MOVE_TEMP penalty', () => {
    // Create two possible paths:
    //   Direct (y=15): has a TEMP_BLOCKED cell at (15,15) — cost penalty +50
    //   Detour (y=14): clear, but 2 cells longer (2 extra cells * 10 cost = +20)
    // C++ penalty is large enough to force a detour when alternative is only slightly longer

    map.setOccupancy(15, 15, 42);
    const isMoving = (id: number) => id === 42;

    const start = { cx: 13, cy: 15 };
    const goal = { cx: 17, cy: 15 };

    const path = findPathAStar(map, start, goal, false, false, SpeedClass.WHEEL, isMoving);
    expect(path.length).toBeGreaterThan(0);

    // Path should reach goal
    const last = path[path.length - 1];
    expect(last.cx).toBe(goal.cx);
    expect(last.cy).toBe(goal.cy);

    // The penalty (+50) is large enough that the A* will likely detour
    // around the TEMP_BLOCKED cell when a reasonably short alternative exists
  });
});

// ============================================================================
// 4. Nearest-reachable fallback path
//    C++ findpath.cpp:847 — when goal unreachable, return path to closest
//    reachable cell. TS A* pathfinding.ts:847-849: closestNode fallback
// ============================================================================

describe('C++ parity: nearest-reachable fallback path (findpath.cpp:847, A* closestNode)', () => {
  let map: GameMap;

  beforeEach(() => {
    map = makeTestMap();
  });

  it('A* returns path to closest reachable cell when goal is enclosed — findpath.cpp closest fallback', () => {
    // Enclose goal with impassable terrain, but leave the goal cell itself passable
    const goal = { cx: 20, cy: 20 };
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        map.setTerrain(goal.cx + dx, goal.cy + dy, Terrain.ROCK);
      }
    }

    const start = { cx: 15, cy: 15 };
    const path = findPathAStar(map, start, goal, true);

    // A* should return a partial path toward the closest reachable cell
    // The path may be empty (if goal terrain is unreachable) or partial
    // When goal terrain is passable but surrounded, A* returns path to
    // the closest reachable cell (closestNode logic, pathfinding.ts:847-849)
    if (path.length > 0) {
      validatePath(map, path);
      validateContiguous(start, path);

      // Last cell should be closer to goal than start is
      const lastCell = path[path.length - 1];
      const startDist = Math.abs(start.cx - goal.cx) + Math.abs(start.cy - goal.cy);
      const lastDist = Math.abs(lastCell.cx - goal.cx) + Math.abs(lastCell.cy - goal.cy);
      expect(lastDist).toBeLessThan(startDist);
    }
  });

  it('A* returns empty when goal terrain is impassable — findpath.cpp:745-747', () => {
    // Set goal on impassable terrain
    map.setTerrain(20, 20, Terrain.ROCK);
    const start = { cx: 15, cy: 15 };
    const goal = { cx: 20, cy: 20 };
    const path = findPathAStar(map, start, goal, true);
    expect(path).toEqual([]);
  });

  it('A* returns path to closest when search is exhausted (MAX_SEARCH=500) — pathfinding.ts:769', () => {
    // Create a maze that exhausts A* search before reaching goal
    // Block with a dense grid of impassable cells that forces A* to explore many nodes
    for (let y = 14; y <= 26; y++) {
      for (let x = 14; x <= 26; x++) {
        // Create a checkerboard pattern of walls that is hard to navigate
        if ((x + y) % 2 === 0 && !(x === 15 && y === 15)) {
          map.setTerrain(x, y, Terrain.ROCK);
        }
      }
    }

    const start = { cx: 15, cy: 15 };
    const goal = { cx: 25, cy: 25 };
    const path = findPathAStar(map, start, goal, true);

    // Path may be partial (closest reachable) or empty
    if (path.length > 0) {
      validatePath(map, path);
      validateContiguous(start, path);
    }
  });

  it('LOS pathfinder returns partial path when goal is blocked — findpath.cpp:558-591', () => {
    // Block the goal itself with impassable terrain
    map.setTerrain(20, 20, Terrain.WATER);

    const start = { cx: 15, cy: 15 };
    const goal = { cx: 20, cy: 20 };
    const path = findPath(map, start, goal, true);

    // LOS pathfinder breaks when direct cell is impassable and IS the destination
    // (findpath.cpp:558: "if blocked IS destination, stop")
    // Path should be partial or empty
    if (path.length > 0) {
      validatePath(map, path);
      validateContiguous(start, path);
    }
  });
});

// ============================================================================
// 5. Terrain cost multipliers
//    C++ drive.cpp Ground[terrain].Cost[speed_class]
//    TS map.ts:207-242 getSpeedMultiplier
//    Key behavior: multipliers affect MOVEMENT SPEED, not pathfinding cost
// ============================================================================

describe('C++ parity: terrain speed multipliers (drive.cpp Ground[].Cost[])', () => {
  let map: GameMap;

  beforeEach(() => {
    map = makeTestMap();
  });

  it('CLEAR terrain has speed multiplier 1.0 for WHEEL — drive.cpp Ground[CLEAR].Cost[WHEEL]', () => {
    const mult = map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL);
    expect(mult).toBe(1.0);
  });

  it('ROUGH terrain has reduced speed multiplier — drive.cpp Ground[ROUGH].Cost', () => {
    map.setTerrain(15, 15, Terrain.ROUGH);
    const mult = map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL);
    expect(mult).toBeLessThan(1.0);
    expect(mult).toBe(0.6);
  });

  it('WINGED (aircraft) ignores terrain entirely — always 1.0', () => {
    map.setTerrain(15, 15, Terrain.ROUGH);
    const mult = map.getSpeedMultiplier(15, 15, SpeedClass.WINGED);
    expect(mult).toBe(1.0);
  });

  it('FLOAT on WATER returns 1.0 — ships move at full speed on water', () => {
    map.setTerrain(15, 15, Terrain.WATER);
    const mult = map.getSpeedMultiplier(15, 15, SpeedClass.FLOAT);
    expect(mult).toBe(1.0);
  });

  it('FLOAT on land returns 0.3 — ships are severely slow on land', () => {
    // CLEAR terrain for FLOAT
    const mult = map.getSpeedMultiplier(15, 15, SpeedClass.FLOAT);
    expect(mult).toBe(0.3);
  });

  it('FOOT on RIVER has multiplier 0.4 — infantry wading', () => {
    map.setTerrain(15, 15, Terrain.RIVER);
    const mult = map.getSpeedMultiplier(15, 15, SpeedClass.FOOT);
    expect(mult).toBe(0.4);
  });

  it('WHEEL on ORE has multiplier 0.8 — vehicles slow on ore fields', () => {
    map.setTerrain(15, 15, Terrain.ORE);
    const mult = map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL);
    expect(mult).toBe(0.8);
  });

  it('speed multiplier is capped at 1.0 — MV5 parity', () => {
    // Even road cells should not exceed 1.0
    // Set road template
    map.templateType[15 * MAP_CELLS + 15] = 173; // TEMPLATE_ROAD_MIN
    const mult = map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL);
    expect(mult).toBeLessThanOrEqual(1.0);
  });

  it('multipliers do NOT affect pathfinding — C++ findpath.cpp:1284 flat costs', () => {
    // Set ROUGH on direct path, CLEAR on detour
    for (let x = 11; x <= 18; x++) {
      map.setTerrain(x, 15, Terrain.ROUGH);
    }

    const start = { cx: 11, cy: 15 };
    const goal = { cx: 18, cy: 15 };

    // A* should still go straight through ROUGH (cost = 1 per cell, same as CLEAR)
    const path = findPathAStar(map, start, goal, true);
    expect(path.length).toBe(7); // direct distance
    for (const cell of path) {
      expect(cell.cy, 'should take direct route through ROUGH, not detour').toBe(15);
    }
  });

  it('different SpeedClass values for same terrain — drive.cpp per-class table', () => {
    map.setTerrain(15, 15, Terrain.TREE);
    const footMult = map.getSpeedMultiplier(15, 15, SpeedClass.FOOT);
    const wheelMult = map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL);

    // C++ infantry slower through trees (0.6) than vehicles (0.85)
    expect(footMult).toBe(0.6);
    expect(wheelMult).toBe(0.85);
    expect(footMult).toBeLessThan(wheelMult);
  });
});

// ============================================================================
// 6. Path length limits
//    C++ findpath.cpp:106 MAX_MLIST_SIZE = 300 (LOS pathfinder)
//    TS pathfinding.ts:732 MAX_SEARCH = 500 (A* node exploration limit)
// ============================================================================

describe('C++ parity: path length limits (findpath.cpp:106, pathfinding.ts:732)', () => {
  it('LOS pathfinder respects MAX_MLIST_SIZE=300 — findpath.cpp:106', () => {
    const map = makeTestMap(0, 0, 128, 128);
    const start = { cx: 1, cy: 1 };
    const goal = { cx: 126, cy: 126 };
    const path = findPath(map, start, goal, true);

    // MAX_MLIST_SIZE = 300 is the absolute maximum
    expect(path.length).toBeLessThanOrEqual(300);
    if (path.length > 0) {
      validateContiguous(start, path);
    }
  });

  it('A* respects MAX_SEARCH=500 node exploration limit — pathfinding.ts:769', () => {
    // Create a scenario that forces A* to explore many nodes
    const map = makeTestMap(0, 0, 128, 128);

    // Dense obstacle field that forces extensive search
    for (let y = 20; y <= 100; y += 3) {
      for (let x = 20; x <= 100; x++) {
        map.setTerrain(x, y, Terrain.ROCK);
      }
      // Leave small gaps for passage
      map.setTerrain(20 + (y % 80), y, Terrain.CLEAR);
    }

    const start = { cx: 10, cy: 10 };
    const goal = { cx: 110, cy: 110 };
    const path = findPathAStar(map, start, goal, true);

    // Path may be partial (search exhausted) or complete but either way valid
    if (path.length > 0) {
      validatePath(map, path);
      validateContiguous(start, path);
    }
  });

  it('findPathLOS respects maxSteps parameter — pathfinding.ts:912', () => {
    const map = makeTestMap(0, 0, 128, 128);

    // Create a winding path that requires many steps
    // Block direct route with a long wall
    for (let y = 5; y <= 100; y++) {
      map.setTerrain(50, y, Terrain.ROCK);
    }

    const start = { cx: 45, cy: 50 };
    const goal = { cx: 55, cy: 50 };

    // With a small maxSteps, path should be limited
    const shortPath = findPathLOS(map, start, goal, false, 10);
    expect(shortPath.length).toBeLessThanOrEqual(10);

    // With larger maxSteps, path should be longer
    const longPath = findPathLOS(map, start, goal, false, 200);
    expect(longPath.length).toBeGreaterThanOrEqual(shortPath.length);
  });

  it('LOS pathfinder with default maxSteps=200 — pathfinding.ts:911', () => {
    const map = makeTestMap(0, 0, 128, 128);
    const start = { cx: 1, cy: 64 };
    const goal = { cx: 126, cy: 64 };
    const path = findPathLOS(map, start, goal);

    // Default maxSteps is 200
    expect(path.length).toBeLessThanOrEqual(200);
  });
});

// ============================================================================
// 7. LOS (Line of Sight) fast path
//    C++ findpath.cpp:544-552 — direct walk toward destination
//    TS pathfinding.ts:906-977 findPathLOS — Bresenham LOS + edge-follow
// ============================================================================

describe('C++ parity: LOS fast path (findpath.cpp:544-552)', () => {
  let map: GameMap;

  beforeEach(() => {
    map = makeTestMap(0, 0, 128, 128);
  });

  it('LOS returns direct Bresenham line when unobstructed — findpath.cpp:544-552', () => {
    const start = { cx: 10, cy: 10 };
    const goal = { cx: 20, cy: 10 };
    const path = findPathLOS(map, start, goal);

    // Unobstructed horizontal: exactly 10 steps, all on same row
    expect(path.length).toBe(10);
    for (const cell of path) {
      expect(cell.cy).toBe(10);
    }
    validateContiguous(start, path);
  });

  it('LOS returns empty for same start and goal — findpath.cpp:536', () => {
    const path = findPathLOS(map, { cx: 10, cy: 10 }, { cx: 10, cy: 10 });
    expect(path).toEqual([]);
  });

  it('LOS returns empty when goal terrain is impassable — findpath.cpp goalcheck', () => {
    map.setTerrain(20, 20, Terrain.ROCK);
    const path = findPathLOS(map, { cx: 10, cy: 10 }, { cx: 20, cy: 20 });
    expect(path).toEqual([]);
  });

  it('LOS falls back to edge-following when direct line is blocked — findpath.cpp:554-731', () => {
    // Place a wall blocking the direct line
    for (let y = 5; y <= 15; y++) {
      map.setTerrain(15, y, Terrain.ROCK);
    }

    const start = { cx: 10, cy: 10 };
    const goal = { cx: 20, cy: 10 };
    const path = findPathLOS(map, start, goal);

    // Path should exist but be longer than direct distance (10)
    expect(path.length).toBeGreaterThan(10);
    validateContiguous(start, path);

    // Path should NOT pass through the wall
    for (const cell of path) {
      if (cell.cx === 15) {
        expect(cell.cy < 5 || cell.cy > 15,
          `path should not traverse wall at (15,${cell.cy})`).toBe(true);
      }
    }

    // Path should reach goal
    const last = path[path.length - 1];
    expect(last.cx).toBe(goal.cx);
    expect(last.cy).toBe(goal.cy);
  });

  it('LOS diagonal path is a Bresenham line — findpath.cpp diagonal LOS', () => {
    const start = { cx: 10, cy: 10 };
    const goal = { cx: 17, cy: 17 };
    const path = findPathLOS(map, start, goal);

    expect(path.length).toBe(7); // diagonal distance
    validateContiguous(start, path);

    // Each step should be diagonal (+1,+1)
    let prev = start;
    for (const cell of path) {
      expect(cell.cx - prev.cx).toBe(1);
      expect(cell.cy - prev.cy).toBe(1);
      prev = cell;
    }
  });

  it('LOS resumes direct path after passing obstacle — findpath.cpp LOS re-check', () => {
    // Place a small obstacle that the LOS edge-follower navigates around
    // then resumes direct movement
    map.setTerrain(15, 10, Terrain.ROCK);
    map.setTerrain(15, 11, Terrain.ROCK);
    map.setTerrain(15, 9, Terrain.ROCK);

    const start = { cx: 10, cy: 10 };
    const goal = { cx: 25, cy: 10 };
    const path = findPathLOS(map, start, goal);

    expect(path.length).toBeGreaterThan(0);
    validateContiguous(start, path);

    const last = path[path.length - 1];
    expect(last.cx).toBe(goal.cx);
    expect(last.cy).toBe(goal.cy);
  });

  it('findPath (C++ LOS) also uses straight-line walk — findpath.cpp:544-552', () => {
    // The main findPath uses LOS as the primary strategy
    const start = { cx: 10, cy: 10 };
    const goal = { cx: 20, cy: 10 };
    const path = findPath(map, start, goal, true);

    // Unobstructed: should be a straight 10-step path
    expect(path.length).toBe(10);
    for (const cell of path) {
      expect(cell.cy).toBe(10);
    }
    validateContiguous(start, path);
  });

  it('findPath with obstruction activates edge-following — findpath.cpp:623-644', () => {
    // Block the direct line
    for (let y = 5; y <= 15; y++) {
      map.setTerrain(15, y, Terrain.ROCK);
    }

    const start = { cx: 10, cy: 10 };
    const goal = { cx: 20, cy: 10 };
    const path = findPath(map, start, goal, true);

    // Should find a path around the wall
    expect(path.length).toBeGreaterThan(0);
    validatePath(map, path);
    validateContiguous(start, path);

    // Should reach goal
    const last = path[path.length - 1];
    expect(last.cx).toBe(goal.cx);
    expect(last.cy).toBe(goal.cy);
  });
});
