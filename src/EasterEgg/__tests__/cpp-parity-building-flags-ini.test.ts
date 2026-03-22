/**
 * C++ Behavioral Parity Tests — Building Boolean Flags & Special Fields (INI-Derived)
 *
 * Parses rules.ini and aftrmath.ini directly, then compares per-building flags
 * against the TS runtime tables. rules.ini is the authoritative source for all
 * game constants (per CLAUDE.md).
 *
 * === Audited fields ===
 *
 *   Powered=       — STRUCTURE_POWERED set in scenario.ts
 *   Capturable=    — currently not tracked in TS (audit only)
 *   Storage=       — silo capacity in repairSell.ts calculateSiloCapacity()
 *   Adjacent=      — building placement adjacency (placement.ts)
 *   WaterBound=    — naval structures (SYRD, SPEN)
 *   Unsellable=    — if applicable
 *
 * === C++ Source References ===
 *
 * Powered flag (rules.ini per-building Powered= key):
 *   Default is false (bdata.cpp:2836 — IsPowered defaults to false)
 *   Only buildings with explicit Powered=true in rules.ini are affected.
 *   rules.ini: IRON, PDOX, TSLA, DOME, GAP have Powered=true
 *   GUN, AGUN, SAM, MSLO etc. do NOT have Powered=true
 *
 * Capturable flag (rules.ini per-building Capturable= key):
 *   Default is false (bdata.cpp). Engineers capture buildings with this flag.
 *   rules.ini: IRON, FCOM, ATEK, PDOX, WEAP, SYRD, SPEN, FACT, PROC, SILO,
 *     HPAD, DOME, GAP, AFLD, POWR, APWR, STEK, HOSP, BARR, TENT, FIX, MISS, V01
 *   aftrmath.ini overrides: FACF, DOMF, WEAF (Capturable=true), BIO (Capturable=false)
 *
 * Storage (rules.ini per-building Storage= key):
 *   [PROC] Storage=2000 — refinery stores 2000 credits
 *   [SILO] Storage=1500 — silo stores 1500 credits
 *
 * Adjacent (rules.ini per-building Adjacent= key):
 *   SYRD=8, SPEN=8 — naval yards can be placed far from base
 *   SBAG=1, BRIK=1, FENC=1, CYCL=1, BARB=1, WOOD=1 — wall adjacency
 *   BARL=0 — barrels have 0 adjacency
 *
 * WaterBound (rules.ini per-building WaterBound= key):
 *   SYRD, SPEN — must be placed on water
 *
 * aftrmath.ini overrides:
 *   [BIO] Capturable=false (overrides rules.ini which has no Capturable line)
 *   [MISS] adds Owner=allies,soviet
 *   [FACF], [DOMF], [WEAF] — fake structures with Capturable=true
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseIniSections, type IniSections } from '../engine/parseIni';
import { STRUCTURE_POWERED } from '../engine/scenario';
import { POWER_DRAIN } from '../engine/types';
import { calculateSiloCapacity } from '../engine/repairSell';
import type { MapStructure } from '../engine/entity';
import { House } from '../engine/types';

// ============================================================
// Load & Parse INI files (authoritative source)
// ============================================================
const RULES_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/rules.ini');
const AFTRMATH_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/aftrmath.ini');

const rulesText = fs.readFileSync(RULES_INI_PATH, 'utf-8');
const aftrmathText = fs.readFileSync(AFTRMATH_INI_PATH, 'utf-8');

const rulesSections = parseIniSections(rulesText);
const aftrmathSections = parseIniSections(aftrmathText);

/** Get a merged INI section: aftrmath.ini overrides rules.ini on a per-key basis. */
function getMergedSection(name: string): Map<string, string> | undefined {
  const base = rulesSections.get(name);
  const override = aftrmathSections.get(name);
  if (!base && !override) return undefined;
  const merged = new Map<string, string>();
  if (base) for (const [k, v] of base) merged.set(k, v);
  if (override) for (const [k, v] of override) merged.set(k, v);
  return merged;
}

/** Parse a boolean flag from INI (yes/true → true, no/false/absent → false) */
function iniBool(section: Map<string, string>, key: string): boolean {
  const val = section.get(key)?.toLowerCase();
  return val === 'yes' || val === 'true';
}

