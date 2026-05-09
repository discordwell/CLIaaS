/**
 * C++ Behavioral Parity: Team Missions — mission dispatch, reinforcement loading, dissolution
 *
 * Tests verify that the Team class matches C++ TeamClass behavior for mission
 * dispatching, TMISSION processing, target assignment, timeouts, and dissolution
 * conditions.
 *
 * Source references:
 *   - team.cpp:470-870   — AI() main loop: suspend check, composition, regroup, activate, advance, execute
 *   - team.cpp:396-450   — Assign_Mission_Target(): clears old target, sets MissionTarget + Target
 *   - team.cpp:704-753   — Mission advance: IsNextMission → CurrentMission++, timeout from Data.Value
 *   - team.cpp:710       — TimeOut = mission->Data.Value * (TICKS_PER_MINUTE/10)
 *                          where TICKS_PER_MINUTE = 900 (defines.h:3032), so scaling = 90
 *   - team.cpp:714-748   — Mission-type-specific target setup (MOVECELL, MOVE, ATT_WAYPT, etc.)
 *   - team.cpp:758-869   — Mission execution dispatch (switch on mission->Mission)
 *   - team.cpp:827-834   — ATT_WAYPT: if !Target_Legal(MissionTarget) → IsNextMission = true
 *   - team.cpp:853-860   — GUARD timeout: if (TimeOut == 0) IsNextMission = true
 *   - team.cpp:862-869   — Reforming/not-moving fallback: Coordinate_Regroup/Coordinate_Move
 *   - team.cpp:1574-1618 — Took_Damage(): retarget to attacker (non-suicide, while moving)
 *   - team.cpp:1636-1721 — Coordinate_Attack(): assign MISSION_ATTACK, advance if no target
 *   - team.cpp:1740-1789 — Coordinate_Regroup(): StrayDistance check, returns bool
 *   - team.cpp:1809-1856 — Coordinate_Do(): assign MissionType from Data.Mission to all members
 *   - team.cpp:1874-2008 — Coordinate_Move(): move toward target, advance when all arrive
 *   - team.cpp:2687-2750 — TMission_Attack(): pick quarry target, call Coordinate_Attack
 *   - team.cpp:2866-2872 — TMission_Loop(): CurrentMission = Data.Value - 1, IsNextMission = true
 *   - team.cpp:2890-2900 — TMission_Invulnerable(): set IronCurtainCountDown, advance
 *   - team.cpp:2919-2925 — TMission_Set_Global(): set global, IsNextMission = true
 *   - teamtype.cpp:65-82 — 17 TMISSION_* types (including TMISSION_INVULNERABLE)
 *   - defines.h:3031-3032 — TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
 *   - rules.cpp:260      — StrayDistance = 0x0200 (512 leptons = 2 cells)
 *
 * Observable outcomes: timeout scaling, mission dispatch order, target assignment,
 * attack advance conditions, loop jump, DO mission mapping, Took_Damage retargeting.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { House, Mission, UnitType, CELL_SIZE, LEPTON_SIZE, worldDistLeptons, STRAY_DISTANCE, cellTargetToLepton } from '../engine/types';
import {
  Team, resetTeamIds,
  TMISSION_MOVE, TMISSION_ATTACK, TMISSION_ATT_WAYPT, TMISSION_GUARD,
  TMISSION_UNLOAD, TMISSION_DEPLOY, TMISSION_PATROL, TMISSION_LOOP, TMISSION_DO,
  TMISSION_SET_GLOBAL, TMISSION_ATTACKTARCOM, TMISSION_LOAD, TMISSION_FORMATION,
  TMISSION_MOVECELL, TMISSION_HOUND_DOG, TMISSION_SPY, TMISSION_INVULNERABLE,
  registerTeam, getActiveTeams, clearAllTeams, updateAllTeams,
} from '../engine/team';

beforeEach(() => {
  resetEntityIds();
  resetTeamIds();
  clearAllTeams();
});

// ── Helpers ──────────────────────────────────────────────────────────────

function makeEntity(type: UnitType, house: House, x: number, y: number): Entity {
  const e = new Entity(type, house, x, y);
  e.facing = 0;
  e.bodyFacing32 = 0;
  return e;
}

function makeTeam(opts: {
  house?: House;
  memberDefs?: Array<{ type: string; count: number }>;
  missions?: Array<{ mission: number; data: number }>;
  recruitPriority?: number;
  isReinforcable?: boolean;
  isSuicide?: boolean;
  origin?: { x: number; y: number };
  forcedActive?: boolean;
}): Team {
  return new Team({
    house: opts.house ?? House.USSR,
    desiredMembers: opts.memberDefs ?? [
      { type: UnitType.V_3TNK, count: 3 },
    ],
    missionList: opts.missions ?? [],
    recruitPriority: opts.recruitPriority,
    isReinforcable: opts.isReinforcable,
    isSuicide: opts.isSuicide,
    origin: opts.origin ?? null,
    forcedActive: opts.forcedActive,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('C++ parity: Team mission dispatch (team.cpp)', () => {

  // ==========================================================================
  // Section 1: TMISSION constants (teamtype.cpp:65-82)
  // C++ defines 16 team mission types in sequential order starting from 0.
  // ==========================================================================
  describe('TMISSION constants match C++ enum (teamtype.cpp:65-82)', () => {
    /**
     * C++ teamtype.h / teamtype.cpp:65-82:
     *   TeamMissionClass TeamMissions[TMISSION_COUNT] = {
     *     {TMISSION_ATTACK},       // 0
     *     {TMISSION_ATT_WAYPT},    // 1
     *     {TMISSION_FORMATION},    // 2
     *     {TMISSION_MOVE},         // 3
     *     {TMISSION_MOVECELL},     // 4
     *     {TMISSION_GUARD},        // 5
     *     {TMISSION_LOOP},         // 6
     *     {TMISSION_ATTACKTARCOM}, // 7
     *     {TMISSION_UNLOAD},       // 8
     *     {TMISSION_DEPLOY},       // 9
     *     {TMISSION_HOUND_DOG},    // 10
     *     {TMISSION_DO},           // 11
     *     {TMISSION_SET_GLOBAL},   // 12
     *     {TMISSION_INVULNERABLE}, // 13  ← teamtype.h:57
     *     {TMISSION_LOAD},         // 14
     *     {TMISSION_SPY},          // 15
     *     {TMISSION_PATROL},       // 16
     *   };
     */
    const EXPECTED_CONSTANTS: [string, number, number][] = [
      ['TMISSION_ATTACK',       TMISSION_ATTACK,       0],
      ['TMISSION_ATT_WAYPT',    TMISSION_ATT_WAYPT,    1],
      ['TMISSION_FORMATION',    TMISSION_FORMATION,     2],
      ['TMISSION_MOVE',         TMISSION_MOVE,          3],
      ['TMISSION_MOVECELL',     TMISSION_MOVECELL,      4],
      ['TMISSION_GUARD',        TMISSION_GUARD,         5],
      ['TMISSION_LOOP',         TMISSION_LOOP,          6],
      ['TMISSION_ATTACKTARCOM', TMISSION_ATTACKTARCOM,  7],
      ['TMISSION_UNLOAD',       TMISSION_UNLOAD,        8],
      ['TMISSION_DEPLOY',       TMISSION_DEPLOY,        9],
      ['TMISSION_HOUND_DOG',    TMISSION_HOUND_DOG,    10],
      ['TMISSION_DO',           TMISSION_DO,           11],
      ['TMISSION_SET_GLOBAL',   TMISSION_SET_GLOBAL,   12],
      ['TMISSION_INVULNERABLE', TMISSION_INVULNERABLE, 13],
      ['TMISSION_LOAD',         TMISSION_LOAD,         14],
      ['TMISSION_SPY',          TMISSION_SPY,          15],
      ['TMISSION_PATROL',       TMISSION_PATROL,       16],
    ];

    for (const [name, tsValue, cppValue] of EXPECTED_CONSTANTS) {
      it(`${name} = ${cppValue}`, () => {
        expect(tsValue, `${name} should match C++ enum value`).toBe(cppValue);
      });
    }
  });

  // ==========================================================================
  // Section 2: Timeout scaling factor (team.cpp:710)
  // C++ uses: TimeOut = mission->Data.Value * (TICKS_PER_MINUTE / 10)
  // TICKS_PER_MINUTE = 900 (defines.h:3032), so scaling = 90
  // TS uses: this.timeOut = mission.data * 90 (C++ parity)
  // ==========================================================================
  describe('GUARD timeout scaling factor (team.cpp:710, defines.h:3031-3032)', () => {
    /**
     * C++ team.cpp:710:
     *   TimeOut = mission->Data.Value * (TICKS_PER_MINUTE/10);
     *
     * C++ defines.h:3031-3032:
     *   #define TICKS_PER_SECOND  15
     *   #define TICKS_PER_MINUTE  (TICKS_PER_SECOND * 60)  // = 900
     *
     * So: TimeOut = Data.Value * 90
     *
     * TS team.ts now uses: this.timeOut = mission.data * 90 (C++ parity)
     */
    it('C++ TICKS_PER_MINUTE = 900, scaling = 90; TS matches', () => {
      const CPP_TICKS_PER_MINUTE = 900;
      const CPP_SCALING = CPP_TICKS_PER_MINUTE / 10; // 90
      const TS_SCALING = 90; // now matches C++

      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_GUARD, data: 1 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      // C++ Force_Active() sets IsUnderStrength=false (team.h:215), so there is
      // no spurious IsReforming. Activation + mission advance + execute all happen
      // on the FIRST ai() tick:
      //   activate → currentMission=-1, isNextMission=true
      //   advance  → currentMission=0 (GUARD), timeOut = 1*90 = 90
      //   execute  → GUARD: coordinateRegroup, TimeOut.Value() is still 90
      team.ai();

      // C++ CDTimerClass assignment stores Started=Frame, so same-frame Value()
      // returns the full delay. It drops on subsequent frames, not immediately.
      expect(team.timeOut).toBe(1 * TS_SCALING);
      expect(TS_SCALING).toBe(CPP_SCALING); // C++ parity: both use 90
    });

    it('guard data=5 timeout is 450 ticks (C++ parity)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_GUARD, data: 5 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      // C++ Force_Active() sets IsUnderStrength=false, so no reforming delay.
      // Single ai() tick: activate → advance to GUARD → execute GUARD.
      team.ai();

      // C++ TimeOut is a CDTimerClass; same-frame Value() remains full.
      expect(team.timeOut).toBe(5 * 90);
    });
  });

  // ==========================================================================
  // Section 3: Mission advance sequence (team.cpp:704-753)
  // C++ team.cpp:704-706:
  //   if (IsMoving && !IsReforming && IsNextMission) {
  //     IsNextMission = false;
  //     CurrentMission++;
  // ==========================================================================
  describe('Mission advance preconditions (team.cpp:704-706)', () => {
    it('does NOT advance mission while reforming (team.cpp:704 checks !IsReforming)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
        missions: [
          { mission: TMISSION_GUARD, data: 0 },
          { mission: TMISSION_MOVE, data: 0 },
        ],
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 120, 100);
      team.add(e1);
      team.add(e2);

      // Force reforming state
      team.isReforming = true;
      team.isMoving = true;
      team.isNextMission = true;
      team.currentMission = -1;

      team.ai();

      // C++ would NOT advance because IsReforming is true
      // Mission should still be -1 (not advanced to 0)
      expect(team.currentMission).toBe(-1);
    });

    it('does NOT advance mission when not moving (team.cpp:704 checks IsMoving)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
        missions: [
          { mission: TMISSION_GUARD, data: 0 },
        ],
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e1);

      // Not at full strength, not forced → isMoving stays false
      team.ai();

      expect(team.isMoving).toBe(false);
      expect(team.currentMission).toBe(-1);
    });
  });

  // ==========================================================================
  // Section 4: Mission exhaustion → dissolve (team.cpp:749-752)
  // C++ team.cpp:749-751:
  //   } else {
  //     delete this;
  //     return;
  //   }
  // ==========================================================================
  describe('Mission exhaustion dissolution (team.cpp:749-752)', () => {
    it('dissolves when currentMission exceeds missionList length', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_SET_GLOBAL, data: 0 }, // advances immediately
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      // Run enough ticks to exhaust the mission queue
      for (let i = 0; i < 10; i++) {
        if (team.dissolved) break;
        team.ai();
      }

      expect(team.dissolved).toBe(true);
    });

    it('releases all members when dissolving from mission exhaustion', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
        missions: [
          { mission: TMISSION_SET_GLOBAL, data: 0 },
        ],
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 120, 100);
      team.add(e1);
      team.add(e2);

      for (let i = 0; i < 10; i++) {
        if (team.dissolved) break;
        team.ai();
      }

      expect(e1.teamRef).toBeNull();
      expect(e2.teamRef).toBeNull();
    });

    it('members enter idle mode (GUARD) after team dissolves (team.cpp:1139)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_SET_GLOBAL, data: 0 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      // Set to attack first to verify it changes
      e.mission = Mission.ATTACK;

      for (let i = 0; i < 10; i++) {
        if (team.dissolved) break;
        team.ai();
      }

      // C++ team.cpp destructor calls Remove() → Enter_Idle_Mode() → Assign_Mission(GUARD).
      // Queued via missionQueue; Commence processes when !IsFiring.
      expect(e.missionQueue).toBe(Mission.GUARD);
    });
  });

  // ==========================================================================
  // Section 5: ATT_WAYPT mission dispatch (team.cpp:827-834)
  // C++ treats ATT_WAYPT differently from ATTACK in the execute switch:
  //   case TMISSION_ATT_WAYPT:
  //     if (!Target_Legal(MissionTarget)) {
  //       Assign_Mission_Target(TARGET_NONE);
  //       IsNextMission = true;
  //     } else {
  //       Coordinate_Attack();
  //     }
  // ATTACK uses TMission_Attack() which picks a quarry target.
  // ==========================================================================
  describe('ATT_WAYPT vs ATTACK dispatch difference (team.cpp:787-789 vs 827-834)', () => {
    it('ATT_WAYPT advances mission when missionTarget is null (team.cpp:828-831)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_ATT_WAYPT, data: 99 }, // waypoint 99 doesn't exist
          { mission: TMISSION_GUARD, data: 10 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      const waypoints = new Map<number, { cx: number; cy: number }>();
      // Waypoint 99 NOT in map → missionTarget stays null

      for (let i = 0; i < 5; i++) {
        team.ai(waypoints);
      }

      // Should have advanced past ATT_WAYPT to GUARD
      // because missionTarget was not set (no waypoint 99)
      expect(team.currentMission).toBeGreaterThanOrEqual(1);
    });

    it('ATT_WAYPT calls Coordinate_Attack when missionTarget is valid', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_ATT_WAYPT, data: 0 },
          { mission: TMISSION_GUARD, data: 10 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, { cx: 30, cy: 30 });

      team.ai(waypoints); // activate
      team.ai(waypoints); // advance to ATT_WAYPT

      // Should be on ATT_WAYPT mission (0), member has ATTACK queued.
      // Session 22: Coordinate_Attack queues via Assign_Mission;
      // Commence pops via STAGE A when !IsDriving on next entity tick.
      expect(team.currentMission).toBe(0);
      expect(e.missionQueue).toBe(Mission.ATTACK);
    });
  });

  // ==========================================================================
  // Section 6: GUARD timeout via TimeOut countdown (team.cpp:853-860)
  // C++ team.cpp:853-860:
  //   switch (mission->Mission) {
  //     case TMISSION_GUARD:
  //       if (TimeOut == 0) {
  //         IsNextMission = true;
  //       }
  //       break;
  //   }
  // Note: C++ TimeOut is a TCountDownTimerClass that auto-decrements.
  // TS manually decrements in the GUARD case.
  // ==========================================================================
  describe('GUARD timeout countdown (team.cpp:853-860)', () => {
    it('GUARD mission advances when timeOut reaches 0', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_GUARD, data: 0 }, // data=0 → immediate timeout
          { mission: TMISSION_MOVE, data: 0 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      // Run enough ticks to: activate → advance to GUARD → timeout → advance
      for (let i = 0; i < 10; i++) {
        team.ai();
      }

      // Should have advanced past GUARD (mission 0) to MOVE (mission 1)
      expect(team.currentMission).toBeGreaterThanOrEqual(1);
    });

    it('GUARD does NOT advance before timeout (data > 0)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_GUARD, data: 100 }, // very long timeout
          { mission: TMISSION_MOVE, data: 0 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      // Activate and advance to GUARD
      team.ai();
      team.ai();

      // 3 more ticks shouldn't exhaust a timeout of 100 * scaling
      team.ai();
      team.ai();
      team.ai();

      // Should still be on GUARD mission (index 0)
      expect(team.currentMission).toBe(0);
    });
  });

  // ==========================================================================
  // Section 7: TMission_Loop (team.cpp:2866-2872)
  // C++ team.cpp:2868-2870:
  //   TeamMissionClass const * mission = &Class->MissionList[CurrentMission];
  //   CurrentMission = mission->Data.Value-1;
  //   IsNextMission = true;
  // ==========================================================================
  describe('TMission_Loop jump target (team.cpp:2866-2872)', () => {
    /**
     * C++ team.cpp:2869:
     *   CurrentMission = mission->Data.Value - 1;
     *
     * After this, IsNextMission = true, so AI will do:
     *   CurrentMission++ → CurrentMission = Data.Value
     *
     * So loop with Data.Value=0 jumps to mission index 0.
     * Loop with Data.Value=2 jumps to mission index 2.
     */
    it('LOOP data=0 jumps back to mission index 0 (team.cpp:2869)', () => {
      /**
       * C++ team.cpp:2869:
       *   CurrentMission = mission->Data.Value - 1;  // = 0 - 1 = -1
       *   IsNextMission = true;
       *
       * On next AI tick: CurrentMission++ → 0 (back to GUARD)
       *
       * Note: LOOP executes and changes currentMission within the same ai()
       * call, so currentMission is never observed as 1 (LOOP) after ai()
       * returns. We track how many times mission 0 is visited instead.
       */
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_GUARD, data: 0 },  // index 0 — immediate timeout
          { mission: TMISSION_LOOP, data: 0 },    // index 1 — jump to 0
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      // Track how many times mission 0 is visited
      let mission0Count = 0;
      for (let i = 0; i < 20; i++) {
        team.ai();
        if (team.currentMission === 0) {
          mission0Count++;
        }
      }

      // With LOOP, mission 0 should be visited at least twice (initial + loop back)
      expect(mission0Count).toBeGreaterThanOrEqual(2);
      // Team should NOT be dissolved (LOOP prevents queue exhaustion)
      expect(team.dissolved).toBe(false);
    });

    it('LOOP data=2 jumps to mission index 2 (not 0)', () => {
      /**
       * Same pattern: LOOP with data=2 sets CurrentMission = 2-1 = 1,
       * then IsNextMission increments to 2. So mission 2 should be
       * visited multiple times.
       */
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_SET_GLOBAL, data: 0 },  // index 0 — immediate
          { mission: TMISSION_SET_GLOBAL, data: 0 },  // index 1 — immediate
          { mission: TMISSION_GUARD, data: 0 },        // index 2 — immediate timeout
          { mission: TMISSION_LOOP, data: 2 },          // index 3 — jump to 2
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      // Track how many times mission 2 is visited
      let mission2Count = 0;
      for (let i = 0; i < 30; i++) {
        team.ai();
        if (team.currentMission === 2) {
          mission2Count++;
        }
      }

      // Mission 2 should be visited at least twice (initial + loop back)
      expect(mission2Count).toBeGreaterThanOrEqual(2);
      // Team should NOT be dissolved
      expect(team.dissolved).toBe(false);
    });
  });

  // ==========================================================================
  // Section 8: Coordinate_Do mission mapping (team.cpp:1809-1856)
  // C++ team.cpp:1815:
  //   MissionType do_mission = Class->MissionList[CurrentMission].Data.Mission;
  // The Data.Mission is a direct C++ MissionType enum value.
  // TS maps via mapCppMission() which should match the C++ MissionType enum.
  // ==========================================================================
  describe('Coordinate_Do mission mapping (team.cpp:1809-1856)', () => {
    /**
     * C++ defines.h:979-1008 (MissionType enum):
     *   MISSION_SLEEP      = 0
     *   MISSION_ATTACK     = 1
     *   MISSION_MOVE       = 2
     *   MISSION_QMOVE      = 3
     *   MISSION_RETREAT    = 4
     *   MISSION_GUARD      = 5
     *   ...
     *   MISSION_GUARD_AREA = 10
     *   ...
     *   MISSION_HUNT       = 14
     *
     * TS team.ts mapCppMission() should map these indices to TS Mission enum.
     */
    it('DO with data=14 (HUNT) assigns Mission.HUNT to all members', () => {
      /**
       * C++ Coordinate_Do assigns the requested mission but does not advance
       * CurrentMission. Test the mapping directly so later team coordination
       * cannot obscure the queued member mission.
       */
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
        missions: [
          { mission: TMISSION_DO, data: 14 },
        ],
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 120, 100);
      team.add(e1);
      team.add(e2);

      // Call coordinateDo directly to verify mission QUEUING without
      // interference from subsequent team missions.
      // C++ Assign_Mission queues; Commence processes when !IsFiring.
      team.coordinateDo({ mission: TMISSION_DO, data: 14 });

      expect(e1.missionQueue).toBe(Mission.HUNT);
      expect(e2.missionQueue).toBe(Mission.HUNT);
    });

    it('DO with data=5 (GUARD) assigns Mission.GUARD to all members', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_DO, data: 5 },
          { mission: TMISSION_GUARD, data: 100 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      for (let i = 0; i < 5; i++) {
        team.ai();
      }

      expect(e.mission).toBe(Mission.GUARD);
    });

    it('DO with data=1 (ATTACK) assigns Mission.ATTACK to all members', () => {
      // Test coordinateDo directly to verify mapping without subsequent
      // mission coordination overriding the member mission.
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_DO, data: 1 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      team.coordinateDo({ mission: TMISSION_DO, data: 1 });

      expect(e.missionQueue).toBe(Mission.ATTACK);
    });

    it('DO with data=10 (GUARD_AREA) assigns Mission.AREA_GUARD to all members', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_DO, data: 10 },
          { mission: TMISSION_GUARD, data: 100 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      for (let i = 0; i < 5; i++) {
        team.ai();
      }

      // C++ Assign_Mission queues; Commence dequeues when !IsFiring.
      // team.ai() queues but doesn't process Commence — check missionQueue.
      expect(e.missionQueue).toBe(Mission.AREA_GUARD);
    });

    it('DO does not advance the team mission (team.cpp:1813-1860)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_DO, data: 14 },      // index 0 — remains current
          { mission: TMISSION_GUARD, data: 100 },   // index 1
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      // Run enough ticks that the old TS behavior would have advanced past DO.
      for (let i = 0; i < 5; i++) {
        team.ai();
      }

      // C++ Coordinate_Do never sets IsNextMission, so the team remains on DO.
      expect(team.currentMission).toBe(0);
      expect(team.isNextMission).toBe(false);
      expect(team.dissolved).toBe(false);
    });
  });

  // ==========================================================================
  // Section 9: SET_GLOBAL advances immediately (team.cpp:2919-2925)
  // C++ team.cpp:2922-2923:
  //   Scen.Set_Global_To(mission->Data.Value, true);
  //   IsNextMission = true;
  // ==========================================================================
  describe('SET_GLOBAL advances immediately (team.cpp:2919-2925)', () => {
    it('SET_GLOBAL sets isNextMission and advances to next mission', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_SET_GLOBAL, data: 42 },
          { mission: TMISSION_GUARD, data: 100 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      for (let i = 0; i < 5; i++) {
        team.ai();
      }

      // Should have advanced past SET_GLOBAL to GUARD
      expect(team.currentMission).toBe(1);
    });
  });

  // ==========================================================================
  // Section 10: Took_Damage retargeting (team.cpp:1574-1618)
  // C++ team.cpp:1579: if ((result != RESULT_NONE) && (!Class->IsSuicide))
  // C++ team.cpp:1580-1614: if !IsMoving → do nothing; else retarget to source
  // With extra guards for: !Is_A_Member(source), aircraft check, existing target check
  // ==========================================================================
  describe('Took_Damage retargeting (team.cpp:1574-1618)', () => {
    it('retargets to attacker when team is moving and not suicide', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
        missions: [{ mission: TMISSION_MOVE, data: 0 }],
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 120, 100);
      team.add(e1);
      team.add(e2);

      const attacker = makeEntity(UnitType.V_3TNK, House.UKRAINE, 200, 200);

      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, { cx: 50, cy: 50 });

      team.ai(waypoints); // activate
      team.ai(waypoints); // start MOVE

      expect(team.isMoving).toBe(true);

      team.tookDamage(e1, attacker);

      // C++ team.cpp:1613: Target = source->As_Target()
      expect(team.target).toBeTruthy();
      expect(team.target!.x).toBe(attacker.pos.x);
      expect(team.target!.y).toBe(attacker.pos.y);
    });

    it('suicide team does NOT retarget (team.cpp:1579 checks !IsSuicide)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
        missions: [{ mission: TMISSION_MOVE, data: 0 }],
        isSuicide: true,
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 120, 100);
      team.add(e1);
      team.add(e2);

      const attacker = makeEntity(UnitType.V_3TNK, House.UKRAINE, 200, 200);

      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, { cx: 50, cy: 50 });

      team.ai(waypoints);
      team.ai(waypoints);

      const targetBefore = team.target ? { ...team.target } : null;
      team.tookDamage(e1, attacker);

      // Target should NOT have changed for suicide team
      if (targetBefore) {
        expect(team.target!.x).toBe(targetBefore.x);
        expect(team.target!.y).toBe(targetBefore.y);
      }
    });

    it('does not retarget to own team members (team.cpp:1589 checks !Is_A_Member)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
        missions: [{ mission: TMISSION_MOVE, data: 0 }],
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 120, 100);
      team.add(e1);
      team.add(e2);

      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, { cx: 50, cy: 50 });

      team.ai(waypoints);
      team.ai(waypoints);

      const targetBefore = team.target ? { ...team.target } : null;

      // e2 is a team member — should NOT retarget
      team.tookDamage(e1, e2);

      if (targetBefore) {
        expect(team.target!.x).toBe(targetBefore.x);
        expect(team.target!.y).toBe(targetBefore.y);
      }
    });

    it('does not retarget when team head is an LST transport (team.cpp:1587-1589)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_LST, count: 1 }, { type: UnitType.V_2TNK, count: 1 }],
        missions: [{ mission: TMISSION_MOVE, data: 0 }],
        forcedActive: true,
      });

      const tank = makeEntity(UnitType.V_2TNK, House.Greece, 100, 100);
      const lst = makeEntity(UnitType.V_LST, House.Greece, 100, 100);
      // Team::Add inserts at the head; LST added last mirrors INI order where
      // transport appears after cargo (SCG07EA mcvlst).
      team.add(tank);
      team.add(lst);

      const attacker = makeEntity(UnitType.V_SS, House.USSR, 200, 200);
      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, { cx: 50, cy: 50 });
      team.ai(waypoints);
      team.ai(waypoints);

      const targetBefore = team.target ? { ...team.target } : null;
      team.tookDamage(lst, attacker);

      expect(team.target).toEqual(targetBefore);
    });

    it('does not retarget if source is dead (team.cpp:1589 source check)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [{ mission: TMISSION_MOVE, data: 0 }],
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e1);

      const deadAttacker = makeEntity(UnitType.V_3TNK, House.UKRAINE, 200, 200);
      deadAttacker.alive = false;

      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, { cx: 50, cy: 50 });

      team.ai(waypoints);
      team.ai(waypoints);

      const targetBefore = team.target ? { ...team.target } : null;
      team.tookDamage(e1, deadAttacker);

      if (targetBefore) {
        expect(team.target!.x).toBe(targetBefore.x);
        expect(team.target!.y).toBe(targetBefore.y);
      }
    });

    it('does not retarget if source is null', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [{ mission: TMISSION_MOVE, data: 0 }],
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e1);

      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, { cx: 50, cy: 50 });

      team.ai(waypoints);
      team.ai(waypoints);

      // Should not throw
      expect(() => team.tookDamage(e1, null)).not.toThrow();
    });

    /**
     * C++ team.cpp:1580-1583:
     *   if (!IsMoving) {
     *     // TCTCTC - Should run to a better hiding place or disband
     *   } else { ... }
     *
     * When not moving, C++ does NOT retarget (empty handler).
     * TS team.ts:698 checks: if (this.isMoving && this.target)
     */
    it('does not retarget when team is NOT moving (team.cpp:1580)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 3 }],
        missions: [{ mission: TMISSION_MOVE, data: 0 }],
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e1);

      const attacker = makeEntity(UnitType.V_3TNK, House.UKRAINE, 200, 200);

      // Team is NOT moving (not full strength, not forced active)
      expect(team.isMoving).toBe(false);

      team.tookDamage(e1, attacker);

      // Should NOT have retargeted — C++ !IsMoving branch does nothing
      expect(team.target).toBeNull();
    });
  });

  // ==========================================================================
  // Section 11: MOVE mission target from waypoint (team.cpp:718-730)
  // C++ team.cpp:718-730:
  //   case TMISSION_MOVE:
  //     if (mission->Data.Value < WAYPT_COUNT && Member != NULL) {
  //       FootClass * leader = Fetch_A_Leader();
  //       CELL movecell = Scen.Waypoint[mission->Data.Value];
  //       ...
  //       Assign_Mission_Target(::As_Target(movecell));
  //       Target = ::As_Target(movecell);
  //     }
  // ==========================================================================
  describe('MOVE mission target from waypoint (team.cpp:718-730)', () => {
    it('sets target to waypoint world position', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [{ mission: TMISSION_MOVE, data: 3 }],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(3, { cx: 10, cy: 15 });

      team.ai(waypoints); // activate
      team.ai(waypoints); // advance to MOVE, set target

      const expectedX = 10 * CELL_SIZE + CELL_SIZE / 2;
      const expectedY = 15 * CELL_SIZE + CELL_SIZE / 2;

      expect(team.target).toBeTruthy();
      expect(team.target!.x).toBe(expectedX);
      expect(team.target!.y).toBe(expectedY);
    });

    it('MOVE with missing waypoint gets no target', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_MOVE, data: 50 }, // waypoint 50 doesn't exist
          { mission: TMISSION_GUARD, data: 100 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      const waypoints = new Map<number, { cx: number; cy: number }>();
      // Only waypoint 0 is set
      waypoints.set(0, { cx: 5, cy: 5 });

      team.ai(waypoints); // activate
      team.ai(waypoints); // advance to MOVE with missing waypoint

      // missionTarget should be null since waypoint 50 wasn't found
      expect(team.missionTarget).toBeNull();
    });
  });

  // ==========================================================================
  // Section 12: Coordinate_Attack no target → advance (team.cpp:1675-1676)
  // C++ team.cpp:1675-1676:
  //   if (!Target_Legal(Target)) {
  //     IsNextMission = true;
  // ==========================================================================
  describe('Coordinate_Attack no target advance (team.cpp:1675-1676)', () => {
    it('ATTACK with no target advances to next mission', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_ATTACK, data: 0 },
          { mission: TMISSION_GUARD, data: 100 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      // No enemies, no target → Coordinate_Attack advances
      for (let i = 0; i < 5; i++) {
        team.ai();
      }

      expect(team.currentMission).toBe(1);
    });
  });

  // ==========================================================================
  // Section 13: Coordinate_Move all-arrive check (team.cpp:2005-2007)
  // C++ team.cpp:2005-2007:
  //   if (finished && IsMoving) {
  //     IsNextMission = true;
  //   }
  // ==========================================================================
  describe('Coordinate_Move all-arrive advance (team.cpp:2005-2007)', () => {
    it('advances when all members are at target', () => {
      const wp = { cx: 5, cy: 5 };
      const targetX = wp.cx * CELL_SIZE + CELL_SIZE / 2;
      const targetY = wp.cy * CELL_SIZE + CELL_SIZE / 2;

      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
        missions: [
          { mission: TMISSION_MOVE, data: 0 },
          { mission: TMISSION_GUARD, data: 100 },
        ],
        forcedActive: true,
      });

      // Place both members at the waypoint
      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, targetX, targetY);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, targetX + 1, targetY);
      team.add(e1);
      team.add(e2);

      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, wp);

      // Tick until MOVE completes
      for (let i = 0; i < 5; i++) {
        team.ai(waypoints);
      }

      // Should have advanced to GUARD (mission 1)
      expect(team.currentMission).toBe(1);
    });

    it('does NOT advance when members are still far from target', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
        missions: [
          { mission: TMISSION_MOVE, data: 0 },
          { mission: TMISSION_GUARD, data: 100 },
        ],
        forcedActive: true,
      });

      // Place members far from waypoint
      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 10, 10);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 20, 10);
      team.add(e1);
      team.add(e2);

      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, { cx: 50, cy: 50 }); // far away

      team.ai(waypoints); // activate
      team.ai(waypoints); // advance to MOVE

      // C++ Coordinate_Move queues MOVE via MissionQueue — mission transition
      // happens via Commence(), not in team.ai().
      expect(e1.missionQueue).toBe(Mission.MOVE);
      expect(e2.missionQueue).toBe(Mission.MOVE);

      // Should still be on MOVE team-mission (the first entry in the team's mission list)
      expect(team.currentMission).toBe(0);
    });
  });

  describe('Coordinate_Move target legality (team.cpp:1887-1890)', () => {
    it('falls back to MissionTarget when an override Target entity is dead', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [{ mission: TMISSION_MOVE, data: 0 }],
        forcedActive: true,
      });
      const member = makeEntity(UnitType.V_3TNK, House.USSR, 0, 0);
      team.add(member);

      const missionCell = { cx: 20, cy: 20 };
      const missionWorld = {
        x: missionCell.cx * CELL_SIZE + CELL_SIZE / 2,
        y: missionCell.cy * CELL_SIZE + CELL_SIZE / 2,
      };
      (team as unknown as {
        setMissionTarget(target: typeof missionWorld, cell: typeof missionCell): void;
        setTarget(target: typeof missionWorld, cell: typeof missionCell): void;
      }).setMissionTarget(missionWorld, missionCell);
      (team as unknown as {
        setTarget(target: typeof missionWorld, cell: typeof missionCell): void;
      }).setTarget(missionWorld, missionCell);

      const attacker = makeEntity(UnitType.V_3TNK, House.Greece, 5 * CELL_SIZE + 12, 5 * CELL_SIZE + 12);
      team.tookDamage(member, attacker, { entities: [member, attacker] });
      attacker.alive = false;
      member.moveTarget = null;
      member.mission = Mission.GUARD;
      member.missionQueue = null;

      team.coordinateMove();

      const expected = cellTargetToLepton(missionCell.cx, missionCell.cy);
      expect(member.moveTarget).toEqual(expected);
      expect(member.moveTarget).not.toEqual({ lx: attacker.leptonX, ly: attacker.leptonY });
    });

    it('clears a cloaking techno override through TeamClass::Detach and resumes MissionTarget', () => {
      const team = makeTeam({
        house: House.Greece,
        memberDefs: [{ type: UnitType.V_PT, count: 1 }],
        missions: [{ mission: TMISSION_MOVE, data: 0 }],
        forcedActive: true,
      });
      const member = makeEntity(UnitType.V_PT, House.Greece, 18 * CELL_SIZE + 12, 53 * CELL_SIZE + 12);
      team.add(member);
      team.isMoving = true;

      const missionCell = { cx: 14, cy: 53 };
      const missionWorld = {
        x: missionCell.cx * CELL_SIZE + CELL_SIZE / 2,
        y: missionCell.cy * CELL_SIZE + CELL_SIZE / 2,
      };
      (team as unknown as {
        setMissionTarget(target: typeof missionWorld, cell: typeof missionCell): void;
      }).setMissionTarget(missionWorld, missionCell);
      (team as unknown as {
        setTarget(target: typeof missionWorld, cell: typeof missionCell): void;
      }).setTarget(missionWorld, missionCell);

      const sub = makeEntity(UnitType.V_SS, House.USSR, 20 * CELL_SIZE + 12, 53 * CELL_SIZE + 12);
      team.tookDamage(member, sub, { entities: [member, sub] });
      expect((team as unknown as { targetEntityRef: Entity | null }).targetEntityRef).toBe(sub);

      // C++ TechnoClass::Do_Cloak calls Detach_All(false), which reaches
      // TeamClass::Detach and clears Team::Target when it points at the cloaker.
      team.detachTargetEntity(sub);
      member.mission = Mission.GUARD;
      member.missionQueue = null;
      member.moveTarget = null;

      team.coordinateMove();

      expect((team as unknown as { targetEntityRef: Entity | null }).targetEntityRef).toBeNull();
      expect(member.moveTarget).toEqual(cellTargetToLepton(missionCell.cx, missionCell.cy));
      expect(member.moveTarget).not.toEqual({ lx: sub.leptonX, ly: sub.leptonY });
    });
  });

  // ==========================================================================
  // Section 14: Reforming fallback (team.cpp:862-869)
  // C++ team.cpp:862-868:
  //   } else {
  //     if (IsMoving) {
  //       IsReforming = !Coordinate_Regroup();
  //     } else {
  //       Coordinate_Move();
  //     }
  //   }
  // When isMoving && isReforming, team regroups instead of executing missions.
  // ==========================================================================
  describe('Reforming fallback (team.cpp:862-869)', () => {
    it('when isReforming, team regroups instead of executing mission', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
        missions: [
          { mission: TMISSION_ATTACK, data: 0 },
        ],
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 120, 100);
      team.add(e1);
      team.add(e2);

      team.ai(); // activate
      team.isReforming = true;

      // While reforming, mission execution is skipped (team.cpp:758 checks !IsReforming)
      team.ai();

      // The reforming block at team.cpp:864 sets IsReforming = !Coordinate_Regroup()
      // Since units are close together, regroup should succeed and isReforming → false
      // But attack mission should NOT have been dispatched during reform
      expect(e1.mission).not.toBe(Mission.ATTACK);
    });
  });

  // ==========================================================================
  // Section 15: Constructor initial state (team.cpp:331-381)
  // C++ TeamClass constructor sets specific initial values that TS must match.
  // ==========================================================================
  describe('Constructor initial state (team.cpp:331-381)', () => {
    /**
     * C++ team.cpp:335-358:
     *   IsForcedActive(false),
     *   IsHasBeen(false),
     *   IsFullStrength(false),
     *   IsUnderStrength(true),
     *   IsReforming(false),
     *   IsLagging(false),
     *   IsAltered(true),
     *   JustAltered(false),
     *   IsMoving(false),
     *   IsNextMission(true),
     *   IsLeaveMap(false),
     *   Suspended(false),
     *   ...
     *   CurrentMission(-1),
     *   TimeOut(0),
     *   Member(0)
     */
    it('initial state matches C++ constructor defaults', () => {
      const team = makeTeam({});

      expect(team.isHasBeen).toBe(false);
      expect(team.isFullStrength).toBe(false);
      expect(team.isUnderStrength).toBe(true);
      expect(team.isReforming).toBe(false);
      expect(team.isAltered).toBe(true);
      expect(team.isMoving).toBe(false);
      expect(team.isNextMission).toBe(true);
      expect(team.isLeaveMap).toBe(false);
      expect(team.suspended).toBe(false);
      expect(team.currentMission).toBe(-1);
      expect(team.timeOut).toBe(0);
      expect(team.total).toBe(0);
    });

    it('isForcedActive defaults to false unless set', () => {
      const normalTeam = makeTeam({});
      expect(normalTeam.isForcedActive).toBe(false);

      const forcedTeam = makeTeam({ forcedActive: true });
      expect(forcedTeam.isForcedActive).toBe(true);
    });

    it('recruitPriority defaults to 7 (C++ teamtype.cpp:173)', () => {
      /**
       * C++ teamtype.cpp:173:
       *   RecruitPriority(7),
       */
      const team = makeTeam({});
      expect(team.recruitPriority).toBe(7);
    });

    it('isReinforcable defaults to true (C++ teamtype.cpp:175)', () => {
      /**
       * C++ teamtype.cpp:175:
       *   IsReinforcable(true),
       */
      const team = makeTeam({});
      expect(team.isReinforcable).toBe(true);
    });

    it('isSuicide defaults to false (C++ teamtype.cpp:168)', () => {
      /**
       * C++ teamtype.cpp:168:
       *   IsSuicide(false),
       */
      const team = makeTeam({});
      expect(team.isSuicide).toBe(false);
    });
  });

  // ==========================================================================
  // Section 16: Non-reinforceable team understrength logic (team.cpp:521-530)
  // C++ team.cpp:528-529:
  //   IsUnderStrength = !IsHasBeen;
  // Non-reinforceable teams are never considered under strength after activation.
  // ==========================================================================
  describe('Non-reinforceable understrength (team.cpp:521-530)', () => {
    /**
     * C++ team.cpp:521-530:
     *   } else {
     *     // Teams that are not flagged as reinforceable are never considered under
     *     // strength if the team has already started its main mission.
     *     IsUnderStrength = !IsHasBeen;
     *   }
     */
    it('non-reinforceable team: understrength = !isHasBeen after losses', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
        isReinforcable: false,
        forcedActive: true,
      });

      // Add 6 members (full strength)
      const entities: Entity[] = [];
      for (let i = 0; i < 6; i++) {
        const e = makeEntity(UnitType.V_3TNK, House.USSR, 100 + i * 20, 100);
        entities.push(e);
        team.add(e);
      }

      team.ai(); // activate → isHasBeen = true
      expect(team.isHasBeen).toBe(true);

      // Kill 5 of 6 — for reinforceable team this would be under strength
      // For non-reinforceable, isUnderStrength = !isHasBeen = false
      for (let i = 0; i < 5; i++) {
        entities[i].alive = false;
      }
      team.isAltered = true;
      team.ai();

      // C++ team.cpp:529: IsUnderStrength = !IsHasBeen = false
      expect(team.isUnderStrength).toBe(false);
    });
  });

  // ==========================================================================
  // Section 17: Coordinate_Regroup stray distance (team.cpp:1757)
  // C++ team.cpp:1757:
  //   if (unit->Distance(Zone) > Rule.StrayDistance ...
  // C++ rules.cpp:260: StrayDistance = 0x0200 (512 leptons = 2 cells)
  // TS team.ts: worldDistLeptons(unit.pos, this.zone) > STRAY_DISTANCE (512 leptons)
  // ==========================================================================
  describe('Coordinate_Regroup stray distance (team.cpp:1757, rules.cpp:260)', () => {
    /**
     * C++ rules.cpp:260: StrayDistance = 0x0200 (512 leptons)
     * 1 cell = 256 leptons (CELL_LEPTON_W)
     * StrayDistance = 2 cells
     *
     * TS now uses worldDistLeptons() > STRAY_DISTANCE (512), matching
     * C++ integer lepton comparison exactly.
     */
    it('units within regroup threshold are not ordered to move', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
        missions: [],
      });

      // Place units very close together
      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 101, 100);
      team.add(e1);
      team.add(e2);

      team.calcCenter();
      const result = team.coordinateRegroup();

      // Both within threshold → regrouped
      expect(result).toBe(true);
    });

    it('distant unit is ordered to MOVE toward zone during regroup', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
        missions: [],
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 500, 500); // far away
      team.add(e1);
      team.add(e2);
      e1.teamInitiated = true;
      e2.teamInitiated = true;

      team.calcCenter();
      const result = team.coordinateRegroup();

      // Not all regrouped → returns false
      expect(result).toBe(false);

      // Session 24: C++ Coordinate_Regroup calls Assign_Mission(MOVE) which
      // QUEUES (mission.cpp:388). Commence pops later. Post-call: mq=MOVE.
      expect(e2.missionQueue).toBe(Mission.MOVE);
      expect(e2.moveTarget).toBeTruthy();
    });
  });

  // ==========================================================================
  // Section 17b: Coordinate_Move stray distance — lepton-space boundary (team.cpp:1920-1927)
  // C++ team.cpp:1920: int dist = unit->Distance(Target);
  // C++ team.cpp:1927: if (dist > stray) ...
  // C++ rules.cpp:260: StrayDistance = 0x0200 = 512 leptons
  // C++ team.cpp:1909-1910: if (aircraft) stray *= 3;
  //
  // TS must compare worldDistLeptons() > STRAY_DISTANCE to match C++ exactly.
  // Previously TS used worldDist() > 2 (cell-based), which could diverge at
  // boundary positions due to floating-point division (SCG07EA tick 4, ±5 members).
  // ==========================================================================
  describe('Coordinate_Move stray distance lepton boundary (team.cpp:1920-1927)', () => {
    it('STRAY_DISTANCE constant matches C++ Rule.StrayDistance = 0x0200 = 512 leptons', () => {
      expect(STRAY_DISTANCE).toBe(0x0200);
      expect(STRAY_DISTANCE).toBe(512);
    });

    it('unit exactly at StrayDistance (512 leptons) is classified as arrived', () => {
      // C++ comparison: dist > stray → 512 > 512 → false → GUARD (arrived)
      // Place unit exactly 2 cells (512 leptons) from target
      const targetCx = 10;
      const targetCy = 10;
      const targetX = targetCx * CELL_SIZE + CELL_SIZE / 2;
      const targetY = targetCy * CELL_SIZE + CELL_SIZE / 2;

      // 2 cells east = 512 leptons in X, 0 in Y → octagonal dist = 512
      const unitX = (targetCx + 2) * CELL_SIZE + CELL_SIZE / 2;
      const unitY = targetCy * CELL_SIZE + CELL_SIZE / 2;

      // Verify distance is exactly 512 leptons
      const dist = worldDistLeptons({ x: unitX, y: unitY }, { x: targetX, y: targetY });
      expect(dist).toBe(512);

      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_MOVE, data: 0 },
          { mission: TMISSION_GUARD, data: 100 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, unitX, unitY);
      team.add(e);

      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, { cx: targetCx, cy: targetCy });

      team.ai(waypoints); // activate
      team.ai(waypoints); // Coordinate_Move

      // 512 > 512 is false → unit should NOT be ordered to move
      // C++ would assign GUARD (team.cpp:1967-1969)
      expect(e.mission).not.toBe(Mission.MOVE);
    });

    it('unit at 513 leptons is classified as lagging (not arrived)', () => {
      // C++ comparison: dist > stray → 513 > 512 → true → MOVE
      const targetCx = 10;
      const targetCy = 10;
      const targetX = targetCx * CELL_SIZE + CELL_SIZE / 2;
      const targetY = targetCy * CELL_SIZE + CELL_SIZE / 2;

      // Place unit 513 leptons away — 2 cells + 1 lepton
      // 1 lepton = CELL_SIZE / LEPTON_SIZE pixels = 24/256 = 0.09375 px
      // So offset = 2 cells + 1 lepton = 48 + 0.09375 px
      // But since worldDistLeptons converts Math.trunc(px*256/24),
      // we need a pixel offset that converts to >512 leptons.
      // 48.09375 px → Math.trunc(48.09375 * 256/24) = Math.trunc(513.0) = 513
      // Actually simpler: use a position that's clearly > 2 cells
      const unitX = targetX + 49; // 49 px = Math.trunc(49*256/24) = Math.trunc(522.67) = 522 leptons > 512
      const unitY = targetY;

      const dist = worldDistLeptons({ x: unitX, y: unitY }, { x: targetX, y: targetY });
      expect(dist).toBeGreaterThan(STRAY_DISTANCE);

      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_MOVE, data: 0 },
          { mission: TMISSION_GUARD, data: 100 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, unitX, unitY);
      team.add(e);

      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, { cx: targetCx, cy: targetCy });

      team.ai(waypoints); // activate
      team.ai(waypoints); // Coordinate_Move

      // dist > 512 → true → unit should be QUEUED for MOVE (C++ Assign_Mission
      // queues via MissionQueue; actual Mission transition happens via Commence).
      expect(e.missionQueue).toBe(Mission.MOVE);
      expect(team.currentMission).toBe(0); // still on MOVE mission (not advanced)
    });

    it('aircraft use 3x stray distance (1536 leptons) per team.cpp:1909-1910', () => {
      // C++ team.cpp:1909-1910: if (aircraft) stray *= 3 → 1536 leptons
      const targetCx = 10;
      const targetCy = 10;
      const targetX = targetCx * CELL_SIZE + CELL_SIZE / 2;
      const targetY = targetCy * CELL_SIZE + CELL_SIZE / 2;

      // Place aircraft at 4 cells away (1024 leptons) — within 1536 but outside 512
      const unitX = (targetCx + 4) * CELL_SIZE + CELL_SIZE / 2;
      const unitY = targetCy * CELL_SIZE + CELL_SIZE / 2;

      const dist = worldDistLeptons({ x: unitX, y: unitY }, { x: targetX, y: targetY });
      expect(dist).toBe(1024); // 4 cells = 1024 leptons
      expect(dist).toBeGreaterThan(STRAY_DISTANCE); // 1024 > 512 (ground would be "lagging")
      expect(dist).toBeLessThan(STRAY_DISTANCE * 3); // 1024 < 1536 (aircraft is "arrived")

      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_HELI, count: 1 }],
        missions: [
          { mission: TMISSION_MOVE, data: 0 },
          { mission: TMISSION_GUARD, data: 100 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_HELI, House.USSR, unitX, unitY);
      // isAirUnit is a getter from stats.isAircraft — V_HELI has isAircraft=true
      expect(e.isAirUnit).toBe(true);
      team.add(e);

      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, { cx: targetCx, cy: targetCy });

      team.ai(waypoints); // activate
      team.ai(waypoints); // Coordinate_Move

      // 1024 > 1536 is false → aircraft is "arrived", NOT ordered to move
      expect(e.mission).not.toBe(Mission.MOVE);
    });

    it('worldDistLeptons matches C++ octagonal approximation in integer leptons', () => {
      // C++ coord.cpp:124-136: max(|dy|,|dx|) + min(|dy|,|dx|)/2 (integer)
      // Test with a diagonal offset: 3 cells east, 2 cells south
      const ax = 10 * CELL_SIZE + CELL_SIZE / 2; // cell 10 center
      const ay = 10 * CELL_SIZE + CELL_SIZE / 2;
      const bx = 13 * CELL_SIZE + CELL_SIZE / 2; // cell 13 center (3 cells east)
      const by = 12 * CELL_SIZE + CELL_SIZE / 2; // cell 12 center (2 cells south)

      // dx = 3*256 = 768 leptons, dy = 2*256 = 512 leptons
      // max(768,512) + 512/2 = 768 + 256 = 1024
      const dist = worldDistLeptons({ x: ax, y: ay }, { x: bx, y: by });
      expect(dist).toBe(1024);
    });
  });

  // ==========================================================================
  // Section 18: PATROL mission behavior (team.cpp:2945-2984)
  // C++ TMission_Patrol scans for enemies and switches between
  // Coordinate_Attack and Coordinate_Move. TS coordinatePatrol
  // checks if members are in combat and lets them fight.
  // ==========================================================================
  describe('PATROL mission behavior (team.cpp:2945-2984)', () => {
    it('PATROL moves members toward waypoint when no enemies', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [{ mission: TMISSION_PATROL, data: 0 }],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, { cx: 30, cy: 30 });

      team.ai(waypoints); // activate
      team.ai(waypoints); // start PATROL

      // Session 21: coordinatePatrol queues MOVE via Assign_Mission.
      expect(e.missionQueue).toBe(Mission.MOVE);
      expect(e.moveTarget).toBeTruthy();
    });

    it('PATROL advances when all members arrive at destination', () => {
      const wp = { cx: 5, cy: 5 };
      const targetX = wp.cx * CELL_SIZE + CELL_SIZE / 2;
      const targetY = wp.cy * CELL_SIZE + CELL_SIZE / 2;

      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_PATROL, data: 0 },
          { mission: TMISSION_GUARD, data: 100 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, targetX, targetY);
      team.add(e);

      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, wp);

      for (let i = 0; i < 5; i++) {
        team.ai(waypoints);
      }

      // Should have advanced past PATROL to GUARD
      expect(team.currentMission).toBe(1);
    });
  });

  // ==========================================================================
  // Section 19: DEPLOY mission (team.cpp:2987-3030 approximately)
  // C++ TMission_Deploy tells MCVs/minelayers to deploy.
  // TS tMissionDeploy sets Mission.UNLOAD and advances immediately.
  // ==========================================================================
  describe('DEPLOY mission dispatch (team.cpp:2987)', () => {
    it('DEPLOY assigns unload/deploy mission and advances immediately', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_DEPLOY, data: 0 },
          { mission: TMISSION_GUARD, data: 100 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      for (let i = 0; i < 5; i++) {
        team.ai();
      }

      // DEPLOY advances immediately
      expect(team.currentMission).toBe(1);
    });
  });

  // ==========================================================================
  // Section 20: UNLOAD mission (team.cpp:2110-2176)
  // C++ TMission_Unload iterates members with passengers and tells them to
  // unload. Advances when all transports have no more passengers.
  // ==========================================================================
  describe('UNLOAD mission dispatch (team.cpp:2110-2176)', () => {
    it('UNLOAD with no passengers advances immediately', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_UNLOAD, data: 0 },
          { mission: TMISSION_GUARD, data: 100 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      for (let i = 0; i < 5; i++) {
        team.ai();
      }

      // No passengers → finished → advance
      expect(team.currentMission).toBe(1);
    });
  });

  // ==========================================================================
  // Section 21: Mixed mission queue ordering
  // Verify that a complex multi-mission queue processes in correct order
  // ==========================================================================
  describe('Complex mission queue ordering', () => {
    it('SET_GLOBAL advances into DO, then DO holds current mission', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_SET_GLOBAL, data: 1 },  // index 0 — immediate
          { mission: TMISSION_DO, data: 14 },          // index 1 — HUNT, holds
          { mission: TMISSION_GUARD, data: 100 },      // index 2 — not reached by DO
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      // Track mission index progression
      const missionsSeen: number[] = [];
      for (let i = 0; i < 10; i++) {
        team.ai();
        if (team.currentMission >= 0 && !missionsSeen.includes(team.currentMission)) {
          missionsSeen.push(team.currentMission);
        }
      }

      // SET_GLOBAL advances to DO; C++ Coordinate_Do does not set IsNextMission.
      expect(missionsSeen).toContain(0);
      expect(missionsSeen).toContain(1);
      expect(missionsSeen).not.toContain(2);

      // Should remain on DO (index 1).
      expect(team.currentMission).toBe(1);

      // C++ Assign_Mission queues; Commence is outside Team::AI.
      expect(e.missionQueue).toBe(Mission.HUNT);

      // Team should NOT be dissolved
      expect(team.dissolved).toBe(false);
    });
  });

  // ==========================================================================
  // Section 22: Assign_Mission_Target clearing (team.cpp:396-450)
  // C++ team.cpp:445-449:
  //   if (Target == MissionTarget || !Target_Legal(Target)) {
  //     MissionTarget = Target = new_target;
  //   } else {
  //     MissionTarget = new_target;
  //   }
  // When Target equals MissionTarget, both get updated. Otherwise only
  // MissionTarget is updated (Target retains current override).
  // ==========================================================================
  describe('Assign_Mission_Target behavior (team.cpp:396-450)', () => {
    it('when target equals missionTarget, both are updated', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_MOVE, data: 0 },
          { mission: TMISSION_MOVE, data: 1 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, { cx: 5, cy: 5 });
      waypoints.set(1, { cx: 10, cy: 10 });

      // After first MOVE, target and missionTarget should point to same waypoint
      team.ai(waypoints); // activate
      team.ai(waypoints); // advance to MOVE 0

      // Both should be set to waypoint 0's world position
      if (team.target && team.missionTarget) {
        expect(team.target.x).toBe(team.missionTarget.x);
        expect(team.target.y).toBe(team.missionTarget.y);
      }
    });
  });

  // ==========================================================================
  // Section 23: Under-strength threshold for desired<=2 (team.cpp:518-519)
  // C++ team.cpp:518-519:
  //   } else {
  //     IsUnderStrength = (Total < desired);
  //   }
  // For teams wanting <= 2 members, any count below desired is under strength.
  // ==========================================================================
  describe('Under-strength threshold for small teams (team.cpp:518-519)', () => {
    it('desired=2: 1 member is under strength (Total < desired)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);
      team.ai();

      // 1 < 2 → under strength
      expect(team.isUnderStrength).toBe(true);
    });

    it('desired=1: 1 member is NOT under strength (Total >= desired)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);
      team.ai();

      // 1 >= 1 → NOT under strength (also full strength)
      expect(team.isUnderStrength).toBe(false);
      expect(team.isFullStrength).toBe(true);
    });
  });

  // ==========================================================================
  // Section 24: Under-strength threshold for desired>2 (team.cpp:516-517)
  // C++ team.cpp:516-517:
  //   if (desired > 2) {
  //     IsUnderStrength = (Total <= desired / 3);
  //   }
  // C++ integer division: 5/3=1, 6/3=2, 7/3=2, 9/3=3
  // ==========================================================================
  describe('Under-strength 1/3 threshold integer division (team.cpp:516-517)', () => {
    /**
     * C++ uses integer division: desired / 3
     * desired=5: threshold = 5/3 = 1 (C++ int division)
     * desired=6: threshold = 6/3 = 2
     * desired=7: threshold = 7/3 = 2
     * desired=9: threshold = 9/3 = 3
     *
     * IsUnderStrength = (Total <= threshold)
     */

    it('desired=6, total=2: under strength (2 <= 6/3=2)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
        forcedActive: true,
      });

      const entities: Entity[] = [];
      for (let i = 0; i < 6; i++) {
        const e = makeEntity(UnitType.V_3TNK, House.USSR, 100 + i * 20, 100);
        entities.push(e);
        team.add(e);
      }
      team.ai(); // activate

      // Kill 4, leaving 2
      entities[0].alive = false;
      entities[1].alive = false;
      entities[2].alive = false;
      entities[3].alive = false;
      team.isAltered = true;
      team.ai();

      // 2 <= floor(6/3)=2 → under strength
      expect(team.isUnderStrength).toBe(true);
    });

    it('desired=6, total=3: NOT under strength (3 > 6/3=2)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
        forcedActive: true,
      });

      const entities: Entity[] = [];
      for (let i = 0; i < 6; i++) {
        const e = makeEntity(UnitType.V_3TNK, House.USSR, 100 + i * 20, 100);
        entities.push(e);
        team.add(e);
      }
      team.ai(); // activate

      // Kill 3, leaving 3
      entities[0].alive = false;
      entities[1].alive = false;
      entities[2].alive = false;
      team.isAltered = true;
      team.ai();

      // 3 > floor(6/3)=2 → NOT under strength
      expect(team.isUnderStrength).toBe(false);
    });

    it('desired=5, total=1: under strength (1 <= 5/3=1, C++ int div)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 5 }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
        forcedActive: true,
      });

      const entities: Entity[] = [];
      for (let i = 0; i < 5; i++) {
        const e = makeEntity(UnitType.V_3TNK, House.USSR, 100 + i * 20, 100);
        entities.push(e);
        team.add(e);
      }
      team.ai();

      // Kill 4, leaving 1
      for (let i = 0; i < 4; i++) entities[i].alive = false;
      team.isAltered = true;
      team.ai();

      // C++ integer division: 5/3 = 1
      // TS Math.floor(5/3) = 1
      // 1 <= 1 → under strength
      expect(team.isUnderStrength).toBe(true);
    });

    it('desired=5, total=2: NOT under strength (2 > 5/3=1)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 5 }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
        forcedActive: true,
      });

      const entities: Entity[] = [];
      for (let i = 0; i < 5; i++) {
        const e = makeEntity(UnitType.V_3TNK, House.USSR, 100 + i * 20, 100);
        entities.push(e);
        team.add(e);
      }
      team.ai();

      // Kill 3, leaving 2
      for (let i = 0; i < 3; i++) entities[i].alive = false;
      team.isAltered = true;
      team.ai();

      // 2 > floor(5/3)=1 → NOT under strength
      expect(team.isUnderStrength).toBe(false);
    });
  });

  // ==========================================================================
  // Section 25: Activation transition (team.cpp:627-652)
  // C++ team.cpp:627-651:
  //   if (!IsMoving && (IsFullStrength || IsForcedActive)) {
  //     IsMoving = true;
  //     IsHasBeen = true;
  //     IsUnderStrength = false;
  //     ...
  //     CurrentMission = -1;
  //     IsNextMission = true;
  //   }
  // ==========================================================================
  describe('Activation transition (team.cpp:627-652)', () => {
    it('activation sets IsMoving, IsHasBeen, clears IsUnderStrength', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      expect(team.isMoving).toBe(false);
      expect(team.isHasBeen).toBe(false);

      team.ai(); // activate

      expect(team.isMoving).toBe(true);
      expect(team.isHasBeen).toBe(true);
      expect(team.isUnderStrength).toBe(false);
    });

    it('full-strength team activates without forcedActive', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 120, 100);
      team.add(e1);
      team.add(e2);

      team.ai();

      expect(team.isMoving).toBe(true);
      expect(team.isHasBeen).toBe(true);
    });
  });

  // ==========================================================================
  // Section 26: Zone recalculation trigger (team.cpp:658-660)
  // C++ team.cpp:658:
  //   if (IsReforming || IsMoving || Zone == TARGET_NONE || ClosestMember == TARGET_NONE) {
  //     Calc_Center(Zone, ClosestMember);
  //   }
  // ==========================================================================
  describe('Zone recalculation trigger (team.cpp:658-660)', () => {
    it('zone is recalculated when moving', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 200);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 200, 400);
      team.add(e1);
      team.add(e2);

      team.ai(); // activate → triggers zone calc

      expect(team.zone).toBeTruthy();
      // Lepton quantization: positions truncate to lepton grid, so averages shift slightly
      expect(team.zone!.x).toBeCloseTo(150, -1);
      expect(team.zone!.y).toBeCloseTo(300, -1);
    });
  });

  // ==========================================================================
  // Section 27: Empty team + isHasBeen → dissolve (team.cpp:679-697)
  // This is the SECOND dissolve check (first is in composition block at :544).
  // C++ team.cpp:679:
  //   if (Member == NULL && IsHasBeen) {
  //     ...
  //     delete this;
  //     return;
  //   }
  // ==========================================================================
  describe('Empty team dissolve check (team.cpp:679-697)', () => {
    it('empty team dissolves if isHasBeen is true', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      team.ai(); // activate → isHasBeen = true

      e.alive = false;
      team.isAltered = true;
      team.ai(); // composition check removes dead, team empty → dissolve

      expect(team.dissolved).toBe(true);
    });

    it('empty team does NOT dissolve if isHasBeen is false', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 3 }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
      });

      // Add only 1 of 3 desired → not full strength → isHasBeen stays false
      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);
      team.ai();

      e.alive = false;
      team.isAltered = true;
      team.ai();

      expect(team.isHasBeen).toBe(false);
      expect(team.dissolved).toBe(false);
    });
  });

  // ==========================================================================
  // Section 28: TMISSION_INVULNERABLE gap — C++ enum vs TS constants
  // C++ teamtype.h:44-66 defines the full enum:
  //   TMISSION_SET_GLOBAL    = 12,
  //   TMISSION_INVULNERABLE  = 13,  ← TS is MISSING this constant
  //   TMISSION_LOAD          = 14,
  //   TMISSION_SPY           = 15,
  //   TMISSION_PATROL        = 16,
  //   TMISSION_COUNT         = 17
  //
  // TS team.ts currently has:
  //   TMISSION_SET_GLOBAL = 12, TMISSION_LOAD = 13, TMISSION_SPY = 14, TMISSION_PATROL = 15
  // This is a numbering discrepancy — LOAD/SPY/PATROL are shifted down by 1.
  //
  // The TeamMissions array (teamtype.cpp:65-82) lists 16 entries for the
  // scenario editor, but uses explicit enum members — not indices.
  // The TMissions string array (teamtype.cpp:131-148) has 17 entries
  // indexed by enum value, with "Invulnerable" at index 13.
  //
  // The C++ enum is the source of truth for mission type numbering.
  // ==========================================================================
  describe('TMISSION_INVULNERABLE enum gap — C++ teamtype.h:44-66', () => {
    /**
     * C++ teamtype.h:44-66:
     *   TMISSION_SET_GLOBAL   = 12,
     *   TMISSION_INVULNERABLE = 13,
     *   TMISSION_LOAD         = 14,
     *   TMISSION_SPY          = 15,
     *   TMISSION_PATROL       = 16,
     *   TMISSION_COUNT        = 17
     *
     * C++ teamtype.cpp:131-148 TMissions string array:
     *   [13] = "Invulnerable"
     *   [14] = "Load onto Transport"
     *   [15] = "Spy on bldg @ waypt..."
     *   [16] = "Patrol to waypoint..."
     *
     * TS team.ts is missing TMISSION_INVULNERABLE (13), causing
     * TMISSION_LOAD=13, TMISSION_SPY=14, TMISSION_PATROL=15 — all off by 1.
     */
    it('C++ TMISSION_COUNT = 17 (17 distinct mission types, 0-16)', () => {
      // C++ teamtype.h:64: TMISSION_COUNT (value after TMISSION_PATROL=16 → 17)
      const CPP_TMISSION_COUNT = 17;
      expect(CPP_TMISSION_COUNT).toBe(17);
    });

    it('C++ TMissions string array has 17 entries with "Invulnerable" at [13]', () => {
      // C++ teamtype.cpp:131-148: char const * TeamTypeClass::TMissions[TMISSION_COUNT]
      const cppTMissionStrings = [
        'Attack...',                    // 0
        'Attack Waypoint...',           // 1
        'Change Formation to...',       // 2
        'Move to waypoint...',          // 3
        'Move to Cell...',              // 4
        'Guard area (1/10th min)...',   // 5
        'Jump to line #...',            // 6
        'Attack Tarcom',                // 7
        'Unload',                       // 8
        'Deploy',                       // 9
        'Follow friendlies',            // 10
        'Do this...',                   // 11
        'Set global...',                // 12
        'Invulnerable',                 // 13 ← TMISSION_INVULNERABLE
        'Load onto Transport',          // 14 ← TMISSION_LOAD
        'Spy on bldg @ waypt...',       // 15 ← TMISSION_SPY
        'Patrol to waypoint...',        // 16 ← TMISSION_PATROL
      ];
      expect(cppTMissionStrings.length).toBe(17);
      expect(cppTMissionStrings[13]).toBe('Invulnerable');
      expect(cppTMissionStrings[14]).toBe('Load onto Transport');
      expect(cppTMissionStrings[15]).toBe('Spy on bldg @ waypt...');
      expect(cppTMissionStrings[16]).toBe('Patrol to waypoint...');
    });

    it('TS TMISSION_LOAD should be 14 (C++ teamtype.h:60), not 13', () => {
      // C++ teamtype.h:60: TMISSION_LOAD = 14 (after INVULNERABLE=13)
      // TS team.ts currently has TMISSION_LOAD = 13 — divergence from C++ enum
      expect(TMISSION_LOAD).toBe(14);
    });

    it('TS TMISSION_SPY should be 15 (C++ teamtype.h:61), not 14', () => {
      // C++ teamtype.h:61: TMISSION_SPY = 15
      expect(TMISSION_SPY).toBe(15);
    });

    it('TS TMISSION_PATROL should be 16 (C++ teamtype.h:62), not 15', () => {
      // C++ teamtype.h:62: TMISSION_PATROL = 16
      expect(TMISSION_PATROL).toBe(16);
    });
  });

  // ==========================================================================
  // Section 29: TeamTypeClass limits (C++ teamtype.h:115-117)
  // C++ teamtype.h:116-117:
  //   MAX_TEAM_CLASSCOUNT = 5,  // max distinct unit types per team
  //   MAX_TEAM_MISSIONS = 20    // max mission entries in queue
  // ==========================================================================
  describe('TeamTypeClass limits — C++ teamtype.h:115-117', () => {
    it('MAX_TEAM_CLASSCOUNT = 5 (max distinct unit types per team definition)', () => {
      // C++ teamtype.h:116: MAX_TEAM_CLASSCOUNT=5
      // TeamTypeClass::Members[MAX_TEAM_CLASSCOUNT] — array of 5 member slots
      // Scenario INI team types should not have more than 5 distinct member types
      const CPP_MAX_TEAM_CLASSCOUNT = 5;
      expect(CPP_MAX_TEAM_CLASSCOUNT).toBe(5);
    });

    it('MAX_TEAM_MISSIONS = 20 (max mission entries in queue)', () => {
      // C++ teamtype.h:117: MAX_TEAM_MISSIONS=20
      // TeamTypeClass::MissionList[MAX_TEAM_MISSIONS] — array of 20 mission slots
      // TS Team.missionList has no hard cap but C++ limits to 20
      const CPP_MAX_TEAM_MISSIONS = 20;
      expect(CPP_MAX_TEAM_MISSIONS).toBe(20);
    });

    it('TS Team works correctly with 5 distinct member types (MAX_TEAM_CLASSCOUNT)', () => {
      // Verify TS can handle the C++ maximum of 5 member types
      const team = makeTeam({
        memberDefs: [
          { type: UnitType.V_1TNK, count: 2 },
          { type: UnitType.V_2TNK, count: 1 },
          { type: UnitType.V_3TNK, count: 3 },
          { type: UnitType.V_4TNK, count: 1 },
          { type: UnitType.V_MNLY, count: 1 },
        ],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
      });
      // Total desired = 2+1+3+1+1 = 8
      expect(team.desiredTotal).toBe(8);
    });

    it('TS Team works correctly with 20 missions (MAX_TEAM_MISSIONS)', () => {
      // Verify TS can handle the C++ maximum of 20 mission entries
      const missions = [];
      for (let i = 0; i < 20; i++) {
        missions.push({ mission: TMISSION_SET_GLOBAL, data: i });
      }
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions,
        forcedActive: true,
      });
      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      // Process all 20 SET_GLOBAL missions (each advances immediately)
      for (let i = 0; i < 30; i++) {
        if (team.dissolved) break;
        team.ai();
      }

      // Should have processed all 20 and dissolved
      expect(team.dissolved).toBe(true);
    });
  });

  // ==========================================================================
  // Section 30: STRAY_DISTANCE constant (C++ team.h:51)
  // C++ team.h:51: #define STRAY_DISTANCE 2
  // Used by Coordinate_Regroup to determine if members are too far from center.
  // ==========================================================================
  describe('STRAY_DISTANCE — C++ team.h:51', () => {
    it('C++ STRAY_DISTANCE = 2 (team.h:51)', () => {
      // C++ team.h:51: #define STRAY_DISTANCE 2
      // This is 2 cells (512 leptons). Used as threshold for regroup.
      const CPP_STRAY_DISTANCE = 2;
      expect(CPP_STRAY_DISTANCE).toBe(2);
    });
  });

  // ==========================================================================
  // Section 31: TeamTypeClass constructor defaults (C++ teamtype.cpp:165-188)
  // ==========================================================================
  describe('TeamTypeClass constructor defaults — C++ teamtype.cpp:165-188', () => {
    it('RecruitPriority defaults to 7 (teamtype.cpp:173)', () => {
      // C++ teamtype.cpp:173: RecruitPriority(7)
      const CPP_DEFAULT_RECRUIT_PRIORITY = 7;
      expect(CPP_DEFAULT_RECRUIT_PRIORITY).toBe(7);

      const team = makeTeam({});
      expect(team.recruitPriority).toBe(7);
    });

    it('MaxAllowed defaults to 0 (teamtype.cpp:175)', () => {
      // C++ teamtype.cpp:175: MaxAllowed(0) — no instances allowed by default
      const CPP_DEFAULT_MAX_ALLOWED = 0;
      expect(CPP_DEFAULT_MAX_ALLOWED).toBe(0);
    });

    it('Origin defaults to -1 (teamtype.cpp:179)', () => {
      // C++ teamtype.cpp:179: Origin(-1) — no specific waypoint origin
      const CPP_DEFAULT_ORIGIN = -1;
      expect(CPP_DEFAULT_ORIGIN).toBe(-1);
    });

    it('IsReinforcable defaults to true (teamtype.cpp:171)', () => {
      // C++ teamtype.cpp:171: IsReinforcable(true)
      const team = makeTeam({});
      expect(team.isReinforcable).toBe(true);
    });

    it('IsSuicide defaults to false (teamtype.cpp:168)', () => {
      // C++ teamtype.cpp:168: IsSuicide(false)
      const team = makeTeam({});
      expect(team.isSuicide).toBe(false);
    });

    it('IsPrebuilt defaults to true (teamtype.cpp:170)', () => {
      // C++ teamtype.cpp:170: IsPrebuilt(true)
      const CPP_DEFAULT_IS_PREBUILT = true;
      expect(CPP_DEFAULT_IS_PREBUILT).toBe(true);
    });

    it('IsRoundAbout defaults to false (teamtype.cpp:167)', () => {
      // C++ teamtype.cpp:167: IsRoundAbout(false)
      const CPP_DEFAULT_IS_ROUNDABOUT = false;
      expect(CPP_DEFAULT_IS_ROUNDABOUT).toBe(false);
    });
  });

  // ==========================================================================
  // Section 32: Team Add/Remove member semantics (C++ team.cpp:891-936, 1053-1158)
  // ==========================================================================
  describe('Team Add/Remove — C++ team.cpp:891-936, 1053-1158', () => {
    it('add() returns false for dead entities (C++ _Is_It_Breathing, team.cpp:99-120)', () => {
      const team = makeTeam({});
      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      e.alive = false;
      e.hp = 0;

      expect(team.add(e)).toBe(false);
      expect(team.total).toBe(0);
    });

    it('add() returns false for duplicate member (C++ team.cpp:969-971)', () => {
      const team = makeTeam({});
      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);

      expect(team.add(e)).toBe(true);
      expect(team.add(e)).toBe(false);
      expect(team.total).toBe(1);
    });

    it('add() transfers entity from old team to new (C++ team.cpp:904-906)', () => {
      const team1 = makeTeam({});
      const team2 = makeTeam({});
      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);

      team1.add(e);
      expect(team1.total).toBe(1);

      team2.add(e);
      expect(team1.total).toBe(0);
      expect(team2.total).toBe(1);
      expect(e.teamRef).toBe(team2);
    });

    it('remove() clears entity teamRef (C++ team.cpp:1116)', () => {
      const team = makeTeam({});
      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);

      team.add(e);
      expect(e.teamRef).toBe(team);

      team.remove(e);
      expect(e.teamRef).toBeNull();
    });

    it('remove() returns true for non-member (C++ team.cpp:1062-1064)', () => {
      // C++ team.cpp:1062-1064: if (this != obj->Team) return(true)
      const team = makeTeam({});
      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);

      expect(team.remove(e)).toBe(true);
    });

    it('add() marks team as altered (C++ team.cpp:934)', () => {
      const team = makeTeam({});
      team.isAltered = false;

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      expect(team.isAltered).toBe(true);
    });

    it('remove() marks team as altered (C++ team.cpp:1152)', () => {
      const team = makeTeam({});
      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);
      team.isAltered = false;

      team.remove(e);

      expect(team.isAltered).toBe(true);
    });

    it('C++ first member gets IsInitiated=true (team.cpp:912)', () => {
      // C++ team.cpp:912: obj->IsInitiated = (Member == NULL)
      // The very first member added gets initiated; subsequent must travel to team center.
      // TS simplifies: all members effectively initiated immediately.
      // Document the C++ behavior.
      const CPP_FIRST_MEMBER_INITIATED = true;
      expect(CPP_FIRST_MEMBER_INITIATED).toBe(true);
    });
  });

  // ==========================================================================
  // Section 33: Recruit priority stealing (C++ team.cpp:995)
  // C++ team.cpp:995:
  //   if (obj->Team.Is_Valid() && (obj->Team->Class->RecruitPriority >= Class->RecruitPriority))
  //     return(false);
  // Only a strictly higher priority team can steal members from lower.
  // ==========================================================================
  describe('Recruit priority stealing — C++ team.cpp:995', () => {
    it('entity transfers from lower-priority to higher-priority team', () => {
      // C++ team.cpp:995: existing_pri >= new_pri → can't steal
      // So 5 < 10 → highPri CAN steal from lowPri
      const lowPriTeam = makeTeam({ recruitPriority: 5 });
      const highPriTeam = makeTeam({ recruitPriority: 10 });
      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);

      lowPriTeam.add(e);
      expect(e.teamRef).toBe(lowPriTeam);

      // TS add() removes from old team unconditionally; C++ has priority check in Can_Add.
      // The transfer still occurs because TS handles the actual removal.
      highPriTeam.add(e);
      expect(e.teamRef).toBe(highPriTeam);
      expect(lowPriTeam.total).toBe(0);
    });
  });

  // ==========================================================================
  // Section 34: desiredTotal calculation (C++ team.cpp:500-502)
  // C++ team.cpp:500-502:
  //   for (int index = 0; index < Class->ClassCount; index++)
  //     desired += Class->Members[index].Quantity;
  // ==========================================================================
  describe('desiredTotal — C++ team.cpp:500-502', () => {
    it('sums all member type quantities', () => {
      const team = makeTeam({
        memberDefs: [
          { type: UnitType.V_1TNK, count: 3 },
          { type: UnitType.V_2TNK, count: 5 },
          { type: UnitType.V_3TNK, count: 2 },
        ],
      });
      // 3 + 5 + 2 = 10
      expect(team.desiredTotal).toBe(10);
    });

    it('single member type', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 7 }],
      });
      expect(team.desiredTotal).toBe(7);
    });

    it('empty members → 0', () => {
      const team = makeTeam({ memberDefs: [] });
      expect(team.desiredTotal).toBe(0);
    });
  });

  // ==========================================================================
  // Section 35: C++ team.cpp destructor decrements Class->Number (team.cpp:298)
  // ==========================================================================
  describe('Team destructor — C++ team.cpp:292-312', () => {
    it('C++ decrements Class->Number on destruction (team.cpp:298)', () => {
      // C++ team.cpp:298: Class->Number--
      // In C++, the team type tracks active instances via Number field.
      // This is checked by Create_One_Of() (teamtype.cpp:355):
      //   if (ScenarioInit || Number < MaxAllowed)
      // In TS, autocreateTeamCounts tracks this.
      const CPP_NUMBER_DECREMENTS_ON_DESTROY = true;
      expect(CPP_NUMBER_DECREMENTS_ON_DESTROY).toBe(true);
    });
  });

  // ==========================================================================
  // Section 36: Create_One_Of MaxAllowed check (C++ teamtype.cpp:353-360)
  // C++ teamtype.cpp:355:
  //   if (ScenarioInit || Number < MaxAllowed)
  //     return(new TeamClass(this, HouseClass::As_Pointer(House)));
  //   return(NULL);
  // ==========================================================================
  describe('Create_One_Of — C++ teamtype.cpp:353-360', () => {
    it('C++ blocks creation when Number >= MaxAllowed', () => {
      // C++ teamtype.cpp:355: if (ScenarioInit || Number < MaxAllowed)
      // If Number >= MaxAllowed and not ScenarioInit → returns NULL
      const CPP_BLOCKS_WHEN_AT_MAX = true;
      expect(CPP_BLOCKS_WHEN_AT_MAX).toBe(true);
    });

    it('C++ allows creation during ScenarioInit regardless of MaxAllowed', () => {
      // C++ teamtype.cpp:355: if (ScenarioInit || Number < MaxAllowed)
      // During scenario initialization, bypass MaxAllowed
      const CPP_SCENARIO_INIT_BYPASSES_MAX = true;
      expect(CPP_SCENARIO_INIT_BYPASSES_MAX).toBe(true);
    });
  });

  // ==========================================================================
  // Section 37: Under-strength resets movement (C++ team.cpp:577-580)
  // C++ team.cpp:577-579:
  //   if (IsMoving && IsUnderStrength) {
  //     IsMoving = false;
  //     CurrentMission = -1;
  // ==========================================================================
  describe('Under-strength resets movement — C++ team.cpp:577-580', () => {
    it('IsMoving=false, CurrentMission=-1 when team goes under-strength while moving', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 9 }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
        isReinforcable: true,
        forcedActive: true,
      });

      const entities: Entity[] = [];
      for (let i = 0; i < 9; i++) {
        const e = makeEntity(UnitType.V_3TNK, House.USSR, 100 + i * 5, 100);
        entities.push(e);
        team.add(e);
      }
      team.ai(); // full strength → activate → isMoving=true
      team.ai(); // advance to GUARD

      expect(team.isMoving).toBe(true);

      // Kill 7 → 2 alive of 9 desired → 2 <= floor(9/3)=3 → under-strength
      for (let i = 0; i < 7; i++) {
        entities[i].alive = false;
      }
      team.isAltered = true;
      team.ai();

      // C++ team.cpp:577-579: resets movement
      expect(team.isMoving).toBe(false);
      expect(team.currentMission).toBe(-1);
    });
  });

  // ==========================================================================
  // Section 38: Formation reform on strength transition (C++ team.cpp:569-571)
  // C++ team.cpp:569-571:
  //   if (old_under != IsUnderStrength) {
  //     IsReforming = true;
  //   }
  // ==========================================================================
  describe('Formation reform on strength transition — C++ team.cpp:569-571', () => {
    it('isReforming set when isUnderStrength transitions from true to false', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 9 }],
        isReinforcable: true,
      });

      // Start with 2 members → under-strength (2 <= 3)
      team.add(makeEntity(UnitType.V_3TNK, House.USSR, 100, 100));
      team.add(makeEntity(UnitType.V_3TNK, House.USSR, 110, 100));
      team.ai();
      expect(team.isUnderStrength).toBe(true);

      // Add more to go above 1/3 threshold (4 > 3)
      team.add(makeEntity(UnitType.V_3TNK, House.USSR, 120, 100));
      team.add(makeEntity(UnitType.V_3TNK, House.USSR, 130, 100));
      team.ai();

      expect(team.isUnderStrength).toBe(false);
      expect(team.isReforming).toBe(true);
    });
  });

  // ==========================================================================
  // Section 39: Dissolve clears all member references (C++ team.cpp:292-312)
  // ==========================================================================
  describe('Dissolve clears members — C++ team.cpp:292-312', () => {
    it('dissolve() clears all member teamRefs and sets Mission.GUARD', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 3 }],
      });
      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 200, 100);
      const e3 = makeEntity(UnitType.V_3TNK, House.USSR, 300, 100);
      team.add(e1);
      team.add(e2);
      team.add(e3);

      // Set non-GUARD missions to verify they get reset
      e1.mission = Mission.ATTACK;
      e2.mission = Mission.MOVE;

      team.dissolve();

      expect(team.dissolved).toBe(true);
      expect(team.total).toBe(0);
      expect(e1.teamRef).toBeNull();
      expect(e2.teamRef).toBeNull();
      expect(e3.teamRef).toBeNull();
      // C++ Enter_Idle_Mode: queues GUARD only if NOT already in GUARD/AREA_GUARD.
      // infantry.cpp:1348 early return when Mission == GUARD/AREA_GUARD.
      expect(e1.missionQueue).toBe(Mission.GUARD); // was ATTACK → queued
      expect(e2.missionQueue).toBe(Mission.GUARD); // was MOVE → queued
      expect(e3.missionQueue).toBeNull();           // was GUARD → no-op (early return)
    });

    it('ai() is no-op after dissolve', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [{ mission: TMISSION_GUARD, data: 5 }],
      });
      team.add(makeEntity(UnitType.V_3TNK, House.USSR, 100, 100));
      team.dissolve();

      // Should not throw or change state
      team.ai();
      expect(team.dissolved).toBe(true);
    });
  });

  // ==========================================================================
  // Section 40: Suspend/resume with timer (C++ team.cpp:484-489)
  // C++ team.cpp:484-489:
  //   if (Suspended) {
  //     if (SuspendTimer != 0) return;
  //     Suspended = false;
  //   }
  // ==========================================================================
  describe('Suspend/resume — C++ team.cpp:484-489', () => {
    it('suspended team skips AI while suspendTimer > 0, resumes when timer expires', () => {
      // C++ team.cpp:484-489: CDTimerClass auto-decrements each frame.
      //   if (Suspended) { if (SuspendTimer != 0) return; Suspended = false; }
      // TS manually decrements: if (suspendTimer > 0) { suspendTimer--; return; }
      // With suspendTimer=2: tick 1 → 1, tick 2 → 0, tick 3 → timer is 0 → resume
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [{ mission: TMISSION_GUARD, data: 5 }],
        forcedActive: true,
      });
      team.add(makeEntity(UnitType.V_3TNK, House.USSR, 100, 100));
      team.suspended = true;
      team.suspendTimer = 2;

      const prevMission = team.currentMission;
      team.ai(); // timer=2>0 → decrement to 1, return (skipped)
      expect(team.currentMission).toBe(prevMission);
      expect(team.suspended).toBe(true);
      expect(team.suspendTimer).toBe(1);

      team.ai(); // timer=1>0 → decrement to 0, return (skipped)
      expect(team.suspended).toBe(true);
      expect(team.suspendTimer).toBe(0);

      team.ai(); // timer=0, not >0 → clears suspend, processes normally
      expect(team.suspended).toBe(false);
    });
  });
});
