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

// === Animation metadata (DoInfoStruct from RA source) ===
export interface DoInfo {
  frame: number;   // starting frame index
  count: number;   // frames per facing (or total if jump=0)
  jump: number;    // stride between facings (0 = no facing variants)
}

export interface InfantryAnim {
  ready: DoInfo;      // standing idle
  walk: DoInfo;       // walking
  fire: DoInfo;       // firing weapon (standing)
  die1: DoInfo;       // death animation 1
  die2?: DoInfo;      // death animation 2 (alternative death, e.g. blown up)
  idle?: DoInfo;      // idle fidget animation (optional)
}

// Infantry animation layouts per type (from idata.cpp DoControls)
export const INFANTRY_ANIMS: Record<string, InfantryAnim> = {
  E1: {
    ready: { frame: 0, count: 1, jump: 1 },
    walk:  { frame: 24, count: 6, jump: 6 },
    fire:  { frame: 72, count: 7, jump: 7 },
    die1:  { frame: 200, count: 8, jump: 0 },
    die2:  { frame: 208, count: 8, jump: 0 },
    idle:  { frame: 224, count: 6, jump: 0 },
  },
  E2: {
    ready: { frame: 0, count: 1, jump: 1 },
    walk:  { frame: 24, count: 6, jump: 6 },
    fire:  { frame: 72, count: 10, jump: 10 },
    die1:  { frame: 312, count: 8, jump: 0 },
    idle:  { frame: 280, count: 6, jump: 0 },
  },
  E3: {
    ready: { frame: 0, count: 1, jump: 1 },
    walk:  { frame: 24, count: 6, jump: 6 },
    fire:  { frame: 72, count: 7, jump: 7 },
    die1:  { frame: 200, count: 8, jump: 0 },
    idle:  { frame: 224, count: 6, jump: 0 },
  },
  E4: {
    ready: { frame: 0, count: 1, jump: 1 },
    walk:  { frame: 24, count: 6, jump: 6 },
    fire:  { frame: 72, count: 10, jump: 10 },
    die1:  { frame: 312, count: 8, jump: 0 },
    idle:  { frame: 280, count: 6, jump: 0 },
  },
  E6: {
    ready: { frame: 0, count: 1, jump: 1 },
    walk:  { frame: 24, count: 6, jump: 6 },
    fire:  { frame: 24, count: 6, jump: 6 },  // engineers don't fire, reuse walk
    die1:  { frame: 200, count: 8, jump: 0 },
  },
  DOG: {
    ready: { frame: 0, count: 1, jump: 1 },
    walk:  { frame: 24, count: 6, jump: 6 },
    fire:  { frame: 72, count: 4, jump: 4 },
    die1:  { frame: 200, count: 8, jump: 0 },
    idle:  { frame: 180, count: 3, jump: 0 },
  },
  SPY: {
    ready: { frame: 0, count: 1, jump: 1 },
    walk:  { frame: 24, count: 6, jump: 6 },
    fire:  { frame: 72, count: 7, jump: 7 },
    die1:  { frame: 200, count: 8, jump: 0 },
    idle:  { frame: 224, count: 6, jump: 0 },
  },
  MEDI: {
    ready: { frame: 0, count: 1, jump: 1 },
    walk:  { frame: 24, count: 6, jump: 6 },
    fire:  { frame: 72, count: 7, jump: 7 },  // heal animation
    die1:  { frame: 200, count: 8, jump: 0 },
  },
};

// Vehicle body rotation lookup table (BodyShape[32] from RA source)
// Maps 32-step facing index to sprite frame index
export const BODY_SHAPE: number[] = [
  0, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17,
  16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
];

// Ant animation frame ranges (104 total frames)
// Standing: 0-7 (8 directions × 1 frame)
// Walking: 8-71 (8 directions × 8 walk frames)
// Attacking: 72-103 (8 directions × 4 attack frames)
export const ANT_ANIM = {
  standBase: 0,
  walkBase: 8, walkCount: 8,
  attackBase: 72, attackCount: 4,
};

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
  noMovingFire?: boolean; // must stop to fire (ants, artillery)
}

// Warhead types from RA (determines damage vs armor class)
export type WarheadType = 'SA' | 'HE' | 'AP' | 'Fire' | 'Super';

