/**
 * C++ Behavioral Parity: TRAN — Chinook Transport Helicopter
 *
 * Tests verify Chinook transport behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with TRAN (observable outcomes: HP, alive/dead,
 * aircraft state, passengers, position changes), not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, PRODUCTION_ITEMS,
  COUNTRY_BONUSES,
  buildDefaultAlliances, armorIndex,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  triggerRetaliation,
} from '../engine/combat';
import {
  type AircraftContext,
  findLandingPad, updateAircraft,
} from '../engine/aircraft';
import { type MapStructure } from '../engine/scenario';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Create an airborne TRAN at the given cell, flight altitude set, state = 'flying' */
function airborneTran(house: House, cx: number, cy: number): Entity {
  const tran = entityAtCell(UnitType.V_TRAN, house, cx, cy);
  tran.aircraftState = 'flying';
  tran.flightAltitude = Entity.FLIGHT_ALTITUDE;
  tran.animState = AnimState.WALK;
  return tran;
}

/** Create a minimal MapStructure for testing */
function makeHPAD(house: House, cx: number, cy: number): MapStructure {
  return {
    type: 'HPAD',
    image: 'hpad',
    house,
    cx, cy,
    hp: 256,
    maxHp: 256,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
  } as MapStructure;
}

function makeCombatCtx(
  entities: Entity[] = [],
): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures: [],
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

// ── Stats Verification (rules.ini parity) ────────────────────────────────────
// C++ udata.cpp (unit type data) — TRAN entry and RULES.INI [TRAN] section

describe('TRAN stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.TRAN;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'TRAN');

  it('HP is 90 (Strength=90)', () => {
    expect(stats.strength).toBe(90);
  });

  it('Armor is light (Armor=light)', () => {
    expect(stats.armor).toBe('light');
  });

  it('Speed is 12 (Speed=12)', () => {
    expect(stats.speed).toBe(12);
  });

  it('isAircraft is true', () => {
    expect(stats.isAircraft).toBe(true);
  });

  it('isRotorEquipped is true (Chinook has twin rotors)', () => {
    expect(stats.isRotorEquipped).toBe(true);
  });

  it('isInfantry is false', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('passengers capacity is 5', () => {
    expect(stats.passengers).toBe(5);
  });

  it('primaryWeapon is null (unarmed transport)', () => {
    expect(stats.primaryWeapon).toBeNull();
  });

  it('landingBuilding is HPAD', () => {
    expect(stats.landingBuilding).toBe('HPAD');
  });

  it('rotation rate is 5', () => {
    expect(stats.rot).toBe(5);
  });

  it('cost is 1200 credits', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(1200);
  });

  it('faction is soviet', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('soviet');
  });

  it('Entity constructor initializes HP to strength', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.hp).toBe(90);
    expect(tran.maxHp).toBe(90);
  });

  it('Entity constructor sets aircraftState to landed', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.aircraftState).toBe('landed');
  });

  it('Entity constructor sets flightAltitude to 0', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.flightAltitude).toBe(0);
  });
});

// ── No Weapon (udata.cpp) ────────────────────────────────────────────────────
// C++ udata.cpp — TRAN has no weapon, is a pure transport helicopter

describe('TRAN no weapon — unarmed transport (udata.cpp)', () => {
  it('Entity weapon is null (no primary weapon)', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.weapon).toBeNull();
  });

  it('Entity weapon2 is null (no secondary weapon)', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.weapon2).toBeNull();
  });

  it('TRAN has no secondaryWeapon stat', () => {
    expect(UNIT_STATS.TRAN.secondaryWeapon).toBeFalsy();
  });

  it('TRAN cannot retaliate when attacked (no weapon)', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    tran.mission = Mission.GUARD;
    tran.target = null;

    const ctx = makeCombatCtx([tran, attacker]);
    triggerRetaliation(ctx, tran, attacker);

    // Unarmed: should not acquire target or switch mission
    expect(tran.target).toBeNull();
    expect(tran.mission).toBe(Mission.GUARD);
  });

  it('TRAN has no maxAmmo (transport, not attack helicopter)', () => {
    expect(UNIT_STATS.TRAN.maxAmmo).toBeFalsy();
  });

  it('Entity ammo is -1 (unlimited / not applicable)', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.ammo).toBe(-1);
  });
});

