/**
 * CPP Parity: Points= values from rules.ini / aftrmath.ini vs TS UNIT_STATS
 *
 * Completeness check: for EVERY unit key in UNIT_STATS, parse the authoritative
 * INI files directly and verify the TS `points` field matches.
 *
 * rules.ini is the authoritative source. aftrmath.ini overrides rules.ini for
 * Aftermath expansion units (C++ load order: rules.ini first, aftrmath.ini second).
 *
 * C++ source refs:
 *   techno.cpp:6290     Risk = Reward = Points (loaded from rules.ini Points= field)
 *   techno.cpp:3911     source->House->PointTotal += points (kill credit)
 *   techno.cpp:3990     House->PointTotal -= points (loss debit)
 *   idata.cpp           Infantry Points= loaded per-infantry section
 *   udata.cpp           Vehicle Points= loaded per-vehicle section
 *   vdata.cpp           Vessel Points= loaded per-vessel section
 *   aadata.cpp          Aircraft Points= loaded per-aircraft section
 *   rules.ini [X]       Points= per unit section
 *   aftrmath.ini [X]    Aftermath overrides (later load order wins)
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { UNIT_STATS } from '../engine/types';

// ---------------------------------------------------------------------------
// INI Parser — parse rules.ini / aftrmath.ini to extract section key=value pairs
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
// Load INI files (aftrmath.ini overrides rules.ini per C++ load order)
// ---------------------------------------------------------------------------

const rulesPath = join(__dirname, '../../..', 'public/ra/assets/rules.ini');
const aftermathPath = join(__dirname, '../../..', 'public/ra/assets/aftrmath.ini');
const rulesINI = parseINI(readFileSync(rulesPath, 'utf-8'));
const aftermathINI = parseINI(readFileSync(aftermathPath, 'utf-8'));

/** Get Points= for a section, with aftrmath.ini overriding rules.ini */
function getIniPoints(section: string): number | undefined {
  const aftVal = aftermathINI[section]?.Points;
  if (aftVal !== undefined) return parseInt(aftVal, 10);
  const rulesVal = rulesINI[section]?.Points;
  if (rulesVal !== undefined) return parseInt(rulesVal, 10);
  return undefined;
}

// ---------------------------------------------------------------------------
// Collect every unit key from UNIT_STATS and classify
// ---------------------------------------------------------------------------

const ALL_UNIT_KEYS = Object.keys(UNIT_STATS);

/** Units that have Points= in INI (either rules.ini or aftrmath.ini) */
const UNITS_WITH_INI_POINTS = ALL_UNIT_KEYS.filter(k => getIniPoints(k) !== undefined);

/** Units that have NO Points= in INI (scenario-defined: ants) */
const UNITS_WITHOUT_INI_POINTS = ALL_UNIT_KEYS.filter(k => getIniPoints(k) === undefined);

// ---------------------------------------------------------------------------
// 1. Sanity: INI files loaded and contain expected data
// ---------------------------------------------------------------------------

describe('INI parsing sanity checks', () => {
  it('rules.ini loaded with sections', () => {
    expect(Object.keys(rulesINI).length).toBeGreaterThan(50);
  });

  it('aftrmath.ini loaded with sections', () => {
    expect(Object.keys(aftermathINI).length).toBeGreaterThan(10);
  });

  it('UNIT_STATS has entries to test', () => {
    expect(ALL_UNIT_KEYS.length).toBeGreaterThan(50);
  });

  it('most UNIT_STATS keys have Points= in INI', () => {
    // Only ANT1, ANT2, ANT3 should be missing (scenario-defined)
    expect(UNITS_WITH_INI_POINTS.length).toBeGreaterThanOrEqual(59);
  });
});

// ---------------------------------------------------------------------------
// 2. CORE CHECK: every UNIT_STATS key with INI Points= must match TS `points`
//    This is the primary completeness audit.
// ---------------------------------------------------------------------------

