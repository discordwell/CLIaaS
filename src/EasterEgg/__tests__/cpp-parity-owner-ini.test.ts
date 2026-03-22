/**
 * CPP Parity: Owner= faction values from rules.ini / aftrmath.ini
 *
 * In C++ Red Alert, `Owner=` in rules.ini determines which factions can build
 * a unit or structure. Values: `allies`, `soviet`, or `allies,soviet` (both).
 *
 * This test parses the actual INI files and compares every UNIT_STATS `owner`
 * field and every PRODUCTION_ITEMS `faction` field against the authoritative
 * INI Owner= values.
 *
 * Mapping: INI `allies` -> TS `'allied'`, INI `soviet` -> TS `'soviet'`,
 *          INI `allies,soviet` or `soviet,allies` -> TS `'both'`
 *
 * C++ source refs:
 *   - rules.ini: authoritative Owner= values for all units/buildings
 *   - aftrmath.ini: Aftermath expansion overrides (merged on top of rules.ini)
 *   - idata.cpp / udata.cpp / aadata.cpp / vdata.cpp: C++ defaults (overridden by INI)
 *   - bdata.cpp: building defaults (overridden by INI)
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { UNIT_STATS, PRODUCTION_ITEMS } from '../engine/types';

// ---------------------------------------------------------------------------
// INI Parser (replicates C++ INI load: last-key-wins within a section)
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
      const eqIdx = line.indexOf('=');
      if (eqIdx > 0) {
        const key = line.slice(0, eqIdx).trim();
        const val = line.slice(eqIdx + 1).trim();
        sections[current][key] = val;
      }
    }
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Load and merge INI files: aftrmath.ini overrides rules.ini (section-level)
// ---------------------------------------------------------------------------

const ASSET_DIR = join(__dirname, '..', '..', '..', 'public', 'ra', 'assets');
const rulesIni = parseINI(readFileSync(join(ASSET_DIR, 'rules.ini'), 'utf-8'));
const aftermathIni = parseINI(readFileSync(join(ASSET_DIR, 'aftrmath.ini'), 'utf-8'));

/** Merged INI: for each section, aftrmath.ini keys override rules.ini keys */
function getIniSection(section: string): Record<string, string> {
  const base = rulesIni[section] ?? {};
  const over = aftermathIni[section] ?? {};
  return { ...base, ...over };
}

/** Get Owner= from merged INI for a given section */
function getIniOwner(section: string): string {
  return (getIniSection(section).Owner ?? '').toLowerCase().trim();
}

// ---------------------------------------------------------------------------
// INI owner -> TS faction mapper
// ---------------------------------------------------------------------------

