/**
 * C++ Behavioral Parity: DOME — Radar Dome
 *
 * Tests verify Radar Dome behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with a Radar Dome (observable
 * outcomes: stats, power drain, tech gate, radar enable, destruction blast),
 * not HOW the code implements it. The same scenarios should produce
 * identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, POWER_DRAIN, PRODUCTION_ITEMS,
  COUNTRY_BONUSES, buildDefaultAlliances, worldDist,
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
  calculatePowerGrid, sellRefund, repairCostPerStep,
} from '../engine/repairSell';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeDOME(cx: number, cy: number, hp = 1000, house: House = House.Spain): MapStructure {
  return {
    type: 'DOME', image: 'dome', house,
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
    powerProduced: 100,
  } as CombatContext;
}

// -- Stats (rules.ini / building.cpp) -----------------------------------------
//
// C++ rules.ini: DOME -> Strength=1000, Cost=1000, Power=40 (consumes 40W),
// Prerequisite=PROC, Owner=allies,soviet, TechLevel=3

describe('DOME stats (rules.ini parity)', () => {

  it('max HP is 1000', () => {
    expect(STRUCTURE_MAX_HP['DOME']).toBe(1000);
  });

  it('footprint is 2x2 cells', () => {
    expect(STRUCTURE_SIZE['DOME']).toEqual([2, 2]);
  });

  it('has no weapon (purely tech/radar building)', () => {
    expect(STRUCTURE_WEAPONS['DOME']).toBeUndefined();
  });

  it('consumes 40W power (POWER_DRAIN entry)', () => {
    expect(POWER_DRAIN['DOME']).toBe(40);
  });

  it('is available to both factions (rules.ini Owner=allies,soviet)', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'DOME');
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('both');
  });

  it('costs 1000 credits', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'DOME');
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(1000);
  });

  it('build time is 720 ticks (C++ cost-based: floor(1000 * 0.72))', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'DOME');
    expect(prodItem).toBeDefined();
    expect(prodItem!.buildTime).toBe(720);
  });

  it('prerequisite is PROC (Refinery)', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'DOME');
    expect(prodItem).toBeDefined();
    expect(prodItem!.prerequisite).toBe('PROC');
  });

  it('is a structure (isStructure flag)', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'DOME');
    expect(prodItem).toBeDefined();
    expect(prodItem!.isStructure).toBe(true);
  });

  it('tech level is 3', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'DOME');
    expect(prodItem).toBeDefined();
    expect(prodItem!.techLevel).toBe(3);
  });
});

// -- Tech Gate: DOME as prerequisite ------------------------------------------
//
// DOME unlocks multiple structures and units in the tech tree.
// C++ rules.ini: HPAD, AFLD, AGUN, SAM require DOME as prerequisite.
// ATEK, STEK, V2RL require DOME as techPrereq.

describe('DOME tech gate — prerequisite for advanced structures/units', () => {

  it('HPAD (Helipad) requires DOME as prerequisite', () => {
    const hpad = PRODUCTION_ITEMS.find(p => p.type === 'HPAD');
    expect(hpad).toBeDefined();
    expect(hpad!.prerequisite).toBe('DOME');
  });

  it('AFLD (Airfield) requires DOME as prerequisite', () => {
    const afld = PRODUCTION_ITEMS.find(p => p.type === 'AFLD');
    expect(afld).toBeDefined();
    expect(afld!.prerequisite).toBe('DOME');
  });

  it('AGUN (AA Gun) requires DOME as prerequisite', () => {
    const agun = PRODUCTION_ITEMS.find(p => p.type === 'AGUN');
    expect(agun).toBeDefined();
    expect(agun!.prerequisite).toBe('DOME');
  });

  it('SAM (SAM Site) requires DOME as prerequisite', () => {
    const sam = PRODUCTION_ITEMS.find(p => p.type === 'SAM');
    expect(sam).toBeDefined();
    expect(sam!.prerequisite).toBe('DOME');
  });

  it('ATEK (Allied Tech) requires DOME as techPrereq', () => {
    const atek = PRODUCTION_ITEMS.find(p => p.type === 'ATEK');
    expect(atek).toBeDefined();
    expect(atek!.techPrereq).toBe('DOME');
  });

  it('STEK (Soviet Tech) requires DOME as techPrereq', () => {
    const stek = PRODUCTION_ITEMS.find(p => p.type === 'STEK');
    expect(stek).toBeDefined();
    expect(stek!.techPrereq).toBe('DOME');
  });

  it('V2RL (V2 Rocket) requires DOME as techPrereq', () => {
    const v2rl = PRODUCTION_ITEMS.find(p => p.type === 'V2RL');
    expect(v2rl).toBeDefined();
    expect(v2rl!.techPrereq).toBe('DOME');
  });

  it('all structures requiring DOME as prerequisite are accounted for', () => {
    const domePrereqStructures = PRODUCTION_ITEMS.filter(
      p => p.prerequisite === 'DOME' && p.isStructure,
    );
    const types = domePrereqStructures.map(p => p.type).sort();
    expect(types).toEqual(['AFLD', 'AGUN', 'HPAD', 'SAM']);
  });

  it('all items requiring DOME as techPrereq are accounted for', () => {
    const domeTechPrereq = PRODUCTION_ITEMS.filter(p => p.techPrereq === 'DOME');
    const types = domeTechPrereq.map(p => p.type).sort();
    expect(types).toEqual(['ATEK', 'MRJ', 'SPY', 'STEK', 'V2RL']);
  });
});

// -- Power Consumption (DOME draws 40W from power grid) -----------------------
//
// C++ rules.ini: DOME Power=40 (positive = consumes).
// Unlike POWR/APWR which produce power, DOME is a consumer.

describe('DOME power consumption in grid (calculatePowerGrid)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('single DOME consumes 40W', () => {
    const dome = makeDOME(10, 10, 1000, House.Spain);
    const grid = calculatePowerGrid([dome], House.Spain, isAllied);
    expect(grid.consumed).toBe(40);
    expect(grid.produced).toBe(0);
  });

  it('two DOMEs consume 80W', () => {
    const d1 = makeDOME(10, 10, 1000, House.Spain);
    const d2 = makeDOME(14, 10, 1000, House.Spain);
    const grid = calculatePowerGrid([d1, d2], House.Spain, isAllied);
    expect(grid.consumed).toBe(80);
  });

  it('dead DOME does not consume power', () => {
    const dome = makeDOME(10, 10, 0, House.Spain);
    dome.alive = false;
    const grid = calculatePowerGrid([dome], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('selling DOME does not consume power', () => {
    const dome = makeDOME(10, 10, 1000, House.Spain);
    dome.sellProgress = 0.5;
    const grid = calculatePowerGrid([dome], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('enemy DOME does not affect player power grid', () => {
    const dome = makeDOME(10, 10, 1000, House.USSR);
    const grid = calculatePowerGrid([dome], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('damaged DOME still consumes full 40W (drain is not health-scaled)', () => {
    const dome = makeDOME(10, 10, 500, House.Spain);
    const grid = calculatePowerGrid([dome], House.Spain, isAllied);
    expect(grid.consumed).toBe(40);
  });

  it('DOME + POWR yields correct power balance (100 produced, 40 consumed)', () => {
    const powr = makeBuilding('POWR', 10, 10, 400, House.Spain);
    const dome = makeDOME(14, 10, 1000, House.Spain);
    const grid = calculatePowerGrid([powr, dome], House.Spain, isAllied);
    expect(grid.produced).toBe(100);
    expect(grid.consumed).toBe(40);
    expect(grid.produced - grid.consumed).toBe(60);
  });
});

// -- Economic Functions (repairSell.ts) ---------------------------------------
//
// C++ rules.ini: DOME Cost=1000, Strength=1000

describe('DOME economic functions (rules.ini Cost=1000)', () => {
  const DOME_COST = 1000;
  const DOME_MAX_HP = 1000;

  it('sell refund is 50% of build cost = 500', () => {
    expect(sellRefund(DOME_COST)).toBe(500);
  });

  it('repair cost per step: C++ fixed-point (64*5+128)/256 = 1', () => {
    // C++ fixed-point: stepsToFull=1000/5=200, costPerStep=1000/200=5, (64*5+128)/256=1
    expect(repairCostPerStep(DOME_COST, DOME_MAX_HP)).toBe(1);
  });
});

// -- 2x2 Footprint -----------------------------------------------------------
//
// C++ STRUCTURE_SIZE: DOME is 2x2. The origin cell is top-left;
// the structure occupies (cx,cy), (cx+1,cy), (cx,cy+1), (cx+1,cy+1).

describe('DOME 2x2 footprint', () => {

  it('footprint occupies 4 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['DOME']!;
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

  it('DOME size matches POWR size (both 2x2)', () => {
    expect(STRUCTURE_SIZE['DOME']).toEqual(STRUCTURE_SIZE['POWR']);
  });
});

// -- Destruction Blast — Radial HE (building.cpp) -----------------------------
//
// Non-barrel structures produce a visual-only FBALL1 death animation
// on destruction (C++ parity). No warhead damage is dealt to entities. This is NOT the barrel cardinal
// fire-bullet mechanic.

describe('DOME destruction blast -- visual-only (C++ parity: no entity damage)', () => {

  it('entities take NO damage on destruction (visual-only explosion)', () => {
    const dome = makeDOME(10, 10, 50);
    dome.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([dome], [victim]);
    structureDamage(ctx, dome, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('diagonal entities take NO damage on destruction (visual-only explosion)', () => {
    const dome = makeDOME(10, 10, 50);
    dome.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const bx = 10 * CELL_SIZE + CELL_SIZE;
    const by = 10 * CELL_SIZE + CELL_SIZE;
    const dist = worldDist({ x: bx, y: by }, victim.pos);
    expect(dist).toBeLessThan(2);
    const ctx = makeCombatCtx([dome], [victim]);
    structureDamage(ctx, dome, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('no entity damage at any distance (visual-only explosion)', () => {
    const dome = makeDOME(10, 10, 50);
    dome.house = House.USSR;
    const close = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const far = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 12);
    const ctx = makeCombatCtx([dome], [close, far]);
    structureDamage(ctx, dome, 100);
    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    expect(closeDmg).toBe(0);
    expect(farDmg).toBe(0);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const dome = makeDOME(10, 10, 50);
    dome.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 13, 10); // 3 cells E
    const ctx = makeCombatCtx([dome], [victim]);
    structureDamage(ctx, dome, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('destruction blast damages adjacent structures', () => {
    const dome = makeDOME(10, 10, 50);
    dome.house = House.USSR;
    const nearby = makeBuilding('SILO', 12, 10, 256);
    const ctx = makeCombatCtx([dome, nearby]);
    structureDamage(ctx, dome, 100);
    expect(nearby.hp).toBeLessThan(256);
  });

  it('no barrel cardinal mechanic AND no radial entity damage (visual-only)', () => {
    // Barrel explosions hit ONLY cardinal cells with flat 200 damage.
    // DOME should use radial HE with falloff instead — diagonals should
    // take damage (unlike barrels where diagonals are immune).
    const dome = makeDOME(10, 10, 50);
    dome.house = House.USSR;
    const diagonal = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([dome], [diagonal]);
    structureDamage(ctx, dome, 100);
    // C++ parity: visual-only explosion, no entity damage
    expect(diagonal.hp).toBe(diagonal.maxHp);
  });
});

// -- DOME survives significant damage (HP=1000 is high) -----------------------
//
// DOME has 1000 HP — one of the toughest non-FACT structures. This means it
// takes sustained effort to destroy, protecting the tech tree.

describe('DOME durability (Strength=1000)', () => {

  it('survives 999 points of damage', () => {
    const dome = makeDOME(10, 10, 1000, House.USSR);
    const ctx = makeCombatCtx([dome]);
    structureDamage(ctx, dome, 999);
    expect(dome.alive).toBe(true);
    expect(dome.hp).toBe(1);
  });

  it('is destroyed by 1000+ damage', () => {
    const dome = makeDOME(10, 10, 1000, House.USSR);
    const ctx = makeCombatCtx([dome]);
    structureDamage(ctx, dome, 1000);
    expect(dome.alive).toBe(false);
    expect(dome.hp).toBe(0);
  });

  it('incremental damage accumulates correctly', () => {
    const dome = makeDOME(10, 10, 1000, House.USSR);
    const ctx = makeCombatCtx([dome]);
    // Apply 10 hits of 50 damage = 500 total
    for (let i = 0; i < 10; i++) {
      structureDamage(ctx, dome, 50);
    }
    expect(dome.alive).toBe(true);
    expect(dome.hp).toBe(500);
  });

  it('HP does not go below 0', () => {
    const dome = makeDOME(10, 10, 100, House.USSR);
    const ctx = makeCombatCtx([dome]);
    structureDamage(ctx, dome, 9999);
    expect(dome.hp).toBe(0);
  });
});

// -- DOME is not a power producer ---------------------------------------------
//
// Unlike POWR/APWR, DOME does not produce any power. It only consumes.

describe('DOME produces no power (not POWR/APWR)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('DOME alone produces 0W', () => {
    const dome = makeDOME(10, 10, 1000, House.Spain);
    const grid = calculatePowerGrid([dome], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
  });

  it('damaged DOME produces 0W (health ratio irrelevant for non-producers)', () => {
    const dome = makeDOME(10, 10, 500, House.Spain);
    const grid = calculatePowerGrid([dome], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
  });
});
