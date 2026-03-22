/**
 * C++ Behavioral Parity: Weapon Data
 *
 * Verifies TypeScript WEAPON_STATS matches C++ rules.ini / aftrmath.ini weapon
 * section values exactly. For each weapon, compares: Damage, ROF, Range, Speed
 * (projSpeed), Projectile type, and Warhead.
 *
 * C++ source: rules.ini weapon sections (lines 2086-2449), aftrmath.ini weapon
 * sections (lines 154-241, 489-498), ant scenario INIs (SCA01EA.ini etc.).
 *
 * Authority chain: rules.ini -> aftrmath.ini overrides -> scenario INI overrides
 * Per project rules: rules.ini is God, NOT C++ constructor defaults.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { WEAPON_STATS } from '../engine/types';
import { STRUCTURE_WEAPONS } from '../engine/scenario';

// ---------------------------------------------------------------------------
// INI parser — identical to warhead-data parity pattern
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
// Load all INI files
// ---------------------------------------------------------------------------
const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');
const rules = parseINI(readFileSync(join(assetsDir, 'rules.ini'), 'utf-8'));
const aftrmath = parseINI(readFileSync(join(assetsDir, 'aftrmath.ini'), 'utf-8'));

// Ant scenario INIs — these define Mandible and override TeslaZap for ants
const antScenarioFiles = ['SCA01EA.ini', 'SCA02EA.ini', 'SCA03EA.ini', 'SCA04EA.ini'];
const antINIs = antScenarioFiles.map((f) => {
  try {
    return parseINI(readFileSync(join(assetsDir, f), 'utf-8'));
  } catch {
    return {};
  }
});

// Merge: rules.ini base, then aftrmath.ini overrides
const ini: Record<string, Record<string, string>> = {};
for (const [section, values] of Object.entries(rules)) {
  ini[section] = { ...values };
}
for (const [section, values] of Object.entries(aftrmath)) {
  ini[section] = { ...(ini[section] || {}), ...values };
}

// Build a separate merged INI that also includes ant scenario data
// (for weapons like Mandible and the ant variant of TeslaZap)
const iniWithAnts: Record<string, Record<string, string>> = {};
for (const [section, values] of Object.entries(ini)) {
  iniWithAnts[section] = { ...values };
}
for (const antIni of antINIs) {
  for (const [section, values] of Object.entries(antIni)) {
    // Only pull in weapon-like sections (ones that have Damage= key)
    if (values.Damage != null) {
      if (!iniWithAnts[section]) {
        iniWithAnts[section] = { ...values };
      }
      // Don't override — first ant scenario that defines it wins
    }
  }
}

// ---------------------------------------------------------------------------
// Projectile type lookup: maps projectile name to its INI section properties
// This is needed to verify TS boolean flags like isArcing, isHigh, etc.
// ---------------------------------------------------------------------------
const projectileSections: Record<string, Record<string, string>> = {};
const PROJECTILE_NAMES = [
  'Invisible', 'LeapDog', 'Cannon', 'Ack', 'Torpedo', 'FROG',
  'HeatSeeker', 'LaserGuided', 'AAMissile', 'Lobbed', 'Catapult',
  'Bomblet', 'Ballistic', 'Parachute', 'GPSSatellite', 'NukeUp',
  'NukeDown', 'Fireball',
];
for (const name of PROJECTILE_NAMES) {
  // Check aftrmath override first, then rules
  if (aftrmath[name]) {
    projectileSections[name] = { ...(rules[name] || {}), ...aftrmath[name] };
  } else if (rules[name]) {
    projectileSections[name] = { ...rules[name] };
  }
}

// ---------------------------------------------------------------------------
// Helper to get a weapon's INI section, accounting for the authority chain
// ---------------------------------------------------------------------------
function getWeaponINI(weaponName: string): Record<string, string> | undefined {
  return ini[weaponName];
}

// ---------------------------------------------------------------------------
// Categorize weapons for structured test groups
// ---------------------------------------------------------------------------

// All weapons defined in rules.ini weapon sections
// (identified by having Damage=, ROF=, Range=, Projectile=, Speed=, Warhead= keys)
const RULES_INI_WEAPONS = [
  'Colt45', 'ZSU-23', 'Vulcan', 'Maverick', 'Camera', 'FireballLauncher',
  'Flamer', 'Sniper', 'ChainGun', 'Pistol', 'M1Carbine', 'Dragon',
  'Hellfire', 'Grenade', '75mm', '90mm', '105mm', '120mm', 'TurretGun',
  'MammothTusk', '155mm', 'M60mg', 'Napalm', 'TeslaZap', 'Nike',
  'RedEye', '8Inch', 'Stinger', 'TorpTube', '2Inch', 'DepthCharge',
  'ParaBomb', 'DogJaw', 'Heal', 'SCUD',
];

// Weapons defined only in aftrmath.ini (new expansion weapons)
const AFTRMATH_ONLY_WEAPONS = [
  'AirAssault', 'PortaTesla', 'TTankZap', 'GoodWrench', 'SubSCUD',
  'APTusk', 'Democharge',
];

// Weapons defined in ant scenario INIs (not in rules.ini or aftrmath.ini as weapons)
const ANT_SCENARIO_WEAPONS = ['Mandible'];

// All INI-defined weapons (combined)
const ALL_INI_WEAPONS = [
  ...RULES_INI_WEAPONS,
  ...AFTRMATH_ONLY_WEAPONS,
  ...ANT_SCENARIO_WEAPONS,
];

// Weapons in WEAPON_STATS that have NO INI section at all
const TS_ONLY_WEAPONS = Object.keys(WEAPON_STATS).filter((name) => {
  // Check rules, aftrmath, and ant scenario INIs
  if (ini[name] && ini[name].Damage != null) return false;
  for (const antIni of antINIs) {
    if (antIni[name] && antIni[name].Damage != null) return false;
  }
  return true;
});

// Weapons in INI that are missing from WEAPON_STATS
const MISSING_FROM_TS = ALL_INI_WEAPONS.filter((name) => {
  return WEAPON_STATS[name] === undefined;
});

// ---------------------------------------------------------------------------
// Helper to resolve effective INI values for a weapon
// (considers rules.ini -> aftrmath.ini -> ant scenario override chain)
// ---------------------------------------------------------------------------

// Weapons that ONLY exist in ant scenario INIs (not in rules.ini or aftrmath.ini as weapons).
// These are the only weapons that should use ant scenario data.
const ANT_ONLY_WEAPONS = new Set(['Mandible']);

// Weapons where the TS engine intentionally uses ant scenario values instead of
// the rules.ini building weapon values. These get ant scenario INI data.
const TS_ANT_VARIANT_WEAPONS = new Set(['TeslaZap']);

function getEffectiveWeaponINI(weaponName: string): Record<string, string> | undefined {
  // For ant-only weapons, check scenario INIs first
  if (ANT_ONLY_WEAPONS.has(weaponName)) {
    for (const antIni of antINIs) {
      if (antIni[weaponName] && antIni[weaponName].Damage != null) {
        return antIni[weaponName];
      }
    }
  }
  // For standard weapons, use rules.ini + aftrmath.ini only
  return ini[weaponName];
}

// ---------------------------------------------------------------------------
// Helper to map INI Projectile name to expected TS projectile type string
// (used for Projectile= field comparison)
// ---------------------------------------------------------------------------
function normalizeProjectileName(name: string): string {
  // Handle the typo in rules.ini: "Inivisble" (Camera weapon)
  if (name === 'Inivisble') return 'Invisible';
  return name;
}

// ===========================================================================
// TEST SUITES
// ===========================================================================

describe('C++ Parity: WEAPON_STATS vs rules.ini/aftrmath.ini weapon data', () => {

  // -------------------------------------------------------------------------
  // 1. Core fields: Damage, ROF, Range, Speed (projSpeed), Warhead
  //    These are the 5 mandatory fields every weapon section must have.
  // -------------------------------------------------------------------------

  describe('Infantry weapons — core fields', () => {
    const INFANTRY_WEAPONS = ['M1Carbine', 'Grenade', 'Dragon', 'RedEye', 'Flamer',
      'DogJaw', 'Heal', 'Sniper', 'Colt45', 'Pistol'];

    for (const name of INFANTRY_WEAPONS) {
      describe(name, () => {
        const iniSection = getWeaponINI(name);

        it('exists in both WEAPON_STATS and INI', () => {
          expect(WEAPON_STATS[name], `WEAPON_STATS['${name}'] should exist`).toBeDefined();
          expect(iniSection, `INI section [${name}] should exist`).toBeDefined();
        });

        it('Damage matches INI', () => {
          if (!iniSection) return;
          const expected = parseInt(iniSection.Damage, 10);
          expect(WEAPON_STATS[name].damage).toBe(expected);
        });

        it('ROF matches INI', () => {
          if (!iniSection) return;
          const expected = parseInt(iniSection.ROF, 10);
          expect(WEAPON_STATS[name].rof).toBe(expected);
        });

        it('Range matches INI', () => {
          if (!iniSection) return;
          const expected = parseFloat(iniSection.Range);
          expect(WEAPON_STATS[name].range).toBeCloseTo(expected, 4);
        });

        it('Speed (projSpeed) matches INI', () => {
          if (!iniSection) return;
          const expected = parseInt(iniSection.Speed, 10);
          expect(WEAPON_STATS[name].projSpeed).toBe(expected);
        });

        it('Warhead matches INI', () => {
          if (!iniSection) return;
          expect(WEAPON_STATS[name].warhead).toBe(iniSection.Warhead);
        });
      });
    }
  });

  describe('Vehicle weapons — core fields', () => {
    const VEHICLE_WEAPONS = ['M60mg', '75mm', '90mm', '105mm', '120mm',
      'MammothTusk', '155mm'];

    for (const name of VEHICLE_WEAPONS) {
      describe(name, () => {
        const iniSection = getWeaponINI(name);

        it('exists in both WEAPON_STATS and INI', () => {
          expect(WEAPON_STATS[name], `WEAPON_STATS['${name}'] should exist`).toBeDefined();
          expect(iniSection, `INI section [${name}] should exist`).toBeDefined();
        });

        it('Damage matches INI', () => {
          if (!iniSection) return;
          const expected = parseInt(iniSection.Damage, 10);
          expect(WEAPON_STATS[name].damage).toBe(expected);
        });

        it('ROF matches INI', () => {
          if (!iniSection) return;
          const expected = parseInt(iniSection.ROF, 10);
          expect(WEAPON_STATS[name].rof).toBe(expected);
        });

        it('Range matches INI', () => {
          if (!iniSection) return;
          const expected = parseFloat(iniSection.Range);
          expect(WEAPON_STATS[name].range).toBeCloseTo(expected, 4);
        });

        it('Speed (projSpeed) matches INI', () => {
          if (!iniSection) return;
          const expected = parseInt(iniSection.Speed, 10);
          expect(WEAPON_STATS[name].projSpeed).toBe(expected);
        });

        it('Warhead matches INI', () => {
          if (!iniSection) return;
          expect(WEAPON_STATS[name].warhead).toBe(iniSection.Warhead);
        });
      });
    }
  });

  describe('Aircraft weapons — core fields', () => {
    const AIRCRAFT_WEAPONS = ['Maverick', 'Hellfire', 'ChainGun', 'Napalm',
      'Camera', 'ParaBomb'];

    for (const name of AIRCRAFT_WEAPONS) {
      describe(name, () => {
        const iniSection = getWeaponINI(name);

        it('exists in both WEAPON_STATS and INI', () => {
          expect(WEAPON_STATS[name], `WEAPON_STATS['${name}'] should exist`).toBeDefined();
          expect(iniSection, `INI section [${name}] should exist`).toBeDefined();
        });

        it('Damage matches INI', () => {
          if (!iniSection) return;
          const expected = parseInt(iniSection.Damage, 10);
          expect(WEAPON_STATS[name].damage).toBe(expected);
        });

        it('ROF matches INI', () => {
          if (!iniSection) return;
          const expected = parseInt(iniSection.ROF, 10);
          expect(WEAPON_STATS[name].rof).toBe(expected);
        });

        it('Range matches INI', () => {
          if (!iniSection) return;
          const expected = parseFloat(iniSection.Range);
          expect(WEAPON_STATS[name].range).toBeCloseTo(expected, 4);
        });

        it('Speed (projSpeed) matches INI', () => {
          if (!iniSection) return;
          const expected = parseInt(iniSection.Speed, 10);
          expect(WEAPON_STATS[name].projSpeed).toBe(expected);
        });

        it('Warhead matches INI', () => {
          if (!iniSection) return;
          expect(WEAPON_STATS[name].warhead).toBe(iniSection.Warhead);
        });
      });
    }
  });

  describe('Naval weapons — core fields', () => {
    const NAVAL_WEAPONS = ['Stinger', 'TorpTube', 'DepthCharge', '8Inch', '2Inch'];

    for (const name of NAVAL_WEAPONS) {
      describe(name, () => {
        const iniSection = getWeaponINI(name);

        it('exists in both WEAPON_STATS and INI', () => {
          expect(WEAPON_STATS[name], `WEAPON_STATS['${name}'] should exist`).toBeDefined();
          expect(iniSection, `INI section [${name}] should exist`).toBeDefined();
        });

        it('Damage matches INI', () => {
          if (!iniSection) return;
          const expected = parseInt(iniSection.Damage, 10);
          expect(WEAPON_STATS[name].damage).toBe(expected);
        });

        it('ROF matches INI', () => {
          if (!iniSection) return;
          const expected = parseInt(iniSection.ROF, 10);
          expect(WEAPON_STATS[name].rof).toBe(expected);
        });

        it('Range matches INI', () => {
          if (!iniSection) return;
          const expected = parseFloat(iniSection.Range);
          expect(WEAPON_STATS[name].range).toBeCloseTo(expected, 4);
        });

        it('Speed (projSpeed) matches INI', () => {
          if (!iniSection) return;
          const expected = parseInt(iniSection.Speed, 10);
          expect(WEAPON_STATS[name].projSpeed).toBe(expected);
        });

        it('Warhead matches INI', () => {
          if (!iniSection) return;
          expect(WEAPON_STATS[name].warhead).toBe(iniSection.Warhead);
        });
      });
    }
  });

  describe('Building weapons — core fields', () => {
    // TeslaZap in rules.ini is the building Tesla Coil weapon (Damage=100, ROF=120, Range=8.5)
    // FireballLauncher is the Flame Tower weapon
    const BUILDING_WEAPONS = ['TeslaZap', 'FireballLauncher'];

    for (const name of BUILDING_WEAPONS) {
      describe(`${name} (building version from rules.ini)`, () => {
        // Use rules.ini values directly (not ant scenario overrides)
        const iniSection = rules[name];

        it('exists in INI', () => {
          expect(iniSection, `INI section [${name}] should exist in rules.ini`).toBeDefined();
        });

        // NOTE: The TS WEAPON_STATS 'TeslaZap' entry uses ant scenario values
        // (damage=60, rof=25, range=1.75 from SCA01EA.ini), while the building
        // weapon is stored as 'TeslaCannon' (damage=100, rof=120, range=8.5).
        // TeslaCannon doesn't have its own INI section — it maps to rules.ini [TeslaZap].
        // This test verifies whether the TS entry matches the authoritative INI.
        if (name === 'TeslaZap') {
          it('DISCREPANCY: TS TeslaZap uses ant values, not building values from rules.ini', () => {
            if (!iniSection) return;
            const iniDamage = parseInt(iniSection.Damage, 10);
            const tsDamage = WEAPON_STATS[name].damage;
            // rules.ini [TeslaZap] Damage=100, but TS TeslaZap has damage=60 (ant variant)
            // This documents the split: building=TeslaCannon (TS), ant=TeslaZap (TS)
            expect(tsDamage).not.toBe(iniDamage); // 60 !== 100
          });

          it('TeslaCannon in TS should match rules.ini [TeslaZap] Damage', () => {
            if (!iniSection) return;
            const expected = parseInt(iniSection.Damage, 10);
            expect(WEAPON_STATS.TeslaCannon?.damage).toBe(expected);
          });

          it('TeslaCannon in TS should match rules.ini [TeslaZap] ROF', () => {
            if (!iniSection) return;
            const expected = parseInt(iniSection.ROF, 10);
            expect(WEAPON_STATS.TeslaCannon?.rof).toBe(expected);
          });

          it('TeslaCannon in TS should match rules.ini [TeslaZap] Range', () => {
            if (!iniSection) return;
            const expected = parseFloat(iniSection.Range);
            expect(WEAPON_STATS.TeslaCannon?.range).toBeCloseTo(expected, 4);
          });

          it('TeslaCannon in TS should match rules.ini [TeslaZap] Warhead', () => {
            if (!iniSection) return;
            expect(WEAPON_STATS.TeslaCannon?.warhead).toBe(iniSection.Warhead);
          });
        } else {
          it('Damage matches INI', () => {
            if (!iniSection) return;
            const expected = parseInt(iniSection.Damage, 10);
            expect(WEAPON_STATS[name].damage).toBe(expected);
          });

          it('ROF matches INI', () => {
            if (!iniSection) return;
            const expected = parseInt(iniSection.ROF, 10);
            expect(WEAPON_STATS[name].rof).toBe(expected);
          });

          it('Range matches INI', () => {
            if (!iniSection) return;
            const expected = parseFloat(iniSection.Range);
            expect(WEAPON_STATS[name].range).toBeCloseTo(expected, 4);
          });

          it('Speed (projSpeed) matches INI', () => {
            if (!iniSection) return;
            const expected = parseInt(iniSection.Speed, 10);
            expect(WEAPON_STATS[name].projSpeed).toBe(expected);
          });

          it('Warhead matches INI', () => {
            if (!iniSection) return;
            expect(WEAPON_STATS[name].warhead).toBe(iniSection.Warhead);
          });
        }
      });
    }
  });

  describe('Expansion weapons (aftrmath.ini) — core fields', () => {
    const EXPANSION_WEAPONS = ['PortaTesla', 'TTankZap', 'GoodWrench', 'SubSCUD',
      'APTusk', 'Democharge'];

    for (const name of EXPANSION_WEAPONS) {
      describe(name, () => {
        // aftrmath.ini overrides rules.ini
        const iniSection = ini[name];

        it('exists in both WEAPON_STATS and INI', () => {
          expect(WEAPON_STATS[name], `WEAPON_STATS['${name}'] should exist`).toBeDefined();
          expect(iniSection, `INI section [${name}] should exist`).toBeDefined();
        });

        it('Damage matches INI', () => {
          if (!iniSection) return;
          const expected = parseInt(iniSection.Damage, 10);
          expect(WEAPON_STATS[name].damage).toBe(expected);
        });

        it('ROF matches INI', () => {
          if (!iniSection) return;
          const expected = parseInt(iniSection.ROF, 10);
          expect(WEAPON_STATS[name].rof).toBe(expected);
        });

        it('Range matches INI', () => {
          if (!iniSection) return;
          const expected = parseFloat(iniSection.Range);
          expect(WEAPON_STATS[name].range).toBeCloseTo(expected, 4);
        });

        it('Speed (projSpeed) matches INI', () => {
          if (!iniSection) return;
          const expected = parseInt(iniSection.Speed, 10);
          expect(WEAPON_STATS[name].projSpeed).toBe(expected);
        });

        it('Warhead matches INI', () => {
          if (!iniSection) return;
          expect(WEAPON_STATS[name].warhead).toBe(iniSection.Warhead);
        });
      });
    }
  });

  describe('SCUD / V2 Rocket — core fields', () => {
    const iniSection = getWeaponINI('SCUD');

    it('exists in both WEAPON_STATS and INI', () => {
      expect(WEAPON_STATS.SCUD, 'WEAPON_STATS.SCUD should exist').toBeDefined();
      expect(iniSection, 'INI section [SCUD] should exist').toBeDefined();
    });

    it('Damage matches INI', () => {
      if (!iniSection) return;
      const expected = parseInt(iniSection.Damage, 10);
      expect(WEAPON_STATS.SCUD.damage).toBe(expected);
    });

    it('ROF matches INI', () => {
      if (!iniSection) return;
      const expected = parseInt(iniSection.ROF, 10);
      expect(WEAPON_STATS.SCUD.rof).toBe(expected);
    });

    it('Range matches INI', () => {
      if (!iniSection) return;
      const expected = parseFloat(iniSection.Range);
      expect(WEAPON_STATS.SCUD.range).toBeCloseTo(expected, 4);
    });

    it('Speed (projSpeed) matches INI', () => {
      if (!iniSection) return;
      const expected = parseInt(iniSection.Speed, 10);
      expect(WEAPON_STATS.SCUD.projSpeed).toBe(expected);
    });

    it('Warhead matches INI', () => {
      if (!iniSection) return;
      expect(WEAPON_STATS.SCUD.warhead).toBe(iniSection.Warhead);
    });
  });

  describe('Ant scenario weapons (SCA*.ini) — core fields', () => {
    describe('Mandible (from SCA01EA.ini)', () => {
      // Mandible only exists in ant scenario INIs
      const antSection = antINIs.map((ini) => ini.Mandible).find(Boolean);

      it('exists in WEAPON_STATS', () => {
        expect(WEAPON_STATS.Mandible, 'WEAPON_STATS.Mandible should exist').toBeDefined();
      });

      it('exists in ant scenario INI', () => {
        expect(antSection, 'Mandible section should exist in ant scenario INI').toBeDefined();
      });

      it('Damage matches ant scenario INI', () => {
        if (!antSection) return;
        const expected = parseInt(antSection.Damage, 10);
        expect(WEAPON_STATS.Mandible.damage).toBe(expected);
      });

      it('ROF matches ant scenario INI', () => {
        if (!antSection) return;
        const expected = parseInt(antSection.ROF, 10);
        expect(WEAPON_STATS.Mandible.rof).toBe(expected);
      });

      it('Range matches ant scenario INI', () => {
        if (!antSection) return;
        const expected = parseFloat(antSection.Range);
        expect(WEAPON_STATS.Mandible.range).toBeCloseTo(expected, 4);
      });

      it('Speed (projSpeed) matches ant scenario INI', () => {
        if (!antSection) return;
        const expected = parseInt(antSection.Speed, 10);
        // Mandible INI Speed=100 (Invisible projectile), but TS has projSpeed=40
        // This is a potential discrepancy to investigate
        expect(WEAPON_STATS.Mandible.projSpeed).toBe(expected);
      });

      it('Warhead matches ant scenario INI', () => {
        if (!antSection) return;
        expect(WEAPON_STATS.Mandible.warhead).toBe(antSection.Warhead);
      });
    });

    describe('TeslaZap ant variant (from SCA01EA.ini)', () => {
      // The ant version of TeslaZap from scenario INIs
      const antSection = antINIs.map((ini) => ini.TeslaZap).find(Boolean);

      it('ant scenario TeslaZap INI section exists', () => {
        expect(antSection, 'TeslaZap section should exist in ant scenario INI').toBeDefined();
      });

      it('TS TeslaZap Damage matches ant scenario INI (not building rules.ini)', () => {
        if (!antSection) return;
        const expected = parseInt(antSection.Damage, 10);
        expect(WEAPON_STATS.TeslaZap.damage).toBe(expected);
      });

      it('TS TeslaZap ROF matches ant scenario INI', () => {
        if (!antSection) return;
        const expected = parseInt(antSection.ROF, 10);
        expect(WEAPON_STATS.TeslaZap.rof).toBe(expected);
      });

      it('TS TeslaZap Range matches ant scenario INI', () => {
        if (!antSection) return;
        const expected = parseFloat(antSection.Range);
        expect(WEAPON_STATS.TeslaZap.range).toBeCloseTo(expected, 4);
      });

      it('TS TeslaZap Speed matches ant scenario INI', () => {
        if (!antSection) return;
        const expected = parseInt(antSection.Speed, 10);
        expect(WEAPON_STATS.TeslaZap.projSpeed).toBe(expected);
      });

      it('TS TeslaZap Warhead matches ant scenario INI', () => {
        if (!antSection) return;
        expect(WEAPON_STATS.TeslaZap.warhead).toBe(antSection.Warhead);
      });
    });
  });

  // -------------------------------------------------------------------------
  // 2. Projectile= field — verify the projectile type referenced by each weapon
  // -------------------------------------------------------------------------
  describe('Projectile= field — weapon references correct projectile type', () => {
    // All weapons that exist in both WEAPON_STATS and an INI file
    const weaponsInBoth = ALL_INI_WEAPONS.filter((name) => WEAPON_STATS[name] !== undefined);

    for (const name of weaponsInBoth) {
      it(`${name}: Projectile= value exists in INI`, () => {
        const iniSection = getEffectiveWeaponINI(name);
        if (!iniSection) return;
        const projName = normalizeProjectileName(iniSection.Projectile || '');
        // Verify the projectile type is a known projectile section
        // (some weapons reference 'Invisible' which may be 'Inivisble' typo in INI)
        expect(projName.length).toBeGreaterThan(0);
      });
    }
  });

  // -------------------------------------------------------------------------
  // 3. Burst= field — weapons with multiple shots per trigger pull
  // -------------------------------------------------------------------------
  describe('Burst= field parity', () => {
    // Weapons that have Burst= in INI (after aftrmath.ini override)
    const BURST_WEAPONS = ALL_INI_WEAPONS.filter((name) => {
      const section = getEffectiveWeaponINI(name);
      return section && section.Burst != null;
    });

    for (const name of BURST_WEAPONS) {
      it(`${name}: burst count matches INI Burst=`, () => {
        const iniSection = getEffectiveWeaponINI(name)!;
        const expectedBurst = parseInt(iniSection.Burst, 10);
        const ts = WEAPON_STATS[name];
        if (!ts) {
          // Weapon missing from TS — tested in gap section
          return;
        }
        const tsBurst = ts.burst ?? 1; // default burst is 1
        expect(tsBurst).toBe(expectedBurst);
      });
    }
  });

  // -------------------------------------------------------------------------
  // 4. Projectile boolean flags — cross-check weapon's projectile type
  //    against the projectile section's flags (High=, Arcing=, AA=, etc.)
  // -------------------------------------------------------------------------
  describe('Projectile flags parity (from projectile type INI sections)', () => {
    // For each weapon in WEAPON_STATS that has a matching INI section,
    // verify boolean flags derived from its Projectile= type section
    const weaponsToCheck = ALL_INI_WEAPONS.filter((name) => {
      const section = getEffectiveWeaponINI(name);
      return section && WEAPON_STATS[name] !== undefined;
    });

    for (const name of weaponsToCheck) {
      const iniSection = getEffectiveWeaponINI(name)!;
      const projType = normalizeProjectileName(iniSection.Projectile || '');
      const projSection = projectileSections[projType];
      const ts = WEAPON_STATS[name];

      if (!projSection) continue; // Can't verify without projectile section

      describe(`${name} (Projectile=${projType})`, () => {
        it('isArcing matches projectile Arcing= flag', () => {
          const iniArcing = projSection.Arcing?.toLowerCase() === 'yes';
          if (iniArcing) {
            expect(ts.isArcing).toBe(true);
          } else {
            expect(ts.isArcing ?? false).toBe(false);
          }
        });

        it('isHigh matches projectile High= flag', () => {
          const iniHigh = projSection.High?.toLowerCase() === 'yes';
          if (iniHigh) {
            expect(ts.isHigh).toBe(true);
          } else {
            expect(ts.isHigh ?? false).toBe(false);
          }
        });

        it('isInvisible matches projectile Inviso= flag', () => {
          const iniInviso = projSection.Inviso?.toLowerCase() === 'yes';
          if (iniInviso) {
            expect(ts.isInvisible).toBe(true);
          } else {
            expect(ts.isInvisible ?? false).toBe(false);
          }
        });

        it('isInaccurate matches projectile Inaccurate= flag', () => {
          const iniInaccurate = projSection.Inaccurate?.toLowerCase() === 'yes';
          if (iniInaccurate) {
            expect(ts.isInaccurate).toBe(true);
          } else {
            expect(ts.isInaccurate ?? false).toBe(false);
          }
        });

        it('isFueled matches projectile Ranged= flag', () => {
          const iniRanged = projSection.Ranged?.toLowerCase() === 'yes';
          if (iniRanged) {
            expect(ts.isFueled).toBe(true);
          } else {
            expect(ts.isFueled ?? false).toBe(false);
          }
        });

        it('isDropping matches projectile Dropping= flag', () => {
          const iniDropping = projSection.Dropping?.toLowerCase() === 'yes';
          if (iniDropping) {
            expect(ts.isDropping).toBe(true);
          } else {
            expect(ts.isDropping ?? false).toBe(false);
          }
        });

        it('isParachuted matches projectile Parachuted= flag', () => {
          const iniParachuted = projSection.Parachuted?.toLowerCase() === 'yes';
          if (iniParachuted) {
            expect(ts.isParachuted).toBe(true);
          } else {
            expect(ts.isParachuted ?? false).toBe(false);
          }
        });

        it('isGigundo matches projectile Gigundo= flag', () => {
          const iniGigundo = projSection.Gigundo?.toLowerCase() === 'yes';
          if (iniGigundo) {
            expect(ts.isGigundo).toBe(true);
          } else {
            expect(ts.isGigundo ?? false).toBe(false);
          }
        });

        it('isDegenerate matches projectile Degenerates= flag', () => {
          const iniDegen = projSection.Degenerates?.toLowerCase() === 'yes';
          if (iniDegen) {
            expect(ts.isDegenerate).toBe(true);
          } else {
            // Note: Some TS weapons mark isDegenerate=true even when the
            // projectile INI doesn't say Degenerates=yes. This may be an
            // engine-level behavior for certain projectile types (e.g.,
            // Cannon projectiles lose strength over distance in C++).
            // We still test it to document any divergence.
            expect(ts.isDegenerate ?? false).toBe(false);
          }
        });

        // AA (anti-air) flag
        if (projSection.AA != null) {
          it('isAntiAir matches projectile AA= flag', () => {
            const iniAA = projSection.AA?.toLowerCase() === 'yes' ||
                          projSection.AA?.toLowerCase() === 'true';
            if (iniAA) {
              expect(ts.isAntiAir).toBe(true);
            } else {
              expect(ts.isAntiAir ?? false).toBe(false);
            }
          });
        }

        // AG (anti-ground) flag — only test if explicitly set in INI
        if (projSection.AG != null) {
          it('isAntiGround matches projectile AG= flag', () => {
            const iniAG = projSection.AG?.toLowerCase() === 'no' ||
                          projSection.AG?.toLowerCase() === 'false';
            if (iniAG) {
              expect(ts.isAntiGround).toBe(false);
            }
            // If AG is not 'no', default is ground-capable (no TS flag needed)
          });
        }

        // ROT (homing turn rate) — projectile-level
        if (projSection.ROT != null) {
          it('projectileROT matches projectile ROT= value', () => {
            const expectedROT = parseInt(projSection.ROT, 10);
            if (expectedROT > 0) {
              expect(ts.projectileROT).toBe(expectedROT);
            }
          });
        }

        // UnderWater (torpedoes)
        if (projSection.UnderWater != null) {
          it('isSubSurface matches projectile UnderWater= flag', () => {
            const iniUnderWater = projSection.UnderWater?.toLowerCase() === 'yes';
            if (iniUnderWater) {
              expect(ts.isSubSurface).toBe(true);
            } else {
              expect(ts.isSubSurface ?? false).toBe(false);
            }
          });
        }

        // ASW (anti-submarine warfare)
        if (projSection.ASW != null) {
          it('isAntiSub matches projectile ASW= flag', () => {
            const iniASW = projSection.ASW?.toLowerCase() === 'yes';
            if (iniASW) {
              expect(ts.isAntiSub).toBe(true);
            } else {
              expect(ts.isAntiSub ?? false).toBe(false);
            }
          });
        }
      });
    }
  });

  // -------------------------------------------------------------------------
  // 5. Coverage: INI weapons implemented as STRUCTURE_WEAPONS (not WEAPON_STATS)
  // -------------------------------------------------------------------------
  describe('Structure weapons: INI weapons in STRUCTURE_WEAPONS, not WEAPON_STATS', () => {
    // These 4 INI weapons are structure-only weapons. The TS engine implements
    // them in STRUCTURE_WEAPONS (keyed by structure type), not in WEAPON_STATS
    // (keyed by weapon name). This is by design: structure weapons are applied
    // directly to their building, not shared across unit types.
    const STRUCTURE_WEAPON_MAP = [
      { name: 'ZSU-23', structure: 'AGUN', note: 'Anti-aircraft multiple cannon (used by AGUN structure)' },
      { name: 'Vulcan', structure: 'PBOX', note: 'Rapid fire machine gun (used by structures/pillbox)' },
      { name: 'Nike', structure: 'SAM', note: 'Anti-aircraft SAM missile (used by SAM site structure)' },
      { name: 'TurretGun', structure: 'GUN', note: 'Turret cannon (used by turret structure, also in aftrmath.ini)' },
    ];

    for (const entry of STRUCTURE_WEAPON_MAP) {
      it(`${entry.name} — exists in INI and implemented via STRUCTURE_WEAPONS['${entry.structure}']`, () => {
        const iniSection = getWeaponINI(entry.name);
        expect(iniSection, `INI section [${entry.name}] should exist`).toBeDefined();
        // Not in WEAPON_STATS (unit weapon table) — this is expected for structure-only weapons
        expect(WEAPON_STATS[entry.name]).toBeUndefined();
        // Instead, implemented in STRUCTURE_WEAPONS keyed by structure type
        expect(
          STRUCTURE_WEAPONS[entry.structure],
          `STRUCTURE_WEAPONS['${entry.structure}'] should exist for ${entry.name}`,
        ).toBeDefined();
      });
    }

    // AirAssault is a placeholder weapon — it IS in WEAPON_STATS
    it('AirAssault — Aftermath air assault placeholder weapon (Range=127, Damage=0)', () => {
      const iniSection = getWeaponINI('AirAssault');
      expect(iniSection, `INI section [AirAssault] should exist`).toBeDefined();
      expect(
        WEAPON_STATS['AirAssault'],
        `WEAPON_STATS['AirAssault'] should exist`,
      ).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Coverage gap: WEAPON_STATS entries with NO INI section
  // -------------------------------------------------------------------------
  describe('Coverage gaps: WEAPON_STATS entries with no INI weapon section', () => {
    // These are weapons in TS that don't correspond to any INI weapon section.
    // They may be engine-synthesized or mapped from other INI sections.

    for (const name of TS_ONLY_WEAPONS) {
      it(`TS-ONLY: ${name} has no matching INI weapon section`, () => {
        // Document these — they should either be mapped to an INI section
        // or explicitly documented as engine-synthesized weapons.
        const ts = WEAPON_STATS[name];
        expect(ts, `WEAPON_STATS['${name}'] exists in TS`).toBeDefined();

        // Check if this is a known mapping (e.g., TeslaCannon -> rules.ini [TeslaZap])
        const KNOWN_MAPPINGS: Record<string, string> = {
          TeslaCannon: 'TeslaZap',  // Building Tesla Coil: TS 'TeslaCannon' = INI '[TeslaZap]'
        };

        if (KNOWN_MAPPINGS[name]) {
          const mappedINI = ini[KNOWN_MAPPINGS[name]];
          expect(
            mappedINI,
            `${name} maps to INI [${KNOWN_MAPPINGS[name]}] which should exist`,
          ).toBeDefined();
        } else {
          // Unknown TS-only weapon — document as needing investigation
          expect.fail(
            `WEAPON_STATS['${name}'] has no INI source. ` +
            `If this is intentional, add it to KNOWN_MAPPINGS or document the source.`,
          );
        }
      });
    }
  });

  // -------------------------------------------------------------------------
  // 7. Comprehensive field-by-field audit for ALL weapons in both sources
  //    This is the "catch-all" that tests every weapon systematically
  // -------------------------------------------------------------------------
  describe('Comprehensive: every WEAPON_STATS entry with INI section — all 5 core fields', () => {
    // Build the list of all weapons that exist in both TS and some INI
    const allTSWeapons = Object.keys(WEAPON_STATS);

    // Weapons where TS intentionally uses ant scenario INI values instead of
    // rules.ini values (because the building version uses a different TS name).
    // TeslaZap: TS has ant values (damage=60), building version is 'TeslaCannon' in TS.
    // Mandible: only exists in ant scenario INIs, not in rules.ini.
    const ANT_SCENARIO_OVERRIDE = new Set(['TeslaZap', 'Mandible']);

    for (const name of allTSWeapons) {
      // Try to find this weapon's INI section from any source
      let iniSection: Record<string, string> | undefined;

      // For ant-override weapons, check scenario INIs first
      if (ANT_SCENARIO_OVERRIDE.has(name)) {
        for (const antIni of antINIs) {
          if (antIni[name] && antIni[name].Damage != null) {
            iniSection = antIni[name];
            break;
          }
        }
      }

      // Check main INI (rules + aftrmath merged) if not found yet
      if (!iniSection && ini[name] && ini[name].Damage != null) {
        iniSection = ini[name];
      }

      // Check ant scenario INIs for weapons not in main INI
      if (!iniSection) {
        for (const antIni of antINIs) {
          if (antIni[name] && antIni[name].Damage != null) {
            iniSection = antIni[name];
            break;
          }
        }
      }

      if (!iniSection) continue; // TS-only weapon, tested in gap section

      describe(`[${name}] comprehensive check`, () => {
        const ts = WEAPON_STATS[name];

        it('Damage', () => {
          expect(ts.damage).toBe(parseInt(iniSection!.Damage, 10));
        });

        it('ROF', () => {
          expect(ts.rof).toBe(parseInt(iniSection!.ROF, 10));
        });

        it('Range', () => {
          expect(ts.range).toBeCloseTo(parseFloat(iniSection!.Range), 4);
        });

        it('Speed (projSpeed)', () => {
          expect(ts.projSpeed).toBe(parseInt(iniSection!.Speed, 10));
        });

        it('Warhead', () => {
          expect(ts.warhead).toBe(iniSection!.Warhead);
        });
      });
    }
  });
});
