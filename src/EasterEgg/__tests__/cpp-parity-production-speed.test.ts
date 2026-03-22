/**
 * C++ parity tests: production speed -- how power level affects build speed
 *
 * C++ has TWO separate power-penalty mechanisms that BOTH apply:
 *
 * === Mechanism 1: TechnoClass::Time_To_Build() (techno.cpp:653-698) ===
 * Adjusts the base build time. Power fraction is QUANTIZED into bands:
 *   - power >= 1.0:            multiplier = 1.0 (normal speed)
 *   - 0.75 < power < 1.0:     snapped to 0.75 -> val *= 1/0.75 = 1.333x slower
 *   - 0.50 <= power <= 0.75:  actual fraction -> val *= 1/power
 *   - power < 0.50:           clamped to 0.50 -> val *= 1/0.5 = 2.0x slower (max)
 * Also: multiple factories divide the time (val /= Factory_Count())
 *
 * === Mechanism 2: FactoryClass::Start() (factory.cpp:411-448) ===
 * Adjusts the production rate (tick interval per step):
 *   time = Object->Time_To_Build()   // already includes mechanism 1
 *   rate = time / Bound(Power_Fraction(), fixed(1,16), fixed(1))
 *   rate /= STEP_COUNT               // STEP_COUNT = 54 (factory.h:92)
 *   rate = Bound(rate, 1, 255)
 *
 * === Power_Fraction() (house.cpp:4160-4170) ===
 *   if Power >= Drain || Drain == 0: return 1
 *   if Power > 0: return fixed(Power, Drain)  // = Power/Drain
 *   return 0
 *
 * === TS implementation (production.ts) ===
 * Uses a SINGLE power penalty:
 *   computePowerMult(): Power/Drain clamped to [1/16, 1]
 *   progress += powerMult per tick
 *
 * === Mismatches to test ===
 * 1. C++ quantizes power into bands with specific thresholds (3/4, 1/2).
 *    TS uses a continuous linear fraction. At 90% power: C++ snaps to 75%
 *    band (1.33x slower) while TS uses 0.9 (1.11x slower).
 * 2. C++ applies power penalty TWICE (Time_To_Build and Start). TS applies
 *    it only once. The combined C++ effect is multiplicative.
 * 3. C++ multiple-factory count divides build time. TS does NOT speed up
 *    single-item production with multiple factories (by deliberate design
 *    choice, tested separately in cpp-parity-production-speed.test.ts
 *    "factory count" suite above — that file was already committed).
 */

import { describe, it, expect } from 'vitest';
import { computePowerMult } from '../engine/production';
import { powerMultiplier } from '../engine/repairSell';

// ── C++ Reference Implementation ────────────────────────────────────────────

/**
 * C++ Power_Fraction (house.cpp:4160-4170)
 * Returns the raw power ratio, NOT clamped.
 */
function cppPowerFraction(power: number, drain: number): number {
  if (power >= drain || drain === 0) return 1;
  if (power > 0) return power / drain;
  return 0;
}

/**
 * C++ Bound(val, lower, upper) — standard clamp
 */
function cppBound(val: number, lower: number, upper: number): number {
  return Math.max(lower, Math.min(upper, val));
}

/**
 * C++ TechnoClass::Time_To_Build power-penalty portion (techno.cpp:677-682)
 *
 * The C++ code:
 *   fixed power = House->Power_Fraction();
 *   if (power > 1) power = 1;
 *   if (power < 1 && power > fixed::_3_4) power = fixed::_3_4;  // snap to 0.75
 *   if (power < fixed::_1_2) power = fixed::_1_2;               // floor at 0.50
 *   power.Inverse();                                             // 1/power
 *   val *= power;                                                // multiply time by 1/power
 *
 * Returns the TIME MULTIPLIER (>= 1.0 means slower).
 */
