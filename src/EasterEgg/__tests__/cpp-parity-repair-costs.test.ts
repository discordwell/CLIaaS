/**
 * C++ Behavioral Parity Tests: Repair Costs, Repair Steps, & Power-Fraction Production Rate
 *
 * C++ source of truth:
 *   techno.cpp:6139-6145  — Repair_Cost(): integer division then fixed-point multiply
 *   techno.cpp:6164-6170  — Repair_Step(): returns RepairStep (buildings) or URepairStep (units)
 *   techno.cpp:987-1016   — Service Depot repair loop: cost=max(Repair_Cost(),1), step=max(Repair_Step(),1)
 *   rules.cpp:228-231     — Constructor defaults: RepairStep=5, RepairPercent=fixed(1,4),
 *                           URepairStep=5, URepairPercent=fixed(1,4)
 *   fixed.cpp:59-66       — fixed(n,d) = floor(n * 256 / d)
 *   fixed.h:109           — int * fixed = ((Data.Raw * rvalue) + 128) / 256
 *   fixed.h:155-156       — friend int * fixed delegates to fixed::operator*(int)
 *   building.cpp:4607-4616 — Power_Output: Class->Power * fixed(LastStrength, MaxStrength)
 *   factory.cpp:434       — rate = time / Bound(Power_Fraction(), fixed(1,16), fixed(1))
 *   fixed.h:156           — int / fixed = ((lvalue * 256) + 128) / rvalue.Raw
 *   house.cpp:4160-4170   — Power_Fraction(): Power>=Drain → 1; Power>0 → fixed(Power,Drain); else 0
 *
 * rules.ini runtime values (what the game actually uses):
 *   RepairStep=7, RepairPercent=20% (raw=51), URepairStep=10, URepairPercent=20% (raw=51)
 *
 * C++ Repair_Cost formula (buildings, techno.cpp:6144):
 *   return (Raw_Cost() / (MaxStrength / Rule.RepairStep)) * Rule.RepairPercent;
 *
 *   Step-by-step (all integer arithmetic until fixed-point multiply):
 *     1. stepsToFull = MaxStrength / RepairStep           (C++ int / int = truncated)
 *     2. costPerFullStep = Raw_Cost() / stepsToFull       (C++ int / int = truncated)
 *     3. result = costPerFullStep * RepairPercent          (int * fixed → rounded)
 *        RepairPercent raw = floor(0.20*256) = 51
 *        int * fixed = ((51 * costPerFullStep) + 128) / 256
 *
 * C++ Repair_Cost formula (units/foot, techno.cpp:6142):
 *   return (Raw_Cost() / (MaxStrength / Rule.URepairStep)) * Rule.URepairPercent;
 *   (Same formula with URepairStep=10, URepairPercent raw=51)
 *
 * TS formula (repairSell.ts) now matches C++ exactly:
 *   stepsToFull = Math.trunc(maxHp / step)
 *   costPerFullStep = Math.trunc(buildCost / stepsToFull)
 *   result = Math.max(1, Math.trunc((raw * costPerFullStep + 128) / 256))
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
 * C++ techno.cpp:6144:
 *   (Raw_Cost() / (MaxStrength / RepairStep)) * RepairPercent
 *
 * Step-by-step with integer arithmetic:
 *   stepsToFull = trunc(maxStrength / repairStep)
 *   costPerFullStep = trunc(rawCost / stepsToFull)
 *   result = trunc((percentRaw * costPerFullStep + 128) / 256)
 */
function cppRepairCost(rawCost: number, maxStrength: number, repairStep: number, percentRaw: number): number {
  const stepsToFull = Math.floor(maxStrength / repairStep);           // C++ int / int truncated
  if (stepsToFull === 0) return 0;  // would be UB in C++, but guard for safety
  const costPerFullStep = Math.floor(rawCost / stepsToFull);          // C++ int / int truncated
  return Math.floor(((percentRaw * costPerFullStep) + 128) / 256);
}

