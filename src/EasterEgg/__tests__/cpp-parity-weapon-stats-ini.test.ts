/**
 * C++ Behavioral Parity: Weapon Stats vs rules.ini (INI-parsed audit)
 *
 * Parses rules.ini and aftrmath.ini directly and compares every weapon field
 * (Damage, ROF, Range, Warhead, Speed, Burst) in WEAPON_STATS against the
 * authoritative INI values.
 *
 * aftrmath.ini overrides rules.ini per Aftermath expansion load order.
 *
 * Weapons that only exist in C++ code (no INI section) are cataloged but
 * not compared. Structure-only weapons (in INI but not WEAPON_STATS) are
 * likewise cataloged.
 *
 * C++ source refs:
 *   rules.ini lines 2068-2450 (weapon sections)
 *   aftrmath.ini lines 153-230 (expansion weapon sections)
 *   weapon.cpp — BulletType init from INI
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { WEAPON_STATS } from '../engine/types';

// ---------------------------------------------------------------------------
// INI Parser — reads [Section] Key=Value pairs, skipping comments (;)
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
// Load and merge INI files (aftrmath overrides rules per C++ load order)
// ---------------------------------------------------------------------------

const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');
const rulesContent = readFileSync(join(assetsDir, 'rules.ini'), 'utf-8');
const aftrmathContent = readFileSync(join(assetsDir, 'aftrmath.ini'), 'utf-8');

const rules = parseINI(rulesContent);
const aftrmath = parseINI(aftrmathContent);

// Merge: aftrmath keys override rules keys within each section
const ini: Record<string, Record<string, string>> = {};
for (const [section, values] of Object.entries(rules)) {
  ini[section] = { ...values };
}
for (const [section, values] of Object.entries(aftrmath)) {
  ini[section] = { ...(ini[section] || {}), ...values };
}

// ---------------------------------------------------------------------------
// Weapon classification
// ---------------------------------------------------------------------------

/**
 * Weapons in WEAPON_STATS that have NO corresponding INI section in
 * rules.ini or aftrmath.ini. These are engine-custom (hardcoded in C++
 * source or scenario INI files, not the global rules.ini).
 */
const ENGINE_CUSTOM_WEAPONS = new Set([
  'Tomahawk',      // CA cruise missile — no INI section, defined in C++ vessel.cpp
  'SeaSerpent',    // MSUB missile — no INI section, defined in C++ vessel.cpp
  'TeslaCannon',   // TSLA building weapon — separate from TeslaZap; no own INI section
  'Mandible',      // Ant weapon — from scenario INI (SCA*.INI), not rules.ini
]);

/**
 * Weapons whose INI section exists but WEAPON_STATS intentionally uses
 * different values (e.g., the ant-variant TeslaZap vs the building version).
 *
 * INI [TeslaZap]: Damage=100, ROF=120, Range=8.5 (building TSLA version)
 * WEAPON_STATS TeslaZap: Damage=60, ROF=25, Range=1.75 (ANT3 melee variant)
 */
const ANT_VARIANT_WEAPONS = new Set(['TeslaZap']);

/**
 * Weapons present in INI but NOT in WEAPON_STATS because they belong to
 * structures (handled via STRUCTURE_WEAPONS in scenario.ts).
 */
const STRUCTURE_ONLY_INI_WEAPONS = new Set([
  'Vulcan',      // PBOX/HBOX primary
  'Nike',        // SAM primary
  'ZSU-23',      // AGUN primary
  'TurretGun',   // GUN primary
  'AirAssault',  // Carrier weapon (aftrmath.ini only)
]);

// ---------------------------------------------------------------------------
// Derive the set of weapons to compare: in both WEAPON_STATS AND INI,
// excluding engine-custom and ant-variant weapons
// ---------------------------------------------------------------------------

const tsWeaponNames = Object.keys(WEAPON_STATS);

const sharedWeapons = tsWeaponNames.filter(
  name => ini[name] && !ENGINE_CUSTOM_WEAPONS.has(name) && !ANT_VARIANT_WEAPONS.has(name),
);

// ---------------------------------------------------------------------------
// 1. Per-field parity tests — each weapon x each field
// ---------------------------------------------------------------------------

