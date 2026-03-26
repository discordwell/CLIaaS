/**
 * AI strategic subsystem — construction, production, attack groups, defense,
 * retreat, repair, sell, harvesters, autocreate teams, income, base rebuild,
 * and unit/structure spawning for non-player houses.
 * Extracted from Game class (index.ts) to isolate AI opponent logic.
 */

import {
  type WorldPos, type UnitStats, type WeaponStats, type ProductionItem,
  CELL_SIZE, MAP_CELLS, GAME_TICKS_PER_SEC,
  House, Mission, UnitType,
  UNIT_STATS, HOUSE_FACTION,
  type Faction,
} from './types';
import { Entity } from './entity';
import {
  type MapStructure, type TeamType,
  houseIdToHouse, STRUCTURE_WEAPONS, STRUCTURE_SIZE, STRUCTURE_MAX_HP, STRUCTURE_ARMOR, getBibCells,
  applyScenarioOverrides,
} from './scenario';
import { type GameMap, Terrain } from './map';
import { ScenarioRandom } from './random';

// ── Re-export the types that index.ts already defines locally ──────────────

/** AI house strategic state — drives decision-making for non-player houses */
export interface AIHouseState {
  house: House;
  phase: 'economy' | 'buildup' | 'attack';
  /** C++ STATE_BROKE — money < 25, stops construction (house.cpp:4754) */
  broke: boolean;
  /** C++ STATE_ENDGAME — no production buildings left, fire-sale + all-hunt (house.cpp:4749) */
  endgame: boolean;
  productionEnabled: boolean;
  buildQueue: string[];
  lastBuildTick: number;
  buildCooldown: number;
  attackPool: Set<number>;
  attackThreshold: number;
  lastAttackTick: number;
  attackCooldownTicks: number;
  harvesterCount: number;
  refineryCount: number;
  lastBaseAttackTick: number;
  underAttack: boolean;
  incomeMult: number;
  buildSpeedMult: number;
  aggressionMult: number;
  designatedEnemy: House | null;
  preferredTarget: number | null;
  iq: number;
  techLevel: number;
  maxUnit: number;
  maxInfantry: number;
  maxBuilding: number;
  /** C++ Control.MaxVessel — per-house vessel cap (house.h:89) */
  maxVessel: number;
  /** C++ Control.MaxAircraft — per-house aircraft cap (house.h:91) */
  maxAircraft: number;
  /** C++ BuildingsKilled[HOUSE_COUNT] — per-victim kill tracking (house.cpp:498) */
  buildingsKilledBy: Map<House, number>;
  /** C++ UnitsKilled[HOUSE_COUNT] — per-victim kill tracking (house.cpp:496) */
  unitsKilledBy: Map<House, number>;
  /** C++ LAEnemy — house of last attacker (house.h:527) */
  lastAttackerEnemy: House | null;
  /** C++ IsStarted — whether this house has placed its first building */
  isStarted: boolean;
  /** C++ IsAlerted — enables autocreate team spawning (house.cpp:939, house.cpp:988) */
  isAlerted: boolean;
  /** C++ IsBaseBuilding — controls AI base construction (taction.cpp TACTION_BASE_BUILDING) */
  isBaseBuilding: boolean;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

/** AI difficulty modifiers — scale economy, build speed, aggression, and combat stats.
 *  Combat biases mirror C++ house.cpp:282-311 Assign_Handicap / rules.cpp Difficulty_Get.
 *  firepowerBias: outgoing damage multiplier (>1 = more damage)
 *  armorBias: damage resistance multiplier (>1 = less damage taken)
 *  rofBias: rate-of-fire multiplier applied to attackCooldown (<1 = fires faster)
 *  groundspeedBias: ground movement speed multiplier (>1 = faster)
 *  airspeedBias: aircraft speed multiplier — C++ rules.h:49 (separate from groundspeed)
 *  costBias: production cost multiplier — C++ rules.h:52 (1.0 in vanilla RA)
 *  buildSpeedBias: build time multiplier — C++ rules.h:53 (1.0 in vanilla RA) */
export const AI_DIFFICULTY_MODS: Record<Difficulty, {
  incomeMult: number;
  buildSpeedMult: number;
  attackThreshold: number;
  attackCooldown: number;
  productionInterval: number;
  aggressionMult: number;
  retreatHpPercent: number;
  /** C++ Rule.Diff[handicap].FirepowerBias (house.cpp:289,299) */
  firepowerBias: number;
  /** C++ Rule.Diff[handicap].ArmorBias (house.cpp:292,302) */
  armorBias: number;
  /** C++ Rule.Diff[handicap].ROFBias (house.cpp:293,303) */
  rofBias: number;
  /** C++ Rule.Diff[handicap].GroundspeedBias (house.cpp:290,300) */
  groundspeedBias: number;
  /** C++ Rule.Diff[handicap].AirspeedBias (house.cpp:291,301) — separate from groundspeed */
  airspeedBias: number;
  /** C++ Rule.Diff[handicap].CostBias (house.cpp:294,304) — production cost multiplier */
  costBias: number;
  /** C++ Rule.Diff[handicap].BuildSpeedBias (house.cpp:297,307) — build time multiplier */
  buildSpeedBias: number;
  /** C++ DifficultyClass.RepairDelay — minutes delay before AI initiates repairs */
  repairDelay: number;
  /** C++ DifficultyClass.BuildDelay — minutes delay before AI initiates construction */
  buildDelay: number;
  /** C++ DifficultyClass.IsBuildSlowdown — whether construction slows with multiple factories */
  isBuildSlowdown: boolean;
  /** C++ DifficultyClass.IsWallDestroyer — whether AI targets walls */
  isWallDestroyer: boolean;
  /** C++ DifficultyClass.IsContentScan — whether AI analyzes transport contents */
  isContentScan: boolean;
}> = {
  // Computer on easy gets [Difficult] INI values (C++ reversal: Easy<->Difficult for computer)
  easy:   { incomeMult: 0.7, buildSpeedMult: 1.5, attackThreshold: 8,  attackCooldown: 900,  productionInterval: 90, aggressionMult: 0.6, retreatHpPercent: 0.30, firepowerBias: 0.8, armorBias: 0.8, rofBias: 1.2, groundspeedBias: 0.8, airspeedBias: 0.8, costBias: 1.0, buildSpeedBias: 1.0, repairDelay: 0.05, buildDelay: 0.1, isBuildSlowdown: true, isWallDestroyer: false, isContentScan: false },
  // Computer on normal gets [Normal] INI values
  normal: { incomeMult: 1.0, buildSpeedMult: 1.0, attackThreshold: 6,  attackCooldown: 600,  productionInterval: 60, aggressionMult: 1.0, retreatHpPercent: 0.25, firepowerBias: 1.0, armorBias: 1.0, rofBias: 1.0, groundspeedBias: 1.0, airspeedBias: 1.0, costBias: 1.0, buildSpeedBias: 1.0, repairDelay: 0.02, buildDelay: 0.03, isBuildSlowdown: true, isWallDestroyer: true, isContentScan: true },
  // Computer on hard gets [Easy] INI values (C++ reversal: computer gets player bonuses)
  hard:   { incomeMult: 1.5, buildSpeedMult: 0.7, attackThreshold: 4,  attackCooldown: 400,  productionInterval: 42, aggressionMult: 1.4, retreatHpPercent: 0.15, firepowerBias: 1.2, armorBias: 1.2, rofBias: 0.8, groundspeedBias: 1.2, airspeedBias: 1.2, costBias: 0.8, buildSpeedBias: 0.8, repairDelay: 0.001, buildDelay: 0.001, isBuildSlowdown: false, isWallDestroyer: true, isContentScan: true },
};

/** Structure type -> sprite image name mapping (shared by base rebuild and AI construction) */
export const STRUCTURE_IMAGES: Record<string, string> = {
  FACT: 'fact', POWR: 'powr', APWR: 'apwr', BARR: 'barr', TENT: 'tent',
  WEAP: 'weap', PROC: 'proc', SILO: 'silo', DOME: 'dome', FIX: 'fix',
  GUN: 'gun', SAM: 'sam', HBOX: 'hbox', TSLA: 'tsla', AGUN: 'agun', FTUR: 'ftur',
  GAP: 'gap', PBOX: 'pbox', HPAD: 'hpad', AFLD: 'afld',
  ATEK: 'atek', STEK: 'stek', IRON: 'iron', PDOX: 'pdox', KENN: 'kenn',
  QUEE: 'quee', LAR1: 'lar1', LAR2: 'lar2',
};

/** Difficulty modifiers for queen spawn rate and ant composition */
export const DIFFICULTY_MODS: Record<Difficulty, { spawnInterval: number; maxAnts: number; fireAntChance: number; waveSize: number }> = {
  easy:   { spawnInterval: 45, maxAnts: 15, fireAntChance: 0.15, waveSize: 0.7 },
  normal: { spawnInterval: 30, maxAnts: 20, fireAntChance: 0.33, waveSize: 1.0 },
  hard:   { spawnInterval: 20, maxAnts: 28, fireAntChance: 0.50, waveSize: 1.3 },
};

/**
 * C++ Rule defaults (rules.cpp:240-254) and HouseStaticClass constructor (house.cpp:755-759).
 * Default per-house caps = Rule.XxxMax / 6 (integer division).
 */
const RULE_UNIT_MAX = 500;
const RULE_BUILDING_MAX = 500;
const RULE_INFANTRY_MAX = 500;
const RULE_VESSEL_MAX = 100;
// const RULE_AIRCRAFT_MAX = 100;  // Not used — C++ MaxAircraft uses UnitMax, not AircraftMax!
const CPP_DEFAULT_MAX_UNIT     = Math.floor(RULE_UNIT_MAX / 6);      // 83
const CPP_DEFAULT_MAX_BUILDING = Math.floor(RULE_BUILDING_MAX / 6);  // 83
const CPP_DEFAULT_MAX_INFANTRY = Math.floor(RULE_INFANTRY_MAX / 6);  // 83
const CPP_DEFAULT_MAX_VESSEL   = Math.floor(RULE_VESSEL_MAX / 6);    // 16
const CPP_DEFAULT_MAX_AIRCRAFT = Math.floor(RULE_UNIT_MAX / 6);      // 83 (C++ quirk: uses UnitMax!)

/** C++ rules.ini RepairStep=7, RepairPercent=20% (rules.cpp defaults overridden by rules.ini) */
const REPAIR_STEP = 7;
const REPAIR_PERCENT = 0.20;
const CONDITION_RED = 0.25;

// worldDist import from types is cells-based; we need the same helper
import { worldDist } from './types';

// ── Context interface ─────────────────────────────────────────────────────

export interface AIContext {
  // Core game state
  entities: Entity[];
  entityById: Map<number, Entity>;
  structures: MapStructure[];
  map: GameMap;
  tick: number;
  playerHouse: House;
  scenarioId: string;
  difficulty: Difficulty;

  // AI state
  aiStates: Map<House, AIHouseState>;
  houseCredits: Map<House, number>;
  houseIQs: Map<House, number>;
  houseTechLevels: Map<House, number>;
  houseMaxUnits: Map<House, number>;
  houseMaxInfantry: Map<House, number>;
  houseMaxBuildings: Map<House, number>;
  /** C++ Control.MaxVessel from scenario INI (house.cpp:7144) */
  houseMaxVessels?: Map<House, number>;
  /** C++ Control.MaxAircraft — not loaded from INI in vanilla RA, uses compiled default */
  houseMaxAircraft?: Map<House, number>;

  // Base rebuild state
  baseBlueprint: Array<{ type: string; cell: number; house: House }>;
  baseRebuildQueue: Array<{ type: string; cell: number; house: House }>;
  baseRebuildCooldown: number;

  // Production data
  scenarioProductionItems: ProductionItem[];
  scenarioUnitStats: Record<string, UnitStats>;
  scenarioWeaponStats: Record<string, WeaponStats>;

  // Attack coordination
  nextWaveId: number;

  // Autocreate
  autocreateEnabled: boolean;
  teamTypes: TeamType[];
  destroyedTeams: Set<number>;
  /** C++ TeamTypeClass::Number — active instance count per team type index */
  autocreateTeamCounts: Map<number, number>;
  waypoints: Map<number, { cx: number; cy: number }>;
  houseEdges: Map<House, string>;

  // Effects (for structure footprint clear)
  effects: Array<{ type: string; x: number; y: number; frame: number; maxFrames: number; size: number; sprite?: string; spriteStart?: number; [k: string]: unknown }>;

