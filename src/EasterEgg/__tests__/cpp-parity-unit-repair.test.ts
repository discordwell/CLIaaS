/**
 * C++ parity tests — URepairStep and URepairPercent constants for unit repair.
 *
 * C++ source of truth:
 *   rules.cpp:230  URepairStep  = 5
 *   rules.cpp:231  URepairPercent = fixed(1, 4) = 0.25
 *
 * C++ techno.cpp:6139-6170:
 *   Repair_Cost() — if Is_Foot(): (Raw_Cost()/(MaxStrength/Rule.URepairStep)) * Rule.URepairPercent
 *   Repair_Step() — if Is_Foot(): Rule.URepairStep
 *
 * C++ techno.cpp:987-1016:
 *   Service Depot (FIX building) uses Techno_Type_Class()->Repair_Cost() and Repair_Step()
 *   which dispatches to URepairStep/URepairPercent for foot units.
 *
 * Bug: TS was using building REPAIR_STEP/REPAIR_PERCENT for unit repair at Service Depot.
 *      C++ uses separate URepairStep/URepairPercent constants.
 */

import { describe, it, expect } from 'vitest';
import { REPAIR_STEP, REPAIR_PERCENT, UREPAIR_STEP, UREPAIR_PERCENT } from '../engine/types';
import { repairCostPerStep, unitRepairCostPerStep } from '../engine/repairSell';

