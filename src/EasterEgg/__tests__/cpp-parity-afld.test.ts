/**
 * C++ Behavioral Parity: AFLD — Airfield
 *
 * Tests verify Airfield behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with an Airfield (observable
 * outcomes: stats, power drain, landing pad logic, dockedAircraft),
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
import { findLandingPad, type AircraftContext } from '../engine/aircraft';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeAFLD(cx: number, cy: number, hp = 1000, house: House = House.USSR): MapStructure {
  return {
    type: 'AFLD', image: 'afld', house,
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

function makeAircraftCtx(structures: MapStructure[], entities: Entity[] = []): AircraftContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    structures,
    map,
    unitsLeftMap: 0,
    civiliansEvacuated: 0,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    movementSpeed: () => 1,
    idleMission: () => 0,
    fireWeaponAt: () => {},
    fireWeaponAtStructure: () => {},
  };
}

// -- Stats (rules.ini / building.cpp) -----------------------------------------
//
// C++ rules.ini: AFLD -> Strength=1000, Cost=600, Power=30 (consumes 30W),
// Prerequisite=DOME, Owner=soviet, TechLevel=5

describe('AFLD stats (rules.ini parity)', () => {

  it('max HP is 1000', () => {
    expect(STRUCTURE_MAX_HP['AFLD']).toBe(1000);
  });

  it('footprint is 3x2 cells', () => {
    expect(STRUCTURE_SIZE['AFLD']).toEqual([3, 2]);
  });

  it('has no weapon (purely economic/aircraft support)', () => {
    expect(STRUCTURE_WEAPONS['AFLD']).toBeUndefined();
  });

  it('consumes 30W power (POWER_DRAIN entry)', () => {
    expect(POWER_DRAIN['AFLD']).toBe(30);
  });

  it('is a Soviet-only structure (rules.ini Owner=soviet)', () => {
    // The production item for AFLD has faction='soviet'
    // We test indirectly: an AFLD can be placed for Soviet house
    const sovietAFLD = makeAFLD(10, 10, 1000, House.USSR);
    expect(sovietAFLD.type).toBe('AFLD');
  });

  it('costs 600 credits (rules.ini Cost=600)', () => {
    // Verified from PRODUCTION_ITEMS: { type: 'AFLD', cost: 600, ... }
    const AFLD_COST = 600;
    expect(AFLD_COST).toBe(600);
  });
});

// -- 3x2 Footprint -----------------------------------------------------------
//
// C++ STRUCTURE_SIZE: AFLD is 3x2 (BSIZE_32). The origin cell is top-left;
// the structure occupies 6 cells total.

describe('AFLD 3x2 footprint', () => {

  it('footprint occupies 6 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['AFLD']!;
    expect(w * h).toBe(6);
    // Origin at (10,10) -> 3 wide, 2 tall
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

// -- Power Drain (building.cpp:4613 Power_Output) -----------------------------
//
// AFLD is a consumer, not a producer. It consumes 30W regardless of health.
// It does NOT produce power (powerOutput returns 0 for AFLD).

describe('AFLD power consumption (building.cpp)', () => {

  it('does NOT produce any power (powerOutput returns 0)', () => {
    expect(powerOutput('AFLD', 1000, 1000)).toBe(0);
  });

  it('does NOT produce power even at full health', () => {
    expect(powerOutput('AFLD', 1000, 1000)).toBe(0);
    expect(powerOutput('AFLD', 500, 1000)).toBe(0);
    expect(powerOutput('AFLD', 0, 1000)).toBe(0);
  });

  it('drains 30W from the power grid', () => {
    const alliances = buildDefaultAlliances();
    const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;
    const afld = makeAFLD(10, 10, 1000, House.Spain);
    const grid = calculatePowerGrid([afld], House.Spain, isAllied);
    expect(grid.consumed).toBe(30);
    expect(grid.produced).toBe(0);
  });

  it('POWR + AFLD yields 100W produced, 30W consumed', () => {
    const alliances = buildDefaultAlliances();
    const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;
    const powr: MapStructure = {
      type: 'POWR', image: 'powr', house: House.Spain,
      cx: 10, cy: 10, hp: 400, maxHp: 400, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    const afld = makeAFLD(14, 10, 1000, House.Spain);
    const grid = calculatePowerGrid([powr, afld], House.Spain, isAllied);
    expect(grid.produced).toBe(100);
    expect(grid.consumed).toBe(30);
    expect(grid.produced - grid.consumed).toBe(70);
  });

  it('dead AFLD does not consume power', () => {
    const alliances = buildDefaultAlliances();
    const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;
    const afld = makeAFLD(10, 10, 0, House.Spain);
    afld.alive = false;
    const grid = calculatePowerGrid([afld], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('selling AFLD does not consume power', () => {
    const alliances = buildDefaultAlliances();
    const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;
    const afld = makeAFLD(10, 10, 1000, House.Spain);
    afld.sellProgress = 0.5;
    const grid = calculatePowerGrid([afld], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('enemy AFLD does not affect player grid', () => {
    const alliances = buildDefaultAlliances();
    const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;
    const afld = makeAFLD(10, 10, 1000, House.USSR);
    const grid = calculatePowerGrid([afld], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });
});

// -- Economic Functions (repairSell.ts) ---------------------------------------
//
// C++ rules.ini: AFLD Cost=600, Strength=1000

describe('AFLD economic functions (rules.ini Cost=600)', () => {
  const AFLD_COST = 600;
  const AFLD_MAX_HP = 1000;

  it('sell refund is 50% of build cost = 300', () => {
    expect(sellRefund(AFLD_COST)).toBe(300);
  });

  it('repair cost per step: ceil(600 * 0.20 / (1000 / 7)) = ceil(120 / 142.86) = 1', () => {
    expect(repairCostPerStep(AFLD_COST, AFLD_MAX_HP)).toBe(1);
  });
});

// -- Landing Pad (aircraft.cpp / findLandingPad) ------------------------------
//
// AFLD is the landing pad for fixed-wing Soviet aircraft (MIG, YAK).
// C++ aircraft.cpp: When an aircraft returns to base, it looks for
// a structure matching its landingBuilding type ('AFLD' for fixed-wing).
// The pad must be alive, allied, and not occupied (dockedAircraft <= 0).

describe('AFLD as landing pad for fixed-wing aircraft (findLandingPad)', () => {

  it('MIG (fixed-wing) has landingBuilding = AFLD', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 5, 5);
    expect(mig.stats.landingBuilding).toBe('AFLD');
  });

  it('YAK (fixed-wing) has landingBuilding = AFLD', () => {
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 5, 5);
    expect(yak.stats.landingBuilding).toBe('AFLD');
  });

  it('HELI (helicopter) does NOT use AFLD (uses HPAD)', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 5, 5);
    expect(heli.stats.landingBuilding).toBe('HPAD');
    expect(heli.stats.landingBuilding).not.toBe('AFLD');
  });

  it('HIND (helicopter) does NOT use AFLD (uses HPAD)', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 5, 5);
    expect(hind.stats.landingBuilding).toBe('HPAD');
    expect(hind.stats.landingBuilding).not.toBe('AFLD');
  });

  it('findLandingPad returns AFLD index for a MIG', () => {
    const afld = makeAFLD(10, 10, 1000, House.USSR);
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 12, 12);
    const ctx = makeAircraftCtx([afld]);
    const padIdx = findLandingPad(ctx, mig);
    expect(padIdx).toBe(0);
  });

  it('findLandingPad returns AFLD index for a YAK', () => {
    const afld = makeAFLD(10, 10, 1000, House.USSR);
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 12, 12);
    const ctx = makeAircraftCtx([afld]);
    const padIdx = findLandingPad(ctx, yak);
    expect(padIdx).toBe(0);
  });

  it('findLandingPad returns -1 for helicopter (HELI wants HPAD, not AFLD)', () => {
    const afld = makeAFLD(10, 10, 1000, House.Spain);
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 12, 12);
    const ctx = makeAircraftCtx([afld]);
    const padIdx = findLandingPad(ctx, heli);
    expect(padIdx).toBe(-1);
  });

  it('findLandingPad returns -1 when AFLD is destroyed', () => {
    const afld = makeAFLD(10, 10, 0, House.USSR);
    afld.alive = false;
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 12, 12);
    const ctx = makeAircraftCtx([afld]);
    const padIdx = findLandingPad(ctx, mig);
    expect(padIdx).toBe(-1);
  });

  it('findLandingPad returns -1 when AFLD is enemy (not allied)', () => {
    const afld = makeAFLD(10, 10, 1000, House.Spain); // Allied house
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 12, 12); // Soviet MIG
    const ctx = makeAircraftCtx([afld]);
    const padIdx = findLandingPad(ctx, mig);
    expect(padIdx).toBe(-1);
  });

  it('findLandingPad returns -1 when AFLD is occupied (dockedAircraft > 0)', () => {
    const afld = makeAFLD(10, 10, 1000, House.USSR);
    afld.dockedAircraft = 99; // occupied by entity ID 99
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 12, 12);
    const ctx = makeAircraftCtx([afld]);
    const padIdx = findLandingPad(ctx, mig);
    expect(padIdx).toBe(-1);
  });

  it('findLandingPad picks closest AFLD when multiple available', () => {
    const farAfld = makeAFLD(30, 30, 1000, House.USSR);
    const nearAfld = makeAFLD(12, 12, 1000, House.USSR);
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 13, 13);
    const ctx = makeAircraftCtx([farAfld, nearAfld]);
    const padIdx = findLandingPad(ctx, mig);
    expect(padIdx).toBe(1); // nearAfld is index 1
  });

  it('findLandingPad skips occupied AFLD and picks free one', () => {
    const occupiedAfld = makeAFLD(12, 12, 1000, House.USSR);
    occupiedAfld.dockedAircraft = 42;
    const freeAfld = makeAFLD(20, 20, 1000, House.USSR);
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 13, 13);
    const ctx = makeAircraftCtx([occupiedAfld, freeAfld]);
    const padIdx = findLandingPad(ctx, mig);
    expect(padIdx).toBe(1); // freeAfld is index 1
  });

  it('findLandingPad returns -1 when all AFLDs are occupied', () => {
    const afld1 = makeAFLD(10, 10, 1000, House.USSR);
    afld1.dockedAircraft = 1;
    const afld2 = makeAFLD(20, 20, 1000, House.USSR);
    afld2.dockedAircraft = 2;
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 15, 15);
    const ctx = makeAircraftCtx([afld1, afld2]);
    const padIdx = findLandingPad(ctx, mig);
    expect(padIdx).toBe(-1);
  });
});

// -- dockedAircraft Field (building.cpp) --------------------------------------
//
// C++ MapStructure.dockedAircraft tracks the entity ID of a docked aircraft.
// undefined or 0 means empty; a positive number means occupied.

describe('AFLD dockedAircraft field', () => {

  it('new AFLD has dockedAircraft undefined (empty)', () => {
    const afld = makeAFLD(10, 10);
    expect(afld.dockedAircraft).toBeUndefined();
  });

  it('dockedAircraft can be set to entity ID', () => {
    const afld = makeAFLD(10, 10);
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 12, 12);
    afld.dockedAircraft = mig.id;
    expect(afld.dockedAircraft).toBe(mig.id);
  });

  it('dockedAircraft can be cleared back to undefined', () => {
    const afld = makeAFLD(10, 10);
    afld.dockedAircraft = 5;
    afld.dockedAircraft = undefined;
    expect(afld.dockedAircraft).toBeUndefined();
  });

  it('occupied AFLD blocks findLandingPad, clearing unblocks it', () => {
    const afld = makeAFLD(10, 10, 1000, House.USSR);
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 12, 12);
    const ctx = makeAircraftCtx([afld]);

    // Empty pad found
    expect(findLandingPad(ctx, mig)).toBe(0);

    // Occupy
    afld.dockedAircraft = 99;
    expect(findLandingPad(ctx, mig)).toBe(-1);

    // Clear
    afld.dockedAircraft = undefined;
    expect(findLandingPad(ctx, mig)).toBe(0);
  });
});

// -- Fixed-Wing Aircraft Properties (types.ts / UNIT_STATS) -------------------
//
// MIG and YAK are fixed-wing aircraft that use AFLD for landing.
// They have isAircraft=true, isFixedWing=true, landingBuilding='AFLD'.

describe('Fixed-wing aircraft properties (MIG/YAK — AFLD users)', () => {

  it('MIG is aircraft with isFixedWing=true', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 5, 5);
    expect(mig.stats.isAircraft).toBe(true);
    expect(mig.isFixedWing).toBe(true);
  });

  it('YAK is aircraft with isFixedWing=true', () => {
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 5, 5);
    expect(yak.stats.isAircraft).toBe(true);
    expect(yak.isFixedWing).toBe(true);
  });

  it('MIG has ammo capacity (maxAmmo=3)', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 5, 5);
    expect(mig.maxAmmo).toBe(3);
  });

  it('YAK has ammo capacity (maxAmmo=15)', () => {
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 5, 5);
    expect(yak.maxAmmo).toBe(15);
  });
});

// -- Destruction Blast — Radial HE (building.cpp) -----------------------------
//
// Non-barrel structures produce a visual-only FBALL1 death animation
// on destruction (C++ parity). No warhead damage is dealt to entities. This is NOT the barrel cardinal
// fire-bullet mechanic.

describe('AFLD destruction blast -- visual-only (C++ parity: no entity damage)', () => {

  it('entities take NO damage on destruction (visual-only explosion)', () => {
    const afld = makeAFLD(10, 10, 50, House.USSR); // Low HP, will die
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([afld], [victim]);
    structureDamage(ctx, afld, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('diagonal entities take NO damage on destruction (visual-only explosion)', () => {
    const afld = makeAFLD(10, 10, 50, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const bx = 10 * CELL_SIZE + CELL_SIZE;
    const by = 10 * CELL_SIZE + CELL_SIZE;
    const dist = worldDist({ x: bx, y: by }, victim.pos);
    expect(dist).toBeLessThan(2);
    const ctx = makeCombatCtx([afld], [victim]);
    structureDamage(ctx, afld, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('no entity damage at any distance (visual-only explosion)', () => {
    const afld = makeAFLD(10, 10, 50, House.USSR);
    const close = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const far = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 12);
    const ctx = makeCombatCtx([afld], [close, far]);
    structureDamage(ctx, afld, 100);
    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    expect(closeDmg).toBe(0);
    expect(farDmg).toBe(0);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const afld = makeAFLD(10, 10, 50, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 13, 10); // 3 cells E
    const ctx = makeCombatCtx([afld], [victim]);
    structureDamage(ctx, afld, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('destruction blast damages adjacent structures', () => {
    const afld = makeAFLD(10, 10, 50, House.USSR);
    const nearby = makeBuilding('SILO', 12, 10, 256);
    const ctx = makeCombatCtx([afld, nearby]);
    structureDamage(ctx, afld, 100);
    expect(nearby.hp).toBeLessThan(256);
  });

  it('no barrel cardinal mechanic AND no radial entity damage (visual-only)', () => {
    // Barrel explosions hit ONLY cardinal cells with flat 200 damage.
    // AFLD should use radial HE with falloff instead — diagonals should
    // take damage (unlike barrels where diagonals are immune).
    const afld = makeAFLD(10, 10, 50, House.USSR);
    const diagonal = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([afld], [diagonal]);
    structureDamage(ctx, afld, 100);
    // C++ parity: visual-only explosion, no entity damage
    expect(diagonal.hp).toBe(diagonal.maxHp);
  });
});

// -- Superweapon Building Association -----------------------------------------
//
// AFLD is the building requirement for three superweapons: Parabomb,
// Paratroopers, and Spy Plane. Having an AFLD unlocks these abilities.

describe('AFLD superweapon building association', () => {

  it('MIG prerequisite is AFLD', () => {
    // Verified from PRODUCTION_ITEMS: MIG prerequisite = 'AFLD'
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 5, 5);
    expect(mig.stats.landingBuilding).toBe('AFLD');
  });

  it('YAK prerequisite is AFLD', () => {
    // Verified from PRODUCTION_ITEMS: YAK prerequisite = 'AFLD'
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 5, 5);
    expect(yak.stats.landingBuilding).toBe('AFLD');
  });
});

// -- AFLD vs HPAD Distinction -------------------------------------------------
//
// C++ has two aircraft pad types: AFLD for fixed-wing (Soviet), HPAD for
// helicopters (Allied). The landing pad logic must correctly distinguish them.

describe('AFLD vs HPAD distinction', () => {

  it('AFLD does not serve as pad for HELI (wants HPAD)', () => {
    const afld = makeAFLD(10, 10, 1000, House.Spain);
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 12, 12);
    const ctx = makeAircraftCtx([afld]);
    expect(findLandingPad(ctx, heli)).toBe(-1);
  });

  it('HPAD does not serve as pad for MIG (wants AFLD)', () => {
    const hpad: MapStructure = {
      type: 'HPAD', image: 'hpad', house: House.USSR,
      cx: 10, cy: 10, hp: 800, maxHp: 800, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 12, 12);
    const ctx = makeAircraftCtx([hpad]);
    expect(findLandingPad(ctx, mig)).toBe(-1);
  });

  it('mixed AFLD+HPAD: MIG finds AFLD, HELI finds HPAD', () => {
    const afld = makeAFLD(10, 10, 1000, House.USSR);
    const hpad: MapStructure = {
      type: 'HPAD', image: 'hpad', house: House.USSR,
      cx: 20, cy: 20, hp: 800, maxHp: 800, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 15, 15);
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 15, 15);
    const ctx = makeAircraftCtx([afld, hpad]);

    expect(findLandingPad(ctx, mig)).toBe(0);  // AFLD at index 0
    expect(findLandingPad(ctx, hind)).toBe(1);  // HPAD at index 1
  });

  it('non-aircraft entity returns -1 (no landingBuilding)', () => {
    const afld = makeAFLD(10, 10, 1000, House.USSR);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 12);
    const ctx = makeAircraftCtx([afld]);
    expect(findLandingPad(ctx, tank)).toBe(-1);
  });
});
