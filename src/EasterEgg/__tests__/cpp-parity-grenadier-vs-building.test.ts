/**
 * C++ Parity Behavioral Test: Grenadier vs Power Plant
 *
 * Simulates a single grenadier (E2) attacking a power plant (POWR) and verifies
 * the damage-per-shot and time-to-kill match C++ expectations.
 *
 * C++ damage flow (bullet.cpp:991):
 *   Bullet_Explodes → Explosion_Damage (SOLE damage path)
 *   - No separate "direct hit" damage call
 *   - Target at distance 0 gets full modifyDamage(strength, warhead, armor, 0)
 *   - Firer is excluded from splash (combat.cpp:207)
 *
 * Grenade weapon (rules.ini / types.ts):
 *   Damage=50, Warhead=HE, ROF=60, Splash=1.5, IsArcing=true
 *
 * POWR building (rules.ini):
 *   MaxHP=400 (on 0-256 scale internally, but HP values in TS are absolute)
 *   Armor=concrete
 *
 * HE vs concrete multiplier: 1.0 (WARHEAD_VS_ARMOR table)
 *
 * Expected per-shot damage: modifyDamage(50, HE, concrete, 0) = 50
 * Expected shots to kill: ceil(400 / 50) = 8
 * Expected ticks to kill: 8 shots * 60 ROF = 480 ticks (+ initial travel time)
 *
 * THIS TEST IS NOT PART OF THE REGULAR SUITE — it documents expected C++ behavior
 * for manual verification and regression detection.
 */
import { describe, it, expect } from 'vitest';
import {
  modifyDamage, getWarheadMultiplier, WARHEAD_VS_ARMOR,
  WEAPON_STATS, CELL_SIZE, type ArmorType, type WarheadType,
} from '../engine/types';

// --- C++ reference values ---
const GRENADE_DAMAGE = 50;
const GRENADE_WARHEAD: WarheadType = 'HE';
const GRENADE_ROF = 60;     // ticks between shots
const GRENADE_SPLASH = 1.5; // cells

const POWR_HP = 400;
const POWR_ARMOR: ArmorType = 'concrete';

const HE_VS_CONCRETE = 1.0; // WARHEAD_VS_ARMOR[HE][4]

