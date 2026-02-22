/**
 * Scenario loader — parses extracted INI files and sets up the game state.
 * Reads unit placements, waypoints, team types, and triggers from SCA01-04EA.INI.
 */

import { type CellPos, cellIndexToPos, cellToWorld, House, UnitType, GAME_TICKS_PER_SEC } from './types';
import { Entity } from './entity';
import { GameMap, Terrain } from './map';

// === RA Trigger/Team System (from TRIGGER.CPP, TEAMTYPE.CPP) ===

// Trigger event types (TEventType)
const TEVENT_NONE = 0;
const TEVENT_PLAYER_ENTERED = 1;
const TEVENT_TIME = 13;
const TEVENT_GLOBAL_SET = 27;

// Trigger action types (TActionType)
const TACTION_NONE = 0;
const TACTION_WIN = 1;
const TACTION_LOSE = 2;
const TACTION_CREATE_TEAM = 4;
const TACTION_REINFORCEMENTS = 7;
const TACTION_SET_GLOBAL = 28;
const TACTION_FORCE_TRIGGER = 22;

// Team mission types (TeamMissionType)
const TMISSION_ATTACK = 0;
const TMISSION_ATT_WAYPT = 1;
const TMISSION_MOVE = 3;
const TMISSION_GUARD = 5;
const TMISSION_LOOP = 6;

// Time unit: Data.Value is in 1/10th minute increments (6 seconds each)
// Convert to game ticks: value * 6 * GAME_TICKS_PER_SEC
const TIME_UNIT_TICKS = 6 * GAME_TICKS_PER_SEC; // 90 ticks per time unit

export interface TeamMember {
  type: string;   // unit type name (e.g. 'ANT3')
  count: number;
}

export interface TeamMission {
  mission: number;  // TMISSION_* enum
  data: number;     // waypoint or other param
}

export interface TeamType {
  name: string;
  house: number;        // house ID
  origin: number;       // starting waypoint
  members: TeamMember[];
  missions: TeamMission[];
}

export interface TriggerEvent {
  type: number;    // TEVENT_* enum
  team: number;    // team index or -1
  data: number;    // parameter (time value for TIME, global ID for GLOBAL_SET)
}

export interface TriggerAction {
  action: number;  // TACTION_* enum
  team: number;    // team index or -1
  trigger: number; // trigger index or -1
  data: number;    // parameter
}

export interface ScenarioTrigger {
  name: string;
  persistence: number;   // 0=volatile, 1=semi, 2=persistent
  eventControl: number;  // 0=only, 1=and, 2=or
  actionControl: number; // 0=only, 1=and
  event1: TriggerEvent;
  event2: TriggerEvent;
  action1: TriggerAction;
  action2: TriggerAction;
  fired: boolean;         // has this trigger fired?
  timerTick: number;      // game tick when timer started (for TIME events)
}

// === Mission Metadata ===

export interface MissionInfo {
  id: string;        // scenario file ID (e.g. 'SCA01EA')
  title: string;     // display name
  briefing: string;  // pre-mission briefing text
  objective: string; // one-line objective
}

export const MISSIONS: MissionInfo[] = [
  {
    id: 'SCA01EA',
    title: 'It Came From Red Alert!',
    briefing: 'Commander, we have a situation. Giant mutant ants have been spotted near a civilian settlement. Reports indicate they are extremely aggressive and have already overwhelmed a patrol unit. Take your forces and eliminate the ant threat before they spread further. Exercise caution — these creatures are heavily armored.',
    objective: 'Destroy all giant ants in the area.',
  },
  {
    id: 'SCA02EA',
    title: 'The Hive',
    briefing: 'Intelligence has located the primary ant nest. These creatures are breeding at an alarming rate and must be stopped at the source. You have been given a stronger force for this assault. Push into the hive territory and destroy every last ant. Expect heavy resistance.',
    objective: 'Locate and destroy the ant hive.',
  },
  {
    id: 'SCA03EA',
    title: 'The Aftermath',
    briefing: 'Despite our earlier victories, a massive ant swarm has been detected heading toward our forward operating base. Hold your position and repel the assault. Reinforcements are limited — use your forces wisely. We cannot afford to lose this foothold.',
    objective: 'Defend the base and eliminate all attacking ants.',
  },
  {
    id: 'SCA04EA',
    title: 'The Last Stand',
    briefing: 'This is it, Commander. We have tracked the ants to their final stronghold — the queen\'s chamber deep in hostile territory. A full assault force has been assembled. Destroy the queen and every remaining ant to end this threat once and for all. Good luck.',
    objective: 'Destroy the ant queen and all remaining forces.',
  },
];

