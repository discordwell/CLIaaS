/**
 * Projectile Speed Parity Tests — C++ BulletClass Speed verification.
 *
 * Documents the mapping between C++ Speed= (leptons/tick) and TS projSpeed.
 * After the Phase 2 weapon/projectile audit, projSpeed values match
 * rules.ini/aftrmath.ini Speed= values directly (raw C++ integers).
 *
 * C++ Speed= values by projectile type:
 *   Invisible: Speed=100 (hitscan weapons)
 *   Cannon:    Speed=40  (tank shells, varies per weapon: 2Inch=25)
 *   HeatSeeker: Speed varies (Dragon=25, Hellfire/Maverick/MammothTusk/APTusk=30)
 *   LaserGuided: Speed=20 (Stinger)
 *   AAMissile: Speed=50 (RedEye, Nike)
 *   Lobbed:    Speed=5 (Grenade)
 *   Ballistic: Speed varies (155mm=12, 8Inch=6)
 *   Fireball:  Speed=12 (Flamer, FireballLauncher)
 *   Bomblet:   Speed=5 (Napalm)
 *   Catapult:  Speed=5 (DepthCharge)
 *   FROG:      Speed=25 (SCUD)
 *   Torpedo:   Speed=15 (TorpTube)
 *   Parachute: Speed=5 (ParaBomb)
 *   LeapDog:   Speed=20 (DogJaw)
 */

import { describe, it, expect } from 'vitest';
import {
  CELL_SIZE, LEPTON_SIZE, GAME_TICKS_PER_SEC,
  calcProjectileTravelFrames,
} from '../engine/types';
import { WEAPON_STATS } from '../engine/types';

// ============================================================
// Section 1: Unit system conversion verification
// ============================================================
describe('unit system conversion: C++ leptons/tick ↔ TS cells/sec', () => {
  function cppSpeedToTSProjSpeed(cppSpeed: number): number {
    return (cppSpeed * GAME_TICKS_PER_SEC) / LEPTON_SIZE;
  }

  function tsProjSpeedToCppSpeed(projSpeed: number): number {
    return (projSpeed * LEPTON_SIZE) / GAME_TICKS_PER_SEC;
  }

  it('conversion is reversible', () => {
    const cppSpeed = 100;
    const tsSpeed = cppSpeedToTSProjSpeed(cppSpeed);
    expect(tsProjSpeedToCppSpeed(tsSpeed)).toBeCloseTo(cppSpeed, 10);
  });

  it('C++ ROCKET speed (60 MPH) → ~4.69 cells/sec', () => {
    const result = cppSpeedToTSProjSpeed(60);
    expect(result).toBeCloseTo(4.6875, 3);
  });
});

