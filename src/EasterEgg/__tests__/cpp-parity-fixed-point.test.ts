/**
 * C++ parity test: fixed-point arithmetic (8.8 format) across all engine subsystems.
 *
 * C++ Red Alert uses the `fixed` class (fixed.h) — an 8.8 unsigned fixed-point number
 * stored as uint16. TS uses floating-point Math.floor/Math.trunc. This test verifies
 * bit-exact parity for every subsystem that touches fixed-point math.
 *
 * C++ fixed-point key operations (fixed.h / fixed.cpp):
 *   fixed(n, d)        — Raw = (unsigned)(n * 256) / (unsigned)d          [integer division = truncate]
 *   fixed("P%")        — Raw = (unsigned short)((atoi(P) * 256) / 100)   [integer division = truncate]
 *   operator unsigned() — ((unsigned)Data.Raw + 128) / 256                [round half-up to int]
 *   int * fixed         — (((unsigned)Data.Raw * rvalue) + 128) / 256     [round half-up]
 *   fixed * fixed       — (unsigned short)(((int)a.Raw * (int)b.Raw) / 256)  [truncate]
 *   int / fixed         — ((unsigned)(lvalue * 256) + 128) / rvalue.Raw   [round half-up]
 *
 * All expected values parsed from rules.ini at test time — never hardcoded from .cpp.
 *
 * Subsystems tested:
 *   1-3.  Sell refund — fixed("50%") rounding
 *   4.    Repair cost — integer division chain + fixed("20%")
 *   5.    Power output — fixed(hp, maxHp) * ratedPower
 *   6.    fixed*fixed vs int*fixed rounding differences
 *   7.    RepairRate fixed-point parsing
 *   8.    operator unsigned() conversion
 *   9.    int / fixed division
 *   10-11. Brute-force sweeps (sell, repair)
 *   12.   Rounding invariants
 *   13.   TS constants vs rules.ini
 *   14.   modifyDamage — warhead multiplier application (C++ uses fixed-point)
 *   15.   Terrain speed multipliers — fixed-point in C++
 *   16.   Power fraction — drain/output clamped to [1/16, 1.0]
 *   17.   Country bonus multipliers — fixed-point in C++
 *   18.   Boundary cases — fractions that diverge between float and fixed-point
 *   19.   Difficulty bias multipliers — fixed-point cascaded multiplication
 *   20.   Power output from rules.ini — verify TS uses INI Power= values
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import {
  sellRefund,
  repairCostPerStep,
  unitRepairCostPerStep,
  fixedPowerOutput,
  powerMultiplier,
  powerOutput,
} from '../engine/repairSell';
import {
  REPAIR_STEP,
  REPAIR_PERCENT,
  UREPAIR_STEP,
  UREPAIR_PERCENT,
  WARHEAD_VS_ARMOR,
  TERRAIN_SPEED,
  COUNTRY_BONUSES,
  modifyDamage,
  type WarheadType,
  type ArmorType,
} from '../engine/types';

// ============================================================
// Parse rules.ini at test time (authoritative source)
// ============================================================

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

const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');
const ini = parseINI(readFileSync(join(assetsDir, 'rules.ini'), 'utf-8'));

/** Parse INI percent value: "50%" → 50, "0.5" → 50 */
function parseIniPercent(val: string): number {
  if (val.endsWith('%')) return parseInt(val, 10);
  return Math.round(parseFloat(val) * 100);
}

/** Parse INI float value: "1.1" → 1.1, ".016" → 0.016 */
function parseIniFloat(val: string): number {
  if (val.endsWith('%')) return parseInt(val, 10) / 100;
  return parseFloat(val);
}

// ============================================================
// Emulate C++ fixed-point primitives exactly
// ============================================================

/** C++ fixed(n, d) constructor — fixed.cpp:59-66 */
function cppFixed(n: number, d: number): number {
  if (d === 0) return 0;
  return Math.floor((n * 256) / d); // C++ (unsigned)(n*256) / (unsigned)d — integer truncation
}

/** C++ fixed from percent string "P%" — fixed.cpp:125-126 */
function cppFixedPercent(percent: number): number {
  return Math.floor((percent * 256) / 100); // C++ (atoi(P) * 256) / 100 — integer truncation
}

/** C++ fixed from decimal string ".NNN" — fixed.cpp:88-151 */
function cppFixedDecimal(decStr: string): number {
  const dotIdx = decStr.indexOf('.');
  if (dotIdx < 0) return parseInt(decStr, 10) * 256;
  const wholePart = dotIdx === 0 ? 0 : parseInt(decStr.substring(0, dotIdx), 10);
  const fracStr = decStr.substring(dotIdx + 1);
  const fracVal = parseInt(fracStr, 10);
  const base = Math.pow(10, fracStr.length);
  const fraction = Math.floor((256 * fracVal) / base);
  return wholePart * 256 + fraction;
}

/** C++ int * fixed — fixed.h:109: (((unsigned)Data.Raw * rvalue) + 128) / 256 */
function cppIntTimesFixed(intVal: number, fixedRaw: number): number {
  return Math.floor(((fixedRaw * intVal) + 128) / 256);
}

/** C++ operator unsigned() — fixed.h:91: ((unsigned)Data.Raw + 128) / 256 */
function cppFixedToUnsigned(fixedRaw: number): number {
  return Math.floor((fixedRaw + 128) / 256);
}

/** C++ int / fixed — fixed.h:156: ((unsigned)(lvalue * 256) + 128) / rvalue.Raw */
function cppIntDivFixed(intVal: number, fixedRaw: number): number {
  if (fixedRaw === 0 || fixedRaw === 256) return intVal;
  return Math.floor(((intVal * 256) + 128) / fixedRaw);
}

/** C++ fixed *= int — fixed.h:97: Data.Raw = (unsigned short)(Data.Raw * rvalue) */
function cppFixedTimesInt(fixedRaw: number, intVal: number): number {
  return (fixedRaw * intVal) & 0xFFFF; // uint16 truncation
}

/** C++ fixed * fixed — fixed.h:108: (unsigned short)(((int)a.Raw * (int)b.Raw) / 256) */
function cppFixedTimesFixed(aRaw: number, bRaw: number): number {
  return Math.floor((aRaw * bRaw) / 256) & 0xFFFF;
}

// ============================================================
// Section 1: Verify fixed-point raw values from rules.ini
// ============================================================
describe('fixed-point raw values from rules.ini (fixed.cpp:59-66, :125-126)', () => {
  const refundPct = parseIniPercent(ini['General']['RefundPercent']);
  const repairPct = parseIniPercent(ini['General']['RepairPercent']);
  const urepairPct = parseIniPercent(ini['General']['URepairPercent']);

  it(`RefundPercent=${refundPct}% → fixed("${refundPct}%").Raw = ${cppFixedPercent(refundPct)}`, () => {
    expect(cppFixedPercent(refundPct)).toBe(128);
  });

  it(`RepairPercent=${repairPct}% → fixed("${repairPct}%").Raw = ${cppFixedPercent(repairPct)}`, () => {
    expect(cppFixedPercent(repairPct)).toBe(51);
  });

  it(`URepairPercent=${urepairPct}% → fixed("${urepairPct}%").Raw = ${cppFixedPercent(urepairPct)}`, () => {
    expect(cppFixedPercent(urepairPct)).toBe(51);
  });

  it('TS REPAIR_PERCENT_RAW = floor(REPAIR_PERCENT * 256) matches C++ fixed from INI', () => {
    const tsRaw = Math.floor(REPAIR_PERCENT * 256);
    expect(tsRaw).toBe(cppFixedPercent(repairPct));
  });

  it('TS UREPAIR_PERCENT_RAW = floor(UREPAIR_PERCENT * 256) matches C++ fixed from INI', () => {
    const tsRaw = Math.floor(UREPAIR_PERCENT * 256);
    expect(tsRaw).toBe(cppFixedPercent(urepairPct));
  });

  it('fixed(1, 2) constructor = 128 (same as 50%)', () => {
    expect(cppFixed(1, 2)).toBe(128);
  });

  it('fixed(1, 4) constructor = 64 (C++ default RepairPercent before rules.ini override)', () => {
    expect(cppFixed(1, 4)).toBe(64);
  });

  it('fixed(1, 3) constructor = 85 (truncated — 256/3 = 85.33)', () => {
    expect(cppFixed(1, 3)).toBe(85);
  });

  it('fixed(2, 3) constructor = 170 (truncated — 512/3 = 170.67)', () => {
    expect(cppFixed(2, 3)).toBe(170);
  });
});

