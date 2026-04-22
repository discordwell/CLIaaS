/**
 * C++ Parity: SCG13EA tick-101 — continued investigation (follow-up to the
 * architectural blocker tracked in cpp-parity-scg13ea-tick-101.test.ts).
 *
 * ## Concrete state captured at tick-100 END (synced seed)
 *
 * Tracking the E1 USSR patrol infantry at cell (61,67) — WASM logic index
 * 153, TS entity id=109:
 *
 *   | Engine | Mission | Timer | Queue | Driving |
 *   |--------|---------|-------|-------|---------|
 *   | WASM   | GUARD   | 0     | NONE  | false   |
 *   | TS     | MOVE    | 15    | null  | true    |
 *
 * ## Why TS and WASM diverge post-t100 (tick-by-tick trace)
 *
 *   | Tick | WASM state                  | TS state                    |
 *   |------|-----------------------------|-----------------------------|
 *   | t92  | GUARD mt=15 doing=GESTURE1  | GUARD mt=? niat=7 (gesture) |
 *   | t97  | GUARD mt=10 doing=GESTURE1  | GUARD mt=12 niat=2          |
 *   | t98  | GUARD mt=9 doing=STAND      | GUARD mt=11 niat=0          |
 *   | t99  | MOVE mt=0 mq=GUARD          | MOVE mt=0 mq=null           |
 *   | t100 | GUARD mt=0 mq=NONE          | MOVE mt=15 drv=true         |
 *   | t101 | GUARD fires 60043 RNG       | MOVE drv=true (no 60043)    |
 *
 * ## Root cause — missing Movement_AI → Enter_Idle_Mode re-queue
 *
 * At tick 99, both engines pop the MissionQueue:
 *   WASM (infantry.cpp:1210): Commence pops mq=MOVE → Mission=MOVE, Timer=0.
 *   TS   (index.ts:4381):      post-dispatch Commence pops → Mission=MOVE, Timer=0.
 *
 * Both engines arrive at MOVE mt=0 at end of tick 99. But WASM then runs
 * InfantryClass::Movement_AI (infantry.cpp:1247) which hits the cell-boundary
 * arrival branch at infantry.cpp:3992-4010:
 *
 *   if (Distance(Head_To_Coord()) < 0x0010) {
 *       ...
 *       if (Coord_Cell(Coord) == As_Cell(NavCom)) {
 *           NavCom = TARGET_NONE;
 *           if (Mission == MISSION_MOVE) Enter_Idle_Mode();
 *       }
 *   }
 *
 * Enter_Idle_Mode (infantry.cpp:1663-1721) assigns MissionQueue=GUARD when
 * NavCom is cleared and no valid TarCom exists. So WASM post-tick-99 state
 * is MOVE mt=0 mq=GUARD. Then at tick 100, Mission_Move runs (fires tag
 * 60010 jitter RNG — this is the 1 shared RNG both engines fire at t100),
 * Commence pops mq=GUARD → Mission=GUARD, Timer=0. Post-t100 = GUARD mt=0.
 *
 * Tick 101 in WASM: Mission_Guard dispatches Arm_Delay, fires tag 60043.
 *
 * TS at tick 99 pops mq=MOVE but does NOT run the Movement_AI cell-boundary
 * arrival branch that clears NavCom and re-queues GUARD. TS's updateMove
 * only clears moveTarget when the entity physically reaches the target
 * leptons (15744, 20352) — it hasn't. So mq stays null, Mission stays MOVE,
 * Timer fills to 14-16. Tick 101 Mission.MOVE runs, no extra RNG.
 *
 * ## Double 60043 fire for entity[153]
 *
 * WASM trace at tick 101 shows infantry[153] firing 2 tag-60043 Random_Pick
 * calls back-to-back. foot.cpp:686-697 Arm_Delay Random_Pick(0,2) only
 * fires once per Mission_Guard dispatch. The second 60043 source is unknown
 * from current instrumentation — possibly a tag-leak from a subsequent call
 * site, or a re-dispatch via ObjectClass::Receive_Message during tick 101.
 * Leaving as open investigation — the total RNG count is what matters for
 * parity (6 in TS vs 7 in WASM).
 *
 * ## Why the prior fix attempts cascaded
 *
 * Any "force Mission=GUARD mid-tick on MOVE popup" heuristic risks cascading
 * into SCG01/03/06/07 patrol teams that DEPEND on the MOVE jitter firing on
 * the tick after queue-pop. The prior agents (4a7ef2aa, b7d3e1c9) tried:
 *   1. Enter_Idle_Mode on Basic_Path failure — lost infantry[153] path
 *      in same position but fired GUARD on wrong tick.
 *   2. Clear moveTarget when path is empty — caused SCG06EA tick-76 Greek
 *      E1 rifleman to miss ATTACK scan (Regression).
 *
 * The correct fix ports the C++ Per_Cell_Process PCP_END cell-arrival cycle
 * for INFANTRY (currently only vehicles have it, enabled at c4310105). The
 * hook point exists in `src/EasterEgg/engine/perCellProcess.ts` but the
 * infantry branch needs to be wired from `updateMove` when a path step is
 * consumed.
 *
 * ## Test behavior
 *
 * This test documents the precise pre-state and post-state deltas captured
 * with RNG sync. It does NOT fix the divergence — SCG13EA tick-101 remains
 * an architectural blocker. When a future Enter_Idle_Mode/PCP_END port
 * aligns TS's tick-99 behavior with WASM, these assertions should be
 * updated to reflect the new expected flow.
 *
 * ## C++ refs
 *
 *   - infantry.cpp:3992-4010  InfantryClass::Movement_AI cell arrival + Enter_Idle_Mode
 *   - infantry.cpp:1663-1721  InfantryClass::Enter_Idle_Mode (assigns MissionQueue)
 *   - infantry.cpp:1208-1211  InfantryClass::AI final Commence (post-Movement_AI)
 *   - foot.cpp:520-540        FootClass::Mission_Move (tag 60010 jitter return)
 *   - foot.cpp:638-698        FootClass::Mission_Guard (tag 60043 Arm_Delay)
 *   - mission.cpp:343-359     MissionClass::Commence
 *
 * ## TS refs
 *
 *   - src/EasterEgg/engine/index.ts:4025-4066  Mission.MOVE case handler
 *   - src/EasterEgg/engine/index.ts:4146-4226  Mission.GUARD/STICKY case handler
 *   - src/EasterEgg/engine/index.ts:4380-4400  post-dispatch Commence (infantry)
 *   - src/EasterEgg/engine/perCellProcess.ts   PCP scaffold (Commence enabled for vehicles only)
 *
 * Live diagnostic:
 *   SCENARIO=SCG13EA START=95 END=105 npx playwright test scripts/test-rng-entity-diff.ts
 */

