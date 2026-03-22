/**
 * C++ parity audit: cost and build time formulas
 *
 * Verifies that EVERY unit, infantry, building, vessel, and aircraft in
 * PRODUCTION_ITEMS has correct cost (from INI) and correct buildTime
 * (derived from the C++ formula).
 *
 * Authoritative sources:
 *   rules.ini  — base Red Alert rules (ALWAYS overrides C++ constructor defaults)
 *   aftrmath.ini — Aftermath/Counterstrike expansion (overrides rules.ini per-key)
 *
 * C++ build time formula (techno.cpp:6075-6078):
 *   int TechnoTypeClass::Time_To_Build(void) const {
 *     return(Cost * Rule.BuildSpeedBias * fixed(TICKS_PER_MINUTE, 1000));
 *   }
 *
 * Constants:
 *   TICKS_PER_MINUTE = 15 * 60 = 900  (defines.h:3032, 15 Hz tick rate)
 *   Rule.BuildSpeedBias = 0.8          (rules.ini [General] BuildSpeed=.8)
 *
 * Derived formula:
 *   buildTime = floor(Cost * 0.8 * 900 / 1000) = floor(Cost * 0.72)
 *
 * Country cost biases (rules.ini [CountryName] Cost=):
 *   getEffectiveCost = max(1, round(baseCost * countryBonus.costMult))
 *
 * C++ parity: rules.ini is God. All expected values are PARSED from INI files.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import {
  PRODUCTION_ITEMS,
  COUNTRY_BONUSES,
  UNIT_STATS,
} from '../engine/types';
import { getEffectiveCost } from '../engine/production';

// ---------------------------------------------------------------------------
// INI Parser — same pattern used across all cpp-parity tests
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
// Load and merge INI files (aftrmath overrides rules, per-key within sections)
// ---------------------------------------------------------------------------

const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');
const rules = parseINI(readFileSync(join(assetsDir, 'rules.ini'), 'utf-8'));
const aftrmath = parseINI(readFileSync(join(assetsDir, 'aftrmath.ini'), 'utf-8'));

// Merge: per-key override within each section (Aftermath takes precedence)
const ini: Record<string, Record<string, string>> = {};
for (const [section, values] of Object.entries(rules)) {
  ini[section] = { ...values };
}
for (const [section, values] of Object.entries(aftrmath)) {
  ini[section] = { ...(ini[section] || {}), ...values };
}

// ---------------------------------------------------------------------------
// Parse BuildSpeed from INI [General] section
// ---------------------------------------------------------------------------

const iniBuildSpeed = parseFloat(ini['General']?.['BuildSpeed'] ?? '0.8');

// C++ defines.h:3032 — TICKS_PER_SECOND = 15, TICKS_PER_MINUTE = 15*60 = 900
const TICKS_PER_MINUTE = 900;

/**
 * C++ techno.cpp:6077 build time formula, using INI-parsed BuildSpeed.
 * buildTime = floor(Cost * BuildSpeed * TICKS_PER_MINUTE / 1000)
 */
function cppBuildTime(cost: number): number {
  return Math.floor(cost * iniBuildSpeed * TICKS_PER_MINUTE / 1000);
}

// ---------------------------------------------------------------------------
// Country names that have INI [CountryName] sections with Cost= fields
// ---------------------------------------------------------------------------

const COUNTRY_NAMES = [
  'England', 'Germany', 'France', 'Ukraine', 'USSR',
  'Greece', 'Turkey', 'Spain',
];

// ===========================================================================
// 1. INI [General] BuildSpeed sanity — the formula constant
// ===========================================================================

describe('1. INI [General] BuildSpeed constant', () => {
  it('rules.ini BuildSpeed should be 0.8', () => {
    expect(ini['General']).toBeDefined();
    expect(ini['General']['BuildSpeed']).toBe('.8');
    expect(iniBuildSpeed).toBe(0.8);
  });

  it('TICKS_PER_MINUTE should be 900 (15 Hz * 60)', () => {
    expect(TICKS_PER_MINUTE).toBe(900);
  });

  it('build time multiplier should be 0.72 (0.8 * 900 / 1000)', () => {
    const multiplier = iniBuildSpeed * TICKS_PER_MINUTE / 1000;
    expect(multiplier).toBeCloseTo(0.72, 10);
  });
});

// ===========================================================================
// 2. EVERY PRODUCTION_ITEMS cost vs INI Cost= (parsed, never hardcoded)
// ===========================================================================

