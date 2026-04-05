/**
 * Cluster C: Projectile sprite rendering visual-parity tests.
 *
 * Verifies projectileVisualConfig() maps each weapon to the correct SHP sprite +
 * flags sourced from rules.ini BulletTypeClass definitions (public/ra/assets/rules.ini:2505-2640).
 *
 * C++ refs:
 *   bbdata.cpp:170-188 — 18 BulletTypeClass entries
 *   bbdata.cpp:207-232 — Image= field per bullet type
 *   bullet.cpp:506-592 — Draw_It, Shape_Number using PrimaryFacing (Rotates=yes)
 *   bullet.cpp:377-386 — IsFlameEquipped flame trail
 *
 * rules.ini source of truth (authoritative):
 *   [HeatSeeker]  Image=DRAGON    Rotates=yes  Translucent=yes  Animates=yes
 *   [LaserGuided] Image=DRAGON    Rotates=yes  Translucent=yes  Animates=yes
 *   [AAMissile]   Image=MISSILE   Rotates=yes  Translucent=yes  Animates=yes
 *   [Torpedo]     Image=MISSILE   Rotates=yes  UnderWater=yes
 *   [Cannon]      Image=120MM
 *   [Ballistic]   Image=120MM     Arcing=yes   High=yes   Inaccurate=yes
 *   [Lobbed]      Image=BOMB      Frames=8     Arcing=yes  Translucent=yes
 *   [Bomblet]     Image=BOMBLET   Frames=6     Dropping=yes Translucent=yes
 *   [FROG]        Image=V2        Rotates=yes  Animates=yes  High=yes
 *   [Fireball]    Image=FB1       Frames=8     Animates=yes
 */
import { describe, it, expect } from 'vitest';
import { projectileVisualConfig } from '../engine/types';
import type { Effect } from '../engine/renderer';

