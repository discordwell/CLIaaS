/**
 * OracleStrategy: rule-based strategy for Red Alert missions driven by the
 * original WASM agent harness.
 *
 * The original harness currently supports unit motion and targeting, but not
 * sidebar production, so this strategy focuses on tactical control only.
 */

import type { RAGameState, RAEntity, RAStructure, RABuildable } from './WasmAdapter';
import { getCoastalCellsFromText, parseMapPack } from './mapParser';
import { STRUCTURE_SIZE, getBibCells } from '../engine/scenario';

/**
 * TS engine runs at 20 Hz. Oracle tick constants should use sec() to
 * convert from game seconds to TS ticks so timing is correct regardless
 * of engine tick rate.
 */
const TS_HZ = 20;
function sec(seconds: number): number { return Math.round(seconds * TS_HZ); }

export interface OracleDecision {
  commands: Array<Record<string, unknown>>;
  reason: string;
}

export type OracleResult = 'playing' | 'victory' | 'defeat' | 'timeout';

type Point = { cx: number; cy: number };

// Mission enum values from C++ (MISSION_*)
const MISSION_SLEEP = 0;
const MISSION_GUARD = 5;
const MISSION_GUARD_AREA = 10;

// HP threshold for retreat (fraction of max HP)
const RETREAT_HP_FRACTION = 0.3;

const NON_COMBAT_TYPES = new Set(['C7', 'C8', 'EINSTEIN', 'TRAN', 'LST']);
const AIRCRAFT_TYPES = new Set(['YAK', 'MIG', 'HIND', 'HELI', 'TRAN', 'BADR', 'U2']);

// RTTIType enum values from C++ defines.h (used for produce/place commands)
const RTTI_BUILDINGTYPE = 6;
const RTTI_UNITTYPE = 29;
const RTTI_INFANTRYTYPE = 14;
const RTTI_VESSELTYPE = 31;

// Ship preference order (best to worst)
const SHIP_PREFERENCE = ['CA', 'DD', 'PT', 'SS'];
const NAVAL_COMBAT_TYPES = new Set(['DD', 'CA', 'PT', 'SS', 'MSUB']);

// Non-combat unit types excluded from attack orders
const BASE_NON_COMBAT_TYPES = new Set(['MCV', 'HARV', 'MNLY', 'TRUK']);

// Build order entries — alternatives array allows TENT/BARR flexibility
interface BuildOrderEntry {
  names: string[];
  type_ids: number[];
  maxCount?: number;  // build up to this many (default 1)
}

const BUILD_ORDER: BuildOrderEntry[] = [
  { names: ['POWR'],         type_ids: [17] },            // STRUCT_POWER — always first
  { names: ['PROC'],         type_ids: [12] },            // STRUCT_REFINERY — WEAP prerequisite
  { names: ['WEAP'],         type_ids: [2] },             // STRUCT_WEAP — tanks ASAP
  { names: ['PROC'],         type_ids: [12], maxCount: 2 }, // Second refinery — double income
  { names: ['WEAP'],         type_ids: [2], maxCount: 2 },  // Second war factory — double tank output
  { names: ['POWR'],         type_ids: [17], maxCount: 3 },  // Bridge power toward coast
  { names: ['SYRD', 'SPEN'], type_ids: [27, 28] },        // Shipyard — naval production
  { names: ['BARR', 'TENT'], type_ids: [21, 22] },        // Barracks
  { names: ['POWR'],         type_ids: [17], maxCount: 99 }, // Extra power
  { names: ['PROC'],         type_ids: [12], maxCount: 3 }, // Third refinery
];

// SCG11EA "Aftermath / Naval Supremacy": bootstrap the island, then hand off to navy fast.
// Strategy:
//   1. Get a stable local base: POWR + PROC + WEAP.
//   2. Rush the east-coast shipyard as soon as that core is online.
//   3. Keep enough tanks alive to hold the island while destroyers clear the river.
//   4. Let the coast-chain POWRs provide the extra power instead of stalling on a local second POWR.
//   5. Add the second refinery after the naval handoff instead of gating on it.
const SCG11EA_BUILD_ORDER: BuildOrderEntry[] = [
  { names: ['POWR'],         type_ids: [17] },              // First power
  { names: ['PROC'],         type_ids: [12] },              // First refinery
  { names: ['WEAP'],         type_ids: [2] },               // Tank line online
  { names: ['SYRD', 'SPEN'], type_ids: [27, 28] },          // Rush navy once the coast is mapped
  { names: ['PROC'],         type_ids: [12], maxCount: 2 }, // Second refinery after shipyard
  { names: ['POWR'],         type_ids: [17], maxCount: 99 }, // Extra power
];
const SCG11EA_ORE_ANCHOR: Point = { cx: 29, cy: 61 };
const SCG11EA_PRE_NAVAL_TANK_TARGET = 20;  // Mass 18+ tanks before assaulting
const SCG11EA_SHIPYARD_TANK_FLOOR = 8;     // Finish SYRD once we have a credible beachhead
const SCG11EA_SUB_HUNT_TANK_FLOOR = 8;     // Keep a real island hold while DDs clear the river
const SCG11EA_LATE_SUB_HUNT_TANK_FLOOR = 6; // Once the base is stable, spend the rest on DD rebuilds
const SCG11EA_SUB_HUNT_EMERGENCY_TANK_FLOOR = 4; // Panic rebuild only when the beachhead is collapsing
const SCG11EA_POST_NAVAL_TANK_TARGET = 10; // Refill for the westward push once the river is effectively open
const SCG11EA_POST_NAVAL_SUB_THRESHOLD = 1;
const SCG11EA_FLEET_ONLINE_SHIPS = 3;
const SCG11EA_HUNT_MIN_SHIPS = 3;
const SCG11EA_SHIPYARD_SCOUT_TARGET: Point = { cx: 63, cy: 89 };
const SCG11EA_HOME_MCV_TARGET: Point = { cx: 28, cy: 98 };
const SCG11EA_FORWARD_MCV_TARGET: Point = { cx: 36, cy: 96 };
const SCG11EA_FORWARD_FACT_TARGET: Point = { cx: 52, cy: 90 };
const SCG11EA_ASSAULT_MIN_SHIPS = 3;       // Don't peel armor west until the fleet is self-sustaining
const SCG11EA_ASSAULT_MAX_SUBS = 4;        // Once the submarine screen is thinned, a small armor detachment can start removing island pressure
const SCG11EA_ASSAULT_MIN_ARMOR = 10;      // Achievable with 2 WEAP + 3 HARV economy
const SCG11EA_ASSAULT_RETREAT_FLOOR = 4;   // Stay on the island longer before abandoning the pressure
const SCG11EA_EARLY_ASSAULT_CAP = 4;
const SCG11EA_STATIC_DEFENSE_MIN_SHIPS = 2;
const SCG11EA_STATIC_DEFENSE_MAX_SUBS = 3;
const SCG11EA_AA_DEFENSE_TARGET = 2;
const SCG11EA_GROUND_DEFENSE_TARGET = 2;
const SCG11EA_AA_DEFENSE_TRIGGER = 2;
const SCG11EA_GROUND_DEFENSE_TRIGGER = 2;
const SCG11EA_DEFENSE_CREDIT_RESERVE = 800;
const SCG11EA_ECON_REBUILD_FLOOR = 500;
const SCG11EA_PROC_REBUILD_RESERVE = 1200;
const SCG11EA_BUILD_RADIUS = 5;
const SCG11EA_COAST_LINK_MIN_RIGHT_EDGE = 59;
const SCG11EA_CRITICAL_FLEET_SHIP_CREDIT = 25;
const SCG11EA_FLEET_RECOVERY_SHIP_CREDIT = 100;
const SCG11EA_POWER_REBUILD_EMERGENCY_DEFICIT = 40;
const SCG11EA_RIVER_SWEEP_POINTS: Point[] = [
  { cx: 67, cy: 91 },
  { cx: 71, cy: 72 },
  { cx: 68, cy: 61 },
  { cx: 68, cy: 53 },
  { cx: 68, cy: 38 },
  { cx: 69, cy: 24 },
];
const SCG11EA_VESSEL_LAUNCH_POINTS: Point[] = [
  // Wide spacing matters here. The harness unlimbos the vessel at the exact
  // target cell, so clustered launch cells can deadlock when one DD idles nearby.
  { cx: 67, cy: 91 },
  { cx: 74, cy: 91 },
  { cx: 67, cy: 84 },
  { cx: 74, cy: 84 },
  { cx: 70, cy: 77 },
];
const SCG11EA_FLEET_RALLY_POINT: Point = { cx: 70, cy: 88 };
const SCG11EA_PRIMARY_ASSAULT_POINT: Point = { cx: 49, cy: 45 };
const SCG11EA_BOTTLENECK_ASSAULT_POINT: Point = { cx: 73, cy: 47 };
const SCG11EA_EASTERN_ASSAULT_POINT: Point = { cx: 97, cy: 53 };

// Tank preference order (best to worst — covers both Allied and Soviet)
// 3TNK=Heavy(Soviet), 2TNK=Medium(Allied), 4TNK=Mammoth(Soviet), 1TNK=Light(both)
const TANK_PREFERENCE = ['3TNK', '2TNK', '4TNK', '1TNK'];

// ── Cost-weighted unit power ─────────────────────────────────────────────
// Normalized so that 1.0 ≈ 100 credits worth of combat power.
// Aircraft are excluded (power 0) — destroy their airfields/helipads instead.
const UNIT_POWER: Record<string, number> = {
  // Infantry (from PRODUCTION_ITEMS costs)
  'E1':   1.0,   // 100 credits
  'E2':   1.6,   // 160
  'E3':   3.0,   // 300
  'E4':   3.0,   // 300
  'E6':   0,     // Engineer — non-combat
  'E7':   12.0,  // 1200 (Tanya)
  'SPY':  0,     // non-combat
  'THF':  0,     // non-combat
  'MEDI': 0,     // non-combat
  'DOG':  2.0,   // 200
  'SHOK': 9.0,   // 900
  // Vehicles
  'JEEP': 6.0,   // 600
  '1TNK': 7.0,   // 700
  '2TNK': 8.0,   // 800
  '3TNK': 9.5,   // 950
  '4TNK': 17.0,  // 1700
  'ARTY': 6.0,   // 600
  'APC':  8.0,   // 800
  'V2RL': 7.0,   // 700
  'STNK': 8.0,   // 800 (Phase Transport)
  'CTNK': 24.0,  // 2400 (Chrono Tank)
  'TTNK': 15.0,  // 1500 (Tesla Tank)
  // Non-combat vehicles — 0 power
  'MCV':  0, 'HARV': 0, 'MNLY': 0, 'TRUK': 0, 'MRJ': 0, 'MGG': 0, 'DTRK': 0,
  // Naval
  'DD':   10.0,  // 1000
  'CA':   20.0,  // 2000
  'PT':   5.0,   // 500
  'SS':   9.5,   // 950
  'MSUB': 16.5,  // 1650
  'LST':  0,     // transport
  // Aircraft — 0 power (take out their airstrips/helipads)
  'YAK': 0, 'MIG': 0, 'HIND': 0, 'HELI': 0, 'TRAN': 0, 'BADR': 0, 'U2': 0,
};
const DEFAULT_UNIT_POWER = 1.0; // unknown types get minimum power

function unitPower(t: string): number {
  return UNIT_POWER[t] ?? DEFAULT_UNIT_POWER;
}

/** Compute cost-weighted combat strength of a unit list, scaled by HP fraction. */
function combatStrength(units: RAEntity[]): number {
  return units.reduce(
    (s, u) => s + unitPower(u.t) * (u.hp / u.mhp), 0,
  );
}

// Faction-aware house classification
const SOVIET_HOUSES = new Set(['USSR', 'Ukraine', 'BadGuy']);
function isSovietHouse(house: string | undefined): boolean {
  return house != null && SOVIET_HOUSES.has(house);
}

// Infantry production preference
const INFANTRY_PREFERENCE = ['E3', 'E1', 'E2', 'E4'];

// ── Tactical micro-management constants ──────────────────────────────────────

type UnitRole = 'anti_infantry' | 'anti_armor' | 'general' | 'non_combat';

const UNIT_ROLES: Record<string, UnitRole> = {
  'E1': 'anti_infantry', 'E4': 'anti_infantry', 'DOG': 'anti_infantry', 'JEEP': 'anti_infantry',
  'E3': 'anti_armor', 'ARTY': 'anti_armor', 'V2RL': 'anti_armor',
  '1TNK': 'anti_armor', '2TNK': 'anti_armor', '3TNK': 'anti_armor', '4TNK': 'anti_armor',
  // Naval units
  'DD': 'anti_armor', 'CA': 'anti_armor', 'PT': 'anti_armor', 'SS': 'anti_armor',
  'LST': 'non_combat',
  // Non-combat
  'MCV': 'non_combat', 'HARV': 'non_combat', 'MNLY': 'non_combat', 'TRUK': 'non_combat', 'MEDI': 'non_combat',
};

const INFANTRY_TYPES = new Set(['E1','E2','E3','E4','E6','E7','SPY','THF','MEDI','GNRL','DOG',
  'C1','C2','C3','C4','C5','C6','C7','C8','C9','C10','EINSTEIN','CHAN','DELPHI']);

function isInfantryByType(t: string): boolean { return INFANTRY_TYPES.has(t); }

// Spiral offsets for building placement around Construction Yard
const PLACEMENT_OFFSETS: Point[] = [
  { cx: 3, cy: 0 }, { cx: -3, cy: 0 }, { cx: 0, cy: 3 }, { cx: 0, cy: -3 },
  { cx: 3, cy: 3 }, { cx: -3, cy: 3 }, { cx: 3, cy: -3 }, { cx: -3, cy: -3 },
  { cx: 5, cy: 0 }, { cx: -5, cy: 0 }, { cx: 0, cy: 5 }, { cx: 0, cy: -5 },
  { cx: 5, cy: 3 }, { cx: -5, cy: 3 }, { cx: 5, cy: -3 }, { cx: -5, cy: -3 },
  { cx: 3, cy: 5 }, { cx: -3, cy: 5 }, { cx: 3, cy: -5 }, { cx: -3, cy: -5 },
  { cx: 7, cy: 0 }, { cx: -7, cy: 0 }, { cx: 0, cy: 7 }, { cx: 0, cy: -7 },
];

const SCG01EA_POWER_LINE_X = 67;
const SCG01EA_PRISON: Point = { cx: 62, cy: 63 };
const SCG01EA_PRISON_ASSAULT: Point = { cx: 63, cy: 60 };
const SCG01EA_TANYA_STAGE: Point = { cx: 63, cy: 56 };
const SCG01EA_EVAC_POINT: Point = { cx: 53, cy: 49 };
const SCG01EA_ESCORT_POINT: Point = { cx: 56, cy: 52 };
const SCG01EA_EVAC_READY_DISTANCE_SQ = 81;
const SCG01EA_BOARD_DISTANCE_SQ = 49;
const SCG01EA_PLAYER_TRANSPORT_BOARD_DISTANCE_SQ = 256;

const SCG02EA_SWEEP_POINTS: Point[] = [
  { cx: 80, cy: 56 },
  { cx: 78, cy: 74 },
  { cx: 60, cy: 80 },
  { cx: 49, cy: 76 },
  { cx: 49, cy: 50 },
  { cx: 61, cy: 66 },
  { cx: 63, cy: 62 },
];
const SCG02EA_DEFENSE_POINT: Point = { cx: 80, cy: 56 };
const SCG02EA_BARREL_TRAP: Point = { cx: 73, cy: 50 };
const SCG02EA_CONVOY_ROUTE: Point[] = [
  { cx: 49, cy: 50 },
  { cx: 49, cy: 76 },
  { cx: 65, cy: 82 },
  { cx: 74, cy: 82 },
];
const SCG02EA_NON_COMBAT_TYPES = new Set(['MEDI', 'TRUK', 'MCV']);
const SCG02EA_RETREAT_HP_FRACTION = 0.45;
const SCG02EA_READY_HP_FRACTION = 0.75;

// ── Minelayer defense waypoints ────────────────────────────────────────────
// For SCG04EA: enemy base is NW (~40-50,40-50), player base is SE (~85-95,48-53).
// Mines are laid in a defensive arc NW of the player base to delay enemy heavy tanks.
const MINE_WAYPOINTS: Point[] = [
  { cx: 72, cy: 48 },   // approach path center
  { cx: 70, cy: 45 },   // north of approach
  { cx: 74, cy: 51 },   // south of approach
  { cx: 68, cy: 47 },   // further NW
  { cx: 76, cy: 50 },   // closer to base, southern flank
];

// MISSION_UNLOAD enum value from C++ (used by minelayer/MCV deploy)
const MISSION_UNLOAD = 12;

// ── SCG03EA "Dead End" — destroy two bridges with Tanya ─────────────────────
// Bridge targets (converted from cell numbers: cell%128=cx, cell/128=cy)
const SCG03EA_BRIDGE_V04: Point = { cx: 54, cy: 52 };  // cell 6710 = western bridge
const SCG03EA_BRIDGE_V07: Point = { cx: 53, cy: 57 };  // cell 7349 = central bridge
const SCG03EA_FALLBACK: Point = { cx: 62, cy: 49 };    // cell 6334 = starting area
const SCG03EA_ARTY_POS: Point = { cx: 54, cy: 55 };    // cell 7094 = central fire support

// ── SCG05EA "Paradox Equation" — spy infiltration → Tanya rescue → SAM destroy ──
// Spy arrives by LST at west coast on a PENINSULA — can't walk to the base.
// Must re-board LST, sail east to a landing near the WEAP, then disembark.
// Dogs detect spies within 3 cells — avoid dogs at (49-50, 52) near the WEAP.
// After infiltration: Tanya freed, destroys 4 SAM sites, chinook evacuates her.
// Final phase: destroy all USSR+BadGuy forces.
const SCG05EA_WEAP_TARGET: Point = { cx: 43, cy: 50 };
const SCG05EA_DOG_SAFE_DISTANCE_SQ = 25; // 5 cells squared (>3 cell detection + buffer)
// Spy route uses y=48 (northmost passable row, within map bounds Y=48).
// Patrol dogs sweep y=50-58 but y=48 is mostly clear.
// SAM sites Tanya must destroy — ordered by proximity to her spawn at (25,107).
// Tanya spawns via reinforcement at WP6=(25,107), team-moves to WP35=(23,105).
// Nearest SAMs first to minimize travel through dog patrol zones.
const SCG05EA_SAM_TARGETS: Point[] = [
  { cx: 28, cy: 107 },  // 3 cells from spawn
  { cx: 16, cy: 107 },  // 9 cells
  { cx: 28, cy: 94 },   // 13 cells
  { cx: 17, cy: 94 },   // 15 cells
];

// ── SCG09EA "Infiltration" — sneak infantry north, escape via transport ──────
// Map: X=21 Y=35 W=84 H=70 (so map extends roughly (21,35) to (105,105))
// Player starts at ~(37,94)/(44,96) with 2 E1 infantry.
// Win: APCESCPE — a TRAN (chinook) arrives after triggers fire, player boards → win.
// Escape point: waypoint 0 = cell 13352 = southern map edge.
const SCG09EA_ESCAPE_POINT: Point = { cx: 40, cy: 104 };  // southern map edge
// Transport maximum passengers (LST=5, TRAN=5, APC=5)
const TRANSPORT_MAX_PASSENGERS = 5;
// Distance within which infantry should try to board a transport
const TRANSPORT_BOARD_DISTANCE_SQ = 100;  // 10 cells

// Transport types that can carry infantry
const TRANSPORT_TYPES = new Set(['LST', 'TRAN', 'APC']);

// Exploration waypoints — spiral pattern covering 64x64 cell map
const EXPLORE_WAYPOINTS = [
  { cx: 32, cy: 32 },
  { cx: 10, cy: 10 },
  { cx: 54, cy: 10 },
  { cx: 54, cy: 54 },
  { cx: 10, cy: 54 },
  { cx: 32, cy: 10 },
  { cx: 54, cy: 32 },
  { cx: 32, cy: 54 },
  { cx: 10, cy: 32 },
  { cx: 20, cy: 20 },
  { cx: 44, cy: 20 },
  { cx: 44, cy: 44 },
  { cx: 20, cy: 44 },
];

export class OracleStrategy {
  private readonly scenario: string;
  private exploreIndex = 0;
  private ticksSinceLastEnemy = 0;
  private lastEnemyCount = 0;
  private peakUnits = 0;
  private peakStructures = 0;
  private sawTanya = false;
  private sawRescue = false;
  private sawScg02eaConvoy = false;
  private scg11eaNavalUnlocked = false;
  private scg11eaMcvMoved = false;
  private scg11eaAssaultStarted = false;
  private scg02eaAssaultIndex = 0;
  private baseBuildIndex = 0;
  private placementAttempts = 0;
  private lastPlacementTick = 0;
  private syrdPlacementStart = -1;
  private shipyardPlacementAttempts = 0;
  private shipyardLastPlacementTick = 0;
  private waterScoutId = -1;          // unit sent to scout water for SYRD
  private waterScoutTarget: Point | null = null;  // where the scout is headed
  private scg03eaBridgeIndex = 0;  // 0 = first bridge, 1 = second, 2 = done
  private mineWaypointIndex = 0;
  private mineDeployPending = false;  // true when minelayer has arrived and should deploy
  private minesLaid = 0;              // total mines laid so far
  private mcvSpawnTick = 0;           // tick when MCV first appeared
  private mcvDeployAttempts = 0;      // how many times we've tried deploying
  private scg05eaSpyInfiltrated = false;  // true after spy enters WEAP
  private scg05eaSpyStopped = false;       // true after first spy intercept
  private scg05eaSpyStartTick = 0;         // tick when spy was first intercepted
  private scg05eaSamIndex = 0;           // current SAM target for Tanya
  private scg05eaSpyWpIdx = 0;          // current waypoint in south-first route
  private scg05eaSpyHoldTick = 0;        // tick when spy started holding for a dog

  private scg09eaTransportSeen = false;  // true once the escape transport appears
  private lastTick = 0;
  private currentTick = 0;
  private lastUnitTargets = new Map<number, { targetId: number; cx: number; cy: number; tick: number }>();
  // Track last move destination per unit — avoid re-sending move to same place
  private lastUnitMoves = new Map<number, { cx: number; cy: number; tick: number }>();
  private lastKnownEnemyCentroid: Point | null = null;
  // Cached coastal cells from INI MapPack parsing (computed once per mission)
  private mapParserCoastalCells: Point[] | null = null;
  // Optional INI text for dynamic coastal detection (set externally)
  private iniText: string | null = null;
  // Cached terrain template array (parsed from MapPack once)
  private terrainCache: Uint16Array | null = null;

  constructor(scenario = '') {
    this.scenario = scenario.replace(/\.[^.]+$/, '').toUpperCase();
  }

  /**
   * Provide the scenario INI text for dynamic coastal cell detection.
   * When set, the strategy will parse the MapPack to find coastal cells
   * instead of relying solely on hardcoded per-mission positions.
   */
  setINIText(text: string): void {
    this.iniText = text;
  }

  /** Get cached terrain data, parsing from INI text on first call. */
  private getTerrain(): Uint16Array | null {
    if (this.terrainCache) return this.terrainCache;
    if (!this.iniText) return null;
    try {
      const { ttype } = parseMapPack(this.iniText);
      this.terrainCache = ttype;
      return ttype;
    } catch { return null; }
  }

  // Sight ranges by type name (from RULES.INI)
  private static readonly SIGHT: Record<string, number> = {
    'FACT': 5, 'POWR': 4, 'APWR': 4, 'PROC': 6, 'WEAP': 4,
    'SYRD': 4, 'SPEN': 4, 'TENT': 5, 'BARR': 5, 'DOME': 5,
    '2TNK': 5, '1TNK': 4, '3TNK': 5, '4TNK': 4, 'ARTY': 5,
    'E1': 4, 'E3': 4, 'E6': 3, 'HARV': 4, 'MCV': 4, 'DD': 5,
  };

