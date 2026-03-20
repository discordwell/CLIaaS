/**
 * Production items data parity tests — verify all PRODUCTION_ITEMS entries
 * match C++ RULES.INI values for cost, buildTime, prerequisite, techLevel, faction.
 *
 * buildTime is computed per C++ techno.cpp:6077:
 *   Time_To_Build = Cost * BuildSpeedBias * TICKS_PER_MINUTE / 1000
 * With BuildSpeedBias=0.8, TICKS_PER_MINUTE=900 (15Hz), scaled to 20Hz:
 *   buildTime = floor(Cost * 0.96)
 */
import { describe, it, expect } from 'vitest';
import { getCanonicalProductionItems } from '../engine/rulesIniPipeline';
const PRODUCTION_ITEMS = getCanonicalProductionItems();

/** Compute C++ parity build time: floor(cost * 0.8 * 900 / 1000 * 20/15) */
function cppBuildTime(cost: number): number {
  return Math.floor(cost * 0.8 * 900 / 1000 * 20 / 15);
}

// Expected data for all 70 production items, derived from types.ts PRODUCTION_ITEMS
// which mirrors RULES.INI Cost=, Speed= (buildTime), Prerequisite=, TechLevel=, Owner= values.
// buildTime values use the C++ formula: floor(cost * 0.96)
const EXPECTED_ITEMS: {
  type: string; cost: number; buildTime: number; prerequisite: string;
  faction: string; techLevel?: number; techPrereq?: string; isStructure?: boolean;
}[] = [
  // Infantry (from TENT/BARR)
  { type: 'E1', cost: 100, buildTime: cppBuildTime(100), prerequisite: 'TENT', faction: 'both', techLevel: 1 },
  { type: 'E2', cost: 160, buildTime: cppBuildTime(160), prerequisite: 'BARR', faction: 'soviet', techLevel: 1 },
  { type: 'E3', cost: 300, buildTime: cppBuildTime(300), prerequisite: 'TENT', faction: 'allied', techLevel: 2 },
  { type: 'E4', cost: 300, buildTime: cppBuildTime(300), prerequisite: 'BARR', faction: 'soviet', techLevel: 6, techPrereq: 'STEK' },
  { type: 'E6', cost: 500, buildTime: cppBuildTime(500), prerequisite: 'TENT', faction: 'both', techLevel: 5 },
  { type: 'DOG', cost: 200, buildTime: cppBuildTime(200), prerequisite: 'KENN', faction: 'soviet', techLevel: 3 },
  { type: 'MEDI', cost: 800, buildTime: cppBuildTime(800), prerequisite: 'TENT', faction: 'allied', techLevel: 2 },
  { type: 'SPY', cost: 500, buildTime: cppBuildTime(500), prerequisite: 'TENT', faction: 'allied', techLevel: 6, techPrereq: 'DOME' },
  // Vehicles (from WEAP)
  { type: 'JEEP', cost: 600, buildTime: cppBuildTime(600), prerequisite: 'WEAP', faction: 'allied', techLevel: 3 },
  { type: '1TNK', cost: 700, buildTime: cppBuildTime(700), prerequisite: 'WEAP', faction: 'allied', techLevel: 4 },
  { type: '2TNK', cost: 800, buildTime: cppBuildTime(800), prerequisite: 'WEAP', faction: 'allied', techLevel: 6 },
  { type: '3TNK', cost: 950, buildTime: cppBuildTime(950), prerequisite: 'WEAP', faction: 'soviet', techLevel: 4 },
  { type: '4TNK', cost: 1700, buildTime: cppBuildTime(1700), prerequisite: 'WEAP', faction: 'soviet', techLevel: 10, techPrereq: 'STEK' },
  { type: 'ARTY', cost: 600, buildTime: cppBuildTime(600), prerequisite: 'WEAP', faction: 'allied', techLevel: 8 },
  { type: 'APC', cost: 800, buildTime: cppBuildTime(800), prerequisite: 'WEAP', faction: 'allied', techLevel: 5, techPrereq: 'TENT' },
  { type: 'HARV', cost: 1400, buildTime: cppBuildTime(1400), prerequisite: 'WEAP', faction: 'both', techLevel: 1, techPrereq: 'PROC' },
  // Expansion units
  { type: 'SHOK', cost: 900, buildTime: cppBuildTime(900), prerequisite: 'BARR', faction: 'soviet', techLevel: 7, techPrereq: 'TSLA' },
  { type: 'MECH', cost: 950, buildTime: cppBuildTime(950), prerequisite: 'TENT', faction: 'allied', techLevel: 7, techPrereq: 'FIX' },
  { type: 'STNK', cost: 800, buildTime: cppBuildTime(800), prerequisite: 'WEAP', faction: 'both', techLevel: -1, techPrereq: 'ATEK' },
  { type: 'CTNK', cost: 2400, buildTime: cppBuildTime(2400), prerequisite: 'WEAP', faction: 'allied', techLevel: 12, techPrereq: 'ATEK' },
  { type: 'TTNK', cost: 1500, buildTime: cppBuildTime(1500), prerequisite: 'WEAP', faction: 'soviet', techLevel: 8, techPrereq: 'TSLA' },
  { type: 'QTNK', cost: 2300, buildTime: cppBuildTime(2300), prerequisite: 'WEAP', faction: 'soviet', techLevel: 10, techPrereq: 'STEK' },
  { type: 'DTRK', cost: 2400, buildTime: cppBuildTime(2400), prerequisite: 'MSLO', faction: 'both', techLevel: 13 },
  { type: 'MRJ', cost: 600, buildTime: cppBuildTime(600), prerequisite: 'WEAP', faction: 'allied', techLevel: 12, techPrereq: 'DOME' },
  { type: 'MGG', cost: 600, buildTime: cppBuildTime(600), prerequisite: 'WEAP', faction: 'allied', techLevel: 11, techPrereq: 'ATEK' },
  { type: 'E7', cost: 1200, buildTime: cppBuildTime(1200), prerequisite: 'TENT', faction: 'both', techLevel: 11, techPrereq: 'ATEK' },
  { type: 'THF', cost: 500, buildTime: cppBuildTime(500), prerequisite: 'TENT', faction: 'allied', techLevel: 11, techPrereq: 'ATEK' },
  { type: 'V2RL', cost: 700, buildTime: cppBuildTime(700), prerequisite: 'WEAP', faction: 'soviet', techLevel: 4, techPrereq: 'DOME' },
  { type: 'MNLY', cost: 800, buildTime: cppBuildTime(800), prerequisite: 'WEAP', faction: 'both', techLevel: 3, techPrereq: 'FIX' },
  // Naval (from SYRD/SPEN)
  { type: 'PT', cost: 500, buildTime: cppBuildTime(500), prerequisite: 'SYRD', faction: 'allied', techLevel: 5 },
  { type: 'DD', cost: 1000, buildTime: cppBuildTime(1000), prerequisite: 'SYRD', faction: 'allied', techLevel: 7 },
  { type: 'LST', cost: 700, buildTime: cppBuildTime(700), prerequisite: 'SYRD', faction: 'both', techLevel: 3 },
  { type: 'CA', cost: 2000, buildTime: cppBuildTime(2000), prerequisite: 'SYRD', faction: 'allied', techLevel: 10, techPrereq: 'ATEK' },
  { type: 'SS', cost: 950, buildTime: cppBuildTime(950), prerequisite: 'SPEN', faction: 'soviet', techLevel: 5 },
  { type: 'MSUB', cost: 1650, buildTime: cppBuildTime(1650), prerequisite: 'SPEN', faction: 'soviet', techLevel: 9, techPrereq: 'STEK' },
  // Aircraft (from HPAD/AFLD)
  { type: 'TRAN', cost: 1200, buildTime: cppBuildTime(1200), prerequisite: 'HPAD', faction: 'soviet', techLevel: 11 },
  { type: 'HELI', cost: 1200, buildTime: cppBuildTime(1200), prerequisite: 'HPAD', faction: 'allied', techLevel: 9 },
  { type: 'HIND', cost: 1200, buildTime: cppBuildTime(1200), prerequisite: 'HPAD', faction: 'soviet', techLevel: 9 },
  { type: 'MIG', cost: 1200, buildTime: cppBuildTime(1200), prerequisite: 'AFLD', faction: 'soviet', techLevel: 10 },
  { type: 'YAK', cost: 800, buildTime: cppBuildTime(800), prerequisite: 'AFLD', faction: 'soviet', techLevel: 5 },
  // Structures — base buildings
  { type: 'FACT', cost: 2500, buildTime: cppBuildTime(2500), prerequisite: '', faction: 'both', techLevel: -1, isStructure: true },  // INI TechLevel=-1, not buildable (MCV deploys)
  { type: 'POWR', cost: 300, buildTime: cppBuildTime(300), prerequisite: 'FACT', faction: 'both', techLevel: 1, isStructure: true },
  { type: 'APWR', cost: 500, buildTime: cppBuildTime(500), prerequisite: 'POWR', faction: 'both', techLevel: 8, isStructure: true },
  { type: 'BARR', cost: 300, buildTime: cppBuildTime(300), prerequisite: 'POWR', faction: 'soviet', techLevel: 1, isStructure: true },
  { type: 'TENT', cost: 300, buildTime: cppBuildTime(300), prerequisite: 'POWR', faction: 'allied', techLevel: 1, isStructure: true },
  { type: 'PROC', cost: 2000, buildTime: cppBuildTime(2000), prerequisite: 'POWR', faction: 'both', techLevel: 1, isStructure: true },
  { type: 'WEAP', cost: 2000, buildTime: cppBuildTime(2000), prerequisite: 'PROC', faction: 'both', techLevel: 3, isStructure: true },
  { type: 'SILO', cost: 150, buildTime: cppBuildTime(150), prerequisite: 'PROC', faction: 'both', techLevel: 1, isStructure: true },
  { type: 'DOME', cost: 1000, buildTime: cppBuildTime(1000), prerequisite: 'PROC', faction: 'both', techLevel: 3, isStructure: true },
  { type: 'FIX', cost: 1200, buildTime: cppBuildTime(1200), prerequisite: 'WEAP', faction: 'both', techLevel: 3, isStructure: true },
  { type: 'HPAD', cost: 1500, buildTime: cppBuildTime(1500), prerequisite: 'DOME', faction: 'both', techLevel: 9, isStructure: true },
  { type: 'AFLD', cost: 600, buildTime: cppBuildTime(600), prerequisite: 'DOME', faction: 'soviet', techLevel: 5, isStructure: true },
  // Structures — defenses
  { type: 'PBOX', cost: 400, buildTime: cppBuildTime(400), prerequisite: 'TENT', faction: 'allied', techLevel: 2, isStructure: true },
  { type: 'HBOX', cost: 600, buildTime: cppBuildTime(600), prerequisite: 'TENT', faction: 'allied', techLevel: 3, isStructure: true },
  { type: 'GUN', cost: 600, buildTime: cppBuildTime(600), prerequisite: 'TENT', faction: 'allied', techLevel: 4, isStructure: true },
  { type: 'AGUN', cost: 600, buildTime: cppBuildTime(600), prerequisite: 'DOME', faction: 'allied', techLevel: 5, isStructure: true },
  { type: 'GAP', cost: 500, buildTime: cppBuildTime(500), prerequisite: 'ATEK', faction: 'allied', techLevel: 10, isStructure: true },
  { type: 'FTUR', cost: 600, buildTime: cppBuildTime(600), prerequisite: 'BARR', faction: 'soviet', techLevel: 2, isStructure: true },
  { type: 'TSLA', cost: 1500, buildTime: cppBuildTime(1500), prerequisite: 'WEAP', faction: 'soviet', techLevel: 7, isStructure: true },
  { type: 'SAM', cost: 750, buildTime: cppBuildTime(750), prerequisite: 'DOME', faction: 'soviet', techLevel: 9, isStructure: true },
  { type: 'KENN', cost: 200, buildTime: cppBuildTime(200), prerequisite: 'BARR', faction: 'soviet', techLevel: 3, isStructure: true },
  // Structures — naval
  { type: 'SYRD', cost: 650, buildTime: cppBuildTime(650), prerequisite: 'POWR', faction: 'allied', techLevel: 3, isStructure: true },
  { type: 'SPEN', cost: 650, buildTime: cppBuildTime(650), prerequisite: 'POWR', faction: 'soviet', techLevel: 3, isStructure: true },
  // Structures — tech/superweapon
  { type: 'ATEK', cost: 1500, buildTime: cppBuildTime(1500), prerequisite: 'WEAP', faction: 'allied', techLevel: 10, isStructure: true, techPrereq: 'DOME' },
  { type: 'STEK', cost: 1500, buildTime: cppBuildTime(1500), prerequisite: 'WEAP', faction: 'soviet', techLevel: 6, isStructure: true, techPrereq: 'DOME' },
  { type: 'PDOX', cost: 2800, buildTime: cppBuildTime(2800), prerequisite: 'ATEK', faction: 'allied', techLevel: 12, isStructure: true },
  { type: 'IRON', cost: 2800, buildTime: cppBuildTime(2800), prerequisite: 'STEK', faction: 'soviet', techLevel: 12, isStructure: true },
  { type: 'MSLO', cost: 2500, buildTime: cppBuildTime(2500), prerequisite: 'STEK', faction: 'both', techLevel: 13, isStructure: true },
  // Walls
  { type: 'SBAG', cost: 25, buildTime: cppBuildTime(25), prerequisite: 'FACT', faction: 'allied', techLevel: 2, isStructure: true },
  { type: 'FENC', cost: 25, buildTime: cppBuildTime(25), prerequisite: 'FACT', faction: 'soviet', techLevel: 2, isStructure: true },
  { type: 'BRIK', cost: 100, buildTime: cppBuildTime(100), prerequisite: 'FACT', faction: 'both', techLevel: 8, isStructure: true },
];