// ============================================================
// Section 2: Per-weapon projSpeed values by projectile type
// ============================================================
describe('weapon projSpeed values — all defined weapons', () => {
  // Invisible projectile weapons (Speed=100)
  const INVISIBLE_WEAPONS = [
    'M1Carbine', 'Sniper', 'ChainGun', 'Pistol', 'Colt45',
    'M60mg', 'Heal', 'Camera', 'PortaTesla', 'GoodWrench',
    'TTankZap', 'Democharge', 'TeslaZap',
  ];

  it('Invisible-projectile weapons have projSpeed=100', () => {
    for (const name of INVISIBLE_WEAPONS) {
      const weapon = WEAPON_STATS[name];
      expect(weapon, `${name} not found in WEAPON_STATS`).toBeDefined();
      expect(weapon.projSpeed, `${name} projSpeed`).toBe(100);
    }
  });

  // Cannon projectile weapons (Speed=40)
  const CANNON_40_WEAPONS = ['75mm', '90mm', '105mm', '120mm'];
  it('Cannon-projectile weapons (tanks) have projSpeed=40', () => {
    for (const name of CANNON_40_WEAPONS) {
      expect(WEAPON_STATS[name]?.projSpeed, `${name} projSpeed`).toBe(40);
    }
  });

  // HeatSeeker projectile weapons (Speed varies: 25-30)
  it('Dragon has projSpeed=25 (rules.ini Speed=25)', () => {
    expect(WEAPON_STATS.Dragon?.projSpeed).toBe(25);
  });

  it('Hellfire/Maverick/MammothTusk/APTusk have projSpeed=30', () => {
    expect(WEAPON_STATS.Hellfire?.projSpeed).toBe(30);
    expect(WEAPON_STATS.Maverick?.projSpeed).toBe(30);
    expect(WEAPON_STATS.MammothTusk?.projSpeed).toBe(30);
    expect(WEAPON_STATS.APTusk?.projSpeed).toBe(30);
  });

  // LaserGuided (Stinger: Speed=20)
  it('Stinger has projSpeed=20 (LaserGuided Speed=20)', () => {
    expect(WEAPON_STATS.Stinger?.projSpeed).toBe(20);
  });

  // AAMissile (RedEye: Speed=50)
  it('RedEye has projSpeed=50 (AAMissile Speed=50)', () => {
    expect(WEAPON_STATS.RedEye?.projSpeed).toBe(50);
  });

  // Fireball (Speed=12)
  it('Flamer and FireballLauncher have projSpeed=12 (Fireball Speed=12)', () => {
    expect(WEAPON_STATS.Flamer?.projSpeed).toBe(12);
    expect(WEAPON_STATS.FireballLauncher?.projSpeed).toBe(12);
  });

  // Lobbed (Grenade: Speed=5)
  it('Grenade has projSpeed=5 (Lobbed Speed=5)', () => {
    expect(WEAPON_STATS.Grenade?.projSpeed).toBe(5);
  });

  // Ballistic (155mm: Speed=12, 8Inch: Speed=6)
  it('155mm has projSpeed=12 (Ballistic Speed=12)', () => {
    expect(WEAPON_STATS['155mm']?.projSpeed).toBe(12);
  });

  it('8Inch has projSpeed=6 (Ballistic Speed=6)', () => {
    expect(WEAPON_STATS['8Inch']?.projSpeed).toBe(6);
  });

  // Other specific weapons
  it('2Inch has projSpeed=25 (Cannon Speed=25)', () => {
    expect(WEAPON_STATS['2Inch']?.projSpeed).toBe(25);
  });

  it('DogJaw has projSpeed=20 (LeapDog Speed=20)', () => {
    expect(WEAPON_STATS.DogJaw?.projSpeed).toBe(20);
  });

  it('DepthCharge has projSpeed=5 (Catapult Speed=5)', () => {
    expect(WEAPON_STATS.DepthCharge?.projSpeed).toBe(5);
  });

  it('Napalm has projSpeed=5 (Bomblet Speed=5)', () => {
    expect(WEAPON_STATS.Napalm?.projSpeed).toBe(5);
  });

  it('SCUD has projSpeed=25 (FROG Speed=25)', () => {
    expect(WEAPON_STATS.SCUD?.projSpeed).toBe(25);
  });

  it('SubSCUD has projSpeed=20', () => {
    expect(WEAPON_STATS.SubSCUD?.projSpeed).toBe(20);
  });

  it('TorpTube has projSpeed=15 (Torpedo Speed=15)', () => {
    expect(WEAPON_STATS.TorpTube?.projSpeed).toBe(15);
  });

  it('ParaBomb has projSpeed=5 (Parachute Speed=5)', () => {
    expect(WEAPON_STATS.ParaBomb?.projSpeed).toBe(5);
  });

  // Engine-custom weapons (not from rules.ini, values are engine-specific)
  it('TeslaCannon has projSpeed=40 (engine custom)', () => {
    expect(WEAPON_STATS.TeslaCannon?.projSpeed).toBe(40);
  });

  it('Mandible has projSpeed=40 (engine custom, ant melee)', () => {
    expect(WEAPON_STATS.Mandible?.projSpeed).toBe(40);
  });
});

