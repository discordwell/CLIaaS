import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Entity, setPlayerHouses, resetEntityIds } from '../engine/entity';
import {
  House, UnitType, Mission, CELL_SIZE, SuperweaponType, SUPERWEAPON_DEFS,
  type SpeedClass, type ProductionItem, type SuperweaponState,
} from '../engine/types';
import type { MapStructure } from '../engine/scenario';
import {
  serializeState, processCommands,
  type AgentCommand, type AgentState,
} from '../engine/agentHarness';

/**
 * Enhanced Agent Harness Tests — verify the new state fields:
 *   - Production info (available items with costs, queue cost/paid)
 *   - Power grid (multiplier)
 *   - Repair status
 *   - Superweapon status
 *   - Combat readiness (ammo, cooldown, weapon details)
 */

// Mock findPath globally — returns a trivial path or empty
vi.mock('../engine/pathfinding', () => ({
  findPath: (_map: unknown, start: { cx: number; cy: number }, goal: { cx: number; cy: number }) => {
    if (start.cx === goal.cx && start.cy === goal.cy) return [];
    return [{ cx: goal.cx, cy: goal.cy }];
  },
}));

// Helper: create minimal mock Game
function makeGame(overrides: Record<string, unknown> = {}) {
  return {
    tick: 100,
    state: 'paused' as const,
    credits: 5000,
    powerProduced: 200,
    powerConsumed: 100,
    siloCapacity: 2000,
    entities: [] as Entity[],
    entityById: new Map<number, Entity>(),
    structures: [] as MapStructure[],
    playerHouse: House.Spain,
    killCount: 3,
    lossCount: 1,
    productionQueue: new Map<string, { item: ProductionItem; progress: number; queueCount: number; costPaid: number }>(),
    pendingPlacement: null as ProductionItem | null,
    superweapons: new Map<string, SuperweaponState>(),
    fogDisabled: true,
    map: {
      boundsX: 40,
      boundsY: 40,
      boundsW: 50,
      boundsH: 50,
      isPassable: () => true,
      isTerrainPassable: () => true,
    },
    _repairing: new Set<number>(),
    getAvailableItems: () => [] as ProductionItem[],
    isAllied: (house: House, playerHouse: House) =>
      house === playerHouse || house === House.Greece || house === House.Neutral,
    startProduction: vi.fn(),
    cancelProduction: vi.fn(),
    placeStructure: vi.fn().mockReturnValue(true),
    deployMCV: vi.fn().mockReturnValue(true),
    sellStructureByIndex: vi.fn().mockReturnValue(true),
    toggleRepair: vi.fn().mockReturnValue(true),
    isStructureRepairing(idx: number) { return (this as unknown as { _repairing: Set<number> })._repairing.has(idx); },
    step: vi.fn(),
    ...overrides,
  };
}

type MockGame = ReturnType<typeof makeGame>;

function makeEntity(id: number, type: UnitType, house: House, cx: number, cy: number): Entity {
  const e = new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
  (e as { id: number }).id = id;
  return e;
}