  // Callbacks
  isAllied(a: House, b: House): boolean;
  isPlayerControlled(e: Entity): boolean;
  clearStructureFootprint(s: MapStructure): void;
}

// ── Pure helper functions ────────────────────────────────────────────────

/** Count alive structures of a given type for a house */
export function aiCountStructure(ctx: AIContext, house: House, type: string): number {
  let count = 0;
  for (const s of ctx.structures) {
    if (s.alive && s.house === house && s.type === type) count++;
  }
  return count;
}

/** Calculate power produced by a house's structures */
export function aiPowerProduced(ctx: AIContext, house: House): number {
  let power = 0;
  for (const s of ctx.structures) {
    if (!s.alive || s.house !== house) continue;
    if (s.type === 'POWR') power += 100;
    else if (s.type === 'APWR') power += 200;
  }
  return power;
}

/** Calculate power consumed by a house's structures */
export function aiPowerConsumed(ctx: AIContext, house: House): number {
  let power = 0;
  for (const s of ctx.structures) {
    if (!s.alive || s.house !== house) continue;
    switch (s.type) {
      case 'TENT': case 'BARR': power += 20; break;
      case 'WEAP': power += 30; break;
      case 'PROC': power += 30; break;
      case 'DOME': power += 40; break;
      case 'GUN': power += 40; break;
      case 'PBOX': case 'HBOX': power += 15; break;
      case 'TSLA': power += 150; break;
      case 'SAM': power += 20; break;
      case 'AGUN': power += 50; break;
      case 'ATEK': power += 200; break;
      case 'STEK': power += 100; break;
      case 'HPAD': power += 10; break;
      case 'AFLD': power += 30; break;
      case 'GAP': power += 60; break;
      case 'FIX': power += 30; break;
      case 'FTUR': power += 20; break;
      case 'SILO': power += 10; break;
      case 'KENN': power += 10; break;
      case 'SYRD': case 'SPEN': power += 30; break;
      case 'IRON': case 'PDOX': power += 200; break;
      case 'MSLO': power += 100; break;
    }
  }
  return power;
}

/** Check if AI house has a prerequisite structure */
export function aiHasPrereq(ctx: AIContext, house: House, prereq: string): boolean {
  // TENT and BARR are faction barracks — either satisfies an infantry barracks prerequisite
  if (prereq === 'TENT' || prereq === 'BARR') {
    return ctx.structures.some(s => s.alive && s.house === house && (s.type === 'TENT' || s.type === 'BARR'));
  }
  return ctx.structures.some(s => s.alive && s.house === house && s.type === prereq);
}

/** Get centroid of alive structures for an AI house */
export function aiGetBaseCenter(ctx: AIContext, house: House): { cx: number; cy: number } | null {
  let sumX = 0, sumY = 0, count = 0;
  for (const s of ctx.structures) {
    if (!s.alive || s.house !== house) continue;
    const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
    sumX += s.cx + w / 2;
    sumY += s.cy + h / 2;
    count++;
  }
  if (count === 0) return null;
  return { cx: Math.floor(sumX / count), cy: Math.floor(sumY / count) };
}

/** Check if a cell is a factory exit zone (below WEAP/TENT/BARR/PROC) */
export function aiIsFactoryExit(ctx: AIContext, cx: number, cy: number, house: House): boolean {
  const exitTypes = ['WEAP', 'TENT', 'BARR', 'PROC'];
  for (const s of ctx.structures) {
    if (!s.alive || s.house !== house || !exitTypes.includes(s.type)) continue;
    const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
    if (cy === s.cy + h && cx >= s.cx && cx < s.cx + w) return true;
  }
  return false;
}

/** Get staging area for AI house -- base center offset toward nearest enemy */
export function aiStagingArea(ctx: AIContext, house: House): WorldPos | null {
  const center = aiGetBaseCenter(ctx, house);
  if (!center) return null;

  let nearestDist = Infinity;
  let enemyCx = center.cx;
  let enemyCy = center.cy;
  for (const s of ctx.structures) {
    if (!s.alive || ctx.isAllied(s.house, house)) continue;
    const dx = s.cx - center.cx;
    const dy = s.cy - center.cy;
    const dist = dx * dx + dy * dy;
    if (dist < nearestDist) {
      nearestDist = dist;
      enemyCx = s.cx;
      enemyCy = s.cy;
    }
  }

  const dx = enemyCx - center.cx;
  const dy = enemyCy - center.cy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const stageCx = center.cx + Math.round(dx / len * 5);
  const stageCy = center.cy + Math.round(dy / len * 5);

  return {
    x: stageCx * CELL_SIZE + CELL_SIZE / 2,
    y: stageCy * CELL_SIZE + CELL_SIZE / 2,
  };
}

// ── Mutating functions ──────────────────────────────────────────────────

/** Create initial AIHouseState for a house, applying difficulty modifiers */
export function createAIHouseState(ctx: AIContext, house: House): AIHouseState {
  const mods = AI_DIFFICULTY_MODS[ctx.difficulty] ?? AI_DIFFICULTY_MODS.normal;
  return {
    house,
    phase: 'economy',
    broke: false,
    endgame: false,
    productionEnabled: false,
    buildQueue: [],
    lastBuildTick: 0,
    buildCooldown: 0,
    attackPool: new Set(),
    attackThreshold: mods.attackThreshold,
    lastAttackTick: 0,
    attackCooldownTicks: mods.attackCooldown,
    harvesterCount: 0,
    refineryCount: 0,
    lastBaseAttackTick: 0,
    underAttack: false,
    incomeMult: mods.incomeMult,
    buildSpeedMult: mods.buildSpeedMult,
    aggressionMult: mods.aggressionMult,
    designatedEnemy: null,
    preferredTarget: null,
    iq: ctx.houseIQs.get(house) ?? 3,
    techLevel: ctx.houseTechLevels.get(house) ?? 10,
    maxUnit: ctx.houseMaxUnits.get(house) ?? CPP_DEFAULT_MAX_UNIT,
    maxInfantry: ctx.houseMaxInfantry.get(house) ?? CPP_DEFAULT_MAX_INFANTRY,
    maxBuilding: ctx.houseMaxBuildings.get(house) ?? CPP_DEFAULT_MAX_BUILDING,
    maxVessel: (() => {
      // C++ house.cpp:7144-7145: MaxVessel from INI, fallback to MaxUnit if 0
      const v = ctx.houseMaxVessels?.get(house) ?? CPP_DEFAULT_MAX_VESSEL;
      if (v === 0) return ctx.houseMaxUnits.get(house) ?? CPP_DEFAULT_MAX_UNIT;
      return v;
    })(),
    maxAircraft: ctx.houseMaxAircraft?.get(house) ?? CPP_DEFAULT_MAX_AIRCRAFT,
    buildingsKilledBy: new Map(),
    unitsKilledBy: new Map(),
    lastAttackerEnemy: null,
    isStarted: true,
    isAlerted: false,
    isBaseBuilding: false,
  };
}

// ── Urgency-ranked building system (C++ house.cpp:5434-5773 AI_Building) ──

/**
 * C++ UrgencyType enum — determines build priority.
 * Higher urgency wins when multiple candidates compete.
 * Source: house.h UrgencyType enum
 */
export enum UrgencyType {
  URGENCY_NONE     = 0,
  URGENCY_LOW      = 1,
  URGENCY_MEDIUM   = 2,
  URGENCY_HIGH     = 3,
  URGENCY_CRITICAL = 4,
}

/** C++ BuildChoiceClass — pairs a structure type with its urgency */
export interface BuildChoice {
  urgency: UrgencyType;
  structure: string;
}

/**
 * C++ rules.ini AI ratio/limit defaults (rules.cpp:104-121).
 * Ratios are fractions of CurBuildings; limits are hard caps.
 */
export const AI_BUILD_RULES = {
  refineryRatio:  0.16,
  refineryLimit:  4,
  barracksRatio:  0.16,
  barracksLimit:  2,
  warRatio:       0.10,
  warLimit:       2,
  defenseRatio:   0.40,  // rules.ini [AI] DefenseRatio=.4 (rules.cpp default was .5)
  defenseLimit:   40,
  aaRatio:        0.14,
  aaLimit:        10,
  teslaRatio:     0.16,
  teslaLimit:     10,
  helipadRatio:   0.12,
  helipadLimit:   5,
  airstripRatio:  0.12,
  airstripLimit:  5,
  powerSurplus:   50,
  baseSizeAdd:    3,

  // C++ [AI] section timing/production constants (rules.ini lines 223-254)
  /** C++ Rule.AttackInterval — minutes between computer attacks (rules.ini AttackInterval=3) */
  attackInterval: 3,
  /** C++ Rule.AttackDelay — minutes before first attack (rules.ini AttackDelay=5) */
  attackDelay:    5,
  /** C++ Rule.CreditReserve — minimum credits before repair (rules.ini CreditReserve=100) */
  creditReserve:  100,
  /** C++ Rule.InfantryReserve — credits threshold for always-build-infantry (rules.ini InfantryReserve=3000) */
  infantryReserve: 3000,
  /** C++ Rule.InfantryBaseMult — building count multiplier for infantry quantity (rules.ini InfantryBaseMult=1) */
  infantryBaseMult: 1,
  /** C++ Rule.AutocreateTime — minutes between autocreate teams (rules.ini AutocreateTime=5) */
  autocreateTime: 5,
  /** C++ Rule.OreNearScan — cells for single-patch ore scan (rules.ini OreNearScan=6) */
  oreNearScan:    6,
  /** C++ Rule.OreFarScan — cells for new ore patch scan (rules.ini OreFarScan=48) */
  oreFarScan:     48,
  /** C++ Rule.PatrolScan — minutes between patrol scans (rules.ini PatrolScan=.016) */
  patrolScan:     0.016,
  /** C++ Rule.PowerEmergencyFraction — sell threshold for power as fraction (rules.ini PowerEmergency=75%) */
  powerEmergency: 0.75,
  /** C++ Rule.PathDelay — minutes between retrying when path is blocked (rules.ini PathDelay=.01) */
  pathDelay:      0.01,
  /** C++ Rule.IsCompEasyBonus — computer gets easy-mode bonus in multi-human games (rules.ini CompEasyBonus=yes) */
  compEasyBonus:  true,
  /** C++ Rule.IsComputerParanoid — computer players ally against humans when losing (rules.ini Paranoid=yes) */
  paranoid:       true,

  // C++ [General] section constants (rules.ini lines 8-125)
  /** C++ Rule.BridgeStrength — random roll ceiling for bridge damage chance (rules.ini [General] BridgeStrength=1000) */
  bridgeStrength: 1000,

  // C++ [IQ] section thresholds — gate AI abilities by IQ level (rules.ini lines 269-280)
  /** C++ Rule.MaxIQ — maximum number of discrete IQ levels (rules.ini MaxIQLevels=5) */
  maxIQLevels:    5,
  /** C++ Rule.IQSuperWeapons — IQ level for auto-firing super weapons (rules.ini SuperWeapons=4) */
  iqSuperWeapons: 4,
  /** C++ Rule.IQProduction — IQ level for auto production (rules.ini Production=5) */
  iqProduction:   5,
  /** C++ Rule.IQGuardArea — IQ level for guard area mode on new units (rules.ini GuardArea=4) */
  iqGuardArea:    4,
  /** C++ Rule.IQRepairSell — IQ level for repair/sell decisions (rules.ini RepairSell=1) */
  iqRepairSell:   1,
  /** C++ Rule.IQAutoCrush — IQ level for auto-crush (rules.ini AutoCrush=2) */
  iqAutoCrush:    2,
  /** C++ Rule.IQScatter — IQ level for scatter from threats (rules.ini Scatter=3) */
  iqScatter:      3,
  /** C++ Rule.IQContentScan — IQ level for transport content analysis (rules.ini ContentScan=4) */
  iqContentScan:  4,
  /** C++ Rule.IQAircraft — IQ level for auto aircraft replacement (rules.ini Aircraft=4) */
  iqAircraft:     4,
  /** C++ Rule.IQHarvester — IQ level for auto harvester replacement (rules.ini Harvester=2) */
  iqHarvester:    2,
  /** C++ Rule.IQSellBack — IQ level for selling buildings (rules.ini SellBack=2) */
  iqSellBack:     2,
};

/** Count alive enemy aircraft across all non-allied houses (C++ house.cpp:5620-5633) */
export function aiCountEnemyAircraft(ctx: AIContext, house: House): number {
  let count = 0;
  for (const e of ctx.entities) {
    if (!e.alive || e.house === house) continue;
    if (ctx.isAllied(house, e.house)) continue;
    if (e.stats.isAircraft) count++;
  }
  return count;
}

/** Check if any non-allied house has aircraft (C++ AScan check, house.cpp:5622) */
export function aiEnemyHasAircraft(ctx: AIContext, house: House): boolean {
  for (const e of ctx.entities) {
    if (!e.alive || e.house === house) continue;
    if (ctx.isAllied(house, e.house)) continue;
    if (e.stats.isAircraft) return true;
  }
  return false;
}

/** Count all alive structures for a house (used as CurBuildings in C++) */
export function aiCountAllStructures(ctx: AIContext, house: House): number {
  let count = 0;
  for (const s of ctx.structures) {
    if (s.alive && s.house === house) count++;
  }
  return count;
}

/** C++ Round_Up equivalent — round to nearest integer, but at least 1 for positive inputs */
function roundUp(value: number): number {
  return Math.max(1, Math.ceil(value));
}

/** Power fraction >= 1 means power >= drain (C++ Power_Fraction()) */
function powerFractionOk(ctx: AIContext, house: House): boolean {
  const produced = aiPowerProduced(ctx, house);
  const consumed = aiPowerConsumed(ctx, house);
  return consumed === 0 || produced >= consumed;
}

/**
 * Generate priority-ordered build queue for AI house using urgency-ranked scoring.
 *
 * C++ parity: house.cpp:5434-5773 AI_Building()
 * Each candidate building type is scored with an UrgencyType. Multiple candidates
 * accumulate, then they are sorted by urgency (highest first). The caller pops
 * items from the front of the returned array.
 *
 * Key differences from the old sequential system:
 * - Uses ratio/limit params from rules.ini defaults
 * - APWR preferred over POWR when available
 * - AA defense only when enemy has aircraft
 * - Kennel (max 1), Gap Generator (max 1)
 * - Tesla requires power fraction >= 1
 * - Tech center max 1, requires power
 * - Helipad/Airstrip ratio-based, urgency boosted by enemy aircraft count
 */
export function getAIBuildOrder(ctx: AIContext, house: House, _state: AIHouseState): string[] {
  const choices: BuildChoice[] = [];
  const faction: Faction = HOUSE_FACTION[house] ?? 'both';
  const money = ctx.houseCredits.get(house) ?? 0;
  const produced = aiPowerProduced(ctx, house);
  const consumed = aiPowerConsumed(ctx, house);
  const curBuildings = aiCountAllStructures(ctx, house);
  const refineryCount = aiCountStructure(ctx, house, 'PROC');
  const hasIncome = refineryCount > 0 && _state.harvesterCount > 0;
  const rules = AI_BUILD_RULES;

  // ── Power (C++ house.cpp:5482-5496) ──
  // Try APWR first, fallback to POWR. Urgency: MEDIUM if has refinery, LOW if not.
  if (produced <= consumed + rules.powerSurplus) {
    const powerUrgency = refineryCount === 0 ? UrgencyType.URGENCY_LOW : UrgencyType.URGENCY_MEDIUM;
    // Prefer APWR if faction can build it (allied or both with tech)
    if (faction !== 'soviet' && aiHasPrereq(ctx, house, 'POWR')) {
      choices.push({ urgency: powerUrgency, structure: 'APWR' });
    } else {
      choices.push({ urgency: powerUrgency, structure: 'POWR' });
    }
  }

  // ── Refinery (C++ house.cpp:5501-5510) ──
  // Uses RefineryRatio * CurBuildings, capped by RefineryLimit
  {
    const current = refineryCount;
    if (current < roundUp(rules.refineryRatio * curBuildings) && current < rules.refineryLimit) {
      if (money > 2000 || hasIncome) {
        const urgency = current === 0 ? UrgencyType.URGENCY_HIGH : UrgencyType.URGENCY_MEDIUM;
        choices.push({ urgency, structure: 'PROC' });
      }
    }
  }

  // ── Barracks / Tent (C++ house.cpp:5516-5533) ──
  // Counts both BARR and TENT. Uses BarracksRatio, BarracksLimit.
  {
    const current = aiCountStructure(ctx, house, 'BARR') + aiCountStructure(ctx, house, 'TENT');
    if (current < roundUp(rules.barracksRatio * curBuildings) && current < rules.barracksLimit && (money > 300 || hasIncome)) {
      const urgency = current > 0 ? UrgencyType.URGENCY_LOW : UrgencyType.URGENCY_MEDIUM;
      // Soviet builds BARR, Allied builds TENT
      const barracksType = faction === 'soviet' ? 'BARR' : 'TENT';
      choices.push({ urgency, structure: barracksType });
    }
  }

  // ── Kennel (C++ house.cpp:5537-5547) ──
  // Max 1, soviet only
  if (faction === 'soviet') {
    const current = aiCountStructure(ctx, house, 'KENN');
    if (current < 1 && (money > 300 || hasIncome)) {
      choices.push({ urgency: UrgencyType.URGENCY_MEDIUM, structure: 'KENN' });
    }
  }

  // ── Gap Generator (C++ house.cpp:5552-5561) ──
  // Max 1, requires power fraction >= 1 and income
  if (faction !== 'soviet') {
    const current = aiCountStructure(ctx, house, 'GAP');
    if (current < 1 && powerFractionOk(ctx, house) && hasIncome) {
      choices.push({ urgency: UrgencyType.URGENCY_MEDIUM, structure: 'GAP' });
    }
  }

  // ── War Factory (C++ house.cpp:5567-5576) ──
  // Uses WarRatio, WarLimit. Needs money > 2000 or income.
  {
    const current = aiCountStructure(ctx, house, 'WEAP');
    if (current < roundUp(rules.warRatio * curBuildings) && current < rules.warLimit && (money > 2000 || hasIncome)) {
      const urgency = current > 0 ? UrgencyType.URGENCY_LOW : UrgencyType.URGENCY_MEDIUM;
      choices.push({ urgency, structure: 'WEAP' });
    }
  }

  // ── Base Defense (C++ house.cpp:5580-5608) ──
  // Counts PBOX + HBOX + GUN + FTUR. Uses DefenseRatio, DefenseLimit.
  // Tries FTUR first (soviet), then PBOX/GUN (allied, random choice in C++).
  {
    const current = aiCountStructure(ctx, house, 'PBOX') +
                    aiCountStructure(ctx, house, 'HBOX') +
                    aiCountStructure(ctx, house, 'GUN') +
                    aiCountStructure(ctx, house, 'FTUR');
    if (current < roundUp(rules.defenseRatio * curBuildings) && current < rules.defenseLimit) {
      if (faction === 'soviet') {
        if (money > 600 || hasIncome) {
          choices.push({ urgency: UrgencyType.URGENCY_MEDIUM, structure: 'FTUR' });
        }
      } else {
        // Allied: alternate between PBOX and GUN (C++ uses Percent_Chance(50))
        const defChoice = (current % 2 === 0) ? 'PBOX' : 'GUN';
        if (money > 600 || hasIncome) {
          choices.push({ urgency: UrgencyType.URGENCY_MEDIUM, structure: defChoice });
        }
      }
    }
  }

  // ── AA Defense (C++ house.cpp:5610-5663) ──
  // Only if enemy has aircraft. Uses AARatio, AALimit.
  // Also builds radar (DOME) if needed for AA.
  {
    const current = aiCountStructure(ctx, house, 'SAM') + aiCountStructure(ctx, house, 'AGUN');
    if (current < roundUp(rules.aaRatio * curBuildings) && current < rules.aaLimit) {
      const enemyHasAir = aiEnemyHasAircraft(ctx, house);
      if (enemyHasAir) {
        const enemyAirCount = aiCountEnemyAircraft(ctx, house);

        // Build radar first if we don't have one (C++ house.cpp:5638-5646)
        if (aiCountStructure(ctx, house, 'DOME') === 0) {
          if (money > 1000 || hasIncome) {
            choices.push({ urgency: UrgencyType.URGENCY_HIGH, structure: 'DOME' });
          }
        }

        // Soviet builds SAM, Allied builds AGUN
        const aaType = faction === 'soviet' ? 'SAM' : 'AGUN';
        const aaUrgency = current < enemyAirCount ? UrgencyType.URGENCY_HIGH : UrgencyType.URGENCY_MEDIUM;
        if (money > 750 || hasIncome) {
          choices.push({ urgency: aaUrgency, structure: aaType });
        }
      }
    }
  }

  // ── Tesla Coil (C++ house.cpp:5669-5678) ──
  // Soviet only. Uses TeslaRatio, TeslaLimit. Requires power fraction >= 1.
  if (faction === 'soviet') {
    const current = aiCountStructure(ctx, house, 'TSLA');
    if (current < roundUp(rules.teslaRatio * curBuildings) && current < rules.teslaLimit) {
      if ((money > 1500 || hasIncome) && powerFractionOk(ctx, house)) {
        choices.push({ urgency: UrgencyType.URGENCY_MEDIUM, structure: 'TSLA' });
      }
    }
  }

  // ── Tech Center (C++ house.cpp:5683-5700) ──
  // Max 1 (ATEK + STEK combined). Requires power fraction >= 1.
  {
    const current = aiCountStructure(ctx, house, 'ATEK') + aiCountStructure(ctx, house, 'STEK');
    if (current < 1) {
      const techType = faction === 'soviet' ? 'STEK' : 'ATEK';
      if ((money > 1500 || hasIncome) && powerFractionOk(ctx, house)) {
        choices.push({ urgency: UrgencyType.URGENCY_MEDIUM, structure: techType });
      }
    }
  }

  // ── Helipad (C++ house.cpp:5705-5719) ──
  // Uses HelipadRatio, HelipadLimit. Urgency boosted if enemy has more aircraft.
  {
    const current = aiCountStructure(ctx, house, 'HPAD');
    if (current < roundUp(rules.helipadRatio * curBuildings) && current < rules.helipadLimit) {
      if (money > 1500 || hasIncome) {
        const enemyAirCount = aiCountEnemyAircraft(ctx, house);
        // Count our aircraft
        let ourAircraft = 0;
        for (const e of ctx.entities) {
          if (e.alive && e.house === house && e.stats.isAircraft) ourAircraft++;
        }
        const urgency = ourAircraft < enemyAirCount ? UrgencyType.URGENCY_HIGH : UrgencyType.URGENCY_MEDIUM;
        choices.push({ urgency, structure: 'HPAD' });
      }
    }
  }

  // ── Airstrip (C++ house.cpp:5724-5738) ──
  // Soviet. Uses AirstripRatio, AirstripLimit. Urgency boosted if enemy has more aircraft.
  if (faction === 'soviet') {
    const current = aiCountStructure(ctx, house, 'AFLD');
    if (current < roundUp(rules.airstripRatio * curBuildings) && current < rules.airstripLimit) {
      if (money > 600 || hasIncome) {
        const enemyAirCount = aiCountEnemyAircraft(ctx, house);
        let ourAircraft = 0;
        for (const e of ctx.entities) {
          if (e.alive && e.house === house && e.stats.isAircraft) ourAircraft++;
        }
        const urgency = ourAircraft < enemyAirCount ? UrgencyType.URGENCY_HIGH : UrgencyType.URGENCY_MEDIUM;
        choices.push({ urgency, structure: 'AFLD' });
      }
    }
  }

  // ── Pick highest urgency (C++ house.cpp:5759-5769) ──
  // Sort all choices by urgency descending, return as ordered queue.
  // C++ picks only the single best; we return a sorted list so the caller
  // can fall through if placement fails.
  choices.sort((a, b) => b.urgency - a.urgency);
  return choices.filter(c => c.urgency > UrgencyType.URGENCY_NONE).map(c => c.structure);
}

/** Spiral scan outward from base center to find valid placement for a structure */
export function aiPlaceStructure(ctx: AIContext, house: House, type: string): { cx: number; cy: number } | null {
  const center = aiGetBaseCenter(ctx, house);
  if (!center) return null;

  const [fw, fh] = STRUCTURE_SIZE[type] ?? [1, 1];

  for (let ring = 1; ring <= 6; ring++) {
    const candidates: { cx: number; cy: number; dist: number }[] = [];

    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;

        const cx = center.cx + dx;
        const cy = center.cy + dy;

        if (cx < ctx.map.boundsX || cy < ctx.map.boundsY ||
            cx + fw > ctx.map.boundsX + ctx.map.boundsW ||
            cy + fh > ctx.map.boundsY + ctx.map.boundsH) continue;

        let valid = true;
        for (let fy = 0; fy < fh && valid; fy++) {
          for (let fx = 0; fx < fw && valid; fx++) {
            const t = ctx.map.getTerrain(cx + fx, cy + fy);
            if (t === Terrain.WALL || t === Terrain.WATER) valid = false;
            for (const s of ctx.structures) {
              if (!s.alive) continue;
              const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
              if (cx + fx >= s.cx && cx + fx < s.cx + sw &&
                  cy + fy >= s.cy && cy + fy < s.cy + sh) {
                valid = false;
                break;
              }
            }
          }
        }
        if (!valid) continue;

        let blocksExit = false;
        for (let fy = 0; fy < fh && !blocksExit; fy++) {
          for (let fx = 0; fx < fw && !blocksExit; fx++) {
            if (aiIsFactoryExit(ctx, cx + fx, cy + fy, house)) blocksExit = true;
          }
        }
        if (blocksExit) continue;

        // BP3: Check adjacency to existing house structure
        let adjacent = false;
        for (const s of ctx.structures) {
          if (!s.alive || s.house !== house) continue;
          const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
          const scx = s.cx + sw / 2;
          const scy = s.cy + sh / 2;
          const pcx = cx + fw / 2;
          const pcy = cy + fh / 2;
          if (Math.abs(pcx - scx) <= 2 && Math.abs(pcy - scy) <= 2) {
            adjacent = true;
            break;
          }
        }
        if (!adjacent) continue;

        const dist = dx * dx + dy * dy;
        candidates.push({ cx, cy, dist });
      }
    }

