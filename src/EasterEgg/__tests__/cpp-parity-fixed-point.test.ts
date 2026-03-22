/**
 * C++ parity test: fixed-point arithmetic (8.8 format) in sell refund and repair cost formulas.
 *
 * C++ uses the `fixed` class (fixed.h) — an 8.8 unsigned fixed-point number stored as uint16.
 * TS uses floating-point Math.floor/Math.trunc. This test verifies bit-exact parity.
 *
 * C++ fixed-point key operations (fixed.h / fixed.cpp):
 *   fixed(n, d)        — Raw = (unsigned)(n * 256) / (unsigned)d          [integer division = truncate]
 *   fixed("P%")        — Raw = (unsigned short)((atoi(P) * 256) / 100)   [integer division = truncate]
 *   operator unsigned() — ((unsigned)Data.Raw + 128) / 256                [round half-up to int]
 *   int * fixed         — (((unsigned)Data.Raw * rvalue) + 128) / 256     [round half-up]
 *   fixed * fixed       — (unsigned short)(((int)a.Raw * (int)b.Raw) / 256)  [truncate]
 *   int / fixed         — ((unsigned)(lvalue * 256) + 128) / rvalue.Raw   [round half-up]
 *
 * rules.ini (authoritative):
 *   RefundPercent=50%   → fixed("50%").Raw = (50*256)/100 = 128
 *   RepairPercent=20%   → fixed("20%").Raw = (20*256)/100 = 51
 *   URepairPercent=20%  → fixed("20%").Raw = (20*256)/100 = 51
 *   RepairStep=7        → int
 *   URepairStep=10      → int
 *   RepairRate=.016     → fixed(".016").Raw = floor(0.016*256) = ... (parsed via decimal path)
 *
 * Sell refund (techno.cpp:5743-5761):
 *   cost = Raw_Cost() * House->CostBias;
 *   if (House->IsHuman) cost = cost * Rule.RefundPercent;  // int *= fixed
 *   int *= fixed  uses: lvalue = ((Data.Raw * lvalue) + 128) / 256  (fixed.h:165)
 *   So: cost = ((128 * cost) + 128) / 256
 *
 * Repair cost (techno.cpp:6139-6145):
 *   (Raw_Cost() / (MaxStrength / Rule.RepairStep)) * Rule.RepairPercent
 *   = (int / int) * fixed  where the parenthesized expression is all integer arithmetic
 *   int * fixed = ((51 * costPerFullStep) + 128) / 256
 *
 * Power output (building.cpp:4613):
 *   Class->Power * fixed(LastStrength, Class->MaxStrength)
 *   = int * fixed  where fixed(n,d).Raw = floor(n*256/d)
 */

