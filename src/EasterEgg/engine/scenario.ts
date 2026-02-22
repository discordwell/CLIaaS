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
  playerEntered: boolean; // has a player unit entered a cell with this trigger?
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
    briefing: 'We\'ve lost contact with one of our outposts. Before it went off-line, we recieved a brief communique about giant ants. We\'re unsure what to make of this report, so we want you to investigate.\n\nScout the area, bring the outpost back on-line, and report your findings. If there is a threat, reinforcements will be sent in to help you.\n\nKeep the base functional and radio contact open -- we don\'t want to lose the outpost again.',
    objective: 'Scout the area and eliminate the ant threat.',
  },
  {
    id: 'SCA02EA',
    title: 'Evacuation',
    briefing: 'Who would\'ve believed it -- Giant Ants.\n\nNow that your MCV has arrived, we must evacuate the civilians in the area -- they don\'t stand a chance against these ants.\n\nThere are two villages in your immediate area. Locate them and evacuate the civilians to the island in the northwest. You\'ll also have to take out all the bridges in this area to stop the ants from completely overrunning you.\n\nYou must destroy the bridges, and evac at least one civilian from each town for the mission to be a success.',
    objective: 'Evacuate civilians and destroy bridges.',
  },
  {
    id: 'SCA03EA',
    title: 'Extermination',
    briefing: 'The source of the ant\'s activity has been pinpointed in this area. We suspect that their nests are in this area -- they must be destroyed.\n\nA team of civilian specialists are en-route to your location. Use them to gas all the ant nests in the area. In addition, destroy all ants that you encounter.\n\nBe careful -- these things can chew through anything. Good luck.',
    objective: 'Destroy all ant nests in the area.',
  },
  {
    id: 'SCA04EA',
    title: 'Tunnel Rats',
    briefing: 'We\'ve discovered a series of tunnels underneath the ruined base. Now that we\'ve cut off their escape routes, the ants have nowhere left to run to.\n\nPerform a sweep and clear of all the tunnels, and find the cause of these abominations. Destroy anything that isn\'t human!\n\nThe power to the tunnel lights has been knocked out, which will limit visibility. Find the generator controls, and you can re-activate the lights.',
    objective: 'Clear the tunnels and destroy all ants.',
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
  briefing: string;
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
  cellTriggers: Map<number, string>;
  mapPack: string;      // raw Base64 MapPack data
  overlayPack: string;  // raw Base64 OverlayPack data
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
        playerEntered: false,
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

  // Collect OverlayPack data (Base64 across numbered lines)
  let overlayPack = '';
  const overlayPackSection = sections.get('OverlayPack');
  if (overlayPackSection) {
    const sortedKeys = [...overlayPackSection.keys()].sort((a, b) => parseInt(a) - parseInt(b));
    for (const key of sortedKeys) {
      overlayPack += overlayPackSection.get(key)!;
    }
  }

  // Parse [Briefing] section — numbered lines concatenated, @@ = paragraph break
  let briefing = '';
  const briefSection = sections.get('Briefing');
  if (briefSection) {
    const sortedKeys = [...briefSection.keys()].sort((a, b) => parseInt(a) - parseInt(b));
    briefing = sortedKeys.map(k => briefSection.get(k)!).join('').replace(/@@/g, '\n\n');
  }

  // Parse [CellTriggers] section — maps cell index to trigger name
  const cellTriggers = new Map<number, string>();
  const ctSection = sections.get('CellTriggers');
  if (ctSection) {
    for (const [key, value] of ctSection) {
      const cellIdx = parseInt(key);
      if (!isNaN(cellIdx)) {
        cellTriggers.set(cellIdx, value);
      }
    }
  }

  return {
    name: get('Basic', 'Name', 'Unknown Mission'),
    briefing,
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
    cellTriggers,
    mapPack,
    overlayPack,
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
    case 3: return House.Greece;   // England — allied, treat as Greece
    case 4: return House.Ukraine;
    case 5: return House.Germany;
    default: return House.Neutral;
  }
}

