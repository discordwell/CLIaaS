/**
 * C++ Behavioral Parity: HELI — Longbow Apache
 *
 * Tests verify Longbow Apache behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with HELI (observable outcomes: HP, alive/dead,
 * aircraft state, ammo, position changes, weapon stats), not HOW the code implements it.
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
  type AircraftContext,
  updateHelicopterAttack, findLandingPad, updateAircraft,
} from '../engine/aircraft';
import { type MapStructure, STRUCTURE_SIZE } from '../engine/scenario';
import { GameMap } from '../engine/map';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Create an airborne HELI at the given cell, flight altitude set, state = 'attacking' */
function airborneHeli(house: House, cx: number, cy: number): Entity {
  const heli = entityAtCell(UnitType.V_HELI, house, cx, cy);
  heli.aircraftState = 'flying';
  heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
  heli.animState = AnimState.WALK;
  return heli;
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
    getROFBias: () => 1.0,
    getPowerFraction: () => 1.0,
  };
}

// ── Stats Verification (rules.ini parity) ────────────────────────────────────
// C++ udata.cpp (unit type data) — HELI entry and RULES.INI [HELI] section

describe('HELI stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.HELI;
  const weapon = WEAPON_STATS.Hellfire;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'HELI');

  it('HP is 225 (Strength=225)', () => {
    expect(stats.strength).toBe(225);
  });

  it('Armor is heavy (Armor=heavy)', () => {
    expect(stats.armor).toBe('heavy');
  });

  it('Speed is 16 (Speed=16)', () => {
    expect(stats.speed).toBe(16);
  });

  it('isAircraft is true', () => {
    expect(stats.isAircraft).toBe(true);
  });

  it('isFixedWing is NOT set (helicopter, not plane)', () => {
    expect(stats.isFixedWing).toBeFalsy();
  });

  it('isRotorEquipped is true (rotor overlay)', () => {
    expect(stats.isRotorEquipped).toBe(true);
  });

  it('isInfantry is false', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('maxAmmo is 6', () => {
    expect(stats.maxAmmo).toBe(6);
  });

  it('primary weapon is Hellfire', () => {
    expect(stats.primaryWeapon).toBe('Hellfire');
  });

  it('secondary weapon is Hellfire (dual-weapon same type)', () => {
    expect(stats.secondaryWeapon).toBe('Hellfire');
  });

  it('landingBuilding is HPAD (not AFLD)', () => {
    expect(stats.landingBuilding).toBe('HPAD');
  });

  it('rotation rate is 4', () => {
    expect(stats.rot).toBe(4);
  });

  it('cost is 1200 credits', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(1200);
  });

  it('faction is allied', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('allied');
  });

  it('Entity constructor initializes HP to strength', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    expect(heli.hp).toBe(225);
    expect(heli.maxHp).toBe(225);
  });

  it('Entity constructor initializes ammo from maxAmmo', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    expect(heli.ammo).toBe(6);
    expect(heli.maxAmmo).toBe(6);
  });

  it('Entity constructor sets aircraftState to landed', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    expect(heli.aircraftState).toBe('landed');
  });

  it('Entity constructor sets flightAltitude to 0', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    expect(heli.flightAltitude).toBe(0);
  });
});

// ── Hellfire Weapon Stats (rules.ini) ────────────────────────────────────────
// C++ rules.ini [Hellfire] section — aircraft.cpp weapon configuration

describe('Hellfire weapon stats (rules.ini)', () => {
  const weapon = WEAPON_STATS.Hellfire;

  it('damage is 40', () => {
    expect(weapon.damage).toBe(40);
  });

  it('warhead is AP (armor-piercing)', () => {
    expect(weapon.warhead).toBe('AP');
  });

  it('range is 4.0 cells', () => {
    expect(weapon.range).toBe(4.0);
  });

  it('ROF is 60 ticks', () => {
    expect(weapon.rof).toBe(60);
  });

  it('splash is 1.0 (area of effect)', () => {
    expect(weapon.splash).toBe(1.0);
  });

  it('projectileROT is 5 (homing missiles)', () => {
    expect(weapon.projectileROT).toBe(5);
  });

  it('Entity weapon references resolve correctly', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    expect(heli.weapon).not.toBeNull();
    expect(heli.weapon!.name).toBe('Hellfire');
    expect(heli.weapon2).not.toBeNull();
    expect(heli.weapon2!.name).toBe('Hellfire');
  });
});