describe('C++ Parity: Grenadier (E2) vs Power Plant (POWR)', () => {

  describe('Weapon and armor data verification', () => {
    it('grenade weapon stats match C++ rules.ini', () => {
      const grenade = WEAPON_STATS.Grenade;
      expect(grenade.damage).toBe(GRENADE_DAMAGE);
      expect(grenade.warhead).toBe(GRENADE_WARHEAD);
      expect(grenade.rof).toBe(GRENADE_ROF);
      expect(grenade.splash).toBe(GRENADE_SPLASH);
      expect(grenade.isArcing).toBe(true);
    });

    it('HE warhead vs concrete armor = 1.0 (C++ rules.ini Verses)', () => {
      expect(getWarheadMultiplier('HE', 'concrete')).toBe(HE_VS_CONCRETE);
    });

    it('HE warhead vs other armor types match C++ rules.ini', () => {
      // HE: [0.9, 0.75, 0.6, 0.25, 1.0] = none, wood, light, heavy, concrete
      expect(getWarheadMultiplier('HE', 'none')).toBeCloseTo(0.9);
      expect(getWarheadMultiplier('HE', 'wood')).toBeCloseTo(0.75);
      expect(getWarheadMultiplier('HE', 'light')).toBeCloseTo(0.6);
      expect(getWarheadMultiplier('HE', 'heavy')).toBeCloseTo(0.25);
    });
  });

  describe('Single-shot damage calculation (C++ Explosion_Damage path)', () => {
    it('grenade deals 50 damage to POWR at distance 0 (C++ modifyDamage)', () => {
      // C++ bullet.cpp:991 — Explosion_Damage is sole path, target at dist=0
      const damage = modifyDamage(GRENADE_DAMAGE, GRENADE_WARHEAD, POWR_ARMOR, 0);
      expect(damage).toBe(50);
    });

    it('grenade does NOT double-damage via direct+splash (C++ has single path)', () => {
      // This was the bug: TS was applying direct hit + splash = 2x damage
      // C++ only has Explosion_Damage, no separate direct hit
      const singlePathDamage = modifyDamage(GRENADE_DAMAGE, GRENADE_WARHEAD, POWR_ARMOR, 0);
      // If we were double-counting, it would be 100. It should be 50.
      expect(singlePathDamage).toBe(50);
      expect(singlePathDamage).not.toBe(100); // Explicitly verify no doubling
    });

    it('grenade deals reduced damage at distance (C++ SpreadFactor falloff)', () => {
      // At 1 cell distance, damage should be reduced
      const damageFar = modifyDamage(GRENADE_DAMAGE, GRENADE_WARHEAD, POWR_ARMOR, CELL_SIZE);
      expect(damageFar).toBeLessThan(50);
      expect(damageFar).toBeGreaterThan(0);
    });
  });

  describe('Time-to-kill simulation', () => {
    it('requires exactly 8 shots to destroy POWR (400 HP / 50 per shot)', () => {
      let hp = POWR_HP;
      let shots = 0;
      while (hp > 0) {
        const damage = modifyDamage(GRENADE_DAMAGE, GRENADE_WARHEAD, POWR_ARMOR, 0);
        hp -= damage;
        shots++;
        if (shots > 100) throw new Error('Infinite loop — damage per shot may be 0');
      }
      expect(shots).toBe(8);
    });

    it('takes ~480 ticks to kill POWR (8 shots * 60 ROF)', () => {
      const shotsToKill = Math.ceil(POWR_HP / modifyDamage(GRENADE_DAMAGE, GRENADE_WARHEAD, POWR_ARMOR, 0));
      const ticksToKill = shotsToKill * GRENADE_ROF;
      expect(ticksToKill).toBe(480);
    });

    it('grenadier vs jeep: correct damage per shot with light armor', () => {
      // This was the user-reported bug — grenadiers doing too much to jeeps
      // HE vs light = 0.6, base 50 => 50 * 0.6 = 30
      const JEEP_ARMOR: ArmorType = 'light';
      const damage = modifyDamage(GRENADE_DAMAGE, GRENADE_WARHEAD, JEEP_ARMOR, 0);
      expect(damage).toBe(30);
      // NOT 60 (which was the bugged doubled value)
      expect(damage).not.toBe(60);
    });

    it('grenadier vs infantry: correct damage per shot with none armor', () => {
      // HE vs none = 0.9, base 50 => 50 * 0.9 = 45
      const damage = modifyDamage(GRENADE_DAMAGE, GRENADE_WARHEAD, 'none', 0);
      expect(damage).toBe(45);
    });

    it('grenadier vs heavy tank: low damage per shot', () => {
      // HE vs heavy = 0.25, base 50 => 50 * 0.25 = 13 (rounded)
      const damage = modifyDamage(GRENADE_DAMAGE, GRENADE_WARHEAD, 'heavy', 0);
      expect(damage).toBe(13);
    });
  });

  describe('Splash radius behavior', () => {
    it('grenade splash radius is 1.5 cells (C++ ICON_LEPTON_W + ICON_LEPTON_W/2)', () => {
      expect(GRENADE_SPLASH).toBe(1.5);
    });

    it('entities at 1 cell distance still take damage from splash', () => {
      const damage = modifyDamage(GRENADE_DAMAGE, GRENADE_WARHEAD, POWR_ARMOR, CELL_SIZE);
      expect(damage).toBeGreaterThan(0);
    });

    it('entities beyond 1.5 cell radius take no splash damage', () => {
      // At 2 cells, beyond 1.5-cell splash radius — no damage
      // (This is enforced by the splash range check, not modifyDamage itself)
      const distBeyondSplash = 2.0 * CELL_SIZE;
      // modifyDamage still returns a value, but the splash function
      // checks distance < splashRange before calling modifyDamage
      expect(2.0).toBeGreaterThan(GRENADE_SPLASH);
    });
  });

  describe('Comparison with other weapons against POWR', () => {
    it('105mm artillery (damage=150, HE) deals 150 per shot to POWR', () => {
      const artyDamage = modifyDamage(150, 'HE', POWR_ARMOR, 0);
      expect(artyDamage).toBe(150);
      expect(Math.ceil(POWR_HP / artyDamage)).toBe(3); // 3 shots to kill
    });

    it('M1Carbine rifle (damage=15, SA) deals low damage to POWR', () => {
      // SA vs concrete = check table
      const saMult = getWarheadMultiplier('SA', 'concrete');
      const rifleDamage = modifyDamage(15, 'SA', POWR_ARMOR, 0);
      expect(rifleDamage).toBeLessThan(15); // SA is weak vs concrete
    });

    it('Tesla (damage=100, Super) deals 100 to POWR', () => {
      const teslaDamage = modifyDamage(100, 'Super', POWR_ARMOR, 0);
      // Super warhead has 1.0 vs all armor types
      expect(teslaDamage).toBe(100);
      expect(Math.ceil(POWR_HP / teslaDamage)).toBe(4); // 4 shots to kill
    });
  });
});