// ============================================================
// Known building type IDs from rules.ini (main buildings only)
// ============================================================
const MAIN_BUILDINGS = [
  'IRON', 'FCOM', 'ATEK', 'PDOX', 'WEAP', 'SYRD', 'SPEN',
  'PBOX', 'HBOX', 'TSLA', 'GUN', 'AGUN', 'FTUR',
  'FACT', 'PROC', 'SILO', 'HPAD', 'DOME', 'GAP', 'SAM',
  'MSLO', 'AFLD', 'POWR', 'APWR', 'STEK', 'HOSP', 'BIO',
  'BARR', 'TENT', 'KENN', 'FIX',
];

const WALLS = ['SBAG', 'BRIK', 'FENC', 'CYCL', 'BARB', 'WOOD'];

const ALL_BUILDING_TYPES = [...MAIN_BUILDINGS, ...WALLS];

// ============================================================
// Section 1: Powered= flag parity
//
// rules.ini Powered=true appears on: IRON, PDOX, TSLA, DOME, GAP
// Default is false (C++ bdata.cpp:2836)
// ============================================================
describe('Powered= flag (rules.ini vs STRUCTURE_POWERED)', () => {
  // Collect all building types that have Powered=true in rules.ini
  const iniPowered = new Set<string>();
  for (const type of ALL_BUILDING_TYPES) {
    const section = getMergedSection(type);
    if (section && iniBool(section, 'Powered')) {
      iniPowered.add(type);
    }
  }

  it('rules.ini has exactly 5 buildings with Powered=true: IRON, PDOX, TSLA, DOME, GAP', () => {
    expect([...iniPowered].sort()).toEqual(['DOME', 'GAP', 'IRON', 'PDOX', 'TSLA']);
  });

  it('STRUCTURE_POWERED matches rules.ini Powered=true set exactly', () => {
    const tsPowered = [...STRUCTURE_POWERED].sort();
    const iniPoweredSorted = [...iniPowered].sort();
    expect(tsPowered).toEqual(iniPoweredSorted);
  });

  it('buildings WITHOUT Powered=true in rules.ini are NOT in STRUCTURE_POWERED', () => {
    // Specifically test the tricky ones — defense structures that consume power
    // but are NOT IsPowered (they fire even during blackouts)
    const notPowered = ['GUN', 'AGUN', 'SAM', 'MSLO', 'PBOX', 'HBOX', 'FTUR'];
    for (const type of notPowered) {
      const section = getMergedSection(type);
      expect(section, `${type} should exist in rules.ini`).toBeDefined();
      expect(iniBool(section!, 'Powered'), `${type} should NOT have Powered=true in rules.ini`).toBe(false);
      expect(STRUCTURE_POWERED.has(type), `${type} should NOT be in STRUCTURE_POWERED`).toBe(false);
    }
  });
});

// ============================================================
// Section 2: Capturable= flag parity
//
// rules.ini Capturable=true on many production/tech buildings
// aftrmath.ini overrides: BIO Capturable=false
// ============================================================
describe('Capturable= flag (rules.ini audit)', () => {
  const iniCapturable = new Set<string>();
  const iniNotCapturable = new Set<string>();

  for (const type of [...ALL_BUILDING_TYPES, 'MISS', 'V01']) {
    const section = getMergedSection(type);
    if (!section) continue;
    if (iniBool(section, 'Capturable')) {
      iniCapturable.add(type);
    } else if (section.get('Capturable')?.toLowerCase() === 'false') {
      iniNotCapturable.add(type);
    }
  }

  it('rules.ini capturable buildings include all production/tech structures', () => {
    const expectedCapturable = [
      'IRON', 'FCOM', 'ATEK', 'PDOX', 'WEAP', 'SYRD', 'SPEN',
      'FACT', 'PROC', 'SILO', 'HPAD', 'DOME', 'GAP', 'AFLD',
      'POWR', 'APWR', 'STEK', 'HOSP', 'BARR', 'TENT', 'FIX',
      'MISS', 'V01',
    ];
    for (const type of expectedCapturable) {
      expect(iniCapturable.has(type), `${type} should be Capturable=true in INI`).toBe(true);
    }
  });

  it('defense structures are NOT capturable in rules.ini', () => {
    const notCapturable = ['PBOX', 'HBOX', 'TSLA', 'GUN', 'AGUN', 'FTUR', 'SAM', 'MSLO', 'KENN'];
    for (const type of notCapturable) {
      expect(iniCapturable.has(type), `${type} should NOT be Capturable in INI`).toBe(false);
    }
  });

  it('aftrmath.ini sets BIO Capturable=false (overrides rules.ini)', () => {
    const bioSection = getMergedSection('BIO');
    expect(bioSection).toBeDefined();
    // aftrmath.ini explicitly sets Capturable=false
    expect(bioSection!.get('Capturable')?.toLowerCase()).toBe('false');
    expect(iniCapturable.has('BIO')).toBe(false);
  });

  it('walls are not capturable', () => {
    for (const wall of WALLS) {
      expect(iniCapturable.has(wall), `${wall} should not be capturable`).toBe(false);
    }
  });
});