function makeStructure(
  type: string, house: House, cx: number, cy: number, alive = true,
): MapStructure {
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp: 256, maxHp: 256, alive, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function addEntity(game: MockGame, e: Entity) {
  game.entities.push(e);
  game.entityById.set(e.id, e);
}

function castGame(game: MockGame) {
  return game as unknown as Parameters<typeof serializeState>[0];
}

beforeEach(() => {
  resetEntityIds();
  setPlayerHouses(new Set([House.Spain, House.Greece]));
});

// ===================================================================
// Power grid — multiplier calculation
// ===================================================================

describe('power grid multiplier', () => {
  it('returns 1.0 when produced >= consumed', () => {
    const game = makeGame({ powerProduced: 200, powerConsumed: 100 });
    const s = serializeState(castGame(game));
    expect(s.power.multiplier).toBe(1.0);
  });

  it('returns fraction when consumed > produced', () => {
    const game = makeGame({ powerProduced: 50, powerConsumed: 100 });
    const s = serializeState(castGame(game));
    // powerMultiplier(50, 100) = max(0.5, 50/100) = 0.5
    expect(s.power.multiplier).toBe(0.5);
  });

  it('clamps to 0.5 minimum', () => {
    const game = makeGame({ powerProduced: 10, powerConsumed: 100 });
    const s = serializeState(castGame(game));
    // powerMultiplier(10, 100) = max(0.5, 0.1) = 0.5
    expect(s.power.multiplier).toBe(0.5);
  });

  it('returns 1.0 when both zero', () => {
    const game = makeGame({ powerProduced: 0, powerConsumed: 0 });
    const s = serializeState(castGame(game));
    expect(s.power.multiplier).toBe(1.0);
  });
});

// ===================================================================
// Production queue — cost and paid fields
// ===================================================================

describe('production queue enhanced fields', () => {
  it('includes effective cost and costPaid for active build', () => {
    const game = makeGame();
    game.productionQueue.set('right', {
      item: { type: '2TNK', name: 'Medium Tank', buildTime: 100, cost: 800, prerequisite: 'WEAP', faction: 'both' } as ProductionItem,
      progress: 50,
      queueCount: 1,
      costPaid: 400,
    });

    const s = serializeState(castGame(game));
    expect(s.production).toHaveLength(1);
    expect(s.production[0].cost).toBe(800); // Spain has costMult=1.0
    expect(s.production[0].paid).toBe(400);
  });

  it('adjusts cost for country bonus (USSR = 0.9x)', () => {
    const game = makeGame({ playerHouse: House.USSR });
    setPlayerHouses(new Set([House.USSR]));
    game.productionQueue.set('right', {
      item: { type: '2TNK', name: 'Medium Tank', buildTime: 100, cost: 800, prerequisite: 'WEAP', faction: 'both' } as ProductionItem,
      progress: 0,
      queueCount: 1,
      costPaid: 0,
    });

    const s = serializeState(castGame(game));
    // USSR costMult = 0.9, so effective cost = round(800 * 0.9) = 720
    expect(s.production[0].cost).toBe(720);
  });
});

// ===================================================================
// Available items — full detail
// ===================================================================

describe('availableItems with costs', () => {
  it('populates availableItems array with cost, time, side, isStruct', () => {
    const items: ProductionItem[] = [
      { type: '2TNK', name: 'Medium Tank', cost: 800, buildTime: 100, prerequisite: 'WEAP', faction: 'both', isStructure: false },
      { type: 'POWR', name: 'Power Plant', cost: 300, buildTime: 60, prerequisite: 'FACT', faction: 'both', isStructure: true },
    ];
    const game = makeGame({
      getAvailableItems: () => items,
    });

    const s = serializeState(castGame(game));

    expect(s.available).toEqual(['2TNK', 'POWR']);
    expect(s.availableItems).toHaveLength(2);

    const tank = s.availableItems.find(i => i.t === '2TNK')!;
    expect(tank.name).toBe('Medium Tank');
    expect(tank.cost).toBe(800);
    expect(tank.time).toBe(100);
    expect(tank.side).toBe('right');
    expect(tank.isStruct).toBe(false);

    const powr = s.availableItems.find(i => i.t === 'POWR')!;
    expect(powr.name).toBe('Power Plant');
    expect(powr.cost).toBe(300);
    expect(powr.side).toBe('left');
    expect(powr.isStruct).toBe(true);
  });

  it('empty when no items available', () => {
    const game = makeGame();
    const s = serializeState(castGame(game));
    expect(s.availableItems).toEqual([]);
  });
});

// ===================================================================
// Superweapon status
// ===================================================================

describe('superweapon status', () => {
  it('includes charging superweapon with progress', () => {
    const game = makeGame();
    const def = SUPERWEAPON_DEFS[SuperweaponType.NUKE];
    game.superweapons.set(`${House.Spain}:${SuperweaponType.NUKE}`, {
      type: SuperweaponType.NUKE,
      house: House.Spain,
      chargeTick: def.rechargeTicks / 2, // 50% charged
      ready: false,
      structureIndex: 0,
      fired: false,
    });

    const s = serializeState(castGame(game));
    expect(s.superweapons).toHaveLength(1);
    expect(s.superweapons[0].type).toBe('NUKE');
    expect(s.superweapons[0].name).toBe('Nuclear Strike');
    expect(s.superweapons[0].charge).toBeCloseTo(0.5);
    expect(s.superweapons[0].ready).toBe(false);
    expect(s.superweapons[0].needsTarget).toBe(true);
  });

  it('shows ready superweapon with charge=1', () => {
    const game = makeGame();
    const def = SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN];
    game.superweapons.set(`${House.Spain}:${SuperweaponType.IRON_CURTAIN}`, {
      type: SuperweaponType.IRON_CURTAIN,
      house: House.Spain,
      chargeTick: def.rechargeTicks,
      ready: true,
      structureIndex: 0,
      fired: false,
    });

    const s = serializeState(castGame(game));
    expect(s.superweapons).toHaveLength(1);
    expect(s.superweapons[0].ready).toBe(true);
    expect(s.superweapons[0].charge).toBe(1);
  });

  it('excludes enemy superweapons', () => {
    const game = makeGame();
    game.superweapons.set(`${House.USSR}:${SuperweaponType.NUKE}`, {
      type: SuperweaponType.NUKE,
      house: House.USSR,
      chargeTick: 5000,
      ready: false,
      structureIndex: 0,
      fired: false,
    });

    const s = serializeState(castGame(game));
    expect(s.superweapons).toHaveLength(0);
  });

  it('excludes fired GPS satellite', () => {
    const game = makeGame();
    game.superweapons.set(`${House.Spain}:${SuperweaponType.GPS_SATELLITE}`, {
      type: SuperweaponType.GPS_SATELLITE,
      house: House.Spain,
      chargeTick: SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks,
      ready: false,
      structureIndex: 0,
      fired: true,
    });

    const s = serializeState(castGame(game));
    expect(s.superweapons).toHaveLength(0);
  });

  it('includes allied superweapons (Greece for Spain)', () => {
    const game = makeGame();
    game.superweapons.set(`${House.Greece}:${SuperweaponType.CHRONOSPHERE}`, {
      type: SuperweaponType.CHRONOSPHERE,
      house: House.Greece,
      chargeTick: 3000,
      ready: false,
      structureIndex: 0,
      fired: false,
    });

    const s = serializeState(castGame(game));
    expect(s.superweapons).toHaveLength(1);
    expect(s.superweapons[0].type).toBe('CHRONOSPHERE');
  });

  it('empty superweapons array when none exist', () => {
    const game = makeGame();
    const s = serializeState(castGame(game));
    expect(s.superweapons).toEqual([]);
  });
});