/** Get mission info by index (0-based) */
export function getMission(index: number): MissionInfo | null {
  return MISSIONS[index] ?? null;
}

/** Get mission index by scenario ID */
export function getMissionIndex(scenarioId: string): number {
  return MISSIONS.findIndex(m => m.id === scenarioId);
}

// === localStorage Progress ===

const PROGRESS_KEY = 'antmissions_progress';

export function loadProgress(): number {
  try {
    const val = localStorage.getItem(PROGRESS_KEY);
    return val ? Math.min(parseInt(val, 10) || 0, MISSIONS.length) : 0;
  } catch {
    return 0;
  }
}

export function saveProgress(completedMission: number): void {
  try {
    const current = loadProgress();
    const next = completedMission + 1;
    if (next > current) {
      localStorage.setItem(PROGRESS_KEY, String(next));
    }
  } catch {
    // localStorage unavailable
  }
}

interface ScenarioData {
  name: string;
  mapBounds: { x: number; y: number; w: number; h: number };
  waypoints: Map<number, CellPos>;
  playerCredits: number;
  playerTechLevel: number;
  units: Array<{
    house: string;
    type: string;
    hp: number;
    cell: number;
    facing: number;
    mission: string;
    trigger: string;
  }>;
  infantry: Array<{
    house: string;
    type: string;
    hp: number;
    cell: number;
    subCell: number;
    mission: string;
    facing: number;
    trigger: string;
  }>;
  structures: Array<{
    house: string;
    type: string;
    hp: number;
    cell: number;
    facing: number;
    trigger: string;
  }>;
  terrain: Array<{
    cell: number;
    type: string;
  }>;
  teamTypes: TeamType[];
  triggers: ScenarioTrigger[];
  mapPack: string;  // raw Base64 MapPack data
}

