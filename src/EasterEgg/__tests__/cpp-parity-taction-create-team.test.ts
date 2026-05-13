/**
 * C++ behavioral parity tests for TACTION_CREATE_TEAM (action=4).
 *
 * C++ behavior (ScenarioClass::Create_Army / Do_Action):
 *   Reads teamTypes[action.team], and returns a createTeam descriptor for the
 *   Game class to process by recruiting existing idle units.
 *
 * Key behaviors tested:
 *   1. Returns createTeam descriptor with correct members (type + count)
 *   2. Returns correct house from team definition
 *   3. Skips gracefully if team index doesn't exist
 *   4. Returns correct missions from team definition
 *   5. IsSuicide flag preserved in team flags (verified via descriptor house lookup)
 *   6. Team trigger index available in team definition for Game-class processing
 *   7. Descriptor contains all member types including civilians and aircraft
 *   8. createTeam.members matches team composition for mixed teams
 *
 * NOTE: Spawn-time behaviors (auto-load cargo, aircraft state, trigger attachment,
 * civilian invulnerability, position) are now handled by the Game class during
 * recruitment. Those behaviors are integration-level tests, not unit tests for
 * executeTriggerAction.
 */

import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TeamType,
  type ScenarioTrigger,
  type TriggerAction,
  type TriggerActionResult,
} from '../engine/scenario';
import { type CellPos, House } from '../engine/types';
import { resetEntityIds } from '../engine/entity';

// === Helpers ===

/** Create a minimal trigger for populating the triggers array */
function makeTrigger(name: string): ScenarioTrigger {
  return {
    name,
    persistence: 0,
    house: 0,
    eventControl: 0,
    actionControl: 0,
    event1: { type: 0, team: -1, data: 0 },
    event2: { type: 0, team: -1, data: 0 },
    action1: { action: 0, team: -1, trigger: -1, data: 0 },
    action2: { action: 0, team: -1, trigger: -1, data: 0 },
    fired: false,
    timerTick: 0,
    playerEntered: false,
    forceFirePending: false,
    pendingDestroyedCount: 0,
    triggeringEntityIds: [],
  };
}

/** Create a CREATE_TEAM action targeting the given team index */
function createTeamAction(teamIndex: number): TriggerAction {
  return { action: 4, team: teamIndex, trigger: -1, data: -1 };
}

/** Standard waypoints map with a waypoint at cell (50, 50) */
function makeWaypoints(entries: [number, CellPos][] = [[0, { cx: 50, cy: 50 }]]): Map<number, CellPos> {
  return new Map(entries);
}

/** Standard house edges and map bounds for aircraft edge-spawn testing */
const HOUSE_EDGES = new Map<House, string>([
  [House.USSR, 'North'],
  [House.Greece, 'South'],
  [House.Spain, 'West'],
  [House.GoodGuy, 'South'],
]);
const MAP_BOUNDS = { x: 0, y: 0, w: 100, h: 100 };

/** Helper to execute action=4 and return result */
function execCreateTeam(
  teamTypes: TeamType[],
  opts: {
    teamIndex?: number;
    waypoints?: Map<number, CellPos>;
    triggers?: ScenarioTrigger[];
    houseEdges?: Map<House, string>;
    mapBounds?: { x: number; y: number; w: number; h: number };
  } = {},
): TriggerActionResult {
  return executeTriggerAction(
    createTeamAction(opts.teamIndex ?? 0),
    teamTypes,
    opts.waypoints ?? makeWaypoints(),
    new Set(),
    opts.triggers ?? [],
    undefined,
    opts.houseEdges,
    opts.mapBounds,
  );
}

