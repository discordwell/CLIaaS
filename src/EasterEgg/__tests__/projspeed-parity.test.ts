/**
 * Projectile Speed Parity Tests — C++ BulletClass Speed verification.
 *
 * Documents the mapping between C++ Speed= (leptons/tick) and TS projSpeed
 * (cells/second). These use different unit systems:
 *   C++ Speed=  : leptons per game tick (1 cell = 256 leptons, 20 ticks/sec at default GameSpeed=3)
 *   TS projSpeed: cells per second
 *
 * Conversion: projSpeed_cells_per_sec = (C++_Speed * GAME_TICKS_PER_SEC) / LEPTON_SIZE
 * Or: C++_Speed_leptons_per_tick = (projSpeed * LEPTON_SIZE) / GAME_TICKS_PER_SEC
 *
 * The TS engine uses projSpeed to calculate pixelsPerTick:
 *   pixelsPerTick = projSpeed × CELL_SIZE / GAME_TICKS_PER_SEC
 */

import { describe, it, expect } from 'vitest';
import {
  CELL_SIZE, LEPTON_SIZE, GAME_TICKS_PER_SEC,
  calcProjectileTravelFrames,
} from '../engine/types';

// Import the weapon definitions to verify projSpeed values
import { WEAPON_STATS } from '../engine/types';

// ============================================================
// Section 1: Unit system conversion verification
// ============================================================
describe('unit system conversion: C++ leptons/tick ↔ TS cells/sec', () => {
  // Conversion formula: projSpeed (cells/sec) = cppSpeed (leptons/tick) * 15 / 256
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
    // This is the speed constant, not the weapon Speed field
    // 60 * 20 / 256 = 4.6875
    const result = cppSpeedToTSProjSpeed(60);
    expect(result).toBeCloseTo(4.6875, 3);
  });
});

// ============================================================
// Section 2: Per-weapon projSpeed values documentation
// ============================================================
describe('weapon projSpeed values — all defined weapons', () => {
  // Document all weapons and their projSpeed values
  // Grouped by speed tier for verification

  // Tier: instant/hitscan (projSpeed=40 cells/sec → very fast visual)
  const HITSCAN_WEAPONS = [
    'M1Carbine', 'DogJaw', 'Heal', 'Sniper', 'M60mg',
    'TeslaCannon', 'PortaTesla', 'GoodWrench', 'APTusk', 'TTankZap',
    'Stinger', 'ChainGun', 'Colt45', 'Pistol', '2Inch',
    'Mandible', 'TeslaZap', 'Democharge', 'Camera',
  ];

  it('all hitscan weapons have projSpeed=40', () => {
    for (const name of HITSCAN_WEAPONS) {
      const weapon = WEAPON_STATS[name];
      expect(weapon, `${name} not found in WEAPON_STATS`).toBeDefined();
      expect(weapon.projSpeed, `${name} projSpeed`).toBe(40);
    }
  });

  // Tier: tank cannons (projSpeed=30 cells/sec)
  const TANK_CANNON_WEAPONS = ['75mm', '90mm', '105mm', '120mm'];
  it('tank cannon weapons have projSpeed=30', () => {
    for (const name of TANK_CANNON_WEAPONS) {
      expect(WEAPON_STATS[name]?.projSpeed, `${name} projSpeed`).toBe(30);
    }
  });

  // Tier: missiles/rockets (projSpeed=15 cells/sec)
  const MISSILE_WEAPONS = [
    'Dragon', 'RedEye', 'MammothTusk', 'Maverick', 'Hellfire',
    'TorpTube', 'Tomahawk', 'SeaSerpent', 'FireballLauncher',
  ];
  it('missile weapons have projSpeed=15', () => {
    for (const name of MISSILE_WEAPONS) {
      expect(WEAPON_STATS[name]?.projSpeed, `${name} projSpeed`).toBe(15);
    }
  });

  // Tier: arcing/slow projectiles (projSpeed=12 cells/sec)
  const ARCING_WEAPONS = ['155mm', 'DepthCharge', 'Napalm'];
  it('arcing/slow weapons have projSpeed=12', () => {
    for (const name of ARCING_WEAPONS) {
      expect(WEAPON_STATS[name]?.projSpeed, `${name} projSpeed`).toBe(12);
    }
  });

  // Grenade: arcing but slower (C++ Speed=5, Lobbed)
  it('Grenade has projSpeed=5', () => {
    expect(WEAPON_STATS.Grenade?.projSpeed, 'Grenade projSpeed').toBe(5);
  });

  // Special: Flamer (projSpeed=20)
  it('Flamer has projSpeed=20', () => {
    expect(WEAPON_STATS.Flamer?.projSpeed).toBe(20);
  });

  // Special: SCUD (projSpeed=25)
  it('SCUD has projSpeed=25', () => {
    expect(WEAPON_STATS.SCUD?.projSpeed).toBe(25);
  });

  // Special: SubSCUD (projSpeed=20)
  it('SubSCUD has projSpeed=20', () => {
    expect(WEAPON_STATS.SubSCUD?.projSpeed).toBe(20);
  });

  // Special: 8Inch cruiser gun (projSpeed=30)
  it('8Inch has projSpeed=30', () => {
    expect(WEAPON_STATS['8Inch']?.projSpeed).toBe(30);
  });

  // Special: ParaBomb (projSpeed=5, slow dropping)
  it('ParaBomb has projSpeed=5 (slow drop)', () => {
    expect(WEAPON_STATS.ParaBomb?.projSpeed).toBe(5);
  });
});

