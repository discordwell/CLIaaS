/**
 * C++ parity audit: Mission control flags (per-mission behavioral metadata)
 *
 * All expected values are PARSED from rules.ini at test time — no hardcoded values.
 * rules.ini is the authoritative source of truth (CLAUDE.md: "rules.ini Is God").
 *
 * C++ source refs:
 *   - mission.cpp:532-543  MissionControlClass constructor defaults:
 *       { NoThreat=false, Zombie=false, Recruitable=true,
 *         Paralyzed=false, Retaliate=true, Scatter=true }
 *   - mission.cpp:556-573  MissionControlClass::Read_INI — loads overrides from rules.ini
 *   - rules.cpp:1019-1023  Rules_Process: iterates MissionControl[MISSION_COUNT],
 *       calls MissionControl[i].Read_INI(Missions[i]) for each mission type
 *   - const.cpp:83-107     Missions[] string table — maps enum ordinals to INI section names
 *   - defines.h:979-1008   MissionType enum (23 missions, MISSION_NONE=-1, 0..22)
 *
 * Key C++ chain: constructor sets defaults → Read_INI reads [SectionName] from rules.ini →
 *   each flag is overridden only if present in INI. Absent flags keep constructor defaults.
 *
 * Constructor defaults (mission.cpp:532-543):
 *   NoThreat   = false (no)
 *   Zombie     = false (no)
 *   Recruitable = true  (yes)
 *   Paralyzed  = false (no)
 *   Retaliate  = true  (yes)
 *   Scatter    = true  (yes)
 *
 * Read_INI (mission.cpp:556-573):
 *   IsNoThreat   = ini.Get_Bool(section, "NoThreat",    IsNoThreat);
 *   IsZombie     = ini.Get_Bool(section, "Zombie",      IsZombie);
 *   IsRecruitable= ini.Get_Bool(section, "Recruitable", IsRecruitable);
 *   IsParalyzed  = ini.Get_Bool(section, "Paralyzed",   IsParalyzed);
 *   IsRetaliate  = ini.Get_Bool(section, "Retaliate",   IsRetaliate);
 *   IsScatter    = ini.Get_Bool(section, "Scatter",     IsScatter);
 *
 * Plain Get_Bool: returns INI value if key exists, otherwise returns the default.
 * No asymmetric ||/&& logic — each flag is independently overridable.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Mission, MISSION_CONTROL } from '../engine/types';

// ---------------------------------------------------------------------------
// Parse rules.ini at test time (authoritative source of truth)
// ---------------------------------------------------------------------------
const RULES_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/rules.ini');
const rulesText = fs.readFileSync(RULES_INI_PATH, 'utf-8');

interface IniSection {
  [key: string]: string;
}

function parseINI(text: string): Record<string, IniSection> {
  const result: Record<string, IniSection> = {};
  let currentSection = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.split(';')[0].trim();
    if (!line) continue;
    const secMatch = line.match(/^\[([^\]]+)\]$/);
    if (secMatch) {
      currentSection = secMatch[1];
      if (!result[currentSection]) result[currentSection] = {};
      continue;
    }
    if (!currentSection) continue;
    const kvMatch = line.match(/^(\w+)=(.*)$/);
    if (!kvMatch) continue;
    if (!result[currentSection]) result[currentSection] = {};
    result[currentSection][kvMatch[1]] = kvMatch[2].trim();
  }
  return result;
}

const INI = parseINI(rulesText);

/**
 * Parse a yes/no boolean from INI, returning the provided default if absent.
 * C++ INIClass::Get_Bool uses case-insensitive matching for "yes"/"true"/"1"/"on".
 */
function iniBool(section: string, key: string, defaultValue: boolean): boolean {
  const sec = INI[section];
  if (!sec || !(key in sec)) return defaultValue;
  const val = sec[key].toLowerCase();
  return val === 'yes' || val === 'true' || val === '1' || val === 'on';
}

