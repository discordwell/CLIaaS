/**
 * C++ parity: TechLevel= for all buildable units and structures vs rules.ini / aftrmath.ini
 *
 * rules.ini is the authoritative source of truth. aftrmath.ini overrides rules.ini
 * for Aftermath/Counterstrike expansion units (SHOK, MECH, STNK, CTNK, TTNK,
 * QTNK, DTRK, MSUB) that have no section in rules.ini.
 *
 * TechLevel=-1 means the item is unbuildable (e.g. FACT — deployed from MCV).
 *
 * C++ source refs:
 *   - techno.cpp: TechnoTypeClass::Read_INI reads TechLevel= from rules.ini
 *   - sidebar.cpp: items with TechLevel > player scenario tech are hidden
 *   - rules.ini [<TYPE>] TechLevel= — the authoritative value
 *   - aftrmath.ini [<TYPE>] TechLevel= — overrides for expansion units
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { PRODUCTION_ITEMS } from '../engine/types';

// ---------------------------------------------------------------------------
// Parse INI files
// ---------------------------------------------------------------------------
const RULES_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/rules.ini');
const AFTRMATH_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/aftrmath.ini');

const rulesText = fs.readFileSync(RULES_INI_PATH, 'utf-8');
const aftrmathText = fs.readFileSync(AFTRMATH_INI_PATH, 'utf-8');

/**
 * Minimal INI parser — extracts TechLevel= per section.
 * Handles semicolon comments and whitespace.
 */
function parseTechLevels(text: string): Record<string, number> {
  const result: Record<string, number> = {};
  let currentSection = '';

  for (const rawLine of text.split('\n')) {
    const line = rawLine.split(';')[0].trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].toUpperCase();
      continue;
    }

    if (!currentSection) continue;

    const kvMatch = line.match(/^(\w+)\s*=\s*(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const val = kvMatch[2].trim();

    if (key === 'TechLevel') {
      result[currentSection] = parseInt(val, 10);
    }
  }
  return result;
}

// Parse both INI files
const rulesTechLevels = parseTechLevels(rulesText);
const aftrmathTechLevels = parseTechLevels(aftrmathText);

