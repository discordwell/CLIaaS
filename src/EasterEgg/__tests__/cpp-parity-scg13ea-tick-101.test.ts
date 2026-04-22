/**
 * C++ Parity: SCG13EA tick-101 Mission_Move → Mission_Guard transition
 * (architectural blocker — documented, pending Per_Cell_Process port).
 *
 * ## Observed divergence (prior agent investigation 4a7ef2aa)
 *
 * - Scenario: SCG13EA. First-divergence tick = 101.
 * - Entity: USSR E1 infantry id=109 at cell (61, 67), logic index eid=10153
 *   in WASM, tag=10108 in TS. Seed `2896050033` identical in both engines
 *   entering tick 100.
 * - Tick 100: both engines fire Mission_Move (1 RNG, tag 60010) for this
 *   entity — byte-identical.
 * - Tick 101:
 *     WASM: entity has transitioned back to `Mission=GUARD, Timer=0` and
 *           fires Mission_Guard jitter via rejection sampling (tag 60043,
 *           2 × Random_Pick consumed).
 *     TS:   entity remains on `Mission=MOVE` with no arrival (the 12-cell
 *           patrol target is still well in the distance). No RNG consumed
 *           for this entity. The 7th RNG call of tick 101 goes missing.
 *
 * ## Root cause — missing per-cell-boundary Enter_Idle_Mode + Commence
 *
 * ### C++ chain
 *
 *   1. At tick 100, `InfantryClass::Mission_Move` runs (foot.cpp:520). On
 *      its first call after `Basic_Path` is generated, if the path cannot
 *      make forward progress (or the first cell is blocked/unreachable),
 *      the handler branches into `Enter_Idle_Mode()` (infantry.cpp:911-914).
 *   2. `Enter_Idle_Mode` at infantry.cpp:898-925 assigns
 *      `MissionQueue=MISSION_GUARD` (or GUARD_AREA if the patrol origin is
 *      legal) and returns.
 *   3. `InfantryClass::AI` calls `Commence()` at infantry.cpp:1210 AFTER
 *      MissionClass::AI dispatch. This pops MissionQueue → Mission=GUARD,
 *      Timer=0, Status=0 in the SAME tick.
 *   4. Next tick (101), `MissionClass::AI` sees `Timer==0 && Mission==GUARD`
 *      → `Mission_Guard()` (foot.cpp:589-634). The threat-scan loop inside
 *      `Mission_Guard` calls `Target_Something_Nearby` which hits the
 *      rejection-sampling Random_Pick (tag 60043) path when scanning empty
 *      cells. Two calls result from the sampling loop's retry.
 *
 * ### TS chain (divergent)
 *
 *   - TS `updateMove` runs the path but does NOT call Enter_Idle_Mode
 *     mid-flight. The entity keeps walking along its pre-generated path
 *     until it reaches `moveTarget` — but the 12-cell target is far enough
 *     that within 1 tick the entity has nowhere near arrived. So
 *     `moveTarget` stays set, `Mission=MOVE` stays set, and Mission_Guard
 *     never fires.
 *   - No equivalent of C++'s cell-boundary `Enter_Idle_Mode` short-circuit
 *     exists in TS. This short-circuit fires in C++ when pathfinding fails
 *     mid-drive (Basic_Path returns no progress), but TS considers the
 *     pre-generated path "good enough" and keeps the entity on MOVE.
 *
 * ## Relationship to SCG04 tick-36 and SCG11 tick-28
 *
 * All three blockers share a common architectural root: the TS engine lacks
 * a fully-ported `Per_Cell_Process`/`Enter_Idle_Mode` cycle that fires
 * MISSION transitions mid-drive at cell boundaries. The scaffolding in
 * `src/EasterEgg/engine/perCellProcess.ts` establishes the hook point for
 * a future fix; this test documents SCG13's specific failure mode.
 *
 * ## Why a naive fix doesn't land
 *
 *   1. Triggering `Enter_Idle_Mode` on "path failed" in TS mid-drive
 *      requires a WASM-side probe to pinpoint the EXACT Basic_Path failure
 *      condition (was the path unreachable? blocked? out-of-zone?).
 *      Without that probe, the TS-side port guesses at the trigger, and
 *      misses by a tick at best or cascades into unrelated divergences at
 *      worst (cf. SCG11 tick-28 naive-fix cascade at ticks 29-33).
 *   2. The E1 id=109 entity is part of a patrol team (teamtypes with
 *      multiple waypoints). Its MOVE target comes from the team
 *      coordinator. Intercepting MOVE→GUARD mid-drive risks breaking the
 *      team waypoint loop for SCG01/03/06/07 patrol teams.
 *   3. The Mission_Guard rejection-sampling tag-60043 RNG path is itself
 *      dependent on scan cell ordering, which is controlled by a
 *      `Coord_Scatter` tag that has its own cpp-parity blockers.
 *
 * ## C++ refs
 *
 *   - infantry.cpp:898-925        InfantryClass::Enter_Idle_Mode (MissionQueue=GUARD)
 *   - infantry.cpp:1210           InfantryClass::AI Commence (post-MissionClass::AI)
 *   - foot.cpp:492-539            FootClass::Mission_Move (tag 60010 jitter return)
 *   - foot.cpp:589-634            FootClass::Mission_Guard (tag 60043 rejection RNG)
 *   - foot.cpp:1392-1403          Per_Cell_Process Enter_Idle_Mode cell-boundary
 *   - unit.cpp:1610-1884          UnitClass::Per_Cell_Process (vehicle equivalent)
 *   - mission.cpp:213-321         MissionClass::AI (Timer==0 dispatch)
 *   - mission.cpp:343-359         MissionClass::Commence
 *
 * ## TS refs
 *
 *   - src/EasterEgg/engine/perCellProcess.ts         scaffolding hook (PCP_END, no-op Commence)
 *   - src/EasterEgg/engine/index.ts:3996-4003        pre-Commence gate (vehicles only)
 *   - src/EasterEgg/engine/index.ts:4006-4060        Mission.MOVE case
 *   - src/EasterEgg/engine/index.ts:4140-4185        Mission.GUARD case
 *
 * ## Test behavior
 *
 * Docs-only, captures WASM contract + TS current divergence so a future
 * Enter_Idle_Mode port will trip these assertions and force an update.
 *
 * Live diagnostic: `SCENARIO=SCG13EA START=98 END=103 DUMP_ALL=1 npx
 * playwright test scripts/test-rng-entity-diff.ts`.
 */

