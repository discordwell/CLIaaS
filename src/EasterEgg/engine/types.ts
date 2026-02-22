/**
 * Core type definitions for the Red Alert Ant Mission game engine.
 * Based on SCA01EA-04EA.INI scenario data from the original game.
 */

// === Coordinate System ===
// Map is 128×128 cells, visible area is ~50×50 cells
// Each cell is 24×24 pixels at game resolution
// Lepton: sub-cell precision (256 leptons = 1 cell)

export const CELL_SIZE = 24; // pixels per cell
export const LEPTON_SIZE = 256; // leptons per cell
export const MAP_CELLS = 128; // cells per map side
export const GAME_TICKS_PER_SEC = 15; // original game ran at ~15 FPS

// === Directions ===
export enum Dir {
  N = 0,
  NE = 1,
  E = 2,
  SE = 3,
  S = 4,
  SW = 5,
  W = 6,
  NW = 7,
}
export const DIR_COUNT = 8;

// Direction vectors (dx, dy) — N is up (negative y)
export const DIR_DX = [0, 1, 1, 1, 0, -1, -1, -1];
export const DIR_DY = [-1, -1, 0, 1, 1, 1, 0, -1];

// === Houses (Factions) ===
export enum House {
  Spain = 'Spain',     // Player (Allied) in ant missions
  Greece = 'Greece',   // Allied ally
  USSR = 'USSR',       // Ant faction
  Ukraine = 'Ukraine', // Ant faction ally
  Germany = 'Germany', // Ant faction ally
  Neutral = 'Neutral',
}

// Alliance groups
export const PLAYER_HOUSES = new Set([House.Spain, House.Greece]);
export const ANT_HOUSES = new Set([House.USSR, House.Ukraine, House.Germany]);

// === Unit Types ===
export enum UnitType {
  // Ant units
  ANT1 = 'ANT1',  // Warrior Ant (melee, heavy armor)
  ANT2 = 'ANT2',  // Fire Ant (ranged, heavy armor)
  ANT3 = 'ANT3',  // Scout Ant (tesla zap, light armor)
  // Player vehicles
  V_1TNK = '1TNK', // Light tank
  V_2TNK = '2TNK', // Medium tank
  V_3TNK = '3TNK', // Heavy/Mammoth tank
  V_4TNK = '4TNK', // Tesla tank
  V_JEEP = 'JEEP', // Ranger
  V_APC = 'APC',   // APC
  V_ARTY = 'ARTY', // Artillery
  V_HARV = 'HARV', // Harvester
  V_MCV = 'MCV',   // MCV
  // Player infantry
  I_E1 = 'E1',    // Rifle infantry
  I_E2 = 'E2',    // Grenadier
  I_E3 = 'E3',    // Rocket soldier
  I_E4 = 'E4',    // Flamethrower
  I_E6 = 'E6',    // Engineer
  I_DOG = 'DOG',  // Attack dog
  I_SPY = 'SPY',  // Spy
  I_MEDI = 'MEDI', // Medic
}

// === Unit stats from SCA01EA.INI ===
export interface UnitStats {
  type: UnitType;
  name: string;
  image: string;        // sprite asset name
  strength: number;     // max HP
  armor: 'light' | 'heavy' | 'none';
  speed: number;        // movement speed (game units)
  sight: number;        // vision range in cells
  rot: number;          // rotation speed
  isInfantry: boolean;
  primaryWeapon: string | null;
}

export interface WeaponStats {
  name: string;
  damage: number;
  rof: number;    // rate of fire (ticks between shots)
  range: number;  // range in cells
}

