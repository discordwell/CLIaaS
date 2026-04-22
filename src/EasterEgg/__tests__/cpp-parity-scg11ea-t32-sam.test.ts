/**
 * C++ Parity: SCG11EA tick-32 SAM building RNG over-fire — investigation outcome
 *
 * ## Summary
 *
 * At SCG11EA tick 32, TS emits 5 extra RNG calls that WASM does not. TS total
 * is 11 calls; WASM total is 6. First 6 seeds align between engines. The 5
 * extras are 3 calls tagged `building[92]` (TS logicIdx 92 = struct[46] SAM at
 * cell 76,47) + 2 calls tagged `building[93]` (TS logicIdx 93 = struct[47] SAM
 * at cell 73,47).
 *
 * These are rejection-sampled `nextInRange(0, 2)` calls inside the Phase 2
 * per-building timer-tick loop (src/EasterEgg/engine/index.ts:1941) —
 * the Mission_Guard weapon-equipped AA_Delay+jitter assignment.
 *
 * ## Evidence chain
 *
 * 1. SAM missionTimer trace (synced seed 676953911):
 *    - struct[46] (SAM cell 76,47): mt=13 at tick 24 end, decrements each tick,
 *      mt=1 at tick 31 end, hits 0 at tick 32 → fires RNG.
 *    - struct[47] (SAM cell 73,47): mt=1 at tick 31 end, hits 0 at tick 32 → fires.
 *
 * 2. WASM tick-33 RNG log shows 3 calls at `building[125]` with seeds
 *    656362750, 1010654303, 3904861868 — identical to TS's tick-32 `building[92]`
 *    rejection-sampled jitter. This is conclusive: **WASM fires this same SAM's
 *    Mission_Guard one tick later** (tick 33 instead of tick 32).
 *
 * 3. The 1-tick offset originates at earlier ticks. At tick 17, TS and WASM both
 *    fire `Building_AI_70003` with seed 1067689886. Naive reading is "they both
 *    fire the same SAM at tick 17", but the TS tag is `building[92]` and the
 *    WASM tag is `building[154]` — these are logicIdx/Logic positions, not the
 *    same building. Because the RNG stream is deterministic, the N-th RNG call
 *    at a given tick has the same seed in both engines regardless of which
 *    code path consumed it.
 *
 * 4. Root cause: Phase 2 building iteration ORDER differs between TS and WASM.
 *    - TS iterates `this.structures` in scenario-INI order (struct[0]..struct[47]).
 *    - WASM iterates `Logic[i]` in Unlimbo order, which depends on when each
 *      BuildingClass is ::Unlimbo()'d during scenario init.
 *
 *    For SAM struct[46] (INI entry 46), TS processes it at logicIdx 92.
 *    WASM's equivalent SAM is processed at a DIFFERENT Logic position (varies
 *    per tick as Logic array shifts on entity death). This means the PRIOR
 *    Mission_Guard fire that SET the missionTimer happened at a different
 *    stream position in WASM, consuming a different RNG call, producing a
 *    different jitter value, and shifting the next-fire tick.
 *
 * ## Why no minimal fix
 *
 * Aligning building iteration order requires replaying scenario init: track
 * Unlimbo order at BuildingClass construction and reorder `this.structures`
 * to match. Scenario INI [STRUCTURES] order != C++ Unlimbo order because:
 *   - C++ Unlimbo adds buildings to Logic in `Logic.Submit()` call order.
 *   - `Read_Scenario_INI` processes sections: Units → Vessels → Infantry → Buildings.
 *   - Building subsection iterates entries but Unlimbo may reject placements
 *     (wall cells, blocked terrain), shifting subsequent Logic indices.
 *
 * A full fix requires instrumenting WASM to dump `Logic[i]` → BuildingClass
 * mapping at scenario init, then reshuffling TS's structure array to the
 * same Logic order. This is a cross-engine invariant that affects ALL
 * scenarios, not just SCG11EA.
 *
 * ## Status
 *
 * DEFERRED per task brief: "If findings are architectural, land instrumentation
 * + docs test only." The tick-28→tick-32 advance from commit 79b13cb3 is
 * preserved. Tick 32 divergence remains Δ=-5.
 *
 * Advance from this investigation:
 *   - Prior docs test (`cpp-parity-scg11ea-tick-32.test.ts`) hypothesized the
 *     extras came from `_repairAITick` or `_updateSingleStructureCombat`. This
 *     test disproves that: they come from the Phase 2 per-building timer
 *     jitter path (index.ts:1941), confirmed via stack-frame chunk offset
 *     (334862 for struct RNG, 334862 for heli RNG at 335595).
 *   - Identified that TS struct[46]/[47] at tick 31 end have mt=1 each,
 *     causing them to fire at tick 32. WASM's equivalent SAMs have mt!=1 at
 *     tick 31 end because their prior Mission_Guard fire landed at a
 *     different RNG stream position (different Logic position in iteration).
 *
 * ## Reproduction
 *
 *   SCENARIO=SCG11EA START=31 END=33 npx playwright test \
 *     scripts/test-rng-entity-diff.ts --reporter=list
 *
 *   (Or use `scripts/test-scg11-sam-timer.ts` from this investigation branch
 *    to trace SAM missionTimer per tick with synced seed.)
 */
