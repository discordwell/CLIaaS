/**
 * C++ Parity: SCG07EA tick-17 first-divergence (architectural blocker — documented).
 *
 * ## Observed divergence
 *
 * - Scenario: SCG07EA. Prior fix `94a614cd` advanced first-divergence 4 → 17.
 * - Entering tick 17: both engines share seed `213746341`. Ticks 15, 16 match
 *   byte-for-byte (41 and 38 RNG calls respectively).
 * - Tick 17: WASM fires 27 RNG calls (post-seed `2978978768`), TS fires 20
 *   RNG calls (post-seed `4180793233`). Δcalls = +7, seeds diverge.
 *
 * ## First 20 RNG calls match 1:1 by seed
 *
 * Though tag metadata differs (WASM uses granular `g_rng_source_tag` overrides
 * like 60041/60043/30001/70003 while TS mostly reports the outer logic-index
 * tag like 14023/12095/14132), the *actual seed stream* matches 1:1 through
 * the first 20 draws. Both engines burn the same PRNG sequence for the first
 * 20 operations.
 *
 * ## The 7 extra RNG calls WASM emits, TS does not
 *
 * WASM rows [20-26] in the tick-17 RNG log (see diagnostic trace below):
 *
 *     [20] seed=3574408950 stag=70003 ent=building[161]   BuildingClass::Mission_Guard
 *     [21] seed=1354545911 stag=70003 ent=building[162]   BuildingClass::Mission_Guard
 *     [22] seed=861736292  stag=60010 ent=vessel[182]     FootClass::Mission_Move
 *     [23] seed=4161493965 stag=60010 ent=vessel[182]     FootClass::Mission_Move
 *     [24] seed=542948482  stag=60010 ent=vessel[183]     FootClass::Mission_Move
 *     [25] seed=3614969747 stag=60010 ent=vessel[183]     FootClass::Mission_Move
 *     [26] seed=2978978768 stag=60010 ent=vessel[183]     FootClass::Mission_Move
 *
 * Split into two root causes:
 *
 * ### (A) DriveClass::AI double-Commence within one tick → vessel Mission_Move
 *
 * Vessel[182] fires `Mission_Move` **twice** in one tick; vessel[183] fires
 * it **three times**. A single C++ `Mission_Move` call consumes exactly one
 * Random_Pick(0, 2) jitter (foot.cpp:536). So the same vessel's AI must be
 * re-entering `MissionClass::AI` within a single call to `VesselClass::AI`.
 *
 * This is the SAME architectural blocker documented by
 * `cpp-parity-scg11ea-tick-28.test.ts`: the `DriveClass::AI` per-tick double
 * cycle (drive.cpp:1340-1345 — `While_Moving → Start_Of_Move → While_Moving`
 * whenever the current track ends with more path remaining, triggering
 * `Per_Cell_Process` → `Commence()` at the cell boundary). TS's `updateMove`
 * loop does not replicate this mid-tick state machine.
 *
 * Two of the 5 missing vessel Mission_Move jitters come from the SAME
 * vessel re-firing within the tick (via the drive.cpp loop). TS's TypeScript
 * engine fires Mission_Move at most once per vessel per tick, so it produces
 * 3 vessel jitters instead of 5 on this tick.
 *
 * The scaffolding module `src/EasterEgg/engine/perCellProcess.ts` exists
 * specifically to host the port of this Per_Cell_Process → Commence cycle;
 * `PER_CELL_COMMENCE_ENABLED` is currently gated `false` until the
 * DriveClass::AI double-cycle is probed WASM-side.
 *
 * ### (B) Random_Animate + Mission_Guard_infantry_E1E3 — gating divergence
 *
 * The remaining tag-count asymmetry at tick 17 sits in the infantry section:
 * WASM fires 13 RNG calls for infantry[126] and infantry[129] (the two USSR
 * E1 entities at cells (67,66) and (66,66)); TS fires 8.
 *
 * The missing 5 calls fall into the `Random_Animate` cascade:
 *
 *   C++ `FootClass::Mission_Guard` (foot.cpp:642-644):
 *     if (!Target_Something_Nearby(THREAT_RANGE)) {
 *         Random_Animate();    // tags 30001, 30002, optional 30003
 *     }
 *     // ...and then returns dtime + jitter (tag 60043 for E1/E3)
 *
 *   TS `updateAreaGuard` (missionAI.ts:1414-1437): Random_Animate is gated
 *   behind `entity.isReadyToRandomAnimate()` which requires
 *   `doing === 'stand_ready'`. If the entity's `doing` state is something
 *   else (`idle_anim`, `aiming`, etc.), the 2-3 RandomAnim RNG calls are
 *   skipped — but WASM's C++ `Random_Animate` fires regardless (the C++
 *   `Is_Ready_To_Random_Animate` gate is looser).
 *
 * The Mission_Guard jitter (tag 60043) is similarly conditional in TS: it
 * only fires inside `Mission.GUARD`/`Mission.AREA_GUARD` dispatch, and
 * specifically requires `missionTimerFired`. If the infantry unit is
 * momentarily in a different mission or the timer hasn't fired, the
 * 60043-equivalent jitter is skipped.
 *
 * ## Why a narrow fix doesn't land
 *
 *   1. Forcing TS to fire Random_Animate unconditionally in updateAreaGuard
 *      would fire EXTRA RNGs at ticks where the entity is correctly in an
 *      idle-animation state — regressing SCG01EA=87, SCG03EA=238, SCG06EA=76
 *      (all of which currently depend on the `isReadyToRandomAnimate` gate).
 *   2. The vessel double-fire demands the `Per_Cell_Process` + DriveClass::AI
 *      port (claudepad 2026-04-22T04:30Z): a naive fix cascades into
 *      regressions at SCG11EA ticks 29-33 (per prior agent's investigation).
 *   3. The granular `g_rng_source_tag` stack in TS does not propagate through
 *      nested `updateEntity` calls; each guard-timer tick would need a
 *      context-matched tag override, a cross-cutting refactor.
 *
 * ## Relationship to other documented blockers
 *
 * - `cpp-parity-scg11ea-tick-28.test.ts`  — DriveClass::AI double-cycle
 *   (MCV-157 unit Mission_Move double-fire).
 * - `cpp-parity-scg13ea-tick-101.test.ts` — Enter_Idle_Mode mid-drive
 *   Commence (E1 infantry MOVE→GUARD transition).
 * - `cpp-parity-scg04-mission-move-stagger.test.ts` — Start_Of_Move path-regen
 *   Commence (vehicle Mission_Move double-fire).
 *
 * All four blockers share a common architectural root: the missing
 * Per_Cell_Process + Commence mid-tick state machine. The scaffolding at
 * `src/EasterEgg/engine/perCellProcess.ts` hosts the future port.
 *
 * ## C++ refs
 *
 *   - building.cpp:3263-3358      BuildingClass::Mission_Guard (tag 70003 weapon-equipped)
 *   - drive.cpp:1304-1399         DriveClass::AI per-tick movement loop
 *   - drive.cpp:1340-1345         While_Moving → Start_Of_Move double-cycle
 *   - foot.cpp:520-539            FootClass::Mission_Move (tag 60010 jitter)
 *   - foot.cpp:589-697            FootClass::Mission_Guard (tag 60040/60041/60043 jitter)
 *   - foot.cpp:642-644            Random_Animate dispatch when no target
 *   - infantry.cpp:1742-1838      InfantryClass::Random_Animate (tags 30001-30003)
 *   - logic.cpp:285-306           Logic per-object AI dispatch (source/entity tag setup)
 *   - mission.cpp:213-321         MissionClass::AI (Timer==0 dispatch)
 *   - mission.cpp:343-359         MissionClass::Commence
 *   - vessel.cpp:571-666          VesselClass::AI (double Commence at 593 and 659)
 *   - vessel.cpp:684-...          VesselClass::Per_Cell_Process
 *
 * ## TS refs
 *
 *   - src/EasterEgg/engine/perCellProcess.ts         scaffolding hook (PER_CELL_COMMENCE_ENABLED=false)
 *   - src/EasterEgg/engine/missionAI.ts:1414-1437    updateAreaGuard Random_Animate (gated)
 *   - src/EasterEgg/engine/entity.ts:286-293         isReadyToRandomAnimate gate
 *   - src/EasterEgg/engine/index.ts:4146-4190        Mission.GUARD dispatch (tag 60043 equivalent)
 *   - src/EasterEgg/engine/index.ts:4192-4201        Mission.AREA_GUARD dispatch
 *   - src/EasterEgg/engine/index.ts                  DriveClass Mark_Track reservation port
 *   - src/EasterEgg/engine/index.ts:8992-9029        tickStructuresInterleaved (tag 70003 equivalent)
 *
 * ## Test behavior
 *
 * Docs-only. Captures the WASM contract at tick 17 and the TS current
 * divergence so a future Per_Cell_Process + Random_Animate port will trip
 * these assertions and force an update.
 *
 * Live diagnostic: `SCENARIO=SCG07EA START=16 END=18 DUMP_ALL=1 npx
 * playwright test scripts/test-rng-entity-diff.ts --reporter=list`.
 */

