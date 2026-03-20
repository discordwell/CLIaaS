/**
 * C++ Behavioral Parity Tests — Map Terrain (map.ts)
 *
 * Verifies that the GameMap terrain system matches C++ Red Alert behavior:
 *   1. MoveResult enum — Can_Enter_Cell() return values (findpath.cpp)
 *   2. Terrain enum — all terrain types and passability rules (cell.cpp)
 *   3. Passability — isPassable, isTerrainPassable, isWaterPassable, canEnterCell
 *   4. Occupancy grid — entity ID per cell, interaction with pathfinding
 *   5. Wall tracking — overlay wall types (SBAG/FENC/BARB/BRIK)
 *   6. Tree tracking — tree overlay types
 *   7. Bounds — playable area within 128×128 grid
 *   8. Speed multipliers — terrain cost by SpeedClass (drive.cpp Ground[])
 *   9. Line of sight — Bresenham LOS blocking (ROCK/WALL opaque)
 *  10. Visibility/fog of war — shroud/fog/visible states
 *  11. Ore/gem system — overlays, depletion, growth, spread
 *  12. Bridge system — template-based bridge detection/destruction
 *  13. Gap Generator — cell jamming for shroud
 *  14. Decals — scorch marks with FIFO cap
 *  15. Shore detection — land cells adjacent to water
 *  16. Adjacent water cell — naval spawn point discovery
 *
 * Reference: C++ cell.cpp, findpath.cpp, drive.cpp, overlay.cpp, map.cpp
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameMap, MoveResult, Terrain } from '../engine/map';
import { MAP_CELLS, CELL_SIZE, SpeedClass, TEMPLATE_ROAD_MIN, TEMPLATE_ROAD_MAX } from '../engine/types';

let map: GameMap;

beforeEach(() => {
  map = new GameMap();
  // Set a standard playable area (20×20 at offset 10,10)
  map.setBounds(10, 10, 20, 20);
});

// =============================================================================
//  1. MoveResult Enum — C++ Can_Enter_Cell() (findpath.cpp)
// =============================================================================

describe('MoveResult enum values match C++ findpath.cpp', () => {

  it('OK = 0 (fully passable)', () => {
    expect(MoveResult.OK).toBe(0);
  });

  it('CLOAK = 1 (cloaked blocking enemy)', () => {
    expect(MoveResult.CLOAK).toBe(1);
  });

  it('OCCUPIED = 2 (blocked, temporarily)', () => {
    expect(MoveResult.OCCUPIED).toBe(2);
  });

  it('DESTROYABLE = 3 (enemy unit or building blocking)', () => {
    expect(MoveResult.DESTROYABLE).toBe(3);
  });

  it('TEMP_BLOCKED = 4 (friendly unit blocking)', () => {
    expect(MoveResult.TEMP_BLOCKED).toBe(4);
  });

  it('IMPASSABLE = 5 (terrain blocks permanently)', () => {
    expect(MoveResult.IMPASSABLE).toBe(5);
  });

  it('has exactly 6 members (C++ MOVE_COUNT = 6)', () => {
    const numericKeys = Object.keys(MoveResult).filter(k => !isNaN(Number(k)));
    expect(numericKeys.length).toBe(6);
  });
});

// =============================================================================
//  2. Terrain Enum — C++ cell.cpp terrain types
// =============================================================================

describe('Terrain enum values match C++ cell.cpp', () => {

  it('CLEAR = 0', () => expect(Terrain.CLEAR).toBe(0));
  it('ROAD = 1', () => expect(Terrain.ROAD).toBe(1));
  it('WATER = 2', () => expect(Terrain.WATER).toBe(2));
  it('ROCK = 3', () => expect(Terrain.ROCK).toBe(3));
  it('WALL = 4', () => expect(Terrain.WALL).toBe(4));
  it('ORE = 5', () => expect(Terrain.ORE).toBe(5));
  it('BEACH = 6', () => expect(Terrain.BEACH).toBe(6));
  it('ROUGH = 7', () => expect(Terrain.ROUGH).toBe(7));
  it('RIVER = 8', () => expect(Terrain.RIVER).toBe(8));
  it('TREE = 9 (TS extension)', () => expect(Terrain.TREE).toBe(9));

  it('has 10 terrain types (9 C++ + TREE TS extension)', () => {
    const numericKeys = Object.keys(Terrain).filter(k => !isNaN(Number(k)));
    expect(numericKeys.length).toBe(10);
  });
});

// =============================================================================
//  3. Map Grid Basics — 128×128, getTerrain, setTerrain
// =============================================================================

describe('Map grid basics (128×128, C++ MAP_CELL_W)', () => {

  it('MAP_CELLS = 128', () => {
    expect(MAP_CELLS).toBe(128);
  });

  it('constructor fills entire grid with CLEAR', () => {
    const freshMap = new GameMap();
    expect(freshMap.getTerrain(0, 0)).toBe(Terrain.CLEAR);
    expect(freshMap.getTerrain(64, 64)).toBe(Terrain.CLEAR);
    expect(freshMap.getTerrain(127, 127)).toBe(Terrain.CLEAR);
  });

  it('setTerrain / getTerrain round-trip for all terrain types', () => {
    const terrains = [
      Terrain.CLEAR, Terrain.WATER, Terrain.ROCK, Terrain.TREE,
      Terrain.WALL, Terrain.ORE, Terrain.BEACH, Terrain.ROUGH, Terrain.RIVER,
    ];
    terrains.forEach((t, i) => {
      map.setTerrain(15 + i, 15, t);
      expect(map.getTerrain(15 + i, 15)).toBe(t);
    });
  });

  it('getTerrain returns ROCK for out-of-bounds (negative x)', () => {
    expect(map.getTerrain(-1, 0)).toBe(Terrain.ROCK);
  });

  it('getTerrain returns ROCK for out-of-bounds (negative y)', () => {
    expect(map.getTerrain(0, -1)).toBe(Terrain.ROCK);
  });

  it('getTerrain returns ROCK for out-of-bounds (x >= MAP_CELLS)', () => {
    expect(map.getTerrain(128, 0)).toBe(Terrain.ROCK);
  });

  it('getTerrain returns ROCK for out-of-bounds (y >= MAP_CELLS)', () => {
    expect(map.getTerrain(0, 128)).toBe(Terrain.ROCK);
  });

  it('setTerrain silently ignores out-of-bounds writes', () => {
    map.setTerrain(-1, 0, Terrain.WATER);
    map.setTerrain(0, -1, Terrain.WATER);
    map.setTerrain(128, 0, Terrain.WATER);
    map.setTerrain(0, 128, Terrain.WATER);
    // Should not throw, and grid should be unchanged at edges
    expect(map.getTerrain(0, 0)).toBe(Terrain.CLEAR);
  });
});

// =============================================================================
//  4. Bounds — setBounds, inBounds (map.cpp playable area)
// =============================================================================

describe('Bounds — playable area within 128×128 grid', () => {

  it('default bounds are 0,0 to 128,128 (full grid)', () => {
    const freshMap = new GameMap();
    expect(freshMap.inBounds(0, 0)).toBe(true);
    expect(freshMap.inBounds(127, 127)).toBe(true);
  });

  it('setBounds constrains the playable area', () => {
    expect(map.inBounds(10, 10)).toBe(true);
    expect(map.inBounds(29, 29)).toBe(true);
    expect(map.inBounds(9, 10)).toBe(false);
    expect(map.inBounds(10, 9)).toBe(false);
    expect(map.inBounds(30, 10)).toBe(false);
    expect(map.inBounds(10, 30)).toBe(false);
  });

  it('inBounds is exclusive on upper edge (cx < boundsX + boundsW)', () => {
    // Bounds: x=10, w=20 → valid range is [10, 29]
    expect(map.inBounds(29, 15)).toBe(true);
    expect(map.inBounds(30, 15)).toBe(false);
  });

  it('inBounds is inclusive on lower edge (cx >= boundsX)', () => {
    expect(map.inBounds(10, 15)).toBe(true);
    expect(map.inBounds(9, 15)).toBe(false);
  });
});

// =============================================================================
//  5. Passability — isPassable (cell.cpp terrain check + bounds)
// =============================================================================

describe('isPassable — terrain + bounds check (C++ Is_Passable)', () => {

  it('CLEAR terrain in bounds is passable', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    expect(map.isPassable(15, 15)).toBe(true);
  });

  it('ORE terrain in bounds is passable', () => {
    map.setTerrain(15, 15, Terrain.ORE);
    expect(map.isPassable(15, 15)).toBe(true);
  });

  it('ROUGH terrain in bounds is passable', () => {
    map.setTerrain(15, 15, Terrain.ROUGH);
    expect(map.isPassable(15, 15)).toBe(true);
  });

  it('BEACH terrain in bounds is passable', () => {
    map.setTerrain(15, 15, Terrain.BEACH);
    expect(map.isPassable(15, 15)).toBe(true);
  });

  it('WATER terrain is NOT passable to land units', () => {
    map.setTerrain(15, 15, Terrain.WATER);
    expect(map.isPassable(15, 15)).toBe(false);
  });

  it('ROCK terrain is NOT passable', () => {
    map.setTerrain(15, 15, Terrain.ROCK);
    expect(map.isPassable(15, 15)).toBe(false);
  });

  it('TREE terrain IS passable (C++ parity: trees are TerrainClass on CLEAR ground)', () => {
    map.setTerrain(15, 15, Terrain.TREE);
    expect(map.isPassable(15, 15)).toBe(true);
  });

  it('WALL terrain is NOT passable', () => {
    map.setTerrain(15, 15, Terrain.WALL);
    expect(map.isPassable(15, 15)).toBe(false);
  });

  it('RIVER terrain is NOT passable', () => {
    map.setTerrain(15, 15, Terrain.RIVER);
    expect(map.isPassable(15, 15)).toBe(false);
  });

  it('CLEAR terrain outside bounds is NOT passable', () => {
    map.setTerrain(5, 5, Terrain.CLEAR);
    expect(map.isPassable(5, 5)).toBe(false);
  });

  it('passability respects bounds boundary with 1-cell extension (C++ parity)', () => {
    // Just inside bounds
    map.setTerrain(10, 10, Terrain.CLEAR);
    expect(map.isPassable(10, 10)).toBe(true);
    // C++ parity: pathfinding extends 1 cell beyond map bounds,
    // so (9, 10) is passable (boundsX-1 = 9)
    map.setTerrain(9, 10, Terrain.CLEAR);
    expect(map.isPassable(9, 10)).toBe(true);
    // 2 cells outside bounds is NOT passable
    map.setTerrain(8, 10, Terrain.CLEAR);
    expect(map.isPassable(8, 10)).toBe(false);
  });
});

// =============================================================================
//  6. isTerrainPassable — terrain only, ignores bounds (C++ parity)
// =============================================================================

describe('isTerrainPassable — terrain-only check, ignores bounds', () => {

  it('CLEAR is terrain-passable', () => {
    expect(map.isTerrainPassable(5, 5)).toBe(true); // even outside bounds
  });

  it('ORE is terrain-passable', () => {
    map.setTerrain(5, 5, Terrain.ORE);
    expect(map.isTerrainPassable(5, 5)).toBe(true);
  });

  it('ROUGH is terrain-passable', () => {
    map.setTerrain(5, 5, Terrain.ROUGH);
    expect(map.isTerrainPassable(5, 5)).toBe(true);
  });

  it('BEACH is terrain-passable', () => {
    map.setTerrain(5, 5, Terrain.BEACH);
    expect(map.isTerrainPassable(5, 5)).toBe(true);
  });

  it('WATER is NOT terrain-passable (land units)', () => {
    map.setTerrain(5, 5, Terrain.WATER);
    expect(map.isTerrainPassable(5, 5)).toBe(false);
  });

  it('ROCK is NOT terrain-passable', () => {
    map.setTerrain(5, 5, Terrain.ROCK);
    expect(map.isTerrainPassable(5, 5)).toBe(false);
  });

  it('TREE IS terrain-passable (C++ parity: trees are TerrainClass on CLEAR ground)', () => {
    map.setTerrain(5, 5, Terrain.TREE);
    expect(map.isTerrainPassable(5, 5)).toBe(true);
  });

  it('WALL is NOT terrain-passable', () => {
    map.setTerrain(5, 5, Terrain.WALL);
    expect(map.isTerrainPassable(5, 5)).toBe(false);
  });

  it('RIVER is NOT terrain-passable', () => {
    map.setTerrain(5, 5, Terrain.RIVER);
    expect(map.isTerrainPassable(5, 5)).toBe(false);
  });

  it('out-of-grid returns ROCK (impassable) via getTerrain', () => {
    expect(map.isTerrainPassable(-1, -1)).toBe(false);
    expect(map.isTerrainPassable(128, 128)).toBe(false);
  });
});

// =============================================================================
//  7. isWaterPassable — naval unit passability (C++ cell.cpp)
// =============================================================================

describe('isWaterPassable — naval passability (cell.cpp)', () => {

  it('WATER terrain in bounds is water-passable', () => {
    map.setTerrain(15, 15, Terrain.WATER);
    expect(map.isWaterPassable(15, 15)).toBe(true);
  });

  it('CLEAR terrain is NOT water-passable', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    expect(map.isWaterPassable(15, 15)).toBe(false);
  });

  it('ROCK terrain is NOT water-passable', () => {
    map.setTerrain(15, 15, Terrain.ROCK);
    expect(map.isWaterPassable(15, 15)).toBe(false);
  });

  it('RIVER terrain is NOT water-passable (rivers ≠ water)', () => {
    map.setTerrain(15, 15, Terrain.RIVER);
    expect(map.isWaterPassable(15, 15)).toBe(false);
  });

  it('WATER outside bounds is NOT water-passable', () => {
    map.setTerrain(5, 5, Terrain.WATER);
    expect(map.isWaterPassable(5, 5)).toBe(false);
  });
});

// =============================================================================
//  8. canEnterCell — PF3 (C++ Can_Enter_Cell, findpath.cpp)
// =============================================================================

describe('canEnterCell — C++ Can_Enter_Cell() for pathfinding (findpath.cpp)', () => {

  // -- Terrain checks (land units) --

  it('CLEAR cell in bounds → MoveResult.OK', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    expect(map.canEnterCell(15, 15)).toBe(MoveResult.OK);
  });

  it('ORE cell in bounds → MoveResult.OK', () => {
    map.setTerrain(15, 15, Terrain.ORE);
    expect(map.canEnterCell(15, 15)).toBe(MoveResult.OK);
  });

  it('ROUGH cell in bounds → MoveResult.OK', () => {
    map.setTerrain(15, 15, Terrain.ROUGH);
    expect(map.canEnterCell(15, 15)).toBe(MoveResult.OK);
  });

  it('BEACH cell in bounds → MoveResult.OK', () => {
    map.setTerrain(15, 15, Terrain.BEACH);
    expect(map.canEnterCell(15, 15)).toBe(MoveResult.OK);
  });

  it('ROCK cell → MoveResult.IMPASSABLE', () => {
    map.setTerrain(15, 15, Terrain.ROCK);
    expect(map.canEnterCell(15, 15)).toBe(MoveResult.IMPASSABLE);
  });

  it('WALL cell → MoveResult.IMPASSABLE', () => {
    map.setTerrain(15, 15, Terrain.WALL);
    expect(map.canEnterCell(15, 15)).toBe(MoveResult.IMPASSABLE);
  });

  it('TREE cell → MoveResult.OK (C++ parity: trees are TerrainClass on CLEAR ground)', () => {
    map.setTerrain(15, 15, Terrain.TREE);
    expect(map.canEnterCell(15, 15)).toBe(MoveResult.OK);
  });

  it('WATER cell (land unit) → MoveResult.IMPASSABLE', () => {
    map.setTerrain(15, 15, Terrain.WATER);
    expect(map.canEnterCell(15, 15)).toBe(MoveResult.IMPASSABLE);
  });

  it('RIVER cell → MoveResult.IMPASSABLE', () => {
    map.setTerrain(15, 15, Terrain.RIVER);
    expect(map.canEnterCell(15, 15)).toBe(MoveResult.IMPASSABLE);
  });

  // -- Out-of-bounds --

  it('cell outside bounds → MoveResult.IMPASSABLE', () => {
    map.setTerrain(5, 5, Terrain.CLEAR);
    expect(map.canEnterCell(5, 5)).toBe(MoveResult.IMPASSABLE);
  });

  // -- Naval mode --

  it('WATER cell with naval=true → MoveResult.OK', () => {
    map.setTerrain(15, 15, Terrain.WATER);
    expect(map.canEnterCell(15, 15, true)).toBe(MoveResult.OK);
  });

  it('CLEAR cell with naval=true → MoveResult.IMPASSABLE (ships can\'t go on land)', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    expect(map.canEnterCell(15, 15, true)).toBe(MoveResult.IMPASSABLE);
  });

  it('ROCK cell with naval=true → MoveResult.IMPASSABLE', () => {
    map.setTerrain(15, 15, Terrain.ROCK);
    expect(map.canEnterCell(15, 15, true)).toBe(MoveResult.IMPASSABLE);
  });

  // -- Occupancy interaction --

  it('occupied cell with stationary unit → MoveResult.OCCUPIED', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    map.setOccupancy(15, 15, 42); // entity ID 42
    expect(map.canEnterCell(15, 15)).toBe(MoveResult.OCCUPIED);
  });

  it('occupied cell with moving unit → MoveResult.TEMP_BLOCKED', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    map.setOccupancy(15, 15, 42);
    const isMoving = (id: number) => id === 42;
    expect(map.canEnterCell(15, 15, false, isMoving)).toBe(MoveResult.TEMP_BLOCKED);
  });

  it('occupied cell with stationary unit (isMoving returns false) → MoveResult.OCCUPIED', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    map.setOccupancy(15, 15, 42);
    const isMoving = (_id: number) => false;
    expect(map.canEnterCell(15, 15, false, isMoving)).toBe(MoveResult.OCCUPIED);
  });

  it('no isMoving callback and occupied → MoveResult.OCCUPIED (default)', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    map.setOccupancy(15, 15, 42);
    expect(map.canEnterCell(15, 15, false)).toBe(MoveResult.OCCUPIED);
  });

  it('terrain check takes priority over occupancy (impassable terrain → IMPASSABLE even if occupied)', () => {
    map.setTerrain(15, 15, Terrain.ROCK);
    map.setOccupancy(15, 15, 42);
    expect(map.canEnterCell(15, 15)).toBe(MoveResult.IMPASSABLE);
  });

  it('occupancy ID 0 means empty — returns OK', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    map.setOccupancy(15, 15, 0);
    expect(map.canEnterCell(15, 15)).toBe(MoveResult.OK);
  });

  // -- Naval occupancy --

  it('occupied water cell (naval) → MoveResult.OCCUPIED', () => {
    map.setTerrain(15, 15, Terrain.WATER);
    map.setOccupancy(15, 15, 99);
    expect(map.canEnterCell(15, 15, true)).toBe(MoveResult.OCCUPIED);
  });

  it('occupied water cell with moving naval unit → MoveResult.TEMP_BLOCKED', () => {
    map.setTerrain(15, 15, Terrain.WATER);
    map.setOccupancy(15, 15, 99);
    expect(map.canEnterCell(15, 15, true, (id) => id === 99)).toBe(MoveResult.TEMP_BLOCKED);
  });
});

// =============================================================================
//  9. Occupancy Grid — setOccupancy, getOccupancy (cell.cpp)
// =============================================================================

describe('Occupancy grid — entity ID per cell (cell.cpp)', () => {

  it('default occupancy is 0 (empty) everywhere', () => {
    expect(map.getOccupancy(15, 15)).toBe(0);
    expect(map.getOccupancy(0, 0)).toBe(0);
    expect(map.getOccupancy(127, 127)).toBe(0);
  });

  it('setOccupancy / getOccupancy round-trip', () => {
    map.setOccupancy(15, 15, 42);
    expect(map.getOccupancy(15, 15)).toBe(42);
  });

  it('clearing occupancy by setting to 0', () => {
    map.setOccupancy(15, 15, 42);
    map.setOccupancy(15, 15, 0);
    expect(map.getOccupancy(15, 15)).toBe(0);
  });

  it('getOccupancy returns -1 for out-of-bounds (negative coords)', () => {
    expect(map.getOccupancy(-1, 0)).toBe(-1);
    expect(map.getOccupancy(0, -1)).toBe(-1);
  });

  it('getOccupancy returns -1 for out-of-bounds (>= MAP_CELLS)', () => {
    expect(map.getOccupancy(128, 0)).toBe(-1);
    expect(map.getOccupancy(0, 128)).toBe(-1);
  });

  it('setOccupancy silently ignores out-of-bounds writes', () => {
    map.setOccupancy(-1, 0, 99);
    map.setOccupancy(128, 0, 99);
    // No crash, edges unaffected
    expect(map.getOccupancy(0, 0)).toBe(0);
    expect(map.getOccupancy(127, 0)).toBe(0);
  });

  it('occupancy grid is independent per cell', () => {
    map.setOccupancy(15, 15, 1);
    map.setOccupancy(16, 15, 2);
    map.setOccupancy(15, 16, 3);
    expect(map.getOccupancy(15, 15)).toBe(1);
    expect(map.getOccupancy(16, 15)).toBe(2);
    expect(map.getOccupancy(15, 16)).toBe(3);
    expect(map.getOccupancy(16, 16)).toBe(0); // untouched neighbor
  });

  it('occupancy uses Int32Array (supports large entity IDs)', () => {
    map.setOccupancy(15, 15, 100000);
    expect(map.getOccupancy(15, 15)).toBe(100000);
  });
});

// =============================================================================
//  10. Wall Tracking — getWallType, setWallType, clearWallType (cell.cpp overlay)
// =============================================================================

describe('Wall tracking — overlay wall types (cell.cpp)', () => {

  it('default wall type is empty string (no wall)', () => {
    expect(map.getWallType(15, 15)).toBe('');
  });

  it('setWallType / getWallType round-trip for SBAG', () => {
    map.setWallType(15, 15, 'SBAG');
    expect(map.getWallType(15, 15)).toBe('SBAG');
  });

  it('setWallType / getWallType round-trip for FENC', () => {
    map.setWallType(15, 15, 'FENC');
    expect(map.getWallType(15, 15)).toBe('FENC');
  });

  it('setWallType / getWallType round-trip for BARB', () => {
    map.setWallType(15, 15, 'BARB');
    expect(map.getWallType(15, 15)).toBe('BARB');
  });

  it('setWallType / getWallType round-trip for BRIK', () => {
    map.setWallType(15, 15, 'BRIK');
    expect(map.getWallType(15, 15)).toBe('BRIK');
  });

  it('clearWallType removes the wall', () => {
    map.setWallType(15, 15, 'BRIK');
    map.clearWallType(15, 15);
    expect(map.getWallType(15, 15)).toBe('');
  });

  it('overwriting wall type replaces previous', () => {
    map.setWallType(15, 15, 'SBAG');
    map.setWallType(15, 15, 'BRIK');
    expect(map.getWallType(15, 15)).toBe('BRIK');
  });

  it('getWallType returns empty string for out-of-bounds', () => {
    expect(map.getWallType(-1, 0)).toBe('');
    expect(map.getWallType(128, 0)).toBe('');
    expect(map.getWallType(0, -1)).toBe('');
    expect(map.getWallType(0, 128)).toBe('');
  });

  it('setWallType silently ignores out-of-bounds writes', () => {
    map.setWallType(-1, 0, 'BRIK');
    map.setWallType(128, 0, 'BRIK');
    // No crash, edges unaffected
    expect(map.getWallType(0, 0)).toBe('');
  });

  it('clearWallType silently ignores out-of-bounds', () => {
    // Should not throw
    map.clearWallType(-1, 0);
    map.clearWallType(128, 0);
  });

  it('wall types are independent per cell', () => {
    map.setWallType(15, 15, 'SBAG');
    map.setWallType(16, 15, 'BRIK');
    expect(map.getWallType(15, 15)).toBe('SBAG');
    expect(map.getWallType(16, 15)).toBe('BRIK');
    expect(map.getWallType(17, 15)).toBe('');
  });
});

// =============================================================================
//  11. Tree Tracking — getTreeType, setTreeType, clearTreeType
// =============================================================================

describe('Tree tracking — tree overlay types', () => {

  it('default tree type is empty string (no tree)', () => {
    expect(map.getTreeType(15, 15)).toBe('');
  });

  it('setTreeType / getTreeType round-trip', () => {
    map.setTreeType(15, 15, 't01');
    expect(map.getTreeType(15, 15)).toBe('t01');
  });

  it('supports tree clump type (tc01-tc05)', () => {
    map.setTreeType(15, 15, 'tc03');
    expect(map.getTreeType(15, 15)).toBe('tc03');
  });

  it('supports _clump marker', () => {
    map.setTreeType(15, 15, '_clump');
    expect(map.getTreeType(15, 15)).toBe('_clump');
  });

  it('clearTreeType removes the tree', () => {
    map.setTreeType(15, 15, 't05');
    map.clearTreeType(15, 15);
    expect(map.getTreeType(15, 15)).toBe('');
  });

  it('getTreeType returns empty string for out-of-bounds', () => {
    expect(map.getTreeType(-1, 0)).toBe('');
    expect(map.getTreeType(128, 0)).toBe('');
  });

  it('setTreeType silently ignores out-of-bounds writes', () => {
    map.setTreeType(-1, 0, 't01');
    map.setTreeType(128, 0, 't01');
    expect(map.getTreeType(0, 0)).toBe('');
  });

  it('clearTreeType silently ignores out-of-bounds', () => {
    map.clearTreeType(-1, 0);
    map.clearTreeType(128, 0);
  });
});

// =============================================================================
//  12. Speed Multipliers — getSpeedMultiplier (C++ drive.cpp Ground[])
// =============================================================================

describe('Speed multipliers — C++ drive.cpp Ground[] cost tables', () => {

  // -- WHEEL (default, all vehicles) --

  it('WHEEL: CLEAR = 0.60 (C++ RULES.INI)', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL)).toBe(0.60);
  });

  it('WHEEL: RIVER = 0.0 (C++ RULES.INI impassable)', () => {
    map.setTerrain(15, 15, Terrain.RIVER);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL)).toBe(0.0);
  });

  it('WHEEL: BEACH = 0.40 (C++ RULES.INI)', () => {
    map.setTerrain(15, 15, Terrain.BEACH);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL)).toBe(0.40);
  });

  it('WHEEL: ROUGH = 0.40 (C++ RULES.INI)', () => {
    map.setTerrain(15, 15, Terrain.ROUGH);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL)).toBe(0.40);
  });

  it('WHEEL: ORE = 0.50 (C++ RULES.INI)', () => {
    map.setTerrain(15, 15, Terrain.ORE);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL)).toBe(0.50);
  });

  it('WHEEL: TREE = 0.0 (TREE maps to Rock, impassable)', () => {
    map.setTerrain(15, 15, Terrain.TREE);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL)).toBe(0.0);
  });

  it('WHEEL: road template = 1.0', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    map.templateType[15 * MAP_CELLS + 15] = TEMPLATE_ROAD_MIN;
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL)).toBe(1.0);
  });

  // -- FOOT (infantry) --

  it('FOOT: CLEAR = 0.90 (C++ RULES.INI)', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.FOOT)).toBe(0.90);
  });

  it('FOOT: RIVER = 0.0 (C++ RULES.INI impassable)', () => {
    map.setTerrain(15, 15, Terrain.RIVER);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.FOOT)).toBe(0.0);
  });

  it('FOOT: BEACH = 0.80 (C++ RULES.INI)', () => {
    map.setTerrain(15, 15, Terrain.BEACH);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.FOOT)).toBe(0.80);
  });

  it('FOOT: ROUGH = 0.80 (C++ RULES.INI)', () => {
    map.setTerrain(15, 15, Terrain.ROUGH);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.FOOT)).toBe(0.80);
  });

  it('FOOT: ORE = 0.90 (C++ RULES.INI)', () => {
    map.setTerrain(15, 15, Terrain.ORE);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.FOOT)).toBe(0.90);
  });

  it('FOOT: TREE = 0.0 (TREE maps to Rock, impassable)', () => {
    map.setTerrain(15, 15, Terrain.TREE);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.FOOT)).toBe(0.0);
  });

  it('FOOT: road template = 1.0', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    map.templateType[15 * MAP_CELLS + 15] = TEMPLATE_ROAD_MAX;
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.FOOT)).toBe(1.0);
  });

  // -- WINGED (aircraft) --

  it('WINGED: ignores terrain entirely — always 1.0', () => {
    const terrains = [
      Terrain.CLEAR, Terrain.WATER, Terrain.ROCK, Terrain.TREE,
      Terrain.WALL, Terrain.ORE, Terrain.BEACH, Terrain.ROUGH, Terrain.RIVER,
    ];
    terrains.forEach(t => {
      map.setTerrain(15, 15, t);
      expect(map.getSpeedMultiplier(15, 15, SpeedClass.WINGED)).toBe(1.0);
    });
  });

  // -- FLOAT (ships) --

  it('FLOAT: WATER = 1.0', () => {
    map.setTerrain(15, 15, Terrain.WATER);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.FLOAT)).toBe(1.0);
  });

  it('FLOAT: non-water terrain = 0.0 (C++ RULES.INI impassable)', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.FLOAT)).toBe(0.0);
  });

  // -- MV5: Cap at 1.0 --

  it('MV5: all multipliers capped at 1.0 — roads cannot exceed base speed', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    map.templateType[15 * MAP_CELLS + 15] = TEMPLATE_ROAD_MIN + 5; // A road template
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL)).toBeLessThanOrEqual(1.0);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.FOOT)).toBeLessThanOrEqual(1.0);
  });

  // -- Out of bounds --

  it('out-of-bounds returns 1.0', () => {
    expect(map.getSpeedMultiplier(-1, -1, SpeedClass.WHEEL)).toBe(1.0);
    expect(map.getSpeedMultiplier(128, 128, SpeedClass.FOOT)).toBe(1.0);
  });

  // -- Default speedClass --

  it('defaults to WHEEL if no speedClass provided', () => {
    map.setTerrain(15, 15, Terrain.ORE);
    expect(map.getSpeedMultiplier(15, 15)).toBe(0.50); // WHEEL ore speed (C++ RULES.INI)
  });

  // -- Road template range --

  it('road templates span TEMPLATE_ROAD_MIN to TEMPLATE_ROAD_MAX', () => {
    expect(TEMPLATE_ROAD_MIN).toBe(173);
    expect(TEMPLATE_ROAD_MAX).toBe(228);
  });

  it('template just below road range is NOT a road', () => {
    map.setTerrain(15, 15, Terrain.ROUGH);
    map.templateType[15 * MAP_CELLS + 15] = TEMPLATE_ROAD_MIN - 1;
    // Without road, ROUGH WHEEL = 0.40 (C++ RULES.INI)
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL)).toBe(0.40);
  });

  it('template just above road range is NOT a road', () => {
    map.setTerrain(15, 15, Terrain.ROUGH);
    map.templateType[15 * MAP_CELLS + 15] = TEMPLATE_ROAD_MAX + 1;
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL)).toBe(0.40);
  });

  // -- FOOT vs WHEEL difference on TREE --

  it('TREE terrain is impassable (maps to Rock speeds, all 0.0)', () => {
    map.setTerrain(15, 15, Terrain.TREE);
    const footSpeed = map.getSpeedMultiplier(15, 15, SpeedClass.FOOT);
    const wheelSpeed = map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL);
    expect(footSpeed).toBe(0.0);
    expect(wheelSpeed).toBe(0.0);
  });
});

// =============================================================================
//  13. Shore Detection — isShoreCell (cell.cpp)
// =============================================================================

describe('isShoreCell — land cell adjacent to water (cell.cpp)', () => {

  it('passable cell adjacent to water on east → shore', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    map.setTerrain(16, 15, Terrain.WATER);
    expect(map.isShoreCell(15, 15)).toBe(true);
  });

  it('passable cell adjacent to water on west → shore', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    map.setTerrain(14, 15, Terrain.WATER);
    expect(map.isShoreCell(15, 15)).toBe(true);
  });

  it('passable cell adjacent to water on north → shore', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    map.setTerrain(15, 14, Terrain.WATER);
    expect(map.isShoreCell(15, 15)).toBe(true);
  });

  it('passable cell adjacent to water on south → shore', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    map.setTerrain(15, 16, Terrain.WATER);
    expect(map.isShoreCell(15, 15)).toBe(true);
  });

  it('passable cell adjacent to water diagonally (NE) → shore', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    map.setTerrain(16, 14, Terrain.WATER);
    expect(map.isShoreCell(15, 15)).toBe(true);
  });

  it('passable cell with no adjacent water → NOT shore', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    // All neighbors are clear (default)
    expect(map.isShoreCell(15, 15)).toBe(false);
  });

  it('water cell is NOT a shore cell (shore must be passable land)', () => {
    map.setTerrain(15, 15, Terrain.WATER);
    map.setTerrain(16, 15, Terrain.WATER);
    expect(map.isShoreCell(15, 15)).toBe(false);
  });

  it('impassable cell adjacent to water is NOT a shore cell', () => {
    map.setTerrain(15, 15, Terrain.ROCK);
    map.setTerrain(16, 15, Terrain.WATER);
    expect(map.isShoreCell(15, 15)).toBe(false);
  });

  it('cell outside bounds is NOT a shore cell (isPassable fails)', () => {
    map.setTerrain(5, 5, Terrain.CLEAR);
    map.setTerrain(6, 5, Terrain.WATER);
    expect(map.isShoreCell(5, 5)).toBe(false);
  });
});

// =============================================================================
//  14. Line of Sight — hasLineOfSight (Bresenham, map.cpp)
// =============================================================================

describe('hasLineOfSight — Bresenham LOS (map.cpp)', () => {

  it('adjacent cells always have LOS', () => {
    expect(map.hasLineOfSight(15, 15, 16, 15)).toBe(true);
    expect(map.hasLineOfSight(15, 15, 15, 16)).toBe(true);
    expect(map.hasLineOfSight(15, 15, 16, 16)).toBe(true);
  });

  it('same cell has LOS to itself', () => {
    expect(map.hasLineOfSight(15, 15, 15, 15)).toBe(true);
  });

  it('clear path over distance has LOS', () => {
    // All cells between (15,15) and (20,15) are clear
    expect(map.hasLineOfSight(15, 15, 20, 15)).toBe(true);
  });

  it('ROCK in the path blocks LOS', () => {
    map.setTerrain(17, 15, Terrain.ROCK);
    expect(map.hasLineOfSight(15, 15, 20, 15)).toBe(false);
  });

  it('WALL in the path blocks LOS', () => {
    map.setTerrain(17, 15, Terrain.WALL);
    expect(map.hasLineOfSight(15, 15, 20, 15)).toBe(false);
  });

  it('WATER in the path does NOT block LOS (transparent)', () => {
    map.setTerrain(17, 15, Terrain.WATER);
    expect(map.hasLineOfSight(15, 15, 20, 15)).toBe(true);
  });

  it('TREE in the path does NOT block LOS (transparent)', () => {
    map.setTerrain(17, 15, Terrain.TREE);
    expect(map.hasLineOfSight(15, 15, 20, 15)).toBe(true);
  });

  it('ROCK at destination does NOT block LOS (only intermediates checked)', () => {
    map.setTerrain(20, 15, Terrain.ROCK);
    expect(map.hasLineOfSight(15, 15, 20, 15)).toBe(true);
  });

  it('ROCK at source does NOT block LOS (only intermediates checked)', () => {
    map.setTerrain(15, 15, Terrain.ROCK);
    expect(map.hasLineOfSight(15, 15, 20, 15)).toBe(true);
  });

  it('diagonal LOS blocked by WALL on the line', () => {
    map.setTerrain(17, 17, Terrain.WALL);
    expect(map.hasLineOfSight(15, 15, 19, 19)).toBe(false);
  });

  it('diagonal LOS unblocked if WALL is off the line', () => {
    map.setTerrain(17, 16, Terrain.WALL); // off the diagonal
    expect(map.hasLineOfSight(15, 15, 19, 19)).toBe(true);
  });

  it('reverse direction LOS matches forward', () => {
    map.setTerrain(17, 15, Terrain.ROCK);
    expect(map.hasLineOfSight(20, 15, 15, 15)).toBe(false);
  });
});

// =============================================================================
//  15. Visibility / Fog of War — shroud/fog/visible (map.cpp)
// =============================================================================

describe('Visibility — fog of war states (map.cpp)', () => {

  it('default visibility is 0 (shroud) everywhere', () => {
    expect(map.getVisibility(15, 15)).toBe(0);
    expect(map.getVisibility(0, 0)).toBe(0);
  });

  it('setVisibility / getVisibility round-trip', () => {
    map.setVisibility(15, 15, 2);
    expect(map.getVisibility(15, 15)).toBe(2);
  });

  it('visibility states: 0=shroud, 1=fog, 2=visible', () => {
    map.setVisibility(15, 15, 0);
    expect(map.getVisibility(15, 15)).toBe(0);
    map.setVisibility(15, 15, 1);
    expect(map.getVisibility(15, 15)).toBe(1);
    map.setVisibility(15, 15, 2);
    expect(map.getVisibility(15, 15)).toBe(2);
  });

  it('getVisibility returns 0 for out-of-bounds', () => {
    expect(map.getVisibility(-1, 0)).toBe(0);
    expect(map.getVisibility(128, 0)).toBe(0);
    expect(map.getVisibility(0, -1)).toBe(0);
    expect(map.getVisibility(0, 128)).toBe(0);
  });

  it('setVisibility silently ignores out-of-bounds', () => {
    map.setVisibility(-1, 0, 2);
    map.setVisibility(128, 0, 2);
    expect(map.getVisibility(0, 0)).toBe(0); // edge unaffected
  });

  it('revealAll sets every cell to visible (2)', () => {
    map.revealAll();
    expect(map.getVisibility(0, 0)).toBe(2);
    expect(map.getVisibility(64, 64)).toBe(2);
    expect(map.getVisibility(127, 127)).toBe(2);
  });

  it('creepShadow downgrades all visible/fog cells back to shroud (0)', () => {
    map.revealAll();
    expect(map.getVisibility(15, 15)).toBe(2);
    map.creepShadow();
    expect(map.getVisibility(15, 15)).toBe(0);
    expect(map.getVisibility(64, 64)).toBe(0);
  });

  it('creepShadow does not affect already-shrouded cells', () => {
    map.setVisibility(15, 15, 0);
    map.creepShadow();
    expect(map.getVisibility(15, 15)).toBe(0);
  });
});

// =============================================================================
//  16. Fog of War Update — updateFogOfWar (map.cpp)
// =============================================================================

describe('updateFogOfWar — reveals around units with sight range', () => {

  it('reveals cells within sight range of a unit', () => {
    const unitX = 15 * CELL_SIZE + CELL_SIZE / 2;
    const unitY = 15 * CELL_SIZE + CELL_SIZE / 2;
    map.updateFogOfWar([{ x: unitX, y: unitY, sight: 3 }]);
    // Cell at unit position should be visible
    expect(map.getVisibility(15, 15)).toBe(2);
    // Adjacent cell should be visible
    expect(map.getVisibility(16, 15)).toBe(2);
  });

  it('does not reveal cells outside sight range', () => {
    const unitX = 15 * CELL_SIZE + CELL_SIZE / 2;
    const unitY = 15 * CELL_SIZE + CELL_SIZE / 2;
    map.updateFogOfWar([{ x: unitX, y: unitY, sight: 2 }]);
    // Cell far away should remain shroud
    expect(map.getVisibility(25, 25)).toBe(0);
  });

  it('downgrades previously visible cells to fog (1) before revealing', () => {
    const unitX = 15 * CELL_SIZE + CELL_SIZE / 2;
    const unitY = 15 * CELL_SIZE + CELL_SIZE / 2;
    // First reveal
    map.updateFogOfWar([{ x: unitX, y: unitY, sight: 2 }]);
    expect(map.getVisibility(15, 15)).toBe(2);

    // Move unit away — old position should become fog
    const newX = 25 * CELL_SIZE + CELL_SIZE / 2;
    const newY = 25 * CELL_SIZE + CELL_SIZE / 2;
    map.updateFogOfWar([{ x: newX, y: newY, sight: 2 }]);
    expect(map.getVisibility(15, 15)).toBe(1); // fog, not shroud
    expect(map.getVisibility(25, 25)).toBe(2); // new position visible
  });

  it('sight range uses circular (squared distance) check', () => {
    const unitX = 20 * CELL_SIZE + CELL_SIZE / 2;
    const unitY = 20 * CELL_SIZE + CELL_SIZE / 2;
    map.updateFogOfWar([{ x: unitX, y: unitY, sight: 3 }]);
    // (3,0) is within range (9 <= 9)
    expect(map.getVisibility(23, 20)).toBe(2);
    // (3,1) distance = 9+1=10 > 9 — outside circle
    expect(map.getVisibility(23, 21)).toBe(0);
  });

  it('ROCK blocks line of sight — cell behind ROCK not revealed', () => {
    map.setTerrain(17, 15, Terrain.ROCK);
    const unitX = 15 * CELL_SIZE + CELL_SIZE / 2;
    const unitY = 15 * CELL_SIZE + CELL_SIZE / 2;
    map.updateFogOfWar([{ x: unitX, y: unitY, sight: 5 }]);
    // Cell right behind the rock along the line should not be visible
    expect(map.getVisibility(18, 15)).toBe(0);
  });

  it('empty units array only downgrades — no reveals', () => {
    // C++ parity: any cell at visibility=2 gets downgraded when no unit can see it,
    // regardless of HOW it became visible (setVisibility, reveal cheat, etc.)
    map.setVisibility(15, 15, 2);
    map.updateFogOfWar([]);
    expect(map.getVisibility(15, 15)).toBe(1); // downgraded to fog
  });
});

// =============================================================================
//  17. Decals — addDecal with FIFO cap (map.cpp)
// =============================================================================

describe('Decals — scorch marks with FIFO cap at 200', () => {

  it('addDecal adds a decal entry', () => {
    map.addDecal(15, 15, 2, 0.8);
    expect(map.decals.length).toBe(1);
    expect(map.decals[0]).toEqual({ cx: 15, cy: 15, size: 2, alpha: 0.8 });
  });

  it('multiple decals accumulate', () => {
    map.addDecal(15, 15, 1, 0.5);
    map.addDecal(16, 16, 2, 0.7);
    map.addDecal(17, 17, 3, 0.9);
    expect(map.decals.length).toBe(3);
  });

  it('cap at 200 — oldest removed when exceeding', () => {
    for (let i = 0; i < 200; i++) {
      map.addDecal(i % 128, Math.floor(i / 128), 1, 0.5);
    }
    expect(map.decals.length).toBe(200);

    // Add 201st — oldest should be removed
    map.addDecal(99, 99, 5, 1.0);
    expect(map.decals.length).toBe(200);
    // First decal should be the second original one (index 1), not the first (index 0)
    expect(map.decals[0]).toEqual({ cx: 1, cy: 0, size: 1, alpha: 0.5 });
    // Last should be the new one
    expect(map.decals[199]).toEqual({ cx: 99, cy: 99, size: 5, alpha: 1.0 });
  });

  it('FIFO order is maintained', () => {
    map.addDecal(1, 1, 1, 0.1);
    map.addDecal(2, 2, 2, 0.2);
    map.addDecal(3, 3, 3, 0.3);
    expect(map.decals[0].cx).toBe(1);
    expect(map.decals[1].cx).toBe(2);
    expect(map.decals[2].cx).toBe(3);
  });
});

// =============================================================================
//  18. Bridge System — countBridgeCells, destroyBridge (map.cpp)
// =============================================================================

describe('Bridge system — template-based bridges (map.cpp)', () => {

  it('no bridge templates → countBridgeCells = 0', () => {
    expect(map.countBridgeCells()).toBe(0);
  });

  it('bridge templates (131,133,235,236,378,379) with icon=6 are counted', () => {
    const cx = 15, cy = 15;
    map.templateType[cy * MAP_CELLS + cx] = 235;
    map.templateIcon[cy * MAP_CELLS + cx] = 6;
    map.templateType[cy * MAP_CELLS + cx + 1] = 131;
    map.templateIcon[cy * MAP_CELLS + cx + 1] = 6;
    map.templateType[cy * MAP_CELLS + cx + 2] = 379;
    map.templateIcon[cy * MAP_CELLS + cx + 2] = 6;
    expect(map.countBridgeCells()).toBe(3);
  });

  it('bridge template outside bounds is NOT counted', () => {
    // Place at (5,5) which is outside bounds (10,10,20,20)
    map.templateType[5 * MAP_CELLS + 5] = 240;
    expect(map.countBridgeCells()).toBe(0);
  });

  it('template 234 (just below range) is NOT a bridge', () => {
    map.templateType[15 * MAP_CELLS + 15] = 234;
    expect(map.countBridgeCells()).toBe(0);
  });

  it('template 253 (just above range) is NOT a bridge', () => {
    map.templateType[15 * MAP_CELLS + 15] = 253;
    expect(map.countBridgeCells()).toBe(0);
  });

  it('destroyBridge converts bridge cells to WATER', () => {
    const cx = 15, cy = 15;
    map.templateType[cy * MAP_CELLS + cx] = 235; // valid bridge template
    map.setTerrain(cx, cy, Terrain.CLEAR);
    const destroyed = map.destroyBridge(cx, cy, 0);
    expect(destroyed).toBe(1);
    expect(map.getTerrain(cx, cy)).toBe(Terrain.WATER);
    expect(map.templateType[cy * MAP_CELLS + cx]).toBe(1); // water template
  });

  it('destroyBridge radius covers multiple cells', () => {
    const cx = 15, cy = 15;
    // Place valid bridge template IDs in a cross pattern
    map.templateType[cy * MAP_CELLS + cx] = 131;
    map.templateType[cy * MAP_CELLS + cx + 1] = 133;
    map.templateType[cy * MAP_CELLS + cx - 1] = 235;
    map.templateType[(cy + 1) * MAP_CELLS + cx] = 236;
    map.templateType[(cy - 1) * MAP_CELLS + cx] = 378;
    const destroyed = map.destroyBridge(cx, cy, 1);
    expect(destroyed).toBe(5);
  });

  it('destroyBridge returns 0 when no bridge cells in radius', () => {
    expect(map.destroyBridge(15, 15, 2)).toBe(0);
  });

  it('destroyBridge does not affect non-bridge templates', () => {
    const cx = 15, cy = 15;
    map.templateType[cy * MAP_CELLS + cx] = 100; // not a bridge
    map.setTerrain(cx, cy, Terrain.CLEAR);
    const destroyed = map.destroyBridge(cx, cy, 0);
    expect(destroyed).toBe(0);
    expect(map.getTerrain(cx, cy)).toBe(Terrain.CLEAR); // unchanged
  });
});

// =============================================================================
//  19. Ore/Gem System — overlays, depletion (C++ overlay.cpp)
// =============================================================================

describe('Ore/Gem system — overlays and depletion (overlay.cpp)', () => {

  // -- Overlay ranges --

  it('gold ore range: 0x03 (GOLD01) through 0x0E (GOLD12)', () => {
    // Verify depleteOre returns 35 (gold value) for entire gold range
    for (let ovl = 0x03; ovl <= 0x0E; ovl++) {
      const m = new GameMap();
      m.overlay[15 * MAP_CELLS + 15] = ovl;
      const credits = m.depleteOre(15, 15);
      expect(credits, `overlay 0x${ovl.toString(16)} should be gold`).toBe(35);
    }
  });

  it('gem range: 0x0F (GEM01) through 0x12 (GEM04)', () => {
    for (let ovl = 0x0F; ovl <= 0x12; ovl++) {
      const m = new GameMap();
      m.overlay[15 * MAP_CELLS + 15] = ovl;
      const credits = m.depleteOre(15, 15);
      expect(credits, `overlay 0x${ovl.toString(16)} should be gem`).toBe(110);
    }
  });

  it('no overlay (0xFF) returns 0 credits', () => {
    expect(map.depleteOre(15, 15)).toBe(0);
  });

  it('overlay 0x02 (below gold range) returns 0 credits', () => {
    map.overlay[15 * MAP_CELLS + 15] = 0x02;
    expect(map.depleteOre(15, 15)).toBe(0);
  });

  it('overlay 0x13 (above gem range) returns 0 credits', () => {
    map.overlay[15 * MAP_CELLS + 15] = 0x13;
    expect(map.depleteOre(15, 15)).toBe(0);
  });

  // -- Depletion mechanics --

  it('depleting gold ore decrements overlay by 1', () => {
    const idx = 15 * MAP_CELLS + 15;
    map.overlay[idx] = 0x08; // gold density 5
    map.depleteOre(15, 15);
    expect(map.overlay[idx]).toBe(0x07);
  });

  it('depleting gold ore at minimum (0x03) sets to 0xFF (fully depleted)', () => {
    const idx = 15 * MAP_CELLS + 15;
    map.overlay[idx] = 0x03; // gold minimum
    map.depleteOre(15, 15);
    expect(map.overlay[idx]).toBe(0xFF);
  });

  it('depleting gem decrements overlay by 1', () => {
    const idx = 15 * MAP_CELLS + 15;
    map.overlay[idx] = 0x11; // gem density 2
    map.depleteOre(15, 15);
    expect(map.overlay[idx]).toBe(0x10);
  });

  it('depleting gem at minimum (0x0F) sets to 0xFF (fully depleted)', () => {
    const idx = 15 * MAP_CELLS + 15;
    map.overlay[idx] = 0x0F;
    map.depleteOre(15, 15);
    expect(map.overlay[idx]).toBe(0xFF);
  });

  it('gold bail value = 35 credits (C++ OverlayTypeClass GOLD)', () => {
    const idx = 15 * MAP_CELLS + 15;
    map.overlay[idx] = 0x08;
    expect(map.depleteOre(15, 15)).toBe(35);
  });

  it('gem bail value = 110 credits (C++ OverlayTypeClass GEM)', () => {
    const idx = 15 * MAP_CELLS + 15;
    map.overlay[idx] = 0x10;
    expect(map.depleteOre(15, 15)).toBe(110);
  });

  it('depleteOre out-of-bounds returns 0', () => {
    expect(map.depleteOre(-1, 0)).toBe(0);
    expect(map.depleteOre(128, 0)).toBe(0);
  });

  // -- isGemOverlay --

  it('isGemOverlay returns true for gem overlays (0x0F-0x12)', () => {
    for (let ovl = 0x0F; ovl <= 0x12; ovl++) {
      map.overlay[15 * MAP_CELLS + 15] = ovl;
      expect(map.isGemOverlay(15, 15)).toBe(true);
    }
  });

  it('isGemOverlay returns false for gold overlays', () => {
    map.overlay[15 * MAP_CELLS + 15] = 0x08;
    expect(map.isGemOverlay(15, 15)).toBe(false);
  });

  it('isGemOverlay returns false for no overlay (0xFF)', () => {
    expect(map.isGemOverlay(15, 15)).toBe(false);
  });

  it('isGemOverlay returns false for out-of-bounds', () => {
    expect(map.isGemOverlay(-1, 0)).toBe(false);
    expect(map.isGemOverlay(128, 0)).toBe(false);
  });

  // -- findNearestOre --

  it('findNearestOre finds gold ore', () => {
    map.overlay[18 * MAP_CELLS + 15] = 0x08; // gold at (15,18)
    const result = map.findNearestOre(15, 15);
    expect(result).toEqual({ cx: 15, cy: 18 });
  });

  it('findNearestOre finds gem', () => {
    map.overlay[18 * MAP_CELLS + 15] = 0x10; // gem at (15,18)
    const result = map.findNearestOre(15, 15);
    expect(result).toEqual({ cx: 15, cy: 18 });
  });

  it('findNearestOre returns nearest by squared distance', () => {
    map.overlay[15 * MAP_CELLS + 17] = 0x08; // gold at (17,15) distance=4
    map.overlay[15 * MAP_CELLS + 16] = 0x08; // gold at (16,15) distance=1
    const result = map.findNearestOre(15, 15);
    expect(result).toEqual({ cx: 16, cy: 15 }); // nearer one
  });

  it('findNearestOre returns null when no ore within range', () => {
    expect(map.findNearestOre(15, 15, 5)).toBeNull();
  });

  it('findNearestOre respects maxRange parameter', () => {
    map.overlay[40 * MAP_CELLS + 15] = 0x08; // gold at (15,40) — 25 cells away
    expect(map.findNearestOre(15, 15, 5)).toBeNull();
    expect(map.findNearestOre(15, 15, 30)).toEqual({ cx: 15, cy: 40 });
  });

  it('findNearestOre default maxRange is 20', () => {
    // Place ore at distance 19 — should be found
    map.overlay[34 * MAP_CELLS + 15] = 0x08; // (15,34) → dy=19
    expect(map.findNearestOre(15, 15)).toEqual({ cx: 15, cy: 34 });

    // Place ore at distance 21 — should NOT be found with default
    const m2 = new GameMap();
    m2.overlay[36 * MAP_CELLS + 15] = 0x08; // (15,36) → dy=21
    expect(m2.findNearestOre(15, 15)).toBeNull();
  });
});

// =============================================================================
//  20. Ore Growth — growOre (C++ OverlayClass::AI, overlay.cpp)
// =============================================================================

describe('Ore growth — C++ OverlayClass::AI (overlay.cpp)', () => {

  it('ORE_GROWTH_INTERVAL = 256 ticks', () => {
    expect(GameMap.ORE_GROWTH_INTERVAL).toBe(256);
  });

  it('growOre does nothing at tick 0', () => {
    const idx = 15 * MAP_CELLS + 15;
    map.overlay[idx] = 0x08;
    map.growOre(0);
    expect(map.overlay[idx]).toBe(0x08); // unchanged
  });

  it('growOre does nothing at non-interval ticks', () => {
    const idx = 15 * MAP_CELLS + 15;
    map.overlay[idx] = 0x08;
    map.growOre(100);
    expect(map.overlay[idx]).toBe(0x08);
    map.growOre(255);
    expect(map.overlay[idx]).toBe(0x08);
  });

  it('growOre fires at tick 256 (first interval)', () => {
    // With deterministic random, we can't predict exact outcome, but we can
    // check that it runs without error and the overlay is in a valid range
    const idx = 15 * MAP_CELLS + 15;
    map.overlay[idx] = 0x05; // mid-range gold
    map.growOre(256);
    // Overlay should still be in gold range (possibly incremented)
    expect(map.overlay[idx]).toBeGreaterThanOrEqual(0x05);
    expect(map.overlay[idx]).toBeLessThanOrEqual(0x06);
  });

  it('EC6: gems (0x0F-0x12) never grow — skipped entirely', () => {
    const idx = 15 * MAP_CELLS + 15;
    map.overlay[idx] = 0x0F; // gem minimum
    // Run many growth cycles
    for (let tick = 256; tick <= 256 * 100; tick += 256) {
      map.growOre(tick);
    }
    // Gem overlay should be completely unchanged
    expect(map.overlay[idx]).toBe(0x0F);
  });

  it('gold ore at max density (0x0E) cannot grow further', () => {
    const idx = 15 * MAP_CELLS + 15;
    map.overlay[idx] = 0x0E; // max gold
    for (let tick = 256; tick <= 256 * 50; tick += 256) {
      map.growOre(tick);
    }
    expect(map.overlay[idx]).toBe(0x0E); // stays at max
  });

  it('EC7: spread only occurs when density > ORE_SPREAD_MIN_DENSITY (0x09)', () => {
    // C++ parity: OverlayClass::AI() captures overlay value BEFORE growth,
    // then checks `if (ovl > 6)` (mapped to ovl > 0x09 in our 0x03-0x0E range).
    // At exactly 0x09, ovl <= 0x09 is true → spread is skipped.
    // Even if density growth bumps the cell to 0x0A during this cycle,
    // the spread decision was already made using the pre-growth snapshot.
    const idx = 15 * MAP_CELLS + 15;
    map.overlay[idx] = 0x09; // exactly at threshold — spread should NOT fire
    // All neighbors are CLEAR (default) — spread-eligible terrain
    // Run a single cycle so density growth can't push us multiple levels
    map.growOre(256);
    let neighborOreCount = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (map.overlay[(15 + dy) * MAP_CELLS + (15 + dx)] !== 0xFF) {
          neighborOreCount++;
        }
      }
    }
    expect(neighborOreCount).toBe(0);
  });

  it('EC7: spread only targets CLEAR terrain (not WATER, ROCK, etc.)', () => {
    const cx = 15, cy = 15;
    const idx = cy * MAP_CELLS + cx;
    map.overlay[idx] = 0x0E; // max gold, high density
    // Surround with non-CLEAR terrain
    map.setTerrain(cx + 1, cy, Terrain.WATER);
    map.setTerrain(cx - 1, cy, Terrain.ROCK);
    map.setTerrain(cx, cy + 1, Terrain.TREE);
    map.setTerrain(cx, cy - 1, Terrain.WALL);
    map.setTerrain(cx + 1, cy + 1, Terrain.ROUGH); // passable but not CLEAR
    map.setTerrain(cx - 1, cy - 1, Terrain.ORE);
    map.setTerrain(cx + 1, cy - 1, Terrain.BEACH);
    map.setTerrain(cx - 1, cy + 1, Terrain.RIVER);
    for (let tick = 256; tick <= 256 * 200; tick += 256) {
      map.growOre(tick);
    }
    // None of the neighbors should have ore (only CLEAR allows spread)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nidx = (cy + dy) * MAP_CELLS + (cx + dx);
        expect(map.overlay[nidx], `neighbor (${dx},${dy}) should not have ore`).toBe(0xFF);
      }
    }
  });

  it('EC7: spread does not target cells with walls', () => {
    const cx = 15, cy = 15;
    const idx = cy * MAP_CELLS + cx;
    map.overlay[idx] = 0x0E;
    // All neighbors are CLEAR (default) but have walls
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        map.setWallType(cx + dx, cy + dy, 'SBAG');
      }
    }
    for (let tick = 256; tick <= 256 * 200; tick += 256) {
      map.growOre(tick);
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nidx = (cy + dy) * MAP_CELLS + (cx + dx);
        expect(map.overlay[nidx]).toBe(0xFF);
      }
    }
  });

  it('EC7: spread does not target cells with existing overlay', () => {
    const cx = 15, cy = 15;
    const idx = cy * MAP_CELLS + cx;
    map.overlay[idx] = 0x0E;
    // Place existing overlay on a neighbor
    map.overlay[cy * MAP_CELLS + cx + 1] = 0x03; // existing gold
    for (let tick = 256; tick <= 256 * 200; tick += 256) {
      map.growOre(tick);
    }
    // The neighbor with existing ore should have grown but not been overwritten to 0x03
    expect(map.overlay[cy * MAP_CELLS + cx + 1]).toBeGreaterThanOrEqual(0x03);
  });

  it('growOre only processes cells within bounds', () => {
    // Place gold outside bounds
    map.overlay[5 * MAP_CELLS + 5] = 0x0E;
    for (let tick = 256; tick <= 256 * 10; tick += 256) {
      map.growOre(tick);
    }
    // Should be unchanged (not processed)
    expect(map.overlay[5 * MAP_CELLS + 5]).toBe(0x0E);
  });
});

// =============================================================================
//  21. Gap Generator — jamCell, unjamCell, unjamRadius (Agent 9)
// =============================================================================

describe('Gap Generator — cell jamming for shroud (Agent 9)', () => {

  it('jamCell sets visibility to 0 (shroud)', () => {
    map.setVisibility(15, 15, 2); // visible
    map.jamCell(15, 15);
    expect(map.getVisibility(15, 15)).toBe(0);
  });

  it('jamCell increments jam count (supports overlapping GAPs)', () => {
    map.jamCell(15, 15);
    map.jamCell(15, 15); // second GAP overlaps
    expect(map.jammedCells.get(15 * MAP_CELLS + 15)).toBe(2);
  });

  it('unjamCell decrements jam count', () => {
    map.jamCell(15, 15);
    map.jamCell(15, 15);
    map.unjamCell(15, 15);
    expect(map.jammedCells.get(15 * MAP_CELLS + 15)).toBe(1);
  });

  it('unjamCell removes entry and restores fog when count reaches 0', () => {
    map.jamCell(15, 15);
    map.unjamCell(15, 15);
    expect(map.jammedCells.has(15 * MAP_CELLS + 15)).toBe(false);
    expect(map.getVisibility(15, 15)).toBe(1); // fog, not shroud
  });

  it('unjamCell with 2 jams still keeps shroud (1 jam remains)', () => {
    map.setVisibility(15, 15, 2);
    map.jamCell(15, 15);
    map.jamCell(15, 15);
    map.unjamCell(15, 15);
    // Still jammed by one GAP — visibility stays at 0
    expect(map.getVisibility(15, 15)).toBe(0);
  });

  it('jamCell ignores out-of-bounds', () => {
    map.jamCell(-1, 0); // should not throw
    map.jamCell(128, 0);
  });

  it('unjamCell ignores out-of-bounds', () => {
    map.unjamCell(-1, 0); // should not throw
    map.unjamCell(128, 0);
  });

  it('unjamRadius unjams all cells in circular radius', () => {
    // Jam a 3×3 area
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        map.jamCell(15 + dx, 15 + dy);
      }
    }
    // All should be shroud
    expect(map.getVisibility(15, 15)).toBe(0);
    expect(map.getVisibility(16, 15)).toBe(0);

    // Unjam with radius 1
    map.unjamRadius(15, 15, 1);
    // Center and cardinal neighbors should be fog now
    expect(map.getVisibility(15, 15)).toBe(1);
    expect(map.getVisibility(16, 15)).toBe(1);
    expect(map.getVisibility(15, 16)).toBe(1);
  });

  it('unjamRadius uses circular (squared distance) check', () => {
    // Jam cells at various distances
    map.jamCell(15, 15);   // center
    map.jamCell(17, 15);   // distance 2
    map.jamCell(18, 15);   // distance 3
    map.jamCell(17, 17);   // distance sqrt(8) ≈ 2.83

    map.unjamRadius(15, 15, 2);
    // distance 0 (center) and distance 2 should be unjammed
    expect(map.jammedCells.has(15 * MAP_CELLS + 15)).toBe(false);
    expect(map.jammedCells.has(15 * MAP_CELLS + 17)).toBe(false);
    // distance 3 should NOT be unjammed (9 > 4)
    expect(map.jammedCells.has(15 * MAP_CELLS + 18)).toBe(true);
  });

  it('jamCell on already-shrouded cell still increments count', () => {
    // Visibility starts at 0 (shroud)
    map.jamCell(15, 15);
    expect(map.jammedCells.get(15 * MAP_CELLS + 15)).toBe(1);
    expect(map.getVisibility(15, 15)).toBe(0);
  });
});

// =============================================================================
//  22. findAdjacentWaterCell — naval production spawn (map.cpp)
// =============================================================================

describe('findAdjacentWaterCell — naval spawn point discovery (map.cpp)', () => {

  it('finds water cell adjacent to 1×1 structure', () => {
    map.setTerrain(16, 15, Terrain.WATER); // east of (15,15)
    const result = map.findAdjacentWaterCell(15, 15, 1, 1);
    expect(result).not.toBeNull();
    expect(map.getTerrain(result!.cx, result!.cy)).toBe(Terrain.WATER);
  });

  it('returns null if no adjacent water', () => {
    // All neighbors are CLEAR (default)
    const result = map.findAdjacentWaterCell(15, 15, 1, 1);
    expect(result).toBeNull();
  });

  it('scans perimeter of larger footprint (3×2)', () => {
    // Place water just below a 3×2 footprint at (15,15)
    map.setTerrain(15, 17, Terrain.WATER); // below footprint
    const result = map.findAdjacentWaterCell(15, 15, 3, 2);
    expect(result).not.toBeNull();
  });

  it('does not return water cell inside the footprint', () => {
    // Place water inside a 3×3 footprint
    map.setTerrain(16, 16, Terrain.WATER); // inside
    // But no perimeter water
    const result = map.findAdjacentWaterCell(15, 15, 3, 3);
    expect(result).toBeNull();
  });

  it('does not return occupied water cells', () => {
    map.setTerrain(16, 15, Terrain.WATER);
    map.setOccupancy(16, 15, 99); // occupied
    map.setTerrain(14, 15, Terrain.WATER); // another option
    const result = map.findAdjacentWaterCell(15, 15, 1, 1);
    // Should find the unoccupied one
    expect(result).not.toBeNull();
    expect(result!.cx).toBe(14);
  });

  it('respects bounds (water outside bounds not considered)', () => {
    // Water at (5,5) which is outside bounds
    map.setTerrain(5, 5, Terrain.WATER);
    const result = map.findAdjacentWaterCell(6, 5, 1, 1);
    // isWaterPassable checks bounds, so this should return null
    expect(result).toBeNull();
  });
});

// =============================================================================
//  23. initDefault — rock borders, clear playable area (map.cpp)
// =============================================================================

describe('initDefault — initialize map with rock borders', () => {

  it('fills playable area with CLEAR terrain', () => {
    map.initDefault();
    expect(map.getTerrain(15, 15)).toBe(Terrain.CLEAR);
    expect(map.getTerrain(10, 10)).toBe(Terrain.CLEAR);
    expect(map.getTerrain(29, 29)).toBe(Terrain.CLEAR);
  });

  it('marks outside bounds as ROCK', () => {
    map.initDefault();
    expect(map.getTerrain(0, 0)).toBe(Terrain.ROCK);
    expect(map.getTerrain(9, 10)).toBe(Terrain.ROCK);
    expect(map.getTerrain(30, 15)).toBe(Terrain.ROCK);
    expect(map.getTerrain(127, 127)).toBe(Terrain.ROCK);
  });

  it('boundary cells: (10,10) is CLEAR, (9,10) is ROCK', () => {
    map.initDefault();
    expect(map.getTerrain(10, 10)).toBe(Terrain.CLEAR);
    expect(map.getTerrain(9, 10)).toBe(Terrain.ROCK);
  });

  it('boundary cells: (29,29) is CLEAR, (30,29) is ROCK', () => {
    map.initDefault();
    expect(map.getTerrain(29, 29)).toBe(Terrain.CLEAR);
    expect(map.getTerrain(30, 29)).toBe(Terrain.ROCK);
  });
});

// =============================================================================
//  24. Cell Triggers — cellTriggers, activatedCellTriggers
// =============================================================================

describe('Cell triggers — map trigger registration and activation', () => {

  it('cellTriggers starts empty', () => {
    expect(map.cellTriggers.size).toBe(0);
  });

  it('activatedCellTriggers starts empty', () => {
    expect(map.activatedCellTriggers.size).toBe(0);
  });

  it('can register and retrieve a cell trigger', () => {
    const idx = 15 * MAP_CELLS + 15;
    map.cellTriggers.set(idx, 'MyTrigger');
    expect(map.cellTriggers.get(idx)).toBe('MyTrigger');
  });

  it('can track activated triggers', () => {
    map.activatedCellTriggers.add('MyTrigger');
    expect(map.activatedCellTriggers.has('MyTrigger')).toBe(true);
    expect(map.activatedCellTriggers.has('OtherTrigger')).toBe(false);
  });
});

// =============================================================================
//  25. Smudges — pre-placed scorch marks from scenario INI
// =============================================================================

describe('Smudges — pre-placed marks from scenario INI', () => {

  it('smudges starts empty', () => {
    expect(map.smudges.length).toBe(0);
  });

  it('can add smudge entries', () => {
    map.smudges.push({ type: 'SC1', cx: 15, cy: 15 });
    map.smudges.push({ type: 'CR3', cx: 20, cy: 20 });
    expect(map.smudges.length).toBe(2);
    expect(map.smudges[0]).toEqual({ type: 'SC1', cx: 15, cy: 15 });
  });
});

// =============================================================================
//  26. Overlay Grid — default values
// =============================================================================

describe('Overlay grid — default and boundary behavior', () => {

  it('default overlay is 0xFF (no overlay) everywhere', () => {
    expect(map.overlay[15 * MAP_CELLS + 15]).toBe(0xFF);
    expect(map.overlay[0]).toBe(0xFF);
    expect(map.overlay[127 * MAP_CELLS + 127]).toBe(0xFF);
  });

  it('overlay uses Uint8Array', () => {
    expect(map.overlay).toBeInstanceOf(Uint8Array);
  });
});

// =============================================================================
//  27. Template Data — templateType, templateIcon
// =============================================================================

describe('Template data — MapPack terrain templates', () => {

  it('templateType defaults to 0', () => {
    expect(map.templateType[15 * MAP_CELLS + 15]).toBe(0);
  });

  it('templateIcon defaults to 0', () => {
    expect(map.templateIcon[15 * MAP_CELLS + 15]).toBe(0);
  });

  it('templateType uses Uint16Array', () => {
    expect(map.templateType).toBeInstanceOf(Uint16Array);
  });

  it('templateIcon uses Uint8Array', () => {
    expect(map.templateIcon).toBeInstanceOf(Uint8Array);
  });
});

// =============================================================================
//  28. Passability Completeness — all 9 terrains × land/naval
// =============================================================================

describe('Passability matrix — all terrain types × land/naval (comprehensive)', () => {

  const terrainPassability: [Terrain, string, boolean, boolean][] = [
    //             Terrain          name     land    naval
    [Terrain.CLEAR,  'CLEAR',  true,  false],
    [Terrain.WATER,  'WATER',  false, true ],
    [Terrain.ROCK,   'ROCK',   false, false],
    [Terrain.TREE,   'TREE',   true,  false],  // C++ parity: trees are TerrainClass on CLEAR ground
    [Terrain.WALL,   'WALL',   false, false],
    [Terrain.ORE,    'ORE',    true,  false],
    [Terrain.BEACH,  'BEACH',  true,  false],
    [Terrain.ROUGH,  'ROUGH',  true,  false],
    [Terrain.RIVER,  'RIVER',  false, false],
  ];

  it.each(terrainPassability)(
    '%s: land passable=%s, naval passable=%s',
    (terrain, _name, expectedLand, expectedNaval) => {
      map.setTerrain(15, 15, terrain);
      const landResult = map.canEnterCell(15, 15, false);
      const navalResult = map.canEnterCell(15, 15, true);
      if (expectedLand) {
        expect(landResult).toBe(MoveResult.OK);
      } else {
        expect(landResult).toBe(MoveResult.IMPASSABLE);
      }
      if (expectedNaval) {
        expect(navalResult).toBe(MoveResult.OK);
      } else {
        expect(navalResult).toBe(MoveResult.IMPASSABLE);
      }
    }
  );
});

// =============================================================================
//  29. Grid Size and Memory Layout
// =============================================================================

describe('Grid size and memory layout', () => {

  it('cells array has MAP_CELLS × MAP_CELLS entries', () => {
    expect(map.cells.length).toBe(MAP_CELLS * MAP_CELLS);
  });

  it('occupancy array has MAP_CELLS × MAP_CELLS entries', () => {
    expect(map.occupancy.length).toBe(MAP_CELLS * MAP_CELLS);
  });

  it('visibility array has MAP_CELLS × MAP_CELLS entries', () => {
    expect(map.visibility.length).toBe(MAP_CELLS * MAP_CELLS);
  });

  it('templateType array has MAP_CELLS × MAP_CELLS entries', () => {
    expect(map.templateType.length).toBe(MAP_CELLS * MAP_CELLS);
  });

  it('overlay array has MAP_CELLS × MAP_CELLS entries', () => {
    expect(map.overlay.length).toBe(MAP_CELLS * MAP_CELLS);
  });

  it('wallType array has MAP_CELLS × MAP_CELLS entries', () => {
    expect(map.wallType.length).toBe(MAP_CELLS * MAP_CELLS);
  });

  it('treeType array has MAP_CELLS × MAP_CELLS entries', () => {
    expect(map.treeType.length).toBe(MAP_CELLS * MAP_CELLS);
  });

  it('CELL_SIZE = 24 pixels', () => {
    expect(CELL_SIZE).toBe(24);
  });
});

// =============================================================================
//  30. Ore Growth Constants
// =============================================================================

describe('Ore growth constants (C++ overlay.cpp parity)', () => {

  it('ORE_DENSITY_CHANCE = 0.5 (50% chance per cell per cycle)', () => {
    expect(GameMap.ORE_DENSITY_CHANCE).toBe(0.5);
  });

  it('ORE_SPREAD_CHANCE = 0.25 (25% chance per cell per cycle)', () => {
    expect(GameMap.ORE_SPREAD_CHANCE).toBe(0.25);
  });

  it('ORE_SPREAD_MIN_DENSITY = 0x09 (density > 6 required to spread)', () => {
    expect(GameMap.ORE_SPREAD_MIN_DENSITY).toBe(0x09);
  });

  it('ORE_GROWTH_INTERVAL = 256 ticks (~17 seconds at 15 FPS)', () => {
    expect(GameMap.ORE_GROWTH_INTERVAL).toBe(256);
  });
});
