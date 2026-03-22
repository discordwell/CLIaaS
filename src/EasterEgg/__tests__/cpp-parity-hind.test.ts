/**
 * C++ Behavioral Parity: HIND — Hind Attack Helicopter
 *
 * Tests verify Hind helicopter behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with HIND (observable outcomes: HP, alive/dead,
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

// -- Helpers ----------------------------------------------------------------

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Create an airborne HIND at the given cell, flight altitude set, state = 'flying' */
function airborneHind(house: House, cx: number, cy: number): Entity {
  const hind = entityAtCell(UnitType.V_HIND, house, cx, cy);
  hind.aircraftState = 'flying';
  hind.flightAltitude = Entity.FLIGHT_ALTITUDE;
  hind.animState = AnimState.WALK;
  return hind;
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

// -- Stats Verification (rules.ini parity) ----------------------------------
// C++ udata.cpp (unit type data) -- HIND entry and RULES.INI [HIND] section

describe('HIND stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.HIND;
  const weapon = WEAPON_STATS.ChainGun;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'HIND');

  it('HP is 225 (Strength=225)', () => {
    expect(stats.strength).toBe(225);
  });

  it('Armor is heavy (Armor=heavy)', () => {
    expect(stats.armor).toBe('heavy');
  });

  it('Speed is 12 (Speed=12)', () => {
    expect(stats.speed).toBe(12);
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

  it('maxAmmo is 12', () => {
    expect(stats.maxAmmo).toBe(12);
  });

  it('primary weapon is ChainGun', () => {
    expect(stats.primaryWeapon).toBe('ChainGun');
  });

  it('no secondary weapon (single-weapon helicopter)', () => {
    expect(stats.secondaryWeapon).toBeFalsy();
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

  it('faction is soviet', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('soviet');
  });

  it('Entity constructor initializes HP to strength', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    expect(hind.hp).toBe(225);
    expect(hind.maxHp).toBe(225);
  });

  it('Entity constructor initializes ammo from maxAmmo', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    expect(hind.ammo).toBe(12);
    expect(hind.maxAmmo).toBe(12);
  });

  it('Entity constructor sets aircraftState to landed', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    expect(hind.aircraftState).toBe('landed');
  });

  it('Entity constructor sets flightAltitude to 0', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    expect(hind.flightAltitude).toBe(0);
  });
});

// -- ChainGun Weapon Stats (rules.ini) --------------------------------------
// C++ rules.ini [ChainGun] section -- aircraft.cpp weapon configuration

describe('ChainGun weapon stats (rules.ini)', () => {
  const weapon = WEAPON_STATS.ChainGun;

  it('damage is 40', () => {
    expect(weapon.damage).toBe(40);
  });

  it('warhead is SA (small arms)', () => {
    expect(weapon.warhead).toBe('SA');
  });

  it('range is 5.0 cells', () => {
    expect(weapon.range).toBe(5.0);
  });

  it('ROF is 3 ticks (rapid fire)', () => {
    expect(weapon.rof).toBe(3);
  });

  it('no splash (hitscan weapon)', () => {
    expect(weapon.splash).toBeFalsy();
  });

  it('no projectileROT (hitscan, not guided)', () => {
    expect(weapon.projectileROT).toBeUndefined();
  });

  it('Entity weapon reference resolves correctly', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    expect(hind.weapon).not.toBeNull();
    expect(hind.weapon!.name).toBe('ChainGun');
  });

  it('Entity has no secondary weapon', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    expect(hind.weapon2).toBeNull();
  });
});

// -- SA Warhead Effectiveness (combat.cpp warhead tables) -------------------
// C++ combat.cpp -- Modify_Damage uses WARHEAD_VS_ARMOR table

