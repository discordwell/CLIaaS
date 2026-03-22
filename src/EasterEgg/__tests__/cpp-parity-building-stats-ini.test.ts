/**
 * C++ parity: Building Strength (HP), Power, Cost, and Armor vs rules.ini
 *
 * rules.ini is the authoritative source of truth for all building data.
 * This test parses rules.ini directly and compares against TS engine constants.
 *
 * C++ source refs:
 *   - bdata.cpp: building type class constructors (fallback defaults)
 *   - building.cpp:4613: Power_Output uses Strength= and Power= from rules.ini
 *   - techno.cpp:Read_INI: Armor=, Cost=, Strength=, Power= parsed from rules.ini
 *   - defines.h:2687: ArmorType enum (ARMOR_NONE, ARMOR_WOOD, ARMOR_ALUMINUM, ARMOR_STEEL, ARMOR_CONCRETE)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// TS engine data
import { STRUCTURE_MAX_HP, STRUCTURE_ARMOR } from '../engine/scenario';
import { POWER_DRAIN, PRODUCTION_ITEMS } from '../engine/types';

// ---------------------------------------------------------------------------
// Parse rules.ini
// ---------------------------------------------------------------------------
const RULES_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/rules.ini');
const rulesText = fs.readFileSync(RULES_INI_PATH, 'utf-8');

interface BuildingINI {
  strength?: number;
  armor?: string;
  power?: number;      // positive = produces, negative = drains
  cost?: number;
}

function parseRulesINI(text: string): Record<string, BuildingINI> {
  const result: Record<string, BuildingINI> = {};
  let currentSection = '';

  for (const rawLine of text.split('\n')) {
    const line = rawLine.split(';')[0].trim(); // strip comments
    if (!line) continue;

    const sectionMatch = line.match(/^\[([A-Z0-9]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }

    if (!currentSection) continue;

    const kvMatch = line.match(/^(\w+)=(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const val = kvMatch[2].trim();

    if (!result[currentSection]) result[currentSection] = {};
    const entry = result[currentSection];

    switch (key) {
      case 'Strength':
        entry.strength = parseInt(val, 10);
        break;
      case 'Armor':
        entry.armor = val.toLowerCase();
        break;
      case 'Power':
        entry.power = parseInt(val, 10);
        break;
      case 'Cost':
        if (val !== '') entry.cost = parseInt(val, 10);
        break;
    }
  }
  return result;
}

const INI = parseRulesINI(rulesText);

// All building types we audit (main gameplay buildings + walls + misc)
const MAIN_BUILDINGS = [
  'POWR', 'APWR', 'PROC', 'TENT', 'BARR', 'WEAP', 'AFLD', 'HPAD', 'DOME',
  'GUN', 'SAM', 'TSLA', 'GAP', 'PBOX', 'HBOX', 'AGUN', 'FTUR', 'KENN',
  'ATEK', 'STEK', 'IRON', 'PDOX', 'MSLO', 'FIX', 'SILO', 'FACT',
  'SYRD', 'SPEN', 'BIO', 'HOSP',
];

const WALLS = ['SBAG', 'FENC', 'BARB', 'BRIK', 'WOOD', 'CYCL'];

const MISC_BUILDINGS = ['FCOM', 'MISS'];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cpp-parity: Building Strength (HP) vs rules.ini', () => {
  it.each(MAIN_BUILDINGS)('%s — Strength= matches STRUCTURE_MAX_HP', (type) => {
    const iniStrength = INI[type]?.strength;
    expect(iniStrength, `rules.ini [${type}] should have Strength=`).toBeDefined();
    const tsHp = STRUCTURE_MAX_HP[type];
    expect(tsHp, `STRUCTURE_MAX_HP should have ${type}`).toBeDefined();
    expect(tsHp).toBe(iniStrength);
  });

  it.each(WALLS)('%s — Strength= matches STRUCTURE_MAX_HP', (type) => {
    const iniStrength = INI[type]?.strength;
    expect(iniStrength, `rules.ini [${type}] should have Strength=`).toBeDefined();
    const tsHp = STRUCTURE_MAX_HP[type];
    expect(tsHp, `STRUCTURE_MAX_HP should have ${type}`).toBeDefined();
    expect(tsHp).toBe(iniStrength);
  });

  it.each(MISC_BUILDINGS)('%s — Strength= matches STRUCTURE_MAX_HP', (type) => {
    const iniStrength = INI[type]?.strength;
    expect(iniStrength, `rules.ini [${type}] should have Strength=`).toBeDefined();
    const tsHp = STRUCTURE_MAX_HP[type];
    expect(tsHp, `STRUCTURE_MAX_HP should have ${type}`).toBeDefined();
    expect(tsHp).toBe(iniStrength);
  });
});

describe('cpp-parity: Building Armor vs rules.ini', () => {
  // C++ defines.h:2687: enum ArmorType { ARMOR_NONE, ARMOR_WOOD, ARMOR_ALUMINUM, ARMOR_STEEL, ARMOR_CONCRETE }
  // rules.ini Armor= string → C++ enum:
  //   "none"   → ARMOR_NONE     → TS 'none'
  //   "wood"   → ARMOR_WOOD     → TS 'wood'
  //   "light"  → ARMOR_ALUMINUM → TS 'light'
  //   "heavy"  → ARMOR_STEEL    → TS 'heavy'

  it.each(MAIN_BUILDINGS)('%s — Armor= matches STRUCTURE_ARMOR', (type) => {
    const iniArmor = INI[type]?.armor;
    expect(iniArmor, `rules.ini [${type}] should have Armor=`).toBeDefined();
    const tsArmor = STRUCTURE_ARMOR[type];
    expect(tsArmor, `STRUCTURE_ARMOR should have ${type}`).toBeDefined();
    expect(tsArmor).toBe(iniArmor);
  });

  // Walls: rules.ini specifies Armor= for walls. TS uses `?? 'wood'` fallback
  // which is WRONG for walls with Armor=none.
  it.each(
    WALLS.filter((t) => INI[t]?.armor !== undefined)
  )('%s — Armor= matches STRUCTURE_ARMOR', (type) => {
    const iniArmor = INI[type]!.armor!;
    const tsArmor = STRUCTURE_ARMOR[type];
    // STRUCTURE_ARMOR may not have walls; check explicit entry vs INI
    if (tsArmor !== undefined) {
      expect(tsArmor).toBe(iniArmor);
    } else {
      // If missing from STRUCTURE_ARMOR, the runtime fallback is 'wood'.
      // This is correct only if rules.ini also says Armor=wood.
      expect('wood').toBe(iniArmor);
    }
  });
});

describe('cpp-parity: Building Power vs rules.ini', () => {
  // rules.ini Power= is negative for drain, positive for production.
  // TS POWER_DRAIN stores positive values meaning "this much drain".
  // TS powerOutput() hardcodes POWR=100 and APWR=200 for production.

  // Power producers: POWR and APWR have positive Power= in rules.ini
  it('POWR produces 100W per rules.ini Power=100', () => {
    expect(INI['POWR']!.power).toBe(100);
    // TS hardcodes 100 in repairSell.ts powerOutput()
    // POWR should NOT be in POWER_DRAIN (it produces power)
    expect(POWER_DRAIN['POWR']).toBeUndefined();
  });

  it('APWR produces 200W per rules.ini Power=200', () => {
    expect(INI['APWR']!.power).toBe(200);
    expect(POWER_DRAIN['APWR']).toBeUndefined();
  });

  // FACT has Power=0 in rules.ini — no drain, no production
  it('FACT has Power=0 — no drain', () => {
    expect(INI['FACT']!.power).toBe(0);
    expect(POWER_DRAIN['FACT']).toBeUndefined();
  });

  // All draining buildings: rules.ini Power= is negative, TS POWER_DRAIN stores abs value
  const DRAINING_BUILDINGS = MAIN_BUILDINGS.filter((t) => {
    const p = INI[t]?.power;
    return p !== undefined && p < 0;
  });

  it.each(DRAINING_BUILDINGS)('%s — |Power=| matches POWER_DRAIN', (type) => {
    const iniDrain = Math.abs(INI[type]!.power!);
    const tsDrain = POWER_DRAIN[type];
    expect(tsDrain, `POWER_DRAIN should have ${type}`).toBeDefined();
    expect(tsDrain).toBe(iniDrain);
  });

  // FCOM has Power=-200 in rules.ini — check TS tracks it
  it('FCOM drains 200W per rules.ini Power=-200', () => {
    const iniDrain = Math.abs(INI['FCOM']!.power!);
    expect(iniDrain).toBe(200);
    const tsDrain = POWER_DRAIN['FCOM'];
    // FCOM is a non-buildable structure but still drains power when placed on map
    expect(tsDrain, 'POWER_DRAIN should have FCOM').toBeDefined();
    expect(tsDrain).toBe(200);
  });
});

describe('cpp-parity: Building Cost vs rules.ini', () => {
  // PRODUCTION_ITEMS contains buildable structures with cost.
  // Compare against rules.ini Cost= for each structure.

  const structureItems = PRODUCTION_ITEMS.filter(
    (item) => (item as { isStructure?: boolean }).isStructure
  );

  // Build a lookup: type -> cost from PRODUCTION_ITEMS
  const tsCostMap: Record<string, number> = {};
  for (const item of structureItems) {
    tsCostMap[item.type] = item.cost;
  }

  const BUILDABLE_STRUCTURES = MAIN_BUILDINGS.filter(
    (t) => INI[t]?.cost !== undefined && INI[t]!.cost! > 0
  );

  it.each(BUILDABLE_STRUCTURES)('%s — Cost= matches PRODUCTION_ITEMS cost', (type) => {
    const iniCost = INI[type]!.cost!;
    const tsCost = tsCostMap[type];
    expect(tsCost, `PRODUCTION_ITEMS should have structure ${type}`).toBeDefined();
    expect(tsCost).toBe(iniCost);
  });

  // Walls with costs
  const BUILDABLE_WALLS = WALLS.filter(
    (t) => INI[t]?.cost !== undefined && INI[t]!.cost! > 0
  );

  it.each(BUILDABLE_WALLS)('%s — Cost= matches PRODUCTION_ITEMS cost', (type) => {
    const iniCost = INI[type]!.cost!;
    const tsCost = tsCostMap[type];
    if (tsCost !== undefined) {
      expect(tsCost).toBe(iniCost);
    }
    // Some walls may intentionally not be in PRODUCTION_ITEMS (not buildable by player)
  });
});

describe('cpp-parity: comprehensive rules.ini audit summary', () => {
  it('enumerates ALL mismatches for review', () => {
    const mismatches: string[] = [];

    const ALL_BUILDINGS = [...MAIN_BUILDINGS, ...WALLS, ...MISC_BUILDINGS];

    // Build cost lookup from PRODUCTION_ITEMS
    const structureItems = PRODUCTION_ITEMS.filter(
      (item) => (item as { isStructure?: boolean }).isStructure
    );
    const tsCostMap: Record<string, number> = {};
    for (const item of structureItems) {
      tsCostMap[item.type] = item.cost;
    }

    for (const type of ALL_BUILDINGS) {
      const ini = INI[type];
      if (!ini) {
        mismatches.push(`${type}: NOT FOUND in rules.ini`);
        continue;
      }

      // HP
      if (ini.strength !== undefined) {
        const tsHp = STRUCTURE_MAX_HP[type];
        if (tsHp === undefined) {
          mismatches.push(`${type}: HP missing from STRUCTURE_MAX_HP (rules.ini Strength=${ini.strength})`);
        } else if (tsHp !== ini.strength) {
          mismatches.push(`${type}: HP mismatch — rules.ini Strength=${ini.strength}, TS=${tsHp}`);
        }
      }

      // Armor
      if (ini.armor !== undefined) {
        const tsArmor = STRUCTURE_ARMOR[type];
        if (tsArmor === undefined) {
          // Check if the runtime fallback ('wood') matches
          if (ini.armor !== 'wood') {
            mismatches.push(`${type}: Armor missing from STRUCTURE_ARMOR — rules.ini Armor=${ini.armor}, runtime fallback='wood' (WRONG)`);
          }
        } else if (tsArmor !== ini.armor) {
          mismatches.push(`${type}: Armor mismatch — rules.ini Armor=${ini.armor}, TS='${tsArmor}'`);
        }
      }

      // Power
      if (ini.power !== undefined && ini.power < 0) {
        const expectedDrain = Math.abs(ini.power);
        const tsDrain = POWER_DRAIN[type];
        if (tsDrain === undefined) {
          mismatches.push(`${type}: POWER_DRAIN missing — rules.ini Power=${ini.power}`);
        } else if (tsDrain !== expectedDrain) {
          mismatches.push(`${type}: Power drain mismatch — rules.ini |Power|=${expectedDrain}, TS=${tsDrain}`);
        }
      }

      // Cost
      if (ini.cost !== undefined && ini.cost > 0) {
        const tsCost = tsCostMap[type];
        if (tsCost !== undefined && tsCost !== ini.cost) {
          mismatches.push(`${type}: Cost mismatch — rules.ini Cost=${ini.cost}, TS=${tsCost}`);
        }
      }
    }

    // Log all mismatches for visibility, then assert none
    if (mismatches.length > 0) {
      console.error('\n=== BUILDING STAT MISMATCHES vs rules.ini ===');
      for (const m of mismatches) {
        console.error(`  - ${m}`);
      }
      console.error(`=== Total: ${mismatches.length} mismatches ===\n`);
    }

    expect(mismatches).toEqual([]);
  });
});
