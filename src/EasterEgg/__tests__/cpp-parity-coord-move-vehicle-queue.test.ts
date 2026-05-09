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
import { CELL_SIZE, LEPTON_SIZE, Mission, House, UnitType } from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  Team, resetTeamIds, clearAllTeams,
  TMISSION_MOVE, TMISSION_PATROL,
} from '../engine/team';
import { GameMap } from '../engine/map';
import { findPath } from '../engine/pathfinding';

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
    const passableMap = new GameMap();
    passableMap.setBounds(0, 0, 128, 128);

    let driveStarted = false;
    team.ai(waypoints, {
      structures: [],
      entities: [mcv],
      map: passableMap,
      startDriveClassMove: unit => {
        driveStarted = true;
        const goal = {
          cx: Math.floor(unit.moveTarget!.lx / LEPTON_SIZE),
          cy: Math.floor(unit.moveTarget!.ly / LEPTON_SIZE),
        };
        unit.path = findPath(passableMap, unit.cell, goal, false, unit.isNavalUnit, unit.stats.speedClass);
        unit.pathIndex = 0;
        unit.isDriving = unit.path.length > 0;
      },
    });

    // C++ Assign_Mission behavior: MissionQueue set, Mission unchanged.
    // Prior (broken) TS: mission=MOVE, missionTimer=0 directly.
    // Fixed TS: missionQueue=MOVE, mission unchanged (GUARD).
    expect(mcv.mission, 'mission should remain GUARD until Commence() pops').toBe(Mission.GUARD);
    expect(mcv.missionQueue, 'missionQueue should hold MOVE for Commence() pop').toBe(Mission.MOVE);
    expect(mcv.moveTarget, 'moveTarget (NavCom) should be set by coordinateMove').not.toBeNull();
    expect(driveStarted, 'DriveClass::Assign_Destination should call Start_Of_Move').toBe(true);
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

  it('infantry Assign_Destination stops active driver and invalidates Path[]', () => {
    const e1 = new Entity(UnitType.I_E1, House.BadGuy, 19 * CELL_SIZE + 12, 68 * CELL_SIZE + 12);
    e1.mission = Mission.MOVE;
    e1.isDriving = true;
    e1.headToLX = 4800;
    e1.headToLY = 17344;
    e1.path = [
      { cx: 19, cy: 68 },
      { cx: 18, cy: 67 },
      { cx: 17, cy: 66 },
    ];
    e1.pathIndex = 1;
    e1.doing = 'walk';

    const team = new Team({
      house: House.BadGuy,
      desiredMembers: [{ type: UnitType.I_E1, count: 1 }],
      missionList: [{ mission: TMISSION_MOVE, data: 26 }],
      forcedActive: true,
    });
    team.add(e1);
    team.target = { x: 30 * CELL_SIZE + 12, y: 68 * CELL_SIZE + 12 };

    team.coordinateMove(undefined, { structures: [], entities: [e1] });

    expect(e1.moveTarget, 'NavCom should be updated to the new team target').not.toBeNull();
    expect(e1.isDriving, 'InfantryClass::Assign_Destination calls Stop_Driver while already driving').toBe(false);
    expect(e1.headToLX).toBe(0);
    expect(e1.headToLY).toBe(0);
    expect(e1.doing).toBe('stand_ready');
    expect(e1.path, 'InfantryClass::Assign_Destination sets Path[0]=FACING_NONE').toEqual([]);
    expect(e1.pathIndex, 'TS absolute-cell path progress resets with Path[0]').toBe(0);
  });

  it('coordinateMove does not reinterpret TeamClass::Distance(NavCom) as unit close-enough', () => {
    const mcv = makeVehicle(UnitType.V_MCV, House.Greece, 22, 101);
    mcv.mission = Mission.MOVE;
    mcv.isDriving = true;
    mcv.moveTarget = { lx: mcv.leptonX, ly: mcv.leptonY - 128 };
    mcv.path = [{ cx: 22, cy: 100 }];
    mcv.pathIndex = 0;

    const team = new Team({
      house: House.Greece,
      desiredMembers: [{ type: UnitType.V_MCV, count: 1 }],
      missionList: [{ mission: TMISSION_MOVE, data: 26 }],
      forcedActive: true,
    });
    team.add(mcv);
    team.isMoving = true;
    team.isNextMission = false;
    team.target = {
      x: mcv.moveTarget.lx * CELL_SIZE / 256,
      y: mcv.moveTarget.ly * CELL_SIZE / 256,
    };
    team.missionTarget = { ...team.target };

    team.coordinateMove(undefined, { structures: [], entities: [mcv] });

    // C++ source text says `Distance(unit->NavCom) < CELL_LEPTON_W`, but the
    // unqualified call is TeamClass::Distance(), not unit->Distance(). The
    // team's inherited Coord is the AbstractClass constructor sentinel, so this
    // branch does not clear a legal NavCom just because the unit is close.
    expect(mcv.mission).toBe(Mission.MOVE);
    expect(mcv.missionQueue).toBeNull();
    expect(mcv.moveTarget).not.toBeNull();
    expect(mcv.path).toEqual([{ cx: 22, cy: 100 }]);
    expect(team.isNextMission).toBe(false);
  });

  it('coordinatePatrol preserves legal NavCom near the patrol target for the same C++ quirk', () => {
    const mcv = makeVehicle(UnitType.V_MCV, House.Greece, 22, 101);
    mcv.mission = Mission.MOVE;
    mcv.isDriving = true;
    mcv.moveTarget = { lx: mcv.leptonX, ly: mcv.leptonY - 128 };
    mcv.path = [{ cx: 22, cy: 100 }];
    mcv.pathIndex = 0;

    const team = new Team({
      house: House.Greece,
      desiredMembers: [{ type: UnitType.V_MCV, count: 1 }],
      missionList: [{ mission: TMISSION_PATROL, data: 26 }],
      forcedActive: true,
    });
    team.add(mcv);
    team.isMoving = true;
    team.isNextMission = false;
    team.currentMission = 0;
    team.target = {
      x: mcv.moveTarget.lx * CELL_SIZE / 256,
      y: mcv.moveTarget.ly * CELL_SIZE / 256,
    };
    team.missionTarget = { ...team.target };

    team.coordinatePatrol(undefined, { structures: [], entities: [mcv], tick: 2 });

    expect(mcv.mission).toBe(Mission.MOVE);
    expect(mcv.missionQueue).toBeNull();
    expect(mcv.moveTarget).not.toBeNull();
    expect(mcv.path).toEqual([{ cx: 22, cy: 100 }]);
    expect(team.isNextMission).toBe(false);
  });
});