describe('PRODUCTION_ITEMS full parity', () => {
  it(`total count = ${EXPECTED_ITEMS.length}`, () => {
    expect(PRODUCTION_ITEMS).toHaveLength(EXPECTED_ITEMS.length);
  });

  for (const exp of EXPECTED_ITEMS) {
    it(`${exp.type} — cost=${exp.cost}, buildTime=${exp.buildTime}, faction=${exp.faction}`, () => {
      const item = PRODUCTION_ITEMS.find(i => i.type === exp.type);
      expect(item, `${exp.type} should exist in PRODUCTION_ITEMS`).toBeDefined();
      expect(item!.cost).toBe(exp.cost);
      expect(item!.buildTime).toBe(exp.buildTime);
      expect(item!.prerequisite).toBe(exp.prerequisite);
      expect(item!.faction).toBe(exp.faction);
      if (exp.techLevel !== undefined) {
        expect(item!.techLevel).toBe(exp.techLevel);
      }
      if (exp.techPrereq !== undefined) {
        expect(item!.techPrereq).toBe(exp.techPrereq);
      }
      if (exp.isStructure !== undefined) {
        expect(item!.isStructure).toBe(exp.isStructure);
      }
    });
  }

  it('no duplicate types in PRODUCTION_ITEMS', () => {
    const types = PRODUCTION_ITEMS.map(i => i.type);
    const unique = new Set(types);
    expect(unique.size).toBe(types.length);
  });

  it('every PRODUCTION_ITEMS entry is covered by expected data', () => {
    const expectedTypes = new Set(EXPECTED_ITEMS.map(e => e.type));
    for (const item of PRODUCTION_ITEMS) {
      expect(expectedTypes.has(item.type), `${item.type} should be in expected data`).toBe(true);
    }
  });
});
