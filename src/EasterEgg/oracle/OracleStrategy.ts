/**
 * OracleStrategy: rule-based strategy for Red Alert missions driven by the
 * original WASM agent harness.
 *
 * The original harness currently supports unit motion and targeting, but not
 * sidebar production, so this strategy focuses on tactical control only.
 */

import type { RAGameState, RAEntity, RAStructure, RABuildable } from './WasmAdapter';
import { getCoastalCellsFromText } from './mapParser';

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

// RTTIType enum values from C++ defines.h (used for produce/place commands)
const RTTI_BUILDINGTYPE = 6;
const RTTI_UNITTYPE = 29;
const RTTI_INFANTRYTYPE = 14;
const RTTI_VESSELTYPE = 33;

// Ship preference order (best to worst)
const SHIP_PREFERENCE = ['CA', 'DD', 'PT', 'SS'];

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
  private scg02eaAssaultIndex = 0;
  private baseBuildIndex = 0;
  private placementAttempts = 0;
  private lastPlacementTick = 0;
  private syrdPlacementStart = -1;
  private waterScoutId = -1;          // unit sent to scout water for SYRD
  private waterScoutTarget: Point | null = null;  // where the scout is headed
  private syrdPlacementStart = -1;  // placementAttempts value when SYRD grid scan began
  private scg03eaBridgeIndex = 0;  // 0 = first bridge, 1 = second, 2 = done
  private mineWaypointIndex = 0;
  private mineDeployPending = false;  // true when minelayer has arrived and should deploy
  private minesLaid = 0;              // total mines laid so far
  private mcvSpawnTick = 0;           // tick when MCV first appeared
  private mcvDeployAttempts = 0;      // how many times we've tried deploying
  private scg05eaSpyInfiltrated = false;  // true after spy enters WEAP
  private scg05eaSamIndex = 0;           // current SAM target for Tanya
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
      { cx: 22, cy: 85 }, { cx: 24, cy: 84 }, { cx: 20, cy: 86 },
      { cx: 26, cy: 85 }, { cx: 18, cy: 86 }, { cx: 28, cy: 84 },
      { cx: 22, cy: 83 }, { cx: 24, cy: 82 }, { cx: 20, cy: 84 },
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
      state.tick > 100 &&
      this.peakUnits > 0
    ) {
      return 'defeat';
    }

    if ((this.scenario === 'SCG01EA' || this.scenario === 'SCG03EA') && this.sawTanya && state.tick > 240) {
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
      state.tick > 200 &&
      this.ticksSinceLastEnemy > 3000 &&
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
    if (state.tick < 1500 && playerUnits.length > 0 && !hasConYard && alliedStructures.length === 0) {
      const commands: Array<Record<string, unknown>> = [];
      const reasons: string[] = [];
      const combat = playerUnits.filter(
        (u) => this.isCombatUnit(u) && !BASE_NON_COMBAT_TYPES.has(u.t),
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
        reasons.push(mcvAge > 300 ? `deploy MCV (idle, ${mcvAge} ticks)` : 'deploy MCV');
      } else if (mcvAge > 2000 && this.mcvDeployAttempts === 0) {
        // MCV never became idle — force deploy anyway (might be in non-idle guard state)
        commands.push({ cmd: 'deploy', ids: [mcv.id] });
        this.mcvDeployAttempts++;
        reasons.push(`force deploy MCV (never idle, ${mcvAge} ticks)`);
      } else {
        reasons.push('MCV moving to position...');
      }

      const combatEscorts = playerUnits.filter(
        (u) => u.id !== mcv.id && this.isCombatUnit(u) && !BASE_NON_COMBAT_TYPES.has(u.t),
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

    // Place completed buildings
    if (buildingProduction?.done) {
      const isShipyard = buildingProduction.t === 'SYRD' || buildingProduction.t === 'SPEN';

      if (isShipyard) {
        // SYRD needs water cells that are mapped (explored). Use enemy vessels
        // (submarines, destroyers) to locate water, then scan the shore edge
        // between our base and the water body.
        if (this.syrdPlacementStart < 0) {
          this.syrdPlacementStart = this.placementAttempts;
        }

        // Find water reference from enemy vessels
        const vessels = state.enemies.filter(
          (e) => e.t === 'SS' || e.t === 'DD' || e.t === 'CA' || e.t === 'PT' || e.t === 'MSUB',
        );
        const baseCx = conYard.cx;
        const baseCy = conYard.cy;

        // Build placement candidates: scan a wide grid between base and water.
        // Use vessel centroid to determine water direction, then scan the
        // shoreline area (midpoint between base and vessels, ±15 cells).
        const candidates: Array<{ cx: number; cy: number }> = [];
        if (vessels.length > 0) {
          // Find nearest vessel to base
          let nearest = vessels[0];
          let bestDist = Infinity;
          for (const v of vessels) {
            const d = (v.cx - baseCx) ** 2 + (v.cy - baseCy) ** 2;
            if (d < bestDist) { bestDist = d; nearest = v; }
          }
          // Scan the area between base and nearest vessel, biased toward water.
          // Start at 60% of the way from base to vessel (shore is roughly there)
          // and extend ±10 cells in both axes.
          const midCx = Math.round(baseCx + (nearest.cx - baseCx) * 0.6);
          const midCy = Math.round(baseCy + (nearest.cy - baseCy) * 0.6);
          for (let dy = -10; dy <= 10; dy++) {
            for (let dx = -10; dx <= 10; dx++) {
              candidates.push({ cx: midCx + dx, cy: midCy + dy });
            }
          }
          // Also try directly around the nearest vessel (guaranteed water)
          for (let dy = -5; dy <= 5; dy++) {
            for (let dx = -5; dx <= 5; dx++) {
              candidates.push({ cx: nearest.cx + dx, cy: nearest.cy + dy });
            }
          }
        }
        // Fallback: hardcoded coastal cells + wide scan
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
        // Deduplicate
        const seen = new Set<string>();
        const uniqueCandidates = candidates.filter((c) => {
          const key = `${c.cx},${c.cy}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        if (uniqueCandidates.length > 0) {
          const localIdx = (this.placementAttempts - this.syrdPlacementStart) % uniqueCandidates.length;
          const cell = uniqueCandidates[localIdx];
          commands.push({
            cmd: 'place',
            rtti: RTTI_BUILDINGTYPE,
            cx: cell.cx,
            cy: cell.cy,
          });
          if (state.tick - this.lastPlacementTick > 30) {
            this.placementAttempts++;
            this.lastPlacementTick = state.tick;
          }
          reasons.push(`place ${buildingProduction.t} at (${cell.cx},${cell.cy}) [water ${localIdx}/${uniqueCandidates.length}]`);
        }
      } else {
        // Sort placement offsets by priority:
        // 1. If shipyard is upcoming in build order, bias toward nearest water
        //    (chains build radius toward coast for eventual shipyard placement)
        // 2. Place refineries away from enemies
        // 3. Default offset order
        // For building placement, use the NEAREST allied structure to
        // the water as the reference point (not just ConYard).
        // This chains buildings toward the coast for shipyard placement.
        const coastalCells2 = this.resolveCoastalCells(conYard);
        let placeRef = { cx: conYard.cx, cy: conYard.cy };
        if (coastalCells2 && coastalCells2.length > 0) {
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
        if (coastalCells2 && coastalCells2.length > 0) {
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

        let placeCx: number, placeCy: number;
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
        commands.push({
          cmd: 'place',
          rtti: RTTI_BUILDINGTYPE,
          cx: placeCx,
          cy: placeCy,
        });
        // Cycle through placement offsets on repeated attempts
        if (state.tick - this.lastPlacementTick > 60) {
          this.placementAttempts++;
          this.lastPlacementTick = state.tick;
        }
        reasons.push(`place ${buildingProduction.t} at (${placeCx},${placeCy})`);
      }
    } else if (!buildingProduction && buildable) {
      // Nothing building — find next item in build order
      // Don't reset placementAttempts — keep advancing through offsets
      // so successive buildings don't land on the same cell

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
        for (let i = 0; i < BUILD_ORDER.length; i++) {
          const entry = BUILD_ORDER[i];
          // Check if we already have enough of this building type
          const maxCount = entry.maxCount ?? 1;
          const existingCount = entry.names.reduce(
            (count, n) => count + alliedStructures.filter((s) => s.t === n).length, 0,
          );
          if (existingCount >= maxCount) {
            continue;
          }
          // Find the first buildable alternative from the C++ Can_Build list
          // Note: the C++ Can_Build may return cross-faction buildings (known bug)
          // but the game accepts them, so trust the buildable list
          const buildableIdx = entry.names.findIndex((n) =>
            buildable.structures.includes(n),
          );
          if (buildableIdx >= 0) {
            commands.push({
              cmd: 'produce',
              rtti: RTTI_BUILDINGTYPE,
              type_id: entry.type_ids[buildableIdx],
            });
            reasons.push(`produce ${entry.names[buildableIdx]}`);
            ordered = true;
            break;
          } else {
            // Can't build any alternative yet — prerequisites not met, try next entry
            continue;
          }
        }
        // If build order complete and we have credits, build extra power or defenses
        if (!ordered && this.baseBuildIndex >= BUILD_ORDER.length) {
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

    // Check if we're still saving for a building (don't drain credits)
    const savingForBuilding = buildingProduction != null ||
      (this.baseBuildIndex < BUILD_ORDER.length && !hasWarFactory);
    const minCreditsForInfantry = savingForBuilding ? 1500 : 300;

    // Produce units from War Factory — priority: harvesters > tanks
    // Aim for at least 2 harvesters, or 1 per refinery, whichever is more
    const tankCount = playerUnits.filter((u) => u.t.includes('TNK')).length;
    const harvCount = playerUnits.filter((u) => u.t === 'HARV').length;
    const refCount = alliedStructures.filter((s) => s.t === 'PROC').length;
    const targetHarvesters = Math.max(2, refCount);
    const needHarvester = harvCount < targetHarvesters && buildable?.units.includes('HARV');

    if (hasWarFactory && !unitProduction && buildable) {
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
        // Tank production — first few tanks are critical, lower credit threshold
        const tankCreditThreshold = tankCount < 3 ? 400 : 700;
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
    const hasShipyard = alliedStructures.some(
      (s) => s.t === 'SYRD' || s.t === 'SPEN',
    );
    const vesselProduction = state.production.find(
      (p) => p.rtti === RTTI_VESSELTYPE,
    );
    const enemyNaval = state.enemies.some(
      (e) => e.t === 'SS' || e.t === 'DD' || e.t === 'CA' || e.t === 'PT' || e.t === 'LST',
    );
    if (hasShipyard && !vesselProduction && buildable && enemyNaval && state.credits > 800) {
      const ship = SHIP_PREFERENCE.find((s) => buildable.vessels?.includes(s));
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
    // Send a tank toward water to map cells for shipyard placement.
    // Triggered when SYRD is in production or upcoming in build order.
    const syrdInProd = buildingProduction?.t === 'SYRD' || buildingProduction?.t === 'SPEN';
    const syrdUpcoming = this.baseBuildIndex < BUILD_ORDER.length &&
      BUILD_ORDER.slice(this.baseBuildIndex).some((e) =>
        e.names.includes('SYRD') || e.names.includes('SPEN'));
    if ((syrdInProd || syrdUpcoming) && this.waterScoutId < 0) {
      // Find enemy vessels to determine water direction
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
          (u) => (u.t === '2TNK' || u.t === '1TNK' || u.t === '3TNK') && u.m === 0,
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
    const combatUnits = playerUnits.filter(
      (u) => this.isCombatUnit(u) && !BASE_NON_COMBAT_TYPES.has(u.t),
    );

    // Base center = centroid of all allied structures (not just ConYard)
    const baseCenter = alliedStructures.length > 0
      ? this.centroid(alliedStructures as unknown as RAEntity[])
      : { cx: conYard.cx, cy: conYard.cy };

    // Base threats — enemies near ANY allied structure (20 cell radius)
    const baseThreats = state.enemies.filter(
      (e) => alliedStructures.some((s) => this.distanceSq(e, s) <= 400),
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
        for (const u of critical) this.recordMove(u.id, baseCenter.cx, baseCenter.cy);
        reasons.push(`retreat ${critical.length} to medic`);
      }
    }

    // Fighting force = healthy + walking wounded (everyone except critical)
    const fighters = [...healthy, ...walking_wounded];

    if (fighters.length > 0) {
      // DEFEND FIRST: if base is threatened, send units to deal with threats
      if (baseThreats.length > 0) {
        // How many defenders do we need? Match the threat + buffer
        const threatStr = combatStrength(baseThreats);
        const defendersNeeded = Math.min(fighters.length, Math.ceil(threatStr * 1.5));
        const defenders = fighters.slice(0, defendersNeeded);
        const surplus = fighters.slice(defendersNeeded);

        // Defenders engage base threats. Force retarget if critical structures
        // are threatened (ATEK/PDOX in M8) — override cooldown in emergencies.
        const idleDefenders = defenders.filter((u) => this.isIdle(u));
        const hasCriticalThreats = OracleStrategy.DEFENSE_ONLY_MISSIONS.has(this.scenario) &&
          baseThreats.some((e) => e.t.includes('TNK') || e.t === 'V2RL');
        const retargetDue = hasCriticalThreats || (state.tick % 30) < 5;
        const toCommand = retargetDue ? defenders : idleDefenders;
        if (toCommand.length > 0) {
          const micro = this.microManage(toCommand, baseThreats, baseCenter);
          commands.push(...micro.commands);
          reasons.push(...micro.reasons);
        }
        reasons.push(`defend base (${baseThreats.length} threats, ${defenders.length} def, ${idleDefenders.length} idle)`);

        // In survival mode, ALL units defend — no surplus chasing.
        // In non-survival, surplus attacks nearby enemies within leash range.
        const isTimedSurvival = OracleStrategy.DEFENSE_ONLY_MISSIONS.has(this.scenario) && state.missionTimerActive && state.missionTimer > 0;
        if (isTimedSurvival) {
          // Survival: surplus also helps defend — everyone fights base threats
          if (surplus.length > 0) {
            const surplusMicro = this.microManage(surplus, baseThreats, baseCenter);
            commands.push(...surplusMicro.commands);
            reasons.push(`all defend (survival, ${surplus.length} surplus)`);
          }
        } else {
          const leashSq = 900; // 30 cells
          const nearbyEnemies = state.enemies.filter(
            (e) => this.distanceSq(e, baseCenter) <= leashSq,
          );
          if (surplus.length > 0 && nearbyEnemies.length > 0) {
            const atkMicro = this.microManage(surplus, nearbyEnemies, baseCenter);
            commands.push(...atkMicro.commands);
            reasons.push(`attack nearby ${surplus.length}`);
          } else if (surplus.length > 0) {
            const stray = surplus.filter(
              (u) => this.distanceSq(u, baseCenter) > 225 &&
                this.shouldMove(u, baseCenter.cx, baseCenter.cy),
            );
            if (stray.length > 0) {
              commands.push({
                cmd: 'move',
                ids: stray.map((u) => u.id),
                cx: baseCenter.cx,
                cy: baseCenter.cy,
              });
              for (const u of stray) this.recordMove(u.id, baseCenter.cx, baseCenter.cy);
              reasons.push(`patrol ${stray.length} to base`);
            }
          }
        }
      } else {
        // No base threats — check for unit-proximity engagement first
        // Units should engage enemies near them regardless of full attack threshold
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
          reasons.push(`defend units (${unitThreats.length} threats, ${idleHealthy.length} idle)`);
        } else {
        // No base threats, no unit threats — decide: attack or turtle?
        // If there's a mission timer counting down, this is a survival mission — turtle.
        const isTimedSurvival = OracleStrategy.DEFENSE_ONLY_MISSIONS.has(this.scenario) && state.missionTimerActive && state.missionTimer > 0;
        const tankCount = fighters.filter((u) => u.t.includes('TNK')).length;
        const friendlyStr = combatStrength(fighters);
        const enemyStr = combatStrength(state.enemies);
        const defenseOnly = OracleStrategy.DEFENSE_ONLY_MISSIONS.has(this.scenario);
        const shouldAttack = !isTimedSurvival && !defenseOnly && tankCount >= 6 && friendlyStr > enemyStr * 1.5;

        if (shouldAttack && state.enemies.length > 0) {
          const defenderCount = Math.max(3, Math.floor(fighters.length / 2));
          const defenders = fighters.slice(0, defenderCount);
          const attackers = fighters.slice(defenderCount);
          const leashSq2 = 900; // 30 cells from base

          // Defenders patrol near base (only re-command idle ones)
          const strayDefenders = defenders.filter(
            (u) => this.isIdle(u) && this.distanceSq(u, baseCenter) > 225,
          );
          if (strayDefenders.length > 0) {
            commands.push({
              cmd: 'move',
              ids: strayDefenders.map((u) => u.id),
              cx: baseCenter.cx,
              cy: baseCenter.cy,
            });
            reasons.push(`${strayDefenders.length} defend base`);
          }

          // Attackers only engage enemies within leash range
          const leashEnemies = state.enemies.filter(
            (e) => this.distanceSq(e, baseCenter) <= leashSq2,
          );
          if (attackers.length > 0 && leashEnemies.length > 0) {
            const micro = this.microManage(attackers, leashEnemies, baseCenter);
            commands.push(...micro.commands);
            reasons.push(`attack ${attackers.length} (${tankCount} tanks, leashed)`);
            reasons.push(...micro.reasons);
          } else if (attackers.length > 0) {
            // No enemies in range — all-out push
            const micro = this.microManage(attackers, state.enemies, baseCenter);
            commands.push(...micro.commands);
            reasons.push(`attack ${attackers.length} (${tankCount} tanks)`);
            reasons.push(...micro.reasons);
          }
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
          if (!isTimedSurvival && this.ticksSinceLastEnemy > 150) {
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
          if (this.ticksSinceLastEnemy > 90) {
            const scout = healthy.find((u) => u.t === 'E1' || u.t === 'E3') ?? healthy[0];
            if (scout) {
              const wp = EXPLORE_WAYPOINTS[this.exploreIndex % EXPLORE_WAYPOINTS.length];
              commands.push({ cmd: 'attack_move', ids: [scout.id], cx: wp.cx, cy: wp.cy });
              this.exploreIndex++;
              reasons.push(`scout ${scout.t}`);
            }
          }
        }
        } // close unit-proximity else
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
    const controlled = playerUnits.filter((u) => this.isCombatUnit(u));

    const injured = controlled.filter(
      (u) => u.hp / u.mhp < RETREAT_HP_FRACTION && u.hp > 0,
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

    if (state.enemies.length > 0 && healthy.length > 0) {
      // Estimate force ratio before committing to an attack
      const friendlyStr = combatStrength(healthy);
      const enemyStr = combatStrength(state.enemies);

      const defenseOnly = OracleStrategy.DEFENSE_ONLY_MISSIONS.has(this.scenario);
      if (!defenseOnly && friendlyStr > enemyStr * 1.5) {
        // Strong enough — attack with micro-management
        const rallyPoint = alliedStructures.length > 0
          ? this.findBase(alliedStructures) as Point
          : this.centroid(healthy);
        const micro = this.microManage(healthy, state.enemies, rallyPoint);
        commands.push(...micro.commands);
        reasons.push(`attack ${healthy.length} (${friendlyStr.toFixed(0)} vs ${enemyStr.toFixed(0)})`);
        reasons.push(...micro.reasons);
      } else {
        // Outgunned — send one scout, keep rest defensive
        const scout = healthy.find((u) => u.t === 'E1' || u.t === 'E3') ?? healthy[healthy.length - 1];
        if (scout && (this.ticksSinceLastEnemy > 120 || this.isIdle(scout))) {
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

    if (state.enemies.length === 0 && healthy.length > 0) {
      if (this.ticksSinceLastEnemy > 90 || healthy.some((u) => this.isIdle(u))) {
        // Send one scout, not the whole army
        const scout = healthy.find((u) => u.t === 'E1' || u.t === 'E3') ?? healthy[0];
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

    // Track spy infiltration — once spy disappears after being seen, it infiltrated
    if (!this.scg05eaSpyInfiltrated && !spy && state.tick > 200) {
      if (tanya || state.globals.length > 0) {
        this.scg05eaSpyInfiltrated = true;
      }
    }

    // ─── PHASE 1: Spy infiltration (waypoint-guided north corridor) ─────
    // Spy disembarks at ~(15,50). Shore fix makes y=48 passable BEACH.
    // Route: north to y=48 (avoids patrol dogs at y=50-55), east along
    // y=48 to x≈40 (clear corridor), then south to infiltrate WEAP at (43,50).
    if (spy && !this.scg05eaSpyInfiltrated) {
      const targetWeap = state.structures.find(
        (s) => s.t === 'WEAP' && !s.ally &&
          this.distanceSq(s, SCG05EA_WEAP_TARGET) <= 25,
      );

      // Waypoint routing with dog-clear sprint through y=50.
      // Rock formation at x=22-28, y=48-49 forces a dip south.
      // Dogs patrol y=50-55, so only sprint when the path is clear.
      // Rock formation at x=22-28, y=48-49. Route around via y=50.
      const spyWaypoints: Point[] = [
        { cx: 18, cy: 48 },   // north from peninsula
        { cx: 21, cy: 48 },   // east along y=48 (last cell before rocks)
        { cx: 21, cy: 49 },   // south one step
        { cx: 22, cy: 50 },   // south-east to y=50 (below rocks)
        { cx: 26, cy: 50 },   // east along clear y=50
        { cx: 30, cy: 50 },   // continue east past rocks
        { cx: 30, cy: 48 },   // back north after rock formation
        { cx: 40, cy: 48 },   // east to WEAP approach
      ];

      // Find current waypoint
      let wpIdx = 0;
      for (let i = 0; i < spyWaypoints.length; i++) {
        if (this.distanceSq(spy, spyWaypoints[i]) <= 4) {
          wpIdx = i + 1;
        }
      }

      // At wp2 (sprint zone) — wait for dogs to clear before committing
      // No waiting — just sprint. Dogs patrol through every possible path.
      // The spy's 25 HP may not survive, but waiting means the timer runs out.

      if (targetWeap && (wpIdx >= spyWaypoints.length || this.distanceSq(spy, targetWeap) <= 36)) {
        commands.push({ cmd: 'attack', ids: [spy.id], target: targetWeap.id });
        reasons.push(`spy → infiltrate WEAP (${spy.cx},${spy.cy})`);
      } else if (wpIdx < spyWaypoints.length) {
        const wp = spyWaypoints[wpIdx];
        commands.push({ cmd: 'move', ids: [spy.id], cx: wp.cx, cy: wp.cy });
        reasons.push(`spy wp${wpIdx} → (${wp.cx},${wp.cy})`);
      } else if (targetWeap) {
        commands.push({ cmd: 'attack', ids: [spy.id], target: targetWeap.id });
        reasons.push(`spy → WEAP (${spy.cx},${spy.cy})`);
      } else {
        commands.push({ cmd: 'move', ids: [spy.id], cx: SCG05EA_WEAP_TARGET.cx, cy: SCG05EA_WEAP_TARGET.cy });
        reasons.push('spy → WEAP area');
      }

      return { commands, reason: reasons.join('; ') };
    }

    // ─── PHASE 2: Tanya destroys SAM sites ──────────────────────────────
    if (tanya && this.scg05eaSpyInfiltrated && this.scg05eaSamIndex < SCG05EA_SAM_TARGETS.length) {
      const nearestDog = dogs.length > 0
        ? dogs.reduce((a, b) =>
          this.distanceSq(tanya, a) < this.distanceSq(tanya, b) ? a : b)
        : null;
      const dogDist = nearestDog ? this.distanceSq(tanya, nearestDog) : Infinity;

      if (dogDist <= SCG05EA_DOG_SAFE_DISTANCE_SQ) {
        const dx = tanya.cx - nearestDog!.cx;
        const dy = tanya.cy - nearestDog!.cy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        commands.push({
          cmd: 'move', ids: [tanya.id],
          cx: Math.round(tanya.cx + (dx / len) * 6),
          cy: Math.round(tanya.cy + (dy / len) * 6),
        });
        reasons.push(`Tanya evade dog at (${nearestDog!.cx},${nearestDog!.cy})`);
      } else if (this.isIdle(tanya)) {
        // Tanya spawns at (25,107) near the SAMs — no route needed, just attack
        const samTarget = state.structures.find(
          (s) => s.t === 'SAM' && !s.ally &&
            this.distanceSq(s, SCG05EA_SAM_TARGETS[this.scg05eaSamIndex]) <= 16,
        );

        if (!samTarget) {
          this.scg05eaSamIndex++;
          reasons.push(`SAM ${this.scg05eaSamIndex} destroyed, advancing`);
        } else {
          commands.push({ cmd: 'attack', ids: [tanya.id], target: samTarget.id });
          reasons.push(`Tanya → SAM ${this.scg05eaSamIndex + 1}/${SCG05EA_SAM_TARGETS.length}`);
        }
      } else {
        reasons.push('Tanya en route');
      }

      // Other combat units defend while Tanya works
      const combat = playerUnits.filter(
        (u) => u.id !== tanya.id && this.isCombatUnit(u) && !BASE_NON_COMBAT_TYPES.has(u.t),
      );
      const nearbyEnemies = state.enemies.filter(
        (e) => e.t !== 'DOG' && combat.some((u) => this.distanceSq(u, e) <= 225),
      );
      if (nearbyEnemies.length > 0 && combat.length > 0) {
        const micro = this.microManage(combat, nearbyEnemies, this.centroid(combat));
        commands.push(...micro.commands);
        reasons.push(...micro.reasons);
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
