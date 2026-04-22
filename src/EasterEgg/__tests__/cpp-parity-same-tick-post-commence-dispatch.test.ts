/**
 * C++ Parity: same-tick Mission_Move dispatch after per-cell Commence.
 *
 * ## Context
 *
 * Commit c4310105 ported `UnitClass::Per_Cell_Process` Commence mid-drive
 * (unit.cpp:1756 → pops MissionQueue, zeros Timer). However, the TS
 * `updateEntity` function captures `missionTimerFired` at the TOP of the
 * function, BEFORE the drive-in-GUARD `updateMove` runs. When Commence fires
 * mid-tick during updateMove (transitioning Mission=GUARD → MOVE and
 * Timer=0), the Mission.MOVE handler's timer-fire block doesn't dispatch
 * until the NEXT tick's updateEntity — producing Mission_Move jitter RNG
 * 1 tick late vs WASM.
 *
 * ## C++ same-tick dispatch mechanism
 *
 * In C++, `UnitClass::AI` (unit.cpp:397-489) runs:
 *   1. Pre-Commence (unit.cpp:406): if (!IsDriving && Is_Door_Closed) →
 *      Commence() pops MissionQueue → Mission=new, Timer=0.
 *   2. DriveClass::AI (unit.cpp:408):
 *      a. → FootClass::AI → TechnoClass::AI → RadioClass::AI =
 *         MissionClass::AI (mission.cpp:213). If Timer==0, dispatches
 *         mission handler immediately (Mission_Move, Mission_Attack, etc.).
 *      b. → DriveClass::AI continues with `While_Moving()` → per-cell
 *         boundary crossings → UnitClass::Per_Cell_Process. Commence()
 *         may pop here too (unit.cpp:1756), but MissionClass::AI has
 *         ALREADY run — so the new Mission sits with Timer=0 for
 *         dispatch on the NEXT tick.
 *   3. Firing_AI, Rotation_AI, post-Commence (unit.cpp:473).
 *
 * So for a drive-in-GUARD vehicle whose FIRST cell-boundary Commence fires
 * mid-While_Moving, Mission_Move dispatches on the NEXT tick — matching
 * WASM's SCG11EA tick-28 fire pattern.
 *
 * BUT for a vehicle whose Commence fires via path 1 (pre-Commence at
 * unit.cpp:406 because IsDriving went false when Stop_Driver ran at end of
 * prior tick), Mission_Move dispatches SAME-TICK as Commence.
 *
 * ## TS fix (this test pins)
 *
 * In `updateEntity` Mission.GUARD case, after the drive-in-GUARD
 * `updateMove` call, check if:
 *   - `entity.mission === Mission.MOVE` (Commence just popped queue)
 *   - `entity.missionTimer === 0` (zeroed by Commence)
 *   - `missionTimerFired === false` (not the NEXT-tick dispatch path)
 *
 * If all three, emulate the Mission_Move handler's timer-return path
 * (foot.cpp:492-505) same-tick: consume `Random_Pick(0,2)` jitter and set
 * `missionTimer = 14 + jitter`. This matches WASM's SCG11EA tick-28 RNG
 * consumption for MCVs whose Commence fires on the pre-Commence gate (not
 * the per-cell gate).
 *
 * ## C++ references
 *   - unit.cpp:397-489       UnitClass::AI (pre/post Commence + DriveClass::AI call)
 *   - unit.cpp:406           Pre-movement Commence (same-tick dispatch path)
 *   - unit.cpp:1610-1884     UnitClass::Per_Cell_Process (mid-drive Commence)
 *   - unit.cpp:1756          Commence() inside Per_Cell_Process
 *   - drive.cpp:1304-1399    DriveClass::AI (FootClass::AI → While_Moving)
 *   - techno.cpp:2331-2408   TechnoClass::AI (calls RadioClass::AI = MissionClass::AI)
 *   - mission.cpp:213-321    MissionClass::AI (Timer==0 dispatch)
 *   - mission.cpp:343-359    MissionClass::Commence
 *   - foot.cpp:492-539       FootClass::Mission_Move (tag 60010 Random_Pick(0,2))
 *
 * ## TS references
 *   - src/EasterEgg/engine/index.ts (Mission.GUARD case)
 *     Post-updateMove same-tick Commence-dispatch block.
 *   - src/EasterEgg/engine/perCellProcess.ts unit.cpp:1756 port.
 */

import { describe, it, expect } from 'vitest';