// ── Helicopter Transport Classification (entity.ts) ──────────────────────────
// C++ aircraft.cpp — TRAN is helicopter (isAircraft=true, NOT isFixedWing), transport (passengers=5)

describe('TRAN helicopter transport classification (entity.ts)', () => {
  it('isAirUnit returns true', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.isAirUnit).toBe(true);
  });

  it('isHelicopter returns true (aircraft but NOT fixed-wing)', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.isHelicopter).toBe(true);
  });

  it('isFixedWing returns false', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.isFixedWing).toBe(false);
  });

  it('isRotorEquipped returns true (rotor overlay)', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.isRotorEquipped).toBe(true);
  });

  it('isTransport returns true (passengers > 0)', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.isTransport).toBe(true);
  });

  it('maxPassengers returns 5', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.maxPassengers).toBe(5);
  });

  it('hasTurret returns false (aircraft have no turret)', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.hasTurret).toBe(false);
  });

  it('isNavalUnit returns false', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.isNavalUnit).toBe(false);
  });

  it('crushable is not set (aircraft cannot be crushed)', () => {
    expect(UNIT_STATS.TRAN.crushable).toBeFalsy();
  });

  it('isFixedWing stat is not set (helicopter, not plane)', () => {
    expect(UNIT_STATS.TRAN.isFixedWing).toBeFalsy();
  });
});

// ── Fragile — 90 HP Light Armor (combat.cpp) ────────────────────────────────
// C++ combat.cpp — TRAN has only 90 HP with light armor, very vulnerable

describe('TRAN fragile — 90 HP light armor (combat.cpp)', () => {
  it('TRAN (90 HP light) is much weaker than HELI (225 HP heavy)', () => {
    expect(UNIT_STATS.TRAN.strength).toBe(90);
    expect(UNIT_STATS.TRAN.armor).toBe('light');
    expect(UNIT_STATS.HELI.strength).toBe(225);
    expect(UNIT_STATS.HELI.armor).toBe('heavy');
  });

  it('SA weapons deal 60% to light armor (SA vs light = 0.6)', () => {
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('light')];
    expect(mult).toBe(0.6);
  });

  it('AP weapons deal 75% to light armor (AP vs light = 0.75)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('light')];
    expect(mult).toBe(0.75);
  });

  it('SA rifle hit deals 9 damage to TRAN (15 * 0.6 = 9)', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    const hpBefore = tran.hp;
    const damage = Math.round(15 * WARHEAD_VS_ARMOR.SA[armorIndex('light')]);
    tran.takeDamage(damage, 'SA');
    expect(hpBefore - tran.hp).toBe(9);
  });

  it('TRAN dies in 10 rifle hits (90 HP / 9 dmg = 10 hits)', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    const damagePerHit = Math.round(15 * WARHEAD_VS_ARMOR.SA[armorIndex('light')]);
    const hitsToKill = Math.ceil(90 / damagePerHit);
    expect(hitsToKill).toBe(10);

    // Apply 9 hits — should still be alive
    for (let i = 0; i < 9; i++) {
      tran.takeDamage(damagePerHit, 'SA');
    }
    expect(tran.alive).toBe(true);
    expect(tran.hp).toBe(90 - 9 * damagePerHit);

    // 10th hit kills
    tran.takeDamage(damagePerHit, 'SA');
    expect(tran.alive).toBe(false);
  });

  it('TRAN is killed when HP reaches 0', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    const killed = tran.takeDamage(90, 'AP');
    expect(killed).toBe(true);
    expect(tran.alive).toBe(false);
    expect(tran.hp).toBe(0);
    expect(tran.mission).toBe(Mission.DIE);
  });
});

