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
 * The TS implementation uses:
 *   Math.round(Power * (hp / maxHp))
 *
 * These differ because:
 *   - C++ truncates in step 1 (fixed-point construction loses fractional bits)
 *   - TS uses full IEEE 754 double precision throughout
 *   - The truncation in step 1 causes the C++ result to be systematically <=
 *     the TS result (the fixed fraction is always <= the true fraction)
 *
 * This test documents the EXACT C++ behavior. Where TS diverges, tests are
 * left FAILING with // PARITY GAP comments.
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
    // result = floor((32 * 100 + 128) / 256) = floor(12.9998) = 12
    // Wait — let me recalculate:
    // 32 * 100 = 3200, + 128 = 3328, / 256 = 13.0 exactly!
    expect(cppPowerOutput(100, 50, 400)).toBe(13);
  });

  it('fixed(198, 400) * 100 = 49 — TS would give 50', () => {
    // fixed_raw = floor(198 * 256 / 400) = floor(126.72) = 126
    // result = floor((126 * 100 + 128) / 256) = floor(49.71875) = 49
    // TS: Math.round(100 * 198/400) = Math.round(49.5) = 50
    expect(cppPowerOutput(100, 198, 400)).toBe(49);
  });

  it('fixed(398, 400) * 100 = 99 — TS would give 100', () => {
    // fixed_raw = floor(398 * 256 / 400) = floor(254.72) = 254
    // result = floor((254 * 100 + 128) / 256) = floor(99.71875) = 99
    // TS: Math.round(100 * 398/400) = Math.round(99.5) = 100
    expect(cppPowerOutput(100, 398, 400)).toBe(99);
  });

  it('fixed(349, 700) * 200 = 99 — APWR just under half', () => {
    // fixed_raw = floor(349 * 256 / 700) = floor(127.634...) = 127
    // result = floor((127 * 200 + 128) / 256) = floor(99.71875) = 99
    // TS: Math.round(200 * 349/700) = Math.round(99.714...) = 100
    expect(cppPowerOutput(200, 349, 700)).toBe(99);
  });

  it('fixed(699, 700) * 200 = 199 — APWR near-full', () => {
    // fixed_raw = floor(699 * 256 / 700) = floor(255.634...) = 255
    // result = floor((255 * 200 + 128) / 256) = floor(199.71875) = 199
    // TS: Math.round(200 * 699/700) = Math.round(199.714...) = 200
    expect(cppPowerOutput(200, 699, 700)).toBe(199);
  });
});

// ============================================================
// Section 2: POWR (100W rated) — TS powerOutput vs C++
//
// C++ POWR: Class->Power = 100, Class->MaxStrength = 400
// Tests at HP values where C++ fixed-point and TS Math.round agree.
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
// Section 3: POWR — diverging values (C++ fixed-point truncation)
//
// At these HP values, the C++ fixed(Strength, MaxStrength) truncation
// causes the result to differ from TS Math.round(100 * hp/maxHp).
//
// These tests assert the C++ expected values. If TS diverges, the
// test is marked // PARITY GAP and left FAILING.
// ============================================================

