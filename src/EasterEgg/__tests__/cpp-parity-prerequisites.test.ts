/**
 * C++ → TS behavioral parity: Production prerequisites (tech tree)
 *
 * Source of truth:
 *   rules.ini  — /public/ra/assets/rules.ini   (Prerequisite=, TechLevel=, Owner=, Cost=)
 *   aftrmath.ini — /public/ra/assets/aftrmath.ini (expansion overrides)
 *   techno.cpp:6283 — Prerequisite = ini.Get_Buildings(Name(), "Prerequisite", Prerequisite)
 *   techno.cpp:6286 — Level = ini.Get_Int(Name(), "TechLevel", Level)
 *   techno.cpp:6288 — Cost = ini.Get_Int(Name(), "Cost", Cost)
 *   techno.cpp:6291 — Ownable = ini.Get_Owners(Name(), "Owner", Ownable)
 *
 * TS model:
 *   ProductionItem.prerequisite — primary building (factory or first prereq in Prerequisite= list)
 *   ProductionItem.techPrereq   — additional building (second entry in Prerequisite= list)
 *   ProductionItem.techLevel    — rules.ini TechLevel=
 *   ProductionItem.faction      — 'allied' | 'soviet' | 'both' derived from Owner=
 *   ProductionItem.cost         — rules.ini Cost=
 *
 * For units, `prerequisite` doubles as the factory building:
 *   Infantry → TENT (allied) or BARR (soviet)
 *   Vehicles → WEAP
 *   Naval    → SYRD (allied) or SPEN (soviet)
 *   Aircraft → HPAD or AFLD
 * The rules.ini Prerequisite= field lists ADDITIONAL buildings beyond the factory.
 * When rules.ini has Prerequisite=weap,dome, the TS has prerequisite='WEAP', techPrereq='DOME'.
 * When rules.ini has Prerequisite=atek (for a vehicle), the TS has prerequisite='WEAP', techPrereq='ATEK'.
 *
 * techno.cpp:6050-6056 — DoubleOwned only applies in multiplayer (Session.Type != GAME_NORMAL).
 *   In campaign mode, Owner= is the definitive faction list.
 */

import { describe, it, expect } from 'vitest';
import { PRODUCTION_ITEMS, type ProductionItem } from '../engine/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build lookup: type → ProductionItem */
const itemByType = new Map<string, ProductionItem>();
for (const item of PRODUCTION_ITEMS) {
  itemByType.set(item.type, item);
}

function getItem(type: string): ProductionItem {
  const item = itemByType.get(type);
  if (!item) throw new Error(`PRODUCTION_ITEMS missing type: ${type}`);
  return item;
}

/**
 * Convert rules.ini Owner= to TS faction.
 * 'allies' → 'allied', 'soviet' → 'soviet', 'allies,soviet' | 'soviet,allies' → 'both'
 */
function ownerToFaction(owner: string): 'allied' | 'soviet' | 'both' {
  const parts = owner.toLowerCase().split(',').map(s => s.trim()).sort();
  if (parts.length === 2 && parts.includes('allies') && parts.includes('soviet')) return 'both';
  if (parts.length === 1 && parts[0] === 'allies') return 'allied';
  if (parts.length === 1 && parts[0] === 'soviet') return 'soviet';
  throw new Error(`Unexpected Owner= value: ${owner}`);
}

// ── Expected data from rules.ini / aftrmath.ini ─────────────────────────────
// Each entry: [type, prerequisite, techPrereq | undefined, techLevel, faction(from Owner=), cost]
// The prerequisite is the TS model's primary building (factory + first prereq).
// The techPrereq is the second building in the rules.ini Prerequisite= list.

/** Infantry — rules.ini infantry sections
 * Infantry have no factory in Prerequisite=; the TS uses TENT/BARR as prerequisite.
 * C++ rules.ini: E1 has no Prerequisite=, E4 has Prerequisite=stek, etc.
 */
