/**
 * C++ Behavioral Parity Tests: Repair Costs, Repair Steps, & Power-Fraction Production Rate
 *
 * C++ source of truth:
 *   techno.cpp:6139-6145  — Repair_Cost(): integer division then fixed-point multiply
 *   techno.cpp:6164-6170  — Repair_Step(): returns RepairStep (buildings) or URepairStep (units)
 *   techno.cpp:987-1016   — Service Depot repair loop: cost=max(Repair_Cost(),1), step=max(Repair_Step(),1)
 *   rules.cpp:228-231     — RepairStep=5, RepairPercent=fixed(1,4), URepairStep=5, URepairPercent=fixed(1,4)
 *   fixed.cpp:59-66       — fixed(n,d) = floor(n * 256 / d)
 *   fixed.h:109           — int * fixed = ((Data.Raw * rvalue) + 128) / 256
 *   fixed.h:155-156       — friend int * fixed delegates to fixed::operator*(int)
 *   building.cpp:4607-4616 — Power_Output: Class->Power * fixed(LastStrength, MaxStrength)
 *   factory.cpp:434       — rate = time / Bound(Power_Fraction(), fixed(1,16), fixed(1))
 *   fixed.h:156           — int / fixed = ((lvalue * 256) + 128) / rvalue.Raw
 *   house.cpp:4160-4170   — Power_Fraction(): Power>=Drain → 1; Power>0 → fixed(Power,Drain); else 0
 *
 * C++ Repair_Cost formula (buildings, techno.cpp:6144):
 *   return (Raw_Cost() / (MaxStrength / Rule.RepairStep)) * Rule.RepairPercent;
 *
 *   Step-by-step (all integer arithmetic until fixed-point multiply):
 *     1. stepsToFull = MaxStrength / RepairStep           (C++ int / int = truncated)
 *     2. costPerFullStep = Raw_Cost() / stepsToFull       (C++ int / int = truncated)
 *     3. result = costPerFullStep * fixed(1,4)            (int * fixed → rounded)
 *        fixed(1,4).Raw = floor(1*256/4) = 64
 *        int * fixed = ((64 * costPerFullStep) + 128) / 256
 *
 * C++ Repair_Cost formula (units/foot, techno.cpp:6142):
 *   return (Raw_Cost() / (MaxStrength / Rule.URepairStep)) * Rule.URepairPercent;
 *   (Same formula with URepairStep=5, URepairPercent=fixed(1,4))
 *
 * TS formula (repairSell.ts:49-51):
 *   Math.ceil((buildCost * REPAIR_PERCENT) / (maxHp / REPAIR_STEP))
 *   = Math.ceil((buildCost * 0.25) / (maxHp / 5))
 *
 * KEY DIVERGENCE: C++ uses integer division (truncation) at each step, then
 * fixed-point rounding. TS uses floating-point with Math.ceil at the end.
 * This produces different results for certain cost/maxHp combinations.
 */

import { describe, it, expect } from 'vitest';
import {
  repairCostPerStep,
  unitRepairCostPerStep,
  fixedPowerOutput,
  powerOutput,
  powerMultiplier,
  sellRefund,
} from '../engine/repairSell';
import {
  REPAIR_STEP,
  REPAIR_PERCENT,
  UREPAIR_STEP,
  UREPAIR_PERCENT,
} from '../engine/types';

// ============================================================
// Helper: Emulate the C++ Repair_Cost formula exactly
// ============================================================

/**
 * C++ fixed(1,4) stores Raw = floor(1*256/4) = 64.
 * int * fixed = ((64 * intVal) + 128) / 256  (integer division, with rounding)
 * C++ techno.cpp:6144:
 *   (Raw_Cost() / (MaxStrength / RepairStep)) * RepairPercent
 */
function cppRepairCost(rawCost: number, maxStrength: number, repairStep: number): number {
  const stepsToFull = Math.floor(maxStrength / repairStep);           // C++ int / int truncated
  if (stepsToFull === 0) return 0;  // would be UB in C++, but guard for safety
  const costPerFullStep = Math.floor(rawCost / stepsToFull);          // C++ int / int truncated
  // fixed(1,4).Raw = floor(1*256/4) = 64
  // int * fixed = ((Raw * intVal) + 128) / 256
  return Math.floor(((64 * costPerFullStep) + 128) / 256);
}