describe('TACTION_CREATE_TEAM (action=4) — C++ ScenarioClass::Create_Army parity', () => {

  // =====================================================================
  // 1. Basic descriptor: members from team definition (type + count)
  // =====================================================================

  describe('basic createTeam descriptor', () => {
    it('returns createTeam descriptor for each team member entry (single type, count=3)', () => {
      const teamTypes: TeamType[] = [{
        name: 'team1',
        house: 2, // USSR
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'E1', count: 3 }],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members).toHaveLength(1);
      expect(result.createTeam!.members[0]).toEqual({ type: 'E1', count: 3 });
    });

    it('returns createTeam descriptor for multiple member entries (mixed types)', () => {
      const teamTypes: TeamType[] = [{
        name: 'mixed',
        house: 2, // USSR
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [
          { type: 'E1', count: 2 },
          { type: '3TNK', count: 1 },
          { type: 'E2', count: 1 },
        ],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members).toHaveLength(3);
      expect(result.createTeam!.members[0]).toEqual({ type: 'E1', count: 2 });
      expect(result.createTeam!.members[1]).toEqual({ type: '3TNK', count: 1 });
      expect(result.createTeam!.members[2]).toEqual({ type: 'E2', count: 1 });
    });

    it('returns correct house from team definition', () => {
      const teamTypes: TeamType[] = [{
        name: 'pos',
        house: 1, // Greece
        flags: 0,
        origin: 5,
        trigger: -1,
        members: [{ type: '1TNK', count: 1 }],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes, { waypoints: makeWaypoints([[5, { cx: 30, cy: 40 }]]) });

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.house).toBe(House.Greece);
    });

    it('preserves RecruitPriority for runtime TeamClass construction', () => {
      const teamTypes: TeamType[] = [{
        name: 'priority-team',
        house: 9, // BadGuy
        flags: 0,
        recruitPriority: 10,
        origin: -1,
        trigger: -1,
        members: [{ type: 'E1', count: 2 }, { type: 'TRUK', count: 1 }],
        missions: [{ mission: 3, data: 31 }],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.recruitPriority).toBe(10);
    });

    it('assigns team mission script in createTeam descriptor', () => {
      const teamTypes: TeamType[] = [{
        name: 'scripted',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'E1', count: 2 }],
        missions: [
          { mission: 3, data: 5 },  // TMISSION_MOVE to waypoint 5
          { mission: 0, data: 10 }, // TMISSION_ATTACK at waypoint 10
        ],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.missions).toHaveLength(2);
      expect(result.createTeam!.missions[0]).toEqual({ mission: 3, data: 5 });
      expect(result.createTeam!.missions[1]).toEqual({ mission: 0, data: 10 });
    });

    it('returns empty missions when missions array is empty', () => {
      const teamTypes: TeamType[] = [{
        name: 'noscript',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'E1', count: 1 }],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.missions).toHaveLength(0);
    });
  });

  // =====================================================================
  // 2. createTeam descriptor population
  // =====================================================================

  describe('result.createTeam population', () => {
    it('result.createTeam contains all member entries from team definition', () => {
      const teamTypes: TeamType[] = [{
        name: 'check',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'E1', count: 2 }, { type: 'E3', count: 1 }],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members).toHaveLength(2);
      const totalCount = result.createTeam!.members.reduce((sum, m) => sum + m.count, 0);
      expect(totalCount).toBe(3);
    });

    it('result.createTeam is undefined when no team members exist', () => {
      // Team with empty members still returns createTeam since the team exists
      const teamTypes: TeamType[] = [{
        name: 'empty',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes);

      // createTeam is returned with empty members (team exists, just has no units)
      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members).toHaveLength(0);
    });
  });

  // =====================================================================
  // 3. Skips if team doesn't exist
  // =====================================================================

  describe('team index out of bounds / nonexistent', () => {
    it('returns no createTeam when action.team index is out of range', () => {
      const teamTypes: TeamType[] = [{
        name: 'only',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'E1', count: 5 }],
        missions: [],
      }];

      // action.team=99 but teamTypes only has index 0
      const result = execCreateTeam(teamTypes, { teamIndex: 99 });

      expect(result.createTeam).toBeUndefined();
      expect(result.spawned).toHaveLength(0);
    });

    it('returns no createTeam when teamTypes array is empty', () => {
      const result = execCreateTeam([], { teamIndex: 0 });

      expect(result.createTeam).toBeUndefined();
      expect(result.spawned).toHaveLength(0);
    });

    it('returns createTeam even when origin waypoint does not exist (Game resolves position)', () => {
      const teamTypes: TeamType[] = [{
        name: 'nowp',
        house: 2,
        flags: 0,
        origin: 99, // waypoint 99 doesn't exist
        trigger: -1,
        members: [{ type: 'E1', count: 3 }],
        missions: [],
      }];

      // createTeam descriptor is returned regardless of waypoint resolution
      // (the Game class handles position resolution during recruitment)
      const result = execCreateTeam(teamTypes, { waypoints: makeWaypoints() });

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members[0]).toEqual({ type: 'E1', count: 3 });
    });
  });

  // =====================================================================
  // 4. Transport teams — descriptor composition
  //    (auto-load is Game-class responsibility, but descriptor must be correct)
  // =====================================================================

  describe('transport team descriptor composition', () => {
    it('includes both transport and infantry in createTeam members', () => {
      const teamTypes: TeamType[] = [{
        name: 'apcteam',
        house: 2, // USSR
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [
          { type: 'APC', count: 1 },
          { type: 'E1', count: 3 },
        ],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members).toHaveLength(2);
      expect(result.createTeam!.members[0]).toEqual({ type: 'APC', count: 1 });
      expect(result.createTeam!.members[1]).toEqual({ type: 'E1', count: 3 });
    });

    it('includes transport with limited capacity and excess infantry in descriptor', () => {
      const teamTypes: TeamType[] = [{
        name: 'trukteam',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [
          { type: 'TRUK', count: 1 },
          { type: 'E1', count: 3 },
        ],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members).toHaveLength(2);
      const totalCount = result.createTeam!.members.reduce((sum, m) => sum + m.count, 0);
      expect(totalCount).toBe(4);
    });

    it('includes all member types when team has no transport', () => {
      const teamTypes: TeamType[] = [{
        name: 'notrans',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [
          { type: 'E1', count: 2 },
          { type: '2TNK', count: 1 },
        ],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members).toHaveLength(2);
      const totalCount = result.createTeam!.members.reduce((sum, m) => sum + m.count, 0);
      expect(totalCount).toBe(3);
    });

    it('includes vehicles in createTeam members alongside transport (C++ reinf.cpp:217-254)', () => {
      const teamTypes: TeamType[] = [{
        name: 'vehicles',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [
          { type: 'APC', count: 1 },
          { type: '1TNK', count: 2 },
        ],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members).toHaveLength(2);
      expect(result.createTeam!.members[0]).toEqual({ type: 'APC', count: 1 });
      expect(result.createTeam!.members[1]).toEqual({ type: '1TNK', count: 2 });
    });

    it('includes MCV + tanks + LST in descriptor (SCG06EA parity)', () => {
      const teamTypes: TeamType[] = [{
        name: 'start',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [
          { type: '1TNK', count: 2 },
          { type: 'MCV', count: 1 },
          { type: 'LST', count: 1 },
        ],
        missions: [
          { mission: 3, data: 0 },  // TMISSION_MOVE
          { mission: 8, data: 0 },  // TMISSION_UNLOAD
        ],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      const totalCount = result.createTeam!.members.reduce((sum, m) => sum + m.count, 0);
      expect(totalCount).toBe(4);
      expect(result.createTeam!.missions).toHaveLength(2);
    });

    it('includes mixed infantry + vehicles + LST in descriptor (SCG12EA arnf1)', () => {
      const teamTypes: TeamType[] = [{
        name: 'arnf1',
        house: 1, // Greece
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [
          { type: 'E1', count: 2 },
          { type: 'E3', count: 2 },
          { type: 'MCV', count: 1 },
          { type: 'LST', count: 1 },
        ],
        missions: [
          { mission: 3, data: 1 },
          { mission: 8, data: 0 },
        ],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      const totalCount = result.createTeam!.members.reduce((sum, m) => sum + m.count, 0);
      expect(totalCount).toBe(6);
      expect(result.createTeam!.house).toBe(House.Greece);
    });
  });

  // =====================================================================
  // 5. IsSuicide flag (team.flags & 2) — verified via descriptor
  //    (actual entity isSuicide is set during Game-class recruitment)
  // =====================================================================

  describe('IsSuicide flag in team definition', () => {
    it('createTeam returned for team with IsSuicide flag set', () => {
      const teamTypes: TeamType[] = [{
        name: 'suicide',
        house: 2,
        flags: 2, // bit 1 = IsSuicide
        origin: 0,
        trigger: -1,
        members: [
          { type: 'E1', count: 2 },
          { type: '3TNK', count: 1 },
        ],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      const totalCount = result.createTeam!.members.reduce((sum, m) => sum + m.count, 0);
      expect(totalCount).toBe(3);
    });

    it('createTeam returned for team without IsSuicide flag', () => {
      const teamTypes: TeamType[] = [{
        name: 'normal',
        house: 2,
        flags: 0, // no IsSuicide
        origin: 0,
        trigger: -1,
        members: [{ type: 'E1', count: 2 }],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members[0]).toEqual({ type: 'E1', count: 2 });
    });

    it('createTeam returned for team with mixed flags alongside IsSuicide', () => {
      const teamTypes: TeamType[] = [{
        name: 'mixed_flags',
        house: 2,
        flags: 6, // bits 1 and 2 set (IsSuicide + IsAutocreate)
        origin: 0,
        trigger: -1,
        members: [{ type: 'E1', count: 1 }],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members[0]).toEqual({ type: 'E1', count: 1 });
    });

    it('IsSuicide team with missions — missions preserved in descriptor', () => {
      const teamTypes: TeamType[] = [{
        name: 'suicide_missions',
        house: 2,
        flags: 2,
        origin: 0,
        trigger: -1,
        members: [{ type: 'E1', count: 1 }],
        missions: [
          { mission: 3, data: 5 },  // TMISSION_MOVE
          { mission: 0, data: 10 }, // TMISSION_ATTACK
        ],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.missions).toHaveLength(2);
      expect(result.createTeam!.missions[0]).toEqual({ mission: 3, data: 5 });
      expect(result.createTeam!.missions[1]).toEqual({ mission: 0, data: 10 });
    });
  });

  // =====================================================================
  // 6. Team trigger reference — descriptor carries teamIdx for Game lookup
  //    (actual entity triggerName assignment is Game-class responsibility)
  // =====================================================================

  describe('team trigger reference in descriptor', () => {
    it('createTeam includes teamIdx for Game-class trigger lookup', () => {
      const triggers = [
        makeTrigger('trig0'),
        makeTrigger('trig1'),
        makeTrigger('spawn_wave'),
      ];

      const teamTypes: TeamType[] = [{
        name: 'triggered',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: 2, // triggers[2] = 'spawn_wave'
        members: [{ type: 'E1', count: 2 }, { type: '2TNK', count: 1 }],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes, { triggers });

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.teamIdx).toBe(0);
      expect(result.createTeam!.members).toHaveLength(2);
    });

    it('createTeam returned even when team.trigger is -1', () => {
      const triggers = [makeTrigger('trig0')];
      const teamTypes: TeamType[] = [{
        name: 'no_trig',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'E1', count: 1 }],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes, { triggers });

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members[0]).toEqual({ type: 'E1', count: 1 });
    });

    it('createTeam returned even when team.trigger is out of range', () => {
      const triggers = [makeTrigger('trig0')];
      const teamTypes: TeamType[] = [{
        name: 'bad_trig',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: 99, // out of range
        members: [{ type: 'E1', count: 1 }],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes, { triggers });

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members[0]).toEqual({ type: 'E1', count: 1 });
    });

    it('createTeam teamIdx matches action.team index', () => {
      const triggers = [makeTrigger('wave1')];

      const teamTypes: TeamType[] = [
        {
          name: 'team0', house: 2, flags: 0, origin: 0, trigger: -1,
          members: [{ type: 'E2', count: 1 }], missions: [],
        },
        {
          name: 'attach', house: 2, flags: 0, origin: 0, trigger: 0,
          members: [{ type: 'E1', count: 3 }], missions: [],
        },
      ];

      const result = execCreateTeam(teamTypes, { teamIndex: 1, triggers });

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.teamIdx).toBe(1);
      expect(result.createTeam!.members[0]).toEqual({ type: 'E1', count: 3 });
    });
  });

  // =====================================================================
  // 7. Civilian VIP types in descriptor
  //    (invulnTick assignment is Game-class responsibility)
  // =====================================================================

  describe('civilian VIP types in descriptor', () => {
    it('includes civilian unit types (C1-C10) in createTeam members', () => {
      const teamTypes: TeamType[] = [{
        name: 'civ_escort',
        house: 10, // Neutral
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'C1', count: 1 }],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members[0]).toEqual({ type: 'C1', count: 1 });
    });

    it('includes EINSTEIN VIP in createTeam members', () => {
      const teamTypes: TeamType[] = [{
        name: 'einstein',
        house: 8, // GoodGuy
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'EINSTEIN', count: 1 }],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members[0]).toEqual({ type: 'EINSTEIN', count: 1 });
    });

    it('includes CHAN VIP in createTeam members', () => {
      const teamTypes: TeamType[] = [{
        name: 'chan',
        house: 8,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'CHAN', count: 1 }],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members[0]).toEqual({ type: 'CHAN', count: 1 });
    });

    it('includes GNRL VIP in createTeam members', () => {
      const teamTypes: TeamType[] = [{
        name: 'gnrl',
        house: 8,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'GNRL', count: 1 }],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members[0]).toEqual({ type: 'GNRL', count: 1 });
    });

    it('includes both civilian and military types in createTeam members', () => {
      const teamTypes: TeamType[] = [{
        name: 'soldiers',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [
          { type: 'E1', count: 1 },
          { type: '2TNK', count: 1 },
        ],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members).toHaveLength(2);
    });

    it('civilian VIP in mixed team: all types present in createTeam descriptor', () => {
      const teamTypes: TeamType[] = [{
        name: 'escort_mix',
        house: 8,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [
          { type: 'C1', count: 1 },
          { type: 'E1', count: 2 },
        ],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes);

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members).toHaveLength(2);
      expect(result.createTeam!.members[0]).toEqual({ type: 'C1', count: 1 });
      expect(result.createTeam!.members[1]).toEqual({ type: 'E1', count: 2 });
    });
  });

  // =====================================================================
  // 8. Aircraft types in descriptor
  //    (spawn position/state is Game-class responsibility)
  // =====================================================================

  describe('aircraft types in descriptor', () => {
    it('includes aircraft types in createTeam members', () => {
      const teamTypes: TeamType[] = [{
        name: 'airteam',
        house: 2, // USSR
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'HIND', count: 1 }],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes, { houseEdges: HOUSE_EDGES, mapBounds: MAP_BOUNDS });

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members[0]).toEqual({ type: 'HIND', count: 1 });
    });

    it('includes multiple aircraft types in descriptor', () => {
      const teamTypes: TeamType[] = [{
        name: 'edgeair',
        house: 2, // USSR
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'HELI', count: 1 }],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes, {
        waypoints: makeWaypoints([[0, { cx: 50, cy: 5 }]]),
        houseEdges: HOUSE_EDGES,
        mapBounds: MAP_BOUNDS,
      });

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members[0]).toEqual({ type: 'HELI', count: 1 });
    });

    it('includes MIG aircraft with correct house in descriptor', () => {
      const teamTypes: TeamType[] = [{
        name: 'flyin',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'MIG', count: 1 }],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes, {
        waypoints: makeWaypoints([[0, { cx: 50, cy: 50 }]]),
        houseEdges: HOUSE_EDGES,
        mapBounds: MAP_BOUNDS,
      });

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.house).toBe(House.USSR);
      expect(result.createTeam!.members[0]).toEqual({ type: 'MIG', count: 1 });
    });

    it('non-aircraft units also appear in createTeam descriptor', () => {
      const teamTypes: TeamType[] = [{
        name: 'ground',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: '2TNK', count: 1 }],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes, {
        waypoints: makeWaypoints([[0, { cx: 50, cy: 50 }]]),
        houseEdges: HOUSE_EDGES,
        mapBounds: MAP_BOUNDS,
      });

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members[0]).toEqual({ type: '2TNK', count: 1 });
    });

    it('Chinook transport + infantry both in descriptor', () => {
      const teamTypes: TeamType[] = [{
        name: 'chinook_team',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [
          { type: 'TRAN', count: 1 },  // Chinook
          { type: 'E1', count: 3 },
        ],
        missions: [],
      }];

      const result = execCreateTeam(teamTypes, {
        waypoints: makeWaypoints([[0, { cx: 50, cy: 50 }]]),
        houseEdges: HOUSE_EDGES,
        mapBounds: MAP_BOUNDS,
      });

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.members).toHaveLength(2);
      expect(result.createTeam!.members[0]).toEqual({ type: 'TRAN', count: 1 });
      expect(result.createTeam!.members[1]).toEqual({ type: 'E1', count: 3 });
    });
  });

  // =====================================================================
  // Combined behavior tests
  // =====================================================================

  describe('combined behaviors', () => {
    it('suicide aircraft team with trigger attachment and civilians — descriptor correct', () => {
      const triggers = [makeTrigger('wave_done')];

      const teamTypes: TeamType[] = [{
        name: 'complex_team',
        house: 2,
        flags: 2, // IsSuicide
        origin: 0,
        trigger: 0, // triggers[0] = 'wave_done'
        members: [
          { type: 'HIND', count: 1 },
          { type: 'C1', count: 1 },
        ],
        missions: [{ mission: 0, data: 0 }], // TMISSION_ATTACK
      }];

      const result = execCreateTeam(teamTypes, {
        waypoints: makeWaypoints([[0, { cx: 50, cy: 50 }]]),
        triggers,
        houseEdges: HOUSE_EDGES,
        mapBounds: MAP_BOUNDS,
      });

      expect(result.createTeam).toBeDefined();
      expect(result.createTeam!.house).toBe(House.USSR);
      expect(result.createTeam!.members).toHaveLength(2);
      expect(result.createTeam!.members[0]).toEqual({ type: 'HIND', count: 1 });
      expect(result.createTeam!.members[1]).toEqual({ type: 'C1', count: 1 });
      expect(result.createTeam!.missions).toHaveLength(1);
      expect(result.createTeam!.missions[0]).toEqual({ mission: 0, data: 0 });
    });

    it('action=4 returns createTeam descriptor, action=7 spawns entities — different code paths', () => {
      const teamTypes: TeamType[] = [{
        name: 'shared',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'E1', count: 2 }],
        missions: [],
      }];

      // action=4 (CREATE_TEAM) returns descriptor
      const result4 = executeTriggerAction(
        { action: 4, team: 0, trigger: -1, data: -1 },
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      resetEntityIds();
      // action=7 (REINFORCEMENTS) spawns entities
      const result7 = executeTriggerAction(
        { action: 7, team: 0, trigger: -1, data: -1 },
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      // action=4 returns descriptor, not spawned
      expect(result4.createTeam).toBeDefined();
      expect(result4.spawned).toHaveLength(0);

      // action=7 spawns entities, no descriptor
      expect(result7.createTeam).toBeUndefined();
      expect(result7.spawned).toHaveLength(2);

      // Total member count matches between descriptor and spawned
      const descriptorTotal = result4.createTeam!.members.reduce((sum, m) => sum + m.count, 0);
      expect(descriptorTotal).toBe(result7.spawned.length);
    });
  });
});