const INFANTRY_EXPECTED: [string, string, string | undefined, number, string, number][] = [
  // [type, prerequisite, techPrereq, techLevel, owner, cost]
  // rules.ini [E1]: no Prerequisite, TechLevel=1, Owner=allies,soviet, Cost=100
  ['E1', 'TENT', undefined, 1, 'allies,soviet', 100],
  // rules.ini [E2]: no Prerequisite, TechLevel=1, Owner=soviet, Cost=160
  ['E2', 'BARR', undefined, 1, 'soviet', 160],
  // rules.ini [E3]: no Prerequisite, TechLevel=2, Owner=allies, Cost=300
  ['E3', 'TENT', undefined, 2, 'allies', 300],
  // rules.ini [E4]: Prerequisite=stek, TechLevel=6, Owner=soviet, Cost=300
  ['E4', 'BARR', 'STEK', 6, 'soviet', 300],
  // rules.ini [E6]: no Prerequisite, TechLevel=5, Owner=soviet,allies, Cost=500
  ['E6', 'TENT', undefined, 5, 'allies,soviet', 500],
  // rules.ini [DOG]: Prerequisite=kenn, TechLevel=3, Owner=soviet, Cost=200
  ['DOG', 'KENN', undefined, 3, 'soviet', 200],
  // rules.ini [MEDI]: no Prerequisite, TechLevel=2, Owner=allies, Cost=800
  ['MEDI', 'TENT', undefined, 2, 'allies', 800],
  // rules.ini [SPY]: Prerequisite=dome, TechLevel=6, Owner=allies, Cost=500
  ['SPY', 'TENT', 'DOME', 6, 'allies', 500],
  // rules.ini [E7]: Prerequisite=atek, TechLevel=11, Owner=allies,soviet, Cost=1200
  ['E7', 'TENT', 'ATEK', 11, 'allies,soviet', 1200],
  // rules.ini [THF]: Prerequisite=atek, TechLevel=11, Owner=allies, Cost=500
  ['THF', 'TENT', 'ATEK', 11, 'allies', 500],
  // aftrmath.ini [SHOK]: Prerequisite=tsla, TechLevel=7, Owner=soviet, Cost=900
  ['SHOK', 'BARR', 'TSLA', 7, 'soviet', 900],
  // aftrmath.ini [MECH]: Prerequisite=fix, TechLevel=7, Owner=allies, Cost=950
  ['MECH', 'TENT', 'FIX', 7, 'allies', 950],
];

/** Vehicles — rules.ini vehicle sections
 * Vehicles use WEAP as factory. rules.ini Prerequisite= lists additional buildings.
 * E.g. V2RL: Prerequisite=weap,dome → TS prerequisite='WEAP', techPrereq='DOME'
 */
const VEHICLE_EXPECTED: [string, string, string | undefined, number, string, number][] = [
  // rules.ini [JEEP]: Prerequisite=weap, TechLevel=3, Owner=allies, Cost=600
  ['JEEP', 'WEAP', undefined, 3, 'allies', 600],
  // rules.ini [1TNK]: Prerequisite=weap, TechLevel=4, Owner=allies, Cost=700
  ['1TNK', 'WEAP', undefined, 4, 'allies', 700],
  // rules.ini [2TNK]: Prerequisite=weap, TechLevel=6, Owner=allies, Cost=800
  ['2TNK', 'WEAP', undefined, 6, 'allies', 800],
  // rules.ini [3TNK]: Prerequisite=weap, TechLevel=4, Owner=soviet, Cost=950
  ['3TNK', 'WEAP', undefined, 4, 'soviet', 950],
  // rules.ini [4TNK]: Prerequisite=weap,stek, TechLevel=10, Owner=soviet, Cost=1700
  ['4TNK', 'WEAP', 'STEK', 10, 'soviet', 1700],
  // rules.ini [V2RL]: Prerequisite=weap,dome, TechLevel=4, Owner=soviet, Cost=700
  ['V2RL', 'WEAP', 'DOME', 4, 'soviet', 700],
  // rules.ini [ARTY]: Prerequisite=weap, TechLevel=8, Owner=allies, Cost=600
  ['ARTY', 'WEAP', undefined, 8, 'allies', 600],
  // rules.ini [APC]: Prerequisite=weap,tent, TechLevel=5, Owner=allies, Cost=800
  ['APC', 'WEAP', 'TENT', 5, 'allies', 800],
  // rules.ini [HARV]: Prerequisite=weap,proc, TechLevel=1, Owner=allies,soviet, Cost=1400
  ['HARV', 'WEAP', 'PROC', 1, 'allies,soviet', 1400],
  // rules.ini [MRJ]: Prerequisite=weap,dome, TechLevel=12, Owner=allies, Cost=600
  ['MRJ', 'WEAP', 'DOME', 12, 'allies', 600],
  // rules.ini [MGG]: Prerequisite=weap,atek, TechLevel=11, Owner=allies, Cost=600
  ['MGG', 'WEAP', 'ATEK', 11, 'allies', 600],
  // rules.ini [MNLY]: Prerequisite=weap,fix, TechLevel=3, Owner=allies,soviet, Cost=800
  ['MNLY', 'WEAP', 'FIX', 3, 'allies,soviet', 800],
  // aftrmath.ini [STNK]: Prerequisite=weap,atek, TechLevel=-1, Owner=allies,soviet, Cost=800
  ['STNK', 'WEAP', 'ATEK', -1, 'allies,soviet', 800],
  // aftrmath.ini [CTNK]: Prerequisite=atek, TechLevel=12, Owner=allies, Cost=2400
  // TS maps as: prerequisite=WEAP (vehicle factory), techPrereq=ATEK (from Prerequisite= field)
  ['CTNK', 'WEAP', 'ATEK', 12, 'allies', 2400],
  // aftrmath.ini [TTNK]: Prerequisite=tsla, TechLevel=8, Owner=soviet, Cost=1500
  // TS maps as: prerequisite=WEAP (vehicle factory), techPrereq=TSLA
  ['TTNK', 'WEAP', 'TSLA', 8, 'soviet', 1500],
  // aftrmath.ini [QTNK]: Prerequisite=stek, TechLevel=10, Owner=soviet, Cost=2300
  // TS maps as: prerequisite=WEAP (vehicle factory), techPrereq=STEK
  ['QTNK', 'WEAP', 'STEK', 10, 'soviet', 2300],
  // aftrmath.ini [DTRK]: Prerequisite=mslo, TechLevel=13, Owner=allies,soviet, Cost=2400
  // TS maps MSLO as sole prerequisite (no WEAP factory needed — special case)
  ['DTRK', 'MSLO', undefined, 13, 'allies,soviet', 2400],
];

