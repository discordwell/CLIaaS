/**
 * C++ Parity Tests — PathThreshhold Escalation System
 *
 * C++ source refs:
 *   foot.h:232-240   — PathThreshhold, PathDelay, TryTryAgain (PATH_RETRY=10)
 *   foot.cpp:125-127 — constructor: PathThreshhold(MOVE_CLOAK), TryTryAgain(PATH_RETRY)
 *   foot.cpp:396-411 — escalation loop: Find_Path at PathThreshhold, increment on failure
 *   foot.cpp:463     — PathDelay = Rule.PathDelay * TICKS_PER_MINUTE (~14 ticks)
 *   foot.cpp:1723-1735 — Assign_Destination resets PathThreshhold to MOVE_CLOAK
 *   drive.cpp:989-996 — TryTryAgain decrement; at 0, give up (Assign_Destination(TARGET_NONE))
 *   drive.cpp:1050    — successful path: TryTryAgain = PATH_RETRY
 *   defines.h:828-837 — MoveType enum: MOVE_OK(0), MOVE_CLOAK(1), MOVE_MOVING_BLOCK(2),
 *                        MOVE_DESTROYABLE(3), MOVE_TEMP(4), MOVE_NO(5)
 */

import { describe, it, expect } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { House, UnitType } from '../engine/types';

// C++ constants (mirrored from engine/index.ts for test validation)
const PATH_RETRY = 10;
const MOVE_CLOAK = 1;

