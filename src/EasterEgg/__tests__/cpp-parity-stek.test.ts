/**
 * C++ Behavioral Parity: STEK — Soviet Technology Center
 *
 * Tests verify Soviet Tech Center behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with a Soviet Tech Center (observable
 * outcomes: stats, power drain, tech gating, destruction blast),
 * not HOW the code implements it. The same scenarios should produce
 * identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, POWER_DRAIN, COUNTRY_BONUSES,
  PRODUCTION_ITEMS,
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

function makeSTEK(cx: number, cy: number, hp = 600, house: House = House.USSR): MapStructure {
  return {
    type: 'STEK', image: 'stek', house,
    cx, cy, hp, maxHp: 600, alive: true, rubble: false,
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
// C++ rules.ini: STEK -> Strength=600, Cost=1500, Power=100 (consumes 100W),
// Prerequisite=WEAP, Owner=soviet, TechLevel=6

describe('STEK stats (rules.ini parity)', () => {

  it('max HP is 600', () => {
    expect(STRUCTURE_MAX_HP['STEK']).toBe(600);
  });

  it('footprint is 3x3 cells', () => {
    expect(STRUCTURE_SIZE['STEK']).toEqual([3, 3]);
  });

  it('has no weapon (purely a tech structure)', () => {
    expect(STRUCTURE_WEAPONS['STEK']).toBeUndefined();
  });

  it('consumes 100W power (POWER_DRAIN entry)', () => {
    expect(POWER_DRAIN['STEK']).toBe(100);
  });

  it('is soviet-only (rules.ini Owner=soviet)', () => {
    const stekItem = PRODUCTION_ITEMS.find(p => p.type === 'STEK');
    expect(stekItem).toBeDefined();
    expect(stekItem!.faction).toBe('soviet');
  });

  it('costs 1500 credits', () => {
    const stekItem = PRODUCTION_ITEMS.find(p => p.type === 'STEK');
    expect(stekItem).toBeDefined();
    expect(stekItem!.cost).toBe(1500);
  });

  it('requires WEAP as prerequisite', () => {
    const stekItem = PRODUCTION_ITEMS.find(p => p.type === 'STEK');
    expect(stekItem).toBeDefined();
    expect(stekItem!.prerequisite).toBe('WEAP');
  });

  it('requires DOME as tech prerequisite', () => {
    const stekItem = PRODUCTION_ITEMS.find(p => p.type === 'STEK');
    expect(stekItem).toBeDefined();
    expect(stekItem!.techPrereq).toBe('DOME');
  });

  it('is a structure (isStructure=true)', () => {
    const stekItem = PRODUCTION_ITEMS.find(p => p.type === 'STEK');
    expect(stekItem).toBeDefined();
    expect(stekItem!.isStructure).toBe(true);
  });

  it('has techLevel 6', () => {
    const stekItem = PRODUCTION_ITEMS.find(p => p.type === 'STEK');
    expect(stekItem).toBeDefined();
    expect(stekItem!.techLevel).toBe(6);
  });

  it('is NOT in STRUCTURE_POWERED set (no power-dependent active ability)', () => {
    expect(STRUCTURE_POWERED.has('STEK')).toBe(false);
  });
});

// -- Tech Gating (rules.ini Prerequisite/techPrereq) --------------------------
//
// C++ rules.ini: STEK unlocks advanced Soviet units and superweapon buildings.
// Units with techPrereq='STEK': 4TNK, E4, MSUB
// Structures with prerequisite='STEK': IRON, MSLO

describe('STEK tech gating (rules.ini prerequisites)', () => {

  it('4TNK (Mammoth Tank) requires STEK as techPrereq', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === '4TNK');
    expect(item).toBeDefined();
    expect(item!.techPrereq).toBe('STEK');
  });

  it('E4 (Flame Trooper) requires STEK as techPrereq', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'E4');
    expect(item).toBeDefined();
    expect(item!.techPrereq).toBe('STEK');
  });

  it('MSUB (Missile Sub) requires STEK as techPrereq', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'MSUB');
    expect(item).toBeDefined();
    expect(item!.techPrereq).toBe('STEK');
  });

  it('IRON (Iron Curtain) requires STEK as primary prerequisite', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'IRON');
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('STEK');
  });

  it('MSLO (Missile Silo) requires STEK as primary prerequisite', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'MSLO');
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('STEK');
  });

  it('all STEK-gated items are soviet faction or both', () => {
    const stekGated = PRODUCTION_ITEMS.filter(
      p => p.techPrereq === 'STEK' || p.prerequisite === 'STEK',
    );
    expect(stekGated.length).toBeGreaterThanOrEqual(5);
    for (const item of stekGated) {
      expect(
        item.faction === 'soviet' || item.faction === 'both',
        `${item.type} should be soviet or both, got ${item.faction}`,
      ).toBe(true);
    }
  });
});

// -- Power Drain in Grid (calculatePowerGrid) ---------------------------------
//
// STEK consumes 100W. It does NOT produce power.
// Only alive, non-selling, allied structures count.

describe('STEK in power grid (calculatePowerGrid)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('does not produce any power', () => {
    expect(powerOutput('STEK', 600, 600)).toBe(0);
  });

  it('consumes 100W in the power grid', () => {
    const stek = makeSTEK(10, 10, 600, House.USSR);
    const grid = calculatePowerGrid([stek], House.USSR, isAllied);
    expect(grid.produced).toBe(0);
    expect(grid.consumed).toBe(100);
  });

  it('POWR + STEK yields 100W produced, 100W consumed (net zero)', () => {
    const powr = makeBuilding('POWR', 10, 10, 400, House.USSR);
    const stek = makeSTEK(14, 10, 600, House.USSR);
    const grid = calculatePowerGrid([powr, stek], House.USSR, isAllied);
    expect(grid.produced).toBe(100);
    expect(grid.consumed).toBe(100);
    expect(grid.produced - grid.consumed).toBe(0);
  });

  it('dead STEK does not consume power', () => {
    const stek = makeSTEK(10, 10, 0, House.USSR);
    stek.alive = false;
    const grid = calculatePowerGrid([stek], House.USSR, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('selling STEK does not consume power', () => {
    const stek = makeSTEK(10, 10, 600, House.USSR);
    stek.sellProgress = 0.5;
    const grid = calculatePowerGrid([stek], House.USSR, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('enemy STEK does not affect player power grid', () => {
    const stek = makeSTEK(10, 10, 600, House.USSR);
    const grid = calculatePowerGrid([stek], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });
});

// -- Economic Functions (repairSell.ts) ---------------------------------------
//
// C++ rules.ini: STEK Cost=1500, Strength=600

describe('STEK economic functions (rules.ini Cost=1500)', () => {
  const STEK_COST = 1500;
  const STEK_MAX_HP = 600;

  it('sell refund is 50% of build cost = 750', () => {
    expect(sellRefund(STEK_COST)).toBe(750);
  });

  it('repair cost per step: C++ fixed-point (64*12+128)/256 = 3', () => {
    // C++ fixed-point: stepsToFull=600/5=120, costPerStep=1500/120=12, (64*12+128)/256=3
    expect(repairCostPerStep(STEK_COST, STEK_MAX_HP)).toBe(3);
  });
});

// -- 3x3 Footprint -----------------------------------------------------------
//
// C++ STRUCTURE_SIZE: STEK is 3x3 (BSIZE_33). The origin cell is top-left;
// the structure occupies 9 cells total.

describe('STEK 3x3 footprint', () => {

  it('footprint occupies 9 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['STEK']!;
    expect(w * h).toBe(9);
    // Origin at (10,10) -> 3x3 grid
    const cells: [number, number][] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells.push([10 + dx, 10 + dy]);
      }
    }
    expect(cells).toEqual([
      [10, 10], [11, 10], [12, 10],
      [10, 11], [11, 11], [12, 11],
      [10, 12], [11, 12], [12, 12],
    ]);
  });
});

// -- Destruction Blast — Radial HE (building.cpp) -----------------------------
//
// Non-barrel structures (including STEK) use a generic 2-cell radial HE blast
// with distance falloff on destruction. This is NOT the barrel cardinal
// fire-bullet mechanic.

describe('STEK destruction blast — radial HE (non-barrel)', () => {

  it('damages entities within 2-cell radius on destruction', () => {
    const stek = makeSTEK(10, 10, 50); // Low HP, will die
    stek.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([stek], [victim]);
    structureDamage(ctx, stek, 100);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('damages entities in diagonal cells (within 2-cell radius)', () => {
    const stek = makeSTEK(10, 10, 50);
    stek.house = House.USSR;
    // Entity at diagonal (11,11) — within 2-cell radius
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const bx = 10 * CELL_SIZE + CELL_SIZE;
    const by = 10 * CELL_SIZE + CELL_SIZE;
    const dist = worldDist({ x: bx, y: by }, victim.pos);
    expect(dist).toBeLessThan(2);
    const ctx = makeCombatCtx([stek], [victim]);
    structureDamage(ctx, stek, 100);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('uses distance falloff (closer = more damage)', () => {
    const stek = makeSTEK(10, 10, 50);
    stek.house = House.USSR;
    const close = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const far = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 12);
    const ctx = makeCombatCtx([stek], [close, far]);
    structureDamage(ctx, stek, 100);
    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    expect(closeDmg).toBeGreaterThan(farDmg);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const stek = makeSTEK(10, 10, 50);
    stek.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 13, 10); // 3 cells E
    const ctx = makeCombatCtx([stek], [victim]);
    structureDamage(ctx, stek, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('destruction blast damages adjacent structures', () => {
    const stek = makeSTEK(10, 10, 50);
    stek.house = House.USSR;
    const nearby = makeBuilding('SILO', 12, 10, 256);
    const ctx = makeCombatCtx([stek, nearby]);
    structureDamage(ctx, stek, 100);
    expect(nearby.hp).toBeLessThan(256);
  });

  it('does NOT use barrel cardinal fire-bullet mechanic', () => {
    // Barrel explosions hit ONLY cardinal cells with flat 200 damage.
    // STEK should use radial HE with falloff instead — diagonals should
    // take damage (unlike barrels where diagonals are immune).
    const stek = makeSTEK(10, 10, 50);
    stek.house = House.USSR;
    const diagonal = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([stek], [diagonal]);
    structureDamage(ctx, stek, 100);
    // Radial HE hits diagonals — unlike barrel cardinal-only
    expect(diagonal.hp).toBeLessThan(diagonal.maxHp);
  });
});

// -- STEK as Strategic Target -------------------------------------------------
//
// Destroying STEK removes tech gating for 4TNK, MSUB, IRON, MSLO, E4.
// The power grid also recovers 100W when STEK is destroyed.

describe('STEK strategic impact on power grid when destroyed', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('destroying STEK recovers 100W consumption from grid', () => {
    const powr = makeBuilding('POWR', 10, 10, 400, House.USSR);
    const stek = makeSTEK(14, 10, 600, House.USSR);

    const gridBefore = calculatePowerGrid([powr, stek], House.USSR, isAllied);
    expect(gridBefore.consumed).toBe(100);

    stek.alive = false;
    const gridAfter = calculatePowerGrid([powr, stek], House.USSR, isAllied);
    expect(gridAfter.consumed).toBe(0);
    expect(gridAfter.produced).toBe(100); // POWR still producing
  });

  it('STEK power drain is constant regardless of health', () => {
    // Unlike power PRODUCTION which scales with health,
    // power CONSUMPTION is flat — damaged STEK still drains 100W
    const stek = makeSTEK(10, 10, 300, House.USSR); // half health
    const grid = calculatePowerGrid([stek], House.USSR, isAllied);
    expect(grid.consumed).toBe(100); // still full drain

    stek.hp = 1; // nearly dead
    const gridCrit = calculatePowerGrid([stek], House.USSR, isAllied);
    expect(gridCrit.consumed).toBe(100); // still full drain
  });
});