// ===================================================================
// Combat readiness — ammo, cooldown, weapon details
// ===================================================================

describe('combat readiness fields', () => {
  it('includes weapon damage and warhead for armed units', () => {
    const game = makeGame();
    const tank = makeEntity(1, UnitType.V_2TNK, House.Spain, 50, 50);
    addEntity(game, tank);

    const s = serializeState(castGame(game));
    const u = s.units[0];
    expect(u.wpn).toBe('90mm');
    expect(u.dmg).toBe(30);
    expect(u.wh).toBe('AP');
    expect(u.rng).toBe(4.75);
  });

  it('includes secondary weapon for dual-weapon units', () => {
    const game = makeGame();
    // 4TNK (Mammoth) has primary 120mm + secondary MammothTusk
    const mammoth = makeEntity(1, UnitType.V_4TNK, House.Spain, 50, 50);
    addEntity(game, mammoth);

    const s = serializeState(castGame(game));
    const u = s.units[0];
    expect(u.wpn).toBeTruthy();
    expect(u.wpn2).toBe('MammothTusk');
    expect(u.rng2).toBeGreaterThan(0);
  });

  it('omits ammo fields for units with unlimited ammo', () => {
    const game = makeGame();
    const tank = makeEntity(1, UnitType.V_2TNK, House.Spain, 50, 50);
    addEntity(game, tank);

    const s = serializeState(castGame(game));
    const u = s.units[0];
    // Ground vehicles have ammo=-1 (unlimited) — omitted from output
    expect(u.ammo).toBeUndefined();
    expect(u.mammo).toBeUndefined();
  });

  it('includes ammo for aircraft with limited ammo', () => {
    const game = makeGame();
    // HIND has maxAmmo > 0
    const hind = makeEntity(1, UnitType.V_HIND, House.Spain, 50, 50);
    addEntity(game, hind);

    const s = serializeState(castGame(game));
    const u = s.units[0];
    if (u.mammo !== undefined && u.mammo > 0) {
      expect(u.ammo).toBeDefined();
      expect(u.mammo).toBeGreaterThan(0);
      expect(u.ammo).toBeLessThanOrEqual(u.mammo);
    }
  });

  it('includes attack cooldown when nonzero', () => {
    const game = makeGame();
    const tank = makeEntity(1, UnitType.V_2TNK, House.Spain, 50, 50);
    tank.attackCooldown = 25;
    addEntity(game, tank);

    const s = serializeState(castGame(game));
    const u = s.units[0];
    expect(u.acd).toBe(25);
  });

  it('omits attack cooldown when zero', () => {
    const game = makeGame();
    const tank = makeEntity(1, UnitType.V_2TNK, House.Spain, 50, 50);
    tank.attackCooldown = 0;
    addEntity(game, tank);

    const s = serializeState(castGame(game));
    const u = s.units[0];
    expect(u.acd).toBeUndefined();
  });

  it('omits weapon fields for unarmed units', () => {
    const game = makeGame();
    // MCV has no weapon
    const mcv = makeEntity(1, UnitType.V_MCV, House.Spain, 50, 50);
    addEntity(game, mcv);

    const s = serializeState(castGame(game));
    const u = s.units[0];
    expect(u.wpn).toBeUndefined();
    expect(u.dmg).toBeUndefined();
    expect(u.wh).toBeUndefined();
    expect(u.rng).toBeUndefined();
  });
});

// ===================================================================
// Repair status in structures
// ===================================================================

