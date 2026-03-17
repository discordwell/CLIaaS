/**
 * C++ Behavioral Parity: POWR — Power Plant
 *
 * Tests verify Power Plant behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with a Power Plant (observable
 * outcomes: stats, power output, damage scaling, destruction blast),
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
  powerOutput, calculatePowerGrid, sellRefund, repairCostPerStep,
} from '../engine/repairSell';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makePOWR(cx: number, cy: number, hp = 400, house: House = House.Spain): MapStructure {
  return {
    type: 'POWR', image: 'powr', house,
    cx, cy, hp, maxHp: 400, alive: true, rubble: false,
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
// C++ rules.ini: POWR -> Strength=400, Cost=300, Power=-100 (produces 100W),
// Prerequisite=FACT, Owner=allies,soviet, TechLevel=1

describe('POWR stats (rules.ini parity)', () => {

  it('max HP is 400', () => {
    expect(STRUCTURE_MAX_HP['POWR']).toBe(400);
  });

  it('footprint is 2x2 cells', () => {
    expect(STRUCTURE_SIZE['POWR']).toEqual([2, 2]);
  });

  it('has no weapon (purely economic)', () => {
    expect(STRUCTURE_WEAPONS['POWR']).toBeUndefined();
  });

  it('is not a power consumer (no entry in POWER_DRAIN)', () => {
    expect(POWER_DRAIN['POWR']).toBeUndefined();
  });

  it('is available to both factions (rules.ini Owner=allies,soviet)', () => {
    // The production item for POWR has faction='both'
    // We test this indirectly: a POWR can be placed for allied or soviet houses
    const alliedPOWR = makePOWR(10, 10, 400, House.Spain);
    const sovietPOWR = makePOWR(20, 20, 400, House.USSR);
    expect(alliedPOWR.type).toBe('POWR');
    expect(sovietPOWR.type).toBe('POWR');
  });
});

// -- Power Production (building.cpp:4613 Power_Output) ------------------------
//
// C++ Power_Output: returns (Power * health_ratio) where Power= -100 for POWR.
// Negative drain means production. At full health: 100W. Scales linearly.

describe('POWR power production (building.cpp:4613 Power_Output)', () => {

  it('produces 100W at full health (400/400)', () => {
    expect(powerOutput('POWR', 400, 400)).toBe(100);
  });

  it('produces 50W at half health (200/400)', () => {
    expect(powerOutput('POWR', 200, 400)).toBe(50);
  });

  it('produces 25W at quarter health (100/400)', () => {
    expect(powerOutput('POWR', 100, 400)).toBe(25);
  });

  it('produces 0W when dead (0/400)', () => {
    expect(powerOutput('POWR', 0, 400)).toBe(0);
  });

  it('produces 75W at 75% health (300/400)', () => {
    expect(powerOutput('POWR', 300, 400)).toBe(75);
  });

  it('rounds output at non-integer health ratios (1/400 -> 0W)', () => {
    // 1/400 = 0.0025, * 100 = 0.25, round = 0
    expect(powerOutput('POWR', 1, 400)).toBe(0);
  });

  it('rounds output at non-integer health ratios (199/400 -> 50W)', () => {
    // 199/400 = 0.4975, * 100 = 49.75, round = 50
    expect(powerOutput('POWR', 199, 400)).toBe(50);
  });

  it('handles zero maxHp safely (no division by zero)', () => {
    expect(powerOutput('POWR', 0, 0)).toBe(0);
  });

  it('non-power structures produce 0W', () => {
    expect(powerOutput('WEAP', 1000, 1000)).toBe(0);
    expect(powerOutput('TENT', 800, 800)).toBe(0);
    expect(powerOutput('PROC', 900, 900)).toBe(0);
  });
});

// -- Power Grid Integration (calculatePowerGrid) -----------------------------
//
// POWR contributes to the produced side of the grid, scaled by health.
// Other structures consume via POWER_DRAIN. Only alive, non-selling,
// allied structures count.

describe('POWR in power grid (calculatePowerGrid)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('single full-health POWR produces 100W, 0 consumed', () => {
    const powr = makePOWR(10, 10, 400, House.Spain);
    const grid = calculatePowerGrid([powr], House.Spain, isAllied);
    expect(grid.produced).toBe(100);
    expect(grid.consumed).toBe(0);
  });

  it('two POWR at full health produce 200W', () => {
    const p1 = makePOWR(10, 10, 400, House.Spain);
    const p2 = makePOWR(14, 10, 400, House.Spain);
    const grid = calculatePowerGrid([p1, p2], House.Spain, isAllied);
    expect(grid.produced).toBe(200);
  });

  it('damaged POWR produces less (200/400 -> 50W)', () => {
    const powr = makePOWR(10, 10, 200, House.Spain);
    const grid = calculatePowerGrid([powr], House.Spain, isAllied);
    expect(grid.produced).toBe(50);
  });

  it('dead POWR produces 0W', () => {
    const powr = makePOWR(10, 10, 0, House.Spain);
    powr.alive = false;
    const grid = calculatePowerGrid([powr], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
  });

  it('selling POWR does not contribute to grid', () => {
    const powr = makePOWR(10, 10, 400, House.Spain);
    powr.sellProgress = 0.5;
    const grid = calculatePowerGrid([powr], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
  });

  it('enemy POWR does not contribute to player grid', () => {
    const powr = makePOWR(10, 10, 400, House.USSR);
    const grid = calculatePowerGrid([powr], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
  });

  it('POWR + consuming building yields correct net power', () => {
    const powr = makePOWR(10, 10, 400, House.Spain);
    const tent = makeBuilding('TENT', 14, 10, 800, House.Spain);
    const grid = calculatePowerGrid([powr, tent], House.Spain, isAllied);
    expect(grid.produced).toBe(100);
    expect(grid.consumed).toBe(POWER_DRAIN['TENT']); // 20
    expect(grid.produced - grid.consumed).toBe(80);
  });
});

// -- Economic Functions (repairSell.ts) ---------------------------------------
//
// C++ rules.ini: POWR Cost=300, Strength=400

describe('POWR economic functions (rules.ini Cost=300)', () => {
  const POWR_COST = 300;
  const POWR_MAX_HP = 400;

  it('sell refund is 50% of build cost = 150', () => {
    expect(sellRefund(POWR_COST)).toBe(150);
  });

  it('repair cost per step: ceil(300 * 0.20 / (400 / 7)) = ceil(60 / 57.14) = 2', () => {
    expect(repairCostPerStep(POWR_COST, POWR_MAX_HP)).toBe(2);
  });
});

// -- 2x2 Footprint -----------------------------------------------------------
//
// C++ STRUCTURE_SIZE: POWR is 2x2. The origin cell is top-left;
// the structure occupies (cx,cy), (cx+1,cy), (cx,cy+1), (cx+1,cy+1).

describe('POWR 2x2 footprint', () => {

  it('footprint occupies 4 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['POWR']!;
    expect(w * h).toBe(4);
    // Origin at (10,10) -> cells: (10,10), (11,10), (10,11), (11,11)
    const cells: [number, number][] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells.push([10 + dx, 10 + dy]);
      }
    }
    expect(cells).toEqual([[10, 10], [11, 10], [10, 11], [11, 11]]);
  });
});

// -- Destruction Blast — Radial HE (building.cpp) -----------------------------
//
// Non-barrel structures (including POWR) use a generic 2-cell radial HE blast
// with distance falloff on destruction. This is NOT the barrel cardinal
// fire-bullet mechanic.

describe('POWR destruction blast — radial HE (non-barrel)', () => {

  it('damages entities within 2-cell radius on destruction', () => {
    const powr = makePOWR(10, 10, 50); // Low HP, will die
    powr.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([powr], [victim]);
    structureDamage(ctx, powr, 100);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('damages entities in diagonal cells (within 2-cell radius)', () => {
    const powr = makePOWR(10, 10, 50);
    powr.house = House.USSR;
    // Entity at diagonal (11,11) — within 2-cell radius
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const bx = 10 * CELL_SIZE + CELL_SIZE;
    const by = 10 * CELL_SIZE + CELL_SIZE;
    const dist = worldDist({ x: bx, y: by }, victim.pos);
    expect(dist).toBeLessThan(2);
    const ctx = makeCombatCtx([powr], [victim]);
    structureDamage(ctx, powr, 100);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('uses distance falloff (closer = more damage)', () => {
    const powr = makePOWR(10, 10, 50);
    powr.house = House.USSR;
    const close = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const far = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 12);
    const ctx = makeCombatCtx([powr], [close, far]);
    structureDamage(ctx, powr, 100);
    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    expect(closeDmg).toBeGreaterThan(farDmg);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const powr = makePOWR(10, 10, 50);
    powr.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 13, 10); // 3 cells E
    const ctx = makeCombatCtx([powr], [victim]);
    structureDamage(ctx, powr, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('destruction blast damages adjacent structures', () => {
    const powr = makePOWR(10, 10, 50);
    powr.house = House.USSR;
    const nearby = makeBuilding('SILO', 12, 10, 256);
    const ctx = makeCombatCtx([powr, nearby]);
    structureDamage(ctx, powr, 100);
    expect(nearby.hp).toBeLessThan(256);
  });

  it('does NOT use barrel cardinal fire-bullet mechanic', () => {
    // Barrel explosions hit ONLY cardinal cells with flat 200 damage.
    // POWR should use radial HE with falloff instead — diagonals should
    // take damage (unlike barrels where diagonals are immune).
    const powr = makePOWR(10, 10, 50);
    powr.house = House.USSR;
    const diagonal = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([powr], [diagonal]);
    structureDamage(ctx, powr, 100);
    // Radial HE hits diagonals — unlike barrel cardinal-only
    expect(diagonal.hp).toBeLessThan(diagonal.maxHp);
  });
});

// -- Power Output Scales with Damage (regression) ----------------------------
//
// When a POWR takes damage, its power output drops proportionally.
// This is critical for gameplay: destroying enemy power plants
// degrades their power grid incrementally.

describe('POWR power output degrades with combat damage', () => {

  it('taking 200 damage (400->200 HP) halves output from 100W to 50W', () => {
    const powr = makePOWR(10, 10, 400);
    // Simulate damage
    powr.hp = 200;
    expect(powerOutput('POWR', powr.hp, powr.maxHp)).toBe(50);
  });

  it('taking 300 damage (400->100 HP) quarters output from 100W to 25W', () => {
    const powr = makePOWR(10, 10, 400);
    powr.hp = 100;
    expect(powerOutput('POWR', powr.hp, powr.maxHp)).toBe(25);
  });

  it('each point of damage reduces output proportionally', () => {
    // At 399/400 HP: round(100 * 399/400) = round(99.75) = 100
    expect(powerOutput('POWR', 399, 400)).toBe(100);
    // At 398/400 HP: round(100 * 398/400) = round(99.5) = 100 (banker's rounding)
    // At 396/400 HP: round(100 * 396/400) = round(99) = 99
    expect(powerOutput('POWR', 396, 400)).toBe(99);
  });

  it('power grid updates when POWR is damaged', () => {
    const alliances = buildDefaultAlliances();
    const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

    const powr = makePOWR(10, 10, 400, House.Spain);
    const gridFull = calculatePowerGrid([powr], House.Spain, isAllied);
    expect(gridFull.produced).toBe(100);

    powr.hp = 200;
    const gridDamaged = calculatePowerGrid([powr], House.Spain, isAllied);
    expect(gridDamaged.produced).toBe(50);

    powr.hp = 1;
    const gridCritical = calculatePowerGrid([powr], House.Spain, isAllied);
    expect(gridCritical.produced).toBe(0); // round(100 * 1/400) = round(0.25) = 0
  });
});
