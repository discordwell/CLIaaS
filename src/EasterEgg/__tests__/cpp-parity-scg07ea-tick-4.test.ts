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
 * Mechanism — three C++ pieces:
 *
 * 1. C++ TeamClass::Add inserts new members at the HEAD of the Member linked
 *    list. The newest SS is processed first during regroup.
 *
 * 2. C++ activation leaves IsReforming=true and runs Coordinate_Regroup, not
 *    the main TMISSION_MOVE. Calc_Center first averages playing members, then
 *    falls back to the closest member CELL target because the C++ source checks
 *    `!Can_Enter_Cell(...)`; MOVE_OK is enum value 0. Regroup queues MOVE only
 *    for the two far subs; the close sub stays GUARD.
 *
 * 3. C++ Coordinate_Regroup returns false only while assigning fresh NavCom.
 *    On the following tick, the two far subs already have NavCom, so reforming
 *    clears; the team then advances and queues the third sub's MOVE, producing
 *    the tick-6 Mission_Move jitter.
 *
 * C++ source refs:
 *   - team.cpp:495-572     TeamClass::AI composition check (IsReforming xsition)
 *   - team.cpp:627-652     TeamClass::AI activation (Percent_Chance Tag 1)
 *   - team.cpp:891-914     TeamClass::Add (newest-first Member chain)
 *   - team.cpp:1390-1551   Calc_Center
 *   - team.cpp:1744-1792   Coordinate_Regroup
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
   * TeamClass::Add inserts at the linked-list head, so after adding
   * [sub1, sub2, sub3], the C++/TS member order is [sub3, sub2, sub1].
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
    // add() must mirror C++ newest-first linked-list insertion.
    for (const s of subs) team.add(s);
    // Simulate post-recruit state: isAltered=true, isUnderStrength=true (from
    // tick 3's composition check pre-full-strength), isHasBeen=false.
    (team as unknown as { isAltered: boolean }).isAltered = true;
    (team as unknown as { isUnderStrength: boolean }).isUnderStrength = true;
    (team as unknown as { isHasBeen: boolean }).isHasBeen = false;
    (team as unknown as { isFullStrength: boolean }).isFullStrength = false;

    return { team, subs };
  }

  function scg07NavalCtx(subs: Entity[]) {
    return {
      entities: subs,
      // The averaged center of this three-sub cluster is cell (100,50). C++
      // VesselClass::Can_Enter_Cell returns MOVE_OK there, and TeamClass::
      // Calc_Center falls back because it negates the raw MoveType enum.
      canEnterCell: (_unit: Entity, _cx: number, _cy: number) => true,
    };
  }

  it('activates into reforming regroup, not main mission advance', () => {
    const { team, subs } = setupSubzLike();
    const wps = new Map([[14, { cx: 68, cy: 46 }]]);

    updateAllTeams(wps, scg07NavalCtx(subs));

    const tAny = team as unknown as {
      isMoving: boolean;
      isReforming: boolean;
      isReinforcable: boolean;
      currentMission: number;
      missionTarget: unknown;
      zoneLeptonX: number;
      zoneLeptonY: number;
    };
    expect(tAny.isMoving, 'team activated').toBe(true);
    expect(tAny.isReinforcable, 'non-reinforceable').toBe(false);
    expect(tAny.isReforming, 'C++ leaves IsReforming true after tick-4 regroup assigned NavCom').toBe(true);
    expect(tAny.currentMission, 'main mission has not advanced while reforming').toBe(-1);
    expect(tAny.missionTarget, 'mission target not set until reforming clears').toBeNull();
    expect(tAny.zoneLeptonX).toBe(99 * 256 + 0x88);
    expect(tAny.zoneLeptonY).toBe(48 * 256 + 0x88);
  });

  it('queues MOVE only on the two far subs during Coordinate_Regroup', () => {
    const { team, subs } = setupSubzLike();
    const wps = new Map([[14, { cx: 68, cy: 46 }]]);
    updateAllTeams(wps, scg07NavalCtx(subs));

    expect(team.members.map(m => m.id)).toEqual([subs[2].id, subs[1].id, subs[0].id]);
    expect(subs[0].mission === Mission.MOVE || subs[0].missionQueue === Mission.MOVE).toBe(true);
    expect(subs[1].mission === Mission.MOVE || subs[1].missionQueue === Mission.MOVE).toBe(true);
    expect(subs[2].mission).toBe(Mission.GUARD);
    expect(subs[2].missionQueue).toBeNull();
    void team;
  });

  it('clears reforming on the next Team::AI once far subs already have NavCom', () => {
    const { team, subs } = setupSubzLike();
    const wps = new Map([[14, { cx: 68, cy: 46 }]]);
    updateAllTeams(wps, scg07NavalCtx(subs));
    expect((team as unknown as { isReforming: boolean }).isReforming).toBe(true);

    updateAllTeams(wps, scg07NavalCtx(subs));

    const tAny = team as unknown as { isReforming: boolean; currentMission: number };
    expect(tAny.isReforming).toBe(false);
    expect(tAny.currentMission).toBe(-1);
  });

  it('does not use the old team-level niat Mark_Track proxy', () => {
    // C++ VesselClass::Start_Driver calls DriveClass::Mark_Track on the
    // per-vessel HeadToCoord. The TS port now lives in GameMap/updateMove,
    // so TeamClass activation must not delay the last vessel with a
    // nonInterruptAnimTicks shim.
    const { team, subs } = setupSubzLike();
    const wps = new Map([[14, { cx: 68, cy: 46 }]]);
    updateAllTeams(wps, scg07NavalCtx(subs));

    expect(subs[0].nonInterruptAnimTicks).toBe(0);
    expect(subs[1].nonInterruptAnimTicks).toBe(0);
    expect(subs[2].nonInterruptAnimTicks).toBe(0);
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
    updateAllTeams(wps, scg07NavalCtx(ss));

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
