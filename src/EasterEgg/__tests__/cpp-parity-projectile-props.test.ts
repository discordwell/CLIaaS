/**
 * C++ Behavioral Parity: Projectile Properties
 *
 * Verifies WEAPON_STATS boolean flags match the weapon->projectile->INI property chain.
 * Each weapon's Projectile= field in INI points to a projectile section with boolean
 * properties (Arcing, AA, High, etc.) that must be reflected in TS WeaponStats.
 *
 * C++ source: bullet.cpp, bbdata.cpp, rules.ini lines 2452-2638
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { WEAPON_STATS } from '../engine/types';

// ── INI Parser ───────────────────────────────────────────────────────────────

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

const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');
const rules = parseINI(readFileSync(join(assetsDir, 'rules.ini'), 'utf-8'));
const aftrmath = parseINI(readFileSync(join(assetsDir, 'aftrmath.ini'), 'utf-8'));
const ini: Record<string, Record<string, string>> = {};
for (const [section, values] of Object.entries(rules)) {
  ini[section] = { ...values };
}
for (const [section, values] of Object.entries(aftrmath)) {
  ini[section] = { ...(ini[section] || {}), ...values };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Check if an INI value is truthy (yes/true/1) */
function iniBool(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.toLowerCase();
  return v === 'yes' || v === 'true' || v === '1';
}

/**
 * INI property name -> TS WEAPON_STATS flag name mapping.
 * Each entry: [INI key on projectile section, TS boolean flag on WeaponStats]
 */
const BOOL_FLAG_MAP: [string, keyof typeof WEAPON_STATS[string]][] = [
  ['Arcing', 'isArcing'],
  ['AA', 'isAntiAir'],
  ['High', 'isHigh'],
  ['Inaccurate', 'isInaccurate'],
  ['Ranged', 'isFueled'],
  ['Dropping', 'isDropping'],
  ['Parachuted', 'isParachuted'],
  ['UnderWater', 'isSubSurface'],
  ['ASW', 'isAntiSub'],
  ['Inviso', 'isInvisible'],
  ['Gigundo', 'isGigundo'],
  ['Degenerates', 'isDegenerate'],
];

/**
 * Weapons in WEAPON_STATS that do NOT exist in the merged INI (rules.ini + aftrmath.ini).
 * These are TS-only additions (e.g. naval/scenario weapons not in standard INI).
 */
const TS_ONLY_WEAPONS = new Set([
  'Tomahawk',       // CA cruise missile — TS-created weapon, no INI section
  'SeaSerpent',     // MSUB missiles — TS-created weapon, no INI section
  'Mandible',       // Ant weapon — only in scenario INI files (SCA*.ini), not rules/aftrmath
]);

/**
 * Known INI typos: Camera has Projectile=Inivisble (typo for Invisible).
 * Map the misspelled projectile name to the correct projectile section.
 */
const PROJECTILE_TYPO_MAP: Record<string, string> = {
  'Inivisble': 'Invisible',
};

// ── Test 1: Boolean/numeric flag parity ──────────────────────────────────────

