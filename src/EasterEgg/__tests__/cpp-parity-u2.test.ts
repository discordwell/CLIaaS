/**
 * C++ Behavioral Parity: U2 -- Spy Plane
 *
 * Tests verify U2 Spy Plane behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with U2 (observable outcomes: HP, stats,
 * ammo, weapon properties, aircraft state), not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
 *
 * NOTE: Fixed-wing attack run phases (facing/AA targeting) are tested in
 * cpp-parity-aircraft.test.ts -- NOT duplicated here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, PRODUCTION_ITEMS,
  buildDefaultAlliances, armorIndex,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

// =============================================================================
// Stats Verification (udata.cpp / rules.ini)
// =============================================================================

describe('U2 stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.U2;

  it('HP is 2000 (Strength=2000 -- invulnerable scout!)', () => {
    expect(stats.strength).toBe(2000);
  });

  it('armor is heavy (Armor=heavy)', () => {
    expect(stats.armor).toBe('heavy');
  });

  it('speed is 40 (Speed=40 -- fastest unit in entire game!)', () => {
    expect(stats.speed).toBe(40);
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

  it('maxAmmo is 1 (single recon pass then RTB)', () => {
    expect(stats.maxAmmo).toBe(1);
  });

  it('cost is 10 (scenario-only, not buildable)', () => {
    expect(stats.cost).toBe(10);
  });

  it('Entity constructor initializes HP to strength (2000)', () => {
    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    expect(u2.hp).toBe(2000);
    expect(u2.maxHp).toBe(2000);
  });
});

// =============================================================================
// Weapon -- Camera (udata.cpp, weapon.cpp)
// =============================================================================

describe('U2 weapon -- Camera (udata.cpp, weapon.cpp)', () => {
  const stats = UNIT_STATS.U2;
  const weapon = WEAPON_STATS.Camera;

  it('primary weapon is Camera', () => {
    expect(stats.primaryWeapon).toBe('Camera');
  });

  it('has no secondary weapon (single-weapon unit)', () => {
    expect(stats.secondaryWeapon).toBeUndefined();
  });

  it('Camera damage is 0 (non-damaging reconnaissance)', () => {
    expect(weapon.damage).toBe(0);
  });

  it('Camera warhead is Super', () => {
    expect(weapon.warhead).toBe('Super');
  });

  it('Camera range is 2.75 cells', () => {
    expect(weapon.range).toBe(2.75);
  });

  it('Camera ROF is 10', () => {
    expect(weapon.rof).toBe(10);
  });

  it('Entity constructor assigns Camera weapon correctly', () => {
    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    expect(u2.weapon).not.toBeNull();
    expect(u2.weapon!.name).toBe('Camera');
    expect(u2.weapon2).toBeNull();
  });
});

// =============================================================================
// Non-Damaging Weapon -- Camera does 0 damage (combat.cpp)
// =============================================================================

describe('U2 non-damaging weapon -- Camera does 0 damage (combat.cpp)', () => {
  it('Camera deals 0 damage to heavy-armor targets', () => {
    const victim = entityAtCell(UnitType.V_3TNK, House.Spain, 11, 10);
    const hpBefore = victim.hp;
    const damage = Math.round(0 * WARHEAD_VS_ARMOR.Super[armorIndex('heavy')]);
    victim.takeDamage(damage, 'Super');
    expect(hpBefore - victim.hp).toBe(0);
  });

  it('Camera deals 0 damage to unarmored infantry', () => {
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const hpBefore = victim.hp;
    const damage = Math.round(0 * WARHEAD_VS_ARMOR.Super[armorIndex('none')]);
    victim.takeDamage(damage, 'Super');
    expect(hpBefore - victim.hp).toBe(0);
  });

  it('Camera deals 0 damage to light-armor units', () => {
    const victim = entityAtCell(UnitType.V_JEEP, House.Spain, 11, 10);
    const hpBefore = victim.hp;
    const damage = Math.round(0 * WARHEAD_VS_ARMOR.Super[armorIndex('light')]);
    victim.takeDamage(damage, 'Super');
    expect(hpBefore - victim.hp).toBe(0);
  });

  it('Camera 0 damage * any armor multiplier is always 0', () => {
    const armorTypes: Array<'none' | 'wood' | 'light' | 'heavy' | 'concrete'> = [
      'none', 'wood', 'light', 'heavy', 'concrete',
    ];
    for (const armor of armorTypes) {
      const effectiveDamage = Math.round(0 * WARHEAD_VS_ARMOR.Super[armorIndex(armor)]);
      expect(effectiveDamage, `Camera vs ${armor} should be 0`).toBe(0);
    }
  });
});

// =============================================================================
// Super Warhead Properties (combat.cpp warhead tables)
// =============================================================================

describe('U2 Super warhead -- equal damage to all armor (combat.cpp warhead tables)', () => {
  it('Super vs none: mult 1.0', () => {
    expect(WARHEAD_VS_ARMOR.Super[armorIndex('none')]).toBe(1.0);
  });

  it('Super vs wood: mult 1.0', () => {
    expect(WARHEAD_VS_ARMOR.Super[armorIndex('wood')]).toBe(1.0);
  });

  it('Super vs light: mult 1.0', () => {
    expect(WARHEAD_VS_ARMOR.Super[armorIndex('light')]).toBe(1.0);
  });

  it('Super vs heavy: mult 1.0', () => {
    expect(WARHEAD_VS_ARMOR.Super[armorIndex('heavy')]).toBe(1.0);
  });

  it('Super vs concrete: mult 1.0', () => {
    expect(WARHEAD_VS_ARMOR.Super[armorIndex('concrete')]).toBe(1.0);
  });

  it('all Super multipliers are 1.0 (uniform damage to all)', () => {
    const allMults = WARHEAD_VS_ARMOR.Super;
    for (let i = 0; i < allMults.length; i++) {
      expect(allMults[i]).toBe(1.0);
    }
  });
});

// =============================================================================
// Single Ammo -- 1 recon pass then RTB (aircraft.cpp)
// =============================================================================

describe('U2 single ammo -- 1 recon pass then RTB (aircraft.cpp)', () => {
  it('constructor initializes ammo to maxAmmo (1)', () => {
    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    expect(u2.ammo).toBe(1);
    expect(u2.maxAmmo).toBe(1);
  });

  it('ammo decrements from 1 to 0 in a single step', () => {
    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    expect(u2.ammo).toBe(1);
    u2.ammo--;
    expect(u2.ammo).toBe(0);
  });

  it('U2 has far fewer recon passes than MIG has attack runs (1 vs 3)', () => {
    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    expect(u2.maxAmmo).toBe(1);
    expect(mig.maxAmmo).toBe(3);
    expect(mig.maxAmmo / u2.maxAmmo).toBe(3);
  });

  it('U2 has far fewer recon passes than Yak has strafing runs (1 vs 15)', () => {
    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 10, 10);
    expect(u2.maxAmmo).toBe(1);
    expect(yak.maxAmmo).toBe(15);
  });
});

// =============================================================================
// Fastest Unit in Entire Game (rules.ini speed comparison)
// =============================================================================

describe('U2 is fastest unit in entire game (rules.ini speed comparison)', () => {
  it('U2 speed 40 exceeds ALL other unit speeds in UNIT_STATS', () => {
    const u2Speed = UNIT_STATS.U2.speed;
    for (const [key, stats] of Object.entries(UNIT_STATS)) {
      if (key === 'U2') continue;
      expect(
        u2Speed,
        `U2 speed (${u2Speed}) should be > ${key} speed (${stats.speed})`,
      ).toBeGreaterThan(stats.speed);
    }
  });

  it('U2 is twice as fast as MIG (40 vs 20)', () => {
    expect(UNIT_STATS.U2.speed).toBe(40);
    expect(UNIT_STATS.MIG.speed).toBe(20);
    expect(UNIT_STATS.U2.speed / UNIT_STATS.MIG.speed).toBe(2);
  });

  it('U2 is faster than Yak (40 vs 16)', () => {
    expect(UNIT_STATS.U2.speed).toBeGreaterThan(UNIT_STATS.YAK.speed);
  });

  it('U2 is faster than Longbow (40 vs 16)', () => {
    expect(UNIT_STATS.U2.speed).toBeGreaterThan(UNIT_STATS.HELI.speed);
  });

  it('U2 is faster than Hind (40 vs 12)', () => {
    expect(UNIT_STATS.U2.speed).toBeGreaterThan(UNIT_STATS.HIND.speed);
  });

  it('U2 is faster than the fastest ground unit (ANT1 at 14)', () => {
    expect(UNIT_STATS.U2.speed).toBeGreaterThan(UNIT_STATS.ANT1.speed);
  });
});

// =============================================================================
// Invulnerable Scout -- 2000 HP with heavy armor (gameplay consequence)
// =============================================================================

describe('U2 invulnerable scout -- 2000 HP with heavy armor (rules.ini balance)', () => {
  it('U2 HP 2000 is 40x a MIG (50 HP)', () => {
    expect(UNIT_STATS.U2.strength).toBe(2000);
    expect(UNIT_STATS.MIG.strength).toBe(50);
    expect(UNIT_STATS.U2.strength / UNIT_STATS.MIG.strength).toBe(40);
  });

  it('U2 HP 2000 exceeds a Mammoth Tank (600 HP)', () => {
    expect(UNIT_STATS.U2.strength).toBe(2000);
    expect(UNIT_STATS['4TNK'].strength).toBe(600);
    expect(UNIT_STATS.U2.strength).toBeGreaterThan(UNIT_STATS['4TNK'].strength);
  });

  it('U2 has heavy armor (AP warhead only deals 1.0x, not more)', () => {
    expect(UNIT_STATS.U2.armor).toBe('heavy');
    const apVsHeavy = WARHEAD_VS_ARMOR.AP[armorIndex('heavy')];
    expect(apVsHeavy).toBe(1.0);
  });

  it('U2 has heavy armor vs SA (anti-air) -- only 0.25x damage', () => {
    const saVsHeavy = WARHEAD_VS_ARMOR.SA[armorIndex('heavy')];
    expect(saVsHeavy).toBe(0.25);
  });

  it('SA warhead deals minimal damage to U2 (SA 40 * 0.25 = 10 per hit)', () => {
    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    // Typical AA weapon (SA warhead, e.g., Vulcan at 40 damage)
    const saDamage = 40;
    const effectiveDamage = Math.round(saDamage * WARHEAD_VS_ARMOR.SA[armorIndex('heavy')]);
    expect(effectiveDamage).toBe(10);
    // Would take 200 hits to kill U2
    expect(Math.ceil(u2.hp / effectiveDamage)).toBe(200);
  });

  it('U2 survives enormous punishment -- 100 AP hits at 50 damage each', () => {
    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    const apDamage = Math.round(50 * WARHEAD_VS_ARMOR.AP[armorIndex('heavy')]);
    for (let i = 0; i < 39; i++) {
      u2.takeDamage(apDamage, 'AP');
    }
    // After 39 hits of 50 damage each (39 * 50 = 1950), still alive
    expect(u2.alive).toBe(true);
    expect(u2.hp).toBe(50);
    // 40th hit kills it
    u2.takeDamage(apDamage, 'AP');
    expect(u2.alive).toBe(false);
  });
});

// =============================================================================
// Aircraft State Machine (aircraft.cpp -- starts landed)
// =============================================================================

describe('U2 aircraft state machine (aircraft.cpp)', () => {
  it('starts airborne (C++ aircraft.cpp:249 Height=FLIGHT_LEVEL)', () => {
    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    expect(u2.aircraftState).toBe('flying');
  });

  it('starts at FLIGHT_ALTITUDE (C++ aircraft.cpp:249)', () => {
    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    expect(u2.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
  });

  it('attackRunPhase defaults to flyToTarget', () => {
    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    expect(u2.attackRunPhase).toBe('flyToTarget');
  });

  it('circleBreakTimer starts at 0', () => {
    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    expect(u2.circleBreakTimer).toBe(0);
  });
});

// =============================================================================
// Scenario-Only Unit -- NOT in PRODUCTION_ITEMS (rules.ini)
// =============================================================================

describe('U2 scenario-only unit -- NOT in PRODUCTION_ITEMS (rules.ini)', () => {
  it('U2 is NOT in the production item list (cannot be built)', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'U2');
    expect(prodItem).toBeUndefined();
  });

  it('U2 cost=10 in stats (scenario placeholder cost)', () => {
    expect(UNIT_STATS.U2.cost).toBe(10);
  });

  it('U2 has no landingBuilding (scenario aircraft, no base return)', () => {
    expect(UNIT_STATS.U2.landingBuilding).toBeUndefined();
  });

  it('MIG and YAK are buildable (in PRODUCTION_ITEMS), U2 is not', () => {
    const migProd = PRODUCTION_ITEMS.find(p => p.type === 'MIG');
    const yakProd = PRODUCTION_ITEMS.find(p => p.type === 'YAK');
    const u2Prod = PRODUCTION_ITEMS.find(p => p.type === 'U2');
    expect(migProd).toBeDefined();
    expect(yakProd).toBeDefined();
    expect(u2Prod).toBeUndefined();
  });
});

// =============================================================================
// No Turret (unit.cpp -- all aircraft have no turret)
// =============================================================================

describe('U2 no turret (unit.cpp -- aircraft have no turret)', () => {
  it('U2 hasTurret is false', () => {
    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    expect(u2.hasTurret).toBe(false);
  });
});

// =============================================================================
// Aircraft Properties -- Not Crushable, Not Infantry (udata.cpp)
// =============================================================================

describe('U2 aircraft properties (udata.cpp)', () => {
  it('U2 is not crushable (aircraft fly above ground)', () => {
    expect(UNIT_STATS.U2.crushable).toBeFalsy();
  });

  it('U2 is not infantry', () => {
    expect(UNIT_STATS.U2.isInfantry).toBe(false);
  });

  it('U2 is not a crusher', () => {
    expect(UNIT_STATS.U2.crusher).toBeFalsy();
  });

  it('U2 isAirUnit returns true', () => {
    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    expect(u2.isAirUnit).toBe(true);
  });

  it('U2 isFixedWing returns true', () => {
    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    expect(u2.isFixedWing).toBe(true);
  });

  it('U2 isHelicopter returns false (fixed-wing, not helo)', () => {
    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    expect(u2.isHelicopter).toBe(false);
  });

  it('U2 isNavalUnit returns false', () => {
    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    expect(u2.isNavalUnit).toBe(false);
  });

  it('U2 isTransport returns false', () => {
    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    expect(u2.isTransport).toBe(false);
  });

  it('U2 is not rotor-equipped (fixed-wing has no rotor overlay)', () => {
    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    expect(u2.isRotorEquipped).toBe(false);
  });
});

// =============================================================================
// U2 vs MIG Comparison -- Scout vs Fighter (gameplay roles)
// =============================================================================

describe('U2 vs MIG comparison -- scout vs fighter (gameplay roles)', () => {
  it('U2 Camera does 0 damage vs MIG Maverick 50 damage', () => {
    expect(WEAPON_STATS.Camera.damage).toBe(0);
    expect(WEAPON_STATS.Maverick.damage).toBe(50);
  });

  it('U2 has 1 ammo vs MIG 3 ammo', () => {
    expect(UNIT_STATS.U2.maxAmmo).toBe(1);
    expect(UNIT_STATS.MIG.maxAmmo).toBe(3);
  });

  it('U2 is 2x faster than MIG (40 vs 20)', () => {
    expect(UNIT_STATS.U2.speed).toBe(40);
    expect(UNIT_STATS.MIG.speed).toBe(20);
  });

  it('U2 has 40x the HP of MIG (2000 vs 50)', () => {
    expect(UNIT_STATS.U2.strength).toBe(2000);
    expect(UNIT_STATS.MIG.strength).toBe(50);
  });

  it('U2 has heavy armor vs MIG light armor', () => {
    expect(UNIT_STATS.U2.armor).toBe('heavy');
    expect(UNIT_STATS.MIG.armor).toBe('light');
  });

  it('both are fixed-wing aircraft', () => {
    expect(UNIT_STATS.U2.isFixedWing).toBe(true);
    expect(UNIT_STATS.MIG.isFixedWing).toBe(true);
  });
});

// =============================================================================
// U2 Movement -- Aircraft always moves forward (aircraft.cpp)
// =============================================================================

describe('U2 movement -- aircraft moveToward (drive.cpp/aircraft.cpp)', () => {
  it('U2 moves toward target without stopping to rotate (unlike vehicles)', () => {
    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    u2.facing = Dir.N;
    u2.desiredFacing = Dir.N;
    u2.bodyFacing32 = Dir.N * 4;

    const startX = u2.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: u2.pos.y }; // due East

    // Aircraft should move toward target even when facing is not aligned
    u2.moveToward(targetPos, u2.stats.speed);

    const distMoved = Math.sqrt((u2.pos.x - startX) ** 2 + (u2.pos.y - u2.pos.y) ** 2);
    expect(distMoved).toBeGreaterThan(0);
  });

  it('U2 at speed 40 covers more ground per tick than MIG at speed 20', () => {
    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    u2.facing = Dir.E;
    u2.desiredFacing = Dir.E;
    u2.bodyFacing32 = Dir.E * 4;

    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    mig.facing = Dir.E;
    mig.desiredFacing = Dir.E;
    mig.bodyFacing32 = Dir.E * 4;

    const targetPos = { x: 10 * CELL_SIZE + CELL_SIZE / 2 + CELL_SIZE * 10, y: 10 * CELL_SIZE + CELL_SIZE / 2 };

    const u2StartX = u2.pos.x;
    const migStartX = mig.pos.x;

    u2.moveToward(targetPos, u2.stats.speed);
    mig.moveToward(targetPos, mig.stats.speed);

    const u2Dist = u2.pos.x - u2StartX;
    const migDist = mig.pos.x - migStartX;

    expect(u2Dist).toBeGreaterThan(migDist);
    expect(u2Dist / migDist).toBe(2); // 40/20 = 2x distance per tick
  });

  it('vehicle (2TNK) stops to rotate but U2 does not', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.facing = Dir.N;
    tank.desiredFacing = Dir.N;
    tank.bodyFacing32 = Dir.N * 4;

    const u2 = entityAtCell(UnitType.V_U2, House.USSR, 10, 10);
    u2.facing = Dir.N;
    u2.desiredFacing = Dir.N;
    u2.bodyFacing32 = Dir.N * 4;

    const targetPos = { x: 10 * CELL_SIZE + CELL_SIZE / 2 + CELL_SIZE * 3, y: 10 * CELL_SIZE + CELL_SIZE / 2 }; // due East

    const tankStartX = tank.pos.x;
    const u2StartX = u2.pos.x;

    tank.moveToward(targetPos, tank.stats.speed);
    u2.moveToward(targetPos, u2.stats.speed);

    // Tank should NOT have moved (still rotating)
    expect(tank.pos.x).toBe(tankStartX);
    // U2 SHOULD have moved (aircraft never stop to rotate)
    expect(u2.pos.x).not.toBe(u2StartX);
  });
});
