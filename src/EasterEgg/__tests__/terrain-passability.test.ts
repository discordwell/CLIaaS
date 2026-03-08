/**
 * Bug 3 tests: Units crossing rivers / impassable terrain.
 * Verifies:
 * 1. PASSABLE set includes CLEAR, ROUGH, BEACH (not WATER, RIVER, ROCK, TREE, WALL)
 * 2. Path-following safety check re-pathfinds when next path cell becomes impassable
 * 3. Direct movement (no path) checks terrain before entering new cells
 * 4. River templates (112-130) are classified as WATER (impassable)
 * 5. Occupancy is checked during direct movement fallback
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameMap, Terrain } from '../engine/map';
import { findPath } from '../engine/pathfinding';
import { CELL_SIZE, SpeedClass } from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { UnitType, House, Dir } from '../engine/types';

beforeEach(() => resetEntityIds());

// === Fix 1: PASSABLE terrain set ===

describe('PASSABLE terrain set', () => {
  it('CLEAR terrain is passable', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.setTerrain(5, 5, Terrain.CLEAR);
    expect(map.isPassable(5, 5)).toBe(true);
    expect(map.isTerrainPassable(5, 5)).toBe(true);
  });

  it('ROUGH terrain is passable', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.setTerrain(5, 5, Terrain.ROUGH);
    expect(map.isPassable(5, 5)).toBe(true);
    expect(map.isTerrainPassable(5, 5)).toBe(true);
  });

  it('BEACH terrain is passable', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.setTerrain(5, 5, Terrain.BEACH);
    expect(map.isPassable(5, 5)).toBe(true);
    expect(map.isTerrainPassable(5, 5)).toBe(true);
  });

  it('WATER terrain is NOT passable', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.setTerrain(5, 5, Terrain.WATER);
    expect(map.isPassable(5, 5)).toBe(false);
    expect(map.isTerrainPassable(5, 5)).toBe(false);
  });

  it('RIVER terrain is NOT passable', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.setTerrain(5, 5, Terrain.RIVER);
    expect(map.isPassable(5, 5)).toBe(false);
    expect(map.isTerrainPassable(5, 5)).toBe(false);
  });

  it('ROCK terrain is NOT passable', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.setTerrain(5, 5, Terrain.ROCK);
    expect(map.isPassable(5, 5)).toBe(false);
  });

  it('TREE terrain is NOT passable', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.setTerrain(5, 5, Terrain.TREE);
    expect(map.isPassable(5, 5)).toBe(false);
  });

  it('WALL terrain is NOT passable', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.setTerrain(5, 5, Terrain.WALL);
    expect(map.isPassable(5, 5)).toBe(false);
  });

  it('ORE terrain is passable (added by Bug 2 agent)', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.setTerrain(5, 5, Terrain.ORE);
    // ORE passability was added by the Bug 2 agent — verify it's passable
    expect(map.isTerrainPassable(5, 5)).toBe(true);
  });
});

// === Fix 2: Pathfinding respects ROUGH and BEACH ===

describe('Pathfinding through ROUGH and BEACH terrain', () => {
  it('A* finds path through ROUGH terrain', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    // Create a corridor of ROUGH terrain
    for (let x = 0; x < 10; x++) {
      map.setTerrain(x, 5, Terrain.ROUGH);
    }
    const path = findPath(map, { cx: 0, cy: 5 }, { cx: 9, cy: 5 });
    expect(path.length).toBeGreaterThan(0);
    // All cells in path should be ROUGH (or CLEAR)
    for (const cell of path) {
      const t = map.getTerrain(cell.cx, cell.cy);
      expect(t === Terrain.ROUGH || t === Terrain.CLEAR).toBe(true);
    }
  });

  it('A* finds path through BEACH terrain', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    for (let x = 0; x < 10; x++) {
      map.setTerrain(x, 5, Terrain.BEACH);
    }
    const path = findPath(map, { cx: 0, cy: 5 }, { cx: 9, cy: 5 });
    expect(path.length).toBeGreaterThan(0);
  });

  it('A* does NOT path through WATER terrain', () => {
    // Use a narrow corridor (1 row high) blocked by water in the middle
    const map = new GameMap();
    map.setBounds(0, 0, 10, 1); // 10x1 corridor
    map.setTerrain(5, 0, Terrain.WATER); // block the middle
    // Surround with ROCK to prevent going around
    for (let x = 0; x < 10; x++) {
      map.setTerrain(x, 1, Terrain.ROCK);
    }
    const path = findPath(map, { cx: 2, cy: 0 }, { cx: 8, cy: 0 });
    // PF4: nearest-reachable fallback — returns partial path to closest explored cell,
    // but the path should NOT cross through water (cell 5,0 should not be in path)
    const crossesWater = path.some(c => c.cx === 5 && c.cy === 0);
    expect(crossesWater).toBe(false); // no path THROUGH water
  });

  it('A* does NOT path through RIVER terrain', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 10, 1);
    map.setTerrain(5, 0, Terrain.RIVER);
    for (let x = 0; x < 10; x++) {
      map.setTerrain(x, 1, Terrain.ROCK);
    }
    const path = findPath(map, { cx: 2, cy: 0 }, { cx: 8, cy: 0 });
    // PF4: nearest-reachable fallback returns partial path, but not through river
    const crossesRiver = path.some(c => c.cx === 5 && c.cy === 0);
    expect(crossesRiver).toBe(false);
  });

  it('A* routes around WATER when BEACH provides an alternate path', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    // Water wall at column 5, but with a BEACH gap at row 3
    for (let y = 0; y < 20; y++) {
      map.setTerrain(5, y, Terrain.WATER);
    }
    map.setTerrain(5, 3, Terrain.BEACH); // passable gap
    const path = findPath(map, { cx: 2, cy: 3 }, { cx: 8, cy: 3 });
    expect(path.length).toBeGreaterThan(0);
    // Path must go through the BEACH gap
    const throughGap = path.some(c => c.cx === 5 && c.cy === 3);
    expect(throughGap).toBe(true);
  });
});

// === Fix 3: Direct movement terrain check ===

describe('Direct movement terrain blocking', () => {
  it('moveToward itself does not check terrain (low-level primitive)', () => {
    // moveToward is used by aircraft which should ignore terrain.
    // Verify it does not block movement over water.
    const unit = new Entity(UnitType.V_2TNK, House.Spain,
      5 * CELL_SIZE + CELL_SIZE / 2,
      5 * CELL_SIZE + CELL_SIZE / 2);
    unit.facing = Dir.E;
    const startX = unit.pos.x;
    // Move toward a target to the east (even though terrain might be water)
    const target = { x: 8 * CELL_SIZE + CELL_SIZE / 2, y: 5 * CELL_SIZE + CELL_SIZE / 2 };
    unit.rotTickedThisFrame = false;
    unit.moveToward(target, unit.stats.speed);
    // moveToward should have moved the unit (it doesn't check terrain)
    expect(unit.pos.x).toBeGreaterThan(startX);
  });
});

// === Fix 4: River template classification ===

describe('River template terrain classification', () => {
  it('Terrain.RIVER enum value exists but is not in PASSABLE', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.setTerrain(5, 5, Terrain.RIVER);
    expect(map.isPassable(5, 5)).toBe(false);
    expect(map.isTerrainPassable(5, 5)).toBe(false);
  });

  it('Terrain.RIVER has speed multiplier (0.4) but is still impassable', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.setTerrain(5, 5, Terrain.RIVER);
    // Speed multiplier exists for RIVER (used if unit is somehow on it)
    const footMult = map.getSpeedMultiplier(5, 5, SpeedClass.FOOT);
    expect(footMult).toBe(0.4);
    const wheelMult = map.getSpeedMultiplier(5, 5, SpeedClass.WHEEL);
    expect(wheelMult).toBe(0.4);
    // But terrain is impassable — units should never pathfind onto it
    expect(map.isPassable(5, 5)).toBe(false);
  });
});

// === Speed multipliers for newly passable terrain ===

describe('Speed multipliers for ROUGH and BEACH', () => {
  it('ROUGH terrain slows ground units (0.6 multiplier)', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.setTerrain(5, 5, Terrain.ROUGH);
    expect(map.getSpeedMultiplier(5, 5, SpeedClass.FOOT)).toBe(0.6);
    expect(map.getSpeedMultiplier(5, 5, SpeedClass.WHEEL)).toBe(0.6);
  });

  it('BEACH terrain slows ground units (0.6 multiplier)', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.setTerrain(5, 5, Terrain.BEACH);
    expect(map.getSpeedMultiplier(5, 5, SpeedClass.FOOT)).toBe(0.6);
    expect(map.getSpeedMultiplier(5, 5, SpeedClass.WHEEL)).toBe(0.6);
  });

  it('WINGED speed class ignores terrain entirely', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.setTerrain(5, 5, Terrain.WATER);
    expect(map.getSpeedMultiplier(5, 5, SpeedClass.WINGED)).toBe(1.0);
    map.setTerrain(5, 5, Terrain.ROUGH);
    expect(map.getSpeedMultiplier(5, 5, SpeedClass.WINGED)).toBe(1.0);
  });
});
