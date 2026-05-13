/**
 * Main game loop — ties all engine systems together.
 * Fixed timestep at 15 FPS (matching original Red Alert game speed).
 */

import {
  type WorldPos, type CellPos, type UnitStats, type WeaponStats, type ArmorType,
  type WarheadMeta, type WarheadProps, type LeptonPos,
  type AllianceTable, buildDefaultAlliances, buildAlliancesFromINI,
	  CELL_SIZE, MAP_CELLS, GAME_TICKS_PER_SEC, MPH_TO_PX, LEPTON_SIZE, RESFACTOR,
	  MAX_DAMAGE, REPAIR_STEP, REPAIR_PERCENT, CONDITION_RED, CONDITION_YELLOW, RULE_GRAVITY,
		  Dir, Mission, AnimState, House, UnitType, Stance, SpeedClass, worldDist, directionTo, worldToCell, pixelToLepton, leptonToPixel, leptonDist, directionToLeptons, directionToLeptons256, cellTargetToLepton, DIR_DX, DIR_DY, COS_TABLE_256, SIN_TABLE_256,
	  WARHEAD_VS_ARMOR, WARHEAD_PROPS, WARHEAD_META, type WarheadType, UNIT_STATS, WEAPON_STATS, armorIndex, EXPLOSION_FRAMES,
  MISSION_CONTROL,
  type ProductionItem, CursorType, type StripType, getStripSide, getFactoryType,
  type Faction, HOUSE_FACTION, COUNTRY_BONUSES, ANT_HOUSES,
  calcProjectileTravelFrames, modifyDamage,
  SuperweaponType, SUPERWEAPON_DEFS, type SuperweaponDef, type SuperweaponState,
  IRON_CURTAIN_DURATION, NUKE_DAMAGE, NUKE_BLAST_CELLS, NUKE_FLIGHT_TICKS,
  NUKE_MIN_FALLOFF, CHRONO_SHIFT_VISUAL_TICKS, SONAR_REVEAL_TICKS, IC_TARGET_RANGE,
  CIVILIAN_UNIT_TYPES,
  PRODUCTION_ITEMS,
  SUBCELL_LEPTON_OFFSETS,
  TERRAIN_SPEED,
} from './types';
// NOTE: For server-side code that needs rules.ini-derived faction data,
// import from './rulesIniPipeline' instead of using PRODUCTION_ITEMS directly.
import { AssetManager, getSharedAssets } from './assets';
import { AudioManager, type SoundName } from './audio';
import { Camera } from './camera';
import { InputManager } from './input';
import { Entity, resetEntityIds, setPlayerHouses, threatScore as computeThreatScore, CloakState, CLOAK_TRANSITION_FRAMES, SONAR_PULSE_DURATION, CLOAK_DELAY_TICKS, dir256ToFacing8, dir256ToFacing32 } from './entity';
import { GameMap, Terrain, MoveResult } from './map';
import { ScenarioRandom } from './random';
import { Renderer, type Effect, BUILDING_FRAME_TABLE } from './renderer';
import { type LogicAnim, processLogicAnim } from './logicAnim';
import { findPath, nearbyLocation } from './pathfinding';
import {
  usesTrackMovement, lookupTrackControl, getEffectiveTrack, getTrackArray,
  smoothTurn, LP, PIXEL_LEPTON_W, F_D, RAW_TRACKS, TRACK_CONTROL,
  type TrackControlEntry,
} from './tracks';
import {
  loadScenario, applyScenarioOverrides,
  type TeamType, type ScenarioTrigger, type MapStructure,
  type TriggerGameState, type TriggerActionResult,
  checkTriggerEvent, executeTriggerAction, houseIdToHouse, houseToId, consumeSemiPersistentAttachment,
  STRUCTURE_WEAPONS, STRUCTURE_SIZE, STRUCTURE_MAX_HP, getBibCells, getStructureOccupyCells,
  isStructureUnderConstruction, structureConstructionProgressTicks,
  saveCarryover, TIME_UNIT_TICKS,
  TEVENT_GLOBAL_SET, TEVENT_GLOBAL_CLEAR, TEVENT_TIME,
  TEVENT_NONE, TEVENT_PLAYER_ENTERED, TEVENT_SPIED, TEVENT_DISCOVERED,
  TEVENT_ATTACKED, TEVENT_DESTROYED, TEVENT_ANY, TEVENT_UNITS_DESTROYED,
  TEVENT_ALL_DESTROYED, TEVENT_ENTERS_ZONE, TEVENT_CROSS_HORIZONTAL, TEVENT_CROSS_VERTICAL,
  CREWED_BUILDINGS,
} from './scenario';
export { MISSIONS, getMission, getMissionIndex, loadProgress, saveProgress, expandAllyToken } from './scenario';
export { CAMPAIGNS, getCampaign, loadCampaignProgress, saveCampaignProgress, checkMissionExists, loadMissionBriefings, getMissionBriefing } from './scenario';
export type { MissionInfo, CampaignId, CampaignDef, CampaignMission } from './scenario';
export { AudioManager } from './audio';
export { preloadAssets } from './assets';
export { getMissionMovies, hasFMV, getMovieUrl, CAMPAIGN_END_MOVIES } from './movies';
export { MoviePlayer } from './moviePlayer';

// Subsystem module imports
import {
  type CombatContext,
  type InflightProjectile as InflightProjectileType,
  getWarheadMult as _getWarheadMult,
  getWarheadMeta as _getWarheadMeta,
  getWarheadProps as _getWarheadProps,
  damageSpeedFactor as _damageSpeedFactor,
  damageEntity as _damageEntity,
  aiScatterOnDamage as _aiScatterOnDamage,
  fireWeaponAt as _fireWeaponAt,
  fireWeaponAtCoord as _fireWeaponAtCoord,
  fireWeaponAtStructure as _fireWeaponAtStructure,
  handleUnitDeath as _handleUnitDeath,
  checkVehicleCrush as _checkVehicleCrush,
  checkWallCrush as _checkWallCrush,
  launchProjectile as _launchProjectile,
  updateInflightProjectiles as _updateInflightProjectiles,
  applySplashDamage as _applySplashDamage,
  structureDamage as _structureDamage,
  updateStructureCombat as _updateStructureCombat,
  updateSingleStructureCombat as _updateSingleStructureCombat,
  decrementStructureCdTimersEndOfLogic as _decrementStructureCdTimersEndOfLogic,
  tickDestroyedStructureDebris as _tickDestroyedStructureDebris,
  findStructureThreatTarget as _findStructureThreatTarget,
  structureFireLeptons as _structureFireLeptons,
  entityTargetLeptons as _entityTargetLeptons,
  setStructureTurretDesired as _setStructureTurretDesired,
  tickStructureTurretRotation as _tickStructureTurretRotation,
  SPLASH_RADIUS,
} from './combat';
import {
  type FogContext,
  updateFogOfWar as _updateFogOfWar,
  updateSubDetection as _updateSubDetection,
  revealAroundCell as _revealAroundCell,
  revealZoneFloodFill as _revealZoneFloodFill,
  updateGapGenerators as _updateGapGenerators,
  GAP_RADIUS, GAP_UPDATE_INTERVAL, DEFENSE_TYPES as FOG_DEFENSE_TYPES,
  STRUCTURE_SIGHT,
} from './fog';
import {
  type RepairSellContext,
  repairCostPerStep as _repairCostPerStep,
  sellRefund,
  toggleRepair as _toggleRepair,
  isStructureRepairing as _isStructureRepairing,
  sellStructureByIndex as _sellStructureByIndex,
  tickRepairs as _tickRepairs,
  tickServiceDepot as _tickServiceDepot,
  calculateSiloCapacity as _calculateSiloCapacity,
  calculatePowerGrid as _calculatePowerGrid,
} from './repairSell';
import {
  type SpecialUnitsContext,
  updateTanyaC4 as _updateTanyaC4,
  tickC4Timers as _tickC4Timers,
  updateThief as _updateThief,
  updateMinelayer as _updateMinelayer,
  tickMines as _tickMines,
  updateChronoTank as _updateChronoTank,
  teleportChronoTank as _teleportChronoTank,
  updateMADTank as _updateMADTank,
  deployMADTank as _deployMADTank,
  updateDemoTruck as _updateDemoTruck,
  updateVehicleCloak as _updateVehicleCloak,
  updateMechanicUnit as _updateMechanicUnit,
  updateMedic as _updateMedic,
  tickVortices as _tickVortices,
  MAX_MINES_PER_HOUSE as _MAX_MINES_PER_HOUSE,
  CHRONO_TANK_COOLDOWN as _CHRONO_TANK_COOLDOWN,
  MAD_TANK_CHARGE_TICKS as _MAD_TANK_CHARGE_TICKS,
  MAD_TANK_UNIT_DAMAGE_PERCENT as _MAD_TANK_UNIT_DAMAGE_PERCENT,
  MAD_TANK_BUILDING_DAMAGE_PERCENT as _MAD_TANK_BUILDING_DAMAGE_PERCENT,
  MAD_TANK_INFANTRY_DAMAGE as _MAD_TANK_INFANTRY_DAMAGE,
  MAD_TANK_RADIUS as _MAD_TANK_RADIUS,
  MAD_TANK_SCREEN_SHAKE as _MAD_TANK_SCREEN_SHAKE,
  DEMO_TRUCK_DAMAGE as _DEMO_TRUCK_DAMAGE,
  DEMO_TRUCK_RADIUS as _DEMO_TRUCK_RADIUS,
  DEMO_TRUCK_FUSE_TICKS as _DEMO_TRUCK_FUSE_TICKS,
  MECHANIC_HEAL_RANGE as _MECHANIC_HEAL_RANGE,
  MECHANIC_HEAL_AMOUNT as _MECHANIC_HEAL_AMOUNT,
} from './specialUnits';
import {
  type SuperweaponContext,
  updateSuperweapons as _updateSuperweapons,
  activateSuperweapon as _activateSuperweapon,
  detonateNuke as _detonateNuke,
  findBestNukeTarget as _findBestNukeTarget,
} from './superweapon';
import {
  type ProductionContext,
  getEffectiveCost as _getEffectiveCost,
  countPlayerBuildings as _countPlayerBuildings,
  getAvailableItems as _getAvailableItems,
  startProduction as _startProduction,
  cancelProduction as _cancelProduction,
  tickProduction as _tickProduction,
  spawnProducedUnit as _spawnProducedUnit,
} from './production';
import {
  type HarvesterContext,
  updateHarvester as _updateHarvester,
} from './harvester';
import {
  type PlacementContext,
  placeStructure as _placeStructure,
  deployMCV as _deployMCV,
  updateMCVUnloadMission as _updateMCVUnloadMission,
  advanceMCVDeployRotation as _advanceMCVDeployRotation,
} from './placement';
import {
  type AircraftContext,
  canTargetNaval as _canTargetNaval,
  findLandingPad as _findLandingPad,
  getAircraftTargetPos as _getAircraftTargetPos,
  updateAircraft as _updateAircraft,
  updateFixedWingAttackRun as _updateFixedWingAttackRun,
  updateHelicopterAttack as _updateHelicopterAttack,
  advanceAircraftFrame as _advanceAircraftFrame,
  computeRearmDelay as _computeRearmDelay,
  seekAircraftServiceDocking as _seekAircraftServiceDocking,
} from './aircraft';
import {
  type CrateContext,
  type CrateType, type Crate,
  spawnCrate as _spawnCrate,
  pickupCrate as _pickupCrate,
} from './crates';
import {
  type AIContext,
  type AIHouseState,
  DIFFICULTY_MODS,
  AI_DIFFICULTY_MODS,
  createAIHouseState as _createAIHouseState,
  updateAIIQGates as _updateAIIQGates,
  updateAIStrategicPlanner as _updateAIStrategicPlanner,
  updateAIHarvesters as _updateAIHarvesters,
  updateAIAttackGroups as _updateAIAttackGroups,
  launchAIAttack as _launchAIAttack,
  aiPickAttackTarget as _aiPickAttackTarget,
  updateAIDefense as _updateAIDefense,
  updateAIRepair as _updateAIRepair,
  updateAISellDamaged as _updateAISellDamaged,
  updateAIIncome as _updateAIIncome,
  updateAIProduction as _updateAIProduction,
  updateAIAutocreateTeams as _updateAIAutocreateTeams,
  spawnAIUnit as _spawnAIUnit,
  aiPerTick as _aiPerTick,
  aiPowerProduced as _aiPowerProduced,
  aiPowerConsumed as _aiPowerConsumed,
} from './ai';
import {
  Team as TeamInstance, registerTeam, updateAllTeams as _updateAllTeams,
  clearAllTeams as _clearAllTeams, getActiveTeams, suspendTeamsByPriority,
} from './team';
import {
  type MissionAIContext,
  updateAttack as _updateAttack,
  updateAttackStructure as _updateAttackStructure,
  updateForceFireGround as _updateForceFireGround,
  updateHunt as _updateHunt,
  updateGuard as _updateGuard,
  updateAreaGuard as _updateAreaGuard,
  updateRetreat as _updateRetreat,
  updateAmbush as _updateAmbush,
  updateRepairMission as _updateRepairMission,
  orderTransportEvacuate as _orderTransportEvacuate,
  runFiringAI as _runFiringAI,
  targetSomethingNearbyRange as _targetSomethingNearbyRange,
  movementZoneCells,
} from './missionAI';
// C++ parity scaffolding: UnitClass::Per_Cell_Process hook. Currently only
// does NavCom-at-destination clear (legacy perCellNavComCheck behavior);
// Commence sub-case is gated behind PER_CELL_COMMENCE_ENABLED=false to
// preserve behavior while establishing the future port's hook point.
// See perCellProcess.ts docstring + cpp-parity-scg11ea-tick-28.test.ts.
import { PCPType, unitPerCellProcess, footPerCellProcess, PER_CELL_TRACK_JUMP_ENABLED, FOOT_PER_CELL_ENABLED, MISSION_MOVE_PATH_FAILURE, MOVEMENT_AI_MOVE_NAVCOM_GUARD, DISPATCH_ORDER_REFACTOR, PCP_DOUBLE_CYCLE_ENABLED, DRIVE_CLASS_AI_PORT } from './perCellProcess';
import { assignMission } from './missionLifecycle';

// === PCP refactor diagnostic flag (Session 1 / plan §5) ===
// When set (env `DEBUG_PCP_LOG=1` under Node, or `globalThis.__DEBUG_PCP_LOG`
// in the browser), followTrackStep dumps per-tick drive telemetry for
// speed/accumulator parity comparison vs WASM drive.cpp:481-490. No behavior
// change. Kept behind a `const` rather than an `if (import.meta.env...)`
// because the engine runs both in Node (tests) and the browser (Playwright).
const DEBUG_PCP_LOG: boolean = (() => {
  try {
    // Node/Vitest
    if (typeof process !== 'undefined' && process?.env?.DEBUG_PCP_LOG) return true;
  } catch { /* no-op */ }
  try {
    // Browser opt-in (set via `window.__DEBUG_PCP_LOG = true` before run)
    if (typeof globalThis !== 'undefined' && (globalThis as Record<string, unknown>).__DEBUG_PCP_LOG) return true;
  } catch { /* no-op */ }
  return false;
})();

// Re-export subsystem types and functions for external consumers
export type { InflightProjectileType as InflightProjectile };
export { SPLASH_RADIUS } from './combat';
export {
  repairCostPerStep, sellRefund, powerOutput, calculatePowerGrid,
  powerMultiplier, calculateSiloCapacity, spendCredits,
} from './repairSell';
export {
  getWarheadMult, getWarheadMeta, getWarheadProps, damageSpeedFactor,
} from './combat';
export {
  GAP_RADIUS, GAP_UPDATE_INTERVAL, DEFENSE_TYPES,
} from './fog';
export {
  MAX_MINES_PER_HOUSE, DEMO_TRUCK_DAMAGE, DEMO_TRUCK_RADIUS,
  DEMO_TRUCK_FUSE_TICKS, CHRONO_TANK_COOLDOWN,
  MAD_TANK_CHARGE_TICKS, MAD_TANK_UNIT_DAMAGE_PERCENT,
  MAD_TANK_BUILDING_DAMAGE_PERCENT, MAD_TANK_INFANTRY_DAMAGE,
  MAD_TANK_RADIUS, MAD_TANK_SCREEN_SHAKE,
  MECHANIC_HEAL_RANGE, MECHANIC_HEAL_AMOUNT,
} from './specialUnits';
export { getEffectiveCost, countPlayerBuildings } from './production';

export type { SuperweaponState } from './types';
export { RESFACTOR } from './types';

export type GameState = 'loading' | 'playing' | 'won' | 'lost' | 'paused';
export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

// DIFFICULTY_MODS, AIHouseState imported from ./ai

/** Defensive structure types that ants prioritize attacking */
const ANT_TARGET_DEFENSE_TYPES = new Set(['HBOX', 'PBOX', 'GUN', 'TSLA', 'SAM', 'AGUN', 'FTUR']);

/** Wall structure types that use 1x1 placement mode */
const WALL_TYPES = new Set(['SBAG', 'FENC', 'BARB', 'BRIK']);




/** In-flight projectile for deferred damage — defined in combat.ts */
type InflightProjectile = InflightProjectileType;

// ============================================================================
// C++ PathThreshhold escalation constants (foot.h:239, foot.cpp:396-411, rules.cpp:271)
// ============================================================================
/** C++ foot.h:239 — maximum path retry attempts before giving up */
const PATH_RETRY = 10;
/** C++ defines.h:828-837 — MoveType enum: passability threshold levels */
const MOVE_CLOAK = 1;         // default starting threshold (easiest)
const MOVE_DESTROYABLE = 3;   // C++ foot.cpp:386-388: max threshold for human players near dest
const MOVE_TEMP  = 4;         // maximum threshold (hardest — blocked by friendly)
/** C++ fixed-point rules.ini PathDelay=.01:
 *  fixed raw=floor(.01*256)=2; fixed multiply rounds ((2*900)+128)/256 = 7 ticks. */
const PATH_DELAY_TICKS = 7;
const AI_FACTORY_STEP_COUNT = 54;      // C++ FactoryClass::STEP_COUNT
const AI_FACTORY_PLACEMENT_DELAY = 45; // C++ TICKS_PER_SECOND * 3
const EXIT_PYLE_OFFSETS: readonly CellPos[] = [
  { cx: 1, cy: 2 }, { cx: 2, cy: 2 }, { cx: 0, cy: 2 }, { cx: -1, cy: 2 },
  { cx: -1, cy: -1 }, { cx: 0, cy: -1 }, { cx: 1, cy: -1 }, { cx: 2, cy: -1 },
  { cx: 2, cy: -1 }, { cx: -1, cy: 0 }, { cx: 2, cy: 0 }, { cx: 2, cy: 1 },
  { cx: -1, cy: 1 },
];
/** C++ house.cpp:4071 — BorrowedTime = TICKS_PER_MINUTE * Rule.SavourDelay.
 *  `fixed(".03")` stores raw fraction 7/256, so 900 * 7/256 rounds to 25.
 *  Delay between flagging win/lose and the actual game-end. */
const SAVOUR_DELAY_TICKS = Math.trunc(((7 * 900) + 128) / 256); // 25 ticks
/** C++ trigger.cpp:177 — BorrowedTime = TICKS_PER_SECOND * 4 = 60 ticks (on ALLOWWIN trigger destruction) */
const ALLOWWIN_BORROWED_TIME = GAME_TICKS_PER_SEC * 4; // 60 ticks

/** Reset path threshold state when a new move order is given (C++ foot.cpp:1723-1735 Assign_Destination).
 *  C++ ONLY resets PathThreshhold — TryTryAgain and PathDelay are NOT touched. */
function resetPathThreshold(entity: Entity): void {
  entity.pathThreshold = MOVE_CLOAK;
  // C++ foot.cpp:1723-1735: Assign_Destination only resets PathThreshhold.
  // TryTryAgain stays at its current value; PathDelay (CDTimerClass) is not reset.
}

const IQ_GUARD_AREA = 4; // rules.ini [IQ] GuardArea=4

function cellsInSameMovementZone(
  map: GameMap,
  start: CellPos,
  goal: CellPos,
  naval: boolean,
  structures?: MapStructure[],
): boolean {
  if (start.cx === goal.cx && start.cy === goal.cy) return true;

  const zone = movementZoneCells(map, start, naval, structures);
  return zone[goal.cy * MAP_CELLS + goal.cx] !== 0;
}

/** Helper: convert WorldPos (pixels) to LeptonPos */
function worldToLeptonPos(wp: WorldPos): LeptonPos {
  return { lx: pixelToLepton(wp.x), ly: pixelToLepton(wp.y) };
}

/** Helper: convert LeptonPos to WorldPos (pixels) */
function leptonPosToWorld(lp: LeptonPos): WorldPos {
  return { x: leptonToPixel(lp.lx), y: leptonToPixel(lp.ly) };
}

/** C++ foot.cpp:373-388 — determine max escalation threshold.
 *  AI units always use MOVE_TEMP(4). Human players near their destination use
 *  MOVE_DESTROYABLE(3), meaning they give up sooner on friendly-blocked cells. */
function pathMaxType(entity: Entity, isPlayerUnit: boolean): number {
  if (!isPlayerUnit) return MOVE_TEMP; // AI always escalates to max
  if (!entity.moveTarget) return MOVE_TEMP;
  // C++ foot.cpp:386-388: human near dest → maxtype = MOVE_DESTROYABLE
  const dist = worldDist(entity.pos, leptonPosToWorld(entity.moveTarget));
  const closeEnough = 2.75; // rules.ini [General] CloseEnough=2.75 (overrides C++ default 0x0280)
  if (dist < closeEnough) return MOVE_DESTROYABLE;
  return MOVE_TEMP;
}

export class Game {
  // Core systems
  assets: AssetManager;
  audio: AudioManager;
  camera: Camera;
  input: InputManager;
  map: GameMap;
  renderer: Renderer;

  // Game state
  entities: Entity[] = [];
  entityById = new Map<number, Entity>();
  structures: MapStructure[] = [];
  /** C++ Logic layer parity: index into entities[] marking the boundary between
   *  "pre-building" entities (units/infantry from scenario INI) and "post-building"
   *  entities (reinforcements, created teams). In C++, the Logic array has:
   *  units → infantry → buildings → aircraft → reinforcements. Entities with index
   *  < _preBuildingEntityCount are processed BEFORE structure timers; entities with
   *  index >= _preBuildingEntityCount are processed AFTER structure timers. */
  _preBuildingEntityCount = 0;
  /** Count of TERRAIN_MINE entities from scenario.
   *  Each fires Spread_Tiberium(true) every GrowthRate*TICKS_PER_MINUTE. */
  _terrainMineCount = 0;
  private _terrainMineSpreadCells: Array<{ cx: number; cy: number; logicIndex: number }> = [];
  selectedIds = new Set<number>();
  selectedStructureIdx = -1; // index into structures[] for selected building (-1 = none)
  controlGroups: Map<number, Set<number>> = new Map(); // 0-9 → entity IDs (C++ parity: keys 1-0)
  attackMoveMode = false;
  sellMode = false;
  repairMode = false;
  /** U6: Fullscreen radar toggle — enlarged minimap overlay */
  isRadarFullscreen = false;
  cursorType: CursorType = CursorType.DEFAULT;
  /** Set of structure indices currently being repaired */
  private repairingStructures = new Set<number>();
  /** Tick when last EVA base attack warning played (throttle to once per 60s) */
  private lastBaseAttackEva = 0;
  /** EVA announcement throttling — maps sound name to last tick played */
  private lastEvaTime = new Map<string, number>();
  /** Counter for wave group coordination */
  private nextWaveId = 1;
  // cellInfCount removed: sub-cell assignment now handled by GameMap.subCellOccupancy
  /** Index for cycling through idle units with period key */
  private lastIdleCycleIdx = 0;
  /** Double-tap detection for control group camera centering */
  private lastGroupKey = 0;
  private lastGroupTime = 0;
  /** Tab key: cycle through unit types in mixed selection */
  private tabCyclePool: number[] = [];
  private tabCycleTypes: string[] = [];
  private tabCycleTypeIndex = 0;
  /** Voice throttle: prevents voice spam (selection and acknowledgment sounds) */
  private lastVoiceTick = 0;
  // Economy
  credits = 0;
  displayCredits = 0; // animated counter shown in sidebar (ticks toward credits)
  /** Cached silo storage capacity (PROC=2000, SILO=1500 each per rules.ini Storage=) — recalculated on structure change */
  siloCapacity = 0;
  /** Tick when last EVA "silos needed" warning played (throttle to 30s = 450 ticks) */
  private lastSiloWarningTick = -450;
  /** AI house credit pools for production (Gap #1) */
  houseCredits = new Map<House, number>();
  /** Per-house reinforcement entry edge from scenario INI (Gap #5) */
  private houseEdges = new Map<House, string>();
  /** Per-house IQ from scenario INI (C++ IQ system, 0-3) */
  private houseIQs = new Map<House, number>();
  /** Per-house TechLevel from scenario INI (gates production items) */
  private houseTechLevels = new Map<House, number>();
  /** Per-house MaxUnit from scenario INI (max vehicle units, -1=unlimited) */
  private houseMaxUnits = new Map<House, number>();
  /** Per-house MaxInfantry from scenario INI (max infantry units, -1=unlimited) */
  private houseMaxInfantry = new Map<House, number>();
  /** Per-house MaxBuilding from scenario INI (max buildings, -1=unlimited) */
  private houseMaxBuildings = new Map<House, number>();
  /** Strategic AI state per non-player house (skip ant missions) */
  private aiStates = new Map<House, AIHouseState>();
  /** Production queue: active build + queued repeats per category (max 5 total) */
  productionQueue: Map<string, { item: ProductionItem; progress: number; queueCount: number; costPaid: number; powerMult: number }> = new Map();
  /** Structure placement: waiting to be placed on map */
  pendingPlacement: ProductionItem | null = null;
  wallPlacementPrepaid = false; // tracks whether first wall cost was prepaid by production
  placementValid = false;
  placementCx = 0;
  placementCy = 0;
  // Power system
  powerProduced = 0;
  powerConsumed = 0;
  // Sidebar dimensions
  static readonly SIDEBAR_W = 80 * RESFACTOR;
  /** CF3: Fixed splash damage radius in cells (C++ SPREAD_FACTOR constant) */
  static readonly SPLASH_RADIUS = 1.5;
  sidebarScroll = 0; // scroll offset for sidebar items
  stripScrollPositions: Record<StripType, number> = { left: 0, right: 0 };
  private cachedAvailableItems: ProductionItem[] | null = null;
  /** Rally points: produced units auto-move here (per factory type) */
  private rallyPoints = new Map<string, WorldPos>(); // factory type → world position
  /** Deferred transport load removals (entity IDs to remove from entities after iteration) */
  private _pendingTransportLoads: number[] = [];

  // Superweapon system
  /** Per-house superweapon states keyed by `${house}:${SuperweaponType}` */
  superweapons = new Map<string, SuperweaponState>();
  /** Active superweapon cursor mode (player selecting target) */
  superweaponCursorMode: SuperweaponType | null = null;
  superweaponCursorHouse: House | null = null;
  /** Chrono Tank deploy targeting (D key → click to teleport) */
  chronoTankTargeting: Entity | null = null;
  /** Nuke launch sequence tracking */
  private nukePendingTarget: WorldPos | null = null;
  private nukePendingTick = 0;
  private nukePendingSource: WorldPos | null = null;

  // Player faction (dynamic — set from scenario INI)
  playerHouse: House = House.Spain;
  playerFaction: Faction = 'allied';
  playerTechLevel = 10; // default high for skirmish; scenario INI overrides

  // Difficulty
  difficulty: Difficulty = 'normal';

  // Crate system
  crates: Crate[] = [];
  private nextCrateTick = 0;

  /** CR8: Active vortex entities from Vortex crate */
  activeVortices: Array<{ x: number; y: number; angle: number; ticksLeft: number; id: number }> = [];

  /** C++ house.cpp:2871-2873 — TimeQuake flag set by chronoshift (20% chance) */
  timeQuake = false;

  // SP1: Spy infiltration house flags (C++ infantry.cpp:645-676)
  spiedHouses = new Set<House>();
  radarSpiedHouses = new Set<House>();
  productionSpiedHouses = new Set<House>();
  visionaryHouses = new Set<House>();
  /** Tracks which enemy house's SPEN was spied for sonar (spy house → target house) */
  sonarSpiedTarget = new Map<House, House>();

  // Stats tracking
  killCount = 0;
  lossCount = 0;
  // C++ score tracking (score.cpp:546-597)
  pointTotal = 0;           // Net score: +cost for kills, -cost for losses (C++ house.h:546)
  harvestedCredits = 0;     // Total credits harvested (C++ HarvestedCredits)
  initialCredits = 0;       // Starting credits (C++ Control.InitialCredits)
  stolenCredits = 0;        // Credits from captured buildings (C++ StolenBuildingsCredits)
  alliedUnitsLost = 0;      // C++ score.cpp:553 — GKilled
  alliedBuildingsLost = 0;  // C++ score.cpp:555 — GBKilled
  sovietUnitsLost = 0;      // C++ score.cpp:551 — NKilled
  sovietBuildingsLost = 0;  // C++ score.cpp:552 — NBKilled
  effects: Effect[] = [];
  /** C++ AnimClass objects that participate in Logic.AI and consume gameplay RNG. */
  private logicAnims: LogicAnim[] = [];
  /** Whether this tick's AnimClass Logic pass has already run. */
  private logicAnimsProcessedThisTick = false;
  /** Persistent corpses left by dead units (capped to prevent memory growth) */
  corpses: Array<{ x: number; y: number; type: UnitType; facing: number; isInfantry: boolean; isAnt: boolean; alpha: number; deathVariant: number }> = [];
  private static readonly MAX_CORPSES = 100;
  state: GameState = 'loading';
  tick = 0;
  missionName = '';
  missionBriefing = '';
  scenarioId = '';

  // Trigger system (from RA scenario INI)
  private teamTypes: TeamType[] = [];
  private triggers: ScenarioTrigger[] = [];
  private globals = new Set<number>();
  private waypoints = new Map<number, { cx: number; cy: number }>();
  private toCarryOver = false; // save surviving units for next mission
  private theatre = 'TEMPERATE'; // map theatre (TEMPERATE, INTERIOR)
  /** C++ Scen.IsTanyaEvac — CivEvac=yes in [Basic]. Tanya (E7) counts as civ evac. */
  private isTanyaEvac = false;
  /** Per-scenario stat overrides (from INI [TypeName] sections) */
  private scenarioUnitStats: Record<string, UnitStats> = UNIT_STATS;
  private scenarioWeaponStats: Record<string, WeaponStats> = WEAPON_STATS;
  private scenarioProductionItems: ProductionItem[] = PRODUCTION_ITEMS;
  private warheadOverrides: Record<string, [number, number, number, number, number]> = {};
  private scenarioWarheadMeta: Record<string, WarheadMeta> = WARHEAD_META;
  private scenarioWarheadProps: Record<string, WarheadProps> = WARHEAD_PROPS;
  private inflightProjectiles: InflightProjectile[] = [];
  private alliances: AllianceTable = buildDefaultAlliances();
  private crateOverrides: { silver?: string; wood?: string; water?: string } = {};
  private allowWin = 0; // C++ house.h:335 Blockage counter — each ALLOWWIN trigger increments; win requires <= 0
  // C++ house.cpp:4066-4112 — deferred win/lose flags with savour delay
  private isToWin = false;   // C++ HouseClass::IsToWin
  private isToLose = false;  // C++ HouseClass::IsToLose
  private borrowedTime = 0;  // C++ HouseClass::BorrowedTime — countdown before win/lose takes effect
  private missionTimer = 0; // mission countdown timer (in game ticks), 0 = inactive
  private missionTimerExpired = false;
  private builtStructureTypes = new Set<string>(); // types player has constructed (for TEVENT_BUILD)
  // C++ tevent.cpp TEVENT_BUILD parity: HouseClass::JustBuiltStructure is per-house.
  // houseIdx (HOUSE_TO_INDEX) → set of structure types that house has built.
  private builtStructureTypesByHouse = new Map<number, Set<string>>();
  /** EVA text message queue — displayed briefly on screen */
  private evaMessages: { text: string; tick: number }[] = [];
  /** Count of units that have left the map (for TEVENT_LEAVES_MAP) */
  private unitsLeftMap = 0;
  /** Count of civilian units that have been evacuated (for TEVENT_EVAC_CIVILIAN) */
  private civiliansEvacuated = 0;
  /** Cached bridge cell count (recalculated periodically) */
  private bridgeCellCount = 0;
  /** Persistent set of trigger names whose attached entities/structures were destroyed */
  private destroyedTriggerNames = new Set<string>();
  /** Transient set of trigger names whose attached objects were damaged this tick */
  private attackedTriggerNames = new Set<string>();
  /** Running total of enemy buildings destroyed (for NBUILDINGS_DESTROYED) */
  private nBuildingsDestroyedCount = 0;
  /** Trigger names of spy-infiltrated buildings (for TEVENT_SPIED) */
  private spiedBuildingTriggers = new Set<string>();
  /** C++ House.IsThieved — set when a Thief infiltrates PROC/SILO (for TEVENT_THIEVED) */
  private isThieved = false;
  /** Whether the mission timer is actively counting down */
  private missionTimerRunning = true;
  /** Teams marked as destroyed by DESTROY_TEAM action */
  private destroyedTeams = new Set<number>();
  /** Unit types player has built (for TEVENT_BUILD_UNIT) */
  private builtUnitTypes = new Set<string>();
  /** Infantry types player has built (for TEVENT_BUILD_INFANTRY) */
  private builtInfantryTypes = new Set<string>();
  /** Aircraft types player has built (for TEVENT_BUILD_AIRCRAFT) */
  private builtAircraftTypes = new Set<string>();

  // C++ parity (#21): per-entity discovery tracking (TEVENT_DISCOVERED)
  /** Entity IDs that have been discovered by the player (revealed while enemy-owned) */
  private discoveredEntityIds = new Set<number>();
  /** Structure indices that have been discovered by the player */
  private discoveredStructureIds = new Set<number>();
  // C++ parity (#21): per-house discovery tracking (TEVENT_HOUSE_DISCOVERED)
  /** RA house indices whose IsDiscovered flag has been set (any unit of house first seen) */
  private houseDiscovered = new Map<number, boolean>();

  // Turbo mode (for E2E test runner)
  turboMultiplier = 2;
  // Trigger debug logging
  debugTriggers = false;
  // Player game speed (cycles 1→2→4→1 with backtick key) — default 2× (C++ GameSpeed=1 feel)
  gameSpeed = 2;
  // Mission stats
  structuresBuilt = 0;
  structuresLost = 0;

  // Base discovery — player must find their base before production is available
  private baseDiscovered = false;

  // AI autocreate flag — gated by trigger action
  private autocreateEnabled = false;
  /** C++ TeamTypeClass::Number — active instance count per team type index */
  private autocreateTeamCounts = new Map<number, number>();
  // AI base rebuild system
  private baseBlueprint: Array<{ type: string; cell: number; house: House }> = [];
  private baseRebuildQueue: Array<{ type: string; cell: number; house: House }> = [];
  private baseRebuildCooldown = 0;

  // Comparison mode — activated via ?anttest=compare
  comparisonMode = false;
  /** When true, fog of war is disabled (all cells visible) */
  fogDisabled = false;
  // fogReEnableTick removed — C++ RadarSpied is permanent, no re-enable timer (infantry.cpp:660-662)
  /** C++ house.h:268 IsGPSActive — GPS satellite launched, full map revealed.
   *  Cleared when ATEK is destroyed (house.cpp:1420-1425). */
  gpsActive = false;

  // Per-house fog-of-war — C++ techno.cpp:1467+ Evaluate_Object checks Is_Discovered_By_House.
  // Each house has its own revealed cell set, computed from entity/structure sight radii.
  private _houseRevealed = new Map<number, Set<number>>();

  // Pause menu state
  pauseMenuOpen = false;
  pauseMenuHighlight = 0; // keyboard nav index (0-5)
  onMenuAction?: (action: 'restart' | 'abort') => void;

  // Callbacks
  onStateChange?: (state: GameState) => void;
  onLoadProgress?: (loaded: number, total: number) => void;
  onTick?: (game: Game) => void;
  onPostRender?: () => void;

  // Internal
  private canvas: HTMLCanvasElement;
  private stopped = false;
  private timerId = 0;
  private lastTime = 0;
  private accumulator = 0;
  private readonly tickInterval = 1000 / GAME_TICKS_PER_SEC;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.assets = getSharedAssets();
    this.audio = new AudioManager();
    // Game viewport is narrower than canvas to leave room for sidebar
    this.camera = new Camera(canvas.width - Game.SIDEBAR_W, canvas.height);
    this.input = new InputManager(canvas);
    this.map = new GameMap();
    this.renderer = new Renderer(canvas);
    canvas.style.cursor = 'none'; // hide native cursor — we draw our own
  }

  // ─── Subsystem context accessors ─────────────────────────────────
  // These create thin adapter objects that satisfy subsystem context interfaces,
  // binding Game's private methods as callbacks. Used by delegating methods below.

  private get _combatCtx(): CombatContext {
    return {
      entities: this.entities,
      entityById: this.entityById,
      structures: this.structures,
      inflightProjectiles: this.inflightProjectiles,
      effects: this.effects,
      logicAnims: this.logicAnims,
      logicAnimsAlreadyProcessed: this.logicAnimsProcessedThisTick,
      logicIndexHintForNewObject: () => this.logicIndexHintForNewObject(),
      tick: this.tick,
      playerHouse: this.playerHouse,
      scenarioId: this.scenarioId,
      killCount: this.killCount,
      lossCount: this.lossCount,
      pointTotal: this.pointTotal,
      alliedUnitsLost: this.alliedUnitsLost,
      sovietUnitsLost: this.sovietUnitsLost,
      alliedBuildingsLost: this.alliedBuildingsLost,
      sovietBuildingsLost: this.sovietBuildingsLost,
      warheadOverrides: this.warheadOverrides,
      scenarioWarheadMeta: this.scenarioWarheadMeta,
      scenarioWarheadProps: this.scenarioWarheadProps,
      attackedTriggerNames: this.attackedTriggerNames,
      map: this.map,
      // damageStructure state
      aiStates: this.aiStates as Map<House, { lastBaseAttackTick: number; underAttack: boolean; iq: number }>,
      lastBaseAttackEva: this.lastBaseAttackEva,
      gameTicksPerSec: GAME_TICKS_PER_SEC,
      gapGeneratorCells: this.gapGeneratorCells,
      nBuildingsDestroyedCount: this.nBuildingsDestroyedCount,
      structuresLost: this.structuresLost,
      bridgeCellCount: this.bridgeCellCount,
      // Structure combat state
      powerConsumed: this.powerConsumed,
      powerProduced: this.powerProduced,
      isAllied: (a, b) => this.isAllied(a, b),
      entitiesAllied: (a, b) => this.entitiesAllied(a, b),
      isPlayerControlled: (e) => this.isPlayerControlled(e),
      playSoundAt: (n, x, y) => this.playSoundAt(n as SoundName, x, y),
      playEva: (n) => this.playEva(n as SoundName),
      minimapAlert: (cx, cy) => this.minimapAlert(cx, cy),
      movementSpeed: (e) => this.movementSpeed(e),
      stopInfantryDriver: (e) => this.stopInfantryDriver(e),
      canStopInfantryDriverForAssignDestination: (e) => this.canStopInfantryDriverForAssignDestination(e),
      idleMission: (e) => this.idleMission(e),
      markDiscoveredIfPlayerVisible: (e) => this.markDiscoveredIfPlayerVisible(e),
      getFirepowerBias: (h) => this.getFirepowerBias(h),
      getArmorBias: (h) => this.getArmorBias(h),
      getROFBias: (h) => this.getROFBias(h),
      damageStructure: (s, d) => this.damageStructure(s, d),
      suspendTeamsByPriority: (house, priority) => suspendTeamsByPriority(house, priority),
      houseTechLevel: (house) => this.houseTechLevels.get(house) ?? this.defaultScenarioTechLevel(),
      springAttackedTriggerByName: (triggerName) => this.springAttackedTriggerByName(triggerName),
      aiIQ: (h) => this.aiStates.get(h)?.iq ?? 0,
      warheadMuzzleColor: (w) => this.warheadMuzzleColor(w as WarheadType),
      // damageStructure callbacks
      clearStructureFootprint: (s) => this.clearStructureFootprint(s),
      recalculateSiloCapacity: () => this.recalculateSiloCapacity(),
      showEvaMessage: (id) => this.showEvaMessage(id),
      get screenShake() { return 0; },
      set screenShake(v: number) { /* set on return */ },
      get screenFlash() { return 0; },
      set screenFlash(v: number) { /* set on return */ },
    };
  }

  private logicIndexHintForNewObject(): number {
    let count = 0;
    let maxExistingHint = -1;
    for (const entity of this.entities) {
      if (entity.occupiesCppLogic()) {
        count++;
        if (entity.logicIndexHint !== undefined) {
          maxExistingHint = Math.max(maxExistingHint, entity.logicIndexHint);
        }
      }
    }
    for (const structure of this.structures) {
      if (structure.alive) count++;
    }
    count += this.inflightProjectiles.length;
    count += this.logicAnims.length;
    count += this.effects.filter(effect => effect.cppLogicSlot === true).length;

    for (const projectile of this.inflightProjectiles) {
      if (projectile.logicIndexHint !== undefined) {
        maxExistingHint = Math.max(maxExistingHint, projectile.logicIndexHint);
      }
    }
    return Math.max(count, maxExistingHint + 1);
  }

  private defaultScenarioTechLevel(): number {
    const match = this.scenarioId.match(/^SC[GAU](\d+)/i);
    return match ? Math.max(1, parseInt(match[1], 10)) : 10;
  }

  /** Run a combat subsystem function with proper renderer state sync */
  private _runCombat<T>(fn: (ctx: CombatContext) => T): T {
    const ctx = this._combatCtx;
    // Proxy screenShake/screenFlash through renderer
    let shake = this.renderer.screenShake;
    let flash = this.renderer.screenFlash;
    Object.defineProperty(ctx, 'screenShake', {
      get: () => shake,
      set: (v: number) => { shake = v; this.renderer.screenShake = Math.max(this.renderer.screenShake, v); },
      configurable: true,
    });
    Object.defineProperty(ctx, 'screenFlash', {
      get: () => flash,
      set: (v: number) => { flash = v; this.renderer.screenFlash = Math.max(this.renderer.screenFlash, v); },
      configurable: true,
    });
    const result = fn(ctx);
    // Sync mutable state back
    this.killCount = ctx.killCount;
    this.lossCount = ctx.lossCount;
    this.pointTotal = ctx.pointTotal;
    this.alliedUnitsLost = ctx.alliedUnitsLost;
    this.sovietUnitsLost = ctx.sovietUnitsLost;
    this.alliedBuildingsLost = ctx.alliedBuildingsLost;
    this.sovietBuildingsLost = ctx.sovietBuildingsLost;
    this.inflightProjectiles = ctx.inflightProjectiles;
    // damageStructure mutable state sync
    this.lastBaseAttackEva = ctx.lastBaseAttackEva;
    this.nBuildingsDestroyedCount = ctx.nBuildingsDestroyedCount;
    this.structuresLost = ctx.structuresLost;
    this.bridgeCellCount = ctx.bridgeCellCount;
    return result;
  }

  private get _fogCtx(): FogContext {
    return {
      entities: this.entities,
      structures: this.structures,
      map: this.map,
      tick: this.tick,
      playerHouse: this.playerHouse,
      fogDisabled: this.fogDisabled,
      gpsActive: this.gpsActive,
      baseDiscovered: this.baseDiscovered,
      powerProduced: this.powerProduced,
      powerConsumed: this.powerConsumed,
      gapGeneratorCells: this.gapGeneratorCells,
      isAllied: (a, b) => this.isAllied(a, b),
      entitiesAllied: (a, b) => this.entitiesAllied(a, b),
    };
  }

  private get _repairSellCtx(): RepairSellContext {
    return {
      structures: this.structures,
      entities: this.entities,
      credits: this.credits,
      tick: this.tick,
      playerHouse: this.playerHouse,
      powerProduced: this.powerProduced,
      powerConsumed: this.powerConsumed,
      repairingStructures: this.repairingStructures,
      scenarioProductionItems: this.scenarioProductionItems,
      effects: this.effects,
      siloCapacity: this.siloCapacity,
      gapGeneratorCells: this.gapGeneratorCells,
      isAllied: (a, b) => this.isAllied(a, b),
      isPlayerControlled: (e) => this.isPlayerControlled(e),
      playEva: (n) => this.playEva(n as SoundName),
      playSound: (n) => this.audio.play(n as SoundName),
      playSoundAt: (n, x, y) => this.playSoundAt(n as SoundName, x, y),
      clearStructureFootprint: (s) => this.clearStructureFootprint(s),
    };
  }

  /** Run repair/sell function with credit sync */
  private _runRepairSell<T>(fn: (ctx: RepairSellContext) => T): T {
    const ctx = this._repairSellCtx;
    const result = fn(ctx);
    this.credits = ctx.credits;
    return result;
  }

  private get _specialUnitsCtx(): SpecialUnitsContext {
    return {
      entities: this.entities,
      entityById: this.entityById,
      structures: this.structures,
      mines: this.mines,
      activeVortices: this.activeVortices,
      effects: this.effects,
      tick: this.tick,
      playerHouse: this.playerHouse,
      credits: this.credits,
      houseCredits: this.houseCredits,
      map: this.map,
      evaMessages: this.evaMessages,
      isThieved: this.isThieved,
      isAllied: (a, b) => this.isAllied(a, b),
      entitiesAllied: (a, b) => this.entitiesAllied(a, b),
      isPlayerControlled: (e) => this.isPlayerControlled(e),
      playSoundAt: (n, x, y) => this.playSoundAt(n as SoundName, x, y),
      playSound: (n) => this.audio.play(n as SoundName),
      movementSpeed: (e) => this.movementSpeed(e),
      damageEntity: (t, a, w, opts) => this.damageEntity(t, a, w as WarheadType, undefined, opts?.forced ? {
        skipHouseArmorBias: true,
        skipEntityArmorBias: true,
        skipProneBias: true,
      } : undefined),
      damageStructure: (s, d) => this.damageStructure(s, d),
      addEntity: (e) => { this.entities.push(e); this.entityById.set(e.id, e); },
      screenShake: this.renderer.screenShake,
    };
  }

  /** Run special units function with state sync */
  private _runSpecialUnits<T>(fn: (ctx: SpecialUnitsContext) => T): T {
    const ctx = this._specialUnitsCtx;
    const result = fn(ctx);
    this.credits = ctx.credits;
    this.isThieved = ctx.isThieved;
    this.renderer.screenShake = Math.max(this.renderer.screenShake, ctx.screenShake);
    return result;
  }

  private get _superweaponCtx(): SuperweaponContext {
    return {
      structures: this.structures,
      entities: this.entities,
      entityById: this.entityById,
      superweapons: this.superweapons,
      effects: this.effects,
      tick: this.tick,
      playerHouse: this.playerHouse,
      powerProduced: this.powerProduced,
      powerConsumed: this.powerConsumed,
      killCount: this.killCount,
      lossCount: this.lossCount,
      map: this.map,
      gapGeneratorCells: this.gapGeneratorCells,
      sonarSpiedTarget: this.sonarSpiedTarget,
      gpsActive: this.gpsActive,
      nukePendingTarget: this.nukePendingTarget,
      nukePendingTick: this.nukePendingTick,
      nukePendingSource: this.nukePendingSource,
      isAllied: (a, b) => this.isAllied(a, b),
      isPlayerControlled: (e) => this.isPlayerControlled(e),
      pushEva: (t) => this.pushEva(t),
      playSound: (n) => this.audio.play(n as SoundName),
      playSoundAt: (n, x, y) => this.playSoundAt(n as SoundName, x, y),
      damageEntity: (t, a, w) => this.damageEntity(t, a, w as WarheadType),
      damageStructure: (s, d) => this.damageStructure(s, d),
      addEntity: (e) => { this.entities.push(e); this.entityById.set(e.id, e); },
      aiIQ: (h) => this.aiStates.get(h)?.iq ?? 0,
      getWarheadMult: (w, a) => this.getWarheadMult(w as WarheadType, a as ArmorType),
      cameraX: this.camera.x,
      cameraY: this.camera.y,
      cameraViewWidth: this.camera.viewWidth,
      screenShake: this.renderer.screenShake,
      screenFlash: this.renderer.screenFlash,
      whitePaletteFade: this.renderer.whitePaletteFade,
      activeVortices: this.activeVortices,
      timeQuake: this.timeQuake,
    };
  }

  /** Run superweapon function with state sync */
  private _runSuperweapon<T>(fn: (ctx: SuperweaponContext) => T): T {
    const ctx = this._superweaponCtx;
    const result = fn(ctx);
    this.killCount = ctx.killCount;
    this.lossCount = ctx.lossCount;
    this.gpsActive = ctx.gpsActive;
    this.nukePendingTarget = ctx.nukePendingTarget;
    this.nukePendingTick = ctx.nukePendingTick;
    this.nukePendingSource = ctx.nukePendingSource;
    this.renderer.screenShake = Math.max(this.renderer.screenShake, ctx.screenShake);
    this.renderer.screenFlash = Math.max(this.renderer.screenFlash, ctx.screenFlash);
    if (ctx.whitePaletteFade !== undefined) {
      this.renderer.whitePaletteFade = Math.max(this.renderer.whitePaletteFade, ctx.whitePaletteFade);
    }
    if (ctx.timeQuake !== undefined) this.timeQuake = ctx.timeQuake;
    return result;
  }

  private get _productionCtx(): ProductionContext {
    return {
      structures: this.structures,
      entities: this.entities,
      entityById: this.entityById,
      credits: this.credits,
      playerHouse: this.playerHouse,
      playerFaction: this.playerFaction,
      playerTechLevel: this.playerTechLevel,
      baseDiscovered: this.baseDiscovered,
      scenarioProductionItems: this.scenarioProductionItems,
      productionQueue: this.productionQueue,
      pendingPlacement: this.pendingPlacement,
      wallPlacementPrepaid: this.wallPlacementPrepaid,
      map: this.map,
      tick: this.tick,
      powerProduced: this.powerProduced,
      powerConsumed: this.powerConsumed,
      builtUnitTypes: this.builtUnitTypes,
      builtInfantryTypes: this.builtInfantryTypes,
      builtAircraftTypes: this.builtAircraftTypes,
      rallyPoints: this.rallyPoints,
      isAllied: (a, b) => this.isAllied(a, b),
      hasBuilding: (t) => this.hasBuilding(t),
      playSound: (n) => this.audio.play(n as SoundName),
      playEva: (n) => this.playEva(n as SoundName),
      addEntity: (e) => { this.entities.push(e); this.entityById.set(e.id, e); },
      findPassableSpawn: (cx, cy, scx, scy, fw, fh) => this.findPassableSpawn(cx, cy, scx, scy, fw, fh),
    };
  }

  /** Run production function with state sync */
  private _runProduction<T>(fn: (ctx: ProductionContext) => T): T {
    const ctx = this._productionCtx;
    const result = fn(ctx);
    this.credits = ctx.credits;
    this.pendingPlacement = ctx.pendingPlacement;
    this.wallPlacementPrepaid = ctx.wallPlacementPrepaid;
    return result;
  }

  private get _harvesterCtx(): HarvesterContext {
    return {
      entities: this.entities,
      structures: this.structures,
      houseCredits: this.houseCredits,
      map: this.map,
      isAllied: (a, b) => this.isAllied(a, b),
      isPlayerControlled: (e) => this.isPlayerControlled(e),
      playSound: (n) => this.audio.play(n as SoundName),
      addCredits: (amount) => { this.addCredits(amount); this.harvestedCredits += amount; },
      startDriveClassMove: (entity) => this.startDriveClassMove(entity),
    };
  }

  /** Run harvester function (no mutable scalar state to sync — credits flow through addCredits callback) */
  private _runHarvester<T>(fn: (ctx: HarvesterContext) => T): T {
    return fn(this._harvesterCtx);
  }

  private get _placementCtx(): PlacementContext {
    return {
      structures: this.structures,
      entities: this.entities,
      entityById: this.entityById,
      credits: this.credits,
      tick: this.tick,
      playerHouse: this.playerHouse,
      pendingPlacement: this.pendingPlacement,
      wallPlacementPrepaid: this.wallPlacementPrepaid,
      cachedAvailableItems: this.cachedAvailableItems,
      evaMessages: this.evaMessages,
      effects: this.effects,
      map: this.map,
      aiStates: this.aiStates,
      isAllied: (a, b) => this.isAllied(a, b),
      playSound: (n) => this.audio.play(n as SoundName),
      getAvailableItems: () => this.getAvailableItems(),
      findPassableSpawn: (cx, cy, scx, scy, fw, fh) => this.findPassableSpawn(cx, cy, scx, scy, fw, fh),
    };
  }

  /** Run placement function with state sync */
  private _runPlacement<T>(fn: (ctx: PlacementContext) => T): T {
    const ctx = this._placementCtx;
    const result = fn(ctx);
    this.credits = ctx.credits;
    this.pendingPlacement = ctx.pendingPlacement;
    this.wallPlacementPrepaid = ctx.wallPlacementPrepaid;
    this.cachedAvailableItems = ctx.cachedAvailableItems;
    return result;
  }

  private get _aircraftCtx(): AircraftContext {
    return {
      entities: this.entities,
      entityById: this.entityById,
      structures: this.structures,
      map: this.map,
      houseEdges: this.houseEdges,
      tick: this.tick,
      unitsLeftMap: this.unitsLeftMap,
      civiliansEvacuated: this.civiliansEvacuated,
      isTanyaEvac: this.isTanyaEvac,
      isAllied: (a, b) => this.isAllied(a, b),
      movementSpeed: (e) => this.movementSpeed(e),
      idleMission: (e) => this.idleMission(e),
      fireWeaponAt: (a, t, w) => this.fireWeaponAt(a, t, w),
      fireWeaponAtCoord: (a, w, p) => this.fireWeaponAtCoord(a, w, p),
      fireWeaponAtStructure: (a, s, w) => this.fireWeaponAtStructure(a, s, w),
      getROFBias: (h) => this.getROFBias(h),
      getPowerFraction: (h) => this._housePowerFraction(h),
      // C++ house.cpp:2022 — HouseClass::Available_Money() = Tiberium + Credits.
      // TS folds harvested tiberium into the silo-capped credits pool, so the
      // per-house money is the player's `credits` for the player house and the
      // `houseCredits` map for AI houses.
      availableMoney: (h) => h === this.playerHouse
        ? this.credits
        : (this.houseCredits.get(h) ?? 0),
    };
  }

  /** C++ house.cpp:4160: Power_Fraction() = Power/Drain, capped at 1.0.
   *  Player house uses tracked powerProduced/powerConsumed.
   *  AI houses assume full power (1.0) — per-house power tracking not yet modeled. */
  private _housePowerFraction(house: House): number {
    if (house === this.playerHouse) {
      if (this.powerConsumed <= 0) return 1.0;
      return Math.min(1.0, this.powerProduced / this.powerConsumed);
    }
    // AI houses: assume full power
    return 1.0;
  }

  /** Run aircraft subsystem function with mutable state sync */
  private _runAircraft<T>(fn: (ctx: AircraftContext) => T): T {
    const ctx = this._aircraftCtx;
    const result = fn(ctx);
    this.unitsLeftMap = ctx.unitsLeftMap;
    this.civiliansEvacuated = ctx.civiliansEvacuated;
    return result;
  }

  private get _crateCtx(): CrateContext {
    return {
      crates: this.crates,
      entities: this.entities,
      entityById: this.entityById,
      structures: this.structures,
      effects: this.effects,
      evaMessages: this.evaMessages,
      activeVortices: this.activeVortices,
      visionaryHouses: this.visionaryHouses,
      credits: this.credits,
      tick: this.tick,
      playerHouse: this.playerHouse,
      screenShake: this.renderer.screenShake,
      map: this.map,
      crateOverrides: this.crateOverrides,
      addCredits: (amount, showMessage) => this.addCredits(amount, showMessage),
      playSoundAt: (n, x, y) => this.playSoundAt(n as SoundName, x, y),
      playSound: (n) => this.audio.play(n as SoundName),
      damageEntity: (t, a, w) => this.damageEntity(t, a, w as WarheadType),
      damageStructure: (s, d) => this.damageStructure(s, d),
      detonateNuke: (target) => this.detonateNuke(target),
      isAllied: (a, b) => this.isAllied(a, b),
    };
  }

  /** Run crate function with state sync */
  private _runCrate<T>(fn: (ctx: CrateContext) => T): T {
    const ctx = this._crateCtx;
    const result = fn(ctx);
    // Note: credits flow through ctx.addCredits() callback — no scalar sync needed
    this.renderer.screenShake = Math.max(this.renderer.screenShake, ctx.screenShake);
    return result;
  }

  private get _aiCtx(): AIContext {
    return {
      entities: this.entities,
      entityById: this.entityById,
      structures: this.structures,
      map: this.map,
      tick: this.tick,
      playerHouse: this.playerHouse,
      scenarioId: this.scenarioId,
      difficulty: this.difficulty,
      aiStates: this.aiStates,
      houseCredits: this.houseCredits,
      houseIQs: this.houseIQs,
      houseTechLevels: this.houseTechLevels,
      houseMaxUnits: this.houseMaxUnits,
      houseMaxInfantry: this.houseMaxInfantry,
      houseMaxBuildings: this.houseMaxBuildings,
      baseBlueprint: this.baseBlueprint,
      baseRebuildQueue: this.baseRebuildQueue,
      baseRebuildCooldown: this.baseRebuildCooldown,
      scenarioProductionItems: this.scenarioProductionItems,
      scenarioUnitStats: this.scenarioUnitStats,
      scenarioWeaponStats: this.scenarioWeaponStats,
      nextWaveId: this.nextWaveId,
      autocreateEnabled: this.autocreateEnabled,
      teamTypes: this.teamTypes,
      activeTeams: getActiveTeams(),
      destroyedTeams: this.destroyedTeams,
      autocreateTeamCounts: this.autocreateTeamCounts,
      waypoints: this.waypoints,
      houseEdges: this.houseEdges,
      effects: this.effects as AIContext['effects'],
      isAllied: (a, b) => this.isAllied(a, b),
      isPlayerControlled: (e) => this.isPlayerControlled(e),
      clearStructureFootprint: (s) => this.clearStructureFootprint(s),
    };
  }

  /** Run an AI subsystem function with state sync */
  private _runAI<T>(fn: (ctx: AIContext) => T): T {
    const ctx = this._aiCtx;
    const result = fn(ctx);
    // Sync mutable scalars back
    this.baseRebuildCooldown = ctx.baseRebuildCooldown;
    this.nextWaveId = ctx.nextWaveId;
    return result;
  }

  private get _missionAICtx(): MissionAIContext {
    // Capture Game instance for getter/setter — avoids nested context sync bug
    // where _runCombat updates this.killCount but the snapshot on ctx is stale.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const game = this;
    return {
      entities: this.entities,
      structures: this.structures,
      effects: this.effects,
      logicAnims: this.logicAnims,
      map: this.map,
      tick: this.tick,
      playerHouse: this.playerHouse,
      get killCount() { return game.killCount; },
      set killCount(v: number) { game.killCount = v; },
      evaMessages: this.evaMessages,
      warheadOverrides: this.warheadOverrides,
      scenarioWarheadMeta: this.scenarioWarheadMeta,
      scenarioWarheadProps: this.scenarioWarheadProps,
      isAllied: (a, b) => this.isAllied(a, b),
      entitiesAllied: (a, b) => this.entitiesAllied(a, b),
      isPlayerControlled: (e) => this.isPlayerControlled(e),
      movementSpeed: (e) => this.movementSpeed(e),
      infantryStartDriver: (e, cx, cy) => this.infantryStartDriver(e, cx, cy),
      infantryCanEnterCell: (e, cx, cy, facing) => this.infantryCanEnterCell(e, cx, cy, facing),
      stopInfantryDriver: (e) => this.stopInfantryDriver(e),
      infantryValidatePath: (e) => this.infantryValidatePath(e),
      approachTarget: (e) => this.approachTarget(e),
      playSoundAt: (n, x, y) => this.playSoundAt(n as SoundName, x, y),
      playEva: (n) => this.playEva(n as SoundName),
      playSound: (n) => this.audio.play(n as SoundName),
      weaponSound: (n) => this.audio.weaponSound(n),
      damageEntity: (t, a, w, att) => this.damageEntity(t, a, w, att),
      damageStructure: (s, d) => this.damageStructure(s, d),
      handleUnitDeath: (v, o) => this.handleUnitDeath(v, o),
      launchProjectile: (a, t, w, d, ix, iy, dh, lc) => this.launchProjectile(a, t, w, d, ix, iy, dh, lc),
      revealShooterFromFire: (e) => this.revealShooterFromFire(e),
      applySplashDamage: (c, w, pid, ah, att) => this.applySplashDamage(c, w, pid, ah, att),
      getFirepowerBias: (h) => this.getFirepowerBias(h),
      getArmorBias: (h) => this.getArmorBias(h),
      getROFBias: (h) => this.getROFBias(h),
      getWarheadMult: (w, a) => this.getWarheadMult(w, a),
      getWarheadMeta: (w) => this.getWarheadMeta(w),
      getWarheadProps: (w) => this.getWarheadProps(w as WarheadType),
      warheadMuzzleColor: (w) => this.warheadMuzzleColor(w as WarheadType),
      weaponProjectileStyle: (n) => this.weaponProjectileStyle(n),
      idleMission: (e) => this.idleMission(e),
      retreatFromTarget: (e, p) => this.retreatFromTarget(e, p),
      threatScore: (s, t, d) => this.threatScore(s, t, d),
      isDiscoveredByPlayer: (e) => e.house === this.playerHouse || this.discoveredEntityIds.has(e.id),
      isDiscoveredStructureByPlayer: (s) => {
        if (s.house === this.playerHouse) return true;
        const idx = this.structures.indexOf(s);
        return idx >= 0 && this.discoveredStructureIds.has(idx);
      },
      updateDemoTruck: (e) => this.updateDemoTruck(e),
      updateMedic: (e) => this.updateMedic(e),
      updateMechanicUnit: (e) => this.updateMechanicUnit(e),
      updateTanyaC4: (e) => this.updateTanyaC4(e),
      updateThief: (e) => this.updateThief(e),
      spyDisguise: (s, t) => this.spyDisguise(s, t),
      spyInfiltrate: (s, st) => this.spyInfiltrate(s, st),
      minimapAlert: (cx, cy) => this.minimapAlert(cx, cy),
      isRevealedToHouse: (cx, cy, hi) => this.isRevealedToHouse(cx, cy, hi),
    };
  }

  /** Run a mission AI subsystem function with state sync */
  private _runMissionAI<T>(fn: (ctx: MissionAIContext) => T): T {
    const ctx = this._missionAICtx;
    const result = fn(ctx);
    // killCount syncs live via getter/setter on ctx (no snapshot overwrite)
    return result;
  }

  /** Load assets and start a scenario */
  async start(scenarioId = 'SCA01EA', difficulty: Difficulty = 'normal'): Promise<void> {
    this.state = 'loading';
    this.stopped = false;
    this.tick = 0;
    this.scenarioId = scenarioId;
    this.difficulty = difficulty;
    this.onStateChange?.('loading');
    resetEntityIds();
    _clearAllTeams();

    // Initialize audio (needs user gesture context — start() is called from click)
    this.audio.init();
    this.audio.resume();
    // Start loading real audio samples in background (non-blocking).
    // Synthesized sounds are used as fallback until samples are ready.
    this.audio.loadSamples();

    // Load sprite sheets
    await this.assets.loadAll((loaded, total) => {
      this.onLoadProgress?.(loaded, total);
    });

    // Load scenario (pass assets for per-icon terrain classification from tileset metadata)
    const scenario = await loadScenario(scenarioId, this.assets);
    this.map = scenario.map;
    this.entities = scenario.entities;
    this.structures = scenario.structures;
    // C++ Logic layer parity: all entities from scenario INI are "pre-building" entities.
    // They were added to the C++ Logic array before buildings during Read_Scenario_INI.
    // Entities added later (reinforcements, created teams) go after buildings.
    this._preBuildingEntityCount = scenario.entities.length;
    this._terrainMineCount = scenario.terrainMineCount ?? 0;
    this._terrainMineSpreadCells = scenario.terrainMineSpreadCells ?? [];
    this.entityById.clear();
    for (const e of scenario.entities) this.entityById.set(e.id, e);
    this.missionName = scenario.name;
    this.missionBriefing = scenario.briefing;
    this.waypoints = scenario.waypoints;
    this.teamTypes = scenario.teamTypes;
    this.triggers = scenario.triggers;
    this.credits = scenario.credits;
    this.initialCredits = scenario.credits; // C++ Control.InitialCredits — capture before gameplay
    this.playerHouse = scenario.playerHouse;
    this.playerFaction = HOUSE_FACTION[this.playerHouse] ?? 'allied';
    this.playerTechLevel = scenario.playerTechLevel ?? 10;
    // Calculate initial silo capacity (do NOT cap starting credits — C++ parity)
    // C++ house.cpp:7146-7147: starting credits go into the uncapped Credits pool,
    // not the Tiberium pool. Silo capacity only limits HARVESTED ore.
    this.siloCapacity = this.calculateSiloCapacity();
    this.lastSiloWarningTick = -450; // allow immediate silo warning if needed
    this.toCarryOver = scenario.toCarryOver;
    this.theatre = scenario.theatre;
    this.isTanyaEvac = scenario.isTanyaEvac;
    this.scenarioUnitStats = scenario.scenarioUnitStats;
    this.scenarioWeaponStats = scenario.scenarioWeaponStats;
    this.scenarioProductionItems = scenario.scenarioProductionItems;
    this.warheadOverrides = scenario.warheadOverrides;
    this.scenarioWarheadMeta = scenario.scenarioWarheadMeta;
    this.scenarioWarheadProps = scenario.scenarioWarheadProps;
    this.crateOverrides = scenario.crateOverrides;
    this.baseBlueprint = scenario.baseBlueprint ?? [];
    this.baseRebuildQueue = [];
    this.baseRebuildCooldown = 0;
    this.autocreateEnabled = false;
    this.baseDiscovered = false;
    this.productionQueue.clear();
    this.pendingPlacement = null;
    this.superweapons.clear();
    this.superweaponCursorMode = null;
    this.superweaponCursorHouse = null;
    this.chronoTankTargeting = null;
    this.nukePendingTarget = null;
    this.nukePendingTick = 0;
    this.nukePendingSource = null;
    this.globals.clear();
    // C++ scenario.cpp:2436-2441 — crates placed at tick 0 during scenario init
    this.nextCrateTick = 0;
    this.crates = [];
    this.inflightProjectiles = [];
    this.logicAnims = [];
    // Build alliance table: use scenario INI data if available, otherwise default (ant missions)
    if (scenario.houseAllies.size > 0) {
      this.alliances = buildAlliancesFromINI(scenario.houseAllies, this.playerHouse);
    } else {
      this.alliances = buildDefaultAlliances();
    }
    // Build player house set for Entity.isPlayerUnit — houses that the PLAYER considers allies.
    // C++ parity: isAllied checks the CALLER's alliance bitfield. Greece must declare
    // Allies=Turkey for Turkey to be player-controlled. Turkey declaring Allies=Greece
    // only makes Turkey consider Greece friendly, not vice versa.
    const playerHouseSet = new Set<House>();
    const playerAllies = this.alliances.get(this.playerHouse);
    if (playerAllies) {
      for (const ally of playerAllies) playerHouseSet.add(ally);
    }
    playerHouseSet.add(this.playerHouse);
    setPlayerHouses(playerHouseSet);
    // Sync to renderer
    this.renderer.playerHouses = playerHouseSet;
    // C++ scenario.cpp:618-625 — count ALLOWWIN triggers and init Blockage counter.
    // Each trigger with ALLOWWIN in action1 or (non-MULTI_ONLY=0) action2 increments Blockage.
    // actionControl: 0 = MULTI_ONLY, 1 = AND. C++ checks ActionControl != MULTI_ONLY (i.e. === 1).
    this.allowWin = 0;
    for (const t of this.triggers) {
      if (t.action1.action === 15 ||
          (t.actionControl === 1 && t.action2.action === 15)) {
        this.allowWin++;
      }
    }
    // C++ house.cpp:4066-4112 — reset deferred win/lose flags
    this.isToWin = false;
    this.isToLose = false;
    this.borrowedTime = 0;
    this.missionTimer = 0;
    this.missionTimerExpired = false;
    // Reset kill/loss counters — prevents TEVENT_NUNITS_DESTROYED from carrying
    // over between missions (e.g. SCA01EA kills → SCA02EA instant loss at tick 0).
    this.killCount = 0;
    this.lossCount = 0;
    this.pointTotal = 0;
    this.destroyedTriggerNames.clear();
    // Reset game loop accumulator — prevents turbo-speed carryover from previous
    // mission causing a burst of 60+ ticks on the first frame of the new mission,
    // which would blow past the tick<45 victory-check guard.
    this.accumulator = 0;
    this.builtStructureTypes.clear();
    this.builtStructureTypesByHouse.clear();
    this.evaMessages = [];
    this.unitsLeftMap = 0;
    this.civiliansEvacuated = 0;
    this.gameSpeed = 2;
    this.turboMultiplier = 2;
    this.structuresBuilt = 0;
    this.structuresLost = 0;
    this.bridgeCellCount = this.map.countBridgeCells();
    this.attackedTriggerNames.clear();
    this.nBuildingsDestroyedCount = 0;
    this.spiedBuildingTriggers.clear();
    this.isThieved = false;
    this.missionTimerRunning = true;
    this.destroyedTeams.clear();
    this.autocreateTeamCounts.clear();
    this.builtUnitTypes.clear();
    this.builtInfantryTypes.clear();
    this.builtAircraftTypes.clear();
    // Initialize trigger timers to game tick 0 (start of mission)
    for (const t of this.triggers) t.timerTick = 0;

    // Initialize AI house credits from scenario
    this.houseCredits.clear();
    for (const s of this.structures) {
      if (s.alive && s.type === 'PROC' && !this.isAllied(s.house, this.playerHouse)) {
        this.houseCredits.set(s.house, (this.houseCredits.get(s.house) ?? 0) + 200);
      }
    }
    // Add INI-defined Credits= for AI houses (e.g. [USSR] Credits=25 → 2500)
    for (const [house, credits] of scenario.houseCredits) {
      this.houseCredits.set(house, (this.houseCredits.get(house) ?? 0) + credits);
    }
    // Store house edges for reinforcement spawning
    this.houseEdges = scenario.houseEdges;
    // Store per-house IQ, TechLevel, and unit caps from scenario INI
    this.houseIQs = scenario.houseIQ;
    this.houseTechLevels = scenario.houseTechLevels;
    this.houseMaxUnits = scenario.houseMaxUnit;
    this.houseMaxInfantry = scenario.houseMaxInfantry;
    this.houseMaxBuildings = scenario.houseMaxBuilding;

    // Initialize strategic AI states for non-ant missions
    this.aiStates.clear();
    if (!scenarioId.startsWith('SCA')) {
      const aiHousesWithFact = new Set<House>();
      for (const s of this.structures) {
        if (s.alive && s.type === 'FACT' && !this.isAllied(s.house, this.playerHouse)) {
          aiHousesWithFact.add(s.house);
        }
      }
      for (const house of aiHousesWithFact) {
        this.aiStates.set(house, this.createAIHouseState(house));
      }
    }

    // Initial fog of war reveal
    this.updateFogOfWar();

    // Generous initial reveal — player should see a wide area at mission start
    // C++ All_To_Look(units_only=true) — only reveals around units, NOT buildings.
    // Buildings are intentionally hidden until player explores (base discovery mechanic).
    for (const e of this.entities) {
      if (e.isPlayerUnit) {
        const cx = Math.floor(e.pos.x / CELL_SIZE);
        const cy = Math.floor(e.pos.y / CELL_SIZE);
        this.revealAroundCell(cx, cy, 15);
      }
    }

    // H5: Clamp camera to playable bounds, not full 128x128 map
    this.camera.setPlayableBounds(this.map.boundsX, this.map.boundsY, this.map.boundsW, this.map.boundsH);

    // C++ display.cpp:3854 + 3743:
    //   tacticalCell = HOME - (5 cols, 4 rows)  // top-left of C++ LORES 10x8 viewport
    //   tacticalCell clamped to map bounds via Confine_Rect
    //   viewport_center_cell = tacticalCell + (5 cols, 4 rows)
    // This matches what WASM renders, including edge clamping when HOME is near map edge.
    const homeWp = this.waypoints.get(98);
    if (homeWp) {
      const offX = 5, offY = 4;
      const vpCols = 10, vpRows = 8;
      // Compute C++ tactical top-left and clamp to map bounds
      let topLeftCx = homeWp.cx - offX;
      let topLeftCy = homeWp.cy - offY;
      const mapMinCx = this.map.boundsX;
      const mapMinCy = this.map.boundsY;
      const mapMaxCx = this.map.boundsX + this.map.boundsW - vpCols;
      const mapMaxCy = this.map.boundsY + this.map.boundsH - vpRows;
      topLeftCx = Math.max(mapMinCx, Math.min(mapMaxCx, topLeftCx));
      topLeftCy = Math.max(mapMinCy, Math.min(mapMaxCy, topLeftCy));
      // Viewport center in world pixels
      const centerCx = topLeftCx + offX + 0.5;
      const centerCy = topLeftCy + offY + 0.5;
      this.camera.centerOn(centerCx * CELL_SIZE, centerCy * CELL_SIZE);
    } else {
      // Fallback: center on average player unit position
      const playerUnits = this.entities.filter(e => e.isPlayerUnit);
      if (playerUnits.length > 0) {
        const avg = playerUnits.reduce(
          (acc, e) => ({ x: acc.x + e.pos.x, y: acc.y + e.pos.y }),
          { x: 0, y: 0 }
        );
        this.camera.centerOn(
          avg.x / playerUnits.length,
          avg.y / playerUnits.length
        );
      }
    }

    // C++ parity: per-house fog starts EMPTY. Map.Sight_From runs AFTER Logic.AI
    // each frame, so at tick 1 the fog is empty and AI can't see anything through
    // it. The fog gets populated after tick 1's entity AI processes.
    // Do NOT call _updateHouseRevealed() here — that would let enemies see player
    // units at tick 1 (SCG07EA E4 targeting JEEP, SCG01EA enemy positioning).

    // If stop() was called during async loading, don't start the loop
    if (this.stopped) return;

    this.state = 'playing';
    this.onStateChange?.('playing');
    this.audio.startAmbient();
    this.audio.music.play();
    this.lastTime = performance.now();
    this.gameLoop();
  }

  /** Stop the game */
  stop(): void {
    this.state = 'paused';
    this.stopped = true;
    if (this.timerId) clearTimeout(this.timerId);
    this.timerId = 0;
    this.input.destroy();
    this.audio.destroy();
    this.canvas.style.cursor = 'default';
  }

  /** Toggle pause/unpause */
  togglePause(): void {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.pauseMenuOpen = true;
      this.pauseMenuHighlight = 0;
      this.renderer.showHelp = false; // close help when opening pause menu
      this.audio.music.pause();
      this.onStateChange?.('paused');
      // Start paused render loop (scheduleNext bails when not 'playing')
      this.timerId = window.setTimeout(this.gameLoop, 100);
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.pauseMenuOpen = false;
      this.audio.music.resume();
      this.onStateChange?.('playing');
      this.lastTime = performance.now();
      this.scheduleNext();
    }
  }

  /** Process input while pause menu is open */
  private processPauseMenuInput(): void {
    const { keys, leftClick } = this.input.state;
    const itemCount = 6; // RESUME, MUSIC, SOUND, SPEED, RESTART, ABORT

    // Escape/P: close menu + resume
    if (keys.has('p') || keys.has('Escape')) {
      keys.delete('p');
      keys.delete('Escape');
      this.togglePause();
      return;
    }

    // Arrow up/down: move highlight
    if (keys.has('ArrowUp')) {
      this.pauseMenuHighlight = (this.pauseMenuHighlight - 1 + itemCount) % itemCount;
      keys.delete('ArrowUp');
    }
    if (keys.has('ArrowDown')) {
      this.pauseMenuHighlight = (this.pauseMenuHighlight + 1) % itemCount;
      keys.delete('ArrowDown');
    }

    // Left/Right on sliders: adjust volume by 0.05
    if (keys.has('ArrowLeft')) {
      if (this.pauseMenuHighlight === 1) {
        this.audio.setMusicVolume(this.audio.getMusicVolume() - 0.05);
        this.saveSettings();
      } else if (this.pauseMenuHighlight === 2) {
        this.audio.setSfxVolume(this.audio.getSfxVolume() - 0.05);
        this.saveSettings();
      }
      keys.delete('ArrowLeft');
    }
    if (keys.has('ArrowRight')) {
      if (this.pauseMenuHighlight === 1) {
        this.audio.setMusicVolume(this.audio.getMusicVolume() + 0.05);
        this.saveSettings();
      } else if (this.pauseMenuHighlight === 2) {
        this.audio.setSfxVolume(this.audio.getSfxVolume() + 0.05);
        this.saveSettings();
      }
      keys.delete('ArrowRight');
    }

    // Enter: activate highlighted item
    if (keys.has('Enter')) {
      keys.delete('Enter');
      this.activatePauseMenuItem(this.pauseMenuHighlight);
      return;
    }

    // Backtick: cycle speed (legacy shortcut still works)
    if (keys.has('`')) {
      this.gameSpeed = this.gameSpeed === 1 ? 2 : this.gameSpeed === 2 ? 4 : 1;
      if (this.turboMultiplier <= 4) this.turboMultiplier = this.gameSpeed;
      this.saveSettings();
      keys.delete('`');
    }

    // Mouse click: hit-test menu items
    if (leftClick) {
      const hitAreas = this.renderer.getPauseMenuHitAreas();
      for (const area of hitAreas) {
        if (leftClick.x >= area.x && leftClick.x <= area.x + area.w &&
            leftClick.y >= area.y && leftClick.y <= area.y + area.h) {
          this.pauseMenuHighlight = area.index;
          if (area.type === 'slider') {
            // Only adjust volume if click is on/near the slider track
            const trackInfo = this.renderer.getSliderTrackInfo();
            if (leftClick.x >= trackInfo.x) {
              const val = this.renderer.sliderValueFromClick(leftClick.x, trackInfo);
              if (area.index === 1) this.audio.setMusicVolume(val);
              else if (area.index === 2) this.audio.setSfxVolume(val);
              this.saveSettings();
            }
          } else {
            this.activatePauseMenuItem(area.index);
          }
          break;
        }
      }
    }
  }

  /** Activate a pause menu item by index */
  private activatePauseMenuItem(index: number): void {
    switch (index) {
      case 0: // RESUME
        this.togglePause();
        break;
      case 3: // SPEED
        this.gameSpeed = this.gameSpeed === 1 ? 2 : this.gameSpeed === 2 ? 4 : 1;
        if (this.turboMultiplier <= 4) this.turboMultiplier = this.gameSpeed;
        this.saveSettings();
        break;
      case 4: // RESTART
        this.pauseMenuOpen = false;
        if (this.timerId) { clearTimeout(this.timerId); this.timerId = 0; }
        this.onMenuAction?.('restart');
        break;
      case 5: // ABORT
        this.pauseMenuOpen = false;
        if (this.timerId) { clearTimeout(this.timerId); this.timerId = 0; }
        this.onMenuAction?.('abort');
        break;
    }
  }

  /** Persist game settings to localStorage */
  saveSettings(): void {
    try {
      const settings = {
        musicVolume: this.audio.getMusicVolume(),
        sfxVolume: this.audio.getSfxVolume(),
        muted: this.audio.isMuted(),
        gameSpeed: this.gameSpeed,
      };
      localStorage.setItem('antmissions_settings', JSON.stringify(settings));
    } catch { /* ignore */ }
  }

  /** Pause for comparison mode (does not toggle — sets paused state) */
  pause(): void {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.audio.music.pause();
      this.onStateChange?.('paused');
      this.timerId = window.setTimeout(this.gameLoop, 100);
    }
  }

  /** Resume from comparison-mode pause */
  resume(): void {
    if (this.state === 'paused') {
      this.state = 'playing';
      this.audio.music.resume();
      this.onStateChange?.('playing');
      this.lastTime = performance.now();
      this.scheduleNext();
    }
  }

  /** Advance N ticks (for stepped comparison) then re-pause */
  step(n = 1): void {
    const wasPaused = this.state === 'paused';
    if (wasPaused) this.state = 'playing';
    for (let i = 0; i < n; i++) {
      // C++ agent_step breaks on do_tick() returning true (game over).
      // Match this: stop stepping when game enters won/lost state.
      if (this.state !== 'playing') break;
      this.update();
    }
    this.renderer.interpolationAlpha = 1; // agent step: show latest state, no interpolation
    this.render();
    if (wasPaused && this.state === 'playing') this.state = 'paused';
  }

  /** C++ parity: mark the end of scenario-init RNG.
   *  Scenario load now consumes the source-derived init RNG calls directly:
   *  HouseClass attack timers plus Map.Overpass ore/gem visual randomization. */
  consumeInitRNG(): void {
    // Set debug log start so gameplay calls are captured (not init calls)
    ScenarioRandom.debugLogStart = ScenarioRandom.callCount;
  }

  /** Disable fog of war (reveal entire map) */
  disableFog(): void {
    this.fogDisabled = true;
    this.map.revealAll();
  }

  /** Main game loop — uses setTimeout fallback when RAF is throttled */
  private gameLoop = (): void => {
    if (this.state === 'paused') {
      this.processPauseMenuInput();
      // Sync pause menu state to renderer
      this.renderer.pauseMenuOpen = this.pauseMenuOpen;
      this.renderer.pauseMenuHighlight = this.pauseMenuHighlight;
      this.renderer.pauseMenuMusicVolume = this.audio.getMusicVolume();
      this.renderer.pauseMenuSfxVolume = this.audio.getSfxVolume();
      this.renderer.pauseMenuGameSpeed = this.gameSpeed;
      this.renderer.gameSpeed = this.gameSpeed;
      // Render but don't tick — still show pause overlay
      this.renderer.interpolationAlpha = 1;
      this.render();
      this.input.clearEvents(); // prevent double-processing
      this.timerId = window.setTimeout(this.gameLoop, 100); // slow render rate while paused
      return;
    }
    if (this.state !== 'playing') {
      // Still render final frame but stop ticking
      this.renderer.interpolationAlpha = 1;
      this.render();
      return;
    }

    const now = performance.now();
    const dt = now - this.lastTime;
    this.lastTime = now;
    this.accumulator += Math.min(dt * this.turboMultiplier, 200 * this.turboMultiplier);

    // Fixed timestep updates (cap ticks per frame to avoid blocking)
    const maxTicksPerFrame = Math.max(this.turboMultiplier, 1);
    let ticksThisFrame = 0;
    while (this.accumulator >= this.tickInterval && ticksThisFrame < maxTicksPerFrame) {
      this.accumulator -= this.tickInterval;
      this.update();
      ticksThisFrame++;
      if (this.state !== 'playing') break;
    }
    // Drain excess accumulator to prevent spiral of death
    if (ticksThisFrame >= maxTicksPerFrame && this.accumulator > this.tickInterval) {
      this.accumulator = 0;
    }

    // Render interpolation: fraction of tick elapsed since last update (0-1)
    // Smooths entity movement between 15fps game ticks for 60fps visual rendering
    this.renderer.interpolationAlpha = this.tickInterval > 0
      ? Math.min(1, this.accumulator / this.tickInterval)
      : 1;

    this.render();
    this.scheduleNext();
  };

  /** Schedule next frame — prefer RAF, fall back to setTimeout */
  private scheduleNext(): void {
    if (this.state !== 'playing') return;
    // Use setTimeout as the primary timer — immune to Chrome RAF throttling.
    // 16ms ≈ 60fps render rate, game ticks at fixed 15fps inside (C++ default GameSpeed=4).
    this.timerId = window.setTimeout(this.gameLoop, 16);
  }

  /** Fixed-timestep game update */
  private update(): void {
    this.tick++;
    this.logicAnimsProcessedThisTick = false;
    (globalThis as any).__currentGameTick = this.tick;
    (globalThis as any).__missionTimerTrace = true;
    _advanceAircraftFrame(); // C++ ::Frame parity — advance hover jitter index

    // RNG audit: enable tagged logging for ticks 1-15.
    // When _tagLoggingExternal is set, an external test controls logging — skip built-in toggle.
    if (!ScenarioRandom._tagLoggingExternal) {
      if (this.tick === 1) {
        console.log('[RNG] tick 1 START: seed=' + (ScenarioRandom.seed >>> 0) + ' callCount=' + ScenarioRandom.callCount);
        ScenarioRandom._tagLogging = true;
        ScenarioRandom._taggedLog = [];
        ScenarioRandom._seedLog = [];
      }
      if (this.tick === 2) {
        console.log('[RNG] tick 2 START: seed=' + (ScenarioRandom.seed >>> 0) + ' callCount=' + ScenarioRandom.callCount + ' seedLogLen=' + ScenarioRandom._seedLog.length);
      }
      // Per-tick summary during audit window
      if (this.tick >= 1 && this.tick <= 15 && ScenarioRandom._tagLogging) {
        // Record start-of-tick call count for per-tick delta
        (this as any)._rngAuditTickStart = ScenarioRandom.callCount;
        (this as any)._rngAuditSeedLogStart = ScenarioRandom._seedLog.length;
      }
      if (this.tick > 15 && ScenarioRandom._tagLogging) {
        ScenarioRandom._tagLogging = false;
        console.log('[RNG AUDIT] Logging disabled after tick 15. Total seedLog entries: ' + ScenarioRandom._seedLog.length);
      }
    }

    // Periodically resume audio context if browser suspended it (e.g. tab blur)
    if (this.tick % 45 === 0) this.audio.resume();

    // Prune expired EVA messages (older than 5 seconds)
    if (this.tick % 75 === 0) {
      this.evaMessages = this.evaMessages.filter(m => this.tick - m.tick < 75);
    }

    // Cache available items once per tick (not every render frame)
    this.cachedAvailableItems = this.getAvailableItems();

    // Auto-player hook (before processInput — no conflict since no mouse events in test mode)
    this.onTick?.(this);

    // Process input (before clearing events so we can read them)
    this.processInput();

    // Clear one-shot events after consumption
    this.input.clearEvents();

    // Update cursor based on context
    this.updateCursor();

    // Minimap drag — if mouse is held down on minimap, continuously scroll
    if (this.input.state.mouseDown) {
      this.handleMinimapClick(this.input.state.mouseX, this.input.state.mouseY);
    }

    // Update camera scrolling
    this.camera.keyScroll(this.input.state.keys);
    this.camera.edgeScroll(this.input.state.mouseX, this.input.state.mouseY, this.input.state.mouseActive);

    // Update fog of war
    this.updateFogOfWar();

    // C++ Logic.AI() calls LogicTriggers.Spring(TEVENT_TIME) every tick. The
    // event operator itself gates object/cell events, but house-scan events
    // such as ALL_DESTROYED are intentionally evaluated by this time spring.
    this.processTriggers(TEVENT_TIME);

    // C++ CDTimerClass<FrameTimerClass>: MissionTimer decrements every game frame.
    // Must happen AFTER processTriggers so that newly-set timers match WASM values.
    // C++ stops the timer when the game enters won/lost state (CDTimerClass stops on game over).
    if (this.state === 'won' || this.state === 'lost') {
      this.missionTimerRunning = false;
    }
    if (this.missionTimer > 0 && this.missionTimerRunning) {
      this.missionTimer--;
      if (this.missionTimer <= 0) this.missionTimerExpired = true;
    }

    // C++ FootClass::PathDelay is a CDTimerClass<FrameTimerClass>, not an
    // object-local timer. Team AI runs before object AI and can call
    // Assign_Destination()->Start_Of_Move(); it must see the frame-decremented
    // PathDelay value. Decrement once here at frame scope instead of inside each
    // entity's later AI pass.
    for (const entity of this.entities) {
      if (entity.pathDelay > 0) entity.pathDelay--;
    }

    // Update occupancy grid and assign infantry sub-cell positions
    // C++ cell.h: each cell has 5 sub-positions (CENTER + 4 corners) for infantry,
    // plus Vehicle/Building/Monolith flags that block entire cell.
    this.map.occupancy.fill(0);
    this.map.clearSubCellOccupancy();
    for (const entity of this.entities) {
      if (!entity.inLimbo &&
          (entity.alive || entity.stats.isVessel) &&
          (!entity.isAirUnit || entity.flightAltitude === 0) &&
          !entity.stats.isInfantry) {
        // C++ cell occupier parity: sunk vessels can remain in the
        // Cell_Occupier chain with Strength=0 and still return
        // MOVE_MOVING_BLOCK from Can_Enter_Cell. SCG07EA has a sunk USSR SS at
        // (20,53) doing exactly this. Dead land vehicles do not keep a vehicle
        // occupy bit; SCG04EA's destroyed MNLY at (88,52) must not block a
        // civilian Scatter() into that cell.
        this.map.setVehicleOccupancy(entity.cell.cx, entity.cell.cy, entity.id);
      }
    }
    this.map.applyVehicleTrackReservations();
    const restoredInfantryClaims = new Set<number>();
    for (const entity of this.entities) {
      if (entity.alive && !entity.inLimbo &&
          (!entity.isAirUnit || entity.flightAltitude === 0) &&
          entity.stats.isInfantry &&
          entity.isDriving &&
          entity.claimedCellIdx >= 0 &&
          entity.claimedSubCell >= 0 &&
          this.map.occupyClaimedSubCell(entity.claimedCellIdx, entity.id, entity.claimedSubCell)) {
        restoredInfantryClaims.add(entity.id);
      }
    }
    for (const entity of this.entities) {
      if (entity.alive && !entity.inLimbo) {
        // Air units don't block ground occupancy when airborne
        if (!entity.isAirUnit || entity.flightAltitude === 0) {
          if (entity.stats.isInfantry) {
            // C++ parity: infantry with an active heading-to claim (isDriving + claimedCell)
            // have their occupy bit in the DESTINATION cell, not current cell.
            const skipCurrentClaim = restoredInfantryClaims.has(entity.id);
            if (!skipCurrentClaim && entity.scenarioInitUnlimbo && !entity.isDriving) {
              // C++ InfantryClass::Unlimbo passes ScenarioInit into
              // Closest_Free_Spot. With ScenarioInit=true, C++ keeps the exact
              // requested coord even when the sub-spot is already occupied
              // (reinf.cpp:470-481, building.cpp:1734-1738/3521-3528).
              // Mark the current spot when possible, but never reassign/snap
              // stacked ScenarioInit infantry to another free sub-cell.
              const spotIndex = this.infantrySpotIndex(entity.leptonX, entity.leptonY);
              entity.subCell = spotIndex;
              const cellIdx = entity.cell.cy * MAP_CELLS + entity.cell.cx;
              if (this.map.occupyClaimedSubCell(cellIdx, entity.id, spotIndex)) {
                entity.claimedCellIdx = cellIdx;
                entity.claimedSubCell = spotIndex;
              } else {
                entity.claimedCellIdx = -1;
                entity.claimedSubCell = -1;
              }
              continue;
            }
            // Infantry occupy bits are event-driven in C++ (Unlimbo,
            // Start_Driver, Stop_Driver). Restore only a known claimed bit;
            // do not infer a fresh bit from current position every tick.
            // SCG13EA mptrl dog 852083 stops with no current occupy bit after
            // its NavCom is cleared mid-hop; recreating one at tick rebuild
            // makes following infantry pick the wrong Head_To_Coord.
            const subCell = skipCurrentClaim ? entity.claimedSubCell
              : (entity.claimedCellIdx >= 0 && entity.claimedSubCell >= 0 &&
                  this.map.occupyClaimedSubCell(entity.claimedCellIdx, entity.id, entity.claimedSubCell)
                ? entity.claimedSubCell
                : -1);
            if (subCell >= 0) {
              entity.subCell = subCell;
              // C++ InfantryClass::Set_Occupy_Bit(Coord) only marks the
              // nearest sub-cell bit; it does not mutate Coord. Infantry can
              // stop mid-hop when Stop_Driver() runs after NavCom is cleared
              // (for example TMission_Patrol Assign_Mission_Target), then
              // resume from that exact lepton coordinate. Do not snap idle
              // infantry to StoppingCoordAbs during occupancy rebuild.
            }
            // else: all sub-cells full — entity keeps its previous subCell
          }
        }
      }
    }

    // C++ logic.cpp:267-270: Team AI processes BEFORE entity AI every tick.
    // C++ sets g_rng_source_tag = 1 for Team AI processing.
    // Teams coordinate member movement/attack and consume RNG (Percent_Chance(50)
    // at activation, Mission_Move → Random_Pick(0,2) via Commence Timer reset).
    if (ScenarioRandom._tagLogging) {
      ScenarioRandom._sourceTag = 1; // C++ Team AI tag
    }
    _updateAllTeams(this.waypoints, {
      structures: this.structures,
      entities: this.entities,
      map: this.map,
      playerHouse: this.playerHouse,
      entitiesAllied: (a, b) => this.entitiesAllied(a, b),
      isPlayerControlled: (entity) => this.isPlayerControlled(entity),
      isDiscoveredByPlayer: (entity) => entity.house === this.playerHouse || this.discoveredEntityIds.has(entity.id),
      isRevealedToHouse: (cx, cy, houseIdx) => this.isRevealedToHouse(cx, cy, houseIdx),
      threatScore: (scanner, target, distCells) => this.threatScore(scanner, target, distCells),
      // C++ Can_Enter_Cell port (vehicles only): drive.cpp:638-640 Start_Of_Move
      // fires Start_Driver iff Basic_Path's first step is enterable. This
      // callback delegates to the same helper used by drive-class track-jump.
        canEnterCell: (entity, cx, cy) => this.canEnterTrackJumpCell(entity, cx, cy) === MoveResult.OK,
        startDriveClassMove: (entity) => this.startDriveClassMove(entity),
        stopInfantryDriver: (entity) => this.stopInfantryDriver(entity),
        canStopInfantryDriverForAssignDestination: (entity) => this.canStopInfantryDriverForAssignDestination(entity),
      // Phase 7B: tick for TMission_Patrol periodic threat scan timing.
      tick: this.tick,
    });

    // C++ terrain.cpp:497 — TerrainClass::AI on TERRAIN_MINE fires
    // Spread_Tiberium(true) every Frame % (Rule.GrowthRate*TICKS_PER_MINUTE) == 0.
    // Each MINE is a TerrainClass object in the Logic array before
    // units/infantry/buildings. Rule.GrowthRate = 2 and TICKS_PER_MINUTE = 900,
    // so this fires every 1800 frames, including Frame 0.
    // TS increments this.tick at the start of each update (line 1677), so during
    // the first step (C++ Frame=0), this.tick is already 1. Shift the check.
    if (this._terrainMineSpreadCells.length > 0 && (this.tick - 1) % 1800 === 0) {
      for (const mine of this._terrainMineSpreadCells) {
        if (ScenarioRandom._tagLogging) {
          // Tag format matches WASM logic.cpp:297 default case: 2000+Logic-index.
          ScenarioRandom._sourceTag = 2000 + mine.logicIndex;
        }
        this.map.spreadTiberiumFromCell(mine.cx, mine.cy, true);
      }
    }

    // C++ Logic.AI() (logic.cpp:284) processes ALL objects in a single loop from
    // Logic[0] to Logic[Count()-1]. Read_Scenario_INI loads: Units → Vessels →
    // Infantry → Buildings, so the Logic array order is:
    //   [0..N-1]    units + vessels + infantry (scenario INI entities)
    //   [N..N+B-1]  buildings (structure timer + Firing_AI per building)
    //   [N+B..]     reinforcements/teams (appended at runtime)
    // Aircraft from HPAD buildings sit in the Logic array adjacent to their HPAD
    // and are processed interleaved with buildings.
    //
    // We use a unified logicIdx counter across all phases to match C++ Logic array
    // indices for RNG source tags:
    //   10000 + logicIdx  infantry
    //   11000 + logicIdx  units (vehicles)
    //   12000 + logicIdx  buildings
    //   13000 + logicIdx  aircraft
    //   14000 + logicIdx  vessels
    this._runCombat(ctx => {
      let logicIdx = 0;
      const updateProjectilesThrough = (maxLogicIndexHint: number) => {
        _updateInflightProjectiles(ctx, maxLogicIndexHint);
        this.inflightProjectiles = ctx.inflightProjectiles;
      };

      // C++ Logic.AI (logic.cpp:284) processes objects in Logic array order:
      // Units → Vessels → Infantry → Buildings → reinforcements.
      // Entities (pre-building) process FIRST, then structures.

      // ── Phase 1: pre-building entities (scenario INI units + infantry, skip aircraft) ──
      for (let i = 0; i < this._preBuildingEntityCount; i++) {
        const entity = this.entities[i];
        if (!entity || entity.isAirUnit) continue;
        const effectiveLogicIdx = entity.logicIndexHint ?? logicIdx;
        updateProjectilesThrough(effectiveLogicIdx - 1);
		        if (ScenarioRandom._tagLogging) {
		          ScenarioRandom._sourceTag = entity.stats.isInfantry
		            ? 10000 + effectiveLogicIdx
	            : entity.isNavalUnit
	              ? 14000 + effectiveLogicIdx
	              : 11000 + effectiveLogicIdx;
	          ScenarioRandom._entityTag = ScenarioRandom._sourceTag;
	        }
        logicIdx = Math.max(logicIdx + 1, effectiveLogicIdx + 1);
        this._processGroundEntity(entity);
      }

      // ── Phase 2: ALL structures (timer tick + combat + HPAD helicopter) ──
      // C++ BuildingClass::AI() processes timer tick + Firing_AI sequentially PER
      // BUILDING. HPAD helicopters sit in the Logic array right after their HPAD
      // building and are processed between buildings.
      const GUARD_NORMAL_DELAY = 42;
      const GUARD_AA_DELAY = 14;
      const isLowPower = ctx.powerConsumed > ctx.powerProduced;

      for (const s of this.structures) {
        const effectiveLogicIdx = logicIdx;
        updateProjectilesThrough(effectiveLogicIdx - 1);
		        if (ScenarioRandom._tagLogging) {
		          ScenarioRandom._sourceTag = 12000 + effectiveLogicIdx;
		          ScenarioRandom._entityTag = ScenarioRandom._sourceTag;
        }
        logicIdx = Math.max(logicIdx + 1, effectiveLogicIdx + 1);
        if (!s.alive) {
          _tickDestroyedStructureDebris(ctx, s);
          continue;
        }
        if (isStructureUnderConstruction(s)) continue;
        if (s.sellProgress !== undefined) continue;

        this.tickStructureChargingAnimation(s);
        const runStructureAttack = this.dispatchStructureMissionTimer(
          s, ctx, GUARD_NORMAL_DELAY, GUARD_AA_DELAY);
        if (s.type === 'WEAP') this.tickWeapDoorAI(s);

        // C++ Mission_Attack — firing is mission-timer gated, not a free-running loop.
        if (runStructureAttack) _updateSingleStructureCombat(ctx, s, isLowPower);

        this.maintainStructureTarcom(s);

        this.updateStructureChargingAI(s, ctx, isLowPower);

        // C++ BuildingClass::Repair_AI (building.cpp:5484-5536) — per-building auto-repair
        // tick for computer-controlled houses. Only computes the Random_Pick that initiates
        // the repair timer; actual HP restoration uses TS's updateAIRepair cadence.
        // The RNG consumption is what keeps the RNG stream aligned with WASM.
        this._repairAITick(s);

        // C++ building.cpp:984-993 — computer-controlled buildings own their
        // factory. This starts/exits products; FactoryClass::AI advances later
        // in the frame before HouseClass::AI sets the next Build* slot.
        this.updateAIBuildingFactory(s);

        // C++ BuildingClass::Rotation_AI runs after MissionClass::AI for this
        // building. Firing checks use the pre-rotation facing, then the turret
        // turns toward any desired facing chosen by Mission_Attack.
        _tickStructureTurretRotation(s, isLowPower);

        // C++ building.cpp:990-993: Gap Generator Arm timer
        // When Arm==0, consume Random_Pick(1, TICKS_PER_SECOND) and reset Arm.
        // C++ base: TICKS_PER_MINUTE * Rule.GapRegenInterval
        //   = 900 * fixed(".1")  [fixed 8.8: frac=(256*1)/10=25, raw=25]
        //   = (25 * 900 + 128) / 256 = 88
        if (s.type === 'GAP' && s.gapArmTimer !== undefined) {
          if (s.gapArmTimer > 0) s.gapArmTimer--;
          if (s.gapArmTimer === 0) {
            const gapJitter = ScenarioRandom.nextInRange(1, 15); // TICKS_PER_SECOND = 15
            s.gapArmTimer = 88 + gapJitter;
          }
        }

        _decrementStructureCdTimersEndOfLogic(s);

        // HPAD helicopter interleaving (building.cpp:2438-2455)
        if (s.hpadHelicopterId !== undefined) {
          const heli = this.entityById.get(s.hpadHelicopterId);
          if (heli && heli.alive && heli.isAirUnit) {
            const effectiveLogicIdx = heli.logicIndexHint ?? logicIdx;
            updateProjectilesThrough(effectiveLogicIdx - 1);
		            if (ScenarioRandom._tagLogging) {
		              ScenarioRandom._sourceTag = 13000 + effectiveLogicIdx;
		              ScenarioRandom._entityTag = ScenarioRandom._sourceTag;
	            }
            logicIdx = Math.max(logicIdx + 1, effectiveLogicIdx + 1);
            heli.rotTickedThisFrame = false;
            heli.turretRotTickedThisFrame = false;
            if (heli.isInRecoilState) heli.isInRecoilState = false;
            if (!heli.inLimbo) {
              // C++ AircraftClass::Mission_Attack (aircraft.cpp:2409-2621) for a
              // landed helicopter that lost its target unfolds over TWO timer fires:
              //
              //   Fire A (Status=VALIDATE_AZ, aircraft.cpp:2432-2438):
              //     !Target_Legal(TarCom) → Status=RETURN_TO_BASE, break. Fall
              //     through to line 2620: return MissionControl[MISSION_ATTACK]
              //     .Normal_Delay() + Random_Pick(0,2) = 14+j. Timer = 14+j.
              //     Mission stays ATTACK. One Random_Pick consumed, tag 40050.
              //
              //   Fire B (Status=RETURN_TO_BASE, ~14-16 ticks later,
              //     aircraft.cpp:2603-2614): Enter_Idle_Mode → Assign_Mission
              //     (MISSION_GUARD) + Commence(). Commence flips Mission=GUARD,
              //     Timer=0. break. Fall through to line 2620: return
              //     MissionControl[MISSION_GUARD].Normal_Delay() +
              //     Random_Pick(0,2) = 42+j. Timer = 42+j. Mission is now GUARD
              //     for all subsequent fires. One more Random_Pick consumed.
              //
              // Prior TS implementation looped Fire A forever (missionTimer always
              // set to 14+j and Mission stayed ATTACK), producing +1 HIND RNG call
              // per 14-16 ticks forever vs WASM which runs Fire B and enters
              // GUARD (silent for ~42 ticks). Root cause of SCG11EA t32 Δ=-5
              // (agent ad83df56 / commit 499ce143). WASM's Fire B is observable
              // at SCG11EA tick 18 as Mission_Attack_air tag 40050 for both
              // HINDs at aircraft[131]/[149] (Logic positions).
              //
              // Fix: mirror C++ Status via entity.aircraftAttackStatus. Fire A
              // consumes Random_Pick(0,2), sets status=RETURN_TO_BASE, timer=14+j.
              // Fire B consumes Random_Pick(0,2), transitions Mission→GUARD,
              // resets status, timer=42+j.
              if (heli.mission === Mission.ATTACK && heli.aircraftState === 'landed') {
                const stillHasTarget = (heli.target?.alive) ||
                  (heli.targetStructure && (heli.targetStructure as MapStructure).alive);
                if (!stillHasTarget) {
	                  if (heli.missionTimer <= 0) {
	                    const jitter = ScenarioRandom.nextInRange(0, 2);
                    if (heli.aircraftAttackStatus !== 6) {
                      // Fire A: VALIDATE_AZ → RETURN_TO_BASE. Mission stays ATTACK.
                      heli.aircraftAttackStatus = 6; // RETURN_TO_BASE
                      heli.missionTimer = 14 + jitter; // MISSION_ATTACK Normal_Delay
                    } else {
                      // Fire B: RETURN_TO_BASE → Enter_Idle_Mode → Commence flips
                      // Mission=GUARD. Line 2620 return uses GUARD Normal_Delay.
                      heli.mission = Mission.GUARD;
                      heli.aircraftAttackStatus = 0; // Commence resets Status=0
                      heli.target = null;
                      heli.targetStructure = null;
                      heli.missionTimer = GUARD_NORMAL_DELAY + jitter;
                    }
                  }
                }
              }
              if (heli.mission === Mission.GUARD && heli.aircraftState === 'landed') {
	                // C++ MissionClass::AI reads Timer.Value() at AI entry. Landed
	                // aircraft return from updateAircraft before TS's normal
	                // end-of-logic countdown, so this HPAD interleave dispatches
	                // from the current value and applies that countdown below.
	                const timerFired = heli.missionTimer <= 0;
	                if (timerFired) {
                  if (this._handleLandedAircraftServiceSeek(heli)) continue;
                  const hasTarget = (heli.target?.alive) ||
                    (heli.targetStructure && (heli.targetStructure as MapStructure).alive);
                  if (hasTarget) {
                    heli.mission = Mission.ATTACK;
                    // AircraftClass::AI runs Commence() after Mission_Guard.
                    // Assign_Mission(ATTACK) queues the mission; Commence pops it
                    // and resets Timer=0, so Mission_Attack dispatches next tick.
                    heli.missionTimer = 0;
                  } else {
                    heli.target = null;
                    heli.targetStructure = null;
                    // C++ aircraft.cpp:3821-3824 queues ATTACK only for
                    // Find_Juicy_Target. Targets acquired later by
                    // FootClass::Mission_Guard's Target_Something_Nearby
                    // remain GUARD until the next guard timer fire.
                    const juicyFound = this._heliGuardScan(heli);
                    // C++ foot.cpp:684-687 FootClass::Mission_Guard:
                    //     if (Arm != 0) { return (int)Arm; }     <-- NO Random_Pick
                    //     return(dtime + Random_Pick(0,2));
                    // The Random_Pick(0,2) jitter is GUARDED by the Arm==0 check.
                    // When attackCooldown > 0 (Arm != 0 in C++), foot.cpp early-returns
                    // Arm and does NOT fire the Random_Pick. Prior TS consumed jitter
                    // unconditionally, producing +1 RNG/tick vs WASM for HINDs with
                    // active attackCooldown (root cause of SCG11EA t32 Δ=-5, agent
                    // ad83df56 / commit 499ce143).
                    if (juicyFound) {
                      // aircraft.cpp:3827 still falls through to FootClass::Mission_Guard
                      // after juicy-Assign_Mission. Arm check + jitter still apply to
                      // the return value; but the mission transition to ATTACK is what
                      // we track (TS sets timer=1 for immediate next-tick dispatch).
                      // Jitter only fires when Arm == 0.
                      if (heli.attackCooldown === 0) {
                        ScenarioRandom.nextInRange(0, 2);
                      }
                      heli.mission = Mission.ATTACK;
                      // Same queued-then-Commence path as Target_Legal(TarCom).
                      heli.missionTimer = 0;
                    } else if (heli.attackCooldown > 0) {
                      // C++ foot.cpp:684: Arm != 0 → return Arm, skipping Random_Pick(0,2).
                      heli.missionTimer = heli.attackCooldown;
                    } else {
                      // C++ foot.cpp:687: return dtime + Random_Pick(0,2) when Arm == 0.
                      const mgJitter = ScenarioRandom.nextInRange(0, 2);
                      heli.missionTimer = GUARD_NORMAL_DELAY + mgJitter;
                    }
                  }
                }
              }
	              this.updateEntity(heli);
	              // C++ CDTimerClass starts a returned delay at the current Frame.
	              // Normal TS entities do this in decrementEntityCdTimersEndOfLogic();
	              // landed aircraft bypass that path, so mirror it once here.
	              if (heli.missionTimer > 0) heli.missionTimer--;
	              heli.tickAnimation();
            }
            heli._processedInBuildingPass = true;
          }
        }
      }

      // ── Phase 3: post-building runtime objects ─────────────────────────────
      // C++ LogicClass::AI re-reads the single Logic array in insertion order.
      // Once scenario INI units/infantry and buildings have run, runtime
      // aircraft and runtime ground objects interleave by their actual Logic
      // position. SCG08EA tick 794 depends on a BADR submitted before a later
      // paradropped E1 consuming its Mission_Hunt jitter first; batching all
      // ground reinforcements before all aircraft gives the E1 the BADR's RNG.
      for (let i = this._preBuildingEntityCount; i < this.entities.length; i++) {
        const entity = this.entities[i];
        if (!entity) continue;

        if (entity.isAirUnit) {
          if (!entity.alive) continue;
          if (entity._processedInBuildingPass) {
            entity._processedInBuildingPass = false; // reset for next tick
            continue;
          }
          const effectiveLogicIdx = entity.logicIndexHint ?? logicIdx;
          updateProjectilesThrough(effectiveLogicIdx - 1);
          if (ScenarioRandom._tagLogging) {
            ScenarioRandom._sourceTag = 13000 + effectiveLogicIdx;
            ScenarioRandom._entityTag = ScenarioRandom._sourceTag;
          }
          logicIdx = Math.max(logicIdx + 1, effectiveLogicIdx + 1);
          entity.rotTickedThisFrame = false;
          entity.turretRotTickedThisFrame = false;
          if (entity.isInRecoilState) entity.isInRecoilState = false;
          if (entity.inLimbo) continue;
          // C++ AircraftClass::AI → FootClass::AI → MissionClass::AI fires the
          // mission handler when Timer==0. For a freshly-spawned aircraft in
          // MOVE mission, Mission_Move returns Normal_Delay + Random_Pick(0,2).
          // TS's _updateAircraft state machine bypasses the mission switch, so
          // consume the Random_Pick equivalent here for Mission_Move parity.
          // (rules.ini [Move] Normal_Delay=14 + jitter 0-2 → timer 14-16.)
          // If Team AI queued a new mission this tick, AircraftClass::AI's
          // Commence gate must pop it before any old Mission_Move return jitter
          // can fire. C++ SCG04EA t181 BADR enters ATTACK from TMISSION_ATT_WAYPT
          // without consuming a stale MISSION_MOVE Random_Pick.
          if (entity.missionQueue === null &&
              entity.mission === Mission.MOVE && entity.missionTimer <= 0) {
            entity.missionTimer = 14 + ScenarioRandom.nextInRange(0, 2);
          }
          this.updateEntity(entity);
          entity.tickAnimation();
          continue;
        }

        const effectiveLogicIdx = entity.logicIndexHint ?? logicIdx;
        updateProjectilesThrough(effectiveLogicIdx - 1);
		        if (ScenarioRandom._tagLogging) {
		          ScenarioRandom._sourceTag = entity.stats.isInfantry
		            ? 10000 + effectiveLogicIdx
	            : entity.isNavalUnit
	              ? 14000 + effectiveLogicIdx
	              : 11000 + effectiveLogicIdx;
	          ScenarioRandom._entityTag = ScenarioRandom._sourceTag;
	        }
        logicIdx = Math.max(logicIdx + 1, effectiveLogicIdx + 1);
        this._processGroundEntity(entity);
      }

      // ── Phase 5: C++ AnimClass logic objects appended to Logic ──
      // C++ ObjectClass::Unlimbo submits ANIM objects to the same Logic array as
      // techno/buildings (object.cpp:1412-1414). The Logic loop re-reads Count(),
      // so animations spawned by earlier objects can run later in the same tick,
      // and AnimClass::Middle consumes gameplay RNG for napalm/fire side effects.
      this.logicAnimsProcessedThisTick = false;
      for (let i = 0; i < this.logicAnims.length; i++) {
	        if (ScenarioRandom._tagLogging) {
	          ScenarioRandom._sourceTag = 16000 + logicIdx;
	          ScenarioRandom._entityTag = ScenarioRandom._sourceTag;
        }
        logicIdx++;
        if (!processLogicAnim(this.logicAnims[i], this.logicAnims, this.effects, this.map)) {
          this.logicAnims.splice(i, 1);
          i--;
        }
      }
      this.logicAnimsProcessedThisTick = true;

      // Clear source tag after Phase 4 so any post-Logic RNG calls (e.g. the
      // pendingInvisibleScatters flush at line ~2320) don't inherit the final
      // aircraft's logicIdx tag. Without the reset, SCG01EA tick 87's flushed
      // Coord_Scatters are mistagged `aircraft[51]`, confusing RNG-diff tools.
      // C++ equivalent: logic.cpp:285 entity loop exits; subsequent callers
      // (Map.Logic, House AI, bullet AI) set their own g_rng_source_tag.
      if (ScenarioRandom._tagLogging) {
        ScenarioRandom._sourceTag = 0;
        ScenarioRandom._entityTag = 0;
      }
    });

    // C++ HouseClass::AI repair timer tick (house.cpp:1371-1373):
    //   if (DidRepair && RepairTimer == 0) DidRepair = false;
    // CDTimerClass (operator()() returns (Started+Target)-Frame) is "virtual":
    // value decreases implicitly as Frame advances. On the set Frame, the timer
    // still reads Target (no decrement on set frame). HouseClass::AI runs in
    // Logic.AI (logic.cpp:365-392) AFTER Object AI (where Repair_AI fires), so
    // the reset observation happens after Repair_AI has already read DidRepair
    // this frame. Decrement+reset therefore runs HERE (after entity loops) —
    // and we skip the decrement on the tick the timer was set, matching
    // CDTimer's "no decrement on set frame" semantics so fire-to-fire spacing
    // is exactly Target+1 frames (set on F, fire on F+Target+1).
    for (const state of this.aiStates.values()) {
      if (state.repairTimerSetTick !== this.tick && state.repairTimer > 0) {
        state.repairTimer--;
      }
      if (state.didRepair && state.repairTimer <= 0) state.didRepair = false;
    }

    // C++ logic.cpp:267+ Logic.AI runs BEFORE Map.Sight_From — fog is computed AFTER AI.
    // Rebuild per-house revealed sets so AI scans can filter by house fog.
    this._updateHouseRevealed();

    // Deferred transport loads (remove loaded passengers from world) — after the
    // unified loop since these don't consume RNG.
    if (this._pendingTransportLoads.length > 0) {
      const loadSet = new Set(this._pendingTransportLoads);
      for (const id of loadSet) {
        const e = this.entityById.get(id);
      }
      // C++ Logic keeps buildings between the original scenario objects and
      // later reinforcements. If TS removes a pre-building entity from the
      // array, the split point must move left too; otherwise post-building
      // reinforcements slide into the pre-building pass and run before
      // BuildingClass::AI.
      const removedBeforeStructures = this.entities
        .slice(0, this._preBuildingEntityCount)
        .filter(e => loadSet.has(e.id)).length;
      this.entities = this.entities.filter(e => !loadSet.has(e.id));
      this._preBuildingEntityCount = Math.max(0, this._preBuildingEntityCount - removedBeforeStructures);
      for (const id of this._pendingTransportLoads) {
        this.entityById.delete(id);
      }
      this._pendingTransportLoads.length = 0;
    }

    // Nuke launch sequence: missile arrives after delay
    if (this.nukePendingTarget && this.nukePendingTick > 0) {
      this.nukePendingTick--;
      if (this.nukePendingTick <= 0) {
        this.detonateNuke(this.nukePendingTarget);
        this.nukePendingTarget = null;
        this.nukePendingSource = null;
      }
    }

    // RNG audit: per-tick summary (after all entity/structure/aircraft processing)
    if (this.tick >= 1 && this.tick <= 15 && ScenarioRandom._tagLogging && !ScenarioRandom._tagLoggingExternal) {
      const tickStart = (this as any)._rngAuditTickStart as number;
      const seedStart = (this as any)._rngAuditSeedLogStart as number;
      const tickCalls = ScenarioRandom.callCount - tickStart;
      const tickSeedEntries = ScenarioRandom._seedLog.slice(seedStart);
      // Count by source tag category
      const tagCounts: Record<string, number> = {};
      for (const [, tag] of tickSeedEntries) {
        let cat: string;
        if (tag >= 10000 && tag < 11000) cat = 'infantry[' + (tag - 10000) + ']';
        else if (tag >= 11000 && tag < 12000) cat = 'unit[' + (tag - 11000) + ']';
        else if (tag >= 12000 && tag < 13000) cat = 'building[' + (tag - 12000) + ']';
        else if (tag >= 13000 && tag < 14000) cat = 'aircraft[' + (tag - 13000) + ']';
        else if (tag >= 14000 && tag < 15000) cat = 'vessel[' + (tag - 14000) + ']';
        else cat = 'other[' + tag + ']';
        tagCounts[cat] = (tagCounts[cat] || 0) + 1;
      }
      console.log(`[RNG AUDIT tick ${this.tick}] ${tickCalls} calls, seed=${ScenarioRandom.seed >>> 0}`);
      const sorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
      for (const [cat, count] of sorted.slice(0, 30)) {
        console.log(`  ${count}x ${cat}`);
      }
    }

    // Check for units leaving the map edge (civilian evacuation)
    // C++ parity: aircraft are exempt — they spawn outside map bounds and fly in.
    // Aircraft handle their own map-exit logic in aircraft.ts handleMapExit().
    for (const entity of this.entities) {
      if (!entity.alive || entity.inLimbo || entity.isAirUnit) continue;
      const c = entity.cell;
      if (c.cx <= this.map.boundsX || c.cx >= this.map.boundsX + this.map.boundsW - 1 ||
          c.cy <= this.map.boundsY || c.cy >= this.map.boundsY + this.map.boundsH - 1) {
        // Check if unit has a move target outside the map (intentionally leaving)
        if (entity.moveTarget) {
          const tc = { cx: Math.floor(entity.moveTarget.lx / 256), cy: Math.floor(entity.moveTarget.ly / 256) };
          if (!this.map.inBounds(tc.cx, tc.cy)) {
            // C++ leave-map/evacuation is not object destruction. Preserve
            // TEVENT_LEAVES_MAP counters but avoid firing attached destroyed triggers.
            entity.triggerName = '';
            entity.alive = false;
            entity.mission = Mission.DIE;
            this.unitsLeftMap++;
            if (CIVILIAN_UNIT_TYPES.has(entity.type) || (this.isTanyaEvac && entity.type === 'E7')) {
              this.civiliansEvacuated++;
            }
            // Transport passengers: civilians aboard count as evacuated (C++ transport evacuation).
            // Clear triggerName before marking dead — evacuated units are NOT "destroyed"
            // for TEVENT_DESTROYED purposes (C++ parity: evacuation ≠ destruction).
            if (entity.passengers && entity.passengers.length > 0) {
              for (const p of entity.passengers) {
                p.triggerName = ''; // human-requested: prevent los2 firing on Tanya evacuation
                p.alive = false;
                this.unitsLeftMap++;
                if (CIVILIAN_UNIT_TYPES.has(p.type) || (this.isTanyaEvac && p.type === 'E7')) {
                  this.civiliansEvacuated++;
                }
              }
              entity.passengers = [];
            }
          }
        }
      }
    }

    // Update effects (with loop + follow-up support)
    const followUpEffects: Effect[] = [];
    this.effects = this.effects.filter(e => {
      e.frame++;
      // Looping: when frame reaches loopEnd, reset to loopStart
      if (e.loopEnd !== undefined && e.loopStart !== undefined && e.frame >= e.loopEnd) {
        if (e.loops === undefined || e.loops === -1 || e.loops > 0) {
          e.frame = e.loopStart;
          if (e.loops !== undefined && e.loops > 0) e.loops--;
          return true;
        }
      }
      if (e.frame >= e.maxFrames) {
        // Queue follow-up effect (e.g. fire → smoke) — pushed after filter to avoid silent drop
        if (e.followUp) {
          followUpEffects.push({
            type: 'explosion', x: e.x, y: e.y,
            frame: 0, maxFrames: 20, size: e.size,
            sprite: e.followUp, spriteStart: 0,
          });
        }
        return false;
      }
      return true;
    });
    if (followUpEffects.length > 0) this.effects.push(...followUpEffects);

    // C++ map.cpp:994 — crate regeneration only in multiplayer (Session.Type != GAME_NORMAL)
    // Single-player campaigns (SCG*, SCU*) and ant missions (SCA*) do NOT regenerate crates.
    // C++ scenario.cpp:2436 — initial crate placement at tick 0 (with Goodies enabled)
    const isCampaign = /^SC[GUA]/i.test(this.scenarioId);
    if (!isCampaign) {
      // C++ map.cpp:1000-1004 — per-crate expiry-driven respawn (not a global timer)
      // Each tick, scan all crates; expired ones are removed and immediately replaced.
      for (let i = this.crates.length - 1; i >= 0; i--) {
        const crate = this.crates[i];
        if (this.tick - crate.tick > crate.lifetime) {
          this.crates.splice(i, 1);
          this.spawnCrate(); // 1:1 replacement — C++ map.cpp:1003
        }
      }
      // C++ map.h:152 — CrateClass Crates[256]; max 256 concurrent crates
      // C++ scenario.cpp:2437 — initial count = max(CrateMinimum=1, NumPlayers)
      if (this.tick >= this.nextCrateTick && this.crates.length < 256) {
        this.spawnCrate();
      }
    }

    // Crate pickup — any unit walking over crates (C++ foot.cpp:765: ANY FootClass triggers)
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const crate = this.crates[i];
      // CR6: Expire crates in campaign (no respawn) — C++ only regenerates in multiplayer
      if (this.tick - crate.tick > crate.lifetime) {
        this.crates.splice(i, 1);
        continue;
      }
      for (const e of this.entities) {
        if (!e.alive) continue;
        const dx = e.pos.x - crate.x;
        const dy = e.pos.y - crate.y;
        if (dx * dx + dy * dy < CELL_SIZE * CELL_SIZE) {
          this.pickupCrate(crate, e);
          this.crates.splice(i, 1);
          break;
        }
      }
    }

    // Check cell triggers — detect player units entering trigger cells
    this.checkCellTriggers();

    // C++ parity (#21): detect object/house discovery and zone/line crossings
    this.checkDiscoveryTriggers();
    this.checkZoneAndCrossTriggers();

    // Periodic processTriggers moved to before entity processing (C++ parity:
    // LogicTriggers run before entity AI so spawned entities are processed same tick).

    // RP3: Repair structures — delegates to repairSell.ts (14 tick interval)
    if (this.tick % 14 === 0) {
      this._runRepairSell(ctx => _tickRepairs(ctx));
    }

    // Queen Ant self-healing (SelfHealing=yes in INI): +1 HP every 14 ticks
    // C++ RepairRate timing = 14 ticks (same as structure repair interval)
    if (this.tick % 14 === 0) {
      for (const s of this.structures) {
        if (s.alive && s.type === 'QUEE' && s.hp / s.maxHp <= CONDITION_YELLOW) {
          s.hp = Math.min(s.maxHp, s.hp + 1);
        }
      }
    }

    // Entity self-healing: 4TNK (Mammoth Tank) and HARV (Harvester) — C++ techno.cpp:2354
    // Units with IsSelfHealing=true heal +1 HP every 14 ticks when Health_Ratio() <= ConditionYellow (50%)
    if (this.tick % 14 === 0) {
      for (const e of this.entities) {
        if (e.alive && e.stats.selfHealing && e.hp > 0 && e.hp / e.maxHp <= CONDITION_YELLOW) {
          e.hp = Math.min(e.maxHp, e.hp + 1);
        }
      }
    }

    // Service Depot — delegates to repairSell.ts (14 tick interval)
    if (this.tick % 14 === 0) {
      this._runRepairSell(ctx => _tickServiceDepot(ctx));
    }

    // Tick C4 timers on structures (Tanya plants) — must run BEFORE
    // processTriggers so C4 explosions occur before loss conditions are checked.
    // Without this, the step loop exits on state=lost before C4 can detonate.
    this.tickC4Timers();

    // Building + aircraft timers now run inside the entity loop section above
    // (interleaved with entity processing to match C++ Logic layer order).

    // Defensive structure auto-fire — moved to building processing section above
    // (between entity and aircraft loops, matching C++ Logic layer order)

    // Tick mine triggers (Minelayer AP mines)
    this.tickMines();

    // CR8: Tick active vortices
    this.tickVortices();

    // Gap Generator shroud jamming (every ~90 ticks)
    this.updateGapGenerators();

    // Advance in-flight projectiles
    const preProjectileEntityCount = this.entities.length;
    this.updateInflightProjectiles();

    // C++ logic.cpp:285 re-reads Logic.Count() while iterating. Projectile
    // damage can submit new infantry (e.g. vehicle crew from UnitClass death),
    // but same-tick-created invisible bullets occupy earlier Logic slots than
    // the later-submitted infantry. TS batches projectile work after entity AI,
    // so catch up projectile-spawned ground entities only after the invisible
    // bullet flush has run.
    for (let i = preProjectileEntityCount; i < this.entities.length; i++) {
      const entity = this.entities[i];
      if (!entity || !entity.alive || entity.isAirUnit) continue;
      if (ScenarioRandom._tagLogging) {
        ScenarioRandom._sourceTag = entity.stats.isInfantry
          ? 10000 + i
          : entity.isNavalUnit
            ? 14000 + i
            : 11000 + i;
      }
      this._processGroundEntity(entity);
    }

    // C++ logic.cpp:348-352 — Map.Logic runs after all Logic objects
    // (technos/buildings/bullets/anims) and before Factory/House AI.
    if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = 3;
    this.map.growOre(this.tick);

    // C++ logic.cpp:359-363 — FactoryClass::AI runs after Map.Logic and
    // before HouseClass::AI. BuildingClass::Factory_AI created/started these
    // factories earlier in the frame; they do not exit products until a later
    // building AI pass sees STEP_COUNT completed.
    this.updateAIFactories();

    // Queen Ant spawning — QUEE periodically spawns ants (rate varies by difficulty)
    const spawnSec = (DIFFICULTY_MODS[this.difficulty] ?? DIFFICULTY_MODS.normal).spawnInterval;
    if (this.tick % (GAME_TICKS_PER_SEC * spawnSec) === 0) {
      this.updateQueenSpawning();
    }

    // C++ house.cpp:936-940: IQ-based auto-enable runs at start of every AI tick
    this.updateAIIQGates();

    // C++ House::AI() per-tick RNG parity — AI_Building/AI_Unit/AI_Vessel/AI_Infantry/AI_Aircraft
    // plus timer-gated sections (AlertTime, TeamTime). Must run EVERY tick in C++ house enum order.
    this._runAI(ctx => _aiPerTick(ctx));

    // Legacy strategic helpers that still model non-RNG house bookkeeping.
    // C++ structure selection/placement runs through HouseClass::AI_Building
    // and BuildingClass::Factory_AI; do not run the old direct-spawn
    // updateAIConstruction pass here.
    if (!this.scenarioId.startsWith('SCA')) {
      this.updateAIStrategicPlanner();
      this.updateAIHarvesters();
      this.updateAIAttackGroups();
      this.updateAIDefense();
    }

    // C++ HouseClass::AI already ran AI_Unit/AI_Vessel/AI_Infantry/AI_Aircraft
    // above in exact enum order. The legacy TS updateAIProduction() pass is a
    // 60-tick immediate spawner with no C++ counterpart; on SCG07EA tick 61 it
    // consumed four extra RNG calls after House::AI completed. Keep production
    // advancement in tickProduction(), and let C++-ported House AI set build
    // selections instead of running this duplicate strategic layer.
    this.updateAIIncome();
    this.updateAIAutocreateTeams();

    // AI base intelligence — auto-repair and auto-sell damaged buildings (IQ >= 3, C++ parity)
    this.updateAIRepair();
    this.updateAISellDamaged();

    // Base discovery — check if a player unit is near any player structure
    this.checkBaseDiscovery();

    // Tick production queue — advance build progress
    this.tickProduction();

    // Combat music switching — check if any player units are in combat
    const inCombat = this.entities.some(e =>
      e.alive && e.isPlayerUnit && e.mission === Mission.ATTACK && e.target?.alive
    );
    this.audio.music.setCombatMode(inCombat);

    // Tick cloak/invulnerability timers from crates
    for (const e of this.entities) {
      if (!e.alive) continue;
      if (e.cloakTick > 0) e.cloakTick--;
      if (e.invulnTick > 0) e.invulnTick--;
      if (e.ironCurtainTick > 0) e.ironCurtainTick--;
      if (e.speedTick > 0) { e.speedTick--; if (e.speedTick <= 0) e.speedBias = 1.0; }
      if (e.chronoShiftTick > 0) e.chronoShiftTick--;
      // C++ drive.cpp:1297-1313: Moebius return countdown — when timer expires,
      // teleport unit back to its origin cell and clear moebius state.
      if (e.moebiusCountDown > 0) {
        e.moebiusCountDown--;
        if (e.moebiusCountDown === 0 && e.moebiusCell) {
          e.setPosition(e.moebiusCell.x, e.moebiusCell.y);
          e.prevPos.x = e.moebiusCell.x;
          e.prevPos.y = e.moebiusCell.y;
          e.chronoShiftTick = CHRONO_SHIFT_VISUAL_TICKS;
          e.moebiusCell = null;
        }
      }
    }

    // Tick Iron Curtain timers on structures (C++ house.cpp:2751 parity)
    for (const s of this.structures) {
      if (!s.alive) continue;
      if (s.ironCurtainTicks && s.ironCurtainTicks > 0) s.ironCurtainTicks--;
      // C++ flasher.cpp:83-95 — Blushing damage-flash countdown (Process per tick).
      if (s.flashCount && s.flashCount > 0) s.flashCount--;
    }

    // fogReEnableTick timer removed — C++ RadarSpied is permanent (infantry.cpp:660-662)

    // C++ techno.cpp:3958-3962 — TechnoClass::Record_The_Kill springs
    // attached object triggers immediately on death. Do this before corpse
    // cleanup so semi-persistent AttachCount gates (e.g. SCG01EA `dwig`)
    // decrement on the death tick, not the next 15-tick LogicTrigger scan.
    this.springDestroyedObjectTriggers();

    const removedInfantryDeathAnims = this.cleanupCompletedInfantryDeathAnimations();
    if (removedInfantryDeathAnims > 0) {
      // C++ HouseClass::Recalc_Attributes refreshes Active*Scan after object
      // AI. If an infantry death animation left Logic this tick, house-level
      // destroyed triggers can observe that before the next frame's gameplay.
      this.processTriggers(TEVENT_TIME, {
        clearTransient: false,
        onlyEventTypes: new Set([TEVENT_UNITS_DESTROYED, TEVENT_ALL_DESTROYED]),
        skipPersistentFiredThisTick: true,
      });
    }

    // Animate displayed credits toward actual credits
    if (this.displayCredits !== this.credits) {
      const diff = this.credits - this.displayCredits;
      const step = Math.max(1, Math.abs(diff) >> 2); // tick 25% per frame
      if (diff > 0) this.displayCredits = Math.min(this.credits, this.displayCredits + step);
      else this.displayCredits = Math.max(this.credits, this.displayCredits - step);
    }

    // Calculate power balance
    const powerGrid = _calculatePowerGrid(
      this.structures,
      this.playerHouse,
      (a, b) => this.isAllied(a, b),
    );
    this.powerProduced = powerGrid.produced;
    this.powerConsumed = powerGrid.consumed;

    // Low power warning (every 10 seconds when power demand exceeds supply)
    if (this.powerConsumed > this.powerProduced && this.powerProduced > 0 &&
        this.tick % (GAME_TICKS_PER_SEC * 10) === 0) {
      this.audio.play('eva_low_power');
    }

    // Superweapon recharge and auto-fire
    this.updateSuperweapons();

    // Tick structure construction and sell animations
    for (const s of this.structures) {
      // Construction: C++ uses each building's *MAKE frame count, not a
      // shared duration. Include one extra TS progress tick because newly
      // placed buildings miss their C++ Logic slot on the placement frame.
      if (isStructureUnderConstruction(s)) {
        const wasBuilding = s.buildProgress < 1;
        const constructionTicks = structureConstructionProgressTicks(s.type);
        s.buildProgress = Math.min(1, s.buildProgress + 1 / constructionTicks);
        // Track completed construction for TEVENT_BUILD
        if (wasBuilding && s.buildProgress >= 1) {
          this.builtStructureTypes.add(s.type);
          // C++ HouseClass::JustBuiltStructure: per-house bitmap, not global.
          const hi = Game.HOUSE_TO_INDEX[s.house];
          if (hi !== undefined) {
            let hset = this.builtStructureTypesByHouse.get(hi);
            if (!hset) { hset = new Set<string>(); this.builtStructureTypesByHouse.set(hi, hset); }
            hset.add(s.type);
          }
          if (s.house === 'Spain' || s.house === 'Greece') {
            this.structuresBuilt++;
            // C++ parity: recalculate silo capacity when storage structure completed
            if (s.type === 'PROC' || s.type === 'SILO') {
              this.recalculateSiloCapacity();
            }
          }
        }
      }
      // Sell: play make-sheet frames in reverse at the same type-specific
      // C++ buildup cadence used for construction.
      // Guard: skip if structure was destroyed mid-sell (e.g. by enemy attack)
      if (s.sellProgress !== undefined && s.alive) {
        const SELL_DURATION = structureConstructionProgressTicks(s.type);
        s.sellProgress = Math.min(1, s.sellProgress + 1 / SELL_DURATION);
        if (s.sellProgress >= 1) {
          s.alive = false;
          s.sellProgress = undefined;
          this.clearStructureFootprint(s);
          // GAP1: unjam shroud when Gap Generator is sold
          if (s.type === 'GAP') {
            const si = this.structures.indexOf(s);
            if (si >= 0 && this.gapGeneratorCells.has(si)) {
              const prev = this.gapGeneratorCells.get(si)!;
              this.map.unjamRadius(prev.cx, prev.cy, prev.radius);
              this.gapGeneratorCells.delete(si);
            }
          }
          const prodItem = this.scenarioProductionItems.find(p => p.type === s.type);
          const healthRatioAtSell = (s.sellHpAtStart ?? s.maxHp) / s.maxHp;
          s.sellHpAtStart = undefined;
          const wx = s.cx * CELL_SIZE + CELL_SIZE;
          const wy = s.cy * CELL_SIZE + CELL_SIZE;
          this.effects.push({ type: 'explosion', x: wx, y: wy, frame: 0, maxFrames: EXPLOSION_FRAMES['veh-hit1'] ?? 17, size: 12,
            sprite: 'veh-hit1', spriteStart: 0 });

          // C++ building.cpp:3509-3549: ConYard sell → MCV reversion
          // Conditions: FACT, deployed from MCV (ArchiveTarget), human-owned, HP > 0
          // When MCV spawns: no infantry survivors, no sell refund (C++ only refunds if MCV can't spawn)
          let mcvSpawned = false;
          if (s.type === 'FACT' && s.deployedFromMCV &&
              this.isAllied(s.house, this.playerHouse) && healthRatioAtSell > 0) {
            const mcv = new Entity(UnitType.V_MCV, s.house, wx, wy);
            mcv.hp = Math.max(1, Math.floor(mcv.maxHp * healthRatioAtSell));
            mcv.mission = Mission.GUARD;
            this.entities.push(mcv);
            this.entityById.set(mcv.id, mcv);
            mcvSpawned = true;
          }

          // C++ parity: sell refund FIRST, then reduce capacity (building.cpp:3571).
          // C++ order: Refund_Money(Refund_Amount()) → Credits += refund (bypass silo cap),
          // THEN Limbo() → Adjust_Capacity(-Class->Capacity, true) → spill excess Tiberium.
          // Refund: C++ techno.cpp:5743-5761 — AI gets 100%, human gets 50%
          // C++ building.cpp:3509-3549: no refund when ConYard reverts to MCV
          if (!mcvSpawned && prodItem) {
            const isHuman = this.isAllied(s.house, this.playerHouse);
            this.addCredits(sellRefund(prodItem.cost, isHuman, prodItem.rawCost), true);
          }
          // Recalculate silo capacity AFTER adding refund (C++ order: Refund_Money then Limbo)
          this.recalculateSiloCapacity();

          // SL4: Spawn infantry survivors (C++ building.cpp How_Many_Survivors + Crew_Type)
          // C++ parity: no survivors when ConYard reverts to MCV
          // C++ building.cpp:3444: if (!IsCrewAble()) return 0 — only Crewed=yes buildings spawn survivors
          if (!mcvSpawned && CREWED_BUILDINGS.has(s.type)) {
            // Count: (buildingRawCost * SurvivorFraction) / E1_cost, clamped 1-5.
            // C++ fixed(".4") stores 102/256, so costs like APWR 500 yield
            // ((500*102+128)/256)=199, then 199/100 => 1 survivor.
            const E1_COST = 100;
            const SURVIVOR_FRACTION_RAW = 102;
            // C++ bdata.cpp:3672-3683 Raw_Cost(): subtract free unit cost for buildings that come with one
            const FACT_COST = 2500;        // rules.ini [FACT] Cost=2500 — not in PRODUCTION_ITEMS (pre-placed)
            const HARVESTER_COST = 1400;   // UnitTypeClass::As_Reference(UNIT_HARVESTER).Cost
            const HIND_COST = 1200;        // AircraftTypeClass::As_Reference(AIRCRAFT_HIND).Cost
            let buildCost = prodItem?.cost ?? (s.type === 'FACT' ? FACT_COST : 300);
            // C++ Raw_Cost subtracts free unit costs for survivor calculation
            if (s.type === 'PROC') buildCost -= HARVESTER_COST;           // bdata.cpp:3679-3681
            if (s.type === 'HPAD') buildCost -= (HIND_COST + HIND_COST) / 2; // bdata.cpp:3676-3677 (C++ bug: HIND twice)
            const survivorValue = Math.floor((buildCost * SURVIVOR_FRACTION_RAW + 128) / 256);
            // C++ building.cpp:5597: captured building doubles the divisor.
            let survivorDivisor = E1_COST;
            if (s.originalHouse && s.originalHouse !== s.house) {
              survivorDivisor *= 2;
            }
            const survivorCount = Math.min(5, Math.max(1, Math.floor(survivorValue / survivorDivisor)));
            // C++ building.cpp:3456-3463 — one engineer limit per ConYard sell
            let engineerSpawned = false;
            // C++ techno.cpp:4454-4465 — check if building has no weapon (for 15% civilian chance)
            const isUnarmed = !STRUCTURE_WEAPONS[s.type];
            for (let si = 0; si < survivorCount; si++) {
              // C++ Crew_Type: per-building type with random variance
              let crewType: UnitType;
              switch (s.type) {
                case 'FACT': // STRUCT_CONST: 25% engineer if human-owned, max 1 engineer
                  // C++ building.cpp:4680-4684: captured ConYard NEVER spawns an engineer
                  // C++ building.cpp:3456-3463 — re-roll if engineer already spawned
                  if (!(s.originalHouse && s.originalHouse !== s.house) && !engineerSpawned && ScenarioRandom.float() < 0.25) {
                    crewType = UnitType.I_E6;
                    engineerSpawned = true;
                  } else {
                    crewType = UnitType.I_E1;
                  }
                  break;
                case 'TENT': case 'BARR': // Barracks: always E1
                  crewType = UnitType.I_E1;
                  break;
                default: // TechnoClass::Crew_Type: E1, with 15% civilian chance if no weapon
                  // C++ techno.cpp:4454-4465 — unarmed buildings have 15% chance for C1/C7
                  if (isUnarmed && ScenarioRandom.float() < 0.15) {
                    crewType = ScenarioRandom.float() < 0.5 ? UnitType.I_C1 : UnitType.I_C7;
                  } else {
                    crewType = UnitType.I_E1;
                  }
                  break;
              }
              const inf = new Entity(crewType, s.house, wx + (si % 3 - 1) * 6, wy + Math.floor(si / 3) * 6);
              inf.mission = Mission.GUARD;
              inf.scenarioInitUnlimbo = true;
              // C++ building.cpp:3473 — IsTechnician: IsNominal infantry (E1) get technician star
              if (crewType === UnitType.I_E1) {
                inf.isTechnician = true;
              }
              this.entities.push(inf);
              this.entityById.set(inf.id, inf);
            }
          }
        }
      }
    }

    // Update idle count for HUD (once per tick, not per render frame)
    let idleCount = 0;
    for (const e of this.entities) {
      if (e.alive && e.isPlayerUnit && (e.mission === Mission.GUARD || e.mission === Mission.AREA_GUARD) && !e.target) idleCount++;
    }
    this.renderer.idleCount = idleCount;

    // Check win/lose — but only if triggers have had time to spawn ants
    // The trigger system spawns ants over time, so we need a grace period
    this.checkVictoryConditions();
  }

  /** Update fog of war — delegates to fog.ts */
  private updateFogOfWar(): void {
    _updateFogOfWar(this._fogCtx);
  }

  /** Sub detection — delegates to fog.ts */
  private updateSubDetection(): void {
    _updateSubDetection(this._fogCtx);
  }

  /** Check if a screen click is on the minimap; if so, scroll camera there */
  private handleMinimapClick(sx: number, sy: number): boolean {
    const { x: mmX, y: mmY, size: mmSize } = this.renderer.getMinimapBounds();
    if (sx < mmX || sx > mmX + mmSize || sy < mmY || sy > mmY + mmSize) {
      return false;
    }
    // Convert minimap click to world coordinates
    const scale = mmSize / Math.max(this.map.boundsW, this.map.boundsH);
    const worldCX = this.map.boundsX + (sx - mmX) / scale;
    const worldCY = this.map.boundsY + (sy - mmY) / scale;
    this.camera.centerOn(worldCX * CELL_SIZE, worldCY * CELL_SIZE);
    return true;
  }

  /** Update cursor type based on mouse position and selection state */
  private updateCursor(): void {
    const { mouseX, mouseY } = this.input.state;

    // Edge scroll cursors (3px margin from viewport edges, not in sidebar)
    const edgeMargin = 3;
    const inSidebar = mouseX >= this.canvas.width - Game.SIDEBAR_W;
    if (!inSidebar) {
      const atTop = mouseY <= edgeMargin;
      const atBottom = mouseY >= this.canvas.height - edgeMargin;
      const atLeft = mouseX <= edgeMargin;
      const atRight = mouseX >= this.canvas.width - Game.SIDEBAR_W - edgeMargin;
      if (atTop && atLeft) { this.cursorType = CursorType.SCROLL_NW; return; }
      if (atTop && atRight) { this.cursorType = CursorType.SCROLL_NE; return; }
      if (atBottom && atLeft) { this.cursorType = CursorType.SCROLL_SW; return; }
      if (atBottom && atRight) { this.cursorType = CursorType.SCROLL_SE; return; }
      if (atTop) { this.cursorType = CursorType.SCROLL_N; return; }
      if (atBottom) { this.cursorType = CursorType.SCROLL_S; return; }
      if (atLeft) { this.cursorType = CursorType.SCROLL_W; return; }
      if (atRight) { this.cursorType = CursorType.SCROLL_E; return; }
    }

    if (this.sellMode) {
      const world = this.camera.screenToWorld(mouseX, mouseY);
      const s = this.findStructureAt(world);
      if (s && s.alive && s.sellProgress === undefined &&
          this.isAllied(s.house, this.playerHouse)) {
        this.cursorType = CursorType.SELL;
      } else {
        this.cursorType = CursorType.NOMOVE;
      }
      return;
    }
    if (this.repairMode) {
      const world = this.camera.screenToWorld(mouseX, mouseY);
      const s = this.findStructureAt(world);
      if (s && s.alive && this.isAllied(s.house, this.playerHouse) && s.hp < s.maxHp) {
        this.cursorType = CursorType.REPAIR;
      } else {
        this.cursorType = CursorType.NOMOVE;
      }
      return;
    }
    if (this.selectedIds.size === 0) {
      this.cursorType = CursorType.DEFAULT;
      return;
    }
    if (this.attackMoveMode) {
      this.cursorType = CursorType.ATTACK;
      return;
    }
    const world = this.camera.screenToWorld(mouseX, mouseY);
    const hovered = this.findEntityAt(world);
    if (hovered && !hovered.isPlayerUnit && hovered.alive) {
      this.cursorType = CursorType.ATTACK;
    } else {
      const hoveredStruct = this.findStructureAt(world);
      if (hoveredStruct && hoveredStruct.alive &&
          !this.isAllied(hoveredStruct.house, this.playerHouse)) {
        this.cursorType = CursorType.ATTACK;
      } else {
        const cell = worldToCell(world.x, world.y);
        const passable = this.map.isPassable(cell.cx, cell.cy);
        this.cursorType = passable ? CursorType.MOVE : CursorType.NOMOVE;
      }
    }
  }

  /** Process player input — selection and commands */
  private processInput(): void {
    const { leftClick, rightClick, doubleClick, dragBox, ctrlHeld, shiftHeld, keys, scrollDelta } = this.input.state;

    // Sidebar scroll (mouse wheel when cursor is over sidebar) — per-strip
    if (scrollDelta !== 0 && this.input.state.mouseX >= this.canvas.width - Game.SIDEBAR_W) {
      const mouseX = this.input.state.mouseX;
      const sidebarX = this.canvas.width - Game.SIDEBAR_W;
      // Determine which strip mouse is over
      const leftBounds = this.renderer.getStripBounds('left');
      const rightBounds = this.renderer.getStripBounds('right');
      let targetStrip: StripType | null = null;
      if (mouseX >= leftBounds.x && mouseX < leftBounds.x + leftBounds.w) targetStrip = 'left';
      else if (mouseX >= rightBounds.x && mouseX < rightBounds.x + rightBounds.w) targetStrip = 'right';
      else targetStrip = mouseX < sidebarX + Game.SIDEBAR_W / 2 ? 'left' : 'right';

      if (targetStrip) {
        const items = this.cachedAvailableItems ?? this.getAvailableItems();
        const filteredItems = items.filter(it => getStripSide(it) === targetStrip);
        const rowH = Renderer.CAMEO_H + Renderer.CAMEO_GAP;
        const visibleH = this.renderer.getStripBounds(targetStrip).h;
        const maxScroll = Math.max(0, filteredItems.length * rowH - visibleH);
        const cur = this.stripScrollPositions[targetStrip];
        this.stripScrollPositions[targetStrip] = Math.max(0, Math.min(maxScroll, cur + Math.sign(scrollDelta) * rowH));
      }
    }

    // Minimap drag scroll: while holding left button on minimap, continuously scroll
    if (this.input.state.mouseDown) {
      const { mouseX, mouseY } = this.input.state;
      const { x: mmX, y: mmY, size: mmSize } = this.renderer.getMinimapBounds();
      if (mouseX >= mmX && mouseX <= mmX + mmSize &&
          mouseY >= mmY && mouseY <= mmY + mmSize) {
        const scale = mmSize / Math.max(this.map.boundsW, this.map.boundsH);
        const worldCX = this.map.boundsX + (mouseX - mmX) / scale;
        const worldCY = this.map.boundsY + (mouseY - mmY) / scale;
        this.camera.centerOn(worldCX * CELL_SIZE, worldCY * CELL_SIZE);
      }
    }

    // --- Escape: cancel placement/modes first, then pause ---
    if (keys.has('Escape')) {
      if (this.pendingPlacement) {
        // Refund: for walls, only refund if first wall not yet placed (prepaid)
        if (WALL_TYPES.has(this.pendingPlacement.type)) {
          if (this.wallPlacementPrepaid) this.addCredits(this.getEffectiveCost(this.pendingPlacement), true);
        } else {
          this.addCredits(this.getEffectiveCost(this.pendingPlacement), true);
        }
        this.pendingPlacement = null;
        this.wallPlacementPrepaid = false;
        keys.delete('Escape');
      } else if (this.chronoTankTargeting) {
        this.chronoTankTargeting = null;
        keys.delete('Escape');
      } else if (this.superweaponCursorMode) {
        this.superweaponCursorMode = null;
        this.superweaponCursorHouse = null;
        keys.delete('Escape');
      } else if (this.attackMoveMode || this.sellMode || this.repairMode) {
        this.attackMoveMode = false;
        this.sellMode = false;
        this.repairMode = false;
        keys.delete('Escape');
      } else {
        keys.delete('Escape');
        this.togglePause();
        return;
      }
    }

    // --- Pause toggle (P) ---
    if (keys.has('p')) {
      keys.delete('p');
      this.togglePause();
      return;
    }

    // --- Keyboard shortcuts ---
    // S = stop all selected units
    if (keys.has('s') && !keys.has('ArrowDown')) {
      for (const id of this.selectedIds) {
        const unit = this.entityById.get(id);
        if (!unit || !unit.alive) continue;
        unit.mission = Mission.GUARD;
        unit.target = null;
        unit.targetStructure = null;
        unit.forceFirePos = null;
        unit.moveTarget = null;
        unit.moveQueue = [];
        unit.path = [];
        unit.animState = AnimState.IDLE;
      }
      keys.delete('s');
    }

    // G = area guard (C++ conquer.cpp:781 — G key sends MISSION_GUARD_AREA)
    if (keys.has('g')) {
      for (const id of this.selectedIds) {
        const unit = this.entityById.get(id);
        if (!unit || !unit.alive) continue;
        unit.mission = Mission.AREA_GUARD;
        unit.target = null;
        unit.targetStructure = null;
        unit.forceFirePos = null;
        unit.moveTarget = null;
        unit.moveQueue = [];
        unit.path = [];
        unit.guardOrigin = { x: unit.pos.x, y: unit.pos.y };
        unit.animState = AnimState.IDLE;
      }
      keys.delete('g');
    }

    // Z = cycle stance (Aggressive → Defensive → Hold Fire → Aggressive)
    if (keys.has('z')) {
      for (const id of this.selectedIds) {
        const unit = this.entityById.get(id);
        if (!unit || !unit.alive || !unit.isPlayerUnit) continue;
        unit.stance = ((unit.stance + 1) % 3) as Stance;
      }
      keys.delete('z');
    }

    // Ctrl+0-9: assign control group (C++ conquer.cpp:979-1018: keys 1-0 → groups 0-9)
    if (ctrlHeld) {
      for (let g = 0; g <= 9; g++) {
        if (keys.has(String(g)) && this.selectedIds.size > 0) {
          // C++ foot.h:200-204 — Group is scalar (unsigned char): a unit can only be in one group.
          // Remove assigned units from all other groups before adding to new group.
          for (const id of this.selectedIds) {
            for (const [otherG, otherIds] of this.controlGroups) {
              if (otherG !== g) otherIds.delete(id);
            }
          }
          // Clean up now-empty groups
          for (const [otherG, otherIds] of this.controlGroups) {
            if (otherIds.size === 0) this.controlGroups.delete(otherG);
          }
          this.controlGroups.set(g, new Set(this.selectedIds));
          keys.delete(String(g)); // consume
        }
      }
    } else {
      // 0-9 without ctrl: recall control group; double-tap to center camera
      const now = Date.now();
      for (let g = 0; g <= 9; g++) {
        if (keys.has(String(g))) {
          const group = this.controlGroups.get(g);
          if (group && group.size > 0) {
            this.tabCyclePool = [];
            for (const e of this.entities) e.selected = false;
            this.selectedIds.clear();
            for (const id of group) {
              const unit = this.entityById.get(id);
              if (unit?.alive) {
                this.selectedIds.add(id);
                unit.selected = true;
              }
            }
            if (this.selectedIds.size > 0) this.playSelectionVoice();
            // Double-tap: center camera on group
            if (this.lastGroupKey === g && now - this.lastGroupTime < 400) {
              let cx = 0, cy = 0, count = 0;
              for (const id of this.selectedIds) {
                const u = this.entityById.get(id);
                if (u?.alive) { cx += u.pos.x; cy += u.pos.y; count++; }
              }
              if (count > 0) this.camera.centerOn(cx / count, cy / count);
            }
            this.lastGroupKey = g;
            this.lastGroupTime = now;
          }
          keys.delete(String(g)); // consume
        }
      }
    }

    // F1: toggle help overlay
    if (keys.has('F1')) {
      this.renderer.showHelp = !this.renderer.showHelp;
      keys.delete('F1');
    }

    // Volume controls: +/- and M for mute (adjust music and SFX independently)
    if (keys.has('+') || keys.has('=')) {
      this.audio.setSfxVolume(this.audio.getSfxVolume() + 0.1);
      this.audio.setMusicVolume(this.audio.getMusicVolume() + 0.1);
      keys.delete('+'); keys.delete('=');
    }
    if (keys.has('-') || keys.has('_')) {
      this.audio.setSfxVolume(this.audio.getSfxVolume() - 0.1);
      this.audio.setMusicVolume(this.audio.getMusicVolume() - 0.1);
      keys.delete('-'); keys.delete('_');
    }
    if (keys.has('m')) {
      this.audio.toggleMute();
      keys.delete('m');
    }
    if (keys.has('n')) {
      this.audio.music.next();
      keys.delete('n');
    }
    // Backtick: cycle game speed 1→2→4→1
    if (keys.has('`')) {
      this.gameSpeed = this.gameSpeed === 1 ? 2 : this.gameSpeed === 2 ? 4 : 1;
      if (this.turboMultiplier <= 4) this.turboMultiplier = this.gameSpeed;
      keys.delete('`');
    }

    // Home/Space: center camera on selected units
    if ((keys.has('Home') || keys.has(' ')) && this.selectedIds.size > 0) {
      let cx = 0, cy = 0, count = 0;
      for (const id of this.selectedIds) {
        const u = this.entityById.get(id);
        if (u?.alive) { cx += u.pos.x; cy += u.pos.y; count++; }
      }
      if (count > 0) {
        this.camera.centerOn(cx / count, cy / count);
      }
      keys.delete('Home');
      keys.delete(' ');
    }

    // Period (.): cycle through idle player units
    if (keys.has('.')) {
      const idle = this.entities.filter(e =>
        e.alive && e.isPlayerUnit &&
        (e.mission === Mission.GUARD || e.mission === Mission.AREA_GUARD) && !e.target
      );
      if (idle.length > 0) {
        this.lastIdleCycleIdx = this.lastIdleCycleIdx % idle.length;
        const unit = idle[this.lastIdleCycleIdx];
        // Select only this unit
        for (const e of this.entities) e.selected = false;
        this.selectedIds.clear();
        this.selectedIds.add(unit.id);
        unit.selected = true;
        this.camera.centerOn(unit.pos.x, unit.pos.y);
        this.playSelectionVoice();
        this.lastIdleCycleIdx = (this.lastIdleCycleIdx + 1) % idle.length;
      }
      keys.delete('.');
    }

    // E key: select all units of same type on the entire map
    if (keys.has('e') && !keys.has('ArrowRight') && this.selectedIds.size > 0) {
      const first = this.entityById.get([...this.selectedIds][0]);
      if (first?.alive) {
        for (const e of this.entities) e.selected = false;
        this.selectedIds.clear();
        for (const e of this.entities) {
          if (e.alive && e.isPlayerUnit && e.type === first.type) {
            this.selectedIds.add(e.id);
            e.selected = true;
          }
        }
        this.playSelectionVoice();
      }
      keys.delete('e');
    }

    // Tab: cycle through unit types in mixed selection (uses stored pool)
    if (keys.has('Tab')) {
      // If no active cycle pool, initialize from current mixed selection
      if (this.tabCyclePool.length === 0) {
        const selected = this.entities.filter(e => e.alive && this.selectedIds.has(e.id));
        if (selected.length > 1) {
          const types = [...new Set(selected.map(e => e.type))].sort();
          if (types.length > 1) {
            this.tabCyclePool = selected.map(e => e.id);
            this.tabCycleTypes = types;
            this.tabCycleTypeIndex = 0;
          }
        }
      }
      if (this.tabCyclePool.length > 0 && this.tabCycleTypes.length > 1) {
        this.tabCycleTypeIndex = (this.tabCycleTypeIndex + 1) % this.tabCycleTypes.length;
        const nextType = this.tabCycleTypes[this.tabCycleTypeIndex];
        for (const e of this.entities) e.selected = false;
        this.selectedIds.clear();
        for (const id of this.tabCyclePool) {
          const e = this.entityById.get(id);
          if (e?.alive && e.type === nextType) {
            this.selectedIds.add(e.id);
            e.selected = true;
          }
        }
        if (this.selectedIds.size > 0) this.audio.play(this.selectionSound());
      }
      keys.delete('Tab');
    }

    // D key: deploy MCV or MAD Tank
    if (keys.has('d') && !keys.has('ArrowRight')) {
      for (const id of this.selectedIds) {
        const unit = this.entityById.get(id);
        if (unit?.alive && unit.type === UnitType.V_MCV) {
          this.deployMCV(unit);
          break;
        }
        if (unit?.alive && unit.type === UnitType.V_QTNK) {
          this.deployMADTank(unit);
          break;
        }
        if (unit?.alive && unit.type === UnitType.V_CTNK && unit.chronoCooldown <= 0) {
          this.chronoTankTargeting = unit;
          this.pushEva('Select target');
          break;
        }
      }
      keys.delete('d');
    }

    // A key: toggle attack-move mode
    if (keys.has('a') && !keys.has('ArrowLeft')) {
      this.attackMoveMode = true;
      this.sellMode = false;
      this.repairMode = false;
      keys.delete('a');
    }

    // X key: scatter selected units to random nearby positions
    if (keys.has('x')) {
      for (const id of this.selectedIds) {
        const unit = this.entityById.get(id);
        if (!unit?.alive) continue;
        const angle = ScenarioRandom.float() * Math.PI * 2;
        const dist = CELL_SIZE * (2 + ScenarioRandom.float() * 2);
        const goalX = unit.pos.x + Math.cos(angle) * dist;
        const goalY = unit.pos.y + Math.sin(angle) * dist;
        unit.mission = Mission.MOVE;
        unit.moveTarget = { lx: pixelToLepton(goalX), ly: pixelToLepton(goalY) };
        unit.target = null;
        unit.moveQueue = [];
        unit.path = findPath(this.map, unit.cell, worldToCell(goalX, goalY), true, unit.isNavalUnit, unit.stats.speedClass);
        unit.pathIndex = 0;
        resetPathThreshold(unit); // C++ foot.cpp:1734
      }
      keys.delete('x');
    }

    // Q key: toggle sell mode
    if (keys.has('q')) {
      this.sellMode = !this.sellMode;
      this.repairMode = false;
      this.attackMoveMode = false;
      keys.delete('q');
    }

    // R key: toggle repair mode
    if (keys.has('r')) {
      this.repairMode = !this.repairMode;
      this.sellMode = false;
      this.attackMoveMode = false;
      keys.delete('r');
    }

    // --- Double-click: select all same type on screen ---
    if (doubleClick) {
      this.tabCyclePool = [];
      const world = this.camera.screenToWorld(doubleClick.x, doubleClick.y);
      const clicked = this.findEntityAt(world);
      if (clicked && clicked.isPlayerUnit) {
        for (const e of this.entities) e.selected = false;
        this.selectedIds.clear();
        // Select all alive player units of same type visible on screen
        for (const e of this.entities) {
          if (!e.alive || !e.isPlayerUnit || e.type !== clicked.type) continue;
          const screen = this.camera.worldToScreen(e.pos.x, e.pos.y);
          if (screen.x >= 0 && screen.x <= this.canvas.width &&
              screen.y >= 0 && screen.y <= this.canvas.height) {
            this.selectedIds.add(e.id);
            e.selected = true;
          }
        }
        this.playSelectionVoice();
      }
    }

    // --- Left click --- (clears Tab cycle pool)
    if (leftClick) {
      this.tabCyclePool = [];
      // Check minimap click first
      if (this.handleMinimapClick(leftClick.x, leftClick.y)) return;

      // Sidebar click — handle production
      if (leftClick.x >= this.canvas.width - Game.SIDEBAR_W) {
        this.handleSidebarClick(leftClick.x, leftClick.y);
        return;
      }

      // Chrono Tank deploy targeting — click to teleport
      if (this.chronoTankTargeting) {
        const world = this.camera.screenToWorld(leftClick.x, leftClick.y);
        this.teleportChronoTank(this.chronoTankTargeting, world);
        this.chronoTankTargeting = null;
        return;
      }

      // Superweapon cursor mode — click to activate superweapon at target
      if (this.superweaponCursorMode) {
        const world = this.camera.screenToWorld(leftClick.x, leftClick.y);
        this.activateSuperweapon(this.superweaponCursorMode, this.superweaponCursorHouse!, world);
        this.superweaponCursorMode = null;
        this.superweaponCursorHouse = null;
        return;
      }

      // Building placement mode — click to place structure
      if (this.pendingPlacement) {
        const world = this.camera.screenToWorld(leftClick.x, leftClick.y);
        const cx = Math.floor(world.x / CELL_SIZE);
        const cy = Math.floor(world.y / CELL_SIZE);
        if (this.placeStructure(cx, cy)) {
          return;
        }
        // Invalid placement — right-click to cancel (handled below)
        return;
      }

      // Sell mode: click on player structure to start sell animation (mode persists — RA1 parity)
      if (this.sellMode) {
        const world = this.camera.screenToWorld(leftClick.x, leftClick.y);
        const s = this.findStructureAt(world);
        if (s && s.alive && this.isAllied(s.house, this.playerHouse) &&
            s.sellProgress === undefined) {
          // Walls sell instantly — no animation, immediate removal + refund
          if (WALL_TYPES.has(s.type)) {
            s.alive = false;
            this.clearStructureFootprint(s);
            const prodItem = this.scenarioProductionItems.find(p => p.type === s.type);
            if (prodItem) {
              this.addCredits(sellRefund(prodItem.cost, true, prodItem.rawCost), true); // sell mode = human, uses rawCost
            }
            this.audio.play('sell');
          } else {
            s.sellProgress = 0; // start sell animation (refund deferred to finalization)
            s.sellHpAtStart = s.hp; // capture HP for refund tracking
            this.audio.play('sell');
          }
        }
        return;
      }

      // Repair mode: click on damaged player structure to toggle repair (mode persists — RA1 parity)
      if (this.repairMode) {
        const world = this.camera.screenToWorld(leftClick.x, leftClick.y);
        const s = this.findStructureAt(world);
        if (s && s.alive && this.isAllied(s.house, this.playerHouse) && s.hp < s.maxHp) {
          const idx = this.structures.indexOf(s);
          if (this.repairingStructures.has(idx)) {
            this.repairingStructures.delete(idx);
          } else {
            this.repairingStructures.add(idx);
            this.audio.play('heal');
          }
        }
        return;
      }

      // Attack-move: A+click = move to point but attack enemies along the way
      if (this.attackMoveMode) {
        this.attackMoveMode = false;
        const world = this.camera.screenToWorld(leftClick.x, leftClick.y);
        const units: Entity[] = [];
        for (const id of this.selectedIds) {
          const unit = this.entityById.get(id);
          if (unit?.alive) units.push(unit);
        }
        // Formation movement for attack-move orders
        const positions = this.calculateFormation(world.x, world.y, units.length, units);
        for (let i = 0; i < units.length; i++) {
          const unit = units[i];
          const pos = positions[i];
          unit.mission = Mission.HUNT;
          unit.moveTarget = worldToLeptonPos(pos);
          unit.target = null;
          unit.path = findPath(this.map, unit.cell, worldToCell(pos.x, pos.y), true, unit.isNavalUnit, unit.stats.speedClass);
          unit.pathIndex = 0;
        }
        if (units.length > 0) {
          this.playAckVoice(true);
          this.effects.push({
            type: 'marker', x: world.x, y: world.y, frame: 0, maxFrames: 15, size: 10,
            markerColor: 'rgba(255,200,60,1)',
          });
        }
        return;
      }

      const world = this.camera.screenToWorld(leftClick.x, leftClick.y);
      const clicked = this.findEntityAt(world);

      if (clicked && clicked.isPlayerUnit) {
        this.selectedStructureIdx = -1; // clear structure selection
        if (ctrlHeld) {
          // Ctrl+click: select all of same type on screen (C++ RA1 behavior)
          for (const e of this.entities) e.selected = false;
          this.selectedIds.clear();
          const screenBounds = this.camera.getVisibleBounds();
          for (const e of this.entities) {
            if (!e.alive || !e.isPlayerUnit || e.type !== clicked.type) continue;
            if (e.pos.x >= screenBounds.left && e.pos.x <= screenBounds.right &&
                e.pos.y >= screenBounds.top && e.pos.y <= screenBounds.bottom) {
              this.selectedIds.add(e.id);
              e.selected = true;
            }
          }
        } else {
          this.selectedIds.clear();
          for (const e of this.entities) e.selected = false;
          this.selectedIds.add(clicked.id);
          clicked.selected = true;
        }
        this.playSelectionVoice();
      } else {
        if (!ctrlHeld) {
          for (const e of this.entities) e.selected = false;
          this.selectedIds.clear();
        }
        // Click on player structure: select it for info display
        const clickedStruct = this.findStructureAt(world);
        if (clickedStruct && clickedStruct.alive &&
            this.isAllied(clickedStruct.house, this.playerHouse)) {
          this.selectedStructureIdx = this.structures.indexOf(clickedStruct);
          this.audio.play('select');
        } else {
          this.selectedStructureIdx = -1;
        }
      }
    }

    if (dragBox) {
      this.tabCyclePool = [];
      this.selectedStructureIdx = -1;
      if (!ctrlHeld) {
        this.selectedIds.clear();
        for (const e of this.entities) e.selected = false;
      }
      for (const e of this.entities) {
        if (!e.isPlayerUnit || !e.alive) continue;
        const screen = this.camera.worldToScreen(e.pos.x, e.pos.y);
        if (screen.x >= dragBox.x1 && screen.x <= dragBox.x2 &&
            screen.y >= dragBox.y1 && screen.y <= dragBox.y2) {
          this.selectedIds.add(e.id);
          e.selected = true;
        }
      }
    }

    if (rightClick) {
      // Cancel sell/repair/attack-move modes on right-click (RA1 parity)
      if (this.sellMode || this.repairMode || this.attackMoveMode) {
        this.sellMode = false;
        this.repairMode = false;
        this.attackMoveMode = false;
        return;
      }
      // Cancel chrono tank targeting
      if (this.chronoTankTargeting) {
        this.chronoTankTargeting = null;
        return;
      }
      // Cancel superweapon cursor mode
      if (this.superweaponCursorMode) {
        this.superweaponCursorMode = null;
        this.superweaponCursorHouse = null;
        return;
      }
      // Cancel placement mode
      if (this.pendingPlacement) {
        // Refund the cost (bypasses silo cap — C++ Refund_Money path)
        this.addCredits(this.getEffectiveCost(this.pendingPlacement), true);
        this.pendingPlacement = null;
        return;
      }

      // Cancel production from sidebar via right-click
      if (rightClick.x >= this.canvas.width - Game.SIDEBAR_W) {
        const items = this.getAvailableItems();
        const itemIdx = this.sidebarItemAt(rightClick.x, rightClick.y);
        if (itemIdx >= 0 && itemIdx < items.length) {
          const item = items[itemIdx];
          const factoryKey = getFactoryType(item);
          this.cancelProduction(factoryKey);
        }
        return;
      }

      // Minimap right-click: move selected units to that world position
      if (this.selectedIds.size > 0) {
        const { x: mmX, y: mmY, size: mmSize } = this.renderer.getMinimapBounds();
        if (rightClick.x >= mmX && rightClick.x <= mmX + mmSize &&
            rightClick.y >= mmY && rightClick.y <= mmY + mmSize) {
          const scale = mmSize / Math.max(this.map.boundsW, this.map.boundsH);
          const worldCX = this.map.boundsX + (rightClick.x - mmX) / scale;
          const worldCY = this.map.boundsY + (rightClick.y - mmY) / scale;
          const wx = worldCX * CELL_SIZE;
          const wy = worldCY * CELL_SIZE;
          const units: Entity[] = [];
          for (const id of this.selectedIds) {
            const u = this.entityById.get(id);
            if (u?.alive) units.push(u);
          }
          // Formation movement for minimap orders
          const positions = this.calculateFormation(wx, wy, units.length, units);
          for (let i = 0; i < units.length; i++) {
            const u = units[i];
            const pos = positions[i];
            u.mission = Mission.MOVE;
            u.moveTarget = worldToLeptonPos(pos);
            u.moveQueue = [];
            u.target = null;
            u.targetStructure = null;
            u.forceFirePos = null;
            u.teamMissions = [];
            u.teamMissionIndex = 0;
            u.path = findPath(this.map, u.cell, worldToCell(pos.x, pos.y), true, u.isNavalUnit, u.stats.speedClass);
            u.pathIndex = 0;
            resetPathThreshold(u); // C++ foot.cpp:1734
          }
          if (units.length > 0) {
            this.playAckVoice(false);
            this.effects.push({ type: 'marker', x: wx, y: wy, frame: 0, maxFrames: 15, size: 10,
              markerColor: 'rgba(60,255,60,1)' });
          }
          return;
        }
      }

      const world = this.camera.screenToWorld(rightClick.x, rightClick.y);

      // Force-fire on ground: Ctrl+right-click fires at a location
      // C++ techno.cpp:3446 — ANY armed unit can force-fire on ground with Ctrl+click
      if (ctrlHeld && this.selectedIds.size > 0) {
        for (const id of this.selectedIds) {
          const unit = this.entityById.get(id);
          if (!unit?.alive || !unit.weapon) continue;
          unit.mission = Mission.ATTACK;
          unit.target = null;
          unit.targetStructure = null;
          // Create a temporary ground target position
          unit.forceFirePos = { x: world.x, y: world.y };
        }
        this.playAckVoice(true);
        this.effects.push({
          type: 'marker', x: world.x, y: world.y, frame: 0, maxFrames: 15, size: 10,
          markerColor: 'rgba(255,200,60,1)',
        });
        return;
      }

      const target = this.findEntityAt(world);
      const targetStruct = !target ? this.findStructureAt(world) : null;

      // Transport load: selected infantry right-click on friendly transport
      if (target && target.isPlayerUnit && target.isTransport && target.alive) {
        let loaded = 0;
        for (const id of this.selectedIds) {
          const unit = this.entityById.get(id);
          if (!unit?.alive || unit.id === target.id) continue;
          if (!unit.stats.isInfantry) continue;
          if (target.passengers.length >= target.maxPassengers) break;
          // Move infantry to transport, then load on arrival
          const dist = worldDist(unit.pos, target.pos);
          if (dist < 1.5) { // worldDist returns cells
            // Close enough — load immediately
            target.passengers.push(unit);
            unit.transportRef = target;
            unit.isTethered = false;
            unit.selected = false;
            this.selectedIds.delete(unit.id);
            // Remove from world (will be re-added on unload)
            const removedIdx = this.entities.findIndex(e => e.id === unit.id);
            this.entities = this.entities.filter(e => e.id !== unit.id);
            if (removedIdx >= 0 && removedIdx < this._preBuildingEntityCount) {
              this._preBuildingEntityCount = Math.max(0, this._preBuildingEntityCount - 1);
            }
            this.entityById.delete(unit.id);
            this.map.setOccupancy(unit.cell.cx, unit.cell.cy, 0);
            if (unit.stats.isInfantry) this.map.vacateSubCell(unit.cell.cx, unit.cell.cy, unit.id);
            loaded++;
          } else {
            // Move toward transport (they'll be loaded by proximity check)
            unit.mission = Mission.MOVE;
            unit.moveTarget = { lx: target.leptonX, ly: target.leptonY };
            unit.path = findPath(this.map, unit.cell, target.cell, true);
            unit.pathIndex = 0;
          }
        }
        if (loaded > 0) {
          this.playAckVoice(false);
          this.effects.push({
            type: 'marker', x: target.pos.x, y: target.pos.y, frame: 0, maxFrames: 15, size: 8,
            markerColor: 'rgba(80,200,255,1)',
          });
          // C++ parity: transport auto-evacuates when a civilian/VIP is loaded
          if (target.stats.isAircraft &&
              target.passengers.some(p => CIVILIAN_UNIT_TYPES.has(p.type))) {
            this.orderTransportEvacuate(target);
          }
        }
        return;
      }

      // Transport unload: selected transport right-clicks open ground
      if (!target && !targetStruct) {
        for (const id of this.selectedIds) {
          const unit = this.entityById.get(id);
          if (!unit?.alive || !unit.isTransport || unit.passengers.length === 0) continue;
          // Unload passengers around the click point (on passable terrain)
          // C++ cargo.cpp:87-123: LIFO order — last loaded is unloaded first
          for (let pi = unit.passengers.length - 1; pi >= 0; pi--) {
            const p = unit.passengers[pi];
            // Find a passable position near the click point
            let px = world.x, py = world.y;
            for (let attempt = 0; attempt < 8; attempt++) {
              const ox = world.x + (ScenarioRandom.float() - 0.5) * CELL_SIZE * 2;
              const oy = world.y + (ScenarioRandom.float() - 0.5) * CELL_SIZE * 2;
              const tc = worldToCell(ox, oy);
              if (this.map.isPassable(tc.cx, tc.cy)) {
                px = ox; py = oy;
                break;
              }
            }
            p.alive = true;
            p.hp = p.hp > 0 ? p.hp : 1; // ensure alive units have HP
            p.transportRef = null;
            p.isTethered = p.stats.isInfantry;
            p.pos = { x: px, y: py };
            p.mission = Mission.GUARD;
            p.animState = AnimState.IDLE;
            p.animFrame = 0;
            p.deathTick = 0;
            this.entities.push(p);
            this.entityById.set(p.id, p);
          }
          unit.passengers = [];
          this.playAckVoice(false);
          this.effects.push({
            type: 'marker', x: world.x, y: world.y, frame: 0, maxFrames: 15, size: 10,
            markerColor: 'rgba(80,200,255,1)',
          });
          // Don't process further — unload was the command
          return;
        }
      }

      let commandIssued = false;
      // Formation movement for group orders
      const selectedUnits = [...this.selectedIds]
        .map(id => this.entityById.get(id))
        .filter((u): u is Entity => !!u?.alive);

      // Check if this is an attack or move order
      const isAttackOrder = (target && !this.isPlayerControlled(target) && target.alive) ||
                            (targetStruct && targetStruct.alive);

      if (isAttackOrder) {
        // Attack orders: each unit attacks the same target
        for (const unit of selectedUnits) {
          commandIssued = true;
          if (target && !this.isPlayerControlled(target) && target.alive) {
            unit.mission = Mission.ATTACK;
            unit.target = target;
            unit.targetStructure = null;
            unit.moveTarget = null;
            unit.guardOrigin = null; // explicit attack clears guard return
          } else if (targetStruct && targetStruct.alive) {
            // Attack structure
            unit.mission = Mission.ATTACK;
            unit.target = null;
            unit.targetStructure = targetStruct;
            unit.guardOrigin = null;
            unit.moveTarget = null;
          }
        }
      } else if (selectedUnits.length > 0) {
        // Move orders: use formation spread
        const positions = this.calculateFormation(world.x, world.y, selectedUnits.length, selectedUnits);
        for (let i = 0; i < selectedUnits.length; i++) {
          const unit = selectedUnits[i];
          const pos = positions[i];
          commandIssued = true;

          if (shiftHeld && unit.mission === Mission.MOVE) {
            // Shift+click: queue waypoint (don't change current path)
            // C++ foot.cpp:2294: cap at NAV_QUEUE_MAX (10) — silently drops overflow
            unit.queueWaypoint(worldToLeptonPos(pos));
          } else {
            unit.mission = Mission.MOVE;
            unit.moveTarget = worldToLeptonPos(pos);
            unit.moveQueue = [];
            unit.target = null;
            unit.targetStructure = null;
            unit.forceFirePos = null;
            // Clear team mission scripts and guard origin when player gives direct orders
            unit.teamMissions = [];
            unit.teamMissionIndex = 0;
            unit.guardOrigin = null;
            unit.path = findPath(
              this.map,
              unit.cell,
              worldToCell(pos.x, pos.y),
              true,
              unit.isNavalUnit,
              unit.stats.speedClass
            );
            unit.pathIndex = 0;
            resetPathThreshold(unit); // C++ foot.cpp:1734 — new move order resets PathThreshhold
          }
        }
      }
      if (commandIssued) {
        const isAttack = (target && !this.isPlayerControlled(target)) || targetStruct;
        this.playAckVoice(!!isAttack);
        // Spawn command marker at destination
        this.effects.push({
          type: 'marker', x: world.x, y: world.y, frame: 0, maxFrames: 15, size: 10,
          markerColor: isAttack ? 'rgba(255,60,60,1)' : 'rgba(80,255,80,1)',
        });
      }

      // Rally point: right-click with no units selected sets rally for active production
      if (!commandIssued && this.selectedIds.size === 0 && this.productionQueue.size > 0) {
        for (const [, entry] of this.productionQueue) {
          if (!entry.item.isStructure) {
            this.rallyPoints.set(entry.item.prerequisite, { x: world.x, y: world.y });
          }
        }
        this.effects.push({
          type: 'marker', x: world.x, y: world.y, frame: 0, maxFrames: 20, size: 8,
          markerColor: 'rgba(255,200,60,1)', // yellow rally marker
        });
        this.playAckVoice(false);
      }
    }
  }

  /** Hit-test a sidebar click against the dual production strips.
   *  Returns the index in the full items array, or -1 if no hit. */
  private sidebarItemAt(sx: number, sy: number): number {
    const items = this.getAvailableItems();

    // Determine which strip was clicked
    let strip: StripType | null = null;
    const leftBounds = this.renderer.getStripBounds('left');
    const rightBounds = this.renderer.getStripBounds('right');
    if (sx >= leftBounds.x && sx < leftBounds.x + leftBounds.w) strip = 'left';
    else if (sx >= rightBounds.x && sx < rightBounds.x + rightBounds.w) strip = 'right';
    if (!strip) return -1;

    const filteredItems = items.filter(it => getStripSide(it) === strip);
    const bounds = strip === 'left' ? leftBounds : rightBounds;
    const scroll = this.stripScrollPositions[strip];
    const rowH = Renderer.CAMEO_H + Renderer.CAMEO_GAP;

    const relY = sy - bounds.y + scroll;
    if (relY < 0) return -1;
    const idx = Math.floor(relY / rowH);
    if (idx < 0 || idx >= filteredItems.length) return -1;
    const targetItem = filteredItems[idx];
    return items.indexOf(targetItem);
  }

  /** Handle clicks on the sidebar production panel */
  private handleSidebarClick(sx: number, sy: number): void {
    const sidebarX = this.canvas.width - Game.SIDEBAR_W;

    // Minimap click — check first since it's at top now
    if (this.handleMinimapClick(sx, sy)) return;

    // Button row click detection — C++ English layout (repair=wide, sell/map=narrow)
    const btnRowY = this.renderer.getButtonRowY();
    const btnH = Renderer.BUTTON_H;
    if (sy >= btnRowY && sy < btnRowY + btnH) {
      const relX = sx - sidebarX;
      if (relX >= Renderer.BUTTON_ONE_X && relX < Renderer.BUTTON_ONE_X + Renderer.BUTTON_ONE_W) {
        // Repair button
        this.repairMode = !this.repairMode;
        this.sellMode = false;
      } else if (relX >= Renderer.BUTTON_TWO_X && relX < Renderer.BUTTON_TWO_X + Renderer.BUTTON_TWO_W) {
        // Sell button
        this.sellMode = !this.sellMode;
        this.repairMode = false;
      } else if (relX >= Renderer.BUTTON_THREE_X && relX < Renderer.BUTTON_THREE_X + Renderer.BUTTON_THREE_W) {
        // U6: Map button — toggle fullscreen radar overlay
        this.isRadarFullscreen = !this.isRadarFullscreen;
      }
      return;
    }

    // Check superweapon button clicks (at bottom of sidebar)
    const swClick = this.handleSuperweaponButtonClick(sy);
    if (swClick) return;

    // Scroll arrow click detection — C++ layout: both buttons side-by-side below strip
    for (const strip of ['left', 'right'] as const) {
      const ab = this.renderer.getScrollArrowBounds(strip);
      const rowH = Renderer.CAMEO_H; // CAMEO_GAP = 0
      // Up button (left)
      if (sx >= ab.upX && sx < ab.upX + ab.upW && sy >= ab.upY && sy < ab.upY + ab.upH) {
        this.stripScrollPositions[strip] = Math.max(0, this.stripScrollPositions[strip] - rowH);
        return;
      }
      // Down button (right)
      if (sx >= ab.downX && sx < ab.downX + ab.downW && sy >= ab.downY && sy < ab.downY + ab.downH) {
        const items = this.cachedAvailableItems ?? this.getAvailableItems();
        const filteredItems = items.filter(it => getStripSide(it) === strip);
        const visibleH = this.renderer.getStripBounds(strip).h;
        const maxScroll = Math.max(0, filteredItems.length * rowH - visibleH);
        this.stripScrollPositions[strip] = Math.min(maxScroll, this.stripScrollPositions[strip] + rowH);
        return;
      }
    }

    // Production item click (dual strips)
    const items = this.getAvailableItems();
    const itemIdx = this.sidebarItemAt(sx, sy);
    if (itemIdx < 0 || itemIdx >= items.length) return;
    const item = items[itemIdx];
    this.startProduction(item);
  }

  /** Center camera on the player's construction yard or first building */
  private centerOnBase(): void {
    for (const s of this.structures) {
      if (s.alive && this.isAllied(s.house, this.playerHouse) && s.type === 'FACT') {
        this.camera.centerOn(s.cx * CELL_SIZE + CELL_SIZE, s.cy * CELL_SIZE + CELL_SIZE);
        return;
      }
    }
    for (const s of this.structures) {
      if (s.alive && this.isAllied(s.house, this.playerHouse)) {
        this.camera.centerOn(s.cx * CELL_SIZE + CELL_SIZE, s.cy * CELL_SIZE + CELL_SIZE);
        return;
      }
    }
  }

  /** Check if a sidebar click hit a superweapon button. Returns true if handled. */
  private handleSuperweaponButtonClick(sy: number): boolean {
    // Superweapon buttons are at the very bottom of sidebar
    const btnH = 10 * RESFACTOR;
    const playerSws = this.getPlayerSuperweapons();
    if (playerSws.length === 0) return false;

    const buttonsStartY = this.canvas.height - playerSws.length * btnH;
    for (let i = 0; i < playerSws.length; i++) {
      const btnY = buttonsStartY + i * btnH;
      if (sy >= btnY && sy < btnY + btnH) {
        const sw = playerSws[i];
        if (sw.state.ready) {
          const def = SUPERWEAPON_DEFS[sw.state.type];
          if (def.needsTarget) {
            // Enter target selection cursor mode
            this.superweaponCursorMode = sw.state.type;
            this.superweaponCursorHouse = sw.state.house;
          }
          // Auto-fire weapons (GPS/Sonar) are handled in updateSuperweapons
        }
        return true;
      }
    }
    return false;
  }

  /** Get player's available superweapons for sidebar display */
  getPlayerSuperweapons(): Array<{ state: SuperweaponState; def: SuperweaponDef }> {
    const result: Array<{ state: SuperweaponState; def: SuperweaponDef }> = [];
    for (const [, state] of this.superweapons) {
      if (!this.isAllied(state.house as House, this.playerHouse)) continue;
      const def = SUPERWEAPON_DEFS[state.type];
      if (!def) continue;
      // Don't show GPS after it's been fired (one-shot)
      if (state.type === SuperweaponType.GPS_SATELLITE && state.fired) continue;
      result.push({ state, def });
    }
    return result;
  }

  /** Map weapon name to projectile visual style */
  private weaponProjectileStyle(name: string): 'bullet' | 'fireball' | 'shell' | 'rocket' | 'grenade' {
    switch (name) {
      case 'FireballLauncher': case 'Flamer': case 'Napalm': return 'fireball';
      case '75mm': case '90mm': case '105mm': case '120mm': case '155mm': return 'shell';
      case 'Dragon': case 'RedEye': case 'MammothTusk': case 'SCUD': case 'Maverick': case 'Hellfire': case 'SubSCUD': return 'rocket';
      case 'Grenade': return 'grenade';
      default: return 'bullet';
    }
  }

  /** Map warhead type to muzzle flash color (RGB) — C++ parity */
  private warheadMuzzleColor(warhead: WarheadType | string): string {
    switch (warhead) {
      case 'Fire': return '255,150,50';                  // orange fire
      case 'Super': return '100,150,255';                // blue (tesla)
      case 'AP': return '255,200,80';                    // amber armor-piercing
      case 'HE': return '255,255,100';                   // yellow high-explosive
      case 'Organic': return '100,255,100';              // green organic
      default: return '255,255,150';                     // SA/HollowPoint/default
    }
  }

  /** Play a positional sound at a world location (spatial stereo panning) */
  private playSoundAt(name: SoundName, worldX: number, worldY: number): void {
    this.audio.playAt(name, worldX, worldY, this.camera.x, this.camera.viewWidth);
  }

  /** Play EVA announcement with throttle (~45 ticks) */
  private playEva(sound: SoundName): void {
    // C++ audio.cpp:643-648 — Speak() has NO power gate. EVA always plays
    // regardless of power level. Removed AU4 power gate for C++ parity.
    const last = this.lastEvaTime.get(sound) ?? 0;
    if (this.tick - last < 45) return; // 3 second throttle
    this.lastEvaTime.set(sound, this.tick);
    this.audio.play(sound);
  }

  /** Get appropriate acknowledgment sound for current selection */
  private ackSound(isAttack: boolean): SoundName {
    for (const id of this.selectedIds) {
      const e = this.entityById.get(id);
      if (!e?.alive) continue;
      if (isAttack) return 'attack_ack';
      if (e.type === UnitType.I_DOG) return 'move_ack_dog';
      if (e.stats.isInfantry) return 'move_ack_infantry';
      return 'move_ack_vehicle';
    }
    return isAttack ? 'attack_ack' : 'move_ack';
  }

  /** Get appropriate selection sound for current selection */
  private selectionSound(): 'select' | 'select_infantry' | 'select_vehicle' | 'select_dog' {
    // Pick sound based on first selected alive unit
    for (const id of this.selectedIds) {
      const e = this.entityById.get(id);
      if (!e?.alive) continue;
      if (e.type === UnitType.I_DOG) return 'select_dog';
      if (e.stats.isInfantry) return 'select_infantry';
      return 'select_vehicle';
    }
    return 'select';
  }

  /** Play selection voice with throttling (0.5s = 8 ticks at 15 FPS) */
  private playSelectionVoice(): void {
    if (this.tick - this.lastVoiceTick < 8) return;
    this.lastVoiceTick = this.tick;
    this.audio.play(this.selectionSound());
  }

  /** Play acknowledgment voice with throttling (0.5s = 8 ticks at 15 FPS) */
  private playAckVoice(isAttack: boolean): void {
    if (this.tick - this.lastVoiceTick < 8) return;
    this.lastVoiceTick = this.tick;
    this.audio.play(this.ackSound(isAttack));
  }

  /** Find an entity near a world position */
  private findEntityAt(pos: WorldPos): Entity | null {
    let closest: Entity | null = null;
    let closestDist = 20;

    for (const e of this.entities) {
      if (!e.alive) continue;
      const dx = e.pos.x - pos.x;
      const dy = e.pos.y - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist) {
        closestDist = dist;
        closest = e;
      }
      // Aircraft: also check against visual position (offset up by flightAltitude)
      // so players can click on airborne aircraft where they appear on screen
      if (e.isAirUnit && e.flightAltitude > 0) {
        const dyAlt = (e.pos.y - e.flightAltitude) - pos.y;
        const distAlt = Math.sqrt(dx * dx + dyAlt * dyAlt);
        if (distAlt < closestDist) {
          closestDist = distAlt;
          closest = e;
        }
      }
    }
    return closest;
  }

  /** Find a structure near a world position */
  private findStructureAt(pos: WorldPos): MapStructure | null {
    const cx = Math.floor(pos.x / CELL_SIZE);
    const cy = Math.floor(pos.y / CELL_SIZE);
    return this.findStructureAtCell(cx, cy);
  }

  private findStructureAtCell(cx: number, cy: number): MapStructure | null {
    for (const s of this.structures) {
      if (!s.alive) continue;
      const [fw, fh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
      if (cx >= s.cx && cx < s.cx + fw && cy >= s.cy && cy < s.cy + fh) {
        return s;
      }
    }
    return null;
  }

  /** C++ UnitClass::Can_Enter_Cell special case (unit.cpp:3129-3142):
   *  a vehicle may drive onto the building it is cooperatively entering.
   *
   *  TS marks building footprint as WALL terrain instead of putting a
   *  BuildingClass object in Cell_Occupier(), so the generic map predicate
   *  would reject refinery docking cells before this exception can apply.
   *  Keep this scoped to the radio-driven harvester ENTER flow: allied PROC,
   *  NavCom equal to BuildingClass RADIO_DOCKING's south-center dock cell
   *  (building.cpp:305-306), and the tested cell inside that PROC footprint. */
  private isAuthorizedBuildingEnterCell(entity: Entity, cx: number, cy: number): boolean {
    if ((entity.mission as Mission) !== Mission.ENTER) return false;
    if (entity.stats.isInfantry || entity.isAirUnit || entity.isNavalUnit) return false;
    if (entity.type !== UnitType.V_HARV || !entity.moveTarget) return false;

    const structure = this.findStructureAtCell(cx, cy);
    if (!structure || structure.type !== 'PROC' || !this.isAllied(structure.house, entity.house)) {
      return false;
    }

    const [, procH] = STRUCTURE_SIZE[structure.type] ?? [3, 2];
    const dockCx = structure.cx + 1;
    const dockCy = structure.cy + procH - 1;
    const navCx = Math.floor(entity.moveTarget.lx / LEPTON_SIZE);
    const navCy = Math.floor(entity.moveTarget.ly / LEPTON_SIZE);
    return navCx === dockCx && navCy === dockCy && cx === navCx && cy === navCy;
  }

  /** C++ UnitClass::Can_Enter_Cell authorizes a radio-tethered factory product
   *  to enter cells occupied by its contact building:
   *    obj == Contact_With_Whom() && IsTethered -> MOVE_OK
   *
   *  TS marks building footprints as WALL terrain, so the map-level predicate
   *  rejects the WEAP footprint before this object/contact exception can apply.
   *  Keep the override scoped to the current WEAP contact so Basic_Path can
   *  reproduce factory-egress paths without making arbitrary buildings passable. */
  private isAuthorizedFactoryTetherCell(entity: Entity, cx: number, cy: number): boolean {
    if (!entity.isTethered || entity.stats.isInfantry || entity.isAirUnit || entity.isNavalUnit) {
      return false;
    }
    const structure = this.findStructureAtCell(cx, cy);
    return !!structure &&
      structure.type === 'WEAP' &&
      structure.aiFactoryContactEntityId === entity.id &&
      this.isAllied(structure.house, entity.house);
  }

  /** Clear a structure's footprint cells back to passable (including bib row) */
  private clearStructureFootprint(s: MapStructure): void {
    for (const cell of getStructureOccupyCells(s.type, s.cx, s.cy)) {
      this.map.setTerrain(cell.cx, cell.cy, Terrain.CLEAR);
      this.map.clearWallType(cell.cx, cell.cy);
    }
    // C++ building.cpp:734-740: Clear bib cells when building is removed/destroyed
    for (const bc of getBibCells(s.type, s.cx, s.cy)) {
      this.map.setTerrain(bc.cx, bc.cy, Terrain.CLEAR);
    }
  }

  /** Damage a structure, return true if destroyed */
  private damageStructure(s: MapStructure, damage: number): boolean {
    return this._runCombat(ctx => _structureDamage(ctx, s, damage));
  }

  /** Process a single non-aircraft entity for one tick.
   *  Handles per-tick state (rotation guards, recoil, cloak, fear),
   *  then delegates to updateEntity() for mission/movement AI.
   *  Extracted from the entity loop to support the split pre/post-building passes. */
  private _processGroundEntity(entity: Entity): void {
    // Reset per-tick rotation guards (prevents double-accumulation)
    entity.rotTickedThisFrame = false;
    entity.turretRotTickedThisFrame = false;
    // Clear recoil from previous tick (C++ techno.cpp:2339 — recoil lasts 1 tick)
    if (entity.isInRecoilState) entity.isInRecoilState = false;

    // C++ bullet.cpp:96-175 — dog in limbo rides bullet; skip all processing
    if (entity.inLimbo) return;
    // C++ TechnoClass::AI runs Cloaking_AI even for destroyed non-infantry
    // objects that still remain in Logic/Cell_Occupier. SCG07EA has a dead SS
    // in MISSION_DIE that still burns the low-health Percent_Chance(4) cloak
    // roll before normal dead-object processing stops.
    if (entity.stats.isCloakable) {
      this.updateSubCloak(entity);
    }
    // LST door auto-close timer
    if (entity.alive && entity.doorOpen && entity.doorTimer > 0) {
      entity.doorTimer--;
      if (entity.doorTimer <= 0) entity.doorOpen = false;
    }
    if (entity.alive && entity.doorOpeningTicks > 0) {
      entity.doorOpeningTicks--;
    }
    // Sonar pulse timer decrement
    if (entity.sonarPulseTimer > 0) entity.sonarPulseTimer--;

    // C5: Track previous position for moving-platform inaccuracy detection
    // S5: Track wasMoving for NoMovingFire setup time
    const wasMovingBefore = entity.pos.x !== entity.prevPos.x || entity.pos.y !== entity.prevPos.y;
    entity.prevPos.x = entity.pos.x;
    entity.prevPos.y = entity.pos.y;
    // Save previous facing for visual interpolation (smooth 60fps rotation rendering)
    entity.prevBodyFacing32 = entity.bodyFacing32;
    entity.prevTurretFacing32 = entity.turretFacing32;

    if (!entity.alive) {
      entity.tickAnimation();
      // C++ CDTimerClass<FrameTimerClass> timers are frame-derived, not
      // MissionClass-AI-derived. Destroyed non-infantry Techno objects can
      // remain in Logic for their MISSION_DIE lifetime, and their Arm timer
      // continues to expire while TechnoClass::Cloaking_AI still runs. SCG07EA
      // logic index 72 (dead SS) depends on Arm reaching 0 so
      // Is_Ready_To_Cloak() burns the low-health Percent_Chance(4) roll.
      this.decrementEntityCdTimersEndOfLogic(entity);
      return;
    }
    this.updateEntity(entity);

    // Special unit updates — run after standard entity update
    if (entity.alive && entity.type === UnitType.V_QTNK && entity.isDeployed) {
      this.updateMADTank(entity);
    }
    if (entity.alive && entity.type === UnitType.V_CTNK) {
      this.updateChronoTank(entity);
    }
    if (entity.alive && entity.stats.isCloakable && !entity.stats.isVessel) {
      this.updateVehicleCloak(entity);
    }
    // S5: Update wasMoving — entity moved this tick if position changed from prevPos
    const movedThisTick = entity.pos.x !== entity.prevPos.x || entity.pos.y !== entity.prevPos.y;
    entity.wasMoving = wasMovingBefore || movedThisTick;
  }

  /** C++ ObjectClass::AI falling block (object.cpp:237-254).
   *  Returns true while non-air TechnoClass::AI must return early because
   *  Height > 0 (techno.cpp:2346). When the object lands this tick, the C++
   *  code calls Per_Cell_Process(PCP_END) and then continues into normal
   *  Techno/Mission AI, so this returns false after landing. */
  private updateFallingEntity(entity: Entity): boolean {
    if (!entity.isFalling) return false;

    entity.fallHeightLeptons += entity.fallRiser;
    if (entity.fallHeightLeptons <= 0) {
      entity.fallHeightLeptons = 0;
      entity.flightAltitude = 0;
      entity.isFalling = false;
      entity.fallRiser = 0;
      entity.fallHasAttachedAnim = false;

      if (entity.stats.isInfantry && FOOT_PER_CELL_ENABLED) {
        const liveTar = !!(entity.target?.alive) || entity.targetStructure != null;
        const inRangeNow = !!(entity.target?.alive) && entity.inRangeOfLikelyCoord(entity.target);
        const pathShortenEligible =
          entity.mission === Mission.RESCUE ||
          entity.mission === Mission.AREA_GUARD ||
          entity.mission === Mission.ATTACK ||
          entity.mission === Mission.HUNT;
        footPerCellProcess(
          entity as unknown as Parameters<typeof footPerCellProcess<Mission>>[0],
          PCPType.PCP_END,
          {
            hasLegalTarCom: liveTar,
            inRadioContact: false,
            pathShortenEligible,
            targetInRange: inRangeNow,
          },
          {
            guardMission: Mission.GUARD,
            areaGuardMission: Mission.AREA_GUARD,
            attackMission: Mission.ATTACK,
            huntMission: Mission.HUNT,
            rescueMission: Mission.RESCUE,
          }
        );
      }
      return false;
    }

    entity.flightAltitude = leptonToPixel(entity.fallHeightLeptons);
    if (entity.fallHasAttachedAnim) {
      entity.fallRiser = Math.max(entity.fallRiser - 1, -3);
    } else {
      entity.fallRiser = Math.max(entity.fallRiser - RULE_GRAVITY, -100);
    }
    return true;
  }

  /** Update a single entity's AI and movement */
  /** C++ TechnoClass::AI target maintenance (techno.cpp:2378-2387).
   *
   * Non-air techno objects clear TarCom when they are not in a team, their
   * target is outside their movement zone, and the selected weapon is not
   * already in range. This prevents computer HUNT units from keeping an
   * unreachable stale target forever; Mission_Hunt can then acquire a new
   * Greatest_Threat on its next timer tick.
   */
  private technoTargetMaintenance(entity: Entity): void {
    if (entity.isAirUnit) return;
    if (!entity.target?.alive && !entity.targetStructure) return;

    // C++ exempts FootClass members with a valid Team pointer. TS has both the
    // C++-style teamRef port and older per-entity teamMissions; treat either as
    // team ownership so team-assigned targets are not cleared by this generic
    // TechnoClass maintenance pass.
    if (entity.teamRef || entity.teamMissions.length > 0) return;

    let targetCx: number;
    let targetCy: number;
    let targetInRange = false;
    if (entity.target?.alive && !entity.target.inLimbo) {
      targetCx = entity.target.cell.cx;
      targetCy = entity.target.cell.cy;
      targetInRange = entity.inRange(entity.target);
    } else if (entity.targetStructure) {
      const s = entity.targetStructure as { alive?: boolean; cx: number; cy: number; type?: string };
      if (s.alive === false) return;
      const [sw, sh] = s.type ? (STRUCTURE_SIZE[s.type] ?? [1, 1]) : [1, 1];
      targetCx = s.cx + Math.floor(sw / 2);
      targetCy = s.cy + Math.floor(sh / 2);
      targetInRange = entity.inRangeCoord(
        s.cx * LEPTON_SIZE + Math.floor(sw * LEPTON_SIZE / 2),
        s.cy * LEPTON_SIZE + Math.floor(sh * LEPTON_SIZE / 2),
      );
    } else {
      return;
    }

    const zone = movementZoneCells(this.map, entity.cell, entity.isNavalUnit, this.structures);
    const targetIdx = targetCy * MAP_CELLS + targetCx;
    const targetInSameZone =
      targetCx >= 0 && targetCx < MAP_CELLS &&
      targetCy >= 0 && targetCy < MAP_CELLS &&
      zone[targetIdx] !== 0;

    if (!targetInSameZone && !targetInRange) {
      entity.target = null;
      entity.targetStructure = null;
    }
  }

  private updateEntity(entity: Entity): void {
    // C++ parity: obj->AI() runs once per tick. Reset per-tick PCP counters
    // and Commence dedup flags at the top of each updateEntity call so the
    // track-jump PCP wiring (plan §6) and the diagnostic dumps (plan §5) see
    // a clean slate. These fields are declared on Entity; reset here rather
    // than in Entity's tick hook to keep the control flow visible.
    entity.speedBudgetConsumed = 0;
    entity.cellBoundaryCrossings = 0;
    entity._commenceFiredThisTick = false;
    entity._commenceFiredBoundaries.clear();

    // C++ TechnoClass::AI (techno.cpp:2346) returns before MissionClass::AI
    // while a non-air object is still falling from ObjectClass::Paradrop.
    if (!entity.isAirUnit && this.updateFallingEntity(entity)) {
      return;
    }

    this.technoTargetMaintenance(entity);

    // Team mission script execution (rate-limited to every 8 ticks)
    // Area Guard ants use their own patrol logic, not global hunt AI
    if (entity.mission !== Mission.DIE && entity.mission !== Mission.AREA_GUARD &&
        entity.mission !== Mission.RETREAT) {
      if (this.tick - entity.lastAIScan >= 8) {
        entity.lastAIScan = this.tick;
        if (entity.teamMissions.length > 0) {
          this.updateTeamMission(entity);
        } else if (entity.isAnt) {
          this.updateAntAI(entity);
        }
      }
    }

    // Aircraft state machine — intercept before normal mission processing
    if (entity.isAirUnit && this._runAircraft(ctx => _updateAircraft(ctx, entity))) {
      return; // aircraft state machine handled this tick
    }

    // Air units: gradually descend when not in active flight states
    if (entity.isAirUnit && entity.flightAltitude > 0 &&
        entity.aircraftState !== 'attacking' && entity.aircraftState !== 'flying' &&
        entity.aircraftState !== 'returning' && entity.aircraftState !== 'takeoff' &&
        entity.mission !== Mission.MOVE) {
      entity.flightAltitude = Math.max(0, entity.flightAltitude - 1);
    }

    // C++ CDTimerClass<FrameTimerClass>: Value() is read at Logic entry; Frame++
    // at the end of the loop makes the timer tick down after this object's AI
    // has used it. TS mirrors that by dispatching from the current value and
    // decrementing mission/weapon cooldown timers at end-of-logic.
    entity.attackCooldownAtLogicStart = entity.attackCooldown;
    entity.attackCooldown2AtLogicStart = entity.attackCooldown2;

    // C++ TechnoClass::AI (techno.cpp:2392-2398) → StageClass::Graphic_Logic advances
    // animation stage each tick. InfantryClass::Firing_AI reads Fetch_Stage() AFTER
    // this increment when gating Fire_At. Stage advances BEFORE the per-tick Firing_AI
    // check so that tick N+FireLaunch observes stage == FireLaunch.
    entity.advanceDoingStage(this.tick);
    if (entity.firePrepActive && !entity.firePrepUsesDoingStage) entity.firePrepStage++;
    // C++ IsDriving persists between ticks — set by Start_Driver, cleared by Stop_Driver.
    // Do NOT clear it per-tick; let moveToward set it on first call and clear on arrival.

    // C++ MissionClass::AI dispatch checks Timer.Value() at Logic entry.
    // The decrement is implicit after Logic through Frame++ (ftimer.h:549-561),
    // so do not pre-decrement here; decrement at end-of-logic instead.
    let missionTimerFired = entity.missionTimer <= 0;

    // nonInterruptAnimTicks mirrors C++ StageClass gesture/salute timing.
    // StageClass::Set_Rate() starts the CDTimer at the current Frame; the
    // animation cannot consume a tick in the same frame Do_Action was called.
    if (entity.nonInterruptAnimTicks > 0 && entity.nonInterruptAnimSetTick !== this.tick) {
      entity.nonInterruptAnimTicks--;
    }

    // C++ UnitClass::AI (unit.cpp:404) / VesselClass::AI (vessel.cpp:592) — pre-Commence
    // gate that runs BEFORE MissionClass::AI dispatch. Vehicles/vessels call Commence()
    // twice per AI tick: once before DriveClass::AI, once after (unit.cpp:472). Infantry
    // only Commence AFTER MissionClass::AI (infantry.cpp:1210), so the post-dispatch gate
    // below handles them. Without this pre-Commence, a team-activation tick that queues
    // MissionQueue=MOVE gets a 1-tick delay: queue pops at end-of-tick, Mission_Move
    // fires on the following tick — whereas C++ pops and dispatches Mission_Move on the
    // SAME tick (SCG04EA tick 3: WASM fires tag 60010 at tick 3, TS at tick 4).
    // ── Phase 1 Checkpoint 1.D: STAGE A-F flow gated behind flag ─────────────
    const infantryDrivingAtLogicStart = entity.stats.isInfantry && entity.isDriving;
    if (DISPATCH_ORDER_REFACTOR) {
      // STAGE A: Pre-MissionClass::AI Commence (vehicles, unit.cpp:406).
      // Identical to the legacy pre-Commence gate — pop MissionQueue when
      // idle so the new mission's handler fires under STAGE B this tick.
      if (!entity.stats.isInfantry && !entity.isAirUnit &&
          entity.missionQueue !== null && !entity.isDriving &&
          !entity.firePrepActive && !entity.isFiringAnim && entity.nonInterruptAnimTicks <= 0) {
        entity.mission = entity.missionQueue;
        entity.missionQueue = null;
        entity.missionTimer = 0;
        missionTimerFired = true;
      }

      // STAGE B: MissionClass::AI — dispatch only when Timer==0, matching
      // C++ mission.cpp:213-321. When Timer>0, C++ continues to run Firing_AI
      // and Movement_AI separately (STAGE C + STAGE D). The per-tick inline
      // firing/movement currently bundled inside `dispatchMission` handlers
      // is therefore NOT invoked between timer fires under this flow — this
      // is an intentional regression that Phase 1's STAGE C/D lift-and-shift
      // will restore. Current stubs are empty, so Firing_AI + Movement_AI
      // are skipped between timer fires when the flag is ON.
      let missionHandlerRan = false;
      const missionBeforeStageB = entity.mission as Mission;
      let harvesterMissionClassRan = false;
      if (entity.missionTimer === 0) {
        this.dispatchMission(entity, true);
        missionHandlerRan = true;
        harvesterMissionClassRan =
          (missionBeforeStageB === Mission.HARVEST || missionBeforeStageB === Mission.ENTER) &&
          entity.type === UnitType.V_HARV;
      }

      // C++ InfantryClass::AI order is:
      //   FootClass::AI() -> MissionClass::AI()
      //   Commence()
      //   Firing_AI()
      //   Doing_AI()
      //   Movement_AI()
      //
      // The previous TS STAGE E placement popped infantry queues after
      // Movement_AI. That delayed Start_Driver by one tick: a queued MOVE became
      // Mission.MOVE at end-of-tick, but Movement_AI did not see it until the
      // next object AI tick. In C++, Commence runs before Movement_AI, so an
      // infantry queue popped this tick can start its driver this tick (while
      // Mission_Move's timer handler still waits for the next tick).
      if (entity.stats.isInfantry &&
          !entity.firePrepActive &&
          !entity.isFiringAnim &&
          !entity.isDriving &&
          entity.isDoingInterruptible()) {
        // C++ infantry.cpp:1208-1210: freshly constructed MissionClass
        // objects start at MISSION_NONE. If they have no queue, Enter_Idle_Mode
        // supplies the normal class idle mission before Commence().
        if (entity.mission === Mission.NONE && entity.missionQueue === null) {
          entity.missionQueue = this.idleMission(entity);
        }
        if (entity.missionQueue !== null) {
          const popFromA2 =
            entity.missionQueue === Mission.MOVE &&
            entity.mission === Mission.ATTACK &&
            entity.savedMoveTarget !== null;
          entity.mission = entity.missionQueue;
          entity.missionQueue = null;
          if (popFromA2) {
            entity.savedMoveTarget = null;
          } else {
            entity.missionTimer = 0;
          }
        }
      }

      // C++ infantry.cpp:1223 calls Fear_AI() after the Commence gate and
      // before Firing_AI. Running this earlier lets DO_LIE_DOWN block a
      // MissionQueue pop that C++ has already accepted.
      if (entity.stats.isInfantry) {
        this.runInfantryFearAI(entity, infantryDrivingAtLogicStart);
      }

      // STAGE C: Firing_AI — per-tick fire-through when target in range and
      // weapon ready. Mirrors C++ TechnoClass::Firing_AI (infantry.cpp:3651 /
      // unit.cpp:2429) which runs every tick independent of MissionClass::AI
      // timer dispatch. Idempotent — updateAttack gates on attackCooldown and
      // firePrep so repeat calls within the same tick are no-ops.
      //
      // Skipped when:
      //   (1) STAGE B already dispatched a handler that still runs its own
      //       Firing_AI swap (HUNT / ATTACK legacy paths). Guard and Area Guard
      //       are exceptions: C++ FootClass::Mission_Guard returns its
      //       Normal_Delay+Random_Pick jitter before InfantryClass::Firing_AI
      //       runs, so their firing must happen here after dispatch.
      //   (2) Mission.MOVE infantry — STAGE D's MOVE branch runs the
      //       Firing_AI-before-Movement_AI path so movement can be skipped
      //       when a fire animation starts.
      const skipFiringAIForMoveInfantry =
        entity.stats.isInfantry && (entity.mission as Mission) === Mission.MOVE;
      const runInfantryFiringAfterGuardDispatch =
        missionHandlerRan &&
        entity.stats.isInfantry &&
        (
          missionBeforeStageB === Mission.ATTACK ||
          missionBeforeStageB === Mission.HUNT ||
          missionBeforeStageB === Mission.RESCUE ||
          missionBeforeStageB === Mission.GUARD ||
          missionBeforeStageB === Mission.STICKY ||
          missionBeforeStageB === Mission.AREA_GUARD
        );
      // C++ class order differs by locomotor:
      //   InfantryClass::AI: Firing_AI before Movement_AI (infantry.cpp:1237-1247)
      //   Unit/Vessel::AI: DriveClass::AI before Firing/Combat_AI
      //     (unit.cpp:408/425, vessel.cpp:620/633)
      //
      // Earlier TS ran this pre-movement Firing_AI for every entity class, so
      // SCG07EA's HUNTing submarine fired before its DriveClass::AI step and
      // consumed the first tick-72 RNG call that C++ gives to Area Guard
      // Random_Animate. Keep pre-movement firing to infantry only; non-infantry
      // combat runs after STAGE D below.
      if (entity.stats.isInfantry &&
          (!missionHandlerRan || runInfantryFiringAfterGuardDispatch) &&
          !skipFiringAIForMoveInfantry) {
        this._runMissionAI(ctx => _runFiringAI(ctx, entity));
      }

      // STAGE D: Movement_AI — per-tick movement advance for MOVE / HUNT /
      // AREA_GUARD (infantry), MOVE / GUARD drive-in (vehicles/vessels).
      // Skipped when STAGE B already ran a handler whose inline movement block
      // has already covered Movement_AI. Exceptions: under the refactored path,
      // infantry Mission_Move no longer moves inline because C++ runs
      // InfantryClass::AI's Commence gate before Movement_AI; and infantry
      // Mission_Move may have Commenced into GUARD after FootClass::Mission_Move
      // returned, where C++ still runs Movement_AI and clears stale NavCom.
      // Conversely, a handler may Commence into a NavCom-bearing movement
      // mission before Movement_AI (infantry.cpp:1208-1247), so the new mission
      // must be allowed to start/continue its driver in this same object AI.
      // Vehicle crew spawn hits this as GUARD -> HUNT.
      const runPostHandlerInfantryGuardMovement =
        missionHandlerRan &&
        entity.stats.isInfantry &&
        (entity.mission as Mission) === Mission.GUARD &&
        entity.moveTarget !== null;
      const runPostHandlerInfantryNavComAfterCommence =
        missionHandlerRan &&
        entity.stats.isInfantry &&
        missionBeforeStageB !== (entity.mission as Mission) &&
        entity.moveTarget !== null &&
        (
          (entity.mission as Mission) === Mission.MOVE ||
          (entity.mission as Mission) === Mission.HUNT ||
          (entity.mission as Mission) === Mission.RESCUE ||
          (entity.mission as Mission) === Mission.ATTACK ||
          (entity.mission as Mission) === Mission.AREA_GUARD
        );
      const runPostHandlerInfantryAttackNavCom =
        missionHandlerRan &&
        entity.stats.isInfantry &&
        missionBeforeStageB === Mission.ATTACK &&
        (entity.mission as Mission) === Mission.ATTACK &&
        entity.moveTarget !== null;
      const runPostHandlerInfantryHuntMovement =
        missionHandlerRan &&
        entity.stats.isInfantry &&
        (missionBeforeStageB === Mission.HUNT || missionBeforeStageB === Mission.RESCUE) &&
        ((entity.mission as Mission) === Mission.HUNT || (entity.mission as Mission) === Mission.RESCUE) &&
        (entity.moveTarget !== null || entity.pathIndex < entity.path.length || entity.isDriving);
      const runPostHandlerInfantryAreaGuardMovement =
        missionHandlerRan &&
        entity.stats.isInfantry &&
        missionBeforeStageB === Mission.AREA_GUARD &&
        (entity.mission as Mission) === Mission.AREA_GUARD &&
        (entity.moveTarget !== null || entity.pathIndex < entity.path.length || entity.isDriving);
      const runPostHandlerInfantryMoveMovement =
        missionHandlerRan &&
        entity.stats.isInfantry &&
        missionBeforeStageB === Mission.MOVE &&
        (entity.mission as Mission) === Mission.MOVE &&
        (entity.moveTarget !== null || entity.pathIndex < entity.path.length || entity.isDriving);
      const runPostHandlerHarvesterMovement =
        missionHandlerRan &&
        !entity.stats.isInfantry &&
        (entity.mission as Mission) === Mission.HARVEST &&
        entity.type === UnitType.V_HARV &&
        (entity.moveTarget !== null || entity.pathIndex < entity.path.length || entity.isDriving);
      const runPostHandlerDriveClassMove =
        missionHandlerRan &&
        !entity.stats.isInfantry &&
        !entity.isAirUnit &&
        (entity.mission as Mission) === Mission.MOVE;
      const driveClassEnterNeedsRotation =
        !entity.stats.isInfantry &&
        !entity.isAirUnit &&
        (entity.mission as Mission) === Mission.ENTER &&
        (entity.bodyFacing256 >= 0 ? (entity.bodyFacing256 & 0xff) : ((entity.facing * 32) & 0xff)) !==
          (entity.desiredFacing256 >= 0 ? (entity.desiredFacing256 & 0xff) : (((entity.desiredFacing ?? entity.facing) * 32) & 0xff));
      const runPostHandlerDriveClassEnter =
        missionHandlerRan &&
        !entity.stats.isInfantry &&
        !entity.isAirUnit &&
        (entity.mission as Mission) === Mission.ENTER &&
        (entity.moveTarget !== null || entity.pathIndex < entity.path.length || entity.isDriving || driveClassEnterNeedsRotation);
      const runPostHandlerDriveClassHunt =
        missionHandlerRan &&
        !entity.stats.isInfantry &&
        !entity.isAirUnit &&
        ((entity.mission as Mission) === Mission.HUNT ||
         (entity.mission as Mission) === Mission.RESCUE ||
         (entity.mission as Mission) === Mission.AREA_GUARD);
      if ((!missionHandlerRan || runPostHandlerInfantryGuardMovement || runPostHandlerInfantryNavComAfterCommence || runPostHandlerInfantryAttackNavCom || runPostHandlerInfantryHuntMovement || runPostHandlerInfantryAreaGuardMovement || runPostHandlerInfantryMoveMovement || runPostHandlerHarvesterMovement || runPostHandlerDriveClassMove || runPostHandlerDriveClassEnter || runPostHandlerDriveClassHunt) && !entity.isAirUnit) {
        if (entity.stats.isInfantry) {
          this.runInfantryMovementAI(entity);
        } else {
          this.runDriveClassAI(entity);
        }
      }

      // C++ UnitClass::AI/VesselClass::AI combat pass runs after DriveClass::AI.
      // This also runs when MissionClass::AI dispatched this tick; if the mission
      // handler already fired, attackCooldown/firePrep gates make this idempotent,
      // while target acquisition from Mission_Guard can still fire same-tick.
      if (!entity.stats.isInfantry && !entity.isAirUnit && entity.alive) {
        this._runMissionAI(ctx => _runFiringAI(ctx, entity));
      }

      // C++ Doing_AI + firing-anim countdown — unchanged from legacy flow.
      entity.doingAI();
      if (entity.isFiringAnim) {
        if (entity.firingAnimTicks > 0) entity.firingAnimTicks--;
        if (entity.firingAnimTicks <= 0) entity.isFiringAnim = false;
      }

      // STAGE E: Post-Movement_AI Commence (vehicles unit.cpp:472,
      // vessels :658). Infantry's main AI Commence runs above, before Firing_AI
      // and Movement_AI (infantry.cpp:1208-1247); infantry cell-arrival
      // Commence remains inside footPerCellProcess.
      if (!entity.stats.isInfantry && entity.missionQueue !== null &&
          !entity.firePrepActive && !entity.isFiringAnim && entity.nonInterruptAnimTicks <= 0 &&
          !(entity.isDriving && !entity.isAirUnit)) {
        const popFromA2 =
          entity.missionQueue === Mission.MOVE &&
          entity.mission === Mission.ATTACK &&
          entity.savedMoveTarget !== null;
        entity.mission = entity.missionQueue;
        entity.missionQueue = null;
        if (popFromA2) {
          entity.savedMoveTarget = null;
        } else {
          entity.missionTimer = 0;
        }
      }

      // C++ post-movement Commence does NOT re-enter MissionClass::AI in the
      // same tick. UnitClass::AI and VesselClass::AI call Commence() after
      // DriveClass::AI (unit.cpp:472, vessel.cpp:659), then continue with
      // non-mission systems only. MissionClass::AI will dispatch the newly
      // popped mission on the next object AI tick.

      this._updateEntityPostDispatch(entity, harvesterMissionClassRan ? false : missionTimerFired);
      this.decrementEntityCdTimersEndOfLogic(entity);
      return;
    }

    // ── Legacy flow (DISPATCH_ORDER_REFACTOR=false) ────────────────────────
    if (!entity.stats.isInfantry && !entity.isAirUnit &&
        entity.missionQueue !== null && !entity.isDriving &&
        !entity.firePrepActive && !entity.isFiringAnim && entity.nonInterruptAnimTicks <= 0) {
      entity.mission = entity.missionQueue;
      entity.missionQueue = null;
      entity.missionTimer = 0;
      missionTimerFired = true;
    }

    this.dispatchMission(entity, missionTimerFired);

    // C++ InfantryClass::Doing_AI — transition Doing state after mission processing.
    // Called once per tick. Transitions DO_NOTHING → DO_STAND_READY when idle.
    entity.doingAI();
    // C++ infantry.cpp:1190-1195 + 3657-3661: IsFiring is cleared when fire animation
    // frame sequence completes. firingAnimTicks counts down the animation duration
    // (~8 ticks for most infantry fire animations).
    if (entity.isFiringAnim) {
      if (entity.firingAnimTicks > 0) entity.firingAnimTicks--;
      if (entity.firingAnimTicks <= 0) entity.isFiringAnim = false;
    }

    // C++ infantry.cpp:1208-1211 — Commence gate (runs AFTER MissionClass::AI dispatch).
    // In C++, InfantryClass::AI calls Commence() after MissionClass::AI has already
    // processed the timer for this tick. So Timer=0 from Commence is picked up on the
    // NEXT tick's MissionClass::AI dispatch — the new mission handler fires 1 tick later.
    //
    // C++ UnitClass::AI (unit.cpp:404,472) additionally gates vehicle Commence by
    // `!IsDriving && Is_Door_Closed()`. The !IsDriving clause is essential for team
    // reinforcements: Coordinate_Move sets NavCom, DriveClass::AI flips IsDriving=true
    // same tick, so Commence stays gated and Mission remains GUARD (from reinf.cpp:480)
    // until the unit reaches a cell boundary. TS simulates IsDriving=true via team.ts
    // coordinateMove for parity — otherwise Mission_Move would fire 1 tick earlier
    // than WASM for reinforcement MCVs (SCG11EA drift).
    const blockCommenceDrive = !entity.stats.isInfantry && !entity.isAirUnit && entity.isDriving;
    if (entity.missionQueue !== null && !entity.firePrepActive && !entity.isFiringAnim && entity.nonInterruptAnimTicks <= 0 && !blockCommenceDrive) {
      // A2 restore: if popping back to MOVE from a TS-only ATTACK the A2 scan created
      // (signaled by savedMoveTarget != null), keep the current missionTimer instead of
      // resetting to 0. Without this, the unit's Mission_Move fires on the next tick and
      // consumes Random_Pick(0,2) one cycle earlier than WASM (which never entered ATTACK
      // because C++ has no per-tick A2 scan — only Target_Something_Nearby inside
      // Mission_Move itself). SCG06EA tick 40 fix.
      const popFromA2 =
        entity.missionQueue === Mission.MOVE &&
        entity.mission === Mission.ATTACK &&
        entity.savedMoveTarget !== null;
      entity.mission = entity.missionQueue;
      entity.missionQueue = null;
      if (popFromA2) {
        entity.savedMoveTarget = null;
        // Timer preserved from prior ATTACK — continues the C++-aligned countdown.
      } else {
        entity.missionTimer = 0; // picked up next tick by MissionClass::AI
      }
    }

    if (entity.stats.isInfantry) {
      this.runInfantryFearAI(entity, infantryDrivingAtLogicStart);
    }

    this._updateEntityPostDispatch(entity, missionTimerFired);
    this.decrementEntityCdTimersEndOfLogic(entity);
    return;
  }

  /** C++ CDTimerClass<FrameTimerClass> timers tick when Frame advances after
   *  object AI, not before mission/firing logic. Keep this scoped to core
   *  MissionClass/TechnoClass timers; other bespoke counters retain their
   *  existing timing until ported with direct C++ evidence. */
  private decrementEntityCdTimersEndOfLogic(entity: Entity): void {
    if (entity.idleAnimTimer > 0) entity.idleAnimTimer--;
    if (entity.missionTimer > 0) entity.missionTimer--;
    if (entity.attackCooldown > 0) entity.attackCooldown--;
    if (entity.attackCooldown2 > 0) entity.attackCooldown2--;
    if (entity.baseAttackTimer > 0) entity.baseAttackTimer--;
  }

  /** C++ infantry.cpp:3489-3532 InfantryClass::Fear_AI.
   *  Called from InfantryClass::AI after Commence() and before Firing_AI(). */
  private runInfantryFearAI(entity: Entity, drivingAtLogicStart = false): void {
    if (!entity.stats.isInfantry || entity.fear <= 0) return;

    entity.fear--;

    // C++ infantry.cpp:3502 — armed fraidy-cat civilians reload a fresh clip
    // when fear fully decays. This is inside the `Fear > 0` block after the
    // decrement, so it triggers on the tick fear reaches zero.
    if (entity.fear === 0 && entity.ammo === 0 && entity.weapon) {
      entity.ammo = entity.maxAmmo;
    }

    if (entity.isProne) {
      if (entity.fear < Entity.FEAR_ANXIOUS) {
        entity.isProne = false;
        entity.startGetUpDoing(this.tick);
      }
    } else if (
      entity.type !== UnitType.I_DOG &&
      entity.flightAltitude <= 0 &&
      entity.fear >= Entity.FEAR_ANXIOUS &&
      !entity.moveTarget &&
      !entity.isDriving &&
      !drivingAtLogicStart &&
      entity.navComClearedTick !== this.tick
    ) {
      entity.isProne = true;
      entity.startLieDownDoing(this.tick);
    }

    // C++ infantry.cpp:3529 — fraidy-cat infantry scatter even without a
    // concrete threat. This is not scenario-specific civilian flee logic;
    // it is InfantryClass::Fear_AI calling Scatter(0, true).
    if (entity.stats.isFraidyCat &&
        entity.fear > Entity.FEAR_ANXIOUS &&
        !entity.isFalling &&
        !entity.isDriving &&
        !entity.moveTarget) {
      this.infantryScatterNoThreat(entity);
    }
  }

  /** C++ InfantryClass::Scatter(0, true) — forced no-threat infantry scatter.
   *  Used by Fear_AI for fraidy-cat civilians. Forced scatter bypasses mission,
   *  target, and human-house voluntary-scatter gates, but still refuses to
   *  interrupt non-interruptible Doing animations. */
  private infantryScatterNoThreat(entity: Entity): void {
    if (!entity.isDoingInterruptible()) return;

    const fracX = entity.leptonX & 0xff;
    const fracY = entity.leptonY & 0xff;
    let toface = (fracX !== 0x80 || fracY !== 0x80)
      ? directionToLeptons(0x80, 0x80, fracX, fracY)
      : entity.facing;

    const savedSourceTag = ScenarioRandom._sourceTag;
    ScenarioRandom._sourceTag = 53003;
    toface = (toface + ScenarioRandom.nextInRange(0, 4) - 2 + DIR_DX.length) % DIR_DX.length;
    ScenarioRandom._sourceTag = savedSourceTag;

    const cx = entity.cell.cx;
    const cy = entity.cell.cy;
    for (let face = 0; face < DIR_DX.length; face++) {
      const dir = (toface + face) % DIR_DX.length;
      const ncx = cx + DIR_DX[dir];
      const ncy = cy + DIR_DY[dir];
      if (ncx < 0 || ncx >= MAP_CELLS || ncy < 0 || ncy >= MAP_CELLS) continue;
      if (this.infantryCanEnterCell(entity, ncx, ncy, dir) !== MoveResult.OK) continue;

      assignMission(entity, Mission.MOVE);
      entity.moveTarget = cellTargetToLepton(ncx, ncy);
      resetPathThreshold(entity);
      return;
    }
  }

  /**
   * Phase 1 refactor scaffold: extracted the current monolithic switch block
   * from `updateEntity` verbatim. When `DISPATCH_ORDER_REFACTOR` is `false`
   * this is the only entry point for mission handling and preserves behavior
   * byte-for-byte. When the flag flips `true`, STAGE A-F in `updateEntity`
   * will route selected paths through helpers (`runFiringAI`,
   * `runInfantryMovementAI`, `runDriveClassAI`) instead.
   *
   * C++ refs: MissionClass::AI (mission.cpp:213-321) dispatches per mission
   * when Timer==0; runs under the enclosing TechnoClass::AI call, so several
   * handlers here still need Firing_AI-equivalent side effects (see Mission.MOVE
   * and Mission.HUNT branches below — currently inlined, to be lifted in
   * Checkpoint 1.B).
   */
  private dispatchMission(entity: Entity, missionTimerFired: boolean): void {
    switch (entity.mission) {
      case Mission.NONE:
        // C++ MissionClass constructor state. The base MissionClass handler is
        // a no-op; InfantryClass::AI may Commence a queued order later in the
        // same object AI pass before Firing_AI/Movement_AI.
        break;
      case Mission.MOVE: {
        // C++ FootClass::Mission_Move evaluates its top-of-handler idle guard
        // before class-specific Movement_AI can clear NavCom later in the same
        // object tick. Preserve the entry state for the timer-return block below;
        // using post-updateMove state makes drive-class units enter GUARD one
        // Mission_Move cycle early.
        const missionMoveEntryHadNavCom = entity.moveTarget !== null;
        const missionMoveEntryWasDriving = entity.isDriving;
        const missionMoveEntryQueue = entity.missionQueue;

        // C++ FootClass::Mission_Move (foot.cpp:530-532):
        // when the timer fires and TarCom is empty, non-human/non-player,
        // non-suicide-team units scan with Target_Something_Nearby(THREAT_RANGE).
        // The scan only assigns TarCom; Firing_AI below decides whether the
        // unit can actually start firing.
        if (missionTimerFired &&
            !entity.target?.alive &&
            !this.isPlayerControlled(entity) &&
            !entity.teamRef?.isSuicide) {
          this._runMissionAI(ctx => _targetSomethingNearbyRange(ctx, entity));
        }

        // C++ InfantryClass::AI runs Firing_AI() BEFORE Movement_AI
        // (infantry.cpp:1237 → 1247). Movement_AI skips when IsFiring
        // (infantry.cpp:3790), so starting a fire animation interrupts
        // movement same-tick.
        //
        // TS parity: for infantry with a target in range, run updateAttack
        // BEFORE updateMove. updateMove still runs so its top Enter_Idle_Mode
        // guard can fire; its IsFiring gate then skips movement advance.
        //
        // SCG06EA tick 66: BadGuy E1 TarCom=Greek (set at tick 65 via team
        // retaliation — combat.ts triggerRetaliation teamRef branch). Tick 66
        // updateAttack starts firing animation (firePrepActive=true, stage=0);
        // movement is suppressed. FireLaunch=2 reached at tick 68 → Fire_At →
        // bullet[116] Coord_Scatter (tag 50002), matching WASM exactly.
        const runInlineInfantryMove =
          !(DISPATCH_ORDER_REFACTOR && entity.stats.isInfantry);

        if (runInlineInfantryMove && entity.stats.isInfantry && entity.target?.alive && entity.weapon
            && entity.attackCooldown <= 0 && entity.inRange(entity.target)) {
          // C++ InfantryClass::Can_Fire returns FIRE_MOVING when IsDriving
          // (infantry.cpp:1639). Do not clear IsDriving here; moving infantry
          // keep TarCom but wait until the driver stops before starting the
          // DO_FIRE_WEAPON animation.
          const savedMission = entity.mission;
          entity.mission = Mission.ATTACK;
          this.updateAttack(entity);
          if ((entity.mission as Mission) === Mission.ATTACK) {
            entity.mission = savedMission;
          }
        }
        // C++ order for infantry is Mission_Move() -> Commence() -> Firing_AI()
        // -> Movement_AI(). Movement_AI still runs after Firing_AI, even when
        // firing just started; its top NavCom guard can Enter_Idle_Mode before
        // the later IsFiring gate blocks actual movement (infantry.cpp:3786).
        // If a queued mission exists while the unit is not already driving,
        // starting a new driver here can set IsDriving before the Commence gate
        // and incorrectly block that queue pop. If IsDriving is already true,
        // C++ still advances the active Head_To_Coord hop while the queue waits.
        const deferInfantryMoveUntilAfterCommence =
          entity.stats.isInfantry && entity.missionQueue !== null && !entity.isDriving;
        // C++ FootClass::Mission_Move only returns a timer delay / idle state.
        // Actual movement runs later in class-specific AI: InfantryClass::
        // Movement_AI or Unit/Vessel DriveClass::AI. Keep this inline movement
        // for infantry only in the legacy flow; the refactored STAGE A-F flow
        // must leave Movement_AI until after InfantryClass::AI's Commence gate.
        if (runInlineInfantryMove && entity.stats.isInfantry && !deferInfantryMoveUntilAfterCommence) {
          this.updateMove(entity);
        }
        const moveCommencedDuringMovement =
          runInlineInfantryMove &&
          entity.stats.isInfantry &&
          (entity.mission as Mission) !== Mission.MOVE &&
          entity.missionTimer === 0;
        // C++ foot.cpp:492-505: Mission_Move timer return
        if (missionTimerFired) {
          // Mission_Move internal path-failure short-circuit — residual port
          // of the C++ InfantryClass::Movement_AI Basic_Path chain. See
          // perCellProcess.ts:MISSION_MOVE_PATH_FAILURE for the full docstring
          // + C++ refs. Fires ONE tick earlier than the all-retries-exhausted
          // path in updateMove: when the timer fires, path is non-empty, but
          // the next cell is blocked AND a one-shot findPath refresh also
          // fails. Queues GUARD (or AREA_GUARD when guardOrigin is set) with
          // no RNG consumed, matching WASM's Enter_Idle_Mode via Mission_Move.
          let pathFailureHandled = false;
          if (MISSION_MOVE_PATH_FAILURE &&
              entity.stats.isInfantry &&
              entity.moveTarget &&
              entity.missionQueue === null &&
              entity.path.length > 0 && entity.pathIndex < entity.path.length) {
            const nextCell = entity.path[entity.pathIndex];
            const nextPassable = entity.isNavalUnit
              ? this.map.isWaterPassable(nextCell.cx, nextCell.cy)
              : this.map.isTerrainPassable(nextCell.cx, nextCell.cy);
            // Occupancy: blocked if non-self and not friendly-pushable, and
            // infantry sub-cell is full (infantry share cells when possible).
            const occId = this.map.getOccupancy(nextCell.cx, nextCell.cy);
            const infCanEnter = entity.stats.isInfantry &&
              this.map.hasAvailableSubCell(nextCell.cx, nextCell.cy);
            let occBlocked = false;
            if (occId > 0 && occId !== entity.id && !infCanEnter) {
              const blocker = this.entityById.get(occId);
              if (blocker?.alive && !this.entitiesAllied(entity, blocker)) {
                occBlocked = true;
              } else if (!blocker?.alive) {
                occBlocked = true;
              }
            }
            if (!nextPassable || occBlocked) {
              // One-shot Basic_Path refresh. C++ foot.cpp:313-500 Basic_Path
              // returns false when no path exists. We emulate by asking findPath
              // and short-circuiting when empty.
              const dest = {
                cx: Math.floor(entity.moveTarget.lx / 256),
                cy: Math.floor(entity.moveTarget.ly / 256),
              };
              const freshPath = findPath(
                this.map, entity.cell, dest, true,
                entity.isNavalUnit, entity.stats.speedClass
              );
              if (freshPath.length === 0) {
                // Enter_Idle_Mode equivalent — mirrors footPerCellProcess's
                // Enter_Idle_Mode sub-case (perCellProcess.ts:641-656).
                entity.moveTarget = null;
                this.clearDrivePath(entity);
                entity.isDriving = false;
                // Queue the class-specific idle mission. The post-dispatch
                // Commence block (index.ts:~4381) pops this same tick for
                // infantry, matching WASM Enter_Idle_Mode.
                entity.missionQueue = this.idleMission(entity);
                entity.missionTimer = 0;
                entity.animState = AnimState.IDLE;
                pathFailureHandled = true;
              }
            }
          }
          // C++ foot.cpp:496-498: if no NavCom, not driving, no queued mission →
          // Enter_Idle_Mode() transitions to GUARD (unit.cpp:1291-1358).
          // Returns 1 (no RNG consumed) — the GUARD timer fires on the next tick.
          if (pathFailureHandled) {
            // No RNG consumed — Mission_Move returns 1 when Enter_Idle_Mode
            // path taken (foot.cpp:526). Commence popup handles the mission
            // transition at the post-dispatch block.
          } else if (!moveCommencedDuringMovement &&
                     !missionMoveEntryHadNavCom &&
                     !missionMoveEntryWasDriving &&
                     missionMoveEntryQueue === null) {
            entity.mission = this.enterIdleMode(entity);
            entity.missionTimer = 0; // fires immediately in GUARD handler
          } else {
            // C++ foot.cpp:504: Normal path — Normal_Delay + Random_Pick(0,2)
            const delay = 14 + ScenarioRandom.nextInRange(0, 2);
            // C++ Mission_Move returns this delay before InfantryClass::AI's
            // later Commence() can pop MissionQueue and reset Timer=0. TS may
            // perform the per-cell Commence inside updateMove, so preserve
            // that reset while still consuming Mission_Move's RNG.
            if (!moveCommencedDuringMovement) {
              entity.missionTimer = delay;
            }
          }
        }
        break;
      }
      case Mission.ATTACK:
        if (DISPATCH_ORDER_REFACTOR && entity.stats.isInfantry) {
          // C++ InfantryClass::AI order is MissionClass::AI -> Commence ->
          // Firing_AI -> Movement_AI (infantry.cpp:1208-1247). The
          // Mission_Attack handler itself is FootClass::Mission_Attack
          // (foot.cpp:604-619): it only Approach_Target()s or Enter_Idle_Mode()
          // and returns Normal_Delay + Random_Pick(0,2). It does not fire.
          //
          // Running updateAttack() here starts DO_FIRE_WEAPON before Commence,
          // which blocks a queued MOVE from being popped. SCG06EA logic[67]
          // then stays ATTACK+mq=MOVE instead of the C++ MOVE+mq=ATTACK chain.
          if (missionTimerFired) {
            if (entity.target?.alive || entity.targetStructure?.alive || entity.forceFirePos) {
              if (this.shouldMissionAttackApproach(entity)) {
                this.approachTarget(entity);
              }
            } else {
              assignMission(entity, this.infantryEnterIdleMission(entity));
            }
          }
        } else {
          if (missionTimerFired && this.shouldMissionAttackApproach(entity)) {
            this.approachTarget(entity);
          }
          this.updateAttack(entity);
        }
        // C++ infantry.cpp:1237-1247 runs Firing_AI() and then Movement_AI()
        // for every infantry mission, including MISSION_ATTACK. updateAttack()
        // maps to Firing_AI. If Can_Fire returns FIRE_MOVING while IsDriving,
        // no fire animation starts, and Movement_AI must continue the active
        // Head_To_Coord hop. Without this, attacking infantry can remain frozen
        // mid-hop in TS while C++ finishes the sub-cell move, goes prone, and
        // fires on schedule (SCG06EA tick-100 bullet[121]).
        if (!DISPATCH_ORDER_REFACTOR && entity.stats.isInfantry && !entity.firePrepActive) {
          this._infantryWalkStep(entity);
        }
        // C++ foot.cpp:570: Mission_Attack returns Normal_Delay+Random_Pick(0,2)
        if (missionTimerFired) {
          const delay = 14 + ScenarioRandom.nextInRange(0, 2);
          // Commence() runs after Mission_Attack and resets Timer=0 if it pops
          // a queued mission. Do not pop here; InfantryClass::AI's normal
          // !IsDriving/!IsFiring/Doing gate owns that transition.
          entity.missionTimer = delay;
        }
        break;
      case Mission.HUNT:
        // C++ DriveClass::AI / MissionClass::AI runs Mission_Hunt when the
        // mission timer fires, even if TarCom is already in range. The
        // class-specific Combat_AI/Firing_AI runs after that, while Mission
        // remains HUNT for ordinary armed units (foot.cpp:717-772).
        if (missionTimerFired) {
          this.updateHunt(entity);
          // C++ foot.cpp:761: Mission_Hunt calls Approach_Target after
          // Target_Something_Nearby finds a normal target.
          if (entity.target?.alive && !entity.inRange(entity.target) && !entity.moveTarget) {
            this.approachTarget(entity);
          }
          // C++ foot.cpp:768-771: Normal_Delay + Random_Pick(0,2)
          // before class Combat_AI/Firing_AI can fire this tick.
          entity.missionTimer = 14 + ScenarioRandom.nextInRange(0, 2);
        }

        const infantryClassAIHandlesFireMove =
          DISPATCH_ORDER_REFACTOR && entity.stats.isInfantry;
        if (!infantryClassAIHandlesFireMove) {
          // C++ InfantryClass::AI runs Firing_AI before Movement_AI. Under the
          // refactored STAGE flow those phases run after Commence; legacy flow
          // keeps the old inline behavior here.
          if (entity.stats.isInfantry && entity.targetStructure?.alive && entity.weapon) {
            this.updateAttack(entity);
            if ((entity.mission as Mission) === Mission.ATTACK) entity.mission = Mission.HUNT;
          } else if (entity.stats.isInfantry && entity.target?.alive && entity.weapon && entity.attackCooldown <= 0 && entity.inRange(entity.target)) {
            this.updateAttack(entity);
            if ((entity.mission as Mission) === Mission.ATTACK) entity.mission = Mission.HUNT;
          } else if (entity.target?.alive && !entity.inRange(entity.target)) {
            // C++ foot.cpp:856-946 Approach_Target: assign NavCom to a cell within
            // weapon range of target. Only assigns when NavCom is empty (!Target_Legal).
            if (!entity.moveTarget) {
              this.approachTarget(entity);
            }
          }
          if (entity.stats.isInfantry) {
            // C++ InfantryClass::AI always reaches Movement_AI after Mission_Hunt
            // dispatch (infantry.cpp:1237-1247). Movement_AI is gated by legal
            // NavCom/IsDriving, not by live TarCom. This matters for vehicle crew:
            // UnitClass death calls Scatter() (Assign_Destination), then switches
            // the survivor to HUNT; the survivor must Start_Driver in the same
            // Logic pass even when Mission_Hunt found no target.
            this._infantryWalkStep(entity);
          }
        }
        break;
      case Mission.GUARD:
      case Mission.STICKY:
        // C++ foot.cpp:589-634: Mission_Guard runs when Timer==0.
        // Firing_AI and cooldown run every tick (inside updateGuard).
        // Pass missionTimerFired so updateGuard only scans when timer fires.
        //
        // C++ tests Arm before the final jitter return (foot.cpp:683), but the
        // TS explicit timer fields store the previous end-of-frame visible value.
        // After this method's start-of-object cooldown decrement, `attackCooldown`
        // matches C++'s current CDTimer Value(). Reading the pre-decrement value
        // here makes non-moving-fire units take a stale Arm-return path one tick
        // too long (SCG03EA ARTY at tick 304).
        { const armBeforeScan = entity.attackCooldown;
        const queuedHarvestFromGuard =
          missionTimerFired &&
          entity.mission === Mission.GUARD &&
          this.aiHarvesterShouldEnterHarvest(entity);
        if (queuedHarvestFromGuard) {
          // C++ UnitClass::Mission_Guard (unit.cpp:3638-3645):
          // AI harvesters with a refinery queue MISSION_HARVEST and return 1.
          // UnitClass::AI's post-DriveClass Commence then pops the queue later
          // in this same object tick without a Guard jitter RNG call.
          entity.missionQueue = Mission.HARVEST;
          entity.missionTimer = 1;
        } else {
          this.updateGuard(entity, missionTimerFired);
          if (missionTimerFired) {
          // C++ MissionClass::AI stores Mission_Guard's return delay before
          // UnitClass::AI enters DriveClass::AI. A same-tick PCP_END Commence
          // during movement can then pop MissionQueue and reset Timer=0.
          // C++ foot.cpp:597-634: dtime = MissionControl[Mission].Normal_Delay()
          // C++ uses the MISSION-SPECIFIC rate, not entity-type rate.
          //
          // Vessel override (foot.cpp:646-655):
          //   DD/PT -> AA_Delay; CA -> Normal_Delay * 2.
          // Infantry override (foot.cpp:668-672):
          //   E1/E3 -> AA_Delay.
          // STICKY mission (rules.ini [Sticky] Rate=.016) has Normal_Delay=14 for ALL infantry.
          // rules.ini [Guard] Rate=.050, AARate=.016
          //   Guard Normal_Delay: fixed(".050")->Raw=12. ((12*900)+128)/256=42
          //   Guard AA_Delay:     fixed(".016")->Raw=4.  ((4*900)+128)/256=14
          // rules.ini [Sticky] Rate=.016 -> Normal_Delay=14 for all entities
          let guardDelay: number;
          if (entity.mission === Mission.STICKY) {
            // Sticky mission: Rate=.016 -> Normal_Delay=14 for all entity types
            guardDelay = 14;
          } else if (entity.isNavalUnit) {
            if (entity.type === UnitType.V_DD || entity.type === UnitType.V_PT) {
              guardDelay = 14;
            } else if (entity.type === UnitType.V_CA) {
              guardDelay = 84;
            } else {
              guardDelay = 42;
            }
          } else {
            // Guard mission: E1/E3 use AA_Delay=14, others use Normal_Delay=42
            const isInfAA = entity.stats.isInfantry &&
              (entity.type === UnitType.I_E1 || entity.type === UnitType.I_E3);
            guardDelay = isInfAA ? 14 : 42;
          }
          if (armBeforeScan > 0) {
            entity.missionTimer = armBeforeScan;
          } else {
            const savedTag = ScenarioRandom._sourceTag;
            if (ScenarioRandom._tagLogging) {
              ScenarioRandom._sourceTag = entity.stats.isInfantry &&
                (entity.type === UnitType.I_E1 || entity.type === UnitType.I_E3)
                ? 60043
                : 60040;
            }
            entity.missionTimer = guardDelay + ScenarioRandom.nextInRange(0, 2);
            if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = savedTag;
          }
          }
        }
        // C++ UnitClass::AI calls DriveClass::AI after MissionClass::AI even when
        // Mission_Guard just fired. This matters for non-moving rotation too:
        // drive.cpp:1359 rotates PrimaryFacing before considering NavCom/path.
        // SCG11EA t15 4TNK enters GUARD and still snaps body facing 68→64.
        if (!entity.stats.isInfantry && !entity.isAirUnit) {
          if (entity.trackNumber <= 0) {
            if (entity.bodyFacing256 < 0) entity.bodyFacing256 = (entity.facing * 32) & 0xff;
            const desiredFacing256 = entity.desiredFacing256 >= 0
              ? (entity.desiredFacing256 & 0xff)
              : ((entity.desiredFacing * 32) & 0xff);
            if (entity.type === UnitType.V_MCV && entity.mcvIsDeploying) {
              this._runPlacement(ctx => _advanceMCVDeployRotation(ctx, entity));
            } else if (entity.bodyFacing256 !== desiredFacing256) {
              entity.tickRotation();
            } else if (this.hasActiveDriveSegment(entity)) {
              this.updateMove(entity, /*fromGuardDrive=*/ true);
            }
          } else if (this.hasActiveDriveSegment(entity)) {
            this.updateMove(entity, /*fromGuardDrive=*/ true);
          }
        }
        // Step 8 cleanup: removed the `!missionTimerFired` same-tick Mission_Move
        // dispatch block. Under DISPATCH_ORDER_REFACTOR=true (current), all
        // dispatchMission callers pass missionTimerFired=true, making the
        // `!missionTimerFired` gate unreachable. The same-tick post-Commence
        // dispatch is handled uniformly by STAGE F at updateEntity line 4186.
        } // close armBeforeScan block
        break;
      case Mission.AREA_GUARD:
        this.updateAreaGuard(entity, missionTimerFired);
        // C++ foot.cpp:1036-1037: target-found path returns 1 (no RNG). updateAreaGuard
        // sets missionTimer=1 directly when it finds a target, so only default the
        // timer here if it's still 0 (no target found → full scan delay with RNG jitter).
        if (missionTimerFired && entity.missionTimer <= 0) {
          // C++ foot.cpp:1016-1020: dtime = MissionControl[Mission].Normal_Delay() + Random_Pick(1, 5)
          // rules.ini [Area Guard] Rate=.080. fixed(".080")→Raw=20. Normal_Delay=((20*900)+128)/256=70
          const savedTag = ScenarioRandom._sourceTag;
          ScenarioRandom._sourceTag = 30000;
          const jitter = ScenarioRandom.nextInRange(1, 5);
          ScenarioRandom._sourceTag = savedTag;
          entity.missionTimer = 70 + jitter;
        }
        if (DISPATCH_ORDER_REFACTOR) {
          break;
        }
        // C++ Movement_AI (infantry.cpp:3765) runs every tick for all missions with NavCom.
        // Mission_Guard_Area -> Approach_Target sets NavCom (moveTarget); the unit then walks
        // along its path until Movement_AI clears/stops it. Continuing a stored path is gated
        // by legal NavCom/path, not by live TarCom: TarCom may die while NavCom remains valid.
        // Mirror HUNT's Start_Driver -> Coord_Move -> Stop_Driver state machine (above in
        // Mission.HUNT case ~line 4094).
        // SCG06EA tick 76: USSR E1[24] @(24,67) with target Greek E1 @(20,64) —
        // movement closes the gap until bullet[115] Bullet_Explodes RNG fires.
        const hasPendingAreaGuardPath =
          entity.moveTarget !== null && entity.path.length > 0 && entity.pathIndex < entity.path.length;
        if ((entity.target?.alive && !entity.inRange(entity.target) && entity.moveTarget) || hasPendingAreaGuardPath) {
          if (!entity.isDriving) {
            if (entity.stats.isInfantry && entity.path.length > 0 && entity.pathIndex < entity.path.length) {
              this.infantryValidatePath(entity);
            }
            if (entity.stats.isInfantry && entity.path.length > 0 && entity.pathIndex < entity.path.length) {
              const destCell = entity.path[entity.pathIndex];
              const started = this.infantryStartDriver(entity, destCell.cx, destCell.cy);
              if (!started) return;
            }
            entity.isDriving = true;
          } else {
            if (entity.path.length > 0 && entity.pathIndex < entity.path.length) {
              const wp = entity.headToLX > 0
                ? { lx: entity.headToLX, ly: entity.headToLY }
                : { lx: entity.path[entity.pathIndex].cx * 256 + 128, ly: entity.path[entity.pathIndex].cy * 256 + 128 };
              if (entity.moveToward(wp, this.movementSpeed(entity))) {
                entity.pathIndex++;
                this.stopInfantryDriver(entity);
                // PCP Session 2.2: infantry cell-arrival Per_Cell_Process(PCP_END).
                // Mirrors C++ infantry.cpp:3997. AREA_GUARD analog of the HUNT site
                // above. TarCom is likely clear here (Mission_Guard_Area scans and
                // sets TarCom only when a target is in sight), so Enter_Idle_Mode
                // may queue MISSION_GUARD_AREA on the final cell-arrival if no
                // enemies remain in sight. Session 3.1: path-shorten sub-case fires
                // when target enters range mid-patrol (SCG06 tick 76 load-bearing).
                if (FOOT_PER_CELL_ENABLED && entity.stats.isInfantry) {
                  this.cutInfantryTransportTether(entity);
                  const liveTar = !!(entity.target?.alive) || entity.targetStructure != null;
                  const inRangeNow = !!(entity.target?.alive) && entity.inRangeOfLikelyCoord(entity.target);
                  footPerCellProcess(
                    entity as unknown as Parameters<typeof footPerCellProcess<Mission>>[0],
                    PCPType.PCP_END,
                    {
                      hasLegalTarCom: liveTar,
                      inRadioContact: false,
                      pathShortenEligible: true, // Mission.AREA_GUARD ∈ attack-type
                      targetInRange: inRangeNow,
                    },
                    {
                      guardMission: Mission.GUARD,
                      areaGuardMission: Mission.AREA_GUARD,
                      attackMission: Mission.ATTACK,
                      huntMission: Mission.HUNT,
                      rescueMission: Mission.RESCUE,
                    }
                  );
                }
              }
            } else if (entity.moveTarget && entity.moveToward(entity.moveTarget, this.movementSpeed(entity))) {
              entity.moveTarget = null;
              this.clearDrivePath(entity);
            }
          }
        }
        break;
      case Mission.SLEEP:
        // Dormant — do nothing until explicitly given a new mission
        entity.animState = AnimState.IDLE;
        break;
      // AI1: New C++ parity missions
      case Mission.ENTER:
        // C++ foot.cpp:1746-1789 — Mission_Enter performs docking radio
        // coordination, then always returns Normal_Delay+Random_Pick(0,2).
        // For harvesters, the refinery docking reply assigns NavCom; preserve
        // that path instead of treating FINDHOME/HEADINGHOME as a raw MOVE.
        if (entity.type === UnitType.V_HARV) {
          this._runHarvester(ctx => _updateHarvester(ctx, entity, true));
        } else {
          // Entering transport — handled by transport loading code (updateMove with transport target)
          this.updateMove(entity);
        }
        if (missionTimerFired) {
          const savedTag = ScenarioRandom._sourceTag;
          if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = 60060;
          const enterDelay = 14 + ScenarioRandom.nextInRange(0, 2);
          if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = savedTag;
          // C++ FootClass::Mission_Enter always consumes the return-delay
          // jitter, even if RADIO_DOCKING/IM_IN changed Mission to UNLOAD
          // during the handler. Assign_Mission(UNLOAD) leaves the new timer
          // at 0, so apply the delay only when still in ENTER.
          if (entity.mission === Mission.ENTER) entity.missionTimer = enterDelay;
        }
        break;
      case Mission.CAPTURE:
        // Engineer capture — handled by updateAttack with targetStructure
        this.updateAttack(entity);
        break;
      case Mission.HARVEST:
        entity.animState = AnimState.IDLE;
        if (missionTimerFired) {
          if (entity.type === UnitType.V_HARV) {
            const stateBefore = entity.harvesterState;
            const wasFullLooking = stateBefore === 'idle' && entity.oreLoad >= Entity.BAIL_COUNT;
            // C++ UnitClass::Mission_Harvest runs before DriveClass::AI. When
            // LOOKING assigns NavCom, DriveClass can rotate/start the driver in
            // this same object AI tick. `_updateEntityPostDispatch` still runs a
            // non-timer harvester pass after movement for arrival bookkeeping.
            this._runHarvester(ctx => _updateHarvester(ctx, entity, true));
            if (stateBefore === 'harvesting' || stateBefore === 'headinghome' || wasFullLooking) {
              entity.missionTimer = 1;
            } else {
              // C++ unit.cpp:2922 — fallthrough path: Normal_Delay+Random_Pick(0,2)
              entity.missionTimer = 14 + ScenarioRandom.nextInRange(0, 2);
            }
          } else {
            // C++ unit.cpp:2922 — fallthrough path: Normal_Delay+Random_Pick(0,2)
            entity.missionTimer = 14 + ScenarioRandom.nextInRange(0, 2);
          }
        }
        break;
      case Mission.UNLOAD:
        if (entity.type === UnitType.V_MCV) {
          entity.animState = AnimState.IDLE;
          if (missionTimerFired) {
            entity.missionTimer = this._runPlacement(ctx => _updateMCVUnloadMission(ctx, entity));
          }
          break;
        }
        if (entity.type === UnitType.V_MNLY) {
          this.updateMinelayer(entity);
          if (missionTimerFired && entity.mission === Mission.UNLOAD) {
            entity.missionTimer = 1;
          }
          break;
        }
        if (entity.isNavalUnit) {
          // C++ vessel.cpp:1688-1830 — VesselClass::Mission_Unload has a
          // status machine before cargo is detached. Once in UNLOADING it
          // detaches one cargo object per dispatch and returns Normal_Delay()
          // with NO jitter.
          entity.animState = AnimState.IDLE;
          if (missionTimerFired) {
            entity.missionTimer = this.updateVesselUnloadMission(entity);
          }
          break;
        }
        // C++ unit.cpp:2726 / aircraft.cpp:1215 — non-vessel Mission_Unload
        // falls through to Normal_Delay+Random_Pick(0,2).
        entity.animState = AnimState.IDLE;
        if (missionTimerFired) {
          entity.missionTimer = 14 + ScenarioRandom.nextInRange(0, 2);
        }
        break;
      case Mission.RETREAT:
        // Move to nearest map edge and exit the map
        this.updateRetreat(entity);
        break;
      case Mission.AMBUSH:
        // Sleep until enemy enters sight range, then switch to HUNT
        this.updateAmbush(entity);
        break;
      // Mission.STICKY handled above with Mission.GUARD (line 3540)
      case Mission.REPAIR:
        // Seek nearest FIX structure and move to it
        this.updateRepairMission(entity);
        break;
      case Mission.STOP:
        // Hold position — do nothing
        entity.animState = AnimState.IDLE;
        break;
      case Mission.HARMLESS:
        // Like guard but never attacks
        entity.animState = AnimState.IDLE;
        break;
      case Mission.QMOVE:
        // Queued move — same as MOVE (C++ foot.cpp:339)
        this.updateMove(entity);
        break;
      case Mission.RETURN:
        // Return to base (aircraft rearm) — already handled by aircraft state machine
        entity.animState = AnimState.IDLE;
        break;
      case Mission.RESCUE:
        // Same as HUNT (C++ rescue mission acts as hunt)
        this.updateHunt(entity);
        break;
      case Mission.MISSILE:
      case Mission.SABOTAGE:
      case Mission.CONSTRUCTION:
      case Mission.DECONSTRUCTION:
        // Stub missions — handled by specific subsystems
        entity.animState = AnimState.IDLE;
        break;
    }
  }

  /**
   * Phase 1 Checkpoint 1.C — Infantry Movement_AI extraction stub.
   *
   * Mirrors C++ `InfantryClass::Movement_AI` (infantry.cpp:3765-4060). Runs
   * every tick for infantry when isDriving is set or moveTarget is present:
   *   - `!IsDriving + NavCom legal` → Start_Driver (validate path, pick sub-cell)
   *   - `IsDriving + path` → Coord_Move toward HeadToCoord; on arrival, Stop_Driver
   *     + PCP_END (which may Enter_Idle_Mode or path-shorten to engage TarCom)
   *
   * Not yet called — STAGE D of updateEntity will invoke this once
   * DISPATCH_ORDER_REFACTOR flips on. The Mission.HUNT and Mission.AREA_GUARD
   * cases in `dispatchMission` currently inline this exact logic under their
   * "target in range / out of range" branches; STAGE D will route through here
   * instead.
   *
   * ## C++ refs
   *   infantry.cpp:3765    InfantryClass::Movement_AI top
   *   infantry.cpp:3790    IsFiring gate (skips movement)
   *   infantry.cpp:3810    Basic_Path validate / re-path on next cell blocked
   *   infantry.cpp:3997    PCP_END call at cell-arrival
   */
  private runInfantryMovementAI(entity: Entity): void {
    // Per-tick infantry Movement_AI — dispatched from STAGE D when
    // DISPATCH_ORDER_REFACTOR=true. Mirrors the per-tick walk loops currently
    // inlined in `dispatchMission`'s Mission.MOVE / Mission.HUNT /
    // Mission.AREA_GUARD branches. Runs only on ticks STAGE B did NOT run a
    // handler (otherwise the inline code there already moved this tick).
    //
    // ## C++ refs
    //   infantry.cpp:3765-4060  InfantryClass::Movement_AI
    //   infantry.cpp:3790       IsFiring gate (skips movement)
    //   infantry.cpp:3997       PCP_END at cell-arrival
    if (!entity.stats.isInfantry) return;
    const m = entity.mission as Mission;

    if (m === Mission.MOVE) {
      // Mission.MOVE infantry: Firing_AI-before-Movement_AI (infantry.cpp:1237)
      // + updateMove. Lifted verbatim from dispatchMission's Mission.MOVE
      // inline block. C++ InfantryClass::Can_Fire still rejects IsDriving via
      // FIRE_MOVING; targets acquired by Mission_Move are retained but cannot
      // start DO_FIRE_WEAPON until the driver stops.
      if (entity.target?.alive && entity.weapon
          && entity.attackCooldown <= 0 && entity.inRange(entity.target)) {
        const savedMission = entity.mission;
        entity.mission = Mission.ATTACK;
        this.updateAttack(entity);
        if ((entity.mission as Mission) === Mission.ATTACK) {
          entity.mission = savedMission;
        }
      }
      this.updateMove(entity);
      return;
    }

    if (m === Mission.ATTACK || m === Mission.HUNT || m === Mission.RESCUE) {
      // ATTACK/HUNT per-tick walk loop. C++ InfantryClass::AI always runs
      // Movement_AI after Firing_AI (infantry.cpp:1237-1247), including while
      // Mission==ATTACK. When Can_Fire returns FIRE_MOVING, no fire animation
      // starts and the active Head_To_Coord hop must continue.
      // It does NOT call FootClass::Approach_Target between mission timer
      // fires. C++ Approach_Target is invoked by the Mission_Attack/Hunt/Rescue
      // handler when MissionClass::AI dispatches (foot.cpp:571, 761); the
      // movement pass only consumes an already-legal NavCom/path. Re-approaching
      // here starts fresh HUNT hops early (SCG07EA England E1 852020 at t207).
      this._infantryWalkStep(entity);
      return;
    }

    if (m === Mission.AREA_GUARD) {
      // AREA_GUARD per-tick walk loop (lifted from dispatchMission).
      // Firing_AI in-range case handled by STAGE C; walk advances path.
      this._infantryWalkStep(entity);
      return;
    }

    if (m === Mission.GUARD) {
      // C++ infantry.cpp:3796-3798 — once a queued GUARD has Commenced, a
      // non-driving infantry unit must drop any leftover NavCom. This runs in
      // Movement_AI after Commence, not inside FootClass::Mission_Move.
      if (!entity.isDriving && entity.missionQueue === null && entity.moveTarget) {
        entity.moveTarget = null;
        entity.pathThreshold = 1; // C++ Assign_Destination(TARGET_NONE)
      }
      return;
    }
  }

  /**
   * Shared per-tick infantry walk-step. Mirrors the Start_Driver / Coord_Move /
   * Stop_Driver / PCP_END chain from dispatchMission's Mission.HUNT and
   * Mission.AREA_GUARD inline blocks. Used by `runInfantryMovementAI` under
   * STAGE D when DISPATCH_ORDER_REFACTOR=true.
   *
   * C++ ref: infantry.cpp:3812 (Start_Driver) + 3997 (PCP_END).
   */
  private _infantryWalkStep(entity: Entity): void {
    // C++ InfantryClass::Movement_AI runs after Firing_AI every tick
    // (infantry.cpp:1237-1247). Once Start_Driver has set IsDriving and
    // Head_To_Coord, the IsDriving branch continues Coord_Move until that
    // sub-cell hop completes, even if the target has since entered weapon
    // range. A non-driving infantryman with a legal NavCom and pending path
    // also starts the next hop even if TarCom has since died; Movement_AI's
    // driver gate is NavCom/path legality, not live-target state.
    //
    // C++ infantry.cpp:3798 gates the whole movement body on !IsFiring.
    // The extracted ATTACK/HUNT/AREA_GUARD walk path must honor the same gate;
    // otherwise an infantryman can start a new Head_To_Coord hop while its fire
    // animation is still active.
    if (entity.firePrepActive || entity.isFiringAnim) return;

    if (entity.isDriving && (entity.headToLX <= 0 || entity.headToLY <= 0)) {
      // C++ never has IsDriving without a live Head_To_Coord: Start_Driver sets
      // both, and Stop_Driver clears both. Older TS inline AREA_GUARD movement
      // could leave exactly that half-started state; normalize it back to the
      // !IsDriving Movement_AI branch so Basic_Path/Start_Driver owns the next
      // hop instead of falling into a direct NavCom walk.
      this.stopInfantryDriver(entity);
    }

    const hasActiveHeadTo =
      entity.isDriving && entity.headToLX > 0 && entity.headToLY > 0;
    const hasPendingNavComPath =
      entity.moveTarget !== null && entity.path.length > 0 && entity.pathIndex < entity.path.length;
    const hasLegalNavCom =
      entity.moveTarget !== null;
    if (!hasActiveHeadTo &&
        !hasPendingNavComPath &&
        !hasLegalNavCom &&
        !(entity.target?.alive && !entity.inRange(entity.target) && entity.moveTarget)) {
      return;
    }
    if (!entity.isDriving) {
      if (entity.stats.isInfantry && entity.moveTarget) {
        this.skipInfantryPathCurrentCell(entity);
        this.shortenInfantryPathToNavComDistance(entity);
      }

      // C++ !IsDriving branch: Start_Driver (infantry only — vehicles use
      // track-based movement). Mirrors dispatchMission's HUNT block where the
      // validatePath / startDriver calls are gated on `entity.stats.isInfantry`.
      if (entity.stats.isInfantry &&
          entity.moveTarget !== null &&
          (entity.path.length === 0 || entity.pathIndex >= entity.path.length)) {
        // C++ InfantryClass::Movement_AI (infantry.cpp:3826-3864): any legal
        // NavCom with Mission != GUARD runs Basic_Path/Start_Driver, even when
        // TarCom is empty. Vehicle-crew Scatter() creates exactly that state:
        // NavCom from Assign_Destination(::As_Target(newcell)), then HUNT queued.
        if (entity.pathDelay > 0) return;
        const goal = {
          cx: Math.floor(entity.moveTarget.lx / LEPTON_SIZE),
          cy: Math.floor(entity.moveTarget.ly / LEPTON_SIZE),
        };
        const pathGoal = this.resolveInfantryBasicPathGoal(entity, goal);
        const newPath = this.findDriveClassBasicPath(entity, pathGoal);
        entity.pathDelay = PATH_DELAY_TICKS;
        if (newPath.length > 0) {
          this.setInfantryBasicPath(entity, newPath);
          entity.pathThreshold = MOVE_CLOAK;
          entity.tryCount = PATH_RETRY;
        } else {
          const closeEnough = 704; // rules.ini [General] CloseEnough=2.75 * 256
          if (leptonDist(entity.leptonX, entity.leptonY, entity.moveTarget.lx, entity.moveTarget.ly) < closeEnough) {
            entity.moveTarget = null;
          } else if (entity.tryCount > 0) {
            entity.tryCount--;
          }
          entity.isDriving = false;
          entity.headToLX = 0;
          entity.headToLY = 0;
          return;
        }
      }
      if (entity.stats.isInfantry && entity.path.length > 0 && entity.pathIndex < entity.path.length) {
        this.skipInfantryPathCurrentCell(entity);
      }
      if (entity.stats.isInfantry && entity.path.length > 0 && entity.pathIndex < entity.path.length) {
        this.infantryValidatePath(entity);
      }
      if (entity.stats.isInfantry && entity.path.length > 0 && entity.pathIndex < entity.path.length) {
        const destCell = entity.path[entity.pathIndex];
        const canStart = this.infantryCanEnterCell(entity, destCell.cx, destCell.cy);
        if (canStart !== MoveResult.OK) {
          entity.path = [];
          entity.pathIndex = 0;
          if (entity.pathDelay > 0) return;

          const goal = {
            cx: Math.floor(entity.moveTarget!.lx / LEPTON_SIZE),
            cy: Math.floor(entity.moveTarget!.ly / LEPTON_SIZE),
          };
          const pathGoal = this.resolveInfantryBasicPathGoal(entity, goal);
          const newPath = this.findDriveClassBasicPath(entity, pathGoal);
          entity.pathDelay = PATH_DELAY_TICKS;
          if (newPath.length === 0) {
            const closeEnough = 704; // rules.ini [General] CloseEnough=2.75 * 256
            if (entity.moveTarget &&
                leptonDist(entity.leptonX, entity.leptonY, entity.moveTarget.lx, entity.moveTarget.ly) < closeEnough) {
              entity.moveTarget = null;
            } else if (entity.tryCount > 0) {
              entity.tryCount--;
            }
            entity.isDriving = false;
            entity.headToLX = 0;
            entity.headToLY = 0;
            return;
          }
          this.setInfantryBasicPath(entity, newPath);
          if (entity.path.length === 0 || entity.pathIndex >= entity.path.length) return;
        }

        const nextDestCell = entity.path[entity.pathIndex];
        const started = this.infantryStartDriver(entity, nextDestCell.cx, nextDestCell.cy);
        if (!started) return;
        entity.isDriving = true;
        entity.doing = 'walk';
      }
      return;
    }
    if (hasActiveHeadTo) {
      const wp = { lx: entity.headToLX, ly: entity.headToLY };
      if (entity.moveToward(wp, this.movementSpeed(entity))) {
        const navComAtArrival = entity.moveTarget;
        if (entity.path.length > 0 && entity.pathIndex < entity.path.length) {
          entity.pathIndex++;
          this.consumeDrivePathFacings(entity, 1);
        }
        this.stopInfantryDriver(entity);
        // PCP_END cell-arrival — infantry only. Vehicles use their own
        // unitPerCellProcess chain via followTrackStep (not reached here
        // since this path uses moveToward, not the track-based mover).
        if (FOOT_PER_CELL_ENABLED && entity.stats.isInfantry) {
          this.cutInfantryTransportTether(entity);
          const liveTar = !!(entity.target?.alive) || entity.targetStructure != null;
          const inRangeNow = !!(entity.target?.alive) && entity.inRangeOfLikelyCoord(entity.target);
          const fpcpResult = footPerCellProcess(
            entity as unknown as Parameters<typeof footPerCellProcess<Mission>>[0],
            PCPType.PCP_END,
            {
              hasLegalTarCom: liveTar,
              inRadioContact: false,
              pathShortenEligible: true,
              targetInRange: inRangeNow,
              // C++ infantry.cpp:823-832 — RADIO_IM_IN ground transport
              // boarding. The callback locates an APC/LST at the unit's
              // cell whose NavCom matches and performs Limbo+Attach.
              tryBoardTransport: () => this.tryPCPBoardTransport(entity),
            },
            {
              guardMission: Mission.GUARD,
              areaGuardMission: Mission.AREA_GUARD,
              attackMission: Mission.ATTACK,
              huntMission: Mission.HUNT,
              rescueMission: Mission.RESCUE,
            }
          );
          // C++ infantry.cpp:830-831 — `return;` after Limbo+Attach. The
          // unit is now in limbo (will be removed by _pendingTransportLoads at
          // end of tick) so skip the rest of this PCP arrival sequence.
          if (fpcpResult.boarded) return;
        }
        // C++ infantry.cpp:4004-4010 — after PCP_END and Stop_Driver, arrival
        // at NavCom clears the destination. If Mission is MOVE, Enter_Idle_Mode
        // queues the next mission (ATTACK when TarCom is legal) for the next
        // Commence gate; it does not direct-write Mission.
        if (navComAtArrival &&
            Math.floor(navComAtArrival.lx / LEPTON_SIZE) === entity.cell.cx &&
            Math.floor(navComAtArrival.ly / LEPTON_SIZE) === entity.cell.cy) {
          entity.moveTarget = null;
          this.clearDrivePath(entity);
          if ((entity.mission as Mission) === Mission.MOVE) {
            assignMission(entity, this.infantryEnterIdleMission(entity));
          }
        }
      }
    }
  }

  /**
   * Phase 1 Checkpoint 1.C — DriveClass::AI (vehicle/vessel) Movement_AI stub.
   *
   * Mirrors C++ `DriveClass::AI` (drive.cpp:1304-1399), the per-tick track
   * dispatcher that moves vehicles/vessels along their current track. Calls
   * into `updateMove(entity, fromGuardDrive=?)` which runs While_Moving →
   * Per_Cell_Process chains. The `fromGuardDrive` flag is essential for parity:
   * it signals that the caller is in Mission.GUARD with isDriving=true, so
   * updateMove should NOT alter `mission` on arrival (drive-in-GUARD semantics).
   *
   * Not yet called — STAGE D wires this on flag flip. Current callers still
   * invoke `updateMove` directly from Mission.MOVE / Mission.GUARD inline.
   *
   * ## C++ refs
   *   drive.cpp:1304      DriveClass::AI top
   *   drive.cpp:1340-1345 Start_Of_Move + While_Moving double-cycle
   *   drive.cpp:1376      Drive-in-GUARD path (NavCom legal while Mission==GUARD)
   *   unit.cpp:404,472    UnitClass::AI Commence bookends (pre- and post-Drive)
   *   vessel.cpp:591-659  VesselClass::AI (same structure, two Commence bookends)
   */
  private hasActiveDriveSegment(entity: Entity): boolean {
    // C++ Assign_Destination(TARGET_NONE) clears NavCom, but it does not stop an
    // already-started DriveClass track. DriveClass::AI continues While_Moving on
    // TrackNumber/Path until Stop_Driver clears IsDriving.
    if (entity.isDriving) {
      return entity.moveTarget !== null
        || entity.trackNumber > 0
        || entity.pathIndex < entity.path.length;
    }

    // C++ drive.cpp:1376-1402 also starts a new track while Mission==GUARD
    // when NavCom is legal. This is not an "already active" segment in TS
    // because Stop_Driver cleared isDriving at the previous cell boundary, but
    // DriveClass::AI immediately re-enters Start_Of_Move() in the same object
    // AI pass if the destination remains legal.
    return entity.moveTarget !== null && entity.trackNumber <= 0;
  }

  private runDriveClassAI(entity: Entity): void {
    // Per-tick DriveClass::AI — vehicle/vessel per-tick movement dispatched
    // from STAGE D when DISPATCH_ORDER_REFACTOR=true. Mirrors the inline
    // Mission.MOVE + drive-in-GUARD + Mission.HUNT blocks currently in
    // dispatchMission.
    //
    // ## Phase 5 double-cycle (gated on PCP_DOUBLE_CYCLE_ENABLED)
    // C++ DriveClass::AI can re-enter its While_Moving → Start_Of_Move →
    // While_Moving inner loop up to twice per tick when the current track
    // completes with more path remaining (drive.cpp:1340-1345). The second
    // cycle produces a second per-cell Commence pop — the load-bearing
    // mechanism for vessel[182]/vessel[183] firing Mission_Move 2-3× at
    // SCG07EA t17 and MCV-157 firing twice at SCG11EA t28.
    //
    // When the flag is OFF the loop runs exactly once — identical to
    // pre-Phase-5 behavior. When ON, the second iteration fires only when
    // the first iteration advanced pathIndex AND there is still remaining
    // path AND the current mission is still a drive-class mission. HUNT/RESCUE/
    // ATTACK with active NavCom/Path use the same DriveClass track-following
    // path; infantry-only walk-step logic does not apply to these objects.
    //
    // ## C++ refs
    //   drive.cpp:1304-1399  DriveClass::AI — per-tick track follow
    //   drive.cpp:1340-1345  While_Moving → Start_Of_Move double-cycle
    //   drive.cpp:1376       Drive-in-GUARD (NavCom legal, Mission==GUARD)
    //   vessel.cpp:591-659   VesselClass::AI — same structure, double Commence
    //   vessel.cpp:593       pre-DriveClass::AI Commence
    //   vessel.cpp:659       post-DriveClass::AI Commence (gated IsDoorClosed)
    if (entity.stats.isInfantry) return; // Handled by runInfantryMovementAI
    const m0 = entity.mission as Mission;

    if (DRIVE_CLASS_AI_PORT
        && !entity.isAirUnit
        && !entity.isNavalUnit
        && !entity.stats.isInfantry
        && !entity.isDriving
        && entity.moveTarget
        && entity.pathIndex > 0
        && m0 !== Mission.ENTER) {
      const destCell = {
        cx: Math.floor(entity.moveTarget.lx / 256),
        cy: Math.floor(entity.moveTarget.ly / 256),
      };
      if (!cellsInSameMovementZone(this.map, entity.cell, destCell, entity.isNavalUnit, this.structures)) {
        // C++ drive.cpp:1385-1388: DriveClass::AI clears NavCom for locked
        // vehicles whose destination is outside their movement zone. The
        // initial Assign_Destination call can still start one track immediately
        // (drive.cpp:638-640), so TS only applies this after at least one path
        // entry has been consumed.
        entity.moveTarget = null;
        entity.path = [];
        entity.pathIndex = 0;
        entity.trackNumber = -1;
        entity.trackControlIndex = -1;
        entity.trackCellSpan = 1;
        resetPathThreshold(entity);
        return;
      }
    }

    // Phase 3 (JOINT-REFACTOR §3.2) — DriveClass::AI close-enough NavCom clear +
    // Basic_Path regeneration. Gated on DRIVE_CLASS_AI_PORT. See the flag
    // docstring in perCellProcess.ts for the full rationale.
    //
    // Close-enough clear (drive.cpp:970):
    //   if (Mission == MOVE && Distance(NavCom) < Rule.CloseEnoughDistance) {
    //     Assign_Destination(TARGET_NONE);  // NavCom cleared
    //     // Mission_Move top-of-handler guard at foot.cpp:520-524 detects
    //     // !Target_Legal(NavCom) && !IsDriving && MissionQueue==NONE →
    //     // Enter_Idle_Mode() → Mission=GUARD (or AREA_GUARD).
    //   }
    //
    // Path regen (drive.cpp:906 Start_Of_Move calls Basic_Path when Path[] empty):
    //   if (moveTarget && Path[0] == FACING_NONE) {
    //     path = findPath(cell, destCell, ...);
    //     if (path.length === 0) enterIdleMode();  // Basic_Path failure
    //   }
    // Phase 3 v2 — C++-faithful Start_Of_Move port (drive.cpp:906-1066).
    //
    // CRITICAL LESSON from Phase 3 v1 (commits c4f7180f / 77eb480d reverted):
    //   v1 fired close-enough at the TOP of runDriveClassAI every tick
    //   whenever `Mission==MOVE && octDist<704`. That is NOT what C++ does.
    //
    // C++ semantics (verified against drive.cpp:906-1066 in-repo):
    //   1. Start_Of_Move is only entered when `facing == FACING_NONE` —
    //      i.e. when `Path[]` is empty (new track needed).
    //   2. Close-enough check (drive.cpp:970-972) fires ONLY inside
    //      `if (!Basic_Path())` — i.e. when pathfinding itself fails.
    //   3. The action is narrow: `Assign_Destination(TARGET_NONE)` only.
    //      No direct `Enter_Idle_Mode`. The idle transition happens one
    //      tick later when `FootClass::Mission_Move` (foot.cpp:524) sees
    //      `!Target_Legal(NavCom) && !IsDriving && MissionQueue == NONE`
    //      and calls `Enter_Idle_Mode()` itself.
    //   4. Guards: `!Is_On_Priority_Mission() && (Mission == MISSION_MOVE
    //      || Mission == MISSION_GUARD_AREA)`.
    //
    // Regression explanation (SCG11 t57):
    //   4TNK target is 640 leptons away (< 704). v1 called enterIdleMode
    //   at tick N. C++ instead calls Basic_Path, which SUCCEEDS (friendly
    //   at blocking cell is MOVE_MOVING_BLOCK = pathable), tank starts
    //   rotating, next tick Can_Enter_Cell fails → reactive close-enough
    //   at drive.cpp:1102 fires — two ticks later than v1.
    // DriveClass::AI is shared by units and vessels. VesselClass wraps it with
    // door/rotation/combat behavior, but Start_Of_Move/Basic_Path regeneration
    // still belongs to DriveClass and applies to SPEED_FLOAT vessels too.
    if (DRIVE_CLASS_AI_PORT
        && !entity.isAirUnit
        && !entity.isDriving
        && entity.trackNumber <= 0
        && entity.path.length > 0
        && entity.pathIndex >= entity.path.length) {
      // C++ Start_Of_Move sees an exhausted path as Path[0] == FACING_NONE
      // because successful track starts memmove Path[] left (drive.cpp:1234,
      // 1250). TS stores path + pathIndex, so pathIndex==path.length is the
      // same state. Normalize it before the Basic_Path branch below; otherwise
      // drive-class units with legal NavCom but exhausted Path[] sit still
      // forever. SCG07EA Greek PT id=187 mirrors C++ vessel 1966101 here.
      entity.path = [];
      entity.pathIndex = 0;
    }

    // C++ drive.cpp:1369-1379 — stationary drive-class objects rotate before
    // Start_Of_Move/Basic_Path is considered. This applies even when Path[0] is
    // FACING_NONE and PathDelay is active; an earlier Do_Turn request continues
    // to completion, then Start_Of_Move retries on a later tick.
    if (DRIVE_CLASS_AI_PORT
        && !entity.isAirUnit
        && !entity.stats.isInfantry
        && !entity.isDriving
        && entity.trackNumber <= 0) {
      if (entity.bodyFacing256 < 0) entity.bodyFacing256 = (entity.facing * 32) & 0xff;
      const desired256 = entity.desiredFacing256 >= 0
        ? (entity.desiredFacing256 & 0xff)
        : (((entity.desiredFacing ?? entity.facing) * 32) & 0xff);
      if (entity.type === UnitType.V_MCV && entity.mcvIsDeploying) {
        this._runPlacement(ctx => _advanceMCVDeployRotation(ctx, entity));
        return;
      }
      if (entity.bodyFacing256 !== desired256) {
        entity.tickRotation();
        return;
      }
    }

    if (DRIVE_CLASS_AI_PORT
        && !entity.isAirUnit
        && !entity.isDriving
        && entity.trackNumber <= 0
        && entity.moveTarget
        && entity.path.length === 0
        // C++ drive.cpp:1369-1399 checks PrimaryFacing.Is_Rotating() before
        // considering Start_Of_Move/Basic_Path. A pending turn from an earlier
        // destination continues even when Path[0] is invalid and PathDelay is
        // active; only after rotation completes can Start_Of_Move retry pathing.
        && entity.bodyFacing256 === (entity.desiredFacing256 >= 0
          ? (entity.desiredFacing256 & 0xff)
          : (((entity.desiredFacing ?? entity.facing) * 32) & 0xff))) {
      if (m0 !== Mission.UNLOAD) {
        // C++ drive.cpp:969 — Start_Of_Move does not call Basic_Path while
        // PathDelay is active. It returns false and waits for a later AI tick.
        if (entity.pathDelay > 0) return;

        const destCell = {
          cx: Math.floor(entity.moveTarget.lx / 256),
          cy: Math.floor(entity.moveTarget.ly / 256),
        };

        // If already at destination cell, clear NavCom without enterIdleMode
        // — the next-tick Mission_Move handler handles the idle transition.
        if (destCell.cx === entity.cell.cx && destCell.cy === entity.cell.cy) {
          entity.moveTarget = null;
          this.clearDrivePath(entity);
          return;
        }

        // C++ FootClass::Basic_Path (foot.cpp:323-335) keeps NavCom intact,
        // but if the NavCom cell is blocked and the unit is beyond the
        // relevant close-enough/stray distance, it asks Map.Nearby_Location for
        // a temporary pathing cell. SCG07EA cover PTs hit this when the LST is
        // sitting on waypoint 1: C++ paths around the occupied waypoint instead
        // of cutting diagonally through it.
        const pathGoal = this.resolveBasicPathGoal(entity, destCell);

        const newPath = this.findDriveClassBasicPath(entity, pathGoal);
        // C++ FootClass::Basic_Path sets PathDelay after every path
        // calculation, including successful path finds (foot.cpp:475).
        entity.pathDelay = PATH_DELAY_TICKS;

        if (newPath.length === 0) {
          // Basic_Path failed — C++ drive.cpp:961 `if (!Basic_Path())` branch.
          //
          // drive.cpp:970-972 — close-enough reactive clear:
          //   !Is_On_Priority_Mission() && Distance(NavCom) < CloseEnoughDistance
          //   && (Mission == MOVE || Mission == GUARD_AREA) → NavCom=TARGET_NONE.
          //
          // DriveClass::Assign_Destination(TARGET_NONE) clears NavCom/Path and,
          // for a non-driving MISSION_MOVE unit, immediately queues the class
          // idle mission via Start_Of_Move's no-NavCom guard.
          const CLOSE_ENOUGH_LEPTONS = 704; // rules.ini [General] CloseEnough=2.75 × 256.
          const dxL = entity.moveTarget.lx - entity.leptonX;
          const dyL = entity.moveTarget.ly - entity.leptonY;
          const adx = Math.abs(dxL), ady = Math.abs(dyL);
          // Octagonal Distance() approximation (C++ coord.cpp:124-136).
          const octDist = adx > ady ? adx + (ady >> 1) : ady + (adx >> 1);

          // TS doesn't model Is_On_Priority_Mission() for team patrol; treat
          // as false (matches the common case for patrol/team MOVE units).
          const isPriority = false;
          const missionEligible = (m0 === Mission.MOVE || m0 === Mission.AREA_GUARD);

          if (!isPriority && octDist < CLOSE_ENOUGH_LEPTONS && missionEligible) {
            // drive.cpp:970-972: Assign_Destination(TARGET_NONE).
            this.assignDriveDestinationNone(entity);
            return;
          }

          // Basic_Path failed and not close-enough. C++ has TryTryAgain--
          // with retry cycle; for now just clear NavCom to prevent infinite
          // path-regen attempts per tick (matches drive.cpp:1006 fallback
          // when TryTryAgain expires).
          entity.moveTarget = null;
          this.clearDrivePath(entity);
          return;
        }

        // Basic_Path succeeded.
        this.setDrivePath(entity, newPath);
      }
    }

    // Double-cycle loop for MOVE + drive-in-GUARD. C++ drive.cpp:1340-1345
    // caps at 2 iterations; the second only runs when the first advanced
    // the track and there is more path remaining.
    let cyclesThisTick = 0;
    const MAX_CYCLES = 2;
    while (cyclesThisTick < MAX_CYCLES) {
      const prevPathIndex = entity.pathIndex;
      const prevPathLen = entity.path.length;
      const m = entity.mission as Mission;
      const driveClassTrackReentry = cyclesThisTick > 0;

      if (m === Mission.MOVE) {
        this.updateMove(entity, false, driveClassTrackReentry);
      } else if (m === Mission.HUNT || m === Mission.RESCUE || m === Mission.ATTACK || m === Mission.AREA_GUARD) {
        // DriveClass::AI is mission-agnostic for active NavCom/Path movement.
        // Keep the mission intact; only Mission_MOVE arrival enters idle.
        if (entity.moveTarget !== null || entity.pathIndex < entity.path.length || entity.isDriving) {
          this.updateMove(entity, /*fromGuardDrive=*/ true, driveClassTrackReentry);
        } else {
          return;
        }
      } else if (m === Mission.ENTER) {
        // C++ UnitClass::AI always runs DriveClass::AI after MissionClass::AI
        // (unit.cpp:406-408), so units in MISSION_ENTER keep following NavCom
        // while FootClass::Mission_Enter's radio/timer state machine runs.
        // SCG04EA HARV unit[76] drives into the refinery under ENTER; skipping
        // this pass left TS stationary with a stale path until the next timer.
        if (entity.moveTarget !== null || entity.pathIndex < entity.path.length || entity.isDriving) {
          this.updateMove(entity, /*fromGuardDrive=*/ true, driveClassTrackReentry);
        } else {
          return;
        }
      } else if (m === Mission.HARVEST && entity.type === UnitType.V_HARV) {
        // C++ UnitClass::Mission_Harvest assigns NavCom but keeps Mission
        // MISSION_HARVEST; DriveClass::AI still follows the active destination
        // every tick. Use the guard-drive path so arrival clears NavCom/path
        // without changing the mission to GUARD.
        if (entity.moveTarget !== null || entity.pathIndex < entity.path.length || entity.isDriving) {
          this.updateMove(entity, /*fromGuardDrive=*/ true, driveClassTrackReentry);
        } else {
          return;
        }
      } else if (m === Mission.GUARD || m === Mission.STICKY) {
        // Drive-in-GUARD: units given Mission.MOVE via coordinateMove with
        // isDriving=true continue to drive even while Mission stays GUARD
        // (blocked by !IsDriving Commence gate). Mirror the inline block in
        // dispatchMission Mission.GUARD case.
        if (this.hasActiveDriveSegment(entity)) {
          this.updateMove(entity, /*fromGuardDrive=*/ true, driveClassTrackReentry);
          // Step 7 cleanup: removed the manual `missionTimer = 14 +
          // Random_Pick(0,2)` jitter fire that was a proxy for Mission_Move
          // dispatch. STAGE F naturally re-dispatches Mission_Move when
          // mission==MOVE && missionTimer==0 post-Commence, firing the jitter
          // RNG once via the Mission_Move handler — matches C++ techno.cpp:2344
          // dispatch cadence. The previous proxy caused double-fires when
          // STAGE F also ran (observed as unit[94] firing 3× at SCG11EA t15).
        } else {
          // Not driving → no track to advance; break out (single dispatch).
          return;
        }
      } else {
        // Mission transitioned to something outside MOVE/GUARD/STICKY during
        // the first cycle (e.g. Commence popped to ATTACK). Don't re-enter.
        return;
      }

      cyclesThisTick++;

      // Second-iteration gate (flag OFF → always break; flag ON → require
      // track-advance + more path remaining, per drive.cpp:1340-1345).
      if (!PCP_DOUBLE_CYCLE_ENABLED) break;

      // C++ drive.cpp:1352 double-cycle gate is explicit:
      //   if (TrackNumber == -1 && (Target_Legal(NavCom) || Path[0] != NONE)) {
      //     Start_Of_Move();
      //     While_Moving();
      //   }
      //
      // A track jump also advances Path[]/pathIndex, but it leaves TrackNumber
      // live on the newly-jumped track (drive.cpp:773-779). Do not spend a
      // second While_Moving budget for track jumps; SCG04EA 3TNK t36 otherwise
      // lands one C++ tick ahead and fires Mission_Guard at t108 instead of t109.
      const trackCompleted = entity.trackNumber === -1;
      if (!trackCompleted) break;

      // TS stores drive paths as absolute cells plus a cursor. C++ stores only
      // remaining facings in Path[]. After a track finishes, a TS absolute path
      // can still point at the cell the object just reached; in C++ that entry
      // has already been memmoved away and Path[0] is either the next facing or
      // FACING_NONE. Normalize stale current-cell entries before deciding whether
      // the DriveClass::AI same-tick re-entry should consume Path[0] or call
      // Basic_Path. SCG07EA cover PT 1966102: stale `(15,54)` caused TS to clear
      // Path/NavCom one tick before C++ instead of regenerating Path[0]=NW.
      let droppedCurrentCellPath = false;
      while (entity.path.length > 0 &&
             entity.pathIndex < entity.path.length &&
             entity.path[entity.pathIndex]?.cx === entity.cell.cx &&
             entity.path[entity.pathIndex]?.cy === entity.cell.cy) {
        entity.pathIndex++;
        droppedCurrentCellPath = true;
      }

      // Track-complete condition: pathIndex advanced this iteration AND
      // either more Path[] remains or NavCom is still legal. C++ drive.cpp:1352
      // explicitly gates on `(Target_Legal(NavCom) || Path[0] != NONE)`.
      // When Path[] is empty but NavCom remains legal, the second cycle calls
      // Start_Of_Move(), regenerates Basic_Path(), then spends the second
      // While_Moving budget in the same tick. SCG07EA Greek PT 1966102 hits
      // this at tick 128 after its old track finishes under a retargeted NavCom.
      const pathAdvanced = entity.pathIndex > prevPathIndex;
      const morePathRemaining = entity.path.length > 0
        && entity.pathIndex < entity.path.length;
      const navComLegal = entity.moveTarget !== null;
      if (!pathAdvanced || (!morePathRemaining && !navComLegal)) break;

      // C++ stores the active drive path as a FACING array; TS also mirrors that
      // in drivePathFacings because absolute path cells can be stale after long
      // or curved tracks. If the facing mirror is empty, C++ Path[0] is
      // FACING_NONE and the re-entry below must run Basic_Path. If facings remain,
      // rebuild the absolute cells from those facings before the second cycle.
      // This keeps SCG07EA cover PT residual paths without preserving SCG02EA's
      // stale absolute tail after C++ has exhausted Path[].
      let preservedResidualPath = false;
      if (!morePathRemaining && navComLegal && entity.path.length > 0 && entity.pathIndex >= entity.path.length) {
        const remainingBeforeTrack = Math.max(0, prevPathLen - prevPathIndex);
        const residualPath = this.drivePathCellsFromFacings(entity.cell, entity.drivePathFacings);
        if (!droppedCurrentCellPath && remainingBeforeTrack > 0 && residualPath.length > 0) {
          entity.path = residualPath;
          entity.pathIndex = 0;
          preservedResidualPath = true;
        } else {
          this.clearDrivePath(entity);
        }
      }
      // If a residual Path[0] was preserved, keep the C++ double-cycle alive:
      // drive.cpp:1352 immediately calls Start_Of_Move() again after a track
      // completes when `Path[0] != FACING_NONE`. That same-tick call can request
      // Do_Turn() even though no further movement occurs until rotation finishes.

      let regeneratedPathThisCycle = false;
      if (!morePathRemaining && navComLegal && entity.path.length === 0) {
        const canBasicPath =
          (entity.mission as Mission) !== Mission.UNLOAD;
        if (!canBasicPath || !this.tryRegenerateDriveClassBasicPath(entity, entity.mission as Mission)) {
          break;
        }
        regeneratedPathThisCycle = true;
      }

      // Vessel Is_Door_Closed gate: vessel.cpp:659 gates the post-Commence
      // behind `Is_Door_Closed()`. For non-LST vessels door is always
      // closed; for LSTs `doorOpen` is toggled open during cargo load/unload.
      // When open, do NOT run the second cycle (the pre-Commence gate in
      // updateMove at ~5788 would short-circuit to IDLE anyway, but we
      // keep the semantic gate explicit here).
      if (entity.stats.isVessel && entity.doorOpen) break;

      // Sanity: if path length SHRANK unexpectedly this iteration (not just
      // pathIndex advancing), something outside the driver mutated state —
      // don't re-enter.
      if (!regeneratedPathThisCycle && entity.path.length > prevPathLen) break;
    }
  }

  /**
   * Phase 1 refactor scaffold: extracted the per-tick entity finalization block
   * that previously lived at the bottom of `updateEntity` (post-switch / pre-tail
   * harvesters + civilian panic etc). Semantics preserved byte-for-byte.
   *
   * Contains: Doing_AI, firing-anim countdown, Commence (post-MissionClass::AI),
   * civilian panic flee, harvester AI, turret re-centering, wall/vehicle crush,
   * auto-load into transport, tickAnimation.
   */
  private _updateEntityPostDispatch(entity: Entity, missionTimerFired = false): void {
    // Civilian panic: flee from nearby ants (cooldown prevents oscillation)
    if (entity.alive && entity.isCivilian && entity.mission === Mission.GUARD &&
        this.tick - entity.lastGuardScan >= 45) {
      entity.lastGuardScan = this.tick;
      let closestThreat: Entity | null = null;
      let closestDist = CELL_SIZE * 6; // flee range: 6 cells
      for (const other of this.entities) {
        if (!other.alive || !other.isAnt) continue;
        const d = worldDist(entity.pos, other.pos);
        if (d < closestDist) {
          closestDist = d;
          closestThreat = other;
        }
      }
      if (closestThreat) {
        // Run away from the ant
        const dx = entity.pos.x - closestThreat.pos.x;
        const dy = entity.pos.y - closestThreat.pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        let fleeX = entity.pos.x + (dx / dist) * CELL_SIZE * 4;
        let fleeY = entity.pos.y + (dy / dist) * CELL_SIZE * 4;
        // Clamp flee target to map bounds
        const minX = (this.map.boundsX + 1) * CELL_SIZE;
        const minY = (this.map.boundsY + 1) * CELL_SIZE;
        const maxX = (this.map.boundsX + this.map.boundsW - 2) * CELL_SIZE;
        const maxY = (this.map.boundsY + this.map.boundsH - 2) * CELL_SIZE;
        fleeX = Math.max(minX, Math.min(maxX, fleeX));
        fleeY = Math.max(minY, Math.min(maxY, fleeY));
        entity.mission = Mission.MOVE;
        entity.moveTarget = { lx: pixelToLepton(fleeX), ly: pixelToLepton(fleeY) };
        const tc = worldToCell(fleeX, fleeY);
        if (this.map.isPassable(tc.cx, tc.cy)) {
          entity.path = findPath(this.map, entity.cell, tc, true);
          entity.pathIndex = 0;
        }
      }
    }

    // Harvester AI — automatic ore gathering (player AND AI harvesters)
    // Gate allows GUARD, AREA_GUARD (idle/arrival), and MOVE (seeking/returning with timeout tracking)
    if (entity.alive && entity.type === UnitType.V_HARV &&
        !entity.target && entity.mission !== Mission.ATTACK && entity.mission !== Mission.DIE) {
      this._runHarvester(ctx => _updateHarvester(ctx, entity, missionTimerFired));
    }

    // C++ UnitClass::Rotation_AI (unit.cpp:506-563) runs after Firing_AI every
    // tick, independent of Arm/rearm cooldown. This is separate from
    // DriveClass::AI's PrimaryFacing.Rotation_Adjust, which already ran earlier
    // this tick. For fixed-body tracked units, Rotation_AI only updates the next
    // desired facing; the body rotates on the following DriveClass::AI pass.
    if (entity.alive && !entity.stats.isInfantry && !entity.isAirUnit && !entity.isNavalUnit &&
        entity.target?.alive) {
      const dir256 = directionToLeptons256(
        entity.leptonX, entity.leptonY,
        entity.target.leptonX, entity.target.leptonY,
      );
      if (entity.hasTurret) {
        entity.desiredTurretFacing256 = dir256;
        entity.desiredTurretFacing = dir256ToFacing8(dir256);
        entity.tickTurretRotation();
      } else if (entity.stats.speedClass === SpeedClass.TRACK &&
                 !entity.moveTarget && !entity.isDriving) {
        const body256 = entity.bodyFacing256 >= 0
          ? entity.bodyFacing256 & 0xff
          : (entity.facing * 32) & 0xff;
        if (body256 !== dir256) {
          entity.desiredFacing256 = dir256;
          entity.desiredFacing = dir256ToFacing8(dir256);
        }
      }
    }

    // M2: Land-unit turret idle Rotation_AI (C++ unit.cpp:534-559).
    // If SecondaryFacing is already rotating, C++ rotates toward the existing
    // desired facing. Only when it is not rotating and there is no TarCom does it
    // assign a new desired facing: NavCom direction if legal, otherwise
    // PrimaryFacing.Current(). Critically, that newly assigned desired facing does
    // not rotate until the next UnitClass::Rotation_AI tick because it is set in
    // the `else` branch after the Is_Rotating() check.
    //
    // Vessels do not use this UnitClass behavior; VesselClass::Rotation_AI only
    // changes SecondaryFacing for a legal TarCom (vessel.cpp:2166-2187). Applying
    // the UnitClass idle-return rule to PT/DD/CA pre-rotates their turrets before
    // target acquisition and skips C++ FIRE_ROTATING delays.
    if (entity.alive && entity.hasTurret && !entity.isNavalUnit &&
        !entity.target?.alive && !entity.targetStructure?.alive) {
      const turret256 = entity.turretFacing256 >= 0
        ? entity.turretFacing256 & 0xff
        : (entity.turretFacing32 * 8) & 0xff;
      const desiredTurret256 = entity.desiredTurretFacing256 >= 0
        ? entity.desiredTurretFacing256 & 0xff
        : (entity.desiredTurretFacing * 32) & 0xff;
      if (turret256 !== desiredTurret256) {
        entity.tickTurretRotation();
      } else if (entity.moveTarget) {
        // C++ Target_Legal(NavCom): turret faces final NavCom coordinate, not
        // the current path step/body facing. SCG07EA 2TNK reaches the landing
        // cell with no TarCom; C++ pre-rotates the turret toward NavCom before
        // Mission_Guard later acquires the E4 target.
        const dir256 = directionToLeptons256(
          entity.leptonX, entity.leptonY,
          entity.moveTarget.lx, entity.moveTarget.ly,
        );
        entity.desiredTurretFacing256 = dir256;
        entity.desiredTurretFacing = dir256ToFacing8(dir256);
      } else {
        // Standing still — turret aligns to body facing
        entity.desiredTurretFacing = entity.facing;
        entity.desiredTurretFacing256 = entity.bodyFacing256 >= 0
          ? entity.bodyFacing256 & 0xff
          : (entity.facing * 32) & 0xff;
      }
    }

    // Wall crush: crusher vehicles destroy crushable walls on cell entry
    // C++ unit.cpp:1855-1871 — Per_Cell_Process: IsCrusher && overlay IsCrushable → Reduce_Wall(-1)
    if (entity.alive && entity.stats.crusher &&
        entity.stats.speed > 0 && entity.animState === AnimState.WALK) {
      this.checkWallCrush(entity);
    }

    // Vehicle crush: heavy tracked vehicles (crusher=true) kill crushable units on cell entry
    // C++ DriveClass::Ok_To_Move — only vehicles with Crusher flag crush infantry/ants
    if (entity.alive && entity.stats.crusher &&
        entity.stats.speed > 0 && entity.animState === AnimState.WALK) {
      this.checkVehicleCrush(entity);
    }

    // Auto-load into transport: infantry moving toward a friendly transport
    // C++ parity: infantry must reach the transport's cell before loading.
    // C++ cargo.cpp:97 — Add_Cargo fires only when the infantry enters the
    // transport's occupy cell (same cell). Use 0.7 cell threshold (inside the
    // same cell accounting for sub-cell offsets).
    if (entity.alive && entity.stats.isInfantry && entity.isPlayerUnit &&
        entity.mission === Mission.MOVE && entity.moveTarget) {
      for (const other of this.entities) {
        if (!other.alive || other.id === entity.id || !other.isTransport) continue;
        if (!other.isPlayerUnit || other.passengers.length >= other.maxPassengers) continue;
        const dist = worldDist(entity.pos, other.pos);
        if (dist < 0.7) {
          // Same cell — check if move target was the transport
          const targetCell = {
            cx: Math.floor(entity.moveTarget.lx / LEPTON_SIZE),
            cy: Math.floor(entity.moveTarget.ly / LEPTON_SIZE),
          };
          if (targetCell.cx === other.cell.cx && targetCell.cy === other.cell.cy) {
            other.passengers.push(entity);
            entity.transportRef = other;
            entity.isTethered = false;
            entity.selected = false;
            this.selectedIds.delete(entity.id);
            // LST door animation on load
            if (other.type === UnitType.V_LST) {
              other.doorOpen = true;
              other.doorTimer = 60; // 4 seconds auto-close
            }
            // Mark for removal from world (will be re-added on unload)
            entity.mission = Mission.SLEEP;
            this.map.setOccupancy(entity.cell.cx, entity.cell.cy, 0);
            if (entity.stats.isInfantry) this.map.vacateSubCell(entity.cell.cx, entity.cell.cy, entity.id);
            // Defer removal to avoid mutating array during iteration
            this._pendingTransportLoads.push(entity.id);
            // C++ parity: transport auto-evacuates when a civilian/VIP is loaded
            // (SCG01EA: Chinook auto-flies to map edge after Einstein boards)
            if (CIVILIAN_UNIT_TYPES.has(entity.type) && other.stats.isAircraft) {
              this.orderTransportEvacuate(other);
            }
            break;
          }
        }
      }
    }

    entity.tickAnimation();
  }

  // Team mission type constants (exact values from RA TEAMTYPE.H TeamMissionType enum)
  private static readonly TMISSION_ATTACK = 0;
  private static readonly TMISSION_ATT_WAYPT = 1;
  private static readonly TMISSION_CHANGE_FORMATION = 2;
  private static readonly TMISSION_MOVE = 3;
  private static readonly TMISSION_GUARD = 5;
  private static readonly TMISSION_LOOP = 6;
  private static readonly TMISSION_UNLOAD = 8;
  private static readonly TMISSION_DEPLOY = 9;      // deploy MCV / minelayer mine-drop (C++ TMission_Deploy)
  private static readonly TMISSION_HOUND_DOG = 10;   // move to waypoint then guard (C++ TMission_Hound_Dog)
  private static readonly TMISSION_DO = 11;          // assign mission to members (C++ Coordinate_Do)
  private static readonly TMISSION_SET_GLOBAL = 12;  // set global variable (C++ TMission_Set_Global)
  private static readonly TMISSION_INVULNERABLE = 13;  // C++ teamtype.h:57 — applies iron curtain to team (simplified: idle wait)
  private static readonly TMISSION_LOAD = 14;
  private static readonly TMISSION_SPY = 15;         // infiltrate building at waypoint (C++ TMission_Spy)
  private static readonly TMISSION_PATROL = 16;

  /** Map C++ MissionType enum index to TS Mission enum (C++ defines.h:979-1008) */
  private static readonly CPP_MISSION_MAP: Record<number, Mission> = {
    0: Mission.SLEEP,           // MISSION_SLEEP
    1: Mission.ATTACK,          // MISSION_ATTACK
    2: Mission.MOVE,            // MISSION_MOVE
    3: Mission.QMOVE,           // MISSION_QMOVE — distinct queued move (C++ foot.cpp:339)
    4: Mission.RETREAT,         // MISSION_RETREAT
    5: Mission.GUARD,           // MISSION_GUARD
    6: Mission.STICKY,          // MISSION_STICKY — guard with IsRecruitable=false
    7: Mission.ENTER,           // MISSION_ENTER
    8: Mission.CAPTURE,         // MISSION_CAPTURE
    9: Mission.HARVEST,         // MISSION_HARVEST — distinct harvester AI cycle
    10: Mission.AREA_GUARD,     // MISSION_GUARD_AREA
    11: Mission.RETURN,         // MISSION_RETURN
    12: Mission.STOP,           // MISSION_STOP
    13: Mission.AMBUSH,         // MISSION_AMBUSH
    14: Mission.HUNT,           // MISSION_HUNT
    15: Mission.UNLOAD,         // MISSION_UNLOAD
    16: Mission.SABOTAGE,       // MISSION_SABOTAGE
    17: Mission.CONSTRUCTION,   // MISSION_CONSTRUCTION
    18: Mission.DECONSTRUCTION, // MISSION_DECONSTRUCTION
    19: Mission.REPAIR,         // MISSION_REPAIR
    20: Mission.RESCUE,         // MISSION_RESCUE
    21: Mission.MISSILE,        // MISSION_MISSILE
  };

  /** C++ vessel.cpp:1714-1830 — VesselClass::Mission_Unload status machine. */
  private updateVesselUnloadMission(entity: Entity): number {
    switch (entity.vesselUnloadStatus) {
      case 0: // INITIAL_CHECK
        if (entity.passengers.length > 0) {
          // Desired_Load_Dir/Do_Turn: TS already arrived facing the shore well
          // enough for unload; keep the state transition and 1-tick cadence.
          entity.vesselUnloadStatus = 1;
          return 1;
        }
        entity.mission = Mission.GUARD;
        return 14;

      case 1: // MANEUVERING
        if (entity.type === UnitType.V_LST) {
          entity.doorOpen = true;
          entity.doorTimer = 60;
          entity.doorOpeningTicks = 5 * (6 - 1); // LST_Open_Door Open_Door(5, 6)
        }
        entity.vesselUnloadStatus = 2;
        return 1;

      case 2: // OPENING_DOOR
        if (entity.type !== UnitType.V_LST || entity.doorOpeningTicks <= 0) {
          entity.vesselUnloadStatus = 3;
          return 1;
        }
        // DoorClass::AI continues the animation every frame; Mission_Unload
        // falls through to Normal_Delay while Is_Door_Opening() remains true.
        return 14;

      case 3: // UNLOADING
        if (entity.passengers.length > 0) {
          // C++ vessel.cpp:1756-1760 — do not detach the next passenger while
          // the transport is still in radio contact with the previous unloaded
          // passenger. The first passenger drives off the ramp, reaches its
          // first PCP_END, sends RADIO_UNLOADED, and only then can the LST
          // proceed. SCG07EA: this keeps the JEEP attached while the MCV is
          // still tethered and prevents the extra tick-286 Mission_Move RNG.
          if (this.hasTransportRadioContact(entity)) return GAME_TICKS_PER_SEC;
          this.unloadOneVesselPassenger(entity);
          return 14;
        }
        entity.vesselUnloadStatus = 4;
        return 14;

      case 4: // CLOSING_DOOR
        entity.doorOpen = false;
        entity.doorTimer = 0;
        entity.doorOpeningTicks = 0;
        entity.vesselUnloadStatus = 0;
        if (entity.isALoaner) {
          entity.mission = Mission.RETREAT;
          entity.teamMissions = [];
          entity.teamMissionIndex = 0;
        } else {
          entity.mission = Mission.GUARD;
        }
        entity.moveTarget = null;
        entity.path = [];
        entity.pathIndex = 0;
        return 14;

      default:
        entity.vesselUnloadStatus = 0;
        return 1;
    }
  }

  /** C++ vessel.cpp:1761-1791 — LST cargo unload.
   * Detach the newest passenger, try facings from transport rear clockwise,
   * unlimbo at a half-cell offset, assign MOVE to the adjacent cell, and
   * immediately Commence. No random shore scatter, no bulk unload.
   */
  private unloadOneVesselPassenger(entity: Entity): boolean {
    if (entity.passengers.length === 0) return false;

    if (entity.type === UnitType.V_LST) {
      entity.doorOpen = true;
      entity.doorTimer = 60;
    }

    const passenger = entity.passengers.pop()!;
    const primaryFacing = entity.bodyFacing256 >= 0 ? entity.bodyFacing256 & 0xff : (entity.facing * 32) & 0xff;
    const toface = (128 + primaryFacing) & 0xff; // DIR_S + PrimaryFacing
    const sourceCell = entity.cell;

    for (let face = 0; face < 8; face++) {
      const newface = (toface + (face << 5)) & 0xff; // Facing_Dir(face)
      const facing8 = dir256ToFacing8(newface);
      const newcell = {
        cx: sourceCell.cx + DIR_DX[facing8],
        cy: sourceCell.cy + DIR_DY[facing8],
      };
      const canEnter = this.map.canEnterCell(
        newcell.cx,
        newcell.cy,
        passenger.isNavalUnit,
        id => this.isEntityMovingBlockerFor(passenger, id),
        passenger.stats.isInfantry,
        passenger.id,
      );
      if (canEnter !== MoveResult.OK) continue;

      const offsetLX = (COS_TABLE_256[newface] * (LEPTON_SIZE >> 1)) >> 7;
      const offsetLY = -(SIN_TABLE_256[newface] * (LEPTON_SIZE >> 1)) >> 7;
      passenger.leptonX = entity.leptonX + offsetLX;
      passenger.leptonY = entity.leptonY + offsetLY;
      passenger.syncPosFromLeptons();
      passenger.facing = facing8;
      passenger.desiredFacing = facing8;
      passenger.bodyFacing256 = newface;
      passenger.bodyFacing32 = dir256ToFacing32(newface);
      passenger.alive = true;
      passenger.inLimbo = false;
      passenger.unlimboTick = this.tick;
      // C++ vessel.cpp:1778-1779: RADIO_HELLO + RADIO_TETHER establishes
      // two-way radio contact for every passenger type, not just infantry.
      // The LST's next Mission_Unload dispatch blocks while this contact is
      // active; UnitClass/InfantryClass PCP_END cuts it with RADIO_UNLOADED.
      passenger.transportRef = entity;
      passenger.isTethered = true;
      entity.isTethered = true;
      // C++ vessel.cpp:1781-1783 sets UnitClass::IsToScatter for RTTI_UNIT
      // passengers. UnitClass::Enter_Idle_Mode consumes it after the ramp move
      // and calls Scatter(0, true), keeping vehicles like the SCG07EA MCV on
      // MISSION_MOVE with a nearby destination instead of idling to GUARD.
      passenger.isToScatter = !passenger.stats.isInfantry && !passenger.isAirUnit;
      passenger.scenarioInitUnlimbo = true;
      passenger.deathTick = 0;
      passenger.flightAltitude = 0;
      passenger.target = null;
      passenger.targetStructure = null;
      passenger.forceFirePos = null;
      passenger.moveTarget = cellTargetToLepton(newcell.cx, newcell.cy);
      passenger.path = [];
      passenger.pathIndex = 0;
      passenger.pathDelay = 0;
      passenger.tryCount = PATH_RETRY;
      passenger.headToLX = 0;
      passenger.headToLY = 0;
      passenger.isDriving = false;
      passenger.mission = Mission.MOVE;
      passenger.missionQueue = null;
      passenger.missionQueueSetTick = -1;
      passenger.missionTimer = 0;
      passenger.animState = AnimState.IDLE;
      passenger.animFrame = 0;

      if (!this.entityById.has(passenger.id)) {
        this.entities.push(passenger);
        this.entityById.set(passenger.id, passenger);
      }
      return true;
    }

    // C++ re-attaches the passenger if no legal adjacent cell is found.
    entity.passengers.push(passenger);
    return false;
  }

  /** Execute team mission scripts — units follow waypoint patrol routes */
  private updateTeamMission(entity: Entity): void {
    if (entity.teamMissionIndex >= entity.teamMissions.length) {
      // Script complete — ants fall back to hunt AI, allied units idle
      if (entity.isAnt) {
        this.updateAntAI(entity);
      } else if (entity.mission !== Mission.RETREAT && entity.mission !== Mission.MOVE) {
        // Don't override active RETREAT (loaner transports auto-retreat after unload)
        // or MOVE missions — these were intentionally set elsewhere and have a target.
        entity.mission = this.idleMission(entity);
        entity.animState = AnimState.IDLE;
      }
      return;
    }

    const tm = entity.teamMissions[entity.teamMissionIndex];

    switch (tm.mission) {
      case Game.TMISSION_CHANGE_FORMATION: {
        const members = this.getTeamFormationMembers(entity);
        const offsets = this.calculateTeamMissionFormationOffsets(members.length, tm.data);

        for (let i = 0; i < members.length; i++) {
          members[i].formationOffset = offsets[i] ?? null;
        }

        entity.teamMissionIndex++;
        break;
      }

      case Game.TMISSION_MOVE: {
        // Move to waypoint — issue path command if not already moving there
        const wp = this.waypoints.get(tm.data);
        if (!wp) { entity.teamMissionIndex++; return; }
        const target = this.teamMissionWaypointTarget(entity, wp);

        // Check arrival first — aircraft may have already completed the move
        // (aircraftState machine clears moveTarget on arrival before team mission scans)
        if (worldDist(entity.pos, leptonPosToWorld(target)) < 2) {
          // C++ parity: transport auto-loads nearby civilians on arrival (AircraftClass::Mission_Move)
          // SCG01EA: Chinook arrives at wp24 near Einstein at wp0, auto-picks him up
          if (entity.isTransport && entity.passengers.length < (entity.maxPassengers ?? 5)) {
            for (const other of this.entities) {
              if (!other.alive || other === entity) continue;
              if (!CIVILIAN_UNIT_TYPES.has(other.type)) continue;
              if (!this.alliances.get(entity.house)?.has(other.house)) continue;
              if (worldDist(entity.pos, other.pos) > 3) continue;
              // Load civilian into transport
              entity.passengers.push(other);
              other.alive = false;
              other.mission = Mission.SLEEP;
              this.map.setOccupancy(other.cell.cx, other.cell.cy, 0);
              if (other.stats.isInfantry) this.map.vacateSubCell(other.cell.cx, other.cell.cy, other.id);
              this._pendingTransportLoads.push(other.id);
              // Auto-evacuate when civilian boards (same as player-initiated loading)
              if (entity.stats.isAircraft) {
                this.orderTransportEvacuate(entity);
                return; // evacuate immediately — don't advance team missions
              }
              break; // load one civilian per arrival
            }
          }
          // Arrived at waypoint — advance to next mission
          entity.teamMissionIndex++;
        } else if (entity.mission !== Mission.MOVE || !entity.moveTarget) {
          // C++ drive.cpp parity: a vehicle/vessel already in the canonical
          // "GUARD + IsDriving + MissionQueue=MOVE" state (set up by
          // TeamInstance.coordinateMove → missionQueue=MOVE + isDriving=true) is
          // mid-drive toward the same waypoint via DriveClass::AI's drives-in-
          // GUARD path. Direct-setting `mission=MOVE; missionTimer=0` here
          // bypasses the `!IsDriving` Commence gate (unit.cpp:472) that C++ uses
          // to stagger the Mission_Move jitter across cell-boundary Stop_Driver
          // transitions. Trust the queue — drive-in-GUARD + Commence will pop
          // the mission when the vehicle arrives at the destination cell.
          const alreadyDrivingQueued =
            !entity.stats.isInfantry && !entity.isAirUnit &&
            entity.isDriving &&
            entity.missionQueue === Mission.MOVE &&
            entity.moveTarget !== null;

          // Compute path goal (clamp off-map waypoints to map edge).
          // C++ reinf.cpp/team.cpp parity: the team Coordinate_Move assigns NavCom
          // (→ Basic_Path in DriveClass::AI), so a driving vehicle must always have
          // a live Path[] to follow. TS's early-break trusted the queue state but
          // forgot to seed the path — the MNLY sat with trackNumber=-1 until random
          // drift nudged it across a cell boundary. Always set path when empty.
          let pathGoal = { cx: wp.cx, cy: wp.cy };
          if (!this.map.inBounds(wp.cx, wp.cy) && !entity.stats.isAircraft) {
            const bx = this.map.boundsX, by = this.map.boundsY;
            const bw = this.map.boundsW, bh = this.map.boundsH;
            pathGoal = {
              cx: Math.max(bx, Math.min(bx + bw - 1, wp.cx)),
              cy: Math.max(by, Math.min(by + bh - 1, wp.cy)),
            };
          }

          if (alreadyDrivingQueued) {
            // Drive-in-GUARD path: trust the queue but still seed Path[] if missing
            // so DriveClass::AI can actually follow Basic_Path (C++ drive.cpp AI()
            // reads from Path each tick). Without this the vehicle is stuck driving
            // to a NavCom it can't reach via track movement.
            if (entity.path.length === 0) {
              entity.path = findPath(
                this.map, entity.cell, pathGoal,
                // Team MOVE seeds DriveClass::AI's Basic_Path; don't ignore
                // stationary blockers or the later Start_Of_Move cadence shifts.
                /*ignoreOccupancy=*/ false,
                entity.isNavalUnit, entity.stats.speedClass,
                id => this.isEntityMovingBlockerFor(entity, id),
                undefined, undefined, entity.stats.isInfantry,
              );
              entity.pathIndex = 0;
            }
            break;
          }

          // C++ team.cpp Coordinate_Move → Assign_Mission(MISSION_MOVE) → Commence()
          // pops queue, sets Timer=0 (mission.cpp:354). Without the Timer reset, the
          // Mission_Move handler won't fire Random_Pick(0,2) jitter for ~14 ticks,
          // diverging from WASM which fires within 1-2 ticks of the MOVE assignment.
          // SCG11EA tick 3: USSR 4TNK blok-team MOVE — WASM fires tag 60010 at tick 3,
          // TS missed it entirely without this reset.
          entity.mission = Mission.MOVE;
          entity.moveTarget = target;
          entity.target = null;
          entity.missionTimer = 0;

          entity.path = findPath(
            this.map, entity.cell, pathGoal,
            // Team MOVE seeds DriveClass::AI's Basic_Path; don't ignore
            // stationary blockers or the later Start_Of_Move cadence shifts.
            /*ignoreOccupancy=*/ false,
            entity.isNavalUnit, entity.stats.speedClass,
            id => this.isEntityMovingBlockerFor(entity, id),
            undefined, undefined, entity.stats.isInfantry,
          );
          entity.pathIndex = 0;
        }
        break;
      }

      case Game.TMISSION_ATTACK:
      case Game.TMISSION_ATT_WAYPT: {
        // C++ team.cpp Coordinate_Attack: assigns the waypoint cell as a
        // coordinate target to each member, then MISSION_ATTACK. The unit's
        // Mission_Attack handles target acquisition naturally — it engages
        // enemies WITHIN WEAPON RANGE while moving toward the cell, not via
        // an aggressive sight-range pre-scan. Previously TS picked the nearest
        // player unit within sight*2 OR 15 cells of waypoint, causing teams
        // (e.g. SCG08EA YAK reinforcements) to deviate ~30 cells off-path to
        // chase player units they could see but couldn't yet hit, instead of
        // flying past them to the waypoint as in WASM.
        if (entity.mission === Mission.ATTACK && entity.target?.alive) return;

        const wp = this.waypoints.get(tm.data);
        // Pre-scan only for units already in weapon range (the units that
        // would be auto-engaged during the move anyway). Use the larger of
        // the two weapon ranges for dual-weapon units.
        const weapon1Range = entity.weapon?.range ?? 0;
        const weapon2Range = entity.weapon2?.range ?? 0;
        const scanRange = Math.max(weapon1Range, weapon2Range);

        let nearest: Entity | null = null;
        let nearestDist = Infinity;
        if (scanRange > 0) {
          for (const other of this.entities) {
            if (!other.alive || !other.isPlayerUnit) continue;
            const dist = worldDist(entity.pos, other.pos);
            if (dist > scanRange) continue;
            if (dist < nearestDist) {
              nearestDist = dist;
              nearest = other;
            }
          }
        }

        if (nearest) {
          entity.mission = Mission.ATTACK;
          entity.target = nearest;
        } else if (wp) {
          // No targets — move toward the waypoint
          const target = this.teamMissionWaypointTarget(entity, wp);
          if (worldDist(entity.pos, leptonPosToWorld(target)) > 3) {
            // C++ Commence() Timer=0 reset on Assign_Mission(MOVE).
            if (entity.mission !== Mission.MOVE) entity.missionTimer = 0;
            entity.mission = Mission.MOVE;
            entity.moveTarget = target;
            entity.path = findPath(this.map, entity.cell, { cx: wp.cx, cy: wp.cy }, true, entity.isNavalUnit, entity.stats.speedClass);
            entity.pathIndex = 0;
          } else {
            // At waypoint with no targets — advance
            entity.teamMissionIndex++;
          }
        } else {
          entity.teamMissionIndex++;
        }
        break;
      }

      case Game.TMISSION_GUARD: {
        // Guard area for a duration — data is in 1/10th minute units
        // Uses AREA_GUARD so units defend their position but return when enemies flee
        // (RA "Sticky" behavior — bridge guard ants don't chase indefinitely)
        if (entity.teamMissionWaiting === 0) {
          entity.teamMissionWaiting = tm.data * TIME_UNIT_TICKS;
          entity.mission = Mission.AREA_GUARD;
          entity.guardOrigin = { x: entity.pos.x, y: entity.pos.y };
        }
        // This runs every 8 ticks (AI scan rate), so decrement by 8
        entity.teamMissionWaiting -= 8;
        // Reset to AREA_GUARD if entity switched to ATTACK from an auto-engage
        if (entity.mission === Mission.GUARD) {
          entity.mission = Mission.AREA_GUARD;
        }
        if (entity.teamMissionWaiting <= 0) {
          entity.teamMissionWaiting = 0;
          entity.teamMissionIndex++;
        }
        break;
      }

      case Game.TMISSION_LOOP: {
        // Jump to mission index specified by data (C++ team.cpp:2869 — CurrentMission = Data.Value-1 + IsNextMission)
        entity.teamMissionIndex = tm.data;
        entity.teamMissionWaiting = 0;
        break;
      }

      case Game.TMISSION_DO: {
        // Assign mission to entity (C++ team.cpp:1809 Coordinate_Do — "Do guard, sticky, area guard")
        // tm.data is C++ MissionType enum index
        const doMission = Game.CPP_MISSION_MAP[tm.data];
        if (doMission) {
          entity.mission = doMission;
          entity.target = null;
          entity.moveTarget = null;
        }
        entity.teamMissionIndex++;
        break;
      }

      case Game.TMISSION_SET_GLOBAL: {
        // Set a global variable (C++ team.cpp:2919 TMission_Set_Global)
        this.globals.add(tm.data);
        // C++ parity (#38): immediately spring triggers dependent on this global
        this.springGlobalTriggers(tm.data);
        entity.teamMissionIndex++;
        break;
      }

      case Game.TMISSION_UNLOAD: {
        // Aircraft transports must land before unloading (C++ AircraftClass::Mission_Unload)
        // The Chinook flies in from the edge, reaches the origin WP, then naturally lands.
        // Don't interfere with the flight — just wait for 'landed' state before unloading.
        if (entity.stats.isAircraft && entity.aircraftState !== 'landed') {
          return; // wait for landing to complete — don't advance teamMissionIndex
        }
        if (entity.isNavalUnit) {
          // C++ TeamClass::TMission_Unload only tells transports to enter
          // MISSION_UNLOAD; VesselClass::Mission_Unload performs the actual
          // one-passenger detach cadence. Do not run the old TS bulk/random
          // shore placement shim for LSTs here.
          if (entity.passengers.length > 0) {
            entity.doorOpen = entity.type === UnitType.V_LST ? true : entity.doorOpen;
            if (entity.type === UnitType.V_LST) entity.doorTimer = 60;
            if (entity.mission !== Mission.UNLOAD) {
              entity.mission = Mission.UNLOAD;
              entity.missionTimer = 0;
              entity.vesselUnloadStatus = 0;
            }
            return;
          }
          entity.teamMissionIndex++;
          break;
        }
        // Unload passengers at current position
        if (entity.passengers.length > 0) {
          // LST door animation on unload
          if (entity.type === UnitType.V_LST) {
            entity.doorOpen = true;
            entity.doorTimer = 60;
          }
          // For naval units, find shore cells to unload onto
          const isNaval = entity.isNavalUnit;
          const shoreCells: Array<{ x: number; y: number; dist: number }> = [];

          if (isNaval) {
            // Search 3-cell radius for shore cells (passable land adjacent to water)
            const ec = entity.cell;
            for (let dy = -3; dy <= 3; dy++) {
              for (let dx = -3; dx <= 3; dx++) {
                const cx = ec.cx + dx;
                const cy = ec.cy + dy;
                if (!this.map.isPassable(cx, cy)) continue;
                if (this.map.isShoreCell(cx, cy)) {
                  const wx = cx * CELL_SIZE + CELL_SIZE / 2;
                  const wy = cy * CELL_SIZE + CELL_SIZE / 2;
                  const dist = Math.sqrt(dx * dx + dy * dy);
                  shoreCells.push({ x: wx, y: wy, dist });
                }
              }
            }
            shoreCells.sort((a, b) => a.dist - b.dist);
          }

          let shoreIdx = 0;
          // C++ cargo.cpp:87-123: LIFO order — last loaded is unloaded first
          for (let pi = entity.passengers.length - 1; pi >= 0; pi--) {
            const passenger = entity.passengers[pi];
            passenger.alive = true;
            // C++ parity: preserve passenger HP through transport — do NOT reset to maxHp.
            // C++ cargo.cpp does not heal passengers on unload.
            passenger.transportRef = null;
            passenger.isTethered = passenger.stats.isInfantry;
            passenger.deathTick = 0;

            let px: number, py: number;
            if (isNaval && shoreCells.length > 0) {
              // Place on shore cells, cycling through available ones
              const shore = shoreCells[shoreIdx % shoreCells.length];
              px = shore.x + (ScenarioRandom.float() - 0.5) * CELL_SIZE * 0.5;
              py = shore.y + (ScenarioRandom.float() - 0.5) * CELL_SIZE * 0.5;
              shoreIdx++;
            } else {
              // Non-naval: random placement near transport (existing behavior)
              px = entity.pos.x;
              py = entity.pos.y;
              for (let attempt = 0; attempt < 8; attempt++) {
                const ox = entity.pos.x + (ScenarioRandom.float() - 0.5) * CELL_SIZE * 2;
                const oy = entity.pos.y + (ScenarioRandom.float() - 0.5) * CELL_SIZE * 2;
                const tc = worldToCell(ox, oy);
                if (this.map.isPassable(tc.cx, tc.cy)) {
                  px = ox; py = oy;
                  break;
                }
              }
            }

            passenger.pos = { x: px, y: py };
            passenger.flightAltitude = 0; // ensure ground units aren't airborne after unload
            passenger.mission = Mission.GUARD;
            passenger.animState = AnimState.IDLE;
            passenger.animFrame = 0;
            passenger.teamMissionIndex = entity.teamMissionIndex + 1;
            this.entities.push(passenger);
            this.entityById.set(passenger.id, passenger);
          }
          entity.passengers = [];
          this.audio.play('eva_reinforcements');

          // C++ aircraft.cpp:1178-1179, Enter_Idle_Mode (1932-1948):
          // After unloading all passengers, loaner transports get MISSION_RETREAT.
          // This causes the aircraft to take off and fly off the nearest map edge.
          if (entity.isALoaner) {
            entity.mission = Mission.RETREAT;
            entity.teamMissions = []; // clear team script so it doesn't override retreat
            entity.teamMissionIndex = 0;
            // Clear old moveTarget (was the unload waypoint) so updateRetreat
            // computes a fresh map edge target instead of "retreating" 1 cell.
            entity.moveTarget = null;
            entity.path = [];
            entity.pathIndex = 0;
            break;
          }
        }
        entity.teamMissionIndex++;
        break;
      }

      case Game.TMISSION_DEPLOY: {
        // C++ team.cpp: TMission_Deploy sets MCV/minelayer to unload at the current location.
        if (entity.type === UnitType.V_MCV) {
          if (entity.mission === Mission.UNLOAD) {
            entity.teamMissionIndex++;
          } else {
            entity.target = null;
            entity.targetStructure = null;
            entity.moveTarget = null;
            entity.mcvUnloadStatus = 0;
            assignMission(entity, Mission.UNLOAD);
          }
          break;
        }

        if (entity.type === UnitType.V_MNLY) {
          if (entity.ammo === 0) {
            entity.teamMissionIndex++;
            break;
          }

          const structureHere = this.findStructureAt(entity.pos);
          const mineHere = this.mines.some(m => m.cx === entity.cell.cx && m.cy === entity.cell.cy);
          if (entity.mission === Mission.UNLOAD) {
            break;
          }
          if (!structureHere && !mineHere) {
            // C++ TeamClass::TMission_Deploy assigns MISSION_UNLOAD to
            // minelayers at their current cell. It does not assign a NavCom
            // or move the unit; UnitClass::Mission_Unload performs the mine
            // deployment state machine.
            entity.target = null;
            entity.targetStructure = null;
            entity.moveTarget = null;
            entity.mission = Mission.UNLOAD;
            entity.missionTimer = 0;
            // The team mission remains active until the unit has returned to
            // GUARD after Mission_Unload.
            break;
          }
          entity.teamMissionIndex++;
          break;
        }

        if (entity.type === UnitType.V_QTNK) {
          if (!entity.isDeployed) {
            this.deployMADTank(entity);
          }
          entity.teamMissionIndex++;
          break;
        }

        entity.teamMissionIndex++;
        break;
      }

      case Game.TMISSION_LOAD: {
        // Load nearby infantry into this transport
        if (entity.isTransport) {
          const maxLoad = entity.maxPassengers;
          for (const other of this.entities) {
            if (entity.passengers.length >= maxLoad) break;
            if (!other.alive || !other.stats.isInfantry) continue;
            if (other.house !== entity.house) continue;
            if (other.transportRef) continue;
            const d = worldDist(entity.pos, other.pos);
            if (d < 3) { // within 3 cells
              entity.passengers.push(other);
              other.transportRef = entity;
              other.isTethered = false;
              // Defer removal from entity list (same as player-initiated load)
              this._pendingTransportLoads.push(other.id);
            }
          }
        }
        entity.teamMissionIndex++;
        break;
      }

      case Game.TMISSION_INVULNERABLE: {
        // Idle at current position — data is in 1/10th minute units (0 = skip immediately)
        if (tm.data === 0) { entity.teamMissionIndex++; break; }
        if (entity.teamMissionWaiting === 0) {
          entity.teamMissionWaiting = tm.data * TIME_UNIT_TICKS;
          entity.animState = AnimState.IDLE;
        }
        entity.teamMissionWaiting -= 8;
        if (entity.teamMissionWaiting <= 0) {
          entity.teamMissionWaiting = 0;
          entity.teamMissionIndex++;
        }
        break;
      }

      case Game.TMISSION_PATROL: {
        // Patrol to waypoint — same as move but attack enemies en route
        const wp = this.waypoints.get(tm.data);
        if (!wp) { entity.teamMissionIndex++; return; }
        const target = this.teamMissionWaypointTarget(entity, wp);
        // Check for enemies nearby while patrolling
        if (entity.mission !== Mission.ATTACK) {
          let nearest: Entity | null = null;
          let nearDist = entity.stats.sight;
          for (const other of this.entities) {
            if (!other.alive || other.isAnt === entity.isAnt) continue;
            if (this.entitiesAllied(other, entity)) continue;
            const d = worldDist(entity.pos, other.pos);
            if (d < nearDist) { nearDist = d; nearest = other; }
          }
          if (nearest) {
            entity.mission = Mission.ATTACK;
            entity.target = nearest;
            return;
          }
        }
        if (worldDist(entity.pos, leptonPosToWorld(target)) < 2) {
          entity.teamMissionIndex++;
        } else if (entity.mission !== Mission.MOVE || !entity.moveTarget) {
          // C++ Commence() Timer=0 reset on mission change.
          if (entity.mission !== Mission.MOVE) entity.missionTimer = 0;
          entity.mission = Mission.MOVE;
          entity.moveTarget = target;
          entity.path = findPath(this.map, entity.cell, { cx: wp.cx, cy: wp.cy }, true, entity.isNavalUnit, entity.stats.speedClass);
          entity.pathIndex = 0;
        }
        break;
      }

      case Game.TMISSION_SPY: {
        // C++ team.cpp: TMission_Spy treats the waypoint as the building cell to infiltrate.
        // If there is no building at that waypoint, the mission degenerates into a move.
        const wp = this.waypoints.get(tm.data);
        if (!wp) {
          entity.teamMissionIndex++;
          return;
        }

        if (entity.targetStructure?.alive && entity.mission === Mission.CAPTURE) {
          return;
        }

        const structure = this.findSpyMissionTarget(entity, wp.cx, wp.cy);
        if (structure) {
          const [sw, sh] = STRUCTURE_SIZE[structure.type] ?? [2, 2];
          entity.mission = Mission.CAPTURE;
          entity.target = null;
          entity.targetStructure = structure;
          entity.moveTarget = {
            lx: structure.cx * 256 + (sw * 256) / 2,
            ly: structure.cy * 256 + (sh * 256) / 2,
          };
          entity.path = findPath(
            this.map,
            entity.cell,
            { cx: structure.cx, cy: structure.cy },
            true,
            entity.isNavalUnit,
            entity.stats.speedClass,
          );
          entity.pathIndex = 0;
          return;
        }

        const target = this.teamMissionWaypointTarget(entity, wp);
        if (worldDist(entity.pos, leptonPosToWorld(target)) < 2) {
          entity.teamMissionIndex++;
        } else if (entity.mission !== Mission.MOVE || !entity.moveTarget) {
          // C++ Commence() Timer=0 reset on mission change.
          if (entity.mission !== Mission.MOVE) entity.missionTimer = 0;
          entity.mission = Mission.MOVE;
          entity.target = null;
          entity.targetStructure = null;
          entity.moveTarget = target;
          entity.path = findPath(this.map, entity.cell, { cx: wp.cx, cy: wp.cy }, true, entity.isNavalUnit, entity.stats.speedClass);
          entity.pathIndex = 0;
        }
        break;
      }

      case Game.TMISSION_HOUND_DOG: {
        // Hound Dog: move to waypoint then guard (C++ team.cpp TMission_Hound_Dog)
        // Used by Einstein and other VIP escorts — move to rally point then hold position
        const wp = this.waypoints.get(tm.data);
        if (!wp) { entity.teamMissionIndex++; return; }
        const target = this.teamMissionWaypointTarget(entity, wp);

        if (worldDist(entity.pos, leptonPosToWorld(target)) < 2) {
          // Arrived — switch to guard mode and complete mission
          entity.mission = Mission.GUARD;
          entity.moveTarget = null;
          entity.teamMissionIndex++;
        } else if (entity.mission !== Mission.MOVE || !entity.moveTarget) {
          // C++ Commence() Timer=0 reset on mission change.
          if (entity.mission !== Mission.MOVE) entity.missionTimer = 0;
          entity.mission = Mission.MOVE;
          entity.moveTarget = target;
          entity.target = null;
          entity.path = findPath(this.map, entity.cell, { cx: wp.cx, cy: wp.cy }, true, entity.isNavalUnit, entity.stats.speedClass);
          entity.pathIndex = 0;
        }
        break;
      }

      default:
        // Unknown mission type — skip
        entity.teamMissionIndex++;
        break;
    }
  }

  private findSpyMissionTarget(entity: Entity, cx: number, cy: number): MapStructure | null {
    let match: MapStructure | null = null;
    let bestDist = Infinity;

    for (const structure of this.structures) {
      if (!structure.alive || this.isAllied(structure.house, entity.house)) continue;
      const [sw, sh] = STRUCTURE_SIZE[structure.type] ?? [2, 2];
      const inSpyBox = (
        cx >= structure.cx - 1 &&
        cx <= structure.cx + sw &&
        cy >= structure.cy - 1 &&
        cy <= structure.cy + sh
      );
      if (!inSpyBox) continue;

      const centerX = structure.cx + sw / 2;
      const centerY = structure.cy + sh / 2;
      const dist = Math.hypot(centerX - cx, centerY - cy);
      if (dist < bestDist) {
        bestDist = dist;
        match = structure;
      }
    }

    return match;
  }

  /** Add a flashing alert on the minimap at a cell position */
  private minimapAlert(cx: number, cy: number): void {
    this.renderer.minimapAlerts.push({ cx, cy, tick: Date.now() });
  }

  /** Vehicle crush — heavy tracked vehicles (crusher=true) instantly kill crushable units on cell entry.
   *  C++ DriveClass::Ok_To_Move (drive.cpp): when a Crusher vehicle enters a cell with a Crushable unit,
   *  the crushable unit dies instantly. Only crusher vehicles crush; only crushable targets are affected.
   *  Infantry and ants are crushable; vehicles are not. The crusher does NOT stop — it drives through.
   *  C++ checks IsAFriend() — friendly/allied infantry are NOT crushed. */
  /** Vehicle crush — delegates to combat.ts */
  private checkVehicleCrush(vehicle: Entity): void {
    this._runCombat(ctx => _checkVehicleCrush(ctx, vehicle));
  }

  /** Wall crush — delegates to combat.ts
   *  C++ unit.cpp:1855-1871: crusher vehicles destroy crushable walls on cell entry */
  private checkWallCrush(vehicle: Entity): void {
    this._runCombat(ctx => _checkWallCrush(ctx, vehicle));
  }

  /** Ant AI — hunt nearest visible player unit (fog-aware, LOS-aware) */
  private updateAntAI(entity: Entity): void {
    if (entity.mission === Mission.ATTACK && entity.target?.alive) return;

    // Wave coordination: wait for rally delay before engaging
    if (entity.waveId > 0 && this.tick < entity.waveRallyTick) {
      // During rally, cluster toward other wave members
      let waveCX = 0, waveCY = 0, waveCount = 0;
      for (const other of this.entities) {
        if (other.alive && other.waveId === entity.waveId) {
          waveCX += other.pos.x;
          waveCY += other.pos.y;
          waveCount++;
        }
      }
      if (waveCount > 1) {
        waveCX /= waveCount;
        waveCY /= waveCount;
        const dist = worldDist(entity.pos, { x: waveCX, y: waveCY });
        if (dist > 2) {
          entity.animState = AnimState.WALK;
          entity.moveToward({ lx: pixelToLepton(waveCX), ly: pixelToLepton(waveCY) }, this.movementSpeed(entity));
          return;
        }
      }
      entity.animState = AnimState.IDLE;
      return;
    }

    // If a wave-mate found a target, share it
    if (entity.waveId > 0 && !entity.target?.alive) {
      for (const other of this.entities) {
        if (other.alive && other.waveId === entity.waveId &&
            other.id !== entity.id && other.target?.alive) {
          entity.mission = Mission.HUNT;
          entity.target = other.target;
          return;
        }
      }
    }

    let nearest: Entity | null = null;
    let nearestDist = Infinity;
    const ec = entity.cell;

    for (const other of this.entities) {
      if (!other.alive || !other.isPlayerUnit) continue;
      const dist = worldDist(entity.pos, other.pos);
      // Fog-aware: ants can only see units within their sight range
      if (dist > entity.stats.sight * 1.5) continue;
      // LOS check: can't see through walls
      const oc = other.cell;
      if (!this.map.hasLineOfSight(ec.cx, ec.cy, oc.cx, oc.cy)) continue;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = other;
      }
    }

    if (nearest) {
      entity.mission = Mission.HUNT;
      entity.target = nearest;
      return;
    }

    // No units in sight — target nearest player structure (prefer defensive)
    let bestStruct: MapStructure | null = null;
    let bestStructDist = Infinity;
    let bestIsDefense = false;
    for (const s of this.structures) {
      if (!s.alive) continue;
      if (!this.isAllied(s.house, this.playerHouse)) continue;
      const sPos = { x: s.cx * CELL_SIZE + CELL_SIZE, y: s.cy * CELL_SIZE + CELL_SIZE };
      const dist = worldDist(entity.pos, sPos);
      if (dist > entity.stats.sight * 2) continue;
      const isDef = ANT_TARGET_DEFENSE_TYPES.has(s.type);
      // Prefer defensive structures over other buildings
      if (isDef && !bestIsDefense) {
        bestStruct = s; bestStructDist = dist; bestIsDefense = true;
      } else if (isDef === bestIsDefense && dist < bestStructDist) {
        bestStruct = s; bestStructDist = dist; bestIsDefense = isDef;
      }
    }
    if (bestStruct) {
      entity.mission = Mission.ATTACK;
      entity.target = null;
      entity.targetStructure = bestStruct;
    }
  }

  /** C++ UnitClass::Scatter(0, true) — no-threat forced scatter.
   *  Used by UnitClass::Enter_Idle_Mode when IsToScatter was set by LST
   *  unload. UnitClass overrides the zero-threat branch and uses
   *  Map.Nearby_Location; it does not consume the Scenario RNG. */
  private unitClassScatterNoThreat(entity: Entity, nokidding = false): void {
    if (entity.mission === Mission.SLEEP ||
        entity.mission === Mission.STICKY ||
        entity.mission === Mission.UNLOAD) return;
    if (MISSION_CONTROL[entity.mission]?.isParalyzed) return;
    // C++ UnitClass::Scatter returns while PrimaryFacing is rotating.
    if (entity.bodyFacing256 >= 0 &&
        entity.desiredFacing256 >= 0 &&
        entity.bodyFacing256 !== entity.desiredFacing256) return;
    if (entity.moveTarget && !nokidding) return;

    const cell = nearbyLocation(
      this.map,
      entity.cell,
      entity.isNavalUnit,
      Math.max(0, this.tick - 1),
    );
    if (cell) {
      entity.moveTarget = cellTargetToLepton(cell.cx, cell.cy);
      resetPathThreshold(entity);
      this.startDriveClassMove(entity);
    }
  }

  /** C++ CellClass::Incoming(0, true, true) for DriveClass MOVE_TEMP blockers.
   *  Called by DriveClass::Start_Of_Move when a friendly temporary blocker is
   *  in the next cell. The blocker scatters without changing mission; the
   *  movement order is stored as NavCom and DriveClass::AI advances it later. */
  private incomingNoThreatScatterCell(cx: number, cy: number, requesterId = 0): void {
    for (const blocker of this.entities) {
      if (blocker.id === requesterId || !blocker.alive || blocker.inLimbo) continue;
      if (blocker.isAirUnit && blocker.flightAltitude > 0) continue;
      if (blocker.cell.cx !== cx || blocker.cell.cy !== cy) continue;

      if (!blocker.stats.isInfantry && !blocker.isAirUnit) {
        this.unitClassScatterNoThreat(blocker, true);
      }
    }
  }

  /** C++ class Enter_Idle_Mode side effects + selected idle mission. */
  private enterIdleMode(entity: Entity): Mission {
    if (!entity.stats.isInfantry && !entity.isAirUnit && !entity.isNavalUnit && entity.isToScatter) {
      entity.isToScatter = false;
      this.unitClassScatterNoThreat(entity);
      if (entity.moveTarget) return Mission.MOVE;
    }
    return this.idleMission(entity);
  }

  /** Get the C++ default idle mission for an entity class. */
  private idleMission(entity: Entity): Mission {
    const houseIQ = this.houseIQs.get(entity.house) ?? (entity.house === this.playerHouse ? 0 : 3);
    const hasTeam = entity.teamRef != null;
    const isHumanHouse = entity.house === this.playerHouse;

    if (entity.stats.isInfantry) {
      // C++ InfantryClass::Enter_Idle_Mode: human/team infantry idle to GUARD.
      // AI dogs area-guard regardless of IQ; other armed infantry need IQGuardArea.
      if (isHumanHouse || hasTeam) return Mission.GUARD;
      if (entity.type === UnitType.I_DOG) return Mission.AREA_GUARD;
      return houseIQ >= IQ_GUARD_AREA && (entity.weapon != null || entity.weapon2 != null)
        ? Mission.AREA_GUARD
        : Mission.GUARD;
    }

    if (entity.isNavalUnit) {
      // C++ VesselClass::Enter_Idle_Mode: human/team or unarmed vessels idle to GUARD;
      // AI armed vessels need IQGuardArea for MISSION_GUARD_AREA.
      if (isHumanHouse || hasTeam || entity.weapon == null) return Mission.GUARD;
      return houseIQ >= IQ_GUARD_AREA ? Mission.AREA_GUARD : Mission.GUARD;
    }

    if (!entity.isAirUnit) {
      // C++ UnitClass::Enter_Idle_Mode: unarmed/team land vehicles idle to GUARD;
      // otherwise IQGuardArea selects AREA_GUARD. Scenario guardOrigin is only
      // a TS return-point marker and must not force AREA_GUARD on player units.
      if (hasTeam || entity.weapon == null) return Mission.GUARD;
      return houseIQ >= IQ_GUARD_AREA ? Mission.AREA_GUARD : Mission.GUARD;
    }

    return entity.guardOrigin ? Mission.AREA_GUARD : Mission.GUARD;
  }

  private aiHarvesterShouldEnterHarvest(entity: Entity): boolean {
    if (entity.type !== UnitType.V_HARV) return false;
    if (entity.house === this.playerHouse) return false;
    return this.structures.some(s =>
      s.alive &&
      s.house === entity.house &&
      s.type === 'PROC');
  }

  /** C++ InfantryClass::Enter_Idle_Mode mission selection.
   *  Unlike the class default idle mission above, infantry with a legal TarCom
   *  queues ATTACK first; infantry with legal NavCom queues MOVE before falling
   *  back to GUARD/AREA_GUARD (infantry.cpp:1663-1720). */
  private infantryEnterIdleMission(entity: Entity): Mission {
    if (entity.target?.alive || entity.targetStructure?.alive) {
      return Mission.ATTACK;
    }
    if (entity.moveTarget) {
      if (entity.mission === Mission.CAPTURE || entity.mission === Mission.SABOTAGE) {
        return entity.mission;
      }
      return Mission.MOVE;
    }
    return this.idleMission(entity);
  }

  /** C++ RadioClass In_Radio_Contact for transport unloads. */
  private hasTransportRadioContact(transport: Entity): boolean {
    return this.entities.some(e =>
      e.alive &&
      !e.inLimbo &&
      e.transportRef === transport &&
      e.isTethered);
  }

  /** C++ VesselClass::Assign_Destination transport radio side effect.
   *
   * vessel.cpp:1866-1869: if a passenger transport is in radio contact with an
   * infantry/unit passenger when the vessel receives a new NavCom, it sends
   * RADIO_MOVE_HERE(TARGET_NONE) followed by RADIO_OVER_OUT. FootClass handles
   * RADIO_MOVE_HERE by Assign_Destination(TARGET_NONE) and
   * Shorten_Mission_Timer() when NavCom changed (foot.cpp:1700-1710).
   *
   * Important parity detail: Assign_Destination(TARGET_NONE) clears NavCom and
   * resets PathThreshhold only; it does not clear Path[] or stop the active
   * driver. The passenger keeps rolling off the ramp, but its next
   * MissionClass::AI pass sees Timer==0 and runs Mission_Move immediately.
   */
  private abortTransportRadioContactForNewDestination(transport: Entity): void {
    if (!transport.stats.isVessel || !transport.isTransport) return;
    let anyContact = false;
    for (const passenger of this.entities) {
      if (!passenger.alive || passenger.inLimbo) continue;
      if (passenger.transportRef !== transport || !passenger.isTethered) continue;
      if (passenger.isAirUnit) continue;

      anyContact = true;
      if (passenger.moveTarget !== null) {
        if ((passenger.mission as Mission) === Mission.GUARD && passenger.missionQueue === null) {
          passenger.missionQueue = Mission.MOVE;
        }
        passenger.moveTarget = null;
        resetPathThreshold(passenger);
        passenger.missionTimer = 0;
      }

      // RADIO_OVER_OUT cuts the two-way contact after the move-here message.
      passenger.isTethered = false;
      passenger.transportRef = null;
    }
    if (anyContact) {
      transport.isTethered = false;
      if (!transport.isAirUnit) {
        transport.doorOpen = false;
        transport.doorOpeningTicks = 0;
      }
    }
  }

  /** C++ UnitClass/InfantryClass::Per_Cell_Process tether exit branch.
   *  The first PCP_END after a passenger leaves a transport or infantry leaves
   *  a factory sends RADIO_UNLOADED, cutting the two-way radio tether.
   *  Infantry additionally plays the unload gesture (infantry.cpp:878-906).
   */
  private cutTransportTether(entity: Entity): void {
    if (!entity.isTethered) return;
    const transport = entity.transportRef;
    entity.isTethered = false;
    entity.transportRef = null;
    if (transport && !this.hasTransportRadioContact(transport)) {
      transport.isTethered = false;
    }
    if (entity.stats.isInfantry) {
      entity.startTransportUnloadGesture(this.tick);
    }
  }

  private cutInfantryTransportTether(entity: Entity): void {
    if (!entity.stats.isInfantry) return;
    this.cutTransportTether(entity);
  }

  /** C++ `unit.cpp:1657-1664` Case B — PCP_END RADIO_IM_IN ground transport
   *  boarding. Invoked from `perCellNavComCheck` via the
   *  `tryBoardTransport` callback supplied to `unitPerCellProcess`.
   *
   *  Mirrors:
   *    if (Mission == MISSION_ENTER && techno && Coord_Cell(Coord) ==
   *        Coord_Cell(techno->Coord) && techno == As_Techno(NavCom)) {
   *      if (Transmit_Message(RADIO_IM_IN) == RADIO_ATTACH) {
   *        Limbo();
   *        techno->Attach(this);
   *      }
   *      return; // early — short-circuits remaining PCP_END work
   *    }
   *
   *  Receiver replies:
   *    unit.cpp:761-766 (APC), vessel.cpp:1388-1400 (LST) — RADIO_IM_IN
   *    returns RADIO_ATTACH when capacity remains. When full it falls
   *    through to base-class handling (defaults to RADIO_STATIC), so
   *    `Limbo()+Attach` does NOT run. C++ still issues the early return.
   *
   *  Returns `'boarded'` when the unit was attached + limbo'd (caller stops
   *  further PCP_END work this tick), `'no_match'` when no eligible transport
   *  was found at the unit's cell. */
  private tryPCPBoardTransport(entity: Entity): 'boarded' | 'no_match' {
    if ((entity.mission as Mission) !== Mission.ENTER) return 'no_match';
    if (!entity.alive || entity.inLimbo) return 'no_match';
    if (!entity.moveTarget) return 'no_match';

    // C++ As_Techno(NavCom): the transport's cell must equal NavCom's cell.
    const navCellX = Math.floor(entity.moveTarget.lx / LEPTON_SIZE);
    const navCellY = Math.floor(entity.moveTarget.ly / LEPTON_SIZE);

    // C++ Coord_Cell(Coord) == Coord_Cell(techno->Coord): the entity must
    // share a cell with the transport. The unit's cell is its current
    // single-cell coordinate (updated by track-step before PCP_END fires).
    const ex = entity.cell.cx;
    const ey = entity.cell.cy;

    // Find a transport at the entity's cell that is also at the NavCom cell.
    // Iterate this.entities — the array is short (hundreds at most) and this
    // path fires only when a unit completes a cell-crossing track. Filter on
    // isTransport first to keep the hot path cheap.
    for (const other of this.entities) {
      if (!other.alive || other.inLimbo || other === entity) continue;
      if (!other.isTransport) continue;
      // C++ ground transport class check: APC and LST. Aircraft/harvester
      // docking has separate Per_Cell paths (aircraft.cpp / mission_harvest).
      if (other.isAirUnit) continue;
      if (other.cell.cx !== ex || other.cell.cy !== ey) continue;
      if (other.cell.cx !== navCellX || other.cell.cy !== navCellY) continue;
      // C++ House->Is_Ally(from->Owner()) check inside RADIO_CAN_LOAD/IM_IN.
      if (!this.isAllied(other.house, entity.house)) continue;

      // RADIO_IM_IN reply: RADIO_ATTACH when capacity remains; otherwise
      // base-class default (no Attach). C++ still issues the early return
      // either way (unit.cpp:1663-1664 — `return` is OUTSIDE the if-attach
      // block).
      const willAttach = other.passengers.length < other.maxPassengers;
      if (willAttach) {
        // C++ Attach (cargo.cpp:87-123): push passenger, set transportRef.
        other.passengers.push(entity);
        entity.transportRef = other;
        entity.isTethered = false;
        entity.selected = false;
        this.selectedIds.delete(entity.id);
        // LST visual door animation on load (vessel.cpp DoorShutCountDown).
        if (other.type === UnitType.V_LST) {
          other.doorOpen = true;
          other.doorTimer = 60;
        }
        // C++ Limbo(): remove from active list + clear cell occupancy.
        // Mirror the existing transport-load deferral (line 6273-6316 path
        // uses `_pendingTransportLoads`) so end-of-tick cleanup is uniform.
        entity.mission = Mission.SLEEP;
        this.map.setOccupancy(entity.cell.cx, entity.cell.cy, 0);
        if (entity.stats.isInfantry) {
          this.map.vacateSubCell(entity.cell.cx, entity.cell.cy, entity.id);
        }
        this._pendingTransportLoads.push(entity.id);
        // C++ ground APC/LST does NOT auto-evacuate when civilian boards —
        // that branch is aircraft-only (aircraft.cpp:2749-2761). Mirror the
        // existing line 6307-6311 civilian-aircraft hook only if a future
        // aircraft RADIO_IM_IN port reuses this code path.
      }
      // C++ unit.cpp:1663 — `return;` after the if block, regardless of
      // whether Attach actually fired. The reply may be RADIO_STATIC (full),
      // but the unit still short-circuits the rest of PCP_END.
      return 'boarded';
    }
    return 'no_match';
  }

  /** C++ `unit.cpp:1635-1651` Case A — PCP_END RADIO_IM_IN building entry
   *  refusal. Invoked from `perCellNavComCheck` via the
   *  `tryBuildingEntryScatter` callback supplied to `unitPerCellProcess`.
   *
   *  Mirrors:
   *    TechnoClass * whom = Contact_With_Whom();
   *    if (IsTethered && whom != NULL) {
   *      if (whom->What_Am_I() == RTTI_BUILDING && Mission == MISSION_ENTER) {
   *        if (whom == Map[CELL(cell-MAP_CELL_W)].Cell_Building()) {
   *          switch (Transmit_Message(RADIO_IM_IN, whom)) {
   *            case RADIO_ROGER: break;
   *            case RADIO_ATTACH: break;
   *            default: Scatter(0, true); break;
   *          }
   *        }
   *      }
   *    }
   *
   *  TS adaptation:
   *    - TS does not model peer-to-peer `Contact_With_Whom()`. We approximate
   *      "the building this vehicle is trying to enter is one cell north" by
   *      looking up `findStructureAtCell(cx, cy-1)` directly. The C++ guard
   *      `whom == Map[cell-MAP_CELL_W].Cell_Building()` collapses to "a
   *      building footprint occupies (cx, cy-1)".
   *    - The only building that returns a non-ROGER/non-ATTACH reply to a
   *      vehicle in MISSION_ENTER is the service depot (`FIX`). PROC docking
   *      is harvester-specific (handled by `_updateHarvester`) and never
   *      reaches Case A's `cell-north` predicate because the harvester
   *      enters from the south-center dock cell. FIX is the only structure
   *      whose RADIO_IM_IN can return RADIO_NEGATIVE.
   *    - "Depot would refuse" condition: another player-controlled vehicle is
   *      already docked at this FIX (within the same 0x10 lepton distance
   *      that `tickServiceDepot` uses to pick a dock occupant — see
   *      repairSell.ts:280). C++ `BuildingClass::Receive_Message` returns
   *      RADIO_NEGATIVE when the depot already has a tethered customer.
   *    - On refusal, call `unitClassScatterNoThreat(entity, nokidding=false)`
   *      which is the existing TS analog of C++ `UnitClass::Scatter(0, true)`.
   *      C++ Scatter gates on `Target_Legal(NavCom) && !nokidding` (unit.cpp:4895),
   *      so the move-target reassignment only fires when NavCom is illegal
   *      (e.g. previously cleared). Under standard Case A timing, NavCom is
   *      still legal — the call records the path but does not reassign
   *      moveTarget. The TS helper mirrors that exact behavior.
   *
   *  Returns:
   *    - `'scattered'` — the Case A refusal branch fired (C++ default switch).
   *                      The Scatter call may have reassigned moveTarget
   *                      (NavCom illegal case) or short-circuited internally
   *                      (NavCom legal case — standard PCP_END timing).
   *                      PCP_END continues normally; the caller does not need
   *                      to short-circuit because C++ Scatter returns control
   *                      to PCP_END.
   *    - `'no_match'`  — Case A condition not met (wrong mission, no building
   *                      one cell north, building accepts the dock). PCP_END
   *                      continues normally. */
  private tryPCPBuildingEntryScatter(entity: Entity): 'scattered' | 'no_match' {
    // C++ unit.cpp:1636: `Mission == MISSION_ENTER` (the outer if's inner guard).
    if ((entity.mission as Mission) !== Mission.ENTER) return 'no_match';
    if (!entity.alive || entity.inLimbo) return 'no_match';
    // Aircraft / infantry / vessel do not exercise this UnitClass branch — it
    // lives in `UnitClass::Per_Cell_Process`, which only runs for ground vehicles.
    if (entity.stats.isInfantry || entity.isAirUnit || entity.isNavalUnit) return 'no_match';

    // C++ `Map[CELL(cell-MAP_CELL_W)].Cell_Building()`: the cell directly north
    // of the vehicle's current cell. `MAP_CELL_W` is the row stride; in (cx,cy)
    // form this is simply (cx, cy-1).
    const northCx = entity.cell.cx;
    const northCy = entity.cell.cy - 1;
    if (northCy < 0) return 'no_match';
    const whom = this.findStructureAtCell(northCx, northCy);
    if (!whom) return 'no_match';

    // C++ ports of the RADIO_IM_IN reply: the service depot is the only TS
    // structure whose reply branches on busy-ness. PROC (refinery) has its
    // own harvester flow that does not reach this PCP_END check because the
    // harvester drives onto the south dock cell of PROC, not under it.
    if (whom.type !== 'FIX') return 'no_match';
    // C++ `BuildingClass::Receive_Message(RADIO_IM_IN, from)` rejects when
    // the source's owner is not allied with the building owner.
    if (!this.isAllied(whom.house, entity.house)) return 'no_match';

    // C++ depot busy check: does another player-controlled vehicle already
    // occupy this FIX's dock spot? Mirror `tickServiceDepot` (repairSell.ts:268-283)
    // dock distance (0x10 leptons = 0.0625 cells from depot center+(CELL,CELL)).
    const sx = whom.cx * CELL_SIZE + CELL_SIZE;
    const sy = whom.cy * CELL_SIZE + CELL_SIZE;
    let occupied = false;
    for (const other of this.entities) {
      if (other === entity) continue;
      if (!other.alive || other.inLimbo) continue;
      if (other.stats.isInfantry || other.isAirUnit || other.isNavalUnit) continue;
      if (!this.isAllied(other.house, whom.house)) continue;
      const dx = other.pos.x - sx;
      const dy = other.pos.y - sy;
      // 0.0625 cells = 0.0625 * CELL_SIZE pixels.
      if (dx * dx + dy * dy < (0.0625 * CELL_SIZE) * (0.0625 * CELL_SIZE)) {
        occupied = true;
        break;
      }
    }
    if (!occupied) {
      // C++ `case RADIO_ROGER: break;` — depot accepts the dock. No scatter,
      // PCP_END continues normally and the existing dock/repair flow runs.
      return 'no_match';
    }

    // C++ unit.cpp:1646 `default: Scatter(0, true);` — forced=true,
    // nokidding=false (default). The TS analog is
    // `unitClassScatterNoThreat(entity, nokidding=false)`.
    //
    // Behavioral note (C++ unit.cpp:4895):
    //   if (Target_Legal(NavCom) && !nokidding) return;
    // Case A fires BEFORE `DriveClass::Per_Cell_Process` clears NavCom
    // (drive.cpp:869-873), so the vehicle's NavCom is still legal when
    // Scatter is invoked. With nokidding=false, C++ Scatter returns early
    // without reassigning the destination. The TS helper mirrors that exact
    // behavior — the side effect is observable only when NavCom is NOT
    // legal (e.g. a downstream sub-case cleared it first, or NavCom was
    // never legal in the first place). Tests assert the helper's return
    // value rather than the moveTarget side effect for the standard case.
    this.unitClassScatterNoThreat(entity, /*nokidding=*/ false);
    return 'scattered';
  }

  private isEntityMovingBlockerFor(mover: Entity, entityId: number): boolean {
    const occupant = this.entityById.get(entityId);
    return !!occupant?.alive &&
      this.entitiesAllied(mover, occupant) &&
      (occupant.isDriving || occupant.trackNumber > 0 || occupant.moveTarget !== null);
  }

  /** C++ InfantryClass::Can_Enter_Cell (infantry.cpp:1266-1524).
   *  Infantry can share allied infantry sub-cells while space remains, but
   *  non-allied infantry are not shareable: armed infantry see them as
   *  MOVE_DESTROYABLE. This entity-aware check is required by Basic_Path and
   *  Start_Driver validation; the map-only helper can only answer whether any
   *  sub-cell is physically open. */
  private infantryCanEnterCell(entity: Entity, cx: number, cy: number, _facing = -1): MoveResult {
    const mapMove = this.map.canEnterCell(
      cx,
      cy,
      entity.isNavalUnit,
      id => this.isEntityMovingBlockerFor(entity, id),
      true,
      entity.id,
    );
    if (mapMove === MoveResult.IMPASSABLE || mapMove === MoveResult.CLOAK) return mapMove;

    const hasWeapon = (entity.weapon?.damage ?? 0) > 0 || (entity.weapon2?.damage ?? 0) > 0;
    let result = MoveResult.OK;

    for (const other of this.entities) {
      if (other.id === entity.id || !other.alive || other.inLimbo) continue;
      if (other.isAirUnit && other.flightAltitude > 0) continue;
      if (other.cell.cx !== cx || other.cell.cy !== cy) continue;

      if (this.entitiesAllied(entity, other)) {
        if (other.stats.isInfantry) continue;
        if (other.isAirUnit) return MoveResult.IMPASSABLE;
        const moving = other.isDriving || other.trackNumber > 0 || other.moveTarget !== null;
        result = Math.max(result, moving ? MoveResult.OCCUPIED : MoveResult.TEMP_BLOCKED);
      } else {
        if (!hasWeapon) return MoveResult.IMPASSABLE;
        if (other.stats.isInfantry && other.type === UnitType.I_SPY && !entity.stats.isCanine) {
          result = Math.max(result, MoveResult.TEMP_BLOCKED);
        } else {
          result = Math.max(result, MoveResult.DESTROYABLE);
        }
      }
    }

    const slots = this.map.subCellOccupancy.get(cy * MAP_CELLS + cx);
    if (slots) {
      let filled = 0;
      for (const occupantId of slots) {
        if (occupantId === 0 || occupantId === entity.id) continue;
        filled++;
        const occupant = this.entityById.get(occupantId);
        if (!occupant?.alive) continue;
        if (!this.entitiesAllied(entity, occupant)) {
          if (!hasWeapon) return MoveResult.IMPASSABLE;
          if (occupant.stats.isInfantry && occupant.type === UnitType.I_SPY && !entity.stats.isCanine) {
            result = Math.max(result, MoveResult.TEMP_BLOCKED);
          } else {
            result = Math.max(result, MoveResult.DESTROYABLE);
          }
        }
      }
      if (filled >= 5) result = Math.max(result, MoveResult.OCCUPIED);
    } else if (mapMove > MoveResult.OK) {
      result = Math.max(result, mapMove);
    }

    return result;
  }

  private basicPathGoalMoveResult(entity: Entity, goal: CellPos): MoveResult {
    if (!entity.stats.isInfantry && !entity.isAirUnit) {
      return this.canEnterTrackJumpCell(entity, goal.cx, goal.cy);
    }

    const mapMove = this.map.canEnterCell(
      goal.cx,
      goal.cy,
      entity.isNavalUnit,
      id => this.isEntityMovingBlockerFor(entity, id),
      false,
      entity.id,
    );
    if (mapMove <= MoveResult.CLOAK) return mapMove;
    if (!entity.stats.isInfantry) return mapMove;

    // C++ InfantryClass::Can_Enter_Cell allows allied infantry sharing a cell
    // while sub-cells remain free; enemy infantry remains MOVE_DESTROYABLE.
    let sawNonShareableObject = false;
    let sawEnemyObject = false;
    for (const other of this.entities) {
      if (other.id === entity.id || !other.alive || other.inLimbo) continue;
      if (other.isAirUnit && other.flightAltitude > 0) continue;
      if (other.cell.cx !== goal.cx || other.cell.cy !== goal.cy) continue;
      if (this.entitiesAllied(entity, other) && other.stats.isInfantry) continue;
      sawNonShareableObject = true;
      if (!this.entitiesAllied(entity, other)) sawEnemyObject = true;
    }
    if (!sawNonShareableObject && this.map.hasAvailableSubCell(goal.cx, goal.cy)) {
      return MoveResult.OK;
    }
    if (sawEnemyObject && ((entity.weapon?.damage ?? 0) > 0 || (entity.weapon2?.damage ?? 0) > 0)) {
      return MoveResult.DESTROYABLE;
    }
    return mapMove;
  }

  /** C++ FootClass::Basic_Path lines 323-335: keep NavCom unchanged, but
   * aim Find_Path at a nearby legal cell when NavCom's cell is blocked and the
   * unit is farther than close-enough/stray distance. */
  private resolveBasicPathGoal(entity: Entity, goal: CellPos): CellPos {
    if (!entity.moveTarget) return goal;
    if (this.basicPathGoalMoveResult(entity, goal) <= MoveResult.CLOAK) return goal;

    const dist = leptonDist(entity.leptonX, entity.leptonY, entity.moveTarget.lx, entity.moveTarget.ly);
    const checkdist = entity.teamRef ? 0x0200 : 0x0280; // rules.cpp defaults: Stray/CloseEnough
    if (dist <= checkdist) return goal;

    const nearby = nearbyLocation(this.map, goal, entity.isNavalUnit, Math.max(0, this.tick - 1));
    if (!nearby) return goal;
    const goalLX = goal.cx * LEPTON_SIZE + (LEPTON_SIZE >> 1);
    const goalLY = goal.cy * LEPTON_SIZE + (LEPTON_SIZE >> 1);
    const nearbyLX = nearby.cx * LEPTON_SIZE + (LEPTON_SIZE >> 1);
    const nearbyLY = nearby.cy * LEPTON_SIZE + (LEPTON_SIZE >> 1);
    return leptonDist(goalLX, goalLY, nearbyLX, nearbyLY) < dist ? nearby : goal;
  }

  /** C++ FootClass::Basic_Path threshold escalation (foot.cpp:381-423).
   * Starts at PathThreshhold and retries with higher MoveType tolerance until
   * a path is found or maxtype is exceeded. */
  private findDriveClassBasicPath(entity: Entity, pathGoal: CellPos): CellPos[] {
    const maxtype = pathMaxType(entity, this.isPlayerControlled(entity));
    for (;;) {
      const newPath = findPath(
        this.map,
        entity.cell,
        pathGoal,
        // C++ Basic_Path calls Can_Enter_Cell; stationary friendly blockers
        // are MOVE_TEMP (not pathable until threshold escalation reaches it),
        // moving blockers are MOVE_MOVING_BLOCK.
        false,
        entity.isNavalUnit,
        entity.stats.speedClass,
        id => this.isEntityMovingBlockerFor(entity, id),
        undefined,
        undefined,
        entity.stats.isInfantry,
        entity.pathThreshold as MoveResult,
        entity.stats.isInfantry
          ? (cx, cy, facing) => this.infantryCanEnterCell(entity, cx, cy, facing)
          : (cx, cy) => this.canEnterTrackJumpCell(entity, cx, cy),
      );
      if (newPath.length > 0) {
        entity.pathThreshold = MOVE_CLOAK;
        entity.tryCount = PATH_RETRY;
        return newPath;
      }
      entity.pathThreshold++;
      if (entity.pathThreshold > maxtype) break;
    }
    return [];
  }

  /** C++ DriveClass::Start_Of_Move -> FootClass::Basic_Path.
   *
   * Used by DriveClass::AI's second-cycle path regeneration when a track
   * completed with legal NavCom but empty Path[]. The top-of-AI Basic_Path
   * branch handles the same state before the first cycle; this helper keeps the
   * re-entry path on the same C++ rules without tick-specific state edits.
   */
  private tryRegenerateDriveClassBasicPath(entity: Entity, mission: Mission): boolean {
    if (!entity.moveTarget || entity.pathDelay > 0) return false;

    const destCell = {
      cx: Math.floor(entity.moveTarget.lx / LEPTON_SIZE),
      cy: Math.floor(entity.moveTarget.ly / LEPTON_SIZE),
    };

    if (destCell.cx === entity.cell.cx && destCell.cy === entity.cell.cy) {
      entity.moveTarget = null;
      this.clearDrivePath(entity);
      return false;
    }

    const pathGoal = this.resolveBasicPathGoal(entity, destCell);
    const newPath = this.findDriveClassBasicPath(entity, pathGoal);
    // C++ FootClass::Basic_Path sets PathDelay after every path calculation,
    // including same-tick DriveClass::AI re-entry after a track completes.
    entity.pathDelay = PATH_DELAY_TICKS;

    if (newPath.length === 0) {
      const dxL = entity.moveTarget.lx - entity.leptonX;
      const dyL = entity.moveTarget.ly - entity.leptonY;
      const adx = Math.abs(dxL), ady = Math.abs(dyL);
      const octDist = adx > ady ? adx + (ady >> 1) : ady + (adx >> 1);
      const missionEligible = mission === Mission.MOVE || mission === Mission.AREA_GUARD;

      if (octDist < 704 && missionEligible) {
        this.assignDriveDestinationNone(entity);
      }
      return false;
    }

    this.setDrivePath(entity, newPath);
    return true;
  }

  private resolveInfantryBasicPathGoal(entity: Entity, goal: CellPos): CellPos {
    return this.resolveBasicPathGoal(entity, goal);
  }

  /**
   * C++ DriveClass::Start_Of_Move consumes a FacingType Path[0], not an
   * absolute-cell cursor. After TS finishes or track-jumps into a cell, the
   * absolute path can still have the just-entered cell at or after pathIndex.
   * Normalize that representation before selecting the next track so
   * Start_Of_Move sees the same next facing C++ would see after its Path[]
   * memmove.
   */
  private skipDrivePathCurrentCell(entity: Entity): boolean {
    if (entity.stats.isInfantry || entity.isAirUnit) return false;
    if (!usesTrackMovement(entity.stats.speedClass, !!entity.stats.isInfantry, !!entity.stats.isAircraft)) return false;
    if (entity.trackNumber > 0) return false;

    let advanced = false;
    for (let i = entity.pathIndex; i < entity.path.length; i++) {
      const cell = entity.path[i];
      if (cell.cx !== entity.cell.cx || cell.cy !== entity.cell.cy) break;
      entity.pathIndex = i + 1;
      advanced = true;
      break;
    }
    if (!advanced) {
      for (let i = entity.pathIndex; i < entity.path.length; i++) {
        const cell = entity.path[i];
        if (cell.cx === entity.cell.cx && cell.cy === entity.cell.cy) {
          entity.pathIndex = i + 1;
          advanced = true;
          break;
        }
      }
    }

    if (advanced && entity.pathIndex >= entity.path.length) {
      entity.path = [];
      entity.pathIndex = 0;
    }
    return advanced;
  }

  /**
   * C++ InfantryClass::Movement_AI consumes FacingType Path[0] with
   * Adjacent_Cell(Coord, Path[0]) (infantry.cpp:3919). A valid C++ path entry
   * therefore always targets an adjacent cell, never the infantry's current
   * cell. TS stores absolute cells, so after a Head_To_Coord hop completes the
   * next absolute cell can be the current cell until pathIndex is normalized.
   * Skipping it prevents a fabricated Start_Driver-to-current-cell hop.
   */
  private skipInfantryPathCurrentCell(entity: Entity): boolean {
    if (!entity.stats.isInfantry || entity.isDriving) return false;

    let advanced = false;
    while (entity.path.length > 0 &&
           entity.pathIndex < entity.path.length &&
           entity.path[entity.pathIndex]?.cx === entity.cell.cx &&
           entity.path[entity.pathIndex]?.cy === entity.cell.cy) {
      entity.pathIndex++;
      advanced = true;
    }

    if (advanced && entity.pathIndex >= entity.path.length) {
      entity.path = [];
      entity.pathIndex = 0;
    }
    return advanced;
  }

  /** C++ InfantryClass::Movement_AI cached-path shorten (infantry.cpp:3843).
   *  Before Start_Driver, C++ truncates FootClass::Path[] at
   *  Lepton_To_Cell(Distance(NavCom)). This lets infantry repath from a closer
   *  cell instead of blindly consuming stale long-route commands. */
  private shortenInfantryPathToNavComDistance(entity: Entity): void {
    if (!entity.stats.isInfantry || entity.isDriving || !entity.moveTarget) return;
    if (entity.path.length === 0 || entity.pathIndex >= entity.path.length) return;

    const distance = leptonDist(entity.leptonX, entity.leptonY, entity.moveTarget.lx, entity.moveTarget.ly);
    const cells = Math.floor((distance + (LEPTON_SIZE >> 1)) / LEPTON_SIZE);
    if (cells >= Game.CONQUER_PATH_MAX) return;

    const newLength = entity.pathIndex + cells;
    if (newLength <= entity.pathIndex) {
      this.clearDrivePath(entity);
    } else if (newLength < entity.path.length) {
      entity.path = entity.path.slice(0, newLength);
    }
  }

  private setInfantryBasicPath(entity: Entity, path: CellPos[]): void {
    this.setDrivePath(entity, path);
    // C++ writes a FACING_NONE sentinel at the rounded NavCom distance before
    // Start_Driver. TS has no interior sentinel representation, so keep only
    // the effective prefix of the newly materialized Basic_Path.
    this.shortenInfantryPathToNavComDistance(entity);
  }

  private isDriveClassPathEntity(entity: Entity): boolean {
    return !entity.stats.isInfantry &&
      !entity.isAirUnit &&
      usesTrackMovement(entity.stats.speedClass, false, false);
  }

  private shouldCapDrivePathToCxxBuffer(entity: Entity): boolean {
    return entity.stats.isInfantry || this.isDriveClassPathEntity(entity);
  }

  // C++ defines.h:2828 / foot.h:223 — FootClass::Path[CONQUER_PATH_MAX].
  // Basic_Path may find a longer route in its work buffer, but only the first
  // 12 FacingType commands are copied into the unit. FootClass regenerates the
  // next chunk when this buffer empties while NavCom remains legal. This applies
  // to infantry as well as DriveClass ground vehicles; SCG04EA USSR E1 851975
  // exhausts the buffer at tick 476 and C++ repaths toward the moving target.
  private static readonly CONQUER_PATH_MAX = 12;

  private deriveDrivePathFacings(start: CellPos, path: CellPos[]): number[] {
    const facings: number[] = [];
    let from = start;
    for (const cell of path) {
      facings.push(directionTo(
        { x: from.cx * CELL_SIZE + CELL_SIZE / 2, y: from.cy * CELL_SIZE + CELL_SIZE / 2 },
        { x: cell.cx * CELL_SIZE + CELL_SIZE / 2, y: cell.cy * CELL_SIZE + CELL_SIZE / 2 },
      ));
      from = cell;
    }
    return facings;
  }

  private drivePathCellsFromFacings(start: CellPos, facings: number[]): CellPos[] {
    const cells: CellPos[] = [];
    let cx = start.cx;
    let cy = start.cy;
    for (const facing of facings) {
      if (facing < 0 || facing >= DIR_DX.length) break;
      cx += DIR_DX[facing];
      cy += DIR_DY[facing];
      cells.push({ cx, cy });
    }
    return cells;
  }

  private setDrivePath(entity: Entity, path: CellPos[]): void {
    entity.path = this.shouldCapDrivePathToCxxBuffer(entity)
      ? path.slice(0, Game.CONQUER_PATH_MAX)
      : path;
    entity.pathIndex = 0;
    entity.drivePathFacings = this.isDriveClassPathEntity(entity)
      ? this.deriveDrivePathFacings(entity.cell, entity.path)
      : [];
  }

  private clearDrivePath(entity: Entity): void {
    entity.path = [];
    entity.pathIndex = 0;
    entity.drivePathFacings = [];
  }

  /** C++ DriveClass::Assign_Destination(TARGET_NONE).
   *  The virtual DriveClass method clears Path[0] and, when the unit is not
   *  currently driving, immediately re-enters Start_Of_Move(). That top guard
   *  queues Enter_Idle_Mode for MISSION_MOVE. */
  private assignDriveDestinationNone(entity: Entity): void {
    entity.moveTarget = null;
    this.clearDrivePath(entity);
    resetPathThreshold(entity);
    if (!entity.stats.isInfantry &&
        !entity.isAirUnit &&
        !entity.isDriving &&
        (entity.mission as Mission) === Mission.MOVE) {
      assignMission(entity, this.enterIdleMode(entity));
    }
  }

  private consumeDrivePathFacings(entity: Entity, count: number): void {
    if (count <= 0 || entity.drivePathFacings.length === 0) return;
    entity.drivePathFacings.splice(0, count);
  }

  /** C++ DriveClass::Mark_Track(MARK_UP): release this unit's reserved vehicle bits. */
  private clearDriveTrackReservations(entity: Entity): void {
    for (const cellIdx of entity.trackReservationCells) {
      this.map.clearVehicleTrackReservation(cellIdx, entity.id);
    }
    entity.trackReservationCells = [];
  }

  private reserveDriveTrackCell(entity: Entity, cellIdx: number): void {
    if (cellIdx < 0 || cellIdx >= MAP_CELLS * MAP_CELLS) return;
    if (!entity.trackReservationCells.includes(cellIdx)) {
      entity.trackReservationCells.push(cellIdx);
    }
    this.map.setVehicleTrackReservation(cellIdx, entity.id);
  }

  /** C++ DriveClass::Mark_Track(MARK_DOWN): reserve head-to and unpassed midpoint. */
  private markDriveTrack(entity: Entity, headToLX: number, headToLY: number): void {
    if (headToLX <= 0 || headToLY <= 0) return;

    const headCellIdx = ((headToLY >> 8) & 0x7F) * MAP_CELLS + ((headToLX >> 8) & 0x7F);

    if (entity.trackNumber > 0) {
      const raw = RAW_TRACKS[entity.trackNumber - 1];
      const track = getTrackArray(entity.trackNumber);
      if (raw && track && raw.cell > -1 && entity.trackIndex < raw.cell) {
        const step = track[raw.cell];
        if (step) {
          const mid = smoothTurn(step.x, step.y, step.facing, entity.trackFlags);
          const midLX = headToLX + mid.x;
          const midLY = headToLY + mid.y;
          const midCellIdx = ((midLY >> 8) & 0x7F) * MAP_CELLS + ((midLX >> 8) & 0x7F);
          this.reserveDriveTrackCell(entity, midCellIdx);
        }
      }
    }

    this.reserveDriveTrackCell(entity, headCellIdx);
  }

  /** C++ UnitClass/VesselClass::Start_Driver wrapper around FootClass::Start_Driver + Mark_Track. */
  private startDriveTrack(entity: Entity, headToLX: number, headToLY: number): boolean {
    this.stopDriveTrack(entity);
    if (headToLX <= 0 || headToLY <= 0) return false;
    entity.headToLX = headToLX;
    entity.headToLY = headToLY;
    entity.isDriving = true;
    this.markDriveTrack(entity, headToLX, headToLY);
    return true;
  }

  /** C++ DriveClass::Stop_Driver: unmark reserved track bits, clear HeadToCoord/IsDriving. */
  private stopDriveTrack(entity: Entity): void {
    this.clearDriveTrackReservations(entity);
    entity.headToLX = 0;
    entity.headToLY = 0;
    if (!entity.stats.isInfantry) entity.isDriving = false;
  }

  private canEnterTrackJumpCell(entity: Entity, cx: number, cy: number): MoveResult {
    const authorizedBuildingEnter = this.isAuthorizedBuildingEnterCell(entity, cx, cy);
    const authorizedFactoryTether = this.isAuthorizedFactoryTetherCell(entity, cx, cy);
    const move = this.map.canEnterCell(
      cx,
      cy,
      entity.isNavalUnit,
      id => this.isEntityMovingBlockerFor(entity, id),
      false,
      entity.id,
    );
    if ((move === MoveResult.IMPASSABLE || move === MoveResult.CLOAK) &&
        !authorizedBuildingEnter &&
        !authorizedFactoryTether) return move;

    const reservationOwner = this.map.getVehicleTrackReservation(cx, cy);
    // C++ UnitClass::Can_Enter_Cell ignores `obj == this` only while walking
    // the physical Cell_Occupier chain. The later cell flag check at
    // unit.cpp:3268-3274 treats Flag.Occupy.Vehicle as MOVE_MOVING_BLOCK
    // without an owner/self exception. Mark_Track stores DriveClass
    // reservations in that same vehicle occupancy flag, so a self-reserved
    // destination cell still blocks Start_Of_Move/track-jump entry.
    if (reservationOwner > 0) {
      return MoveResult.OCCUPIED;
    }

    // C++ VesselClass::Can_Enter_Cell is occupancy-flag based: vehicle
    // occupancy in water returns MOVE_MOVING_BLOCK, never MOVE_TEMP. The land
    // UnitClass physical occupier scan below is what distinguishes stationary
    // friendly blockers as MOVE_TEMP.
    if (entity.isNavalUnit) return move;

    // C++ UnitClass::Can_Enter_Cell first walks the physical Cell_Occupier()
    // chain, then separately checks occupy/reservation bits. TS infantry
    // claims live in the destination sub-cell grid while their physical cell
    // can still block a drive-class track jump this tick.
    let sawCrushableOnly = false;
    const occupantId = this.map.getOccupancy(cx, cy);
    if (occupantId > 0 && occupantId !== entity.id) {
      const occupant = this.entityById.get(occupantId);
      if (occupant?.alive) {
        const physicalOccupier = occupant.cell.cx === cx && occupant.cell.cy === cy;
        if (occupant.stats.isInfantry && !physicalOccupier) {
          // C++ UnitClass::Can_Enter_Cell walks Cell_Occupier() for physical
          // objects in this cell, then checks cell flag bits. TS getOccupancy()
          // is also fed by infantry sub-cell claims; a moving infantry can claim
          // a sub-cell in the target cell while its physical Cell_Occupier cell is
          // still adjacent. C++ only lets crushers ignore enemy infantry reserve
          // bits; non-crushers still see MOVE_DESTROYABLE/NO from the cell flags.
          if (!this.entitiesAllied(entity, occupant) && entity.stats.crusher) {
            sawCrushableOnly = true;
          }
        } else
        if (this.entitiesAllied(entity, occupant)) {
          return (occupant.isDriving || occupant.trackNumber > 0 || occupant.moveTarget !== null)
            ? MoveResult.OCCUPIED
            : MoveResult.TEMP_BLOCKED;
        }
        else if (entity.stats.crusher && occupant.stats.isInfantry) {
          // C++ unit.cpp:3281-3294: enemy infantry occupy/reserve bits do not
          // block crusher vehicles. The infantry can be present only in the
          // sub-cell occupation flags here, not as the physical Cell_Occupier().
          sawCrushableOnly = true;
        } else {
          return MoveResult.DESTROYABLE;
        }
      }
    }
    for (const other of this.entities) {
      if (other.id === entity.id || !other.alive || other.inLimbo) continue;
      if (other.isAirUnit && other.flightAltitude > 0) continue;
      if (other.cell.cx !== cx || other.cell.cy !== cy) continue;
      if (this.entitiesAllied(entity, other)) {
        return (other.isDriving || other.trackNumber > 0 || other.moveTarget !== null)
          ? MoveResult.OCCUPIED
          : MoveResult.TEMP_BLOCKED;
      }
      if (entity.stats.crusher && other.stats.isInfantry) {
        // C++ UnitClass::Can_Enter_Cell allows crusher vehicles to enter
        // infantry-occupied cells; the crush is handled by Per_Cell_Process /
        // Overrun_Square, not by rejecting the track jump.
        sawCrushableOnly = true;
        continue;
      }
      return MoveResult.DESTROYABLE;
    }

    return move === MoveResult.OK || authorizedBuildingEnter || authorizedFactoryTether || sawCrushableOnly
      ? MoveResult.OK
      : move;
  }

  /** C++ DriveClass::Assign_Destination -> Start_Of_Move without While_Moving.
   *
   * TeamClass coordinate routines call Assign_Destination during Team AI, before
   * the unit's own AI pass. C++ immediately clears Path[0] and calls
   * Start_Of_Move: this either requests Do_Turn() or selects/reserves a real
   * track via Start_Driver. The actual While_Moving budget is spent later in
   * DriveClass::AI for the same object tick.
   */
  private startDriveClassMove(entity: Entity): void {
    if (entity.stats.isInfantry || entity.isAirUnit || !entity.moveTarget) return;

    const destCell = {
      cx: Math.floor(entity.moveTarget.lx / LEPTON_SIZE),
      cy: Math.floor(entity.moveTarget.ly / LEPTON_SIZE),
    };

    // DriveClass::Assign_Destination line 641: Path[0] = FACING_NONE.
    // This happens even while IsDriving. The active TrackNumber and
    // Head_To_Coord remain alive; only the queued path is invalidated so
    // While_Moving cannot track-jump from stale Path[0].
    this.clearDrivePath(entity);

    if (entity.isDriving || entity.mission === Mission.UNLOAD) {
      entity.pathThreshold = MOVE_CLOAK;
      return;
    }

    entity.trackNumber = -1;
    entity.trackControlIndex = -1;
    entity.trackCellSpan = 1;

    // C++ DriveClass::Assign_Destination immediately calls Start_Of_Move(),
    // but Start_Of_Move refuses to call Basic_Path while FootClass::PathDelay
    // is active (drive.cpp:969). Keep Path[0] invalid and let DriveClass::AI
    // retry after the timer expires.
    if (entity.pathDelay > 0) return;

    const pathGoal = this.resolveBasicPathGoal(entity, destCell);
    const newPath = this.findDriveClassBasicPath(entity, pathGoal);
    // C++ FootClass::Basic_Path sets PathDelay after every path calculation,
    // successful or not (foot.cpp:475). Assign_Destination reaches Basic_Path
    // through Start_Of_Move.
    entity.pathDelay = PATH_DELAY_TICKS;

    if (newPath.length === 0) {
      const dxL = entity.moveTarget.lx - entity.leptonX;
      const dyL = entity.moveTarget.ly - entity.leptonY;
      const adx = Math.abs(dxL), ady = Math.abs(dyL);
      const octDist = adx > ady ? adx + (ady >> 1) : ady + (adx >> 1);
      if (octDist < 704 && (entity.mission === Mission.MOVE || entity.mission === Mission.AREA_GUARD)) {
        this.assignDriveDestinationNone(entity);
      }
      return;
    }

    this.setDrivePath(entity, newPath);
    entity.pathThreshold = MOVE_CLOAK;
    entity.tryCount = PATH_RETRY;

    const nextCell = entity.path[0];
    const nextTarget: WorldPos = {
      x: nextCell.cx * CELL_SIZE + CELL_SIZE / 2,
      y: nextCell.cy * CELL_SIZE + CELL_SIZE / 2,
    };
    // C++ DriveClass::Start_Of_Move selects `facing` from Path[0]
    // (drive.cpp:1038-1084), i.e. the cell-to-cell path direction. Do
    // not derive it from the current lepton position: after a curve the
    // vehicle/vessel can be slightly off the row/column and pixel geometry
    // would choose NE/SE where C++ still uses E/W from Path[0].
    const nextFacing8 = directionTo({
      x: entity.cell.cx * CELL_SIZE + CELL_SIZE / 2,
      y: entity.cell.cy * CELL_SIZE + CELL_SIZE / 2,
    }, nextTarget);
    if (entity.bodyFacing256 < 0) entity.bodyFacing256 = (entity.facing * 32) & 0xff;
    if (entity.bodyFacing256 !== ((nextFacing8 * 32) & 0xff)) {
      // drive.cpp:1098-1105 Do_Turn(dir): request rotation only.
      entity.desiredFacing = nextFacing8;
      entity.desiredFacing256 = (nextFacing8 * 32) & 0xff;
      return;
    }
    entity.desiredFacing = nextFacing8;
    entity.desiredFacing256 = (nextFacing8 * 32) & 0xff;

    const entryMove = this.canEnterTrackJumpCell(entity, nextCell.cx, nextCell.cy);
    if (entryMove !== MoveResult.OK) {
      this.stopDriveTrack(entity);
      entity.trackNumber = -1;
      entity.trackControlIndex = -1;
      entity.trackCellSpan = 1;
      if (entryMove === MoveResult.TEMP_BLOCKED) {
        this.incomingNoThreatScatterCell(nextCell.cx, nextCell.cy, entity.id);
      }
      // C++ drive.cpp:1109-1116 Start_Of_Move immediate-cell failure:
      // if Can_Enter_Cell(destcell, facing) fails while Mission==MOVE and
      // Distance(NavCom) < Rule.CloseEnoughDistance, Assign_Destination(NONE).
      // DriveClass::Assign_Destination clears Path[0] and, because this path is
      // not driving, immediately re-enters Start_Of_Move. The no-NavCom guard
      // queues Enter_Idle_Mode before UnitClass post-Drive Commence pops it.
      if ((entity.mission as Mission) === Mission.MOVE && entity.moveTarget) {
        const dxL = entity.moveTarget.lx - entity.leptonX;
        const dyL = entity.moveTarget.ly - entity.leptonY;
        const adx = Math.abs(dxL), ady = Math.abs(dyL);
        const octDist = adx > ady ? adx + (ady >> 1) : ady + (adx >> 1);
        const CLOSE_ENOUGH_LEPTONS = 704; // rules.ini CloseEnough=2.75 cells.
        if (octDist < CLOSE_ENOUGH_LEPTONS) {
          this.assignDriveDestinationNone(entity);
          return;
        }
      }
      if (entryMove !== MoveResult.OCCUPIED) {
        entity.path = [];
        entity.pathIndex = 0;
      }
      return;
    }

    let followingFacing8 = nextFacing8;
    const followingCell = entity.path[1];
    if (followingCell) {
      followingFacing8 = directionTo(nextTarget, {
        x: followingCell.cx * CELL_SIZE + CELL_SIZE / 2,
        y: followingCell.cy * CELL_SIZE + CELL_SIZE / 2,
      });
    }

    const ctrl = lookupTrackControl(nextFacing8, followingFacing8);
    // C++ drive.cpp:1207-1221 substitutes `nextface = facing` when Path[1]
    // is FACING_NONE, then still honors TrackControl.F_D by checking the cell
    // one more step beyond `dest`. Do not require an explicit second Path[]
    // entry for a two-cell track; synthesize the implicit straight-ahead cell.
    const longTrackCell = (ctrl.flag & F_D)
      ? (followingCell ?? { cx: nextCell.cx + DIR_DX[followingFacing8], cy: nextCell.cy + DIR_DY[followingFacing8] })
      : null;
    const useLongTrack = !!(ctrl.flag & F_D) && longTrackCell !== null && ctrl.track > 0;
    if (useLongTrack && longTrackCell) {
      // C++ drive.cpp:1217-1250 validates the second cell of an F_D two-cell
      // track before Start_Driver. If blocked, Path[0]=FACING_NONE and no
      // track starts; the next DriveClass::AI pass recomputes Basic_Path.
      const longMove = this.canEnterTrackJumpCell(entity, longTrackCell.cx, longTrackCell.cy);
      if (longMove !== MoveResult.OK) {
        this.stopDriveTrack(entity);
        if (longMove === MoveResult.TEMP_BLOCKED) {
          this.incomingNoThreatScatterCell(longTrackCell.cx, longTrackCell.cy, entity.id);
        }
        entity.path = [];
        entity.pathIndex = 0;
        entity.trackNumber = -1;
        entity.trackControlIndex = -1;
        entity.trackCellSpan = 1;
        return;
      }
    }
    const effectiveTrack = useLongTrack ? ctrl.track : getEffectiveTrack(ctrl);
    if (effectiveTrack <= 0) {
      entity.path = [];
      entity.pathIndex = 0;
      return;
    }

    entity.trackNumber = effectiveTrack;
    entity.trackFlags = ctrl.flag & ~F_D;
    entity.trackIndex = 0;
    entity.trackCellSpan = useLongTrack ? 2 : 1;
    entity.trackControlIndex = nextFacing8 * 8 + followingFacing8;
    entity.speedAccum = 0;
    entity.driveSpeed = this.driveSpeedThrottleRaw(entity, nextCell);

    const trackTarget = useLongTrack
      ? { x: longTrackCell!.cx * CELL_SIZE + CELL_SIZE / 2,
          y: longTrackCell!.cy * CELL_SIZE + CELL_SIZE / 2 }
      : nextTarget;
    this.startDriveTrack(
      entity,
      Math.trunc(trackTarget.x / LP),
      Math.trunc(trackTarget.y / LP),
    );
    this.consumeDrivePathFacings(entity, entity.trackCellSpan);
  }

  /** Move toward move target along path */
  private updateMove(entity: Entity, fromGuardDrive = false, driveClassTrackReentry = false): void {
    // C++ vessel.cpp:592, 658 — vessel transports can't Commence (start moving)
    // until Is_Door_Closed() returns true. LST spawned with cargo has door open
    // and must wait for it to close (~25 ticks). Without this delay, LST reaches
    // unload point ~25 ticks early in TS, breaking SCG09EA et al.
    if (entity.stats.isVessel && entity.isTransport && entity.doorOpen) {
      entity.animState = AnimState.IDLE;
      return;
    }

    const hasInfantryHeadTo =
      entity.stats.isInfantry && entity.isDriving && entity.headToLX > 0 && entity.headToLY > 0;

    // PCP Session 4 — InfantryClass::Movement_AI top-of-handler Enter_Idle_Mode
    // guard. Mirrors C++ infantry.cpp:3786-3788:
    //
    //   if (Mission == MISSION_MOVE && !Target_Legal(NavCom)) Enter_Idle_Mode();
    //
    // True SCG13EA tick-99 first-divergence root cause per
    // `cpp-parity-scg13ea-tick-99-pcp.test.ts`. Gated behind
    // `MOVEMENT_AI_MOVE_NAVCOM_GUARD` (OFF by default) — see the flag
    // docstring in `perCellProcess.ts` for the cascade risk and rollout plan.
    //
    // C++ Enter_Idle_Mode only calls Assign_Mission(order), which writes
    // MissionQueue and leaves Mission unchanged. Since InfantryClass::AI has
    // already passed its Commence gate by the time Movement_AI runs, this queue
    // must NOT pop in the same movement pass. The next legal Commence handles it.
    if (MOVEMENT_AI_MOVE_NAVCOM_GUARD
        && !fromGuardDrive
        && entity.stats.isInfantry
        && (entity.mission as Mission) === Mission.MOVE
        && entity.moveTarget === null) {
      // C++ infantry.cpp:3786-3788 calls Enter_Idle_Mode() unconditionally.
      // That routine uses Assign_Mission(), which overwrites an existing
      // MissionQueue when the selected idle mission differs from current
      // Mission. This matters when a reached MOVE destination left GUARD
      // queued but TarCom is legal: C++ replaces the queue with ATTACK.
      assignMission(entity, this.infantryEnterIdleMission(entity));
      entity.animState = AnimState.IDLE;
      // C++ infantry.cpp:3786-3788 calls Enter_Idle_Mode(), then continues
      // through Movement_AI. If an active Head_To_Coord hop is already in
      // progress, the IsDriving branch still advances it in this same pass.
      // Only stationary/no-path units stop here; otherwise line 6596 would
      // directly mutate Mission to GUARD instead of preserving the queued order.
      if (!hasInfantryHeadTo && entity.path.length === 0) {
        return;
      }
    }

    // C++ InfantryClass::Movement_AI runs the NavCom/Enter_Idle_Mode guard
    // above before this gate, then skips the movement body while a fire
    // animation is active (infantry.cpp:3786-3790).
    if (entity.stats.isInfantry && (entity.firePrepActive || entity.isFiringAnim)) {
      return;
    }

    // C++ drive.cpp:1376 parity: when DriveClass::AI runs in Mission==GUARD
    // (drives-in-guard case), movement completion does NOT change Mission — the
    // unit stays in GUARD until Commence() pops MissionQueue on the next tick
    // (once IsDriving=false from Stop_Driver). setMissionIdle centralizes the
    // suppression so every arrival/abort path in updateMove honors it.
    const setMissionIdle = () => {
      if (!fromGuardDrive) {
        entity.mission = this.enterIdleMode(entity);
      }
    };

    const hasActiveDriveTrackHeadTo =
      !entity.stats.isInfantry &&
      !entity.isAirUnit &&
      usesTrackMovement(entity.stats.speedClass, false, false) &&
      entity.isDriving &&
      entity.trackNumber > 0 &&
      (entity.headToLX !== 0 || entity.headToLY !== 0);

    if (!entity.moveTarget && entity.path.length === 0 && !hasInfantryHeadTo && !hasActiveDriveTrackHeadTo) {
      // C++ DriveClass::AI does not call Enter_Idle_Mode just because a
      // drive-class unit has no NavCom/Path during its movement pass. In the
      // non-driving/no-target branch it only Stop_Driver()s; FootClass::
      // Mission_Move performs Enter_Idle_Mode later when its mission timer
      // fires. This distinction matters for LST-unloaded UnitClass objects:
      // their IsToScatter flag is consumed by UnitClass::Enter_Idle_Mode at
      // mission-dispatch time, not by the generic driver loop.
      if (!entity.stats.isInfantry &&
          !entity.isAirUnit &&
          (entity.mission as Mission) === Mission.MOVE &&
          !fromGuardDrive) {
        entity.animState = AnimState.IDLE;
        return;
      }
      setMissionIdle();
      entity.animState = AnimState.IDLE;
      return;
    }

    // C++ DriveClass::AI → Start_Of_Move → Basic_Path failure (drive.cpp:961-972 +
    // foot.cpp:313-500). When a vehicle has moveTarget but no path, and Basic_Path
    // fails because the direct cell toward the target is blocked by a friendly
    // unit (Can_Enter_Cell returns MOVE_TEMP), C++ at drive.cpp:970 checks:
    //   Distance(NavCom) < Rule.CloseEnoughDistance && Mission == MISSION_MOVE
    // If satisfied, Assign_Destination(TARGET_NONE) — NavCom cleared immediately.
    // Mission_Move on the next tick sees !NavCom && !IsDriving → Enter_Idle_Mode
    // (foot.cpp:524) → Mission=GUARD, no Random_Pick fired.
    //
    // TS's direct-move fallback sub-cell crawls toward the target even when
    // Basic_Path would fail in C++, eventually firing Mission_Move jitter
    // (Random_Pick(0,2)) every ~14 ticks. WASM never fires this RNG because
    // NavCom was cleared before the first timer expiry. SCG11EA tick 19:
    // USSR 4TNK at (60,58) patrol-assigned MOVE to (62,59); friendly 4TNK at
    // (61,59) is the direct-cell blocker.
    //
    // Fix: mirror C++ drive.cpp:970 — when path is empty and the adjacent cell
    // toward the target is occupied by a FRIENDLY unit, AND the target is within
    // CloseEnoughDistance, clear moveTarget (Enter_Idle_Mode equivalent). Flag
    // the entity's blocked target so coordinatePatrol (team.ts) doesn't reset
    // missionTimer=0 on next re-assign — avoids Mission_Move jitter oscillation.
    // W1 deleted (Step 3): sticky patrolBlockedTargetLX/LY close-enough
    // check was a TS-only workaround that suppressed legitimate C++
    // Mission_Move jitter RNG. C++ Coord_Patrol re-assigns MOVE each
    // cycle and Mission_Move fires Random_Pick(0,2) on Commence pop
    // (foot.cpp:535). drive.cpp:1102 close-enough in followTrackStep
    // (below) handles the patrol-blocked-by-friendly close-enough clear
    // reactively, matching C++ exactly.

    entity.animState = AnimState.WALK;

    // No A2 scan here: C++ Mission_Move's `Target_Something_Nearby(THREAT_RANGE)`
    // call at foot.cpp:529-531 is effectively a no-op. Greatest_Threat
    // (techno.cpp:2032-2040) builds its RTTI mask from THREAT_INFANTRY |
    // THREAT_VEHICLES | THREAT_BUILDINGS bits; THREAT_RANGE alone contributes no
    // RTTI bits → mask=0 → Evaluate_Object (techno.cpp:1539) rejects every
    // candidate. In C++ a moving unit only ever *clears* an out-of-range TarCom;
    // it never *assigns* a new target during Mission_Move. Targets come from:
    // explicit orders, team-assigned TarCom, or the unit's GUARD scan
    // (THREAT_AREA|THREAT_RANGE with RTTI bits set). Auto-acquiring here was a
    // TS-only fabrication. (Agent f90c3b68 investigation, 2026-04-20.)

    // Air units fly directly to destination — no pathfinding, no terrain collision
    if (entity.isAirUnit && entity.moveTarget) {
      // Ascend to flight altitude
      if (entity.flightAltitude < Entity.FLIGHT_ALTITUDE) {
        entity.flightAltitude = Math.min(Entity.FLIGHT_ALTITUDE, entity.flightAltitude + 3);
      }
      if (entity.moveToward(entity.moveTarget, this.movementSpeed(entity))) {
        entity.moveTarget = null;
        // C++ foot.cpp:2242-2248: navQueueLoop re-populates queue when exhausted
        if (entity.moveQueue.length === 0 && entity.navQueueLoop && entity.navQueueOriginal.length > 0) {
          for (const wp of entity.navQueueOriginal) {
            entity.queueWaypoint({ lx: wp.lx, ly: wp.ly });
          }
        }
        if (entity.moveQueue.length > 0) {
          const next = entity.moveQueue.shift()!;
          // C++ foot.cpp:2242-2248: re-append consumed waypoint when looping
          if (entity.navQueueLoop) {
            entity.queueWaypoint({ lx: next.lx, ly: next.ly });
          }
          entity.moveTarget = next;
        } else {
          setMissionIdle();
          entity.animState = AnimState.IDLE;
        }
      }
      return;
    }

    if (entity.stats.isInfantry && !entity.isDriving && entity.moveTarget) {
      this.skipInfantryPathCurrentCell(entity);
      this.shortenInfantryPathToNavComDistance(entity);
    }

    if (entity.stats.isInfantry &&
        (entity.path.length === 0 || entity.pathIndex >= entity.path.length) &&
        (entity.moveTarget || hasInfantryHeadTo)) {
      const finishMove = () => {
        entity.moveTarget = null;
        if (entity.moveQueue.length === 0 && entity.navQueueLoop && entity.navQueueOriginal.length > 0) {
          for (const wp of entity.navQueueOriginal) {
            entity.queueWaypoint({ lx: wp.lx, ly: wp.ly });
          }
        }
        if (entity.moveQueue.length > 0) {
          const next = entity.moveQueue.shift()!;
          if (entity.navQueueLoop) {
            entity.queueWaypoint({ lx: next.lx, ly: next.ly });
          }
          entity.moveTarget = next;
          entity.path = findPath(
            this.map,
            entity.cell,
            { cx: Math.floor(next.lx / 256), cy: Math.floor(next.ly / 256) },
            true,
            entity.isNavalUnit,
            entity.stats.speedClass
          );
          entity.pathIndex = 0;
        } else {
          setMissionIdle();
          entity.animState = AnimState.IDLE;
        }
      };

      if ((entity.headToLX <= 0 || entity.headToLY <= 0) && entity.moveTarget) {
        // C++ infantry.cpp:3818-3856 — when NavCom is legal and Path[0] is
        // FACING_NONE, Movement_AI calls Basic_Path(). That includes the case
        // where FootClass's 12-entry Path[] buffer has been exhausted but NavCom
        // remains legal. If a path is found, it immediately Start_Driver()s the
        // first path cell and returns without moving this tick. There is no
        // direct long-range NavCom walk fallback.
        if (entity.pathDelay > 0) return;

        const goal = {
          cx: Math.floor(entity.moveTarget.lx / LEPTON_SIZE),
          cy: Math.floor(entity.moveTarget.ly / LEPTON_SIZE),
        };
        const pathGoal = this.resolveInfantryBasicPathGoal(entity, goal);
        const newPath = this.findDriveClassBasicPath(entity, pathGoal);
        entity.pathDelay = PATH_DELAY_TICKS;

        if (newPath.length > 0) {
          this.setInfantryBasicPath(entity, newPath);
          entity.pathThreshold = MOVE_CLOAK;
          entity.tryCount = PATH_RETRY;
          if (entity.path.length === 0 || entity.pathIndex >= entity.path.length) return;
          const firstCell = entity.path[0];
          const started = this.infantryStartDriver(entity, firstCell.cx, firstCell.cy);
          if (started) {
            entity.isDriving = true;
            entity.doing = 'walk';
          }
        } else {
          // C++ Basic_Path failure path (infantry.cpp:3855-3902): if already
          // close enough to NavCom, clear NavCom; otherwise decrement
          // TryTryAgain and stop the driver for this tick.
          const closeEnough = 704; // rules.ini [General] CloseEnough=2.75 * 256
          if (leptonDist(entity.leptonX, entity.leptonY, entity.moveTarget.lx, entity.moveTarget.ly) < closeEnough) {
            entity.moveTarget = null;
          } else if (entity.tryCount > 0) {
            entity.tryCount--;
          }
          entity.isDriving = false;
          entity.headToLX = 0;
          entity.headToLY = 0;
        }
        return;
      }

      if (entity.headToLX > 0 && entity.headToLY > 0) {
        // C++ InfantryClass::Movement_AI active-driver branch does not cancel
        // an in-progress Head_To_Coord hop just because NavCom was cleared.
        // It advances toward Head_To_Coord until Distance() < 0x10, then
        // Stop_Driver()s; Mission_Move/Commence handle the queued idle mission
        // on a later legal pass. Keeping this hop alive matters for patrol
        // Assign_Mission_Target(TARGET_NONE), which clears NavCom while members
        // are still walking.
        const speed = this.movementSpeed(entity);
        const headTo = { lx: entity.headToLX, ly: entity.headToLY };
        if (entity.moveToward(headTo, speed)) {
          // C++ infantry.cpp:4004-4008: reaching Head_To_Coord always runs
          // Per_Cell_Process(PCP_END) and Stop_Driver(), even when NavCom/path
          // remains legal for another path cell.
          this.stopInfantryDriver(entity);

          // C++ infantry.cpp:3997 calls Per_Cell_Process(PCP_END) whenever
          // an active Head_To_Coord hop completes. That is true even when a
          // prior patrol scan has already cleared NavCom and Path[]; the hop
          // still reaches its sub-cell destination and the queued idle mission
          // must Commence here. SCG13EA dog 852083 hits this path after
          // Assign_Mission_Target(TARGET_NONE) clears NavCom mid-walk.
          if (FOOT_PER_CELL_ENABLED) {
            this.cutInfantryTransportTether(entity);
            const m = (entity.missionQueue ?? entity.mission) as Mission;
            const pathShortenEligible = m === Mission.HUNT || m === Mission.AREA_GUARD
                                        || m === Mission.ATTACK;
            const liveTar = !!(entity.target?.alive) || entity.targetStructure != null;
            const inRangeNow = !!(entity.target?.alive) && entity.inRangeOfLikelyCoord(entity.target);
            const fpcpResult = footPerCellProcess(
              entity as unknown as Parameters<typeof footPerCellProcess<Mission>>[0],
              PCPType.PCP_END,
              {
                hasLegalTarCom: liveTar,
                inRadioContact: false,
                pathShortenEligible,
                targetInRange: inRangeNow,
                // C++ infantry.cpp:823-832 — RADIO_IM_IN boarding at PCP_END.
                tryBoardTransport: () => this.tryPCPBoardTransport(entity),
              },
              {
                guardMission: Mission.GUARD,
                areaGuardMission: Mission.AREA_GUARD,
                attackMission: Mission.ATTACK,
                huntMission: Mission.HUNT,
                rescueMission: Mission.RESCUE,
              }
            );
            // C++ infantry.cpp:830-831 — `return;` after Limbo+Attach. Skip
            // the rest of this arrival sequence (finishMove, etc.) because the
            // unit is now a passenger.
            if (fpcpResult.boarded) return;
          }

          if (entity.moveTarget &&
              leptonDist(entity.leptonX, entity.leptonY, entity.moveTarget.lx, entity.moveTarget.ly) < 16) {
            finishMove();
          }
        }
      }
      return;
    }

    const activeDriveTrackWithoutPath =
      !entity.stats.isInfantry &&
      !entity.isAirUnit &&
      usesTrackMovement(entity.stats.speedClass, !!entity.stats.isInfantry, !!entity.stats.isAircraft) &&
      entity.trackNumber > 0 &&
      (entity.headToLX !== 0 || entity.headToLY !== 0) &&
      (entity.path.length === 0 || entity.pathIndex >= entity.path.length);

    if ((entity.path.length > 0 && entity.pathIndex < entity.path.length) || activeDriveTrackWithoutPath) {
      // C++ InfantryClass::Movement_AI has distinct !IsDriving and IsDriving
      // branches. Once Start_Driver has selected HeadToCoord, later
      // Mission_Move timer fires must NOT call Start_Driver again; they only
      // Coord_Move toward the preserved HeadToCoord. Re-starting here changes
      // the sub-cell slot mid-hop, which drifts the unit off the C++ path
      // (SCG06EA BadGuy E1 around ticks 11-66).
      if (entity.stats.isInfantry && entity.isDriving && entity.headToLX > 0 && entity.headToLY > 0) {
        const headTo = { lx: entity.headToLX, ly: entity.headToLY };
        if (entity.moveToward(headTo, this.movementSpeed(entity))) {
	          const reachedNavComCell =
	            entity.moveTarget !== null &&
	            entity.cell.cx === Math.floor(entity.moveTarget.lx / LEPTON_SIZE) &&
	            entity.cell.cy === Math.floor(entity.moveTarget.ly / LEPTON_SIZE);
	          entity.pathIndex++;
          // C++ infantry.cpp:4004-4008: every completed infantry sub-cell hop
          // calls Stop_Driver(). A later AI pass may Start_Driver() for the next
          // path cell; it does not happen again inside the same Movement_AI pass.
          this.stopInfantryDriver(entity);
          if (FOOT_PER_CELL_ENABLED) {
            // InfantryClass::Per_Cell_Process calls Commence() before chaining to
            // FootClass::Per_Cell_Process path-shorten. Compute eligibility against
            // the mission that will be visible after that per-cell Commence pop.
            this.cutInfantryTransportTether(entity);
            const m = (entity.missionQueue ?? entity.mission) as Mission;
            const pathShortenEligible = m === Mission.HUNT || m === Mission.AREA_GUARD
                                        || m === Mission.ATTACK;
            const liveTar = !!(entity.target?.alive) || entity.targetStructure != null;
            const inRangeNow = !!(entity.target?.alive) && entity.inRangeOfLikelyCoord(entity.target);
            const fpcpResult = footPerCellProcess(
              entity as unknown as Parameters<typeof footPerCellProcess<Mission>>[0],
              PCPType.PCP_END,
              {
                hasLegalTarCom: liveTar,
                inRadioContact: false,
                pathShortenEligible,
                targetInRange: inRangeNow,
                // C++ infantry.cpp:823-832 — RADIO_IM_IN boarding at PCP_END
                // along the IsDriving path-walk arrival branch.
                tryBoardTransport: () => this.tryPCPBoardTransport(entity),
              },
              {
                guardMission: Mission.GUARD,
                areaGuardMission: Mission.AREA_GUARD,
                attackMission: Mission.ATTACK,
                huntMission: Mission.HUNT,
                rescueMission: Mission.RESCUE,
              }
            );
            // C++ infantry.cpp:830-831 — `return;` after Limbo+Attach.
            if (fpcpResult.boarded) return;
          }

          // C++ infantry.cpp:3992-4008 — after reaching Head_To_Coord,
          // Movement_AI checks whether the infantry is now in NavCom's cell.
          // If so, NavCom is cleared immediately and Mission_Move enters idle
          // mode. The infantry does not keep walking to the cell center.
          if (reachedNavComCell) {
            entity.moveTarget = null;
            this.clearDrivePath(entity);
            resetPathThreshold(entity);
            if ((entity.mission as Mission) === Mission.MOVE) {
              const idleMission = this.infantryEnterIdleMission(entity);
              if (entity.mission !== idleMission) entity.missionQueue = idleMission;
            }
          }
        }
        return;
      }

      let nextCell = entity.path[entity.pathIndex];
      if (entity.stats.isInfantry && this.skipInfantryPathCurrentCell(entity)) {
        nextCell = entity.path[entity.pathIndex];
      }
      if (entity.stats.isInfantry && !nextCell) return;
      const driveTrackActive =
        !entity.stats.isInfantry &&
        usesTrackMovement(entity.stats.speedClass, !!entity.stats.isInfantry, !!entity.stats.isAircraft) &&
        entity.trackNumber > 0;
      if (!driveTrackActive && this.skipDrivePathCurrentCell(entity)) {
        nextCell = entity.path[entity.pathIndex];
      }
      // Safety check: verify next path cell is still passable (terrain may have changed since path was calculated)
      const terrainOk = !nextCell || (entity.isNavalUnit
        ? this.map.isWaterPassable(nextCell.cx, nextCell.cy)
        : (this.map.isTerrainPassable(nextCell.cx, nextCell.cy) ||
           this.isAuthorizedBuildingEnterCell(entity, nextCell.cx, nextCell.cy) ||
           this.isAuthorizedFactoryTetherCell(entity, nextCell.cx, nextCell.cy)));
      if (!driveTrackActive && !terrainOk && entity.moveTarget) {
        // C++ PathThreshhold escalation (foot.cpp:396-411, drive.cpp:989-996)
        // Respect PathDelay timer before retrying (C++ foot.cpp:463)
        if (entity.pathDelay > 0) {
          return;
        }
        entity.lastPathRecalc = this.tick;
        // C++ foot.cpp:396-411 — synchronous escalation: try ALL threshold levels in one call.
        // C++ starts at current PathThreshhold and increments up to maxtype in a for(;;) loop.
        const maxtype = pathMaxType(entity, this.isPlayerControlled(entity));
        let pathFound = false;
        for (;;) {
          const newPath = findPath(
            this.map, entity.cell,
            { cx: Math.floor(entity.moveTarget.lx / 256), cy: Math.floor(entity.moveTarget.ly / 256) }, true,
            entity.isNavalUnit, entity.stats.speedClass
          );
          if (newPath.length > 0) {
            if (entity.stats.isInfantry) {
              this.setInfantryBasicPath(entity, newPath);
            } else {
              this.setDrivePath(entity, newPath);
            }
            entity.trackNumber = -1; entity.trackControlIndex = -1;
            entity.trackCellSpan = 1;
            // Successful path — reset threshold (C++ drive.cpp:1050)
            entity.pathThreshold = MOVE_CLOAK;
            entity.tryCount = PATH_RETRY;
            pathFound = true;
            break;
          }
          entity.pathThreshold++;
          if (entity.pathThreshold > maxtype) break;
        }
        // C++ foot.cpp:463 — set PathDelay after every Basic_Path call
        entity.pathDelay = PATH_DELAY_TICKS;
        if (!pathFound) {
          // All thresholds exhausted — decrement TryTryAgain (C++ drive.cpp:989-996)
          if (entity.tryCount > 0) {
            entity.tryCount--;
            entity.pathThreshold = MOVE_CLOAK; // reset threshold for next retry cycle
          } else {
            // All retries exhausted — stop movement (C++ drive.cpp:992)
            entity.moveTarget = null;
            this.clearDrivePath(entity);
            entity.trackNumber = -1; entity.trackControlIndex = -1;
            entity.trackCellSpan = 1;
            setMissionIdle();
            entity.animState = AnimState.IDLE;
            resetPathThreshold(entity);
          }
        }
        return;
      }

      if (entity.stats.isInfantry && nextCell && entity.moveTarget) {
        // C++ infantry.cpp:3828-3836 — before Start_Driver, InfantryClass::
        // Movement_AI validates the cached Path[0] with Can_Enter_Cell().
        // If the cell is no longer MOVE_OK (for example a moving vehicle has
        // reserved it), it invalidates the path and immediately retries
        // Basic_Path when PathDelay allows. This is distinct from vehicle
        // threshold pathing: infantry Start_Driver requires exactly MOVE_OK.
        const canStart = this.infantryCanEnterCell(entity, nextCell.cx, nextCell.cy);
        if (canStart !== MoveResult.OK) {
          entity.path = [];
          entity.pathIndex = 0;
          if (entity.pathDelay > 0) return;

          const goal = {
            cx: Math.floor(entity.moveTarget.lx / LEPTON_SIZE),
            cy: Math.floor(entity.moveTarget.ly / LEPTON_SIZE),
          };
          const pathGoal = this.resolveInfantryBasicPathGoal(entity, goal);
          const newPath = this.findDriveClassBasicPath(entity, pathGoal);
          entity.pathDelay = PATH_DELAY_TICKS;
          if (newPath.length === 0) {
            const closeEnough = 704; // rules.ini [General] CloseEnough=2.75 * 256
            if (leptonDist(entity.leptonX, entity.leptonY, entity.moveTarget.lx, entity.moveTarget.ly) < closeEnough &&
                !entity.isTethered) {
              entity.moveTarget = null;
            } else if (entity.tryCount > 0) {
              entity.tryCount--;
            } else {
              entity.moveTarget = null;
              entity.pathThreshold = MOVE_CLOAK;
            }
            return;
          }

          this.setInfantryBasicPath(entity, newPath);
          if (entity.path.length === 0 || entity.pathIndex >= entity.path.length) return;
          nextCell = entity.path[0];
        }
      }

      // Check if next cell is blocked by another unit — recalculate path (with cooldown)
      // C++ infantry sub-cell system: infantry can share cells if sub-cells are available
      const occ = nextCell ? this.map.getOccupancy(nextCell.cx, nextCell.cy) : 0;
      const infantryCanEnter = !!nextCell && entity.stats.isInfantry && this.map.hasAvailableSubCell(nextCell.cx, nextCell.cy);
      const legacyPreTrackOccupancyCheck =
        !entity.stats.isInfantry &&
        (entity.isAirUnit ||
         !usesTrackMovement(entity.stats.speedClass, !!entity.stats.isInfantry, !!entity.stats.isAircraft));
      if (legacyPreTrackOccupancyCheck &&
          !driveTrackActive && occ > 0 && occ !== entity.id && !infantryCanEnter && entity.moveTarget) {
        // Phase 3 v3 — port C++ drive.cpp:1102-1105 reactive close-enough.
        //
        // C++ Start_Of_Move track-start branch (drive.cpp:1087-1146):
        //   destcell = Coord_Cell(dest);
        //   Mark(MARK_UP); MoveType cando = Can_Enter_Cell(destcell, facing); Mark(MARK_DOWN);
        //   if (cando != MOVE_OK) {
        //     if (Mission == MISSION_MOVE && Distance(NavCom) < Rule.CloseEnoughDistance) {
        //       Assign_Destination(TARGET_NONE);  // drive.cpp:1103
        //     }
        //     ... (MOVE_TEMP scatter, Stop_Driver, ...)
        //   }
        //
        // Semantics: when about to start a new track but the next cell is not
        // OK (friendly occupant = MOVE_TEMP / MOVE_MOVING_BLOCK), and we're
        // already within CloseEnoughDistance of NavCom, just clear NavCom.
        // Matches the SCG11EA t19 USSR 4TNK patrol-blocked-by-friendly case
        // previously handled by W16 (path.length===0 sticky patrolBlockedTargetLX).
        //
        // Gated on DRIVE_CLASS_AI_PORT — same feature flag as the rest of
        // Phase 3 v2/v3 so a single flip activates both path regen + reactive
        // close-enough together.
        if (DRIVE_CLASS_AI_PORT
            && entity.mission === Mission.MOVE
            && !entity.stats.isInfantry
            && !entity.isAirUnit) {
          const CLOSE_ENOUGH_LEPTONS = 704;
          const dxL = entity.moveTarget.lx - entity.leptonX;
          const dyL = entity.moveTarget.ly - entity.leptonY;
          const adx = Math.abs(dxL), ady = Math.abs(dyL);
          const octDist = adx > ady ? adx + (ady >> 1) : ady + (adx >> 1);
          if (octDist < CLOSE_ENOUGH_LEPTONS) {
            const blocker = this.entityById.get(occ);
            if (blocker?.alive && this.entitiesAllied(entity, blocker)) {
              // drive.cpp:1102-1105 — Assign_Destination(TARGET_NONE).
              this.assignDriveDestinationNone(entity);
              return;
            }
          }
        }
        const blocker = this.entityById.get(occ);
        if (blocker?.alive && this.entitiesAllied(entity, blocker)) {
          // C++ drive.cpp:1122-1124 / CellClass::Incoming: friendly temporary
          // blockers are asked to Scatter(0,true,true), which assigns NavCom
          // without changing their current mission.
          this.incomingNoThreatScatterCell(nextCell.cx, nextCell.cy, entity.id);
        }
        // C++ PathThreshhold escalation (foot.cpp:396-411, drive.cpp:989-996)
        if (entity.pathDelay > 0) {
          return;
        }
        entity.lastPathRecalc = this.tick;
        // C++ foot.cpp:396-411 — synchronous escalation: try ALL thresholds in one call.
        const maxtype2 = pathMaxType(entity, this.isPlayerControlled(entity));
        let pathFound2 = false;
        for (;;) {
          const newPath = findPath(
            this.map, entity.cell,
            { cx: Math.floor(entity.moveTarget.lx / 256), cy: Math.floor(entity.moveTarget.ly / 256) }, true,
            entity.isNavalUnit, entity.stats.speedClass
          );
          if (newPath.length > 0) {
            this.setDrivePath(entity, newPath);
            entity.trackNumber = -1; entity.trackControlIndex = -1;
            entity.trackCellSpan = 1;
            entity.pathThreshold = MOVE_CLOAK;
            entity.tryCount = PATH_RETRY;
            pathFound2 = true;
            break;
          }
          entity.pathThreshold++;
          if (entity.pathThreshold > maxtype2) break;
        }
        entity.pathDelay = PATH_DELAY_TICKS;
        if (!pathFound2) {
          if (entity.tryCount > 0) {
            entity.tryCount--;
            entity.pathThreshold = MOVE_CLOAK;
          } else {
            // All retries exhausted — give up (C++ drive.cpp:992)
            entity.moveTarget = null;
            entity.path = [];
            entity.pathIndex = 0;
            entity.trackNumber = -1; entity.trackControlIndex = -1;
            entity.trackCellSpan = 1;
            setMissionIdle();
            entity.animState = AnimState.IDLE;
            resetPathThreshold(entity);
          }
        }
        entity.trackCellSpan = 1;
        entity.pathThreshold = MOVE_CLOAK;
        entity.tryCount = PATH_RETRY;
      }
      // C++ infantry.cpp:3930-3975: the !IsDriving Movement_AI branch calls
      // Start_Driver(), sets the DO_WALK action, and returns. It does not fall
      // through to Coord_Move on the same tick; movement starts on the next
      // IsDriving branch. Keeping this split is visible at sub-cell boundaries
      // (SCG06EA BadGuy E1): otherwise TS starts the next hop one tick early.
      if (entity.stats.isInfantry) {
        const started = this.infantryStartDriver(entity, nextCell.cx, nextCell.cy);
        if (started) {
          entity.isDriving = true;
          entity.doing = 'walk';
        }
        return;
      }

      // C++ infantry: InfantryClass::Start_Driver uses Closest_Free_Spot for sub-cell
      let target: LeptonPos;
      target = nextCell
        ? { lx: nextCell.cx * 256 + 128, ly: nextCell.cy * 256 + 128 }
        : { lx: entity.headToLX, ly: entity.headToLY };
      const speed = nextCell ? this.driveSpeedThrottleRaw(entity, nextCell) : (entity.driveSpeed || this.driveSpeedThrottleRaw(entity));
      // MV1: Track-table movement for vehicles (C++ drive.cpp smooth turning)
      // Uses C++ TrackControl table to select pre-computed curved paths.
      // Track offsets are relative to target cell center, transformed via Smooth_Turn flags.
      // C++ parity: UnitClass::Per_Cell_Process (unit.cpp:1610-1884) +
      // DriveClass::Per_Cell_Process (drive.cpp:844-865).
      //
      // Boundary dispatch: each time a vehicle/vessel finishes entering a
      // cell (PCP_END), C++ runs sub-cases in order — Commence (unit.cpp:1756),
      // DriveClass NavCom-at-dest clear (drive.cpp:869-873), then shared
      // FootClass path-shorten (foot.cpp:1471-1483), plus later sub-cases.
      // See `perCellProcess.ts` header for the remaining transport/flag/mine
      // work.
      //
      // Returns `true` when NavCom was cleared, signalling the caller to
      // halt further movement this tick (matches C++ While_Moving break
      // after Per_Cell_Process at drive.cpp:820).
      const perCellNavComCheck = (skipCommence: boolean = false): boolean => {
        const m = (entity.missionQueue ?? entity.mission) as Mission;
        const pathShortenEligible =
          m === Mission.RESCUE ||
          m === Mission.AREA_GUARD ||
          m === Mission.ATTACK ||
          m === Mission.HUNT;
        const liveTar = !!(entity.target?.alive) || entity.targetStructure != null;
        const inRangeNow = !!(entity.target?.alive) && entity.inRangeOfLikelyCoord(entity.target);
        this.cutTransportTether(entity);
        const r = unitPerCellProcess(entity, PCPType.PCP_END, {
          skipCommence,
          hasLegalTarCom: liveTar,
          pathShortenEligible,
          targetInRange: inRangeNow,
          // C++ unit.cpp:1635-1651 Case A — RADIO_IM_IN building entry
          // refusal scatter. Runs first because the C++ `if` block at line
          // 1635 sits before the Case B transport block at line 1657.
          tryBuildingEntryScatter: () => this.tryPCPBuildingEntryScatter(entity),
          // C++ unit.cpp:1657-1664 Case B — RADIO_IM_IN ground transport
          // boarding. Fires BEFORE Commence, short-circuits remaining PCP_END
          // work when matched. The callback locates the transport and runs
          // the Limbo + Attach path (see `tryPCPBoardTransport`).
          tryBoardTransport: () => this.tryPCPBoardTransport(entity),
        });
        if (r.commenceFired) entity._commenceFiredThisTick = true;
        // C++ unit.cpp:1664 `return;` — when boarding fires, the rest of the
        // track loop must not continue this tick (the entity is now in limbo
        // and will be removed by `_pendingTransportLoads` at end of tick).
        if (r.boarded) return true;
        return r.navComCleared;
      };

      if (usesTrackMovement(entity.stats.speedClass, !!entity.stats.isInfantry, !!entity.stats.isAircraft)) {
        if (this.isDriveClassPathEntity(entity) &&
            entity.trackNumber <= 0 &&
            entity.path.length > 0 &&
            entity.pathIndex < entity.path.length &&
            entity.drivePathFacings.length === 0) {
          entity.drivePathFacings = this.deriveDrivePathFacings(entity.cell, entity.path.slice(entity.pathIndex));
        }
        // C++ drive.cpp: Start_Of_Move/While_Moving executes one movement-budget
        // pass per call. DriveClass::AI may invoke that pair a second time when
        // the current track completes with path remaining (drive.cpp:1340-1345);
        // runDriveClassAI owns that outer two-pass loop. Do not chain multiple
        // fresh movement budgets here, or fast vessels can consume several path
        // cells in one TS update where C++ would only spend one While_Moving
        // budget.
        const MAX_CHAIN = 1;
        for (let chain = 0; chain < MAX_CHAIN; chain++) {
          // Recompute target for current pathIndex (may have advanced via chaining)
          const chainCell = entity.path[entity.pathIndex];
          const hasActiveTrackTarget = entity.trackNumber > 0 && (entity.headToLX !== 0 || entity.headToLY !== 0);
          if (!chainCell && !hasActiveTrackTarget) break;
          const chainTarget: WorldPos = chainCell
            ? {
                x: chainCell.cx * CELL_SIZE + CELL_SIZE / 2,
                y: chainCell.cy * CELL_SIZE + CELL_SIZE / 2,
              }
            : {
                // C++ DriveClass::Assign_Destination can clear Path[0] while
                // IsDriving, but While_Moving continues the active track toward
                // Head_To_Coord. TS stores that reservation in headToLX/headToLY.
                x: leptonToPixel(entity.headToLX),
                y: leptonToPixel(entity.headToLY),
              };
          const chainTargetLP: LeptonPos = chainCell
            ? { lx: chainCell.cx * 256 + 128, ly: chainCell.cy * 256 + 128 }
            : { lx: entity.headToLX, ly: entity.headToLY };

          if (entity.trackNumber > 0) {
            // Currently following a track — advance along it
            // C++ DriveClass::While_Moving follows Head_To_Coord, not the
            // current Path[0] entry. This matters after track jumping:
            // drive.cpp:766-790 starts the new track toward
            // `Adjacent_Cell(Head_To_Coord(), nextface)` but only shifts Path by
            // one entry, so path[pathIndex] still names the previous head-to
            // cell. Use Head_To_Coord as the authoritative active-track target.
            const trackTarget = (entity.headToLX !== 0 || entity.headToLY !== 0)
              ? { x: leptonToPixel(entity.headToLX), y: leptonToPixel(entity.headToLY) }
              : (entity.trackCellSpan === 2 && entity.path[entity.pathIndex + 1]
                  ? { x: entity.path[entity.pathIndex + 1].cx * CELL_SIZE + CELL_SIZE / 2,
                      y: entity.path[entity.pathIndex + 1].cy * CELL_SIZE + CELL_SIZE / 2 }
                  : chainTarget);
            if (this.followTrackStep(entity, speed, trackTarget.x, trackTarget.y)) {
              // Track complete — vehicle is at target cell center
              entity.pathIndex += entity.trackCellSpan;
              entity.trackCellSpan = 1; // reset for next track
              // C++ DriveClass::Per_Cell_Process PCP_END runs the full chain,
              // including UnitClass::Per_Cell_Process Commence before the
              // DriveClass NavCom-at-dest clear.
              if (perCellNavComCheck()) break;
              // Continue loop to chain next track on same tick (Fix 1)
              continue;
            }
            break; // Track not yet complete — done for this tick
          }

          // C++ DriveClass::AI (drive.cpp:1358-1379) handles in-place body
          // rotation before Start_Of_Move. If PrimaryFacing is already rotating
          // at AI entry, it calls Rotation_Adjust and returns; it does not
          // re-run Can_Enter_Cell or start a track in that same tick.
          if (!driveClassTrackReentry && !entity.stats.isInfantry && !entity.isAirUnit) {
            if (entity.bodyFacing256 < 0) entity.bodyFacing256 = (entity.facing * 32) & 0xff;
            const currentDesired256 = entity.desiredFacing256 >= 0
              ? (entity.desiredFacing256 & 0xff)
              : ((entity.desiredFacing * 32) & 0xff);
            if (entity.bodyFacing256 !== currentDesired256) {
              entity.tickRotation();
              break;
            }
          }

          // Need to initiate a new track for this cell-to-cell segment
          // C++ uses Path[0] as the new track facing. This is the cell-to-cell
          // direction, not the direction from the current sub-cell/lepton
          // position to the next cell center. The distinction matters after
          // curved tracks, where the object may still be vertically offset.
          const nextFacing8 = directionTo({
            x: entity.cell.cx * CELL_SIZE + CELL_SIZE / 2,
            y: entity.cell.cy * CELL_SIZE + CELL_SIZE / 2,
          }, chainTarget);

          // C++ drive.cpp:1340-1346 checks PrimaryFacing.Is_Rotating()
          // before Rotation_Adjust. If the final adjustment reaches DesiredFacing
          // this tick, Start_Of_Move still waits until the next tick.
          if (entity.bodyFacing256 < 0) entity.bodyFacing256 = (entity.facing * 32) & 0xff;
          if (entity.bodyFacing256 !== ((nextFacing8 * 32) & 0xff)) {
            // C++ Start_Of_Move calls Do_Turn(dir) here (drive.cpp:1098-1105),
            // which only sets PrimaryFacing.Desired. Rotation_Adjust is handled
            // by DriveClass::AI on following ticks.
            entity.desiredFacing = nextFacing8;
            entity.desiredFacing256 = (nextFacing8 * 32) & 0xff;
            break;
          }
          entity.desiredFacing = nextFacing8;
          entity.desiredFacing256 = (nextFacing8 * 32) & 0xff;

          const entryMove = (!entity.stats.isInfantry && !entity.isAirUnit)
            ? this.canEnterTrackJumpCell(entity, chainCell.cx, chainCell.cy)
            : MoveResult.OK;
          if (entryMove !== MoveResult.OK) {
            this.stopDriveTrack(entity);
            entity.trackNumber = -1;
            entity.trackControlIndex = -1;
            entity.trackCellSpan = 1;
            if (entryMove === MoveResult.TEMP_BLOCKED) {
              this.incomingNoThreatScatterCell(chainCell.cx, chainCell.cy, entity.id);
            }
            if (DRIVE_CLASS_AI_PORT
                && entity.mission === Mission.MOVE
                && !entity.stats.isInfantry
                && !entity.isAirUnit
                && entity.moveTarget) {
              const CLOSE_ENOUGH_LEPTONS = 704;
              const dxL = entity.moveTarget.lx - entity.leptonX;
              const dyL = entity.moveTarget.ly - entity.leptonY;
              const adx = Math.abs(dxL), ady = Math.abs(dyL);
              const octDist = adx > ady ? adx + (ady >> 1) : ady + (adx >> 1);
              if (octDist < CLOSE_ENOUGH_LEPTONS) {
                // drive.cpp:1114-1158: blocked track-start while close enough
                // calls Assign_Destination(TARGET_NONE), which can immediately
                // queue Enter_Idle_Mode through Start_Of_Move when not driving.
                this.assignDriveDestinationNone(entity);
                break;
              }
            }
            if (entryMove === MoveResult.DESTROYABLE || entryMove === MoveResult.IMPASSABLE) {
              entity.moveTarget = null;
              entity.path = [];
              entity.pathIndex = 0;
              setMissionIdle();
              resetPathThreshold(entity);
            }
            break;
          }

          // Fix 3: Path lookahead for track selection (C++ Path[0]*8 + Path[1])
          // Use current direction × next direction for smooth lead-in curves.
          let followingFacing8 = nextFacing8; // default: straight (C++ "if nextface==FACING_NONE")
          const followingCell = entity.path[entity.pathIndex + 1];
          if (followingCell) {
            followingFacing8 = directionTo(chainTarget, {
              x: followingCell.cx * CELL_SIZE + CELL_SIZE / 2,
              y: followingCell.cy * CELL_SIZE + CELL_SIZE / 2,
            });
          }

          const ctrl = lookupTrackControl(nextFacing8, followingFacing8);

          // Long 2-cell tracks: C++ does not require Path[1] to exist. When it
          // is FACING_NONE, Start_Of_Move sets `nextface = facing` and F_D
          // still checks/targets the implicit second straight-ahead cell
          // (drive.cpp:1207-1221).
          const longTrackCell = (ctrl.flag & F_D)
            ? (followingCell ?? { cx: chainCell.cx + DIR_DX[followingFacing8], cy: chainCell.cy + DIR_DY[followingFacing8] })
            : null;
          const useLongTrack = !!(ctrl.flag & F_D) && longTrackCell !== null && ctrl.track > 0;
          if (useLongTrack && longTrackCell) {
            // C++ drive.cpp:1217-1250: an F_D long track checks the second
            // cell before it shifts Path[] by two entries. If blocked, it
            // clears Path[0] and does not start a track.
            const longMove = this.canEnterTrackJumpCell(entity, longTrackCell.cx, longTrackCell.cy);
            if (longMove !== MoveResult.OK) {
              this.stopDriveTrack(entity);
              if (longMove === MoveResult.TEMP_BLOCKED) {
                this.incomingNoThreatScatterCell(longTrackCell.cx, longTrackCell.cy, entity.id);
              }
              entity.path = [];
              entity.pathIndex = 0;
              entity.trackNumber = -1;
              entity.trackControlIndex = -1;
              entity.trackCellSpan = 1;
              break;
            }
          }
          const effectiveTrack = useLongTrack ? ctrl.track : getEffectiveTrack(ctrl);

          if (effectiveTrack > 0) {
            // Valid track — start following it
            entity.trackNumber = effectiveTrack;
            entity.trackFlags = ctrl.flag & ~F_D; // strip F_D (only F_T|F_X|F_Y for geometry)
            entity.trackIndex = 0;
            entity.trackCellSpan = useLongTrack ? 2 : 1;
            entity.trackControlIndex = nextFacing8 * 8 + followingFacing8; // C++ TrackNumber (TC index)
            entity.speedAccum = 0; // C++: fresh budget per While_Moving() call
            // C++ drive.cpp:1164-1190 computes FootClass::Speed once in
            // Start_Of_Move from the destination terrain. While_Moving reuses
            // that throttle until the next Start_Of_Move; track jumps preserve
            // it explicitly with oldspeed/Set_Speed(oldspeed) (drive.cpp:767-788).
            entity.driveSpeed = speed;
            // Long tracks target the SECOND cell ahead; short tracks target the next cell
            const trackTarget = useLongTrack
              ? { x: longTrackCell!.cx * CELL_SIZE + CELL_SIZE / 2,
                  y: longTrackCell!.cy * CELL_SIZE + CELL_SIZE / 2 }
              : chainTarget;
            // C++ UnitClass/VesselClass::Start_Driver reserves HeadToCoord via
            // DriveClass::Mark_Track before While_Moving advances.
            this.startDriveTrack(
              entity,
              Math.trunc(trackTarget.x / LP),
              Math.trunc(trackTarget.y / LP),
            );
            this.consumeDrivePathFacings(entity, entity.trackCellSpan);
            // Follow first step this tick
            if (this.followTrackStep(entity, speed, trackTarget.x, trackTarget.y)) {
              entity.pathIndex += entity.trackCellSpan;
              entity.trackCellSpan = 1;
              // C++ DriveClass::Per_Cell_Process PCP_END runs Commence at
              // track completion; STAGE F is suppressed for this same tick.
              if (perCellNavComCheck()) break;
              continue; // Chain next track
            }
            break; // Track not yet complete
          } else {
            // C++ drive.cpp:1239-1242: if TrackControl[facing*8+nextface].Track
            // is zero, Start_Of_Move clears Path[0], leaves TrackNumber=-1, and
            // returns. It does NOT free-form slide toward the next cell. The next
            // DriveClass::AI pass will recompute Basic_Path while NavCom remains
            // legal. TS used to moveToward here, which let tracked vehicles drift
            // before C++ had started a driver (SCG04EA MNLY t13/t21).
            entity.path = [];
            entity.pathIndex = 0;
            entity.trackNumber = -1;
            entity.trackControlIndex = -1;
            entity.trackCellSpan = 1;
            break;
          }
        }
      } else {
        // Infantry/aircraft: free-form movement (FOOT speedClass exempt from tracks)
        if (entity.moveToward(target, speed)) {
          entity.pathIndex++;
          // PCP Session 2.2: infantry cell-arrival Per_Cell_Process(PCP_END).
          // Mirrors C++ infantry.cpp:3997 — fires at Distance(Head_To_Coord())<0x0010,
          // which `moveToward` returning true is the TS equivalent of. Aircraft are
          // excluded (infantry-only check); their free-form path never triggers
          // InfantryClass::Per_Cell_Process in C++ either (aircraft.cpp flow).
          //
          // This is the SCG13 tick-101 site: at cell-arrival on the last path cell,
          // Enter_Idle_Mode queues MISSION_GUARD (or MISSION_GUARD_AREA when the
          // guardOrigin is set), and the subsequent Commence pop transitions mission
          // to GUARD with Timer=0 — one tick earlier than the current Mission.MOVE
          // handler's missionTimerFired path (which matches WASM behavior).
          if (FOOT_PER_CELL_ENABLED && entity.stats.isInfantry) {
            this.cutInfantryTransportTether(entity);
            // C++ foot.cpp:1479 — path-shorten applies in attack-type missions only.
            // At this updateMove site mission is typically MOVE; include the whole
            // set here for correctness so cross-mission callers (e.g. updateMove
            // called from Mission.GUARD drive-in-GUARD) behave consistently.
            // InfantryClass::Per_Cell_Process runs Commence() before the chained
            // FootClass path-shorten check, so use the queued mission if present.
            const m = (entity.missionQueue ?? entity.mission) as Mission;
            const pathShortenEligible = m === Mission.HUNT || m === Mission.AREA_GUARD
                                        || m === Mission.ATTACK;
            const liveTar = !!(entity.target?.alive) || entity.targetStructure != null;
            const inRangeNow = !!(entity.target?.alive) && entity.inRangeOfLikelyCoord(entity.target);
            const fpcpResult = footPerCellProcess(
              entity as unknown as Parameters<typeof footPerCellProcess<Mission>>[0],
              PCPType.PCP_END,
              {
                hasLegalTarCom: liveTar,
                inRadioContact: false,
                pathShortenEligible,
                targetInRange: inRangeNow,
                // C++ infantry.cpp:823-832 — RADIO_IM_IN boarding fires at every
                // infantry PCP_END boundary, including this free-form-walk arrival.
                tryBoardTransport: () => this.tryPCPBoardTransport(entity),
              },
              {
                guardMission: Mission.GUARD,
                areaGuardMission: Mission.AREA_GUARD,
                attackMission: Mission.ATTACK,
                huntMission: Mission.HUNT,
                rescueMission: Mission.RESCUE,
              }
            );
            // C++ infantry.cpp:830-831 — `return;` after Limbo+Attach.
            if (fpcpResult.boarded) return;
          }
        }
      }
    } else if (entity.moveTarget) {
      if (!entity.stats.isInfantry && !entity.isAirUnit &&
          usesTrackMovement(entity.stats.speedClass, false, false)) {
        // C++ DriveClass never free-form slides a vehicle/vessel toward NavCom
        // when Path[] is empty. DriveClass::AI enters Start_Of_Move, which
        // either regenerates Basic_Path, requests a turn, starts a track, or
        // leaves TrackNumber=-1 with no movement (drive.cpp:918-1402).
        // Returning here prevents TS-only drift before a real track starts.
        return;
      }
      // C++ drive.cpp only accepts "close enough" as a fallback when pathing is blocked.
      // A direct move order should otherwise continue to the exact commanded cell.
      const closeEnough = 2.75; // rules.ini [General] CloseEnough=2.75 (overrides C++ default 0x0280)
      const finishMove = () => {
        entity.moveTarget = null;
        // C++ foot.cpp:2242-2248: navQueueLoop re-populates queue when exhausted
        if (entity.moveQueue.length === 0 && entity.navQueueLoop && entity.navQueueOriginal.length > 0) {
          for (const wp of entity.navQueueOriginal) {
            entity.queueWaypoint({ lx: wp.lx, ly: wp.ly });
          }
        }
        if (entity.moveQueue.length > 0) {
          const next = entity.moveQueue.shift()!;
          // C++ foot.cpp:2242-2248: re-append consumed waypoint when looping
          if (entity.navQueueLoop) {
            entity.queueWaypoint({ lx: next.lx, ly: next.ly });
          }
          entity.moveTarget = next;
          entity.path = findPath(this.map, entity.cell, { cx: Math.floor(next.lx / 256), cy: Math.floor(next.ly / 256) }, true, entity.isNavalUnit, entity.stats.speedClass);
          entity.pathIndex = 0;
        } else {
          setMissionIdle();
          entity.animState = AnimState.IDLE;
        }
      };

      // Bug 3 fix: Before moving directly, check if the unit would enter an impassable cell.
      // Calculate which cell the unit would move into based on movement direction and speed.
      const speed = this.movementSpeed(entity);
      const mtWorld = leptonPosToWorld(entity.moveTarget);
      const dx = mtWorld.x - entity.pos.x;
      const dy = mtWorld.y - entity.pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const distToTarget = worldDist(entity.pos, mtWorld);
      if (dist > 0) {
        const step = Math.min(speed * entity.speedBias, dist);
        const nextX = entity.pos.x + (dx / dist) * step;
        const nextY = entity.pos.y + (dy / dist) * step;
        const nextCellPos = worldToCell(nextX, nextY);
        const currentCell = entity.cell;
        // Only check terrain if we're actually crossing into a new cell
        if ((nextCellPos.cx !== currentCell.cx || nextCellPos.cy !== currentCell.cy)) {
          const passable = entity.isNavalUnit
            ? this.map.isWaterPassable(nextCellPos.cx, nextCellPos.cy)
            : this.map.isPassable(nextCellPos.cx, nextCellPos.cy);
          // Also check occupancy on the new cell
          const occId = this.map.getOccupancy(nextCellPos.cx, nextCellPos.cy);
          // C++ infantry sub-cell: infantry can enter cells with available sub-cells
          const infCanEnter = entity.stats.isInfantry && this.map.hasAvailableSubCell(nextCellPos.cx, nextCellPos.cy);
          const occBlocked = !entity.isNavalUnit && occId > 0 && occId !== entity.id && !infCanEnter;
          if (!passable || occBlocked) {
            // C++ PathThreshhold escalation (foot.cpp:396-411, drive.cpp:989-996)
            if (entity.pathDelay > 0) {
              return;
            }
            entity.lastPathRecalc = this.tick;
            // C++ foot.cpp:396-411 — synchronous escalation: try ALL thresholds.
            const maxtype3 = pathMaxType(entity, this.isPlayerControlled(entity));
            let pathFound3 = false;
            for (;;) {
              const newPath = findPath(
                this.map, currentCell,
                { cx: Math.floor(entity.moveTarget.lx / 256), cy: Math.floor(entity.moveTarget.ly / 256) }, true,
                entity.isNavalUnit, entity.stats.speedClass
              );
              if (newPath.length > 0) {
                if (entity.stats.isInfantry) {
                  this.setInfantryBasicPath(entity, newPath);
                } else {
                  this.setDrivePath(entity, newPath);
                }
                entity.pathThreshold = MOVE_CLOAK;
                entity.tryCount = PATH_RETRY;
                pathFound3 = true;
                break;
              }
              entity.pathThreshold++;
              if (entity.pathThreshold > maxtype3) break;
            }
            entity.pathDelay = PATH_DELAY_TICKS;
            if (!pathFound3) {
              if (entity.tryCount > 0) {
                entity.tryCount--;
                entity.pathThreshold = MOVE_CLOAK;
              } else if (distToTarget <= closeEnough && entity.moveQueue.length === 0) {
                finishMove();
                resetPathThreshold(entity);
              } else {
                // All retries exhausted — give up (C++ drive.cpp:992)
                entity.moveTarget = null;
                entity.path = [];
                entity.pathIndex = 0;
                setMissionIdle();
                entity.animState = AnimState.IDLE;
                resetPathThreshold(entity);
              }
            }
            return;
          }
        }
      }
      if (entity.moveToward(entity.moveTarget, speed)) {
        finishMove();
      }
    } else {
      setMissionIdle();
      entity.animState = AnimState.IDLE;
    }
  }

  /** Attack target */
  private updateAttack(entity: Entity): void {
    this._runMissionAI(ctx => _updateAttack(ctx, entity));
  }

  /** Hunt mode — delegates to missionAI.ts */
  private updateHunt(entity: Entity): void {
    this._runMissionAI(ctx => _updateHunt(ctx, entity));
  }

  /** Guard mode — delegates to missionAI.ts */
  private updateGuard(entity: Entity, timerFired = true): void {
    this._runMissionAI(ctx => _updateGuard(ctx, entity, timerFired));
  }

  /** C++ AircraftClass::Mission_Guard guard scan for landed HPAD helicopters.
   *
   *  C++ execution order (aircraft.cpp:3678-3807):
   *    1. If House->IsHuman → return Normal_Delay (no scan)
   *    2. If damaged + money → seek repair (skip for healthy helicopters)
   *    3. If Ammo==0 && !In_Radio_Contact → seek helipad (docked = in contact, skip)
   *    4. If Target_Legal(TarCom) → ATTACK, return 1
   *    5. If !Is_Weapon_Equipped → return TICKS_PER_SECOND*3 (HIND has weapon, skip)
   *    6. If Height==0 && !In_Radio_Contact → Scatter (docked = in contact, skip)
   *    7. If House->State != STATE_ATTACKED → Find_Juicy_Target (harvester hunt)
   *    8. FootClass::Mission_Guard → Target_Something_Nearby + Random_Animate (no-op for aircraft)
   *
   *  This method implements steps 7-8. Steps 1-6 are handled by the caller or are
   *  no-ops for docked HPAD helicopters. The caller handles step 4 (target check
   *  before calling this method).
   *
   *  Find_Juicy_Target (house.cpp:6904-6930) iterates C++ Units.Count()
   *  (UnitClass ground vehicles), not Infantry/Vessels/Aircraft, outside their
   *  base defense zone (Which_Zone == ZONE_NONE), preferring harvesters.
   *  Target_Something_Nearby (techno.cpp:5251) then validates/overrides within
   *  weapon range. */
  /** C++ aircraft.cpp:3737-3789 — service-seek branches run BEFORE Target_Legal
   *  (TarCom). Returns true when MISSION_ENTER was queued (caller should skip the
   *  rest of Mission_Guard and finalize the tick). Sequence: (1) repair-seek if
   *  damaged + money, (2) helipad-seek if ammo=0 + weapon. Both delegate to
   *  seekAircraftServiceDocking in aircraft.ts. */
  private _handleLandedAircraftServiceSeek(heli: Entity): boolean {
    if (!this._runAircraft(ctx => _seekAircraftServiceDocking(ctx, heli))) return false;
    this.updateEntity(heli);
    if (heli.missionTimer > 0) heli.missionTimer--;
    heli.tickAnimation();
    heli._processedInBuildingPass = true;
    return true;
  }

  /** Returns true if Find_Juicy_Target (Step 7) located a juicy enemy — even if
   *  downstream range-validation (Step 8) clears heli.target later. Callers use
   *  this to trigger MISSION_ATTACK transition, mirroring C++ AircraftClass::
   *  Mission_Guard (aircraft.cpp:3821-3824 — Assign_Mission(ATTACK) is queued
   *  BEFORE the FootClass::Mission_Guard → Target_Something_Nearby range-filter). */
  private _heliGuardScan(heli: Entity): boolean {
    let juicyFound = false;
    this._runMissionAI(ctx => {
      // ── Step 7: C++ aircraft.cpp:3798-3805 — Find_Juicy_Target ──
      // Only when House->State != STATE_ATTACKED (not recently under attack).
      // C++ house.cpp:4775-4779: STATE_ATTACKED when LATime + TICKS_PER_MINUTE > Frame.
      const aiState = this.aiStates.get(heli.house);
      const isUnderAttack = aiState?.underAttack ?? false;

      if (!isUnderAttack) {
        // C++ house.cpp:6904-6930: Find_Juicy_Target — search for exposed
        // UnitClass objects only. Infantry, vessels, and aircraft live in
        // separate C++ pools and are not considered by this special hunt.
        // Filters: alive, not in limbo, not allied, AND Which_Zone(unit) ==
        // ZONE_NONE (outside own base defense zone).
        // Scoring: lower distance wins; harvester distance halved (priority);
        // AA units distance doubled (avoid).
        let juicyTarget: Entity | null = null;
        let juicyValue = 0; // 0 = not set; lower is better once set
        for (const other of ctx.entities) {
          if (!other.alive || other.inLimbo) continue;
          if (other.stats.isInfantry || other.stats.isVessel || other.stats.isAircraft || other.isAnt) continue;
          if (ctx.entitiesAllied(heli, other)) continue;

          // C++ house.cpp:6910: Which_Zone(unit) == ZONE_NONE — unit outside its own base
          // Approximate: unit is far from all of its own house's structures
          let nearOwnBase = false;
          for (const s of ctx.structures) {
            if (!s.alive || s.house !== other.house) continue;
            const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
            const scx = (s.cx + sw / 2) * CELL_SIZE;
            const scy = (s.cy + sh / 2) * CELL_SIZE;
            const d = Math.sqrt((scx - other.pos.x) ** 2 + (scy - other.pos.y) ** 2);
            // C++ house.cpp:6650: Radius * 4 — approximate base zone outer boundary
            // ~10 cells radius is a reasonable approximation for typical bases
            if (d <= 10 * CELL_SIZE) { nearOwnBase = true; break; }
          }
          if (nearOwnBase) continue; // inside own base zone, skip

          // C++ house.cpp:6911: val = Distance(coord, unit->Center_Coord())
          let val = worldDist(heli.pos, other.pos);
          // C++ house.cpp:6913: if (unit->Anti_Air()) val *= 2 — penalize AA
          if (other.weapon?.isAntiAir || other.weapon2?.isAntiAir) val *= 2;
          // C++ house.cpp:6915: if (*unit == UNIT_HARVESTER) val /= 2 — prioritize harvesters
          if (other.type === UnitType.V_HARV) val /= 2;

          if (juicyValue === 0 || val < juicyValue) {
            juicyValue = val;
            juicyTarget = other;
          }
        }

        if (juicyTarget) {
          // C++ aircraft.cpp:3821-3824: Assign_Target(target); Assign_Mission(MISSION_ATTACK);
          // Sets TarCom + queues ATTACK. Then falls through to FootClass::Mission_Guard
          // where Target_Something_Nearby may clear TarCom (out of range) — but the
          // queued ATTACK is already committed, so next tick enters MISSION_ATTACK
          // regardless. juicyFound captures that pre-clear result.
          heli.target = juicyTarget;
          juicyFound = true;
        }
      }

      // ── Step 8: C++ FootClass::Mission_Guard (foot.cpp:589-635) ──
      // Target_Something_Nearby(THREAT_RANGE) — scan within weapon range.
      // C++ techno.cpp:5260-5266: if TarCom already valid, check range. Clear if out of range.
      // C++ techno.cpp:5273-5274: if no TarCom, Greatest_Threat(THREAT_RANGE) scans nearby.
      const weaponRange = Math.max(heli.weapon?.range ?? 0, heli.weapon2?.range ?? 0);
      // C++ techno.cpp:1317: In_Range uses Weapon_Range (no +1) for TarCom validation
      // C++ techno.cpp:2048-2053: THREAT_RANGE scan uses Weapon_Range/ICON_LEPTON_W + 1 for search
      const scanRange = weaponRange > 0 ? weaponRange + 1 : heli.stats.sight;

      // C++ techno.cpp:5260-5266: validate existing TarCom — clear if out of weapon range
      // Uses actual weapon range (In_Range), not scanRange
      if (heli.target?.alive) {
        const existingDist = worldDist(heli.pos, heli.target.pos);
        if (existingDist > weaponRange) {
          // C++ techno.cpp:5264: Assign_Target(TARGET_NONE) — out of range
          heli.target = null;
        }
      }

      // C++ techno.cpp:5273: if (!Target_Legal(TarCom)) → Greatest_Threat
      if (!heli.target?.alive) {
        let bestTarget: Entity | null = null;
        let bestScore = -Infinity;
        for (const other of ctx.entities) {
          if (!other.alive || other.inLimbo) continue;
          if (ctx.entitiesAllied(heli, other)) continue;
          // C++ techno.cpp:1476-1479: units on sleep/harmless missions are invisible
          if (other.mission === Mission.SLEEP) continue;
          // C++ techno.cpp:1467-1470: fully cloaked units cannot be auto-targeted
          if (other.cloakState === CloakState.CLOAKED) continue;
          // C++ techno.cpp:1511-1523: range check using <= (inclusive)
          const dist = worldDist(heli.pos, other.pos);
          if (dist > scanRange) continue;
          const score = ctx.threatScore(heli, other, dist);
          if (score > bestScore) {
            bestTarget = other; bestScore = score;
          }
        }
        if (bestTarget) {
          heli.target = bestTarget;
        }
      }

      // C++ foot.cpp:593-594: if !Target_Something_Nearby → Random_Animate()
      // C++ infantry.cpp:1748: Random_Animate only runs for infantry (isReadyToRandomAnimate).
      // Aircraft are NOT infantry, so Random_Animate() is a no-op → no RNG consumed.

      // Also check for enemy structures in range (C++ Target_Something_Nearby includes buildings)
      if (!heli.target?.alive && heli.weapon) {
        let bestStruct: MapStructure | null = null;
        let bestStructDist = Infinity;
        for (const str of ctx.structures) {
          if (!str.alive) continue;
          if (str.house === House.Neutral) continue;
          if (ctx.isAllied(heli.house, str.house)) continue;
          const sPos = { x: str.cx * CELL_SIZE + CELL_SIZE, y: str.cy * CELL_SIZE + CELL_SIZE };
          const dist = worldDist(heli.pos, sPos);
          if (dist > scanRange) continue;
          if (dist < bestStructDist) {
            bestStructDist = dist;
            bestStruct = str;
          }
        }
        if (bestStruct) {
          heli.targetStructure = bestStruct;
        }
      }
    });
    return juicyFound;
  }

  /** C++ FootClass::Detach_All / ObjectClass::Detach_All(false).
   *  Used by TechnoClass::Do_Cloak before a cloakable unit enters CLOAKING.
   *  FootClass::Detach_All first removes team membership (foot.cpp:1848-1853),
   *  then Techno/Object detach clears target computers and team Target refs.
   *  all=false does not clear BulletClass TarCom (bullet.cpp:653 gates that on
   *  all=true). */
  private detachEntityFromTargeting(entity: Entity, all: boolean): void {
    if (entity.teamRef) {
      entity.teamRef.remove(entity, {
        entities: this.entities,
        map: this.map,
        tick: this.tick,
        canEnterCell: (e: Entity, cx: number, cy: number) => this.canEnterTrackJumpCell(e, cx, cy) === MoveResult.OK,
        startDriveClassMove: (e: Entity) => this.startDriveClassMove(e),
        stopInfantryDriver: (e: Entity) => this.stopInfantryDriver(e),
        canStopInfantryDriverForAssignDestination: (e: Entity) => this.canStopInfantryDriverForAssignDestination(e),
      });
    }

    for (const other of this.entities) {
      if (other.id === entity.id) continue;
      if (other.target === entity) {
        other.target = null;
        other.firePrepActive = false;
        other.firePrepStage = 0;
        other.firePrepUsesDoingStage = false;
        if (other.stats.isInfantry) {
          other.isFiringAnim = false;
          other.firingAnimTicks = 0;
        }
      }
    }
    for (const structure of this.structures) {
      if (structure.targetEntityId === entity.id) {
        structure.targetEntityId = undefined;
      }
    }

    for (const team of getActiveTeams()) {
      team.detachTargetEntity(entity);
    }

    for (const proj of this.inflightProjectiles) {
      if (proj.attackerId === entity.id && proj.dogRiderId !== entity.id) {
        proj.attackerId = -1;
      }
      if (all && proj.targetId === entity.id) {
        proj.targetId = -1;
      }
    }
  }

  private cleanupCompletedInfantryDeathAnimations(): number {
    // C++ deletes InfantryClass after the terminal death stage. The destructor
    // calls Limbo(), and ObjectClass::Limbo() runs Detach_All() before removing
    // the object from Logic. TS must broadcast the same detach here; otherwise
    // teams can retain a MissionTarget reference to an infantry object that no
    // longer exists in the logic layer.
    const shouldRemoveDeadEntity = (e: Entity): boolean =>
      !e.alive && e.stats.isInfantry && e.isInfantryDeathAnimationComplete();

    const before = this.entities.length;
    let removedBeforeStructures = 0;
    for (let i = 0; i < Math.min(this._preBuildingEntityCount, this.entities.length); i++) {
      const e = this.entities[i];
      if (shouldRemoveDeadEntity(e)) removedBeforeStructures++;
    }

    for (const e of this.entities) {
      if (!shouldRemoveDeadEntity(e)) continue;

      // Persist trigger name before entity is removed from array.
      if (e.triggerName) this.destroyedTriggerNames.add(e.triggerName);
      this.detachEntityFromTargeting(e, true);

      if (this.corpses.length >= Game.MAX_CORPSES) this.corpses.shift();
      this.corpses.push({
        x: e.pos.x, y: e.pos.y, type: e.type, facing: e.facing,
        isInfantry: e.stats.isInfantry, isAnt: e.isAnt, alpha: 0.5,
        deathVariant: e.deathVariant,
      });
    }

    this.entities = this.entities.filter(e => !shouldRemoveDeadEntity(e));
    const removed = before - this.entities.length;
    if (removed <= 0) return 0;

    // Keep the Logic split aligned with C++ insertion order. Dead initial
    // objects are removed from the pre-building partition; later spawned
    // reinforcements remain after buildings instead of sliding before them.
    this._preBuildingEntityCount = Math.max(0, this._preBuildingEntityCount - removedBeforeStructures);
    this.entityById.clear();
    for (const e of this.entities) this.entityById.set(e.id, e);
    for (const [g, ids] of this.controlGroups) {
      for (const id of ids) {
        if (!this.entityById.has(id)) ids.delete(id);
      }
      if (ids.size === 0) this.controlGroups.delete(g);
    }
    return removed;
  }

  /** Submarine cloaking state machine — manages cloak transitions for SS/MSUB.
   *  Auto-cloaks when idle + no enemies within 3 cells + sonarPulseTimer === 0.
   *  Auto-uncloaks when firing or taking damage (handled in entity.takeDamage). */
  private updateSubCloak(entity: Entity): void {
    // C++ techno.cpp:2599: CloakDelay counts down each tick; blocks cloaking while > 0
    if (entity.cloakDelay > 0) entity.cloakDelay--;
    switch (entity.cloakState) {
      case CloakState.CLOAKING:
        entity.cloakTimer--;
        if (entity.cloakTimer <= 0) {
          // C++ techno.cpp:2512-2531 — when Visual_Character reaches
          // VISUAL_HIDDEN, Cloak becomes CLOAKED and then Detach_All(false)
          // runs again. For FootClass this virtual dispatch removes the unit
          // from its team while preserving NavCom/path.
          entity.cloakState = CloakState.CLOAKED;
          entity.cloakTimer = 0;
          this.detachEntityFromTargeting(entity, false);
        } else {
          // C++ techno.cpp:2488-2503 — while CLOAKING, low-health units
          // can fail to stabilize during the VISUAL_DARKEN band and flip
          // back to UNCLOAKING on Percent_Chance(25). Visual_Character(true)
          // maps CloakingDevice stage 10..18 to VISUAL_DARKEN:
          // fixed(stage, MAX_UNCLOAK_STAGE=38) * 256 in [0x40, 0x80).
          const cloakStage = CLOAK_TRANSITION_FRAMES - entity.cloakTimer;
          const rawVisualStage = Math.floor((cloakStage * 256) / CLOAK_TRANSITION_FRAMES);
          if (rawVisualStage >= 0x40 && rawVisualStage < 0x80 &&
              entity.hp / entity.maxHp <= CONDITION_RED) {
            const savedTag = ScenarioRandom._sourceTag;
            if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = 60091;
            const shouldUncloak = ScenarioRandom.percentChance(25);
            if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = savedTag;
            if (shouldUncloak) {
              // C++ only changes Cloak=UNCLOAKING here; it does not reset
              // CloakingDevice stage/rate. Keeping cloakTimer preserves the
              // remaining distance back to VISUAL_NORMAL.
              entity.cloakState = CloakState.UNCLOAKING;
            }
          }
        }
        break;
      case CloakState.UNCLOAKING:
        entity.cloakTimer--;
        if (entity.cloakTimer <= 0) {
          entity.cloakState = CloakState.UNCLOAKED;
          entity.cloakTimer = 0;
          // C++ techno.cpp:2468: CloakDelay = Rule.CloakDelay * TICKS_PER_MINUTE
          entity.cloakDelay = CLOAK_DELAY_TICKS;
        }
        break;
      case CloakState.UNCLOAKED:
        // Auto-cloak when idle and sonar pulse expired (C++ TECHNO.CPP Cloak_AI)
        if (entity.sonarPulseTimer > 0) break;
        // C++ techno.cpp:2599: CloakDelay != 0 -> don't cloak (cooldown active)
        if (entity.cloakDelay > 0) break;
        // C++ techno.cpp:2594: Target_Legal(TarCom) && In_Range(TarCom)
        // blocks recloaking even if the weapon cannot fire yet due facing.
        if (entity.target?.alive && entity.inRange(entity.target)) break;
        if (entity.mission === Mission.ATTACK) break; // don't cloak while attacking
        // CL4: Don't cloak while weapon is on cooldown (C++ — firing prevents cloak)
        if (entity.weapon && entity.attackCooldown > 0) break;
        // C++ techno.cpp:2446-2451: below ConditionRed, low-health
        // recloak is gated by Percent_Chance(4), not a raw float threshold.
        if (entity.hp / entity.maxHp <= CONDITION_RED) {
          const savedTag = ScenarioRandom._sourceTag;
          if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = 60090;
          const shouldCloak = ScenarioRandom.percentChance(4);
          if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = savedTag;
          if (!shouldCloak) break;
        }
        // C++ TechnoClass::Do_Cloak calls Detach_All(false) before changing
        // Cloak to CLOAKING. This clears team Target overrides and object
        // TarCom refs to the submarine while preserving live bullet TarCom.
        this.detachEntityFromTargeting(entity, false);
        entity.cloakState = CloakState.CLOAKING;
        entity.cloakTimer = CLOAK_TRANSITION_FRAMES;
        break;
      case CloakState.CLOAKED:
        // Uncloak is handled by takeDamage and fire logic
        break;
    }
  }

  /** Medic auto-heal AI — C++ infantry.cpp InfantryClass::AI() medic behavior.
   *  Medics scan for nearest damaged friendly infantry within sight range,
   *  move toward them, and heal when adjacent. Medics are non-combat units
   *  and never attack enemies. They flee when frightened (fear/prone system). */
  private updateMedic(entity: Entity): void {
    this._runSpecialUnits(ctx => _updateMedic(ctx, entity));
  }

  /** Area Guard — delegates to missionAI.ts */
  private updateAreaGuard(entity: Entity, timerFired = true): void {
    this._runMissionAI(ctx => _updateAreaGuard(ctx, entity, timerFired));
  }

  /**
   * C++ foot.cpp:856-946 Approach_Target — find a cell within weapon range
   * of the target and assign it as moveTarget. Only called when moveTarget
   * is empty (!Target_Legal(NavCom) in C++).
   *
   * C++ sweeps from the target's position outward toward the unit, trying
   * angular offsets, looking for a passable cell within weapon range.
   * For simplicity, TS finds the cell on the direct path from target to
   * unit that's within weapon range.
   */
  private shouldMissionAttackApproach(entity: Entity): boolean {
    if (!entity.target?.alive || !entity.weapon) return false;
    // C++ FootClass::Approach_Target is gated by !Target_Legal(NavCom).
    if (entity.moveTarget) return false;
    if (!entity.inRange(entity.target)) return true;

    // C++ foot.cpp:947 uses TechnoClass::IsLocked here. That flag means the
    // object has entered the playable map/radar area, not that PrimaryFacing is
    // aimed at TarCom. In-range locked infantry should stay put and let
    // Firing_AI rotate/start DO_FIRE_WEAPON instead of assigning NavCom.
    return !this.map.inBounds(entity.cell.cx, entity.cell.cy);
  }

  private approachTarget(entity: Entity): void {
    if (!entity.target?.alive || !entity.weapon) return;
    if (entity.moveTarget) return;

    // C++ foot.cpp:856-946 — exact Approach_Target implementation.
    // maxrange = Weapon_Range - 0x00B7 (183 leptons)
    const weaponRangeLeptons = entity.weapon.range * LEPTON_SIZE; // e.g. 3*256=768
    let maxrange = weaponRangeLeptons - 0xB7; // 768-183=585
    maxrange = Math.max(maxrange, 0);

    const targetLX = entity.target.leptonX;
    const targetLY = entity.target.leptonY;

    // C++ Direction256(tcoord, Center_Coord()) — from target to entity's actual position.
    // Center_Coord() returns the object's Coord (sub-cell position for infantry).
    const entityLX = entity.leptonX;
    const entityLY = entity.leptonY;
    const dir256 = directionToLeptons256(targetLX, targetLY, entityLX, entityLY);

    // C++ sweep: angular offsets [0, 8, -8, 16, -16, 24, -24, 32, -32, 48, -48, 64, -64]
    const _angles = [0, 8, -8, 16, -16, 24, -24, 32, -32, 48, -48, 64, -64];
    let found = false;
    let bestCX = 0, bestCY = 0;
    let fallbackCX = Math.floor(targetLX / 256);
    let fallbackCY = Math.floor(targetLY / 256);

    // C++ sweeps from maxrange inward in steps of 0x0100 (256 leptons = 1 cell)
    for (let range = maxrange; range > 0x0080; range -= 0x0100) {
      for (const angleOff of _angles) {
        const tryDir = (dir256 + angleOff) & 0xFF;
        // C++ Coord_Move: uses COS_TABLE_256/SIN_TABLE_256 lookup tables
        const tryLX = targetLX + ((COS_TABLE_256[tryDir] * range) >> 7);
        const tryLY = targetLY - ((SIN_TABLE_256[tryDir] * range) >> 7);
        // Check distance from target < range (C++ sanity check)
        const distFromTarget = leptonDist(tryLX, tryLY, targetLX, targetLY);
        if (distFromTarget < range) {
          const tryCX = Math.floor(tryLX / 256);
          const tryCY = Math.floor(tryLY / 256);
          fallbackCX = tryCX;
          fallbackCY = tryCY;
          // C++ foot.cpp:992 calls CellClass::Is_Clear_To_Move with the
          // object's SpeedType. FLOAT vessels must evaluate WATER terrain here;
          // using land passability makes naval Approach_Target miss valid water
          // cells and fall back near the target (SCG07EA opening sub chase).
          const cellIdx = tryCY * 128 + tryCX;
          const terrainClear = entity.isNavalUnit
            ? this.map.isWaterPassable(tryCX, tryCY)
            : this.map.isTerrainPassable(tryCX, tryCY);
          const vehicleReservation = this.map.getVehicleTrackReservation(tryCX, tryCY);
          if (tryCX >= 0 && tryCX < 128 && tryCY >= 0 && tryCY < 128 &&
              terrainClear &&
              !this.map.vehicleOccupancy.has(cellIdx) &&
              this.map.occupancy[cellIdx] === 0 &&
              vehicleReservation === 0) {
            bestCX = tryCX;
            bestCY = tryCY;
            found = true;
            break;
          }
        }
      }
      if (found) break;
    }

    if (!found) {
      // C++ foot.cpp:1010-1011: if the approach sweep finds no clear cell,
      // fall back through Map.Nearby_Location(trycell), choosing by Frame % count.
      // Game.update increments TS tick before AI dispatch; C++ Frame still names
      // the frame being processed. Use tick-1 so first-frame AI sees Frame % n == 0.
      const nearby = nearbyLocation(this.map, { cx: fallbackCX, cy: fallbackCY }, entity.isNavalUnit, Math.max(0, this.tick - 1));
      bestCX = nearby?.cx ?? fallbackCX;
      bestCY = nearby?.cy ?? fallbackCY;
    }

    // C++ FootClass::Approach_Target only Assign_Destination()s the chosen
    // cell. It does not compute a path here; class-specific Movement_AI /
    // DriveClass::AI runs Basic_Path afterward with the full Can_Enter_Cell
    // predicate for the moving object. InfantryClass::Assign_Destination first
    // stops an active driver when the current cell is clear, so the new NavCom
    // can start a fresh Basic_Path in this same Movement_AI pass.
    if (entity.stats.isInfantry && entity.isDriving && this.canStopInfantryDriverForAssignDestination(entity)) {
      this.stopInfantryDriver(entity);
    }
    entity.moveTarget = cellTargetToLepton(bestCX, bestCY);
    this.clearDrivePath(entity);
    resetPathThreshold(entity);

  }

  /** Retreat — delegates to missionAI.ts */
  private updateRetreat(entity: Entity): void {
    if (entity.stats.isVessel && entity.isTransport && entity.moveTarget === null) {
      this.abortTransportRadioContactForNewDestination(entity);
    }
    this._runMissionAI(ctx => _updateRetreat(ctx, entity));
  }

  /** Transport evacuate — delegates to missionAI.ts */
  private orderTransportEvacuate(transport: Entity): void {
    this._runMissionAI(ctx => _orderTransportEvacuate(ctx, transport));
  }

  /** Ambush — delegates to missionAI.ts */
  private updateAmbush(entity: Entity): void {
    this._runMissionAI(ctx => _updateAmbush(ctx, entity));
  }

  /** Repair mission — delegates to missionAI.ts */
  private updateRepairMission(entity: Entity): void {
    this._runMissionAI(ctx => _updateRepairMission(ctx, entity));
  }

  /** Attack structure — delegates to missionAI.ts */
  private updateAttackStructure(entity: Entity, s: MapStructure): void {
    this._runMissionAI(ctx => _updateAttackStructure(ctx, entity, s));
  }

  /** Force-fire on ground — delegates to missionAI.ts */
  private updateForceFireGround(entity: Entity): void {
    this._runMissionAI(ctx => _updateForceFireGround(ctx, entity));
  }

  /** Defensive structure auto-fire — pillboxes, guard towers, tesla coils fire at nearby enemies */
  private updateStructureCombat(): void {
    this._runCombat(ctx => _updateStructureCombat(ctx));
  }

  /** Queen Ant spawns ants periodically (rate/composition affected by difficulty) */
  private updateQueenSpawning(): void {
    if (!this.autocreateEnabled) return;
    const mods = DIFFICULTY_MODS[this.difficulty] ?? DIFFICULTY_MODS.normal;
    for (const s of this.structures) {
      if (!s.alive || s.type !== 'QUEE') continue;
      if (this.isAllied(s.house, this.playerHouse)) continue; // player queens don't spawn
      // Don't spawn if too many ants already alive (cap by difficulty)
      const nearbyAnts = this.entities.filter(e =>
        e.alive && e.isAnt && worldDist(e.pos, {
          x: s.cx * CELL_SIZE + CELL_SIZE, y: s.cy * CELL_SIZE + CELL_SIZE,
        }) < CELL_SIZE * 15
      ).length;
      if (nearbyAnts >= mods.maxAnts) continue;
      // Spawn 1-2 ants near the queen (scaled by difficulty waveSize)
      const baseCount = 1 + (ScenarioRandom.float() < 0.4 ? 1 : 0);
      const count = Math.max(1, Math.round(baseCount * mods.waveSize));
      // Difficulty affects ant type composition: higher difficulty = more fire ants (ANT3)
      for (let i = 0; i < count; i++) {
        let aType: UnitType;
        const roll = ScenarioRandom.float();
        const remaining = 1 - mods.fireAntChance;
        if (roll < mods.fireAntChance) {
          aType = UnitType.ANT3; // fire ant (strongest)
        } else if (roll < mods.fireAntChance + remaining * 0.5) {
          aType = UnitType.ANT2; // warrior ant (50% of remaining)
        } else {
          aType = UnitType.ANT1; // soldier ant (50% of remaining)
        }
        const ox = (ScenarioRandom.float() - 0.5) * CELL_SIZE * 3;
        const oy = (ScenarioRandom.float() - 0.5) * CELL_SIZE * 3;
        const spawnX = s.cx * CELL_SIZE + CELL_SIZE + ox;
        const spawnY = s.cy * CELL_SIZE + CELL_SIZE + oy;
        // Only spawn on passable terrain
        const sc = worldToCell(spawnX, spawnY);
        if (!this.map.isPassable(sc.cx, sc.cy)) continue;
        const house = s.house;
        const ant = new Entity(aType, house, spawnX, spawnY);
        applyScenarioOverrides([ant], this.scenarioUnitStats, this.scenarioWeaponStats);
        ant.mission = Mission.AREA_GUARD;
        ant.guardOrigin = { x: spawnX, y: spawnY };
        this.entities.push(ant);
        this.entityById.set(ant.id, ant);
      }
    }
  }

  // tickOreRegeneration removed — logic moved to GameMap.growOre() for C++ parity

  /** Calculate threat score for guard targeting — delegates to pure function in entity.ts */
  /** Check if scanner can target this entity considering naval combat rules.
   *  - Cloaked subs need isAntiSub weapon
   *  - Torpedoes (isSubSurface) only hit naval
   *  - Cruisers can't target infantry */
  private canTargetNaval(scanner: Entity, target: Entity): boolean {
    return _canTargetNaval(scanner, target);
  }

  /** Find a landing pad for this aircraft. Returns structure index or -1. */
  private findLandingPad(entity: Entity): number {
    return _findLandingPad(this._aircraftCtx, entity);
  }

  /** Get target position for an aircraft's current target (entity or structure) */
  private getAircraftTargetPos(entity: Entity): WorldPos | null {
    return _getAircraftTargetPos(entity);
  }

  /** Aircraft state machine — returns true if aircraft handled this tick (skip normal update) */
  private updateAircraft(entity: Entity): boolean {
    return this._runAircraft(ctx => _updateAircraft(ctx, entity));
  }

  /** Fixed-wing attack run — delegates to aircraft.ts */
  private updateFixedWingAttackRun(entity: Entity): boolean {
    return this._runAircraft(ctx => _updateFixedWingAttackRun(ctx, entity));
  }

  /** Helicopter hover attack — delegates to aircraft.ts */
  private updateHelicopterAttack(entity: Entity): boolean {
    return this._runAircraft(ctx => _updateHelicopterAttack(ctx, entity));
  }

  /** Fire weapon at entity target — delegates to combat.ts */
  private fireWeaponAt(attacker: Entity, target: Entity, weapon: WeaponStats): void {
    this._runCombat(ctx => _fireWeaponAt(ctx, attacker, target, weapon));
  }

  /** Fire weapon at coordinate target — delegates to combat.ts */
  private fireWeaponAtCoord(attacker: Entity, weapon: WeaponStats, impact: WorldPos): void {
    this._runCombat(ctx => _fireWeaponAtCoord(ctx, attacker, weapon, impact));
  }

  /** Fire weapon at structure target — delegates to combat.ts */
  private fireWeaponAtStructure(attacker: Entity, s: MapStructure, weapon: WeaponStats): void {
    this._runCombat(ctx => _fireWeaponAtStructure(ctx, attacker, s, weapon));
  }

  /** Unit death aftermath — delegates to combat.ts */
  private handleUnitDeath(victim: Entity, opts: {
    screenShake: number;
    explosionSize: number;
    debris: boolean;
    decal: { infantry: number; vehicle: number; opacity: number } | null;
    explodeLgSound: boolean;
    attackerIsPlayer: boolean;
    trackLoss: boolean;
    friendlyFireLoss?: boolean;
    attacker?: Entity;
  }): void {
    this._runCombat(ctx => _handleUnitDeath(ctx, victim, opts));
  }

  private threatScore(scanner: Entity, target: Entity, dist: number): number {
    // AI4: Designated enemy from AI house state (if any)
    const aiState = this.aiStates.get(scanner.house);
    const designatedEnemy = aiState?.designatedEnemy ?? null;
    // AI5: Area_Modify — count friendly buildings near target when PrimaryWeapon->IsSupressed.
    // C++ techno.cpp:1345 returns 1 unless the primary weapon has IsSupressed.
    let nearFriendlyCount = 0;
    if (scanner.weapon?.isSupressed) {
      const tcx = target.pos.x / CELL_SIZE;
      const tcy = target.pos.y / CELL_SIZE;
      for (const s of this.structures) {
        if (!s.alive || !this.isAllied(s.house, scanner.house)) continue;
        const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
        const scx = s.cx + sw / 2;
        const scy = s.cy + sh / 2;
        const d = Math.sqrt((scx - tcx) ** 2 + (scy - tcy) ** 2);
        if (d <= 1.0) nearFriendlyCount++;
      }
    }
    // C++ techno.cpp:1668-1670: `object->House->Which_Zone(object) == ZONE_NONE`.
    // This is a property of the target's house, not only AI-controlled houses.
    // Player reinforcements outside their own base zone get the same 2x boost.
    let isTargetOutOfZone = false;
    {
      let hasOwnBase = false;
      let nearOwnBase = false;
      for (const s of this.structures) {
        if (!s.alive || s.house !== target.house) continue;
        hasOwnBase = true;
        const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
        const scx = (s.cx + sw / 2) * CELL_SIZE;
        const scy = (s.cy + sh / 2) * CELL_SIZE;
        const d = Math.sqrt((scx - target.pos.x) ** 2 + (scy - target.pos.y) ** 2);
        if (d <= 10 * CELL_SIZE) { nearOwnBase = true; break; } // ~10 cells = base zone radius
      }
      isTargetOutOfZone = hasOwnBase && !nearOwnBase;
    }
    // C++ techno.cpp:1742-1744: NervousBias = BaseBias from rules.ini = 2
    // Applied when target is in scanner's own base zone (C++ House::Which_Zone)
    // Approximate zone check: target is within 10 cells of scanner's own structures
    const NERVOUS_BIAS = 2; // rules.ini [General] BaseBias=2
    let nervousBias: number | undefined;
    let targetInScannerBaseZone = false;
    for (const s of this.structures) {
      if (!s.alive || s.house !== scanner.house) continue;
      const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
      const scx = (s.cx + sw / 2) * CELL_SIZE;
      const scy = (s.cy + sh / 2) * CELL_SIZE;
      const d = Math.sqrt((scx - target.pos.x) ** 2 + (scy - target.pos.y) ** 2);
      if (d <= 10 * CELL_SIZE) { targetInScannerBaseZone = true; break; }
    }
    if (targetInScannerBaseZone) {
      nervousBias = NERVOUS_BIAS;
    }
    // C++ techno.cpp:4549-4566 — TechnoClass::Value includes transport
    // contents when the target's house difficulty allows content scan or
    // House->IQ >= Rule.IQContentScan. This is visible in SCG07EA: the USSR
    // submarine targets the Greek LST because its attached MCV/tank/jeep cargo
    // is included in Value(), outranking the closer PT boats.
    const targetIQ = this.houseIQs.get(target.house) ?? this.aiStates.get(target.house)?.iq ?? 0;
    const includeTransportContents =
      (AI_DIFFICULTY_MODS[this.difficulty] ?? AI_DIFFICULTY_MODS.normal).isContentScan ||
      targetIQ >= 4;

    return computeThreatScore(scanner, target, dist, designatedEnemy, nearFriendlyCount, isTargetOutOfZone, nervousBias, includeTransportContents);
  }

  private getWarheadMult(warhead: WarheadType, armor: ArmorType): number {
    return _getWarheadMult(warhead, armor, this.warheadOverrides);
  }

  private getWarheadMeta(warhead: WarheadType): WarheadMeta {
    return _getWarheadMeta(warhead, this.scenarioWarheadMeta);
  }

  private getWarheadProps(warhead: WarheadType | string | undefined): WarheadProps | undefined {
    return _getWarheadProps(warhead as WarheadType, this.scenarioWarheadProps);
  }

  private damageEntity(
    target: Entity,
    amount: number,
    warhead: WarheadType,
    attacker?: Entity,
    options?: { skipProneBias?: boolean; skipEntityArmorBias?: boolean; skipHouseArmorBias?: boolean },
  ): boolean {
    return this._runCombat(ctx => _damageEntity(ctx, target, amount, warhead, attacker, options));
  }

  /** AI scatter — delegates to combat.ts */
  private aiScatterOnDamage(entity: Entity): void {
    _aiScatterOnDamage(this._combatCtx, entity);
  }

  /** Damage-based speed reduction — delegates to combat.ts */
  private damageSpeedFactor(entity: Entity): number {
    return _damageSpeedFactor(entity);
  }

  /** M1+M2: Compute movement speed with terrain and damage multipliers.
   *  Speed values in UNIT_STATS are rules.ini percentages (0-100); MPH_TO_PX converts
   *  to pixels/tick via C++ _Scale_To_256 scaling (techno.cpp:6287).
   *  C++ house.cpp:290,300: GroundspeedBias from difficulty applied per house.
   *  C++ house.cpp:291,301: AirspeedBias from difficulty applied to aircraft.
   *  C++ infantry.cpp:4020-4021: Dogs get 2x movement speed only when they
   *  have a legal TarCom (combat target), not merely NavCom/path movement. */
  private movementSpeed(entity: Entity, speedCell: { cx: number; cy: number } = entity.cell): number {
    const speedBias = entity.stats.isAircraft
      ? this.getAirspeedBias(entity.house)
      : this.getGroundspeedBias(entity.house);
    // C++ infantry.cpp:4019 — infantry moves at full speed regardless of terrain type.
    // Only vehicles (DriveClass) apply terrain speed modifiers via Speed_Boost.
    const terrainMult = entity.stats.isInfantry ? 1.0 : this.map.getSpeedMultiplier(speedCell.cx, speedCell.cy, entity.stats.speedClass);
    let baseSpeed = entity.stats.speed * MPH_TO_PX * this.damageSpeedFactor(entity) * speedBias;

    // C++ infantry.cpp:4020-4021: canine sprint is combat-only.
    // NavCom/patrol movement does not double speed; only legal TarCom does.
    if (entity.stats.isCanine && entity.target?.alive) {
      baseSpeed *= 2;
    }

    if (terrainMult <= 0 && baseSpeed > 0) {
      // Can happen transiently during diagonal track movement when the pixel center
      // briefly crosses a building footprint or impassable cell boundary (benign).
      // Only warn when the unit is stationary (not in a track) — that indicates a
      // real classification bug or bad spawn placement.
      if (!entity.trackNumber) {
        console.warn(`[movement] unit ${entity.type}(${entity.id}) at (${entity.cell.cx},${entity.cell.cy}) has 0 terrain speed — forcing base speed`);
      }
      return baseSpeed;
    }
    return baseSpeed * terrainMult;
  }

  /** C++ drive.cpp:1164-1190 Start_Of_Move terrain throttle.
   *
   * FootClass::Speed is not MaxSpeed. It is a raw 0..256 throttle derived from
   * destination terrain cost, with yellow-health slowdown applied here. C++
   * then multiplies this throttle by TechnoType::MaxSpeed in While_Moving.
   */
  private driveSpeedThrottleRaw(entity: Entity, speedCell: { cx: number; cy: number } = entity.cell): number {
    const terrainMult = entity.stats.isInfantry
      ? 1.0
      : this.map.getSpeedMultiplier(speedCell.cx, speedCell.cy, entity.stats.speedClass);
    const authorizedStructureMult =
      !entity.stats.isInfantry &&
      !entity.isAirUnit &&
      !entity.isNavalUnit &&
      (this.isAuthorizedFactoryTetherCell(entity, speedCell.cx, speedCell.cy) ||
        this.isAuthorizedBuildingEnterCell(entity, speedCell.cx, speedCell.cy))
        ? (TERRAIN_SPEED.Clear[entity.stats.speedClass] ?? 1.0)
        : null;
    let speed = Math.floor((authorizedStructureMult ?? terrainMult) * 256);
    if (speed <= 0 && entity.stats.speed > 0) {
      // drive.cpp:1169 — impassable/zero-cost terrain still gets a tiny throttle.
      speed = 128;
    }
    if (entity.hp * 2 <= entity.maxHp) {
      // drive.cpp:1185 — damage affects FootClass::Speed, not MaxSpeed.
      speed -= Math.floor(speed / 4);
    }
    return speed;
  }

  /** C++ drive.cpp:684 — integer MaxSpeed before applying FootClass::Speed. */
  private driveClassMaxSpeedLeptons(entity: Entity): number {
    const iniSpeed = Math.max(0, Math.min(100, entity.stats.speed));
    const typeMaxSpeed = Math.min(255, Math.floor((iniSpeed * 256) / 100));
    const biased = typeMaxSpeed * entity.speedBias * this.getGroundspeedBias(entity.house);
    return Math.min(255, Math.floor(biased));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Infantry Movement — C++ InfantryClass::Start_Driver + Movement_AI parity
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * C++ InfantryClass::Start_Driver (infantry.cpp:2080-2114):
   * Finds a free sub-cell in the destination cell using Closest_Free_Spot,
   * then atomically swaps occupy bits (clear current, set destination).
   * Returns the HeadToCoord (sub-cell lepton position) the infantry should walk to.
   */
  private infantryStartDriver(entity: Entity, destCX: number, destCY: number): LeptonPos | null {
    // C++ Adjacent_Cell(Coord, Path[0]) snaps to the center of the adjacent
    // cell via Coord_Snap before Start_Driver selects the destination sub-cell.
    let headToLX = destCX * 256 + 128;
    let headToLY = destCY * 256 + 128;

    // C++ Closest_Free_Spot probe: offset 124 leptons OPPOSITE the approach direction
    const dir = directionToLeptons256(entity.leptonX, entity.leptonY, headToLX, headToLY);
    const probeDir = (dir + 128) & 0xFF;
    const probeLX = headToLX + ((COS_TABLE_256[probeDir] * 124) >> 7);
    const probeLY = headToLY - ((SIN_TABLE_256[probeDir] * 124) >> 7);

    // C++ CellClass::Spot_Index: Distance(rel, 0x00800080) < 60,
    // using the engine's integer octagonal Distance(), not a float estimate.
    const spotIndex = this.infantrySpotIndex(probeLX, probeLY);

    // Find free sub-cell via C++ Closest_Free_Spot search order
    const destIdx = destCY * 128 + destCX;
    let destSlots = this.map.subCellOccupancy.get(destIdx);
    if (!destSlots) {
      destSlots = [0, 0, 0, 0, 0] as [number, number, number, number, number];
      this.map.subCellOccupancy.set(destIdx, destSlots);
    }
    const cellBlocked =
      this.map.vehicleOccupancy.has(destIdx) ||
      this.map.vehicleTrackReservations.has(destIdx);
    if (cellBlocked) return null;

    let freeSubCell = -1;
    if (destSlots[spotIndex] === 0) {
      freeSubCell = spotIndex;
    } else {
      // C++ cell.cpp:1819-1852: when the requested spot is CENTER and it is
      // occupied, all four corner locations are equidistant. The original uses
      // Random_Pick(0, 3) to rotate the corner scan order instead of falling
      // through to _sequence[0]. Non-center requested spots use _sequence.
      const _sequence: number[][] = [
        [1,2,3,4], [0,2,3,4], [0,1,4,3], [0,1,4,2], [0,2,3,1]
      ];
      const _alternate: number[][] = [
        [1,2,3,4], [2,3,4,1], [3,4,1,2], [4,1,2,3]
      ];
      const sequence = spotIndex === 0
        ? _alternate[ScenarioRandom.nextInRange(0, 3)]
        : _sequence[spotIndex];
      for (const s of sequence) {
        if (destSlots[s] === 0) {
          freeSubCell = s;
          break;
        }
      }
    }
    if (freeSubCell < 0) return null;

    const sc = SUBCELL_LEPTON_OFFSETS[freeSubCell];
    headToLX = destCX * 256 + sc.lx;
    headToLY = destCY * 256 + sc.ly;

    // Atomic occupy-bit swap: release previous claim, set new claim.
    //
    // C++ InfantryClass::Start_Driver chooses the destination sub-cell while
    // the current Coord's occupy bit is still set, then after
    // FootClass::Start_Driver succeeds it always calls Clear_Occupy_Bit(Coord)
    // before Set_Occupy_Bit(headto). Do the same by current coordinate, not
    // only by cached claimedCellIdx: occupancy rebuilds can mark an idle
    // infantry's current sub-cell even if its cached claim was absent.
    if (entity.claimedCellIdx >= 0 && entity.claimedSubCell >= 0) {
      this.clearInfantryOccupyBit(entity.claimedCellIdx, entity.claimedSubCell);
    }
    // C++ Clear_Occupy_Bit(Coord) clears by the coordinate's sub-cell bit,
    // not by ownership. This preserves the original bitmask collision behavior
    // when multiple infantry overlap the same stopping coordinate.
    const currentCellIdx = entity.cell.cy * MAP_CELLS + entity.cell.cx;
    this.clearInfantryOccupyBit(
      currentCellIdx,
      this.infantrySpotIndex(entity.leptonX, entity.leptonY),
    );
    destSlots[freeSubCell] = entity.id;
    if (this.map.occupancy[destIdx] === 0) this.map.occupancy[destIdx] = entity.id;
    entity.claimedCellIdx = destIdx;
    entity.claimedSubCell = freeSubCell;
    entity.scenarioInitUnlimbo = false;

    // Store HeadToCoord on entity
    entity.headToLX = headToLX;
    entity.headToLY = headToLY;

    return { lx: headToLX, ly: headToLY };
  }

  private clearInfantryOccupyBit(cellIdx: number, subCell: number): void {
    if (cellIdx < 0 || cellIdx >= MAP_CELLS * MAP_CELLS || subCell < 0 || subCell >= 5) return;
    this.map.vacateClaimedSubCell(cellIdx, 0, subCell);
    for (const other of this.entities) {
      if (other.stats.isInfantry &&
          other.claimedCellIdx === cellIdx &&
          other.claimedSubCell === subCell) {
        other.claimedCellIdx = -1;
        other.claimedSubCell = -1;
      }
    }
  }

  /** C++ CellClass::Spot_Index (cell.cpp:1744-1766). */
  private infantrySpotIndex(lx: number, ly: number): number {
    const fracX = ((lx % LEPTON_SIZE) + LEPTON_SIZE) % LEPTON_SIZE;
    const fracY = ((ly % LEPTON_SIZE) + LEPTON_SIZE) % LEPTON_SIZE;
    if (leptonDist(fracX, fracY, 0x80, 0x80) < 60) return 0;
    let index = 0;
    if (fracX > 0x80) index |= 0x01;
    if (fracY > 0x80) index |= 0x02;
    return index + 1;
  }

  /** C++ InfantryClass::Stop_Driver (infantry.cpp:2042-2067).
   *  Clear the destination Head_To_Coord occupation, set occupation at the
   *  infantry's current Coord, then clear HeadToCoord/IsDriving via FootClass.
   */
  private stopInfantryDriver(entity: Entity): void {
    if (!entity.stats.isInfantry) {
      entity.isDriving = false;
      entity.headToLX = 0;
      entity.headToLY = 0;
      return;
    }

    if (entity.claimedCellIdx >= 0 && entity.claimedSubCell >= 0) {
      this.clearInfantryOccupyBit(entity.claimedCellIdx, entity.claimedSubCell);
    }

    const cx = Math.max(0, Math.min(MAP_CELLS - 1, Math.floor(entity.leptonX / LEPTON_SIZE)));
    const cy = Math.max(0, Math.min(MAP_CELLS - 1, Math.floor(entity.leptonY / LEPTON_SIZE)));
    const cellIdx = cy * MAP_CELLS + cx;
    const spotIndex = this.infantrySpotIndex(entity.leptonX, entity.leptonY);
    if (this.map.occupyClaimedSubCell(cellIdx, entity.id, spotIndex)) {
      entity.claimedCellIdx = cellIdx;
      entity.claimedSubCell = spotIndex;
      entity.subCell = spotIndex;
    } else {
      entity.claimedCellIdx = -1;
      entity.claimedSubCell = -1;
    }

    entity.isDriving = false;
    entity.headToLX = 0;
    entity.headToLY = 0;
  }

  /** C++ InfantryClass::Assign_Destination (infantry.cpp:1046).
   *  A moving infantry unit only Stop_Driver()s before accepting a new legal
   *  NavCom when its current Center_Coord cell is clear for its locomotion,
   *  ignoring infantry but not vehicles/buildings. If the cell is not clear
   *  (e.g. rock/blocked terrain while the unit is mid-hop), C++ keeps the
   *  active Head_To_Coord and merely rewrites NavCom/Path[0].
   */
  private canStopInfantryDriverForAssignDestination(entity: Entity): boolean {
    if (!entity.stats.isInfantry) return true;
    const cx = Math.max(0, Math.min(MAP_CELLS - 1, Math.floor(entity.leptonX / LEPTON_SIZE)));
    const cy = Math.max(0, Math.min(MAP_CELLS - 1, Math.floor(entity.leptonY / LEPTON_SIZE)));
    const idx = cy * MAP_CELLS + cx;
    if (!this.map.isTerrainPassable(cx, cy)) return false;
    if (this.map.vehicleOccupancy.has(idx) || this.map.vehicleTrackReservations.has(idx)) return false;
    return true;
  }

  /**
   * C++ Movement_AI path validation (infantry.cpp:3810):
   * Check if the next path cell can be entered. If all sub-cells are occupied,
   * regenerate the path from current position.
   */
  private infantryValidatePath(entity: Entity): void {
    if (!entity.path.length || entity.pathIndex >= entity.path.length || !entity.moveTarget) return;
    const nextCell = entity.path[entity.pathIndex];
    if (this.infantryCanEnterCell(entity, nextCell.cx, nextCell.cy) !== MoveResult.OK) {
      const goal = {
        cx: Math.floor(entity.moveTarget.lx / 256),
        cy: Math.floor(entity.moveTarget.ly / 256),
      };
      const newPath = this.findDriveClassBasicPath(entity, this.resolveInfantryBasicPathGoal(entity, goal));
      if (newPath.length > 0) {
        this.setInfantryBasicPath(entity, newPath);
      } else {
        entity.path = [];
        entity.pathIndex = 0;
      }
    }
  }

  /** MV1: Follow one tick of track-table movement (C++ drive.cpp While_Moving).
   *  Steps through pre-computed track coordinates. Each step costs PIXEL_LEPTON_W leptons
   *  of movement budget. Position = targetCellCenter + Smooth_Turn(offset, flags).
   *  Returns true when track is complete (reached target cell center). */
  private followTrackStep(entity: Entity, speedThrottleRaw: number, targetX: number, targetY: number): boolean {
    let track = getTrackArray(entity.trackNumber);
    if (!track) {
      this.stopDriveTrack(entity);
      entity.trackNumber = -1; entity.trackControlIndex = -1;
      entity.trackCellSpan = 1;
      return true;
    }
    let flags = entity.trackFlags;
    // C++ DriveClass::While_Moving starts by Mark(MARK_UP), then re-applies
    // Mark(MARK_DOWN) after the movement budget is spent. This matters after
    // RawTracks[tracknum].Cell has been passed: Mark_Track stops reserving the
    // intermediate cell, allowing a following vehicle to track-jump through it.
    // TS previously kept the start-of-track reservation until Stop_Driver,
    // leaving stale moving-block cells behind fast/curved tracks.
    this.clearDriveTrackReservations(entity);

    // C++ drive.cpp:688-696: Determine if there's a turn coming up for track
    // jumping. `nextface = Path[0]`; Start_Of_Move/track-jump memmove has
    // already shifted away the path entry that selected the current track.
    //
    // TS stores an absolute cell path plus a cursor. After an F_D track jump the
    // cursor can lag behind the active Head_To_Coord by one cell because C++
    // jumps to `Adjacent_Cell(Head_To_Coord(), nextface)` and then memmoves
    // Path by only one entry. Anchor the queued next-face lookup on the active
    // Head_To_Coord cell, not on the stale absolute cursor. That is the direct
    // equivalent of C++ Path[0] during While_Moving.
    //
    // adj = true when nextface differs from the current track's ending facing.
    let nextFace8 = -1; // -1 = FACING_NONE (no next direction)
    let adj = false;
    let jumpToCell: { cx: number; cy: number } | undefined;
    const tcIdx = entity.trackControlIndex;
    if (tcIdx >= 0 && tcIdx < TRACK_CONTROL.length) {
      const headCell = {
        cx: Math.floor(targetX / CELL_SIZE),
        cy: Math.floor(targetY / CELL_SIZE),
      };
      if (entity.drivePathFacings.length > 0) {
        nextFace8 = entity.drivePathFacings[0];
        // C++ drive.cpp:695: adj = (nextface != FACING_NONE && Dir_Facing(track->Facing) != nextface)
        const currentEndFacing8 = Math.floor(TRACK_CONTROL[tcIdx].facing / 32);
        if (nextFace8 !== currentEndFacing8) {
          adj = true;
          // C++ drive.cpp:766-768 uses Head_To_Coord() plus nextface, not the
          // next path cell. For F_D tracks Head_To_Coord() is the second cell.
          jumpToCell = {
            cx: Math.floor(targetX / CELL_SIZE) + DIR_DX[nextFace8],
            cy: Math.floor(targetY / CELL_SIZE) + DIR_DY[nextFace8],
          };
        }
      }
    }

    // C++ drive.cpp:679-686: MaxSpeed * SpeedBias * House->GroundspeedBias,
    // then actual = SpeedAccum + maxspeed * fixed(FootClass::Speed, 256).
    //
    // There is a real C++ wart here: DriveClass::While_Moving checks
    // `((UnitClass *)this)->Flagged != HOUSE_NONE` to halve flag-carrier speed.
    // VesselClass also inherits DriveClass, so the C-style cast is invalid for
    // vessels but still compiled/executed; current WASM probes show LST entering
    // the half-speed branch (`wact=17` for MaxSpeed=35). Model that DriveClass
    // behavior for vessels rather than treating naval movement as full speed.
    const activeThrottle = entity.driveSpeed > 0 ? entity.driveSpeed : speedThrottleRaw;
    const maxSpeedLeptons = this.driveClassMaxSpeedLeptons(entity);
    const driveMaxSpeed = entity.stats.isVessel
      ? Math.floor(maxSpeedLeptons / 2)
      : maxSpeedLeptons;

    // C++ `fixed` multiply rounds: ((driveMaxSpeed * Speed) + 128) / 256.
    // The ordering matters. Terrain/damage modifies FootClass::Speed; it does
    // not pre-scale MaxSpeed as a floating pixel speed. SCG13EA MRJ at t1047
    // is the observable case: TRACK clear throttle 204, yellow health -> 153;
    // MaxSpeed 23; speedAdd=floor((23*153+128)/256)=14.
    const speedAdd = Math.floor((driveMaxSpeed * activeThrottle + 128) / 256);
    let actual = entity.speedAccum + speedAdd;
    // Instrument: total leptons granted this followTrackStep invocation (entry accum + add)
    const speedGranted = actual;

    // Track number for RawTracks lookup (C++ uses tracknum = track->Track or track->StartTrack)
    let rawTrackNum = entity.trackNumber;

    while (actual > PIXEL_LEPTON_W) {
      actual -= PIXEL_LEPTON_W;
      entity.speedBudgetConsumed += PIXEL_LEPTON_W;

      if (entity.trackIndex >= track!.length) {
        const oldCell = entity.cell;
        entity.setPosition(targetX, targetY);
        if (!entity.stats.isInfantry && !entity.isAirUnit) {
          const newCell = entity.cell;
          this.map.moveVehicleOccupancy(oldCell.cx, oldCell.cy, newCell.cx, newCell.cy, entity.id);
        }
        this.stopDriveTrack(entity);
        entity.trackNumber = -1; entity.trackControlIndex = -1;
        entity.trackIndex = 0;
        entity.speedAccum = 0; // C++ drive.cpp:792: actual=0 on track completion
        entity.cellBoundaryCrossings++;
        return true;
      }

      const step = track![entity.trackIndex];

      // End marker: offset (0,0) and trackIndex > 0 (C++ drive.cpp:712)
      if (step.x === 0 && step.y === 0 && entity.trackIndex > 0) {
        const oldCell = entity.cell;
        entity.setPosition(targetX, targetY);
        if (!entity.stats.isInfantry && !entity.isAirUnit) {
          const newCell = entity.cell;
          this.map.moveVehicleOccupancy(oldCell.cx, oldCell.cy, newCell.cx, newCell.cy, entity.id);
        }
        this.stopDriveTrack(entity);
        entity.trackNumber = -1; entity.trackControlIndex = -1;
        entity.trackIndex = 0;
        entity.speedAccum = 0; // C++ drive.cpp:792: actual=0 on track completion
        entity.cellBoundaryCrossings++;
        return true;
      }

      // Apply Smooth_Turn: transform offset with F_T/F_X/F_Y flags
      const result = smoothTurn(step.x, step.y, step.facing, flags);

      // Position = target cell center + transformed lepton offset (integer lepton space)
      const oldCell = entity.cell;
      entity.leptonX = Math.trunc(targetX / LP) + result.x;
      entity.leptonY = Math.trunc(targetY / LP) + result.y;
      entity.syncPosFromLeptons();
      if (!entity.stats.isInfantry && !entity.isAirUnit) {
        const newCell = entity.cell;
        this.map.moveVehicleOccupancy(oldCell.cx, oldCell.cy, newCell.cx, newCell.cy, entity.id);
      }

      // Update facing from transformed DirType. Keep exact 256-step
      // PrimaryFacing parity for the next Rotation_Adjust gate.
      entity.bodyFacing256 = result.facing & 0xff;
      entity.bodyFacing32 = dir256ToFacing32(entity.bodyFacing256);
      entity.facing = dir256ToFacing8(entity.bodyFacing256);
      // C++ FacingClass::Set(dir) in drive.cpp:710 sets both Current and
      // Desired while following a track. Leaving TS desiredFacing pointed at
      // the next path direction makes DriveClass think it was already rotating
      // at the next Start_Of_Move boundary and starts the next hop too early.
      entity.desiredFacing = entity.facing;
      entity.desiredFacing256 = entity.bodyFacing256;

      // === Per-Cell Process (C++ drive.cpp:721-728) ===
      // When trackIndex matches RawTracks[tracknum-1].Cell, trigger mid-movement
      // cell processing: vehicle crush and wall crush at the intermediate cell.
      // C++ calls Per_Cell_Process(PCP_DURING) which runs Overrun_Square and
      // crushable overlay destruction (UnitClass::Per_Cell_Process lines 1857-1876).
      if (entity.trackIndex > 0 &&
          rawTrackNum >= 1 && rawTrackNum <= RAW_TRACKS.length &&
          RAW_TRACKS[rawTrackNum - 1].cell >= 0 &&
          RAW_TRACKS[rawTrackNum - 1].cell === entity.trackIndex) {
        // Vehicle crush: heavy tracked vehicles crush infantry at mid-cell
        if (entity.stats.crusher) {
          this.checkVehicleCrush(entity);
        }
        // Fog reveal around the mid-cell position (C++ Look() equivalent)
        const midCx = Math.floor(entity.pos.x / CELL_SIZE);
        const midCy = Math.floor(entity.pos.y / CELL_SIZE);
        if (entity.isPlayerUnit) {
          this.revealAroundCell(midCx, midCy, entity.stats.sight);
        }
        if (!entity.alive) return false; // C++ drive.cpp:724-726: if (!IsActive) return false
      }

      // === Track Jumping (C++ drive.cpp:734-788) ===
      // When the vehicle reaches the Jump index in its current track AND has a
      // following move with a turn, jump to the next track's Entry point for
      // smooth "swooping" curves at speed.
      if (nextFace8 >= 0 && adj && entity.trackIndex > 0 &&
          rawTrackNum >= 1 && rawTrackNum <= RAW_TRACKS.length) {
        const rawMeta = RAW_TRACKS[rawTrackNum - 1];
        if (rawMeta.jump >= 0 && rawMeta.jump === entity.trackIndex) {
          const jumpMove = jumpToCell
            ? this.canEnterTrackJumpCell(entity, jumpToCell.cx, jumpToCell.cy)
            : MoveResult.IMPASSABLE;
          if (jumpMove !== MoveResult.OK) {
            if (jumpMove === MoveResult.TEMP_BLOCKED && jumpToCell &&
                entity.house !== this.playerHouse) {
              // C++ drive.cpp:802-809 — While_Moving track-jump MOVE_TEMP:
              // only non-human houses ask the temporary friendly blocker to
              // scatter via CellClass::Incoming(0, true, true). Human-owned
              // units continue the current track without disturbing blockers.
              this.incomingNoThreatScatterCell(jumpToCell.cx, jumpToCell.cy, entity.id);
            }
            entity.trackIndex++;
            continue;
          }
          // C++ drive.cpp:738: tnum = Dir_Facing(track->Facing) * FACING_COUNT + nextface
          const currentEndFacing8 = tcIdx >= 0 ? Math.floor(TRACK_CONTROL[tcIdx].facing / 32) : -1;
          if (currentEndFacing8 >= 0) {
            const newTCIndex = currentEndFacing8 * 8 + nextFace8;
            if (newTCIndex >= 0 && newTCIndex < TRACK_CONTROL.length) {
              const newTC = TRACK_CONTROL[newTCIndex];
              // C++ drive.cpp:740: if (newtrack->Track && RawTracks[newtrack->Track-1].Entry)
              if (newTC.track > 0 && newTC.track <= RAW_TRACKS.length &&
                  RAW_TRACKS[newTC.track - 1].entry > 0) {
                const newRawTrackNum = newTC.track;
                const newTrack = getTrackArray(newRawTrackNum);
                if (newTrack) {
                  // Perform the jump: switch to new track at its Entry point
                  // C++ drive.cpp:748-754
                  entity.trackNumber = newRawTrackNum;
                  entity.trackControlIndex = newTCIndex;
                  entity.trackFlags = newTC.flag & ~F_D; // strip F_D for geometry
                  entity.trackIndex = RAW_TRACKS[newRawTrackNum - 1].entry - 1; // -1 anticipates increment

                  // Update locals for the rest of the while loop
                  track = newTrack;
                  flags = entity.trackFlags;
                  rawTrackNum = newRawTrackNum;
                  adj = false; // C++ drive.cpp:755: adj = false (prevent re-jumping)

                  // C++ drive.cpp:772 Stop_Driver releases old head-to
                  // reservation after switching TrackNumber/TrackIndex.
                  this.stopDriveTrack(entity);

                  // === Track-jump PCP_END (C++ drive.cpp:773) ===
                  // C++ sequence at the track-jump site:
                  //   Stop_Driver() → IsDriving=true → Per_Cell_Process(PCP_END)
                  //   → IsDriving=false → Start_Driver(c) (which does Path memmove).
                  // The IsDriving=true/false brackets gate Commence semantics.
                  //
                  // Dedup strategy (plan §6): key the fire on the PRE-shift
                  // `${trackIndex}-${pathIndex}` so each unique boundary can only
                  // Commence once — prevents the MCV-157-style double-fire observed
                  // on SCG11 tick 28 while still permitting per-tick re-entry when
                  // two distinct boundaries are crossed in one speed budget.
                  //
                  // Gated by PER_CELL_TRACK_JUMP_ENABLED — OFF in step 1.2 (stub),
                  // ON in step 1.3 behind the per-boundary Set<string> dedup.
                  if (PER_CELL_TRACK_JUMP_ENABLED) {
                    // Capture boundary key at moment of cross (pre-`pathIndex++`
                    // so the key identifies the boundary being left).
                    const boundaryKey = `${entity.trackIndex}-${entity.pathIndex}`;
                    if (!entity._commenceFiredBoundaries.has(boundaryKey)) {
	                      // C++ IsDriving=true bracket (drive.cpp:773-775)
	                      entity.isDriving = true;
	                      this.cutTransportTether(entity);
	                      const r = unitPerCellProcess(entity, PCPType.PCP_END, {
                            // C++ unit.cpp:1635-1651 Case A — building entry
                            // refusal scatter (FIX / service depot). Runs at
                            // every PCP_END boundary, including track-jump.
                            tryBuildingEntryScatter: () => this.tryPCPBuildingEntryScatter(entity),
                            // C++ unit.cpp:1657-1664 — RADIO_IM_IN ground transport
                            // boarding can fire at any PCP_END (including track-jump)
                            // when the unit shares a cell with its NavCom transport.
                            tryBoardTransport: () => this.tryPCPBoardTransport(entity),
                          });
	                      entity.isDriving = false;
                      if (r.commenceFired) {
                        entity._commenceFiredBoundaries.add(boundaryKey);
                        entity._commenceFiredThisTick = true;
                      }
                    }
                  }

                  // Advance path: consume one cell (C++ drive.cpp:787-790
                  // memmove(Path, Path+1)). This is deliberately always one
                  // entry even when the new TrackControl has F_D: the jump path
                  // uses `c = Head_To_Coord(); Adjacent_Cell(c, nextface)` and
                  // does not run Start_Of_Move's F_D two-cell skip branch.
                  entity.pathIndex++;
                  this.consumeDrivePathFacings(entity, 1);
                  entity.cellBoundaryCrossings++;

                  entity.trackCellSpan = 1;

                  // C++ drive.cpp:766-790 computes the jump destination before
                  // shifting Path:
                  //   c = Head_To_Coord();
                  //   c = Adjacent_Cell(c, nextface);
                  //   Start_Driver(c);
                  //   memmove(Path, Path+1,...)
                  //
                  // For an F_D long track, the current Head_To_Coord is already
                  // the second path cell. After the one-entry memmove,
                  // path[pathIndex] still names that old Head_To cell, so using
                  // the shifted path entry starts the new track one cell too
                  // early. Use the precomputed Adjacent_Cell target instead.
                  const newTargetCell = jumpToCell;
                  if (newTargetCell) {
                    targetX = newTargetCell.cx * CELL_SIZE + CELL_SIZE / 2;
                    targetY = newTargetCell.cy * CELL_SIZE + CELL_SIZE / 2;
                    this.startDriveTrack(
                      entity,
                      Math.trunc(targetX / LP),
                      Math.trunc(targetY / LP),
                    );
                  }
                }
              }
            }
          }
        }
      }

      entity.trackIndex++;
    }

    entity.speedAccum = actual; // carry remainder to next tick
    if (entity.trackNumber > 0 && (entity.headToLX !== 0 || entity.headToLY !== 0)) {
      this.markDriveTrack(entity, entity.headToLX, entity.headToLY);
    }
    // === DEBUG_PCP_LOG diagnostic (plan §5) ===
    // Per-tick per-entity drive telemetry for speed/accumulator parity vs WASM
    // drive.cpp:481-490 agent_debug_log(80000,...). Gated by env flag; dumps
    // only track-advancing ticks so other entity types stay silent. No behavior
    // change — pure diagnostic. Remove once parity confirmed byte-identical.
    if (DEBUG_PCP_LOG) {
      // eslint-disable-next-line no-console
      console.log(
        `PCP_DRIVE t=${this.tick} id=${entity.id} type=${entity.type} ` +
        `lx=${entity.leptonX} ly=${entity.leptonY} ` +
        `speedAccum=${entity.speedAccum} speedGranted=${speedGranted.toFixed(2)} ` +
        `speedConsumed=${entity.speedBudgetConsumed} ` +
        `trackIndex=${entity.trackIndex} trackNumber=${entity.trackNumber} ` +
        `pathIndex=${entity.pathIndex} crossings=${entity.cellBoundaryCrossings}`,
      );
    }
    return false;
  }

  /** Retreat away from a target position, clamped to map bounds (artillery min-range) */
  private retreatFromTarget(entity: Entity, targetPos: WorldPos): void {
    entity.animState = AnimState.WALK;
    const dx = entity.pos.x - targetPos.x;
    const dy = entity.pos.y - targetPos.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const minX = this.map.boundsX * CELL_SIZE;
    const maxX = (this.map.boundsX + this.map.boundsW) * CELL_SIZE;
    const minY = this.map.boundsY * CELL_SIZE;
    const maxY = (this.map.boundsY + this.map.boundsH) * CELL_SIZE;
    const retreatX = Math.max(minX, Math.min(maxX, entity.pos.x + (dx / len) * CELL_SIZE * 2));
    const retreatY = Math.max(minY, Math.min(maxY, entity.pos.y + (dy / len) * CELL_SIZE * 2));
    entity.moveToward({ lx: pixelToLepton(retreatX), ly: pixelToLepton(retreatY) }, this.movementSpeed(entity));
  }

  /** Check if two houses are allied */
  private isAllied(a: House, b: House): boolean {
    return this.alliances.get(a)?.has(b) ?? false;
  }

  /** Check if two entities are allied (including same-house) */
  private entitiesAllied(a: Entity, b: Entity): boolean {
    return this.isAllied(a.house, b.house);
  }

  /** Check if an entity is player-controlled (allied to playerHouse) */
  private isPlayerControlled(e: Entity): boolean {
    return this.isAllied(e.house, this.playerHouse);
  }

  /** Launch a projectile — delegates to combat.ts */
  private launchProjectile(
    attacker: Entity, target: Entity | null, weapon: WeaponStats,
    damage: number, impactX: number, impactY: number, directHit: boolean,
    launchCoord?: { lx: number; ly: number },
  ): void {
    _launchProjectile(this._combatCtx, attacker, target, weapon, damage, impactX, impactY, directHit, launchCoord);
  }

  /** Advance in-flight projectiles — delegates to combat.ts.
   *  Note: invisible-bullet Coord_Scatter RNGs are flushed at end of entity-AI
   *  phase in update() just before this runs (mirroring C++
   *  bullet.cpp:736-738 + logic.cpp:285 — same-tick end-of-Logic-loop). This
   *  runs after entity AI for standard (non-invisible, travelling) projectile
   *  arrival. */
  private updateInflightProjectiles(maxLogicIndexHint = Infinity): void {
    this._runCombat(ctx => _updateInflightProjectiles(ctx, maxLogicIndexHint));
  }

  /** Apply AOE splash damage — delegates to combat.ts */
  private applySplashDamage(
    center: WorldPos, weapon: { damage: number; warhead: WarheadType; splash?: number },
    primaryTargetId: number, attackerHouse: House, attacker?: Entity,
  ): void {
    this._runCombat(ctx => _applySplashDamage(ctx, center, weapon, primaryTargetId, attackerHouse, attacker));
  }

  /** Check cell triggers — fire when player units enter trigger cells */
  private checkCellTriggers(): void {
    if (this.map.cellTriggers.size === 0) return;
    for (const entity of this.entities) {
      if (!entity.alive) continue;
      // C++ parity: foot.cpp:1409-1412 — ALL non-cloaked units trigger cell triggers,
      // not just player units. Enemy units trigger brrl (barrel explosions), etc.
      const cellIdx = entity.cell.cy * MAP_CELLS + entity.cell.cx;
      const trigName = this.map.cellTriggers.get(cellIdx);
      if (!trigName) continue;
      const key = `${cellIdx}:${trigName}:${entity.id}`;
      if (this.map.activatedCellTriggers.has(key)) continue;
      this.map.activatedCellTriggers.add(key);
      // Find matching trigger by name and mark its PLAYER_ENTERED condition as met
      for (const trigger of this.triggers) {
        if (trigger.name === trigName) {
          trigger.playerEntered = true;
          trigger.playerEnteredHouse = houseToId(entity.house); // C++ tevent.cpp:290-291: record entering unit's house
          trigger.triggeringEntityIds.push(entity.id); // C++ parity: track entities that triggered (for DESTROY_OBJECT)
          // For persistent triggers that have fired, reset so they can re-evaluate
          if (trigger.persistence === 2 && trigger.fired) {
            trigger.fired = false;
          }
        }
      }
    }
  }

  /**
   * C++ parity (#21): detect object discovery for TEVENT_DISCOVERED and set House.IsDiscovered
   * for TEVENT_HOUSE_DISCOVERED.
   *
   * C++ techno.cpp:776-792 — Revealed() sets IsDiscoveredByPlayer, then if not owned by player,
   * fires Trigger->Spring(TEVENT_DISCOVERED, this) and sets House->IsDiscovered = true.
   * C++ techno.cpp:3899 — Record_The_Kill() also fires TEVENT_DISCOVERED.
   *
   * C++ Revealed() is normally reached through DisplayClass::Map_Cell after a
   * PlayerPtr Sight_From maps a cell. TechnoClass::Per_Cell_Process also calls
   * Revealed(PlayerPtr) when an object enters a currently visible player cell
   * (techno.cpp:1061-1064). The debug/agent fogDisabled override paints
   * visibility=2 across the whole map, but must NOT trigger Revealed().
   */
  private isCellTrulySeen(cx: number, cy: number): boolean {
    // C++ parity: cell is "truly seen" if a strict PlayerPtr unit/structure has it
    // in sight range. Allied AI units do not participate in the player's normal
    // Look pass (display.cpp:4448-4464). Map_Cell can remap allied house sight to
    // PlayerPtr, but only if that allied techno actually Look()s; AI ally units do not.
    // SCG07EA t45: England JEEP sight must not set IsDiscoveredByPlayer on USSR E4.
    // Uses octagonal distance matching coord.cpp Distance() (big*2 + small <= sight*2).
    for (const e of this.entities) {
      if (!e.alive || e.house !== this.playerHouse) continue;
      const sight = e.stats.sight;
      if (!sight || sight > 10) continue;
      const dx = Math.abs(e.cell.cx - cx);
      const dy = Math.abs(e.cell.cy - cy);
      const big = dx > dy ? dx : dy;
      const small = dx > dy ? dy : dx;
      if (big * 2 + small <= sight * 2) return true;
    }
    if (this.baseDiscovered) {
      for (const s of this.structures) {
        if (!s.alive || !this.isAllied(s.house, this.playerHouse)) continue;
        const sight = STRUCTURE_SIGHT[s.type] ?? 5;
        if (!sight || sight > 10) continue;
        const dx = Math.abs(s.cx - cx);
        const dy = Math.abs(s.cy - cy);
        const big = dx > dy ? dx : dy;
        const small = dx > dy ? dy : dx;
        if (big * 2 + small <= sight * 2) return true;
      }
    }
    return false;
  }

  private checkDiscoveryTriggers(): void {
    // Check entities
    for (const entity of this.entities) {
      if (!entity.alive) continue;
      // C++ TechnoClass::IsOwnedByPlayer is strict `(PlayerPtr == House)`,
      // not "allied to PlayerPtr" (techno.cpp:624). Player-allied houses can
      // still receive Revealed(PlayerPtr) and set IsDiscoveredByPlayer when
      // they enter true player-visible cells (techno.cpp:1061-1064).
      if (entity.house === this.playerHouse) continue;
      if (this.discoveredEntityIds.has(entity.id)) continue; // already discovered

      // C++ parity: use TRUE sight (unit/structure SightRange), not display fog state.
      // fogDisabled=true artificially paints vis=2; must not trigger Revealed().
      if (!this.isCellTrulySeen(entity.cell.cx, entity.cell.cy)) continue;

      this.discoveredEntityIds.add(entity.id);

      // Set house discovery (C++ House->IsDiscovered = true in techno.cpp:792)
      const hi = Game.HOUSE_TO_INDEX[entity.house];
      if (hi !== undefined) {
        this.houseDiscovered.set(hi, true);
      }

      // Fire trigger discovery if entity has a trigger attached
      if (entity.triggerName) {
        for (const trigger of this.triggers) {
          if (trigger.name === entity.triggerName) {
            trigger.objectDiscovered = true;
          }
        }
      }
    }

    // Check structures
    for (let si = 0; si < this.structures.length; si++) {
      const s = this.structures[si];
      if (!s.alive) continue;
      if (s.house === this.playerHouse) continue;
      if (this.discoveredStructureIds.has(si)) continue;

      // C++ parity: use TRUE sight (not display fog)
      if (!this.isCellTrulySeen(s.cx, s.cy)) continue;

      this.discoveredStructureIds.add(si);

      const hi = Game.HOUSE_TO_INDEX[s.house];
      if (hi !== undefined) {
        this.houseDiscovered.set(hi, true);
      }

      if (s.triggerName) {
        for (const trigger of this.triggers) {
          if (trigger.name === s.triggerName) {
            trigger.objectDiscovered = true;
          }
        }
      }
    }

    // C++ techno.cpp:826-834 Hidden() — un-discover AI objects returning to shroud.
    // Only non-human (AI) houses can have objects re-hidden; human-owned objects
    // stay discovered permanently.
    for (const entity of this.entities) {
      if (!entity.alive) continue;
      // IsOwnedByPlayer is strict PlayerPtr ownership. Allied AI houses are
      // not owned by the player and can be hidden again when they leave shroud.
      if (entity.house === this.playerHouse) continue;
      if (!this.discoveredEntityIds.has(entity.id)) continue; // not discovered

      const vis = this.map.getVisibility(entity.cell.cx, entity.cell.cy);
      if (vis < 2) {
        // Entity returned to shroud — clear discovery flag (C++ IsDiscoveredByPlayer = false)
        this.discoveredEntityIds.delete(entity.id);
      }
    }
  }

  private markDiscoveredIfPlayerVisible(entity: Entity): void {
    if (!entity.alive || entity.house === this.playerHouse) return;
    if (this.discoveredEntityIds.has(entity.id)) return;

    const playerIdx = Game.HOUSE_TO_INDEX[this.playerHouse] ?? -1;
    const visible =
      this.isAllied(entity.house, this.playerHouse)
        ? playerIdx >= 0 && this.isRevealedToHouse(entity.cell.cx, entity.cell.cy, playerIdx)
        : this.isCellTrulySeen(entity.cell.cx, entity.cell.cy);
    if (!visible) return;

    this.discoveredEntityIds.add(entity.id);
    const hi = Game.HOUSE_TO_INDEX[entity.house];
    if (hi !== undefined) this.houseDiscovered.set(hi, true);

    if (entity.triggerName) {
      for (const trigger of this.triggers) {
        if (trigger.name === entity.triggerName) trigger.objectDiscovered = true;
      }
    }
  }

  /**
   * C++ parity (#21): detect zone entry, horizontal crossing, and vertical crossing
   * for TEVENT_ENTERS_ZONE, TEVENT_CROSS_HORIZONTAL, TEVENT_CROSS_VERTICAL.
   *
   * C++ foot.cpp:1406-1455:
   * - CROSS_HORIZONTAL: scans all cells in the same Y row for triggers with CROSS_HORIZONTAL event;
   *   calls Spring(TEVENT_CROSS_HORIZONTAL, this) if object->Owner() == Data.House.
   * - CROSS_VERTICAL: same but for X column.
   * - ENTERS_ZONE: iterates MapTriggers; if trigger has ENTERS_ZONE event and the entity is in the
   *   same movement zone as the trigger's cell, calls Spring(TEVENT_ENTERS_ZONE, this).
   *
   * C++ tevent.cpp:290-293: ownership check — object->Owner() must equal Data.House for all four
   * events (PLAYER_ENTERED, CROSS_H, CROSS_V, ENTERS_ZONE). Note: == not !=, so the trigger's
   * Data.House specifies WHICH house's units should trigger it.
   */
  private checkZoneAndCrossTriggers(): void {
    for (const entity of this.entities) {
      if (!entity.alive) continue;
      // C++ foot.cpp:1409 — only uncloaked units trigger these
      const entityHouseIdx = Game.HOUSE_TO_INDEX[entity.house];
      if (entityHouseIdx === undefined) continue;

      const ex = entity.cell.cx;
      const ey = entity.cell.cy;

      for (const trigger of this.triggers) {
        // Skip already-fired non-persistent triggers
        if (trigger.fired && trigger.persistence <= 1) continue;

        const hasEntersZone = trigger.event1.type === 24 || // TEVENT_ENTERS_ZONE
          (trigger.eventControl !== 0 && trigger.event2.type === 24);
        const hasCrossH = trigger.event1.type === 25 || // TEVENT_CROSS_HORIZONTAL
          (trigger.eventControl !== 0 && trigger.event2.type === 25);
        const hasCrossV = trigger.event1.type === 26 || // TEVENT_CROSS_VERTICAL
          (trigger.eventControl !== 0 && trigger.event2.type === 26);

        if (!hasEntersZone && !hasCrossH && !hasCrossV) continue;

        // C++ tevent.cpp:290-293: ownership check — object->Owner() must == Data.House
        // Data.House is in event1.data or event2.data depending on which event uses it
        const checkOwnership = (eventData: number): boolean => {
          return entityHouseIdx === eventData;
        };

        // CROSS_HORIZONTAL: entity is in same row (Y) as any cell trigger with CROSS_H
        if (hasCrossH && !trigger.crossedHorizontal) {
          const evtData = trigger.event1.type === 25 ? trigger.event1.data : trigger.event2.data;
          if (checkOwnership(evtData)) {
            // Check if any cell in the entity's row has this trigger
            for (const [cellIdx, trigName] of this.map.cellTriggers) {
              if (trigName !== trigger.name) continue;
              const trigY = Math.floor(cellIdx / MAP_CELLS);
              if (ey === trigY) {
                trigger.crossedHorizontal = true;
                break;
              }
            }
          }
        }

        // CROSS_VERTICAL: entity is in same column (X) as any cell trigger with CROSS_V
        if (hasCrossV && !trigger.crossedVertical) {
          const evtData = trigger.event1.type === 26 ? trigger.event1.data : trigger.event2.data;
          if (checkOwnership(evtData)) {
            for (const [cellIdx, trigName] of this.map.cellTriggers) {
              if (trigName !== trigger.name) continue;
              const trigX = cellIdx % MAP_CELLS;
              if (ex === trigX) {
                trigger.crossedVertical = true;
                break;
              }
            }
          }
        }

        // ENTERS_ZONE: entity is in same zone as trigger's cell
        // C++ uses Map[trigger->Cell].Zones[MZone] == Map[Coord].Zones[MZone]
        // Simplified: same connected passable region. We approximate with cell proximity
        // since we don't have full zone maps — check if entity is on any cell assigned to this trigger.
        if (hasEntersZone && !trigger.enteredZone) {
          const evtData = trigger.event1.type === 24 ? trigger.event1.data : trigger.event2.data;
          if (checkOwnership(evtData)) {
            const entityCellIdx = ey * MAP_CELLS + ex;
            const trigName = this.map.cellTriggers.get(entityCellIdx);
            if (trigName === trigger.name) {
              trigger.enteredZone = true;
            }
          }
        }
      }
    }
  }

  /** Map our House enum to RA HousesType index (for trigger event checks) */
  private static readonly HOUSE_TO_INDEX: Record<string, number> = {
    [House.Spain]: 0, [House.Greece]: 1, [House.USSR]: 2,
    [House.England]: 3, [House.Ukraine]: 4, [House.Germany]: 5,
    [House.France]: 6, [House.Turkey]: 7,
    [House.GoodGuy]: 8, [House.BadGuy]: 9, [House.Neutral]: 10,
  };

  private addEntityHouseActiveScan(
    entity: Entity,
    houseAlive: Map<number, boolean>,
    houseUnitsAlive: Map<number, boolean>,
  ): void {
    // C++ TEVENT_ALL_DESTROYED checks HouseClass ActiveB/U/I/VScan. Infantry
    // death animations remain in Logic until their final stage and still keep
    // the owning house active even with Strength == 0.
    if (!entity.occupiesCppLogic()) return;
    const hi = Game.HOUSE_TO_INDEX[entity.house];
    if (hi === undefined) return;
    houseAlive.set(hi, true);
    houseUnitsAlive.set(hi, true);
  }

  /**
   * Rebuild per-house fog-of-war sets from all alive entities and structures.
   * C++ map.cpp:295-337 Sight_From uses octagonal reveal with capped sight.
   * Called at END of the entity AI loop (after Phase 4 aircraft, before deferred
   * transport loads) — matching C++ where Logic.AI runs BEFORE Map.Sight_From.
   */
  private _updateHouseRevealed(): void {
    this._houseRevealed.clear();
    // Reveal cells for each alive, non-limbo entity
    for (const e of this.entities) {
      if (!e.alive || e.inLimbo) continue;
      const hi = Game.HOUSE_TO_INDEX[e.house];
      if (hi === undefined) continue;
      let set = this._houseRevealed.get(hi);
      if (!set) { set = new Set(); this._houseRevealed.set(hi, set); }
      const sight = e.stats.sight;
      if (!sight || sight > 10) continue; // C++ map.cpp:296 cap
      const ecx = e.cell.cx;
      const ecy = e.cell.cy;
      this._addOctagonalCells(set, ecx, ecy, sight);
    }
    // Reveal cells for each alive structure
    for (const s of this.structures) {
      if (!s.alive) continue;
      const hi = Game.HOUSE_TO_INDEX[s.house];
      if (hi === undefined) continue;
      let set = this._houseRevealed.get(hi);
      if (!set) { set = new Set(); this._houseRevealed.set(hi, set); }
      const sight = STRUCTURE_SIGHT[s.type] ?? 5;
      if (!sight || sight > 10) continue;
      this._addOctagonalCells(set, s.cx, s.cy, sight);
    }
    // C++ parity: allied houses share vision (house.cpp:1265 — IsAllied checks).
    // If house A is allied with house B, A's units reveal cells for B and vice versa.
    // Merge each house's revealed cells into its allies' sets.
    const houseIndices = [...this._houseRevealed.keys()];
    for (const hiA of houseIndices) {
      const houseA = Object.keys(Game.HOUSE_TO_INDEX).find(k => Game.HOUSE_TO_INDEX[k] === hiA) as House | undefined;
      if (!houseA) continue;
      const setA = this._houseRevealed.get(hiA)!;
      for (const hiB of houseIndices) {
        if (hiA === hiB) continue;
        const houseB = Object.keys(Game.HOUSE_TO_INDEX).find(k => Game.HOUSE_TO_INDEX[k] === hiB) as House | undefined;
        if (!houseB) continue;
        if (!this.isAllied(houseA, houseB)) continue;
        // Merge A's cells into B's set
        const setB = this._houseRevealed.get(hiB)!;
        for (const cell of setA) {
          setB.add(cell);
        }
      }
    }
  }

  /** Add cells within octagonal sight radius to a set.
   *  C++ coord.cpp:124-136 — Distance() uses max(|dy|,|dx|) + min(|dy|,|dx|)/2. */
  private _addOctagonalCells(set: Set<number>, cx: number, cy: number, radius: number): void {
    if (radius === 1) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const rx = cx + dx, ry = cy + dy;
          if (rx >= 0 && rx < MAP_CELLS && ry >= 0 && ry < MAP_CELLS) {
            set.add(ry * MAP_CELLS + rx);
          }
        }
      }
      return;
    }
    const threshold = radius * 2;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        const big = adx > ady ? adx : ady;
        const small = adx > ady ? ady : adx;
        if (big * 2 + small <= threshold) {
          const rx = cx + dx, ry = cy + dy;
          if (rx >= 0 && rx < MAP_CELLS && ry >= 0 && ry < MAP_CELLS) {
            set.add(ry * MAP_CELLS + rx);
          }
        }
      }
    }
  }

  /** Check if a cell is revealed to a specific house.
   *  C++ techno.cpp:1467+ Evaluate_Object checks Is_Discovered_By_House. */
  isRevealedToHouse(cx: number, cy: number, houseIdx: number): boolean {
    const set = this._houseRevealed.get(houseIdx);
    if (!set) return false;
    return set.has(cy * MAP_CELLS + cx);
  }

  /** Build trigger game state snapshot for event checks (uses precomputed shared state) */
  private buildTriggerState(trigger: ScenarioTrigger, shared: {
    structureTypes: Set<string>; destroyedTriggerNames: Set<string>;
    enemyUnitsAlive: number; playerFactories: number;
    houseAlive: Map<number, boolean>; houseUnitsAlive: Map<number, boolean>;
    houseBuildingsAlive: Map<number, boolean>; builtStructureTypes: Set<string>;
    buildingsDestroyedByHouse: Map<number, boolean>; fakesExist: boolean;
    structureTypesByHouse: Map<number, Set<string>>;
    builtStructureTypesByHouse: Map<number, Set<string>>;
  }): TriggerGameState {
    return {
      gameTick: this.tick,
      globals: this.globals,
      triggerStartTick: trigger.timerTick,
      triggerName: trigger.name,
      playerEntered: trigger.playerEntered,
      playerEnteredHouse: trigger.playerEnteredHouse,
      // C++ parity (#21): differentiated trigger event state
      objectDiscovered: trigger.objectDiscovered,
      houseDiscovered: this.houseDiscovered,
      enteredZone: trigger.enteredZone,
      crossedHorizontal: trigger.crossedHorizontal,
      crossedVertical: trigger.crossedVertical,
      enemyUnitsAlive: shared.enemyUnitsAlive,
      enemyKillCount: this.killCount,
      playerFactories: shared.playerFactories,
      missionTimerExpired: this.missionTimerExpired,
      bridgesAlive: this.bridgeCellCount,
      unitsLeftMap: this.unitsLeftMap,
      structureTypes: shared.structureTypes,
      structureTypesByHouse: shared.structureTypesByHouse,
      triggerHouse: trigger.house,
      destroyedTriggerNames: shared.destroyedTriggerNames,
      attackedTriggerNames: this.attackedTriggerNames,
      houseAlive: shared.houseAlive,
      houseUnitsAlive: shared.houseUnitsAlive,
      houseBuildingsAlive: shared.houseBuildingsAlive,
      builtStructureTypes: shared.builtStructureTypes,
      builtStructureTypesByHouse: shared.builtStructureTypesByHouse,
      isLowPower: this.powerConsumed > this.powerProduced && this.powerProduced > 0,
      playerCredits: this.credits,
      buildingsDestroyedByHouse: shared.buildingsDestroyedByHouse,
      nBuildingsDestroyed: this.nBuildingsDestroyedCount,
      playerFactoriesExist: shared.playerFactories > 0,
      civiliansEvacuated: this.civiliansEvacuated,
      builtUnitTypes: this.builtUnitTypes,
      builtInfantryTypes: this.builtInfantryTypes,
      builtAircraftTypes: this.builtAircraftTypes,
      fakesExist: shared.fakesExist,
      spiedBuildings: this.spiedBuildingTriggers,
      isThieved: this.isThieved,
      pendingDestroyedCount: trigger.pendingDestroyedCount,
    };
  }

  /**
   * Evaluate whether a trigger's events are met based on eventControl mode.
   * Returns per-event results so MULTI_LINKED (eventControl=3) can route
   * Action1/Action2 independently.
   *
   * C++ ref: trigger.cpp:249-264 (Spring event switch)
   */
  private checkTriggerEvents(
    trigger: ScenarioTrigger,
    state: TriggerGameState,
    springEvent?: number,
  ): { shouldFire: boolean; e1: boolean; e2: boolean } {
    const e1 = this.triggerEventCanSpring(trigger.event1.type, springEvent) &&
      checkTriggerEvent(trigger.event1, state);
    const e2 = this.triggerEventCanSpring(trigger.event2.type, springEvent) &&
      checkTriggerEvent(trigger.event2, state);
    switch (trigger.eventControl) {
      case 0: return { shouldFire: e1, e1, e2 };                   // MULTI_ONLY
      case 1: return { shouldFire: e1 && e2, e1, e2 };             // MULTI_AND
      case 2: return { shouldFire: e1 || e2, e1, e2 };             // MULTI_OR
      case 3: return { shouldFire: e1 || e2, e1, e2 };             // MULTI_LINKED (same gate as OR, action routing differs)
      default: return { shouldFire: e1, e1, e2 };
    }
  }

  private triggerEventCanSpring(eventType: number, springEvent?: number): boolean {
    if (springEvent === undefined) return true;
    if (eventType === TEVENT_ANY) return true;
    // C++ tevent.cpp:261-276 gates only object/cell/discovery events by the
    // current Spring(event). Time/global/house-scan events evaluate whenever
    // LogicTriggers.Spring(TEVENT_TIME) runs.
    switch (eventType) {
      case TEVENT_ATTACKED:
      case TEVENT_DESTROYED:
      case TEVENT_DISCOVERED:
      case TEVENT_SPIED:
      case TEVENT_NONE:
      case TEVENT_CROSS_HORIZONTAL:
      case TEVENT_CROSS_VERTICAL:
      case TEVENT_ENTERS_ZONE:
      case TEVENT_PLAYER_ENTERED:
        return eventType === springEvent;
      default:
        return true;
    }
  }

  /** Shared trigger state snapshot used by immediate object-level springs. */
  private buildTriggerSharedSnapshot(): {
    structureTypes: Set<string>; destroyedTriggerNames: Set<string>;
    enemyUnitsAlive: number; playerFactories: number;
    houseAlive: Map<number, boolean>; houseUnitsAlive: Map<number, boolean>;
    houseBuildingsAlive: Map<number, boolean>; builtStructureTypes: Set<string>;
    buildingsDestroyedByHouse: Map<number, boolean>; fakesExist: boolean;
    structureTypesByHouse: Map<number, Set<string>>;
    builtStructureTypesByHouse: Map<number, Set<string>>;
  } {
    const structureTypes = new Set<string>();
    const structureTypesByHouse = new Map<number, Set<string>>();
    const destroyedTriggerNames = new Set<string>(this.destroyedTriggerNames);
    const houseAlive = new Map<number, boolean>();
    const houseUnitsAlive = new Map<number, boolean>();
    const houseBuildingsAlive = new Map<number, boolean>();
    const housesWithBuildings = new Set<number>();
    let playerFactories = 0;
    let enemyUnitsAlive = 0;
    let fakesExist = false;
    const FAKE_TYPES = new Set(['FACF', 'DOMF', 'WEAF']);

    for (const s of this.structures) {
      if (s.alive) {
        structureTypes.add(s.type);
        if (this.isAllied(s.house, this.playerHouse) &&
            (s.type === 'FACT' || s.type === 'WEAP' || s.type === 'BARR' || s.type === 'TENT' ||
             s.type === 'AFLD' || s.type === 'HPAD' || s.type === 'SYRD' || s.type === 'SPEN')) {
          playerFactories++;
        }
        const hi = Game.HOUSE_TO_INDEX[s.house];
        if (hi !== undefined) {
          houseAlive.set(hi, true);
          if (!WALL_TYPES.has(s.type)) {
            houseBuildingsAlive.set(hi, true);
            housesWithBuildings.add(hi);
          }
          let hset = structureTypesByHouse.get(hi);
          if (!hset) { hset = new Set<string>(); structureTypesByHouse.set(hi, hset); }
          hset.add(s.type);
        }
        if (FAKE_TYPES.has(s.type)) fakesExist = true;
      } else if (s.triggerName) {
        destroyedTriggerNames.add(s.triggerName);
      }
    }

    for (const e of this.entities) {
      if (e.alive && !this.isPlayerControlled(e) && !e.isCivilian) enemyUnitsAlive++;
      this.addEntityHouseActiveScan(e, houseAlive, houseUnitsAlive);
      if (!e.alive && e.triggerName) {
        destroyedTriggerNames.add(e.triggerName);
      }
    }

    const buildingsDestroyedByHouse = new Map<number, boolean>();
    for (const s of this.structures) {
      const hi = Game.HOUSE_TO_INDEX[s.house];
      if (hi !== undefined && !WALL_TYPES.has(s.type) && !housesWithBuildings.has(hi)) {
        buildingsDestroyedByHouse.set(hi, true);
      }
    }

    return {
      structureTypes, destroyedTriggerNames, enemyUnitsAlive, playerFactories,
      houseAlive, houseUnitsAlive, houseBuildingsAlive,
      builtStructureTypes: this.builtStructureTypes,
      buildingsDestroyedByHouse, fakesExist, structureTypesByHouse,
      builtStructureTypesByHouse: this.builtStructureTypesByHouse,
    };
  }

  private executeTriggerActionFor(trigger: ScenarioTrigger, action: ScenarioTrigger['action1']): void {
    if ((action.action === 4 || action.action === 7) && this.destroyedTeams.has(action.team)) return;
    const result = executeTriggerAction(
      action, this.teamTypes, this.waypoints, this.globals, this.triggers, trigger.house,
      this.houseEdges, { x: this.map.boundsX, y: this.map.boundsY, w: this.map.boundsW, h: this.map.boundsH },
      Game.HOUSE_TO_INDEX[this.playerHouse] ?? -1, this.map, this.entities,
    );
    this.applyTriggerActionResult(result, trigger);
  }

  private springDestroyedTriggerByName(triggerName: string): void {
    const trigger = this.triggers.find(t => t.name === triggerName);
    if (!trigger || (trigger.fired && trigger.persistence <= 1)) return;

    this.destroyedTriggerNames.add(triggerName);
    trigger.pendingDestroyedCount++;

    const shared = this.buildTriggerSharedSnapshot();
    shared.destroyedTriggerNames.add(triggerName);
    const state = this.buildTriggerState(trigger, shared);
    const result = this.checkTriggerEvents(trigger, state, TEVENT_DESTROYED);

    if (!result.shouldFire) {
      trigger.pendingDestroyedCount = Math.max(0, trigger.pendingDestroyedCount - 1);
      return;
    }

    // C++ trigger.cpp:277-298 — semi-persistent triggers detach the object
    // and decrement AttachCount on every successful object Spring call; only
    // the final attachment executes actions.
    if (trigger.persistence === 1 && !consumeSemiPersistentAttachment(trigger, 1)) {
      trigger.pendingDestroyedCount = Math.max(0, trigger.pendingDestroyedCount - 1);
      return;
    }

    trigger.fired = true;
    trigger.pendingDestroyedCount = 0;

    if (trigger.persistence === 2) {
      trigger.timerTick = this.tick;
      trigger.playerEntered = false;
      trigger.objectDiscovered = false;
      trigger.enteredZone = false;
      trigger.crossedHorizontal = false;
      trigger.crossedVertical = false;
    }

    if (trigger.eventControl === 3) {
      if (result.e1) this.executeTriggerActionFor(trigger, trigger.action1);
      if (result.e2) this.executeTriggerActionFor(trigger, trigger.action2);
    } else {
      this.executeTriggerActionFor(trigger, trigger.action1);
      if (trigger.actionControl === 1) {
        this.executeTriggerActionFor(trigger, trigger.action2);
      }
    }
  }

  private springAttackedTriggerByName(triggerName: string): void {
    const trigger = this.triggers.find(t => t.name === triggerName);
    if (!trigger || (trigger.fired && trigger.persistence <= 1)) return;

    this.attackedTriggerNames.add(triggerName);

    const shared = this.buildTriggerSharedSnapshot();
    const state = this.buildTriggerState(trigger, shared);
    const result = this.checkTriggerEvents(trigger, state, TEVENT_ATTACKED);
    if (!result.shouldFire) return;

    if (trigger.persistence === 1 && !consumeSemiPersistentAttachment(trigger, 1)) {
      return;
    }

    trigger.fired = true;

    if (trigger.persistence === 2) {
      trigger.timerTick = this.tick;
      trigger.playerEntered = false;
      trigger.objectDiscovered = false;
      trigger.enteredZone = false;
      trigger.crossedHorizontal = false;
      trigger.crossedVertical = false;
    }

    if (trigger.eventControl === 3) {
      if (result.e1) this.executeTriggerActionFor(trigger, trigger.action1);
      if (result.e2) this.executeTriggerActionFor(trigger, trigger.action2);
    } else {
      this.executeTriggerActionFor(trigger, trigger.action1);
      if (trigger.actionControl === 1) {
        this.executeTriggerActionFor(trigger, trigger.action2);
      }
    }
  }

  /**
   * C++ object-level death triggers.
   * TechnoClass::Record_The_Kill invokes Trigger->Spring(TEVENT_DESTROYED, obj)
   * immediately. The periodic LogicTrigger scan handles global/time/house-level
   * triggers; attached object deaths must not wait for that scan.
   */
  private springDestroyedObjectTriggers(): void {
    for (const e of this.entities) {
      if (!e.alive && e.triggerName && !e.triggerDeathProcessed) {
        this.springDestroyedTriggerByName(e.triggerName);
        e.triggerDeathProcessed = true;
      }
    }
    for (const s of this.structures) {
      if (!s.alive && s.triggerName && !s.triggerDeathProcessed) {
        this.springDestroyedTriggerByName(s.triggerName);
        s.triggerDeathProcessed = true;
      }
    }
  }

  /**
   * Apply side effects from a trigger action result. Extracted from processTriggers
   * to share with springGlobalTriggers (C++ parity #38).
   */
  /** Start score screen music after a brief delay (C++ Theme.Queue_Song(THEME_SCORE), score.cpp:412) */
  private startScoreMusic(): void {
    setTimeout(() => this.audio.music.playSpecific('score'), 1200);
  }

  private applyTriggerActionResult(result: TriggerActionResult, trigger: ScenarioTrigger): void {
    // C++ house.cpp:4066-4083 — Flag_To_Win: only set if no flag already pending
    if (result.win && this.state === 'playing') {
      if (!this.isToWin && !this.isToLose) {
        this.isToWin = true;
        this.borrowedTime = SAVOUR_DELAY_TICKS;
      }
    }
    // C++ house.cpp:4102-4112 — Flag_To_Lose: unconditionally clears IsToWin first
    if (result.lose && this.state === 'playing') {
      this.isToWin = false; // C++ house.cpp:4103: IsToWin = false (always, even if Flag_To_Lose fails)
      if (!this.isToLose) {
        this.isToLose = true;
        this.borrowedTime = SAVOUR_DELAY_TICKS;
      }
    }
    // C++ trigger.cpp:175-178 — decrement Blockage counter when ALLOWWIN trigger fires
    if (result.allowWin && this.allowWin > 0) {
      this.allowWin--;
      // C++ trigger.cpp:177: Houses.Ptr(Class->House)->BorrowedTime = TICKS_PER_SECOND*4
      this.borrowedTime = ALLOWWIN_BORROWED_TIME;
    }
    if (result.allHunt !== undefined) {
      const huntHouse = houseIdToHouse(result.allHunt);
      for (const e of this.entities) {
        if (e.alive && e.house === huntHouse) {
          e.mission = Mission.HUNT;
        }
      }
    }
    if (result.revealAll) {
      this.map.revealAll();
      this.markAllObjectsRevealedToPlayer();
    }
    if (result.revealWaypoint !== undefined) {
      const wp = this.waypoints.get(result.revealWaypoint);
      if (wp) {
        // C++ TACTION_REVEAL_SOME: Map.Sight_From(waypoint, Rule.GapShroudRadius=10, PlayerPtr)
        this.revealSightFromPlayer(wp.cx, wp.cy, 10);
      }
    }
    if (result.dropZone !== undefined) {
      const wp = this.waypoints.get(result.dropZone);
      if (wp) {
        // C++ AnimClass::Unlimbo for ANIM_LZ_SMOKE: DropZoneRadius=4 cells.
        this.revealSightFromPlayer(wp.cx, wp.cy, 4);
        const world = { x: wp.cx * CELL_SIZE + CELL_SIZE / 2, y: wp.cy * CELL_SIZE + CELL_SIZE / 2 };
        this.effects.push({
          type: 'marker', x: world.x, y: world.y,
          frame: 0, maxFrames: 90, size: 6,
          cppLogicSlot: true,
        });
        this.minimapAlert(wp.cx, wp.cy);
        this.audio.play('eva_reinforcements');
      }
    }
    if (result.creepShadow) {
      this.map.creepShadow();
    }
    if (result.textMessage !== undefined) {
      this.showEvaMessage(result.textMessage);
    }
    if (result.setTimer !== undefined) {
      this.missionTimer = result.setTimer * TIME_UNIT_TICKS;
      this.missionTimerExpired = false;
      this.missionTimerRunning = true;
    }
    if (result.timerExtend !== undefined) {
      this.missionTimer += result.timerExtend * TIME_UNIT_TICKS;
      this.missionTimerExpired = false;
    }
    if (result.autocreate !== undefined) {
      this.autocreateEnabled = true;
      // C++ taction.cpp:648-652: TACTION_AUTOCREATE sets house->IsAlerted = true
      if (trigger.house !== undefined) {
        const acHouse = houseIdToHouse(trigger.house);
        const aiState = this.aiStates.get(acHouse);
        if (aiState) aiState.isAlerted = true;
      }
    }
    if (result.destroyTeam !== undefined) this.destroyedTeams.add(result.destroyTeam);
    if (result.startTimer) this.missionTimerRunning = true;
    if (result.stopTimer) this.missionTimerRunning = false;
    if (result.timerSubtract !== undefined) {
      this.missionTimer = Math.max(0, this.missionTimer - result.timerSubtract * TIME_UNIT_TICKS);
    }
    if (result.fireSale !== undefined) {
      const saleHouse = houseIdToHouse(result.fireSale);
      for (const s of this.structures) {
        if (s.alive && s.house === saleHouse && s.sellProgress === undefined) {
          s.sellProgress = 0;
        }
      }
      for (const e of this.entities) {
        if (e.alive && e.house === saleHouse) e.mission = Mission.HUNT;
      }
    }
    if (result.revealZone !== undefined) {
      const wp = this.waypoints.get(result.revealZone);
      if (wp) _revealZoneFloodFill(this.map, wp.cx, wp.cy);
    }
    // Charge one superweapon of trigger house
    if (result.oneSpecial && trigger.house !== undefined) {
      const swHouse = houseIdToHouse(trigger.house);
      for (const [, state] of this.superweapons) {
        if (state.house === swHouse && !state.ready) {
          state.ready = true;
          break;
        }
      }
    }
    // Charge all superweapons of trigger house
    if (result.fullSpecial && trigger.house !== undefined) {
      const swHouse = houseIdToHouse(trigger.house);
      for (const [, state] of this.superweapons) {
        if (state.house === swHouse) state.ready = true;
      }
    }
    if (result.preferredTarget !== undefined && trigger.house !== undefined) {
      const ptHouse = houseIdToHouse(trigger.house);
      const aiState = this.aiStates.get(ptHouse);
      if (aiState) aiState.preferredTarget = result.preferredTarget ?? null;
    }
    if (result.beginProduction !== undefined) {
      // C++ house.h:716: Begin_Production(void) { IsStarted = true; }
      // This ONLY sets IsStarted — it does NOT enable general AI production.
      // In C++, IsStarted is used for enemy selection (house.cpp:4639) and
      // indicates the house has begun operations. General unit production
      // (AI_Unit/AI_Infantry) in single-player only builds units to fill teams,
      // NOT arbitrary tech-tree units. The IsBaseBuilding flag (set by
      // TACTION_BASE_BUILDING) is what enables full arbitrary production.
      const bpHouse = houseIdToHouse(result.beginProduction);
      if (!this.aiStates.has(bpHouse) && !this.isAllied(bpHouse, this.playerHouse)) {
        const newState = this.createAIHouseState(bpHouse);
        newState.isStarted = true;
        this.aiStates.set(bpHouse, newState);
      } else {
        const existingState = this.aiStates.get(bpHouse);
        if (existingState) existingState.isStarted = true;
      }
    }
    // C++ parity (#39): TACTION_BASE_BUILDING — set IsBaseBuilding on/off for AI house
    if (result.baseBuilding !== undefined) {
      const bbHouse = houseIdToHouse(result.baseBuilding.house);
      const aiState = this.aiStates.get(bbHouse);
      if (aiState) {
        aiState.isBaseBuilding = result.baseBuilding.enabled;
        // C++ house.cpp:936-940: IsBaseBuilding cascade → IsStarted + IsAlerted
        if (result.baseBuilding.enabled) {
          aiState.isStarted = true;
          aiState.isAlerted = true;
          aiState.productionEnabled = true;
        }
      } else if (result.baseBuilding.enabled && !this.isAllied(bbHouse, this.playerHouse)) {
        const newState = this.createAIHouseState(bbHouse);
        newState.isBaseBuilding = true;
        newState.isStarted = true;
        newState.isAlerted = true;
        newState.productionEnabled = true;
        this.aiStates.set(bbHouse, newState);
      }
    }
    // C++ parity: TACTION_WINLOSE (ordinal 14) is a noop in RA's taction.cpp.
    // It was functional in Tiberian Dawn but falls through to default in RA.
    // result.winLose is never set by executeTriggerAction for RA parity.
    if (result.airstrike) {
      const wp = this.waypoints.get(0);
      if (wp) {
        const wx = wp.cx * CELL_SIZE + CELL_SIZE / 2;
        const wy = wp.cy * CELL_SIZE + CELL_SIZE / 2;
        this.effects.push({ type: 'explosion', x: wx, y: wy, frame: 0, maxFrames: EXPLOSION_FRAMES['art-exp1'] ?? 22, size: 24, sprite: 'art-exp1', spriteStart: 0 });
        for (const e of this.entities) {
          if (!e.alive) continue;
          if (worldDist(e.pos, { x: wx, y: wy }) <= 4) this.damageEntity(e, 200, 'HE');
        }
        this.audio.play('explode_lg');
      }
    }
    if (result.launchNukes) {
      for (const s of this.structures) {
        if (!s.alive || s.type !== 'MSLO') continue;
        const sx = s.cx * CELL_SIZE + CELL_SIZE;
        const sy = s.cy * CELL_SIZE + CELL_SIZE;
        this.effects.push({
          type: 'projectile',
          x: sx, y: sy,
          startX: sx, startY: sy,
          endX: sx, endY: sy - CELL_SIZE * 20,
          frame: 0, maxFrames: 45, size: 4,
          projStyle: 'rocket',
        });
        this.audio.play('nuke_launch');
      }
    }
    if (result.centerView !== undefined) {
      const wp = this.waypoints.get(result.centerView);
      if (wp) {
        this.camera.centerOn(wp.cx * CELL_SIZE + CELL_SIZE / 2, wp.cy * CELL_SIZE + CELL_SIZE / 2);
      }
    }
    if (result.playMovie !== undefined) {
      this.showEvaMessage(-1, `[Movie: ${result.playMovie}]`);
    }
    if (result.playMusic !== undefined) {
      this.audio.music.next();
    }
    if (result.playSpeech !== undefined) {
      this.handleTriggerSpeech(result.playSpeech);
    }
    if (result.playSound !== undefined) {
      this.handleTriggerSound(result.playSound);
    }
    // C++ Create_Army — recruit existing idle units into team (TACTION_CREATE_TEAM)
    // C++ taction.cpp:659-661: ScenarioInit++ → Create_One_Of() → ScenarioInit--
    // ScenarioInit bypasses MaxAllowed check, so TeamClass is ALWAYS created.
    if (result.createTeam) {
      const ct = result.createTeam;
      const recruited: Entity[] = [];
      const recruitedSet = new Set<Entity>(); // prevent same entity recruited twice
      // C++ team.cpp:1184-1188: recruit center is team origin waypoint
      let recruitCenterLX = 0, recruitCenterLY = 0;
      const teamType = ct.teamIdx !== undefined ? this.teamTypes[ct.teamIdx] : undefined;
      if (teamType && teamType.origin >= 0) {
        const wp = this.waypoints.get(teamType.origin);
        if (wp) { recruitCenterLX = wp.cx * 256 + 128; recruitCenterLY = wp.cy * 256 + 128; }
      }
      for (const member of ct.members) {
        const memberType = member.type.toUpperCase();
        for (let i = 0; i < member.count; i++) {
          // C++ team.cpp:1205-1216: finds NEAREST matching unit to recruit center
          let best: Entity | null = null;
          let bestDist = -1;
          for (const e of this.entities) {
            if (!e.alive || e.inLimbo || e.type !== memberType ||
                e.house !== ct.house || e.mission !== Mission.GUARD ||
                e.target || e.moveTarget || recruitedSet.has(e)) continue;
            const d = leptonDist(e.leptonX, e.leptonY, recruitCenterLX, recruitCenterLY);
            if (bestDist === -1 || d < bestDist) {
              best = e;
              bestDist = d;
            }
          }
          if (best) {
            recruitedSet.add(best);
            // C++ parity: Team::Add does NOT copy missions to the entity.
            // The TeamInstance coordinator handles missions (coordinateMove,
            // coordinateDo). Do NOT pre-assign teamMissions — they would
            // conflict with the coordinator via updateTeamMission.
            recruited.push(best);
          }
        }
      }
      // C++ parity: Create_One_Of with ScenarioInit++ always creates a TeamClass.
      // This Team.AI() runs every tick, consuming RNG (Percent_Chance at activation,
      // Coordinate_Move/Attack re-assigning missions with timer reset).
      // C++ taction.cpp:658-661: Create_One_Of creates an EMPTY team.
      // Members are recruited 1-per-tick via Team::Recruit() in Team::AI().
      // The team activates (Percent_Chance) only when full strength is reached.
      // For subz team (SS:3), this means: tick 1→1 sub, tick 2→2, tick 3→3,
      // tick 4→full→activate. We do NOT pre-add members.
      if (ct.teamIdx !== undefined) {
        const teamType = this.teamTypes[ct.teamIdx];
        if (teamType) {
          // C++ team.cpp:1186-1188: recruit center is the team type's origin
          // waypoint when set (Class->Origin != -1).
          let originPos: WorldPos | null = null;
          if (teamType.origin >= 0) {
            const wp = this.waypoints.get(teamType.origin);
            if (wp) {
              originPos = { x: wp.cx * CELL_SIZE + CELL_SIZE / 2, y: wp.cy * CELL_SIZE + CELL_SIZE / 2 };
            }
          }
          const team = new TeamInstance({
            typeName: teamType.name,
            teamTypeIndex: ct.teamIdx,
            house: ct.house,
            desiredMembers: teamType.members.map(m => ({ type: m.type.toUpperCase(), count: m.count })),
            missionList: ct.missions.length > 0 ? ct.missions.map(m => ({ mission: m.mission, data: m.data })) : [],
            isReinforcable: !!(teamType.flags & 16),
            isSuicide: !!(teamType.flags & 2),
            origin: originPos,
            // C++ taction.cpp:658-661: ScenarioInit++ wraps Create_One_Of but does
            // NOT call Force_Active. Team activates via normal Percent_Chance(50)
            // in Team::AI on subsequent ticks.
            forcedActive: false,
            // C++ parity: WASM observation shows CREATE_TEAM teams composed of
            // VESSEL members (e.g. SCG07EA subz, BadGuy SS:3) take an EXTRA
            // tick to begin recruiting — tick 1 empty, tick 2 first recruit,
            // tick 3 full. INFANTRY/UNIT/AIRCRAFT CREATE_TEAM teams begin
            // recruiting on tick 1 (e.g. SCG03EA sov1 E1:1 reaches full
            // strength tick 1; SCG11EA mmth1 4TNK:2 reaches full strength
            // tick 1). The mechanism in the C++ source is unclear — both
            // UNIT (team.cpp:1250-1286) and VESSEL (team.cpp:1288-1322)
            // use the same inside-loop `if (best) { Add(best); }` pattern
            // and equivalent iteration. Observed: VESSEL teams always show
            // total=0 at tick 1 in WASM regardless of waypoint origin.
            // Gate skipFirstAiCall on presence of a vessel member type so
            // we match the SCG07EA subz cadence without regressing the
            // non-vessel teams that WASM recruits immediately.
            skipFirstAiCall: teamType.members.some(m => {
              const t = m.type.toUpperCase();
              // RA vessels: SS (submarine), DD (destroyer), CA (cruiser),
              // PT (patrol), LST (transport), MSUB (missile sub).
              return t === 'SS' || t === 'DD' || t === 'CA' || t === 'PT' || t === 'LST' || t === 'MSUB';
            }),
          });
          // Empty team — Team.recruit() in Team.ai() adds members 1/tick
          registerTeam(team);
        }
      }
    }
    if (result.spawned.length > 0) {
      applyScenarioOverrides(result.spawned, this.scenarioUnitStats, this.scenarioWeaponStats);
      // C++ parity: if reinforcement units spawned on impassable terrain (water, rock),
      // relocate to nearest passable cell. C++ uses Nearest_Free_Cell() in reinf.cpp.
      // Aircraft skip this check — they spawn OUTSIDE the map boundary intentionally
      // and fly into the map (C++ reinf.cpp:467 unlimbo at Calculated_Cell which is
      // 1 cell outside the boundary).
      for (const entity of result.spawned) {
        if (entity.isAirUnit) continue; // aircraft spawn outside map boundary
        // C++ parity: edge-spawned reinforcements are 1 cell OUTSIDE the map boundary.
        // Don't relocate them — they move in via team mission scripts (TMISSION_MOVE).
        const cell = worldToCell(entity.pos.x, entity.pos.y);
        if (!this.map.inBounds(cell.cx, cell.cy)) continue;
        const naval = entity.stats.isVessel;
        const passable = naval ? this.map.isWaterPassable(cell.cx, cell.cy) : this.map.isTerrainPassable(cell.cx, cell.cy);
        if (!passable) {
          const alt = nearbyLocation(this.map, cell, naval ?? false);
          if (alt) {
            entity.setPosition(alt.cx * CELL_SIZE + CELL_SIZE / 2, alt.cy * CELL_SIZE + CELL_SIZE / 2);
          }
        }
      }
    }
    const ants = result.spawned.filter(e => e.isAnt);
    if (ants.length > 1) {
      const wid = this.nextWaveId++;
      const rallyDelay = this.tick + GAME_TICKS_PER_SEC * 2;
      for (const ant of ants) {
        ant.waveId = wid;
        ant.waveRallyTick = rallyDelay;
      }
    }
    // Track spawned entities with team missions for Team creation
    const teamEntities: Entity[] = [];
    for (const entity of result.spawned) {
      this.entities.push(entity);
      this.entityById.set(entity.id, entity);
      if (entity.isPlayerUnit) {
        this.effects.push({
          type: 'marker', x: entity.pos.x, y: entity.pos.y,
          frame: 0, maxFrames: 15, size: 14, markerColor: 'rgba(100,200,255,1)',
        });
      }
      if (entity.teamMissions.length > 0) teamEntities.push(entity);
      // C++ parity: _Is_It_Breathing bypasses IsInLimbo during ScenarioInit,
      // so cargo (transport passengers) ARE added as team members even though
      // they're not yet in the entities list. See team.cpp:105-120.
      if (entity.isTransport && entity.passengers.length > 0) {
        for (const passenger of entity.passengers) {
          if (passenger.teamMissions.length > 0) teamEntities.push(passenger);
        }
      }
    }
    // C++ parity: ALWAYS create a Team for reinforcements (TACTION_REINFORCEMENTS).
    // C++ reinf.cpp:171-173: _Create_Group() does `new TeamClass(teamtype)` directly
    // (NOT Create_One_Of which checks MaxAllowed). Then Force_Active() is called.
    // This is different from TACTION_CREATE_TEAM which uses Create_One_Of + ScenarioInit.
    const teamMembersForTeam = (result.teamCreationOrder ?? teamEntities)
      .filter((e) => e.teamMissions.length > 0);
    if (teamMembersForTeam.length > 0 && result.spawnedTeamIdx !== undefined) {
      const teamType = this.teamTypes[result.spawnedTeamIdx];
      if (teamType) {
        const teamHouse = teamMembersForTeam[0].house;
        const memberCounts = new Map<string, number>();
        for (const e of teamMembersForTeam) {
          memberCounts.set(e.type, (memberCounts.get(e.type) ?? 0) + 1);
        }
        const desiredMembers = [...memberCounts.entries()].map(([type, count]) => ({ type, count }));
        // C++ team.cpp:1186-1188: recruit center is team type origin waypoint
        let originPos: WorldPos | null = null;
        if (teamType.origin >= 0) {
          const wp = this.waypoints.get(teamType.origin);
          if (wp) {
            originPos = { x: wp.cx * CELL_SIZE + CELL_SIZE / 2, y: wp.cy * CELL_SIZE + CELL_SIZE / 2 };
          }
        }
        const team = new TeamInstance({
          typeName: teamType.name,
          teamTypeIndex: result.spawnedTeamIdx,
          house: teamHouse,
          desiredMembers,
          missionList: teamEntities[0].teamMissions,
          isReinforcable: !!(teamType.flags & 16),
          isSuicide: !!(teamType.flags & 2),
          origin: originPos,
          // C++ reinf.cpp:173: team->Force_Active() — team activates immediately
          forcedActive: true,
        });
        for (const e of teamMembersForTeam) {
          team.add(e);
        }
        registerTeam(team);
      }
    }
    if (result.destroyTriggeringUnit) {
      let destroyed = false;
      if (trigger.triggeringEntityIds.length > 0) {
        for (const eid of trigger.triggeringEntityIds) {
          const te = this.entityById.get(eid);
          if (te && te.alive) {
            te.takeDamage(9999);
            this.effects.push({
              type: 'explosion', x: te.pos.x, y: te.pos.y,
              frame: 0, maxFrames: 18, size: 12,
              sprite: 'fball1', spriteStart: 0,
            });
            destroyed = true;
          }
        }
        trigger.triggeringEntityIds = [];
      }
      if (!destroyed) {
        for (const e of this.entities) {
          if (e.alive && e.triggerName === trigger.name) {
            e.takeDamage(9999);
            this.effects.push({
              type: 'explosion', x: e.pos.x, y: e.pos.y,
              frame: 0, maxFrames: 18, size: 12,
              sprite: 'fball1', spriteStart: 0,
            });
          }
        }
        for (const s of this.structures) {
          if (s.alive && s.triggerName === trigger.name) {
            this.damageStructure(s, s.maxHp + 1);
          }
        }
      }
    }
    // C++ parity (#39): TACTION_BASE_BUILDING — set IsBaseBuilding on/off for AI house
    if (result.baseBuilding !== undefined) {
      const bbHouse = houseIdToHouse(result.baseBuilding.house);
      const aiState = this.aiStates.get(bbHouse);
      if (aiState) {
        aiState.isBaseBuilding = result.baseBuilding.enabled;
        // C++ house.cpp:936-940: IsBaseBuilding cascade → IsStarted + IsAlerted
        if (result.baseBuilding.enabled) {
          aiState.isStarted = true;
          aiState.isAlerted = true;
          aiState.productionEnabled = true;
        }
      } else if (result.baseBuilding.enabled && !this.isAllied(bbHouse, this.playerHouse)) {
        const newState = this.createAIHouseState(bbHouse);
        newState.isBaseBuilding = true;
        newState.isStarted = true;
        newState.isAlerted = true;
        newState.productionEnabled = true;
        this.aiStates.set(bbHouse, newState);
      }
    }
    // C++ parity (#38): if this action changed a global, immediately spring dependent triggers
    if (result.globalChanged !== undefined) {
      this.springGlobalTriggers(result.globalChanged);
    }
  }

  /**
   * C++ parity (#38): When a global variable changes, immediately scan all triggers
   * that depend on TEVENT_GLOBAL_SET/TEVENT_GLOBAL_CLEAR for that global and spring them.
   *
   * C++ ref: scenario.cpp:263-290 Set_Global_To() sets IsGlobalChanged flag and resets
   * paired event timers. logic.cpp:218-221 then springs TEVENT_GLOBAL_SET/CLEAR triggers
   * on the very next logic tick (not deferred to the 15-tick processTriggers cycle).
   */
  private springGlobalTriggers(globalIndex: number): void {
    // C++ ScenarioClass::Set_Global_To has an asymmetric event-slot reset:
    //   if Event1 is the changed global: Class->Event2.Reset(Event1)
    //   if Event2 is the changed global: Class->Event1.Reset(Event1)
    // Reset() mutates the TDEventClass argument, so the first branch does NOT
    // reset an Event2 TIME timer. SCG11EA's air1 trigger relies on this: tim1
    // sets global 1 after the air1 TIME event has already elapsed, and C++ lets
    // air1 fire in that same LogicTrigger pass instead of restarting its timer.
    for (const trigger of this.triggers) {
      if ((trigger.event2.type === TEVENT_GLOBAL_SET || trigger.event2.type === TEVENT_GLOBAL_CLEAR)
          && trigger.event2.data === globalIndex &&
          trigger.event1.type === TEVENT_TIME) {
        // Reset Event1 timer — C++ scenario.cpp:283.
        trigger.timerTick = this.tick;
      }
    }

    // C++ logic.cpp:218-221: immediately spring triggers that depend on global state.
    // Build minimal shared state for trigger evaluation.
    const structureTypes = new Set<string>();
    const structureTypesByHouse = new Map<number, Set<string>>();
    const destroyedTriggerNames = new Set<string>(this.destroyedTriggerNames);
    const houseAlive = new Map<number, boolean>();
    const houseUnitsAlive = new Map<number, boolean>();
    const houseBuildingsAlive = new Map<number, boolean>();
    const housesWithBuildings = new Set<number>();
    let playerFactories = 0;
    let fakesExist = false;
    const FAKE_TYPES = new Set(['FACF', 'DOMF', 'WEAF']);
    for (const s of this.structures) {
      if (s.alive) {
        structureTypes.add(s.type);
        if (this.isAllied(s.house, this.playerHouse) &&
            (s.type === 'FACT' || s.type === 'WEAP' || s.type === 'BARR' || s.type === 'TENT' || s.type === 'AFLD' || s.type === 'HPAD' || s.type === 'SYRD' || s.type === 'SPEN')) {
          playerFactories++;
        }
        const hi = Game.HOUSE_TO_INDEX[s.house];
        if (hi !== undefined) {
          houseAlive.set(hi, true);
          if (!WALL_TYPES.has(s.type)) {
            houseBuildingsAlive.set(hi, true);
            housesWithBuildings.add(hi);
          }
          let hset = structureTypesByHouse.get(hi);
          if (!hset) { hset = new Set<string>(); structureTypesByHouse.set(hi, hset); }
          hset.add(s.type);
        }
        if (FAKE_TYPES.has(s.type)) fakesExist = true;
      } else if (s.triggerName) {
        destroyedTriggerNames.add(s.triggerName);
      }
    }
    for (const e of this.entities) {
      this.addEntityHouseActiveScan(e, houseAlive, houseUnitsAlive);
      if (!e.alive && e.triggerName) {
        destroyedTriggerNames.add(e.triggerName);
      }
    }
    const buildingsDestroyedByHouse = new Map<number, boolean>();
    for (const s of this.structures) {
      const hi = Game.HOUSE_TO_INDEX[s.house];
      if (hi !== undefined && !WALL_TYPES.has(s.type) && !housesWithBuildings.has(hi)) {
        buildingsDestroyedByHouse.set(hi, true);
      }
    }
    const shared = {
      structureTypes, destroyedTriggerNames, enemyUnitsAlive: 0, playerFactories,
      houseAlive, houseUnitsAlive, houseBuildingsAlive,
      builtStructureTypes: this.builtStructureTypes,
      buildingsDestroyedByHouse, fakesExist, structureTypesByHouse,
      builtStructureTypesByHouse: this.builtStructureTypesByHouse,
    };

    for (const trigger of this.triggers) {
      if (trigger.fired && trigger.persistence <= 1) continue;

      // Only spring triggers that have a global event matching this globalIndex
      const e1IsGlobal = (trigger.event1.type === TEVENT_GLOBAL_SET || trigger.event1.type === TEVENT_GLOBAL_CLEAR)
                         && trigger.event1.data === globalIndex;
      const e2IsGlobal = (trigger.event2.type === TEVENT_GLOBAL_SET || trigger.event2.type === TEVENT_GLOBAL_CLEAR)
                         && trigger.event2.data === globalIndex;
      if (!e1IsGlobal && !e2IsGlobal) continue;

      const springEvent = e1IsGlobal ? trigger.event1.type : trigger.event2.type;
      const state = this.buildTriggerState(trigger, shared);
      const result = this.checkTriggerEvents(trigger, state, springEvent);
      if (!result.shouldFire) continue;

      if (this.debugTriggers) {
        console.log(`[TRIGGER] ${trigger.name} sprung immediately by global ${globalIndex} change`);
      }
      trigger.fired = true;
      if (trigger.persistence === 2) {
        trigger.timerTick = this.tick;
      }

      // Execute actions (same logic as processTriggers)
      const executeAction = (action: typeof trigger.action1) => {
        if ((action.action === 4 || action.action === 7) && this.destroyedTeams.has(action.team)) return;
        const actionResult = executeTriggerAction(
          action, this.teamTypes, this.waypoints, this.globals, this.triggers, trigger.house,
          this.houseEdges, { x: this.map.boundsX, y: this.map.boundsY, w: this.map.boundsW, h: this.map.boundsH },
          Game.HOUSE_TO_INDEX[this.playerHouse] ?? -1, this.map, this.entities,
        );
        this.applyTriggerActionResult(actionResult, trigger);
      };

      if (trigger.eventControl === 3) {
        if (result.e1) executeAction(trigger.action1);
        if (result.e2) executeAction(trigger.action2);
      } else {
        executeAction(trigger.action1);
        if (trigger.actionControl === 1) {
          executeAction(trigger.action2);
        }
      }
    }
  }

  /** Process trigger system — check conditions and fire actions */
  private processTriggers(
    springEvent?: number,
    options: {
      clearTransient?: boolean;
      onlyEventTypes?: Set<number>;
      skipPersistentFiredThisTick?: boolean;
    } = {},
  ): void {
    // Mission timer now decrements per-tick in update() for C++ FrameTimerClass parity.

    // Precompute shared state once for all triggers (avoids O(N*M) recomputation)
    const structureTypes = new Set<string>();
    // C++ tevent.cpp: BUILDING_EXISTS checks HouseClass::BQuantity[type] > 0 for trigger.house.
    const structureTypesByHouse = new Map<number, Set<string>>();
    // Start with persistent destroyed trigger names, then add currently-dead entities/structures
    const destroyedTriggerNames = new Set<string>(this.destroyedTriggerNames);
    const houseAlive = new Map<number, boolean>();
    const houseUnitsAlive = new Map<number, boolean>();
    const houseBuildingsAlive = new Map<number, boolean>();
    const housesWithBuildings = new Set<number>(); // houses that currently have alive buildings
    let playerFactories = 0;
    let fakesExist = false;
    const FAKE_TYPES = new Set(['FACF', 'DOMF', 'WEAF']);
    for (const s of this.structures) {
      if (s.alive) {
        structureTypes.add(s.type);
        if (this.isAllied(s.house, this.playerHouse) &&
            (s.type === 'FACT' || s.type === 'WEAP' || s.type === 'BARR' || s.type === 'TENT' || s.type === 'AFLD' || s.type === 'HPAD' || s.type === 'SYRD' || s.type === 'SPEN')) {
          playerFactories++;
        }
        const hi = Game.HOUSE_TO_INDEX[s.house];
        if (hi !== undefined) {
          houseAlive.set(hi, true);
          if (!WALL_TYPES.has(s.type)) {
            houseBuildingsAlive.set(hi, true);
            housesWithBuildings.add(hi);
          }
          let hset = structureTypesByHouse.get(hi);
          if (!hset) { hset = new Set<string>(); structureTypesByHouse.set(hi, hset); }
          hset.add(s.type);
        }
        if (FAKE_TYPES.has(s.type)) fakesExist = true;
      } else if (s.triggerName) {
        destroyedTriggerNames.add(s.triggerName);
      }
    }
    let enemyUnitsAlive = 0;
    for (const e of this.entities) {
      if (e.alive && !this.isPlayerControlled(e) && !e.isCivilian) enemyUnitsAlive++;
      this.addEntityHouseActiveScan(e, houseAlive, houseUnitsAlive);
      if (!e.alive && e.triggerName) {
        destroyedTriggerNames.add(e.triggerName);
      }
    }
    // Compute per-house buildings destroyed: house had buildings at some point but has none now
    const buildingsDestroyedByHouse = new Map<number, boolean>();
    // Check all house indices — if structures existed for a house but none are alive now
    for (const s of this.structures) {
      const hi = Game.HOUSE_TO_INDEX[s.house];
      if (hi !== undefined && !WALL_TYPES.has(s.type) && !housesWithBuildings.has(hi)) {
        buildingsDestroyedByHouse.set(hi, true);
      }
    }
    const shared = {
      structureTypes, destroyedTriggerNames, enemyUnitsAlive, playerFactories,
      houseAlive, houseUnitsAlive, houseBuildingsAlive,
      builtStructureTypes: this.builtStructureTypes,
      buildingsDestroyedByHouse, fakesExist, structureTypesByHouse,
      builtStructureTypesByHouse: this.builtStructureTypesByHouse,
    };

    // C++ Spring() parity: count NEW deaths per trigger name.
    // Each death increments pendingDestroyedCount so the trigger fires once per death.
    for (const e of this.entities) {
      if (!e.alive && e.triggerName && !e.triggerDeathProcessed) {
        for (const t of this.triggers) {
          if (t.name === e.triggerName) t.pendingDestroyedCount++;
        }
        e.triggerDeathProcessed = true;
      }
    }
    for (const s of this.structures) {
      if (!s.alive && s.triggerName && !s.triggerDeathProcessed) {
        for (const t of this.triggers) {
          if (t.name === s.triggerName) t.pendingDestroyedCount++;
        }
        s.triggerDeathProcessed = true;
      }
    }

    for (const trigger of this.triggers) {
      if (
        options.onlyEventTypes &&
        !options.onlyEventTypes.has(trigger.event1.type) &&
        !options.onlyEventTypes.has(trigger.event2.type)
      ) {
        continue;
      }
      // Volatile (0) and semi-persistent (1): skip once fired
      // Persistent (2): allowed to re-fire after timer reset
      if (trigger.fired && trigger.persistence <= 1) continue;
      if (
        options.skipPersistentFiredThisTick &&
        trigger.persistence === 2 &&
        trigger.fired &&
        trigger.timerTick === this.tick
      ) {
        continue;
      }

      // Force-fired triggers bypass event conditions
      let shouldFire = false;
      let forcedFire = false;
      let linkedE1 = false;  // per-event results for MULTI_LINKED action routing
      let linkedE2 = false;
      if (trigger.forceFirePending) {
        shouldFire = true;
        forcedFire = true;
        linkedE1 = true;     // C++ trigger.cpp:308 — forced fires Action1 (e1 || forced)
        trigger.forceFirePending = false;
      } else {
        // Check event conditions
        const state = this.buildTriggerState(trigger, shared);
        const result = this.checkTriggerEvents(trigger, state, springEvent);
        shouldFire = result.shouldFire;
        linkedE1 = result.e1;
        linkedE2 = result.e2;
      }

      if (!shouldFire) continue;

      // C++ trigger.cpp:277-298 — semi-persistent AttachCount gate runs even for forced triggers.
      // For non-forced fires, destroyed deaths are used as detach count.
      // For forced fires, detach by 1 (C++ Spring() always decrements once).
      if (!forcedFire) {
        const destroyedDetachCount =
          trigger.event1.type === 7 || trigger.event2.type === 7
            ? trigger.pendingDestroyedCount
            : 0;
        if (
          destroyedDetachCount > 0 &&
          !consumeSemiPersistentAttachment(trigger, destroyedDetachCount)
        ) {
          trigger.pendingDestroyedCount = 0;
          continue;
        }
      } else if (trigger.persistence === 1) {
        // C++ parity: forced triggers still go through semi-persistent AttachCount gate
        if (!consumeSemiPersistentAttachment(trigger, 1)) {
          continue;
        }
      }
      if (this.debugTriggers) {
        console.log(`[TRIGGER] ${trigger.name} fired | event1=${trigger.event1.type} action1=${trigger.action1.action}${trigger.action2 ? ' action2=' + trigger.action2.action : ''}`);
      }
      trigger.fired = true;

      // C++ Spring() parity: decrement pending death count so each death fires once.
      // Non-persistent triggers drain fully (they won't re-fire anyway).
      if (trigger.event1.type === 7 || trigger.event2.type === 7) { // 7 = TEVENT_DESTROYED
        if (trigger.persistence < 2) {
          trigger.pendingDestroyedCount = 0;
        } else {
          trigger.pendingDestroyedCount = Math.max(0, trigger.pendingDestroyedCount - 1);
        }
      }

      // Persistent triggers: reset timer and event flags so events must occur again
      // C++ trigger.cpp:345-353 — Class->Event1.Reset(Event1); Class->Event2.Reset(Event2);
      if (trigger.persistence === 2) {
        trigger.timerTick = this.tick;
        trigger.playerEntered = false;
        trigger.objectDiscovered = false;
        trigger.enteredZone = false;
        trigger.crossedHorizontal = false;
        trigger.crossedVertical = false;
      }

      // Execute actions — delegates to applyTriggerActionResult (C++ parity #38 refactor)
      const executeAction = (action: typeof trigger.action1) => {
        if ((action.action === 4 || action.action === 7) && this.destroyedTeams.has(action.team)) return;
        const result = executeTriggerAction(
          action, this.teamTypes, this.waypoints, this.globals, this.triggers, trigger.house,
          this.houseEdges, { x: this.map.boundsX, y: this.map.boundsY, w: this.map.boundsW, h: this.map.boundsH },
          Game.HOUSE_TO_INDEX[this.playerHouse] ?? -1, this.map, this.entities,
        );
        this.applyTriggerActionResult(result, trigger);
      };

      // C++ trigger.cpp:307-323 — MULTI_LINKED routes actions per-event;
      // all other modes use actionControl to decide which actions fire.
      if (trigger.eventControl === 3) {
        // MULTI_LINKED: Action1 fires if e1 true OR forced, Action2 fires if e2 true AND NOT forced
        if (linkedE1 || forcedFire) executeAction(trigger.action1);
        if (linkedE2 && !forcedFire) executeAction(trigger.action2);
      } else {
        executeAction(trigger.action1);
        if (trigger.actionControl === 1) {
          executeAction(trigger.action2);
        }
      }

      // C++ Spring() parity: if multiple entities with this triggerName died
      // simultaneously, fire once per death (C++ calls Spring() per-entity).
      let extraFires = 8; // guard against infinite loops
      while (trigger.persistence === 2 && trigger.pendingDestroyedCount > 0 && extraFires-- > 0) {
        const reState = this.buildTriggerState(trigger, shared);
        const reResult = this.checkTriggerEvents(trigger, reState, springEvent);
        if (!reResult.shouldFire) break;
        if (this.debugTriggers) {
          console.log(`[TRIGGER] ${trigger.name} re-fired (pending=${trigger.pendingDestroyedCount})`);
        }
        trigger.pendingDestroyedCount = Math.max(0, trigger.pendingDestroyedCount - 1);
        trigger.timerTick = this.tick;
        // C++ trigger.cpp:351-352 — Event1.Reset + Event2.Reset on each re-fire
        trigger.playerEntered = false;
        trigger.objectDiscovered = false;
        trigger.enteredZone = false;
        trigger.crossedHorizontal = false;
        trigger.crossedVertical = false;
        if (trigger.eventControl === 3) {
          if (reResult.e1) executeAction(trigger.action1);
          if (reResult.e2) executeAction(trigger.action2);
        } else {
          executeAction(trigger.action1);
          if (trigger.actionControl === 1) {
            executeAction(trigger.action2);
          }
        }
      }
    }

    // Clear transient per-tick state
    if (options.clearTransient !== false) this.attackedTriggerNames.clear();
  }

  /** Display an EVA text message (by trigger data ID) */
  private showEvaMessage(id: number, customText?: string): void {
    if (customText) {
      this.evaMessages.push({ text: customText, tick: this.tick });
      this.audio.play('eva_acknowledged');
      return;
    }
    // Map message IDs to text — from RA tutorial.txt (Soviet campaign text strings).
    // C++ taction.cpp:371: TutorialTextData + TutorialTextOffsets[Data.Value]
    const messages: Record<number, string> = {
      0: 'Locate the enemy\'s command center and destroy it.',
      1: 'Reinforcements have arrived.',
      2: 'Objective reached.',
      3: 'Warning: enemy forces detected nearby.',
      4: 'New objective received.',
      5: 'Base is under attack!',
      6: 'Rescue Einstein from the Tech Center.',
      7: 'Bridge destroyed.',
      8: 'Power restored.',
      9: 'Signal flare detected.',
      10: 'Use engineers to capture the enemy buildings.',
      11: 'Move to the signal flare.',
      12: 'Destroy all remaining enemy forces and structures.',
      13: 'Destroy the Allied base.',
      14: 'Capture the radar dome.',
      15: 'Destroy the Allied naval base.',
      16: 'Escort the convoy to the other side of the map.',
      17: 'Incoming transmission...',
      18: 'Enemy reinforcements have arrived.',
      19: 'Find and rescue the hostages.',
      20: 'Escort the hostages to the evacuation point.',
      21: 'Destroy the Allied base to the north.',
      22: 'Destroy the bridge.',
      23: 'Capture the enemy radar dome.',
      24: 'Destroy the enemy sub pens.',
      25: 'Our forces are under attack!',
      26: 'Take out the enemy defenses.',
      27: 'Destroy the enemy Chronosphere.',
      28: 'Intelligence reports enemy movement.',
      29: 'Use your MiGs to destroy the Allied base.',
      30: 'Destroy the enemy gap generators.',
      31: 'Capture the Allied tech center.',
      32: 'Enemy forces neutralized in this sector.',
      33: 'Establish your base.',
      34: 'Use engineers to capture enemy buildings.',
      35: 'Build your forces.',
      36: 'Enemy base located.',
      37: 'Primary objective updated.',
      38: 'Secure the area.',
      39: 'Warning: ore supplies running low.',
      40: 'Enemy air power detected.',
      41: 'Allied reinforcements incoming.',
      42: 'New construction options available.',
      43: 'Unit promoted.',
      44: 'Structure captured.',
      45: 'Unit ready.',
      46: 'Building complete.',
      47: 'Low power.',
      48: 'Insufficient funds.',
      49: 'Enemy structure destroyed.',
      50: 'Critical mission update.',
      51: 'Einstein has been captured.',
      52: 'Warning: enemy reinforcements approaching.',
      54: 'The bridge has been repaired.',
      60: 'Convoy has arrived safely.',
      61: 'The base is ours.',
      62: 'Tanya is on-site.',
      64: 'The Chronosphere must be destroyed.',
      66: 'Soviet forces detected.',
      67: 'Control the battlefield.',
      68: 'Enemy armor approaching.',
      69: 'Hold your position.',
      70: 'Allied forces have been spotted.',
      71: 'Secure the area.',
      72: 'New objective: destroy all enemy forces.',
      73: 'Reinforcements en route.',
      74: 'Our base is under attack!',
      75: 'Enemy counter-attack imminent.',
      76: 'Regroup your forces.',
      77: 'All objectives complete.',
      78: 'Protect the war factory.',
      79: 'Enemy naval forces detected.',
      80: 'Launch the missiles.',
      81: 'Target acquired.',
      86: 'Mission critical update.',
      87: 'Warning: Ant activity detected in tunnels.',
      88: 'We have lost contact with the outpost.',
      96: 'Bridge charges set. Take cover!',
      100: 'Alert! Large ant force approaching.',
    };
    const text = messages[id] ?? `EVA: Message ${id}`;
    this.evaMessages.push({ text, tick: this.tick });
    this.audio.play('eva_acknowledged');
  }

  /** Reveal map around a specific cell — delegates to fog.ts */
  private revealAroundCell(cx: number, cy: number, radius: number): void {
    _revealAroundCell(this.map, cx, cy, radius);
  }

  /** C++ TechnoClass::Fire_At (techno.cpp:3263-3265):
   *  A hidden shooter reveals a 2-cell radius around itself with
   *  `Map.Sight_From(Coord_Cell(Center_Coord()), 2, PlayerPtr, false)`.
   *  DisplayClass::Map_Cell then calls `tech->Revealed(PlayerPtr)` for
   *  objects in newly mapped cells, which sets IsDiscoveredByPlayer. */
  private revealShooterFromFire(entity: Entity): void {
    if (!entity.alive) return;

    const ownedByPlayer = entity.house === this.playerHouse;
    const discoveredByPlayer = this.discoveredEntityIds.has(entity.id);
    const mapped = this.map.getVisibility(entity.cell.cx, entity.cell.cy) > 0;
    const shouldReveal =
      (!ownedByPlayer && !discoveredByPlayer) ||
      (!mapped && (!entity.isAirUnit || !ownedByPlayer));

    if (!shouldReveal) return;

    this.revealSightFromPlayer(entity.cell.cx, entity.cell.cy, 2);
  }

  /** C++ MapClass::Sight_From(..., PlayerPtr): map cells and run Map_Cell's
   *  object discovery side effect for the same sight radius. */
  private revealSightFromPlayer(cx: number, cy: number, radius: number): void {
    this.revealAroundCell(cx, cy, radius);
    this.markObjectsRevealedToPlayer(cx, cy, radius);
  }

  /** Mirror DisplayClass::Map_Cell's `tech->Revealed(PlayerPtr)` side effect
   *  for cells exposed by a non-standard reveal path such as Fire_At. */
  private markObjectsRevealedToPlayer(cx: number, cy: number, radius: number): void {
    const inSight = (x: number, y: number): boolean => {
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      const big = dx > dy ? dx : dy;
      const small = dx > dy ? dy : dx;
      return big * 2 + small <= radius * 2;
    };

    const revealEntity = (e: Entity): void => {
      if (!e.alive || e.house === this.playerHouse) return;
      if (!inSight(e.cell.cx, e.cell.cy)) return;
      if (this.discoveredEntityIds.has(e.id)) return;

      this.discoveredEntityIds.add(e.id);
      const hi = Game.HOUSE_TO_INDEX[e.house];
      if (hi !== undefined) this.houseDiscovered.set(hi, true);

      if (e.triggerName) {
        for (const trigger of this.triggers) {
          if (trigger.name === e.triggerName) trigger.objectDiscovered = true;
        }
      }
    };

    for (const e of this.entities) revealEntity(e);

    for (let si = 0; si < this.structures.length; si++) {
      const s = this.structures[si];
      if (!s.alive || s.house === this.playerHouse) continue;
      if (this.discoveredStructureIds.has(si)) continue;

      let footprintInSight = false;
      const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
      for (let y = 0; y < sh && !footprintInSight; y++) {
        for (let x = 0; x < sw; x++) {
          if (inSight(s.cx + x, s.cy + y)) {
            footprintInSight = true;
            break;
          }
        }
      }
      if (!footprintInSight) continue;

      this.discoveredStructureIds.add(si);
      const hi = Game.HOUSE_TO_INDEX[s.house];
      if (hi !== undefined) this.houseDiscovered.set(hi, true);

      if (s.triggerName) {
        for (const trigger of this.triggers) {
          if (trigger.name === s.triggerName) trigger.objectDiscovered = true;
        }
      }
    }
  }

  /** C++ TACTION_REVEAL_ALL maps every cell with PlayerPtr, so every object
   *  currently on the map receives Revealed(PlayerPtr). */
  private markAllObjectsRevealedToPlayer(): void {
    for (const e of this.entities) {
      if (!e.alive || e.house === this.playerHouse) continue;
      if (this.discoveredEntityIds.has(e.id)) continue;
      this.discoveredEntityIds.add(e.id);
      const hi = Game.HOUSE_TO_INDEX[e.house];
      if (hi !== undefined) this.houseDiscovered.set(hi, true);
      if (e.triggerName) {
        for (const trigger of this.triggers) {
          if (trigger.name === e.triggerName) trigger.objectDiscovered = true;
        }
      }
    }

    for (let si = 0; si < this.structures.length; si++) {
      const s = this.structures[si];
      if (!s.alive || s.house === this.playerHouse) continue;
      if (this.discoveredStructureIds.has(si)) continue;
      this.discoveredStructureIds.add(si);
      const hi = Game.HOUSE_TO_INDEX[s.house];
      if (hi !== undefined) this.houseDiscovered.set(hi, true);
      if (s.triggerName) {
        for (const trigger of this.triggers) {
          if (trigger.name === s.triggerName) trigger.objectDiscovered = true;
        }
      }
    }
  }

  /** Check if a player unit has discovered the base (enables production) */
  private checkBaseDiscovery(): void {
    if (this.baseDiscovered) return;
    for (const e of this.entities) {
      if (!e.alive || !e.isPlayerUnit) continue;
      for (const s of this.structures) {
        if (!s.alive || !this.isAllied(s.house, this.playerHouse)) continue;
        const dx = e.pos.x / CELL_SIZE - s.cx;
        const dy = e.pos.y / CELL_SIZE - s.cy;
        if (dx * dx + dy * dy < 25) { // 5-cell radius
          this.baseDiscovered = true;
          this.audio.play('eva_new_options');
          this.showEvaMessage(10); // "Construction options available."
          this.revealAroundCell(s.cx, s.cy, 10);
          // C++ parity: no garrison spawn on base discovery — C++ has no
          // equivalent mechanic. Reinforcements come from scenario triggers only.
          return;
        }
      }
    }
  }

  /** Spawn reinforcement infantry near barracks when base is first discovered */
  private spawnBaseReinforcements(): void {
    const barracks = this.structures.find(b =>
      b.alive && b.type === 'TENT' && this.isAllied(b.house, this.playerHouse)
    );
    if (!barracks) return;
    const bx = barracks.cx * CELL_SIZE + CELL_SIZE;
    const by = barracks.cy * CELL_SIZE + CELL_SIZE * 2;
    const types = [
      UnitType.I_E1, UnitType.I_E1, UnitType.I_E1, // 3 Rifle soldiers
      UnitType.I_E2, UnitType.I_E2,                 // 2 Grenadiers
    ];
    for (let i = 0; i < types.length; i++) {
      const rx = bx + ((i % 3) - 1) * CELL_SIZE;
      const ry = by + Math.floor(i / 3) * CELL_SIZE;
      const inf = new Entity(types[i], this.playerHouse, rx, ry);
      inf.mission = Mission.GUARD;
      this.entities.push(inf);
      this.entityById.set(inf.id, inf);
      this.effects.push({
        type: 'marker', x: rx, y: ry,
        frame: 0, maxFrames: 15, size: 14, markerColor: 'rgba(100,200,255,1)',
      });
    }
    this.audio.play('eva_reinforcements');
  }

  /** Handle trigger speech events (EVA voice lines) */
  private handleTriggerSpeech(speechId: number): void {
    // RA speech IDs map to EVA voice lines; play closest match
    const speechMap: Record<number, SoundName> = {
      88: 'eva_mission_warning',
    };
    const sound = speechMap[speechId];
    if (sound) this.audio.play(sound);
  }

  /** Handle trigger sound effects */
  private handleTriggerSound(soundData: number): void {
    // Data may be negative (unsigned 16-bit packed as signed)
    const soundId = soundData < 0 ? soundData + 65536 : soundData;
    // Map common RA sound IDs to our audio system
    const soundMap: Record<number, SoundName> = {
      47: 'building_explode',
      85: 'tesla_charge',
    };
    const sound = soundMap[soundId];
    if (sound) this.audio.play(sound);
  }

  /** Apply deferred win/lose — called by game tick. C++ house.cpp:945-960 HouseClass::AI() */
  private applyDeferredWinLose(): void {
    if (this.state !== 'playing') return;
    // Decrement BorrowedTime each tick
    if (this.borrowedTime > 0) {
      this.borrowedTime--;
      return; // still counting down
    }
    // C++ house.cpp:945-951 — IsToWin fires when BorrowedTime == 0 && Blockage <= 0
    if (this.isToWin && this.allowWin <= 0) {
      this.isToWin = false;
      if (this.toCarryOver) saveCarryover(this.entities);
      this.state = 'won';
      this.audio.music.stop();
      this.audio.play('victory_fanfare');
      this.audio.play('eva_mission_accomplished');
      this.startScoreMusic();
      this.onStateChange?.('won');
      return;
    }
    // C++ house.cpp:957-963 — IsToLose fires when BorrowedTime == 0
    if (this.isToLose) {
      this.isToLose = false;
      this.state = 'lost';
      this.audio.music.stop();
      this.audio.play('defeat_sting');
      this.startScoreMusic();
      this.onStateChange?.('lost');
      return;
    }
  }

  /** Check win/lose conditions */
  private checkVictoryConditions(): void {
    if (this.state !== 'playing') return;
    if (this.tick < GAME_TICKS_PER_SEC * 3) return;

    // C++ house.cpp:945-972 — process deferred win/lose (BorrowedTime countdown)
    this.applyDeferredWinLose();
    if (this.state !== 'playing') return;

    // C++ parity: loss conditions come from triggers (TACTION_LOSE), not from
    // hardcoded "all units dead" checks. C++ has no equivalent auto-lose —
    // Flag_To_Lose (house.cpp:4102) is only called from the trigger system.
    // The TS hardcoded check caused SCG27EA to lose at tick 60 before
    // trigger-delivered reinforcements could arrive.

    // Win conditions are primarily trigger-driven (TACTION_WIN).
    // Only use the "all ants dead" shortcut if no trigger will fire TACTION_WIN.
    // SCA01EA uses timer-based win; SCA02EA uses bridge+zone win — these must NOT
    // be short-circuited by killing all ants.
    const hasTriggerWin = this.triggers.some(t => {
      if (t.fired && t.persistence <= 1) return false;
      // Only count actions that would actually execute based on actionControl
      return t.action1.action === 1 || // TACTION_WIN = 1
        (t.actionControl === 1 && t.action2.action === 1);
    });
    if (hasTriggerWin) return; // let triggers handle win condition

    // Fallback: all ants dead + no more incoming = win
    const antsAlive = this.entities.some(e => e.alive && e.isAnt);
    const pendingAntTriggers = this.triggers.some(t => {
      if (t.fired && t.persistence <= 1) return false;
      const checksTeam = (team: number) => {
        if (team < 0 || team >= this.teamTypes.length) return false;
        return this.teamTypes[team].members.some(m => m.type.startsWith('ANT'));
      };
      const isSpawnAction = (a: number) => a === 7 || a === 4;
      const spawnsAnts = (isSpawnAction(t.action1.action) && checksTeam(t.action1.team)) ||
             (isSpawnAction(t.action2.action) && checksTeam(t.action2.team));
      if (!spawnsAnts) return false;
      if (t.fired && t.persistence === 2) return true;
      return !t.fired;
    });
    const ANT_STRUCTURES = new Set(['QUEE', 'LAR1', 'LAR2']);
    const antStructuresAlive = this.structures.some(s =>
      s.alive && ANT_STRUCTURES.has(s.type) &&
      !this.isAllied(s.house, this.playerHouse)
    );

    // C++ house.cpp:945 — win only fires when Blockage <= 0
    // If scenario uses ALLOWWIN, gate fallback win on the counter reaching 0
    const hasAllowWinTrigger = this.triggers.some(t =>
      t.action1.action === 15 || (t.actionControl === 1 && t.action2.action === 15)
    );
    if (hasAllowWinTrigger && this.allowWin > 0) return;

    if (!antsAlive && !pendingAntTriggers && !antStructuresAlive) {
      if (this.toCarryOver) saveCarryover(this.entities);
      this.state = 'won';
      this.audio.music.stop();
      this.audio.play('victory_fanfare');
      this.audio.play('eva_mission_accomplished');
      this.startScoreMusic();
      this.onStateChange?.('won');
      return;
    }

    // Generic fallback for campaign missions: all enemy units & buildings destroyed
    if (!this.scenarioId.startsWith('SCA')) {
      const enemyUnitsAlive = this.entities.some(e =>
        e.alive && !e.isPlayerUnit && !this.isAllied(e.house, this.playerHouse) && e.house !== House.Neutral
      );
      const enemyStructuresAlive = this.structures.some(s =>
        s.alive && !this.isAllied(s.house, this.playerHouse) && s.house !== House.Neutral
      );
      if (!enemyUnitsAlive && !enemyStructuresAlive) {
        if (this.toCarryOver) saveCarryover(this.entities);
        this.state = 'won';
        this.audio.music.stop();
        this.audio.play('victory_fanfare');
        this.audio.play('eva_mission_accomplished');
        this.startScoreMusic();
        this.onStateChange?.('won');
      }
    }
  }

  /** Check if player has a building of the given type.
   *  Includes faction-equivalent aliases: TENT↔BARR, SYRD↔SPEN (C++ parity). */
  hasBuilding(type: string): boolean {
    const BUILDING_ALIASES: Record<string, string> = { TENT: 'BARR', BARR: 'TENT', SYRD: 'SPEN', SPEN: 'SYRD' };
    const alt = BUILDING_ALIASES[type];
    return this.structures.some(s => s.alive && (s.type === type || (alt !== undefined && s.type === alt)) &&
      this.isAllied(s.house, this.playerHouse));
  }

  /** Calculate total silo storage capacity from alive player structures.
   *  C++ parity: HouseClass::Adjust_Capacity() — rules.ini Storage= per building.
   *  (PROC=2000, SILO=1500 per rules.ini) */
  calculateSiloCapacity(): number {
    return _calculateSiloCapacity(this.structures, this.playerHouse, (a, b) => this.isAllied(a, b));
  }

  /** Recalculate silo capacity when storage changes.
   *  C++ parity (house.cpp Adjust_Capacity): when capacity decreases and credits exceed
   *  the new capacity, excess credits are LOST (spilled). Both sell (Limbo) and destruction
   *  pass inanger=true in C++, meaning excess tiberium is not refunded.
   *  This creates economic risk — losing storage buildings costs you credits. */
  recalculateSiloCapacity(): void {
    const oldCap = this.siloCapacity;
    this.siloCapacity = this.calculateSiloCapacity();
    // C++ parity: Adjust_Capacity(-delta, true) — excess ore (Tiberium) is LOST.
    // In C++, only the Tiberium (silo-stored) portion is affected; Credits are untouched.
    // TS single-bucket approximation: stored = min(credits, oldCap) is the ore portion.
    // Excess ore beyond new capacity is lost (spilled).
    if (this.credits > this.siloCapacity) {
      const stored = Math.min(this.credits, oldCap); // Tiberium portion
      const excess = Math.max(0, stored - this.siloCapacity);
      this.credits -= excess;
    }
  }

  /** Add credits, capped to silo capacity. Returns amount actually added.
   *  C++ parity: HouseClass::Harvested() — excess credits beyond capacity are lost.
   *  Refunds/bonuses bypass silo cap (C++ HouseClass::Refund_Money path). */
  addCredits(amount: number, bypassSiloCap = false): number {
    if (bypassSiloCap) {
      // Refunds, crate pickups, spy theft — not silo-capped in C++
      this.credits += amount;
      return amount;
    }
    if (this.siloCapacity <= 0) return 0;
    const before = this.credits;
    this.credits = Math.min(this.credits + amount, this.siloCapacity);
    const added = this.credits - before;
    // EVA "silos needed" warning — C++ house.cpp threshold: capacity > 500 && free < 300
    if (this.siloCapacity > 500 && (this.siloCapacity - this.credits) < 300 &&
        this.tick - this.lastSiloWarningTick >= 450) {
      this.lastSiloWarningTick = this.tick;
      this.playEva('eva_silos_needed');
      this.evaMessages.push({ text: 'SILOS NEEDED', tick: this.tick });
    }
    return added;
  }

  /** Get effective cost for an item, applying country bonus multiplier */
  getEffectiveCost(item: ProductionItem): number {
    return _getEffectiveCost(item, this.playerHouse);
  }

  /** Get firepower bias for a house, with ant mission overrides.
   *  In ant missions (SCA*), ant houses use special bias values instead of country bonuses.
   *  C++ house.cpp:287-303: in GAME_NORMAL campaign sessions, country
   *  HouseTypeClass bonuses are not applied; houses use Rule.Diff only. */
  getFirepowerBias(house: House): number {
    if (this.scenarioId.startsWith('SCA') && ANT_HOUSES.has(house)) {
      const ANT_BIAS: Record<string, number> = { USSR: 1.1, Ukraine: 1.0, Germany: 0.9 };
      return ANT_BIAS[house] ?? 1.0;
    }
    // TS currently models GAME_NORMAL scenarios. C++ applies only Rule.Diff here
    // (house.cpp:299), not the country bonus table from rules.ini.
    if (house !== this.playerHouse) {
      const diffMods = AI_DIFFICULTY_MODS[this.difficulty] ?? AI_DIFFICULTY_MODS.normal;
      return diffMods.firepowerBias;
    }
    return 1.0;
  }

  /** Get armor bias for a house.
   *  C++ house.cpp:287-303: GAME_NORMAL uses Rule.Diff only; country armor
   *  bonuses are multiplayer-only (`Session.Type != GAME_NORMAL`). */
  getArmorBias(house: House): number {
    if (house !== this.playerHouse) {
      const diffMods = AI_DIFFICULTY_MODS[this.difficulty] ?? AI_DIFFICULTY_MODS.normal;
      return diffMods.armorBias;
    }
    return 1.0;
  }

  /** Get rate-of-fire bias for a house — difficulty-scaled fire rate.
   *  C++ house.cpp:287-303: GAME_NORMAL uses Rule.Diff only.
   *  Returns <1 for faster fire (hard AI), >1 for slower fire (easy AI). */
  getROFBias(house: House): number {
    if (house !== this.playerHouse) {
      const diffMods = AI_DIFFICULTY_MODS[this.difficulty] ?? AI_DIFFICULTY_MODS.normal;
      return diffMods.rofBias;
    }
    return 1.0;
  }

  /** Get ground speed bias for a house — difficulty-scaled movement speed.
   *  C++ house.cpp:287-303: GAME_NORMAL uses Rule.Diff only.
   *  Returns >1 for faster movement (hard AI). */
  getGroundspeedBias(house: House): number {
    if (house !== this.playerHouse) {
      const diffMods = AI_DIFFICULTY_MODS[this.difficulty] ?? AI_DIFFICULTY_MODS.normal;
      return diffMods.groundspeedBias;
    }
    return 1.0;
  }

  /** Get aircraft speed bias for a house — difficulty-scaled aircraft movement speed.
   *  C++ house.cpp:287-303: GAME_NORMAL uses Rule.Diff only.
   *  Returns >1 for faster aircraft (hard AI). */
  getAirspeedBias(house: House): number {
    if (house !== this.playerHouse) {
      const diffMods = AI_DIFFICULTY_MODS[this.difficulty] ?? AI_DIFFICULTY_MODS.normal;
      return diffMods.airspeedBias;
    }
    return 1.0;
  }

  /** Get buildable items based on current structures + faction + tech prereqs */
  getAvailableItems(): ProductionItem[] {
    return _getAvailableItems(this._productionCtx);
  }

  /** Start building an item (called from sidebar click).
   *  PR3: C++ incremental cost — don't deduct full cost upfront; deduct per-tick during tickProduction.
   *  Players can start building with partial funds; production pauses when broke. */
  startProduction(item: ProductionItem): void {
    this._runProduction(ctx => _startProduction(ctx, item));
  }

  /** Cancel production in a category — removes one from queue, or cancels active build */
  cancelProduction(category: string): void {
    this._runProduction(ctx => _cancelProduction(ctx, category));
  }

  /** Advance production queues each tick.
   *  PR3: C++ incremental cost — deducts costPerTick each tick; pauses if insufficient funds. */
  private tickProduction(): void {
    this._runProduction(ctx => _tickProduction(ctx));
  }

  /** Count alive player buildings of a given type */
  private countPlayerBuildings(type: string): number {
    return _countPlayerBuildings(this.structures, type, this.playerHouse, (a, b) => this.isAllied(a, b));
  }

  /** C++ BuildingTypeClass::ToBuild — AI production is owned by the producing
   *  building, not by the old TS instant-spawn helper. */
  private aiFactoryKindForStructure(s: MapStructure): 'infantry' | 'unit' | null {
    switch (s.type) {
      case 'BARR':
      case 'TENT':
      case 'KENN':
        return 'infantry';
      case 'WEAP':
        return 'unit';
      default:
        return null;
    }
  }

  private aiInfantryFactoryCount(house: House): number {
    let count = 0;
    for (const s of this.structures) {
      if (!s.alive || s.house !== house) continue;
      if (this.aiFactoryKindForStructure(s) === 'infantry') count++;
    }
    return Math.max(1, count);
  }

  private aiProductionPowerFraction(house: House): number {
    const ctx = this._aiCtx;
    const consumed = _aiPowerConsumed(ctx, house);
    if (consumed <= 0) return 1;
    const produced = _aiPowerProduced(ctx, house);
    return produced >= consumed ? 1 : Math.max(0, produced / consumed);
  }

  private aiFactoryBuildTime(item: ProductionItem, house: House, kind: 'infantry' | 'unit'): number {
    const mods = AI_DIFFICULTY_MODS[this.difficulty] ?? AI_DIFFICULTY_MODS.normal;
    let time = Math.trunc(item.buildTime * mods.buildSpeedBias);

    // C++ TechnoClass::Time_To_Build power quantization (techno.cpp:677-682).
    let power = this.aiProductionPowerFraction(house);
    if (power > 1) power = 1;
    if (power < 1 && power > 0.75) power = 0.75;
    if (power < 0.5) power = 0.5;
    time = Math.trunc(time / power);

    if (kind === 'infantry') {
      time = Math.trunc(time / this.aiInfantryFactoryCount(house));
    }

    // C++ FactoryClass::Start build slowdown for computer houses
    // (factory.cpp:430-431), MaxIQ default=5.
    if (mods.isBuildSlowdown) {
      const iq = this.houseIQs.get(house) ?? 3;
      time = Math.trunc(time * 10 / (iq + 5));
    }

    return Math.max(1, time);
  }

  private aiFactoryRate(item: ProductionItem, house: House, kind: 'infantry' | 'unit'): number {
    const time = this.aiFactoryBuildTime(item, house, kind);
    const startPower = Math.max(1 / 16, Math.min(1, this.aiProductionPowerFraction(house)));
    const powerAdjusted = Math.trunc(time / startPower);
    return Math.max(1, Math.min(255, Math.trunc(powerAdjusted / AI_FACTORY_STEP_COUNT)));
  }

  private aiFactoryCost(item: ProductionItem, house: House): number {
    const mods = AI_DIFFICULTY_MODS[this.difficulty] ?? AI_DIFFICULTY_MODS.normal;
    return _getEffectiveCost(item, house, mods.costBias);
  }

  private aiSuggestedFactoryItem(s: MapStructure, kind: 'infantry' | 'unit'): ProductionItem | null {
    const state = this.aiStates.get(s.house);
    if (!state || !state.isStarted) return null;

    if (kind === 'infantry') {
      const type = state.buildInfantry;
      if (!type) return null;
      if (s.type === 'KENN' && type !== UnitType.I_DOG) return null;
      if (s.type !== 'KENN' && type === UnitType.I_DOG) return null;
      return this.scenarioProductionItems.find(item => item.type === type && !item.isStructure) ?? null;
    }

    if (kind === 'unit') {
      const type = state.buildUnit;
      if (!type) return null;
      const stats = UNIT_STATS[type];
      if (!stats || stats.isInfantry || stats.isVessel || stats.isAircraft) return null;
      return this.scenarioProductionItems.find(item => item.type === type && !item.isStructure) ?? null;
    }

    return null;
  }

  /** C++ BuildingClass::Factory_AI (building.cpp:5253-5382) for AI-owned
   *  factories. This starts completed HouseClass::Build* selections, handles
   *  completed product exit, and clears the Build* slot through the
   *  Production_Begun equivalent. */
  private updateAIBuildingFactory(s: MapStructure): void {
    if (s.house === this.playerHouse) return; // player production uses sidebar factories

    if (s.aiFactoryPlacementDelay && s.aiFactoryPlacementDelay > 0) {
      s.aiFactoryPlacementDelay--;
    }

    const kind = this.aiFactoryKindForStructure(s);
    if (!kind) return;

    const factory = s.aiFactory;
    const placementDelay = s.aiFactoryPlacementDelay ?? 0;
    if (factory && factory.stage >= AI_FACTORY_STEP_COUNT && !factory.suspended && placementDelay === 0) {
      factory.suspended = true;
    }
    if (factory && factory.stage >= AI_FACTORY_STEP_COUNT && placementDelay === 0) {
      const exitResult = this.exitAIFactoryProduct(s);
      if (exitResult === 2) {
        s.aiFactory = undefined;
      } else if (exitResult === 1) {
        s.aiFactoryPlacementDelay = AI_FACTORY_PLACEMENT_DELAY;
        return;
      } else {
        s.aiFactory = undefined;
      }
    } else if (factory && factory.suspended && factory.stage < AI_FACTORY_STEP_COUNT && placementDelay === 0) {
      // Mirrors the abort path for a valid but non-building factory
      // (building.cpp:5346-5349).
      const spent = Math.max(0, factory.cost - factory.balance);
      if (spent > 0) {
        this.houseCredits.set(s.house, (this.houseCredits.get(s.house) ?? 0) + spent);
      }
      s.aiFactory = undefined;
    }

    if (s.aiFactory !== undefined) return;
    if (s.mission === Mission.CONSTRUCTION || s.mission === Mission.DECONSTRUCTION) return;
    if ((this.houseCredits.get(s.house) ?? 0) <= 10) return;

    const item = this.aiSuggestedFactoryItem(s, kind);
    if (!item) return;

    const cost = this.aiFactoryCost(item, s.house);
    const rate = this.aiFactoryRate(item, s.house, kind);
    const costPerTick = Math.trunc(cost / AI_FACTORY_STEP_COUNT);
    if ((this.houseCredits.get(s.house) ?? 0) < costPerTick) return;

    s.aiFactory = {
      kind,
      productType: item.type,
      stage: 0,
      rate,
      timer: rate,
      balance: cost,
      cost,
      startedTick: this.tick,
      suspended: false,
    };

    const state = this.aiStates.get(s.house);
    if (state && kind === 'infantry' && state.buildInfantry === item.type) {
      state.buildInfantry = null;
    } else if (state && kind === 'unit' && state.buildUnit === item.type) {
      state.buildUnit = null;
    }
  }

  /** C++ FactoryClass::AI (factory.cpp:201-238). Runs after Map.Logic and
   *  before HouseClass::AI, not during BuildingClass::Factory_AI. */
  private updateAIFactories(): void {
    for (const s of this.structures) {
      const factory = s.aiFactory;
      if (!factory || factory.suspended || factory.stage >= AI_FACTORY_STEP_COUNT) continue;
      if (factory.startedTick === this.tick) continue;

      if (factory.timer > 0) factory.timer--;
      if (factory.timer > 0 || factory.rate === 0) continue;

      factory.stage++;
      factory.timer = factory.rate;

      const steps = AI_FACTORY_STEP_COUNT - factory.stage;
      const cost = Math.min(factory.balance, steps > 0 ? Math.trunc(factory.balance / steps) : factory.balance);
      const credits = this.houseCredits.get(s.house) ?? 0;
      if (cost > credits) {
        factory.stage--;
        continue;
      }

      this.houseCredits.set(s.house, credits - cost);
      factory.balance -= cost;

      if (factory.stage >= AI_FACTORY_STEP_COUNT) {
        const remaining = Math.min(factory.balance, this.houseCredits.get(s.house) ?? 0);
        if (remaining > 0) {
          this.houseCredits.set(s.house, (this.houseCredits.get(s.house) ?? 0) - remaining);
        }
        factory.balance = 0;
        factory.suspended = true;
        factory.rate = 0;
        factory.timer = 0;
      }
    }
  }

  private findInfantryFactoryExitCell(s: MapStructure, product: string): CellPos | null {
    const offsets = s.type === 'KENN'
      ? [{ cx: 0, cy: 1 }, ...EXIT_PYLE_OFFSETS]
      : EXIT_PYLE_OFFSETS;
    for (const off of offsets) {
      const cx = s.cx + off.cx;
      const cy = s.cy + off.cy;
      if (this.map.canEnterCell(
        cx,
        cy,
        false,
        id => {
          const e = this.entityById.get(id);
          return !!e?.isDriving;
        },
        true,
      ) !== MoveResult.OK) {
        continue;
      }
      if (!UNIT_STATS[product]?.isInfantry) continue;
      return { cx, cy };
    }
    return null;
  }

  private infantryFactoryExitLepton(s: MapStructure): LeptonPos {
    // C++ bdata.cpp exit coordinates, converted by XYP_COORD/Pixel_To_Lepton.
    if (s.type === 'TENT') {
      return { lx: s.cx * LEPTON_SIZE + pixelToLepton(24), ly: s.cy * LEPTON_SIZE + pixelToLepton(47) };
    }
    if (s.type === 'KENN') {
      return { lx: s.cx * LEPTON_SIZE + pixelToLepton(8), ly: s.cy * LEPTON_SIZE + pixelToLepton(16) };
    }
    return { lx: s.cx * LEPTON_SIZE + pixelToLepton(18), ly: s.cy * LEPTON_SIZE + pixelToLepton(47) };
  }

  private infantryScenarioInitClosestSpot(coord: LeptonPos): LeptonPos {
    // C++ InfantryClass::Unlimbo calls CellClass::Closest_Free_Spot(coord,
    // ScenarioInit). When ScenarioInit is true, occupancy is ignored but the
    // coordinate is still snapped to the nearest StoppingCoordAbs sub-cell.
    const spot = this.infantrySpotIndex(coord.lx, coord.ly);
    const off = SUBCELL_LEPTON_OFFSETS[spot] ?? SUBCELL_LEPTON_OFFSETS[0];
    return {
      lx: Math.floor(coord.lx / LEPTON_SIZE) * LEPTON_SIZE + off.lx,
      ly: Math.floor(coord.ly / LEPTON_SIZE) * LEPTON_SIZE + off.ly,
    };
  }

  /** C++ BuildingClass::Exit_Object infantry branch (building.cpp:2054-2087). */
  private exitAIInfantryFactoryProduct(s: MapStructure): 0 | 1 | 2 {
    const factory = s.aiFactory;
    if (!factory || factory.kind !== 'infantry') return 0;

    const exitCell = this.findInfantryFactoryExitCell(s, factory.productType);
    if (!exitCell) return 0;

    const start = this.infantryScenarioInitClosestSpot(this.infantryFactoryExitLepton(s));
    const entity = new Entity(factory.productType as UnitType, s.house, leptonToPixel(start.lx), leptonToPixel(start.ly));
    entity.leptonX = start.lx;
    entity.leptonY = start.ly;
    entity.syncPosFromLeptons();
    entity.prevPos = { x: entity.pos.x, y: entity.pos.y };
    entity.scenarioInitUnlimbo = true;
    entity.unlimboTick = this.tick;
    // C++ TechnoClass::Unlimbo calls Enter_Idle_Mode(true) + Commence before
    // BuildingClass::Exit_Object assigns the produced unit's MOVE order.
    entity.mission = this.idleMission(entity);
    entity.missionQueue = Mission.MOVE;
    entity.missionTimer = 0;
    entity.moveTarget = cellTargetToLepton(exitCell.cx, exitCell.cy);
    entity.path = [];
    entity.pathIndex = 0;
    entity.pathDelay = 0;
    entity.isDriving = false;
    // C++ BuildingClass::Exit_Object establishes radio contact with produced
    // infantry via RADIO_HELLO/RADIO_UNLOAD. InfantryClass::Per_Cell_Process
    // cuts this tether on the first reached cell and starts DO_GESTURE1/2.
    entity.isTethered = true;

    const dir = directionToLeptons256(start.lx, start.ly, entity.moveTarget.lx, entity.moveTarget.ly);
    entity.bodyFacing256 = dir;
    entity.facing = dir256ToFacing8(dir);
    entity.desiredFacing = entity.facing;
    entity.bodyFacing32 = dir256ToFacing32(dir);

    const spot = this.infantrySpotIndex(entity.leptonX, entity.leptonY);
    const cellIdx = entity.cell.cy * MAP_CELLS + entity.cell.cx;
    entity.subCell = spot;
    if (this.map.occupyClaimedSubCell(cellIdx, entity.id, spot)) {
      entity.claimedCellIdx = cellIdx;
      entity.claimedSubCell = spot;
    }

    const iq = this.houseIQs.get(s.house) ?? 3;
    // C++ Exit_Object calls Assign_Mission(GUARD_AREA) after queueing MOVE
    // when IQGuardArea is met. Assign_Mission is a no-op if the current idle
    // mission is already GUARD_AREA, preserving the queued MOVE for armed AI
    // infantry/dogs; otherwise it overwrites the queue just like C++.
    if (iq >= 4 && entity.mission !== Mission.AREA_GUARD) {
      entity.missionQueue = Mission.AREA_GUARD;
    }

    entity.logicIndexHint = this.logicIndexHintForNewObject();
    this.entities.push(entity);
    this.entityById.set(entity.id, entity);
    this.markDiscoveredIfPlayerVisible(entity);
    return 2;
  }

  /** C++ BuildingClass::Exit_Object WEAP branch (building.cpp:2024-2047).
   *  The product is unlimboed at the war-factory exit coordinate under
   *  ScenarioInit, which calls TechnoClass::Enter_Idle_Mode(true)+Commence().
   *  For harvesters that means the same-tick Logic pass runs MISSION_HARVEST,
   *  matching the C++ SCG11EA tick-1245 HARV creation path. */
  private exitAIUnitFactoryProduct(s: MapStructure): 0 | 1 | 2 {
    const factory = s.aiFactory;
    if (!factory || factory.kind !== 'unit') return 0;
    if (s.type !== 'WEAP') return 0;

    const unitType = factory.productType as UnitType;
    const stats = UNIT_STATS[unitType];
    if (!stats || stats.isInfantry || stats.isVessel || stats.isAircraft) return 0;

    // bdata.cpp ClassWeapon Exit_Coord:
    // XY_Coord(CELL_LEPTON_W + CELL_LEPTON_W/2, CELL_LEPTON_H).
    const lx = s.cx * LEPTON_SIZE + Math.trunc(LEPTON_SIZE * 3 / 2);
    const ly = s.cy * LEPTON_SIZE + LEPTON_SIZE;
    const entity = new Entity(unitType, s.house, leptonToPixel(lx), leptonToPixel(ly));
    entity.leptonX = lx;
    entity.leptonY = ly;
    entity.syncPosFromLeptons();
    entity.prevPos = { x: entity.pos.x, y: entity.pos.y };
    entity.scenarioInitUnlimbo = true;
    entity.unlimboTick = this.tick;
    entity.bodyFacing256 = 128; // DIR_S
    entity.facing = dir256ToFacing8(entity.bodyFacing256);
    entity.desiredFacing = entity.facing;
    entity.bodyFacing32 = dir256ToFacing32(entity.bodyFacing256);
    entity.desiredFacing256 = entity.bodyFacing256;
    entity.isDriving = false;
    entity.path = [];
    entity.pathIndex = 0;
    entity.pathDelay = 0;
    entity.moveTarget = null;
    entity.isTethered = true;

    if (unitType === UnitType.V_HARV) {
      entity.mission = Mission.HARVEST;
      entity.missionQueue = null;
      entity.harvesterState = 'idle';
    } else {
      entity.mission = this.idleMission(entity);
      entity.missionQueue = null;
    }
    entity.missionTimer = 0;

    entity.logicIndexHint = this.logicIndexHintForNewObject();
    this.map.setVehicleOccupancy(entity.cell.cx, entity.cell.cy, entity.id);
    this.entities.push(entity);
    this.entityById.set(entity.id, entity);
    s.aiFactoryContactEntityId = entity.id;
    s.weapUnloadStatus = 0;
    s.mission = Mission.UNLOAD;
    s.missionTimer = 0;
    s.doorFrame = 0;
    s.weapDoorState = 0;
    s.weapDoorStage = 0;
    s.weapDoorTimer = 0;
    this.markDiscoveredIfPlayerVisible(entity);
    return 2;
  }

  private exitAIFactoryProduct(s: MapStructure): 0 | 1 | 2 {
    const factory = s.aiFactory;
    if (!factory) return 0;
    switch (factory.kind) {
      case 'infantry':
        return this.exitAIInfantryFactoryProduct(s);
      case 'unit':
        return this.exitAIUnitFactoryProduct(s);
      default:
        return 0;
    }
  }

  /** Find nearest passable cell near a structure's exit, expanding in rings up to 3 cells out.
   *  Returns the nudged position, or the original if already passable or no passable cell found. */
  private findPassableSpawn(initialCX: number, initialCY: number, structCX: number, structCY: number, fw: number, fh: number): { cx: number; cy: number } {
    if (this.map.isPassable(initialCX, initialCY)) return { cx: initialCX, cy: initialCY };
    const centerX = structCX + Math.floor(fw / 2);
    const baseY = structCY + fh;
    for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = centerX + dx;
          const ny = baseY + dy;
          if (this.map.isPassable(nx, ny)) return { cx: nx, cy: ny };
        }
      }
    }
    return { cx: initialCX, cy: initialCY };
  }

  /** Spawn an AI unit from a factory — delegates to ai.ts */
  private spawnAIUnit(
    house: House,
    unitType: UnitType,
    factoryType: string,
    mission: Mission = Mission.GUARD,
    guardOrigin?: WorldPos,
  ): Entity | null {
    return _spawnAIUnit(this._aiCtx, house, unitType, factoryType, mission, guardOrigin);
  }

  /** Spawn a produced unit at its factory */
  private spawnProducedUnit(item: ProductionItem): void {
    this._runProduction(ctx => _spawnProducedUnit(ctx, item));
  }

  /** Place a completed structure on the map */
  placeStructure(cx: number, cy: number): boolean {
    return this._runPlacement(ctx => _placeStructure(ctx, cx, cy));
  }

  /** Deploy MCV at its current location → FACT structure */
  deployMCV(entity: Entity): boolean {
    return this._runPlacement(ctx => _deployMCV(ctx, entity));
  }

  private spawnCrate(): void {
    this._runCrate(ctx => _spawnCrate(ctx));
  }

  /** Apply crate bonus to the unit that picked it up */
  private pickupCrate(crate: Crate, unit: Entity): void {
    this._runCrate(ctx => _pickupCrate(ctx, crate, unit));
  }

  // ─── Superweapon System ─────────────────────────────────

  /** Scan structures for superweapon buildings, update charge, auto-fire GPS/Sonar */
  updateSuperweapons(): void {
    this._runSuperweapon(ctx => _updateSuperweapons(ctx));
  }

  /** Activate a superweapon at a target position */
  activateSuperweapon(type: SuperweaponType, house: House, target: WorldPos): void {
    this._runSuperweapon(ctx => _activateSuperweapon(ctx, type, house, target));
  }

  /** Detonate nuclear warhead at target position */
  private detonateNuke(target: WorldPos): void {
    this._runSuperweapon(ctx => _detonateNuke(ctx, target));
  }

  /** Find the best nuke target for an AI house — cluster of player structures */
  private findBestNukeTarget(aiHouse: House): WorldPos | null {
    return _findBestNukeTarget(this._superweaponCtx, aiHouse);
  }

  /** Push an EVA message */
  private pushEva(text: string): void {
    this.evaMessages.push({ text, tick: this.tick });
  }

  /** Render mission name overlay that fades in during first few seconds */
  private renderMissionNameOverlay(): void {
    const ctx = this.canvas.getContext('2d')!;
    const w = this.canvas.width - Game.SIDEBAR_W;
    const alpha = this.tick < 30 ? 1.0 : 1.0 - (this.tick - 30) / 30;
    if (alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Semi-transparent banner background
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 7 * RESFACTOR, w, 14 * RESFACTOR);

    // Mission name
    ctx.textAlign = 'center';
    ctx.font = `bold ${7 * RESFACTOR}px monospace`;
    ctx.fillStyle = '#FFD700';
    ctx.fillText(this.missionName.toUpperCase(), w / 2, 17 * RESFACTOR);
    ctx.textAlign = 'left';

    ctx.restore();
  }

  /** Render the current frame */
  private render(): void {
    this.renderer.attackMoveMode = this.attackMoveMode;
    this.renderer.sellMode = this.sellMode;
    this.renderer.repairMode = this.repairMode;
    this.renderer.repairingStructures = this.repairingStructures;
    this.renderer.corpses = this.corpses;
    // Sidebar data
    this.renderer.sidebarCredits = Math.floor(this.displayCredits);
    this.renderer.sidebarSiloCapacity = this.siloCapacity;
    this.renderer.sidebarPowerProduced = this.powerProduced;
    this.renderer.sidebarPowerConsumed = this.powerConsumed;
    this.renderer.sidebarItems = this.cachedAvailableItems ?? this.getAvailableItems();
    this.renderer.sidebarQueue = this.productionQueue;
    this.renderer.sidebarW = Game.SIDEBAR_W;
    this.renderer.leftStripScroll = this.stripScrollPositions.left;
    this.renderer.rightStripScroll = this.stripScrollPositions.right;
    // Power bar bounce animation (C++ PowerClass::AI — runs each tick)
    this.renderer.updatePowerAnimation();
    // Radar requires DOME and sufficient power
    // C++ house.cpp:4160-4170: Power_Fraction() returns 0 when powerProduced=0 and drain>0
    const hasPower = this.powerConsumed === 0 || this.powerProduced >= this.powerConsumed;
    this.renderer.doesRadarExist = this.hasBuilding('DOME');
    this.renderer.hasRadar = this.renderer.doesRadarExist && hasPower;
    // U6: Pass fullscreen radar state to renderer
    this.renderer.isRadarFullscreen = this.isRadarFullscreen;
    this.renderer.crates = this.crates;
    // Selected structure info for info panel + highlight
    this.renderer.selectedStructureIdx = this.selectedStructureIdx;
    if (this.selectedStructureIdx >= 0 && this.selectedIds.size === 0) {
      const ss = this.structures[this.selectedStructureIdx];
      if (ss?.alive) {
        const prodItem = this.scenarioProductionItems.find(p => p.type === ss.type);
        this.renderer.selectedStructure = {
          type: ss.type, hp: ss.hp, maxHp: ss.maxHp,
          name: prodItem?.name ?? ss.type,
        };
      } else {
        this.renderer.selectedStructure = null;
        this.selectedStructureIdx = -1;
      }
    } else {
      this.renderer.selectedStructure = null;
    }
    this.renderer.evaMessages = this.evaMessages;
    // Superweapon data for sidebar buttons
    this.renderer.superweapons = this.superweapons;
    this.renderer.superweaponCursorMode = this.superweaponCursorMode;
    this.renderer.chronoTankTargeting = this.chronoTankTargeting !== null;
    this.renderer.missionTimer = this.missionTimer;
    this.renderer.theatre = this.theatre;
    this.renderer.difficulty = this.difficulty;
    // Placement ghost
    if (this.pendingPlacement) {
      const { mouseX, mouseY } = this.input.state;
      const world = this.camera.screenToWorld(mouseX, mouseY);
      this.renderer.placementItem = this.pendingPlacement;
      this.renderer.placementCx = Math.floor(world.x / CELL_SIZE);
      this.renderer.placementCy = Math.floor(world.y / CELL_SIZE);
      // Validate placement using actual footprint (per-cell)
      const cx = this.renderer.placementCx;
      const cy = this.renderer.placementCy;
      const [pfw, pfh] = STRUCTURE_SIZE[this.pendingPlacement.type] ?? [2, 2];
      let valid = true;
      const cells: boolean[] = [];
      // C++ cell.cpp: Is_Clear_To_Build uses buildable terrain, not passable
      for (let dy = 0; dy < pfh; dy++) {
        for (let dx = 0; dx < pfw; dx++) {
          const buildable = this.map.isBuildable(cx + dx, cy + dy);
          cells.push(buildable);
          if (!buildable) valid = false;
        }
      }
      // C++ bdata.cpp:3448-3477: Occupy_List(placement=true) includes bib cells in preview
      const bibCells = getBibCells(this.pendingPlacement.type, cx, cy);
      for (const bc of bibCells) {
        const bibBuildable = this.map.isBuildable(bc.cx, bc.cy);
        cells.push(bibBuildable);
        if (!bibBuildable) valid = false;
      }
      // C++ display.cpp:749-775: two-ring proximity scan (2-cell expansion)
      let adj = false;
      for (const s of this.structures) {
        if (!s.alive || !this.isAllied(s.house, this.playerHouse)) continue;
        const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
        const exL = s.cx - 2, exT = s.cy - 2, exR = s.cx + sw + 2, exB = s.cy + sh + 2;
        const nL = cx, nT = cy, nR = cx + pfw, nB = cy + pfh;
        if (nL < exR && nR > exL && nT < exB && nB > exT) { adj = true; break; }
      }
      // C++ cell.cpp:1126: proximity gates per-cell color — when proximity fails, ALL cells red
      if (!adj) {
        for (let i = 0; i < cells.length; i++) cells[i] = false;
      }
      this.renderer.placementValid = valid && adj;
      this.renderer.placementCells = cells;
    } else {
      this.renderer.placementItem = null;
      this.renderer.placementCells = null;
    }
    this.renderer.cursorType = this.cursorType;
    this.renderer.cursorX = this.input.state.mouseX;
    this.renderer.cursorY = this.input.state.mouseY;
    this.renderer.render(
      this.camera,
      this.map,
      this.entities,
      this.structures,
      this.assets,
      this.input.state,
      this.selectedIds,
      this.effects,
      this.tick,
    );

    // Render EVA messages, mission timer, music track, and mission name overlay
    this.renderer.musicTrack = this.audio.music.currentTrack;
    this.renderer.gameSpeed = this.gameSpeed;
    // C++ parity: top status bar (OPTIONS | TIME | CREDITS) — TabClass::Draw_It
    this.renderer.renderTopBar(this.tick);
    this.renderer.renderEvaMessages(this.tick);
    this.renderer.renderMusicTrack(this.tick);
    this.renderer.renderGameSpeed();
    this.renderer.missionName = this.missionName;
    // Mission name overlay fades during first 4 seconds (60 ticks)
    if (this.tick < 60) {
      this.renderMissionNameOverlay();
    }

    // Render pause overlay
    if (this.state === 'paused') {
      this.renderer.renderPauseOverlay();
    }

    // Render end screen overlay when game is over
    if (this.state === 'won' || this.state === 'lost') {
      const survivingUnits = this.entities.filter(e =>
        e.alive && this.isAllied(e.house, this.playerHouse)).length;
      const isSovietPlayer = this.playerFaction === 'soviet';
      const enemyCasualties = isSovietPlayer
        ? (this.alliedUnitsLost + this.alliedBuildingsLost)
        : (this.sovietUnitsLost + this.sovietBuildingsLost);
      const survivors = this.state === 'won'
        ? this.entities.filter(e => e.alive && e.isPlayerUnit).map(e => ({
            type: e.type, name: e.stats.name, hp: e.hp, maxHp: e.maxHp, kills: e.kills,
          }))
        : [];
      this.renderer.renderEndScreen(
        this.state === 'won',
        this.tick,
        this.pointTotal,
        survivingUnits,
        enemyCasualties,
        this.credits,
        this.stolenCredits,
        this.harvestedCredits,
        this.initialCredits,
        this.alliedUnitsLost,
        this.sovietUnitsLost,
        this.alliedBuildingsLost,
        this.sovietBuildingsLost,
        this.playerFaction === 'soviet' ? 'soviet' : 'allied',
        survivors,
      );
    }

    // Fire onPostRender callback (used by QA screenshot capture)
    this.onPostRender?.();
  }

  /** U3: Calculate formation positions for a group move order.
   *  C++ foot.h:139-175 XFormOffset/YFormOffset — stable offsets from leader position.
   *  Also stores formationOffset on each unit for maintaining relative positions. */
  private calculateFormation(centerX: number, centerY: number, count: number, units?: Entity[]): WorldPos[] {
    if (count <= 1) {
      if (units?.[0]) units[0].formationOffset = { x: 0, y: 0 };
      return [{ x: centerX, y: centerY }];
    }
    const cols = Math.ceil(Math.sqrt(count));
    const positions: WorldPos[] = [];
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      // Center the grid on the target point — stable offsets (no jitter)
      const offsetX = (col - (cols - 1) / 2) * CELL_SIZE;
      const offsetY = (row - Math.floor((count - 1) / cols) / 2) * CELL_SIZE;
      positions.push({
        x: centerX + offsetX,
        y: centerY + offsetY,
      });
      // Store formation offset on entity for maintaining relative position
      if (units?.[i]) {
        units[i].formationOffset = { x: offsetX, y: offsetY };
      }
    }
    return positions;
  }

  private getTeamFormationMembers(entity: Entity): Entity[] {
    if (entity.teamMissions.length === 0) {
      return [entity];
    }

    const members = this.entities
      .filter((other) => other.alive && other.teamMissions === entity.teamMissions)
      .sort((a, b) => a.id - b.id);

    return members.length > 0 ? members : [entity];
  }

  private calculateTeamMissionFormationOffsets(count: number, formation: number): Array<WorldPos | null> {
    if (count <= 0) {
      return [];
    }

    if (formation === 0) {
      return Array.from({ length: count }, () => null);
    }

    if (formation === 1) {
      return Array.from({ length: count }, () => ({ x: 0, y: 0 }));
    }

    const offsets: WorldPos[] = [];
    let xdir = 0;
    let ydir = 0;
    let evenOdd = true;
    const pushOffset = (x: number, y: number): void => {
      offsets.push({ x: x * CELL_SIZE, y: y * CELL_SIZE });
    };

    switch (formation) {
      case 2:
        // C++ FORMATION_LOOSE (foot.cpp) — empty break, no offsets assigned.
        // Returns empty array (no-op), matching C++ team.cpp:2515-2516.
        break;
      case 3:
        ydir = -Math.floor(count / 2);
        while (offsets.length < count) {
          pushOffset(xdir, ydir);
          xdir = -xdir;
          evenOdd = !evenOdd;
          if (!evenOdd) {
            xdir -= 2;
            ydir += 2;
          }
        }
        break;
      case 4:
        xdir = Math.floor(count / 2);
        while (offsets.length < count) {
          pushOffset(xdir, ydir);
          ydir = -ydir;
          evenOdd = !evenOdd;
          if (!evenOdd) {
            xdir -= 2;
            ydir -= 2;
          }
        }
        break;
      case 5:
        ydir = Math.floor(count / 2);
        while (offsets.length < count) {
          pushOffset(xdir, ydir);
          xdir = -xdir;
          evenOdd = !evenOdd;
          if (!evenOdd) {
            xdir -= 2;
            ydir -= 2;
          }
        }
        break;
      case 6:
        xdir = -Math.floor(count / 2);
        while (offsets.length < count) {
          pushOffset(xdir, ydir);
          ydir = -ydir;
          evenOdd = !evenOdd;
          if (!evenOdd) {
            xdir += 2;
            ydir -= 2;
          }
        }
        break;
      case 7:
        ydir = -Math.floor(count / 2);
        while (offsets.length < count) {
          pushOffset(0, ydir);
          ydir += 2;
        }
        break;
      case 8:
        xdir = -Math.floor(count / 2);
        while (offsets.length < count) {
          pushOffset(xdir, 0);
          xdir += 2;
        }
        break;
      default:
        return Array.from({ length: count }, () => ({ x: 0, y: 0 }));
    }

    return offsets;
  }

  private teamMissionWaypointTarget(entity: Entity, wp: { cx: number; cy: number }): LeptonPos {
    const offset = entity.formationOffset ?? { x: 0, y: 0 };
    const base = cellTargetToLepton(wp.cx, wp.cy);
    return {
      // C++ TeamClass stores waypoint targets as ::As_Target(CELL), and
      // As_Coord(Target) returns cell*256+0x88 rather than visual center.
      lx: base.lx + pixelToLepton(offset.x),
      ly: base.ly + pixelToLepton(offset.y),
    };
  }


  // === Full AI — Strategic Opponent (delegates to ai.ts) ===

  /** Create initial AIHouseState for a house, applying difficulty modifiers */
  private createAIHouseState(house: House): AIHouseState {
    return _createAIHouseState(this._aiCtx, house);
  }

  /** C++ house.cpp:936-940: IQ-based auto-enable for base building/production/autocreate */
  private updateAIIQGates(): void {
    this._runAI(ctx => _updateAIIQGates(ctx));
  }

  /** AI strategic planner — phase transitions every 150 ticks (~10s) */
  private updateAIStrategicPlanner(): void {
    this._runAI(ctx => _updateAIStrategicPlanner(ctx));
  }

  /** Update AI harvester counts and force-produce if needed */
  private updateAIHarvesters(): void {
    this._runAI(ctx => _updateAIHarvesters(ctx));
  }

  /** AI attack group management — accumulate pool and launch coordinated attacks */
  private updateAIAttackGroups(): void {
    this._runAI(ctx => _updateAIAttackGroups(ctx));
  }

  /** AI defense — detect base attacks and rally defenders */
  private updateAIDefense(): void {
    this._runAI(ctx => _updateAIDefense(ctx));
  }

  /** AI retreat — damaged units fall back to repair depot or base */
  /** AI auto-repair — IQ >= 3 houses repair damaged structures using their own credits */
  private updateAIRepair(): void {
    this._runAI(ctx => _updateAIRepair(ctx));
  }

  /** C++ BuildingClass::Repair_AI per-building tick (building.cpp:5484-5536).
   *  For AI houses: if the building is damaged and meets trigger conditions
   *  (IsToRepair || IsCaptured, enough money, !DidRepair, !IsRepairing), fire one
   *  Random_Pick to seed the house's RepairTimer. The RNG consumption is what keeps
   *  the seed stream aligned with WASM — actual HP restoration still uses TS's
   *  updateAIRepair cadence. */
  private _repairAITick(s: MapStructure): void {
    // C++ building.cpp:5495 outer condition: House->IQ >= Rule.IQRepairSell
    // (player-allied houses in single-player don't fire Repair_AI).
    if (this.isAllied(s.house, this.playerHouse)) return;
    const state = this.aiStates.get(s.house);
    if (!state || state.iq < 1) return;
    // Skip buildings mid-construction / mid-sell (Mission == CONSTRUCTION/DECONSTRUCTION).
    if (isStructureUnderConstruction(s) || s.sellProgress !== undefined) return;
    // Can_Repair(): must be damaged. (techno.cpp:3583)
    if (s.hp >= s.maxHp) return;
    // Rule.RepairThreshhold guard.
    const credits = this.houseCredits.get(s.house) ?? 0;
    const REPAIR_THRESHHOLD = 1000;
    if (credits < REPAIR_THRESHHOLD) return;
    // Once any building in this house has fired Repair_AI this cycle, others skip.
    if (state.didRepair) return;
    // Already repairing: don't re-seed the timer.
    if (s.isRepairing) return;
    // The inner gate: IsCaptured || IsToRepair || IsHuman || multiplayer.
    // For AI in single-player campaigns, only IsToRepair (or IsCaptured) qualifies.
    if (!s.isToRepair) return;

    // Mark this house as having initiated a repair this cycle.
    state.didRepair = true;
    s.isRepairing = true;

    // C++ building.cpp:5514:
    //   House->RepairTimer = Random_Pick((int)(House->RepairDelay * (TICKS_PER_MINUTE/4)),
    //                                    (int)(House->RepairDelay * TICKS_PER_MINUTE * 2));
    // C++ * is left-to-right associative: `RepairDelay * TICKS_PER_MINUTE * 2` evaluates as
    //   (RepairDelay * TICKS_PER_MINUTE) * 2 = (fixed * int) * int = int * int.
    // The intermediate fixed*int truncates/rounds BEFORE the ×2, so it is NOT equivalent to
    // RepairDelay * 1800. For default RepairDelay=0.02 (raw=5, TICKS_PER_MINUTE=900):
    //   intermediate = (5*900 + 128) / 256 = 4628 / 256 = 18
    //   hi = 18 * 2 = 36
    //   lo = (5*225 + 128) / 256 = 1253 / 256 = 4
    //   Random_Pick(4, 36). magnitude = 32 (NOT 31 — matters for rejection sampling).
    // Using the short formula (raw*1800+128)/256 would give hi=35 → magnitude=31, leading to
    // 1-RNG draws when WASM needs up to 4-RNG rejection-sampled draws. Must preserve the
    // intermediate truncation to match WASM exactly.
    const rawDelay = Math.round(state.repairDelay * 256); // fixed 8.8 raw
    const lo = Math.floor((rawDelay * 225 + 128) / 256);
    const hiInner = Math.floor((rawDelay * 900 + 128) / 256);
    const hi = hiInner * 2;
    state.repairTimer = ScenarioRandom.nextInRange(lo, hi);
    state.repairTimerSetTick = this.tick;
  }

  /** AI auto-sell — IQ >= 3 houses sell near-death structures for partial refund */
  private updateAISellDamaged(): void {
    this._runAI(ctx => _updateAISellDamaged(ctx));
  }

  /** AI passive income — AI houses earn credits from refineries */
  private updateAIIncome(): void {
    this._runAI(ctx => _updateAIIncome(ctx));
  }

  /** AI army building — AI houses produce units when they have credits and barracks/factory */
  private updateAIProduction(): void {
    this._runAI(ctx => _updateAIProduction(ctx));
  }

  /** AI autocreate teams — periodically assemble and deploy teams from autocreate-flagged TeamTypes */
  private updateAIAutocreateTeams(): void {
    this._runAI(ctx => _updateAIAutocreateTeams(ctx));
  }

// === Spy Mechanics (Gap #4) ===

  /** Spy disguise — spy adopts enemy house appearance */
  private spyDisguise(spy: Entity, _target: Entity): void {
    if (spy.type !== UnitType.I_SPY) return;
    // Spy takes on the target's house color (disguise)
    spy.disguisedAs = _target.house;
  }

  /** Spy infiltration — spy enters enemy building for special effects */
  private spyInfiltrate(spy: Entity, structure: MapStructure): void {
    // C++ infantry.cpp:645-706 — spy infiltration handler
    // Guard: must be a living spy targeting an enemy building
    if (spy.type !== UnitType.I_SPY || !spy.alive) return;

    const targetHouse = structure.house;
    if (this.isAllied(targetHouse, this.playerHouse)) return;

    // C++ infantry.cpp:646: housespy = (1 << (House->Class->House))
    // We use the House enum string, so store as a Set-based approach via spiedHouses.
    // But also maintain the per-building SpiedBy bitmask for strict C++ parity.

    // Step 1: Fire TEVENT_SPIED trigger (C++ infantry.cpp:649-651)
    // This happens BEFORE any building-type-specific effects.
    if (structure.triggerName) this.spiedBuildingTriggers.add(structure.triggerName);

    // Step 2: VOX_BUILDING_INFILTRATED (C++ infantry.cpp:653)
    this.evaMessages.push({ text: 'BUILDING INFILTRATED', tick: this.tick });

    // Step 3: Set SpiedBy on the building — ALL buildings unconditionally
    // C++ infantry.cpp:656: tech->SpiedBy |= housespy
    structure.spiedBy = (structure.spiedBy ?? 0) | 1;
    // Also track at the house level for downstream display effects
    // (C++ SpiedBy on any factory shows cameo overlay, refinery/silo shows credits,
    //  power plants show power pips)
    this.spiedHouses.add(targetHouse);

    // Step 4: Building-type-specific effects — C++ only has TWO special cases
    if (structure.type === 'DOME') {
      // C++ infantry.cpp:660-662: if (build == STRUCT_RADAR)
      //   tech->House->RadarSpied |= housespy
      // This shares the enemy's explored radar cells (fog-of-war sharing),
      // NOT a full map reveal. No fogDisabled, no timer.
      this.radarSpiedHouses.add(targetHouse);
    } else if (structure.type === 'SPEN') {
      // C++ infantry.cpp:664-670: if (build == STRUCT_SUB_PEN)
      //   House->SuperWeapon[SPC_SONAR_PULSE].Enable(false, true, false)
      // Grants sonar pulse superweapon to spy's house (NOT target house).
      // C++ rules.cpp:210 SonarTime(14) => recharge = 900 * 14 = 12600 ticks
      const spyHouse = spy.house;
      this.sonarSpiedTarget.set(spyHouse, targetHouse);
      const sonarKey = `${spyHouse}:${SuperweaponType.SONAR_PULSE}`;
      let sonarState = this.superweapons.get(sonarKey);
      if (!sonarState) {
        sonarState = {
          type: SuperweaponType.SONAR_PULSE,
          house: spyHouse,
          chargeTick: 0,
          ready: true,
          structureIndex: -1,
          fired: false,
        };
        this.superweapons.set(sonarKey, sonarState);
      } else {
        sonarState.ready = true;
        sonarState.chargeTick = SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks;
      }
    }
    // No other building types have special spy effects in C++.
    // PROC/SILO: no credit theft (that's THIEF in infantry.cpp:675-701)
    // POWR/APWR: no power sabotage
    // WEAP/BARR/TENT: no production reset or reveal beyond SpiedBy
    // ATEK/STEK: no GPS satellite or tech reveal
    // SYRD: no sonar (only SPEN)

    // Step 5: Spy is consumed on infiltration (C++ infantry.cpp:706: delete this)
    // Clear trigger name before death so TEVENT_DESTROYED doesn't
    // fire for the spy. Without this, the spy's death triggers a loss condition
    // (los3) before the infiltration trigger chain (SPYS->frc5->Tanya) completes.
    spy.triggerName = undefined;
    spy.alive = false;
    spy.mission = Mission.DIE;
    spy.disguisedAs = null;
    this.audio.play('eva_acknowledged');
  }

  // === Agent 9: New Units & Special Abilities ===

  /** Agent 9: Tanya C4 placement — delegates to specialUnits.ts */
  updateTanyaC4(entity: Entity): void {
    this._runSpecialUnits(ctx => _updateTanyaC4(ctx, entity));
  }

  /** C++ weapon.ini Charges=yes currently applies to Tesla coils. */
  private isElectricStructureWeapon(s: MapStructure): boolean {
    return s.type === 'TSLA';
  }

  /** C++ BuildingClass::Animation_AI stage advance for Tesla charge animation.
   *  Charging_AI sets Set_Rate(3), and the stage is tested against 9 on the
   *  later Charging_AI pass. This helper represents that pre-mission
   *  Animation_AI step without affecting unrelated building animations. */
  private tickStructureChargingAnimation(s: MapStructure): void {
    if (!this.isElectricStructureWeapon(s) || !s.isCharging || s.isCharged) return;
    s.chargeRateCounter = (s.chargeRateCounter ?? 0) + 1;
    if (s.chargeRateCounter >= 3) {
      s.chargeRateCounter = 0;
      s.chargeStage = (s.chargeStage ?? 0) + 1;
    }
  }

  /** C++ BuildingClass::Charging_AI (building.cpp:5435-5465).
   *  TeslaZap has Charges=yes. Mission_Attack may select a target, but
   *  BuildingClass::Can_Fire returns FIRE_BUSY until IsCharged becomes true
   *  after the charge animation reaches stage 9. */
  private updateStructureChargingAI(s: MapStructure, combatCtx: CombatContext, isLowPower: boolean): void {
    if (!this.isElectricStructureWeapon(s)) return;

    const assignedTarget = s.targetEntityId !== undefined
      ? this.entityById.get(s.targetEntityId)
      : undefined;
    const hasTarget = !!(assignedTarget && assignedTarget.alive && !assignedTarget.inLimbo);
    if (hasTarget && !isLowPower) {
      if (!s.isCharged) {
        if (s.isCharging) {
          if ((s.chargeStage ?? 0) >= 9) {
            s.isCharged = true;
            s.isCharging = false;
            s.chargeRateCounter = 0;
          }
        } else if ((s.attackCooldown ?? 0) <= 0) {
          s.isCharged = false;
          s.isCharging = true;
          s.chargeStage = 0;
          s.chargeRateCounter = 0;
        }
      }
    } else if (s.isCharging || s.isCharged) {
      s.isCharging = false;
      s.isCharged = false;
      s.chargeStage = 0;
      s.chargeRateCounter = 0;
    }
  }

  /** C++ TechnoClass::AI target maintenance for non-aircraft TarCom.
   *  BuildingClass::Greatest_Threat acquires aircraft with the object-center
   *  range check, then TechnoClass::AI immediately rechecks TarCom through the
   *  TARGET overload, which uses ObjectClass::Target_Coord and subtracts
   *  object Height. */
  private structureTargetInTarcomRange(s: MapStructure, target: Entity): boolean {
    if (!s.weapon) return false;
    const fire = _structureFireLeptons(s, target);
    const targetCoord = _entityTargetLeptons(target);
    return leptonDist(fire.lx, fire.ly, targetCoord.lx, targetCoord.ly) <= Math.trunc(s.weapon.range * LEPTON_SIZE);
  }

  /** C++ TechnoClass::AI TarCom maintenance.
   *  This runs every building AI tick after MissionClass::AI, even when the
   *  mission timer did not fire. It only clears TarCom; it does not change the
   *  current mission or retarget the turret toward TARGET_NONE. */
  private maintainStructureTarcom(s: MapStructure): void {
    if (!s.weapon || s.targetEntityId === undefined) return;
    const target = this.entityById.get(s.targetEntityId);
    if (!target || !target.alive || target.inLimbo) {
      s.targetEntityId = undefined;
      return;
    }
    if (!this.structureTargetInTarcomRange(s, target)) {
      s.targetEntityId = undefined;
    }
  }

  /** C++ BuildingClass::Mission_Repair for STRUCT_AIRSTRIP/STRUCT_HELIPAD.
   *
   *  Pad rearming is a building mission, so an occupied AFLD/HPAD must not fall
   *  through to non-weapon Mission_Guard jitter while the docked aircraft is
   *  being serviced. The aircraft subsystem still owns the ammo increment
   *  counter; this mission mirrors that timer onto the building and keeps the
   *  building on the C++ REPAIR path until service ends.
   */
  private updateAircraftPadRepairMission(s: MapStructure): boolean {
    const docked = s.dockedAircraft !== undefined
      ? this.entityById.get(s.dockedAircraft)
      : undefined;

    if (!docked || !docked.alive || docked.inLimbo || docked.stats.landingBuilding !== s.type) {
      s.dockedAircraft = undefined;
      s.repairMissionStatus = 0;
      s.mission = Mission.GUARD;
      s.missionTimer = 1;
      return false;
    }

    const needsRearm = docked.maxAmmo > 0 && docked.ammo < docked.maxAmmo;
    if (!needsRearm || docked.aircraftState !== 'rearming') {
      if (docked.flightAltitude <= 0) {
        docked.aircraftState = 'landed';
        docked.mission = Mission.GUARD;
        docked.missionQueue = null;
      }
      s.repairMissionStatus = 0;
      s.mission = Mission.GUARD;
      s.missionTimer = 1;
      return false;
    }

    docked.mission = Mission.SLEEP;
    docked.missionQueue = null;
    s.repairMissionStatus = 1;
    s.mission = Mission.REPAIR;
    s.missionTimer = Math.max(
      1,
      docked.rearmTimer || _computeRearmDelay(this._housePowerFraction(s.house)),
    );
    return false;
  }

  /** C++ MissionClass::AI for buildings.
   *
   *  Weapon buildings do not roll Guard jitter when a target is found. Instead,
   *  BuildingClass::Mission_Guard assigns MISSION_ATTACK, Commence() resets the
   *  mission timer/status, and the handler returns 1 (building.cpp:3273-3295).
   *  Actual firing happens later from Mission_Attack when this returns true.
   */
  private dispatchStructureMissionTimer(
    s: MapStructure,
    combatCtx: CombatContext,
    guardNormalDelay: number,
    guardAADelay: number,
  ): boolean {
    if (s.missionTimer > 0) return false;

    const mission = s.mission ?? Mission.GUARD;
    if (mission === Mission.REPAIR && (s.type === 'AFLD' || s.type === 'HPAD')) {
      return this.updateAircraftPadRepairMission(s);
    }

    if (mission === Mission.UNLOAD && s.type === 'WEAP') {
      const enteredIdleMode = this.updateWeapUnloadMission(s);
      const savedTag = ScenarioRandom._sourceTag;
      if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = 70015;
      const jitter = ScenarioRandom.nextInRange(0, 2);
      if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = savedTag;
      if (enteredIdleMode) {
        s.mission = Mission.GUARD;
        s.missionTimer = 0;
        return false;
      }
      s.missionTimer = 14 + jitter;
      return false;
    }

    if (s.weapon) {
      const assignedTarget = s.targetEntityId !== undefined
        ? this.entityById.get(s.targetEntityId)
        : undefined;
      const hasAssignedTarget = !!(assignedTarget && assignedTarget.alive && !assignedTarget.inLimbo);

      if (mission === Mission.ATTACK) {
        if (!hasAssignedTarget) {
          // C++ building.cpp:3726-3730 — invalid/lost target sends building
          // back to GUARD and returns 1, with no Guard jitter this tick.
          s.targetEntityId = undefined;
          s.mission = Mission.GUARD;
          s.missionTimer = 1;
          return false;
        }
        if (this.isElectricStructureWeapon(s) && !s.isCharged) {
          // C++ BuildingClass::Can_Fire: TeslaZap Charges=yes returns
          // FIRE_BUSY until Charging_AI sets IsCharged. Mission_Attack
          // returns 1 and keeps the target/ATTACK mission alive.
          s.missionTimer = 1;
          return false;
        }
        s.missionTimer = 1;
        return true;
      }

      const target = _findStructureThreatTarget(combatCtx, s);
      if (target) {
        s.targetEntityId = target.id;
        s.mission = Mission.ATTACK;
        // C++ BuildingClass::Mission_Guard only Assign_Target() and Commence()
        // into MISSION_ATTACK. It does not aim turreted buildings here; the
        // first PrimaryFacing.Set_Desired(Direction(TarCom)) occurs in
        // Mission_Attack after Can_Fire returns FIRE_FACING/FIRE_REARM/etc.
        s.missionTimer = 1;
        // C++ TechnoClass::AI runs after Mission_Guard and can clear a just
        // acquired TarCom if the stricter TARGET-coordinate range check fails.
        if (!this.structureTargetInTarcomRange(s, target)) {
          s.targetEntityId = undefined;
        }
        return false;
      }

      s.targetEntityId = undefined;
      const jitter = ScenarioRandom.nextInRange(0, 2);
      s.mission = Mission.GUARD;
      s.missionTimer = guardAADelay + jitter;
      return false;
    }

    const jitter = ScenarioRandom.nextInRange(0, 2);
    s.mission = Mission.GUARD;
    s.missionTimer = (s.type === 'FIX' ? guardNormalDelay : guardNormalDelay * 3) + jitter;
    return false;
  }

  private syncWeapDoorFrame(s: MapStructure): void {
    const CLOSED = 0;
    const OPENING = 1;
    const OPEN = 2;
    const CLOSING = 3;
    const stage = Math.max(0, Math.min(3, s.weapDoorStage ?? 0));
    let displayStage = 0;
    switch (s.weapDoorState ?? CLOSED) {
      case OPENING:
        displayStage = stage;
        break;
      case OPEN:
        displayStage = 3;
        break;
      case CLOSING:
        displayStage = Math.max(0, 3 - stage);
        break;
      case CLOSED:
      default:
        displayStage = 0;
        break;
    }
    s.doorFrame = Math.round(displayStage * 7 / 3);
  }

  /** C++ BuildingClass::Mission_Unload uses Open_Door/Close_Door(8, 5).
   *  DoorClass stores stages-1 internally, so the logical control stage runs
   *  0..4 while Door_Stage renders 0..3. */
  private static readonly WEAP_DOOR_RATE_TICKS = 8;

  private openWeapDoor(s: MapStructure): void {
    const CLOSED = 0;
    const OPENING = 1;
    const CLOSING = 3;
    const state = s.weapDoorState ?? CLOSED;
    if (state === CLOSED || state === CLOSING) {
      s.weapDoorState = OPENING;
      s.weapDoorStage = 0;
      s.weapDoorTimer = Game.WEAP_DOOR_RATE_TICKS;
      this.syncWeapDoorFrame(s);
    }
  }

  private closeWeapDoor(s: MapStructure): void {
    const CLOSED = 0;
    const OPENING = 1;
    const OPEN = 2;
    const CLOSING = 3;
    const state = s.weapDoorState ?? CLOSED;
    if (state === OPEN || state === OPENING) {
      s.weapDoorState = CLOSING;
      s.weapDoorStage = 0;
      s.weapDoorTimer = Game.WEAP_DOOR_RATE_TICKS;
      this.syncWeapDoorFrame(s);
    }
  }

  private isWeapDoorOpen(s: MapStructure): boolean {
    return s.weapDoorState === 2;
  }

  private isWeapDoorClosed(s: MapStructure): boolean {
    return (s.weapDoorState ?? 0) === 0;
  }

  /** C++ DoorClass::AI for the war-factory door. MissionClass::AI runs before
   *  DoorClass::AI through TechnoClass::AI, so tickStructuresInterleaved calls
   *  this after dispatchStructureMissionTimer for the same building. */
  private tickWeapDoorAI(s: MapStructure): void {
    const OPENING = 1;
    const OPEN = 2;
    const CLOSING = 3;
    const state = s.weapDoorState ?? 0;
    if (state !== OPENING && state !== CLOSING) {
      this.syncWeapDoorFrame(s);
      return;
    }

    const timer = s.weapDoorTimer ?? Game.WEAP_DOOR_RATE_TICKS;
    if (timer > 1) {
      s.weapDoorTimer = timer - 1;
      this.syncWeapDoorFrame(s);
      return;
    }

    s.weapDoorStage = (s.weapDoorStage ?? 0) + 1;
    if (s.weapDoorStage >= 4) {
      s.weapDoorState = state === OPENING ? OPEN : 0;
      s.weapDoorTimer = 0;
    } else {
      s.weapDoorTimer = Game.WEAP_DOOR_RATE_TICKS;
    }
    this.syncWeapDoorFrame(s);
  }

  private weapUnloadTrackCell(s: MapStructure): CellPos {
    // bdata.cpp ClassWeapon ExitList[0] = XYCELL(1,2). This is distinct
    // from the product's unlimbo coordinate at (1.5 cells, 1 cell).
    return { cx: s.cx + 1, cy: s.cy + 2 };
  }

  private structureOccupiesCell(structure: MapStructure, cx: number, cy: number): boolean {
    if (!structure.alive || structure.rubble) return false;
    return getStructureOccupyCells(structure).some(cell => cell.cx === cx && cell.cy === cy);
  }

  private cellHasTechno(cx: number, cy: number): boolean {
    for (const e of this.entities) {
      if (!e.alive || e.inLimbo) continue;
      if (e.isAirUnit && e.flightAltitude > 0) continue;
      if (e.cell.cx === cx && e.cell.cy === cy) return true;
    }
    return false;
  }

  private scatterWeapExitBlockers(exitCell: CellPos): void {
    this.incomingNoThreatScatterCell(exitCell.cx, exitCell.cy);
    for (let facing = 0; facing < 8; facing++) {
      const cx = exitCell.cx + DIR_DX[facing];
      const cy = exitCell.cy + DIR_DY[facing];
      if (this.structures.some(s => this.structureOccupiesCell(s, cx, cy))) continue;
      this.incomingNoThreatScatterCell(cx, cy);
    }
  }

  private commandWeapProductOut(s: MapStructure, unit: Entity, trackCell: CellPos): void {
    unit.mission = Mission.MOVE;
    unit.missionQueue = null;
    unit.missionTimer = 0;
    unit.moveTarget = cellTargetToLepton(trackCell.cx, trackCell.cy);
    unit.path = [];
    unit.pathIndex = 0;
    unit.pathDelay = 0;

    const iq = this.houseIQs.get(s.house) ?? (s.house === this.playerHouse ? 0 : 3);
    if (iq >= 4) {
      unit.missionQueue = Mission.AREA_GUARD;
      const rally = this.rallyPoints.get('WEAP');
      if (rally) {
        unit.guardOrigin = { x: rally.x, y: rally.y };
        unit.archiveTarget = worldToCell(rally.x, rally.y);
        unit.archiveTargetEntity = null;
        unit.archiveTargetLeptons = null;
      }
    }

    this.startDriveClassMove(unit);
  }

  /** C++ BuildingClass::Mission_Unload WEAP status machine
   *  (building.cpp:4528-4637). Returns true when Enter_Idle_Mode has queued and
   *  commenced GUARD; Mission_Unload still consumes its jitter, but the stale
   *  UNLOAD delay must not be written back over the commenced GUARD timer. */
  private updateWeapUnloadMission(s: MapStructure): boolean {
    const INITIAL = 0;
    const CLEAR_BIB = 1;
    const OPEN = 2;
    const LEAVE = 3;
    const CLOSE = 4;
    const status = s.weapUnloadStatus ?? INITIAL;
    const unit = s.aiFactoryContactEntityId !== undefined
      ? this.entityById.get(s.aiFactoryContactEntityId)
      : undefined;

    if (status === INITIAL) {
      if (unit && unit.alive && !unit.inLimbo) {
        unit.mission = Mission.GUARD;
        unit.missionQueue = null;
        unit.missionTimer = 0;
      }
      this.openWeapDoor(s);
      s.weapUnloadStatus = CLEAR_BIB;
      return false;
    }

    if (status === CLEAR_BIB) {
      const trackCell = this.weapUnloadTrackCell(s);
      if (this.cellHasTechno(trackCell.cx, trackCell.cy)) {
        this.scatterWeapExitBlockers(trackCell);
      } else {
        s.weapUnloadStatus = OPEN;
      }
      return false;
    }

    if (status === OPEN) {
      if (this.isWeapDoorOpen(s)) {
        const trackCell = this.weapUnloadTrackCell(s);
        if (unit && unit.alive && !unit.inLimbo && unit.isTethered) {
          this.commandWeapProductOut(s, unit, trackCell);
          s.weapUnloadStatus = LEAVE;
        } else {
          this.closeWeapDoor(s);
          s.weapUnloadStatus = CLOSE;
        }
      }
      return false;
    }

    if (status === LEAVE) {
      if (!unit || !unit.alive || unit.inLimbo || !unit.isTethered) {
        this.closeWeapDoor(s);
        s.weapUnloadStatus = CLOSE;
      }
      return false;
    }

    if (status === CLOSE) {
      if (this.isWeapDoorClosed(s)) {
        s.weapUnloadStatus = 0;
        s.aiFactoryContactEntityId = undefined;
        return true;
      }
    }

    return false;
  }

  /** C++ BuildingClass::AI() — interleaved timer tick + combat per building.
   *  In C++, each building's AI() runs MissionClass::AI() (timer tick with RNG jitter)
   *  then Firing_AI() (weapon targeting/fire with potential RNG for damage/scatter)
   *  sequentially before advancing to the next building. This method replicates that
   *  interleaving to maintain RNG stream parity.
   *
   *  Previously timer ticks and combat were separate bulk passes:
   *    tickStructureMissionTimers() → all buildings → then _updateStructureCombat() → all buildings
   *  That caused RNG divergence (±2 calls on SCG03EA/SCG13EA) because building combat RNG
   *  was consumed at a different stream position than in C++.
   *
   *  C++ building.cpp:3228-3306 (timer), building.cpp:Firing_AI (combat).
   *  @param combatCtx  CombatContext for structure combat (weapon fire, damage, etc.)
   */
  private tickStructuresInterleaved(combatCtx: CombatContext): void {
    // C++ rules.ini: [Guard] Rate=.050, AARate=.016
    // C++ fixed-point: fixed(".050")→Raw=12. Normal_Delay=((12*900)+128)/256=42
    // C++ fixed-point: fixed(".016")→Raw=4.  AA_Delay=((4*900)+128)/256=14
    const GUARD_NORMAL_DELAY = 42;
    const GUARD_AA_DELAY = 14;
    // C++ house.cpp:4164: low power when Power < Drain (including Power=0 with Drain>0)
    const isLowPower = combatCtx.powerConsumed > combatCtx.powerProduced;
    let _structIdx = 0;
    for (const s of this.structures) {
      // RNG audit: set source tag for building (C++ 12000 + Logic index)
      if (ScenarioRandom._tagLogging) {
        ScenarioRandom._sourceTag = 12000 + _structIdx;
      }
      _structIdx++;
      if (!s.alive) {
        _tickDestroyedStructureDebris(combatCtx, s);
        continue;
      }
      if (isStructureUnderConstruction(s)) continue; // still under construction
      if (s.sellProgress !== undefined) continue;  // being sold

      this.tickStructureChargingAnimation(s);
      const runStructureAttack = this.dispatchStructureMissionTimer(
        s, combatCtx, GUARD_NORMAL_DELAY, GUARD_AA_DELAY);
      if (s.type === 'WEAP') this.tickWeapDoorAI(s);

      // ── Phase 2: Mission_Attack — weapon targeting and fire ──
      // C++ runs this immediately after timer tick for the SAME building,
      // so combat RNG is consumed at the correct stream position.
      if (runStructureAttack) _updateSingleStructureCombat(combatCtx, s, isLowPower);

      this.maintainStructureTarcom(s);

      this.updateStructureChargingAI(s, combatCtx, isLowPower);

      // C++ BuildingClass::Rotation_AI runs after MissionClass::AI for this
      // building, so fire-facing checks use the pre-rotation facing.
      _tickStructureTurretRotation(s, isLowPower);

      // ── Phase 3: Gap Generator Arm timer (building.cpp:990-993) ──
      // C++ BuildingClass::AI() checks STRUCT_GAP after Rotation_AI().
      // Arm is a CDTimerClass (auto-decrements each tick). When Arm==0:
      //   IsJamming = false;
      //   Arm = TICKS_PER_MINUTE * Rule.GapRegenInterval + Random_Pick(1, TICKS_PER_SECOND);
      // TICKS_PER_MINUTE=900, GapRegenInterval=0.1 → base=90. TICKS_PER_SECOND=15.
      // This consumes 1 RNG call per GAP building per Arm cycle.
      if (s.type === 'GAP' && s.gapArmTimer !== undefined) {
        if (s.gapArmTimer > 0) {
          s.gapArmTimer--;
        }
        if (s.gapArmTimer === 0) {
          // C++ building.cpp:993: Arm = TICKS_PER_MINUTE * Rule.GapRegenInterval + Random_Pick(1, TICKS_PER_SECOND)
          // 900 * 0.1 = 90 base + Random_Pick(1, 15)
          const gapJitter = ScenarioRandom.nextInRange(1, 15);
          s.gapArmTimer = 90 + gapJitter;
        }
      }

      _decrementStructureCdTimersEndOfLogic(s);

      // ── C++ building.cpp:2438-2455 — HPAD auto-spawned helicopter interleaving ──
      // In C++, the helicopter sits in the Logic array right after its HPAD building.
      // Its AI() (guard timer RNG) fires between this building and the next one.
      // Process it here so its RNG calls land at the correct stream position.
      //
      // C++ aircraft.cpp:3678 Mission_Guard for landed AI helicopters:
      //   Height==0, !IsHuman → aircraft-specific checks, then FootClass::Mission_Guard:
      //   1. If TarCom valid → Assign_Mission(MISSION_ATTACK), return 1 (line 3773)
      //   2. If no target → FootClass::Mission_Guard (foot.cpp:589):
      //      a. Target_Something_Nearby(THREAT_RANGE) sets TarCom (side effect)
      //      b. If no target → Random_Animate() consumes idle RNG
      //      c. Returns Normal_Delay(42) + Random_Pick(0,2)
      //   3. Next timer fire: TarCom valid → ATTACK → takeoff → fly → attack → RTB → rearm → land
      if (s.hpadHelicopterId !== undefined) {
        const heli = this.entityById.get(s.hpadHelicopterId);
        if (heli && heli.alive && heli.isAirUnit) {
          heli.rotTickedThisFrame = false;
          heli.turretRotTickedThisFrame = false;
          if (heli.isInRecoilState) heli.isInRecoilState = false;
          if (!heli.inLimbo) {
            // C++ MissionClass::AI — mission timer + guard scan for landed helicopter.
            // Aircraft in 'landed' state return true from updateAircraft() immediately,
            // which means updateEntity() never runs the mission timer or guard logic.
            // We run it here to match C++ where the helicopter's AI() fires in the
            // building pass (Logic array ordering).
            if (heli.mission === Mission.GUARD && heli.aircraftState === 'landed') {
              // Note: attack cooldowns are ticked by updateAircraft() (aircraft.ts:398-399)
              // which runs for ALL aircraft states including 'landed'. No need to tick here.

	              // C++ MissionClass::AI reads Timer.Value() at AI entry. Landed
	              // aircraft return from updateAircraft before TS's normal
	              // end-of-logic countdown, so this HPAD path dispatches from the
	              // current value and applies that countdown below.
	              const timerFired = heli.missionTimer <= 0;
	              if (timerFired) {
                if (this._handleLandedAircraftServiceSeek(heli)) continue;
                // C++ aircraft.cpp:3773: if (Target_Legal(TarCom)) → ATTACK, return 1
                // Previous scan set entity.target/targetStructure — helicopter takes off.
                const hasTarget = (heli.target?.alive) ||
                  (heli.targetStructure && (heli.targetStructure as MapStructure).alive);
                if (hasTarget) {
                  heli.mission = Mission.ATTACK;
                  // AircraftClass::AI runs Commence() after Mission_Guard.
                  // Assign_Mission(ATTACK) queues the mission; Commence pops it
                  // and resets Timer=0, so Mission_Attack dispatches next tick.
                  heli.missionTimer = 0;
                } else {
                  heli.target = null; // clear stale target
                  heli.targetStructure = null;
                  // C++ aircraft.cpp:3781-3807 + foot.cpp:589:
                  //   - !Is_Weapon_Equipped → sit (HIND/HELI have weapons, skip)
                  //   - Height==0 && !In_Radio_Contact → scatter (docked, skip)
                  //   - House->State != STATE_ATTACKED → Find_Juicy_Target (house.cpp:6900)
                  //   - FootClass::Mission_Guard → Target_Something_Nearby validates/overrides
                  const juicyFound = this._heliGuardScan(heli);
                  // C++ foot.cpp:684-687:
                  //     if (Arm != 0) { return (int)Arm; }   <-- NO Random_Pick
                  //     return(dtime + Random_Pick(0,2));
                  // Random_Pick(0,2) is guarded by Arm==0 — gate jitter accordingly.
                  if (juicyFound) {
                    if (heli.attackCooldown === 0) {
                      ScenarioRandom.nextInRange(0, 2);
                    }
                    heli.mission = Mission.ATTACK;
                    // Same queued-then-Commence path as Target_Legal(TarCom).
                    heli.missionTimer = 0;
                  } else if (heli.attackCooldown > 0) {
                    // C++ foot.cpp:684: Arm != 0 → return Arm, skipping Random_Pick.
                    heli.missionTimer = heli.attackCooldown;
                  } else {
                    // C++ foot.cpp:687: dtime + Random_Pick(0,2) when Arm == 0.
                    const mgJitter = ScenarioRandom.nextInRange(0, 2);
                    heli.missionTimer = GUARD_NORMAL_DELAY + mgJitter;
                  }
                }
              }
            }
            // updateEntity runs the aircraft state machine (takeoff on ATTACK,
            // flight, combat, RTB, landing, rearming) and idle timer decrements.
	            this.updateEntity(heli);
	            // C++ CDTimerClass starts a returned delay at the current Frame.
	            // Normal TS entities do this in decrementEntityCdTimersEndOfLogic();
	            // landed aircraft bypass that path, so mirror it once here.
	            if (heli.missionTimer > 0) heli.missionTimer--;
	            heli.tickAnimation();
          }
          heli._processedInBuildingPass = true;
        }
      }
    }
  }

  /** Agent 9: Tick C4 timers on structures — delegates to specialUnits.ts */
  tickC4Timers(): void {
    this._runSpecialUnits(ctx => _tickC4Timers(ctx));
  }

  /** Agent 9: Thief steals credits — delegates to specialUnits.ts */
  updateThief(entity: Entity): void {
    this._runSpecialUnits(ctx => _updateThief(ctx, entity));
  }

  /** Agent 9: Minelayer places AP mines — delegates to specialUnits.ts */
  static readonly MAX_MINES_PER_HOUSE = _MAX_MINES_PER_HOUSE;
  mines: Array<{ cx: number; cy: number; house: House; damage: number; type: 'AP' | 'AV' }> = [];

  updateMinelayer(entity: Entity): void {
    this._runSpecialUnits(ctx => _updateMinelayer(ctx, entity));
  }

  /** Agent 9: Mine trigger check — delegates to specialUnits.ts */
  tickMines(): void {
    this._runSpecialUnits(ctx => _tickMines(ctx));
  }

  /** CR8: Tick active vortices — delegates to specialUnits.ts */
  private tickVortices(): void {
    this._runSpecialUnits(ctx => _tickVortices(ctx));
  }

  /** Agent 9: Gap Generator shroud — delegates to fog.ts */
  static readonly GAP_RADIUS = GAP_RADIUS;
  static readonly GAP_UPDATE_INTERVAL = GAP_UPDATE_INTERVAL;
  gapGeneratorCells = new Map<number, { cx: number; cy: number; radius: number }>();

  updateGapGenerators(): void {
    _updateGapGenerators(this._fogCtx);
  }

  /** Chrono Tank cooldown — delegates to specialUnits.ts */
  static readonly CHRONO_TANK_COOLDOWN = _CHRONO_TANK_COOLDOWN;

  updateChronoTank(entity: Entity): void {
    this._runSpecialUnits(ctx => _updateChronoTank(ctx, entity));
  }

  /** Execute Chrono Tank teleport — delegates to specialUnits.ts */
  teleportChronoTank(entity: Entity, target: WorldPos): void {
    this._runSpecialUnits(ctx => _teleportChronoTank(ctx, entity, target));
  }

  /** Agent 9: MAD Tank deploy + shockwave — delegates to specialUnits.ts */
  static readonly MAD_TANK_CHARGE_TICKS = _MAD_TANK_CHARGE_TICKS;
  static readonly MAD_TANK_UNIT_DAMAGE_PERCENT = _MAD_TANK_UNIT_DAMAGE_PERCENT;
  static readonly MAD_TANK_BUILDING_DAMAGE_PERCENT = _MAD_TANK_BUILDING_DAMAGE_PERCENT;
  static readonly MAD_TANK_INFANTRY_DAMAGE = _MAD_TANK_INFANTRY_DAMAGE;
  static readonly MAD_TANK_RADIUS = _MAD_TANK_RADIUS;
  static readonly MAD_TANK_SCREEN_SHAKE = _MAD_TANK_SCREEN_SHAKE;

  updateMADTank(entity: Entity): void {
    this._runSpecialUnits(ctx => _updateMADTank(ctx, entity));
  }

  deployMADTank(entity: Entity): void {
    this._runSpecialUnits(ctx => _deployMADTank(ctx, entity));
  }

  /** Agent 9: Demo Truck — delegates to specialUnits.ts */
  static readonly DEMO_TRUCK_DAMAGE = _DEMO_TRUCK_DAMAGE;
  static readonly DEMO_TRUCK_RADIUS = _DEMO_TRUCK_RADIUS;
  static readonly DEMO_TRUCK_FUSE_TICKS = _DEMO_TRUCK_FUSE_TICKS;

  updateDemoTruck(entity: Entity): void {
    this._runSpecialUnits(ctx => _updateDemoTruck(ctx, entity));
  }

  /** Agent 9: Vehicle cloak — delegates to specialUnits.ts */
  updateVehicleCloak(entity: Entity): void {
    this._runSpecialUnits(ctx => _updateVehicleCloak(ctx, entity));
  }

  /** Agent 9: Mechanic auto-heal — delegates to specialUnits.ts */
  static readonly MECHANIC_HEAL_RANGE = _MECHANIC_HEAL_RANGE;
  static readonly MECHANIC_HEAL_AMOUNT = _MECHANIC_HEAL_AMOUNT;

  updateMechanicUnit(entity: Entity): void {
    this._runSpecialUnits(ctx => _updateMechanicUnit(ctx, entity));
  }

  // === Other Stubbed Systems (not needed for ant missions) ===
  // These mechanics exist in the original RA engine but are unused in SCA01-04EA.
  // Explicitly stubbed so the absence is deliberate, not accidental.

  // FORMATION MOVEMENT: Original RA campaign teams can change formation before MOVE/PATROL
  // orders. The ant missions do not rely on it, but the team mission path now honors it.

  // AFTERMATH VEHICLES: CTNK (Chrono Tank), DTRK (Demo Truck), CARR (Carrier),
  // MSUB (Missile Sub), QTNK (MAD Tank), STNK (Stealth Tank) — none appear in
  // ant mission INI files. Sprites not extracted.

  // AFTERMATH SOUNDS: ANTBITE.AUD, ANTDIE.AUD, BUZZY1.AUD, TANK01.AUD, etc.
  // Extracted to WAV by scripts/extract-ra-audio.ts -> public/ra/audio/.
  // AudioManager.loadSamples() loads them at runtime; synth fallback if unavailable.

  // === Agent Harness API (public methods for programmatic control) ===

  /** Toggle repair on a structure by index. Returns true if repair is now active. */
  toggleRepair(idx: number): boolean {
    return _toggleRepair(this._repairSellCtx, idx);
  }

  /** Initiate sell on a structure by index. Returns true if sell started. */
  sellStructureByIndex(idx: number): boolean {
    return _sellStructureByIndex(this._repairSellCtx, idx);
  }

  /** Check if a structure is currently being repaired. */
  isStructureRepairing(idx: number): boolean {
    return _isStructureRepairing(this._repairSellCtx, idx);
  }
}
