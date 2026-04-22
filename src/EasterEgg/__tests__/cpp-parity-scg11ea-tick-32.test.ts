/**
 * C++ Parity: SCG11EA tick-32 SAM building RNG over-fire (documentation, investigation deferred)
 *
 * ## Observed divergence
 * - Scenario: SCG11EA ("coast chain"). After commit 79b13cb3 landed the
 *   same-tick post-Commence dispatch fix, first-divergence advanced from
 *   tick 28 → tick 32.
 * - At tick 32: WASM fires 6 RNG calls, TS fires 11 RNG calls. Δ = -5.
 * - Pre-tick seeds MATCH. The first 6 TS RNG calls match WASM seeds 1-for-1
 *   (tag metadata differs — WASM uses `Building_AI_70003`, TS uses the
 *   outer logic-index tag `12000+logicIdx` — but the seed stream is aligned).
 *
 * ## The 5 extra TS calls
 * TS RNG log at tick 32 (seeds after each next() call, source tag):
 *
 *   [0] building[45]    seed=222435604   stag=12045   ← matches WASM[0]
 *   [1] building[61]    seed=1111553469  stag=12061   ← matches WASM[1]
 *   [2] aircraft[69]    seed=230057906   stag=13069   ← matches WASM[2] (HPAD heli)
 *   [3] building[81]    seed=3488518915  stag=12081   ← matches WASM[3]
 *   [4] building[82]    seed=2964435584  stag=12082   ← matches WASM[4]
 *   [5] aircraft[87]    seed=4010553529  stag=13087   ← matches WASM[5] (HPAD heli)
 *   [6] building[92]    seed=656362750   stag=12092   ← EXTRA (no WASM counterpart)
 *   [7] building[92]    seed=1010654303  stag=12092   ← EXTRA
 *   [8] building[92]    seed=3904861868  stag=12092   ← EXTRA
 *   [9] building[93]    seed=3837140853  stag=12093   ← EXTRA
 *   [10] building[93]   seed=3902749450  stag=12093   ← EXTRA
 *
 * logicIdx-to-structure mapping at tick 32 (phase 1: 44 non-air pre-building
 * entities + phase 2: structures with HPAD heli interleave):
 *   - logicIdx=92 → structures[46] = SAM USSR (missionTimer=13 at tick-31 end)
 *   - logicIdx=93 → structures[47] = SAM USSR (missionTimer=15 at tick-31 end)
 *
 * At tick 32, both SAMs decrement to 12/14 respectively — NOT reaching 0 —
 * so the Mission_Guard jitter `Random_Pick(0,2)` should NOT fire. Yet TS
 * produces 5 next() calls across these two buildings.
 *
 * Given `nextInRange` uses rejection sampling (random.ts:93), one
 * `nextInRange(lo, hi)` call can produce multiple `next()` calls when the
 * drawn value exceeds magnitude. Most plausible sources:
 *   - A high-magnitude nextInRange call that rejects multiple times, OR
 *   - Multiple distinct nextInRange calls inside `_updateSingleStructureCombat`
 *     / `_repairAITick` / splash-damage path.
 *
 * The SAMs are at full HP (400/400) at tick 31 so `_repairAITick` should
 * early-return. The HINDs that SAMs would target are `aircraftState=landed`
 * with `flightAltitude=0` so `_updateSingleStructureCombat` should skip them
 * (combat.ts:1842 — SAMs require `isAirUnit && flightAltitude > 0`).
 * Neither path is visibly reachable in TS — yet RNG fires.
 *
 * ## Hypothesis — pre-existing building AI ordering / state mismatch
 *
 * This is NOT a regression from commit 79b13cb3 (same-tick post-Commence
 * dispatch). That fix modified `updateEntity` for ground units to consume
 * Mission_Move jitter (tag 60010). The tick-32 extras are BUILDING-tagged
 * (12092/12093) and come from the structures-phase path.
 *
 * The divergence is pre-existing building AI state — likely one of:
 *   a) A structure in TS's structures array that doesn't exist (or is dead
 *      /inLimbo) in the corresponding WASM Logic position, shifting indices.
 *   b) A damage/retaliation/scatter feedback loop inside
 *      `_updateSingleStructureCombat` that fires RNG for a target TS sees
 *      (e.g. some unit briefly at altitude>0) but WASM doesn't.
 *   c) `_repairAITick` actually firing despite HP=maxHp (regressed by some
 *      prior change; requires direct instrumentation to confirm).
 *
 * Resolving this requires browser-side instrumentation of the
 * per-`next()` call site (Error.stack with sourcemaps against the non-
 * minified build, or inline debug logs around each Phase 2 RNG call).
 *
 * ## Status
 *
 * DEFERRED. The tick-28 → tick-32 advance delivered by 79b13cb3 is kept.
 * Narrowing the same-tick dispatch to "only when NavCom at cell" or
 * "only for MCV type" does NOT help — this divergence is in a DIFFERENT
 * code path (building phase, not ground-unit updateEntity).
 *
 * The task brief explicitly allows deferral: "Accuracy over metric. If
 * narrowing breaks the 28→32 fix, document + defer — the tick-28 win is
 * worth more than gambling on tick 32."
 *
 * This file preserves the evidence for a future investigation session.
 *
 * Diagnostic command to reproduce:
 *   SCENARIO=SCG11EA START=31 END=33 npx playwright test \
 *     scripts/test-rng-entity-diff.ts --reporter=list
 */