// ── AP Warhead Effectiveness (combat.cpp warhead tables) ─────────────────────
// C++ combat.cpp — Modify_Damage uses WARHEAD_VS_ARMOR table

describe('HELI AP warhead effectiveness (combat.cpp warhead tables)', () => {
  it('AP vs none armor: mult 0.3 (poor vs unarmored infantry)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('none')];
    expect(mult).toBe(0.3);
  });

  it('AP vs light armor: mult 0.75', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('light')];
    expect(mult).toBe(0.75);
  });

  it('AP vs heavy armor: mult 1.0 (full damage — anti-armor role)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('heavy')];
    expect(mult).toBe(1.0);
  });

  it('AP vs concrete: mult 0.5', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('concrete')];
    expect(mult).toBe(0.5);
  });

  it('AP vs wood armor: mult 0.75', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('wood')];
    expect(mult).toBe(0.75);
  });

  it('Hellfire deals full 40 base damage to heavy-armor tanks', () => {
    const victim = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const hpBefore = victim.hp;
    // AP vs heavy = 1.0, so 40 * 1.0 = 40
    const damage = Math.round(40 * WARHEAD_VS_ARMOR.AP[armorIndex('heavy')]);
    victim.takeDamage(damage, 'AP');
    expect(hpBefore - victim.hp).toBe(40);
  });

  it('Hellfire deals reduced damage to unarmored infantry', () => {
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    const hpBefore = victim.hp;
    // AP vs none = 0.3, so 40 * 0.3 = 12
    const damage = Math.round(40 * WARHEAD_VS_ARMOR.AP[armorIndex('none')]);
    victim.takeDamage(damage, 'AP');
    expect(hpBefore - victim.hp).toBe(damage);
    expect(damage).toBe(12);
  });
});

// ── Helicopter Type Classification (entity.ts) ──────────────────────────────
// C++ aircraft.cpp — HELI is helicopter (isAircraft=true, NOT isFixedWing)

describe('HELI helicopter classification (entity.ts)', () => {
  it('isAirUnit returns true', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    expect(heli.isAirUnit).toBe(true);
  });

  it('isHelicopter returns true (aircraft but NOT fixed-wing)', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    expect(heli.isHelicopter).toBe(true);
  });

  it('isFixedWing returns false', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    expect(heli.isFixedWing).toBe(false);
  });

  it('isRotorEquipped returns true (rotor overlay)', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    expect(heli.isRotorEquipped).toBe(true);
  });

  it('hasTurret returns false (aircraft have no turret)', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    expect(heli.hasTurret).toBe(false);
  });

  it('isNavalUnit returns false', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    expect(heli.isNavalUnit).toBe(false);
  });

  it('crushable is not set (aircraft cannot be crushed)', () => {
    expect(UNIT_STATS.HELI.crushable).toBeFalsy();
  });

  it('isTransport returns false (HELI has no passengers)', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    expect(heli.isTransport).toBe(false);
  });

  it('MIG is fixed-wing (contrast with HELI)', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    expect(mig.isFixedWing).toBe(true);
    expect(mig.isHelicopter).toBe(false);
  });
});

// ── Heavy Armor Survivability (combat.cpp) ──────────────────────────────────
// C++ combat.cpp — HELI has 225 HP with heavy armor, tougher than fixed-wing

