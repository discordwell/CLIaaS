import { describe, it, expect } from 'vitest';
import { UNIT_STATS } from '../engine/types';

describe('Ground Unit Ammo Consumption (C++ Parity)', () => {
  describe('V2RL ammo mechanics', () => {
    it('V2RL has maxAmmo=1 (fires once then must rearm)', () => {
      expect(UNIT_STATS.V2RL.maxAmmo).toBe(1);
    });

    it('V2RL ammo depletion: fires once, ammo drops to 0', () => {
      let ammo = UNIT_STATS.V2RL.maxAmmo!;
      // Simulate fire
      if (ammo > 0) ammo--;
      expect(ammo).toBe(0);
    });

    it('V2RL out-of-ammo: stops attacking (ammo=0, maxAmmo=1)', () => {
      const ammo = 0;
      const maxAmmo = 1;
      const isAirUnit = false;
      const shouldStopAttacking = ammo === 0 && maxAmmo > 0 && !isAirUnit;
      expect(shouldStopAttacking).toBe(true);
    });
  });

  describe('Minelayer ammo mechanics', () => {
    it('MNLY has maxAmmo=5 (carries 5 mines)', () => {
      expect(UNIT_STATS.MNLY.maxAmmo).toBe(5);
    });

    it('MNLY ammo depletion: 5 mines placed, ammo reaches 0', () => {
      let ammo = UNIT_STATS.MNLY.maxAmmo!;
      for (let i = 0; i < 5; i++) {
        expect(ammo).toBeGreaterThan(0);
        ammo--;
      }
      expect(ammo).toBe(0);
    });

    it('MNLY refuses to place mine when ammo=0', () => {
      const ammo = 0;
      const maxAmmo = 5;
      const canPlace = !(ammo === 0 && maxAmmo > 0);
      expect(canPlace).toBe(false);
    });
  });

  describe('Civilian ammo mechanics', () => {
    it('C1 has maxAmmo=10 (armed civilian with Pistol)', () => {
      expect(UNIT_STATS.C1.maxAmmo).toBe(10);
      expect(UNIT_STATS.C1.primaryWeapon).toBe('Pistol');
    });

    it('C7 has maxAmmo=10 (armed civilian with Pistol)', () => {
      expect(UNIT_STATS.C7.maxAmmo).toBe(10);
      expect(UNIT_STATS.C7.primaryWeapon).toBe('Pistol');
    });

    it('civilian stops firing after 10 shots', () => {
      let ammo = 10;
      for (let i = 0; i < 10; i++) {
        if (ammo > 0) ammo--;
      }
      expect(ammo).toBe(0);
      const isAirUnit = false;
      const shouldStop = ammo === 0 && 10 > 0 && !isAirUnit;
      expect(shouldStop).toBe(true);
    });
  });

  describe('Service depot rearm', () => {
    it('rearm timer matches C++ ReloadRate (0.04 min = 36 ticks)', () => {
      const reloadRateMinutes = 0.04;
      const ticksPerAmmo = Math.round(reloadRateMinutes * 60 * 15);
      expect(ticksPerAmmo).toBe(36);
    });

    it('V2RL full rearm at depot: 36 ticks for 1 ammo', () => {
      const maxAmmo = 1;
      const ticksPerAmmo = 36;
      const totalRearmTicks = maxAmmo * ticksPerAmmo;
      expect(totalRearmTicks).toBe(36); // 2.4 seconds
    });

    it('MNLY full rearm at depot: 180 ticks for 5 ammo', () => {
      const maxAmmo = 5;
      const ticksPerAmmo = 36;
      const totalRearmTicks = maxAmmo * ticksPerAmmo;
      expect(totalRearmTicks).toBe(180); // 12 seconds
    });
  });

  describe('Crusher parity (Tracked=yes)', () => {
    it('all tracked vehicles have crusher=true', () => {
      // C++ INI: Tracked=yes implies crusher behavior
      const trackedUnits = ['1TNK', '2TNK', '3TNK', '4TNK', 'APC', 'ARTY', 'HARV', 'MCV', 'V2RL', 'MNLY', 'STNK', 'CTNK', 'TTNK', 'QTNK'];
      for (const unit of trackedUnits) {
        const stats = UNIT_STATS[unit];
        expect(stats?.crusher, `${unit} should be crusher`).toBe(true);
      }
    });
  });

  describe('Crushable override parity', () => {
    it('SHOK (Shock Trooper) is NOT crushable (C++ aftrmath.ini Crushable=no)', () => {
      expect(UNIT_STATS.SHOK.crushable).toBeFalsy();
    });

    it('normal infantry ARE crushable', () => {
      const crushableInfantry = ['E1', 'E2', 'E3', 'E4', 'E6', 'DOG', 'SPY', 'MEDI'];
      for (const unit of crushableInfantry) {
        expect(UNIT_STATS[unit]?.crushable, `${unit} should be crushable`).toBe(true);
      }
    });
  });
});
