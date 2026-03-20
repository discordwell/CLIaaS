/**
 * C++ behavioral parity tests for TACTION_CREATE_TEAM (action=4).
 *
 * C++ behavior (ScenarioClass::Create_Army / Do_Action):
 *   Reads teamTypes[action.team], resolves the team's origin waypoint,
 *   and spawns entities from TeamType member entries (type + count).
 *
 * Key behaviors tested:
 *   1. Spawns entities from team members (type * count) at the origin waypoint
 *   2. Returns spawned entities in result.spawned
 *   3. Skips gracefully if team index doesn't exist
 *   4. Auto-loads infantry into transport when team has both (APC/TRAN + infantry)
 *   5. IsSuicide flag (team.flags & 2) sets entity.isSuicide on all members
 *   6. Team trigger attachment — entity.triggerName set from team.trigger index
 *   7. Civilian VIP invulnerability — invulnTick=120 for CIVILIAN_UNIT_TYPES
 *   8. Aircraft spawn airborne at map edge (aircraftState='flying', flightAltitude=24)
 */

import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TeamType,
  type ScenarioTrigger,
  type TriggerAction,
} from '../engine/scenario';
import { type CellPos, House, Mission, AnimState, CELL_SIZE } from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';

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

describe('TACTION_CREATE_TEAM (action=4) — C++ ScenarioClass::Create_Army parity', () => {

  // =====================================================================
  // 1. Basic spawning: entities from team members (type + count)
  // =====================================================================

  describe('basic entity spawning', () => {
    it('spawns entities for each team member entry (single type, count=3)', () => {
      resetEntityIds();
      const teamTypes: TeamType[] = [{
        name: 'team1',
        house: 2, // USSR
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'E1', count: 3 }],
        missions: [],
      }];

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      expect(result.spawned).toHaveLength(3);
      for (const entity of result.spawned) {
        expect(entity.type).toBe('E1');
        expect(entity.house).toBe(House.USSR);
        expect(entity.alive).toBe(true);
      }
    });

    it('spawns entities for multiple member entries (mixed types)', () => {
      resetEntityIds();
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

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      expect(result.spawned).toHaveLength(4);
      const types = result.spawned.map(e => e.type);
      // E1 appears twice, 3TNK once, E2 once
      expect(types.filter(t => t === 'E1')).toHaveLength(2);
      expect(types.filter(t => t === '3TNK')).toHaveLength(1);
      expect(types.filter(t => t === 'E2')).toHaveLength(1);
    });

    it('spawns entities near the origin waypoint', () => {
      resetEntityIds();
      const teamTypes: TeamType[] = [{
        name: 'pos',
        house: 1, // Greece
        flags: 0,
        origin: 5,
        trigger: -1,
        members: [{ type: '1TNK', count: 1 }],
        missions: [],
      }];

      const waypoints = makeWaypoints([[5, { cx: 30, cy: 40 }]]);
      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        waypoints,
        new Set(),
        [],
      );

      expect(result.spawned).toHaveLength(1);
      const entity = result.spawned[0];
      // Entity should be near the waypoint world position (30*24+12, 40*24+12) = (732, 972)
      // with random offset of +-24 pixels
      const expectedX = 30 * CELL_SIZE + CELL_SIZE / 2;
      const expectedY = 40 * CELL_SIZE + CELL_SIZE / 2;
      expect(Math.abs(entity.pos.x - expectedX)).toBeLessThanOrEqual(24);
      expect(Math.abs(entity.pos.y - expectedY)).toBeLessThanOrEqual(24);
    });

    it('assigns team mission script to spawned entities', () => {
      resetEntityIds();
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

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      expect(result.spawned).toHaveLength(2);
      for (const entity of result.spawned) {
        expect(entity.teamMissions).toHaveLength(2);
        expect(entity.teamMissions[0]).toEqual({ mission: 3, data: 5 });
        expect(entity.teamMissions[1]).toEqual({ mission: 0, data: 10 });
        expect(entity.teamMissionIndex).toBe(0);
      }
    });

    it('does not assign team missions when missions array is empty', () => {
      resetEntityIds();
      const teamTypes: TeamType[] = [{
        name: 'noscript',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'E1', count: 1 }],
        missions: [],
      }];

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      expect(result.spawned).toHaveLength(1);
      // When missions is empty, teamMissions should either be empty or not set
      expect(result.spawned[0].teamMissions).toHaveLength(0);
    });
  });

  // =====================================================================
  // 2. Returns spawned entities in result.spawned
  // =====================================================================

  describe('result.spawned population', () => {
    it('result.spawned is an array containing all spawned Entity instances', () => {
      resetEntityIds();
      const teamTypes: TeamType[] = [{
        name: 'check',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'E1', count: 2 }, { type: 'E3', count: 1 }],
        missions: [],
      }];

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      expect(result.spawned).toHaveLength(3);
      for (const entity of result.spawned) {
        expect(entity).toBeInstanceOf(Entity);
      }
    });

    it('result.spawned is empty when no team members exist', () => {
      resetEntityIds();
      const teamTypes: TeamType[] = [{
        name: 'empty',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [],
        missions: [],
      }];

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      expect(result.spawned).toHaveLength(0);
    });
  });

  // =====================================================================
  // 3. Skips if team doesn't exist
  // =====================================================================

  describe('team index out of bounds / nonexistent', () => {
    it('returns empty spawned when action.team index is out of range', () => {
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
      const result = executeTriggerAction(
        createTeamAction(99),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      expect(result.spawned).toHaveLength(0);
    });

    it('returns empty spawned when teamTypes array is empty', () => {
      const result = executeTriggerAction(
        createTeamAction(0),
        [],
        makeWaypoints(),
        new Set(),
        [],
      );

      expect(result.spawned).toHaveLength(0);
    });

    it('returns empty spawned when origin waypoint does not exist and no house edge fallback', () => {
      const teamTypes: TeamType[] = [{
        name: 'nowp',
        house: 2,
        flags: 0,
        origin: 99, // waypoint 99 doesn't exist
        trigger: -1,
        members: [{ type: 'E1', count: 3 }],
        missions: [],
      }];

      // No houseEdges or mapBounds provided — cannot fall back to edge spawn
      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(), // only has waypoint 0
        new Set(),
        [],
      );

      expect(result.spawned).toHaveLength(0);
    });
  });

  // =====================================================================
  // 4. Auto-load infantry into transport
  // =====================================================================

  describe('auto-load infantry into transport', () => {
    it('loads infantry into APC when team has both APC and infantry', () => {
      resetEntityIds();
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

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      // APC has passengers=5, so all 3 E1s should be loaded
      // result.spawned should only contain the APC (infantry removed from spawned list)
      expect(result.spawned).toHaveLength(1);
      const apc = result.spawned[0];
      expect(apc.type).toBe('APC');
      expect(apc.passengers).toHaveLength(3);
      for (const inf of apc.passengers) {
        expect(inf.type).toBe('E1');
        expect(inf.transportRef).toBe(apc);
      }
    });

    it('loads up to maxPassengers infantry (excess remain in spawned)', () => {
      resetEntityIds();
      // TRUK has passengers=1 — only 1 infantry fits
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

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      // TRUK (passengers=1) + 2 remaining E1s = 3 in spawned
      expect(result.spawned).toHaveLength(3);
      const truk = result.spawned.find(e => e.type === 'TRUK');
      expect(truk).toBeDefined();
      expect(truk!.passengers).toHaveLength(1);
      expect(truk!.passengers[0].type).toBe('E1');
      expect(truk!.passengers[0].transportRef).toBe(truk);

      // 2 remaining infantry in spawned list
      const remainingInf = result.spawned.filter(e => e.type === 'E1');
      expect(remainingInf).toHaveLength(2);
    });

    it('does not auto-load when team has no transport', () => {
      resetEntityIds();
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

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      // All 3 entities should be in spawned, no loading
      expect(result.spawned).toHaveLength(3);
      for (const entity of result.spawned) {
        expect(entity.passengers).toHaveLength(0);
      }
    });

    it('does not auto-load non-infantry into transport', () => {
      resetEntityIds();
      const teamTypes: TeamType[] = [{
        name: 'vehicles',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [
          { type: 'APC', count: 1 },
          { type: '1TNK', count: 2 }, // tanks, not infantry
        ],
        missions: [],
      }];

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      // All 3 in spawned — tanks are not loaded into APC
      expect(result.spawned).toHaveLength(3);
      const apc = result.spawned.find(e => e.type === 'APC');
      expect(apc!.passengers).toHaveLength(0);
    });
  });

  // =====================================================================
  // 5. IsSuicide flag (team.flags & 2) sets entity.isSuicide
  // =====================================================================

  describe('IsSuicide flag (flags & 2)', () => {
    it('sets isSuicide=true on all members when team flags bit 1 is set', () => {
      resetEntityIds();
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

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      expect(result.spawned).toHaveLength(3);
      for (const entity of result.spawned) {
        expect(entity.isSuicide).toBe(true);
      }
    });

    it('does not set isSuicide when flags bit 1 is clear', () => {
      resetEntityIds();
      const teamTypes: TeamType[] = [{
        name: 'normal',
        house: 2,
        flags: 0, // no IsSuicide
        origin: 0,
        trigger: -1,
        members: [{ type: 'E1', count: 2 }],
        missions: [],
      }];

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      expect(result.spawned).toHaveLength(2);
      for (const entity of result.spawned) {
        expect(entity.isSuicide).toBe(false);
      }
    });

    it('handles flags with other bits set alongside IsSuicide', () => {
      resetEntityIds();
      const teamTypes: TeamType[] = [{
        name: 'mixed_flags',
        house: 2,
        flags: 6, // bits 1 and 2 set (IsSuicide + IsAutocreate)
        origin: 0,
        trigger: -1,
        members: [{ type: 'E1', count: 1 }],
        missions: [],
      }];

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      expect(result.spawned).toHaveLength(1);
      expect(result.spawned[0].isSuicide).toBe(true);
    });

    it('IsSuicide does NOT override team mission script (C++ parity)', () => {
      resetEntityIds();
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

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      const entity = result.spawned[0];
      expect(entity.isSuicide).toBe(true);
      // Team missions still assigned — IsSuicide only prevents retreat
      expect(entity.teamMissions).toHaveLength(2);
      expect(entity.teamMissionIndex).toBe(0);
    });
  });

  // =====================================================================
  // 6. Team trigger attachment (entity.triggerName from team.trigger)
  // =====================================================================

  describe('team trigger attachment', () => {
    it('assigns triggerName from triggers[team.trigger].name to all members', () => {
      resetEntityIds();
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

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        triggers,
      );

      expect(result.spawned).toHaveLength(3);
      for (const entity of result.spawned) {
        expect(entity.triggerName).toBe('spawn_wave');
      }
    });

    it('does not assign triggerName when team.trigger is -1', () => {
      resetEntityIds();
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

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        triggers,
      );

      expect(result.spawned).toHaveLength(1);
      expect(result.spawned[0].triggerName).toBeUndefined();
    });

    it('does not assign triggerName when team.trigger is out of range', () => {
      resetEntityIds();
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

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        triggers,
      );

      expect(result.spawned).toHaveLength(1);
      expect(result.spawned[0].triggerName).toBeUndefined();
    });

    it('updates trigger attachCount via noteTriggerAttachment (C++ parity)', () => {
      resetEntityIds();
      const triggers = [makeTrigger('wave1')];
      triggers[0].attachCount = 0;
      triggers[0].remainingAttachCount = 0;

      const teamTypes: TeamType[] = [{
        name: 'attach',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: 0, // triggers[0] = 'wave1'
        members: [{ type: 'E1', count: 3 }],
        missions: [],
      }];

      executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        triggers,
      );

      // noteTriggerAttachment increments attachCount/remainingAttachCount by 1 per entity
      expect(triggers[0].attachCount).toBe(3);
      expect(triggers[0].remainingAttachCount).toBe(3);
    });
  });

  // =====================================================================
  // 7. Civilian VIP invulnerability (invulnTick=120)
  // =====================================================================

  describe('civilian VIP invulnerability', () => {
    it('sets invulnTick=120 for civilian unit types (C1-C10)', () => {
      resetEntityIds();
      const teamTypes: TeamType[] = [{
        name: 'civ_escort',
        house: 10, // Neutral
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'C1', count: 1 }],
        missions: [],
      }];

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      expect(result.spawned).toHaveLength(1);
      expect(result.spawned[0].invulnTick).toBe(120);
    });

    it('sets invulnTick=120 for EINSTEIN VIP', () => {
      resetEntityIds();
      const teamTypes: TeamType[] = [{
        name: 'einstein',
        house: 8, // GoodGuy
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'EINSTEIN', count: 1 }],
        missions: [],
      }];

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      expect(result.spawned).toHaveLength(1);
      expect(result.spawned[0].invulnTick).toBe(120);
    });

    it('sets invulnTick=120 for CHAN VIP', () => {
      resetEntityIds();
      const teamTypes: TeamType[] = [{
        name: 'chan',
        house: 8,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'CHAN', count: 1 }],
        missions: [],
      }];

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      expect(result.spawned).toHaveLength(1);
      expect(result.spawned[0].invulnTick).toBe(120);
    });

    it('sets invulnTick=120 for GNRL VIP', () => {
      resetEntityIds();
      const teamTypes: TeamType[] = [{
        name: 'gnrl',
        house: 8,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'GNRL', count: 1 }],
        missions: [],
      }];

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      expect(result.spawned).toHaveLength(1);
      expect(result.spawned[0].invulnTick).toBe(120);
    });

    it('does NOT set invulnTick for non-civilian units (E1, tanks)', () => {
      resetEntityIds();
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

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      expect(result.spawned).toHaveLength(2);
      for (const entity of result.spawned) {
        expect(entity.invulnTick).toBe(0);
      }
    });

    it('civilian VIP in mixed team: only civilians get invulnTick', () => {
      resetEntityIds();
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

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      expect(result.spawned).toHaveLength(3);
      const civ = result.spawned.find(e => e.type === 'C1');
      const soldiers = result.spawned.filter(e => e.type === 'E1');
      expect(civ!.invulnTick).toBe(120);
      for (const s of soldiers) {
        expect(s.invulnTick).toBe(0);
      }
    });
  });

  // =====================================================================
  // 8. Aircraft spawn airborne at map edge
  // =====================================================================

  describe('aircraft spawn airborne at map edge', () => {
    it('aircraft spawns with aircraftState=flying and flightAltitude=FLIGHT_ALTITUDE', () => {
      resetEntityIds();
      const teamTypes: TeamType[] = [{
        name: 'airteam',
        house: 2, // USSR
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'HIND', count: 1 }],
        missions: [],
      }];

      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
        undefined,
        HOUSE_EDGES,
        MAP_BOUNDS,
      );

      expect(result.spawned).toHaveLength(1);
      const hind = result.spawned[0];
      expect(hind.aircraftState).toBe('flying');
      expect(hind.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE); // 24
    });

    it('aircraft spawns at map edge, not at origin waypoint', () => {
      resetEntityIds();
      // Place waypoint near north edge so inferClosestMapEdge picks 'north'
      const teamTypes: TeamType[] = [{
        name: 'edgeair',
        house: 2, // USSR
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'HELI', count: 1 }],
        missions: [],
      }];

      const waypoints = makeWaypoints([[0, { cx: 50, cy: 5 }]]);
      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        waypoints,
        new Set(),
        [],
        undefined,
        HOUSE_EDGES,
        MAP_BOUNDS,
      );

      expect(result.spawned).toHaveLength(1);
      const heli = result.spawned[0];
      // calculateHouseEdgeSpawnCell uses inferClosestMapEdge when alignedCell is provided.
      // Waypoint at (50,5) — closest edge is north (cy=5 < h/2=50).
      // North edge spawn: cy=MAP_BOUNDS.y=0
      const edgeY = MAP_BOUNDS.y * CELL_SIZE + CELL_SIZE / 2;
      expect(heli.pos.y).toBe(edgeY);
      // Position should NOT be at the origin waypoint y
      const originY = 5 * CELL_SIZE + CELL_SIZE / 2;
      expect(heli.pos.y).not.toBe(originY);
    });

    it('aircraft gets animState=WALK and mission=MOVE toward origin waypoint', () => {
      resetEntityIds();
      const teamTypes: TeamType[] = [{
        name: 'flyin',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'MIG', count: 1 }],
        missions: [],
      }];

      const waypoints = makeWaypoints([[0, { cx: 50, cy: 50 }]]);
      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        waypoints,
        new Set(),
        [],
        undefined,
        HOUSE_EDGES,
        MAP_BOUNDS,
      );

      expect(result.spawned).toHaveLength(1);
      const mig = result.spawned[0];
      expect(mig.animState).toBe(AnimState.WALK);
      expect(mig.mission).toBe(Mission.MOVE);
      // moveTarget should be the origin waypoint world position
      const expectedWorld = { x: 50 * CELL_SIZE + CELL_SIZE / 2, y: 50 * CELL_SIZE + CELL_SIZE / 2 };
      expect(mig.moveTarget).toEqual(expectedWorld);
    });

    it('non-aircraft units spawn at map edge per C++ reinf.cpp:471 (no aircraft state)', () => {
      resetEntityIds();
      const teamTypes: TeamType[] = [{
        name: 'ground',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: '2TNK', count: 1 }],
        missions: [],
      }];

      const waypoints = makeWaypoints([[0, { cx: 50, cy: 50 }]]);
      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        waypoints,
        new Set(),
        [],
        undefined,
        HOUSE_EDGES,
        MAP_BOUNDS,
      );

      expect(result.spawned).toHaveLength(1);
      const tank = result.spawned[0];
      // C++ parity: ground units spawn at map edge (reinf.cpp:471 Calculated_Cell)
      // Waypoint (50,50) in bounds (0,0,100,100) → south edge → cy=99
      const edgeY = (MAP_BOUNDS.y + MAP_BOUNDS.h - 1) * CELL_SIZE + CELL_SIZE / 2;
      expect(Math.abs(tank.pos.y - edgeY)).toBeLessThanOrEqual(24);
      // Should NOT have aircraftState='flying'
      expect(tank.aircraftState).not.toBe('flying');
    });

    it('Chinook transport spawns at edge and also loads infantry (C++ SCG01EA parity)', () => {
      resetEntityIds();
      const teamTypes: TeamType[] = [{
        name: 'chinook_team',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [
          { type: 'TRAN', count: 1 },  // Chinook (aircraft transport, passengers=5)
          { type: 'E1', count: 3 },
        ],
        missions: [],
      }];

      const waypoints = makeWaypoints([[0, { cx: 50, cy: 50 }]]);
      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        waypoints,
        new Set(),
        [],
        undefined,
        HOUSE_EDGES,
        MAP_BOUNDS,
      );

      // Chinook should be the only entity in spawned (infantry loaded)
      expect(result.spawned).toHaveLength(1);
      const chinook = result.spawned[0];
      expect(chinook.type).toBe('TRAN');
      expect(chinook.aircraftState).toBe('flying');
      expect(chinook.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
      // Infantry should be loaded as passengers
      expect(chinook.passengers).toHaveLength(3);
      for (const inf of chinook.passengers) {
        expect(inf.type).toBe('E1');
        expect(inf.transportRef).toBe(chinook);
      }
    });
  });

  // =====================================================================
  // Combined behavior tests
  // =====================================================================

  describe('combined behaviors', () => {
    it('suicide aircraft team with trigger attachment and civilians', () => {
      resetEntityIds();
      const triggers = [makeTrigger('wave_done')];
      triggers[0].attachCount = 0;
      triggers[0].remainingAttachCount = 0;

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

      const waypoints = makeWaypoints([[0, { cx: 50, cy: 50 }]]);
      const result = executeTriggerAction(
        createTeamAction(0),
        teamTypes,
        waypoints,
        new Set(),
        triggers,
        undefined,
        HOUSE_EDGES,
        MAP_BOUNDS,
      );

      expect(result.spawned).toHaveLength(2);

      // Both should have trigger attachment
      for (const entity of result.spawned) {
        expect(entity.triggerName).toBe('wave_done');
        expect(entity.isSuicide).toBe(true);
        expect(entity.teamMissions).toHaveLength(1);
      }

      // Aircraft should be airborne
      const hind = result.spawned.find(e => e.type === 'HIND');
      expect(hind!.aircraftState).toBe('flying');
      expect(hind!.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);

      // Civilian should have invulnerability
      const civ = result.spawned.find(e => e.type === 'C1');
      expect(civ!.invulnTick).toBe(120);

      // Trigger attachment count should reflect both entities
      expect(triggers[0].attachCount).toBe(2);
    });

    it('action=4 (CREATE_TEAM) produces identical behavior to action=7 (REINFORCEMENTS)', () => {
      // C++ code: both TACTION_CREATE_TEAM and TACTION_REINFORCEMENTS share the same case block
      resetEntityIds();
      const teamTypes: TeamType[] = [{
        name: 'shared',
        house: 2,
        flags: 0,
        origin: 0,
        trigger: -1,
        members: [{ type: 'E1', count: 2 }],
        missions: [],
      }];

      // Run with action=4 (CREATE_TEAM)
      const result4 = executeTriggerAction(
        { action: 4, team: 0, trigger: -1, data: -1 },
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      resetEntityIds();
      // Run with action=7 (REINFORCEMENTS)
      const result7 = executeTriggerAction(
        { action: 7, team: 0, trigger: -1, data: -1 },
        teamTypes,
        makeWaypoints(),
        new Set(),
        [],
      );

      // Both should produce the same number of entities with the same types
      expect(result4.spawned).toHaveLength(result7.spawned.length);
      expect(result4.spawned.map(e => e.type)).toEqual(result7.spawned.map(e => e.type));
    });
  });
});