// Fixed-point raw values from rules.ini percentages
const BLDG_RAW = Math.floor(REPAIR_PERCENT * 256);   // 51 for 20%
const UNIT_RAW = Math.floor(UREPAIR_PERCENT * 256);  // 51 for 20%

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
// Section 1: Rule constants match rules.ini runtime values
// ============================================================
describe('Rule constants match rules.ini runtime values', () => {
  it('REPAIR_STEP = 7 (rules.ini RepairStep)', () => {
    expect(REPAIR_STEP).toBe(7);
  });

  it('REPAIR_PERCENT = 0.20 (rules.ini RepairPercent=20%)', () => {
    expect(REPAIR_PERCENT).toBe(0.20);
  });

  it('UREPAIR_STEP = 10 (rules.ini URepairStep)', () => {
    expect(UREPAIR_STEP).toBe(10);
  });

  it('UREPAIR_PERCENT = 0.20 (rules.ini URepairPercent=20%)', () => {
    expect(UREPAIR_PERCENT).toBe(0.20);
  });
});

// ============================================================
// Section 2: Building repair cost — C++ and TS agree
// C++ techno.cpp:6144 vs TS repairSell.ts (both use integer+fixed-point)
// ============================================================
describe('building repairCostPerStep — C++ agreement cases (techno.cpp:6144)', () => {
  // Each case: [description, buildCost, maxHp, expected]
  // C++: (cost / (maxHp / 7)) * fixed(20%) where raw=51
  const agreeCases: [string, number, number, number][] = [
    // Power Plant: cost=300, maxHp=200
    // C++: trunc(200/7)=28; trunc(300/28)=10; trunc((51*10+128)/256) = trunc(638/256) = 2
    ['Power Plant (cost=300, hp=200)', 300, 200, 2],

    // Construction Yard: cost=5000, maxHp=400
    // C++: trunc(400/7)=57; trunc(5000/57)=87; trunc((51*87+128)/256) = trunc(4565/256) = 17
    ['Construction Yard (cost=5000, hp=400)', 5000, 400, 17],

    // Barracks: cost=300, maxHp=400
    // C++: trunc(400/7)=57; trunc(300/57)=5; trunc((51*5+128)/256) = trunc(383/256) = 1
    ['Barracks (cost=300, hp=400)', 300, 400, 1],

    // Ore Refinery: cost=2000, maxHp=500
    // C++: trunc(500/7)=71; trunc(2000/71)=28; trunc((51*28+128)/256) = trunc(1556/256) = 6
    ['Ore Refinery (cost=2000, hp=500)', 2000, 500, 6],

    // Flame Tower: cost=600, maxHp=200
    // C++: trunc(200/7)=28; trunc(600/28)=21; trunc((51*21+128)/256) = trunc(1199/256) = 4
    ['Flame Tower (cost=600, hp=200)', 600, 200, 4],

    // War Factory: cost=2000, maxHp=400
    // C++: trunc(400/7)=57; trunc(2000/57)=35; trunc((51*35+128)/256) = trunc(1913/256) = 7
    ['War Factory (cost=2000, hp=400)', 2000, 400, 7],
  ];

  for (const [desc, cost, hp, expected] of agreeCases) {
    it(`${desc}: cost per step = ${expected}`, () => {
      // Verify our C++ reference formula
      expect(cppRepairCost(cost, hp, REPAIR_STEP, BLDG_RAW)).toBe(expected);
      // Verify TS function matches
      expect(repairCostPerStep(cost, hp)).toBe(expected);
    });
  }
});

// ============================================================
// Section 3: Building repair cost — additional cases
// With rules.ini values (step=7, raw=51), C++ and TS now agree on all cases
// because TS uses the same integer+fixed-point formula
// ============================================================
describe('building repairCostPerStep — additional cases (techno.cpp:6144)', () => {
  const additionalCases: [string, number, number, number][] = [
    // cost=500, maxHp=150
    // C++: trunc(150/7)=21; trunc(500/21)=23; trunc((51*23+128)/256) = trunc(1301/256) = 5
    ['cost=500, hp=150', 500, 150, 5],

    // cost=100, maxHp=7
    // C++: trunc(7/7)=1; trunc(100/1)=100; trunc((51*100+128)/256) = trunc(5228/256) = 20
    ['cost=100, hp=7', 100, 7, 20],

    // cost=1000, maxHp=300
    // C++: trunc(300/7)=42; trunc(1000/42)=23; trunc((51*23+128)/256) = trunc(1301/256) = 5
    ['cost=1000, hp=300', 1000, 300, 5],

    // cost=750, maxHp=250
    // C++: trunc(250/7)=35; trunc(750/35)=21; trunc((51*21+128)/256) = trunc(1199/256) = 4
    ['cost=750, hp=250', 750, 250, 4],

    // cost=1700, maxHp=400
    // C++: trunc(400/7)=57; trunc(1700/57)=29; trunc((51*29+128)/256) = trunc(1607/256) = 6
    ['cost=1700, hp=400', 1700, 400, 6],
  ];

  for (const [desc, cost, hp, expected] of additionalCases) {
    it(`${desc}: cost per step = ${expected}`, () => {
      expect(cppRepairCost(cost, hp, REPAIR_STEP, BLDG_RAW)).toBe(expected);
      expect(repairCostPerStep(cost, hp)).toBe(expected);
    });
  }
});

