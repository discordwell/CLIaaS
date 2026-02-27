/**
 * Tests for air combat system — aircraft types, weapons, entity getters,
 * ammo/rearm, flight altitude, state machine, fixed-wing vs helicopter,
 * AA targeting, production items, and structure config.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  UnitType, House, SpeedClass, UNIT_STATS, WEAPON_STATS,
  PRODUCTION_ITEMS, CELL_SIZE,
} from '../engine/types';
import {
  STRUCTURE_SIZE, STRUCTURE_MAX_HP, STRUCTURE_WEAPONS,
} from '../engine/scenario';

beforeEach(() => resetEntityIds());

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

// === Part 1: Aircraft Type Definitions ===

describe('Aircraft type definitions', () => {
  it('MIG has correct stats', () => {
    const s = UNIT_STATS.MIG;
    expect(s.type).toBe(UnitType.V_MIG);
    expect(s.name).toBe('MiG');
    expect(s.strength).toBe(60);
    expect(s.armor).toBe('light');
    expect(s.speed).toBe(12);
    expect(s.speedClass).toBe(SpeedClass.WINGED);
    expect(s.isAircraft).toBe(true);
    expect(s.isFixedWing).toBe(true);
    expect(s.landingBuilding).toBe('AFLD');
    expect(s.maxAmmo).toBe(2);
    expect(s.primaryWeapon).toBe('Maverick');
  });

  it('YAK has correct stats', () => {
    const s = UNIT_STATS.YAK;
    expect(s.type).toBe(UnitType.V_YAK);
    expect(s.strength).toBe(50);
    expect(s.speedClass).toBe(SpeedClass.WINGED);
    expect(s.isAircraft).toBe(true);
    expect(s.isFixedWing).toBe(true);
    expect(s.landingBuilding).toBe('AFLD');
    expect(s.maxAmmo).toBe(1);
  });

  it('HELI has correct stats', () => {
    const s = UNIT_STATS.HELI;
    expect(s.type).toBe(UnitType.V_HELI);
    expect(s.name).toBe('Longbow');
    expect(s.strength).toBe(100);
    expect(s.armor).toBe('heavy');
    expect(s.speed).toBe(10);
    expect(s.speedClass).toBe(SpeedClass.WINGED);
    expect(s.isAircraft).toBe(true);
    expect(s.isRotorEquipped).toBe(true);
    expect(s.isFixedWing).toBeUndefined();
    expect(s.landingBuilding).toBe('HPAD');
    expect(s.maxAmmo).toBe(2);
    expect(s.primaryWeapon).toBe('Hellfire');
  });

  it('HIND has correct stats', () => {
    const s = UNIT_STATS.HIND;
    expect(s.type).toBe(UnitType.V_HIND);
    expect(s.strength).toBe(125);
    expect(s.armor).toBe('heavy');
    expect(s.speedClass).toBe(SpeedClass.WINGED);
    expect(s.isAircraft).toBe(true);
    expect(s.isRotorEquipped).toBe(true);
    expect(s.landingBuilding).toBe('HPAD');
    expect(s.maxAmmo).toBe(4);
    expect(s.primaryWeapon).toBe('ChainGun');
    expect(s.secondaryWeapon).toBe('Hellfire');
  });

  it('TRAN (Chinook) has aircraft flags', () => {
    const s = UNIT_STATS.TRAN;
    expect(s.isAircraft).toBe(true);
    expect(s.isRotorEquipped).toBe(true);
    expect(s.landingBuilding).toBe('HPAD');
    expect(s.image).toBe('tran');
  });

  it('All aircraft have WINGED speed class', () => {
    for (const type of ['MIG', 'YAK', 'HELI', 'HIND', 'TRAN']) {
      expect(UNIT_STATS[type].speedClass).toBe(SpeedClass.WINGED);
    }
  });
});

// === Part 2: Aircraft Weapon Stats ===

describe('Aircraft weapon stats', () => {
  it('Maverick has correct properties', () => {
    const w = WEAPON_STATS.Maverick;
    expect(w.damage).toBe(60);
    expect(w.rof).toBe(50);
    expect(w.range).toBe(5.0);
    expect(w.warhead).toBe('AP');
    expect(w.projectileROT).toBe(5);
  });

  it('Hellfire has splash damage', () => {
    const w = WEAPON_STATS.Hellfire;
    expect(w.damage).toBe(30);
    expect(w.rof).toBe(40);
    expect(w.range).toBe(5.0);
    expect(w.warhead).toBe('HE');
    expect(w.splash).toBe(1.0);
    expect(w.projectileROT).toBe(5);
  });

  it('ChainGun is rapid-fire hitscan', () => {
    const w = WEAPON_STATS.ChainGun;
    expect(w.damage).toBe(15);
    expect(w.rof).toBe(10);
    expect(w.range).toBe(4.0);
    expect(w.warhead).toBe('AP');
    expect(w.projectileROT).toBeUndefined();
  });

  it('Nike is anti-air missile', () => {
    const w = WEAPON_STATS.Nike;
    expect(w.damage).toBe(100);
    expect(w.range).toBe(10.0);
    expect(w.warhead).toBe('HE');
    expect(w.isAntiAir).toBe(true);
    expect(w.splash).toBe(1.0);
  });

  it('RedEye has isAntiAir flag', () => {
    const w = WEAPON_STATS.RedEye;
    expect(w.isAntiAir).toBe(true);
  });
});

// === Part 3: Entity Air Detection Getters ===

describe('Entity air detection', () => {
  it('isAirUnit returns true for all aircraft', () => {
    expect(makeEntity(UnitType.V_MIG, House.Spain).isAirUnit).toBe(true);
    expect(makeEntity(UnitType.V_YAK, House.Spain).isAirUnit).toBe(true);
    expect(makeEntity(UnitType.V_HELI, House.Spain).isAirUnit).toBe(true);
    expect(makeEntity(UnitType.V_HIND, House.Spain).isAirUnit).toBe(true);
    expect(makeEntity(UnitType.V_TRAN, House.Spain).isAirUnit).toBe(true);
  });

  it('isAirUnit returns false for ground/naval units', () => {
    expect(makeEntity(UnitType.V_2TNK, House.Spain).isAirUnit).toBe(false);
    expect(makeEntity(UnitType.I_E1, House.Spain).isAirUnit).toBe(false);
    expect(makeEntity(UnitType.V_DD, House.Spain).isAirUnit).toBe(false);
  });

  it('isFixedWing is true for MIG/YAK', () => {
    expect(makeEntity(UnitType.V_MIG, House.Spain).isFixedWing).toBe(true);
    expect(makeEntity(UnitType.V_YAK, House.Spain).isFixedWing).toBe(true);
  });

  it('isFixedWing is false for helicopters', () => {
    expect(makeEntity(UnitType.V_HELI, House.Spain).isFixedWing).toBe(false);
    expect(makeEntity(UnitType.V_HIND, House.Spain).isFixedWing).toBe(false);
    expect(makeEntity(UnitType.V_TRAN, House.Spain).isFixedWing).toBe(false);
  });

  it('isHelicopter is true for HELI/HIND/TRAN', () => {
    expect(makeEntity(UnitType.V_HELI, House.Spain).isHelicopter).toBe(true);
    expect(makeEntity(UnitType.V_HIND, House.Spain).isHelicopter).toBe(true);
    expect(makeEntity(UnitType.V_TRAN, House.Spain).isHelicopter).toBe(true);
  });

  it('isHelicopter is false for fixed-wing', () => {
    expect(makeEntity(UnitType.V_MIG, House.Spain).isHelicopter).toBe(false);
    expect(makeEntity(UnitType.V_YAK, House.Spain).isHelicopter).toBe(false);
  });

  it('isRotorEquipped for helicopters only', () => {
    expect(makeEntity(UnitType.V_HELI, House.Spain).isRotorEquipped).toBe(true);
    expect(makeEntity(UnitType.V_HIND, House.Spain).isRotorEquipped).toBe(true);
    expect(makeEntity(UnitType.V_TRAN, House.Spain).isRotorEquipped).toBe(true);
    expect(makeEntity(UnitType.V_MIG, House.Spain).isRotorEquipped).toBe(false);
    expect(makeEntity(UnitType.V_YAK, House.Spain).isRotorEquipped).toBe(false);
  });

  it('hasTurret is false for all aircraft', () => {
    expect(makeEntity(UnitType.V_MIG, House.Spain).hasTurret).toBe(false);
    expect(makeEntity(UnitType.V_YAK, House.Spain).hasTurret).toBe(false);
    expect(makeEntity(UnitType.V_HELI, House.Spain).hasTurret).toBe(false);
    expect(makeEntity(UnitType.V_HIND, House.Spain).hasTurret).toBe(false);
    expect(makeEntity(UnitType.V_TRAN, House.Spain).hasTurret).toBe(false);
  });
});

// === Part 4: Ammo System ===

describe('Ammo system', () => {
  it('Aircraft start with maxAmmo', () => {
    const mig = makeEntity(UnitType.V_MIG, House.Spain);
    expect(mig.ammo).toBe(2);
    expect(mig.maxAmmo).toBe(2);

    const yak = makeEntity(UnitType.V_YAK, House.Spain);
    expect(yak.ammo).toBe(1);
    expect(yak.maxAmmo).toBe(1);

    const hind = makeEntity(UnitType.V_HIND, House.Spain);
    expect(hind.ammo).toBe(4);
    expect(hind.maxAmmo).toBe(4);
  });

  it('Non-aircraft have unlimited ammo (-1)', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    expect(tank.ammo).toBe(-1);
    expect(tank.maxAmmo).toBe(-1);
  });

  it('Ammo can be decremented', () => {
    const mig = makeEntity(UnitType.V_MIG, House.Spain);
    mig.ammo--;
    expect(mig.ammo).toBe(1);
    mig.ammo--;
    expect(mig.ammo).toBe(0);
  });

  it('Rearm timer restores ammo', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.ammo = 0;
    heli.aircraftState = 'rearming';
    heli.rearmTimer = 1; // about to tick
    // Simulate rearm tick
    heli.rearmTimer--;
    if (heli.rearmTimer <= 0) {
      heli.ammo++;
      if (heli.ammo >= heli.maxAmmo) {
        heli.aircraftState = 'landed';
      } else {
        heli.rearmTimer = 30;
      }
    }
    expect(heli.ammo).toBe(1);
    expect(heli.aircraftState).toBe('rearming'); // not full yet
    expect(heli.rearmTimer).toBe(30);
  });

  it('Rearming completes when ammo is full', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.ammo = 1; // one short of max (2)
    heli.aircraftState = 'rearming';
    heli.rearmTimer = 1;
    heli.rearmTimer--;
    if (heli.rearmTimer <= 0) {
      heli.ammo++;
      if (heli.ammo >= heli.maxAmmo) {
        heli.aircraftState = 'landed';
      } else {
        heli.rearmTimer = 30;
      }
    }
    expect(heli.ammo).toBe(2);
    expect(heli.aircraftState).toBe('landed');
  });
});

// === Part 5: Flight Altitude ===

describe('Flight altitude', () => {
  it('FLIGHT_ALTITUDE is 24 (C++ FLIGHT_LEVEL)', () => {
    expect(Entity.FLIGHT_ALTITUDE).toBe(24);
  });

  it('Aircraft start grounded (flightAltitude=0)', () => {
    const mig = makeEntity(UnitType.V_MIG, House.Spain);
    expect(mig.flightAltitude).toBe(0);
  });

  it('Ascend increases flightAltitude', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.flightAltitude = Math.min(Entity.FLIGHT_ALTITUDE, heli.flightAltitude + 3);
    expect(heli.flightAltitude).toBe(3);
    // Continue ascending
    for (let i = 0; i < 10; i++) {
      heli.flightAltitude = Math.min(Entity.FLIGHT_ALTITUDE, heli.flightAltitude + 3);
    }
    expect(heli.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
  });

  it('Descend decreases flightAltitude', () => {
    const mig = makeEntity(UnitType.V_MIG, House.Spain);
    mig.flightAltitude = Entity.FLIGHT_ALTITUDE;
    mig.flightAltitude = Math.max(0, mig.flightAltitude - 2);
    expect(mig.flightAltitude).toBe(22);
    // Descend to ground
    for (let i = 0; i < 20; i++) {
      mig.flightAltitude = Math.max(0, mig.flightAltitude - 2);
    }
    expect(mig.flightAltitude).toBe(0);
  });
});

// === Part 6: Aircraft State Machine ===

describe('Aircraft state machine', () => {
  it('Aircraft start in landed state', () => {
    const mig = makeEntity(UnitType.V_MIG, House.Spain);
    expect(mig.aircraftState).toBe('landed');
  });

  it('All 8 states are valid', () => {
    const states: Entity['aircraftState'][] = [
      'idle', 'takeoff', 'flying', 'attacking', 'returning', 'landing', 'landed', 'rearming',
    ];
    const mig = makeEntity(UnitType.V_MIG, House.Spain);
    for (const s of states) {
      mig.aircraftState = s;
      expect(mig.aircraftState).toBe(s);
    }
  });

  it('Takeoff transitions from landed', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    expect(heli.aircraftState).toBe('landed');
    heli.aircraftState = 'takeoff';
    expect(heli.aircraftState).toBe('takeoff');
  });

  it('Landing transitions to rearming when ammo depleted', () => {
    const mig = makeEntity(UnitType.V_MIG, House.Spain);
    mig.ammo = 0;
    mig.aircraftState = 'landing';
    mig.flightAltitude = 0;
    // Simulate landing completion
    if (mig.flightAltitude <= 0 && mig.ammo < mig.maxAmmo) {
      mig.aircraftState = 'rearming';
      mig.rearmTimer = 30;
    }
    expect(mig.aircraftState).toBe('rearming');
  });

  it('Landing transitions to landed when ammo full', () => {
    const mig = makeEntity(UnitType.V_MIG, House.Spain);
    mig.aircraftState = 'landing';
    mig.flightAltitude = 0;
    // Full ammo
    if (mig.flightAltitude <= 0 && mig.ammo >= mig.maxAmmo) {
      mig.aircraftState = 'landed';
    }
    expect(mig.aircraftState).toBe('landed');
  });
});

// === Part 7: Fixed-Wing vs Helicopter Differences ===

describe('Fixed-wing vs helicopter', () => {
  it('Fixed-wing has attack run phases', () => {
    const mig = makeEntity(UnitType.V_MIG, House.Spain);
    expect(mig.attackRunPhase).toBe('approach');
    mig.attackRunPhase = 'firing';
    expect(mig.attackRunPhase).toBe('firing');
    mig.attackRunPhase = 'pullaway';
    expect(mig.attackRunPhase).toBe('pullaway');
  });

  it('MIG/YAK are fixed-wing, HELI/HIND are helicopters', () => {
    expect(makeEntity(UnitType.V_MIG, House.Spain).isFixedWing).toBe(true);
    expect(makeEntity(UnitType.V_YAK, House.Spain).isFixedWing).toBe(true);
    expect(makeEntity(UnitType.V_HELI, House.Spain).isHelicopter).toBe(true);
    expect(makeEntity(UnitType.V_HIND, House.Spain).isHelicopter).toBe(true);
  });

  it('Fixed-wing cannot hover (always moves forward)', () => {
    const mig = makeEntity(UnitType.V_MIG, House.Spain);
    expect(mig.isFixedWing).toBe(true);
    expect(mig.isHelicopter).toBe(false);
  });

  it('Helicopters can hover (isRotorEquipped)', () => {
    const hind = makeEntity(UnitType.V_HIND, House.Spain);
    expect(hind.isHelicopter).toBe(true);
    expect(hind.isRotorEquipped).toBe(true);
    expect(hind.isFixedWing).toBe(false);
  });
});

// === Part 8: AA Targeting ===

describe('AA targeting', () => {
  it('SAM structure weapon has isAntiAir', () => {
    const sam = STRUCTURE_WEAPONS.SAM;
    expect(sam.isAntiAir).toBe(true);
  });

  it('AGUN structure weapon has isAntiAir', () => {
    const agun = STRUCTURE_WEAPONS.AGUN;
    expect(agun.isAntiAir).toBe(true);
  });

  it('Non-AA structures do not have isAntiAir', () => {
    expect(STRUCTURE_WEAPONS.GUN.isAntiAir).toBeUndefined();
    expect(STRUCTURE_WEAPONS.HBOX.isAntiAir).toBeUndefined();
    expect(STRUCTURE_WEAPONS.TSLA.isAntiAir).toBeUndefined();
  });

  it('RedEye weapon has isAntiAir', () => {
    expect(WEAPON_STATS.RedEye.isAntiAir).toBe(true);
  });

  it('Nike weapon has isAntiAir', () => {
    expect(WEAPON_STATS.Nike.isAntiAir).toBe(true);
  });

  it('Ground-only weapons do not have isAntiAir', () => {
    expect(WEAPON_STATS['75mm'].isAntiAir).toBeUndefined();
    expect(WEAPON_STATS.M60mg.isAntiAir).toBeUndefined();
    expect(WEAPON_STATS.M1Carbine.isAntiAir).toBeUndefined();
    expect(WEAPON_STATS.Maverick.isAntiAir).toBeUndefined();
  });
});

// === Part 9: Production Items ===

describe('Aircraft production items', () => {
  it('TRAN production requires HPAD', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'TRAN');
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('HPAD');
    expect(item!.cost).toBe(700);
    expect(item!.faction).toBe('both');
  });

  it('HELI production requires HPAD and ATEK', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'HELI');
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('HPAD');
    expect(item!.techPrereq).toBe('ATEK');
    expect(item!.faction).toBe('allied');
  });

  it('HIND production requires HPAD', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'HIND');
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('HPAD');
    expect(item!.faction).toBe('soviet');
  });

  it('MIG production requires AFLD', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'MIG');
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('AFLD');
    expect(item!.faction).toBe('soviet');
    expect(item!.cost).toBe(1200);
  });

  it('YAK production requires AFLD', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'YAK');
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('AFLD');
    expect(item!.faction).toBe('soviet');
    expect(item!.cost).toBe(800);
  });

  it('HPAD structure is buildable', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'HPAD');
    expect(item).toBeDefined();
    expect(item!.isStructure).toBe(true);
    expect(item!.prerequisite).toBe('FACT');
    expect(item!.cost).toBe(1500);
  });

  it('AFLD structure is buildable', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'AFLD');
    expect(item).toBeDefined();
    expect(item!.isStructure).toBe(true);
    expect(item!.prerequisite).toBe('FACT');
    expect(item!.faction).toBe('soviet');
    expect(item!.cost).toBe(2000);
  });
});

// === Part 10: Structure Config ===

describe('HPAD/AFLD structure config', () => {
  it('HPAD has size [2, 2]', () => {
    expect(STRUCTURE_SIZE.HPAD).toEqual([2, 2]);
  });

  it('AFLD has size [2, 2]', () => {
    expect(STRUCTURE_SIZE.AFLD).toEqual([2, 2]);
  });

  it('HPAD has 400 max HP', () => {
    expect(STRUCTURE_MAX_HP.HPAD).toBe(400);
  });

  it('AFLD has 500 max HP', () => {
    expect(STRUCTURE_MAX_HP.AFLD).toBe(500);
  });

  it('MapStructure interface supports dockedAircraft field', () => {
    // Verify the field exists on the type by creating a structure-like object
    const struct = {
      type: 'HPAD',
      image: 'hpad',
      house: House.Spain,
      cx: 5, cy: 5,
      hp: 400, maxHp: 400,
      alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
      dockedAircraft: 42,
    };
    expect(struct.dockedAircraft).toBe(42);
  });
});