describe('2. PRODUCTION_ITEMS cost vs INI Cost= for every item', () => {
  // Items known to have no Cost= in INI (empty or missing)
  const KNOWN_NO_INI_COST = new Set(['HOSP', 'BIO', 'WOOD', 'MISS']);

  for (const item of PRODUCTION_ITEMS) {
    const iniSection = ini[item.type];

    if (!iniSection) {
      it(`${item.type}: should have INI section`, () => {
        expect(iniSection, `${item.type} missing INI section entirely`).toBeDefined();
      });
      continue;
    }

    if (KNOWN_NO_INI_COST.has(item.type) || !iniSection.Cost || iniSection.Cost === '') {
      continue; // skip items with no Cost= in INI
    }

    it(`${item.type} (${item.name}): cost=${item.cost} should match INI Cost=${iniSection.Cost}`, () => {
      const iniCost = parseInt(iniSection.Cost, 10);
      expect(Number.isNaN(iniCost)).toBe(false);
      expect(item.cost, `${item.type} cost mismatch: TS=${item.cost}, INI=${iniCost}`).toBe(iniCost);
    });
  }
});

// ===========================================================================
// 3. EVERY PRODUCTION_ITEMS buildTime vs C++ formula using INI-parsed cost
// ===========================================================================

describe('3. PRODUCTION_ITEMS buildTime vs C++ formula floor(INI_Cost * BuildSpeed * 900 / 1000)', () => {
  for (const item of PRODUCTION_ITEMS) {
    const expectedBuildTime = cppBuildTime(item.cost);

    it(`${item.type} (${item.name}): buildTime=${item.buildTime} should equal floor(${item.cost} * ${iniBuildSpeed} * ${TICKS_PER_MINUTE} / 1000) = ${expectedBuildTime}`, () => {
      expect(
        item.buildTime,
        `${item.type} buildTime mismatch: TS=${item.buildTime}, expected=${expectedBuildTime}`
      ).toBe(expectedBuildTime);
    });
  }
});

// ===========================================================================
// 4. buildTime is derived from INI Cost, not from hardcoded TS cost
//    (verify that if INI cost and TS cost differ, the build time uses TS cost)
// ===========================================================================

describe('4. buildTime derivation consistency: buildTime = floor(item.cost * 0.72)', () => {
  for (const item of PRODUCTION_ITEMS) {
    it(`${item.type}: buildTime should be internally consistent with its own cost`, () => {
      const expected = cppBuildTime(item.cost);
      expect(
        item.buildTime,
        `${item.type}: buildTime=${item.buildTime} not consistent with cost=${item.cost}, expected=${expected}`
      ).toBe(expected);
    });
  }
});

// ===========================================================================
// 5. Cross-check: INI Cost -> expected buildTime -> actual buildTime
//    End-to-end: parse cost from INI, compute formula, compare to TS runtime
// ===========================================================================

describe('5. End-to-end: INI Cost -> C++ formula -> TS buildTime', () => {
  const SKIP_ITEMS = new Set(['HOSP', 'BIO', 'WOOD', 'MISS']);

  for (const item of PRODUCTION_ITEMS) {
    if (SKIP_ITEMS.has(item.type)) continue;
    const iniSection = ini[item.type];
    if (!iniSection || !iniSection.Cost || iniSection.Cost === '') continue;

    const iniCost = parseInt(iniSection.Cost, 10);
    if (Number.isNaN(iniCost)) continue;

    const expectedBuildTime = cppBuildTime(iniCost);

    it(`${item.type}: INI Cost=${iniCost} -> formula -> buildTime=${expectedBuildTime}, TS has buildTime=${item.buildTime}`, () => {
      // If cost matches INI, buildTime should also match the formula applied to INI cost
      expect(
        item.buildTime,
        `${item.type} end-to-end mismatch: INI Cost=${iniCost}, expected buildTime=${expectedBuildTime}, got ${item.buildTime}`
      ).toBe(expectedBuildTime);
    });
  }
});

// ===========================================================================
// 6. Country cost biases vs INI [CountryName] Cost= values
// ===========================================================================