/** Parse an INI-format scenario file */
export function parseScenarioINI(text: string): ScenarioData {
  const sections = new Map<string, Map<string, string>>();
  let currentSection = '';

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.slice(1, -1);
      if (!sections.has(currentSection)) {
        sections.set(currentSection, new Map());
      }
      continue;
    }

    const eq = line.indexOf('=');
    if (eq > 0 && currentSection) {
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      sections.get(currentSection)!.set(key, value);
    }
  }

  const get = (section: string, key: string, def = ''): string =>
    sections.get(section)?.get(key) ?? def;

  // Map bounds
  const mapX = parseInt(get('Map', 'X', '0'));
  const mapY = parseInt(get('Map', 'Y', '0'));
  const mapW = parseInt(get('Map', 'Width', '50'));
  const mapH = parseInt(get('Map', 'Height', '50'));

  // Waypoints
  const waypoints = new Map<number, CellPos>();
  const wpSection = sections.get('Waypoints');
  if (wpSection) {
    for (const [key, value] of wpSection) {
      const wpIdx = parseInt(key);
      const cellIdx = parseInt(value);
      if (!isNaN(wpIdx) && !isNaN(cellIdx)) {
        waypoints.set(wpIdx, cellIndexToPos(cellIdx));
      }
    }
  }

  // Player data
  const playerHouse = get('Basic', 'Player', 'Spain');
  const credits = parseInt(get(playerHouse, 'Credits', '0'));
  const techLevel = parseInt(get(playerHouse, 'TechLevel', '3'));

  // Units (vehicles)
  const units: ScenarioData['units'] = [];
  const unitsSection = sections.get('UNITS');
  if (unitsSection) {
    for (const [, value] of unitsSection) {
      const parts = value.split(',');
      if (parts.length >= 7) {
        units.push({
          house: parts[0],
          type: parts[1],
          hp: parseInt(parts[2]),
          cell: parseInt(parts[3]),
          facing: parseInt(parts[4]),
          mission: parts[5],
          trigger: parts[6],
        });
      }
    }
  }

  // Infantry
  const infantry: ScenarioData['infantry'] = [];
  const infSection = sections.get('INFANTRY');
  if (infSection) {
    for (const [, value] of infSection) {
      const parts = value.split(',');
      if (parts.length >= 8) {
        infantry.push({
          house: parts[0],
          type: parts[1],
          hp: parseInt(parts[2]),
          cell: parseInt(parts[3]),
          subCell: parseInt(parts[4]),
          mission: parts[5],
          facing: parseInt(parts[6]),
          trigger: parts[7],
        });
      }
    }
  }

  // Structures
  const structures: ScenarioData['structures'] = [];
  const strSection = sections.get('STRUCTURES');
  if (strSection) {
    for (const [, value] of strSection) {
      const parts = value.split(',');
      if (parts.length >= 6) {
        structures.push({
          house: parts[0],
          type: parts[1],
          hp: parseInt(parts[2]),
          cell: parseInt(parts[3]),
          facing: parseInt(parts[4]),
          trigger: parts[5],
        });
      }
    }
  }

  // Terrain features
  const terrain: ScenarioData['terrain'] = [];
  const terrSection = sections.get('TERRAIN');
  if (terrSection) {
    for (const [key, value] of terrSection) {
      terrain.push({ cell: parseInt(key), type: value });
    }
  }

  // Parse TeamTypes
  // Format: name=House,Flags,RecruitPriority,InitNum,MaxAllowed,Origin,Trigger,ClassCount,members...,MissionCount,missions...
  const teamTypes: TeamType[] = [];
  const ttSection = sections.get('TeamTypes');
  if (ttSection) {
    for (const [name, value] of ttSection) {
      const parts = value.split(',');
      if (parts.length < 8) continue;
      const house = parseInt(parts[0]);
      const origin = parseInt(parts[5]);
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

      teamTypes.push({ name, house, origin, members, missions });
    }
  }

  // Parse Triggers (18-field format from RA source)
  // Format: name=PersType,House,EventControl,ActionControl,
  //   E1.Event,E1.Team,E1.Data, E2.Event,E2.Team,E2.Data,
  //   A1.Action,A1.Team,A1.Trigger,A1.Data, A2.Action,A2.Team,A2.Trigger,A2.Data
  const triggers: ScenarioTrigger[] = [];
  const trigSection = sections.get('Trigs');
  if (trigSection) {
    for (const [name, value] of trigSection) {
      const f = value.split(',').map(s => parseInt(s.trim()));
      if (f.length < 18) continue;
      triggers.push({
        name,
        persistence: f[0],
        eventControl: f[2],
        actionControl: f[3],
        event1: { type: f[4], team: f[5], data: f[6] },
        event2: { type: f[7], team: f[8], data: f[9] },
        action1: { action: f[10], team: f[11], trigger: f[12], data: f[13] },
        action2: { action: f[14], team: f[15], trigger: f[16], data: f[17] },
        fired: false,
        timerTick: 0,
      });
    }
  }

  // Collect MapPack data (Base64 across numbered lines)
  let mapPack = '';
  const mapPackSection = sections.get('MapPack');
  if (mapPackSection) {
    const sortedKeys = [...mapPackSection.keys()].sort((a, b) => parseInt(a) - parseInt(b));
    for (const key of sortedKeys) {
      mapPack += mapPackSection.get(key)!;
    }
  }

  return {
    name: get('Basic', 'Name', 'Unknown Mission'),
    mapBounds: { x: mapX, y: mapY, w: mapW, h: mapH },
    waypoints,
    playerCredits: credits,
    playerTechLevel: techLevel,
    units,
    infantry,
    structures,
    terrain,
    teamTypes,
    triggers,
    mapPack,
  };
}

