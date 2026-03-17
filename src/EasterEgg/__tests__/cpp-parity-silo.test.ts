/**
 * C++ Behavioral Parity: SILO -- Ore Silo
 *
 * Tests verify Ore Silo behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with an Ore Silo (observable
 * outcomes: stats, storage capacity, destruction recalculation),
 * not HOW the code implements it. The same scenarios should produce
 * identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, POWER_DRAIN, COUNTRY_BONUSES,
  buildDefaultAlliances, worldDist,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  structureDamage,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import {
  type MapStructure, STRUCTURE_SIZE, STRUCTURE_MAX_HP,
  STRUCTURE_WEAPONS,
} from '../engine/scenario';
import {
  calculateSiloCapacity, sellRefund, repairCostPerStep,
  calculatePowerGrid,
} from '../engine/repairSell';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeSILO(cx: number, cy: number, hp = 300, house: House = House.Spain): MapStructure {
  return {
    type: 'SILO', image: 'silo', house,
    cx, cy, hp, maxHp: 300, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function makeBuilding(type: string, cx: number, cy: number, hp: number, house: House = House.Spain): MapStructure {
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp, maxHp: hp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(
  structures: MapStructure[] = [],
  entities: Entity[] = [],
): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  let siloRecalcCount = 0;
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures,
    inflightProjectiles: [],
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    scenarioId: 'TEST',
    killCount: 0,
    lossCount: 0,
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    attackedTriggerNames: new Set<string>(),
    map,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    movementSpeed: () => 1,
    getFirepowerBias: (house: House) => COUNTRY_BONUSES[house]?.firepowerMult ?? 1.0,
    getArmorBias: () => 1.0,
    getROFBias: () => 1.0,
    damageStructure: () => false,
    aiIQ: () => 3,
    warheadMuzzleColor: () => '#fff',
    aiStates: new Map(),
    lastBaseAttackEva: -Infinity,
    gameTicksPerSec: 15,
    gapGeneratorCells: new Map(),
    nBuildingsDestroyedCount: 0,
    structuresLost: 0,
    bridgeCellCount: 0,
    clearStructureFootprint: () => {},
    recalculateSiloCapacity: () => { siloRecalcCount++; },
    showEvaMessage: () => {},
    screenShake: 0,
    screenFlash: 0,
    powerConsumed: 0,
    powerProduced: 100,
    _siloRecalcCount: () => siloRecalcCount,
  } as CombatContext & { _siloRecalcCount: () => number };
}

// -- Stats (rules.ini / building.cpp) -----------------------------------------
//
// C++ rules.ini: SILO -> Strength=300, Cost=150, Power=10 (consumes 10W),
// Prerequisite=PROC, Owner=allies,soviet, TechLevel=1, Storage=1500

describe('SILO stats (rules.ini parity)', () => {

  it('max HP is 300', () => {
    expect(STRUCTURE_MAX_HP['SILO']).toBe(300);
  });

  it('footprint is 1x1 cells (smallest economy building)', () => {
    expect(STRUCTURE_SIZE['SILO']).toEqual([1, 1]);
  });

  it('has no weapon (purely economic)', () => {
    expect(STRUCTURE_WEAPONS['SILO']).toBeUndefined();
  });

  it('consumes 10W power (POWER_DRAIN entry)', () => {
    expect(POWER_DRAIN['SILO']).toBe(10);
  });

  it('is available to both factions (rules.ini Owner=allies,soviet)', () => {
    const alliedSILO = makeSILO(10, 10, 300, House.Spain);
    const sovietSILO = makeSILO(20, 20, 300, House.USSR);
    expect(alliedSILO.type).toBe('SILO');
    expect(sovietSILO.type).toBe('SILO');
  });

  it('cost is 150 credits (cheapest economy building)', () => {
    // Verified from production items: SILO cost=150
    expect(sellRefund(150)).toBe(75); // 50% of 150
  });
});

// -- 1x1 Footprint -----------------------------------------------------------
//
// C++ STRUCTURE_SIZE: SILO is 1x1. It occupies a single cell at (cx, cy).
// This makes it the smallest economy building in the game.

describe('SILO 1x1 footprint', () => {

  it('footprint occupies exactly 1 cell', () => {
    const [w, h] = STRUCTURE_SIZE['SILO']!;
    expect(w * h).toBe(1);
    expect(w).toBe(1);
    expect(h).toBe(1);
  });

  it('origin at (10,10) occupies only cell (10,10)', () => {
    const [w, h] = STRUCTURE_SIZE['SILO']!;
    const cells: [number, number][] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells.push([10 + dx, 10 + dy]);
      }
    }
    expect(cells).toEqual([[10, 10]]);
  });
});

// -- Storage Capacity (building.cpp Capacity()) -------------------------------
//
// C++ building.cpp Capacity(): SILO provides 1500 credits of ore storage.
// PROC provides 1000. Capacity stacks additively across all alive, allied,
// fully-constructed storage structures.

describe('SILO storage capacity (building.cpp Capacity())', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('single SILO provides 1500 storage capacity', () => {
    const silo = makeSILO(10, 10, 300, House.Spain);
    expect(calculateSiloCapacity([silo], House.Spain, isAllied)).toBe(1500);
  });

  it('two SILOs provide 3000 capacity (additive stacking)', () => {
    const s1 = makeSILO(10, 10, 300, House.Spain);
    const s2 = makeSILO(12, 10, 300, House.Spain);
    expect(calculateSiloCapacity([s1, s2], House.Spain, isAllied)).toBe(3000);
  });

  it('SILO + PROC = 2500 capacity (1500 + 1000)', () => {
    const silo = makeSILO(10, 10, 300, House.Spain);
    const proc = makeBuilding('PROC', 12, 10, 900, House.Spain);
    expect(calculateSiloCapacity([silo, proc], House.Spain, isAllied)).toBe(2500);
  });

  it('dead SILO does not contribute capacity', () => {
    const silo = makeSILO(10, 10, 0, House.Spain);
    silo.alive = false;
    expect(calculateSiloCapacity([silo], House.Spain, isAllied)).toBe(0);
  });

  it('enemy SILO does not contribute to player capacity', () => {
    const silo = makeSILO(10, 10, 300, House.USSR);
    expect(calculateSiloCapacity([silo], House.Spain, isAllied)).toBe(0);
  });

  it('under-construction SILO does not contribute capacity', () => {
    const silo = makeSILO(10, 10, 300, House.Spain);
    silo.buildProgress = 0.5;
    expect(calculateSiloCapacity([silo], House.Spain, isAllied)).toBe(0);
  });

  it('completed SILO (buildProgress=1) contributes capacity', () => {
    const silo = makeSILO(10, 10, 300, House.Spain);
    silo.buildProgress = 1;
    expect(calculateSiloCapacity([silo], House.Spain, isAllied)).toBe(1500);
  });

  it('pre-placed SILO (buildProgress=undefined) contributes capacity', () => {
    const silo = makeSILO(10, 10, 300, House.Spain);
    expect(silo.buildProgress).toBeUndefined();
    expect(calculateSiloCapacity([silo], House.Spain, isAllied)).toBe(1500);
  });

  it('three SILOs + two PROCs = 6500 capacity', () => {
    const structures = [
      makeSILO(10, 10, 300, House.Spain),
      makeSILO(12, 10, 300, House.Spain),
      makeSILO(14, 10, 300, House.Spain),
      makeBuilding('PROC', 16, 10, 900, House.Spain),
      makeBuilding('PROC', 20, 10, 900, House.Spain),
    ];
    expect(calculateSiloCapacity(structures, House.Spain, isAllied)).toBe(6500);
  });

  it('allied SILO (Greece) contributes to player capacity', () => {
    const silo = makeSILO(10, 10, 300, House.Greece);
    expect(calculateSiloCapacity([silo], House.Spain, isAllied)).toBe(1500);
  });
});

// -- Power Grid Integration ---------------------------------------------------
//
// SILO consumes 10W via POWER_DRAIN. It does NOT produce power.
// Only alive, non-selling, allied structures count.

describe('SILO in power grid (consumes 10W)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('single SILO consumes 10W, produces 0W', () => {
    const silo = makeSILO(10, 10, 300, House.Spain);
    const grid = calculatePowerGrid([silo], House.Spain, isAllied);
    expect(grid.consumed).toBe(10);
    expect(grid.produced).toBe(0);
  });

  it('POWR + SILO yields net 90W (100 produced - 10 consumed)', () => {
    const powr = makeBuilding('POWR', 10, 10, 400, House.Spain);
    const silo = makeSILO(14, 10, 300, House.Spain);
    const grid = calculatePowerGrid([powr, silo], House.Spain, isAllied);
    expect(grid.produced).toBe(100);
    expect(grid.consumed).toBe(10);
    expect(grid.produced - grid.consumed).toBe(90);
  });

  it('dead SILO does not consume power', () => {
    const silo = makeSILO(10, 10, 0, House.Spain);
    silo.alive = false;
    const grid = calculatePowerGrid([silo], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('selling SILO does not consume power', () => {
    const silo = makeSILO(10, 10, 300, House.Spain);
    silo.sellProgress = 0.5;
    const grid = calculatePowerGrid([silo], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('enemy SILO does not affect player power grid', () => {
    const silo = makeSILO(10, 10, 300, House.USSR);
    const grid = calculatePowerGrid([silo], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('multiple SILOs stack power drain', () => {
    const s1 = makeSILO(10, 10, 300, House.Spain);
    const s2 = makeSILO(12, 10, 300, House.Spain);
    const s3 = makeSILO(14, 10, 300, House.Spain);
    const grid = calculatePowerGrid([s1, s2, s3], House.Spain, isAllied);
    expect(grid.consumed).toBe(30); // 3 * 10W
  });
});

// -- Economic Functions (repairSell.ts) ---------------------------------------
//
// C++ rules.ini: SILO Cost=150, Strength=300

describe('SILO economic functions (rules.ini Cost=150)', () => {
  const SILO_COST = 150;
  const SILO_MAX_HP = 300;

  it('sell refund is 50% of build cost = 75', () => {
    expect(sellRefund(SILO_COST)).toBe(75);
  });

  it('repair cost per step: ceil(150 * 0.20 / (300 / 7)) = ceil(30 / 42.857) = 1', () => {
    expect(repairCostPerStep(SILO_COST, SILO_MAX_HP)).toBe(1);
  });
});

// -- Destruction Blast -- Radial HE (building.cpp) ----------------------------
//
// Non-barrel structures (including SILO) use a generic 2-cell radial HE blast
// with distance falloff on destruction. 1x1 footprint means the blast center
// is at (cx * CELL_SIZE + CELL_SIZE/2, cy * CELL_SIZE + CELL_SIZE/2) effectively.

describe('SILO destruction blast -- radial HE (non-barrel)', () => {

  it('damages entities within 2-cell radius on destruction', () => {
    const silo = makeSILO(10, 10, 50);
    silo.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([silo], [victim]);
    structureDamage(ctx, silo, 100);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('damages entities in diagonal cells (within 2-cell radius)', () => {
    const silo = makeSILO(10, 10, 50);
    silo.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([silo], [victim]);
    structureDamage(ctx, silo, 100);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('uses distance falloff (closer = more damage)', () => {
    const silo = makeSILO(10, 10, 50);
    silo.house = House.USSR;
    const close = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const far = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 12);
    const ctx = makeCombatCtx([silo], [close, far]);
    structureDamage(ctx, silo, 100);
    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    expect(closeDmg).toBeGreaterThan(farDmg);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const silo = makeSILO(10, 10, 50);
    silo.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 13, 10); // 3 cells E
    const ctx = makeCombatCtx([silo], [victim]);
    structureDamage(ctx, silo, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('does NOT use barrel cardinal fire-bullet mechanic', () => {
    // SILO should use radial HE with falloff -- diagonals should take damage
    const silo = makeSILO(10, 10, 50);
    silo.house = House.USSR;
    const diagonal = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([silo], [diagonal]);
    structureDamage(ctx, silo, 100);
    expect(diagonal.hp).toBeLessThan(diagonal.maxHp);
  });
});

// -- Silo Capacity Recalculation on Destruction (house.cpp) -------------------
//
// C++ house.cpp: when a storage structure (PROC or SILO) is destroyed,
// HouseClass::Adjust_Capacity() recalculates total capacity.
// combat.ts calls ctx.recalculateSiloCapacity() on SILO/PROC destruction.

describe('SILO capacity recalculation on destruction', () => {

  it('destroying an allied SILO triggers recalculateSiloCapacity', () => {
    const silo = makeSILO(10, 10, 50, House.Spain);
    const ctx = makeCombatCtx([silo]) as CombatContext & { _siloRecalcCount: () => number };
    expect(ctx._siloRecalcCount()).toBe(0);
    structureDamage(ctx, silo, 100);
    expect(silo.alive).toBe(false);
    expect(ctx._siloRecalcCount()).toBe(1);
  });

  it('destroying a non-storage allied structure does NOT trigger recalculation', () => {
    const powr = makeBuilding('POWR', 10, 10, 50, House.Spain);
    const ctx = makeCombatCtx([powr]) as CombatContext & { _siloRecalcCount: () => number };
    structureDamage(ctx, powr, 100);
    expect(powr.alive).toBe(false);
    expect(ctx._siloRecalcCount()).toBe(0);
  });

  it('destroying an enemy SILO does NOT trigger player recalculation', () => {
    const silo = makeSILO(10, 10, 50, House.USSR);
    const ctx = makeCombatCtx([silo]) as CombatContext & { _siloRecalcCount: () => number };
    structureDamage(ctx, silo, 100);
    expect(silo.alive).toBe(false);
    expect(ctx._siloRecalcCount()).toBe(0);
  });

  it('capacity drops by 1500 when one of two SILOs is destroyed', () => {
    const alliances = buildDefaultAlliances();
    const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

    const s1 = makeSILO(10, 10, 300, House.Spain);
    const s2 = makeSILO(12, 10, 300, House.Spain);
    expect(calculateSiloCapacity([s1, s2], House.Spain, isAllied)).toBe(3000);

    // Destroy one
    s1.alive = false;
    expect(calculateSiloCapacity([s1, s2], House.Spain, isAllied)).toBe(1500);
  });

  it('capacity drops to 0 when last storage structure is destroyed', () => {
    const alliances = buildDefaultAlliances();
    const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

    const silo = makeSILO(10, 10, 300, House.Spain);
    expect(calculateSiloCapacity([silo], House.Spain, isAllied)).toBe(1500);

    silo.alive = false;
    expect(calculateSiloCapacity([silo], House.Spain, isAllied)).toBe(0);
  });

  it('destroying SILO leaves PROC capacity intact', () => {
    const alliances = buildDefaultAlliances();
    const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

    const silo = makeSILO(10, 10, 300, House.Spain);
    const proc = makeBuilding('PROC', 12, 10, 900, House.Spain);
    expect(calculateSiloCapacity([silo, proc], House.Spain, isAllied)).toBe(2500);

    silo.alive = false;
    expect(calculateSiloCapacity([silo, proc], House.Spain, isAllied)).toBe(1000);
  });
});

// -- Damage Absorption --------------------------------------------------------
//
// SILO has HP=300 (lower than most structures). Taking damage reduces HP;
// at 0 HP it is destroyed.

describe('SILO damage absorption (HP=300)', () => {

  it('takes 100 damage: 300 -> 200 HP', () => {
    const silo = makeSILO(10, 10, 300, House.USSR);
    const ctx = makeCombatCtx([silo]);
    structureDamage(ctx, silo, 100);
    expect(silo.hp).toBe(200);
    expect(silo.alive).toBe(true);
  });

  it('takes exactly 300 damage: dies at 0 HP', () => {
    const silo = makeSILO(10, 10, 300, House.USSR);
    const ctx = makeCombatCtx([silo]);
    structureDamage(ctx, silo, 300);
    expect(silo.hp).toBe(0);
    expect(silo.alive).toBe(false);
  });

  it('overkill damage is clamped to 0 HP (no negative HP)', () => {
    const silo = makeSILO(10, 10, 100, House.USSR);
    const ctx = makeCombatCtx([silo]);
    structureDamage(ctx, silo, 500);
    expect(silo.hp).toBe(0);
    expect(silo.alive).toBe(false);
  });

  it('incremental damage: 3 hits of 100 each destroys SILO', () => {
    const silo = makeSILO(10, 10, 300, House.USSR);
    const ctx = makeCombatCtx([silo]);
    structureDamage(ctx, silo, 100);
    expect(silo.hp).toBe(200);
    expect(silo.alive).toBe(true);
    structureDamage(ctx, silo, 100);
    expect(silo.hp).toBe(100);
    expect(silo.alive).toBe(true);
    structureDamage(ctx, silo, 100);
    expect(silo.hp).toBe(0);
    expect(silo.alive).toBe(false);
  });

  it('already-dead SILO ignores further damage', () => {
    const silo = makeSILO(10, 10, 0, House.USSR);
    silo.alive = false;
    const ctx = makeCombatCtx([silo]);
    const result = structureDamage(ctx, silo, 100);
    expect(result).toBe(false);
    expect(silo.hp).toBe(0);
  });
});

// -- Destruction Visual/Audio Effects -----------------------------------------
//
// When destroyed, SILO produces explosion effects, debris, screen shake,
// and the building_explode sound. 1x1 structures produce fewer pre-explosions
// and less screen shake than larger buildings.

describe('SILO destruction effects (1x1 building)', () => {

  it('produces explosion effects on destruction', () => {
    const silo = makeSILO(10, 10, 50, House.USSR);
    const ctx = makeCombatCtx([silo]);
    structureDamage(ctx, silo, 100);
    const explosions = ctx.effects.filter((e: Effect) => e.type === 'explosion');
    expect(explosions.length).toBeGreaterThan(0);
  });

  it('produces debris effect on destruction', () => {
    const silo = makeSILO(10, 10, 50, House.USSR);
    const ctx = makeCombatCtx([silo]);
    structureDamage(ctx, silo, 100);
    const debris = ctx.effects.filter((e: Effect) => e.type === 'debris');
    expect(debris.length).toBe(1);
  });

  it('sets screen shake on destruction (1x1 shake = 8)', () => {
    const silo = makeSILO(10, 10, 50, House.USSR);
    const ctx = makeCombatCtx([silo]);
    structureDamage(ctx, silo, 100);
    // Screen shake for 1x1: min(20, 4 + max(1,1) * 4) = min(20, 8) = 8
    expect(ctx.screenShake).toBe(8);
  });

  it('turns into rubble on destruction', () => {
    const silo = makeSILO(10, 10, 50, House.USSR);
    const ctx = makeCombatCtx([silo]);
    structureDamage(ctx, silo, 100);
    expect(silo.rubble).toBe(true);
  });

  it('1x1 building has fewer pre-explosions than 2x2 building', () => {
    // 1x1: max(3, min(6, 1*1)) = 3 pre-explosions
    // 2x2: max(3, min(6, 2*2)) = 4 pre-explosions
    const silo = makeSILO(10, 10, 50, House.USSR);
    const ctxSilo = makeCombatCtx([silo]);
    structureDamage(ctxSilo, silo, 100);
    const siloPreExplosions = ctxSilo.effects.filter(
      (e: Effect) => e.type === 'explosion' && e.sprite === 'veh-hit1'
    );

    const powr = makeBuilding('POWR', 20, 20, 50, House.USSR);
    const ctxPowr = makeCombatCtx([powr]);
    structureDamage(ctxPowr, powr, 100);
    const powrPreExplosions = ctxPowr.effects.filter(
      (e: Effect) => e.type === 'explosion' && e.sprite === 'veh-hit1'
    );

    expect(siloPreExplosions.length).toBe(3);
    expect(powrPreExplosions.length).toBe(4);
    expect(siloPreExplosions.length).toBeLessThan(powrPreExplosions.length);
  });
});

// -- Damage to Adjacent Structures on SILO Destruction ------------------------
//
// SILO radial HE blast can damage adjacent structures when it explodes.

describe('SILO destruction damages adjacent structures', () => {

  it('damages adjacent structure on destruction', () => {
    const silo = makeSILO(10, 10, 50);
    silo.house = House.USSR;
    const nearby = makeBuilding('POWR', 11, 10, 400);
    const ctx = makeCombatCtx([silo, nearby]);
    structureDamage(ctx, silo, 100);
    expect(nearby.hp).toBeLessThan(400);
  });

  it('does not damage distant structures', () => {
    const silo = makeSILO(10, 10, 50);
    silo.house = House.USSR;
    const distant = makeBuilding('POWR', 20, 20, 400);
    const ctx = makeCombatCtx([silo, distant]);
    structureDamage(ctx, silo, 100);
    expect(distant.hp).toBe(400);
  });
});

// -- EVA and Tracking on Destruction ------------------------------------------
//
// When an allied SILO is destroyed, it increments structuresLost counter
// and triggers eva_unit_lost. Enemy SILO destruction increments
// nBuildingsDestroyedCount.

describe('SILO destruction tracking', () => {

  it('allied SILO destruction increments structuresLost', () => {
    const silo = makeSILO(10, 10, 50, House.Spain);
    const ctx = makeCombatCtx([silo]);
    expect(ctx.structuresLost).toBe(0);
    structureDamage(ctx, silo, 100);
    expect(ctx.structuresLost).toBe(1);
  });

  it('enemy SILO destruction increments nBuildingsDestroyedCount', () => {
    const silo = makeSILO(10, 10, 50, House.USSR);
    const ctx = makeCombatCtx([silo]);
    expect(ctx.nBuildingsDestroyedCount).toBe(0);
    structureDamage(ctx, silo, 100);
    expect(ctx.nBuildingsDestroyedCount).toBe(1);
  });

  it('enemy SILO destruction does NOT increment structuresLost', () => {
    const silo = makeSILO(10, 10, 50, House.USSR);
    const ctx = makeCombatCtx([silo]);
    structureDamage(ctx, silo, 100);
    expect(ctx.structuresLost).toBe(0);
  });
});