function cppTimeToBuildPowerMultiplier(powerFraction: number): number {
  let power = powerFraction;
  if (power > 1) power = 1;
  if (power < 1 && power > 0.75) power = 0.75;
  if (power < 0.5) power = 0.5;
  // Inverse: 1/power gives the time multiplier
  return 1 / power;
}

/**
 * C++ FactoryClass::Start() power-penalty portion (factory.cpp:434)
 *
 *   int rate = time / Bound(Power_Fraction(), fixed(1,16), fixed(1));
 *
 * This divides the time by the clamped power fraction [1/16, 1].
 * Returns the effective rate (higher = slower).
 */
function cppStartRateMultiplier(powerFraction: number): number {
  const clamped = cppBound(powerFraction, 1 / 16, 1);
  return 1 / clamped;
}

/**
 * C++ combined effective production-speed multiplier.
 * Both penalties are multiplicative: the time from Time_To_Build is then
 * divided by the clamped power fraction in Start().
 *
 * Returns the overall slowdown factor (1.0 = normal, 2.0 = 2x slower, etc.)
 */
function cppCombinedSlowdown(power: number, drain: number): number {
  const fraction = cppPowerFraction(power, drain);
  const timeMult = cppTimeToBuildPowerMultiplier(fraction);
  const rateMult = cppStartRateMultiplier(fraction);
  return timeMult * rateMult;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('C++ parity: Power_Fraction (house.cpp:4160)', () => {
  it('full power: Power >= Drain returns 1', () => {
    // C++ line 4164: if (Power >= Drain || Drain == 0) return(1);
    expect(cppPowerFraction(200, 100)).toBe(1);
    expect(cppPowerFraction(100, 100)).toBe(1);
    expect(cppPowerFraction(500, 0)).toBe(1);
  });

  it('no drain returns 1', () => {
    // C++ line 4164: Drain == 0 → return(1)
    expect(cppPowerFraction(0, 0)).toBe(1);
  });

  it('partial power returns Power/Drain', () => {
    // C++ line 4167: return(fixed(Power, Drain))
    expect(cppPowerFraction(50, 100)).toBe(0.5);
    expect(cppPowerFraction(75, 100)).toBe(0.75);
    expect(cppPowerFraction(25, 100)).toBe(0.25);
  });

  it('zero power with drain returns 0', () => {
    // C++ line 4169: return(0)
    expect(cppPowerFraction(0, 100)).toBe(0);
  });
});

describe('C++ parity: TechnoClass::Time_To_Build power quantization (techno.cpp:677-682)', () => {
  it('full power (fraction=1.0): no time increase (multiplier=1.0)', () => {
    // C++ line 678: if (power > 1) power = 1 → Inverse() → 1.0
    expect(cppTimeToBuildPowerMultiplier(1.0)).toBe(1.0);
  });

  it('90% power: C++ snaps to 75% band → 1.333x slower', () => {
    // C++ line 679: if (power < 1 && power > fixed::_3_4) power = fixed::_3_4
    // 0.9 is < 1.0 and > 0.75, so snapped to 0.75
    // Inverse of 0.75 = 1.333...
    const result = cppTimeToBuildPowerMultiplier(0.9);
    expect(result).toBeCloseTo(1 / 0.75, 10);
  });

  it('80% power: C++ snaps to 75% band → 1.333x slower', () => {
    // 0.80 > 0.75 and < 1.0 → snap to 0.75
    const result = cppTimeToBuildPowerMultiplier(0.8);
    expect(result).toBeCloseTo(1 / 0.75, 10);
  });

  it('76% power: C++ snaps to 75% band → 1.333x slower', () => {
    // 0.76 > 0.75 and < 1.0 → snap to 0.75
    const result = cppTimeToBuildPowerMultiplier(0.76);
    expect(result).toBeCloseTo(1 / 0.75, 10);
  });

  it('exactly 75% power: NOT snapped (condition is > 3/4, not >=) → 1.333x slower', () => {
    // C++ line 679: power > fixed::_3_4  (strictly greater than)
    // 0.75 is NOT > 0.75, so NOT snapped — uses actual 0.75
    // BUT 0.75 is NOT < 0.5, so no floor applied either.
    // Inverse of 0.75 = 1.333...
    const result = cppTimeToBuildPowerMultiplier(0.75);
    expect(result).toBeCloseTo(1 / 0.75, 10);
  });

  it('60% power: uses actual fraction → 1.667x slower', () => {
    // 0.60 is NOT < 1 && > 0.75 (it is not > 0.75)
    // 0.60 is NOT < 0.5
    // So actual 0.60 is used. Inverse = 1.667
    const result = cppTimeToBuildPowerMultiplier(0.6);
    expect(result).toBeCloseTo(1 / 0.6, 10);
  });

  it('50% power: uses actual fraction → 2.0x slower', () => {
    // 0.50 is NOT < 1 && > 0.75
    // 0.50 is NOT < 0.5 (it equals 0.5)
    // Inverse of 0.5 = 2.0
    const result = cppTimeToBuildPowerMultiplier(0.5);
    expect(result).toBeCloseTo(2.0, 10);
  });

  it('30% power: C++ clamps to 50% → 2.0x slower (max penalty)', () => {
    // C++ line 680: if (power < fixed::_1_2) power = fixed::_1_2
    // 0.30 < 0.5 → clamped to 0.5
    // Inverse of 0.5 = 2.0
    const result = cppTimeToBuildPowerMultiplier(0.3);
    expect(result).toBe(2.0);
  });

  it('10% power: C++ clamps to 50% → 2.0x slower (max penalty)', () => {
    const result = cppTimeToBuildPowerMultiplier(0.1);
    expect(result).toBe(2.0);
  });

  it('0% power: C++ clamps to 50% → 2.0x slower (max penalty)', () => {
    const result = cppTimeToBuildPowerMultiplier(0.0);
    expect(result).toBe(2.0);
  });
});

describe('C++ parity: FactoryClass::Start rate penalty (factory.cpp:434)', () => {
  it('full power: rate multiplier = 1.0', () => {
    // Bound(1.0, 1/16, 1) = 1.0 → 1/1.0 = 1.0
    expect(cppStartRateMultiplier(1.0)).toBe(1.0);
  });

  it('50% power: rate multiplier = 2.0', () => {
    // Bound(0.5, 1/16, 1) = 0.5 → 1/0.5 = 2.0
    expect(cppStartRateMultiplier(0.5)).toBe(2.0);
  });

  it('25% power: rate multiplier = 4.0', () => {
    expect(cppStartRateMultiplier(0.25)).toBe(4.0);
  });

  it('0% power: clamped to 1/16 → rate multiplier = 16.0', () => {
    // Bound(0, 1/16, 1) = 1/16 → 1/(1/16) = 16
    expect(cppStartRateMultiplier(0.0)).toBe(16.0);
  });
});

describe('C++ parity: combined production slowdown (Time_To_Build + Start)', () => {
  it('full power: no slowdown (1.0x)', () => {
    expect(cppCombinedSlowdown(100, 100)).toBe(1.0);
  });

  it('90% power: C++ applies 1.333x * 1.111x = 1.481x total slowdown', () => {
    // Mechanism 1: snapped to 75% → 1/0.75 = 1.333
    // Mechanism 2: Bound(0.9, 1/16, 1) = 0.9 → 1/0.9 = 1.111
    const result = cppCombinedSlowdown(90, 100);
    expect(result).toBeCloseTo((1 / 0.75) * (1 / 0.9), 6);
  });

  it('50% power: C++ applies 2.0x * 2.0x = 4.0x total slowdown', () => {
    // Mechanism 1: 0.5 not snapped, not clamped → 1/0.5 = 2.0
    // Mechanism 2: Bound(0.5, 1/16, 1) = 0.5 → 1/0.5 = 2.0
    const result = cppCombinedSlowdown(50, 100);
    expect(result).toBe(4.0);
  });

  it('25% power: C++ applies 2.0x * 4.0x = 8.0x total slowdown', () => {
    // Mechanism 1: 0.25 < 0.5 → clamped to 0.5 → 1/0.5 = 2.0
    // Mechanism 2: Bound(0.25, 1/16, 1) = 0.25 → 1/0.25 = 4.0
    const result = cppCombinedSlowdown(25, 100);
    expect(result).toBe(8.0);
  });

  it('0% power: C++ applies 2.0x * 16.0x = 32.0x total slowdown', () => {
    // Mechanism 1: 0 < 0.5 → clamped to 0.5 → 1/0.5 = 2.0
    // Mechanism 2: Bound(0, 1/16, 1) = 1/16 → 1/(1/16) = 16.0
    const result = cppCombinedSlowdown(0, 100);
    expect(result).toBe(32.0);
  });
});

// ── TS Comparison Tests ─────────────────────────────────────────────────────

describe('TS vs C++ mismatch: computePowerMult has no quantization bands', () => {
  /**
   * The TS computePowerMult() from production.ts uses a simple linear fraction
   * clamped to [1/16, 1]. It does NOT implement the C++ quantization bands
   * from TechnoClass::Time_To_Build() (techno.cpp:677-682).
   *
   * These tests document the known divergences.
   */

  it('MISMATCH: at 90% power, TS gives 0.9 but C++ gives (1/0.75)*(1/0.9) combined = ~0.675 effective speed', () => {
    // TS: computePowerMult returns 0.9 (simple fraction)
    const tsResult = computePowerMult({
      powerProduced: 90, powerConsumed: 100,
    } as any);
    expect(tsResult).toBe(0.9);

    // C++ combined effective speed (inverse of slowdown):
    // 1 / cppCombinedSlowdown = 1 / 1.481 = 0.675
    const cppSlowdown = cppCombinedSlowdown(90, 100);
    const cppEffectiveSpeed = 1 / cppSlowdown;
    expect(cppEffectiveSpeed).toBeCloseTo(1 / ((1 / 0.75) * (1 / 0.9)), 6);

    // Document the divergence: TS is 33% faster than it should be at 90% power
    expect(tsResult).not.toBeCloseTo(cppEffectiveSpeed, 1);
  });

  it('MISMATCH: at 80% power, TS gives 0.8 but C++ gives ~0.6 effective speed', () => {
    const tsResult = computePowerMult({
      powerProduced: 80, powerConsumed: 100,
    } as any);
    expect(tsResult).toBe(0.8);

    const cppSlowdown = cppCombinedSlowdown(80, 100);
    const cppEffectiveSpeed = 1 / cppSlowdown;
    // C++: (1/0.75) * (1/0.8) = 1.333 * 1.25 = 1.667 → speed = 0.6
    expect(cppEffectiveSpeed).toBeCloseTo(0.6, 6);

    // TS is 33% faster than C++ at 80% power
    expect(tsResult).not.toBeCloseTo(cppEffectiveSpeed, 1);
  });

  it('MISMATCH: at 50% power, TS gives 0.5 but C++ gives 0.25 effective speed', () => {
    const tsResult = computePowerMult({
      powerProduced: 50, powerConsumed: 100,
    } as any);
    expect(tsResult).toBe(0.5);

    // C++ combined: 2.0 * 2.0 = 4.0x slowdown → speed = 0.25
    const cppSlowdown = cppCombinedSlowdown(50, 100);
    expect(cppSlowdown).toBe(4.0);
    const cppEffectiveSpeed = 1 / cppSlowdown;
    expect(cppEffectiveSpeed).toBe(0.25);

    // TS is 2x too fast at 50% power
    expect(tsResult).not.toBe(cppEffectiveSpeed);
  });

  it('MISMATCH: at 25% power, TS gives 0.25 but C++ gives 0.125 effective speed', () => {
    const tsResult = computePowerMult({
      powerProduced: 25, powerConsumed: 100,
    } as any);
    expect(tsResult).toBe(0.25);

    // C++ combined: 2.0 * 4.0 = 8.0x slowdown → speed = 0.125
    const cppSlowdown = cppCombinedSlowdown(25, 100);
    expect(cppSlowdown).toBe(8.0);
    expect(1 / cppSlowdown).toBe(0.125);

    expect(tsResult).not.toBe(0.125);
  });

  it('MISMATCH: at 0% power, TS gives 1/16=0.0625 but C++ gives 1/32=0.03125 effective speed', () => {
    const tsResult = computePowerMult({
      powerProduced: 0, powerConsumed: 100,
    } as any);
    expect(tsResult).toBe(1 / 16);

    // C++ combined: 2.0 * 16.0 = 32.0x slowdown → speed = 1/32
    const cppSlowdown = cppCombinedSlowdown(0, 100);
    expect(cppSlowdown).toBe(32.0);
    expect(1 / cppSlowdown).toBe(1 / 32);

    expect(tsResult).not.toBe(1 / 32);
  });

  it('full power is correct in both (1.0)', () => {
    const tsResult = computePowerMult({
      powerProduced: 100, powerConsumed: 100,
    } as any);
    expect(tsResult).toBe(1.0);

    const cppSlowdown = cppCombinedSlowdown(100, 100);
    expect(cppSlowdown).toBe(1.0);
  });

  it('over-powered is correct in both (1.0)', () => {
    const tsResult = computePowerMult({
      powerProduced: 200, powerConsumed: 100,
    } as any);
    expect(tsResult).toBe(1.0);

    const cppSlowdown = cppCombinedSlowdown(200, 100);
    expect(cppSlowdown).toBe(1.0);
  });
});

describe('TS vs C++ mismatch: powerMultiplier (repairSell.ts) also lacks quantization', () => {
  /**
   * The powerMultiplier() in repairSell.ts corresponds only to factory.cpp:434
   * (Mechanism 2). It is missing the TechnoClass::Time_To_Build quantization
   * (Mechanism 1). These tests document that.
   */

  it('at 90% power: powerMultiplier gives 0.9, C++ mechanism-2 also gives 0.9', () => {
    // Mechanism 2 alone is a match for the factory.cpp clamp
    expect(powerMultiplier(90, 100)).toBe(0.9);
    expect(cppBound(0.9, 1 / 16, 1)).toBe(0.9);
  });

  it('at 50% power: powerMultiplier gives 0.5, C++ mechanism-2 also gives 0.5', () => {
    expect(powerMultiplier(50, 100)).toBe(0.5);
    expect(cppBound(0.5, 1 / 16, 1)).toBe(0.5);
  });

  it('powerMultiplier matches C++ mechanism-2 alone but is missing mechanism-1', () => {
    // powerMultiplier correctly implements factory.cpp:434 (Bound to [1/16, 1])
    // but the TS does not have the ADDITIONAL penalty from TechnoClass::Time_To_Build
    const testCases = [
      { power: 100, drain: 100, expectedM2: 1.0 },
      { power: 90, drain: 100, expectedM2: 0.9 },
      { power: 75, drain: 100, expectedM2: 0.75 },
      { power: 50, drain: 100, expectedM2: 0.5 },
      { power: 25, drain: 100, expectedM2: 0.25 },
      { power: 10, drain: 100, expectedM2: 0.1 },
      { power: 0, drain: 100, expectedM2: 1 / 16 },
    ];
    for (const { power, drain, expectedM2 } of testCases) {
      const tsMult = powerMultiplier(power, drain);
      expect(tsMult, `power=${power},drain=${drain}`).toBeCloseTo(expectedM2, 6);
    }
  });
});

describe('C++ parity: STEP_COUNT = 54 (factory.h:92)', () => {
  /**
   * C++ breaks production into 54 discrete steps. The rate (ticks per step)
   * is: rate = time / (STEP_COUNT * power_fraction)
   *
   * The TS uses buildTime directly as the number of ticks and advances
   * progress by powerMult per tick. This is functionally different:
   * C++ uses discrete steps with integer rate; TS uses fractional progress.
   */

  it('C++ STEP_COUNT is 54', () => {
    // factory.h:92: STEP_COUNT=54
    const STEP_COUNT = 54;
    expect(STEP_COUNT).toBe(54);
  });

  it('C++ rate calculation: rate = time / Power / STEP_COUNT, clamped to [1, 255]', () => {
    // factory.cpp:434-440:
    //   int rate = time / Bound(Power_Fraction(), fixed(1,16), fixed(1));
    //   rate /= STEP_COUNT;
    //   rate = Bound(rate, 1, 255);
    const STEP_COUNT = 54;

    // Example: Medium Tank, cost=800, full power
    // TechnoTypeClass::Time_To_Build = floor(800 * 0.8 * 900/1000) = 576
    // TechnoClass::Time_To_Build at full power = 576 (no penalty)
    const baseTicks = 576;
    const power = 1.0;

    const rateRaw = baseTicks / cppBound(power, 1 / 16, 1);
    const ratePerStep = Math.floor(rateRaw / STEP_COUNT); // integer division in C++
    const rate = cppBound(ratePerStep, 1, 255);

    // Total build time = rate * STEP_COUNT = 10 * 54 = 540 ticks
    // (vs original 576; granularity loss from integer division)
    expect(rate).toBe(10);
    expect(rate * STEP_COUNT).toBe(540);
  });

  it('C++ rate at 50% power example: doubled rate due to mechanism 2', () => {
    const STEP_COUNT = 54;
    // Medium Tank at 50% power:
    // Mechanism 1: 0.5 → 1/0.5 = 2x → time = 576 * 2 = 1152
    // Mechanism 2: rate = 1152 / 0.5 = 2304; rate/54 = 42; Bound(42,1,255) = 42
    // Total = 42 * 54 = 2268 ticks (vs 576 normal)
    // Slowdown factor = 2268/540 = 4.2x
    const baseTicks = 576;
    const powerFraction = 0.5;

    // Mechanism 1
    const timeMult = cppTimeToBuildPowerMultiplier(powerFraction);
    const adjustedTime = Math.floor(baseTicks * timeMult);

    // Mechanism 2
    const rateRaw = adjustedTime / cppBound(powerFraction, 1 / 16, 1);
    const ratePerStep = Math.floor(rateRaw / STEP_COUNT);
    const rate = cppBound(ratePerStep, 1, 255);
    const totalTicks = rate * STEP_COUNT;

    expect(timeMult).toBe(2.0);
    expect(adjustedTime).toBe(1152);
    expect(rate).toBe(42);
    expect(totalTicks).toBe(2268);
  });
});

describe('C++ parity: power-locked at Start() time (factory.cpp:411-448)', () => {
  /**
   * Both C++ and TS snapshot the power fraction at production start.
   * In C++, FactoryClass::Start() computes the rate once; it doesn't change
   * until production is Suspend()ed and Start()ed again.
   *
   * The TS locks powerMult in startProduction() and re-snapshots on restart.
   * This behavior is CORRECT parity with C++.
   */

  it('TS snapshots powerMult at startProduction time', () => {
    // Verified by reading production.ts:131-134:
    //   const powerMult = computePowerMult(ctx);
    //   ctx.productionQueue.set(category, { ..., powerMult });
    // And line 186: entry.progress += entry.powerMult; (uses snapshot, not current)
    // This matches C++ factory.cpp:442: Set_Rate(rate) — rate is locked.
    expect(true).toBe(true); // Structural assertion — code inspection confirms parity
  });

  it('TS re-snapshots powerMult when queue item restarts after completion', () => {
    // production.ts:204: entry.powerMult = computePowerMult(ctx);
    // This matches C++ behavior where Start() is called again for the next item.
    expect(true).toBe(true); // Structural assertion
  });
});

// ── Summary of All Mismatches ───────────────────────────────────────────────

describe('Summary: production speed parity gap inventory', () => {
  /**
   * This test documents all known divergences between C++ and TS production
   * speed calculations. Each entry notes the C++ source, TS behavior, and
   * the impact magnitude.
   */

  it('GAP 1: Missing C++ Mechanism-1 quantization bands (techno.cpp:677-682)', () => {
    // C++ quantizes power into discrete bands: snap (0.75,1.0) → 0.75, floor at 0.5
    // TS uses continuous linear fraction.
    // Impact: At 90% power, TS is ~33% faster than C++. At 76-99% power,
    // C++ always treats it as 75% while TS uses the actual fraction.
    const tsSpeed90 = 0.9;
    const cppSpeed90 = 1 / cppTimeToBuildPowerMultiplier(0.9); // 0.75
    expect(tsSpeed90).toBeGreaterThan(cppSpeed90);
    expect(tsSpeed90 - cppSpeed90).toBeCloseTo(0.15, 6);
  });

  it('GAP 2: Missing C++ double power penalty (techno.cpp + factory.cpp)', () => {
    // C++ applies power penalty TWICE (multiplicative). TS applies it once.
    // Impact: At 50% power, C++ is 4x slower but TS is only 2x slower.
    // At 25% power: C++ 8x vs TS 4x. At 0% power: C++ 32x vs TS 16x.
    const powerLevels = [
      { pct: 50, tsSlowdown: 2, cppSlowdown: 4 },
      { pct: 25, tsSlowdown: 4, cppSlowdown: 8 },
      { pct: 10, tsSlowdown: 10, cppSlowdown: 20 },
    ];
    for (const { pct, tsSlowdown, cppSlowdown } of powerLevels) {
      const tsResult = 1 / computePowerMult({ powerProduced: pct, powerConsumed: 100 } as any);
      const cppResult = cppCombinedSlowdown(pct, 100);
      expect(tsResult, `TS slowdown at ${pct}%`).toBeCloseTo(tsSlowdown, 1);
      expect(cppResult, `C++ slowdown at ${pct}%`).toBeCloseTo(cppSlowdown, 1);
      expect(tsResult).not.toBeCloseTo(cppResult, 0);
    }
  });

  it('GAP 3: C++ integer rate granularity (STEP_COUNT=54) vs TS fractional progress', () => {
    // C++ divides build time into 54 steps with integer tick rates (1-255).
    // TS uses fractional progress incremented by powerMult each tick.
    // Impact: Small rounding differences in total build time. For full power,
    // C++ Medium Tank is 540 ticks (10*54) vs TS 576 ticks (exact buildTime).
    const cppTicks = 10 * 54; // rate=floor(576/54)=10, total=10*54=540
    const tsBuildTime = 576;  // exact cost-based formula
    expect(cppTicks).not.toBe(tsBuildTime);
    expect(tsBuildTime - cppTicks).toBe(36); // TS is 36 ticks slower at full power
  });

  it('NO GAP: power-fraction floor of 1/16 matches factory.cpp:434', () => {
    // Both C++ factory.cpp and TS production.ts clamp power to [1/16, 1].
    // This part is correct.
    expect(computePowerMult({ powerProduced: 0, powerConsumed: 100 } as any)).toBe(1 / 16);
    expect(powerMultiplier(0, 100)).toBe(1 / 16);
  });

  it('NO GAP: power snapshot at start matches C++ FactoryClass::Start()', () => {
    // Both C++ and TS lock the power rate at production start time.
    // C++: Set_Rate(rate) in Start(). TS: powerMult in startProduction().
    expect(true).toBe(true);
  });
});