/** Naval units — rules.ini vessel sections
 * Allied naval → SYRD factory, Soviet naval → SPEN factory.
 * LST has no Prerequisite= in rules.ini but TS assigns SYRD.
 */
const NAVAL_EXPECTED: [string, string, string | undefined, number, string, number][] = [
  // rules.ini [PT]: Prerequisite=syrd, TechLevel=5, Owner=allies, Cost=500
  ['PT', 'SYRD', undefined, 5, 'allies', 500],
  // rules.ini [DD]: Prerequisite=syrd, TechLevel=7, Owner=allies, Cost=1000
  ['DD', 'SYRD', undefined, 7, 'allies', 1000],
  // rules.ini [LST]: no Prerequisite, TechLevel=3, Owner=allies,soviet, Cost=700
  // TS assigns SYRD as factory — this is a TS design choice since naval units need a yard
  ['LST', 'SYRD', undefined, 3, 'allies,soviet', 700],
  // rules.ini [CA]: Prerequisite=syrd,atek, TechLevel=10, Owner=allies, Cost=2000
  ['CA', 'SYRD', 'ATEK', 10, 'allies', 2000],
  // rules.ini [SS]: Prerequisite=spen, TechLevel=5, Owner=soviet, Cost=950
  ['SS', 'SPEN', undefined, 5, 'soviet', 950],
  // aftrmath.ini [MSUB]: Prerequisite=stek, TechLevel=9, Owner=soviet, Cost=1650
  // TS maps as: prerequisite=SPEN (Soviet naval factory), techPrereq=STEK
  ['MSUB', 'SPEN', 'STEK', 9, 'soviet', 1650],
];

/** Aircraft — rules.ini aircraft sections
 * HPAD → helicopters (TRAN, HELI, HIND), AFLD → fixed-wing (MIG, YAK)
 */
const AIRCRAFT_EXPECTED: [string, string, string | undefined, number, string, number][] = [
  // rules.ini [TRAN]: Prerequisite=hpad, TechLevel=11, Owner=soviet, Cost=1200
  ['TRAN', 'HPAD', undefined, 11, 'soviet', 1200],
  // rules.ini [HELI]: Prerequisite=hpad, TechLevel=9, Owner=allies, Cost=1200
  ['HELI', 'HPAD', undefined, 9, 'allies', 1200],
  // rules.ini [HIND]: Prerequisite=hpad, TechLevel=9, Owner=soviet, Cost=1200
  ['HIND', 'HPAD', undefined, 9, 'soviet', 1200],
  // rules.ini [MIG]: Prerequisite=afld, TechLevel=10, Owner=soviet, Cost=1200
  ['MIG', 'AFLD', undefined, 10, 'soviet', 1200],
  // rules.ini [YAK]: Prerequisite=afld, TechLevel=5, Owner=soviet, Cost=800
  ['YAK', 'AFLD', undefined, 5, 'soviet', 800],
];

/** Structures — rules.ini building sections
 * prerequisite = first building in Prerequisite= list (or '' for FACT)
 * techPrereq = second building in Prerequisite= list (if any)
 */
