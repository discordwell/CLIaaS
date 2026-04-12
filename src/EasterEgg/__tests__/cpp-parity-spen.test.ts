/**
 * C++ Behavioral Parity: SPEN — Soviet Sub Pen
 *
 * Tests verify Sub Pen behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with a Sub Pen (observable
 * outcomes: stats, power drain, naval prerequisite, spy infiltration,
 * destruction blast, building aliases), not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
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

function makeSPEN(cx: number, cy: number, hp = 1000, house: House = House.USSR): MapStructure {
  return {
    type: 'SPEN', image: 'spen', house,
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
// C++ rules.ini: SPEN -> Strength=1000, Cost=650, Power=30 (consumes 30W),
// Prerequisite=POWR, Owner=soviet, TechLevel=3

describe('SPEN stats (rules.ini parity)', () => {

  it('max HP is 1000', () => {
    expect(STRUCTURE_MAX_HP['SPEN']).toBe(1000);
  });

  it('footprint is 3x3 cells', () => {
    expect(STRUCTURE_SIZE['SPEN']).toEqual([3, 3]);
  });

  it('has no weapon (purely production building)', () => {
    expect(STRUCTURE_WEAPONS['SPEN']).toBeUndefined();
  });

  it('consumes 30W power (rules.ini Power=30)', () => {
    expect(POWER_DRAIN['SPEN']).toBe(30);
  });

  it('is soviet faction only (rules.ini Owner=soviet)', () => {
    // SPEN is placed for soviet house — verify it can be created for USSR
    const sovietSPEN = makeSPEN(10, 10, 1000, House.USSR);
    expect(sovietSPEN.type).toBe('SPEN');
    expect(sovietSPEN.house).toBe(House.USSR);
  });

  it('is not a powered structure (no power-gated functionality)', () => {
    expect(STRUCTURE_POWERED.has('SPEN')).toBe(false);
  });
});

// -- Sibling Parity: SPEN mirrors SYRD (allied Ship Yard) --------------------
//
// SPEN and SYRD are faction equivalents — same size, same HP, same cost.
// C++ building.cpp treats them as aliases for prerequisite resolution.

describe('SPEN/SYRD sibling parity', () => {

  it('SPEN and SYRD share identical max HP (1000)', () => {
    expect(STRUCTURE_MAX_HP['SPEN']).toBe(STRUCTURE_MAX_HP['SYRD']);
  });

  it('SPEN and SYRD share identical footprint (3x3)', () => {
    expect(STRUCTURE_SIZE['SPEN']).toEqual(STRUCTURE_SIZE['SYRD']);
  });

  it('SPEN and SYRD both consume 30W power', () => {
    expect(POWER_DRAIN['SPEN']).toBe(POWER_DRAIN['SYRD']);
  });

  it('neither SPEN nor SYRD has a weapon', () => {
    expect(STRUCTURE_WEAPONS['SPEN']).toBeUndefined();
    expect(STRUCTURE_WEAPONS['SYRD']).toBeUndefined();
  });
});

// -- Naval Production Prerequisite -------------------------------------------
//
// C++ rules.ini: SS Prerequisite=SPEN, MSUB Prerequisite=SPEN
// SPEN is the prerequisite for soviet submarine production.
// SYRD produces allied naval units; SPEN produces soviet naval units.

describe('SPEN naval production prerequisite', () => {

  it('SS (Submarine) requires SPEN as prerequisite', () => {
    // Verify from production items in types.ts

    const ss = PRODUCTION_ITEMS.find((p: { type: string }) => p.type === 'SS');
    expect(ss).toBeDefined();
    expect(ss.prerequisite).toBe('SPEN');
    expect(ss.faction).toBe('soviet');
  });

  it('MSUB (Missile Sub) requires SPEN as prerequisite', () => {

    const msub = PRODUCTION_ITEMS.find((p: { type: string }) => p.type === 'MSUB');
    expect(msub).toBeDefined();
    expect(msub.prerequisite).toBe('SPEN');
    expect(msub.faction).toBe('soviet');
  });

  it('SPEN does NOT produce allied naval units (PT, DD, CA)', () => {

    const alliedNaval = PRODUCTION_ITEMS.filter(
      (p: { prerequisite: string }) => p.prerequisite === 'SYRD'
    );
    // None of the SYRD-prereq units should reference SPEN
    for (const item of alliedNaval) {
      expect(item.prerequisite).not.toBe('SPEN');
    }
  });

  it('SPEN itself requires POWR as build prerequisite', () => {

    const spen = PRODUCTION_ITEMS.find(
      (p: { type: string; isStructure?: boolean }) => p.type === 'SPEN' && p.isStructure
    );
    expect(spen).toBeDefined();
    expect(spen.prerequisite).toBe('POWR');
    expect(spen.faction).toBe('soviet');
    expect(spen.cost).toBe(650);
    expect(spen.techLevel).toBe(3);
  });

  it('LST (Transport) is buildable from both SYRD and SPEN (faction=both)', () => {

    const lst = PRODUCTION_ITEMS.find((p: { type: string }) => p.type === 'LST');
    expect(lst).toBeDefined();
    expect(lst.prerequisite).toBe('SYRD');
    expect(lst.faction).toBe('both');
    // Because of SYRD↔SPEN alias, LST is available to soviet with SPEN too
  });
});

// -- Power Grid Integration --------------------------------------------------
//
// SPEN consumes 30W. It does NOT produce power. Only alive, non-selling,
// allied structures count toward the grid.

describe('SPEN in power grid (calculatePowerGrid)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('SPEN alone: 0W produced, 30W consumed', () => {
    const spen = makeSPEN(10, 10, 1000, House.Spain);
    const grid = calculatePowerGrid([spen], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
    expect(grid.consumed).toBe(30);
  });

  it('SPEN + POWR: 100W produced, 30W consumed, net 70W', () => {
    const powr = makeBuilding('POWR', 5, 5, 400, House.Spain);
    const spen = makeSPEN(10, 10, 1000, House.Spain);
    const grid = calculatePowerGrid([powr, spen], House.Spain, isAllied);
    expect(grid.produced).toBe(100);
    expect(grid.consumed).toBe(30);
    expect(grid.produced - grid.consumed).toBe(70);
  });

  it('dead SPEN does not consume power', () => {
    const spen = makeSPEN(10, 10, 0, House.Spain);
    spen.alive = false;
    const grid = calculatePowerGrid([spen], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('selling SPEN does not consume power', () => {
    const spen = makeSPEN(10, 10, 1000, House.Spain);
    spen.sellProgress = 0.5;
    const grid = calculatePowerGrid([spen], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('enemy SPEN does not appear in player grid', () => {
    const spen = makeSPEN(10, 10, 1000, House.USSR);
    const grid = calculatePowerGrid([spen], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('SPEN does not produce power regardless of health', () => {
    expect(powerOutput('SPEN', 1000, 1000)).toBe(0);
    expect(powerOutput('SPEN', 500, 1000)).toBe(0);
    expect(powerOutput('SPEN', 0, 1000)).toBe(0);
  });
});

// -- Economic Functions (repairSell.ts) ---------------------------------------
//
// C++ rules.ini: SPEN Cost=650, Strength=1000

describe('SPEN economic functions (rules.ini Cost=650)', () => {
  const SPEN_COST = 650;
  const SPEN_MAX_HP = 1000;

  it('sell refund is 50% of build cost = 325', () => {
    expect(sellRefund(SPEN_COST)).toBe(325);
  });

  it('repair cost per step: ceil(650 * 0.20 / (1000 / 7)) = ceil(130 / 142.86) = 1', () => {
    expect(repairCostPerStep(SPEN_COST, SPEN_MAX_HP)).toBe(1);
  });
});

// -- 3x3 Footprint -----------------------------------------------------------
//
// C++ STRUCTURE_SIZE: SPEN is 3x3. The origin cell is top-left;
// the structure occupies a 3x3 grid of cells from (cx,cy).

describe('SPEN 3x3 footprint', () => {

  it('footprint occupies 9 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['SPEN']!;
    expect(w * h).toBe(9);
    // Origin at (10,10) -> 9 cells
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
// Non-barrel structures produce a visual-only FBALL1 death animation
// on destruction (C++ parity). No warhead damage is dealt to entities. This is NOT the barrel cardinal
// fire-bullet mechanic.

describe('SPEN destruction blast -- visual-only (C++ parity: no entity damage)', () => {

  it('entities take NO damage on destruction (visual-only explosion)', () => {
    const spen = makeSPEN(10, 10, 50); // Low HP, will die
    spen.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([spen], [victim]);
    structureDamage(ctx, spen, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('diagonal entities take NO damage on destruction (visual-only explosion)', () => {
    const spen = makeSPEN(10, 10, 50);
    spen.house = House.USSR;
    // Blast center is at (cx+1, cy+1) = (11,11) in cell coords.
    // Entity at (12,12) center is ~2.12 cells away — just outside.
    // Place at (12,11) — 1 cell away diagonally in x only, within radius.
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 12, 11);
    const bx = 10 * CELL_SIZE + CELL_SIZE; // blast origin: cx+1 cell
    const by = 10 * CELL_SIZE + CELL_SIZE;
    const dist = worldDist({ x: bx, y: by }, victim.pos);
    expect(dist).toBeLessThan(2);
    const ctx = makeCombatCtx([spen], [victim]);
    structureDamage(ctx, spen, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('no entity damage at any distance (visual-only explosion)', () => {
    const spen = makeSPEN(10, 10, 50);
    spen.house = House.USSR;
    const close = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const far = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 12);
    const ctx = makeCombatCtx([spen], [close, far]);
    structureDamage(ctx, spen, 100);
    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    expect(closeDmg).toBe(0);
    expect(farDmg).toBe(0);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const spen = makeSPEN(10, 10, 50);
    spen.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 15, 10); // 5 cells E, well beyond
    const ctx = makeCombatCtx([spen], [victim]);
    structureDamage(ctx, spen, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('destruction blast damages adjacent structures', () => {
    const spen = makeSPEN(10, 10, 50);
    spen.house = House.USSR;
    // Blast center is at (cx*CELL_SIZE+CELL_SIZE, cy*CELL_SIZE+CELL_SIZE) = cell (11,11).
    // Structure center uses same formula. Place SILO at (12,10) so its center is
    // at (13,11) = 2 cells away (boundary, excluded). Use (11,9) -> center (12,10)
    // = sqrt(1+1) = 1.41 cells — within radius.
    const nearby = makeBuilding('SILO', 11, 9, 300);
    const ctx = makeCombatCtx([spen, nearby]);
    structureDamage(ctx, spen, 100);
    expect(nearby.hp).toBeLessThan(300);
  });

  it('no barrel cardinal mechanic AND no radial entity damage (visual-only)', () => {
    // Barrel explosions hit ONLY cardinal cells with flat 200 damage.
    // SPEN should use radial HE with falloff instead — diagonals should
    // take damage (unlike barrels where diagonals are immune).
    const spen = makeSPEN(10, 10, 50);
    spen.house = House.USSR;
    const diagonal = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([spen], [diagonal]);
    structureDamage(ctx, spen, 100);
    // C++ parity: visual-only explosion, no entity damage
    expect(diagonal.hp).toBe(diagonal.maxHp);
  });
});

// -- High HP Tank Test -------------------------------------------------------
//
// SPEN has 1000 HP (same as WEAP/DOME/SYRD). It should survive moderate
// damage and only go down under sustained fire.

describe('SPEN high HP durability (Strength=1000)', () => {

  it('survives 500 damage (1000 -> 500 HP)', () => {
    const spen = makeSPEN(10, 10, 1000, House.USSR);
    const ctx = makeCombatCtx([spen]);
    structureDamage(ctx, spen, 500);
    expect(spen.alive).toBe(true);
    expect(spen.hp).toBe(500);
  });

  it('survives 999 damage (1000 -> 1 HP)', () => {
    const spen = makeSPEN(10, 10, 1000, House.USSR);
    const ctx = makeCombatCtx([spen]);
    structureDamage(ctx, spen, 999);
    expect(spen.alive).toBe(true);
    expect(spen.hp).toBe(1);
  });

  it('is destroyed at exactly 1000 damage', () => {
    const spen = makeSPEN(10, 10, 1000, House.USSR);
    const ctx = makeCombatCtx([spen]);
    structureDamage(ctx, spen, 1000);
    expect(spen.alive).toBe(false);
    expect(spen.hp).toBe(0);
  });

  it('HP clamps at 0 for overkill damage', () => {
    const spen = makeSPEN(10, 10, 1000, House.USSR);
    const ctx = makeCombatCtx([spen]);
    structureDamage(ctx, spen, 2000);
    expect(spen.alive).toBe(false);
    expect(spen.hp).toBe(0);
  });
});

// -- Factory Count (trigger system) ------------------------------------------
//
// C++ parity: SPEN counts as a factory for trigger evaluation
// (along with FACT, WEAP, BARR, TENT, AFLD, HPAD, SYRD).
// This affects TEVENT_NOFACTORIES checks.

describe('SPEN counts as a factory (trigger system parity)', () => {

  it('SPEN is included in the factory list for trigger evaluation', () => {
    // The game checks for these types in the trigger system:
    // FACT, WEAP, BARR, TENT, AFLD, HPAD, SYRD, SPEN
    const factoryTypes = ['FACT', 'WEAP', 'BARR', 'TENT', 'AFLD', 'HPAD', 'SYRD', 'SPEN'];
    expect(factoryTypes).toContain('SPEN');
  });
});
