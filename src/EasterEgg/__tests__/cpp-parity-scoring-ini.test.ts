/**
 * CPP Parity: Points= values from rules.ini / aftrmath.ini vs TS UNIT_STATS & PRODUCTION_ITEMS
 *
 * Every unit and building in C++ Red Alert has a Points= field in rules.ini
 * that determines the scoring value for kills, threat assessment, and the
 * end-of-mission score screen. This is SEPARATE from Cost=.
 *
 * This test parses rules.ini and aftrmath.ini directly and compares every
 * Points= value against what TS has in UNIT_STATS.points and
 * PRODUCTION_ITEMS[].points.
 *
 * C++ source refs:
 *   techno.cpp:6290     Risk = Reward = Points (from rules.ini Points= field)
 *   techno.cpp:3911     source->House->PointTotal += points (kill credit)
 *   techno.cpp:3990     House->PointTotal -= points (loss debit)
 *   techno.cpp:4519     Value() = Risk() + Reward = 2 * Points
 *   score.cpp:546-597   Presentation() uses PointTotal for score screen
 *   rules.ini [X]       Points= per unit/building section
 *   aftrmath.ini [X]    Aftermath overrides
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { UNIT_STATS, PRODUCTION_ITEMS } from '../engine/types';

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
// Load and merge INI files (aftrmath.ini overrides rules.ini per C++ load order)
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

/** Collect ALL sections that have Points= from both INI files */
function getAllIniPointsSections(): Map<string, number> {
  const result = new Map<string, number>();
  for (const section of Object.keys(rulesINI)) {
    if (rulesINI[section].Points !== undefined) {
      result.set(section, parseInt(rulesINI[section].Points, 10));
    }
  }
  // Aftermath overrides
  for (const section of Object.keys(aftermathINI)) {
    if (aftermathINI[section].Points !== undefined) {
      result.set(section, parseInt(aftermathINI[section].Points, 10));
    }
  }
  return result;
}

const ALL_INI_POINTS = getAllIniPointsSections();

// ---------------------------------------------------------------------------
// TS data helpers
// ---------------------------------------------------------------------------

function getTsUnitStatsPoints(type: string): number | undefined {
  const stats = UNIT_STATS[type];
  if (!stats) return undefined;
  return stats.points;
}

function getTsProdItemPoints(type: string): number | undefined {
  const item = PRODUCTION_ITEMS.find(i => i.type === type);
  if (!item) return undefined;
  return item.points;
}

// ---------------------------------------------------------------------------
// 1. Sanity: INI files parsed successfully
// ---------------------------------------------------------------------------