// Merge: aftrmath.ini overrides rules.ini (C++ loads aftermath after rules)
const mergedTechLevels: Record<string, number> = { ...rulesTechLevels, ...aftrmathTechLevels };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('C++ parity: TechLevel= from rules.ini / aftrmath.ini', () => {

  // Verify INI files are loaded correctly
  it('rules.ini contains TechLevel entries', () => {
    expect(Object.keys(rulesTechLevels).length).toBeGreaterThan(50);
  });

  it('aftrmath.ini contains TechLevel entries for expansion units', () => {
    // Expansion-only units: SHOK, MECH, STNK, CTNK, TTNK, QTNK, DTRK, MSUB
    for (const unit of ['SHOK', 'MECH', 'STNK', 'CTNK', 'TTNK', 'QTNK', 'DTRK', 'MSUB']) {
      expect(aftrmathTechLevels[unit], `${unit} should have TechLevel in aftrmath.ini`).toBeDefined();
    }
  });

  // --- Infantry ---
  describe('Infantry TechLevel', () => {
    const infantryExpected: [string, number, string][] = [
      // [type, INI TechLevel, INI source]
      ['E1',   1,  'rules.ini'],   // Rifle Infantry
      ['E2',   1,  'rules.ini'],   // Grenadier
      ['E3',   2,  'rules.ini'],   // Rocket Soldier
      ['E4',   6,  'rules.ini'],   // Flamethrower
      ['E6',   5,  'rules.ini'],   // Engineer
      ['DOG',  3,  'rules.ini'],   // Attack Dog
      ['MEDI', 2,  'rules.ini'],   // Medic
      ['SPY',  6,  'rules.ini'],   // Spy
      ['E7',  11,  'rules.ini'],   // Tanya
      ['THF', 11,  'rules.ini'],   // Thief
      ['SHOK', 7,  'aftrmath.ini'], // Shock Trooper (expansion)
      ['MECH', 7,  'aftrmath.ini'], // Mechanic (expansion)
    ];

    for (const [type, expectedTech, source] of infantryExpected) {
      it(`${type} TechLevel=${expectedTech} (${source})`, () => {
        const iniValue = mergedTechLevels[type];
        expect(iniValue, `${type} not found in INI`).toBeDefined();
        expect(iniValue).toBe(expectedTech);

        const tsItem = PRODUCTION_ITEMS.find(i => i.type === type);
        expect(tsItem, `${type} not in PRODUCTION_ITEMS`).toBeDefined();
        expect(tsItem!.techLevel).toBe(iniValue);
      });
    }
  });

  // --- Vehicles ---
  describe('Vehicle TechLevel', () => {
    const vehicleExpected: [string, number, string][] = [
      ['JEEP',  3,  'rules.ini'],   // Ranger
      ['1TNK',  4,  'rules.ini'],   // Light Tank
      ['2TNK',  6,  'rules.ini'],   // Medium Tank
      ['3TNK',  4,  'rules.ini'],   // Heavy Tank
      ['4TNK', 10,  'rules.ini'],   // Mammoth Tank
      ['ARTY',  8,  'rules.ini'],   // Artillery
      ['APC',   5,  'rules.ini'],   // APC
      ['HARV',  1,  'rules.ini'],   // Harvester
      ['V2RL',  4,  'rules.ini'],   // V2 Rocket Launcher
      ['MNLY',  3,  'rules.ini'],   // Minelayer
      ['MRJ',  12,  'rules.ini'],   // Radar Jammer
      ['MGG',  11,  'rules.ini'],   // Mobile Gap Generator
      // Expansion vehicles
      ['STNK', -1,  'aftrmath.ini'], // Phase Transport (unbuildable)
      ['CTNK', 12,  'aftrmath.ini'], // Chrono Tank
      ['TTNK',  8,  'aftrmath.ini'], // Tesla Tank
      ['QTNK', 10,  'aftrmath.ini'], // M.A.D. Tank
      ['DTRK', 13,  'aftrmath.ini'], // Demo Truck
    ];

    for (const [type, expectedTech, source] of vehicleExpected) {
      it(`${type} TechLevel=${expectedTech} (${source})`, () => {
        const iniValue = mergedTechLevels[type];
        expect(iniValue, `${type} not found in INI`).toBeDefined();
        expect(iniValue).toBe(expectedTech);

        const tsItem = PRODUCTION_ITEMS.find(i => i.type === type);
        expect(tsItem, `${type} not in PRODUCTION_ITEMS`).toBeDefined();
        expect(tsItem!.techLevel).toBe(iniValue);
      });
    }
  });

  // --- Naval ---
  describe('Naval TechLevel', () => {
    const navalExpected: [string, number, string][] = [
      ['PT',    5, 'rules.ini'],   // Gunboat
      ['DD',    7, 'rules.ini'],   // Destroyer
      ['LST',   3, 'rules.ini'],   // Transport
      ['CA',   10, 'rules.ini'],   // Cruiser
      ['SS',    5, 'rules.ini'],   // Submarine
      ['MSUB',  9, 'aftrmath.ini'], // Missile Sub (expansion)
    ];

    for (const [type, expectedTech, source] of navalExpected) {
      it(`${type} TechLevel=${expectedTech} (${source})`, () => {
        const iniValue = mergedTechLevels[type];
        expect(iniValue, `${type} not found in INI`).toBeDefined();
        expect(iniValue).toBe(expectedTech);

        const tsItem = PRODUCTION_ITEMS.find(i => i.type === type);
        expect(tsItem, `${type} not in PRODUCTION_ITEMS`).toBeDefined();
        expect(tsItem!.techLevel).toBe(iniValue);
      });
    }
  });

  // --- Aircraft ---
  describe('Aircraft TechLevel', () => {
    const aircraftExpected: [string, number, string][] = [
      ['TRAN', 11, 'rules.ini'],  // Chinook
      ['HELI',  9, 'rules.ini'],  // Longbow
      ['HIND',  9, 'rules.ini'],  // Hind
      ['MIG',  10, 'rules.ini'],  // MiG
      ['YAK',   5, 'rules.ini'],  // Yak
    ];

    for (const [type, expectedTech, source] of aircraftExpected) {
      it(`${type} TechLevel=${expectedTech} (${source})`, () => {
        const iniValue = mergedTechLevels[type];
        expect(iniValue, `${type} not found in INI`).toBeDefined();
        expect(iniValue).toBe(expectedTech);

        const tsItem = PRODUCTION_ITEMS.find(i => i.type === type);
        expect(tsItem, `${type} not in PRODUCTION_ITEMS`).toBeDefined();
        expect(tsItem!.techLevel).toBe(iniValue);
      });
    }
  });

  // --- Structures ---
  describe('Structure TechLevel', () => {
    const structureExpected: [string, number][] = [
      ['FACT', -1],  // Construction Yard (unbuildable — MCV deploys into it)
      ['POWR',  1],  // Power Plant
      ['APWR',  8],  // Advanced Power Plant
      ['BARR',  1],  // Soviet Barracks
      ['TENT',  1],  // Allied Barracks
      ['PROC',  1],  // Ore Refinery
      ['WEAP',  3],  // War Factory
      ['SILO',  1],  // Ore Silo
      ['DOME',  3],  // Radar Dome
      ['FIX',   3],  // Service Depot
      ['HPAD',  9],  // Helipad
      ['AFLD',  5],  // Airfield
    ];

    for (const [type, expectedTech] of structureExpected) {
      it(`${type} TechLevel=${expectedTech} (rules.ini)`, () => {
        const iniValue = mergedTechLevels[type];
        expect(iniValue, `${type} not found in INI`).toBeDefined();
        expect(iniValue).toBe(expectedTech);

        const tsItem = PRODUCTION_ITEMS.find(i => i.type === type);
        expect(tsItem, `${type} not in PRODUCTION_ITEMS`).toBeDefined();
        expect(tsItem!.techLevel).toBe(iniValue);
      });
    }
  });

  // --- Defenses ---
  describe('Defense TechLevel', () => {
    const defenseExpected: [string, number][] = [
      ['PBOX',  2],  // Pillbox
      ['HBOX',  3],  // Camo Pillbox
      ['GUN',   4],  // Turret
      ['AGUN',  5],  // AA Gun
      ['GAP',  10],  // Gap Generator
      ['FTUR',  2],  // Flame Tower
      ['TSLA',  7],  // Tesla Coil
      ['SAM',   9],  // SAM Site
      ['KENN',  3],  // Kennel
    ];

    for (const [type, expectedTech] of defenseExpected) {
      it(`${type} TechLevel=${expectedTech} (rules.ini)`, () => {
        const iniValue = mergedTechLevels[type];
        expect(iniValue, `${type} not found in INI`).toBeDefined();
        expect(iniValue).toBe(expectedTech);

        const tsItem = PRODUCTION_ITEMS.find(i => i.type === type);
        expect(tsItem, `${type} not in PRODUCTION_ITEMS`).toBeDefined();
        expect(tsItem!.techLevel).toBe(iniValue);
      });
    }
  });

  // --- Naval structures ---
  describe('Naval Structure TechLevel', () => {
    const navalStructExpected: [string, number][] = [
      ['SYRD', 3],  // Ship Yard
      ['SPEN', 3],  // Sub Pen
    ];

    for (const [type, expectedTech] of navalStructExpected) {
      it(`${type} TechLevel=${expectedTech} (rules.ini)`, () => {
        const iniValue = mergedTechLevels[type];
        expect(iniValue, `${type} not found in INI`).toBeDefined();
        expect(iniValue).toBe(expectedTech);

        const tsItem = PRODUCTION_ITEMS.find(i => i.type === type);
        expect(tsItem, `${type} not in PRODUCTION_ITEMS`).toBeDefined();
        expect(tsItem!.techLevel).toBe(iniValue);
      });
    }
  });

  // --- Tech / Superweapon structures ---
  describe('Tech / Superweapon Structure TechLevel', () => {
    const techExpected: [string, number][] = [
      ['ATEK', 10],  // Allied Tech Center
      ['STEK',  6],  // Soviet Tech Center
      ['PDOX', 12],  // Chronosphere
      ['IRON', 12],  // Iron Curtain
      ['MSLO', 13],  // Missile Silo
    ];

    for (const [type, expectedTech] of techExpected) {
      it(`${type} TechLevel=${expectedTech} (rules.ini)`, () => {
        const iniValue = mergedTechLevels[type];
        expect(iniValue, `${type} not found in INI`).toBeDefined();
        expect(iniValue).toBe(expectedTech);

        const tsItem = PRODUCTION_ITEMS.find(i => i.type === type);
        expect(tsItem, `${type} not in PRODUCTION_ITEMS`).toBeDefined();
        expect(tsItem!.techLevel).toBe(iniValue);
      });
    }
  });

  // --- Walls ---
  describe('Wall TechLevel', () => {
    const wallExpected: [string, number][] = [
      ['SBAG', 2],  // Sandbag Wall
      ['FENC', 2],  // Wire Fence
      ['BRIK', 8],  // Concrete Wall
    ];

    for (const [type, expectedTech] of wallExpected) {
      it(`${type} TechLevel=${expectedTech} (rules.ini)`, () => {
        const iniValue = mergedTechLevels[type];
        expect(iniValue, `${type} not found in INI`).toBeDefined();
        expect(iniValue).toBe(expectedTech);

        const tsItem = PRODUCTION_ITEMS.find(i => i.type === type);
        expect(tsItem, `${type} not in PRODUCTION_ITEMS`).toBeDefined();
        expect(tsItem!.techLevel).toBe(iniValue);
      });
    }
  });

  // --- Unbuildable items (TechLevel=-1) ---
  describe('Unbuildable items (TechLevel=-1)', () => {
    it('FACT has TechLevel=-1 in INI (deployed from MCV, not buildable)', () => {
      expect(mergedTechLevels['FACT']).toBe(-1);
      const tsItem = PRODUCTION_ITEMS.find(i => i.type === 'FACT');
      expect(tsItem!.techLevel).toBe(-1);
    });

    it('STNK has TechLevel=-1 in aftrmath.ini (Phase Transport, unbuildable)', () => {
      expect(aftrmathTechLevels['STNK']).toBe(-1);
      const tsItem = PRODUCTION_ITEMS.find(i => i.type === 'STNK');
      expect(tsItem!.techLevel).toBe(-1);
    });
  });

  // --- Comprehensive coverage check ---
  describe('Coverage', () => {
    it('every PRODUCTION_ITEMS entry has a matching INI TechLevel', () => {
      const missing: string[] = [];
      for (const item of PRODUCTION_ITEMS) {
        if (mergedTechLevels[item.type] === undefined) {
          missing.push(item.type);
        }
      }
      expect(missing, `Items missing from INI: ${missing.join(', ')}`).toEqual([]);
    });

    it('every PRODUCTION_ITEMS techLevel matches INI exactly', () => {
      const mismatches: string[] = [];
      for (const item of PRODUCTION_ITEMS) {
        const iniVal = mergedTechLevels[item.type];
        if (iniVal !== undefined && item.techLevel !== iniVal) {
          mismatches.push(
            `${item.type}: TS=${item.techLevel} vs INI=${iniVal}`
          );
        }
      }
      expect(mismatches, `TechLevel mismatches:\n${mismatches.join('\n')}`).toEqual([]);
    });

    it('all 71 PRODUCTION_ITEMS are covered', () => {
      expect(PRODUCTION_ITEMS.length).toBe(71);
    });
  });
});