/** Convert INI Owner= value to TS faction string */
function iniOwnerToTsFaction(iniOwner: string): 'allied' | 'soviet' | 'both' | null {
  if (!iniOwner) return null; // empty Owner= means not player-buildable
  const parts = new Set(iniOwner.split(',').map(s => s.trim().toLowerCase()));
  if (parts.has('allies') && parts.has('soviet')) return 'both';
  if (parts.has('allies')) return 'allied';
  if (parts.has('soviet')) return 'soviet';
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CPP Parity: UNIT_STATS.owner vs rules.ini/aftrmath.ini Owner=', () => {
  // Units that have an explicit `owner` field in UNIT_STATS
  const unitsWithOwner = Object.entries(UNIT_STATS).filter(([, s]) => s.owner !== undefined);

  it('every UNIT_STATS entry with owner= matches INI Owner=', () => {
    const mismatches: string[] = [];

    for (const [id, stats] of unitsWithOwner) {
      const iniOwner = getIniOwner(id);
      const expected = iniOwnerToTsFaction(iniOwner);

      if (expected === null) {
        // Unit has owner in TS but no Owner= in INI — flag it
        mismatches.push(
          `${id}: TS owner='${stats.owner}' but INI has no Owner= (raw: '${iniOwner}')`
        );
        continue;
      }

      if (stats.owner !== expected) {
        mismatches.push(
          `${id}: TS owner='${stats.owner}', INI Owner='${iniOwner}' -> expected '${expected}'`
        );
      }
    }

    expect(mismatches, `UNIT_STATS owner mismatches:\n${mismatches.join('\n')}`).toEqual([]);
  });

  // Per-unit tests for units that DO have owner
  const EXPECTED_UNIT_OWNERS: [string, string][] = [
    // Infantry
    ['E1', 'allies,soviet'],    // Rifle Infantry — both
    ['E2', 'soviet'],           // Grenadier — soviet
    ['E3', 'allies'],           // Rocket Soldier — allied
    ['E4', 'soviet'],           // Flamethrower — soviet
    ['E6', 'soviet,allies'],    // Engineer — both (note: INI order varies)
    ['DOG', 'soviet'],          // Attack Dog — soviet
    ['SPY', 'allies'],          // Spy — allied
    ['MEDI', 'allies'],         // Medic — allied
    ['E7', 'allies,soviet'],    // Tanya — both
    ['THF', 'allies'],          // Thief — allied
    // Expansion infantry
    ['SHOK', 'soviet'],         // Shock Trooper — soviet (aftrmath.ini)
    ['MECH', 'allies'],         // Mechanic — allied (aftrmath.ini)
    // Vehicles with owner in UNIT_STATS
    ['V2RL', 'soviet'],         // V2 Rocket — soviet
    ['MNLY', 'allies,soviet'],  // Minelayer — both
    ['MRJ', 'allies'],          // Radar Jammer — allied
    ['MGG', 'allies'],          // Mobile Gap Generator — allied
    // Aircraft with owner in UNIT_STATS
    ['BADR', 'soviet'],         // Badger — soviet
    ['U2', 'soviet'],           // Spy Plane — soviet
  ];

  it.each(EXPECTED_UNIT_OWNERS)(
    'UNIT_STATS[%s] owner matches INI Owner=%s',
    (unitId, expectedIniOwner) => {
      const iniOwner = getIniOwner(unitId);
      const expectedFaction = iniOwnerToTsFaction(expectedIniOwner);
      const tsOwner = UNIT_STATS[unitId]?.owner;

      // Verify INI actually has this Owner= value
      const iniParts = new Set(iniOwner.split(',').map(s => s.trim()));
      const expectedParts = new Set(expectedIniOwner.split(',').map(s => s.trim()));
      expect(iniParts, `${unitId}: INI Owner= should be '${expectedIniOwner}'`).toEqual(expectedParts);

      // Verify TS matches
      expect(tsOwner, `${unitId}: TS should have owner='${expectedFaction}'`).toBe(expectedFaction);
    }
  );
});