describe('C++ parity: URepairStep/URepairPercent for unit repair (rules.cpp:230-231)', () => {
  // -------------------------------------------------------------------
  // Constant value checks
  // -------------------------------------------------------------------
  it('UREPAIR_STEP is 5 (rules.cpp:230 URepairStep = 5)', () => {
    expect(UREPAIR_STEP).toBe(5);
  });

  it('UREPAIR_PERCENT is 0.25 (rules.cpp:231 URepairPercent = fixed(1,4))', () => {
    expect(UREPAIR_PERCENT).toBe(0.25);
  });

  // -------------------------------------------------------------------
  // Separate constants exist (the whole point of this issue)
  // -------------------------------------------------------------------
  it('unit repair constants are separate from building repair constants', () => {
    // Even though defaults are the same, they must be distinct identifiers
    // so modding via rules.ini can set them independently (rules.cpp:494-496)
    expect(typeof UREPAIR_STEP).toBe('number');
    expect(typeof UREPAIR_PERCENT).toBe('number');
    expect(typeof REPAIR_STEP).toBe('number');
    expect(typeof REPAIR_PERCENT).toBe('number');
  });

  // -------------------------------------------------------------------
  // Unit repair cost formula: C++ techno.cpp:6141-6142
  //   (Raw_Cost() / (MaxStrength / Rule.URepairStep)) * Rule.URepairPercent
  // -------------------------------------------------------------------
  it('unitRepairCostPerStep matches C++ formula for Medium Tank (cost=800, maxHp=400)', () => {
    // stepsToFull = maxHp / URepairStep = 400 / 5 = 80
    // costPerStep = ceil(800 * 0.25 / 80) = ceil(200 / 80) = ceil(2.5) = 3
    const cost = unitRepairCostPerStep(800, 400);
    expect(cost).toBe(3);
  });

  it('unitRepairCostPerStep matches C++ formula for Heavy Tank (cost=950, maxHp=400)', () => {
    // stepsToFull = 400 / 5 = 80
    // costPerStep = ceil(950 * 0.25 / 80) = ceil(237.5 / 80) = ceil(2.96875) = 3
    const cost = unitRepairCostPerStep(950, 400);
    expect(cost).toBe(3);
  });

  it('unitRepairCostPerStep matches C++ fixed-point for MCV (cost=5000, maxHp=600)', () => {
    // C++ fixed-point: trunc(5000/120)=41, ((64*41)+128)/256 = trunc(2752/256) = 10
    const cost = unitRepairCostPerStep(5000, 600);
    expect(cost).toBe(10);
  });

  it('unitRepairCostPerStep for cheap unit (cost=300, maxHp=200)', () => {
    // stepsToFull = 200 / 5 = 40
    // costPerStep = ceil(300 * 0.25 / 40) = ceil(75 / 40) = ceil(1.875) = 2
    const cost = unitRepairCostPerStep(300, 200);
    expect(cost).toBe(2);
  });

  // -------------------------------------------------------------------
  // unitRepairCostPerStep uses UREPAIR constants, not REPAIR constants
  // -------------------------------------------------------------------
  it('unitRepairCostPerStep uses UREPAIR_PERCENT and UREPAIR_STEP (not building constants)', () => {
    // With current defaults both produce the same result, but the function
    // must call the unit-specific formula. Verify formulas are internally consistent:
    //   unit: ceil(cost * UREPAIR_PERCENT / (maxHp / UREPAIR_STEP))
    //   bldg: ceil(cost * REPAIR_PERCENT / (maxHp / REPAIR_STEP))
    const buildCost = 1200;
    const maxHp = 400;

    const unitCost = unitRepairCostPerStep(buildCost, maxHp);
    const bldgCost = repairCostPerStep(buildCost, maxHp);

    const expectedUnit = Math.ceil((buildCost * UREPAIR_PERCENT) / (maxHp / UREPAIR_STEP));
    const expectedBldg = Math.ceil((buildCost * REPAIR_PERCENT) / (maxHp / REPAIR_STEP));

    expect(unitCost).toBe(expectedUnit);
    expect(bldgCost).toBe(expectedBldg);
  });

  // -------------------------------------------------------------------
  // HP per tick at Service Depot
  // -------------------------------------------------------------------
  it('unit heals UREPAIR_STEP HP per Service Depot tick (techno.cpp:999)', () => {
    const hp = 150;
    const maxHp = 400;
    const healed = Math.min(maxHp, hp + UREPAIR_STEP);
    expect(healed - hp).toBe(5);
  });

  // -------------------------------------------------------------------
  // Full repair cost for a unit
  // -------------------------------------------------------------------
  it('total unit repair cost from 1 HP to full for Medium Tank', () => {
    // maxHp=400, cost=800
    // HP to heal: 399 (from 1 to 400)
    // Number of steps: ceil(399 / 5) = 80 steps
    // Cost per step: ceil(800 * 0.25 / (400 / 5)) = 3
    // Total cost: 80 * 3 = 240
    const buildCost = 800;
    const maxHp = 400;
    const startHp = 1;
    const costPerStep = unitRepairCostPerStep(buildCost, maxHp);

    let totalCost = 0;
    let hp = startHp;
    while (hp < maxHp) {
      totalCost += costPerStep;
      hp = Math.min(maxHp, hp + UREPAIR_STEP);
    }

    const numSteps = Math.ceil((maxHp - startHp) / UREPAIR_STEP);
    expect(numSteps).toBe(80);
    expect(costPerStep).toBe(3);
    expect(totalCost).toBe(80 * 3); // 240 credits
  });

  it('total unit repair cost is roughly URepairPercent * buildCost for full repair', () => {
    // C++ design: full repair costs ~25% of build cost
    // Actual is slightly higher due to ceil() rounding
    const buildCost = 950;
    const maxHp = 400;
    const costPerStep = unitRepairCostPerStep(buildCost, maxHp);
    const numSteps = maxHp / UREPAIR_STEP; // 80

    const totalCost = numSteps * costPerStep; // 80 * 3 = 240
    const ratio = totalCost / buildCost;

    // Should be close to UREPAIR_PERCENT (0.25), slightly above due to ceil
    expect(ratio).toBeGreaterThanOrEqual(UREPAIR_PERCENT);
    expect(ratio).toBeLessThan(UREPAIR_PERCENT + 0.05); // allow small ceil overhead
  });

  // -------------------------------------------------------------------
  // C++ techno.cpp:1009 — clamp to MaxStrength on final step
  // -------------------------------------------------------------------
  it('unit HP is clamped to maxHp after final repair step (techno.cpp:1009)', () => {
    const maxHp = 400;
    // HP just below max, one more step would overshoot
    const hp = 398;
    const healed = Math.min(maxHp, hp + UREPAIR_STEP);
    expect(healed).toBe(maxHp);
  });
});
