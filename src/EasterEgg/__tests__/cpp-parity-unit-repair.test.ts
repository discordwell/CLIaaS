/**
 * C++ parity tests — URepairStep and URepairPercent constants for unit repair.
 *
 * C++ source of truth (constructor defaults, overridden by rules.ini at runtime):
 *   rules.cpp:230  URepairStep  = 5  (constructor default)
 *   rules.cpp:231  URepairPercent = fixed(1, 4) = 0.25  (constructor default)
 *
 * rules.ini runtime values (what the game actually uses):
 *   URepairStep  = 10
 *   URepairPercent = 20% → fixed-point raw = floor(0.20 * 256) = 51
 *
 * C++ techno.cpp:6139-6170:
 *   Repair_Cost() — if Is_Foot(): (Raw_Cost()/(MaxStrength/Rule.URepairStep)) * Rule.URepairPercent
 *   Repair_Step() — if Is_Foot(): Rule.URepairStep
 *
 * C++ techno.cpp:987-1016:
 *   Service Depot (FIX building) uses Techno_Type_Class()->Repair_Cost() and Repair_Step()
 *   which dispatches to URepairStep/URepairPercent for foot units.
 *
 * Bug fixed: TS was using building REPAIR_STEP/REPAIR_PERCENT for unit repair at Service Depot.
 *            C++ uses separate URepairStep/URepairPercent constants.
 */

import { describe, it, expect } from 'vitest';
import { REPAIR_STEP, REPAIR_PERCENT, UREPAIR_STEP, UREPAIR_PERCENT } from '../engine/types';
import { repairCostPerStep, unitRepairCostPerStep } from '../engine/repairSell';