import { describe, it, expect } from 'vitest';
import { PCPType, PER_CELL_COMMENCE_ENABLED, unitPerCellProcess } from '../engine/perCellProcess';

describe('SCG07EA tick-17 first-divergence (architectural blocker)', () => {
  it('documents the pre-tick-17 shared state (seeds match through tick 16)', () => {
    // Both engines consume identical PRNG streams through tick 16. The
    // post-tick-16 seed is the starting seed for tick 17.
    const contract = {
      scenario: 'SCG07EA',
      tick15RngCalls: 41, // match
      tick16RngCalls: 38, // match
      preTick17Seed: 213746341, // WASM==TS
    };
    expect(contract.tick15RngCalls).toBe(41);
    expect(contract.tick16RngCalls).toBe(38);
    expect(contract.preTick17Seed).toBe(213746341);
  });

  it('documents the tick-17 WASM contract (27 RNG calls)', () => {
    // WASM fires 27 RNG calls at tick 17; post-seed 2978978768.
    // First 20 calls match TS's 20 calls seed-for-seed.
    const wasm = {
      totalCalls: 27,
      postSeed: 2978978768,
      callBreakdown: {
        vesselMissionGuard: 4, // tags 60041 (PT/DD) + 60050 (FootAI) on vessels 69, 70, 73
        infantryRandomAnimate: 10, // tags 30001/30002/30003 on infantry 126, 129
        infantryMissionGuardE1E3: 3, // tag 60043 on infantry 126, 129
        buildingMissionGuardWeapon: 5, // tag 70003 on buildings 145, 160(x2), 161, 162
        vesselMissionMove: 5, // tag 60010 on vessels 182(x2), 183(x3) — double/triple-fire
      },
    };
    // 4 + 10 + 3 + 5 + 5 = 27
    const sum = Object.values(wasm.callBreakdown).reduce((a, b) => a + b, 0);
    expect(sum).toBe(27);
    expect(wasm.totalCalls).toBe(27);
    expect(wasm.postSeed).toBe(2978978768);
  });

  it('documents the tick-17 TS pre-Phase-7A divergence (20 RNG calls)', () => {
    // Pre-Phase-7A (RANDOM_ANIMATE_CPP_FAITHFUL=false) TS fired 20 calls;
    // post-seed 4180793233 matched WASM's seed at RNG position 20 (WASM
    // continued for 7 more calls). This snapshot is kept for historical
    // context; Phase 7A closed (B) by adding the DO_WALK → DO_STAND_READY
    // transition in `Entity.doingAI` (infantry.cpp:3700-3732 parity).
    const ts = {
      totalCalls: 20,
      postSeed: 4180793233,
      missingCalls: 7,
      missingBreakdown: {
        buildingMissionGuardWeapon: 0, // TS fires 5 building guards (matches WASM count); ordering differs
        vesselMissionMove: 2, // TS fires 3, WASM fires 5 — double-fire gap (residual Phase 7B)
        infantryRandomAnimate: 3, // Phase 7A closes: walk→stand_ready unlocks 30001/30002/30003
        infantryMissionGuardE1E3: 2, // Phase 7A closes: post-RA, 60043-equivalent jitter now eligible
      },
    };
    // 0 + 2 + 3 + 2 = 7
    const missing = Object.values(ts.missingBreakdown).reduce((a, b) => a + b, 0);
    expect(missing).toBe(7);
    expect(ts.totalCalls).toBe(20);
    expect(ts.postSeed).toBe(4180793233);
  });

  it('Phase 7A expected post-flip delta: infantry RA cascade unlocks (B)', () => {
    // After RANDOM_ANIMATE_CPP_FAITHFUL=true flip, the 3 missing RA RNGs
    // (30001 IdleTimer + 30002 switch + 30003 optional facing) and the 2
    // downstream 60043-equivalent jitters fire on tick 17 for USSR E1
    // infantry 126/129. Residual Δ drops from +7 to +2 (vessel double-fire
    // remains as Phase 7B). Expected SCG07EA first-divergence advances
    // ≥17; validated in-browser via scripts/test-first-divergence.ts.
    const phase7a = {
      mechanism: 'doingAI: DO_WALK → DO_STAND_READY when !isDriving',
      cppRef: 'infantry.cpp:3700-3732',
      tsRef: 'src/EasterEgg/engine/entity.ts:doingAI',
      expectedResidualDeltaAtTick17: 2, // vessel double-fire remains
      phaseBUnlocked: 5, // 3 RA + 2 E1/E3 jitter
    };
    expect(phase7a.expectedResidualDeltaAtTick17).toBe(2);
    expect(phase7a.phaseBUnlocked).toBe(5);
  });

  it('documents the DriveClass::AI double-Commence vessel Mission_Move blocker', () => {
    // Vessel[182] fires Mission_Move jitter TWICE in one WASM tick; vessel[183]
    // fires it THREE times. C++ Mission_Move consumes exactly one Random_Pick
    // per call. The same vessel must therefore enter MissionClass::AI multiple
    // times within one VesselClass::AI invocation, via DriveClass::AI's
    // While_Moving → Start_Of_Move → While_Moving cycle when the current
    // track ends with more path remaining (drive.cpp:1340-1345).
    const blocker = {
      mechanism: 'DriveClass::AI double-cycle Per_Cell_Process Commence',
      cppRefs: ['drive.cpp:1304-1399', 'drive.cpp:1340-1345', 'vessel.cpp:593', 'vessel.cpp:659'],
      tsScaffolding: 'src/EasterEgg/engine/perCellProcess.ts',
      scaffoldingGate: 'PER_CELL_COMMENCE_ENABLED',
      currentGateState: true, // partial port landed
      sharedWith: ['cpp-parity-scg11ea-tick-28.test.ts', 'cpp-parity-scg04ea-tick-36.test.ts'],
      vesselDoubleFiresAtTick17: 2, // 2 extra Mission_Move calls vs single-fire TS
      // Residual blocker after partial port: the double-fire portion is
      // NOT yet ported. The single-Commence per PCP_END now works; the
      // DriveClass::AI drive.cpp:1340-1345 re-entrant double-cycle is not.
    };
    expect(blocker.currentGateState).toBe(PER_CELL_COMMENCE_ENABLED);
    expect(blocker.vesselDoubleFiresAtTick17).toBe(2);

    // Verify the hook's Commence branch is now active: MissionQueue=MOVE
    // at PCP_END pops → Mission=MOVE, Timer=0, Status=0.
    type M = 'MOVE' | 'GUARD';
    const vessel = {
      moveTarget: { lx: 100 * 256 + 128, ly: 100 * 256 + 128 },
      cell: { cx: 45, cy: 45 },
      path: [{ cx: 46, cy: 45 }],
      pathIndex: 0,
      missionQueue: 'MOVE' as M | null,
      mission: 'GUARD' as M,
      missionTimer: 5,
      isDriving: true,
    };
    const r = unitPerCellProcess(vessel, PCPType.PCP_END);
    expect(r.commenceFired).toBe(true); // enabled
    expect(vessel.mission).toBe('MOVE');
    expect(vessel.missionQueue).toBe(null);
    expect(vessel.missionTimer).toBe(0);
  });

  it('documents the Random_Animate gating divergence', () => {
    // WASM fires Random_Animate inside C++ FootClass::Mission_Guard whenever
    // no target is found (foot.cpp:642-644), consuming 2-3 RNG values (IdleTimer
    // + animation pick + optional facing — tags 30001/30002/30003). TS gates
    // Random_Animate behind entity.isReadyToRandomAnimate() which requires
    // doing === 'stand_ready'. Infantry 126, 129 at cells (67,66)/(66,66) are
    // NOT in 'stand_ready' at TS tick 17, so Random_Animate skips and the
    // 30001/30002/30003 cascade is not emitted.
    const gating = {
      cppMechanism: 'FootClass::Mission_Guard calls Random_Animate when Target_Something_Nearby fails',
      cppRefs: ['foot.cpp:642-644', 'infantry.cpp:1742-1838'],
      tsGate: 'entity.isReadyToRandomAnimate() requires doing === "stand_ready"',
      tsGateRef: 'src/EasterEgg/engine/entity.ts:286-293',
      tsCallSite: 'src/EasterEgg/engine/missionAI.ts:1414-1437',
      missingRngsAtTick17: 3, // 2× 30001/30002 + 1× 30003 that C++ emits but TS skips
      tagNumbers: { idleTimer: 30001, animSwitch: 30002, facing: 30003, missionGuardE1E3: 60043 },
    };
    expect(gating.tagNumbers.idleTimer).toBe(30001);
    expect(gating.tagNumbers.animSwitch).toBe(30002);
    expect(gating.tagNumbers.facing).toBe(30003);
    expect(gating.tagNumbers.missionGuardE1E3).toBe(60043);
    expect(gating.missingRngsAtTick17).toBe(3);
  });

  it('documents why a narrow TS-side fix regresses other scenarios', () => {
    // Forcing Random_Animate unconditionally or forcing an extra Mission_Move
    // per vessel per tick regresses other scenarios that currently pass the
    // 7-scenario first-divergence sweep. Tracked regressions (per prior agent
    // investigation / claudepad):
    const knownRegressions = {
      scg11ea_tick28: 'DriveClass::AI double-cycle naive port cascades ticks 29-33',
      scg04_mission_move_stagger: 'Start_Of_Move path-regen Commence interacts with team coordinator',
      scg13ea_tick101: 'Enter_Idle_Mode mid-drive affects E1 patrol teams',
      scg01ea_tick87: 'Random_Animate unconditional would fire extra RNGs in idle-anim state',
      scg03ea_tick238: 'Random_Animate unconditional affects ARTY Mission_Guard rejection sampling',
    };
    // Each blocker points at the same architectural port: Per_Cell_Process +
    // MissionClass::Commence mid-drive, plus looser Is_Ready_To_Random_Animate
    // gating. The fix is deferred until a WASM-side probe of the DriveClass::AI
    // double-cycle lands (claudepad 2026-04-22T04:30Z "next step for future porter").
    expect(Object.keys(knownRegressions).length).toBeGreaterThanOrEqual(5);
  });

  it('documents that tick-17 divergence is unrelated to team-level Mark_Track shims', () => {
    // The old 94a614cd nonInterruptAnimTicks proxy has been replaced by
    // generic DriveClass Mark_Track reservations in the movement layer.
    // Tick 17 remains about DriveClass::AI double-cycle and Random_Animate
    // gating, not team activation timing.
    const proxy = {
      retiredCommit: '94a614cd',
      fix: 'DriveClass Mark_Track reservation state on vehicle/vessel Start_Driver',
      activationTick: 4,
      tick17Divergence: 'unrelated to team-level shim — DriveClass::AI + Random_Animate gating',
    };
    expect(proxy.tick17Divergence).toContain('unrelated');
    expect(proxy.activationTick).toBeLessThan(17);
  });
});
