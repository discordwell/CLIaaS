/**
 * C++ Behavioral Parity: MIG — MiG-29
 *
 * Tests verify MiG-29 behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with MIG (observable outcomes: HP, stats,
 * ammo, weapon properties, aircraft state), not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
 *
 * NOTE: Fixed-wing attack run phases (facing/AA targeting) are tested in
 * cpp-parity-aircraft.test.ts — NOT duplicated here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, PRODUCTION_ITEMS,
  buildDefaultAlliances, armorIndex,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stats Verification (udata.cpp / rules.ini)
// ═══════════════════════════════════════════════════════════════════════════════

describe('MIG stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.MIG;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'MIG');

  it('HP is 50 (Strength=50 — fragile!)', () => {
    expect(stats.strength).toBe(50);
  });

  it('armor is light (Armor=light)', () => {
    expect(stats.armor).toBe('light');
  });

  it('speed is 20 (Speed=20 — fastest buildable unit in game)', () => {
    expect(stats.speed).toBe(20);
  });

  it('isAircraft is true', () => {
    expect(stats.isAircraft).toBe(true);
  });

  it('isFixedWing is true', () => {
    expect(stats.isFixedWing).toBe(true);
  });

  it('isInfantry is false', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('maxAmmo is 3 (only 3 shots before RTB)', () => {
    expect(stats.maxAmmo).toBe(3);
  });

  it('landingBuilding is AFLD (not HPAD)', () => {
    expect(stats.landingBuilding).toBe('AFLD');
  });

  it('cost is 1200 credits', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(1200);
  });

  it('faction is soviet', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('soviet');
  });

  it('prerequisite is AFLD', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.prerequisite).toBe('AFLD');
  });

  it('Entity constructor initializes HP to strength', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    expect(mig.hp).toBe(50);
    expect(mig.maxHp).toBe(50);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Dual Weapon — Maverick/Maverick (udata.cpp, weapon.cpp)
// ═══════════════════════════════════════════════════════════════════════════════

describe('MIG dual weapon — Maverick/Maverick (udata.cpp, weapon.cpp)', () => {
  const stats = UNIT_STATS.MIG;
  const weapon = WEAPON_STATS.Maverick;

  it('primary weapon is Maverick', () => {
    expect(stats.primaryWeapon).toBe('Maverick');
  });

  it('secondary weapon is also Maverick (dual identical)', () => {
    expect(stats.secondaryWeapon).toBe('Maverick');
  });

  it('Maverick damage is 50', () => {
    expect(weapon.damage).toBe(50);
  });

  it('Maverick warhead is AP', () => {
    expect(weapon.warhead).toBe('AP');
  });

  it('Maverick range is 6.0 cells', () => {
    expect(weapon.range).toBe(6.0);
  });

  it('Maverick ROF is 3 (rapid fire)', () => {
    expect(weapon.rof).toBe(3);
  });

  it('Maverick projectileROT is 5 (homing missile)', () => {
    expect(weapon.projectileROT).toBe(5);
  });

  it('Entity constructor assigns both weapons correctly', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    expect(mig.weapon).not.toBeNull();
    expect(mig.weapon!.name).toBe('Maverick');
    expect(mig.weapon2).not.toBeNull();
    expect(mig.weapon2!.name).toBe('Maverick');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AP Warhead Effectiveness (combat.cpp warhead tables)
// ═══════════════════════════════════════════════════════════════════════════════

describe('MIG AP warhead — anti-armor role (combat.cpp warhead tables)', () => {
  it('AP vs heavy armor: mult 1.0 (full damage — anti-armor role)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('heavy')];
    expect(mult).toBe(1.0);
  });

  it('AP vs light armor: mult 0.75', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('light')];
    expect(mult).toBe(0.75);
  });

  it('AP vs none armor: mult 0.3 (poor vs infantry)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('none')];
    expect(mult).toBe(0.3);
  });

  it('AP vs wood: mult 0.75', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('wood')];
    expect(mult).toBe(0.75);
  });

  it('AP vs concrete: mult 0.5', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('concrete')];
    expect(mult).toBe(0.5);
  });

  it('Maverick deals full 50 base damage to heavy-armor targets', () => {
    const victim = entityAtCell(UnitType.V_3TNK, House.Spain, 11, 10);
    const hpBefore = victim.hp;
    const damage = Math.round(50 * WARHEAD_VS_ARMOR.AP[armorIndex('heavy')]);
    victim.takeDamage(damage, 'AP');
    expect(hpBefore - victim.hp).toBe(50); // 50 * 1.0 = 50
  });

  it('Maverick deals reduced damage to unarmored infantry', () => {
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const hpBefore = victim.hp;
    const damage = Math.round(50 * WARHEAD_VS_ARMOR.AP[armorIndex('none')]);
    victim.takeDamage(damage, 'AP');
    expect(hpBefore - victim.hp).toBe(15); // 50 * 0.3 = 15
    expect(damage).toBeLessThan(50);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Low Ammo (aircraft.cpp — maxAmmo=3)
// ═══════════════════════════════════════════════════════════════════════════════

describe('MIG low ammo — 3 shots before RTB (aircraft.cpp)', () => {
  it('constructor initializes ammo to maxAmmo (3)', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    expect(mig.ammo).toBe(3);
    expect(mig.maxAmmo).toBe(3);
  });

  it('ammo decrements from 3 to 0 in 3 steps', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    expect(mig.ammo).toBe(3);
    mig.ammo--;
    expect(mig.ammo).toBe(2);
    mig.ammo--;
    expect(mig.ammo).toBe(1);
    mig.ammo--;
    expect(mig.ammo).toBe(0);
  });

  it('Yak has 15 ammo vs MIG 3 — MIG runs out 5x faster', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 10, 10);
    expect(mig.maxAmmo).toBe(3);
    expect(yak.maxAmmo).toBe(15);
    expect(yak.maxAmmo / mig.maxAmmo).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Aircraft State Machine (aircraft.cpp — starts landed)
// ═══════════════════════════════════════════════════════════════════════════════

describe('MIG aircraft state machine (aircraft.cpp)', () => {
  it('starts airborne (C++ aircraft.cpp:249 Height=FLIGHT_LEVEL)', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    expect(mig.aircraftState).toBe('flying');
  });

  it('starts at FLIGHT_ALTITUDE (C++ aircraft.cpp:249)', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    expect(mig.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
  });

  it('FLIGHT_ALTITUDE constant is 24 pixels', () => {
    expect(Entity.FLIGHT_ALTITUDE).toBe(24);
  });

  it('attackRunPhase defaults to flyToTarget', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    expect(mig.attackRunPhase).toBe('flyToTarget');
  });

  it('circleBreakTimer starts at 0', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    expect(mig.circleBreakTimer).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fastest Buildable Unit (rules.ini speed comparison)
// ═══════════════════════════════════════════════════════════════════════════════

describe('MIG is fastest buildable unit (rules.ini speed comparison)', () => {
  it('MIG speed 20 exceeds all other buildable unit speeds', () => {
    const migSpeed = UNIT_STATS.MIG.speed;
    // Check against all buildable units in PRODUCTION_ITEMS
    for (const item of PRODUCTION_ITEMS) {
      const stats = UNIT_STATS[item.type as keyof typeof UNIT_STATS];
      if (!stats) continue;
      if (item.type === 'MIG') continue;
      expect(
        migSpeed,
        `MIG speed (${migSpeed}) should be >= ${item.type} speed (${stats.speed})`,
      ).toBeGreaterThanOrEqual(stats.speed);
    }
  });

  it('MIG is faster than Yak (20 vs 16)', () => {
    expect(UNIT_STATS.MIG.speed).toBe(20);
    expect(UNIT_STATS.YAK.speed).toBe(16);
    expect(UNIT_STATS.MIG.speed).toBeGreaterThan(UNIT_STATS.YAK.speed);
  });

  it('MIG is faster than Longbow (20 vs 16)', () => {
    expect(UNIT_STATS.MIG.speed).toBeGreaterThan(UNIT_STATS.HELI.speed);
  });

  it('MIG is faster than Hind (20 vs 12)', () => {
    expect(UNIT_STATS.MIG.speed).toBeGreaterThan(UNIT_STATS.HIND.speed);
  });

  it('MIG is faster than the fastest ground unit (ANT1 at 14)', () => {
    expect(UNIT_STATS.MIG.speed).toBeGreaterThan(UNIT_STATS.ANT1.speed);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AFLD Landing (aircraft.cpp — landingBuilding='AFLD')
// ═══════════════════════════════════════════════════════════════════════════════

describe('MIG AFLD landing (aircraft.cpp landing building)', () => {
  it('MIG lands at AFLD', () => {
    expect(UNIT_STATS.MIG.landingBuilding).toBe('AFLD');
  });

  it('Yak also lands at AFLD (same airstrip type)', () => {
    expect(UNIT_STATS.YAK.landingBuilding).toBe('AFLD');
  });

  it('Longbow lands at HPAD (different from MIG)', () => {
    expect(UNIT_STATS.HELI.landingBuilding).toBe('HPAD');
  });

  it('Hind lands at HPAD (different from MIG)', () => {
    expect(UNIT_STATS.HIND.landingBuilding).toBe('HPAD');
  });

  it('Chinook has no landingBuilding — C++ STRUCT_NONE (different from MIG)', () => {
    // C++ aadata.cpp:168: TRAN Building=STRUCT_NONE — lands via Good_LZ()
    expect(UNIT_STATS.TRAN.landingBuilding).toBeUndefined();
  });

  it('fixed-wing fighters (MIG, YAK) use AFLD; combat helicopters use HPAD; TRAN uses none', () => {
    // All fixed-wing fighters use AFLD
    expect(UNIT_STATS.MIG.landingBuilding).toBe('AFLD');
    expect(UNIT_STATS.YAK.landingBuilding).toBe('AFLD');
    // Combat helicopters use HPAD
    expect(UNIT_STATS.HELI.landingBuilding).toBe('HPAD');
    expect(UNIT_STATS.HIND.landingBuilding).toBe('HPAD');
    // TRAN: C++ aadata.cpp:168 STRUCT_NONE — lands on clear terrain via Good_LZ()
    expect(UNIT_STATS.TRAN.landingBuilding).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// No Turret (unit.cpp — all aircraft have no turret)
// ═══════════════════════════════════════════════════════════════════════════════

describe('MIG no turret (unit.cpp — aircraft have no turret)', () => {
  it('MIG hasTurret is false', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    expect(mig.hasTurret).toBe(false);
  });

  it('all aircraft types have no turret', () => {
    const aircraftTypes: UnitType[] = [
      UnitType.V_MIG, UnitType.V_YAK, UnitType.V_HELI,
      UnitType.V_HIND, UnitType.V_TRAN,
    ];
    for (const type of aircraftTypes) {
      const aircraft = entityAtCell(type, House.USSR, 10, 10);
      expect(aircraft.hasTurret, `${type} should have no turret`).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Aircraft Properties — Not Crushable, Not Infantry (udata.cpp)
// ═══════════════════════════════════════════════════════════════════════════════

describe('MIG aircraft properties (udata.cpp)', () => {
  it('MIG is not crushable (aircraft fly above ground)', () => {
    expect(UNIT_STATS.MIG.crushable).toBeFalsy();
  });

  it('MIG is not infantry', () => {
    expect(UNIT_STATS.MIG.isInfantry).toBe(false);
  });

  it('MIG is not a crusher', () => {
    expect(UNIT_STATS.MIG.crusher).toBeFalsy();
  });

  it('MIG isAirUnit returns true', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    expect(mig.isAirUnit).toBe(true);
  });

  it('MIG isFixedWing returns true', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    expect(mig.isFixedWing).toBe(true);
  });

  it('MIG isHelicopter returns false (fixed-wing, not helo)', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    expect(mig.isHelicopter).toBe(false);
  });

  it('MIG isNavalUnit returns false', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    expect(mig.isNavalUnit).toBe(false);
  });

  it('MIG isTransport returns false', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    expect(mig.isTransport).toBe(false);
  });

  it('MIG is not rotor-equipped (fixed-wing has no rotor overlay)', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    expect(mig.isRotorEquipped).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MIG Fragility — HP 50 with light armor (gameplay consequence)
// ═══════════════════════════════════════════════════════════════════════════════

describe('MIG fragility — glass cannon (rules.ini balance)', () => {
  it('MIG HP 50 equals a basic Rifle Infantry', () => {
    expect(UNIT_STATS.MIG.strength).toBe(50);
    expect(UNIT_STATS.E1.strength).toBe(50);
  });

  it('MIG is much more fragile than Longbow (50 vs 225 HP)', () => {
    expect(UNIT_STATS.MIG.strength).toBe(50);
    expect(UNIT_STATS.HELI.strength).toBe(225);
    expect(UNIT_STATS.HELI.strength / UNIT_STATS.MIG.strength).toBe(4.5);
  });

  it('MIG is more fragile than Yak (50 vs 60 HP)', () => {
    expect(UNIT_STATS.MIG.strength).toBeLessThan(UNIT_STATS.YAK.strength);
  });

  it('a single 50-damage Maverick shot kills another MIG', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    // AP vs light = 0.75, so 50 * 0.75 = 37.5 → rounds to 38
    const damage = Math.round(50 * WARHEAD_VS_ARMOR.AP[armorIndex('light')]);
    expect(damage).toBe(38); // 38 damage from one hit
    // Not quite a one-shot kill, but very close
    expect(damage).toBeLessThan(mig.hp);
    // Second hit finishes it
    mig.takeDamage(damage, 'AP');
    expect(mig.alive).toBe(true);
    mig.takeDamage(damage, 'AP');
    expect(mig.alive).toBe(false);
  });

  it('MIG light armor takes more SA damage than heavy-armor units', () => {
    const saVsLight = WARHEAD_VS_ARMOR.SA[armorIndex('light')];
    const saVsHeavy = WARHEAD_VS_ARMOR.SA[armorIndex('heavy')];
    expect(saVsLight).toBeGreaterThan(saVsHeavy); // 0.6 > 0.25
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MIG Movement — Aircraft always moves forward (aircraft.cpp)
// ═══════════════════════════════════════════════════════════════════════════════

describe('MIG movement — aircraft moveToward (drive.cpp/aircraft.cpp)', () => {
  it('MIG moves toward target without stopping to rotate (unlike vehicles)', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    mig.facing = Dir.N;
    mig.desiredFacing = Dir.N;
    mig.bodyFacing32 = Dir.N * 4;

    const startX = mig.pos.x;
    const startY = mig.pos.y;
    const targetPos = { x: startX + CELL_SIZE * 3, y: startY }; // due East

    // Aircraft should move toward target even when facing is not aligned
    mig.moveToward(targetPos, mig.stats.speed);

    const distMoved = Math.sqrt((mig.pos.x - startX) ** 2 + (mig.pos.y - startY) ** 2);
    expect(distMoved).toBeGreaterThan(0);
  });

  it('vehicle (2TNK) stops to rotate but MIG does not', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.facing = Dir.N;
    tank.desiredFacing = Dir.N;
    tank.bodyFacing32 = Dir.N * 4;

    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    mig.facing = Dir.N;
    mig.desiredFacing = Dir.N;
    mig.bodyFacing32 = Dir.N * 4;

    const targetPos = { x: 10 * CELL_SIZE + CELL_SIZE / 2 + CELL_SIZE * 3, y: 10 * CELL_SIZE + CELL_SIZE / 2 }; // due East

    const tankStartX = tank.pos.x;
    const tankStartY = tank.pos.y;
    const migStartY = mig.pos.y;

    tank.moveToward(targetPos, tank.stats.speed);
    mig.moveToward(targetPos, mig.stats.speed);

    // Tank should NOT have moved (still rotating)
    expect(tank.pos.x).toBe(tankStartX);
    expect(tank.pos.y).toBe(tankStartY);
    // MIG SHOULD have moved — facing NORTH, so Y changes (not X)
    // C++ parity: aircraft moves in current facing direction, not toward target
    expect(mig.pos.y).not.toBe(migStartY);
  });
});
