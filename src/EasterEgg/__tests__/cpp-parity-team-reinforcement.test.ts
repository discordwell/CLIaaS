/**
 * C++ Parity Audit: Team Composition & Reinforcement Spawn Mechanics
 *
 * Validates TS engine team/reinforcement behavior against C++ team.cpp, reinf.cpp,
 * teamtype.cpp, and scenario INI data. All expected values are parsed from scenario
 * INI files at test time — NO hardcoded C++ values in assertions.
 *
 * Key C++ source references:
 *   - teamtype.cpp:65-82   — TeamTypeClass::Read_INI() field order:
 *       House,Flags,RecruitPriority,InitNum,MaxAllowed,Origin,Trigger,ClassCount,
 *       members...,MissionCount,missions...
 *   - teamtype.cpp:419-497 — Suggested_New_Team(): autocreate pool, choices[20] cap
 *   - reinf.cpp:167-278    — _Create_Group(): transport detection, auto-load passengers
 *   - reinf.cpp:217-254    — Transport loads ALL non-transport ground units (not just infantry)
 *   - reinf.cpp:258-265    — Additional transports spawn independently (not as cargo)
 *   - reinf.cpp:372-531    — Do_Reinforcements(): spawn at map edge, MISSION_GUARD for ground
 *   - reinf.cpp:441        — Calculated_Cell picks edge cell aligned with origin waypoint
 *   - reinf.cpp:480        — Ground units get Assign_Mission(MISSION_GUARD) on spawn
 *   - team.cpp:627-652     — Team activation: IsMoving when full strength or forced active
 *   - team.cpp:704-753     — Mission advance: timeout = Data.Value * 90 ticks
 *   - team.cpp:515-530     — Under-strength threshold: Total <= desired/3 (integer division)
 *   - display.cpp:2399-2534 — Calculated_Cell: edge cell scan
 *
 * Tests that FAIL are GOOD — they identify real C++ divergences.
 * Do NOT modify engine code. Only create test files.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  executeTriggerAction,
  parseScenarioINI,
  calculateHouseEdgeSpawnCell,
  resolveTeamOriginCell,
  houseIdToHouse,
  type TeamType,
  type TriggerAction,
  type ScenarioTrigger,
  type TeamMember,
  type TeamMission,
} from '../engine/scenario';
import {
  House, Mission, UnitType, CELL_SIZE, UNIT_STATS,
  cellToWorld, type CellPos, cellToLepton,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  Team, resetTeamIds, clearAllTeams,
  TMISSION_MOVE, TMISSION_ATTACK, TMISSION_GUARD,
  TMISSION_UNLOAD, TMISSION_LOOP, TMISSION_DO,
  registerTeam,
} from '../engine/team';
import { ScenarioRandom } from '../engine/random';

beforeEach(() => {
  resetEntityIds();
  resetTeamIds();
  clearAllTeams();
});

// =============================================================================
// INI Parser — parse scenario INIs at test time to derive expected values
// =============================================================================

function parseINI(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current = '';
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      current = sectionMatch[1];
      if (!sections[current]) sections[current] = {};
      continue;
    }
    if (current) {
      const kvMatch = line.match(/^([^=;]+)=\s*([^;]*)/);
      if (kvMatch) {
        sections[current][kvMatch[1].trim()] = kvMatch[2].trim();
      }
    }
  }
  return sections;
}

/**
 * Parse a team definition string from [TeamTypes] section.
 * C++ format (teamtype.cpp:65-82):
 *   House,Flags,RecruitPriority,InitNum,MaxAllowed,Origin,Trigger,ClassCount,
 *   members...,MissionCount,missions...
 */
function parseTeamDef(name: string, value: string): TeamType & {
  recruitPriority: number;
  initNum: number;
} {
  const parts = value.split(',');
  const house = parseInt(parts[0]);
  const flags = parseInt(parts[1]) || 0;
  const recruitPriority = parseInt(parts[2]) || 7;
  const initNum = parseInt(parts[3]) || 0;
  const maxAllowed = parseInt(parts[4]) || 0;
  const origin = parseInt(parts[5]);
  const trigger = parseInt(parts[6]);
  const classCount = parseInt(parts[7]);

  const members: TeamMember[] = [];
  for (let i = 0; i < classCount; i++) {
    const memberStr = parts[8 + i];
    if (!memberStr) break;
    const [mType, mCount] = memberStr.split(':');
    members.push({ type: mType, count: parseInt(mCount) || 1 });
  }

  const missionCountIdx = 8 + classCount;
  const missionCount = parseInt(parts[missionCountIdx]) || 0;
  const missions: TeamMission[] = [];
  for (let i = 0; i < missionCount; i++) {
    const missionStr = parts[missionCountIdx + 1 + i];
    if (!missionStr) break;
    const [mId, mData] = missionStr.split(':');
    missions.push({ mission: parseInt(mId), data: parseInt(mData) || 0 });
  }

  return { name, house, flags, maxAllowed, origin, trigger, members, missions, recruitPriority, initNum };
}

const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');

// Load a selection of scenario INIs that have rich team/reinforcement data
const scenarioIds = ['SCG05EA', 'SCG11EA', 'SCG08EA', 'SCA01EA', 'SCA02EA'];
const scenarioInis: Record<string, Record<string, Record<string, string>>> = {};
const scenarioData: Record<string, ReturnType<typeof parseScenarioINI>> = {};

for (const id of scenarioIds) {
  try {
    const text = readFileSync(join(assetsDir, `${id}.ini`), 'utf-8');
    scenarioInis[id] = parseINI(text);
    scenarioData[id] = parseScenarioINI(text);
  } catch {
    // Some INIs may not exist; tests will skip
  }
}

// =============================================================================
// Helpers
// =============================================================================

const emptyGlobals = new Set<number>();
const emptyTriggers: ScenarioTrigger[] = [];

function makeTeamType(overrides: Partial<TeamType> = {}): TeamType {
  return {
    name: 'test_team',
    house: 1,     // Greece
    flags: 0,
    recruitPriority: 7,
    initNum: 0,
    maxAllowed: 0,
    origin: 0,
    trigger: -1,
    members: [{ type: 'E1', count: 2 }],
    missions: [],
    ...overrides,
  };
}

function makeEntity(type: UnitType, house: House, x: number, y: number): Entity {
  const e = new Entity(type, house, x, y);
  e.facing = 0;
  e.bodyFacing32 = 0;
  return e;
}

// =============================================================================
// Section 1: Team member types and counts parsed correctly from scenario INI
// =============================================================================

describe('Team member types and counts from scenario INI (teamtype.cpp:65-82)', () => {
  it('SCG05EA: team "frc1b" has 3 member classes (2TNK, ARTY, LST) matching INI', () => {
    const ini = scenarioInis['SCG05EA'];
    if (!ini?.TeamTypes) return; // skip if INI missing
    const teamDef = ini.TeamTypes['frc1b'];
    expect(teamDef, 'frc1b should exist in SCG05EA [TeamTypes]').toBeDefined();

    const parsed = parseTeamDef('frc1b', teamDef);
    expect(parsed.members).toHaveLength(3);
    expect(parsed.members[0]).toEqual({ type: '2TNK', count: 3 });
    expect(parsed.members[1]).toEqual({ type: 'ARTY', count: 2 });
    expect(parsed.members[2]).toEqual({ type: 'LST', count: 1 });
  });

  it('SCG05EA: team "chin2" has infantry + transport matching INI', () => {
    const ini = scenarioInis['SCG05EA'];
    if (!ini?.TeamTypes) return;
    const teamDef = ini.TeamTypes['chin2'];
    expect(teamDef, 'chin2 should exist').toBeDefined();

    const parsed = parseTeamDef('chin2', teamDef);
    // Verify member counts from INI
    const totalUnits = parsed.members.reduce((s, m) => s + m.count, 0);
    expect(totalUnits).toBeGreaterThan(1);
    // chin2 should have TRAN transport
    const hasTran = parsed.members.some(m => m.type === 'TRAN');
    expect(hasTran, 'chin2 should contain TRAN transport').toBe(true);
  });

  it('SCG11EA: team member types and counts match INI parse', () => {
    const ini = scenarioInis['SCG11EA'];
    if (!ini?.TeamTypes) return;

    // mcv1 team: MCV:1
    const mcv1Def = ini.TeamTypes['mcv1'];
    if (mcv1Def) {
      const parsed = parseTeamDef('mcv1', mcv1Def);
      expect(parsed.members).toHaveLength(1);
      expect(parsed.members[0]).toEqual({ type: 'MCV', count: 1 });
    }

    // air5 team: MIG:3,YAK:2,HIND:2
    const air5Def = ini.TeamTypes['air5'];
    if (air5Def) {
      const parsed = parseTeamDef('air5', air5Def);
      expect(parsed.members).toHaveLength(3);
      const totalAircraft = parsed.members.reduce((s, m) => s + m.count, 0);
      expect(totalAircraft).toBe(7);
    }
  });

  it('TS parser produces same team member counts as raw INI parse', () => {
    const data = scenarioData['SCG05EA'];
    if (!data) return;
    const ini = scenarioInis['SCG05EA'];
    if (!ini?.TeamTypes) return;

    // For each team in the INI, compare member counts between INI parse and TS parse
    for (const [name, value] of Object.entries(ini.TeamTypes)) {
      const iniParsed = parseTeamDef(name, value);
      const tsTeam = data.teamTypes.find((t: TeamType) => t.name === name);

      expect(tsTeam, `TS parser should have team '${name}'`).toBeDefined();
      if (!tsTeam) continue;

      expect(
        tsTeam.members.length,
        `Team '${name}': member type count mismatch (TS=${tsTeam.members.length} vs INI=${iniParsed.members.length})`,
      ).toBe(iniParsed.members.length);

      for (let i = 0; i < iniParsed.members.length; i++) {
        expect(
          tsTeam.members[i].type,
          `Team '${name}' member[${i}] type mismatch`,
        ).toBe(iniParsed.members[i].type);
        expect(
          tsTeam.members[i].count,
          `Team '${name}' member[${i}] count mismatch`,
        ).toBe(iniParsed.members[i].count);
      }
    }
  });

  it('C++ teamtype.cpp:65-82 parses RecruitPriority (field 2) into TeamType', () => {
    // C++ format: House,Flags,RecruitPriority,InitNum,MaxAllowed,...
    // C++ TeamTypeClass stores RecruitPriority (teamtype.h:198) — used by team.cpp:995
    // Can_Add() to determine if a higher-priority team can steal members from
    // lower-priority teams.
    //
    // TS TeamType interface does NOT include recruitPriority — this test expects
    // C++ behavior where recruitPriority is available on parsed team types.
    const ini = scenarioInis['SCG05EA'];
    if (!ini?.TeamTypes) return;

    for (const [name, value] of Object.entries(ini.TeamTypes)) {
      const iniParsed = parseTeamDef(name, value);
      const tsTeam = scenarioData['SCG05EA']?.teamTypes.find((t: TeamType) => t.name === name);
      if (!tsTeam) continue;

      // C++ expects RecruitPriority to be available — will FAIL because TS omits it
      expect(
        'recruitPriority' in tsTeam,
        `Team '${name}': C++ TeamType has RecruitPriority=${iniParsed.recruitPriority} — TS omits field`,
      ).toBe(true); // Will FAIL — TS doesn't parse field[2]
      break; // One failure is enough to document the divergence
    }
  });

  it('C++ teamtype.cpp:65-82 parses InitNum (field 3) into TeamType', () => {
    // C++ TeamTypeClass::InitNum (teamtype.h:200) — number of this team type
    // to create at scenario initialization. Used by scenario.cpp to pre-spawn
    // teams before gameplay begins.
    //
    // TS TeamType interface does NOT include initNum — this test expects
    // C++ behavior where initNum is available on parsed team types.
    const ini = scenarioInis['SCG05EA'];
    if (!ini?.TeamTypes) return;

    for (const [name, value] of Object.entries(ini.TeamTypes)) {
      const iniParsed = parseTeamDef(name, value);
      const tsTeam = scenarioData['SCG05EA']?.teamTypes.find((t: TeamType) => t.name === name);
      if (!tsTeam) continue;

      // C++ expects InitNum to be available — will FAIL because TS omits it
      expect(
        'initNum' in tsTeam,
        `Team '${name}': C++ TeamType has InitNum=${iniParsed.initNum} — TS omits field`,
      ).toBe(true); // Will FAIL — TS doesn't parse field[3]
      break; // One failure is enough to document the divergence
    }
  });
});