describe('CPP Parity: PRODUCTION_ITEMS.faction vs rules.ini/aftrmath.ini Owner=', () => {
  it('every PRODUCTION_ITEMS faction matches INI Owner=', () => {
    // Non-buildable items may have no Owner= in INI or Owner=none.
    // These are tracked in PRODUCTION_ITEMS for completeness but have TS-assigned faction.
    const NO_INI_OWNER = new Set([
      'BARB', 'WOOD', 'CYCL',       // walls/fences with no Owner= in INI
      'BIO', 'HOSP', 'MISS',        // scenario buildings with no Owner= or Owner=none
    ]);
    const mismatches: string[] = [];

    for (const item of PRODUCTION_ITEMS) {
      if (NO_INI_OWNER.has(item.type)) continue;
      const iniOwner = getIniOwner(item.type);
      const expected = iniOwnerToTsFaction(iniOwner);

      if (expected === null) {
        mismatches.push(
          `${item.type}: TS faction='${item.faction}' but INI Owner= is empty/missing`
        );
        continue;
      }

      if (item.faction !== expected) {
        mismatches.push(
          `${item.type}: TS faction='${item.faction}', INI Owner='${iniOwner}' -> expected '${expected}'`
        );
      }
    }

    expect(mismatches, `PRODUCTION_ITEMS faction mismatches:\n${mismatches.join('\n')}`).toEqual([]);
  });

  // Structures
  const EXPECTED_STRUCTURE_OWNERS: [string, string][] = [
    ['FACT', 'allies,soviet'],
    ['POWR', 'allies,soviet'],
    ['APWR', 'allies,soviet'],
    ['BARR', 'soviet'],
    ['TENT', 'allies'],
    ['PROC', 'allies,soviet'],
    ['WEAP', 'soviet,allies'],    // INI has soviet,allies (order doesn't matter)
    ['SILO', 'allies,soviet'],
    ['DOME', 'allies,soviet'],
    ['FIX', 'allies,soviet'],
    ['HPAD', 'allies,soviet'],
    ['AFLD', 'soviet'],
    ['PBOX', 'allies'],
    ['HBOX', 'allies'],
    ['GUN', 'allies'],
    ['AGUN', 'allies'],
    ['GAP', 'allies'],
    ['FTUR', 'soviet'],
    ['TSLA', 'soviet'],
    ['SAM', 'soviet'],
    ['KENN', 'soviet'],
    ['SYRD', 'allies'],
    ['SPEN', 'soviet'],
    ['ATEK', 'allies'],
    ['STEK', 'soviet'],
    ['PDOX', 'allies'],
    ['IRON', 'soviet'],
    ['MSLO', 'soviet,allies'],   // INI has soviet,allies
    ['SBAG', 'allies'],
    ['FENC', 'soviet'],
    ['BRIK', 'allies,soviet'],
  ];

  it.each(EXPECTED_STRUCTURE_OWNERS)(
    'PRODUCTION_ITEMS[%s] (structure) faction matches INI Owner=%s',
    (itemType, expectedIniOwner) => {
      const iniOwner = getIniOwner(itemType);
      const expectedFaction = iniOwnerToTsFaction(expectedIniOwner);
      const item = PRODUCTION_ITEMS.find(p => p.type === itemType && p.isStructure);

      expect(item, `${itemType}: should exist in PRODUCTION_ITEMS as structure`).toBeDefined();

      // Verify INI
      const iniParts = new Set(iniOwner.split(',').map(s => s.trim()));
      const expectedParts = new Set(expectedIniOwner.split(',').map(s => s.trim()));
      expect(iniParts, `${itemType}: INI Owner=`).toEqual(expectedParts);

      // Verify TS faction
      expect(item!.faction, `${itemType}: TS faction`).toBe(expectedFaction);
    }
  );

  // Units in PRODUCTION_ITEMS
  const EXPECTED_PROD_UNIT_OWNERS: [string, string][] = [
    // Infantry
    ['E1', 'allies,soviet'],
    ['E2', 'soviet'],
    ['E3', 'allies'],
    ['E4', 'soviet'],
    ['E6', 'soviet,allies'],
    ['DOG', 'soviet'],
    ['MEDI', 'allies'],
    ['SPY', 'allies'],
    ['E7', 'allies,soviet'],
    ['THF', 'allies'],
    ['SHOK', 'soviet'],
    ['MECH', 'allies'],
    // Vehicles
    ['JEEP', 'allies'],
    ['1TNK', 'allies'],
    ['2TNK', 'allies'],
    ['3TNK', 'soviet'],
    ['4TNK', 'soviet'],
    ['ARTY', 'allies'],
    ['APC', 'allies'],
    ['HARV', 'allies,soviet'],
    ['V2RL', 'soviet'],
    ['MNLY', 'allies,soviet'],
    ['STNK', 'allies,soviet'],
    ['CTNK', 'allies'],
    ['TTNK', 'soviet'],
    ['QTNK', 'soviet'],
    ['DTRK', 'allies,soviet'],
    ['MRJ', 'allies'],
    ['MGG', 'allies'],
    // Naval
    ['PT', 'allies'],
    ['DD', 'allies'],
    ['LST', 'allies,soviet'],
    ['CA', 'allies'],
    ['SS', 'soviet'],
    ['MSUB', 'soviet'],
    // Aircraft
    ['TRAN', 'soviet'],
    ['HELI', 'allies'],
    ['HIND', 'soviet'],
    ['MIG', 'soviet'],
    ['YAK', 'soviet'],
  ];

  it.each(EXPECTED_PROD_UNIT_OWNERS)(
    'PRODUCTION_ITEMS[%s] (unit) faction matches INI Owner=%s',
    (itemType, expectedIniOwner) => {
      const iniOwner = getIniOwner(itemType);
      const expectedFaction = iniOwnerToTsFaction(expectedIniOwner);
      const item = PRODUCTION_ITEMS.find(p => p.type === itemType && !p.isStructure);

      expect(item, `${itemType}: should exist in PRODUCTION_ITEMS as unit`).toBeDefined();

      // Verify INI
      const iniParts = new Set(iniOwner.split(',').map(s => s.trim()));
      const expectedParts = new Set(expectedIniOwner.split(',').map(s => s.trim()));
      expect(iniParts, `${itemType}: INI Owner=`).toEqual(expectedParts);

      // Verify TS faction
      expect(item!.faction, `${itemType}: TS faction`).toBe(expectedFaction);
    }
  );
});