describe('6. Country cost biases: COUNTRY_BONUSES.costMult vs INI Cost=', () => {
  for (const country of COUNTRY_NAMES) {
    const iniSection = ini[country];

    it(`${country}: INI section should exist`, () => {
      expect(iniSection, `${country} missing INI section`).toBeDefined();
    });

    if (!iniSection || !iniSection.Cost) continue;

    const iniCostMult = parseFloat(iniSection.Cost);

    it(`${country}: COUNTRY_BONUSES costMult=${COUNTRY_BONUSES[country]?.costMult} should match INI Cost=${iniSection.Cost}`, () => {
      const tsBonus = COUNTRY_BONUSES[country];
      expect(tsBonus, `${country} missing from COUNTRY_BONUSES`).toBeDefined();
      expect(
        tsBonus.costMult,
        `${country} costMult mismatch: TS=${tsBonus.costMult}, INI=${iniCostMult}`
      ).toBeCloseTo(iniCostMult, 5);
    });
  }
});

// ===========================================================================
// 7. Country buildTime biases vs INI [CountryName] BuildTime= values
// ===========================================================================

describe('7. Country buildTime biases: COUNTRY_BONUSES.buildTimeMult vs INI BuildTime=', () => {
  for (const country of COUNTRY_NAMES) {
    const iniSection = ini[country];
    if (!iniSection || !iniSection.BuildTime) continue;

    const iniBuildTimeMult = parseFloat(iniSection.BuildTime);

    it(`${country}: COUNTRY_BONUSES buildTimeMult=${COUNTRY_BONUSES[country]?.buildTimeMult} should match INI BuildTime=${iniSection.BuildTime}`, () => {
      const tsBonus = COUNTRY_BONUSES[country];
      expect(tsBonus, `${country} missing from COUNTRY_BONUSES`).toBeDefined();
      expect(
        tsBonus.buildTimeMult,
        `${country} buildTimeMult mismatch: TS=${tsBonus.buildTimeMult}, INI=${iniBuildTimeMult}`
      ).toBeCloseTo(iniBuildTimeMult, 5);
    });
  }
});

// ===========================================================================
// 8. USSR special case: Cost=0.9 (10% cheaper)
// ===========================================================================

describe('8. USSR cost discount: Cost=0.9 in INI', () => {
  it('USSR INI Cost=0.9', () => {
    expect(ini['USSR']?.Cost).toBe('0.9');
  });

  it('COUNTRY_BONUSES USSR costMult should be 0.9', () => {
    expect(COUNTRY_BONUSES['USSR']?.costMult).toBe(0.9);
  });

  it('getEffectiveCost applies USSR 10% discount correctly', () => {
    // Pick a representative item (2TNK costs 800)
    const tank = PRODUCTION_ITEMS.find(i => i.type === '2TNK');
    expect(tank).toBeDefined();
    if (!tank) return;

    const effectiveCost = getEffectiveCost(tank, 'USSR' as any);
    // 800 * 0.9 = 720
    const expectedCost = Math.max(1, Math.round(tank.cost * 0.9));
    expect(effectiveCost).toBe(expectedCost);
  });

  it('getEffectiveCost for every PRODUCTION_ITEMS item with USSR discount', () => {
    const ussrCostMult = parseFloat(ini['USSR']?.Cost ?? '1.0');

    for (const item of PRODUCTION_ITEMS) {
      const effectiveCost = getEffectiveCost(item, 'USSR' as any);
      const expected = Math.max(1, Math.round(item.cost * ussrCostMult));
      expect(
        effectiveCost,
        `${item.type} USSR effective cost: got=${effectiveCost}, expected=${expected} (base=${item.cost} * ${ussrCostMult})`
      ).toBe(expected);
    }
  });
});

// ===========================================================================
// 9. Non-USSR countries: Cost=1.0 (no discount)
// ===========================================================================

describe('9. Non-USSR countries all have Cost=1.0', () => {
  const nonUSSR = COUNTRY_NAMES.filter(c => c !== 'USSR');

  for (const country of nonUSSR) {
    it(`${country}: INI Cost=1.0`, () => {
      const iniCost = ini[country]?.Cost;
      expect(iniCost).toBeDefined();
      expect(parseFloat(iniCost!)).toBe(1.0);
    });

    it(`${country}: COUNTRY_BONUSES costMult=1.0`, () => {
      expect(COUNTRY_BONUSES[country]?.costMult).toBe(1.0);
    });

    it(`${country}: getEffectiveCost returns base cost (no modification)`, () => {
      for (const item of PRODUCTION_ITEMS) {
        const effectiveCost = getEffectiveCost(item, country as any);
        // costMult=1.0 means effective = max(1, round(cost * 1.0)) = cost
        expect(
          effectiveCost,
          `${item.type} ${country} effective cost should equal base cost ${item.cost}`
        ).toBe(Math.max(1, Math.round(item.cost * 1.0)));
      }
    });
  }
});