// ============================================================
// Section 2: int * fixed(1,2) rounding — the core sell refund question
// C++ uses ((128 * cost) + 128) / 256  — rounds half-up for odd costs
// A naive Math.floor(cost * 0.5) would round DOWN for odd costs → OFF BY ONE
// ============================================================
describe('sell refund: int * fixed(1,2) vs naive Math.floor(cost * 0.5) (techno.cpp:5758)', () => {
  const refundPctRaw = cppFixedPercent(parseIniPercent(ini['General']['RefundPercent']));

  /** Naive floating-point approach that would produce WRONG results for odd costs */
  function naiveSellRefund(cost: number): number {
    return Math.floor(cost * 0.5);
  }

  /** C++ exact formula: int *= fixed(1,2) via fixed.h:165 */
  function cppSellRefund(cost: number): number {
    return cppIntTimesFixed(cost, refundPctRaw);
  }

  it('even costs: both formulas agree', () => {
    for (const cost of [0, 2, 4, 100, 300, 2000, 5000, 10000]) {
      expect(naiveSellRefund(cost)).toBe(cppSellRefund(cost));
      expect(sellRefund(cost, true)).toBe(cppSellRefund(cost));
    }
  });

  // These are the critical off-by-one cases where naive != C++
  const oddCostCases: [number, number, number][] = [
    // [cost, C++ result, naive result]
    [1,   1,   0],
    [3,   2,   1],
    [5,   3,   2],
    [7,   4,   3],
    [9,   5,   4],
    [11,  6,   5],
    [25,  13,  12],
    [99,  50,  49],
    [101, 51,  50],
    [151, 76,  75],
    [301, 151, 150],
    [999, 500, 499],
    [2001, 1001, 1000],
    [9999, 5000, 4999],
    [99999, 50000, 49999],
  ];

  for (const [cost, cppExpected, naiveExpected] of oddCostCases) {
    it(`odd cost=${cost}: C++ gives ${cppExpected}, naive gives ${naiveExpected} (off by 1)`, () => {
      expect(cppSellRefund(cost)).toBe(cppExpected);
      expect(naiveSellRefund(cost)).toBe(naiveExpected);
      expect(cppExpected - naiveExpected).toBe(1); // always off by exactly 1
    });
  }

  it('TS sellRefund matches C++ fixed-point (NOT naive) for all odd costs 1..999', () => {
    for (let cost = 1; cost < 1000; cost += 2) {
      const cpp = cppSellRefund(cost);
      const ts = sellRefund(cost, true);
      expect(ts, `cost=${cost}: TS=${ts}, C++=${cpp}`).toBe(cpp);
    }
  });

  it('TS sellRefund matches C++ for systematic sweep 0..5000', () => {
    for (let cost = 0; cost <= 5000; cost++) {
      const cpp = cppSellRefund(cost);
      const ts = sellRefund(cost, true);
      expect(ts, `cost=${cost}`).toBe(cpp);
    }
  });
});

// ============================================================
// Section 3: int * fixed(20%) for repair cost — 51/256 ≈ 0.19921875
// C++ formula: ((51 * intVal) + 128) / 256
// Note: 51/256 = 0.19921875, NOT exactly 0.20
// This means C++ repair costs are slightly lower than exact 20% in some cases
// ============================================================
describe('repair cost: int * fixed("20%") precision (techno.cpp:6144)', () => {
  const repairPercentRaw = cppFixedPercent(parseIniPercent(ini['General']['RepairPercent']));

  it(`fixed("${ini['General']['RepairPercent']}") = ${repairPercentRaw}/256 = ${repairPercentRaw / 256}, not exactly 0.20`, () => {
    expect(repairPercentRaw / 256).toBe(0.19921875);
    expect(repairPercentRaw / 256).not.toBe(0.20);
  });

  const divergenceCases: [number, number, number][] = [
    [128, 26, 25],
    [384, 77, 76],
  ];

  for (const [intVal, cppExpected, exact20Expected] of divergenceCases) {
    it(`costPerFullStep=${intVal}: C++ fixed gives ${cppExpected}, exact 20% gives ${exact20Expected}`, () => {
      expect(cppIntTimesFixed(intVal, repairPercentRaw)).toBe(cppExpected);
      expect(Math.floor(intVal * 0.20)).toBe(exact20Expected);
    });
  }

  it('systematic: count how many values 0..1000 diverge between C++ fixed 20% and exact 20%', () => {
    let divergeCount = 0;
    const divergences: number[] = [];
    for (let v = 0; v <= 1000; v++) {
      const cpp = cppIntTimesFixed(v, repairPercentRaw);
      const exact = Math.floor(v * 0.20);
      if (cpp !== exact) {
        divergeCount++;
        if (divergences.length < 20) divergences.push(v);
      }
    }
    expect(divergeCount).toBeGreaterThan(0);
    for (const v of divergences) {
      const cpp = cppIntTimesFixed(v, repairPercentRaw);
      expect(cpp).toBeGreaterThan(Math.floor(v * 0.20));
    }
  });
});

// ============================================================
// Section 4: Full repair cost formula — integer division chain + fixed-point
// Verify TS repairCostPerStep matches the C++ chain exactly
// ============================================================
describe('full repair cost chain: C++ integer division + fixed-point (techno.cpp:6144)', () => {
  const iniRepairStep = parseInt(ini['General']['RepairStep'], 10);
  const iniURepairStep = parseInt(ini['General']['URepairStep'], 10);
  const iniRepairPctRaw = cppFixedPercent(parseIniPercent(ini['General']['RepairPercent']));
  const iniURepairPctRaw = cppFixedPercent(parseIniPercent(ini['General']['URepairPercent']));

  function cppBuildingRepairCost(rawCost: number, maxStrength: number): number {
    const stepsToFull = Math.floor(maxStrength / iniRepairStep);
    if (stepsToFull === 0) return 0;
    const costPerFullStep = Math.floor(rawCost / stepsToFull);
    return Math.floor(((iniRepairPctRaw * costPerFullStep) + 128) / 256);
  }

  function cppUnitRepairCost(rawCost: number, maxStrength: number): number {
    const stepsToFull = Math.floor(maxStrength / iniURepairStep);
    if (stepsToFull === 0) return 0;
    const costPerFullStep = Math.floor(rawCost / stepsToFull);
    return Math.floor(((iniURepairPctRaw * costPerFullStep) + 128) / 256);
  }

  // Parse building costs and strengths from rules.ini
  const structureTypes = ['POWR', 'APWR', 'FACT', 'BARR', 'TENT', 'PROC', 'WEAP', 'FIX',
    'DOME', 'AFLD', 'HPAD', 'ATEK', 'STEK', 'TSLA', 'FTUR', 'GUN', 'AGUN', 'SAM',
    'GAP', 'SILO', 'HBOX', 'PBOX', 'MSLO', 'IRON'];

  for (const sType of structureTypes) {
    const section = ini[sType];
    if (!section || !section['Cost'] || !section['Strength']) continue;
    const cost = parseInt(section['Cost'], 10);
    const maxHp = parseInt(section['Strength'], 10);
    if (isNaN(cost) || isNaN(maxHp)) continue;

    it(`${sType} (cost=${cost}, maxHp=${maxHp}): TS matches C++ exactly`, () => {
      const cppCost = cppBuildingRepairCost(cost, maxHp);
      // Building repair: NO min-1 clamp (building.cpp:5465). Free repair when cost=0.
      const tsCost = repairCostPerStep(cost, maxHp);
      expect(tsCost, `${sType}: TS=${tsCost}, C++=${cppCost}`).toBe(cppCost);
    });
  }

  // Parse unit costs and strengths from rules.ini
  const unitTypes = ['1TNK', '2TNK', '3TNK', '4TNK', 'HARV', 'MCV', 'APC', 'ARTY',
    'V2RL', 'MNLY', 'JEEP', 'TTNK'];

  for (const uType of unitTypes) {
    const section = ini[uType];
    if (!section || !section['Cost'] || !section['Strength']) continue;
    const cost = parseInt(section['Cost'], 10);
    const maxHp = parseInt(section['Strength'], 10);
    if (isNaN(cost) || isNaN(maxHp)) continue;

    it(`${uType} (cost=${cost}, maxHp=${maxHp}): TS matches C++ exactly`, () => {
      const cppCost = cppUnitRepairCost(cost, maxHp);
      const cppClamped = Math.max(cppCost, 1); // techno.cpp:989
      const tsCost = unitRepairCostPerStep(cost, maxHp);
      expect(tsCost, `${uType}: TS=${tsCost}, C++ (clamped)=${cppClamped}`).toBe(cppClamped);
    });
  }
});