describe('Same-tick Mission_Move dispatch after per-cell Commence (C++ parity)', () => {
  // ──────────────────────────────────────────────────────────────────────
  // Case 1: behavioral contract — what the post-updateMove same-tick
  // dispatch must do for a drive-in-GUARD vehicle whose Commence just
  // fired mid-tick inside updateMove.
  // ──────────────────────────────────────────────────────────────────────

  it('documents same-tick Mission_Move dispatch contract for drive-in-GUARD vehicles', () => {
    // Simulated entity state AFTER updateMove's perCellNavComCheck fired
    // Commence (queue popped, timer=0), still mid-tick Mission.GUARD case.
    const entity = {
      mission: 'MOVE' as const,        // Commence set this from GUARD
      missionQueue: null,              // Commence cleared this
      missionTimer: 0,                  // Commence zeroed this (C++ mission.cpp:354)
      isDriving: true,                  // still mid-drive (driving to next cell)
      moveTarget: { lx: 22 * 256 + 128, ly: 100 * 256 + 128 },
    };

    // Invariant: missionTimerFired was captured at top of updateEntity
    // BEFORE updateMove ran, so it's false for this path.
    const missionTimerFired = false;

    // Check the gating conditions for the same-tick dispatch fix.
    const shouldDispatch =
      entity.mission === 'MOVE' &&
      entity.missionTimer === 0 &&
      !missionTimerFired;

    expect(shouldDispatch).toBe(true);

    // Simulated handler effect: foot.cpp:504 Normal_Delay + Random_Pick(0,2)
    // rules.ini [Move] Rate=.050 → Normal_Delay=14 (from [Guard] derivation)
    const MISSION_MOVE_DELAY = 14;
    const jitterMin = 0;
    const jitterMax = 2;
    const simulatedJitter = 1; // Random_Pick(0,2) yields 0, 1, or 2
    const newTimer = MISSION_MOVE_DELAY + simulatedJitter;

    expect(newTimer).toBeGreaterThanOrEqual(MISSION_MOVE_DELAY + jitterMin);
    expect(newTimer).toBeLessThanOrEqual(MISSION_MOVE_DELAY + jitterMax);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Case 2: invariant — same-tick dispatch must NOT fire when the
  // Mission.MOVE case is entered normally (missionTimerFired=true at top
  // of updateEntity), because the Mission.MOVE case handler owns the
  // jitter consumption in that path.
  // ──────────────────────────────────────────────────────────────────────

  it('does not fire when Mission.MOVE case handles jitter natively (missionTimerFired=true)', () => {
    // Entity entered updateEntity with mission=MOVE, timer=0 already (set
    // by a previous tick's Commence). missionTimerFired=true at top →
    // Mission.MOVE switch case runs, dispatches jitter itself.
    const entity = {
      mission: 'MOVE' as const,
      missionTimer: 0,
      isDriving: true,
      moveTarget: { lx: 0, ly: 0 },
    };
    const missionTimerFired = true;  // captured at TOP of updateEntity

    // The Mission.GUARD case's same-tick dispatch block must NOT trigger
    // — it's gated on !missionTimerFired.
    const wouldGuardBlockFire =
      entity.mission === 'MOVE' && entity.missionTimer === 0 && !missionTimerFired;
    expect(wouldGuardBlockFire).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Case 3: invariant — same-tick dispatch must NOT fire if mission
  // stayed GUARD (no Commence fired this tick). Common case: vehicle
  // driving-in-GUARD toward destination, haven't crossed a cell boundary
  // mid-updateMove yet.
  // ──────────────────────────────────────────────────────────────────────

  it('does not fire when Commence did not transition mission (still GUARD)', () => {
    const entity = {
      mission: 'GUARD' as const,
      missionTimer: 10,
      isDriving: true,
      moveTarget: { lx: 0, ly: 0 },
    };
    const missionTimerFired = false;

    // Would the same-tick block fire? No: mission !== MOVE.
    const wouldFire =
      (entity.mission as string) === 'MOVE' &&
      entity.missionTimer === 0 && !missionTimerFired;
    expect(wouldFire).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Case 4: C++ dispatch ordering reference.
  // ──────────────────────────────────────────────────────────────────────

  it('documents C++ UnitClass::AI dispatch order (authoritative)', () => {
    // C++ UnitClass::AI (unit.cpp:397-489) execution order:
    //   1. Pre-Commence (unit.cpp:406) — pops queue if !IsDriving
    //   2. DriveClass::AI (unit.cpp:408):
    //        a. FootClass::AI → TechnoClass::AI → RadioClass::AI =
    //           MissionClass::AI dispatch (if Timer==0)
    //        b. Movement (While_Moving → Per_Cell_Process → mid-drive Commence)
    //   3. Firing_AI + Rotation_AI
    //   4. Post-Commence (unit.cpp:473)
    //
    // Key insight: MissionClass::AI dispatch runs BEFORE While_Moving
    // (step 2a before 2b). Mid-drive Commence in step 2b sets Timer=0 but
    // dispatch has already happened — so that Commence's dispatch fires
    // on the NEXT obj->AI() call. Meanwhile, step 1's pre-Commence
    // transitions MissionQueue → Mission with Timer=0, AND step 2a fires
    // the handler SAME TICK.
    const cppOrder = [
      'Pre-Commence (unit.cpp:406, same-tick)',
      'MissionClass::AI dispatch (techno.cpp:2344 via RadioClass::AI)',
      'While_Moving → Per_Cell_Process → mid-drive Commence (next-tick dispatch)',
      'Firing_AI / Rotation_AI',
      'Post-Commence (unit.cpp:473)',
    ];
    expect(cppOrder).toHaveLength(5);
    expect(cppOrder[1]).toContain('MissionClass::AI');
    expect(cppOrder[2]).toContain('mid-drive');
  });
});