// ===========================================================================
// 10. All countries: BuildTime=1.0 (no country modifies build speed in base RA)
// ===========================================================================

describe('10. All countries have BuildTime=1.0 (no country-level build speed modification)', () => {
  for (const country of COUNTRY_NAMES) {
    it(`${country}: INI BuildTime=1.0`, () => {
      const iniBT = ini[country]?.BuildTime;
      expect(iniBT).toBeDefined();
      expect(parseFloat(iniBT!)).toBe(1.0);
    });

    it(`${country}: COUNTRY_BONUSES buildTimeMult=1.0`, () => {
      expect(COUNTRY_BONUSES[country]?.buildTimeMult).toBe(1.0);
    });
  }
});

// ===========================================================================
// 11. Infantry costs: INI-parsed vs TS PRODUCTION_ITEMS
// ===========================================================================

describe('11. Infantry costs (individual verification)', () => {
  const INFANTRY_TYPES = ['E1', 'E2', 'E3', 'E4', 'E6', 'E7', 'DOG', 'SPY', 'THF', 'MEDI', 'SHOK', 'MECH'];

  for (const type of INFANTRY_TYPES) {
    const iniSection = ini[type];
    const prodItem = PRODUCTION_ITEMS.find(i => i.type === type);

    it(`${type}: exists in both INI and PRODUCTION_ITEMS`, () => {
      expect(iniSection, `${type} missing from INI`).toBeDefined();
      expect(prodItem, `${type} missing from PRODUCTION_ITEMS`).toBeDefined();
    });

    if (!iniSection || !prodItem || !iniSection.Cost) continue;

    const iniCost = parseInt(iniSection.Cost, 10);

    it(`${type}: cost=${prodItem.cost} matches INI Cost=${iniCost}`, () => {
      expect(prodItem.cost).toBe(iniCost);
    });

    it(`${type}: buildTime=${prodItem.buildTime} matches formula floor(${iniCost} * 0.72) = ${cppBuildTime(iniCost)}`, () => {
      expect(prodItem.buildTime).toBe(cppBuildTime(iniCost));
    });
  }
});

// ===========================================================================
// 12. Vehicle costs: INI-parsed vs TS PRODUCTION_ITEMS
// ===========================================================================

describe('12. Vehicle costs (individual verification)', () => {
  const VEHICLE_TYPES = [
    'V2RL', '1TNK', '2TNK', '3TNK', '4TNK',
    'MRJ', 'MGG', 'ARTY', 'HARV', 'JEEP', 'APC', 'MNLY',
    'STNK', 'CTNK', 'TTNK', 'QTNK', 'DTRK',
  ];

  for (const type of VEHICLE_TYPES) {
    const iniSection = ini[type];
    const prodItem = PRODUCTION_ITEMS.find(i => i.type === type);

    it(`${type}: exists in both INI and PRODUCTION_ITEMS`, () => {
      expect(iniSection, `${type} missing from INI`).toBeDefined();
      expect(prodItem, `${type} missing from PRODUCTION_ITEMS`).toBeDefined();
    });

    if (!iniSection || !prodItem || !iniSection.Cost) continue;

    const iniCost = parseInt(iniSection.Cost, 10);

    it(`${type}: cost=${prodItem.cost} matches INI Cost=${iniCost}`, () => {
      expect(prodItem.cost).toBe(iniCost);
    });

    it(`${type}: buildTime=${prodItem.buildTime} matches formula floor(${iniCost} * 0.72) = ${cppBuildTime(iniCost)}`, () => {
      expect(prodItem.buildTime).toBe(cppBuildTime(iniCost));
    });
  }
});

// ===========================================================================
// 13. Naval costs: INI-parsed vs TS PRODUCTION_ITEMS
// ===========================================================================

