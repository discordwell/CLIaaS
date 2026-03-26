/**
 * RandomClass Parity Tests — C++ random.cpp (Joe L. Bostic, 02/27/1996)
 *
 * Verifies bit-identical output between TS RandomClass and C++ RandomClass.
 *
 * C++ algorithm:
 *   Seed = (Seed * 0x41C64E6D) + 0x00003039   (random.cpp:99)
 *   return (Seed >> 10) & 0x7FFF               (random.cpp:105)
 *
 * Ranged version uses rejection sampling with bitmask (random.cpp:128-182):
 *   1. magnitude = maxval - minval
 *   2. Find highest set bit in magnitude
 *   3. Build mask covering that bit range
 *   4. Loop: pick = next() & mask; retry if pick > magnitude
 *   5. Return pick + minval
 *
 * C++ reference: CnC_and_Red_Alert/RA/random.cpp
 * C++ header:    CnC_and_Red_Alert/RA/random.h
 */

import { describe, it, expect } from 'vitest';
import { RandomClass } from '../engine/random';

/**
 * Hand-computed C++ LCG sequence from seed=0.
 *
 * Step-by-step for seed=0:
 *   Seed = (0 * 0x41C64E6D + 0x3039) >>> 0 = 0x00003039 = 12345
 *   output = (12345 >> 10) & 0x7FFF = 12 & 0x7FFF = 12
 *
 *   Seed = (12345 * 0x41C64E6D + 0x3039) >>> 0
 *        = Math.imul(12345, 0x41C64E6D) + 0x3039
 *        = 0x41C64E6D * 12345 (mod 2^32) + 12345
 *   Let's compute: 12345 * 0x41C64E6D:
 *     12345 = 0x3039
 *     0x3039 * 0x41C64E6D (mod 2^32)
 *     = 0x0C6EF384C5D5 (mod 2^32) = 0xF384C5D5 ... then + 0x3039
 *     Actually let's just trust Math.imul and verify the sequence programmatically.
 *
 * We verify the sequence against a reference implementation that follows
 * the C++ exactly, using only primitive unsigned 32-bit operations.
 */

/** Reference implementation — follows C++ line by line */
function cppRandomNext(seed: number): [number, number] {
  // random.cpp:99 — Seed = (Seed * MULT_CONSTANT) + ADD_CONSTANT
  seed = (Math.imul(seed, 0x41C64E6D) + 0x00003039) >>> 0;
  // random.cpp:105 — return (Seed >> THROW_AWAY_BITS) & (~((~0) << SIGNIFICANT_BITS))
  // ~((~0) << 15) = 0x7FFF = 32767
  const value = (seed >>> 10) & 0x7FFF;
  return [value, seed];
}

describe('RandomClass — C++ parity (random.cpp)', () => {

  it('seed=0 produces the correct first 20 values', () => {
    // Generate reference sequence using C++ algorithm
    const expected: number[] = [];
    let refSeed = 0;
    for (let i = 0; i < 20; i++) {
      const [val, newSeed] = cppRandomNext(refSeed);
      expected.push(val);
      refSeed = newSeed;
    }

    // Generate from TS implementation
    const rng = new RandomClass(0);
    const actual: number[] = [];
    for (let i = 0; i < 20; i++) {
      actual.push(rng.next());
    }

    expect(actual).toEqual(expected);
  });

  it('seed=0 first value is 12 (hand-computed)', () => {
    // Seed = (0 * 0x41C64E6D + 0x3039) >>> 0 = 12345
    // (12345 >>> 10) & 0x7FFF = 12
    const rng = new RandomClass(0);
    expect(rng.next()).toBe(12);
  });

  it('various seeds produce correct first values', () => {
    // Test several seed values to verify the full multiplication path
    const seeds = [0, 1, 42, 255, 12345, 0xDEADBEEF, 0xFFFFFFFF];
    for (const seed of seeds) {
      const rng = new RandomClass(seed);
      const [expected] = cppRandomNext(seed);
      expect(rng.next()).toBe(expected);
    }
  });

  it('1000-value sequence matches C++ for seed=1', () => {
    const rng = new RandomClass(1);
    let refSeed = 1;
    for (let i = 0; i < 1000; i++) {
      const [expected, newSeed] = cppRandomNext(refSeed);
      refSeed = newSeed;
      expect(rng.next()).toBe(expected);
    }
  });

  it('output range is always 0–32767 (15-bit)', () => {
    const rng = new RandomClass(7);
    for (let i = 0; i < 10000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(32767);
    }
  });

  it('seed state matches C++ internal seed after each step', () => {
    const rng = new RandomClass(0);
    let refSeed = 0;
    for (let i = 0; i < 100; i++) {
      const [, newSeed] = cppRandomNext(refSeed);
      refSeed = newSeed;
      rng.next();
      expect(rng.seed).toBe(refSeed);
    }
  });

  it('constructor coerces seed to unsigned 32-bit', () => {
    const rng = new RandomClass(-1);
    expect(rng.seed).toBe(0xFFFFFFFF);

    const rng2 = new RandomClass(0x1_0000_0000); // 2^32 wraps to 0
    expect(rng2.seed).toBe(0);
  });
});

