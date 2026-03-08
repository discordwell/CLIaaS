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
/** Convert C++ MPH (leptons/tick) to pixels/tick: MPH * CELL_SIZE / LEPTON_SIZE */
export const MPH_TO_PX = CELL_SIZE / LEPTON_SIZE; // 0.09375
export const MAP_CELLS = 128; // cells per map side
export const GAME_TICKS_PER_SEC = 15; // original game ran at ~15 FPS

// TEMPERATE theatre template type ranges (from TEMPERAT.INI)
export const TEMPLATE_ROAD_MIN = 173;
export const TEMPLATE_ROAD_MAX = 228;

// === C++ Rule.ini defaults (rules.cpp) ===
export const MAX_DAMAGE = 1000;          // rules.cpp:227 — max damage per hit
export const REPAIR_STEP = 5;            // rules.cpp RepairStep(5) — HP per repair pulse
export const REPAIR_PERCENT = 0.20;      // rules.ini RepairPercent=20% — cost ratio for full repair
export const CONDITION_RED = 0.25;       // rules.cpp:235 — red health threshold
export const CONDITION_YELLOW = 0.5;     // rules.cpp:234 — yellow health threshold
export const PRONE_DAMAGE_BIAS = 0.5;    // rules.cpp:202 — prone infantry damage multiplier

// Power drain per structure type — C++ rules.ini Power= values (negative = consumes)
// Values sourced from each building's INI entry; 0 means no drain.
export const POWER_DRAIN: Record<string, number> = {
  PROC: 30,
  WEAP: 30,
  TENT: 20,
  BARR: 20,
  DOME: 40,
  TSLA: 150,
  PBOX: 15,
  HBOX: 15,
  GUN:  40,
  SAM:  20,
  AGUN: 50,
  FIX:  30,
  HPAD: 10,
  AFLD: 20,
  ATEK: 50,
  STEK: 100,
  PDOX: 200,
  IRON: 200,
  MSLO: 100,
  GAP:  60,
  FTUR: 20,
  SILO: 0,
  KENN: 10,
  SYRD: 30,
  SPEN: 30,
};

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
  England = 'England', // Allied (campaign missions)
  France = 'France',   // Allied (campaign missions)
  USSR = 'USSR',       // Ant faction / Soviet player in campaign
  Ukraine = 'Ukraine', // Ant faction ally / Soviet ally
  Germany = 'Germany', // Ant faction ally (ant missions) / Allied (campaign)
  Turkey = 'Turkey',   // Neutral / scenario-specific
  GoodGuy = 'GoodGuy', // Meta-house: player side
  BadGuy = 'BadGuy',   // Meta-house: enemy side
  Neutral = 'Neutral',
}

// Alliance groups (ant missions only — campaign uses dynamic alliances from scenario INI)
export const PLAYER_HOUSES = new Set([House.Spain, House.Greece]);
export const ANT_HOUSES = new Set([House.USSR, House.Ukraine, House.Germany]);

// Map House → Faction. In RA, Germany is Allied; ant missions repurpose it as enemy.
export type Faction = 'allied' | 'soviet' | 'both';

export const HOUSE_FACTION: Record<string, Faction> = {
  Spain: 'allied', Greece: 'allied', England: 'allied', France: 'allied',
  Germany: 'allied', Turkey: 'allied', GoodGuy: 'allied',
  USSR: 'soviet', Ukraine: 'soviet', BadGuy: 'soviet',
  Neutral: 'both',
};

export interface CountryBonus {
  costMult: number;          // production cost multiplier (< 1.0 = cheaper)
  firepowerMult: number;     // outgoing damage multiplier
  armorMult: number;         // damage resistance multiplier (> 1.0 = tougher)
  groundspeedMult: number;   // ground unit speed multiplier (rules.ini Groundspeed=)
  rofMult: number;           // rate of fire multiplier (> 1.0 = slower ROF, rules.ini ROF=)
}

// Country bonuses from rules.ini [CountryName] sections
export const COUNTRY_BONUSES: Record<string, CountryBonus> = {
  Spain:   { costMult: 1.0, firepowerMult: 1.0, armorMult: 1.0, groundspeedMult: 1.0, rofMult: 1.0 },
  Greece:  { costMult: 1.0, firepowerMult: 1.0, armorMult: 1.0, groundspeedMult: 1.0, rofMult: 1.0 },
  England: { costMult: 1.0, firepowerMult: 1.0, armorMult: 1.1, groundspeedMult: 1.0, rofMult: 1.0 },  // 10% tougher armor
  France:  { costMult: 1.0, firepowerMult: 1.0, armorMult: 1.0, groundspeedMult: 1.0, rofMult: 1.1 },  // 10% faster ROF
  Germany: { costMult: 1.0, firepowerMult: 1.1, armorMult: 1.0, groundspeedMult: 1.0, rofMult: 1.0 },  // 10% more firepower
  Turkey:  { costMult: 1.0, firepowerMult: 1.0, armorMult: 1.0, groundspeedMult: 1.0, rofMult: 1.0 },
  USSR:    { costMult: 0.9, firepowerMult: 1.0, armorMult: 1.0, groundspeedMult: 1.0, rofMult: 1.0 },  // 10% cheaper
  Ukraine: { costMult: 1.0, firepowerMult: 1.0, armorMult: 1.0, groundspeedMult: 1.1, rofMult: 1.0 },  // 10% faster ground
  GoodGuy: { costMult: 1.0, firepowerMult: 1.0, armorMult: 1.0, groundspeedMult: 1.0, rofMult: 1.0 },
  BadGuy:  { costMult: 1.0, firepowerMult: 1.0, armorMult: 1.0, groundspeedMult: 1.0, rofMult: 1.0 },
  Neutral: { costMult: 1.0, firepowerMult: 1.0, armorMult: 1.0, groundspeedMult: 1.0, rofMult: 1.0 },
};

// House firepower bias — derived from COUNTRY_BONUSES (C++ House->FirepowerBias)
export const HOUSE_FIREPOWER_BIAS: Record<string, number> = Object.fromEntries(
  Object.entries(COUNTRY_BONUSES).map(([k, v]) => [k, v.firepowerMult])
);

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
  V_4TNK = '4TNK', // Mammoth tank
  V_JEEP = 'JEEP', // Ranger
  V_APC = 'APC',   // APC
  V_ARTY = 'ARTY', // Artillery
  V_HARV = 'HARV', // Harvester
  V_MCV = 'MCV',   // MCV
  V_TRUK = 'TRUK', // Supply truck
  // Player infantry
  I_E1 = 'E1',    // Rifle infantry
  I_E2 = 'E2',    // Grenadier
  I_E3 = 'E3',    // Rocket soldier
  I_E4 = 'E4',    // Flamethrower
  I_E6 = 'E6',    // Engineer
  I_DOG = 'DOG',  // Attack dog
  I_SPY = 'SPY',  // Spy
  I_MEDI = 'MEDI', // Medic
  I_GNRL = 'GNRL', // General Stavros (sniper)
  // Civilian infantry (for evacuation missions)
  I_C1 = 'C1', I_C2 = 'C2', I_C3 = 'C3', I_C4 = 'C4', I_C5 = 'C5',
  I_C6 = 'C6', I_C7 = 'C7', I_C8 = 'C8', I_C9 = 'C9', I_C10 = 'C10',
  // Specialist infantry
  I_EINSTEIN = 'EINSTEIN', // Prof. Einstein (civilian VIP, evacuation missions)
  I_CHAN = 'CHAN',  // Specialist (nest gas infantry for SCA03EA)
  I_TANYA = 'E7',  // Tanya
  I_THF = 'THF',   // Thief
  // Counterstrike/Aftermath expansion infantry
  I_SHOK = 'SHOK', // Shock Trooper (electric weapon, CS expansion)
  I_MECH = 'MECH', // Mechanic (repairs vehicles, Aftermath expansion)
  // Counterstrike/Aftermath expansion vehicles
  V_STNK = 'STNK', // Phase Transport (stealth APC)
  V_CTNK = 'CTNK', // Chrono Tank (can teleport)
  V_TTNK = 'TTNK', // Tesla Tank (electric weapon)
  V_QTNK = 'QTNK', // M.A.D. Tank (seismic shockwave)
  V_DTRK = 'DTRK', // Demolition Truck (kamikaze)
  V_V2RL = 'V2RL', // V2 Rocket Launcher
  V_MNLY = 'MNLY', // Minelayer
  // Transport vehicles
  V_TRAN = 'TRAN', // Chinook transport helicopter
  V_LST = 'LST',   // Landing ship transport
  // Naval vessels
  V_SS = 'SS',     // Submarine
  V_DD = 'DD',     // Destroyer
  V_CA = 'CA',     // Cruiser
  V_PT = 'PT',     // Gunboat
  V_MSUB = 'MSUB', // Missile Submarine (Aftermath)
  // Aircraft
  V_MIG = 'MIG',   // MiG-29 fighter (fixed-wing)
  V_YAK = 'YAK',   // Yak attack plane (fixed-wing)
  V_HELI = 'HELI', // Longbow helicopter
  V_HIND = 'HIND', // Hind attack helicopter
}

// === Animation metadata (DoInfoStruct from RA source) ===
export interface DoInfo {
  frame: number;   // starting frame index
  count: number;   // frames per facing (or total if jump=0)
  jump: number;    // stride between facings (0 = no facing variants)
}

export interface InfantryAnim {
  ready: DoInfo;      // DO_STAND_READY — standing idle
  guard?: DoInfo;     // DO_STAND_GUARD — guard idle (falls back to ready)
  walk: DoInfo;       // DO_WALK — walking upright
  fire: DoInfo;       // DO_FIRE_WEAPON — firing while standing
  prone?: DoInfo;     // DO_PRONE — idle while prone
  crawl?: DoInfo;     // DO_CRAWL — moving while prone
  fireProne?: DoInfo; // DO_FIRE_PRONE — firing while prone
  lieDown?: DoInfo;   // DO_LIE_DOWN — transition to prone
  getUp?: DoInfo;     // DO_GET_UP — transition from prone
  die1: DoInfo;       // DO_GUN_DEATH
  die2?: DoInfo;      // DO_EXPLOSION_DEATH
  idle?: DoInfo;      // DO_IDLE1
  idle2?: DoInfo;     // DO_IDLE2
  // Per-type animation rate overrides (C++ MasterDoControls variable timing)
  walkRate?: number;   // ticks per frame for walk (default 3)
  attackRate?: number;  // ticks per frame for attack (default 5)
  idleRate?: number;   // ticks per frame for idle (default 4)
}

// C++ infantry.cpp:90 — HumanShape maps 8-dir enum to SHP sprite direction order.
// SHP files store direction sprites as: N(0), NW(1), W(2), SW(3), S(4), SE(5), E(6), NE(7).
// Our Dir enum is: N(0), NE(1), E(2), SE(3), S(4), SW(5), W(6), NW(7).
export const INFANTRY_SHAPE: number[] = [0, 7, 6, 5, 4, 3, 2, 1];

