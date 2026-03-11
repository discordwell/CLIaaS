/**
 * Harvester Behavioral Tests — calls exported functions from harvester.ts
 * directly with mock contexts. No source-string pattern matching.
 *
 * Functions tested:
 *   - findHarvesterOre(ctx, entity, cx, cy, maxRange)
 *   - updateHarvester(ctx, entity)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnitType, House, Mission, AnimState, CELL_SIZE, MAP_CELLS,
  UNIT_STATS, WEAPON_STATS,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap } from '../engine/map';
import type { MapStructure } from '../engine/scenario';
import { STRUCTURE_SIZE, STRUCTURE_MAX_HP } from '../engine/scenario';

import {
  type HarvesterContext,
  findHarvesterOre,
  updateHarvester,
} from '../engine/harvester';

beforeEach(() => resetEntityIds());

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

function makeStructure(
  type: string, house: House, cx = 10, cy = 10,
  opts: Partial<MapStructure> = {},
): MapStructure {
  const maxHp = (opts.maxHp ?? STRUCTURE_MAX_HP[type] ?? 256);
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: opts.hp ?? maxHp,
    maxHp,
    alive: opts.alive ?? true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    ...opts,
  } as MapStructure;
}

/** Create a GameMap with ore placed at specific cells */
function makeMapWithOre(oreCells: { cx: number; cy: number; value?: number }[]): GameMap {
  const map = new GameMap();
  for (const { cx, cy, value } of oreCells) {
    // 0x03 = GOLD01 (minimum gold ore), 0x0E = GOLD12 (maximum gold ore)
    // 0x0F = GEM01, 0x12 = GEM04
    map.overlay[cy * MAP_CELLS + cx] = value ?? 0x05; // default to gold ore
  }
  return map;
}