/** Check if a team is an ant team (contains ant units) */
function isAntTeam(team: TeamType): boolean {
  return team.members.some(m => m.type.startsWith('ANT'));
}

/** A placed structure on the map (static building, not a unit) */
export interface MapStructure {
  type: string;       // building type code (WEAP, POWR, TENT, etc.)
  image: string;      // sprite sheet name (lowercase)
  house: House;
  cx: number;         // cell position
  cy: number;
  hp: number;         // current HP (0-256 scale)
  maxHp: number;      // max HP (256 = full)
  alive: boolean;     // whether structure is still standing
}

// Building type → sprite image name (only include buildings we have sprites for)
const STRUCTURE_IMAGES: Record<string, string> = {
  FACT: 'fact', POWR: 'powr', BARR: 'barr', TENT: 'tent',
  GUN: 'gun', SAM: 'sam',
};

// Building footprint sizes in cells (w, h) — defaults to 1x1
const STRUCTURE_SIZE: Record<string, [number, number]> = {
  FACT: [3, 3], WEAP: [3, 2], POWR: [2, 2], BARR: [2, 2], TENT: [2, 2],
  PROC: [3, 2], FIX: [3, 2], SILO: [1, 1], DOME: [2, 2],
  GUN: [1, 1], SAM: [2, 1], HBOX: [1, 1],
};

export interface ScenarioResult {
  map: GameMap;
  entities: Entity[];
  structures: MapStructure[];
  name: string;
  briefing: string;
  waypoints: Map<number, CellPos>;
  teamTypes: TeamType[];
  triggers: ScenarioTrigger[];
  cellTriggers: Map<number, string>;
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

  // Decode OverlayPack for ore/gem/wall overlays
  if (data.overlayPack) {
    decodeOverlayPack(data.overlayPack, map);
  }

  // Apply terrain features from [TERRAIN] section
  for (const t of data.terrain) {
    const pos = cellIndexToPos(t.cell);
    const type = t.type.toLowerCase();
    if (type.includes('water') || type.includes('river')) {
      map.setTerrain(pos.cx, pos.cy, Terrain.WATER);
    } else if (type.includes('rock') || type.includes('cliff')) {
      map.setTerrain(pos.cx, pos.cy, Terrain.ROCK);
    } else if (/^tc?\d/.test(type)) {
      // T01-T17 = single trees, TC01-TC05 = tree clumps
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
    entity.desiredFacing = entity.facing;
    entity.turretFacing = entity.facing;
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
    entity.desiredFacing = entity.facing;
    entity.hp = Math.floor((inf.hp / 256) * entity.maxHp);
    entity.subCell = inf.subCell;
    entities.push(entity);
  }

  // Create structures from INI and mark their cells as impassable
  const structures: MapStructure[] = [];
  for (const s of data.structures) {
    const pos = cellIndexToPos(s.cell);
    const image = STRUCTURE_IMAGES[s.type] ?? s.type.toLowerCase();
    structures.push({
      type: s.type,
      image,
      house: toHouse(s.house),
      cx: pos.cx,
      cy: pos.cy,
      hp: s.hp,
      maxHp: 256,
      alive: s.hp > 0,
    });
    // Mark structure footprint cells as impassable (WALL terrain)
    const [fw, fh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        map.setTerrain(pos.cx + dx, pos.cy + dy, Terrain.WALL);
      }
    }
  }

  // Store cell triggers on the map for runtime checks
  map.cellTriggers = data.cellTriggers;

  return {
    map,
    entities,
    structures,
    name: data.name,
    briefing: data.briefing,
    waypoints: data.waypoints,
    teamTypes: data.teamTypes,
    triggers: data.triggers,
    cellTriggers: data.cellTriggers,
  };
}

