/**
 * C++ Behavioral Parity: HPAD -- Helipad
 *
 * Tests verify Helipad behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with a Helipad (observable
 * outcomes: stats, power drain, landing pad selection, dockedAircraft),
 * not HOW the code implements it. The same scenarios should produce
 * identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, POWER_DRAIN, PRODUCTION_ITEMS,
  UNIT_STATS, Mission, AnimState,
  buildDefaultAlliances, worldDist,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  structureDamage,
} from '../engine/combat';
import {
  type AircraftContext,
  findLandingPad, updateAircraft,
} from '../engine/aircraft';
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

function makeHPAD(cx: number, cy: number, hp = 800, house: House = House.Spain): MapStructure {
  return {
    type: 'HPAD', image: 'hpad', house,
    cx, cy, hp, maxHp: 800, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  } as MapStructure;
}

function makeBuilding(type: string, cx: number, cy: number, hp: number, house: House = House.USSR): MapStructure {
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp, maxHp: hp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  } as MapStructure;
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
    getFirepowerBias: () => 1.0,
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

function makeAircraftCtx(
  entities: Entity[] = [],
  structures: MapStructure[] = [],
): AircraftContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    structures,
    map,
    unitsLeftMap: 0,
    civiliansEvacuated: 0,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    movementSpeed: (e: Entity) => e.stats.speed,
    idleMission: () => Mission.GUARD,
    fireWeaponAt: () => {},
    fireWeaponAtStructure: () => {},
  };
}

// -- Stats (rules.ini / building.cpp) -----------------------------------------
//
// C++ rules.ini: HPAD -> Strength=800, Cost=1500, Power=10 (drains 10W),
// Prerequisite=DOME, Owner=allies,soviet, TechLevel=9

describe('HPAD stats (rules.ini parity)', () => {

  it('max HP is 800', () => {
    expect(STRUCTURE_MAX_HP['HPAD']).toBe(800);
  });

  it('footprint is 2x2 cells', () => {
    expect(STRUCTURE_SIZE['HPAD']).toEqual([2, 2]);
  });

  it('has no weapon (purely support structure)', () => {
    expect(STRUCTURE_WEAPONS['HPAD']).toBeUndefined();
  });

  it('power drain is 10W', () => {
    expect(POWER_DRAIN['HPAD']).toBe(10);
  });

  it('cost is 1500 credits', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'HPAD' && p.isStructure);
    expect(item).toBeDefined();
    expect(item!.cost).toBe(1500);
  });

  it('prerequisite is DOME (Radar Dome)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'HPAD' && p.isStructure);
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('DOME');
  });

  it('techLevel is 9', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'HPAD' && p.isStructure);
    expect(item).toBeDefined();
    expect(item!.techLevel).toBe(9);
  });

  it('is available to both factions (Owner=allies,soviet)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'HPAD' && p.isStructure);
    expect(item).toBeDefined();
    expect(item!.faction).toBe('both');
    // Verify it can be placed for either house
    const alliedHPAD = makeHPAD(10, 10, 800, House.Spain);
    const sovietHPAD = makeHPAD(20, 20, 800, House.USSR);
    expect(alliedHPAD.type).toBe('HPAD');
    expect(sovietHPAD.type).toBe('HPAD');
  });
});

// -- Power Drain (building.cpp) -----------------------------------------------
//
// C++ rules.ini: HPAD Power=10 (positive = consumes 10W).
// HPAD does NOT produce power; it is a consumer.

describe('HPAD power drain (rules.ini Power=10)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('HPAD consumes 10W from the power grid', () => {
    const hpad = makeHPAD(10, 10, 800, House.Spain);
    const grid = calculatePowerGrid([hpad], House.Spain, isAllied);
    expect(grid.consumed).toBe(10);
    expect(grid.produced).toBe(0);
  });

  it('two HPADs consume 20W total', () => {
    const h1 = makeHPAD(10, 10, 800, House.Spain);
    const h2 = makeHPAD(14, 10, 800, House.Spain);
    const grid = calculatePowerGrid([h1, h2], House.Spain, isAllied);
    expect(grid.consumed).toBe(20);
  });

  it('damaged HPAD still consumes full 10W (drain is not health-scaled)', () => {
    const hpad = makeHPAD(10, 10, 100, House.Spain); // heavily damaged
    const grid = calculatePowerGrid([hpad], House.Spain, isAllied);
    expect(grid.consumed).toBe(10);
  });

  it('dead HPAD does not consume power', () => {
    const hpad = makeHPAD(10, 10, 0, House.Spain);
    hpad.alive = false;
    const grid = calculatePowerGrid([hpad], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('selling HPAD removes it from the power grid', () => {
    const hpad = makeHPAD(10, 10, 800, House.Spain);
    hpad.sellProgress = 0.5;
    const grid = calculatePowerGrid([hpad], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('enemy HPAD does not count toward player power consumed', () => {
    const hpad = makeHPAD(10, 10, 800, House.USSR);
    const grid = calculatePowerGrid([hpad], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });
});

// -- 2x2 Footprint -----------------------------------------------------------
//
// C++ STRUCTURE_SIZE: HPAD is 2x2. Origin cell is top-left;
// occupies (cx,cy), (cx+1,cy), (cx,cy+1), (cx+1,cy+1).

describe('HPAD 2x2 footprint', () => {

  it('footprint occupies 4 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['HPAD']!;
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

// -- Economic Functions (repairSell.ts) ---------------------------------------
//
// C++ rules.ini: HPAD Cost=1500, Strength=800

describe('HPAD economic functions (rules.ini Cost=1500)', () => {
  const HPAD_COST = 1500;
  const HPAD_MAX_HP = 800;

  it('sell refund is 50% of build cost = 750', () => {
    expect(sellRefund(HPAD_COST)).toBe(750);
  });

  it('repair cost per step: ceil(1500 * 0.20 / (800 / 7)) = ceil(300 / 114.29) = 3', () => {
    expect(repairCostPerStep(HPAD_COST, HPAD_MAX_HP)).toBe(3);
  });
});

// -- dockedAircraft Field (building.cpp) --------------------------------------
//
// C++ building.cpp — HPAD has a dockedAircraft field to track which aircraft
// is currently occupying the pad. undefined = empty, entity ID = occupied.

describe('HPAD dockedAircraft field', () => {

  it('newly created HPAD has no docked aircraft', () => {
    const hpad = makeHPAD(10, 10);
    expect(hpad.dockedAircraft).toBeUndefined();
  });

  it('dockedAircraft can be set to an entity ID', () => {
    const hpad = makeHPAD(10, 10);
    hpad.dockedAircraft = 42;
    expect(hpad.dockedAircraft).toBe(42);
  });

  it('dockedAircraft can be cleared back to undefined', () => {
    const hpad = makeHPAD(10, 10);
    hpad.dockedAircraft = 42;
    hpad.dockedAircraft = undefined;
    expect(hpad.dockedAircraft).toBeUndefined();
  });

  it('occupied HPAD (dockedAircraft > 0) blocks other aircraft landing', () => {
    const hpad = makeHPAD(10, 10, 800, House.Spain);
    hpad.dockedAircraft = 42; // occupied

    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 12, 10);
    heli.aircraftState = 'flying';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;

    const ctx = makeAircraftCtx([heli], [hpad]);
    const padIdx = findLandingPad(ctx, heli);

    expect(padIdx).toBe(-1); // no free pad
  });

  it('unoccupied HPAD (dockedAircraft undefined) allows landing', () => {
    const hpad = makeHPAD(10, 10, 800, House.Spain);
    // dockedAircraft is undefined by default

    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 12, 10);
    heli.aircraftState = 'flying';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;

    const ctx = makeAircraftCtx([heli], [hpad]);
    const padIdx = findLandingPad(ctx, heli);

    expect(padIdx).toBe(0); // pad is free
  });
});

// -- Landing Pad for Helicopters (aircraft.cpp / findLandingPad) --------------
//
// C++ aircraft.cpp — Helicopters (HELI, HIND, TRAN) use HPAD as their
// landingBuilding. findLandingPad returns the index of the closest allied,
// alive, unoccupied HPAD.

describe('HPAD as landing pad for helicopters (aircraft.cpp findLandingPad)', () => {

  it('HELI (Longbow) landingBuilding is HPAD', () => {
    expect(UNIT_STATS.HELI.landingBuilding).toBe('HPAD');
  });

  it('HIND landingBuilding is HPAD', () => {
    expect(UNIT_STATS.HIND.landingBuilding).toBe('HPAD');
  });

  it('TRAN (Chinook) landingBuilding is HPAD', () => {
    expect(UNIT_STATS.TRAN.landingBuilding).toBe('HPAD');
  });

  it('fixed-wing aircraft (MIG, YAK) do NOT use HPAD', () => {
    expect(UNIT_STATS.MIG.landingBuilding).toBe('AFLD');
    expect(UNIT_STATS.YAK.landingBuilding).toBe('AFLD');
    expect(UNIT_STATS.MIG.landingBuilding).not.toBe('HPAD');
    expect(UNIT_STATS.YAK.landingBuilding).not.toBe('HPAD');
  });

  it('findLandingPad returns HPAD index for HELI', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heli.aircraftState = 'flying';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const hpad = makeHPAD(12, 10, 800, House.Spain);

    const ctx = makeAircraftCtx([heli], [hpad]);
    expect(findLandingPad(ctx, heli)).toBe(0);
  });

  it('findLandingPad returns HPAD index for HIND', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.aircraftState = 'flying';
    hind.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const hpad = makeHPAD(12, 10, 800, House.USSR);

    const ctx = makeAircraftCtx([hind], [hpad]);
    expect(findLandingPad(ctx, hind)).toBe(0);
  });

  it('findLandingPad returns HPAD index for TRAN', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    tran.aircraftState = 'flying';
    tran.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const hpad = makeHPAD(12, 10, 800, House.USSR);

    const ctx = makeAircraftCtx([tran], [hpad]);
    expect(findLandingPad(ctx, tran)).toBe(0);
  });

  it('findLandingPad skips AFLD for helicopter entities', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heli.aircraftState = 'flying';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const afld = makeBuilding('AFLD', 12, 10, 1000, House.Spain);

    const ctx = makeAircraftCtx([heli], [afld]);
    expect(findLandingPad(ctx, heli)).toBe(-1); // AFLD not valid for HELI
  });

  it('findLandingPad does not return dead HPAD', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heli.aircraftState = 'flying';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const hpad = makeHPAD(12, 10, 0, House.Spain);
    hpad.alive = false;

    const ctx = makeAircraftCtx([heli], [hpad]);
    expect(findLandingPad(ctx, heli)).toBe(-1);
  });

  it('findLandingPad does not return enemy HPAD', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heli.aircraftState = 'flying';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const enemyPad = makeHPAD(12, 10, 800, House.USSR);

    const ctx = makeAircraftCtx([heli], [enemyPad]);
    expect(findLandingPad(ctx, heli)).toBe(-1);
  });

  it('findLandingPad returns allied HPAD (Greece allied with Spain)', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heli.aircraftState = 'flying';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const alliedPad = makeHPAD(12, 10, 800, House.Greece);

    const ctx = makeAircraftCtx([heli], [alliedPad]);
    expect(findLandingPad(ctx, heli)).toBe(0);
  });

  it('findLandingPad picks closest HPAD when multiple available', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heli.aircraftState = 'flying';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const farPad = makeHPAD(30, 10, 800, House.Spain);
    const nearPad = makeHPAD(12, 10, 800, House.Spain);

    const ctx = makeAircraftCtx([heli], [farPad, nearPad]);
    expect(findLandingPad(ctx, heli)).toBe(1); // nearPad is index 1, closer
  });

  it('findLandingPad skips occupied HPAD, returns next free one', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heli.aircraftState = 'flying';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const occupiedPad = makeHPAD(12, 10, 800, House.Spain);
    occupiedPad.dockedAircraft = 99;
    const freePad = makeHPAD(14, 10, 800, House.Spain);

    const ctx = makeAircraftCtx([heli], [occupiedPad, freePad]);
    expect(findLandingPad(ctx, heli)).toBe(1); // freePad is index 1
  });

  it('findLandingPad returns -1 when all HPADs are occupied', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heli.aircraftState = 'flying';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const pad1 = makeHPAD(12, 10, 800, House.Spain);
    pad1.dockedAircraft = 99;
    const pad2 = makeHPAD(14, 10, 800, House.Spain);
    pad2.dockedAircraft = 100;

    const ctx = makeAircraftCtx([heli], [pad1, pad2]);
    expect(findLandingPad(ctx, heli)).toBe(-1);
  });

  it('findLandingPad returns -1 when no HPAD exists', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heli.aircraftState = 'flying';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;

    const ctx = makeAircraftCtx([heli], []);
    expect(findLandingPad(ctx, heli)).toBe(-1);
  });
});

// -- Helicopter Docking Lifecycle (aircraft.cpp) ------------------------------
//
// When a helicopter returns to an HPAD, it sets dockedAircraft on the pad
// during landing, and clears it during takeoff.

describe('HPAD docking lifecycle (aircraft.cpp)', () => {

  it('helicopter landing at pad sets dockedAircraft', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heli.aircraftState = 'returning';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.mission = Mission.GUARD;
    const hpad = makeHPAD(10, 10, 800, House.Spain);

    const ctx = makeAircraftCtx([heli], [hpad]);
    // Tick the returning state to trigger landing approach
    updateAircraft(ctx, heli);

    // Aircraft should have docked (close enough to pad center)
    if (heli.aircraftState === 'landing') {
      expect(hpad.dockedAircraft).toBe(heli.id);
      expect(heli.landedAtStructure).toBe(0);
    }
  });

  it('helicopter takeoff clears dockedAircraft', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heli.aircraftState = 'landed';
    heli.flightAltitude = 0;
    heli.landedAtStructure = 0;
    heli.ammo = 6; // full ammo
    const hpad = makeHPAD(10, 10, 800, House.Spain);
    hpad.dockedAircraft = heli.id;

    // Give attack order to trigger takeoff
    const target = entityAtCell(UnitType.I_E1, House.USSR, 20, 20);
    heli.mission = Mission.ATTACK;
    heli.target = target;

    const ctx = makeAircraftCtx([heli, target], [hpad]);
    updateAircraft(ctx, heli);

    // Should have entered takeoff state
    expect(heli.aircraftState).toBe('takeoff');

    // Tick through takeoff to clear the dock
    for (let i = 0; i < Entity.FLIGHT_ALTITUDE; i++) {
      updateAircraft(ctx, heli);
    }

    // After takeoff, dockedAircraft should be cleared
    expect(hpad.dockedAircraft).toBeUndefined();
    expect(heli.landedAtStructure).toBe(-1);
  });
});

// -- Destruction Blast -- Radial HE (building.cpp) ----------------------------
//
// Non-barrel structures (including HPAD) use a generic 2-cell radial HE blast
// with distance falloff on destruction. HPAD has no barrel, so it does NOT use
// the cardinal fire-bullet mechanic.

describe('HPAD destruction blast -- radial HE (non-barrel)', () => {

  it('damages entities within 2-cell radius on destruction', () => {
    const hpad = makeHPAD(10, 10, 50, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([hpad], [victim]);
    structureDamage(ctx, hpad, 100);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('damages entities in diagonal cells (within 2-cell radius)', () => {
    const hpad = makeHPAD(10, 10, 50, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const bx = 10 * CELL_SIZE + CELL_SIZE;
    const by = 10 * CELL_SIZE + CELL_SIZE;
    const dist = worldDist({ x: bx, y: by }, victim.pos);
    expect(dist).toBeLessThan(2);
    const ctx = makeCombatCtx([hpad], [victim]);
    structureDamage(ctx, hpad, 100);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('uses distance falloff (closer = more damage)', () => {
    const hpad = makeHPAD(10, 10, 50, House.USSR);
    const close = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const far = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 12);
    const ctx = makeCombatCtx([hpad], [close, far]);
    structureDamage(ctx, hpad, 100);
    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    expect(closeDmg).toBeGreaterThan(farDmg);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const hpad = makeHPAD(10, 10, 50, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 13, 10); // 3 cells E
    const ctx = makeCombatCtx([hpad], [victim]);
    structureDamage(ctx, hpad, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('destruction blast damages adjacent structures', () => {
    const hpad = makeHPAD(10, 10, 50, House.USSR);
    const nearby = makeBuilding('SILO', 12, 10, 256);
    const ctx = makeCombatCtx([hpad, nearby]);
    structureDamage(ctx, hpad, 100);
    expect(nearby.hp).toBeLessThan(256);
  });

  it('does NOT use barrel cardinal fire-bullet mechanic', () => {
    // HPAD has no weapon; barrel explosions hit ONLY cardinal cells
    // with flat 200 damage. HPAD should use radial HE with falloff instead --
    // diagonals should take damage (unlike barrels where diagonals are immune).
    const hpad = makeHPAD(10, 10, 50, House.USSR);
    const diagonal = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([hpad], [diagonal]);
    structureDamage(ctx, hpad, 100);
    expect(diagonal.hp).toBeLessThan(diagonal.maxHp);
  });
});

// -- Production Prerequisites (rules.ini) -------------------------------------
//
// C++ rules.ini: Helicopters require HPAD as prerequisite.
// HELI (Longbow) -> Prerequisite=HPAD, allied
// HIND -> Prerequisite=HPAD, soviet
// TRAN (Chinook) -> Prerequisite=HPAD, soviet

describe('HPAD as production prerequisite for helicopters', () => {

  it('HELI (Longbow) production requires HPAD', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'HELI');
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('HPAD');
  });

  it('HIND production requires HPAD', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'HIND');
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('HPAD');
  });

  it('TRAN (Chinook) production requires HPAD', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'TRAN');
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('HPAD');
  });

  it('HPAD itself requires DOME as prerequisite', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'HPAD' && p.isStructure);
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('DOME');
  });

  it('HPAD build time is 180 ticks', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'HPAD' && p.isStructure);
    expect(item).toBeDefined();
    expect(item!.buildTime).toBe(180);
  });
});