    if (candidates.length > 0) {
      const isDefense = type === 'GUN' || type === 'HBOX' || type === 'TSLA' || type === 'SAM';
      candidates.sort((a, b) => isDefense ? b.dist - a.dist : a.dist - b.dist);
      return { cx: candidates[0].cx, cy: candidates[0].cy };
    }
  }
  return null;
}

/** Spawn an AI structure: look up image/hp, push to structures[], mark footprint impassable */
export function spawnAIStructure(ctx: AIContext, type: string, house: House, cx: number, cy: number): void {
  const image = STRUCTURE_IMAGES[type] ?? type.toLowerCase();
  const maxHp = STRUCTURE_MAX_HP[type] ?? 256;

  ctx.structures.push({
    type,
    image,
    house,
    cx,
    cy,
    hp: maxHp,
    maxHp,
    armor: STRUCTURE_ARMOR[type] ?? 'wood',
    alive: true,
    rubble: false,
    weapon: STRUCTURE_WEAPONS[type],
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    buildProgress: 0,
  });

  const [fw, fh] = STRUCTURE_SIZE[type] ?? [1, 1];
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      ctx.map.setTerrain(cx + dx, cy + dy, Terrain.WALL);
    }
  }
  // C++ bdata.cpp:3597-3629: Mark bib cells as impassable (1 row below building)
  for (const bc of getBibCells(type, cx, cy)) {
    ctx.map.setTerrain(bc.cx, bc.cy, Terrain.WALL);
  }
}

