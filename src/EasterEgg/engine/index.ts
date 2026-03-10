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
import { TRACKS, selectTrack, usesTrackMovement, rotateTrackOffset } from './tracks';
import {
  loadScenario, applyScenarioOverrides,
  type TeamType, type ScenarioTrigger, type MapStructure,
  type TriggerGameState, type TriggerActionResult,
  checkTriggerEvent, executeTriggerAction, houseIdToHouse, STRUCTURE_WEAPONS, STRUCTURE_SIZE, STRUCTURE_MAX_HP, STRUCTURE_POWERED,
  saveCarryover, TIME_UNIT_TICKS,
} from './scenario';
export { MISSIONS, getMission, getMissionIndex, loadProgress, saveProgress } from './scenario';
export { CAMPAIGNS, getCampaign, loadCampaignProgress, saveCampaignProgress, checkMissionExists, loadMissionBriefings, getMissionBriefing } from './scenario';
export type { MissionInfo, CampaignId, CampaignDef, CampaignMission } from './scenario';
export { AudioManager } from './audio';
export { preloadAssets } from './assets';
export { getMissionMovies, hasFMV, getMovieUrl, CAMPAIGN_END_MOVIES } from './movies';
export { MoviePlayer } from './moviePlayer';

export type { SuperweaponState } from './types';

export type GameState = 'loading' | 'playing' | 'won' | 'lost' | 'paused';
export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

/** Difficulty modifiers for queen spawn rate and ant composition */
const DIFFICULTY_MODS: Record<Difficulty, { spawnInterval: number; maxAnts: number; fireAntChance: number; waveSize: number }> = {
  easy:   { spawnInterval: 45, maxAnts: 15, fireAntChance: 0.15, waveSize: 0.7 },
  normal: { spawnInterval: 30, maxAnts: 20, fireAntChance: 0.33, waveSize: 1.0 },
  hard:   { spawnInterval: 20, maxAnts: 28, fireAntChance: 0.50, waveSize: 1.3 },
};

/** Defensive structure types that ants prioritize attacking */
const ANT_TARGET_DEFENSE_TYPES = new Set(['HBOX', 'PBOX', 'GUN', 'TSLA', 'SAM', 'AGUN', 'FTUR']);

/** Wall structure types that use 1x1 placement mode */
const WALL_TYPES = new Set(['SBAG', 'FENC', 'BARB', 'BRIK']);

/** AI house strategic state — drives decision-making for non-player houses */
interface AIHouseState {
  house: House;
  phase: 'economy' | 'buildup' | 'attack';
  // Production gate — in campaign missions, AI only produces after BEGIN_PRODUCTION trigger
  productionEnabled: boolean;
  // Build order
  buildQueue: string[];
  lastBuildTick: number;
  buildCooldown: number;       // ticks between build attempts
  // Attack groups
  attackPool: Set<number>;     // entity IDs staging for attack
  attackThreshold: number;     // units needed before launching
  lastAttackTick: number;
  attackCooldownTicks: number; // min ticks between attacks
  // Economy cache
  harvesterCount: number;
  refineryCount: number;
  // Defense
  lastBaseAttackTick: number;
  underAttack: boolean;
  // Difficulty modifiers
  incomeMult: number;
  buildSpeedMult: number;
  aggressionMult: number;
  // AI4: Designated enemy house — gets massive threat bonus in targeting
  designatedEnemy: House | null;
  // AI preferred target structure type index (set by TACTION_PREFERRED_TARGET)
  preferredTarget: number | null;
  // C++ IQ system: gates AI behaviors (0=no AI, 1=build only, 2=+attack/defense, 3=+retreat)
  iq: number;
  // C++ TechLevel: gates which production items are available
  techLevel: number;
  // C++ unit caps: -1 = unlimited
  maxUnit: number;       // max vehicle units
  maxInfantry: number;   // max infantry units
  maxBuilding: number;   // max buildings
}

/** AI difficulty modifiers — scale economy, build speed, and aggression */
const AI_DIFFICULTY_MODS: Record<Difficulty, {
  incomeMult: number;
  buildSpeedMult: number;
  attackThreshold: number;
  attackCooldown: number;
  productionInterval: number;
  aggressionMult: number;
  retreatHpPercent: number;
}> = {
  easy:   { incomeMult: 0.7, buildSpeedMult: 1.5, attackThreshold: 8,  attackCooldown: 900,  productionInterval: 90, aggressionMult: 0.6, retreatHpPercent: 0.30 },
  normal: { incomeMult: 1.0, buildSpeedMult: 1.0, attackThreshold: 6,  attackCooldown: 600,  productionInterval: 60, aggressionMult: 1.0, retreatHpPercent: 0.25 },
  hard:   { incomeMult: 1.5, buildSpeedMult: 0.7, attackThreshold: 4,  attackCooldown: 400,  productionInterval: 42, aggressionMult: 1.4, retreatHpPercent: 0.15 },
};

/** Structure type → sprite image name mapping (shared by base rebuild and AI construction) */
const STRUCTURE_IMAGES: Record<string, string> = {
  FACT: 'fact', POWR: 'powr', APWR: 'apwr', BARR: 'barr', TENT: 'tent',
  WEAP: 'weap', PROC: 'proc', SILO: 'silo', DOME: 'dome', FIX: 'fix',
  GUN: 'gun', SAM: 'sam', HBOX: 'hbox', TSLA: 'tsla', AGUN: 'agun',
  GAP: 'gap', PBOX: 'pbox', HPAD: 'hpad', AFLD: 'afld',
  ATEK: 'atek', STEK: 'stek', IRON: 'iron', PDOX: 'pdox', KENN: 'kenn',
  QUEE: 'quee', LAR1: 'lar1', LAR2: 'lar2',
};

/** Crate bonus types */
type CrateType = 'money' | 'heal' | 'unit' | 'armor' | 'firepower' | 'speed' | 'reveal' | 'darkness' | 'explosion' | 'squad' | 'heal_base' | 'napalm' | 'cloak' | 'invulnerability' | 'parabomb' | 'sonar' | 'icbm' | 'timequake' | 'vortex';
interface Crate {
  x: number;
  y: number;
  type: CrateType;
  tick: number; // tick when spawned
  lifetime: number; // CR6: ticks until expiry
}

/** In-flight projectile for deferred damage */
interface InflightProjectile {
  attackerId: number;
  targetId: number;
  weapon: WeaponStats;
  damage: number;
  speed: number;         // cells per tick
  travelFrames: number;  // total frames to travel
  currentFrame: number;
  directHit: boolean;    // was the shot accurate (for inaccurate weapons)
  impactX: number;       // final impact position (may be scattered)
  impactY: number;
  attackerIsPlayer: boolean;
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
    // (C++ reveals all cells the camera can see on mission load)
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