// Damage multipliers: warhead vs armor class [none, light, heavy]
export const WARHEAD_VS_ARMOR: Record<WarheadType, [number, number, number]> = {
  SA:    [1.0, 0.7, 0.4],  // Small Arms — good vs infantry, poor vs heavy
  HE:    [1.0, 0.8, 0.6],  // High Explosive — decent vs all
  AP:    [0.6, 0.7, 1.0],  // Armor Piercing — best vs heavy armor
  Fire:  [1.0, 1.0, 0.5],  // Fire — good vs infantry/light, poor vs heavy
  Super: [1.0, 1.0, 1.0],  // Super — equal damage to all (ant mandibles)
};

export interface WeaponStats {
  name: string;
  damage: number;
  rof: number;    // rate of fire (ticks between shots)
  range: number;  // range in cells
  warhead: WarheadType;
  splash?: number;    // AOE splash radius in cells (0 = point damage only)
  inaccuracy?: number; // scatter radius in cells (0 = perfect aim)
}

// Unit stat definitions from scenario INI
export const UNIT_STATS: Record<string, UnitStats> = {
  ANT1: { type: UnitType.ANT1, name: 'Warrior Ant', image: 'ant1', strength: 125, armor: 'heavy', speed: 8, sight: 3, rot: 8, isInfantry: false, primaryWeapon: 'Mandible', noMovingFire: true },
  ANT2: { type: UnitType.ANT2, name: 'Fire Ant', image: 'ant2', strength: 75, armor: 'heavy', speed: 8, sight: 3, rot: 6, isInfantry: false, primaryWeapon: 'FireballLauncher', noMovingFire: true },
  ANT3: { type: UnitType.ANT3, name: 'Scout Ant', image: 'ant3', strength: 85, armor: 'light', speed: 7, sight: 3, rot: 9, isInfantry: false, primaryWeapon: 'TeslaZap', noMovingFire: true },
  '1TNK': { type: UnitType.V_1TNK, name: 'Light Tank', image: '1tnk', strength: 300, armor: 'heavy', speed: 7, sight: 4, rot: 5, isInfantry: false, primaryWeapon: 'TankGun' },
  '2TNK': { type: UnitType.V_2TNK, name: 'Medium Tank', image: '2tnk', strength: 400, armor: 'heavy', speed: 6, sight: 5, rot: 5, isInfantry: false, primaryWeapon: 'TankGun' },
  '3TNK': { type: UnitType.V_3TNK, name: 'Heavy Tank', image: '3tnk', strength: 600, armor: 'heavy', speed: 4, sight: 4, rot: 4, isInfantry: false, primaryWeapon: 'MammothTusk' },
  JEEP: { type: UnitType.V_JEEP, name: 'Ranger', image: 'jeep', strength: 150, armor: 'light', speed: 10, sight: 4, rot: 8, isInfantry: false, primaryWeapon: 'MachineGun' },
  '4TNK': { type: UnitType.V_4TNK, name: 'Tesla Tank', image: '4tnk', strength: 400, armor: 'heavy', speed: 5, sight: 5, rot: 4, isInfantry: false, primaryWeapon: 'TeslaCannon' },
  APC: { type: UnitType.V_APC, name: 'APC', image: 'apc', strength: 200, armor: 'heavy', speed: 8, sight: 4, rot: 6, isInfantry: false, primaryWeapon: 'MachineGun' },
  ARTY: { type: UnitType.V_ARTY, name: 'Artillery', image: 'arty', strength: 75, armor: 'light', speed: 4, sight: 6, rot: 4, isInfantry: false, primaryWeapon: 'ArtilleryShell', noMovingFire: true },
  HARV: { type: UnitType.V_HARV, name: 'Harvester', image: 'harv', strength: 600, armor: 'heavy', speed: 5, sight: 3, rot: 4, isInfantry: false, primaryWeapon: null },
  MCV: { type: UnitType.V_MCV, name: 'MCV', image: 'mcv', strength: 600, armor: 'heavy', speed: 4, sight: 4, rot: 3, isInfantry: false, primaryWeapon: null },
  E1: { type: UnitType.I_E1, name: 'Rifle Infantry', image: 'e1', strength: 50, armor: 'none', speed: 4, sight: 3, rot: 8, isInfantry: true, primaryWeapon: 'Rifle' },
  E2: { type: UnitType.I_E2, name: 'Grenadier', image: 'e2', strength: 50, armor: 'none', speed: 4, sight: 3, rot: 8, isInfantry: true, primaryWeapon: 'Grenade' },
  E3: { type: UnitType.I_E3, name: 'Rocket Soldier', image: 'e3', strength: 45, armor: 'none', speed: 4, sight: 4, rot: 8, isInfantry: true, primaryWeapon: 'Bazooka' },
  E4: { type: UnitType.I_E4, name: 'Flamethrower', image: 'e4', strength: 40, armor: 'none', speed: 4, sight: 3, rot: 8, isInfantry: true, primaryWeapon: 'Flamethrower' },
  E6: { type: UnitType.I_E6, name: 'Engineer', image: 'e6', strength: 25, armor: 'none', speed: 4, sight: 2, rot: 8, isInfantry: true, primaryWeapon: null },
  DOG: { type: UnitType.I_DOG, name: 'Attack Dog', image: 'dog', strength: 25, armor: 'none', speed: 8, sight: 5, rot: 8, isInfantry: true, primaryWeapon: 'DogJaw' },
  SPY: { type: UnitType.I_SPY, name: 'Spy', image: 'spy', strength: 25, armor: 'none', speed: 4, sight: 4, rot: 8, isInfantry: true, primaryWeapon: null },
  MEDI: { type: UnitType.I_MEDI, name: 'Medic', image: 'medi', strength: 80, armor: 'none', speed: 4, sight: 3, rot: 8, isInfantry: true, primaryWeapon: null },
};