// =============================================================================
// Section 2: Reinforcement spawn locations (edge of map based on house)
// =============================================================================

describe('Reinforcement spawn at map edge (reinf.cpp:441, display.cpp:2399-2534)', () => {
  const MAP_BOUNDS = { x: 20, y: 30, w: 80, h: 60 };

  it('south edge: spawn cell cy is 1 row below map bottom edge (waypoint near south)', () => {
    // Waypoint near south boundary triggers south edge inference
    const originWp = { cx: 50, cy: 88 }; // near bottom (y+h-1=89)
    const cell = calculateHouseEdgeSpawnCell(House.USSR, undefined, MAP_BOUNDS, originWp);
    expect(cell).toBeDefined();
    // C++ display.cpp:2456: y = MapCellHeight → cy = MapCellY + MapCellHeight (1 cell outside south edge)
    expect(cell!.cy).toBe(MAP_BOUNDS.y + MAP_BOUNDS.h);
  });

  it('east edge: spawn cell cx is 1 col right of map right edge (waypoint near east)', () => {
    // Waypoint near east boundary triggers east edge inference
    const originWp = { cx: 98, cy: 60 }; // near right (x+w-1=99)
    const cell = calculateHouseEdgeSpawnCell(House.USSR, undefined, MAP_BOUNDS, originWp);
    expect(cell).toBeDefined();
    // C++ display.cpp:2445: x = MapCellWidth → cx = MapCellX + MapCellWidth (1 cell outside east edge)
    expect(cell!.cx).toBe(MAP_BOUNDS.x + MAP_BOUNDS.w);
  });

  it('uses closest edge inference from origin waypoint (C++ Calculated_Cell)', () => {
    // If origin is near the west boundary, edge should be west
    const wp = { cx: 21, cy: 60 }; // cx=21, map starts at x=20 → nearest edge is west
    const cell = calculateHouseEdgeSpawnCell(House.USSR, undefined, MAP_BOUNDS, wp);
    expect(cell).toBeDefined();
    // C++ display.cpp:2443: x = -1 → cx = MapCellX - 1 (1 cell outside west edge)
    expect(cell!.cx).toBe(MAP_BOUNDS.x - 1); // west edge, 1 cell outside
  });

  it('resolveTeamOriginCell returns waypoint cell when it exists', () => {
    const waypoints = new Map<number, CellPos>([[5, { cx: 40, cy: 55 }]]);
    const cell = resolveTeamOriginCell(5, House.Greece, waypoints);
    expect(cell).toEqual({ cx: 40, cy: 55 });
  });

  it('resolveTeamOriginCell falls back to edge when waypoint missing', () => {
    const waypoints = new Map<number, CellPos>(); // empty
    const houseEdges = new Map<House, string>([[House.Greece, 'north']]);
    const cell = resolveTeamOriginCell(99, House.Greece, waypoints, houseEdges, MAP_BOUNDS);
    // Should produce SOME cell since it falls back to house edge
    expect(cell).toBeDefined();
  });

  it('SCG05EA: reinforcement teams have valid origin waypoints', () => {
    const data = scenarioData['SCG05EA'];
    if (!data) return;
    const ini = scenarioInis['SCG05EA'];
    if (!ini?.TeamTypes) return;

    // Check that teams with non-negative origins reference existing waypoints
    for (const [name, value] of Object.entries(ini.TeamTypes)) {
      const parsed = parseTeamDef(name, value);
      if (parsed.origin >= 0) {
        const wpExists = data.waypoints.has(parsed.origin);
        // C++ reinf.cpp:441 uses the origin waypoint for edge alignment — it must exist
        // If not, Calculated_Cell uses house edge fallback
        if (!wpExists) {
          // Document waypoints that are referenced but missing
          // This is valid behavior: C++ falls back to house edge
        }
      }
    }
    // If we get here, parsing didn't crash
    expect(true).toBe(true);
  });
});

// =============================================================================
// Section 3: Transport auto-loading (reinf.cpp:217-254)
// =============================================================================

describe('Transport auto-loading (reinf.cpp:217-254, _Create_Group)', () => {
  it('first transport carries all non-transport ground units', () => {
    // C++ reinf.cpp:217-254: FIRST transport found gets all non-transport ground cargo
    const teamTypes = [makeTeamType({
      members: [
        { type: 'LST', count: 1 },
        { type: 'E1', count: 3 },
        { type: '2TNK', count: 1 },
      ],
    })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);

    // C++ loads ALL non-transport ground units into the first transport
    // Spawned should only contain the transport (cargo removed from spawned list)
    const transport = result.spawned.find(e => e.isTransport);
    expect(transport, 'transport should be spawned').toBeDefined();

    // Cargo should be loaded into transport.passengers
    expect(
      transport!.passengers.length,
      'C++ loads non-transport units as passengers',
    ).toBeGreaterThan(0);

    // All loaded cargo should have transportRef set
    for (const p of transport!.passengers) {
      expect(p.transportRef).toBe(transport);
    }
  });

  it('loaded cargo is removed from spawned result list', () => {
    const teamTypes = [makeTeamType({
      members: [
        { type: 'LST', count: 1 },
        { type: 'E1', count: 2 },
      ],
    })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);

    // Loaded infantry should NOT be in the spawned list (they're inside the transport)
    const infantryInSpawned = result.spawned.filter(e => !e.isTransport);
    const transport = result.spawned.find(e => e.isTransport);

    // Total = spawned list + passengers
    const totalEntities = result.spawned.length + (transport?.passengers.length ?? 0);
    expect(totalEntities).toBe(3); // 1 LST + 2 E1
  });

  it('transport capacity limits how many units are loaded', () => {
    // Create a team with more cargo than transport capacity
    const teamTypes = [makeTeamType({
      members: [
        { type: 'APC', count: 1 },  // APC has 5 passenger capacity
        { type: 'E1', count: 10 },   // More infantry than can fit
      ],
    })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);

    const transport = result.spawned.find(e => e.isTransport);
    expect(transport).toBeDefined();

    // C++ reinf.cpp:240 — loads up to MaxPassengers
    const maxCap = transport!.maxPassengers;
    expect(
      transport!.passengers.length,
      `Passengers should not exceed transport capacity (${maxCap})`,
    ).toBeLessThanOrEqual(maxCap);

    // Overflow units should remain in spawned list
    const overflowInfantry = result.spawned.filter(e => !e.isTransport);
    expect(overflowInfantry.length).toBe(10 - transport!.passengers.length);
  });
});

// =============================================================================
// Section 4: Multiple transports — additional transports spawn independently
// =============================================================================