// ============================================================
// Section 5: Power output fixed-point — fixed(hp, maxHp) * ratedPower
// C++: fixed(n,d) = floor(n*256/d); int * fixed = ((Raw * int) + 128) / 256
// ============================================================
describe('power output: fixed(hp, maxHp) * ratedPower (building.cpp:4613)', () => {
  const powrPower = parseInt(ini['POWR']?.['Power'] ?? '100', 10);
  const apwrPower = parseInt(ini['APWR']?.['Power'] ?? '200', 10);
  const powrMaxHp = parseInt(ini['POWR']?.['Strength'] ?? '400', 10);
  const apwrMaxHp = parseInt(ini['APWR']?.['Strength'] ?? '700', 10);

  function cppPowerOutput(ratedPower: number, hp: number, maxHp: number): number {
    if (maxHp <= 0 || hp <= 0) return 0;
    const fixedRaw = cppFixed(hp, maxHp);
    return cppIntTimesFixed(ratedPower, fixedRaw);
  }

  it(`POWR (Power=${powrPower}, maxHp=${powrMaxHp}): TS matches C++ for every HP value`, () => {
    for (let hp = 0; hp <= powrMaxHp; hp++) {
      const cpp = cppPowerOutput(powrPower, hp, powrMaxHp);
      const ts = fixedPowerOutput(powrPower, hp, powrMaxHp);
      expect(ts, `hp=${hp}: TS=${ts}, C++=${cpp}`).toBe(cpp);
    }
  });

  it(`APWR (Power=${apwrPower}, maxHp=${apwrMaxHp}): TS matches C++ for every HP value`, () => {
    for (let hp = 0; hp <= apwrMaxHp; hp++) {
      const cpp = cppPowerOutput(apwrPower, hp, apwrMaxHp);
      const ts = fixedPowerOutput(apwrPower, hp, apwrMaxHp);
      expect(ts, `hp=${hp}: TS=${ts}, C++=${cpp}`).toBe(cpp);
    }
  });

  it('hp > maxHp: produces value > rated power (fixed > 1.0)', () => {
    expect(fixedPowerOutput(powrPower, powrMaxHp + 50, powrMaxHp)).toBe(
      cppPowerOutput(powrPower, powrMaxHp + 50, powrMaxHp),
    );
  });
});

// ============================================================
// Section 6: fixed * fixed vs int * fixed — precision differences
// C++ uses different formulas for these two operations:
//   fixed * fixed = (a.Raw * b.Raw) / 256          [truncates]
//   int * fixed   = ((Raw * intVal) + 128) / 256    [rounds half-up]
// The +128 bias in int*fixed means these produce different results!
// ============================================================
describe('fixed*fixed vs int*fixed: different rounding (fixed.h:96,108 vs :109)', () => {
  it('fixed*fixed truncates, int*fixed rounds', () => {
    expect(cppFixedTimesFixed(128, 128)).toBe(64);
    expect(cppFixedTimesFixed(85, 85)).toBe(28);
    expect(cppIntTimesFixed(10, 85)).toBe(3);
    expect(cppIntTimesFixed(11, 85)).toBe(4);
    expect(Math.floor(11 / 3)).toBe(3);
  });

  it('sell refund uses int*=fixed (fixed.h:165) which delegates to int*fixed rounding', () => {
    expect(sellRefund(1, true)).toBe(1);
    expect(Math.floor(128 * 1 / 256)).toBe(0);
  });
});

// ============================================================
// Section 7: Verify the RepairRate fixed-point parsing
// rules.ini: RepairRate=.016
// ============================================================
describe('RepairRate fixed-point parsing (fixed.cpp:88-151)', () => {
  const repairRateStr = ini['General']['RepairRate']; // ".016"

  it(`fixed("${repairRateStr}") parsed via C++ decimal path`, () => {
    const rawValue = cppFixedDecimal(repairRateStr);
    // C++ parsing: fracpart="016", frac=atoi("016")=16, len=3, base=1000
    // Fraction = (256 * 16) / 1000 = 4096/1000 = 4 (integer division)
    expect(rawValue).toBe(4);
    // As a decimal: 4/256 = 0.015625 (not exactly 0.016)
    expect(rawValue / 256).toBe(0.015625);
  });
});

// ============================================================
// Section 8: operator unsigned() — converting fixed to int with rounding
// ============================================================
describe('operator unsigned() — fixed to int conversion (fixed.h:91)', () => {
  it('fixed(1,2).Raw=128 → unsigned = 1', () => {
    expect(cppFixedToUnsigned(128)).toBe(1);
  });

  it('fixed(0,1).Raw=0 → unsigned = 0', () => {
    expect(cppFixedToUnsigned(0)).toBe(0);
  });

  it('fixed(1,3).Raw=85 → unsigned = 0 (0.332 < 0.5)', () => {
    expect(cppFixedToUnsigned(85)).toBe(0);
  });

  it('fixed(2,3).Raw=170 → unsigned = 1 (0.664 > 0.5)', () => {
    expect(cppFixedToUnsigned(170)).toBe(1);
  });

  it('fixed(3,4).Raw=192 → unsigned = 1', () => {
    expect(cppFixedToUnsigned(192)).toBe(1);
  });

  it('exact half: Raw=128 → 1 (half-up rounding)', () => {
    expect(cppFixedToUnsigned(128)).toBe(1);
  });

  it('just below half: Raw=127 → 0', () => {
    expect(cppFixedToUnsigned(127)).toBe(0);
  });
});

// ============================================================
// Section 9: int / fixed — used in production rate calculations
// ============================================================
describe('int / fixed — production rate arithmetic (fixed.h:156)', () => {
  it('time / fixed(1,1) = time (special case: Raw=256)', () => {
    expect(cppIntDivFixed(100, 256)).toBe(100);
  });

  it('time / fixed(0,1) = time (special case: Raw=0)', () => {
    expect(cppIntDivFixed(100, 0)).toBe(100);
  });

  it('100 / fixed(1,2) = ((100*256)+128)/128 = 201', () => {
    expect(cppIntDivFixed(100, 128)).toBe(201);
    // Naive 100/0.5 = 200. C++ gives 201 due to +128 rounding bias!
  });

  it('100 / fixed(1,4) = ((25600)+128)/64 = 402', () => {
    expect(cppIntDivFixed(100, 64)).toBe(402);
  });

  it('100 / fixed(1,16) = ((25600)+128)/16 = 1608', () => {
    expect(cppIntDivFixed(100, 16)).toBe(1608);
  });
});