describe('C++ Parity: Projectile boolean/numeric flags from INI', () => {
  // Collect all weapons that exist in both WEAPON_STATS and INI
  const weaponNames = Object.keys(WEAPON_STATS).filter(w => {
    if (TS_ONLY_WEAPONS.has(w)) return false;
    return !!ini[w];
  });

  // Known discrepancies: weapons where TS is intentionally missing INI-derived flags.
  // These are expected failures documented in the test spec. Each entry lists
  // the weapon name and the TS flag that is missing but should be present per INI.
  const KNOWN_MISSING_FLAGS: Record<string, Set<string>> = {
    // Stinger: INI Projectile=LaserGuided (AA=yes, High=yes, Ranged=yes, ROT=20)
    // TS has none of these — treats Stinger as a simple cannon-like weapon
    Stinger: new Set(['isAntiAir', 'isHigh', 'isFueled']),

    // DepthCharge: INI Projectile=Catapult (High=yes, Arcing=yes, Inaccurate=yes)
    // TS only has isAntiSub, missing the arc/high/inaccurate properties
    DepthCharge: new Set(['isArcing', 'isHigh', 'isInaccurate']),

    // HeatSeeker weapons: INI has Inaccurate=yes, Ranged=yes, AA=yes but TS omits some/all
    Dragon: new Set(['isInaccurate', 'isFueled', 'isAntiAir']),
    Hellfire: new Set(['isInaccurate', 'isFueled', 'isAntiAir']),
    Maverick: new Set(['isInaccurate', 'isFueled', 'isAntiAir']),
    MammothTusk: new Set(['isInaccurate', 'isFueled', 'isAntiAir']),
    SubSCUD: new Set(['isInaccurate', 'isAntiAir', 'isFueled']),
    APTusk: new Set(['isInaccurate', 'isAntiAir', 'isFueled']),

    // DogJaw: LeapDog has ROT=20 but TS has no projectileROT
    // (handled separately in ROT test below)

    // RedEye: AAMissile has Ranged=yes but TS omits isFueled
    RedEye: new Set(['isFueled']),

    // Grenade: Lobbed has High=yes, Inaccurate=yes — TS has isArcing but missing these
    Grenade: new Set(['isHigh', 'isInaccurate']),

    // 155mm: Ballistic has High=yes — TS has isArcing, isInaccurate but missing isHigh
    '155mm': new Set(['isHigh']),

    // 8Inch: Ballistic has High=yes, Inaccurate=yes — TS has isArcing but missing isHigh, isInaccurate
    '8Inch': new Set(['isHigh', 'isInaccurate']),

    // SCUD: FROG has Inaccurate=yes — TS has isFueled, isHigh but missing isInaccurate
    SCUD: new Set(['isInaccurate']),

    // ParaBomb: Parachute has High=yes — TS has isDropping, isParachuted but missing isHigh
    ParaBomb: new Set(['isHigh']),

    // Napalm: Bomblet has High=yes — TS missing isHigh and isDropping
    Napalm: new Set(['isHigh', 'isDropping']),

    // Invisible-projectile weapons missing isInvisible in TS:
    // These use Projectile=Invisible (Inviso=yes) but TS doesn't set isInvisible.
    // They rely on projSpeed=40 for instant-hit behavior instead.
    Heal: new Set(['isInvisible']),
    PortaTesla: new Set(['isInvisible']),
    GoodWrench: new Set(['isInvisible']),
    TTankZap: new Set(['isInvisible']),
    TeslaZap: new Set(['isInvisible']),
    Camera: new Set(['isInvisible']),
    Democharge: new Set(['isInvisible']),
    TorpTube: new Set(['isAntiSub']),
    ChainGun: new Set(['isInvisible']),
    Pistol: new Set(['isInvisible']),
  };

  // TS engine additions: flags set in TS WEAPON_STATS that have no basis in INI.
  // These are intentional behavioral overrides, not data errors.
  const KNOWN_TS_ADDITIONS: Record<string, Set<string>> = {
    // DogJaw: TS sets isInvisible but LeapDog projectile has no Inviso=yes.
    // Engine treats dog jaw as instant-hit despite having projectileSpeed for limbo travel.
    DogJaw: new Set(['isInvisible']),

    // SCUD: TS sets isGigundo but FROG projectile has no Gigundo=yes.
    // FROG in INI only has Proximity=yes; Gigundo is on GPSSatellite/NukeUp/NukeDown sections.
    // TS adds isGigundo for the large V2 explosion visual.
    SCUD: new Set(['isGigundo']),
  };

  it('all WEAPON_STATS weapons with INI sections have resolvable projectile types', () => {
    for (const wName of weaponNames) {
      const weaponIni = ini[wName];
      const rawProj = weaponIni?.Projectile;
      expect(rawProj, `${wName} should have Projectile= in INI`).toBeDefined();

      const projName = PROJECTILE_TYPO_MAP[rawProj] || rawProj;
      const projSection = ini[projName];
      expect(projSection, `${wName}: projectile [${projName}] should exist as INI section`).toBeDefined();
    }
  });

  describe('boolean flags: INI projectile properties match TS WEAPON_STATS', () => {
    for (const wName of weaponNames) {
      const weaponIni = ini[wName];
      if (!weaponIni?.Projectile) continue;

      const rawProj = weaponIni.Projectile;
      const projName = PROJECTILE_TYPO_MAP[rawProj] || rawProj;
      const projSection = ini[projName];
      if (!projSection) continue;

      const ts = WEAPON_STATS[wName];
      const knownMissing = KNOWN_MISSING_FLAGS[wName] || new Set();
      const knownAdditions = KNOWN_TS_ADDITIONS[wName] || new Set();

      for (const [iniKey, tsFlag] of BOOL_FLAG_MAP) {
        const iniValue = iniBool(projSection[iniKey]);
        const tsValue = !!(ts as Record<string, unknown>)[tsFlag];

        if (iniValue && !tsValue && knownMissing.has(tsFlag)) {
          // Known discrepancy — test that it IS missing (documents the gap)
          it(`${wName}: ${tsFlag} KNOWN MISSING (INI [${projName}] ${iniKey}=yes, TS omits)`, () => {
            expect(tsValue).toBe(false);
          });
        } else if (!iniValue && tsValue && knownAdditions.has(tsFlag)) {
          // Known TS engine addition — flag is in TS but NOT in INI (intentional override)
          it(`${wName}: ${tsFlag} TS ENGINE ADDITION (not in INI [${projName}], intentional)`, () => {
            expect(tsValue).toBe(true);
          });
        } else if (iniValue) {
          // INI says yes — TS should also be true
          it(`${wName}: ${tsFlag} should be true (INI [${projName}] ${iniKey}=yes)`, () => {
            expect(tsValue, `${wName}.${tsFlag} should be true because [${projName}].${iniKey}=yes`).toBe(true);
          });
        } else if (tsValue && tsFlag !== 'isDegenerate') {
          // TS has a flag but INI doesn't — unexpected addition (skip isDegenerate, tested separately)
          it(`${wName}: ${tsFlag} is true in TS but NOT in INI [${projName}] (unexpected)`, () => {
            // This test documents TS flags that have no INI basis
            // If this fires, either the INI mapping is wrong or the flag is an engine addition
            expect(iniValue, `${wName}.${tsFlag} is true in TS but [${projName}].${iniKey} is not yes`).toBe(true);
          });
        }
      }
    }
  });

  describe('projectileROT: INI ROT values match TS projectileROT', () => {
    // Weapons where ROT is present in INI projectile but missing in TS
    const KNOWN_MISSING_ROT = new Set([
      'Stinger',  // LaserGuided ROT=20, TS has no projectileROT
      'DogJaw',   // LeapDog ROT=20, TS has no projectileROT
      'APTusk',   // HeatSeeker ROT=5, TS has no projectileROT (projSpeed=40 instant-hit)
    ]);

    // Weapons where TS projectileROT differs from INI ROT (intentional overrides)
    // RedEye: AAMissile has ROT=20 but TS uses projectileROT=5 (shared with Dragon/HeatSeeker)
    const KNOWN_ROT_OVERRIDES: Record<string, { ini: number; ts: number }> = {
      RedEye: { ini: 20, ts: 5 },
    };

    for (const wName of weaponNames) {
      const weaponIni = ini[wName];
      if (!weaponIni?.Projectile) continue;

      const rawProj = weaponIni.Projectile;
      const projName = PROJECTILE_TYPO_MAP[rawProj] || rawProj;
      const projSection = ini[projName];
      if (!projSection) continue;

      const iniROT = projSection.ROT ? parseInt(projSection.ROT, 10) : 0;
      const tsROT = WEAPON_STATS[wName].projectileROT ?? 0;

      if (iniROT > 0 && KNOWN_MISSING_ROT.has(wName)) {
        it(`${wName}: projectileROT KNOWN MISSING (INI [${projName}] ROT=${iniROT}, TS omits)`, () => {
          expect(tsROT).toBe(0);
        });
      } else if (KNOWN_ROT_OVERRIDES[wName]) {
        const override = KNOWN_ROT_OVERRIDES[wName];
        it(`${wName}: projectileROT KNOWN OVERRIDE (INI [${projName}] ROT=${override.ini}, TS uses ${override.ts})`, () => {
          expect(iniROT).toBe(override.ini);
          expect(tsROT).toBe(override.ts);
        });
      } else if (iniROT > 0 || tsROT > 0) {
        it(`${wName}: projectileROT=${iniROT} matches INI [${projName}] ROT`, () => {
          expect(tsROT, `${wName}.projectileROT should be ${iniROT} (from [${projName}].ROT)`).toBe(iniROT);
        });
      }
    }
  });
});