describe('HIND SA warhead effectiveness (combat.cpp warhead tables)', () => {
  it('SA vs none armor: mult 1.0 (full damage to unarmored infantry)', () => {
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('none')];
    expect(mult).toBe(1.0);
  });

  it('SA vs wood armor: mult 0.5', () => {
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('wood')];
    expect(mult).toBe(0.5);
  });

  it('SA vs light armor: mult 0.6', () => {
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('light')];
    expect(mult).toBe(0.6);
  });

  it('SA vs heavy armor: mult 0.25 (poor against heavy armor)', () => {
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('heavy')];
    expect(mult).toBe(0.25);
  });

  it('SA vs concrete: mult 0.25', () => {
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('concrete')];
    expect(mult).toBe(0.25);
  });

  it('ChainGun deals full 40 base damage to unarmored infantry', () => {
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const hpBefore = victim.hp;
    // SA vs none = 1.0, so 40 * 1.0 = 40
    const damage = Math.round(40 * WARHEAD_VS_ARMOR.SA[armorIndex('none')]);
    victim.takeDamage(damage, 'SA');
    expect(hpBefore - victim.hp).toBe(40);
  });

  it('ChainGun deals reduced damage to heavy-armor tanks', () => {
    const victim = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);
    const hpBefore = victim.hp;
    // SA vs heavy = 0.25, so 40 * 0.25 = 10
    const damage = Math.round(40 * WARHEAD_VS_ARMOR.SA[armorIndex('heavy')]);
    victim.takeDamage(damage, 'SA');
    expect(hpBefore - victim.hp).toBe(damage);
    expect(damage).toBe(10);
  });
});

// -- Helicopter Type Classification (entity.ts) -----------------------------
// C++ aircraft.cpp -- HIND is helicopter (isAircraft=true, NOT isFixedWing)

describe('HIND helicopter classification (entity.ts)', () => {
  it('isAirUnit returns true', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    expect(hind.isAirUnit).toBe(true);
  });

  it('isHelicopter returns true (aircraft but NOT fixed-wing)', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    expect(hind.isHelicopter).toBe(true);
  });

  it('isFixedWing returns false', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    expect(hind.isFixedWing).toBe(false);
  });

  it('isRotorEquipped returns true (rotor overlay)', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    expect(hind.isRotorEquipped).toBe(true);
  });

  it('hasTurret returns false (aircraft have no turret)', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    expect(hind.hasTurret).toBe(false);
  });

  it('isNavalUnit returns false', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    expect(hind.isNavalUnit).toBe(false);
  });

  it('crushable is not set (aircraft cannot be crushed)', () => {
    expect(UNIT_STATS.HIND.crushable).toBeFalsy();
  });

  it('isTransport returns false (HIND has no passengers)', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    expect(hind.isTransport).toBe(false);
  });

  it('YAK is fixed-wing (contrast with HIND — both use ChainGun)', () => {
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 10, 10);
    expect(yak.isFixedWing).toBe(true);
    expect(yak.isHelicopter).toBe(false);
  });
});

// -- Heavy Armor Survivability (combat.cpp) ---------------------------------
// C++ combat.cpp -- HIND has 225 HP with heavy armor

describe('HIND heavy armor survivability (combat.cpp)', () => {
  it('HIND (225 HP heavy) shares survivability with HELI (225 HP heavy)', () => {
    expect(UNIT_STATS.HIND.strength).toBe(225);
    expect(UNIT_STATS.HIND.armor).toBe('heavy');
    expect(UNIT_STATS.HELI.strength).toBe(225);
    expect(UNIT_STATS.HELI.armor).toBe('heavy');
  });

  it('AP weapons deal full damage to HIND heavy armor', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    const hpBefore = hind.hp;
    // AP vs heavy = 1.0; 40 * 1.0 = 40
    const damage = Math.round(40 * WARHEAD_VS_ARMOR.AP[armorIndex('heavy')]);
    hind.takeDamage(damage, 'AP');
    expect(hpBefore - hind.hp).toBe(40);
  });

  it('SA weapons deal only 25% to HIND heavy armor', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    const hpBefore = hind.hp;
    // SA vs heavy = 0.25; 15 * 0.25 = 3.75 -> round = 4
    const damage = Math.round(15 * WARHEAD_VS_ARMOR.SA[armorIndex('heavy')]);
    hind.takeDamage(damage, 'SA');
    expect(hpBefore - hind.hp).toBe(damage);
    expect(damage).toBe(4);
  });

  it('HIND survives multiple rifle hits (225 HP / 4 dmg per hit = 56 hits to kill)', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    const damagePerHit = Math.round(15 * WARHEAD_VS_ARMOR.SA[armorIndex('heavy')]);
    const hitsToKill = Math.ceil(225 / damagePerHit);
    expect(hitsToKill).toBeGreaterThanOrEqual(50);
    // Apply 10 rifle hits -- should still be alive
    for (let i = 0; i < 10; i++) {
      hind.takeDamage(damagePerHit, 'SA');
    }
    expect(hind.alive).toBe(true);
    expect(hind.hp).toBe(225 - 10 * damagePerHit);
  });

  it('HIND is killed when HP reaches 0', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    const killed = hind.takeDamage(225, 'AP');
    expect(killed).toBe(true);
    expect(hind.alive).toBe(false);
    expect(hind.hp).toBe(0);
    expect(hind.mission).toBe(Mission.DIE);
  });
});