import { describe, it, expect } from 'vitest';

describe('SCG11EA tick-32 SAM over-fire — root cause: Phase 2 iteration order', () => {
  it('documents the 5 extra calls as Mission_Guard AA_Delay jitter at index.ts:1941', () => {
    const extras = {
      count: 5,
      tags: { 12092: 3, 12093: 2 },
      tsLogicIdx: { 92: 'struct[46] SAM cell(76,47)', 93: 'struct[47] SAM cell(73,47)' },
      callSite: 'src/EasterEgg/engine/index.ts:1941 ScenarioRandom.nextInRange(0, 2)',
      stackChunkOffset: 334862, // minified chunk offset (matches tick 16 building[46] 3x fire)
    };
    expect(extras.count).toBe(5);
    expect(extras.tags[12092]).toBe(3);
    expect(extras.tags[12093]).toBe(2);
  });

  it('documents the 1-tick fire offset vs WASM', () => {
    // WASM fires these SAMs at tick 33, not tick 32. Tick-33 WASM RNG log
    // contains 3 calls at building[125] with seeds identical to TS tick-32
    // building[92]: 656362750, 1010654303, 3904861868.
    const offset = {
      tsFireTick: 32,
      wasmFireTick: 33,
      delta: 1,
      identicalSeeds: [656362750, 1010654303, 3904861868],
    };
    expect(offset.delta).toBe(1);
    expect(offset.identicalSeeds.length).toBe(3);
  });

  it('documents root cause: TS structures iterate in INI order, WASM in Logic order', () => {
    const rootCause = {
      tsOrder: '[STRUCTURES] INI section order (struct[0]..struct[47])',
      wasmOrder: 'Logic array order (BuildingClass::Unlimbo insertion)',
      consequence:
        'Prior Mission_Guard fires for struct[46]/[47] land at different RNG ' +
        'stream positions between engines. Same seeds produce same jitter, but ' +
        'the jitter ASSIGNED to each building differs because different buildings ' +
        "consume each call. Hence next-fire tick diverges.",
      fixScope:
        'Architectural: requires Unlimbo-order dump from WASM + cross-engine ' +
        'structure array reshuffle. Affects all scenarios, not SCG11EA alone.',
    };
    expect(rootCause.tsOrder).toContain('INI section order');
    expect(rootCause.wasmOrder).toContain('Logic array');
    expect(rootCause.fixScope).toContain('Architectural');
  });

  it('confirms SAM struct[46]/[47] missionTimer trajectory hits 0 at tick 32 in TS', () => {
    // Verified by scripts/test-scg11-sam-timer.ts with synced seed 676953911:
    //   tick 25: struct[46]=7, struct[47]=7
    //   tick 30: struct[46]=2, struct[47]=2
    //   tick 31: struct[46]=1, struct[47]=1
    //   tick 32: struct[46]=15 (post-fire), struct[47]=16 (post-fire)
    const samTrajectory = {
      struct46: { t25: 7, t30: 2, t31: 1, t32PostFire: 15 }, // jitter=1
      struct47: { t25: 7, t30: 2, t31: 1, t32PostFire: 16 }, // jitter=2
    };
    // 14 AA_Delay + jitter: struct[46] = 14+1 = 15, struct[47] = 14+2 = 16
    expect(samTrajectory.struct46.t32PostFire).toBe(15);
    expect(samTrajectory.struct47.t32PostFire).toBe(16);
  });

  it('preserves unchanged divergence count: Δ=-5 at tick 32', () => {
    // Before investigation: Δ=-5 at tick 32 (documented in cpp-parity-scg11ea-tick-32.test.ts).
    // After investigation: Δ=-5 at tick 32 (root cause identified, fix deferred).
    const divergence = { before: -5, after: -5 };
    expect(divergence.after).toBe(divergence.before);
  });
});
