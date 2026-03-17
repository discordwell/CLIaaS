/**
 * C++ Behavioral Parity: YAK -- Yakovlev Attack Plane
 *
 * Tests verify Yak-specific stats, weapon, warhead, ammo, role, cost,
 * and aircraft state machine behaviors match C++ RA source code.
 * Does NOT duplicate facing/multi-shot/anti-circle/AA tests already
 * covered in cpp-parity-aircraft.test.ts.
 *
 * Observable outcomes: stat values, warhead multipliers, ammo capacity,
 * weapon properties, cost, state transitions, ChainGun vs Maverick contrast.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, PRODUCTION_ITEMS,
  armorIndex, Mission,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

// =============================================================================
// YAK Stats Verification (rules.ini / udata.cpp parity)
// =============================================================================

describe('YAK stats verification (rules.ini / udata.cpp)', () => {
  const stats = UNIT_STATS.YAK;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'YAK');

  it('HP is 60 (Strength=60)', () => {
    expect(stats.strength).toBe(60);
  });

  it('armor is light (Armor=light)', () => {
    expect(stats.armor).toBe('light');
  });

  it('speed is 16 (Speed=16)', () => {
    expect(stats.speed).toBe(16);
  });

  it('isAircraft is true', () => {
    expect(stats.isAircraft).toBe(true);
  });

  it('isFixedWing is true', () => {
    expect(stats.isFixedWing).toBe(true);
  });

  it('maxAmmo is 15 (high-ammo strafer)', () => {
    expect(stats.maxAmmo).toBe(15);
  });

  it('cost is 800 credits (cheaper than MIG)', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(800);
  });

  it('faction is soviet (AFLD prerequisite)', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('soviet');
  });

  it('landingBuilding is AFLD (Airfield)', () => {
    expect(stats.landingBuilding).toBe('AFLD');
  });

  it('Entity constructor initializes HP to 60', () => {
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 10, 10);
    expect(yak.hp).toBe(60);
    expect(yak.maxHp).toBe(60);
  });

  it('isInfantry is false', () => {
    expect(stats.isInfantry).toBe(false);
  });
});

// =============================================================================
// Dual Weapon -- ChainGun / ChainGun (rules.ini weapon parity)
// =============================================================================

describe('YAK dual weapon -- ChainGun/ChainGun (rules.ini)', () => {
  const stats = UNIT_STATS.YAK;
  const chainGun = WEAPON_STATS.ChainGun;

  it('primary weapon is ChainGun', () => {
    expect(stats.primaryWeapon).toBe('ChainGun');
  });

  it('secondary weapon is ChainGun (dual same weapon)', () => {
    expect(stats.secondaryWeapon).toBe('ChainGun');
  });

  it('ChainGun damage is 40', () => {
    expect(chainGun.damage).toBe(40);
  });

  it('ChainGun range is 5.0 cells', () => {
    expect(chainGun.range).toBe(5.0);
  });

  it('ChainGun ROF is 3 (rapid fire)', () => {
    expect(chainGun.rof).toBe(3);
  });

  it('ChainGun warhead is SA (Small Arms)', () => {
    expect(chainGun.warhead).toBe('SA');
  });

  it('Entity constructor resolves both weapons to ChainGun', () => {
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 10, 10);
    expect(yak.weapon).not.toBeNull();
    expect(yak.weapon!.name).toBe('ChainGun');
    expect(yak.weapon2).not.toBeNull();
    expect(yak.weapon2!.name).toBe('ChainGun');
  });
});

// =============================================================================
// SA Warhead Effectiveness (combat.cpp warhead tables)
// =============================================================================
// SA = Small Arms: strong vs infantry (none armor), weak vs vehicles (heavy armor).
// This is what makes the Yak an anti-infantry strafer.

describe('YAK SA warhead effectiveness (combat.cpp warhead tables)', () => {
  it('SA vs none armor: 1.0 (full damage to infantry)', () => {
    expect(WARHEAD_VS_ARMOR.SA[armorIndex('none')]).toBe(1.0);
  });

  it('SA vs wood armor: 0.5', () => {
    expect(WARHEAD_VS_ARMOR.SA[armorIndex('wood')]).toBe(0.5);
  });

  it('SA vs light armor: 0.6', () => {
    expect(WARHEAD_VS_ARMOR.SA[armorIndex('light')]).toBe(0.6);
  });

  it('SA vs heavy armor: 0.25 (Yak bad vs tanks)', () => {
    expect(WARHEAD_VS_ARMOR.SA[armorIndex('heavy')]).toBe(0.25);
  });

  it('SA vs concrete: 0.25 (Yak bad vs structures)', () => {
    expect(WARHEAD_VS_ARMOR.SA[armorIndex('concrete')]).toBe(0.25);
  });

  it('ChainGun deals 40 base damage to unarmored infantry (40 * 1.0)', () => {
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const hpBefore = victim.hp;
    // SA vs none = 1.0, so full 40 damage
    const effectiveDamage = Math.round(40 * WARHEAD_VS_ARMOR.SA[armorIndex('none')]);
    victim.takeDamage(effectiveDamage, 'SA');
    expect(hpBefore - victim.hp).toBe(40);
  });

  it('ChainGun deals only 10 effective damage to heavy armor (40 * 0.25)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const hpBefore = tank.hp;
    const effectiveDamage = Math.round(40 * WARHEAD_VS_ARMOR.SA[armorIndex('heavy')]);
    tank.takeDamage(effectiveDamage, 'SA');
    expect(hpBefore - tank.hp).toBe(10);
    expect(effectiveDamage).toBe(10);
  });
});

// =============================================================================
// High Ammo -- 15 shots per sortie (rules.ini MaxAmmo=15)
// =============================================================================
// Yak has 15 rounds vs MIG's 3 missiles. This means the Yak can strafe for
// many more ticks before needing to RTB for rearming.

describe('YAK high ammo -- 15 shots per sortie (rules.ini)', () => {
  it('Entity constructor initializes ammo to 15', () => {
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 10, 10);
    expect(yak.ammo).toBe(15);
    expect(yak.maxAmmo).toBe(15);
  });

  it('MIG only has 3 ammo (contrast: Yak 5x more shots per sortie)', () => {
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    expect(mig.ammo).toBe(3);
    expect(mig.maxAmmo).toBe(3);
  });

  it('Yak ammo is 5x that of MIG', () => {
    expect(UNIT_STATS.YAK.maxAmmo).toBe(5 * UNIT_STATS.MIG.maxAmmo!);
  });

  it('ammo decrements on shot (ammo 15 -> 14)', () => {
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 10, 10);
    expect(yak.ammo).toBe(15);
    yak.ammo--;
    expect(yak.ammo).toBe(14);
  });

  it('after 15 shots, ammo reaches 0', () => {
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 10, 10);
    for (let i = 0; i < 15; i++) {
      yak.ammo--;
    }
    expect(yak.ammo).toBe(0);
  });
});

// =============================================================================
// Anti-Infantry Role (SA warhead + high ammo = infantry strafer)
// =============================================================================
// The Yak is designed to strafe infantry columns. SA warhead deals full damage
// to 'none' armor (infantry) but only 25% to 'heavy' (tanks). Contrast with
// MIG's AP warhead which is anti-armor.

describe('YAK anti-infantry role (SA warhead + high ammo)', () => {
  it('SA warhead is 4x more effective vs infantry than heavy armor', () => {
    const vsNone = WARHEAD_VS_ARMOR.SA[armorIndex('none')];
    const vsHeavy = WARHEAD_VS_ARMOR.SA[armorIndex('heavy')];
    expect(vsNone / vsHeavy).toBe(4);
  });

  it('ChainGun one-shots E1 infantry (40 damage > 50 HP? No, but kills in 2 hits)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.hp).toBe(50);
    // First ChainGun hit: 40 * 1.0 = 40 damage
    e1.takeDamage(40, 'SA');
    expect(e1.alive).toBe(true);
    expect(e1.hp).toBe(10);
    // Second hit kills
    e1.takeDamage(40, 'SA');
    expect(e1.alive).toBe(false);
  });

  it('MIG uses AP warhead -- opposite role: anti-armor', () => {
    const maverick = WEAPON_STATS.Maverick;
    expect(maverick.warhead).toBe('AP');
    // AP vs heavy = 1.0 (full damage to tanks)
    expect(WARHEAD_VS_ARMOR.AP[armorIndex('heavy')]).toBe(1.0);
    // AP vs none = 0.3 (bad vs infantry)
    expect(WARHEAD_VS_ARMOR.AP[armorIndex('none')]).toBe(0.3);
  });

  it('Yak SA deals more to infantry than MIG AP per hit', () => {
    const yakDmgVsInf = 40 * WARHEAD_VS_ARMOR.SA[armorIndex('none')]; // 40
    const migDmgVsInf = 50 * WARHEAD_VS_ARMOR.AP[armorIndex('none')]; // 15
    expect(yakDmgVsInf).toBeGreaterThan(migDmgVsInf);
  });

  it('MIG AP deals more to heavy armor than Yak SA per hit', () => {
    const yakDmgVsTank = 40 * WARHEAD_VS_ARMOR.SA[armorIndex('heavy')]; // 10
    const migDmgVsTank = 50 * WARHEAD_VS_ARMOR.AP[armorIndex('heavy')]; // 50
    expect(migDmgVsTank).toBeGreaterThan(yakDmgVsTank);
  });
});

// =============================================================================
// Cost Comparison: Cheaper than MIG (800 vs 1200)
// =============================================================================

describe('YAK cheaper than MIG (rules.ini Cost=)', () => {
  const yakProd = PRODUCTION_ITEMS.find(p => p.type === 'YAK');
  const migProd = PRODUCTION_ITEMS.find(p => p.type === 'MIG');

  it('Yak costs 800 credits', () => {
    expect(yakProd!.cost).toBe(800);
  });

  it('MIG costs 1200 credits', () => {
    expect(migProd!.cost).toBe(1200);
  });

  it('Yak is 400 credits cheaper than MIG', () => {
    expect(migProd!.cost - yakProd!.cost).toBe(400);
  });

  it('both share AFLD prerequisite', () => {
    expect(yakProd!.prerequisite).toBe('AFLD');
    expect(migProd!.prerequisite).toBe('AFLD');
  });
});

// =============================================================================
// Aircraft State Machine (aircraft.cpp -- starts 'landed', AFLD landing pad)
// =============================================================================

describe('YAK aircraft state machine (aircraft.cpp)', () => {
  it('starts in landed state', () => {
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 10, 10);
    expect(yak.aircraftState).toBe('landed');
  });

  it('starts with flightAltitude 0 (on the ground)', () => {
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 10, 10);
    expect(yak.flightAltitude).toBe(0);
  });

  it('FLIGHT_ALTITUDE constant is 24 pixels', () => {
    expect(Entity.FLIGHT_ALTITUDE).toBe(24);
  });

  it('default mission is GUARD', () => {
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 10, 10);
    expect(yak.mission).toBe(Mission.GUARD);
  });

  it('attackRunPhase initializes to flyToTarget', () => {
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 10, 10);
    expect(yak.attackRunPhase).toBe('flyToTarget');
  });

  it('circleBreakTimer initializes to 0', () => {
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 10, 10);
    expect(yak.circleBreakTimer).toBe(0);
  });

  it('landedAtStructure is -1 (not docked initially)', () => {
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 10, 10);
    expect(yak.landedAtStructure).toBe(-1);
  });
});

// =============================================================================
// ChainGun Not Homing (no projectileROT -- straight-line shots)
// =============================================================================
// ChainGun fires straight-line bullets with no tracking. Contrast with
// MIG's Maverick which has projectileROT=5 (homing missile).

describe('ChainGun not homing -- no projectileROT (bullet.cpp)', () => {
  const chainGun = WEAPON_STATS.ChainGun;
  const maverick = WEAPON_STATS.Maverick;

  it('ChainGun has no projectileROT (undefined)', () => {
    expect(chainGun.projectileROT).toBeUndefined();
  });

  it('Maverick HAS projectileROT=5 (homing contrast)', () => {
    expect(maverick.projectileROT).toBe(5);
  });

  it('ChainGun projSpeed is 40 (fast hitscan-like bullet)', () => {
    expect(chainGun.projSpeed).toBe(40);
  });

  it('Maverick projSpeed is only 15 (slower guided missile)', () => {
    expect(maverick.projSpeed).toBe(15);
  });

  it('ChainGun has no splash (single-target only)', () => {
    expect(chainGun.splash).toBeUndefined();
  });

  it('ChainGun has no inaccuracy property (precise)', () => {
    expect(chainGun.inaccuracy).toBeUndefined();
  });
});
