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

// TEMPERATE theatre template type ranges (from TEMPERAT.INI)
export const TEMPLATE_ROAD_MIN = 173;
export const TEMPLATE_ROAD_MAX = 228;

// === C++ Rule.ini defaults (rules.cpp) ===
export const MAX_DAMAGE = 1000;          // rules.cpp:227 — max damage per hit
export const REPAIR_STEP = 5;            // rules.cpp:228 — HP per repair pulse
export const REPAIR_PERCENT = 0.25;      // rules.cpp:229 — cost ratio for full repair
export const CONDITION_RED = 0.25;       // rules.cpp:235 — red health threshold
export const CONDITION_YELLOW = 0.5;     // rules.cpp:234 — yellow health threshold
export const PRONE_DAMAGE_BIAS = 0.5;    // rules.cpp:202 — prone infantry damage multiplier

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
  Turkey = 'Turkey',   // Neutral / scenario-specific
  Neutral = 'Neutral',
}

// Alliance groups
export const PLAYER_HOUSES = new Set([House.Spain, House.Greece]);
export const ANT_HOUSES = new Set([House.USSR, House.Ukraine, House.Germany]);

// House firepower bias — C++ House->FirepowerBias multiplier per faction
export const HOUSE_FIREPOWER_BIAS: Record<string, number> = {
  Spain: 1.0,    // player — normal
  Greece: 1.0,   // allied — normal
  USSR: 1.1,     // ant faction — slightly stronger (ants are tough)
  Ukraine: 1.0,  // ant faction — normal
  Germany: 0.9,  // ant faction — slightly weaker (scout ants)
  Turkey: 1.0,   // neutral
  Neutral: 1.0,
};

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
  I_CHAN = 'CHAN',  // Specialist (nest gas infantry for SCA03EA)
  // Counterstrike/Aftermath expansion infantry
  I_SHOK = 'SHOK', // Shock Trooper (electric weapon, CS expansion)
  I_MECH = 'MECH', // Mechanic (repairs vehicles, Aftermath expansion)
  // Counterstrike/Aftermath expansion vehicles
  V_STNK = 'STNK', // Phase Transport (stealth APC)
  V_CTNK = 'CTNK', // Chrono Tank (can teleport)
  V_TTNK = 'TTNK', // Tesla Tank (electric weapon)
  V_QTNK = 'QTNK', // M.A.D. Tank (seismic shockwave)
  V_DTRK = 'DTRK', // Demolition Truck (kamikaze)
  // Transport vehicles
  V_TRAN = 'TRAN', // Chinook transport helicopter
  V_LST = 'LST',   // Landing ship transport
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
}

// Warhead types from RA RULES.INI
export type WarheadType = 'SA' | 'HE' | 'AP' | 'Fire' | 'HollowPoint' | 'Super' | 'Organic';

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
};

// Warhead properties from C++ warhead.cpp — infantryDeath selects death animation,
// explosionSet picks the visual explosion sprite
export interface WarheadProps {
  infantryDeath: number;   // 0=normal (die1), 1=fire death (die2), 2=explode (die2)
  explosionSet: string;    // sprite name for explosion effect
}

export const WARHEAD_PROPS: Record<WarheadType, WarheadProps> = {
  SA:          { infantryDeath: 0, explosionSet: 'piff' },       // Small arms: normal death, small piff
  HE:          { infantryDeath: 2, explosionSet: 'veh-hit1' },   // High explosive: explode death, vehicle hit
  AP:          { infantryDeath: 0, explosionSet: 'piff' },       // Armor piercing: normal death, small piff
  Fire:        { infantryDeath: 1, explosionSet: 'napalm1' },    // Fire: fire death, napalm explosion
  HollowPoint: { infantryDeath: 0, explosionSet: 'piff' },       // Hollow point: normal death
  Super:       { infantryDeath: 2, explosionSet: 'atomsfx' },    // Super: explode death, big explosion
  Organic:     { infantryDeath: 0, explosionSet: 'piff' },       // Organic: normal death
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
}