/**
 * C++ int / fixed (fixed.h:156):
 *   friend int operator / (int lvalue, fixed const & rvalue)
 *   { if (rvalue.Raw == 0 || rvalue.Raw == 256) return lvalue;
 *     return ((unsigned)(lvalue * 256) + 128) / rvalue.Raw; }
 *
 * Power_Fraction returns fixed(Power, Drain) when Power < Drain.
 * fixed(n,d).Raw = floor(n * 256 / d)
 */
function cppProductionRate(time: number, powerRaw: number): number {
  if (powerRaw === 0 || powerRaw === 256) return time;
  return Math.floor(((time * 256) + 128) / powerRaw);
}

// ============================================================
// Section 1: Rule constants match C++ defaults — rules.cpp:228-231
// ============================================================
describe('Rule constants match C++ defaults (rules.cpp:228-231)', () => {
  it('REPAIR_STEP = 5 (RepairStep)', () => {
    expect(REPAIR_STEP).toBe(5);
  });

  it('REPAIR_PERCENT = 0.25 (RepairPercent = fixed(1,4))', () => {
    expect(REPAIR_PERCENT).toBe(0.25);
  });

  it('UREPAIR_STEP = 5 (URepairStep)', () => {
    expect(UREPAIR_STEP).toBe(5);
  });

  it('UREPAIR_PERCENT = 0.25 (URepairPercent = fixed(1,4))', () => {
    expect(UREPAIR_PERCENT).toBe(0.25);
  });
});

// ============================================================
// Section 2: Building repair cost — cases where C++ and TS agree
// C++ techno.cpp:6144 vs TS repairSell.ts:49-51
// ============================================================
describe('building repairCostPerStep — C++ agreement cases (techno.cpp:6144)', () => {
  // Each case: [description, buildCost, maxHp, cppExpected]
  // C++: (cost / (maxHp / 5)) * fixed(1,4)
  const agreeCases: [string, number, number, number][] = [
    // Power Plant: cost=300, maxHp=200
    // C++: 200/5=40; 300/40=7; ((64*7)+128)/256 = 576/256 = 2
    // TS:  ceil(300*0.25 / (200/5)) = ceil(75/40) = ceil(1.875) = 2
    ['Power Plant (cost=300, hp=200)', 300, 200, 2],

    // Construction Yard: cost=5000, maxHp=400
    // C++: 400/5=80; 5000/80=62; ((64*62)+128)/256 = 4096/256 = 16
    // TS:  ceil(1250/80) = ceil(15.625) = 16
    ['Construction Yard (cost=5000, hp=400)', 5000, 400, 16],

    // Barracks: cost=300, maxHp=400
    // C++: 400/5=80; 300/80=3; ((64*3)+128)/256 = 320/256 = 1
    // TS:  ceil(75/80) = ceil(0.9375) = 1
    ['Barracks (cost=300, hp=400)', 300, 400, 1],

    // War Factory: cost=2000, maxHp=400
    // C++: 400/5=80; 2000/80=25; ((64*25)+128)/256 = 1728/256 = 6
    // TS:  ceil(500/80) = ceil(6.25) = 7
    // WAIT — let me recheck: ((64*25)+128)/256 = (1600+128)/256 = 1728/256 = 6.75 → floor = 6
    // TS: ceil(6.25) = 7
    // This is a DIVERGENCE case. Moving to divergence section.

    // Ore Refinery: cost=2000, maxHp=500
    // C++: 500/5=100; 2000/100=20; ((64*20)+128)/256 = 1408/256 = 5.5 → floor = 5
    // TS:  ceil(500/100) = ceil(5.0) = 5
    ['Ore Refinery (cost=2000, hp=500)', 2000, 500, 5],

    // Flame Tower: cost=600, maxHp=200
    // C++: 200/5=40; 600/40=15; ((64*15)+128)/256 = 1088/256 = 4.25 → floor = 4
    // TS:  ceil(150/40) = ceil(3.75) = 4
    ['Flame Tower (cost=600, hp=200)', 600, 200, 4],
  ];

  for (const [desc, cost, hp, expected] of agreeCases) {
    it(`${desc}: cost per step = ${expected}`, () => {
      // Verify our C++ reference formula
      expect(cppRepairCost(cost, hp, 5)).toBe(expected);
      // Verify TS function matches
      expect(repairCostPerStep(cost, hp)).toBe(expected);
    });
  }
});