/** Spawn an AI unit from a factory: find factory, calculate spawn pos, create entity */
export function spawnAIUnit(
  ctx: AIContext,
  house: House,
  unitType: UnitType,
  factoryType: string,
  mission: Mission = Mission.GUARD,
  guardOrigin?: WorldPos,
): Entity | null {
  const isInfantry = factoryType === 'TENT' || factoryType === 'BARR';
  const factory = ctx.structures.find(s =>
    s.alive && s.house === house && (isInfantry ? (s.type === 'TENT' || s.type === 'BARR') : s.type === factoryType)
  );
  if (!factory) return null;

  let sx: number;
  let sy: number;
  if (isInfantry) {
    sx = factory.cx * CELL_SIZE + CELL_SIZE + (ScenarioRandom.float() - 0.5) * 24;
    sy = factory.cy * CELL_SIZE + CELL_SIZE * 2;
  } else {
    sx = factory.cx * CELL_SIZE + CELL_SIZE * 2;
    sy = factory.cy * CELL_SIZE + CELL_SIZE * 2 + CELL_SIZE;
  }

  const unit = new Entity(unitType, house, sx, sy);
  unit.mission = mission;
  if (guardOrigin) {
    unit.guardOrigin = guardOrigin;
  }
  ctx.entities.push(unit);
  ctx.entityById.set(unit.id, unit);
  return unit;
}

/** AI base rebuild -- compare alive structures against blueprint, rebuild missing ones */
export function updateBaseRebuild(ctx: AIContext): void {
  if (ctx.baseBlueprint.length === 0) return;

  let anyIqOk = false;
  for (const [, st] of ctx.aiStates) { if (st.iq >= 2) { anyIqOk = true; break; } }
  if (!anyIqOk) return;

  if (ctx.baseRebuildCooldown > 0) {
    ctx.baseRebuildCooldown--;
    return;
  }

  if (ctx.tick % 75 !== 0) return;

  const aiHousesWithFact = new Set<House>();
  for (const s of ctx.structures) {
    if (s.alive && s.type === 'FACT' && !ctx.isAllied(s.house, ctx.playerHouse)) {
      aiHousesWithFact.add(s.house);
    }
  }
  if (aiHousesWithFact.size === 0) return;

  const aliveSet = new Set<string>();
  for (const s of ctx.structures) {
    if (s.alive) aliveSet.add(`${s.type}:${s.cx},${s.cy}`);
  }

  if (ctx.baseRebuildQueue.length === 0) {
    for (const bp of ctx.baseBlueprint) {
      if (!aiHousesWithFact.has(bp.house)) continue;
      const pos = { cx: bp.cell % MAP_CELLS, cy: Math.floor(bp.cell / MAP_CELLS) };
      const key = `${bp.type}:${pos.cx},${pos.cy}`;
      if (!aliveSet.has(key)) {
        const [fw, fh] = STRUCTURE_SIZE[bp.type] ?? [1, 1];
        let blocked = false;
        for (let dy = 0; dy < fh && !blocked; dy++) {
          for (let dx = 0; dx < fw && !blocked; dx++) {
            for (const s of ctx.structures) {
              if (!s.alive) continue;
              const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
              if (pos.cx + dx >= s.cx && pos.cx + dx < s.cx + sw &&
                  pos.cy + dy >= s.cy && pos.cy + dy < s.cy + sh) {
                blocked = true;
                break;
              }
            }
          }
        }
        if (!blocked) {
          ctx.baseRebuildQueue.push(bp);
        }
      }
    }
    const REBUILD_PRIORITY: Record<string, number> = {
      'POWR': 0, 'APWR': 0,
      'PROC': 1,
      'WEAP': 2, 'TENT': 2, 'BARR': 2,
      'GUN': 3, 'TSLA': 3, 'SAM': 3, 'AGUN': 3, 'PBOX': 3, 'HBOX': 3, 'FTUR': 3,
      'DOME': 4, 'FIX': 4, 'SILO': 4,
      'ATEK': 5, 'STEK': 5, 'HPAD': 5, 'AFLD': 5,
    };
    ctx.baseRebuildQueue.sort((a, b) =>
      (REBUILD_PRIORITY[a.type] ?? 6) - (REBUILD_PRIORITY[b.type] ?? 6)
    );
  }

  if (ctx.baseRebuildQueue.length > 0) {
    const bp = ctx.baseRebuildQueue.shift()!;
    if (!aiHousesWithFact.has(bp.house)) return;

    const aiState = ctx.aiStates.get(bp.house);
    if (aiState && aiState.iq < 2) return;

    const prodItem = ctx.scenarioProductionItems.find(p => p.type === bp.type && p.isStructure);
    if (prodItem) {
      const credits = ctx.houseCredits.get(bp.house) ?? 0;
      if (credits < prodItem.cost) return;
      ctx.houseCredits.set(bp.house, credits - prodItem.cost);
    }

    const pos = { cx: bp.cell % MAP_CELLS, cy: Math.floor(bp.cell / MAP_CELLS) };
    spawnAIStructure(ctx, bp.type, bp.house, pos.cx, pos.cy);

    ctx.baseRebuildCooldown = GAME_TICKS_PER_SEC * 30;
  }
}

/**
 * C++ Fire_Sale() — house.cpp:7322
 * Sell all buildings owned by this house. Returns true if any buildings were sold.
 */
export function aiFireSale(ctx: AIContext, house: House): boolean {
  let sold = false;
  for (const s of ctx.structures) {
    if (!s.alive || s.house !== house) continue;
    // C++ sells back every building: b->Sell_Back(1)
    // In TS, we mark as dead/rubble and give partial refund
    const prodItem = ctx.scenarioProductionItems.find(p => p.type === s.type && p.isStructure);
    if (prodItem) {
      // C++ Fire_Sale → Sell_Back(1) → Refund_Amount: AI (IsHuman=false) gets 100%,
      // no RefundPercent penalty, no health scaling (techno.cpp:5743-5761)
      const refund = prodItem.cost;
      const current = ctx.houseCredits.get(house) ?? 0;
      ctx.houseCredits.set(house, current + refund);
    }
    s.alive = false;
    s.rubble = true;
    ctx.clearStructureFootprint(s);
    sold = true;
  }
  return sold;
}

/**
 * C++ Do_All_To_Hunt() — house.cpp:7354
 * Send all units and infantry of this house on HUNT mission.
 */
export function aiDoAllToHunt(ctx: AIContext, house: House): void {
  for (const e of ctx.entities) {
    if (!e.alive || e.house !== house) continue;
    // C++ removes from team first, then assigns MISSION_HUNT
    e.mission = Mission.HUNT;
  }
}

/**
 * C++ Check_Fire_Sale() — house.cpp:4976
 * Check if AI has lost all production buildings (no ConYard, no Barracks/Tent,
 * no War Factory, no Helipad, no Airstrip). If so, trigger endgame.
 * Per C++: only triggers when State != STATE_ATTACKED and CurBuildings > 0.
 */
export function aiCheckEndgame(ctx: AIContext, house: House): boolean {
  const productionTypes = ['FACT', 'TENT', 'BARR', 'WEAP', 'HPAD', 'AFLD'];
  let hasBuildings = false;
  let hasProductionBuilding = false;
  for (const s of ctx.structures) {
    if (!s.alive || s.house !== house) continue;
    hasBuildings = true;
    if (productionTypes.includes(s.type)) {
      hasProductionBuilding = true;
      break;
    }
  }
  // C++: CurBuildings > 0 && no production buildings => fire sale
  return hasBuildings && !hasProductionBuilding;
}

// ── C++ MAP_CELL_W equivalent — cells per map row (house.cpp:4660) ────────────
const MAP_CELL_W = MAP_CELLS; // 128

/**
 * Record a building kill by `killerHouse` against a building owned by `victimHouse`.
 * C++ parity: techno.cpp:3934 — `source->House->BuildingsKilled[Owner()]++`
 * This is indexed by *victim* house on the *killer*'s state.
 */
export function aiRecordBuildingKill(ctx: AIContext, killerHouse: House, victimHouse: House): void {
  const state = ctx.aiStates.get(killerHouse);
  if (!state) return;
  const prev = state.buildingsKilledBy.get(victimHouse) ?? 0;
  state.buildingsKilledBy.set(victimHouse, prev + 1);
}

/**
 * Record a unit kill by `killerHouse` against a unit owned by `victimHouse`.
 * C++ parity: techno.cpp:3972 — `source->House->UnitsKilled[Owner()]++`
 */
export function aiRecordUnitKill(ctx: AIContext, killerHouse: House, victimHouse: House): void {
  const state = ctx.aiStates.get(killerHouse);
  if (!state) return;
  const prev = state.unitsKilledBy.get(victimHouse) ?? 0;
  state.unitsKilledBy.set(victimHouse, prev + 1);
}

/**
 * Record that `attackerHouse` attacked a building/unit of `myHouse`.
 * C++ parity: building.cpp:1208 — `House->LAEnemy = source->Owner()`
 */
export function aiRecordLastAttacker(ctx: AIContext, myHouse: House, attackerHouse: House): void {
  const state = ctx.aiStates.get(myHouse);
  if (!state) return;
  state.lastAttackerEnemy = attackerHouse;
}