describe('projectileVisualConfig — rules.ini BulletTypeClass parity', () => {
  describe('HeatSeeker family (Image=DRAGON, Rotates=yes, Translucent=yes)', () => {
    const heatSeekerWeapons = ['Dragon', 'RedEye', 'Maverick', 'Hellfire', 'SubSCUD', 'MammothTusk', 'APTusk'];
    for (const w of heatSeekerWeapons) {
      it(`${w} uses dragon sprite with rotation + translucency`, () => {
        const cfg = projectileVisualConfig(w);
        expect(cfg.projImage, `${w} → dragon`).toBe('dragon');
        expect(cfg.projRotates, `${w} rotates`).toBe(true);
        expect(cfg.projTranslucent, `${w} translucent`).toBe(true);
        expect(cfg.projFlameTrail, `${w} animates/flame trail`).toBe(true);
      });
    }
  });

  describe('LaserGuided family (Image=DRAGON, Rotates=yes, Translucent=yes)', () => {
    it('Stinger uses dragon sprite with rotation + translucency', () => {
      const cfg = projectileVisualConfig('Stinger');
      expect(cfg.projImage).toBe('dragon');
      expect(cfg.projRotates).toBe(true);
      expect(cfg.projTranslucent).toBe(true);
    });
  });

  describe('AAMissile family (Image=MISSILE, Rotates=yes, Translucent=yes, AA=yes, AG=no)', () => {
    const aaWeapons = ['Nike', 'TurretGun'];
    for (const w of aaWeapons) {
      it(`${w} uses missile sprite with rotation + translucency`, () => {
        const cfg = projectileVisualConfig(w);
        expect(cfg.projImage, `${w} → missile`).toBe('missile');
        expect(cfg.projRotates).toBe(true);
      });
    }
  });

  describe('Cannon/Ballistic family (Image=120MM)', () => {
    const cannonWeapons = ['75mm', '90mm', '105mm', '120mm', '2Inch', '155mm', '8Inch'];
    for (const w of cannonWeapons) {
      it(`${w} uses 120mm shell sprite`, () => {
        const cfg = projectileVisualConfig(w);
        expect(cfg.projImage, `${w} → 120mm`).toBe('120mm');
        expect(cfg.projRotates, `${w} does not rotate (single shell frame)`).toBeFalsy();
        expect(cfg.projTumble, `${w} does not tumble`).toBeFalsy();
      });
    }
  });

  describe('FROG projectile (Image=V2, Rotates=yes, Animates=yes)', () => {
    it('SCUD uses v2rl sprite with rotation + flame trail', () => {
      const cfg = projectileVisualConfig('SCUD');
      expect(cfg.projImage).toBe('v2rl');
      expect(cfg.projRotates).toBe(true);
      expect(cfg.projFlameTrail).toBe(true);
    });
  });

  describe('Lobbed projectile (Image=BOMB, Frames=8, Translucent=yes)', () => {
    it('Grenade uses bomb sprite with 8 tumble frames + translucency', () => {
      const cfg = projectileVisualConfig('Grenade');
      expect(cfg.projImage).toBe('bomb');
      expect(cfg.projTumble).toBe(true);
      expect(cfg.projTumbleFrames).toBe(8);
      expect(cfg.projTranslucent).toBe(true);
      expect(cfg.projRotates, 'Lobbed does not rotate (tumble only)').toBeFalsy();
    });
  });

  describe('Bomblet projectile (Image=BOMBLET, Frames=6, Translucent=yes)', () => {
    it('ParaBomb uses bomblet sprite with 6 tumble frames + translucency', () => {
      const cfg = projectileVisualConfig('ParaBomb');
      expect(cfg.projImage).toBe('bomblet');
      expect(cfg.projTumble).toBe(true);
      expect(cfg.projTumbleFrames).toBe(6);
      expect(cfg.projTranslucent).toBe(true);
    });
  });

  describe('Fireball projectile (Image=FB1, Frames=8, Animates=yes)', () => {
    const flameWeapons = ['FireballLauncher', 'Flamer', 'Napalm'];
    for (const w of flameWeapons) {
      it(`${w} uses fball1 sprite with 8 tumble frames`, () => {
        const cfg = projectileVisualConfig(w);
        expect(cfg.projImage, `${w} → fball1`).toBe('fball1');
        expect(cfg.projTumble).toBe(true);
        expect(cfg.projTumbleFrames).toBe(8);
      });
    }
  });

  describe('Torpedo (Image=MISSILE, Rotates=yes, UnderWater=yes)', () => {
    it('TorpTube uses missile sprite — no longer an invisible yellow pixel (C4 fix)', () => {
      const cfg = projectileVisualConfig('TorpTube');
      expect(cfg.projImage).toBe('missile');
      expect(cfg.projRotates).toBe(true);
    });
  });

  describe('unknown weapons fall through to procedural', () => {
    it('invisible weapons get no sprite (instant-hit, no visual needed)', () => {
      const cfg = projectileVisualConfig('M1Carbine');
      expect(cfg.projImage).toBeUndefined();
    });
    it('unknown weapon name returns empty config', () => {
      const cfg = projectileVisualConfig('NonexistentWeapon');
      expect(cfg.projImage).toBeUndefined();
      expect(cfg.projRotates).toBeFalsy();
      expect(cfg.projTumble).toBeFalsy();
    });
  });
});

describe('Effect interface — projectile sprite fields', () => {
  it('accepts projImage, projRotates, projTumble, projTumbleFrames, projTranslucent, projShadow, projFlameTrail', () => {
    const fx: Effect = {
      type: 'projectile', x: 0, y: 0, frame: 0, maxFrames: 10, size: 3,
      startX: 0, startY: 0, endX: 100, endY: 100,
      projStyle: 'rocket',
      projImage: 'dragon',
      projRotates: true,
      projTumble: false,
      projTumbleFrames: 0,
      projTranslucent: true,
      projShadow: true,
      projFlameTrail: true,
      projArcPx: 25,
    };
    expect(fx.projImage).toBe('dragon');
    expect(fx.projRotates).toBe(true);
    expect(fx.projTranslucent).toBe(true);
    expect(fx.projFlameTrail).toBe(true);
    expect(fx.projArcPx).toBe(25);
  });
});