describe('13. Naval unit costs (individual verification)', () => {
  const NAVAL_TYPES = ['SS', 'DD', 'CA', 'LST', 'PT', 'MSUB'];

  for (const type of NAVAL_TYPES) {
    const iniSection = ini[type];
    const prodItem = PRODUCTION_ITEMS.find(i => i.type === type);

    it(`${type}: exists in both INI and PRODUCTION_ITEMS`, () => {
      expect(iniSection, `${type} missing from INI`).toBeDefined();
      expect(prodItem, `${type} missing from PRODUCTION_ITEMS`).toBeDefined();
    });

    if (!iniSection || !prodItem || !iniSection.Cost) continue;

    const iniCost = parseInt(iniSection.Cost, 10);

    it(`${type}: cost=${prodItem.cost} matches INI Cost=${iniCost}`, () => {
      expect(prodItem.cost).toBe(iniCost);
    });

    it(`${type}: buildTime=${prodItem.buildTime} matches formula floor(${iniCost} * 0.72) = ${cppBuildTime(iniCost)}`, () => {
      expect(prodItem.buildTime).toBe(cppBuildTime(iniCost));
    });
  }
});

// ===========================================================================
// 14. Aircraft costs: INI-parsed vs TS PRODUCTION_ITEMS
// ===========================================================================

describe('14. Aircraft costs (individual verification)', () => {
  const AIRCRAFT_TYPES = ['MIG', 'YAK', 'TRAN', 'HELI', 'HIND'];

  for (const type of AIRCRAFT_TYPES) {
    const iniSection = ini[type];
    const prodItem = PRODUCTION_ITEMS.find(i => i.type === type);

    it(`${type}: exists in both INI and PRODUCTION_ITEMS`, () => {
      expect(iniSection, `${type} missing from INI`).toBeDefined();
      expect(prodItem, `${type} missing from PRODUCTION_ITEMS`).toBeDefined();
    });

    if (!iniSection || !prodItem || !iniSection.Cost) continue;

    const iniCost = parseInt(iniSection.Cost, 10);

    it(`${type}: cost=${prodItem.cost} matches INI Cost=${iniCost}`, () => {
      expect(prodItem.cost).toBe(iniCost);
    });

    it(`${type}: buildTime=${prodItem.buildTime} matches formula floor(${iniCost} * 0.72) = ${cppBuildTime(iniCost)}`, () => {
      expect(prodItem.buildTime).toBe(cppBuildTime(iniCost));
    });
  }
});

// ===========================================================================
// 15. Building/structure costs: INI-parsed vs TS PRODUCTION_ITEMS
// ===========================================================================

describe('15. Building/structure costs (individual verification)', () => {
  const BUILDING_TYPES = [
    'FACT', 'POWR', 'APWR', 'BARR', 'TENT', 'PROC', 'WEAP',
    'SILO', 'DOME', 'FIX', 'HPAD', 'AFLD',
    'PBOX', 'HBOX', 'GUN', 'AGUN', 'GAP', 'FTUR', 'TSLA', 'SAM', 'KENN',
    'SYRD', 'SPEN',
    'ATEK', 'STEK', 'PDOX', 'IRON', 'MSLO',
  ];

  for (const type of BUILDING_TYPES) {
    const iniSection = ini[type];
    const prodItem = PRODUCTION_ITEMS.find(i => i.type === type);

    it(`${type}: exists in both INI and PRODUCTION_ITEMS`, () => {
      expect(iniSection, `${type} missing from INI`).toBeDefined();
      expect(prodItem, `${type} missing from PRODUCTION_ITEMS`).toBeDefined();
    });

    if (!iniSection || !prodItem || !iniSection.Cost) continue;

    const iniCost = parseInt(iniSection.Cost, 10);

    it(`${type}: cost=${prodItem.cost} matches INI Cost=${iniCost}`, () => {
      expect(prodItem.cost).toBe(iniCost);
    });

    it(`${type}: buildTime=${prodItem.buildTime} matches formula floor(${iniCost} * 0.72) = ${cppBuildTime(iniCost)}`, () => {
      expect(prodItem.buildTime).toBe(cppBuildTime(iniCost));
    });
  }
});

// ===========================================================================
// 16. Wall costs: INI-parsed vs TS PRODUCTION_ITEMS
// ===========================================================================

