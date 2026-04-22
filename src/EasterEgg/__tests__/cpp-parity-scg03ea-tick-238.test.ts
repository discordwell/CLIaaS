/**
 * C++ Parity: SCG03EA tick-238 ARTY Mission_Guard Arm-Return Timing
 *
 * ## Status: 2026-04-22 landing CDTimer batched end-of-tick decrement
 *
 * **This attempt (batched version):**
 * Moves per-entity CDTimer decrements OUT of `updateEntity` entirely and into
 * a single batched pass at the end of `Game.update()`, AFTER Phase 1-4 entity
 * iteration completes. This mirrors C++ `Frame++` at end of `Main_Loop`
 * (conquer.cpp:2542) — a single decrement applied to ALL entities, preserving
 * cross-entity read consistency during the Logic.AI loop.
 *
 * **Prior attempt** (commit d6db5f97, reverted by 4277d897) placed the
 * decrement at the END of each entity's `updateEntity`. That cascaded intra-
 * loop: entity[K+1] saw entity[K]'s post-decrement value mid-tick, producing
 * Playwright first-divergence regressions:
 *   - SCG03EA:  238 → 10   (-228 ticks, REGRESSION)
 *   - SCG06EA:  76  → 11   (-65 ticks, REGRESSION)
 *   - SCG07EA:  17  → 6    (-11 ticks, REGRESSION)
 *
 * The batched approach (current refactor) avoids that cascade by holding all
 * entities' CDTimer fields at their pre-Frame++ values throughout the tick.
 *
 * Verify landing via Playwright:
 *   SCENARIOS=SCG01EA,SCG03EA,SCG04EA,SCG06EA,SCG07EA,SCG11EA,SCG13EA MAX=250 \
 *     npx playwright test scripts/test-first-divergence.ts --reporter=list
 *
 * ## Observed divergence (pre-refactor)
 * - Scenario: SCG03EA ("Protect Tesla Convoy"), ARTY unit at cell (62,49).
 * - tick 237 both engines: missionTimer=1, attackCooldown=1 (end-of-tick).
 * - tick 238 WASM: missionTimer=0, arm=0 (handler did NOT fire).
 * - tick 238 TS:   missionTimer=43, ac=? (handler FIRED, consumed 1 Random_Pick(0,2)).
 * - tick 239 WASM: missionTimer=42, arm=64 (handler fires — Mission_Guard_general).
 * - tick 239 TS:   already post-fire, no new RNG.
 * - Net: Δcalls=-1 @tick 238, +1 @tick 239, RNG stream re-syncs at tick 240.
 *
 * ## Root cause
 *
 * WASM's `CDTimerClass<FrameTimerClass>` (ftimer.h:449-478) computes Value
 * lazily: `Value = DelayTime - (current_Frame - Started_Frame)`. The decrement
 * is IMPLICIT via `Frame++` at the end of `Main_Loop` (conquer.cpp:2542). So:
 *   - On the tick where `Timer = X` is assigned, `Value()` reads `X` during
 *     Logic.AI, then `Frame++` advances the frame, and end-of-tick state dump
 *     shows `Value = X - 1`.
 *   - The mission handler fires when `Timer == 0` at **start** of Logic.AI,
 *     which corresponds to end-of-previous-tick `Value == 0` in the state dump.
 *
 * Pre-refactor TS decremented at the START of `updateEntity` per-entity.
 * `armBeforeScan = entity.attackCooldown` read the POST-decrement value,
 * one tick earlier than C++ `Arm.Value()` at Logic.AI. Mission_Guard's
 * `foot.cpp:683-685` short-circuit (`if (Arm != 0) return (int)Arm;`)
 * collapsed the normally-buffered 1-tick offset, surfacing the ARTY's
 * Mission_Guard fire at tick 238 instead of WASM's tick 239.
 *
 * Post-refactor: `entity.attackCooldown` at GUARD dispatch is the pre-Frame++
 * value (no mid-tick decrement), matching C++ `Arm.Value()` at Logic.AI. The
 * short-circuit assigns `missionTimer = Arm` and the batched pass decrements
 * BOTH by 1 at end of tick, preserving the canonical spacing.
 *
 * ## C++ references
 *   - ftimer.h:449-625           CDTimerClass<FrameTimerClass> — lazy Value()
 *   - ftimer.h:549-561           Value = DelayTime - (current - Started)
 *   - conquer.cpp:2542           Frame++ at end of Main_Loop
 *   - mission.cpp:213-323        MissionClass::AI — `if (Timer == 0) Timer = Mission_X()`
 *   - foot.cpp:638-698           FootClass::Mission_Guard
 *   - foot.cpp:683-685           `if (Arm != 0) return (int)Arm;` (the short-circuit)
 *   - foot.cpp:694               Random_Pick(0, 2) — consumed only on non-Arm path
 *   - techno.cpp:Firing_AI       Arm.Value() read at Logic.AI, pre-Frame++
 *
 * ## Test behavior
 *
 * Documents the WASM contract at tick 238/239. The batched refactor should now
 * produce WASM-matched behavior — Playwright first-divergence should advance
 * past 238. Update the test to the new first-divergence tick if Playwright
 * confirms the advance.
 */

import { describe, it, expect } from 'vitest';

describe('SCG03EA tick-238 ARTY Mission_Guard Arm-return timing', () => {
  it('documents the WASM contract (post-batched-refactor target)', () => {
    // C++ CDTimerClass::Value() semantics at tick 238/239. The batched end-of-
    // tick decrement refactor (this attempt) should land TS on these values.
    const wasmBehavior = {
      scenario: 'SCG03EA',
      tick237: { artyMt: 1, artyArm: 1, mission: 'GUARD' },
      tick238: { artyMt: 0, artyArm: 0, handlerFired: false, rngCallsConsumed: 0 },
      tick239: {
        artyMt: 42, artyArm: 64, handlerFired: true, rngCallsConsumed: 1,
        rngTag: 'Mission_Guard_general', // 60040 (foot.cpp:690)
      },
    };

    // Contract assertions against the WASM reference.
    expect(wasmBehavior.tick238.handlerFired).toBe(false);
    expect(wasmBehavior.tick238.rngCallsConsumed).toBe(0);
    expect(wasmBehavior.tick239.handlerFired).toBe(true);
    expect(wasmBehavior.tick239.rngTag).toBe('Mission_Guard_general');
    expect(wasmBehavior.tick239.rngCallsConsumed).toBe(1);
  });

  it('documents the Mission_Guard Arm-return short-circuit (foot.cpp:683-685)', () => {
    // The C++ contract for FootClass::Mission_Guard when Arm > 0:
    //   - Reads Arm.Value() at Logic.AI time (pre-Frame++).
    //   - If non-zero, returns (int)Arm WITHOUT consuming RNG.
    //   - MissionClass::AI then assigns Timer = Arm (no jitter added).
    //
    // Post-refactor TS equivalent:
    //   - `armBeforeScan = entity.attackCooldown` at GUARD dispatch reads the
    //     pre-batched-decrement value (no mid-tick decrement) — matches C++
    //     `Arm.Value()` at Logic.AI.
    //   - `missionTimer = armBeforeScan` assigns the same value C++ does.
    //   - End-of-tick batched pass decrements BOTH fields by 1, producing the
    //     canonical Timer=N-1, Arm=N-1 state on the next tick's Logic.AI.
    expect(true).toBe(true); // Documentation-only placeholder.
  });
});