const STRUCTURE_EXPECTED: [string, string, string | undefined, number, string, number][] = [
  // rules.ini [FACT]: no Prerequisite, TechLevel=-1, Owner=allies,soviet, Cost=2500
  ['FACT', '', undefined, -1, 'allies,soviet', 2500],
  // rules.ini [POWR]: Prerequisite=fact, TechLevel=1, Owner=allies,soviet, Cost=300
  ['POWR', 'FACT', undefined, 1, 'allies,soviet', 300],
  // rules.ini [APWR]: Prerequisite=powr, TechLevel=8, Owner=allies,soviet, Cost=500
  ['APWR', 'POWR', undefined, 8, 'allies,soviet', 500],
  // rules.ini [BARR]: Prerequisite=powr, TechLevel=1, Owner=soviet, Cost=300
  ['BARR', 'POWR', undefined, 1, 'soviet', 300],
  // rules.ini [TENT]: Prerequisite=powr, TechLevel=1, Owner=allies, Cost=300
  ['TENT', 'POWR', undefined, 1, 'allies', 300],
  // rules.ini [PROC]: Prerequisite=powr, TechLevel=1, Owner=allies,soviet, Cost=2000
  ['PROC', 'POWR', undefined, 1, 'allies,soviet', 2000],
  // rules.ini [WEAP]: Prerequisite=proc, TechLevel=3, Owner=soviet,allies, Cost=2000
  ['WEAP', 'PROC', undefined, 3, 'allies,soviet', 2000],
  // rules.ini [SILO]: Prerequisite=proc, TechLevel=1, Owner=allies,soviet, Cost=150
  ['SILO', 'PROC', undefined, 1, 'allies,soviet', 150],
  // rules.ini [DOME]: Prerequisite=proc, TechLevel=3, Owner=allies,soviet, Cost=1000
  ['DOME', 'PROC', undefined, 3, 'allies,soviet', 1000],
  // rules.ini [FIX]: Prerequisite=weap, TechLevel=3, Owner=allies,soviet, Cost=1200
  ['FIX', 'WEAP', undefined, 3, 'allies,soviet', 1200],
  // rules.ini [HPAD]: Prerequisite=dome, TechLevel=9, Owner=allies,soviet, Cost=1500
  ['HPAD', 'DOME', undefined, 9, 'allies,soviet', 1500],
  // rules.ini [AFLD]: Prerequisite=dome, TechLevel=5, Owner=soviet, Cost=600
  ['AFLD', 'DOME', undefined, 5, 'soviet', 600],
  // rules.ini [PBOX]: Prerequisite=tent, TechLevel=2, Owner=allies, Cost=400
  ['PBOX', 'TENT', undefined, 2, 'allies', 400],
  // rules.ini [HBOX]: Prerequisite=tent, TechLevel=3, Owner=allies, Cost=600
  ['HBOX', 'TENT', undefined, 3, 'allies', 600],
  // rules.ini [GUN]: Prerequisite=tent, TechLevel=4, Owner=allies, Cost=600
  ['GUN', 'TENT', undefined, 4, 'allies', 600],
  // rules.ini [AGUN]: Prerequisite=dome, TechLevel=5, Owner=allies, Cost=600
  ['AGUN', 'DOME', undefined, 5, 'allies', 600],
  // rules.ini [GAP]: Prerequisite=atek, TechLevel=10, Owner=allies, Cost=500
  ['GAP', 'ATEK', undefined, 10, 'allies', 500],
  // rules.ini [FTUR]: Prerequisite=barr, TechLevel=2, Owner=soviet, Cost=600
  ['FTUR', 'BARR', undefined, 2, 'soviet', 600],
  // rules.ini [TSLA]: Prerequisite=weap, TechLevel=7, Owner=soviet, Cost=1500
  ['TSLA', 'WEAP', undefined, 7, 'soviet', 1500],
  // rules.ini [SAM]: Prerequisite=dome, TechLevel=9, Owner=soviet, Cost=750
  ['SAM', 'DOME', undefined, 9, 'soviet', 750],
  // rules.ini [KENN]: Prerequisite=barr, TechLevel=3, Owner=soviet, Cost=200
  ['KENN', 'BARR', undefined, 3, 'soviet', 200],
  // rules.ini [SYRD]: Prerequisite=powr, TechLevel=3, Owner=allies, Cost=650
  ['SYRD', 'POWR', undefined, 3, 'allies', 650],
  // rules.ini [SPEN]: Prerequisite=powr, TechLevel=3, Owner=soviet, Cost=650
  ['SPEN', 'POWR', undefined, 3, 'soviet', 650],
  // rules.ini [ATEK]: Prerequisite=weap,dome, TechLevel=10, Owner=allies, Cost=1500
  ['ATEK', 'WEAP', 'DOME', 10, 'allies', 1500],
  // rules.ini [STEK]: Prerequisite=weap,dome, TechLevel=6, Owner=soviet, Cost=1500
  ['STEK', 'WEAP', 'DOME', 6, 'soviet', 1500],
  // rules.ini [PDOX]: Prerequisite=atek, TechLevel=12, Owner=allies, Cost=2800
  ['PDOX', 'ATEK', undefined, 12, 'allies', 2800],
  // rules.ini [IRON]: Prerequisite=stek, TechLevel=12, Owner=soviet, Cost=2800
  ['IRON', 'STEK', undefined, 12, 'soviet', 2800],
  // rules.ini [MSLO]: Prerequisite=stek, TechLevel=13, Owner=soviet,allies, Cost=2500
  ['MSLO', 'STEK', undefined, 13, 'allies,soviet', 2500],
];