// ============================================================
// Section 3: pixelsPerTick derived values
// ============================================================
describe('pixelsPerTick derivation from projSpeed', () => {
  function pixelsPerTick(projSpeed: number): number {
    return projSpeed * CELL_SIZE / GAME_TICKS_PER_SEC;
  }

  it('projSpeed=100 → 120 pixels/tick (hitscan instant)', () => {
    expect(pixelsPerTick(100)).toBe(120);
  });

  it('projSpeed=40 → 48 pixels/tick (cannon shells)', () => {
    expect(pixelsPerTick(40)).toBe(48);
  });

  it('projSpeed=30 → 36 pixels/tick (missiles)', () => {
    expect(pixelsPerTick(30)).toBe(36);
  });

  it('projSpeed=12 → 14.4 pixels/tick (arcing/fireball)', () => {
    expect(pixelsPerTick(12)).toBeCloseTo(14.4, 5);
  });

  it('projSpeed=5 → 6 pixels/tick (parabombs/grenades)', () => {
    expect(pixelsPerTick(5)).toBe(6);
  });
});

// ============================================================
// Section 4: Travel time examples at combat ranges
// ============================================================
describe('travel time at typical combat ranges', () => {
  it('rifle at 3 cells: projSpeed=100 → 1 tick (instant)', () => {
    const dist = 3 * CELL_SIZE;
    expect(calcProjectileTravelFrames(dist, 100)).toBe(1);
  });

  it('tank cannon at 4.75 cells: projSpeed=40 → 3 ticks', () => {
    const dist = 4.75 * CELL_SIZE;
    const pixPerTick = 40 * CELL_SIZE / GAME_TICKS_PER_SEC;
    const expected = Math.ceil(dist / pixPerTick);
    expect(calcProjectileTravelFrames(dist, 40)).toBe(expected);
  });

  it('missile at 5 cells: projSpeed=30 → 4 ticks', () => {
    const dist = 5 * CELL_SIZE;
    // pixPerTick = 30*24/20 = 36, ceil(120/36) = 4
    expect(calcProjectileTravelFrames(dist, 30)).toBe(4);
  });

  it('artillery at 6 cells: projSpeed=12 → 10 ticks', () => {
    const dist = 6 * CELL_SIZE;
    const pixPerTick = 12 * CELL_SIZE / GAME_TICKS_PER_SEC;
    const expected = Math.ceil(dist / pixPerTick);
    expect(calcProjectileTravelFrames(dist, 12)).toBe(expected);
  });

  it('V2 rocket at 10 cells: projSpeed=25 → 8 ticks', () => {
    const dist = 10 * CELL_SIZE;
    const pixPerTick = 25 * CELL_SIZE / GAME_TICKS_PER_SEC;
    const expected = Math.ceil(dist / pixPerTick);
    expect(calcProjectileTravelFrames(dist, 25)).toBe(expected);
  });
});

// ============================================================
// Section 5: All weapons have projSpeed defined
// ============================================================
describe('all weapons have projSpeed defined', () => {
  it('every weapon in WEAPON_STATS has a projSpeed value', () => {
    const missing: string[] = [];
    for (const [name, weapon] of Object.entries(WEAPON_STATS)) {
      if (weapon.projSpeed === undefined) {
        missing.push(name);
      }
    }
    expect(missing, `weapons missing projSpeed: ${missing.join(', ')}`).toEqual([]);
  });

  it('all projSpeed values are positive numbers', () => {
    for (const [name, weapon] of Object.entries(WEAPON_STATS)) {
      if (weapon.projSpeed !== undefined) {
        expect(weapon.projSpeed, `${name} projSpeed`).toBeGreaterThan(0);
      }
    }
  });
});