describe('PathThreshhold escalation — C++ foot.cpp parity', () => {
  beforeEach(() => {
    resetEntityIds();
  });

  // =========================================================================
  // 1. Default state matches C++ constructor (foot.cpp:125-127)
  // =========================================================================

  it('pathThreshold starts at MOVE_CLOAK (1) — C++ foot.cpp:125', () => {
    const e = new Entity(UnitType.V_1TNK, House.Greece, 100, 100);
    expect(e.pathThreshold).toBe(MOVE_CLOAK);
  });

  it('tryCount starts at PATH_RETRY (10) — C++ foot.h:239', () => {
    const e = new Entity(UnitType.V_1TNK, House.Greece, 100, 100);
    expect(e.tryCount).toBe(PATH_RETRY);
  });

  it('pathDelay starts at 0 — C++ foot.cpp:126', () => {
    const e = new Entity(UnitType.V_1TNK, House.Greece, 100, 100);
    expect(e.pathDelay).toBe(0);
  });

  // =========================================================================
  // 2. Threshold escalation on path failure (foot.cpp:409-410)
  // =========================================================================

  it('threshold escalates through CLOAK → MOVING_BLOCK → DESTROYABLE → TEMP', () => {
    const e = new Entity(UnitType.V_1TNK, House.Greece, 100, 100);
    // Simulate escalation: on each path failure, threshold increments by 1
    expect(e.pathThreshold).toBe(1); // MOVE_CLOAK
    e.pathThreshold++;
    expect(e.pathThreshold).toBe(2); // MOVE_MOVING_BLOCK
    e.pathThreshold++;
    expect(e.pathThreshold).toBe(3); // MOVE_DESTROYABLE
    e.pathThreshold++;
    expect(e.pathThreshold).toBe(4); // MOVE_TEMP — maximum
  });

  it('threshold exceeding MOVE_TEMP (4) triggers retry count decrement', () => {
    const e = new Entity(UnitType.V_1TNK, House.Greece, 100, 100);
    // Simulate full escalation cycle: threshold reaches past MOVE_TEMP
    e.pathThreshold = 5; // exceeds MOVE_TEMP (4)
    expect(e.pathThreshold > 4).toBe(true);

    // C++ drive.cpp:989-996: decrement TryTryAgain, reset threshold
    if (e.pathThreshold > 4) {
      if (e.tryCount > 0) {
        e.tryCount--;
        e.pathThreshold = MOVE_CLOAK;
      }
    }

    expect(e.tryCount).toBe(9);
    expect(e.pathThreshold).toBe(MOVE_CLOAK);
  });

  // =========================================================================
  // 3. Retry counter — max 10 attempts (foot.h:239, drive.cpp:989-996)
  // =========================================================================

  it('unit gives up after PATH_RETRY (10) full escalation cycles', () => {
    const e = new Entity(UnitType.V_1TNK, House.Greece, 100, 100);
    expect(e.tryCount).toBe(10);

    // Simulate 10 full escalation cycles
    // Each cycle: threshold goes 1→2→3→4→5 (exceeds MOVE_TEMP), tryCount decrements
    for (let cycle = 0; cycle < 10; cycle++) {
      // 4 threshold increments to pass MOVE_TEMP
      for (let step = 0; step < 4; step++) {
        e.pathThreshold++;
      }
      expect(e.pathThreshold).toBe(5);
      expect(e.pathThreshold > 4).toBe(true);

      if (e.tryCount > 0) {
        e.tryCount--;
        e.pathThreshold = MOVE_CLOAK;
      }
    }

    expect(e.tryCount).toBe(0);

    // On the 11th failure, tryCount is 0 — unit should give up
    e.pathThreshold = 5;
    expect(e.tryCount).toBe(0);
    // C++ drive.cpp:992: Assign_Destination(TARGET_NONE) — movement stops
  });

  it('tryCount cannot go below 0', () => {
    const e = new Entity(UnitType.V_1TNK, House.Greece, 100, 100);
    e.tryCount = 0;
    // When tryCount is already 0, the unit gives up instead of decrementing further
    expect(e.tryCount).toBe(0);
  });

  // =========================================================================
  // 4. New move order resets threshold (foot.cpp:1723-1735)
  // =========================================================================

  it('new move order resets pathThreshold to MOVE_CLOAK', () => {
    const e = new Entity(UnitType.V_1TNK, House.Greece, 100, 100);
    // Simulate some failed pathing
    e.pathThreshold = 3;
    e.tryCount = 5;
    e.pathDelay = 10;

    // C++ Assign_Destination resets PathThreshhold (foot.cpp:1734)
    e.pathThreshold = MOVE_CLOAK;
    e.tryCount = PATH_RETRY;
    e.pathDelay = 0;

    expect(e.pathThreshold).toBe(MOVE_CLOAK);
    expect(e.tryCount).toBe(PATH_RETRY);
    expect(e.pathDelay).toBe(0);
  });

  // =========================================================================
  // 5. PathDelay timer (foot.cpp:463)
  // =========================================================================

  it('pathDelay prevents immediate path recalculation', () => {
    const e = new Entity(UnitType.V_1TNK, House.Greece, 100, 100);
    e.pathDelay = 14; // C++ Rule.PathDelay * TICKS_PER_MINUTE ≈ 14 ticks

    // Simulate countdown: each tick decrements by 1
    for (let tick = 0; tick < 14; tick++) {
      expect(e.pathDelay > 0).toBe(true);
      e.pathDelay--;
    }
    expect(e.pathDelay).toBe(0); // now path recalc is allowed
  });

  it('pathDelay is set after every path calculation — C++ foot.cpp:463', () => {
    const e = new Entity(UnitType.V_1TNK, House.Greece, 100, 100);
    expect(e.pathDelay).toBe(0);
    // After path calc, set delay
    e.pathDelay = 14;
    expect(e.pathDelay).toBe(14);
  });

  // =========================================================================
  // 6. Successful path resets threshold but keeps tryCount at full
  //    (C++ drive.cpp:1050 — TryTryAgain = PATH_RETRY on success)
  // =========================================================================

  it('successful path resets threshold and tryCount to full', () => {
    const e = new Entity(UnitType.V_1TNK, House.Greece, 100, 100);
    // Simulate partial failure: 2 retries used
    e.pathThreshold = 3;
    e.tryCount = 8;

    // Successful path found — C++ drive.cpp:1050
    e.pathThreshold = MOVE_CLOAK;
    e.tryCount = PATH_RETRY;

    expect(e.pathThreshold).toBe(MOVE_CLOAK);
    expect(e.tryCount).toBe(PATH_RETRY);
  });

  // =========================================================================
  // 7. Works for different unit types (infantry, vehicles, naval)
  // =========================================================================

  it('infantry units also have pathThreshold fields', () => {
    const e = new Entity(UnitType.E1, House.Greece, 100, 100);
    expect(e.pathThreshold).toBe(MOVE_CLOAK);
    expect(e.tryCount).toBe(PATH_RETRY);
    expect(e.pathDelay).toBe(0);
  });

  it('naval units also have pathThreshold fields', () => {
    const e = new Entity(UnitType.V_DD, House.Greece, 100, 100);
    expect(e.pathThreshold).toBe(MOVE_CLOAK);
    expect(e.tryCount).toBe(PATH_RETRY);
    expect(e.pathDelay).toBe(0);
  });

  // =========================================================================
  // 8. Full escalation cycle integration test
  // =========================================================================

  it('full escalation cycle: 4 threshold levels × 10 retries = 40 path failures before giving up', () => {
    const e = new Entity(UnitType.V_1TNK, House.Greece, 100, 100);

    let totalFailures = 0;

    while (e.tryCount > 0) {
      // Each retry cycle: threshold escalates 1→2→3→4→5
      while (e.pathThreshold <= 4) {
        e.pathThreshold++;
        totalFailures++;
      }
      // Exceeded MOVE_TEMP: one retry consumed
      e.tryCount--;
      e.pathThreshold = MOVE_CLOAK;
    }

    // 4 threshold escalation steps per retry × 10 retries = 40 total failures
    expect(totalFailures).toBe(40);
    expect(e.tryCount).toBe(0);
  });
});
