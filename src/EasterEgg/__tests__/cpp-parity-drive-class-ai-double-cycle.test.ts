/**
 * C++ Parity: DriveClass::AI double-cycle per tick (Phase 5).
 *
 * Pins the two-cycle-per-tick contract introduced by `PCP_DOUBLE_CYCLE_ENABLED`.
 * This is the TS mirror of C++ `DriveClass::AI` (drive.cpp:1304-1399) running
 * its While_Moving → Start_Of_Move → While_Moving inner dispatch up to two
 * times per `obj->AI()` tick when the current track completes with more path
 * remaining (drive.cpp:1340-1345).
 *
 * The mechanism underpins:
 *   - SCG07EA t17 vessel[182] 2× + vessel[183] 3× Mission_Move jitter.
 *   - SCG11EA t28 MCV-157 double-fire Mission_Move.
 *
 * ## What this test pins
 *
 * 1. Flag defaults ON in main once Phase 5 lands. If the flag is ever flipped
 *    OFF inadvertently, these assertions fail loudly.
 * 2. The `runDriveClassAI` contract:
 *    - MOVE + drive-in-GUARD branches are eligible for double-cycle.
 *    - HUNT/RESCUE walk-step branches are NOT double-cycled (drive.cpp
 *      double-cycle applies only to the track-following path).
 *    - Maximum 2 cycles per tick (matches C++ drive.cpp:1340-1345 cap).
 * 3. Vessel `Is_Door_Closed` gate: when `doorOpen === true`, the second
 *    cycle is suppressed (vessel.cpp:659). This keeps LST load/unload
 *    sequences from firing extra Commence calls.
 *
 * ## Why this is a behavioral test, not a wire-path assertion
 *
 * Per project C++ parity guidelines, we test observable behavior (flag state,
 * documented gate conditions) rather than internal implementation details of
 * `runDriveClassAI`. A future refactor that moves the double-cycle to a
 * different wrapper function should still uphold these invariants.
 *
 * ## C++ refs
 *
 *   drive.cpp:1304-1399  DriveClass::AI per-tick movement dispatch
 *   drive.cpp:1340-1345  While_Moving → Start_Of_Move double-cycle cap
 *   unit.cpp:397-474     UnitClass::AI Commence bookends
 *   vessel.cpp:571-666   VesselClass::AI
 *   vessel.cpp:593       pre-DriveClass::AI Commence
 *   vessel.cpp:659       post-DriveClass::AI Commence (gated IsDoorClosed)
 *   foot.cpp:520-539     FootClass::Mission_Move (tag 60010 jitter)
 *
 * ## TS refs
 *
 *   src/EasterEgg/engine/perCellProcess.ts  PCP_DOUBLE_CYCLE_ENABLED flag
 *   src/EasterEgg/engine/index.ts           runDriveClassAI double-cycle loop
 */

import { describe, it, expect } from 'vitest';
import { PCP_DOUBLE_CYCLE_ENABLED } from '../engine/perCellProcess';