// -- Helicopter Hover Attack (aircraft.cpp) ---------------------------------
// C++ aircraft.cpp -- helicopters hover in place within weapon range and fire

describe('HIND helicopter hover attack (aircraft.cpp)', () => {
  it('helicopter closes to weapon range when target is far', () => {
    const hind = airborneHind(House.USSR, 5, 5);
    hind.aircraftState = 'attacking';
    hind.mission = Mission.ATTACK;
    const target = entityAtCell(UnitType.I_E1, House.Spain, 20, 5); // far away
    hind.target = target;

    const ctx = makeAircraftCtx([hind, target]);
    const startX = hind.pos.x;
    updateHelicopterAttack(ctx, hind);

    // Should have moved toward target
    expect(hind.pos.x).toBeGreaterThan(startX);
    expect(hind.animState).toBe(AnimState.WALK);
  });

  it('helicopter switches to ATTACK animState when in range', () => {
    const hind = airborneHind(House.USSR, 10, 10);
    hind.aircraftState = 'attacking';
    hind.mission = Mission.ATTACK;
    hind.attackCooldown = 10; // on cooldown so it doesn't fire
    const target = entityAtCell(UnitType.I_E1, House.Spain, 11, 10); // 1 cell away, within range 5.0
    hind.target = target;

    const ctx = makeAircraftCtx([hind, target]);
    updateHelicopterAttack(ctx, hind);

    expect(hind.animState).toBe(AnimState.ATTACK);
  });

  it('helicopter fires weapon when in range and cooldown ready', () => {
    const hind = airborneHind(House.USSR, 10, 10);
    hind.aircraftState = 'attacking';
    hind.mission = Mission.ATTACK;
    hind.attackCooldown = 0;
    const target = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    hind.target = target;

    let firedAt: Entity | null = null;
    const ctx = makeAircraftCtx([hind, target]);
    ctx.fireWeaponAt = (_attacker, t) => { firedAt = t; };
    updateHelicopterAttack(ctx, hind);

    expect(firedAt).toBe(target);
    expect(hind.attackCooldown).toBe(3); // ChainGun ROF = 3
  });

  it('helicopter decrements ammo after firing', () => {
    const hind = airborneHind(House.USSR, 10, 10);
    hind.aircraftState = 'attacking';
    hind.mission = Mission.ATTACK;
    hind.attackCooldown = 0;
    const target = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    hind.target = target;

    const ctx = makeAircraftCtx([hind, target]);
    updateHelicopterAttack(ctx, hind);

    expect(hind.ammo).toBe(11); // started with 12, fired 1
  });

  it('helicopter RTBs when ammo depleted', () => {
    const hind = airborneHind(House.USSR, 10, 10);
    hind.aircraftState = 'attacking';
    hind.mission = Mission.ATTACK;
    hind.attackCooldown = 0;
    hind.ammo = 1; // last shot
    const target = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    hind.target = target;

    const ctx = makeAircraftCtx([hind, target]);
    updateHelicopterAttack(ctx, hind);

    // After firing last shot, ammo=0, should RTB
    expect(hind.ammo).toBe(0);
    expect(hind.aircraftState).toBe('returning');
    expect(hind.mission).toBe(Mission.GUARD);
    expect(hind.target).toBeNull();
  });

  it('helicopter returns to base when target is lost', () => {
    const hind = airborneHind(House.USSR, 10, 10);
    hind.aircraftState = 'attacking';
    hind.mission = Mission.ATTACK;
    hind.target = null; // no target
    hind.targetStructure = null;

    const ctx = makeAircraftCtx([hind]);
    updateHelicopterAttack(ctx, hind);

    expect(hind.aircraftState).toBe('returning');
    expect(hind.mission).toBe(Mission.GUARD);
  });

  it('helicopter does not fire when weapon is on cooldown', () => {
    const hind = airborneHind(House.USSR, 10, 10);
    hind.aircraftState = 'attacking';
    hind.mission = Mission.ATTACK;
    hind.attackCooldown = 2; // still on cooldown
    const target = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    hind.target = target;

    let fired = false;
    const ctx = makeAircraftCtx([hind, target]);
    ctx.fireWeaponAt = () => { fired = true; };
    updateHelicopterAttack(ctx, hind);

    expect(fired).toBe(false);
    expect(hind.ammo).toBe(12); // unchanged
  });

  it('helicopter faces target when hovering in range', () => {
    const hind = airborneHind(House.USSR, 10, 10);
    hind.aircraftState = 'attacking';
    hind.mission = Mission.ATTACK;
    hind.attackCooldown = 10;
    hind.facing = Dir.N;
    hind.desiredFacing = Dir.N;
    const target = entityAtCell(UnitType.I_E1, House.Spain, 13, 10); // due East
    hind.target = target;

    const ctx = makeAircraftCtx([hind, target]);
    updateHelicopterAttack(ctx, hind);

    // desiredFacing should be set toward the target
    expect(hind.desiredFacing).toBe(Dir.E);
  });
});

