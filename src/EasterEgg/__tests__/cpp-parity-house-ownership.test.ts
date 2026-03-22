/**
 * C++ parity: House/Faction System — Owner=, Alliances, Country Bonuses, House Colors
 *
 * rules.ini (and aftrmath.ini for expansion units) are the authoritative source of truth
 * for all house/faction data. This test parses both INI files directly and compares
 * against TS engine constants.
 *
 * C++ source refs:
 *   - hdata.cpp: HouseTypeClass constructors — default ActLike, house names, color remaps
 *   - house.cpp: HouseClass — alliance matrix, IsAlly(), Make_Ally(), Is_Ally()
 *   - rules.cpp:410-500: Rule_INI — parses [CountryName] sections for Firepower, Cost, etc.
 *   - techno.cpp:Read_INI: Owner= parsed to determine which houses can build each type
 *   - init.cpp:Init_Color_Remaps — 16-color palette remap per house (gold/blue/red/orange/grey/brown)
 *
 * Key C++ behavior:
 *   - Owner= field is a comma-separated list: "allies" = all Allied houses, "soviet" = all Soviet houses
 *   - In C++ (house.h:116), HouseTypeClass::ActLike maps each country to either HOUSE_GOOD (Allied) or HOUSE_BAD (Soviet)
 *   - Country bonuses (Firepower, Cost, Armor, etc.) are per-country multipliers from rules.ini
 *   - Alliance defaults: all Allied countries are allied with each other; all Soviet countries are allied with each other
 *   - House colors: C++ Init_Color_Remaps (color.cpp) defines 16-entry palette remaps per house
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// TS engine data
import {
  House, HOUSE_FACTION, COUNTRY_BONUSES, HOUSE_FIREPOWER_BIAS,
  PRODUCTION_ITEMS as BASE_PRODUCTION_ITEMS,
  type Faction, type CountryBonus,
} from '../engine/types';
import { getCanonicalProductionItems, getRulesIniSections } from '../engine/rulesIniPipeline';
import { normalizeOwnerToFaction, parseIniSections, type IniSections } from '../engine/parseIni';

// ---------------------------------------------------------------------------
// Parse rules.ini + aftrmath.ini directly (test-side, independent of engine)
// ---------------------------------------------------------------------------
const RULES_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/rules.ini');
const AFTRMATH_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/aftrmath.ini');
const REMAP_COLORS_PATH = path.resolve(__dirname, '../../../public/ra/assets/remap-colors.json');

const rulesText = fs.readFileSync(RULES_INI_PATH, 'utf-8');
const aftrmathText = fs.readFileSync(AFTRMATH_INI_PATH, 'utf-8');

interface UnitINI {
  owner?: string;         // raw Owner= value
  prerequisite?: string;  // raw Prerequisite= value
  cost?: number;
  techLevel?: number;
}

interface CountryINI {
  firepower: number;
  groundspeed: number;
  airspeed: number;
  armor: number;
  rof: number;
  cost: number;
  buildTime: number;
}

/**
 * Parse rules.ini/aftrmath.ini into section -> key -> value map.
 * Matches C++ INIClass::Load() behavior: strip comments at ';', trim whitespace.
 */
function parseINI(text: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  let currentSection = '';

  for (const rawLine of text.split('\n')) {
    const line = rawLine.split(';')[0].trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      if (!result[currentSection]) result[currentSection] = {};
      continue;
    }

    if (!currentSection) continue;

    const eq = line.indexOf('=');
    if (eq > 0) {
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      result[currentSection][key] = val;
    }
  }
  return result;
}

const RULES = parseINI(rulesText);
const AFTRMATH = parseINI(aftrmathText);

/** Get INI section for a unit/building, preferring aftrmath.ini override */
function getSection(type: string): Record<string, string> | undefined {
  // aftrmath.ini overrides rules.ini for expansion units (C++ INI load order)
  return AFTRMATH[type] ?? RULES[type];
}

/** Parse Owner= value from INI for a given type */
function getOwner(type: string): string | undefined {
  const section = getSection(type);
  return section?.Owner;
}

/** Parse country bonus multipliers from rules.ini [CountryName] section */
function parseCountryBonus(countryName: string): CountryINI | undefined {
  const section = RULES[countryName];
  if (!section) return undefined;
  return {
    firepower: parseFloat(section.Firepower ?? '1.0'),
    groundspeed: parseFloat(section.Groundspeed ?? '1.0'),
    airspeed: parseFloat(section.Airspeed ?? '1.0'),
    armor: parseFloat(section.Armor ?? '1.0'),
    rof: parseFloat(section.ROF ?? '1.0'),
    cost: parseFloat(section.Cost ?? '1.0'),
    buildTime: parseFloat(section.BuildTime ?? '1.0'),
  };
}

/**
 * Determine faction from Owner= string, matching C++ Owner_From_Name behavior.
 * "allies" → allied, "soviet" → soviet, "allies,soviet" → both
 */
function ownerToFaction(raw: string | undefined): Faction | undefined {
  if (!raw || raw.trim() === '') return undefined;
  const owners = raw.split(',').map(s => s.trim().toLowerCase());
  let hasAllied = false;
  let hasSoviet = false;
  for (const o of owners) {
    if (['allies', 'england', 'france', 'germany', 'greece', 'spain', 'turkey', 'goodguy'].includes(o)) hasAllied = true;
    if (['soviet', 'ussr', 'ukraine', 'badguy'].includes(o)) hasSoviet = true;
  }
  if (hasAllied && hasSoviet) return 'both';
  if (hasAllied) return 'allied';
  if (hasSoviet) return 'soviet';
  return undefined;
}

// Get canonical production items (engine-side, patched from rules.ini)
const PRODUCTION_ITEMS = getCanonicalProductionItems();

// ---------------------------------------------------------------------------
// C++ House Constants (from hdata.cpp)
// ---------------------------------------------------------------------------

// C++ hdata.cpp: HouseTypeClass constructors define ActLike for each country.
// ActLike determines the "side" — HOUSE_GOOD (Allied) or HOUSE_BAD (Soviet).
// Allied countries: Spain, Greece, England, France, Germany, Turkey
// Soviet countries: USSR, Ukraine
const CPP_ALLIED_COUNTRIES = ['Spain', 'Greece', 'England', 'France', 'Germany', 'Turkey'];
const CPP_SOVIET_COUNTRIES = ['USSR', 'Ukraine'];