// C6: Warhead splash falloff properties — warhead.cpp:72
// spreadFactor shapes the splash damage curve: higher = wider splash, slower falloff (C++ combat.cpp:107)
// C7: Wall/wood destruction flags — combat.cpp:244-270
export interface WarheadMeta {
  spreadFactor: number;      // 1=linear, 2=wider splash (slower falloff), 3=widest splash
  destroysWalls?: boolean;   // can destroy wall structures (FENC, BRIK, SBAG, BARB, WOOD)
  destroysWood?: boolean;    // can destroy trees and wooden overlays
}

export const WARHEAD_META: Record<WarheadType, WarheadMeta> = {
  SA:          { spreadFactor: 1 },                                           // linear falloff
  HE:          { spreadFactor: 2, destroysWalls: true, destroysWood: true },  // wider splash, destroys walls+wood
  AP:          { spreadFactor: 1 },                                           // linear falloff
  Fire:        { spreadFactor: 3, destroysWood: true },                       // widest splash, slowest falloff; burns wood
  HollowPoint: { spreadFactor: 1 },                                          // linear falloff
  Super:       { spreadFactor: 2, destroysWalls: true, destroysWood: true },  // wider splash; destroys walls+wood
  Organic:     { spreadFactor: 1 },                                           // linear falloff
};