// === OverlayPack Decoder ===
// OverlayPack contains Base64-encoded, LCW-compressed overlay type data.
// Single layer: overlay type ID per cell (0xFF = no overlay).
// RA overlay IDs: 0x03-0x0E = Gold ore (GOLD01-GOLD12), 0x0F-0x12 = Gems (GEM01-GEM04)
// 0x15-0x1F = Walls (BRIK, SBAG, CYCL, WOOD, FENC)

function decodeOverlayPack(base64Data: string, map: GameMap): void {
  try {
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const MAP_SIZE = 128 * 128;
    const overlay = new Uint8Array(MAP_SIZE).fill(0xFF);
    lcwDecompressMapPack(bytes, 0, overlay, MAP_SIZE);
    map.overlay = overlay;
  } catch {
    // OverlayPack decode failed — overlays stay empty
  }
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

    // Use template types to set terrain classification
    // TEMPERATE theater template type IDs (from RA TEMPERAT.INI):
    //   0, 255: Clear/grass (default)
    //   1-2: Pure water body tiles
    //   3-56: Shore/beach transitions (mixed water+land — use icon to distinguish)
    //   57-58, 97-110: Rock debris/formations
    //   59-96: Water cliff edges
    //   112-130: River segments and bridges
    //   131-172: Land cliffs and rock formations
    //   173-228: Road network tiles (passable)
    //   229-234: River crossings
    //   235-252: Bridge structures (passable)
    for (let cy = map.boundsY; cy < map.boundsY + map.boundsH; cy++) {
      for (let cx = map.boundsX; cx < map.boundsX + map.boundsW; cx++) {
        const idx = cy * 128 + cx;
        const tmpl = templateType[idx];

        if (tmpl === 0xFF || tmpl === 0x00) {
          // Clear (default)
        } else if (tmpl >= 1 && tmpl <= 2) {
          // Pure water body
          map.setTerrain(cx, cy, Terrain.WATER);
        } else if (tmpl >= 3 && tmpl <= 56) {
          // Shore/beach transitions — icon 0-3 are typically water portions
          const icon = templateIcon[idx];
          if (icon < 4) {
            map.setTerrain(cx, cy, Terrain.WATER);
          }
          // Other icons are land (shore dirt) — stays CLEAR
        } else if ((tmpl >= 59 && tmpl <= 96) || (tmpl >= 112 && tmpl <= 130) ||
                   (tmpl >= 229 && tmpl <= 234)) {
          // Water cliffs, rivers — treat as water
          map.setTerrain(cx, cy, Terrain.WATER);
        } else if ((tmpl >= 57 && tmpl <= 58) || (tmpl >= 97 && tmpl <= 110) ||
                   (tmpl >= 131 && tmpl <= 172)) {
          // Rock debris, formations, land cliffs — impassable
          map.setTerrain(cx, cy, Terrain.ROCK);
        }
        // 173-228: roads, 235-252: bridges → stay as CLEAR (passable)
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
  playerEntered: boolean,
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
      // True when a player unit has entered a cell associated with this trigger
      return playerEntered;
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

      // Spawn team members using the actual house from TeamType data
      const house = houseIdToHouse(team.house);
      for (const member of team.members) {
        for (let i = 0; i < member.count; i++) {
          const unitType = toUnitType(member.type);
          if (!unitType) continue;
          // Spread units slightly around waypoint
          const offsetX = (Math.random() - 0.5) * 48;
          const offsetY = (Math.random() - 0.5) * 48;
          const entity = new Entity(unitType, house, world.x + offsetX, world.y + offsetY);
          entity.facing = Math.floor(Math.random() * 8);
          // Assign team mission script to each member
          if (team.missions.length > 0) {
            entity.teamMissions = team.missions.map(m => ({
              mission: m.mission,
              data: m.data,
            }));
            entity.teamMissionIndex = 0;
          }
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