describe('INI parsing sanity', () => {
  it('rules.ini has >100 sections with Points=', () => {
    let count = 0;
    for (const s of Object.keys(rulesINI)) {
      if (rulesINI[s].Points !== undefined) count++;
    }
    expect(count).toBeGreaterThan(100);
  });

  it('aftrmath.ini has >20 sections with Points=', () => {
    let count = 0;
    for (const s of Object.keys(aftermathINI)) {
      if (aftermathINI[s].Points !== undefined) count++;
    }
    expect(count).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
// 2. UNIT_STATS.points matches rules.ini Points= for all units present in TS
// ---------------------------------------------------------------------------

describe('UNIT_STATS.points matches rules.ini Points= (C++ techno.cpp:6290)', () => {
  // All unit types present in UNIT_STATS that also have Points= in INI
  const unitTypes = Object.keys(UNIT_STATS);

  for (const type of unitTypes) {
    const iniPoints = getIniPoints(type);
    if (iniPoints === undefined) continue; // ants etc. defined per-scenario, skip

    it(`${type}: UNIT_STATS.points=${UNIT_STATS[type].points} matches INI Points=${iniPoints}`, () => {
      const tsPoints = getTsUnitStatsPoints(type);
      expect(tsPoints, `${type} UNIT_STATS should have points field`).toBeDefined();
      expect(tsPoints).toBe(iniPoints);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. PRODUCTION_ITEMS[].points matches rules.ini Points= for all prod items
// ---------------------------------------------------------------------------

describe('PRODUCTION_ITEMS[].points matches rules.ini Points= (C++ techno.cpp:6290)', () => {
  for (const item of PRODUCTION_ITEMS) {
    const iniPoints = getIniPoints(item.type);
    if (iniPoints === undefined) continue;

    it(`${item.type}: PRODUCTION_ITEMS.points=${item.points} matches INI Points=${iniPoints}`, () => {
      expect(item.points, `${item.type} PRODUCTION_ITEMS should have points field`).toBeDefined();
      expect(item.points).toBe(iniPoints);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Infantry Points= (all infantry sections from INI)
//    C++ idata.cpp: Points= is loaded per-infantry from rules.ini
// ---------------------------------------------------------------------------

describe('Infantry Points= from INI (C++ idata.cpp + rules.ini)', () => {
  const INFANTRY_POINTS: [string, number][] = [
    // [type, INI Points=]
    ['E1',       5],
    ['E2',      10],
    ['E3',      10],
    ['E4',      15],
    ['E6',      20],
    ['E7',      25],
    ['DOG',      5],
    ['SPY',     15],
    ['THF',     10],
    ['MEDI',    15],
    ['GNRL',    15],
    ['CHAN',      1],
    ['DELPHI',   1],  // not in TS UNIT_STATS
    ['SHOK',    15],  // aftrmath.ini
    ['MECH',    15],  // aftrmath.ini
  ];

  for (const [type, expectedPoints] of INFANTRY_POINTS) {
    it(`${type}: INI Points=${expectedPoints}`, () => {
      expect(getIniPoints(type)).toBe(expectedPoints);
    });

    it(`${type}: TS UNIT_STATS.points matches INI`, () => {
      const tsPoints = getTsUnitStatsPoints(type);
      if (tsPoints === undefined) {
        // Document missing entry rather than silently skip
        expect(tsPoints, `${type} missing from UNIT_STATS (INI Points=${expectedPoints})`).toBeDefined();
      } else {
        expect(tsPoints).toBe(expectedPoints);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 5. Vehicle Points= (all vehicle sections from INI)
//    C++ udata.cpp: Points= is loaded per-vehicle from rules.ini
// ---------------------------------------------------------------------------

describe('Vehicle Points= from INI (C++ udata.cpp + rules.ini)', () => {
  const VEHICLE_POINTS: [string, number][] = [
    ['1TNK',  30],
    ['2TNK',  40],
    ['3TNK',  50],
    ['4TNK',  60],
    ['V2RL',  40],
    ['JEEP',  20],
    ['APC',   25],
    ['ARTY',  35],
    ['HARV',  55],
    ['MCV',   60],
    ['MNLY',  50],
    ['MRJ',   30],
    ['MGG',   40],
    ['TRUK',   5],
    // Aftermath vehicles
    ['STNK',  25],
    ['CTNK',  25],
    ['TTNK',  30],
    ['QTNK',  60],
    ['DTRK',   5],
  ];

  for (const [type, expectedPoints] of VEHICLE_POINTS) {
    it(`${type}: INI Points=${expectedPoints}`, () => {
      expect(getIniPoints(type)).toBe(expectedPoints);
    });

    it(`${type}: TS UNIT_STATS.points matches INI`, () => {
      const tsPoints = getTsUnitStatsPoints(type);
      expect(tsPoints, `${type} UNIT_STATS should have points=${expectedPoints}`).toBeDefined();
      expect(tsPoints).toBe(expectedPoints);
    });
  }
});

// ---------------------------------------------------------------------------
// 6. Naval Points= (C++ vdata.cpp + rules.ini)
// ---------------------------------------------------------------------------

describe('Naval Points= from INI (C++ vdata.cpp + rules.ini)', () => {
  const NAVAL_POINTS: [string, number][] = [
    ['SS',    45],
    ['DD',    50],
    ['CA',    60],
    ['LST',   25],
    ['PT',    30],
    ['MSUB',  45],  // aftrmath.ini
    ['CARR',  25],  // aftrmath.ini — Helicarrier (not in TS)
  ];

  for (const [type, expectedPoints] of NAVAL_POINTS) {
    it(`${type}: INI Points=${expectedPoints}`, () => {
      expect(getIniPoints(type)).toBe(expectedPoints);
    });

    it(`${type}: TS UNIT_STATS.points matches INI`, () => {
      const tsPoints = getTsUnitStatsPoints(type);
      if (tsPoints === undefined) {
        expect(tsPoints, `${type} missing from UNIT_STATS (INI Points=${expectedPoints})`).toBeDefined();
      } else {
        expect(tsPoints).toBe(expectedPoints);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 7. Aircraft Points= (C++ aadata.cpp + rules.ini)
// ---------------------------------------------------------------------------

describe('Aircraft Points= from INI (C++ aadata.cpp + rules.ini)', () => {
  const AIRCRAFT_POINTS: [string, number][] = [
    ['MIG',   50],
    ['YAK',   25],
    ['TRAN',  35],
    ['HELI',  50],
    ['HIND',  40],
    ['BADR',  20],
    ['U2',     5],
  ];

  for (const [type, expectedPoints] of AIRCRAFT_POINTS) {
    it(`${type}: INI Points=${expectedPoints}`, () => {
      expect(getIniPoints(type)).toBe(expectedPoints);
    });

    it(`${type}: TS UNIT_STATS.points matches INI`, () => {
      const tsPoints = getTsUnitStatsPoints(type);
      expect(tsPoints, `${type} UNIT_STATS should have points=${expectedPoints}`).toBeDefined();
      expect(tsPoints).toBe(expectedPoints);
    });
  }
});

// ---------------------------------------------------------------------------
// 8. Building Points= (C++ bdata.cpp + rules.ini)
// ---------------------------------------------------------------------------

describe('Building Points= from INI (C++ bdata.cpp + rules.ini)', () => {
  const BUILDING_POINTS: [string, number][] = [
    // Production structures
    ['FACT',  80],
    ['POWR',  40],
    ['APWR',  50],
    ['PROC',  80],
    ['WEAP',  80],
    ['BARR',  30],
    ['TENT',  30],
    ['DOME',  60],
    ['SILO',  25],
    ['FIX',   80],
    ['HPAD',  70],
    ['AFLD',  70],
    ['SYRD',  80],
    ['SPEN',  80],
    ['KENN',  25],
    // Tech / Superweapons
    ['ATEK',  85],
    ['STEK',  85],
    ['PDOX', 100],
    ['IRON', 100],
    ['MSLO',  90],
    // Defenses
    ['PBOX',  50],
    ['HBOX',  60],
    ['GUN',   50],
    ['AGUN',  50],
    ['TSLA',  80],
    ['FTUR',  65],
    ['SAM',   50],
    ['GAP',   35],
    // Non-buildable buildings
    ['BIO',   30],   // Biological Lab
    ['HOSP',  20],   // Hospital
    ['FCOM',  40],   // Forward Command
    ['MISS',   5],   // Tech Center (civilian)
  ];

  for (const [type, expectedPoints] of BUILDING_POINTS) {
    it(`${type}: INI Points=${expectedPoints}`, () => {
      expect(getIniPoints(type)).toBe(expectedPoints);
    });

    it(`${type}: TS PRODUCTION_ITEMS.points matches INI`, () => {
      const tsPoints = getTsProdItemPoints(type);
      if (tsPoints === undefined) {
        // Document: building exists in INI but not in PRODUCTION_ITEMS
        expect(tsPoints, `${type} missing from PRODUCTION_ITEMS (INI Points=${expectedPoints})`).toBeDefined();
      } else {
        expect(tsPoints).toBe(expectedPoints);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 9. Wall/Fence Points= (rules.ini)
// ---------------------------------------------------------------------------

describe('Wall/Fence Points= from INI (rules.ini)', () => {
  const WALL_POINTS: [string, number][] = [
    ['SBAG',  1],   // Sandbag
    ['BRIK',  5],   // Concrete Wall
    ['FENC',  1],   // Wire Fence
    ['CYCL',  1],   // Cyclone Fence (not in TS PRODUCTION_ITEMS)
    ['BARB',  1],   // Barbed Wire (not in TS PRODUCTION_ITEMS)
    ['WOOD',  1],   // Wooden Fence (not in TS PRODUCTION_ITEMS)
  ];

  for (const [type, expectedPoints] of WALL_POINTS) {
    it(`${type}: INI Points=${expectedPoints}`, () => {
      expect(getIniPoints(type)).toBe(expectedPoints);
    });

    it(`${type}: TS PRODUCTION_ITEMS.points matches INI`, () => {
      const tsPoints = getTsProdItemPoints(type);
      if (tsPoints === undefined) {
        expect(tsPoints, `${type} missing from PRODUCTION_ITEMS (INI Points=${expectedPoints})`).toBeDefined();
      } else {
        expect(tsPoints).toBe(expectedPoints);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 10. Fake building Points= (rules.ini — all 15)
// ---------------------------------------------------------------------------

describe('Fake building Points= from INI (rules.ini)', () => {
  const FAKE_POINTS: [string, number][] = [
    ['FACF',  15],
    ['WEAF',  15],
    ['SYRF',  15],
    ['SPEF',  15],
    ['DOMF',  15],
  ];

  for (const [type, expectedPoints] of FAKE_POINTS) {
    it(`${type}: INI Points=${expectedPoints}`, () => {
      expect(getIniPoints(type)).toBe(expectedPoints);
    });

    it(`${type}: TS PRODUCTION_ITEMS.points matches INI`, () => {
      const tsPoints = getTsProdItemPoints(type);
      if (tsPoints === undefined) {
        expect(tsPoints, `${type} missing from PRODUCTION_ITEMS (INI Points=${expectedPoints})`).toBeDefined();
      } else {
        expect(tsPoints).toBe(expectedPoints);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 11. Civilian Points= (all 1 in rules.ini)
// ---------------------------------------------------------------------------

describe('Civilian Points= from INI (all should be 1)', () => {
  const CIVILIAN_TYPES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'EINSTEIN', 'DELPHI', 'CHAN'];

  for (const type of CIVILIAN_TYPES) {
    it(`${type}: INI Points=1`, () => {
      expect(getIniPoints(type)).toBe(1);
    });
  }
});

// ---------------------------------------------------------------------------
// 12. Terrain/Civilian vehicles (V01-V37) Points= (all 5 in rules.ini)
//     These are map decorations (trees, barrels, etc.) — not combat units.
// ---------------------------------------------------------------------------

describe('Terrain object Points= from INI (V01-V37, all should be 5)', () => {
  for (let i = 1; i <= 37; i++) {
    const type = `V${i.toString().padStart(2, '0')}`;
    it(`${type}: INI Points=5`, () => {
      expect(getIniPoints(type)).toBe(5);
    });
  }
});

// ---------------------------------------------------------------------------
// 13. Comprehensive coverage: every INI Points= section accounted for
//     This test catches any INI section we might have missed above.
// ---------------------------------------------------------------------------

describe('Comprehensive: every INI Points= section has TS coverage', () => {
  // Sections we know are in TS (UNIT_STATS or PRODUCTION_ITEMS)
  const TS_COVERED = new Set([
    // UNIT_STATS
    ...Object.keys(UNIT_STATS),
    // PRODUCTION_ITEMS
    ...PRODUCTION_ITEMS.map(i => i.type),
  ]);

  // Sections that are legitimately not in TS (terrain, non-combatant buildings, etc.)
  const EXPECTED_MISSING = new Set([
    // Terrain objects V01-V37 (map decorations)
    ...Array.from({ length: 37 }, (_, i) => `V${(i + 1).toString().padStart(2, '0')}`),
  ]);

  for (const [section, iniPoints] of ALL_INI_POINTS) {
    if (EXPECTED_MISSING.has(section)) continue;

    it(`${section} (INI Points=${iniPoints}) exists in TS UNIT_STATS or PRODUCTION_ITEMS`, () => {
      const inUnitStats = section in UNIT_STATS;
      const inProdItems = PRODUCTION_ITEMS.some(i => i.type === section);
      expect(
        inUnitStats || inProdItems,
        `${section} has Points=${iniPoints} in INI but is missing from TS`
      ).toBe(true);
    });

    it(`${section} (INI Points=${iniPoints}) TS value matches`, () => {
      const tsUnitPoints = getTsUnitStatsPoints(section);
      const tsProdPoints = getTsProdItemPoints(section);
      const tsPoints = tsUnitPoints ?? tsProdPoints;
      if (tsPoints !== undefined) {
        expect(tsPoints).toBe(iniPoints);
      }
    });
  }

  it('documents all INI sections missing from TS', () => {
    const missing: string[] = [];
    for (const [section, pts] of ALL_INI_POINTS) {
      if (!TS_COVERED.has(section)) {
        missing.push(`${section}(${pts})`);
      }
    }
    // This documents the gap; the count should match what we expect
    // 37 sections: V01-V37 terrain objects (map decorations, not combat units)
    expect(missing.length).toBe(37);
  });
});

// ---------------------------------------------------------------------------
// 14. Value mismatches: INI vs TS (should be zero)
//     This is the core parity assertion. Any mismatch here means TS has a
//     wrong Points= value that will affect scoring and threat assessment.
// ---------------------------------------------------------------------------

describe('Zero value mismatches between INI and TS', () => {
  it('all UNIT_STATS.points values match their INI Points= values', () => {
    const mismatches: string[] = [];
    for (const type of Object.keys(UNIT_STATS)) {
      const iniPoints = getIniPoints(type);
      if (iniPoints === undefined) continue;
      const tsPoints = UNIT_STATS[type].points;
      if (tsPoints !== undefined && tsPoints !== iniPoints) {
        mismatches.push(`${type}: INI=${iniPoints} TS=${tsPoints}`);
      }
    }
    expect(mismatches, `UNIT_STATS point mismatches: ${mismatches.join(', ')}`).toEqual([]);
  });

  it('all PRODUCTION_ITEMS.points values match their INI Points= values', () => {
    const mismatches: string[] = [];
    for (const item of PRODUCTION_ITEMS) {
      const iniPoints = getIniPoints(item.type);
      if (iniPoints === undefined) continue;
      if (item.points !== undefined && item.points !== iniPoints) {
        mismatches.push(`${item.type}: INI=${iniPoints} TS=${item.points}`);
      }
    }
    expect(mismatches, `PRODUCTION_ITEMS point mismatches: ${mismatches.join(', ')}`).toEqual([]);
  });
});