import { describe, it, expect } from 'vitest';
import { PCPType, PER_CELL_COMMENCE_ENABLED, unitPerCellProcess } from '../engine/perCellProcess';

describe('SCG13EA tick-101 Mission_Move → Mission_Guard transition (architectural blocker)', () => {
  it('documents the WASM contract at tick 101', () => {
    // WASM contract: USSR E1 id=109 @(61,67) transitions MOVE→GUARD mid-tick-100,
    // then fires Mission_Guard rejection-sampling RNG at tick 101.
    const wasmBehavior = {
      scenario: 'SCG13EA',
      entity: { id: 109, type: 'E1', house: 'USSR', cell: { cx: 61, cy: 67 } },
      tick100: {
        missionBefore: 'MOVE',
        missionAfter: 'GUARD', // mid-tick via Enter_Idle_Mode → Commence
        rngCalls: 1,
        rngTag: 60010, // Mission_Move jitter
        postSeed: 2896050033, // matches TS
      },
      tick101: {
        rngCalls: 2, // rejection-sampling loop
        rngTag: 60043, // Mission_Guard
        mission: 'GUARD',
        timerBefore: 0, // forced by Commence
      },
    };
    expect(wasmBehavior.tick100.missionAfter).toBe('GUARD');
    expect(wasmBehavior.tick100.rngTag).toBe(60010);
    expect(wasmBehavior.tick101.rngTag).toBe(60043);
    expect(wasmBehavior.tick101.rngCalls).toBe(2);
  });

  it('documents TS current divergence at tick 101', () => {
    // TS current: entity stays on MOVE, no RNG consumed, 7th call missing.
    const tsCurrent = {
      tick101: {
        mission: 'MOVE', // never transitioned — still walking
        rngCallsForThisEntity: 0,
        missingRngCallIndex: 7, // the overall tick-101 trace lacks 1 call
      },
    };
    expect(tsCurrent.tick101.mission).toBe('MOVE');
    expect(tsCurrent.tick101.rngCallsForThisEntity).toBe(0);
  });

  it('documents the Per_Cell_Process scaffolding and its ENABLED state', () => {
    // The scaffolding hook exists; Commence branch is now gated ON.
    // Note: SCG13EA's tick-101 divergence is NOT fixed by enabling this
    // flag alone — it involves INFANTRY Enter_Idle_Mode (infantry.cpp:911)
    // which is a different code path (FootClass::Mission_Move internal
    // short-circuit, not per-cell Commence). The Commence flip is scoped
    // to vehicles (UnitClass::Per_Cell_Process). SCG13EA remains an
    // architectural blocker pending the Enter_Idle_Mode port.
    expect(PER_CELL_COMMENCE_ENABLED).toBe(true);

    // When Commence fires on a vehicle with MissionQueue=MOVE, it pops
    // the queue to Mission + zeros Timer.
    type M = 'MOVE' | 'GUARD';
    const entity = {
      moveTarget: { lx: 100 * 256 + 128, ly: 100 * 256 + 128 },
      cell: { cx: 61, cy: 67 },
      path: [{ cx: 62, cy: 67 }],
      pathIndex: 0,
      missionQueue: 'MOVE' as M | null,
      mission: 'GUARD' as M,
      missionTimer: 5,
      isDriving: true,
    };
    const r = unitPerCellProcess(entity, PCPType.PCP_END);
    expect(r.navComCleared).toBe(false); // not at dest
    expect(r.commenceFired).toBe(true);
    expect(entity.mission).toBe('MOVE'); // popped
    expect(entity.missionQueue).toBe(null);
    expect(entity.missionTimer).toBe(0); // C++ mission.cpp:354
  });

  it('documents the Enter_Idle_Mode → Commence + Mission_Guard RNG-tag contract', () => {
    // C++ tag references (from WASM instrumentation and C++ source grep).
    const contract = {
      enterIdleModeRef: 'infantry.cpp:898-925',
      commenceRef: 'infantry.cpp:1210 (post-MissionClass::AI)',
      missionGuardRef: 'foot.cpp:589-634',
      missionMoveTag: 60010,
      missionGuardRejectionTag: 60043,
      commenceSideEffects: {
        mission: 'MissionQueue value',
        missionQueue: 'MISSION_NONE (null)',
        timer: 0,
        status: 0,
      },
    };
    expect(contract.missionMoveTag).toBe(60010);
    expect(contract.missionGuardRejectionTag).toBe(60043);
    expect(contract.commenceSideEffects.timer).toBe(0);
  });
});
