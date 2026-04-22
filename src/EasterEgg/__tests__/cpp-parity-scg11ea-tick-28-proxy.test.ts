/**
 * C++ Parity: SCG11EA tick-28 MCV Mission_Move — narrow-proxy feasibility study
 *
 * This test is the output of a SECOND investigation into the SCG11EA tick-28
 * blocker (the first was captured in `cpp-parity-scg11ea-tick-28.test.ts`).
 * Per agent a9b5cb47, the prior attempt at a naive per-cell Commence port
 * was rolled back; scaffolding was landed in commit 80bf5b8e with the
 * Commence gate disabled (`PER_CELL_COMMENCE_ENABLED=false`).
 *
 * The user asked: can a NARROW proxy (SCG07EA-style, `nonInterruptAnimTicks`
 * gated on `UnitType.I_MCV` + pre-aligned spawn facing + non-reinforceable
 * team) reproduce WASM's 3-call tick-28 pattern without cascading?
 *
 * The answer is **no**. This test captures the three empirical reasons
 * that ruled out a narrow proxy so future agents don't re-attempt it.
 *
 * -------------------------------------------------------------------------
 * ## Evidence 1 — per-entity RNG tag counts at tick 28
 *
 * `SCENARIO=SCG11EA START=1 END=30 DUMP_ALL=1 scripts/test-rng-entity-diff.ts`
 *
 * Tick 28 WASM log (pre-seed 785179212, post-seed 3006003099):
 *   [0] Mission_Move_foot  stag=60010  ent=unit[156]   seed=2901914261
 *   [1] Mission_Move_foot  stag=60010  ent=unit[157]   seed=303996842
 *   [2] Mission_Move_foot  stag=60010  ent=unit[157]   seed=3006003099   ← DOUBLE
 *
 * MCV-156 fires Mission_Move once; MCV-157 fires it TWICE in the same
 * obj->AI() call. This is the unchanged double-fire mystery from the
 * prior investigation.
 *
 * -------------------------------------------------------------------------
 * ## Evidence 2 — Mission_Guard double-fire at tick 1 (symmetric)
 *
 * Tick 1 WASM log tail:
 *   [136] Mission_Guard_general  stag=60040  ent=unit[156]  ← (1)
 *   [137] Mission_Guard_general  stag=60040  ent=unit[156]  ← DOUBLE
 *   [138] Mission_Guard_general  stag=60040  ent=unit[157]  ← (1)
 *
 * MCV-156 double-fires Mission_Guard at tick 1; MCV-157 single-fires.
 * At tick 28 the pattern FLIPS: MCV-156 single-fires Mission_Move,
 * MCV-157 double-fires. This rules out hypotheses tied to a specific
 * Logic-index position (e.g., "always the first MCV doubles"). It is
 * not a stable per-unit property; it alternates.
 *
 * Combined with tick 1's Mission_Guard double, the C++ mechanism must
 * allow double-MissionClass::AI dispatch for MissionControl[Mission] timers
 * in ANY mission state — not just MOVE.
 *
 * -------------------------------------------------------------------------
 * ## Evidence 3 — Commence fires at tick 27, not at first cell boundary
 *
 * `scripts/test-scg11ea-mcv-trace.ts` per-tick coord dump (WASM only):
 *
 *   tick | MCV-156 (west)                       | MCV-157 (east)
 *        | ly      cell    m  mt drv  mq  nav   | ly      cell    m  mt drv  mq  nav
 *   1    | 26752   (22,104) 5  41 T    2   ...  | 26752   (28,104) 5  41 T    2   ...
 *   13   | 26631   (22,104) 5  29 T    2   ...  | 26631   (28,104) 5  29 T    2   ...
 *   14   | 26620   (22,103) 5  28 T    2   ...  | 26620   (28,103) 5  28 T    2   ... ← cell boundary
 *   26   | 26499   (22,103) 5  16 T    2   ...  | 26499   (28,103) 5  16 T    2   ...
 *   27   | 26496   (22,103) 2   0 T   -1   ...  | 26496   (28,103) 2   0 T   -1   ... ← Commence
 *   28   | 26485   (22,103) 2  13 T   -1   ...  | 26485   (28,103) 2  14 T   -1   ... ← Mission_Move
 *
 * Key facts:
 *   - Mission=5 (GUARD) → Mission=2 (MOVE) happens at tick 27, NOT tick 14.
 *   - The MCVs CROSSED cell (104→103) at tick 14 but Commence did NOT pop
 *     MissionQueue there. mq stays =2 (MOVE queued) through tick 26.
 *   - Commence fires at tick 27 (13 ticks AFTER first cell boundary), and
 *     Mission_Move jitter is consumed at tick 28 (Timer 0 at tick 27 end
 *     → fires start of next AI, sets Timer to Normal_Delay+jitter = 14+0..2
 *     → MCV-156 mt=13 (after 1-tick decrement, jitter=0), MCV-157 mt=14
 *     (jitter=1 from the second of its two Random_Picks — the earlier draw
 *     is overwritten by the later).
 *
 * This means the C++ Commence-on-PCP_END is NOT triggered by the FIRST
 * cell boundary at tick 14. A narrow proxy keyed on "first cell crossed"
 * would fire 13 ticks early. The ACTUAL trigger is some later track
 * endpoint at tick 27 — not a plain cell crossing.
 *
 * Likely mechanism: the 3-cell path (waypoint 26=(22,100) from spawn
 * (22,103), delta 3N) is executed as a sequence of 2-cell LONG tracks +
 * 1-cell SHORT tracks. Per `drive.cpp:735-742`, PCP_DURING fires at the
 * MIDPOINT of a long 2-cell track (no Commence — just crush/scan); PCP_END
 * fires at TRACK COMPLETION (drive.cpp:816), which is the END of the
 * track, NOT necessarily at the cell boundary. Whether a short or long
 * track is selected depends on Path[0]×Path[1] lookup (drive.cpp:707-712
 * `adj = Dir_Facing(track->Facing) != Path[0]`). For a straight-north
 * path, short tracks are likely back-to-back; but INITIAL drive starts
 * with Start_Of_Move's smooth-start track which is longer.
 *
 * Confirming this requires per-cell WASM instrumentation (rebuild with
 * agent_debug_log in Per_Cell_Process), which is out of scope for this
 * investigation.
 *
 * -------------------------------------------------------------------------
 * ## Why a narrow proxy cannot work
 *
 * A narrow proxy (UnitType.I_MCV + CREATE_TEAM + non-reinforceable +
 * pre-aligned spawn facing) would need to:
 *
 *   1. Know the EXACT tick delay from activation to first Commence fire
 *      (27 ticks for SCG11EA, but this is speed-×-map-geometry dependent
 *      — other scenarios with different MCV spawn/waypoints would diverge).
 *   2. Reproduce the MCV-157 double-fire, which requires modelling the
 *      `DriveClass::AI` post-While_Moving re-entry (drive.cpp:1340-1345).
 *      This is a cross-cutting movement refactor, not a narrow gate.
 *   3. NOT cascade into SCG04EA tick-36 (same root cause, different
 *      path geometry) or SCG13EA tick-101 (MOVE→GUARD mid-drive).
 *
 * Items 1 + 2 are mutually reinforcing: without the double-cycle, even a
 * hardcoded 27-tick delay would produce 2 RNG calls at tick 28, not 3 —
 * leaving seed drift starting at tick 28 itself. Items 2 + 3 require the
 * full `Per_Cell_Process` port documented in `perCellProcess.ts`.
 *
 * Decision: keep `PER_CELL_COMMENCE_ENABLED=false`. Document the blocker
 * so a future architectural port has complete evidence.
 *
 * -------------------------------------------------------------------------
 * ## C++ references
 *   - drive.cpp:661-834    While_Moving (per-track movement + PCP_END dispatch)
 *   - drive.cpp:735-742    PCP_DURING at track midpoint (crush + scan, no Commence)
 *   - drive.cpp:816        PCP_END at track endpoint (calls UnitClass::Per_Cell_Process)
 *   - drive.cpp:1304-1399  DriveClass::AI (double-cycle: 1340-1345 re-enters Start_Of_Move)
 *   - unit.cpp:406,473     UnitClass::AI pre/post Commence bookends (gated !IsDriving)
 *   - unit.cpp:1756        UnitClass::Per_Cell_Process Commence (the load-bearing call)
 *   - foot.cpp:520-540     FootClass::Mission_Move (Random_Pick(0,2) at tag=60010)
 *   - foot.cpp:638-698     FootClass::Mission_Guard (Random_Pick(0,2) at tag=60040)
 *
 * ## TS references
 *   - engine/perCellProcess.ts                     PER_CELL_COMMENCE_ENABLED=false gate
 *   - engine/index.ts:3995-4010                    pre-Commence gate (skips when isDriving)
 *   - engine/index.ts:5484-5486                    perCellNavComCheck hook delegation
 *   - engine/team.ts:815-946                       coordinateMove eager isDriving
 *   - __tests__/cpp-parity-scg11ea-tick-28.test.ts First investigation (architectural)
 *   - __tests__/per-cell-process-scaffolding.test.ts Scaffolding contract
 *
 * Reproduce:
 *   SCENARIO=SCG11EA START=1 END=30 DUMP_ALL=1 \
 *     npx playwright test scripts/test-rng-entity-diff.ts
 *   npx playwright test scripts/test-scg11ea-mcv-trace.ts
 */

