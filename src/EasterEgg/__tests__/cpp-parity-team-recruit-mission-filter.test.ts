/**
 * C++ Behavioral Parity: Team.recruit filters members by Is_Recruitable_Mission.
 *
 * C++ team.cpp:986 (Can_Add):
 *   if (obj->Mission != MISSION_NONE && !MissionClass::Is_Recruitable_Mission(obj->Mission)) {
 *       return(false);
 *   }
 *
 * C++ mission.cpp:522-528 (Is_Recruitable_Mission):
 *   return MissionControl[mission].IsRecruitable;
 *
 * Per rules.ini, these missions have Recruitable=no:
 *   Sleep, Harmless, Sticky, Retreat, Enter, Capture, Harvest, Area Guard,
 *   Hunt, Unload, Sabotage, Construction, Selling.
 *
 * SCG06EA bug: TS was recruiting from AREA_GUARD units (rules.ini Recruitable=no),
 * filling teams to full strength in 1 tick. Many SCG06EA USSR units start in
 * AREA_GUARD (e.g., INI lines 4,6,8-13), so TS over-recruited.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { House, Mission, MISSION_CONTROL, UnitType, CELL_SIZE } from '../engine/types';
import {
  Team, resetTeamIds, clearAllTeams, registerTeam,
} from '../engine/team';

beforeEach(() => {
  resetEntityIds();
  resetTeamIds();
  clearAllTeams();
});

function makeUnit(type: UnitType, house: House, x: number, y: number, mission: Mission = Mission.GUARD): Entity {
  const e = new Entity(type, house, x, y);
  e.mission = mission;
  return e;
}

function makeTeam(house: House, desired: Array<{ type: string; count: number }>): Team {
  const t = new Team({
    house,
    desiredMembers: desired,
    missionList: [],
    origin: { x: 0, y: 0 },
  });
  registerTeam(t);
  return t;
}

describe('Team.recruit mission filter (C++ Is_Recruitable_Mission)', () => {
  it('recruits units in GUARD mission', () => {
    const u = makeUnit(UnitType.V_3TNK, House.USSR, 100, 100, Mission.GUARD);
    const team = makeTeam(House.USSR, [{ type: UnitType.V_3TNK, count: 1 }]);
    team.recruit([u], { x: 0, y: 0 });
    expect(team.members).toContain(u);
  });

  it('does NOT recruit units in AREA_GUARD mission (rules.ini Recruitable=no)', () => {
    const u = makeUnit(UnitType.V_3TNK, House.USSR, 100, 100, Mission.AREA_GUARD);
    const team = makeTeam(House.USSR, [{ type: UnitType.V_3TNK, count: 1 }]);
    team.recruit([u], { x: 0, y: 0 });
    expect(team.members).not.toContain(u);
  });

  it('does NOT recruit units in HARVEST mission (Recruitable=no)', () => {
    const u = makeUnit(UnitType.V_HARV, House.USSR, 100, 100, Mission.HARVEST);
    const team = makeTeam(House.USSR, [{ type: UnitType.V_HARV, count: 1 }]);
    team.recruit([u], { x: 0, y: 0 });
    expect(team.members).not.toContain(u);
  });

  it('does NOT recruit units in HUNT mission (Recruitable=no)', () => {
    const u = makeUnit(UnitType.V_3TNK, House.USSR, 100, 100, Mission.HUNT);
    const team = makeTeam(House.USSR, [{ type: UnitType.V_3TNK, count: 1 }]);
    team.recruit([u], { x: 0, y: 0 });
    expect(team.members).not.toContain(u);
  });

  it('does NOT recruit units in SLEEP mission', () => {
    const u = makeUnit(UnitType.V_3TNK, House.USSR, 100, 100, Mission.SLEEP);
    const team = makeTeam(House.USSR, [{ type: UnitType.V_3TNK, count: 1 }]);
    team.recruit([u], { x: 0, y: 0 });
    expect(team.members).not.toContain(u);
  });

  it('DOES recruit units in ATTACK, MOVE, STOP, RETURN (default Recruitable=true)', () => {
    for (const mission of [Mission.ATTACK, Mission.MOVE, Mission.STOP, Mission.RETURN]) {
      resetEntityIds(); resetTeamIds(); clearAllTeams();
      const u = makeUnit(UnitType.V_3TNK, House.USSR, 100, 100, mission);
      const team = makeTeam(House.USSR, [{ type: UnitType.V_3TNK, count: 1 }]);
      team.recruit([u], { x: 0, y: 0 });
      expect(team.members, `mission ${mission} should be recruitable`).toContain(u);
    }
  });

  it('MISSION_CONTROL data matches rules.ini (sanity check)', () => {
    expect(MISSION_CONTROL[Mission.GUARD].isRecruitable).toBe(true);
    expect(MISSION_CONTROL[Mission.AREA_GUARD].isRecruitable).toBe(false);
    expect(MISSION_CONTROL[Mission.HARVEST].isRecruitable).toBe(false);
    expect(MISSION_CONTROL[Mission.HUNT].isRecruitable).toBe(false);
    expect(MISSION_CONTROL[Mission.ATTACK].isRecruitable).toBe(true);
    expect(MISSION_CONTROL[Mission.MOVE].isRecruitable).toBe(true);
    expect(MISSION_CONTROL[Mission.SLEEP].isRecruitable).toBe(false);
    expect(MISSION_CONTROL[Mission.STICKY].isRecruitable).toBe(false);
  });

  it('SCG06EA scenario: AREA_GUARD USSR tanks are NOT recruited', () => {
    // From SCG06EA.ini UNITS: lines 4,6,8-13 are USSR tanks in AREA_GUARD.
    const areaGuardUnits = [
      makeUnit(UnitType.V_4TNK, House.USSR, 100, 100, Mission.AREA_GUARD),
      makeUnit(UnitType.V_3TNK, House.USSR, 200, 100, Mission.AREA_GUARD),
      makeUnit(UnitType.V_3TNK, House.USSR, 300, 100, Mission.AREA_GUARD),
    ];
    const guardUnit = makeUnit(UnitType.V_3TNK, House.USSR, 400, 100, Mission.GUARD);
    const team = makeTeam(House.USSR, [{ type: UnitType.V_3TNK, count: 5 }]);
    team.recruit([...areaGuardUnits, guardUnit], { x: 0, y: 0 });

    // Only the GUARD unit should be recruited; AREA_GUARD units excluded.
    expect(team.members).toContain(guardUnit);
    for (const u of areaGuardUnits) {
      expect(team.members, `AREA_GUARD unit should NOT be recruited`).not.toContain(u);
    }
  });
});