describe('C++ Parity: WEAPON_STATS vs rules.ini/aftrmath.ini (all fields)', () => {

  describe('Damage', () => {
    for (const name of sharedWeapons) {
      const iniVal = ini[name]?.Damage;
      if (iniVal === undefined) continue;
      const expected = parseInt(iniVal, 10);
      it(`${name} Damage: TS=${WEAPON_STATS[name].damage} vs INI=${expected}`, () => {
        expect(WEAPON_STATS[name].damage).toBe(expected);
      });
    }
  });

  describe('ROF', () => {
    for (const name of sharedWeapons) {
      const iniVal = ini[name]?.ROF;
      if (iniVal === undefined) continue;
      const expected = parseInt(iniVal, 10);
      it(`${name} ROF: TS=${WEAPON_STATS[name].rof} vs INI=${expected}`, () => {
        expect(WEAPON_STATS[name].rof).toBe(expected);
      });
    }
  });

  describe('Range', () => {
    for (const name of sharedWeapons) {
      const iniVal = ini[name]?.Range;
      if (iniVal === undefined) continue;
      const expected = parseFloat(iniVal);
      it(`${name} Range: TS=${WEAPON_STATS[name].range} vs INI=${expected}`, () => {
        expect(WEAPON_STATS[name].range).toBe(expected);
      });
    }
  });

  describe('Warhead', () => {
    for (const name of sharedWeapons) {
      const iniVal = ini[name]?.Warhead;
      if (iniVal === undefined) continue;
      it(`${name} Warhead: TS=${WEAPON_STATS[name].warhead} vs INI=${iniVal}`, () => {
        expect(WEAPON_STATS[name].warhead).toBe(iniVal);
      });
    }
  });

  describe('Speed (projSpeed)', () => {
    for (const name of sharedWeapons) {
      const iniVal = ini[name]?.Speed;
      if (iniVal === undefined) continue;
      const expected = parseInt(iniVal, 10);
      it(`${name} Speed: TS projSpeed=${WEAPON_STATS[name].projSpeed} vs INI=${expected}`, () => {
        expect(WEAPON_STATS[name].projSpeed).toBe(expected);
      });
    }
  });

  describe('Burst', () => {
    for (const name of sharedWeapons) {
      const iniSection = ini[name];
      if (!iniSection) continue;
      // INI default Burst is 1 if not specified; TS default burst is undefined (meaning 1)
      const iniBurst = iniSection.Burst !== undefined ? parseInt(iniSection.Burst, 10) : 1;
      const tsBurst = WEAPON_STATS[name].burst ?? 1;
      // Only test if either side explicitly declares a burst value
      if (iniSection.Burst === undefined && WEAPON_STATS[name].burst === undefined) continue;
      it(`${name} Burst: TS=${tsBurst} vs INI=${iniBurst}`, () => {
        expect(tsBurst).toBe(iniBurst);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Completeness: every TS weapon is accounted for
// ---------------------------------------------------------------------------

describe('Completeness: every WEAPON_STATS entry is classified', () => {
  for (const name of tsWeaponNames) {
    it(`${name} is in INI, engine-custom, or ant-variant`, () => {
      const inINI = ini[name] !== undefined;
      const isCustom = ENGINE_CUSTOM_WEAPONS.has(name);
      const isAntVariant = ANT_VARIANT_WEAPONS.has(name);
      expect(
        inINI || isCustom || isAntVariant,
        `${name} is not accounted for — missing from INI and not in ENGINE_CUSTOM or ANT_VARIANT`,
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Coverage: every INI weapon section with Damage= is accounted for
// ---------------------------------------------------------------------------

describe('Coverage: every INI weapon section is classified', () => {
  // Collect all INI sections that look like weapons (have Damage= key)
  const iniWeaponSections = Object.keys(ini).filter(
    section => ini[section].Damage !== undefined,
  );

  const tsNames = new Set(tsWeaponNames);

  for (const section of iniWeaponSections) {
    it(`INI [${section}] is in WEAPON_STATS, structure-only, or known exclusion`, () => {
      const inTS = tsNames.has(section);
      const isStructOnly = STRUCTURE_ONLY_INI_WEAPONS.has(section);
      const isAntVariant = ANT_VARIANT_WEAPONS.has(section);
      expect(
        inTS || isStructOnly || isAntVariant,
        `INI [${section}] has Damage= but is unaccounted in TS engine`,
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Engine-custom weapons: verify they really have no INI section
// ---------------------------------------------------------------------------

describe('Engine-custom weapons have no INI section', () => {
  for (const name of ENGINE_CUSTOM_WEAPONS) {
    it(`${name} has no [${name}] section in rules.ini/aftrmath.ini`, () => {
      expect(ini[name]).toBeUndefined();
    });
    it(`${name} exists in WEAPON_STATS`, () => {
      expect(WEAPON_STATS[name]).toBeDefined();
    });
  }
});

// ---------------------------------------------------------------------------
// 5. Ant-variant weapons: document the intentional divergence
// ---------------------------------------------------------------------------

describe('Ant-variant weapons: INI section exists but TS uses scenario values', () => {
  it('TeslaZap INI is building version (Damage=100, ROF=120, Range=8.5)', () => {
    const iniTZ = ini['TeslaZap'];
    expect(iniTZ).toBeDefined();
    expect(parseInt(iniTZ.Damage, 10)).toBe(100);
    expect(parseInt(iniTZ.ROF, 10)).toBe(120);
    expect(parseFloat(iniTZ.Range)).toBe(8.5);
  });

  it('WEAPON_STATS TeslaZap is ANT3 melee variant (different from INI)', () => {
    const ts = WEAPON_STATS['TeslaZap'];
    expect(ts).toBeDefined();
    // ANT3 variant: damage=60, rof=25, range=1.75
    expect(ts.damage).toBe(60);
    expect(ts.rof).toBe(25);
    expect(ts.range).toBe(1.75);
  });
});

// ---------------------------------------------------------------------------
// 6. Comprehensive mismatch summary (single test, reports ALL at once)
// ---------------------------------------------------------------------------

describe('Mismatch summary (all fields, all weapons)', () => {
  it('collects and reports every field mismatch', () => {
    const mismatches: string[] = [];

    for (const name of sharedWeapons) {
      const ts = WEAPON_STATS[name];
      const iniSection = ini[name];

      // Damage
      if (iniSection.Damage !== undefined) {
        const expected = parseInt(iniSection.Damage, 10);
        if (ts.damage !== expected) {
          mismatches.push(`${name}.Damage: TS=${ts.damage}, INI=${expected}`);
        }
      }

      // ROF
      if (iniSection.ROF !== undefined) {
        const expected = parseInt(iniSection.ROF, 10);
        if (ts.rof !== expected) {
          mismatches.push(`${name}.ROF: TS=${ts.rof}, INI=${expected}`);
        }
      }

      // Range
      if (iniSection.Range !== undefined) {
        const expected = parseFloat(iniSection.Range);
        if (ts.range !== expected) {
          mismatches.push(`${name}.Range: TS=${ts.range}, INI=${expected}`);
        }
      }

      // Warhead
      if (iniSection.Warhead !== undefined) {
        if (ts.warhead !== iniSection.Warhead) {
          mismatches.push(`${name}.Warhead: TS=${ts.warhead}, INI=${iniSection.Warhead}`);
        }
      }

      // Speed (projSpeed)
      if (iniSection.Speed !== undefined) {
        const expected = parseInt(iniSection.Speed, 10);
        if (ts.projSpeed !== expected) {
          mismatches.push(`${name}.Speed: TS projSpeed=${ts.projSpeed}, INI=${expected}`);
        }
      }

      // Burst
      if (iniSection.Burst !== undefined || ts.burst !== undefined) {
        const iniBurst = iniSection.Burst !== undefined ? parseInt(iniSection.Burst, 10) : 1;
        const tsBurst = ts.burst ?? 1;
        if (tsBurst !== iniBurst) {
          mismatches.push(`${name}.Burst: TS=${tsBurst}, INI=${iniBurst}`);
        }
      }
    }

    if (mismatches.length > 0) {
      // This will fail and show every mismatch in the test output
      expect(mismatches).toEqual([]);
    }
  });
});