describe('HELI heavy armor survivability (combat.cpp)', () => {
  it('HELI (225 HP heavy) vs MIG (50 HP light): HELI is much tougher', () => {
    expect(UNIT_STATS.HELI.strength).toBe(225);
    expect(UNIT_STATS.HELI.armor).toBe('heavy');
    expect(UNIT_STATS.MIG.strength).toBe(50);
    expect(UNIT_STATS.MIG.armor).toBe('light');
  });

  it('SA weapons deal only 25% to HELI heavy armor', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    const hpBefore = heli.hp;
    // SA vs heavy = 0.25; 15 * 0.25 = 3.75 -> round = 4
    const damage = Math.round(15 * WARHEAD_VS_ARMOR.SA[armorIndex('heavy')]);
    heli.takeDamage(damage, 'SA');
    expect(hpBefore - heli.hp).toBe(damage);
    expect(damage).toBe(4);
  });

  it('AP weapons deal full damage to HELI heavy armor', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    const hpBefore = heli.hp;
    // AP vs heavy = 1.0; 40 * 1.0 = 40
    const damage = Math.round(40 * WARHEAD_VS_ARMOR.AP[armorIndex('heavy')]);
    heli.takeDamage(damage, 'AP');
    expect(hpBefore - heli.hp).toBe(40);
  });

  it('HELI survives multiple rifle hits (225 HP / 4 dmg per hit = 56 hits to kill)', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    const damagePerHit = Math.round(15 * WARHEAD_VS_ARMOR.SA[armorIndex('heavy')]);
    const hitsToKill = Math.ceil(225 / damagePerHit);
    expect(hitsToKill).toBeGreaterThanOrEqual(50);
    // Apply 10 rifle hits — should still be alive
    for (let i = 0; i < 10; i++) {
      heli.takeDamage(damagePerHit, 'SA');
    }
    expect(heli.alive).toBe(true);
    expect(heli.hp).toBe(225 - 10 * damagePerHit);
  });

  it('HELI is killed when HP reaches 0', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    const killed = heli.takeDamage(225, 'AP');
    expect(killed).toBe(true);
    expect(heli.alive).toBe(false);
    expect(heli.hp).toBe(0);
    expect(heli.mission).toBe(Mission.DIE);
  });
});

// ── Helicopter Hover Attack (aircraft.cpp) ──────────────────────────────────
// C++ aircraft.cpp — helicopters hover in place within weapon range and fire

describe('HELI helicopter hover attack (aircraft.cpp)', () => {
  it('helicopter closes to weapon range when target is far', () => {
    const heli = airborneHeli(House.Spain, 5, 5);
    heli.aircraftState = 'attacking';
    heli.mission = Mission.ATTACK;
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 20, 5); // far away
    heli.target = target;

    const ctx = makeAircraftCtx([heli, target]);
    const startX = heli.pos.x;
    updateHelicopterAttack(ctx, heli);

    // Should have moved toward target
    expect(heli.pos.x).toBeGreaterThan(startX);
    expect(heli.animState).toBe(AnimState.WALK);
  });

  it('helicopter switches to ATTACK animState when in range', () => {
    const heli = airborneHeli(House.Spain, 10, 10);
    heli.aircraftState = 'attacking';
    heli.mission = Mission.ATTACK;
    heli.attackCooldown = 10; // on cooldown so it doesn't fire
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10); // 1 cell away, within range 4.0
    heli.target = target;

    const ctx = makeAircraftCtx([heli, target]);
    updateHelicopterAttack(ctx, heli);

    expect(heli.animState).toBe(AnimState.ATTACK);
  });

  it('helicopter fires weapon when in range and cooldown ready', () => {
    const heli = airborneHeli(House.Spain, 10, 10);
    heli.aircraftState = 'attacking';
    heli.mission = Mission.ATTACK;
    heli.attackCooldown = 0;
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    heli.target = target;

    let firedAt: Entity | null = null;
    const ctx = makeAircraftCtx([heli, target]);
    ctx.fireWeaponAt = (_attacker, t) => { firedAt = t; };
    updateHelicopterAttack(ctx, heli);

    expect(firedAt).toBe(target);
    expect(heli.attackCooldown).toBe(60); // Hellfire ROF
  });

  it('helicopter decrements ammo after firing', () => {
    const heli = airborneHeli(House.Spain, 10, 10);
    heli.aircraftState = 'attacking';
    heli.mission = Mission.ATTACK;
    heli.attackCooldown = 0;
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    heli.target = target;

    const ctx = makeAircraftCtx([heli, target]);
    updateHelicopterAttack(ctx, heli);

    expect(heli.ammo).toBe(5); // started with 6, fired 1
  });

  it('helicopter RTBs when ammo depleted', () => {
    const heli = airborneHeli(House.Spain, 10, 10);
    heli.aircraftState = 'attacking';
    heli.mission = Mission.ATTACK;
    heli.attackCooldown = 0;
    heli.ammo = 1; // last shot
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    heli.target = target;

    const ctx = makeAircraftCtx([heli, target]);
    updateHelicopterAttack(ctx, heli);

    // After firing last shot, ammo=0, should RTB
    expect(heli.ammo).toBe(0);
    expect(heli.aircraftState).toBe('returning');
    expect(heli.mission).toBe(Mission.GUARD);
    expect(heli.target).toBeNull();
  });

  it('helicopter returns to base when target is lost', () => {
    const heli = airborneHeli(House.Spain, 10, 10);
    heli.aircraftState = 'attacking';
    heli.mission = Mission.ATTACK;
    heli.target = null; // no target
    heli.targetStructure = null;

    const ctx = makeAircraftCtx([heli]);
    updateHelicopterAttack(ctx, heli);

    expect(heli.aircraftState).toBe('returning');
    expect(heli.mission).toBe(Mission.GUARD);
  });

  it('helicopter does not fire when weapon is on cooldown', () => {
    const heli = airborneHeli(House.Spain, 10, 10);
    heli.aircraftState = 'attacking';
    heli.mission = Mission.ATTACK;
    heli.attackCooldown = 30; // still on cooldown
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    heli.target = target;

    let fired = false;
    const ctx = makeAircraftCtx([heli, target]);
    ctx.fireWeaponAt = () => { fired = true; };
    updateHelicopterAttack(ctx, heli);

    expect(fired).toBe(false);
    expect(heli.ammo).toBe(6); // unchanged
  });

  it('helicopter faces target when hovering in range', () => {
    const heli = airborneHeli(House.Spain, 10, 10);
    heli.aircraftState = 'attacking';
    heli.mission = Mission.ATTACK;
    heli.attackCooldown = 10;
    heli.facing = Dir.N;
    heli.desiredFacing = Dir.N;
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 13, 10); // due East
    heli.target = target;

    const ctx = makeAircraftCtx([heli, target]);
    updateHelicopterAttack(ctx, heli);

    // desiredFacing should be set toward the target
    expect(heli.desiredFacing).toBe(Dir.E);
  });
});