describe('16. Wall costs (individual verification)', () => {
  const WALL_TYPES = ['SBAG', 'FENC', 'BRIK'];

  for (const type of WALL_TYPES) {
    const iniSection = ini[type];
    const prodItem = PRODUCTION_ITEMS.find(i => i.type === type);

    it(`${type}: exists in both INI and PRODUCTION_ITEMS`, () => {
      expect(iniSection, `${type} missing from INI`).toBeDefined();
      expect(prodItem, `${type} missing from PRODUCTION_ITEMS`).toBeDefined();
    });

    if (!iniSection || !prodItem || !iniSection.Cost) continue;

    const iniCost = parseInt(iniSection.Cost, 10);

    it(`${type}: cost=${prodItem.cost} matches INI Cost=${iniCost}`, () => {
      expect(prodItem.cost).toBe(iniCost);
    });

    it(`${type}: buildTime=${prodItem.buildTime} matches formula floor(${iniCost} * 0.72) = ${cppBuildTime(iniCost)}`, () => {
      expect(prodItem.buildTime).toBe(cppBuildTime(iniCost));
    });
  }
});

// ===========================================================================
// 17. Fake building costs: INI-parsed vs TS PRODUCTION_ITEMS
// ===========================================================================

describe('17. Fake building costs (individual verification)', () => {
  const FAKE_TYPES = ['FACF', 'WEAF', 'SYRF', 'SPEF', 'DOMF'];

  for (const type of FAKE_TYPES) {
    const iniSection = ini[type];
    const prodItem = PRODUCTION_ITEMS.find(i => i.type === type);

    it(`${type}: exists in both INI and PRODUCTION_ITEMS`, () => {
      expect(iniSection, `${type} missing from INI`).toBeDefined();
      expect(prodItem, `${type} missing from PRODUCTION_ITEMS`).toBeDefined();
    });

    if (!iniSection || !prodItem || !iniSection.Cost) continue;

    const iniCost = parseInt(iniSection.Cost, 10);

    it(`${type}: cost=${prodItem.cost} matches INI Cost=${iniCost}`, () => {
      expect(prodItem.cost).toBe(iniCost);
    });

    it(`${type}: buildTime=${prodItem.buildTime} matches formula floor(${iniCost} * 0.72) = ${cppBuildTime(iniCost)}`, () => {
      expect(prodItem.buildTime).toBe(cppBuildTime(iniCost));
    });
  }
});

// ===========================================================================
// 18. Aftermath expansion overrides: verify aftrmath.ini Cost= takes precedence
// ===========================================================================

describe('18. Aftermath expansion cost overrides (aftrmath.ini takes precedence over rules.ini)', () => {
  // These units have Cost= in aftrmath.ini that should override rules.ini
  const AFTERMATH_UNITS: { type: string; rulesIniCost: string | undefined; aftrmathCost: string }[] = [];

  // Dynamically discover Aftermath overrides
  for (const [section, values] of Object.entries(aftrmath)) {
    if (!values.Cost || values.Cost === '') continue;
    // Only check units that also exist in rules.ini
    if (rules[section]?.Cost && rules[section].Cost !== values.Cost) {
      AFTERMATH_UNITS.push({
        type: section,
        rulesIniCost: rules[section].Cost,
        aftrmathCost: values.Cost,
      });
    }
  }

  it('should have identified Aftermath cost overrides (if any exist)', () => {
    // This is informational — some units may have same cost in both files
    // The test below verifies the merged value is used
    expect(true).toBe(true);
  });

  // For all items that aftrmath.ini defines Cost for, verify merged value
  for (const [section, values] of Object.entries(aftrmath)) {
    if (!values.Cost || values.Cost === '') continue;
    const aftCost = parseInt(values.Cost, 10);
    if (Number.isNaN(aftCost)) continue;

    const prodItem = PRODUCTION_ITEMS.find(i => i.type === section);
    if (!prodItem) continue;

    it(`${section}: TS cost=${prodItem.cost} should match aftrmath.ini Cost=${values.Cost} (merged)`, () => {
      const mergedCost = parseInt(ini[section]?.Cost ?? '0', 10);
      expect(mergedCost, `${section} merged INI cost should equal aftrmath value`).toBe(aftCost);
      expect(prodItem.cost, `${section} TS cost should match merged INI`).toBe(mergedCost);
    });
  }
});

// ===========================================================================
// 19. UNIT_STATS.cost vs PRODUCTION_ITEMS.cost consistency
// ===========================================================================

describe('19. Cost consistency: UNIT_STATS.cost === PRODUCTION_ITEMS.cost', () => {
  for (const item of PRODUCTION_ITEMS) {
    const stats = UNIT_STATS[item.type];
    if (!stats || stats.cost === undefined) continue;

    it(`${item.type}: UNIT_STATS.cost=${stats.cost} should equal PRODUCTION_ITEMS.cost=${item.cost}`, () => {
      expect(stats.cost).toBe(item.cost);
    });
  }
});