// ============================================================
// Section 3: Building repair cost — C++ vs TS DIVERGENCE cases
// C++ uses integer truncation; TS uses floating-point + Math.ceil
// ============================================================
describe('building repairCostPerStep — PARITY GAPS (techno.cpp:6144)', () => {
  // These cases expose the integer-vs-float divergence.
  // C++ formula: floor(((64 * floor(cost / floor(maxHp/5))) + 128) / 256)
  // TS formula:  ceil((cost * 0.25) / (maxHp / 5))

  // War Factory: cost=2000, maxHp=400
  // C++: 400/5=80; 2000/80=25; ((64*25)+128)/256 = 1728/256 = 6 (floor)
  // TS:  ceil(2000*0.25 / (400/5)) = ceil(500/80) = ceil(6.25) = 7
  it('War Factory (cost=2000, hp=400): C++=6, TS diverges', () => {
    const cppExpected = 6;
    expect(cppRepairCost(2000, 400, 5)).toBe(cppExpected);
    // PARITY GAP: TS uses Math.ceil producing 7 instead of C++ integer-rounded 6
    expect(repairCostPerStep(2000, 400)).toBe(cppExpected);
  });

  // cost=500, maxHp=150
  // C++: 150/5=30; 500/30=16 (16.67 truncated); ((64*16)+128)/256 = 1152/256 = 4
  // TS:  ceil(125/30) = ceil(4.1667) = 5
  it('cost=500, hp=150: C++=4, TS diverges', () => {
    const cppExpected = 4;
    expect(cppRepairCost(500, 150, 5)).toBe(cppExpected);
    // PARITY GAP: TS ceil rounds up, C++ integer divides then rounds
    expect(repairCostPerStep(500, 150)).toBe(cppExpected);
  });

  // cost=100, maxHp=7
  // C++: 7/5=1; 100/1=100; ((64*100)+128)/256 = 6528/256 = 25
  // TS:  ceil(25/1.4) = ceil(17.857) = 18
  it('cost=100, hp=7: C++=25, TS diverges (extreme case)', () => {
    const cppExpected = 25;
    expect(cppRepairCost(100, 7, 5)).toBe(cppExpected);
    // PARITY GAP: maxHp/5 truncation in C++ (7/5=1) vs float (7/5=1.4)
    expect(repairCostPerStep(100, 7)).toBe(cppExpected);
  });

  // cost=1000, maxHp=300
  // C++: 300/5=60; 1000/60=16 (16.67 truncated); ((64*16)+128)/256 = 1152/256 = 4
  // TS:  ceil(250/60) = ceil(4.1667) = 5
  it('cost=1000, hp=300: C++=4, TS diverges', () => {
    const cppExpected = 4;
    expect(cppRepairCost(1000, 300, 5)).toBe(cppExpected);
    // PARITY GAP
    expect(repairCostPerStep(1000, 300)).toBe(cppExpected);
  });

  // cost=750, maxHp=250
  // C++: 250/5=50; 750/50=15; ((64*15)+128)/256 = 1088/256 = 4 (floor of 4.25)
  // TS:  ceil(187.5/50) = ceil(3.75) = 4
  it('cost=750, hp=250: both=4 (agreement despite different paths)', () => {
    const cppExpected = 4;
    expect(cppRepairCost(750, 250, 5)).toBe(cppExpected);
    expect(repairCostPerStep(750, 250)).toBe(cppExpected);
  });

  // cost=1700, maxHp=400
  // C++: 400/5=80; 1700/80=21 (21.25 truncated); ((64*21)+128)/256 = 1472/256 = 5 (floor of 5.75)
  // TS:  ceil(425/80) = ceil(5.3125) = 6
  it('cost=1700, hp=400: C++=5, TS diverges', () => {
    const cppExpected = 5;
    expect(cppRepairCost(1700, 400, 5)).toBe(cppExpected);
    // PARITY GAP
    expect(repairCostPerStep(1700, 400)).toBe(cppExpected);
  });
});

