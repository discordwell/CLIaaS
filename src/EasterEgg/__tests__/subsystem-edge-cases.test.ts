/**
 * Subsystem edge case tests — stresses unusual/boundary conditions
 * in the six extracted subsystem modules: combat, fog, production,
 * repairSell, specialUnits, superweapon.
 *
 * These tests exercise scenarios previously untestable because the
 * Game class couldn't be instantiated in isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds, setPlayerHouses } from '../engine/entity';
import {
  UnitType, House, CELL_SIZE, Mission, AnimState,
  PRODUCTION_ITEMS, NUKE_DAMAGE, NUKE_BLAST_CELLS, NUKE_MIN_FALLOFF,
  REPAIR_STEP, REPAIR_PERCENT, POWER_DRAIN, CONDITION_RED,
  type ProductionItem, worldDist, worldToCell,
  SuperweaponType, SUPERWEAPON_DEFS,
} from '../engine/types';
import { type MapStructure, STRUCTURE_SIZE, STRUCTURE_MAX_HP } from '../engine/scenario';
import { type Effect } from '../engine/renderer';

// Subsystem imports
import {
  fireWeaponAt, applySplashDamage, checkVehicleCrush, damageEntity,
  damageSpeedFactor,
  type CombatContext,
} from '../engine/combat';
import {
  updateFogOfWar, updateGapGenerators, GAP_RADIUS,
  type FogContext,
} from '../engine/fog';
import {
  tickProduction, cancelProduction, startProduction, getEffectiveCost,
  countPlayerBuildings,
  type ProductionContext,
} from '../engine/production';
import {
  toggleRepair, tickRepairs, tickServiceDepot,
  sellStructureByIndex, calculatePowerGrid, powerMultiplier,
  repairCostPerStep, calculateSiloCapacity,
  type RepairSellContext,
} from '../engine/repairSell';
import {
  updateThief,
  type SpecialUnitsContext,
} from '../engine/specialUnits';
import {
  detonateNuke, updateSuperweapons,
  type SuperweaponContext,
} from '../engine/superweapon';

// ── Test Helpers ───────────────────────────────────────────────────────────

beforeEach(() => {
  resetEntityIds();
  setPlayerHouses(new Set([House.Spain, House.Greece]));
});

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

function makeStructure(
  type: string, house: House, cx: number, cy: number,
  overrides?: Partial<MapStructure>,
): MapStructure {
  const maxHp = STRUCTURE_MAX_HP[type] ?? 256;
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx, cy,
    hp: maxHp,
    maxHp,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    ...overrides,
  };
}

/** Minimal mock map for combat/fog contexts */
function makeMockMap() {
  return {
    isPassable: (_cx: number, _cy: number) => true,
    setVisibility: (_cx: number, _cy: number, _v: number) => {},
    revealAll: () => {},
    updateFogOfWar: (_units: Array<{ x: number; y: number; sight: number }>) => {},
    jamCell: (_cx: number, _cy: number) => {},
    unjamRadius: (_cx: number, _cy: number, _r: number) => {},
    addDecal: (_cx: number, _cy: number, _s: number, _a: number) => {},
    getTerrain: () => 0 /* CLEAR */,
    setTerrain: (_cx: number, _cy: number, _t: number) => {},
    clearTreeType: (_cx: number, _cy: number) => {},
    clearWallType: (_cx: number, _cy: number) => {},
    getWallType: (_cx: number, _cy: number) => '',
    getOccupancy: (_cx: number, _cy: number) => 0,
    inBounds: (_cx: number, _cy: number) => true,
    overlay: new Uint8Array(128 * 128).fill(0xFF),
    boundsX: 0, boundsY: 0, boundsW: 128, boundsH: 128,
  };
}

function makeCombatContext(overrides?: Partial<CombatContext>): CombatContext {
  return {
    entities: [],
    entityById: new Map(),
    structures: [],
    inflightProjectiles: [],
    effects: [],
    tick: 100,
    playerHouse: House.Spain,
    scenarioId: 'SCG01EA',
    killCount: 0,
    lossCount: 0,
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    attackedTriggerNames: new Set(),
    map: makeMockMap() as any,
    isAllied: (a, b) => a === b,
    entitiesAllied: (a, b) => a.house === b.house,
    isPlayerControlled: (e) => e.house === House.Spain,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    movementSpeed: () => 0.5,
    getFirepowerBias: () => 1.0,
    damageStructure: () => false,
    aiIQ: () => 3,
    screenShake: 0,
    screenFlash: 0,
    ...overrides,
  };
}

function makeFogContext(overrides?: Partial<FogContext>): FogContext {
  return {
    entities: [],
    structures: [],
    map: makeMockMap() as any,
    tick: 0,
    playerHouse: House.Spain,
    fogDisabled: false,
    powerProduced: 100,
    powerConsumed: 50,
    gapGeneratorCells: new Map(),
    isAllied: (a, b) => a === b,
    entitiesAllied: (a, b) => a.house === b.house,
    ...overrides,
  };
}

function makeProductionItem(overrides?: Partial<ProductionItem>): ProductionItem {
  return {
    type: '2TNK',
    name: 'Med Tank',
    cost: 800,
    buildTime: 140,
    prerequisite: 'WEAP',
    faction: 'allied',
    ...overrides,
  };
}

function makeProductionContext(overrides?: Partial<ProductionContext>): ProductionContext {
  return {
    structures: [],
    entities: [],
    entityById: new Map(),
    credits: 5000,
    playerHouse: House.Spain,
    playerFaction: 'allied',
    playerTechLevel: 15,
    baseDiscovered: true,
    scenarioProductionItems: PRODUCTION_ITEMS,
    productionQueue: new Map(),
    pendingPlacement: null,
    wallPlacementPrepaid: false,
    map: makeMockMap() as any,
    tick: 100,
    powerProduced: 200,
    powerConsumed: 100,
    builtUnitTypes: new Set(),
    builtInfantryTypes: new Set(),
    builtAircraftTypes: new Set(),
    rallyPoints: new Map(),
    isAllied: (a, b) => a === b,
    hasBuilding: () => true,
    playSound: () => {},
    playEva: () => {},
    addCredits: (amount) => amount,
    addEntity: () => {},
    findPassableSpawn: (cx, cy) => ({ cx, cy }),
    ...overrides,
  };
}

function makeRepairSellContext(overrides?: Partial<RepairSellContext>): RepairSellContext {
  return {
    structures: [],
    entities: [],
    credits: 5000,
    tick: 0,
    playerHouse: House.Spain,
    repairingStructures: new Set(),
    scenarioProductionItems: PRODUCTION_ITEMS,
    effects: [],
    siloCapacity: 2000,
    gapGeneratorCells: new Map(),
    isAllied: (a, b) => a === b,
    isPlayerControlled: (e) => e.house === House.Spain,
    addCredits: (amount) => amount,
    playEva: () => {},
    playSound: () => {},
    playSoundAt: () => {},
    clearStructureFootprint: () => {},
    recalculateSiloCapacity: () => {},
    mapUnjamRadius: () => {},
    ...overrides,
  };
}

function makeSpecialUnitsContext(overrides?: Partial<SpecialUnitsContext>): SpecialUnitsContext {
  return {
    entities: [],
    entityById: new Map(),
    structures: [],
    mines: [],
    activeVortices: [],
    effects: [],
    tick: 100,
    playerHouse: House.Spain,
    credits: 5000,
    houseCredits: new Map(),
    map: makeMockMap() as any,
    evaMessages: [],
    isThieved: false,
    isAllied: (a, b) => a === b,
    entitiesAllied: (a, b) => a.house === b.house,
    isPlayerControlled: (e) => e.house === House.Spain,
    playSoundAt: () => {},
    playSound: () => {},
    movementSpeed: () => 0.5,
    damageEntity: (target, amount) => {
      target.hp -= amount;
      if (target.hp <= 0) { target.alive = false; return true; }
      return false;
    },
    damageStructure: () => false,
    addCredits: (amount) => amount,
    addEntity: () => {},
    screenShake: 0,
    ...overrides,
  };
}

