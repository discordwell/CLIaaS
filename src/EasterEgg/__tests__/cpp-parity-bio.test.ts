/**
 * C++ Behavioral Parity: BIO — Bio Research Lab
 *
 * Tests verify Bio Research Lab behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * BIO is a scenario-only structure (not player-buildable). It has 600 HP,
 * a 2x2 footprint, no weapon, no power drain, and no power production.
 * It appears only in pre-placed scenario maps.
 *
 * These tests describe WHAT happens with a Bio Research Lab (observable
 * outcomes: stats, footprint, power grid non-participation, destruction blast,
 * durability), not HOW the code implements it. The same scenarios should
 * produce identical results in C++ and TypeScript.
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
  STRUCTURE_WEAPONS, STRUCTURE_POWERED,
} from '../engine/scenario';
import {
  powerOutput, calculatePowerGrid,
} from '../engine/repairSell';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeBIO(cx: number, cy: number, hp = 600, house: House = House.USSR): MapStructure {
  return {
    type: 'BIO', image: 'bio', house,
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
// C++ rules.ini: BIO -> Strength=600, no Cost (not buildable), no Power,
// no Prerequisite, scenario-only structure. TechLevel=-1 (unbuildable).

describe('BIO stats (rules.ini parity)', () => {

  it('max HP is 600', () => {
    expect(STRUCTURE_MAX_HP['BIO']).toBe(600);
  });

  it('footprint is 2x2 cells', () => {
    expect(STRUCTURE_SIZE['BIO']).toEqual([2, 2]);
  });

  it('has no weapon (no defensive capability)', () => {
    expect(STRUCTURE_WEAPONS['BIO']).toBeUndefined();
  });

  it('is not a power consumer (no entry in POWER_DRAIN)', () => {
    expect(POWER_DRAIN['BIO']).toBeUndefined();
  });

  it('is not a powered structure (not affected by power deficit)', () => {
    expect(STRUCTURE_POWERED.has('BIO')).toBe(false);
  });

  it('is not player-buildable (scenario-only, not in PRODUCTION_ITEMS)', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'BIO');
    expect(prodItem).toBeUndefined();
  });
});

// -- 2x2 Footprint -----------------------------------------------------------
//
// C++ STRUCTURE_SIZE: BIO is 2x2. The origin cell is top-left;
// the structure occupies (cx,cy), (cx+1,cy), (cx,cy+1), (cx+1,cy+1).

describe('BIO 2x2 footprint', () => {

  it('footprint occupies 4 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['BIO']!;
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

  it('BIO size matches POWR size (both 2x2)', () => {
    expect(STRUCTURE_SIZE['BIO']).toEqual(STRUCTURE_SIZE['POWR']);
  });
});

// -- Power Grid Non-Participation ---------------------------------------------
//
// BIO neither produces nor consumes power. It is a passive scenario structure.

describe('BIO power grid non-participation (calculatePowerGrid)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('BIO produces 0W (not a power plant)', () => {
    expect(powerOutput('BIO', 600, 600)).toBe(0);
  });

  it('damaged BIO produces 0W', () => {
    expect(powerOutput('BIO', 300, 600)).toBe(0);
  });

  it('BIO alone yields 0 produced, 0 consumed in grid', () => {
    const bio = makeBIO(10, 10, 600, House.Spain);
    const grid = calculatePowerGrid([bio], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
    expect(grid.consumed).toBe(0);
  });

  it('dead BIO has no power grid impact', () => {
    const bio = makeBIO(10, 10, 0, House.Spain);
    bio.alive = false;
    const grid = calculatePowerGrid([bio], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
    expect(grid.consumed).toBe(0);
  });

  it('BIO does not affect POWR output in shared grid', () => {
    const powr = makeBuilding('POWR', 10, 10, 400, House.Spain);
    const bio = makeBIO(14, 10, 600, House.Spain);
    const grid = calculatePowerGrid([powr, bio], House.Spain, isAllied);
    expect(grid.produced).toBe(100);
    expect(grid.consumed).toBe(0);
  });

  it('enemy BIO has no power grid impact on player', () => {
    const bio = makeBIO(10, 10, 600, House.USSR);
    const grid = calculatePowerGrid([bio], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
    expect(grid.consumed).toBe(0);
  });
});

// -- Durability (Strength=600) ------------------------------------------------
//
// BIO has 600 HP — moderately tough. This is between POWR (400) and
// DOME/WEAP (1000), requiring sustained firepower to destroy.

describe('BIO durability (Strength=600)', () => {

  it('survives 599 points of damage', () => {
    const bio = makeBIO(10, 10, 600, House.USSR);
    const ctx = makeCombatCtx([bio]);
    structureDamage(ctx, bio, 599);
    expect(bio.alive).toBe(true);
    expect(bio.hp).toBe(1);
  });

  it('is destroyed by 600+ damage', () => {
    const bio = makeBIO(10, 10, 600, House.USSR);
    const ctx = makeCombatCtx([bio]);
    structureDamage(ctx, bio, 600);
    expect(bio.alive).toBe(false);
    expect(bio.hp).toBe(0);
  });

  it('incremental damage accumulates correctly', () => {
    const bio = makeBIO(10, 10, 600, House.USSR);
    const ctx = makeCombatCtx([bio]);
    // Apply 6 hits of 50 damage = 300 total
    for (let i = 0; i < 6; i++) {
      structureDamage(ctx, bio, 50);
    }
    expect(bio.alive).toBe(true);
    expect(bio.hp).toBe(300);
  });

  it('HP does not go below 0', () => {
    const bio = makeBIO(10, 10, 100, House.USSR);
    const ctx = makeCombatCtx([bio]);
    structureDamage(ctx, bio, 9999);
    expect(bio.hp).toBe(0);
  });

  it('survives two 200-damage hits but not three', () => {
    const bio = makeBIO(10, 10, 600, House.USSR);
    const ctx = makeCombatCtx([bio]);
    structureDamage(ctx, bio, 200);
    expect(bio.alive).toBe(true);
    expect(bio.hp).toBe(400);
    structureDamage(ctx, bio, 200);
    expect(bio.alive).toBe(true);
    expect(bio.hp).toBe(200);
    structureDamage(ctx, bio, 200);
    expect(bio.alive).toBe(false);
    expect(bio.hp).toBe(0);
  });
});

// -- Destruction Blast — Radial HE (building.cpp) -----------------------------
//
// Non-barrel structures (including BIO) use a generic 2-cell radial HE blast
// with distance falloff on destruction. This is NOT the barrel cardinal
// fire-bullet mechanic.

describe('BIO destruction blast — radial HE (non-barrel)', () => {

  it('damages entities within 2-cell radius on destruction', () => {
    const bio = makeBIO(10, 10, 50);
    bio.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([bio], [victim]);
    structureDamage(ctx, bio, 100);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('damages entities in diagonal cells (within 2-cell radius)', () => {
    const bio = makeBIO(10, 10, 50);
    bio.house = House.USSR;
    // Entity at diagonal (11,11) — within 2-cell radius
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const bx = 10 * CELL_SIZE + CELL_SIZE;
    const by = 10 * CELL_SIZE + CELL_SIZE;
    const dist = worldDist({ x: bx, y: by }, victim.pos);
    expect(dist).toBeLessThan(2);
    const ctx = makeCombatCtx([bio], [victim]);
    structureDamage(ctx, bio, 100);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('uses distance falloff (closer = more damage)', () => {
    const bio = makeBIO(10, 10, 50);
    bio.house = House.USSR;
    const close = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const far = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 12);
    const ctx = makeCombatCtx([bio], [close, far]);
    structureDamage(ctx, bio, 100);
    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    expect(closeDmg).toBeGreaterThan(farDmg);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const bio = makeBIO(10, 10, 50);
    bio.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 13, 10); // 3 cells E
    const ctx = makeCombatCtx([bio], [victim]);
    structureDamage(ctx, bio, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('destruction blast damages adjacent structures', () => {
    const bio = makeBIO(10, 10, 50);
    bio.house = House.USSR;
    const nearby = makeBuilding('SILO', 12, 10, 256);
    const ctx = makeCombatCtx([bio, nearby]);
    structureDamage(ctx, bio, 100);
    expect(nearby.hp).toBeLessThan(256);
  });

  it('does NOT use barrel cardinal fire-bullet mechanic', () => {
    // Barrel explosions hit ONLY cardinal cells with flat 200 damage.
    // BIO should use radial HE with falloff instead — diagonals should
    // take damage (unlike barrels where diagonals are immune).
    const bio = makeBIO(10, 10, 50);
    bio.house = House.USSR;
    const diagonal = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([bio], [diagonal]);
    structureDamage(ctx, bio, 100);
    // Radial HE hits diagonals — unlike barrel cardinal-only
    expect(diagonal.hp).toBeLessThan(diagonal.maxHp);
  });
});

// -- Scenario-Only Placement --------------------------------------------------
//
// BIO is placed by scenario INI files only. It cannot be built by the player
// or AI through the production system. It serves as a map objective or
// environmental structure.

describe('BIO scenario-only constraints', () => {

  it('can be placed for any house (scenario INI uses arbitrary owners)', () => {
    const alliedBio = makeBIO(10, 10, 600, House.Spain);
    const sovietBio = makeBIO(20, 20, 600, House.USSR);
    const greekBio = makeBIO(30, 30, 600, House.Greece);
    expect(alliedBio.type).toBe('BIO');
    expect(sovietBio.type).toBe('BIO');
    expect(greekBio.type).toBe('BIO');
  });

  it('can be placed at partial health (scenario structures have variable HP)', () => {
    const damagedBio = makeBIO(10, 10, 300, House.USSR);
    expect(damagedBio.hp).toBe(300);
    expect(damagedBio.maxHp).toBe(600);
    expect(damagedBio.alive).toBe(true);
  });

  it('destroyed BIO becomes rubble', () => {
    const bio = makeBIO(10, 10, 50, House.USSR);
    const ctx = makeCombatCtx([bio]);
    structureDamage(ctx, bio, 100);
    expect(bio.alive).toBe(false);
    expect(bio.rubble).toBe(true);
  });
});
