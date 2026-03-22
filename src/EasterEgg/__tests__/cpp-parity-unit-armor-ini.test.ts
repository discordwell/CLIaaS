/**
 * C++ Behavioral Parity: Unit Armor Types vs rules.ini
 *
 * rules.ini (and aftrmath.ini for Aftermath units, SCA01EA.ini for ants)
 * is the authoritative source for all unit Armor= values.
 *
 * This test parses the INI files directly and compares every unit's
 * armor field in UNIT_STATS against the INI-defined value.
 *
 * Source refs:
 *   rules.ini  — [UNIT] sections, Armor= key
 *   aftrmath.ini — Aftermath expansion units (STNK, CTNK, TTNK, DTRK, QTNK, MSUB, SHOK, MECH)
 *   SCA01EA.ini  — Ant mission units (ANT1, ANT2, ANT3)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { UNIT_STATS, type ArmorType } from '../engine/types';

// ---------------------------------------------------------------------------
// INI parser — extracts [Section] + Armor= from INI files
// ---------------------------------------------------------------------------

function parseArmorFromIni(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const result: Record<string, string> = {};
  let currentSection = '';

  for (const raw of lines) {
    const line = raw.split(';')[0].trim(); // strip comments
    if (!line) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }

    const kvMatch = line.match(/^Armor\s*=\s*(.+)$/i);
    if (kvMatch && currentSection) {
      result[currentSection] = kvMatch[1].trim().toLowerCase();
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Load INI armor data
// ---------------------------------------------------------------------------

const assetsDir = resolve(__dirname, '../../..', 'public/ra/assets');

const rulesArmor = parseArmorFromIni(resolve(assetsDir, 'rules.ini'));
const aftermathArmor = parseArmorFromIni(resolve(assetsDir, 'aftrmath.ini'));
const antArmor = parseArmorFromIni(resolve(assetsDir, 'SCA01EA.ini'));

// Merge: aftermath overrides rules, ant missions provide ant definitions
// (aftrmath.ini units like STNK, CTNK etc. are not in rules.ini for vehicles,
//  and ant units are only in SCA01EA.ini)
const iniArmor: Record<string, string> = {
  ...rulesArmor,
  ...aftermathArmor,
  ...antArmor,
};

// ---------------------------------------------------------------------------
// Expected mappings derived from INI (authoritative source)
// ---------------------------------------------------------------------------

// Vehicles from rules.ini
const VEHICLES_RULES: [string, ArmorType][] = [
  ['V2RL', 'light'],     // rules.ini line 485: Armor=light
  ['1TNK', 'heavy'],     // rules.ini line 503: Armor=heavy
  ['2TNK', 'heavy'],     // rules.ini line 536: Armor=heavy
  ['3TNK', 'heavy'],     // rules.ini line 520: Armor=heavy
  ['4TNK', 'heavy'],     // rules.ini line 553: Armor=heavy
  ['MRJ',  'light'],     // rules.ini line 569: Armor=light
  ['MGG',  'light'],     // rules.ini line 584: Armor=light
  ['ARTY', 'light'],     // rules.ini line 599: Armor=light
  ['HARV', 'heavy'],     // rules.ini line 615: Armor=heavy
  ['MCV',  'light'],     // rules.ini line 631: Armor=light
  ['JEEP', 'light'],     // rules.ini line 646: Armor=light
  ['APC',  'heavy'],     // rules.ini line 661: Armor=heavy
  ['MNLY', 'heavy'],     // rules.ini line 676: Armor=heavy
  ['TRUK', 'light'],     // rules.ini line 691: Armor=light
];

// Vessels from rules.ini
const VESSELS_RULES: [string, ArmorType][] = [
  ['SS',  'light'],      // rules.ini line 707: Armor=light
  ['DD',  'heavy'],      // rules.ini line 723: Armor=heavy
  ['CA',  'heavy'],      // rules.ini line 739: Armor=heavy
  ['LST', 'heavy'],      // rules.ini line 752: Armor=heavy
  ['PT',  'heavy'],      // rules.ini line 768: Armor=heavy
];

// Infantry from rules.ini
const INFANTRY_RULES: [string, ArmorType][] = [
  ['DOG',      'none'],  // rules.ini line 785: Armor=none
  ['E1',       'none'],  // rules.ini line 799: Armor=none
  ['E2',       'none'],  // rules.ini line 811: Armor=none
  ['E3',       'none'],  // rules.ini line 825: Armor=none
  ['E4',       'none'],  // rules.ini line 839: Armor=none
  ['E6',       'none'],  // rules.ini line 851: Armor=none
  ['SPY',      'none'],  // rules.ini line 864: Armor=none
  ['THF',      'none'],  // rules.ini line 877: Armor=none
  ['E7',       'none'],  // rules.ini line 892: Armor=none (Tanya)
  ['MEDI',     'none'],  // rules.ini line 907: Armor=none
  ['GNRL',     'none'],  // rules.ini line 919: Armor=none
  ['C1',       'none'],  // rules.ini line 933: Armor=none
  ['C2',       'none'],  // rules.ini line 946: Armor=none
  ['C3',       'none'],  // rules.ini line 958: Armor=none
  ['C4',       'none'],  // rules.ini line 970: Armor=none
  ['C5',       'none'],  // rules.ini line 982: Armor=none
  ['C6',       'none'],  // rules.ini line 994: Armor=none
  ['C7',       'none'],  // rules.ini line 1007: Armor=none
  ['C8',       'none'],  // rules.ini line 1020: Armor=none
  ['C9',       'none'],  // rules.ini line 1032: Armor=none
  ['C10',      'none'],  // rules.ini line 1044: Armor=none
  ['EINSTEIN', 'none'],  // rules.ini line 1056: Armor=none
  ['CHAN',      'none'],  // rules.ini line 1081: Armor=none
];

// Aircraft from rules.ini
const AIRCRAFT_RULES: [string, ArmorType][] = [
  ['BADR', 'light'],     // rules.ini line 1095: Armor=light
  ['U2',   'heavy'],     // rules.ini line 1111: Armor=heavy
  ['MIG',  'light'],     // rules.ini line 1127: Armor=light
  ['YAK',  'light'],     // rules.ini line 1144: Armor=light
  ['TRAN', 'light'],     // rules.ini line 1160: Armor=light
  ['HELI', 'heavy'],     // rules.ini line 1176: Armor=heavy
  ['HIND', 'heavy'],     // rules.ini line 1193: Armor=heavy
];

// Aftermath units from aftrmath.ini
const AFTERMATH_UNITS: [string, ArmorType][] = [
  ['STNK', 'heavy'],     // aftrmath.ini line 17: Armor=heavy
  ['CTNK', 'light'],     // aftrmath.ini line 50: Armor=light
  ['TTNK', 'light'],     // aftrmath.ini line 66: Armor=light
  ['DTRK', 'light'],     // aftrmath.ini line 82: Armor=light
  ['QTNK', 'heavy'],     // aftrmath.ini line 97: Armor=heavy
  ['MSUB', 'light'],     // aftrmath.ini line 113: Armor=light
  ['SHOK', 'none'],      // aftrmath.ini line 129: Armor=none
  ['MECH', 'none'],      // aftrmath.ini line 145: Armor=none
];

// Ant units from SCA01EA.ini
const ANT_UNITS: [string, ArmorType][] = [
  ['ANT1', 'heavy'],     // SCA01EA.ini line 6: Armor=heavy
  ['ANT2', 'heavy'],     // SCA01EA.ini line 23: Armor=heavy
  ['ANT3', 'light'],     // SCA01EA.ini line 39: Armor=light
];

const ALL_UNITS: [string, ArmorType][] = [
  ...VEHICLES_RULES,
  ...VESSELS_RULES,
  ...INFANTRY_RULES,
  ...AIRCRAFT_RULES,
  ...AFTERMATH_UNITS,
  ...ANT_UNITS,
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Unit armor types: UNIT_STATS vs rules.ini / aftrmath.ini / SCA01EA.ini', () => {

  it('INI parser reads Armor= from rules.ini for known vehicles', () => {
    // Sanity-check that the parser actually finds entries
    expect(rulesArmor['1TNK']).toBe('heavy');
    expect(rulesArmor['JEEP']).toBe('light');
    expect(rulesArmor['E1']).toBe('none');
    expect(rulesArmor['HELI']).toBe('heavy');
  });

  it('INI parser reads Armor= from aftrmath.ini for Aftermath units', () => {
    expect(aftermathArmor['STNK']).toBe('heavy');
    expect(aftermathArmor['CTNK']).toBe('light');
    expect(aftermathArmor['SHOK']).toBe('none');
  });

  it('INI parser reads Armor= from SCA01EA.ini for ant units', () => {
    expect(antArmor['ANT1']).toBe('heavy');
    expect(antArmor['ANT2']).toBe('heavy');
    expect(antArmor['ANT3']).toBe('light');
  });

  describe('Vehicles (rules.ini)', () => {
    for (const [id, expectedArmor] of VEHICLES_RULES) {
      it(`${id} armor should be '${expectedArmor}'`, () => {
        const stats = UNIT_STATS[id];
        expect(stats, `UNIT_STATS['${id}'] must exist`).toBeDefined();
        expect(stats.armor).toBe(expectedArmor);
        // Cross-check: INI parser agrees with hardcoded expectation
        expect(iniArmor[id]).toBe(expectedArmor);
      });
    }
  });

  describe('Vessels (rules.ini)', () => {
    for (const [id, expectedArmor] of VESSELS_RULES) {
      it(`${id} armor should be '${expectedArmor}'`, () => {
        const stats = UNIT_STATS[id];
        expect(stats, `UNIT_STATS['${id}'] must exist`).toBeDefined();
        expect(stats.armor).toBe(expectedArmor);
        expect(iniArmor[id]).toBe(expectedArmor);
      });
    }
  });

  describe('Infantry (rules.ini)', () => {
    for (const [id, expectedArmor] of INFANTRY_RULES) {
      it(`${id} armor should be '${expectedArmor}'`, () => {
        const stats = UNIT_STATS[id];
        expect(stats, `UNIT_STATS['${id}'] must exist`).toBeDefined();
        expect(stats.armor).toBe(expectedArmor);
        expect(iniArmor[id]).toBe(expectedArmor);
      });
    }
  });

  describe('Aircraft (rules.ini)', () => {
    for (const [id, expectedArmor] of AIRCRAFT_RULES) {
      it(`${id} armor should be '${expectedArmor}'`, () => {
        const stats = UNIT_STATS[id];
        expect(stats, `UNIT_STATS['${id}'] must exist`).toBeDefined();
        expect(stats.armor).toBe(expectedArmor);
        expect(iniArmor[id]).toBe(expectedArmor);
      });
    }
  });

  describe('Aftermath units (aftrmath.ini)', () => {
    for (const [id, expectedArmor] of AFTERMATH_UNITS) {
      it(`${id} armor should be '${expectedArmor}'`, () => {
        const stats = UNIT_STATS[id];
        expect(stats, `UNIT_STATS['${id}'] must exist`).toBeDefined();
        expect(stats.armor).toBe(expectedArmor);
        expect(aftermathArmor[id]).toBe(expectedArmor);
      });
    }
  });

  describe('Ant units (SCA01EA.ini)', () => {
    for (const [id, expectedArmor] of ANT_UNITS) {
      it(`${id} armor should be '${expectedArmor}'`, () => {
        const stats = UNIT_STATS[id];
        expect(stats, `UNIT_STATS['${id}'] must exist`).toBeDefined();
        expect(stats.armor).toBe(expectedArmor);
        expect(antArmor[id]).toBe(expectedArmor);
      });
    }
  });

  describe('Completeness: every UNIT_STATS entry has INI-verified armor', () => {
    const testedIds = new Set(ALL_UNITS.map(([id]) => id));

    it('all UNIT_STATS keys are covered by this test', () => {
      const untested: string[] = [];
      for (const id of Object.keys(UNIT_STATS)) {
        if (!testedIds.has(id)) {
          untested.push(id);
        }
      }
      expect(untested, `Untested units in UNIT_STATS: ${untested.join(', ')}`).toEqual([]);
    });
  });

  describe('Cross-validation: parsed INI armor matches hardcoded expectations', () => {
    for (const [id, expectedArmor] of ALL_UNITS) {
      it(`INI-parsed armor for ${id} matches expected '${expectedArmor}'`, () => {
        expect(iniArmor[id], `INI has no Armor= for [${id}]`).toBeDefined();
        expect(iniArmor[id]).toBe(expectedArmor);
      });
    }
  });
});
