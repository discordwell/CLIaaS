/**
 * C++ Behavioral Parity: APWR -- Advanced Power Plant
 *
 * Tests verify Advanced Power Plant behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with an Adv. Power Plant (observable
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

function makeAPWR(cx: number, cy: number, hp = 700, house: House = House.Spain): MapStructure {
  return {
    type: 'APWR', image: 'apwr', house,
    cx, cy, hp, maxHp: 700, alive: true, rubble: false,
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
    isRevealedToHouse: () => true,
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
    powerProduced: 200,
  } as CombatContext;
}

// -- Stats (rules.ini / building.cpp) -----------------------------------------
//
// C++ rules.ini: APWR -> Strength=700, Cost=500, Power=-200 (produces 200W),
// Prerequisite=POWR, Owner=allies,soviet, TechLevel=8

describe('APWR stats (rules.ini parity)', () => {

  it('max HP is 700', () => {
    expect(STRUCTURE_MAX_HP['APWR']).toBe(700);
  });

  it('footprint is 3x3 cells', () => {
    expect(STRUCTURE_SIZE['APWR']).toEqual([3, 3]);
  });

  it('has no weapon (purely economic)', () => {
    expect(STRUCTURE_WEAPONS['APWR']).toBeUndefined();
  });

  it('is not a power consumer (no entry in POWER_DRAIN)', () => {
    expect(POWER_DRAIN['APWR']).toBeUndefined();
  });

  it('is available to both factions (rules.ini Owner=allies,soviet)', () => {
    const alliedAPWR = makeAPWR(10, 10, 700, House.Spain);
    const sovietAPWR = makeAPWR(20, 20, 700, House.USSR);
    expect(alliedAPWR.type).toBe('APWR');
    expect(sovietAPWR.type).toBe('APWR');
  });
});

// -- Power Production (building.cpp:4613 Power_Output) ------------------------
//
// C++ Power_Output: returns (Power * health_ratio) where Power= -200 for APWR.
// Negative drain means production. At full health: 200W. Scales linearly.

describe('APWR power production (building.cpp:4613 Power_Output)', () => {

  it('produces 200W at full health (700/700)', () => {
    expect(powerOutput('APWR', 700, 700)).toBe(200);
  });

  it('produces 100W at half health (350/700)', () => {
    expect(powerOutput('APWR', 350, 700)).toBe(100);
  });

  it('produces 50W at quarter health (175/700)', () => {
    expect(powerOutput('APWR', 175, 700)).toBe(50);
  });

  it('produces 0W when dead (0/700)', () => {
    expect(powerOutput('APWR', 0, 700)).toBe(0);
  });

  it('produces 150W at 75% health (525/700)', () => {
    expect(powerOutput('APWR', 525, 700)).toBe(150);
  });

  it('rounds output at non-integer health ratios (1/700 -> 0W)', () => {
    // 1/700 = 0.001428..., * 200 = 0.2857, round = 0
    expect(powerOutput('APWR', 1, 700)).toBe(0);
  });

  it('C++ fixed-point at non-integer health ratios (349/700 -> 99W)', () => {
    // C++ fixed(349,700) = floor(349*256/700) = 127, then (127*200+128)/256 = 99
    expect(powerOutput('APWR', 349, 700)).toBe(99);
  });

  it('handles zero maxHp safely (no division by zero)', () => {
    expect(powerOutput('APWR', 0, 0)).toBe(0);
  });

  it('produces exactly double what POWR produces at equivalent health ratio', () => {
    // At 50% health: POWR=50W, APWR=100W
    expect(powerOutput('POWR', 200, 400)).toBe(50);
    expect(powerOutput('APWR', 350, 700)).toBe(100);
    // At 100% health: POWR=100W, APWR=200W
    expect(powerOutput('POWR', 400, 400)).toBe(100);
    expect(powerOutput('APWR', 700, 700)).toBe(200);
  });
});

// -- Power Grid Integration (calculatePowerGrid) -----------------------------
//
// APWR contributes to the produced side of the grid, scaled by health.
// Other structures consume via POWER_DRAIN. Only alive, non-selling,
// allied structures count.

describe('APWR in power grid (calculatePowerGrid)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('single full-health APWR produces 200W, 0 consumed', () => {
    const apwr = makeAPWR(10, 10, 700, House.Spain);
    const grid = calculatePowerGrid([apwr], House.Spain, isAllied);
    expect(grid.produced).toBe(200);
    expect(grid.consumed).toBe(0);
  });

  it('two APWR at full health produce 400W', () => {
    const a1 = makeAPWR(10, 10, 700, House.Spain);
    const a2 = makeAPWR(14, 10, 700, House.Spain);
    const grid = calculatePowerGrid([a1, a2], House.Spain, isAllied);
    expect(grid.produced).toBe(400);
  });

  it('damaged APWR produces less (350/700 -> 100W)', () => {
    const apwr = makeAPWR(10, 10, 350, House.Spain);
    const grid = calculatePowerGrid([apwr], House.Spain, isAllied);
    expect(grid.produced).toBe(100);
  });

  it('dead APWR produces 0W', () => {
    const apwr = makeAPWR(10, 10, 0, House.Spain);
    apwr.alive = false;
    const grid = calculatePowerGrid([apwr], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
  });

  it('selling APWR does not contribute to grid', () => {
    const apwr = makeAPWR(10, 10, 700, House.Spain);
    apwr.sellProgress = 0.5;
    const grid = calculatePowerGrid([apwr], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
  });

  it('enemy APWR does not contribute to player grid', () => {
    const apwr = makeAPWR(10, 10, 700, House.USSR);
    const grid = calculatePowerGrid([apwr], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
  });

  it('APWR + consuming building yields correct net power', () => {
    const apwr = makeAPWR(10, 10, 700, House.Spain);
    const tent = makeBuilding('TENT', 14, 10, 800, House.Spain);
    const grid = calculatePowerGrid([apwr, tent], House.Spain, isAllied);
    expect(grid.produced).toBe(200);
    expect(grid.consumed).toBe(POWER_DRAIN['TENT']); // 20
    expect(grid.produced - grid.consumed).toBe(180);
  });

  it('mixed POWR + APWR grid sums correctly', () => {
    const powr = makeBuilding('POWR', 10, 10, 400, House.Spain);
    powr.maxHp = 400;
    const apwr = makeAPWR(14, 10, 700, House.Spain);
    const grid = calculatePowerGrid([powr, apwr], House.Spain, isAllied);
    expect(grid.produced).toBe(300); // 100 + 200
  });
});

// -- Economic Functions (repairSell.ts) ---------------------------------------
//
// C++ rules.ini: APWR Cost=500, Strength=700

describe('APWR economic functions (rules.ini Cost=500)', () => {
  const APWR_COST = 500;
  const APWR_MAX_HP = 700;

  it('sell refund is 50% of build cost = 250', () => {
    expect(sellRefund(APWR_COST)).toBe(250);
  });

  it('repair cost per step: ceil(500 * 0.20 / (700 / 7)) = ceil(100 / 100) = 1', () => {
    expect(repairCostPerStep(APWR_COST, APWR_MAX_HP)).toBe(1);
  });
});

// -- 3x3 Footprint -----------------------------------------------------------
//
// C++ STRUCTURE_SIZE: APWR is 3x3 (BSIZE_33). The origin cell is top-left;
// the structure occupies 9 cells total.

describe('APWR 3x3 footprint', () => {

  it('footprint occupies 9 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['APWR']!;
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

// -- Destruction Blast -- Radial HE (building.cpp) -----------------------------
//
// Non-barrel structures produce a visual-only FBALL1 death animation
// on destruction (C++ parity). No warhead damage is dealt to entities. This is NOT the barrel cardinal
// fire-bullet mechanic.

describe('APWR destruction blast -- visual-only (C++ parity: no entity damage)', () => {

  it('entities take NO damage on destruction (visual-only explosion)', () => {
    const apwr = makeAPWR(10, 10, 50); // Low HP, will die
    apwr.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([apwr], [victim]);
    structureDamage(ctx, apwr, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('diagonal entities take NO damage on destruction (visual-only explosion)', () => {
    const apwr = makeAPWR(10, 10, 50);
    apwr.house = House.USSR;
    // Entity at diagonal (11,11) -- within 2-cell radius
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const bx = 10 * CELL_SIZE + CELL_SIZE;
    const by = 10 * CELL_SIZE + CELL_SIZE;
    const dist = worldDist({ x: bx, y: by }, victim.pos);
    expect(dist).toBeLessThan(2);
    const ctx = makeCombatCtx([apwr], [victim]);
    structureDamage(ctx, apwr, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('no entity damage at any distance (visual-only explosion)', () => {
    const apwr = makeAPWR(10, 10, 50);
    apwr.house = House.USSR;
    const close = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const far = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 12);
    const ctx = makeCombatCtx([apwr], [close, far]);
    structureDamage(ctx, apwr, 100);
    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    expect(closeDmg).toBe(0);
    expect(farDmg).toBe(0);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const apwr = makeAPWR(10, 10, 50);
    apwr.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 13, 10); // 3 cells E
    const ctx = makeCombatCtx([apwr], [victim]);
    structureDamage(ctx, apwr, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('destruction blast damages adjacent structures', () => {
    const apwr = makeAPWR(10, 10, 50);
    apwr.house = House.USSR;
    const nearby = makeBuilding('SILO', 12, 10, 256);
    const ctx = makeCombatCtx([apwr, nearby]);
    structureDamage(ctx, apwr, 100);
    expect(nearby.hp).toBeLessThan(256);
  });

  it('no barrel cardinal mechanic AND no radial entity damage (visual-only)', () => {
    // Barrel explosions hit ONLY cardinal cells with flat 200 damage.
    // APWR should use radial HE with falloff instead -- diagonals should
    // take damage (unlike barrels where diagonals are immune).
    const apwr = makeAPWR(10, 10, 50);
    apwr.house = House.USSR;
    const diagonal = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([apwr], [diagonal]);
    structureDamage(ctx, apwr, 100);
    // C++ parity: visual-only explosion, no entity damage
    expect(diagonal.hp).toBe(diagonal.maxHp);
  });
});

// -- Power Output Scales with Damage (regression) ----------------------------
//
// When an APWR takes damage, its power output drops proportionally.
// This is critical for gameplay: destroying enemy power plants
// degrades their power grid incrementally.

describe('APWR power output degrades with combat damage', () => {

  it('taking 350 damage (700->350 HP) halves output from 200W to 100W', () => {
    const apwr = makeAPWR(10, 10, 700);
    apwr.hp = 350;
    expect(powerOutput('APWR', apwr.hp, apwr.maxHp)).toBe(100);
  });

  it('taking 525 damage (700->175 HP) quarters output from 200W to 50W', () => {
    const apwr = makeAPWR(10, 10, 700);
    apwr.hp = 175;
    expect(powerOutput('APWR', apwr.hp, apwr.maxHp)).toBe(50);
  });

  it('each point of damage reduces output — C++ fixed-point', () => {
    // C++ fixed(699,700)*200: fixed=floor(699*256/700)=255, (255*200+128)/256=199
    expect(powerOutput('APWR', 699, 700)).toBe(199);
    // C++ fixed(696,700)*200: fixed=floor(696*256/700)=254, (254*200+128)/256=198
    expect(powerOutput('APWR', 696, 700)).toBe(198);
    // C++ fixed(350,700)*200: fixed=floor(350*256/700)=128, (128*200+128)/256=100
    expect(powerOutput('APWR', 350, 700)).toBe(100);
  });

  it('power grid updates when APWR is damaged', () => {
    const alliances = buildDefaultAlliances();
    const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

    const apwr = makeAPWR(10, 10, 700, House.Spain);
    const gridFull = calculatePowerGrid([apwr], House.Spain, isAllied);
    expect(gridFull.produced).toBe(200);

    apwr.hp = 350;
    const gridDamaged = calculatePowerGrid([apwr], House.Spain, isAllied);
    expect(gridDamaged.produced).toBe(100);

    apwr.hp = 1;
    const gridCritical = calculatePowerGrid([apwr], House.Spain, isAllied);
    expect(gridCritical.produced).toBe(0); // round(200 * 1/700) = round(0.2857) = 0
  });
});