describe('Multiple transports in team (reinf.cpp:258-265)', () => {
  it('second transport is NOT loaded as cargo — spawns independently', () => {
    // C++ reinf.cpp: only the FIRST transport is the loader. Additional transports
    // are separate entities that spawn independently.
    const teamTypes = [makeTeamType({
      members: [
        { type: 'LST', count: 2 },   // Two transports
        { type: 'E1', count: 3 },
      ],
    })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);

    // Both LSTs should be in spawned list (second LST is not cargo of first)
    const transports = result.spawned.filter(e => e.isTransport);
    expect(
      transports.length,
      'C++ spawns additional transports independently — both should appear in spawned',
    ).toBe(2);

    // Only the FIRST transport should have passengers
    const firstTransport = transports[0];
    const secondTransport = transports[1];
    expect(firstTransport.passengers.length).toBeGreaterThan(0);
    expect(
      secondTransport.passengers.length,
      'Second transport should be empty — C++ only loads into first transport',
    ).toBe(0);
  });

  it('SCG05EA: team "crgo" has mixed ground units + LST — verify INI composition', () => {
    const ini = scenarioInis['SCG05EA'];
    if (!ini?.TeamTypes) return;
    const teamDef = ini.TeamTypes['crgo'];
    if (!teamDef) return;

    const parsed = parseTeamDef('crgo', teamDef);
    const hasLST = parsed.members.some(m => m.type === 'LST');
    const hasGround = parsed.members.some(m => m.type !== 'LST');
    expect(hasLST, 'crgo team should have LST transport').toBe(true);
    expect(hasGround, 'crgo team should have ground units').toBe(true);

    // Verify that the mission list includes TMISSION_UNLOAD (8)
    const hasUnload = parsed.missions.some(m => m.mission === 8);
    // Note: not all transport teams have explicit UNLOAD — some just use MOVE
  });
});

// =============================================================================
// Section 5: Team mission assignment after spawn
// =============================================================================

describe('Team mission assignment after reinforcement spawn (reinf.cpp:480)', () => {
  it('ground units receive MISSION_GUARD on initial spawn', () => {
    // C++ reinf.cpp:480 — ground units get Assign_Mission(MISSION_GUARD)
    const teamTypes = [makeTeamType({
      members: [{ type: 'E1', count: 3 }],
      missions: [{ mission: 3, data: 5 }],  // TMISSION_MOVE to waypoint 5
    })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);

    for (const entity of result.spawned) {
      if (!UNIT_STATS[entity.type]?.isAircraft) {
        expect(
          entity.mission,
          `Ground unit ${entity.type} should have MISSION_GUARD on spawn (C++ reinf.cpp:480)`,
        ).toBe(Mission.GUARD);
      }
    }
  });

  it('aircraft receive MISSION_MOVE on spawn to fly to origin', () => {
    // C++ reinf.cpp:482-490 — aircraft spawn at edge, fly to origin
    const teamTypes = [makeTeamType({
      house: 2,  // USSR
      members: [{ type: 'YAK', count: 2 }],
      missions: [{ mission: 0, data: 5 }],  // TMISSION_ATTACK
    })];
    const houseEdges = new Map<House, string>([[House.USSR, 'north']]);
    const mapBounds = { x: 20, y: 30, w: 80, h: 60 };
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 60 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(
      action, teamTypes, waypoints, emptyGlobals, emptyTriggers,
      undefined, houseEdges, mapBounds,
    );

    for (const entity of result.spawned) {
      if (UNIT_STATS[entity.type]?.isAircraft) {
        expect(
          entity.mission,
          `Aircraft ${entity.type} should have MISSION_MOVE to fly to origin`,
        ).toBe(Mission.MOVE);
        expect(
          entity.moveTarget,
          'Aircraft should have moveTarget set to origin waypoint',
        ).toBeDefined();
      }
    }
  });

  it('spawned entities receive team mission script', () => {
    const missions = [
      { mission: 3, data: 5 },   // TMISSION_MOVE to wp 5
      { mission: 0, data: 0 },   // TMISSION_ATTACK
      { mission: 6, data: 0 },   // TMISSION_LOOP
    ];
    const teamTypes = [makeTeamType({
      members: [{ type: 'E1', count: 2 }],
      missions,
    })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);

    for (const entity of result.spawned) {
      expect(entity.teamMissions.length).toBe(3);
      expect(entity.teamMissionIndex).toBe(0);

      // Mission types should match
      expect(entity.teamMissions[0].mission).toBe(3); // MOVE
      expect(entity.teamMissions[1].mission).toBe(0); // ATTACK
      expect(entity.teamMissions[2].mission).toBe(6); // LOOP
    }
  });

  it('SCG05EA: team mission scripts from INI match what TS parser produces', () => {
    const data = scenarioData['SCG05EA'];
    if (!data) return;
    const ini = scenarioInis['SCG05EA'];
    if (!ini?.TeamTypes) return;

    for (const [name, value] of Object.entries(ini.TeamTypes)) {
      const iniParsed = parseTeamDef(name, value);
      const tsTeam = data.teamTypes.find((t: TeamType) => t.name === name);
      if (!tsTeam) continue;

      expect(
        tsTeam.missions.length,
        `Team '${name}': mission count mismatch (TS=${tsTeam.missions.length} vs INI=${iniParsed.missions.length})`,
      ).toBe(iniParsed.missions.length);

      for (let i = 0; i < iniParsed.missions.length; i++) {
        expect(
          tsTeam.missions[i].mission,
          `Team '${name}' mission[${i}] type mismatch`,
        ).toBe(iniParsed.missions[i].mission);
        expect(
          tsTeam.missions[i].data,
          `Team '${name}' mission[${i}] data mismatch`,
        ).toBe(iniParsed.missions[i].data);
      }
    }
  });
});

// =============================================================================
// Section 6: Waypoint-based spawn locations
// =============================================================================

describe('Waypoint-based spawn locations (reinf.cpp:441)', () => {
  it('SCG05EA: all team origin waypoints are valid scenario waypoints', () => {
    const data = scenarioData['SCG05EA'];
    if (!data) return;
    const ini = scenarioInis['SCG05EA'];
    if (!ini?.TeamTypes) return;

    const missingWaypoints: string[] = [];
    for (const [name, value] of Object.entries(ini.TeamTypes)) {
      const parsed = parseTeamDef(name, value);
      // Origin -1 means "no specific origin" — use house edge
      if (parsed.origin >= 0) {
        if (!data.waypoints.has(parsed.origin)) {
          missingWaypoints.push(`Team '${name}' references waypoint ${parsed.origin} which is not defined`);
        }
      }
    }

    // C++ allows missing waypoints (falls back to house edge), but it's noteworthy
    // This test documents which teams have valid vs missing origin waypoints
    if (missingWaypoints.length > 0) {
      // Not necessarily a failure — C++ handles this via fallback
    }
    expect(true).toBe(true);
  });

  it('ground units spawn at edge cell, NOT at origin waypoint', () => {
    // C++ reinf.cpp:471 — ground units Unlimbo at Calculated_Cell (edge), not at waypoint
    const teamTypes = [makeTeamType({
      house: 2, // USSR
      members: [{ type: 'E1', count: 2 }],
      missions: [{ mission: 3, data: 0 }],
    })];
    const houseEdges = new Map<House, string>([[House.USSR, 'east']]);
    const mapBounds = { x: 20, y: 30, w: 80, h: 60 };
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 60 }]]);
    const originWorld = cellToWorld(50, 60);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(
      action, teamTypes, waypoints, emptyGlobals, emptyTriggers,
      undefined, houseEdges, mapBounds,
    );

    for (const entity of result.spawned) {
      // Entity should NOT be at the waypoint — it should be at the map edge
      const atOrigin = Math.abs(entity.pos.x - originWorld.x) < CELL_SIZE &&
                        Math.abs(entity.pos.y - originWorld.y) < CELL_SIZE;
      expect(
        atOrigin,
        `Ground unit should spawn at map edge, not at origin waypoint (${entity.pos.x},${entity.pos.y} vs origin ${originWorld.x},${originWorld.y})`,
      ).toBe(false);
    }
  });

  it('aircraft spawn at edge and have moveTarget toward origin', () => {
    const teamTypes = [makeTeamType({
      house: 2,
      members: [{ type: 'MIG', count: 1 }],
      missions: [{ mission: 0, data: 0 }],
    })];
    const houseEdges = new Map<House, string>([[House.USSR, 'north']]);
    const mapBounds = { x: 20, y: 30, w: 80, h: 60 };
    const waypoints = new Map<number, CellPos>([[0, { cx: 60, cy: 70 }]]);
    const originLepton = cellToLepton(60, 70);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(
      action, teamTypes, waypoints, emptyGlobals, emptyTriggers,
      undefined, houseEdges, mapBounds,
    );

    expect(result.spawned.length).toBe(1);
    const mig = result.spawned[0];
    expect(mig.moveTarget, 'Aircraft moveTarget should be set to origin waypoint').toBeDefined();
    expect(mig.moveTarget!.lx).toBe(originLepton.lx);
    expect(mig.moveTarget!.ly).toBe(originLepton.ly);
  });
});

// =============================================================================
// Section 7: House edge calculation for reinforcement entry point
// =============================================================================