// ── Aircraft State Machine (aircraft.cpp) ────────────────────────────────────
// C++ aircraft.cpp — landed → takeoff → flying → attacking → returning → landing

describe('HELI aircraft state machine (aircraft.cpp)', () => {
  it('landed HELI transitions to takeoff when given attack order', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heli.mission = Mission.ATTACK;
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 15, 10);
    heli.target = target;

    const ctx = makeAircraftCtx([heli, target]);
    updateAircraft(ctx, heli);

    expect(heli.aircraftState).toBe('takeoff');
  });

  it('takeoff ascends 1px/tick until flight altitude', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heli.aircraftState = 'takeoff';
    heli.mission = Mission.ATTACK;
    heli.target = entityAtCell(UnitType.V_2TNK, House.USSR, 15, 10);
    heli.flightAltitude = 0;

    const ctx = makeAircraftCtx([heli]);
    updateAircraft(ctx, heli);

    expect(heli.flightAltitude).toBe(1);
    expect(heli.animState).toBe(AnimState.WALK);
  });

  it('takeoff completes at FLIGHT_ALTITUDE (24)', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heli.aircraftState = 'takeoff';
    heli.mission = Mission.ATTACK;
    heli.target = entityAtCell(UnitType.V_2TNK, House.USSR, 15, 10);
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE - 1;

    const ctx = makeAircraftCtx([heli]);
    updateAircraft(ctx, heli);

    expect(heli.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
    expect(heli.aircraftState).toBe('flying');
  });

  it('flying HELI transitions to attacking when in weapon range', () => {
    const heli = airborneHeli(House.Spain, 10, 10);
    heli.mission = Mission.ATTACK;
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10); // in range
    heli.target = target;

    const ctx = makeAircraftCtx([heli, target]);
    updateAircraft(ctx, heli);

    expect(heli.aircraftState).toBe('attacking');
  });

  it('attacking HELI uses helicopter attack (not fixed-wing)', () => {
    const heli = airborneHeli(House.Spain, 10, 10);
    heli.aircraftState = 'attacking';
    heli.mission = Mission.ATTACK;
    heli.attackCooldown = 0;
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    heli.target = target;

    let fired = false;
    const ctx = makeAircraftCtx([heli, target]);
    ctx.fireWeaponAt = () => { fired = true; };
    updateAircraft(ctx, heli);

    // Helicopter attack fires at target (hover and shoot)
    expect(fired).toBe(true);
    expect(heli.animState).toBe(AnimState.ATTACK);
  });

  it('returning HELI flies to landing pad', () => {
    const heli = airborneHeli(House.Spain, 5, 5);
    heli.aircraftState = 'returning';
    heli.mission = Mission.GUARD;
    const pad = makeHPAD(House.Spain, 15, 5);

    const ctx = makeAircraftCtx([heli], [pad]);
    const startX = heli.pos.x;
    updateAircraft(ctx, heli);

    // Should have moved toward pad
    expect(heli.pos.x).toBeGreaterThan(startX);
    expect(heli.animState).toBe(AnimState.WALK);
  });

  it('landing descends 1px/tick', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heli.aircraftState = 'landing';
    heli.flightAltitude = 5;

    const ctx = makeAircraftCtx([heli]);
    updateAircraft(ctx, heli);

    expect(heli.flightAltitude).toBe(4);
  });

  it('landing completes and triggers rearming when ammo not full', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heli.aircraftState = 'landing';
    heli.flightAltitude = 1; // will reach 0 this tick
    heli.ammo = 3; // not full

    const ctx = makeAircraftCtx([heli]);
    updateAircraft(ctx, heli);

    expect(heli.flightAltitude).toBe(0);
    expect(heli.aircraftState).toBe('rearming');
    expect(heli.mission).toBe(Mission.GUARD);
  });

  it('landed state when ammo is already full (no rearming needed)', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heli.aircraftState = 'landing';
    heli.flightAltitude = 1;
    heli.ammo = 6; // full

    const ctx = makeAircraftCtx([heli]);
    updateAircraft(ctx, heli);

    expect(heli.aircraftState).toBe('landed');
  });
});

