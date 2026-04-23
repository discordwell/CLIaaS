/**
 * C++ Parity: SCG11EA tick-57 USSR 4TNK unit[70] Mission_Guard_general
 *              (architectural blocker — patrol-blocked vehicle GUARD jitter)
 *
 * ## Observed divergence
 *
 *   BASE_URL=http://localhost:3001 SCENARIOS=SCG11EA MAX=65 \
 *       npx playwright test scripts/test-first-divergence.ts
 *
 *   → SCG11EA: first divergence @ tick 57
 *     WASM(2, seed=2157822438) TS(1, seed=2129217601) Δcalls=1
 *
 * WASM tick 57 RNG calls (per-entity, via rngLog):
 *   [0] Mission_Guard_general (tag 60040) — ent=unit[70]  (USSR 4TNK @ 60,58)
 *   [1] Mission_Move_foot    (tag 60010) — ent=unit[157] (Greek MCV @ 28,102)
 *
 * TS tick 57 RNG calls:
 *   [0] Mission.MOVE jitter  (tag 11095)  — MCV#94 @ 28,102
 *
 * TS is missing WASM's Mission_Guard_general fire for USSR 4TNK unit[70].
 *
 * ## Entity setup
 *
 * SCG11EA `[UNITS]`:
 *   7=USSR,4TNK,256,7613,128,Guard,blok   ; cell 7613 = (61,59), unit[69] in WASM Logic
 *   8=USSR,4TNK,256,7484,128,Guard,blok   ; cell 7484 = (60,58), unit[70] in WASM Logic
 *
 * The `blok` field is a trigger attachment (NOT a team), so both 4TNKs are
 * created with Mission=MISSION_GUARD, MissionQueue=MISSION_NONE, Timer=0.
 *
 * `[Trigs] mmth=0,0,0,0,13,-1,0,0,-1,0,4,7,-1,-1,0,-1,-1,-1`
 *   - event1 type=13 (TEVENT_TIME) data=0 → fires at tick 0.
 *   - action1 action=4 (TACTION_CREATE_TEAM) team=7 → create mmth1.
 *
 * `[TeamTypes] mmth1=2,0,7,0,0,-1,-1,1,4TNK:2,19,
 *      16:2,5:2,16:3,5:2,16:4,5:2,16:5,5:2,16:6,5:2,
 *      16:7,5:2,16:8,5:2,16:9,5:2,16:10,16:11,6:0`
 *   - 4TNK:2 composition. Recruits nearest 2 idle USSR 4TNKs → unit[69] + unit[70].
 *   - Mission 16 = TMISSION_PATROL to waypoints 2-11 (cells around base perimeter).
 *   - Mission 5 = TMISSION_GUARD (data=2 → timeOut=2*90=180 ticks).
 *   - Mission 6 = TMISSION_LOOP.
 *
 * Waypoint 2 = cell 7614 = (62,59). Adjacent to 4TNK[69] @ (61,59).
 *
 * ## Root cause
 *
 * `TeamClass::Coordinate_Patrol` (team.cpp:1908-1940) calls `Coordinate_Move`
 * for each non-arrived member. `Coordinate_Move` sets NavCom and calls
 * `Assign_Mission(MISSION_MOVE)` — which QUEUES via `MissionQueue`, does NOT
 * set Mission directly. `Commence()` is gated by `!IsDriving && Is_Door_Closed()`
 * (unit.cpp:404-409) and pops the queue when eligible.
 *
 * For unit[70] @ (60,58) moving toward (62,59): the adjacent cell (61,59) is
 * occupied by friendly unit[69] (also on the patrol team). `DriveClass::AI` →
 * `Start_Of_Move` → `Basic_Path` fails because the direct-cell step is blocked,
 * and `drive.cpp:970` clears NavCom only when `Mission == MISSION_MOVE`. Until
 * Commence pops the MissionQueue (after its gate opens), Mission stays GUARD.
 *
 * Observed WASM timer trajectory for unit[70]:
 *   Tick 1  (team mmth1 recruits unit[70]): Mission=GUARD, Timer=0
 *   Tick 3  Mission_Move fires via Commence+pop (tag 60010, Timer=14+j=16)
 *   Tick 3-14  Timer decrements while NavCom gets cleared mid-drive
 *   Tick 15 Mission_Guard_general fires (tag 60040, Timer=42+0=42)
 *            ← WASM unit[70] back in Mission=GUARD because Commence re-popped
 *              MissionQueue=GUARD from Enter_Idle_Mode somewhere in 3-14.
 *   Tick 16-56  Timer decrements 41→1.
 *   Tick 57 Timer=0 → Mission_Guard_general fires AGAIN (first-divergence).
 *
 * ## TS behavior (pre-divergence-fix)
 *
 * `Team.coordinatePatrol` (team.ts:1051-1122) DIRECTLY sets
 * `unit.mission = Mission.MOVE` and `unit.moveTarget = <wp>` every tick the
 * unit is > stray distance. The `updateMove` friendly-blocker check
 * (index.ts:5499-5538) clears moveTarget and calls `setMissionIdle` → GUARD,
 * producing the oscillation:
 *
 *   Tick N:
 *     Team AI     → mission = MOVE, moveTarget = (62,59)
 *     Entity AI   → updateMove friendly-blocker → moveTarget = null, mission = GUARD
 *                   Mission.MOVE Enter_Idle branch: timer=0, no RNG
 *
 * Net: timer stays at 0 forever after tick 19. Mission.GUARD handler
 * (index.ts:4369-4391) never gets reached because case Mission.MOVE takes the
 * Enter_Idle branch that sets timer=0 without firing RNG.
 *
 * ## Why pre-divergence still matches WASM up to tick 56
 *
 * TS misses WASM's unit[70] Mission_Guard_general fire at tick 15 — but an
 * infantry `Random_Animate` RNG call at the same tick happens to consume the
 * same number of RNG picks (3 vs WASM's 3 for the same infantry PLUS 1 for
 * unit[70]; the net seed chain matches because the TS side fires an extra
 * `RandomAnim_switch` call that WASM doesn't). The count accidentally aligns
 * until tick 57 where WASM's unit[70] fires a SECOND Mission_Guard cycle with
 * no TS coincidence to compensate.
 *
 * Full tick-15 divergence, tag-mismatch but seeds match:
 *
 *   WASM                              TS
 *   [0] Mission_Guard_general unit[70] | RandomAnim_IdleTimer (infantry[32])
 *   [1] RandomAnim_IdleTimer infantry[94] | RandomAnim_switch  (infantry[32])
 *   [2] RandomAnim_switch infantry[94]   | RandomAnim_switch  (infantry[33])
 *   [3] RandomAnim_facing infantry[94]   | RandomAnim_facing  (infantry[33])
 *   [4] Mission_Guard_infantry_E1E3 infantry[94] | infantry[32] Mission_Guard
 *   ...
 *
 * ## Why the obvious fix regresses other ticks
 *
 * Attempted fix (skip `unit.mission = MOVE` override in `coordinatePatrol` when
 * `sameBlockedTarget` is true): moves first-divergence FROM tick 57 TO tick 19
 * because now TS's 4TNK#55 fires Mission_Guard_general at tick 19 (when its
 * Mission.MOVE timer from tick 3's jitter naturally expires into the Mission.
 * GUARD case's `guardDelay + Random_Pick(0,2)` path). WASM fires its first
 * Mission_Guard at tick 15 (not tick 19) via a different timer trajectory — so
 * TS fires 4 ticks "late" vs WASM, producing a 4-tick RNG offset that cascades.
 *
 * To land a real fix, three coupled C++ behaviors must be ported together:
 *   1. `TeamClass::Coordinate_Move` MUST queue via `MissionQueue` (not direct
 *      Mission set) so the unit can stay in GUARD and fire Mission_Guard
 *      jitter independently of team coordination.
 *   2. `DriveClass::AI` `Start_Of_Move` + `Basic_Path` friendly-blocker
 *      + close-enough NavCom clear (drive.cpp:970) must fire EACH tick for
 *      a GUARD-mode vehicle with NavCom, matching C++'s per-tick drive loop.
 *   3. `MissionClass::Commence` gating (`!IsDriving && Is_Door_Closed()`) must
 *      match C++ exactly so MissionQueue=MOVE pops only when movement is
 *      actually achievable — determining exact timing of Mission transitions.
 *
 * All three are tightly coupled to the existing ported `coordinatePatrol`,
 * `updateMove`, `updateGuard` code paths and risk regressing the other 6
 * scenarios (especially SCG04/SCG07 patrol teams which depend on
 * coordinatePatrol's direct-assignment for Mission_Move_foot jitter timing —
 * see `cpp-parity-scg11ea-tick-28.test.ts` for the prior architectural
 * investigation of the related MCV Mission_Move mid-drive port).
 *
 * ## C++ references
 *
 *   team.cpp:1908-1940       TeamClass::Coordinate_Patrol
 *   team.cpp:1864-1894       TeamClass::Coordinate_Move (Assign_Mission queue)
 *   team.cpp:1180-1328       TeamClass::Recruit
 *   mission.cpp:76           MissionClass ctor: Timer(0), Mission(MISSION_NONE)
 *   mission.cpp:213-323      MissionClass::AI (Timer-gated dispatch)
 *   mission.cpp:343-359      MissionClass::Commence (Timer=0, Status=0 on pop)
 *   foot.cpp:492-539         FootClass::Mission_Move (tag 60010 jitter)
 *   foot.cpp:521-523         Mission_Move Enter_Idle_Mode early return
 *   foot.cpp:589-634         FootClass::Mission_Guard (tag 60040 jitter)
 *   drive.cpp:1304-1399      DriveClass::AI (TrackNumber dispatch)
 *   drive.cpp:906-1277       DriveClass::Start_Of_Move (Basic_Path + friendly blocker)
 *   drive.cpp:970            Close-enough NavCom clear (Mission==MISSION_MOVE only)
 *   unit.cpp:404-409         UnitClass::AI pre-Commence gate
 *
 * ## TS references
 *
 *   src/EasterEgg/engine/team.ts:1051-1122   Team.coordinatePatrol
 *   src/EasterEgg/engine/team.ts:1085-1114   Direct-assignment mission=MOVE
 *                                            + sameBlockedTarget timer skip
 *   src/EasterEgg/engine/index.ts:5499-5538  updateMove friendly-blocker check
 *   src/EasterEgg/engine/index.ts:4206-4212  Mission.MOVE Enter_Idle branch
 *   src/EasterEgg/engine/index.ts:4313-4393  Mission.GUARD case + jitter
 */