// ============================================================
// Section 4: Unit repair cost — Service Depot (techno.cpp:6141-6142)
// Same formula as building repair but uses URepairStep/URepairPercent
// Since defaults are identical (5/0.25), same divergence pattern applies
// ============================================================
describe('unitRepairCostPerStep — C++ parity (techno.cpp:6141-6142)', () => {
  // Medium Tank: cost=800, maxHp=400
  // C++: 400/5=80; 800/80=10; ((64*10)+128)/256 = 768/256 = 3
  // TS:  ceil(200/80) = ceil(2.5) = 3
  it('Medium Tank (cost=800, hp=400): cost per step = 3', () => {
    expect(cppRepairCost(800, 400, 5)).toBe(3);
    expect(unitRepairCostPerStep(800, 400)).toBe(3);
  });

  // Light Tank: cost=600, maxHp=300
  // C++: 300/5=60; 600/60=10; ((64*10)+128)/256 = 768/256 = 3
  // TS:  ceil(150/60) = ceil(2.5) = 3
  it('Light Tank (cost=600, hp=300): cost per step = 3', () => {
    expect(cppRepairCost(600, 300, 5)).toBe(3);
    expect(unitRepairCostPerStep(600, 300)).toBe(3);
  });

  // Mammoth Tank: cost=1700, maxHp=600
  // C++: 600/5=120; 1700/120=14 (14.17 truncated); ((64*14)+128)/256 = 1024/256 = 4
  // TS:  ceil(425/120) = ceil(3.5417) = 4
  it('Mammoth Tank (cost=1700, hp=600): cost per step = 4', () => {
    expect(cppRepairCost(1700, 600, 5)).toBe(4);
    expect(unitRepairCostPerStep(1700, 600)).toBe(4);
  });

  // APC: cost=800, maxHp=200
  // C++: 200/5=40; 800/40=20; ((64*20)+128)/256 = 1408/256 = 5 (floor of 5.5)
  // TS:  ceil(200/40) = ceil(5.0) = 5
  it('APC (cost=800, hp=200): cost per step = 5', () => {
    expect(cppRepairCost(800, 200, 5)).toBe(5);
    expect(unitRepairCostPerStep(800, 200)).toBe(5);
  });

  // MCV: cost=5000, maxHp=600
  // C++: 600/5=120; 5000/120=41 (41.67 truncated); ((64*41)+128)/256 = 2752/256 = 10 (floor of 10.75)
  // TS:  ceil(1250/120) = ceil(10.4167) = 11
  it('MCV (cost=5000, hp=600): C++=10, TS diverges', () => {
    const cppExpected = 10;
    expect(cppRepairCost(5000, 600, 5)).toBe(cppExpected);
    // PARITY GAP: C++ truncates 41.67→41, then rounds 10.75→10; TS ceils 10.4167→11
    expect(unitRepairCostPerStep(5000, 600)).toBe(cppExpected);
  });
});

// ============================================================
// Section 5: Repair step value — techno.cpp:6164-6170
// ============================================================
describe('Repair_Step values (techno.cpp:6164-6170)', () => {
  // C++: buildings return Rule.RepairStep = 5
  //      units (Is_Foot) return Rule.URepairStep = 5
  // TS uses the REPAIR_STEP / UREPAIR_STEP constants directly.

  it('building repair step = REPAIR_STEP = 5', () => {
    expect(REPAIR_STEP).toBe(5);
  });

  it('unit repair step = UREPAIR_STEP = 5', () => {
    expect(UREPAIR_STEP).toBe(5);
  });
});

// ============================================================
// Section 6: Service Depot repair loop — min cost/step clamping
// C++ techno.cpp:987-991: cost=max(Repair_Cost(),1), step=max(Repair_Step(),1)
// ============================================================
describe('Service Depot min-cost/step clamping (techno.cpp:987-991)', () => {
  // C++ line 989: cost = max(cost, 1) — repair always costs at least 1 credit
  // C++ line 991: step = max(step, 1) — repair always heals at least 1 HP

  it('very cheap unit still costs at least 1 per step', () => {
    // cost=1, maxHp=400
    // C++: 400/5=80; 1/80=0; ((64*0)+128)/256 = 128/256 = 0; max(0,1) = 1
    // TS:  ceil(0.25/80) = ceil(0.003125) = 1
    const cppRawCost = cppRepairCost(1, 400, 5);
    expect(cppRawCost).toBe(0);
    const cppClampedCost = Math.max(cppRawCost, 1); // techno.cpp:989
    expect(cppClampedCost).toBe(1);
    // TS ceil naturally produces 1, matching the clamped C++ behavior
    expect(unitRepairCostPerStep(1, 400)).toBe(1);
  });

  it('free unit (cost=0) still costs 1 to repair in C++', () => {
    // C++: 0/80=0; ((64*0)+128)/256=0; max(0,1)=1
    const cppRawCost = cppRepairCost(0, 400, 5);
    expect(cppRawCost).toBe(0);
    const cppClampedCost = Math.max(cppRawCost, 1);
    expect(cppClampedCost).toBe(1);
    // TS: ceil(0/80) = ceil(0) = 0 — no min(1) clamp
    // PARITY GAP: TS returns 0 for free units, C++ returns 1 after clamping
    expect(unitRepairCostPerStep(0, 400)).toBe(cppClampedCost);
  });
});

