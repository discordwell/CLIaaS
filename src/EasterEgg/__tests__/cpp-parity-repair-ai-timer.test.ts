/**
 * C++ parity — BuildingClass::Repair_AI RepairTimer Random_Pick formula
 *
 * C++ source: building.cpp:5514
 *   House->RepairTimer = Random_Pick(
 *     (int)(House->RepairDelay * (TICKS_PER_MINUTE/4)),
 *     (int)(House->RepairDelay * TICKS_PER_MINUTE * 2)
 *   );
 *
 * Subtlety: C++ `*` is left-to-right associative, so the hi bound is
 *   `(RepairDelay * TICKS_PER_MINUTE) * 2` = (fixed*int returns int) * 2,
 * NOT the mathematically-equivalent `RepairDelay * 1800`. The intermediate
 * fixed*int truncates/rounds before the ×2, which for the default
 * RepairDelay=.02 (raw=5, TICKS_PER_MINUTE=900) yields:
 *   intermediate = (5*900 + 128) / 256 = 4628 / 256 = 18
 *   hi           = 18 * 2 = 36   (NOT 35 from the short formula)
 *   lo           = (5*225 + 128) / 256 = 1253 / 256 = 4
 *   Random_Pick(4, 36). magnitude = 32.
 *
 * The mag=32 distinction matters because Random_Pick's rejection-sampling loop
 * uses a mask based on the next-higher power-of-two. mag=31 → mask=31 (no
 * rejection possible — pick&31 is always ≤31); mag=32 → mask=63 (pick&63 can
 * be >32, triggering rejection). WASM was observed consuming 4 raw RNGs on
 * SCG06EA tick 13 for this exact Random_Pick — reachable only when magnitude
 * is in [32, 55] with mask=63. Matching C++'s intermediate-truncation behavior
 * is required for RNG parity.
 */

import { describe, it, expect } from 'vitest';

function fixedMulInt(raw: number, rvalue: number): number {
  // C++ fixed.h:109 — (((unsigned)Data.Raw * rvalue) + 128) / 256
  return Math.floor((raw * rvalue + 128) / 256);
}

function repairAIBounds(rawDelay: number): { lo: number; hi: number; magnitude: number } {
  const TICKS_PER_MINUTE = 900;
  const lo = fixedMulInt(rawDelay, TICKS_PER_MINUTE / 4); // 225
  const hiInner = fixedMulInt(rawDelay, TICKS_PER_MINUTE);
  const hi = hiInner * 2;
  return { lo, hi, magnitude: hi - lo };
}

describe('BuildingClass::Repair_AI RepairTimer Random_Pick (building.cpp:5514)', () => {
  it('Normal difficulty (RepairDelay=.02, raw=5) yields Random_Pick(4, 36) magnitude=32', () => {
    const { lo, hi, magnitude } = repairAIBounds(5);
    expect(lo).toBe(4);
    expect(hi).toBe(36); // NOT 35 — intermediate truncation matters
    expect(magnitude).toBe(32);
  });

  it('Easy handicap (RepairDelay=.001, raw=0) yields Random_Pick(0, 0)', () => {
    // rules.ini [Easy] RepairDelay=.001 → fixed(.001)=Composite.Fraction=(256*1)/1000=0
    const { lo, hi, magnitude } = repairAIBounds(0);
    expect(lo).toBe(0);
    expect(hi).toBe(0);
    expect(magnitude).toBe(0);
  });

  it('Difficult handicap (RepairDelay=.05, raw=12) yields Random_Pick(11, 84) magnitude=73', () => {
    // rules.ini [Difficult] RepairDelay=.05 → fixed(.05)=Composite.Fraction=(256*5)/100=12
    const { lo, hi, magnitude } = repairAIBounds(12);
    expect(lo).toBe(11); // (12*225+128)/256 = 2828/256 = 11
    expect(hi).toBe(84); // (12*900+128)/256 * 2 = 42 * 2 = 84
    expect(magnitude).toBe(73);
  });

  it('short-form formula (raw*1800+128)/256 gives WRONG magnitude for raw=5', () => {
    // Documenting the bug: the naive formulation used before the fix gave
    // hi=35 (magnitude=31), which is a POWER-OF-TWO-MINUS-ONE and therefore
    // never triggers rejection sampling. That caused TS to consume 1 raw RNG
    // where WASM consumed up to 4, breaking seed alignment. The correct
    // implementation preserves C++'s intermediate truncation.
    const rawDelay = 5;
    const naiveHi = Math.floor((rawDelay * 1800 + 128) / 256);
    expect(naiveHi).toBe(35); // wrong
    const correctHi = fixedMulInt(rawDelay, 900) * 2;
    expect(correctHi).toBe(36); // right
    expect(correctHi).not.toBe(naiveHi);
  });
});