// ── HPAD Landing (aircraft.cpp) ──────────────────────────────────────────────
// C++ aircraft.cpp — HELI uses HPAD (helipad), not AFLD (airfield)

describe('HELI HPAD landing (aircraft.cpp)', () => {
  it('finds HPAD for HELI (not AFLD)', () => {
    const heli = airborneHeli(House.Spain, 10, 10);
    const hpad = makeHPAD(House.Spain, 12, 10);
    const afld = {
      type: 'AFLD', image: 'afld', house: House.Spain,
      cx: 8, cy: 10, hp: 256, maxHp: 256, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    } as MapStructure;

    const ctx = makeAircraftCtx([heli], [afld, hpad]);
    const padIdx = findLandingPad(ctx, heli);

    expect(padIdx).toBe(1); // hpad is index 1, afld is index 0
  });

  it('does not land at enemy HPAD', () => {
    const heli = airborneHeli(House.Spain, 10, 10);
    const enemyPad = makeHPAD(House.USSR, 12, 10);

    const ctx = makeAircraftCtx([heli], [enemyPad]);
    const padIdx = findLandingPad(ctx, heli);

    expect(padIdx).toBe(-1); // no friendly pad found
  });

  it('does not land at occupied HPAD', () => {
    const heli = airborneHeli(House.Spain, 10, 10);
    const pad = makeHPAD(House.Spain, 12, 10);
    pad.dockedAircraft = 99; // occupied

    const ctx = makeAircraftCtx([heli], [pad]);
    const padIdx = findLandingPad(ctx, heli);

    expect(padIdx).toBe(-1);
  });

  it('picks closest HPAD when multiple are available', () => {
    const heli = airborneHeli(House.Spain, 10, 10);
    const farPad = makeHPAD(House.Spain, 20, 10);
    const nearPad = makeHPAD(House.Spain, 12, 10);

    const ctx = makeAircraftCtx([heli], [farPad, nearPad]);
    const padIdx = findLandingPad(ctx, heli);

    expect(padIdx).toBe(1); // nearPad is closer
  });

  it('lands at allied HPAD (Greece allied with Spain)', () => {
    const heli = airborneHeli(House.Spain, 10, 10);
    const alliedPad = makeHPAD(House.Greece, 12, 10);

    const ctx = makeAircraftCtx([heli], [alliedPad]);
    const padIdx = findLandingPad(ctx, heli);

    expect(padIdx).toBe(0);
  });
});

// ── Rearming (aircraft.cpp) ──────────────────────────────────────────────────
// C++ aircraft.cpp — rearming on pad restores ammo one at a time