describe('UNIT_STATS.points matches rules.ini/aftrmath.ini Points= for ALL units', () => {
  for (const unitKey of UNITS_WITH_INI_POINTS) {
    const iniPoints = getIniPoints(unitKey)!;
    const tsPoints = UNIT_STATS[unitKey].points;

    it(`${unitKey}: INI Points=${iniPoints}, TS points=${tsPoints}`, () => {
      expect(tsPoints, `${unitKey} should have a points field in UNIT_STATS`).toBeDefined();
      expect(tsPoints).toBe(iniPoints);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Units without INI Points= should NOT have a points field in TS
//    (ants are scenario-defined, not in rules.ini)
// ---------------------------------------------------------------------------

describe('Scenario-defined units (no INI Points=) have no TS points field', () => {
  for (const unitKey of UNITS_WITHOUT_INI_POINTS) {
    it(`${unitKey}: no INI Points= and no TS points (scenario-defined)`, () => {
      expect(UNIT_STATS[unitKey].points).toBeUndefined();
    });
  }

  it('only ANT1, ANT2, ANT3 are scenario-defined (no INI Points=)', () => {
    expect(UNITS_WITHOUT_INI_POINTS.sort()).toEqual(['ANT1', 'ANT2', 'ANT3']);
  });
});

// ---------------------------------------------------------------------------
// 4. Per-category detailed checks (explicit expected values from INI)
//    These serve as documentation and catch regressions even if INI files change.
// ---------------------------------------------------------------------------

describe('Vehicle Points= explicit values (C++ udata.cpp + rules.ini)', () => {
  // Expected values derived directly from rules.ini / aftrmath.ini
  const EXPECTED: [string, number][] = [
    ['1TNK',  30],   // rules.ini [1TNK] Points=30
    ['2TNK',  40],   // rules.ini [2TNK] Points=40
    ['3TNK',  50],   // rules.ini [3TNK] Points=50
    ['4TNK',  60],   // rules.ini [4TNK] Points=60 (also aftrmath.ini Points=60)
    ['V2RL',  40],   // rules.ini [V2RL] Points=40
    ['JEEP',  20],   // rules.ini [JEEP] Points=20
    ['APC',   25],   // rules.ini [APC]  Points=25
    ['ARTY',  35],   // rules.ini [ARTY] Points=35
    ['HARV',  55],   // rules.ini [HARV] Points=55
    ['MCV',   60],   // rules.ini [MCV]  Points=60
    ['MNLY',  50],   // rules.ini [MNLY] Points=50
    ['MRJ',   30],   // rules.ini [MRJ]  Points=30
    ['MGG',   40],   // rules.ini [MGG]  Points=40
    ['TRUK',   5],   // rules.ini [TRUK] Points=5
    // Aftermath vehicles (aftrmath.ini only)
    ['STNK',  25],   // aftrmath.ini [STNK] Points=25
    ['CTNK',  25],   // aftrmath.ini [CTNK] Points=25
    ['TTNK',  30],   // aftrmath.ini [TTNK] Points=30
    ['QTNK',  60],   // aftrmath.ini [QTNK] Points=60
    ['DTRK',   5],   // aftrmath.ini [DTRK] Points=5
  ];

  for (const [type, expectedPoints] of EXPECTED) {
    it(`${type}: Points=${expectedPoints}`, () => {
      expect(getIniPoints(type)).toBe(expectedPoints);
      expect(UNIT_STATS[type].points).toBe(expectedPoints);
    });
  }
});

describe('Infantry Points= explicit values (C++ idata.cpp + rules.ini)', () => {
  const EXPECTED: [string, number][] = [
    ['E1',       5],   // rules.ini [E1]   Points=5
    ['E2',      10],   // rules.ini [E2]   Points=10
    ['E3',      10],   // rules.ini [E3]   Points=10  (also aftrmath.ini Points=10)
    ['E4',      15],   // rules.ini [E4]   Points=15
    ['E6',      20],   // rules.ini [E6]   Points=20
    ['E7',      25],   // rules.ini [E7]   Points=25
    ['DOG',      5],   // rules.ini [DOG]  Points=5   (also aftrmath.ini Points=5)
    ['SPY',     15],   // rules.ini [SPY]  Points=15
    ['THF',     10],   // rules.ini [THF]  Points=10
    ['MEDI',    15],   // rules.ini [MEDI] Points=15
    ['GNRL',    15],   // rules.ini [GNRL] Points=15  (also aftrmath.ini Points=15)
    ['CHAN',      1],   // rules.ini [CHAN] Points=1   (also aftrmath.ini Points=1)
    ['DELPHI',   1],   // rules.ini [DELPHI] Points=1 (also aftrmath.ini Points=1)
    // Aftermath infantry (aftrmath.ini only)
    ['SHOK',    15],   // aftrmath.ini [SHOK] Points=15
    ['MECH',    15],   // aftrmath.ini [MECH] Points=15
  ];

  for (const [type, expectedPoints] of EXPECTED) {
    it(`${type}: Points=${expectedPoints}`, () => {
      expect(getIniPoints(type)).toBe(expectedPoints);
      expect(UNIT_STATS[type].points).toBe(expectedPoints);
    });
  }
});

describe('Civilian Points= explicit values (all should be 1)', () => {
  const CIVILIANS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'EINSTEIN'];

  for (const type of CIVILIANS) {
    it(`${type}: Points=1`, () => {
      expect(getIniPoints(type)).toBe(1);
      expect(UNIT_STATS[type].points).toBe(1);
    });
  }
});

describe('Naval Points= explicit values (C++ vdata.cpp + rules.ini)', () => {
  const EXPECTED: [string, number][] = [
    ['SS',    45],   // rules.ini [SS]   Points=45
    ['DD',    50],   // rules.ini [DD]   Points=50
    ['CA',    60],   // rules.ini [CA]   Points=60
    ['LST',   25],   // rules.ini [LST]  Points=25  (also aftrmath.ini Points=25)
    ['PT',    30],   // rules.ini [PT]   Points=30
    // Aftermath naval (aftrmath.ini only)
    ['MSUB',  45],   // aftrmath.ini [MSUB] Points=45
    ['CARR',  25],   // aftrmath.ini [CARR] Points=25
  ];

  for (const [type, expectedPoints] of EXPECTED) {
    it(`${type}: Points=${expectedPoints}`, () => {
      expect(getIniPoints(type)).toBe(expectedPoints);
      expect(UNIT_STATS[type].points).toBe(expectedPoints);
    });
  }
});

describe('Aircraft Points= explicit values (C++ aadata.cpp + rules.ini)', () => {
  const EXPECTED: [string, number][] = [
    ['MIG',   50],   // rules.ini [MIG]  Points=50
    ['YAK',   25],   // rules.ini [YAK]  Points=25
    ['TRAN',  35],   // rules.ini [TRAN] Points=35
    ['HELI',  50],   // rules.ini [HELI] Points=50
    ['HIND',  40],   // rules.ini [HIND] Points=40
    ['BADR',  20],   // rules.ini [BADR] Points=20
    ['U2',     5],   // rules.ini [U2]   Points=5
  ];

  for (const [type, expectedPoints] of EXPECTED) {
    it(`${type}: Points=${expectedPoints}`, () => {
      expect(getIniPoints(type)).toBe(expectedPoints);
      expect(UNIT_STATS[type].points).toBe(expectedPoints);
    });
  }
});

// ---------------------------------------------------------------------------
// 5. Aftermath override semantics: aftrmath.ini Points= overrides rules.ini
//    Verify that units present in both files use the aftrmath.ini value.
// ---------------------------------------------------------------------------

describe('Aftermath override semantics for Points= (C++ load order)', () => {
  // Units that have Points= in BOTH rules.ini AND aftrmath.ini
  const DUAL_PRESENT: [string, number, number][] = [
    // [type, rules.ini Points=, aftrmath.ini Points=]
    ['4TNK',   60, 60],
    ['E3',     10, 10],
    ['DOG',     5,  5],
    ['GNRL',   15, 15],
    ['CHAN',     1,  1],
    ['DELPHI',  1,  1],
    ['C2',      1,  1],
    ['C3',      1,  1],
    ['C4',      1,  1],
    ['C5',      1,  1],
    ['C6',      1,  1],
    ['C9',      1,  1],
    ['LST',    25, 25],
  ];

  for (const [type, rulesPoints, aftPoints] of DUAL_PRESENT) {
    it(`${type}: rules.ini Points=${rulesPoints}, aftrmath.ini Points=${aftPoints} — TS uses aftermath value`, () => {
      const rulesVal = rulesINI[type]?.Points;
      const aftVal = aftermathINI[type]?.Points;
      expect(rulesVal).toBeDefined();
      expect(aftVal).toBeDefined();
      expect(parseInt(rulesVal!, 10)).toBe(rulesPoints);
      expect(parseInt(aftVal!, 10)).toBe(aftPoints);
      // Merged value should be aftrmath.ini (last loaded wins)
      expect(getIniPoints(type)).toBe(aftPoints);
      expect(UNIT_STATS[type].points).toBe(aftPoints);
    });
  }

  // Units that have Points= ONLY in aftrmath.ini (not in rules.ini)
  const AFT_ONLY: [string, number][] = [
    ['SHOK',  15],
    ['MECH',  15],
    ['STNK',  25],
    ['CTNK',  25],
    ['TTNK',  30],
    ['QTNK',  60],
    ['DTRK',   5],
    ['MSUB',  45],
    ['CARR',  25],
  ];

  for (const [type, aftPoints] of AFT_ONLY) {
    it(`${type}: aftrmath.ini-only Points=${aftPoints}`, () => {
      expect(rulesINI[type]?.Points).toBeUndefined();
      expect(aftermathINI[type]?.Points).toBeDefined();
      expect(getIniPoints(type)).toBe(aftPoints);
      expect(UNIT_STATS[type].points).toBe(aftPoints);
    });
  }
});

// ---------------------------------------------------------------------------
// 6. Completeness guard: every UNIT_STATS key is accounted for
// ---------------------------------------------------------------------------

describe('Completeness: every UNIT_STATS key classified', () => {
  it('UNITS_WITH_INI_POINTS + UNITS_WITHOUT_INI_POINTS = ALL_UNIT_KEYS', () => {
    const combined = [...UNITS_WITH_INI_POINTS, ...UNITS_WITHOUT_INI_POINTS].sort();
    expect(combined).toEqual(ALL_UNIT_KEYS.sort());
  });

  it('no UNIT_STATS key is unaccounted for', () => {
    const covered = new Set([...UNITS_WITH_INI_POINTS, ...UNITS_WITHOUT_INI_POINTS]);
    const uncovered = ALL_UNIT_KEYS.filter(k => !covered.has(k));
    expect(uncovered).toEqual([]);
  });

  it(`total UNIT_STATS keys: ${ALL_UNIT_KEYS.length}`, () => {
    // Ensure this test updates if new units are added
    expect(ALL_UNIT_KEYS.length).toBeGreaterThanOrEqual(62);
  });
});