import { describe, it, expect } from 'vitest';
import { PER_CELL_COMMENCE_ENABLED } from '../engine/perCellProcess';

describe('SCG11EA tick-28 MCV Mission_Move — narrow-proxy feasibility (architectural blocker)', () => {
  it('scaffolding gate now ENABLED — partial Commence port landed', () => {
    // Post-port status (SCG11EA tick-28 investigation):
    //   - The gate is enabled: Commence fires at every PCP_END boundary
    //     via `unitPerCellProcess` (engine/perCellProcess.ts:195+).
    //   - For MCV reinforcements with MissionQueue=MOVE, the first
    //     track-end cell boundary pops the queue → next tick's
    //     MissionClass::AI fires Mission_Move with Random_Pick(0,2) and
    //     consumes 1 RNG (tag 60010). This closes the MCV-156 single-fire.
    //   - The MCV-157 DOUBLE-fire remains UNEXPLAINED (DriveClass::AI
    //     drive.cpp:1340-1345 double-cycle suspected, not yet ported).
    //     Expect 1/2 of WASM's tick-28 RNG (2 of 3 calls) after this
    //     partial port; SCG11EA first-divergence moves from tick 28 to a
    //     later tick reflecting the residual double-fire gap.
    expect(PER_CELL_COMMENCE_ENABLED).toBe(true);
  });

  it('documents per-entity RNG tag counts at tick 28 (WASM contract)', () => {
    // WASM tick-28 rngLog: 3 Mission_Move_foot (tag 60010) entries.
    // Distribution: MCV-156 once, MCV-157 TWICE.
    const wasmTick28 = [
      { entity: 'unit[156]', tag: 60010, seed: 2901914261 }, // MCV-156 Mission_Move #1
      { entity: 'unit[157]', tag: 60010, seed: 303996842 },  // MCV-157 Mission_Move #1
      { entity: 'unit[157]', tag: 60010, seed: 3006003099 }, // MCV-157 Mission_Move #2 (double)
    ];
    const counts = new Map<string, number>();
    for (const e of wasmTick28) {
      counts.set(e.entity, (counts.get(e.entity) ?? 0) + 1);
    }
    expect(counts.get('unit[156]')).toBe(1);
    expect(counts.get('unit[157]')).toBe(2); // The load-bearing double-fire
    expect(wasmTick28.length).toBe(3);
    expect(wasmTick28[wasmTick28.length - 1].seed).toBe(3006003099); // post-tick seed
  });

  it('documents the symmetric tick-1 Mission_Guard double-fire (rules out index-ordering theory)', () => {
    // At tick 1 (team activation), MCV-156 fires Mission_Guard_general
    // TWICE, MCV-157 ONCE. At tick 28 the pattern inverts. Whatever
    // causes the double-fire is neither (a) a stable "first unit"
    // property nor (b) tied to the MOVE mission. It fires under GUARD
    // too, and it alternates across ticks.
    //
    // This rules out theories that tried to pin the double-fire on a
    // specific Logic-loop iteration order, team-iteration position,
    // or Mission.MOVE path reservation. The mechanism must be in a
    // shared code path that BOTH Mission_Move and Mission_Guard reach,
    // AND that fires twice for different MCVs on different ticks.
    //
    // Most plausible: DriveClass::AI re-entry after While_Moving
    // (drive.cpp:1340-1345) dispatches MissionClass::AI twice when the
    // current track completes AND NavCom/path still require movement,
    // with Start_Of_Move flipping Mission's Timer back to 0. Confirming
    // this requires single-step C++ instrumentation.
    const wasmTick1Tail = [
      { entity: 'unit[156]', tag: 60040 }, // MCV-156 Mission_Guard #1
      { entity: 'unit[156]', tag: 60040 }, // MCV-156 Mission_Guard #2 (double)
      { entity: 'unit[157]', tag: 60040 }, // MCV-157 Mission_Guard #1
    ];
    const tick1Counts = new Map<string, number>();
    for (const e of wasmTick1Tail) {
      tick1Counts.set(e.entity, (tick1Counts.get(e.entity) ?? 0) + 1);
    }
    // Tick 1: MCV-156 doubles.
    expect(tick1Counts.get('unit[156]')).toBe(2);
    expect(tick1Counts.get('unit[157]')).toBe(1);
    // Tick 28: pattern INVERTS (MCV-157 doubles).
    // Verified above in the tick-28 test.
  });

  it('documents the tick-27 Commence trigger vs tick-14 cell boundary (13-tick gap)', () => {
    // Per-tick coord trace (WASM) — MCV-156 state:
    //   tick | ly      cy   m   mt  drv  mq   notes
    //   1    | 26752   104  5   41  T    2    spawn, GUARD, MOVE queued
    //   13   | 26631   104  5   29  T    2    same cell
    //   14   | 26620   103  5   28  T    2    CROSSED cell boundary, mq STILL =2
    //   26   | 26499   103  5   16  T    2    still GUARD, mq still queued
    //   27   | 26496   103  2    0  T   -1    Commence fired → Mission=MOVE
    //   28   | 26485   103  2   13  T   -1    Mission_Move fired, Timer=Normal_Delay+jitter
    const mcv156 = {
      tick14: { cy: 103, mission: 5 /* GUARD */, mq: 2 /* MOVE */, cellJustCrossed: true },
      tick27: { cy: 103, mission: 2 /* MOVE */, mq: -1 /* NONE */, missionTimer: 0 },
      tick28: { cy: 103, mission: 2, mq: -1, missionTimer: 13 /* jitter=0, 1-tick decrement */ },
    };
    // Critical invariant: first cell boundary crossing (tick 14) does NOT
    // pop MissionQueue. Commence fires 13 ticks later at tick 27.
    expect(mcv156.tick14.mq).toBe(2);        // Still queued after cell boundary
    expect(mcv156.tick27.mq).toBe(-1);       // Popped by Commence
    expect(mcv156.tick27.missionTimer).toBe(0); // Commence zeroes Timer
    // A narrow proxy keyed on "first cell crossed" would fire at tick 14
    // (13 ticks early). A proxy keyed on "after N ticks of driving" would
    // need N=26 here, but N is path-length × speed dependent — not a
    // universal constant across SCG04/11/13.
    const firstBoundaryTick = 14;
    const commenceTick = 27;
    expect(commenceTick - firstBoundaryTick).toBe(13); // Gap that rules out boundary-based proxy
  });

  it('documents the three reasons a narrow proxy cannot land', () => {
    const blockers = {
      unexplainedDoubleFire: {
        symptom: 'MCV-157 fires Mission_Move twice at tick 28; MCV-156 fires Mission_Guard twice at tick 1',
        likelyMechanism: 'DriveClass::AI re-entry (drive.cpp:1340-1345): post-While_Moving, if TrackNumber==-1 and NavCom/path still valid, Start_Of_Move() + While_Moving() run AGAIN. MissionClass::AI dispatch may fire twice within one obj->AI() call.',
        confirmationCost: 'Requires WASM rebuild with single-step instrumentation in drive.cpp / mission.cpp — out of scope.',
      },
      noUniversalTickDelay: {
        symptom: 'Commence fires at tick 27, 13 ticks after the first cell boundary (tick 14)',
        likelyMechanism: 'C++ Per_Cell_Process(PCP_END) fires at TRACK endpoint (drive.cpp:816), not every cell boundary. Short 1-cell tracks vs long 2-cell tracks vs smooth-start tracks all have different endpoint timings.',
        narrowProxyImpact: 'Hardcoding N=27 ticks works for SCG11EA but not SCG04EA tick-36 or SCG13EA tick-101, which have different path geometries. Any proxy would either miss first-divergence targets or cascade into other scenarios.',
      },
      crossCuttingRefactor: {
        symptom: 'A correct port must modify updateMove, updateGuard, team.ts coordinateMove, AND the eager isDriving flag path',
        cascadeRisk: 'All 7 scenarios rely on current movement semantics. Prior naive port introduced 5 new divergent ticks in SCG11EA 29-33 alone.',
      },
    };
    expect(blockers.unexplainedDoubleFire.symptom).toContain('twice');
    expect(blockers.noUniversalTickDelay.narrowProxyImpact).toContain('cascade');
    expect(blockers.crossCuttingRefactor.cascadeRisk).toContain('divergent');
  });
});