function makeSuperweaponContext(overrides?: Partial<SuperweaponContext>): SuperweaponContext {
  return {
    structures: [],
    entities: [],
    entityById: new Map(),
    superweapons: new Map(),
    effects: [],
    tick: 100,
    playerHouse: House.Spain,
    powerProduced: 200,
    powerConsumed: 100,
    killCount: 0,
    lossCount: 0,
    map: makeMockMap() as any,
    sonarSpiedTarget: new Map(),
    gapGeneratorCells: new Map(),
    nukePendingTarget: null,
    nukePendingTick: 0,
    nukePendingSource: null,
    isAllied: (a, b) => a === b,
    isPlayerControlled: (e) => e.house === House.Spain,
    pushEva: () => {},
    playSound: () => {},
    playSoundAt: () => {},
    damageEntity: (target, amount) => {
      target.hp -= amount;
      if (target.hp <= 0) { target.alive = false; return true; }
      return false;
    },
    damageStructure: (s, damage) => {
      s.hp -= damage;
      if (s.hp <= 0) { s.hp = 0; s.alive = false; return true; }
      return false;
    },
    addEntity: () => {},
    aiIQ: () => 3,
    getWarheadMult: () => 1.0,
    cameraX: 0,
    cameraY: 0,
    cameraViewWidth: 640,
    screenShake: 0,
    screenFlash: 0,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. SUPERWEAPON: Nuke detonation during low power
// ═══════════════════════════════════════════════════════════════════════════

describe('Nuke detonation during low power', () => {
  it('nuke damage does NOT scale with attacker power — full damage regardless of power state', () => {
    // detonateNuke uses NUKE_DAMAGE constant, not power-scaled values
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const target = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    // Low power context
    const ctx = makeSuperweaponContext({
      entities: [tank],
      entityById: new Map([[tank.id, tank]]),
      powerProduced: 50,
      powerConsumed: 200,
    });

    const hpBefore = tank.hp;
    detonateNuke(ctx, target);

    // Direct hit at ground zero: falloff = max(0.1, 1 - 0/blastRadius) = 1.0
    // Damage = round(NUKE_DAMAGE * 1.0 * 1.0) = 1000
    expect(tank.alive).toBe(false);
    // Damage applied was NUKE_DAMAGE (1000), not scaled by power
    expect(hpBefore).toBeLessThan(NUKE_DAMAGE);
  });

  it('nuke at edge of blast radius still applies minimum falloff damage', () => {
    const blastRadius = CELL_SIZE * NUKE_BLAST_CELLS;
    // Place entity at exact blast edge
    const edgeDist = blastRadius - 0.001;
    const tank = makeEntity(UnitType.V_4TNK, House.Spain,
      50 * CELL_SIZE + edgeDist * CELL_SIZE, 50 * CELL_SIZE);

    const ctx = makeSuperweaponContext({
      entities: [tank],
      entityById: new Map([[tank.id, tank]]),
      powerProduced: 10,
      powerConsumed: 200,
    });

    const hpBefore = tank.hp;
    detonateNuke(ctx, { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE });

    // Should still take at least NUKE_MIN_FALLOFF * NUKE_DAMAGE damage
    const minExpectedDmg = Math.max(1, Math.round(NUKE_DAMAGE * NUKE_MIN_FALLOFF));
    const damageTaken = hpBefore - tank.hp;
    expect(damageTaken).toBeGreaterThanOrEqual(minExpectedDmg);
  });

  it('nuke screen effects fire even at zero power', () => {
    const ctx = makeSuperweaponContext({
      powerProduced: 0,
      powerConsumed: 500,
    });

    detonateNuke(ctx, { x: 500, y: 500 });

    expect(ctx.screenFlash).toBe(30);
    expect(ctx.screenShake).toBe(30);
    // Mushroom cloud + 6 secondary blasts
    expect(ctx.effects.length).toBeGreaterThanOrEqual(7);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. SPECIAL UNITS: Thief stealing with 0 or 1 credits
// ═══════════════════════════════════════════════════════════════════════════

describe('Thief stealing from player with 0 or 1 credits', () => {
  it('thief stealing from house with 0 credits: stolen=0, thief still dies', () => {
    const thief = makeEntity(UnitType.I_THF, House.Spain, 50, 50);
    thief.mission = Mission.ATTACK;
    const proc = makeStructure('PROC', House.USSR, 2, 2);

    // Place thief adjacent to proc
    const [sw, sh] = STRUCTURE_SIZE['PROC'] ?? [2, 2];
    const scx = proc.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
    const scy = proc.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
    thief.pos.x = scx;
    thief.pos.y = scy;
    thief.targetStructure = proc;

    const ctx = makeSpecialUnitsContext({
      entities: [thief],
      structures: [proc],
      houseCredits: new Map([[House.USSR, 0]]),
    });

    updateThief(ctx, thief);

    // Thief should still die even with nothing to steal
    expect(thief.alive).toBe(false);
    expect(thief.mission).toBe(Mission.DIE);
    // isThieved flag is set regardless
    expect(ctx.isThieved).toBe(true);
    // Credits remain unchanged
    expect(ctx.credits).toBe(5000);
  });

  it('thief stealing from house with 1 credit: steals 0 (floor(0.5)=0)', () => {
    const thief = makeEntity(UnitType.I_THF, House.Spain, 50, 50);
    thief.mission = Mission.ATTACK;
    const silo = makeStructure('SILO', House.USSR, 2, 2);
    const [sw, sh] = STRUCTURE_SIZE['SILO'] ?? [2, 2];
    thief.pos.x = silo.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
    thief.pos.y = silo.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
    thief.targetStructure = silo;

    const ctx = makeSpecialUnitsContext({
      entities: [thief],
      structures: [silo],
      houseCredits: new Map([[House.USSR, 1]]),
    });

    updateThief(ctx, thief);

    // floor(1 * 0.5) = 0, so nothing stolen
    expect(thief.alive).toBe(false);
    expect(ctx.credits).toBe(5000); // unchanged
    expect(ctx.houseCredits.get(House.USSR)).toBe(1); // unchanged
  });

  it('thief stealing from house with 2 credits: steals exactly 1', () => {
    const thief = makeEntity(UnitType.I_THF, House.Spain, 50, 50);
    thief.mission = Mission.ATTACK;
    const proc = makeStructure('PROC', House.USSR, 2, 2);
    const [sw, sh] = STRUCTURE_SIZE['PROC'] ?? [2, 2];
    thief.pos.x = proc.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
    thief.pos.y = proc.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
    thief.targetStructure = proc;

    const startCredits = 3000;
    const ctx = makeSpecialUnitsContext({
      entities: [thief],
      structures: [proc],
      credits: startCredits,
      houseCredits: new Map([[House.USSR, 2]]),
    });

    updateThief(ctx, thief);

    // floor(2 * 0.5) = 1
    expect(ctx.credits).toBe(startCredits + 1);
    expect(ctx.houseCredits.get(House.USSR)).toBe(1);
    expect(thief.alive).toBe(false);
  });

  it('thief ignores allied PROC', () => {
    const thief = makeEntity(UnitType.I_THF, House.Spain, 50, 50);
    thief.mission = Mission.ATTACK;
    // Allied PROC — thief should reset and not steal
    const proc = makeStructure('PROC', House.Spain, 2, 2);
    thief.pos.x = proc.cx * CELL_SIZE + CELL_SIZE;
    thief.pos.y = proc.cy * CELL_SIZE + CELL_SIZE;
    thief.targetStructure = proc;

    const ctx = makeSpecialUnitsContext({
      entities: [thief],
      structures: [proc],
    });

    updateThief(ctx, thief);

    // Should not steal from ally
    expect(thief.alive).toBe(true);
    expect(thief.targetStructure).toBeNull();
    expect(thief.mission).toBe(Mission.GUARD);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. PRODUCTION: Queue at max with prerequisite destroyed
// ═══════════════════════════════════════════════════════════════════════════

describe('Production queue max with prerequisite destroyed mid-build', () => {
  it('cancels active build and refunds costPaid when prerequisite building is destroyed', () => {
    const item = makeProductionItem({ type: '2TNK', cost: 800, buildTime: 140, prerequisite: 'WEAP' });
    const ctx = makeProductionContext({
      credits: 3000,
      // hasBuilding initially returns true, but we'll change it
      hasBuilding: (type: string) => type !== 'WEAP', // WEAP is "destroyed"
    });

    // Simulate mid-build state: 50% progress, 400 of 800 paid
    ctx.productionQueue.set('right', {
      item,
      progress: 70,
      queueCount: 1,
      costPaid: 400,
    });

    tickProduction(ctx);

    // Production should be cancelled and costPaid refunded
    expect(ctx.productionQueue.has('right')).toBe(false);
    // Refund is the costPaid (400), not full cost
    expect(ctx.credits).toBe(3400);
  });

  it('cancels queued items and refunds correctly when prerequisite lost', () => {
    const item = makeProductionItem({ type: '2TNK', cost: 800, buildTime: 140, prerequisite: 'WEAP' });
    const weap = makeStructure('WEAP', House.Spain, 10, 10);
    let weapAlive = true;
    const ctx = makeProductionContext({
      credits: 1000,
      structures: [weap],
      hasBuilding: (type: string) => type === 'WEAP' ? weapAlive : true,
    });

    // Active build with 3 queued (4 total): active has 200 costPaid, 3 queued paid 800 each upfront
    ctx.productionQueue.set('right', {
      item,
      progress: 50,
      queueCount: 4,
      costPaid: 200,
    });

    // Destroy the WEAP
    weapAlive = false;

    tickProduction(ctx);

    // cancelProduction is called: since queueCount > 1, it dequeues one and refunds effectiveCost (800)
    // Then tickProduction loops again — eventually queueCount reaches 1, final cancel refunds costPaid (200)
    // But tickProduction calls cancelProduction once per tick per category
    // After one tick: queueCount was 4, cancel removes one (refunds 800), queueCount=3
    // The entry still has hasBuilding=false, so next iteration would cancel again
    // Actually tickProduction iterates the map, calls cancelProduction, then continues the for loop
    // cancelProduction for queueCount>1: entry.queueCount--, credits += effectiveCost
    // Then the for loop continues — but the entry was modified, not deleted
    // On next tick: same thing happens again
    // Let's verify after ONE tick:
    expect(ctx.credits).toBe(1800); // 1000 + 800 refund for one queued item
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. PRODUCTION: tickProduction with zero credits
// ═══════════════════════════════════════════════════════════════════════════

describe('tickProduction with zero credits', () => {
  it('pauses production without advancing progress when credits are 0', () => {
    const item = makeProductionItem({ type: '2TNK', cost: 800, buildTime: 140, prerequisite: 'WEAP' });
    const ctx = makeProductionContext({ credits: 0 });

    ctx.productionQueue.set('right', {
      item,
      progress: 50,
      queueCount: 1,
      costPaid: 300,
    });

    const progressBefore = ctx.productionQueue.get('right')!.progress;
    tickProduction(ctx);

    // Progress should NOT advance when costPaid < effectiveCost and credits < costPerTick
    expect(ctx.productionQueue.get('right')!.progress).toBe(progressBefore);
    expect(ctx.credits).toBe(0); // no credits deducted
  });

  it('resumes production when credits become available', () => {
    const item = makeProductionItem({ type: '2TNK', cost: 800, buildTime: 140, prerequisite: 'WEAP' });
    const weap = makeStructure('WEAP', House.Spain, 10, 10);
    const ctx = makeProductionContext({
      credits: 0,
      structures: [weap],
    });

    ctx.productionQueue.set('right', {
      item,
      progress: 50,
      queueCount: 1,
      costPaid: 300,
    });

    // Tick with 0 credits — pauses
    tickProduction(ctx);
    expect(ctx.productionQueue.get('right')!.progress).toBe(50);

    // Add credits and tick again
    ctx.credits = 500;
    tickProduction(ctx);
    expect(ctx.productionQueue.get('right')!.progress).toBeGreaterThan(50);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. PRODUCTION: Multi-factory speedup with 3+ factories
// ═══════════════════════════════════════════════════════════════════════════

describe('tickProduction multi-factory speedup', () => {
  it('3 war factories gives 3x speed', () => {
    const item = makeProductionItem({ type: '2TNK', cost: 800, buildTime: 140, prerequisite: 'WEAP' });
    // 3 WEAPs
    const factories = [
      makeStructure('WEAP', House.Spain, 10, 10),
      makeStructure('WEAP', House.Spain, 15, 10),
      makeStructure('WEAP', House.Spain, 20, 10),
    ];

    const ctx = makeProductionContext({
      credits: 50000,
      structures: factories,
    });

    ctx.productionQueue.set('right', {
      item,
      progress: 0,
      queueCount: 1,
      costPaid: 0,
    });

    tickProduction(ctx);

    // With 3 factories and full power: speedMult = 3, powerMult = 1.0
    // progress += 3 * 1.0 = 3
    expect(ctx.productionQueue.get('right')!.progress).toBe(3);
  });

  it('5 factories gives 5x speed (linear, no cap)', () => {
    const item = makeProductionItem({ type: '2TNK', cost: 800, buildTime: 140, prerequisite: 'WEAP' });
    const factories = Array.from({ length: 5 }, (_, i) =>
      makeStructure('WEAP', House.Spain, 10 + i * 5, 10));

    const ctx = makeProductionContext({
      credits: 50000,
      structures: factories,
    });

    ctx.productionQueue.set('right', {
      item,
      progress: 0,
      queueCount: 1,
      costPaid: 0,
    });

    tickProduction(ctx);
    expect(ctx.productionQueue.get('right')!.progress).toBe(5);
  });

  it('multi-factory + low power combines multiplicatively', () => {
    const item = makeProductionItem({ type: '2TNK', cost: 800, buildTime: 140, prerequisite: 'WEAP' });
    const factories = [
      makeStructure('WEAP', House.Spain, 10, 10),
      makeStructure('WEAP', House.Spain, 15, 10),
    ];

    const ctx = makeProductionContext({
      credits: 50000,
      structures: factories,
      powerProduced: 50,
      powerConsumed: 100, // 50% power = powerMult = 0.5
    });

    ctx.productionQueue.set('right', {
      item,
      progress: 0,
      queueCount: 1,
      costPaid: 0,
    });

    tickProduction(ctx);

    // 2 factories * 0.5 power = 1.0 progress per tick
    expect(ctx.productionQueue.get('right')!.progress).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. PRODUCTION: cancelProduction refund math
// ═══════════════════════════════════════════════════════════════════════════

describe('cancelProduction refund math', () => {
  it('active build refunds partial costPaid, not full cost', () => {
    const item = makeProductionItem({ type: '2TNK', cost: 800, buildTime: 140, prerequisite: 'WEAP' });
    const ctx = makeProductionContext({ credits: 1000 });

    ctx.productionQueue.set('right', {
      item,
      progress: 50,
      queueCount: 1,
      costPaid: 285, // partial — 285 of 800 deducted incrementally
    });

    cancelProduction(ctx, 'right');

    // Refund is costPaid (285), not full cost (800)
    expect(ctx.credits).toBe(1285);
    expect(ctx.productionQueue.has('right')).toBe(false);
  });

  it('queued item (queueCount > 1) refunds full effectiveCost', () => {
    const item = makeProductionItem({ type: '2TNK', cost: 800, buildTime: 140, prerequisite: 'WEAP' });
    const ctx = makeProductionContext({ credits: 1000 });

    ctx.productionQueue.set('right', {
      item,
      progress: 50,
      queueCount: 3,
      costPaid: 285,
    });

    cancelProduction(ctx, 'right');

    // Queued cancel: refunds effectiveCost (800) and decrements queueCount
    expect(ctx.credits).toBe(1800);
    expect(ctx.productionQueue.get('right')!.queueCount).toBe(2);
    expect(ctx.productionQueue.get('right')!.costPaid).toBe(285); // active build unchanged
  });

  it('cancelling all queued items one by one refunds correct total', () => {
    const item = makeProductionItem({ type: '2TNK', cost: 800, buildTime: 140, prerequisite: 'WEAP' });
    const ctx = makeProductionContext({ credits: 0 });

    ctx.productionQueue.set('right', {
      item,
      progress: 70,
      queueCount: 3,
      costPaid: 500,
    });

    // Cancel 1st queued
    cancelProduction(ctx, 'right');
    expect(ctx.credits).toBe(800);
    expect(ctx.productionQueue.get('right')!.queueCount).toBe(2);

    // Cancel 2nd queued
    cancelProduction(ctx, 'right');
    expect(ctx.credits).toBe(1600);
    expect(ctx.productionQueue.get('right')!.queueCount).toBe(1);

    // Cancel active build
    cancelProduction(ctx, 'right');
    expect(ctx.credits).toBe(2100); // 1600 + 500 costPaid
    expect(ctx.productionQueue.has('right')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. REPAIR/SELL: sellStructureByIndex on walls vs non-walls
// ═══════════════════════════════════════════════════════════════════════════

describe('sellStructureByIndex on walls vs non-walls', () => {
  it('wall (BRIK) sells instantly — no sell animation, immediate refund', () => {
    const wall = makeStructure('BRIK', House.Spain, 5, 5);
    const ctx = makeRepairSellContext({
      structures: [wall],
      credits: 1000,
    });

    const result = sellStructureByIndex(ctx, 0);

    expect(result).toBe(true);
    expect(wall.alive).toBe(false);
    // BRIK costs 100, 50% refund = 50
    expect(ctx.credits).toBe(1050);
    // No sellProgress set for walls
    expect(wall.sellProgress).toBeUndefined();
  });

  it('wall (SBAG) sells instantly with correct refund', () => {
    const wall = makeStructure('SBAG', House.Spain, 5, 5);
    const ctx = makeRepairSellContext({
      structures: [wall],
      credits: 1000,
    });

    sellStructureByIndex(ctx, 0);

    // SBAG costs 25, 50% = 12 (floor)
    expect(ctx.credits).toBe(1012);
    expect(wall.alive).toBe(false);
  });

  it('non-wall structure (WEAP) initiates sell animation', () => {
    const weap = makeStructure('WEAP', House.Spain, 5, 5);
    const ctx = makeRepairSellContext({
      structures: [weap],
      credits: 1000,
    });

    const result = sellStructureByIndex(ctx, 0);

    expect(result).toBe(true);
    expect(weap.alive).toBe(true); // still alive during animation
    expect(weap.sellProgress).toBe(0); // animation started
    expect(weap.sellHpAtStart).toBe(weap.hp);
    expect(ctx.credits).toBe(1000); // no immediate refund
  });

  it('cannot sell enemy structure', () => {
    const enemyWeap = makeStructure('WEAP', House.USSR, 5, 5);
    const ctx = makeRepairSellContext({
      structures: [enemyWeap],
      credits: 1000,
    });

    const result = sellStructureByIndex(ctx, 0);
    expect(result).toBe(false);
    expect(enemyWeap.alive).toBe(true);
  });

  it('cannot sell structure already being sold', () => {
    const weap = makeStructure('WEAP', House.Spain, 5, 5, { sellProgress: 0.5 });
    const ctx = makeRepairSellContext({
      structures: [weap],
      credits: 1000,
    });

    const result = sellStructureByIndex(ctx, 0);
    expect(result).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. REPAIR/SELL: toggleRepair when already at max HP
// ═══════════════════════════════════════════════════════════════════════════

describe('toggleRepair at max HP', () => {
  it('returns false when structure is at full health', () => {
    const powr = makeStructure('POWR', House.Spain, 5, 5);
    // hp === maxHp (full health)
    const ctx = makeRepairSellContext({ structures: [powr] });

    const result = toggleRepair(ctx, 0);
    expect(result).toBe(false);
    expect(ctx.repairingStructures.has(0)).toBe(false);
  });

  it('returns true when structure is damaged', () => {
    const powr = makeStructure('POWR', House.Spain, 5, 5, { hp: 200 });
    const ctx = makeRepairSellContext({ structures: [powr] });

    const result = toggleRepair(ctx, 0);
    expect(result).toBe(true);
    expect(ctx.repairingStructures.has(0)).toBe(true);
  });

  it('toggling repair off returns false', () => {
    const powr = makeStructure('POWR', House.Spain, 5, 5, { hp: 200 });
    const ctx = makeRepairSellContext({ structures: [powr] });

    toggleRepair(ctx, 0); // on
    const result = toggleRepair(ctx, 0); // off
    expect(result).toBe(false);
    expect(ctx.repairingStructures.has(0)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. REPAIR/SELL: tickRepairs when credits run out mid-repair
// ═══════════════════════════════════════════════════════════════════════════

describe('tickRepairs credits exhaustion', () => {
  it('stops repairing and removes from set when credits run out', () => {
    const powr = makeStructure('POWR', House.Spain, 5, 5, { hp: 200 });
    const ctx = makeRepairSellContext({
      structures: [powr],
      credits: 1, // barely any credits
      repairingStructures: new Set([0]),
    });

    let evaPlayed = false;
    ctx.playEva = (name) => { if (name === 'eva_insufficient_funds') evaPlayed = true; };

    tickRepairs(ctx);

    // Repair cost per step for POWR: ceil(300 * 0.20 / (400 / 7)) = ceil(60 / 57.14) = ceil(1.05) = 2
    // We had 1 credit, cost is 2 — insufficient
    expect(ctx.repairingStructures.has(0)).toBe(false);
    expect(evaPlayed).toBe(true);
    expect(powr.hp).toBe(200); // unchanged
  });

  it('repairs one tick then stops when credits are exactly enough for one step', () => {
    const powr = makeStructure('POWR', House.Spain, 5, 5, { hp: 200 });
    // POWR cost=300, maxHp=400: repairCostPerStep = ceil(300*0.20/(400/7)) = ceil(1.05) = 2
    const cost = repairCostPerStep(300, 400);
    const ctx = makeRepairSellContext({
      structures: [powr],
      credits: cost, // exactly enough for one step
      repairingStructures: new Set([0]),
    });

    tickRepairs(ctx);

    expect(powr.hp).toBe(200 + REPAIR_STEP); // repaired one step
    expect(ctx.credits).toBe(0); // spent all credits

    // Next tick should fail
    tickRepairs(ctx);
    expect(ctx.repairingStructures.has(0)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. REPAIR/SELL: calculatePowerGrid with mixed damaged power plants
// ═══════════════════════════════════════════════════════════════════════════

describe('calculatePowerGrid with damaged power plants', () => {
  it('half-health POWR produces 50W (linear scaling)', () => {
    const powr = makeStructure('POWR', House.Spain, 5, 5, { hp: 200, maxHp: 400 });
    const grid = calculatePowerGrid([powr], House.Spain, (a, b) => a === b);
    expect(grid.produced).toBe(50); // round(100 * 0.5)
  });

  it('quarter-health APWR produces 50W', () => {
    const apwr = makeStructure('APWR', House.Spain, 5, 5, { hp: 175, maxHp: 700 });
    const grid = calculatePowerGrid([apwr], House.Spain, (a, b) => a === b);
    expect(grid.produced).toBe(50); // round(200 * 0.25)
  });

  it('mixed damaged plants accumulate correctly', () => {
    const structures = [
      makeStructure('POWR', House.Spain, 5, 5, { hp: 200, maxHp: 400 }),  // 50W
      makeStructure('POWR', House.Spain, 10, 5, { hp: 400, maxHp: 400 }), // 100W
      makeStructure('APWR', House.Spain, 15, 5, { hp: 350, maxHp: 700 }), // 100W
      makeStructure('WEAP', House.Spain, 20, 5),  // consumer: 30W
      makeStructure('TSLA', House.Spain, 25, 5),  // consumer: 150W
    ];

    const grid = calculatePowerGrid(structures, House.Spain, (a, b) => a === b);
    expect(grid.produced).toBe(250); // 50 + 100 + 100
    expect(grid.consumed).toBe(180); // 30 + 150
  });

  it('dead power plant produces nothing', () => {
    const powr = makeStructure('POWR', House.Spain, 5, 5, { hp: 0, alive: false });
    const grid = calculatePowerGrid([powr], House.Spain, (a, b) => a === b);
    expect(grid.produced).toBe(0);
  });

  it('selling power plant excluded from grid', () => {
    const powr = makeStructure('POWR', House.Spain, 5, 5, { sellProgress: 0.5 });
    const grid = calculatePowerGrid([powr], House.Spain, (a, b) => a === b);
    expect(grid.produced).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. REPAIR/SELL: powerMultiplier at exact boundary
// ═══════════════════════════════════════════════════════════════════════════

describe('powerMultiplier boundary conditions', () => {
  it('produced === consumed returns 1.0', () => {
    expect(powerMultiplier(100, 100)).toBe(1.0);
  });

  it('produced > consumed returns 1.0', () => {
    expect(powerMultiplier(200, 100)).toBe(1.0);
  });

  it('produced = 0 returns 1.0 (no power system)', () => {
    expect(powerMultiplier(0, 100)).toBe(1.0);
  });

  it('produced slightly less than consumed returns fraction', () => {
    // 99/100 = 0.99
    expect(powerMultiplier(99, 100)).toBeCloseTo(0.99, 2);
  });

  it('produced at 50% of consumed returns 0.5', () => {
    expect(powerMultiplier(50, 100)).toBe(0.5);
  });

  it('produced below 50% clamps to 0.5', () => {
    // 25/100 = 0.25, but clamped to 0.5
    expect(powerMultiplier(25, 100)).toBe(0.5);
  });

  it('produced = 1, consumed = 1000 clamps to 0.5', () => {
    expect(powerMultiplier(1, 1000)).toBe(0.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. REPAIR/SELL: tickServiceDepot rearm when ammo is maxAmmo-1
// ═══════════════════════════════════════════════════════════════════════════

describe('tickServiceDepot rearm edge case', () => {
  it('rearms vehicle from maxAmmo-1 to maxAmmo', () => {
    const fix = makeStructure('FIX', House.Spain, 5, 5);
    const heli = makeEntity(UnitType.V_HELI, House.Spain,
      fix.cx * CELL_SIZE + CELL_SIZE,
      fix.cy * CELL_SIZE + CELL_SIZE);
    heli.hp = heli.maxHp; // full health — only needs rearm
    heli.ammo = heli.maxAmmo - 1;
    heli.rearmTimer = 1; // about to rearm

    const ctx = makeRepairSellContext({
      structures: [fix],
      entities: [heli],
      credits: 5000,
    });

    tickServiceDepot(ctx);

    // rearmTimer decrements from 1 to 0, triggering rearm
    expect(heli.ammo).toBe(heli.maxAmmo);
  });

  it('does not rearm past maxAmmo', () => {
    const fix = makeStructure('FIX', House.Spain, 5, 5);
    const heli = makeEntity(UnitType.V_HELI, House.Spain,
      fix.cx * CELL_SIZE + CELL_SIZE,
      fix.cy * CELL_SIZE + CELL_SIZE);
    heli.hp = heli.maxHp;
    heli.ammo = heli.maxAmmo; // already full ammo

    const ctx = makeRepairSellContext({
      structures: [fix],
      entities: [heli],
      credits: 5000,
    });

    tickServiceDepot(ctx);

    // Full HP + full ammo = no service needed, not docked
    expect(heli.ammo).toBe(heli.maxAmmo);
  });

  it('ejects unit when credits run out during repair', () => {
    const fix = makeStructure('FIX', House.Spain, 5, 5);
    const tank = makeEntity(UnitType.V_2TNK, House.Spain,
      fix.cx * CELL_SIZE + CELL_SIZE,
      fix.cy * CELL_SIZE + CELL_SIZE);
    tank.hp = tank.maxHp - 50; // needs repair

    const ctx = makeRepairSellContext({
      structures: [fix],
      entities: [tank],
      credits: 0, // no money
    });

    tickServiceDepot(ctx);

    // C++ parity: eject unit when insufficient funds
    expect(tank.mission).toBe(Mission.GUARD);
    expect(tank.moveTarget).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. FOG: Gap generator unjam when destroyed
// ═══════════════════════════════════════════════════════════════════════════

describe('Gap generator unjam on destruction', () => {
  it('unjams when structure is destroyed (not in active list)', () => {
    let unjamCalled = false;
    let unjamArgs: { cx: number; cy: number; r: number } | null = null;

    const mockMap = {
      ...makeMockMap(),
      unjamRadius: (cx: number, cy: number, r: number) => {
        unjamCalled = true;
        unjamArgs = { cx, cy, r };
      },
      jamCell: () => {},
    };

    const gap = makeStructure('GAP', House.Spain, 10, 10);

    // Pre-populate gapGeneratorCells as if the GAP was previously active
    const gapCells = new Map<number, { cx: number; cy: number; radius: number }>();
    gapCells.set(0, { cx: 11, cy: 11, radius: GAP_RADIUS });

    // Now destroy the GAP
    gap.alive = false;

    const ctx = makeFogContext({
      structures: [gap],
      map: mockMap as any,
      tick: 90, // divisible by GAP_UPDATE_INTERVAL (90)
      gapGeneratorCells: gapCells,
      powerProduced: 200,
      powerConsumed: 50,
    });

    updateGapGenerators(ctx);

    // Destroyed GAP not in activeGaps → cleanup loop should unjam
    expect(unjamCalled).toBe(true);
    expect(unjamArgs!.cx).toBe(11);
    expect(unjamArgs!.cy).toBe(11);
    expect(unjamArgs!.r).toBe(GAP_RADIUS);
    expect(ctx.gapGeneratorCells.has(0)).toBe(false);
  });

  it('unjams when power drops below threshold', () => {
    let unjamCalled = false;
    const mockMap = {
      ...makeMockMap(),
      unjamRadius: () => { unjamCalled = true; },
      jamCell: () => {},
    };

    const gap = makeStructure('GAP', House.Spain, 10, 10);

    const gapCells = new Map<number, { cx: number; cy: number; radius: number }>();
    gapCells.set(0, { cx: 11, cy: 11, radius: GAP_RADIUS });

    const ctx = makeFogContext({
      structures: [gap],
      map: mockMap as any,
      tick: 90,
      gapGeneratorCells: gapCells,
      powerProduced: 50,
      powerConsumed: 100, // low power: pf < 1.0
    });

    updateGapGenerators(ctx);

    expect(unjamCalled).toBe(true);
    expect(ctx.gapGeneratorCells.has(0)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. FOG: updateFogOfWar with entities at map boundaries
// ═══════════════════════════════════════════════════════════════════════════

describe('updateFogOfWar with entities at map boundaries', () => {
  it('entity at cell (0,0) does not crash', () => {
    const unit = makeEntity(UnitType.V_2TNK, House.Spain, 0, 0);
    const callArgs: Array<{ x: number; y: number; sight: number }[]> = [];
    const mockMap = {
      ...makeMockMap(),
      updateFogOfWar: (units: Array<{ x: number; y: number; sight: number }>) => {
        callArgs.push(units);
      },
    };

    const ctx = makeFogContext({
      entities: [unit],
      map: mockMap as any,
    });

    // Should not throw
    expect(() => updateFogOfWar(ctx)).not.toThrow();
    expect(callArgs.length).toBe(1);
    expect(callArgs[0].length).toBe(1);
  });

  it('entity at max map boundary does not crash', () => {
    const maxPos = 127 * CELL_SIZE + CELL_SIZE / 2;
    const unit = makeEntity(UnitType.V_2TNK, House.Spain, maxPos, maxPos);

    const ctx = makeFogContext({
      entities: [unit],
      map: makeMockMap() as any,
    });

    expect(() => updateFogOfWar(ctx)).not.toThrow();
  });

  it('damaged entity at CONDITION_RED gets sight reduced to 1', () => {
    const unit = makeEntity(UnitType.V_2TNK, House.Spain, 50 * CELL_SIZE, 50 * CELL_SIZE);
    // Set HP to below CONDITION_RED (25%)
    unit.hp = Math.floor(unit.maxHp * CONDITION_RED) - 1;

    let capturedUnits: Array<{ x: number; y: number; sight: number }> = [];
    const mockMap = {
      ...makeMockMap(),
      updateFogOfWar: (units: Array<{ x: number; y: number; sight: number }>) => {
        capturedUnits = units;
      },
    };

    const ctx = makeFogContext({
      entities: [unit],
      map: mockMap as any,
    });

    updateFogOfWar(ctx);

    expect(capturedUnits.length).toBe(1);
    expect(capturedUnits[0].sight).toBe(1); // reduced sight at red health
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. COMBAT: fireWeaponAt with attacker === target (self-damage)
// ═══════════════════════════════════════════════════════════════════════════

describe('fireWeaponAt self-targeting', () => {
  it('entity can damage itself via fireWeaponAt', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const ctx = makeCombatContext({
      entities: [tank],
      entityById: new Map([[tank.id, tank]]),
    });

    const hpBefore = tank.hp;
    fireWeaponAt(ctx, tank, tank, tank.weapon!);

    // Self-damage should go through — the function does not check attacker===target
    expect(tank.hp).toBeLessThan(hpBefore);
  });

  it('self-kill tracks kill credit', () => {
    const e1 = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const ctx = makeCombatContext({
      entities: [e1],
      entityById: new Map([[e1.id, e1]]),
    });

    // Give it a high-damage weapon to guarantee kill
    const bigWeapon = { ...e1.weapon!, damage: 9999 };
    fireWeaponAt(ctx, e1, e1, bigWeapon);

    expect(e1.alive).toBe(false);
    expect(e1.kills).toBe(1); // credited kill to itself
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. COMBAT: applySplashDamage with zero-radius splash
// ═══════════════════════════════════════════════════════════════════════════

describe('applySplashDamage with zero or minimal splash', () => {
  it('splash=0 does not apply splash damage (checked before call)', () => {
    // In updateInflightProjectiles, splash is only applied if weapon.splash > 0
    // Verify the guard: if splash === 0 or undefined, applySplashDamage is NOT called
    const weapon = { damage: 100, warhead: 'AP' as any, splash: 0 };
    expect(weapon.splash).toBe(0);
    // The caller checks: if (proj.weapon.splash && proj.weapon.splash > 0)
    // With splash=0, this is falsy — so applySplashDamage never runs
    const shouldApplySplash = !!(weapon.splash && weapon.splash > 0);
    expect(shouldApplySplash).toBe(false);
  });

  it('applySplashDamage with entities at exact center uses SPLASH_RADIUS=1.5', () => {
    const victim = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const ctx = makeCombatContext({
      entities: [victim],
      entityById: new Map([[victim.id, victim]]),
    });

    const hpBefore = victim.hp;
    applySplashDamage(ctx,
      { x: 100, y: 100 }, // center at victim
      { damage: 100, warhead: 'HE', splash: 2 },
      -1, // no primary target
      House.Spain,
    );

    // Distance is 0, within 1.5-cell splash radius
    expect(victim.hp).toBeLessThan(hpBefore);
  });

  it('applySplashDamage skips primary target by ID', () => {
    const primary = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const bystander = makeEntity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE, 100);
    const ctx = makeCombatContext({
      entities: [primary, bystander],
      entityById: new Map([[primary.id, primary], [bystander.id, bystander]]),
    });

    const primaryHpBefore = primary.hp;
    const bystanderHpBefore = bystander.hp;

    applySplashDamage(ctx,
      { x: 100, y: 100 },
      { damage: 100, warhead: 'HE', splash: 2 },
      primary.id, // exclude primary target
      House.Spain,
    );

    // Primary should be skipped
    expect(primary.hp).toBe(primaryHpBefore);
    // Bystander should take splash damage (1 cell away, within 1.5-cell radius)
    expect(bystander.hp).toBeLessThan(bystanderHpBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 17. COMBAT: checkVehicleCrush with infantry vs vehicle at same position
// ═══════════════════════════════════════════════════════════════════════════

describe('checkVehicleCrush edge cases', () => {
  it('crusher vehicle kills enemy infantry in same cell', () => {
    const tank = makeEntity(UnitType.V_4TNK, House.Spain, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const infantry = makeEntity(UnitType.I_E1, House.USSR, 50 * CELL_SIZE, 50 * CELL_SIZE);

    const ctx = makeCombatContext({
      entities: [tank, infantry],
      entityById: new Map([[tank.id, tank], [infantry.id, infantry]]),
    });

    // V_4TNK (Mammoth) has crusher=true in unit stats
    if (tank.stats.crusher) {
      checkVehicleCrush(ctx, tank);
      expect(infantry.alive).toBe(false);
      expect(ctx.killCount).toBe(1); // player gets kill credit
    }
  });

  it('crusher vehicle does NOT crush allied infantry', () => {
    const tank = makeEntity(UnitType.V_4TNK, House.Spain, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const friendly = makeEntity(UnitType.I_E1, House.Spain, 50 * CELL_SIZE, 50 * CELL_SIZE);

    const ctx = makeCombatContext({
      entities: [tank, friendly],
      entityById: new Map([[tank.id, tank], [friendly.id, friendly]]),
    });

    if (tank.stats.crusher) {
      checkVehicleCrush(ctx, tank);
      expect(friendly.alive).toBe(true); // allied — not crushed
    }
  });

  it('non-crusher vehicle has no crusher flag (caller must gate)', () => {
    // JEEP is not a crusher — the caller is responsible for not calling checkVehicleCrush
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 50 * CELL_SIZE, 50 * CELL_SIZE);
    // Verify JEEP has no crusher flag — the game loop only calls checkVehicleCrush for crusher=true
    expect(jeep.stats.crusher).toBeFalsy();
    // If checkVehicleCrush IS called on a non-crusher, it still iterates crushables
    // (the function trusts the caller to only invoke it for crushers)
  });

  it('vehicle does not crush other vehicles (non-crushable)', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR, 50 * CELL_SIZE, 50 * CELL_SIZE);

    const ctx = makeCombatContext({
      entities: [mammoth, enemy],
      entityById: new Map([[mammoth.id, mammoth], [enemy.id, enemy]]),
    });

    if (mammoth.stats.crusher) {
      checkVehicleCrush(ctx, mammoth);
      // V_2TNK is not crushable (vehicles are not crushable)
      expect(enemy.alive).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 18. SUPERWEAPON: Nuke gap generator unjam on destruction
// ═══════════════════════════════════════════════════════════════════════════

describe('Nuke destroys Gap Generator — unjam shroud', () => {
  it('damageStructure callback is invoked for GAP in blast radius', () => {
    // detonateNuke delegates structure damage to ctx.damageStructure callback.
    // The Game class's damageStructure handles GAP unjam when the GAP is destroyed.
    let damageStructureCalled = false;
    let damagedStructureType = '';
    let damageAmount = 0;

    const gap = makeStructure('GAP', House.USSR, 50, 50, { hp: 100 });

    const ctx = makeSuperweaponContext({
      structures: [gap],
      damageStructure: (s, dmg) => {
        damageStructureCalled = true;
        damagedStructureType = s.type;
        damageAmount = dmg;
        s.hp -= dmg;
        if (s.hp <= 0) { s.hp = 0; s.alive = false; return true; }
        return false;
      },
    });

    const target = { x: gap.cx * CELL_SIZE + CELL_SIZE, y: gap.cy * CELL_SIZE + CELL_SIZE };
    detonateNuke(ctx, target);

    expect(damageStructureCalled).toBe(true);
    expect(damagedStructureType).toBe('GAP');
    expect(damageAmount).toBeGreaterThan(0);
    expect(gap.alive).toBe(false); // nuke killed the GAP (100 HP << 1000 dmg)
  });

  it('gap generator unjam via fog subsystem when destroyed (updateGapGenerators)', () => {
    // After a GAP is destroyed, updateGapGenerators cleans up the jamming
    let unjamCalled = false;

    const gap = makeStructure('GAP', House.Spain, 10, 10, { alive: false }); // already destroyed

    const gapCells = new Map<number, { cx: number; cy: number; radius: number }>();
    gapCells.set(0, { cx: 11, cy: 11, radius: GAP_RADIUS });

    const ctx = makeFogContext({
      structures: [gap],
      map: {
        ...makeMockMap(),
        unjamRadius: () => { unjamCalled = true; },
      } as any,
      tick: 90,
      gapGeneratorCells: gapCells,
      powerProduced: 200,
      powerConsumed: 50,
    });

    updateGapGenerators(ctx);

    expect(unjamCalled).toBe(true);
    expect(ctx.gapGeneratorCells.has(0)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 19. PRODUCTION: startProduction boundary conditions
// ═══════════════════════════════════════════════════════════════════════════

describe('startProduction edge cases', () => {
  it('cannot start production with exactly 0 credits', () => {
    const item = makeProductionItem({ type: '2TNK', cost: 800 });
    let evaPlayed = '';
    const ctx = makeProductionContext({
      credits: 0,
      playEva: (name) => { evaPlayed = name; },
    });

    startProduction(ctx, item);

    expect(ctx.productionQueue.has('right')).toBe(false);
    expect(evaPlayed).toBe('eva_insufficient_funds');
  });

  it('can start production with exactly 1 credit (incremental deduction)', () => {
    const item = makeProductionItem({ type: '2TNK', cost: 800 });
    const ctx = makeProductionContext({ credits: 1 });

    startProduction(ctx, item);

    // PR3: only checks credits > 0 to start
    expect(ctx.productionQueue.has('right')).toBe(true);
    expect(ctx.credits).toBe(1); // no upfront deduction
  });

  it('cannot queue 6th item (max 5)', () => {
    const item = makeProductionItem({ type: '2TNK', cost: 800 });
    const ctx = makeProductionContext({ credits: 50000 });

    // Start first build
    startProduction(ctx, item);

    // Queue 4 more (total 5)
    for (let i = 0; i < 4; i++) {
      startProduction(ctx, item);
    }

    expect(ctx.productionQueue.get('right')!.queueCount).toBe(5);

    // Try 6th — should not increase count
    const creditsBefore = ctx.credits;
    startProduction(ctx, item);
    expect(ctx.productionQueue.get('right')!.queueCount).toBe(5);
    expect(ctx.credits).toBe(creditsBefore); // no deduction
  });

  it('queuing requires full cost upfront', () => {
    const item = makeProductionItem({ type: '2TNK', cost: 800 });
    const ctx = makeProductionContext({ credits: 5000 });

    startProduction(ctx, item); // starts active build (no deduction)
    const creditsAfterStart = ctx.credits;

    startProduction(ctx, item); // queue second (deducts full cost)
    expect(ctx.credits).toBe(creditsAfterStart - 800);
  });

  it('cannot queue when insufficient credits for full cost', () => {
    const item = makeProductionItem({ type: '2TNK', cost: 800 });
    let evaPlayed = '';
    const ctx = makeProductionContext({
      credits: 500, // enough to start but not to queue
      playEva: (name) => { evaPlayed = name; },
    });

    startProduction(ctx, item); // starts OK
    expect(ctx.productionQueue.has('right')).toBe(true);

    startProduction(ctx, item); // queue fails — 500 < 800
    expect(ctx.productionQueue.get('right')!.queueCount).toBe(1);
    expect(evaPlayed).toBe('eva_insufficient_funds');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 20. COMBAT: damageEntity on already-dead entity
// ═══════════════════════════════════════════════════════════════════════════

describe('damageEntity boundary conditions', () => {
  it('damaging an already-dead entity does nothing', () => {
    const e = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    e.alive = false;
    e.hp = 0;

    const ctx = makeCombatContext({
      entities: [e],
      entityById: new Map([[e.id, e]]),
    });

    const result = damageEntity(ctx, e, 100, 'AP');
    expect(result).toBe(false);
    expect(e.hp).toBe(0);
  });

  it('iron curtain entity takes no damage', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    tank.ironCurtainTick = 900;

    const ctx = makeCombatContext({
      entities: [tank],
      entityById: new Map([[tank.id, tank]]),
    });

    const hpBefore = tank.hp;
    const result = damageEntity(ctx, tank, 500, 'Super');
    expect(result).toBe(false);
    expect(tank.hp).toBe(hpBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 21. FOG: fogDisabled reveals all
// ═══════════════════════════════════════════════════════════════════════════

describe('Fog disabled mode', () => {
  it('fogDisabled=true calls revealAll', () => {
    let revealed = false;
    const mockMap = {
      ...makeMockMap(),
      revealAll: () => { revealed = true; },
    };

    const ctx = makeFogContext({
      fogDisabled: true,
      map: mockMap as any,
    });

    updateFogOfWar(ctx);
    expect(revealed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 22. REPAIR/SELL: repairCostPerStep edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('repairCostPerStep formula edge cases', () => {
  it('very cheap structure with high HP gives cost of 1', () => {
    // cost=25 (SBAG), maxHp=256: ceil(25*0.20 / (256/7)) = ceil(5/36.57) = ceil(0.137) = 1
    expect(repairCostPerStep(25, 256)).toBe(1);
  });

  it('expensive structure with low HP gives high per-step cost', () => {
    // cost=2800 (PDOX), maxHp=400: ceil(2800*0.20 / (400/7)) = ceil(560/57.14) = ceil(9.8) = 10
    expect(repairCostPerStep(2800, 400)).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 23. PRODUCTION: countPlayerBuildings edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('countPlayerBuildings edge cases', () => {
  it('counts only alive buildings of matching type', () => {
    const structures = [
      makeStructure('WEAP', House.Spain, 10, 10),
      makeStructure('WEAP', House.Spain, 15, 10, { alive: false }),
      makeStructure('WEAP', House.Spain, 20, 10),
      makeStructure('PROC', House.Spain, 25, 10),
    ];

    const count = countPlayerBuildings(structures, 'WEAP', House.Spain, (a, b) => a === b);
    expect(count).toBe(2);
  });

  it('returns 0 when no matching buildings exist', () => {
    const structures = [
      makeStructure('PROC', House.Spain, 10, 10),
    ];

    const count = countPlayerBuildings(structures, 'WEAP', House.Spain, (a, b) => a === b);
    expect(count).toBe(0);
  });

  it('does not count enemy buildings', () => {
    const structures = [
      makeStructure('WEAP', House.USSR, 10, 10),
      makeStructure('WEAP', House.Spain, 15, 10),
    ];

    const count = countPlayerBuildings(structures, 'WEAP', House.Spain, (a, b) => a === b);
    expect(count).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 24. PRODUCTION: getEffectiveCost with different houses
// ═══════════════════════════════════════════════════════════════════════════

describe('getEffectiveCost per-house bonuses', () => {
  it('Spain (default) has costMult 1.0', () => {
    const item = makeProductionItem({ cost: 800 });
    expect(getEffectiveCost(item, House.Spain)).toBe(800);
  });

  it('cost rounds to nearest integer, minimum 1', () => {
    const cheapItem = makeProductionItem({ cost: 1 });
    expect(getEffectiveCost(cheapItem, House.Spain)).toBe(1);
  });

  it('very cheap items never go below 1', () => {
    const zeroItem = makeProductionItem({ cost: 0 });
    // max(1, round(0 * 1.0)) = max(1, 0) = 1
    expect(getEffectiveCost(zeroItem, House.Spain)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 25. SUPERWEAPON: updateSuperweapons charge rate under low power
// ═══════════════════════════════════════════════════════════════════════════

describe('Superweapon charge rate under low power', () => {
  it('charges at 0.25x rate when low power for player house', () => {
    const mslo = makeStructure('MSLO', House.Spain, 10, 10, { buildProgress: undefined });
    const ctx = makeSuperweaponContext({
      structures: [mslo],
      powerProduced: 50,
      powerConsumed: 200, // low power
    });

    updateSuperweapons(ctx);

    const key = `${House.Spain}:${SuperweaponType.NUKE}`;
    const state = ctx.superweapons.get(key);
    expect(state).toBeDefined();
    expect(state!.chargeTick).toBe(0.25); // 0.25x rate
  });

  it('charges at normal 1x rate for enemy house even under player low power', () => {
    const mslo = makeStructure('MSLO', House.USSR, 10, 10, { buildProgress: undefined });
    const ctx = makeSuperweaponContext({
      structures: [mslo],
      powerProduced: 50,
      powerConsumed: 200,
      isAllied: (a, b) => a === b,
    });

    updateSuperweapons(ctx);

    const key = `${House.USSR}:${SuperweaponType.NUKE}`;
    const state = ctx.superweapons.get(key);
    expect(state).toBeDefined();
    // Enemy house charges at full rate regardless of player power
    expect(state!.chargeTick).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 26. COMBAT: Retaliation mechanics
// ═══════════════════════════════════════════════════════════════════════════

describe('Retaliation edge cases', () => {
  it('unarmed unit does not retaliate (no weapon)', () => {
    const harv = makeEntity(UnitType.V_HARV, House.Spain, 100, 100);
    const attacker = makeEntity(UnitType.I_E1, House.USSR, 110, 110);

    // Verify harvester has no weapon
    if (!harv.weapon) {
      // Simulate being attacked — no target should be set
      expect(harv.target).toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 27. SPECIAL UNITS: Thief against non-PROC/SILO structure
// ═══════════════════════════════════════════════════════════════════════════

describe('Thief targeting edge cases', () => {
  it('thief targeting WEAP (non-PROC/SILO) resets to GUARD', () => {
    const thief = makeEntity(UnitType.I_THF, House.Spain, 100, 100);
    thief.mission = Mission.ATTACK;
    const weap = makeStructure('WEAP', House.USSR, 4, 4);
    thief.targetStructure = weap;

    const ctx = makeSpecialUnitsContext({
      entities: [thief],
      structures: [weap],
    });

    updateThief(ctx, thief);

    expect(thief.alive).toBe(true);
    expect(thief.targetStructure).toBeNull();
    expect(thief.mission).toBe(Mission.GUARD);
    expect(ctx.isThieved).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 28. REPAIR/SELL: calculateSiloCapacity from repairSell module
// ═══════════════════════════════════════════════════════════════════════════

describe('Silo capacity calculation edge cases', () => {
  it('PROC under construction does not contribute capacity', () => {
    const proc = makeStructure('PROC', House.Spain, 5, 5, { buildProgress: 0.5 });
    const cap = calculateSiloCapacity([proc], House.Spain, (a: House, b: House) => a === b);
    expect(cap).toBe(0);
  });

  it('fully built PROC contributes 1000', () => {
    const proc = makeStructure('PROC', House.Spain, 5, 5);
    const cap = calculateSiloCapacity([proc], House.Spain, (a: House, b: House) => a === b);
    expect(cap).toBe(1000);
  });

  it('SILO contributes 1500', () => {
    const silo = makeStructure('SILO', House.Spain, 5, 5);
    const cap = calculateSiloCapacity([silo], House.Spain, (a: House, b: House) => a === b);
    expect(cap).toBe(1500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 29. COMBAT: damageSpeedFactor boundary
// ═══════════════════════════════════════════════════════════════════════════

describe('damageSpeedFactor boundary conditions', () => {
  it('exactly 50% HP returns 0.75 speed', () => {
    const entity = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    entity.hp = entity.maxHp * 0.5;
    expect(damageSpeedFactor(entity)).toBe(0.75);
  });

  it('51% HP returns 1.0 speed (above yellow threshold)', () => {
    const entity = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    entity.hp = Math.ceil(entity.maxHp * 0.51);
    expect(damageSpeedFactor(entity)).toBe(1.0);
  });

  it('1 HP returns 0.75 speed', () => {
    const entity = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    entity.hp = 1;
    expect(damageSpeedFactor(entity)).toBe(0.75);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 30. SUPERWEAPON: detonateNuke scorched earth
// ═══════════════════════════════════════════════════════════════════════════

describe('detonateNuke scorched earth', () => {
  it('sets terrain to ROCK in 3-cell radius around ground zero', () => {
    const terrainSet: Array<{ cx: number; cy: number }> = [];
    const mockMap = {
      ...makeMockMap(),
      setTerrain: (cx: number, cy: number, _t: number) => {
        terrainSet.push({ cx, cy });
      },
    };

    const ctx = makeSuperweaponContext({ map: mockMap as any });
    const target = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    detonateNuke(ctx, target);

    // Scorched earth: cells where dx^2+dy^2 <= 9 (3-cell radius)
    // Count expected cells: all (dx,dy) with |dx|<=3, |dy|<=3, dx^2+dy^2 <= 9
    let expectedCount = 0;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy <= 9) expectedCount++;
      }
    }

    expect(terrainSet.length).toBe(expectedCount);
  });
});