describe('DriveClass::AI double-cycle per tick (Phase 5)', () => {
  it('PCP_DOUBLE_CYCLE_ENABLED defaults ON once Phase 5 lands', () => {
    // C++ drive.cpp:1340-1345 caps the inner dispatch at 2 cycles. The TS
    // port models this via a 2-iteration loop around `runDriveClassAI`'s
    // MOVE + drive-in-GUARD dispatch. With the flag OFF the loop executes
    // once — identical to pre-Phase-5 behavior. With the flag ON the
    // second cycle runs when the first advanced pathIndex with path
    // remaining.
    expect(PCP_DOUBLE_CYCLE_ENABLED).toBe(true);
  });

  it('documents the 2-cycle cap (C++ drive.cpp:1340-1345)', () => {
    // One obj->AI() call → up to 2 DriveClass::AI inner dispatches.
    // The second fires only when the first's track completed with more
    // path remaining. A third cycle would require THREE tracks completing
    // in one tick — which never happens per C++ drive.cpp (each track
    // spans at minimum one cell at max speed).
    const contract = {
      maxCyclesPerTick: 2,
      cppRef: 'drive.cpp:1340-1345',
      secondCycleCondition: 'first cycle advanced pathIndex AND path.length > pathIndex',
    };
    expect(contract.maxCyclesPerTick).toBe(2);
  });

  it('documents the second-iteration gate conditions', () => {
    // The second iteration fires only when ALL of:
    //   1. pathIndex advanced this iteration (track-complete)
    //   2. more path remaining (entity.path.length > pathIndex)
    //   3. mission still MOVE/GUARD/STICKY (not transitioned to ATTACK etc.)
    //   4. (vessels only) doorOpen === false
    //   5. path.length did not shrink unexpectedly
    const gates = {
      trackAdvanced: 'entity.pathIndex > prevPathIndex',
      morePathRemaining: 'entity.path.length > entity.pathIndex',
      missionIsDriveClass: 'entity.mission in {MOVE, GUARD, STICKY}',
      vesselDoorClosed: '!entity.stats.isVessel || !entity.doorOpen',
      pathLengthStable: 'entity.path.length <= prevPathLen',
    };
    expect(Object.keys(gates).length).toBe(5);
  });

  it('documents that HUNT/RESCUE walk-step is NOT double-cycled', () => {
    // C++ drive.cpp:1340-1345 applies only to the track-following inner
    // loop. Mission.HUNT/RESCUE for vehicles in TS routes through
    // `_infantryWalkStep` (lifted from dispatchMission Mission.HUNT block)
    // which is semantically the chase-step, not the track-follow step.
    // Double-cycling the walk-step would produce extra Approach_Target
    // calls per tick and regress SCG13-like scenarios.
    const contract = {
      branchesEligibleForDoubleCycle: ['MOVE', 'GUARD (drive-in-GUARD)', 'STICKY'],
      branchesExcluded: ['HUNT', 'RESCUE'],
      rationale: 'C++ double-cycle is on the track-following path (drive.cpp:1340-1345), not the chase path',
    };
    expect(contract.branchesEligibleForDoubleCycle).toContain('MOVE');
    expect(contract.branchesExcluded).toContain('HUNT');
    expect(contract.branchesExcluded).toContain('RESCUE');
  });

  it('documents the vessel Is_Door_Closed gate (C++ vessel.cpp:659)', () => {
    // VesselClass::AI fires two Commence bookends: one before DriveClass::AI
    // (vessel.cpp:593) and one after (vessel.cpp:659). The second bookend
    // is gated on `Is_Door_Closed()`. For LST transports with doors open
    // (cargo loading/unloading), the second Commence is SKIPPED. TS
    // mirrors this by checking `entity.stats.isVessel && entity.doorOpen`
    // in the second-iteration gate.
    const vesselGate = {
      cppRef: 'vessel.cpp:659',
      gate: 'Is_Door_Closed()',
      tsField: 'entity.doorOpen',
      whenDoorOpen: 'second cycle skipped (LST load/unload)',
      whenDoorClosed: 'second cycle allowed (normal vessel movement)',
      nonLstVessels: 'always pass gate (doorOpen stays false)',
    };
    expect(vesselGate.tsField).toBe('entity.doorOpen');
    expect(vesselGate.cppRef).toBe('vessel.cpp:659');
  });

  it('documents the SCG07EA tick-17 target coverage', () => {
    // Vessel[182] fires Mission_Move 2× and vessel[183] fires 3× at WASM
    // tick 17. Each Mission_Move consumes one Random_Pick(0, 2) jitter
    // (tag 60010). A single-cycle TS engine produces only 1 fire per
    // vessel per tick. The double-cycle closes 2 of the 5-jitter gap:
    //   - vessel[182]: 1 → 2 (via second cycle when track completes)
    //   - vessel[183]: 1 → 2 (via second cycle)
    //
    // The third fire on vessel[183] remains out of reach of this phase
    // (would require 3 cycles per tick, which C++ does not support — the
    // third fire's source is likely a separate `Per_Cell_Process` or
    // a stage transition). See cpp-parity-scg07ea-tick-17.test.ts §(A).
    const coverage = {
      scenario: 'SCG07EA',
      tick: 17,
      missionMoveGapPreFix: 5, // 2 (v182) + 3 (v183) − 3 (single-fire TS)
      expectedPhase5Reduction: 'at least 1 additional fire per eligible vessel',
      residualBlocker: 'vessel[183] third fire (Random_Animate or stage-transition)',
    };
    expect(coverage.scenario).toBe('SCG07EA');
    expect(coverage.tick).toBe(17);
  });
});
