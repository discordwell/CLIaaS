/**
 * Scenario loader — parses extracted INI files and sets up the game state.
 * Reads unit placements, waypoints, team types, and triggers from SCA01-04EA.INI.
 */

import { type CellPos, cellIndexToPos, cellToWorld, House, UnitType } from './types';
import { Entity } from './entity';
import { GameMap, Terrain } from './map';

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

/** Load a scenario and create entities + map setup */
export async function loadScenario(
  scenarioId: string
): Promise<{ map: GameMap; entities: Entity[]; name: string; waypoints: Map<number, CellPos> }> {
  const url = `/ra/assets/${scenarioId}.ini`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load scenario: ${url}`);
  const text = await res.text();
  const data = parseScenarioINI(text);

  // Set up map
  const map = new GameMap();
  map.setBounds(data.mapBounds.x, data.mapBounds.y, data.mapBounds.w, data.mapBounds.h);
  map.initDefault();

  // Apply terrain features
  for (const t of data.terrain) {
    const pos = cellIndexToPos(t.cell);
    const type = t.type.toLowerCase();
    if (type.includes('water') || type.includes('river')) {
      map.setTerrain(pos.cx, pos.cy, Terrain.WATER);
    } else if (type.includes('rock') || type.includes('cliff')) {
      map.setTerrain(pos.cx, pos.cy, Terrain.ROCK);
    } else if (type.startsWith('t') && /^t\d/.test(type)) {
      // Tree templates: T01, T02, ... T15
      map.setTerrain(pos.cx, pos.cy, Terrain.TREE);
    } else if (type.startsWith('tc')) {
      // Tree clumps: TC01-TC05
      map.setTerrain(pos.cx, pos.cy, Terrain.TREE);
    }
  }

  // Create entities
  const entities: Entity[] = [];

  // Vehicle units
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

  // Infantry
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

  // Spawn initial ant waves at distant waypoints only.
  // In the original, ants are spawned by triggers/team types over time.
  // We place scouts at waypoints that are far from the player start (WP98).
  const playerStart = data.waypoints.get(98);
  const minSpawnDist = 25; // minimum cells from player to spawn ants
  const antSpawnWaypoints = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 16, 17, 18, 20, 21, 26];
  let antCount = 0;
  for (const wpIdx of antSpawnWaypoints) {
    if (antCount >= 8) break; // don't spawn too many initially
    const wp = data.waypoints.get(wpIdx);
    if (!wp) continue;
    // Only spawn at waypoints far from player
    if (playerStart) {
      const dx = wp.cx - playerStart.cx;
      const dy = wp.cy - playerStart.cy;
      if (Math.sqrt(dx * dx + dy * dy) < minSpawnDist) continue;
    }
    const world = cellToWorld(wp.cx, wp.cy);
    const antType = antCount % 3 === 0 ? UnitType.ANT1
                  : antCount % 3 === 1 ? UnitType.ANT3
                  : UnitType.ANT2;
    const ant = new Entity(antType, House.USSR, world.x, world.y);
    ant.facing = Math.floor(Math.random() * 8);
    entities.push(ant);
    antCount++;
  }

  return { map, entities, name: data.name, waypoints: data.waypoints };
}