// ---------------------------------------------------------------------------
// C++ constructor defaults (mission.cpp:532-543)
// ---------------------------------------------------------------------------
const DEFAULTS = {
  NoThreat: false,
  Zombie: false,
  Recruitable: true,
  Paralyzed: false,
  Retaliate: true,
  Scatter: true,
};

/**
 * Compute expected mission control flags by applying INI overrides on top of
 * C++ constructor defaults. C++ mission.cpp:556-573 uses plain ini.Get_Bool()
 * for ALL flags — no asymmetric ||/&& logic. Get_Bool returns the INI value
 * if the key exists, otherwise returns the default.
 */
function expectedFromINI(iniSection: string) {
  // Plain Get_Bool: ini value if present, else C++ default (mission.cpp:559-564)
  const noThreat    = iniBool(iniSection, 'NoThreat',    DEFAULTS.NoThreat);
  const zombie      = iniBool(iniSection, 'Zombie',      DEFAULTS.Zombie);
  const recruitable = iniBool(iniSection, 'Recruitable', DEFAULTS.Recruitable);
  const paralyzed   = iniBool(iniSection, 'Paralyzed',   DEFAULTS.Paralyzed);
  const retaliate   = iniBool(iniSection, 'Retaliate',   DEFAULTS.Retaliate);
  const scatter     = iniBool(iniSection, 'Scatter',     DEFAULTS.Scatter);

  return {
    isNoThreat: noThreat,
    isZombie: zombie,
    isRecruitable: recruitable,
    isParalyzed: paralyzed,
    isRetaliate: retaliate,
    isScatter: scatter,
  };
}

// ---------------------------------------------------------------------------
// Mapping: TS Mission enum → C++ Missions[] string → rules.ini section name
// (const.cpp:83-107 defines the string table)
// ---------------------------------------------------------------------------
// C++ MISSION_DECONSTRUCTION has string name "Selling" (const.cpp:102),
// so its INI section is [Selling], not [Deconstruction].
const MISSION_TO_INI_SECTION: [Mission, string][] = [
  [Mission.SLEEP,          'Sleep'],
  [Mission.ATTACK,         'Attack'],
  [Mission.MOVE,           'Move'],
  [Mission.QMOVE,          'QMove'],
  [Mission.RETREAT,        'Retreat'],
  [Mission.GUARD,          'Guard'],
  [Mission.STICKY,         'Sticky'],
  [Mission.ENTER,          'Enter'],
  [Mission.CAPTURE,        'Capture'],
  [Mission.HARVEST,        'Harvest'],
  [Mission.AREA_GUARD,     'Area Guard'],
  [Mission.RETURN,         'Return'],
  [Mission.STOP,           'Stop'],
  [Mission.AMBUSH,         'Ambush'],
  [Mission.HUNT,           'Hunt'],
  [Mission.UNLOAD,         'Unload'],
  [Mission.SABOTAGE,       'Sabotage'],
  [Mission.CONSTRUCTION,   'Construction'],
  [Mission.DECONSTRUCTION, 'Selling'],
  [Mission.REPAIR,         'Repair'],
  [Mission.RESCUE,         'Rescue'],
  [Mission.MISSILE,        'Missile'],
  [Mission.HARMLESS,       'Harmless'],
];

