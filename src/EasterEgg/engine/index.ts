/**
 * Main game loop — ties all engine systems together.
 * Fixed timestep at 15 FPS (matching original Red Alert game speed).
 */

import {
  type WorldPos, type UnitStats, type WeaponStats, type ArmorType,
  type WarheadMeta, type WarheadProps,
  type AllianceTable, buildDefaultAlliances, buildAlliancesFromINI,
  CELL_SIZE, MAP_CELLS, GAME_TICKS_PER_SEC, MPH_TO_PX, LEPTON_SIZE,
  MAX_DAMAGE, REPAIR_STEP, REPAIR_PERCENT, CONDITION_RED, CONDITION_YELLOW, POWER_DRAIN,
	  Dir, Mission, AnimState, House, UnitType, Stance, SpeedClass, worldDist, directionTo, worldToCell,
	  WARHEAD_VS_ARMOR, WARHEAD_PROPS, WARHEAD_META, type WarheadType, UNIT_STATS, WEAPON_STATS, armorIndex, EXPLOSION_FRAMES,
  PRODUCTION_ITEMS, type ProductionItem, CursorType, type StripType, getStripSide,
  type Faction, HOUSE_FACTION, COUNTRY_BONUSES, ANT_HOUSES,
  calcProjectileTravelFrames, modifyDamage,
  SuperweaponType, SUPERWEAPON_DEFS, type SuperweaponDef, type SuperweaponState,
  IRON_CURTAIN_DURATION, NUKE_DAMAGE, NUKE_BLAST_CELLS, NUKE_FLIGHT_TICKS,
  NUKE_MIN_FALLOFF, CHRONO_SHIFT_VISUAL_TICKS, SONAR_REVEAL_TICKS, IC_TARGET_RANGE,
  CIVILIAN_UNIT_TYPES,
} from './types';
import { AssetManager, getSharedAssets } from './assets';
import { AudioManager, type SoundName } from './audio';
import { Camera } from './camera';
import { InputManager } from './input';
import { Entity, resetEntityIds, setPlayerHouses, threatScore as computeThreatScore, CloakState, CLOAK_TRANSITION_FRAMES, SONAR_PULSE_DURATION } from './entity';
import { GameMap, Terrain } from './map';
import { Renderer, type Effect, BUILDING_FRAME_TABLE } from './renderer';
import { findPath } from './pathfinding';
import {
  usesTrackMovement, lookupTrackControl, getEffectiveTrack, getTrackArray,
  smoothTurn, LP, PIXEL_LEPTON_W, F_D, RAW_TRACKS,
  type TrackControlEntry,
} from './tracks';
import {
  loadScenario, applyScenarioOverrides,
  type TeamType, type ScenarioTrigger, type MapStructure,
  type TriggerGameState, type TriggerActionResult,
  checkTriggerEvent, executeTriggerAction, houseIdToHouse, STRUCTURE_WEAPONS, STRUCTURE_SIZE, STRUCTURE_MAX_HP,
  saveCarryover, TIME_UNIT_TICKS,
} from './scenario';
export { MISSIONS, getMission, getMissionIndex, loadProgress, saveProgress } from './scenario';
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
  fireWeaponAtStructure as _fireWeaponAtStructure,
  handleUnitDeath as _handleUnitDeath,
  triggerRetaliation as _triggerRetaliation,
  checkVehicleCrush as _checkVehicleCrush,
  launchProjectile as _launchProjectile,
  updateInflightProjectiles as _updateInflightProjectiles,
  applySplashDamage as _applySplashDamage,
  structureDamage as _structureDamage,
  updateStructureCombat as _updateStructureCombat,
  SPLASH_RADIUS,
} from './combat';
import {
  type FogContext,
  updateFogOfWar as _updateFogOfWar,
  updateSubDetection as _updateSubDetection,
  revealAroundCell as _revealAroundCell,
  updateGapGenerators as _updateGapGenerators,
  GAP_RADIUS, GAP_UPDATE_INTERVAL, DEFENSE_TYPES as FOG_DEFENSE_TYPES,
} from './fog';
import {
  type RepairSellContext,
  repairCostPerStep as _repairCostPerStep,
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
  MAD_TANK_DAMAGE as _MAD_TANK_DAMAGE,
  MAD_TANK_RADIUS as _MAD_TANK_RADIUS,
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
} from './placement';
import {
  type AircraftContext,
  canTargetNaval as _canTargetNaval,
  findLandingPad as _findLandingPad,
  getAircraftTargetPos as _getAircraftTargetPos,
  updateAircraft as _updateAircraft,
  updateFixedWingAttackRun as _updateFixedWingAttackRun,
  updateHelicopterAttack as _updateHelicopterAttack,
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
  createAIHouseState as _createAIHouseState,
  getAIBuildOrder as _getAIBuildOrder,
  aiPlaceStructure as _aiPlaceStructure,
  updateAIConstruction as _updateAIConstruction,
  updateAIStrategicPlanner as _updateAIStrategicPlanner,
  updateAIHarvesters as _updateAIHarvesters,
  updateAIAttackGroups as _updateAIAttackGroups,
  launchAIAttack as _launchAIAttack,
  aiPickAttackTarget as _aiPickAttackTarget,
  updateAIDefense as _updateAIDefense,
  updateAIRetreat as _updateAIRetreat,
  updateAIRepair as _updateAIRepair,
  updateAISellDamaged as _updateAISellDamaged,
  updateAIIncome as _updateAIIncome,
  updateAIProduction as _updateAIProduction,
  updateAIAutocreateTeams as _updateAIAutocreateTeams,
  updateBaseRebuild as _updateBaseRebuild,
  spawnAIStructure as _spawnAIStructure,
  spawnAIUnit as _spawnAIUnit,
} from './ai';
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
} from './missionAI';

// Re-export subsystem types and functions for external consumers
export type { InflightProjectileType as InflightProjectile };
export { SPLASH_RADIUS } from './combat';
export {
  repairCostPerStep, sellRefund, powerOutput, calculatePowerGrid,
  powerMultiplier, calculateSiloCapacity,
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
  MAD_TANK_CHARGE_TICKS, MAD_TANK_DAMAGE, MAD_TANK_RADIUS,
  MECHANIC_HEAL_RANGE, MECHANIC_HEAL_AMOUNT,
} from './specialUnits';
export { getEffectiveCost, countPlayerBuildings } from './production';