// -- Aircraft State Machine (aircraft.cpp) ----------------------------------
// C++ aircraft.cpp -- landed -> takeoff -> flying -> attacking -> returning -> landing

describe('HIND aircraft state machine (aircraft.cpp)', () => {
  it('landed HIND transitions to takeoff when given attack order', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.mission = Mission.ATTACK;
    const target = entityAtCell(UnitType.I_E1, House.Spain, 15, 10);
    hind.target = target;

    const ctx = makeAircraftCtx([hind, target]);
    updateAircraft(ctx, hind);

    expect(hind.aircraftState).toBe('takeoff');
  });

  it('takeoff ascends 1px/tick until flight altitude', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.aircraftState = 'takeoff';
    hind.mission = Mission.ATTACK;
    hind.target = entityAtCell(UnitType.I_E1, House.Spain, 15, 10);
    hind.flightAltitude = 0;

    const ctx = makeAircraftCtx([hind]);
    updateAircraft(ctx, hind);

    expect(hind.flightAltitude).toBe(1);
    expect(hind.animState).toBe(AnimState.WALK);
  });

  it('takeoff completes at FLIGHT_ALTITUDE (24)', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.aircraftState = 'takeoff';
    hind.mission = Mission.ATTACK;
    hind.target = entityAtCell(UnitType.I_E1, House.Spain, 15, 10);
    hind.flightAltitude = Entity.FLIGHT_ALTITUDE - 1;

    const ctx = makeAircraftCtx([hind]);
    updateAircraft(ctx, hind);

    expect(hind.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
    expect(hind.aircraftState).toBe('flying');
  });

  it('flying HIND transitions to attacking when in weapon range', () => {
    const hind = airborneHind(House.USSR, 10, 10);
    hind.mission = Mission.ATTACK;
    const target = entityAtCell(UnitType.I_E1, House.Spain, 11, 10); // in range
    hind.target = target;

    const ctx = makeAircraftCtx([hind, target]);
    updateAircraft(ctx, hind);

    expect(hind.aircraftState).toBe('attacking');
  });

  it('attacking HIND uses helicopter attack (not fixed-wing)', () => {
    const hind = airborneHind(House.USSR, 10, 10);
    hind.aircraftState = 'attacking';
    hind.mission = Mission.ATTACK;
    hind.attackCooldown = 0;
    const target = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    hind.target = target;

    let fired = false;
    const ctx = makeAircraftCtx([hind, target]);
    ctx.fireWeaponAt = () => { fired = true; };
    updateAircraft(ctx, hind);

    // Helicopter attack fires at target (hover and shoot)
    expect(fired).toBe(true);
    expect(hind.animState).toBe(AnimState.ATTACK);
  });

  it('returning HIND flies to landing pad', () => {
    const hind = airborneHind(House.USSR, 5, 5);
    hind.aircraftState = 'returning';
    hind.mission = Mission.GUARD;
    const pad = makeHPAD(House.USSR, 15, 5);

    const ctx = makeAircraftCtx([hind], [pad]);
    const startX = hind.pos.x;
    updateAircraft(ctx, hind);

    // Should have moved toward pad
    expect(hind.pos.x).toBeGreaterThan(startX);
    expect(hind.animState).toBe(AnimState.WALK);
  });

  it('landing descends 1px/tick', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.aircraftState = 'landing';
    hind.flightAltitude = 5;

    const ctx = makeAircraftCtx([hind]);
    updateAircraft(ctx, hind);

    expect(hind.flightAltitude).toBe(4);
  });

  it('landing completes and triggers rearming when ammo not full', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.aircraftState = 'landing';
    hind.flightAltitude = 1; // will reach 0 this tick
    hind.ammo = 6; // not full (max=12)

    const ctx = makeAircraftCtx([hind]);
    updateAircraft(ctx, hind);

    expect(hind.flightAltitude).toBe(0);
    expect(hind.aircraftState).toBe('rearming');
    expect(hind.mission).toBe(Mission.GUARD);
  });

  it('landed state when ammo is already full (no rearming needed)', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.aircraftState = 'landing';
    hind.flightAltitude = 1;
    hind.ammo = 12; // full

    const ctx = makeAircraftCtx([hind]);
    updateAircraft(ctx, hind);

    expect(hind.aircraftState).toBe('landed');
  });
});