/**
 * Compute multi-factor enemy score for a candidate enemy house.
 * C++ parity: house.cpp:4660-4686 Expert_AI enemy selection.
 *
 * @param myCenter Base center of scoring house (cell coords)
 * @param enemyCenter Base center of candidate enemy (cell coords)
 * @param enemyBuildingsKilledUs How many of *our* buildings the enemy killed
 * @param enemyUnitsKilledUs How many of *our* units the enemy killed
 * @param enemyCurUnits Enemy's current unit count
 * @param myCurUnits Our current unit count
 * @param enemyCurBuildings Enemy's current building count
 * @param myCurBuildings Our current building count
 * @param enemyCurInfantry Enemy's current infantry count
 * @param myCurInfantry Our current infantry count
 * @param isLastAttacker Whether this enemy is our LAEnemy
 */
export function computeEnemyScore(
  myCenter: { cx: number; cy: number },
  enemyCenter: { cx: number; cy: number },
  enemyBuildingsKilledUs: number,
  enemyUnitsKilledUs: number,
  enemyCurUnits: number,
  myCurUnits: number,
  enemyCurBuildings: number,
  myCurBuildings: number,
  enemyCurInfantry: number,
  myCurInfantry: number,
  isLastAttacker: boolean,
): number {
  // C++ house.cpp:4660 — distance component
  // Distance is cell-based Manhattan-ish; C++ uses Distance() which is lepton-based
  // but for scoring purposes we use Euclidean cell distance
  const dx = myCenter.cx - enemyCenter.cx;
  const dy = myCenter.cy - enemyCenter.cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // C++ line 4660-4661: value = ((MAP_CELL_W*2) - Distance(Center, h->Center)) * 2
  let value = (MAP_CELL_W * 2 - dist) * 2;

  // C++ line 4668-4669: kill history
  // Note: in C++ `h->BuildingsKilled[Class->House]` means "how many of MY buildings
  // did house h kill". The array is indexed by victim house on the killer's struct.
  value += enemyBuildingsKilledUs * 5;
  value += enemyUnitsKilledUs;

  // C++ line 4676-4678: relative force size
  value += enemyCurUnits - myCurUnits;
  value += enemyCurBuildings - myCurBuildings;
  value += Math.floor((enemyCurInfantry - myCurInfantry) / 4);

  // C++ line 4684-4686: last attacker bonus
  if (isLastAttacker) {
    value += 100;
  }

  return value;
}

/**
 * Count units, infantry, and buildings for a house.
 * Returns { units, infantry, buildings } counts matching C++ CurUnits/CurInfantry/CurBuildings.
 */
export function aiCountForce(ctx: AIContext, house: House): { units: number; infantry: number; buildings: number } {
  let units = 0, infantry = 0, buildings = 0;
  for (const e of ctx.entities) {
    if (!e.alive || e.house !== house) continue;
    if (e.stats.isInfantry) infantry++;
    else if (!e.stats.isAircraft && !e.stats.isVessel && !e.isAnt) units++;
  }
  for (const s of ctx.structures) {
    if (s.alive && s.house === house) buildings++;
  }
  return { units, infantry, buildings };
}

/**
 * Update designated enemy for all AI houses using C++ multi-factor scoring.
 * C++ parity: house.cpp:4619-4741 Expert_AI enemy selection.
 *
 * Runs every ~60 ticks. For each AI house, evaluates all enemy houses and
 * picks the one with highest composite score as designated enemy.
 *
 * Preconditions (from C++):
 * - House must have at least one alive building (ActiveBScan)
 * - House must have a base center (Center)
 * - Attack state must be 0 (not actively attacking) — we relax this
 *
 * If any enemy house has not started (no buildings), skip enemy selection
 * entirely — ensures accurate distance-based scoring (C++ house.cpp:4639-4642).
 */
export function updateDesignatedEnemy(ctx: AIContext): void {
  if (ctx.tick % 60 !== 0) return;

  for (const [house, state] of ctx.aiStates) {
    // Need a base to compute distances from
    const myCenter = aiGetBaseCenter(ctx, house);
    if (!myCenter) {
      state.designatedEnemy = null;
      continue;
    }

    // Must have at least one alive building (C++ ActiveBScan)
    let hasBuildings = false;
    for (const s of ctx.structures) {
      if (s.alive && s.house === house) { hasBuildings = true; break; }
    }
    if (!hasBuildings) {
      state.designatedEnemy = null;
      continue;
    }

    // C++ line 4606-4611: clear enemy if defeated/allied/no base
    if (state.designatedEnemy != null) {
      const enemyCenter = aiGetBaseCenter(ctx, state.designatedEnemy);
      const isDefeated = enemyCenter == null;
      const isAllied = ctx.isAllied(house, state.designatedEnemy);
      if (isDefeated || isAllied) {
        state.designatedEnemy = null;
      }
    }

    // Compute our force counts
    const myForce = aiCountForce(ctx, house);

    let bestScore = 0; // C++ close = 0
    let bestEnemy: House | null = null;

    for (const [enemyHouse, enemyState] of ctx.aiStates) {
      if (enemyHouse === house) continue;
      if (ctx.isAllied(house, enemyHouse)) continue;

      const enemyCenter = aiGetBaseCenter(ctx, enemyHouse);
      if (!enemyCenter) continue;

      // C++ line 4639-4642: if any enemy hasn't started, abort selection
      if (!enemyState.isStarted) {
        bestEnemy = null;
        break;
      }

      const enemyForce = aiCountForce(ctx, enemyHouse);

      // C++ BuildingsKilled/UnitsKilled: how many of MY stuff did the enemy kill
      // This is tracked on the enemy's state, indexed by victim house
      const enemyBuildingsKilledUs = enemyState.buildingsKilledBy.get(house) ?? 0;
      const enemyUnitsKilledUs = enemyState.unitsKilledBy.get(house) ?? 0;

      const score = computeEnemyScore(
        myCenter,
        enemyCenter,
        enemyBuildingsKilledUs,
        enemyUnitsKilledUs,
        enemyForce.units,
        myForce.units,
        enemyForce.buildings,
        myForce.buildings,
        enemyForce.infantry,
        myForce.infantry,
        state.lastAttackerEnemy === enemyHouse,
      );

      if (score > bestScore) {
        bestScore = score;
        bestEnemy = enemyHouse;
      }
    }

    // Also evaluate non-AI enemy houses (e.g., player)
    // Player doesn't have an aiState, so we check structures/entities directly
    const allHouses = new Set<House>();
    for (const s of ctx.structures) {
      if (s.alive && s.house !== house && !ctx.isAllied(house, s.house)) {
        allHouses.add(s.house);
      }
    }
    for (const e of ctx.entities) {
      if (e.alive && e.house !== house && !ctx.isAllied(house, e.house)) {
        allHouses.add(e.house);
      }
    }

    for (const enemyHouse of allHouses) {
      // Skip if already evaluated as an AI state
      if (ctx.aiStates.has(enemyHouse)) continue;

      const enemyCenter = aiGetBaseCenter(ctx, enemyHouse);
      if (!enemyCenter) continue;

      const enemyForce = aiCountForce(ctx, enemyHouse);

      // For player houses, get kill stats from their perspective — but we don't
      // track player kills in AIHouseState. Use 0 for player kill counts.
      const score = computeEnemyScore(
        myCenter,
        enemyCenter,
        0, // player kill tracking not in AI state
        0,
        enemyForce.units,
        myForce.units,
        enemyForce.buildings,
        myForce.buildings,
        enemyForce.infantry,
        myForce.infantry,
        state.lastAttackerEnemy === enemyHouse,
      );

      if (score > bestScore) {
        bestScore = score;
        bestEnemy = enemyHouse;
      }
    }

    state.designatedEnemy = bestEnemy;
  }
}

/**
 * C++ house.cpp:936-940 — IQ-based auto-enable for base building.
 * If IsBaseBuilding is already true OR the house IQ >= IQProduction (default 5),
 * force-enable IsBaseBuilding, IsStarted, and IsAlerted.
 *
 * This runs every AI tick so high-IQ houses auto-enable without needing triggers.
 * IQProduction default = 5 (rules.cpp:145).
 */
const IQ_PRODUCTION = 5;

export function updateAIIQGates(ctx: AIContext): void {
  for (const [, state] of ctx.aiStates) {
    // C++ house.cpp:936-940:
    //   if (IsBaseBuilding || IQ >= Rule.IQProduction) {
    //     IsBaseBuilding = true; IsStarted = true; IsAlerted = true;
    //   }
    if (state.isBaseBuilding || state.iq >= IQ_PRODUCTION) {
      state.isBaseBuilding = true;
      state.isStarted = true;
      state.isAlerted = true;
      state.productionEnabled = true;
    }
  }
}

/** AI strategic planner -- phase transitions every 150 ticks (~10s) */
export function updateAIStrategicPlanner(ctx: AIContext): void {
  if (ctx.tick % 150 !== 0) return;

  for (const [house, state] of ctx.aiStates) {
    if (state.iq === 0) continue;
    state.harvesterCount = 0;
    state.refineryCount = 0;
    for (const e of ctx.entities) {
      if (e.alive && e.house === house && (e.type === UnitType.V_HARV)) {
        state.harvesterCount++;
      }
    }
    for (const s of ctx.structures) {
      if (s.alive && s.house === house && s.type === 'PROC') {
        state.refineryCount++;
      }
    }

    if (state.underAttack && ctx.tick - state.lastBaseAttackTick > 150) {
      state.underAttack = false;
    }

    // ── C++ dynamic cap increase (house.cpp:4648-4740) ──────────────────
    // Sum enemy CurUnits/CurBuildings/CurInfantry/CurVessels/CurAircraft,
    // divide by enemy count, then raise caps to enemyAvg + 10 if lower.
    {
      let enemyUnits = 0, enemyBuildings = 0, enemyInfantry = 0;
      let enemyVessels = 0, enemyAircraft = 0, enemyCount = 0;

      for (const [otherHouse] of ctx.aiStates) {
        if (otherHouse === house) continue;
        if (ctx.isAllied(house, otherHouse)) continue;
        enemyCount++;
      }
      // Also count player house as enemy if not allied
      if (!ctx.isAllied(house, ctx.playerHouse)) {
        enemyCount++;
      }

      if (enemyCount > 0) {
        // Count entities belonging to non-allied houses
        for (const e of ctx.entities) {
          if (!e.alive) continue;
          if (e.house === house) continue;
          if (ctx.isAllied(house, e.house)) continue;
          if (e.stats.isInfantry) { enemyInfantry++; }
          else if (e.stats.isAircraft) { enemyAircraft++; }
          else if (e.stats.isVessel) { enemyVessels++; }
          else if (!e.isAnt) { enemyUnits++; }
        }
        for (const s of ctx.structures) {
          if (!s.alive) continue;
          if (s.house === house) continue;
          if (ctx.isAllied(house, s.house)) continue;
          enemyBuildings++;
        }

        const avgUnits = Math.floor(enemyUnits / enemyCount);
        const avgBuildings = Math.floor(enemyBuildings / enemyCount);
        const avgInfantry = Math.floor(enemyInfantry / enemyCount);
        const avgVessels = Math.floor(enemyVessels / enemyCount);
        const avgAircraft = Math.floor(enemyAircraft / enemyCount);

        if (state.maxUnit < avgUnits + 10) state.maxUnit = avgUnits + 10;
        if (state.maxBuilding < avgBuildings + 10) state.maxBuilding = avgBuildings + 10;
        if (state.maxInfantry < avgInfantry + 10) state.maxInfantry = avgInfantry + 10;
        if (state.maxVessel < avgVessels + 10) state.maxVessel = avgVessels + 10;
        if (state.maxAircraft < avgAircraft + 10) state.maxAircraft = avgAircraft + 10;
      }
    }

    // ── C++ Expert_AI state machine (house.cpp:4749-4769) ──────────────
    // ENDGAME: no production buildings left → fire-sale + all-hunt
    if (state.endgame) {
      aiFireSale(ctx, house);
      aiDoAllToHunt(ctx, house);
      continue; // Skip normal phase transitions
    }

    // Check for endgame trigger: lost all production buildings
    // C++ Check_Fire_Sale (house.cpp:4976): not in ATTACKED state + has buildings + no factories
    if (!state.underAttack && aiCheckEndgame(ctx, house)) {
      state.endgame = true;
      aiFireSale(ctx, house);
      aiDoAllToHunt(ctx, house);
      continue;
    }

    // BROKE state: money < 25 stops building (house.cpp:4753-4761)
    const money = ctx.houseCredits.get(house) ?? 0;
    if (!state.broke && money < 25) {
      state.broke = true;
    }
    if (state.broke && money >= 25) {
      state.broke = false;
    }

    switch (state.phase) {
      case 'economy': {
        const hasBarracks = aiHasPrereq(ctx, house, 'TENT');
        const hasWeap = aiCountStructure(ctx, house, 'WEAP') > 0;
        const hasPower = aiCountStructure(ctx, house, 'POWR') + aiCountStructure(ctx, house, 'APWR') >= 2;
        if (hasBarracks && hasWeap && hasPower) {
          state.phase = 'buildup';
        }
        break;
      }
      case 'buildup': {
        if (state.attackPool.size >= state.attackThreshold) {
          state.phase = 'attack';
        }
        break;
      }
      case 'attack': {
        if (state.attackPool.size === 0) {
          state.phase = 'buildup';
        }
        break;
      }
    }
  }
}