/** Map INI house name to House enum */
function toHouse(name: string): House {
  switch (name.toLowerCase()) {
    case 'spain': return House.Spain;
    case 'greece': return House.Greece;
    case 'ussr': return House.USSR;
    case 'ukraine': return House.Ukraine;
    case 'germany': return House.Germany;
    default: return House.Neutral;
  }
}

/** Map INI unit type name to UnitType enum */
function toUnitType(name: string): UnitType | null {
  const map: Record<string, UnitType> = {
    ANT1: UnitType.ANT1, ANT2: UnitType.ANT2, ANT3: UnitType.ANT3,
    '1TNK': UnitType.V_1TNK, '2TNK': UnitType.V_2TNK, '3TNK': UnitType.V_3TNK,
    '4TNK': UnitType.V_4TNK, JEEP: UnitType.V_JEEP, APC: UnitType.V_APC,
    ARTY: UnitType.V_ARTY, HARV: UnitType.V_HARV, MCV: UnitType.V_MCV,
    E1: UnitType.I_E1, E2: UnitType.I_E2, E3: UnitType.I_E3, E4: UnitType.I_E4,
    E6: UnitType.I_E6, DOG: UnitType.I_DOG, SPY: UnitType.I_SPY, MEDI: UnitType.I_MEDI,
  };
  return map[name] ?? null;
}

/** Map house ID number to House enum (from RA house numbering) */
function houseIdToHouse(id: number): House {
  // RA house IDs: 0=Spain, 1=Greece, 2=USSR, 3=England, 4=Ukraine, 5=Germany
  switch (id) {
    case 0: return House.Spain;
    case 1: return House.Greece;
    case 2: return House.USSR;
    case 4: return House.Ukraine;
    case 5: return House.Germany;
    default: return House.USSR; // ant teams use various house IDs
  }
}

/** Check if a team is an ant team (contains ant units) */
function isAntTeam(team: TeamType): boolean {
  return team.members.some(m => m.type.startsWith('ANT'));
}

export interface ScenarioResult {
  map: GameMap;
  entities: Entity[];
  name: string;
  waypoints: Map<number, CellPos>;
  teamTypes: TeamType[];
  triggers: ScenarioTrigger[];
}