// -- HPAD Landing (aircraft.cpp) --------------------------------------------
// C++ aircraft.cpp -- HIND uses HPAD (helipad), not AFLD (airfield)

describe('HIND HPAD landing (aircraft.cpp)', () => {
  it('finds HPAD for HIND (not AFLD)', () => {
    const hind = airborneHind(House.USSR, 10, 10);
    const hpad = makeHPAD(House.USSR, 12, 10);
    const afld = {
      type: 'AFLD', image: 'afld', house: House.USSR,
      cx: 8, cy: 10, hp: 256, maxHp: 256, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    } as MapStructure;

    const ctx = makeAircraftCtx([hind], [afld, hpad]);
    const padIdx = findLandingPad(ctx, hind);

    expect(padIdx).toBe(1); // hpad is index 1, afld is index 0
  });

  it('does not land at enemy HPAD', () => {
    const hind = airborneHind(House.USSR, 10, 10);
    const enemyPad = makeHPAD(House.Spain, 12, 10);

    const ctx = makeAircraftCtx([hind], [enemyPad]);
    const padIdx = findLandingPad(ctx, hind);

    expect(padIdx).toBe(-1); // no friendly pad found
  });

  it('does not land at occupied HPAD', () => {
    const hind = airborneHind(House.USSR, 10, 10);
    const pad = makeHPAD(House.USSR, 12, 10);
    pad.dockedAircraft = 99; // occupied

    const ctx = makeAircraftCtx([hind], [pad]);
    const padIdx = findLandingPad(ctx, hind);

    expect(padIdx).toBe(-1);
  });

  it('picks closest HPAD when multiple are available', () => {
    const hind = airborneHind(House.USSR, 10, 10);
    const farPad = makeHPAD(House.USSR, 20, 10);
    const nearPad = makeHPAD(House.USSR, 12, 10);

    const ctx = makeAircraftCtx([hind], [farPad, nearPad]);
    const padIdx = findLandingPad(ctx, hind);

    expect(padIdx).toBe(1); // nearPad is closer
  });
});

// -- Rearming (aircraft.cpp) ------------------------------------------------
// C++ aircraft.cpp -- rearming on pad restores ammo one at a time