/** AI base construction -- build new structures from build queue */
export function updateAIConstruction(ctx: AIContext): void {
  // C++ house.cpp:296: BuildDelay from DifficultyClass gates construction frequency.
  // buildDelay is in minutes — converted to ticks as construction interval floor.
  const mods = AI_DIFFICULTY_MODS[ctx.difficulty] ?? AI_DIFFICULTY_MODS.normal;
  const buildInterval = Math.max(90, Math.floor(mods.buildDelay * 60 * GAME_TICKS_PER_SEC));
  if (ctx.tick % buildInterval !== 0) return;

  for (const [house, state] of ctx.aiStates) {
    if (!state.productionEnabled) continue;
    if (state.iq < 1) continue;
    // C++ STATE_BROKE: stop building suggestions (house.cpp:4754-4756)
    if (state.broke) continue;
    // C++ STATE_ENDGAME: no construction in endgame
    if (state.endgame) continue;
    if (aiCountStructure(ctx, house, 'FACT') === 0) continue;

    if (state.maxBuilding >= 0) {
      let buildingCount = 0;
      for (const s of ctx.structures) {
        if (s.alive && s.house === house) buildingCount++;
      }
      if (buildingCount >= state.maxBuilding) continue;
    }

    if (state.buildCooldown > 0) {
      state.buildCooldown--;
      continue;
    }

    const credits = ctx.houseCredits.get(house) ?? 0;
    if (credits <= 0) continue;

    if (state.buildQueue.length === 0) {
      state.buildQueue = getAIBuildOrder(ctx, house, state);
    }
    if (state.buildQueue.length === 0) continue;

    const buildType = state.buildQueue[0];
    const prodItem = ctx.scenarioProductionItems.find(p => p.type === buildType && p.isStructure);
    if (!prodItem) {
      state.buildQueue.shift();
      continue;
    }

    // C++ house.cpp:294,304: CostBias scales production costs per difficulty
    const mods = AI_DIFFICULTY_MODS[ctx.difficulty] ?? AI_DIFFICULTY_MODS.normal;
    const biasedCost = Math.max(1, Math.round(prodItem.cost * mods.costBias));
    if (credits < biasedCost) continue;

    const pos = aiPlaceStructure(ctx, house, buildType);
    if (!pos) {
      state.buildQueue.shift();
      continue;
    }

    ctx.houseCredits.set(house, credits - biasedCost);
    state.buildQueue.shift();

    spawnAIStructure(ctx, buildType, house, pos.cx, pos.cy);
    // C++ house.cpp:297,307: BuildSpeedBias from difficulty multiplies build time
    state.buildCooldown = Math.floor(6 * mods.buildSpeedMult * mods.buildSpeedBias);
    state.lastBuildTick = ctx.tick;
  }
}

/** Weighted production pick based on composition targets */
export function getAIProductionPick(ctx: AIContext, house: House, category: 'infantry' | 'vehicle'): ProductionItem | null {
  const faction = HOUSE_FACTION[house] ?? 'both';
  const prereq = category === 'infantry' ? 'TENT' : 'WEAP';

  const aiTechLevel = ctx.aiStates.get(house)?.techLevel ?? 10;
  const items = ctx.scenarioProductionItems.filter(p =>
    (p.prerequisite === prereq || (category === 'infantry' && p.prerequisite === 'BARR')) &&
    !p.isStructure &&
    (p.faction === 'both' || p.faction === faction) &&
    (p.techLevel === undefined || (p.techLevel >= 0 && p.techLevel <= aiTechLevel)) &&
    (!p.techPrereq || aiHasPrereq(ctx, house, p.techPrereq))
  );

  if (items.length === 0) return null;

  let antiArmor = 0, infantry = 0, total = 0;
  for (const e of ctx.entities) {
    if (!e.alive || e.house !== house || e.isAnt) continue;
    total++;
    if (e.type === UnitType.I_E3 || e.type === UnitType.V_2TNK ||
        e.type === UnitType.V_3TNK || e.type === UnitType.V_4TNK ||
        e.type === UnitType.V_1TNK) {
      antiArmor++;
    }
    if (e.type === UnitType.I_E1 || e.type === UnitType.I_E2) {
      infantry++;
    }
  }

  const antiArmorRatio = total > 0 ? antiArmor / total : 0;
  const infantryRatio = total > 0 ? infantry / total : 0;

  const weighted: { item: ProductionItem; weight: number }[] = items.map(item => {
    let weight = 1;
    const isAntiArmor = item.type === 'E3' || item.type === '2TNK' || item.type === '3TNK' ||
                        item.type === '4TNK' || item.type === '1TNK';
    const isInfantry = item.type === 'E1' || item.type === 'E2';

    if (isAntiArmor && antiArmorRatio < 0.4) weight = 3;
    if (isInfantry && infantryRatio < 0.3) weight = 2;
    if (item.type === 'E6') weight = 0.2;
    if (item.type === 'MEDI') weight = 0.3;
    if (item.type === 'HARV') weight = 0.1;

    return { item, weight };
  });

  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight <= 0) return items[0];
  let roll = ScenarioRandom.float() * totalWeight;
  for (const w of weighted) {
    roll -= w.weight;
    if (roll <= 0) return w.item;
  }
  return items[0];
}

/** Update AI harvester counts and force-produce if needed */
export function updateAIHarvesters(ctx: AIContext): void {
  if (ctx.tick % 60 !== 0) return;

  for (const [house, state] of ctx.aiStates) {
    state.harvesterCount = 0;
    for (const e of ctx.entities) {
      if (e.alive && e.house === house && e.type === UnitType.V_HARV) {
        state.harvesterCount++;
      }
    }
    state.refineryCount = aiCountStructure(ctx, house, 'PROC');

    if (!state.productionEnabled) continue;

    if (state.harvesterCount === 0 && state.refineryCount > 0 &&
        aiCountStructure(ctx, house, 'WEAP') > 0) {
      const credits = ctx.houseCredits.get(house) ?? 0;
      const harvItem = ctx.scenarioProductionItems.find(p => p.type === 'HARV');
      if (harvItem && credits >= harvItem.cost) {
        const unit = spawnAIUnit(ctx, house, UnitType.V_HARV, 'WEAP');
        if (unit) {
          ctx.houseCredits.set(house, credits - harvItem.cost);
        }
      }
    }
  }
}

/** AI attack group management -- accumulate pool and launch coordinated attacks */
export function updateAIAttackGroups(ctx: AIContext): void {
  if (ctx.tick % 120 !== 0) return;

  for (const [house, state] of ctx.aiStates) {
    if (!state.productionEnabled) continue;
    if (state.iq < 2) continue;
    if (state.phase !== 'buildup' && state.phase !== 'attack') continue;

    const staging = aiStagingArea(ctx, house);
    if (!staging) continue;

    for (const e of ctx.entities) {
      if (!e.alive || e.house !== house) continue;
      if (e.type === UnitType.V_HARV) continue;
      if (e.mission !== Mission.AREA_GUARD && e.mission !== Mission.GUARD) continue;
      if (state.attackPool.has(e.id)) continue;
      const dist = worldDist(e.pos, staging);
      if (dist < 8) {
        state.attackPool.add(e.id);
      }
    }

    for (const id of state.attackPool) {
      const e = ctx.entityById.get(id);
      if (!e || !e.alive) state.attackPool.delete(id);
    }

    const effectiveThreshold = Math.max(2, Math.floor(state.attackThreshold / state.aggressionMult));
    const effectiveCooldown = Math.floor(state.attackCooldownTicks / state.aggressionMult);
    if (state.attackPool.size >= effectiveThreshold &&
        ctx.tick - state.lastAttackTick > effectiveCooldown) {
      launchAIAttack(ctx, house, state);
    }
  }
}

/** Pick best attack target for AI house */
export function aiPickAttackTarget(ctx: AIContext, house: House): WorldPos | null {
  const ptState = ctx.aiStates.get(house);
  if (ptState?.preferredTarget != null) {
    const STRUCT_TYPES: Record<number, string> = {
      0: 'ATEK', 1: 'IRON', 2: 'WEAP', 3: 'PDOX', 4: 'PBOX', 5: 'HBOX',
      6: 'DOME', 7: 'GAP', 8: 'GUN', 9: 'AGUN', 10: 'FTUR', 11: 'FACT',
      12: 'PROC', 13: 'SILO', 14: 'HPAD', 15: 'SAM', 16: 'AFLD', 17: 'POWR',
      18: 'APWR', 19: 'STEK', 20: 'HOSP', 21: 'BARR', 22: 'TENT', 23: 'KENN',
      24: 'FIX', 25: 'BIO', 26: 'MISS', 27: 'SYRD', 28: 'SPEN', 29: 'MSLO',
      30: 'FCOM', 31: 'TSLA', 32: 'QUEE', 33: 'LAR1', 34: 'LAR2',
    };
    const prefType = STRUCT_TYPES[ptState.preferredTarget];
    if (prefType) {
      for (const s of ctx.structures) {
        if (!s.alive || ctx.isAllied(s.house, house)) continue;
        if (s.type === prefType) {
          const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
          return { x: (s.cx + w / 2) * CELL_SIZE, y: (s.cy + h / 2) * CELL_SIZE };
        }
      }
    }
  }

  const designated = ptState?.designatedEnemy ?? null;
  const priorities = ['FACT', 'WEAP', 'PROC'];

  // C++ parity: prefer priority structures belonging to designated enemy first
  if (designated != null) {
    for (const type of priorities) {
      for (const s of ctx.structures) {
        if (!s.alive || s.house !== designated) continue;
        if (s.type === type) {
          const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
          return {
            x: (s.cx + w / 2) * CELL_SIZE,
            y: (s.cy + h / 2) * CELL_SIZE,
          };
        }
      }
    }
  }

  // Fallback: any enemy's priority structures
  for (const type of priorities) {
    for (const s of ctx.structures) {
      if (!s.alive || ctx.isAllied(s.house, house)) continue;
      if (s.type === type) {
        const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
        return {
          x: (s.cx + w / 2) * CELL_SIZE,
          y: (s.cy + h / 2) * CELL_SIZE,
        };
      }
    }
  }

  const center = aiGetBaseCenter(ctx, house);
  if (!center) return null;

  let bestDist = Infinity;
  let bestPos: WorldPos | null = null;

  // C++ parity: prefer designated enemy structures, then nearest of any enemy
  if (designated != null) {
    for (const s of ctx.structures) {
      if (!s.alive || s.house !== designated) continue;
      const dx = s.cx - center.cx;
      const dy = s.cy - center.cy;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
        bestPos = { x: (s.cx + w / 2) * CELL_SIZE, y: (s.cy + h / 2) * CELL_SIZE };
      }
    }
    if (bestPos) return bestPos;
  }

  for (const s of ctx.structures) {
    if (!s.alive || ctx.isAllied(s.house, house)) continue;
    const dx = s.cx - center.cx;
    const dy = s.cy - center.cy;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
      bestPos = { x: (s.cx + w / 2) * CELL_SIZE, y: (s.cy + h / 2) * CELL_SIZE };
    }
  }
  if (bestPos) return bestPos;

  for (const e of ctx.entities) {
    if (!e.alive || ctx.isAllied(e.house, house)) continue;
    const dx = e.pos.x / CELL_SIZE - center.cx;
    const dy = e.pos.y / CELL_SIZE - center.cy;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestPos = { x: e.pos.x, y: e.pos.y };
    }
  }

  return bestPos;
}

