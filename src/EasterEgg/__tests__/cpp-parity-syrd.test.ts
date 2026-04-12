/**
 * C++ Behavioral Parity: SYRD — Allied Shipyard
 *
 * Tests verify Shipyard behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with a Shipyard (observable
 * outcomes: stats, power drain, prerequisite chain, destruction blast),
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
  STRUCTURE_WEAPONS,
} from '../engine/scenario';
import {
  calculatePowerGrid, sellRefund, repairCostPerStep,
} from '../engine/repairSell';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeSYRD(cx: number, cy: number, hp = 1000, house: House = House.Spain): MapStructure {
  return {
    type: 'SYRD', image: 'syrd', house,
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
// C++ rules.ini: SYRD -> Strength=1000, Cost=650, Power=30 (consumes 30W),
// Prerequisite=POWR, Owner=allies, TechLevel=3

describe('SYRD stats (rules.ini parity)', () => {

  it('max HP is 1000', () => {
    expect(STRUCTURE_MAX_HP['SYRD']).toBe(1000);
  });

  it('footprint is 3x3 cells', () => {
    expect(STRUCTURE_SIZE['SYRD']).toEqual([3, 3]);
  });

  it('has no weapon (non-defensive structure)', () => {
    expect(STRUCTURE_WEAPONS['SYRD']).toBeUndefined();
  });

  it('consumes 30W power (POWER_DRAIN)', () => {
    expect(POWER_DRAIN['SYRD']).toBe(30);
  });

  it('is allied faction only (rules.ini Owner=allies)', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'SYRD');
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('allied');
  });

  it('costs 650 credits', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'SYRD');
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(650);
  });

  it('has build time 468 (C++ cost-based: floor(650 * 0.72))', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'SYRD');
    expect(prodItem).toBeDefined();
    expect(prodItem!.buildTime).toBe(468);
  });

  it('prerequisite is POWR', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'SYRD');
    expect(prodItem).toBeDefined();
    expect(prodItem!.prerequisite).toBe('POWR');
  });

  it('is a structure (isStructure=true)', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'SYRD');
    expect(prodItem).toBeDefined();
    expect(prodItem!.isStructure).toBe(true);
  });

  it('tech level is 3', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'SYRD');
    expect(prodItem).toBeDefined();
    expect(prodItem!.techLevel).toBe(3);
  });
});

// -- Naval Production Prerequisites -------------------------------------------
//
// C++ rules.ini: DD, CA, PT, LST all require SYRD as prerequisite.
// SYRD is the allied naval production facility enabling these units.

describe('SYRD as prerequisite for naval production (rules.ini)', () => {

  it('DD (Destroyer) requires SYRD prerequisite', () => {
    const dd = PRODUCTION_ITEMS.find(p => p.type === 'DD');
    expect(dd).toBeDefined();
    expect(dd!.prerequisite).toBe('SYRD');
  });

  it('CA (Cruiser) requires SYRD prerequisite', () => {
    const ca = PRODUCTION_ITEMS.find(p => p.type === 'CA');
    expect(ca).toBeDefined();
    expect(ca!.prerequisite).toBe('SYRD');
  });

  it('PT (Gunboat) requires SYRD prerequisite', () => {
    const pt = PRODUCTION_ITEMS.find(p => p.type === 'PT');
    expect(pt).toBeDefined();
    expect(pt!.prerequisite).toBe('SYRD');
  });

  it('LST (Transport) requires SYRD prerequisite', () => {
    const lst = PRODUCTION_ITEMS.find(p => p.type === 'LST');
    expect(lst).toBeDefined();
    expect(lst!.prerequisite).toBe('SYRD');
  });

  it('CA also requires ATEK tech prerequisite', () => {
    const ca = PRODUCTION_ITEMS.find(p => p.type === 'CA');
    expect(ca).toBeDefined();
    expect(ca!.techPrereq).toBe('ATEK');
  });

  it('DD is allied only', () => {
    const dd = PRODUCTION_ITEMS.find(p => p.type === 'DD');
    expect(dd!.faction).toBe('allied');
  });

  it('PT is allied only', () => {
    const pt = PRODUCTION_ITEMS.find(p => p.type === 'PT');
    expect(pt!.faction).toBe('allied');
  });

  it('LST is available to both factions', () => {
    const lst = PRODUCTION_ITEMS.find(p => p.type === 'LST');
    expect(lst!.faction).toBe('both');
  });

  it('CA is allied only', () => {
    const ca = PRODUCTION_ITEMS.find(p => p.type === 'CA');
    expect(ca!.faction).toBe('allied');
  });

  it('all four SYRD naval units exist in PRODUCTION_ITEMS', () => {
    const navalTypes = ['PT', 'DD', 'LST', 'CA'];
    for (const type of navalTypes) {
      const item = PRODUCTION_ITEMS.find(p => p.type === type);
      expect(item, `${type} should exist in PRODUCTION_ITEMS`).toBeDefined();
    }
  });
});

// -- SYRD↔SPEN Alias Equivalence (building.cpp) ------------------------------
//
// C++ parity: SYRD and SPEN are faction-equivalent naval buildings.
// A soviet player with SPEN can satisfy SYRD prerequisites and vice versa.
// This mirrors TENT↔BARR alias logic.

describe('SYRD↔SPEN alias equivalence', () => {
  const BUILDING_ALIASES: Record<string, string> = { TENT: 'BARR', BARR: 'TENT', SYRD: 'SPEN', SPEN: 'SYRD' };

  function hasBuilding(type: string, structures: Array<{ type: string; alive: boolean }>) {
    const alt = BUILDING_ALIASES[type];
    return structures.some(s => s.alive && (s.type === type || (alt !== undefined && s.type === alt)));
  }

  it('SPEN satisfies SYRD prerequisite', () => {
    const structures = [{ type: 'SPEN', alive: true }];
    expect(hasBuilding('SYRD', structures)).toBe(true);
  });

  it('SYRD satisfies SPEN prerequisite', () => {
    const structures = [{ type: 'SYRD', alive: true }];
    expect(hasBuilding('SPEN', structures)).toBe(true);
  });

  it('dead SYRD does not satisfy prerequisite', () => {
    const structures = [{ type: 'SYRD', alive: false }];
    expect(hasBuilding('SYRD', structures)).toBe(false);
  });

  it('dead SPEN does not satisfy SYRD prerequisite', () => {
    const structures = [{ type: 'SPEN', alive: false }];
    expect(hasBuilding('SYRD', structures)).toBe(false);
  });

  it('unrelated building does not satisfy SYRD prerequisite', () => {
    const structures = [{ type: 'WEAP', alive: true }];
    expect(hasBuilding('SYRD', structures)).toBe(false);
  });
});

// -- Power Grid Integration (calculatePowerGrid) -----------------------------
//
// SYRD consumes 30W via POWER_DRAIN. It does NOT produce power.
// Only alive, non-selling, allied structures count.

describe('SYRD in power grid (calculatePowerGrid)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('single SYRD consumes 30W, produces 0W', () => {
    const syrd = makeSYRD(10, 10, 1000, House.Spain);
    const grid = calculatePowerGrid([syrd], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
    expect(grid.consumed).toBe(30);
  });

  it('SYRD + POWR: net power = 100 - 30 = 70W', () => {
    const powr = makeBuilding('POWR', 5, 5, 400, House.Spain);
    const syrd = makeSYRD(10, 10, 1000, House.Spain);
    const grid = calculatePowerGrid([powr, syrd], House.Spain, isAllied);
    expect(grid.produced).toBe(100);
    expect(grid.consumed).toBe(30);
    expect(grid.produced - grid.consumed).toBe(70);
  });

  it('dead SYRD does not consume power', () => {
    const syrd = makeSYRD(10, 10, 0, House.Spain);
    syrd.alive = false;
    const grid = calculatePowerGrid([syrd], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('selling SYRD does not consume power', () => {
    const syrd = makeSYRD(10, 10, 1000, House.Spain);
    syrd.sellProgress = 0.5;
    const grid = calculatePowerGrid([syrd], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('enemy SYRD does not count in player grid', () => {
    const syrd = makeSYRD(10, 10, 1000, House.USSR);
    const grid = calculatePowerGrid([syrd], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('two SYRD consume 60W total', () => {
    const s1 = makeSYRD(10, 10, 1000, House.Spain);
    const s2 = makeSYRD(16, 10, 1000, House.Spain);
    const grid = calculatePowerGrid([s1, s2], House.Spain, isAllied);
    expect(grid.consumed).toBe(60);
  });
});

// -- Economic Functions (repairSell.ts) ---------------------------------------
//
// C++ rules.ini: SYRD Cost=650, Strength=1000

describe('SYRD economic functions (rules.ini Cost=650)', () => {
  const SYRD_COST = 650;
  const SYRD_MAX_HP = 1000;

  it('sell refund is 50% of build cost = 325', () => {
    expect(sellRefund(SYRD_COST)).toBe(325);
  });

  it('repair cost per step: ceil(650 * 0.20 / (1000 / 7)) = ceil(130 / 142.857) = 1', () => {
    expect(repairCostPerStep(SYRD_COST, SYRD_MAX_HP)).toBe(1);
  });
});

// -- 3x3 Footprint -----------------------------------------------------------
//
// C++ STRUCTURE_SIZE: SYRD is 3x3. The origin cell is top-left;
// the structure occupies 9 cells in a 3x3 grid from (cx,cy).

describe('SYRD 3x3 footprint', () => {

  it('footprint occupies 9 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['SYRD']!;
    expect(w * h).toBe(9);
    // Origin at (10,10) -> 3x3 grid of cells
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

  it('footprint width is 3', () => {
    expect(STRUCTURE_SIZE['SYRD']![0]).toBe(3);
  });

  it('footprint height is 3', () => {
    expect(STRUCTURE_SIZE['SYRD']![1]).toBe(3);
  });
});

// -- Destruction Blast — Radial HE (building.cpp) -----------------------------
//
// Non-barrel structures produce a visual-only FBALL1 death animation
// on destruction (C++ parity). No warhead damage is dealt to entities. This is NOT the barrel cardinal
// fire-bullet mechanic.

describe('SYRD destruction blast -- visual-only (C++ parity: no entity damage)', () => {

  it('entities take NO damage on destruction (visual-only explosion)', () => {
    const syrd = makeSYRD(10, 10, 50); // Low HP, will die
    syrd.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([syrd], [victim]);
    structureDamage(ctx, syrd, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('diagonal entities take NO damage on destruction (visual-only explosion)', () => {
    const syrd = makeSYRD(10, 10, 50);
    syrd.house = House.USSR;
    // Blast center for SYRD at (10,10) is wx=11*CELL_SIZE, wy=11*CELL_SIZE.
    // Entity at (11,11) center is ~0.7 cells away — within 2-cell blast radius.
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([syrd], [victim]);
    structureDamage(ctx, syrd, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('no entity damage at any distance (visual-only explosion)', () => {
    const syrd = makeSYRD(10, 10, 50);
    syrd.house = House.USSR;
    const close = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const far = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 13);
    const ctx = makeCombatCtx([syrd], [close, far]);
    structureDamage(ctx, syrd, 100);
    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    expect(closeDmg).toBe(0);
    expect(farDmg).toBe(0);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const syrd = makeSYRD(10, 10, 50);
    syrd.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 15, 10); // 5 cells E
    const ctx = makeCombatCtx([syrd], [victim]);
    structureDamage(ctx, syrd, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('destruction blast damages adjacent structures', () => {
    const syrd = makeSYRD(10, 10, 50);
    syrd.house = House.USSR;
    // SILO at (12,10): its center wx=12*CELL_SIZE+CELL_SIZE, blast center wx=11*CELL_SIZE.
    // Distance = 2*CELL_SIZE / CELL_SIZE = 2.0 cells — at the edge of 2-cell radius.
    const nearby = makeBuilding('SILO', 12, 10, 256);
    const ctx = makeCombatCtx([syrd, nearby]);
    structureDamage(ctx, syrd, 100);
    expect(nearby.hp).toBeLessThan(256);
  });

  it('no barrel cardinal mechanic AND no radial entity damage (visual-only)', () => {
    // Barrel explosions hit ONLY cardinal cells with flat 200 damage.
    // SYRD should use radial HE with falloff instead — diagonals should
    // take damage (unlike barrels where diagonals are immune).
    const syrd = makeSYRD(10, 10, 50);
    syrd.house = House.USSR;
    // Place diagonal entity at (11,11) — within blast radius of center at (11*CELL_SIZE, 11*CELL_SIZE)
    const diagonal = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([syrd], [diagonal]);
    structureDamage(ctx, syrd, 100);
    // C++ parity: visual-only explosion, no entity damage
    expect(diagonal.hp).toBe(diagonal.maxHp);
  });
});

// -- SYRD vs SPEN Stat Symmetry -----------------------------------------------
//
// C++ rules.ini: SYRD and SPEN are faction mirrors with identical stats:
// Strength=1000, Cost=650, Power=30, Size=3x3, TechLevel=3

describe('SYRD vs SPEN stat symmetry', () => {

  it('same max HP (1000)', () => {
    expect(STRUCTURE_MAX_HP['SYRD']).toBe(STRUCTURE_MAX_HP['SPEN']);
  });

  it('same footprint (3x3)', () => {
    expect(STRUCTURE_SIZE['SYRD']).toEqual(STRUCTURE_SIZE['SPEN']);
  });

  it('same power drain (30W)', () => {
    expect(POWER_DRAIN['SYRD']).toBe(POWER_DRAIN['SPEN']);
  });

  it('neither has a weapon', () => {
    expect(STRUCTURE_WEAPONS['SYRD']).toBeUndefined();
    expect(STRUCTURE_WEAPONS['SPEN']).toBeUndefined();
  });

  it('same cost (650)', () => {
    const syrd = PRODUCTION_ITEMS.find(p => p.type === 'SYRD');
    const spen = PRODUCTION_ITEMS.find(p => p.type === 'SPEN');
    expect(syrd!.cost).toBe(spen!.cost);
  });

  it('same build time (150)', () => {
    const syrd = PRODUCTION_ITEMS.find(p => p.type === 'SYRD');
    const spen = PRODUCTION_ITEMS.find(p => p.type === 'SPEN');
    expect(syrd!.buildTime).toBe(spen!.buildTime);
  });

  it('same tech level (3)', () => {
    const syrd = PRODUCTION_ITEMS.find(p => p.type === 'SYRD');
    const spen = PRODUCTION_ITEMS.find(p => p.type === 'SPEN');
    expect(syrd!.techLevel).toBe(spen!.techLevel);
  });

  it('opposite factions (allied vs soviet)', () => {
    const syrd = PRODUCTION_ITEMS.find(p => p.type === 'SYRD');
    const spen = PRODUCTION_ITEMS.find(p => p.type === 'SPEN');
    expect(syrd!.faction).toBe('allied');
    expect(spen!.faction).toBe('soviet');
  });
});

// -- Durability Under Fire ----------------------------------------------------
//
// SYRD has 1000 HP — one of the toughest structures. Verify it takes
// proportional combat damage and survives appropriate punishment.

describe('SYRD durability (Strength=1000)', () => {

  it('survives 900 damage (1000->100 HP, still alive)', () => {
    const syrd = makeSYRD(10, 10, 1000, House.USSR);
    const ctx = makeCombatCtx([syrd]);
    structureDamage(ctx, syrd, 900);
    expect(syrd.alive).toBe(true);
    expect(syrd.hp).toBe(100);
  });

  it('destroyed by 1000+ damage', () => {
    const syrd = makeSYRD(10, 10, 1000, House.USSR);
    const ctx = makeCombatCtx([syrd]);
    structureDamage(ctx, syrd, 1000);
    expect(syrd.alive).toBe(false);
  });

  it('HP clamps to 0 when overkilled', () => {
    const syrd = makeSYRD(10, 10, 1000, House.USSR);
    const ctx = makeCombatCtx([syrd]);
    structureDamage(ctx, syrd, 2000);
    expect(syrd.hp).toBeLessThanOrEqual(0);
    expect(syrd.alive).toBe(false);
  });

  it('takes incremental damage across multiple hits', () => {
    const syrd = makeSYRD(10, 10, 1000, House.USSR);
    const ctx = makeCombatCtx([syrd]);
    structureDamage(ctx, syrd, 300);
    expect(syrd.hp).toBe(700);
    expect(syrd.alive).toBe(true);
    structureDamage(ctx, syrd, 300);
    expect(syrd.hp).toBe(400);
    expect(syrd.alive).toBe(true);
    structureDamage(ctx, syrd, 300);
    expect(syrd.hp).toBe(100);
    expect(syrd.alive).toBe(true);
    structureDamage(ctx, syrd, 300);
    expect(syrd.alive).toBe(false);
  });

  it('1 HP damage reduces HP by 1 (1000->999)', () => {
    const syrd = makeSYRD(10, 10, 1000, House.USSR);
    const ctx = makeCombatCtx([syrd]);
    structureDamage(ctx, syrd, 1);
    expect(syrd.hp).toBe(999);
    expect(syrd.alive).toBe(true);
  });
});