export type { SuperweaponState } from './types';

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
  selectedIds = new Set<number>();
  selectedStructureIdx = -1; // index into structures[] for selected building (-1 = none)
  controlGroups: Map<number, Set<number>> = new Map(); // 1-9 → entity IDs
  attackMoveMode = false;
  sellMode = false;
  repairMode = false;
  /** U6: Fullscreen radar toggle — enlarged minimap overlay */
  isRadarFullscreen = false;
  cursorType: CursorType = CursorType.DEFAULT;
  /** Set of structure indices currently being repaired */
  private repairingStructures = new Set<number>();
  /** Tick when last EVA base attack warning played (throttle to once per 5s) */
  private lastBaseAttackEva = 0;
  /** EVA announcement throttling — maps sound name to last tick played */
  private lastEvaTime = new Map<string, number>();
  /** Counter for wave group coordination */
  private nextWaveId = 1;
  private cellInfCount = new Map<number, number>(); // reused each tick for sub-cell assignment
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
  /** Cached silo storage capacity (PROC=1000, SILO=1500 each) — recalculated on structure change */
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
  productionQueue: Map<string, { item: ProductionItem; progress: number; queueCount: number; costPaid: number }> = new Map();
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
  static readonly SIDEBAR_W = 160;
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
  effects: Effect[] = [];
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
  private allowWin = false; // set by ALLOWWIN action — required before win condition fires
  private missionTimer = 0; // mission countdown timer (in game ticks), 0 = inactive
  private missionTimerExpired = false;
  private builtStructureTypes = new Set<string>(); // types player has constructed (for TEVENT_BUILD)
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
  // AI base rebuild system
  private baseBlueprint: Array<{ type: string; cell: number; house: House }> = [];
  private baseRebuildQueue: Array<{ type: string; cell: number; house: House }> = [];
  private baseRebuildCooldown = 0;

  // Comparison mode — activated via ?anttest=compare
  comparisonMode = false;
  /** When true, fog of war is disabled (all cells visible) */
  fogDisabled = false;
  fogReEnableTick = 0; // ticks until fog re-enables after spy infiltration

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
      tick: this.tick,
      playerHouse: this.playerHouse,
      scenarioId: this.scenarioId,
      killCount: this.killCount,
      lossCount: this.lossCount,
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
      getFirepowerBias: (h) => this.getFirepowerBias(h),
      damageStructure: (s, d) => this.damageStructure(s, d),
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
      damageEntity: (t, a, w) => this.damageEntity(t, a, w as WarheadType),
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
    };
  }

  /** Run superweapon function with state sync */
  private _runSuperweapon<T>(fn: (ctx: SuperweaponContext) => T): T {
    const ctx = this._superweaponCtx;
    const result = fn(ctx);
    this.killCount = ctx.killCount;
    this.lossCount = ctx.lossCount;
    this.nukePendingTarget = ctx.nukePendingTarget;
    this.nukePendingTick = ctx.nukePendingTick;
    this.nukePendingSource = ctx.nukePendingSource;
    this.renderer.screenShake = Math.max(this.renderer.screenShake, ctx.screenShake);
    this.renderer.screenFlash = Math.max(this.renderer.screenFlash, ctx.screenFlash);
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
      addCredits: (amount) => this.addCredits(amount),
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
      structures: this.structures,
      map: this.map,
      unitsLeftMap: this.unitsLeftMap,
      civiliansEvacuated: this.civiliansEvacuated,
      isAllied: (a, b) => this.isAllied(a, b),
      movementSpeed: (e) => this.movementSpeed(e),
      idleMission: (e) => this.idleMission(e),
      fireWeaponAt: (a, t, w) => this.fireWeaponAt(a, t, w),
      fireWeaponAtStructure: (a, s, w) => this.fireWeaponAtStructure(a, s, w),
    };
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
      destroyedTeams: this.destroyedTeams,
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
    return {
      entities: this.entities,
      structures: this.structures,
      effects: this.effects,
      map: this.map,
      tick: this.tick,
      playerHouse: this.playerHouse,
      killCount: this.killCount,
      evaMessages: this.evaMessages,
      warheadOverrides: this.warheadOverrides,
      scenarioWarheadMeta: this.scenarioWarheadMeta,
      scenarioWarheadProps: this.scenarioWarheadProps,
      isAllied: (a, b) => this.isAllied(a, b),
      entitiesAllied: (a, b) => this.entitiesAllied(a, b),
      isPlayerControlled: (e) => this.isPlayerControlled(e),
      movementSpeed: (e) => this.movementSpeed(e),
      playSoundAt: (n, x, y) => this.playSoundAt(n as SoundName, x, y),
      playEva: (n) => this.playEva(n as SoundName),
      playSound: (n) => this.audio.play(n as SoundName),
      weaponSound: (n) => this.audio.weaponSound(n),
      damageEntity: (t, a, w, att) => this.damageEntity(t, a, w, att),
      damageStructure: (s, d) => this.damageStructure(s, d),
      triggerRetaliation: (v, a) => this.triggerRetaliation(v, a),
      handleUnitDeath: (v, o) => this.handleUnitDeath(v, o),
      launchProjectile: (a, t, w, d, ix, iy, dh) => this.launchProjectile(a, t, w, d, ix, iy, dh),
      applySplashDamage: (c, w, pid, ah, att) => this.applySplashDamage(c, w, pid, ah, att),
      getFirepowerBias: (h) => this.getFirepowerBias(h),
      getWarheadMult: (w, a) => this.getWarheadMult(w, a),
      getWarheadMeta: (w) => this.getWarheadMeta(w),
      getWarheadProps: (w) => this.getWarheadProps(w as WarheadType),
      warheadMuzzleColor: (w) => this.warheadMuzzleColor(w as WarheadType),
      weaponProjectileStyle: (n) => this.weaponProjectileStyle(n),
      idleMission: (e) => this.idleMission(e),
      retreatFromTarget: (e, p) => this.retreatFromTarget(e, p),
      threatScore: (s, t, d) => this.threatScore(s, t, d),
      updateDemoTruck: (e) => this.updateDemoTruck(e),
      updateMedic: (e) => this.updateMedic(e),
      updateMechanicUnit: (e) => this.updateMechanicUnit(e),
      updateTanyaC4: (e) => this.updateTanyaC4(e),
      updateThief: (e) => this.updateThief(e),
      spyDisguise: (s, t) => this.spyDisguise(s, t),
      spyInfiltrate: (s, st) => this.spyInfiltrate(s, st),
      minimapAlert: (cx, cy) => this.minimapAlert(cx, cy),
    };
  }

  /** Run a mission AI subsystem function with state sync */
  private _runMissionAI<T>(fn: (ctx: MissionAIContext) => T): T {
    const ctx = this._missionAICtx;
    const result = fn(ctx);
    // Sync mutable scalars back
    this.killCount = ctx.killCount;
    return result;
  }

  /** Load assets and start a scenario */
  async start(scenarioId = 'SCA01EA', difficulty: Difficulty = 'normal'): Promise<void> {
    this.state = 'loading';
    this.stopped = false;
    this.scenarioId = scenarioId;
    this.difficulty = difficulty;
    this.onStateChange?.('loading');
    resetEntityIds();

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

    // Load scenario
    const scenario = await loadScenario(scenarioId);
    this.map = scenario.map;
    this.entities = scenario.entities;
    this.structures = scenario.structures;
    this.entityById.clear();
    for (const e of scenario.entities) this.entityById.set(e.id, e);
    this.missionName = scenario.name;
    this.missionBriefing = scenario.briefing;
    this.waypoints = scenario.waypoints;
    this.teamTypes = scenario.teamTypes;
    this.triggers = scenario.triggers;
    this.credits = scenario.credits;
    this.playerHouse = scenario.playerHouse;
    this.playerFaction = HOUSE_FACTION[this.playerHouse] ?? 'allied';
    this.playerTechLevel = scenario.playerTechLevel ?? 10;
    // Calculate initial silo capacity and cap starting credits (C++ parity)
    this.siloCapacity = this.calculateSiloCapacity();
    if (this.siloCapacity > 0 && this.credits > this.siloCapacity) {
      this.credits = this.siloCapacity;
    } else if (this.siloCapacity === 0 && this.credits > 0) {
      // Edge case: scenario provides credits but no storage — keep them for gameplay
      // (C++ starts with refineries providing capacity, so this shouldn't happen in practice)
    }
    this.lastSiloWarningTick = -450; // allow immediate silo warning if needed
    this.toCarryOver = scenario.toCarryOver;
    this.theatre = scenario.theatre;
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
    // First crate spawns after 60 seconds
    this.nextCrateTick = GAME_TICKS_PER_SEC * 60;
    this.crates = [];
    this.inflightProjectiles = [];
    // Build alliance table: use scenario INI data if available, otherwise default (ant missions)
    if (scenario.houseAllies.size > 0) {
      this.alliances = buildAlliancesFromINI(scenario.houseAllies, this.playerHouse);
    } else {
      this.alliances = buildDefaultAlliances();
    }
    // Build player house set for Entity.isPlayerUnit — all houses allied with playerHouse
    const playerHouseSet = new Set<House>();
    for (const [house, allies] of this.alliances) {
      if (allies.has(this.playerHouse)) playerHouseSet.add(house);
    }
    playerHouseSet.add(this.playerHouse);
    setPlayerHouses(playerHouseSet);
    // Sync to renderer
    this.renderer.playerHouses = playerHouseSet;
    this.allowWin = false;
    this.missionTimer = 0;
    this.missionTimerExpired = false;
    this.builtStructureTypes.clear();
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

    // Center camera on player start
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
    for (let i = 0; i < n && this.state === 'playing'; i++) {
      this.update();
    }
    this.renderer.interpolationAlpha = 1; // agent step: show latest state, no interpolation
    this.render();
    if (wasPaused && this.state === 'playing') this.state = 'paused';
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
    // Smooths entity movement between 20fps game ticks for 60fps visual rendering
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
    // 16ms ≈ 60fps render rate, game ticks at fixed 20fps inside (C++ default GameSpeed=3).
    this.timerId = window.setTimeout(this.gameLoop, 16);
  }

  /** Fixed-timestep game update */
  private update(): void {
    this.tick++;

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

    // Update occupancy grid and assign infantry sub-cell positions
    this.map.occupancy.fill(0);
    this.cellInfCount.clear();
    for (const entity of this.entities) {
      if (entity.alive) {
        // Air units don't block ground occupancy when airborne
        if (!entity.isAirUnit || entity.flightAltitude === 0) {
          this.map.setOccupancy(entity.cell.cx, entity.cell.cy, entity.id);
        }
        // Assign sub-cell positions for infantry so they spread within the cell
        if (entity.stats.isInfantry) {
          const ci = entity.cell.cy * 128 + entity.cell.cx;
          const cnt = this.cellInfCount.get(ci) ?? 0;
          entity.subCell = cnt % 5;
          this.cellInfCount.set(ci, cnt + 1);
        }
      }
    }

    // Update all entities
    for (const entity of this.entities) {
      // Reset per-tick rotation guards (prevents double-accumulation)
      entity.rotTickedThisFrame = false;
      entity.turretRotTickedThisFrame = false;
      // Clear recoil from previous tick (C++ techno.cpp:2339 — recoil lasts 1 tick)
      if (entity.isInRecoilState) entity.isInRecoilState = false;

      // Submarine cloaking state machine (SS, MSUB)
      if (entity.alive && entity.stats.isCloakable) {
        this.updateSubCloak(entity);
      }
      // LST door auto-close timer
      if (entity.alive && entity.doorOpen && entity.doorTimer > 0) {
        entity.doorTimer--;
        if (entity.doorTimer <= 0) entity.doorOpen = false;
      }
      // Sonar pulse timer decrement
      if (entity.sonarPulseTimer > 0) entity.sonarPulseTimer--;

      // C++ infantry.cpp:3466-3496 Fear_AI — decay fear, update prone state
      if (entity.stats.isInfantry && entity.fear > 0) {
        entity.fear--;
        // Go prone when fear >= FEAR_ANXIOUS (crawl animation handles prone+moving)
        if (!entity.isProne && entity.fear >= Entity.FEAR_ANXIOUS) {
          entity.isProne = true;
        }
        // Stand up when fear drops below FEAR_ANXIOUS
        if (entity.isProne && entity.fear < Entity.FEAR_ANXIOUS) {
          entity.isProne = false;
        }
      }

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
        continue;
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
      // Minelayer: place mines when reaching move destination
      if (entity.alive && entity.type === UnitType.V_MNLY && entity.moveTarget) {
        this.updateMinelayer(entity);
      }

      // S5: Update wasMoving — entity moved this tick if position changed from prevPos
      const movedThisTick = entity.pos.x !== entity.prevPos.x || entity.pos.y !== entity.prevPos.y;
      entity.wasMoving = wasMovingBefore || movedThisTick;
    }

    // Process deferred transport loads (remove loaded passengers from world)
    if (this._pendingTransportLoads.length > 0) {
      const loadSet = new Set(this._pendingTransportLoads);
      for (const id of loadSet) {
        const e = this.entityById.get(id);
      }
      this.entities = this.entities.filter(e => !loadSet.has(e.id));
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

    // Check for units leaving the map edge (civilian evacuation)
    for (const entity of this.entities) {
      if (!entity.alive) continue;
      const c = entity.cell;
      if (c.cx <= this.map.boundsX || c.cx >= this.map.boundsX + this.map.boundsW - 1 ||
          c.cy <= this.map.boundsY || c.cy >= this.map.boundsY + this.map.boundsH - 1) {
        // Check if unit has a move target outside the map (intentionally leaving)
        if (entity.moveTarget) {
          const tc = worldToCell(entity.moveTarget.x, entity.moveTarget.y);
          if (!this.map.inBounds(tc.cx, tc.cy)) {
            entity.alive = false;
            entity.mission = Mission.DIE;
            this.unitsLeftMap++;
            if (CIVILIAN_UNIT_TYPES.has(entity.type)) {
              this.civiliansEvacuated++;
            }
            // Transport passengers: civilians aboard count as evacuated (C++ transport evacuation)
            if (entity.passengers && entity.passengers.length > 0) {
              for (const p of entity.passengers) {
                p.alive = false;
                this.unitsLeftMap++;
                if (CIVILIAN_UNIT_TYPES.has(p.type)) {
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

    // Crate spawning (every 60-90 seconds, max 3 on map) — disabled for ant missions
    if (!this.scenarioId.startsWith('SCA') && this.tick >= this.nextCrateTick && this.crates.length < 3) {
      this.spawnCrate();
      this.nextCrateTick = this.tick + GAME_TICKS_PER_SEC * (60 + Math.floor(Math.random() * 30));
    }

    // Crate pickup — player units walking over crates
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const crate = this.crates[i];
      // CR6: Expire after per-crate lifetime (C++ Random(CrateTime/2, CrateTime*2) minutes)
      if (this.tick - crate.tick > crate.lifetime) {
        this.crates.splice(i, 1);
        continue;
      }
      for (const e of this.entities) {
        if (!e.alive || !e.isPlayerUnit) continue;
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

    // Process triggers (every 15 ticks = once per second for performance)
    if (this.tick % 15 === 0) {
      this.processTriggers();
    }

    // RP3: Repair structures — delegates to repairSell.ts (14 tick interval)
    if (this.tick % 14 === 0) {
      this._runRepairSell(ctx => _tickRepairs(ctx));
    }

    // Queen Ant self-healing (SelfHealing=yes in INI): +1 HP every 60 ticks (~4 seconds)
    if (this.tick % 60 === 0) {
      for (const s of this.structures) {
        if (s.alive && s.type === 'QUEE' && s.hp < s.maxHp) {
          s.hp = Math.min(s.maxHp, s.hp + 1);
        }
      }
    }

    // Service Depot — delegates to repairSell.ts (14 tick interval)
    if (this.tick % 14 === 0) {
      this._runRepairSell(ctx => _tickServiceDepot(ctx));
    }

    // Defensive structure auto-fire
    this._runCombat(ctx => _updateStructureCombat(ctx));

    // Tick C4 timers on structures (Tanya plants)
    this.tickC4Timers();

    // Tick mine triggers (Minelayer AP mines)
    this.tickMines();

    // CR8: Tick active vortices
    this.tickVortices();

    // Gap Generator shroud jamming (every ~90 ticks)
    this.updateGapGenerators();

    // Advance in-flight projectiles
    this.updateInflightProjectiles();

    // Queen Ant spawning — QUEE periodically spawns ants (rate varies by difficulty)
    const spawnSec = (DIFFICULTY_MODS[this.difficulty] ?? DIFFICULTY_MODS.normal).spawnInterval;
    if (this.tick % (GAME_TICKS_PER_SEC * spawnSec) === 0) {
      this.updateQueenSpawning();
    }

    // AI strategic planner — runs every 150 ticks (skip for ant missions)
    if (!this.scenarioId.startsWith('SCA')) {
      this.updateAIStrategicPlanner();
      this.updateAIConstruction();
      this.updateAIHarvesters();
      this.updateAIAttackGroups();
      this.updateAIDefense();
      this.updateAIRetreat();
    }

    // AI army building (works for both ant missions and strategic AI)
    this.updateAIIncome();
    this.updateAIProduction();
    this.updateAIAutocreateTeams();

    // AI base rebuild (existing, still used for ant missions + gap-fill)
    this.updateBaseRebuild();
    // AI base intelligence — auto-repair and auto-sell damaged buildings (IQ >= 3, C++ parity)
    this.updateAIRepair();
    this.updateAISellDamaged();

    // Ore regeneration — C++ OverlayClass::AI() fires every ~256 ticks (~17s at 15 FPS)
    this.map.growOre(this.tick);

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
      if (e.chronoShiftTick > 0) e.chronoShiftTick--;
    }

    // Fog re-enable timer (spy DOME infiltration)
    if (this.fogDisabled && this.fogReEnableTick > 0) {
      this.fogReEnableTick--;
      if (this.fogReEnableTick <= 0) this.fogDisabled = false;
    }

    // Clean up dead entities after death animation — save corpse before removal
    const before = this.entities.length;
    for (const e of this.entities) {
      if (!e.alive && e.deathTick >= 45) {
        // Persist trigger name before entity is removed from array
        if (e.triggerName) this.destroyedTriggerNames.add(e.triggerName);
        // Save as persistent corpse
        if (this.corpses.length >= Game.MAX_CORPSES) this.corpses.shift();
        this.corpses.push({
          x: e.pos.x, y: e.pos.y, type: e.type, facing: e.facing,
          isInfantry: e.stats.isInfantry, isAnt: e.isAnt, alpha: 0.5,
          deathVariant: e.deathVariant,
        });
      }
    }
    this.entities = this.entities.filter(
      e => e.alive || e.deathTick < 45 // ~2.25 seconds at 20fps
    );
    if (this.entities.length < before) {
      this.entityById.clear();
      for (const e of this.entities) this.entityById.set(e.id, e);
      // Prune dead IDs from control groups
      for (const [g, ids] of this.controlGroups) {
        for (const id of ids) {
          if (!this.entityById.has(id)) ids.delete(id);
        }
        if (ids.size === 0) this.controlGroups.delete(g);
      }
    }

    // Animate displayed credits toward actual credits
    if (this.displayCredits !== this.credits) {
      const diff = this.credits - this.displayCredits;
      const step = Math.max(1, Math.abs(diff) >> 2); // tick 25% per frame
      if (diff > 0) this.displayCredits = Math.min(this.credits, this.displayCredits + step);
      else this.displayCredits = Math.max(this.credits, this.displayCredits - step);
    }

    // Calculate power balance
    this.powerProduced = 0;
    this.powerConsumed = 0;
    for (const s of this.structures) {
      if (!s.alive || s.sellProgress !== undefined || !this.isAllied(s.house, this.playerHouse)) continue;
      // Power production — scales with building health (C++ building.cpp:4613 Power_Output)
      const healthRatio = s.hp / s.maxHp;
      // C++ building.cpp: FACT produces 0 power (ConYard is not a power source)
      if (s.type === 'POWR') this.powerProduced += Math.round(100 * healthRatio);
      else if (s.type === 'APWR') this.powerProduced += Math.round(200 * healthRatio);
      // Power consumption — from POWER_DRAIN table (rules.ini Power= values)
      const drain = POWER_DRAIN[s.type];
      if (drain) this.powerConsumed += drain;
    }

    // Low power warning (every 10 seconds when power demand exceeds supply)
    if (this.powerConsumed > this.powerProduced && this.powerProduced > 0 &&
        this.tick % (GAME_TICKS_PER_SEC * 10) === 0) {
      this.audio.play('eva_low_power');
    }

    // Superweapon recharge and auto-fire
    this.updateSuperweapons();

    // Tick structure construction and sell animations
    for (const s of this.structures) {
      // Construction: 0→1 over ~2 seconds = 30 ticks
      if (s.buildProgress !== undefined && s.buildProgress < 1) {
        const wasBuilding = s.buildProgress < 1;
        s.buildProgress = Math.min(1, s.buildProgress + 1 / 30);
        // Track completed construction for TEVENT_BUILD
        if (wasBuilding && s.buildProgress >= 1) {
          this.builtStructureTypes.add(s.type);
          if (s.house === 'Spain' || s.house === 'Greece') {
            this.structuresBuilt++;
            // C++ parity: recalculate silo capacity when storage structure completed
            if (s.type === 'PROC' || s.type === 'SILO') {
              this.recalculateSiloCapacity();
            }
          }
        }
      }
      // Sell: play make-sheet frames in reverse at construction rate (C++ parity).
      // Duration scales with per-building frame count from BUILDING_FRAME_TABLE.
      // Guard: skip if structure was destroyed mid-sell (e.g. by enemy attack)
      if (s.sellProgress !== undefined && s.alive) {
        const bft = BUILDING_FRAME_TABLE[s.image];
        const sellFrameCount = bft ? Math.max(bft.damageFrame, 1) : 15;
        // Match construction rate: 1 tick per frame (same visual pace as build-up)
        s.sellProgress = Math.min(1, s.sellProgress + 1 / (sellFrameCount * 2));
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
          // Refund: flat 50% of building cost (C++ parity — no health scaling)
          const prodItem = this.scenarioProductionItems.find(p => p.type === s.type);
          // Recalculate silo capacity BEFORE adding refund (structure is now dead)
          this.recalculateSiloCapacity();
          if (prodItem) {
            this.addCredits(Math.floor(prodItem.cost * 0.5), true);
          }
          s.sellHpAtStart = undefined;
          const wx = s.cx * CELL_SIZE + CELL_SIZE;
          const wy = s.cy * CELL_SIZE + CELL_SIZE;
          this.effects.push({ type: 'explosion', x: wx, y: wy, frame: 0, maxFrames: EXPLOSION_FRAMES['veh-hit1'] ?? 17, size: 12,
            sprite: 'veh-hit1', spriteStart: 0 });
          // SL4: Spawn infantry survivors (C++ building.cpp How_Many_Survivors + Crew_Type)
          // Count: (buildingCost * SurvivorFraction) / E1_cost, clamped 1-5
          const E1_COST = 100;
          const SURVIVOR_FRACTION = 0.5; // rules.cpp:177 SurvivorFraction(fixed(1,2))
          const buildCost = prodItem?.cost ?? 300;
          const survivorCount = Math.min(5, Math.max(1,
            Math.floor((buildCost * SURVIVOR_FRACTION) / E1_COST)));
          for (let si = 0; si < survivorCount; si++) {
            // C++ Crew_Type: per-building type with random variance
            let crewType: UnitType;
            switch (s.type) {
              case 'SILO': // STRUCT_STORAGE: 50% C1 or C7 (civilians)
                crewType = Math.random() < 0.5 ? UnitType.I_C1 : UnitType.I_C7;
                break;
              case 'FACT': // STRUCT_CONST: 25% engineer if human-owned
                crewType = Math.random() < 0.25 ? UnitType.I_E6 : UnitType.I_E1;
                break;
              case 'KENN': // STRUCT_KENNEL: 50% dog, 50% nothing
                if (Math.random() < 0.5) continue; // no survivor this iteration
                crewType = UnitType.I_DOG;
                break;
              case 'TENT': case 'BARR': // Barracks: always E1
                crewType = UnitType.I_E1;
                break;
              default: // TechnoClass::Crew_Type: E1, with 15% civilian chance if no weapon
                crewType = UnitType.I_E1;
                break;
            }
            const inf = new Entity(crewType, s.house, wx + (si % 3 - 1) * 6, wy + Math.floor(si / 3) * 6);
            inf.mission = Mission.GUARD;
            this.entities.push(inf);
            this.entityById.set(inf.id, inf);
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
    // S = stop all selected units, G = guard position (same as stop)
    if ((keys.has('s') && !keys.has('ArrowDown')) || keys.has('g')) {
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
      keys.delete('g');
      keys.delete('s');
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

    // Ctrl+1-9: assign control group
    if (ctrlHeld) {
      for (let g = 1; g <= 9; g++) {
        if (keys.has(String(g)) && this.selectedIds.size > 0) {
          this.controlGroups.set(g, new Set(this.selectedIds));
          keys.delete(String(g)); // consume
        }
      }
    } else {
      // 1-9 without ctrl: recall control group; double-tap to center camera
      const now = Date.now();
      for (let g = 1; g <= 9; g++) {
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
        const angle = Math.random() * Math.PI * 2;
        const dist = CELL_SIZE * (2 + Math.random() * 2);
        const goalX = unit.pos.x + Math.cos(angle) * dist;
        const goalY = unit.pos.y + Math.sin(angle) * dist;
        unit.mission = Mission.MOVE;
        unit.moveTarget = { x: goalX, y: goalY };
        unit.target = null;
        unit.moveQueue = [];
        unit.path = findPath(this.map, unit.cell, worldToCell(goalX, goalY), true, unit.isNavalUnit, unit.stats.speedClass);
        unit.pathIndex = 0;
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
              this.addCredits(Math.floor(prodItem.cost * 0.5), true);
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
          unit.moveTarget = pos;
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
          const strip = getStripSide(item);
          this.cancelProduction(strip);
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
            u.moveTarget = pos;
            u.moveQueue = [];
            u.target = null;
            u.targetStructure = null;
            u.forceFirePos = null;
            u.teamMissions = [];
            u.teamMissionIndex = 0;
            u.path = findPath(this.map, u.cell, worldToCell(pos.x, pos.y), true, u.isNavalUnit, u.stats.speedClass);
            u.pathIndex = 0;
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

      // Force-fire on ground: Ctrl+right-click fires at a location (artillery/splash)
      if (ctrlHeld && this.selectedIds.size > 0) {
        for (const id of this.selectedIds) {
          const unit = this.entityById.get(id);
          if (!unit?.alive || !unit.weapon) continue;
          // Only weapons with splash or inaccuracy benefit from ground attack
          if (!unit.weapon.splash && !unit.weapon.inaccuracy) continue;
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
            unit.selected = false;
            this.selectedIds.delete(unit.id);
            // Remove from world (will be re-added on unload)
            this.entities = this.entities.filter(e => e.id !== unit.id);
            this.entityById.delete(unit.id);
            this.map.setOccupancy(unit.cell.cx, unit.cell.cy, 0);
            loaded++;
          } else {
            // Move toward transport (they'll be loaded by proximity check)
            unit.mission = Mission.MOVE;
            unit.moveTarget = { ...target.pos };
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
          for (const p of unit.passengers) {
            // Find a passable position near the click point
            let px = world.x, py = world.y;
            for (let attempt = 0; attempt < 8; attempt++) {
              const ox = world.x + (Math.random() - 0.5) * CELL_SIZE * 2;
              const oy = world.y + (Math.random() - 0.5) * CELL_SIZE * 2;
              const tc = worldToCell(ox, oy);
              if (this.map.isPassable(tc.cx, tc.cy)) {
                px = ox; py = oy;
                break;
              }
            }
            p.alive = true;
            p.hp = p.hp > 0 ? p.hp : 1; // ensure alive units have HP
            p.transportRef = null;
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
            unit.moveQueue.push(pos);
          } else {
            unit.mission = Mission.MOVE;
            unit.moveTarget = pos;
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
    const btnH = 20;
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
    // AU4: EVA power gate — skip EVA playback when power fraction < 0.25 (critically low power)
    if (this.powerConsumed > 0 && this.powerProduced > 0) {
      const powerFraction = this.powerProduced / this.powerConsumed;
      if (powerFraction < 0.25) return;
    }
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
    for (const s of this.structures) {
      if (!s.alive) continue;
      const [fw, fh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
      if (cx >= s.cx && cx < s.cx + fw && cy >= s.cy && cy < s.cy + fh) {
        return s;
      }
    }
    return null;
  }

  /** Clear a structure's footprint cells back to passable */
  private clearStructureFootprint(s: MapStructure): void {
    const [fw, fh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        this.map.setTerrain(s.cx + dx, s.cy + dy, Terrain.CLEAR);
        this.map.clearWallType(s.cx + dx, s.cy + dy);
      }
    }
  }

  /** Damage a structure, return true if destroyed */
  private damageStructure(s: MapStructure, damage: number): boolean {
    return this._runCombat(ctx => _structureDamage(ctx, s, damage));
  }

  /** Update a single entity's AI and movement */
  private updateEntity(entity: Entity): void {
    // Team mission script execution (rate-limited to every 8 ticks)
    // Area Guard ants use their own patrol logic, not global hunt AI
    if (entity.mission !== Mission.DIE && entity.mission !== Mission.AREA_GUARD) {
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

    switch (entity.mission) {
      case Mission.MOVE:
        this.updateMove(entity);
        break;
      case Mission.ATTACK:
        this.updateAttack(entity);
        break;
      case Mission.HUNT:
        this.updateHunt(entity);
        break;
      case Mission.GUARD:
        this.updateGuard(entity);
        break;
      case Mission.AREA_GUARD:
        this.updateAreaGuard(entity);
        break;
      case Mission.SLEEP:
        // Dormant — do nothing until explicitly given a new mission
        entity.animState = AnimState.IDLE;
        break;
      // AI1: New C++ parity missions
      case Mission.ENTER:
        // Entering transport — handled by transport loading code (updateMove with transport target)
        this.updateMove(entity);
        break;
      case Mission.CAPTURE:
        // Engineer capture — handled by updateAttack with targetStructure
        this.updateAttack(entity);
        break;
      case Mission.HARVEST:
        // Harvester cycle — handled by updateHarvester() called from the harvester update path
        entity.animState = AnimState.IDLE;
        break;
      case Mission.UNLOAD:
        // Transport unload / MAD deploy — handled by existing deploy/unload code
        entity.animState = AnimState.IDLE;
        break;
      case Mission.RETREAT:
        // Move to nearest map edge and exit the map
        this.updateRetreat(entity);
        break;
      case Mission.AMBUSH:
        // Sleep until enemy enters sight range, then switch to HUNT
        this.updateAmbush(entity);
        break;
      case Mission.STICKY:
        // Guard mode with isRecruitable=false (won't join AI teams)
        this.updateGuard(entity);
        break;
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
        entity.moveTarget = { x: fleeX, y: fleeY };
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
      this._runHarvester(ctx => _updateHarvester(ctx, entity));
    }

    // M2: Turret returns to body facing when idle (C++ unit.cpp:554-559)
    // When no target, turret aligns to movement direction (if moving) or body facing (if standing)
    if (entity.alive && entity.hasTurret && !entity.target?.alive && !entity.targetStructure?.alive) {
      if (entity.moveTarget || entity.path.length > 0) {
        // Moving — turret faces movement direction
        entity.desiredTurretFacing = entity.desiredFacing;
      } else {
        // Standing still — turret aligns to body facing
        entity.desiredTurretFacing = entity.facing;
      }
      entity.tickTurretRotation();
    }

    // Vehicle crush: heavy tracked vehicles (crusher=true) kill crushable units on cell entry
    // C++ DriveClass::Ok_To_Move — only vehicles with Crusher flag crush infantry/ants
    if (entity.alive && entity.stats.crusher &&
        entity.stats.speed > 0 && entity.animState === AnimState.WALK) {
      this.checkVehicleCrush(entity);
    }

    // Auto-load into transport: infantry moving toward a friendly transport
    if (entity.alive && entity.stats.isInfantry && entity.isPlayerUnit &&
        entity.mission === Mission.MOVE && entity.moveTarget) {
      for (const other of this.entities) {
        if (!other.alive || other.id === entity.id || !other.isTransport) continue;
        if (!other.isPlayerUnit || other.passengers.length >= other.maxPassengers) continue;
        const dist = worldDist(entity.pos, other.pos);
        if (dist < 1.2) {
          // Close enough — check if move target was the transport
          const tgtDist = worldDist(entity.moveTarget, other.pos);
          if (tgtDist < 2) {
            other.passengers.push(entity);
            entity.transportRef = other;
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
  private static readonly TMISSION_MOVE = 3;
  private static readonly TMISSION_GUARD = 5;
  private static readonly TMISSION_LOOP = 6;
  private static readonly TMISSION_UNLOAD = 8;
  private static readonly TMISSION_HOUND_DOG = 10;   // move to waypoint then guard (C++ TMission_Hound_Dog)
  private static readonly TMISSION_DO = 11;          // assign mission to members (C++ Coordinate_Do)
  private static readonly TMISSION_SET_GLOBAL = 12;  // set global variable (C++ TMission_Set_Global)
  private static readonly TMISSION_IDLE = 13;        // idle at position
  private static readonly TMISSION_LOAD = 14;
  private static readonly TMISSION_PATROL = 16;

  /** Map C++ MissionType enum index to TS Mission enum (C++ defines.h:979-1008) */
  private static readonly CPP_MISSION_MAP: Record<number, Mission> = {
    0: Mission.SLEEP,       // MISSION_SLEEP
    1: Mission.ATTACK,      // MISSION_ATTACK
    2: Mission.MOVE,        // MISSION_MOVE
    3: Mission.MOVE,        // MISSION_QMOVE (queued move → treat as MOVE)
    4: Mission.MOVE,        // MISSION_RETREAT → treat as MOVE
    5: Mission.GUARD,       // MISSION_GUARD
    7: Mission.MOVE,        // MISSION_ENTER → treat as MOVE
    8: Mission.ATTACK,      // MISSION_CAPTURE → treat as ATTACK
    9: Mission.GUARD,       // MISSION_HARVEST → treat as GUARD
    10: Mission.AREA_GUARD, // MISSION_GUARD_AREA
    11: Mission.MOVE,       // MISSION_RETURN → treat as MOVE
    12: Mission.GUARD,      // MISSION_STOP → treat as GUARD
    13: Mission.AREA_GUARD, // MISSION_AMBUSH → treat as AREA_GUARD
    14: Mission.HUNT,       // MISSION_HUNT
  };

  /** Execute team mission scripts — units follow waypoint patrol routes */
  private updateTeamMission(entity: Entity): void {
    if (entity.teamMissionIndex >= entity.teamMissions.length) {
      // Script complete — ants fall back to hunt AI, allied units idle
      if (entity.isAnt) {
        this.updateAntAI(entity);
      } else {
        entity.mission = this.idleMission(entity);
        entity.animState = AnimState.IDLE;
      }
      return;
    }

    const tm = entity.teamMissions[entity.teamMissionIndex];

    switch (tm.mission) {
      case Game.TMISSION_MOVE: {
        // Move to waypoint — issue path command if not already moving there
        const wp = this.waypoints.get(tm.data);
        if (!wp) { entity.teamMissionIndex++; return; }
        const target = { x: wp.cx * CELL_SIZE + CELL_SIZE / 2, y: wp.cy * CELL_SIZE + CELL_SIZE / 2 };

        // Check arrival first — aircraft may have already completed the move
        // (aircraftState machine clears moveTarget on arrival before team mission scans)
        if (worldDist(entity.pos, target) < 2) {
          // Arrived at waypoint — advance to next mission
          entity.teamMissionIndex++;
        } else if (entity.mission !== Mission.MOVE || !entity.moveTarget) {
          entity.mission = Mission.MOVE;
          entity.moveTarget = target;
          entity.target = null;

          // Off-map waypoints (e.g. convoy exit WP25 in SCG02EA): path to nearest
          // map edge cell instead, keeping moveTarget off-map so the edge exit check
          // in processTick fires when the unit reaches the boundary.
          let pathGoal = { cx: wp.cx, cy: wp.cy };
          if (!this.map.inBounds(wp.cx, wp.cy) && !entity.stats.isAircraft) {
            const bx = this.map.boundsX, by = this.map.boundsY;
            const bw = this.map.boundsW, bh = this.map.boundsH;
            pathGoal = {
              cx: Math.max(bx, Math.min(bx + bw - 1, wp.cx)),
              cy: Math.max(by, Math.min(by + bh - 1, wp.cy)),
            };
          }

          entity.path = findPath(this.map, entity.cell, pathGoal, true, entity.isNavalUnit, entity.stats.speedClass);
          entity.pathIndex = 0;
        }
        break;
      }

      case Game.TMISSION_ATTACK:
      case Game.TMISSION_ATT_WAYPT: {
        // Attack: hunt nearest visible player unit near waypoint
        if (entity.mission === Mission.ATTACK && entity.target?.alive) return;

        const wp = this.waypoints.get(tm.data);
        let nearest: Entity | null = null;
        let nearestDist = Infinity;

        for (const other of this.entities) {
          if (!other.alive || !other.isPlayerUnit) continue;
          const dist = worldDist(entity.pos, other.pos);
          // Fog-aware: only target units within sight range or near waypoint
          if (wp) {
            const wpWorld = { x: wp.cx * CELL_SIZE + CELL_SIZE / 2, y: wp.cy * CELL_SIZE + CELL_SIZE / 2 };
            const distToWp = worldDist(other.pos, wpWorld);
            if (distToWp > 15 && dist > entity.stats.sight * 2) continue;
          } else {
            if (dist > entity.stats.sight * 1.5) continue;
          }
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = other;
          }
        }

        if (nearest) {
          entity.mission = Mission.ATTACK;
          entity.target = nearest;
        } else if (wp) {
          // No targets — move toward the waypoint
          const target = { x: wp.cx * CELL_SIZE + CELL_SIZE / 2, y: wp.cy * CELL_SIZE + CELL_SIZE / 2 };
          if (worldDist(entity.pos, target) > 3) {
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
          for (const passenger of entity.passengers) {
            passenger.alive = true;
            passenger.hp = passenger.maxHp;
            passenger.transportRef = null;
            passenger.deathTick = 0;

            let px: number, py: number;
            if (isNaval && shoreCells.length > 0) {
              // Place on shore cells, cycling through available ones
              const shore = shoreCells[shoreIdx % shoreCells.length];
              px = shore.x + (Math.random() - 0.5) * CELL_SIZE * 0.5;
              py = shore.y + (Math.random() - 0.5) * CELL_SIZE * 0.5;
              shoreIdx++;
            } else {
              // Non-naval: random placement near transport (existing behavior)
              px = entity.pos.x;
              py = entity.pos.y;
              for (let attempt = 0; attempt < 8; attempt++) {
                const ox = entity.pos.x + (Math.random() - 0.5) * CELL_SIZE * 2;
                const oy = entity.pos.y + (Math.random() - 0.5) * CELL_SIZE * 2;
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
              // Defer removal from entity list (same as player-initiated load)
              this._pendingTransportLoads.push(other.id);
            }
          }
        }
        entity.teamMissionIndex++;
        break;
      }

      case Game.TMISSION_IDLE: {
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
        const target = { x: wp.cx * CELL_SIZE + CELL_SIZE / 2, y: wp.cy * CELL_SIZE + CELL_SIZE / 2 };
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
        if (worldDist(entity.pos, target) < 2) {
          entity.teamMissionIndex++;
        } else if (entity.mission !== Mission.MOVE || !entity.moveTarget) {
          entity.mission = Mission.MOVE;
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
        const target = { x: wp.cx * CELL_SIZE + CELL_SIZE / 2, y: wp.cy * CELL_SIZE + CELL_SIZE / 2 };

        if (worldDist(entity.pos, target) < 2) {
          // Arrived — switch to guard mode and complete mission
          entity.mission = Mission.GUARD;
          entity.moveTarget = null;
          entity.teamMissionIndex++;
        } else if (entity.mission !== Mission.MOVE || !entity.moveTarget) {
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
          entity.moveToward({ x: waveCX, y: waveCY }, this.movementSpeed(entity));
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

  /** Get the idle mission for an entity (AREA_GUARD if it has a guard origin, otherwise GUARD) */
  private idleMission(entity: Entity): Mission {
    return entity.guardOrigin ? Mission.AREA_GUARD : Mission.GUARD;
  }

  /** Move toward move target along path */
  private updateMove(entity: Entity): void {
    if (!entity.moveTarget && entity.path.length === 0) {
      entity.mission = this.idleMission(entity);
      entity.animState = AnimState.IDLE;
      return;
    }

    entity.animState = AnimState.WALK;

    // A2: AI target acquisition while moving (C++ foot.cpp:492-505)
    // AI-controlled units scan for enemies every 15 ticks during MOVE and auto-engage
    if (!entity.isPlayerUnit && entity.weapon &&
        (this.tick + entity.id) % 15 === 0) {
      const ec = entity.cell;
      const scanRange = entity.stats.sight;
      let bestTarget: Entity | null = null;
      let bestScore = -Infinity;
      for (const other of this.entities) {
        if (!other.alive || this.entitiesAllied(entity, other)) continue;
        const dist = worldDist(entity.pos, other.pos);
        if (dist > scanRange) continue;
        if (!this.map.hasLineOfSight(ec.cx, ec.cy, other.cell.cx, other.cell.cy)) continue;
        const score = this.threatScore(entity, other, dist);
        if (score > bestScore) { bestScore = score; bestTarget = other; }
      }
      if (bestTarget) {
        // Save current move destination so unit can resume after killing
        entity.savedMoveTarget = entity.moveTarget ? { x: entity.moveTarget.x, y: entity.moveTarget.y } : null;
        entity.target = bestTarget;
        entity.mission = Mission.ATTACK;
        entity.animState = AnimState.ATTACK;
        entity.trackNumber = -1; // MV1: reset track on mission interrupt
        entity.trackCellSpan = 1;
        return;
      }
    }

    // Air units fly directly to destination — no pathfinding, no terrain collision
    if (entity.isAirUnit && entity.moveTarget) {
      // Ascend to flight altitude
      if (entity.flightAltitude < Entity.FLIGHT_ALTITUDE) {
        entity.flightAltitude = Math.min(Entity.FLIGHT_ALTITUDE, entity.flightAltitude + 3);
      }
      if (entity.moveToward(entity.moveTarget, this.movementSpeed(entity))) {
        entity.moveTarget = null;
        if (entity.moveQueue.length > 0) {
          const next = entity.moveQueue.shift()!;
          entity.moveTarget = next;
        } else {
          entity.mission = this.idleMission(entity);
          entity.animState = AnimState.IDLE;
        }
      }
      return;
    }

    if (entity.path.length > 0 && entity.pathIndex < entity.path.length) {
      const nextCell = entity.path[entity.pathIndex];
      // Safety check: verify next path cell is still passable (terrain may have changed since path was calculated)
      const terrainOk = entity.isNavalUnit
        ? this.map.isWaterPassable(nextCell.cx, nextCell.cy)
        : this.map.isTerrainPassable(nextCell.cx, nextCell.cy);
      if (!terrainOk && entity.moveTarget && this.tick - entity.lastPathRecalc > 15) {
        entity.lastPathRecalc = this.tick;
        const newPath = findPath(
          this.map, entity.cell,
          worldToCell(entity.moveTarget.x, entity.moveTarget.y), true,
          entity.isNavalUnit, entity.stats.speedClass
        );
        if (newPath.length === 0) {
          // Destination unreachable — stop movement
          entity.moveTarget = null;
          entity.path = [];
          entity.pathIndex = 0;
          entity.trackNumber = -1; // MV1: reset track on repath
          entity.trackCellSpan = 1;
          entity.mission = this.idleMission(entity);
          entity.animState = AnimState.IDLE;
          return;
        }
        entity.path = newPath;
        entity.pathIndex = 0;
        entity.trackNumber = -1; // MV1: reset track on repath
        entity.trackCellSpan = 1;
        return;
      }
      // Check if next cell is blocked by another unit — recalculate path (with cooldown)
      const occ = this.map.getOccupancy(nextCell.cx, nextCell.cy);
      if (occ > 0 && occ !== entity.id && entity.moveTarget) {
        // PF2: "Tell blocking unit to move" (C++ drive.cpp — nudge idle friendly units aside)
        const blocker = this.entityById.get(occ);
        if (blocker?.alive && this.entitiesAllied(entity, blocker) &&
            blocker.mission !== Mission.MOVE && blocker.mission !== Mission.ATTACK &&
            !blocker.moveTarget) {
          // Find adjacent free cell for the blocker to step into
          for (const [ndx, ndy] of [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]]) {
            const adjX = blocker.cell.cx + ndx;
            const adjY = blocker.cell.cy + ndy;
            if (this.map.isPassable(adjX, adjY) && this.map.getOccupancy(adjX, adjY) === 0) {
              blocker.moveTarget = { x: adjX * CELL_SIZE + CELL_SIZE / 2, y: adjY * CELL_SIZE + CELL_SIZE / 2 };
              blocker.mission = Mission.MOVE;
              blocker.animState = AnimState.WALK;
              break;
            }
          }
        }
        if (this.tick - entity.lastPathRecalc > 15) {
          entity.lastPathRecalc = this.tick;
          const newPath = findPath(
            this.map, entity.cell,
            worldToCell(entity.moveTarget.x, entity.moveTarget.y), true,
            entity.isNavalUnit, entity.stats.speedClass
          );
          if (newPath.length === 0) {
            // Can't find alternate route — wait a moment
            return;
          }
          entity.path = newPath;
          entity.pathIndex = 0;
          entity.trackNumber = -1; // MV1: reset track on repath
          entity.trackCellSpan = 1;
        }
      }
      const target: WorldPos = {
        x: nextCell.cx * CELL_SIZE + CELL_SIZE / 2,
        y: nextCell.cy * CELL_SIZE + CELL_SIZE / 2,
      };
      const speed = this.movementSpeed(entity);
      // MV1: Track-table movement for vehicles (C++ drive.cpp smooth turning)
      // Uses C++ TrackControl table to select pre-computed curved paths.
      // Track offsets are relative to target cell center, transformed via Smooth_Turn flags.
      if (usesTrackMovement(entity.stats.speedClass, !!entity.stats.isInfantry, !!entity.stats.isAircraft)) {
        // C++ drive.cpp AI() pattern: seamless track chaining on the same tick.
        // When a track completes, immediately initiate the next track and continue
        // following it with the remaining movement budget (no one-tick gap).
        const MAX_CHAIN = 4; // guard against infinite loops
        for (let chain = 0; chain < MAX_CHAIN; chain++) {
          // Recompute target for current pathIndex (may have advanced via chaining)
          const chainCell = entity.path[entity.pathIndex];
          if (!chainCell) break;
          const chainTarget: WorldPos = {
            x: chainCell.cx * CELL_SIZE + CELL_SIZE / 2,
            y: chainCell.cy * CELL_SIZE + CELL_SIZE / 2,
          };

          if (entity.trackNumber > 0) {
            // Currently following a track — advance along it
            // Long 2-cell tracks target the cell AFTER chainCell (entity.trackCellSpan=2)
            const trackTarget = entity.trackCellSpan === 2 && entity.path[entity.pathIndex + 1]
              ? { x: entity.path[entity.pathIndex + 1].cx * CELL_SIZE + CELL_SIZE / 2,
                  y: entity.path[entity.pathIndex + 1].cy * CELL_SIZE + CELL_SIZE / 2 }
              : chainTarget;
            if (this.followTrackStep(entity, speed, trackTarget.x, trackTarget.y)) {
              // Track complete — vehicle is at target cell center
              entity.pathIndex += entity.trackCellSpan;
              entity.trackCellSpan = 1; // reset for next track
              // Continue loop to chain next track on same tick (Fix 1)
              continue;
            }
            break; // Track not yet complete — done for this tick
          }

          // Need to initiate a new track for this cell-to-cell segment
          const nextFacing8 = directionTo(entity.pos, chainTarget);

          // Fix 4: Pre-rotation before track start (C++ drive.cpp:1054-1073 Do_Turn)
          // Entity must face the movement direction before track selection.
          if (entity.facing !== nextFacing8) {
            entity.desiredFacing = nextFacing8;
            entity.tickRotation();
            if (entity.facing !== nextFacing8) {
              break; // Still rotating — wait for alignment before starting track
            }
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

          // Long 2-cell tracks: when F_D is set and a following cell exists,
          // use the full long track (ctrl.track) targeting the SECOND cell ahead.
          // Step 0 of long tracks starts ~2 cells from target, which matches the
          // entity's current position (~1px offset vs 23px for short tracks).
          const useLongTrack = !!(ctrl.flag & F_D) && followingCell && ctrl.track > 0;
          const effectiveTrack = useLongTrack ? ctrl.track : getEffectiveTrack(ctrl);

          if (effectiveTrack > 0) {
            // Valid track — start following it
            entity.trackNumber = effectiveTrack;
            entity.trackFlags = ctrl.flag & ~F_D; // strip F_D (only F_T|F_X|F_Y for geometry)
            entity.trackIndex = 0;
            entity.trackCellSpan = useLongTrack ? 2 : 1;
            entity.speedAccum = 0; // C++: fresh budget per While_Moving() call
            // Long tracks target the SECOND cell ahead; short tracks target the next cell
            const trackTarget = useLongTrack
              ? { x: followingCell!.cx * CELL_SIZE + CELL_SIZE / 2,
                  y: followingCell!.cy * CELL_SIZE + CELL_SIZE / 2 }
              : chainTarget;
            // Follow first step this tick
            if (this.followTrackStep(entity, speed, trackTarget.x, trackTarget.y)) {
              entity.pathIndex += entity.trackCellSpan;
              entity.trackCellSpan = 1;
              continue; // Chain next track
            }
            break; // Track not yet complete
          } else {
            // Impossible turn (Track=0) — free-form fallback with rotation
            entity.desiredFacing = nextFacing8;
            entity.tickRotation();
            if (entity.facing === nextFacing8) {
              // Facing correct, now move
              if (entity.moveToward(chainTarget, speed)) {
                entity.pathIndex++;
              }
            }
            break; // Free-form doesn't chain
          }
        }
      } else {
        // Infantry/aircraft: free-form movement (FOOT speedClass exempt from tracks)
        if (entity.moveToward(target, speed)) {
          entity.pathIndex++;
        }
      }
    } else if (entity.moveTarget) {
      // C++ drive.cpp only accepts "close enough" as a fallback when pathing is blocked.
      // A direct move order should otherwise continue to the exact commanded cell.
      const closeEnough = 2.5; // worldDist returns cells
      const finishMove = () => {
        entity.moveTarget = null;
        if (entity.moveQueue.length > 0) {
          const next = entity.moveQueue.shift()!;
          entity.moveTarget = next;
          entity.path = findPath(this.map, entity.cell, worldToCell(next.x, next.y), true, entity.isNavalUnit, entity.stats.speedClass);
          entity.pathIndex = 0;
        } else {
          entity.mission = this.idleMission(entity);
          entity.animState = AnimState.IDLE;
        }
      };

      // Bug 3 fix: Before moving directly, check if the unit would enter an impassable cell.
      // Calculate which cell the unit would move into based on movement direction and speed.
      const speed = this.movementSpeed(entity);
      const dx = entity.moveTarget.x - entity.pos.x;
      const dy = entity.moveTarget.y - entity.pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const distToTarget = worldDist(entity.pos, entity.moveTarget);
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
          const occBlocked = !entity.isNavalUnit && occId > 0 && occId !== entity.id;
          if (!passable || occBlocked) {
            // Re-pathfind instead of sliding through impassable terrain.
            if (this.tick - entity.lastPathRecalc > 15) {
              entity.lastPathRecalc = this.tick;
              const newPath = findPath(
                this.map, currentCell,
                worldToCell(entity.moveTarget.x, entity.moveTarget.y), true,
                entity.isNavalUnit, entity.stats.speedClass
              );
              if (newPath.length > 0) {
                entity.path = newPath;
                entity.pathIndex = 0;
              } else if (distToTarget <= closeEnough && entity.moveQueue.length === 0) {
                finishMove();
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
      entity.mission = this.idleMission(entity);
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
  private updateGuard(entity: Entity): void {
    this._runMissionAI(ctx => _updateGuard(ctx, entity));
  }

  /** Submarine cloaking state machine — manages cloak transitions for SS/MSUB.
   *  Auto-cloaks when idle + no enemies within 3 cells + sonarPulseTimer === 0.
   *  Auto-uncloaks when firing or taking damage (handled in entity.takeDamage). */
  private updateSubCloak(entity: Entity): void {
    switch (entity.cloakState) {
      case CloakState.CLOAKING:
        entity.cloakTimer--;
        if (entity.cloakTimer <= 0) {
          entity.cloakState = CloakState.CLOAKED;
          entity.cloakTimer = 0;
        }
        break;
      case CloakState.UNCLOAKING:
        entity.cloakTimer--;
        if (entity.cloakTimer <= 0) {
          entity.cloakState = CloakState.UNCLOAKED;
          entity.cloakTimer = 0;
        }
        break;
      case CloakState.UNCLOAKED:
        // Auto-cloak when idle and sonar pulse expired (C++ TECHNO.CPP Cloak_AI)
        if (entity.sonarPulseTimer > 0) break;
        if (entity.mission === Mission.ATTACK) break; // don't cloak while attacking
        // CL4: Don't cloak while weapon is on cooldown (C++ — firing prevents cloak)
        if (entity.weapon && entity.attackCooldown > 0) break;
        // CL3: Health-gated cloak — below ConditionRed (25%), 96% chance to stay uncloaked
        if (entity.hp / entity.maxHp < CONDITION_RED && Math.random() > 0.04) break;
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
  private updateAreaGuard(entity: Entity): void {
    this._runMissionAI(ctx => _updateAreaGuard(ctx, entity));
  }

  /** Retreat — delegates to missionAI.ts */
  private updateRetreat(entity: Entity): void {
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
      const baseCount = 1 + (Math.random() < 0.4 ? 1 : 0);
      const count = Math.max(1, Math.round(baseCount * mods.waveSize));
      // Difficulty affects ant type composition: higher difficulty = more fire ants (ANT3)
      for (let i = 0; i < count; i++) {
        let aType: UnitType;
        const roll = Math.random();
        const remaining = 1 - mods.fireAntChance;
        if (roll < mods.fireAntChance) {
          aType = UnitType.ANT3; // fire ant (strongest)
        } else if (roll < mods.fireAntChance + remaining * 0.5) {
          aType = UnitType.ANT2; // warrior ant (50% of remaining)
        } else {
          aType = UnitType.ANT1; // soldier ant (50% of remaining)
        }
        const ox = (Math.random() - 0.5) * CELL_SIZE * 3;
        const oy = (Math.random() - 0.5) * CELL_SIZE * 3;
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
  }): void {
    this._runCombat(ctx => _handleUnitDeath(ctx, victim, opts));
  }

  private threatScore(scanner: Entity, target: Entity, dist: number): number {
    const isTargetAttackingAlly = !!(target.target && target.mission === Mission.ATTACK &&
      this.entitiesAllied(scanner, target.target));
    // A9: Closing speed — positive means target is approaching (approximated via prevPos)
    const prevDist = worldDist(scanner.pos, target.prevPos);
    const closingSpeed = prevDist - dist;
    // AI4: Designated enemy from AI house state (if any)
    const aiState = this.aiStates.get(scanner.house);
    const designatedEnemy = aiState?.designatedEnemy ?? null;
    // AI5: Area_Modify — count friendly buildings within 1 cell of target (C++ Rule.SupressRadius=1)
    // Only computed for scanners with splash weapons (proxy for C++ IsSupressed flag)
    let nearFriendlyCount = 0;
    if (scanner.weapon?.splash && scanner.weapon.splash > 0) {
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
    return computeThreatScore(scanner, target, dist, isTargetAttackingAlly, closingSpeed, designatedEnemy, nearFriendlyCount);
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

  private damageEntity(target: Entity, amount: number, warhead: WarheadType, attacker?: Entity): boolean {
    return this._runCombat(ctx => _damageEntity(ctx, target, amount, warhead, attacker));
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
   *  Speed values in UNIT_STATS are C++ MPH (leptons/tick); MPH_TO_PX converts to pixels/tick. */
  private movementSpeed(entity: Entity): number {
    return entity.stats.speed * MPH_TO_PX
      * this.map.getSpeedMultiplier(entity.cell.cx, entity.cell.cy, entity.stats.speedClass)
      * this.damageSpeedFactor(entity);
  }

  /** MV1: Follow one tick of track-table movement (C++ drive.cpp While_Moving).
   *  Steps through pre-computed track coordinates. Each step costs PIXEL_LEPTON_W leptons
   *  of movement budget. Position = targetCellCenter + Smooth_Turn(offset, flags).
   *  Returns true when track is complete (reached target cell center). */
  private followTrackStep(entity: Entity, speedPixels: number, targetX: number, targetY: number): boolean {
    const track = getTrackArray(entity.trackNumber);
    if (!track) {
      entity.trackNumber = -1;
      entity.trackCellSpan = 1;
      return true;
    }
    const flags = entity.trackFlags;

    // C++ drive.cpp:664: maxspeed * SpeedBias * House->GroundspeedBias
    const biasedSpeed = speedPixels * entity.speedBias * entity.groundspeedBias;

    // Convert pixel speed to lepton budget + accumulator (C++ SpeedAccum pattern)
    let actual = entity.speedAccum + (biasedSpeed / LP);

    while (actual > PIXEL_LEPTON_W) {
      actual -= PIXEL_LEPTON_W;

      if (entity.trackIndex >= track.length) {
        entity.pos.x = targetX;
        entity.pos.y = targetY;
        entity.trackNumber = -1;
        entity.trackIndex = 0;
        entity.speedAccum = 0; // C++ drive.cpp:792: actual=0 on track completion
        return true;
      }

      const step = track[entity.trackIndex];

      // End marker: offset (0,0) and trackIndex > 0 (C++ drive.cpp:712)
      if (step.x === 0 && step.y === 0 && entity.trackIndex > 0) {
        entity.pos.x = targetX;
        entity.pos.y = targetY;
        entity.trackNumber = -1;
        entity.trackIndex = 0;
        entity.speedAccum = 0; // C++ drive.cpp:792: actual=0 on track completion
        return true;
      }

      // Apply Smooth_Turn: transform offset with F_T/F_X/F_Y flags
      const result = smoothTurn(step.x, step.y, step.facing, flags);

      // Position = target cell center + transformed lepton offset (converted to pixels)
      entity.pos.x = targetX + result.x * LP;
      entity.pos.y = targetY + result.y * LP;

      // Update facing from transformed DirType → 32-step → 8-dir
      const dir32 = Math.floor(result.facing / 8);
      entity.bodyFacing32 = dir32;
      entity.facing = Math.floor(dir32 / 4) as Dir;

      entity.trackIndex++;
    }

    entity.speedAccum = actual; // carry remainder to next tick
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
    entity.moveToward({ x: retreatX, y: retreatY }, this.movementSpeed(entity));
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

  /** Trigger retaliation — delegates to combat.ts */
  private triggerRetaliation(victim: Entity, attacker: Entity): void {
    _triggerRetaliation(this._combatCtx, victim, attacker);
  }

  /** Launch a projectile — delegates to combat.ts */
  private launchProjectile(
    attacker: Entity, target: Entity | null, weapon: WeaponStats,
    damage: number, impactX: number, impactY: number, directHit: boolean,
  ): void {
    _launchProjectile(this._combatCtx, attacker, target, weapon, damage, impactX, impactY, directHit);
  }

  /** Advance in-flight projectiles — delegates to combat.ts */
  private updateInflightProjectiles(): void {
    this._runCombat(ctx => _updateInflightProjectiles(ctx));
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
      if (!entity.alive || !entity.isPlayerUnit) continue;
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
          trigger.triggeringEntityIds.push(entity.id); // C++ parity: track entities that triggered (for DESTROY_OBJECT)
          // For persistent triggers that have fired, reset so they can re-evaluate
          if (trigger.persistence === 2 && trigger.fired) {
            trigger.fired = false;
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

  /** Build trigger game state snapshot for event checks (uses precomputed shared state) */
  private buildTriggerState(trigger: ScenarioTrigger, shared: {
    structureTypes: Set<string>; destroyedTriggerNames: Set<string>;
    enemyUnitsAlive: number; playerFactories: number;
    houseAlive: Map<number, boolean>; houseUnitsAlive: Map<number, boolean>;
    houseBuildingsAlive: Map<number, boolean>; builtStructureTypes: Set<string>;
    buildingsDestroyedByHouse: Map<number, boolean>; fakesExist: boolean;
  }): TriggerGameState {
    return {
      gameTick: this.tick,
      globals: this.globals,
      triggerStartTick: trigger.timerTick,
      triggerName: trigger.name,
      playerEntered: trigger.playerEntered,
      enemyUnitsAlive: shared.enemyUnitsAlive,
      enemyKillCount: this.killCount,
      playerFactories: shared.playerFactories,
      missionTimerExpired: this.missionTimerExpired,
      bridgesAlive: this.bridgeCellCount,
      unitsLeftMap: this.unitsLeftMap,
      structureTypes: shared.structureTypes,
      destroyedTriggerNames: shared.destroyedTriggerNames,
      attackedTriggerNames: this.attackedTriggerNames,
      houseAlive: shared.houseAlive,
      houseUnitsAlive: shared.houseUnitsAlive,
      houseBuildingsAlive: shared.houseBuildingsAlive,
      builtStructureTypes: shared.builtStructureTypes,
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

  /** Evaluate whether a trigger's events are met based on eventControl mode */
  private checkTriggerEvents(trigger: ScenarioTrigger, state: TriggerGameState): boolean {
    const e1 = checkTriggerEvent(trigger.event1, state);
    const e2 = checkTriggerEvent(trigger.event2, state);
    switch (trigger.eventControl) {
      case 0: return e1;            // only event1
      case 1: return e1 && e2;      // AND
      case 2: return e1 || e2;      // OR
      default: return e1;
    }
  }

  /** Process trigger system — check conditions and fire actions */
  private processTriggers(): void {
    // Tick mission timer (processTriggers runs every 15 ticks, so decrement by 15)
    if (this.missionTimer > 0 && this.missionTimerRunning) {
      this.missionTimer -= 15;
      if (this.missionTimer <= 0) {
        this.missionTimerExpired = true;
      }
    }

    // Precompute shared state once for all triggers (avoids O(N*M) recomputation)
    const structureTypes = new Set<string>();
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
        }
        if (FAKE_TYPES.has(s.type)) fakesExist = true;
      } else if (s.triggerName) {
        destroyedTriggerNames.add(s.triggerName);
      }
    }
    let enemyUnitsAlive = 0;
    for (const e of this.entities) {
      if (e.alive && !this.isPlayerControlled(e) && !e.isCivilian) enemyUnitsAlive++;
      if (e.alive) {
        const hi = Game.HOUSE_TO_INDEX[e.house];
        if (hi !== undefined) {
          houseAlive.set(hi, true);
          houseUnitsAlive.set(hi, true);
        }
      } else if (e.triggerName) {
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
      buildingsDestroyedByHouse, fakesExist,
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
      // Volatile (0) and semi-persistent (1): skip once fired
      // Persistent (2): allowed to re-fire after timer reset
      if (trigger.fired && trigger.persistence <= 1) continue;

      // Force-fired triggers bypass event conditions
      let shouldFire = false;
      if (trigger.forceFirePending) {
        shouldFire = true;
        trigger.forceFirePending = false;
      } else {
        // Check event conditions
        const state = this.buildTriggerState(trigger, shared);
        shouldFire = this.checkTriggerEvents(trigger, state);
      }

      if (!shouldFire) continue;
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

      // Persistent triggers: reset timer so TIME events must elapse again
      if (trigger.persistence === 2) {
        trigger.timerTick = this.tick;
      }

      // Execute actions
      const executeAction = (action: typeof trigger.action1) => {
        // Skip team spawning if team was destroyed by DESTROY_TEAM
        if ((action.action === 4 || action.action === 7) && this.destroyedTeams.has(action.team)) return;
        const result = executeTriggerAction(
          action, this.teamTypes, this.waypoints, this.globals, this.triggers, trigger.house,
          this.houseEdges, { x: this.map.boundsX, y: this.map.boundsY, w: this.map.boundsW, h: this.map.boundsH }
        );
        // Handle side effects
        if (result.win && this.state === 'playing') {
          if (this.toCarryOver) saveCarryover(this.entities);
          this.state = 'won';
          this.audio.music.stop();
          this.audio.play('victory_fanfare');
          this.audio.play('eva_mission_accomplished');
          this.onStateChange?.('won');
        }
        if (result.lose && this.state === 'playing') {
          this.state = 'lost';
          this.audio.music.stop();
          this.audio.play('defeat_sting');
          this.onStateChange?.('lost');
        }
        if (result.allowWin) this.allowWin = true;
        if (result.allHunt) {
          // Set all enemy units to HUNT mission
          for (const e of this.entities) {
            if (e.alive && !this.isPlayerControlled(e)) {
              e.mission = Mission.HUNT;
            }
          }
        }
        if (result.revealAll) {
          this.map.revealAll();
        }
        // Reveal area around a specific waypoint (~10 cell radius)
        if (result.revealWaypoint !== undefined) {
          const wp = this.waypoints.get(result.revealWaypoint);
          if (wp) {
            this.revealAroundCell(wp.cx, wp.cy, 10);
          }
        }
        // Drop zone flare: reveal + visual marker + EVA announcement
        if (result.dropZone !== undefined) {
          const wp = this.waypoints.get(result.dropZone);
          if (wp) {
            this.revealAroundCell(wp.cx, wp.cy, 8);
            const world = { x: wp.cx * CELL_SIZE + CELL_SIZE / 2, y: wp.cy * CELL_SIZE + CELL_SIZE / 2 };
            this.effects.push({
              type: 'marker', x: world.x, y: world.y,
              frame: 0, maxFrames: 90, size: 6,
            });
            this.minimapAlert(wp.cx, wp.cy);
            this.audio.play('eva_reinforcements');
          }
        }
        // Creep shadow: reshroud entire map (SCA04EA tunnel darkness)
        if (result.creepShadow) {
          this.map.creepShadow();
        }
        if (result.textMessage !== undefined) {
          this.showEvaMessage(result.textMessage);
        }
        if (result.setTimer !== undefined) {
          this.missionTimer = result.setTimer * TIME_UNIT_TICKS;
          this.missionTimerExpired = false;
          this.missionTimerRunning = true; // SET_TIMER implicitly starts the timer
        }
        if (result.timerExtend !== undefined) {
          this.missionTimer += result.timerExtend * TIME_UNIT_TICKS;
          this.missionTimerExpired = false;
        }
        // Autocreate: enable AI auto-spawning (queen spawning + base rebuild)
        if (result.autocreate) this.autocreateEnabled = true;
        // Destroy team: mark team as destroyed, preventing future spawns
        if (result.destroyTeam !== undefined) this.destroyedTeams.add(result.destroyTeam);
        // Start/stop mission timer
        if (result.startTimer) this.missionTimerRunning = true;
        if (result.stopTimer) this.missionTimerRunning = false;
        // Subtract time from mission timer
        if (result.timerSubtract !== undefined) {
          this.missionTimer = Math.max(0, this.missionTimer - result.timerSubtract * TIME_UNIT_TICKS);
        }
        // Fire sale: sell all buildings of trigger house and set units to HUNT
        if (result.fireSale && trigger.house !== undefined) {
          const saleHouse = houseIdToHouse(trigger.house);
          for (const s of this.structures) {
            if (s.alive && s.house === saleHouse && s.sellProgress === undefined) {
              s.sellProgress = 0;
            }
          }
          for (const e of this.entities) {
            if (e.alive && e.house === saleHouse) e.mission = Mission.HUNT;
          }
        }
        // Reveal zone: reveal around waypoint with 15-cell radius
        if (result.revealZone !== undefined) {
          const wp = this.waypoints.get(result.revealZone);
          if (wp) this.revealAroundCell(wp.cx, wp.cy, 15);
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
        // Set AI preferred target
        if (result.preferredTarget !== undefined && trigger.house !== undefined) {
          const ptHouse = houseIdToHouse(trigger.house);
          const aiState = this.aiStates.get(ptHouse);
          if (aiState) aiState.preferredTarget = result.preferredTarget ?? null;
        }
        // Begin production: activate AI for the specified house
        // C++ parity: this trigger gates unit/structure production for AI houses
        if (result.beginProduction !== undefined) {
          const bpHouse = houseIdToHouse(result.beginProduction);
          if (!this.aiStates.has(bpHouse) && !this.isAllied(bpHouse, this.playerHouse)) {
            const newState = this.createAIHouseState(bpHouse);
            newState.productionEnabled = true;
            this.aiStates.set(bpHouse, newState);
          } else {
            const existingState = this.aiStates.get(bpHouse);
            if (existingState) existingState.productionEnabled = true;
          }
        }
        // Airstrike: explosion + damage at trigger waypoint
        if (result.airstrike) {
          const wp = this.waypoints.get(0);
          if (wp) {
            const wx = wp.cx * CELL_SIZE + CELL_SIZE / 2;
            const wy = wp.cy * CELL_SIZE + CELL_SIZE / 2;
            this.effects.push({ type: 'explosion', x: wx, y: wy, frame: 0, maxFrames: EXPLOSION_FRAMES['art-exp1'] ?? 22, size: 24, sprite: 'art-exp1', spriteStart: 0 });
            for (const e of this.entities) {
              if (!e.alive) continue;
              if (worldDist(e.pos, { x: wx, y: wy }) <= 4) this.damageEntity(e, 200, 'HE'); // worldDist returns cells
            }
            this.audio.play('explode_lg');
          }
        }
        // Nuke: massive explosion at map center
        if (result.nuke) {
          const cx = (this.map.boundsX + this.map.boundsW / 2) * CELL_SIZE;
          const cy = (this.map.boundsY + this.map.boundsH / 2) * CELL_SIZE;
          this.effects.push({ type: 'explosion', x: cx, y: cy, frame: 0, maxFrames: EXPLOSION_FRAMES['art-exp1'] ?? 22, size: 48, sprite: 'art-exp1', spriteStart: 0 });
          for (const e of this.entities) {
            if (!e.alive) continue;
            if (worldDist(e.pos, { x: cx, y: cy }) <= 8) this.damageEntity(e, 500, 'HE'); // worldDist returns cells
          }
        }
        // Center camera on waypoint
        if (result.centerView !== undefined) {
          const wp = this.waypoints.get(result.centerView);
          if (wp) {
            this.camera.centerOn(wp.cx * CELL_SIZE + CELL_SIZE / 2, wp.cy * CELL_SIZE + CELL_SIZE / 2);
          }
        }
        // Movie trigger — show as title card EVA message (FMVs not available)
        if (result.playMovie !== undefined) {
          this.showEvaMessage(-1, `[Movie: ${result.playMovie}]`);
        }
        // Play music track from trigger (PLAY_MUSIC action)
        if (result.playMusic !== undefined) {
          this.audio.music.next(); // advance to next track (theme ID is informational)
        }
        // Sound/speech from triggers
        if (result.playSpeech !== undefined) {
          this.handleTriggerSpeech(result.playSpeech);
        }
        if (result.playSound !== undefined) {
          this.handleTriggerSound(result.playSound);
        }
        // Apply per-scenario stat overrides to spawned entities
        if (result.spawned.length > 0) {
          applyScenarioOverrides(result.spawned, this.scenarioUnitStats, this.scenarioWeaponStats);
        }
        // Tag ant spawns with wave coordination
        const ants = result.spawned.filter(e => e.isAnt);
        if (ants.length > 1) {
          const wid = this.nextWaveId++;
          const rallyDelay = this.tick + GAME_TICKS_PER_SEC * 2; // 2-second rally
          for (const ant of ants) {
            ant.waveId = wid;
            ant.waveRallyTick = rallyDelay;
          }
        }
        for (const entity of result.spawned) {
          this.entities.push(entity);
          this.entityById.set(entity.id, entity);
          // Spawn flash effect for player reinforcements
          if (entity.isPlayerUnit) {
            this.effects.push({
              type: 'marker', x: entity.pos.x, y: entity.pos.y,
              frame: 0, maxFrames: 15, size: 14, markerColor: 'rgba(100,200,255,1)',
            });
          }
        }
        // Destroy the attached object (entity/structure with matching triggerName,
        // OR the triggering entity for cell triggers — C++ TACTION_DESTROY_OBJECT)
        if (result.destroyTriggeringUnit) {
          let destroyed = false;
          // First: kill ALL triggering entities (cell triggers accumulate IDs)
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
          // Fallback: destroy entities/structures with matching triggerName
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
      };

      executeAction(trigger.action1);
      if (trigger.actionControl === 1) {
        executeAction(trigger.action2);
      }

      // C++ Spring() parity: if multiple entities with this triggerName died
      // simultaneously, fire once per death (C++ calls Spring() per-entity).
      let extraFires = 8; // guard against infinite loops
      while (trigger.persistence === 2 && trigger.pendingDestroyedCount > 0 && extraFires-- > 0) {
        const reState = this.buildTriggerState(trigger, shared);
        if (!this.checkTriggerEvents(trigger, reState)) break;
        if (this.debugTriggers) {
          console.log(`[TRIGGER] ${trigger.name} re-fired (pending=${trigger.pendingDestroyedCount})`);
        }
        trigger.pendingDestroyedCount = Math.max(0, trigger.pendingDestroyedCount - 1);
        trigger.timerTick = this.tick;
        executeAction(trigger.action1);
        if (trigger.actionControl === 1) {
          executeAction(trigger.action2);
        }
      }
    }

    // Clear transient per-tick state
    this.attackedTriggerNames.clear();
  }

  /** Display an EVA text message (by trigger data ID) */
  private showEvaMessage(id: number, customText?: string): void {
    if (customText) {
      this.evaMessages.push({ text: customText, tick: this.tick });
      this.audio.play('eva_acknowledged');
      return;
    }
    // Map message IDs to text — from RA tutorial.txt / mission text strings
    const messages: Record<number, string> = {
      0: 'Scouts report movement in the area.',
      1: 'Reinforcements have arrived.',
      2: 'Mission objective complete.',
      3: 'Warning: enemy forces detected.',
      4: 'New objective received.',
      5: 'Base is under attack!',
      6: 'Civilians have been evacuated.',
      7: 'Bridge destroyed.',
      8: 'Power restored.',
      9: 'Drop zone established.',
      10: 'Construction options available.',
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
          this.spawnBaseReinforcements();
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

  /** Check win/lose conditions */
  private checkVictoryConditions(): void {
    if (this.state !== 'playing') return;
    if (this.tick < GAME_TICKS_PER_SEC * 3) return;

    const playerAlive = this.entities.some(e => e.alive && e.isPlayerUnit);

    // Loss: all player units dead
    if (!playerAlive) {
      this.state = 'lost';
      this.audio.music.stop();
      this.audio.play('defeat_sting');
      this.onStateChange?.('lost');
      return;
    }

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

    // If scenario uses ALLOWWIN, gate fallback win on the flag being set
    const hasAllowWinTrigger = this.triggers.some(t =>
      t.action1.action === 15 || (t.actionControl === 1 && t.action2.action === 15)
    );
    if (hasAllowWinTrigger && !this.allowWin) return;

    if (!antsAlive && !pendingAntTriggers && !antStructuresAlive) {
      if (this.toCarryOver) saveCarryover(this.entities);
      this.state = 'won';
      this.audio.music.stop();
      this.audio.play('victory_fanfare');
      this.audio.play('eva_mission_accomplished');
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
   *  C++ parity: HouseClass::Adjust_Capacity() — PROC provides 1000, SILO provides 1500.
   *  (C++ building.cpp Capacity(): PROC=1000, SILO=1500) */
  calculateSiloCapacity(): number {
    return _calculateSiloCapacity(this.structures, this.playerHouse, (a, b) => this.isAllied(a, b));
  }

  /** Recalculate silo capacity when storage changes.
   *  C++ parity: excess credits above new capacity are kept as cash (not lost).
   *  Credits only get capped by silo capacity on NEW harvester deposits, not on storage loss. */
  recalculateSiloCapacity(): void {
    this.siloCapacity = this.calculateSiloCapacity();
    // SI2 parity: excess credits above new capacity are refunded to cash, not lost.
    // Credits remain as-is — they just can't grow beyond the new cap from harvesting.
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
   *  In ant missions (SCA*), ant houses use special bias values instead of country bonuses. */
  getFirepowerBias(house: House): number {
    if (this.scenarioId.startsWith('SCA') && ANT_HOUSES.has(house)) {
      const ANT_BIAS: Record<string, number> = { USSR: 1.1, Ukraine: 1.0, Germany: 0.9 };
      return ANT_BIAS[house] ?? 1.0;
    }
    return COUNTRY_BONUSES[house]?.firepowerMult ?? 1.0;
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

  /** AI base rebuild — delegates to ai.ts */
  private updateBaseRebuild(): void {
    this._runAI(ctx => _updateBaseRebuild(ctx));
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

  /** Spawn an AI structure — delegates to ai.ts */
  private spawnAIStructure(type: string, house: House, cx: number, cy: number): void {
    _spawnAIStructure(this._aiCtx, type, house, cx, cy);
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
    ctx.fillRect(0, 14, w, 28);

    // Mission name
    ctx.textAlign = 'center';
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#FFD700';
    ctx.fillText(this.missionName.toUpperCase(), w / 2, 34);
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
    const lowPwr = this.powerConsumed > this.powerProduced && this.powerProduced > 0;
    this.renderer.hasRadar = this.hasBuilding('DOME') && !lowPwr;
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
      for (let dy = 0; dy < pfh; dy++) {
        for (let dx = 0; dx < pfw; dx++) {
          const passable = this.map.isPassable(cx + dx, cy + dy);
          cells.push(passable);
          if (!passable) valid = false;
        }
      }
      // Check adjacency — footprint-based AABB (expand existing structure by 1 cell, check overlap)
      let adj = false;
      for (const s of this.structures) {
        if (!s.alive || !this.isAllied(s.house, this.playerHouse)) continue;
        const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
        // Existing structure expanded by 1 cell in each direction
        const exL = s.cx - 1, exT = s.cy - 1, exR = s.cx + sw + 1, exB = s.cy + sh + 1;
        // New building footprint
        const nL = cx, nT = cy, nR = cx + pfw, nB = cy + pfh;
        // AABB overlap test
        if (nL < exR && nR > exL && nT < exB && nB > exT) { adj = true; break; }
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
      const structsBuilt = this.structures.filter(s => this.isAllied(s.house, this.playerHouse)).length;
      const structsLost = this.structures.filter(s => !s.alive && this.isAllied(s.house, this.playerHouse)).length;
      // Build survivors roster for victory screen
      const survivors = this.state === 'won'
        ? this.entities.filter(e => e.alive && e.isPlayerUnit).map(e => ({
            type: e.type, name: e.stats.name, hp: e.hp, maxHp: e.maxHp, kills: e.kills,
          }))
        : [];
      this.renderer.renderEndScreen(
        this.state === 'won',
        this.killCount,
        this.lossCount,
        this.tick,
        structsBuilt,
        structsLost,
        this.credits,
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


  // === Full AI — Strategic Opponent (delegates to ai.ts) ===

  /** Create initial AIHouseState for a house, applying difficulty modifiers */
  private createAIHouseState(house: House): AIHouseState {
    return _createAIHouseState(this._aiCtx, house);
  }

  /** AI strategic planner — phase transitions every 150 ticks (~10s) */
  private updateAIStrategicPlanner(): void {
    this._runAI(ctx => _updateAIStrategicPlanner(ctx));
  }

  /** AI base construction — build new structures from build queue */
  private updateAIConstruction(): void {
    this._runAI(ctx => _updateAIConstruction(ctx));
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
  private updateAIRetreat(): void {
    this._runAI(ctx => _updateAIRetreat(ctx));
  }

  /** AI auto-repair — IQ >= 3 houses repair damaged structures using their own credits */
  private updateAIRepair(): void {
    this._runAI(ctx => _updateAIRepair(ctx));
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
    if (spy.type !== UnitType.I_SPY || !spy.alive) return;

    const targetHouse = structure.house;
    // Must be enemy structure
    if (this.isAllied(targetHouse, this.playerHouse)) return;

    // SP1: C++ infantry.cpp:645-676 — spy reveals information, doesn't steal/destroy
    switch (structure.type) {
      case 'PROC':
        // SP1: Set spiedBy flag (lets spy's owner see enemy money) — no credit theft
        this.spiedHouses.add(targetHouse);
        this.evaMessages.push({ text: 'REFINERY INFILTRATED', tick: this.tick });
        break;
      case 'DOME':
        // SP2: Radar spied — share enemy's radar view (C++ share-radar), not full map reveal
        this.radarSpiedHouses.add(targetHouse);
        this.evaMessages.push({ text: 'RADAR INFILTRATED', tick: this.tick });
        break;
      case 'POWR':
      case 'APWR':
        // SP1: Set spiedBy flag only (no damage to power)
        this.spiedHouses.add(targetHouse);
        this.evaMessages.push({ text: 'POWER PLANT INFILTRATED', tick: this.tick });
        break;
      case 'SPEN': {
        // SP4: Activate sonar pulse — C++ infantry.cpp:664-670
        const spyHouse = spy.house;
        this.sonarSpiedTarget.set(spyHouse, targetHouse); // track for maintenance (house.cpp:1605)
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
          // If sonar already exists, make it ready immediately
          sonarState.ready = true;
          sonarState.chargeTick = SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks;
        }
        this.evaMessages.push({ text: 'SONAR PULSE ACQUIRED', tick: this.tick });
        break;
      }
      case 'WEAP':
      case 'TENT':
      case 'BARR':
        // SP1: Reveal production status
        this.productionSpiedHouses.add(targetHouse);
        this.evaMessages.push({ text: 'PRODUCTION INFILTRATED', tick: this.tick });
        break;
      default:
        this.evaMessages.push({ text: 'BUILDING INFILTRATED', tick: this.tick });
        break;
    }

    // Track spy infiltration for TEVENT_SPIED
    if (structure.triggerName) this.spiedBuildingTriggers.add(structure.triggerName);

    // Spy is consumed on infiltration
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
  mines: Array<{ cx: number; cy: number; house: House; damage: number }> = [];

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
  static readonly MAD_TANK_DAMAGE = _MAD_TANK_DAMAGE;
  static readonly MAD_TANK_RADIUS = _MAD_TANK_RADIUS;

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

  // FORMATION MOVEMENT: Units can move in formation (CHANGE_FORMATION team mission).
  // Not used by any ant mission TeamTypes. Units move individually instead.
  // STUB: If a CHANGE_FORMATION team mission is encountered, it's skipped.
  // (Already handled: scenario.ts TMISSION index 2 is commented "unused")

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
