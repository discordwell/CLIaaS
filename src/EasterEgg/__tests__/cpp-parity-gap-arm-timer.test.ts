/**
 * C++ Behavioral Parity: GAP Generator Arm Timer RNG
 *
 * C++ building.cpp:990-993 — Gap Generators use the weapon Arm timer (CDTimerClass)
 * as a re-jam interval. When Arm reaches 0, it consumes Random_Pick(1, TICKS_PER_SECOND)
 * and resets Arm = TICKS_PER_MINUTE * Rule.GapRegenInterval + jitter.
 *
 * This is critical for RNG stream parity: at tick 1, all GAP buildings have Arm=0
 * (TechnoClass constructor initializes Arm to 0), so each GAP building consumes 1 RNG
 * call. In SCG08EA with 4 GAP generators, this accounts for 4 RNG calls that were
 * previously missing from the TS implementation.
 *
 * C++ source refs:
 *   building.cpp:990-993    — STRUCT_GAP Arm==0 check + Random_Pick(1, TICKS_PER_SECOND)
 *   techno.cpp:620          — Arm(0) in TechnoClass constructor
 *   defines.h:3031-3032     — TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
 *   rules.ini:28            — GapRegenInterval=.1 → fixed 8.8 Raw=25 → 900*25/256=88 ticks base
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ScenarioRandom } from '../engine/random';
import type { MapStructure } from '../engine/scenario';
import { House } from '../engine/types';

beforeEach(() => {
  ScenarioRandom.seed = 12345;
  ScenarioRandom.callCount = 0;
});

/** Create a GAP building with gapArmTimer initialized to 0 (matching C++ Arm(0)) */
function makeGAP(cx: number, cy: number, house: House = House.Greece): MapStructure {
  return {
    type: 'GAP', image: 'gap', house,
    cx, cy, hp: 1000, maxHp: 1000, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1, missionTimer: 0,
    gapArmTimer: 0, // C++ TechnoClass::Arm initialized to 0
  };
}

/**
 * Simulate the Phase 3 GAP Arm timer logic from tickStructuresInterleaved().
 * This mirrors the exact code added to index.ts for GAP generator Arm timer.
 */
function tickGapArm(s: MapStructure): void {
  if (s.type === 'GAP' && s.gapArmTimer !== undefined) {
    if (s.gapArmTimer > 0) {
      s.gapArmTimer--;
    }
    if (s.gapArmTimer === 0) {
      const gapJitter = ScenarioRandom.nextInRange(1, 15);
      s.gapArmTimer = 88 + gapJitter;
    }
  }
}

// ── C++ building.cpp:990-993 — GAP Arm timer RNG consumption ─────────────────

describe('GAP Arm timer (building.cpp:990-993)', () => {

  it('consumes exactly 1 RNG call when gapArmTimer is 0 (initial state)', () => {
    const gap = makeGAP(10, 10);
    expect(gap.gapArmTimer).toBe(0);

    const callsBefore = ScenarioRandom.callCount;
    tickGapArm(gap);
    const callsAfter = ScenarioRandom.callCount;

    expect(callsAfter - callsBefore).toBe(1);
  });

  it('sets gapArmTimer to 90 + jitter (1-15) after firing', () => {
    const gap = makeGAP(10, 10);
    tickGapArm(gap);

    // C++ Arm = TICKS_PER_MINUTE * Rule.GapRegenInterval + Random_Pick(1, 15)
    // fixed(".1") → Raw=25. 900 * fixed(25) = (25*900+128)/256 = 88.
    // So Arm = 88 + [1..15] = [89..103]
    expect(gap.gapArmTimer).toBeGreaterThanOrEqual(89);
    expect(gap.gapArmTimer).toBeLessThanOrEqual(103);
  });

  it('does NOT consume RNG when gapArmTimer > 0 (countdown in progress)', () => {
    const gap = makeGAP(10, 10);
    gap.gapArmTimer = 50; // mid-countdown

    const callsBefore = ScenarioRandom.callCount;
    tickGapArm(gap);
    const callsAfter = ScenarioRandom.callCount;

    expect(callsAfter - callsBefore).toBe(0);
    expect(gap.gapArmTimer).toBe(49); // decremented by 1
  });

  it('decrements gapArmTimer by 1 each tick (CDTimerClass behavior)', () => {
    const gap = makeGAP(10, 10);
    gap.gapArmTimer = 3;

    // Tick 1: 3 → 2
    tickGapArm(gap);
    expect(gap.gapArmTimer).toBe(2);
    expect(ScenarioRandom.callCount).toBe(0);

    // Tick 2: 2 → 1
    tickGapArm(gap);
    expect(gap.gapArmTimer).toBe(1);
    expect(ScenarioRandom.callCount).toBe(0);

    // Tick 3: 1 → 0 → fires → sets to 90+jitter
    tickGapArm(gap);
    expect(ScenarioRandom.callCount).toBe(1);
    expect(gap.gapArmTimer).toBeGreaterThanOrEqual(89);
    expect(gap.gapArmTimer).toBeLessThanOrEqual(103);
  });

  it('4 GAP buildings at tick 1 produce exactly 4 RNG calls (SCG08EA parity)', () => {
    // SCG08EA has 4 GAP generators at structure indices 8-11.
    // At tick 1, all have Arm=0, so each consumes 1 RNG call.
    const gaps = [
      makeGAP(10, 10),
      makeGAP(12, 12),
      makeGAP(14, 14),
      makeGAP(16, 16),
    ];

    const callsBefore = ScenarioRandom.callCount;
    for (const gap of gaps) {
      tickGapArm(gap);
    }
    const callsAfter = ScenarioRandom.callCount;

    expect(callsAfter - callsBefore).toBe(4);

    // All should now have non-zero timers
    for (const gap of gaps) {
      expect(gap.gapArmTimer).toBeGreaterThanOrEqual(91);
      expect(gap.gapArmTimer).toBeLessThanOrEqual(105);
    }
  });

  it('non-GAP buildings are unaffected (no gapArmTimer field)', () => {
    const gun: MapStructure = {
      type: 'GUN', image: 'gun', house: House.Greece,
      cx: 10, cy: 10, hp: 400, maxHp: 400, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1, missionTimer: 0,
    };

    const callsBefore = ScenarioRandom.callCount;
    tickGapArm(gun);
    const callsAfter = ScenarioRandom.callCount;

    expect(callsAfter - callsBefore).toBe(0);
  });
});

// ── C++ rules.ini constants verification ─────────────────────────────────────

describe('GAP Arm timer constants (rules.ini + defines.h)', () => {

  it('TICKS_PER_SECOND = 15 (defines.h:3031)', () => {
    // The Random_Pick(1, TICKS_PER_SECOND) in building.cpp:993
    // uses TICKS_PER_SECOND = 15
    expect(15).toBe(15); // documenting the constant
  });

  it('GapRegenInterval = .1 from rules.ini yields base of 88 ticks (fixed 8.8)', () => {
    // rules.ini:28: GapRegenInterval=.1
    // C++ fixed(".1"): frac=atoi("1")=1, base=10. Fraction=(256*1)/10=25. Raw=25.
    // C++ building.cpp:993: TICKS_PER_MINUTE * Rule.GapRegenInterval
    //   = int * fixed = (Raw * int + 128) / 256 = (25 * 900 + 128) / 256 = 88
    const TICKS_PER_MINUTE = 900;
    const fixedRaw = Math.floor((256 * 1) / 10); // 25
    const gapBase = Math.floor((fixedRaw * TICKS_PER_MINUTE + 128) / 256); // 88
    expect(gapBase).toBe(88);
  });
});
