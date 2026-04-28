/**
 * C++ Behavioral Parity: Coordinate_Move queues MISSION_MOVE for ALL types
 *
 * C++ team.cpp:1938 Coordinate_Move calls Assign_Mission(MISSION_MOVE) on
 * both infantry and vehicles. Assign_Mission QUEUES the mission via
 * MissionQueue (mission.cpp:379-390) — it does NOT directly change Mission.
 * The actual promotion Mission <- MissionQueue happens later via Commence()
 * (mission.cpp:343-359), which is gated per entity class:
 *   - InfantryClass::AI (infantry.cpp:1208-1211): gesture/firing checks.
 *   - UnitClass::AI (unit.cpp:404,472): `!IsDriving && Is_Door_Closed()`.
 *
 * This matters for reinforcement teams: the MCV spawns with MISSION_GUARD
 * (reinf.cpp:480). Coordinate_Move queues MOVE and sets NavCom. Prior TS
 * behavior direct-set `unit.mission = Mission.MOVE; missionTimer = 0` for
 * vehicles, causing Mission_Move to fire at tick 1 instead of later (burning
 * Random_Pick jitter that WASM consumes on a different tick). SCG11EA MCV
 * reinforcement: drift accumulated from tick 15 onward.
 *
 * This test verifies that coordinateMove QUEUES for vehicles (not direct-sets).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Mission, House, UnitType } from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  Team, resetTeamIds, clearAllTeams,
  TMISSION_MOVE,
} from '../engine/team';
import type { GameMap } from '../engine/map';

beforeEach(() => {
  resetEntityIds();
  resetTeamIds();
  clearAllTeams();
});

function makeVehicle(type: UnitType, house: House, cx: number, cy: number): Entity {
  const e = new Entity(type, house, cx * 24 + 12, cy * 24 + 12);
  e.mission = Mission.GUARD;
  e.missionTimer = 0;
  return e;
}

describe('C++ Coordinate_Move parity: vehicle mission queueing', () => {
  it('coordinateMove QUEUES MOVE on vehicle (does not direct-set mission)', () => {
    const mcv = makeVehicle(UnitType.V_MCV, House.Greece, 22, 104);
    const team = new Team({
      house: House.Greece,
      desiredMembers: [{ type: UnitType.V_MCV, count: 1 }],
      missionList: [{ mission: TMISSION_MOVE, data: 26 }],
      forcedActive: true,
    });
    team.add(mcv);

    const waypoints = new Map<number, { cx: number; cy: number }>([
      [26, { cx: 22, cy: 100 }],
    ]);

    // Run team.ai() once — activates + dispatches TMISSION_MOVE → coordinateMove
    const passableMap = {
      isTerrainPassable: (_cx: number, _cy: number) => true,
      isWaterPassable: (_cx: number, _cy: number) => true,
    } as unknown as GameMap;

    team.ai(waypoints, { structures: [], entities: [mcv], map: passableMap });

    // C++ Assign_Mission behavior: MissionQueue set, Mission unchanged.
    // Prior (broken) TS: mission=MOVE, missionTimer=0 directly.
    // Fixed TS: missionQueue=MOVE, mission unchanged (GUARD).
    expect(mcv.mission, 'mission should remain GUARD until Commence() pops').toBe(Mission.GUARD);
    expect(mcv.missionQueue, 'missionQueue should hold MOVE for Commence() pop').toBe(Mission.MOVE);
    expect(mcv.moveTarget, 'moveTarget (NavCom) should be set by coordinateMove').not.toBeNull();
    expect(mcv.isDriving, 'DriveClass::Assign_Destination should start the driver immediately').toBe(true);
    expect(mcv.path.length, 'DriveClass::Start_Of_Move should populate Basic_Path').toBeGreaterThan(0);
  });

  it('infantry coordinateMove also queues (gesture gate, not driving gate)', () => {
    const e1 = new Entity(UnitType.I_E1, House.Greece, 22 * 24 + 12, 104 * 24 + 12);
    e1.mission = Mission.GUARD;
    e1.missionTimer = 0;

    const team = new Team({
      house: House.Greece,
      desiredMembers: [{ type: UnitType.I_E1, count: 1 }],
      missionList: [{ mission: TMISSION_MOVE, data: 26 }],
      forcedActive: true,
    });
    team.add(e1);

    const waypoints = new Map<number, { cx: number; cy: number }>([
      [26, { cx: 22, cy: 100 }],
    ]);
    team.ai(waypoints, { structures: [], entities: [e1] });

    // Infantry also queues. The Commence gate uses nonInterruptAnimTicks
    // (8-tick DO_GESTURE1/2 animation) rather than IsDriving.
    expect(e1.mission, 'infantry mission stays GUARD until Commence').toBe(Mission.GUARD);
    expect(e1.missionQueue, 'infantry missionQueue holds MOVE').toBe(Mission.MOVE);
    expect(e1.moveTarget, 'infantry moveTarget set').not.toBeNull();
  });
});