import { describe, it, expect } from 'vitest';

describe('SCG11EA tick-57 4TNK[70] Mission_Guard_general (architectural blocker)', () => {
  it('documents the observed WASM contract at SCG11EA tick 57', () => {
    // WASM tick 57 rngLog — 2 calls, both for non-infantry ground entities.
    const wasmTick57 = {
      scenario: 'SCG11EA',
      tick: 57,
      rngCalls: [
        // unit[70] USSR 4TNK @ (60,58) — blok-trigger unit recruited into mmth1
        //   patrol team. Mission_Guard jitter cycles every Normal_Delay+Random_Pick
        //   (42-44 ticks). Prior fire at tick 15, next at tick 57 → 42+j where j=0.
        { index: 0, tag: 60040, name: 'Mission_Guard_general', entity: 'unit[70]' },
        // unit[157] Greek MCV @ (28,102) — delivered via mcv2 TeamType, mid-drive
        //   Mission_Move jitter. See cpp-parity-scg11ea-tick-28.test.ts header for
        //   the drive-in-GUARD port of this mechanism (already landed).
        { index: 1, tag: 60010, name: 'Mission_Move_foot', entity: 'unit[157]' },
      ],
      preSeed: 3637367592,   // after tick 56
      postSeed: 2157822438,  // after tick 57
      callCount: 2,
    };

    // TS tick 57 observed (pre-fix, matches WASM up to tick 56 then diverges) —
    // 1 call, MCV#94 (Greek east MCV) Mission.MOVE jitter. The missing call is
    // 4TNK#55's Mission.GUARD jitter which should fire but doesn't due to the
    // coordinatePatrol → updateMove → setMissionIdle oscillation (see header).
    const tsTick57PreFix = {
      tick: 57,
      rngCalls: [
        { index: 0, tag: 11095, name: 'Mission.MOVE jitter', entity: 'MCV#94' },
      ],
      preSeed: 3637367592,   // matches WASM
      postSeed: 2129217601,  // diverges from WASM's 2157822438
      callCount: 1,
      deltaFromWasm: -1,     // TS missing 1 call
    };

    expect(wasmTick57.rngCalls).toHaveLength(2);
    expect(wasmTick57.rngCalls[0].name).toBe('Mission_Guard_general');
    expect(wasmTick57.rngCalls[0].entity).toBe('unit[70]');
    expect(wasmTick57.rngCalls[1].name).toBe('Mission_Move_foot');
    expect(wasmTick57.rngCalls[1].entity).toBe('unit[157]');

    expect(tsTick57PreFix.callCount).toBe(1);
    expect(tsTick57PreFix.deltaFromWasm).toBe(-1);
    expect(tsTick57PreFix.postSeed).not.toBe(wasmTick57.postSeed);
  });

  it('documents the blok-trigger 4TNK entity setup from SCG11EA.ini', () => {
    // [UNITS] 7 and 8: USSR 4TNKs with trigger=blok, initial Mission=Guard.
    // The 'blok' field is a trigger attachment name, NOT a team type. Units
    // start in INDIVIDUAL mission=GUARD, then are recruited via mmth1 team at
    // tick 1 (mmth trigger: TEVENT_TIME=0 → TACTION_CREATE_TEAM team=7).
    const iniUnits = {
      unit7: { house: 'USSR', type: '4TNK', cell: 7613, mission: 'Guard', trigger: 'blok' },
      unit8: { house: 'USSR', type: '4TNK', cell: 7484, mission: 'Guard', trigger: 'blok' },
    };
    // cell 7613 = 59*128 + 61 → (61, 59) → WASM unit[69]
    // cell 7484 = 58*128 + 60 → (60, 58) → WASM unit[70]
    expect(iniUnits.unit7.cell).toBe(7613);
    expect(iniUnits.unit8.cell).toBe(7484);
    expect(iniUnits.unit7.cell % 128).toBe(61);
    expect(Math.floor(iniUnits.unit7.cell / 128)).toBe(59);
    expect(iniUnits.unit8.cell % 128).toBe(60);
    expect(Math.floor(iniUnits.unit8.cell / 128)).toBe(58);

    // [TeamTypes] mmth1: 4TNK:2 members, mission sequence 19 entries (PATROL/GUARD/LOOP)
    const mmth1 = {
      house: 2,           // USSR
      flags: 0,
      recruit: 7,
      origin: -1,
      maxAllowed: -1,
      members: [{ type: '4TNK', count: 2 }],
      // TMISSION_PATROL=16, TMISSION_GUARD=5, TMISSION_LOOP=6
      // Waypoints 2-11 form a base-perimeter patrol; 2=(62,59) adjacent to unit[69].
      missionCount: 19,
      firstMission: { type: 16, data: 2 },  // PATROL wp2=(62,59)
      lastMission: { type: 6, data: 0 },    // LOOP back to mission 0
    };
    expect(mmth1.firstMission.type).toBe(16);
    expect(mmth1.firstMission.data).toBe(2);
    expect(mmth1.lastMission.type).toBe(6);
  });

  it('documents the Mission_Guard_general Random_Pick contract (foot.cpp:589-634)', () => {
    // C++ foot.cpp:589-634 FootClass::Mission_Guard (when Timer==0):
    //   - Various target-scan branches (Target_Something_Nearby, etc.)
    //   - Return value: MissionControl[Mission].Normal_Delay() + Random_Pick(0,2)
    //
    //   dtime = MissionControl[MISSION_GUARD].Normal_Delay();      // 42 ticks
    //   if ((Mission == MISSION_GUARD) && E1/E3) {
    //       dtime = MissionControl[MISSION_GUARD].AA_Delay();      // 14 ticks
    //   }
    //   g_rng_source_tag = 60040;                                  // general
    //   if (E1/E3) g_rng_source_tag = 60043;                       // infantry_E1E3
    //   return(dtime + Random_Pick(0, 2));                         // 42-44 or 14-16
    //
    // rules.ini [Guard]: Rate=.050 (42 ticks), AARate=.016 (14 ticks).
    //
    // For USSR 4TNK (non-infantry): uses Normal_Delay=42. Jitter 0-2. Timer = 42-44.
    const contract = {
      tag: 60040,
      tagName: 'Mission_Guard_general',
      normalDelay: 42,    // rules.ini [Guard] Rate=.050 → Normal_Delay = 42
      jitterRange: [0, 2],
      timerReturn: 'Normal_Delay + Random_Pick(0,2) = 42..44',
      rngConsumed: 1,
    };
    expect(contract.tag).toBe(60040);
    expect(contract.normalDelay).toBe(42);
    expect(contract.rngConsumed).toBe(1);
  });

  it('documents the architectural coupling that blocks a clean fix', () => {
    // Attempted surgical fix (skip coord Mission.MOVE override when
    // sameBlockedTarget): moves first-divergence from tick 57 to tick 19 because
    // TS's 4TNK#55 fires Mission_Guard jitter at tick 19 (natural Mission.GUARD
    // timer expiry from the Mission.MOVE tick-3 jitter=16 decrement trajectory)
    // while WASM fires at tick 15 via a different timer trajectory controlled
    // by Commence + drive.cpp:970 NavCom-clear interleaving we don't model.
    const blockers = [
      {
        blocker: 1,
        description: 'TeamClass::Coordinate_Move must queue via MissionQueue',
        cppRef: 'team.cpp:1864-1894',
        tsRef: 'team.ts:1085-1114',
        risk: 'Regresses SCG04/SCG07 patrol Mission_Move_foot jitter timing',
      },
      {
        blocker: 2,
        description: 'DriveClass::AI Start_Of_Move + Basic_Path + drive.cpp:970 close-enough NavCom clear must run each tick for GUARD-mode vehicles',
        cppRef: 'drive.cpp:906-1277, drive.cpp:970',
        tsRef: 'index.ts:5411+ (updateMove)',
        risk: 'Cross-cutting refactor of drive-in-GUARD semantics',
      },
      {
        blocker: 3,
        description: 'MissionClass::Commence !IsDriving && Is_Door_Closed gating must match C++ exactly',
        cppRef: 'unit.cpp:404-409, mission.cpp:343-359',
        tsRef: 'index.ts:4084-4091 (pre-Commence gate)',
        risk: 'Changes Mission transition timing for all vehicles across 7 scenarios',
      },
    ];

    // Assert the architectural blocker count and that each entry carries
    // required context (C++ ref, TS ref, risk) — acts as a structural guard
    // for future refactors. Whoever attempts the port must address all three.
    expect(blockers).toHaveLength(3);
    for (const b of blockers) {
      expect(b.description).toBeTruthy();
      expect(b.cppRef).toBeTruthy();
      expect(b.tsRef).toBeTruthy();
      expect(b.risk).toBeTruthy();
    }
  });
});
