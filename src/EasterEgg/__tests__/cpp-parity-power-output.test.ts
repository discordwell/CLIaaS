/**
 * C++ Behavioral Parity: Power Output Health Degradation
 *
 * C++ source of truth:
 *   building.cpp:4607-4616  Power_Output()
 *   fixed.h / fixed.cpp     fixed-point arithmetic (8.8 format)
 *
 * C++ algorithm:
 *   int BuildingClass::Power_Output(void) const {
 *     if (Class->Power) {
 *       return(Class->Power * fixed(LastStrength, Class->MaxStrength));
 *     }
 *     return(0);
 *   }
 *
 * Where:
 *   fixed(numerator, denominator):
 *     Data.Raw = (unsigned short)((unsigned)(numerator * 256) / (unsigned)denominator)
 *                                                              ^ INTEGER division (truncation)
 *
 *   int operator*(int rvalue) const:            (fixed.h:109)
 *     return ((((unsigned)Data.Raw * rvalue) + (256/2)) / 256)
 *                                              ^^^^^^^ +128 gives rounding
 *
 * So the full C++ formula is:
 *   1. fixed_raw = floor(Strength * 256 / MaxStrength)   — truncation
 *   2. result = floor((fixed_raw * Power + 128) / 256)   — rounded int
 *
 * The TS implementation (repairSell.ts fixedPowerOutput) reproduces the
 * exact C++ 8.8 fixed-point algorithm:
 *   1. fixedRaw = Math.floor((hp * 256) / maxHp)   — truncating integer division
 *   2. result = Math.floor((fixedRaw * ratedPower + 128) / 256)  — rounded int
 *
 * This test verifies EXACT parity between the TS implementation and C++
 * at all HP values, including edge cases where naive floating-point
 * (e.g. Math.round(Power * hp / maxHp)) would diverge.
 *
 * C++ reference: CnC_and_Red_Alert/RA/building.cpp:4607-4616
 * C++ reference: CnC_and_Red_Alert/RA/fixed.h:59-66, 109
 */

import { describe, it, expect } from 'vitest';
import { powerOutput, calculatePowerGrid } from '../engine/repairSell';
import { buildDefaultAlliances, House } from '../engine/types';
import type { MapStructure } from '../engine/scenario';

// ---------------------------------------------------------------------------
// C++ reference implementation — reproduces fixed(n,d) * Power exactly
// ---------------------------------------------------------------------------

/** Reproduces C++ Power_Output using fixed-point 8.8 arithmetic.
 *  fixed.cpp:59-66 + fixed.h:109 */
function cppPowerOutput(ratedPower: number, strength: number, maxStrength: number): number {
  if (maxStrength === 0 || ratedPower === 0) return 0;
  // Step 1: fixed(Strength, MaxStrength) — truncating integer division
  const fixedRaw = Math.floor((strength * 256) / maxStrength);
  // Step 2: int operator*(int rvalue) — rounds via +128
  return Math.floor((fixedRaw * ratedPower + 128) / 256);
}

// ---------------------------------------------------------------------------
// Helper to build MapStructure for calculatePowerGrid tests
// ---------------------------------------------------------------------------