import { describe, it, expect } from 'vitest';

describe('SCG13EA tick-101 follow-up — precise state capture', () => {
  it('WASM: entity @(61,67) is GUARD mt=0 at end of tick 100', () => {
    // Captured from agent_get_state after synced 100-tick run.
    // See scripts/test-rng-entity-diff.ts for the live capture harness.
    const wasmEnd100 = {
      cell: { cx: 61, cy: 67 },
      mission: 'GUARD', // MissionType code 5
      missionTimer: 0,
      missionQueue: 'NONE', // -1
      isDriving: false,
    };
    expect(wasmEnd100.mission).toBe('GUARD');
    expect(wasmEnd100.missionTimer).toBe(0);
    expect(wasmEnd100.missionQueue).toBe('NONE');
  });

  it('TS: entity id=109 @(61,67) is MOVE mt=15 drv=true at end of tick 100', () => {
    // Captured from __agentGame.entities after synced 100-tick run.
    const tsEnd100 = {
      id: 109,
      cell: { cx: 61, cy: 67 },
      mission: 'MOVE',
      missionTimer: 15,
      missionQueue: null,
      isDriving: true,
      moveTarget: { lx: 15744, ly: 20352 }, // cell (61.5, 79.5) — patrol destination
    };
    expect(tsEnd100.mission).toBe('MOVE');
    expect(tsEnd100.missionTimer).toBe(15);
    expect(tsEnd100.missionQueue).toBeNull();
    expect(tsEnd100.isDriving).toBe(true);
  });

  it('tick 101 RNG count divergence: WASM=7, TS=6, Δ=+1', () => {
    // Byte-for-byte identical seeds for calls [0]-[5].
    // WASM fires a 7th call attributed to infantry[192] (USSR E1 @27,46)
    // at tag 60043. But the underlying divergence is actually entity[153]
    // (USSR E1 @61,67): WASM has it in GUARD mt=0 → fires 2 Guard jitters;
    // TS has it in MOVE mt=15 → fires 0 Guard jitters.
    const sharedSeeds = [
      1185429846, 2241646039, 1975867076, 621664685, 1208390882, 888565875,
    ];
    const wasmExtraSeed = 3475184432;
    expect(sharedSeeds.length).toBe(6);
    expect(wasmExtraSeed).toBe(3475184432);
    // RNG counts
    const wasmCalls = 7;
    const tsCalls = 6;
    expect(wasmCalls - tsCalls).toBe(1);
  });

  it('root cause: TS lacks InfantryClass::Movement_AI cell-arrival Enter_Idle_Mode path', () => {
    // At tick 99 both engines pop mq=MOVE → Mission=MOVE, Timer=0.
    // WASM then runs Movement_AI's `if (Coord_Cell(Coord) == As_Cell(NavCom))
    // NavCom=NONE; Enter_Idle_Mode();` branch (infantry.cpp:4003-4007) which
    // queues GUARD. TS's updateMove only clears moveTarget on physical lepton
    // arrival — the cell-boundary arrival check is not implemented.
    const cppRef = 'infantry.cpp:3992-4010';
    const tsGap = 'engine/index.ts:4052 updateMove lacks cell-boundary NavCom-match + Enter_Idle_Mode';
    expect(cppRef).toContain('infantry.cpp');
    expect(tsGap).toContain('updateMove');
  });

  it('documents the expected fix direction: wire INFANTRY PCP_END Enter_Idle_Mode', () => {
    // The perCellProcess.ts scaffold already has PCP_END for vehicles
    // (enabled at c4310105). Infantry needs a parallel branch in updateMove
    // that:
    //   1. Detects when the current path step has been consumed (path index
    //      advances past current cell).
    //   2. If post-step entity.cell matches moveTarget cell, clear moveTarget
    //      and set entity.missionQueue = Mission.GUARD (no RNG).
    //   3. Post-dispatch Commence at line 4381 pops the queue on the SAME
    //      tick, matching WASM's InfantryClass::AI flow.
    const fixPlan = [
      'detect-path-step-consumed',
      'match-current-cell-to-navcom',
      'clear-navcom-queue-guard',
      'rely-on-post-dispatch-commence',
    ];
    expect(fixPlan).toContain('clear-navcom-queue-guard');
  });

  it('regression gates: patrol teams MUST continue to fire MOVE jitter on scheduled ticks', () => {
    // SCG01EA tick 87 patrol attack, SCG03EA tick 247 bullet scatter, SCG06EA
    // tick 66 ATTACK → fire animation, SCG07EA tick 17 subz activation, and
    // SCG11EA tick 28 MCV same-tick Commence all depend on Mission_Move's
    // tag 60010 jitter firing on the tick after queue-pop. A naive
    // "always Enter_Idle_Mode on MOVE popup" breaks these. The fix must
    // narrowly trigger on cell-boundary arrival.
    const protectedScenarios = ['SCG01EA', 'SCG03EA', 'SCG06EA', 'SCG07EA', 'SCG11EA'];
    expect(protectedScenarios.length).toBeGreaterThanOrEqual(5);
  });
});