// ============================================================
// Section 7: Sell refund — techno.cpp:5743-5761
// ============================================================
describe('sellRefund — C++ parity (techno.cpp:5743-5761)', () => {
  // C++: Human gets Rule.RefundPercent (50%), AI gets 100%

  it('human sell refund = 50% of build cost', () => {
    expect(sellRefund(1000, true)).toBe(500);
    expect(sellRefund(300, true)).toBe(150);
    expect(sellRefund(5000, true)).toBe(2500);
  });

  it('AI sell refund = 100% of build cost', () => {
    expect(sellRefund(1000, false)).toBe(1000);
    expect(sellRefund(300, false)).toBe(300);
  });

  it('odd cost: human gets floor of half', () => {
    // cost=301: 301*0.5 = 150.5 → floor = 150
    expect(sellRefund(301, true)).toBe(150);
    expect(sellRefund(1, true)).toBe(0);
  });
});

// ============================================================
// Section 8: Fixed-point Power Output — building.cpp:4607-4616
// C++: Class->Power * fixed(LastStrength, Class->MaxStrength)
// fixed(hp, maxHp).Raw = floor(hp * 256 / maxHp)
// int * fixed = ((Raw * ratedPower) + 128) / 256
// ============================================================
describe('fixedPowerOutput — C++ 8.8 fixed-point parity (building.cpp:4613)', () => {
  // C++: Power_Output = Class->Power * fixed(LastStrength, MaxStrength)
  // fixed(n,d) constructor: Raw = floor(n*256/d)
  // int * fixed: ((Data.Raw * rvalue) + 128) / 256

  it('full health: output = rated power', () => {
    // fixed(200,200).Raw = 256; int * fixed with Raw=256 → short-circuits to ratedPower
    // Actually: ((256 * 100) + 128) / 256 = 25728/256 = 100.5 → floor = 100
    expect(fixedPowerOutput(100, 200, 200)).toBe(100);
    expect(fixedPowerOutput(200, 400, 400)).toBe(200);
  });

  it('half health: fixed-point truncation', () => {
    // fixed(100,200).Raw = floor(100*256/200) = floor(128) = 128
    // 100 * fixed = ((128 * 100) + 128) / 256 = 12928/256 = 50.5 → floor = 50
    expect(fixedPowerOutput(100, 100, 200)).toBe(50);
    // APWR: 200W rated
    // ((128 * 200) + 128) / 256 = 25728/256 = 100.5 → floor = 100
    expect(fixedPowerOutput(200, 100, 200)).toBe(100);
  });

  it('75% health', () => {
    // fixed(150,200).Raw = floor(150*256/200) = floor(192) = 192
    // ((192 * 100) + 128) / 256 = 19328/256 = 75.5 → floor = 75
    expect(fixedPowerOutput(100, 150, 200)).toBe(75);
  });

  it('25% health', () => {
    // fixed(50,200).Raw = floor(50*256/200) = floor(64) = 64
    // ((64 * 100) + 128) / 256 = 6528/256 = 25.5 → floor = 25
    expect(fixedPowerOutput(100, 50, 200)).toBe(25);
  });

  it('1 HP: minimal output', () => {
    // fixed(1,200).Raw = floor(1*256/200) = floor(1.28) = 1
    // ((1 * 100) + 128) / 256 = 228/256 = 0.890625 → floor = 0
    expect(fixedPowerOutput(100, 1, 200)).toBe(0);
  });

  it('0 HP: zero output', () => {
    expect(fixedPowerOutput(100, 0, 200)).toBe(0);
  });

  it('fixed-point truncation at non-round fractions', () => {
    // hp=133, maxHp=200 → 66.5% health
    // fixed(133,200).Raw = floor(133*256/200) = floor(170.24) = 170
    // ((170 * 100) + 128) / 256 = 17128/256 = 66.90625 → floor = 66
    expect(fixedPowerOutput(100, 133, 200)).toBe(66);

    // hp=67, maxHp=200 → 33.5%
    // fixed(67,200).Raw = floor(67*256/200) = floor(85.76) = 85
    // ((85 * 100) + 128) / 256 = 8628/256 = 33.703125 → floor = 33
    expect(fixedPowerOutput(100, 67, 200)).toBe(33);
  });

  it('APWR at various damage levels', () => {
    // APWR = 200W rated, maxHp=700 (typical)
    // Full health: ((256*200)+128)/256 = 51328/256 = 200.5 → 200
    expect(fixedPowerOutput(200, 700, 700)).toBe(200);

    // Half health: fixed(350,700).Raw = floor(350*256/700) = floor(128) = 128
    // ((128*200)+128)/256 = 25728/256 = 100.5 → 100
    expect(fixedPowerOutput(200, 350, 700)).toBe(100);

    // 10% health: fixed(70,700).Raw = floor(70*256/700) = floor(25.6) = 25
    // ((25*200)+128)/256 = 5128/256 = 20.03125 → 20
    expect(fixedPowerOutput(200, 70, 700)).toBe(20);
  });
});

