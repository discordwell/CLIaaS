/**
 * C++ Behavioral Parity Tests -- Country Bonuses (INI-authoritative)
 *
 * Parses rules.ini country sections directly and compares every field against
 * the TS COUNTRY_BONUSES table in engine/types.ts.
 *
 * C++ sources:
 *   hdata.cpp:307-313    HouseTypeClass defaults (all biases = 1)
 *   hdata.cpp:513-525    HouseTypeClass::Read_INI — parses country sections
 *   type.h:149           fixed ROFBias; (and other bias fields)
 *   house.cpp:289-303    Assign_Handicap — multiplies country bias * difficulty bias
 *   techno.cpp:2867      Rearm_Delay: weapon->ROF * House->ROFBias
 *
 * C++ HouseTypeClass constructor defaults (hdata.cpp:307-313):
 *   FirepowerBias(1), GroundspeedBias(1), AirspeedBias(1),
 *   ArmorBias(1), ROFBias(1), CostBias(1), BuildSpeedBias(1)
 *
 * C++ HouseTypeClass::Read_INI (hdata.cpp:516-522):
 *   FirepowerBias   = ini.Get_Fixed(Name(), "Firepower", FirepowerBias);
 *   GroundspeedBias = ini.Get_Fixed(Name(), "Groundspeed", GroundspeedBias);
 *   AirspeedBias    = ini.Get_Fixed(Name(), "Airspeed", AirspeedBias);
 *   ArmorBias       = ini.Get_Fixed(Name(), "Armor", ArmorBias);
 *   ROFBias         = ini.Get_Fixed(Name(), "ROF", ROFBias);
 *   CostBias        = ini.Get_Fixed(Name(), "Cost", CostBias);
 *   BuildSpeedBias  = ini.Get_Fixed(Name(), "BuildTime", BuildSpeedBias);
 *
 * INI-to-TS field mapping:
 *   INI key       → TS CountryBonus field
 *   Firepower     → firepowerMult
 *   Groundspeed   → groundspeedMult
 *   Airspeed      → airspeedMult
 *   Armor         → armorMult
 *   ROF           → rofMult
 *   Cost          → costMult
 *   BuildTime     → buildTimeMult
 *
 * Semantic note (ROFBias):
 *   C++ techno.cpp:2867: return(weapon->ROF * House->ROFBias);
 *   ROFBias > 1.0 means LONGER rearm delay = SLOWER fire rate.
 *   France's ROF=1.1 means 10% slower fire rate, not faster.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { COUNTRY_BONUSES, type CountryBonus } from '../engine/types';

// ── Parse rules.ini ──────────────────────────────────────────────────────

const RULES_INI_PATH = resolve(__dirname, '../../../public/ra/assets/rules.ini');
const iniText = readFileSync(RULES_INI_PATH, 'utf-8');

/**
 * Minimal INI parser — extracts [Section] → key=value pairs.
 * Handles semicolon comments and blank lines.
 */
function parseIni(text: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let currentSection = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/;.*$/, '').trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      if (!sections[currentSection]) sections[currentSection] = {};
      continue;
    }
    const kvMatch = line.match(/^([^=]+)=(.*)$/);
    if (kvMatch && currentSection) {
      sections[currentSection][kvMatch[1].trim()] = kvMatch[2].trim();
    }
  }
  return sections;
}

const ini = parseIni(iniText);

// ── Country list (all 8 countries from rules.ini) ────────────────────────

const COUNTRIES = ['England', 'Germany', 'France', 'Ukraine', 'USSR', 'Greece', 'Turkey', 'Spain'] as const;

// ── INI key → TS field mapping ──────────────────────────────────────────

const INI_TO_TS: { iniKey: string; tsField: keyof CountryBonus }[] = [
  { iniKey: 'Firepower',   tsField: 'firepowerMult' },
  { iniKey: 'Groundspeed', tsField: 'groundspeedMult' },
  { iniKey: 'Airspeed',    tsField: 'airspeedMult' },
  { iniKey: 'Armor',       tsField: 'armorMult' },
  { iniKey: 'ROF',         tsField: 'rofMult' },
  { iniKey: 'Cost',        tsField: 'costMult' },
  { iniKey: 'BuildTime',   tsField: 'buildTimeMult' },
];

// ── C++ default bias (hdata.cpp:307-313) ────────────────────────────────

const CPP_DEFAULT_BIAS = 1.0; // All biases default to fixed(1)

// ── Tests ────────────────────────────────────────────────────────────────