// ===========================================================================
// 20. UNIT_STATS.cost vs INI Cost= (for units that have UNIT_STATS entries)
// ===========================================================================

describe('20. UNIT_STATS.cost vs INI Cost=', () => {
  for (const [unitId, stats] of Object.entries(UNIT_STATS)) {
    if (stats.cost === undefined) continue;
    const iniSection = ini[unitId];
    if (!iniSection || !iniSection.Cost || iniSection.Cost === '') continue;

    const iniCost = parseInt(iniSection.Cost, 10);
    if (Number.isNaN(iniCost)) continue;

    it(`${unitId}: UNIT_STATS.cost=${stats.cost} should match INI Cost=${iniCost}`, () => {
      expect(stats.cost).toBe(iniCost);
    });
  }
});

// ===========================================================================
// 21. Specific high-value verifications (key items that commonly diverge)
// ===========================================================================

describe('21. Key items: specific cost/buildTime spot checks from INI', () => {
  const KEY_ITEMS: { type: string; description: string }[] = [
    { type: '4TNK', description: 'Mammoth Tank — most expensive vehicle' },
    { type: 'PDOX', description: 'Chronosphere — most expensive Allied superweapon' },
    { type: 'IRON', description: 'Iron Curtain — most expensive Soviet superweapon' },
    { type: 'MSLO', description: 'Missile Silo — nuclear launch building' },
    { type: 'E1', description: 'Rifle Infantry — cheapest unit' },
    { type: 'SBAG', description: 'Sandbag wall — cheapest structure' },
    { type: 'HARV', description: 'Harvester — key economy unit' },
    { type: 'PROC', description: 'Refinery — key economy building' },
    { type: 'DTRK', description: 'Demo Truck — Aftermath unit with MSLO prereq' },
    { type: 'QTNK', description: 'M.A.D. Tank — Aftermath Cost=2300' },
    { type: 'MSUB', description: 'Missile Sub — Aftermath Cost=1650' },
    { type: 'SHOK', description: 'Shock Trooper — Aftermath Cost=900' },
    { type: 'MECH', description: 'Mechanic — Aftermath Cost=950' },
    { type: 'CTNK', description: 'Chrono Tank — Aftermath Cost=2400' },
  ];

  for (const { type, description } of KEY_ITEMS) {
    const iniSection = ini[type];
    const prodItem = PRODUCTION_ITEMS.find(i => i.type === type);

    it(`${type} (${description}): cost and buildTime match INI`, () => {
      expect(iniSection, `${type} should have INI section`).toBeDefined();
      expect(prodItem, `${type} should be in PRODUCTION_ITEMS`).toBeDefined();
      if (!iniSection || !prodItem) return;

      const iniCost = parseInt(iniSection.Cost, 10);
      expect(Number.isNaN(iniCost)).toBe(false);
      expect(prodItem.cost, `${type} cost`).toBe(iniCost);
      expect(prodItem.buildTime, `${type} buildTime`).toBe(cppBuildTime(iniCost));
    });
  }
});

// ===========================================================================
// 22. Build time proportionality invariant
// ===========================================================================

describe('22. Build time proportionality: costlier items take proportionally longer', () => {
  it('items with same cost should have same buildTime', () => {
    const costGroups = new Map<number, string[]>();
    for (const item of PRODUCTION_ITEMS) {
      const group = costGroups.get(item.cost) ?? [];
      group.push(item.type);
      costGroups.set(item.cost, group);
    }

    for (const [cost, types] of costGroups) {
      const expectedBT = cppBuildTime(cost);
      for (const type of types) {
        const item = PRODUCTION_ITEMS.find(i => i.type === type)!;
        expect(
          item.buildTime,
          `${type} (cost=${cost}): all items at this cost should have buildTime=${expectedBT}`
        ).toBe(expectedBT);
      }
    }
  });

  it('buildTime is a monotonically non-decreasing function of cost', () => {
    const sorted = [...PRODUCTION_ITEMS].sort((a, b) => a.cost - b.cost);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].cost > sorted[i - 1].cost) {
        expect(
          sorted[i].buildTime,
          `${sorted[i].type} (cost=${sorted[i].cost}) should have buildTime >= ${sorted[i - 1].type} (cost=${sorted[i - 1].cost})`
        ).toBeGreaterThanOrEqual(sorted[i - 1].buildTime);
      }
    }
  });
});