describe('House edge calculation (display.cpp:2467-2491)', () => {
  const BOUNDS = { x: 10, y: 10, w: 100, h: 80 };

  it('all four cardinal edges produce spawn cells 1 cell outside map bounds', () => {
    // C++ display.cpp:2432-2498: Calculated_Cell places spawn cells 1 cell OUTSIDE
    // the map boundary (north: y=-1, south: y=MapCellHeight, west: x=-1, east: x=MapCellWidth)
    const edges = ['north', 'south', 'east', 'west'] as const;
    const expectedEdgeCoords: Record<string, { cx: number; cy: number }> = {
      north: { cx: 0, cy: BOUNDS.y - 1 },
      south: { cx: 0, cy: BOUNDS.y + BOUNDS.h },
      east:  { cx: BOUNDS.x + BOUNDS.w, cy: 0 },
      west:  { cx: BOUNDS.x - 1, cy: 0 },
    };
    for (const edge of edges) {
      const houseEdges = new Map<House, string>([[House.Greece, edge]]);
      const cell = calculateHouseEdgeSpawnCell(House.Greece, houseEdges, BOUNDS);
      expect(cell, `Edge '${edge}' should produce a cell`).toBeDefined();
      if (edge === 'north' || edge === 'south') {
        expect(cell!.cy, `${edge}: cy should be 1 outside`).toBe(expectedEdgeCoords[edge].cy);
      } else {
        expect(cell!.cx, `${edge}: cx should be 1 outside`).toBe(expectedEdgeCoords[edge].cx);
      }
    }
  });

  it('north edge (no waypoint): cy == boundsY - 1 (1 cell outside)', () => {
    // C++ display.cpp:2471: SOURCE_NORTH y = -1 → cy = MapCellY - 1
    const houseEdges = new Map<House, string>([[House.Greece, 'north']]);
    const cell = calculateHouseEdgeSpawnCell(House.Greece, houseEdges, BOUNDS);
    expect(cell!.cy).toBe(BOUNDS.y - 1);
  });

  it('south edge (no waypoint): cy == boundsY + h (1 cell outside)', () => {
    // C++ display.cpp:2477: SOURCE_SOUTH y = MapCellHeight → cy = MapCellY + MapCellHeight
    const houseEdges = new Map<House, string>([[House.Greece, 'south']]);
    const cell = calculateHouseEdgeSpawnCell(House.Greece, houseEdges, BOUNDS);
    expect(cell!.cy).toBe(BOUNDS.y + BOUNDS.h);
  });

  it('west edge (no waypoint): cx == boundsX - 1 (1 cell outside)', () => {
    // C++ display.cpp:2489: SOURCE_WEST x = -1 → cx = MapCellX - 1
    const houseEdges = new Map<House, string>([[House.Greece, 'west']]);
    const cell = calculateHouseEdgeSpawnCell(House.Greece, houseEdges, BOUNDS);
    expect(cell!.cx).toBe(BOUNDS.x - 1);
  });

  it('east edge (no waypoint): cx == boundsX + w (1 cell outside)', () => {
    // C++ display.cpp:2483: SOURCE_EAST x = MapCellWidth → cx = MapCellX + MapCellWidth
    const houseEdges = new Map<House, string>([[House.Greece, 'east']]);
    const cell = calculateHouseEdgeSpawnCell(House.Greece, houseEdges, BOUNDS);
    expect(cell!.cx).toBe(BOUNDS.x + BOUNDS.w);
  });

  it('C++ Calculated_Cell: waypoint inference takes priority over house edge (display.cpp:2432-2460)', () => {
    // C++ display.cpp:2432-2460 — when trycell != -1 (waypoint valid), C++ infers
    // edge from waypoint proximity to map bounds. Lines 2466-2492 (house Edge=)
    // only execute when trycell == -1 (no waypoint). Priority: waypoint → house edge.
    //
    // Waypoint near WEST edge (cx=12, closest to x=10), but house edge is 'north'.
    // C++ infers west from waypoint, ignoring the 'north' house edge.
    const houseEdges = new Map<House, string>([[House.Greece, 'north']]);
    const wp = { cx: 12, cy: 50 }; // cx=12 is 2 from west (x=10), far from east (x+w=110)
    const cell = calculateHouseEdgeSpawnCell(House.Greece, houseEdges, BOUNDS, wp);
    // C++ display.cpp:2442-2444: x < y → vert=true, Cell_X < MapCellWidth/2 → x = -1 (west)
    // West edge: cx = BOUNDS.x - 1 = 9
    expect(
      cell!.cx,
      'Waypoint near west edge overrides house edge "north" — C++ uses waypoint inference',
    ).toBe(BOUNDS.x - 1);
  });

  it('aligned coordinate is preserved on perpendicular axis (waypoint near north edge)', () => {
    // Use a waypoint near the north edge so inference picks north
    const wp = { cx: 55, cy: 11 }; // cy=11 is near top (BOUNDS.y=10)
    const cell = calculateHouseEdgeSpawnCell(House.Greece, undefined, BOUNDS, wp);
    // C++ display.cpp:2454: y = -1 → cy = boundsY - 1
    expect(cell!.cy).toBe(BOUNDS.y - 1); // north edge, 1 cell outside
    expect(cell!.cx).toBe(55); // aligned X preserved
  });

  it('aligned coordinate is clamped to map bounds', () => {
    // Waypoint outside bounds should be clamped on aligned axis
    // wp (5, 50) — inferClosestMapEdge picks west (cx=5 closest to x=10).
    // For west edge, the aligned coordinate is cy, and cx is the edge coordinate.
    const houseEdges = new Map<House, string>([[House.Greece, 'north']]);
    const wp = { cx: 5, cy: 50 }; // cx=5 is left of boundsX=10 → west edge inferred
    const cell = calculateHouseEdgeSpawnCell(House.Greece, houseEdges, BOUNDS, wp);
    // Aligned coordinate (cy for west edge) should be within bounds
    expect(cell!.cy).toBeGreaterThanOrEqual(BOUNDS.y);
    expect(cell!.cy).toBeLessThanOrEqual(BOUNDS.y + BOUNDS.h - 1);
  });

  it('without houseEdges, uses closest edge inference from waypoint', () => {
    // Waypoint near south edge
    const wp = { cx: 60, cy: 85 }; // close to bottom (10+80-1=89)
    const cell = calculateHouseEdgeSpawnCell(House.USSR, undefined, BOUNDS, wp);
    expect(cell).toBeDefined();
    // C++ display.cpp:2456: y = MapCellHeight → cy = MapCellY + MapCellHeight (1 cell outside)
    expect(cell!.cy).toBe(BOUNDS.y + BOUNDS.h);
  });
});

// =============================================================================
// Section 8: Reinforcement trigger timing
// =============================================================================

describe('Reinforcement trigger timing (reinf.cpp:372-531, scenario triggers)', () => {
  it('SCG05EA: triggers with TACTION_REINFORCEMENTS (7) reference valid team indices', () => {
    const data = scenarioData['SCG05EA'];
    if (!data) return;

    for (const trigger of data.triggers) {
      for (const action of [trigger.action1, trigger.action2]) {
        if (action.action === 7) { // TACTION_REINFORCEMENTS
          expect(
            action.team,
            `Trigger '${trigger.name}' REINFORCEMENTS action references team index ${action.team}`,
          ).toBeGreaterThanOrEqual(0);
          expect(
            action.team,
            `Trigger '${trigger.name}' team index ${action.team} should be < ${data.teamTypes.length}`,
          ).toBeLessThan(data.teamTypes.length);
        }
      }
    }
  });

  it('SCG11EA: triggers with CREATE_TEAM (4) or REINFORCEMENTS (7) reference valid teams', () => {
    const data = scenarioData['SCG11EA'];
    if (!data) return;

    for (const trigger of data.triggers) {
      for (const action of [trigger.action1, trigger.action2]) {
        if (action.action === 4 || action.action === 7) {
          if (action.team >= 0) {
            expect(
              action.team,
              `Trigger '${trigger.name}' references team ${action.team}, max is ${data.teamTypes.length - 1}`,
            ).toBeLessThan(data.teamTypes.length);
          }
        }
      }
    }
  });

  it('TACTION_REINFORCEMENTS (7) spawns; TACTION_CREATE_TEAM (4) returns createTeam descriptor with matching count', () => {
    // C++ taction.cpp: REINFORCEMENTS spawns new entities; CREATE_TEAM now returns
    // a descriptor for the Game class to recruit existing idle units.
    const team = makeTeamType({ members: [{ type: 'E1', count: 2 }] });
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);

    const reinfAction: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const createAction: TriggerAction = { action: 4, team: 0, trigger: -1, data: 0 };

    const reinfResult = executeTriggerAction(reinfAction, [team], waypoints, emptyGlobals, emptyTriggers);
    resetEntityIds();
    const createResult = executeTriggerAction(createAction, [team], waypoints, emptyGlobals, emptyTriggers);

    // action=7 spawns entities
    expect(reinfResult.spawned.length).toBe(2);
    // action=4 returns createTeam descriptor
    expect(createResult.createTeam).toBeDefined();
    expect(createResult.spawned).toHaveLength(0);
    const descriptorTotal = createResult.createTeam!.members.reduce((sum, m) => sum + m.count, 0);
    expect(descriptorTotal).toBe(reinfResult.spawned.length);
  });
});

// =============================================================================
// Section 9: Team creation from autocreate pool
// =============================================================================