function makeHarvesterContext(overrides: Partial<HarvesterContext> = {}): HarvesterContext {
  return {
    entities: [],
    structures: [],
    houseCredits: new Map(),
    map: new GameMap(),
    isAllied: (a, b) => a === b,
    isPlayerControlled: () => true,
    playSound: vi.fn(),
    addCredits: vi.fn(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. findHarvesterOre
// ═══════════════════════════════════════════════════════════════════════════

describe('findHarvesterOre', () => {
  it('returns ore cell coordinates when ore exists within range', () => {
    const oreCells = [{ cx: 52, cy: 50 }];
    const map = makeMapWithOre(oreCells);
    const ctx = makeHarvesterContext({ map });
    const harv = makeEntity(UnitType.V_HARV, House.Spain, 50 * CELL_SIZE, 50 * CELL_SIZE);

    const result = findHarvesterOre(ctx, harv, 50, 50, 10);

    expect(result).not.toBeNull();
    expect(result!.cx).toBe(52);
    expect(result!.cy).toBe(50);
  });

  it('returns null when no ore exists within range', () => {
    // Place ore far outside range
    const oreCells = [{ cx: 100, cy: 100 }];
    const map = makeMapWithOre(oreCells);
    const ctx = makeHarvesterContext({ map });
    const harv = makeEntity(UnitType.V_HARV, House.Spain, 50 * CELL_SIZE, 50 * CELL_SIZE);

    const result = findHarvesterOre(ctx, harv, 50, 50, 5);

    expect(result).toBeNull();
  });

  it('finds closest ore cell, not a distant one', () => {
    const oreCells = [
      { cx: 55, cy: 50 }, // 5 cells away
      { cx: 51, cy: 50 }, // 1 cell away (closer)
      { cx: 50, cy: 58 }, // 8 cells away
    ];
    const map = makeMapWithOre(oreCells);
    const ctx = makeHarvesterContext({ map });
    const harv = makeEntity(UnitType.V_HARV, House.Spain, 50 * CELL_SIZE, 50 * CELL_SIZE);

    const result = findHarvesterOre(ctx, harv, 50, 50, 20);

    expect(result).not.toBeNull();
    expect(result!.cx).toBe(51);
    expect(result!.cy).toBe(50);
  });

  it('AI harvester avoids ore targeted by another friendly harvester', () => {
    const oreCells = [
      { cx: 52, cy: 50 }, // nearby ore — but another harvester is targeting it
      { cx: 60, cy: 50 }, // farther ore — untargeted
    ];
    const map = makeMapWithOre(oreCells);

    // Other friendly harvester targeting the nearby ore cell
    const otherHarv = makeEntity(UnitType.V_HARV, House.USSR, 48 * CELL_SIZE, 50 * CELL_SIZE);
    otherHarv.moveTarget = { x: 52 * CELL_SIZE + CELL_SIZE / 2, y: 50 * CELL_SIZE + CELL_SIZE / 2 };

    const testHarv = makeEntity(UnitType.V_HARV, House.USSR, 50 * CELL_SIZE, 50 * CELL_SIZE);

    const ctx = makeHarvesterContext({
      map,
      entities: [otherHarv, testHarv],
      // AI harvester: NOT player controlled
      isPlayerControlled: () => false,
    });

    const result = findHarvesterOre(ctx, testHarv, 50, 50, 20);

    // Should pick the farther untargeted ore, not the nearby targeted one
    expect(result).not.toBeNull();
    expect(result!.cx).toBe(60);
    expect(result!.cy).toBe(50);
  });

  it('player harvester ignores spread logic (uses simple nearest)', () => {
    const oreCells = [
      { cx: 52, cy: 50 }, // nearby — another harvester targeting it
      { cx: 60, cy: 50 }, // farther
    ];
    const map = makeMapWithOre(oreCells);

    const otherHarv = makeEntity(UnitType.V_HARV, House.Spain, 48 * CELL_SIZE, 50 * CELL_SIZE);
    otherHarv.moveTarget = { x: 52 * CELL_SIZE + CELL_SIZE / 2, y: 50 * CELL_SIZE + CELL_SIZE / 2 };

    const testHarv = makeEntity(UnitType.V_HARV, House.Spain, 50 * CELL_SIZE, 50 * CELL_SIZE);

    const ctx = makeHarvesterContext({
      map,
      entities: [otherHarv, testHarv],
      isPlayerControlled: (e) => e === testHarv,
    });

    const result = findHarvesterOre(ctx, testHarv, 50, 50, 20);

    // Player harvester takes nearest regardless of other harvesters
    expect(result).not.toBeNull();
    expect(result!.cx).toBe(52);
    expect(result!.cy).toBe(50);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. updateHarvester
// ═══════════════════════════════════════════════════════════════════════════

describe('updateHarvester — state transitions', () => {
  it('idle harvester transitions to seeking when ore exists', () => {
    const oreCells = [{ cx: 55, cy: 50 }];
    const map = makeMapWithOre(oreCells);
    const harv = makeEntity(UnitType.V_HARV, House.Spain, 50 * CELL_SIZE + CELL_SIZE / 2, 50 * CELL_SIZE + CELL_SIZE / 2);
    harv.harvesterState = 'idle';
    harv.mission = Mission.GUARD; // idle mission required

    const ctx = makeHarvesterContext({ map, entities: [harv] });

    updateHarvester(ctx, harv);

    expect(harv.harvesterState).toBe('seeking');
    expect(harv.mission).toBe(Mission.MOVE);
    expect(harv.moveTarget).not.toBeNull();
  });

  it('idle harvester stays idle when no ore exists', () => {
    const map = new GameMap(); // no ore anywhere
    const harv = makeEntity(UnitType.V_HARV, House.Spain, 50 * CELL_SIZE + CELL_SIZE / 2, 50 * CELL_SIZE + CELL_SIZE / 2);
    harv.harvesterState = 'idle';
    harv.mission = Mission.GUARD;

    const ctx = makeHarvesterContext({ map, entities: [harv] });

    updateHarvester(ctx, harv);

    expect(harv.harvesterState).toBe('idle');
  });

  it('idle harvester does NOT seek when mission is MOVE (manual move)', () => {
    const oreCells = [{ cx: 55, cy: 50 }];
    const map = makeMapWithOre(oreCells);
    const harv = makeEntity(UnitType.V_HARV, House.Spain, 50 * CELL_SIZE, 50 * CELL_SIZE);
    harv.harvesterState = 'idle';
    harv.mission = Mission.MOVE; // player manually moving

    const ctx = makeHarvesterContext({ map, entities: [harv] });

    updateHarvester(ctx, harv);

    expect(harv.harvesterState).toBe('idle');
  });

  it('harvester in harvesting state increments load on harvest tick', () => {
    // Place harvester on an ore cell
    const cellCx = 50, cellCy = 50;
    const map = makeMapWithOre([{ cx: cellCx, cy: cellCy, value: 0x08 }]); // gold ore with multiple bails
    const harv = makeEntity(UnitType.V_HARV, House.Spain,
      cellCx * CELL_SIZE + CELL_SIZE / 2, cellCy * CELL_SIZE + CELL_SIZE / 2);
    harv.harvesterState = 'harvesting';
    harv.harvestTick = 9; // next tick will be 10 (harvest happens every 10 ticks)
    harv.oreLoad = 0;
    harv.oreCreditValue = 0;
    harv.mission = Mission.GUARD;

    const ctx = makeHarvesterContext({ map, entities: [harv] });

    updateHarvester(ctx, harv);

    // harvestTick should have been incremented to 10, triggering a harvest
    expect(harv.harvestTick).toBe(10);
    expect(harv.oreLoad).toBeGreaterThan(0);
    expect(harv.oreCreditValue).toBeGreaterThan(0);
  });

  it('full harvester transitions to returning state', () => {
    const cellCx = 50, cellCy = 50;
    const map = makeMapWithOre([{ cx: cellCx, cy: cellCy, value: 0x0E }]); // lots of gold ore
    const harv = makeEntity(UnitType.V_HARV, House.Spain,
      cellCx * CELL_SIZE + CELL_SIZE / 2, cellCy * CELL_SIZE + CELL_SIZE / 2);
    harv.harvesterState = 'harvesting';
    harv.oreLoad = Entity.BAIL_COUNT - 1; // one bail short of full
    harv.oreCreditValue = 35 * (Entity.BAIL_COUNT - 1);
    harv.harvestTick = 9; // next tick triggers harvest
    harv.mission = Mission.GUARD;

    const ctx = makeHarvesterContext({ map, entities: [harv] });

    updateHarvester(ctx, harv);

    expect(harv.oreLoad).toBe(Entity.BAIL_COUNT);
    expect(harv.harvesterState).toBe('returning');
  });

  it('returning harvester moves toward refinery when idle', () => {
    const cellCx = 50, cellCy = 50;
    const refineryX = 55, refineryY = 50;
    const map = new GameMap();
    const proc = makeStructure('PROC', House.Spain, refineryX, refineryY);
    const harv = makeEntity(UnitType.V_HARV, House.Spain,
      cellCx * CELL_SIZE + CELL_SIZE / 2, cellCy * CELL_SIZE + CELL_SIZE / 2);
    harv.harvesterState = 'returning';
    harv.oreLoad = 10;
    harv.mission = Mission.GUARD; // idle — triggers refinery seek

    const ctx = makeHarvesterContext({
      map,
      structures: [proc],
      entities: [harv],
    });

    updateHarvester(ctx, harv);

    // Harvester should start moving toward refinery dock
    expect(harv.mission).toBe(Mission.MOVE);
    expect(harv.moveTarget).not.toBeNull();
  });

  it('returning harvester transitions to unloading when adjacent to refinery', () => {
    // Place harvester right at the refinery dock (adjacent to footprint)
    const refineryX = 50, refineryY = 50;
    const [procW, procH] = STRUCTURE_SIZE['PROC'] ?? [3, 2];
    // Dock cell is cx+1, cy+procH (below entrance)
    const dockCx = refineryX + 1;
    const dockCy = refineryY + procH;
    const map = new GameMap();
    const proc = makeStructure('PROC', House.Spain, refineryX, refineryY);

    const harv = makeEntity(UnitType.V_HARV, House.Spain,
      dockCx * CELL_SIZE + CELL_SIZE / 2, dockCy * CELL_SIZE + CELL_SIZE / 2);
    harv.harvesterState = 'returning';
    harv.oreLoad = 10;
    harv.oreCreditValue = 350;
    harv.mission = Mission.GUARD; // idle = arrived

    const ctx = makeHarvesterContext({
      map,
      structures: [proc],
      entities: [harv],
    });

    updateHarvester(ctx, harv);

    expect(harv.harvesterState).toBe('unloading');
    expect(harv.harvestTick).toBe(0);
  });

  it('returning harvester idles when no refinery exists', () => {
    const harv = makeEntity(UnitType.V_HARV, House.Spain, 50 * CELL_SIZE, 50 * CELL_SIZE);
    harv.harvesterState = 'returning';
    harv.oreLoad = 10;
    harv.mission = Mission.GUARD;

    const ctx = makeHarvesterContext({
      structures: [], // no refineries
      entities: [harv],
    });

    updateHarvester(ctx, harv);

    expect(harv.harvesterState).toBe('idle');
  });

  it('unloading harvester adds credits via addCredits callback after 14 ticks', () => {
    const addCredits = vi.fn();
    const harv = makeEntity(UnitType.V_HARV, House.Spain, 50 * CELL_SIZE, 50 * CELL_SIZE);
    harv.harvesterState = 'unloading';
    harv.harvestTick = 13; // next tick = 14 (dump completes)
    harv.oreLoad = 10;
    harv.oreCreditValue = 350;

    const ctx = makeHarvesterContext({
      addCredits,
      isPlayerControlled: () => true,
      entities: [harv],
    });

    updateHarvester(ctx, harv);

    expect(addCredits).toHaveBeenCalledWith(350);
    expect(harv.oreLoad).toBe(0);
    expect(harv.oreCreditValue).toBe(0);
    expect(harv.harvesterState).toBe('idle');
  });

  it('AI unloading harvester deposits into houseCredits (not addCredits)', () => {
    const addCredits = vi.fn();
    const houseCredits = new Map<House, number>();
    houseCredits.set(House.USSR, 100);

    const harv = makeEntity(UnitType.V_HARV, House.USSR, 50 * CELL_SIZE, 50 * CELL_SIZE);
    harv.harvesterState = 'unloading';
    harv.harvestTick = 13;
    harv.oreLoad = 5;
    harv.oreCreditValue = 175;

    const ctx = makeHarvesterContext({
      addCredits,
      houseCredits,
      isPlayerControlled: () => false, // AI harvester
      entities: [harv],
    });

    updateHarvester(ctx, harv);

    expect(addCredits).not.toHaveBeenCalled();
    expect(houseCredits.get(House.USSR)).toBe(275); // 100 + 175
    expect(harv.oreLoad).toBe(0);
    expect(harv.harvesterState).toBe('idle');
  });

  it('unloading harvester plays credit sound every 5 ticks for player', () => {
    const playSound = vi.fn();
    const harv = makeEntity(UnitType.V_HARV, House.Spain, 50 * CELL_SIZE, 50 * CELL_SIZE);
    harv.harvesterState = 'unloading';
    harv.harvestTick = 4; // next tick = 5 (sound trigger)
    harv.oreLoad = 10;
    harv.oreCreditValue = 350;

    const ctx = makeHarvesterContext({
      playSound,
      isPlayerControlled: () => true,
      entities: [harv],
    });

    updateHarvester(ctx, harv);

    expect(playSound).toHaveBeenCalledWith('heal');
  });
});