import { describe, it, expect } from 'vitest';

describe('SCG11EA tick-32 first-divergence — SAM building RNG over-fire', () => {
  it('documents the 5 extra TS RNG calls at tick 32 (Δ=-5 vs WASM)', () => {
    const divergence = {
      tick: 32,
      wasmCalls: 6,
      tsCalls: 11,
      delta: -5,
      wasmPostTickSeed: 4010553529,
      tsPostTickSeed: 3902749450,
      seedsMatchForFirstN: 6,
    };
    expect(divergence.wasmCalls).toBe(6);
    expect(divergence.tsCalls).toBe(11);
    expect(divergence.delta).toBe(divergence.wasmCalls - divergence.tsCalls);
    expect(divergence.seedsMatchForFirstN).toBe(divergence.wasmCalls);
  });

  it('documents logicIdx-to-structure mapping at tick 32', () => {
    // Phase 1: 44 non-air pre-building entities (logicIdx 0-43)
    // Phase 2: 48 structures with HPAD heli interleave taking +1 each
    //   struct[0]...struct[24]=HPAD+heli...struct[41]=HPAD+heli...struct[47]
    // → struct[46] sits at logicIdx = 44 + 46 + 2 (heli hops) = 92
    // → struct[47] sits at logicIdx = 44 + 47 + 2 (heli hops) = 93
    const mapping = {
      logicIdx92: { structIdx: 46, type: 'SAM', house: 'USSR', missionTimerAt31End: 13 },
      logicIdx93: { structIdx: 47, type: 'SAM', house: 'USSR', missionTimerAt31End: 15 },
      // SAMs are weapon-equipped — in C++ BuildingClass::Mission_Guard weapon
      // branch fires Random_Pick(0,2) only when timer expires (MissionClass::AI)
      // AND no target found. At tick 32, these mt values decrement to 12/14,
      // not reaching 0 → Mission_Guard should NOT be invoked → NO RNG.
      tickTimerDecrement: { struct46: { from: 13, to: 12 }, struct47: { from: 15, to: 14 } },
    };
    expect(mapping.logicIdx92.structIdx).toBe(46);
    expect(mapping.logicIdx93.structIdx).toBe(47);
    expect(mapping.tickTimerDecrement.struct46.to).toBeGreaterThan(0); // should NOT fire
    expect(mapping.tickTimerDecrement.struct47.to).toBeGreaterThan(0); // should NOT fire
  });

  it('documents deferral rationale — tick-28 win > tick-32 speculation', () => {
    const rationale = {
      priorFix: '79b13cb3',
      priorFixImpact: 'SCG11EA: 28 → 32 (+4 ticks)',
      priorFixScope: 'updateEntity ground-unit Mission_Move dispatch (tag 60010)',
      tick32ExtraScope: 'Phase 2 building RNG (tag 12000+logicIdx)',
      conclusion: 'Different code path — 79b13cb3 narrowing would NOT help tick 32',
      decision: 'defer tick-32 fix; preserve tick-28 fix',
      taskBriefGuidance:
        'Accuracy over metric. If narrowing breaks the 28→32 fix, document + defer.',
    };
    expect(rationale.priorFix).toBe('79b13cb3');
    expect(rationale.decision).toBe('defer tick-32 fix; preserve tick-28 fix');
  });

  it('captures the exact RNG log entries for reproducibility', () => {
    // Tagged RNG log at tick 32 (seed after next(), source tag).
    // The first 6 entries MATCH WASM 1-for-1; entries 6-10 are TS-only.
    const tsLog = [
      { idx: 0, tag: 12045, seed: 222435604, matchesWasm: true },
      { idx: 1, tag: 12061, seed: 1111553469, matchesWasm: true },
      { idx: 2, tag: 13069, seed: 230057906, matchesWasm: true }, // HPAD heli
      { idx: 3, tag: 12081, seed: 3488518915, matchesWasm: true },
      { idx: 4, tag: 12082, seed: 2964435584, matchesWasm: true },
      { idx: 5, tag: 13087, seed: 4010553529, matchesWasm: true }, // HPAD heli
      { idx: 6, tag: 12092, seed: 656362750, matchesWasm: false }, // EXTRA
      { idx: 7, tag: 12092, seed: 1010654303, matchesWasm: false }, // EXTRA
      { idx: 8, tag: 12092, seed: 3904861868, matchesWasm: false }, // EXTRA
      { idx: 9, tag: 12093, seed: 3837140853, matchesWasm: false }, // EXTRA
      { idx: 10, tag: 12093, seed: 3902749450, matchesWasm: false }, // EXTRA
    ];
    expect(tsLog.length).toBe(11);
    expect(tsLog.filter(e => e.matchesWasm).length).toBe(6);
    expect(tsLog.filter(e => !e.matchesWasm).length).toBe(5);

    // Extras cluster on two structures — tag 12092 (3x) and 12093 (2x).
    const extras = tsLog.filter(e => !e.matchesWasm);
    const byTag = new Map<number, number>();
    for (const e of extras) byTag.set(e.tag, (byTag.get(e.tag) ?? 0) + 1);
    expect(byTag.get(12092)).toBe(3);
    expect(byTag.get(12093)).toBe(2);
  });
});
