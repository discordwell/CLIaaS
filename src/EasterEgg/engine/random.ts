/**
 * RandomClass — bit-identical port of Red Alert 1's LCG random number generator.
 *
 * C++ source: CnC_and_Red_Alert/RA/random.cpp (Joe L. Bostic, 02/27/1996)
 *
 * Linear congruential generator producing 15-bit values (0–32767).
 * Uses unsigned 32-bit arithmetic via `>>> 0` to match C++ unsigned long overflow.
 */

const MULT_CONSTANT = 0x41C64E6D;
const ADD_CONSTANT = 0x00003039;
const THROW_AWAY_BITS = 10;
const SIGNIFICANT_BITS = 15;

export class RandomClass {
  seed: number;

  constructor(seed: number = 0) {
    this.seed = seed >>> 0; // force unsigned 32-bit
  }

  /**
   * Fetch the next random number in the sequence.
   * Returns 15-bit value: 0–32767.
   *
   * C++ ref: random.cpp:89-106
   */
  callCount = 0; // Debug: count total RNG calls for parity comparison
  debugLog: string[] = []; // First N gameplay calls for divergence debugging
  debugLogStart = 0; // callCount at which gameplay logging begins (set after init sync)

  next(): number {
    this.callCount++;
    this.seed = (Math.imul(this.seed, MULT_CONSTANT) + ADD_CONSTANT) >>> 0;
    // Log first 75 gameplay calls after init sync
    if (this.debugLogStart > 0 && this.callCount > this.debugLogStart && this.callCount <= this.debugLogStart + 75) {
      this.debugLog.push(`#${this.callCount}:${this.seed}`);
    }

    // Extract 15 significant bits, throwing away the low 10
    return (this.seed >>> THROW_AWAY_BITS) & ((1 << SIGNIFICANT_BITS) - 1);
  }

  /**
   * Ranged random number generator (inclusive on both ends).
   * Uses rejection sampling with a bitmask to avoid modulo bias.
   *
   * C++ ref: random.cpp:128-182
   */
  nextInRange(minval: number, maxval: number): number {
    if (minval === maxval) return minval;

    // Swap if out of order
    if (minval > maxval) {
      const temp = minval;
      minval = maxval;
      maxval = temp;
    }

    const magnitude = maxval - minval;

    // Find highest set bit within SIGNIFICANT_BITS range
    let highbit = SIGNIFICANT_BITS - 1;
    while ((magnitude & (1 << highbit)) === 0 && highbit > 0) {
      highbit--;
    }

    // Build mask that just covers the magnitude
    const mask = ~((~0) << (highbit + 1));

    // Rejection loop: draw until the value fits within magnitude
    let pick = magnitude + 1;
    while (pick > magnitude) {
      pick = this.next() & mask;
    }

    return pick + minval;
  }

  /**
   * Float in [0, 1) — drop-in replacement for Math.random().
   * 15-bit resolution (1/32768 granularity), which matches C++ gameplay precision.
   */
  float(): number {
    return this.next() / (1 << SIGNIFICANT_BITS);
  }
}

/**
 * Synced RNG — used for all gameplay-critical decisions.
 * Deterministic: same seed produces same sequence across all clients.
 * Must be saved/restored with game state for multiplayer sync.
 */
export const ScenarioRandom = new RandomClass();

/**
 * Non-critical RNG — used for cosmetic/visual effects that
 * don't need to stay in sync (particle offsets, sound variation, etc.)
 */
export const NonCriticalRandom = new RandomClass();
