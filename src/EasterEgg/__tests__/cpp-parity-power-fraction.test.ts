/**
 * C++ Parity Tests: Power Fraction Floor
 *
 * C++ source of truth:
 *   factory.cpp:434  — rate = time / Bound(House->Power_Fraction(), fixed(1,16), fixed(1))
 *   house.cpp:4160   — Power_Fraction() returns Power/Drain, 1 if Power>=Drain, 0 if Power==0
 *
 * The power fraction is clamped to [1/16, 1] = [0.0625, 1.0].
 * This means:
 *   - Full power:  fraction = 1.0  (normal production speed)
 *   - 50% power:   fraction = 0.5  (2x slower)
 *   - 25% power:   fraction = 0.25 (4x slower)
 *   - 10% power:   fraction = 0.1  (10x slower)
 *   - 6.25% power: fraction = 0.0625 (16x slower — the minimum)
 *   - 0% power:    clamped to 1/16 = 0.0625 (16x slower, avoids div-by-zero)
 *
 * Previous TS bug: floor was 0.5 (max 2x penalty). This made low power
 * nearly meaningless as a gameplay mechanic.
 */

import { describe, it, expect } from 'vitest';
import { powerMultiplier } from '../engine/repairSell';

// ---------------------------------------------------------------------------
// Direct powerMultiplier() tests — C++ house.cpp:4160 + factory.cpp:434
// ---------------------------------------------------------------------------