export const WEAPON_STATS: Record<string, WeaponStats> = {
  Mandible: { name: 'Mandible', damage: 50, rof: 15, range: 1.5, warhead: 'Super' },
  TeslaZap: { name: 'TeslaZap', damage: 60, rof: 25, range: 1.75, warhead: 'Super' },
  FireballLauncher: { name: 'FireballLauncher', damage: 40, rof: 20, range: 3, warhead: 'Fire', splash: 1.5 },
  TankGun: { name: 'TankGun', damage: 25, rof: 50, range: 5, warhead: 'AP' },
  MammothTusk: { name: 'MammothTusk', damage: 75, rof: 80, range: 5.5, warhead: 'AP', splash: 1.5 },
  MachineGun: { name: 'MachineGun', damage: 10, rof: 15, range: 4, warhead: 'SA' },
  Rifle: { name: 'Rifle', damage: 15, rof: 20, range: 3, warhead: 'SA' },
  Bazooka: { name: 'Bazooka', damage: 40, rof: 60, range: 5, warhead: 'AP', splash: 1 },
  Grenade: { name: 'Grenade', damage: 35, rof: 40, range: 3.5, warhead: 'HE', splash: 1.5, inaccuracy: 0.5 },
  Flamethrower: { name: 'Flamethrower', damage: 35, rof: 20, range: 3, warhead: 'Fire', splash: 1 },
  DogJaw: { name: 'DogJaw', damage: 100, rof: 10, range: 1.5, warhead: 'Super' },
  TeslaCannon: { name: 'TeslaCannon', damage: 75, rof: 60, range: 5, warhead: 'Super', splash: 1 },
  ArtilleryShell: { name: 'ArtilleryShell', damage: 150, rof: 100, range: 8, warhead: 'HE', splash: 2, inaccuracy: 1.5 },
};

// Infantry sub-cell positions within a cell (0=center, 1-4=corners)
// Pixel offsets from cell center for each sub-position
export const SUB_CELL_OFFSETS: { x: number; y: number }[] = [
  { x: 0, y: 0 },     // 0: center
  { x: -7, y: -7 },   // 1: top-left
  { x: 7, y: -7 },    // 2: top-right
  { x: -7, y: 7 },    // 3: bottom-left
  { x: 7, y: 7 },     // 4: bottom-right
];

// === Entity Mission States ===
export enum Mission {
  GUARD = 'GUARD',
  MOVE = 'MOVE',
  ATTACK = 'ATTACK',
  HUNT = 'HUNT',
  SLEEP = 'SLEEP',
  DIE = 'DIE',
}

// === Unit Stance (affects guard/pursuit behavior) ===
export enum Stance {
  AGGRESSIVE = 0,  // chase enemies beyond guard range
  DEFENSIVE = 1,   // fight back but return to position
  HOLD_FIRE = 2,   // never auto-attack
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