// Infantry animation layouts per type — exact C++ idata.cpp DoControls values.
// Frame formula: frame + INFANTRY_SHAPE[dir] * jump + animFrame % count
export const INFANTRY_ANIMS: Record<string, InfantryAnim> = {
  E1: { // E1DoControls (idata.cpp:80)
    ready:     { frame: 0,   count: 1,  jump: 1 },
    guard:     { frame: 8,   count: 1,  jump: 1 },
    walk:      { frame: 16,  count: 6,  jump: 6 },
    fire:      { frame: 64,  count: 8,  jump: 8 },
    prone:     { frame: 192, count: 1,  jump: 8 },
    crawl:     { frame: 144, count: 4,  jump: 4 },
    fireProne: { frame: 192, count: 6,  jump: 8 },
    lieDown:   { frame: 128, count: 2,  jump: 2 },
    getUp:     { frame: 176, count: 2,  jump: 2 },
    die1:      { frame: 288, count: 8,  jump: 0 },  // 382-94
    die2:      { frame: 304, count: 8,  jump: 0 },  // 398-94
    idle:      { frame: 256, count: 16, jump: 0 },
    idle2:     { frame: 272, count: 16, jump: 0 },
  },
  E2: { // E2DoControls (idata.cpp:104) — Grenadier
    ready:     { frame: 0,   count: 1,  jump: 1 },
    guard:     { frame: 8,   count: 1,  jump: 1 },
    walk:      { frame: 16,  count: 6,  jump: 6 },
    fire:      { frame: 64,  count: 20, jump: 20 },
    prone:     { frame: 288, count: 1,  jump: 12 },
    crawl:     { frame: 240, count: 4,  jump: 4 },
    fireProne: { frame: 288, count: 8,  jump: 12 },
    lieDown:   { frame: 224, count: 2,  jump: 2 },
    getUp:     { frame: 272, count: 2,  jump: 2 },
    die1:      { frame: 416, count: 8,  jump: 0 },  // 510-94
    die2:      { frame: 432, count: 8,  jump: 0 },  // 526-94
    idle:      { frame: 384, count: 16, jump: 0 },
    idle2:     { frame: 400, count: 16, jump: 0 },
    attackRate: 6,
  },
  E3: { // E3DoControls (idata.cpp:128) — Rocket Soldier
    ready:     { frame: 0,   count: 1,  jump: 1 },
    guard:     { frame: 8,   count: 1,  jump: 1 },
    walk:      { frame: 16,  count: 6,  jump: 6 },
    fire:      { frame: 64,  count: 8,  jump: 8 },
    prone:     { frame: 192, count: 1,  jump: 10 },
    crawl:     { frame: 144, count: 4,  jump: 4 },
    fireProne: { frame: 192, count: 10, jump: 10 },
    lieDown:   { frame: 128, count: 2,  jump: 2 },
    getUp:     { frame: 176, count: 2,  jump: 2 },
    die1:      { frame: 304, count: 8,  jump: 0 },  // 398-94
    die2:      { frame: 320, count: 8,  jump: 0 },  // 414-94
    idle:      { frame: 272, count: 16, jump: 0 },
    idle2:     { frame: 288, count: 16, jump: 0 },
  },
  E4: { // E4DoControls (idata.cpp:152) — Flamethrower
    ready:     { frame: 0,   count: 1,  jump: 1 },
    guard:     { frame: 8,   count: 1,  jump: 1 },
    walk:      { frame: 16,  count: 6,  jump: 6 },
    fire:      { frame: 64,  count: 16, jump: 16 },
    prone:     { frame: 256, count: 1,  jump: 16 },
    crawl:     { frame: 208, count: 4,  jump: 4 },
    fireProne: { frame: 256, count: 16, jump: 16 },
    lieDown:   { frame: 192, count: 2,  jump: 2 },
    getUp:     { frame: 240, count: 2,  jump: 2 },
    die1:      { frame: 416, count: 8,  jump: 0 },  // 510-94
    die2:      { frame: 432, count: 8,  jump: 0 },  // 526-94
    idle:      { frame: 384, count: 16, jump: 0 },
    idle2:     { frame: 400, count: 16, jump: 0 },
    attackRate: 4,
  },
  E6: { // E6DoControls (idata.cpp:176) — Engineer
    ready:     { frame: 0,   count: 1,  jump: 1 },
    guard:     { frame: 8,   count: 1,  jump: 1 },
    walk:      { frame: 16,  count: 6,  jump: 6 },
    fire:      { frame: 0,   count: 0,  jump: 0 },  // engineers don't fire
    prone:     { frame: 82,  count: 1,  jump: 4 },
    crawl:     { frame: 82,  count: 4,  jump: 4 },
    lieDown:   { frame: 67,  count: 2,  jump: 2 },
    getUp:     { frame: 114, count: 2,  jump: 2 },
    die1:      { frame: 146, count: 8,  jump: 0 },
    die2:      { frame: 154, count: 8,  jump: 0 },
    idle:      { frame: 130, count: 16, jump: 0 },
  },
  DOG: { // DogDoControls (idata.cpp:56) — Attack dog
    ready:     { frame: 0,   count: 1,  jump: 1 },
    walk:      { frame: 8,   count: 6,  jump: 6 },
    fire:      { frame: 104, count: 14, jump: 14 },
    crawl:     { frame: 56,  count: 6,  jump: 6 },
    die1:      { frame: 235, count: 7,  jump: 0 },
    die2:      { frame: 242, count: 9,  jump: 0 },
    idle:      { frame: 216, count: 18, jump: 0 },
    walkRate: 2,
  },
  E7: { // E7DoControls (idata.cpp:200) — Shock Trooper
    ready:     { frame: 0,   count: 1,  jump: 1 },
    walk:      { frame: 8,   count: 6,  jump: 6 },
    fire:      { frame: 56,  count: 7,  jump: 7 },
    prone:     { frame: 128, count: 1,  jump: 4 },
    crawl:     { frame: 128, count: 4,  jump: 4 },
    fireProne: { frame: 176, count: 7,  jump: 7 },
    lieDown:   { frame: 113, count: 2,  jump: 2 },
    getUp:     { frame: 161, count: 2,  jump: 2 },
    die1:      { frame: 262, count: 8,  jump: 0 },
    die2:      { frame: 270, count: 8,  jump: 0 },
    idle:      { frame: 232, count: 17, jump: 0 },
    idle2:     { frame: 249, count: 13, jump: 0 },
  },
  SPY: { // SpyDoControls (idata.cpp:225)
    ready:     { frame: 0,   count: 1,  jump: 1 },
    guard:     { frame: 8,   count: 1,  jump: 1 },
    walk:      { frame: 16,  count: 6,  jump: 6 },
    fire:      { frame: 64,  count: 8,  jump: 8 },
    prone:     { frame: 144, count: 1,  jump: 4 },
    crawl:     { frame: 144, count: 4,  jump: 4 },
    fireProne: { frame: 192, count: 8,  jump: 8 },
    lieDown:   { frame: 128, count: 2,  jump: 2 },
    getUp:     { frame: 176, count: 2,  jump: 2 },
    die1:      { frame: 288, count: 8,  jump: 0 },
    die2:      { frame: 296, count: 8,  jump: 0 },
    idle:      { frame: 256, count: 14, jump: 0 },
    idle2:     { frame: 270, count: 18, jump: 0 },
  },
  MECH: { // MedicDoControls (idata.cpp:273) — Mechanic uses same anim set as Medic
    ready:     { frame: 0,   count: 1,  jump: 1 },
    walk:      { frame: 8,   count: 6,  jump: 6 },
    fire:      { frame: 56,  count: 28, jump: 0 },  // heal (non-directional)
    prone:     { frame: 130, count: 1,  jump: 4 },
    crawl:     { frame: 130, count: 4,  jump: 4 },
    lieDown:   { frame: 114, count: 2,  jump: 2 },
    getUp:     { frame: 162, count: 2,  jump: 2 },
    die1:      { frame: 193, count: 8,  jump: 0 },
    die2:      { frame: 210, count: 8,  jump: 0 },
    idle:      { frame: 178, count: 15, jump: 0 },
  },
};
// SHOK uses same sprite/animation as E7 (Shock Trooper = E7 unit type in C++)
INFANTRY_ANIMS.SHOK = INFANTRY_ANIMS.E7;
// MEDI uses same animation layout as MECH (MedicDoControls in idata.cpp:273)
INFANTRY_ANIMS.MEDI = INFANTRY_ANIMS.MECH;

// Vehicle body rotation lookup table (BodyShape[32] from RA source)
// Maps 32-step facing index to sprite frame index
export const BODY_SHAPE: number[] = [
  0, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17,
  16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
];

// Ant animation frame ranges in original ANT*.SHP sheets (112 total frames)
// Standing: 0-7 (8 directions × 1 frame)
// Walking: 8-71 (8 directions × 8 walk frames)
// Attacking: 72-103 (8 directions × 4 attack frames)
// Dying: 104-111 (8-frame shared death sequence)
export const ANT_ANIM = {
  standBase: 0,
  walkBase: 8, walkCount: 8,
  attackBase: 72, attackCount: 4,
  deathBase: 104, deathCount: 8,
};

// === Speed Classes (C++ defines.h:3043-3054, udata.cpp:865 forces all vehicles to WHEEL) ===
export enum SpeedClass {
  FOOT = 0,    // Bipedal (infantry & dogs)
  TRACK = 1,   // Tracked locomotion (unused — udata.cpp:865 overrides all to WHEEL)
  WHEEL = 2,   // All vehicles including tanks, ants, jeep, trucks
  WINGED = 3,  // Aircraft (helicopters, transports)
  FLOAT = 4,   // Ships (LST)
}

// === Terrain speed modifiers from rules.ini [Land Characteristics] ===
// Percentage of full speed for each speed class on each terrain type.
// Index order: [Foot, Track, Wheel, Winged, Float]
// Winged is always 100% (aircraft ignore terrain). Track included for completeness
// even though udata.cpp forces all vehicles to WHEEL class.
export const TERRAIN_SPEED: Record<string, [number, number, number, number, number]> = {
  //                     Foot  Track Wheel Winged Float
  Clear:              [0.90, 0.80, 0.60, 1.0,  0.0 ],
  Rough:              [0.80, 0.70, 0.40, 1.0,  0.0 ],
  Road:               [1.00, 1.00, 1.00, 1.0,  0.0 ],
  Water:              [0.00, 0.00, 0.00, 1.0,  1.0 ],
  Rock:               [0.00, 0.00, 0.00, 1.0,  0.0 ], // impassable cliffs
  Wall:               [0.00, 0.00, 0.00, 1.0,  0.0 ], // impassable walls
  Ore:                [0.90, 0.70, 0.50, 1.0,  0.0 ],
  Beach:              [0.80, 0.70, 0.40, 1.0,  0.0 ],
  River:              [0.00, 0.00, 0.00, 1.0,  0.0 ], // impassable riverbed
};

