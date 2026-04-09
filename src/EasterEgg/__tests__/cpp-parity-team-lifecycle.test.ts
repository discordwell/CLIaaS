/**
 * C++ Behavioral Parity: Team Lifecycle — Issue #19
 *
 * Tests verify that the Team class matches C++ TeamClass behavior from team.cpp.
 *
 * Source references:
 *   - team.h          — TeamClass declaration, flags (IsUnderStrength, IsFullStrength, etc.)
 *   - team.cpp:470    — AI() main loop: composition check, mission advance, coordination
 *   - team.cpp:516-517 — Regrouping threshold: IsUnderStrength = (Total <= desired / 3)
 *   - team.cpp:891-936 — Add(): member insertion, first-member initiated
 *   - team.cpp:995     — Can_Add(): recruit priority steal from lower-priority teams
 *   - team.cpp:1053-1158 — Remove(): member removal, enter idle mode
 *   - team.cpp:1636-1721 — Coordinate_Attack(): all members attack target
 *   - team.cpp:1740-1789 — Coordinate_Regroup(): gather at zone center
 *   - team.cpp:1874-2008 — Coordinate_Move(): move together, advance when all arrive
 *   - team.cpp:679-697  — Dissolve when empty + HasBeen
 *   - teamtype.cpp:65-82 — 16 TMISSION_* types
 *
 * Observable outcomes: member tracking, mission queue processing, regroup at 1/3,
 * coordinated movement/attack/guard, death reduces strength, dissolve when empty.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { House, Mission, UnitType, CELL_SIZE } from '../engine/types';
import {
  Team, resetTeamIds,
  TMISSION_MOVE, TMISSION_ATTACK, TMISSION_ATT_WAYPT, TMISSION_GUARD,
  TMISSION_UNLOAD, TMISSION_DEPLOY, TMISSION_PATROL, TMISSION_LOOP, TMISSION_DO,
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

describe('C++ parity: Team lifecycle (team.cpp)', () => {
  describe('Member tracking (team.cpp:891-936 Add, 1053-1158 Remove)', () => {
    it('tracks members added to the team', () => {
      const team = makeTeam({});
      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 120, 100);

      team.add(e1);
      team.add(e2);

      expect(team.total).toBe(2);
      expect(team.members).toContain(e1);
      expect(team.members).toContain(e2);
    });

    it('sets entity.teamRef back-pointer on add (C++ obj->Team = this, team.cpp:915)', () => {
      const team = makeTeam({});
      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);

      team.add(e1);

      expect(e1.teamRef).toBe(team);
    });

    it('removes from old team before adding to new (C++ team.cpp:904-906)', () => {
      const team1 = makeTeam({ recruitPriority: 5 });
      const team2 = makeTeam({ recruitPriority: 10 });
      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);

      team1.add(e1);
      expect(team1.total).toBe(1);
      expect(e1.teamRef).toBe(team1);

      team2.add(e1);
      expect(team1.total).toBe(0);
      expect(team2.total).toBe(1);
      expect(e1.teamRef).toBe(team2);
    });

    it('remove clears entity.teamRef (C++ curr->Team = 0, team.cpp:1116)', () => {
      const team = makeTeam({});
      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);

      team.add(e1);
      team.remove(e1);

      expect(e1.teamRef).toBeNull();
      expect(team.total).toBe(0);
    });

    it('does not add dead entities', () => {
      const team = makeTeam({});
      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      e1.alive = false;

      expect(team.add(e1)).toBe(false);
      expect(team.total).toBe(0);
    });

    it('does not add duplicate entities', () => {
      const team = makeTeam({});
      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);

      team.add(e1);
      expect(team.add(e1)).toBe(false);
      expect(team.total).toBe(1);
    });
  });

  describe('Strength calculation (team.cpp:495-572)', () => {
    it('team starts under-strength (C++ IsUnderStrength = true, team.cpp:338)', () => {
      const team = makeTeam({ memberDefs: [{ type: UnitType.V_3TNK, count: 6 }] });
      expect(team.isUnderStrength).toBe(true);
      expect(team.isFullStrength).toBe(false);
    });

    it('reaches full strength when all desired members present (team.cpp:506)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 3 }],
        missions: [{ mission: TMISSION_GUARD, data: 10 }],
      });
      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 120, 100);
      const e3 = makeEntity(UnitType.V_3TNK, House.USSR, 140, 100);

      team.add(e1);
      team.add(e2);
      team.add(e3);
      team.ai(); // trigger composition check

      expect(team.isFullStrength).toBe(true);
      expect(team.isHasBeen).toBe(true);
    });

    it('becomes under-strength when at or below 1/3 desired (team.cpp:516-517)', () => {
      // Desired = 6, so 1/3 = 2. At 2 members → under strength
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
        missions: [{ mission: TMISSION_GUARD, data: 10 }],
        forcedActive: true,
      });

      // Add 6 to reach full strength
      const entities: Entity[] = [];
      for (let i = 0; i < 6; i++) {
        const e = makeEntity(UnitType.V_3TNK, House.USSR, 100 + i * 20, 100);
        entities.push(e);
        team.add(e);
      }
      team.ai(); // full strength → isMoving = true
      expect(team.isFullStrength).toBe(true);
      expect(team.isMoving).toBe(true);

      // Kill 4, leaving 2 (which is <= 6/3 = 2)
      entities[0].alive = false;
      entities[1].alive = false;
      entities[2].alive = false;
      entities[3].alive = false;
      team.isAltered = true;
      team.ai();

      expect(team.isUnderStrength).toBe(true);
    });

    it('for desired <= 2, under-strength means less than desired (team.cpp:518-519)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
        missions: [{ mission: TMISSION_GUARD, data: 10 }],
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e1);
      team.ai();

      // 1 member, desired = 2 → under strength
      expect(team.isUnderStrength).toBe(true);
    });
  });

  describe('Mission queue processing (team.cpp:704-753)', () => {
    it('processes missions sequentially from the queue', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_MOVE, data: 0 },
          { mission: TMISSION_ATTACK, data: 0 },
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, { cx: 5, cy: 5 });

      // C++ Force_Active() sets IsUnderStrength=false, so no reforming delay.
      // First AI tick: activate + advance to mission 0 (team.cpp:704-753).
      team.ai(waypoints);

      expect(team.currentMission).toBe(0);
      expect(team.missionList[team.currentMission].mission).toBe(TMISSION_MOVE);
    });

    it('advances to next mission when current completes', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_MOVE, data: 0 },
          { mission: TMISSION_GUARD, data: 1 },
        ],
        forcedActive: true,
      });

      const wp = { cx: 5, cy: 5 };
      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, wp);

      // Place entity at waypoint so MOVE completes immediately
      const targetX = wp.cx * CELL_SIZE + CELL_SIZE / 2;
      const targetY = wp.cy * CELL_SIZE + CELL_SIZE / 2;
      const e = makeEntity(UnitType.V_3TNK, House.USSR, targetX, targetY);
      team.add(e);

      // C++ Force_Active() sets IsUnderStrength=false, so no reforming delay.
      // Tick 1: activate → advance to mission 0 (MOVE) → entity at target → isNextMission
      team.ai(waypoints);
      expect(team.currentMission).toBe(0);

      // Tick 2: MOVE completed → advance to mission 1 (GUARD)
      team.ai(waypoints);
      expect(team.currentMission).toBe(1);
    });

    it('dissolves when mission queue is exhausted (team.cpp:750)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_GUARD, data: 0 }, // 0-duration guard → immediate advance
        ],
        forcedActive: true,
      });

      const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e);

      // Run enough AI ticks to activate, regroup, start mission, timeout, and dissolve
      for (let i = 0; i < 10; i++) {
        if (team.dissolved) break;
        team.ai();
      }

      expect(team.dissolved).toBe(true);
    });
  });

  describe('Regroup when under strength (team.cpp:577-621)', () => {
    it('stops moving and regroups when under 1/3 strength', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
        missions: [
          { mission: TMISSION_MOVE, data: 0 },
          { mission: TMISSION_ATTACK, data: 0 },
        ],
        forcedActive: true,
      });

      const entities: Entity[] = [];
      for (let i = 0; i < 6; i++) {
        const e = makeEntity(UnitType.V_3TNK, House.USSR, 100 + i * 2, 100);
        entities.push(e);
        team.add(e);
      }

      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, { cx: 50, cy: 50 });

      // Activate
      team.ai(waypoints);
      expect(team.isMoving).toBe(true);

      // Kill 4 of 6 → 2 remaining, under 1/3 strength
      entities[0].alive = false;
      entities[1].alive = false;
      entities[2].alive = false;
      entities[3].alive = false;
      team.isAltered = true;
      team.ai(waypoints);

      // C++ team.cpp:577-578 — IsMoving = false, CurrentMission = -1
      expect(team.isMoving).toBe(false);
      expect(team.currentMission).toBe(-1);
    });

    it('suicide+reinforceable team DOES regroup (C++ team.cpp:577 has NO IsSuicide check)', () => {
      /**
       * C++ team.cpp:577:
       *   if (IsMoving && IsUnderStrength) {  // no IsSuicide check
       *
       * A suicide+reinforceable team (default isReinforcable=true) that becomes
       * under-strength will regroup just like any other team. C++ does not
       * exempt suicide teams from the retreat block.
       *
       * Note: suicide teams are *typically* non-reinforceable in practice,
       * which means IsUnderStrength = !IsHasBeen = false after activation,
       * so they never hit this code path. But with isReinforcable=true
       * (the default), the under-strength threshold applies normally.
       */
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
        missions: [
          { mission: TMISSION_MOVE, data: 0 },
        ],
        isSuicide: true,
        forcedActive: true,
      });

      const entities: Entity[] = [];
      for (let i = 0; i < 6; i++) {
        const e = makeEntity(UnitType.V_3TNK, House.USSR, 100 + i * 2, 100);
        entities.push(e);
        team.add(e);
      }

      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, { cx: 50, cy: 50 });

      team.ai(waypoints);
      expect(team.isMoving).toBe(true);

      // Kill 4 — under 1/3 threshold (2 <= 6/3=2)
      entities[0].alive = false;
      entities[1].alive = false;
      entities[2].alive = false;
      entities[3].alive = false;
      team.isAltered = true;
      team.ai(waypoints);

      // C++ has no IsSuicide guard — suicide+reinforceable team retreats
      expect(team.isMoving).toBe(false);
    });
  });

  describe('MOVE mission — coordinated movement (team.cpp:1874-2008)', () => {
    it('moves all members toward waypoint target', () => {
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
      waypoints.set(0, { cx: 20, cy: 20 });

      // C++ Force_Active() sets IsUnderStrength=false, so no reforming delay.
      // Tick 1: activate → advance to MOVE mission 0 → execute
      team.ai(waypoints);

      // Members should be ordered to move
      expect(e1.mission).toBe(Mission.MOVE);
      expect(e2.mission).toBe(Mission.MOVE);
      expect(e1.moveTarget).toBeTruthy();
      expect(e2.moveTarget).toBeTruthy();
    });

    it('advances mission when all members arrive at target', () => {
      const wp = { cx: 5, cy: 5 };
      const targetX = wp.cx * CELL_SIZE + CELL_SIZE / 2;
      const targetY = wp.cy * CELL_SIZE + CELL_SIZE / 2;

      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
        missions: [
          { mission: TMISSION_MOVE, data: 0 },
          { mission: TMISSION_GUARD, data: 10 },
        ],
        forcedActive: true,
      });

      // Place both members at the target
      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, targetX, targetY);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, targetX + 1, targetY);
      team.add(e1);
      team.add(e2);

      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, wp);

      // C++ Force_Active() sets IsUnderStrength=false, so no reforming delay.
      // Tick 1: activate → advance to MOVE mission 0 → entities at target → isNextMission
      team.ai(waypoints);
      expect(team.currentMission).toBe(0);

      // Tick 2: MOVE completed → advance to mission 1
      team.ai(waypoints);
      expect(team.currentMission).toBe(1);
    });
  });

  describe('ATTACK mission — coordinated attack (team.cpp:1636-1721)', () => {
    it('sends all members to attack waypoint (Mission.ATTACK)', () => {
      // Use ATT_WAYPT so the waypoint sets the mission target (C++ team.cpp:732-738)
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
        missions: [{ mission: TMISSION_ATT_WAYPT, data: 0 }],
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 120, 100);
      team.add(e1);
      team.add(e2);

      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, { cx: 30, cy: 30 });

      // C++ Force_Active() sets IsUnderStrength=false, so no reforming delay.
      // Tick 1: activate → advance to ATT_WAYPT mission 0 → execute
      team.ai(waypoints);

      expect(e1.mission).toBe(Mission.ATTACK);
      expect(e2.mission).toBe(Mission.ATTACK);
    });

    it('advances mission when no target is available (team.cpp:1675-1676)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_ATTACK, data: 0 },
          { mission: TMISSION_GUARD, data: 5 },
        ],
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e1);

      // Run until attack mission starts and advances (no target → advance)
      for (let i = 0; i < 5; i++) {
        team.ai();
      }

      // Should have advanced past ATTACK to GUARD
      expect(team.currentMission).toBe(1);
    });
  });

  describe('GUARD mission — hold position with timeout (team.cpp:815-858)', () => {
    it('holds position and times out', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_GUARD, data: 1 }, // 1 * 90 = 90 ticks timeout (C++ TICKS_PER_MINUTE/10)
          { mission: TMISSION_MOVE, data: 0 },
        ],
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e1);

      // Run enough ticks for: activate (1) + regroup (1) + start guard (1) + timeout (90) + advance
      for (let i = 0; i < 100; i++) {
        team.ai();
      }

      // Should have advanced past GUARD to MOVE
      expect(team.currentMission).toBeGreaterThan(0);
    });
  });

  describe('Member death reduces team strength', () => {
    it('dead members are removed from team on next AI tick', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 3 }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 120, 100);
      const e3 = makeEntity(UnitType.V_3TNK, House.USSR, 140, 100);
      team.add(e1);
      team.add(e2);
      team.add(e3);

      team.ai(); // activate
      expect(team.total).toBe(3);

      // Kill one
      e2.alive = false;
      team.isAltered = true;
      team.ai();

      expect(team.total).toBe(2);
      expect(team.members).not.toContain(e2);
    });
  });

  describe('Team dissolves when all members dead (team.cpp:679-697)', () => {
    it('dissolves when empty and isHasBeen is true', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 120, 100);
      team.add(e1);
      team.add(e2);

      // Activate (sets isHasBeen)
      team.ai();
      expect(team.isHasBeen).toBe(true);

      // Kill all
      e1.alive = false;
      e2.alive = false;
      team.isAltered = true;
      team.ai();

      expect(team.dissolved).toBe(true);
      expect(team.total).toBe(0);
    });

    it('does NOT dissolve empty team if never activated (team.cpp:544)', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 3 }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
      });

      // Add 1 of 3, then kill it
      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e1);
      team.ai(); // not full strength, not forced → isHasBeen stays false

      e1.alive = false;
      team.isAltered = true;
      team.ai();

      // Not dissolved because team never activated (isHasBeen = false)
      expect(team.isHasBeen).toBe(false);
      expect(team.dissolved).toBe(false);
    });

    it('clears teamRef on all members when dissolved', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e1);
      team.ai();

      e1.alive = false;
      team.isAltered = true;
      team.ai();

      expect(e1.teamRef).toBeNull();
    });
  });

  describe('LOOP mission (team.cpp:2869-2876)', () => {
    it('jumps back to specified mission index', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [
          { mission: TMISSION_GUARD, data: 0 },  // index 0 — immediate timeout
          { mission: TMISSION_LOOP, data: 0 },    // index 1 — loop back to 0
        ],
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e1);

      // Run enough ticks to: activate, regroup, start guard, timeout, loop, return to 0
      // C++ parity: LOOP sets currentMission = data-1 and isNextMission=true in the
      // same tick that it executes. So currentMission briefly = 1 during the AI call
      // but immediately gets set to -1 by LOOP. We track how many times mission 0 is
      // visited — with LOOP it should cycle back.
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
  });

  describe('PATROL mission — move + attack (team.cpp TMission_Patrol)', () => {
    it('moves members toward patrol waypoint', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
        missions: [{ mission: TMISSION_PATROL, data: 0 }],
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 120, 100);
      team.add(e1);
      team.add(e2);

      const waypoints = new Map<number, { cx: number; cy: number }>();
      waypoints.set(0, { cx: 30, cy: 30 });

      // C++ Force_Active() sets IsUnderStrength=false, so no reforming delay.
      // Tick 1: activate → advance to PATROL mission 0 → execute
      team.ai(waypoints);

      // Members should be moving toward the patrol waypoint
      expect(e1.mission).toBe(Mission.MOVE);
      expect(e2.mission).toBe(Mission.MOVE);
    });
  });

  describe('Team registry (global team tracking)', () => {
    it('registerTeam adds to active teams list', () => {
      const team = makeTeam({});
      registerTeam(team);

      expect(getActiveTeams()).toContain(team);
    });

    it('updateAllTeams processes all registered teams', () => {
      const team1 = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
        forcedActive: true,
      });
      const team2 = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 200, 200);
      team1.add(e1);
      team2.add(e2);

      registerTeam(team1);
      registerTeam(team2);

      updateAllTeams();

      // Both teams should have been activated
      expect(team1.isHasBeen).toBe(true);
      expect(team2.isHasBeen).toBe(true);
    });

    it('clearAllTeams removes all teams', () => {
      registerTeam(makeTeam({}));
      registerTeam(makeTeam({}));

      clearAllTeams();

      expect(getActiveTeams()).toHaveLength(0);
    });

    it('dissolved teams are cleaned up from registry', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [],
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e1);
      registerTeam(team);

      // Activate → no missions → dissolve
      team.ai();
      team.ai();

      // dissolved teams cleaned up by updateAllTeams
      updateAllTeams();

      expect(getActiveTeams()).not.toContain(team);
    });
  });

  describe('Recruit priority (team.cpp:995)', () => {
    it('higher priority team steals member from lower priority team', () => {
      const lowTeam = makeTeam({ recruitPriority: 3 });
      const highTeam = makeTeam({ recruitPriority: 10 });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);

      lowTeam.add(e1);
      expect(e1.teamRef).toBe(lowTeam);

      // Higher priority team takes the member
      highTeam.add(e1);
      expect(e1.teamRef).toBe(highTeam);
      expect(lowTeam.total).toBe(0);
      expect(highTeam.total).toBe(1);
    });
  });

  describe('Suspend/resume (team.cpp:484-489)', () => {
    it('suspended team does not process AI until timer expires', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      team.add(e1);

      team.suspended = true;
      team.suspendTimer = 3;

      team.ai(); // timer = 2
      expect(team.isHasBeen).toBe(false); // didn't process

      team.ai(); // timer = 1
      team.ai(); // timer = 0, suspended = false

      // Now it should process
      team.ai();
      expect(team.isHasBeen).toBe(true);
    });
  });

  describe('calcCenter (team.cpp:1390-1551)', () => {
    it('computes average position of alive members', () => {
      const team = makeTeam({});

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 200);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 200, 400);
      team.add(e1);
      team.add(e2);

      team.calcCenter();

      expect(team.zone).toBeTruthy();
      // Lepton quantization: positions truncate to lepton grid, so averages shift slightly
      expect(team.zone!.x).toBeCloseTo(150, 0);
      expect(team.zone!.y).toBeCloseTo(300, 0);
    });

    it('returns null zone when no alive members', () => {
      const team = makeTeam({});

      team.calcCenter();

      expect(team.zone).toBeNull();
    });
  });

  describe('DO mission (team.cpp:1809-1856 Coordinate_Do)', () => {
    it('assigns specified mission to all members and advances', () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
        missions: [
          { mission: TMISSION_DO, data: 14 }, // 14 = MISSION_HUNT in C++
          { mission: TMISSION_GUARD, data: 100 },
        ],
        forcedActive: true,
      });

      const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
      const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 120, 100);
      team.add(e1);
      team.add(e2);

      // C++ Force_Active() sets IsUnderStrength=false, so no spurious reforming.
      // First ai(): activate → advance to DO → execute DO (sets HUNT) in one tick.
      team.ai();

      expect(e1.mission).toBe(Mission.HUNT);
      expect(e2.mission).toBe(Mission.HUNT);
    });
  });
});