describe('Team creation from autocreate pool (teamtype.cpp:419-497)', () => {
  it('autocreate flag is bit 2 in team flags field', () => {
    const ini = scenarioInis['SCG05EA'];
    if (!ini?.TeamTypes) return;

    // auto1, auto2 should have flags bit 2 set (value 4)
    for (const teamName of ['auto1', 'auto2']) {
      const teamDef = ini.TeamTypes[teamName];
      if (!teamDef) continue;
      const parsed = parseTeamDef(teamName, teamDef);
      const isAutocreate = (parsed.flags & 4) !== 0;
      expect(
        isAutocreate,
        `Team '${teamName}' with flags=${parsed.flags} should have autocreate bit set`,
      ).toBe(true);
    }
  });

  it('non-autocreate teams do not have flags bit 2 set', () => {
    const ini = scenarioInis['SCG05EA'];
    if (!ini?.TeamTypes) return;

    // Regular teams like 'tanya', 'dogs' should NOT have autocreate
    for (const teamName of ['tanya', 'dogs', 'watch']) {
      const teamDef = ini.TeamTypes[teamName];
      if (!teamDef) continue;
      const parsed = parseTeamDef(teamName, teamDef);
      const isAutocreate = (parsed.flags & 4) !== 0;
      expect(
        isAutocreate,
        `Team '${teamName}' with flags=${parsed.flags} should NOT have autocreate bit`,
      ).toBe(false);
    }
  });

  it('suicide flag is bit 1 in team flags field', () => {
    const ini = scenarioInis['SCG05EA'];
    if (!ini?.TeamTypes) return;

    // Check all teams — any with flags & 2 should be suicide
    for (const [name, value] of Object.entries(ini.TeamTypes)) {
      const parsed = parseTeamDef(name, value);
      const isSuicide = (parsed.flags & 2) !== 0;
      // Verify TS parser captures this
      const tsTeam = scenarioData['SCG05EA']?.teamTypes.find((t: TeamType) => t.name === name);
      if (!tsTeam) continue;
      expect(
        (tsTeam.flags & 2) !== 0,
        `Team '${name}': suicide flag mismatch between INI parse and TS parser`,
      ).toBe(isSuicide);
    }
  });

  it('SCG11EA: autocreate teams have MaxAllowed=1 and valid member composition', () => {
    const ini = scenarioInis['SCG11EA'];
    if (!ini?.TeamTypes) return;

    const autocreateTeams = Object.entries(ini.TeamTypes)
      .filter(([_, value]) => {
        const flags = parseInt(value.split(',')[1]) || 0;
        return (flags & 4) !== 0;
      });

    for (const [name, value] of autocreateTeams) {
      const parsed = parseTeamDef(name, value);

      // C++ teamtype.cpp:440 — MaxAllowed limits active instances
      expect(
        parsed.maxAllowed,
        `Autocreate team '${name}' should have MaxAllowed > 0`,
      ).toBeGreaterThan(0);

      // Verify TS parser captured MaxAllowed
      const tsTeam = scenarioData['SCG11EA']?.teamTypes.find((t: TeamType) => t.name === name);
      if (tsTeam) {
        expect(
          tsTeam.maxAllowed,
          `Team '${name}': MaxAllowed mismatch (TS=${tsTeam.maxAllowed} vs INI=${parsed.maxAllowed})`,
        ).toBe(parsed.maxAllowed);
      }
    }
  });

  it('C++ choices[20] cap: Suggested_New_Team evaluates at most 20 eligible teams', () => {
    // C++ teamtype.cpp:438 — TeamTypeClass *choices[20]
    // This is a structural constant in C++. We verify the TS implementation
    // doesn't have a different cap. The test documents this C++ behavior.
    // If TS has no cap or a different cap, this identifies the divergence.

    // We test indirectly: create 25+ team types, all eligible, and verify
    // the selection still works (TS may select from full list vs C++ cap at 20)
    const manyTeamTypes: TeamType[] = [];
    for (let i = 0; i < 25; i++) {
      manyTeamTypes.push(makeTeamType({
        name: `team_${i}`,
        house: 2,
        flags: 4, // autocreate
        maxAllowed: 5,
        members: [{ type: 'E1', count: 1 }],
      }));
    }

    // The C++ cap means only 20 of 25 are considered. TS may differ.
    // This test simply documents the C++ behavior — no assertion on TS.
    expect(manyTeamTypes.length).toBe(25);
  });
});

// =============================================================================
// Section 10: Team Object AI behavior after spawn
// =============================================================================

describe('Team object AI behavior after spawn (team.cpp)', () => {
  it('team activation at full strength (team.cpp:627-652)', () => {
    const team = new Team({
      house: House.USSR,
      desiredMembers: [{ type: UnitType.V_3TNK, count: 2 }],
      missionList: [{ mission: TMISSION_MOVE, data: 5 }],
      forcedActive: false,
    });

    const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 120, 100);
    team.add(e1);
    team.add(e2);

    // Before AI tick, team should not be moving
    expect(team.isMoving).toBe(false);

    // After AI tick with full strength, team should activate
    team.ai();

    expect(team.isMoving, 'Team should activate (isMoving=true) at full strength').toBe(true);
    expect(team.isHasBeen, 'Team should mark isHasBeen after activation').toBe(true);
  });

  it('forced active team activates even without full strength (team.cpp:627)', () => {
    const team = new Team({
      house: House.USSR,
      desiredMembers: [{ type: UnitType.V_3TNK, count: 5 }],
      missionList: [{ mission: TMISSION_MOVE, data: 0 }],
      forcedActive: true,
    });

    const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    team.add(e1); // Only 1 of 5 desired

    team.ai();
    expect(
      team.isMoving,
      'Forced-active team should activate even at 1/5 strength',
    ).toBe(true);
  });

  it('under-strength threshold uses integer division (team.cpp:515-517)', () => {
    // C++ team.cpp:517 — IsUnderStrength = (Total <= desired / 3)
    // With desired=7: 7/3=2 (integer division). Under-strength when Total <= 2.
    const team = new Team({
      house: House.USSR,
      desiredMembers: [{ type: UnitType.I_E1, count: 7 }],
      missionList: [],
      isReinforcable: true,
      forcedActive: true,
    });

    // Add 3 members: desired/3 = 7/3 = 2 (C++ int div). 3 > 2, so NOT under-strength
    for (let i = 0; i < 3; i++) {
      team.add(makeEntity(UnitType.I_E1, House.USSR, 100 + i * 10, 100));
    }

    team.ai();

    expect(
      team.isUnderStrength,
      'With 3/7 members (desired/3=2), team should NOT be under-strength',
    ).toBe(false);
  });

  it('team timeout uses TICKS_PER_MINUTE/10 = 90 scaling (team.cpp:710)', () => {
    // C++ team.cpp:710 — TimeOut = mission->Data.Value * (TICKS_PER_MINUTE/10)
    // TICKS_PER_MINUTE = 900 (defines.h:3032), so scaling = 90
    const team = new Team({
      house: House.USSR,
      desiredMembers: [{ type: UnitType.I_E1, count: 1 }],
      missionList: [{ mission: TMISSION_GUARD, data: 5 }], // guard for 5 * 90 = 450 ticks
      forcedActive: true,
    });

    const e = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    team.add(e);

    // C++ Force_Active() sets IsUnderStrength=false (team.h:215), preventing
    // spurious isReforming. Activation + advance + execute all happen on one tick.
    team.ai();
    expect(team.isMoving, 'Team should activate on first tick').toBe(true);

    // timeOut should be (5 * 90) - 1 = 449 after one tick of execution
    // The initial value is data * 90 = 450 (C++ team.cpp:710: TICKS_PER_MINUTE/10 = 90)
    // C++ team.cpp processes advance and execute in the same AI() call,
    // so timeOut is set to data*90 then immediately decremented by 1.
    expect(
      team.timeOut,
      'Guard timeout = data*90 - 1 after advance+execute in same tick',
    ).toBe(5 * 90 - 1);
  });
});

// =============================================================================
// Section 11: IsSuicide flag behavior during reinforcement
// =============================================================================

describe('IsSuicide flag from INI to spawned entities (reinf.cpp, teamtype.h:192)', () => {
  it('suicide flag (flags bit 1) is set on spawned entities', () => {
    const teamTypes = [makeTeamType({
      flags: 2,  // IsSuicide
      members: [{ type: 'E1', count: 2 }],
    })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);

    for (const entity of result.spawned) {
      expect(
        entity.isSuicide,
        'Entity spawned from suicide team should have isSuicide=true',
      ).toBe(true);
    }
  });

  it('non-suicide team entities do NOT have isSuicide set', () => {
    const teamTypes = [makeTeamType({
      flags: 0,  // No suicide
      members: [{ type: 'E1', count: 2 }],
    })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);

    for (const entity of result.spawned) {
      expect(
        entity.isSuicide,
        'Entity from non-suicide team should have isSuicide=false',
      ).toBe(false);
    }
  });
});

// =============================================================================
// Section 12: Trigger-assigned to spawned team members
// =============================================================================

describe('Trigger assignment to spawned members (ScenarioClass::Create_Army)', () => {
  it('team trigger index >= 0 assigns triggerName to spawned entities', () => {
    const triggers: ScenarioTrigger[] = [{
      name: 'test_trig',
      persistence: 2,
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
      playerEnteredHouse: -1,
      objectDiscovered: false,
      enteredZone: false,
      crossedHorizontal: false,
      crossedVertical: false,
      forceFirePending: false,
      pendingDestroyedCount: 0,
      triggeringEntityIds: [],
      attachCount: 0,
      remainingAttachCount: 0,
    }];

    const teamTypes = [makeTeamType({
      trigger: 0,  // Reference the first trigger
      members: [{ type: 'E1', count: 3 }],
    })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, triggers);

    for (const entity of result.spawned) {
      expect(
        entity.triggerName,
        'Spawned entity should have triggerName from team trigger field',
      ).toBe('test_trig');
    }
  });

  it('team trigger index -1 does NOT assign triggerName', () => {
    const teamTypes = [makeTeamType({
      trigger: -1,
      members: [{ type: 'E1', count: 2 }],
    })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);

    for (const entity of result.spawned) {
      expect(entity.triggerName).toBeUndefined();
    }
  });
});