/** Load a scenario and create entities + map setup */
export async function loadScenario(scenarioId: string): Promise<ScenarioResult> {
  const url = `/ra/assets/${scenarioId}.ini`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load scenario: ${url}`);
  const text = await res.text();
  const data = parseScenarioINI(text);

  // Set up map
  const map = new GameMap();
  map.setBounds(data.mapBounds.x, data.mapBounds.y, data.mapBounds.w, data.mapBounds.h);
  map.initDefault();

  // Decode MapPack for terrain data
  if (data.mapPack) {
    decodeMapPack(data.mapPack, map);
  }

  // Apply terrain features from [TERRAIN] section
  for (const t of data.terrain) {
    const pos = cellIndexToPos(t.cell);
    const type = t.type.toLowerCase();
    if (type.includes('water') || type.includes('river')) {
      map.setTerrain(pos.cx, pos.cy, Terrain.WATER);
    } else if (type.includes('rock') || type.includes('cliff')) {
      map.setTerrain(pos.cx, pos.cy, Terrain.ROCK);
    } else if (type.startsWith('t') && /^t\d/.test(type)) {
      map.setTerrain(pos.cx, pos.cy, Terrain.TREE);
    } else if (type.startsWith('tc')) {
      map.setTerrain(pos.cx, pos.cy, Terrain.TREE);
    }
  }

  // Create entities from INI unit/infantry placements
  const entities: Entity[] = [];

  for (const u of data.units) {
    const unitType = toUnitType(u.type);
    if (!unitType) continue;
    const pos = cellIndexToPos(u.cell);
    const world = cellToWorld(pos.cx, pos.cy);
    const entity = new Entity(unitType, toHouse(u.house), world.x, world.y);
    entity.facing = Math.floor(u.facing / 32) % 8;
    entity.hp = Math.floor((u.hp / 256) * entity.maxHp);
    entities.push(entity);
  }

  for (const inf of data.infantry) {
    const unitType = toUnitType(inf.type);
    if (!unitType) continue;
    const pos = cellIndexToPos(inf.cell);
    const world = cellToWorld(pos.cx, pos.cy);
    const entity = new Entity(unitType, toHouse(inf.house), world.x, world.y);
    entity.facing = Math.floor(inf.facing / 32) % 8;
    entity.hp = Math.floor((inf.hp / 256) * entity.maxHp);
    entity.subCell = inf.subCell;
    entities.push(entity);
  }

  // No hardcoded ant spawning — the trigger system handles all ant wave spawning.
  // Triggers fire based on elapsed time and global variables, spawning TeamType teams.

  return {
    map,
    entities,
    name: data.name,
    waypoints: data.waypoints,
    teamTypes: data.teamTypes,
    triggers: data.triggers,
  };
}

// === MapPack Decoder ===
// MapPack contains Base64-encoded, LCW-compressed terrain template data.
// Two layers: templateType (128x128) and templateIcon (128x128).
// The template type + icon determine the visual appearance of each map cell.

/** Decode MapPack data and apply terrain types to the map */
function decodeMapPack(base64Data: string, map: GameMap): void {
  try {
    // Decode Base64
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const MAP_SIZE = 128 * 128; // 16384 cells
    const templateType = new Uint8Array(MAP_SIZE);
    const templateIcon = new Uint8Array(MAP_SIZE);

    // LCW decompress two layers from the packed data
    const offset1 = lcwDecompressMapPack(bytes, 0, templateType, MAP_SIZE);
    if (offset1 > 0) {
      lcwDecompressMapPack(bytes, offset1, templateIcon, MAP_SIZE);
    }

    // Store template data on the map
    map.templateType = templateType;
    map.templateIcon = templateIcon;

    // Use template types to set better terrain classification
    // RA template type IDs: 0xFF=clear, 0x00=clear, others map to specific terrain
    // Common TEMPERATE template types:
    // 0-3: Clear terrain variations
    // 4-7: Water tiles
    // 8-11: Shore/beach transitions
    // 12-15: Road tiles
    // 16+: Rock, cliff, rough terrain, etc.
    for (let cy = map.boundsY; cy < map.boundsY + map.boundsH; cy++) {
      for (let cx = map.boundsX; cx < map.boundsX + map.boundsW; cx++) {
        const idx = cy * 128 + cx;
        const tmpl = templateType[idx];

        // Classify terrain based on template type ranges
        // These are approximate — TEMPERATE theater template types
        if (tmpl === 0xFF || tmpl === 0x00) {
          // Clear (default)
        } else if (tmpl >= 1 && tmpl <= 5) {
          // Water body templates
          map.setTerrain(cx, cy, Terrain.WATER);
        } else if (tmpl >= 6 && tmpl <= 11) {
          // Shore/water edge templates — treat as water
          const icon = templateIcon[idx];
          // Some shore icons are land, some are water
          if (icon % 2 === 0) {
            map.setTerrain(cx, cy, Terrain.WATER);
          }
        } else if (tmpl >= 0x18 && tmpl <= 0x20) {
          // Rock/cliff templates
          map.setTerrain(cx, cy, Terrain.ROCK);
        }
      }
    }
  } catch {
    // MapPack decode failed — terrain stays at default
  }
}

/** Simple LCW decompression for MapPack data — returns bytes consumed from source */
function lcwDecompressMapPack(
  source: Uint8Array,
  srcStart: number,
  dest: Uint8Array,
  destLength: number,
): number {
  let sp = srcStart;
  let dp = 0;
  const destEnd = destLength;

  while (dp < destEnd && sp < source.length) {
    const opCode = source[sp++];

    if (!(opCode & 0x80)) {
      // Short copy from destination (back-reference)
      let count = (opCode >> 4) + 3;
      if (count > destEnd - dp) count = destEnd - dp;
      if (!count) return sp;
      const offset = source[sp++] + ((opCode & 0x0f) << 8);
      let cp = dp - offset;
      if (cp < 0) return sp; // invalid back-reference
      while (count-- > 0 && cp < destEnd) dest[dp++] = dest[cp++];
    } else if (!(opCode & 0x40)) {
      if (opCode === 0x80) {
        return sp; // End of data
      } else {
        let count = opCode & 0x3f;
        while (count-- > 0 && sp < source.length) dest[dp++] = source[sp++];
      }
    } else {
      if (opCode === 0xfe) {
        let count = source[sp] + (source[sp + 1] << 8);
        const data = source[sp + 2];
        sp += 3;
        if (count > destEnd - dp) count = destEnd - dp;
        while (count-- > 0) dest[dp++] = data;
      } else if (opCode === 0xff) {
        let count = source[sp] + (source[sp + 1] << 8);
        let cp = source[sp + 2] + (source[sp + 3] << 8);
        sp += 4;
        while (count-- > 0) dest[dp++] = dest[cp++];
      } else {
        let count = (opCode & 0x3f) + 3;
        let cp = source[sp] + (source[sp + 1] << 8);
        sp += 2;
        while (count-- > 0) dest[dp++] = dest[cp++];
      }
    }
  }

  return sp;
}

// === Trigger System ===

/** Check if a trigger event condition is met */
export function checkTriggerEvent(
  event: TriggerEvent,
  gameTick: number,
  globals: Set<number>,
  triggerStartTick: number,
): boolean {
  switch (event.type) {
    case TEVENT_NONE:
      return true;
    case TEVENT_TIME: {
      // Data.Value is in 1/10th minute increments (6 seconds each)
      const requiredTicks = event.data * TIME_UNIT_TICKS;
      return (gameTick - triggerStartTick) >= requiredTicks;
    }
    case TEVENT_GLOBAL_SET:
      return globals.has(event.data);
    case TEVENT_PLAYER_ENTERED:
      // Simplified: always true after some initial time
      return gameTick > 15 * GAME_TICKS_PER_SEC;
    default:
      return false;
  }
}

/** Execute a trigger action — returns entities to spawn */
export function executeTriggerAction(
  action: TriggerAction,
  teamTypes: TeamType[],
  waypoints: Map<number, CellPos>,
  globals: Set<number>,
  triggers: ScenarioTrigger[],
): Entity[] {
  const spawned: Entity[] = [];

  switch (action.action) {
    case TACTION_NONE:
      break;

    case TACTION_REINFORCEMENTS:
    case TACTION_CREATE_TEAM: {
      const team = teamTypes[action.team];
      if (!team) break;

      // Find spawn waypoint from team origin
      const wp = waypoints.get(team.origin);
      if (!wp) break;
      const world = cellToWorld(wp.cx, wp.cy);

      // Spawn team members
      const house = isAntTeam(team) ? House.USSR : House.Spain;
      for (const member of team.members) {
        for (let i = 0; i < member.count; i++) {
          const unitType = toUnitType(member.type);
          if (!unitType) continue;
          // Spread units slightly around waypoint
          const offsetX = (Math.random() - 0.5) * 48;
          const offsetY = (Math.random() - 0.5) * 48;
          const entity = new Entity(unitType, house, world.x + offsetX, world.y + offsetY);
          entity.facing = Math.floor(Math.random() * 8);
          spawned.push(entity);
        }
      }
      break;
    }

    case TACTION_SET_GLOBAL:
      globals.add(action.data);
      break;

    case TACTION_FORCE_TRIGGER: {
      // Force another trigger to re-evaluate by resetting its fired state
      const target = triggers[action.trigger];
      if (target) {
        target.fired = false;
      }
      break;
    }

    case TACTION_WIN:
    case TACTION_LOSE:
      // Handled by the game loop via state changes
      break;
  }

  return spawned;
}