describe('RandomClass::nextInRange — C++ parity (random.cpp:128-182)', () => {

  it('minval == maxval returns minval without consuming RNG state', () => {
    // C++ random.cpp:140 — shortcut case
    const rng = new RandomClass(42);
    const seedBefore = rng.seed;
    expect(rng.nextInRange(5, 5)).toBe(5);
    expect(rng.seed).toBe(seedBefore); // no RNG consumed
  });

  it('swaps min/max when given in wrong order', () => {
    // C++ random.cpp:145-149
    const rng1 = new RandomClass(99);
    const rng2 = new RandomClass(99);
    expect(rng1.nextInRange(0, 10)).toBe(rng2.nextInRange(10, 0));
  });

  it('ranged output always falls within [min, max]', () => {
    const rng = new RandomClass(0);
    for (let i = 0; i < 10000; i++) {
      const v = rng.nextInRange(3, 17);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(17);
    }
  });

  it('ranged output matches C++ rejection sampling for seed=0, range 0-99', () => {
    /**
     * Reference implementation of C++ ranged random (random.cpp:128-182).
     * Uses the same rejection-sampling with bitmask approach.
     */
    function cppRangedRandom(
      seedRef: { seed: number },
      minval: number,
      maxval: number,
    ): number {
      if (minval === maxval) return minval;
      if (minval > maxval) { const t = minval; minval = maxval; maxval = t; }

      const magnitude = maxval - minval;
      let highbit = 14; // SIGNIFICANT_BITS - 1
      while ((magnitude & (1 << highbit)) === 0 && highbit > 0) {
        highbit--;
      }
      const mask = ~((~0) << (highbit + 1));

      let pick = magnitude + 1;
      while (pick > magnitude) {
        const [val, newSeed] = cppRandomNext(seedRef.seed);
        seedRef.seed = newSeed;
        pick = val & mask;
      }
      return pick + minval;
    }

    const rng = new RandomClass(0);
    const ref = { seed: 0 };

    for (let i = 0; i < 500; i++) {
      const expected = cppRangedRandom(ref, 0, 99);
      const actual = rng.nextInRange(0, 99);
      expect(actual).toBe(expected);
    }
    // Seeds must match after the same number of draws
    expect(rng.seed).toBe(ref.seed);
  });

  it('power-of-2 ranges never reject (optimal path)', () => {
    // For magnitude=127 (mask=0x7F), every masked value fits — no rejections.
    // This means nextInRange should consume exactly 1 call to next() per invocation.
    const rng = new RandomClass(0);
    const draws: number[] = [];
    for (let i = 0; i < 100; i++) {
      draws.push(rng.nextInRange(0, 127));
    }
    // Verify by checking seed matches 100 raw next() calls from same start
    const rng2 = new RandomClass(0);
    for (let i = 0; i < 100; i++) {
      rng2.next(); // consume exactly 1 per iteration
    }
    expect(rng.seed).toBe(rng2.seed);
  });

  it('distribution is uniform (chi-squared sanity check)', () => {
    const rng = new RandomClass(42);
    const bins = new Array(10).fill(0);
    const N = 100_000;
    for (let i = 0; i < N; i++) {
      bins[rng.nextInRange(0, 9)]++;
    }
    const expected = N / 10;
    // Chi-squared test with p < 0.001 threshold (critical value ~27.88 for df=9)
    let chiSq = 0;
    for (const count of bins) {
      chiSq += (count - expected) ** 2 / expected;
    }
    expect(chiSq).toBeLessThan(28);
  });
});
