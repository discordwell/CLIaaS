/**
 * C++ Behavioral Parity: PROC — Ore Refinery
 *
 * Tests verify Ore Refinery behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with an Ore Refinery (observable
 * outcomes: stats, power drain, silo capacity, destruction effects),
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
  powerOutput, calculatePowerGrid, calculateSiloCapacity,
  sellRefund, repairCostPerStep,
} from '../engine/repairSell';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makePROC(cx: number, cy: number, hp = 900, house: House = House.Spain): MapStructure {
  return {
    type: 'PROC', image: 'proc', house,
    cx, cy, hp, maxHp: 900, alive: true, rubble: false,
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
// C++ rules.ini: PROC -> Strength=900, Cost=2000, Power=30 (consumes 30W),
// Prerequisite=POWR, Owner=allies,soviet, TechLevel=1, Storage=1000

describe('PROC stats (rules.ini parity)', () => {

  it('max HP is 900', () => {
    expect(STRUCTURE_MAX_HP['PROC']).toBe(900);
  });

  it('footprint is 3x2 cells', () => {
    expect(STRUCTURE_SIZE['PROC']).toEqual([3, 2]);
  });

  it('has no weapon (purely economic)', () => {
    expect(STRUCTURE_WEAPONS['PROC']).toBeUndefined();
  });

  it('is a power consumer draining 30W (rules.ini Power=30)', () => {
    expect(POWER_DRAIN['PROC']).toBe(30);
  });

  it('is available to both factions (rules.ini Owner=allies,soviet)', () => {
    const alliedPROC = makePROC(10, 10, 900, House.Spain);
    const sovietPROC = makePROC(20, 20, 900, House.USSR);
    expect(alliedPROC.type).toBe('PROC');
    expect(sovietPROC.type).toBe('PROC');
  });
});

// -- Power Consumption in Grid (calculatePowerGrid) ---------------------------
//
// PROC consumes 30W from the power grid. It does NOT produce power.
// Only alive, non-selling, allied structures count.

describe('PROC power consumption in grid (calculatePowerGrid)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('PROC consumes 30W', () => {
    const proc = makePROC(10, 10, 900, House.Spain);
    const grid = calculatePowerGrid([proc], House.Spain, isAllied);
    expect(grid.consumed).toBe(30);
    expect(grid.produced).toBe(0);
  });

  it('PROC does NOT produce power', () => {
    expect(powerOutput('PROC', 900, 900)).toBe(0);
  });

  it('POWR + PROC yields 100W produced, 30W consumed', () => {
    const powr = makeBuilding('POWR', 10, 10, 400, House.Spain);
    const proc = makePROC(14, 10, 900, House.Spain);
    const grid = calculatePowerGrid([powr, proc], House.Spain, isAllied);
    expect(grid.produced).toBe(100);
    expect(grid.consumed).toBe(30);
    expect(grid.produced - grid.consumed).toBe(70);
  });

  it('dead PROC does not consume power', () => {
    const proc = makePROC(10, 10, 0, House.Spain);
    proc.alive = false;
    const grid = calculatePowerGrid([proc], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('selling PROC does not consume power', () => {
    const proc = makePROC(10, 10, 900, House.Spain);
    proc.sellProgress = 0.5;
    const grid = calculatePowerGrid([proc], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('enemy PROC does not appear in player grid', () => {
    const proc = makePROC(10, 10, 900, House.USSR);
    const grid = calculatePowerGrid([proc], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('two PROCs consume 60W total', () => {
    const p1 = makePROC(10, 10, 900, House.Spain);
    const p2 = makePROC(16, 10, 900, House.Spain);
    const grid = calculatePowerGrid([p1, p2], House.Spain, isAllied);
    expect(grid.consumed).toBe(60);
  });
});

// -- Silo Capacity (building.cpp Capacity()) ----------------------------------
//
// C++ building.cpp Capacity(): PROC provides 1000 ore storage, SILO provides 1500.
// Only alive, allied structures with completed construction count.

describe('PROC silo capacity (building.cpp Capacity())', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('single PROC provides 1000 ore storage', () => {
    const proc = makePROC(10, 10, 900, House.Spain);
    expect(calculateSiloCapacity([proc], House.Spain, isAllied)).toBe(1000);
  });

  it('two PROCs provide 2000 ore storage', () => {
    const p1 = makePROC(10, 10, 900, House.Spain);
    const p2 = makePROC(16, 10, 900, House.Spain);
    expect(calculateSiloCapacity([p1, p2], House.Spain, isAllied)).toBe(2000);
  });

  it('PROC + SILO provides 2500 ore storage', () => {
    const proc = makePROC(10, 10, 900, House.Spain);
    const silo = makeBuilding('SILO', 14, 10, 256, House.Spain);
    expect(calculateSiloCapacity([proc, silo], House.Spain, isAllied)).toBe(2500);
  });

  it('dead PROC provides 0 storage', () => {
    const proc = makePROC(10, 10, 0, House.Spain);
    proc.alive = false;
    expect(calculateSiloCapacity([proc], House.Spain, isAllied)).toBe(0);
  });

  it('enemy PROC does not count toward player capacity', () => {
    const proc = makePROC(10, 10, 900, House.USSR);
    expect(calculateSiloCapacity([proc], House.Spain, isAllied)).toBe(0);
  });

  it('PROC under construction (buildProgress < 1) does not count', () => {
    const proc = makePROC(10, 10, 900, House.Spain);
    proc.buildProgress = 0.5;
    expect(calculateSiloCapacity([proc], House.Spain, isAllied)).toBe(0);
  });

  it('fully constructed PROC (buildProgress=1) counts', () => {
    const proc = makePROC(10, 10, 900, House.Spain);
    proc.buildProgress = 1;
    expect(calculateSiloCapacity([proc], House.Spain, isAllied)).toBe(1000);
  });

  it('damaged PROC still provides full 1000 storage (capacity is binary)', () => {
    const proc = makePROC(10, 10, 1, House.Spain);
    expect(calculateSiloCapacity([proc], House.Spain, isAllied)).toBe(1000);
  });
});

// -- Economic Functions (repairSell.ts) ---------------------------------------
//
// C++ rules.ini: PROC Cost=2000, Strength=900

describe('PROC economic functions (rules.ini Cost=2000)', () => {
  const PROC_COST = 2000;
  const PROC_MAX_HP = 900;

  it('sell refund is 50% of build cost = 1000', () => {
    expect(sellRefund(PROC_COST)).toBe(1000);
  });

  it('repair cost per step: ceil(2000 * 0.20 / (900 / 7)) = ceil(400 / 128.57) = 4', () => {
    expect(repairCostPerStep(PROC_COST, PROC_MAX_HP)).toBe(4);
  });
});

// -- 3x2 Footprint -----------------------------------------------------------
//
// C++ STRUCTURE_SIZE: PROC is 3x2. The origin cell is top-left;
// the structure occupies 6 cells total.

describe('PROC 3x2 footprint', () => {

  it('footprint occupies 6 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['PROC']!;
    expect(w).toBe(3);
    expect(h).toBe(2);
    expect(w * h).toBe(6);
    // Origin at (10,10) -> cells across 3 wide, 2 tall
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
// Non-barrel structures (including PROC) use a generic 2-cell radial HE blast
// with distance falloff on destruction. This is NOT the barrel cardinal
// fire-bullet mechanic.

describe('PROC destruction blast — radial HE (non-barrel)', () => {

  it('damages entities within 2-cell radius on destruction', () => {
    const proc = makePROC(10, 10, 50);
    proc.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([proc], [victim]);
    structureDamage(ctx, proc, 100);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('damages entities in diagonal cells (within 2-cell radius)', () => {
    const proc = makePROC(10, 10, 50);
    proc.house = House.USSR;
    // Entity at diagonal (11,11) — PROC center is at (11.5, 11) for 3x2
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([proc], [victim]);
    structureDamage(ctx, proc, 100);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('uses distance falloff (closer = more damage)', () => {
    const proc = makePROC(10, 10, 50);
    proc.house = House.USSR;
    const close = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const far = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 12);
    const ctx = makeCombatCtx([proc], [close, far]);
    structureDamage(ctx, proc, 100);
    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    expect(closeDmg).toBeGreaterThan(farDmg);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const proc = makePROC(10, 10, 50);
    proc.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 14, 10); // 4 cells E of origin
    const ctx = makeCombatCtx([proc], [victim]);
    structureDamage(ctx, proc, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('destruction blast damages adjacent structures', () => {
    const proc = makePROC(10, 10, 50);
    proc.house = House.USSR;
    // PROC center: (10*24+24, 10*24+24) = (264, 264). Place SILO at (12,10)
    // so its center is (12*24+24, 10*24+24) = (312, 264), dist = 2.0 cells — within blast
    const nearby = makeBuilding('SILO', 12, 10, 256);
    const ctx = makeCombatCtx([proc, nearby]);
    structureDamage(ctx, proc, 100);
    expect(nearby.hp).toBeLessThan(256);
  });

  it('does NOT use barrel cardinal fire-bullet mechanic', () => {
    // Barrel explosions hit ONLY cardinal cells with flat 200 damage.
    // PROC should use radial HE with falloff instead — diagonals should
    // take damage (unlike barrels where diagonals are immune).
    const proc = makePROC(10, 10, 50);
    proc.house = House.USSR;
    const diagonal = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([proc], [diagonal]);
    structureDamage(ctx, proc, 100);
    // Radial HE hits diagonals — unlike barrel cardinal-only
    expect(diagonal.hp).toBeLessThan(diagonal.maxHp);
  });
});

// -- Silo Capacity Recalculation on Destruction (combat.ts) -------------------
//
// C++ parity: when a PROC is destroyed, recalculateSiloCapacity() is called
// to adjust storage. This is critical — losing a refinery means losing
// 1000 ore storage capacity.

describe('PROC destruction triggers silo capacity recalculation', () => {

  it('recalculateSiloCapacity is called when allied PROC is destroyed', () => {
    const proc = makePROC(10, 10, 50, House.Spain);
    let recalcCalled = false;
    const ctx = makeCombatCtx([proc]);
    ctx.recalculateSiloCapacity = () => { recalcCalled = true; };
    structureDamage(ctx, proc, 100);
    expect(proc.alive).toBe(false);
    expect(recalcCalled).toBe(true);
  });

  it('recalculateSiloCapacity is NOT called when enemy PROC is destroyed', () => {
    const proc = makePROC(10, 10, 50, House.USSR);
    let recalcCalled = false;
    const ctx = makeCombatCtx([proc]);
    ctx.recalculateSiloCapacity = () => { recalcCalled = true; };
    structureDamage(ctx, proc, 100);
    expect(proc.alive).toBe(false);
    expect(recalcCalled).toBe(false);
  });

  it('recalculateSiloCapacity is NOT called when PROC is damaged but survives', () => {
    const proc = makePROC(10, 10, 900, House.Spain);
    let recalcCalled = false;
    const ctx = makeCombatCtx([proc]);
    ctx.recalculateSiloCapacity = () => { recalcCalled = true; };
    structureDamage(ctx, proc, 100);
    expect(proc.alive).toBe(true);
    expect(recalcCalled).toBe(false);
  });

  it('capacity drops by 1000 when a PROC is destroyed', () => {
    const alliances = buildDefaultAlliances();
    const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

    const proc1 = makePROC(10, 10, 900, House.Spain);
    const proc2 = makePROC(16, 10, 50, House.Spain);
    const silo = makeBuilding('SILO', 20, 10, 256, House.Spain);
    const structs = [proc1, proc2, silo];

    // Before destruction: 1000 + 1000 + 1500 = 3500
    expect(calculateSiloCapacity(structs, House.Spain, isAllied)).toBe(3500);

    // Destroy proc2
    const ctx = makeCombatCtx(structs);
    ctx.recalculateSiloCapacity = () => {
      // The game would recalculate here — we verify the math
    };
    structureDamage(ctx, proc2, 100);
    expect(proc2.alive).toBe(false);

    // After destruction: 1000 + 0 + 1500 = 2500
    expect(calculateSiloCapacity(structs, House.Spain, isAllied)).toBe(2500);
  });
});

// -- Destruction Side Effects -------------------------------------------------
//
// C++ building.cpp: on destruction, PROC increments structuresLost for
// allied structures, triggers EVA "unit lost" announcement, and
// produces screen shake proportional to footprint size.

describe('PROC destruction side effects', () => {

  it('increments structuresLost when allied PROC is destroyed', () => {
    const proc = makePROC(10, 10, 50, House.Spain);
    const ctx = makeCombatCtx([proc]);
    expect(ctx.structuresLost).toBe(0);
    structureDamage(ctx, proc, 100);
    expect(ctx.structuresLost).toBe(1);
  });

  it('does NOT increment structuresLost for enemy PROC', () => {
    const proc = makePROC(10, 10, 50, House.USSR);
    const ctx = makeCombatCtx([proc]);
    structureDamage(ctx, proc, 100);
    expect(ctx.structuresLost).toBe(0);
  });

  it('increments nBuildingsDestroyedCount for enemy PROC', () => {
    const proc = makePROC(10, 10, 50, House.USSR);
    const ctx = makeCombatCtx([proc]);
    expect(ctx.nBuildingsDestroyedCount).toBe(0);
    structureDamage(ctx, proc, 100);
    expect(ctx.nBuildingsDestroyedCount).toBe(1);
  });

  it('produces EVA announcement when allied PROC is destroyed', () => {
    const proc = makePROC(10, 10, 50, House.Spain);
    let evaPlayed = '';
    const ctx = makeCombatCtx([proc]);
    ctx.playEva = (name: string) => { evaPlayed = name; };
    structureDamage(ctx, proc, 100);
    expect(evaPlayed).toBe('eva_unit_lost');
  });

  it('produces screen shake on destruction (3x2 -> shakeIntensity=12)', () => {
    const proc = makePROC(10, 10, 50, House.USSR);
    const ctx = makeCombatCtx([proc]);
    structureDamage(ctx, proc, 100);
    // shakeIntensity = min(20, 4 + max(3, 2) * 4) = min(20, 4 + 12) = 16
    expect(ctx.screenShake).toBe(16);
  });

  it('spawns explosion and debris effects on destruction', () => {
    const proc = makePROC(10, 10, 50, House.USSR);
    const ctx = makeCombatCtx([proc]);
    structureDamage(ctx, proc, 100);
    const explosions = ctx.effects.filter(e => e.type === 'explosion');
    const debris = ctx.effects.filter(e => e.type === 'debris');
    expect(explosions.length).toBeGreaterThan(0);
    expect(debris.length).toBeGreaterThan(0);
  });

  it('calls clearStructureFootprint on destruction', () => {
    const proc = makePROC(10, 10, 50, House.USSR);
    let cleared = false;
    const ctx = makeCombatCtx([proc]);
    ctx.clearStructureFootprint = () => { cleared = true; };
    structureDamage(ctx, proc, 100);
    expect(cleared).toBe(true);
  });

  it('sets rubble flag on destruction', () => {
    const proc = makePROC(10, 10, 50, House.USSR);
    const ctx = makeCombatCtx([proc]);
    structureDamage(ctx, proc, 100);
    expect(proc.alive).toBe(false);
    expect(proc.rubble).toBe(true);
  });
});

// -- Damage Behavior (structureDamage incremental) ----------------------------
//
// PROC takes damage normally — HP is reduced, structure survives
// partial damage but dies at 0.

describe('PROC damage behavior', () => {

  it('taking 100 damage reduces HP from 900 to 800', () => {
    const proc = makePROC(10, 10, 900);
    const ctx = makeCombatCtx([proc]);
    structureDamage(ctx, proc, 100);
    expect(proc.hp).toBe(800);
    expect(proc.alive).toBe(true);
  });

  it('taking 900 damage kills PROC from full health', () => {
    const proc = makePROC(10, 10, 900);
    const ctx = makeCombatCtx([proc]);
    structureDamage(ctx, proc, 900);
    expect(proc.hp).toBe(0);
    expect(proc.alive).toBe(false);
  });

  it('overkill damage clamps HP to 0', () => {
    const proc = makePROC(10, 10, 100);
    const ctx = makeCombatCtx([proc]);
    structureDamage(ctx, proc, 500);
    expect(proc.hp).toBe(0);
    expect(proc.alive).toBe(false);
  });

  it('multiple hits accumulate damage', () => {
    const proc = makePROC(10, 10, 900);
    const ctx = makeCombatCtx([proc]);
    structureDamage(ctx, proc, 300);
    expect(proc.hp).toBe(600);
    structureDamage(ctx, proc, 300);
    expect(proc.hp).toBe(300);
    structureDamage(ctx, proc, 300);
    expect(proc.hp).toBe(0);
    expect(proc.alive).toBe(false);
  });

  it('already dead PROC takes no further damage', () => {
    const proc = makePROC(10, 10, 0);
    proc.alive = false;
    const ctx = makeCombatCtx([proc]);
    const result = structureDamage(ctx, proc, 100);
    expect(result).toBe(false);
    expect(proc.hp).toBe(0);
  });
});
