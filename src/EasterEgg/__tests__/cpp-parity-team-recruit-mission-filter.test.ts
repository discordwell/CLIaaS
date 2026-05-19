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
import { MoveResult } from '../engine/map';
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

function makeUnitAtLeptons(type: UnitType, house: House, lx: number, ly: number): Entity {
  const e = makeUnit(type, house, 0, 0);
  e.leptonX = lx;
  e.leptonY = ly;
  e.syncPosFromLeptons();
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

  // C++ team.cpp:1180-1291 bug-for-bug behavior: Can_Add(obj, typeindex) takes typeindex
  // by reference and sets it to whatever class matches obj. So Recruit(typeindex=0) for E1
  // can end up adding a DOG if the DOG is closer and the team has a DOG slot with room.
  // The typeindex parameter is a hint, not a strict class filter.
  describe('C++ Can_Add typeindex side-effect (SCG06EA dog1 bug)', () => {
    it('Recruit picks CLOSEST valid unit from ANY matching class slot', () => {
      // Team wants E1:1 + DOG:1. Center at (0,0).
      // DOG is much closer than E1. C++ Recruit(typeindex=E1) picks the closer DOG.
      const closeDog = makeUnit(UnitType.I_DOG, House.USSR, 50, 50, Mission.GUARD);
      const farE1 = makeUnit(UnitType.I_E1, House.USSR, 500, 500, Mission.GUARD);
      const team = makeTeam(House.USSR, [
        { type: UnitType.I_E1, count: 1 },
        { type: UnitType.I_DOG, count: 1 },
      ]);
      team.recruit([closeDog, farE1], { x: 0, y: 0 });

      // C++ Recruit(0=E1-slot): iterates infantry. DOG is closer → wins.
      // Can_Add(dog, typeindex=0) modifies typeindex to 1 (DOG match), approves.
      // Add(dog): fills DOG slot (Quantity[1]=1).
      // Caller's next iteration (typeindex=1): Quantity[1]=1, skip Recruit.
      // Result: team has ONLY the DOG. E1 is NOT recruited.
      expect(team.members).toContain(closeDog);
      expect(team.members).not.toContain(farE1);
      expect(team.members.length).toBe(1);
    });

    it('SCG06EA dog1 scenario: DOG wins over E1 when DOG is closer to origin', () => {
      // Mimic SCG06EA dog1 team at waypoint 4 (cell 72,84).
      // DOG at (72,84) distance 0. E1 at (71,84) distance 24 pixels.
      // DOG wins first-closest. After Add(DOG), DOG slot full.
      // Caller loop skips DOG typeindex. E1 typeindex still under-full BUT caller already
      // called Recruit for that typeindex and it picked the DOG — no second pass.
      // Wait — actually C++ caller iterates once per typeindex. Recruit(0) adds DOG
      // (to typeindex 1 via Can_Add side effect). So Quantity[0]=0, Quantity[1]=1.
      // Then caller iterates typeindex=1: Quantity[1]=1, skip.
      // Team ends: 1 DOG, 0 E1. Matches WASM SCG06EA dog1 behavior.
      const dog = makeUnit(UnitType.I_DOG, House.USSR, 72 * 24, 84 * 24, Mission.GUARD);
      const e1 = makeUnit(UnitType.I_E1, House.USSR, 71 * 24, 84 * 24, Mission.GUARD);
      const team = makeTeam(House.USSR, [
        { type: UnitType.I_E1, count: 1 },
        { type: UnitType.I_DOG, count: 1 },
      ]);
      team.recruit([dog, e1], { x: 72 * 24, y: 84 * 24 });

      // DOG is at distance 0, E1 at distance 24. DOG wins.
      expect(team.members).toContain(dog);
      expect(team.members).not.toContain(e1);
    });

    it('Recruit picks E1 when E1 is closer than DOG to center', () => {
      // Mimic SCG06EA dog2 team at waypoint 18 (cell 76,103).
      // E1 closer than DOG. E1 wins first-closest in Recruit(0).
      // Then Recruit(1) for DOG runs, finds DOG, adds. Both recruited.
      const closeE1 = makeUnit(UnitType.I_E1, House.USSR, 50, 0, Mission.GUARD);
      const farDog = makeUnit(UnitType.I_DOG, House.USSR, 200, 0, Mission.GUARD);
      const team = makeTeam(House.USSR, [
        { type: UnitType.I_E1, count: 1 },
        { type: UnitType.I_DOG, count: 1 },
      ]);
      team.recruit([closeE1, farDog], { x: 0, y: 0 });
      expect(team.members).toContain(closeE1);
      expect(team.members).toContain(farDog);
      expect(team.members.length).toBe(2);
    });

    it('initial Add during recruitment runs Calc_Center with Can_Enter_Cell fallback', () => {
      // SCU05EA `check` team: the first recruit is E3 at cell(40,43). C++
      // TeamClass::Add immediately calls Calc_Center, and because the averaged
      // cell is enterable, the inverted `!Can_Enter_Cell` check stores the
      // member's CELL target (40*256+0x88, 43*256+0x88), not the raw coordinate
      // target (lepton+0x08). That center changes the next nearest recruit.
      const e3_41_45 = makeUnitAtLeptons(UnitType.I_E3, House.Greece, 10688, 11712);
      const e3_41_44 = makeUnitAtLeptons(UnitType.I_E3, House.Greece, 10560, 11328);
      const e3_40_45 = makeUnitAtLeptons(UnitType.I_E3, House.Greece, 10432, 11712);
      const e3_40_43 = makeUnitAtLeptons(UnitType.I_E3, House.Greece, 10304, 11072);
      const e1_39_45 = makeUnitAtLeptons(UnitType.I_E1, House.Greece, 10112, 11648);
      const e1_39_44 = makeUnitAtLeptons(UnitType.I_E1, House.Greece, 10048, 11328);
      const candidates = [e3_41_45, e3_41_44, e3_40_45, e3_40_43, e1_39_45, e1_39_44];
      const team = new Team({
        house: House.Greece,
        desiredMembers: [
          { type: UnitType.I_E1, count: 2 },
          { type: UnitType.I_E3, count: 4 },
        ],
        missionList: [],
        origin: null,
      });
      const ctx = { canEnterCellResult: () => MoveResult.OK };

      team.recruit(candidates, undefined, ctx);
      expect(team.members).toContain(e3_40_43);
      expect(team.members).toContain(e3_41_44);
      expect(team.zoneLeptonX).toBe(10376);
      expect(team.zoneLeptonY).toBe(11144);

      team.recruit(candidates, undefined, ctx);
      expect(team.members).toContain(e1_39_44);
      expect(team.members).toContain(e3_40_45);
      expect(team.members).not.toContain(e1_39_45);
      expect(team.members.length).toBe(4);
    });
  });
});