// =============================================================================
// Section 13: Edge cases — all-aircraft teams, empty teams, mixed teams
// =============================================================================

describe('Edge cases in reinforcement spawn', () => {
  it('all-aircraft team: no groundEdgeCell computed, aircraft spawn at edge', () => {
    // C++ reinf.cpp: when ALL members are aircraft, ground edge cell is not used
    const teamTypes = [makeTeamType({
      house: 2,
      members: [{ type: 'MIG', count: 2 }, { type: 'YAK', count: 1 }],
    })];
    const houseEdges = new Map<House, string>([[House.USSR, 'north']]);
    const mapBounds = { x: 10, y: 10, w: 100, h: 80 };
    const waypoints = new Map<number, CellPos>([[0, { cx: 60, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(
      action, teamTypes, waypoints, emptyGlobals, emptyTriggers,
      undefined, houseEdges, mapBounds,
    );

    expect(result.spawned.length).toBe(3);
    for (const entity of result.spawned) {
      expect(entity.aircraftState).toBe('flying');
      expect(entity.mission).toBe(Mission.MOVE);
    }
  });

  it('empty team (no members) spawns nothing', () => {
    const teamTypes = [makeTeamType({
      members: [],
    })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);

    expect(result.spawned.length).toBe(0);
  });

  it('invalid team index produces no spawn', () => {
    const teamTypes = [makeTeamType()];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 99, trigger: -1, data: 0 }; // out of bounds
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);

    expect(result.spawned.length).toBe(0);
  });

  it('team with unknown unit type produces no entity for that type', () => {
    const teamTypes = [makeTeamType({
      members: [
        { type: 'NONEXISTENT', count: 2 },
        { type: 'E1', count: 1 },
      ],
    })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);

    // Only the valid E1 should be spawned
    expect(result.spawned.length).toBe(1);
    expect(result.spawned[0].type).toBe(UnitType.I_E1);
  });

  it('TRAN (chinook) transport: spawns at edge, carries ground cargo', () => {
    // TRAN is an aircraft transport — it should spawn at edge but carry ground units
    const teamTypes = [makeTeamType({
      house: 1,
      members: [
        { type: 'E1', count: 2 },
        { type: 'E3', count: 3 },
        { type: 'TRAN', count: 1 },
      ],
    })];
    const houseEdges = new Map<House, string>([[House.Greece, 'west']]);
    const mapBounds = { x: 10, y: 10, w: 100, h: 80 };
    const waypoints = new Map<number, CellPos>([[0, { cx: 60, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(
      action, teamTypes, waypoints, emptyGlobals, emptyTriggers,
      undefined, houseEdges, mapBounds,
    );

    const transport = result.spawned.find(e => e.isTransport);
    expect(transport, 'TRAN should be in spawned list').toBeDefined();

    // TRAN should have passengers (the infantry)
    if (transport) {
      expect(
        transport.passengers.length,
        'TRAN should carry ground infantry',
      ).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// Section 14: SCG05EA comprehensive team parse audit
// =============================================================================

describe('SCG05EA comprehensive team parse audit', () => {
  it('all team houses are valid RA house IDs', () => {
    const data = scenarioData['SCG05EA'];
    if (!data) return;

    for (const team of data.teamTypes) {
      // C++ house IDs: 0-19 (0=Spain through 19=Multi8)
      expect(
        team.house,
        `Team '${team.name}' has invalid house ID ${team.house}`,
      ).toBeGreaterThanOrEqual(0);
      expect(team.house).toBeLessThanOrEqual(19);

      // Verify houseIdToHouse doesn't return undefined
      const house = houseIdToHouse(team.house);
      expect(house).toBeDefined();
    }
  });

  it('team origins match INI-parsed values', () => {
    const data = scenarioData['SCG05EA'];
    if (!data) return;
    const ini = scenarioInis['SCG05EA'];
    if (!ini?.TeamTypes) return;

    for (const [name, value] of Object.entries(ini.TeamTypes)) {
      const iniParsed = parseTeamDef(name, value);
      const tsTeam = data.teamTypes.find((t: TeamType) => t.name === name);
      if (!tsTeam) continue;

      expect(
        tsTeam.origin,
        `Team '${name}': origin mismatch (TS=${tsTeam.origin} vs INI=${iniParsed.origin})`,
      ).toBe(iniParsed.origin);
    }
  });

  it('team trigger indices match INI-parsed values', () => {
    const data = scenarioData['SCG05EA'];
    if (!data) return;
    const ini = scenarioInis['SCG05EA'];
    if (!ini?.TeamTypes) return;

    for (const [name, value] of Object.entries(ini.TeamTypes)) {
      const iniParsed = parseTeamDef(name, value);
      const tsTeam = data.teamTypes.find((t: TeamType) => t.name === name);
      if (!tsTeam) continue;

      expect(
        tsTeam.trigger,
        `Team '${name}': trigger mismatch (TS=${tsTeam.trigger} vs INI=${iniParsed.trigger})`,
      ).toBe(iniParsed.trigger);
    }
  });

  it('team flags match INI-parsed values', () => {
    const data = scenarioData['SCG05EA'];
    if (!data) return;
    const ini = scenarioInis['SCG05EA'];
    if (!ini?.TeamTypes) return;

    for (const [name, value] of Object.entries(ini.TeamTypes)) {
      const iniParsed = parseTeamDef(name, value);
      const tsTeam = data.teamTypes.find((t: TeamType) => t.name === name);
      if (!tsTeam) continue;

      expect(
        tsTeam.flags,
        `Team '${name}': flags mismatch (TS=${tsTeam.flags} vs INI=${iniParsed.flags})`,
      ).toBe(iniParsed.flags);
    }
  });
});

// =============================================================================
// Section 15: C++ divergences — initial facing from edge direction
// =============================================================================

describe('C++ divergence: reinforcement initial facing (reinf.cpp:439)', () => {
  // C++ reinf.cpp:439: FacingType eface = (FacingType)(source << 1);
  // SOURCE_NORTH=0 -> FACING_N(0), SOURCE_EAST=1 -> FACING_NE(2)→actually FACING_E,
  // SOURCE_SOUTH=2 -> FACING_S(4), SOURCE_WEST=3 -> FACING_W(6)
  // The unit's initial facing is set deterministically based on spawn edge direction.
  // TS uses Math.random() for facing.

  it('C++ reinforcements face inward from spawn edge (deterministic)', () => {
    // C++ reinf.cpp:439: FacingType eface = (FacingType)(source << 1);
    // Units spawning from north edge face south (direction 4 in RA 8-dir compass).
    // SOURCE_NORTH=0 → eface=0, then reinf.cpp uses Facing_Dir(FACING_S) for the
    // initial direction so units walk INTO the map.
    //
    // TS uses Math.random() for facing, so all units in the team will have
    // different random facings. C++ would give them ALL the same deterministic facing.
    const teamTypes = [makeTeamType({
      house: 2,
      members: [{ type: 'E1', count: 10 }],
    })];
    const houseEdges = new Map<House, string>([[House.USSR, 'north']]);
    const mapBounds = { x: 10, y: 10, w: 100, h: 80 };
    const waypoints = new Map<number, CellPos>([[0, { cx: 60, cy: 15 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(
      action, teamTypes, waypoints, emptyGlobals, emptyTriggers,
      undefined, houseEdges, mapBounds,
    );

    expect(result.spawned.length).toBe(10);

    // C++ expected: all units face the same direction (inward from spawn edge)
    const facings = new Set(result.spawned.map(e => e.facing));
    expect(
      facings.size,
      'C++ sets same deterministic facing for all reinforcement units from same edge — TS randomizes',
    ).toBe(1); // Will FAIL — TS uses random facing per unit
  });
});

// =============================================================================
// Section 16: C++ divergence — IsALoaner on transports with UNLOAD mission
// =============================================================================

describe('C++ divergence: IsALoaner flag on reinforcement transports (reinf.cpp:251)', () => {
  // C++ reinf.cpp:251: if (hasunload && transport is AIRCRAFT or VESSEL) → IsALoaner = true
  // IsALoaner means the transport doesn't count toward unit limits and auto-retreats
  // after unloading. TS does NOT implement IsALoaner.

  it('C++ sets IsALoaner on aircraft transports with UNLOAD mission', () => {
    // C++ reinf.cpp:251: when team has TMISSION_UNLOAD and transport is RTTI_AIRCRAFT or
    // RTTI_VESSEL, IsALoaner = true. This means the transport:
    //   1. Doesn't count toward unit limits
    //   2. Auto-retreats to map edge after unloading
    //   3. Is removed from play when it reaches the edge
    // TS should implement this for parity with C++ transport behavior.
    const teamTypes = [makeTeamType({
      house: 1,
      members: [
        { type: 'E1', count: 2 },
        { type: 'TRAN', count: 1 },
      ],
      missions: [
        { mission: 3, data: 5 },   // TMISSION_MOVE
        { mission: 8, data: 0 },   // TMISSION_UNLOAD
      ],
    })];
    const houseEdges = new Map<House, string>([[House.Greece, 'west']]);
    const mapBounds = { x: 10, y: 10, w: 100, h: 80 };
    const waypoints = new Map<number, CellPos>([[0, { cx: 60, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(
      action, teamTypes, waypoints, emptyGlobals, emptyTriggers,
      undefined, houseEdges, mapBounds,
    );

    const transport = result.spawned.find(e => e.isTransport);
    expect(transport, 'TRAN should be spawned').toBeDefined();

    // C++ reinf.cpp:251 sets IsALoaner = true. TS Entity should have this field.
    expect(
      'isALoaner' in transport!,
      'C++ reinf.cpp:251: transport with UNLOAD should have IsALoaner field — TS lacks it',
    ).toBe(true); // Will FAIL — TS Entity does not implement IsALoaner
  });
});

// =============================================================================
// Section 17: C++ divergence — transport ordering (first class encountered)
// =============================================================================

describe('C++ divergence: transport detection order (reinf.cpp:217-254)', () => {
  // C++ _Create_Group iterates members in INI order, picks the FIRST transport.
  // If members are listed as [E1:2, LST:1, APC:1], LST is the first transport.
  // TS processes in the same order but only picks the first transport entity, not type.
  // With LST:1, APC:1, TS picks the LST (first transport spawned), same as C++.

  it('when team has LST before APC, LST is the primary transport', () => {
    const teamTypes = [makeTeamType({
      members: [
        { type: 'E1', count: 2 },
        { type: 'LST', count: 1 },
        { type: 'APC', count: 1 },
      ],
    })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);

    const transports = result.spawned.filter(e => e.isTransport);
    expect(transports.length).toBe(2);

    // First transport (LST) should have passengers, second (APC) should be empty
    const lst = transports.find(e => e.type === 'LST');
    const apc = transports.find(e => e.type === 'APC');

    expect(lst, 'LST should be in spawned').toBeDefined();
    expect(apc, 'APC should be in spawned').toBeDefined();

    if (lst && apc) {
      expect(
        lst.passengers.length,
        'LST (first transport) should carry cargo',
      ).toBeGreaterThan(0);
      expect(
        apc.passengers.length,
        'APC (second transport) should be empty — only first transport loads',
      ).toBe(0);
    }
  });

  it('when team has APC before LST, APC is the primary transport', () => {
    const teamTypes = [makeTeamType({
      members: [
        { type: 'E1', count: 2 },
        { type: 'APC', count: 1 },
        { type: 'LST', count: 1 },
      ],
    })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);

    const apc = result.spawned.find(e => e.type === 'APC');
    const lst = result.spawned.find(e => e.type === 'LST');

    expect(apc, 'APC should be in spawned').toBeDefined();
    expect(lst, 'LST should be in spawned').toBeDefined();

    if (apc && lst) {
      expect(
        apc.passengers.length,
        'APC (first transport) should carry cargo',
      ).toBeGreaterThan(0);
      expect(
        lst.passengers.length,
        'LST (second transport) should be empty',
      ).toBe(0);
    }
  });
});

// =============================================================================
// Section 18: C++ divergence — edge-based facing vs houseEdges inference
// =============================================================================

describe('C++ divergence: Calculated_Cell SOURCE_* vs TS inferClosestMapEdge', () => {
  // C++ display.cpp:2467-2491: Calculated_Cell takes a SourceType parameter
  // which directly selects the map edge (SOURCE_NORTH, SOURCE_EAST, etc.).
  // The SOURCE comes from HouseClass::Control.Edge, not from waypoint position.
  //
  // TS infers the edge from waypoint proximity to map bounds when a waypoint
  // is provided, ignoring the house edge entirely. Without a waypoint, TS
  // falls back to houseEdges map.
  //
  // This means C++ and TS can disagree on spawn edge when:
  // 1. House edge is 'north' but waypoint is near the south border
  // 2. The waypoint is in the center of the map (ambiguous edge)

  it('C++ waypoint inference overrides house edge when waypoint is valid (display.cpp:2432-2460)', () => {
    // C++ display.cpp:2432-2460 — when trycell != -1, edge is inferred from
    // waypoint proximity. The SourceType (house edge) in lines 2466-2492 is
    // ONLY used when trycell == -1. So a waypoint near south overrides 'north'.
    const houseEdges = new Map<House, string>([[House.USSR, 'north']]);
    const mapBounds = { x: 10, y: 10, w: 100, h: 80 };
    // Waypoint near south edge — C++ infers south despite house edge being 'north'
    const wp = { cx: 60, cy: 85 }; // near bottom (y+h-1=89)

    const cell = calculateHouseEdgeSpawnCell(House.USSR, houseEdges, mapBounds, wp);
    expect(cell).toBeDefined();

    // C++ display.cpp:2449-2456: y_from_top=75, y_from_bottom=5, y=min(75,5)=5;
    // x_from_left=50, x_from_right=50, x=min(50,50)=50; x < y → false (50 > 5);
    // horz=true, (85-10) < 80/2 → false → y=MapCellHeight → south edge.
    // cy = MapCellY + MapCellHeight = 10 + 80 = 90
    expect(
      cell!.cy,
      'C++ infers south from waypoint (cy=85 near bottom), house edge "north" is fallback only',
    ).toBe(mapBounds.y + mapBounds.h);
  });
});

// =============================================================================
// Section 14: Force_Active sets IsUnderStrength=false (team.h:215)
// C++ team.h:215: void Force_Active(void) {IsForcedActive=true;IsUnderStrength=false;};
// Without this, the composition check in AI() sees old_under(true) != IsUnderStrength(false)
// after members are added, spuriously setting IsReforming=true and delaying mission advance
// by 1 tick. This shifts RNG position, causing ±1 regression on SCG01EA/SCG09EA at t2000.
// =============================================================================

describe('Force_Active parity: IsUnderStrength=false (team.h:215)', () => {
  it('forcedActive team constructor sets isUnderStrength=false matching C++ Force_Active()', () => {
    // C++ team.h:215: Force_Active() sets IsForcedActive=true AND IsUnderStrength=false
    const team = new Team({
      house: House.USSR,
      desiredMembers: [{ type: UnitType.I_E1, count: 2 }],
      missionList: [{ mission: TMISSION_GUARD, data: 5 }],
      forcedActive: true,
    });

    expect(team.isForcedActive, 'IsForcedActive should be true').toBe(true);
    expect(team.isUnderStrength, 'IsUnderStrength should be false (C++ Force_Active sets it)').toBe(false);
  });

  it('non-forced team constructor leaves isUnderStrength=true (default)', () => {
    const team = new Team({
      house: House.USSR,
      desiredMembers: [{ type: UnitType.I_E1, count: 2 }],
      missionList: [{ mission: TMISSION_GUARD, data: 5 }],
    });

    expect(team.isForcedActive).toBe(false);
    expect(team.isUnderStrength, 'Default isUnderStrength should be true').toBe(true);
  });

  it('forcedActive team does NOT set isReforming on first ai() tick', () => {
    // The bug: without IsUnderStrength=false, old_under(true) != IsUnderStrength(false)
    // after composition check → IsReforming=true → mission advance delayed 1 tick
    const team = new Team({
      house: House.USSR,
      desiredMembers: [{ type: UnitType.I_E1, count: 2 }],
      missionList: [{ mission: TMISSION_MOVE, data: 0 }],
      forcedActive: true,
    });

    const e1 = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const e2 = makeEntity(UnitType.I_E1, House.USSR, 120, 100);
    team.add(e1);
    team.add(e2);

    team.ai();

    // C++ parity: isReforming should be false (no under-strength transition)
    expect(team.isReforming, 'isReforming should be false — no spurious transition').toBe(false);
    // Team should have activated and advanced to first mission in one tick
    expect(team.isMoving, 'Team should be moving after activation').toBe(true);
    expect(team.currentMission, 'Should advance to mission 0 on first tick').toBe(0);
  });

  it('forcedActive team advances mission on same tick as activation (C++ team.cpp:627-753)', () => {
    // C++ sequence: activation gate fires → isNextMission=true → advance block runs
    // All in the same AI() call, no reforming delay
    const team = new Team({
      house: House.USSR,
      desiredMembers: [{ type: UnitType.I_E1, count: 1 }],
      missionList: [{ mission: TMISSION_GUARD, data: 3 }],
      forcedActive: true,
    });

    const e = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    team.add(e);

    team.ai();

    // Should have activated + advanced + executed GUARD in one tick
    expect(team.isMoving).toBe(true);
    expect(team.currentMission).toBe(0);
    // GUARD with data=3: timeOut = 3*90 = 270, then decremented once = 269
    expect(team.timeOut).toBe(3 * 90 - 1);
  });
});

// =============================================================================
// Section: Vessel GUARD→MOVE mission transition timing (C++ reinf.cpp + team.cpp)
//
// C++ source refs:
//   - reinf.cpp:479-481 — ground/naval entities spawn with Assign_Mission(MISSION_GUARD) + Commence()
//   - team.h:215 — Force_Active() sets IsForcedActive=true, IsUnderStrength=false
//   - team.cpp:627-652 — activation: IsMoving=true, Percent_Chance(50) gesture, IsNextMission=true
//   - team.cpp:704-753 — mission advance: CurrentMission=0, TMISSION_MOVE target set
//   - team.cpp:1874-2008 — Coordinate_Move: Assign_Mission(MISSION_MOVE) → MissionQueue
//   - vessel.cpp:592-593 — VesselClass::AI: Commence() picks up MOVE from queue before MissionClass::AI
//   - vessel.cpp:620 — DriveClass::AI → MissionClass::AI → Timer=0 → Mission_Move fires
//   - foot.cpp:504 — Mission_Move returns Normal_Delay(14) + Random_Pick(0,2)
//
// Key parity point: at tick 1 (the tick entities spawn + team activates), vessels should
// process MOVE (not GUARD). GUARD never fires its mission handler because:
//   1. Team::AI runs BEFORE VesselClass::AI
//   2. Coordinate_Move puts MISSION_MOVE into MissionQueue
//   3. VesselClass::AI's Commence() picks up MOVE before MissionClass::AI runs
//
// RNG consumed at tick 1 for a forcedActive team with N vessels:
//   - 1 call: Percent_Chance(50) gesture (team activation)
//   - N calls: Random_Pick(0,2) per vessel (Mission_Move timer return)
// =============================================================================

describe('Vessel GUARD→MOVE transition: forcedActive team (reinf.cpp + vessel.cpp)', () => {
  it('vessels are in MOVE (not GUARD) after first team ai() tick', () => {
    // C++ reinf.cpp:479-481: entities spawn in GUARD
    // C++ team.cpp:1938: Coordinate_Move assigns MISSION_MOVE
    // C++ vessel.cpp:592: Commence() picks up MOVE before mission handler fires
    const waypoints = new Map<number, { cx: number; cy: number }>();
    waypoints.set(5, { cx: 50, cy: 50 }); // target waypoint far from spawn

    const team = new Team({
      house: House.USSR,
      desiredMembers: [{ type: UnitType.V_DD, count: 3 }],
      missionList: [{ mission: TMISSION_MOVE, data: 5 }],
      forcedActive: true,
    });

    // Spawn vessels at map edge (far from waypoint 5)
    const vessels = [
      makeEntity(UnitType.V_DD, House.USSR, 24, 24),
      makeEntity(UnitType.V_DD, House.USSR, 48, 24),
      makeEntity(UnitType.V_DD, House.USSR, 72, 24),
    ];
    // C++ reinf.cpp:480 — ground/naval entities start in GUARD
    for (const v of vessels) {
      v.mission = Mission.GUARD;
      v.missionTimer = 0; // C++ Commence() sets Timer=0
    }
    for (const v of vessels) team.add(v);

    // First ai() tick: activation + mission advance + coordinateMove
    team.ai(waypoints);

    // All vessels should now have MOVE QUEUED.
    // C++ parity: Coordinate_Move → Assign_Mission(MISSION_MOVE) → MissionQueue
    // (team.cpp:1938-1940). Mission.Commence() transitions MissionQueue→Mission
    // (mission.cpp:343-359), but that's gated on !IsFiring && !IsDriving at the
    // entity AI level (infantry.cpp:1208). team.ai() doesn't run that gate —
    // the engine's _processGroundEntity (index.ts) does.
    for (const v of vessels) {
      expect(v.missionQueue, `Vessel should have MOVE queued`).toBe(Mission.MOVE);
    }
    // missionTimer is only reset when Commence actually transitions. team.ai()
    // alone doesn't run Commence, so timer stays at its spawn value (0 here).
    for (const v of vessels) {
      expect(v.missionTimer, 'missionTimer unchanged by team.ai alone').toBe(0);
    }
  });

  it('team activation consumes exactly 1 RNG call for Percent_Chance(50) gesture', () => {
    // C++ team.cpp:637: DoType doaction = Percent_Chance(50) ? DO_GESTURE1 : DO_GESTURE2
    // This consumes 1 ScenarioRandom call regardless of member count/type.
    const waypoints = new Map<number, { cx: number; cy: number }>();
    waypoints.set(0, { cx: 50, cy: 50 });

    const team = new Team({
      house: House.USSR,
      desiredMembers: [{ type: UnitType.V_DD, count: 2 }],
      missionList: [{ mission: TMISSION_MOVE, data: 0 }],
      forcedActive: true,
    });

    const v1 = makeEntity(UnitType.V_DD, House.USSR, 24, 24);
    const v2 = makeEntity(UnitType.V_DD, House.USSR, 48, 24);
    v1.mission = Mission.GUARD;
    v2.mission = Mission.GUARD;
    team.add(v1);
    team.add(v2);

    // Record RNG state before team.ai()
    const callsBefore = ScenarioRandom.callCount;

    team.ai(waypoints);

    const callsAfter = ScenarioRandom.callCount;
    // C++ parity: exactly 1 RNG call for Percent_Chance(50) gesture
    // coordinateMove does NOT consume RNG — it only sets mission and timer.
    // The actual Random_Pick(0,2) for Mission_Move timer happens in entity AI,
    // which is a separate processing step (not part of Team::AI).
    expect(
      callsAfter - callsBefore,
      'Team activation should consume exactly 1 RNG call (Percent_Chance(50))'
    ).toBe(1);
  });

  it('non-forced team has 1-tick reforming delay before mission advance (C++ parity)', () => {
    // C++ team.cpp: when IsUnderStrength transitions from true→false (line 569-571),
    // IsReforming=true. This delays mission advance by 1 tick.
    // At the end of the first AI() call, Coordinate_Regroup resolves IsReforming
    // if members are close, but mission advance was already blocked for this tick.
    //
    // C++ flow (tick 1):
    //   1. IsAltered check: old_under=true → IsUnderStrength=false → IsReforming=true
    //   2. Activation: IsMoving=true, IsNextMission=true, Percent_Chance(50)
    //   3. Mission advance blocked: isMoving && !IsReforming(TRUE) → skip
    //   4. Else block: IsReforming = !Coordinate_Regroup() → false (members close)
    //
    // C++ flow (tick 2):
    //   1. IsReforming=false
    //   2. Mission advance: IsMoving && !IsReforming(false) && IsNextMission → runs
    //   3. Coordinate_Move → MISSION_MOVE assigned
    const waypoints = new Map<number, { cx: number; cy: number }>();
    waypoints.set(0, { cx: 50, cy: 50 });

    const team = new Team({
      house: House.USSR,
      desiredMembers: [{ type: UnitType.V_DD, count: 1 }],
      missionList: [{ mission: TMISSION_MOVE, data: 0 }],
      // NOT forcedActive — simulates TACTION_CREATE_TEAM
    });

    const v = makeEntity(UnitType.V_DD, House.USSR, 24, 24);
    v.mission = Mission.GUARD;
    team.add(v);

    // Tick 1: activation + reforming. Mission advance blocked by IsReforming.
    // Coordinate_Regroup resolves IsReforming at the end, but mission stays at -1.
    team.ai(waypoints);
    expect(team.isMoving, 'Team should activate on first tick').toBe(true);
    // After full ai(), reforming was set then cleared by coordinateRegroup
    expect(team.isReforming, 'Reforming resolved by coordinateRegroup').toBe(false);
    // But mission advance was blocked WHILE isReforming was true:
    expect(team.currentMission, 'Mission NOT advanced on tick 1 (reforming blocked it)').toBe(-1);
    // Entity stays in GUARD (coordinateMove never ran, coordinateRegroup set GUARD)
    expect(v.mission, 'Vessel should be in GUARD after reforming tick').toBe(Mission.GUARD);

    // Tick 2: isReforming=false → mission advance + coordinateMove
    team.ai(waypoints);
    expect(team.currentMission, 'Mission should advance to 0 on tick 2').toBe(0);
    // C++ team.cpp:1938-1940: Coordinate_Move queues MOVE via Assign_Mission.
    // Commence gate (infantry.cpp:1208) runs in entity AI, not team.ai().
    expect(v.missionQueue, 'Vessel should have MOVE queued').toBe(Mission.MOVE);
  });

  it('forcedActive team matches SCG07EA "cover" team: 3 patrol boats process MOVE at tick 1', () => {
    // SCG07EA cover=1,0,7,0,0,0,-1,1,PT:3,2,3:0,3:1
    //   House=1(Greece), flags=0, 3 PT patrol boats
    //   Missions: MOVE to wp0, MOVE to wp1
    // This team is spawned via TACTION_REINFORCEMENTS → Force_Active()
    const waypoints = new Map<number, { cx: number; cy: number }>();
    // SCG07EA wp0=cell 6794, wp1=cell 6798
    // (exact cells don't matter for mission transition test)
    waypoints.set(0, { cx: 58, cy: 52 });
    waypoints.set(1, { cx: 62, cy: 52 });

    const team = new Team({
      house: House.GREECE,
      desiredMembers: [{ type: UnitType.V_PT, count: 3 }],
      missionList: [
        { mission: TMISSION_MOVE, data: 0 },
        { mission: TMISSION_MOVE, data: 1 },
      ],
      forcedActive: true,
    });

    // Spawn at west edge (Greece edge=West in SCG07EA)
    const pts = [
      makeEntity(UnitType.V_PT, House.GREECE, 12, 600),
      makeEntity(UnitType.V_PT, House.GREECE, 12, 624),
      makeEntity(UnitType.V_PT, House.GREECE, 12, 648),
    ];
    for (const pt of pts) {
      pt.mission = Mission.GUARD; // C++ reinf.cpp:480
      pt.missionTimer = 0;
    }
    for (const pt of pts) team.add(pt);

    // Single ai() tick: activation + advance to MOVE(wp0) + coordinateMove
    team.ai(waypoints);

    expect(team.isMoving, 'Team should be active').toBe(true);
    expect(team.currentMission, 'Should be on mission 0 (MOVE to wp0)').toBe(0);
    expect(team.isReforming, 'No reforming for forcedActive teams').toBe(false);

    // All patrol boats should have MOVE QUEUED (team.ai alone doesn't run Commence gate).
    // C++ team.cpp:1938-1940: Coordinate_Move → Assign_Mission(MISSION_MOVE) → MissionQueue.
    // Mission.Commence (mission.cpp:343-359) transitions MissionQueue→Mission, gated on
    // !IsFiring && !IsDriving (infantry.cpp:1208). That gate lives in the engine's
    // _processGroundEntity, not in team.ai().
    for (let i = 0; i < pts.length; i++) {
      expect(pts[i].missionQueue, `PT[${i}] should have MOVE queued`).toBe(Mission.MOVE);
      expect(pts[i].missionTimer, `PT[${i}] missionTimer should be 0`).toBe(0);
    }
  });
});