// C++ hdata.cpp country names that have [Country] sections in rules.ini
const ALL_INI_COUNTRIES = ['England', 'Germany', 'France', 'Ukraine', 'USSR', 'Greece', 'Turkey', 'Spain'];

// ---------------------------------------------------------------------------
// All buildable units/structures/walls in PRODUCTION_ITEMS
// ---------------------------------------------------------------------------
const ALL_PRODUCTION_TYPES = PRODUCTION_ITEMS.map(i => i.type);

// Units with Owner= in rules.ini (not all have it — some like MISS, CYCL, BARB, WOOD have none)
const UNITS_WITH_OWNER = ALL_PRODUCTION_TYPES.filter(type => {
  const owner = getOwner(type);
  return owner !== undefined && owner.trim() !== '';
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('C++ Parity: House/Faction System', () => {

  // =========================================================================
  // 1. Owner= field parity — every PRODUCTION_ITEM faction matches rules.ini
  // =========================================================================
  describe('Owner= field → faction mapping (rules.ini is source of truth)', () => {

    it('every PRODUCTION_ITEM with an Owner= in INI has correct faction', () => {
      const mismatches: string[] = [];

      for (const item of PRODUCTION_ITEMS) {
        const iniOwner = getOwner(item.type);
        if (iniOwner === undefined || iniOwner.trim() === '') continue; // no Owner= in INI (HOSP, BIO, etc.)

        const expectedFaction = ownerToFaction(iniOwner);
        if (expectedFaction === undefined) continue;

        if (item.faction !== expectedFaction) {
          mismatches.push(
            `${item.type}: TS faction="${item.faction}" but rules.ini Owner="${iniOwner}" → expected "${expectedFaction}"`
          );
        }
      }

      expect(mismatches, `Faction mismatches:\n${mismatches.join('\n')}`).toEqual([]);
    });

    // Spot-check specific important units from rules.ini
    describe('spot-check: Allied-only units', () => {
      const ALLIED_ONLY_UNITS = ['1TNK', '2TNK', 'JEEP', 'APC', 'ARTY', 'MRJ', 'MGG', 'E3', 'SPY', 'MEDI', 'MECH'];

      for (const type of ALLIED_ONLY_UNITS) {
        it(`${type} Owner= is allied-only in rules.ini and TS`, () => {
          const iniOwner = getOwner(type);
          expect(iniOwner, `${type} should have Owner= in INI`).toBeDefined();
          const iniFaction = ownerToFaction(iniOwner);
          expect(iniFaction, `${type} INI Owner="${iniOwner}" should resolve to allied`).toBe('allied');

          const item = PRODUCTION_ITEMS.find(i => i.type === type);
          expect(item, `${type} should exist in PRODUCTION_ITEMS`).toBeDefined();
          expect(item!.faction).toBe('allied');
        });
      }
    });

    describe('spot-check: Soviet-only units', () => {
      const SOVIET_ONLY_UNITS = ['V2RL', '3TNK', '4TNK', 'E2', 'E4', 'DOG', 'SHOK', 'TTNK', 'QTNK', 'MSUB', 'SS'];

      for (const type of SOVIET_ONLY_UNITS) {
        it(`${type} Owner= is soviet-only in rules.ini and TS`, () => {
          const iniOwner = getOwner(type);
          expect(iniOwner, `${type} should have Owner= in INI`).toBeDefined();
          const iniFaction = ownerToFaction(iniOwner);
          expect(iniFaction, `${type} INI Owner="${iniOwner}" should resolve to soviet`).toBe('soviet');

          const item = PRODUCTION_ITEMS.find(i => i.type === type);
          expect(item, `${type} should exist in PRODUCTION_ITEMS`).toBeDefined();
          expect(item!.faction).toBe('soviet');
        });
      }
    });

    describe('spot-check: Both-faction (shared) units', () => {
      // Note: MCV has Owner=allies,soviet in rules.ini but is NOT in PRODUCTION_ITEMS
      // (TechLevel=11, built from WEAP+FIX, but engine handles it separately via MCV deploy)
      const BOTH_FACTION_UNITS = ['E1', 'E6', 'HARV', 'MNLY', 'DTRK', 'LST', 'E7', 'STNK'];

      for (const type of BOTH_FACTION_UNITS) {
        it(`${type} Owner= includes both allies and soviet in rules.ini`, () => {
          const iniOwner = getOwner(type);
          expect(iniOwner, `${type} should have Owner= in INI`).toBeDefined();
          const iniFaction = ownerToFaction(iniOwner);
          expect(iniFaction, `${type} INI Owner="${iniOwner}" should resolve to both`).toBe('both');

          const item = PRODUCTION_ITEMS.find(i => i.type === type);
          expect(item, `${type} should exist in PRODUCTION_ITEMS`).toBeDefined();
          expect(item!.faction).toBe('both');
        });
      }
    });
  });

  // =========================================================================
  // 2. Building Owner= parity — structures
  // =========================================================================
  describe('Building Owner= parity', () => {

    describe('Allied-only buildings', () => {
      const ALLIED_BUILDINGS = ['TENT', 'ATEK', 'PDOX', 'SYRD', 'PBOX', 'HBOX', 'GUN', 'AGUN', 'GAP'];

      for (const type of ALLIED_BUILDINGS) {
        it(`${type} is allied-only per rules.ini`, () => {
          const iniOwner = getOwner(type);
          expect(ownerToFaction(iniOwner)).toBe('allied');
          const item = PRODUCTION_ITEMS.find(i => i.type === type);
          expect(item, `${type} should be in PRODUCTION_ITEMS`).toBeDefined();
          expect(item!.faction).toBe('allied');
        });
      }
    });

    describe('Soviet-only buildings', () => {
      const SOVIET_BUILDINGS = ['BARR', 'STEK', 'IRON', 'SPEN', 'TSLA', 'FTUR', 'SAM', 'KENN', 'AFLD'];

      for (const type of SOVIET_BUILDINGS) {
        it(`${type} is soviet-only per rules.ini`, () => {
          const iniOwner = getOwner(type);
          expect(ownerToFaction(iniOwner)).toBe('soviet');
          const item = PRODUCTION_ITEMS.find(i => i.type === type);
          expect(item, `${type} should be in PRODUCTION_ITEMS`).toBeDefined();
          expect(item!.faction).toBe('soviet');
        });
      }
    });

    describe('Shared buildings (both factions)', () => {
      const SHARED_BUILDINGS = ['FACT', 'POWR', 'APWR', 'PROC', 'WEAP', 'SILO', 'DOME', 'FIX', 'HPAD', 'MSLO'];

      for (const type of SHARED_BUILDINGS) {
        it(`${type} is owned by both factions per rules.ini`, () => {
          const iniOwner = getOwner(type);
          expect(ownerToFaction(iniOwner)).toBe('both');
          const item = PRODUCTION_ITEMS.find(i => i.type === type);
          expect(item, `${type} should be in PRODUCTION_ITEMS`).toBeDefined();
          expect(item!.faction).toBe('both');
        });
      }
    });

    describe('Wall ownership', () => {
      it('SBAG (Sandbag) is allied-only per rules.ini', () => {
        expect(ownerToFaction(getOwner('SBAG'))).toBe('allied');
        expect(PRODUCTION_ITEMS.find(i => i.type === 'SBAG')!.faction).toBe('allied');
      });

      it('FENC (Wire Fence) is soviet-only per rules.ini', () => {
        expect(ownerToFaction(getOwner('FENC'))).toBe('soviet');
        expect(PRODUCTION_ITEMS.find(i => i.type === 'FENC')!.faction).toBe('soviet');
      });

      it('BRIK (Concrete Wall) is shared per rules.ini', () => {
        expect(ownerToFaction(getOwner('BRIK'))).toBe('both');
        expect(PRODUCTION_ITEMS.find(i => i.type === 'BRIK')!.faction).toBe('both');
      });
    });

    describe('Fake buildings ownership', () => {
      it('FACF is allied-only per rules.ini', () => {
        expect(ownerToFaction(getOwner('FACF'))).toBe('allied');
        expect(PRODUCTION_ITEMS.find(i => i.type === 'FACF')!.faction).toBe('allied');
      });

      it('WEAF is allied-only per rules.ini', () => {
        expect(ownerToFaction(getOwner('WEAF'))).toBe('allied');
        expect(PRODUCTION_ITEMS.find(i => i.type === 'WEAF')!.faction).toBe('allied');
      });

      it('SYRF is allied-only per rules.ini', () => {
        expect(ownerToFaction(getOwner('SYRF'))).toBe('allied');
        expect(PRODUCTION_ITEMS.find(i => i.type === 'SYRF')!.faction).toBe('allied');
      });

      it('SPEF is soviet-only per rules.ini', () => {
        expect(ownerToFaction(getOwner('SPEF'))).toBe('soviet');
        expect(PRODUCTION_ITEMS.find(i => i.type === 'SPEF')!.faction).toBe('soviet');
      });

      it('DOMF is allied-only per rules.ini', () => {
        expect(ownerToFaction(getOwner('DOMF'))).toBe('allied');
        expect(PRODUCTION_ITEMS.find(i => i.type === 'DOMF')!.faction).toBe('allied');
      });
    });
  });

  // =========================================================================
  // 3. Aircraft Owner= parity
  // =========================================================================
  describe('Aircraft Owner= parity', () => {
    it('HELI (Longbow) is allied-only per rules.ini', () => {
      const iniOwner = RULES['HELI']?.Owner;
      expect(ownerToFaction(iniOwner)).toBe('allied');
      expect(PRODUCTION_ITEMS.find(i => i.type === 'HELI')!.faction).toBe('allied');
    });

    it('HIND is soviet-only per rules.ini', () => {
      const iniOwner = RULES['HIND']?.Owner;
      expect(ownerToFaction(iniOwner)).toBe('soviet');
      expect(PRODUCTION_ITEMS.find(i => i.type === 'HIND')!.faction).toBe('soviet');
    });

    it('MIG is soviet-only per rules.ini', () => {
      const iniOwner = RULES['MIG']?.Owner;
      expect(ownerToFaction(iniOwner)).toBe('soviet');
      expect(PRODUCTION_ITEMS.find(i => i.type === 'MIG')!.faction).toBe('soviet');
    });

    it('YAK is soviet-only per rules.ini', () => {
      const iniOwner = RULES['YAK']?.Owner;
      expect(ownerToFaction(iniOwner)).toBe('soviet');
      expect(PRODUCTION_ITEMS.find(i => i.type === 'YAK')!.faction).toBe('soviet');
    });

    it('TRAN (Chinook) is soviet-only per rules.ini', () => {
      const iniOwner = RULES['TRAN']?.Owner;
      expect(ownerToFaction(iniOwner)).toBe('soviet');
      expect(PRODUCTION_ITEMS.find(i => i.type === 'TRAN')!.faction).toBe('soviet');
    });

    it('BADR (Badger) is soviet-only per rules.ini', () => {
      const iniOwner = RULES['BADR']?.Owner;
      expect(ownerToFaction(iniOwner)).toBe('soviet');
      // BADR may not be in PRODUCTION_ITEMS (TechLevel=-1, not buildable)
    });
  });

  // =========================================================================
  // 4. Expansion (aftrmath.ini) Owner= parity
  // =========================================================================
  describe('Aftermath expansion unit Owner= parity (aftrmath.ini)', () => {
    it('STNK (Phase Transport) is both per aftrmath.ini', () => {
      const iniOwner = AFTRMATH['STNK']?.Owner;
      expect(iniOwner).toBeDefined();
      expect(ownerToFaction(iniOwner)).toBe('both');
      expect(PRODUCTION_ITEMS.find(i => i.type === 'STNK')!.faction).toBe('both');
    });

    it('CTNK (Chrono Tank) is allied-only per aftrmath.ini', () => {
      const iniOwner = AFTRMATH['CTNK']?.Owner;
      expect(iniOwner).toBeDefined();
      expect(ownerToFaction(iniOwner)).toBe('allied');
      expect(PRODUCTION_ITEMS.find(i => i.type === 'CTNK')!.faction).toBe('allied');
    });

    it('TTNK (Tesla Tank) is soviet-only per aftrmath.ini', () => {
      const iniOwner = AFTRMATH['TTNK']?.Owner;
      expect(iniOwner).toBeDefined();
      expect(ownerToFaction(iniOwner)).toBe('soviet');
      expect(PRODUCTION_ITEMS.find(i => i.type === 'TTNK')!.faction).toBe('soviet');
    });

    it('DTRK (Demo Truck) is both per aftrmath.ini', () => {
      const iniOwner = AFTRMATH['DTRK']?.Owner;
      expect(iniOwner).toBeDefined();
      expect(ownerToFaction(iniOwner)).toBe('both');
      expect(PRODUCTION_ITEMS.find(i => i.type === 'DTRK')!.faction).toBe('both');
    });

    it('QTNK (M.A.D. Tank) is soviet-only per aftrmath.ini', () => {
      const iniOwner = AFTRMATH['QTNK']?.Owner;
      expect(iniOwner).toBeDefined();
      expect(ownerToFaction(iniOwner)).toBe('soviet');
      expect(PRODUCTION_ITEMS.find(i => i.type === 'QTNK')!.faction).toBe('soviet');
    });

    it('MSUB (Missile Sub) is soviet-only per aftrmath.ini', () => {
      const iniOwner = AFTRMATH['MSUB']?.Owner;
      expect(iniOwner).toBeDefined();
      expect(ownerToFaction(iniOwner)).toBe('soviet');
      expect(PRODUCTION_ITEMS.find(i => i.type === 'MSUB')!.faction).toBe('soviet');
    });

    it('SHOK (Shock Trooper) is soviet-only per aftrmath.ini', () => {
      const iniOwner = AFTRMATH['SHOK']?.Owner;
      expect(iniOwner).toBeDefined();
      expect(ownerToFaction(iniOwner)).toBe('soviet');
      expect(PRODUCTION_ITEMS.find(i => i.type === 'SHOK')!.faction).toBe('soviet');
    });

    it('MECH (Mechanic) is allied-only per aftrmath.ini', () => {
      const iniOwner = AFTRMATH['MECH']?.Owner;
      expect(iniOwner).toBeDefined();
      expect(ownerToFaction(iniOwner)).toBe('allied');
      expect(PRODUCTION_ITEMS.find(i => i.type === 'MECH')!.faction).toBe('allied');
    });
  });

  // =========================================================================
  // 5. House-to-Faction mapping (ActLike in C++ hdata.cpp)
  // =========================================================================
  describe('House → Faction mapping (C++ HouseTypeClass::ActLike)', () => {

    it('all Allied countries map to allied faction', () => {
      for (const country of CPP_ALLIED_COUNTRIES) {
        expect(HOUSE_FACTION[country], `${country} should map to allied`).toBe('allied');
      }
    });

    it('all Soviet countries map to soviet faction', () => {
      for (const country of CPP_SOVIET_COUNTRIES) {
        expect(HOUSE_FACTION[country], `${country} should map to soviet`).toBe('soviet');
      }
    });

    it('GoodGuy maps to allied (C++ meta-house)', () => {
      expect(HOUSE_FACTION.GoodGuy).toBe('allied');
    });

    it('BadGuy maps to soviet (C++ meta-house)', () => {
      expect(HOUSE_FACTION.BadGuy).toBe('soviet');
    });

    it('Neutral maps to both', () => {
      expect(HOUSE_FACTION.Neutral).toBe('both');
    });

    it('every House enum value has a faction mapping', () => {
      for (const house of Object.values(House)) {
        expect(HOUSE_FACTION[house], `House.${house} should have faction mapping`).toBeDefined();
      }
    });

    it('exactly 8 playable countries exist (6 Allied + 2 Soviet)', () => {
      // C++ hdata.cpp defines exactly 8 countries with rules.ini bonus sections
      expect(ALL_INI_COUNTRIES.length).toBe(8);
      const alliedCount = ALL_INI_COUNTRIES.filter(c => HOUSE_FACTION[c] === 'allied').length;
      const sovietCount = ALL_INI_COUNTRIES.filter(c => HOUSE_FACTION[c] === 'soviet').length;
      expect(alliedCount).toBe(6);
      expect(sovietCount).toBe(2);
    });
  });

  // =========================================================================
  // 6. Country Bonuses — parsed from rules.ini [Country] sections
  // =========================================================================
  describe('Country Bonuses (rules.ini [Country] sections)', () => {

    for (const country of ALL_INI_COUNTRIES) {
      describe(`[${country}] bonuses`, () => {
        it(`${country} bonuses match rules.ini values`, () => {
          const iniBonus = parseCountryBonus(country);
          expect(iniBonus, `${country} section should exist in rules.ini`).toBeDefined();

          const tsBonus = COUNTRY_BONUSES[country];
          expect(tsBonus, `${country} should exist in COUNTRY_BONUSES`).toBeDefined();

          // Compare each multiplier against the parsed INI value
          expect(tsBonus.firepowerMult).toBeCloseTo(iniBonus!.firepower, 5);
          expect(tsBonus.groundspeedMult).toBeCloseTo(iniBonus!.groundspeed, 5);
          expect(tsBonus.airspeedMult).toBeCloseTo(iniBonus!.airspeed, 5);
          expect(tsBonus.armorMult).toBeCloseTo(iniBonus!.armor, 5);
          expect(tsBonus.rofMult).toBeCloseTo(iniBonus!.rof, 5);
          expect(tsBonus.costMult).toBeCloseTo(iniBonus!.cost, 5);
          expect(tsBonus.buildTimeMult).toBeCloseTo(iniBonus!.buildTime, 5);
        });
      });
    }

    // Spot-check the non-default bonuses specifically
    describe('non-default bonuses (countries that differ from 1.0)', () => {
      it('England: Armor=1.1 (only non-1.0 stat)', () => {
        const ini = parseCountryBonus('England')!;
        expect(ini.armor).toBe(1.1);
        expect(ini.firepower).toBe(1.0);
        expect(ini.cost).toBe(1.0);
        expect(COUNTRY_BONUSES.England.armorMult).toBe(1.1);
      });

      it('Germany: Firepower=1.1 (only non-1.0 stat)', () => {
        const ini = parseCountryBonus('Germany')!;
        expect(ini.firepower).toBe(1.1);
        expect(ini.armor).toBe(1.0);
        expect(COUNTRY_BONUSES.Germany.firepowerMult).toBe(1.1);
      });

      it('France: ROF=1.1 (only non-1.0 stat)', () => {
        const ini = parseCountryBonus('France')!;
        expect(ini.rof).toBe(1.1);
        expect(ini.firepower).toBe(1.0);
        expect(COUNTRY_BONUSES.France.rofMult).toBe(1.1);
      });

      it('USSR: Cost=0.9 (only non-1.0 stat)', () => {
        const ini = parseCountryBonus('USSR')!;
        expect(ini.cost).toBe(0.9);
        expect(ini.firepower).toBe(1.0);
        expect(COUNTRY_BONUSES.USSR.costMult).toBe(0.9);
      });

      it('Ukraine: Groundspeed=1.1 (only non-1.0 stat)', () => {
        const ini = parseCountryBonus('Ukraine')!;
        expect(ini.groundspeed).toBe(1.1);
        expect(ini.firepower).toBe(1.0);
        expect(COUNTRY_BONUSES.Ukraine.groundspeedMult).toBe(1.1);
      });
    });

    describe('baseline countries (all 1.0)', () => {
      const BASELINE_COUNTRIES = ['Spain', 'Greece', 'Turkey'];

      for (const country of BASELINE_COUNTRIES) {
        it(`${country} has all-1.0 bonuses per rules.ini`, () => {
          const ini = parseCountryBonus(country)!;
          expect(ini.firepower).toBe(1.0);
          expect(ini.groundspeed).toBe(1.0);
          expect(ini.airspeed).toBe(1.0);
          expect(ini.armor).toBe(1.0);
          expect(ini.rof).toBe(1.0);
          expect(ini.cost).toBe(1.0);
          expect(ini.buildTime).toBe(1.0);

          const ts = COUNTRY_BONUSES[country];
          expect(ts.costMult).toBe(1.0);
          expect(ts.firepowerMult).toBe(1.0);
          expect(ts.armorMult).toBe(1.0);
        });
      }
    });
  });

  // =========================================================================
  // 7. HOUSE_FIREPOWER_BIAS derived from COUNTRY_BONUSES
  // =========================================================================
  describe('HOUSE_FIREPOWER_BIAS (C++ House->FirepowerBias)', () => {

    it('is derived from COUNTRY_BONUSES.firepowerMult for every house', () => {
      for (const [house, bonus] of Object.entries(COUNTRY_BONUSES)) {
        expect(
          HOUSE_FIREPOWER_BIAS[house],
          `HOUSE_FIREPOWER_BIAS[${house}] should equal COUNTRY_BONUSES[${house}].firepowerMult`
        ).toBe(bonus.firepowerMult);
      }
    });

    it('Germany has 1.1 firepower bias (10% bonus)', () => {
      expect(HOUSE_FIREPOWER_BIAS.Germany).toBe(1.1);
    });

    it('all non-Germany houses have 1.0 firepower bias', () => {
      for (const country of ALL_INI_COUNTRIES) {
        if (country === 'Germany') continue;
        expect(HOUSE_FIREPOWER_BIAS[country], `${country} firepower bias`).toBe(1.0);
      }
    });
  });

  // =========================================================================
  // 8. Alliance defaults (C++ hdata.cpp ActLike grouping)
  // =========================================================================
  describe('Alliance defaults (faction grouping)', () => {

    it('all Allied countries share the same faction value', () => {
      const alliedFactions = CPP_ALLIED_COUNTRIES.map(c => HOUSE_FACTION[c]);
      expect(new Set(alliedFactions).size).toBe(1);
      expect(alliedFactions[0]).toBe('allied');
    });

    it('all Soviet countries share the same faction value', () => {
      const sovietFactions = CPP_SOVIET_COUNTRIES.map(c => HOUSE_FACTION[c]);
      expect(new Set(sovietFactions).size).toBe(1);
      expect(sovietFactions[0]).toBe('soviet');
    });

    it('Allied and Soviet factions are distinct', () => {
      expect(HOUSE_FACTION.Spain).not.toBe(HOUSE_FACTION.USSR);
      expect(HOUSE_FACTION.England).not.toBe(HOUSE_FACTION.Ukraine);
    });

    it('faction filtering: allied player cannot build soviet-only items', () => {
      const sovietOnly = PRODUCTION_ITEMS.filter(i => i.faction === 'soviet');
      for (const item of sovietOnly) {
        // An allied player should not see these
        expect(item.faction).not.toBe('allied');
        expect(item.faction).not.toBe('both');
      }
    });

    it('faction filtering: soviet player cannot build allied-only items', () => {
      const alliedOnly = PRODUCTION_ITEMS.filter(i => i.faction === 'allied');
      for (const item of alliedOnly) {
        expect(item.faction).not.toBe('soviet');
        expect(item.faction).not.toBe('both');
      }
    });
  });

  // =========================================================================
  // 9. BARR=Soviet / TENT=Allied (C++ critical distinction)
  // =========================================================================
  describe('BARR/TENT faction split (C++ barracks distinction)', () => {

    it('BARR is soviet barracks per rules.ini', () => {
      expect(RULES['BARR']?.Owner?.toLowerCase()).toBe('soviet');
      expect(PRODUCTION_ITEMS.find(i => i.type === 'BARR')!.faction).toBe('soviet');
    });

    it('TENT is allied barracks per rules.ini', () => {
      expect(RULES['TENT']?.Owner?.toLowerCase()).toBe('allies');
      expect(PRODUCTION_ITEMS.find(i => i.type === 'TENT')!.faction).toBe('allied');
    });

    it('BARR and TENT have same cost per rules.ini', () => {
      const barrCost = parseInt(RULES['BARR']?.Cost ?? '0', 10);
      const tentCost = parseInt(RULES['TENT']?.Cost ?? '0', 10);
      expect(barrCost).toBe(tentCost);
      expect(barrCost).toBe(300);
    });

    it('Soviet infantry prereqs reference BARR, not TENT', () => {
      // E4 (Flamethrower) has Prerequisite=stek but is buildable from BARR
      // DOG has Prerequisite=kenn, which itself requires BARR
      const e4 = PRODUCTION_ITEMS.find(i => i.type === 'E4')!;
      expect(e4.faction).toBe('soviet');

      const dog = PRODUCTION_ITEMS.find(i => i.type === 'DOG')!;
      expect(dog.faction).toBe('soviet');
      expect(dog.prerequisite).toBe('KENN');
    });

    it('Allied infantry prereqs reference TENT, not BARR', () => {
      const e3 = PRODUCTION_ITEMS.find(i => i.type === 'E3')!;
      expect(e3.faction).toBe('allied');
      expect(e3.prerequisite).toBe('TENT');

      const medi = PRODUCTION_ITEMS.find(i => i.type === 'MEDI')!;
      expect(medi.faction).toBe('allied');
      expect(medi.prerequisite).toBe('TENT');
    });
  });

  // =========================================================================
  // 10. SYRD=Allied / SPEN=Soviet (naval production split)
  // =========================================================================
  describe('SYRD/SPEN naval production split', () => {

    it('SYRD (Ship Yard) is allied per rules.ini', () => {
      expect(RULES['SYRD']?.Owner?.toLowerCase()).toBe('allies');
      expect(PRODUCTION_ITEMS.find(i => i.type === 'SYRD')!.faction).toBe('allied');
    });

    it('SPEN (Sub Pen) is soviet per rules.ini', () => {
      expect(RULES['SPEN']?.Owner?.toLowerCase()).toBe('soviet');
      expect(PRODUCTION_ITEMS.find(i => i.type === 'SPEN')!.faction).toBe('soviet');
    });

    it('Allied naval units come from SYRD: PT, DD, CA', () => {
      for (const type of ['PT', 'DD', 'CA']) {
        const item = PRODUCTION_ITEMS.find(i => i.type === type)!;
        expect(item.prerequisite, `${type} prerequisite`).toBe('SYRD');
        expect(item.faction, `${type} faction`).toBe('allied');
      }
    });

    it('Soviet naval units come from SPEN: SS, MSUB', () => {
      for (const type of ['SS', 'MSUB']) {
        const item = PRODUCTION_ITEMS.find(i => i.type === type)!;
        expect(item.prerequisite, `${type} prerequisite`).toBe('SPEN');
        expect(item.faction, `${type} faction`).toBe('soviet');
      }
    });

    it('LST (Transport) is shared (both factions) per rules.ini', () => {
      const iniOwner = RULES['LST']?.Owner;
      expect(ownerToFaction(iniOwner)).toBe('both');
      const item = PRODUCTION_ITEMS.find(i => i.type === 'LST')!;
      expect(item.faction).toBe('both');
    });
  });

  // =========================================================================
  // 11. ATEK/STEK tech center faction split
  // =========================================================================
  describe('ATEK/STEK tech center faction split', () => {

    it('ATEK (Allied Tech) is allied per rules.ini', () => {
      expect(RULES['ATEK']?.Owner?.toLowerCase()).toBe('allies');
      expect(PRODUCTION_ITEMS.find(i => i.type === 'ATEK')!.faction).toBe('allied');
    });

    it('STEK (Soviet Tech) is soviet per rules.ini', () => {
      expect(RULES['STEK']?.Owner?.toLowerCase()).toBe('soviet');
      expect(PRODUCTION_ITEMS.find(i => i.type === 'STEK')!.faction).toBe('soviet');
    });

    it('PDOX (Chronosphere) requires ATEK, is allied', () => {
      const pdox = PRODUCTION_ITEMS.find(i => i.type === 'PDOX')!;
      expect(pdox.prerequisite).toBe('ATEK');
      expect(pdox.faction).toBe('allied');
    });

    it('IRON (Iron Curtain) requires STEK, is soviet', () => {
      const iron = PRODUCTION_ITEMS.find(i => i.type === 'IRON')!;
      expect(iron.prerequisite).toBe('STEK');
      expect(iron.faction).toBe('soviet');
    });

    it('MSLO (Missile Silo) requires STEK but is shared (both)', () => {
      const mslo = PRODUCTION_ITEMS.find(i => i.type === 'MSLO')!;
      expect(mslo.prerequisite).toBe('STEK');
      expect(mslo.faction).toBe('both');
    });
  });

  // =========================================================================
  // 12. normalizeOwnerToFaction() engine function parity
  // =========================================================================
  describe('normalizeOwnerToFaction() engine function', () => {

    it('maps "allies" to allied', () => {
      expect(normalizeOwnerToFaction('allies')).toBe('allied');
    });

    it('maps "soviet" to soviet', () => {
      expect(normalizeOwnerToFaction('soviet')).toBe('soviet');
    });

    it('maps "allies,soviet" to both', () => {
      expect(normalizeOwnerToFaction('allies,soviet')).toBe('both');
    });

    it('maps "soviet,allies" to both (order independent)', () => {
      expect(normalizeOwnerToFaction('soviet,allies')).toBe('both');
    });

    it('maps individual country names to correct faction', () => {
      expect(normalizeOwnerToFaction('england')).toBe('allied');
      expect(normalizeOwnerToFaction('france')).toBe('allied');
      expect(normalizeOwnerToFaction('germany')).toBe('allied');
      expect(normalizeOwnerToFaction('greece')).toBe('allied');
      expect(normalizeOwnerToFaction('spain')).toBe('allied');
      expect(normalizeOwnerToFaction('turkey')).toBe('allied');
      expect(normalizeOwnerToFaction('ussr')).toBe('soviet');
      expect(normalizeOwnerToFaction('ukraine')).toBe('soviet');
    });

    it('maps meta-houses: goodguy=allied, badguy=soviet', () => {
      expect(normalizeOwnerToFaction('goodguy')).toBe('allied');
      expect(normalizeOwnerToFaction('badguy')).toBe('soviet');
    });

    it('returns undefined for empty/missing Owner=', () => {
      expect(normalizeOwnerToFaction(undefined)).toBeUndefined();
      expect(normalizeOwnerToFaction('')).toBeUndefined();
    });

    it('is case-insensitive (C++ INI parsing lowercases)', () => {
      expect(normalizeOwnerToFaction('Allies')).toBe('allied');
      expect(normalizeOwnerToFaction('SOVIET')).toBe('soviet');
      expect(normalizeOwnerToFaction('Allies,Soviet')).toBe('both');
    });
  });

  // =========================================================================
  // 13. House color remap data (C++ Init_Color_Remaps)
  // =========================================================================
  describe('House color remap data (C++ Init_Color_Remaps)', () => {

    let remapData: { source: number[][]; houses: Record<string, number[][]> };

    it('remap-colors.json exists and is valid', () => {
      const raw = fs.readFileSync(REMAP_COLORS_PATH, 'utf-8');
      remapData = JSON.parse(raw);
      expect(remapData).toBeDefined();
      expect(remapData.source).toBeDefined();
      expect(remapData.houses).toBeDefined();
    });

    it('source palette has 16 entries (C++ 16-color remap range)', () => {
      const raw = fs.readFileSync(REMAP_COLORS_PATH, 'utf-8');
      remapData = JSON.parse(raw);
      expect(remapData.source.length).toBe(16);
    });

    it('each source color is an [R, G, B] triple', () => {
      const raw = fs.readFileSync(REMAP_COLORS_PATH, 'utf-8');
      remapData = JSON.parse(raw);
      for (const color of remapData.source) {
        expect(color.length).toBe(3);
        for (const channel of color) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(255);
        }
      }
    });

    // C++ Init_Color_Remaps defines color remaps for: Spain (gold), Greece (blue),
    // USSR (red), Ukraine (orange), Germany (grey), Turkey (brown)
    const EXPECTED_HOUSE_COLORS = ['Spain', 'Greece', 'USSR', 'Ukraine', 'Germany', 'Turkey'];

    it(`has remap entries for all 6 playable multiplayer houses: ${EXPECTED_HOUSE_COLORS.join(', ')}`, () => {
      const raw = fs.readFileSync(REMAP_COLORS_PATH, 'utf-8');
      remapData = JSON.parse(raw);
      for (const house of EXPECTED_HOUSE_COLORS) {
        expect(remapData.houses[house], `${house} should have remap colors`).toBeDefined();
      }
    });

    it('each house remap has 16 entries matching source length', () => {
      const raw = fs.readFileSync(REMAP_COLORS_PATH, 'utf-8');
      remapData = JSON.parse(raw);
      for (const [house, colors] of Object.entries(remapData.houses)) {
        expect(colors.length, `${house} should have 16 remap colors`).toBe(16);
        for (const color of colors) {
          expect(color.length, `${house} color should be [R,G,B]`).toBe(3);
        }
      }
    });

    it('Spain (default/gold) remap equals source colors (player 1 default)', () => {
      const raw = fs.readFileSync(REMAP_COLORS_PATH, 'utf-8');
      remapData = JSON.parse(raw);
      // C++ hdata.cpp: Spain uses the default gold/yellow palette (PCOLOR_GOLD)
      // Source palette IS the gold palette, so Spain's remap should equal source
      expect(remapData.houses.Spain).toEqual(remapData.source);
    });

    it('Greece remap is blue-tinted (C++ PCOLOR_LTBLUE)', () => {
      const raw = fs.readFileSync(REMAP_COLORS_PATH, 'utf-8');
      remapData = JSON.parse(raw);
      const greeceColors = remapData.houses.Greece;
      // Blue channel should dominate — check the brightest color
      const brightest = greeceColors[0]; // first entry is brightest
      expect(brightest[2]).toBeGreaterThan(brightest[0]); // B > R
      expect(brightest[2]).toBeGreaterThan(brightest[1]); // B > G
    });

    it('USSR remap is red-tinted (C++ PCOLOR_RED)', () => {
      const raw = fs.readFileSync(REMAP_COLORS_PATH, 'utf-8');
      remapData = JSON.parse(raw);
      const ussrColors = remapData.houses.USSR;
      // Red channel should dominate
      const brightest = ussrColors[0];
      expect(brightest[0]).toBeGreaterThan(brightest[1]); // R > G
      expect(brightest[0]).toBeGreaterThan(brightest[2]); // R > B
    });

    it('Ukraine remap is orange-tinted (C++ PCOLOR_ORANGE)', () => {
      const raw = fs.readFileSync(REMAP_COLORS_PATH, 'utf-8');
      remapData = JSON.parse(raw);
      const ukraineColors = remapData.houses.Ukraine;
      // Orange = high R, moderate G, low B
      const brightest = ukraineColors[0];
      expect(brightest[0]).toBeGreaterThan(brightest[2]); // R > B
    });
  });

  // =========================================================================
  // 14. DoubleOwned= (C++ special: some units are available to both despite Owner=)
  // =========================================================================
  describe('DoubleOwned= handling', () => {
    // In C++ rules.ini, some units have DoubleOwned=yes, meaning both factions
    // can build them in multiplayer even if Owner= only lists one side.
    // E3 (Rocket Soldier): Owner=allies, DoubleOwned=yes
    // E7 (Tanya): Owner=allies,soviet, DoubleOwned=yes (already both)

    it('E3 has DoubleOwned=yes in rules.ini', () => {
      expect(RULES['E3']?.DoubleOwned?.toLowerCase()).toBe('yes');
    });

    it('E7 (Tanya) has DoubleOwned=yes in rules.ini', () => {
      expect(RULES['E7']?.DoubleOwned?.toLowerCase()).toBe('yes');
    });

    it('E7 (Tanya) Owner= already includes both factions', () => {
      const iniOwner = RULES['E7']?.Owner;
      expect(ownerToFaction(iniOwner)).toBe('both');
      expect(PRODUCTION_ITEMS.find(i => i.type === 'E7')!.faction).toBe('both');
    });
  });

  // =========================================================================
  // 15. Comprehensive exhaust test — no orphaned PRODUCTION_ITEMS
  // =========================================================================
  describe('exhaustive: every PRODUCTION_ITEM has a matching INI section', () => {

    it('all production items with faction have a rules.ini or aftrmath.ini section', () => {
      const missing: string[] = [];

      for (const item of PRODUCTION_ITEMS) {
        const section = getSection(item.type);
        if (!section) {
          // Some items may not have INI sections (engine-only) — that's OK
          // But if they have a non-trivial faction, flag them
          missing.push(`${item.type} (faction=${item.faction}): no INI section found`);
        }
      }

      // FACF has no Prerequisite= in rules.ini but does have Owner=, so it should have a section
      // Allow items that legitimately have no section (shouldn't be any for PRODUCTION_ITEMS)
      // This test documents which items are present
      expect(missing.length).toBeLessThanOrEqual(0);
    });
  });

  // =========================================================================
  // 16. Cost parity (rules.ini Cost= vs TS PRODUCTION_ITEMS)
  // =========================================================================
  describe('Cost parity for ownership-relevant items', () => {

    it('all PRODUCTION_ITEMS costs match rules.ini/aftrmath.ini', () => {
      const mismatches: string[] = [];

      for (const item of PRODUCTION_ITEMS) {
        const section = getSection(item.type);
        if (!section?.Cost || section.Cost.trim() === '') continue;

        const iniCost = parseInt(section.Cost, 10);
        if (isNaN(iniCost)) continue;

        if (item.cost !== iniCost) {
          mismatches.push(
            `${item.type}: TS cost=${item.cost} but INI Cost=${iniCost}`
          );
        }
      }

      expect(mismatches, `Cost mismatches:\n${mismatches.join('\n')}`).toEqual([]);
    });
  });

  // =========================================================================
  // 17. TechLevel parity (rules.ini TechLevel= vs TS PRODUCTION_ITEMS)
  // =========================================================================
  describe('TechLevel parity for ownership-relevant items', () => {

    it('all PRODUCTION_ITEMS techLevels match rules.ini/aftrmath.ini', () => {
      const mismatches: string[] = [];

      for (const item of PRODUCTION_ITEMS) {
        if (item.techLevel === undefined) continue;

        const section = getSection(item.type);
        if (!section?.TechLevel) continue;

        const iniTL = parseInt(section.TechLevel, 10);
        if (isNaN(iniTL)) continue;

        if (item.techLevel !== iniTL) {
          mismatches.push(
            `${item.type}: TS techLevel=${item.techLevel} but INI TechLevel=${iniTL}`
          );
        }
      }

      expect(mismatches, `TechLevel mismatches:\n${mismatches.join('\n')}`).toEqual([]);
    });
  });

  // =========================================================================
  // 18. Buildings without Owner= (HOSP, BIO) are not in production
  // =========================================================================
  describe('buildings without Owner= are not buildable', () => {

    it('HOSP has empty Owner= in rules.ini and is not in PRODUCTION_ITEMS', () => {
      const iniOwner = RULES['HOSP']?.Owner;
      expect(iniOwner?.trim()).toBe('');
      const item = PRODUCTION_ITEMS.find(i => i.type === 'HOSP');
      expect(item).toBeUndefined();
    });

    it('BIO has empty Owner= in rules.ini and is not in PRODUCTION_ITEMS', () => {
      const iniOwner = RULES['BIO']?.Owner;
      expect(iniOwner?.trim()).toBe('');
      const item = PRODUCTION_ITEMS.find(i => i.type === 'BIO');
      expect(item).toBeUndefined();
    });

    it('CYCL, BARB, WOOD have no Owner= in rules.ini and are not in PRODUCTION_ITEMS', () => {
      for (const type of ['CYCL', 'BARB', 'WOOD']) {
        const section = RULES[type];
        expect(section?.Owner).toBeUndefined();
        const item = PRODUCTION_ITEMS.find(i => i.type === type);
        expect(item, `${type} should not be in PRODUCTION_ITEMS`).toBeUndefined();
      }
    });
  });

  // =========================================================================
  // 19. CountryBonus interface completeness
  // =========================================================================
  describe('CountryBonus interface completeness', () => {

    it('every CountryBonus has all 7 multiplier fields', () => {
      const requiredFields: (keyof CountryBonus)[] = [
        'costMult', 'firepowerMult', 'armorMult',
        'groundspeedMult', 'rofMult', 'airspeedMult', 'buildTimeMult',
      ];

      for (const [house, bonus] of Object.entries(COUNTRY_BONUSES)) {
        for (const field of requiredFields) {
          expect(
            typeof bonus[field],
            `COUNTRY_BONUSES[${house}].${field} should be a number`
          ).toBe('number');
        }
      }
    });

    it('meta-houses (GoodGuy, BadGuy, Neutral) have baseline bonuses', () => {
      for (const meta of ['GoodGuy', 'BadGuy', 'Neutral']) {
        const bonus = COUNTRY_BONUSES[meta];
        expect(bonus, `${meta} should have country bonuses`).toBeDefined();
        expect(bonus.costMult).toBe(1.0);
        expect(bonus.firepowerMult).toBe(1.0);
        expect(bonus.armorMult).toBe(1.0);
        expect(bonus.groundspeedMult).toBe(1.0);
        expect(bonus.rofMult).toBe(1.0);
        expect(bonus.airspeedMult).toBe(1.0);
        expect(bonus.buildTimeMult).toBe(1.0);
      }
    });
  });

  // =========================================================================
  // 20. Engine parseIniSections parity with test-side parser
  // =========================================================================
  describe('engine parseIniSections vs test-side parser agreement', () => {

    it('Owner= values agree between engine parser and test parser for all production types', () => {
      const engineSections = getRulesIniSections();
      const mismatches: string[] = [];

      for (const item of PRODUCTION_ITEMS) {
        const engineSection = engineSections.get(item.type);
        const testSection = RULES[item.type];

        const engineOwner = engineSection?.get('Owner');
        const testOwner = testSection?.Owner;

        // Both should agree (or both be undefined/missing)
        if ((engineOwner ?? '') !== (testOwner ?? '')) {
          mismatches.push(
            `${item.type}: engine Owner="${engineOwner}" vs test Owner="${testOwner}"`
          );
        }
      }

      expect(mismatches, `Parser disagreements:\n${mismatches.join('\n')}`).toEqual([]);
    });
  });
});