// ===========================================================================
// 23. Zero-cost items: FACT (Construction Yard) has cost=2500 but is non-buildable
// ===========================================================================

describe('23. FACT (Construction Yard) special case', () => {
  it('FACT INI Cost=2500, TechLevel=-1 (not buildable)', () => {
    expect(ini['FACT']?.Cost).toBe('2500');
    expect(ini['FACT']?.TechLevel).toBe('-1');
  });

  it('FACT PRODUCTION_ITEMS cost=2500 (used for sell refund calculation)', () => {
    const fact = PRODUCTION_ITEMS.find(i => i.type === 'FACT');
    expect(fact).toBeDefined();
    expect(fact!.cost).toBe(2500);
  });

  it('FACT buildTime follows formula even though non-buildable (used internally)', () => {
    const fact = PRODUCTION_ITEMS.find(i => i.type === 'FACT');
    expect(fact).toBeDefined();
    expect(fact!.buildTime).toBe(cppBuildTime(2500));
  });
});

// ===========================================================================
// 24. getEffectiveCost formula: max(1, round(cost * countryBonus.costMult))
// ===========================================================================

describe('24. getEffectiveCost formula correctness', () => {
  it('Neutral house: effective cost equals base cost', () => {
    for (const item of PRODUCTION_ITEMS) {
      const effective = getEffectiveCost(item, 'Neutral' as any);
      expect(effective, `${item.type} Neutral effective cost`).toBe(
        Math.max(1, Math.round(item.cost * 1.0))
      );
    }
  });

  it('USSR house: effective cost is 90% of base cost', () => {
    const ussrMult = parseFloat(ini['USSR']?.Cost ?? '1.0');
    for (const item of PRODUCTION_ITEMS) {
      const effective = getEffectiveCost(item, 'USSR' as any);
      const expected = Math.max(1, Math.round(item.cost * ussrMult));
      expect(effective, `${item.type} USSR effective cost`).toBe(expected);
    }
  });

  it('effective cost is always >= 1 (floor guard)', () => {
    for (const country of [...COUNTRY_NAMES, 'GoodGuy', 'BadGuy', 'Neutral']) {
      for (const item of PRODUCTION_ITEMS) {
        const effective = getEffectiveCost(item, country as any);
        expect(effective, `${item.type} ${country} effective cost >= 1`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

// ===========================================================================
// 25. Completeness: every PRODUCTION_ITEMS type has been tested
// ===========================================================================

describe('25. Completeness: every PRODUCTION_ITEMS entry is covered by at least one category test', () => {
  const ALL_TESTED = new Set([
    // Infantry (section 11)
    'E1', 'E2', 'E3', 'E4', 'E6', 'E7', 'DOG', 'SPY', 'THF', 'MEDI', 'SHOK', 'MECH',
    // Vehicles (section 12)
    'V2RL', '1TNK', '2TNK', '3TNK', '4TNK', 'MRJ', 'MGG', 'ARTY', 'HARV', 'JEEP', 'APC', 'MNLY',
    'STNK', 'CTNK', 'TTNK', 'QTNK', 'DTRK',
    // Naval (section 13)
    'SS', 'DD', 'CA', 'LST', 'PT', 'MSUB',
    // Aircraft (section 14)
    'MIG', 'YAK', 'TRAN', 'HELI', 'HIND',
    // Buildings (section 15)
    'FACT', 'POWR', 'APWR', 'BARR', 'TENT', 'PROC', 'WEAP', 'SILO', 'DOME', 'FIX', 'HPAD', 'AFLD',
    'PBOX', 'HBOX', 'GUN', 'AGUN', 'GAP', 'FTUR', 'TSLA', 'SAM', 'KENN', 'SYRD', 'SPEN',
    'ATEK', 'STEK', 'PDOX', 'IRON', 'MSLO',
    // Walls (section 16)
    'SBAG', 'FENC', 'BRIK',
    // Fakes (section 17)
    'FACF', 'WEAF', 'SYRF', 'SPEF', 'DOMF',
  ]);

  for (const item of PRODUCTION_ITEMS) {
    it(`${item.type} (${item.name}) is included in category-specific test suite`, () => {
      expect(
        ALL_TESTED.has(item.type),
        `${item.type} not covered by any category test (sections 11-17). Add it to the appropriate list.`
      ).toBe(true);
    });
  }
});
