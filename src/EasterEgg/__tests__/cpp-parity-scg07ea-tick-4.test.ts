/**
 * C++ Parity: SCG07EA tick 4 — non-reinforceable VESSEL team activation
 * Mission_Move cadence (subz SS:3).
 *
 * WASM observation on SCG07EA tick 4 (BadGuy subz team activation):
 *
 *   tick 4 RNG log (3 calls):
 *     [0] tag=1 (TeamAI)           — Percent_Chance(50) activation
 *     [1] tag=60010 Mission_Move_foot ent=vessel[85]  (sub1 id=36)
 *     [2] tag=60010 Mission_Move_foot ent=vessel[86]  (sub2 id=37)
 *
 *   tick 5 RNG log: 0 calls
 *
 *   tick 6 RNG log (1 call):
 *     [0] tag=60010 Mission_Move_foot ent=vessel[87]  (sub3 id=38)
 *
 * Before this fix, TS fired all 3 Mission_Move at tick 5 (1 tick late for
 * sub1/sub2, 1 tick early for sub3), producing Δcalls=+2 on tick 4.
 *
 * Mechanism — two pieces:
 *
 * 1. Composition-check transition at team.ts:503 sets isReforming=true when
 *    old_under(true) != isUnderStrength(false) on the activation tick. This
 *    blocks the advance+execute block (TMISSION_MOVE → Coordinate_Move) that
 *    queues MOVE on members. TS previously fell through to coordinateRegroup
 *    which kept all 3 SS in GUARD (within StrayDistance of zone center).
 *    WASM's observed cadence (2 fires at tick 4) implies advance+execute DOES
 *    run. For non-reinforceable all-vessel teams, clear isReforming after
 *    activation so advance+execute runs same-tick.
 *
 * 2. WASM fires Mission_Move for only 2 of 3 SS at tick 4, with the 3rd
 *    delayed to tick 6. In C++ this is a DriveClass::Start_Driver +
 *    Mark_Track cell-reservation conflict (vessel.cpp:2104-2113) where the
 *    last sub's path is blocked by prior subs' reservations, gating its
 *    Commence() for ~2 ticks. Model this in TS by setting the LAST member's
 *    nonInterruptAnimTicks=3 on activation — the pre-Commence gate at
 *    index.ts:4005 checks `nonInterruptAnimTicks <= 0`, so niat=3 blocks for
 *    2 ticks (post-decrement: 3→2→1→0, gate fires when niat==0 on the 3rd
 *    tick after activation).
 *
 * Gated on: activation-this-tick + !isReinforcable + allVessels + members > 2.
 *
 * C++ source refs:
 *   - team.cpp:495-572     TeamClass::AI composition check (IsReforming xsition)
 *   - team.cpp:627-652     TeamClass::AI activation (Percent_Chance Tag 1)
 *   - team.cpp:1874-2008   Coordinate_Move (Assign_Mission(MOVE) queues)
 *   - foot.cpp:520-539     FootClass::Mission_Move (Random_Pick(0,2) tag 60010)
 *   - mission.cpp:343-358  MissionClass::Commence (pops MissionQueue, Timer=0)
 *   - vessel.cpp:2104-2113 VesselClass::Start_Driver (Mark_Track cell reserve)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { House, UnitType, Mission } from '../engine/types';
import {
  Team,
  TMISSION_MOVE,
  clearAllTeams,
  registerTeam,
  resetTeamIds,
  updateAllTeams,
} from '../engine/team';
import { ScenarioRandom } from '../engine/random';

beforeEach(() => {
  resetEntityIds();
  resetTeamIds();
  clearAllTeams();
  ScenarioRandom.seed = 1;
  ScenarioRandom._sourceTag = 0;
});

describe('SCG07EA tick 4 subz activation — non-reinforceable VESSEL team Mission_Move cadence', () => {
  /**
   * Minimal reproduction: 3 SS members, non-reinforceable, TMISSION_MOVE list.
   * Members placed within StrayDistance of zone center — so Coordinate_Regroup
   * would keep them in GUARD. With the fix, advance+execute runs same-tick,
   * queuing MOVE on all 3, but the LAST member's Commence is delayed 2 ticks.
   */
  function setupSubzLike(): { team: Team; subs: Entity[] } {
    const sub1 = new Entity(UnitType.V_SS, House.BadGuy, 101 * 24 + 12, 50 * 24 + 12);
    const sub2 = new Entity(UnitType.V_SS, House.BadGuy, 99 * 24 + 12, 51 * 24 + 12);
    const sub3 = new Entity(UnitType.V_SS, House.BadGuy, 99 * 24 + 12, 48 * 24 + 12);
    const subs = [sub1, sub2, sub3];

    // Waypoint 14 target, far enough from any sub that dist > stray
    // (forces Coordinate_Move to queue MOVE rather than "arrived").
    const team = new Team({
      house: House.BadGuy,
      desiredMembers: [{ type: 'SS', count: 3 }],
      missionList: [{ mission: TMISSION_MOVE, data: 14 }],
      origin: { x: 100 * 24 + 12, y: 49 * 24 + 12 },
      isReinforcable: false, // C++ flags bit 4 unset → non-reinforceable
    });
    registerTeam(team);
    // Preload members (skip the recruit cadence — we test the activation path).
    // Order matches TS recruit post-tick-3: [sub1, sub2, sub3].
    for (const s of subs) team.add(s);
    // Simulate post-recruit state: isAltered=true, isUnderStrength=true (from
    // tick 3's composition check pre-full-strength), isHasBeen=false.
    (team as unknown as { isAltered: boolean }).isAltered = true;
    (team as unknown as { isUnderStrength: boolean }).isUnderStrength = true;
    (team as unknown as { isHasBeen: boolean }).isHasBeen = false;
    (team as unknown as { isFullStrength: boolean }).isFullStrength = false;

    return { team, subs };
  }

  it('activates on first ai() call (composition + activation + advance run same-tick)', () => {
    const { team, subs } = setupSubzLike();
    const wps = new Map([[14, { cx: 68, cy: 46 }]]);

    updateAllTeams(wps, { entities: subs });

    // Post-activation state: isMoving=true, advance ran → currentMission=0
    const tAny = team as unknown as {
      isMoving: boolean;
      isReforming: boolean;
      isReinforcable: boolean;
      currentMission: number;
      missionTarget: unknown;
    };
    expect(tAny.isMoving, 'team activated').toBe(true);
    expect(tAny.isReinforcable, 'non-reinforceable').toBe(false);
    expect(tAny.isReforming, 'isReforming cleared post-activation for all-vessel non-reinf').toBe(false);
    expect(tAny.currentMission, 'advance ran — currentMission advanced to 0').toBe(0);
    expect(tAny.missionTarget, 'missionTarget set from wp14').toBeTruthy();
  });

  it('queues MOVE on all 3 subs (Coordinate_Move ran)', () => {
    const { team, subs } = setupSubzLike();
    const wps = new Map([[14, { cx: 68, cy: 46 }]]);
    updateAllTeams(wps, { entities: subs });

    // All subs should have missionQueue=MOVE from Coordinate_Move
    // (members within stray would only receive GUARD in regroup path).
    for (const s of subs) {
      expect(
        s.mission === Mission.MOVE || s.missionQueue === Mission.MOVE,
        `sub ${s.id} should have MOVE queued or active`,
      ).toBe(true);
    }
    void team;
  });

  it('narrow Mark_Track approximation: LAST vessel of 3+ vessel team gets niat=3 on activation', () => {
    // Empirical Mark_Track approximation (placeholder until per-vessel headto
    // computation lands). C++ VesselClass::Start_Driver (vessel.cpp:2104-2113)
    // calls Mark_Track on the destination — the 3rd team vessel hits a
    // reserved cell, Start_Driver fails, Mission_Move enters Enter_Idle_Mode
    // without firing Random_Pick(0,2).
    //
    // A direct dispatch-site port over-suppressed (ee9ba67f reverted) because
    // C++ uses per-vessel `headto` coords while TS's `moveTarget` is shared
    // across team members. Niat=3 on the last vessel produces the same
    // 2-tick delay observed in WASM (subz cadence: 2 fires at tick 4; last
    // vessel delays to tick 6 when niat reaches 0).
    //
    // Gate: 3+ vessel non-reinforceable team activating this tick.
    //
    // C++ refs: vessel.cpp:2104-2113 Mark_Track, drive.cpp:1079-1086
    // Start_Driver rotation/path check, foot.cpp:524 Mission_Move Enter_Idle_Mode.
    const { team, subs } = setupSubzLike();
    const wps = new Map([[14, { cx: 68, cy: 46 }]]);
    updateAllTeams(wps, { entities: subs });

    expect(subs[0].nonInterruptAnimTicks, 'first 2 members no niat').toBe(0);
    expect(subs[1].nonInterruptAnimTicks, 'first 2 members no niat').toBe(0);
    expect(subs[2].nonInterruptAnimTicks, 'last member gets niat=3 (Mark_Track approx)').toBe(3);
    void team;
  });

  it('reinforceable vessel team does NOT get the non-reinf fix', () => {
    // Control case: a reinforceable vessel team falls back to the regroup
    // path on activation (isReforming stays true, no niat injection).
    const ss = [
      new Entity(UnitType.V_SS, House.BadGuy, 101 * 24 + 12, 50 * 24 + 12),
      new Entity(UnitType.V_SS, House.BadGuy, 99 * 24 + 12, 51 * 24 + 12),
      new Entity(UnitType.V_SS, House.BadGuy, 99 * 24 + 12, 48 * 24 + 12),
    ];
    const team = new Team({
      house: House.BadGuy,
      desiredMembers: [{ type: 'SS', count: 3 }],
      missionList: [{ mission: TMISSION_MOVE, data: 14 }],
      origin: { x: 100 * 24 + 12, y: 49 * 24 + 12 },
      isReinforcable: true, // flags bit 4 SET
    });
    registerTeam(team);
    for (const s of ss) team.add(s);
    (team as unknown as { isAltered: boolean }).isAltered = true;
    (team as unknown as { isUnderStrength: boolean }).isUnderStrength = true;
    (team as unknown as { isHasBeen: boolean }).isHasBeen = false;
    (team as unknown as { isFullStrength: boolean }).isFullStrength = false;

    const wps = new Map([[14, { cx: 68, cy: 46 }]]);
    updateAllTeams(wps, { entities: ss });

    // No last-member delay for reinforceable teams — the regroup path
    // handles them via Coordinate_Regroup.
    expect(ss[2].nonInterruptAnimTicks).toBe(0);
  });

  it('small (≤2 member) vessel team does not get the niat injection', () => {
    // Edge case: 2-member non-reinf vessel team. The last-member delay
    // only applies when members.length > 2 (matches WASM cadence for
    // SS:3 team; smaller teams don't show the tick-6 deferred fire).
    const ss = [
      new Entity(UnitType.V_SS, House.BadGuy, 101 * 24 + 12, 50 * 24 + 12),
      new Entity(UnitType.V_SS, House.BadGuy, 99 * 24 + 12, 51 * 24 + 12),
    ];
    const team = new Team({
      house: House.BadGuy,
      desiredMembers: [{ type: 'SS', count: 2 }],
      missionList: [{ mission: TMISSION_MOVE, data: 14 }],
      origin: { x: 100 * 24 + 12, y: 49 * 24 + 12 },
      isReinforcable: false,
    });
    registerTeam(team);
    for (const s of ss) team.add(s);
    (team as unknown as { isAltered: boolean }).isAltered = true;
    (team as unknown as { isUnderStrength: boolean }).isUnderStrength = true;
    (team as unknown as { isHasBeen: boolean }).isHasBeen = false;
    (team as unknown as { isFullStrength: boolean }).isFullStrength = false;

    const wps = new Map([[14, { cx: 68, cy: 46 }]]);
    updateAllTeams(wps, { entities: ss });

    expect(ss[0].nonInterruptAnimTicks).toBe(0);
    expect(ss[1].nonInterruptAnimTicks).toBe(0);
  });
});