describe('POWR power output — C++ fixed-point divergence (building.cpp:4613)', () => {

  // HP=198: C++=49, TS=50
  // fixed_raw = floor(198*256/400) = 126
  // C++: floor((126*100+128)/256) = floor(49.71875) = 49
  // TS: Math.round(100*198/400) = Math.round(49.5) = 50
  it('HP=198/400: C++ produces 49W, not 50W // PARITY GAP', () => {
    const cppExpected = 49;
    expect(cppPowerOutput(100, 198, 400)).toBe(cppExpected);
    expect(powerOutput('POWR', 198, 400)).toBe(cppExpected); // PARITY GAP — TS returns 50
  });

  // HP=398: C++=99, TS=100
  // fixed_raw = floor(398*256/400) = 254
  // C++: floor((254*100+128)/256) = floor(99.71875) = 99
  // TS: Math.round(100*398/400) = Math.round(99.5) = 100
  it('HP=398/400: C++ produces 99W, not 100W // PARITY GAP', () => {
    const cppExpected = 99;
    expect(cppPowerOutput(100, 398, 400)).toBe(cppExpected);
    expect(powerOutput('POWR', 398, 400)).toBe(cppExpected); // PARITY GAP — TS returns 100
  });

  // HP=50: C++=13, TS=12 (C++ higher due to rounding in fixed*int)
  // fixed_raw = floor(50*256/400) = 32
  // C++: floor((32*100+128)/256) = floor(13.0) = 13
  // TS: Math.round(100*50/400) = Math.round(12.5) = 13 — actually this IS 13 with round-half-up
  // Wait, let me recheck: Math.round(12.5) = 13 in JS. So they AGREE here.
  // Let me pick a real divergence.

  // HP=3: C++=0, TS=1
  // fixed_raw = floor(3*256/400) = floor(1.92) = 1
  // C++: floor((1*100+128)/256) = floor(0.890625) = 0
  // TS: Math.round(100*3/400) = Math.round(0.75) = 1
  it('HP=3/400: C++ produces 0W, not 1W // PARITY GAP', () => {
    const cppExpected = 0;
    expect(cppPowerOutput(100, 3, 400)).toBe(cppExpected);
    expect(powerOutput('POWR', 3, 400)).toBe(cppExpected); // PARITY GAP — TS returns 1
  });

  // HP=6: C++=1, TS=2
  // fixed_raw = floor(6*256/400) = floor(3.84) = 3
  // C++: floor((3*100+128)/256) = floor(1.6875) = 1
  // TS: Math.round(100*6/400) = Math.round(1.5) = 2
  it('HP=6/400: C++ produces 1W, not 2W // PARITY GAP', () => {
    const cppExpected = 1;
    expect(cppPowerOutput(100, 6, 400)).toBe(cppExpected);
    expect(powerOutput('POWR', 6, 400)).toBe(cppExpected); // PARITY GAP — TS returns 2
  });

  // HP=22: C++=5, TS=6
  // fixed_raw = floor(22*256/400) = floor(14.08) = 14
  // C++: floor((14*100+128)/256) = floor(5.96875) = 5
  // TS: Math.round(100*22/400) = Math.round(5.5) = 6
  it('HP=22/400: C++ produces 5W, not 6W // PARITY GAP', () => {
    const cppExpected = 5;
    expect(cppPowerOutput(100, 22, 400)).toBe(cppExpected);
    expect(powerOutput('POWR', 22, 400)).toBe(cppExpected); // PARITY GAP — TS returns 6
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

describe('APWR power output — C++ fixed-point divergence (building.cpp:4613)', () => {

  // HP=349: C++=99, TS=100
  // fixed_raw = floor(349*256/700) = floor(127.634) = 127
  // C++: floor((127*200+128)/256) = floor(99.71875) = 99
  // TS: Math.round(200*349/700) = Math.round(99.714) = 100
  it('HP=349/700: C++ produces 99W, not 100W // PARITY GAP', () => {
    const cppExpected = 99;
    expect(cppPowerOutput(200, 349, 700)).toBe(cppExpected);
    expect(powerOutput('APWR', 349, 700)).toBe(cppExpected); // PARITY GAP — TS returns 100
  });

  // HP=699: C++=199, TS=200
  // fixed_raw = floor(699*256/700) = floor(255.634) = 255
  // C++: floor((255*200+128)/256) = floor(199.71875) = 199
  // TS: Math.round(200*699/700) = Math.round(199.714) = 200
  it('HP=699/700: C++ produces 199W, not 200W // PARITY GAP', () => {
    const cppExpected = 199;
    expect(cppPowerOutput(200, 699, 700)).toBe(cppExpected);
    expect(powerOutput('APWR', 699, 700)).toBe(cppExpected); // PARITY GAP — TS returns 200
  });

  // HP=696: C++=198, TS=199
  // fixed_raw = floor(696*256/700) = floor(254.537) = 254
  // C++: floor((254*200+128)/256) = floor(198.9375) = 198
  // TS: Math.round(200*696/700) = Math.round(198.857) = 199
  it('HP=696/700: C++ produces 198W, not 199W // PARITY GAP', () => {
    const cppExpected = 198;
    expect(cppPowerOutput(200, 696, 700)).toBe(cppExpected);
    expect(powerOutput('APWR', 696, 700)).toBe(cppExpected); // PARITY GAP — TS returns 199
  });

  // HP=2: C++=0, TS=1
  // fixed_raw = floor(2*256/700) = floor(0.731) = 0
  // C++: floor((0*200+128)/256) = floor(0.5) = 0
  // TS: Math.round(200*2/700) = Math.round(0.571) = 1
  it('HP=2/700: C++ produces 0W, not 1W // PARITY GAP', () => {
    const cppExpected = 0;
    expect(cppPowerOutput(200, 2, 700)).toBe(cppExpected);
    expect(powerOutput('APWR', 2, 700)).toBe(cppExpected); // PARITY GAP — TS returns 1
  });

  // HP=100: C++=28, TS=29
  // fixed_raw = floor(100*256/700) = floor(36.571) = 36
  // C++: floor((36*200+128)/256) = floor(28.625) = 28
  // TS: Math.round(200*100/700) = Math.round(28.571) = 29
  it('HP=100/700: C++ produces 28W, not 29W // PARITY GAP', () => {
    const cppExpected = 28;
    expect(cppPowerOutput(200, 100, 700)).toBe(cppExpected);
    expect(powerOutput('APWR', 100, 700)).toBe(cppExpected); // PARITY GAP — TS returns 29
  });
});

// ============================================================
// Section 5: Systematic divergence count
//
// Quantifies the scale of the fixed-point truncation divergence.
// This test always passes — it documents the magnitude.
// ============================================================

describe('systematic divergence analysis', () => {

  it('POWR: counts divergent HP values across full range', () => {
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
    // Document the divergence count — this always passes
    // The exact count depends on the TS implementation
    expect(divergences).toBe(0); // Fixed: TS now uses C++ 8.8 fixed-point
  });

  it('APWR: counts divergent HP values across full range', () => {
    let divergences = 0;
    for (let hp = 0; hp <= 700; hp++) {
      const cpp = cppPowerOutput(200, hp, 700);
      const ts = powerOutput('APWR', hp, 700);
      if (cpp !== ts) {
        divergences++;
      }
    }
    expect(divergences).toBe(0); // Fixed: TS now uses C++ 8.8 fixed-point
  });

  it('C++ fixed-point systematically loses precision vs float', () => {
    // The C++ fixed(n, d) constructor truncates: floor(n*256/d).
    // This means the fixed ratio is always <= the true ratio.
    // Therefore C++ power output is typically <= TS power output.
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

    // The +128 rounding in fixed*int can occasionally push C++ higher,
    // but the truncation in fixed() construction dominates.
    // Most divergences have C++ < TS (truncation) or C++ > TS (rounding),
    // but both directions exist.
    expect(cppHigherCount + cppLowerCount).toBe(0); // Fixed: perfect parity
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
// portion of the fixed-point number. When fixed_raw crosses a
// multiple of 256/Power, the output jumps.
//
// All tests assert C++ expected values. TS divergence = PARITY GAP.
// ============================================================

describe('POWR fixed-point boundary HP values', () => {

  // At exactly half: both agree
  it('HP=200/400: clean half → 50W (agree)', () => {
    const cpp = cppPowerOutput(100, 200, 400);
    const ts = powerOutput('POWR', 200, 400);
    expect(ts).toBe(cpp);
    expect(ts).toBe(50);
  });

  // One below half: both agree (199/400 = 0.4975)
  it('HP=199/400: just below half → 50W (agree)', () => {
    const cpp = cppPowerOutput(100, 199, 400);
    const ts = powerOutput('POWR', 199, 400);
    expect(ts).toBe(cpp);
    expect(ts).toBe(50);
  });

  // Two below half: C++ = 49, TS = 50
  it('HP=198/400: two below half → C++ 49W // PARITY GAP', () => {
    const cppExpected = cppPowerOutput(100, 198, 400);
    expect(cppExpected).toBe(49);
    expect(powerOutput('POWR', 198, 400)).toBe(49); // PARITY GAP — TS returns 50
  });

  // One below full: both agree (399/400 = 0.9975)
  it('HP=399/400: one below full → 100W (agree)', () => {
    const cpp = cppPowerOutput(100, 399, 400);
    const ts = powerOutput('POWR', 399, 400);
    expect(ts).toBe(cpp);
    expect(ts).toBe(100);
  });

  // Two below full: DIVERGE
  it('HP=398/400: two below full → C++ 99W // PARITY GAP', () => {
    const cppExpected = cppPowerOutput(100, 398, 400);
    expect(cppExpected).toBe(99);
    expect(powerOutput('POWR', 398, 400)).toBe(99); // PARITY GAP — TS returns 100
  });
});

describe('APWR fixed-point boundary HP values', () => {

  // One below half
  it('HP=349/700: one below half → C++ 99W // PARITY GAP', () => {
    const cppExpected = cppPowerOutput(200, 349, 700);
    expect(cppExpected).toBe(99);
    expect(powerOutput('APWR', 349, 700)).toBe(99); // PARITY GAP — TS returns 100
  });

  // Exactly half
  it('HP=350/700: exact half → 100W (agree)', () => {
    const cpp = cppPowerOutput(200, 350, 700);
    const ts = powerOutput('APWR', 350, 700);
    expect(ts).toBe(cpp);
    expect(ts).toBe(100);
  });

  // One above half
  it('HP=351/700: one above half → C++ 100W (agree)', () => {
    const cpp = cppPowerOutput(200, 351, 700);
    const ts = powerOutput('APWR', 351, 700);
    expect(ts).toBe(cpp);
    expect(ts).toBe(100);
  });

  // Near full
  it('HP=699/700: one below full → C++ 199W // PARITY GAP', () => {
    const cppExpected = cppPowerOutput(200, 699, 700);
    expect(cppExpected).toBe(199);
    expect(powerOutput('APWR', 699, 700)).toBe(199); // PARITY GAP — TS returns 200
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
// The largest possible divergence between C++ and TS should be
// bounded. With 8-bit fractional precision, the fixed-point
// construction error is at most 1/256, and the multiplication
// by Power amplifies this by at most Power/256.
// ============================================================

describe('divergence magnitude bounds', () => {

  it('POWR: maximum divergence is at most 1W', () => {
    let maxDiv = 0;
    for (let hp = 0; hp <= 400; hp++) {
      const cpp = cppPowerOutput(100, hp, 400);
      const ts = powerOutput('POWR', hp, 400);
      maxDiv = Math.max(maxDiv, Math.abs(cpp - ts));
    }
    // With Power=100 and 8-bit fixed point, max error < 100/256 + rounding ≈ 1
    expect(maxDiv).toBeLessThanOrEqual(1);
  });

  it('APWR: maximum divergence is at most 1W', () => {
    let maxDiv = 0;
    for (let hp = 0; hp <= 700; hp++) {
      const cpp = cppPowerOutput(200, hp, 700);
      const ts = powerOutput('APWR', hp, 700);
      maxDiv = Math.max(maxDiv, Math.abs(cpp - ts));
    }
    // With Power=200, max error could be up to 200/256 ≈ 0.78, rounds to 1
    expect(maxDiv).toBeLessThanOrEqual(1);
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

  it('POWR: 1 HP damage from full (400→399) has zero delta in C++', () => {
    // fixed(400, 400) = 256, fixed(399, 400) = floor(255.36) = 255
    // Power_Output(400) = floor((256*100+128)/256) = 100
    // Power_Output(399) = floor((255*100+128)/256) = floor(100.21875) = 100
    // delta = 100 - 100 = 0
    const old = cppPowerOutput(100, 400, 400);
    const now = cppPowerOutput(100, 399, 400);
    expect(old - now).toBe(0);
  });

  it('POWR: 2 HP damage from full (400→398) has delta=1 in C++', () => {
    // Power_Output(400) = 100, Power_Output(398) = 99
    // delta = 100 - 99 = 1
    const old = cppPowerOutput(100, 400, 400);
    const now = cppPowerOutput(100, 398, 400);
    expect(old - now).toBe(1);
  });

  it('APWR: 1 HP damage from full (700→699) has delta=1 in C++', () => {
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