// ============================================================
// Section 9: powerOutput() — type-based dispatch
// ============================================================
describe('powerOutput type dispatch (building.cpp:4613)', () => {
  it('POWR = 100W rated', () => {
    expect(powerOutput('POWR', 200, 200)).toBe(100);
    expect(powerOutput('POWR', 100, 200)).toBe(50);
  });

  it('APWR = 200W rated', () => {
    expect(powerOutput('APWR', 400, 400)).toBe(200);
    expect(powerOutput('APWR', 200, 400)).toBe(100);
  });

  it('non-power buildings return 0', () => {
    expect(powerOutput('FACT', 400, 400)).toBe(0);
    expect(powerOutput('BARR', 400, 400)).toBe(0);
    expect(powerOutput('WEAP', 400, 400)).toBe(0);
  });
});

// ============================================================
// Section 10: Power fraction production rate — factory.cpp:434
// int / fixed arithmetic parity
// ============================================================
describe('production rate via power fraction (factory.cpp:434)', () => {
  // C++ factory.cpp:434:
  //   int rate = time / Bound(House->Power_Fraction(), fixed(1,16), fixed(1));
  //
  // int / fixed (fixed.h:156):
  //   if (Raw == 0 || Raw == 256) return lvalue;
  //   return ((lvalue * 256) + 128) / Raw;
  //
  // Power_Fraction (house.cpp:4164):
  //   if (Power >= Drain) return fixed(1) → Raw=256
  //   if (Power > 0) return fixed(Power, Drain) → Raw = floor(Power*256/Drain)
  //   return fixed(0) → Raw=0

  it('full power: rate = time (no penalty)', () => {
    // Power >= Drain → fixed(1), Raw=256 → short-circuit returns time
    expect(cppProductionRate(100, 256)).toBe(100);
  });

  it('50% power: rate = time / 0.5 = time * 2', () => {
    // fixed(50,100).Raw = floor(50*256/100) = 128
    // rate = ((100*256)+128)/128 = 25728/128 = 201
    // C++ integer division: 201 (not exactly 200 due to rounding bias)
    const raw = Math.floor(50 * 256 / 100); // 128
    expect(raw).toBe(128);
    expect(cppProductionRate(100, 128)).toBe(201);
  });

  it('25% power: rate = time / 0.25 = time * 4', () => {
    // fixed(25,100).Raw = floor(25*256/100) = 64
    // rate = ((100*256)+128)/64 = 25728/64 = 402 (floor)
    const raw = Math.floor(25 * 256 / 100); // 64
    expect(raw).toBe(64);
    expect(cppProductionRate(100, 64)).toBe(402);
  });

  it('10% power: rate = time / 0.1 = time * 10', () => {
    // fixed(10,100).Raw = floor(10*256/100) = floor(25.6) = 25
    // rate = ((100*256)+128)/25 = 25728/25 = 1029 (floor of 1029.12)
    const raw = Math.floor(10 * 256 / 100); // 25
    expect(raw).toBe(25);
    expect(cppProductionRate(100, 25)).toBe(1029);
  });

  it('1/16 power: rate = time * 16', () => {
    // fixed(1,16).Raw = floor(1*256/16) = 16
    // rate = ((100*256)+128)/16 = 25728/16 = 1608
    const raw = Math.floor(1 * 256 / 16); // 16
    expect(raw).toBe(16);
    expect(cppProductionRate(100, 16)).toBe(1608);
  });

  it('zero power: Bound clamps to fixed(1,16), rate = time * 16', () => {
    // Power_Fraction returns 0 (Raw=0), Bound clamps to fixed(1,16) (Raw=16)
    // Short-circuit: Raw==0 → return time (but this path shouldn't be hit
    // because Bound clamps first). The Bound happens BEFORE the division.
    // So the actual fixed passed is fixed(1,16) with Raw=16.
    expect(cppProductionRate(100, 16)).toBe(1608);
  });
});