/** Launch a coordinated AI attack */
export function launchAIAttack(ctx: AIContext, house: House, state: AIHouseState): void {
  const target = aiPickAttackTarget(ctx, house);
  if (!target) return;

  const waveId = ctx.nextWaveId++;
  const rallyTick = ctx.tick + 30;

  for (const id of state.attackPool) {
    const e = ctx.entityById.get(id);
    if (!e || !e.alive) continue;
    e.mission = Mission.HUNT;
    e.moveTarget = target;
    e.waveId = waveId;
    e.waveRallyTick = rallyTick;
  }

  state.lastAttackTick = ctx.tick;
  state.attackPool.clear();
}

/** Recall up to half the attack pool as defenders when base is under attack */
export function aiRecallDefenders(ctx: AIContext, house: House, state: AIHouseState): void {
  const center = aiGetBaseCenter(ctx, house);
  if (!center) return;

  const centerPos = { x: center.cx * CELL_SIZE + CELL_SIZE / 2, y: center.cy * CELL_SIZE + CELL_SIZE / 2 };
  let recalled = 0;
  const maxRecall = Math.ceil(state.attackPool.size / 2);

  for (const id of state.attackPool) {
    if (recalled >= maxRecall) break;
    const e = ctx.entityById.get(id);
    if (!e || !e.alive) continue;
    e.mission = Mission.HUNT;
    e.moveTarget = centerPos;
    state.attackPool.delete(id);
    recalled++;
  }
}

/** AI defense -- detect base attacks and rally defenders */
export function updateAIDefense(ctx: AIContext): void {
  if (ctx.tick % 45 !== 0) return;

  for (const [house, state] of ctx.aiStates) {
    if (!state.underAttack) continue;
    if (state.iq < 2) continue;

    if (state.attackPool.size > 0) {
      aiRecallDefenders(ctx, house, state);
    }

    const center = aiGetBaseCenter(ctx, house);
    if (!center) continue;
    const centerPos = { x: center.cx * CELL_SIZE + CELL_SIZE / 2, y: center.cy * CELL_SIZE + CELL_SIZE / 2 };

    for (const e of ctx.entities) {
      if (!e.alive || e.house !== house) continue;
      if (e.type === UnitType.V_HARV) continue;
      if (e.mission !== Mission.AREA_GUARD && e.mission !== Mission.GUARD) continue;
      const dist = worldDist(e.pos, centerPos);
      if (dist < 10) {
        let nearestEnemy: Entity | null = null;
        let nearestDist = Infinity;
        for (const enemy of ctx.entities) {
          if (!enemy.alive || enemy.inLimbo || ctx.isAllied(enemy.house, house)) continue;
          const eDist = worldDist(enemy.pos, centerPos);
          if (eDist < 12 && eDist < nearestDist) {
            nearestDist = eDist;
            nearestEnemy = enemy;
          }
        }
        if (nearestEnemy) {
          e.mission = Mission.HUNT;
          e.moveTarget = { x: nearestEnemy.pos.x, y: nearestEnemy.pos.y };
        }
      }
    }
  }
}

/** AI retreat -- damaged units fall back to repair depot or base */
export function updateAIRetreat(ctx: AIContext): void {
  if (ctx.tick % 30 !== 0) return;

  const mods = AI_DIFFICULTY_MODS[ctx.difficulty] ?? AI_DIFFICULTY_MODS.normal;
  const retreatPercent = mods.retreatHpPercent;

  for (const e of ctx.entities) {
    if (!e.alive || ctx.isPlayerControlled(e)) continue;
    if (e.isAnt) continue;
    if (e.isSuicide) continue;

    const state = ctx.aiStates.get(e.house);
    if (!state) continue;
    if (state.iq < 3) continue;

    // Emergency harvester return — uses difficulty-scaled threshold (C++ rules.cpp)
    if (e.type === UnitType.V_HARV) {
      const hpRatio = e.hp / e.maxHp;
      if (hpRatio >= retreatPercent) continue;
      if (e.harvesterState === 'returning' || e.harvesterState === 'unloading') continue;
      if (e.mission === Mission.MOVE && e.moveTarget) continue;
      let nearestProc: MapStructure | null = null;
      let nearestDist = Infinity;
      for (const s of ctx.structures) {
        if (!s.alive || s.house !== e.house || s.type !== 'PROC') continue;
        const [w, h] = STRUCTURE_SIZE[s.type] ?? [3, 2];
        const sx = (s.cx + w / 2) * CELL_SIZE;
        const sy = (s.cy + h / 2) * CELL_SIZE;
        const d = (e.pos.x - sx) ** 2 + (e.pos.y - sy) ** 2;
        if (d < nearestDist) { nearestDist = d; nearestProc = s; }
      }
      if (nearestProc) {
        const [w, h] = STRUCTURE_SIZE[nearestProc.type] ?? [3, 2];
        e.harvesterState = 'returning';
        e.mission = Mission.MOVE;
        e.moveTarget = {
          x: (nearestProc.cx + w / 2) * CELL_SIZE,
          y: (nearestProc.cy + h / 2) * CELL_SIZE,
        };
        e.harvestTick = 0;
      }
      continue;
    }

    const hpRatio = e.hp / e.maxHp;
    if (hpRatio >= retreatPercent) continue;

    if (e.mission === Mission.MOVE && e.moveTarget) continue;

    const center = aiGetBaseCenter(ctx, e.house);
    if (!center) continue;

    let retreatTarget: WorldPos | null = null;
    for (const s of ctx.structures) {
      if (!s.alive || s.house !== e.house || s.type !== 'FIX') continue;
      const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
      retreatTarget = {
        x: (s.cx + w / 2) * CELL_SIZE,
        y: (s.cy + h / 2) * CELL_SIZE,
      };
      break;
    }

    if (!retreatTarget) {
      retreatTarget = {
        x: center.cx * CELL_SIZE + CELL_SIZE / 2,
        y: center.cy * CELL_SIZE + CELL_SIZE / 2,
      };
    }

    e.mission = Mission.MOVE;
    e.moveTarget = retreatTarget;
    state.attackPool.delete(e.id);
  }
}

/** AI auto-repair -- IQ >= 1 houses repair damaged structures (rules.ini [IQ] RepairSell=1)
 *  C++ house.cpp:295: RepairDelay from DifficultyClass gates how often AI repairs.
 *  repairDelay is in minutes — converted to ticks as repair interval floor. */
export function updateAIRepair(ctx: AIContext): void {
  const mods = AI_DIFFICULTY_MODS[ctx.difficulty] ?? AI_DIFFICULTY_MODS.normal;
  // C++ RepairDelay is in minutes; convert to ticks (repairDelay * 60 * GAME_TICKS_PER_SEC)
  // Minimum interval = 15 ticks (original rate), scaled up by repairDelay
  const repairInterval = Math.max(15, Math.floor(mods.repairDelay * 60 * GAME_TICKS_PER_SEC));
  if (ctx.tick % repairInterval !== 0) return;

  for (const [house, state] of ctx.aiStates) {
    if (state.iq < 1) continue;

    const credits = ctx.houseCredits.get(house) ?? 0;
    if (credits < 10) continue;

    for (const s of ctx.structures) {
      if (!s.alive || s.house !== house) continue;
      if (s.hp >= s.maxHp) continue;
      if (s.sellProgress !== undefined) continue;
      if (s.hp >= s.maxHp * 0.8) continue;

      const prodItem = ctx.scenarioProductionItems.find(p => p.type === s.type);
      const repairCostPerStep = prodItem
        ? Math.ceil((prodItem.cost * REPAIR_PERCENT) / (s.maxHp / REPAIR_STEP))
        : 1;
      const currentCredits = ctx.houseCredits.get(house) ?? 0;
      if (currentCredits >= repairCostPerStep) {
        s.hp = Math.min(s.maxHp, s.hp + REPAIR_STEP);
        ctx.houseCredits.set(house, currentCredits - repairCostPerStep);
      }
    }
  }
}

/** AI auto-sell -- IQ >= 1 houses sell near-death structures for full refund
 *  C++ techno.cpp:5743-5761: AI gets 100% refund (no Rule.RefundPercent penalty)
 *  rules.ini [IQ] RepairSell=1 (rules.cpp default was 3) */
export function updateAISellDamaged(ctx: AIContext): void {
  if (ctx.tick % 75 !== 0) return;

  for (const [house, state] of ctx.aiStates) {
    if (state.iq < 1) continue;

    for (const s of ctx.structures) {
      if (!s.alive || s.house !== house) continue;
      if (s.sellProgress !== undefined) continue;
      if (s.hp >= s.maxHp * CONDITION_RED) continue;

      if (s.type === 'FACT') continue;

      if (s.type === 'POWR' || s.type === 'APWR') {
        let powerCount = 0;
        for (const ps of ctx.structures) {
          if (ps.alive && ps.house === house && (ps.type === 'POWR' || ps.type === 'APWR')) {
            powerCount++;
          }
        }
        if (powerCount <= 1) continue;
      }

      const prodItem = ctx.scenarioProductionItems.find(p => p.type === s.type && p.isStructure);
      if (prodItem) {
        // C++ techno.cpp:5743-5761: AI gets full refund (no 50% penalty)
        const refund = prodItem.cost;
        const current = ctx.houseCredits.get(house) ?? 0;
        ctx.houseCredits.set(house, current + refund);
      }
      s.alive = false;
      s.rubble = true;
      ctx.clearStructureFootprint(s);
    }
  }
}

/** AI passive income -- AI houses earn credits from refineries */
export function updateAIIncome(ctx: AIContext): void {
  if (ctx.tick % 450 !== 0) return;
  for (const s of ctx.structures) {
    if (!s.alive || s.type !== 'PROC') continue;
    if (ctx.isAllied(s.house, ctx.playerHouse)) continue;
    const current = ctx.houseCredits.get(s.house) ?? 0;
    const aiState = ctx.aiStates.get(s.house);
    const incomeMult = aiState ? aiState.incomeMult : 1.0;
    ctx.houseCredits.set(s.house, current + Math.floor(100 * incomeMult));
  }
}