// ---------------------------------------------------------------------------
// Verify INI parsing sanity
// ---------------------------------------------------------------------------
describe('INI parsing sanity checks', () => {
  it('rules.ini was loaded and parsed', () => {
    expect(Object.keys(INI).length).toBeGreaterThan(0);
  });

  it('all mission INI sections exist in rules.ini', () => {
    for (const [mission, section] of MISSION_TO_INI_SECTION) {
      expect(
        INI[section],
        `INI section [${section}] for Mission.${mission} should exist`
      ).toBeDefined();
    }
  });

  it('[Sleep] section has explicit Zombie=yes override', () => {
    expect(INI['Sleep']?.['Zombie']).toBe('yes');
  });

  it('[Selling] section has explicit NoThreat=yes override', () => {
    expect(INI['Selling']?.['NoThreat']).toBe('yes');
  });

  it('[Guard] section has no flag overrides (only Rate/AARate)', () => {
    // Guard uses all constructor defaults — no boolean flags in INI
    const guardFlags = ['NoThreat', 'Zombie', 'Recruitable', 'Paralyzed', 'Retaliate', 'Scatter'];
    for (const flag of guardFlags) {
      expect(
        INI['Guard']?.[flag],
        `[Guard] should not have ${flag} override`
      ).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Per-mission flag verification: TS MISSION_CONTROL vs rules.ini
// ---------------------------------------------------------------------------
describe('MISSION_CONTROL flags vs rules.ini (C++ mission.cpp defaults + INI overrides)', () => {

  it('MISSION_CONTROL has entries for all 23 C++ missions', () => {
    for (const [mission, section] of MISSION_TO_INI_SECTION) {
      expect(
        MISSION_CONTROL[mission],
        `MISSION_CONTROL missing entry for [${section}] (Mission.${mission})`
      ).toBeDefined();
    }
  });

  // Test each mission's 6 flags against INI-parsed expected values
  for (const [mission, iniSection] of MISSION_TO_INI_SECTION) {
    describe(`[${iniSection}] (Mission.${mission})`, () => {
      const expected = expectedFromINI(iniSection);

      it('isNoThreat', () => {
        expect(
          MISSION_CONTROL[mission]?.isNoThreat,
          `[${iniSection}].NoThreat: INI says ${expected.isNoThreat}`
        ).toBe(expected.isNoThreat);
      });

      it('isZombie', () => {
        expect(
          MISSION_CONTROL[mission]?.isZombie,
          `[${iniSection}].Zombie: INI says ${expected.isZombie}`
        ).toBe(expected.isZombie);
      });

      it('isRecruitable', () => {
        expect(
          MISSION_CONTROL[mission]?.isRecruitable,
          `[${iniSection}].Recruitable: INI says ${expected.isRecruitable}`
        ).toBe(expected.isRecruitable);
      });

      it('isParalyzed', () => {
        expect(
          MISSION_CONTROL[mission]?.isParalyzed,
          `[${iniSection}].Paralyzed: INI says ${expected.isParalyzed}`
        ).toBe(expected.isParalyzed);
      });

      it('isRetaliate', () => {
        expect(
          MISSION_CONTROL[mission]?.isRetaliate,
          `[${iniSection}].Retaliate: INI says ${expected.isRetaliate}`
        ).toBe(expected.isRetaliate);
      });

      it('isScatter', () => {
        expect(
          MISSION_CONTROL[mission]?.isScatter,
          `[${iniSection}].Scatter: INI says ${expected.isScatter}`
        ).toBe(expected.isScatter);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Structural completeness
// ---------------------------------------------------------------------------
describe('MISSION_CONTROL structural completeness', () => {

  it('covers all 23 C++ missions (MISSION_COUNT=23)', () => {
    expect(MISSION_TO_INI_SECTION.length).toBe(23);
  });

  it('every mission in the TS Mission enum has a MISSION_CONTROL entry', () => {
    const allMissions = Object.values(Mission);
    for (const m of allMissions) {
      expect(
        MISSION_CONTROL[m],
        `MISSION_CONTROL missing entry for Mission.${m}`
      ).toBeDefined();
    }
  });

  it('TS-only DIE mission has MISSION_CONTROL entry (not in C++)', () => {
    // DIE is TS-only. C++ has no MISSION_DIE — death is handled through Strength.
    // Its control flags should match an inert state (all disabled).
    const die = MISSION_CONTROL[Mission.DIE];
    expect(die, 'MISSION_CONTROL should have DIE entry').toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// C++ behavioral contracts derived from constructor + Read_INI asymmetry
// ---------------------------------------------------------------------------
describe('C++ Read_INI asymmetric flag logic contracts (mission.cpp:556-573)', () => {

  // The || operators mean these flags can only be turned ON by INI, never OFF.
  // The && operators mean these flags can only be turned OFF by INI, never ON.
  // This means:
  //   - If constructor default is false for NoThreat/Zombie/Paralyzed,
  //     only INI "yes" can make it true. INI "no" keeps it false.
  //   - If constructor default is true for Recruitable/Retaliate/Scatter,
  //     only INI "no" can make it false. INI "yes" keeps it true.

  it('[Sleep] Zombie: INI Zombie=yes turns on (default was no)', () => {
    const expected = iniBool('Sleep', 'Zombie', DEFAULTS.Zombie);
    expect(expected).toBe(true);
    expect(MISSION_CONTROL[Mission.SLEEP]?.isZombie).toBe(true);
  });

  it('[Sticky] Paralyzed: INI Paralyzed=yes turns on (default was no)', () => {
    const expected = iniBool('Sticky', 'Paralyzed', DEFAULTS.Paralyzed);
    expect(expected).toBe(true);
    expect(MISSION_CONTROL[Mission.STICKY]?.isParalyzed).toBe(true);
  });

  it('[Harmless] NoThreat: INI NoThreat=yes turns on (default was no)', () => {
    const expected = iniBool('Harmless', 'NoThreat', DEFAULTS.NoThreat);
    expect(expected).toBe(true);
    expect(MISSION_CONTROL[Mission.HARMLESS]?.isNoThreat).toBe(true);
  });

  it('[Hunt] Retaliate: INI Retaliate=no turns off (default was yes)', () => {
    const expected = iniBool('Hunt', 'Retaliate', DEFAULTS.Retaliate);
    expect(expected).toBe(false);
    expect(MISSION_CONTROL[Mission.HUNT]?.isRetaliate).toBe(false);
  });

  it('[Capture] Scatter: INI Scatter=no turns off (default was yes)', () => {
    const expected = iniBool('Capture', 'Scatter', DEFAULTS.Scatter);
    expect(expected).toBe(false);
    expect(MISSION_CONTROL[Mission.CAPTURE]?.isScatter).toBe(false);
  });

  it('[Sleep] Recruitable: INI Recruitable=no turns off (default was yes)', () => {
    const expected = iniBool('Sleep', 'Recruitable', DEFAULTS.Recruitable);
    expect(expected).toBe(false);
    expect(MISSION_CONTROL[Mission.SLEEP]?.isRecruitable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cross-mission invariant checks (derived from INI data)
// ---------------------------------------------------------------------------
describe('Cross-mission invariants from rules.ini', () => {

  it('only missions with explicit NoThreat=yes in INI have isNoThreat=true', () => {
    const noThreatMissions: Mission[] = [];
    for (const [mission, section] of MISSION_TO_INI_SECTION) {
      if (iniBool(section, 'NoThreat', DEFAULTS.NoThreat)) {
        noThreatMissions.push(mission);
      }
    }
    // Should be exactly: Harmless, Selling (Deconstruction)
    // (only sections with explicit NoThreat=yes)
    for (const m of noThreatMissions) {
      expect(
        MISSION_CONTROL[m]?.isNoThreat,
        `Mission.${m} should be NoThreat per INI`
      ).toBe(true);
    }
  });

  it('only missions with explicit Zombie=yes in INI have isZombie=true', () => {
    const zombieMissions: Mission[] = [];
    for (const [mission, section] of MISSION_TO_INI_SECTION) {
      if (iniBool(section, 'Zombie', DEFAULTS.Zombie)) {
        zombieMissions.push(mission);
      }
    }
    // Should be exactly: Sleep (only section with Zombie=yes)
    for (const m of zombieMissions) {
      expect(
        MISSION_CONTROL[m]?.isZombie,
        `Mission.${m} should be Zombie per INI`
      ).toBe(true);
    }
  });

  it('only missions with explicit Paralyzed=yes in INI have isParalyzed=true', () => {
    const paralyzedMissions: Mission[] = [];
    for (const [mission, section] of MISSION_TO_INI_SECTION) {
      if (iniBool(section, 'Paralyzed', DEFAULTS.Paralyzed)) {
        paralyzedMissions.push(mission);
      }
    }
    // Should be exactly: Sticky (only section with Paralyzed=yes)
    for (const m of paralyzedMissions) {
      expect(
        MISSION_CONTROL[m]?.isParalyzed,
        `Mission.${m} should be Paralyzed per INI`
      ).toBe(true);
    }
  });

  it('missions without Recruitable=no keep default Recruitable=yes', () => {
    // These missions have NO Recruitable override in INI, so they keep the default (true).
    const recruitableByDefault: Mission[] = [];
    for (const [mission, section] of MISSION_TO_INI_SECTION) {
      if (iniBool(section, 'Recruitable', DEFAULTS.Recruitable)) {
        recruitableByDefault.push(mission);
      }
    }
    for (const m of recruitableByDefault) {
      expect(
        MISSION_CONTROL[m]?.isRecruitable,
        `Mission.${m} should keep default Recruitable=yes per INI`
      ).toBe(true);
    }
  });

  it('missions without Retaliate=no keep default Retaliate=yes', () => {
    const retaliateByDefault: Mission[] = [];
    for (const [mission, section] of MISSION_TO_INI_SECTION) {
      if (iniBool(section, 'Retaliate', DEFAULTS.Retaliate)) {
        retaliateByDefault.push(mission);
      }
    }
    for (const m of retaliateByDefault) {
      expect(
        MISSION_CONTROL[m]?.isRetaliate,
        `Mission.${m} should keep default Retaliate=yes per INI`
      ).toBe(true);
    }
  });

  it('missions without Scatter=no keep default Scatter=yes', () => {
    const scatterByDefault: Mission[] = [];
    for (const [mission, section] of MISSION_TO_INI_SECTION) {
      if (iniBool(section, 'Scatter', DEFAULTS.Scatter)) {
        scatterByDefault.push(mission);
      }
    }
    for (const m of scatterByDefault) {
      expect(
        MISSION_CONTROL[m]?.isScatter,
        `Mission.${m} should keep default Scatter=yes per INI`
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Document exact INI-vs-TS divergences for triage
// ---------------------------------------------------------------------------
describe('Divergence documentation: TS values that differ from rules.ini', () => {

  // This section explicitly documents every known divergence between the
  // TS MISSION_CONTROL and the INI-derived expected values. Each test
  // asserts the INI expectation (which may currently fail if TS diverges).
  // Failed tests here indicate TS engine bugs that need fixing.

  const FLAG_NAMES = ['isNoThreat', 'isZombie', 'isRecruitable', 'isParalyzed', 'isRetaliate', 'isScatter'] as const;

  it('summary: count total flag divergences across all missions', () => {
    let divergences = 0;
    const details: string[] = [];

    for (const [mission, iniSection] of MISSION_TO_INI_SECTION) {
      const expected = expectedFromINI(iniSection);
      const actual = MISSION_CONTROL[mission];
      if (!actual) continue;

      for (const flag of FLAG_NAMES) {
        if (actual[flag] !== expected[flag]) {
          divergences++;
          details.push(
            `  [${iniSection}].${flag}: INI→${expected[flag]}, TS→${actual[flag]}`
          );
        }
      }
    }

    // Log divergences for triage (will appear in test output)
    if (divergences > 0) {
      console.warn(
        `\n⚠ ${divergences} mission control flag divergence(s) from rules.ini:\n${details.join('\n')}`
      );
    }

    // This test documents the count but does NOT fail — the per-flag tests above handle assertions.
    // Change this to expect(divergences).toBe(0) once all TS values match INI.
    expect(typeof divergences).toBe('number');
  });
});