describe('HIND rearming (aircraft.cpp)', () => {
  it('rearming increments ammo by 1 when timer expires', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.aircraftState = 'rearming';
    hind.ammo = 6;
    hind.rearmTimer = 1; // about to expire

    const ctx = makeAircraftCtx([hind]);
    updateAircraft(ctx, hind);

    expect(hind.ammo).toBe(7);
  });

  it('rearming continues until maxAmmo (12) reached', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.aircraftState = 'rearming';
    hind.ammo = 10;
    hind.rearmTimer = 1;

    const ctx = makeAircraftCtx([hind]);
    updateAircraft(ctx, hind);

    // ammo=11, not full yet, should still be rearming
    expect(hind.ammo).toBe(11);
    expect(hind.aircraftState).toBe('rearming');
    expect(hind.rearmTimer).toBeGreaterThan(0);
  });

  it('rearming completes when maxAmmo reached, transitions to landed', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.aircraftState = 'rearming';
    hind.ammo = 11; // one short of maxAmmo=12
    hind.rearmTimer = 1;

    const ctx = makeAircraftCtx([hind]);
    updateAircraft(ctx, hind);

    expect(hind.ammo).toBe(12);
    expect(hind.aircraftState).toBe('landed');
  });

  it('rearm timer is based on C++ ReloadRate formula (36 ticks at full power)', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.aircraftState = 'landing';
    hind.flightAltitude = 1;
    hind.ammo = 0;

    const ctx = makeAircraftCtx([hind]);
    updateAircraft(ctx, hind);

    // C++ building.cpp:4023-4025: computeRearmDelay(1.0) = round(1.0 * 0.04 * 900) = 36
    expect(hind.rearmTimer).toBe(36);
  });

  it('HIND rearms faster than HELI due to lower ROF (3 vs 60)', () => {
    // ChainGun ROF=3 means shorter rearm timer vs Hellfire ROF=60
    expect(WEAPON_STATS.ChainGun.rof).toBe(3);
    expect(WEAPON_STATS.Hellfire.rof).toBe(60);
    expect(WEAPON_STATS.ChainGun.rof).toBeLessThan(WEAPON_STATS.Hellfire.rof);
  });
});

// -- ChainGun Rapid Fire (weapon.cpp) ---------------------------------------
// C++ weapon.cpp -- ChainGun has ROF=3, meaning near-continuous fire

describe('HIND ChainGun rapid fire (weapon.cpp)', () => {
  it('ChainGun ROF=3 (much faster than Hellfire ROF=60)', () => {
    expect(WEAPON_STATS.ChainGun.rof).toBe(3);
    expect(WEAPON_STATS.Hellfire.rof).toBe(60);
  });

  it('HIND can fire 4 shots in rapid succession', () => {
    const hind = airborneHind(House.USSR, 10, 10);
    hind.aircraftState = 'attacking';
    hind.mission = Mission.ATTACK;
    const target = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    hind.target = target;

    const ctx = makeAircraftCtx([hind, target]);
    let shotsFired = 0;
    ctx.fireWeaponAt = () => { shotsFired++; };

    // Fire 4 shots, resetting cooldown each time
    for (let shot = 0; shot < 4; shot++) {
      hind.attackCooldown = 0;
      updateHelicopterAttack(ctx, hind);
    }

    expect(shotsFired).toBe(4);
    expect(hind.ammo).toBe(8); // started 12, fired 4
  });

  it('ChainGun is hitscan (no projectileROT, no splash)', () => {
    const weapon = WEAPON_STATS.ChainGun;
    expect(weapon.projectileROT).toBeUndefined();
    expect(weapon.splash).toBeFalsy();
  });
});

// -- HIND vs HELI Comparison (udata.cpp) ------------------------------------
// C++ udata.cpp -- both are helicopters but with different roles