// ── Passengers Killed On Death (techno.cpp) ──────────────────────────────────
// C++ techno.cpp — when a transport is destroyed, all passengers inside are killed

describe('TRAN passengers killed on death (techno.cpp)', () => {
  it('passengers die when TRAN is destroyed', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    const p1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const p2 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const p3 = entityAtCell(UnitType.I_E3, House.USSR, 10, 10);

    // Load passengers into transport
    tran.passengers.push(p1, p2, p3);
    p1.transportRef = tran;
    p2.transportRef = tran;
    p3.transportRef = tran;

    expect(p1.alive).toBe(true);
    expect(p2.alive).toBe(true);
    expect(p3.alive).toBe(true);

    // Kill the transport
    tran.takeDamage(90, 'AP');
    expect(tran.alive).toBe(false);

    // All passengers should be dead
    expect(p1.alive).toBe(false);
    expect(p2.alive).toBe(false);
    expect(p3.alive).toBe(false);
    expect(p1.mission).toBe(Mission.DIE);
    expect(p2.mission).toBe(Mission.DIE);
    expect(p3.mission).toBe(Mission.DIE);
  });

  it('passenger transportRef is cleared on death', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    const p1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);

    tran.passengers.push(p1);
    p1.transportRef = tran;
    expect(p1.transportRef).toBe(tran);

    tran.takeDamage(90, 'AP');

    expect(p1.transportRef).toBeNull();
  });

  it('passenger list is emptied after transport death', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    const p1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const p2 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);

    tran.passengers.push(p1, p2);
    p1.transportRef = tran;
    p2.transportRef = tran;

    tran.takeDamage(90, 'AP');

    expect(tran.passengers).toHaveLength(0);
  });

  it('full capacity (5 passengers) all die on transport death', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    const passengers: Entity[] = [];

    for (let i = 0; i < 5; i++) {
      const p = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
      passengers.push(p);
      tran.passengers.push(p);
      p.transportRef = tran;
    }

    // All alive
    passengers.forEach(p => expect(p.alive).toBe(true));

    tran.takeDamage(90, 'AP');

    // All dead
    passengers.forEach(p => {
      expect(p.alive).toBe(false);
      expect(p.mission).toBe(Mission.DIE);
      expect(p.transportRef).toBeNull();
    });
    expect(tran.passengers).toHaveLength(0);
  });

  it('empty TRAN dies cleanly with no passengers to kill', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.passengers).toHaveLength(0);

    const killed = tran.takeDamage(90, 'AP');

    expect(killed).toBe(true);
    expect(tran.alive).toBe(false);
    expect(tran.passengers).toHaveLength(0);
  });

  it('TRAN that survives damage does not kill passengers', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    const p1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);

    tran.passengers.push(p1);
    p1.transportRef = tran;

    // Non-lethal damage
    tran.takeDamage(50, 'SA');

    expect(tran.alive).toBe(true);
    expect(p1.alive).toBe(true);
    expect(tran.passengers).toHaveLength(1);
    expect(p1.transportRef).toBe(tran);
  });
});

// ── HPAD Landing (aircraft.cpp) ──────────────────────────────────────────────
// C++ aircraft.cpp — TRAN uses HPAD (helipad), not AFLD (airfield)

describe('TRAN HPAD landing (aircraft.cpp)', () => {
  it('finds HPAD for TRAN (not AFLD)', () => {
    const tran = airborneTran(House.USSR, 10, 10);
    const hpad = makeHPAD(House.USSR, 12, 10);
    const afld = {
      type: 'AFLD', image: 'afld', house: House.USSR,
      cx: 8, cy: 10, hp: 256, maxHp: 256, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    } as MapStructure;

    const ctx = makeAircraftCtx([tran], [afld, hpad]);
    const padIdx = findLandingPad(ctx, tran);

    expect(padIdx).toBe(1); // hpad is index 1, afld is index 0
  });

  it('does not land at enemy HPAD', () => {
    const tran = airborneTran(House.USSR, 10, 10);
    const enemyPad = makeHPAD(House.Spain, 12, 10);

    const ctx = makeAircraftCtx([tran], [enemyPad]);
    const padIdx = findLandingPad(ctx, tran);

    expect(padIdx).toBe(-1); // no friendly pad found
  });

  it('picks closest HPAD when multiple are available', () => {
    const tran = airborneTran(House.USSR, 10, 10);
    const farPad = makeHPAD(House.USSR, 20, 10);
    const nearPad = makeHPAD(House.USSR, 12, 10);

    const ctx = makeAircraftCtx([tran], [farPad, nearPad]);
    const padIdx = findLandingPad(ctx, tran);

    expect(padIdx).toBe(1); // nearPad is closer
  });
});