// ============================================================
// Section 11: TS powerMultiplier vs C++ fixed-point division
// The TS uses floating-point which doesn't match C++ int/fixed exactly
// ============================================================
describe('powerMultiplier floating-point vs C++ fixed-point', () => {
  // TS powerMultiplier returns produced/consumed as a float.
  // C++ uses fixed(Power,Drain) which truncates.
  // Then C++ does int / fixed which is ((time*256)+128)/Raw.
  //
  // The TS approach (multiply progress by powerMult each tick) differs
  // fundamentally from C++ (dividing total time by power fraction once at start).
  // But the powerMultiplier value itself should match C++ Power_Fraction semantics.

  it('full power returns 1.0', () => {
    expect(powerMultiplier(100, 100)).toBe(1.0);
    expect(powerMultiplier(200, 100)).toBe(1.0);
  });

  it('50% power returns 0.5', () => {
    expect(powerMultiplier(50, 100)).toBe(0.5);
  });

  it('no drain returns 1.0 (C++ house.cpp:4164)', () => {
    expect(powerMultiplier(0, 0)).toBe(1.0);
    expect(powerMultiplier(100, 0)).toBe(1.0);
  });

  it('zero produced with drain returns 1/16', () => {
    // C++ Power_Fraction returns 0, Bound(0, 1/16, 1) = 1/16
    expect(powerMultiplier(0, 100)).toBe(1 / 16);
  });

  it('C++ fixed-point Power_Fraction truncation vs TS float', () => {
    // C++ fixed(33, 100).Raw = floor(33*256/100) = floor(84.48) = 84
    // C++ fraction as float: 84/256 = 0.328125 (not 0.33)
    // TS: 33/100 = 0.33
    //
    // This means the C++ effective multiplier is slightly different than TS.
    // For production rate, this would compound over time.
    const tsMult = powerMultiplier(33, 100);
    const cppFixedRaw = Math.floor(33 * 256 / 100); // 84
    const cppEffectiveFraction = cppFixedRaw / 256;  // 0.328125
    expect(tsMult).toBe(0.33);
    expect(cppEffectiveFraction).not.toBe(0.33);
    // The difference is small but real: 0.33 vs 0.328125
    expect(Math.abs(tsMult - cppEffectiveFraction)).toBeCloseTo(0.001875, 6);
  });
});