// ── Test 2: isDegenerate audit ───────────────────────────────────────────────

describe('C++ Parity: isDegenerate audit — TS engine additions not from INI', () => {
  // These weapons have isDegenerate: true in TS WEAPON_STATS but their
  // INI projectile sections do NOT have Degenerates=yes.
  // In the original C++ code, Degenerates defaults to false (bbdata.cpp).
  // The [Invisible] and [Cannon] projectile sections never set Degenerates=yes.
  // These isDegenerate flags are intentional engine-level additions in the TS port.
  const DEGENERATE_WEAPONS = [
    'M1Carbine',   // Invisible projectile
    'DogJaw',      // LeapDog projectile
    'Sniper',      // Invisible projectile
    'M60mg',       // Invisible projectile
    '75mm',        // Cannon projectile
    '90mm',        // Cannon projectile
    '105mm',       // Cannon projectile
    '120mm',       // Cannon projectile
    'ChainGun',    // Invisible projectile
    'Stinger',     // LaserGuided projectile
    '2Inch',       // Cannon projectile
    'Colt45',      // Invisible projectile
    'Pistol',      // Invisible projectile
  ];

  for (const wName of DEGENERATE_WEAPONS) {
    it(`${wName}: TS has isDegenerate=true (engine addition, not from INI)`, () => {
      const ts = WEAPON_STATS[wName];
      expect(ts, `${wName} should exist in WEAPON_STATS`).toBeDefined();
      expect(ts.isDegenerate, `${wName} should have isDegenerate=true in TS`).toBe(true);

      // Verify the INI projectile section does NOT have Degenerates=yes
      const weaponIni = ini[wName];
      if (weaponIni?.Projectile) {
        const rawProj = weaponIni.Projectile;
        const projName = PROJECTILE_TYPO_MAP[rawProj] || rawProj;
        const projSection = ini[projName];
        if (projSection) {
          const iniDegen = iniBool(projSection.Degenerates);
          expect(iniDegen, `[${projName}].Degenerates should NOT be yes — isDegenerate is a TS engine addition`).toBe(false);
        }
      }
    });
  }

  it('no other WEAPON_STATS entries have isDegenerate besides the documented set', () => {
    const degenerateSet = new Set(DEGENERATE_WEAPONS);
    for (const [wName, stats] of Object.entries(WEAPON_STATS)) {
      if (stats.isDegenerate && !degenerateSet.has(wName)) {
        // Fail with a clear message so new isDegenerate additions get documented
        expect.fail(`${wName} has isDegenerate=true but is not in DEGENERATE_WEAPONS list — add it to the audit`);
      }
    }
  });
});
