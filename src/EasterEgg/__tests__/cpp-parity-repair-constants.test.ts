/**
 * C++ parity tests — RepairStep and RepairPercent constants.
 *
 * C++ source of truth:
 *   rules.cpp:228  RepairStep  = 5
 *   rules.cpp:229  RepairPercent = fixed(1, 4) = 0.25
 *
 * Formula (building.cpp / techno.cpp Repair logic):
 *   cost_per_step = ceil( (Raw_Cost / (MaxStrength / RepairStep)) * RepairPercent )
 *
 * Repair fires every ~14 ticks, healing RepairStep HP per pulse.
 */

import { describe, it, expect } from 'vitest';
import { REPAIR_STEP, REPAIR_PERCENT } from '../engine/types';
import { repairCostPerStep } from '../engine/repairSell';

describe('C++ parity: repair constants (rules.cpp:228-229)', () => {
  // -------------------------------------------------------------------
  // Constant value checks
  // -------------------------------------------------------------------
  it('REPAIR_STEP is 5 (rules.cpp:228 RepairStep = 5)', () => {
    expect(REPAIR_STEP).toBe(5);
  });

  it('REPAIR_PERCENT is 0.25 (rules.cpp:229 RepairPercent = fixed(1,4))', () => {
    expect(REPAIR_PERCENT).toBe(0.25);
  });

  // -------------------------------------------------------------------
  // Repair cost formula: ceil( buildCost * RepairPercent / (maxHp / RepairStep) )
  // -------------------------------------------------------------------
  it('repair cost per step matches C++ formula for a typical building', () => {
    // Example: Construction Yard — cost=5000, maxHp=400
    // stepsToFull = maxHp / RepairStep = 400 / 5 = 80
    // costPerStep = ceil(5000 * 0.25 / 80) = ceil(1250 / 80) = ceil(15.625) = 16
    const cost = repairCostPerStep(5000, 400);
    expect(cost).toBe(16);
  });

  it('repair cost per step for cheap building (Barracks cost=300, maxHp=400)', () => {
    // stepsToFull = 400 / 5 = 80
    // costPerStep = ceil(300 * 0.25 / 80) = ceil(75 / 80) = ceil(0.9375) = 1
    const cost = repairCostPerStep(300, 400);
    expect(cost).toBe(1);
  });

  it('repair cost per step for War Factory (cost=2000, maxHp=400)', () => {
    // stepsToFull = 400 / 5 = 80
    // costPerStep = ceil(2000 * 0.25 / 80) = ceil(500 / 80) = ceil(6.25) = 7
    const cost = repairCostPerStep(2000, 400);
    expect(cost).toBe(7);
  });

  // -------------------------------------------------------------------
  // HP per tick
  // -------------------------------------------------------------------
  it('heals 5 HP per repair tick (not 7)', () => {
    // Simulate one repair tick: hp += REPAIR_STEP
    const hp = 100;
    const maxHp = 400;
    const healed = Math.min(maxHp, hp + REPAIR_STEP);
    expect(healed - hp).toBe(5);
  });

  // -------------------------------------------------------------------
  // Total repair cost for a full repair
  // -------------------------------------------------------------------
  it('total repair cost from 1 HP to full for Construction Yard', () => {
    // maxHp=400, cost=5000
    // HP to heal: 399 (from 1 to 400)
    // Number of steps: ceil(399 / 5) = 80 steps
    // Cost per step: ceil(5000 * 0.25 / (400 / 5)) = 16
    // Total cost: 80 * 16 = 1280
    const buildCost = 5000;
    const maxHp = 400;
    const startHp = 1;
    const costPerStep = repairCostPerStep(buildCost, maxHp);

    let totalCost = 0;
    let hp = startHp;
    while (hp < maxHp) {
      totalCost += costPerStep;
      hp = Math.min(maxHp, hp + REPAIR_STEP);
    }

    const numSteps = Math.ceil((maxHp - startHp) / REPAIR_STEP);
    expect(numSteps).toBe(80);
    expect(costPerStep).toBe(16);
    expect(totalCost).toBe(80 * 16); // 1280 credits
  });

  it('total repair cost is roughly RepairPercent * buildCost for full repair', () => {
    // C++ design intent: full repair costs ~25% of build cost
    // Actual is slightly higher due to ceil() rounding
    const buildCost = 2000;
    const maxHp = 400;
    const costPerStep = repairCostPerStep(buildCost, maxHp);
    const numSteps = maxHp / REPAIR_STEP; // 80

    const totalCost = numSteps * costPerStep; // 80 * 7 = 560
    const ratio = totalCost / buildCost;

    // Should be close to REPAIR_PERCENT (0.25), slightly above due to ceil
    expect(ratio).toBeGreaterThanOrEqual(REPAIR_PERCENT);
    expect(ratio).toBeLessThan(REPAIR_PERCENT + 0.05); // allow small ceil overhead
  });
});