    // Crate spawning (every 60-90 seconds, max 3 on map)
    if (this.tick >= this.nextCrateTick && this.crates.length < 3) {
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

    // RP3: Repair structures (C++ rules.cpp:228-229 RepairStep, RepairPercent) — 14 tick interval
    if (this.tick % 14 === 0) {
      for (const idx of this.repairingStructures) {
        const s = this.structures[idx];
        if (!s || !s.alive || s.hp >= s.maxHp || s.sellProgress !== undefined) {
          this.repairingStructures.delete(idx);
          continue;
        }
        const prodItem = this.scenarioProductionItems.find(p => p.type === s.type);
        const repairCostPerStep = prodItem ? Math.ceil((prodItem.cost * REPAIR_PERCENT) / (s.maxHp / REPAIR_STEP)) : 1;
        if (this.credits < repairCostPerStep) {
          // RP5: cancel repair on insufficient funds (C++ parity — player must re-initiate)
          this.repairingStructures.delete(idx);
          this.playEva('eva_insufficient_funds');
          continue;
        }
        this.credits -= repairCostPerStep;
        s.hp = Math.min(s.maxHp, s.hp + REPAIR_STEP);
        this.audio.play('repair');
      }
    }

    // Queen Ant self-healing (SelfHealing=yes in INI): +1 HP every 60 ticks (~4 seconds)
    // C++ building.cpp SelfHealing — same rate as other self-healing buildings (once per slow cycle)
    if (this.tick % 60 === 0) {
      for (const s of this.structures) {
        if (s.alive && s.type === 'QUEE' && s.hp < s.maxHp) {
          s.hp = Math.min(s.maxHp, s.hp + 1);
        }
      }
    }

    // Service Depot (FIX): dock-based repair + rearm — one vehicle at a time, costs credits
    // C++ parity: repair tick interval ~14 ticks (matches building self-repair rate).
    // REPAIR_STEP (7 HP) per tick stays the same; only interval changed from 3 to 14.
    if (this.tick % 14 === 0) {
      for (const s of this.structures) {
        if (!s.alive || s.type !== 'FIX') continue;
        if (!this.isAllied(s.house, this.playerHouse)) continue;
        const sx = s.cx * CELL_SIZE + CELL_SIZE;
        const sy = s.cy * CELL_SIZE + CELL_SIZE;
        // Find ONE docked vehicle (closest damaged OR depleted vehicle within 1 cell of depot center)
        let docked: Entity | null = null;
        let bestDist = Infinity;
        for (const e of this.entities) {
          if (!e.alive || !this.isPlayerControlled(e)) continue;
          if (e.stats.isInfantry) continue; // depot only services vehicles
          const needsRepair = e.hp < e.maxHp;
          const needsRearm = e.maxAmmo > 0 && e.ammo < e.maxAmmo;
          if (!needsRepair && !needsRearm) continue;
          const dist = worldDist({ x: sx, y: sy }, e.pos);
          if (dist < 1.5 && dist < bestDist) { // worldDist returns cells
            docked = e;
            bestDist = dist;
          }
        }
        if (docked) {
          const needsRepair = docked.hp < docked.maxHp;
          if (needsRepair) {
            // Repair cost per step: same formula as building repair
            const unitCost = this.scenarioProductionItems.find(p => p.type === docked!.type)?.cost ?? 400;
            const repairCost = Math.ceil((unitCost * REPAIR_PERCENT) / (docked.maxHp / REPAIR_STEP));
            if (this.credits >= repairCost) {
              this.credits -= repairCost;
              docked.hp = Math.min(docked.maxHp, docked.hp + REPAIR_STEP);
              // Visual spark effect on each repair tick
              this.effects.push({
                type: 'muzzle', x: docked.pos.x, y: docked.pos.y - 4,
                frame: 0, maxFrames: EXPLOSION_FRAMES['piff'] ?? 4, size: 3, sprite: 'piff', spriteStart: 0,
              });
            } else {
              // C++ parity: cancel repair when insufficient funds (player must re-initiate)
              // Eject unit from depot pad so it won't be auto-repaired next tick
              docked.mission = Mission.GUARD;
              docked.moveTarget = {
                x: docked.pos.x + CELL_SIZE * 3,
                y: docked.pos.y + CELL_SIZE * 3,
              };
            }
          }
          // C++ parity: service depot reloads ammo (ReloadRate=.04 min = 36 ticks per ammo)
          // Rearm happens alongside repair, free of charge
          if (docked.maxAmmo > 0 && docked.ammo < docked.maxAmmo) {
            docked.rearmTimer = (docked.rearmTimer ?? 0) - 1;
            if (docked.rearmTimer <= 0) {
              docked.ammo++;
              docked.rearmTimer = 36; // C++ ReloadRate=.04 min → 0.04 × 60 × 15 = 36 ticks
            }
          }
        }
      }
    }

    // Defensive structure auto-fire
    this.updateStructureCombat();

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

  /** Update fog of war based on player unit and structure positions.
   *  C++ TechnoClass::Sight_Range (techno.cpp): sight is reduced to 1 cell
   *  when HP drops below ConditionRed (25% HP) — damaged sensors/optics. */
  private updateFogOfWar(): void {
    if (this.fogDisabled) {
      this.map.revealAll();
      return;
    }
    const units: Array<{x: number; y: number; sight: number}> = [];
    // Player units — apply damaged sight reduction (C++ TechnoClass::Sight_Range)
    for (const e of this.entities) {
      if (e.alive && e.isPlayerUnit) {
        const sight = (e.hp / e.maxHp) < CONDITION_RED ? 1 : e.stats.sight;
        units.push({ x: e.pos.x, y: e.pos.y, sight });
      }
    }
    // Player structures (defense buildings get 7, others get 5)
    // Also apply damaged sight reduction when HP < ConditionRed
    const DEFENSE_TYPES = new Set(['HBOX', 'GUN', 'TSLA', 'SAM', 'PBOX', 'GAP', 'AGUN']);
    for (const s of this.structures) {
      if (s.alive && this.isAllied(s.house, this.playerHouse)) {
        const baseSight = DEFENSE_TYPES.has(s.type) ? 7 : 5;
        const sight = (s.hp / s.maxHp) < CONDITION_RED ? 1 : baseSight;
        const wx = s.cx * CELL_SIZE + CELL_SIZE / 2;
        const wy = s.cy * CELL_SIZE + CELL_SIZE / 2;
        units.push({ x: wx, y: wy, sight });
      }
    }
    this.map.updateFogOfWar(units);

    // Destroyer sub detection — anti-sub units reveal cloaked subs within sight range
    this.updateSubDetection();
  }

  /** Destroyers (isAntiSub) detect and force-reveal cloaked subs within sight range */
  private updateSubDetection(): void {
    for (const dd of this.entities) {
      if (!dd.alive || !dd.stats.isAntiSub) continue;
      const sight = dd.stats.sight;
      for (const sub of this.entities) {
        if (!sub.alive || !sub.stats.isCloakable) continue;
        if (this.entitiesAllied(dd, sub)) continue;
        if (sub.cloakState !== CloakState.CLOAKED && sub.cloakState !== CloakState.CLOAKING) continue;
        const dist = worldDist(dd.pos, sub.pos);
        if (dist <= sight) {
          // Force uncloak and set sonar pulse timer to prevent recloak
          sub.sonarPulseTimer = SONAR_PULSE_DURATION;
          if (sub.cloakState === CloakState.CLOAKED || sub.cloakState === CloakState.CLOAKING) {
            sub.cloakState = CloakState.UNCLOAKING;
            sub.cloakTimer = CLOAK_TRANSITION_FRAMES;
          }
        }
      }
    }
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
    if (!s.alive) return false;
    s.hp = Math.max(0, s.hp - damage);
    // Track attacked trigger names for TEVENT_ATTACKED
    if (s.triggerName) this.attackedTriggerNames.add(s.triggerName);
    // Record base attack for AI defense system
    const aiState = this.aiStates.get(s.house);
    if (aiState) {
      aiState.lastBaseAttackTick = this.tick;
      aiState.underAttack = true;
    }
    // EVA "base under attack" for player structures (throttled)
    if (this.isAllied(s.house, this.playerHouse) &&
        this.tick - this.lastBaseAttackEva > GAME_TICKS_PER_SEC * 5) {
      this.lastBaseAttackEva = this.tick;
      this.audio.play('eva_base_attack');
      this.minimapAlert(s.cx, s.cy);
    }
    if (s.hp <= 0) {
      s.alive = false;
      s.rubble = true;
      // GAP1: unjam shroud when Gap Generator is destroyed
      if (s.type === 'GAP') {
        const si = this.structures.indexOf(s);
        if (si >= 0 && this.gapGeneratorCells.has(si)) {
          const prev = this.gapGeneratorCells.get(si)!;
          this.map.unjamRadius(prev.cx, prev.cy, prev.radius);
          this.gapGeneratorCells.delete(si);
        }
      }
      // Track enemy building destruction count (excluding walls)
      if (!this.isAllied(s.house, this.playerHouse) && !WALL_TYPES.has(s.type)) {
        this.nBuildingsDestroyedCount++;
      }
      // Clear terrain footprint so units can walk through rubble
      this.clearStructureFootprint(s);
      // Spawn destruction explosion chain — small pops then big blast (like original RA)
      const wx = s.cx * CELL_SIZE + CELL_SIZE;
      const wy = s.cy * CELL_SIZE + CELL_SIZE;
      const [fw, fh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
      // Small pre-explosions scattered across the building footprint (scale with building size)
      const numPreExplosions = Math.max(3, Math.min(6, fw * fh));
      for (let i = 0; i < numPreExplosions; i++) {
        const ox = (Math.random() - 0.5) * fw * CELL_SIZE;
        const oy = (Math.random() - 0.5) * fh * CELL_SIZE;
        this.effects.push({
          type: 'explosion', x: wx + ox, y: wy + oy,
          frame: -i * 3, maxFrames: 12, size: 8, // staggered start via negative frame
          sprite: 'veh-hit1', spriteStart: 0,
        });
      }
      // Final large explosion — size-matched to building footprint (C++ parity)
      const maxDimPx = Math.max(fw, fh) * CELL_SIZE;
      const deathExplosionRadius = Math.round(maxDimPx * 0.6);
      this.effects.push({
        type: 'explosion', x: wx, y: wy,
        frame: 0, maxFrames: EXPLOSION_FRAMES['fball1'] ?? 18, size: deathExplosionRadius,
        sprite: 'fball1', spriteStart: 0,
      });
      // Flying debris
      this.effects.push({
        type: 'debris', x: wx, y: wy,
        frame: 0, maxFrames: 20, size: fw * CELL_SIZE * 0.8,
      });
      // Screen shake proportional to building size (1x1=8, 2x2=12, 3x3=16)
      const shakeIntensity = Math.min(20, 4 + Math.max(fw, fh) * 4);
      this.renderer.screenShake = Math.max(this.renderer.screenShake, shakeIntensity);
      this.renderer.screenFlash = Math.max(this.renderer.screenFlash, Math.min(8, fw * 2));
      this.playSoundAt('building_explode', wx, wy);
      if (this.isAllied(s.house, this.playerHouse)) {
        this.structuresLost++;
        this.playEva('eva_unit_lost'); // reuse unit_lost for building destruction
        // C++ parity: recalculate silo capacity when storage structure destroyed
        if (s.type === 'PROC' || s.type === 'SILO') {
          this.recalculateSiloCapacity();
        }
      }
      // Structure explosion damages nearby units (2-cell radius, ~100 base damage)
      const blastRadius = 2;
      for (const e of this.entities) {
        if (!e.alive) continue;
        const dist = worldDist({ x: wx, y: wy }, e.pos);
        if (dist > blastRadius) continue;
        const falloff = 1 - (dist / blastRadius) * 0.6;
        const blastDmg = Math.max(1, Math.round(100 * falloff));
        this.damageEntity(e, blastDmg, 'HE');
      }
      // Leave large scorch mark
      this.map.addDecal(s.cx, s.cy, 14, 0.6);
      // Bridge destruction: convert nearby bridge template cells to water
      if (s.type === 'BARL' || s.type === 'BRL3') {
        this.map.destroyBridge(s.cx, s.cy, 3);
        this.bridgeCellCount = this.map.countBridgeCells();
        this.showEvaMessage(7); // "Bridge destroyed."
      }
      return true;
    }
    return false;
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
    if (entity.isAirUnit && this.updateAircraft(entity)) {
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
      this.updateHarvester(entity);
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
          entity.path = findPath(this.map, entity.cell, { cx: wp.cx, cy: wp.cy }, true, entity.isNavalUnit, entity.stats.speedClass);
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
   *  Infantry and ants are crushable; vehicles are not. The crusher does NOT stop — it drives through. */
  private checkVehicleCrush(vehicle: Entity): void {
    const vc = vehicle.cell;
    for (const other of this.entities) {
      if (!other.alive || other.id === vehicle.id) continue;
      if (!other.stats.crushable) continue; // only crushable targets (infantry, ants)
      // C++ drive.cpp: RA1 crushes ALL crushable units including allies (no friendly immunity)
      const oc = other.cell;
      if (oc.cx === vc.cx && oc.cy === vc.cy) {
        this.damageEntity(other, other.hp + 10, 'Super'); // instant kill, always die2
        vehicle.creditKill();
        this.effects.push({
          type: 'blood', x: other.pos.x, y: other.pos.y,
          frame: 0, maxFrames: 6, size: 4, sprite: 'piffpiff', spriteStart: 0,
        });
        // Use appropriate death sound based on unit type
        const crushSound = other.isAnt ? 'die_ant' : 'die_infantry';
        this.playSoundAt(crushSound, other.pos.x, other.pos.y);
        this.map.addDecal(oc.cx, oc.cy, 3, 0.3);
        if (this.isPlayerControlled(vehicle)) this.killCount++;
        else {
          this.lossCount++;
          this.playEva('eva_unit_lost');
          const alertCell = other.cell;
          this.minimapAlert(alertCell.cx, alertCell.cy);
        }
      }
    }
  }

  /** Check if a mission represents an idle/guard state (GUARD or AREA_GUARD) */
  private isIdleMission(mission: Mission): boolean {
    return mission === Mission.GUARD || mission === Mission.AREA_GUARD;
  }

  /** Harvester AI — seek ore, harvest, return to refinery, unload */
  private updateHarvester(entity: Entity): void {
    switch (entity.harvesterState) {
      case 'idle': {
        // Only start auto-harvest from idle mission (GUARD/AREA_GUARD), not during manual MOVE
        if (!this.isIdleMission(entity.mission)) break;
        // Find nearest ore cell — AI harvesters spread to avoid clustering
        const ec = entity.cell;
        const oreCell = this.findHarvesterOre(entity, ec.cx, ec.cy, 30);
        if (oreCell) {
          entity.harvesterState = 'seeking';
          entity.mission = Mission.MOVE;
          entity.moveTarget = { x: oreCell.cx * CELL_SIZE + CELL_SIZE / 2, y: oreCell.cy * CELL_SIZE + CELL_SIZE / 2 };
          entity.path = findPath(this.map, ec, oreCell, true);
          entity.pathIndex = 0;
        }
        break;
      }
      case 'seeking': {
        // Check if we've arrived at ore
        const ec = entity.cell;
        const ovl = this.map.overlay[ec.cy * MAP_CELLS + ec.cx];
        if (ovl >= 0x03 && ovl <= 0x12) {
          entity.harvesterState = 'harvesting';
          entity.harvestTick = 0;
          entity.mission = Mission.GUARD;
          entity.animState = AnimState.IDLE;
        } else if (this.isIdleMission(entity.mission)) {
          // Arrived (move completed → GUARD/AREA_GUARD) but no ore here — re-seek
          entity.harvesterState = 'idle';
        } else if (entity.mission === Mission.MOVE && entity.path.length === 0 && entity.pathIndex >= 0) {
          // Path exhausted or failed but still in MOVE — stuck seeking.
          // Use harvestTick as a timeout counter (30 ticks = 2s grace).
          entity.harvestTick++;
          if (entity.harvestTick > 30) {
            entity.harvesterState = entity.oreLoad > 0 ? 'returning' : 'idle';
            entity.mission = Mission.GUARD;
            entity.harvestTick = 0;
          }
        }
        break;
      }
      case 'harvesting': {
        entity.harvestTick++;
        // Harvest every 10 ticks (~0.67s)
        if (entity.harvestTick % 10 === 0) {
          const ec = entity.cell;
          const bailCredits = this.map.depleteOre(ec.cx, ec.cy);
          if (bailCredits > 0) {
            // EC3: bail-based capacity — track bail count, not credit amount
            entity.oreLoad += 1;
            entity.oreCreditValue += bailCredits;
            // EC4: gem bonus bails — C++ unit.cpp:2306-2308, 2 extra bails per gem harvest
            if (bailCredits >= 110) {
              entity.oreLoad += 2;
              entity.oreCreditValue += 220; // 2 bonus bails × 110 credits
            }
          }
          // Check if full or current cell depleted
          if (entity.oreLoad >= Entity.BAIL_COUNT) {
            entity.harvesterState = 'returning';
          } else if (bailCredits === 0) {
            // No more ore at this cell — look for adjacent ore
            const newOre = this.map.findNearestOre(ec.cx, ec.cy, 20);
            if (newOre && entity.oreLoad < Entity.BAIL_COUNT) {
              entity.harvesterState = 'seeking';
              entity.mission = Mission.MOVE;
              entity.moveTarget = { x: newOre.cx * CELL_SIZE + CELL_SIZE / 2, y: newOre.cy * CELL_SIZE + CELL_SIZE / 2 };
              entity.path = findPath(this.map, ec, newOre, true);
              entity.pathIndex = 0;
            } else {
              // No more ore nearby — return with whatever we have
              entity.harvesterState = entity.oreLoad > 0 ? 'returning' : 'idle';
            }
          }
        }
        break;
      }
      case 'returning': {
        // Pathfinding timeout: if stuck in MOVE with empty path, fall back to idle after 45 ticks (3s)
        if (entity.mission === Mission.MOVE && entity.path.length === 0 && entity.pathIndex >= 0) {
          entity.harvestTick++;
          if (entity.harvestTick > 45) {
            entity.harvesterState = 'idle';
            entity.mission = Mission.GUARD;
            entity.harvestTick = 0;
          }
          break;
        }
        // When move completes (mission returns to GUARD/AREA_GUARD), transition to unloading or re-seek
        if (!this.isIdleMission(entity.mission)) break; // still moving, wait
        // Check if we're near a refinery
        const ec = entity.cell;
        let bestProc: MapStructure | null = null;
        let bestDist = Infinity;
        for (const s of this.structures) {
          if (!s.alive || s.type !== 'PROC') continue;
          if (!this.isAllied(s.house, entity.house)) continue;
          const dx = s.cx - ec.cx;
          const dy = s.cy - ec.cy;
          const dist = dx * dx + dy * dy;
          if (dist < bestDist) { bestDist = dist; bestProc = s; }
        }
        if (!bestProc) {
          // No refinery — idle with ore
          entity.harvesterState = 'idle';
          break;
        }
        // Check if we're adjacent to refinery footprint (distance to nearest edge ≤ 1)
        const [procW, procH] = STRUCTURE_SIZE[bestProc.type] ?? [3, 2];
        const nearX = Math.max(bestProc.cx, Math.min(ec.cx, bestProc.cx + procW - 1));
        const nearY = Math.max(bestProc.cy, Math.min(ec.cy, bestProc.cy + procH - 1));
        const edgeDist = Math.abs(nearX - ec.cx) + Math.abs(nearY - ec.cy);
        if (edgeDist <= 1) {
          // Arrived at refinery — start unloading
          entity.harvesterState = 'unloading';
          entity.harvestTick = 0;
        } else {
          // Not there yet — move to dock cell below refinery entrance (C++ behavior)
          const target = { cx: bestProc.cx + 1, cy: bestProc.cy + procH };
          entity.mission = Mission.MOVE;
          entity.moveTarget = { x: target.cx * CELL_SIZE + CELL_SIZE / 2, y: target.cy * CELL_SIZE + CELL_SIZE / 2 };
          entity.path = findPath(this.map, ec, target, true);
          entity.pathIndex = 0;
          entity.harvestTick = 0;
        }
        break;
      }
      case 'unloading': {
        // EC5: lump-sum unload after 14-tick dump animation (C++ parity)
        entity.harvestTick++;
        // Credit sound every 5 ticks during dump animation
        if (entity.harvestTick % 5 === 0 && this.isPlayerControlled(entity)) {
          this.audio.play('heal');
        }
        if (entity.harvestTick >= 14) {
          // Dump all credits at once after animation completes
          const totalCredits = entity.oreCreditValue;
          if (totalCredits > 0) {
            if (this.isPlayerControlled(entity)) {
              this.addCredits(totalCredits);
            } else {
              // AI harvester — deposit into houseCredits
              const cur = this.houseCredits.get(entity.house) ?? 0;
              this.houseCredits.set(entity.house, cur + totalCredits);
            }
          }
          entity.oreLoad = 0;
          entity.oreCreditValue = 0;
          entity.harvesterState = 'idle';
          entity.harvestTick = 0;
        }
        break;
      }
    }
  }

  /** Find nearest ore for a harvester, with spread logic for AI harvesters.
   *  C++ parity: AI harvesters avoid ore cells that another friendly harvester is already targeting,
   *  preventing all AI harvesters from clustering on the same ore patch. */
  private findHarvesterOre(entity: Entity, cx: number, cy: number, maxRange: number): { cx: number; cy: number } | null {
    // Player harvesters use simple nearest-ore (no spreading needed — player manages them)
    if (this.isPlayerControlled(entity)) {
      return this.map.findNearestOre(cx, cy, maxRange);
    }

    // Build set of cells targeted by other friendly harvesters (within 2-cell radius counts as same patch)
    const friendlyTargets: { cx: number; cy: number }[] = [];
    for (const other of this.entities) {
      if (other === entity || !other.alive || other.house !== entity.house) continue;
      if (other.type !== UnitType.V_HARV) continue;
      if (other.moveTarget) {
        friendlyTargets.push({
          cx: Math.floor(other.moveTarget.x / CELL_SIZE),
          cy: Math.floor(other.moveTarget.y / CELL_SIZE),
        });
      } else if (other.harvesterState === 'harvesting') {
        friendlyTargets.push(other.cell);
      }
    }

    // Search for nearest ore that isn't within 3 cells of another harvester's target
    let bestDist = Infinity;
    let best: { cx: number; cy: number } | null = null;
    const r = maxRange;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const rx = cx + dx;
        const ry = cy + dy;
        if (rx < 0 || rx >= MAP_CELLS || ry < 0 || ry >= MAP_CELLS) continue;
        const ovl = this.map.overlay[ry * MAP_CELLS + rx];
        if (ovl < 0x03 || ovl > 0x12) continue; // not ore
        const dist = dx * dx + dy * dy;
        if (dist >= bestDist) continue;

        // Check if another friendly harvester is already targeting nearby
        let isTargeted = false;
        for (const ft of friendlyTargets) {
          const tdx = Math.abs(ft.cx - rx);
          const tdy = Math.abs(ft.cy - ry);
          if (tdx <= 3 && tdy <= 3) { isTargeted = true; break; }
        }
        if (isTargeted) continue;

        bestDist = dist;
        best = { cx: rx, cy: ry };
      }
    }

    // Fallback: if all ore is targeted, just use nearest ore (better than doing nothing)
    if (!best) {
      return this.map.findNearestOre(cx, cy, maxRange);
    }
    return best;
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
          entity.mission = this.idleMission(entity);
          entity.animState = AnimState.IDLE;
          return;
        }
        entity.path = newPath;
        entity.pathIndex = 0;
        entity.trackNumber = -1; // MV1: reset track on repath
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
        }
      }
      const target: WorldPos = {
        x: nextCell.cx * CELL_SIZE + CELL_SIZE / 2,
        y: nextCell.cy * CELL_SIZE + CELL_SIZE / 2,
      };
      const speed = this.movementSpeed(entity);
      // MV1: Track-table movement for vehicles (C++ drive.cpp smooth turning)
      if (entity.trackNumber >= 0) {
        // Currently following a track — advance along it
        if (this.followTrackStep(entity, speed)) {
          // Track complete — snap to cell center and advance path
          entity.pos.x = target.x;
          entity.pos.y = target.y;
          entity.pathIndex++;
        }
      } else if (usesTrackMovement(entity.stats.speedClass, !!entity.stats.isInfantry, !!entity.stats.isAircraft)) {
        // Initiate a new track for this cell-to-cell segment
        const dirToTarget = directionTo(entity.pos, target);
        const desiredFacing32 = dirToTarget * 4;
        const currentFacing32 = entity.bodyFacing32;
        entity.trackNumber = selectTrack(currentFacing32, desiredFacing32);
        entity.trackIndex = 0;
        entity.trackStartX = entity.pos.x;
        entity.trackStartY = entity.pos.y;
        entity.trackBaseFacing = currentFacing32;
        // Follow first step this tick
        if (this.followTrackStep(entity, speed)) {
          entity.pos.x = target.x;
          entity.pos.y = target.y;
          entity.pathIndex++;
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
    // Demo Truck kamikaze — intercepts normal attack to drive-and-explode
    if (entity.type === UnitType.V_DTRK) {
      this.updateDemoTruck(entity);
      return;
    }

    // Handle structure targets
    if (entity.targetStructure) {
      if (!entity.targetStructure.alive) {
        entity.targetStructure = null;
        entity.mission = this.idleMission(entity);
        entity.animState = AnimState.IDLE;
        return;
      }
      this.updateAttackStructure(entity, entity.targetStructure as MapStructure);
      return;
    }

    // Handle force-fire on ground (no entity target)
    if (entity.forceFirePos && !entity.target) {
      this.updateForceFireGround(entity);
      return;
    }

    if (!entity.target?.alive) {
      entity.target = null;
      entity.forceFirePos = null;
      // Resume saved move destination (AI units interrupted MOVE to attack)
      if (entity.savedMoveTarget) {
        const saved = entity.savedMoveTarget;
        entity.savedMoveTarget = null;
        entity.mission = Mission.MOVE;
        entity.moveTarget = { x: saved.x, y: saved.y };
        entity.path = findPath(this.map, entity.cell, worldToCell(saved.x, saved.y), true, entity.isNavalUnit, entity.stats.speedClass);
        entity.pathIndex = 0;
        return;
      }
      // Return to guard origin if player unit was auto-engaging (not given explicit attack order)
      if (entity.isPlayerUnit && entity.guardOrigin) {
        const d = worldDist(entity.pos, entity.guardOrigin);
        if (d > 1.5) { // worldDist returns cells
          entity.mission = Mission.MOVE;
          entity.moveTarget = { x: entity.guardOrigin.x, y: entity.guardOrigin.y };
          entity.path = findPath(this.map, entity.cell, worldToCell(entity.guardOrigin.x, entity.guardOrigin.y), true, entity.isNavalUnit, entity.stats.speedClass);
          entity.pathIndex = 0;
          return;
        }
      }
      entity.mission = this.idleMission(entity);
      entity.animState = AnimState.IDLE;
      return;
    }

    // Naval target filtering
    if (entity.target) {
      // Submerged subs (cloaked) can only be targeted by weapons with isAntiSub
      if (entity.target.cloakState === CloakState.CLOAKED || entity.target.cloakState === CloakState.CLOAKING) {
        const canHitSub = (entity.weapon?.isAntiSub || entity.weapon2?.isAntiSub);
        if (!canHitSub) {
          entity.target = null;
          entity.mission = this.idleMission(entity);
          entity.animState = AnimState.IDLE;
          return;
        }
      }
      // Cruisers cannot target infantry (C++ vessel.cpp:1248 — exclude THREAT_INFANTRY)
      if (entity.type === UnitType.V_CA && entity.target.stats.isInfantry) {
        entity.target = null;
        entity.mission = this.idleMission(entity);
        entity.animState = AnimState.IDLE;
        return;
      }
      // Torpedoes (isSubSurface) can only hit naval units
      if (entity.weapon?.isSubSurface && !entity.target.isNavalUnit) {
        // Try secondary weapon if available
        if (entity.weapon2 && !entity.weapon2.isSubSurface) {
          // Can use secondary weapon — let selectWeapon handle it
        } else {
          entity.target = null;
          entity.mission = this.idleMission(entity);
          entity.animState = AnimState.IDLE;
          return;
        }
      }
    }

    // Force-uncloak submarine when attacking
    if (entity.stats.isCloakable && (entity.cloakState === CloakState.CLOAKED || entity.cloakState === CloakState.CLOAKING) && entity.target) {
      entity.cloakState = CloakState.UNCLOAKING;
      entity.cloakTimer = CLOAK_TRANSITION_FRAMES;
    }

    // Minimum range check: artillery can't fire at point-blank
    if (entity.weapon?.minRange && entity.target) {
      const dist = worldDist(entity.pos, entity.target.pos);
      if (dist < entity.weapon.minRange) {
        this.retreatFromTarget(entity, entity.target.pos);
        return;
      }
    }

    if (entity.inRange(entity.target)) {
      // Check line of sight — can't fire through walls/rocks
      const ec = entity.cell;
      const tc = entity.target.cell;
      if (!this.map.hasLineOfSight(ec.cx, ec.cy, tc.cx, tc.cy)) {
        // LOS blocked — move toward target to get clear shot
        entity.animState = AnimState.WALK;
        entity.moveToward(entity.target.pos, this.movementSpeed(entity));
        if (entity.attackCooldown > 0) entity.attackCooldown--;
        if (entity.attackCooldown2 > 0) entity.attackCooldown2--;
        return;
      }

      // Turreted vehicles: turret tracks target, body may stay still
      if (entity.hasTurret) {
        entity.desiredTurretFacing = directionTo(entity.pos, entity.target.pos);
        entity.tickTurretRotation();
      } else {
        entity.desiredFacing = directionTo(entity.pos, entity.target.pos);
        const facingReady = entity.tickRotation();
        // NoMovingFire units must face target before attacking.
        // Exception: melee weapons (range <= 2) bypass facing check to prevent
        // rotation lock where ants never catch up to moving targets.
        const isMelee = entity.weapon && entity.weapon.range <= 2;
        if (entity.stats.noMovingFire && !facingReady && !isMelee) {
          entity.animState = AnimState.IDLE;
          return;
        }
      }
      entity.animState = AnimState.ATTACK;

      // S5: NoMovingFire setup time (C++ unit.cpp:1760-1764 — Arm = Rearm_Delay(true)/4 when stopping)
      // When a NoMovingFire unit transitions from moving to stationary, add ROF/4 warmup delay
      if (entity.stats.noMovingFire && entity.wasMoving && entity.weapon) {
        const setupTime = Math.floor(entity.weapon.rof / 4);
        if (entity.attackCooldown < setupTime) {
          entity.attackCooldown = setupTime;
        }
        entity.wasMoving = false; // consume the transition — only apply once
      }

      // C1: Burst fire continuation (C++ weapon.cpp:78 Weapon.Burst)
      // Between burst shots, count down burstDelay instead of using full ROF cooldown
      if (entity.burstCount > 0 && entity.burstDelay > 0) {
        entity.burstDelay--;
        if (entity.burstDelay > 0) return; // waiting between burst shots
        // burstDelay reached 0 — fire next burst shot (fall through to fire logic)
      }

      // Dual-weapon selection (C++ TechnoClass::Fire_At / Can_Fire):
      // Select the best weapon based on target armor effectiveness and cooldown state.
      // Only one weapon fires per tick — they alternate based on cooldowns and effectiveness.
      const selectedWeapon = entity.selectWeapon(
        entity.target, (wh, ar) => this.getWarheadMult(wh, ar),
      );

      // If a burst is in progress, continue with the primary weapon (burst belongs to primary)
      const activeWeapon = entity.burstCount > 0 ? entity.weapon : selectedWeapon;
      const isSecondary = activeWeapon === entity.weapon2;

      if (activeWeapon && ((isSecondary ? entity.attackCooldown2 : entity.attackCooldown) <= 0)) {
        // C1: Set burst count for multi-shot weapons (e.g. MammothTusk burst: 2)
        const burst = activeWeapon.burst ?? 1;
        if (entity.burstCount > 0) {
          // Continuing burst — decrement
          entity.burstCount--;
          entity.burstDelay = 3; // 3 ticks between burst shots (C++ standard)
        } else {
          // CF12: IsSecondShot cadence for dual-weapon units (C++ techno.cpp:2857-2870)
          // First shot: 3-tick rearm (quick follow-up). Second shot: full ROF (reload delay).
          const isDualWeapon = entity.weapon && entity.weapon2;
          let rearmTime = activeWeapon.rof;
          if (isDualWeapon) {
            if (!entity.isSecondShot) {
              rearmTime = 3; // first shot: quick 3-tick rearm
            }
            entity.isSecondShot = !entity.isSecondShot;
          }
          if (isSecondary) {
            entity.attackCooldown2 = rearmTime;
          } else {
            entity.attackCooldown = rearmTime;
          }
          entity.burstCount = burst - 1; // remaining shots after this one
          if (entity.burstCount > 0) entity.burstDelay = 3;
        }
        // M6: C++ techno.cpp:3114-3117 — recoil only for turreted units
        if (entity.hasTurret) entity.isInRecoilState = true;

        // Gap #4: Reset spy disguise when attacking
        if (entity.disguisedAs) entity.disguisedAs = null;

        // Apply weapon inaccuracy — scatter the impact point
        let impactX = entity.target.pos.x;
        let impactY = entity.target.pos.y;
        let directHit = true;
        // C5: Moving-platform inaccuracy (C++ techno.cpp:3106-3108)
        const isMoving = entity.prevPos.x !== entity.pos.x || entity.prevPos.y !== entity.pos.y;
        const baseInaccuracy = activeWeapon.inaccuracy ?? 0;
        let effectiveInaccuracy = isMoving ? Math.max(baseInaccuracy, 1.0) : baseInaccuracy;
        // SC1: AP warheads force scatter vs infantry even with 0 weapon inaccuracy (C++ bullet.cpp:709-710)
        if (activeWeapon.warhead === 'AP' && entity.target.stats.isInfantry && effectiveInaccuracy <= 0) {
          effectiveInaccuracy = 0.5;
        }
        // WH5: IsInaccurate flag — forced scatter on every shot (C++ bullet.h)
        if (activeWeapon.isInaccurate && effectiveInaccuracy <= 0) {
          effectiveInaccuracy = 1.0;
        }
        if (effectiveInaccuracy > 0) {
          // SC3: Exact C++ scatter formula (bullet.cpp:710-730)
          // distance in leptons (1 cell = 256 leptons), convert from cells
          const targetDist = worldDist(entity.pos, entity.target.pos);
          const distLeptons = targetDist * LEPTON_SIZE;
          // C++ formula: scatterMax = max(0, (distance / 16) - 64)
          let scatterMax = Math.max(0, (distLeptons / 16) - 64);
          // Cap at HomingScatter(512) for homing, BallisticScatter(256) for ballistic
          const isHoming = (activeWeapon.projectileROT ?? 0) > 0;
          const scatterCap = isHoming ? 512 : 256;
          scatterMax = Math.min(scatterMax, scatterCap);
          // Convert scatter from leptons back to pixels: leptons * CELL_SIZE / LEPTON_SIZE
          const scatterPx = scatterMax * CELL_SIZE / LEPTON_SIZE;
          const dist = Math.random() * scatterPx;
          if (activeWeapon.isArcing) {
            // SC5+SC2: Arcing projectiles — circular scatter with ±5° angular jitter (C++ bullet.cpp:722)
            const baseAngle = Math.random() * Math.PI * 2;
            const jitterDeg = (Math.random() * 10 - 5); // ±5 degrees (C++ Random_Pick(0,10)-5)
            const angle = baseAngle + (jitterDeg * Math.PI / 180);
            impactX += Math.cos(angle) * dist;
            impactY += Math.sin(angle) * dist;
          } else {
            // SC2: Non-arcing projectiles — scatter along firing direction (overshoot/undershoot)
            const firingAngle = Math.atan2(
              entity.target.pos.y - entity.pos.y,
              entity.target.pos.x - entity.pos.x,
            );
            impactX += Math.cos(firingAngle) * dist;
            impactY += Math.sin(firingAngle) * dist;
          }
          // Check if scattered shot still hits the target (within half-cell)
          const dx = impactX - entity.target.pos.x;
          const dy = impactY - entity.target.pos.y;
          directHit = Math.sqrt(dx * dx + dy * dy) < CELL_SIZE * 0.6;
        }

        // CF7: Heal guard — negative damage weapons must pass proximity and armor checks (C++ combat.cpp:86-96)
        if (activeWeapon.damage < 0) {
          const healDist = worldDist(entity.pos, entity.target.pos);
          if (activeWeapon.warhead === 'Mechanical') {
            // GoodWrench/Mechanic: only heals armored targets (armor !== 'none') within 0.75 cells
            if (healDist >= 0.75 || entity.target.stats.armor === 'none') return;
          } else {
            // Heal warhead (Organic): only heals unarmored targets (armor === 'none') within 0.75 cells
            if (healDist >= 0.75 || entity.target.stats.armor !== 'none') return;
          }
          // Apply healing directly — modifyDamage clamps negative values to 0
          const healAmount = Math.abs(activeWeapon.damage);
          entity.target.hp = Math.min(entity.target.maxHp, entity.target.hp + healAmount);
          return;
        }

        // CF1: Apply C++ Modify_Damage formula — direct hit at distance 0 gets full damage
        const houseBias = this.getFirepowerBias(entity.house);
        const whMult = this.getWarheadMult(activeWeapon.warhead, entity.target.stats.armor);
        let damage = modifyDamage(activeWeapon.damage, activeWeapon.warhead, entity.target.stats.armor, 0, houseBias, whMult, this.getWarheadMeta(activeWeapon.warhead).spreadFactor);
        if (damage <= 0) {
          // This weapon can't hurt the target. If dual-weapon, don't give up —
          // the other weapon might work. Only give up if neither weapon can damage.
          if (entity.weapon2 && !isSecondary) {
            // Primary can't hurt, but secondary might — don't clear target
          } else if (entity.weapon && isSecondary) {
            // Secondary can't hurt, but primary might — don't clear target
          } else {
            entity.target = null; // can't hurt this target with any weapon, give up
          }
          return;
        }

        if (activeWeapon.projectileSpeed) {
          // Deferred damage: projectile must travel to target
          this.launchProjectile(entity, entity.target, activeWeapon, damage, impactX, impactY, directHit);
        } else {
          // Instant damage (melee, hitscan weapons)
          const killed = directHit ? this.damageEntity(entity.target, damage, activeWeapon.warhead, entity) : false;

          if (directHit && !killed) {
            this.triggerRetaliation(entity.target, entity);
            this.scatterInfantry(entity.target, entity.pos);
          }

          if (activeWeapon.splash && activeWeapon.splash > 0) {
            const splashCenter = { x: impactX, y: impactY };
            this.applySplashDamage(
              splashCenter, activeWeapon, directHit ? entity.target.id : -1,
              entity.house, entity,
            );
          }

          if (killed) {
            entity.creditKill();
            this.handleUnitDeath(entity.target, {
              screenShake: 8, explosionSize: 16, debris: true,
              decal: { infantry: 6, vehicle: 10, opacity: 0.6 },
              explodeLgSound: true,
              attackerIsPlayer: this.isPlayerControlled(entity),
              trackLoss: true,
            });
          }
        }

        // Armor-based hit indicator at impact point (fires immediately regardless of projectile travel)
        {
          const armor = entity.target.stats.armor;
          if (armor === 'heavy') {
            this.effects.push({ type: 'muzzle', x: impactX, y: impactY,
              frame: 0, maxFrames: 3, size: 3, muzzleColor: '255,255,200' });
          } else if (armor === 'light') {
            this.effects.push({ type: 'muzzle', x: impactX, y: impactY,
              frame: 0, maxFrames: 4, size: 2, muzzleColor: '180,160,120' });
          }
        }

        // Play weapon sound (spatially positioned)
        this.playSoundAt(this.audio.weaponSound(activeWeapon.name), entity.pos.x, entity.pos.y);

        // Spawn attack effects + projectiles (use activeWeapon for correct muzzle color/projectile style)
        const tx = entity.target.pos.x;
        const ty = entity.target.pos.y;
        const sx = entity.pos.x;
        const sy = entity.pos.y;

        if (entity.isAnt && (activeWeapon.name === 'TeslaZap' || activeWeapon.name === 'TeslaCannon')) {
          this.effects.push({ type: 'tesla', x: tx, y: ty, frame: 0, maxFrames: 8, size: 12,
            sprite: 'piffpiff', spriteStart: 0, startX: sx, startY: sy, endX: tx, endY: ty, blendMode: 'screen' });
        } else if (entity.isAnt && activeWeapon.name === 'Napalm') {
          // Napalm ant: fire burst at target
          this.effects.push({ type: 'explosion', x: tx, y: ty, frame: 0, maxFrames: 10, size: 10,
            sprite: 'piffpiff', spriteStart: 0, muzzleColor: '255,140,30' });
        } else if (entity.isAnt) {
          this.effects.push({ type: 'blood', x: tx, y: ty, frame: 0, maxFrames: 8, size: 6,
            sprite: 'piffpiff', spriteStart: 0 });
        } else if (activeWeapon.name === 'TeslaCannon' || activeWeapon.name === 'TeslaZap') {
          // Tesla weapons: lightning bolt arc from source to target
          this.effects.push({ type: 'muzzle', x: sx, y: sy, frame: 0, maxFrames: 4, size: 5,
            sprite: 'piff', spriteStart: 0, muzzleColor: '120,180,255' });
          this.effects.push({ type: 'tesla', x: tx, y: ty, frame: 0, maxFrames: 8, size: 12,
            sprite: 'piffpiff', spriteStart: 0, startX: sx, startY: sy, endX: tx, endY: ty, blendMode: 'screen' });
        } else {
          // Muzzle flash at attacker — vehicles use GUNFIRE.SHP with screen blend (C++ isTranslucent)
          const muzzleSprite = (!entity.stats.isInfantry && activeWeapon.warhead !== 'Fire') ? 'gunfire' : 'piff';
          const muzzleBlend = (muzzleSprite === 'gunfire') ? 'screen' as const : undefined;
          this.effects.push({ type: 'muzzle', x: sx, y: sy, frame: 0, maxFrames: 4, size: 5,
            sprite: muzzleSprite, spriteStart: 0, muzzleColor: this.warheadMuzzleColor(activeWeapon.warhead),
            blendMode: muzzleBlend });

          // Projectile travel from attacker to impact point (scattered for inaccurate weapons)
          const projStyle = this.weaponProjectileStyle(activeWeapon.name);
          if (projStyle !== 'bullet' || worldDist(entity.pos, entity.target.pos) > 2) {
            // Per-weapon projectile speed: compute travel frames from distance and projSpeed
            const projDistPx = Math.sqrt((impactX - sx) ** 2 + (impactY - sy) ** 2);
            const travelFrames = calcProjectileTravelFrames(projDistPx, activeWeapon.projSpeed);
            this.effects.push({
              type: 'projectile', x: sx, y: sy, frame: 0, maxFrames: travelFrames, size: 3,
              startX: sx, startY: sy, endX: impactX, endY: impactY, projStyle,
            });
          }

          // R8: Impact explosion sprite from warhead's explosionSet (C++ warhead.cpp)
          // Water terrain uses water splash sprites (C++ bullet.cpp:1032)
          const impactCell = worldToCell(impactX, impactY);
          const isWaterImpact = this.map.getTerrain(impactCell.cx, impactCell.cy) === Terrain.WATER
            && !entity.target.isNavalUnit; // vessel targets still use normal explosions
          let impactSprite: string;
          if (isWaterImpact) {
            const waterSprites = ['h2o_exp1', 'h2o_exp2', 'h2o_exp3'];
            impactSprite = waterSprites[Math.floor(Math.random() * 3)];
          } else {
            impactSprite = this.getWarheadProps(activeWeapon.warhead)?.explosionSet ?? 'veh-hit1';
          }
          this.effects.push({ type: 'explosion', x: impactX, y: impactY, frame: 0,
            maxFrames: EXPLOSION_FRAMES[impactSprite] ?? 17, size: 8,
            sprite: impactSprite, spriteStart: 0 });
        }

      }
    } else {
      // M5: Defensive stance: chase if target within weapon range of guard origin (C++ Threat_Range)
      // Only give up if target is too far from the home position, not current position
      if (entity.stance === Stance.DEFENSIVE) {
        const weaponRange = Math.max(entity.weapon?.range ?? 0, entity.weapon2?.range ?? 0) || 2;
        const origin = entity.guardOrigin ?? entity.pos;
        const distFromHome = worldDist(origin, entity.target.pos);
        if (distFromHome > weaponRange + 1) {
          // Target fled beyond guard perimeter — disengage
          entity.target = null;
          entity.forceFirePos = null;
          entity.targetStructure = null;
          entity.mission = this.idleMission(entity);
          entity.animState = AnimState.IDLE;
        } else {
          // Target still within guard perimeter — pursue briefly
          entity.animState = AnimState.WALK;
          entity.moveToward(entity.target.pos, this.movementSpeed(entity));
        }
      } else {
        entity.animState = AnimState.WALK;
        entity.moveToward(entity.target.pos, this.movementSpeed(entity));
      }
    }

    if (entity.attackCooldown > 0) entity.attackCooldown--;
    if (entity.attackCooldown2 > 0) entity.attackCooldown2--;
  }

  /** Hunt mode — move toward target and attack (C++ foot.cpp:654-703)
   *  Actively calls Target_Something_Nearby when target is null or dead. */
  private updateHunt(entity: Entity): void {
    if (!entity.target?.alive) {
      entity.target = null;
      // C++ foot.cpp:654-703 — Hunt actively scans for new targets with extended range
      const huntRange = entity.stats.sight * 2; // hunt has wider scan than guard
      const ec = entity.cell;
      let bestTarget: Entity | null = null;
      let bestScore = -Infinity;
      for (const other of this.entities) {
        if (!other.alive || this.entitiesAllied(entity, other)) continue;
        if (!this.canTargetNaval(entity, other)) continue;
        const dist = worldDist(entity.pos, other.pos);
        if (dist > huntRange) continue;
        if (!this.map.hasLineOfSight(ec.cx, ec.cy, other.cell.cx, other.cell.cy)) continue;
        const score = this.threatScore(entity, other, dist);
        if (score > bestScore) { bestScore = score; bestTarget = other; }
      }
      if (bestTarget) {
        // Found a new target — continue hunting
        entity.target = bestTarget;
      } else {
        // M3: No mobile targets — scan structures (C++ Target_Something_Nearby includes buildings)
        let bestStruct: MapStructure | null = null;
        let bestStructDist = huntRange;
        for (const s of this.structures) {
          if (!s.alive) continue;
          if (s.house === House.Neutral) continue;
          if (this.isAllied(entity.house, s.house)) continue;
          const sPos = { x: s.cx * CELL_SIZE + CELL_SIZE, y: s.cy * CELL_SIZE + CELL_SIZE };
          const dist = worldDist(entity.pos, sPos);
          if (dist < bestStructDist) {
            bestStructDist = dist;
            bestStruct = s;
          }
        }
        if (bestStruct) {
          entity.mission = Mission.ATTACK;
          entity.targetStructure = bestStruct;
          return;
        }
        // No targets found — resume move or return to idle
        if (entity.moveTarget) {
          entity.mission = Mission.MOVE;
          // Only recalc path if we don't have a valid one already
          if (entity.path.length === 0 || entity.pathIndex >= entity.path.length) {
            entity.path = findPath(this.map, entity.cell, worldToCell(entity.moveTarget.x, entity.moveTarget.y), true, entity.isNavalUnit, entity.stats.speedClass);
            entity.pathIndex = 0;
          }
        } else {
          entity.mission = this.idleMission(entity);
        }
        return;
      }
    }

    if (entity.inRange(entity.target)) {
      entity.mission = Mission.ATTACK;
      entity.animState = AnimState.ATTACK;
    } else {
      entity.animState = AnimState.WALK;
      // Use pathfinding to reach target (recalc only when path is exhausted or target moved significantly)
      const targetCell = worldToCell(entity.target.pos.x, entity.target.pos.y);
      const pathExhausted = entity.path.length === 0 || entity.pathIndex >= entity.path.length;
      // Only recalc on timer if target has moved >3 cells from path endpoint
      let targetMovedFar = false;
      if (!pathExhausted && ((this.tick + entity.id) % 15 === 0) && entity.path.length > 0) {
        const lastWp = entity.path[entity.path.length - 1];
        const dtx = lastWp.cx - targetCell.cx;
        const dty = lastWp.cy - targetCell.cy;
        targetMovedFar = (dtx * dtx + dty * dty) > 9; // >3 cells
      }
      if (pathExhausted || targetMovedFar) {
        entity.path = findPath(this.map, entity.cell, targetCell, true, entity.isNavalUnit, entity.stats.speedClass);
        entity.pathIndex = 0;
      }
      if (entity.path.length > 0 && entity.pathIndex < entity.path.length) {
        const nextCell = entity.path[entity.pathIndex];
        const wp: WorldPos = {
          x: nextCell.cx * CELL_SIZE + CELL_SIZE / 2,
          y: nextCell.cy * CELL_SIZE + CELL_SIZE / 2,
        };
        if (entity.moveToward(wp, this.movementSpeed(entity))) {
          entity.pathIndex++;
        }
      } else {
        // No path found — move directly
        entity.moveToward(entity.target.pos, this.movementSpeed(entity));
      }
    }
  }

  /** Guard mode — attack nearby enemies or auto-heal (rate-limited to every 15 ticks) */
  private updateGuard(entity: Entity): void {
    entity.animState = AnimState.IDLE;

    // Save guard origin when first entering guard stance (for return-after-chase)
    if (entity.isPlayerUnit && !entity.guardOrigin) {
      entity.guardOrigin = { x: entity.pos.x, y: entity.pos.y };
    }

    // Medic auto-heal: handled by updateMedic() — medics are non-combat, skip enemy targeting
    if (entity.type === UnitType.I_MEDI) {
      this.updateMedic(entity);
      return;
    }

    // Mechanic auto-heal: mirrors medic but for vehicles — non-combat, skip enemy targeting
    if (entity.type === UnitType.I_MECH) {
      this.updateMechanicUnit(entity);
      return;
    }

    // A3: Type-specific scan delays (C++ foot.cpp:589-612)
    const guardScanDelay = entity.stats.scanDelay ?? 15;
    if (this.tick - entity.lastGuardScan < guardScanDelay) return;
    entity.lastGuardScan = this.tick;

    // Civilians auto-flee nearby ants (SCA02EA evacuation behavior)
    if (entity.isCivilian && entity.isPlayerUnit) {
      let nearestAntDist = Infinity;
      let nearestAntPos: WorldPos | null = null;
      for (const other of this.entities) {
        if (!other.alive || !other.isAnt) continue;
        const dist = worldDist(entity.pos, other.pos);
        if (dist < 5 && dist < nearestAntDist) {
          nearestAntDist = dist;
          nearestAntPos = other.pos;
        }
      }
      if (nearestAntPos && !entity.moveTarget) {
        // Flee in opposite direction
        const dx = entity.pos.x - nearestAntPos.x;
        const dy = entity.pos.y - nearestAntPos.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const fleeDist = 4 * CELL_SIZE;
        const fleeX = entity.pos.x + (dx / len) * fleeDist;
        const fleeY = entity.pos.y + (dy / len) * fleeDist;
        // Clamp to map bounds
        const bx0 = this.map.boundsX * CELL_SIZE;
        const by0 = this.map.boundsY * CELL_SIZE;
        const bx1 = (this.map.boundsX + this.map.boundsW) * CELL_SIZE;
        const by1 = (this.map.boundsY + this.map.boundsH) * CELL_SIZE;
        entity.moveTarget = {
          x: Math.max(bx0 + CELL_SIZE, Math.min(bx1 - CELL_SIZE, fleeX)),
          y: Math.max(by0 + CELL_SIZE, Math.min(by1 - CELL_SIZE, fleeY)),
        };
        entity.mission = Mission.MOVE;
        entity.path = [];
        entity.pathIndex = 0;
      }
      return; // civilians don't auto-attack
    }

    // Hold fire stance: never auto-engage
    if (entity.stance === Stance.HOLD_FIRE) return;

    // Harvesters have no weapon — don't auto-engage (would chase forever)
    if (entity.type === UnitType.V_HARV) return;

    // Gap #4: Auto-disguise spies near enemies
    if (entity.type === UnitType.I_SPY && entity.alive && !entity.disguisedAs && entity.isPlayerUnit) {
      for (const other of this.entities) {
        if (!other.alive || this.entitiesAllied(entity, other)) continue;
        if (worldDist(entity.pos, other.pos) <= 4) { // worldDist returns cells
          this.spyDisguise(entity, other);
          break;
        }
      }
    }

    // Gap #4: Dog spy detection — dogs auto-target enemy spies within 3 cells
    if (entity.type === 'DOG' && entity.alive) {
      for (const other of this.entities) {
        if (!other.alive || other.type !== UnitType.I_SPY) continue;
        if (this.entitiesAllied(entity, other)) continue;
        if (worldDist(entity.pos, other.pos) <= 3) { // worldDist returns cells
          entity.target = other;
          entity.mission = Mission.ATTACK;
          return;
        }
      }
    }

    const ec = entity.cell;
    const isDog = entity.type === 'DOG';
    // Guard scan range: use guardRange if defined (from INI GuardRange=N), else sight
    // Defensive stance: reduced to weapon range only
    const baseRange = entity.stats.guardRange ?? entity.stats.sight;
    const scanRange = entity.stance === Stance.DEFENSIVE
      ? Math.min(baseRange, (entity.weapon?.range ?? 2) + 1)
      : baseRange;
    let bestTarget: Entity | null = null;
    let bestScore = -Infinity;
    for (const other of this.entities) {
      if (!other.alive) continue;
      if (this.entitiesAllied(entity, other)) continue;
      // M8: Dogs ONLY target infantry (C++ techno.cpp:2017-2026 — THREAT_INFANTRY)
      if (isDog && !other.stats.isInfantry) continue;
      // Naval combat target filtering
      if (!this.canTargetNaval(entity, other)) continue;
      // Air combat target filtering: ground units without AA weapons skip aircraft
      if (other.isAirUnit && other.flightAltitude > 0) {
        const hasAA = entity.weapon?.isAntiAir || entity.weapon2?.isAntiAir;
        if (!hasAA) continue;
      }
      const dist = worldDist(entity.pos, other.pos);
      if (dist >= scanRange) continue;
      // Check line of sight — can't target through walls (aircraft skip LOS check)
      if (!(other.isAirUnit && other.flightAltitude > 0)) {
        const oc = other.cell;
        if (!this.map.hasLineOfSight(ec.cx, ec.cy, oc.cx, oc.cy)) continue;
      }

      const score = this.threatScore(entity, other, dist);
      if (score > bestScore) {
        bestTarget = other; bestScore = score;
      }
    }
    if (bestTarget) {
      entity.mission = Mission.ATTACK;
      entity.target = bestTarget;
      return;
    }

    // M4: No mobile targets — check for enemy structures in range (C++ Target_Something_Nearby includes buildings)
    if (!isDog && entity.weapon) {
      let bestStruct: MapStructure | null = null;
      let bestStructDist = scanRange;
      for (const s of this.structures) {
        if (!s.alive) continue;
        if (s.house === House.Neutral) continue;
        if (this.isAllied(entity.house, s.house)) continue;
        const sPos = { x: s.cx * CELL_SIZE + CELL_SIZE, y: s.cy * CELL_SIZE + CELL_SIZE };
        const dist = worldDist(entity.pos, sPos);
        if (dist < bestStructDist) {
          bestStructDist = dist;
          bestStruct = s;
        }
      }
      if (bestStruct) {
        entity.mission = Mission.ATTACK;
        entity.targetStructure = bestStruct;
      }
    }
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
    // Tick down heal cooldown every frame (not rate-limited by scan delay)
    if (entity.attackCooldown > 0) {
      entity.attackCooldown--;
    }

    // Medics flee when frightened (C++ infantry.cpp fear system) — run from nearest enemy
    if (entity.fear >= Entity.FEAR_SCARED) {
      let nearestEnemyDist = Infinity;
      let nearestEnemyPos: WorldPos | null = null;
      for (const other of this.entities) {
        if (!other.alive || this.entitiesAllied(entity, other)) continue;
        const dist = worldDist(entity.pos, other.pos);
        if (dist < entity.stats.sight && dist < nearestEnemyDist) {
          nearestEnemyDist = dist;
          nearestEnemyPos = other.pos;
        }
      }
      if (nearestEnemyPos) {
        // Flee in opposite direction
        const dx = entity.pos.x - nearestEnemyPos.x;
        const dy = entity.pos.y - nearestEnemyPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const fleeX = entity.pos.x + (dx / dist) * CELL_SIZE * 3;
        const fleeY = entity.pos.y + (dy / dist) * CELL_SIZE * 3;
        entity.animState = AnimState.WALK;
        entity.moveToward({ x: fleeX, y: fleeY }, this.movementSpeed(entity));
        entity.healTarget = null; // drop heal target when fleeing
        return;
      }
    }

    // Validate existing heal target: must still be alive, friendly infantry, damaged, and in range
    if (entity.healTarget) {
      const ht = entity.healTarget;
      if (!ht.alive || ht.hp >= ht.maxHp ||
          !this.isAllied(entity.house, ht.house) || !ht.stats.isInfantry ||
          ht.id === entity.id) {
        entity.healTarget = null;
      }
    }

    // Scan for heal target (rate-limited by scan delay)
    const healScanDelay = entity.stats.scanDelay ?? 15;
    if (!entity.healTarget && this.tick - entity.lastGuardScan >= healScanDelay) {
      entity.lastGuardScan = this.tick;

      let bestTarget: Entity | null = null;
      let lowestHpRatio = 1.0;
      let bestDist = Infinity;
      const healScanRange = entity.stats.sight * 1.5; // C++ sight * 1.5 for medic search

      for (const other of this.entities) {
        if (!other.alive || other.id === entity.id) continue;
        if (!this.isAllied(entity.house, other.house)) continue;
        if (!other.stats.isInfantry) continue;
        if (other.hp >= other.maxHp) continue;
        // Don't heal ants (they are infantry-like but not player infantry)
        if (other.isAnt) continue;
        const dist = worldDist(entity.pos, other.pos);
        if (dist > healScanRange) continue;
        // Prefer most damaged unit (lowest HP ratio), then closest
        const hpRatio = other.hp / other.maxHp;
        if (hpRatio < lowestHpRatio || (hpRatio === lowestHpRatio && dist < bestDist)) {
          lowestHpRatio = hpRatio;
          bestDist = dist;
          bestTarget = other;
        }
      }

      if (bestTarget) {
        entity.healTarget = bestTarget;
      }
    }

    // Act on heal target
    if (entity.healTarget) {
      const ht = entity.healTarget;
      const dist = worldDist(entity.pos, ht.pos);

      if (dist <= 1.5) {
        // Adjacent — perform heal
        entity.animState = AnimState.ATTACK; // heal animation (MedicDoControls fire anim)
        entity.desiredFacing = directionTo(entity.pos, ht.pos);
        entity.tickRotation();

        if (entity.attackCooldown <= 0) {
          // Heal amount: use weapon damage (negative = heal) or default 5 HP per tick
          const healWeapon = entity.weapon;
          const healAmount = healWeapon ? Math.abs(healWeapon.damage) : 5;
          const healRof = healWeapon?.rof ?? 15;

          const prevHp = ht.hp;
          ht.hp = Math.min(ht.maxHp, ht.hp + healAmount);
          const healed = ht.hp - prevHp;
          entity.attackCooldown = healRof;

          if (healed > 0) {
            this.playSoundAt('heal', ht.pos.x, ht.pos.y);
            // Green heal sparkle on target
            this.effects.push({
              type: 'muzzle', x: ht.pos.x, y: ht.pos.y - 4,
              frame: 0, maxFrames: 6, size: 4, muzzleColor: '80,255,80',
            });
            // Floating "+HP" text effect
            this.effects.push({
              type: 'text', x: ht.pos.x, y: ht.pos.y - 8,
              frame: 0, maxFrames: 30, size: 0,
              text: `+${healed}`, textColor: 'rgba(80,255,80,1)',
            });
          }

          // Check if target is fully healed — clear and scan for next
          if (ht.hp >= ht.maxHp) {
            entity.healTarget = null;
          }
        }
      } else {
        // Move toward heal target
        entity.animState = AnimState.WALK;
        entity.moveToward(ht.pos, this.movementSpeed(entity));
      }
      return;
    }

    // No heal target — idle
    entity.animState = AnimState.IDLE;
  }

  /** Area Guard — defend spawn area, attack nearby enemies but return if straying too far */
  private updateAreaGuard(entity: Entity): void {
    entity.animState = AnimState.IDLE;
    // A3: Type-specific scan delays (C++ foot.cpp:589-612)
    const areaGuardScanDelay = entity.stats.scanDelay ?? 15;
    if (this.tick - entity.lastGuardScan < areaGuardScanDelay) return;
    entity.lastGuardScan = this.tick;

    const origin = entity.guardOrigin ?? entity.pos;
    // A5: Scan from home position (C++ foot.cpp:967 — temporarily swaps coords)
    // Use origin position for distance checks so guards defend their post, not where they wandered
    const scanPos = origin;
    const scanCell = worldToCell(scanPos.x, scanPos.y);
    // AG1: C++ foot.cpp:996-1001 — leash = Threat_Range(1)/2 = weapon.range/2 from origin
    const weaponRange = entity.weapon?.range ?? entity.stats.sight;
    const leashRange = weaponRange / 2;
    const scanRange = Math.max(leashRange, entity.stats.sight);

    // If too far from origin (> leash range), return home — but still attack enemies en route
    const distFromOrigin = worldDist(entity.pos, origin);
    const ec = entity.cell;
    if (distFromOrigin > leashRange) {
      // Check for enemies while returning
      for (const other of this.entities) {
        if (!other.alive || this.entitiesAllied(entity, other)) continue;
        const dist = worldDist(entity.pos, other.pos);
        if (dist > entity.stats.sight) continue;
        const oc2 = other.cell;
        if (!this.map.hasLineOfSight(ec.cx, ec.cy, oc2.cx, oc2.cy)) continue;
        // Found an enemy — attack it
        entity.mission = Mission.ATTACK;
        entity.target = other;
        entity.animState = AnimState.WALK;
        return;
      }
      // AG1: Return home but stay in AREA_GUARD (C++ Assign_Destination, not Assign_Mission)
      entity.moveTarget = { x: origin.x, y: origin.y };
      entity.target = null;
      entity.targetStructure = null;
      entity.path = findPath(this.map, ec, worldToCell(origin.x, origin.y), true, entity.isNavalUnit, entity.stats.speedClass);
      entity.pathIndex = 0;
      entity.animState = AnimState.WALK;
      return;
    }

    // If moving back toward origin, continue moving
    if (entity.moveTarget) {
      const distToMove = worldDist(entity.pos, entity.moveTarget);
      if (distToMove > 1.0) {
        entity.animState = AnimState.WALK;
        entity.moveToward(entity.moveTarget, this.movementSpeed(entity));
        return;
      }
      entity.moveTarget = null;
      entity.path = [];
    }

    // A5: Look for enemies within scan range from HOME position (C++ foot.cpp:967)
    let bestTarget: Entity | null = null;
    let bestScore = -Infinity;
    for (const other of this.entities) {
      if (!other.alive || this.entitiesAllied(entity, other)) continue;
      // A5: Use scanPos (home) for distance check, not entity's current position
      const dist = worldDist(scanPos, other.pos);
      if (dist > scanRange) continue;
      const oc = other.cell;
      if (!this.map.hasLineOfSight(scanCell.cx, scanCell.cy, oc.cx, oc.cy)) continue;
      const score = this.threatScore(entity, other, dist);
      if (score > bestScore) { bestScore = score; bestTarget = other; }
    }

    if (bestTarget) {
      entity.mission = Mission.ATTACK;
      entity.target = bestTarget;
    }
  }

  /** AI1: RETREAT mission — move to nearest map edge and exit the map (C++ foot.cpp) */
  private updateRetreat(entity: Entity): void {
    // If already at a move target, continue moving
    if (entity.moveTarget) {
      entity.animState = AnimState.WALK;
      const arrived = entity.moveToward(entity.moveTarget, this.movementSpeed(entity));
      if (arrived) {
        // Reached map edge — remove entity
        entity.alive = false;
        entity.mission = Mission.DIE;
      }
      return;
    }
    // Find nearest map edge
    const ec = entity.cell;
    const distLeft = ec.cx - this.map.boundsX;
    const distRight = (this.map.boundsX + this.map.boundsW - 1) - ec.cx;
    const distTop = ec.cy - this.map.boundsY;
    const distBottom = (this.map.boundsY + this.map.boundsH - 1) - ec.cy;
    const minDist = Math.min(distLeft, distRight, distTop, distBottom);
    let tx = ec.cx, ty = ec.cy;
    if (minDist === distLeft) tx = this.map.boundsX;
    else if (minDist === distRight) tx = this.map.boundsX + this.map.boundsW - 1;
    else if (minDist === distTop) ty = this.map.boundsY;
    else ty = this.map.boundsY + this.map.boundsH - 1;
    entity.moveTarget = { x: tx * CELL_SIZE + CELL_SIZE / 2, y: ty * CELL_SIZE + CELL_SIZE / 2 };
    entity.path = findPath(this.map, ec, { cx: tx, cy: ty }, true, entity.isNavalUnit, entity.stats.speedClass);
    entity.pathIndex = 0;
  }

  /** AI1: AMBUSH mission — sleep until enemy enters sight range, then HUNT */
  private updateAmbush(entity: Entity): void {
    entity.animState = AnimState.IDLE;
    // Scan for enemies within sight range
    const scanDelay = entity.stats.scanDelay ?? 15;
    if (this.tick - entity.lastGuardScan < scanDelay) return;
    entity.lastGuardScan = this.tick;
    const ec = entity.cell;
    for (const other of this.entities) {
      if (!other.alive || this.entitiesAllied(entity, other)) continue;
      if (worldDist(entity.pos, other.pos) > entity.stats.sight) continue;
      const oc = other.cell;
      if (!this.map.hasLineOfSight(ec.cx, ec.cy, oc.cx, oc.cy)) continue;
      // Enemy spotted — switch to HUNT
      entity.mission = Mission.HUNT;
      entity.target = other;
      return;
    }
  }

  /** AI1: REPAIR mission — seek nearest FIX (Service Depot) and move to it */
  private updateRepairMission(entity: Entity): void {
    // If already moving to a target, continue
    if (entity.moveTarget) {
      entity.animState = AnimState.WALK;
      const arrived = entity.moveToward(entity.moveTarget, this.movementSpeed(entity));
      if (arrived) {
        // Reached depot — switch to guard (depot auto-repair handles the rest)
        entity.mission = Mission.GUARD;
        entity.moveTarget = null;
      }
      return;
    }
    // Find nearest FIX structure
    let bestDist = Infinity;
    let bestPos: WorldPos | null = null;
    for (const s of this.structures) {
      if (!s.alive || s.type !== 'FIX') continue;
      if (!this.isAllied(s.house, entity.house)) continue;
      const sp: WorldPos = { x: s.cx * CELL_SIZE + CELL_SIZE, y: s.cy * CELL_SIZE + CELL_SIZE };
      const d = worldDist(entity.pos, sp);
      if (d < bestDist) { bestDist = d; bestPos = sp; }
    }
    if (bestPos) {
      entity.moveTarget = bestPos;
      entity.path = findPath(this.map, entity.cell, worldToCell(bestPos.x, bestPos.y), true, entity.isNavalUnit, entity.stats.speedClass);
      entity.pathIndex = 0;
    } else {
      // No depot found — fall back to guard
      entity.mission = Mission.GUARD;
    }
  }

  /** Attack a structure (building) — engineers capture instead */
  private updateAttackStructure(entity: Entity, s: MapStructure): void {
    const structPos: WorldPos = {
      x: s.cx * CELL_SIZE + CELL_SIZE,
      y: s.cy * CELL_SIZE + CELL_SIZE,
    };
    const dist = worldDist(entity.pos, structPos);
    const range = entity.weapon?.range ?? 2;

    // Minimum range check: artillery can't fire at point-blank structures
    if (entity.weapon?.minRange && dist < entity.weapon.minRange) {
      this.retreatFromTarget(entity, structPos);
      return;
    }

    if (dist <= range) {
      // Engineer capture/damage (C++ infantry.cpp:618 — capture requires ConditionRed)
      if (entity.type === UnitType.I_E6 && entity.isPlayerUnit) {
        // EN1: Friendly repair — engineer heals to FULL HP (C++ Renovate() behavior)
        if (this.isAllied(s.house, this.playerHouse) && s.hp < s.maxHp) {
          s.hp = s.maxHp;
          // Engineer consumed on repair
          entity.alive = false;
          entity.mission = Mission.DIE;
          entity.targetStructure = null;
          this.audio.play('repair');
          this.effects.push({
            type: 'explosion', x: structPos.x, y: structPos.y,
            frame: 0, maxFrames: 10, size: 8, sprite: 'piffpiff', spriteStart: 0,
          });
          this.evaMessages.push({ text: 'BUILDING REPAIRED', tick: this.tick });
          return;
        }
        // Enemy capture/damage (existing logic below)
        if (s.hp / s.maxHp <= CONDITION_RED) {
          // Capture: building at red health — convert to player
          s.house = this.playerHouse;
          s.hp = s.maxHp;
          this.playEva('eva_building_captured');
        } else {
          // Damage: deal MaxStrength/3 (capped to Strength-1) (C++ infantry.cpp:631)
          const engDamage = Math.min(Math.floor(s.maxHp / 3), s.hp - 1);
          if (engDamage > 0) s.hp -= engDamage;
        }
        // Kill the engineer (consumed either way)
        entity.alive = false;
        entity.mission = Mission.DIE;
        entity.targetStructure = null;
        this.audio.play('eva_acknowledged');
        // Flash effect
        this.effects.push({
          type: 'explosion', x: structPos.x, y: structPos.y,
          frame: 0, maxFrames: 10, size: 10, sprite: 'piffpiff', spriteStart: 0,
        });
        return;
      }

      // Spy infiltration: spy enters enemy building for special effects
      if (entity.type === UnitType.I_SPY && entity.isPlayerUnit) {
        if (!this.isAllied(s.house, this.playerHouse)) {
          this.spyInfiltrate(entity, s);
          return;
        }
      }

      // CHAN nest-gas: consume specialist, destroy LAR1/LAR2 nest (SCA03EA mechanic)
      if (entity.type === UnitType.I_CHAN && (s.type === 'LAR1' || s.type === 'LAR2')) {
        // Consume the CHAN specialist
        entity.alive = false;
        entity.mission = Mission.DIE;
        entity.targetStructure = null;
        // Destroy the nest
        this.damageStructure(s, s.maxHp + 1);
        this.killCount++;
        this.audio.play('eva_acknowledged');
        // Green gas cloud effect — multiple expanding puffs
        for (let i = 0; i < 5; i++) {
          const ox = (Math.random() - 0.5) * 20;
          const oy = (Math.random() - 0.5) * 20;
          this.effects.push({
            type: 'explosion', x: structPos.x + ox, y: structPos.y + oy,
            frame: 0, maxFrames: 14, size: 10 + i * 2,
            sprite: 'smokey', spriteStart: 0,
          });
        }
        return;
      }

      // Tanya C4: plants C4 on structure instead of shooting it
      if (entity.type === UnitType.I_TANYA) {
        this.updateTanyaC4(entity);
        return;
      }

      // Thief: steals credits from enemy PROC/SILO
      if (entity.type === UnitType.I_THF) {
        this.updateThief(entity);
        return;
      }

      entity.desiredFacing = directionTo(entity.pos, structPos);
      entity.tickRotation();
      if (entity.stats.noMovingFire && entity.facing !== entity.desiredFacing) {
        entity.animState = AnimState.IDLE;
        return;
      }
      entity.animState = AnimState.ATTACK;
      if (entity.attackCooldown <= 0 && entity.weapon) {
        // C++ parity: use warhead-vs-armor lookup (structures have 'concrete' armor)
        const wh = entity.weapon.warhead as WarheadType;
        const mult = this.getWarheadMult(wh, 'concrete');
        const structHouseBias = this.getFirepowerBias(entity.house);
        const damage = mult <= 0 ? 0 : Math.max(1, Math.round(entity.weapon.damage * mult * structHouseBias));
        const destroyed = this.damageStructure(s, damage);
        entity.attackCooldown = entity.weapon.rof;
        if (entity.hasTurret) entity.isInRecoilState = true; // M6
        // Ground unit ammo consumption (C++ parity: V2RL fires once, civilians fire 10x)
        if (entity.ammo > 0) entity.ammo--;
        this.playSoundAt(this.audio.weaponSound(entity.weapon.name), entity.pos.x, entity.pos.y);
        // Muzzle + impact effects (color by warhead — C++ parity)
        this.effects.push({
          type: 'muzzle', x: entity.pos.x, y: entity.pos.y,
          frame: 0, maxFrames: 4, size: 5, sprite: 'piff', spriteStart: 0,
          muzzleColor: this.warheadMuzzleColor(entity.weapon.warhead),
        });
        // R8: Impact explosion sprite from warhead's explosionSet (C++ warhead.cpp)
        const structImpactSprite = this.getWarheadProps(entity.weapon.warhead)?.explosionSet ?? 'veh-hit1';
        this.effects.push({
          type: 'explosion', x: structPos.x, y: structPos.y,
          frame: 0, maxFrames: EXPLOSION_FRAMES[structImpactSprite] ?? 17, size: 8,
          sprite: structImpactSprite, spriteStart: 0,
        });
        if (destroyed) {
          if (this.isPlayerControlled(entity)) this.killCount++;
        }
        // Out of ammo — stop attacking (C++ parity: unit must rearm at service depot)
        if (entity.ammo === 0 && entity.maxAmmo > 0 && !entity.isAirUnit) {
          entity.targetStructure = null;
          entity.mission = Mission.GUARD;
          entity.animState = AnimState.IDLE;
          return;
        }
      }
    } else {
      entity.animState = AnimState.WALK;
      entity.moveToward(structPos, this.movementSpeed(entity));
    }
    if (entity.attackCooldown > 0) entity.attackCooldown--;
    if (entity.attackCooldown2 > 0) entity.attackCooldown2--;
  }

  /** Force-fire on ground — fire at a location with no target entity */
  private updateForceFireGround(entity: Entity): void {
    const target = entity.forceFirePos!;
    const dist = worldDist(entity.pos, target);
    const range = entity.weapon?.range ?? 2;

    if (dist <= range) {
      entity.desiredFacing = directionTo(entity.pos, target);
      const facingReady = entity.tickRotation();
      if (entity.stats.noMovingFire && !facingReady) {
        entity.animState = AnimState.IDLE;
        return;
      }
      entity.animState = AnimState.ATTACK;

      if (entity.attackCooldown <= 0 && entity.weapon) {
        entity.attackCooldown = entity.weapon.rof;
        if (entity.hasTurret) entity.isInRecoilState = true; // M6
        // Ground unit ammo consumption (C++ parity: V2RL fires once, civilians fire 10x)
        if (entity.ammo > 0) entity.ammo--;

        // Apply scatter
        let impactX = target.x;
        let impactY = target.y;
        if (entity.weapon.inaccuracy && entity.weapon.inaccuracy > 0) {
          const scatter = entity.weapon.inaccuracy * CELL_SIZE;
          const angle = Math.random() * Math.PI * 2;
          const d = Math.random() * scatter;
          impactX += Math.cos(angle) * d;
          impactY += Math.sin(angle) * d;
        }

        // Splash damage at impact
        if (entity.weapon.splash && entity.weapon.splash > 0) {
          this.applySplashDamage(
            { x: impactX, y: impactY }, entity.weapon, -1,
            entity.house, entity,
          );
        }

        // Weapon sound + effects (spatially positioned)
        this.playSoundAt(this.audio.weaponSound(entity.weapon.name), entity.pos.x, entity.pos.y);
        const sx = entity.pos.x;
        const sy = entity.pos.y;
        this.effects.push({
          type: 'muzzle', x: sx, y: sy,
          frame: 0, maxFrames: 4, size: 5, sprite: 'piff', spriteStart: 0,
          muzzleColor: this.warheadMuzzleColor(entity.weapon.warhead),
        });
        const projStyle = this.weaponProjectileStyle(entity.weapon.name);
        // Per-weapon projectile speed: compute travel frames from distance and projSpeed
        const ffDistPx = Math.sqrt((impactX - sx) ** 2 + (impactY - sy) ** 2);
        const travelFrames = calcProjectileTravelFrames(ffDistPx, entity.weapon.projSpeed);
        this.effects.push({
          type: 'projectile', x: sx, y: sy, frame: 0, maxFrames: travelFrames, size: 3,
          startX: sx, startY: sy, endX: impactX, endY: impactY, projStyle,
        });
        // R8: Impact explosion sprite from warhead's explosionSet (C++ warhead.cpp)
        const ffImpactSprite = this.getWarheadProps(entity.weapon.warhead)?.explosionSet ?? 'veh-hit1';
        this.effects.push({
          type: 'explosion', x: impactX, y: impactY,
          frame: 0, maxFrames: EXPLOSION_FRAMES[ffImpactSprite] ?? 17, size: 8, sprite: ffImpactSprite, spriteStart: 0,
        });
        const tc = worldToCell(impactX, impactY);
        this.map.addDecal(tc.cx, tc.cy, 3, 0.3);
        // Out of ammo — stop attacking (C++ parity: unit must rearm at service depot)
        if (entity.ammo === 0 && entity.maxAmmo > 0 && !entity.isAirUnit) {
          entity.target = null;
          entity.mission = Mission.GUARD;
          entity.animState = AnimState.IDLE;
          return;
        }
      }
    } else {
      entity.animState = AnimState.WALK;
      entity.moveToward(target, this.movementSpeed(entity));
    }
    if (entity.attackCooldown > 0) entity.attackCooldown--;
    if (entity.attackCooldown2 > 0) entity.attackCooldown2--;
  }

  /** Defensive structure auto-fire — pillboxes, guard towers, tesla coils fire at nearby enemies */
  /** Turreted structure types (GUN/SAM) — turret rotates to face target */
  private static readonly TURRETED_STRUCTURES = new Set(['GUN', 'SAM']);
  private static readonly DEFENSE_TYPES = new Set(['HBOX', 'GUN', 'TSLA', 'PBOX', 'SAM', 'AGUN']);
  // PW2: Powered structures use STRUCTURE_POWERED from scenario.ts (C++ per-building IsPowered flag)

  private updateStructureCombat(): void {
    const isLowPower = this.powerConsumed > this.powerProduced && this.powerProduced > 0;
    for (const s of this.structures) {
      if (!s.alive || !s.weapon || s.sellProgress !== undefined) continue;
      // C++ parity PW1/PW3: powered defenses (TSLA, GUN, SAM, AGUN) cannot fire during any power deficit.
      // Unpowered defenses (PBOX, HBOX, FTUR) always fire regardless of power.
      if (isLowPower && STRUCTURE_POWERED.has(s.type)) {
        continue;
      }
      // C++ building.cpp:882-883 — ammo instantly reloads to MaxAmmo each AI tick
      if (s.ammo === 0 && s.maxAmmo > 0) { s.ammo = s.maxAmmo; }
      if (s.ammo === 0) continue; // out of ammo (shouldn't reach here after reload)

      // Turret rotation tick (every frame, independent of cooldown)
      if (Game.TURRETED_STRUCTURES.has(s.type)) {
        if (s.turretDir === undefined) s.turretDir = 4; // default: South
        if (s.desiredTurretDir === undefined) s.desiredTurretDir = s.turretDir;
        if (s.turretDir !== s.desiredTurretDir) {
          const diff = (s.desiredTurretDir - s.turretDir + 8) % 8;
          s.turretDir = diff <= 4
            ? (s.turretDir + 1) % 8
            : (s.turretDir + 7) % 8;
        }
        if (s.firingFlash !== undefined && s.firingFlash > 0) s.firingFlash--;
      }

      if (s.attackCooldown > 0) {
        if (!isLowPower || this.tick % 2 === 0) s.attackCooldown--;
        continue;
      }

      const sx = s.cx * CELL_SIZE + CELL_SIZE;
      const sy = s.cy * CELL_SIZE + CELL_SIZE;
      const structPos: WorldPos = { x: sx, y: sy };
      const range = s.weapon.range;

      // Find highest-threat enemy in range (C++ building.cpp — prioritize dangerous targets, not just closest)
      let bestTarget: Entity | null = null;
      let bestScore = -Infinity;
      for (const e of this.entities) {
        if (!e.alive) continue;
        if (this.isAllied(s.house, e.house)) continue; // don't shoot friendlies
        const dist = worldDist(structPos, e.pos);
        if (dist >= range) continue;
        // LOS check
        const ec = e.cell;
        if (!this.map.hasLineOfSight(s.cx, s.cy, ec.cx, ec.cy)) continue;
        // Threat scoring: prioritize dangerous/wounded enemies over merely close ones
        const isAttackingAlly = e.targetStructure?.alive && this.isAllied(s.house, (e.targetStructure.house as House) ?? House.Neutral);
        let score = e.stats.isInfantry ? 10 : 25;
        score += (e.weapon?.damage ?? 0) * 0.2;
        if (e.hp < e.maxHp * 0.5) score *= 1.5; // wounded bonus
        if (isAttackingAlly) score *= 2; // retaliation
        score *= Math.max(0.3, 1 - (dist / range) * 0.7); // distance weighting
        if (score > bestScore) {
          bestTarget = e;
          bestScore = score;
        }
      }

      // AA override: SAM/AGUN prefer airborne aircraft over ground targets
      if (s.weapon.isAntiAir && bestTarget) {
        let bestAirTarget: Entity | null = null;
        let bestAirDist = Infinity;
        for (const e of this.entities) {
          if (!e.alive || !e.isAirUnit || e.flightAltitude <= 0) continue;
          if (this.isAllied(s.house, e.house)) continue;
          const dist = worldDist(structPos, e.pos);
          if (dist < range && dist < bestAirDist) {
            bestAirTarget = e;
            bestAirDist = dist;
          }
        }
        if (bestAirTarget) {
          bestTarget = bestAirTarget;
        }
      }

      if (bestTarget) {
        // Update turret direction for turreted structures
        if (Game.TURRETED_STRUCTURES.has(s.type)) {
          s.desiredTurretDir = directionTo(structPos, bestTarget.pos);
        }
        // H1: Buildings with Ammo>1 fire rapidly (1-tick rearm) then recharge (C++ techno.cpp:2861)
        if (s.ammo > 0) {
          s.ammo--;
          s.attackCooldown = s.ammo > 0 ? 1 : s.weapon.rof; // rapid-fire until last shot
        } else {
          s.attackCooldown = s.weapon.rof; // unlimited ammo (-1) uses normal ROF
        }
        if (Game.TURRETED_STRUCTURES.has(s.type)) s.firingFlash = 4;
        // CF1: Apply C++ Modify_Damage — structure direct hit at distance 0
        const wh = (s.weapon.warhead ?? 'HE') as WarheadType;
        const houseBias = this.getFirepowerBias(s.house);
        const whMult = this.getWarheadMult(wh, bestTarget.stats.armor);
        const damage = modifyDamage(s.weapon.damage, wh, bestTarget.stats.armor, 0, houseBias, whMult, this.getWarheadMeta(wh).spreadFactor);
        const killed = this.damageEntity(bestTarget, damage, wh);

        // Fire effects — color by warhead type (C++ parity)
        this.effects.push({
          type: 'muzzle', x: sx, y: sy,
          frame: 0, maxFrames: 4, size: 5, sprite: 'piff', spriteStart: 0,
          muzzleColor: this.warheadMuzzleColor(wh),
        });

        // Tesla coil and Queen Ant get special effect
        if (s.type === 'TSLA' || s.type === 'QUEE') {
          this.effects.push({
            type: 'tesla', x: bestTarget.pos.x, y: bestTarget.pos.y,
            frame: 0, maxFrames: 8, size: 12, sprite: 'piffpiff', spriteStart: 0,
            startX: sx, startY: sy, endX: bestTarget.pos.x, endY: bestTarget.pos.y,
            blendMode: 'screen',
          });
          this.playSoundAt('teslazap', sx, sy);
        } else {
          // Projectile from structure to target — per-weapon projectile speed
          const structDistPx = Math.sqrt((bestTarget.pos.x - sx) ** 2 + (bestTarget.pos.y - sy) ** 2);
          const structTravelFrames = calcProjectileTravelFrames(structDistPx, s.weapon.projSpeed);
          this.effects.push({
            type: 'projectile', x: sx, y: sy, frame: 0, maxFrames: structTravelFrames, size: 3,
            startX: sx, startY: sy, endX: bestTarget.pos.x, endY: bestTarget.pos.y,
            projStyle: 'bullet',
          });
          // AA weapons hitting aircraft use flak burst sprite (C++ FLAK.SHP)
          const aaImpactSprite = (s.weapon.isAntiAir && bestTarget.isAirUnit && bestTarget.flightAltitude > 0)
            ? 'flak'
            : (this.getWarheadProps(wh)?.explosionSet ?? 'veh-hit1');
          this.effects.push({
            type: 'explosion', x: bestTarget.pos.x, y: bestTarget.pos.y,
            frame: 0, maxFrames: 10, size: 6,
            sprite: aaImpactSprite, spriteStart: 0,
          });
          this.playSoundAt('machinegun', sx, sy);
        }

        // Splash damage
        if (s.weapon.splash && s.weapon.splash > 0) {
          this.applySplashDamage(
            bestTarget.pos,
            { damage: s.weapon.damage, warhead: wh, splash: s.weapon.splash },
            bestTarget.id, s.house,
          );
        }

        if (killed) {
          this.handleUnitDeath(bestTarget, {
            screenShake: 4, explosionSize: 16, debris: false,
            decal: { infantry: 4, vehicle: 8, opacity: 0.5 },
            explodeLgSound: false,
            attackerIsPlayer: this.isAllied(s.house, this.playerHouse),
            trackLoss: false,
          });
        }
      }
    }
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
    // Cloaked subs only targetable by isAntiSub weapons
    if (target.cloakState === CloakState.CLOAKED || target.cloakState === CloakState.CLOAKING) {
      if (!scanner.weapon?.isAntiSub && !scanner.weapon2?.isAntiSub) return false;
    }
    // Cruisers cannot target infantry
    if (scanner.type === UnitType.V_CA && target.stats.isInfantry) return false;
    // Torpedo-only units can't target land units
    if (scanner.weapon?.isSubSurface && !scanner.weapon2 && !target.isNavalUnit) return false;
    return true;
  }

  /** Find a landing pad for this aircraft. Returns structure index or -1. */
  private findLandingPad(entity: Entity): number {
    const padType = entity.stats.landingBuilding;
    if (!padType) return -1;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.structures.length; i++) {
      const s = this.structures[i];
      if (!s.alive || s.type !== padType) continue;
      if (!this.isAllied(entity.house, s.house)) continue;
      if (s.dockedAircraft !== undefined && s.dockedAircraft > 0) continue; // occupied
      const sx = s.cx * CELL_SIZE + CELL_SIZE;
      const sy = s.cy * CELL_SIZE + CELL_SIZE;
      const dist = worldDist(entity.pos, { x: sx, y: sy });
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  /** Get target position for an aircraft's current target (entity or structure) */
  private getAircraftTargetPos(entity: Entity): WorldPos | null {
    if (entity.target?.alive) return entity.target.pos;
    if (entity.targetStructure && (entity.targetStructure as MapStructure).alive) {
      const s = entity.targetStructure as MapStructure;
      return { x: s.cx * CELL_SIZE + CELL_SIZE, y: s.cy * CELL_SIZE + CELL_SIZE };
    }
    return null;
  }

  /** Aircraft state machine — returns true if aircraft handled this tick (skip normal update) */
  private updateAircraft(entity: Entity): boolean {
    // Only process aircraft with active state
    if (!entity.stats.isAircraft) return false;

    // Decrement attack cooldowns — aircraft skip normal mission processing
    if (entity.attackCooldown > 0) entity.attackCooldown--;
    if (entity.attackCooldown2 > 0) entity.attackCooldown2--;

    switch (entity.aircraftState) {
      case 'landed': {
        // On pad, flightAltitude=0. Wait for attack/move order
        entity.flightAltitude = 0;
        entity.animState = AnimState.IDLE;
        if (entity.mission === Mission.ATTACK && (entity.target?.alive || entity.targetStructure)) {
          entity.aircraftState = 'takeoff';
        } else if (entity.mission === Mission.MOVE && entity.moveTarget) {
          entity.aircraftState = 'takeoff';
        }
        return true;
      }

      case 'takeoff': {
        // Ascend 1px/tick until at flight altitude (C++ AIRCRAFT.CPP — 24 ticks to reach altitude)
        entity.flightAltitude = Math.min(Entity.FLIGHT_ALTITUDE, entity.flightAltitude + 1);
        entity.animState = AnimState.WALK;
        // Undock from pad
        if (entity.landedAtStructure >= 0 && entity.landedAtStructure < this.structures.length) {
          this.structures[entity.landedAtStructure].dockedAircraft = undefined;
        }
        entity.landedAtStructure = -1;
        if (entity.flightAltitude >= Entity.FLIGHT_ALTITUDE) {
          entity.aircraftState = 'flying';
        }
        return true;
      }

      case 'flying': {
        entity.animState = AnimState.WALK;
        // If we have an attack target, close to weapon range
        if (entity.mission === Mission.ATTACK) {
          const targetPos = this.getAircraftTargetPos(entity);
          if (!targetPos) {
            // Target lost — RTB
            entity.aircraftState = 'returning';
            return true;
          }
          const dist = worldDist(entity.pos, targetPos);
          const weaponRange = entity.weapon?.range ?? 5;
          if (dist <= weaponRange) {
            entity.aircraftState = 'attacking';
            entity.attackRunPhase = 'approach';
            return true;
          }
          // Fly toward target
          entity.moveToward(targetPos, this.movementSpeed(entity));
        } else if (entity.mission === Mission.MOVE && entity.moveTarget) {
          // Check if aircraft is at map edge with out-of-bounds target — exit map
          const ec = entity.cell;
          const tc = worldToCell(entity.moveTarget.x, entity.moveTarget.y);
          if (!this.map.inBounds(tc.cx, tc.cy) &&
              (ec.cx <= this.map.boundsX || ec.cx >= this.map.boundsX + this.map.boundsW - 1 ||
               ec.cy <= this.map.boundsY || ec.cy >= this.map.boundsY + this.map.boundsH - 1)) {
            entity.alive = false;
            entity.mission = Mission.DIE;
            this.unitsLeftMap++;
            if (CIVILIAN_UNIT_TYPES.has(entity.type)) {
              this.civiliansEvacuated++;
            }
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
            return true;
          }
          // Simple move — fly to destination
          if (entity.moveToward(entity.moveTarget, this.movementSpeed(entity))) {
            // Arrived — check if destination was out of bounds (aircraft map exit)
            const arrCell = worldToCell(entity.moveTarget.x, entity.moveTarget.y);
            if (!this.map.inBounds(arrCell.cx, arrCell.cy)) {
              entity.alive = false;
              entity.mission = Mission.DIE;
              this.unitsLeftMap++;
              if (CIVILIAN_UNIT_TYPES.has(entity.type)) {
                this.civiliansEvacuated++;
              }
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
              return true;
            }
            entity.moveTarget = null;
            if (entity.moveQueue.length > 0) {
              entity.moveTarget = entity.moveQueue.shift()!;
            } else {
              entity.mission = this.idleMission(entity);
              entity.aircraftState = 'returning';
            }
          }
        } else {
          // No mission — return to base
          entity.aircraftState = 'returning';
        }
        return true;
      }

      case 'attacking': {
        if (entity.isFixedWing) {
          return this.updateFixedWingAttackRun(entity);
        } else {
          return this.updateHelicopterAttack(entity);
        }
      }

      case 'returning': {
        // Check for new orders — break out of return-to-base
        if ((entity.mission === Mission.MOVE && entity.moveTarget) ||
            (entity.mission === Mission.ATTACK && (entity.target?.alive || entity.targetStructure))) {
          entity.aircraftState = 'flying';
          return true;
        }
        entity.animState = AnimState.WALK;
        // Find home pad
        const padIdx = this.findLandingPad(entity);
        if (padIdx < 0) {
          // No pad available — transport helicopters land on the ground (C++ aircraft.cpp)
          // Chinooks can land anywhere; combat aircraft orbit until a pad frees up
          if (entity.isTransport) {
            entity.aircraftState = 'landing';
            entity.landedAtStructure = -1;
          }
          // Combat aircraft orbit in place
          return true;
        }
        const pad = this.structures[padIdx];
        const [pw, ph] = STRUCTURE_SIZE[pad.type] ?? [2, 2];
        const padPos = { x: (pad.cx + pw / 2) * CELL_SIZE, y: (pad.cy + ph / 2) * CELL_SIZE };
        const dist = worldDist(entity.pos, padPos);
        if (dist <= CELL_SIZE) {
          entity.pos.x = padPos.x;
          entity.pos.y = padPos.y;
          entity.aircraftState = 'landing';
          entity.landedAtStructure = padIdx;
          pad.dockedAircraft = entity.id;
        } else {
          entity.moveToward(padPos, this.movementSpeed(entity));
        }
        return true;
      }

      case 'landing': {
        // Descend 1px/tick (C++ AIRCRAFT.CPP — matches takeoff rate)
        entity.flightAltitude = Math.max(0, entity.flightAltitude - 1);
        entity.animState = AnimState.IDLE;
        if (entity.flightAltitude <= 0) {
          entity.flightAltitude = 0;
          if (entity.ammo >= 0 && entity.ammo < entity.maxAmmo) {
            entity.aircraftState = 'rearming';
            // C++ AIRCRAFT.CPP: rearm delay = weapon ROF * house ROF bias
            const rofBias = COUNTRY_BONUSES[entity.house]?.rofMult ?? 1.0;
            entity.rearmTimer = Math.max(1, Math.round((entity.weapon?.rof ?? 30) * rofBias));
          } else {
            entity.aircraftState = 'landed';
          }
          entity.mission = Mission.GUARD;
        }
        return true;
      }

      case 'rearming': {
        entity.flightAltitude = 0;
        entity.animState = AnimState.IDLE;
        entity.rearmTimer--;
        if (entity.rearmTimer <= 0) {
          entity.ammo++;
          if (entity.ammo >= entity.maxAmmo) {
            entity.aircraftState = 'landed';
          } else {
            // C++ AIRCRAFT.CPP: rearm delay = weapon ROF * house ROF bias
            const nextRofBias = COUNTRY_BONUSES[entity.house]?.rofMult ?? 1.0;
            entity.rearmTimer = Math.max(1, Math.round((entity.weapon?.rof ?? 30) * nextRofBias));
          }
        }
        return true;
      }

      default:
        return false;
    }
  }

  /** Fixed-wing attack run: approach → fire → pullaway → circle back or RTB */
  private updateFixedWingAttackRun(entity: Entity): boolean {
    const targetPos = this.getAircraftTargetPos(entity);

    if (!targetPos) {
      entity.aircraftState = 'returning';
      entity.mission = Mission.GUARD;
      return true;
    }

    const speed = this.movementSpeed(entity);
    const dist = worldDist(entity.pos, targetPos);
    const weaponRange = entity.weapon?.range ?? 5;

    switch (entity.attackRunPhase) {
      case 'approach':
        entity.animState = AnimState.WALK;
        entity.moveToward(targetPos, speed);
        if (dist <= weaponRange) {
          entity.attackRunPhase = 'firing';
        }
        break;

      case 'firing':
        entity.animState = AnimState.ATTACK;
        // Keep moving forward (fixed-wing can't stop)
        entity.moveToward(targetPos, speed);
        // Fire weapon if cooldown ready, then transition to pullaway
        if (entity.attackCooldown <= 0 && entity.weapon) {
          if (entity.target?.alive) {
            this.fireWeaponAt(entity, entity.target, entity.weapon);
          } else if (entity.targetStructure && (entity.targetStructure as MapStructure).alive) {
            this.fireWeaponAtStructure(entity, entity.targetStructure as MapStructure, entity.weapon);
          }
          entity.attackCooldown = entity.weapon.rof;
          if (entity.ammo > 0) entity.ammo--;
          entity.attackRunPhase = 'pullaway';
        }
        break;

      case 'pullaway':
        entity.animState = AnimState.WALK;
        // Overshoot ~3 cells past target
        const overshootDist = 3 * CELL_SIZE;
        const dx = entity.pos.x - targetPos.x;
        const dy = entity.pos.y - targetPos.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const overshootPos = {
          x: targetPos.x + (dx / len) * overshootDist,
          y: targetPos.y + (dy / len) * overshootDist,
        };
        entity.moveToward(overshootPos, speed);
        if (worldDist(entity.pos, targetPos) > overshootDist * 0.8) {
          if (entity.ammo > 0 && (entity.target?.alive || entity.targetStructure)) {
            // Circle back for another pass
            entity.attackRunPhase = 'approach';
          } else {
            // Out of ammo or target dead — RTB
            entity.aircraftState = 'returning';
            entity.mission = Mission.GUARD;
            entity.target = null;
            entity.targetStructure = null;
          }
        }
        break;
    }
    return true;
  }

  /** Helicopter hover attack: close to weapon range, face target, fire */
  private updateHelicopterAttack(entity: Entity): boolean {
    const targetPos = this.getAircraftTargetPos(entity);

    if (!targetPos) {
      entity.aircraftState = 'returning';
      entity.mission = Mission.GUARD;
      return true;
    }

    const dist = worldDist(entity.pos, targetPos);
    const weaponRange = entity.weapon?.range ?? 5;

    if (dist > weaponRange) {
      // Close to weapon range
      entity.animState = AnimState.WALK;
      entity.moveToward(targetPos, this.movementSpeed(entity));
      return true;
    }

    // In range — hover and fire
    entity.animState = AnimState.ATTACK;
    entity.desiredFacing = directionTo(entity.pos, targetPos);
    entity.tickRotation();

    // Fire on cooldown
    if (entity.attackCooldown <= 0 && entity.weapon) {
      if (entity.target?.alive) {
        this.fireWeaponAt(entity, entity.target, entity.weapon);
      } else if (entity.targetStructure && (entity.targetStructure as MapStructure).alive) {
        this.fireWeaponAtStructure(entity, entity.targetStructure as MapStructure, entity.weapon);
      }
      entity.attackCooldown = entity.weapon.rof;
      if (entity.ammo > 0) entity.ammo--;
    }

    // Out of ammo — RTB
    if (entity.ammo === 0) {
      entity.aircraftState = 'returning';
      entity.mission = Mission.GUARD;
      entity.target = null;
      entity.targetStructure = null;
    }

    return true;
  }

  /** Fire weapon at entity target (helper for aircraft) — uses full damage pipeline */
  private fireWeaponAt(attacker: Entity, target: Entity, weapon: WeaponStats): void {
    const houseBias = this.getFirepowerBias(attacker.house);
    const whMult = this.getWarheadMult(weapon.warhead, target.stats.armor);
    const damage = modifyDamage(weapon.damage, weapon.warhead, target.stats.armor, 0, houseBias, whMult, this.getWarheadMeta(weapon.warhead).spreadFactor);
    const killed = this.damageEntity(target, damage, weapon.warhead, attacker);
    if (killed) {
      attacker.creditKill();
      this.handleUnitDeath(target, {
        screenShake: 8, explosionSize: 16, debris: true,
        decal: { infantry: 6, vehicle: 10, opacity: 0.6 },
        explodeLgSound: false,
        attackerIsPlayer: this.isPlayerControlled(attacker),
        trackLoss: true,
      });
    }
    // Fire effect
    this.effects.push({
      type: 'muzzle',
      x: attacker.pos.x, y: attacker.pos.y - attacker.flightAltitude,
      frame: 0, maxFrames: 4, size: 4, sprite: 'piff', spriteStart: 0,
    });
  }

  /** Fire weapon at structure target (helper for aircraft) — uses full damage pipeline */
  private fireWeaponAtStructure(attacker: Entity, s: MapStructure, weapon: WeaponStats): void {
    const wh = (weapon.warhead ?? 'HE') as WarheadType;
    const houseBias = this.getFirepowerBias(attacker.house);
    const whMult = this.getWarheadMult(wh, 'concrete');
    const damage = modifyDamage(weapon.damage, wh, 'concrete', 0, houseBias, whMult, this.getWarheadMeta(wh).spreadFactor);
    const destroyed = this.damageStructure(s, damage);
    if (destroyed) attacker.creditKill();
    this.effects.push({
      type: 'muzzle',
      x: attacker.pos.x, y: attacker.pos.y - attacker.flightAltitude,
      frame: 0, maxFrames: 4, size: 4, sprite: 'piff', spriteStart: 0,
    });
  }

  /** Shared death aftermath — explosion, debris, decal, sound, kill/loss tracking.
   *  Parameterized to handle the 4 death contexts (direct, defense, projectile, splash). */
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
    const kx = victim.pos.x;
    const ky = victim.pos.y;
    this.effects.push({ type: 'explosion', x: kx, y: ky, frame: 0, maxFrames: 18,
      size: opts.explosionSize, sprite: 'fball1', spriteStart: 0 });
    if (opts.debris && !victim.stats.isInfantry) {
      this.effects.push({ type: 'debris', x: kx, y: ky, frame: 0, maxFrames: 12, size: 18 });
    }
    this.renderer.screenShake = Math.max(this.renderer.screenShake, opts.screenShake);
    if (opts.decal) {
      const tc = worldToCell(kx, ky);
      this.map.addDecal(tc.cx, tc.cy,
        victim.stats.isInfantry ? opts.decal.infantry : opts.decal.vehicle, opts.decal.opacity);
    }
    if (victim.isAnt) this.playSoundAt('die_ant', kx, ky);
    else if (victim.stats.isInfantry) this.playSoundAt('die_infantry', kx, ky);
    else this.playSoundAt('die_vehicle', kx, ky);
    if (opts.explodeLgSound) this.playSoundAt('explode_lg', kx, ky);
    if (opts.attackerIsPlayer) this.killCount++;
    if (opts.trackLoss && this.isPlayerControlled(victim)) {
      this.lossCount++;
      this.playEva('eva_unit_lost');
      const tc = worldToCell(kx, ky);
      this.minimapAlert(tc.cx, tc.cy);
    }
    if (opts.friendlyFireLoss) {
      this.lossCount++;
      this.playEva('eva_unit_lost');
      const tc = worldToCell(kx, ky);
      this.minimapAlert(tc.cx, tc.cy);
    }
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
    const idx = armorIndex(armor);
    const overridden = this.warheadOverrides[warhead];
    if (overridden) return overridden[idx] ?? 1;
    return WARHEAD_VS_ARMOR[warhead]?.[idx] ?? 1;
  }

  private getWarheadMeta(warhead: WarheadType): WarheadMeta {
    return this.scenarioWarheadMeta[warhead] ?? WARHEAD_META[warhead] ?? { spreadFactor: 1 };
  }

  private getWarheadProps(warhead: WarheadType | string | undefined): WarheadProps | undefined {
    if (!warhead) return undefined;
    return this.scenarioWarheadProps[warhead] ?? WARHEAD_PROPS[warhead as WarheadType];
  }

  private damageEntity(target: Entity, amount: number, warhead: WarheadType, attacker?: Entity): boolean {
    const killed = target.takeDamage(amount, warhead, attacker, this.getWarheadProps(warhead));
    if (target.triggerName) this.attackedTriggerNames.add(target.triggerName);
    // AI scatter: idle AI units dodge to random adjacent cell when hit (IQ >= 2)
    if (!killed && target.alive) this.aiScatterOnDamage(target);
    return killed;
  }

  /** AI scatter — idle AI units move to random adjacent cell when attacked (IQ >= 2, C++ techno.cpp) */
  private aiScatterOnDamage(entity: Entity): void {
    if (entity.isPlayerUnit) return;
    if (entity.mission !== Mission.GUARD && entity.mission !== Mission.AREA_GUARD) return;

    const state = this.aiStates.get(entity.house);
    if (!state || state.iq < 2) return;

    // Move to random adjacent cell
    const dx = Math.floor(Math.random() * 3) - 1; // -1, 0, or 1
    const dy = Math.floor(Math.random() * 3) - 1;
    if (dx === 0 && dy === 0) return;

    const targetX = entity.pos.x + dx * CELL_SIZE;
    const targetY = entity.pos.y + dy * CELL_SIZE;

    // Check passability
    const tcx = Math.floor(targetX / CELL_SIZE);
    const tcy = Math.floor(targetY / CELL_SIZE);
    if (!this.map.isPassable(tcx, tcy)) return;

    entity.moveTarget = { x: targetX, y: targetY };
    entity.mission = Mission.MOVE;
  }

  /** Damage-based speed reduction (C++ drive.cpp:1157-1161).
   *  Single tier only: <=50% HP = 75% speed (ConditionYellow). C++ has no ConditionRed speed tier. */
  private damageSpeedFactor(entity: Entity): number {
    const ratio = entity.hp / entity.maxHp;
    if (ratio <= CONDITION_YELLOW) return 0.75; // ConditionYellow (50%): three-quarters speed
    return 1.0;
  }

  /** M1+M2: Compute movement speed with terrain and damage multipliers.
   *  Speed values in UNIT_STATS are C++ MPH (leptons/tick); MPH_TO_PX converts to pixels/tick. */
  private movementSpeed(entity: Entity): number {
    return entity.stats.speed * MPH_TO_PX
      * this.map.getSpeedMultiplier(entity.cell.cx, entity.cell.cy, entity.stats.speedClass)
      * this.damageSpeedFactor(entity);
  }

  /** MV1: Follow one tick of track-table movement. Returns true when track is complete.
   *  Vehicles follow pre-computed curved paths for smooth turning (C++ drive.cpp track tables).
   *  Track offsets are rotated from North-reference via rotateTrackOffset() — exact integer
   *  transforms for cardinal directions, √2/2 for diagonals (matching C++ coord tables). */
  private followTrackStep(entity: Entity, speed: number): boolean {
    const track = TRACKS[entity.trackNumber];
    const facing8 = Math.floor(entity.trackBaseFacing / 4) % 8;

    let remaining = speed;
    while (remaining > 0.5 && entity.trackIndex < track.length) {
      const step = track[entity.trackIndex];
      const [rx, ry] = rotateTrackOffset(step.x, step.y, facing8);
      const tx = entity.trackStartX + rx;
      const ty = entity.trackStartY + ry;

      const dx = tx - entity.pos.x;
      const dy = ty - entity.pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Update visual facing from track step (rotated by base facing)
      entity.bodyFacing32 = (step.facing + entity.trackBaseFacing) % 32;
      entity.facing = Math.floor(entity.bodyFacing32 / 4) as Dir;

      if (dist <= remaining) {
        entity.pos.x = tx;
        entity.pos.y = ty;
        remaining -= dist;
        entity.trackIndex++;
      } else {
        entity.pos.x += (dx / dist) * remaining;
        entity.pos.y += (dy / dist) * remaining;
        remaining = 0;
      }
    }

    if (entity.trackIndex >= track.length) {
      entity.trackNumber = -1;
      return true;
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

  /** Trigger retaliation: a damaged unit without a target attacks the shooter.
   *  In original RA, idle/moving units always counter-attack when hit. */
  private triggerRetaliation(victim: Entity, attacker: Entity): void {
    if (!victim.alive || !attacker.alive) return;
    if (this.entitiesAllied(victim, attacker)) return; // no friendly retaliation
    if (!victim.weapon) return; // unarmed units can't retaliate
    // Only retarget if no current target or current target is dead
    if (victim.target && victim.target.alive) return;
    // Don't interrupt scripted team missions (except HUNT which already attacks)
    if (victim.teamMissions.length > 0 && victim.mission !== Mission.HUNT) return;
    victim.target = attacker;
    victim.mission = Mission.ATTACK;
    victim.animState = AnimState.ATTACK;
  }

  /** Infantry scatter: push infantry slightly away from attacker on direct hit.
   *  In original RA, infantry move randomly when shot at. */
  private scatterInfantry(victim: Entity, attackerPos: WorldPos): void {
    if (!victim.alive || !victim.stats.isInfantry || victim.isAnt) return;
    if (Math.random() > 0.4) return; // 40% chance to scatter per hit
    const angle = Math.atan2(victim.pos.y - attackerPos.y, victim.pos.x - attackerPos.x);
    const jitter = (Math.random() - 0.5) * 1.2; // add randomness to scatter direction
    const scatterX = victim.pos.x + Math.cos(angle + jitter) * CELL_SIZE * 0.5;
    const scatterY = victim.pos.y + Math.sin(angle + jitter) * CELL_SIZE * 0.5;
    const sc = worldToCell(scatterX, scatterY);
    if (this.map.isPassable(sc.cx, sc.cy)) {
      victim.pos.x = scatterX;
      victim.pos.y = scatterY;
    }
  }

  /** Launch a projectile with travel time — damage is deferred until arrival */
  private launchProjectile(
    attacker: Entity, target: Entity | null, weapon: WeaponStats,
    damage: number, impactX: number, impactY: number, directHit: boolean,
  ): void {
    const dist = worldDist(attacker.pos, { x: impactX, y: impactY });
    const speed = weapon.projectileSpeed!;
    const travelFrames = Math.max(1, Math.round(dist / speed));

    this.inflightProjectiles.push({
      attackerId: attacker.id,
      targetId: target?.id ?? -1,
      weapon,
      damage,
      speed,
      travelFrames,
      currentFrame: 0,
      directHit,
      impactX,
      impactY,
      attackerIsPlayer: this.isPlayerControlled(attacker),
    });
  }

  /** Advance in-flight projectiles; apply damage + splash on arrival */
  private updateInflightProjectiles(): void {
    const arrived: InflightProjectile[] = [];

    for (const proj of this.inflightProjectiles) {
      proj.currentFrame++;

      // C9/C10: Homing projectile tracking (C++ bullet.cpp:368,517)
      // projectileROT = homing turn rate. C10: homing updates every other frame.
      const target = this.entityById.get(proj.targetId);
      if (target && target.alive) {
        const rot = proj.weapon.projectileROT ?? 0;
        if (rot > 0) {
          // C10: Only update homing every other frame (C++ bullet.cpp:368)
          if (proj.currentFrame % 2 === 0) {
            // Homing: strong tracking based on ROT (higher ROT = better tracking)
            const trackFactor = Math.min(1.0, rot * 0.15);
            proj.impactX += (target.pos.x - proj.impactX) * trackFactor;
            proj.impactY += (target.pos.y - proj.impactY) * trackFactor;
          }
        }
        // Non-homing projectiles (rot=0) fly straight — no tracking (C++ bullet.cpp)
      }

      if (proj.currentFrame >= proj.travelFrames) {
        arrived.push(proj);
      }
    }

    // Remove arrived projectiles
    this.inflightProjectiles = this.inflightProjectiles.filter(p => p.currentFrame < p.travelFrames);

    // Apply damage for arrived projectiles
    for (const proj of arrived) {
      const target = this.entityById.get(proj.targetId);
      const attacker = this.entityById.get(proj.attackerId);

      if (proj.directHit && target && target.alive) {
        const killed = this.damageEntity(target, proj.damage, proj.weapon.warhead, attacker);

        if (!killed && attacker) {
          this.triggerRetaliation(target, attacker);
          this.scatterInfantry(target, { x: proj.impactX, y: proj.impactY });
        }

        if (killed) {
          if (attacker) attacker.creditKill();
          this.handleUnitDeath(target, {
            screenShake: 8, explosionSize: 16, debris: true,
            decal: { infantry: 6, vehicle: 10, opacity: 0.6 },
            explodeLgSound: false,
            attackerIsPlayer: proj.attackerIsPlayer,
            trackLoss: true,
          });
        }
      }

      // Splash damage at impact point
      if (proj.weapon.splash && proj.weapon.splash > 0) {
        const attackerHouse = attacker?.house ?? (proj.attackerIsPlayer ? this.playerHouse : House.USSR);
        this.applySplashDamage(
          { x: proj.impactX, y: proj.impactY }, proj.weapon,
          proj.directHit && target ? target.id : -1,
          attackerHouse, attacker ?? undefined,
        );
      }

      // R8: Impact explosion sprite from warhead's explosionSet (C++ warhead.cpp)
      const projImpactSprite = this.getWarheadProps(proj.weapon.warhead)?.explosionSet ?? 'veh-hit1';
      // V2RL SCUD: large explosion + screen shake on impact (C++ IsGigundo=true)
      const isScud = proj.weapon.name === 'SCUD';
      this.effects.push({ type: 'explosion', x: proj.impactX, y: proj.impactY,
        frame: 0, maxFrames: EXPLOSION_FRAMES[projImpactSprite] ?? 17, size: isScud ? 20 : 8, sprite: projImpactSprite, spriteStart: 0 });
      if (isScud) {
        this.renderer.screenShake = Math.max(this.renderer.screenShake, 12);
        this.playSoundAt('building_explode', proj.impactX, proj.impactY);
      }
    }
  }

  /** Apply AOE splash damage to entities near an impact point.
   *  CF2/CF3: Uses fixed 1.5-cell radius and C++ inverse-proportional falloff via modifyDamage. */
  private applySplashDamage(
    center: WorldPos, weapon: { damage: number; warhead: WarheadType; splash?: number },
    primaryTargetId: number, attackerHouse: House, attacker?: Entity,
  ): void {
    // CF3: Universal 1.5-cell splash radius (C++ Explosion_Damage uses ICON_LEPTON_W + ICON_LEPTON_W/2)
    const splashRange = Game.SPLASH_RADIUS;
    const splashRangePixels = splashRange * CELL_SIZE;
    const attackerIsPlayerControlled = this.isAllied(attackerHouse, this.playerHouse);

    for (const other of this.entities) {
      if (!other.alive || other.id === primaryTargetId) continue;
      // H2: Splash damage hits ALL units in radius including friendlies (C++ Explosion_Damage)
      const isFriendly = this.isAllied(other.house, attackerHouse);
      const distCells = worldDist(center, other.pos);
      if (distCells > splashRange) continue;

      // CF2: C++ inverse-proportional falloff via modifyDamage (combat.cpp:106-125)
      const distPixels = distCells * CELL_SIZE;
      const whMult = this.getWarheadMult(weapon.warhead, other.stats.armor);
      const splashDmg = modifyDamage(weapon.damage, weapon.warhead, other.stats.armor, distPixels, 1.0, whMult, this.getWarheadMeta(weapon.warhead).spreadFactor);
      if (splashDmg <= 0) continue;
      const killed = this.damageEntity(other, splashDmg, weapon.warhead, attacker);

      // Retaliation from splash damage
      if (!killed && attacker) {
        this.triggerRetaliation(other, attacker);
      }

      // Infantry scatter: push nearby infantry away from explosion
      if (other.alive && other.stats.isInfantry && distCells < splashRange * 0.8) {
        const angle = Math.atan2(other.pos.y - center.y, other.pos.x - center.x);
        const pushDist = CELL_SIZE * (1 - distCells / splashRange);
        const scatterX = other.pos.x + Math.cos(angle) * pushDist;
        const scatterY = other.pos.y + Math.sin(angle) * pushDist;
        // Only scatter to passable terrain
        const sc = worldToCell(scatterX, scatterY);
        if (this.map.isPassable(sc.cx, sc.cy)) {
          other.pos.x = scatterX;
          other.pos.y = scatterY;
        }
      }

      if (killed) {
        if (!isFriendly && attacker) attacker.creditKill();
        this.handleUnitDeath(other, {
          screenShake: 4, explosionSize: 12, debris: false,
          decal: null,
          explodeLgSound: false,
          attackerIsPlayer: !isFriendly && attackerIsPlayerControlled,
          trackLoss: !isFriendly,
          friendlyFireLoss: isFriendly && attackerIsPlayerControlled,
        });
      }
    }

    // Terrain destruction: large explosions (splash >= 1.5) can destroy trees, walls, and ore in the blast radius
    const whMeta = this.getWarheadMeta(weapon.warhead);
    if (splashRange >= 1.5 && weapon.damage >= 30) {
      const cc = worldToCell(center.x, center.y);
      const r = Math.ceil(splashRange);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > splashRange * splashRange) continue;
          const tx = cc.cx + dx;
          const ty = cc.cy + dy;
          if (this.map.getTerrain(tx, ty) === Terrain.TREE) {
            // 40% chance to destroy tree per explosion
            if (Math.random() < 0.4) {
              this.map.setTerrain(tx, ty, Terrain.CLEAR);
              this.map.clearTreeType(tx, ty);
              this.map.addDecal(tx, ty, 6, 0.4); // stump/scorch mark
              this.effects.push({
                type: 'explosion',
                x: tx * CELL_SIZE + CELL_SIZE / 2,
                y: ty * CELL_SIZE + CELL_SIZE / 2,
                frame: 0, maxFrames: 10, size: 8,
                sprite: 'piffpiff', spriteStart: 0,
              });
            }
          }
          // CF8: Wall destruction from splash — warheads with IsWallDestroyer flag (C++ combat.cpp:244-270)
          if (whMeta.destroysWalls && this.map.getWallType(tx, ty) !== '') {
            this.map.clearWallType(tx, ty);
            this.map.addDecal(tx, ty, 4, 0.3); // rubble decal
            this.effects.push({
              type: 'explosion',
              x: tx * CELL_SIZE + CELL_SIZE / 2,
              y: ty * CELL_SIZE + CELL_SIZE / 2,
              frame: 0, maxFrames: 8, size: 6,
              sprite: 'piffpiff', spriteStart: 0,
            });
          }
          // CF9: Ore destruction from splash — warheads with IsTiberiumDestroyer flag (C++ combat.cpp)
          if (whMeta.destroysOre) {
            const oreIdx = ty * MAP_CELLS + tx;
            if (tx >= 0 && tx < MAP_CELLS && ty >= 0 && ty < MAP_CELLS) {
              const ovl = this.map.overlay[oreIdx];
              if (ovl >= 0x03 && ovl <= 0x12) {
                // Reduce ore density by one level; fully depleted if at minimum
                if (ovl === 0x03 || ovl === 0x0F) {
                  this.map.overlay[oreIdx] = 0xFF; // fully depleted
                } else {
                  this.map.overlay[oreIdx] = ovl - 1;
                }
              }
            }
          }
        }
      }
    }
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
    };
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
        const e1Met = checkTriggerEvent(trigger.event1, state);
        const e2Met = checkTriggerEvent(trigger.event2, state);