// ============================================================
// Section 12: Systematic C++ repair cost sweep
// Tests 20 cost/hp combos and documents which diverge
// ============================================================
describe('systematic repair cost sweep — C++ vs TS', () => {
  // Each entry: [cost, maxHp]
  // C++ formula:  floor(((64 * floor(cost / floor(maxHp/5))) + 128) / 256)
  // TS formula:   ceil((cost * 0.25) / (maxHp / 5))
  // Divergence root cause: C++ integer truncation at each division step vs TS float
  const sweep: [number, number][] = [
    [100,  100],   // C++=1, TS=2  — DIVERGE (C++ truncates 100/20=5→1; TS ceil(1.25)=2)
    [200,  100],   // C++=3, TS=3  — match
    [300,  200],   // C++=2, TS=2  — match
    [400,  200],   // C++=3, TS=3  — match
    [500,  150],   // C++=4, TS=5  — DIVERGE
    [600,  300],   // C++=3, TS=3  — match
    [700,  200],   // C++=4, TS=5  — DIVERGE
    [800,  400],   // C++=3, TS=3  — match
    [900,  250],   // C++=5, TS=5  — match
    [1000, 300],   // C++=4, TS=5  — DIVERGE
    [1100, 400],   // C++=3, TS=4  — DIVERGE
    [1200, 400],   // C++=4, TS=4  — match
    [1500, 500],   // C++=4, TS=4  — match
    [2000, 400],   // C++=6, TS=7  — DIVERGE
    [2500, 500],   // C++=6, TS=7  — DIVERGE
    [3000, 600],   // C++=6, TS=7  — DIVERGE
    [5000, 400],   // C++=16, TS=16 — match
  ];

  for (const [cost, hp] of sweep) {
    const cpp = cppRepairCost(cost, hp, 5);
    const tsResult = Math.ceil((cost * 0.25) / (hp / 5));
    const match = cpp === tsResult;

    it(`cost=${cost}, hp=${hp}: C++=${cpp}, TS=${tsResult}${match ? '' : ' DIVERGE'}`, () => {
      // Always verify the C++ reference formula
      expect(cppRepairCost(cost, hp, 5)).toBe(cpp);
      // PARITY GAP: diverging cases will fail here — TS returns tsResult, C++ expects cpp
      // This is intentional: the test documents real C++ divergence.
      expect(repairCostPerStep(cost, hp)).toBe(cpp);
    });
  }
});

// ============================================================
// Section 13: C++ Repair_Cost returns 0 for very cheap structures
// techno.cpp:6144 — integer division can zero out
// ============================================================
describe('Repair_Cost returns 0 for very cheap structures', () => {
  it('cost=1, maxHp=100: C++ rounds to 0', () => {
    // C++: 100/5=20; 1/20=0; ((64*0)+128)/256=0
    expect(cppRepairCost(1, 100, 5)).toBe(0);
    // TS: ceil(0.25/20) = ceil(0.0125) = 1
    // TS returns 1 (ceil), C++ returns 0 (no clamping in formula itself)
    // C++ applies max(cost, 1) at call site (techno.cpp:989), NOT in Repair_Cost
    expect(repairCostPerStep(1, 100)).toBe(1); // TS ceil naturally provides min-1
  });

  it('cost=3, maxHp=200: C++ rounds to 0', () => {
    // C++: 200/5=40; 3/40=0; ((64*0)+128)/256=0
    expect(cppRepairCost(3, 200, 5)).toBe(0);
    // TS: ceil(0.75/40) = ceil(0.01875) = 1
    expect(repairCostPerStep(3, 200)).toBe(1);
    // Both C++ (after clamping) and TS produce 1, but through different paths
  });
});

// ============================================================
// Section 14: Edge cases — maxHp < REPAIR_STEP
// ============================================================
describe('edge cases: maxHp < REPAIR_STEP', () => {
  it('maxHp=3: C++ integer division 3/5=0 causes divide-by-zero territory', () => {
    // C++: 3/5=0 → divide by zero in next step (UB in C++)
    // Our cppRepairCost helper guards against this, returning 0
    expect(cppRepairCost(100, 3, 5)).toBe(0);
    // TS: ceil(25/0.6) = ceil(41.667) = 42 (no UB, just uses floats)
    expect(repairCostPerStep(100, 3)).toBe(42);
    // Major divergence — C++ would be UB, TS gives 42
  });

  it('maxHp=1: C++ 1/5=0 → divide by zero', () => {
    expect(cppRepairCost(100, 1, 5)).toBe(0);
    // TS: ceil(25/0.2) = ceil(125) = 125
    expect(repairCostPerStep(100, 1)).toBe(125);
  });

  it('maxHp=5: exactly one step', () => {
    // C++: 5/5=1; 100/1=100; ((64*100)+128)/256=6528/256=25
    expect(cppRepairCost(100, 5, 5)).toBe(25);
    // TS: ceil(25/1) = 25
    expect(repairCostPerStep(100, 5)).toBe(25);
  });

  it('maxHp=10: two steps', () => {
    // C++: 10/5=2; 100/2=50; ((64*50)+128)/256=3328/256=13
    expect(cppRepairCost(100, 10, 5)).toBe(13);
    // TS: ceil(25/2) = ceil(12.5) = 13
    expect(repairCostPerStep(100, 10)).toBe(13);
  });
});