/** Walls — rules.ini wall sections
 * Walls have no Prerequisite= in rules.ini; TS assigns FACT (construction yard).
 */
const WALL_EXPECTED: [string, string, string | undefined, number, string, number][] = [
  // rules.ini [SBAG]: no Prerequisite, TechLevel=2, Owner=allies, Cost=25
  ['SBAG', 'FACT', undefined, 2, 'allies', 25],
  // rules.ini [FENC]: no Prerequisite, TechLevel=2, Owner=soviet, Cost=25
  ['FENC', 'FACT', undefined, 2, 'soviet', 25],
  // rules.ini [BRIK]: no Prerequisite, TechLevel=8, Owner=allies,soviet, Cost=100
  ['BRIK', 'FACT', undefined, 8, 'allies,soviet', 100],
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('C++ parity: Production prerequisites (tech tree)', () => {

  describe('PRODUCTION_ITEMS coverage', () => {
    it('should contain all expected unit and structure types', () => {
      const allExpected = [
        ...INFANTRY_EXPECTED,
        ...VEHICLE_EXPECTED,
        ...NAVAL_EXPECTED,
        ...AIRCRAFT_EXPECTED,
        ...STRUCTURE_EXPECTED,
        ...WALL_EXPECTED,
      ];
      for (const [type] of allExpected) {
        expect(itemByType.has(type), `PRODUCTION_ITEMS should include ${type}`).toBe(true);
      }
    });
  });

  describe('Infantry prerequisites — rules.ini + aftrmath.ini', () => {
    it.each(INFANTRY_EXPECTED)(
      '%s: prerequisite, techPrereq, techLevel, faction, cost match rules.ini',
      (type, expectedPrereq, expectedTechPrereq, expectedTechLevel, owner, expectedCost) => {
        const item = getItem(type);
        const expectedFaction = ownerToFaction(owner);
        expect(item.prerequisite, `${type} prerequisite`).toBe(expectedPrereq);
        expect(item.techPrereq, `${type} techPrereq`).toBe(expectedTechPrereq);
        expect(item.techLevel, `${type} techLevel`).toBe(expectedTechLevel);
        expect(item.faction, `${type} faction`).toBe(expectedFaction);
        expect(item.cost, `${type} cost`).toBe(expectedCost);
      },
    );
  });

  describe('Vehicle prerequisites — rules.ini + aftrmath.ini', () => {
    it.each(VEHICLE_EXPECTED)(
      '%s: prerequisite, techPrereq, techLevel, faction, cost match rules.ini',
      (type, expectedPrereq, expectedTechPrereq, expectedTechLevel, owner, expectedCost) => {
        const item = getItem(type);
        const expectedFaction = ownerToFaction(owner);
        expect(item.prerequisite, `${type} prerequisite`).toBe(expectedPrereq);
        expect(item.techPrereq, `${type} techPrereq`).toBe(expectedTechPrereq);
        expect(item.techLevel, `${type} techLevel`).toBe(expectedTechLevel);
        expect(item.faction, `${type} faction`).toBe(expectedFaction);
        expect(item.cost, `${type} cost`).toBe(expectedCost);
      },
    );
  });

  describe('Naval prerequisites — rules.ini + aftrmath.ini', () => {
    it.each(NAVAL_EXPECTED)(
      '%s: prerequisite, techPrereq, techLevel, faction, cost match rules.ini',
      (type, expectedPrereq, expectedTechPrereq, expectedTechLevel, owner, expectedCost) => {
        const item = getItem(type);
        const expectedFaction = ownerToFaction(owner);
        expect(item.prerequisite, `${type} prerequisite`).toBe(expectedPrereq);
        expect(item.techPrereq, `${type} techPrereq`).toBe(expectedTechPrereq);
        expect(item.techLevel, `${type} techLevel`).toBe(expectedTechLevel);
        expect(item.faction, `${type} faction`).toBe(expectedFaction);
        expect(item.cost, `${type} cost`).toBe(expectedCost);
      },
    );
  });

  describe('Aircraft prerequisites — rules.ini', () => {
    it.each(AIRCRAFT_EXPECTED)(
      '%s: prerequisite, techPrereq, techLevel, faction, cost match rules.ini',
      (type, expectedPrereq, expectedTechPrereq, expectedTechLevel, owner, expectedCost) => {
        const item = getItem(type);
        const expectedFaction = ownerToFaction(owner);
        expect(item.prerequisite, `${type} prerequisite`).toBe(expectedPrereq);
        expect(item.techPrereq, `${type} techPrereq`).toBe(expectedTechPrereq);
        expect(item.techLevel, `${type} techLevel`).toBe(expectedTechLevel);
        expect(item.faction, `${type} faction`).toBe(expectedFaction);
        expect(item.cost, `${type} cost`).toBe(expectedCost);
      },
    );
  });

  describe('Structure prerequisites — rules.ini', () => {
    it.each(STRUCTURE_EXPECTED)(
      '%s: prerequisite, techPrereq, techLevel, faction, cost match rules.ini',
      (type, expectedPrereq, expectedTechPrereq, expectedTechLevel, owner, expectedCost) => {
        const item = getItem(type);
        const expectedFaction = ownerToFaction(owner);
        expect(item.prerequisite, `${type} prerequisite`).toBe(expectedPrereq);
        expect(item.techPrereq, `${type} techPrereq`).toBe(expectedTechPrereq);
        expect(item.techLevel, `${type} techLevel`).toBe(expectedTechLevel);
        expect(item.faction, `${type} faction`).toBe(expectedFaction);
        expect(item.cost, `${type} cost`).toBe(expectedCost);
      },
    );
  });

  describe('Wall prerequisites — rules.ini', () => {
    it.each(WALL_EXPECTED)(
      '%s: prerequisite, techPrereq, techLevel, faction, cost match rules.ini',
      (type, expectedPrereq, expectedTechPrereq, expectedTechLevel, owner, expectedCost) => {
        const item = getItem(type);
        const expectedFaction = ownerToFaction(owner);
        expect(item.prerequisite, `${type} prerequisite`).toBe(expectedPrereq);
        expect(item.techPrereq, `${type} techPrereq`).toBe(expectedTechPrereq);
        expect(item.techLevel, `${type} techLevel`).toBe(expectedTechLevel);
        expect(item.faction, `${type} faction`).toBe(expectedFaction);
        expect(item.cost, `${type} cost`).toBe(expectedCost);
      },
    );
  });

  describe('Structures have isStructure flag', () => {
    const structureTypes = [...STRUCTURE_EXPECTED, ...WALL_EXPECTED].map(([type]) => type);
    it.each(structureTypes)('%s should have isStructure=true', (type) => {
      expect(getItem(type).isStructure, `${type} isStructure`).toBe(true);
    });

    const unitTypes = [
      ...INFANTRY_EXPECTED,
      ...VEHICLE_EXPECTED,
      ...NAVAL_EXPECTED,
      ...AIRCRAFT_EXPECTED,
    ].map(([type]) => type);
    it.each(unitTypes)('%s should NOT have isStructure=true', (type) => {
      expect(getItem(type).isStructure ?? false, `${type} isStructure`).toBe(false);
    });
  });

  describe('Tech tree dependency chains', () => {
    it('Allied base chain: FACT → POWR → PROC → WEAP', () => {
      expect(getItem('FACT').prerequisite).toBe('');
      expect(getItem('POWR').prerequisite).toBe('FACT');
      expect(getItem('PROC').prerequisite).toBe('POWR');
      expect(getItem('WEAP').prerequisite).toBe('PROC');
    });

    it('Allied tech chain: WEAP+DOME → ATEK → PDOX', () => {
      const atek = getItem('ATEK');
      expect(atek.prerequisite).toBe('WEAP');
      expect(atek.techPrereq).toBe('DOME');
      expect(getItem('PDOX').prerequisite).toBe('ATEK');
    });

    it('Soviet tech chain: WEAP+DOME → STEK → IRON', () => {
      const stek = getItem('STEK');
      expect(stek.prerequisite).toBe('WEAP');
      expect(stek.techPrereq).toBe('DOME');
      expect(getItem('IRON').prerequisite).toBe('STEK');
    });

    it('Soviet tech chain: STEK → MSLO (missile silo for nukes)', () => {
      expect(getItem('MSLO').prerequisite).toBe('STEK');
    });

    it('Allied defense chain: TENT → PBOX/HBOX/GUN', () => {
      expect(getItem('PBOX').prerequisite).toBe('TENT');
      expect(getItem('HBOX').prerequisite).toBe('TENT');
      expect(getItem('GUN').prerequisite).toBe('TENT');
    });

    it('Soviet defense chain: BARR → FTUR, WEAP → TSLA', () => {
      expect(getItem('FTUR').prerequisite).toBe('BARR');
      expect(getItem('TSLA').prerequisite).toBe('WEAP');
    });

    it('Kennel chain: BARR → KENN → DOG', () => {
      expect(getItem('KENN').prerequisite).toBe('BARR');
      expect(getItem('DOG').prerequisite).toBe('KENN');
    });

    it('Naval chains: POWR → SYRD/SPEN', () => {
      expect(getItem('SYRD').prerequisite).toBe('POWR');
      expect(getItem('SPEN').prerequisite).toBe('POWR');
    });

    it('Helicopter chain: DOME → HPAD → HELI/HIND/TRAN', () => {
      expect(getItem('HPAD').prerequisite).toBe('DOME');
      expect(getItem('HELI').prerequisite).toBe('HPAD');
      expect(getItem('HIND').prerequisite).toBe('HPAD');
      expect(getItem('TRAN').prerequisite).toBe('HPAD');
    });

    it('Airfield chain: DOME → AFLD → MIG/YAK', () => {
      expect(getItem('AFLD').prerequisite).toBe('DOME');
      expect(getItem('MIG').prerequisite).toBe('AFLD');
      expect(getItem('YAK').prerequisite).toBe('AFLD');
    });
  });

  describe('Aftermath expansion units use aftrmath.ini values', () => {
    it('SHOK (Shock Trooper): Prerequisite=tsla, TechLevel=7', () => {
      const item = getItem('SHOK');
      // aftrmath.ini [SHOK]: Prerequisite=tsla, TechLevel=7, Owner=soviet, Cost=900
      expect(item.techPrereq).toBe('TSLA');
      expect(item.techLevel).toBe(7);
      expect(item.faction).toBe('soviet');
      expect(item.cost).toBe(900);
    });

    it('MECH (Mechanic): Prerequisite=fix, TechLevel=7', () => {
      const item = getItem('MECH');
      // aftrmath.ini [MECH]: Prerequisite=fix, TechLevel=7, Owner=allies, Cost=950
      expect(item.techPrereq).toBe('FIX');
      expect(item.techLevel).toBe(7);
      expect(item.faction).toBe('allied');
      expect(item.cost).toBe(950);
    });

    it('STNK (Phase Transport): Prerequisite=weap,atek, TechLevel=-1', () => {
      const item = getItem('STNK');
      // aftrmath.ini [STNK]: Prerequisite=weap,atek, TechLevel=-1, Owner=allies,soviet, Cost=800
      expect(item.prerequisite).toBe('WEAP');
      expect(item.techPrereq).toBe('ATEK');
      expect(item.techLevel).toBe(-1);
      expect(item.faction).toBe('both');
      expect(item.cost).toBe(800);
    });

    it('CTNK (Chrono Tank): Prerequisite=atek, TechLevel=12', () => {
      const item = getItem('CTNK');
      // aftrmath.ini [CTNK]: Prerequisite=atek, TechLevel=12, Owner=allies, Cost=2400
      // TS maps: WEAP (factory) + ATEK (prerequisite)
      expect(item.prerequisite).toBe('WEAP');
      expect(item.techPrereq).toBe('ATEK');
      expect(item.techLevel).toBe(12);
      expect(item.faction).toBe('allied');
      expect(item.cost).toBe(2400);
    });

    it('TTNK (Tesla Tank): Prerequisite=tsla, TechLevel=8', () => {
      const item = getItem('TTNK');
      // aftrmath.ini [TTNK]: Prerequisite=tsla, TechLevel=8, Owner=soviet, Cost=1500
      expect(item.prerequisite).toBe('WEAP');
      expect(item.techPrereq).toBe('TSLA');
      expect(item.techLevel).toBe(8);
      expect(item.faction).toBe('soviet');
      expect(item.cost).toBe(1500);
    });

    it('QTNK (M.A.D. Tank): Prerequisite=stek, TechLevel=10', () => {
      const item = getItem('QTNK');
      // aftrmath.ini [QTNK]: Prerequisite=stek, TechLevel=10, Owner=soviet, Cost=2300
      expect(item.prerequisite).toBe('WEAP');
      expect(item.techPrereq).toBe('STEK');
      expect(item.techLevel).toBe(10);
      expect(item.faction).toBe('soviet');
      expect(item.cost).toBe(2300);
    });

    it('DTRK (Demo Truck): Prerequisite=mslo, TechLevel=13', () => {
      const item = getItem('DTRK');
      // aftrmath.ini [DTRK]: Prerequisite=mslo, TechLevel=13, Owner=allies,soviet, Cost=2400
      expect(item.prerequisite).toBe('MSLO');
      expect(item.techLevel).toBe(13);
      expect(item.faction).toBe('both');
      expect(item.cost).toBe(2400);
    });

    it('MSUB (Missile Sub): Prerequisite=stek, TechLevel=9', () => {
      const item = getItem('MSUB');
      // aftrmath.ini [MSUB]: Prerequisite=stek, TechLevel=9, Owner=soviet, Cost=1650
      expect(item.prerequisite).toBe('SPEN');
      expect(item.techPrereq).toBe('STEK');
      expect(item.techLevel).toBe(9);
      expect(item.faction).toBe('soviet');
      expect(item.cost).toBe(1650);
    });
  });

  describe('buildTime computed from cost via C++ formula', () => {
    // techno.cpp:6077: Time_To_Build = Cost * BuildSpeedBias * TICKS_PER_MINUTE / 1000
    // rules.ini: BuildSpeed=.8, 15 Hz tick rate → TICKS_PER_MINUTE=900
    // TS runs at 15 Hz (matching C++), no scaling needed.
    // buildTime = floor(Cost * 0.8 * 900 / 1000) = floor(Cost * 0.72)
    const CPP_FORMULA = (cost: number) => Math.floor(cost * 0.72);

    it.each([
      ['E1', 100],
      ['3TNK', 950],
      ['HELI', 1200],
      ['WEAP', 2000],
      ['POWR', 300],
      ['4TNK', 1700],
      ['MSLO', 2500],
      ['SBAG', 25],
    ])('%s buildTime = floor(cost * 0.72)', (type, cost) => {
      const item = getItem(type);
      expect(item.buildTime, `${type} buildTime`).toBe(CPP_FORMULA(cost));
    });
  });

  describe('getAvailableItems prerequisite filtering logic', () => {
    // Verify the production.ts getAvailableItems function's prerequisite checks
    // are consistent with the data model

    it('items with techPrereq require an additional building beyond prerequisite', () => {
      const itemsWithTechPrereq = PRODUCTION_ITEMS.filter(i => i.techPrereq);
      expect(itemsWithTechPrereq.length).toBeGreaterThan(0);
      for (const item of itemsWithTechPrereq) {
        // techPrereq should be a real building type (not empty)
        expect(item.techPrereq!.length, `${item.type} techPrereq should be non-empty`).toBeGreaterThan(0);
        // techPrereq should differ from prerequisite
        expect(item.techPrereq, `${item.type} techPrereq should differ from prerequisite`).not.toBe(item.prerequisite);
      }
    });

    it('every buildable non-FACT item has a non-empty prerequisite', () => {
      // Non-buildable items (scenario-placed, fakes with no prereq) have empty prerequisites
      const NO_PREREQ_ALLOWED = new Set([
        'FACT', 'CYCL', 'BARB', 'WOOD', 'BIO', 'HOSP', 'FCOM', 'MISS', 'FACF', 'SPEF',
      ]);
      for (const item of PRODUCTION_ITEMS) {
        if (NO_PREREQ_ALLOWED.has(item.type)) {
          expect(item.prerequisite, `${item.type} prerequisite should be empty`).toBe('');
          continue;
        }
        expect(item.prerequisite.length, `${item.type} should have a prerequisite`).toBeGreaterThan(0);
      }
    });

    it('negative techLevel items are unbuildable (e.g. FACT=-1, STNK=-1)', () => {
      const unbuildable = PRODUCTION_ITEMS.filter(i => i.techLevel !== undefined && i.techLevel < 0);
      expect(unbuildable.length).toBeGreaterThanOrEqual(2);
      const unbuildableTypes = unbuildable.map(i => i.type);
      expect(unbuildableTypes).toContain('FACT');
      expect(unbuildableTypes).toContain('STNK');
    });
  });
});