/** Lookup terrain speed multiplier for a speed class on a terrain type */
export function getTerrainSpeed(terrain: string, speedClass: SpeedClass): number {
  const entry = TERRAIN_SPEED[terrain];
  if (!entry) return 1.0; // unknown terrain defaults to full speed
  return entry[speedClass] ?? 1.0;
}

// === Unit stats from RULES.INI (Red Alert original) ===
// Five armor classes from RA source (warhead.cpp): none, wood, light, heavy, concrete
export type ArmorType = 'none' | 'wood' | 'light' | 'heavy' | 'concrete';

export interface UnitStats {
  type: UnitType;
  name: string;
  image: string;        // sprite asset name
  strength: number;     // max HP
  armor: ArmorType;
  speed: number;        // movement speed (game units)
  speedClass: SpeedClass; // terrain speed class (C++ drive.cpp Ground[terrain].Cost[speed_class])
  sight: number;        // vision range in cells
  rot: number;          // rotation speed
  isInfantry: boolean;
  primaryWeapon: string | null;
  secondaryWeapon?: string | null;
  noMovingFire?: boolean; // must stop to fire (ants, artillery)
  passengers?: number;     // max passenger capacity (transports only)
  guardRange?: number;     // max chase distance in cells for guard behavior (default: sight)
  scanDelay?: number;      // ticks between guard scans (C++ foot.cpp:589-612, default 15)
  crusher?: boolean;       // C++ DriveClass::Ok_To_Move — heavy tracked vehicles crush infantry on cell entry
  crushable?: boolean;     // C++ infantry.cpp — infantry/ants are killed when a crusher drives over them
  isVessel?: boolean;      // true for all naval units (rendering + AI category)
  isCloakable?: boolean;   // true for SS, MSUB (submarine stealth)
  isAntiSub?: boolean;     // true for DD (can detect/attack submerged subs)
  isAircraft?: boolean;      // all aircraft (helicopters + fixed-wing)
  isFixedWing?: boolean;     // cannot hover, always moves forward
  isRotorEquipped?: boolean; // has rotor animation (helicopters)
  landingBuilding?: string;  // preferred pad type ('AFLD' or 'HPAD')
  maxAmmo?: number;          // ammo capacity (rearm at pad)
  owner?: 'allied' | 'soviet' | 'both';  // faction ownership (for production/tech tree)
  cost?: number;             // base credit cost (also in PRODUCTION_ITEMS)
  canSwim?: boolean;         // Agent 9: Tanya can traverse water tiles (C++ amphibious flag)
}

// Warhead types from RA RULES.INI
export type WarheadType = 'SA' | 'HE' | 'AP' | 'Fire' | 'HollowPoint' | 'Super' | 'Organic' | 'Nuke' | 'Mechanical';

// Damage multipliers: warhead vs armor class [none, wood, light, heavy, concrete]
// Values from RULES.INI Verses= lines
export const WARHEAD_VS_ARMOR: Record<WarheadType, [number, number, number, number, number]> = {
  SA:         [1.0,  0.5,  0.6,  0.25, 0.25], // Small Arms — good vs infantry, bad vs armor
  HE:         [0.9,  0.75, 0.6,  0.25, 1.0 ], // High Explosive — good vs concrete/infantry
  AP:         [0.3,  0.75, 0.75, 1.0,  0.5 ], // Armor Piercing — best vs heavy armor
  Fire:       [0.9,  1.0,  0.6,  0.25, 0.5 ], // Fire — good vs wood/infantry
  HollowPoint:[1.0,  0.05, 0.05, 0.05, 0.05], // Hollow Point — anti-infantry only
  Super:      [1.0,  1.0,  1.0,  1.0,  1.0 ], // Super — equal damage to all
  Organic:    [1.0,  0.0,  0.0,  0.0,  0.0 ], // Organic — kills unarmored only (dogs)
  Nuke:       [0.9,  1.0,  0.6,  0.25, 0.5 ], // Nuke — same verses as Fire (rules.ini: 90%,100%,60%,25%,50%)
  Mechanical: [1.0,  1.0,  1.0,  1.0,  1.0 ], // Mechanical — vehicle repair/heal applies equally to all armor
};

/** Map ArmorType string to WARHEAD_VS_ARMOR index */
export function armorIndex(armor: ArmorType): number {
  switch (armor) {
    case 'none': return 0;
    case 'wood': return 1;
    case 'light': return 2;
    case 'heavy': return 3;
    case 'concrete': return 4;
  }
}

/** Lookup warhead-vs-armor damage multiplier from the WARHEAD_VS_ARMOR table */
export function getWarheadMultiplier(warhead: WarheadType, armor: ArmorType): number {
  return WARHEAD_VS_ARMOR[warhead]?.[armorIndex(armor)] ?? 1;
}

// Warhead properties from C++ warhead.cpp — infantryDeath selects death animation,
// explosionSet picks the visual explosion sprite
export interface WarheadProps {
  infantryDeath: number;   // rules.ini InfDeath: 0=instant, 1=twirl, 2=explode, 3=flying, 4=burn, 5=electro
  explosionSet: string;    // sprite name for explosion effect
}

export const WARHEAD_PROPS: Record<WarheadType, WarheadProps> = {
  SA:          { infantryDeath: 1, explosionSet: 'piff' },       // InfDeath=1 (twirl), Explosion=2 (piffs)
  HE:          { infantryDeath: 2, explosionSet: 'veh-hit1' },   // InfDeath=2 (explode), Explosion=5 (pops)
  AP:          { infantryDeath: 3, explosionSet: 'piff' },       // InfDeath=3 (flying), Explosion=4 (frags)
  Fire:        { infantryDeath: 4, explosionSet: 'napalm1' },    // InfDeath=4 (burn), Explosion=3 (fire)
  HollowPoint: { infantryDeath: 1, explosionSet: 'piff' },       // InfDeath=1 (twirl), Explosion=1 (piff)
  Super:       { infantryDeath: 5, explosionSet: 'atomsfx' },    // InfDeath=5 (electro), no Explosion
  Organic:     { infantryDeath: 0, explosionSet: 'piff' },       // InfDeath=0 (instant), no Explosion
  Nuke:        { infantryDeath: 4, explosionSet: 'atomsfx' },    // InfDeath=4 (burn), Explosion=6 (nuke)
  Mechanical:  { infantryDeath: 0, explosionSet: 'piff' },       // engine-only (not in rules.ini)
};

export interface WeaponStats {
  name: string;
  damage: number;
  rof: number;    // rate of fire (ticks between shots)
  range: number;  // range in cells
  warhead: WarheadType;
  splash?: number;    // AOE splash radius in cells (0 = point damage only)
  inaccuracy?: number; // scatter radius in cells (0 = perfect aim)
  minRange?: number;   // minimum range in cells (artillery can't fire at close range)
  projectileSpeed?: number; // cells/tick travel speed (undefined = instant hit)
  projSpeed?: number;  // per-weapon projectile speed in cells/second (C++ BulletClass Speed field)
  burst?: number;      // shots per trigger pull (C++ weapon.cpp:78 Weapon.Burst, default 1)
  isArcing?: boolean;       // C4: ballistic arc trajectory (artillery, grenades) — bullet.cpp:359
  projectileROT?: number;   // C9: homing turn rate deg/tick (0=straight line) — bullet.cpp:368
  isSubSurface?: boolean;   // travels underwater, only hits naval units (torpedoes)
  isAntiSub?: boolean;      // can hit submerged submarines (depth charges)
  isAntiAir?: boolean;      // can target airborne aircraft (SAM missiles, AA guns)
  // WH5: BulletTypeClass properties (C++ bullet.h)
  isInaccurate?: boolean;   // forced scatter on every shot regardless of weapon inaccuracy
  isFueled?: boolean;       // projectile has fuel counter; detonates when empty
  isInvisible?: boolean;    // instant-hit, no projectile visual (light-speed weapons)
  isDropping?: boolean;     // vertical drop trajectory (parabombs)
  isParachuted?: boolean;   // parachute visual during descent
  isGigundo?: boolean;      // large explosion sprite on impact (V2RL, nukes)
}

// C6: Warhead splash falloff properties — warhead.cpp:72
// spreadFactor shapes the splash damage curve: higher = wider splash, slower falloff (C++ combat.cpp:107)
// C7: Wall/wood destruction flags — combat.cpp:244-270
export interface WarheadMeta {
  spreadFactor: number;      // 1=linear, 2=wider splash (slower falloff), 3=widest splash
  destroysWalls?: boolean;   // can destroy wall structures (FENC, BRIK, SBAG, BARB, WOOD)
  destroysWood?: boolean;    // can destroy trees and wooden overlays
  destroysOre?: boolean;     // can destroy ore overlays (Ore=yes in rules.ini)
}

export const WARHEAD_META: Record<WarheadType, WarheadMeta> = {
  SA:          { spreadFactor: 3 },                                                              // Spread=3
  HE:          { spreadFactor: 6, destroysWalls: true, destroysWood: true, destroysOre: true },   // Spread=6, Wall=yes, Wood=yes, Ore=yes (C++ Tiberium=yes)
  AP:          { spreadFactor: 3, destroysWalls: true, destroysWood: true },                     // Spread=3, Wall=yes, Wood=yes
  Fire:        { spreadFactor: 8, destroysWood: true },                                          // Spread=8, Wood=yes
  HollowPoint: { spreadFactor: 1 },                                                             // Spread=1
  Super:       { spreadFactor: 1 },                                                              // Spread=1 (no Wall/Wood)
  Organic:     { spreadFactor: 0 },                                                              // Spread=0
  Nuke:        { spreadFactor: 6, destroysWalls: true, destroysWood: true, destroysOre: true },  // Spread=6, Wall=yes, Wood=yes, Ore=yes
  Mechanical:  { spreadFactor: 0 },                                                              // engine-only (not in rules.ini)
};