// ============================================================
// Section 3: Storage= values
//
// rules.ini:
//   [PROC] Storage=2000
//   [SILO] Storage=1500
// ============================================================
describe('Storage= values (rules.ini vs calculateSiloCapacity)', () => {
  it('rules.ini PROC Storage=2000', () => {
    const procSection = rulesSections.get('PROC');
    expect(procSection).toBeDefined();
    expect(parseInt(procSection!.get('Storage')!, 10)).toBe(2000);
  });

  it('rules.ini SILO Storage=1500', () => {
    const siloSection = rulesSections.get('SILO');
    expect(siloSection).toBeDefined();
    expect(parseInt(siloSection!.get('Storage')!, 10)).toBe(1500);
  });

  it('no other buildings have Storage= in rules.ini', () => {
    const withStorage: string[] = [];
    for (const type of ALL_BUILDING_TYPES) {
      const section = getMergedSection(type);
      if (section && section.has('Storage') && type !== 'PROC' && type !== 'SILO') {
        withStorage.push(type);
      }
    }
    expect(withStorage).toEqual([]);
  });

  it('calculateSiloCapacity gives 2000 for one PROC', () => {
    const structures = [
      { type: 'PROC', alive: true, house: House.Spain, buildProgress: undefined } as unknown as MapStructure,
    ];
    const cap = calculateSiloCapacity(structures, House.Spain, (a, b) => a === b);
    expect(cap).toBe(2000);
  });

  it('calculateSiloCapacity gives 1500 for one SILO', () => {
    const structures = [
      { type: 'SILO', alive: true, house: House.Spain, buildProgress: undefined } as unknown as MapStructure,
    ];
    const cap = calculateSiloCapacity(structures, House.Spain, (a, b) => a === b);
    expect(cap).toBe(1500);
  });

  it('calculateSiloCapacity gives 3500 for PROC + SILO', () => {
    const structures = [
      { type: 'PROC', alive: true, house: House.Spain, buildProgress: undefined } as unknown as MapStructure,
      { type: 'SILO', alive: true, house: House.Spain, buildProgress: undefined } as unknown as MapStructure,
    ];
    const cap = calculateSiloCapacity(structures, House.Spain, (a, b) => a === b);
    expect(cap).toBe(3500);
  });

  // Verify SILO Strength in rules.ini matches SILO task description (Storage=300 would be Strength)
  it('SILO Strength=300 (not Storage=300)', () => {
    const siloSection = rulesSections.get('SILO');
    expect(siloSection).toBeDefined();
    // Strength and Storage are different fields
    expect(parseInt(siloSection!.get('Strength')!, 10)).toBe(300);
    expect(parseInt(siloSection!.get('Storage')!, 10)).toBe(1500);
  });
});

// ============================================================
// Section 4: Adjacent= values
//
// rules.ini:
//   SYRD Adjacent=8, SPEN Adjacent=8
//   SBAG Adjacent=1, BRIK Adjacent=1, FENC Adjacent=1
//   CYCL Adjacent=1, BARB Adjacent=1, WOOD Adjacent=1
//   BARL Adjacent=0
//   Default is 1 in C++ (building.cpp)
// ============================================================
describe('Adjacent= values (rules.ini)', () => {
  it('naval yards have Adjacent=8', () => {
    for (const type of ['SYRD', 'SPEN']) {
      const section = getMergedSection(type);
      expect(section).toBeDefined();
      expect(parseInt(section!.get('Adjacent')!, 10), `${type} Adjacent`).toBe(8);
    }
  });

  it('walls have Adjacent=1', () => {
    for (const wall of WALLS) {
      const section = getMergedSection(wall);
      expect(section, `${wall} should exist in rules.ini`).toBeDefined();
      expect(parseInt(section!.get('Adjacent')!, 10), `${wall} Adjacent`).toBe(1);
    }
  });

  it('BARL (barrels) has Adjacent=0', () => {
    const section = getMergedSection('BARL');
    expect(section).toBeDefined();
    expect(parseInt(section!.get('Adjacent')!, 10)).toBe(0);
  });

  it('main buildings do not specify Adjacent (use C++ default)', () => {
    const buildingsWithAdjacent: string[] = [];
    for (const type of MAIN_BUILDINGS) {
      const section = getMergedSection(type);
      if (section && section.has('Adjacent')) {
        buildingsWithAdjacent.push(type);
      }
    }
    // Only SYRD and SPEN have explicit Adjacent= among main buildings
    expect(buildingsWithAdjacent.sort()).toEqual(['SPEN', 'SYRD']);
  });
});

