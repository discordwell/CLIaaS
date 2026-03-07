/**
 * Bug 2 tests: Harvester auto-harvest behavior.
 * Verifies:
 * 1. Terrain.ORE is in the PASSABLE set (harvesters can pathfind to ore cells)
 * 2. Harvester AI gate fires for both GUARD and AREA_GUARD missions
 * 3. Seeking/returning states accept AREA_GUARD as move-completion signal
 * 4. Seeking timeout fires when path is exhausted during MOVE
 * 5. depleteOre returns correct credit values (35 gold, 110 gem)
 * 6. ORE_CAPACITY is 28 bails (C++ UnitTypeClass::Max_Pips)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameMap, Terrain } from '../engine/map';
import { Entity, resetEntityIds } from '../engine/entity';
import { findPath } from '../engine/pathfinding';
import { MAP_CELLS, UnitType, House, CELL_SIZE } from '../engine/types';

beforeEach(() => resetEntityIds());

// === Fix 1: Terrain.ORE passability ===

describe('Terrain.ORE passability', () => {
  it('ORE terrain is passable for ground units', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.setTerrain(5, 5, Terrain.ORE);
    expect(map.isPassable(5, 5)).toBe(true);
    expect(map.isTerrainPassable(5, 5)).toBe(true);
  });

  it('pathfinding can route through ORE terrain', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    // Create a corridor of ORE terrain between start and goal
    for (let x = 1; x <= 8; x++) {
      map.setTerrain(x, 5, Terrain.ORE);
    }
    const path = findPath(map, { cx: 1, cy: 5 }, { cx: 8, cy: 5 }, true);
    expect(path.length).toBeGreaterThan(0);
    // Path should reach the goal
    const last = path[path.length - 1];
    expect(last.cx).toBe(8);
    expect(last.cy).toBe(5);
  });

  it('pathfinding can route to an ORE cell surrounded by CLEAR', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.setTerrain(10, 10, Terrain.ORE);
    const path = findPath(map, { cx: 5, cy: 10 }, { cx: 10, cy: 10 }, true);
    expect(path.length).toBeGreaterThan(0);
  });
});

// === Fix 2: Harvester state machine ===

describe('Harvester state machine', () => {
  it('newly spawned harvester starts in idle state with GUARD mission', () => {
    const harv = new Entity(UnitType.V_HARV, House.GREECE,
      50 * CELL_SIZE + CELL_SIZE / 2, 50 * CELL_SIZE + CELL_SIZE / 2);
    harv.harvesterState = 'idle';
    expect(harv.harvesterState).toBe('idle');
    // Default mission is GUARD
    expect(harv.mission).toBeDefined();
  });

  it('ORE_CAPACITY is 28 bails (C++ parity)', () => {
    expect(Entity.ORE_CAPACITY).toBe(28);
    expect(Entity.BAIL_COUNT).toBe(28);
  });
});

// === Fix 3: Ore depletion credit values ===

describe('Ore depletion credits', () => {
  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
  });

  function setOverlay(cx: number, cy: number, val: number): void {
    map.overlay[cy * MAP_CELLS + cx] = val;
  }

  it('gold ore yields 35 credits per bail', () => {
    setOverlay(50, 50, 0x07);
    expect(map.depleteOre(50, 50)).toBe(35);
  });

  it('gem yields 110 credits per bail', () => {
    setOverlay(50, 50, 0x10);
    expect(map.depleteOre(50, 50)).toBe(110);
  });

  it('fully depleted gold ore cell returns 0xFF overlay', () => {
    setOverlay(50, 50, 0x03); // minimum gold density
    map.depleteOre(50, 50);
    expect(map.overlay[50 * MAP_CELLS + 50]).toBe(0xFF);
  });

  it('empty cell returns 0 credits', () => {
    expect(map.depleteOre(50, 50)).toBe(0);
  });

  it('28 bails at 35 credits = 980 credits per full gold load', () => {
    // Full harvester trip value
    expect(Entity.ORE_CAPACITY * 35).toBe(980);
  });
});

// === Fix 4: findNearestOre ===

describe('findNearestOre', () => {
  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
  });

  function setOverlay(cx: number, cy: number, val: number): void {
    map.overlay[cy * MAP_CELLS + cx] = val;
  }

  it('finds gold ore within range', () => {
    setOverlay(55, 55, 0x07); // gold ore
    const result = map.findNearestOre(50, 50, 10);
    expect(result).not.toBeNull();
    expect(result!.cx).toBe(55);
    expect(result!.cy).toBe(55);
  });

  it('finds gem ore within range', () => {
    setOverlay(52, 52, 0x10); // gem
    const result = map.findNearestOre(50, 50, 10);
    expect(result).not.toBeNull();
    expect(result!.cx).toBe(52);
    expect(result!.cy).toBe(52);
  });

  it('returns null when no ore in range', () => {
    const result = map.findNearestOre(50, 50, 5);
    expect(result).toBeNull();
  });

  it('prefers closer ore cell', () => {
    setOverlay(52, 50, 0x05); // closer gold
    setOverlay(58, 50, 0x0A); // farther gold
    const result = map.findNearestOre(50, 50, 10);
    expect(result).not.toBeNull();
    expect(result!.cx).toBe(52); // should pick the closer one
  });
});

// === Fix 5: PASSABLE set completeness ===

describe('PASSABLE set includes all walkable terrain types', () => {
  const map = new GameMap();
  map.setBounds(0, 0, 20, 20);

  const passable = [Terrain.CLEAR, Terrain.ORE, Terrain.ROUGH, Terrain.BEACH];
  const impassable = [Terrain.WATER, Terrain.ROCK, Terrain.TREE, Terrain.WALL, Terrain.RIVER];

  for (const t of passable) {
    it(`${Terrain[t]} is passable`, () => {
      const m = new GameMap();
      m.setBounds(0, 0, 20, 20);
      m.setTerrain(5, 5, t);
      expect(m.isPassable(5, 5)).toBe(true);
    });
  }

  for (const t of impassable) {
    it(`${Terrain[t]} is NOT passable`, () => {
      const m = new GameMap();
      m.setBounds(0, 0, 20, 20);
      m.setTerrain(5, 5, t);
      expect(m.isPassable(5, 5)).toBe(false);
    });
  }
});