        switch (trigger.eventControl) {
          case 0: shouldFire = e1Met; break;            // only event1
          case 1: shouldFire = e1Met && e2Met; break;   // AND
          case 2: shouldFire = e1Met || e2Met; break;   // OR
          default: shouldFire = e1Met; break;
        }
      }

      if (!shouldFire) continue;
      if (this.debugTriggers) {
        console.log(`[TRIGGER] ${trigger.name} fired | event1=${trigger.event1.type} action1=${trigger.action1.action}${trigger.action2 ? ' action2=' + trigger.action2.action : ''}`);
      }
      trigger.fired = true;

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
        // Destroy the attached object (entity/structure with matching triggerName)
        if (result.destroyTriggeringUnit) {
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
      };

      executeAction(trigger.action1);
      if (trigger.actionControl === 1) {
        executeAction(trigger.action2);
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

  /** Reveal map around a specific cell with given radius */
  private revealAroundCell(cx: number, cy: number, radius: number): void {
    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= r2) {
          const rx = cx + dx;
          const ry = cy + dy;
          if (rx >= 0 && rx < MAP_CELLS && ry >= 0 && ry < MAP_CELLS) {
            this.map.setVisibility(rx, ry, 2);
          }
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
    let capacity = 0;
    for (const s of this.structures) {
      if (!s.alive || !this.isAllied(s.house, this.playerHouse)) continue;
      if (s.buildProgress !== undefined && s.buildProgress < 1) continue; // under construction
      if (s.type === 'PROC') capacity += 1000;
      else if (s.type === 'SILO') capacity += 1500;
    }
    return capacity;
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
    const bonus = COUNTRY_BONUSES[this.playerHouse] ?? COUNTRY_BONUSES.Neutral;
    return Math.max(1, Math.round(item.cost * bonus.costMult));
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
    // No production until player discovers their base
    if (!this.baseDiscovered) return [];
    return this.scenarioProductionItems.filter(item => {
      // Must have primary prerequisite building
      if (!this.hasBuilding(item.prerequisite)) return false;
      // Faction filter: player only sees items matching their faction or 'both'
      if (item.faction !== 'both' && item.faction !== this.playerFaction) return false;
      // Tech prerequisite (e.g. Artillery needs Radar Dome)
      if (item.techPrereq && !this.hasBuilding(item.techPrereq)) return false;
      // TechLevel filter: items above player's scenario tech level are hidden
      if (item.techLevel !== undefined && (item.techLevel < 0 || item.techLevel > this.playerTechLevel)) return false;
      return true;
    });
  }

  /** Start building an item (called from sidebar click).
   *  PR3: C++ incremental cost — don't deduct full cost upfront; deduct per-tick during tickProduction.
   *  Players can start building with partial funds; production pauses when broke. */
  startProduction(item: ProductionItem): void {
    const category = getStripSide(item);
    const existing = this.productionQueue.get(category);
    if (existing) {
      // Already building — queue another of the same item (max 5 total)
      // Queued items still require full cost upfront (only active build is incremental)
      if (existing.item.type === item.type && existing.queueCount < 5) {
        const effectiveCost = this.getEffectiveCost(item);
        if (this.credits < effectiveCost) {
          this.playEva('eva_insufficient_funds');
          return;
        }
        this.credits -= effectiveCost;
        existing.queueCount++;
      }
      return;
    }
    // PR3: Only check if player has ANY credits (can start building with partial funds)
    if (this.credits <= 0) {
      this.playEva('eva_insufficient_funds');
      return;
    }
    this.productionQueue.set(category, { item, progress: 0, queueCount: 1, costPaid: 0 });
    this.audio.play('eva_building');
  }

  /** Cancel production in a category — removes one from queue, or cancels active build */
  cancelProduction(category: string): void {
    const entry = this.productionQueue.get(category);
    if (!entry) return;
    const effectiveCost = this.getEffectiveCost(entry.item);
    if (entry.queueCount > 1) {
      // Dequeue one — refund full cost of queued item (queued items were paid upfront)
      entry.queueCount--;
      this.addCredits(effectiveCost, true);
    } else {
      // PR3: Cancel active build — refund costPaid (incremental deduction)
      this.addCredits(entry.costPaid, true);
      this.productionQueue.delete(category);
    }
  }

  /** Advance production queues each tick.
   *  PR3: C++ incremental cost — deducts costPerTick each tick; pauses if insufficient funds. */
  private tickProduction(): void {
    // Continuous power penalty (C++ parity): multiplier = powerFraction, clamped to [0.5, 1.0]
    // At 100%+ power: normal speed. At 50% power: 2x slower. Below 50%: capped at 2x slower.
    let powerMult = 1.0;
    if (this.powerConsumed > this.powerProduced && this.powerProduced > 0) {
      const powerFraction = this.powerProduced / this.powerConsumed;
      powerMult = Math.max(0.5, powerFraction);
    }
    for (const [category, entry] of this.productionQueue) {
      // Check prerequisite still exists
      if (!this.hasBuilding(entry.item.prerequisite)) {
        this.cancelProduction(category);
        continue;
      }
      // PR3: Incremental cost deduction — deduct costPerTick each tick
      const effectiveCost = this.getEffectiveCost(entry.item);
      const costPerTick = effectiveCost / entry.item.buildTime;
      const costThisTick = costPerTick; // deduct one tick's worth of cost
      if (entry.costPaid < effectiveCost) {
        if (this.credits >= costThisTick) {
          const deduct = Math.min(costThisTick, effectiveCost - entry.costPaid);
          this.credits -= deduct;
          entry.costPaid += deduct;
        } else {
          // PR3: Insufficient funds — pause production (don't advance progress)
          continue;
        }
      }
      // Multi-factory linear speedup (C++ parity): N factories = Nx speed
      const factoryCount = this.countPlayerBuildings(entry.item.prerequisite);
      const speedMult = Math.max(1, factoryCount);
      entry.progress += speedMult * powerMult;
      if (entry.progress >= entry.item.buildTime) {
        // Build complete
        if (entry.item.isStructure) {
          // Structure: go into placement mode
          this.pendingPlacement = entry.item;
          this.wallPlacementPrepaid = WALL_TYPES.has(entry.item.type);
          this.productionQueue.delete(category);
          this.audio.play('eva_construction_complete');
        } else {
          // Unit: spawn at the producing structure
          this.spawnProducedUnit(entry.item);
          this.audio.play('eva_unit_ready');
          // If more queued, restart for next unit; otherwise remove
          if (entry.queueCount > 1) {
            entry.queueCount--;
            entry.progress = 0;
            entry.costPaid = 0; // reset for next queued item
          } else {
            this.productionQueue.delete(category);
          }
        }
      }
    }
  }

  /** Count alive player buildings of a given type */
  private countPlayerBuildings(type: string): number {
    let count = 0;
    for (const s of this.structures) {
      if (s.alive && s.type === type && this.isAllied(s.house, this.playerHouse)) {
        count++;
      }
    }
    return count;
  }

  /** AI base rebuild — compare alive structures against blueprint, rebuild missing ones.
   *  C++ parity: IQ >= 2 required, credit cost deducted, priority ordering (power > econ > military > tech). */
  private updateBaseRebuild(): void {
    if (this.baseBlueprint.length === 0) return;

    // Only rebuild if any AI house has IQ >= 2 (C++ parity — low-IQ AI cannot rebuild)
    let anyIqOk = false;
    for (const [, st] of this.aiStates) { if (st.iq >= 2) { anyIqOk = true; break; } }
    if (!anyIqOk) return;

    // Cooldown between rebuilds (30 seconds = 450 ticks)
    if (this.baseRebuildCooldown > 0) {
      this.baseRebuildCooldown--;
      return;
    }

    // Check every 5 seconds (75 ticks)
    if (this.tick % 75 !== 0) return;

    // Find AI houses that have a ConYard (FACT) — required to rebuild
    const aiHousesWithFact = new Set<House>();
    for (const s of this.structures) {
      if (s.alive && s.type === 'FACT' && !this.isAllied(s.house, this.playerHouse)) {
        aiHousesWithFact.add(s.house);
      }
    }
    if (aiHousesWithFact.size === 0) return;

    // Build set of alive structures (type+cell as key)
    const aliveSet = new Set<string>();
    for (const s of this.structures) {
      if (s.alive) aliveSet.add(`${s.type}:${s.cx},${s.cy}`);
    }

    // Queue missing structures from blueprint
    if (this.baseRebuildQueue.length === 0) {
      for (const bp of this.baseBlueprint) {
        if (!aiHousesWithFact.has(bp.house)) continue;
        const pos = { cx: bp.cell % MAP_CELLS, cy: Math.floor(bp.cell / MAP_CELLS) };
        const key = `${bp.type}:${pos.cx},${pos.cy}`;
        if (!aliveSet.has(key)) {
          // Check if cell is available (not blocked by another structure)
          const [fw, fh] = STRUCTURE_SIZE[bp.type] ?? [1, 1];
          let blocked = false;
          for (let dy = 0; dy < fh && !blocked; dy++) {
            for (let dx = 0; dx < fw && !blocked; dx++) {
              for (const s of this.structures) {
                if (s.alive && s.cx === pos.cx + dx && s.cy === pos.cy + dy) {
                  blocked = true;
                  break;
                }
              }
            }
          }
          if (!blocked) {
            this.baseRebuildQueue.push(bp);
          }
        }
      }
      // Priority ordering: POWR/APWR first, then PROC, then production, then defenses, then tech
      const REBUILD_PRIORITY: Record<string, number> = {
        'POWR': 0, 'APWR': 0,
        'PROC': 1,
        'WEAP': 2, 'TENT': 2, 'BARR': 2,
        'GUN': 3, 'TSLA': 3, 'SAM': 3, 'AGUN': 3, 'PBOX': 3, 'HBOX': 3, 'FTUR': 3,
        'DOME': 4, 'FIX': 4, 'SILO': 4,
        'ATEK': 5, 'STEK': 5, 'HPAD': 5, 'AFLD': 5,
      };
      this.baseRebuildQueue.sort((a, b) =>
        (REBUILD_PRIORITY[a.type] ?? 6) - (REBUILD_PRIORITY[b.type] ?? 6)
      );
    }

    // Process one rebuild per cycle
    if (this.baseRebuildQueue.length > 0) {
      const bp = this.baseRebuildQueue.shift()!;
      if (!aiHousesWithFact.has(bp.house)) return;

      // Check IQ gate for this specific house (C++ parity)
      const aiState = this.aiStates.get(bp.house);
      if (aiState && aiState.iq < 2) return;

      // Deduct credit cost for rebuild (C++ parity — AI pays for reconstructions)
      const prodItem = this.scenarioProductionItems.find(p => p.type === bp.type && p.isStructure);
      if (prodItem) {
        const credits = this.houseCredits.get(bp.house) ?? 0;
        if (credits < prodItem.cost) return; // insufficient funds, try next cycle
        this.houseCredits.set(bp.house, credits - prodItem.cost);
      }

      const pos = { cx: bp.cell % MAP_CELLS, cy: Math.floor(bp.cell / MAP_CELLS) };
      this.spawnAIStructure(bp.type, bp.house, pos.cx, pos.cy);

      // Set 30s rebuild cooldown
      this.baseRebuildCooldown = GAME_TICKS_PER_SEC * 30;
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

  /** Spawn an AI structure: look up image/hp, push to structures[], mark footprint impassable.
   *  Extracted from updateBaseRebuild and updateAIConstruction to eliminate duplication. */
  private spawnAIStructure(type: string, house: House, cx: number, cy: number): void {
    const image = STRUCTURE_IMAGES[type] ?? type.toLowerCase();
    const maxHp = STRUCTURE_MAX_HP[type] ?? 256;

    this.structures.push({
      type,
      image,
      house,
      cx,
      cy,
      hp: maxHp,
      maxHp,
      alive: true,
      rubble: false,
      weapon: STRUCTURE_WEAPONS[type],
      attackCooldown: 0,
      ammo: -1,
      maxAmmo: -1,
      buildProgress: 0,
    });

    // Mark footprint as impassable
    const [fw, fh] = STRUCTURE_SIZE[type] ?? [1, 1];
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        this.map.setTerrain(cx + dx, cy + dy, Terrain.WALL);
      }
    }
  }

  /** Spawn an AI unit from a factory: find factory, calculate spawn pos, create entity.
   *  Extracted from updateAIHarvesters and updateAIProduction to eliminate duplication.
   *  Infantry factories (TENT/BARR) use 2x2 footprint offsets; vehicle factories (WEAP) use 3x2. */
  private spawnAIUnit(
    house: House,
    unitType: UnitType,
    factoryType: string,
    mission: Mission = Mission.GUARD,
    guardOrigin?: WorldPos,
  ): Entity | null {
    const isInfantry = factoryType === 'TENT' || factoryType === 'BARR';
    const factory = this.structures.find(s =>
      s.alive && s.house === house && (isInfantry ? (s.type === 'TENT' || s.type === 'BARR') : s.type === factoryType)
    );
    if (!factory) return null;

    let sx: number;
    let sy: number;
    if (isInfantry) {
      // Infantry: spawn at cx+1 cell, cy+2 cells, with random horizontal scatter
      sx = factory.cx * CELL_SIZE + CELL_SIZE + (Math.random() - 0.5) * 24;
      sy = factory.cy * CELL_SIZE + CELL_SIZE * 2;
    } else {
      // Vehicle: spawn at cx+2 cells, cy+2 cells, offset down by CELL_SIZE
      sx = factory.cx * CELL_SIZE + CELL_SIZE * 2;
      sy = factory.cy * CELL_SIZE + CELL_SIZE * 2 + CELL_SIZE;
    }

    const unit = new Entity(unitType, house, sx, sy);
    unit.mission = mission;
    if (guardOrigin) {
      unit.guardOrigin = guardOrigin;
    }
    this.entities.push(unit);
    this.entityById.set(unit.id, unit);
    return unit;
  }

  /** Spawn a produced unit at its factory */
  private spawnProducedUnit(item: ProductionItem): void {
    const factoryType = item.prerequisite;
    // Find the factory building
    let factory: MapStructure | null = null;
    for (const s of this.structures) {
      if (s.alive && s.type === factoryType && this.isAllied(s.house, this.playerHouse)) {
        factory = s;
        break;
      }
    }
    if (!factory) return;

    const unitType = item.type as UnitType;
    const unitStats = UNIT_STATS[item.type];
    const [factW, factH] = STRUCTURE_SIZE[factory.type] ?? [3, 2];

    // Aircraft production: spawn at pad center, docked
    let spawnX: number, spawnY: number;
    if (unitStats?.isAircraft) {
      const [padW, padH] = STRUCTURE_SIZE[factory.type] ?? [2, 2];
      spawnX = (factory.cx + padW / 2) * CELL_SIZE;
      spawnY = (factory.cy + padH / 2) * CELL_SIZE;
      const entity = new Entity(unitType, this.playerHouse, spawnX, spawnY);
      entity.mission = Mission.GUARD;
      entity.aircraftState = 'landed';
      entity.flightAltitude = 0;
      // Dock at factory
      for (let i = 0; i < this.structures.length; i++) {
        if (this.structures[i] === factory) {
          entity.landedAtStructure = i;
          factory.dockedAircraft = entity.id;
          break;
        }
      }
      this.entities.push(entity);
      this.entityById.set(entity.id, entity);
      this.builtAircraftTypes.add(item.type);
      return;
    }

    // Naval production: spawn vessel at adjacent water cell
    if (unitStats?.isVessel) {
      const waterCell = this.map.findAdjacentWaterCell(factory.cx, factory.cy, factW, factH);
      if (!waterCell) return; // no water cell found — production stalls
      spawnX = waterCell.cx * CELL_SIZE + CELL_SIZE / 2;
      spawnY = waterCell.cy * CELL_SIZE + CELL_SIZE / 2;
    } else {
      const spawn = this.findPassableSpawn(factory.cx + 1, factory.cy + 2, factory.cx, factory.cy, factW, factH);
      spawnX = spawn.cx * CELL_SIZE + CELL_SIZE / 2;
      spawnY = spawn.cy * CELL_SIZE + CELL_SIZE / 2;
    }
    const entity = new Entity(unitType, this.playerHouse, spawnX, spawnY);
    entity.mission = Mission.GUARD;
    this.entities.push(entity);
    this.entityById.set(entity.id, entity);
    // Track built unit types for TEVENT_BUILD_UNIT / TEVENT_BUILD_INFANTRY
    if (unitStats?.isInfantry) this.builtInfantryTypes.add(item.type);
    else this.builtUnitTypes.add(item.type);

    // If harvester, set it to auto-harvest
    if (unitType === UnitType.V_HARV) {
      entity.harvesterState = 'idle';
    }

    // Auto-move to rally point if set
    const rally = this.rallyPoints.get(factoryType);
    if (rally && unitType !== UnitType.V_HARV) {
      entity.mission = Mission.MOVE;
      entity.moveTarget = { x: rally.x, y: rally.y };
      entity.path = findPath(this.map, entity.cell, worldToCell(rally.x, rally.y), true, entity.isNavalUnit, entity.stats.speedClass);
      entity.pathIndex = 0;
    }
  }

  /** Place a completed structure on the map */
  placeStructure(cx: number, cy: number): boolean {
    if (!this.pendingPlacement) return false;
    const item = this.pendingPlacement;
    const isWall = WALL_TYPES.has(item.type);
    // Walls after the first need to check credits (first wall paid at production start)
    if (isWall && this.credits < item.cost) return false;
    const [fw, fh] = STRUCTURE_SIZE[item.type] ?? [2, 2];
    // Validate: cells must be passable and within bounds
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        if (!this.map.isPassable(cx + dx, cy + dy)) return false;
      }
    }
    // Walls can be placed anywhere passable (C++ parity — no adjacency requirement for walls)
    // Non-wall structures must be adjacent to an existing player structure (footprint-based AABB)
    if (!isWall) {
      let adjacent = false;
      for (const s of this.structures) {
        if (!s.alive || !this.isAllied(s.house, this.playerHouse)) continue;
        const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
        const exL = s.cx - 1, exT = s.cy - 1, exR = s.cx + sw + 1, exB = s.cy + sh + 1;
        const nL = cx, nT = cy, nR = cx + fw, nB = cy + fh;
        if (nL < exR && nR > exL && nT < exB && nB > exT) { adjacent = true; break; }
      }
      if (!adjacent) return false;
    }

    const image = item.type.toLowerCase();
    const maxHp = STRUCTURE_MAX_HP[item.type] ?? 256;
    // Create structure with construction animation
    const newStruct: MapStructure = {
      type: item.type,
      image,
      house: this.playerHouse,
      cx, cy,
      hp: maxHp,
      maxHp,
      alive: true,
      rubble: false,
      weapon: STRUCTURE_WEAPONS[item.type],
      attackCooldown: 0,
      ammo: -1,
      maxAmmo: -1,
      buildProgress: isWall ? undefined : 0, // walls appear instantly
    };
    this.structures.push(newStruct);
    // Mark cells as impassable
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        this.map.setTerrain(cx + dx, cy + dy, Terrain.WALL);
      }
    }
    // Store wall type for auto-connection sprite rendering
    if (isWall) {
      this.map.setWallType(cx, cy, item.type);
    }
    // For walls: keep pendingPlacement active for continuous placement
    if (isWall) {
      if (this.wallPlacementPrepaid) {
        this.wallPlacementPrepaid = false; // first wall was paid at production start
      } else {
        this.credits -= this.getEffectiveCost(item); // subsequent walls deducted on placement
      }
    } else {
      this.pendingPlacement = null;
    }

    this.audio.play('building_placed');
    this.audio.play('eva_building');
    // Check if placing this structure unlocks new production items
    const oldItems = this.cachedAvailableItems ?? [];
    this.cachedAvailableItems = null; // force recompute
    const newItems = this.getAvailableItems();
    if (newItems.length > oldItems.length) {
      this.audio.play('eva_new_options');
      this.evaMessages.push({ text: 'NEW CONSTRUCTION OPTIONS', tick: this.tick });
    }
    // Spawn free harvester with refinery
    if (item.type === 'PROC') {
      const harvSpawn = this.findPassableSpawn(cx + 1, cy + fh, cx, cy, fw, fh);
      const harv = new Entity(UnitType.V_HARV, this.playerHouse,
        harvSpawn.cx * CELL_SIZE + CELL_SIZE / 2, harvSpawn.cy * CELL_SIZE + CELL_SIZE / 2);
      harv.harvesterState = 'idle';
      this.entities.push(harv);
      this.entityById.set(harv.id, harv);
    }
    return true;
  }

  /** Deploy MCV at its current location → FACT structure */
  deployMCV(entity: Entity): boolean {
    if (entity.type !== UnitType.V_MCV || !entity.alive) return false;
    const ec = entity.cell;
    // Need a 3x3 clear area
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!this.map.isPassable(ec.cx + dx, ec.cy + dy)) return false;
      }
    }
    // Remove the MCV entity
    entity.alive = false;
    entity.mission = Mission.DIE;
    // Place a Construction Yard
    const cx = ec.cx - 1;
    const cy = ec.cy - 1;
    const factMaxHp = STRUCTURE_MAX_HP['FACT'] ?? 256;
    const newStruct: MapStructure = {
      type: 'FACT',
      image: 'fact',
      house: this.playerHouse,
      cx, cy,
      hp: factMaxHp,
      maxHp: factMaxHp,
      alive: true,
      rubble: false,
      attackCooldown: 0,
      ammo: -1,
      maxAmmo: -1,
    };
    this.structures.push(newStruct);
    // Mark 3x3 footprint
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        this.map.setTerrain(cx + dx, cy + dy, Terrain.WALL);
      }
    }
    this.audio.play('eva_acknowledged');
    this.effects.push({
      type: 'explosion', x: entity.pos.x, y: entity.pos.y,
      frame: 0, maxFrames: 15, size: 10, sprite: 'piffpiff', spriteStart: 0,
    });
    return true;
  }

  /** Map INI crate reward name to our CrateType */
  private static readonly CRATE_NAME_MAP: Record<string, CrateType> = {
    money: 'money', heal: 'heal', veterancy: 'heal', unit: 'unit',
    armor: 'armor', firepower: 'firepower', speed: 'speed',
    reveal: 'reveal', darkness: 'darkness', explosion: 'explosion',
    squad: 'squad', heal_base: 'heal_base', napalm: 'napalm',
    cloak: 'cloak', invulnerability: 'invulnerability',
    parabomb: 'parabomb', sonar: 'sonar', icbm: 'icbm',
    timequake: 'timequake', vortex: 'vortex',
  };

    /** CR9: Weighted crate share distribution (C++ CrateShares from rules.ini) */
  private static readonly CRATE_SHARES: Array<{ type: CrateType; shares: number }> = [
    { type: 'money', shares: 50 },
    { type: 'unit', shares: 20 },
    { type: 'speed', shares: 10 },
    { type: 'firepower', shares: 10 },
    { type: 'armor', shares: 10 },
    { type: 'reveal', shares: 5 },
    { type: 'cloak', shares: 3 },
    { type: 'heal', shares: 15 },
    { type: 'explosion', shares: 5 },
    { type: 'parabomb', shares: 3 },
    { type: 'sonar', shares: 2 },
    { type: 'icbm', shares: 1 },
    { type: 'timequake', shares: 1 },
    { type: 'vortex', shares: 1 },
  ];

  /** CR9: Select a crate type using weighted random distribution */
  private static weightedCrateType(): CrateType {
    const shares = Game.CRATE_SHARES;
    const totalShares = shares.reduce((sum, s) => sum + s.shares, 0);
    let roll = Math.random() * totalShares;
    for (const entry of shares) {
      roll -= entry.shares;
      if (roll <= 0) return entry.type;
    }
    return shares[shares.length - 1].type; // fallback
  }

  private spawnCrate(): void {
    // CR9: Use weighted CrateShares distribution (C++ rules.ini)
    let type = Game.weightedCrateType();
    // Apply INI crate overrides if present
    if (this.crateOverrides.silver) {
      const t = Game.CRATE_NAME_MAP[this.crateOverrides.silver];
      if (t) type = t;
    }
    // CR6: Crate lifetime = Random(CrateTime/2, CrateTime*2) in minutes, default CrateTime=10
    // So 5-20 minutes, converted to ticks (x 15 FPS x 60 seconds/min)
    const crateTimeMin = 10; // minutes (C++ default CrateTime)
    const minLifetime = Math.floor(crateTimeMin / 2); // 5 minutes
    const maxLifetime = crateTimeMin * 2; // 20 minutes
    const lifetimeMinutes = minLifetime + Math.random() * (maxLifetime - minLifetime);
    const lifetimeTicks = Math.floor(lifetimeMinutes * 60 * GAME_TICKS_PER_SEC);
    // Try up to 20 random cells to find a valid spawn
    for (let attempt = 0; attempt < 20; attempt++) {
      const cx = this.map.boundsX + Math.floor(Math.random() * this.map.boundsW);
      const cy = this.map.boundsY + Math.floor(Math.random() * this.map.boundsH);
      if (!this.map.isPassable(cx, cy)) continue;
      if (this.map.getVisibility(cx, cy) === 0) continue; // must be explored
      const x = cx * CELL_SIZE + CELL_SIZE / 2;
      const y = cy * CELL_SIZE + CELL_SIZE / 2;
      this.crates.push({ x, y, type, tick: this.tick, lifetime: lifetimeTicks });
      return;
    }
  }

  /** Apply crate bonus to the unit that picked it up */
  private pickupCrate(crate: Crate, unit: Entity): void {
    this.playSoundAt('crate_pickup', crate.x, crate.y);
    this.effects.push({
      type: 'explosion', x: crate.x, y: crate.y,
      frame: 0, maxFrames: 10, size: 8, sprite: 'piffpiff', spriteStart: 0,
    });
    switch (crate.type) {
      case 'money':
        // CR1: C++ solo play gives 2000 credits from money crate
        this.addCredits(2000, true);
        this.evaMessages.push({ text: 'MONEY CRATE', tick: this.tick });
        break;
      case 'heal':
        unit.hp = unit.maxHp;
        this.evaMessages.push({ text: 'UNIT HEALED', tick: this.tick });
        break;
      case 'unit': {
        // Spawn a random unit nearby — includes expansion units
        const types = [
          UnitType.I_E1, UnitType.I_E2, UnitType.I_E3, UnitType.I_E4,
          UnitType.I_SHOK, UnitType.I_MECH,          // CS/Aftermath infantry
          UnitType.V_JEEP, UnitType.V_1TNK,            // base vehicles
          UnitType.V_STNK, UnitType.V_CTNK,           // CS expansion vehicles
        ];
        const uType = types[Math.floor(Math.random() * types.length)];
        const bonus = new Entity(uType, this.playerHouse, crate.x + CELL_SIZE, crate.y);
        bonus.mission = Mission.GUARD;
        this.entities.push(bonus);
        this.entityById.set(bonus.id, bonus);
        this.evaMessages.push({ text: 'REINFORCEMENTS', tick: this.tick });
        break;
      }
      case 'armor':
        // CR2: Set armorBias = 2 (half damage taken) — C++ ArmorBias, NOT double maxHp
        unit.armorBias = 2;
        this.evaMessages.push({ text: 'ARMOR UPGRADE', tick: this.tick });
        break;
      case 'firepower':
        // CR3: Set firepowerBias = 2 (double damage output) — C++ FirepowerBias
        unit.firepowerBias = 2;
        this.evaMessages.push({ text: 'FIREPOWER UPGRADE', tick: this.tick });
        break;
      case 'speed':
        // CR7: 1.5× speed boost — C++ rules.cpp SpeedBias=1.5 (verified)
        unit.speedBias = 1.5;
        this.evaMessages.push({ text: 'SPEED UPGRADE', tick: this.tick });
        break;
      case 'reveal':
        // CR4: Reveal entire map for the player's house (C++ IsVisionary equivalent)
        this.visionaryHouses.add(unit.house);
        this.map.revealAll();
        this.evaMessages.push({ text: 'MAP REVEALED', tick: this.tick });
        break;
      case 'darkness': {
        // Shroud 7x7 cells around crate
        const cc = worldToCell(crate.x, crate.y);
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            this.map.setVisibility(cc.cx + dx, cc.cy + dy, 0);
          }
        }
        this.evaMessages.push({ text: 'DARKNESS', tick: this.tick });
        break;
      }
      case 'explosion': {
        // 200 HP damage to all units in 3-cell radius
        for (const e of this.entities) {
          if (!e.alive) continue;
          const d = worldDist(e.pos, { x: crate.x, y: crate.y });
          if (d <= 3) {
            this.damageEntity(e, 200, 'HE');
          }
        }
        this.effects.push({ type: 'explosion', x: crate.x, y: crate.y, frame: 0, maxFrames: EXPLOSION_FRAMES.atomsfx, size: 20, sprite: 'atomsfx', spriteStart: 0, blendMode: 'screen' });
        this.evaMessages.push({ text: 'BOOBY TRAP!', tick: this.tick });
        break;
      }
      case 'squad': {
        // Spawn 5 random infantry at crate location
        const infTypes = [UnitType.I_E1, UnitType.I_E2, UnitType.I_E3, UnitType.I_E4, UnitType.I_E1];
        for (let i = 0; i < 5; i++) {
          const t = infTypes[Math.floor(Math.random() * infTypes.length)];
          const ox = (Math.random() - 0.5) * CELL_SIZE * 2;
          const oy = (Math.random() - 0.5) * CELL_SIZE * 2;
          const inf = new Entity(t, this.playerHouse, crate.x + ox, crate.y + oy);
          inf.mission = Mission.GUARD;
          this.entities.push(inf);
          this.entityById.set(inf.id, inf);
        }
        this.evaMessages.push({ text: 'SQUAD REINFORCEMENT', tick: this.tick });
        break;
      }
      case 'heal_base': {
        // Heal all player structures +20% HP
        for (const s of this.structures) {
          if (s.alive && this.isAllied(s.house, this.playerHouse)) {
            s.hp = Math.min(s.maxHp, s.hp + Math.ceil(s.maxHp * 0.2));
          }
        }
        this.evaMessages.push({ text: 'BASE REPAIRED', tick: this.tick });
        break;
      }
      case 'napalm': {
        // Fire effects in 3x3 grid
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const fx = crate.x + dx * CELL_SIZE;
            const fy = crate.y + dy * CELL_SIZE;
            this.effects.push({ type: 'explosion', x: fx, y: fy, frame: 0, maxFrames: EXPLOSION_FRAMES.napalm1, size: 12, sprite: 'napalm1', spriteStart: 0, blendMode: 'screen' });
            // Damage units in each cell
            for (const e of this.entities) {
              if (!e.alive) continue;
              const d = worldDist(e.pos, { x: fx, y: fy });
              if (d <= 1) this.damageEntity(e, 80, 'Fire');
            }
          }
        }
        this.evaMessages.push({ text: 'NAPALM STRIKE', tick: this.tick });
        break;
      }
      case 'cloak':
        // CR5: Permanent cloaking ability (C++ IsCloakable from crate)
        unit.isCloakable = true;
        this.evaMessages.push({ text: 'UNIT CLOAKED', tick: this.tick });
        break;
      case 'invulnerability':
        // 20 seconds invincibility (300 ticks)
        unit.invulnTick = 300;
        this.evaMessages.push({ text: 'INVULNERABILITY', tick: this.tick });
        break;
      case 'parabomb': {
        // CR8: ParaBomb — airstrike at crate location (C++ RULES.INI ParaBomb weapon)
        const crateBombDmg = WEAPON_STATS.ParaBomb.damage;
        for (let i = -3; i <= 3; i++) {
          const bx = crate.x + i * CELL_SIZE;
          const by = crate.y;
          this.effects.push({
            type: 'explosion', x: bx, y: by,
            frame: 0, maxFrames: EXPLOSION_FRAMES['art-exp1'] ?? 22, size: 16,
            sprite: 'art-exp1', spriteStart: 0,
          });
          for (const e of this.entities) {
            if (!e.alive) continue;
            if (worldDist(e.pos, { x: bx, y: by }) <= 1.5) {
              this.damageEntity(e, crateBombDmg, 'HE');
            }
          }
        }
        this.audio.play('explode_lg');
        this.evaMessages.push({ text: 'PARABOMB STRIKE', tick: this.tick });
        break;
      }
      case 'sonar':
        // CR8: Sonar — activate sonar pulse (reveal all subs for SONAR_PULSE_DURATION ticks)
        for (const e of this.entities) {
          if (!e.alive || !e.stats.isCloakable) continue;
          if (this.isAllied(e.house, unit.house)) continue;
          e.sonarPulseTimer = SONAR_PULSE_DURATION;
        }
        this.audio.play('cannon'); // sonar ping
        this.evaMessages.push({ text: 'SONAR PULSE', tick: this.tick });
        break;
      case 'icbm': {
        // CR8: ICBM — trigger a nuke strike at a random enemy structure
        const enemyStructs = this.structures.filter(s =>
          s.alive && !this.isAllied(s.house, unit.house)
        );
        if (enemyStructs.length > 0) {
          const target = enemyStructs[Math.floor(Math.random() * enemyStructs.length)];
          const tx = target.cx * CELL_SIZE + CELL_SIZE;
          const ty = target.cy * CELL_SIZE + CELL_SIZE;
          this.detonateNuke({ x: tx, y: ty });
          this.evaMessages.push({ text: 'ICBM LAUNCHED', tick: this.tick });
        } else {
          // No enemy structures — fallback to money crate
          this.addCredits(2000, true);
          this.evaMessages.push({ text: 'MONEY CRATE', tick: this.tick });
        }
        break;
      }
      case 'timequake': {
        // CR8: TimeQuake — damages ALL units AND structures on map (friend and foe) for 100-300 random damage
        for (const e of this.entities) {
          if (!e.alive) continue;
          const dmg = 100 + Math.floor(Math.random() * 201); // 100-300
          this.damageEntity(e, dmg, 'HE');
        }
        for (const s of this.structures) {
          if (!s.alive) continue;
          const dmg = 100 + Math.floor(Math.random() * 201);
          this.damageStructure(s, dmg);
        }
        this.renderer.screenShake = Math.max(this.renderer.screenShake, 15);
        this.audio.play('explode_lg');
        this.evaMessages.push({ text: 'TIME QUAKE', tick: this.tick });
        break;
      }
      case 'vortex': {
        // CR8: Vortex — spawns a wandering energy vortex that damages nearby units for ~30 seconds
        this.activeVortices.push({
          x: crate.x, y: crate.y, angle: Math.random() * Math.PI * 2, ticksLeft: 450, id: this.tick,
        });
        this.audio.play('teslazap');
        this.evaMessages.push({ text: 'VORTEX SPAWNED', tick: this.tick });
        break;
      }
    }
  }

  // ─── Superweapon System ─────────────────────────────────

  /** Scan structures for superweapon buildings, update charge, auto-fire GPS/Sonar */
  updateSuperweapons(): void {
    const isLowPower = this.powerConsumed > this.powerProduced && this.powerProduced > 0;
    const activeBuildings = new Set<string>(); // track which sw keys have active buildings

    // Scan structures for superweapon buildings
    for (let i = 0; i < this.structures.length; i++) {
      const s = this.structures[i];
      if (!s.alive || (s.buildProgress !== undefined && s.buildProgress < 1)) continue;

      // Check each superweapon def to see if this structure provides it
      for (const def of Object.values(SUPERWEAPON_DEFS)) {
        if (s.type !== def.building) continue;

        const key = `${s.house}:${def.type}`;
        activeBuildings.add(key);

        let state = this.superweapons.get(key);
        if (!state) {
          state = {
            type: def.type,
            house: s.house,
            chargeTick: 0,
            ready: false,
            structureIndex: i,
            fired: false,
          };
          this.superweapons.set(key, state);
        }
        state.structureIndex = i;

        // Charge: increment if building is alive and powered
        if (!state.ready && !state.fired) {
          const chargeRate = (def.requiresPower && isLowPower &&
            this.isAllied(s.house, this.playerHouse)) ? 0.25 : 1;
          state.chargeTick = Math.min(state.chargeTick + chargeRate, def.rechargeTicks);
          if (state.chargeTick >= def.rechargeTicks) {
            state.ready = true;
            // EVA announcement for player
            if (this.isAllied(s.house, this.playerHouse)) {
              this.pushEva(`${def.name} ready`);
            }
          }
        }

        // Auto-fire GPS Satellite (one-shot)
        if (def.type === SuperweaponType.GPS_SATELLITE && state.ready && !state.fired) {
          this.map.revealAll();
          state.fired = true;
          state.ready = false;
          if (this.isAllied(s.house, this.playerHouse)) {
            this.pushEva('GPS satellite launched');
            // GPS sweep visual
            this.effects.push({
              type: 'marker', x: this.camera.x + this.camera.viewWidth / 2,
              y: this.camera.y, frame: 0, maxFrames: 60, size: 2,
              markerColor: 'rgba(80,200,255,0.3)',
            });
          }
        }

        // Auto-fire Sonar Pulse
        if (def.type === SuperweaponType.SONAR_PULSE && state.ready) {
          // Reveal all enemy submarines for 450 ticks
          for (const e of this.entities) {
            if (!e.alive || !e.stats.isCloakable) continue;
            if (this.isAllied(e.house, s.house)) continue;
            e.sonarPulseTimer = SONAR_REVEAL_TICKS;
          }
          state.ready = false;
          state.chargeTick = 0;
          // AU5: Sonar SFX — play sonar ping sound
          this.audio.play('cannon'); // sonar ping approximation
          if (this.isAllied(s.house, this.playerHouse)) {
            this.pushEva('Sonar pulse activated');
          }
        }
      }
    }

    // Spy-granted sonar pulse: charge, auto-fire, and maintenance (C++ house.cpp:1605-1627)
    for (const [key, state] of this.superweapons) {
      if (state.type !== SuperweaponType.SONAR_PULSE) continue;
      // Maintenance: check if spied enemy SPEN still exists (C++ house.cpp:1611-1625)
      const spyHouse = state.house as House;
      const targetHouse = this.sonarSpiedTarget.get(spyHouse);
      if (targetHouse !== undefined) {
        const enemySpenAlive = this.structures.some(s =>
          s.alive && s.house === targetHouse && s.type === 'SPEN'
        );
        if (!enemySpenAlive) {
          this.superweapons.delete(key);
          this.sonarSpiedTarget.delete(spyHouse);
          if (this.isAllied(spyHouse, this.playerHouse)) {
            this.pushEva('Sonar pulse lost');
          }
          continue;
        }
      }
      activeBuildings.add(key); // prevent cleanup from deleting spy-granted sonar
      if (!state.ready && !state.fired) {
        const chargeRate = (isLowPower && this.isAllied(state.house as House, this.playerHouse)) ? 0.25 : 1;
        state.chargeTick = Math.min(state.chargeTick + chargeRate, SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks);
        if (state.chargeTick >= SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks) {
          state.ready = true;
          if (this.isAllied(state.house as House, this.playerHouse)) {
            this.pushEva('Sonar pulse ready');
          }
        }
      }
      if (state.ready) {
        for (const e of this.entities) {
          if (!e.alive || !e.stats.isCloakable) continue;
          if (this.isAllied(e.house, state.house as House)) continue;
          e.sonarPulseTimer = SONAR_REVEAL_TICKS;
        }
        state.ready = false;
        state.chargeTick = 0;
        this.audio.play('cannon');
        if (this.isAllied(state.house as House, this.playerHouse)) {
          this.pushEva('Sonar pulse activated');
        }
      }
    }

    // Remove entries for destroyed buildings (spy-granted sonar exempted above)
    for (const [key] of this.superweapons) {
      if (!activeBuildings.has(key)) {
        this.superweapons.delete(key);
      }
    }

    // AI superweapon usage — C++ parity: IQ >= 3 houses fire superweapons automatically
    for (const [, state] of this.superweapons) {
      if (!state.ready) continue;
      if (this.isAllied(state.house as House, this.playerHouse)) continue;
      const def = SUPERWEAPON_DEFS[state.type];
      if (!def.needsTarget) continue; // GPS/Sonar auto-fire handled above

      // IQ gate: AI must have IQ >= 3 to use superweapons
      const aiState = this.aiStates.get(state.house as House);
      if (aiState && aiState.iq < 3) continue;

      if (state.type === SuperweaponType.NUKE) {
        // AI nuke: target player's highest-value structure cluster
        const target = this.findBestNukeTarget(state.house);
        if (target) {
          this.activateSuperweapon(SuperweaponType.NUKE, state.house, target);
        }
      } else if (state.type === SuperweaponType.IRON_CURTAIN) {
        // AI Iron Curtain: prefer attacking units, fall back to most expensive unit
        let bestUnit: Entity | null = null;
        let bestScore = 0;
        for (const e of this.entities) {
          if (!e.alive || e.house !== state.house || e.stats.isInfantry) continue;
          // Prefer units currently attacking or hunting — they benefit most from invulnerability
          const missionBonus = (e.mission === Mission.ATTACK || e.mission === Mission.HUNT) ? 2 : 1;
          const value = (e.stats.cost ?? e.stats.strength) * missionBonus;
          if (value > bestScore) {
            bestScore = value;
            bestUnit = e;
          }
        }
        if (bestUnit) {
          this.activateSuperweapon(SuperweaponType.IRON_CURTAIN, state.house, bestUnit.pos);
        }
      } else if (state.type === SuperweaponType.CHRONOSPHERE) {
        // AI Chronosphere: teleport best tank near enemy base (IQ >= 3)
        if (aiState && aiState.iq >= 3) {
          let bestTank: Entity | null = null;
          let bestValue = 0;
          for (const e of this.entities) {
            if (!e.alive || e.house !== state.house) continue;
            if (e.stats.isInfantry || e.stats.isAircraft || e.stats.isVessel) continue;
            if (e.type === UnitType.V_HARV || e.type === UnitType.V_MCV || e.type === UnitType.V_CTNK) continue;
            const val = e.stats.cost ?? e.stats.strength;
            if (val > bestValue) { bestValue = val; bestTank = e; }
          }
          if (bestTank) {
            // Find enemy base structure to teleport near
            let targetPos: WorldPos | null = null;
            for (const s of this.structures) {
              if (!s.alive || this.isAllied(s.house, state.house as House)) continue;
              if (s.type === 'FACT' || s.type === 'WEAP' || s.type === 'PROC') {
                const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
                targetPos = {
                  x: (s.cx + w / 2) * CELL_SIZE,
                  y: (s.cy + h / 2 + 2) * CELL_SIZE, // 2 cells below structure
                };
                break;
              }
            }
            if (targetPos) {
              // Mark the tank as "selected" temporarily so activateSuperweapon can find it
              bestTank.selected = true;
              this.activateSuperweapon(SuperweaponType.CHRONOSPHERE, state.house as House, targetPos);
              bestTank.selected = false;
            }
          }
        }
      } else if (state.type === SuperweaponType.PARABOMB) {
        // AI Parabomb: target player's largest unit cluster
        const target = this.findBestNukeTarget(state.house);
        if (target) {
          this.activateSuperweapon(SuperweaponType.PARABOMB, state.house, target);
        }
      } else if (state.type === SuperweaponType.PARAINFANTRY) {
        // AI Paratroopers: drop near own base as reinforcements
        const aiStructs = this.structures.filter(s => s.alive && s.house === state.house);
        if (aiStructs.length > 0) {
          const base = aiStructs[0];
          const tx = base.cx * CELL_SIZE + CELL_SIZE * 3;
          const ty = base.cy * CELL_SIZE + CELL_SIZE * 3;
          this.activateSuperweapon(SuperweaponType.PARAINFANTRY, state.house, { x: tx, y: ty });
        }
      } else if (state.type === SuperweaponType.SPY_PLANE) {
        // AI Spy Plane: reveal area around enemy base
        for (const s of this.structures) {
          if (!s.alive || this.isAllied(s.house, state.house as House)) continue;
          const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
          const target = {
            x: (s.cx + w / 2) * CELL_SIZE,
            y: (s.cy + h / 2) * CELL_SIZE,
          };
          this.activateSuperweapon(SuperweaponType.SPY_PLANE, state.house as House, target);
          break; // one target is enough
        }
      }
    }
  }

  /** Activate a superweapon at a target position */
  activateSuperweapon(type: SuperweaponType, house: House, target: WorldPos): void {
    const key = `${house}:${type}`;
    const state = this.superweapons.get(key);
    if (!state || !state.ready) return;

    const def = SUPERWEAPON_DEFS[type];
    state.ready = false;
    state.chargeTick = 0;

    switch (type) {
      case SuperweaponType.CHRONOSPHERE: {
        // Teleport first selected player unit to target (C++: CTNK excluded — has own teleport)
        const selected = this.entities.filter(e =>
          e.alive && e.selected && e.house === house && !e.stats.isInfantry
          && e.type !== UnitType.V_CTNK
        );
        const unit = selected[0];
        if (unit) {
          const origin = { x: unit.pos.x, y: unit.pos.y };
          unit.pos.x = target.x;
          unit.pos.y = target.y;
          unit.prevPos.x = target.x;
          unit.prevPos.y = target.y;
          unit.chronoShiftTick = CHRONO_SHIFT_VISUAL_TICKS;
          // Blue flash effects at origin and destination
          this.effects.push({
            type: 'explosion', x: origin.x, y: origin.y,
            frame: 0, maxFrames: 20, size: 24,
            sprite: 'litning', spriteStart: 0,
          });
          this.effects.push({
            type: 'explosion', x: target.x, y: target.y,
            frame: 0, maxFrames: 20, size: 24,
            sprite: 'litning', spriteStart: 0,
          });
          this.audio.play('chrono');
          if (this.isAllied(house, this.playerHouse)) {
            this.pushEva('Chronosphere activated');
          }
        }
        break;
      }
      case SuperweaponType.IRON_CURTAIN: {
        // Find unit or structure nearest to target
        let bestEntity: Entity | null = null;
        let bestDist = Infinity;
        for (const e of this.entities) {
          if (!e.alive || !this.isAllied(e.house, house)) continue;
          const d = worldDist(e.pos, target);
          if (d < bestDist && d < 3) {
            bestDist = d;
            bestEntity = e;
          }
        }
        if (bestEntity) {
          bestEntity.ironCurtainTick = IRON_CURTAIN_DURATION;
          this.effects.push({
            type: 'explosion', x: bestEntity.pos.x, y: bestEntity.pos.y,
            frame: 0, maxFrames: 15, size: 20,
          });
          this.audio.play('iron_curtain');
          if (this.isAllied(house, this.playerHouse)) {
            this.pushEva('Iron Curtain activated');
          }
        }
        break;
      }
      case SuperweaponType.NUKE: {
        // Launch missile from MSLO — arrives after 45 ticks
        const s = this.structures[state.structureIndex];
        if (s) {
          this.nukePendingTarget = { x: target.x, y: target.y };
          this.nukePendingTick = NUKE_FLIGHT_TICKS;
          this.nukePendingSource = { x: s.cx * CELL_SIZE + CELL_SIZE, y: s.cy * CELL_SIZE + CELL_SIZE };
          // Rising missile effect from silo
          this.effects.push({
            type: 'projectile',
            x: s.cx * CELL_SIZE + CELL_SIZE, y: s.cy * CELL_SIZE + CELL_SIZE,
            startX: s.cx * CELL_SIZE + CELL_SIZE, startY: s.cy * CELL_SIZE + CELL_SIZE,
            endX: target.x, endY: target.y,
            frame: 0, maxFrames: 45, size: 4,
            projStyle: 'rocket',
          });
          this.audio.play('nuke_launch');
          if (this.isAllied(house, this.playerHouse)) {
            this.pushEva('Nuclear warhead launched');
          } else {
            // Warn player when enemy launches nuke
            this.pushEva('Warning: nuclear launch detected');
          }
        }
        break;
      }
      case SuperweaponType.PARABOMB: {
        // SW6: Parabomb — Badger bomber drops bombs in a line (C++ RULES.INI ParaBomb weapon)
        const pbDmg = WEAPON_STATS.ParaBomb.damage;
        const bombCount = 7;
        const spacing = CELL_SIZE;
        for (let i = -Math.floor(bombCount / 2); i <= Math.floor(bombCount / 2); i++) {
          const bx = target.x + i * spacing;
          const by = target.y;
          const delay = (i + Math.floor(bombCount / 2)) * 5; // staggered detonation
          // Deferred bomb explosion — uses timed effects
          this.effects.push({
            type: 'explosion', x: bx, y: by,
            frame: -delay, maxFrames: 17 + delay, size: 14,
          });
          // Damage entities at each bomb point after delay (approximate via immediate splash)
          for (const e of this.entities) {
            if (!e.alive) continue;
            const d = worldDist(e.pos, { x: bx, y: by });
            if (d <= 1.5) {
              const falloff = Math.max(0.3, 1 - d / 1.5);
              this.damageEntity(e, Math.round(pbDmg * falloff), 'HE');
            }
          }
          for (const s of this.structures) {
            if (!s.alive) continue;
            const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
            const sx = s.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
            const sy = s.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
            const d = worldDist({ x: bx, y: by }, { x: sx, y: sy });
            if (d <= 1.5) this.damageStructure(s, Math.round(pbDmg * Math.max(0.3, 1 - d / 1.5)));
          }
        }
        this.renderer.screenShake = Math.max(this.renderer.screenShake, 10);
        this.audio.play('explode_lg');
        if (this.isAllied(house, this.playerHouse)) {
          this.pushEva('Parabombs away');
        }
        break;
      }
      case SuperweaponType.PARAINFANTRY: {
        // SW6: Paratroopers — drop 5 rifle infantry at target location
        const paraTypes = [
          UnitType.I_E1, UnitType.I_E1, UnitType.I_E1,
          UnitType.I_E1, UnitType.I_E1,
        ];
        for (let i = 0; i < paraTypes.length; i++) {
          const px = target.x + ((i % 3) - 1) * CELL_SIZE;
          const py = target.y + Math.floor(i / 3) * CELL_SIZE;
          const pc = worldToCell(px, py);
          if (!this.map.isPassable(pc.cx, pc.cy)) continue;
          const inf = new Entity(paraTypes[i], house, px, py);
          inf.mission = Mission.GUARD;
          this.entities.push(inf);
          this.entityById.set(inf.id, inf);
          // Parachute drop visual
          this.effects.push({
            type: 'marker', x: px, y: py,
            frame: 0, maxFrames: 20, size: 14, markerColor: 'rgba(200,200,255,0.8)',
          });
        }
        this.audio.play('eva_reinforcements');
        if (this.isAllied(house, this.playerHouse)) {
          this.pushEva('Reinforcements have arrived');
        }
        break;
      }
      case SuperweaponType.SPY_PLANE: {
        // SW6: Spy Plane — permanently reveals 10-cell radius around target (matches C++ fog behavior)
        const revealRadius = 10;
        const tc = worldToCell(target.x, target.y);
        const r2 = revealRadius * revealRadius;
        for (let dy = -revealRadius; dy <= revealRadius; dy++) {
          for (let dx = -revealRadius; dx <= revealRadius; dx++) {
            if (dx * dx + dy * dy <= r2) {
              this.map.setVisibility(tc.cx + dx, tc.cy + dy, 2);
            }
          }
        }
        // Visual flyover effect — marker sweeps across reveal zone
        this.effects.push({
          type: 'marker', x: target.x, y: target.y,
          frame: 0, maxFrames: 30, size: 20, markerColor: 'rgba(100,200,255,0.5)',
        });
        this.audio.play('eva_acknowledged');
        if (this.isAllied(house, this.playerHouse)) {
          this.pushEva('Spy plane mission complete');
        }
        break;
      }
    }
  }

  /** Detonate nuclear warhead at target position */
  private detonateNuke(target: WorldPos): void {
    // AU5: Nuke detonation SFX
    this.audio.play('nuke_explode');
    // Intense screen flash + extended shake (C++ nuke visual impact)
    this.renderer.screenFlash = 30;
    this.renderer.screenShake = 30;

    // Apply nuke damage in blast radius using Super warhead
    const blastRadius = CELL_SIZE * NUKE_BLAST_CELLS;
    const nukeWeapon = { damage: NUKE_DAMAGE, warhead: 'Super' as WarheadType, splash: blastRadius };

    // Damage entities in splash radius
    for (const e of this.entities) {
      if (!e.alive) continue;
      const dist = worldDist(e.pos, target);
      if (dist > blastRadius) continue;
      const falloff = Math.max(NUKE_MIN_FALLOFF, 1 - dist / blastRadius);
      const mult = this.getWarheadMult('Super', e.stats.armor);
      const dmg = Math.max(1, Math.round(NUKE_DAMAGE * mult * falloff));
      const killed = this.damageEntity(e, dmg, 'Super');
      if (killed) {
        if (e.isPlayerUnit) this.lossCount++;
        else this.killCount++;
      }
    }

    // Damage structures in blast radius
    for (const s of this.structures) {
      if (!s.alive) continue;
      const sx = s.cx * CELL_SIZE + CELL_SIZE;
      const sy = s.cy * CELL_SIZE + CELL_SIZE;
      const dist = worldDist({ x: sx, y: sy }, target);
      if (dist > blastRadius) continue;
      const falloff = Math.max(NUKE_MIN_FALLOFF, 1 - dist / blastRadius);
      const dmg = Math.max(1, Math.round(NUKE_DAMAGE * falloff));
      s.hp -= dmg;
      if (s.hp <= 0) {
        s.hp = 0;
        s.alive = false;
        // GAP1: unjam shroud when Gap Generator is nuked
        if (s.type === 'GAP') {
          const si = this.structures.indexOf(s);
          if (si >= 0 && this.gapGeneratorCells.has(si)) {
            const prev = this.gapGeneratorCells.get(si)!;
            this.map.unjamRadius(prev.cx, prev.cy, prev.radius);
            this.gapGeneratorCells.delete(si);
          }
        }
        this.effects.push({
          type: 'explosion', x: sx, y: sy,
          frame: 0, maxFrames: EXPLOSION_FRAMES['fball1'] ?? 18, size: 32,
          sprite: 'fball1', spriteStart: 0,
        });
      }
    }

    // Mushroom cloud effect (large, long-lasting)
    this.effects.push({
      type: 'explosion', x: target.x, y: target.y,
      frame: 0, maxFrames: 45, size: 48,
      sprite: 'atomsfx', spriteStart: 0,
      blendMode: 'screen',
    });

    // Secondary ground explosions — ring of staggered blasts around impact (C++ large explosion radius)
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
      const dist = CELL_SIZE * (1.5 + Math.random() * 2);
      const gx = target.x + Math.cos(angle) * dist;
      const gy = target.y + Math.sin(angle) * dist;
      this.effects.push({
        type: 'explosion', x: gx, y: gy,
        frame: -i * 3, maxFrames: 20, size: 16,
        sprite: 'fball1', spriteStart: 0,
      });
    }

    // Scorched earth at ground zero
    const tc = worldToCell(target.x, target.y);
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy > 9) continue;
        const cx = tc.cx + dx;
        const cy = tc.cy + dy;
        if (this.map.inBounds(cx, cy)) {
          this.map.setTerrain(cx, cy, Terrain.ROCK);
        }
      }
    }

    this.audio.play('nuke_explode');
  }

  /** Find the best nuke target for an AI house — cluster of player structures */
  private findBestNukeTarget(aiHouse: House): WorldPos | null {
    let bestScore = 0;
    let bestPos: WorldPos | null = null;

    for (const s of this.structures) {
      if (!s.alive) continue;
      if (this.isAllied(s.house, aiHouse)) continue;
      // Count nearby structures within 5 cells
      let score = 0;
      const sx = s.cx * CELL_SIZE + CELL_SIZE;
      const sy = s.cy * CELL_SIZE + CELL_SIZE;
      for (const other of this.structures) {
        if (!other.alive) continue;
        if (this.isAllied(other.house, aiHouse)) continue;
        const ox = other.cx * CELL_SIZE + CELL_SIZE;
        const oy = other.cy * CELL_SIZE + CELL_SIZE;
        const dist = worldDist({ x: sx, y: sy }, { x: ox, y: oy });
        if (dist < 5) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestPos = { x: sx, y: sy };
      }
    }
    return bestPos;
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


  // === Full AI — Strategic Opponent ===

  /** Create initial AIHouseState for a house, applying difficulty modifiers */
  private createAIHouseState(house: House): AIHouseState {
    const mods = AI_DIFFICULTY_MODS[this.difficulty] ?? AI_DIFFICULTY_MODS.normal;
    return {
      house,
      phase: 'economy',
      productionEnabled: false, // C++ parity: AI only produces after BEGIN_PRODUCTION trigger
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
      designatedEnemy: null, // AI4: set by triggers or AI logic
      preferredTarget: null,
      iq: this.houseIQs.get(house) ?? 3,             // default IQ 3 = full AI
      techLevel: this.houseTechLevels.get(house) ?? 10, // default tech 10 = everything
      maxUnit: this.houseMaxUnits.get(house) ?? -1,   // -1 = unlimited
      maxInfantry: this.houseMaxInfantry.get(house) ?? -1,
      maxBuilding: this.houseMaxBuildings.get(house) ?? -1,
    };
  }

  /** Count alive structures of a given type for a house */
  private aiCountStructure(house: House, type: string): number {
    let count = 0;
    for (const s of this.structures) {
      if (s.alive && s.house === house && s.type === type) count++;
    }
    return count;
  }

  /** Calculate power produced by a house's structures */
  private aiPowerProduced(house: House): number {
    let power = 0;
    for (const s of this.structures) {
      if (!s.alive || s.house !== house) continue;
      if (s.type === 'POWR') power += 100;
      else if (s.type === 'APWR') power += 200;
    }
    return power;
  }

  /** Calculate power consumed by a house's structures */
  private aiPowerConsumed(house: House): number {
    let power = 0;
    for (const s of this.structures) {
      if (!s.alive || s.house !== house) continue;
      // Power consumption by structure type — rules.ini Power= values
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
  private aiHasPrereq(house: House, prereq: string): boolean {
    if (prereq === 'TENT') {
      // Accept either TENT or BARR
      return this.structures.some(s => s.alive && s.house === house && (s.type === 'TENT' || s.type === 'BARR'));
    }
    return this.structures.some(s => s.alive && s.house === house && s.type === prereq);
  }

  /** Generate priority-ordered build queue for AI house */
  private getAIBuildOrder(house: House, _state: AIHouseState): string[] {
    const queue: string[] = [];
    const faction = HOUSE_FACTION[house] ?? 'both';
    const produced = this.aiPowerProduced(house);
    const consumed = this.aiPowerConsumed(house);
    const credits = this.houseCredits.get(house) ?? 0;

    // 1. POWR if power deficit
    if (consumed >= produced) {
      queue.push('POWR');
    }
    // 2. TENT/BARR if none (need infantry production)
    if (!this.aiHasPrereq(house, 'TENT')) {
      queue.push('TENT');
    }
    // 3. PROC if < 2 refineries (need economy)
    if (this.aiCountStructure(house, 'PROC') < 2) {
      queue.push('PROC');
    }
    // 4. WEAP if none (need vehicle production)
    if (this.aiCountStructure(house, 'WEAP') === 0) {
      queue.push('WEAP');
    }
    // 5. POWR if power margin < 100 (preemptive)
    if (produced - consumed < 100 && !queue.includes('POWR')) {
      queue.push('POWR');
    }
    // 6. DOME if none and credits > 1000 (tech unlock)
    if (this.aiCountStructure(house, 'DOME') === 0 && credits > 1000) {
      queue.push('DOME');
    }
    // 7. Defense structures (faction-dependent)
    const defType = faction === 'soviet' ? 'TSLA' : 'GUN';
    const defType2 = faction === 'soviet' ? 'TSLA' : 'HBOX';
    const totalDef = this.aiCountStructure(house, defType) + this.aiCountStructure(house, defType2);
    if (totalDef < 2) {
      queue.push(defType);
    }
    // 8. Tech center if none and has DOME
    if (this.aiHasPrereq(house, 'DOME')) {
      const techType = faction === 'soviet' ? 'STEK' : 'ATEK';
      if (this.aiCountStructure(house, techType) === 0) {
        queue.push(techType);
      }
    }
    // 9. Air production if has tech center
    const hasTech = faction === 'soviet'
      ? this.aiHasPrereq(house, 'STEK')
      : this.aiHasPrereq(house, 'ATEK');
    if (hasTech) {
      const airType = faction === 'soviet' ? 'AFLD' : 'HPAD';
      if (this.aiCountStructure(house, airType) === 0) {
        queue.push(airType);
      }
    }
    // 10. Extra PROC if harvester count > refinery count
    if (_state.harvesterCount > _state.refineryCount) {
      queue.push('PROC');
    }

    return queue;
  }

  /** AI strategic planner — phase transitions every 150 ticks (~10s) */
  private updateAIStrategicPlanner(): void {
    if (this.tick % 150 !== 0) return;

    for (const [house, state] of this.aiStates) {
      // C++ IQ 0 = no AI at all
      if (state.iq === 0) continue;
      // Update economy cache
      state.harvesterCount = 0;
      state.refineryCount = 0;
      for (const e of this.entities) {
        if (e.alive && e.house === house && (e.type === UnitType.V_HARV)) {
          state.harvesterCount++;
        }
      }
      for (const s of this.structures) {
        if (s.alive && s.house === house && s.type === 'PROC') {
          state.refineryCount++;
        }
      }

      // Clear underAttack if no damage in 150 ticks (~10s)
      if (state.underAttack && this.tick - state.lastBaseAttackTick > 150) {
        state.underAttack = false;
      }

      // Phase transitions
      switch (state.phase) {
        case 'economy': {
          const hasBarracks = this.aiHasPrereq(house, 'TENT');
          const hasWeap = this.aiCountStructure(house, 'WEAP') > 0;
          const hasPower = this.aiCountStructure(house, 'POWR') + this.aiCountStructure(house, 'APWR') >= 2;
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
          // After launch, transition back to buildup
          if (state.attackPool.size === 0) {
            state.phase = 'buildup';
          }
          break;
        }
      }
    }
  }

  /** Get centroid of alive structures for an AI house */
  private aiGetBaseCenter(house: House): { cx: number; cy: number } | null {
    let sumX = 0, sumY = 0, count = 0;
    for (const s of this.structures) {
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
  private aiIsFactoryExit(cx: number, cy: number, house: House): boolean {
    const exitTypes = ['WEAP', 'TENT', 'BARR', 'PROC'];
    for (const s of this.structures) {
      if (!s.alive || s.house !== house || !exitTypes.includes(s.type)) continue;
      const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
      // Exit row is directly below the structure
      if (cy === s.cy + h && cx >= s.cx && cx < s.cx + w) return true;
    }
    return false;
  }

  /** Spiral scan outward from base center to find valid placement for a structure */
  private aiPlaceStructure(house: House, type: string): { cx: number; cy: number } | null {
    const center = this.aiGetBaseCenter(house);
    if (!center) return null;

    const [fw, fh] = STRUCTURE_SIZE[type] ?? [1, 1];

    for (let ring = 1; ring <= 6; ring++) {
      // Scan cells in this ring, preferring perimeter positions for defenses
      const candidates: { cx: number; cy: number; dist: number }[] = [];

      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          // Only check ring perimeter (not interior, which was already checked)
          if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;

          const cx = center.cx + dx;
          const cy = center.cy + dy;

          // Bounds check
          if (cx < this.map.boundsX || cy < this.map.boundsY ||
              cx + fw > this.map.boundsX + this.map.boundsW ||
              cy + fh > this.map.boundsY + this.map.boundsH) continue;

          // Check all footprint cells are passable
          let valid = true;
          for (let fy = 0; fy < fh && valid; fy++) {
            for (let fx = 0; fx < fw && valid; fx++) {
              const t = this.map.getTerrain(cx + fx, cy + fy);
              if (t === Terrain.WALL || t === Terrain.WATER) valid = false;
              // Check no existing structure overlaps
              for (const s of this.structures) {
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

          // Don't block factory exits
          let blocksExit = false;
          for (let fy = 0; fy < fh && !blocksExit; fy++) {
            for (let fx = 0; fx < fw && !blocksExit; fx++) {
              if (this.aiIsFactoryExit(cx + fx, cy + fy, house)) blocksExit = true;
            }
          }
          if (blocksExit) continue;

          // BP3: Check adjacency to existing house structure (dist ≤ 2 cells, C++ default adjacency=1 + buffer)
          let adjacent = false;
          for (const s of this.structures) {
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
        // For defense structures, prefer perimeter (largest dist); otherwise closest
        const isDefense = type === 'GUN' || type === 'HBOX' || type === 'TSLA' || type === 'SAM';
        candidates.sort((a, b) => isDefense ? b.dist - a.dist : a.dist - b.dist);
        return { cx: candidates[0].cx, cy: candidates[0].cy };
      }
    }
    return null;
  }

  /** AI base construction — build new structures from build queue */
  private updateAIConstruction(): void {
    if (this.tick % 90 !== 0) return; // every 6 seconds

    for (const [house, state] of this.aiStates) {
      // C++ parity: AI only builds structures after BEGIN_PRODUCTION trigger
      if (!state.productionEnabled) continue;
      // C++ IQ < 1 = no building
      if (state.iq < 1) continue;
      // Need a ConYard
      if (this.aiCountStructure(house, 'FACT') === 0) continue;

      // C++ MaxBuilding cap — count alive buildings for this house
      if (state.maxBuilding >= 0) {
        let buildingCount = 0;
        for (const s of this.structures) {
          if (s.alive && s.house === house) buildingCount++;
        }
        if (buildingCount >= state.maxBuilding) continue;
      }

      // Cooldown
      if (state.buildCooldown > 0) {
        state.buildCooldown--;
        continue;
      }

      const credits = this.houseCredits.get(house) ?? 0;
      if (credits <= 0) continue;

      // Refresh build queue if empty
      if (state.buildQueue.length === 0) {
        state.buildQueue = this.getAIBuildOrder(house, state);
      }
      if (state.buildQueue.length === 0) continue;

      const buildType = state.buildQueue[0];
      const prodItem = this.scenarioProductionItems.find(p => p.type === buildType && p.isStructure);
      if (!prodItem) {
        state.buildQueue.shift();
        continue;
      }

      if (credits < prodItem.cost) continue;

      const pos = this.aiPlaceStructure(house, buildType);
      if (!pos) {
        state.buildQueue.shift(); // can't place, skip
        continue;
      }

      // Deduct credits
      this.houseCredits.set(house, credits - prodItem.cost);
      state.buildQueue.shift();

      // Spawn structure
      this.spawnAIStructure(buildType, house, pos.cx, pos.cy);

      // Set cooldown scaled by difficulty
      const mods = AI_DIFFICULTY_MODS[this.difficulty] ?? AI_DIFFICULTY_MODS.normal;
      state.buildCooldown = Math.floor(6 * mods.buildSpeedMult); // 6 cycles base × speed mult
      state.lastBuildTick = this.tick;
    }
  }

  /** Get staging area for AI house — base center offset toward nearest enemy */
  private aiStagingArea(house: House): WorldPos | null {
    const center = this.aiGetBaseCenter(house);
    if (!center) return null;

    // Find nearest enemy structure
    let nearestDist = Infinity;
    let enemyCx = center.cx;
    let enemyCy = center.cy;
    for (const s of this.structures) {
      if (!s.alive || this.isAllied(s.house, house)) continue;
      const dx = s.cx - center.cx;
      const dy = s.cy - center.cy;
      const dist = dx * dx + dy * dy;
      if (dist < nearestDist) {
        nearestDist = dist;
        enemyCx = s.cx;
        enemyCy = s.cy;
      }
    }

    // Offset 5 cells toward enemy from base center
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

  /** Weighted production pick based on composition targets */
  private getAIProductionPick(house: House, category: 'infantry' | 'vehicle'): ProductionItem | null {
    const faction = HOUSE_FACTION[house] ?? 'both';
    const prereq = category === 'infantry' ? 'TENT' : 'WEAP';

    const aiTechLevel = this.aiStates.get(house)?.techLevel ?? 10;
    const items = this.scenarioProductionItems.filter(p =>
      (p.prerequisite === prereq || (category === 'infantry' && p.prerequisite === 'BARR')) &&
      !p.isStructure &&
      (p.faction === 'both' || p.faction === faction) &&
      (p.techLevel === undefined || (p.techLevel >= 0 && p.techLevel <= aiTechLevel)) &&
      // Check tech prereq
      (!p.techPrereq || this.aiHasPrereq(house, p.techPrereq))
    );

    if (items.length === 0) return null;

    // Count current composition
    let antiArmor = 0, infantry = 0, total = 0;
    for (const e of this.entities) {
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

    // Weight items based on composition gaps
    const antiArmorRatio = total > 0 ? antiArmor / total : 0;
    const infantryRatio = total > 0 ? infantry / total : 0;

    const weighted: { item: ProductionItem; weight: number }[] = items.map(item => {
      let weight = 1;
      const isAntiArmor = item.type === 'E3' || item.type === '2TNK' || item.type === '3TNK' ||
                          item.type === '4TNK' || item.type === '1TNK';
      const isInfantry = item.type === 'E1' || item.type === 'E2';

      if (isAntiArmor && antiArmorRatio < 0.4) weight = 3;
      if (isInfantry && infantryRatio < 0.3) weight = 2;
      // Don't overproduce engineers
      if (item.type === 'E6') weight = 0.2;
      // Don't overproduce medics
      if (item.type === 'MEDI') weight = 0.3;
      // Prefer harvesters if economy needs it — but that's handled separately
      if (item.type === 'HARV') weight = 0.1;

      return { item, weight };
    });

    // Weighted random pick
    const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
    if (totalWeight <= 0) return items[0];
    let roll = Math.random() * totalWeight;
    for (const w of weighted) {
      roll -= w.weight;
      if (roll <= 0) return w.item;
    }
    return items[0];
  }

  /** Update AI harvester counts and force-produce if needed */
  private updateAIHarvesters(): void {
    if (this.tick % 60 !== 0) return;

    for (const [house, state] of this.aiStates) {
      // Count harvesters and refineries
      state.harvesterCount = 0;
      for (const e of this.entities) {
        if (e.alive && e.house === house && e.type === UnitType.V_HARV) {
          state.harvesterCount++;
        }
      }
      state.refineryCount = this.aiCountStructure(house, 'PROC');

      // C++ parity: AI only force-produces harvesters after BEGIN_PRODUCTION trigger
      if (!state.productionEnabled) continue;

      // If 0 harvesters and has refinery + war factory → force-produce
      if (state.harvesterCount === 0 && state.refineryCount > 0 &&
          this.aiCountStructure(house, 'WEAP') > 0) {
        const credits = this.houseCredits.get(house) ?? 0;
        const harvItem = this.scenarioProductionItems.find(p => p.type === 'HARV');
        if (harvItem && credits >= harvItem.cost) {
          const unit = this.spawnAIUnit(house, UnitType.V_HARV, 'WEAP');
          if (unit) {
            this.houseCredits.set(house, credits - harvItem.cost);
          }
        }
      }
    }
  }

  /** AI attack group management — accumulate pool and launch coordinated attacks */
  private updateAIAttackGroups(): void {
    if (this.tick % 120 !== 0) return; // every 8 seconds

    for (const [house, state] of this.aiStates) {
      // C++ parity: attack groups only form after BEGIN_PRODUCTION trigger
      if (!state.productionEnabled) continue;
      // C++ IQ < 2 = no attack coordination
      if (state.iq < 2) continue;
      if (state.phase !== 'buildup' && state.phase !== 'attack') continue;

      const staging = this.aiStagingArea(house);
      if (!staging) continue;

      // Pool accumulation: scan entities with AREA_GUARD near staging area
      for (const e of this.entities) {
        if (!e.alive || e.house !== house) continue;
        if (e.type === UnitType.V_HARV) continue; // never recruit harvesters
        if (e.mission !== Mission.AREA_GUARD && e.mission !== Mission.GUARD) continue;
        // Already in pool
        if (state.attackPool.has(e.id)) continue;
        // Within 8 cells of staging area
        const dist = worldDist(e.pos, staging);
        if (dist < 8) {
          state.attackPool.add(e.id);
        }
      }

      // Prune dead/missing from pool
      for (const id of state.attackPool) {
        const e = this.entityById.get(id);
        if (!e || !e.alive) state.attackPool.delete(id);
      }

      // Launch check (aggressionMult reduces threshold and cooldown)
      const effectiveThreshold = Math.max(2, Math.floor(state.attackThreshold / state.aggressionMult));
      const effectiveCooldown = Math.floor(state.attackCooldownTicks / state.aggressionMult);
      if (state.attackPool.size >= effectiveThreshold &&
          this.tick - state.lastAttackTick > effectiveCooldown) {
        this.launchAIAttack(house, state);
      }
    }
  }

  /** Launch a coordinated AI attack */
  private launchAIAttack(house: House, state: AIHouseState): void {
    const target = this.aiPickAttackTarget(house);
    if (!target) return;

    const waveId = this.nextWaveId++;
    const rallyTick = this.tick + 30; // 2s rally before advance

    for (const id of state.attackPool) {
      const e = this.entityById.get(id);
      if (!e || !e.alive) continue;
      e.mission = Mission.HUNT;
      e.moveTarget = target;
      e.waveId = waveId;
      e.waveRallyTick = rallyTick;
    }

    state.lastAttackTick = this.tick;
    state.attackPool.clear();
    // Phase transitions back to buildup via strategic planner
  }

  /** Pick best attack target for AI house */
  private aiPickAttackTarget(house: House): WorldPos | null {
    // Check preferred target from TACTION_PREFERRED_TARGET
    const ptState = this.aiStates.get(house);
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
        for (const s of this.structures) {
          if (!s.alive || this.isAllied(s.house, house)) continue;
          if (s.type === prefType) {
            const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
            return { x: (s.cx + w / 2) * CELL_SIZE, y: (s.cy + h / 2) * CELL_SIZE };
          }
        }
      }
    }

    // Priority: FACT > WEAP > PROC > nearest structure > nearest unit cluster
    const priorities = ['FACT', 'WEAP', 'PROC'];
    for (const type of priorities) {
      for (const s of this.structures) {
        if (!s.alive || this.isAllied(s.house, house)) continue;
        if (s.type === type) {
          const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
          return {
            x: (s.cx + w / 2) * CELL_SIZE,
            y: (s.cy + h / 2) * CELL_SIZE,
          };
        }
      }
    }

    // Nearest enemy structure
    const center = this.aiGetBaseCenter(house);
    if (!center) return null;

    let bestDist = Infinity;
    let bestPos: WorldPos | null = null;

    for (const s of this.structures) {
      if (!s.alive || this.isAllied(s.house, house)) continue;
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

    // Nearest enemy unit
    for (const e of this.entities) {
      if (!e.alive || this.isAllied(e.house, house)) continue;
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

  /** Recall up to half the attack pool as defenders when base is under attack */
  private aiRecallDefenders(house: House, state: AIHouseState): void {
    const center = this.aiGetBaseCenter(house);
    if (!center) return;

    const centerPos = { x: center.cx * CELL_SIZE + CELL_SIZE / 2, y: center.cy * CELL_SIZE + CELL_SIZE / 2 };
    let recalled = 0;
    const maxRecall = Math.ceil(state.attackPool.size / 2);

    for (const id of state.attackPool) {
      if (recalled >= maxRecall) break;
      const e = this.entityById.get(id);
      if (!e || !e.alive) continue;
      e.mission = Mission.HUNT;
      e.moveTarget = centerPos;
      state.attackPool.delete(id);
      recalled++;
    }
  }

  /** AI defense — detect base attacks and rally defenders */
  private updateAIDefense(): void {
    if (this.tick % 45 !== 0) return; // every 3 seconds

    for (const [house, state] of this.aiStates) {
      if (!state.underAttack) continue;
      // C++ IQ < 2 = no defensive rallying
      if (state.iq < 2) continue;

      // Recall defenders if attack pool has units
      if (state.attackPool.size > 0) {
        this.aiRecallDefenders(house, state);
      }

      // Rally idle units near base to hunt the attacker
      const center = this.aiGetBaseCenter(house);
      if (!center) continue;
      const centerPos = { x: center.cx * CELL_SIZE + CELL_SIZE / 2, y: center.cy * CELL_SIZE + CELL_SIZE / 2 };

      for (const e of this.entities) {
        if (!e.alive || e.house !== house) continue;
        if (e.type === UnitType.V_HARV) continue;
        if (e.mission !== Mission.AREA_GUARD && e.mission !== Mission.GUARD) continue;
        // Only rally units close to base (within 10 cells)
        const dist = worldDist(e.pos, centerPos);
        if (dist < 10) {
          // Find nearest enemy near base
          let nearestEnemy: Entity | null = null;
          let nearestDist = Infinity;
          for (const enemy of this.entities) {
            if (!enemy.alive || this.isAllied(enemy.house, house)) continue;
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

  /** AI retreat — damaged units fall back to repair depot or base */
  private updateAIRetreat(): void {
    if (this.tick % 30 !== 0) return; // every 2 seconds

    const mods = AI_DIFFICULTY_MODS[this.difficulty] ?? AI_DIFFICULTY_MODS.normal;
    const retreatPercent = mods.retreatHpPercent;

    for (const e of this.entities) {
      if (!e.alive || this.isPlayerControlled(e)) continue;
      if (e.isAnt) continue; // ants never retreat

      const state = this.aiStates.get(e.house);
      if (!state) continue;
      // C++ IQ < 3 = no retreat intelligence
      if (state.iq < 3) continue;

      // Emergency harvester return: HP < 30% → force return to nearest refinery
      if (e.type === UnitType.V_HARV) {
        const hpRatio = e.hp / e.maxHp;
        if (hpRatio >= 0.3) continue;
        // Already returning or unloading — don't interrupt
        if (e.harvesterState === 'returning' || e.harvesterState === 'unloading') continue;
        if (e.mission === Mission.MOVE && e.moveTarget) continue;
        // Find nearest refinery
        let nearestProc: MapStructure | null = null;
        let nearestDist = Infinity;
        for (const s of this.structures) {
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
        continue; // harvesters don't go to FIX — they return to refinery
      }

      const hpRatio = e.hp / e.maxHp;
      if (hpRatio >= retreatPercent) continue;

      // Already retreating (MOVE back to base)
      if (e.mission === Mission.MOVE && e.moveTarget) continue;

      const center = this.aiGetBaseCenter(e.house);
      if (!center) continue;

      // HP < 25% (scaled): find nearest FIX (depot) first
      let retreatTarget: WorldPos | null = null;
      for (const s of this.structures) {
        if (!s.alive || s.house !== e.house || s.type !== 'FIX') continue;
        const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
        retreatTarget = {
          x: (s.cx + w / 2) * CELL_SIZE,
          y: (s.cy + h / 2) * CELL_SIZE,
        };
        break;
      }

      // No FIX → retreat to base center
      if (!retreatTarget) {
        retreatTarget = {
          x: center.cx * CELL_SIZE + CELL_SIZE / 2,
          y: center.cy * CELL_SIZE + CELL_SIZE / 2,
        };
      }

      e.mission = Mission.MOVE;
      e.moveTarget = retreatTarget;
      // Remove from attack pool if in one
      state.attackPool.delete(e.id);
    }
  }

  /** AI auto-repair — IQ >= 3 houses repair damaged structures using their own credits.
   *  C++ parity: AI repairs buildings below 80% HP, deducting from houseCredits. */
  private updateAIRepair(): void {
    if (this.tick % 15 !== 0) return; // same rate as player repair (once per second)

    for (const [house, state] of this.aiStates) {
      if (state.iq < 3) continue;

      const credits = this.houseCredits.get(house) ?? 0;
      if (credits < 10) continue; // minimum credits to repair

      for (const s of this.structures) {
        if (!s.alive || s.house !== house) continue;
        if (s.hp >= s.maxHp) continue;
        if (s.sellProgress !== undefined) continue; // don't repair while selling
        if (s.hp >= s.maxHp * 0.8) continue; // only repair if below 80% HP

        // C++ parity: RepairStep=5, RepairPercent=0.20 (from rules.cpp:228-229)
        const prodItem = this.scenarioProductionItems.find(p => p.type === s.type);
        const repairCostPerStep = prodItem
          ? Math.ceil((prodItem.cost * REPAIR_PERCENT) / (s.maxHp / REPAIR_STEP))
          : 1;
        const currentCredits = this.houseCredits.get(house) ?? 0;
        if (currentCredits >= repairCostPerStep) {
          s.hp = Math.min(s.maxHp, s.hp + REPAIR_STEP);
          this.houseCredits.set(house, currentCredits - repairCostPerStep);
        }
      }
    }
  }

  /** AI auto-sell — IQ >= 3 houses sell near-death structures for partial refund.
   *  C++ parity: sells buildings at CONDITION_RED HP, grants 50% * hpRatio refund to houseCredits. */
  private updateAISellDamaged(): void {
    if (this.tick % 75 !== 0) return; // every 5 seconds

    for (const [house, state] of this.aiStates) {
      if (state.iq < 3) continue;

      for (const s of this.structures) {
        if (!s.alive || s.house !== house) continue;
        if (s.sellProgress !== undefined) continue; // already selling
        if (s.hp >= s.maxHp * CONDITION_RED) continue; // not critical

        // Don't sell ConYard (essential for rebuilds)
        if (s.type === 'FACT') continue;

        // Don't sell last power plant — would cripple the base
        if (s.type === 'POWR' || s.type === 'APWR') {
          let powerCount = 0;
          for (const ps of this.structures) {
            if (ps.alive && ps.house === house && (ps.type === 'POWR' || ps.type === 'APWR')) {
              powerCount++;
            }
          }
          if (powerCount <= 1) continue;
        }

        // Sell: grant partial refund scaled by remaining HP, then destroy
        const prodItem = this.scenarioProductionItems.find(p => p.type === s.type && p.isStructure);
        if (prodItem) {
          const hpRatio = s.hp / s.maxHp;
          const refund = Math.floor(prodItem.cost * 0.5 * hpRatio);
          const current = this.houseCredits.get(house) ?? 0;
          this.houseCredits.set(house, current + refund);
        }
        // Destroy the structure (instant sell — no animation for AI)
        s.alive = false;
        s.rubble = true;
        this.clearStructureFootprint(s);
      }
    }
  }

  /** AI passive income — AI houses earn credits from refineries */
  private updateAIIncome(): void {
    if (this.tick % 450 !== 0) return; // every 30 seconds
    for (const s of this.structures) {
      if (!s.alive || s.type !== 'PROC') continue;
      if (this.isAllied(s.house, this.playerHouse)) continue;
      const current = this.houseCredits.get(s.house) ?? 0;
      const aiState = this.aiStates.get(s.house);
      const incomeMult = aiState ? aiState.incomeMult : 1.0;
      this.houseCredits.set(s.house, current + Math.floor(100 * incomeMult));
    }
  }

  /** AI army building — AI houses produce units when they have credits and barracks/factory.
   *  Faction-aware: AI builds units matching its own faction from PRODUCTION_ITEMS. */
  private updateAIProduction(): void {
    const mods = AI_DIFFICULTY_MODS[this.difficulty] ?? AI_DIFFICULTY_MODS.normal;
    if (this.tick % mods.productionInterval !== 0) return;

    // For ant missions, respect ant cap using old random production
    if (this.scenarioId.startsWith('SCA')) {
      const diffMods = DIFFICULTY_MODS[this.difficulty] ?? DIFFICULTY_MODS.normal;
      const antCount = this.entities.filter(e => e.alive && e.isAnt).length;
      if (antCount >= diffMods.maxAnts) return;
    }

    // For each AI house, check if they have production buildings and credits
    for (const [house, credits] of this.houseCredits) {
      if (credits <= 0) continue;
      if (this.isAllied(house, this.playerHouse)) continue;

      const state = this.aiStates.get(house);
      // C++ parity: strategic AI houses only produce after BEGIN_PRODUCTION trigger fires
      if (state && !state.productionEnabled) continue;
      const hasTent = this.aiHasPrereq(house, 'TENT');
      const hasWeap = this.structures.some(s => s.alive && s.house === house && s.type === 'WEAP');

      // Strategic AI: Harvester priority — if harvesterCount < refineryCount
      if (state && hasWeap && state.harvesterCount < state.refineryCount) {
        const harvItem = this.scenarioProductionItems.find(p => p.type === 'HARV');
        if (harvItem && credits >= harvItem.cost) {
          const unit = this.spawnAIUnit(house, UnitType.V_HARV, 'WEAP');
          if (unit) {
            this.houseCredits.set(house, credits - harvItem.cost);
            continue; // one production per house per tick
          }
        }
      }

      // Staging area for new units (strategic AI) or barracks fallback
      const staging = state ? this.aiStagingArea(house) : null;

      // C++ MaxInfantry cap — skip infantry production if at limit
      let skipInfantry = false;
      if (state && state.maxInfantry >= 0) {
        let infCount = 0;
        for (const e of this.entities) {
          if (e.alive && e.house === house && e.stats.isInfantry) infCount++;
        }
        if (infCount >= state.maxInfantry) skipInfantry = true;
      }

      if (hasTent && credits >= 100 && !skipInfantry) {
        const pick = state
          ? this.getAIProductionPick(house, 'infantry')
          : (() => {
              const houseFaction = HOUSE_FACTION[house] ?? 'both';
              const infItems = this.scenarioProductionItems.filter(p =>
                (p.prerequisite === 'TENT' || p.prerequisite === 'BARR') &&
                !p.isStructure &&
                (p.faction === 'both' || p.faction === houseFaction) &&
                (p.techLevel === undefined || p.techLevel >= 0)
              );
              return infItems.length > 0 ? infItems[Math.floor(Math.random() * infItems.length)] : null;
            })();
        if (pick && credits >= pick.cost) {
          const unitType = pick.type as UnitType;
          const unit = this.spawnAIUnit(house, unitType, 'TENT', Mission.AREA_GUARD,
            staging ?? undefined);
          if (unit) {
            if (!staging) {
              // Guard origin defaults to spawn position
              unit.guardOrigin = { x: unit.pos.x, y: unit.pos.y };
            } else {
              unit.moveTarget = staging;
              unit.mission = Mission.MOVE;
            }
            this.houseCredits.set(house, credits - pick.cost);
          }
        }
      }

      // C++ MaxUnit cap — skip vehicle production if at limit
      let skipVehicle = false;
      if (state && state.maxUnit >= 0) {
        let vehCount = 0;
        for (const e of this.entities) {
          if (e.alive && e.house === house && !e.stats.isInfantry && !e.isAnt && !e.stats.isAircraft && !e.stats.isVessel) vehCount++;
        }
        if (vehCount >= state.maxUnit) skipVehicle = true;
      }

      const currentCredits = this.houseCredits.get(house) ?? 0;
      if (hasWeap && currentCredits >= 600 && !skipVehicle) {
        const pick = state
          ? this.getAIProductionPick(house, 'vehicle')
          : (() => {
              const houseFaction = HOUSE_FACTION[house] ?? 'both';
              const vehItems = this.scenarioProductionItems.filter(p =>
                p.prerequisite === 'WEAP' &&
                !p.isStructure &&
                (p.faction === 'both' || p.faction === houseFaction) &&
                (p.techLevel === undefined || p.techLevel >= 0)
              );
              return vehItems.length > 0 ? vehItems[Math.floor(Math.random() * vehItems.length)] : null;
            })();
        if (pick && currentCredits >= pick.cost) {
          const unitType = pick.type as UnitType;
          const unit = this.spawnAIUnit(house, unitType, 'WEAP', Mission.AREA_GUARD,
            staging ?? undefined);
          if (unit) {
            if (!staging) {
              // Guard origin defaults to spawn position
              unit.guardOrigin = { x: unit.pos.x, y: unit.pos.y };
            } else {
              unit.moveTarget = staging;
              unit.mission = Mission.MOVE;
            }
            this.houseCredits.set(house, (this.houseCredits.get(house) ?? 0) - pick.cost);
          }
        }
      }
    }
  }

  /** AI autocreate teams — periodically assemble and deploy teams from autocreate-flagged TeamTypes.
   *  C++ parity: TeamTypeClass::AI() checks IsAutocreate flag and spawns team members
   *  at the house edge when autocreate is enabled (via TACTION_AUTOCREATE trigger). */
  private updateAIAutocreateTeams(): void {
    if (!this.autocreateEnabled) return;
    if (this.tick % 120 !== 0) return; // every 8 seconds at 15 FPS

    for (const [house, state] of this.aiStates) {
      if (!state.productionEnabled) continue;
      if (state.iq < 2) continue; // need IQ 2+ for autocreate

      const credits = this.houseCredits.get(house) ?? 0;
      if (credits < 500) continue; // need minimum credits

      // Find autocreate-flagged TeamTypes for this house
      for (let teamIdx = 0; teamIdx < this.teamTypes.length; teamIdx++) {
        const team = this.teamTypes[teamIdx];
        if (!(team.flags & 4)) continue; // bit 2 = IsAutocreate
        if (houseIdToHouse(team.house) !== house) continue;
        if (this.destroyedTeams.has(teamIdx)) continue;

        // Compute spawn position from house edge
        const edge = this.houseEdges.get(house)?.toLowerCase();
        let spawnPos: { cx: number; cy: number } | null = null;

        if (edge) {
          const bx = this.map.boundsX, by = this.map.boundsY;
          const bw = this.map.boundsW, bh = this.map.boundsH;
          const randOffset = Math.floor(Math.random() * Math.max(bw, bh));
          switch (edge) {
            case 'north': spawnPos = { cx: bx + (randOffset % bw), cy: by }; break;
            case 'south': spawnPos = { cx: bx + (randOffset % bw), cy: by + bh - 1 }; break;
            case 'east':  spawnPos = { cx: bx + bw - 1, cy: by + (randOffset % bh) }; break;
            case 'west':  spawnPos = { cx: bx, cy: by + (randOffset % bh) }; break;
          }
        }

        if (!spawnPos) {
          // Fallback: use team origin waypoint
          const wp = this.waypoints.get(team.origin);
          if (wp) spawnPos = wp;
          else continue;
        }

        const world = { x: spawnPos.cx * CELL_SIZE + CELL_SIZE / 2, y: spawnPos.cy * CELL_SIZE + CELL_SIZE / 2 };

        // Spawn team members
        for (const member of team.members) {
          if (!UNIT_STATS[member.type]) continue;
          const unitType = member.type as UnitType;
          for (let i = 0; i < member.count; i++) {
            const offsetX = (Math.random() - 0.5) * 48;
            const offsetY = (Math.random() - 0.5) * 48;
            const entity = new Entity(unitType, house, world.x + offsetX, world.y + offsetY);
            entity.facing = Math.floor(Math.random() * 8);
            entity.bodyFacing32 = entity.facing * 4;

            // Assign team mission script to each member
            if (team.missions.length > 0) {
              entity.teamMissions = team.missions.map(m => ({
                mission: m.mission,
                data: m.data,
              }));
              entity.teamMissionIndex = 0;
            } else {
              // No missions → default to HUNT
              entity.mission = Mission.HUNT;
            }

            // IsSuicide teams (flags bit 1) fight to the death — use HUNT mission
            if (team.flags & 2) {
              entity.mission = Mission.HUNT;
            }

            applyScenarioOverrides([entity], this.scenarioUnitStats, this.scenarioWeaponStats);
            this.entities.push(entity);
            this.entityById.set(entity.id, entity);
          }
        }

        break; // One team per house per cycle
      }
    }
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

  /** Agent 9: Tanya C4 placement — plants C4 on building, explodes after 45 ticks. */
  updateTanyaC4(entity: Entity): void {
    if (entity.type !== UnitType.I_TANYA || !entity.alive) return;
    if (!entity.targetStructure || !(entity.targetStructure as MapStructure).alive) return;
    const s = entity.targetStructure as MapStructure;
    const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
    const scx = s.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
    const scy = s.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
    const dist = worldDist(entity.pos, { x: scx, y: scy });
    if (dist > 1.5) {
      entity.animState = AnimState.WALK;
      entity.moveToward({ x: scx, y: scy }, this.movementSpeed(entity));
      return;
    }
    entity.animState = AnimState.ATTACK;
    const sAny = s as MapStructure & { c4Timer?: number };
    if (sAny.c4Timer === undefined || sAny.c4Timer <= 0) {
      sAny.c4Timer = 45;
      this.playSoundAt('building_explode', scx, scy);
      this.evaMessages.push({ text: 'C4 PLANTED', tick: this.tick });
    }
    entity.targetStructure = null;
    entity.target = null;
    entity.mission = Mission.GUARD;
  }

  /** Agent 9: Tick C4 timers on structures. */
  tickC4Timers(): void {
    for (const s of this.structures) {
      if (!s.alive) continue;
      const sAny = s as MapStructure & { c4Timer?: number };
      if (sAny.c4Timer && sAny.c4Timer > 0) {
        sAny.c4Timer--;
        if (sAny.c4Timer <= 0) this.damageStructure(s, 9999);
      }
    }
  }

  /** Agent 9: Thief steals 50% credits from enemy PROC/SILO, then dies. */
  updateThief(entity: Entity): void {
    if (entity.type !== UnitType.I_THF || !entity.alive) return;
    if (!entity.targetStructure || !(entity.targetStructure as MapStructure).alive) return;
    const s = entity.targetStructure as MapStructure;
    if (s.type !== 'PROC' && s.type !== 'SILO') { entity.targetStructure = null; entity.mission = Mission.GUARD; return; }
    if (this.isAllied(entity.house, s.house)) { entity.targetStructure = null; entity.mission = Mission.GUARD; return; }
    const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
    const scx = s.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
    const scy = s.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
    const dist = worldDist(entity.pos, { x: scx, y: scy });
    if (dist > 1.5) { entity.animState = AnimState.WALK; entity.moveToward({ x: scx, y: scy }, this.movementSpeed(entity)); return; }
    const enemyCredits = this.houseCredits.get(s.house) ?? 0;
    const stolen = Math.floor(enemyCredits * 0.5);
    if (stolen > 0) {
      this.houseCredits.set(s.house, enemyCredits - stolen);
      if (entity.isPlayerUnit) { this.addCredits(stolen, true); } else { this.houseCredits.set(entity.house, (this.houseCredits.get(entity.house) ?? 0) + stolen); }
      this.evaMessages.push({ text: `CREDITS STOLEN: ${stolen}`, tick: this.tick });
    }
    this.isThieved = true;  // C++ House.IsThieved — for TEVENT_THIEVED trigger
    entity.alive = false; entity.mission = Mission.DIE; entity.animState = AnimState.DIE; entity.animFrame = 0; entity.deathTick = 0;
  }

  /** Agent 9: Minelayer places AP mines. Mine limit: 50/house. */
  static readonly MAX_MINES_PER_HOUSE = 50;
  mines: Array<{ cx: number; cy: number; house: House; damage: number }> = [];

  updateMinelayer(entity: Entity): void {
    if (entity.type !== UnitType.V_MNLY || !entity.alive || !entity.moveTarget) return;
    const targetCell = worldToCell(entity.moveTarget.x, entity.moveTarget.y);
    const dist = worldDist(entity.pos, entity.moveTarget);
    if (dist > 0.5) { entity.animState = AnimState.WALK; entity.moveToward(entity.moveTarget, this.movementSpeed(entity)); return; }
    // C++ parity: minelayer carries limited ammo (Ammo=5 in rules.ini)
    if (entity.ammo === 0 && entity.maxAmmo > 0) { entity.moveTarget = null; entity.mission = Mission.GUARD; entity.animState = AnimState.IDLE; return; }
    const houseMines = this.mines.filter(m => m.house === entity.house).length;
    if (houseMines >= Game.MAX_MINES_PER_HOUSE) { entity.moveTarget = null; entity.mission = Mission.GUARD; entity.animState = AnimState.IDLE; return; }
    if (!this.mines.find(m => m.cx === targetCell.cx && m.cy === targetCell.cy)) {
      this.mines.push({ cx: targetCell.cx, cy: targetCell.cy, house: entity.house, damage: 1000 });
      entity.mineCount++;
      if (entity.ammo > 0) entity.ammo--;
    }
    entity.moveTarget = null; entity.mission = Mission.GUARD; entity.animState = AnimState.IDLE;
  }

  /** Agent 9: Mine trigger check — enemy enters mined cell. */
  tickMines(): void {
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const mine = this.mines[i];
      for (const e of this.entities) {
        if (!e.alive || this.isAllied(e.house, mine.house) || e.isAirUnit) continue;
        const ec = e.cell;
        if (ec.cx === mine.cx && ec.cy === mine.cy) {
          this.damageEntity(e, mine.damage, 'AP');
          this.effects.push({ type: 'explosion', x: mine.cx * CELL_SIZE + CELL_SIZE / 2, y: mine.cy * CELL_SIZE + CELL_SIZE / 2, frame: 0, maxFrames: 12, size: 10 });
          this.playSoundAt('building_explode', mine.cx * CELL_SIZE, mine.cy * CELL_SIZE);
          this.mines.splice(i, 1);
          break;
        }
      }
    }
  }

  /** CR8: Tick active vortex entities — wander randomly, damage nearby units */
  private tickVortices(): void {
    for (let i = this.activeVortices.length - 1; i >= 0; i--) {
      const v = this.activeVortices[i];
      v.ticksLeft--;
      if (v.ticksLeft <= 0) {
        this.activeVortices.splice(i, 1);
        continue;
      }
      // Random wandering — adjust angle slightly each tick
      v.angle += (Math.random() - 0.5) * 0.4;
      v.x += Math.cos(v.angle) * CELL_SIZE * 0.15;
      v.y += Math.sin(v.angle) * CELL_SIZE * 0.15;
      // Clamp to map bounds
      const minX = this.map.boundsX * CELL_SIZE;
      const maxX = (this.map.boundsX + this.map.boundsW) * CELL_SIZE;
      const minY = this.map.boundsY * CELL_SIZE;
      const maxY = (this.map.boundsY + this.map.boundsH) * CELL_SIZE;
      if (v.x < minX || v.x > maxX) { v.angle = Math.PI - v.angle; v.x = Math.max(minX, Math.min(maxX, v.x)); }
      if (v.y < minY || v.y > maxY) { v.angle = -v.angle; v.y = Math.max(minY, Math.min(maxY, v.y)); }
      // Damage units and structures within 1 cell radius — 50 damage every 3 ticks (~250 DPS)
      if (v.ticksLeft % 3 === 0) {
        for (const e of this.entities) {
          if (!e.alive) continue;
          const dx = e.pos.x - v.x;
          const dy = e.pos.y - v.y;
          if (dx * dx + dy * dy <= CELL_SIZE * CELL_SIZE) {
            this.damageEntity(e, 50, 'Super');
          }
        }
        for (const s of this.structures) {
          if (!s.alive) continue;
          const sx = s.cx * CELL_SIZE + CELL_SIZE / 2;
          const sy = s.cy * CELL_SIZE + CELL_SIZE / 2;
          const dx = sx - v.x;
          const dy = sy - v.y;
          if (dx * dx + dy * dy <= CELL_SIZE * CELL_SIZE) {
            this.damageStructure(s, 50);
          }
        }
      }
      // Visual effect — rotating translucent circle
      this.effects.push({
        type: 'explosion', x: v.x, y: v.y,
        frame: 0, maxFrames: 2, size: 18,
        sprite: 'atomsfx', spriteStart: 0, blendMode: 'screen',
      });
    }
  }

  /** Agent 9: Gap Generator shroud — jams enemy vision in 10-cell radius. Power-gated. */
  static readonly GAP_RADIUS = 10;
  static readonly GAP_UPDATE_INTERVAL = 90;
  gapGeneratorCells = new Map<number, { cx: number; cy: number; radius: number }>();

  updateGapGenerators(): void {
    if (this.tick % Game.GAP_UPDATE_INTERVAL !== 0) return;
    const pf = this.powerProduced > 0 ? this.powerProduced / Math.max(this.powerConsumed, 1) : 0;
    const activeGaps = new Set<number>();
    for (let si = 0; si < this.structures.length; si++) {
      const s = this.structures[si];
      if (s.type !== 'GAP' || !s.alive) continue;
      if (pf < 1.0) {
        if (this.gapGeneratorCells.has(si)) { const prev = this.gapGeneratorCells.get(si)!; this.map.unjamRadius(prev.cx, prev.cy, prev.radius); this.gapGeneratorCells.delete(si); }
        continue;
      }
      activeGaps.add(si);
      if (this.gapGeneratorCells.has(si)) continue;
      const [gw, gh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
      const cx = s.cx + Math.floor(gw / 2); const cy = s.cy + Math.floor(gh / 2);
      const r = Game.GAP_RADIUS; const r2 = r * r;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r2) this.map.jamCell(cx + dx, cy + dy);
      this.gapGeneratorCells.set(si, { cx, cy, radius: r });
    }
    for (const [si, prev] of this.gapGeneratorCells) {
      if (!activeGaps.has(si)) { this.map.unjamRadius(prev.cx, prev.cy, prev.radius); this.gapGeneratorCells.delete(si); }
    }
  }

  /** Chrono Tank cooldown: C++ ChronoTankDuration=0x300 (3.0) × TICKS_PER_MINUTE(900) = 2700 ticks. */
  static readonly CHRONO_TANK_COOLDOWN = 2700;

  /** Tick Chrono Tank cooldown only — teleport is player-initiated via D key + click. */
  updateChronoTank(entity: Entity): void {
    if (entity.type !== UnitType.V_CTNK || !entity.alive) return;
    if (entity.chronoCooldown > 0) entity.chronoCooldown--;
  }

  /** Execute Chrono Tank teleport to target position. C++ SPC_CHRONO2 handler (house.cpp:2808). */
  teleportChronoTank(entity: Entity, target: WorldPos): void {
    if (!entity.alive || entity.chronoCooldown > 0) return;
    const tc = worldToCell(target.x, target.y);
    if (!this.map.isPassable(tc.cx, tc.cy)) return;
    // Blue flash at origin
    this.effects.push({
      type: 'explosion', x: entity.pos.x, y: entity.pos.y,
      frame: 0, maxFrames: 20, size: 24,
      sprite: 'litning', spriteStart: 0,
    });
    // Teleport — also snap prevPos to prevent interpolation swoosh
    entity.pos.x = target.x;
    entity.pos.y = target.y;
    entity.prevPos.x = target.x;
    entity.prevPos.y = target.y;
    // Blue flash at destination
    this.effects.push({
      type: 'explosion', x: entity.pos.x, y: entity.pos.y,
      frame: 0, maxFrames: 20, size: 24,
      sprite: 'litning', spriteStart: 0,
    });
    entity.chronoShiftTick = CHRONO_SHIFT_VISUAL_TICKS;
    entity.chronoCooldown = Game.CHRONO_TANK_COOLDOWN;
    entity.moveTarget = null;
    entity.target = null;
    entity.mission = Mission.GUARD;
    this.audio.play('chrono');
  }

  /** Agent 9: MAD Tank deploy + shockwave. 90-tick charge, 600 dmg to vehicles in 8 cells. */
  static readonly MAD_TANK_CHARGE_TICKS = 90;
  static readonly MAD_TANK_DAMAGE = 600;
  static readonly MAD_TANK_RADIUS = 8;

  updateMADTank(entity: Entity): void {
    if (!entity.alive || !entity.isDeployed) return;
    entity.deployTimer--;
    entity.animState = AnimState.IDLE;
    if (entity.deployTimer <= 0) {
      const radius = Game.MAD_TANK_RADIUS;
      for (const other of this.entities) {
        if (!other.alive || other.id === entity.id || other.stats.isInfantry || other.isAirUnit) continue;
        if (worldDist(entity.pos, other.pos) <= radius) {
          this.damageEntity(other, Game.MAD_TANK_DAMAGE, 'HE');
        }
      }
      this.effects.push({ type: 'explosion', x: entity.pos.x, y: entity.pos.y, frame: 0, maxFrames: 20, size: 24 });
      this.playSoundAt('building_explode', entity.pos.x, entity.pos.y);
      entity.hp = 0; entity.alive = false; entity.mission = Mission.DIE; entity.animState = AnimState.DIE; entity.animFrame = 0; entity.deathTick = 0;
    }
  }

  deployMADTank(entity: Entity): void {
    if (entity.isDeployed) return;
    // C++ unit.cpp:2667-2685 — eject INFANTRY_C1 technician before detonation
    const ec = entity.cell;
    const DIR_OFFSETS = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
    for (const [dx, dy] of DIR_OFFSETS) {
      const nx = ec.cx + dx, ny = ec.cy + dy;
      if (this.map.isPassable(nx, ny) && this.map.getOccupancy(nx, ny) === 0) {
        const crew = new Entity(UnitType.I_C1, entity.house,
          nx * CELL_SIZE + CELL_SIZE / 2, ny * CELL_SIZE + CELL_SIZE / 2);
        crew.mission = Mission.MOVE;
        // Move away from tank
        const awayX = crew.pos.x + dx * CELL_SIZE * 3;
        const awayY = crew.pos.y + dy * CELL_SIZE * 3;
        crew.moveTarget = { x: awayX, y: awayY };
        this.entities.push(crew);
        this.entityById.set(crew.id, crew);
        break;
      }
    }
    entity.isDeployed = true; entity.deployTimer = Game.MAD_TANK_CHARGE_TICKS;
    entity.moveTarget = null; entity.target = null; entity.mission = Mission.GUARD;
  }

  /** Agent 9: Demo Truck kamikaze — 1000 damage in 3-cell radius, 45-tick fuse after reaching target. */
  static readonly DEMO_TRUCK_DAMAGE = 1000;
  static readonly DEMO_TRUCK_RADIUS = 3;
  static readonly DEMO_TRUCK_FUSE_TICKS = 45;

  updateDemoTruck(entity: Entity): void {
    if (entity.type !== UnitType.V_DTRK || !entity.alive || entity.mission !== Mission.ATTACK) return;

    // Fuse countdown — once armed, tick down to detonation
    if (entity.fuseTimer > 0) {
      entity.fuseTimer--;
      entity.animState = AnimState.IDLE;
      if (entity.fuseTimer <= 0) {
        this.detonateDemoTruck(entity);
      }
      return;
    }

    let targetPos: WorldPos | null = null;
    if (entity.target && entity.target.alive) { targetPos = entity.target.pos; }
    else if (entity.targetStructure && (entity.targetStructure as MapStructure).alive) {
      const s = entity.targetStructure as MapStructure;
      const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
      targetPos = { x: s.cx * CELL_SIZE + (sw * CELL_SIZE) / 2, y: s.cy * CELL_SIZE + (sh * CELL_SIZE) / 2 };
    }
    if (!targetPos) { entity.mission = Mission.GUARD; return; }
    const dist = worldDist(entity.pos, targetPos);
    if (dist > 1.5) { entity.animState = AnimState.WALK; entity.moveToward(targetPos, this.movementSpeed(entity)); return; }
    // Reached target — arm the fuse
    entity.fuseTimer = Game.DEMO_TRUCK_FUSE_TICKS;
  }

  /** Detonate Demo Truck — splash damage centered on truck position. */
  private detonateDemoTruck(entity: Entity): void {
    const blastRadius = Game.DEMO_TRUCK_RADIUS;
    for (const other of this.entities) {
      if (!other.alive || other.id === entity.id) continue;
      const d = worldDist(entity.pos, other.pos);
      if (d <= blastRadius) { this.damageEntity(other, Math.round(Game.DEMO_TRUCK_DAMAGE * (1 - (d / blastRadius) * 0.5)), 'Nuke'); }
    }
    for (const s of this.structures) {
      if (!s.alive) continue;
      const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
      const d = worldDist(entity.pos, { x: s.cx * CELL_SIZE + (sw * CELL_SIZE) / 2, y: s.cy * CELL_SIZE + (sh * CELL_SIZE) / 2 });
      if (d <= blastRadius) this.damageStructure(s, Math.round(Game.DEMO_TRUCK_DAMAGE * (1 - (d / blastRadius) * 0.5)));
    }
    this.effects.push({ type: 'explosion', x: entity.pos.x, y: entity.pos.y, frame: 0, maxFrames: 20, size: 24 });
    this.playSoundAt('building_explode', entity.pos.x, entity.pos.y);
    entity.hp = 0; entity.alive = false; entity.mission = Mission.DIE; entity.animState = AnimState.DIE; entity.animFrame = 0; entity.deathTick = 0;
  }

  /** Agent 9: Vehicle cloak — same as sub cloak but for non-vessel cloakable (STNK). */
  updateVehicleCloak(entity: Entity): void {
    if (!entity.stats.isCloakable || entity.stats.isVessel) return;
    switch (entity.cloakState) {
      case CloakState.CLOAKING: entity.cloakTimer--; if (entity.cloakTimer <= 0) { entity.cloakState = CloakState.CLOAKED; entity.cloakTimer = 0; } break;
      case CloakState.UNCLOAKING: entity.cloakTimer--; if (entity.cloakTimer <= 0) { entity.cloakState = CloakState.UNCLOAKED; entity.cloakTimer = 0; } break;
      case CloakState.UNCLOAKED:
        if (entity.sonarPulseTimer > 0) break;
        if (entity.mission === Mission.ATTACK) break;
        if (entity.weapon && entity.attackCooldown > 0) break;
        if (entity.hp / entity.maxHp < CONDITION_RED && Math.random() > 0.04) break;
        entity.cloakState = CloakState.CLOAKING; entity.cloakTimer = CLOAK_TRANSITION_FRAMES; break;
      case CloakState.CLOAKED: break;
    }
  }

  /** Agent 9: Mechanic — auto-heals vehicles, 5 HP/tick, 6-cell scan range. */
  static readonly MECHANIC_HEAL_RANGE = 6;
  static readonly MECHANIC_HEAL_AMOUNT = 5;

  updateMechanicUnit(entity: Entity): void {
    if (entity.type !== UnitType.I_MECH || !entity.alive) return;
    if (entity.attackCooldown > 0) entity.attackCooldown--;
    if (entity.fear >= Entity.FEAR_SCARED) {
      let ned = Infinity; let nep: WorldPos | null = null;
      for (const o of this.entities) { if (!o.alive || this.entitiesAllied(entity, o)) continue; const d = worldDist(entity.pos, o.pos); if (d < entity.stats.sight && d < ned) { ned = d; nep = o.pos; } }
      if (nep) { const dx = entity.pos.x - nep.x; const dy = entity.pos.y - nep.y; const d = Math.sqrt(dx * dx + dy * dy) || 1; entity.animState = AnimState.WALK; entity.moveToward({ x: entity.pos.x + (dx / d) * CELL_SIZE * 3, y: entity.pos.y + (dy / d) * CELL_SIZE * 3 }, this.movementSpeed(entity)); entity.healTarget = null; return; }
    }
    if (entity.healTarget) { const ht = entity.healTarget; if (!ht.alive || ht.hp >= ht.maxHp || !this.isAllied(entity.house, ht.house) || ht.stats.isInfantry || ht.isAirUnit || ht.id === entity.id) entity.healTarget = null; }
    const hsd = entity.stats.scanDelay ?? 15;
    if (!entity.healTarget && this.tick - entity.lastGuardScan >= hsd) {
      entity.lastGuardScan = this.tick;
      let best: Entity | null = null; let lhr = 1.0; let bd = Infinity; const sr = Game.MECHANIC_HEAL_RANGE;
      for (const o of this.entities) { if (!o.alive || o.id === entity.id || !this.isAllied(entity.house, o.house) || o.stats.isInfantry || o.isAirUnit || o.hp >= o.maxHp) continue; const d = worldDist(entity.pos, o.pos); if (d > sr) continue; const hr = o.hp / o.maxHp; if (hr < lhr || (hr === lhr && d < bd)) { lhr = hr; bd = d; best = o; } }
      if (best) entity.healTarget = best;
    }
    if (entity.healTarget) {
      const ht = entity.healTarget; const dist = worldDist(entity.pos, ht.pos);
      if (dist <= 1.5) {
        entity.animState = AnimState.ATTACK; entity.desiredFacing = directionTo(entity.pos, ht.pos); entity.tickRotation();
        if (entity.attackCooldown <= 0) {
          const prev = ht.hp; ht.hp = Math.min(ht.maxHp, ht.hp + Game.MECHANIC_HEAL_AMOUNT); const healed = ht.hp - prev; entity.attackCooldown = entity.weapon?.rof ?? 80;
          if (healed > 0) { this.playSoundAt('heal', ht.pos.x, ht.pos.y); this.effects.push({ type: 'muzzle', x: ht.pos.x, y: ht.pos.y - 4, frame: 0, maxFrames: 6, size: 4, muzzleColor: '80,200,255' }); this.effects.push({ type: 'text', x: ht.pos.x, y: ht.pos.y - 8, frame: 0, maxFrames: 30, size: 0, text: `+${healed}`, textColor: 'rgba(80,200,255,1)' }); }
          if (ht.hp >= ht.maxHp) entity.healTarget = null;
        }
      } else { entity.animState = AnimState.WALK; entity.moveToward(ht.pos, this.movementSpeed(entity)); }
      return;
    }
    entity.animState = AnimState.IDLE;
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
    const s = this.structures[idx];
    if (!s || !s.alive || !this.isAllied(s.house, this.playerHouse)) return false;
    if (this.repairingStructures.has(idx)) {
      this.repairingStructures.delete(idx);
      return false;
    }
    if (s.hp < s.maxHp) {
      this.repairingStructures.add(idx);
      return true;
    }
    return false;
  }

  /** Initiate sell on a structure by index. Returns true if sell started. */
  sellStructureByIndex(idx: number): boolean {
    const s = this.structures[idx];
    if (!s || !s.alive || s.sellProgress !== undefined) return false;
    if (!this.isAllied(s.house, this.playerHouse)) return false;
    if (WALL_TYPES.has(s.type)) {
      s.alive = false;
      this.clearStructureFootprint(s);
      const prodItem = this.scenarioProductionItems.find(p => p.type === s.type);
      if (prodItem) this.addCredits(Math.floor(prodItem.cost * 0.5), true);
      return true;
    }
    s.sellProgress = 0;
    s.sellHpAtStart = s.hp;
    return true;
  }

  /** Check if a structure is currently being repaired. */
  isStructureRepairing(idx: number): boolean {
    return this.repairingStructures.has(idx);
  }
}