// ── Aircraft State Machine (aircraft.cpp) ────────────────────────────────────
// C++ aircraft.cpp — landed → takeoff → flying → returning → landing → landed

describe('TRAN aircraft state machine (aircraft.cpp)', () => {
  it('takeoff ascends 1px/tick until flight altitude', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    tran.aircraftState = 'takeoff';
    tran.mission = Mission.MOVE;
    tran.moveTarget = { x: 15 * CELL_SIZE, y: 10 * CELL_SIZE };
    tran.flightAltitude = 0;

    const ctx = makeAircraftCtx([tran]);
    updateAircraft(ctx, tran);

    expect(tran.flightAltitude).toBe(1);
    expect(tran.animState).toBe(AnimState.WALK);
  });

  it('takeoff completes at FLIGHT_ALTITUDE (24)', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    tran.aircraftState = 'takeoff';
    tran.mission = Mission.MOVE;
    tran.moveTarget = { x: 15 * CELL_SIZE, y: 10 * CELL_SIZE };
    tran.flightAltitude = Entity.FLIGHT_ALTITUDE - 1;

    const ctx = makeAircraftCtx([tran]);
    updateAircraft(ctx, tran);

    expect(tran.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
    expect(tran.aircraftState).toBe('flying');
  });

  it('landing descends 1px/tick', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    tran.aircraftState = 'landing';
    tran.flightAltitude = 5;

    const ctx = makeAircraftCtx([tran]);
    updateAircraft(ctx, tran);

    expect(tran.flightAltitude).toBe(4);
  });

  it('FLIGHT_ALTITUDE constant is 24', () => {
    expect(Entity.FLIGHT_ALTITUDE).toBe(24);
  });
});

// ── Movement — Aircraft Skip Rotation-Before-Move (entity.ts) ────────────────
// C++ aircraft.cpp / entity.ts — aircraft always move forward, never stop to rotate

describe('TRAN movement — aircraft rotation (entity.ts)', () => {
  it('TRAN moves while rotating (aircraft do not stop to rotate)', () => {
    const tran = airborneTran(House.USSR, 10, 10);
    tran.facing = Dir.N;
    tran.desiredFacing = Dir.N;
    tran.bodyFacing32 = Dir.N * 4;

    const startX = tran.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: tran.pos.y }; // due East

    const arrived = tran.moveToward(targetPos, tran.stats.speed);

    // Aircraft should move even while facing is misaligned
    expect(tran.pos.x).toBeGreaterThan(startX);
  });

  it('TRAN rot=5 does NOT snap facing instantly (unlike infantry rot>=8)', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.stats.rot).toBe(5);
    expect(tran.stats.rot).toBeLessThan(8);

    // Set facing N, desired S — should not snap instantly
    tran.facing = Dir.N;
    tran.desiredFacing = Dir.S;
    tran.bodyFacing32 = Dir.N * 4;
    const aligned = tran.tickRotation();
    expect(aligned).toBe(false); // needs multiple ticks
  });

  it('TRAN speed matches HIND (both speed 12)', () => {
    expect(UNIT_STATS.TRAN.speed).toBe(12);
    expect(UNIT_STATS.HIND.speed).toBe(12);
  });
});

// ── TRAN vs Other Helicopters (udata.cpp) ────────────────────────────────────
// C++ udata.cpp — comparison with other helicopter types