/** AI army building -- AI houses produce units when they have credits and barracks/factory */
export function updateAIProduction(ctx: AIContext): void {
  const mods = AI_DIFFICULTY_MODS[ctx.difficulty] ?? AI_DIFFICULTY_MODS.normal;
  if (ctx.tick % mods.productionInterval !== 0) return;

  // For ant missions, respect ant cap using old random production
  if (ctx.scenarioId.startsWith('SCA')) {
    const diffMods = DIFFICULTY_MODS[ctx.difficulty] ?? DIFFICULTY_MODS.normal;
    const antCount = ctx.entities.filter(e => e.alive && e.isAnt).length;
    if (antCount >= diffMods.maxAnts) return;
  }

  for (const [house, credits] of ctx.houseCredits) {
    if (credits <= 0) continue;
    if (ctx.isAllied(house, ctx.playerHouse)) continue;

    const state = ctx.aiStates.get(house);
    if (state && !state.productionEnabled) continue;
    const hasTent = aiHasPrereq(ctx, house, 'TENT');
    const hasWeap = ctx.structures.some(s => s.alive && s.house === house && s.type === 'WEAP');

    // C++ parity (house.cpp:6239-6277): AI_Aircraft — build aircraft when pads are available.
    // In C++, AI_Aircraft runs independently from AI_Unit/AI_Infantry, so aircraft get their own
    // credit allocation. We process aircraft FIRST to match this behavior.
    // C++ house.cpp:6245: if (CurAircraft >= Control.MaxAircraft) return(TICKS_PER_SECOND);
    let skipAircraft = false;
    if (state && state.maxAircraft >= 0) {
      let acCount = 0;
      for (const e of ctx.entities) {
        if (e.alive && e.house === house && e.stats.isAircraft) acCount++;
      }
      if (acCount >= state.maxAircraft) skipAircraft = true;
    }

    // C++ house.cpp:6239 — AI_Aircraft requires IQ >= IQGuardArea (default 4)
    const iq = state ? state.iq : 0;
    if (iq < 4) skipAircraft = true;

    const aircraftCredits = ctx.houseCredits.get(house) ?? 0;
    if (aircraftCredits >= 800 && !skipAircraft) {
      const houseFaction = HOUSE_FACTION[house] ?? 'both';
      const isSoviet = houseFaction === 'soviet';

      const hpadCount = ctx.structures.filter(s => s.alive && s.house === house && s.type === 'HPAD').length;
      const afldCount = ctx.structures.filter(s => s.alive && s.house === house && s.type === 'AFLD').length;
      const heliCount = ctx.entities.filter(e => e.alive && e.house === house &&
        (e.type === UnitType.V_HELI || e.type === UnitType.V_HIND)).length;
      const fixedWingCount = ctx.entities.filter(e => e.alive && e.house === house &&
        (e.type === UnitType.V_MIG || e.type === UnitType.V_YAK)).length;

      if (hpadCount > heliCount) {
        const heliType = isSoviet ? UnitType.V_HIND : UnitType.V_HELI;
        const heliItem = ctx.scenarioProductionItems.find(p => p.type === heliType);
        const heliCost = heliItem ? Math.max(1, Math.round(heliItem.cost * mods.costBias)) : 0;
        if (heliItem && aircraftCredits >= heliCost) {
          const unit = spawnAIUnit(ctx, house, heliType, 'HPAD', iq >= 4 ? Mission.AREA_GUARD : Mission.GUARD);
          if (unit) {
            unit.flightAltitude = Entity.FLIGHT_ALTITUDE;
            unit.aircraftState = 'landed';
            ctx.houseCredits.set(house, (ctx.houseCredits.get(house) ?? 0) - heliCost);
          }
        }
      }

      if (afldCount > fixedWingCount) {
        const jetType = isSoviet ? UnitType.V_MIG : UnitType.V_YAK;
        const jetItem = ctx.scenarioProductionItems.find(p => p.type === jetType);
        const jetCost = jetItem ? Math.max(1, Math.round(jetItem.cost * mods.costBias)) : 0;
        const jetCredits = ctx.houseCredits.get(house) ?? 0;
        if (jetItem && jetCredits >= jetCost) {
          const unit = spawnAIUnit(ctx, house, jetType, 'AFLD', iq >= 4 ? Mission.AREA_GUARD : Mission.GUARD);
          if (unit) {
            unit.flightAltitude = Entity.FLIGHT_ALTITUDE;
            unit.aircraftState = 'landed';
            ctx.houseCredits.set(house, (ctx.houseCredits.get(house) ?? 0) - jetCost);
          }
        }
      }
    }

    // Strategic AI: Harvester priority
    // C++ house.cpp — AI harvester replacement requires IQ >= 2 (IQHarvester default 2)
    if (state && hasWeap && iq >= 2 && state.harvesterCount < state.refineryCount) {
      const harvItem = ctx.scenarioProductionItems.find(p => p.type === 'HARV');
      const harvCost = harvItem ? Math.max(1, Math.round(harvItem.cost * mods.costBias)) : 0;
      if (harvItem && credits >= harvCost) {
        const unit = spawnAIUnit(ctx, house, UnitType.V_HARV, 'WEAP');
        if (unit) {
          ctx.houseCredits.set(house, credits - harvCost);
          continue;
        }
      }
    }

    const staging = state ? aiStagingArea(ctx, house) : null;

    // C++ MaxInfantry cap
    let skipInfantry = false;
    if (state && state.maxInfantry >= 0) {
      let infCount = 0;
      for (const e of ctx.entities) {
        if (e.alive && e.house === house && e.stats.isInfantry) infCount++;
      }
      if (infCount >= state.maxInfantry) skipInfantry = true;
    }

    if (hasTent && credits >= 100 && !skipInfantry) {
      const pick = state
        ? getAIProductionPick(ctx, house, 'infantry')
        : (() => {
            const houseFaction = HOUSE_FACTION[house] ?? 'both';
            const infItems = ctx.scenarioProductionItems.filter(p =>
              (p.prerequisite === 'TENT' || p.prerequisite === 'BARR') &&
              !p.isStructure &&
              (p.faction === 'both' || p.faction === houseFaction) &&
              (p.techLevel === undefined || p.techLevel >= 0)
            );
            return infItems.length > 0 ? infItems[ScenarioRandom.nextInRange(0, infItems.length - 1)] : null;
          })();
      const infCost = pick ? Math.max(1, Math.round(pick.cost * mods.costBias)) : 0;
      if (pick && credits >= infCost) {
        const unitType = pick.type as UnitType;
        // C++ house.cpp — AREA_GUARD requires IQ >= 4 (IQGuardArea), else GUARD
        const unit = spawnAIUnit(ctx, house, unitType, 'TENT', iq >= 4 ? Mission.AREA_GUARD : Mission.GUARD,
          staging ?? undefined);
        if (unit) {
          if (!staging) {
            unit.guardOrigin = { x: unit.pos.x, y: unit.pos.y };
          } else {
            unit.moveTarget = staging;
            unit.mission = Mission.MOVE;
          }
          ctx.houseCredits.set(house, credits - infCost);
        }
      }
    }

    // C++ MaxUnit cap
    let skipVehicle = false;
    if (state && state.maxUnit >= 0) {
      let vehCount = 0;
      for (const e of ctx.entities) {
        if (e.alive && e.house === house && !e.stats.isInfantry && !e.isAnt && !e.stats.isAircraft && !e.stats.isVessel) vehCount++;
      }
      if (vehCount >= state.maxUnit) skipVehicle = true;
    }

    const currentCredits = ctx.houseCredits.get(house) ?? 0;
    if (hasWeap && currentCredits >= 600 && !skipVehicle) {
      const pick = state
        ? getAIProductionPick(ctx, house, 'vehicle')
        : (() => {
            const houseFaction = HOUSE_FACTION[house] ?? 'both';
            const vehItems = ctx.scenarioProductionItems.filter(p =>
              p.prerequisite === 'WEAP' &&
              !p.isStructure &&
              (p.faction === 'both' || p.faction === houseFaction) &&
              (p.techLevel === undefined || p.techLevel >= 0)
            );
            return vehItems.length > 0 ? vehItems[ScenarioRandom.nextInRange(0, vehItems.length - 1)] : null;
          })();
      const vehCost = pick ? Math.max(1, Math.round(pick.cost * mods.costBias)) : 0;
      if (pick && currentCredits >= vehCost) {
        const unitType = pick.type as UnitType;
        // C++ house.cpp — AREA_GUARD requires IQ >= 4 (IQGuardArea), else GUARD
        const unit = spawnAIUnit(ctx, house, unitType, 'WEAP', iq >= 4 ? Mission.AREA_GUARD : Mission.GUARD,
          staging ?? undefined);
        if (unit) {
          if (!staging) {
            unit.guardOrigin = { x: unit.pos.x, y: unit.pos.y };
          } else {
            unit.moveTarget = staging;
            unit.mission = Mission.MOVE;
          }
          ctx.houseCredits.set(house, (ctx.houseCredits.get(house) ?? 0) - vehCost);
        }
      }
    }

  }
}

/**
 * C++ Suggested_New_Team (teamtype.cpp:419-497) — collect eligible autocreate
 * team types for a house, then randomly pick one.
 *
 * Eligibility: IsAutocreate flag set (bit2 of flags), matches house,
 * and active instance count (Number) < MaxAllowed.
 * Caps candidate list at 20 entries (C++ choices[20]).
 */
export function suggestedNewTeam(
  ctx: AIContext,
  house: House,
  alerted: boolean,
): number | null {
  const choices: number[] = [];
  const MAX_CHOICES = 20; // C++ choices[20]

  for (let teamIdx = 0; teamIdx < ctx.teamTypes.length; teamIdx++) {
    if (choices.length >= MAX_CHOICES) break;

    const ttype = ctx.teamTypes[teamIdx];
    if (houseIdToHouse(ttype.house) !== house) continue;
    if (ctx.destroyedTeams.has(teamIdx)) continue;

    // C++ teamtype.cpp:434 — when alerted, only autocreate teams; when not alerted, only non-autocreate
    const isAutocreate = !!(ttype.flags & 4);
    let maxnum = ttype.maxAllowed ?? 5; // default 5 if not set (legacy compatibility)
    if ((alerted && !isAutocreate) || (!alerted && isAutocreate)) {
      maxnum = 0;
    }

    // C++ teamtype.cpp:440 — ttype->Number < maxnum
    const activeCount = ctx.autocreateTeamCounts.get(teamIdx) ?? 0;
    if (activeCount < maxnum) {
      choices.push(teamIdx);
    }
  }

  if (choices.length === 0) return null;
  // C++ teamtype.cpp:492 — Random_Pick(0, choicecount-1)
  return choices[ScenarioRandom.nextInRange(0, choices.length - 1)];
}

/** Spawn a single team instance into the game world.
 *  C++ Create_One_Of() always increments Number even if placement fails. */
function spawnTeam(ctx: AIContext, teamIdx: number, house: House): void {
  const team = ctx.teamTypes[teamIdx];

  // Increment active instance count first (C++ TeamTypeClass::Number)
  // This mirrors C++ where the team object is created regardless of unit placement.
  ctx.autocreateTeamCounts.set(teamIdx, (ctx.autocreateTeamCounts.get(teamIdx) ?? 0) + 1);

  const edge = ctx.houseEdges.get(house)?.toLowerCase();
  let spawnPos: { cx: number; cy: number } | null = null;

  if (edge) {
    const bx = ctx.map.boundsX, by = ctx.map.boundsY;
    const bw = ctx.map.boundsW, bh = ctx.map.boundsH;
    const randOffset = ScenarioRandom.nextInRange(0, Math.max(bw, bh) - 1);
    switch (edge) {
      case 'north': spawnPos = { cx: bx + (randOffset % bw), cy: by }; break;
      case 'south': spawnPos = { cx: bx + (randOffset % bw), cy: by + bh - 1 }; break;
      case 'east':  spawnPos = { cx: bx + bw - 1, cy: by + (randOffset % bh) }; break;
      case 'west':  spawnPos = { cx: bx, cy: by + (randOffset % bh) }; break;
    }
  }

  if (!spawnPos) {
    const wp = ctx.waypoints.get(team.origin);
    if (wp) spawnPos = wp;
    else return;
  }

  const world = { x: spawnPos.cx * CELL_SIZE + CELL_SIZE / 2, y: spawnPos.cy * CELL_SIZE + CELL_SIZE / 2 };
  const teamMissionScript = team.missions.length > 0 ? team.missions.map(m => ({
    mission: m.mission,
    data: m.data,
  })) : null;

  for (const member of team.members) {
    if (!UNIT_STATS[member.type]) continue;
    const unitType = member.type as UnitType;
    for (let i = 0; i < member.count; i++) {
      const offsetX = (ScenarioRandom.float() - 0.5) * 48;
      const offsetY = (ScenarioRandom.float() - 0.5) * 48;
      const entity = new Entity(unitType, house, world.x + offsetX, world.y + offsetY);
      entity.facing = ScenarioRandom.nextInRange(0, 7);
      entity.bodyFacing32 = entity.facing * 4;

      if (teamMissionScript) {
        entity.teamMissions = teamMissionScript;
        entity.teamMissionIndex = 0;
      } else {
        entity.mission = Mission.HUNT;
      }

      if (team.flags & 2) {
        entity.mission = Mission.HUNT;
      }

      applyScenarioOverrides([entity], ctx.scenarioUnitStats, ctx.scenarioWeaponStats);
      ctx.entities.push(entity);
      ctx.entityById.set(entity.id, entity);
    }
  }

}

/**
 * AI autocreate teams — periodically assemble and deploy teams from autocreate-flagged TeamTypes.
 *
 * C++ house.cpp:988-1006: when IsAlerted && AlertTime==0, creates
 * Random_Pick(2, (TechLevel-1)/3+1) teams per cycle using Suggested_New_Team.
 * Each call to Suggested_New_Team collects eligible teams (matching house,
 * autocreate flag, Number < MaxAllowed) and picks one at random.
 */
export function updateAIAutocreateTeams(ctx: AIContext): void {
  if (!ctx.autocreateEnabled) return;
  if (ctx.tick % 120 !== 0) return;

  for (const [house, state] of ctx.aiStates) {
    // C++ house.cpp:988: autocreate only fires when IsAlerted is true for this house
    if (!state.isAlerted) continue;
    if (!state.productionEnabled) continue;
    if (state.iq < 2) continue;

    const credits = ctx.houseCredits.get(house) ?? 0;
    if (credits < 500) continue;

    // C++ house.cpp:993 — maxteams = Random_Pick(2, (TechLevel-1)/3+1)
    const techLevel = state.techLevel;
    const maxTeamsUpper = Math.floor((techLevel - 1) / 3) + 1;
    const maxTeams = ScenarioRandom.nextInRange(2, Math.max(maxTeamsUpper, 2));

    for (let t = 0; t < maxTeams; t++) {
      const teamIdx = suggestedNewTeam(ctx, house, true);
      if (teamIdx !== null) {
        spawnTeam(ctx, teamIdx, house);
      }
    }
  }
}