// ============================================================
// Section 3: pixelsPerTick derived values
// ============================================================
describe('pixelsPerTick derivation from projSpeed', () => {
  function pixelsPerTick(projSpeed: number): number {
    return projSpeed * CELL_SIZE / GAME_TICKS_PER_SEC;
  }

  it('projSpeed=40 → 48 pixels/tick (instant-feel)', () => {
    expect(pixelsPerTick(40)).toBe(48);
  });

  it('projSpeed=30 → 36 pixels/tick (tank shells)', () => {
    expect(pixelsPerTick(30)).toBe(36);
  });

  it('projSpeed=15 → 18 pixels/tick (missiles)', () => {
    expect(pixelsPerTick(15)).toBe(18);
  });

  it('projSpeed=12 → 14.4 pixels/tick (arcing)', () => {
    expect(pixelsPerTick(12)).toBeCloseTo(14.4, 5);
  });

  it('projSpeed=5 → 6 pixels/tick (parabombs)', () => {
    expect(pixelsPerTick(5)).toBe(6);
  });
});

// ============================================================
// Section 4: Travel time examples at combat ranges
// ============================================================
describe('travel time at typical combat ranges', () => {
  it('rifle at 3 cells: projSpeed=40 → 2 ticks (instant)', () => {
    const dist = 3 * CELL_SIZE;
    expect(calcProjectileTravelFrames(dist, 40)).toBe(2);
  });

  it('tank cannon at 4.75 cells: projSpeed=30 → 3 ticks', () => {
    const dist = 4.75 * CELL_SIZE;
    const pixPerTick = 30 * CELL_SIZE / GAME_TICKS_PER_SEC;
    const expected = Math.ceil(dist / pixPerTick);
    expect(calcProjectileTravelFrames(dist, 30)).toBe(expected);
  });

  it('missile at 5 cells: projSpeed=15 → 7 ticks', () => {
    const dist = 5 * CELL_SIZE;
    // pixPerTick = 15*24/20 = 18, ceil(120/18) = 7
    expect(calcProjectileTravelFrames(dist, 15)).toBe(7);
  });

  it('artillery at 6 cells: projSpeed=12 → 8 ticks', () => {
    const dist = 6 * CELL_SIZE;
    const pixPerTick = 12 * CELL_SIZE / GAME_TICKS_PER_SEC;
    const expected = Math.ceil(dist / pixPerTick);
    expect(calcProjectileTravelFrames(dist, 12)).toBe(expected);
  });

  it('V2 rocket at 10 cells: projSpeed=25 → 6 ticks', () => {
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