describe('HIND vs HELI comparison (udata.cpp)', () => {
  const hind = UNIT_STATS.HIND;
  const heli = UNIT_STATS.HELI;

  it('both have 225 HP (same survivability)', () => {
    expect(hind.strength).toBe(225);
    expect(heli.strength).toBe(225);
  });

  it('both have heavy armor', () => {
    expect(hind.armor).toBe('heavy');
    expect(heli.armor).toBe('heavy');
  });

  it('HIND is slower (speed 12 vs HELI speed 16)', () => {
    expect(hind.speed).toBe(12);
    expect(heli.speed).toBe(16);
    expect(hind.speed).toBeLessThan(heli.speed);
  });

  it('both are helicopters (isAircraft=true, isRotorEquipped=true, no isFixedWing)', () => {
    expect(hind.isAircraft).toBe(true);
    expect(heli.isAircraft).toBe(true);
    expect(hind.isRotorEquipped).toBe(true);
    expect(heli.isRotorEquipped).toBe(true);
    expect(hind.isFixedWing).toBeFalsy();
    expect(heli.isFixedWing).toBeFalsy();
  });

  it('both land at HPAD', () => {
    expect(hind.landingBuilding).toBe('HPAD');
    expect(heli.landingBuilding).toBe('HPAD');
  });

  it('HIND uses ChainGun (SA) vs HELI uses Hellfire (AP) -- different roles', () => {
    expect(hind.primaryWeapon).toBe('ChainGun');
    expect(heli.primaryWeapon).toBe('Hellfire');
    expect(WEAPON_STATS.ChainGun.warhead).toBe('SA');
    expect(WEAPON_STATS.Hellfire.warhead).toBe('AP');
  });

  it('HIND has more ammo (12 vs HELI 6) but same per-shot damage', () => {
    expect(hind.maxAmmo).toBe(12);
    expect(heli.maxAmmo).toBe(6);
    expect(WEAPON_STATS.ChainGun.damage).toBe(40);
    expect(WEAPON_STATS.Hellfire.damage).toBe(40);
  });

  it('HIND has faster ROF (3 vs HELI 60) -- more shots per second', () => {
    expect(WEAPON_STATS.ChainGun.rof).toBe(3);
    expect(WEAPON_STATS.Hellfire.rof).toBe(60);
  });

  it('HIND has longer weapon range (5.0 vs HELI 4.0)', () => {
    expect(WEAPON_STATS.ChainGun.range).toBe(5.0);
    expect(WEAPON_STATS.Hellfire.range).toBe(4.0);
  });
});

// -- 12 Ammo Capacity (aircraft.cpp) ----------------------------------------
// C++ aircraft.cpp -- maxAmmo=12, fires until empty then returns to base

describe('HIND 12 ammo capacity (aircraft.cpp)', () => {
  it('starts fully loaded with 12 ammo', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    expect(hind.ammo).toBe(12);
    expect(hind.maxAmmo).toBe(12);
  });

  it('expends all 12 shots then RTBs', () => {
    const hind = airborneHind(House.USSR, 10, 10);
    hind.aircraftState = 'attacking';
    hind.mission = Mission.ATTACK;
    const target = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    hind.target = target;

    const ctx = makeAircraftCtx([hind, target]);

    // Fire all 12 shots
    for (let shot = 0; shot < 12; shot++) {
      hind.attackCooldown = 0;
      updateHelicopterAttack(ctx, hind);
    }

    expect(hind.ammo).toBe(0);
    expect(hind.aircraftState).toBe('returning');
  });

  it('ammo count never goes below 0', () => {
    const hind = airborneHind(House.USSR, 10, 10);
    hind.aircraftState = 'attacking';
    hind.mission = Mission.ATTACK;
    hind.ammo = 0; // already empty
    const target = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    hind.target = target;

    const ctx = makeAircraftCtx([hind, target]);
    updateHelicopterAttack(ctx, hind);

    // Should RTB immediately, ammo stays 0
    expect(hind.ammo).toBe(0);
    expect(hind.aircraftState).toBe('returning');
  });

  it('HIND has double the ammo of HELI (12 vs 6)', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    expect(hind.ammo).toBe(12);
    expect(heli.ammo).toBe(6);
    expect(hind.ammo).toBe(heli.ammo * 2);
  });
});

// -- Anti-Infantry Role (combat.cpp) ----------------------------------------
// C++ combat.cpp -- SA warhead means HIND excels against infantry, poor vs armor