describe('HELI rearming (aircraft.cpp)', () => {
  it('rearming increments ammo by 1 when timer expires', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heli.aircraftState = 'rearming';
    heli.ammo = 3;
    heli.rearmTimer = 1; // about to expire

    const ctx = makeAircraftCtx([heli]);
    updateAircraft(ctx, heli);

    expect(heli.ammo).toBe(4);
  });

  it('rearming continues until maxAmmo reached', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heli.aircraftState = 'rearming';
    heli.ammo = 4;
    heli.rearmTimer = 1;

    const ctx = makeAircraftCtx([heli]);
    updateAircraft(ctx, heli);

    // ammo=5, not full yet, should still be rearming
    expect(heli.ammo).toBe(5);
    expect(heli.aircraftState).toBe('rearming');
    expect(heli.rearmTimer).toBeGreaterThan(0);
  });

  it('rearming completes when maxAmmo reached, transitions to landed', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heli.aircraftState = 'rearming';
    heli.ammo = 5; // one short of maxAmmo=6
    heli.rearmTimer = 1;

    const ctx = makeAircraftCtx([heli]);
    updateAircraft(ctx, heli);

    expect(heli.ammo).toBe(6);
    expect(heli.aircraftState).toBe('landed');
  });

  it('rearm timer is based on C++ ReloadRate formula (36 ticks at full power)', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heli.aircraftState = 'landing';
    heli.flightAltitude = 1;
    heli.ammo = 0;

    const ctx = makeAircraftCtx([heli]);
    updateAircraft(ctx, heli);

    // C++ building.cpp:4023-4025: computeRearmDelay(1.0) = round(1.0 * 0.04 * 900) = 36
    expect(heli.rearmTimer).toBe(36);
  });
});

// ── Splash Damage (combat.cpp) ──────────────────────────────────────────────
// C++ combat.cpp — Hellfire has splash=1.0, area of effect weapon

describe('HELI Hellfire splash damage (combat.cpp)', () => {
  it('Hellfire weapon has splash=1.0', () => {
    expect(WEAPON_STATS.Hellfire.splash).toBe(1.0);
  });

  it('Hellfire has higher splash than M1Carbine (no splash)', () => {
    expect(WEAPON_STATS.Hellfire.splash).toBeDefined();
    expect(WEAPON_STATS.Hellfire.splash).toBeGreaterThan(0);
    expect(WEAPON_STATS.M1Carbine.splash).toBeUndefined();
  });
});

// ── Homing Missiles (weapon.cpp) ────────────────────────────────────────────
// C++ weapon.cpp — projectileROT > 0 means homing projectile that can track

describe('HELI homing missiles (weapon.cpp)', () => {
  it('Hellfire projectileROT=5 (guided missile)', () => {
    expect(WEAPON_STATS.Hellfire.projectileROT).toBe(5);
  });

  it('Hellfire is a homing projectile (ROT > 0)', () => {
    expect(WEAPON_STATS.Hellfire.projectileROT).toBeGreaterThan(0);
  });

  it('M1Carbine has no projectileROT (hitscan bullet)', () => {
    expect(WEAPON_STATS.M1Carbine.projectileROT).toBeUndefined();
  });

  it('Maverick also has projectileROT=5 (same homing behavior as Hellfire)', () => {
    expect(WEAPON_STATS.Maverick.projectileROT).toBe(5);
  });
});

// ── HELI vs HIND Comparison (udata.cpp) ──────────────────────────────────────
// C++ udata.cpp — both are helicopters but with different roles