describe('C++ parity: URepairStep/URepairPercent for unit repair (rules.ini runtime values)', () => {
  // -------------------------------------------------------------------
  // Constant value checks — rules.ini overrides C++ constructor defaults
  // -------------------------------------------------------------------
  it('UREPAIR_STEP is 10 (rules.ini URepairStep=10, C++ default=5)', () => {
    expect(UREPAIR_STEP).toBe(10);
  });

  it('UREPAIR_PERCENT is 0.20 (rules.ini URepairPercent=20%, C++ default=0.25)', () => {
    expect(UREPAIR_PERCENT).toBe(0.20);
  });

  // -------------------------------------------------------------------
  // Separate constants exist (the whole point of this issue)
  // -------------------------------------------------------------------
  it('unit repair constants are separate from building repair constants', () => {
    // Even though both use 20% now (from rules.ini), they must be distinct identifiers
    // so modding via rules.ini can set them independently (rules.cpp:494-496)
    expect(typeof UREPAIR_STEP).toBe('number');
    expect(typeof UREPAIR_PERCENT).toBe('number');
    expect(typeof REPAIR_STEP).toBe('number');
    expect(typeof REPAIR_PERCENT).toBe('number');
  });

  // -------------------------------------------------------------------
  // Unit repair cost formula: C++ integer division + 8.8 fixed-point
  //   stepsToFull = trunc(maxHp / URepairStep)
  //   costPerFullStep = trunc(buildCost / stepsToFull)
  //   result = trunc((51 * costPerFullStep + 128) / 256)
  // -------------------------------------------------------------------
  it('unitRepairCostPerStep matches C++ formula for Medium Tank (cost=800, maxHp=400)', () => {
    // stepsToFull = trunc(400 / 10) = 40
    // costPerFullStep = trunc(800 / 40) = 20
    // result = trunc((51 * 20 + 128) / 256) = trunc(1148 / 256) = 4
    const cost = unitRepairCostPerStep(800, 400);
    expect(cost).toBe(4);
  });

  it('unitRepairCostPerStep matches C++ formula for Heavy Tank (cost=950, maxHp=400)', () => {
    // stepsToFull = trunc(400 / 10) = 40
    // costPerFullStep = trunc(950 / 40) = 23
    // result = trunc((51 * 23 + 128) / 256) = trunc(1301 / 256) = 5
    const cost = unitRepairCostPerStep(950, 400);
    expect(cost).toBe(5);
  });

  it('unitRepairCostPerStep matches C++ fixed-point for MCV (cost=5000, maxHp=600)', () => {
    // stepsToFull = trunc(600 / 10) = 60
    // costPerFullStep = trunc(5000 / 60) = 83
    // result = trunc((51 * 83 + 128) / 256) = trunc(4361 / 256) = 17
    const cost = unitRepairCostPerStep(5000, 600);
    expect(cost).toBe(17);
  });

  it('unitRepairCostPerStep for cheap unit (cost=300, maxHp=200)', () => {
    // stepsToFull = trunc(200 / 10) = 20
    // costPerFullStep = trunc(300 / 20) = 15
    // result = trunc((51 * 15 + 128) / 256) = trunc(893 / 256) = 3
    const cost = unitRepairCostPerStep(300, 200);
    expect(cost).toBe(3);
  });

  // -------------------------------------------------------------------
  // unitRepairCostPerStep uses UREPAIR constants, not REPAIR constants
  // -------------------------------------------------------------------
  it('unitRepairCostPerStep uses UREPAIR_PERCENT and UREPAIR_STEP (not building constants)', () => {
    // Verify that unit and building functions produce different results
    // when the constants differ (step=10 vs step=7)
    const buildCost = 1200;
    const maxHp = 400;

    const unitCost = unitRepairCostPerStep(buildCost, maxHp);
    const bldgCost = repairCostPerStep(buildCost, maxHp);

    // Unit: stepsToFull = trunc(400/10) = 40, costPerFullStep = trunc(1200/40) = 30
    //       result = trunc((51*30+128)/256) = trunc(1658/256) = 6
    // Bldg: stepsToFull = trunc(400/7) = 57, costPerFullStep = trunc(1200/57) = 21
    //       result = trunc((51*21+128)/256) = trunc(1199/256) = 4
    expect(unitCost).toBe(6);
    expect(bldgCost).toBe(4);
    // They differ because UREPAIR_STEP (10) != REPAIR_STEP (7)
    expect(unitCost).not.toBe(bldgCost);
  });

  // -------------------------------------------------------------------
  // HP per tick at Service Depot
  // -------------------------------------------------------------------
  it('unit heals UREPAIR_STEP HP per Service Depot tick (techno.cpp:999)', () => {
    const hp = 150;
    const maxHp = 400;
    const healed = Math.min(maxHp, hp + UREPAIR_STEP);
    expect(healed - hp).toBe(10);
  });

  // -------------------------------------------------------------------
  // Full repair cost for a unit
  // -------------------------------------------------------------------
  it('total unit repair cost from 1 HP to full for Medium Tank', () => {
    // maxHp=400, cost=800
    // HP to heal: 399 (from 1 to 400)
    // Number of steps: ceil(399 / 10) = 40 steps
    // Cost per step: 4 (see above)
    // Total cost: 40 * 4 = 160
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
    expect(numSteps).toBe(40);
    expect(costPerStep).toBe(4);
    expect(totalCost).toBe(40 * 4); // 160 credits
  });

  it('total unit repair cost is roughly URepairPercent * buildCost for full repair', () => {
    // C++ design: full repair costs ~20% of build cost (rules.ini)
    // Actual is slightly different due to integer truncation
    const buildCost = 950;
    const maxHp = 400;
    const costPerStep = unitRepairCostPerStep(buildCost, maxHp);
    const numSteps = Math.floor(maxHp / UREPAIR_STEP); // 40

    const totalCost = numSteps * costPerStep; // 40 * 5 = 200
    const ratio = totalCost / buildCost;

    // Should be close to UREPAIR_PERCENT (0.20), slightly above due to truncation
    // 200/950 = 0.2105
    expect(ratio).toBeGreaterThanOrEqual(UREPAIR_PERCENT);
    expect(ratio).toBeLessThan(UREPAIR_PERCENT + 0.05); // allow small overhead
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
