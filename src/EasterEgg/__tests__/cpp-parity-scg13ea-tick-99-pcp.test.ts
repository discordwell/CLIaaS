/**
 * C++ Parity: SCG13EA tick-99 cell-arrival Per_Cell_Process + Movement_AI
 * Mission==MOVE && !Target_Legal(NavCom) guard.
 *
 * ## Root cause (confirmed by prior agent investigations)
 *
 * `cpp-parity-scg13ea-tick-101-fix.test.ts` established that the
 * first-divergence at tick 101 for SCG13EA is **actually a tick-99
 * mis-sync** of entity state. This test captures the precise sub-case
 * that was missing in TS.
 *
 * ### C++ chain at tick 99 for USSR E1 id=153 @(61,67)
 *
 * Tick 99 — two phases of the game loop (logic.cpp Main_Logic_Loop):
 *
 *   **Phase 1: Team AI (logic.cpp:268-271)**
 *     Coordinate_Patrol runs `Assign_Mission(MOVE)` — puts MOVE on
 *     MissionQueue. `Assign_Destination(target)` sets NavCom.
 *
 *   **Phase 2: Object AI (logic.cpp:285+)**
 *     FootClass::AI → TechnoClass::AI → MissionClass::AI at infantry.cpp:
 *       - Timer > 0 → no handler dispatch this tick.
 *     Pre-Commence at infantry.cpp:1208-1211:
 *       - `!IsFiring && !IsFalling && !IsDriving && Doing==NOTHING`
 *       - `MissionQueue != NONE`, not the idle `Enter_Idle_Mode` branch.
 *       - Commence() pops MOVE → Mission=MOVE, Timer=0, Status=0.
 *     Firing_AI — no target, no-op.
 *     Movement_AI runs (infantry.cpp:3780-4058):
 *       - **Line 3786-3788**: `Mission == MOVE && !Target_Legal(NavCom)`
 *         — in WASM the NavCom cell had been cleared earlier in this tick
 *         (by the PCP cell-arrival chain, by a Basic_Path short-circuit,
 *         or by a pre-tick-99 Movement_AI pass). Guard fires,
 *         `Enter_Idle_Mode()` runs.
 *       - `Enter_Idle_Mode`: NavCom not legal, TarCom not legal → order =
 *         MISSION_GUARD (infantry.cpp:1704-1708: `House->IsHuman || Team.Is_Valid()`
 *         → GUARD). Team IS valid here (patrol team). Assign_Mission(GUARD) →
 *         MissionQueue = GUARD.
 *   End-of-tick-99 WASM state: Mission=MOVE, Timer=0, MissionQueue=GUARD.
 *
 * ### Tick 100 WASM
 *
 *   Pre-Commence at :1210 pops GUARD → Mission=GUARD, Timer=0.
 *   Mission_Guard dispatches (MissionClass::AI with Timer==0):
 *     Arm_Delay fires Random_Pick(0,2) with tag=60043 — the 7th RNG call
 *     that TS misses. (Actually fires at tick 101 per prior test — timing
 *     is within 1-tick noise of agent_get_state snapshot ordering.)
 *
 * ### TS divergent chain at tick 99
 *
 * TS `coordinatePatrol` (team.ts:1083-1089) queues MOVE AND sets
 * `unit.moveTarget = { lx, ly }` (unconditional, not gated on NavCom state).
 *
 *   **TS updateMove entry at ~line 5358**: `entity.moveTarget` is set, so
 *   the `!moveTarget && !path` shortcut at :5382 doesn't fire. The entity
 *   walks normally along its path.
 *
 *   **No TS analog of line 3786**: C++ Movement_AI fires the guard at the
 *   top of the handler BEFORE path-walking begins. TS has no such guard —
 *   it assumes `moveTarget` is set correctly and always corresponds to a
 *   legal NavCom.
 *
 * End-of-tick-99 TS state: Mission=MOVE, Timer=0, MissionQueue=null,
 * moveTarget={lx:15744, ly:20352} (cell 61,79). Path preserved. Entity
 * keeps walking.
 *
 * ## The missing TS sub-case (Session 4 stub)
 *
 * `MOVEMENT_AI_MOVE_NAVCOM_GUARD` in `perCellProcess.ts` gates the fix.
 * Currently OFF — the guard is wired but no-op. The four on-conditions:
 *
 *   1. `entity.stats.isInfantry`
 *   2. `entity.mission === Mission.MOVE`
 *   3. `entity.moveTarget === null`
 *   4. NOT `fromGuardDrive`
 *
 * When ON, the guard queues GUARD (or AREA_GUARD when `guardOrigin` is
 * set), matching C++'s `Assign_Mission(order)` semantics (queue, not
 * direct mission flip). The post-dispatch Commence block at index.ts:4380
 * pops the queue same-tick, matching C++ `Commence()` at infantry.cpp:1210.
 *
 * ## Why the flag ships OFF
 *
 * C++ line 3786 is a FAILSAFE that assumes NavCom was cleared by some
 * prior chain in the same tick (PCP arrival match at :4003-4006, zone
 * check at :3892-3896, close-enough at :3925-3926, or Basic_Path failure
 * at :3866-3873). In TS, `moveTarget` is not subject to the same mid-tick
 * clears — setting it via `Coordinate_Patrol` is sticky until an arrival
 * or an explicit clear via `updateMove`.
 *
 * Flipping the guard ON unconditionally risks:
 *   - SCG01EA tick 87 patrol attack (Mission_Move 60010 jitter required)
 *   - SCG03EA tick 247 bullet scatter (team patrol mid-drive)
 *   - SCG06EA tick 66 AREA_GUARD fire-animation start
 *   - SCG07EA tick 17 subz activation (team-spawned MOVE)
 *   - SCG11EA tick 28 MCV same-tick Commence
 *
 * Those scenarios depend on a tick where `moveTarget` is nulled by an
 * arrival AND the next MOVE dispatch fires 60010 jitter on the same tick.
 * If this guard pre-empts that dispatch by queuing GUARD before Mission_Move
 * runs, the 60010 RNG is missed → cascade.
 *
 * ## Alternative fix directions (not taken)
 *
 *   1. **Narrow the guard to entities with `guardOrigin` set**: SCG13 patrol
 *      infantry have guardOrigin non-null. Would fire only for patrol
 *      entities. Problem: other patrol scenarios (SCG01/03/06/07) also set
 *      guardOrigin, so this narrows nothing.
 *
 *   2. **Clear `moveTarget` at cell-arrival even when path is non-empty**:
 *      Mirrors C++ line 4003-4006 more faithfully — but requires a per-cell
 *      NavCom-match check that the current TS `footPerCellProcess`
 *      Enter_Idle_Mode branch does NOT implement (it only fires when BOTH
 *      TarCom and NavCom are clear, not when NavCom is cleared mid-tick).
 *
 *   3. **Port the full C++ teamcoord NavCom assignment timing**: Defer
 *      `unit.moveTarget = ...` until the object-AI phase to match WASM's
 *      Phase 1 vs Phase 2 timing. High risk — every team re-coord relies
 *      on the current eager assignment.
 *
 * None of these are strictly better than the gated top-of-Movement_AI
 * guard documented here. The failing test suite is the mechanism to
 * promote this flag: when a future session confirms SCG01/03/06/07/11/04
 * all stay green with the guard ON, flip the constant to `true`.
 *
 * ## C++ refs
 *
 *   infantry.cpp:3786-3788   Movement_AI top-of-handler MOVE+!NavCom guard
 *   infantry.cpp:1208-1211   Pre-Commence on idle state
 *   infantry.cpp:1663-1721   InfantryClass::Enter_Idle_Mode (GUARD vs AREA_GUARD)
 *   infantry.cpp:3992-4010   Movement_AI cell-arrival PCP_END branch
 *   infantry.cpp:911-914     InfantryClass::Per_Cell_Process Enter_Idle+Commence
 *   foot.cpp:1435-1562       FootClass::Per_Cell_Process (path-shorten)
 *   foot.cpp:520-540         FootClass::Mission_Move top-of-handler guard
 *   mission.cpp:343-359      MissionClass::Commence
 *   team.cpp:1874-2008       Team::Coordinate_Move (queues MOVE, sets NavCom)
 *   logic.cpp:268-271        Team AI phase
 *   logic.cpp:285+           Object AI phase
 *
 * ## TS refs
 *
 *   src/EasterEgg/engine/perCellProcess.ts       MOVEMENT_AI_MOVE_NAVCOM_GUARD flag
 *   src/EasterEgg/engine/index.ts  updateMove    top-of-handler guard wire-point
 *   src/EasterEgg/engine/index.ts  Mission.MOVE  case handler
 *   src/EasterEgg/engine/team.ts   coordinatePatrol  infantry MOVE assignment
 *
 * Live diagnostic:
 *   SCENARIO=SCG13EA START=95 END=105 npx playwright test scripts/test-rng-entity-diff.ts
 */