// Unit stats from RULES.INI — real Red Alert values
// crusher: C++ DriveClass::Ok_To_Move — heavy tracked vehicles (Crusher=yes in RULES.INI)
// crushable: C++ infantry.cpp — infantry and ants die when a crusher enters their cell
export const UNIT_STATS: Record<string, UnitStats> = {
  // Speed values are C++ MPH (leptons/tick from SPEED.H); converted to px/tick by MPH_TO_PX in game loop.
  // MPH constants: VERY_SLOW=2, KINDA_SLOW=4, SLOW=6, SLOW_ISH=8, MEDIUM_SLOW=10,
  //   MEDIUM=12, MEDIUM_FAST=14, MEDIUM_FASTER=18, FAST=24, ROCKET=60
  // Ants (from SCA scenario INI files) — crushable by heavy tanks (core ant mission tactic)
  ANT1: { type: UnitType.ANT1, name: 'Warrior Ant', image: 'ant1', strength: 125, armor: 'heavy', speed: 14, speedClass: SpeedClass.WHEEL, sight: 3, rot: 8, isInfantry: false, primaryWeapon: 'Mandible', noMovingFire: true, scanDelay: 10, crushable: true },
  ANT2: { type: UnitType.ANT2, name: 'Fire Ant', image: 'ant2', strength: 75, armor: 'heavy', speed: 14, speedClass: SpeedClass.WHEEL, sight: 3, rot: 6, isInfantry: false, primaryWeapon: 'FireballLauncher', noMovingFire: true, scanDelay: 10, crushable: true },
  ANT3: { type: UnitType.ANT3, name: 'Scout Ant', image: 'ant3', strength: 85, armor: 'light', speed: 12, speedClass: SpeedClass.WHEEL, sight: 3, rot: 9, isInfantry: false, primaryWeapon: 'TeslaZap', noMovingFire: true, scanDelay: 10, crushable: true },
  // Vehicles (C++ udata.cpp MPH values) — crusher=true for heavy tracked vehicles per C++ Crusher flag
  '1TNK': { type: UnitType.V_1TNK, name: 'Light Tank', image: '1tnk', strength: 300, armor: 'heavy', speed: 9, speedClass: SpeedClass.WHEEL, sight: 4, rot: 5, isInfantry: false, primaryWeapon: '75mm', scanDelay: 12, crusher: true },
  '2TNK': { type: UnitType.V_2TNK, name: 'Medium Tank', image: '2tnk', strength: 400, armor: 'heavy', speed: 8, speedClass: SpeedClass.WHEEL, sight: 5, rot: 5, isInfantry: false, primaryWeapon: '90mm', scanDelay: 12, crusher: true },
  '3TNK': { type: UnitType.V_3TNK, name: 'Heavy Tank', image: '3tnk', strength: 400, armor: 'heavy', speed: 7, speedClass: SpeedClass.WHEEL, sight: 5, rot: 5, isInfantry: false, primaryWeapon: '105mm', secondaryWeapon: '105mm', scanDelay: 12, crusher: true },
  '4TNK': { type: UnitType.V_4TNK, name: 'Mammoth Tank', image: '4tnk', strength: 600, armor: 'heavy', speed: 6, speedClass: SpeedClass.WHEEL, sight: 6, rot: 5, isInfantry: false, primaryWeapon: '120mm', secondaryWeapon: 'MammothTusk', scanDelay: 12, crusher: true },
  JEEP:   { type: UnitType.V_JEEP, name: 'Ranger', image: 'jeep', strength: 150, armor: 'light', speed: 12, speedClass: SpeedClass.WHEEL, sight: 6, rot: 10, isInfantry: false, primaryWeapon: 'M60mg', scanDelay: 10 },
  APC:    { type: UnitType.V_APC, name: 'APC', image: 'apc', strength: 200, armor: 'heavy', speed: 10, speedClass: SpeedClass.WHEEL, sight: 5, rot: 5, isInfantry: false, primaryWeapon: 'M60mg', passengers: 5 },
  ARTY:   { type: UnitType.V_ARTY, name: 'Artillery', image: 'arty', strength: 75, armor: 'light', speed: 6, speedClass: SpeedClass.WHEEL, sight: 5, rot: 2, isInfantry: false, primaryWeapon: '155mm', noMovingFire: true, scanDelay: 20 },
  HARV:   { type: UnitType.V_HARV, name: 'Harvester', image: 'harv', strength: 600, armor: 'heavy', speed: 6, speedClass: SpeedClass.WHEEL, sight: 4, rot: 5, isInfantry: false, primaryWeapon: null, crusher: true },
  MCV:    { type: UnitType.V_MCV, name: 'MCV', image: 'mcv', strength: 600, armor: 'light', speed: 6, speedClass: SpeedClass.WHEEL, sight: 4, rot: 5, isInfantry: false, primaryWeapon: null, crusher: true },
  TRUK:   { type: UnitType.V_TRUK, name: 'Supply Truck', image: 'truk', strength: 110, armor: 'light', speed: 7, speedClass: SpeedClass.WHEEL, sight: 3, rot: 5, isInfantry: false, primaryWeapon: null },
  // Infantry (C++ idata.cpp MPH values) — all infantry are crushable
  E1:   { type: UnitType.I_E1, name: 'Rifle Infantry', image: 'e1', strength: 50, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 4, rot: 8, isInfantry: true, primaryWeapon: 'M1Carbine', crushable: true },
  E2:   { type: UnitType.I_E2, name: 'Grenadier', image: 'e2', strength: 50, armor: 'none', speed: 3, speedClass: SpeedClass.FOOT, sight: 4, rot: 8, isInfantry: true, primaryWeapon: 'Grenade', crushable: true, owner: 'soviet' },
  E3:   { type: UnitType.I_E3, name: 'Rocket Soldier', image: 'e3', strength: 45, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 4, rot: 8, isInfantry: true, primaryWeapon: 'RedEye', secondaryWeapon: 'Dragon', scanDelay: 20, crushable: true, owner: 'allied' },
  E4:   { type: UnitType.I_E4, name: 'Flamethrower', image: 'e4', strength: 40, armor: 'none', speed: 3, speedClass: SpeedClass.FOOT, sight: 4, rot: 8, isInfantry: true, primaryWeapon: 'Flamer', crushable: true },
  E6:   { type: UnitType.I_E6, name: 'Engineer', image: 'e6', strength: 25, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 4, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  DOG:  { type: UnitType.I_DOG, name: 'Attack Dog', image: 'dog', strength: 12, armor: 'none', speed: 6, speedClass: SpeedClass.FOOT, sight: 5, rot: 8, isInfantry: true, primaryWeapon: 'DogJaw', scanDelay: 8, crushable: true },
  SPY:  { type: UnitType.I_SPY, name: 'Spy', image: 'spy', strength: 25, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 5, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  MEDI: { type: UnitType.I_MEDI, name: 'Medic', image: 'medi', strength: 80, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 3, rot: 8, isInfantry: true, primaryWeapon: 'Heal', crushable: true },
  GNRL: { type: UnitType.I_GNRL, name: 'Stavros', image: 'e1', strength: 80, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 3, rot: 8, isInfantry: true, primaryWeapon: 'Pistol', crushable: true },
  CHAN: { type: UnitType.I_CHAN, name: 'Specialist', image: 'e1', strength: 25, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  // Civilians — crushable
  C1: { type: UnitType.I_C1, name: 'Civilian', image: 'c1', strength: 25, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: 'Pistol', crushable: true },
  C2: { type: UnitType.I_C2, name: 'Civilian', image: 'c1', strength: 25, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  C3: { type: UnitType.I_C3, name: 'Civilian', image: 'c2', strength: 25, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  C4: { type: UnitType.I_C4, name: 'Civilian', image: 'c2', strength: 25, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  C5: { type: UnitType.I_C5, name: 'Civilian', image: 'c2', strength: 25, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  C6: { type: UnitType.I_C6, name: 'Civilian', image: 'c1', strength: 25, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  C7: { type: UnitType.I_C7, name: 'Civilian', image: 'c1', strength: 25, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: 'Pistol', crushable: true },
  C8: { type: UnitType.I_C8, name: 'Civilian', image: 'c1', strength: 25, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  C9: { type: UnitType.I_C9, name: 'Civilian', image: 'c1', strength: 25, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  C10: { type: UnitType.I_C10, name: 'Civilian', image: 'c1', strength: 25, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  EINSTEIN: { type: UnitType.I_EINSTEIN, name: 'Prof. Einstein', image: 'einstein', strength: 25, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  // Counterstrike/Aftermath expansion infantry — crushable
  SHOK: { type: UnitType.I_SHOK, name: 'Shock Trooper', image: 'shok', strength: 80, armor: 'none', speed: 5, speedClass: SpeedClass.FOOT, sight: 4, rot: 8, isInfantry: true, primaryWeapon: 'PortaTesla', crushable: true },
  MECH: { type: UnitType.I_MECH, name: 'Mechanic', image: 'medi', strength: 60, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 3, rot: 8, isInfantry: true, primaryWeapon: 'GoodWrench', crushable: true },
  // Counterstrike/Aftermath expansion vehicles — crusher for tank variants
  STNK: { type: UnitType.V_STNK, name: 'Phase Transport', image: 'stnk', strength: 200, armor: 'heavy', speed: 9, speedClass: SpeedClass.WHEEL, sight: 5, rot: 5, isInfantry: false, primaryWeapon: 'APTusk', passengers: 1, crusher: true, isCloakable: true },
  CTNK: { type: UnitType.V_CTNK, name: 'Chrono Tank', image: 'ctnk', strength: 350, armor: 'light', speed: 8, speedClass: SpeedClass.WHEEL, sight: 5, rot: 5, isInfantry: false, primaryWeapon: 'APTusk', crusher: true },
  TTNK: { type: UnitType.V_TTNK, name: 'Tesla Tank', image: 'ttnk', strength: 110, armor: 'light', speed: 10, speedClass: SpeedClass.WHEEL, sight: 7, rot: 5, isInfantry: false, primaryWeapon: 'TTankZap', crusher: true },
  QTNK: { type: UnitType.V_QTNK, name: 'M.A.D. Tank', image: 'qtnk', strength: 300, armor: 'heavy', speed: 6, speedClass: SpeedClass.WHEEL, sight: 6, rot: 5, isInfantry: false, primaryWeapon: null, crusher: true },
  DTRK: { type: UnitType.V_DTRK, name: 'Demo Truck', image: 'dtrk', strength: 110, armor: 'light', speed: 7, speedClass: SpeedClass.WHEEL, sight: 3, rot: 5, isInfantry: false, primaryWeapon: 'Democharge' },
  // Transport vehicles
  TRAN: { type: UnitType.V_TRAN, name: 'Chinook', image: 'tran', strength: 90, armor: 'light', speed: 12, speedClass: SpeedClass.WINGED, sight: 0, rot: 5, isInfantry: false, primaryWeapon: null, passengers: 5, isAircraft: true, isRotorEquipped: true, landingBuilding: 'HPAD' },
  LST: { type: UnitType.V_LST, name: 'Transport', image: 'lst', strength: 350, armor: 'heavy', speed: 8, speedClass: SpeedClass.FLOAT, sight: 6, rot: 10, isInfantry: false, primaryWeapon: null, passengers: 5, isVessel: true },
  // Naval vessels (C++ vdata.cpp MPH values)
  SS: { type: UnitType.V_SS, name: 'Submarine', image: 'ss', strength: 120, armor: 'light', speed: 6, speedClass: SpeedClass.FLOAT, sight: 6, rot: 7, isInfantry: false, primaryWeapon: 'TorpTube', isVessel: true, isCloakable: true },
  DD: { type: UnitType.V_DD, name: 'Destroyer', image: 'dd', strength: 400, armor: 'heavy', speed: 8, speedClass: SpeedClass.FLOAT, sight: 6, rot: 7, isInfantry: false, primaryWeapon: 'Stinger', secondaryWeapon: 'DepthCharge', isVessel: true, isAntiSub: true },
  CA: { type: UnitType.V_CA, name: 'Cruiser', image: 'ca', strength: 700, armor: 'heavy', speed: 6, speedClass: SpeedClass.FLOAT, sight: 7, rot: 5, isInfantry: false, primaryWeapon: '8Inch', secondaryWeapon: '8Inch', isVessel: true },
  PT: { type: UnitType.V_PT, name: 'Gunboat', image: 'pt', strength: 200, armor: 'heavy', speed: 10, speedClass: SpeedClass.FLOAT, sight: 7, rot: 7, isInfantry: false, primaryWeapon: '2Inch', secondaryWeapon: 'DepthCharge', isVessel: true },
  MSUB: { type: UnitType.V_MSUB, name: 'Missile Sub', image: 'msub', strength: 150, armor: 'light', speed: 6, speedClass: SpeedClass.FLOAT, sight: 6, rot: 7, isInfantry: false, primaryWeapon: 'SubSCUD', isVessel: true, isCloakable: true },
  // Aircraft (C++ aadata.cpp MPH values)
  MIG:  { type: UnitType.V_MIG, name: 'MiG', image: 'mig', strength: 50, armor: 'light', speed: 20, speedClass: SpeedClass.WINGED, sight: 0, rot: 5, isInfantry: false, primaryWeapon: 'Maverick', secondaryWeapon: 'Maverick', isAircraft: true, isFixedWing: true, landingBuilding: 'AFLD', maxAmmo: 3 },
  YAK:  { type: UnitType.V_YAK, name: 'Yak', image: 'yak', strength: 60, armor: 'light', speed: 18, speedClass: SpeedClass.WINGED, sight: 0, rot: 5, isInfantry: false, primaryWeapon: 'ChainGun', secondaryWeapon: 'ChainGun', isAircraft: true, isFixedWing: true, landingBuilding: 'AFLD', maxAmmo: 15 },
  HELI: { type: UnitType.V_HELI, name: 'Longbow', image: 'heli', strength: 225, armor: 'heavy', speed: 14, speedClass: SpeedClass.WINGED, sight: 0, rot: 4, isInfantry: false, primaryWeapon: 'Hellfire', secondaryWeapon: 'Hellfire', isAircraft: true, isRotorEquipped: true, landingBuilding: 'HPAD', maxAmmo: 6 },
  HIND: { type: UnitType.V_HIND, name: 'Hind', image: 'hind', strength: 225, armor: 'heavy', speed: 14, speedClass: SpeedClass.WINGED, sight: 0, rot: 4, isInfantry: false, primaryWeapon: 'ChainGun', isAircraft: true, isRotorEquipped: true, landingBuilding: 'HPAD', maxAmmo: 12 },
  // Tanya & Thief (new infantry)
  E7:   { type: UnitType.I_TANYA, name: 'Tanya', image: 'e1', strength: 100, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 6, rot: 8, isInfantry: true, primaryWeapon: 'Colt45', secondaryWeapon: 'Colt45', crushable: true, owner: 'both', cost: 1200, canSwim: true },
  THF:  { type: UnitType.I_THF, name: 'Thief', image: 'e1', strength: 25, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 5, rot: 8, isInfantry: true, primaryWeapon: null, secondaryWeapon: null, crushable: true, owner: 'allied', cost: 500 },
  // Expansion vehicles (V2 Rocket, Minelayer)
  V2RL: { type: UnitType.V_V2RL, name: 'V2 Rocket', image: 'v2rl', strength: 150, armor: 'light', speed: 7, speedClass: SpeedClass.WHEEL, sight: 5, rot: 5, isInfantry: false, primaryWeapon: 'SCUD', secondaryWeapon: null, owner: 'soviet', cost: 700, noMovingFire: true },
  MNLY: { type: UnitType.V_MNLY, name: 'Minelayer', image: 'mnly', strength: 100, armor: 'heavy', speed: 7, speedClass: SpeedClass.WHEEL, sight: 5, rot: 5, isInfantry: false, primaryWeapon: null, secondaryWeapon: null, owner: 'both', cost: 800 },
};

// Weapon stats from RULES.INI — real RA values
// projSpeed: per-weapon projectile visual speed in cells/second (C++ BulletClass::AI Speed field)
export const WEAPON_STATS: Record<string, WeaponStats> = {
  // Infantry weapons
  M1Carbine:        { name: 'M1Carbine',        damage: 15,  rof: 20, range: 3.0,  warhead: 'SA', projSpeed: 40, isInvisible: true },
  Grenade:          { name: 'Grenade',           damage: 50,  rof: 60, range: 4.0,  warhead: 'HE', splash: 1.5, inaccuracy: 0.5, projectileSpeed: 0.33, isArcing: true, projSpeed: 12 },
  Dragon:           { name: 'Dragon',            damage: 35,  rof: 50, range: 5.0,  warhead: 'AP', projectileSpeed: 1.67, projectileROT: 5, projSpeed: 15 },
  RedEye:           { name: 'RedEye',            damage: 50,  rof: 50, range: 7.5,  warhead: 'AP', projectileSpeed: 3.33, projectileROT: 5, projSpeed: 15, isAntiAir: true },
  Flamer:           { name: 'Flamer',            damage: 70,  rof: 50, range: 3.5,  warhead: 'Fire', splash: 1.0, projectileSpeed: 0.8, projSpeed: 20 },
  DogJaw:           { name: 'DogJaw',            damage: 100, rof: 10, range: 2.2,  warhead: 'Organic', projSpeed: 40, isInvisible: true },
  Heal:             { name: 'Heal',              damage: -50, rof: 80, range: 1.83, warhead: 'Organic', projSpeed: 40 },
  Sniper:           { name: 'Sniper',            damage: 100, rof: 5,  range: 3.75, warhead: 'HollowPoint', projSpeed: 40, isInvisible: true },
  // Vehicle weapons
  M60mg:            { name: 'M60mg',             damage: 15,  rof: 20, range: 4.0,  warhead: 'SA', projSpeed: 40, isInvisible: true },
  '75mm':           { name: '75mm',              damage: 25,  rof: 40, range: 4.0,  warhead: 'AP', projectileSpeed: 2.67, projSpeed: 30 },
  '90mm':           { name: '90mm',              damage: 30,  rof: 50, range: 4.75, warhead: 'AP', projectileSpeed: 2.67, projSpeed: 30 },
  '105mm':          { name: '105mm',             damage: 30,  rof: 70, range: 4.75, warhead: 'AP', projectileSpeed: 2.67, projSpeed: 30 },
  '120mm':          { name: '120mm',             damage: 40,  rof: 80, range: 4.75, warhead: 'AP', projectileSpeed: 2.67, projSpeed: 30, burst: 2 },
  MammothTusk:      { name: 'MammothTusk',       damage: 75,  rof: 80, range: 5.0,  warhead: 'HE', splash: 1.5, projectileSpeed: 2.0, burst: 2, projectileROT: 5, projSpeed: 15 },
  '155mm':          { name: '155mm',             damage: 150, rof: 65, range: 6.0,  warhead: 'HE', splash: 2.0, inaccuracy: 1.5, minRange: 2.0, projectileSpeed: 0.8, isArcing: true, projSpeed: 12, isInaccurate: true },
  TeslaCannon:      { name: 'TeslaCannon',       damage: 100, rof: 120, range: 8.5, warhead: 'Super', splash: 1.0, projSpeed: 40 },
  // Counterstrike/Aftermath expansion weapons
  PortaTesla:       { name: 'PortaTesla',        damage: 45,  rof: 70, range: 3.5,  warhead: 'Super', splash: 0.5, projSpeed: 40 }, // Shock Trooper
  GoodWrench:       { name: 'GoodWrench',        damage: -100, rof: 80, range: 1.83, warhead: 'Mechanical', projSpeed: 40 },        // Mechanic (heals vehicles)
  APTusk:           { name: 'APTusk',             damage: 75,  rof: 80, range: 5.0,  warhead: 'AP', projSpeed: 40, burst: 2 },       // Chrono Tank missile
  TTankZap:         { name: 'TTankZap',           damage: 100, rof: 120, range: 7.0,  warhead: 'Super', splash: 1.0, projSpeed: 40 }, // Tesla Tank
  // Naval weapons (C++ RULES.INI — vessel.cpp)
  Stinger:          { name: 'Stinger',          damage: 30,  rof: 60, range: 9.0,  warhead: 'AP', projSpeed: 40, burst: 2 },                                 // DD primary naval gun
  TorpTube:         { name: 'TorpTube',         damage: 90,  rof: 60, range: 9.0,  warhead: 'AP', projSpeed: 15, projectileSpeed: 1.0, isSubSurface: true }, // SS torpedo, underwater travel
  DepthCharge:      { name: 'DepthCharge',       damage: 80,  rof: 60, range: 5.0,  warhead: 'AP', projSpeed: 12, isAntiSub: true },                         // DD secondary, hits submerged subs
  Tomahawk:         { name: 'Tomahawk',          damage: 50,  rof: 80, range: 10.0, warhead: 'HE', splash: 2.0, projSpeed: 15, projectileSpeed: 2.0, projectileROT: 5, burst: 2 }, // CA cruise missile
  SeaSerpent:       { name: 'SeaSerpent',        damage: 35,  rof: 50, range: 8.0,  warhead: 'HE', splash: 1.5, projSpeed: 15, projectileSpeed: 2.0, projectileROT: 5, burst: 2 }, // MSUB missiles
  SubSCUD:          { name: 'SubSCUD',          damage: 400, rof: 120, range: 14.0, warhead: 'HE', projSpeed: 20, projectileSpeed: 2.0, projectileROT: 5, burst: 2 }, // Aftermath missile sub missile
  Democharge:       { name: 'Democharge',       damage: 500, rof: 80, range: 1.75, warhead: 'Nuke', projSpeed: 40 }, // Demo truck self-destruct charge
  // Aircraft weapons (C++ RULES.INI — aircraft.cpp)
  Maverick:         { name: 'Maverick',          damage: 50,  rof: 3,  range: 6.0,  warhead: 'AP', projSpeed: 15, projectileSpeed: 2.0, projectileROT: 5 },  // Air-to-ground missile (MIG)
  Hellfire:         { name: 'Hellfire',           damage: 40,  rof: 60, range: 4.0,  warhead: 'AP', splash: 1.0, projSpeed: 15, projectileSpeed: 2.0, projectileROT: 5 },  // Helicopter missile (HELI)
  ChainGun:         { name: 'ChainGun',           damage: 40,  rof: 3,  range: 5.0,  warhead: 'SA', projSpeed: 40 },  // Rapid-fire hitscan (HIND/YAK)
  // New parity weapons
  '8Inch':          { name: '8Inch',             damage: 500, rof: 160, range: 22.0, warhead: 'HE', projSpeed: 30, isArcing: true, inaccuracy: 1.0 },  // Cruiser main gun
  '2Inch':          { name: '2Inch',             damage: 25,  rof: 60, range: 5.5,  warhead: 'AP', projSpeed: 40 },  // Gunboat weapon
  Colt45:           { name: 'Colt45',            damage: 50,  rof: 5,  range: 5.75, warhead: 'HollowPoint', projSpeed: 40, isInvisible: true },  // Tanya's dual pistols
  Pistol:           { name: 'Pistol',            damage: 1,   rof: 7,  range: 1.75, warhead: 'SA', projSpeed: 40 },  // Stavros/civilian
  SCUD:             { name: 'SCUD',              damage: 600, rof: 400, range: 10.0, warhead: 'HE', projSpeed: 25, projectileSpeed: 2.0, splash: 2.0, inaccuracy: 1.5, isGigundo: true, isFueled: true },  // V2 Rocket (C++ FROG: speed=25, High=yes, Proximity=yes, Gigundo=yes, Fueled=yes)
  // Ant weapons (from SCA scenario INI files + C++ udata.cpp comments)
  Mandible:         { name: 'Mandible',          damage: 50,  rof: 15, range: 1.5,  warhead: 'Super', projSpeed: 40 }, // C++: Warhead=Super (combat.cpp confirms)
  TeslaZap:         { name: 'TeslaZap',          damage: 60,  rof: 25, range: 1.75, warhead: 'Super', projSpeed: 40 },
  FireballLauncher: { name: 'FireballLauncher',   damage: 125, rof: 50, range: 4.0,  warhead: 'Fire', splash: 1.5, projectileSpeed: 0.8, projSpeed: 15 },
  Napalm:           { name: 'Napalm',            damage: 100, rof: 20, range: 4.5,  warhead: 'Fire', projSpeed: 12 },
  Camera:           { name: 'Camera',            damage: 0,   rof: 1,  range: 10,   warhead: 'SA', projSpeed: 40 },  // Spy plane reveal (0 damage, reveals area)
};

// === Superweapon System ===
export enum SuperweaponType {
  CHRONOSPHERE = 'CHRONOSPHERE',
  IRON_CURTAIN = 'IRON_CURTAIN',
  NUKE = 'NUKE',
  GPS_SATELLITE = 'GPS_SATELLITE',
  SONAR_PULSE = 'SONAR_PULSE',
  PARABOMB = 'PARABOMB',
  PARAINFANTRY = 'PARAINFANTRY',
  SPY_PLANE = 'SPY_PLANE',
}

export interface SuperweaponDef {
  type: SuperweaponType;
  name: string;
  building: string;           // structure type that provides it
  rechargeTicks: number;      // full recharge time in game ticks
  faction: 'allied' | 'soviet' | 'both';
  requiresPower: boolean;     // pauses charging when low power
  needsTarget: boolean;       // requires player to click a target
  targetMode: 'unit' | 'ground' | 'none';
}

export const SUPERWEAPON_DEFS: Record<SuperweaponType, SuperweaponDef> = {
  [SuperweaponType.CHRONOSPHERE]: {
    type: SuperweaponType.CHRONOSPHERE, name: 'Chronosphere',
    building: 'PDOX', rechargeTicks: 6300, faction: 'allied',  // 7 min × 60 × 15 FPS
    requiresPower: true, needsTarget: true, targetMode: 'ground',
  },
  [SuperweaponType.IRON_CURTAIN]: {
    type: SuperweaponType.IRON_CURTAIN, name: 'Iron Curtain',
    building: 'IRON', rechargeTicks: 9900, faction: 'soviet',  // 11 min × 60 × 15 FPS
    requiresPower: true, needsTarget: true, targetMode: 'unit',
  },
  [SuperweaponType.NUKE]: {
    type: SuperweaponType.NUKE, name: 'Nuclear Strike',
    building: 'MSLO', rechargeTicks: 11700, faction: 'soviet',  // 13 min × 60 × 15 FPS
    requiresPower: true, needsTarget: true, targetMode: 'ground',
  },
  [SuperweaponType.GPS_SATELLITE]: {
    type: SuperweaponType.GPS_SATELLITE, name: 'GPS Satellite',
    building: 'ATEK', rechargeTicks: 7200, faction: 'allied',  // 8 min × 60 × 15 FPS
    requiresPower: true, needsTarget: false, targetMode: 'none',
  },
  [SuperweaponType.SONAR_PULSE]: {
    type: SuperweaponType.SONAR_PULSE, name: 'Sonar Pulse',
    building: '', rechargeTicks: 9000, faction: 'both',    // spy-only — granted by spyInfiltrate() on SPEN
    requiresPower: true, needsTarget: false, targetMode: 'none',
  },
  [SuperweaponType.PARABOMB]: {
    type: SuperweaponType.PARABOMB, name: 'Parabomb',
    building: 'AFLD', rechargeTicks: 9000, faction: 'soviet',
    requiresPower: true, needsTarget: true, targetMode: 'ground',
  },
  [SuperweaponType.PARAINFANTRY]: {
    type: SuperweaponType.PARAINFANTRY, name: 'Paratroopers',
    building: 'AFLD', rechargeTicks: 9000, faction: 'both',
    requiresPower: true, needsTarget: true, targetMode: 'ground',
  },
  [SuperweaponType.SPY_PLANE]: {
    type: SuperweaponType.SPY_PLANE, name: 'Spy Plane',
    building: 'AFLD', rechargeTicks: 1800, faction: 'both',  // C++ Rule.SpyTime=2min, AIRSTRIP req, both factions
    requiresPower: true, needsTarget: true, targetMode: 'ground',
  },
};

// Superweapon gameplay constants
export const IRON_CURTAIN_DURATION = 675;       // 0.75 min × 60 × 15 FPS = 45 seconds
export const NUKE_DAMAGE = 1000;
export const NUKE_BLAST_CELLS = 10;             // blast radius in cells
export const NUKE_FLIGHT_TICKS = 45;            // missile travel time
export const NUKE_MIN_FALLOFF = 0.1;            // minimum damage fraction at edge
export const CHRONO_SHIFT_VISUAL_TICKS = 30;    // blue flash duration
export const SONAR_REVEAL_TICKS = 450;          // sonar pulse reveal duration (30s)
export const IC_TARGET_RANGE = 3;               // Iron Curtain click-to-unit search radius in cells

// === Superweapon state interface ===
export interface SuperweaponState {
  type: SuperweaponType;
  house: House;
  chargeTick: number;
  ready: boolean;
  structureIndex: number;
  fired: boolean;  // GPS: one-shot flag
}

// === Production data ===

export interface ProductionItem {
  type: string;         // unit type or structure type code
  name: string;         // display name
  cost: number;         // credits cost
  buildTime: number;    // ticks to build
  prerequisite: string; // required building type (TENT/BARR→infantry, WEAP→vehicles, FACT→structures)
  techPrereq?: string;  // additional building required (e.g. DOME for Artillery)
  techLevel?: number;   // rules.ini TechLevel — items above player's level are hidden
  faction: Faction;     // which faction can build this
  isStructure?: boolean;
}

export const PRODUCTION_ITEMS: ProductionItem[] = [
  // Infantry (from TENT/BARR) — faction + techLevel from rules.ini
  { type: 'E1', name: 'Rifle', cost: 100, buildTime: 45, prerequisite: 'TENT', faction: 'both', techLevel: 1 },
  { type: 'E2', name: 'Grenadier', cost: 160, buildTime: 55, prerequisite: 'TENT', faction: 'soviet', techLevel: 1 },
  { type: 'E3', name: 'Rocket', cost: 300, buildTime: 75, prerequisite: 'TENT', faction: 'allied', techLevel: 2 },  // rules.ini Owner=allies (line 829)
  { type: 'E4', name: 'Flame', cost: 300, buildTime: 75, prerequisite: 'TENT', faction: 'soviet', techPrereq: 'STEK', techLevel: 6 },  // rules.ini Prerequisite=stek (line 836)
  { type: 'E6', name: 'Engineer', cost: 500, buildTime: 100, prerequisite: 'TENT', faction: 'both', techLevel: 5 },
  { type: 'DOG', name: 'Dog', cost: 200, buildTime: 30, prerequisite: 'KENN', faction: 'soviet', techLevel: 3 },  // rules.ini Prerequisite=kenn (line 781)
  { type: 'MEDI', name: 'Medic', cost: 800, buildTime: 90, prerequisite: 'TENT', faction: 'allied', techLevel: 2 },
  // Vehicles (from WEAP) — faction + techLevel from rules.ini
  { type: 'JEEP', name: 'Ranger', cost: 600, buildTime: 100, prerequisite: 'WEAP', faction: 'allied', techLevel: 3 },
  { type: '1TNK', name: 'Light Tank', cost: 700, buildTime: 120, prerequisite: 'WEAP', faction: 'allied', techLevel: 4 },
  { type: '2TNK', name: 'Med Tank', cost: 800, buildTime: 140, prerequisite: 'WEAP', faction: 'allied', techLevel: 6 },
  { type: '3TNK', name: 'Heavy Tank', cost: 950, buildTime: 200, prerequisite: 'WEAP', faction: 'soviet', techLevel: 4 },
  { type: '4TNK', name: 'Mammoth Tank', cost: 1700, buildTime: 240, prerequisite: 'WEAP', faction: 'soviet', techPrereq: 'STEK', techLevel: 10 },  // rules.ini Prerequisite=weap,stek (line 549)
  { type: 'ARTY', name: 'Artillery', cost: 600, buildTime: 120, prerequisite: 'WEAP', faction: 'allied', techLevel: 8 },  // TechLevel=8 gates it, no extra techPrereq needed (rules.ini line 596)
  { type: 'APC', name: 'APC', cost: 800, buildTime: 100, prerequisite: 'WEAP', faction: 'allied', techPrereq: 'TENT', techLevel: 5 },  // rules.ini Prerequisite=weap,tent (line 658)
  { type: 'HARV', name: 'Harvester', cost: 1400, buildTime: 160, prerequisite: 'WEAP', faction: 'both', techPrereq: 'PROC', techLevel: 1 },
  // Counterstrike/Aftermath expansion units — techLevel=99 for units not in base rules.ini
  { type: 'SHOK', name: 'Shock Trpr', cost: 900, buildTime: 80, prerequisite: 'TENT', faction: 'soviet', techPrereq: 'TSLA', techLevel: 7 },  // TSLA prereq (expansion, Tesla Coil gate)
  { type: 'MECH', name: 'Mechanic', cost: 950, buildTime: 70, prerequisite: 'TENT', faction: 'allied', techPrereq: 'FIX', techLevel: 7 },
  { type: 'STNK', name: 'Phase Trns', cost: 800, buildTime: 160, prerequisite: 'WEAP', faction: 'both', techPrereq: 'ATEK', techLevel: -1 },
  { type: 'CTNK', name: 'Chrono Tank', cost: 2400, buildTime: 180, prerequisite: 'WEAP', faction: 'allied', techPrereq: 'ATEK', techLevel: 12 },
  { type: 'TTNK', name: 'Tesla Tank', cost: 1500, buildTime: 200, prerequisite: 'WEAP', faction: 'soviet', techPrereq: 'TSLA', techLevel: 8 },
  { type: 'E7', name: 'Tanya', cost: 1200, buildTime: 120, prerequisite: 'TENT', faction: 'both', techPrereq: 'ATEK', techLevel: 11 },
  { type: 'THF', name: 'Thief', cost: 500, buildTime: 60, prerequisite: 'TENT', faction: 'allied', techPrereq: 'ATEK', techLevel: 11 },
  { type: 'V2RL', name: 'V2 Rocket', cost: 700, buildTime: 140, prerequisite: 'WEAP', faction: 'soviet', techPrereq: 'DOME', techLevel: 4 },  // rules.ini Prerequisite=weap,dome (line 482)
  { type: 'MNLY', name: 'Minelayer', cost: 800, buildTime: 120, prerequisite: 'WEAP', faction: 'both', techPrereq: 'FIX', techLevel: 3 },  // rules.ini Owner=allies,soviet (line 680), Prerequisite=weap,fix (line 674)
  // Naval (from SYRD — Allied Shipyard)
  { type: 'PT', name: 'Gunboat', cost: 500, buildTime: 100, prerequisite: 'SYRD', faction: 'allied', techLevel: 5 },
  { type: 'DD', name: 'Destroyer', cost: 1000, buildTime: 160, prerequisite: 'SYRD', faction: 'allied', techLevel: 7 },
  { type: 'LST', name: 'Transport', cost: 700, buildTime: 120, prerequisite: 'SYRD', faction: 'both', techLevel: 3 },
  { type: 'CA', name: 'Cruiser', cost: 2000, buildTime: 240, prerequisite: 'SYRD', faction: 'allied', techPrereq: 'ATEK', techLevel: 10 },  // rules.ini Prerequisite=syrd,atek (line 735)
  // Naval (from SPEN — Soviet Sub Pen)
  { type: 'SS', name: 'Submarine', cost: 950, buildTime: 140, prerequisite: 'SPEN', faction: 'soviet', techLevel: 5 },
  { type: 'MSUB', name: 'Missile Sub', cost: 1650, buildTime: 200, prerequisite: 'SPEN', faction: 'soviet', techPrereq: 'STEK', techLevel: 9 },
  // Aircraft (from HPAD/AFLD)
  { type: 'TRAN', name: 'Chinook', cost: 1200, buildTime: 120, prerequisite: 'HPAD', faction: 'soviet', techLevel: 11 },
  { type: 'HELI', name: 'Longbow', cost: 1200, buildTime: 200, prerequisite: 'HPAD', faction: 'allied', techLevel: 9 },
  { type: 'HIND', name: 'Hind', cost: 1200, buildTime: 180, prerequisite: 'HPAD', faction: 'soviet', techLevel: 9 },
  { type: 'MIG', name: 'MiG', cost: 1200, buildTime: 180, prerequisite: 'AFLD', faction: 'soviet', techLevel: 10 },
  { type: 'YAK', name: 'Yak', cost: 800, buildTime: 120, prerequisite: 'AFLD', faction: 'soviet', techLevel: 5 },
  // Structures — rules.ini Prerequisite=, Cost=, Owner=, TechLevel= values
  { type: 'POWR', name: 'Power Plant', cost: 300, buildTime: 100, prerequisite: 'FACT', faction: 'both', isStructure: true, techLevel: 1 },
  { type: 'APWR', name: 'Adv. Power Plant', cost: 500, buildTime: 150, prerequisite: 'POWR', faction: 'both', isStructure: true, techLevel: 8 },
  { type: 'TENT', name: 'Barracks', cost: 300, buildTime: 120, prerequisite: 'POWR', faction: 'allied', isStructure: true, techLevel: 1 },
  { type: 'BARR', name: 'Barracks', cost: 300, buildTime: 120, prerequisite: 'POWR', faction: 'soviet', isStructure: true, techLevel: 1 },
  { type: 'PROC', name: 'Refinery', cost: 2000, buildTime: 200, prerequisite: 'POWR', faction: 'both', isStructure: true, techLevel: 1 },
  { type: 'WEAP', name: 'War Factory', cost: 2000, buildTime: 200, prerequisite: 'PROC', faction: 'both', isStructure: true, techLevel: 3 },
  { type: 'SILO', name: 'Ore Silo', cost: 150, buildTime: 60, prerequisite: 'PROC', faction: 'both', isStructure: true, techLevel: 1 },
  { type: 'DOME', name: 'Radar Dome', cost: 1000, buildTime: 150, prerequisite: 'PROC', faction: 'both', isStructure: true, techLevel: 3 },
  { type: 'FIX', name: 'Service Depot', cost: 1200, buildTime: 150, prerequisite: 'WEAP', faction: 'both', isStructure: true, techLevel: 3 },
  { type: 'HPAD', name: 'Helipad', cost: 1500, buildTime: 180, prerequisite: 'DOME', faction: 'both', isStructure: true, techLevel: 9 },
  { type: 'AFLD', name: 'Airfield', cost: 600, buildTime: 200, prerequisite: 'DOME', faction: 'soviet', isStructure: true, techLevel: 5 },
  // Defenses
  { type: 'PBOX', name: 'Pillbox', cost: 400, buildTime: 80, prerequisite: 'TENT', faction: 'allied', isStructure: true, techLevel: 2 },
  { type: 'HBOX', name: 'Camo Pillbox', cost: 600, buildTime: 80, prerequisite: 'TENT', faction: 'allied', isStructure: true, techLevel: 3 },
  { type: 'GUN', name: 'Turret', cost: 600, buildTime: 100, prerequisite: 'TENT', faction: 'allied', isStructure: true, techLevel: 4 },
  { type: 'AGUN', name: 'AA Gun', cost: 600, buildTime: 100, prerequisite: 'DOME', faction: 'allied', isStructure: true, techLevel: 5 },
  { type: 'GAP', name: 'Gap Generator', cost: 500, buildTime: 120, prerequisite: 'ATEK', faction: 'allied', isStructure: true, techLevel: 10 },
  { type: 'FTUR', name: 'Flame Tower', cost: 600, buildTime: 100, prerequisite: 'BARR', faction: 'soviet', isStructure: true, techLevel: 2 },
  { type: 'TSLA', name: 'Tesla Coil', cost: 1500, buildTime: 200, prerequisite: 'WEAP', faction: 'soviet', isStructure: true, techLevel: 7 },
  { type: 'SAM', name: 'SAM Site', cost: 750, buildTime: 120, prerequisite: 'DOME', faction: 'soviet', isStructure: true, techLevel: 9 },
  { type: 'KENN', name: 'Kennel', cost: 200, buildTime: 60, prerequisite: 'BARR', faction: 'soviet', isStructure: true, techLevel: 3 },
  // Naval
  { type: 'SYRD', name: 'Ship Yard', cost: 650, buildTime: 150, prerequisite: 'POWR', faction: 'allied', isStructure: true, techLevel: 3 },
  { type: 'SPEN', name: 'Sub Pen', cost: 650, buildTime: 150, prerequisite: 'POWR', faction: 'soviet', isStructure: true, techLevel: 3 },
  // Superweapon / tech structures
  { type: 'ATEK', name: 'Allied Tech', cost: 1500, buildTime: 200, prerequisite: 'WEAP', faction: 'allied', isStructure: true, techPrereq: 'DOME', techLevel: 10 },
  { type: 'STEK', name: 'Soviet Tech', cost: 1500, buildTime: 200, prerequisite: 'WEAP', faction: 'soviet', isStructure: true, techPrereq: 'DOME', techLevel: 6 },
  { type: 'PDOX', name: 'Chronosphere', cost: 2800, buildTime: 300, prerequisite: 'ATEK', faction: 'allied', isStructure: true, techLevel: 12 },
  { type: 'IRON', name: 'Iron Curtain', cost: 2800, buildTime: 300, prerequisite: 'STEK', faction: 'soviet', isStructure: true, techLevel: 12 },
  { type: 'MSLO', name: 'Missile Silo', cost: 2500, buildTime: 280, prerequisite: 'STEK', faction: 'both', isStructure: true, techLevel: 13 },
  // Walls — rules.ini Cost=, Owner=, TechLevel= values (BARB removed: no Owner in rules.ini, not buildable)
  { type: 'SBAG', name: 'Sandbag', cost: 25, buildTime: 15, prerequisite: 'FACT', faction: 'allied', isStructure: true, techLevel: 2 },
  { type: 'FENC', name: 'Wire Fence', cost: 25, buildTime: 20, prerequisite: 'FACT', faction: 'soviet', isStructure: true, techLevel: 2 },  // rules.ini: FENC is barbed wire fence (line 1695)
  { type: 'BRIK', name: 'Concrete', cost: 100, buildTime: 30, prerequisite: 'FACT', faction: 'both', isStructure: true, techLevel: 8 },
];

// === Sidebar Strip Categories (C++ parity: two production strips) ===
export type StripType = 'left' | 'right';

/** C++ parity: left strip = structures, right strip = all units (infantry + vehicles share queue) */
export function getStripSide(item: ProductionItem): StripType {
  return item.isStructure ? 'left' : 'right';
}

/** Unit types that count as civilian evacuation — C++ _Counts_As_Civ_Evac() VIPs + IsCivilian types */
export const CIVILIAN_UNIT_TYPES = new Set<string>([
  'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10',
  'EINSTEIN', 'GNRL', 'CHAN', // VIPs always evacuate per C++ aircraft.cpp:116-159
]);

// Infantry sub-cell positions within a cell (0=center, 1-4=corners)
// Pixel offsets from cell center for each sub-position
export const SUB_CELL_OFFSETS: { x: number; y: number }[] = [
  { x: 0, y: 0 },     // 0: center
  { x: -7, y: -7 },   // 1: top-left
  { x: 7, y: -7 },    // 2: top-right
  { x: -7, y: 7 },    // 3: bottom-left
  { x: 7, y: 7 },     // 4: bottom-right
];

// === Entity Mission States (AI1: full C++ 22-mission system from mission.h) ===
export enum Mission {
  // Original 7 — fully implemented
  GUARD = 'GUARD',
  AREA_GUARD = 'AREA_GUARD', // patrol/defend spawn area — return if straying too far
  MOVE = 'MOVE',
  ATTACK = 'ATTACK',
  HUNT = 'HUNT',
  SLEEP = 'SLEEP',
  DIE = 'DIE',
  // New C++ parity missions
  ENTER = 'ENTER',           // entering a transport or building
  CAPTURE = 'CAPTURE',       // engineer capturing a building
  HARVEST = 'HARVEST',       // harvester ore collection cycle
  UNLOAD = 'UNLOAD',         // transport unloading passengers / MAD Tank deploy
  RETREAT = 'RETREAT',       // move to nearest map edge and exit
  AMBUSH = 'AMBUSH',         // sleep until enemy enters sight range, then HUNT
  STICKY = 'STICKY',         // guard with IsRecruitable=false (won't join teams)
  REPAIR = 'REPAIR',         // seek nearest FIX structure and move to it
  STOP = 'STOP',             // hold position, cease all action
  HARMLESS = 'HARMLESS',     // like guard but never attacks
  QMOVE = 'QMOVE',          // queued move — same as MOVE (C++ foot.cpp:339)
  RETURN = 'RETURN',         // return to base/pad (aircraft rearm)
  RESCUE = 'RESCUE',         // same as HUNT (C++ rescue mission acts as hunt)
  MISSILE = 'MISSILE',       // missile launch sequence (nuke silo)
  SABOTAGE = 'SABOTAGE',     // Tanya C4 planting mission
  CONSTRUCTION = 'CONSTRUCTION', // building under construction
  DECONSTRUCTION = 'DECONSTRUCTION', // building being sold/deconstructed
}

// AI1: MissionControl metadata per mission (C++ mission.cpp MissionClass::Is_*)
export interface MissionControl {
  isNoThreat: boolean;     // unit is not considered a threat by others
  isZombie: boolean;       // unit doesn't auto-acquire targets
  isRecruitable: boolean;  // unit can be added to AI teams
  isParalyzed: boolean;    // unit cannot move
  isRetaliate: boolean;    // unit retaliates when attacked
  isScatter: boolean;      // unit scatters when attacked
}

export const MISSION_CONTROL: Record<string, MissionControl> = {
  [Mission.GUARD]:          { isNoThreat: false, isZombie: false, isRecruitable: true,  isParalyzed: false, isRetaliate: true,  isScatter: true  },
  [Mission.AREA_GUARD]:     { isNoThreat: false, isZombie: false, isRecruitable: true,  isParalyzed: false, isRetaliate: true,  isScatter: true  },
  [Mission.MOVE]:           { isNoThreat: false, isZombie: false, isRecruitable: false, isParalyzed: false, isRetaliate: true,  isScatter: true  },
  [Mission.ATTACK]:         { isNoThreat: false, isZombie: false, isRecruitable: false, isParalyzed: false, isRetaliate: true,  isScatter: false },
  [Mission.HUNT]:           { isNoThreat: false, isZombie: false, isRecruitable: false, isParalyzed: false, isRetaliate: true,  isScatter: false },
  [Mission.SLEEP]:          { isNoThreat: true,  isZombie: true,  isRecruitable: false, isParalyzed: true,  isRetaliate: false, isScatter: false },
  [Mission.DIE]:            { isNoThreat: true,  isZombie: true,  isRecruitable: false, isParalyzed: true,  isRetaliate: false, isScatter: false },
  [Mission.ENTER]:          { isNoThreat: false, isZombie: true,  isRecruitable: false, isParalyzed: false, isRetaliate: false, isScatter: false },
  [Mission.CAPTURE]:        { isNoThreat: false, isZombie: true,  isRecruitable: false, isParalyzed: false, isRetaliate: false, isScatter: false },
  [Mission.HARVEST]:        { isNoThreat: true,  isZombie: true,  isRecruitable: false, isParalyzed: false, isRetaliate: false, isScatter: false },
  [Mission.UNLOAD]:         { isNoThreat: false, isZombie: false, isRecruitable: false, isParalyzed: false, isRetaliate: true,  isScatter: true  },
  [Mission.RETREAT]:        { isNoThreat: true,  isZombie: true,  isRecruitable: false, isParalyzed: false, isRetaliate: false, isScatter: false },
  [Mission.AMBUSH]:         { isNoThreat: true,  isZombie: true,  isRecruitable: false, isParalyzed: true,  isRetaliate: true,  isScatter: false },
  [Mission.STICKY]:         { isNoThreat: false, isZombie: false, isRecruitable: false, isParalyzed: false, isRetaliate: true,  isScatter: true  },
  [Mission.REPAIR]:         { isNoThreat: true,  isZombie: true,  isRecruitable: false, isParalyzed: false, isRetaliate: false, isScatter: false },
  [Mission.STOP]:           { isNoThreat: false, isZombie: true,  isRecruitable: true,  isParalyzed: true,  isRetaliate: false, isScatter: false },
  [Mission.HARMLESS]:       { isNoThreat: true,  isZombie: true,  isRecruitable: false, isParalyzed: false, isRetaliate: false, isScatter: true  },
  [Mission.QMOVE]:          { isNoThreat: false, isZombie: false, isRecruitable: false, isParalyzed: false, isRetaliate: true,  isScatter: true  },
  [Mission.RETURN]:         { isNoThreat: true,  isZombie: true,  isRecruitable: false, isParalyzed: false, isRetaliate: false, isScatter: false },
  [Mission.RESCUE]:         { isNoThreat: false, isZombie: false, isRecruitable: false, isParalyzed: false, isRetaliate: true,  isScatter: false },
  [Mission.MISSILE]:        { isNoThreat: true,  isZombie: true,  isRecruitable: false, isParalyzed: true,  isRetaliate: false, isScatter: false },
  [Mission.SABOTAGE]:       { isNoThreat: false, isZombie: true,  isRecruitable: false, isParalyzed: false, isRetaliate: false, isScatter: false },
  [Mission.CONSTRUCTION]:   { isNoThreat: true,  isZombie: true,  isRecruitable: false, isParalyzed: true,  isRetaliate: false, isScatter: false },
  [Mission.DECONSTRUCTION]: { isNoThreat: true,  isZombie: true,  isRecruitable: false, isParalyzed: true,  isRetaliate: false, isScatter: false },
};

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

/** Max visual projectile travel frames cap (~3 seconds at 15 FPS) */
export const MAX_PROJECTILE_FRAMES = 45;

/** Default visual projectile travel frames when projSpeed is not defined */
export const DEFAULT_PROJECTILE_FRAMES = 5;

/**
 * Calculate projectile travel frames based on distance and weapon projSpeed.
 * Matches C++ BulletClass::AI() per-weapon Speed field behavior.
 * @param distPixels - distance in pixels between source and target
 * @param projSpeed - weapon's projectile speed in cells/second (undefined = use default)
 * @returns number of game ticks for the projectile to travel
 */
export function calcProjectileTravelFrames(distPixels: number, projSpeed?: number): number {
  if (projSpeed === undefined || projSpeed <= 0) {
    return DEFAULT_PROJECTILE_FRAMES;
  }
  // Convert projSpeed (cells/sec) to pixels/tick: projSpeed * CELL_SIZE / GAME_TICKS_PER_SEC
  const pixelsPerTick = projSpeed * CELL_SIZE / GAME_TICKS_PER_SEC;
  const travelTicks = Math.max(1, Math.ceil(distPixels / pixelsPerTick));
  return Math.min(travelTicks, MAX_PROJECTILE_FRAMES);
}

/** C++ Modify_Damage (combat.cpp:72-129) — compute damage with warhead, armor, and distance falloff.
 *  Distance is from explosion center to target (0 = point-blank direct hit).
 *  @param baseDamage - weapon's raw damage value
 *  @param warhead - warhead type determining armor multiplier and spread
 *  @param armor - target's armor type
 *  @param distPixels - distance in pixels from explosion center to target (0 = point-blank)
 *  @param houseBias - house firepower multiplier (default 1.0)
 *  @returns final damage value (0 if warhead does 0% vs armor) */
export function modifyDamage(
  baseDamage: number, warhead: WarheadType, armor: ArmorType,
  distPixels: number, houseBias = 1.0, warheadMultOverride?: number, spreadFactorOverride?: number,
): number {
  // Step 1: Warhead vs armor multiplier (combat.cpp:98)
  const mult = warheadMultOverride ?? getWarheadMultiplier(warhead, armor);
  if (mult <= 0) return 0;

  let damage = baseDamage * mult * houseBias;

  // Step 2: Distance-based falloff (combat.cpp:106-125)
  // C++ converts pixel distance to a factor using SpreadFactor and PIXEL_LEPTON_W.
  // In pixel space: distFactor = distPixels * 2 / SpreadFactor (for SpreadFactor > 0)
  //                 distFactor = distPixels * 4               (for SpreadFactor == 0)
  const spreadFactor = spreadFactorOverride ?? WARHEAD_META[warhead]?.spreadFactor ?? 1;
  let distFactor: number;
  if (spreadFactor === 0) {
    distFactor = distPixels * 4;
  } else {
    distFactor = (distPixels * 2) / spreadFactor;
  }
  distFactor = Math.max(0, Math.min(16, distFactor)); // combat.cpp:117-118

  if (distFactor > 0) {
    damage = damage / distFactor; // combat.cpp:120
  }

  // Step 3: MinDamage threshold — close enough = at least 1 damage (combat.cpp:122-124)
  if (distFactor < 4) {
    damage = Math.max(damage, 1);
  }

  // Step 4: MaxDamage cap (combat.cpp:126)
  damage = Math.min(damage, MAX_DAMAGE);

  return Math.max(0, Math.round(damage));
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

// === Cursor Types (canvas-rendered) ===
export enum CursorType {
  DEFAULT = 'DEFAULT',
  MOVE = 'MOVE',
  NOMOVE = 'NOMOVE',
  ATTACK = 'ATTACK',
  SELL = 'SELL',
  REPAIR = 'REPAIR',
  SCROLL_N = 'SCROLL_N',
  SCROLL_NE = 'SCROLL_NE',
  SCROLL_E = 'SCROLL_E',
  SCROLL_SE = 'SCROLL_SE',
  SCROLL_S = 'SCROLL_S',
  SCROLL_SW = 'SCROLL_SW',
  SCROLL_W = 'SCROLL_W',
  SCROLL_NW = 'SCROLL_NW',
}

// Alliance system — per-house alliance table
export type AllianceTable = Map<House, Set<House>>;

/** Build default alliances: Spain+Greece allied, USSR+Ukraine+Germany allied (ant missions) */
export function buildDefaultAlliances(): AllianceTable {
  const table: AllianceTable = new Map();
  // Each house is always allied with itself
  for (const h of Object.values(House)) {
    table.set(h, new Set([h]));
  }
  // Spain ↔ Greece (player side in ant missions)
  table.get(House.Spain)!.add(House.Greece);
  table.get(House.Greece)!.add(House.Spain);
  // USSR ↔ Ukraine ↔ Germany (enemy side in ant missions)
  const soviets = [House.USSR, House.Ukraine, House.Germany];
  for (const a of soviets) {
    for (const b of soviets) {
      table.get(a)!.add(b);
    }
  }
  return table;
}

/** Build alliance table from scenario INI [Basic] Allies= field.
 *  C++ house.cpp:Read_INI — each house section has Allies= comma-separated house names.
 *  Returns modified alliance table. */
export function buildAlliancesFromINI(
  alliesMap: Map<House, House[]>,
  playerHouse: House,
): AllianceTable {
  const table: AllianceTable = new Map();
  // Each house is always allied with itself
  for (const h of Object.values(House)) {
    table.set(h, new Set([h]));
  }
  // Apply explicit alliances from INI
  for (const [house, allies] of alliesMap) {
    const set = table.get(house)!;
    for (const ally of allies) {
      set.add(ally);
      // Alliances are bidirectional
      table.get(ally)?.add(house);
    }
  }
  // GoodGuy is always allied with the player
  table.get(House.GoodGuy)?.add(playerHouse);
  table.get(playerHouse)?.add(House.GoodGuy);
  return table;
}