// Unit stats from RULES.INI — real Red Alert values
// crusher: C++ DriveClass::Ok_To_Move — heavy tracked vehicles (Crusher=yes in RULES.INI)
// crushable: C++ infantry.cpp — infantry and ants die when a crusher enters their cell
export const UNIT_STATS: Record<string, UnitStats> = {
  // Ants (from SCA scenario INI files) — crushable by heavy tanks (core ant mission tactic)
  ANT1: { type: UnitType.ANT1, name: 'Warrior Ant', image: 'ant1', strength: 150, armor: 'light', speed: 5, speedClass: SpeedClass.WHEEL, sight: 2, rot: 5, isInfantry: false, primaryWeapon: 'Mandible', noMovingFire: true, scanDelay: 10, crushable: true },
  ANT2: { type: UnitType.ANT2, name: 'Fire Ant', image: 'ant2', strength: 75, armor: 'heavy', speed: 8, speedClass: SpeedClass.WHEEL, sight: 3, rot: 6, isInfantry: false, primaryWeapon: 'FireballLauncher', noMovingFire: true, scanDelay: 10, crushable: true },
  ANT3: { type: UnitType.ANT3, name: 'Scout Ant', image: 'ant3', strength: 85, armor: 'light', speed: 7, speedClass: SpeedClass.WHEEL, sight: 3, rot: 9, isInfantry: false, primaryWeapon: 'TeslaZap', noMovingFire: true, scanDelay: 10, crushable: true },
  // Vehicles (RULES.INI values) — crusher=true for heavy tracked vehicles per C++ udata.cpp Crusher flag
  '1TNK': { type: UnitType.V_1TNK, name: 'Light Tank', image: '1tnk', strength: 300, armor: 'heavy', speed: 9, speedClass: SpeedClass.WHEEL, sight: 4, rot: 5, isInfantry: false, primaryWeapon: '75mm', scanDelay: 12, crusher: true },
  '2TNK': { type: UnitType.V_2TNK, name: 'Medium Tank', image: '2tnk', strength: 400, armor: 'heavy', speed: 8, speedClass: SpeedClass.WHEEL, sight: 5, rot: 5, isInfantry: false, primaryWeapon: '90mm', scanDelay: 12, crusher: true },
  '3TNK': { type: UnitType.V_3TNK, name: 'Heavy Tank', image: '3tnk', strength: 400, armor: 'heavy', speed: 7, speedClass: SpeedClass.WHEEL, sight: 5, rot: 5, isInfantry: false, primaryWeapon: '105mm', scanDelay: 12, crusher: true },
  '4TNK': { type: UnitType.V_4TNK, name: 'Mammoth Tank', image: '4tnk', strength: 600, armor: 'heavy', speed: 4, speedClass: SpeedClass.WHEEL, sight: 6, rot: 5, isInfantry: false, primaryWeapon: '120mm', secondaryWeapon: 'MammothTusk', scanDelay: 12, crusher: true },
  JEEP:   { type: UnitType.V_JEEP, name: 'Ranger', image: 'jeep', strength: 150, armor: 'light', speed: 10, speedClass: SpeedClass.WHEEL, sight: 6, rot: 10, isInfantry: false, primaryWeapon: 'M60mg', scanDelay: 10 },
  APC:    { type: UnitType.V_APC, name: 'APC', image: 'apc', strength: 200, armor: 'heavy', speed: 10, speedClass: SpeedClass.WHEEL, sight: 5, rot: 5, isInfantry: false, primaryWeapon: 'M60mg', passengers: 5 },
  ARTY:   { type: UnitType.V_ARTY, name: 'Artillery', image: 'arty', strength: 75, armor: 'light', speed: 6, speedClass: SpeedClass.WHEEL, sight: 5, rot: 2, isInfantry: false, primaryWeapon: '155mm', noMovingFire: true, scanDelay: 20 },
  HARV:   { type: UnitType.V_HARV, name: 'Harvester', image: 'harv', strength: 600, armor: 'heavy', speed: 6, speedClass: SpeedClass.WHEEL, sight: 4, rot: 5, isInfantry: false, primaryWeapon: null, crusher: true },
  MCV:    { type: UnitType.V_MCV, name: 'MCV', image: 'mcv', strength: 600, armor: 'light', speed: 6, speedClass: SpeedClass.WHEEL, sight: 4, rot: 5, isInfantry: false, primaryWeapon: null, crusher: true },
  TRUK:   { type: UnitType.V_TRUK, name: 'Supply Truck', image: 'truk', strength: 110, armor: 'heavy', speed: 8, speedClass: SpeedClass.WHEEL, sight: 2, rot: 5, isInfantry: false, primaryWeapon: null },
  // Infantry (RULES.INI values) — all infantry are crushable
  E1:   { type: UnitType.I_E1, name: 'Rifle Infantry', image: 'e1', strength: 50, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 4, rot: 8, isInfantry: true, primaryWeapon: 'M1Carbine', crushable: true },
  E2:   { type: UnitType.I_E2, name: 'Grenadier', image: 'e2', strength: 50, armor: 'none', speed: 5, speedClass: SpeedClass.FOOT, sight: 4, rot: 8, isInfantry: true, primaryWeapon: 'Grenade', crushable: true },
  E3:   { type: UnitType.I_E3, name: 'Rocket Soldier', image: 'e3', strength: 45, armor: 'none', speed: 3, speedClass: SpeedClass.FOOT, sight: 4, rot: 8, isInfantry: true, primaryWeapon: 'Dragon', secondaryWeapon: 'RedEye', scanDelay: 20, crushable: true },
  E4:   { type: UnitType.I_E4, name: 'Flamethrower', image: 'e4', strength: 40, armor: 'none', speed: 3, speedClass: SpeedClass.FOOT, sight: 4, rot: 8, isInfantry: true, primaryWeapon: 'Flamer', crushable: true },
  E6:   { type: UnitType.I_E6, name: 'Engineer', image: 'e6', strength: 25, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 4, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  DOG:  { type: UnitType.I_DOG, name: 'Attack Dog', image: 'dog', strength: 12, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 5, rot: 8, isInfantry: true, primaryWeapon: 'DogJaw', scanDelay: 8, crushable: true },
  SPY:  { type: UnitType.I_SPY, name: 'Spy', image: 'spy', strength: 25, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 4, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  MEDI: { type: UnitType.I_MEDI, name: 'Medic', image: 'medi', strength: 80, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 3, rot: 8, isInfantry: true, primaryWeapon: 'Heal', crushable: true },
  GNRL: { type: UnitType.I_GNRL, name: 'Stavros', image: 'e1', strength: 100, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 4, rot: 8, isInfantry: true, primaryWeapon: 'Sniper', crushable: true },
  CHAN: { type: UnitType.I_CHAN, name: 'Specialist', image: 'e1', strength: 50, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 3, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  // Civilians — crushable
  C1: { type: UnitType.I_C1, name: 'Civilian', image: 'e1', strength: 5, armor: 'none', speed: 3, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  C2: { type: UnitType.I_C2, name: 'Civilian', image: 'e1', strength: 5, armor: 'none', speed: 3, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  C3: { type: UnitType.I_C3, name: 'Civilian', image: 'e1', strength: 5, armor: 'none', speed: 3, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  C4: { type: UnitType.I_C4, name: 'Civilian', image: 'e1', strength: 5, armor: 'none', speed: 3, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  C5: { type: UnitType.I_C5, name: 'Civilian', image: 'e1', strength: 5, armor: 'none', speed: 3, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  C6: { type: UnitType.I_C6, name: 'Civilian', image: 'e1', strength: 5, armor: 'none', speed: 3, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  C7: { type: UnitType.I_C7, name: 'Civilian', image: 'e1', strength: 5, armor: 'none', speed: 3, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  C8: { type: UnitType.I_C8, name: 'Civilian', image: 'e1', strength: 5, armor: 'none', speed: 3, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  C9: { type: UnitType.I_C9, name: 'Civilian', image: 'e1', strength: 5, armor: 'none', speed: 3, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  C10: { type: UnitType.I_C10, name: 'Civilian', image: 'e1', strength: 5, armor: 'none', speed: 3, speedClass: SpeedClass.FOOT, sight: 2, rot: 8, isInfantry: true, primaryWeapon: null, crushable: true },
  // Counterstrike/Aftermath expansion infantry — crushable
  SHOK: { type: UnitType.I_SHOK, name: 'Shock Trooper', image: 'shok', strength: 80, armor: 'none', speed: 3, speedClass: SpeedClass.FOOT, sight: 4, rot: 8, isInfantry: true, primaryWeapon: 'PortaTesla', crushable: true },
  MECH: { type: UnitType.I_MECH, name: 'Mechanic', image: 'medi', strength: 70, armor: 'none', speed: 4, speedClass: SpeedClass.FOOT, sight: 3, rot: 8, isInfantry: true, primaryWeapon: 'GoodWrench', crushable: true },
  // Counterstrike/Aftermath expansion vehicles — crusher for tank variants
  STNK: { type: UnitType.V_STNK, name: 'Phase Transport', image: 'stnk', strength: 110, armor: 'light', speed: 10, speedClass: SpeedClass.WHEEL, sight: 5, rot: 5, isInfantry: false, primaryWeapon: 'APTusk', passengers: 5 },
  CTNK: { type: UnitType.V_CTNK, name: 'Chrono Tank', image: '2tnk', strength: 200, armor: 'heavy', speed: 7, speedClass: SpeedClass.WHEEL, sight: 6, rot: 5, isInfantry: false, primaryWeapon: '90mm', crusher: true },
  TTNK: { type: UnitType.V_TTNK, name: 'Tesla Tank', image: '4tnk', strength: 300, armor: 'heavy', speed: 5, speedClass: SpeedClass.WHEEL, sight: 6, rot: 5, isInfantry: false, primaryWeapon: 'TTankZap', crusher: true },
  QTNK: { type: UnitType.V_QTNK, name: 'M.A.D. Tank', image: '2tnk', strength: 200, armor: 'heavy', speed: 6, speedClass: SpeedClass.WHEEL, sight: 5, rot: 5, isInfantry: false, primaryWeapon: null, crusher: true },
  DTRK: { type: UnitType.V_DTRK, name: 'Demo Truck', image: 'truk', strength: 100, armor: 'none', speed: 10, speedClass: SpeedClass.WHEEL, sight: 3, rot: 5, isInfantry: false, primaryWeapon: null },
  // Transport vehicles
  TRAN: { type: UnitType.V_TRAN, name: 'Chinook', image: 'truk', strength: 90, armor: 'light', speed: 12, speedClass: SpeedClass.WINGED, sight: 5, rot: 8, isInfantry: false, primaryWeapon: null, passengers: 5 },
  LST: { type: UnitType.V_LST, name: 'Transport', image: 'truk', strength: 400, armor: 'heavy', speed: 6, speedClass: SpeedClass.FLOAT, sight: 3, rot: 4, isInfantry: false, primaryWeapon: null, passengers: 8 },
};

// Weapon stats from RULES.INI — real RA values
// projSpeed: per-weapon projectile visual speed in cells/second (C++ BulletClass::AI Speed field)
export const WEAPON_STATS: Record<string, WeaponStats> = {
  // Infantry weapons
  M1Carbine:        { name: 'M1Carbine',        damage: 15,  rof: 20, range: 3.0,  warhead: 'SA', projSpeed: 40 },
  Grenade:          { name: 'Grenade',           damage: 50,  rof: 60, range: 4.0,  warhead: 'HE', splash: 1.5, inaccuracy: 0.5, projectileSpeed: 0.33, isArcing: true, projSpeed: 12 },
  Dragon:           { name: 'Dragon',            damage: 35,  rof: 50, range: 5.0,  warhead: 'AP', projectileSpeed: 1.67, projectileROT: 5, projSpeed: 15 },
  RedEye:           { name: 'RedEye',            damage: 50,  rof: 50, range: 7.5,  warhead: 'AP', projectileSpeed: 3.33, projectileROT: 5, projSpeed: 15 },
  Flamer:           { name: 'Flamer',            damage: 70,  rof: 50, range: 3.5,  warhead: 'Fire', splash: 1.0, projectileSpeed: 0.8, projSpeed: 20 },
  DogJaw:           { name: 'DogJaw',            damage: 100, rof: 10, range: 2.2,  warhead: 'Organic', projSpeed: 40 },
  Heal:             { name: 'Heal',              damage: -50, rof: 80, range: 1.83, warhead: 'Organic', projSpeed: 40 },
  Sniper:           { name: 'Sniper',            damage: 125, rof: 40, range: 5.0,  warhead: 'HollowPoint', projSpeed: 40 },
  // Vehicle weapons
  M60mg:            { name: 'M60mg',             damage: 15,  rof: 20, range: 4.0,  warhead: 'SA', projSpeed: 40 },
  '75mm':           { name: '75mm',              damage: 25,  rof: 40, range: 4.0,  warhead: 'AP', projectileSpeed: 2.67, projSpeed: 30 },
  '90mm':           { name: '90mm',              damage: 30,  rof: 50, range: 4.75, warhead: 'AP', projectileSpeed: 2.67, projSpeed: 30 },
  '105mm':          { name: '105mm',             damage: 30,  rof: 70, range: 4.75, warhead: 'AP', projectileSpeed: 2.67, projSpeed: 30 },
  '120mm':          { name: '120mm',             damage: 40,  rof: 80, range: 4.75, warhead: 'AP', projectileSpeed: 2.67, projSpeed: 30 },
  MammothTusk:      { name: 'MammothTusk',       damage: 75,  rof: 80, range: 5.0,  warhead: 'HE', splash: 1.5, projectileSpeed: 2.0, burst: 2, projectileROT: 5, projSpeed: 15 },
  '155mm':          { name: '155mm',             damage: 150, rof: 65, range: 6.0,  warhead: 'HE', splash: 2.0, inaccuracy: 1.5, minRange: 2.0, projectileSpeed: 0.8, isArcing: true, projSpeed: 12 },
  TeslaCannon:      { name: 'TeslaCannon',       damage: 75,  rof: 60, range: 5.0,  warhead: 'Super', splash: 1.0, projSpeed: 40 },
  // Counterstrike/Aftermath expansion weapons
  PortaTesla:       { name: 'PortaTesla',        damage: 50,  rof: 60, range: 4.0,  warhead: 'Super', splash: 0.5, projSpeed: 40 }, // Shock Trooper
  GoodWrench:       { name: 'GoodWrench',        damage: -30, rof: 60, range: 1.83, warhead: 'Organic', projSpeed: 40 },            // Mechanic (heals vehicles)
  APTusk:           { name: 'APTusk',             damage: 25,  rof: 20, range: 4.5,  warhead: 'SA', projSpeed: 40 },                 // Phase Transport MG
  TTankZap:         { name: 'TTankZap',           damage: 80,  rof: 80, range: 5.0,  warhead: 'Super', splash: 1.0, projSpeed: 40 }, // Tesla Tank
  // Ant weapons (from SCA scenario INI files + C++ udata.cpp comments)
  Mandible:         { name: 'Mandible',          damage: 50,  rof: 15, range: 1.5,  warhead: 'HollowPoint', projSpeed: 40 }, // C++: Warhead=HollowPoint
  TeslaZap:         { name: 'TeslaZap',          damage: 60,  rof: 25, range: 1.75, warhead: 'Super', projSpeed: 40 },
  FireballLauncher: { name: 'FireballLauncher',   damage: 125, rof: 50, range: 4.0,  warhead: 'Fire', splash: 1.5, projectileSpeed: 0.8, projSpeed: 15 },
  Napalm:           { name: 'Napalm',            damage: 60,  rof: 25, range: 1.75, warhead: 'Super', projSpeed: 40 },
};

// === Production data ===
export type Faction = 'allied' | 'soviet' | 'both';

export interface ProductionItem {
  type: string;         // unit type or structure type code
  name: string;         // display name
  cost: number;         // credits cost
  buildTime: number;    // ticks to build
  prerequisite: string; // required building type (TENT/BARR→infantry, WEAP→vehicles, FACT→structures)
  techPrereq?: string;  // additional building required (e.g. DOME for Artillery)
  faction: Faction;     // which faction can build this
  isStructure?: boolean;
}

export const PRODUCTION_ITEMS: ProductionItem[] = [
  // Infantry (from TENT/BARR) — faction-accurate per RA rules.ini
  { type: 'E1', name: 'Rifle', cost: 100, buildTime: 45, prerequisite: 'TENT', faction: 'both' },
  { type: 'E2', name: 'Grenadier', cost: 160, buildTime: 55, prerequisite: 'TENT', faction: 'both' },  // Allied in ant missions
  { type: 'E3', name: 'Rocket', cost: 300, buildTime: 75, prerequisite: 'TENT', faction: 'both' },
  { type: 'E4', name: 'Flame', cost: 300, buildTime: 75, prerequisite: 'TENT', faction: 'soviet' },
  { type: 'E6', name: 'Engineer', cost: 500, buildTime: 100, prerequisite: 'TENT', faction: 'both' },
  { type: 'DOG', name: 'Dog', cost: 200, buildTime: 30, prerequisite: 'TENT', faction: 'soviet' },
  { type: 'MEDI', name: 'Medic', cost: 800, buildTime: 90, prerequisite: 'TENT', faction: 'allied' },
  // Vehicles (from WEAP) — faction-accurate per RA rules.ini
  { type: 'JEEP', name: 'Ranger', cost: 600, buildTime: 100, prerequisite: 'WEAP', faction: 'allied' },
  { type: '1TNK', name: 'Light Tank', cost: 700, buildTime: 120, prerequisite: 'WEAP', faction: 'allied' },
  { type: '2TNK', name: 'Med Tank', cost: 800, buildTime: 140, prerequisite: 'WEAP', faction: 'allied' },
  { type: '3TNK', name: 'Heavy Tank', cost: 950, buildTime: 200, prerequisite: 'WEAP', faction: 'soviet' },
  { type: '4TNK', name: 'Mammoth Tank', cost: 1700, buildTime: 240, prerequisite: 'WEAP', faction: 'soviet' },
  { type: 'ARTY', name: 'Artillery', cost: 600, buildTime: 120, prerequisite: 'WEAP', faction: 'allied', techPrereq: 'DOME' },
  { type: 'APC', name: 'APC', cost: 800, buildTime: 100, prerequisite: 'WEAP', faction: 'allied' },
  { type: 'HARV', name: 'Harvester', cost: 1400, buildTime: 160, prerequisite: 'WEAP', faction: 'both' },
  // Counterstrike/Aftermath expansion units
  { type: 'SHOK', name: 'Shock Trpr', cost: 400, buildTime: 80, prerequisite: 'TENT', faction: 'soviet', techPrereq: 'STEK' },
  { type: 'MECH', name: 'Mechanic', cost: 500, buildTime: 70, prerequisite: 'TENT', faction: 'both', techPrereq: 'FIX' },
  { type: 'STNK', name: 'Phase Trns', cost: 1100, buildTime: 160, prerequisite: 'WEAP', faction: 'allied', techPrereq: 'ATEK' },
  { type: 'CTNK', name: 'Chrono Tank', cost: 1200, buildTime: 180, prerequisite: 'WEAP', faction: 'allied', techPrereq: 'ATEK' },
  { type: 'TTNK', name: 'Tesla Tank', cost: 1500, buildTime: 200, prerequisite: 'WEAP', faction: 'soviet', techPrereq: 'STEK' },
  // Structures (from FACT) — faction-accurate
  { type: 'POWR', name: 'Power Plant', cost: 300, buildTime: 100, prerequisite: 'FACT', faction: 'both', isStructure: true },
  { type: 'TENT', name: 'Barracks', cost: 300, buildTime: 120, prerequisite: 'FACT', faction: 'both', isStructure: true },
  { type: 'WEAP', name: 'War Factory', cost: 2000, buildTime: 200, prerequisite: 'FACT', faction: 'both', isStructure: true },
  { type: 'PROC', name: 'Refinery', cost: 2000, buildTime: 200, prerequisite: 'FACT', faction: 'both', isStructure: true },
  { type: 'SILO', name: 'Ore Silo', cost: 150, buildTime: 60, prerequisite: 'FACT', faction: 'both', isStructure: true },
  { type: 'DOME', name: 'Radar Dome', cost: 1000, buildTime: 150, prerequisite: 'FACT', faction: 'both', isStructure: true },
  { type: 'HBOX', name: 'Pillbox', cost: 400, buildTime: 80, prerequisite: 'FACT', faction: 'allied', isStructure: true },
  { type: 'GUN', name: 'Turret', cost: 600, buildTime: 100, prerequisite: 'FACT', faction: 'allied', isStructure: true },
  { type: 'TSLA', name: 'Tesla Coil', cost: 1500, buildTime: 200, prerequisite: 'FACT', faction: 'soviet', isStructure: true },
  { type: 'FIX', name: 'Service Depot', cost: 1200, buildTime: 150, prerequisite: 'FACT', faction: 'both', isStructure: true },
  // Walls (1x1 placement, no prerequisite building needed beyond FACT)
  { type: 'SBAG', name: 'Sandbag', cost: 10, buildTime: 15, prerequisite: 'FACT', faction: 'both', isStructure: true },
  { type: 'FENC', name: 'Chain Link', cost: 25, buildTime: 20, prerequisite: 'FACT', faction: 'both', isStructure: true },
  { type: 'BARB', name: 'Barbed Wire', cost: 20, buildTime: 18, prerequisite: 'FACT', faction: 'both', isStructure: true },
  { type: 'BRIK', name: 'Concrete', cost: 50, buildTime: 30, prerequisite: 'FACT', faction: 'both', isStructure: true },
];

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
  AREA_GUARD = 'AREA_GUARD', // patrol/defend spawn area — return if straying too far
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

/** Build default alliances: Spain+Greece allied, USSR+Ukraine+Germany allied */
export function buildDefaultAlliances(): AllianceTable {
  const table: AllianceTable = new Map();
  // Each house is always allied with itself
  for (const h of Object.values(House)) {
    table.set(h, new Set([h]));
  }
  // Spain ↔ Greece
  table.get(House.Spain)!.add(House.Greece);
  table.get(House.Greece)!.add(House.Spain);
  // USSR ↔ Ukraine ↔ Germany (BadGuy)
  const soviets = [House.USSR, House.Ukraine, House.Germany];
  for (const a of soviets) {
    for (const b of soviets) {
      table.get(a)!.add(b);
    }
  }
  return table;
}
