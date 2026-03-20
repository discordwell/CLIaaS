/**
 * C++ Behavioral Parity: WEAP — War Factory
 *
 * Tests verify War Factory behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with a War Factory (observable
 * outcomes: stats, power drain, prerequisite gating, destruction blast),
 * not HOW the code implements it. The same scenarios should produce
 * identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, POWER_DRAIN, COUNTRY_BONUSES,
  PRODUCTION_ITEMS, type ProductionItem,
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
  STRUCTURE_WEAPONS, STRUCTURE_POWERED,
} from '../engine/scenario';
import {
  powerOutput, calculatePowerGrid, sellRefund, repairCostPerStep,
} from '../engine/repairSell';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeWEAP(cx: number, cy: number, hp = 1000, house: House = House.Spain): MapStructure {
  return {
    type: 'WEAP', image: 'weap', house,
    cx, cy, hp, maxHp: 1000, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function makeBuilding(type: string, cx: number, cy: number, hp: number, house: House = House.USSR): MapStructure {
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
    recalculateSiloCapacity: () => {},
    showEvaMessage: () => {},
    screenShake: 0,
    screenFlash: 0,
    powerConsumed: 0,
    powerProduced: 100,
  } as CombatContext;
}

// -- Stats (rules.ini / building.cpp) -----------------------------------------
//
// C++ rules.ini: WEAP -> Strength=1000, Cost=2000, Power=30 (consumes 30W),
// Prerequisite=PROC, Owner=allies,soviet, TechLevel=3

describe('WEAP stats (rules.ini parity)', () => {

  it('max HP is 1000', () => {
    expect(STRUCTURE_MAX_HP['WEAP']).toBe(1000);
  });

  it('footprint is 3x2 cells', () => {
    expect(STRUCTURE_SIZE['WEAP']).toEqual([3, 2]);
  });

  it('has no weapon (production building, not defensive)', () => {
    expect(STRUCTURE_WEAPONS['WEAP']).toBeUndefined();
  });

  it('consumes 30W power (POWER_DRAIN entry)', () => {
    expect(POWER_DRAIN['WEAP']).toBe(30);
  });

  it('is not in STRUCTURE_POWERED set (functions without power)', () => {
    expect(STRUCTURE_POWERED.has('WEAP')).toBe(false);
  });

  it('is available to both factions (rules.ini Owner=allies,soviet)', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'WEAP');
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('both');
  });

  it('costs 2000 credits', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'WEAP');
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(2000);
  });

  it('build time is 1920 ticks (C++ cost-based: floor(2000 * 0.96))', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'WEAP');
    expect(prodItem).toBeDefined();
    expect(prodItem!.buildTime).toBe(1920);
  });

  it('requires PROC (Refinery) as prerequisite', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'WEAP');
    expect(prodItem).toBeDefined();
    expect(prodItem!.prerequisite).toBe('PROC');
  });

  it('is a structure (isStructure flag)', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'WEAP');
    expect(prodItem).toBeDefined();
    expect(prodItem!.isStructure).toBe(true);
  });

  it('tech level is 3', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'WEAP');
    expect(prodItem).toBeDefined();
    expect(prodItem!.techLevel).toBe(3);
  });

  it('can be placed for allied house', () => {
    const weap = makeWEAP(10, 10, 1000, House.Spain);
    expect(weap.type).toBe('WEAP');
    expect(weap.house).toBe(House.Spain);
  });

  it('can be placed for soviet house', () => {
    const weap = makeWEAP(10, 10, 1000, House.USSR);
    expect(weap.type).toBe('WEAP');
    expect(weap.house).toBe(House.USSR);
  });
});

// -- Vehicle Production Prerequisite ------------------------------------------
//
// C++ rules.ini: All vehicles have Prerequisite=WEAP (or WEAP + secondary).
// WEAP is the primary prerequisite that gates the entire vehicle production tab.

describe('WEAP is prerequisite for vehicle production', () => {

  const vehicleItems = PRODUCTION_ITEMS.filter(
    p => p.prerequisite === 'WEAP' && !p.isStructure,
  );

  it('gates at least 8 vehicle types', () => {
    // Core vehicles: JEEP, 1TNK, 2TNK, 3TNK, 4TNK, ARTY, APC, HARV, V2RL, MNLY, etc.
    expect(vehicleItems.length).toBeGreaterThanOrEqual(8);
  });

  it('gates Harvester production (HARV)', () => {
    const harv = vehicleItems.find(p => p.type === 'HARV');
    expect(harv).toBeDefined();
    expect(harv!.prerequisite).toBe('WEAP');
  });

  it('gates Light Tank production (1TNK)', () => {
    const item = vehicleItems.find(p => p.type === '1TNK');
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('WEAP');
  });

  it('gates Heavy Tank production (3TNK)', () => {
    const item = vehicleItems.find(p => p.type === '3TNK');
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('WEAP');
  });

  it('gates Mammoth Tank production (4TNK) — requires WEAP+STEK', () => {
    const item = vehicleItems.find(p => p.type === '4TNK');
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('WEAP');
    expect(item!.techPrereq).toBe('STEK');
  });

  it('gates V2 Rocket Launcher production (V2RL) — requires WEAP+DOME', () => {
    const item = vehicleItems.find(p => p.type === 'V2RL');
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('WEAP');
    expect(item!.techPrereq).toBe('DOME');
  });

  it('gates APC production — requires WEAP+TENT', () => {
    const item = vehicleItems.find(p => p.type === 'APC');
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('WEAP');
    expect(item!.techPrereq).toBe('TENT');
  });
});

// -- Structure Prerequisites via WEAP -----------------------------------------
//
// WEAP also gates several advanced structures: FIX, TSLA, ATEK, STEK.

describe('WEAP is prerequisite for advanced structures', () => {

  const structItems = PRODUCTION_ITEMS.filter(
    p => p.prerequisite === 'WEAP' && p.isStructure === true,
  );

  it('gates Service Depot (FIX)', () => {
    const item = structItems.find(p => p.type === 'FIX');
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('WEAP');
  });

  it('gates Tesla Coil (TSLA) — soviet only', () => {
    const item = structItems.find(p => p.type === 'TSLA');
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('WEAP');
    expect(item!.faction).toBe('soviet');
  });

  it('gates Allied Tech Center (ATEK) — requires WEAP+DOME', () => {
    const item = structItems.find(p => p.type === 'ATEK');
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('WEAP');
    expect(item!.techPrereq).toBe('DOME');
  });

  it('gates Soviet Tech Center (STEK) — requires WEAP+DOME', () => {
    const item = structItems.find(p => p.type === 'STEK');
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('WEAP');
    expect(item!.techPrereq).toBe('DOME');
  });
});

// -- Power Drain in Grid (calculatePowerGrid) ---------------------------------
//
// WEAP consumes 30W. It does NOT produce power (powerOutput returns 0 for WEAP).

describe('WEAP power drain in grid (calculatePowerGrid)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('produces 0W at any health (not a power plant)', () => {
    expect(powerOutput('WEAP', 1000, 1000)).toBe(0);
    expect(powerOutput('WEAP', 500, 1000)).toBe(0);
    expect(powerOutput('WEAP', 0, 1000)).toBe(0);
  });

  it('consumes 30W in the power grid', () => {
    const weap = makeWEAP(10, 10, 1000, House.Spain);
    const powr = makeBuilding('POWR', 14, 10, 400, House.Spain);
    const grid = calculatePowerGrid([weap, powr], House.Spain, isAllied);
    expect(grid.consumed).toBe(30);
    expect(grid.produced).toBe(100);
  });

  it('dead WEAP does not consume power', () => {
    const weap = makeWEAP(10, 10, 0, House.Spain);
    weap.alive = false;
    const grid = calculatePowerGrid([weap], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('selling WEAP does not consume power', () => {
    const weap = makeWEAP(10, 10, 1000, House.Spain);
    weap.sellProgress = 0.5;
    const grid = calculatePowerGrid([weap], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('enemy WEAP does not affect player grid', () => {
    const weap = makeWEAP(10, 10, 1000, House.USSR);
    const grid = calculatePowerGrid([weap], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('multiple WEAP structures stack power drain', () => {
    const w1 = makeWEAP(10, 10, 1000, House.Spain);
    const w2 = makeWEAP(16, 10, 1000, House.Spain);
    const grid = calculatePowerGrid([w1, w2], House.Spain, isAllied);
    expect(grid.consumed).toBe(60); // 30 + 30
  });
});

// -- Economic Functions (repairSell.ts) ---------------------------------------
//
// C++ rules.ini: WEAP Cost=2000, Strength=1000

describe('WEAP economic functions (rules.ini Cost=2000)', () => {
  const WEAP_COST = 2000;
  const WEAP_MAX_HP = 1000;

  it('sell refund is 50% of build cost = 1000', () => {
    expect(sellRefund(WEAP_COST)).toBe(1000);
  });

  it('repair cost per step: ceil(2000 * 0.20 / (1000 / 7)) = ceil(400 / 142.857) = 3', () => {
    expect(repairCostPerStep(WEAP_COST, WEAP_MAX_HP)).toBe(3);
  });
});

// -- 3x2 Footprint -----------------------------------------------------------
//
// C++ STRUCTURE_SIZE: WEAP is 3x2. The origin cell is top-left;
// the structure occupies 6 cells in a 3-wide, 2-tall rectangle.

describe('WEAP 3x2 footprint', () => {

  it('footprint occupies 6 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['WEAP']!;
    expect(w).toBe(3);
    expect(h).toBe(2);
    expect(w * h).toBe(6);
  });

  it('enumerates correct cells from origin (10,10)', () => {
    const [w, h] = STRUCTURE_SIZE['WEAP']!;
    const cells: [number, number][] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells.push([10 + dx, 10 + dy]);
      }
    }
    expect(cells).toEqual([
      [10, 10], [11, 10], [12, 10],
      [10, 11], [11, 11], [12, 11],
    ]);
  });
});

// -- Destruction Blast — Radial HE (building.cpp) -----------------------------
//
// Non-barrel structures (including WEAP) use a generic 2-cell radial HE blast
// with distance falloff on destruction. This is NOT the barrel cardinal
// fire-bullet mechanic.

describe('WEAP destruction blast — radial HE (non-barrel)', () => {

  it('damages entities within 2-cell radius on destruction', () => {
    const weap = makeWEAP(10, 10, 50); // Low HP, will die
    weap.house = House.USSR;
    // Place entity in adjacent cell (within 3x2 footprint edge + 1)
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([weap], [victim]);
    structureDamage(ctx, weap, 100);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('damages entities in diagonal cells (within 2-cell radius)', () => {
    const weap = makeWEAP(10, 10, 50);
    weap.house = House.USSR;
    // Entity at (11,11) — inside footprint, within 2-cell radius
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    // Building center for a 3x2: cx=10 -> center x = 10*24 + 24*1.5 = 276
    const bx = 10 * CELL_SIZE + (CELL_SIZE * 3) / 2;
    const by = 10 * CELL_SIZE + CELL_SIZE;
    const dist = worldDist({ x: bx, y: by }, victim.pos);
    expect(dist).toBeLessThan(2);
    const ctx = makeCombatCtx([weap], [victim]);
    structureDamage(ctx, weap, 100);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('uses distance falloff (closer = more damage)', () => {
    const weap = makeWEAP(10, 10, 50);
    weap.house = House.USSR;
    const close = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const far = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 12);
    const ctx = makeCombatCtx([weap], [close, far]);
    structureDamage(ctx, weap, 100);
    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    expect(closeDmg).toBeGreaterThan(farDmg);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const weap = makeWEAP(10, 10, 50);
    weap.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 14, 10); // 4 cells E
    const ctx = makeCombatCtx([weap], [victim]);
    structureDamage(ctx, weap, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('destruction blast damages adjacent structures', () => {
    const weap = makeWEAP(10, 10, 50);
    weap.house = House.USSR;
    // SILO at (12,10) overlaps with WEAP footprint edge — well within blast radius
    const nearby = makeBuilding('SILO', 12, 10, 300);
    const ctx = makeCombatCtx([weap, nearby]);
    structureDamage(ctx, weap, 100);
    expect(nearby.hp).toBeLessThan(300);
  });

  it('does NOT use barrel cardinal fire-bullet mechanic', () => {
    // Barrel explosions hit ONLY cardinal cells with flat 200 damage.
    // WEAP should use radial HE with falloff instead — diagonals should
    // take damage (unlike barrels where diagonals are immune).
    const weap = makeWEAP(10, 10, 50);
    weap.house = House.USSR;
    const diagonal = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([weap], [diagonal]);
    structureDamage(ctx, weap, 100);
    // Radial HE hits diagonals — unlike barrel cardinal-only
    expect(diagonal.hp).toBeLessThan(diagonal.maxHp);
  });
});

// -- WEAP as Production Hub (behavioral) --------------------------------------
//
// The War Factory is central to the tech tree. Losing it cuts off vehicle
// production and blocks structures that depend on it (FIX, TSLA, ATEK, STEK).

describe('WEAP as production hub — tech tree dependencies', () => {

  it('all vehicle production items reference WEAP as prerequisite', () => {
    const vehicleTypes = ['JEEP', '1TNK', '2TNK', '3TNK', '4TNK', 'ARTY', 'APC', 'HARV'];
    for (const vtype of vehicleTypes) {
      const item = PRODUCTION_ITEMS.find(p => p.type === vtype);
      expect(item, `${vtype} should exist in PRODUCTION_ITEMS`).toBeDefined();
      expect(item!.prerequisite, `${vtype} should require WEAP`).toBe('WEAP');
    }
  });

  it('no infantry item has WEAP as prerequisite (only vehicles/structures)', () => {
    const infantryWithWeap = PRODUCTION_ITEMS.filter(
      p => p.prerequisite === 'WEAP' && !p.isStructure &&
        ['E1', 'E2', 'E3', 'E4', 'E6', 'E7', 'DOG', 'MEDI', 'SHOK', 'MECH', 'THF', 'SPY'].includes(p.type),
    );
    expect(infantryWithWeap).toHaveLength(0);
  });

  it('WEAP itself requires PROC — chaining FACT->POWR->PROC->WEAP', () => {
    const weapItem = PRODUCTION_ITEMS.find(p => p.type === 'WEAP');
    const procItem = PRODUCTION_ITEMS.find(p => p.type === 'PROC');
    const powrItem = PRODUCTION_ITEMS.find(p => p.type === 'POWR');
    expect(weapItem!.prerequisite).toBe('PROC');
    expect(procItem!.prerequisite).toBe('POWR');
    expect(powrItem!.prerequisite).toBe('FACT');
  });
});