// ============================================================
// Section 5: WaterBound= flag
//
// rules.ini:
//   [SYRD] WaterBound=yes
//   [SPEN] WaterBound=yes
//   No other buildings have WaterBound
// ============================================================
describe('WaterBound= flag (rules.ini)', () => {
  const iniWaterBound = new Set<string>();
  for (const type of ALL_BUILDING_TYPES) {
    const section = getMergedSection(type);
    if (section && iniBool(section, 'WaterBound')) {
      iniWaterBound.add(type);
    }
  }

  it('exactly SYRD and SPEN have WaterBound=yes', () => {
    expect([...iniWaterBound].sort()).toEqual(['SPEN', 'SYRD']);
  });

  it('no other buildings have WaterBound=yes', () => {
    const others = [...iniWaterBound].filter(t => t !== 'SYRD' && t !== 'SPEN');
    expect(others).toEqual([]);
  });
});

// ============================================================
// Section 6: Power= values parity (rules.ini vs POWER_DRAIN)
//
// rules.ini Power=N where negative means consumption.
// POWER_DRAIN stores the absolute consumption value.
// ============================================================
describe('Power= values (rules.ini vs POWER_DRAIN)', () => {
  // Build a map of expected drain values from rules.ini
  const iniPowerDrain: Record<string, number> = {};
  for (const type of MAIN_BUILDINGS) {
    const section = getMergedSection(type);
    if (!section || !section.has('Power')) continue;
    const power = parseInt(section.get('Power')!, 10);
    if (power < 0) {
      iniPowerDrain[type] = Math.abs(power);
    }
  }

  it('every building with Power<0 in rules.ini is in POWER_DRAIN', () => {
    const missingFromTS: string[] = [];
    for (const [type, drain] of Object.entries(iniPowerDrain)) {
      if (POWER_DRAIN[type] === undefined) {
        missingFromTS.push(type);
      }
    }
    expect(missingFromTS, 'Buildings in rules.ini with power drain missing from POWER_DRAIN').toEqual([]);
  });

  it('POWER_DRAIN values match rules.ini |Power=| for all consuming buildings', () => {
    const mismatches: string[] = [];
    for (const [type, expectedDrain] of Object.entries(iniPowerDrain)) {
      const tsDrain = POWER_DRAIN[type];
      if (tsDrain !== expectedDrain) {
        mismatches.push(`${type}: rules.ini=${expectedDrain}, TS=${tsDrain}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('specific high-drain buildings match exactly', () => {
    expect(iniPowerDrain['TSLA']).toBe(150);
    expect(POWER_DRAIN['TSLA']).toBe(150);
    expect(iniPowerDrain['IRON']).toBe(200);
    expect(POWER_DRAIN['IRON']).toBe(200);
    expect(iniPowerDrain['PDOX']).toBe(200);
    expect(POWER_DRAIN['PDOX']).toBe(200);
    expect(iniPowerDrain['ATEK']).toBe(200);
    expect(POWER_DRAIN['ATEK']).toBe(200);
    expect(iniPowerDrain['STEK']).toBe(100);
    expect(POWER_DRAIN['STEK']).toBe(100);
    expect(iniPowerDrain['MSLO']).toBe(100);
    expect(POWER_DRAIN['MSLO']).toBe(100);
  });

  it('power producers (POWR, APWR) have positive Power= and are NOT in POWER_DRAIN', () => {
    for (const type of ['POWR', 'APWR']) {
      const section = getMergedSection(type);
      expect(section).toBeDefined();
      const power = parseInt(section!.get('Power')!, 10);
      expect(power, `${type} should produce power (positive)`).toBeGreaterThan(0);
    }
  });

  it('POWR produces 100, APWR produces 200', () => {
    expect(parseInt(rulesSections.get('POWR')!.get('Power')!, 10)).toBe(100);
    expect(parseInt(rulesSections.get('APWR')!.get('Power')!, 10)).toBe(200);
  });
});

// ============================================================
// Section 7: aftrmath.ini overrides audit
//
// aftrmath.ini can override rules.ini values for buildings.
// Key overrides to audit:
//   [BIO] Capturable=false (rules.ini has no explicit Capturable for BIO)
//   [MISS] Owner=allies,soviet
//   [FACF], [DOMF], [WEAF] — fake buildings
// ============================================================
describe('aftrmath.ini building overrides', () => {
  it('aftrmath.ini overrides BIO Capturable to false', () => {
    const bioRules = rulesSections.get('BIO');
    const bioAftrmath = aftrmathSections.get('BIO');

    // rules.ini BIO does not have Capturable line
    // (HOSP has Capturable=true, but BIO does not)
    expect(bioRules?.has('Capturable'), 'rules.ini BIO should not have Capturable').toBe(false);

    // aftrmath.ini explicitly sets Capturable=false
    expect(bioAftrmath).toBeDefined();
    expect(bioAftrmath!.get('Capturable')?.toLowerCase()).toBe('false');
  });

  it('aftrmath.ini adds FACF, DOMF, WEAF as fake buildings with Capturable=true', () => {
    for (const type of ['FACF', 'DOMF', 'WEAF']) {
      const section = aftrmathSections.get(type);
      expect(section, `${type} should exist in aftrmath.ini`).toBeDefined();
      expect(iniBool(section!, 'Capturable'), `${type} should be Capturable`).toBe(true);
    }
  });

  it('aftrmath.ini MISS section adds Owner=allies,soviet', () => {
    const missAftrmath = aftrmathSections.get('MISS');
    expect(missAftrmath).toBeDefined();
    expect(missAftrmath!.get('Owner')).toBe('allies,soviet');
  });
});

// ============================================================
// Section 8: Cross-check Crewed= flag
//
// Most production buildings have Crewed=yes — when destroyed,
// they spawn infantry survivors. Defense and wall structures vary.
// ============================================================
describe('Crewed= flag audit (rules.ini)', () => {
  const iniCrewed = new Set<string>();
  for (const type of ALL_BUILDING_TYPES) {
    const section = getMergedSection(type);
    if (section && iniBool(section, 'Crewed')) {
      iniCrewed.add(type);
    }
  }

  it('production buildings are Crewed=yes', () => {
    const expectedCrewed = [
      'IRON', 'FCOM', 'ATEK', 'PDOX', 'WEAP',
      'PBOX', 'HBOX', 'TSLA', 'GUN', 'AGUN', 'FTUR',
      'FACT', 'PROC', 'HPAD', 'DOME', 'GAP',
      'SAM', 'MSLO', 'AFLD', 'POWR', 'APWR', 'STEK',
      'HOSP', 'BIO', 'BARR', 'TENT', 'FIX',
    ];
    for (const type of expectedCrewed) {
      expect(iniCrewed.has(type), `${type} should be Crewed=yes in rules.ini`).toBe(true);
    }
  });

  it('SILO and KENN are NOT Crewed', () => {
    expect(iniCrewed.has('SILO'), 'SILO should not be Crewed').toBe(false);
    expect(iniCrewed.has('KENN'), 'KENN should not be Crewed').toBe(false);
  });

  it('walls are NOT Crewed', () => {
    for (const wall of WALLS) {
      expect(iniCrewed.has(wall), `${wall} should not be Crewed`).toBe(false);
    }
  });

  it('SYRD and SPEN are NOT Crewed (BaseNormal=no, no Crewed=yes)', () => {
    // SYRD and SPEN have BaseNormal=no but no Crewed line
    expect(iniCrewed.has('SYRD'), 'SYRD should not be Crewed').toBe(false);
    expect(iniCrewed.has('SPEN'), 'SPEN should not be Crewed').toBe(false);
  });
});

// ============================================================
// Section 9: Sensors= flag
//
// Buildings with Sensors=yes can detect cloaked/submerged units.
// ============================================================
describe('Sensors= flag audit (rules.ini)', () => {
  const iniSensors = new Set<string>();
  for (const type of ALL_BUILDING_TYPES) {
    const section = getMergedSection(type);
    if (section && iniBool(section, 'Sensors')) {
      iniSensors.add(type);
    }
  }

  it('defense + radar buildings have Sensors=yes', () => {
    // rules.ini Sensors=yes lines for buildings: PBOX(1324), HBOX(1339), TSLA(1356),
    // GUN(1371), FTUR(1403), DOME(1480). SAM does NOT have Sensors=yes.
    const expectedSensors = ['PBOX', 'HBOX', 'TSLA', 'GUN', 'FTUR', 'DOME'];
    for (const type of expectedSensors) {
      expect(iniSensors.has(type), `${type} should have Sensors=yes`).toBe(true);
    }
  });

  it('SAM does NOT have Sensors=yes (common misconception)', () => {
    expect(iniSensors.has('SAM'), 'SAM should NOT have Sensors=yes in rules.ini').toBe(false);
  });

  it('AGUN does NOT have Sensors=yes', () => {
    expect(iniSensors.has('AGUN'), 'AGUN should not have Sensors=yes').toBe(false);
  });
});

// ============================================================
// Section 10: Bib= flag audit
//
// Bib=yes means the building has a concrete bib underneath.
// This affects passability of the bib row cells.
// ============================================================
describe('Bib= flag audit (rules.ini)', () => {
  const iniBib = new Set<string>();
  for (const type of ALL_BUILDING_TYPES) {
    const section = getMergedSection(type);
    if (section && iniBool(section, 'Bib')) {
      iniBib.add(type);
    }
  }

  it('expected buildings have Bib=yes', () => {
    const expectedBib = [
      'FCOM', 'ATEK', 'WEAP', 'FACT', 'PROC', 'HPAD',
      'DOME', 'POWR', 'APWR', 'STEK', 'HOSP', 'BIO',
      'BARR', 'TENT',
    ];
    for (const type of expectedBib) {
      expect(iniBib.has(type), `${type} should have Bib=yes`).toBe(true);
    }
  });

  it('defense structures do NOT have Bib=yes', () => {
    const noBib = ['PBOX', 'HBOX', 'TSLA', 'GUN', 'AGUN', 'FTUR', 'SAM', 'MSLO', 'KENN', 'SILO'];
    for (const type of noBib) {
      expect(iniBib.has(type), `${type} should not have Bib=yes`).toBe(false);
    }
  });
});

// ============================================================
// Section 11: BaseNormal= flag
//
// BaseNormal=no prevents AI from including in base rebuild blueprint.
// SYRD, SPEN, BARL have this flag.
// ============================================================
describe('BaseNormal= flag (rules.ini)', () => {
  it('SYRD and SPEN have BaseNormal=no', () => {
    for (const type of ['SYRD', 'SPEN']) {
      const section = getMergedSection(type);
      expect(section).toBeDefined();
      expect(section!.get('BaseNormal')?.toLowerCase(), `${type} BaseNormal`).toBe('no');
    }
  });

  it('BARL has BaseNormal=no', () => {
    const section = getMergedSection('BARL');
    expect(section).toBeDefined();
    expect(section!.get('BaseNormal')?.toLowerCase()).toBe('no');
  });
});

// ============================================================
// Section 12: Comprehensive INI presence audit
//
// Verify every building we track in TS has a rules.ini section.
// ============================================================
describe('TS building types exist in rules.ini', () => {
  it('all MAIN_BUILDINGS have rules.ini sections', () => {
    const missing: string[] = [];
    for (const type of MAIN_BUILDINGS) {
      if (!rulesSections.has(type)) {
        missing.push(type);
      }
    }
    expect(missing).toEqual([]);
  });

  it('all WALLS have rules.ini sections', () => {
    const missing: string[] = [];
    for (const type of WALLS) {
      if (!rulesSections.has(type)) {
        missing.push(type);
      }
    }
    expect(missing).toEqual([]);
  });

  it('POWER_DRAIN keys all correspond to valid building types', () => {
    const drainKeys = Object.keys(POWER_DRAIN);
    const invalidKeys: string[] = [];
    for (const key of drainKeys) {
      if (!rulesSections.has(key) && !aftrmathSections.has(key)) {
        invalidKeys.push(key);
      }
    }
    expect(invalidKeys).toEqual([]);
  });
});