describe('Country Bonuses — rules.ini parity (hdata.cpp:513-525)', () => {

  describe('INI parse sanity', () => {
    it('rules.ini contains all 8 country sections', () => {
      for (const country of COUNTRIES) {
        expect(ini[country], `[${country}] section missing from rules.ini`).toBeDefined();
      }
    });

    it('each country section has all 7 bias keys', () => {
      for (const country of COUNTRIES) {
        for (const { iniKey } of INI_TO_TS) {
          expect(
            ini[country][iniKey],
            `[${country}] missing key ${iniKey}`
          ).toBeDefined();
        }
      }
    });
  });

  describe('TS COUNTRY_BONUSES has entries for all 8 countries', () => {
    for (const country of COUNTRIES) {
      it(`COUNTRY_BONUSES["${country}"] exists`, () => {
        expect(COUNTRY_BONUSES[country], `Missing COUNTRY_BONUSES["${country}"]`).toBeDefined();
      });
    }
  });

  describe('per-country per-field INI ↔ TS value match', () => {
    for (const country of COUNTRIES) {
      describe(`[${country}]`, () => {
        for (const { iniKey, tsField } of INI_TO_TS) {
          it(`${iniKey} (INI) === ${tsField} (TS)`, () => {
            const iniSection = ini[country];
            expect(iniSection, `[${country}] section not found in rules.ini`).toBeDefined();

            const iniValue = parseFloat(iniSection[iniKey]);
            expect(isNaN(iniValue), `[${country}] ${iniKey} is not a number: "${iniSection[iniKey]}"`).toBe(false);

            const tsBonus = COUNTRY_BONUSES[country];
            expect(tsBonus, `COUNTRY_BONUSES["${country}"] not found`).toBeDefined();

            const tsValue = tsBonus[tsField];
            expect(tsValue, `[${country}].${tsField} === INI [${country}].${iniKey}`).toBeCloseTo(iniValue, 4);
          });
        }
      });
    }
  });

  describe('countries with non-default bonuses (the interesting ones)', () => {
    // rules.ini [England]: Armor=1.1 — all others 1.0
    it('England: Armor=1.1 (10% tougher, hdata.cpp → rules.ini)', () => {
      expect(COUNTRY_BONUSES.England.armorMult).toBeCloseTo(1.1, 4);
      expect(parseFloat(ini.England.Armor)).toBeCloseTo(1.1, 4);
    });

    // rules.ini [Germany]: Firepower=1.1 — all others 1.0
    it('Germany: Firepower=1.1 (10% more damage, hdata.cpp → rules.ini)', () => {
      expect(COUNTRY_BONUSES.Germany.firepowerMult).toBeCloseTo(1.1, 4);
      expect(parseFloat(ini.Germany.Firepower)).toBeCloseTo(1.1, 4);
    });

    // rules.ini [France]: ROF=1.1 — all others 1.0
    // Semantic note: ROF=1.1 means 10% LONGER rearm = SLOWER fire rate
    // (techno.cpp:2867: weapon->ROF * House->ROFBias)
    it('France: ROF=1.1 (10% longer rearm delay, techno.cpp:2867)', () => {
      expect(COUNTRY_BONUSES.France.rofMult).toBeCloseTo(1.1, 4);
      expect(parseFloat(ini.France.ROF)).toBeCloseTo(1.1, 4);
    });

    // rules.ini [Ukraine]: Groundspeed=1.1 — all others 1.0
    it('Ukraine: Groundspeed=1.1 (10% faster ground units)', () => {
      expect(COUNTRY_BONUSES.Ukraine.groundspeedMult).toBeCloseTo(1.1, 4);
      expect(parseFloat(ini.Ukraine.Groundspeed)).toBeCloseTo(1.1, 4);
    });

    // rules.ini [USSR]: Cost=0.9 — all others 1.0
    it('USSR: Cost=0.9 (10% cheaper production)', () => {
      expect(COUNTRY_BONUSES.USSR.costMult).toBeCloseTo(0.9, 4);
      expect(parseFloat(ini.USSR.Cost)).toBeCloseTo(0.9, 4);
    });
  });

  describe('countries with ALL default bonuses (all 1.0)', () => {
    const defaultCountries = ['Spain', 'Greece', 'Turkey'] as const;

    for (const country of defaultCountries) {
      it(`[${country}] has all biases = 1.0 (C++ default, hdata.cpp:307-313)`, () => {
        const tsBonus = COUNTRY_BONUSES[country];
        for (const { iniKey, tsField } of INI_TO_TS) {
          const iniVal = parseFloat(ini[country][iniKey]);
          expect(iniVal, `[${country}].${iniKey} should be default 1.0`).toBeCloseTo(CPP_DEFAULT_BIAS, 4);
          expect(tsBonus[tsField], `COUNTRY_BONUSES.${country}.${tsField} should be 1.0`).toBeCloseTo(CPP_DEFAULT_BIAS, 4);
        }
      });
    }
  });

  describe('non-bonus countries get TS defaults of 1.0 (no INI section)', () => {
    // GoodGuy, BadGuy, Neutral have no [Section] in rules.ini
    // C++ defaults all biases to 1 (hdata.cpp:307-313)
    const metaHouses = ['GoodGuy', 'BadGuy', 'Neutral'] as const;

    for (const house of metaHouses) {
      it(`COUNTRY_BONUSES["${house}"] exists with all 1.0 defaults`, () => {
        const tsBonus = COUNTRY_BONUSES[house];
        expect(tsBonus, `Missing COUNTRY_BONUSES["${house}"]`).toBeDefined();
        for (const { tsField } of INI_TO_TS) {
          expect(
            tsBonus[tsField],
            `${house}.${tsField} should be 1.0 (C++ default)`
          ).toBeCloseTo(CPP_DEFAULT_BIAS, 4);
        }
      });

      it(`[${house}] has no section in rules.ini (uses C++ defaults)`, () => {
        // These houses may or may not have INI sections — if absent, C++ default applies
        // If present, all values should be 1.0 anyway
        if (ini[house]) {
          for (const { iniKey } of INI_TO_TS) {
            if (ini[house][iniKey]) {
              expect(parseFloat(ini[house][iniKey])).toBeCloseTo(CPP_DEFAULT_BIAS, 4);
            }
          }
        }
        // Either way, TS values should be 1.0
        const tsBonus = COUNTRY_BONUSES[house];
        for (const { tsField } of INI_TO_TS) {
          expect(tsBonus[tsField]).toBeCloseTo(CPP_DEFAULT_BIAS, 4);
        }
      });
    }
  });

  describe('each non-default bonus is unique to exactly one country', () => {
    // In rules.ini, each bonus type (Armor, Firepower, ROF, Groundspeed, Cost)
    // is boosted for exactly one country. Verify no accidental duplication.

    it('only England has Armor != 1.0', () => {
      const armorCountries = COUNTRIES.filter(c => parseFloat(ini[c].Armor) !== 1.0);
      expect(armorCountries).toEqual(['England']);
    });

    it('only Germany has Firepower != 1.0', () => {
      const fpCountries = COUNTRIES.filter(c => parseFloat(ini[c].Firepower) !== 1.0);
      expect(fpCountries).toEqual(['Germany']);
    });

    it('only France has ROF != 1.0', () => {
      const rofCountries = COUNTRIES.filter(c => parseFloat(ini[c].ROF) !== 1.0);
      expect(rofCountries).toEqual(['France']);
    });

    it('only Ukraine has Groundspeed != 1.0', () => {
      const gsCountries = COUNTRIES.filter(c => parseFloat(ini[c].Groundspeed) !== 1.0);
      expect(gsCountries).toEqual(['Ukraine']);
    });

    it('only USSR has Cost != 1.0', () => {
      const costCountries = COUNTRIES.filter(c => parseFloat(ini[c].Cost) !== 1.0);
      expect(costCountries).toEqual(['USSR']);
    });

    it('no country has Airspeed != 1.0', () => {
      const asCountries = COUNTRIES.filter(c => parseFloat(ini[c].Airspeed) !== 1.0);
      expect(asCountries).toEqual([]);
    });

    it('no country has BuildTime != 1.0', () => {
      const btCountries = COUNTRIES.filter(c => parseFloat(ini[c].BuildTime) !== 1.0);
      expect(btCountries).toEqual([]);
    });
  });

  describe('ROF semantic correctness — techno.cpp:2867', () => {
    // C++: return(weapon->ROF * House->ROFBias)
    // ROFBias > 1.0 means LONGER rearm delay = SLOWER fire rate
    // France ROF=1.1: weapons take 10% LONGER to rearm (disadvantage, not advantage)

    it('France ROF=1.1 means rearm_delay = weapon.ROF * 1.1 (slower fire)', () => {
      const weaponROF = 50; // hypothetical base ROF ticks
      const franceROFBias = COUNTRY_BONUSES.France.rofMult;
      const defaultROFBias = COUNTRY_BONUSES.Greece.rofMult; // Greece has no bonus

      const franceRearm = Math.round(weaponROF * franceROFBias);
      const defaultRearm = Math.round(weaponROF * defaultROFBias);

      // France should have LONGER rearm (more ticks between shots)
      expect(franceRearm).toBeGreaterThan(defaultRearm);
      expect(franceRearm).toBe(55); // 50 * 1.1 = 55
      expect(defaultRearm).toBe(50); // 50 * 1.0 = 50
    });
  });

  describe('HOUSE_FIREPOWER_BIAS derived table consistency', () => {
    // types.ts:139-141: HOUSE_FIREPOWER_BIAS is derived from COUNTRY_BONUSES
    it('HOUSE_FIREPOWER_BIAS matches COUNTRY_BONUSES.firepowerMult for all entries', async () => {
      const { HOUSE_FIREPOWER_BIAS } = await import('../engine/types');
      for (const [house, bonus] of Object.entries(COUNTRY_BONUSES)) {
        expect(
          HOUSE_FIREPOWER_BIAS[house],
          `HOUSE_FIREPOWER_BIAS["${house}"] should equal COUNTRY_BONUSES["${house}"].firepowerMult`
        ).toBe(bonus.firepowerMult);
      }
    });
  });
});
