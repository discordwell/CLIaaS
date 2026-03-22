import { describe, it, expect } from 'vitest';
import {
  WEAPON_STATS,
  CELL_SIZE,
  GAME_TICKS_PER_SEC,
  calcProjectileTravelFrames,
  MAX_PROJECTILE_FRAMES,
  DEFAULT_PROJECTILE_FRAMES,
} from '../engine/types';

describe('Per-weapon projectile speed (C++ BulletClass::AI parity)', () => {

  describe('calcProjectileTravelFrames', () => {
    it('machine gun projectile arrives faster than rocket at the same distance', () => {
      const distPixels = 5 * CELL_SIZE; // 5 cells
      const mgSpeed = WEAPON_STATS.M1Carbine.projSpeed!;   // 100 (Invisible)
      const rocketSpeed = WEAPON_STATS.Dragon.projSpeed!;   // 25 (HeatSeeker)

      const mgFrames = calcProjectileTravelFrames(distPixels, mgSpeed);
      const rocketFrames = calcProjectileTravelFrames(distPixels, rocketSpeed);

      expect(mgFrames).toBeLessThan(rocketFrames);
    });

    it('point-blank projectile arrives in 1 tick', () => {
      // Distance of 0 pixels => should be 1 tick (minimum)
      const frames = calcProjectileTravelFrames(0, 100);
      expect(frames).toBe(1);

      // Very short distance (adjacent cell)
      const framesShort = calcProjectileTravelFrames(CELL_SIZE * 0.5, 100);
      expect(framesShort).toBe(1);
    });

    it('long-range rocket takes multiple ticks to arrive', () => {
      // Rocket at max range (5 cells)
      const distPixels = 5 * CELL_SIZE;
      const rocketSpeed = WEAPON_STATS.Dragon.projSpeed!; // 25
      const frames = calcProjectileTravelFrames(distPixels, rocketSpeed);

      // 5 cells * 24 px/cell = 120 px
      // pixels/tick = 25 * 24 / 15 = 40
      // frames = ceil(120 / 40) = 3
      expect(frames).toBe(3);
      expect(frames).toBeGreaterThan(1);
    });

    it('travel time scales linearly with distance', () => {
      const speed = 25; // cells/sec (Dragon rocket speed)
      // pixelsPerTick = 25 * 24 / 15 = 40

      const frames3 = calcProjectileTravelFrames(3 * CELL_SIZE, speed);
      const frames6 = calcProjectileTravelFrames(6 * CELL_SIZE, speed);
      const frames9 = calcProjectileTravelFrames(9 * CELL_SIZE, speed);

      // Double/triple the distance should approximately double/triple the frames
      // (exact linearity depends on ceiling rounding)
      // 3 cells: ceil(72/40)=2, 6 cells: ceil(144/40)=4, 9 cells: ceil(216/40)=6
      expect(frames6).toBeGreaterThanOrEqual(frames3 * 2 - 1);
      expect(frames6).toBeLessThanOrEqual(frames3 * 2 + 1);
      expect(frames9).toBeGreaterThanOrEqual(frames3 * 3 - 1);
      expect(frames9).toBeLessThanOrEqual(frames3 * 3 + 1);
    });

    it('maxFrames is capped at MAX_PROJECTILE_FRAMES (45)', () => {
      // Very slow projectile at extreme distance
      const veryLongDist = 100 * CELL_SIZE; // 100 cells
      const slowSpeed = 1; // 1 cell/sec

      const frames = calcProjectileTravelFrames(veryLongDist, slowSpeed);
      expect(frames).toBe(MAX_PROJECTILE_FRAMES);
      expect(frames).toBe(45);
    });

    it('falls back to DEFAULT_PROJECTILE_FRAMES when projSpeed is undefined', () => {
      const distPixels = 5 * CELL_SIZE;
      const frames = calcProjectileTravelFrames(distPixels, undefined);
      expect(frames).toBe(DEFAULT_PROJECTILE_FRAMES);
      expect(frames).toBe(5);
    });

    it('falls back to DEFAULT_PROJECTILE_FRAMES when projSpeed is 0', () => {
      const distPixels = 5 * CELL_SIZE;
      const frames = calcProjectileTravelFrames(distPixels, 0);
      expect(frames).toBe(DEFAULT_PROJECTILE_FRAMES);
    });

    it('falls back to DEFAULT_PROJECTILE_FRAMES when projSpeed is negative', () => {
      const distPixels = 5 * CELL_SIZE;
      const frames = calcProjectileTravelFrames(distPixels, -5);
      expect(frames).toBe(DEFAULT_PROJECTILE_FRAMES);
    });
  });

  describe('WeaponStats projSpeed values', () => {
    it('all weapon types have projSpeed defined', () => {
      for (const [name, weapon] of Object.entries(WEAPON_STATS)) {
        expect(weapon.projSpeed, `Weapon '${name}' should have projSpeed defined`).toBeDefined();
        expect(weapon.projSpeed, `Weapon '${name}' projSpeed should be > 0`).toBeGreaterThan(0);
      }
    });

    it('Invisible-projectile weapons have fastest projSpeed (100)', () => {
      expect(WEAPON_STATS.M1Carbine.projSpeed).toBe(100);
      expect(WEAPON_STATS.M60mg.projSpeed).toBe(100);
      expect(WEAPON_STATS.Colt45.projSpeed).toBe(100);
    });

    it('cannon shells have projSpeed=40 (rules.ini [Cannon] Speed=40)', () => {
      expect(WEAPON_STATS['75mm'].projSpeed).toBe(40);
      expect(WEAPON_STATS['90mm'].projSpeed).toBe(40);
      expect(WEAPON_STATS['105mm'].projSpeed).toBe(40);
      expect(WEAPON_STATS['120mm'].projSpeed).toBe(40);
    });

    it('HeatSeeker missiles have projSpeed=25-30', () => {
      expect(WEAPON_STATS.Dragon.projSpeed).toBe(25);
      expect(WEAPON_STATS.MammothTusk.projSpeed).toBe(30);
      expect(WEAPON_STATS.Hellfire.projSpeed).toBe(30);
      expect(WEAPON_STATS.Maverick.projSpeed).toBe(30);
    });

    it('tesla weapons have projSpeed=100 (Invisible projectile)', () => {
      expect(WEAPON_STATS.TeslaZap.projSpeed).toBe(100);
      expect(WEAPON_STATS.TTankZap.projSpeed).toBe(100);
      expect(WEAPON_STATS.PortaTesla.projSpeed).toBe(100);
    });

    it('grenade has slow projSpeed (5)', () => {
      expect(WEAPON_STATS.Grenade.projSpeed).toBe(5);
    });

    it('artillery (155mm) has projSpeed=12 (Ballistic Speed=12)', () => {
      expect(WEAPON_STATS['155mm'].projSpeed).toBe(12);
    });

    it('ant mandible has projSpeed=100 (SCA INI: Projectile=Invisible, Speed=100)', () => {
      expect(WEAPON_STATS.Mandible.projSpeed).toBe(100);
    });

    it('sniper has instant projSpeed=100 (Invisible Speed=100)', () => {
      expect(WEAPON_STATS.Sniper.projSpeed).toBe(100);
    });
  });

  describe('Speed comparison sanity checks', () => {
    it('fast weapons arrive sooner than slow weapons at the same range', () => {
      const dist = 4 * CELL_SIZE; // 4 cells — typical engagement distance

      // Machine gun (100) vs grenade (5) vs rocket (25) vs cannon (40)
      const mgFrames = calcProjectileTravelFrames(dist, WEAPON_STATS.M1Carbine.projSpeed);
      const grenadeFrames = calcProjectileTravelFrames(dist, WEAPON_STATS.Grenade.projSpeed);
      const rocketFrames = calcProjectileTravelFrames(dist, WEAPON_STATS.Dragon.projSpeed);
      const shellFrames = calcProjectileTravelFrames(dist, WEAPON_STATS['90mm'].projSpeed);

      // Machine gun should be fastest
      expect(mgFrames).toBeLessThanOrEqual(shellFrames);
      expect(mgFrames).toBeLessThan(rocketFrames);
      expect(mgFrames).toBeLessThan(grenadeFrames);

      // Shells should be faster than rockets
      expect(shellFrames).toBeLessThanOrEqual(rocketFrames);

      // Grenade should be slowest
      expect(grenadeFrames).toBeGreaterThanOrEqual(rocketFrames);
    });

    it('projSpeed calculation uses correct formula', () => {
      // Manual verification: Dragon at 5 cells
      const projSpeed = 25; // cells/sec (Dragon HeatSeeker)
      const dist = 5 * CELL_SIZE; // 120 pixels
      const pixelsPerTick = projSpeed * CELL_SIZE / GAME_TICKS_PER_SEC;
      // 25 * 24 / 15 = 40 pixels/tick
      expect(pixelsPerTick).toBe(40);

      const expected = Math.max(1, Math.ceil(dist / pixelsPerTick));
      // ceil(120 / 40) = 3
      expect(expected).toBe(3);

      const actual = calcProjectileTravelFrames(dist, projSpeed);
      expect(actual).toBe(expected);
    });
  });
});