describe('CPP Parity: UNIT_STATS entries missing owner that have INI Owner=', () => {
  // These units exist in UNIT_STATS but lack an `owner` field.
  // The INI has Owner= for them. This section documents the gap.
  // Many are handled correctly via PRODUCTION_ITEMS.faction instead,
  // but for data completeness UNIT_STATS should also carry owner.

  const UNITS_MISSING_OWNER: [string, string][] = [
    // Vehicles without owner in UNIT_STATS
    ['1TNK', 'allied'],
    ['2TNK', 'allied'],
    ['3TNK', 'soviet'],
    ['4TNK', 'soviet'],
    ['JEEP', 'allied'],
    ['APC', 'allied'],
    ['ARTY', 'allied'],
    ['HARV', 'both'],
    ['MCV', 'both'],
    ['TRUK', 'both'],
    ['STNK', 'both'],
    ['CTNK', 'allied'],
    ['TTNK', 'soviet'],
    ['QTNK', 'soviet'],
    ['DTRK', 'both'],
    // Naval without owner
    ['SS', 'soviet'],
    ['DD', 'allied'],
    ['CA', 'allied'],
    ['PT', 'allied'],
    ['MSUB', 'soviet'],
    ['LST', 'both'],
    // Aircraft without owner
    ['MIG', 'soviet'],
    ['YAK', 'soviet'],
    ['HELI', 'allied'],
    ['HIND', 'soviet'],
    ['TRAN', 'soviet'],
  ];

  it.each(UNITS_MISSING_OWNER)(
    'UNIT_STATS[%s] is missing owner (INI says %s)',
    (unitId, expectedFaction) => {
      const stats = UNIT_STATS[unitId];
      expect(stats, `${unitId}: should exist in UNIT_STATS`).toBeDefined();

      const iniOwner = getIniOwner(unitId);
      const iniFaction = iniOwnerToTsFaction(iniOwner);
      expect(iniFaction, `${unitId}: INI Owner= should map to '${expectedFaction}'`).toBe(expectedFaction);

      // This test documents that these entries lack `owner` in UNIT_STATS.
      // If owner is added later, this test should be updated.
      expect(stats.owner, `${unitId}: currently missing owner in UNIT_STATS`).toBeUndefined();
    }
  );

  // Civilians — INI has Owner= but they're not buildable, so missing owner is expected
  const CIVILIANS_NO_OWNER = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'EINSTEIN', 'GNRL', 'CHAN'];

  it.each(CIVILIANS_NO_OWNER)(
    'UNIT_STATS[%s] (civilian/special) has no owner — INI has Owner= but they are non-buildable',
    (unitId) => {
      const stats = UNIT_STATS[unitId];
      expect(stats, `${unitId}: should exist in UNIT_STATS`).toBeDefined();

      const iniOwner = getIniOwner(unitId);
      expect(iniOwner.length, `${unitId}: INI should have non-empty Owner=`).toBeGreaterThan(0);

      // Civilians are not buildable, so missing owner is acceptable
      expect(stats.owner).toBeUndefined();
    }
  );
});

describe('CPP Parity: INI Owner= round-trip sanity checks', () => {
  it('iniOwnerToTsFaction maps correctly', () => {
    expect(iniOwnerToTsFaction('allies')).toBe('allied');
    expect(iniOwnerToTsFaction('soviet')).toBe('soviet');
    expect(iniOwnerToTsFaction('allies,soviet')).toBe('both');
    expect(iniOwnerToTsFaction('soviet,allies')).toBe('both');
    expect(iniOwnerToTsFaction('')).toBeNull();
  });

  it('rules.ini BARR is soviet, TENT is allies', () => {
    expect(getIniOwner('BARR')).toBe('soviet');
    expect(getIniOwner('TENT')).toBe('allies');
  });

  it('merged INI respects aftrmath.ini overrides for expansion units', () => {
    // STNK in aftrmath.ini overrides rules.ini
    const stnkOwner = getIniOwner('STNK');
    expect(stnkOwner).toContain('allies');
    expect(stnkOwner).toContain('soviet');

    // SHOK only in aftrmath.ini
    expect(getIniOwner('SHOK')).toBe('soviet');

    // MECH only in aftrmath.ini
    expect(getIniOwner('MECH')).toBe('allies');
  });
});