// ============================================================
// Section 4: Unit repair cost — Service Depot (techno.cpp:6141-6142)
// Uses URepairStep=10, URepairPercent raw=51
// ============================================================
describe('unitRepairCostPerStep — C++ parity (techno.cpp:6141-6142)', () => {
  // Medium Tank: cost=800, maxHp=400
  // C++: trunc(400/10)=40; trunc(800/40)=20; trunc((51*20+128)/256) = trunc(1148/256) = 4
  it('Medium Tank (cost=800, hp=400): cost per step = 4', () => {
    expect(cppRepairCost(800, 400, UREPAIR_STEP, UNIT_RAW)).toBe(4);
    expect(unitRepairCostPerStep(800, 400)).toBe(4);
  });

  // Light Tank: cost=600, maxHp=300
  // C++: trunc(300/10)=30; trunc(600/30)=20; trunc((51*20+128)/256) = trunc(1148/256) = 4
  it('Light Tank (cost=600, hp=300): cost per step = 4', () => {
    expect(cppRepairCost(600, 300, UREPAIR_STEP, UNIT_RAW)).toBe(4);
    expect(unitRepairCostPerStep(600, 300)).toBe(4);
  });

  // Mammoth Tank: cost=1700, maxHp=600
  // C++: trunc(600/10)=60; trunc(1700/60)=28; trunc((51*28+128)/256) = trunc(1556/256) = 6
  it('Mammoth Tank (cost=1700, hp=600): cost per step = 6', () => {
    expect(cppRepairCost(1700, 600, UREPAIR_STEP, UNIT_RAW)).toBe(6);
    expect(unitRepairCostPerStep(1700, 600)).toBe(6);
  });

  // APC: cost=800, maxHp=200
  // C++: trunc(200/10)=20; trunc(800/20)=40; trunc((51*40+128)/256) = trunc(2168/256) = 8
  it('APC (cost=800, hp=200): cost per step = 8', () => {
    expect(cppRepairCost(800, 200, UREPAIR_STEP, UNIT_RAW)).toBe(8);
    expect(unitRepairCostPerStep(800, 200)).toBe(8);
  });

  // MCV: cost=5000, maxHp=600
  // C++: trunc(600/10)=60; trunc(5000/60)=83; trunc((51*83+128)/256) = trunc(4361/256) = 17
  it('MCV (cost=5000, hp=600): cost per step = 17', () => {
    expect(cppRepairCost(5000, 600, UREPAIR_STEP, UNIT_RAW)).toBe(17);
    expect(unitRepairCostPerStep(5000, 600)).toBe(17);
  });
});