// Unit stat definitions from scenario INI
export const UNIT_STATS: Record<string, UnitStats> = {
  ANT1: { type: UnitType.ANT1, name: 'Warrior Ant', image: 'ant1', strength: 125, armor: 'heavy', speed: 8, sight: 3, rot: 8, isInfantry: false, primaryWeapon: 'Mandible' },
  ANT2: { type: UnitType.ANT2, name: 'Fire Ant', image: 'ant2', strength: 75, armor: 'heavy', speed: 8, sight: 3, rot: 6, isInfantry: false, primaryWeapon: 'FireballLauncher' },
  ANT3: { type: UnitType.ANT3, name: 'Scout Ant', image: 'ant3', strength: 85, armor: 'light', speed: 7, sight: 3, rot: 9, isInfantry: false, primaryWeapon: 'TeslaZap' },
  '1TNK': { type: UnitType.V_1TNK, name: 'Light Tank', image: '1tnk', strength: 300, armor: 'heavy', speed: 7, sight: 4, rot: 5, isInfantry: false, primaryWeapon: 'TankGun' },
  '2TNK': { type: UnitType.V_2TNK, name: 'Medium Tank', image: '2tnk', strength: 400, armor: 'heavy', speed: 6, sight: 5, rot: 5, isInfantry: false, primaryWeapon: 'TankGun' },
  '3TNK': { type: UnitType.V_3TNK, name: 'Heavy Tank', image: '3tnk', strength: 600, armor: 'heavy', speed: 4, sight: 4, rot: 4, isInfantry: false, primaryWeapon: 'MammothTusk' },
  JEEP: { type: UnitType.V_JEEP, name: 'Ranger', image: 'jeep', strength: 150, armor: 'light', speed: 10, sight: 4, rot: 8, isInfantry: false, primaryWeapon: 'MachineGun' },
  E1: { type: UnitType.I_E1, name: 'Rifle Infantry', image: 'e1', strength: 50, armor: 'none', speed: 4, sight: 3, rot: 8, isInfantry: true, primaryWeapon: 'Rifle' },
  E3: { type: UnitType.I_E3, name: 'Rocket Soldier', image: 'e3', strength: 45, armor: 'none', speed: 4, sight: 4, rot: 8, isInfantry: true, primaryWeapon: 'Bazooka' },
};

export const WEAPON_STATS: Record<string, WeaponStats> = {
  Mandible: { name: 'Mandible', damage: 50, rof: 15, range: 1.5 },
  TeslaZap: { name: 'TeslaZap', damage: 60, rof: 25, range: 1.75 },
  FireballLauncher: { name: 'FireballLauncher', damage: 40, rof: 20, range: 3 },
  TankGun: { name: 'TankGun', damage: 25, rof: 50, range: 5 },
  MammothTusk: { name: 'MammothTusk', damage: 75, rof: 80, range: 5.5 },
  MachineGun: { name: 'MachineGun', damage: 10, rof: 15, range: 4 },
  Rifle: { name: 'Rifle', damage: 15, rof: 20, range: 3 },
  Bazooka: { name: 'Bazooka', damage: 40, rof: 60, range: 5 },
};

// === Entity Mission States ===
export enum Mission {
  GUARD = 'GUARD',
  MOVE = 'MOVE',
  ATTACK = 'ATTACK',
  HUNT = 'HUNT',
  SLEEP = 'SLEEP',
  DIE = 'DIE',
}

// === Animation States ===
export enum AnimState {
  IDLE = 'IDLE',
  WALK = 'WALK',
  ATTACK = 'ATTACK',
  DIE = 'DIE',
}

// === World Position ===
export interface WorldPos {
  x: number;  // pixel x in world space
  y: number;  // pixel y in world space
}

export interface CellPos {
  cx: number; // cell column (0-127)
  cy: number; // cell row (0-127)
}

// Convert cell index (0-16383) to cell position
export function cellIndexToPos(idx: number): CellPos {
  return { cx: idx % MAP_CELLS, cy: Math.floor(idx / MAP_CELLS) };
}

// Convert cell position to world pixel position (center of cell)
export function cellToWorld(cx: number, cy: number): WorldPos {
  return {
    x: cx * CELL_SIZE + CELL_SIZE / 2,
    y: cy * CELL_SIZE + CELL_SIZE / 2,
  };
}

// Convert world position to cell position
export function worldToCell(x: number, y: number): CellPos {
  return {
    cx: Math.floor(x / CELL_SIZE),
    cy: Math.floor(y / CELL_SIZE),
  };
}

// Distance in cells between two world positions
export function worldDist(a: WorldPos, b: WorldPos): number {
  const dx = (a.x - b.x) / CELL_SIZE;
  const dy = (a.y - b.y) / CELL_SIZE;
  return Math.sqrt(dx * dx + dy * dy);
}

// Direction from a to b (8-way)
export function directionTo(from: WorldPos, to: WorldPos): Dir {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const angle = Math.atan2(dy, dx); // radians, 0=east, positive=clockwise
  // Convert to 8-way: N=0, NE=1, E=2, ...
  const octant = Math.round(((angle + Math.PI) / (Math.PI * 2)) * 8) % 8;
  // atan2 gives E=0 but we want N=0, so rotate
  return ((octant + 6) % 8) as Dir;
}
