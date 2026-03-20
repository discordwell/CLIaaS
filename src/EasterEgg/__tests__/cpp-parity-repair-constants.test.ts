/**
 * C++ parity tests — RepairStep and RepairPercent constants.
 *
 * C++ source of truth (constructor defaults, overridden by rules.ini at runtime):
 *   rules.cpp:228  RepairStep  = 5  (constructor default)
 *   rules.cpp:229  RepairPercent = fixed(1, 4) = 0.25  (constructor default)
 *
 * rules.ini runtime values (what the game actually uses):
 *   RepairStep  = 7
 *   RepairPercent = 20% → fixed-point raw = floor(0.20 * 256) = 51
 *
 * Formula (building.cpp / techno.cpp Repair logic, C++ integer arithmetic):
 *   stepsToFull = trunc(maxHp / RepairStep)
 *   costPerFullStep = trunc(buildCost / stepsToFull)
 *   cost_per_step = trunc((raw * costPerFullStep + 128) / 256)
 *
 * Repair fires every ~14 ticks, healing RepairStep HP per pulse.
 */

import { describe, it, expect } from 'vitest';
import { REPAIR_STEP, REPAIR_PERCENT } from '../engine/types';
import { repairCostPerStep } from '../engine/repairSell';

describe('C++ parity: repair constants (rules.ini runtime values)', () => {
  // -------------------------------------------------------------------
  // Constant value checks — rules.ini overrides C++ constructor defaults
  // -------------------------------------------------------------------
  it('REPAIR_STEP is 7 (rules.ini RepairStep=7, C++ default=5)', () => {
    expect(REPAIR_STEP).toBe(7);
  });

  it('REPAIR_PERCENT is 0.20 (rules.ini RepairPercent=20%, C++ default=0.25)', () => {
    expect(REPAIR_PERCENT).toBe(0.20);
  });

  // -------------------------------------------------------------------
  // Repair cost formula: C++ integer division + 8.8 fixed-point multiply
  // stepsToFull = trunc(maxHp / 7)
  // costPerFullStep = trunc(buildCost / stepsToFull)
  // result = trunc((51 * costPerFullStep + 128) / 256)
  // -------------------------------------------------------------------
  it('repair cost per step matches C++ formula for a typical building', () => {
    // Example: Construction Yard — cost=5000, maxHp=400
    // stepsToFull = trunc(400 / 7) = 57
    // costPerFullStep = trunc(5000 / 57) = 87
    // result = trunc((51 * 87 + 128) / 256) = trunc(4565 / 256) = 17
    const cost = repairCostPerStep(5000, 400);
    expect(cost).toBe(17);
  });

  it('repair cost per step for cheap building (Barracks cost=300, maxHp=400)', () => {
    // stepsToFull = trunc(400 / 7) = 57
    // costPerFullStep = trunc(300 / 57) = 5
    // result = trunc((51 * 5 + 128) / 256) = trunc(383 / 256) = 1
    const cost = repairCostPerStep(300, 400);
    expect(cost).toBe(1);
  });

  it('repair cost per step for War Factory (cost=2000, maxHp=400)', () => {
    // stepsToFull = trunc(400 / 7) = 57
    // costPerFullStep = trunc(2000 / 57) = 35
    // result = trunc((51 * 35 + 128) / 256) = trunc(1913 / 256) = 7
    const cost = repairCostPerStep(2000, 400);
    expect(cost).toBe(7);
  });

  // -------------------------------------------------------------------
  // HP per tick
  // -------------------------------------------------------------------
  it('heals 7 HP per repair tick (rules.ini RepairStep=7)', () => {
    // Simulate one repair tick: hp += REPAIR_STEP
    const hp = 100;
    const maxHp = 400;
    const healed = Math.min(maxHp, hp + REPAIR_STEP);
    expect(healed - hp).toBe(7);
  });

  // -------------------------------------------------------------------
  // Total repair cost for a full repair
  // -------------------------------------------------------------------
  it('total repair cost from 1 HP to full for Construction Yard', () => {
    // maxHp=400, cost=5000
    // HP to heal: 399 (from 1 to 400)
    // Number of steps: ceil(399 / 7) = 57 steps
    // Cost per step: 17 (see above)
    // Total cost: 57 * 17 = 969
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
    expect(numSteps).toBe(57);
    expect(costPerStep).toBe(17);
    expect(totalCost).toBe(57 * 17); // 969 credits
  });

  it('total repair cost is roughly RepairPercent * buildCost for full repair', () => {
    // C++ design intent: full repair costs ~20% of build cost
    // Actual is slightly different due to integer truncation
    const buildCost = 2000;
    const maxHp = 400;
    const costPerStep = repairCostPerStep(buildCost, maxHp);
    const numSteps = Math.floor(maxHp / REPAIR_STEP); // 57

    const totalCost = numSteps * costPerStep; // 57 * 7 = 399
    const ratio = totalCost / buildCost;

    // With rules.ini values, ratio should be close to REPAIR_PERCENT (0.20)
    // 399/2000 = 0.1995
    expect(ratio).toBeGreaterThanOrEqual(REPAIR_PERCENT - 0.02);
    expect(ratio).toBeLessThanOrEqual(REPAIR_PERCENT + 0.02);
  });
});