function makeStruct(
  type: string, cx: number, cy: number, hp: number, maxHp: number,
  house: House = House.Spain,
): MapStructure {
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp, maxHp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

// ============================================================
// Section 1: C++ fixed-point algorithm verification
//
// Establish that we correctly model the C++ algorithm before
// testing the TS implementation against it.
// ============================================================

describe('C++ fixed-point algorithm verification (building.cpp:4613, fixed.h:109)', () => {

  it('fixed(200, 400) * 100 = 50 — clean 50% ratio', () => {
    // fixed_raw = floor(200 * 256 / 400) = floor(128) = 128
    // result = floor((128 * 100 + 128) / 256) = floor(50.5) = 50
    expect(cppPowerOutput(100, 200, 400)).toBe(50);
  });

  it('fixed(100, 400) * 100 = 25 — clean 25% ratio', () => {
    // fixed_raw = floor(100 * 256 / 400) = floor(64) = 64
    // result = floor((64 * 100 + 128) / 256) = floor(25.5) = 25
    expect(cppPowerOutput(100, 100, 400)).toBe(25);
  });

  it('fixed(1, 400) * 100 = 0 — near-zero HP', () => {
    // fixed_raw = floor(1 * 256 / 400) = floor(0.64) = 0
    // result = floor((0 * 100 + 128) / 256) = floor(0.5) = 0
    expect(cppPowerOutput(100, 1, 400)).toBe(0);
  });

  it('fixed(50, 400) * 100 = 13 — NOT 12 (truncation effect)', () => {
    // fixed_raw = floor(50 * 256 / 400) = floor(32) = 32
    // 32 * 100 = 3200, + 128 = 3328, / 256 = 13.0 exactly!
    expect(cppPowerOutput(100, 50, 400)).toBe(13);
  });

  it('fixed(198, 400) * 100 = 49 — naive float would give 50', () => {
    // fixed_raw = floor(198 * 256 / 400) = floor(126.72) = 126
    // result = floor((126 * 100 + 128) / 256) = floor(49.71875) = 49
    expect(cppPowerOutput(100, 198, 400)).toBe(49);
  });

  it('fixed(398, 400) * 100 = 99 — naive float would give 100', () => {
    // fixed_raw = floor(398 * 256 / 400) = floor(254.72) = 254
    // result = floor((254 * 100 + 128) / 256) = floor(99.71875) = 99
    expect(cppPowerOutput(100, 398, 400)).toBe(99);
  });

  it('fixed(349, 700) * 200 = 99 — APWR just under half', () => {
    // fixed_raw = floor(349 * 256 / 700) = floor(127.634...) = 127
    // result = floor((127 * 200 + 128) / 256) = floor(99.71875) = 99
    expect(cppPowerOutput(200, 349, 700)).toBe(99);
  });

  it('fixed(699, 700) * 200 = 199 — APWR near-full', () => {
    // fixed_raw = floor(699 * 256 / 700) = floor(255.634...) = 255
    // result = floor((255 * 200 + 128) / 256) = floor(199.71875) = 199
    expect(cppPowerOutput(200, 699, 700)).toBe(199);
  });
});

// ============================================================
// Section 2: POWR (100W rated) — TS powerOutput vs C++
//
// C++ POWR: Class->Power = 100, Class->MaxStrength = 400
// Tests at HP values where C++ fixed-point and TS agree.
// ============================================================

describe('POWR power output — agreeing values (building.cpp:4613)', () => {

  it('full health (400/400) = 100W', () => {
    expect(powerOutput('POWR', 400, 400)).toBe(100);
    expect(cppPowerOutput(100, 400, 400)).toBe(100);
  });

  it('half health (200/400) = 50W', () => {
    expect(powerOutput('POWR', 200, 400)).toBe(50);
    expect(cppPowerOutput(100, 200, 400)).toBe(50);
  });

  it('quarter health (100/400) = 25W', () => {
    expect(powerOutput('POWR', 100, 400)).toBe(25);
    expect(cppPowerOutput(100, 100, 400)).toBe(25);
  });

  it('75% health (300/400) = 75W', () => {
    expect(powerOutput('POWR', 300, 400)).toBe(75);
    expect(cppPowerOutput(100, 300, 400)).toBe(75);
  });

  it('dead (0/400) = 0W', () => {
    expect(powerOutput('POWR', 0, 400)).toBe(0);
    expect(cppPowerOutput(100, 0, 400)).toBe(0);
  });

  it('zero maxHp = 0W (no crash)', () => {
    expect(powerOutput('POWR', 0, 0)).toBe(0);
    expect(cppPowerOutput(100, 0, 0)).toBe(0);
  });

  it('HP=1 → 0W (both agree)', () => {
    expect(powerOutput('POWR', 1, 400)).toBe(0);
    expect(cppPowerOutput(100, 1, 400)).toBe(0);
  });
});

// ============================================================
// Section 3: POWR — fixed-point truncation edge cases (PARITY ACHIEVED)
//
// At these HP values, naive floating-point (Math.round) would diverge
// from C++ fixed-point. The TS 8.8 fixed-point implementation matches
// C++ exactly at all these values.
// ============================================================

describe('POWR power output — fixed-point edge cases match C++ (building.cpp:4613)', () => {

  // HP=198: fixed_raw = floor(198*256/400) = 126
  // result = floor((126*100+128)/256) = 49
  // (naive Math.round(100*198/400) would give 50)
  it('HP=198/400: 49W — matches C++ fixed-point truncation', () => {
    const cppExpected = 49;
    expect(cppPowerOutput(100, 198, 400)).toBe(cppExpected);
    expect(powerOutput('POWR', 198, 400)).toBe(cppExpected);
  });

  // HP=398: fixed_raw = floor(398*256/400) = 254
  // result = floor((254*100+128)/256) = 99
  // (naive Math.round would give 100 — need full HP for full power)
  it('HP=398/400: 99W — need full HP for full power', () => {
    const cppExpected = 99;
    expect(cppPowerOutput(100, 398, 400)).toBe(cppExpected);
    expect(powerOutput('POWR', 398, 400)).toBe(cppExpected);
  });

  // HP=3: fixed_raw = floor(3*256/400) = 1
  // result = floor((1*100+128)/256) = 0
  // (naive Math.round(0.75) would give 1)
  it('HP=3/400: 0W — near-zero HP truncates to zero power', () => {
    const cppExpected = 0;
    expect(cppPowerOutput(100, 3, 400)).toBe(cppExpected);
    expect(powerOutput('POWR', 3, 400)).toBe(cppExpected);
  });

  // HP=6: fixed_raw = floor(6*256/400) = 3
  // result = floor((3*100+128)/256) = 1
  // (naive Math.round(1.5) would give 2)
  it('HP=6/400: 1W — matches C++ truncation', () => {
    const cppExpected = 1;
    expect(cppPowerOutput(100, 6, 400)).toBe(cppExpected);
    expect(powerOutput('POWR', 6, 400)).toBe(cppExpected);
  });

  // HP=22: fixed_raw = floor(22*256/400) = 14
  // result = floor((14*100+128)/256) = 5
  // (naive Math.round(5.5) would give 6)
  it('HP=22/400: 5W — matches C++ truncation', () => {
    const cppExpected = 5;
    expect(cppPowerOutput(100, 22, 400)).toBe(cppExpected);
    expect(powerOutput('POWR', 22, 400)).toBe(cppExpected);
  });
});

// ============================================================
// Section 4: APWR (200W rated) — TS powerOutput vs C++
//
// C++ APWR: Class->Power = 200, Class->MaxStrength = 700
// ============================================================

describe('APWR power output — agreeing values (building.cpp:4613)', () => {

  it('full health (700/700) = 200W', () => {
    expect(powerOutput('APWR', 700, 700)).toBe(200);
    expect(cppPowerOutput(200, 700, 700)).toBe(200);
  });

  it('half health (350/700) = 100W', () => {
    expect(powerOutput('APWR', 350, 700)).toBe(100);
    expect(cppPowerOutput(200, 350, 700)).toBe(100);
  });

  it('quarter health (175/700) = 50W', () => {
    expect(powerOutput('APWR', 175, 700)).toBe(50);
    expect(cppPowerOutput(200, 175, 700)).toBe(50);
  });

  it('75% health (525/700) = 150W', () => {
    expect(powerOutput('APWR', 525, 700)).toBe(150);
    expect(cppPowerOutput(200, 525, 700)).toBe(150);
  });

  it('dead (0/700) = 0W', () => {
    expect(powerOutput('APWR', 0, 700)).toBe(0);
    expect(cppPowerOutput(200, 0, 700)).toBe(0);
  });
});

describe('APWR power output — fixed-point edge cases match C++ (building.cpp:4613)', () => {

  // HP=349: fixed_raw = floor(349*256/700) = 127
  // result = floor((127*200+128)/256) = 99
  // (naive Math.round(200*349/700) would give 100)
  it('HP=349/700: 99W — matches C++ truncation', () => {
    const cppExpected = 99;
    expect(cppPowerOutput(200, 349, 700)).toBe(cppExpected);
    expect(powerOutput('APWR', 349, 700)).toBe(cppExpected);
  });

  // HP=699: fixed_raw = floor(699*256/700) = 255
  // result = floor((255*200+128)/256) = 199
  // (naive Math.round(200*699/700) would give 200)
  it('HP=699/700: 199W — need full HP for full power', () => {
    const cppExpected = 199;
    expect(cppPowerOutput(200, 699, 700)).toBe(cppExpected);
    expect(powerOutput('APWR', 699, 700)).toBe(cppExpected);
  });

  // HP=696: fixed_raw = floor(696*256/700) = 254
  // result = floor((254*200+128)/256) = 198
  // (naive Math.round(200*696/700) would give 199)
  it('HP=696/700: 198W — matches C++ truncation', () => {
    const cppExpected = 198;
    expect(cppPowerOutput(200, 696, 700)).toBe(cppExpected);
    expect(powerOutput('APWR', 696, 700)).toBe(cppExpected);
  });

  // HP=2: fixed_raw = floor(2*256/700) = 0
  // result = floor((0*200+128)/256) = 0
  // (naive Math.round(200*2/700) would give 1)
  it('HP=2/700: 0W — near-zero HP truncates to zero', () => {
    const cppExpected = 0;
    expect(cppPowerOutput(200, 2, 700)).toBe(cppExpected);
    expect(powerOutput('APWR', 2, 700)).toBe(cppExpected);
  });

  // HP=100: fixed_raw = floor(100*256/700) = 36
  // result = floor((36*200+128)/256) = 28
  // (naive Math.round(200*100/700) would give 29)
  it('HP=100/700: 28W — matches C++ truncation', () => {
    const cppExpected = 28;
    expect(cppPowerOutput(200, 100, 700)).toBe(cppExpected);
    expect(powerOutput('APWR', 100, 700)).toBe(cppExpected);
  });
});

// ============================================================
// Section 5: Systematic divergence count
//
// Quantifies that the TS implementation matches C++ at every HP value.
// Zero divergences confirms perfect fixed-point parity.
// ============================================================

describe('systematic parity verification', () => {

  it('POWR: zero divergences across full HP range (0..400)', () => {
    let divergences = 0;
    const examples: string[] = [];
    for (let hp = 0; hp <= 400; hp++) {
      const cpp = cppPowerOutput(100, hp, 400);
      const ts = powerOutput('POWR', hp, 400);
      if (cpp !== ts) {
        divergences++;
        if (examples.length < 5) {
          examples.push(`HP=${hp}: C++=${cpp}, TS=${ts}`);
        }
      }
    }
    expect(divergences).toBe(0);
  });

  it('APWR: zero divergences across full HP range (0..700)', () => {
    let divergences = 0;
    for (let hp = 0; hp <= 700; hp++) {
      const cpp = cppPowerOutput(200, hp, 700);
      const ts = powerOutput('APWR', hp, 700);
      if (cpp !== ts) {
        divergences++;
      }
    }
    expect(divergences).toBe(0);
  });

  it('perfect parity: zero cases where C++ and TS differ', () => {
    let cppHigherCount = 0;
    let cppLowerCount = 0;
    let equalCount = 0;

    for (let hp = 0; hp <= 400; hp++) {
      const cpp = cppPowerOutput(100, hp, 400);
      const ts = powerOutput('POWR', hp, 400);
      if (cpp > ts) cppHigherCount++;
      else if (cpp < ts) cppLowerCount++;
      else equalCount++;
    }

    expect(cppHigherCount + cppLowerCount).toBe(0);
  });
});

// ============================================================
// Section 6: Non-power structures produce 0W
//
// C++ building.cpp:4612: if (Class->Power) ... else return 0
// Structures without a Power value always return 0.
// ============================================================

describe('non-power structures produce 0W (building.cpp:4612)', () => {

  it('WEAP produces 0W regardless of health', () => {
    expect(powerOutput('WEAP', 1000, 1000)).toBe(0);
    expect(powerOutput('WEAP', 500, 1000)).toBe(0);
  });

  it('TENT produces 0W (it only consumes)', () => {
    expect(powerOutput('TENT', 800, 800)).toBe(0);
    expect(powerOutput('TENT', 400, 800)).toBe(0);
  });

  it('PROC produces 0W', () => {
    expect(powerOutput('PROC', 900, 900)).toBe(0);
  });

  it('unknown type produces 0W', () => {
    expect(powerOutput('ZZZZ', 100, 100)).toBe(0);
  });
});

// ============================================================
// Section 7: Power grid integration with damaged buildings
//
// calculatePowerGrid sums powerOutput for each alive, non-selling,
// allied structure. Verify that health degradation propagates.
// ============================================================

describe('calculatePowerGrid with damaged buildings', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('single damaged POWR contributes degraded power', () => {
    const powr = makeStruct('POWR', 10, 10, 200, 400);
    const grid = calculatePowerGrid([powr], House.Spain, isAllied);
    expect(grid.produced).toBe(50); // 50% health = 50W
  });

  it('multiple damaged POWR sum correctly', () => {
    const p1 = makeStruct('POWR', 10, 10, 400, 400); // 100W
    const p2 = makeStruct('POWR', 14, 10, 200, 400); // 50W
    const p3 = makeStruct('POWR', 18, 10, 100, 400); // 25W
    const grid = calculatePowerGrid([p1, p2, p3], House.Spain, isAllied);
    expect(grid.produced).toBe(175); // 100 + 50 + 25
  });

  it('mixed POWR+APWR with damage sums correctly', () => {
    const powr = makeStruct('POWR', 10, 10, 200, 400); // 50W
    const apwr = makeStruct('APWR', 14, 10, 350, 700); // 100W
    const grid = calculatePowerGrid([powr, apwr], House.Spain, isAllied);
    expect(grid.produced).toBe(150); // 50 + 100
  });

  it('dead structures (alive=false) produce 0W', () => {
    const powr = makeStruct('POWR', 10, 10, 0, 400);
    powr.alive = false;
    const grid = calculatePowerGrid([powr], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
  });

  it('selling structures produce 0W', () => {
    const powr = makeStruct('POWR', 10, 10, 400, 400);
    powr.sellProgress = 0.1;
    const grid = calculatePowerGrid([powr], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
  });

  it('enemy structures excluded from player grid', () => {
    const powr = makeStruct('POWR', 10, 10, 400, 400, House.USSR);
    const grid = calculatePowerGrid([powr], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
  });
});

// ============================================================
// Section 8: Power output at C++ fixed-point boundary HP values
//
// These HP values are specifically chosen at the boundaries where
// the fixed(Strength, MaxStrength) truncation changes the integer
// portion of the fixed-point number. TS matches C++ at all boundaries.
// ============================================================

describe('POWR fixed-point boundary HP values', () => {

  // At exactly half: both agree
  it('HP=200/400: clean half — 50W', () => {
    const cpp = cppPowerOutput(100, 200, 400);
    const ts = powerOutput('POWR', 200, 400);
    expect(ts).toBe(cpp);
    expect(ts).toBe(50);
  });

  // One below half: both agree (199/400 = 0.4975)
  it('HP=199/400: just below half — 50W', () => {
    const cpp = cppPowerOutput(100, 199, 400);
    const ts = powerOutput('POWR', 199, 400);
    expect(ts).toBe(cpp);
    expect(ts).toBe(50);
  });

  // Two below half: C++ and TS both give 49
  it('HP=198/400: two below half — 49W', () => {
    const cppExpected = cppPowerOutput(100, 198, 400);
    expect(cppExpected).toBe(49);
    expect(powerOutput('POWR', 198, 400)).toBe(49);
  });

  // One below full: both agree (399/400 = 0.9975)
  it('HP=399/400: one below full — 100W', () => {
    const cpp = cppPowerOutput(100, 399, 400);
    const ts = powerOutput('POWR', 399, 400);
    expect(ts).toBe(cpp);
    expect(ts).toBe(100);
  });

  // Two below full: C++ and TS both give 99
  it('HP=398/400: two below full — 99W', () => {
    const cppExpected = cppPowerOutput(100, 398, 400);
    expect(cppExpected).toBe(99);
    expect(powerOutput('POWR', 398, 400)).toBe(99);
  });
});

describe('APWR fixed-point boundary HP values', () => {

  // One below half
  it('HP=349/700: one below half — 99W', () => {
    const cppExpected = cppPowerOutput(200, 349, 700);
    expect(cppExpected).toBe(99);
    expect(powerOutput('APWR', 349, 700)).toBe(99);
  });

  // Exactly half
  it('HP=350/700: exact half — 100W', () => {
    const cpp = cppPowerOutput(200, 350, 700);
    const ts = powerOutput('APWR', 350, 700);
    expect(ts).toBe(cpp);
    expect(ts).toBe(100);
  });

  // One above half
  it('HP=351/700: one above half — 100W', () => {
    const cpp = cppPowerOutput(200, 351, 700);
    const ts = powerOutput('APWR', 351, 700);
    expect(ts).toBe(cpp);
    expect(ts).toBe(100);
  });

  // Near full
  it('HP=699/700: one below full — 199W', () => {
    const cppExpected = cppPowerOutput(200, 699, 700);
    expect(cppExpected).toBe(199);
    expect(powerOutput('APWR', 699, 700)).toBe(199);
  });
});

// ============================================================
// Section 9: Monotonic degradation — both C++ and TS
//
// Regardless of fixed-point precision, power output must be
// monotonically non-decreasing as HP increases. This is a
// behavioral invariant that BOTH implementations should satisfy.
// ============================================================

describe('monotonic power output — behavioral invariant', () => {

  it('POWR: TS powerOutput is monotonically non-decreasing with HP', () => {
    let prev = powerOutput('POWR', 0, 400);
    for (let hp = 1; hp <= 400; hp++) {
      const curr = powerOutput('POWR', hp, 400);
      expect(curr, `HP=${hp} should be >= HP=${hp - 1}`).toBeGreaterThanOrEqual(prev);
      prev = curr;
    }
  });

  it('APWR: TS powerOutput is monotonically non-decreasing with HP', () => {
    let prev = powerOutput('APWR', 0, 700);
    for (let hp = 1; hp <= 700; hp++) {
      const curr = powerOutput('APWR', hp, 700);
      expect(curr, `HP=${hp} should be >= HP=${hp - 1}`).toBeGreaterThanOrEqual(prev);
      prev = curr;
    }
  });

  it('POWR: C++ algorithm is monotonically non-decreasing with HP', () => {
    let prev = cppPowerOutput(100, 0, 400);
    for (let hp = 1; hp <= 400; hp++) {
      const curr = cppPowerOutput(100, hp, 400);
      expect(curr, `HP=${hp} should be >= HP=${hp - 1}`).toBeGreaterThanOrEqual(prev);
      prev = curr;
    }
  });

  it('APWR: C++ algorithm is monotonically non-decreasing with HP', () => {
    let prev = cppPowerOutput(200, 0, 700);
    for (let hp = 1; hp <= 700; hp++) {
      const curr = cppPowerOutput(200, hp, 700);
      expect(curr, `HP=${hp} should be >= HP=${hp - 1}`).toBeGreaterThanOrEqual(prev);
      prev = curr;
    }
  });
});

// ============================================================
// Section 10: Range invariants
//
// Both implementations must produce values in [0, ratedPower].
// ============================================================

describe('output range invariants', () => {

  it('POWR output is always in [0, 100]', () => {
    for (let hp = 0; hp <= 400; hp++) {
      const ts = powerOutput('POWR', hp, 400);
      expect(ts).toBeGreaterThanOrEqual(0);
      expect(ts).toBeLessThanOrEqual(100);
    }
  });

  it('APWR output is always in [0, 200]', () => {
    for (let hp = 0; hp <= 700; hp++) {
      const ts = powerOutput('APWR', hp, 700);
      expect(ts).toBeGreaterThanOrEqual(0);
      expect(ts).toBeLessThanOrEqual(200);
    }
  });

  it('output is always an integer', () => {
    for (let hp = 0; hp <= 400; hp++) {
      expect(Number.isInteger(powerOutput('POWR', hp, 400))).toBe(true);
    }
    for (let hp = 0; hp <= 700; hp++) {
      expect(Number.isInteger(powerOutput('APWR', hp, 700))).toBe(true);
    }
  });
});

// ============================================================
// Section 11: Maximum divergence magnitude
//
// With perfect parity, maximum divergence should be exactly 0.
// ============================================================

describe('divergence magnitude bounds', () => {

  it('POWR: zero divergence across full HP range', () => {
    let maxDiv = 0;
    for (let hp = 0; hp <= 400; hp++) {
      const cpp = cppPowerOutput(100, hp, 400);
      const ts = powerOutput('POWR', hp, 400);
      maxDiv = Math.max(maxDiv, Math.abs(cpp - ts));
    }
    expect(maxDiv).toBe(0);
  });

  it('APWR: zero divergence across full HP range', () => {
    let maxDiv = 0;
    for (let hp = 0; hp <= 700; hp++) {
      const cpp = cppPowerOutput(200, hp, 700);
      const ts = powerOutput('APWR', hp, 700);
      maxDiv = Math.max(maxDiv, Math.abs(cpp - ts));
    }
    expect(maxDiv).toBe(0);
  });
});

// ============================================================
// Section 12: C++ Strength update path (building.cpp:929-933)
//
// In C++, when Strength changes, the building recalculates
// Power_Output and calls House->Adjust_Power(delta).
// This means the delta is calculated as:
//   newPower = Power * fixed(newStrength, MaxStrength)
//   oldPower = Power * fixed(oldStrength, MaxStrength)
//   delta = newPower - oldPower
//
// With fixed-point truncation, the delta can be 0 even when
// HP changes by 1, because fixed_raw might not change.
// ============================================================

describe('incremental power delta (building.cpp:929-933)', () => {

  it('POWR: 1 HP damage from full (400->399) has zero delta in C++', () => {
    // fixed(400, 400) = 256, fixed(399, 400) = floor(255.36) = 255
    // Power_Output(400) = floor((256*100+128)/256) = 100
    // Power_Output(399) = floor((255*100+128)/256) = floor(100.21875) = 100
    // delta = 100 - 100 = 0
    const old = cppPowerOutput(100, 400, 400);
    const now = cppPowerOutput(100, 399, 400);
    expect(old - now).toBe(0);
  });

  it('POWR: 2 HP damage from full (400->398) has delta=1 in C++', () => {
    // Power_Output(400) = 100, Power_Output(398) = 99
    // delta = 100 - 99 = 1
    const old = cppPowerOutput(100, 400, 400);
    const now = cppPowerOutput(100, 398, 400);
    expect(old - now).toBe(1);
  });

  it('APWR: 1 HP damage from full (700->699) has delta=1 in C++', () => {
    // fixed(700, 700) = 256, fixed(699, 700) = floor(255.634) = 255
    // Power_Output(700) = floor((256*200+128)/256) = 200
    // Power_Output(699) = floor((255*200+128)/256) = floor(199.71875) = 199
    // delta = 200 - 199 = 1
    const old = cppPowerOutput(200, 700, 700);
    const now = cppPowerOutput(200, 699, 700);
    expect(old - now).toBe(1);
  });

  it('APWR: some 1-HP changes produce zero delta due to fixed truncation', () => {
    // Find a case where 1 HP change has no effect in C++
    let foundZeroDelta = false;
    for (let hp = 699; hp >= 1; hp--) {
      const old = cppPowerOutput(200, hp, 700);
      const now = cppPowerOutput(200, hp - 1, 700);
      if (old === now) {
        foundZeroDelta = true;
        break;
      }
    }
    expect(foundZeroDelta).toBe(true);
  });
});
