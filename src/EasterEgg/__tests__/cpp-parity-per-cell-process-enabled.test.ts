/**
 * C++ Parity: Per_Cell_Process Commence gate ENABLED — behavioral contract.
 *
 * This test pins the partial port landed in the SCG11EA tick-28 architectural
 * investigation: flipping `PER_CELL_COMMENCE_ENABLED` to `true` so Commence
 * fires at every PCP_END boundary, matching C++ `UnitClass::Per_Cell_Process`
 * unit.cpp:1756 + `MissionClass::Commence` mission.cpp:347-358.
 *
 * Scope (partial port — see `engine/perCellProcess.ts` docstring):
 *   - ✓ PCP_END Commence (pop MissionQueue, Timer=0).
 *   - ✓ PCP_END NavCom-at-destination clear (DriveClass::Per_Cell_Process
 *     drive.cpp:869-873), runs AFTER Commence in C++ ordering.
 *   - ✗ DriveClass::AI drive.cpp:1340-1345 double-cycle (MCV-157 double-fire
 *     at SCG11EA tick 28 still unexplained).
 *   - ✗ Mid-track PCP_DURING Overrun_Square + crushable-overlay (handled
 *     inline by `followTrackStep`, not via this hook yet).
 *   - ✗ Flag pickup / flag-home (unit.cpp:1771-1802).
 *   - ✗ Mine blow (unit.cpp:1807-1838).
 *   - ✗ Transport IM_IN (unit.cpp:1636-1665).
 *   - ✗ Edge-of-world cull (unit.cpp:1726-1729).
 *   - ✗ PCP_ROTATION MCV deploy (unit.cpp:1623-1626).
 *
 * The covered cases below are the load-bearing ones for SCG04/11/13 RNG
 * divergence — specifically the mid-drive Mission_Move jitter consumption
 * pattern that WASM logs but pre-port TS missed.
 *
 * C++ references:
 *   - unit.cpp:1610-1884    UnitClass::Per_Cell_Process
 *   - unit.cpp:1756         Commence() dispatch (the load-bearing line)
 *   - mission.cpp:343-359   MissionClass::Commence (the field swap)
 *   - drive.cpp:858-879     DriveClass::Per_Cell_Process (NavCom clear)
 *   - drive.cpp:661-834     While_Moving PCP_END dispatch sites (773, 816)
 *   - foot.cpp:520-539      Mission_Move Random_Pick(0,2) tag=60010
 */

import { describe, it, expect } from 'vitest';
import {
  PCPType,
  PER_CELL_COMMENCE_ENABLED,
  drivePerCellProcess,
  unitPerCellProcess,
  type PCPEntity,
} from '../engine/perCellProcess';

type M = 'GUARD' | 'MOVE' | 'ATTACK' | 'HUNT' | 'STOP';

function makeVehicle(overrides: Partial<PCPEntity<M>> = {}): PCPEntity<M> {
  return {
    moveTarget: null,
    cell: { cx: 0, cy: 0 },
    path: [],
    pathIndex: 0,
    missionQueue: null,
    mission: 'GUARD',
    missionTimer: 14,
    isDriving: true,
    ...overrides,
  };
}

