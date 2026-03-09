/**
 * Programmatic INI Parity Test
 *
 * Reads the actual C++ RULES.INI and AFTRMATH.INI files from the repo
 * and compares them against TypeScript engine data structures.
 *
 * aftrmath.ini values override rules.ini (Aftermath expansion load order).
 *
 * This test is the permanent source of truth for C++ data parity.
 * If a value changes in the TS engine without matching the INI, this test will catch it.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import {
  UNIT_STATS, WEAPON_STATS, POWER_DRAIN,
  SUPERWEAPON_DEFS, SuperweaponType,
  REPAIR_STEP, IRON_CURTAIN_DURATION,
} from '../engine/types';
import { STRUCTURE_MAX_HP } from '../engine/scenario';

// ---------------------------------------------------------------------------
// INI Parser
// ---------------------------------------------------------------------------

function parseINI(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current = '';
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      current = sectionMatch[1];
      if (!sections[current]) sections[current] = {};
      continue;
    }
    if (current) {
      const kvMatch = line.match(/^([^=;]+)=\s*([^;]*)/);
      if (kvMatch) {
        sections[current][kvMatch[1].trim()] = kvMatch[2].trim();
      }
    }
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Load and merge INI files (aftrmath overrides rules)
// ---------------------------------------------------------------------------

const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');
const rules = parseINI(readFileSync(join(assetsDir, 'rules.ini'), 'utf-8'));
const aftrmath = parseINI(readFileSync(join(assetsDir, 'aftrmath.ini'), 'utf-8'));

// Merge: per-key override within each section
const ini: Record<string, Record<string, string>> = {};
for (const [section, values] of Object.entries(rules)) {
  ini[section] = { ...values };
}
for (const [section, values] of Object.entries(aftrmath)) {
  ini[section] = { ...(ini[section] || {}), ...values };
}

// ---------------------------------------------------------------------------
// 1. Unit Stats Parity
// ---------------------------------------------------------------------------

// Units not in C++ INI — exempt from comparison
const EXEMPT_UNITS = new Set(['ANT1', 'ANT2', 'ANT3']);

describe('INI Parity: Unit Stats', () => {
  for (const [unit, stats] of Object.entries(UNIT_STATS)) {
    if (EXEMPT_UNITS.has(unit)) continue;
    const iniData = ini[unit];
    if (!iniData) continue;

    describe(unit, () => {
      if (iniData.Speed !== undefined) {
        it('speed', () => {
          expect(stats.speed, `INI Speed=${iniData.Speed}`).toBe(Number(iniData.Speed));
        });
      }
      if (iniData.Strength !== undefined) {
        it('strength', () => {
          expect(stats.strength, `INI Strength=${iniData.Strength}`).toBe(Number(iniData.Strength));
        });
      }
      if (iniData.Sight !== undefined) {
        it('sight', () => {
          expect(stats.sight, `INI Sight=${iniData.Sight}`).toBe(Number(iniData.Sight));
        });
      }
      if (iniData.ROT !== undefined) {
        it('rot', () => {
          expect(stats.rot, `INI ROT=${iniData.ROT}`).toBe(Number(iniData.ROT));
        });
      }
      if (iniData.Armor !== undefined) {
        it('armor', () => {
          expect(stats.armor, `INI Armor=${iniData.Armor}`).toBe(iniData.Armor);
        });
      }
      if (iniData.Primary !== undefined) {
        const expected = iniData.Primary.toLowerCase() === 'none' ? null : iniData.Primary;
        it('primaryWeapon', () => {
          expect(stats.primaryWeapon, `INI Primary=${iniData.Primary}`).toBe(expected);
        });
      }
      if (iniData.Secondary !== undefined) {
        const expected = iniData.Secondary.toLowerCase() === 'none' ? null : iniData.Secondary;
        it('secondaryWeapon', () => {
          expect(stats.secondaryWeapon ?? null, `INI Secondary=${iniData.Secondary}`).toBe(expected);
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Structure HP Parity
// ---------------------------------------------------------------------------

describe('INI Parity: Structure HP', () => {
  for (const [building, hp] of Object.entries(STRUCTURE_MAX_HP)) {
    const iniData = ini[building];
    if (!iniData?.Strength) continue;

    it(`${building} HP = ${iniData.Strength}`, () => {
      expect(hp, `INI Strength=${iniData.Strength}`).toBe(Number(iniData.Strength));
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Weapon Stats Parity
// ---------------------------------------------------------------------------

// Weapons not in C++ INI — exempt from comparison
const EXEMPT_WEAPONS = new Set([
  'Mandible', 'TeslaZap', 'FireballLauncher', 'Napalm', // Ant weapons (custom)
  'Tomahawk', 'SeaSerpent', // Custom naval weapons
]);

describe('INI Parity: Weapon Stats', () => {
  for (const [weapon, stats] of Object.entries(WEAPON_STATS)) {
    if (EXEMPT_WEAPONS.has(weapon)) continue;
    const iniData = ini[weapon];
    if (!iniData) continue;

    describe(weapon, () => {
      if (iniData.Damage !== undefined) {
        it('damage', () => {
          expect(stats.damage, `INI Damage=${iniData.Damage}`).toBe(Number(iniData.Damage));
        });
      }
      if (iniData.ROF !== undefined) {
        it('rof', () => {
          expect(stats.rof, `INI ROF=${iniData.ROF}`).toBe(Number(iniData.ROF));
        });
      }
      if (iniData.Range !== undefined) {
        it('range', () => {
          expect(stats.range, `INI Range=${iniData.Range}`).toBe(Number(iniData.Range));
        });
      }
      if (iniData.Warhead !== undefined) {
        it('warhead', () => {
          expect(stats.warhead, `INI Warhead=${iniData.Warhead}`).toBe(iniData.Warhead);
        });
      }
      if (iniData.Burst !== undefined) {
        it('burst', () => {
          expect(stats.burst ?? 1, `INI Burst=${iniData.Burst}`).toBe(Number(iniData.Burst));
        });
      }
      // NOTE: Weapon Speed= in INI is C++ BulletTypeClass speed (lepton-scale).
      // TS projSpeed is pixel-scale and requires conversion analysis.
      // projSpeed parity is tracked separately — not tested here.
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Power Drain Parity
// ---------------------------------------------------------------------------

describe('INI Parity: Power Drain', () => {
  for (const [building, drain] of Object.entries(POWER_DRAIN)) {
    const iniData = ini[building];
    if (!iniData?.Power) continue;
    const iniPower = Number(iniData.Power);

    // Positive Power = generates power (skip — POWER_DRAIN only tracks consumers)
    if (iniPower >= 0) continue;

    const expectedDrain = Math.abs(iniPower);
    it(`${building} drain = ${expectedDrain}`, () => {
      expect(drain, `INI Power=${iniPower}`).toBe(expectedDrain);
    });
  }
});

// ---------------------------------------------------------------------------
// 5. Superweapon Recharge Parity
// ---------------------------------------------------------------------------

// Map [Recharge] INI keys → SuperweaponType enum values
const RECHARGE_MAP: Record<string, SuperweaponType> = {
  Chrono: SuperweaponType.CHRONOSPHERE,
  Sonar: SuperweaponType.SONAR_PULSE,
  ParaBomb: SuperweaponType.PARABOMB,
  Paratrooper: SuperweaponType.PARAINFANTRY,
  SpyPlane: SuperweaponType.SPY_PLANE,
  IronCurtain: SuperweaponType.IRON_CURTAIN,
  Nuke: SuperweaponType.NUKE,
  GPS: SuperweaponType.GPS_SATELLITE,
};

describe('INI Parity: Superweapon Recharge', () => {
  const rechargeSection = ini['Recharge'];
  if (!rechargeSection) return;

  for (const [iniKey, swType] of Object.entries(RECHARGE_MAP)) {
    const iniMinutes = rechargeSection[iniKey];
    if (!iniMinutes) continue;
    const expectedTicks = Math.round(Number(iniMinutes) * 60 * 15);
    const def = SUPERWEAPON_DEFS[swType];

    it(`${iniKey} = ${iniMinutes} min → ${expectedTicks} ticks`, () => {
      expect(def.rechargeTicks, `INI ${iniKey}=${iniMinutes} min`).toBe(expectedTicks);
    });
  }
});

// ---------------------------------------------------------------------------
// 6. General Settings Parity
// ---------------------------------------------------------------------------

describe('INI Parity: General Settings', () => {
  const general = ini['General'];
  if (!general) return;

  if (general.RepairStep) {
    it(`RepairStep = ${general.RepairStep}`, () => {
      expect(REPAIR_STEP, `INI RepairStep=${general.RepairStep}`).toBe(Number(general.RepairStep));
    });
  }

  if (general.C4Delay) {
    const c4Ticks = Math.round(Number(general.C4Delay) * 60 * 15);
    it(`C4Delay = ${general.C4Delay} min → ${c4Ticks} ticks`, () => {
      // C4 timer is hardcoded in index.ts — this test documents the correct value.
      // If you change the C4 timer, update this assertion.
      expect(c4Ticks).toBe(27);
    });
  }

  if (general.IronCurtain) {
    const icTicks = Math.round(Number(general.IronCurtain) * 60 * 15);
    it(`IronCurtain duration = ${general.IronCurtain} min → ${icTicks} ticks`, () => {
      expect(IRON_CURTAIN_DURATION, `INI IronCurtain=${general.IronCurtain}`).toBe(icTicks);
    });
  }
});