describe('TRAN vs other helicopters (udata.cpp)', () => {
  const tran = UNIT_STATS.TRAN;
  const heli = UNIT_STATS.HELI;
  const hind = UNIT_STATS.HIND;

  it('TRAN is weakest helicopter (90 HP vs 225 HP for HELI/HIND)', () => {
    expect(tran.strength).toBe(90);
    expect(heli.strength).toBe(225);
    expect(hind.strength).toBe(225);
    expect(tran.strength).toBeLessThan(heli.strength);
  });

  it('TRAN has light armor vs heavy for combat helis', () => {
    expect(tran.armor).toBe('light');
    expect(heli.armor).toBe('heavy');
    expect(hind.armor).toBe('heavy');
  });

  it('TRAN is sole helicopter with transport capability', () => {
    expect(tran.passengers).toBe(5);
    expect(heli.passengers).toBeFalsy();
    expect(hind.passengers).toBeFalsy();
  });

  it('TRAN is sole helicopter without a weapon', () => {
    expect(tran.primaryWeapon).toBeNull();
    expect(heli.primaryWeapon).toBe('Hellfire');
    expect(hind.primaryWeapon).toBe('ChainGun');
  });

  it('all three are helicopters (isAircraft=true, isRotorEquipped=true, no isFixedWing)', () => {
    for (const s of [tran, heli, hind]) {
      expect(s.isAircraft).toBe(true);
      expect(s.isRotorEquipped).toBe(true);
      expect(s.isFixedWing).toBeFalsy();
    }
  });

  it('all three land at HPAD', () => {
    expect(tran.landingBuilding).toBe('HPAD');
    expect(heli.landingBuilding).toBe('HPAD');
    expect(hind.landingBuilding).toBe('HPAD');
  });
});

// ── TRAN vs APC Transport Comparison (udata.cpp) ────────────────────────────
// C++ udata.cpp — TRAN (air transport) vs APC (ground transport)

describe('TRAN vs APC transport comparison (udata.cpp)', () => {
  it('both are transports with 5 passenger capacity', () => {
    expect(UNIT_STATS.TRAN.passengers).toBe(5);
    expect(UNIT_STATS.APC.passengers).toBe(5);
  });

  it('TRAN is aircraft, APC is ground vehicle', () => {
    expect(UNIT_STATS.TRAN.isAircraft).toBe(true);
    expect(UNIT_STATS.APC.isAircraft).toBeFalsy();
  });

  it('both kill passengers on death', () => {
    // Test TRAN
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    const tranPassenger = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    tran.passengers.push(tranPassenger);
    tranPassenger.transportRef = tran;
    tran.takeDamage(90, 'AP');
    expect(tranPassenger.alive).toBe(false);

    // Test APC
    const apc = entityAtCell(UnitType.V_APC, House.USSR, 10, 10);
    const apcPassenger = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    apc.passengers.push(apcPassenger);
    apcPassenger.transportRef = apc;
    apc.takeDamage(apc.maxHp, 'AP');
    expect(apcPassenger.alive).toBe(false);
  });
});

// ── Not Fixed-Wing (udata.cpp) ───────────────────────────────────────────────
// C++ udata.cpp — TRAN is helicopter, NOT fixed-wing like MIG/YAK/BADR

describe('TRAN is NOT fixed-wing (udata.cpp)', () => {
  it('TRAN isFixedWing is false (helicopter can hover)', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.isFixedWing).toBe(false);
  });

  it('MIG isFixedWing is true (contrast with TRAN)', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    expect(mig.isFixedWing).toBe(true);
    expect(mig.isHelicopter).toBe(false);
  });

  it('YAK isFixedWing is true (contrast with TRAN)', () => {
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 10, 10);
    expect(yak.isFixedWing).toBe(true);
    expect(yak.isHelicopter).toBe(false);
  });

  it('TRAN isHelicopter is true, MIG isHelicopter is false', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    expect(tran.isHelicopter).toBe(true);
    expect(mig.isHelicopter).toBe(false);
  });
});