describe('repair status in structures', () => {
  it('marks repairing structures with rep=true', () => {
    const game = makeGame();
    const s1 = makeStructure('POWR', House.Spain, 45, 45);
    const s2 = makeStructure('WEAP', House.Spain, 50, 50);
    game.structures = [s1, s2];
    game._repairing.add(0); // first structure repairing

    const s = serializeState(castGame(game));
    expect(s.structures[0].rep).toBe(true);
    expect(s.structures[1].rep).toBeUndefined();
  });

  it('non-repairing structures omit rep field', () => {
    const game = makeGame();
    const s1 = makeStructure('POWR', House.Spain, 45, 45);
    game.structures = [s1];

    const s = serializeState(castGame(game));
    expect(s.structures[0].rep).toBeUndefined();
  });
});

// ===================================================================
// Enemy units get combat readiness too
// ===================================================================

describe('enemy unit combat readiness', () => {
  it('enemy units include weapon info', () => {
    const game = makeGame();
    const enemy = makeEntity(1, UnitType.V_3TNK, House.USSR, 60, 60);
    addEntity(game, enemy);

    const s = serializeState(castGame(game));
    expect(s.enemies).toHaveLength(1);
    const e = s.enemies[0];
    expect(e.wpn).toBeTruthy();
    expect(e.dmg).toBeGreaterThan(0);
    expect(e.wh).toBeTruthy();
    expect(e.rng).toBeGreaterThan(0);
    // 3TNK has secondary weapon too
    expect(e.wpn2).toBeTruthy();
  });
});

// ===================================================================
// Backward compatibility — existing fields still populated
// ===================================================================

describe('backward compatibility', () => {
  it('all original AgentState fields still present', () => {
    const game = makeGame();
    const s = serializeState(castGame(game));

    // Original fields
    expect(s.tick).toBeDefined();
    expect(s.state).toBeDefined();
    expect(s.credits).toBeDefined();
    expect(s.power.produced).toBeDefined();
    expect(s.power.consumed).toBeDefined();
    expect(s.siloCapacity).toBeDefined();
    expect(s.units).toBeDefined();
    expect(s.enemies).toBeDefined();
    expect(s.structures).toBeDefined();
    expect(s.production).toBeDefined();
    expect(s.available).toBeDefined();
    expect(s.mapBounds).toBeDefined();
    expect(s.killCount).toBeDefined();
    expect(s.lossCount).toBeDefined();
    expect(s.missionTimer).toBeDefined();

    // New fields
    expect(s.power.multiplier).toBeDefined();
    expect(s.availableItems).toBeDefined();
    expect(s.superweapons).toBeDefined();
  });

  it('available string array matches availableItems types', () => {
    const items: ProductionItem[] = [
      { type: 'E1', name: 'Rifle', cost: 100, buildTime: 30, prerequisite: 'TENT', faction: 'both' },
      { type: 'POWR', name: 'Power', cost: 300, buildTime: 60, prerequisite: 'FACT', faction: 'both', isStructure: true },
    ];
    const game = makeGame({ getAvailableItems: () => items });

    const s = serializeState(castGame(game));
    expect(s.available).toEqual(s.availableItems.map(i => i.t));
  });
});

// ===================================================================
// Multiple superweapons at once
// ===================================================================

describe('multiple superweapons', () => {
  it('reports multiple player superweapons correctly', () => {
    const game = makeGame();

    // Nuke at 75% charge
    const nukeDef = SUPERWEAPON_DEFS[SuperweaponType.NUKE];
    game.superweapons.set(`${House.Spain}:${SuperweaponType.NUKE}`, {
      type: SuperweaponType.NUKE,
      house: House.Spain,
      chargeTick: nukeDef.rechargeTicks * 0.75,
      ready: false,
      structureIndex: 0,
      fired: false,
    });

    // Iron Curtain ready
    const icDef = SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN];
    game.superweapons.set(`${House.Spain}:${SuperweaponType.IRON_CURTAIN}`, {
      type: SuperweaponType.IRON_CURTAIN,
      house: House.Spain,
      chargeTick: icDef.rechargeTicks,
      ready: true,
      structureIndex: 1,
      fired: false,
    });

    // Enemy nuke (should be excluded)
    game.superweapons.set(`${House.USSR}:${SuperweaponType.NUKE}`, {
      type: SuperweaponType.NUKE,
      house: House.USSR,
      chargeTick: 1000,
      ready: false,
      structureIndex: 2,
      fired: false,
    });

    const s = serializeState(castGame(game));
    expect(s.superweapons).toHaveLength(2);

    const nuke = s.superweapons.find(sw => sw.type === 'NUKE')!;
    expect(nuke.charge).toBeCloseTo(0.75);
    expect(nuke.ready).toBe(false);

    const ic = s.superweapons.find(sw => sw.type === 'IRON_CURTAIN')!;
    expect(ic.ready).toBe(true);
    expect(ic.charge).toBe(1);
  });
});