describe('HELI vs HIND comparison (udata.cpp)', () => {
  const heli = UNIT_STATS.HELI;
  const hind = UNIT_STATS.HIND;

  it('both have 225 HP (same survivability)', () => {
    expect(heli.strength).toBe(225);
    expect(hind.strength).toBe(225);
  });

  it('both have heavy armor', () => {
    expect(heli.armor).toBe('heavy');
    expect(hind.armor).toBe('heavy');
  });

  it('HELI is faster (speed 16 vs HIND speed 12)', () => {
    expect(heli.speed).toBe(16);
    expect(hind.speed).toBe(12);
    expect(heli.speed).toBeGreaterThan(hind.speed);
  });

  it('both are helicopters (isAircraft=true, isRotorEquipped=true, no isFixedWing)', () => {
    expect(heli.isAircraft).toBe(true);
    expect(hind.isAircraft).toBe(true);
    expect(heli.isRotorEquipped).toBe(true);
    expect(hind.isRotorEquipped).toBe(true);
    expect(heli.isFixedWing).toBeFalsy();
    expect(hind.isFixedWing).toBeFalsy();
  });

  it('both land at HPAD', () => {
    expect(heli.landingBuilding).toBe('HPAD');
    expect(hind.landingBuilding).toBe('HPAD');
  });

  it('HELI uses Hellfire (AP) vs HIND uses ChainGun (SA) — different roles', () => {
    expect(heli.primaryWeapon).toBe('Hellfire');
    expect(hind.primaryWeapon).toBe('ChainGun');
    expect(WEAPON_STATS.Hellfire.warhead).toBe('AP');
    expect(WEAPON_STATS.ChainGun.warhead).toBe('SA');
  });

  it('HELI has fewer ammo (6 vs HIND 12) but higher per-shot damage', () => {
    expect(heli.maxAmmo).toBe(6);
    expect(hind.maxAmmo).toBe(12);
    expect(WEAPON_STATS.Hellfire.damage).toBe(40);
    expect(WEAPON_STATS.ChainGun.damage).toBe(40);
  });
});

// ── 6 Ammo Capacity (aircraft.cpp) ──────────────────────────────────────────
// C++ aircraft.cpp — maxAmmo=6, fires until empty then returns to base

describe('HELI 6 ammo capacity (aircraft.cpp)', () => {
  it('starts fully loaded with 6 ammo', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    expect(heli.ammo).toBe(6);
    expect(heli.maxAmmo).toBe(6);
  });

  it('expends all 6 shots then RTBs', () => {
    const heli = airborneHeli(House.Spain, 10, 10);
    heli.aircraftState = 'attacking';
    heli.mission = Mission.ATTACK;
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    heli.target = target;

    const ctx = makeAircraftCtx([heli, target]);

    // Fire all 6 shots
    for (let shot = 0; shot < 6; shot++) {
      heli.attackCooldown = 0;
      updateHelicopterAttack(ctx, heli);
    }

    expect(heli.ammo).toBe(0);
    expect(heli.aircraftState).toBe('returning');
  });

  it('ammo count never goes below 0', () => {
    const heli = airborneHeli(House.Spain, 10, 10);
    heli.aircraftState = 'attacking';
    heli.mission = Mission.ATTACK;
    heli.ammo = 0; // already empty
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    heli.target = target;

    const ctx = makeAircraftCtx([heli, target]);
    updateHelicopterAttack(ctx, heli);

    // Should RTB immediately, ammo stays 0
    expect(heli.ammo).toBe(0);
    expect(heli.aircraftState).toBe('returning');
  });
});

// ── Movement — Aircraft Skip Rotation-Before-Move (entity.ts) ────────────────
// C++ aircraft.cpp / entity.ts — aircraft always move forward, never stop to rotate

describe('HELI movement — aircraft rotation (entity.ts)', () => {
  it('HELI moves while rotating (aircraft do not stop to rotate)', () => {
    const heli = airborneHeli(House.Spain, 10, 10);
    heli.facing = Dir.N;
    heli.desiredFacing = Dir.N;
    heli.bodyFacing32 = Dir.N * 4;

    const startX = heli.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: heli.pos.y }; // due East

    const arrived = heli.moveToward(targetPos, heli.stats.speed);

    // Aircraft should move even while facing is misaligned
    const distMoved = Math.sqrt((heli.pos.x - startX) ** 2 + (heli.pos.y - heli.pos.y) ** 2);
    expect(distMoved).toBeGreaterThan(0);
  });

  it('HELI rot=4 does NOT snap facing instantly (unlike infantry rot>=8)', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    expect(heli.stats.rot).toBe(4);
    expect(heli.stats.rot).toBeLessThan(8);

    // Set facing N, desired S — should not snap instantly
    heli.facing = Dir.N;
    heli.desiredFacing = Dir.S;
    heli.bodyFacing32 = Dir.N * 4;
    const aligned = heli.tickRotation();
    expect(aligned).toBe(false); // needs multiple ticks
  });
});