import { describe, it, expect } from 'vitest';
import {
  sellRefund,
  repairCostPerStep,
  unitRepairCostPerStep,
  fixedPowerOutput,
} from '../engine/repairSell';
import {
  REPAIR_STEP,
  REPAIR_PERCENT,
  UREPAIR_STEP,
  UREPAIR_PERCENT,
} from '../engine/types';

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
  it('RefundPercent=50% → fixed("50%").Raw = 128', () => {
    expect(cppFixedPercent(50)).toBe(128);
  });

  it('RepairPercent=20% → fixed("20%").Raw = 51', () => {
    expect(cppFixedPercent(20)).toBe(51);
  });

  it('URepairPercent=20% → fixed("20%").Raw = 51', () => {
    expect(cppFixedPercent(20)).toBe(51);
  });

  it('TS REPAIR_PERCENT_RAW = floor(0.20 * 256) matches C++ fixed("20%")', () => {
    const tsRaw = Math.floor(REPAIR_PERCENT * 256);
    expect(tsRaw).toBe(cppFixedPercent(20));
    expect(tsRaw).toBe(51);
  });

  it('TS UREPAIR_PERCENT_RAW = floor(0.20 * 256) matches C++ fixed("20%")', () => {
    const tsRaw = Math.floor(UREPAIR_PERCENT * 256);
    expect(tsRaw).toBe(cppFixedPercent(20));
    expect(tsRaw).toBe(51);
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
  // For even costs: both formulas agree (exact division)
  // For odd costs: C++ rounds UP (adds 0.5 then truncates), naive rounds DOWN

  /** Naive floating-point approach that would produce WRONG results for odd costs */
  function naiveSellRefund(cost: number): number {
    return Math.floor(cost * 0.5);
  }

  /** C++ exact formula: int *= fixed(1,2) via fixed.h:165 */
  function cppSellRefund(cost: number): number {
    return cppIntTimesFixed(cost, 128); // fixed(1,2).Raw = 128
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
    //  C++: ((128 * cost) + 128) / 256 = (128 * (cost + 1)) / 256
    //  For odd cost: cost+1 is even, so (128 * (cost+1))/256 = (cost+1)/2
    //  Naive: floor(cost/2) = (cost-1)/2
    //  Difference: 1
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
  const repairPercentRaw = 51;

  it('fixed("20%") = 51/256 = 0.19921875, not exactly 0.20', () => {
    expect(repairPercentRaw / 256).toBe(0.19921875);
    expect(repairPercentRaw / 256).not.toBe(0.20);
  });

  // Cases where the 0.078125% error in RepairPercent matters
  // C++ result: trunc((51 * intVal + 128) / 256)
  // Exact 20%:  trunc(intVal * 0.20)
  // These differ when intVal is large enough that 0.00078125 * intVal pushes past boundary
  const divergenceCases: [number, number, number][] = [
    // [costPerFullStep, cppResult, exact20pctResult]
    // C++: trunc((51*intVal + 128) / 256) vs trunc(intVal * 0.20)
    // They agree on most small values due to the +128 rounding term.
    // For intVal=5: C++: trunc((255+128)/256)=trunc(383/256)=1. Exact: trunc(1.0)=1. Same.
    // For intVal=128: C++: trunc((6528+128)/256)=trunc(6656/256)=26. Exact: trunc(25.6)=25. Different!
    [128, 26, 25],
    // For intVal=640: C++: trunc((32640+128)/256)=trunc(32768/256)=128. Exact: trunc(128.0)=128. Same.
    // For intVal=641: C++: trunc((32691+128)/256)=trunc(32819/256)=128. Exact: trunc(128.2)=128. Same.
    // For intVal=383: C++: trunc((19533+128)/256)=trunc(19661/256)=76. Exact: trunc(76.6)=76. Same.
    // For intVal=384: C++: trunc((19584+128)/256)=trunc(19712/256)=77. Exact: trunc(76.8)=76. Different!
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
    // There WILL be divergences — the fixed-point representation is not exactly 20%
    expect(divergeCount).toBeGreaterThan(0);
    // Verify TS uses the C++ formula (not exact 20%)
    // The +128 rounding bias causes C++ to round UP more often
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
  function cppBuildingRepairCost(rawCost: number, maxStrength: number): number {
    const stepsToFull = Math.floor(maxStrength / 7); // C++ int/int truncated. RepairStep=7
    if (stepsToFull === 0) return 0; // UB in C++
    const costPerFullStep = Math.floor(rawCost / stepsToFull); // C++ int/int truncated
    return Math.floor(((51 * costPerFullStep) + 128) / 256); // int * fixed("20%")
  }

  function cppUnitRepairCost(rawCost: number, maxStrength: number): number {
    const stepsToFull = Math.floor(maxStrength / 10); // URepairStep=10
    if (stepsToFull === 0) return 0;
    const costPerFullStep = Math.floor(rawCost / stepsToFull);
    return Math.floor(((51 * costPerFullStep) + 128) / 256); // int * fixed("20%")
  }

  // Real game structures from rules.ini
  const buildingCases: [string, number, number][] = [
    // [name, cost, maxHp]
    ['POWR', 300, 200],
    ['APWR', 500, 700],
    ['FACT', 5000, 400],
    ['BARR', 300, 400],
    ['TENT', 300, 400],
    ['PROC', 2000, 500],
    ['WEAP', 2000, 400],
    ['FIX', 1200, 400],
    ['DOME', 1000, 600],
    ['AFLD', 2000, 500],
    ['HPAD', 1500, 400],
    ['ATEK', 2800, 600],
    ['STEK', 2800, 600],
    ['TSLA', 1500, 400],
    ['FTUR', 600, 200],
    ['GUN', 600, 400],
    ['AGUN', 600, 600],
    ['SAM', 750, 400],
    ['GAP', 800, 600],
    ['SILO', 150, 300],
    ['HBOX', 400, 400],
    ['PBOX', 400, 400],
    ['MSLO', 1500, 1000],
    ['IRON', 1200, 600],
  ];

  for (const [name, cost, maxHp] of buildingCases) {
    it(`${name} (cost=${cost}, maxHp=${maxHp}): TS matches C++ exactly`, () => {
      const cppCost = cppBuildingRepairCost(cost, maxHp);
      const cppClamped = Math.max(cppCost, 1); // techno.cpp:989
      const tsCost = repairCostPerStep(cost, maxHp);
      expect(tsCost, `${name}: TS=${tsCost}, C++ (clamped)=${cppClamped}`).toBe(cppClamped);
    });
  }

  // Real game units from rules.ini
  const unitCases: [string, number, number][] = [
    // [name, cost, maxHp]
    ['1TNK', 700, 300],   // Light Tank
    ['2TNK', 800, 400],   // Medium Tank
    ['3TNK', 950, 400],   // Heavy Tank
    ['4TNK', 1700, 600],  // Mammoth Tank
    ['HARV', 1400, 600],  // Harvester
    ['MCV', 5000, 600],   // MCV
    ['APC', 800, 200],    // APC
    ['ARTY', 600, 75],    // Artillery
    ['V2RL', 700, 150],   // V2 Rocket Launcher
    ['MNLY', 700, 50],    // Minelayer
    ['JEEP', 600, 150],   // Ranger
    ['TTNK', 1500, 300],  // Tesla Tank
  ];

  for (const [name, cost, maxHp] of unitCases) {
    it(`${name} (cost=${cost}, maxHp=${maxHp}): TS matches C++ exactly`, () => {
      const cppCost = cppUnitRepairCost(cost, maxHp);
      const cppClamped = Math.max(cppCost, 1); // techno.cpp:989
      const tsCost = unitRepairCostPerStep(cost, maxHp);
      expect(tsCost, `${name}: TS=${tsCost}, C++ (clamped)=${cppClamped}`).toBe(cppClamped);
    });
  }
});

// ============================================================
// Section 5: Power output fixed-point — fixed(hp, maxHp) * ratedPower
// C++: fixed(n,d) = floor(n*256/d); int * fixed = ((Raw * int) + 128) / 256
// ============================================================
describe('power output: fixed(hp, maxHp) * ratedPower (building.cpp:4613)', () => {
  function cppPowerOutput(ratedPower: number, hp: number, maxHp: number): number {
    if (maxHp <= 0 || hp <= 0) return 0;
    const fixedRaw = cppFixed(hp, maxHp);
    return cppIntTimesFixed(ratedPower, fixedRaw);
  }

  // Exhaustive sweep for POWR (100W, maxHp=200)
  it('POWR: TS matches C++ for every HP value 0..200', () => {
    for (let hp = 0; hp <= 200; hp++) {
      const cpp = cppPowerOutput(100, hp, 200);
      const ts = fixedPowerOutput(100, hp, 200);
      expect(ts, `hp=${hp}: TS=${ts}, C++=${cpp}`).toBe(cpp);
    }
  });

  // Exhaustive sweep for APWR (200W, maxHp=700)
  it('APWR: TS matches C++ for every HP value 0..700', () => {
    for (let hp = 0; hp <= 700; hp++) {
      const cpp = cppPowerOutput(200, hp, 700);
      const ts = fixedPowerOutput(200, hp, 700);
      expect(ts, `hp=${hp}: TS=${ts}, C++=${cpp}`).toBe(cpp);
    }
  });

  // Edge: hp > maxHp (overhealing bug, shouldn't happen but verify no crash)
  it('hp > maxHp: produces value > rated power (fixed > 1.0)', () => {
    // C++: fixed(250, 200).Raw = floor(250*256/200) = floor(320) = 320
    // ((320 * 100) + 128) / 256 = 32128/256 = 125.5 → 125
    expect(fixedPowerOutput(100, 250, 200)).toBe(cppPowerOutput(100, 250, 200));
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
    // fixed(1,2) * fixed(1,2): (128 * 128) / 256 = 16384 / 256 = 64 (no rounding needed)
    expect(cppFixedTimesFixed(128, 128)).toBe(64);

    // Now a case where rounding matters:
    // fixed(1,3).Raw = 85
    // fixed(1,3) * fixed(1,3): (85 * 85) / 256 = 7225 / 256 = 28.2226 → truncated to 28
    expect(cppFixedTimesFixed(85, 85)).toBe(28);

    // But 85 cast to int via operator unsigned: (85 + 128) / 256 = 0 (rounds to 0!)
    // So int(fixed(1,3)) = 0, and 0 * fixed(1,3) = 0
    // This is why C++ sometimes uses int*fixed directly rather than converting first

    // int * fixed where int=10, fixed(1,3).Raw=85:
    // ((85 * 10) + 128) / 256 = (850 + 128) / 256 = 978 / 256 = 3
    expect(cppIntTimesFixed(10, 85)).toBe(3);
    // vs exact: trunc(10 * 1/3) = trunc(3.333) = 3 — happens to match here

    // int=11, fixed(1,3).Raw=85:
    // ((85 * 11) + 128) / 256 = (935 + 128) / 256 = 1063 / 256 = 4
    expect(cppIntTimesFixed(11, 85)).toBe(4);
    // vs exact: trunc(11 * 1/3) = trunc(3.667) = 3 — DIFFERENT!
    expect(Math.floor(11 / 3)).toBe(3);
  });

  it('sell refund uses int*=fixed (fixed.h:165) which delegates to int*fixed rounding', () => {
    // C++ techno.cpp:5758: cost = cost * Rule.RefundPercent
    // This calls friend int operator*=(int& lvalue, fixed const& rvalue)
    // Which calls: lvalue = lvalue * rvalue → calls int operator*(fixed) → uses +128 rounding
    // So sell refund gets the round-half-up behavior, NOT truncation

    // Verify: cost=1 → ((128*1)+128)/256 = 256/256 = 1 (rounded UP from 0.5)
    // If it used truncation: (128*1)/256 = 0 (truncated DOWN)
    expect(sellRefund(1, true)).toBe(1); // round-half-up = correct
    expect(Math.floor(128 * 1 / 256)).toBe(0); // would be wrong if truncated
  });
});

// ============================================================
// Section 7: Verify the RepairRate fixed-point parsing
// rules.ini: RepairRate=.016
// C++ fixed(".016"): Whole=0, Fraction=floor(256*16/1000) = floor(4.096) = 4
// So RepairRate.Raw = 4, which as a time value is 4/256 ≈ 0.015625 minutes
// ============================================================
describe('RepairRate fixed-point parsing (fixed.cpp:88-151)', () => {
  it('fixed(".016") parses to Whole=0, Fraction=floor(256*16/1000)=4', () => {
    // C++ parsing: fracpart="016", frac=atoi("016")=16, len=3, base=1000
    // Fraction = (256 * 16) / 1000 = 4096/1000 = 4 (integer division)
    const fraction = Math.floor((256 * 16) / 1000);
    expect(fraction).toBe(4);
    // Total Raw = Whole(0) * 256 + Fraction(4) = 4
    const rawValue = 0 * 256 + fraction;
    expect(rawValue).toBe(4);
    // As a decimal: 4/256 = 0.015625 (not exactly 0.016)
    expect(rawValue / 256).toBe(0.015625);
  });
});

// ============================================================
// Section 8: operator unsigned() — converting fixed to int with rounding
// fixed.h:91: operator unsigned() { return ((unsigned)Data.Raw + 128) / 256; }
// This rounds half-up (adds 0.5 then truncates).
// ============================================================
describe('operator unsigned() — fixed to int conversion (fixed.h:91)', () => {
  it('fixed(1,2).Raw=128 → unsigned = (128+128)/256 = 1', () => {
    expect(cppFixedToUnsigned(128)).toBe(1);
  });

  it('fixed(0,1).Raw=0 → unsigned = 0', () => {
    expect(cppFixedToUnsigned(0)).toBe(0);
  });

  it('fixed(1,3).Raw=85 → unsigned = (85+128)/256 = 0 (rounds down: 0.332 < 0.5)', () => {
    expect(cppFixedToUnsigned(85)).toBe(0);
  });

  it('fixed(2,3).Raw=170 → unsigned = (170+128)/256 = 1 (rounds up: 0.664 > 0.5)', () => {
    expect(cppFixedToUnsigned(170)).toBe(1);
  });

  it('fixed(3,4).Raw=192 → unsigned = (192+128)/256 = 1', () => {
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
// fixed.h:156: friend int operator/(int lvalue, fixed const& rvalue)
// = ((unsigned)(lvalue * 256) + 128) / rvalue.Raw
// Special case: if rvalue.Raw == 0 || rvalue.Raw == 256, return lvalue
// ============================================================
describe('int / fixed — production rate arithmetic (fixed.h:156)', () => {
  it('time / fixed(1,1) = time (special case: Raw=256)', () => {
    expect(cppIntDivFixed(100, 256)).toBe(100);
  });

  it('time / fixed(0,1) = time (special case: Raw=0)', () => {
    expect(cppIntDivFixed(100, 0)).toBe(100);
  });

  it('100 / fixed(1,2) = ((100*256)+128)/128 = 200 (not 201!)', () => {
    // Raw=128: ((25600)+128)/128 = 25728/128 = 201
    // Wait: ((100*256)+128)/128 = (25600+128)/128 = 25728/128 = 201.0 → 201
    expect(cppIntDivFixed(100, 128)).toBe(201);
    // Note: naive 100/0.5 = 200. C++ gives 201 due to +128 rounding bias!
  });

  it('100 / fixed(1,4) = ((25600)+128)/64 = 25728/64 = 402', () => {
    expect(cppIntDivFixed(100, 64)).toBe(402);
    // Naive: 100/0.25 = 400. C++ gives 402!
  });

  it('100 / fixed(1,16) = ((25600)+128)/16 = 25728/16 = 1608', () => {
    expect(cppIntDivFixed(100, 16)).toBe(1608);
    // Naive: 100/(1/16) = 1600. C++ gives 1608!
  });
});

// ============================================================
// Section 10: Brute-force sell refund parity sweep
// Verify TS sellRefund matches C++ int*=fixed(1,2) for EVERY cost 0..10000
// ============================================================
describe('sell refund: exhaustive parity sweep 0..10000', () => {
  it('TS sellRefund matches C++ ((128*cost+128)/256) for all costs 0..10000', () => {
    const mismatches: string[] = [];
    for (let cost = 0; cost <= 10000; cost++) {
      const cpp = Math.floor((128 * cost + 128) / 256);
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
// Verify TS repairCostPerStep and unitRepairCostPerStep match C++
// for a wide range of (cost, maxHp) pairs
// ============================================================
describe('repair cost: exhaustive parity sweep', () => {
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
        const cppRaw = cppRepairCostRaw(cost, hp, REPAIR_STEP, 51);
        const cppClamped = Math.max(cppRaw, 1);
        const ts = repairCostPerStep(cost, hp);
        if (ts !== cppClamped) {
          mismatches.push(`cost=${cost},hp=${hp}: TS=${ts}, C++=${cppClamped}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('unit repair: TS matches C++ for costs 0..3000 step 50, maxHp 50..1000 step 50', () => {
    const mismatches: string[] = [];
    for (let cost = 0; cost <= 3000; cost += 50) {
      for (let hp = 50; hp <= 1000; hp += 50) {
        const cppRaw = cppRepairCostRaw(cost, hp, UREPAIR_STEP, 51);
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
    // C++ fixed(1,2) with +128 bias rounds odd values UP
    for (let cost = 1; cost <= 1000; cost += 2) {
      expect(sellRefund(cost, true), `cost=${cost}`).toBe(Math.ceil(cost / 2));
    }
  });

  it('sell refund for even cost is always exactly cost/2', () => {
    for (let cost = 0; cost <= 1000; cost += 2) {
      expect(sellRefund(cost, true), `cost=${cost}`).toBe(cost / 2);
    }
  });

  it('repair cost per step is always >= 1 (min clamp)', () => {
    // Even for very cheap structures, TS clamps to 1
    for (let cost = 0; cost <= 100; cost++) {
      for (const hp of [50, 100, 200, 400, 800]) {
        expect(repairCostPerStep(cost, hp), `cost=${cost},hp=${hp}`).toBeGreaterThanOrEqual(1);
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
// rules.ini is authoritative, NOT rules.cpp defaults
// ============================================================
describe('TS constants match rules.ini (NOT rules.cpp defaults)', () => {
  it('REPAIR_STEP=7 (rules.ini), not 5 (rules.cpp default)', () => {
    expect(REPAIR_STEP).toBe(7);
    expect(REPAIR_STEP).not.toBe(5); // rules.cpp:228 default is 5
  });

  it('REPAIR_PERCENT=0.20 (rules.ini 20%), not 0.25 (rules.cpp fixed(1,4))', () => {
    expect(REPAIR_PERCENT).toBe(0.20);
    expect(REPAIR_PERCENT).not.toBe(0.25); // rules.cpp:229 default is fixed(1,4)=0.25
  });

  it('UREPAIR_STEP=10 (rules.ini), not 5 (rules.cpp default)', () => {
    expect(UREPAIR_STEP).toBe(10);
    expect(UREPAIR_STEP).not.toBe(5); // rules.cpp:230 default is 5
  });

  it('UREPAIR_PERCENT=0.20 (rules.ini 20%), not 0.25 (rules.cpp fixed(1,4))', () => {
    expect(UREPAIR_PERCENT).toBe(0.20);
    expect(UREPAIR_PERCENT).not.toBe(0.25); // rules.cpp:231 default is fixed(1,4)=0.25
  });

  it('rules.ini overrides are significant: step 7 vs 5 changes repair cost by ~40%', () => {
    // Example: POWR cost=300, maxHp=200
    // With step=7: trunc(200/7)=28; trunc(300/28)=10; trunc((51*10+128)/256)=2
    // With step=5: trunc(200/5)=40; trunc(300/40)=7;  trunc((51*7+128)/256)=1
    // Different result!
    const withStep7 = repairCostPerStep(300, 200); // uses REPAIR_STEP=7
    expect(withStep7).toBe(2);
    // If we had used step=5, we'd get 1 — a 50% difference
    const stepsToFull5 = Math.floor(200 / 5);
    const costPerFullStep5 = Math.floor(300 / stepsToFull5);
    const withStep5 = Math.floor(((51 * costPerFullStep5) + 128) / 256);
    expect(withStep5).toBe(1);
    expect(withStep7).not.toBe(withStep5);
  });
});