describe('Per_Cell_Process Commence gate ENABLED (C++ unit.cpp:1756 parity)', () => {
  it('gate is ENABLED (otherwise all behavior tests below are vacuous)', () => {
    expect(PER_CELL_COMMENCE_ENABLED).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Case 1: non-aligned vehicle arriving at cell center (PCP_END,
  // intermediate cell, MissionQueue=MOVE). Pops the queue mid-drive.
  // This is the SCG11EA MCV pattern that produces WASM's tick-28 jitter.
  // ──────────────────────────────────────────────────────────────────────

  it('vehicle mid-drive PCP_END with MissionQueue=MOVE pops queue', () => {
    // Greece MCV at (22,103), NavCom=(22,100), path has remaining cells.
    // Track just completed at intermediate cell; PCP_END fires.
    const mcv = makeVehicle({
      moveTarget: { lx: 22 * 256 + 128, ly: 100 * 256 + 128 }, // waypoint 26
      cell: { cx: 22, cy: 103 },
      path: [{ cx: 22, cy: 102 }, { cx: 22, cy: 101 }, { cx: 22, cy: 100 }],
      pathIndex: 0,
      missionQueue: 'MOVE',
      mission: 'GUARD',
      missionTimer: 16, // GUARD delay mid-countdown
      isDriving: true,
    });

    const r = unitPerCellProcess(mcv, PCPType.PCP_END);

    // C++ MissionClass::Commence (mission.cpp:347-358):
    //   if (MissionQueue != MISSION_NONE) {
    //     Mission = MissionQueue;  MissionQueue = MISSION_NONE;
    //     Timer = 0;  Status = 0;
    //     return true;
    //   }
    expect(r.commenceFired).toBe(true);
    expect(mcv.mission).toBe('MOVE');
    expect(mcv.missionQueue).toBe(null);
    expect(mcv.missionTimer).toBe(0);

    // NavCom-at-dest clear does NOT fire (MCV is at cy=103, dest cy=100).
    expect(r.navComCleared).toBe(false);
    expect(mcv.moveTarget).not.toBe(null);
    expect(mcv.path.length).toBe(3);
    expect(mcv.pathIndex).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Case 2: vehicle that arrives AT destination with MissionQueue=MOVE
  // still queued. Both Commence AND NavCom-clear fire in one PCP_END call.
  // ──────────────────────────────────────────────────────────────────────

  it('vehicle at-destination PCP_END: Commence fires AND NavCom clears (C++ order: 1756 → 1882)', () => {
    const mcv = makeVehicle({
      moveTarget: { lx: 22 * 256 + 128, ly: 100 * 256 + 128 },
      cell: { cx: 22, cy: 100 }, // arrived at waypoint 26
      path: [{ cx: 22, cy: 100 }],
      pathIndex: 0,
      missionQueue: 'MOVE',
      mission: 'GUARD',
      missionTimer: 2,
      isDriving: true,
    });

    const r = unitPerCellProcess(mcv, PCPType.PCP_END);

    // Commence runs FIRST (UnitClass::Per_Cell_Process unit.cpp:1756),
    // then DriveClass::Per_Cell_Process (unit.cpp:1882 base-class call)
    // does the NavCom clear.
    expect(r.commenceFired).toBe(true);
    expect(r.navComCleared).toBe(true);
    expect(mcv.mission).toBe('MOVE');
    expect(mcv.missionQueue).toBe(null);
    expect(mcv.missionTimer).toBe(0);
    expect(mcv.moveTarget).toBe(null);
    expect(mcv.path).toEqual([]);
    expect(mcv.pathIndex).toBe(0);
  });

  it('vessel PCP_END uses VesselClass -> DriveClass -> FootClass and does not pop MissionQueue', () => {
    // C++ VesselClass::Per_Cell_Process (vessel.cpp:696-760) chains to
    // DriveClass::Per_Cell_Process, not UnitClass::Per_Cell_Process. Therefore
    // the unit.cpp:1756 Commence branch is land-vehicle-only. Vessel queues pop
    // only at the VesselClass::AI pre/post gates (vessel.cpp:606,673), both
    // gated by !IsDriving.
    const cruiser = makeVehicle({
      stats: { isVessel: true },
      moveTarget: { lx: 84 * 256 + 128, ly: 84 * 256 + 128 },
      cell: { cx: 84, cy: 87 },
      path: [{ cx: 84, cy: 86 }, { cx: 84, cy: 85 }, { cx: 84, cy: 84 }],
      pathIndex: 0,
      missionQueue: 'MOVE',
      mission: 'GUARD',
      missionTimer: 35,
      isDriving: true,
    });

    const directShared = drivePerCellProcess(cruiser, PCPType.PCP_END);

    expect(directShared.commenceFired).toBe(false);
    expect(directShared.navComCleared).toBe(false);
    expect(cruiser.mission).toBe('GUARD');
    expect(cruiser.missionQueue).toBe('MOVE');
    expect(cruiser.missionTimer).toBe(35);

    // Guard against accidental routing through unitPerCellProcess with a real
    // Entity-like vessel: it must still skip the UnitClass-only Commence branch.
    const accidentalUnitRoute = unitPerCellProcess(cruiser, PCPType.PCP_END);
    expect(accidentalUnitRoute.commenceFired).toBe(false);
    expect(cruiser.mission).toBe('GUARD');
    expect(cruiser.missionQueue).toBe('MOVE');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Case 3: destination arrival with NO queued mission — only NavCom clears,
  // Commence no-ops. This is the common case after a single-mission drive
  // completes: the unit's current mission stays (e.g., MOVE) and will take
  // the Enter_Idle_Mode branch next tick.
  // ──────────────────────────────────────────────────────────────────────

  it('vehicle at-destination with no queued mission: only NavCom clears', () => {
    const mcv = makeVehicle({
      moveTarget: { lx: 30 * 256 + 128, ly: 30 * 256 + 128 },
      cell: { cx: 30, cy: 30 },
      path: [{ cx: 30, cy: 30 }],
      pathIndex: 0,
      missionQueue: null,
      mission: 'MOVE',
      missionTimer: 8,
      isDriving: true,
    });

    const r = unitPerCellProcess(mcv, PCPType.PCP_END);

    // C++ mission.cpp:347: Commence returns false when MissionQueue==NONE.
    expect(r.commenceFired).toBe(false);
    expect(r.navComCleared).toBe(true);
    expect(mcv.mission).toBe('MOVE'); // unchanged — no pop
    expect(mcv.missionTimer).toBe(8); // Commence did not zero it
    expect(mcv.moveTarget).toBe(null);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Case 4: mid-track PCP_DURING fires no Commence, no NavCom-clear.
  // C++ drive.cpp:735-742 only runs Overrun_Square + crushable-overlay
  // destruction; the TS engine handles those inline in followTrackStep.
  // ──────────────────────────────────────────────────────────────────────

  it('PCP_DURING does not fire Commence or NavCom clear (C++ drive.cpp:735-742)', () => {
    const mcv = makeVehicle({
      moveTarget: { lx: 22 * 256 + 128, ly: 100 * 256 + 128 },
      cell: { cx: 22, cy: 102 },
      path: [{ cx: 22, cy: 101 }, { cx: 22, cy: 100 }],
      pathIndex: 0,
      missionQueue: 'MOVE',
      mission: 'GUARD',
      missionTimer: 10,
      isDriving: true,
    });

    const r = unitPerCellProcess(mcv, PCPType.PCP_DURING);

    expect(r.commenceFired).toBe(false);
    expect(r.navComCleared).toBe(false);
    expect(mcv.mission).toBe('GUARD'); // untouched
    expect(mcv.missionQueue).toBe('MOVE'); // still queued
    expect(mcv.missionTimer).toBe(10);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Case 5: PCP_ROTATION — stationary-rotation finish. C++ unit.cpp:1623-1626
  // branches into Try_To_Deploy for MCVs but never calls Commence (the
  // MCV transition is explicit, not queued). Our hook stays a no-op until
  // deploy port lands.
  // ──────────────────────────────────────────────────────────────────────

  it('PCP_ROTATION does not fire Commence (C++ unit.cpp:1623-1626, deploy port pending)', () => {
    const mcv = makeVehicle({
      moveTarget: null,
      cell: { cx: 30, cy: 30 },
      path: [],
      pathIndex: 0,
      missionQueue: 'MOVE',
      mission: 'GUARD',
      missionTimer: 5,
      isDriving: false, // finished rotating in place
    });

    const r = unitPerCellProcess(mcv, PCPType.PCP_ROTATION);

    expect(r.commenceFired).toBe(false);
    expect(r.navComCleared).toBe(false);
    expect(mcv.mission).toBe('GUARD');
    expect(mcv.missionQueue).toBe('MOVE');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Case 6: MissionQueue stays consumed across successive PCP_END calls
  // (no re-pop on subsequent cell boundaries).
  // ──────────────────────────────────────────────────────────────────────

  it('MissionQueue pops exactly once per queued mission (no re-pop)', () => {
    const mcv = makeVehicle({
      moveTarget: { lx: 40 * 256 + 128, ly: 40 * 256 + 128 },
      cell: { cx: 38, cy: 40 },
      path: [{ cx: 39, cy: 40 }, { cx: 40, cy: 40 }],
      pathIndex: 0,
      missionQueue: 'MOVE',
      mission: 'GUARD',
      missionTimer: 20,
      isDriving: true,
    });

    // 1st boundary — queue pops.
    const r1 = unitPerCellProcess(mcv, PCPType.PCP_END);
    expect(r1.commenceFired).toBe(true);
    expect(mcv.mission).toBe('MOVE');
    expect(mcv.missionQueue).toBe(null);

    // Manually advance to next cell (simulating followTrackStep). Queue
    // should already be null; subsequent PCP_END must NOT re-pop.
    mcv.cell = { cx: 39, cy: 40 };
    mcv.pathIndex = 1;

    const r2 = unitPerCellProcess(mcv, PCPType.PCP_END);
    expect(r2.commenceFired).toBe(false); // nothing to pop
    expect(mcv.mission).toBe('MOVE');
    expect(mcv.missionQueue).toBe(null);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Case 7: SCG04/11/13 shared invariant — after PCP_END fires Commence,
  // Mission is the popped value with Timer=0, so the NEXT tick's
  // MissionClass::AI dispatch fires the new-mission handler's first pass
  // (consuming any jitter Random_Pick).
  // ──────────────────────────────────────────────────────────────────────

  it('post-Commence state primes next-tick MissionClass::AI dispatch (Timer=0)', () => {
    const mcv = makeVehicle({
      moveTarget: { lx: 50 * 256 + 128, ly: 50 * 256 + 128 },
      cell: { cx: 48, cy: 50 },
      path: [{ cx: 49, cy: 50 }, { cx: 50, cy: 50 }],
      pathIndex: 0,
      missionQueue: 'MOVE',
      mission: 'GUARD',
      missionTimer: 13, // GUARD countdown
      isDriving: true,
    });

    unitPerCellProcess(mcv, PCPType.PCP_END);

    // Post-condition: Mission=popped, Timer=0 so next-tick dispatch
    // sees `Timer==0 && Mission==MOVE` → `Mission_Move()` at foot.cpp:520
    // with `Target_Legal(NavCom)==true && IsDriving==true`, which takes
    // the normal (jitter-consuming) path and consumes 1 Random_Pick(0,2).
    expect(mcv.mission).toBe('MOVE');
    expect(mcv.missionTimer).toBe(0);
    // C++ Start_Driver sets IsDriving before Per_Cell_Process; end-of-
    // While_Moving flips IsDriving=false via Stop_Driver. The TS hook
    // does NOT mutate isDriving — caller owns that transition via
    // followTrackStep (index.ts:6451, 6464).
    // We only pin that the hook leaves isDriving untouched.
    expect(mcv.isDriving).toBe(true);
  });
});