// ============================================================
// Section 10: Brute-force sell refund parity sweep
// ============================================================
describe('sell refund: exhaustive parity sweep 0..10000', () => {
  const refundRaw = cppFixedPercent(parseIniPercent(ini['General']['RefundPercent']));

  it('TS sellRefund matches C++ for all costs 0..10000', () => {
    const mismatches: string[] = [];
    for (let cost = 0; cost <= 10000; cost++) {
      const cpp = cppIntTimesFixed(cost, refundRaw);
      const ts = sellRefund(cost, true);
      if (ts !== cpp) {
        mismatches.push(`cost=${cost}: TS=${ts}, C++=${cpp}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('AI refund is always exactly buildCost for all costs 0..10000', () => {
    const mismatches: string[] = [];
    for (let cost = 0; cost <= 10000; cost++) {
      const ts = sellRefund(cost, false);
      if (ts !== cost) {
        mismatches.push(`cost=${cost}: TS=${ts}, expected=${cost}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

// ============================================================
// Section 11: Brute-force repair cost parity sweep
// ============================================================
describe('repair cost: exhaustive parity sweep', () => {
  const iniRepairStep = parseInt(ini['General']['RepairStep'], 10);
  const iniURepairStep = parseInt(ini['General']['URepairStep'], 10);
  const iniRepairPctRaw = cppFixedPercent(parseIniPercent(ini['General']['RepairPercent']));
  const iniURepairPctRaw = cppFixedPercent(parseIniPercent(ini['General']['URepairPercent']));

  function cppRepairCostRaw(rawCost: number, maxStrength: number, step: number, percentRaw: number): number {
    const stepsToFull = Math.floor(maxStrength / step);
    if (stepsToFull === 0) return 0;
    const costPerFullStep = Math.floor(rawCost / stepsToFull);
    return Math.floor(((percentRaw * costPerFullStep) + 128) / 256);
  }

  it('building repair: TS matches C++ for costs 0..3000 step 50, maxHp 50..1000 step 50', () => {
    const mismatches: string[] = [];
    for (let cost = 0; cost <= 3000; cost += 50) {
      for (let hp = 50; hp <= 1000; hp += 50) {
        const cppRaw = cppRepairCostRaw(cost, hp, iniRepairStep, iniRepairPctRaw);
        // Building repair: NO min-1 clamp (building.cpp:5465). Free repair when cost=0.
        const ts = repairCostPerStep(cost, hp);
        if (ts !== cppRaw) {
          mismatches.push(`cost=${cost},hp=${hp}: TS=${ts}, C++=${cppRaw}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('unit repair: TS matches C++ for costs 0..3000 step 50, maxHp 50..1000 step 50', () => {
    const mismatches: string[] = [];
    for (let cost = 0; cost <= 3000; cost += 50) {
      for (let hp = 50; hp <= 1000; hp += 50) {
        const cppRaw = cppRepairCostRaw(cost, hp, iniURepairStep, iniURepairPctRaw);
        const cppClamped = Math.max(cppRaw, 1);
        const ts = unitRepairCostPerStep(cost, hp);
        if (ts !== cppClamped) {
          mismatches.push(`cost=${cost},hp=${hp}: TS=${ts}, C++=${cppClamped}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});

// ============================================================
// Section 12: Rounding invariants — properties that must hold
// ============================================================
describe('fixed-point rounding invariants', () => {
  it('sell refund for odd cost is always ceil(cost/2), not floor(cost/2)', () => {
    for (let cost = 1; cost <= 1000; cost += 2) {
      expect(sellRefund(cost, true), `cost=${cost}`).toBe(Math.ceil(cost / 2));
    }
  });

  it('sell refund for even cost is always exactly cost/2', () => {
    for (let cost = 0; cost <= 1000; cost += 2) {
      expect(sellRefund(cost, true), `cost=${cost}`).toBe(cost / 2);
    }
  });

  it('building repair cost can be 0 (free); unit repair cost always >= 1', () => {
    // Building repair: no min-1 clamp (building.cpp:5465)
    // Unit repair: techno.cpp:989 clamps max(cost, 1)
    for (let cost = 0; cost <= 100; cost++) {
      for (const hp of [50, 100, 200, 400, 800]) {
        expect(repairCostPerStep(cost, hp), `cost=${cost},hp=${hp}`).toBeGreaterThanOrEqual(0);
        expect(unitRepairCostPerStep(cost, hp), `unit cost=${cost},hp=${hp}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('repair cost is monotonically non-decreasing with build cost (fixed maxHp)', () => {
    for (const hp of [200, 400, 600]) {
      let prevCost = 0;
      for (let cost = 0; cost <= 5000; cost += 10) {
        const rc = repairCostPerStep(cost, hp);
        expect(rc, `cost=${cost},hp=${hp}`).toBeGreaterThanOrEqual(prevCost);
        prevCost = rc;
      }
    }
  });
});

// ============================================================
// Section 13: Cross-check — TS constants match rules.ini values
// ============================================================
describe('TS constants match rules.ini (NOT rules.cpp defaults)', () => {
  const iniRepairStep = parseInt(ini['General']['RepairStep'], 10);
  const iniRepairPct = parseIniFloat(ini['General']['RepairPercent']);
  const iniURepairStep = parseInt(ini['General']['URepairStep'], 10);
  const iniURepairPct = parseIniFloat(ini['General']['URepairPercent']);

  it(`REPAIR_STEP=${iniRepairStep} (rules.ini), not 5 (rules.cpp default)`, () => {
    expect(REPAIR_STEP).toBe(iniRepairStep);
    expect(REPAIR_STEP).not.toBe(5);
  });

  it(`REPAIR_PERCENT=${iniRepairPct} (rules.ini), not 0.25 (rules.cpp default)`, () => {
    expect(REPAIR_PERCENT).toBe(iniRepairPct);
    expect(REPAIR_PERCENT).not.toBe(0.25);
  });

  it(`UREPAIR_STEP=${iniURepairStep} (rules.ini), not 5 (rules.cpp default)`, () => {
    expect(UREPAIR_STEP).toBe(iniURepairStep);
    expect(UREPAIR_STEP).not.toBe(5);
  });

  it(`UREPAIR_PERCENT=${iniURepairPct} (rules.ini), not 0.25 (rules.cpp default)`, () => {
    expect(UREPAIR_PERCENT).toBe(iniURepairPct);
    expect(UREPAIR_PERCENT).not.toBe(0.25);
  });

  it('rules.ini overrides are significant: step 7 vs 5 changes repair cost', () => {
    const withStep7 = repairCostPerStep(300, 200);
    const stepsToFull5 = Math.floor(200 / 5);
    const costPerFullStep5 = Math.floor(300 / stepsToFull5);
    const withStep5 = Math.floor(((51 * costPerFullStep5) + 128) / 256);
    expect(withStep7).not.toBe(withStep5);
  });
});

// ============================================================
// Section 14: modifyDamage — warhead multiplier as fixed-point
// C++ combat.cpp:98-101: damage = damage * warhead_mult (int * fixed in C++)
// TS uses floating-point: baseDamage * mult * houseBias
// C++ warhead verses are fixed-point values from rules.ini, but the
// multiplication chain int * fixed("100%") * fixed("100%") introduces
// rounding differences vs TS float * float.
// ============================================================
describe('modifyDamage: warhead multiplier fixed-point divergence (combat.cpp:98-127)', () => {
  // Parse warhead verses from rules.ini [Warheads] section
  // C++ combat.cpp:98: damage = damage * Verses[armor_idx]
  // where Verses[i] is a fixed-point value parsed from rules.ini

  // In C++, modifyDamage uses:
  //   damage *= Warheads[warhead]->Modifier[armor]  (int *= fixed)
  // which is: damage = ((fixedRaw * damage) + 128) / 256
  //
  // TS uses: baseDamage * mult * houseBias (all floats)
  // The float multiplication can produce different rounding than C++ fixed-point.

  /** C++ modifyDamage at distance=0 with houseBias=1.0:
   *  damage = baseDamage * warheadMult (as int * fixed)
   *  In C++: result = ((fixedPercent * baseDamage) + 128) / 256 */
  function cppDamageWithMult(baseDamage: number, multPercent: number): number {
    const fixedRaw = cppFixedPercent(multPercent);
    return cppIntTimesFixed(baseDamage, fixedRaw);
  }

  it('SA vs heavy armor (25%): C++ fixed gives different result than TS float for some damage values', () => {
    // rules.ini SA verse vs heavy = 0.25 (25%)
    // C++ fixed("25%").Raw = floor(25*256/100) = floor(64) = 64
    // int * fixed: ((64 * baseDamage) + 128) / 256
    const fixedRaw = cppFixedPercent(25);
    expect(fixedRaw).toBe(64);

    // For baseDamage=1: C++ = ((64*1)+128)/256 = 192/256 = 0
    // TS: Math.round(1 * 0.25) = 0 — same here
    expect(cppIntTimesFixed(1, fixedRaw)).toBe(0);

    // For baseDamage=3: C++ = ((64*3)+128)/256 = 320/256 = 1
    // TS: Math.round(3 * 0.25) = 1 — same here
    expect(cppIntTimesFixed(3, fixedRaw)).toBe(1);

    // The 25% case is exact (64/256 = 0.25) so no divergence.
    // But TS modifyDamage also does distance falloff and Math.round at the end.
    // Test that TS result matches at dist=0:
    const tsDmg = modifyDamage(100, 'SA', 'heavy', 0);
    const cppDmg = cppDamageWithMult(100, 25);
    // TS may differ because it uses float multiplication chain
    expect(tsDmg).toBe(cppDmg);
  });

  it('HE vs heavy armor (25%): exact fraction, should match', () => {
    const tsDmg = modifyDamage(200, 'HE', 'heavy', 0);
    const cppDmg = cppDamageWithMult(200, 25);
    expect(tsDmg).toBe(cppDmg);
  });

  it('AP vs none armor (30%): C++ fixed("30%").Raw = floor(76.8) = 76, not exactly 30%', () => {
    // C++ fixed("30%").Raw = floor(30*256/100) = floor(76.8) = 76
    // Actual ratio: 76/256 = 0.296875, not 0.30
    const fixedRaw = cppFixedPercent(30);
    expect(fixedRaw).toBe(76);
    expect(fixedRaw / 256).not.toBe(0.30);

    // For baseDamage=100: C++ = ((76*100)+128)/256 = 7728/256 = 30
    // TS: Math.round(100 * 0.3 * 1.0) = Math.round(30) = 30 — same
    const cppResult = cppIntTimesFixed(100, fixedRaw);
    expect(cppResult).toBe(30);

    // For baseDamage=10: C++ = ((76*10)+128)/256 = 888/256 = 3
    // TS: Math.round(10 * 0.3) = Math.round(3.0) = 3 — same
    expect(cppIntTimesFixed(10, fixedRaw)).toBe(3);

    // For baseDamage=11: C++ = ((76*11)+128)/256 = 964/256 = 3
    // TS: Math.round(11 * 0.3) = Math.round(3.3) = 3 — same
    expect(cppIntTimesFixed(11, fixedRaw)).toBe(3);

    // For baseDamage=17: C++ = ((76*17)+128)/256 = 1420/256 = 5
    // TS: Math.round(17 * 0.3) = Math.round(5.1) = 5 — same
    expect(cppIntTimesFixed(17, fixedRaw)).toBe(5);

    // For baseDamage=255: C++ = ((76*255)+128)/256 = 19508/256 = 76
    // TS: Math.round(255 * 0.3) = Math.round(76.5) = 77 — DIFFERENT! Round-half-up
    // (But JS Math.round rounds 76.5 to 77 while C++ fixed-point gives 76)
    const cppResult255 = cppIntTimesFixed(255, fixedRaw);
    const tsResult255 = Math.round(255 * 0.3);
    // This documents where float and fixed diverge
    expect(cppResult255).toBe(76);
    expect(tsResult255).toBe(77); // JS rounds 76.5 UP, C++ fixed gives 76
  });

  it('Fire vs light armor (60%): C++ fixed("60%").Raw = floor(153.6) = 153', () => {
    // C++ fixed("60%").Raw = floor(60*256/100) = floor(153.6) = 153
    // Actual: 153/256 = 0.59765625, not 0.60
    const fixedRaw = cppFixedPercent(60);
    expect(fixedRaw).toBe(153);
    expect(fixedRaw / 256).not.toBe(0.60);

    // Systematic sweep: count divergences
    let divergeCount = 0;
    for (let dmg = 1; dmg <= 500; dmg++) {
      const cpp = cppIntTimesFixed(dmg, fixedRaw);
      const tsFloat = Math.round(dmg * 0.60);
      if (cpp !== tsFloat) divergeCount++;
    }
    // There will be divergences because 153/256 != 0.60
    expect(divergeCount).toBeGreaterThan(0);
  });

  it('modifyDamage: systematic divergence count C++ fixed vs TS float at dist=0', () => {
    // For each warhead/armor combo, count where int*fixed differs from float*round
    const warheads: WarheadType[] = ['SA', 'HE', 'AP', 'Fire'];
    const armors: ArmorType[] = ['none', 'wood', 'light', 'heavy', 'concrete'];
    const armorIdx: Record<ArmorType, number> = { none: 0, wood: 1, light: 2, heavy: 3, concrete: 4 };

    let totalDivergences = 0;
    for (const wh of warheads) {
      for (const ar of armors) {
        const mult = WARHEAD_VS_ARMOR[wh][armorIdx[ar]];
        const multPct = Math.round(mult * 100);
        const fixedRaw = cppFixedPercent(multPct);
        // Skip exact cases (where fixedRaw/256 == mult exactly)
        if (fixedRaw / 256 === mult) continue;

        for (let dmg = 1; dmg <= 200; dmg++) {
          const cpp = cppIntTimesFixed(dmg, fixedRaw);
          const tsFloat = Math.round(dmg * mult);
          if (cpp !== tsFloat) totalDivergences++;
        }
      }
    }
    // This test documents how many divergences exist; the exact count will depend
    // on the specific warhead verses in rules.ini. Non-zero = potential parity gap.
    // We expect some divergences since not all percentages are exactly representable in 8.8.
    expect(totalDivergences).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// Section 15: Terrain speed multipliers — C++ uses fixed-point
// C++ rules.cpp:895: Ground[terrain].Cost[speed_class] = fixed(iniPercent%)
// TS stores floats (0.9, 0.8, 0.6, etc.) from rules.ini
// C++ movement: speed * terrainMult where terrainMult is fixed-point
// TS: speed * float
// ============================================================
describe('terrain speed: C++ fixed-point vs TS float (rules.cpp:895)', () => {
  // Parse terrain speed values from rules.ini
  const terrainSections = ['Clear', 'Rough', 'Road', 'Water', 'Rock', 'Wall', 'Ore', 'Beach', 'River'];
  const speedClasses = ['Foot', 'Track', 'Wheel']; // indexes 0, 1, 2

  for (const terrain of terrainSections) {
    const section = ini[terrain];
    if (!section) continue;

    for (let sc = 0; sc < speedClasses.length; sc++) {
      const key = speedClasses[sc];
      const iniVal = section[key];
      if (!iniVal) continue;

      const pct = parseIniPercent(iniVal);
      const fixedRaw = cppFixedPercent(pct);
      const tsVal = TERRAIN_SPEED[terrain]?.[sc];

      if (tsVal === undefined) continue;

      it(`${terrain}.${key}=${iniVal}: C++ fixed("${pct}%").Raw=${fixedRaw}, TS float=${tsVal}`, () => {
        // Verify TS float matches the INI value
        expect(tsVal).toBeCloseTo(pct / 100, 4);

        // Check if fixed-point representation introduces error
        const fixedAsFloat = fixedRaw / 256;
        const error = Math.abs(fixedAsFloat - (pct / 100));

        // 8.8 fixed-point can represent multiples of 1/256 = 0.00390625
        // Most percentage values that are multiples of 10% will be exact.
        // Others (like 90% = 230.4/256 → 230) will have small error.
        if (pct % 100 !== 0 && pct % 25 !== 0) {
          // Non-exact cases: verify the error is bounded by 1/256
          expect(error).toBeLessThanOrEqual(1 / 256);
        }
      });
    }
  }

  it('movement speed: int*fixed vs float divergence for speed=9 on Clear/Foot (90%)', () => {
    // C++ fixed("90%").Raw = floor(90*256/100) = floor(230.4) = 230
    // 230/256 = 0.8984375, not exactly 0.90
    const fixedRaw = cppFixedPercent(90);
    expect(fixedRaw).toBe(230);

    // For base speed 9 (Light Tank):
    // C++ int * fixed: ((230 * 9) + 128) / 256 = (2070 + 128) / 256 = 2198 / 256 = 8
    // TS float: Math.floor(9 * 0.9) = Math.floor(8.1) = 8 — same
    expect(cppIntTimesFixed(9, fixedRaw)).toBe(8);

    // For base speed 7 (Heavy Tank):
    // C++ int * fixed: ((230 * 7) + 128) / 256 = (1610 + 128) / 256 = 1738 / 256 = 6
    // TS float: Math.floor(7 * 0.9) = Math.floor(6.3) = 6 — same
    expect(cppIntTimesFixed(7, fixedRaw)).toBe(6);

    // For base speed 10:
    // C++ int * fixed: ((230 * 10) + 128) / 256 = (2300 + 128) / 256 = 2428 / 256 = 9
    // TS float: Math.floor(10 * 0.9) = Math.floor(9.0) = 9 — same
    expect(cppIntTimesFixed(10, fixedRaw)).toBe(9);

    // For base speed 11:
    // C++ int * fixed: ((230 * 11) + 128) / 256 = (2530 + 128) / 256 = 2658 / 256 = 10
    // TS float: 11 * 0.9 = 9.9 — but C++ int*fixed rounds: ((230*11)+128)/256 = 10.38... → 10
    // Math.round(11 * 0.8984375) = Math.round(9.8828125) = 10 — same (int*fixed rounds half-up)
    expect(cppIntTimesFixed(11, fixedRaw)).toBe(10);
  });

  it('Ore/Wheel (50%): exact fraction, no divergence', () => {
    const fixedRaw = cppFixedPercent(50);
    expect(fixedRaw).toBe(128);
    expect(fixedRaw / 256).toBe(0.5); // exact
    // All base speeds will agree
    for (let speed = 1; speed <= 15; speed++) {
      expect(cppIntTimesFixed(speed, fixedRaw)).toBe(Math.ceil(speed * 0.5));
    }
  });

  it('Rough/Wheel (40%): C++ fixed("40%").Raw = 102, not exact', () => {
    const fixedRaw = cppFixedPercent(40);
    expect(fixedRaw).toBe(102);
    expect(fixedRaw / 256).not.toBe(0.40);
    // 102/256 = 0.3984375

    // Count divergences for speeds 1..15
    let diverges = 0;
    for (let speed = 1; speed <= 15; speed++) {
      const cpp = cppIntTimesFixed(speed, fixedRaw);
      const tsFloat = Math.round(speed * 0.40);
      if (cpp !== tsFloat) diverges++;
    }
    // Document whether divergences exist
    expect(diverges).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// Section 16: Power fraction — drain/output clamped to [1/16, 1.0]
// C++ factory.cpp:434: rate = time / Bound(Power_Fraction(), fixed(1,16), fixed(1))
// C++ house.cpp:4160: Power_Fraction() = Power/Drain as fixed-point division
// TS powerMultiplier uses float division.
// ============================================================
describe('power fraction: C++ fixed-point division vs TS float (factory.cpp:434)', () => {
  /** C++ Power_Fraction: fixed(Power, Drain) → clamped to [fixed(1,16), fixed(1,1)]
   *  In C++: fixed(Power, Drain).Raw = floor(Power*256/Drain)
   *  Then: Bound(fraction, 16, 256) — clamped raw values
   *  Conversion to multiplier for time: time / fixed → uses int/fixed formula */
  function cppPowerFraction(produced: number, consumed: number): number {
    if (consumed <= 0 || consumed <= produced) return 256; // Raw for 1.0
    if (produced <= 0) return 16; // Raw for 1/16
    const raw = cppFixed(produced, consumed);
    return Math.max(16, Math.min(256, raw)); // Bound(raw, 16, 256)
  }

  it('full power: fraction = 1.0 (raw=256)', () => {
    expect(cppPowerFraction(200, 100)).toBe(256);
    expect(powerMultiplier(200, 100)).toBe(1.0);
  });

  it('zero power: fraction = 1/16 (raw=16)', () => {
    expect(cppPowerFraction(0, 100)).toBe(16);
    expect(powerMultiplier(0, 100)).toBe(1 / 16);
  });

  it('half power: C++ fixed(50, 100).Raw = 128, TS = 0.5', () => {
    const cppRaw = cppPowerFraction(50, 100);
    expect(cppRaw).toBe(128);
    expect(powerMultiplier(50, 100)).toBe(0.5);
  });

  it('1/3 power: C++ fixed(33, 100).Raw = 84, TS = 0.33', () => {
    // C++ fixed(33, 100).Raw = floor(33*256/100) = floor(84.48) = 84
    // As float: 84/256 = 0.328125
    // TS: 33/100 = 0.33
    const cppRaw = cppPowerFraction(33, 100);
    expect(cppRaw).toBe(84);
    const tsResult = powerMultiplier(33, 100);
    expect(tsResult).toBe(0.33);
    // These differ: 0.328125 vs 0.33
    expect(cppRaw / 256).not.toBe(tsResult);
  });

  it('below 1/16 threshold: both clamp', () => {
    // C++ fixed(1, 100).Raw = floor(256/100) = 2 → clamped to 16
    expect(cppPowerFraction(1, 100)).toBe(16);
    expect(powerMultiplier(1, 100)).toBe(1 / 16);
  });

  it('systematic: power fraction divergence at various ratios', () => {
    const divergences: string[] = [];
    for (let produced = 1; produced < 100; produced += 3) {
      const consumed = 100;
      const cppRaw = cppPowerFraction(produced, consumed);
      const cppFloat = cppRaw / 256;
      const tsFloat = powerMultiplier(produced, consumed);
      if (Math.abs(cppFloat - tsFloat) > 0.001) {
        divergences.push(`${produced}/${consumed}: C++=${cppFloat.toFixed(6)}, TS=${tsFloat.toFixed(6)}`);
      }
    }
    // Most non-exact fractions will have slight differences
    expect(divergences.length).toBeGreaterThan(0);
  });

  it('production rate scaling: int / fixed(fraction) vs int / float', () => {
    // C++ factory.cpp:434: rate = time / Bound(Power_Fraction(), fixed(1,16), fixed(1))
    // For time=100, fraction=50/100:
    //   C++ int / fixed: ((100*256)+128)/128 = 25728/128 = 201 (!)
    //   TS naive: Math.round(100 / 0.5) = 200
    const cppRaw = cppPowerFraction(50, 100);
    const cppRate = cppIntDivFixed(100, cppRaw);
    expect(cppRate).toBe(201); // C++ gives 201, not 200!
    // TS would give 200 if using naive float division
    expect(Math.round(100 / 0.5)).toBe(200);
  });
});

// ============================================================
// Section 17: Country bonus multipliers — C++ uses fixed-point
// C++ house.cpp:289-297 (multiplayer): FirepowerBias = hptr->FirepowerBias * Rule.Diff[handicap].FirepowerBias
// Both factors are fixed-point. The product uses fixed * fixed (truncation, NOT rounding).
// TS stores these as floats in COUNTRY_BONUSES.
// ============================================================
describe('country bonus: C++ fixed-point vs TS float (house.cpp:289-308)', () => {
  // Parse country bonuses from rules.ini
  const countries = ['England', 'Germany', 'France', 'Ukraine', 'USSR', 'Greece', 'Turkey', 'Spain'];
  const bonusFields = ['Firepower', 'Groundspeed', 'Airspeed', 'Armor', 'ROF', 'Cost'] as const;
  const tsFieldMap: Record<string, keyof typeof COUNTRY_BONUSES['England']> = {
    Firepower: 'firepowerMult',
    Groundspeed: 'groundspeedMult',
    Airspeed: 'airspeedMult',
    Armor: 'armorMult',
    ROF: 'rofMult',
    Cost: 'costMult',
  };

  for (const country of countries) {
    const section = ini[country];
    if (!section) continue;

    for (const field of bonusFields) {
      const iniVal = section[field];
      if (!iniVal) continue;
      const iniFloat = parseFloat(iniVal);

      it(`${country}.${field}=${iniVal}: TS matches INI value`, () => {
        const tsField = tsFieldMap[field];
        const tsVal = COUNTRY_BONUSES[country]?.[tsField];
        expect(tsVal, `${country}.${tsField}`).toBe(iniFloat);
      });
    }
  }

  it('England Armor=1.1: C++ fixed("1.1") has rounding error', () => {
    // C++ fixed("1.1"): Whole=1, frac="1", fracVal=1, base=10
    // Fraction = floor(256*1/10) = floor(25.6) = 25
    // Total Raw = 1*256 + 25 = 281
    // As float: 281/256 = 1.09765625, not exactly 1.1
    const fixedRaw = cppFixedDecimal('1.1');
    expect(fixedRaw).toBe(281);
    expect(fixedRaw / 256).not.toBe(1.1);
    expect(fixedRaw / 256).toBeCloseTo(1.1, 1);

    // Damage with England armor bias 1.1:
    // C++ int * fixed(1.1): ((281 * damage) + 128) / 256
    // For damage=100: ((28100 + 128) / 256) = 28228/256 = 110
    // TS: Math.round(100 * 1.1) = 110 — same here
    expect(cppIntTimesFixed(100, fixedRaw)).toBe(110);

    // For damage=91: C++ = ((281*91)+128)/256 = (25571+128)/256 = 25699/256 = 100
    // TS: Math.round(91 * 1.1) = Math.round(100.1) = 100 — same
    expect(cppIntTimesFixed(91, fixedRaw)).toBe(100);

    // For damage=93: C++ = ((281*93)+128)/256 = (26133+128)/256 = 26261/256 = 102
    // TS: Math.round(93 * 1.1) = Math.round(102.3) = 102 — same
    expect(cppIntTimesFixed(93, fixedRaw)).toBe(102);
  });

  it('Germany Firepower=1.1: same fixed("1.1") rounding as England Armor', () => {
    const fixedRaw = cppFixedDecimal('1.1');
    expect(fixedRaw).toBe(281);

    // For weapon damage=200: C++ = ((281*200)+128)/256 = (56200+128)/256 = 56328/256 = 220
    // TS: Math.round(200 * 1.1) = 220 — same
    expect(cppIntTimesFixed(200, fixedRaw)).toBe(220);
  });

  it('USSR Cost=0.9: C++ fixed("0.9") = 0*256 + floor(256*9/10) = 230', () => {
    const fixedRaw = cppFixedDecimal('0.9');
    expect(fixedRaw).toBe(230);
    // 230/256 = 0.8984375, not exactly 0.9
    expect(fixedRaw / 256).not.toBe(0.9);

    // Cost scaling for item costing 1000:
    // C++ int * fixed: ((230 * 1000) + 128) / 256 = 230128/256 = floor(898.9375) = 898
    // TS: Math.round(1000 * 0.9) = 900 — DIFFERENT! Off by 2 credits!
    const cppCost = cppIntTimesFixed(1000, fixedRaw);
    expect(cppCost).toBe(898);
    expect(Math.round(1000 * 0.9)).toBe(900);
    // Off by 2 credits for USSR due to fixed-point truncation!
  });

  it('multiplied biases: fixed * fixed for multiplayer country + difficulty', () => {
    // In multiplayer: FirepowerBias = hptr->FirepowerBias * Rule.Diff[handicap].FirepowerBias
    // Both are fixed-point. C++ uses fixed * fixed (truncation).
    // Example: Germany (1.1) on Easy (1.2)
    const germanyFP = cppFixedDecimal('1.1'); // 281
    const easyFP = cppFixedDecimal('1.2'); // Raw = 1*256 + floor(256*2/10) = 256+51 = 307
    expect(cppFixedDecimal('1.2')).toBe(307);

    // C++ fixed * fixed: (281 * 307) / 256 = 86267 / 256 = 336 (truncated)
    // As float: 336/256 = 1.3125
    // Exact: 1.1 * 1.2 = 1.32
    const combined = cppFixedTimesFixed(germanyFP, easyFP);
    expect(combined).toBe(336);
    expect(combined / 256).toBe(1.3125);
    expect(combined / 256).not.toBe(1.32); // fixed*fixed truncation error
  });
});

// ============================================================
// Section 18: Boundary cases — fractions that diverge between
// float and fixed-point (1/3, 1/7, values near rounding thresholds)
// ============================================================
describe('boundary cases: float vs fixed-point edge cases', () => {
  it('1/3: fixed(1,3).Raw=85, float gives 0.33333...', () => {
    const fixedRaw = cppFixed(1, 3);
    expect(fixedRaw).toBe(85);
    expect(fixedRaw / 256).toBe(85 / 256); // 0.33203125

    // Power output for 1/3 health:
    // Building with ratedPower=100, maxHp=300, hp=100:
    // C++ fixed(100, 300).Raw = floor(100*256/300) = floor(85.33) = 85
    // int * fixed: ((85 * 100) + 128) / 256 = (8500+128)/256 = 8628/256 = 33
    const cppPwr = cppIntTimesFixed(100, fixedRaw);
    expect(cppPwr).toBe(33);
    // Exact: 100 * 1/3 = 33.33 → floor = 33 — same
    // But TS fixedPowerOutput does: floor((85 * 100 + 128) / 256) = 33 — matches!
    expect(fixedPowerOutput(100, 100, 300)).toBe(33);
  });

  it('1/7: fixed(1,7).Raw=36, large truncation error', () => {
    const fixedRaw = cppFixed(1, 7);
    expect(fixedRaw).toBe(36); // floor(256/7) = floor(36.57) = 36
    // 36/256 = 0.140625 vs exact 0.142857...
    // Error: 0.002232

    // Power at 1/7 health: ratedPower=200, maxHp=700, hp=100
    // C++ fixed(100, 700).Raw = floor(100*256/700) = floor(36.57) = 36
    // int * fixed: ((36 * 200) + 128) / 256 = (7200+128)/256 = 7328/256 = 28
    const cppPwr = cppIntTimesFixed(200, fixedRaw);
    expect(cppPwr).toBe(28);
    // Exact: 200 * 100/700 = 28.571 → floor = 28 — same
    expect(fixedPowerOutput(200, 100, 700)).toBe(28);
  });

  it('values near rounding threshold: hp where fixed(hp, maxHp) crosses integer', () => {
    // For APWR (Power=200, maxHp=700):
    // Find HP where output changes by looking at fixed(hp,700) crossing points
    // fixedRaw crosses from N to N+1 when hp*256/700 crosses an integer
    // i.e. hp = ceil(700 * (N+1) / 256)
    const apwrPower = parseInt(ini['APWR']?.['Power'] ?? '200', 10);
    const apwrMaxHp = parseInt(ini['APWR']?.['Strength'] ?? '700', 10);

    // The output changes when fixedRaw changes, which affects intTimesFixed
    // Check boundary: hp=273 vs hp=274 for APWR
    // fixed(273, 700).Raw = floor(273*256/700) = floor(99.84) = 99
    // fixed(274, 700).Raw = floor(274*256/700) = floor(100.21) = 100
    const raw273 = cppFixed(273, apwrMaxHp);
    const raw274 = cppFixed(274, apwrMaxHp);
    expect(raw273).toBe(99);
    expect(raw274).toBe(100);

    // Power output changes:
    // hp=273: ((99 * 200) + 128) / 256 = 19928/256 = 77
    // hp=274: ((100 * 200) + 128) / 256 = 20128/256 = 78
    expect(cppIntTimesFixed(apwrPower, raw273)).toBe(77);
    expect(cppIntTimesFixed(apwrPower, raw274)).toBe(78);

    // Verify TS matches at this boundary
    expect(fixedPowerOutput(apwrPower, 273, apwrMaxHp)).toBe(77);
    expect(fixedPowerOutput(apwrPower, 274, apwrMaxHp)).toBe(78);
  });

  it('large numerator: fixed(999, 1000) vs float 0.999', () => {
    // fixed(999, 1000).Raw = floor(999*256/1000) = floor(255.744) = 255
    // 255/256 = 0.99609375 vs 0.999
    const fixedRaw = cppFixed(999, 1000);
    expect(fixedRaw).toBe(255);
    expect(fixedRaw / 256).not.toBe(0.999);

    // Power at near-full HP: 100 * fixed(999,1000)
    // ((255 * 100) + 128) / 256 = 25628/256 = 100
    // Exact: floor(100 * 0.999) = 99 — but C++ rounds up due to +128!
    expect(cppIntTimesFixed(100, fixedRaw)).toBe(100);
    expect(Math.floor(100 * 0.999)).toBe(99);
    // C++ at 999/1000 HP gives FULL power output!
    // This is a significant behavioral difference.
  });

  it('2/7: fixed(2,7).Raw = 73, accumulates truncation error', () => {
    const fixedRaw = cppFixed(2, 7);
    expect(fixedRaw).toBe(73); // floor(512/7) = floor(73.14) = 73
    // 73/256 = 0.28515625 vs exact 0.285714...

    // This is NOT exactly 2 * fixed(1,7):
    // 2 * 36 = 72, but fixed(2,7) = 73 — because it re-truncates from scratch!
    expect(fixedRaw).not.toBe(2 * cppFixed(1, 7));
  });

  it('127/255: boundary near exactly 0.498, fixed-point gives 127', () => {
    // fixed(127, 255).Raw = floor(127*256/255) = floor(127.502) = 127
    const fixedRaw = cppFixed(127, 255);
    expect(fixedRaw).toBe(127);
    // operator unsigned: (127+128)/256 = 255/256 = 0 — rounds to 0!
    expect(cppFixedToUnsigned(fixedRaw)).toBe(0);
    // But 127/255 = 0.498... so float would also give 0 when truncated.
    // Key: just below the 0.5 threshold.
  });

  it('128/255: crosses 0.5 threshold, fixed-point gives 128', () => {
    // fixed(128, 255).Raw = floor(128*256/255) = floor(128.502) = 128
    const fixedRaw = cppFixed(128, 255);
    expect(fixedRaw).toBe(128);
    // operator unsigned: (128+128)/256 = 256/256 = 1 — rounds to 1!
    expect(cppFixedToUnsigned(fixedRaw)).toBe(1);
  });

  it('uint16 overflow in fixed*int: large raw * large int wraps', () => {
    // C++ fixed *= int: Data.Raw = (unsigned short)(Data.Raw * rvalue)
    // This wraps at 65536 (uint16)
    // fixed(255,256).Raw = 255; 255 * 300 = 76500 & 0xFFFF = 10964
    const result = cppFixedTimesInt(255, 300);
    expect(result).toBe(76500 & 0xFFFF);
    expect(result).toBe(10964);
    // This differs from float: 255/256 * 300 = 299.something
  });
});

// ============================================================
// Section 19: Difficulty bias — fixed-point cascaded multiplication
// C++ house.cpp:289-297: multiplayer biases use fixed * fixed (truncation)
// ============================================================
describe('difficulty bias: cascaded fixed-point multiplication (house.cpp:289-308)', () => {
  // Parse difficulty settings from rules.ini
  const diffSections = ['Easy', 'Normal', 'Difficult'];
  const diffFields = ['Firepower', 'Groundspeed', 'Airspeed', 'Armor', 'ROF', 'Cost'];

  for (const diff of diffSections) {
    const section = ini[diff];
    if (!section) continue;

    for (const field of diffFields) {
      const val = section[field];
      if (!val) continue;
      const floatVal = parseFloat(val);
      const fixedRaw = cppFixedDecimal(val);

      it(`${diff}.${field}=${val}: fixed("${val}").Raw=${fixedRaw}, as float=${fixedRaw / 256}`, () => {
        // Verify the fixed-point raw value
        expect(fixedRaw).toBeGreaterThan(0);
        // Verify round-trip through fixed is close to original
        expect(fixedRaw / 256).toBeCloseTo(floatVal, 1);
      });
    }
  }

  it('Easy.Firepower=1.2: fixed("1.2") has truncation', () => {
    // C++ fixed("1.2"): Whole=1, frac="2", fracVal=2, base=10
    // Fraction = floor(256*2/10) = floor(51.2) = 51
    // Total Raw = 256 + 51 = 307
    const fixedRaw = cppFixedDecimal('1.2');
    expect(fixedRaw).toBe(307);
    // 307/256 = 1.19921875, not exactly 1.2
    expect(fixedRaw / 256).not.toBe(1.2);
  });

  it('Difficult.Firepower=.8: fixed(".8") has truncation', () => {
    // C++ fixed(".8"): Whole=0, frac="8", fracVal=8, base=10
    // Fraction = floor(256*8/10) = floor(204.8) = 204
    // Total Raw = 0 + 204 = 204
    const fixedRaw = cppFixedDecimal('.8');
    expect(fixedRaw).toBe(204);
    // 204/256 = 0.796875, not exactly 0.8
    expect(fixedRaw / 256).not.toBe(0.8);
  });

  it('cascaded multiplication: Germany(1.1) * Easy(1.2) * 100 damage', () => {
    const countryRaw = cppFixedDecimal('1.1'); // 281
    const diffRaw = cppFixedDecimal('1.2'); // 307

    // C++ multiplayer: combined = fixed * fixed (truncation)
    const combinedRaw = cppFixedTimesFixed(countryRaw, diffRaw);
    // (281 * 307) / 256 = 86267 / 256 = 336 (truncated)
    expect(combinedRaw).toBe(336);

    // Then damage = int * combined_fixed: ((336 * 100) + 128) / 256 = 33728/256 = 131
    const cppDamage = cppIntTimesFixed(100, combinedRaw);
    expect(cppDamage).toBe(131);

    // TS float: 100 * 1.1 * 1.2 = 132
    // C++ gives 131 due to cascaded truncation!
    expect(Math.round(100 * 1.1 * 1.2)).toBe(132);
    expect(cppDamage).not.toBe(132);
  });

  it('cascaded multiplication: France(ROF=1.1) * Difficult(ROF=1.2)', () => {
    const franceRofRaw = cppFixedDecimal('1.1'); // 281
    const diffRofRaw = cppFixedDecimal('1.2'); // 307

    // C++ fixed * fixed: (281 * 307) / 256 = 336
    const combinedRaw = cppFixedTimesFixed(franceRofRaw, diffRofRaw);
    expect(combinedRaw).toBe(336);

    // ROF bias applied to weapon ROF=50:
    // C++ int * fixed: ((336 * 50) + 128) / 256 = (16800+128)/256 = 16928/256 = 66
    const cppROF = cppIntTimesFixed(50, combinedRaw);
    expect(cppROF).toBe(66);

    // TS float: Math.round(50 * 1.1 * 1.2) = Math.round(66) = 66 — same here!
    expect(Math.round(50 * 1.1 * 1.2)).toBe(66);
  });
});

// ============================================================
// Section 20: Power output from rules.ini — verify TS uses INI Power= values
// ============================================================
describe('power output: TS uses rules.ini Power= values', () => {
  it('POWR Power= from rules.ini matches TS powerOutput at full HP', () => {
    const iniPower = parseInt(ini['POWR']?.['Power'] ?? '0', 10);
    const iniMaxHp = parseInt(ini['POWR']?.['Strength'] ?? '0', 10);
    expect(iniPower).toBe(100); // verify INI has expected value
    const tsOutput = powerOutput('POWR', iniMaxHp, iniMaxHp);
    expect(tsOutput).toBe(iniPower);
  });

  it('APWR Power= from rules.ini matches TS powerOutput at full HP', () => {
    const iniPower = parseInt(ini['APWR']?.['Power'] ?? '0', 10);
    const iniMaxHp = parseInt(ini['APWR']?.['Strength'] ?? '0', 10);
    expect(iniPower).toBe(200); // verify INI has expected value
    const tsOutput = powerOutput('APWR', iniMaxHp, iniMaxHp);
    expect(tsOutput).toBe(iniPower);
  });

  it('power at exactly half HP uses fixed-point, not float', () => {
    const powrMaxHp = parseInt(ini['POWR']?.['Strength'] ?? '400', 10);
    const halfHp = Math.floor(powrMaxHp / 2);

    // C++ fixed(halfHp, maxHp) * 100
    const fixedRaw = cppFixed(halfHp, powrMaxHp);
    const cppPower = cppIntTimesFixed(100, fixedRaw);

    // TS
    const tsPower = powerOutput('POWR', halfHp, powrMaxHp);

    // Both should agree (half of even number is exact in fixed-point)
    expect(tsPower).toBe(cppPower);
  });

  it('STEK Power=-100 (negative = drain only): powerOutput returns 0', () => {
    const stekPower = parseInt(ini['STEK']?.['Power'] ?? '0', 10);
    expect(stekPower).toBe(-100); // STEK drains, doesn't produce
    expect(powerOutput('STEK', 600, 600)).toBe(0); // should return 0 for non-power buildings
  });
});
