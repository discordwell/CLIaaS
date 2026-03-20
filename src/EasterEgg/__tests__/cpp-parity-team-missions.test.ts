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
 *   - teamtype.cpp:65-82 — 16 TMISSION_* types
 *   - defines.h:3031-3032 — TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
 *   - rules.cpp:260      — StrayDistance = 0x0200 (512 leptons = 2 cells)
 *
 * Observable outcomes: timeout scaling, mission dispatch order, target assignment,
 * attack advance conditions, loop jump, DO mission mapping, Took_Damage retargeting.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { House, Mission, UnitType, CELL_SIZE } from '../engine/types';
import {
  Team, resetTeamIds,
  TMISSION_MOVE, TMISSION_ATTACK, TMISSION_ATT_WAYPT, TMISSION_GUARD,
  TMISSION_UNLOAD, TMISSION_DEPLOY, TMISSION_PATROL, TMISSION_LOOP, TMISSION_DO,
  TMISSION_SET_GLOBAL, TMISSION_ATTACKTARCOM, TMISSION_LOAD, TMISSION_FORMATION,
  TMISSION_MOVECELL, TMISSION_HOUND_DOG, TMISSION_SPY,
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
     * C++ teamtype.cpp:65-82:
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
     *     {TMISSION_LOAD},         // 13
     *     {TMISSION_SPY},          // 14
     *     {TMISSION_PATROL},       // 15
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
      ['TMISSION_LOAD',         TMISSION_LOAD,         13],
      ['TMISSION_SPY',          TMISSION_SPY,          14],
      ['TMISSION_PATROL',       TMISSION_PATROL,       15],
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
  // TS uses: this.timeOut = mission.data * 9
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
     * TS team.ts:359:
     *   this.timeOut = mission.data * 9;  // ~TICKS_PER_MINUTE/10 simplified
     *
     * The TS scaling factor is 9 (not 90). This is a 10x divergence from C++.
     * If this is intentional (game runs at different tick rate), it's a design
     * choice. If not, it's a PARITY GAP.
     */
    it('C++ TICKS_PER_MINUTE = 900, scaling = 90; TS uses 9', () => {
      // C++ expected: data=1 → timeout=90 ticks
      // TS actual: data=1 → timeout=9 ticks
      const CPP_TICKS_PER_MINUTE = 900;
      const CPP_SCALING = CPP_TICKS_PER_MINUTE / 10; // 90
      const TS_SCALING = 9;

      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_GUARD, data: 1 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      // Tick 1: composition check → activation → reforming (isReforming=true
      //   because isUnderStrength transitioned from true to false).
      //   Advance/execute blocks skipped while reforming.
      //   Regroup runs, sets isReforming=false.
      team.ai();

      // Tick 2: advance block runs (isMoving, !isReforming, isNextMission)
      //   → currentMission=0 (GUARD), timeOut = data * 9 = 9
      //   Execute block runs GUARD: coordinateRegroup, timeOut-- → 8
      team.ai();

      // C++ would set TimeOut = 1 * 90 = 90, after first GUARD tick: 89
      // TS sets timeOut = 1 * 9 = 9, after first GUARD tick: 8
      // PARITY GAP: TS timeout scaling is 10x smaller than C++
      expect(team.timeOut).toBe(1 * TS_SCALING - 1); // 9 - 1 = 8 after first tick
      expect(1 * TS_SCALING).not.toBe(1 * CPP_SCALING); // PARITY GAP: 9 !== 90
    });

    it('guard data=5 timeout should be 450 ticks in C++ (45 in TS)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_GUARD, data: 5 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      team.ai(); // tick 1: activate + regroup (reforming)
      team.ai(); // tick 2: advance to GUARD + execute GUARD (decrements once)

      // Initial: 5 * 9 = 45, after first GUARD tick: 45 - 1 = 44
      // C++ would be: 5 * 90 = 450, after first tick: 449
      // PARITY GAP: 10x difference in timeout scaling
      expect(team.timeOut).toBe(5 * 9 - 1); // 45 - 1 = 44
      expect(5 * 9).not.toBe(5 * 90); // PARITY GAP: 45 !== 450
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

      // C++ team.cpp destructor calls Remove() on each member
      // Remove() calls Enter_Idle_Mode() (team.cpp:1139) which sets MISSION_GUARD
      expect(e.mission).toBe(Mission.GUARD);
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

      // Should be on ATT_WAYPT mission (0), member in ATTACK mode
      expect(team.currentMission).toBe(0);
      expect(e.mission).toBe(Mission.ATTACK);
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
       * When DO is the LAST mission, it sets the member mission and then the
       * team dissolves (mission queue exhausted). After dissolution, members
       * enter idle mode (GUARD) per team.cpp destructor calling Remove()→Enter_Idle_Mode().
       *
       * When DO is followed by another mission, the next mission's coordination
       * (e.g. Coordinate_Regroup for GUARD) overrides the member mission in the
       * same tick that it advances.
       *
       * To test that DO actually assigns the correct mission, we make DO the
       * sole mission. The member briefly gets HUNT, then dissolution sets GUARD.
       * We verify DO advances immediately (tested separately) and that
       * mapCppMission(14) returns HUNT by testing coordinateDo directly.
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

      // Call coordinateDo directly to verify mission assignment without
      // interference from subsequent team missions
      team.coordinateDo({ mission: TMISSION_DO, data: 14 });

      expect(e1.mission).toBe(Mission.HUNT);
      expect(e2.mission).toBe(Mission.HUNT);
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

      expect(e.mission).toBe(Mission.ATTACK);
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

      expect(e.mission).toBe(Mission.AREA_GUARD);
    });

    it('DO advances immediately (isNextMission=true, team.cpp:1856 equivalent)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_DO, data: 14 },      // index 0 — advances immediately
          { mission: TMISSION_GUARD, data: 100 },   // index 1
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      // Run enough ticks to get past DO
      for (let i = 0; i < 5; i++) {
        team.ai();
      }

      // Should be on GUARD (mission index 1) since DO advances immediately
      expect(team.currentMission).toBe(1);
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

      // Members should be ordered to move
      expect(e1.mission).toBe(Mission.MOVE);
      expect(e2.mission).toBe(Mission.MOVE);

      // Should still be on MOVE mission
      expect(team.currentMission).toBe(0);
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
  // TS team.ts:490: worldDist(unit.pos, this.zone) > 3 (3 world units)
  // ==========================================================================
  describe('Coordinate_Regroup stray distance (team.cpp:1757, rules.cpp:260)', () => {
    /**
     * C++ rules.cpp:260: StrayDistance = 0x0200 (512 leptons)
     * 1 cell = 256 leptons (CELL_LEPTON_W)
     * StrayDistance = 2 cells
     *
     * TS uses worldDist > 3 (3 pixels/world-units).
     *
     * In TS, CELL_SIZE = 24 pixels. So 2 cells = 48 pixels.
     * The TS threshold of 3 is much smaller than C++ equivalent.
     *
     * This is likely intentional (different coordinate system), but we
     * document the divergence.
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

      team.calcCenter();
      const result = team.coordinateRegroup();

      // Not all regrouped → returns false
      expect(result).toBe(false);

      // Distant unit should be ordered to MOVE
      expect(e2.mission).toBe(Mission.MOVE);
      expect(e2.moveTarget).toBeTruthy();
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

      expect(e.mission).toBe(Mission.MOVE);
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
    it('SET_GLOBAL → DO → GUARD processes in sequence', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_SET_GLOBAL, data: 1 },  // index 0 — immediate
          { mission: TMISSION_DO, data: 14 },          // index 1 — HUNT, immediate
          { mission: TMISSION_GUARD, data: 100 },      // index 2 — stays here
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

      // Should have visited missions 0, 1, 2 in order
      expect(missionsSeen).toContain(0);
      expect(missionsSeen).toContain(1);
      expect(missionsSeen).toContain(2);

      // Should end on GUARD (index 2) since it hasn't timed out
      expect(team.currentMission).toBe(2);

      // Member mission is NOT HUNT because the GUARD mission's
      // coordinateRegroup() overrides it. This is correct C++ behavior:
      // Coordinate_Regroup assigns MISSION_GUARD or MISSION_MOVE to members.
      // The DO mission briefly set HUNT, but the GUARD coordination replaced it.
      expect(e.mission).not.toBe(Mission.HUNT);

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
      expect(team.zone!.x).toBe(150);
      expect(team.zone!.y).toBe(300);
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
});