// ============================================================
// Section 5: Repair step value — techno.cpp:6164-6170
// ============================================================
describe('Repair_Step values (techno.cpp:6164-6170)', () => {
  // C++: buildings return Rule.RepairStep = 7 (rules.ini)
  //      units (Is_Foot) return Rule.URepairStep = 10 (rules.ini)

  it('building repair step = REPAIR_STEP = 7', () => {
    expect(REPAIR_STEP).toBe(7);
  });

  it('unit repair step = UREPAIR_STEP = 10', () => {
    expect(UREPAIR_STEP).toBe(10);
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
    // C++: trunc(400/10)=40; trunc(1/40)=0; trunc((51*0+128)/256) = 0; max(0,1) = 1
    const cppRawCost = cppRepairCost(1, 400, UREPAIR_STEP, UNIT_RAW);
    expect(cppRawCost).toBe(0);
    const cppClampedCost = Math.max(cppRawCost, 1); // techno.cpp:989
    expect(cppClampedCost).toBe(1);
    // TS max(1, ...) naturally produces 1, matching the clamped C++ behavior
    expect(unitRepairCostPerStep(1, 400)).toBe(1);
  });

  it('free unit (cost=0) still costs 1 to repair in C++', () => {
    // C++: trunc(0/40)=0; trunc((51*0+128)/256)=0; max(0,1)=1
    const cppRawCost = cppRepairCost(0, 400, UREPAIR_STEP, UNIT_RAW);
    expect(cppRawCost).toBe(0);
    const cppClampedCost = Math.max(cppRawCost, 1);
    expect(cppClampedCost).toBe(1);
    // TS: max(1, trunc((51*0+128)/256)) = max(1, 0) = 1
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
  it('full health: output = rated power', () => {
    expect(fixedPowerOutput(100, 200, 200)).toBe(100);
    expect(fixedPowerOutput(200, 400, 400)).toBe(200);
  });

  it('half health: fixed-point truncation', () => {
    // fixed(100,200).Raw = floor(100*256/200) = floor(128) = 128
    // 100 * fixed = ((128 * 100) + 128) / 256 = 12928/256 = 50.5 → floor = 50
    expect(fixedPowerOutput(100, 100, 200)).toBe(50);
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
    expect(fixedPowerOutput(200, 700, 700)).toBe(200);
    expect(fixedPowerOutput(200, 350, 700)).toBe(100);
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
  it('full power: rate = time (no penalty)', () => {
    expect(cppProductionRate(100, 256)).toBe(100);
  });

  it('50% power: rate = time / 0.5 = time * 2', () => {
    const raw = Math.floor(50 * 256 / 100); // 128
    expect(raw).toBe(128);
    expect(cppProductionRate(100, 128)).toBe(201);
  });

  it('25% power: rate = time / 0.25 = time * 4', () => {
    const raw = Math.floor(25 * 256 / 100); // 64
    expect(raw).toBe(64);
    expect(cppProductionRate(100, 64)).toBe(402);
  });

  it('10% power: rate = time / 0.1 = time * 10', () => {
    const raw = Math.floor(10 * 256 / 100); // 25
    expect(raw).toBe(25);
    expect(cppProductionRate(100, 25)).toBe(1029);
  });

  it('1/16 power: rate = time * 16', () => {
    const raw = Math.floor(1 * 256 / 16); // 16
    expect(raw).toBe(16);
    expect(cppProductionRate(100, 16)).toBe(1608);
  });

  it('zero power: Bound clamps to fixed(1,16), rate = time * 16', () => {
    expect(cppProductionRate(100, 16)).toBe(1608);
  });
});

// ============================================================
// Section 11: TS powerMultiplier vs C++ fixed-point division
// ============================================================
describe('powerMultiplier floating-point vs C++ fixed-point', () => {
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
    expect(powerMultiplier(0, 100)).toBe(1 / 16);
  });

  it('C++ fixed-point Power_Fraction truncation vs TS float', () => {
    const tsMult = powerMultiplier(33, 100);
    const cppFixedRaw = Math.floor(33 * 256 / 100); // 84
    const cppEffectiveFraction = cppFixedRaw / 256;  // 0.328125
    expect(tsMult).toBe(0.33);
    expect(cppEffectiveFraction).not.toBe(0.33);
    expect(Math.abs(tsMult - cppEffectiveFraction)).toBeCloseTo(0.001875, 6);
  });
});

// ============================================================
// Section 12: Systematic C++ repair cost sweep
// Tests 17 cost/hp combos — with rules.ini values, C++ and TS agree on all
// ============================================================
describe('systematic repair cost sweep — C++ vs TS', () => {
  // C++ formula:  trunc(((51 * trunc(cost / trunc(maxHp/7))) + 128) / 256)
  // TS formula:   same (integer + fixed-point)
  const sweep: [number, number][] = [
    [100,  100],   // trunc(100/7)=14; trunc(100/14)=7; trunc((51*7+128)/256)=1
    [200,  100],   // trunc(100/7)=14; trunc(200/14)=14; trunc((51*14+128)/256)=3
    [300,  200],   // trunc(200/7)=28; trunc(300/28)=10; trunc((51*10+128)/256)=2
    [400,  200],   // trunc(200/7)=28; trunc(400/28)=14; trunc((51*14+128)/256)=3
    [500,  150],   // trunc(150/7)=21; trunc(500/21)=23; trunc((51*23+128)/256)=5
    [600,  300],   // trunc(300/7)=42; trunc(600/42)=14; trunc((51*14+128)/256)=3
    [700,  200],   // trunc(200/7)=28; trunc(700/28)=25; trunc((51*25+128)/256)=5
    [800,  400],   // trunc(400/7)=57; trunc(800/57)=14; trunc((51*14+128)/256)=3
    [900,  250],   // trunc(250/7)=35; trunc(900/35)=25; trunc((51*25+128)/256)=5
    [1000, 300],   // trunc(300/7)=42; trunc(1000/42)=23; trunc((51*23+128)/256)=5
    [1100, 400],   // trunc(400/7)=57; trunc(1100/57)=19; trunc((51*19+128)/256)=4
    [1200, 400],   // trunc(400/7)=57; trunc(1200/57)=21; trunc((51*21+128)/256)=4
    [1500, 500],   // trunc(500/7)=71; trunc(1500/71)=21; trunc((51*21+128)/256)=4
    [2000, 400],   // trunc(400/7)=57; trunc(2000/57)=35; trunc((51*35+128)/256)=7
    [2500, 500],   // trunc(500/7)=71; trunc(2500/71)=35; trunc((51*35+128)/256)=7
    [3000, 600],   // trunc(600/7)=85; trunc(3000/85)=35; trunc((51*35+128)/256)=7
    [5000, 400],   // trunc(400/7)=57; trunc(5000/57)=87; trunc((51*87+128)/256)=17
  ];

  for (const [cost, hp] of sweep) {
    const cpp = cppRepairCost(cost, hp, REPAIR_STEP, BLDG_RAW);

    it(`cost=${cost}, hp=${hp}: C++=${cpp}, TS matches`, () => {
      // Verify the C++ reference formula
      expect(cppRepairCost(cost, hp, REPAIR_STEP, BLDG_RAW)).toBe(cpp);
      // TS now matches C++ exactly (both use integer+fixed-point)
      expect(repairCostPerStep(cost, hp)).toBe(cpp);
    });
  }
});

// ============================================================
// Section 13: C++ Repair_Cost returns 0 for very cheap structures
// techno.cpp:6144 — integer division can zero out
// ============================================================
describe('Repair_Cost returns 0 for very cheap structures', () => {
  it('cost=1, maxHp=100: C++ rounds to 0, TS clamps to 1', () => {
    // C++: trunc(100/7)=14; trunc(1/14)=0; trunc((51*0+128)/256)=0
    expect(cppRepairCost(1, 100, REPAIR_STEP, BLDG_RAW)).toBe(0);
    // TS: max(1, 0) = 1 — call site clamp
    expect(repairCostPerStep(1, 100)).toBe(1);
  });

  it('cost=3, maxHp=200: C++ rounds to 0, TS clamps to 1', () => {
    // C++: trunc(200/7)=28; trunc(3/28)=0; trunc((51*0+128)/256)=0
    expect(cppRepairCost(3, 200, REPAIR_STEP, BLDG_RAW)).toBe(0);
    // TS: max(1, 0) = 1
    expect(repairCostPerStep(3, 200)).toBe(1);
    // Both C++ (after clamping) and TS produce 1, but through different paths
  });
});

// ============================================================
// Section 14: Edge cases — maxHp < REPAIR_STEP
// ============================================================
describe('edge cases: maxHp < REPAIR_STEP', () => {
  it('maxHp=3: C++ integer division 3/7=0 is UB — TS guards with fallback 1', () => {
    // C++: trunc(3/7)=0 → divide by zero in next step (UB in C++)
    expect(cppRepairCost(100, 3, REPAIR_STEP, BLDG_RAW)).toBe(0);
    // TS guards: stepsToFull <= 0 returns 1
    expect(repairCostPerStep(100, 3)).toBe(1);
  });

  it('maxHp=1: C++ 1/7=0 is UB — TS guards with fallback 1', () => {
    expect(cppRepairCost(100, 1, REPAIR_STEP, BLDG_RAW)).toBe(0);
    expect(repairCostPerStep(100, 1)).toBe(1);
  });

  it('maxHp=7: exactly one step', () => {
    // C++: trunc(7/7)=1; trunc(100/1)=100; trunc((51*100+128)/256) = trunc(5228/256) = 20
    expect(cppRepairCost(100, 7, REPAIR_STEP, BLDG_RAW)).toBe(20);
    expect(repairCostPerStep(100, 7)).toBe(20);
  });

  it('maxHp=10: one step (trunc(10/7)=1)', () => {
    // C++: trunc(10/7)=1; trunc(100/1)=100; trunc((51*100+128)/256) = 20
    expect(cppRepairCost(100, 10, REPAIR_STEP, BLDG_RAW)).toBe(20);
    expect(repairCostPerStep(100, 10)).toBe(20);
  });
});
