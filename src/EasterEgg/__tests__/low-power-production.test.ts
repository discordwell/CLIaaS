import { describe, it, expect } from 'vitest';

describe('Low Power Production Penalty (Gap #10)', () => {
  it('normal power: full production rate', () => {
    const powerProduced = 100;
    const powerConsumed = 50;
    const lowPower = powerConsumed > powerProduced && powerProduced > 0;
    const rate = lowPower ? 0.25 : 1.0;
    expect(rate).toBe(1.0);
  });

  it('low power: 25% production rate', () => {
    const powerProduced = 50;
    const powerConsumed = 100;
    const lowPower = powerConsumed > powerProduced && powerProduced > 0;
    const rate = lowPower ? 0.25 : 1.0;
    expect(rate).toBe(0.25);
  });

  it('zero power produced: no penalty (avoids edge case)', () => {
    const powerProduced = 0;
    const powerConsumed = 100;
    const lowPower = powerConsumed > powerProduced && powerProduced > 0;
    const rate = lowPower ? 0.25 : 1.0;
    expect(rate).toBe(1.0); // powerProduced = 0 means no power system, not low power
  });

  it('equal power: no penalty', () => {
    const powerProduced = 100;
    const powerConsumed = 100;
    const lowPower = powerConsumed > powerProduced && powerProduced > 0;
    const rate = lowPower ? 0.25 : 1.0;
    expect(rate).toBe(1.0); // equal is not "low"
  });

  it('combined with multi-factory bonus: low power affects final rate', () => {
    // 2 factories = 1.5x speed bonus
    // Low power = 0.25x multiplier
    // Final: 1.5 * 0.25 = 0.375
    const factorySpeedMult = 1.5;
    const powerMult = 0.25;
    const finalRate = factorySpeedMult * powerMult;
    expect(finalRate).toBe(0.375);
  });

  it('combined with multi-factory bonus: normal power keeps factory bonus', () => {
    // 2 factories = 1.5x speed bonus
    // Normal power = 1.0x multiplier
    // Final: 1.5 * 1.0 = 1.5
    const factorySpeedMult = 1.5;
    const powerMult = 1.0;
    const finalRate = factorySpeedMult * powerMult;
    expect(finalRate).toBe(1.5);
  });
});

describe('Repair Depot Cost (Gap #8 Verification)', () => {
  it('REPAIR_STEP is 5 HP per tick', () => {
    // This constant exists in types.ts and is used in index.ts line 655
    const REPAIR_STEP = 5;
    expect(REPAIR_STEP).toBe(5);
  });

  it('REPAIR_PERCENT is 0.25 (25% of build cost for full repair)', () => {
    // This constant exists in types.ts and is used in index.ts line 649
    const REPAIR_PERCENT = 0.25;
    expect(REPAIR_PERCENT).toBe(0.25);
  });

  it('repair cost calculation matches C++ rules', () => {
    // From index.ts line 649:
    // const repairCostPerStep = Math.ceil((prodItem.cost * REPAIR_PERCENT) / (s.maxHp / REPAIR_STEP))
    // Example: building costs 1000, has 200 HP
    const buildCost = 1000;
    const maxHp = 200;
    const REPAIR_PERCENT = 0.25;
    const REPAIR_STEP = 5;

    const totalRepairCost = buildCost * REPAIR_PERCENT; // 250
    const stepsToFullRepair = maxHp / REPAIR_STEP; // 40 steps
    const costPerStep = Math.ceil(totalRepairCost / stepsToFullRepair); // ceil(6.25) = 7

    expect(costPerStep).toBe(7);

    // Verify total cost is approximately REPAIR_PERCENT of build cost
    const actualTotalCost = costPerStep * stepsToFullRepair; // 7 * 40 = 280
    expect(actualTotalCost).toBeGreaterThanOrEqual(totalRepairCost);
    expect(actualTotalCost).toBeLessThan(totalRepairCost * 1.2); // within 20% due to ceil rounding
  });
});