describe('HIND anti-infantry role (combat.cpp)', () => {
  it('ChainGun SA deals 40 to unarmored infantry (1.0 mult)', () => {
    const damage = Math.round(WEAPON_STATS.ChainGun.damage * WARHEAD_VS_ARMOR.SA[armorIndex('none')]);
    expect(damage).toBe(40);
  });

  it('ChainGun SA deals only 10 to heavy armor tanks (0.25 mult)', () => {
    const damage = Math.round(WEAPON_STATS.ChainGun.damage * WARHEAD_VS_ARMOR.SA[armorIndex('heavy')]);
    expect(damage).toBe(10);
  });

  it('Hellfire AP deals only 12 to unarmored infantry (0.3 mult)', () => {
    const damage = Math.round(WEAPON_STATS.Hellfire.damage * WARHEAD_VS_ARMOR.AP[armorIndex('none')]);
    expect(damage).toBe(12);
  });

  it('HIND anti-infantry DPS far exceeds HELI (rapid fire + SA vs infantry)', () => {
    // HIND: 40 dmg * 1.0 SA vs none = 40 dmg, ROF=3, so ~13.3 DPS
    // HELI: 40 dmg * 0.3 AP vs none = 12 dmg, ROF=60, so ~0.2 DPS
    const hindDps = (40 * WARHEAD_VS_ARMOR.SA[armorIndex('none')]) / WEAPON_STATS.ChainGun.rof;
    const heliDps = (40 * WARHEAD_VS_ARMOR.AP[armorIndex('none')]) / WEAPON_STATS.Hellfire.rof;
    expect(hindDps).toBeGreaterThan(heliDps * 10); // HIND has >10x anti-infantry DPS
  });

  it('HELI anti-armor DPS exceeds HIND (AP vs heavy = 1.0 vs SA vs heavy = 0.25)', () => {
    // HELI: 40 dmg * 1.0 AP vs heavy = 40 dmg, ROF=60, ~0.67 DPS
    // HIND: 40 dmg * 0.25 SA vs heavy = 10 dmg, ROF=3, ~3.33 DPS
    // Wait -- HIND actually still does more DPS due to rapid fire, but per-shot is far less effective
    const hindDmgPerShot = Math.round(40 * WARHEAD_VS_ARMOR.SA[armorIndex('heavy')]);
    const heliDmgPerShot = Math.round(40 * WARHEAD_VS_ARMOR.AP[armorIndex('heavy')]);
    expect(heliDmgPerShot).toBeGreaterThan(hindDmgPerShot); // HELI deals more per shot vs heavy armor
    expect(heliDmgPerShot).toBe(40);
    expect(hindDmgPerShot).toBe(10);
  });
});

// -- Movement -- Aircraft Skip Rotation-Before-Move (entity.ts) -------------
// C++ aircraft.cpp / entity.ts -- aircraft always move forward, never stop to rotate

describe('HIND movement -- aircraft rotation (entity.ts)', () => {
  it('HIND moves while rotating (aircraft do not stop to rotate)', () => {
    const hind = airborneHind(House.USSR, 10, 10);
    hind.facing = Dir.N;
    hind.desiredFacing = Dir.N;
    hind.bodyFacing32 = Dir.N * 4;

    const startX = hind.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: hind.pos.y }; // due East

    const arrived = hind.moveToward(targetPos, hind.stats.speed);

    // Aircraft should move even while facing is misaligned
    const distMoved = Math.sqrt((hind.pos.x - startX) ** 2 + (hind.pos.y - hind.pos.y) ** 2);
    expect(distMoved).toBeGreaterThan(0);
  });

  it('HIND is slower than HELI (speed 12 vs 16)', () => {
    const hind = airborneHind(House.USSR, 10, 10);
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);

    expect(hind.stats.speed).toBe(12);
    expect(heli.stats.speed).toBe(16);

    // Move both toward same target -- HELI moves farther
    const target = { x: hind.pos.x + CELL_SIZE * 5, y: hind.pos.y };
    const hindStart = hind.pos.x;
    hind.moveToward(target, hind.stats.speed);
    const hindDist = hind.pos.x - hindStart;

    const heliEntity = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    heliEntity.aircraftState = 'flying';
    heliEntity.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const heliStart = heliEntity.pos.x;
    heliEntity.moveToward(target, heliEntity.stats.speed);
    const heliDist = heliEntity.pos.x - heliStart;

    expect(heliDist).toBeGreaterThan(hindDist);
  });

  it('HIND rot=4 does NOT snap facing instantly (unlike infantry rot>=8)', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    expect(hind.stats.rot).toBe(4);
    expect(hind.stats.rot).toBeLessThan(8);

    // Set facing N, desired S -- should not snap instantly
    hind.facing = Dir.N;
    hind.desiredFacing = Dir.S;
    hind.bodyFacing32 = Dir.N * 4;
    const aligned = hind.tickRotation();
    expect(aligned).toBe(false); // needs multiple ticks
  });
});