  /**
   * Check if a 2×2 building can be placed at (cx, cy).
   * Like the white/red placement shading in-game: validates terrain,
   * fog of war, and occupancy before sending the command.
   * For naval buildings (SYRD/SPEN), terrain must be real water (template 1-2).
   */
  canPlaceBuilding(
    cx: number, cy: number,
    state: RAGameState,
    naval: boolean,
    structureType = naval ? 'SYRD' : 'POWR',
  ): boolean {
    const terrain = this.getTerrain();
    if (!terrain) return true; // no terrain data — can't validate, try anyway

    const [fw, fh] = STRUCTURE_SIZE[structureType] ?? [2, 2];
    const cells: Array<[number, number]> = [];
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        cells.push([cx + dx, cy + dy]);
      }
    }
    for (const bib of this.getOracleBibCells(structureType, cx, cy)) {
      cells.push([bib.cx, bib.cy]);
    }

    // Build set of cells occupied by allied structures
    const occupied = new Set<string>();
    for (const s of state.structures) {
      if (!s.ally) continue;
      const [sw, sh] = STRUCTURE_SIZE[s.t] ?? [2, 2];
      for (let dy = 0; dy < sh; dy++) {
        for (let dx = 0; dx < sw; dx++) {
          occupied.add(`${s.cx + dx},${s.cy + dy}`);
        }
      }
      for (const bib of this.getOracleBibCells(s.t, s.cx, s.cy)) {
        occupied.add(`${bib.cx},${bib.cy}`);
      }
    }

    const revealed = this.getRevealedCells(state);

    const requireReveal = !(
      naval &&
      this.scenario === 'SCG11EA' &&
      (structureType === 'SYRD' || structureType === 'SPEN')
    );

    for (const [x, y] of cells) {
      if (x < 0 || x >= 128 || y < 0 || y >= 128) return false;
      if (occupied.has(`${x},${y}`)) return false;
      if (requireReveal && !revealed.has(`${x},${y}`)) return false;

      const tt = terrain[y * 128 + x];
      if (naval) {
        // Naval: only real water templates (1 or 2)
        if (tt !== 1 && tt !== 2) return false;
      } else {
        // Land: only clear terrain (255=CLEAR1 or 0xFFFF=TEMPLATE_NONE)
        if (tt !== 255 && tt !== 0xFFFF) return false;
      }
    }

    const buildRadius = this.scenario === 'SCG11EA' ? SCG11EA_BUILD_RADIUS : 2;
    let adjacent = false;
    for (const s of state.structures) {
      if (!s.ally) continue;
      const [sw, sh] = STRUCTURE_SIZE[s.t] ?? [2, 2];
      const exL = s.cx - buildRadius;
      const exT = s.cy - buildRadius;
      const exR = s.cx + sw + buildRadius;
      const exB = s.cy + sh + buildRadius;
      const nL = cx;
      const nT = cy;
      const nR = cx + fw;
      const nB = cy + fh;
      if (nL < exR && nR > exL && nT < exB && nB > exT) {
        adjacent = true;
        break;
      }
    }
    if (!adjacent) return false;

    return true;
  }

  /**
   * Find the best chain position — the furthest-east valid one.
   * Skips positions that fail terrain/fog/occupancy checks.
   */
  private findBestChainPosition(
    positions: Point[],
    state: RAGameState,
    naval: boolean,
    structureType = naval ? 'SYRD' : 'POWR',
  ): Point | null {
    let best: Point | null = null;
    for (const pos of positions) {
      if (this.canPlaceBuilding(pos.cx, pos.cy, state, naval, structureType)) {
        if (!best || pos.cx > best.cx) {
          best = pos;
        }
      }
    }
    return best;
  }

  /** Return the mission-specific build order (or the default). */
  private getBuildOrder(): BuildOrderEntry[] {
    if (this.scenario === 'SCG11EA') return SCG11EA_BUILD_ORDER;
    return BUILD_ORDER;
  }

  /**
   * Resolve coastal cells for shipyard placement.
   * Tries MapPack parsing first (if INI text available), then falls back to hardcoded.
   * Results are cached after first computation.
   */
  private resolveCoastalCells(conYard: { cx: number; cy: number }): Point[] | undefined {
    // Return cached result if available
    if (this.mapParserCoastalCells !== null) {
      return this.mapParserCoastalCells.length > 0 ? this.mapParserCoastalCells : undefined;
    }

    // Try dynamic MapPack parsing
    if (this.iniText) {
      try {
        const cells = getCoastalCellsFromText(this.iniText, conYard.cx, conYard.cy);
        if (cells.length > 0) {
          this.mapParserCoastalCells = cells;
          return cells;
        }
      } catch {
        // MapPack parse failed — fall through to hardcoded
      }
    }

    // Fall back to hardcoded per-mission coastal cells
    const hardcoded = OracleStrategy.COASTAL_CELLS[this.scenario];
    if (hardcoded) {
      this.mapParserCoastalCells = hardcoded;
      return hardcoded;
    }

    // No coastal cells available for this scenario
    this.mapParserCoastalCells = [];
    return undefined;
  }

  private scg11eaLiveShipyardCell(state: RAGameState): Point | null {
    return this.findBestChainPosition(
      this.getScg11eaShipyardCandidates(),
      state,
      true,
      'SYRD',
    );
  }

  private scg11eaShipyardReady(state: RAGameState, alliedStructures: RAStructure[]): boolean {
    return alliedStructures.some(
      (s) => s.ally && (s.t === 'SYRD' || s.t === 'SPEN'),
    ) || this.scg11eaLiveShipyardCell(state) != null;
  }

  private scg11eaBootstrapReady(alliedStructures: RAStructure[]): boolean {
    const powerCount = alliedStructures.filter((s) => s.t === 'POWR' || s.t === 'APWR').length;
    const procCount = alliedStructures.filter((s) => s.t === 'PROC').length;
    const weapCount = alliedStructures.filter((s) => s.t === 'WEAP').length;
    return powerCount >= 1 && procCount >= 1 && weapCount >= 1;
  }

  private scg11eaCoastLinkReady(alliedStructures: RAStructure[]): boolean {
    return this.getScg11eaShipyardCandidates().some((pos) =>
      this.scg11eaChainReachable(pos, alliedStructures, 'SYRD'));
  }

  private scg11eaMustReopenCoast(
    state: RAGameState,
    alliedStructures: RAStructure[],
    playerUnits: RAEntity[],
  ): boolean {
    if (this.scenario !== 'SCG11EA') return false;

    const enemySubCount = state.enemies.filter((e) => e.t === 'SS' || e.t === 'MSUB').length;
    const fleetCount = playerUnits.filter((u) => NAVAL_COMBAT_TYPES.has(u.t)).length;

    if (!this.scg11eaNavalPhaseStarted(alliedStructures)) return true;
    if (fleetCount === 0) return true;
    return enemySubCount > SCG11EA_STATIC_DEFENSE_MAX_SUBS;
  }

  private getScg11eaForwardConYard(alliedStructures: RAStructure[]): RAStructure | undefined {
    return alliedStructures.find(
      (s) => s.t === 'FACT' && s.cx >= 52 && s.cy >= 84 && s.cy <= 92,
    );
  }

  private getScg11eaHomeConYard(alliedStructures: RAStructure[]): RAStructure | undefined {
    return alliedStructures
      .filter((s) => s.t === 'FACT')
      .sort((a, b) => this.distanceSq(a, SCG11EA_HOME_MCV_TARGET) - this.distanceSq(b, SCG11EA_HOME_MCV_TARGET))[0];
  }

  private getScg11eaBootstrapCandidates(
    buildingType: string,
    alliedStructures: RAStructure[],
    playerUnits: RAEntity[],
  ): Point[] {
    const shipyardExists = alliedStructures.some((s) => s.t === 'SYRD' || s.t === 'SPEN');
    if (shipyardExists) return [];

    const powerCount = alliedStructures.filter((s) => s.t === 'POWR' || s.t === 'APWR').length;
    const procCount = alliedStructures.filter((s) => s.t === 'PROC').length;
    const weapCount = alliedStructures.filter((s) => s.t === 'WEAP').length;
    const normalizedType = buildingType === 'APWR' ? 'POWR' : buildingType;
    const homeConYard = this.getScg11eaHomeConYard(alliedStructures);
    const hx = homeConYard?.cx ?? SCG11EA_HOME_MCV_TARGET.cx;
    const hy = homeConYard?.cy ?? (SCG11EA_HOME_MCV_TARGET.cy - 1);
    const localGroundUnits = playerUnits.filter((u) =>
      u.ally &&
      !NAVAL_COMBAT_TYPES.has(u.t) &&
      !AIRCRAFT_TYPES.has(u.t));
    const terrain = this.getTerrain();

    let anchors: Point[] = [];
    if (normalizedType === 'POWR' && powerCount === 0) {
      anchors = [
        { cx: hx - 3, cy: hy + 1 }, { cx: hx - 3, cy: hy - 1 }, { cx: hx - 4, cy: hy + 1 },
        { cx: hx - 3, cy: hy + 3 }, { cx: hx + 3, cy: hy + 1 }, { cx: hx + 2, cy: hy + 3 },
      ];
    } else if (normalizedType === 'PROC' && procCount === 0) {
      anchors = [
        { cx: hx + 3, cy: hy + 3 }, { cx: hx + 2, cy: hy + 4 }, { cx: hx + 1, cy: hy + 4 },
        { cx: hx + 3, cy: hy + 2 }, { cx: hx, cy: hy + 4 }, { cx: hx - 1, cy: hy + 4 },
        { cx: hx + 1, cy: hy - 3 }, { cx: hx, cy: hy - 3 }, { cx: hx - 1, cy: hy - 3 },
        { cx: hx - 4, cy: hy - 2 }, { cx: hx - 4, cy: hy - 1 },
      ];
    } else if (normalizedType === 'WEAP' && weapCount === 0) {
      anchors = [
        { cx: hx - 7, cy: hy - 4 }, { cx: hx - 6, cy: hy - 4 }, { cx: hx - 5, cy: hy - 4 },
        { cx: hx - 4, cy: hy - 4 }, { cx: hx - 7, cy: hy + 3 }, { cx: hx - 6, cy: hy + 3 },
        { cx: hx - 7, cy: hy + 4 }, { cx: hx - 6, cy: hy + 4 },
        { cx: hx + 1, cy: hy - 3 }, { cx: hx, cy: hy - 3 }, { cx: hx - 1, cy: hy - 3 },
        { cx: hx - 4, cy: hy - 2 }, { cx: hx - 4, cy: hy - 1 }, { cx: hx - 3, cy: hy - 3 },
        { cx: hx + 3, cy: hy + 3 }, { cx: hx + 2, cy: hy + 4 },
      ];
    } else if (normalizedType === 'PROC' && procCount === 1) {
      anchors = [
        { cx: hx + 4, cy: hy - 6 }, { cx: hx + 3, cy: hy - 6 }, { cx: hx + 5, cy: hy - 5 },
        { cx: hx + 2, cy: hy - 6 }, { cx: hx + 4, cy: hy - 4 }, { cx: hx + 5, cy: hy - 4 },
        { cx: hx + 4, cy: hy + 4 }, { cx: hx + 3, cy: hy + 4 },
      ];
    }

    if (anchors.length === 0) return [];

    const seen = new Set<string>();
    const candidates: Point[] = [];
    for (const anchor of anchors) {
      if (anchor.cx < 0 || anchor.cx >= 128 || anchor.cy < 0 || anchor.cy >= 128) continue;
      const key = `${anchor.cx},${anchor.cy}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(anchor);
    }
    const crowdPenalty = (pos: Point): number => localGroundUnits.reduce((penalty, unit) => {
      const dist = this.distanceSq(unit, pos);
      if (dist > 64) return penalty;
      if (unit.t === 'MCV') return penalty + (dist <= 16 ? 800 : 120);
      if (dist <= 4) return penalty + 500;
      if (dist <= 16) return penalty + 60;
      return penalty + 8;
    }, 0);
    const orePenalty = (pos: Point): number => {
      if (normalizedType !== 'PROC' || procCount === 0) return 0;
      return this.distanceSq(pos, SCG11EA_ORE_ANCHOR) / 8;
    };
    const sidePenalty = (pos: Point): number => {
      if (!homeConYard) return 0;
      if (normalizedType === 'PROC') {
        return procCount === 0
          ? (pos.cy < hy ? 1000 : 0)
          : (pos.cy < hy ? 240 : 0);
      }
      if (normalizedType === 'WEAP') {
        return pos.cy > hy ? 600 : 0;
      }
      return 0;
    };
    const templatePenalty = (pos: Point): number => {
      if (!terrain) return 0;
      let penalty = 0;
      for (const cell of this.getPlacementCells(normalizedType, pos.cx, pos.cy)) {
        if (cell.cx < 0 || cell.cx >= 128 || cell.cy < 0 || cell.cy >= 128) return 5000;
        const tt = terrain[cell.cy * 128 + cell.cx];
        if (tt === 0xFFFF) {
          penalty += normalizedType === 'WEAP' || normalizedType === 'PROC' ? 350 : 40;
        }
      }
      return penalty;
    };
    return candidates.sort((a, b) => {
      const aScore = crowdPenalty(a) + orePenalty(a) + sidePenalty(a) + templatePenalty(a);
      const bScore = crowdPenalty(b) + orePenalty(b) + sidePenalty(b) + templatePenalty(b);
      if (aScore !== bScore) return aScore - bScore;
      if (a.cy !== b.cy) return a.cy - b.cy;
      return a.cx - b.cx;
    });
  }

  private getScg11eaPowerChainCandidates(alliedStructures: RAStructure[]): Point[] {
    const forwardConYard = this.getScg11eaForwardConYard(alliedStructures);
    if (forwardConYard) {
      const firstStepX = Math.min(59, forwardConYard.cx + 4);
      const firstStepCandidates = [
        { cx: firstStepX, cy: 90 }, { cx: firstStepX, cy: 88 }, { cx: firstStepX, cy: 86 },
        { cx: Math.min(60, firstStepX + 1), cy: 90 }, { cx: Math.min(60, firstStepX + 1), cy: 88 },
      ];
      return [
        ...firstStepCandidates,
        { cx: 59, cy: 90 }, { cx: 59, cy: 88 }, { cx: 58, cy: 90 }, { cx: 58, cy: 88 },
        { cx: 60, cy: 90 }, { cx: 60, cy: 88 }, { cx: 59, cy: 86 }, { cx: 58, cy: 86 },
        { cx: 57, cy: 90 }, { cx: 57, cy: 88 }, { cx: 56, cy: 90 },
      ];
    }

    const candidates: Point[] = [
      { cx: 30, cy: 94 },
      { cx: 29, cy: 94 },
      { cx: 28, cy: 94 },
      { cx: 31, cy: 91 },
      { cx: 30, cy: 91 },
      { cx: 29, cy: 91 },
      { cx: 28, cy: 91 },
      { cx: 33, cy: 88 },
      { cx: 32, cy: 88 },
      { cx: 31, cy: 88 },
      { cx: 34, cy: 88 },
      { cx: 34, cy: 85 },
      { cx: 33, cy: 85 },
      { cx: 32, cy: 85 },
      { cx: 34, cy: 82 },
      { cx: 33, cy: 82 },
      { cx: 32, cy: 82 },
      { cx: 35, cy: 80 },
      { cx: 36, cy: 80 },
      { cx: 37, cy: 80 },
    ];
    for (let cx = 35; cx <= 60; cx++) {
      candidates.push(
        { cx, cy: 82 },
        { cx, cy: 84 },
        { cx, cy: 86 },
        { cx, cy: 88 },
        { cx, cy: 90 },
        { cx, cy: 80 },
      );
    }
    return candidates;
  }

  private getPlacementCells(structureType: string, cx: number, cy: number): Point[] {
    const [fw, fh] = STRUCTURE_SIZE[structureType] ?? [2, 2];
    const cells: Point[] = [];
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        cells.push({ cx: cx + dx, cy: cy + dy });
      }
    }
    for (const bib of this.getOracleBibCells(structureType, cx, cy)) {
      cells.push({ cx: bib.cx, cy: bib.cy });
    }
    return cells;
  }

  private getOracleBibCells(type: string, cx: number, cy: number): Point[] {
    // SYRD/SPEN live on water. Treating them as bibbed makes the oracle reject
    // valid east-coast shipyard cells because the fake bib row lands on shore.
    if (type === 'SYRD' || type === 'SPEN') return [];
    return getBibCells(type, cx, cy);
  }

  private getRevealedCells(state: RAGameState): Set<string> {
    const revealed = new Set<string>();
    const addSight = (x: number, y: number, sight: number) => {
      // C++ coord.cpp:124-136 octagonal distance: max*2+min <= radius*2
      const threshold = sight * 2;
      for (let dy = -sight; dy <= sight; dy++) {
        for (let dx = -sight; dx <= sight; dx++) {
          const adx = Math.abs(dx);
          const ady = Math.abs(dy);
          const big = adx > ady ? adx : ady;
          const small = adx > ady ? ady : adx;
          if (big * 2 + small <= threshold) {
            revealed.add(`${x + dx},${y + dy}`);
          }
        }
      }
    };
    for (const s of state.structures) {
      if (!s.ally) continue;
      const sight = OracleStrategy.SIGHT[s.t] ?? 3;
      const [sw, sh] = STRUCTURE_SIZE[s.t] ?? [2, 2];
      for (let dy = 0; dy < sh; dy++) {
        for (let dx = 0; dx < sw; dx++) {
          addSight(s.cx + dx, s.cy + dy, sight);
        }
      }
    }
    for (const u of state.units) {
      if (!u.ally) continue;
      const sight = OracleStrategy.SIGHT[u.t] ?? 3;
      addSight(u.cx, u.cy, sight);
    }
    return revealed;
  }

  private scg11eaShipyardFootprintRevealed(state: RAGameState): boolean {
    const revealed = this.getRevealedCells(state);
    return this.getScg11eaShipyardCandidates().some((pos) =>
      this.getPlacementCells('SYRD', pos.cx, pos.cy).every((cell) =>
        revealed.has(`${cell.cx},${cell.cy}`)));
  }

  private scg11eaChainFrontierX(alliedStructures: RAStructure[]): number {
    let frontier = -1;
    for (const s of alliedStructures) {
      if (!s.ally || s.t === 'SYRD' || s.t === 'SPEN') continue;
      const width = (s.t === 'WEAP' || s.t === 'FACT') ? 3 : 2;
      const top = s.cy;
      const bottom = s.cy + 1;
      if (bottom < 78 || top > 96) continue;
      frontier = Math.max(frontier, s.cx + width - 1);
    }
    return frontier;
  }

  private scg11eaChainReachable(
    pos: Point,
    alliedStructures: RAStructure[],
    structureType = 'POWR',
  ): boolean {
    const [fw, fh] = STRUCTURE_SIZE[structureType] ?? [2, 2];
    const buildRadius = SCG11EA_BUILD_RADIUS;
    return alliedStructures.some((s) => {
      if (!s.ally || s.t === 'SYRD' || s.t === 'SPEN') return false;
      const [sw, sh] = STRUCTURE_SIZE[s.t] ?? [2, 2];
      const exL = s.cx - buildRadius;
      const exT = s.cy - buildRadius;
      const exR = s.cx + sw + buildRadius;
      const exB = s.cy + sh + buildRadius;
      const nL = pos.cx;
      const nT = pos.cy;
      const nR = pos.cx + fw;
      const nB = pos.cy + fh;
      return nL < exR && nR > exL && nT < exB && nB > exT;
    });
  }

  private scg11eaChainOccupied(pos: Point, alliedStructures: RAStructure[]): boolean {
    return alliedStructures.some((s) => {
      if (!s.ally) return false;
      const width = (s.t === 'WEAP' || s.t === 'FACT') ? 3 : 2;
      const left = s.cx;
      const right = s.cx + width - 1;
      const top = s.cy;
      const bottom = s.cy + 1;
      const candidateLeft = pos.cx;
      const candidateRight = pos.cx + 1;
      const candidateTop = pos.cy;
      const candidateBottom = pos.cy + 1;
      return !(candidateRight < left || candidateLeft > right || candidateBottom < top || candidateTop > bottom);
    });
  }

  private getScg11eaShipyardCandidates(): Point[] {
    return [
      // Prefer slightly deeper east-coast water than the shoreline-adjacent cells.
      // The yard still places here reliably, and DD launches get more room.
      { cx: 65, cy: 85 }, { cx: 65, cy: 86 }, { cx: 64, cy: 85 }, { cx: 64, cy: 86 },
      { cx: 65, cy: 84 }, { cx: 65, cy: 87 }, { cx: 64, cy: 84 }, { cx: 64, cy: 87 },
      { cx: 63, cy: 85 }, { cx: 63, cy: 86 }, { cx: 64, cy: 88 }, { cx: 65, cy: 88 },
      { cx: 63, cy: 84 }, { cx: 63, cy: 87 }, { cx: 63, cy: 88 }, { cx: 63, cy: 89 },
      { cx: 64, cy: 89 }, { cx: 65, cy: 89 }, { cx: 63, cy: 90 },
    ];
  }

  private getScg11eaShoreDefenseCandidates(buildingType: string): Point[] {
    const eastShoreBand = [
      { cx: 58, cy: 90 }, { cx: 58, cy: 88 }, { cx: 58, cy: 86 }, { cx: 58, cy: 84 },
      { cx: 56, cy: 90 }, { cx: 56, cy: 88 }, { cx: 56, cy: 86 }, { cx: 56, cy: 84 },
      { cx: 54, cy: 90 }, { cx: 54, cy: 88 }, { cx: 54, cy: 86 }, { cx: 54, cy: 84 },
      { cx: 52, cy: 90 }, { cx: 52, cy: 88 }, { cx: 52, cy: 86 }, { cx: 52, cy: 84 },
      { cx: 50, cy: 90 }, { cx: 50, cy: 88 }, { cx: 50, cy: 86 }, { cx: 50, cy: 84 },
    ];

    if (buildingType === 'AGUN') {
      return eastShoreBand;
    }

    return [
      { cx: 56, cy: 90 }, { cx: 56, cy: 88 }, { cx: 56, cy: 86 },
      { cx: 54, cy: 90 }, { cx: 54, cy: 88 }, { cx: 54, cy: 86 },
      { cx: 52, cy: 90 }, { cx: 52, cy: 88 }, { cx: 52, cy: 86 },
      { cx: 58, cy: 90 }, { cx: 58, cy: 88 }, { cx: 58, cy: 86 },
      { cx: 50, cy: 90 }, { cx: 50, cy: 88 }, { cx: 50, cy: 86 },
    ];
  }

  private chooseScg11eaAssaultTarget(enemyStructures: RAStructure[]): RAStructure | null {
    const pickPriorityTarget = (
      bounds: { minCx: number; maxCx: number; minCy: number; maxCy: number },
      priority: string[],
    ): RAStructure | null => {
      const rank = new Map(priority.map((t, i) => [t, i]));
      const candidates = enemyStructures
        .filter(
          (s) =>
            s.cx >= bounds.minCx &&
            s.cx <= bounds.maxCx &&
            s.cy >= bounds.minCy &&
            s.cy <= bounds.maxCy &&
            rank.has(s.t),
        )
        .sort((a, b) => {
          const aRank = rank.get(a.t) ?? 999;
          const bRank = rank.get(b.t) ?? 999;
          if (aRank !== bRank) return aRank - bRank;
          if (a.cx !== b.cx) return a.cx - b.cx;
          if (a.cy !== b.cy) return b.cy - a.cy;
          return this.distanceSq(a, SCG11EA_PRIMARY_ASSAULT_POINT) - this.distanceSq(b, SCG11EA_PRIMARY_ASSAULT_POINT);
        });
      return candidates[0] ?? null;
    };

    // Priority: production first (stop enemy reinforcements), then defense, then power.
    // WEAP → FACT → BARR/TENT → AFLD/HPAD → SPEN → defense → power.
    // Island Soviet base first (x=35-60), then eastern/mainland bases.
    return pickPriorityTarget(
      { minCx: 35, maxCx: 60, minCy: 35, maxCy: 58 },
      ['WEAP', 'FACT', 'BARR', 'KENN', 'AFLD', 'HPAD', 'STEK', 'TSLA', 'FTUR', 'SAM', 'PROC', 'DOME', 'APWR', 'POWR'],
    ) ?? pickPriorityTarget(
      { minCx: 60, maxCx: 105, minCy: 35, maxCy: 60 },
      ['WEAP', 'FACT', 'SPEN', 'AFLD', 'HPAD', 'TSLA', 'FTUR', 'SAM', 'FCOM', 'PROC', 'APWR', 'POWR'],
    );
  }

  private scg11eaNavalPhaseStarted(alliedStructures: RAStructure[]): boolean {
    return this.scg11eaNavalUnlocked || alliedStructures.some((s) => s.t === 'SYRD' || s.t === 'SPEN');
  }

  private scg11eaDesiredShipCount(enemySubCount: number): number {
    if (enemySubCount <= 0) return 0;
    if (enemySubCount >= 6) return 5;
    if (enemySubCount >= 3) return 4;
    if (enemySubCount >= 1) return 3;
    return 0;
  }

  decide(state: RAGameState): OracleDecision {
    this.peakUnits = Math.max(this.peakUnits, state.units.length);
    this.peakStructures = Math.max(this.peakStructures, state.structures.length);

    this.currentTick = state.tick;
    const tickDelta = this.lastTick > 0 ? state.tick - this.lastTick : 15;
    if (state.enemies.length > 0) {
      this.ticksSinceLastEnemy = 0;
      this.lastEnemyCount = state.enemies.length;
      this.lastKnownEnemyCentroid = this.centroid(state.enemies);
    } else {
      this.ticksSinceLastEnemy += tickDelta;
    }

    if (state.units.some((u) => u.t === 'E7')) {
      this.sawTanya = true;
    }
    if (this.isScg01eaRescueTriggered(state)) {
      this.sawRescue = true;
    }
    if (state.units.some((u) => u.t === 'TRUK')) {
      this.sawScg02eaConvoy = true;
    }

    let result: OracleDecision;
    if (this.scenario === 'SCG01EA') {
      result = this.decideScg01ea(state);
    } else if (this.scenario === 'SCG02EA') {
      result = this.decideScg02ea(state);
    } else if (this.scenario === 'SCG03EA') {
      result = this.decideScg03ea(state);
    } else if (this.scenario === 'SCG05EA') {
      result = this.decideScg05ea(state);
    } else if (this.scenario === 'SCG08EA') {
      result = this.decideScg08ea(state);
    } else if (this.scenario === 'SCG09EA') {
      result = this.decideTransportEscape(state);
    } else if (this.scenario === 'SCG11EA') {
      result = this.decideScg11ea(state);
    } else {
      result = this.decideGeneric(state);
    }
    this.lastTick = state.tick;
    return result;
  }

  // SCG08EA: Never attack first — the HUNT trigger makes all enemies rush
  // the ATEK/PDOX if provoked. Defend only.
  private static readonly SCG08EA_INTERCEPT: Point = { cx: 58, cy: 80 };
  // Missions that should NEVER initiate attacks (defense/survival only)
  private static readonly DEFENSE_ONLY_MISSIONS = new Set(['SCG08EA']);

  // Per-mission coastal cells for shipyard placement (fallback).
  // Dynamic detection via MapPack parsing (mapParser.ts) is preferred
  // when INI text is available. These hardcoded values serve as a
  // reliable fallback when the parser is not initialized.
  private static readonly COASTAL_CELLS: Record<string, Point[]> = {
    'SCG07EA': [{ cx: 52, cy: 50 }, { cx: 50, cy: 48 }, { cx: 54, cy: 52 }],
    'SCG11EA': [
      // East shoreline — clear land at x=57-60 with water immediately east.
      // Chain buildings east to x=56, then leave x=58 free for SYRD/SPEN.
      { cx: 58, cy: 88 }, { cx: 58, cy: 90 }, { cx: 58, cy: 86 },
      { cx: 57, cy: 88 }, { cx: 57, cy: 90 }, { cx: 57, cy: 86 },
    ],
    'SCG11EB': [
      { cx: 22, cy: 85 }, { cx: 24, cy: 84 }, { cx: 20, cy: 86 },
    ],
  };

  checkResult(state: RAGameState): OracleResult {
    if (state.winPending) {
      return 'victory';
    }
    if (state.losePending) {
      return 'defeat';
    }

    if (this.scenario === 'SCG01EA' && state.civEvacuated) {
      return 'victory';
    }

    if (
      state.units.length === 0 &&
      state.structures.filter((s) => s.ally).length === 0 &&
      state.tick > sec(7) &&
      this.peakUnits > 0
    ) {
      return 'defeat';
    }

    if ((this.scenario === 'SCG01EA' || this.scenario === 'SCG03EA') && this.sawTanya && state.tick > sec(16)) {
      const tanyaAlive = state.units.some((u) => u.t === 'E7');
      if (!tanyaAlive) {
        return 'defeat';
      }
    }

    if (
      this.scenario === 'SCG02EA' &&
      this.sawScg02eaConvoy &&
      !state.units.some((u) => u.t === 'TRUK') &&
      !state.losePending
    ) {
      return 'victory';
    }

    if (
      state.enemies.length === 0 &&
      state.tick > sec(13) &&
      this.ticksSinceLastEnemy > sec(200) &&
      this.lastEnemyCount > 0 &&
      this.exploreIndex >= EXPLORE_WAYPOINTS.length
    ) {
      return 'victory';
    }

    return 'playing';
  }

  summarize(state: RAGameState, iteration: number, decision: OracleDecision): string {
    const unitTypes = this.countTypes(state.units);
    const enemyTypes = this.countTypes(state.enemies);
    const globals = state.globals?.length ? ` globals=${state.globals.join(',')}` : '';
    const missionTimer = state.missionTimerActive ? ` timer=${state.missionTimer}` : '';
    const bridges = state.bridgeCount != null ? ` bridges=${state.bridgeCount}` : '';
    const prodItems = state.production.map(
      (p) => `${p.t}:${p.prog}%${p.done ? '*' : ''}`,
    ).join(',');
    const prodStr = prodItems ? ` prod=[${prodItems}]` : '';
    return (
      `[Oracle] #${iteration} tick=${state.tick} ` +
      `units=${state.units.length}(${unitTypes}) ` +
      `enemies=${state.enemies.length}(${enemyTypes}) ` +
      `structs=${state.structures.length} ` +
      `credits=${state.credits} ` +
      `power=${state.power.produced}/${state.power.consumed}${prodStr}${globals}${missionTimer}${bridges} ` +
      `| ${decision.reason}`
    );
  }

  private decideGeneric(state: RAGameState): OracleDecision {
    // Detect MCV or Construction Yard — switch to base-building mode
    const playerUnits = this.playerOwnedUnits(state);
    const hasMCV = playerUnits.some((u) => u.t === 'MCV');
    const alliedStructures = state.structures.filter((s) => s.ally);
    const hasConYard = alliedStructures.some((s) => s.t === 'FACT');

    if (hasMCV || hasConYard) {
      return this.decideBaseBuilding(state);
    }

    // Early game before MCV arrives — stay defensive, don't scatter
    // But only if we DON'T have an existing base (if we do, decideGenericCombat handles it)
    if (state.tick < sec(100) && playerUnits.length > 0 && !hasConYard && alliedStructures.length === 0) {
      const commands: Array<Record<string, unknown>> = [];
      const reasons: string[] = [];
      const combat = playerUnits.filter(
        (u) => this.isCombatUnit(u) && !BASE_NON_COMBAT_TYPES.has(u.t) &&
          !this.isReservedScg11eaScout(u, alliedStructures),
      );
      const nearbyEnemies = state.enemies.filter(
        (e) => combat.some((u) => this.distanceSq(u, e) <= 225),
      );
      if (nearbyEnemies.length > 0 && combat.length > 0) {
        const micro = this.microManage(combat, nearbyEnemies, this.centroid(combat));
        commands.push(...micro.commands);
        reasons.push('early defense', ...micro.reasons);
      } else {
        reasons.push('holding position — waiting for MCV');
      }
      return { commands, reason: reasons.join('; ') };
    }

    // No MCV/ConYard — use force-ratio-aware combat
    return this.decideGenericCombat(state, playerUnits, alliedStructures);
  }

  /**
   * Base-building strategy: deploy MCV, follow build order, produce units, combat.
   */
  private decideBaseBuilding(state: RAGameState): OracleDecision {
    const commands: Array<Record<string, unknown>> = [];
    const reasons: string[] = [];
    const playerUnits = this.playerOwnedUnits(state);
    const alliedStructures = state.structures.filter((s) => s.ally);
    const buildable = state.buildable;

    // --- Phase 1: DEPLOY MCV ---
    const mcv = playerUnits.find((u) => u.t === 'MCV');
    const conYard = alliedStructures.find((s) => s.t === 'FACT');

    if (mcv && !conYard) {
      // Track MCV spawn time for stuck detection
      if (this.mcvSpawnTick === 0) this.mcvSpawnTick = state.tick;
      const mcvAge = state.tick - this.mcvSpawnTick;

      // MCV may be moving to a scenario-scripted position. Don't interrupt movement.
      // Once idle, issue deploy. If deploy doesn't take after many attempts,
      // try a small nudge then deploy next tick.
      if (mcv.m === MISSION_UNLOAD) {
        // MCV is already deploying (MISSION_UNLOAD) — don't re-send deploy
        reasons.push('MCV deploying');
      } else if (this.isIdle(mcv)) {
        commands.push({ cmd: 'deploy', ids: [mcv.id] });
        this.mcvDeployAttempts++;
        reasons.push(mcvAge > sec(20) ? `deploy MCV (idle, ${mcvAge} ticks)` : 'deploy MCV');
      } else if (mcvAge > sec(133) && this.mcvDeployAttempts === 0) {
        // MCV never became idle — force deploy anyway (might be in non-idle guard state)
        commands.push({ cmd: 'deploy', ids: [mcv.id] });
        this.mcvDeployAttempts++;
        reasons.push(`force deploy MCV (never idle, ${mcvAge} ticks)`);
      } else {
        reasons.push('MCV moving to position...');
      }

      const combatEscorts = playerUnits.filter(
        (u) => u.id !== mcv.id && this.isCombatUnit(u) && !BASE_NON_COMBAT_TYPES.has(u.t) &&
          !this.isReservedScg11eaScout(u, alliedStructures),
      );

      if (alliedStructures.length > 0) {
        // We have a base — defend it, don't pull army to MCV
        const baseCenter = this.findBase(alliedStructures);
        const baseThreats = state.enemies.filter(
          (e) => this.distanceSq(e, baseCenter) <= 400,
        );
        if (baseThreats.length > 0 && combatEscorts.length > 0) {
          const micro = this.microManage(combatEscorts, baseThreats, baseCenter);
          commands.push(...micro.commands);
          reasons.push(`defend base (${baseThreats.length} threats)`, ...micro.reasons);
        }
      } else {
        // No base — escort the MCV
        const nearbyThreats = state.enemies.filter(
          (e) => this.distanceSq(e, mcv) <= 225,
        );
        if (nearbyThreats.length > 0 && combatEscorts.length > 0) {
          const micro = this.microManage(combatEscorts, nearbyThreats, mcv);
          commands.push(...micro.commands);
          reasons.push(...micro.reasons);
        } else if (combatEscorts.length > 0) {
          const strayEscorts = combatEscorts.filter(
            (u) => this.distanceSq(u, mcv) > 36,
          );
          if (strayEscorts.length > 0) {
            commands.push({
              cmd: 'move',
              ids: strayEscorts.map((u) => u.id),
              cx: mcv.cx,
              cy: mcv.cy,
            });
            reasons.push(`rally ${strayEscorts.length} to MCV`);
          }
        }
      }
      this.dispatchMinelayers(playerUnits, mcv, commands, reasons);
      return { commands, reason: reasons.join('; ') };
    }

    if (!conYard) {
      // No MCV, no ConYard — fall back to basic combat
      return this.decideGenericCombat(state, playerUnits, alliedStructures);
    }

    // --- Phase 2: BUILD ORDER ---
    // Check if something is currently in production (building type)
    const buildingProduction = state.production.find(
      (p) => p.rtti === RTTI_BUILDINGTYPE,
    );
    const existingShipyard = alliedStructures.some(
      (s) => s.t === 'SYRD' || s.t === 'SPEN',
    );
    const scg11eaStuckUtilityBuild =
      this.scenario === 'SCG11EA' &&
      buildingProduction != null &&
      buildingProduction.prog === 0 &&
      (buildingProduction.t === 'POWR' ||
        buildingProduction.t === 'APWR' ||
        buildingProduction.t === 'PROC') &&
      state.credits >= SCG11EA_DEFENSE_CREDIT_RESERVE &&
      (
        (
          (buildingProduction.t === 'POWR' || buildingProduction.t === 'APWR') &&
          state.power.produced >= state.power.consumed + 120
        ) ||
        (
          buildingProduction.t === 'PROC' &&
          alliedStructures.filter((s) => s.t === 'PROC').length >= 3
        )
      );
    const suppressScg11eaLeftoverBuild =
      this.scenario === 'SCG11EA' &&
      (
        (
          existingShipyard &&
          buildingProduction != null &&
          !buildingProduction.done &&
          buildingProduction.t !== 'SYRD' &&
          buildingProduction.t !== 'SPEN' &&
          (buildingProduction.t === 'POWR' || buildingProduction.t === 'APWR' || buildingProduction.t === 'PROC')
        ) ||
        scg11eaStuckUtilityBuild
      );
    const scg11eaBaseThreatCount =
      this.scenario === 'SCG11EA'
        ? state.enemies.filter((e) =>
          !NAVAL_COMBAT_TYPES.has(e.t) &&
          alliedStructures.some((s) => this.distanceSq(e, s) <= 400)).length
        : 0;
    const scg11eaGroundThreatCount =
      this.scenario === 'SCG11EA'
        ? state.enemies.filter((e) =>
          !NAVAL_COMBAT_TYPES.has(e.t) &&
          !AIRCRAFT_TYPES.has(e.t) &&
          alliedStructures.some((s) => this.distanceSq(e, s) <= 400)).length
        : 0;
    const scg11eaEnemyAirCount =
      this.scenario === 'SCG11EA'
        ? state.enemies.filter((e) =>
          e.t === 'YAK' || e.t === 'MIG' || e.t === 'HIND' || e.t === 'HELI').length
        : 0;
    const scg11eaLocalAirThreatCount =
      this.scenario === 'SCG11EA'
        ? state.enemies.filter((e) =>
          AIRCRAFT_TYPES.has(e.t) &&
          alliedStructures.some((s) => this.distanceSq(e, s) <= 400)).length
        : 0;
    const scg11eaEnemySubCount =
      this.scenario === 'SCG11EA'
        ? state.enemies.filter((e) => e.t === 'SS' || e.t === 'MSUB').length
        : 0;

    if (!buildingProduction || (buildingProduction.t !== 'SYRD' && buildingProduction.t !== 'SPEN')) {
      this.syrdPlacementStart = -1;
      this.shipyardPlacementAttempts = 0;
      this.shipyardLastPlacementTick = 0;
    }

    // Place completed buildings
    if (buildingProduction?.done && !suppressScg11eaLeftoverBuild) {
      const isShipyard = buildingProduction.t === 'SYRD' || buildingProduction.t === 'SPEN';

      if (isShipyard) {
        // Shipyards need mapped water cells. For SCG11EA we know the exact
        // real-water edge, so keep placement deterministic instead of
        // falling through to broad fallback scans.
        if (this.syrdPlacementStart < 0) {
          this.syrdPlacementStart = state.tick;
          this.shipyardPlacementAttempts = 0;
          this.shipyardLastPlacementTick = 0;
        }

        // Build placement candidates: hardcoded coastal cells first (most reliable),
        // then vessel-based scan as fallback.
        const candidates: Array<{ cx: number; cy: number }> = [];
        if (this.scenario === 'SCG11EA') {
          candidates.push(...this.getScg11eaShipyardCandidates());
        } else {
          // Find water reference from enemy vessels
          const vessels = state.enemies.filter(
            (e) => e.t === 'SS' || e.t === 'DD' || e.t === 'CA' || e.t === 'PT' || e.t === 'MSUB',
          );
          const baseCx = conYard.cx;
          const baseCy = conYard.cy;
          const coastRef = OracleStrategy.COASTAL_CELLS[this.scenario];
          if (coastRef) {
            for (const ref of coastRef) {
              for (let dy = -3; dy <= 10; dy++) {
                for (let dx = -4; dx <= 4; dx++) {
                  candidates.push({ cx: ref.cx + dx, cy: ref.cy + dy });
                }
              }
            }
          }
          if (vessels.length > 0) {
            let nearest = vessels[0];
            let bestDist = Infinity;
            for (const v of vessels) {
              const d = (v.cx - baseCx) ** 2 + (v.cy - baseCy) ** 2;
              if (d < bestDist) { bestDist = d; nearest = v; }
            }
            const midCx = Math.round(baseCx + (nearest.cx - baseCx) * 0.6);
            const midCy = Math.round(baseCy + (nearest.cy - baseCy) * 0.6);
            for (let dy = -10; dy <= 10; dy++) {
              for (let dx = -10; dx <= 10; dx++) {
                candidates.push({ cx: midCx + dx, cy: midCy + dy });
              }
            }
            for (let dy = -5; dy <= 5; dy++) {
              for (let dx = -5; dx <= 5; dx++) {
                candidates.push({ cx: nearest.cx + dx, cy: nearest.cy + dy });
              }
            }
          }
        }
        // Deduplicate
        const seen = new Set<string>();
        const uniqueCandidates = candidates.filter((c) => {
          const key = `${c.cx},${c.cy}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // Last resort: if no vessels and no coastal cells, scan toward map edges
        if (uniqueCandidates.length === 0 && this.scenario !== 'SCG11EA') {
          const baseCx = conYard.cx;
          const baseCy = conYard.cy;
          for (let dy = -15; dy <= 15; dy++) {
            for (let dx = 0; dx <= 30; dx++) {
              candidates.push({ cx: baseCx + dx, cy: baseCy + dy });
              candidates.push({ cx: baseCx - dx, cy: baseCy + dy });
            }
          }
          const seen2 = new Set<string>();
          for (const c of candidates) {
            const key = `${c.cx},${c.cy}`;
            if (!seen2.has(key)) { seen2.add(key); uniqueCandidates.push(c); }
          }
        }

        if (uniqueCandidates.length > 0) {
          // Use placement validator to find the first valid cell (skip fog/terrain failures)
          const validCell = this.findBestChainPosition(uniqueCandidates, state, true, 'SYRD');
          const cell = validCell ?? uniqueCandidates[this.shipyardPlacementAttempts % uniqueCandidates.length];
          commands.push({
            cmd: 'place',
            rtti: RTTI_BUILDINGTYPE,
            cx: cell.cx,
            cy: cell.cy,
          });
          if (state.tick - this.shipyardLastPlacementTick > 30) {
            this.shipyardPlacementAttempts++;
            this.shipyardLastPlacementTick = state.tick;
          }
          reasons.push(`place ${buildingProduction.t} at (${cell.cx},${cell.cy}) [water ${validCell ? 'valid' : this.shipyardPlacementAttempts}/${uniqueCandidates.length}]`);
        }
      } else {
        // Sort placement offsets by priority:
        // 1. SCG11EA refineries bias toward the ore field.
        // 2. SCG11EA east-shore defenses pin near the shipyard corridor.
        // 3. Other missions can bias toward the nearest coast.
        // 3. Default offset order.
        const coastalCells2 = this.resolveCoastalCells(conYard);
        let placeRef = { cx: conYard.cx, cy: conYard.cy };
        if (this.scenario === 'SCG11EA' && buildingProduction.t === 'PROC') {
          const procCount = alliedStructures.filter((s) => s.t === 'PROC').length;
          if (procCount === 0) {
            let bestDist = Infinity;
            for (const s of alliedStructures) {
              const d = (s.cx - SCG11EA_ORE_ANCHOR.cx) ** 2 + (s.cy - SCG11EA_ORE_ANCHOR.cy) ** 2;
              if (d < bestDist) {
                bestDist = d;
                placeRef = { cx: s.cx, cy: s.cy };
              }
            }
          } else {
            placeRef = { cx: conYard.cx, cy: conYard.cy };
          }
        } else if (this.scenario !== 'SCG11EA' && coastalCells2 && coastalCells2.length > 0) {
          // Find the allied structure closest to water
          const waterTarget = coastalCells2[0];
          let bestDist = Infinity;
          for (const s of alliedStructures) {
            const d = (s.cx - waterTarget.cx) ** 2 + (s.cy - waterTarget.cy) ** 2;
            if (d < bestDist) {
              bestDist = d;
              placeRef = { cx: s.cx, cy: s.cy };
            }
          }
        }

        let offsets = [...PLACEMENT_OFFSETS];
        let scg11eaProcCandidates: Point[] = [];
        const scg11eaShipyardExists = alliedStructures.some((s) => s.t === 'SYRD' || s.t === 'SPEN');
        const scg11eaBootstrapReady =
          this.scenario === 'SCG11EA' && this.scg11eaBootstrapReady(alliedStructures);
        const scg11eaCoastChainCritical =
          this.scenario === 'SCG11EA' &&
          this.scg11eaMustReopenCoast(state, alliedStructures, playerUnits);
        const scg11eaExtendCoastChain =
          this.scenario === 'SCG11EA' &&
          (buildingProduction.t === 'POWR' || buildingProduction.t === 'APWR') &&
          scg11eaBootstrapReady &&
          scg11eaCoastChainCritical &&
          !scg11eaShipyardExists &&
          !this.scg11eaCoastLinkReady(alliedStructures);
        const scg11eaPowerChainCandidates =
          scg11eaExtendCoastChain
            ? this.getScg11eaPowerChainCandidates(alliedStructures)
            : [];
        const scg11eaBootstrapCandidates =
          this.scenario === 'SCG11EA'
            ? this.getScg11eaBootstrapCandidates(buildingProduction.t, alliedStructures, playerUnits)
            : [];
        const scg11eaShoreDefenseCandidates =
          this.scenario === 'SCG11EA' &&
            (buildingProduction.t === 'AGUN' ||
              buildingProduction.t === 'GUN' ||
              buildingProduction.t === 'FTUR')
            ? this.getScg11eaShoreDefenseCandidates(buildingProduction.t)
            : [];
        if (this.scenario === 'SCG11EA' && buildingProduction.t === 'PROC') {
          offsets.sort((a, b) => {
            const aDist = (placeRef.cx + a.cx - SCG11EA_ORE_ANCHOR.cx) ** 2 +
              (placeRef.cy + a.cy - SCG11EA_ORE_ANCHOR.cy) ** 2;
            const bDist = (placeRef.cx + b.cx - SCG11EA_ORE_ANCHOR.cx) ** 2 +
              (placeRef.cy + b.cy - SCG11EA_ORE_ANCHOR.cy) ** 2;
            return aDist - bDist;
          });

          const procAnchor = playerUnits.some((u) => u.t === 'HARV')
            ? this.centroid(playerUnits.filter((u) => u.t === 'HARV'))
            : SCG11EA_ORE_ANCHOR;
          const candidateAnchors = alliedStructures
            .filter((s) =>
              s.t === 'FACT' ||
              s.t === 'PROC' ||
              s.t === 'POWR' ||
              s.t === 'APWR' ||
              s.t === 'WEAP')
            .sort((a, b) =>
              this.distanceSq(a, procAnchor) - this.distanceSq(b, procAnchor))
            .slice(0, 4);
          if (candidateAnchors.length === 0) {
            candidateAnchors.push(conYard);
          }
          for (const anchor of candidateAnchors) {
            for (let dy = -12; dy <= 6; dy++) {
              for (let dx = -10; dx <= 10; dx++) {
                scg11eaProcCandidates.push({ cx: anchor.cx + dx, cy: anchor.cy + dy });
              }
            }
          }
          scg11eaProcCandidates = scg11eaProcCandidates
            .filter((pos) => pos.cx >= 0 && pos.cx < 128 && pos.cy >= 0 && pos.cy < 128)
            .sort((a, b) => {
              const aOre = this.distanceSq(a, procAnchor);
              const bOre = this.distanceSq(b, procAnchor);
              if (aOre !== bOre) return aOre - bOre;
              if (a.cy !== b.cy) return a.cy - b.cy;
              return Math.abs(a.cx - procAnchor.cx) - Math.abs(b.cx - procAnchor.cx);
            });
        } else if (this.scenario !== 'SCG11EA' && coastalCells2 && coastalCells2.length > 0) {
          // Sort offsets toward water from the reference building
          const wt = coastalCells2[0];
          offsets.sort((a, b) => {
            const aDist = (placeRef.cx + a.cx - wt.cx) ** 2 + (placeRef.cy + a.cy - wt.cy) ** 2;
            const bDist = (placeRef.cx + b.cx - wt.cx) ** 2 + (placeRef.cy + b.cy - wt.cy) ** 2;
            return aDist - bDist;
          });
        } else if (buildingProduction.t === 'PROC' && this.lastKnownEnemyCentroid) {
          const ec = this.lastKnownEnemyCentroid;
          offsets.sort((a, b) => {
            const aDist = (placeRef.cx + a.cx - ec.cx) ** 2 + (placeRef.cy + a.cy - ec.cy) ** 2;
            const bDist = (placeRef.cx + b.cx - ec.cx) ** 2 + (placeRef.cy + b.cy - ec.cy) ** 2;
            return bDist - aDist;
          });
        }

        let placeCx = placeRef.cx;
        let placeCy = placeRef.cy;
        // Find first offset that passes terrain/fog/occupancy validation
        let foundValid = false;
        if (scg11eaBootstrapCandidates.length > 0) {
          for (let i = 0; i < scg11eaBootstrapCandidates.length; i++) {
            const idx = (this.placementAttempts + i) % scg11eaBootstrapCandidates.length;
            const candidate = scg11eaBootstrapCandidates[idx];
            if (this.canPlaceBuilding(candidate.cx, candidate.cy, state, false, buildingProduction.t)) {
              placeCx = candidate.cx;
              placeCy = candidate.cy;
              foundValid = true;
              break;
            }
          }
        } else if (scg11eaPowerChainCandidates.length > 0) {
          const reachableChain = scg11eaPowerChainCandidates.filter((pos) =>
            this.scg11eaChainReachable(pos, alliedStructures));
          if (reachableChain.length > 0) {
            const frontierX = this.scg11eaChainFrontierX(alliedStructures);
            const unoccupiedReachable = reachableChain.filter((pos) =>
              !this.scg11eaChainOccupied(pos, alliedStructures));
            const chainOrder = new Map(
              scg11eaPowerChainCandidates.map((pos, idx) => [`${pos.cx},${pos.cy}`, idx]),
            );
            const eastmostRightEdge = alliedStructures.reduce((best, s) => {
              if (!s.ally || s.t === 'SYRD' || s.t === 'SPEN') return best;
              const [sw] = STRUCTURE_SIZE[s.t] ?? [2, 2];
              return Math.max(best, s.cx + sw - 1);
            }, -1);
            const staircaseEstablished =
              eastmostRightEdge >= 38 ||
              alliedStructures.filter((s) => s.ally && (s.t === 'POWR' || s.t === 'APWR')).length >= 6;
            const frontierBandReachable = staircaseEstablished
              ? unoccupiedReachable.filter((pos) => pos.cx >= eastmostRightEdge - 1)
              : unoccupiedReachable;
            const preferredReachable = frontierBandReachable.length > 0
              ? frontierBandReachable
              : unoccupiedReachable;
            const chainProgress = (pos: Point) => {
              const eastScore = pos.cx * 1000;
              const shoreBias = staircaseEstablished
                ? (200 - Math.abs(pos.cy - 80) * 40)
                : (120 - Math.abs(pos.cy - 88) * 20);
              const forwardBias = frontierX >= 0 && pos.cx > frontierX ? 50 : 0;
              return eastScore + shoreBias + forwardBias;
            };
            const orderedReachable = preferredReachable.sort((a, b) => {
              const progressDelta = chainProgress(b) - chainProgress(a);
              if (progressDelta !== 0) return progressDelta;
              return (chainOrder.get(`${a.cx},${a.cy}`) ?? 9999) - (chainOrder.get(`${b.cx},${b.cy}`) ?? 9999);
            });
            const validChain = orderedReachable.filter((pos) =>
              this.canPlaceBuilding(pos.cx, pos.cy, state, false, buildingProduction.t));
            if (validChain.length > 0) {
              placeCx = validChain[0].cx;
              placeCy = validChain[0].cy;
              foundValid = true;
            }
          }
        } else if (scg11eaShoreDefenseCandidates.length > 0) {
          const validDefenseCell = this.findBestChainPosition(scg11eaShoreDefenseCandidates, state, false, buildingProduction.t);
          if (validDefenseCell) {
            placeCx = validDefenseCell.cx;
            placeCy = validDefenseCell.cy;
            foundValid = true;
          }
        }
        if (!foundValid && this.scenario === 'SCG11EA' && buildingProduction.t === 'PROC' && scg11eaProcCandidates.length > 0) {
          const seenCandidates = new Set<string>();
          for (const pos of scg11eaProcCandidates) {
            const key = `${pos.cx},${pos.cy}`;
            if (seenCandidates.has(key)) continue;
            seenCandidates.add(key);
            if (this.canPlaceBuilding(pos.cx, pos.cy, state, false, buildingProduction.t)) {
              placeCx = pos.cx;
              placeCy = pos.cy;
              foundValid = true;
              break;
            }
          }
        }
        const scg11eaStrictChainHold =
          this.scenario === 'SCG11EA' && scg11eaPowerChainCandidates.length > 0;
        if (!foundValid && !scg11eaStrictChainHold) {
          for (let i = 0; i < offsets.length; i++) {
            const idx = (this.placementAttempts + i) % offsets.length;
            const cx = placeRef.cx + offsets[idx].cx;
            const cy = placeRef.cy + offsets[idx].cy;
            if (this.canPlaceBuilding(cx, cy, state, false, buildingProduction.t)) {
              placeCx = cx;
              placeCy = cy;
              foundValid = true;
              break;
            }
          }
        }
        if (!foundValid && !scg11eaStrictChainHold) {
          if (this.placementAttempts < offsets.length) {
            const offset = offsets[this.placementAttempts % offsets.length];
            placeCx = placeRef.cx + offset.cx;
            placeCy = placeRef.cy + offset.cy;
          } else {
            // Exhausted offsets — extend toward water
            const wt = coastalCells2?.[0] ?? { cx: placeRef.cx, cy: placeRef.cy - 10 };
            const angle = Math.atan2(wt.cy - placeRef.cy, wt.cx - placeRef.cx)
              + ((this.placementAttempts % 5) - 2) * 0.3;
            const dist = 8 + (this.placementAttempts % 10);
            placeCx = Math.round(placeRef.cx + Math.cos(angle) * dist);
            placeCy = Math.round(placeRef.cy + Math.sin(angle) * dist);
          }
        }
        const holdScg11eaPlacement = !foundValid && scg11eaStrictChainHold;
        if (holdScg11eaPlacement) {
          reasons.push(`hold ${buildingProduction.t} for east coast link`);
        } else {
          const scg11eaLandChainPlacement =
            this.scenario === 'SCG11EA' &&
            (
              scg11eaBootstrapCandidates.length > 0 ||
              scg11eaPowerChainCandidates.length > 0 ||
              scg11eaShoreDefenseCandidates.length > 0
            );
          const scg11eaPlacementCells = scg11eaLandChainPlacement
            ? this.getPlacementCells(buildingProduction.t, placeCx, placeCy)
            : [];
          const scg11eaPlacementCellSet = new Set(
            scg11eaPlacementCells.map((cell) => `${cell.cx},${cell.cy}`),
          );
          const scg11eaPlacementBlockers = scg11eaLandChainPlacement
            ? playerUnits.filter((u) =>
              !NAVAL_COMBAT_TYPES.has(u.t) &&
              !AIRCRAFT_TYPES.has(u.t) &&
              scg11eaPlacementCellSet.has(`${u.cx},${u.cy}`))
            : [];

          if (scg11eaPlacementBlockers.length > 0) {
            const clearTarget = scg11eaPowerChainCandidates.length > 0
              ? { cx: Math.max(0, placeCx - 8), cy: Math.min(127, placeCy + 10) }
              : scg11eaBootstrapCandidates.length > 0
              ? { cx: Math.max(0, placeCx - 6), cy: Math.min(127, placeCy + 6) }
              : { cx: 50, cy: 88 };
            const movers = scg11eaPlacementBlockers;
            if (movers.length > 0) {
              commands.push({
                cmd: 'move',
                ids: movers.map((u) => u.id),
                cx: clearTarget.cx,
                cy: clearTarget.cy,
              });
              for (const unit of movers) this.recordMove(unit.id, clearTarget.cx, clearTarget.cy);
            }
            reasons.push(`clear ${buildingProduction.t} footprint (${scg11eaPlacementBlockers.length})`);
          } else {
            commands.push({
              cmd: 'place',
              rtti: RTTI_BUILDINGTYPE,
              cx: placeCx,
              cy: placeCy,
            });
            // Cycle through placement offsets on repeated attempts
            if (state.tick - this.lastPlacementTick > sec(4)) {
              this.placementAttempts++;
              this.lastPlacementTick = state.tick;
            }
            reasons.push(`place ${buildingProduction.t} at (${placeCx},${placeCy})`);
          }
        }
      }
    } else if ((!buildingProduction || suppressScg11eaLeftoverBuild) && buildable) {
      // Nothing building — find next item in build order
      // Don't reset placementAttempts — keep advancing through offsets
      // so successive buildings don't land on the same cell

      const shipyardExists = existingShipyard;
      const scg11eaShipyardReady =
        this.scenario === 'SCG11EA' && this.scg11eaShipyardReady(state, alliedStructures);
      const scg11eaBootstrapReady =
        this.scenario === 'SCG11EA' && this.scg11eaBootstrapReady(alliedStructures);
      const scg11eaCoastChainCritical =
        this.scenario === 'SCG11EA' &&
        this.scg11eaMustReopenCoast(state, alliedStructures, playerUnits);
      const scg11eaExistingFleet =
        this.scenario === 'SCG11EA'
          ? playerUnits.filter((u) => NAVAL_COMBAT_TYPES.has(u.t)).length
          : 0;
      const scg11eaProcCount =
        this.scenario === 'SCG11EA'
          ? alliedStructures.filter((s) => s.t === 'PROC').length
          : 0;
      const scg11eaDesiredShips =
        this.scenario === 'SCG11EA'
          ? this.scg11eaDesiredShipCount(scg11eaEnemySubCount)
          : 0;
      const scg11eaFleetShort =
        this.scenario === 'SCG11EA' &&
        scg11eaExistingFleet < scg11eaDesiredShips;
      if (this.scenario === 'SCG11EA' && shipyardExists) {
        this.scg11eaNavalUnlocked = true;
      }

      if (
        this.scenario === 'SCG11EA' &&
        !shipyardExists &&
        scg11eaBootstrapReady &&
        scg11eaCoastChainCritical &&
        !scg11eaShipyardReady &&
        (buildable.structures.includes('POWR') || buildable.structures.includes('APWR'))
      ) {
        commands.push({
          cmd: 'produce',
          rtti: RTTI_BUILDINGTYPE,
          type_id: buildable.structures.includes('POWR') ? 17 : 18,
        });
        reasons.push('extend east coast chain');
      } else if (
        this.scenario === 'SCG11EA' &&
        this.scg11eaNavalUnlocked &&
        !shipyardExists &&
        scg11eaEnemySubCount > 0 &&
        scg11eaFleetShort &&
        scg11eaProcCount >= (scg11eaExistingFleet > 0 ? 1 : 2) &&
        scg11eaShipyardReady &&
        (scg11eaExistingFleet === 0 || state.credits >= SCG11EA_DEFENSE_CREDIT_RESERVE) &&
        (buildable.structures.includes('SYRD') || buildable.structures.includes('SPEN'))
      ) {
        const shipyardTypeId = buildable.structures.includes('SYRD') ? 27 : 28;
        commands.push({
          cmd: 'produce',
          rtti: RTTI_BUILDINGTYPE,
          type_id: shipyardTypeId,
        });
        reasons.push(`rebuild ${shipyardTypeId === 27 ? 'SYRD' : 'SPEN'} for sub hunt`);
      } else if (this.scenario === 'SCG11EA' && shipyardExists) {
        const powerDeficit = state.power.consumed - state.power.produced;
        const aaCount = alliedStructures.filter((s) => s.t === 'AGUN').length;
        const barracksCount = alliedStructures.filter((s) => s.t === 'BARR' || s.t === 'TENT').length;
        const domeCount = alliedStructures.filter((s) => s.t === 'DOME').length;
        const gunCount = alliedStructures.filter(
          (s) => s.t === 'GUN' || s.t === 'FTUR',
        ).length;
        const procCount = alliedStructures.filter((s) => s.t === 'PROC').length;
        const weapCount = alliedStructures.filter((s) => s.t === 'WEAP').length;
        const shipCount = playerUnits.filter((u) => NAVAL_COMBAT_TYPES.has(u.t)).length;
        const survivingTanks = playerUnits.filter((u) => u.t.includes('TNK')).length;
        const scg11eaSubHuntLive = scg11eaEnemySubCount > 0;
        const scg11eaEconomyCollapsed = procCount === 0;
        const scg11eaEconomyFragile = procCount < 2;
        const scg11eaPowerRebuildDeferred =
          scg11eaSubHuntLive &&
          scg11eaFleetShort &&
          state.power.produced > 0 &&
          powerDeficit > 0 &&
          powerDeficit < SCG11EA_POWER_REBUILD_EMERGENCY_DEFICIT;
        const scg11eaProcRebuildDeferred =
          scg11eaSubHuntLive &&
          !scg11eaEconomyCollapsed &&
          scg11eaEconomyFragile &&
          (
            shipCount > 0 ||
            scg11eaGroundThreatCount >= SCG11EA_GROUND_DEFENSE_TRIGGER ||
            scg11eaLocalAirThreatCount >= SCG11EA_AA_DEFENSE_TRIGGER
          ) &&
          (
            scg11eaEnemySubCount > SCG11EA_STATIC_DEFENSE_MAX_SUBS ||
            scg11eaGroundThreatCount >= SCG11EA_GROUND_DEFENSE_TRIGGER ||
            scg11eaLocalAirThreatCount >= SCG11EA_AA_DEFENSE_TRIGGER
          );
        const scg11eaPressureDefenseUnlock =
          scg11eaSubHuntLive &&
          procCount >= 1 &&
          shipCount >= 1 &&
          survivingTanks >= SCG11EA_SUB_HUNT_TANK_FLOOR &&
          (
            scg11eaGroundThreatCount >= SCG11EA_GROUND_DEFENSE_TRIGGER + 1 ||
            scg11eaLocalAirThreatCount >= 1 ||
            scg11eaEnemyAirCount > 0 ||
            (!scg11eaFleetShort &&
              scg11eaGroundThreatCount >= SCG11EA_GROUND_DEFENSE_TRIGGER)
          );
        const scg11eaStaticDefenseUnlocked =
          (
            !scg11eaFleetShort &&
            shipCount >= SCG11EA_STATIC_DEFENSE_MIN_SHIPS &&
            scg11eaEnemySubCount <= SCG11EA_STATIC_DEFENSE_MAX_SUBS &&
            procCount >= 2
          ) ||
          scg11eaPressureDefenseUnlock;
        const scg11eaDesiredAA =
          scg11eaEnemySubCount > SCG11EA_STATIC_DEFENSE_MAX_SUBS ? 1 : SCG11EA_AA_DEFENSE_TARGET;
        const scg11eaDesiredGroundDefense =
          scg11eaEnemySubCount > SCG11EA_STATIC_DEFENSE_MAX_SUBS ? 1 : SCG11EA_GROUND_DEFENSE_TARGET;
        const scg11eaGroundDefenseTechReady =
          scg11eaStaticDefenseUnlocked &&
          scg11eaGroundThreatCount >= SCG11EA_GROUND_DEFENSE_TRIGGER &&
          barracksCount === 0 &&
          (buildable.structures.includes('BARR') || buildable.structures.includes('TENT')) &&
          state.credits >= 500;
        const scg11eaGroundDefenseReady =
          scg11eaStaticDefenseUnlocked &&
          scg11eaGroundThreatCount >= SCG11EA_GROUND_DEFENSE_TRIGGER &&
          barracksCount > 0 &&
          gunCount < scg11eaDesiredGroundDefense &&
          state.credits >= SCG11EA_DEFENSE_CREDIT_RESERVE &&
          (buildable.structures.includes('FTUR') || buildable.structures.includes('GUN'));
        const scg11eaAAReady =
          scg11eaStaticDefenseUnlocked &&
          (scg11eaLocalAirThreatCount >= 1 || scg11eaEnemyAirCount > 0) &&
          aaCount < scg11eaDesiredAA &&
          buildable.structures.includes('AGUN') &&
          state.credits >= SCG11EA_DEFENSE_CREDIT_RESERVE;
        const scg11eaAATechReady =
          scg11eaStaticDefenseUnlocked &&
          (scg11eaLocalAirThreatCount >= 1 || scg11eaEnemyAirCount > 0) &&
          domeCount === 0 &&
          buildable.structures.includes('DOME') &&
          state.credits >= SCG11EA_DEFENSE_CREDIT_RESERVE;
        if (
          scg11eaEconomyCollapsed &&
          buildable.structures.includes('PROC')
        ) {
          if (
            !scg11eaSubHuntLive ||
            shipCount === 0 ||
            state.credits >= SCG11EA_PROC_REBUILD_RESERVE ||
            state.credits < SCG11EA_ECON_REBUILD_FLOOR
          ) {
            commands.push({
              cmd: 'produce',
              rtti: RTTI_BUILDINGTYPE,
              type_id: 12,
            });
            reasons.push('rebuild PROC');
          } else {
            reasons.push(`save for PROC rebuild (${state.credits}/${SCG11EA_PROC_REBUILD_RESERVE})`);
          }
        } else if (powerDeficit > 0 && scg11eaPowerRebuildDeferred) {
          reasons.push(`defer APWR for fleet (${state.power.produced}/${state.power.consumed}, ${shipCount}/${scg11eaDesiredShips} DD)`);
        } else if (powerDeficit > 0 && buildable.structures.includes('APWR')) {
          commands.push({
            cmd: 'produce',
            rtti: RTTI_BUILDINGTYPE,
            type_id: 18,
          });
          reasons.push(`produce APWR (power ${state.power.produced}/${state.power.consumed})`);
        } else if (powerDeficit > 0 && buildable.structures.includes('POWR')) {
          commands.push({
            cmd: 'produce',
            rtti: RTTI_BUILDINGTYPE,
            type_id: 17,
          });
          reasons.push('produce POWR (power deficit)');
        } else if (
          scg11eaGroundDefenseReady
        ) {
          const defenseType = buildable.structures.includes('FTUR') ? 'FTUR' : 'GUN';
          commands.push({
            cmd: 'produce',
            rtti: RTTI_BUILDINGTYPE,
            type_id: defenseType === 'FTUR' ? 10 : 8,
          });
          reasons.push(`produce ${defenseType} (${gunCount + 1}/${scg11eaDesiredGroundDefense}, threats=${scg11eaGroundThreatCount})`);
        } else if (
          scg11eaAAReady
        ) {
          commands.push({
            cmd: 'produce',
            rtti: RTTI_BUILDINGTYPE,
            type_id: 9,
          });
          reasons.push(`produce AGUN (${aaCount + 1}/${scg11eaDesiredAA}, air=${scg11eaLocalAirThreatCount})`);
        } else if (
          scg11eaAATechReady
        ) {
          commands.push({
            cmd: 'produce',
            rtti: RTTI_BUILDINGTYPE,
            type_id: 6,
          });
          reasons.push(`produce DOME for AA (air=${scg11eaLocalAirThreatCount})`);
        } else if (
          scg11eaGroundDefenseTechReady
        ) {
          const barracksType = buildable.structures.includes('BARR') ? 'BARR' : 'TENT';
          commands.push({
            cmd: 'produce',
            rtti: RTTI_BUILDINGTYPE,
            type_id: barracksType === 'BARR' ? 21 : 22,
          });
          reasons.push(`produce ${barracksType} for pillboxes`);
        } else if (
          scg11eaSubHuntLive &&
          scg11eaEconomyFragile &&
          buildable.structures.includes('PROC')
        ) {
          if (scg11eaProcRebuildDeferred) {
            reasons.push(`defer PROC for fleet (${shipCount}/${scg11eaDesiredShips} DD, ${procCount}/2 PROC)`);
          } else if (state.credits >= SCG11EA_PROC_REBUILD_RESERVE) {
            commands.push({
              cmd: 'produce',
              rtti: RTTI_BUILDINGTYPE,
              type_id: 12,
            });
            reasons.push(`restore naval economy (${procCount + 1}/2 PROC)`);
          } else {
            reasons.push(`save for PROC rebuild (${state.credits}/${SCG11EA_PROC_REBUILD_RESERVE})`);
          }
        } else if (
          scg11eaSubHuntLive &&
          weapCount === 0 &&
          shipCount === 0 &&
          survivingTanks < SCG11EA_SUB_HUNT_EMERGENCY_TANK_FLOOR &&
          scg11eaGroundThreatCount >= SCG11EA_GROUND_DEFENSE_TRIGGER &&
          buildable.structures.includes('WEAP')
        ) {
          commands.push({
            cmd: 'produce',
            rtti: RTTI_BUILDINGTYPE,
            type_id: 2,
          });
          reasons.push(`emergency rebuild WEAP (${survivingTanks} tanks, ships=${shipCount}, threats=${scg11eaGroundThreatCount})`);
        } else if (
          !scg11eaSubHuntLive &&
          weapCount === 0 &&
          buildable.structures.includes('WEAP')
        ) {
          commands.push({
            cmd: 'produce',
            rtti: RTTI_BUILDINGTYPE,
            type_id: 2,
          });
          reasons.push('rebuild WEAP');
        } else if (
          !scg11eaSubHuntLive &&
          procCount < 2 &&
          buildable.structures.includes('PROC') &&
          state.credits >= 2000 &&
          survivingTanks < SCG11EA_PRE_NAVAL_TANK_TARGET
        ) {
          commands.push({
            cmd: 'produce',
            rtti: RTTI_BUILDINGTYPE,
            type_id: 12,
          });
          reasons.push(`restore economy (${procCount + 1}/2 PROC)`);
        } else if (
          !scg11eaSubHuntLive &&
          weapCount < 2 &&
          buildable.structures.includes('WEAP') &&
          state.credits >= 2000 &&
          survivingTanks < SCG11EA_PRE_NAVAL_TANK_TARGET
        ) {
          commands.push({
            cmd: 'produce',
            rtti: RTTI_BUILDINGTYPE,
            type_id: 2,
          });
          reasons.push(`restore armor (${weapCount + 1}/2 WEAP)`);
        }
      } else {
      // Keep power healthy — only build power when actually in deficit,
      // or when consumption is high and surplus is thin (<100 buffer).
      // Don't waste credits on power when we barely consume any.
      const powerDeficit = state.power.consumed - state.power.produced;
      const needMorePower = powerDeficit > 0 ||
        (state.power.consumed >= 200 && powerDeficit > -100);
      if (needMorePower && buildable.structures.includes('APWR')) {
        // Prefer APWR (200 power) over POWR (100 power) when available
        commands.push({
          cmd: 'produce',
          rtti: RTTI_BUILDINGTYPE,
          type_id: 18, // STRUCT_ADVANCED_POWER
        });
        reasons.push(`produce APWR (power ${state.power.produced}/${state.power.consumed})`);
      } else if (needMorePower && buildable.structures.includes('POWR')) {
        commands.push({
          cmd: 'produce',
          rtti: RTTI_BUILDINGTYPE,
          type_id: 17, // STRUCT_POWER
        });
        reasons.push('produce POWR (power deficit)');
      } else {
        // Find next building in build order we don't have yet.
        // Always scan from the start — buildings can be destroyed and
        // need rebuilding. Skip ones that currently exist on the map.
        let ordered = false;
        const buildOrder = this.getBuildOrder();
        for (let i = 0; i < buildOrder.length; i++) {
          const entry = buildOrder[i];
          // Check if we already have enough of this building type
          const maxCount = entry.maxCount ?? 1;
          const existingCount = entry.names.reduce(
            (count, n) => count + alliedStructures.filter((s) => s.t === n).length, 0,
          );
          if (existingCount >= maxCount) {
            continue;
          }
          const isScg11eaShipyardGate =
            this.scenario === 'SCG11EA' &&
            (entry.names.includes('SYRD') || entry.names.includes('SPEN'));
          // Find the first buildable alternative from the C++ Can_Build list
          // Note: the C++ Can_Build may return cross-faction buildings (known bug)
          // but the game accepts them, so trust the buildable list
          const buildableIdx = entry.names.findIndex((n) =>
            buildable.structures.includes(n),
          );
          if (buildableIdx >= 0) {
            if (isScg11eaShipyardGate && !scg11eaShipyardReady) {
              reasons.push('hold for east scout');
              ordered = true;
              break;
            }
            commands.push({
              cmd: 'produce',
              rtti: RTTI_BUILDINGTYPE,
              type_id: entry.type_ids[buildableIdx],
            });
            reasons.push(`produce ${entry.names[buildableIdx]}`);
            ordered = true;
            break;
          } else {
            if (isScg11eaShipyardGate) {
              reasons.push(scg11eaShipyardReady ? 'hold for shipyard' : 'hold for east scout');
              ordered = true;
              break;
            }
            // Can't build any alternative yet — prerequisites not met, try next entry
            continue;
          }
        }
        // If build order complete and we have credits, build extra power or defenses
        if (!ordered && this.baseBuildIndex >= buildOrder.length) {
          if (state.power.consumed >= state.power.produced && buildable.structures.includes('POWR')) {
            commands.push({
              cmd: 'produce',
              rtti: RTTI_BUILDINGTYPE,
              type_id: 17, // STRUCT_POWER
            });
            reasons.push('produce POWR (expansion)');
          }
        }
      }
      }
    }

    // --- Phase 3: PRODUCE UNITS ---
    const hasWarFactory = alliedStructures.some((s) => s.t === 'WEAP');
    const hasBarracks = alliedStructures.some(
      (s) => s.t === 'TENT' || s.t === 'BARR',
    );

    // --- Unit production priority: tanks > infantry, save money for structures ---
    const unitProduction = state.production.find(
      (p) => p.rtti === RTTI_UNITTYPE,
    );
    const infantryProduction = state.production.find(
      (p) => p.rtti === RTTI_INFANTRYTYPE,
    );
    const hasShipyard = existingShipyard;
    const vesselProduction = state.production.find(
      (p) => p.rtti === RTTI_VESSELTYPE,
    );

    // Check if we're still saving for a building (don't drain credits).
    const coreProductionReady = hasWarFactory;
    const savingForBuilding = (buildingProduction != null && !suppressScg11eaLeftoverBuild) ||
      (this.baseBuildIndex < this.getBuildOrder().length && !coreProductionReady);
    const minCreditsForInfantry = savingForBuilding ? 1500 : 300;

    // Produce units from War Factory — priority: harvesters > tanks
    // Aim for at least 2 harvesters, or 1 per refinery, whichever is more
    const tankCount = playerUnits.filter((u) => u.t.includes('TNK')).length;
    const harvCount = playerUnits.filter((u) => u.t === 'HARV').length;
    const navalCount = playerUnits.filter((u) => NAVAL_COMBAT_TYPES.has(u.t)).length;
    const refCount = alliedStructures.filter((s) => s.t === 'PROC').length;
    const aaCount = alliedStructures.filter((s) => s.t === 'AGUN').length;
    const barracksCount = alliedStructures.filter((s) => s.t === 'BARR' || s.t === 'TENT').length;
    const domeCount = alliedStructures.filter((s) => s.t === 'DOME').length;
    const gunCount = alliedStructures.filter((s) => s.t === 'GUN' || s.t === 'FTUR').length;
    const targetHarvesters = Math.max(2, refCount);
    const needHarvester = harvCount < targetHarvesters && buildable?.units.includes('HARV');

    // SCG11EA: hold a bigger tank floor before switching to destroyers.
    const scg11eaSubHuntPhase =
      this.scenario === 'SCG11EA' &&
      scg11eaEnemySubCount > 0 &&
      (hasShipyard || vesselProduction != null || navalCount > 0);
    const scg11eaNavalEconomyFragile =
      this.scenario === 'SCG11EA' &&
      scg11eaSubHuntPhase &&
      refCount === 0 &&
      buildable?.structures.includes('PROC') === true;
    const scg11eaFleetOnline =
      this.scenario === 'SCG11EA' &&
      navalCount >= SCG11EA_FLEET_ONLINE_SHIPS;
    const scg11eaDesiredShips =
      this.scenario === 'SCG11EA'
        ? this.scg11eaDesiredShipCount(scg11eaEnemySubCount)
        : 0;
    const scg11eaFleetShort =
      this.scenario === 'SCG11EA' &&
      navalCount < scg11eaDesiredShips;
    const scg11eaShipyardInProgress =
      this.scenario === 'SCG11EA' &&
      buildingProduction != null &&
      (buildingProduction.t === 'SYRD' || buildingProduction.t === 'SPEN') &&
      !buildingProduction.done;
    const scg11eaArmorEmergency =
      this.scenario === 'SCG11EA' &&
      scg11eaSubHuntPhase &&
      ((tankCount <= 1 && scg11eaGroundThreatCount >= 1) ||
        (tankCount <= 2 && scg11eaGroundThreatCount >= SCG11EA_GROUND_DEFENSE_TRIGGER + 1) ||
        (tankCount <= 3 && scg11eaGroundThreatCount >= SCG11EA_GROUND_DEFENSE_TRIGGER + 3));
    const scg11eaRiverOpen =
      this.scenario === 'SCG11EA' &&
      navalCount >= SCG11EA_FLEET_ONLINE_SHIPS &&
      scg11eaEnemySubCount <= SCG11EA_POST_NAVAL_SUB_THRESHOLD;
    const scg11eaTankTarget =
      this.scenario === 'SCG11EA'
        ? (!scg11eaSubHuntPhase
          ? SCG11EA_PRE_NAVAL_TANK_TARGET
          : scg11eaRiverOpen
          ? SCG11EA_POST_NAVAL_TANK_TARGET
          : (scg11eaEnemySubCount >= 7 ||
            scg11eaGroundThreatCount >= SCG11EA_GROUND_DEFENSE_TRIGGER ||
            scg11eaLocalAirThreatCount >= SCG11EA_AA_DEFENSE_TRIGGER)
          ? SCG11EA_SUB_HUNT_TANK_FLOOR
          : SCG11EA_LATE_SUB_HUNT_TANK_FLOOR)
        : 0;
    const scg11eaFleetPriority =
      this.scenario === 'SCG11EA' &&
      scg11eaSubHuntPhase &&
      scg11eaFleetShort &&
      tankCount >= scg11eaTankTarget;
    const scg11eaVesselPriority =
      this.scenario === 'SCG11EA' &&
      scg11eaSubHuntPhase &&
      scg11eaEnemySubCount > SCG11EA_STATIC_DEFENSE_MAX_SUBS &&
      navalCount > 0 &&
      tankCount >= SCG11EA_SUB_HUNT_EMERGENCY_TANK_FLOOR;
    const scg11eaFleetRecoveryHold =
      this.scenario === 'SCG11EA' &&
      scg11eaSubHuntPhase &&
      scg11eaEnemySubCount > SCG11EA_STATIC_DEFENSE_MAX_SUBS &&
      navalCount >= Math.max(2, SCG11EA_HUNT_MIN_SHIPS - 1) &&
      tankCount >= SCG11EA_GROUND_DEFENSE_TRIGGER &&
      scg11eaGroundThreatCount <= SCG11EA_GROUND_DEFENSE_TRIGGER + 1;
    const scg11eaShipyardPriority =
      this.scenario === 'SCG11EA' &&
      scg11eaShipyardInProgress &&
      tankCount >= SCG11EA_SHIPYARD_TANK_FLOOR;
    const skipTankProduction = this.scenario === 'SCG11EA'
      ? ((tankCount >= scg11eaTankTarget && !scg11eaArmorEmergency) ||
        (scg11eaVesselPriority && !scg11eaArmorEmergency) ||
        (scg11eaFleetRecoveryHold && !scg11eaArmorEmergency) ||
        (scg11eaNavalEconomyFragile && !scg11eaArmorEmergency) ||
        (scg11eaShipyardPriority && !scg11eaArmorEmergency) ||
        (scg11eaFleetPriority && !scg11eaArmorEmergency))
      : false;
    if (hasWarFactory && !unitProduction && buildable && !skipTankProduction) {
      if (needHarvester && (harvCount === 0 || state.credits > 1200)) {
        // Build harvesters — emergency if 0, proactive otherwise
        const harvTypeId = this.unitNameToTypeId('HARV');
        if (harvTypeId >= 0) {
          commands.push({
            cmd: 'produce',
            rtti: RTTI_UNITTYPE,
            type_id: harvTypeId,
          });
          reasons.push(`produce HARV (${harvCount}/${targetHarvesters})`);
        }
      } else if (!needHarvester || state.credits > 600) {
        // Tank production — SCG11EA spends harder on armor until the fleet is ready.
        const tankCreditThreshold = this.scenario === 'SCG11EA'
          ? Math.max(
            scg11eaNavalEconomyFragile && !scg11eaArmorEmergency
              ? SCG11EA_PROC_REBUILD_RESERVE
              : scg11eaSubHuntPhase
              ? SCG11EA_DEFENSE_CREDIT_RESERVE
              : tankCount < scg11eaTankTarget ? 500 : 900,
            scg11eaShipyardInProgress && !scg11eaArmorEmergency && tankCount >= SCG11EA_POST_NAVAL_TANK_TARGET
              ? SCG11EA_PROC_REBUILD_RESERVE
              : 0,
          )
          : (tankCount < 3 ? 400 : 700);
        if (state.credits > tankCreditThreshold) {
          const tank = TANK_PREFERENCE.find((t) => buildable.units.includes(t));
          if (tank) {
            const unitTypeId = this.unitNameToTypeId(tank);
            if (unitTypeId >= 0) {
              commands.push({
                cmd: 'produce',
                rtti: RTTI_UNITTYPE,
                type_id: unitTypeId,
              });
              reasons.push(`produce ${tank}`);
            }
          }
        }
      }
    }
    // Place/exit completed units
    if (unitProduction?.done) {
      commands.push({
        cmd: 'place',
        rtti: RTTI_UNITTYPE,
      });
      reasons.push(`exit ${unitProduction.t}`);
    }

    // Produce infantry only if we have spare credits (don't starve tank/building production)
    if (hasBarracks && !infantryProduction && buildable && state.credits > minCreditsForInfantry) {
      const inf = INFANTRY_PREFERENCE.find((i) => buildable.infantry.includes(i));
      if (inf) {
        const infTypeId = this.infantryNameToTypeId(inf);
        if (infTypeId >= 0) {
          commands.push({
            cmd: 'produce',
            rtti: RTTI_INFANTRYTYPE,
            type_id: infTypeId,
          });
          reasons.push(`produce ${inf}`);
        }
      }
    }
    if (infantryProduction?.done) {
      commands.push({
        cmd: 'place',
        rtti: RTTI_INFANTRYTYPE,
      });
      reasons.push(`exit ${infantryProduction.t}`);
    }

    // Produce ships from Shipyard/Sub Pen (if available and enemies have naval units)
    const enemyNaval = state.enemies.some(
      (e) => e.t === 'SS' || e.t === 'DD' || e.t === 'CA' || e.t === 'PT' || e.t === 'LST',
    );
    const scg11eaBasePressure =
      this.scenario === 'SCG11EA' &&
      (scg11eaGroundThreatCount >= SCG11EA_GROUND_DEFENSE_TRIGGER ||
        scg11eaLocalAirThreatCount >= SCG11EA_AA_DEFENSE_TRIGGER ||
        tankCount < (scg11eaSubHuntPhase ? scg11eaTankTarget : SCG11EA_ASSAULT_MIN_ARMOR));
    const scg11eaDesiredAA =
      this.scenario === 'SCG11EA' &&
      scg11eaEnemySubCount > SCG11EA_STATIC_DEFENSE_MAX_SUBS
        ? 1
        : SCG11EA_AA_DEFENSE_TARGET;
    const scg11eaDesiredGroundDefense =
      this.scenario === 'SCG11EA' &&
      scg11eaEnemySubCount > SCG11EA_STATIC_DEFENSE_MAX_SUBS
        ? 1
        : SCG11EA_GROUND_DEFENSE_TARGET;
    const scg11eaFirstWaveDefenseLock =
      this.scenario === 'SCG11EA' &&
      scg11eaSubHuntPhase &&
      navalCount > 0 &&
      (
        domeCount === 0 ||
        aaCount < scg11eaDesiredAA ||
        (
          scg11eaGroundThreatCount >= SCG11EA_GROUND_DEFENSE_TRIGGER &&
          (barracksCount === 0 || gunCount < scg11eaDesiredGroundDefense)
        )
      );
    const scg11eaDefenseStructureGap =
      this.scenario === 'SCG11EA' &&
      scg11eaSubHuntPhase &&
      (
        scg11eaFirstWaveDefenseLock ||
        navalCount > 0
      ) &&
      (
        (
          scg11eaLocalAirThreatCount >= SCG11EA_AA_DEFENSE_TRIGGER &&
          (domeCount === 0 || aaCount < scg11eaDesiredAA)
        ) ||
        (
          scg11eaEnemyAirCount > 0 &&
          (domeCount === 0 || aaCount < scg11eaDesiredAA)
        ) ||
        (
          scg11eaGroundThreatCount >= SCG11EA_GROUND_DEFENSE_TRIGGER &&
          (barracksCount === 0 || gunCount < scg11eaDesiredGroundDefense)
        )
      );
    // SCG11EA: always produce ships (we know subs are there), lower credit threshold
    const shipCreditThreshold = this.scenario === 'SCG11EA'
      ? (scg11eaNavalEconomyFragile
        ? SCG11EA_PROC_REBUILD_RESERVE
        : scg11eaSubHuntPhase
          ? scg11eaFleetShort
            ? (navalCount <= 1
              ? SCG11EA_CRITICAL_FLEET_SHIP_CREDIT
              : SCG11EA_FLEET_RECOVERY_SHIP_CREDIT)
            : (scg11eaBasePressure ? SCG11EA_DEFENSE_CREDIT_RESERVE : 250)
          : 400)
      : 800;
    // SCG11EA: don't produce ships until we have enough tanks for the assault.
    // Ground-first — spending credits on DD starves tank production.
    const scg11eaGroundFirst = this.scenario === 'SCG11EA' && tankCount < 8;
    const shouldProduceShips = scg11eaGroundFirst ? false
      : this.scenario === 'SCG11EA' ? (scg11eaFleetShort && !scg11eaDefenseStructureGap)
      : enemyNaval;
    if (
      hasShipyard &&
      !vesselProduction &&
      buildable &&
      shouldProduceShips &&
      !scg11eaNavalEconomyFragile &&
      state.credits > shipCreditThreshold &&
      (!buildingProduction || suppressScg11eaLeftoverBuild)
    ) {
      const shipPreference = this.scenario === 'SCG11EA'
        ? ['DD', 'CA', 'PT', 'SS']
        : SHIP_PREFERENCE;
      const ship = shipPreference.find((s) => buildable.vessels?.includes(s));
      if (ship) {
        const shipTypeId = this.vesselNameToTypeId(ship);
        if (shipTypeId >= 0) {
          commands.push({
            cmd: 'produce',
            rtti: RTTI_VESSELTYPE,
            type_id: shipTypeId,
          });
          reasons.push(`produce ${ship}`);
        }
      }
    }
    if (vesselProduction?.done) {
      commands.push({ cmd: 'place', rtti: RTTI_VESSELTYPE });
      reasons.push(`launch ${vesselProduction.t}`);
    }

    // --- Phase 3.4: WATER SCOUTING FOR SYRD ---
    // Send a tank toward water ASAP to map cells for shipyard placement.
    // Start as soon as enemy vessels are detected and we have combat units.
    const hasNavalEnemies = state.enemies.some(
      (e) => e.t === 'SS' || e.t === 'DD' || e.t === 'CA' || e.t === 'PT' || e.t === 'MSUB',
    );
    // Reset scout if destroyed
    if (this.waterScoutId >= 0 && !playerUnits.some((u) => u.id === this.waterScoutId)) {
      this.waterScoutId = -1;
    }
    if (hasNavalEnemies && this.waterScoutId < 0 && this.scenario !== 'SCG11EA') {
      // Find enemy vessels to determine water direction (skip SCG11EA — hardcoded coast)
      const waterVessels = state.enemies.filter(
        (e) => e.t === 'SS' || e.t === 'DD' || e.t === 'CA' || e.t === 'PT' || e.t === 'MSUB',
      );
      if (waterVessels.length > 0) {
        // Find nearest vessel to base
        const base = conYard;
        let nearest = waterVessels[0];
        let bestDist = Infinity;
        for (const v of waterVessels) {
          const d = (v.cx - base.cx) ** 2 + (v.cy - base.cy) ** 2;
          if (d < bestDist) { bestDist = d; nearest = v; }
        }
        // Scout target: 70% of way from base to nearest vessel (near shore)
        this.waterScoutTarget = {
          cx: Math.round(base.cx + (nearest.cx - base.cx) * 0.7),
          cy: Math.round(base.cy + (nearest.cy - base.cy) * 0.7),
        };
        // Find an idle tank to send as scout
        const tanks = playerUnits.filter(
          (u) => (u.t === '2TNK' || u.t === '1TNK' || u.t === '3TNK') &&
            (u.m === MISSION_GUARD || u.m === MISSION_GUARD_AREA),
        );
        if (tanks.length > 0) {
          this.waterScoutId = tanks[0].id;
          commands.push({
            cmd: 'move',
            ids: [this.waterScoutId],
            cx: this.waterScoutTarget.cx,
            cy: this.waterScoutTarget.cy,
          });
          reasons.push(`scout water at (${this.waterScoutTarget.cx},${this.waterScoutTarget.cy})`);
        }
      }
    }

    // --- Phase 3.5: TRANSPORT LOADING ---
    // Load idle infantry into nearby transports (ferrying reinforcements to islands, etc.)
    this.handleTransports(state, commands, reasons);

    // --- Phase 3.6: MINELAYER DEFENSE ---
    this.dispatchMinelayers(playerUnits, conYard, commands, reasons);

    // --- Phase 3.75: M8 INTERCEPTION (mission-specific) ---
    // SCG08EA: Enemy base is ~(65,60), ATEK at (58,95), PDOX at (58,102).
    // Enemies sneak south to destroy critical buildings. We need an
    // interception line at y≈80 between enemy base and critical structures.
    // Station 40% of combat force on the intercept line, engage anything
    // heading south. The rest defends the main base normally.
    if (this.scenario === 'SCG08EA') {
      const interceptLine: Point = { cx: 58, cy: 80 }; // between enemy base and ATEK
      const interceptRadius = 400; // 20 cells
      const allCombat = playerUnits.filter(
        (u) => this.isCombatUnit(u) && !BASE_NON_COMBAT_TYPES.has(u.t) && u.hp > 0,
      );
      // Enemies heading toward critical structures (south of y=70)
      const southernThreats = state.enemies.filter(
        (e) => e.cy > 70 || this.distanceSq(e, interceptLine) <= interceptRadius,
      );
      // Station interceptors
      const interceptorCount = Math.max(4, Math.floor(allCombat.length * 0.4));
      const nearIntercept = allCombat.filter(
        (u) => this.distanceSq(u, interceptLine) <= interceptRadius,
      );

      if (southernThreats.length > 0 && nearIntercept.length > 0) {
        // Engage threats heading south
        const micro = this.microManage(nearIntercept, southernThreats, interceptLine);
        commands.push(...micro.commands);
        reasons.push(`intercept ${southernThreats.length} south (${nearIntercept.length} defenders)`);
        reasons.push(...micro.reasons);
      }

      // Send more units to intercept line if under-manned (only idle ones)
      if (nearIntercept.length < interceptorCount) {
        const reinforcements = allCombat
          .filter((u) => this.distanceSq(u, interceptLine) > interceptRadius && this.isIdle(u))
          .slice(0, interceptorCount - nearIntercept.length);
        if (reinforcements.length > 0) {
          commands.push({
            cmd: 'move',
            ids: reinforcements.map((u) => u.id),
            cx: interceptLine.cx,
            cy: interceptLine.cy,
          });
          reasons.push(`reinforce intercept (${reinforcements.length})`);
        }
      }
    }

    // --- Phase 4: COMBAT (defend-first, attack with surplus) ---
    // SCG11EA: skip base defense when assault is active — decideScg11ea handles tanks.
    // This prevents tanks oscillating between defend-base and assault-north.
    if (this.scenario === 'SCG11EA' && this.scg11eaAssaultStarted) {
      return { commands: this.dedupeCommands(commands), reason: reasons.join('; ') || 'base building — assault active' };
    }
    const combatUnits = playerUnits.filter(
      (u) => this.isCombatUnit(u) && !BASE_NON_COMBAT_TYPES.has(u.t) &&
        !(this.scenario === 'SCG11EA' && NAVAL_COMBAT_TYPES.has(u.t)) &&
        !this.isReservedScg11eaScout(u, alliedStructures),
    );
    const scg11eaNavalPhase = this.scenario === 'SCG11EA' && this.scg11eaNavalPhaseStarted(alliedStructures);
    const scg11eaHoldIsland =
      this.scenario === 'SCG11EA' &&
      (!scg11eaNavalPhase || scg11eaEnemySubCount > 0);
    const defenseOnlyMission =
      OracleStrategy.DEFENSE_ONLY_MISSIONS.has(this.scenario) ||
      scg11eaHoldIsland;

    // Base center = centroid of all allied structures (not just ConYard)
    const baseCenter = alliedStructures.length > 0
      ? this.centroid(alliedStructures as unknown as RAEntity[])
      : { cx: conYard.cx, cy: conYard.cy };

    // Base threats — enemies near ANY allied structure (20 cell radius)
    const baseThreats = state.enemies.filter(
      (e) =>
        !(this.scenario === 'SCG11EA' && NAVAL_COMBAT_TYPES.has(e.t)) &&
        alliedStructures.some((s) => this.distanceSq(e, s) <= 400),
    );

    // Retreat only matters if units can heal (medics present).
    // Without healing, injured units should fight to the death.
    const hasMedics = playerUnits.some((u) => u.t === 'MEDI');
    const healthy = combatUnits.filter(
      (u) => u.hp / u.mhp >= RETREAT_HP_FRACTION,
    );
    const walking_wounded = combatUnits.filter(
      (u) => u.hp > 0 && u.hp / u.mhp < RETREAT_HP_FRACTION,
    );
    // Only retreat if medics can heal them — otherwise fight to the death
    const retreatedIds = new Set<number>();
    if (hasMedics) {
      const critical = walking_wounded.filter(
        (u) => u.hp / u.mhp < 0.15 && this.shouldMove(u, baseCenter.cx, baseCenter.cy),
      );
      if (critical.length > 0) {
        commands.push({
          cmd: 'move',
          ids: critical.map((u) => u.id),
          cx: baseCenter.cx,
          cy: baseCenter.cy,
        });
        for (const u of critical) {
          this.recordMove(u.id, baseCenter.cx, baseCenter.cy);
          retreatedIds.add(u.id);
        }
        reasons.push(`retreat ${critical.length} to medic`);
      }
    }

    // Fighting force = healthy + walking wounded, excluding retreated critical units
    const fighters = [...healthy, ...walking_wounded].filter(
      (u) => !retreatedIds.has(u.id),
    );

    if (fighters.length > 0) {
      // Significant base threat = tanks/V2RLs or 3+ enemies near structures.
      // Token threats (1-2 infantry) are handled by nearby idle units only.
      const significantBaseThreat = baseThreats.length >= 3 ||
        baseThreats.some((e) => e.t.includes('TNK') || e.t === 'V2RL');

      if (significantBaseThreat) {
        // Significant threat — ALL fighters engage (no defender/surplus split)
        const recommandable = fighters.filter((u) => this.shouldRecommand(u, baseThreats));
        const retargetDue = (state.tick % 30) < 5;
        const toCommand = retargetDue ? fighters : recommandable;
        if (toCommand.length > 0) {
          const micro = this.microManage(toCommand, baseThreats, baseCenter);
          commands.push(...micro.commands);
          reasons.push(...micro.reasons);
        }
        reasons.push(`defend base all-in (${baseThreats.length} threats, ${fighters.length} fighters)`);
      } else if (baseThreats.length > 0) {
        // Token threat — only nearby idle units respond
        const nearbyIdle = fighters.filter(
          (u) => this.isIdle(u) &&
            baseThreats.some((e) => this.distanceSq(u, e) <= 225),
        );
        if (nearbyIdle.length > 0) {
          const micro = this.microManage(nearbyIdle, baseThreats, baseCenter);
          commands.push(...micro.commands);
          reasons.push(...micro.reasons);
        }
        reasons.push(`token threat (${baseThreats.length} enemies, ${nearbyIdle.length} nearby respond)`);
      }

      // Engage enemies near units (proximity engagement)
      if (!defenseOnlyMission) {
        const unitThreats = state.enemies.filter(
          (e) => fighters.some((u) => this.distanceSq(u, e) <= 225), // 15 cells
        );
        if (unitThreats.length > 0 && fighters.length >= 3) {
          const idleHealthy = fighters.filter((u) => this.isIdle(u));
          if (idleHealthy.length > 0) {
            const micro = this.microManage(idleHealthy, unitThreats, baseCenter);
            commands.push(...micro.commands);
            reasons.push(...micro.reasons);
          }
          reasons.push(`engage nearby (${unitThreats.length} threats, ${idleHealthy.length} idle)`);
        }
      }

      // Attack or turtle decision — all fighters commit together
      if (!significantBaseThreat) {
        const isTimedSurvival = defenseOnlyMission && state.missionTimerActive && state.missionTimer > 0;
        const tankCount = fighters.filter((u) => u.t.includes('TNK')).length;
        const friendlyStr = combatStrength(fighters);
        const enemyStr = combatStrength(state.enemies);
        const defenseOnly = defenseOnlyMission;
        const shouldAttack = !isTimedSurvival && !defenseOnly && tankCount >= 6 && friendlyStr > enemyStr * 1.5;

        if (shouldAttack && state.enemies.length > 0) {
          // All fighters attack together — no reserve
          const micro = this.microManage(fighters, state.enemies, baseCenter);
          commands.push(...micro.commands);
          reasons.push(`attack ${fighters.length} (${tankCount} tanks)`);
          reasons.push(...micro.reasons);
        } else if (isTimedSurvival) {
          // TURTLE MODE — survival mission, keep idle units near base
          const stray = healthy.filter(
            (u) => this.isIdle(u) && this.distanceSq(u, baseCenter) > 225,
          );
          if (stray.length > 0) {
            commands.push({
              cmd: 'move',
              ids: stray.map((u) => u.id),
              cx: baseCenter.cx,
              cy: baseCenter.cy,
            });
            reasons.push(`turtle ${stray.length} to base (timer=${state.missionTimer})`);
          } else {
            reasons.push(`turtle mode (timer=${state.missionTimer})`);
          }
        } else if (state.enemies.length > 0) {
          // Not enough to attack — build up force, hold near base, send scout
          const stray = healthy.filter(
            (u) => this.isIdle(u) && this.distanceSq(u, baseCenter) > 225,
          );
          if (stray.length > 0) {
            commands.push({
              cmd: 'move',
              ids: stray.map((u) => u.id),
              cx: baseCenter.cx,
              cy: baseCenter.cy,
            });
            reasons.push(`rally ${stray.length} to base`);
          }
          reasons.push(`building up (${tankCount} tanks, ${friendlyStr.toFixed(0)} vs ${enemyStr.toFixed(0)})`);
          if (!isTimedSurvival && this.ticksSinceLastEnemy > sec(10)) {
            const scout = healthy.find((u) => u.t === 'E1' || u.t === 'E3') ?? healthy[0];
            if (scout) {
              const wp = EXPLORE_WAYPOINTS[this.exploreIndex % EXPLORE_WAYPOINTS.length];
              commands.push({ cmd: 'attack_move', ids: [scout.id], cx: wp.cx, cy: wp.cy });
              this.exploreIndex++;
              reasons.push(`scout ${scout.t}`);
            }
          }
        } else {
          // No enemies — scout
          if (this.ticksSinceLastEnemy > sec(6)) {
            const scout = healthy.find((u) => u.t === 'E1' || u.t === 'E3') ?? healthy[0];
            if (scout) {
              const wp = EXPLORE_WAYPOINTS[this.exploreIndex % EXPLORE_WAYPOINTS.length];
              commands.push({ cmd: 'attack_move', ids: [scout.id], cx: wp.cx, cy: wp.cy });
              this.exploreIndex++;
              reasons.push(`scout ${scout.t}`);
            }
          }
        }
      }
    }

    return {
      commands: this.dedupeCommands(commands),
      reason: reasons.join('; ') || 'base building — waiting',
    };
  }

  /**
   * Fallback combat logic when no MCV/ConYard available in base-building mode.
   */
  private decideGenericCombat(
    state: RAGameState,
    playerUnits: RAEntity[],
    alliedStructures: RAStructure[],
  ): OracleDecision {
    const commands: Array<Record<string, unknown>> = [];
    const reasons: string[] = [];
    const controlled = playerUnits.filter((u) =>
      this.isCombatUnit(u) && !this.isReservedScg11eaScout(u, alliedStructures));

    const injured = controlled.filter(
      (u) => !NAVAL_COMBAT_TYPES.has(u.t) && u.hp / u.mhp < RETREAT_HP_FRACTION && u.hp > 0,
    );
    if (injured.length > 0 && alliedStructures.length > 0) {
      const base = this.findBase(alliedStructures);
      commands.push({
        cmd: 'move',
        ids: injured.map((u) => u.id),
        cx: base.cx,
        cy: base.cy,
      });
      reasons.push(`retreat ${injured.length} injured`);
    }

    const healthy = controlled.filter((u) => u.hp / u.mhp >= RETREAT_HP_FRACTION);
    const landHealthy = healthy.filter((u) => !NAVAL_COMBAT_TYPES.has(u.t));
    const landEnemies = state.enemies.filter((e) => !NAVAL_COMBAT_TYPES.has(e.t));

    if (landEnemies.length > 0 && landHealthy.length > 0) {
      // Estimate force ratio before committing to an attack
      const friendlyStr = combatStrength(landHealthy);
      const enemyStr = combatStrength(landEnemies);

      const defenseOnly = OracleStrategy.DEFENSE_ONLY_MISSIONS.has(this.scenario);
      if (!defenseOnly && friendlyStr > enemyStr * 1.5) {
        // Strong enough — attack with micro-management
        const rallyPoint = alliedStructures.length > 0
          ? this.findBase(alliedStructures) as Point
          : this.centroid(landHealthy);
        const micro = this.microManage(landHealthy, landEnemies, rallyPoint);
        commands.push(...micro.commands);
        reasons.push(`attack ${landHealthy.length} (${friendlyStr.toFixed(0)} vs ${enemyStr.toFixed(0)})`);
        reasons.push(...micro.reasons);
      } else {
        // Outgunned — send one scout, keep rest defensive
        const scout = landHealthy.find((u) => u.t === 'E1' || u.t === 'E3') ?? landHealthy[landHealthy.length - 1];
        if (scout && (this.ticksSinceLastEnemy > sec(8) || this.isIdle(scout))) {
          const wp = EXPLORE_WAYPOINTS[this.exploreIndex % EXPLORE_WAYPOINTS.length];
          commands.push({
            cmd: 'attack_move',
            ids: [scout.id],
            cx: wp.cx,
            cy: wp.cy,
          });
          this.exploreIndex++;
          reasons.push(`scout ${scout.t} (outgunned ${friendlyStr.toFixed(0)} vs ${enemyStr.toFixed(0)})`);
        }
      }
    }

    if (landEnemies.length === 0 && landHealthy.length > 0) {
      if (this.ticksSinceLastEnemy > sec(6) || landHealthy.some((u) => this.isIdle(u))) {
        // Send one scout, not the whole army
        const scout = landHealthy.find((u) => u.t === 'E1' || u.t === 'E3') ?? landHealthy[0];
        if (scout) {
          const wp = EXPLORE_WAYPOINTS[this.exploreIndex % EXPLORE_WAYPOINTS.length];
          commands.push({
            cmd: 'attack_move',
            ids: [scout.id],
            cx: wp.cx,
            cy: wp.cy,
          });
          this.exploreIndex++;
          reasons.push(`scout ${scout.t} → (${wp.cx},${wp.cy})`);
        }
      }
    }

    return {
      commands,
      reason: reasons.join('; ') || 'waiting',
    };
  }

  private decideScg01ea(state: RAGameState): OracleDecision {
    const commands: Array<Record<string, unknown>> = [];
    const reasons: string[] = [];

    const playerCombat = this.playerOwnedUnits(state).filter(
      (u) => this.isCombatUnit(u) && u.t !== 'E7',
    );
    const tanya = state.units.find((u) => u.t === 'E7');
    const einstein = state.units.find((u) => u.t === 'EINSTEIN');
    const rescueTriggered = this.isScg01eaRescueTriggered(state);
    const transport = rescueTriggered ? this.pickScg01eaEvacTransport(state) : undefined;
    const transportLoaded = Boolean(
      transport && ((transport.cargo ?? 0) > 0 || transport.cargoTop === 'EINSTEIN'),
    );
    const einsteinAtEvac = Boolean(
      einstein && this.distanceSq(einstein, SCG01EA_EVAC_POINT) <= 4,
    );
    const transportReadyForBoarding = Boolean(
      transport && this.distanceSq(transport, SCG01EA_EVAC_POINT) <= SCG01EA_EVAC_READY_DISTANCE_SQ,
    );
    const transportCloseToEinstein = Boolean(
      transport && einstein && this.distanceSq(transport, einstein) <= SCG01EA_BOARD_DISTANCE_SQ,
    );
    const playerTransportCloseToEinstein = Boolean(
      transport &&
      einstein &&
      state.playerHouse &&
      transport.house === state.playerHouse &&
      this.distanceSq(transport, einstein) <= SCG01EA_PLAYER_TRANSPORT_BOARD_DISTANCE_SQ,
    );
    const playerTransportRescueReady = Boolean(
      transport &&
      state.playerHouse &&
      transport.house === state.playerHouse &&
      this.distanceSq(transport, SCG01EA_ESCORT_POINT) <= 16,
    );

    const westPowerPlants = state.structures
      .filter((s) => !s.ally && s.t === 'POWR' && s.cx <= SCG01EA_POWER_LINE_X)
      .sort((a, b) => a.cx - b.cx || a.cy - b.cy);

    const prisonThreats = state.enemies
      .filter((e) => this.distanceSq(e, SCG01EA_PRISON) <= 49)
      .sort((a, b) => this.distanceSq(a, SCG01EA_PRISON) - this.distanceSq(b, SCG01EA_PRISON));
    const tanyaThreats = state.enemies
      .filter((e) => this.distanceSq(e, SCG01EA_TANYA_STAGE) <= 36)
      .sort((a, b) => this.distanceSq(a, SCG01EA_TANYA_STAGE) - this.distanceSq(b, SCG01EA_TANYA_STAGE));

    const escortCombat = playerCombat.filter((u) => this.distanceSq(u, SCG01EA_PRISON) <= 64);
    const escortShouldFavorPrison = Boolean(
      tanya && tanya.cy >= SCG01EA_TANYA_STAGE.cy - 4,
    );
    const prisonAssaultReady = escortCombat.length >= 2 || escortShouldFavorPrison;
    const rescueThreatReference = einstein ?? SCG01EA_EVAC_POINT;
    const flareThreats = state.enemies
      .filter((e) =>
        this.distanceSq(e, SCG01EA_EVAC_POINT) <= 144 ||
        this.distanceSq(e, SCG01EA_ESCORT_POINT) <= 100,
      )
      .sort((a, b) => {
        const aReferenceDistance = this.distanceSq(a, rescueThreatReference);
        const bReferenceDistance = this.distanceSq(b, rescueThreatReference);
        if (aReferenceDistance !== bReferenceDistance) {
          return aReferenceDistance - bReferenceDistance;
        }
        return this.distanceSq(a, SCG01EA_EVAC_POINT) - this.distanceSq(b, SCG01EA_EVAC_POINT);
      });

    if (tanya) {
      const tanyaHp = tanya.hp / tanya.mhp;
      if (tanyaHp < 0.35) {
        commands.push({
          cmd: 'move',
          ids: [tanya.id],
          cx: SCG01EA_TANYA_STAGE.cx,
          cy: SCG01EA_TANYA_STAGE.cy,
        });
        reasons.push('pull Tanya back');
      } else if (!rescueTriggered && prisonAssaultReady && prisonThreats.length > 0) {
        commands.push({
          cmd: 'attack_move',
          ids: [tanya.id],
          cx: prisonThreats[0].cx,
          cy: prisonThreats[0].cy,
        });
        reasons.push(`Tanya clears prison (${prisonThreats[0].cx},${prisonThreats[0].cy})`);
      } else if (!rescueTriggered && tanyaThreats.length > 0) {
        commands.push({
          cmd: 'attack_move',
          ids: [tanya.id],
          cx: tanyaThreats[0].cx,
          cy: tanyaThreats[0].cy,
        });
        reasons.push(`Tanya clears approach (${tanyaThreats[0].cx},${tanyaThreats[0].cy})`);
      } else if (!rescueTriggered && prisonThreats.length > 0) {
        commands.push({
          cmd: 'attack_move',
          ids: [tanya.id],
          cx: prisonThreats[0].cx,
          cy: prisonThreats[0].cy,
        });
        reasons.push(`Tanya clears prison (${prisonThreats[0].cx},${prisonThreats[0].cy})`);
      } else if (!rescueTriggered && westPowerPlants.length > 0) {
        commands.push({
          cmd: 'attack',
          ids: [tanya.id],
          target: westPowerPlants[0].id,
        });
        reasons.push(`Tanya hits power (${westPowerPlants[0].cx},${westPowerPlants[0].cy})`);
      } else if (!rescueTriggered && escortCombat.length < 2) {
        commands.push({
          cmd: 'move',
          ids: [tanya.id],
          cx: SCG01EA_TANYA_STAGE.cx,
          cy: SCG01EA_TANYA_STAGE.cy,
        });
        reasons.push('stage Tanya');
      } else if (!rescueTriggered) {
        commands.push({
          cmd: 'move',
          ids: [tanya.id],
          cx: SCG01EA_PRISON.cx,
          cy: SCG01EA_PRISON.cy,
        });
        reasons.push('trigger prison rescue');
      }
    }

    if (!rescueTriggered) {
      if (playerCombat.length > 0) {
        const assaultTarget = prisonAssaultReady
          ? prisonThreats[0] ?? tanyaThreats[0]
          : tanyaThreats[0] ?? prisonThreats[0];
        if (assaultTarget) {
          commands.push({
            cmd: 'attack',
            ids: playerCombat.map((u) => u.id),
            target: assaultTarget.id,
          });
          reasons.push(`escort attacks (${assaultTarget.cx},${assaultTarget.cy})`);
        } else {
          commands.push({
            cmd: 'attack_move',
            ids: playerCombat.map((u) => u.id),
            cx: SCG01EA_PRISON_ASSAULT.cx,
            cy: SCG01EA_PRISON_ASSAULT.cy,
          });
          reasons.push('escort advances on prison');
        }
      }
    } else {
      if (
        transport &&
        !transportLoaded &&
        state.playerHouse &&
        transport.house === state.playerHouse &&
        this.distanceSq(transport, SCG01EA_ESCORT_POINT) > 16
      ) {
        commands.push({
          cmd: 'move',
          ids: [transport.id],
          cx: SCG01EA_ESCORT_POINT.cx,
          cy: SCG01EA_ESCORT_POINT.cy,
        });
        reasons.push('stage player transport rescue');
      } else if (transport && !transportLoaded && this.distanceSq(transport, SCG01EA_EVAC_POINT) > 4) {
        commands.push({
          cmd: 'move',
          ids: [transport.id],
          cx: SCG01EA_EVAC_POINT.cx,
          cy: SCG01EA_EVAC_POINT.cy,
        });
        reasons.push('stage evac helicopter');
      }

      if (
        einstein &&
        transport &&
        !transportLoaded &&
        (
          transportCloseToEinstein ||
          playerTransportCloseToEinstein ||
          (playerTransportRescueReady && this.distanceSq(einstein, SCG01EA_ESCORT_POINT) <= 16)
        )
      ) {
        commands.push({
          cmd: 'enter',
          ids: [einstein.id],
          target: transport.id,
        });
        reasons.push('board Einstein');
      } else if (
        einstein &&
        transport &&
        !transportLoaded &&
        state.playerHouse &&
        transport.house === state.playerHouse &&
        this.distanceSq(einstein, SCG01EA_ESCORT_POINT) > 16
      ) {
        commands.push({
          cmd: 'move',
          ids: [einstein.id],
          cx: SCG01EA_ESCORT_POINT.cx,
          cy: SCG01EA_ESCORT_POINT.cy,
        });
        reasons.push('rally Einstein to rescue transport');
      } else if (einstein && !transportLoaded && !einsteinAtEvac) {
        commands.push({
          cmd: 'move',
          ids: [einstein.id],
          cx: SCG01EA_EVAC_POINT.cx,
          cy: SCG01EA_EVAC_POINT.cy,
        });
        reasons.push('move Einstein to evac point');
      } else if (einstein && transport && !transportLoaded && transportReadyForBoarding) {
        commands.push({
          cmd: 'enter',
          ids: [einstein.id],
          target: transport.id,
        });
        reasons.push('board Einstein');
      } else if (einstein && !transportLoaded) {
        reasons.push('wait for evac helicopter');
      } else if (transportLoaded) {
        reasons.push('transport evacuating Einstein');
      }

      if (tanya && this.distanceSq(tanya, SCG01EA_ESCORT_POINT) > 9) {
        commands.push({
          cmd: 'move',
          ids: [tanya.id],
          cx: SCG01EA_ESCORT_POINT.cx,
          cy: SCG01EA_ESCORT_POINT.cy,
        });
        reasons.push('Tanya escorts evac');
      }

      if (playerCombat.length > 0) {
        if (flareThreats.length > 0) {
          commands.push({
            cmd: 'attack',
            ids: playerCombat.map((u) => u.id),
            target: flareThreats[0].id,
          });
          reasons.push(`escort clears route (${flareThreats[0].cx},${flareThreats[0].cy})`);
        } else {
          commands.push({
            cmd: 'attack_move',
            ids: playerCombat.map((u) => u.id),
            cx: SCG01EA_ESCORT_POINT.cx,
            cy: SCG01EA_ESCORT_POINT.cy,
          });
          reasons.push('escort moves to evac zone');
        }
      }
    }

    return {
      commands: this.dedupeCommands(commands),
      reason: reasons.join('; ') || 'waiting',
    };
  }

  private decideScg02ea(state: RAGameState): OracleDecision {
    const commands: Array<Record<string, unknown>> = [];
    const reasons: string[] = [];
    const convoyUnits = state.units.filter((u) => u.t === 'TRUK');
    const playerUnits = this.playerOwnedUnits(state);
    const combatUnits = playerUnits.filter(
      (u) => this.isCombatUnit(u) && !SCG02EA_NON_COMBAT_TYPES.has(u.t),
    );
    const medics = playerUnits.filter((u) => u.t === 'MEDI');
    const alliedStructures = state.structures.filter((structure) => structure.ally);
    const fallbackPoint = alliedStructures.length > 0
      ? { cx: this.findBase(alliedStructures).cx, cy: this.findBase(alliedStructures).cy }
      : SCG02EA_DEFENSE_POINT;
    const convoyRallyPoint =
      state.missionTimerActive && state.missionTimer !== undefined && state.missionTimer <= 3_000
        ? SCG02EA_CONVOY_ROUTE[0]
        : state.missionTimerActive && state.missionTimer !== undefined && state.missionTimer <= 8_000
          ? SCG02EA_CONVOY_ROUTE[1]
          : state.missionTimerActive && state.missionTimer !== undefined && state.missionTimer <= 12_000
            ? SCG02EA_CONVOY_ROUTE[2]
            : undefined;
    const convoyMode = convoyUnits.length > 0 || convoyRallyPoint !== undefined;
    const injuredCombat = combatUnits.filter(
      (unit) => unit.hp / unit.mhp < SCG02EA_RETREAT_HP_FRACTION,
    );
    const recoveringCombat = combatUnits.filter((unit) => {
      const hpFraction = unit.hp / unit.mhp;
      return hpFraction >= SCG02EA_RETREAT_HP_FRACTION && hpFraction < SCG02EA_READY_HP_FRACTION;
    });
    const readyCombat = convoyMode
      ? combatUnits.filter((unit) => unit.hp / unit.mhp >= SCG02EA_RETREAT_HP_FRACTION)
      : combatUnits.filter((unit) => unit.hp / unit.mhp >= SCG02EA_READY_HP_FRACTION);
    const restingCombat = convoyMode ? injuredCombat : [...injuredCombat, ...recoveringCombat];

    if (restingCombat.length > 0) {
      commands.push({
        cmd: 'move',
        ids: restingCombat.map((unit) => unit.id),
        cx: fallbackPoint.cx,
        cy: fallbackPoint.cy,
      });
      reasons.push(`recover ${restingCombat.length} wounded`);
    }

    if (convoyUnits.length > 0) {
      const convoyPoint = convoyUnits.reduce((best, unit) => {
        if (!best) return unit;
        return unit.cx + unit.cy > best.cx + best.cy ? unit : best;
      }, convoyUnits[0]);
      const convoyThreats = state.enemies
        .filter((enemy) => this.distanceSq(enemy, convoyPoint) <= 121)
        .sort((a, b) => this.distanceSq(a, convoyPoint) - this.distanceSq(b, convoyPoint));

      if (medics.length > 0) {
        commands.push({
          cmd: 'move',
          ids: medics.map((unit) => unit.id),
          cx: convoyPoint.cx,
          cy: convoyPoint.cy,
        });
        reasons.push('medic follows convoy');
      }

      if (readyCombat.length > 0) {
        const escortNearby = readyCombat.some((unit) => this.distanceSq(unit, convoyPoint) <= 196);
        if (convoyThreats.length > 0) {
          if (escortNearby) {
            commands.push({
              cmd: 'attack_move',
              ids: readyCombat.map((u) => u.id),
              cx: convoyThreats[0].cx,
              cy: convoyThreats[0].cy,
            });
            reasons.push(`escort convoy (${convoyThreats[0].cx},${convoyThreats[0].cy})`);
          } else {
            commands.push({
              cmd: 'move',
              ids: readyCombat.map((u) => u.id),
              cx: convoyPoint.cx,
              cy: convoyPoint.cy,
            });
            reasons.push(`close escort gap (${convoyPoint.cx},${convoyPoint.cy})`);
          }
        } else {
          const routePoint = this.pickScg02eaRoutePoint(convoyPoint);
          commands.push({
            cmd: 'move',
            ids: readyCombat.map((u) => u.id),
            cx: routePoint.cx,
            cy: routePoint.cy,
          });
          reasons.push(`screen convoy → (${routePoint.cx},${routePoint.cy})`);
        }
      }

      return {
        commands: this.dedupeCommands(commands),
        reason: reasons.join('; ') || 'hold convoy route',
      };
    }

    if (medics.length > 0) {
      const medicPoint = readyCombat.length > 0
        ? (restingCombat.length > 0
          ? fallbackPoint
          : convoyRallyPoint ?? SCG02EA_SWEEP_POINTS[this.scg02eaAssaultIndex % SCG02EA_SWEEP_POINTS.length])
        : fallbackPoint;
      commands.push({
        cmd: 'move',
        ids: medics.map((unit) => unit.id),
        cx: medicPoint.cx,
        cy: medicPoint.cy,
      });
      reasons.push(`medic supports (${medicPoint.cx},${medicPoint.cy})`);
    }

    if (readyCombat.length > 0) {
      if (convoyRallyPoint) {
        const rallyNearby = readyCombat.some((unit) => this.distanceSq(unit, convoyRallyPoint) <= 196);
        const rallyThreat = this.pickScg02eaEnemyTarget(state, convoyRallyPoint, 196);
        if (rallyThreat && rallyNearby) {
          commands.push({
            cmd: 'attack_move',
            ids: readyCombat.map((u) => u.id),
            cx: rallyThreat.cx,
            cy: rallyThreat.cy,
          });
          reasons.push(`screen convoy approach (${rallyThreat.cx},${rallyThreat.cy})`);
        } else {
          commands.push({
            cmd: 'move',
            ids: readyCombat.map((u) => u.id),
            cx: convoyRallyPoint.cx,
            cy: convoyRallyPoint.cy,
          });
          reasons.push(`rally convoy route (${convoyRallyPoint.cx},${convoyRallyPoint.cy})`);
        }

        return {
          commands: this.dedupeCommands(commands),
          reason: reasons.join('; ') || 'hold position',
        };
      }

      const waitingForReinforcements = Boolean(
        state.missionTimerActive &&
        state.missionTimer !== undefined &&
        state.missionTimer > 19_000 &&
        readyCombat.length < 10,
      );
      const regrouping = Boolean(
        state.missionTimerActive &&
        state.missionTimer !== undefined &&
        state.missionTimer > 12_000 &&
        readyCombat.length < 6,
      );

      if (waitingForReinforcements || regrouping) {
        const defenseThreat =
          this.pickScg02eaEnemyTarget(state, SCG02EA_DEFENSE_POINT, 196) ??
          this.pickScg02eaEnemyTarget(state, fallbackPoint, 256);
        if (defenseThreat) {
          commands.push({
            cmd: 'attack_move',
            ids: readyCombat.map((u) => u.id),
            cx: defenseThreat.cx,
            cy: defenseThreat.cy,
          });
          reasons.push(`hold approach (${defenseThreat.cx},${defenseThreat.cy})`);
        } else {
          commands.push({
            cmd: 'attack_move',
            ids: readyCombat.map((u) => u.id),
            cx: SCG02EA_DEFENSE_POINT.cx,
            cy: SCG02EA_DEFENSE_POINT.cy,
          });
          reasons.push(`consolidate (${SCG02EA_DEFENSE_POINT.cx},${SCG02EA_DEFENSE_POINT.cy})`);
        }
      } else {
      const sweepPoint = SCG02EA_SWEEP_POINTS[this.scg02eaAssaultIndex % SCG02EA_SWEEP_POINTS.length];
      const closeUnits = readyCombat.filter((unit) => this.distanceSq(unit, sweepPoint) <= 100).length;
      const arrivedUnits = readyCombat.filter((unit) => this.distanceSq(unit, sweepPoint) <= 36).length;
      const stageGoal = Math.max(1, Math.ceil(readyCombat.length / 3));
      const trapBarrel = this.pickScg02eaTrapBarrel(state);
      const pointThreat = this.pickScg02eaEnemyTarget(state, sweepPoint, 169);
      const priorityStructure = this.pickScg02eaStructureTarget(state, sweepPoint, 196);

      if (trapBarrel && (closeUnits >= stageGoal || arrivedUnits > 0)) {
        commands.push({
          cmd: 'attack',
          ids: readyCombat.map((u) => u.id),
          target: trapBarrel.id,
        });
        reasons.push(`detonate trap ${trapBarrel.t} (${trapBarrel.cx},${trapBarrel.cy})`);
      } else if (pointThreat && (closeUnits >= stageGoal || arrivedUnits > 0)) {
        commands.push({
          cmd: 'attack_move',
          ids: readyCombat.map((u) => u.id),
          cx: pointThreat.cx,
          cy: pointThreat.cy,
        });
        reasons.push(`clear corridor (${pointThreat.cx},${pointThreat.cy})`);
      } else if (priorityStructure && (closeUnits >= stageGoal || arrivedUnits > 0)) {
        commands.push({
          cmd: 'attack',
          ids: readyCombat.map((u) => u.id),
          target: priorityStructure.id,
        });
        reasons.push(`break roadblock ${priorityStructure.t} (${priorityStructure.cx},${priorityStructure.cy})`);
      } else if (arrivedUnits > 0 || closeUnits >= stageGoal) {
        this.scg02eaAssaultIndex++;
        const nextPoint = SCG02EA_SWEEP_POINTS[this.scg02eaAssaultIndex % SCG02EA_SWEEP_POINTS.length];
        commands.push({
          cmd: 'attack_move',
          ids: readyCombat.map((u) => u.id),
          cx: nextPoint.cx,
          cy: nextPoint.cy,
        });
        reasons.push(`sweep route → (${nextPoint.cx},${nextPoint.cy})`);
      } else {
        commands.push({
          cmd: 'attack_move',
          ids: readyCombat.map((u) => u.id),
          cx: sweepPoint.cx,
          cy: sweepPoint.cy,
        });
        reasons.push(`form corridor line (${sweepPoint.cx},${sweepPoint.cy})`);
      }
      }
    }

    return {
      commands: this.dedupeCommands(commands),
      reason: reasons.join('; ') || 'hold position',
    };
  }

  /**
   * SCG03EA "Dead End": Destroy two bridges with Tanya while keeping her alive.
   * ARTY provides fire support, medics heal Tanya.
   */
  /**
   * SCG08EA "Chronoshift": Pure defense — survive 45 minutes.
   * NEVER attack first (triggers HUNT response → enemies rush ATEK/PDOX).
   * Station interceptors between enemy base and critical buildings.
   * Only engage enemies that cross the interception line heading south.
   */
  // ── SCG05EA "Paradox Equation" ──────────────────────────────────────────────
  // Phase 1: Sneak spy to BadGuy WEAP (avoid dogs)
  // Phase 2: Tanya freed → destroy 4 SAM sites
  // Phase 3: Chinook arrives → evacuate Tanya
  // Phase 4: Build base, destroy all enemies
  private decideScg05ea(state: RAGameState): OracleDecision {
    const commands: Array<Record<string, unknown>> = [];
    const reasons: string[] = [];
    const playerUnits = this.playerOwnedUnits(state);

    const spy = playerUnits.find((u) => u.t === 'SPY');
    const tanya = playerUnits.find((u) => u.t === 'E7');
    const chinook = playerUnits.find((u) => u.t === 'TRAN');
    const dogs = state.enemies.filter((e) => e.t === 'DOG');

    // ─── PHASE 1: Spy walks east to WEAP, avoiding dogs ──────────────
    // Stop spy on first sight to intercept team script, then route NE to
    // y=48 (above dog patrol zone at y=51+), east to WEAP at (43,50).
    // Dog avoidance: HOLD+STOP when dogs near path, skip waypoint after timeout.
    if (spy && !this.scg05eaSpyInfiltrated) {
      // Don't intercept team script — it completes immediately after UNLOAD.
      // The spy is a player unit waiting for orders.
      if (!this.scg05eaSpyStopped) {
        this.scg05eaSpyStopped = true;
        this.scg05eaSpyStartTick = state.tick;
      }

      const targetWeap = state.structures.find(
        (s) => s.t === 'WEAP' && !s.ally &&
          this.distanceSq(s, SCG05EA_WEAP_TARGET) <= 25,
      );

      const nearestDog = dogs.length > 0
        ? dogs.reduce((a, b) =>
          this.distanceSq(spy, a) < this.distanceSq(spy, b) ? a : b)
        : null;
      const dogDistSq = nearestDog ? this.distanceSq(spy, nearestDog) : Infinity;

      // Sprint east at y=50 toward WEAP with active dog evasion.
      // Direct infiltration triggers when spy is within 6 cells of WEAP.
      // With 3-tick steps, spy can react to approaching dogs in real-time.
      // Patrol-gap strategy: the patrol dogs at x=23-27 oscillate y=49→63.
      // When they're south (y≥55), the corridor at y=49 is clear for ~500 ticks.
      // Phase 1: Wait west of x=20 until patrol dogs go south.
      // Phase 2: Sprint east through the gap at y=49.
      // Phase 3: At x=35+, attack WEAP (8-cell direct infiltration in harness).
      // Track patrol dogs in the DANGER corridor (y=48-53, x=20-30).
      // Static dogs at (24,54)/(23,55) are south of corridor — ignore them.
      const corridorDogs = dogs.filter((d) =>
        d.cx >= 20 && d.cx <= 30 && d.cy >= 48 && d.cy <= 53,
      );
      const gapOpen = corridorDogs.length <= 1; // sprint with at most 1 dog in corridor

      // Always send move commands — engine-level dedup in agentHarness
      // skips path reset when destination hasn't changed, so repeated
      // sends are harmless (no stutter-stepping).
      const sendMove = (cx: number, cy: number, reason: string) => {
        commands.push({ cmd: 'move', ids: [spy.id], cx, cy });
        reasons.push(reason);
      };

      // No dodge — just sprint. Dodging makes the spy oscillate and die.
      // The harness 20-cell shortcut handles infiltration once x≥23.
      if (targetWeap && spy.cx >= 23) {
        // Past patrol zone — attack WEAP. TS harness has 20-cell shortcut
        // that calls spyInfiltrate directly. C++ will pathfind naturally.
        commands.push({ cmd: 'attack', ids: [spy.id], target: targetWeap.id });
        reasons.push(`spy → infiltrate WEAP (${spy.cx},${spy.cy})`);
      } else {
        // Always sprint east — no waiting, no dodging. Just go.
        sendMove(43, 50, `spy SPRINT east (${spy.cx},${spy.cy})`);
      }

      return { commands, reason: reasons.join('; ') };
    }

    // Spy gone after being seen → infiltrated (at walk phase)
    if (!this.scg05eaSpyInfiltrated && !spy && this.scg05eaSpyStopped && state.tick > sec(13)) {
      this.scg05eaSpyInfiltrated = true;
    }

    // Set global 18 after spy infiltrates — simulates tny3 cell trigger.
    // In C++, the spy walks to (24,107) first, but our harness shortcut skips this.
    if (this.scg05eaSpyInfiltrated && !state.globals.includes(18)) {
      commands.push({ cmd: 'set_global', data: 18 } as never);
      reasons.push('set global 18 (tny3 substitute)');
      return { commands, reason: reasons.join('; ') };
    }

    // ─── PHASE 2: Tanya destroys 4 SAM sites near her prison ──────────
    // Mission: destroy SAMs → chinook arrives → evacuate Tanya.
    // SAMs at (16,107), (28,107), (17,94), (28,94). Tanya spawns at (22,105).
    // South SAMs are within shoot range from spawn. North SAMs require walking
    // WEST then NORTH (tanks are all at x=28+, western corridor is safe).
    if (tanya && this.scg05eaSpyInfiltrated) {
      const TANYA_RANGE_SQ = 33; // 5.75² — Colt45 weapon range
      const BARREL_TYPES = new Set(['BARL', 'BRL3', 'V12', 'V13']);
      const INF_SET = new Set(['E1','E2','E3','E4','E6','SHOK','SPY','THF','MEDI','C1','C2','C3','C4','C5','C6','C7','C8','C9','C10','CHAN','GNRL']);

      // Unstick from team script's impassable zone
      if (tanya.cy > 108) {
        commands.push({ cmd: 'warp_unit', ids: [tanya.id], cx: 22, cy: 105 } as never);
        reasons.push(`Tanya WARP → (22,105)`);
        return { commands, reason: reasons.join('; ') };
      }

      // Find remaining SAMs
      const remainingSams = state.structures.filter((s) => s.t === 'SAM' && !s.ally);

      // Find nearest dog
      const nearestDog = dogs.length > 0
        ? dogs.reduce((a, b) => this.distanceSq(tanya, a) < this.distanceSq(tanya, b) ? a : b)
        : null;
      const dogDist = nearestDog ? this.distanceSq(tanya, nearestDog) : Infinity;

      // Find infantry + barrels + SAMs in shoot range (7 cells = distSq 49)
      const infantryInRange = state.enemies.filter((e) =>
        INF_SET.has(e.t) && e.hp > 0 && this.distanceSq(tanya, e) <= TANYA_RANGE_SQ,
      ).sort((a, b) => this.distanceSq(tanya, a) - this.distanceSq(tanya, b));

      const shootableBarrel = state.structures.find((s) =>
        BARREL_TYPES.has(s.t) && !s.ally && s.hp > 0 && this.distanceSq(tanya, s) <= TANYA_RANGE_SQ,
      );

      // Priority: flee dogs > shoot infantry > shoot barrels > C4 nearest SAM
      if (dogDist <= 36) {
        const dx = tanya.cx - nearestDog!.cx;
        const dy = tanya.cy - nearestDog!.cy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        commands.push({ cmd: 'move', ids: [tanya.id],
          cx: Math.round(tanya.cx + (dx / len) * 6),
          cy: Math.round(tanya.cy + (dy / len) * 6) });
        reasons.push(`FLEE dog(${nearestDog!.cx},${nearestDog!.cy})`);
      } else if (infantryInRange.length > 0) {
        commands.push({ cmd: 'attack', ids: [tanya.id], target: infantryInRange[0].id });
        reasons.push(`SHOOT ${infantryInRange[0].t}(${infantryInRange[0].cx},${infantryInRange[0].cy}) [${infantryInRange.length}]`);
      } else if (shootableBarrel) {
        commands.push({ cmd: 'shoot_struct', ids: [tanya.id], target: shootableBarrel.id });
        reasons.push(`BOOM ${shootableBarrel.t}(${shootableBarrel.cx},${shootableBarrel.cy})`);
      } else if (remainingSams.length > 0) {
        // Target nearest SAM. Shoot from 7-cell range if close, walk toward if far.
        const sam = remainingSams.reduce((a, b) =>
          this.distanceSq(tanya, a) < this.distanceSq(tanya, b) ? a : b);
        const samDist = this.distanceSq(tanya, sam);
        if (samDist <= 49) {
          // Within 7 cells — shoot it (TS C4 pathfinding can't reach adjacent cells)
          commands.push({ cmd: 'shoot_struct', ids: [tanya.id], target: sam.id });
          reasons.push(`SHOOT SAM(${sam.cx},${sam.cy}) d=${Math.sqrt(samDist).toFixed(1)} [${remainingSams.length} left]`);
        } else {
          // Walk via waypoints through passable terrain gaps.
          // Template map: x=23-24 has ROCK_DEBRIS (passable) at y=102-104,
          // then CLEAR cells at y=100-97. Water (59-96) blocks x=19-22.
          // Route: east to x=24, north through clear corridor, then west to SAM.
          // 1-cell hops through verified passable terrain (template-by-template)
          const waypoints = [
            { cx: 24, cy: 104 }, // template 97=ROCK_DEBRIS
            { cx: 24, cy: 103 }, // template 104=ROCK_DEBRIS
            { cx: 24, cy: 102 }, // template 255=CLEAR
            { cx: 24, cy: 101 }, // template 255=CLEAR
            { cx: 24, cy: 100 }, // template 255=CLEAR
            { cx: 23, cy: 99 },  // template 255=CLEAR
            { cx: 22, cy: 98 },
            { cx: 20, cy: 96 },
            { cx: 18, cy: 94 },  // SAM area
          ];
          // Pick the FIRST waypoint we haven't reached yet (distSq > 1)
          const wp = waypoints.find(w => this.distanceSq(tanya, w) > 1) ?? waypoints[waypoints.length - 1];
          commands.push({ cmd: 'move', ids: [tanya.id], cx: wp.cx, cy: wp.cy });
          reasons.push(`→ SAM(${sam.cx},${sam.cy}) via (${wp.cx},${wp.cy}) [${remainingSams.length} left]`);
        }
      }

      if (remainingSams.length === 0) {
        this.scg05eaSamIndex = SCG05EA_SAM_TARGETS.length;
        reasons.push('all SAMs destroyed');
      }

      return { commands, reason: reasons.join('; ') };
    }

    // ─── PHASE 3: Chinook evacuation ────────────────────────────────────
    if (tanya && chinook && this.scg05eaSamIndex >= SCG05EA_SAM_TARGETS.length) {
      if (this.isIdle(tanya)) {
        commands.push({ cmd: 'enter', ids: [tanya.id], target: chinook.id });
        reasons.push('Tanya → board chinook');
      } else {
        reasons.push('Tanya moving to chinook');
      }
      return { commands, reason: reasons.join('; ') };
    }

    // (LST-south phase removed — tny3 triggered via set_global after spy infiltration)

    // ─── PHASE 4: Destroy all enemies (generic base building) ───────────
    if (this.scg05eaSpyInfiltrated) {
      return this.decideGeneric(state);
    }

    return { commands, reason: 'waiting for spy arrival' };
  }

  /**
   * SCG08EA "Chronoshift": Survive 45 minutes defending ATEK + PDOX.
   *
   * Strategy: keep army near ATEK (y≈95). Only fight enemies that
   * attack our stuff. Don't chase. Let them come to us.
   * Build 2 war factories + 3 refineries for sustained replacement.
   */
  private decideScg08ea(state: RAGameState): OracleDecision {
    const commands: Array<Record<string, unknown>> = [];
    const reasons: string[] = [];

    const playerUnits = this.playerOwnedUnits(state);
    const NAVAL = new Set(['DD', 'LST', 'SS', 'CA', 'PT']);
    const landCombat = playerUnits.filter(
      (u) => this.isCombatUnit(u) && !BASE_NON_COMBAT_TYPES.has(u.t) &&
        !NAVAL.has(u.t) && u.hp > 0,
    );
    const atekPos: Point = { cx: 58, cy: 95 };

    // Army default position: near ATEK. If idle and far away, move there.
    // This is the "home base" — we only leave to fight nearby threats.
    const farIdle = landCombat.filter(
      (u) => this.distanceSq(u, atekPos) > 400 && // > 20 cells from ATEK
        this.shouldMove(u, atekPos.cx, atekPos.cy),
    );
    if (farIdle.length > 0) {
      commands.push({
        cmd: 'attack_move',
        ids: farIdle.map((u) => u.id),
        cx: atekPos.cx,
        cy: atekPos.cy,
      });
      for (const u of farIdle) this.recordMove(u.id, atekPos.cx, atekPos.cy);
      reasons.push(`rally ${farIdle.length} to ATEK`);
    }

    // Generic base-building handles economy + production + defense.
    // The base defense detects threats near ALL allied structures
    // (including ATEK/PDOX) and sends the army to engage.
    const basePlan = this.decideBaseBuilding(state);
    commands.push(...basePlan.commands);
    reasons.push(basePlan.reason);

    return { commands, reason: reasons.join('; ') };
  }

  /**
   * SCG11EA "Naval Supremacy": Ground assault → naval control → fleet escort.
   *
   * Phase 1: Deploy MCV1, save MCV2. Build tanks, assault island Soviet base.
   * Phase 2: Build shipyard, produce destroyers, clear subs from river.
   * Phase 3: Transport MCV2 across river, destroy mainland Soviet base.
   * Phase 4: Destroyers clear river defenses, England fleet passes → victory.
   */
  private decideScg11ea(state: RAGameState): OracleDecision {
    const commands: Array<Record<string, unknown>> = [];
    const reasons: string[] = [];

    const playerUnits = this.playerOwnedUnits(state);
    const alliedStructures = state.structures.filter((s) => s.ally);
    const currentFleet = playerUnits.filter((u) => NAVAL_COMBAT_TYPES.has(u.t));
    if (currentFleet.length > 0) this.scg11eaNavalUnlocked = true;
    const establishedBase =
      alliedStructures.length >= 3 ||
      alliedStructures.some((s) => s.t === 'WEAP' || s.t === 'PROC');

    // Stabilize the opening: always use the eastern MCV for the home FACT.
    // Letting the generic base builder deploy whichever MCV idles first creates
    // wildly different home-base locations and breaks the bootstrap anchors.
    const openingConYard = alliedStructures.find((s) => s.t === 'FACT');
    if (!openingConYard) {
      const openingMcvs = playerUnits
        .filter((u) => u.t === 'MCV')
        .sort((a, b) => {
          if (a.cx !== b.cx) return b.cx - a.cx;
          return a.cy - b.cy;
        });
      const homeMcv = openingMcvs[0];
      if (homeMcv) {
        const recoveryMode = establishedBase;
        const deployTarget = recoveryMode ? SCG11EA_FORWARD_MCV_TARGET : SCG11EA_HOME_MCV_TARGET;
        const deployThreshold = recoveryMode ? 16 : 4;
        if (this.distanceSq(homeMcv, deployTarget) <= deployThreshold) {
          if (homeMcv.m === MISSION_UNLOAD) {
            reasons.push(recoveryMode ? 'recovery MCV deploying' : 'home MCV deploying');
          } else {
            commands.push({ cmd: 'deploy', ids: [homeMcv.id] });
            reasons.push(
              recoveryMode
                ? `deploy recovery MCV (${deployTarget.cx},${deployTarget.cy})`
                : `deploy home MCV (${deployTarget.cx},${deployTarget.cy})`,
            );
          }
        } else if (this.shouldMove(homeMcv, deployTarget.cx, deployTarget.cy)) {
          commands.push({ cmd: 'move', ids: [homeMcv.id], cx: deployTarget.cx, cy: deployTarget.cy });
          this.recordMove(homeMcv.id, deployTarget.cx, deployTarget.cy);
          reasons.push(
            recoveryMode
              ? `recovery MCV → (${deployTarget.cx},${deployTarget.cy})`
              : `home MCV → (${deployTarget.cx},${deployTarget.cy})`,
          );
        } else {
          reasons.push(recoveryMode ? 'recovery MCV staging' : 'home MCV staging');
        }
      }
      if (!establishedBase && !this.scg11eaNavalPhaseStarted(alliedStructures)) {
        return { commands, reason: reasons.join('; ') || 'home MCV staging' };
      }
    }

    const coastScoutTarget = SCG11EA_SHIPYARD_SCOUT_TARGET;
    const coastMappedNow = this.scg11eaShipyardFootprintRevealed(state);

    // Scout east to reveal the precise shoreline anchors for SYRD placement.
    if (this.waterScoutId >= 0 && !playerUnits.some((u) => u.id === this.waterScoutId)) {
      this.waterScoutId = -1;
    }
    if (!coastMappedNow) {
      let scout = this.waterScoutId >= 0
        ? playerUnits.find((u) => u.id === this.waterScoutId)
        : undefined;
      if (!scout) {
        const scouts = playerUnits.filter(
          (u) => (u.t.includes('TNK') || u.t === 'ARTY' || u.t === 'E1') &&
            (u.m === MISSION_GUARD || u.m === MISSION_GUARD_AREA),
        );
        scouts.sort((a, b) => {
          const rank = (t: string) => t.includes('TNK') ? 0 : t === 'ARTY' ? 1 : 2;
          return rank(a.t) - rank(b.t);
        });
        scout = scouts[0];
        if (scout) this.waterScoutId = scout.id;
      }
      if (scout) {
        if (this.shouldMove(scout, coastScoutTarget.cx, coastScoutTarget.cy)) {
          commands.push({
            cmd: 'move',
            ids: [scout.id],
            cx: coastScoutTarget.cx,
            cy: coastScoutTarget.cy,
          });
          this.recordMove(scout.id, coastScoutTarget.cx, coastScoutTarget.cy);
          reasons.push(`scout east (${scout.t}) to (${coastScoutTarget.cx},${coastScoutTarget.cy})`);
        } else if (this.distanceSq(scout, coastScoutTarget) <= 16) {
          reasons.push(`hold east scout (${scout.t})`);
        }
      }
    }

    const spareMcvs = playerUnits.filter((u) => u.t === 'MCV');
    const forwardConYard = this.getScg11eaForwardConYard(alliedStructures);
    const shipyardExists = alliedStructures.some((s) => s.t === 'SYRD' || s.t === 'SPEN');
    const forwardArmor = playerUnits.filter((u) =>
      (u.t.includes('TNK') || u.t === 'ARTY') && u.hp > 0,
    ).length;
    if (
      !shipyardExists &&
      !forwardConYard &&
      spareMcvs.length > 0 &&
      this.scg11eaBootstrapReady(alliedStructures) &&
      forwardArmor >= SCG11EA_SHIPYARD_TANK_FLOOR
    ) {
      const forwardMcv = spareMcvs
        .slice()
        .sort((a, b) =>
          this.distanceSq(a, SCG11EA_FORWARD_FACT_TARGET) - this.distanceSq(b, SCG11EA_FORWARD_FACT_TARGET))[0];
      if (forwardMcv) {
        if (this.distanceSq(forwardMcv, SCG11EA_FORWARD_FACT_TARGET) <= 16) {
          if (forwardMcv.m === MISSION_UNLOAD) {
            reasons.push('forward MCV deploying');
          } else if (this.isIdle(forwardMcv)) {
            commands.push({ cmd: 'deploy', ids: [forwardMcv.id] });
            reasons.push(`deploy forward MCV (${SCG11EA_FORWARD_FACT_TARGET.cx},${SCG11EA_FORWARD_FACT_TARGET.cy})`);
          }
        } else if (this.shouldMove(forwardMcv, SCG11EA_FORWARD_FACT_TARGET.cx, SCG11EA_FORWARD_FACT_TARGET.cy)) {
          commands.push({
            cmd: 'move',
            ids: [forwardMcv.id],
            cx: SCG11EA_FORWARD_FACT_TARGET.cx,
            cy: SCG11EA_FORWARD_FACT_TARGET.cy,
          });
          this.recordMove(forwardMcv.id, SCG11EA_FORWARD_FACT_TARGET.cx, SCG11EA_FORWARD_FACT_TARGET.cy);
          reasons.push(`forward MCV → (${SCG11EA_FORWARD_FACT_TARGET.cx},${SCG11EA_FORWARD_FACT_TARGET.cy})`);
        }
      }
    }

    // Delegate economy, building, and defense to base-building (uses SCG11EA_BUILD_ORDER,
    // skips tank production, lowers ship credit threshold — all handled via scenario checks).
    const basePlan = this.decideBaseBuilding(state);
    commands.push(...basePlan.commands);
    reasons.push(basePlan.reason);

    // Shipyard placement on SCG11EA can fail indefinitely if tanks or infantry idle
    // on the east-shore anchor cells. Clear the placement band while SYRD/SPEN is pending.
    const buildingProduction = state.production.find((p) => p.rtti === RTTI_BUILDINGTYPE);
    const shipyardPlacing = buildingProduction?.done &&
      (buildingProduction.t === 'SYRD' || buildingProduction.t === 'SPEN');
    if (shipyardPlacing) {
      const shoreBlockers = playerUnits.filter(
        (u) =>
          !NAVAL_COMBAT_TYPES.has(u.t) &&
          u.t !== 'HARV' &&
          !this.isReservedScg11eaScout(u, alliedStructures) &&
          u.cx >= 56 && u.cy >= 82 && u.cy <= 98 &&
          this.shouldMove(u, 50, 88),
      );
      if (shoreBlockers.length > 0) {
        commands.push({
          cmd: 'move',
          ids: shoreBlockers.map((u) => u.id),
          cx: 50,
          cy: 88,
        });
        for (const unit of shoreBlockers) this.recordMove(unit.id, 50, 88);
        reasons.push(`clear east shore (${shoreBlockers.length})`);
      }
    }

    // Send completed destroyers to hunt submarines.
    const playerShips = currentFleet;
    const enemySubs = state.enemies.filter((e) => e.t === 'SS' || e.t === 'MSUB');
    const vesselProduction = state.production.find((p) => p.rtti === RTTI_VESSELTYPE);
    const landArmor = playerUnits.filter(
      (u) => (u.t.includes('TNK') || u.t === 'ARTY') && u.hp > 0 &&
        !this.isReservedScg11eaScout(u, alliedStructures),
    );
    const shipyardOnline = alliedStructures.some((s) => s.t === 'SYRD' || s.t === 'SPEN');
    const navalPhaseStarted = this.scg11eaNavalPhaseStarted(alliedStructures);
    const procCount = alliedStructures.filter((s) => s.t === 'PROC').length;
    const weapCount = alliedStructures.filter((s) => s.t === 'WEAP').length;
    const baseThreats = state.enemies.filter(
      (e) => alliedStructures.some((s) => this.distanceSq(e, s) <= 400),
    );
    const baseGroundThreats = baseThreats.filter((e) => !AIRCRAFT_TYPES.has(e.t) && !NAVAL_COMBAT_TYPES.has(e.t));
    const enemyStructures = state.structures.filter((s) => !s.ally);
    const baseAnchor = alliedStructures.length > 0
      ? this.centroid(alliedStructures as unknown as RAEntity[])
      : { cx: 25, cy: 90 };
    const homeConYard = this.getScg11eaHomeConYard(alliedStructures);
    const scg11eaBootstrapAnchor =
      this.scenario === 'SCG11EA' &&
      homeConYard &&
      !this.scg11eaBootstrapReady(alliedStructures)
        ? { cx: Math.min(127, homeConYard.cx + 8), cy: Math.max(0, homeConYard.cy - 2) }
        : null;
    const scg11eaChainAnchor =
      this.scenario === 'SCG11EA' &&
      homeConYard &&
      !navalPhaseStarted &&
      !this.scg11eaCoastLinkReady(alliedStructures)
        ? { cx: Math.max(0, homeConYard.cx - 4), cy: Math.min(127, homeConYard.cy + 6) }
        : null;
    const defenseAnchor = scg11eaBootstrapAnchor ?? scg11eaChainAnchor ?? baseAnchor;
    const scg11eaHomeReserve = Math.min(
      landArmor.length,
      navalPhaseStarted || enemySubs.length > SCG11EA_STATIC_DEFENSE_MAX_SUBS
        ? SCG11EA_SUB_HUNT_TANK_FLOOR
        : SCG11EA_ASSAULT_RETREAT_FLOOR,
    );
    const armorByBaseDistance = landArmor.slice().sort(
      (a, b) => this.distanceSq(a, baseAnchor) - this.distanceSq(b, baseAnchor),
    );
    const scg11eaExtraHomeReserve = Math.min(
      Math.max(0, landArmor.length - scg11eaHomeReserve),
      baseGroundThreats.length > 0 ? Math.min(3, baseGroundThreats.length + 1) : 0,
    );
    const homeArmor = armorByBaseDistance.slice(0, scg11eaHomeReserve + scg11eaExtraHomeReserve);
    const assaultArmor = armorByBaseDistance.slice(homeArmor.length);

    if (playerShips.length > 0 && enemySubs.length > 0) {
      const fleetCanRecoverSoon =
        shipyardOnline ||
        vesselProduction != null ||
        (state.power.produced > 0 && alliedStructures.some((s) => s.t === 'PROC' || s.t === 'WEAP'));
      const huntPackSize =
        this.scenario === 'SCG11EA'
          ? ((!fleetCanRecoverSoon || playerShips.length <= 2)
            ? Math.max(1, playerShips.length)
            : enemySubs.length >= 7
            ? 3
            : enemySubs.length >= 4
            ? 3
            : enemySubs.length >= 2
            ? 2
            : 1)
          : 1;
      if (this.scenario === 'SCG11EA' && playerShips.length < huntPackSize) {
        let rallying = 0;
        for (const ship of playerShips) {
          if (!this.shouldMove(ship, SCG11EA_FLEET_RALLY_POINT.cx, SCG11EA_FLEET_RALLY_POINT.cy) && !this.isIdle(ship)) continue;
          if (this.distanceSq(ship, SCG11EA_FLEET_RALLY_POINT) <= 36 && !this.isIdle(ship)) continue;
          commands.push({
            cmd: 'move',
            ids: [ship.id],
            cx: SCG11EA_FLEET_RALLY_POINT.cx,
            cy: SCG11EA_FLEET_RALLY_POINT.cy,
          });
          this.recordMove(ship.id, SCG11EA_FLEET_RALLY_POINT.cx, SCG11EA_FLEET_RALLY_POINT.cy);
          rallying++;
        }
        if (rallying > 0) reasons.push(`rally fleet (${playerShips.length}/${huntPackSize})`);
      } else {
      // The harness exposes all enemy submarines, including boats outside current
      // vision. Direct ATTACK orders can stall forever on hidden targets, so drive
      // destroyers with HUNT missions toward the latest known submarine cells.
      // Keep small DD groups massed on one lane; spreading 2-3 destroyers across
      // several subs leaves each boat unsupported and gets them picked off.
      const huntingShips = playerShips.slice().sort((a, b) => a.id - b.id);
      const fleetCenter = this.centroid(huntingShips);
      const sortedSubs = enemySubs.slice().sort((a, b) => {
        const aDist = this.distanceSq(a, fleetCenter);
        const bDist = this.distanceSq(b, fleetCenter);
        if (aDist !== bDist) return aDist - bDist;
        return a.id - b.id;
      });
      const groupTargets = (huntingShips.length <= 3 || enemySubs.length <= 5)
        ? [sortedSubs[0]]
        : sortedSubs.slice(0, Math.min(2, sortedSubs.length));
      let issued = 0;
      for (let i = 0; i < huntingShips.length; i++) {
        const ship = huntingShips[i];
        const best = groupTargets[Math.min(i, groupTargets.length - 1)];
        if (!this.shouldMove(ship, best.cx, best.cy) && !this.isIdle(ship)) continue;
        if (this.distanceSq(ship, best) <= 16 && !this.isIdle(ship)) continue;
        commands.push({
          cmd: 'attack_move',
          ids: [ship.id],
          cx: best.cx,
          cy: best.cy,
        });
        this.recordMove(ship.id, best.cx, best.cy);
        issued++;
      }
      if (issued > 0) reasons.push(`hunt subs (${issued}/${playerShips.length} ships → ${enemySubs.length} SS)`);
      }
    } else if (playerShips.length > 0 && enemySubs.length === 0) {
      // No subs visible — spread along the full river corridor so hidden boats
      // at the north/south extremes get found quickly.
      const patrolShips = playerShips.slice().sort((a, b) => a.id - b.id);
      const sweepPhase = Math.floor(state.tick / sec(20));
      for (let i = 0; i < patrolShips.length; i++) {
        const ship = patrolShips[i];
        const patrolTarget = SCG11EA_RIVER_SWEEP_POINTS[
          (sweepPhase + i) % SCG11EA_RIVER_SWEEP_POINTS.length
        ];
        if (!this.isIdle(ship) && !this.shouldMove(ship, patrolTarget.cx, patrolTarget.cy)) continue;
        if (this.distanceSq(ship, patrolTarget) <= 36 && !this.isIdle(ship)) continue;
        commands.push({
          cmd: 'attack_move',
          ids: [ship.id],
          cx: patrolTarget.cx,
          cy: patrolTarget.cy,
        });
        this.recordMove(ship.id, patrolTarget.cx, patrolTarget.cy);
      }
      if (patrolShips.length > 0) reasons.push(`sweep river (${patrolShips.length} ships)`);
    }

    if (homeArmor.length > 0) {
      const holders = homeArmor.filter(
        (u) => this.isIdle(u) || this.distanceSq(u, defenseAnchor) > 144,
      );
      if (holders.length > 0) {
        commands.push({
          cmd: 'move',
          ids: holders.map((u) => u.id),
          cx: defenseAnchor.cx,
          cy: defenseAnchor.cy,
        });
        for (const u of holders) this.recordMove(u.id, defenseAnchor.cx, defenseAnchor.cy);
      }
      if (baseThreats.length > 0) {
        reasons.push(`hold armor (${baseThreats.length} base threats)`);
      }
    }

    // Detect if the island Soviet base is destroyed (no production buildings in x=35-60).
    // Once destroyed: tanks mop up remaining structures, then transition to naval phase.
    const islandProductionTypes = new Set(['WEAP', 'FACT', 'BARR', 'AFLD', 'HPAD', 'KENN', 'STEK']);
    const islandProduction = enemyStructures.filter(
      (s) => s.cx >= 35 && s.cx <= 60 && s.cy >= 35 && s.cy <= 58 && islandProductionTypes.has(s.t),
    );
    const islandBaseDestroyed = islandProduction.length === 0 && state.tick > 5000;
    if (islandBaseDestroyed) {
      // Base destroyed — mop up remaining island structures, then tanks come home
      const remainingIsland = enemyStructures.filter(
        (s) => s.cx >= 35 && s.cx <= 60 && s.cy >= 35 && s.cy <= 58,
      );
      if (remainingIsland.length > 0 && assaultArmor.length >= 3) {
        // Mop up remaining buildings
        const target = remainingIsland[0];
        const movers = assaultArmor.filter((u) => this.isIdle(u) || this.distanceSq(u, target) > 100);
        if (movers.length > 0) {
          commands.push({ cmd: 'attack_move', ids: movers.map((u) => u.id), cx: target.cx, cy: target.cy });
          for (const u of movers) this.recordMove(u.id, target.cx, target.cy);
          reasons.push(`mop up ${target.t} (${movers.length} → ${target.cx},${target.cy})`);
        }
      } else if (assaultArmor.length > 0) {
        // Island fully cleared — continue to eastern structures or come home
        const easternTarget = enemyStructures.filter((s) => s.cx > 60);
        if (easternTarget.length > 0) {
          const target = easternTarget[0];
          commands.push({ cmd: 'attack_move', ids: assaultArmor.map((u) => u.id), cx: target.cx, cy: target.cy });
          for (const u of assaultArmor) this.recordMove(u.id, target.cx, target.cy);
          reasons.push(`push east (${assaultArmor.length} → ${target.cx},${target.cy})`);
        }
      }
      reasons.push('island base DESTROYED');
    }

    const assaultUnlocked =
      navalPhaseStarted &&
      playerShips.length >= SCG11EA_ASSAULT_MIN_SHIPS &&
      enemySubs.length <= SCG11EA_ASSAULT_MAX_SUBS &&
      assaultArmor.length >= SCG11EA_ASSAULT_MIN_ARMOR;
    const assaultActive = this.scg11eaAssaultStarted || assaultUnlocked;
    if (assaultUnlocked) this.scg11eaAssaultStarted = true;
    if (!assaultActive && assaultArmor.length > 0) {
      const stageArmor = assaultArmor.filter(
        (u) => this.isIdle(u) || this.distanceSq(u, defenseAnchor) > 196,
      );
      if (stageArmor.length > 0) {
        commands.push({
          cmd: 'move',
          ids: stageArmor.map((u) => u.id),
          cx: defenseAnchor.cx,
          cy: defenseAnchor.cy,
        });
        for (const u of stageArmor) this.recordMove(u.id, defenseAnchor.cx, defenseAnchor.cy);
        reasons.push(`stage armor (${stageArmor.length})`);
      }
    }
    if (!islandBaseDestroyed && assaultActive && assaultArmor.length > 0) {
      const structTarget = this.chooseScg11eaAssaultTarget(enemyStructures);
      if (structTarget) {
        const retargetDue = (state.tick % 25) < 5;
        const movers = retargetDue ? assaultArmor : assaultArmor.filter(
          (u) => this.isIdle(u) || this.distanceSq(u, structTarget) > 100,
        );
        if (movers.length > 0) {
          commands.push({ cmd: 'attack_move', ids: movers.map((u) => u.id), cx: structTarget.cx, cy: structTarget.cy });
          for (const u of movers) this.recordMove(u.id, structTarget.cx, structTarget.cy);
          reasons.push(`assault ${structTarget.t} (${movers.length} → ${structTarget.cx},${structTarget.cy})`);
        }
      }
    }

    return { commands, reason: reasons.join('; ') };
  }

  private decideScg03ea(state: RAGameState): OracleDecision {
    const commands: Array<Record<string, unknown>> = [];
    const reasons: string[] = [];
    const playerUnits = this.playerOwnedUnits(state);

    const tanya = playerUnits.find((u) => u.t === 'E7');
    const arty = playerUnits.find((u) => u.t === 'ARTY');
    const medics = playerUnits.filter((u) => u.t === 'MEDI');
    const engineer = playerUnits.find((u) => u.t === 'E6');
    const bridges = [SCG03EA_BRIDGE_V04, SCG03EA_BRIDGE_V07];

    if (!tanya) {
      reasons.push('Tanya dead — mission lost');
      return { commands, reason: reasons.join('; ') };
    }

    const tanyaHpFrac = tanya.hp / tanya.mhp;
    const currentBridge = bridges[this.scg03eaBridgeIndex];

    // --- Medics follow Tanya ---
    if (medics.length > 0) {
      const farMedics = medics.filter((m) => this.distanceSq(m, tanya) > 64);
      if (farMedics.length > 0) {
        commands.push({
          cmd: 'move',
          ids: farMedics.map((m) => m.id),
          cx: tanya.cx,
          cy: tanya.cy,
        });
        reasons.push(`medics follow Tanya`);
      }
    }

    // --- ARTY fire support — prioritize V2RL (only real threat) ---
    if (arty) {
      const v2 = state.enemies.find((e) => e.t === 'V2RL');
      const nearbyEnemies = state.enemies.filter(
        (e) => this.distanceSq(e, arty) <= 400,
      );
      if (v2) {
        // V2RL is the #1 priority — it can kill Tanya
        commands.push({ cmd: 'attack', ids: [arty.id], target: v2.id });
        reasons.push('ARTY → V2RL');
      } else if (nearbyEnemies.length > 0) {
        const target = this.nearestEnemy(arty, nearbyEnemies);
        commands.push({ cmd: 'attack', ids: [arty.id], target: target.id });
        reasons.push(`ARTY → ${target.t}`);
      } else {
        // Follow Tanya for support
        commands.push({
          cmd: 'move', ids: [arty.id],
          cx: tanya.cx, cy: tanya.cy,
        });
        reasons.push('ARTY follows');
      }
    }

    // --- Engineer stays near Tanya for support ---
    if (engineer && this.distanceSq(engineer, tanya) > 100) {
      commands.push({
        cmd: 'move',
        ids: [engineer.id],
        cx: tanya.cx,
        cy: tanya.cy,
      });
      reasons.push('engineer follows');
    }

    // --- Tanya: bridge assault state machine ---
    if (this.scg03eaBridgeIndex >= bridges.length) {
      // All bridges blown — hold position, clear nearby threats
      reasons.push('all bridges blown — waiting for victory');
      // Clear nearby threats
      const nearbyThreats = state.enemies.filter(
        (e) => this.distanceSq(e, tanya) <= 144,
      );
      if (nearbyThreats.length > 0) {
        commands.push({
          cmd: 'attack_move',
          ids: [tanya.id],
          cx: nearbyThreats[0].cx,
          cy: nearbyThreats[0].cy,
        });
        reasons.push(`Tanya clears ${nearbyThreats.length} nearby`);
      }
      return { commands, reason: reasons.join('; ') };
    }

    // Retreat if Tanya is hurt — she's the lose condition, be conservative
    if (tanyaHpFrac < 0.5) {
      commands.push({
        cmd: 'move',
        ids: [tanya.id],
        cx: SCG03EA_FALLBACK.cx,
        cy: SCG03EA_FALLBACK.cy,
      });
      reasons.push(`Tanya retreats (${Math.round(tanyaHpFrac * 100)}% HP)`);
      return { commands, reason: reasons.join('; ') };
    }

    // Bridges are template cells — Tanya destroys them by firing at them.
    // attack_move through the bridge position so her guns hit the template.
    // Track bridgeCount from state to know when bridges are actually destroyed.
    const bridgesLeft = state.bridgeCount ?? 99;
    if (bridgesLeft === 0) {
      this.scg03eaBridgeIndex = bridges.length; // all done
      reasons.push('all bridges destroyed (bridgeCount=0)!');
    } else {
      const atBridge = this.distanceSq(tanya, currentBridge) <= 36; // 6 cells
      if (atBridge) {
        // Near bridge — use sabotage (C4) on the bridge hut cell
        commands.push({
          cmd: 'sabotage', ids: [tanya.id],
          cx: currentBridge.cx, cy: currentBridge.cy,
        });
        reasons.push(`Tanya C4 bridge ${this.scg03eaBridgeIndex + 1} (bridges=${bridgesLeft})`);
        // If Tanya goes idle, the sabotage either succeeded or failed
        if (this.isIdle(tanya)) {
          this.scg03eaBridgeIndex++;
        }
      } else {
        // Not at bridge — clear path and advance
        const nearbyInf = state.enemies.filter(
          (e) => isInfantryByType(e.t) && this.distanceSq(e, tanya) <= 144,
        );
        const nearbyVehicles = state.enemies.filter(
          (e) => !isInfantryByType(e.t) && e.t !== 'LST' && this.distanceSq(e, tanya) <= 100,
        );

        if (nearbyVehicles.length > 0 && nearbyInf.length === 0) {
          const awayX = tanya.cx + (tanya.cx - nearbyVehicles[0].cx);
          const awayY = tanya.cy + (tanya.cy - nearbyVehicles[0].cy);
          commands.push({
            cmd: 'move', ids: [tanya.id],
            cx: Math.max(0, Math.min(127, awayX)),
            cy: Math.max(0, Math.min(127, awayY)),
          });
          reasons.push(`Tanya dodges ${nearbyVehicles[0].t}`);
        } else if (nearbyInf.length > 0) {
          const target = this.nearestEnemy(tanya, nearbyInf);
          commands.push({ cmd: 'attack', ids: [tanya.id], target: target.id });
          reasons.push(`Tanya kills ${target.t} (${nearbyInf.length} nearby)`);
        } else {
          commands.push({
            cmd: 'move', ids: [tanya.id],
            cx: currentBridge.cx, cy: currentBridge.cy,
          });
          reasons.push(`Tanya → bridge ${this.scg03eaBridgeIndex + 1}`);
        }
      }
    }

    return { commands, reason: reasons.join('; ') };
  }

  // ── Transport loading/unloading ────────────────────────────────────────────

  /**
   * Generic transport handler: find player-owned transports (LST, TRAN, APC),
   * load nearby idle infantry into them, and unload at destinations.
   * Returns commands + reasons to append to the caller's decision.
   */
  private handleTransports(
    state: RAGameState,
    commands: Array<Record<string, unknown>>,
    reasons: string[],
  ): void {
    const playerUnits = this.playerOwnedUnits(state);
    const transports = playerUnits.filter((u) => TRANSPORT_TYPES.has(u.t));
    if (transports.length === 0) return;

    // Find infantry not already in a transport and not assigned to critical tasks
    const availableInfantry = playerUnits.filter(
      (u) => isInfantryByType(u.t) && this.isIdle(u) &&
        !NON_COMBAT_TYPES.has(u.t),
    );

    for (const transport of transports) {
      const currentCargo = transport.cargo ?? 0;
      if (currentCargo >= TRANSPORT_MAX_PASSENGERS) continue;

      // Find infantry close enough to board
      const nearbyInf = availableInfantry.filter(
        (inf) => this.distanceSq(inf, transport) <= TRANSPORT_BOARD_DISTANCE_SQ,
      );

      const slotsAvailable = TRANSPORT_MAX_PASSENGERS - currentCargo;
      const toBoard = nearbyInf.slice(0, slotsAvailable);

      for (const inf of toBoard) {
        commands.push({
          cmd: 'enter',
          ids: [inf.id],
          target: transport.id,
        });
        reasons.push(`board ${inf.t} → ${transport.t}`);
        // Remove from available pool so we don't double-assign
        const idx = availableInfantry.indexOf(inf);
        if (idx >= 0) availableInfantry.splice(idx, 1);
      }
    }
  }

  /**
   * SCG09EA "Infiltration" transport escape mission.
   *
   * Mission flow:
   * - Player starts with 2 E1 infantry in the south (~37,94)/(44,96).
   * - Sneak north through enemy patrols toward the enemy base.
   * - Trigger conditions cause a TRAN (chinook) to arrive for evacuation.
   * - Load all units into the chinook, move it to the southern map edge.
   * - Win condition fires when transport reaches the escape point.
   *
   * Before the transport arrives: carefully advance infantry northward,
   * avoiding combat where possible. Once the transport appears: load
   * everyone in and move to the escape point.
   */
  private decideTransportEscape(state: RAGameState): OracleDecision {
    const commands: Array<Record<string, unknown>> = [];
    const reasons: string[] = [];
    const playerUnits = this.playerOwnedUnits(state);
    const infantry = playerUnits.filter((u) => isInfantryByType(u.t));
    const transport = playerUnits.find((u) => TRANSPORT_TYPES.has(u.t));

    if (transport) {
      this.scg09eaTransportSeen = true;
    }

    // --- Phase: Transport has arrived — load and escape ---
    if (transport && this.scg09eaTransportSeen) {
      const currentCargo = transport.cargo ?? 0;
      const allLoaded = infantry.length === 0 || currentCargo >= infantry.length;

      if (allLoaded) {
        // Everyone aboard (or no infantry left) — move transport to escape point
        if (this.distanceSq(transport, SCG09EA_ESCAPE_POINT) > 4) {
          commands.push({
            cmd: 'move',
            ids: [transport.id],
            cx: SCG09EA_ESCAPE_POINT.cx,
            cy: SCG09EA_ESCAPE_POINT.cy,
          });
          reasons.push(`escape → (${SCG09EA_ESCAPE_POINT.cx},${SCG09EA_ESCAPE_POINT.cy})`);
        } else {
          reasons.push('transport at escape point — waiting for win');
        }
      } else {
        // Load infantry into the transport
        for (const inf of infantry) {
          if (this.distanceSq(inf, transport) <= TRANSPORT_BOARD_DISTANCE_SQ) {
            commands.push({
              cmd: 'enter',
              ids: [inf.id],
              target: transport.id,
            });
            reasons.push(`board ${inf.t} → ${transport.t}`);
          } else {
            // Move infantry toward the transport
            commands.push({
              cmd: 'move',
              ids: [inf.id],
              cx: transport.cx,
              cy: transport.cy,
            });
            reasons.push(`${inf.t} → transport`);
          }
        }

        // Keep transport stationary while loading (unless under fire)
        const nearbyThreats = state.enemies.filter(
          (e) => this.distanceSq(e, transport) <= 144,
        );
        if (nearbyThreats.length > 0) {
          // Under fire — move transport away from threats
          const threat = nearbyThreats[0];
          const dx = transport.cx - threat.cx;
          const dy = transport.cy - threat.cy;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          commands.push({
            cmd: 'move',
            ids: [transport.id],
            cx: Math.round(transport.cx + (dx / len) * 5),
            cy: Math.round(transport.cy + (dy / len) * 5),
          });
          reasons.push('transport evades threat');
        }
      }

      return {
        commands: this.dedupeCommands(commands),
        reason: reasons.join('; ') || 'transport escape — waiting',
      };
    }

    // --- Phase: No transport yet — sneak infantry forward ---
    // Advance infantry northward (lower cy values), avoiding enemies where possible
    if (infantry.length > 0) {
      const nearbyEnemies = state.enemies.filter(
        (e) => infantry.some((inf) => this.distanceSq(inf, e) <= 144), // 12 cells
      );

      if (nearbyEnemies.length > 0) {
        // Enemies nearby — evade: move perpendicular to threats
        for (const inf of infantry) {
          const nearestThreat = this.nearestEnemy(inf, nearbyEnemies);
          const dx = inf.cx - nearestThreat.cx;
          const dy = inf.cy - nearestThreat.cy;
          // Flee perpendicular + slightly north
          const perpX = inf.id % 2 === 0 ? -dy : dy;
          const perpY = -Math.abs(dx); // bias northward
          const len = Math.sqrt(perpX * perpX + perpY * perpY) || 1;
          commands.push({
            cmd: 'move',
            ids: [inf.id],
            cx: Math.max(0, Math.min(127, Math.round(inf.cx + (perpX / len) * 5))),
            cy: Math.max(0, Math.min(127, Math.round(inf.cy + (perpY / len) * 5))),
          });
        }
        reasons.push(`evade ${nearbyEnemies.length} enemies`);
      } else if (this.isIdle(infantry[0])) {
        // No enemies — advance north toward enemy base area
        // Head toward the ent1 trigger cells around (48,36) to trigger events
        const advanceTarget: Point = { cx: 48, cy: 36 };
        for (const inf of infantry) {
          commands.push({
            cmd: 'move',
            ids: [inf.id],
            cx: advanceTarget.cx,
            cy: advanceTarget.cy,
          });
        }
        reasons.push(`advance → (${advanceTarget.cx},${advanceTarget.cy})`);
      } else {
        reasons.push('sneaking...');
      }
    } else {
      reasons.push('no infantry — waiting for transport');
    }

    return {
      commands: this.dedupeCommands(commands),
      reason: reasons.join('; ') || 'infiltration — waiting',
    };
  }

  private playerOwnedUnits(state: RAGameState): RAEntity[] {
    if (!state.playerHouse) {
      return state.units;
    }
    const owned = state.units.filter((u) => u.house === state.playerHouse);
    return owned.length > 0 ? owned : state.units;
  }

  /**
   * Dispatch minelayers to lay defensive mines along approach-path waypoints.
   * Workflow per waypoint: move → arrive → deploy → advance to next waypoint.
   */
  private dispatchMinelayers(
    playerUnits: RAEntity[],
    baseRef: Point | undefined,
    commands: Array<Record<string, unknown>>,
    reasons: string[],
  ): void {
    const minelayers = playerUnits.filter(
      (u) => u.t === 'MNLY' && (u.ammo ?? 0) > 0,
    );
    for (const mnly of minelayers) {
      if (this.mineWaypointIndex >= MINE_WAYPOINTS.length) {
        // All waypoints visited — minelayer returns to guard near base
        if (baseRef && this.isIdle(mnly) && this.distanceSq(mnly, baseRef) > 36) {
          commands.push({
            cmd: 'move',
            ids: [mnly.id],
            cx: baseRef.cx,
            cy: baseRef.cy,
          });
          reasons.push('MNLY returns to base');
        }
        break;
      }

      const wp = MINE_WAYPOINTS[this.mineWaypointIndex];
      const atWaypoint = this.distanceSq(mnly, wp) <= 4; // within ~2 cells

      if (atWaypoint && mnly.m !== MISSION_UNLOAD) {
        // At waypoint and not currently deploying — lay mine
        commands.push({ cmd: 'deploy', ids: [mnly.id] });
        this.minesLaid++;
        this.mineDeployPending = false;
        this.mineWaypointIndex++;
        reasons.push(`MNLY deploys mine #${this.minesLaid} at (${wp.cx},${wp.cy})`);
      } else if (atWaypoint) {
        // Currently deploying — wait for completion
        reasons.push(`MNLY deploying at wp${this.mineWaypointIndex}`);
      } else if (!atWaypoint && this.isIdle(mnly)) {
        // Move to next waypoint
        commands.push({
          cmd: 'move',
          ids: [mnly.id],
          cx: wp.cx,
          cy: wp.cy,
        });
        this.mineDeployPending = true;
        reasons.push(`MNLY → mine wp${this.mineWaypointIndex} (${wp.cx},${wp.cy})`);
      } else if (!atWaypoint) {
        // En route — don't interrupt
        reasons.push(`MNLY en route to wp${this.mineWaypointIndex}`);
      }
    }
  }

  private isCombatUnit(unit: RAEntity): boolean {
    return !NON_COMBAT_TYPES.has(unit.t);
  }

  private isIdle(unit: RAEntity): boolean {
    return (
      unit.m === MISSION_SLEEP ||
      unit.m === MISSION_GUARD ||
      unit.m === MISSION_GUARD_AREA
    );
  }

  /**
   * Returns true if a unit should receive a new command.
   * Units busy executing a previous order are left alone to prevent
   * command stuttering. Exceptions: idle units, dead targets, stale commands.
   */
  private shouldRecommand(unit: RAEntity, enemies: RAEntity[]): boolean {
    if (this.isIdle(unit)) return true;
    const last = this.lastUnitTargets.get(unit.id);
    if (!last) return true;
    // Target dead?
    if (!enemies.some(e => e.id === last.targetId)) return true;
    // Cooldown: tanks/vehicles need ~2 seconds (30 ticks) to complete a
    // fire cycle. Infantry/Tanya fire fast — 10 tick cooldown.
    const cooldown = unit.t.includes('TNK') || unit.t === 'ARTY' || unit.t === 'V2RL'
      ? 30 : 10;
    if (this.currentTick - last.tick > cooldown) return true;
    return false;
  }

  /**
   * Check if a unit needs a new move command. Returns false if the unit
   * was recently sent to the same destination (within 60 ticks and 5 cells).
   */
  private shouldMove(unit: RAEntity, cx: number, cy: number): boolean {
    if (this.isIdle(unit)) return true;
    const last = this.lastUnitMoves.get(unit.id);
    if (!last) return true;
    // Same destination (within 5 cells) and recent — don't re-send
    const dx = cx - last.cx;
    const dy = cy - last.cy;
    if (dx * dx + dy * dy <= 25 && this.currentTick - last.tick < 15) {
      return false;
    }
    return true;
  }

  /** Record that we sent a move command to a unit. */
  private recordMove(unitId: number, cx: number, cy: number): void {
    this.lastUnitMoves.set(unitId, { cx, cy, tick: this.currentTick });
  }

  private isScg01eaRescueTriggered(state: RAGameState): boolean {
    return Boolean(state.globals?.includes(1) || state.units.some((u) => u.t === 'EINSTEIN'));
  }

  private pickScg01eaEvacTransport(state: RAGameState): RAEntity | undefined {
    const transports = state.units.filter((u) => u.t === 'TRAN');
    if (transports.length === 0) {
      return undefined;
    }
    const einstein = state.units.find((u) => u.t === 'EINSTEIN');
    const reference = einstein ?? SCG01EA_EVAC_POINT;

    return transports
      .slice()
      .sort((a, b) => {
        const aRank = this.scg01eaTransportRank(a, state.playerHouse);
        const bRank = this.scg01eaTransportRank(b, state.playerHouse);
        if (aRank !== bRank) {
          return aRank - bRank;
        }
        const aDistance = this.distanceSq(a, reference);
        const bDistance = this.distanceSq(b, reference);
        if (aDistance !== bDistance) {
          return aDistance - bDistance;
        }
        const aEvacDistance = this.distanceSq(a, SCG01EA_EVAC_POINT);
        const bEvacDistance = this.distanceSq(b, SCG01EA_EVAC_POINT);
        if (aEvacDistance !== bEvacDistance) {
          return aEvacDistance - bEvacDistance;
        }
        return a.id - b.id;
      })[0];
  }

  private scg01eaTransportRank(transport: RAEntity, playerHouse?: string): number {
    if (transport.house === 'GoodGuy') {
      return 0;
    }
    if (playerHouse && transport.house === playerHouse) {
      return 1;
    }
    if (playerHouse && transport.house && transport.house !== playerHouse) {
      return 2;
    }
    return 3;
  }

  private pickScg02eaStructureTarget(state: RAGameState, from: Point, maxDistanceSq = Infinity): RAStructure | undefined {
    const enemyStructures = state.structures
      .filter((structure) => !structure.ally)
      .filter((structure) => this.distanceSq(structure, from) <= maxDistanceSq)
      .sort((a, b) => {
        const rankDiff = this.scg02eaStructureRank(a) - this.scg02eaStructureRank(b);
        if (rankDiff !== 0) {
          return rankDiff;
        }
        return this.distanceSq(a, from) - this.distanceSq(b, from);
      });
    return enemyStructures[0];
  }

  private pickScg02eaTrapBarrel(state: RAGameState): RAStructure | undefined {
    if (this.scg02eaAssaultIndex > 0) {
      return undefined;
    }

    return state.structures
      .filter((structure) => !structure.ally)
      .filter((structure) => structure.t === 'BARL' || structure.t === 'BRL3')
      .filter((structure) => this.distanceSq(structure, SCG02EA_BARREL_TRAP) <= 9)
      .sort((a, b) => this.distanceSq(a, SCG02EA_BARREL_TRAP) - this.distanceSq(b, SCG02EA_BARREL_TRAP))[0];
  }

  private scg02eaStructureRank(structure: RAStructure): number {
    switch (structure.t) {
      case 'WEAP':
      case 'FACT':
      case 'BARR':
        return 0;
      case 'PROC':
      case 'POWR':
      case 'KENN':
        return 1;
      case 'BARL':
      case 'BRL3':
        return 2;
      default:
        return 3;
    }
  }

  private pickScg02eaEnemyTarget(state: RAGameState, from: Point, maxDistanceSq = Infinity): RAEntity | undefined {
    return state.enemies
      .slice()
      .filter((enemy) => this.distanceSq(enemy, from) <= maxDistanceSq)
      .sort((a, b) => {
        const aRank = this.scg02eaEnemyRank(a);
        const bRank = this.scg02eaEnemyRank(b);
        if (aRank !== bRank) {
          return aRank - bRank;
        }
        return this.distanceSq(a, from) - this.distanceSq(b, from);
      })[0];
  }

  private scg02eaEnemyRank(enemy: RAEntity): number {
    switch (enemy.t) {
      case 'DOG':
        return 0;
      case 'E2':
        return 1;
      case 'HARV':
        return 3;
      default:
        return 2;
    }
  }

  private pickScg02eaRoutePoint(convoyLead: RAEntity): Point {
    for (const point of SCG02EA_CONVOY_ROUTE) {
      if (this.distanceSq(convoyLead, point) > 49) {
        return point;
      }
    }
    return SCG02EA_CONVOY_ROUTE[SCG02EA_CONVOY_ROUTE.length - 1];
  }

  private nearestEnemy(from: RAEntity, enemies: RAEntity[]): RAEntity {
    let best = enemies[0];
    let bestDist = Infinity;
    for (const e of enemies) {
      const d = this.distanceSq(from, e);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    return best;
  }

  private findBase(structures: RAStructure[]): RAStructure {
    return (
      structures.find((s) => s.t === 'FACT') ||
      structures.find((s) => s.t === 'PROC') ||
      structures[0]
    );
  }

  private distanceSq(from: Point, to: Point): number {
    const dx = to.cx - from.cx;
    const dy = to.cy - from.cy;
    return dx * dx + dy * dy;
  }

  private isReservedScg11eaScout(unit: RAEntity, alliedStructures: RAStructure[] = []): boolean {
    if (this.scenario !== 'SCG11EA' || this.waterScoutId < 0 || unit.id !== this.waterScoutId) {
      return false;
    }
    return !alliedStructures.some((s) => s.ally && (s.t === 'SYRD' || s.t === 'SPEN'));
  }

  private dedupeCommands(commands: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const seen = new Set<string>();
    return commands.filter((command) => {
      const key = JSON.stringify(command);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Map unit type name to UnitType enum index (for produce command).
   * Based on defines.h UnitType enum order.
   */
  private vesselNameToTypeId(name: string): number {
    const VESSEL_MAP: Record<string, number> = {
      'SS':   0,  // VESSEL_SS (Submarine)
      'DD':   1,  // VESSEL_DD (Destroyer)
      'CA':   2,  // VESSEL_CA (Cruiser)
      'LST':  3,  // VESSEL_TRANSPORT
      'PT':   4,  // VESSEL_PT (Gunboat)
      'MSUB': 5,  // VESSEL_MISSILESUB
    };
    return VESSEL_MAP[name] ?? -1;
  }

  private unitNameToTypeId(name: string): number {
    const UNIT_MAP: Record<string, number> = {
      '4TNK': 0,  // UNIT_HTANK (Mammoth)
      '3TNK': 1,  // UNIT_MTANK (Heavy)
      '2TNK': 2,  // UNIT_MTANK2 (Medium)
      '1TNK': 3,  // UNIT_LTANK (Light)
      'APC':  4,  // UNIT_APC
      'MNLY': 5,  // UNIT_MINELAYER
      'JEEP': 6,  // UNIT_JEEP
      'HARV': 7,  // UNIT_HARVESTER
      'ARTY': 8,  // UNIT_ARTY
      'MRJ':  9,  // UNIT_MRJ
      'MGG':  10, // UNIT_MGG
      'MCV':  11, // UNIT_MCV
      'V2RL': 12, // UNIT_V2_LAUNCHER
      'TRUK': 13, // UNIT_TRUCK
    };
    return UNIT_MAP[name] ?? -1;
  }

  /**
   * Map infantry type name to InfantryType enum index (for produce command).
   * Based on defines.h InfantryType enum order.
   */
  private infantryNameToTypeId(name: string): number {
    const INFANTRY_MAP: Record<string, number> = {
      'E1':   0,  // INFANTRY_E1 (mini-gun)
      'E2':   1,  // INFANTRY_E2 (grenade)
      'E3':   2,  // INFANTRY_E3 (rocket)
      'E4':   3,  // INFANTRY_E4 (flamethrower)
      'E6':   4,  // INFANTRY_RENOVATOR (engineer)
      'E7':   5,  // INFANTRY_TANYA
      'SPY':  6,  // INFANTRY_SPY
      'THF':  7,  // INFANTRY_THIEF
      'MEDI': 8,  // INFANTRY_MEDIC
      'GNRL': 9,  // INFANTRY_GENERAL
      'DOG':  10, // INFANTRY_DOG
    };
    return INFANTRY_MAP[name] ?? -1;
  }

  // ── Tactical micro-management ──────────────────────────────────────────────

  /**
   * Micro-manage combat units with weapon-type matching and focus fire.
   * Returns commands + reasons to append to the caller's decision.
   */
  private microManage(
    combatUnits: RAEntity[],
    enemies: RAEntity[],
    rallyPoint: Point,
  ): { commands: Array<Record<string, unknown>>; reasons: string[] } {
    const commands: Array<Record<string, unknown>> = [];
    const reasons: string[] = [];

    if (enemies.length === 0 || combatUnits.length === 0) {
      return { commands, reasons };
    }

    // No retreat in micro — all units fight to the death.
    // Retreat is handled at the strategy level only when medics exist.
    const healthy = combatUnits.filter((u) => u.hp > 0);

    if (healthy.length === 0) {
      return { commands, reasons };
    }

    // 2. Infantry scatter — move idle infantry away from enemy tanks
    const enemyTanks = enemies.filter((e) => e.t.includes('TNK'));
    const scatteredIds = new Set<number>();
    if (enemyTanks.length > 0) {
      const scatterCandidates = healthy.filter(
        (u) => isInfantryByType(u.t) && this.isIdle(u) &&
          enemyTanks.some((t) => this.distanceSq(u, t) <= 36), // 6 cells
      );
      for (const inf of scatterCandidates) {
        const nearestTank = this.nearestEnemy(inf, enemyTanks);
        let dx = inf.cx - nearestTank.cx;
        let dy = inf.cy - nearestTank.cy;
        // Fallback direction when infantry is on the same cell as tank
        if (dx === 0 && dy === 0) {
          dx = inf.id % 2 === 0 ? 1 : -1;
          dy = inf.id % 3 === 0 ? 1 : -1;
        }
        // Perpendicular scatter — alternate direction by unit ID
        const perpX = inf.id % 2 === 0 ? -dy : dy;
        const perpY = inf.id % 2 === 0 ? dx : -dx;
        const len = Math.sqrt(perpX * perpX + perpY * perpY) || 1;
        commands.push({
          cmd: 'move',
          ids: [inf.id],
          cx: Math.round(inf.cx + (perpX / len) * 4),
          cy: Math.round(inf.cy + (perpY / len) * 4),
        });
        scatteredIds.add(inf.id);
      }
      if (scatteredIds.size > 0) {
        reasons.push(`micro:scatter ${scatteredIds.size} inf`);
      }
    }

    // 3. Idle-aware filter — only re-command units that need new orders
    // AI advantage: instant retargeting when enemies die — no wasted shots.
    const commandable = healthy.filter(
      (u) => !scatteredIds.has(u.id) && this.shouldRecommand(u, enemies),
    );

    if (commandable.length === 0) {
      return { commands, reasons };
    }

    // 5. Classify commandable units by role
    const antiInfantry: RAEntity[] = [];
    const antiArmor: RAEntity[] = [];
    const general: RAEntity[] = [];

    for (const u of commandable) {
      const role = UNIT_ROLES[u.t] ?? 'general';
      if (role === 'anti_infantry') antiInfantry.push(u);
      else if (role === 'anti_armor') antiArmor.push(u);
      else if (role !== 'non_combat') general.push(u);
    }

    // 5. Classify enemies as infantry vs vehicles
    const infantryTargets = enemies.filter((e) => isInfantryByType(e.t));
    const vehicleTargets = enemies.filter((e) => !isInfantryByType(e.t));

    const fromPoint = this.centroid(commandable);

    // 6. CONCENTRATED FOCUS FIRE — two targets max.
    // ALL anti-armor → one vehicle. ALL anti-infantry → one infantry.
    // General units pile onto the vehicle target (bigger threat).
    // Kill one enemy fast, then move to the next. Dead enemies = 0 DPS.
    const pickTarget = (targets: RAEntity[]): RAEntity | undefined => {
      if (targets.length === 0) return undefined;
      // Priority: lowest HP first (finish kills), then nearest
      return targets.slice().sort((a, b) => {
        if (a.hp < 50 && b.hp >= 50) return -1;
        if (b.hp < 50 && a.hp >= 50) return 1;
        const af = a.hp / a.mhp; const bf = b.hp / b.mhp;
        if (Math.abs(af - bf) > 0.3) return af - bf;
        return this.distanceSq(a, fromPoint) - this.distanceSq(b, fromPoint);
      })[0];
    };

    // V2RLs are #1 threat — long range, can snipe critical buildings.
    // Always kill V2RLs first before any other vehicle.
    const v2Targets = vehicleTargets.filter((e) => e.t === 'V2RL');
    const nonV2Vehicles = vehicleTargets.filter((e) => e.t !== 'V2RL');
    const vehTarget = pickTarget(v2Targets) ?? pickTarget(nonV2Vehicles);
    const infTarget = pickTarget(infantryTargets);

    const recordAttack = (units: RAEntity[], target: RAEntity) => {
      commands.push({ cmd: 'attack', ids: units.map((u) => u.id), target: target.id });
      for (const u of units) {
        this.lastUnitTargets.set(u.id, {
          targetId: target.id, cx: target.cx, cy: target.cy, tick: this.currentTick,
        });
      }
    };

    // Anti-armor → one vehicle (or infantry fallback)
    if (antiArmor.length > 0) {
      const target = vehTarget ?? infTarget;
      if (target) {
        recordAttack(antiArmor, target);
        reasons.push(`micro:aa ${antiArmor.length}→${target.t}`);
      }
    }

    // Anti-infantry → one infantry (or vehicle fallback)
    if (antiInfantry.length > 0) {
      const target = infTarget ?? vehTarget;
      if (target) {
        recordAttack(antiInfantry, target);
        reasons.push(`micro:ai ${antiInfantry.length}→${target.t}`);
      }
    }

    // General → pile onto vehicle target (biggest threat)
    if (general.length > 0) {
      const target = vehTarget ?? infTarget;
      if (target) {
        recordAttack(general, target);
        reasons.push(`micro:gen ${general.length}→${target.t}`);
      }
    }

    return { commands, reasons };
  }

  /**
   * Pick the highest-priority target from a list: damaged first (HP bucket),
   * then nearest to `fromPoint`.
   */
  private pickPriorityTarget(targets: RAEntity[], fromPoint: Point): RAEntity {
    return targets.slice().sort((a, b) => {
      // HP bucket: < 50% = 0 (highest priority), >= 50% = 1
      const aBucket = a.hp / a.mhp < 0.5 ? 0 : 1;
      const bBucket = b.hp / b.mhp < 0.5 ? 0 : 1;
      if (aBucket !== bBucket) return aBucket - bBucket;
      // Then nearest
      return this.distanceSq(a, fromPoint) - this.distanceSq(b, fromPoint);
    })[0];
  }

  /** Average cx/cy of a group of entities. */
  private centroid(entities: RAEntity[]): Point {
    if (entities.length === 0) return { cx: 0, cy: 0 };
    let sx = 0, sy = 0;
    for (const e of entities) { sx += e.cx; sy += e.cy; }
    return { cx: Math.round(sx / entities.length), cy: Math.round(sy / entities.length) };
  }

  private countTypes(entities: RAEntity[]): string {
    const counts: Record<string, number> = {};
    for (const e of entities) {
      counts[e.t] = (counts[e.t] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([t, n]) => `${n}${t}`)
      .join(',') || 'none';
  }
}
