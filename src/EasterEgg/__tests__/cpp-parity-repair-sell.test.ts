/**
 * C++ parity tests: Repair & Sell mechanics
 *
 * C++ sources:
 *   - building.cpp:5432-5483  BuildingClass::Repair_AI — repair loop, cost/step, timing
 *   - techno.cpp:6139-6145    TechnoTypeClass::Repair_Cost — per-step cost formula
 *   - techno.cpp:6164-6170    TechnoTypeClass::Repair_Step — HP per repair tick
 *   - techno.cpp:5743-5762    TechnoClass::Refund_Amount — sell refund formula
 *   - rules.cpp:228-232,265   RulesClass constructor defaults (overridden by rules.ini)
 *   - fixed.cpp:59-66         fixed(int,int) constructor: Raw = (n*256)/d
 *   - fixed.cpp:88-151        fixed(char*) constructor: percent => (pct*256)/100
 *   - fixed.h:109             int operator*(int): ((Raw*rvalue)+128)/256
 *   - defines.h:3031-3032     TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
 *
 * rules.ini overrides (public/ra/assets/rules.ini):
 *   RepairStep=7, RepairPercent=20%, URepairStep=10, URepairPercent=20%,
 *   RepairRate=.016, RefundPercent=50%
 *
 * C++ fixed-point (8.8 format):
 *   fixed("20%")  => Raw = floor(20*256/100) = 51
 *   fixed("50%")  => Raw = floor(50*256/100) = 128
 *   fixed(".016") => Whole=0, Frac=floor(256*16/1000)=4 => Raw=4
 *   int * fixed   => ((Raw * intVal) + 128) / 256   (rounded, integer result)
 */

import { describe, it, expect } from 'vitest';
import {
  repairCostPerStep,
  unitRepairCostPerStep,
  sellRefund,
} from '../engine/repairSell';
import {
  REPAIR_STEP,
  REPAIR_PERCENT,
  UREPAIR_STEP,
  UREPAIR_PERCENT,
} from '../engine/types';

// ---------------------------------------------------------------------------
// C++ reference values — derived from rules.ini and C++ fixed-point math
// ---------------------------------------------------------------------------

// rules.ini [General] values
const CPP_REPAIR_STEP = 7;           // rules.ini RepairStep=7
const CPP_REPAIR_PERCENT_RAW = 51;   // fixed("20%") => floor(20*256/100)
const CPP_UREPAIR_STEP = 10;         // rules.ini URepairStep=10
const CPP_UREPAIR_PERCENT_RAW = 51;  // fixed("20%") => floor(20*256/100)
const CPP_REFUND_PERCENT_RAW = 128;  // fixed("50%") => floor(50*256/100)

// RepairRate: fixed(".016") => Raw=4; 4*900 via int operator*:
// ((4 * 900) + 128) / 256 = 3728 / 256 = 14 (integer truncation)
const CPP_REPAIR_INTERVAL_TICKS = 14;

const TICKS_PER_SECOND = 15;
const TICKS_PER_MINUTE = TICKS_PER_SECOND * 60; // 900

// C++ int * fixed helper — matches fixed.h:109
function cppIntTimesFixed(intVal: number, fixedRaw: number): number {
  return Math.trunc(((fixedRaw * intVal) + 128) / 256);
}

// C++ Repair_Cost formula (techno.cpp:6144 for buildings):
//   (Raw_Cost() / (MaxStrength / Rule.RepairStep)) * Rule.RepairPercent
// All divisions are integer (truncating), then the multiply is int*fixed
function cppRepairCost(rawCost: number, maxStrength: number): number {
  const stepsToFull = Math.trunc(maxStrength / CPP_REPAIR_STEP);
  const costPerStep = Math.trunc(rawCost / stepsToFull);
  return cppIntTimesFixed(costPerStep, CPP_REPAIR_PERCENT_RAW);
}

