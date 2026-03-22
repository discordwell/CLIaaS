/**
 * C++ Parity: [Recharge] INI Section — Superweapon Recharge Times
 *
 * Parses the actual rules.ini and aftrmath.ini [Recharge] sections and
 * compares every entry against TS SUPERWEAPON_DEFS.rechargeTicks.
 *
 * Authoritative source: rules.ini [Recharge] (time in minutes)
 *   Chrono=7, GPS=8, IronCurtain=11, Nuke=13,
 *   ParaBomb=14, Paratrooper=7, Saboteur=14, Sonar=10, SpyPlane=3
 *
 * aftrmath.ini may override — merged with standard load order.
 *
 * Conversion: rechargeTicks = minutes * 60 * 15  (15 Hz tick rate)
 *   C++ house.cpp:653-660: recharge = TICKS_PER_MINUTE * Rule.<Weapon>Time
 *   C++ defines.h:3031: TICKS_PER_SECOND = 15
 *   C++ defines.h:3032: TICKS_PER_MINUTE = 900
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { SUPERWEAPON_DEFS, SuperweaponType } from '../engine/types';

// ---------------------------------------------------------------------------
// INI Parser (same pattern as ini-parity.test.ts)
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

// Merge: aftrmath overrides rules per-key within each section
const ini: Record<string, Record<string, string>> = {};
for (const [section, values] of Object.entries(rules)) {
  ini[section] = { ...values };
}
for (const [section, values] of Object.entries(aftrmath)) {
  ini[section] = { ...(ini[section] || {}), ...values };
}

const rechargeSection = ini['Recharge'];

// ---------------------------------------------------------------------------
// C++ constants
// ---------------------------------------------------------------------------

const TICKS_PER_MINUTE = 900; // defines.h:3032 — 15 FPS * 60s

// ---------------------------------------------------------------------------
// Mapping: rules.ini [Recharge] key -> TS SuperweaponType
// ---------------------------------------------------------------------------

const INI_KEY_TO_SUPERWEAPON: Record<string, SuperweaponType> = {
  Chrono:      SuperweaponType.CHRONOSPHERE,
  GPS:         SuperweaponType.GPS_SATELLITE,
  IronCurtain: SuperweaponType.IRON_CURTAIN,
  Nuke:        SuperweaponType.NUKE,
  ParaBomb:    SuperweaponType.PARABOMB,
  Paratrooper: SuperweaponType.PARAINFANTRY,
  Sonar:       SuperweaponType.SONAR_PULSE,
  SpyPlane:    SuperweaponType.SPY_PLANE,
};

// Saboteur exists in rules.ini but has no TS SuperweaponType — known gap
const KNOWN_INI_ONLY_KEYS = new Set(['Saboteur']);

// =============================================================================
// Tests
// =============================================================================

describe('[Recharge] INI parity: parse rules.ini directly', () => {

  it('rules.ini has a [Recharge] section', () => {
    expect(rechargeSection, 'rules.ini must contain [Recharge]').toBeDefined();
  });

  it('[Recharge] section has all 9 expected keys', () => {
    const expectedKeys = [
      'Chrono', 'GPS', 'IronCurtain', 'Nuke',
      'ParaBomb', 'Paratrooper', 'Saboteur', 'Sonar', 'SpyPlane',
    ];
    for (const key of expectedKeys) {
      expect(
        rechargeSection[key],
        `[Recharge] must contain ${key}`
      ).toBeDefined();
    }
  });

  it('no unexpected keys in [Recharge]', () => {
    const expectedKeys = new Set([
      'Chrono', 'GPS', 'IronCurtain', 'Nuke',
      'ParaBomb', 'Paratrooper', 'Saboteur', 'Sonar', 'SpyPlane',
    ]);
    for (const key of Object.keys(rechargeSection)) {
      expect(
        expectedKeys.has(key),
        `unexpected key '${key}' in [Recharge]`
      ).toBe(true);
    }
  });
});

describe('[Recharge] INI parity: each superweapon rechargeTicks matches INI', () => {

  for (const [iniKey, swType] of Object.entries(INI_KEY_TO_SUPERWEAPON)) {
    const iniMinutes = Number(rechargeSection[iniKey]);
    const expectedTicks = iniMinutes * TICKS_PER_MINUTE;
    const def = SUPERWEAPON_DEFS[swType];

    it(`${iniKey}=${iniMinutes} min -> ${expectedTicks} ticks — ${def.name} rechargeTicks`, () => {
      expect(
        def.rechargeTicks,
        `${def.name}: INI says ${iniKey}=${iniMinutes} -> ${expectedTicks} ticks, TS has ${def.rechargeTicks}`
      ).toBe(expectedTicks);
    });
  }
});

describe('[Recharge] INI parity: aftrmath.ini override check', () => {

  const aftrmathRecharge = aftrmath['Recharge'];

  it('aftrmath.ini does not override any [Recharge] values (or overrides match)', () => {
    // If aftrmath has a [Recharge] section, verify merged values still match TS
    if (!aftrmathRecharge) {
      // No overrides — this is the expected case
      expect(true).toBe(true);
      return;
    }

    for (const [key, value] of Object.entries(aftrmathRecharge)) {
      const swType = INI_KEY_TO_SUPERWEAPON[key];
      if (!swType) continue; // skip Saboteur etc.

      const minutes = Number(value);
      const expectedTicks = minutes * TICKS_PER_MINUTE;
      const def = SUPERWEAPON_DEFS[swType];

      expect(
        def.rechargeTicks,
        `aftrmath.ini override: ${key}=${minutes} -> ${expectedTicks}, TS has ${def.rechargeTicks}`
      ).toBe(expectedTicks);
    }
  });
});

describe('[Recharge] INI parity: Saboteur known gap', () => {

  it('rules.ini has Saboteur=14 in [Recharge]', () => {
    expect(Number(rechargeSection['Saboteur'])).toBe(14);
  });

  it('TS SuperweaponType enum does not include Saboteur', () => {
    const allValues = Object.values(SuperweaponType) as string[];
    const hasSaboteur = allValues.some(v =>
      v === 'SABOTEUR' || v === 'PARA_SABOTEUR' || v === 'PARA_SABOTAGE'
    );
    expect(hasSaboteur).toBe(false);
  });

  it('Saboteur recharge would be 14 * 900 = 12600 ticks if implemented', () => {
    const saboteurTicks = Number(rechargeSection['Saboteur']) * TICKS_PER_MINUTE;
    expect(saboteurTicks).toBe(12600);
  });
});

describe('[Recharge] INI parity: all TS superweapons covered by INI', () => {

  const coveredTypes = new Set(Object.values(INI_KEY_TO_SUPERWEAPON));

  for (const swType of Object.values(SuperweaponType)) {
    it(`${swType} has a corresponding [Recharge] INI key`, () => {
      expect(
        coveredTypes.has(swType),
        `SuperweaponType.${swType} has no mapping to [Recharge] INI key`
      ).toBe(true);
    });
  }
});

describe('[Recharge] INI parity: all INI keys mapped or documented', () => {

  for (const key of Object.keys(rechargeSection)) {
    it(`[Recharge] ${key} is either mapped to TS or documented as known gap`, () => {
      const isMapped = key in INI_KEY_TO_SUPERWEAPON;
      const isKnownGap = KNOWN_INI_ONLY_KEYS.has(key);
      expect(
        isMapped || isKnownGap,
        `[Recharge] key '${key}' is not mapped to any SuperweaponType and not in known gaps`
      ).toBe(true);
    });
  }
});

describe('[Recharge] INI parity: raw INI values are positive integers', () => {

  for (const [key, value] of Object.entries(rechargeSection)) {
    it(`${key}=${value} is a positive integer`, () => {
      const num = Number(value);
      expect(Number.isInteger(num), `${key}=${value} should be integer`).toBe(true);
      expect(num, `${key} should be > 0`).toBeGreaterThan(0);
    });
  }
});