describe('C++ parity: Power_Fraction floor is 1/16 not 0.5', () => {
  describe('powerMultiplier() — mirrors Bound(Power_Fraction(), fixed(1,16), fixed(1))', () => {
    it('full power (drain <= produced): fraction = 1.0', () => {
      // C++ Power_Fraction: Power >= Drain → return 1
      expect(powerMultiplier(200, 100)).toBe(1.0);
      expect(powerMultiplier(100, 100)).toBe(1.0);
      expect(powerMultiplier(500, 0)).toBe(1.0);
    });

    it('no drain at all: fraction = 1.0', () => {
      // C++ Power_Fraction: Drain == 0 → return 1
      expect(powerMultiplier(0, 0)).toBe(1.0);
      expect(powerMultiplier(100, 0)).toBe(1.0);
    });

    it('50% power: fraction = 0.5 (2x slower)', () => {
      // C++ Power_Fraction: Power/Drain = 50/100 = 0.5
      // Bound(0.5, 1/16, 1) = 0.5
      expect(powerMultiplier(50, 100)).toBe(0.5);
    });

    it('75% power: fraction = 0.75', () => {
      expect(powerMultiplier(75, 100)).toBe(0.75);
    });

    it('25% power: fraction = 0.25 (4x slower)', () => {
      // C++ Power_Fraction: 25/100 = 0.25
      // Bound(0.25, 1/16, 1) = 0.25
      expect(powerMultiplier(25, 100)).toBe(0.25);
    });

    it('10% power: fraction = 0.1 (10x slower)', () => {
      // C++ Power_Fraction: 10/100 = 0.1
      // Bound(0.1, 1/16, 1) = 0.1
      expect(powerMultiplier(10, 100)).toBe(0.1);
    });

    it('6.25% power: fraction = 0.0625 (16x slower — the minimum)', () => {
      // C++ Power_Fraction: 1/16 = 0.0625
      // Bound(0.0625, 1/16, 1) = 0.0625
      expect(powerMultiplier(6.25, 100)).toBe(0.0625);
    });

    it('3% power: clamped to 1/16 = 0.0625', () => {
      // C++ Power_Fraction: 3/100 = 0.03
      // Bound(0.03, 1/16, 1) = 1/16 = 0.0625
      expect(powerMultiplier(3, 100)).toBe(1 / 16);
    });

    it('1% power: clamped to 1/16 = 0.0625', () => {
      // C++ Power_Fraction: 1/100 = 0.01
      // Bound(0.01, 1/16, 1) = 1/16
      expect(powerMultiplier(1, 100)).toBe(1 / 16);
    });

    it('0% power (produced=0, consumed>0): clamped to 1/16 = 0.0625', () => {
      // C++ Power_Fraction: Power==0 → return 0
      // Bound(0, 1/16, 1) = 1/16
      expect(powerMultiplier(0, 100)).toBe(1 / 16);
      expect(powerMultiplier(0, 500)).toBe(1 / 16);
      expect(powerMultiplier(0, 1)).toBe(1 / 16);
    });
  });

  // -------------------------------------------------------------------------
  // Production rate impact tests — verify the effective slowdown
  // -------------------------------------------------------------------------

  describe('production rate impact', () => {
    it('no power = 16x slower production, not 2x', () => {
      // At 0 power with non-zero drain:
      //   C++: rate = time / (1/16) = time * 16
      // The multiplier IS 1/16, so progress per tick is 1/16 of normal.
      // That means 16x slower.
      const normalMult = powerMultiplier(100, 100);
      const zeroPowerMult = powerMultiplier(0, 100);
      expect(normalMult / zeroPowerMult).toBe(16);
    });

    it('50% power = 2x slower production', () => {
      const normalMult = powerMultiplier(100, 100);
      const halfPowerMult = powerMultiplier(50, 100);
      expect(normalMult / halfPowerMult).toBe(2);
    });

    it('25% power = 4x slower production', () => {
      const normalMult = powerMultiplier(100, 100);
      const quarterPowerMult = powerMultiplier(25, 100);
      expect(normalMult / quarterPowerMult).toBe(4);
    });

    it('10% power = 10x slower production', () => {
      const normalMult = powerMultiplier(100, 100);
      const tenthPowerMult = powerMultiplier(10, 100);
      expect(normalMult / tenthPowerMult).toBe(10);
    });

    it('minimum penalty is always 16x (never infinity)', () => {
      // At any power level below 6.25%, the penalty is capped at 16x.
      // This prevents division-by-zero and ensures production never halts.
      const zeroPower = powerMultiplier(0, 100);
      const tinyPower = powerMultiplier(1, 100);
      const veryLow = powerMultiplier(3, 100);

      // All clamped to 1/16
      expect(zeroPower).toBe(1 / 16);
      expect(tinyPower).toBe(1 / 16);
      expect(veryLow).toBe(1 / 16);

      // The effective slowdown is always exactly 16x
      expect(1.0 / zeroPower).toBe(16);
      expect(1.0 / tinyPower).toBe(16);
      expect(1.0 / veryLow).toBe(16);
    });
  });

  // -------------------------------------------------------------------------
  // Sliding scale continuity tests
  // -------------------------------------------------------------------------

  describe('continuous sliding scale (not binary)', () => {
    it('power multiplier decreases continuously from 1.0 to 0.0625', () => {
      const fractions = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];
      const mults = fractions.map(f => powerMultiplier(f * 100, 100));

      // Each should be strictly less than or equal to the previous
      for (let i = 1; i < mults.length; i++) {
        expect(mults[i]).toBeLessThanOrEqual(mults[i - 1]);
      }

      // Values above 6.25% should be strictly decreasing
      for (let i = 1; i < mults.length - 1; i++) {
        expect(mults[i]).toBeLessThan(mults[i - 1]);
      }
    });

    it('all values between 6.25% and 100% are unclamped (exact fraction)', () => {
      // Verify that the multiplier equals the exact power fraction
      // when the fraction is above the 1/16 floor.
      const testCases = [
        { produced: 90, consumed: 100, expected: 0.9 },
        { produced: 80, consumed: 100, expected: 0.8 },
        { produced: 60, consumed: 100, expected: 0.6 },
        { produced: 40, consumed: 100, expected: 0.4 },
        { produced: 20, consumed: 100, expected: 0.2 },
        { produced: 7, consumed: 100, expected: 0.07 },
      ];
      for (const { produced, consumed, expected } of testCases) {
        const mult = powerMultiplier(produced, consumed);
        if (expected >= 1 / 16) {
          expect(mult).toBeCloseTo(expected, 6);
        } else {
          expect(mult).toBe(1 / 16);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('negative produced treated as zero power', () => {
      // Should not occur in practice, but defensive
      expect(powerMultiplier(-10, 100)).toBe(1 / 16);
    });

    it('very large drain with small production: clamped to 1/16', () => {
      expect(powerMultiplier(1, 10000)).toBe(1 / 16);
    });

    it('exactly 1/16 ratio is the boundary', () => {
      // 6.25 / 100 = 0.0625 = 1/16 exactly
      expect(powerMultiplier(6.25, 100)).toBe(1 / 16);
      // Just above 1/16
      expect(powerMultiplier(6.26, 100)).toBeGreaterThan(1 / 16);
      // Just below 1/16
      expect(powerMultiplier(6.24, 100)).toBe(1 / 16);
    });

    it('produced equals consumed minus 1: nearly full power', () => {
      expect(powerMultiplier(99, 100)).toBeCloseTo(0.99, 6);
    });
  });
});