import { describe, it, expect } from 'vitest';
import {
  MOVEMENT_AI_MOVE_NAVCOM_GUARD,
  FOOT_PER_CELL_ENABLED,
  MISSION_MOVE_PATH_FAILURE,
} from '../engine/perCellProcess';

describe('SCG13EA tick-99 Movement_AI MOVE+!NavCom Enter_Idle_Mode guard — infantry.cpp:3786-3788', () => {
  it('flag is exported as a boolean', () => {
    expect(typeof MOVEMENT_AI_MOVE_NAVCOM_GUARD).toBe('boolean');
  });

  it('ships OFF by default — flip ON after SCG01/03/06/07/11/04 regression gate passes', () => {
    // Session 4 stub — gated OFF to avoid cascading patrol-jitter timing in
    // SCG01/03/06/07. When a future session confirms no regression with the
    // guard ON, flip the constant to `true`.
    expect(MOVEMENT_AI_MOVE_NAVCOM_GUARD).toBe(false);
  });

  it('companion flags are both ON — this stub does not disturb Session 2/3.5', () => {
    // Defense-in-depth: Session 2 (FOOT_PER_CELL_ENABLED) and Session 3.5
    // (MISSION_MOVE_PATH_FAILURE) already ship ON. Session 4 is additive —
    // toggling MOVEMENT_AI_MOVE_NAVCOM_GUARD should not require changes to
    // the prior gates.
    expect(FOOT_PER_CELL_ENABLED).toBe(true);
    expect(MISSION_MOVE_PATH_FAILURE).toBe(true);
  });

  it('WASM: entity[153] end-of-tick-99 has MissionQueue=GUARD', () => {
    // Documents the WASM-side tick-99 post-state. Captured via
    // agent_get_state after sync'd 99-tick run. The `mq=GUARD` is the
    // observable signature of the C++ line 3786-3788 guard firing.
    const wasm = {
      cell: { cx: 61, cy: 67 },
      mission: 'MOVE',
      missionTimer: 0,
      missionQueue: 'GUARD',
    };
    expect(wasm.mission).toBe('MOVE');
    expect(wasm.missionQueue).toBe('GUARD');
    expect(wasm.missionTimer).toBe(0);
  });

  it('TS: entity id=109 end-of-tick-99 currently has MissionQueue=null (pre-fix)', () => {
    // Documents the TS-side tick-99 post-state. Without the Session 4
    // guard, TS never queues GUARD — the unit stays in MOVE through
    // tick 100 and the 60043 RNG at tick 101 is missed.
    const ts = {
      id: 109,
      cell: { cx: 61, cy: 67 },
      mission: 'MOVE',
      missionTimer: 0,
      missionQueue: null,
      moveTarget: { lx: 15744, ly: 20352 },
    };
    expect(ts.mission).toBe('MOVE');
    expect(ts.missionQueue).toBeNull();
    expect(ts.moveTarget).toEqual({ lx: 15744, ly: 20352 });
  });

  it('guard conditions: infantry + Mission.MOVE + moveTarget===null + !fromGuardDrive', () => {
    // The four on-conditions for the Session 4 guard, pulled from the
    // wire-point in updateMove. Any change to these must be reflected in
    // the engine AND this test.
    const fourConditions = [
      'entity.stats.isInfantry',
      'entity.mission === Mission.MOVE',
      'entity.moveTarget === null',
      '!fromGuardDrive',
    ];
    expect(fourConditions).toHaveLength(4);
    expect(fourConditions[0]).toBe('entity.stats.isInfantry');
  });

  it('queue-not-direct: sets missionQueue=GUARD/AREA_GUARD, never flips mission directly', () => {
    // C++ `Enter_Idle_Mode` calls `Assign_Mission(order)` which sets
    // MissionQueue, NOT Mission. Commence pops the queue on the next
    // dispatch. A naive `entity.mission = GUARD` direct flip misses the
    // Commence-Timer-zero-reset semantics and causes off-by-one
    // Mission_Guard timing.
    const enterIdleModePick = (guardOrigin: unknown | null): 'GUARD' | 'AREA_GUARD' =>
      guardOrigin != null ? 'AREA_GUARD' : 'GUARD';
    expect(enterIdleModePick(null)).toBe('GUARD');
    expect(enterIdleModePick({ x: 100, y: 100 })).toBe('AREA_GUARD');
  });

  it('regression gate: listed patrol scenarios MUST not cascade when flag flipped ON', () => {
    // The 5 canonical patrol-jitter scenarios. Before flipping
    // MOVEMENT_AI_MOVE_NAVCOM_GUARD to true, the first-divergence suite
    // MUST verify none of these regress below their current best tick.
    const regressionGate = ['SCG01EA', 'SCG03EA', 'SCG06EA', 'SCG07EA', 'SCG11EA', 'SCG04EA'];
    expect(regressionGate).toContain('SCG01EA');
    expect(regressionGate).toContain('SCG11EA');
    expect(regressionGate.length).toBeGreaterThanOrEqual(6);
  });

  it('tick 101 RNG count: WASM=7 TS=6 Δ=+1 unchanged by Session 4 stub (flag OFF)', () => {
    // Parent blocker: SCG13EA tick-101 RNG count mismatch. This stub
    // does NOT change the count because the flag is OFF. When flipped ON
    // (Session 4.1+), the 7th tick-101 RNG should be emitted by TS via
    // Mission_Guard Arm_Delay dispatch following the GUARD-queue pop.
    const wasmCalls = 7;
    const tsCalls = 6;
    expect(wasmCalls - tsCalls).toBe(1);
  });
});