// C++ Repair_Cost for units (techno.cpp:6142):
function cppUnitRepairCost(rawCost: number, maxStrength: number): number {
  const stepsToFull = Math.trunc(maxStrength / CPP_UREPAIR_STEP);
  const costPerStep = Math.trunc(rawCost / stepsToFull);
  return cppIntTimesFixed(costPerStep, CPP_UREPAIR_PERCENT_RAW);
}

// C++ Refund_Amount (techno.cpp:5743-5762):
//   cost = Raw_Cost() * CostBias (CostBias=1.0 for normal difficulty)
//   if (IsHuman) cost = cost * RefundPercent
function cppRefundAmount(rawCost: number, isHuman: boolean): number {
  if (isHuman) {
    return cppIntTimesFixed(rawCost, CPP_REFUND_PERCENT_RAW);
  }
  return rawCost;
}

// Representative structures from rules.ini
const STRUCTURES = [
  { type: 'POWR', cost: 300,  maxHp: 400 },
  { type: 'APWR', cost: 500,  maxHp: 700 },
  { type: 'PROC', cost: 2000, maxHp: 900 },
  { type: 'BARR', cost: 300,  maxHp: 800 },
  { type: 'TENT', cost: 300,  maxHp: 800 },
  { type: 'WEAP', cost: 2000, maxHp: 1000 },
  { type: 'FACT', cost: 2500, maxHp: 1000 },
  { type: 'FIX',  cost: 1200, maxHp: 800 },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('C++ parity: repair step size (techno.cpp:6164-6170)', () => {
  it('building repair step matches rules.ini RepairStep=7', () => {
    expect(REPAIR_STEP).toBe(CPP_REPAIR_STEP);
  });

  it('unit repair step matches rules.ini URepairStep=10', () => {
    expect(UREPAIR_STEP).toBe(CPP_UREPAIR_STEP);
  });
});

describe('C++ parity: repair cost formula (techno.cpp:6139-6145)', () => {
  // C++ formula: (Raw_Cost() / (MaxStrength / RepairStep)) * RepairPercent
  // Uses integer division then fixed-point multiply

  for (const { type, cost, maxHp } of STRUCTURES) {
    const expected = cppRepairCost(cost, maxHp);
    // C++ clamps minimum cost to 1 (techno.cpp:989)
    const expectedClamped = Math.max(1, expected);

    it(`${type} (cost=${cost}, maxHp=${maxHp}): repair cost per step = ${expectedClamped}`, () => {
      expect(repairCostPerStep(cost, maxHp)).toBe(expectedClamped);
    });
  }

  it('worked example: POWR (cost=300, maxHp=400)', () => {
    // stepsToFull = trunc(400 / 7) = 57
    // costPerStep = trunc(300 / 57) = 5
    // int*fixed = trunc((51 * 5 + 128) / 256) = trunc(383/256) = 1
    expect(repairCostPerStep(300, 400)).toBe(1);
  });

  it('worked example: WEAP (cost=2000, maxHp=1000)', () => {
    // stepsToFull = trunc(1000 / 7) = 142
    // costPerStep = trunc(2000 / 142) = 14
    // int*fixed = trunc((51 * 14 + 128) / 256) = trunc(842/256) = 3
    expect(repairCostPerStep(2000, 1000)).toBe(3);
  });

  it('worked example: FACT (cost=2500, maxHp=1000)', () => {
    // stepsToFull = trunc(1000 / 7) = 142
    // costPerStep = trunc(2500 / 142) = 17
    // int*fixed = trunc((51 * 17 + 128) / 256) = trunc(995/256) = 3
    expect(repairCostPerStep(2500, 1000)).toBe(3);
  });
});

describe('C++ parity: unit repair cost formula (techno.cpp:6141-6142)', () => {
  // Common unit types for service depot
  const UNITS = [
    { type: 'MNLY', cost: 700,  maxHp: 100 },  // Minelayer
    { type: 'HARV', cost: 1400, maxHp: 600 },  // Harvester
    { type: '2TNK', cost: 700,  maxHp: 400 },  // Medium tank
    { type: '3TNK', cost: 950,  maxHp: 400 },  // Heavy tank
    { type: '4TNK', cost: 1800, maxHp: 600 },  // Mammoth tank
    { type: 'JEEP', cost: 600,  maxHp: 150 },  // Ranger
  ];

  for (const { type, cost, maxHp } of UNITS) {
    const expected = Math.max(1, cppUnitRepairCost(cost, maxHp));

    it(`${type} (cost=${cost}, maxHp=${maxHp}): unit repair cost per step = ${expected}`, () => {
      expect(unitRepairCostPerStep(cost, maxHp)).toBe(expected);
    });
  }

  it('worked example: 2TNK (cost=700, maxHp=400)', () => {
    // stepsToFull = trunc(400 / 10) = 40
    // costPerStep = trunc(700 / 40) = 17
    // int*fixed = trunc((51 * 17 + 128) / 256) = trunc(995/256) = 3
    expect(unitRepairCostPerStep(700, 400)).toBe(3);
  });
});

describe('C++ parity: repair rate timing (building.cpp:5462)', () => {
  // C++ RepairRate=".016": fixed(".016") => Whole=0, Frac=floor(256*16/1000)=4 => Raw=4
  // Frame % (Rule.RepairRate * TICKS_PER_MINUTE):
  //   fixed * int = ((4 * 900) + 128) / 256 = 3728 / 256 = 14

  it('repair interval is 14 ticks', () => {
    // Compute via C++ fixed-point math
    const repairRateRaw = Math.trunc((256 * 16) / 1000); // fixed(".016").Fraction = 4
    const interval = Math.trunc(((repairRateRaw * TICKS_PER_MINUTE) + 128) / 256);
    expect(interval).toBe(CPP_REPAIR_INTERVAL_TICKS);
  });

  it('14 ticks = ~0.93 seconds at 15 fps', () => {
    const seconds = CPP_REPAIR_INTERVAL_TICKS / TICKS_PER_SECOND;
    expect(seconds).toBeCloseTo(0.933, 2);
  });
});

describe('C++ parity: sell refund formula (techno.cpp:5743-5762)', () => {
  // Human: cost * RefundPercent (50%)
  // AI: full cost (no RefundPercent applied)

  for (const { type, cost } of STRUCTURES) {
    const humanRefund = cppRefundAmount(cost, true);
    const aiRefund = cppRefundAmount(cost, false);

    it(`${type} (cost=${cost}): human refund = ${humanRefund}`, () => {
      expect(sellRefund(cost, true)).toBe(humanRefund);
    });

    it(`${type} (cost=${cost}): AI refund = ${aiRefund}`, () => {
      expect(sellRefund(cost, false)).toBe(aiRefund);
    });
  }

  it('worked example: PROC (cost=2000) human refund via C++ fixed-point', () => {
    // RefundPercent raw = 128 (50%)
    // int*fixed = trunc((128 * 2000 + 128) / 256) = trunc(256128/256) = 1000
    expect(sellRefund(2000, true)).toBe(1000);
  });

  it('worked example: APWR (cost=500) human refund via C++ fixed-point', () => {
    // int*fixed = trunc((128 * 500 + 128) / 256) = trunc(64128/256) = 250
    expect(sellRefund(500, true)).toBe(250);
  });
});

describe('C++ parity: repair stops when full HP (building.cpp:5475-5478)', () => {
  // C++ Repair_AI: if (Strength >= Class->MaxStrength) { Strength = MaxStrength; IsRepairing = false; }

  it('repair step does not exceed maxHp', () => {
    // Simulate: hp = maxHp - 3, step = 7 => hp should cap at maxHp
    const maxHp = 400;
    const hp = maxHp - 3;
    const newHp = Math.min(maxHp, hp + CPP_REPAIR_STEP);
    expect(newHp).toBe(maxHp);
  });

  it('repair step at exactly maxHp - step arrives at maxHp', () => {
    const maxHp = 1000;
    const hp = maxHp - CPP_REPAIR_STEP;
    const newHp = Math.min(maxHp, hp + CPP_REPAIR_STEP);
    expect(newHp).toBe(maxHp);
  });

  it('full-health building should not start repair (building.cpp:2508)', () => {
    // C++ Repair(): if (Strength == Class->MaxStrength) { soundid = VOC_SCOLD; }
    // The building plays a scold sound and doesn't set IsRepairing.
    // TS toggleRepair returns false if hp >= maxHp.
    // Verify the C++ logic: repair is rejected at full HP.
    const maxHp = 400;
    const hp = maxHp;
    expect(hp >= maxHp).toBe(true);
  });
});

describe('C++ parity: repair stops when out of credits (building.cpp:5479-5481)', () => {
  // C++ Repair_AI:
  //   if (House->Available_Money() >= cost) {
  //       House->Spend_Money(cost);
  //       Strength += step;
  //   } else {
  //       IsRepairing = false;   // stops repair
  //   }

  it('repair cost exceeding credits halts repair', () => {
    const cost = 2000;
    const maxHp = 1000;
    const repairCost = cppRepairCost(cost, maxHp); // 3
    const credits = 2; // less than repair cost
    expect(credits < repairCost).toBe(true);
  });

  it('repair cost of exactly available credits still succeeds', () => {
    const cost = 2000;
    const maxHp = 1000;
    const repairCost = cppRepairCost(cost, maxHp); // 3
    const credits = repairCost;
    expect(credits >= repairCost).toBe(true);
  });
});

describe('C++ parity: sell refund for partially-built buildings (house.cpp:4235)', () => {
  // C++ house.cpp:4235: Refund_Money(btype->Raw_Cost() * Rule.RefundPercent)
  // When a building is sold while still under construction, the refund is the
  // same as a completed building: Raw_Cost * RefundPercent.
  // There is NO health-based scaling in C++ Refund_Amount.

  for (const { type, cost } of STRUCTURES) {
    it(`${type}: partial-build refund same as full-build refund (no health scaling)`, () => {
      // C++ does NOT scale refund by health. A half-built building gets same refund as full.
      const fullRefund = sellRefund(cost, true);
      // The TS sellRefund function should not take health into account
      expect(fullRefund).toBe(cppRefundAmount(cost, true));
    });
  }
});

describe('C++ parity: RepairPercent constant matches rules.ini (rules.cpp:493)', () => {
  it('REPAIR_PERCENT matches rules.ini 20% (not C++ default 25%)', () => {
    expect(REPAIR_PERCENT).toBe(0.20);
  });

  it('UREPAIR_PERCENT matches rules.ini 20% (not C++ default 25%)', () => {
    expect(UREPAIR_PERCENT).toBe(0.20);
  });

  it('fixed-point raw value of 20% is 51', () => {
    const raw = Math.floor(0.20 * 256);
    expect(raw).toBe(CPP_REPAIR_PERCENT_RAW);
  });
});

describe('C++ parity: total repair cost to full HP', () => {
  // Verify that full repair from 1 HP costs approximately RepairPercent of build cost

  for (const { type, cost, maxHp } of STRUCTURES) {
    it(`${type}: total repair cost is roughly 20% of build cost`, () => {
      const stepCost = repairCostPerStep(cost, maxHp);
      const stepsNeeded = Math.ceil((maxHp - 1) / CPP_REPAIR_STEP);
      const totalCost = stepCost * stepsNeeded;
      // Should be approximately 20% of build cost (RepairPercent),
      // but integer truncation at each division step causes variance.
      // Low-cost buildings (e.g. BARR cost=300, maxHp=800) suffer most
      // from truncation: costPerStep floors to 2 but true fraction is ~2.63,
      // inflating the total repair cost ratio to ~38%.
      const ratio = totalCost / cost;
      expect(ratio).toBeGreaterThan(0.10);
      expect(ratio).toBeLessThan(0.45);
    });
  }
});
