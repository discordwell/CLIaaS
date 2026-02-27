/**
 * Main game loop — ties all engine systems together.
 * Fixed timestep at 15 FPS (matching original Red Alert game speed).
 */

import {
  type WorldPos, type UnitStats, type WeaponStats, type ArmorType,
  type AllianceTable, buildDefaultAlliances,
  CELL_SIZE, MAP_CELLS, GAME_TICKS_PER_SEC,
  MAX_DAMAGE, REPAIR_STEP, REPAIR_PERCENT, CONDITION_RED,
  Mission, AnimState, House, UnitType, Stance, SpeedClass, worldDist, directionTo, worldToCell,
  WARHEAD_VS_ARMOR, WARHEAD_PROPS, WARHEAD_META, type WarheadType, UNIT_STATS, WEAPON_STATS,
  PRODUCTION_ITEMS, type ProductionItem, CursorType, type SidebarTab, getItemCategory,
  type Faction, HOUSE_FACTION, COUNTRY_BONUSES, ANT_HOUSES,
  calcProjectileTravelFrames,
  SuperweaponType, SUPERWEAPON_DEFS, type SuperweaponDef, type SuperweaponState,
  IRON_CURTAIN_DURATION, NUKE_DAMAGE, NUKE_BLAST_CELLS, NUKE_FLIGHT_TICKS,
  NUKE_MIN_FALLOFF, CHRONO_SHIFT_VISUAL_TICKS, SONAR_REVEAL_TICKS, IC_TARGET_RANGE,
} from './types';
import { AssetManager, getSharedAssets } from './assets';
import { AudioManager, type SoundName } from './audio';
import { Camera } from './camera';
import { InputManager } from './input';
import { Entity, resetEntityIds, threatScore as computeThreatScore, CloakState, CLOAK_TRANSITION_FRAMES, SONAR_PULSE_DURATION } from './entity';
import { GameMap, Terrain } from './map';
import { Renderer, type Effect } from './renderer';
import { findPath } from './pathfinding';
import {
  loadScenario, applyScenarioOverrides,
  type TeamType, type ScenarioTrigger, type MapStructure,
  type TriggerGameState, type TriggerActionResult,
  checkTriggerEvent, executeTriggerAction, STRUCTURE_WEAPONS, STRUCTURE_SIZE, STRUCTURE_MAX_HP,
  saveCarryover, TIME_UNIT_TICKS,
} from './scenario';
export { MISSIONS, getMission, getMissionIndex, loadProgress, saveProgress } from './scenario';
export type { MissionInfo } from './scenario';
export { AudioManager } from './audio';
export { preloadAssets } from './assets';

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
type CrateType = 'money' | 'heal' | 'veterancy' | 'unit' | 'armor' | 'firepower' | 'speed' | 'reveal' | 'darkness' | 'explosion' | 'squad' | 'heal_base' | 'napalm' | 'cloak' | 'invulnerability';
interface Crate {
  x: number;
  y: number;
  type: CrateType;
  tick: number; // tick when spawned
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
  /** Cached silo storage capacity (PROC=2000, SILO=1500 each) — recalculated on structure change */
  siloCapacity = 0;
  /** Tick when last EVA "silos needed" warning played (throttle to 30s = 450 ticks) */
  private lastSiloWarningTick = -450;
  /** AI house credit pools for production (Gap #1) */
  houseCredits = new Map<House, number>();
  /** Strategic AI state per non-player house (skip ant missions) */
  private aiStates = new Map<House, AIHouseState>();
  /** Production queue: active build + queued repeats per category (max 5 total) */
  productionQueue: Map<string, { item: ProductionItem; progress: number; queueCount: number }> = new Map();
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
  static readonly SIDEBAR_W = 100;
  sidebarScroll = 0; // scroll offset for sidebar items
  activeTab: SidebarTab = 'infantry';
  tabScrollPositions: Record<SidebarTab, number> = { infantry: 0, vehicle: 0, structure: 0 };
  radarEnabled = true; // player toggle for radar minimap
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
  /** Nuke launch sequence tracking */
  private nukePendingTarget: WorldPos | null = null;
  private nukePendingTick = 0;
  private nukePendingSource: WorldPos | null = null;

  // Player faction (dynamic — set from scenario INI)
  playerHouse: House = House.Spain;
  playerFaction: Faction = 'allied';

  // Difficulty
  difficulty: Difficulty = 'normal';

  // Crate system
  crates: Crate[] = [];
  private nextCrateTick = 0;

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
  private warheadOverrides: Record<string, [number, number, number, number, number]> = {};
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
  /** Cached bridge cell count (recalculated periodically) */
  private bridgeCellCount = 0;

  // Turbo mode (for E2E test runner)
  turboMultiplier = 1;
  // Trigger debug logging
  debugTriggers = false;
  // Player game speed (cycles 1→2→4→1 with backtick key)
  gameSpeed = 1;
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
    this.warheadOverrides = scenario.warheadOverrides;
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
    this.nukePendingTarget = null;
    this.nukePendingTick = 0;
    this.nukePendingSource = null;
    this.globals.clear();
    // SCA01EA: Set global 1 at start so ant waves spawn immediately.
    // rvl2 would set it at time 30 anyway, but this ensures action from the start.
    // Other scenarios (SCA02-04) use global 1 for different purposes (DZ flares,
    // reinforcement timing) and must NOT have it set early.
    if (scenarioId === 'SCA01EA') {
      this.globals.add(1);
    }
    // First crate spawns after 60 seconds
    this.nextCrateTick = GAME_TICKS_PER_SEC * 60;
    this.crates = [];
    this.inflightProjectiles = [];
    this.alliances = buildDefaultAlliances();
    this.allowWin = false;
    this.missionTimer = 0;
    this.missionTimerExpired = false;
    this.builtStructureTypes.clear();
    this.evaMessages = [];
    this.unitsLeftMap = 0;
    this.gameSpeed = 1;
    this.turboMultiplier = 1;
    this.structuresBuilt = 0;
    this.structuresLost = 0;
    this.bridgeCellCount = this.map.countBridgeCells();
    // Initialize trigger timers to game tick 0 (start of mission)
    for (const t of this.triggers) t.timerTick = 0;

    // Initialize AI house credits from scenario
    this.houseCredits.clear();
    for (const s of this.structures) {
      if (s.alive && s.type === 'PROC' && s.house !== House.Spain && s.house !== House.Greece) {
        this.houseCredits.set(s.house, (this.houseCredits.get(s.house) ?? 0) + 200);
      }
    }

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
      this.audio.music.pause();
      this.onStateChange?.('paused');
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.audio.music.resume();
      this.onStateChange?.('playing');
      this.lastTime = performance.now();
      this.scheduleNext();
    }
  }

  /** Pause for comparison mode (does not toggle — sets paused state) */
  pause(): void {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.audio.music.pause();
      this.onStateChange?.('paused');
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
    this.render();
    if (wasPaused) this.state = 'paused';
  }

  /** Disable fog of war (reveal entire map) */
  disableFog(): void {
    this.fogDisabled = true;
    this.map.revealAll();
  }

  /** Main game loop — uses setTimeout fallback when RAF is throttled */
  private gameLoop = (): void => {
    if (this.state === 'paused') {
      // Check for unpause key
      const { keys } = this.input.state;
      if (keys.has('p') || keys.has('Escape')) {
        keys.delete('p');
        keys.delete('Escape');
        this.togglePause();
        return;
      }
      // Render but don't tick — still show pause overlay
      this.render();
      this.timerId = window.setTimeout(this.gameLoop, 100); // slow render rate while paused
      return;
    }
    if (this.state !== 'playing') {
      // Still render final frame but stop ticking
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

    this.render();
    this.scheduleNext();
  };

  /** Schedule next frame — prefer RAF, fall back to setTimeout */
  private scheduleNext(): void {
    if (this.state !== 'playing') return;
    // Use setTimeout as the primary timer — immune to Chrome RAF throttling.
    // 16ms ≈ 60fps render rate, game ticks at fixed 15fps inside.
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

      if (!entity.alive) {
        entity.tickAnimation();
        continue;
      }
      this.updateEntity(entity);

      // S5: Update wasMoving — entity moved this tick if position changed from prevPos
      const movedThisTick = entity.pos.x !== entity.prevPos.x || entity.pos.y !== entity.prevPos.y;
      entity.wasMoving = wasMovingBefore || movedThisTick;
    }

    // Process deferred transport loads (remove loaded passengers from world)
    if (this._pendingTransportLoads.length > 0) {
      const loadSet = new Set(this._pendingTransportLoads);
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
          }
        }
      }
    }

    // H6: Infantry scatter from approaching vehicles (C++ techno.cpp)
    // Every 4 ticks, check if a moving vehicle is in the same cell as idle infantry
    if (this.tick % 4 === 0) {
      for (const inf of this.entities) {
        if (!inf.alive || !inf.stats.isInfantry || inf.isAnt) continue;
        if (inf.mission !== Mission.GUARD && inf.mission !== Mission.AREA_GUARD) continue;
        const ic = inf.cell;
        for (const veh of this.entities) {
          if (!veh.alive || veh.stats.isInfantry || veh.id === inf.id) continue;
          if (!veh.moveTarget && veh.mission !== Mission.MOVE && veh.mission !== Mission.HUNT) continue;
          const vc = veh.cell;
          if (ic.cx === vc.cx && ic.cy === vc.cy) {
            // Scatter infantry to adjacent passable cell
            const angle = Math.atan2(inf.pos.y - veh.pos.y, inf.pos.x - veh.pos.x);
            const sx = inf.pos.x + Math.cos(angle) * CELL_SIZE * 0.8;
            const sy = inf.pos.y + Math.sin(angle) * CELL_SIZE * 0.8;
            const sc = worldToCell(sx, sy);
            if (this.map.isPassable(sc.cx, sc.cy)) {
              inf.pos.x = sx;
              inf.pos.y = sy;
            }
            break;
          }
        }
      }
    }

    // Update effects
    this.effects = this.effects.filter(e => {
      e.frame++;
      return e.frame < e.maxFrames;
    });

    // Crate spawning (every 60-90 seconds, max 3 on map)
    if (this.tick >= this.nextCrateTick && this.crates.length < 3) {
      this.spawnCrate();
      this.nextCrateTick = this.tick + GAME_TICKS_PER_SEC * (60 + Math.floor(Math.random() * 30));
    }

    // Crate pickup — player units walking over crates
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const crate = this.crates[i];
      // Expire after 3 minutes
      if (this.tick - crate.tick > GAME_TICKS_PER_SEC * 180) {
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

    // Repair structures (C++ rules.cpp:228-229 RepairStep, RepairPercent)
    if (this.tick % 15 === 0) {
      for (const idx of this.repairingStructures) {
        const s = this.structures[idx];
        if (!s || !s.alive || s.hp >= s.maxHp || s.sellProgress !== undefined) {
          this.repairingStructures.delete(idx);
          continue;
        }
        const prodItem = PRODUCTION_ITEMS.find(p => p.type === s.type);
        const repairCostPerStep = prodItem ? Math.ceil((prodItem.cost * REPAIR_PERCENT) / (s.maxHp / REPAIR_STEP)) : 1;
        if (this.credits < repairCostPerStep) {
          this.repairingStructures.delete(idx);
          continue;
        }
        this.credits -= repairCostPerStep;
        s.hp = Math.min(s.maxHp, s.hp + REPAIR_STEP);
        this.audio.play('repair');
      }
    }

    // Queen Ant self-healing (SelfHealing=yes in INI): +1 HP every 2 ticks
    if (this.tick % 2 === 0) {
      for (const s of this.structures) {
        if (s.alive && s.type === 'QUEE' && s.hp < s.maxHp) {
          s.hp = Math.min(s.maxHp, s.hp + 1);
        }
      }
    }

    // Elite unit auto-heal: +1 HP every 30 ticks (~2 seconds) for veterancy 2 units
    if (this.tick % 30 === 0) {
      for (const e of this.entities) {
        if (e.alive && e.isPlayerUnit && e.veterancy >= 2 && e.hp < e.maxHp) {
          e.hp = Math.min(e.maxHp, e.hp + 1);
        }
      }
    }

    // Service Depot (FIX) auto-repair nearby player vehicles (every 3 ticks ≈ 5 HP/sec)
    if (this.tick % 3 === 0) {
      for (const s of this.structures) {
        if (!s.alive || s.type !== 'FIX') continue;
        if (s.house !== House.Spain && s.house !== House.Greece) continue;
        const sx = s.cx * CELL_SIZE + CELL_SIZE;
        const sy = s.cy * CELL_SIZE + CELL_SIZE;
        for (const e of this.entities) {
          if (!e.alive || !e.isPlayerUnit || e.hp >= e.maxHp) continue;
          if (e.stats.isInfantry) continue; // depot only repairs vehicles
          const dist = worldDist({ x: sx, y: sy }, e.pos);
          if (dist < 3) {
            e.hp = Math.min(e.maxHp, e.hp + 2);
            // Visual spark effect every 15 ticks
            if (this.tick % 15 === 0) {
              this.effects.push({
                type: 'muzzle', x: e.pos.x, y: e.pos.y - 4,
                frame: 0, maxFrames: 5, size: 3, sprite: 'piff', spriteStart: 0,
              });
            }
          }
        }
      }
    }

    // Defensive structure auto-fire
    this.updateStructureCombat();

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

    // AI base rebuild (existing, still used for ant missions + gap-fill)
    this.updateBaseRebuild();

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
      e => e.alive || e.deathTick < 45 // ~3 seconds at 15fps
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
      if (!s.alive || s.sellProgress !== undefined || (s.house !== House.Spain && s.house !== House.Greece)) continue;
      // Power production — scales with building health (C++ building.cpp:4613 Power_Output)
      const healthRatio = s.hp / s.maxHp;
      if (s.type === 'FACT') this.powerProduced += Math.round(20 * healthRatio);
      else if (s.type === 'POWR') this.powerProduced += Math.round(100 * healthRatio);
      else if (s.type === 'APWR') this.powerProduced += Math.round(200 * healthRatio);
      // Power consumption
      else if (s.type === 'PROC') this.powerConsumed += 30;
      else if (s.type === 'WEAP') this.powerConsumed += 30;
      else if (s.type === 'TENT') this.powerConsumed += 20;
      else if (s.type === 'DOME') this.powerConsumed += 40;
      else if (s.type === 'TSLA') this.powerConsumed += 100;
      else if (s.type === 'HBOX' || s.type === 'PBOX' || s.type === 'GUN') this.powerConsumed += 10;
      else if (s.type === 'SAM' || s.type === 'AGUN') this.powerConsumed += 20;
      else if (s.type === 'FIX') this.powerConsumed += 30;
      else if (s.type === 'HPAD') this.powerConsumed += 10;
      else if (s.type === 'AFLD') this.powerConsumed += 30;
      else if (s.type === 'ATEK' || s.type === 'STEK') this.powerConsumed += 200;
      else if (s.type === 'PDOX' || s.type === 'IRON') this.powerConsumed += 200;
      else if (s.type === 'MSLO') this.powerConsumed += 100;
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
      // Sell: 0→1 over ~1 second = 15 ticks, then finalize
      // Guard: skip if structure was destroyed mid-sell (e.g. by enemy attack)
      if (s.sellProgress !== undefined && s.alive) {
        s.sellProgress = Math.min(1, s.sellProgress + 1 / 15);
        if (s.sellProgress >= 1) {
          s.alive = false;
          s.sellProgress = undefined;
          this.clearStructureFootprint(s);
          // Refund 50% of building cost on successful sell completion
          const prodItem = PRODUCTION_ITEMS.find(p => p.type === s.type);
          // Recalculate silo capacity BEFORE adding refund (structure is now dead)
          this.recalculateSiloCapacity();
          if (prodItem) this.addCredits(Math.floor(prodItem.cost * 0.5), true);
          const wx = s.cx * CELL_SIZE + CELL_SIZE;
          const wy = s.cy * CELL_SIZE + CELL_SIZE;
          this.effects.push({ type: 'explosion', x: wx, y: wy, frame: 0, maxFrames: 17, size: 12,
            sprite: 'veh-hit1', spriteStart: 0 });
          // Spawn infantry at the building site — type depends on building sold
          // Advanced tech buildings spawn engineers, barracks spawn grenadiers, etc.
          const sellInfType = s.type === 'TSLA' || s.type === 'DOME' || s.type === 'APWR'
            ? UnitType.I_E6  // Engineer from tech buildings
            : s.type === 'TENT' ? UnitType.I_E2  // Grenadier from barracks
            : s.type === 'WEAP' || s.type === 'FIX' ? UnitType.I_E3  // Rocket from factory
            : UnitType.I_E1; // Rifleman from everything else
          const inf = new Entity(sellInfType, House.Spain, wx, wy);
          inf.mission = Mission.GUARD;
          this.entities.push(inf);
          this.entityById.set(inf.id, inf);
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
      if (s.alive && (s.house === House.Spain || s.house === House.Greece)) {
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
    const mmSize = Game.SIDEBAR_W - 8;
    const mmX = this.canvas.width - Game.SIDEBAR_W + 4;
    const mmY = this.canvas.height - mmSize - 6;
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
          (s.house === House.Spain || s.house === House.Greece)) {
        this.cursorType = CursorType.SELL;
      } else {
        this.cursorType = CursorType.NOMOVE;
      }
      return;
    }
    if (this.repairMode) {
      const world = this.camera.screenToWorld(mouseX, mouseY);
      const s = this.findStructureAt(world);
      if (s && s.alive && (s.house === House.Spain || s.house === House.Greece) && s.hp < s.maxHp) {
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
          hoveredStruct.house !== House.Spain && hoveredStruct.house !== House.Greece) {
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

    // Sidebar scroll (mouse wheel when cursor is over sidebar) — per-tab
    if (scrollDelta !== 0 && this.input.state.mouseX >= this.canvas.width - Game.SIDEBAR_W) {
      const items = this.cachedAvailableItems ?? this.getAvailableItems();
      const filteredItems = items.filter(it => getItemCategory(it) === this.activeTab);
      const tabBarH = 14;
      const itemStartY = (this.powerProduced > 0 || this.powerConsumed > 0) ? 36 + tabBarH : 28 + tabBarH;
      const maxScroll = Math.max(0, filteredItems.length * 22 - (this.canvas.height - itemStartY - 80));
      const cur = this.tabScrollPositions[this.activeTab];
      this.tabScrollPositions[this.activeTab] = Math.max(0, Math.min(maxScroll, cur + Math.sign(scrollDelta) * 22));
      this.sidebarScroll = this.tabScrollPositions[this.activeTab];
    }

    // Minimap drag scroll: while holding left button on minimap, continuously scroll
    if (this.input.state.mouseDown) {
      const { mouseX, mouseY } = this.input.state;
      const mmSize = Game.SIDEBAR_W - 8;
      const mmX = this.canvas.width - Game.SIDEBAR_W + 4;
      const mmY = this.canvas.height - mmSize - 6;
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

    // Volume controls: +/- and M for mute
    if (keys.has('+') || keys.has('=')) {
      this.audio.setVolume(this.audio.getVolume() + 0.1);
      keys.delete('+'); keys.delete('=');
    }
    if (keys.has('-') || keys.has('_')) {
      this.audio.setVolume(this.audio.getVolume() - 0.1);
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

    // D key: deploy MCV
    if (keys.has('d') && !keys.has('ArrowRight')) {
      for (const id of this.selectedIds) {
        const unit = this.entityById.get(id);
        if (unit?.alive && unit.type === UnitType.V_MCV) {
          this.deployMCV(unit);
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

      // Sell mode: click on player structure to start sell animation
      if (this.sellMode) {
        const world = this.camera.screenToWorld(leftClick.x, leftClick.y);
        const s = this.findStructureAt(world);
        if (s && s.alive && (s.house === House.Spain || s.house === House.Greece) &&
            s.sellProgress === undefined) {
          s.sellProgress = 0; // start sell animation (refund deferred to finalization)
          this.audio.play('sell');
        }
        this.sellMode = false;
        return;
      }

      // Repair mode: click on damaged player structure to toggle repair
      if (this.repairMode) {
        const world = this.camera.screenToWorld(leftClick.x, leftClick.y);
        const s = this.findStructureAt(world);
        if (s && s.alive && (s.house === House.Spain || s.house === House.Greece) && s.hp < s.maxHp) {
          const idx = this.structures.indexOf(s);
          if (this.repairingStructures.has(idx)) {
            this.repairingStructures.delete(idx);
          } else {
            this.repairingStructures.add(idx);
            this.audio.play('heal');
          }
        }
        this.repairMode = false;
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
        const positions = this.calculateFormation(world.x, world.y, units.length);
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
          // Ctrl+click: toggle selection
          if (this.selectedIds.has(clicked.id)) {
            this.selectedIds.delete(clicked.id);
            clicked.selected = false;
          } else {
            this.selectedIds.add(clicked.id);
            clicked.selected = true;
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
            (clickedStruct.house === House.Spain || clickedStruct.house === House.Greece)) {
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
        const itemIdx = this.sidebarItemAtY(rightClick.y);
        if (itemIdx >= 0 && itemIdx < items.length) {
          const item = items[itemIdx];
          const category = getItemCategory(item);
          this.cancelProduction(category);
        }
        return;
      }

      // Minimap right-click: move selected units to that world position
      if (this.selectedIds.size > 0) {
        const mmSize = Game.SIDEBAR_W - 8;
        const mmX = this.canvas.width - Game.SIDEBAR_W + 4;
        const mmY = this.canvas.height - mmSize - 6;
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
          const positions = this.calculateFormation(wx, wy, units.length);
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
          if (dist < CELL_SIZE * 1.5) {
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
        const positions = this.calculateFormation(world.x, world.y, selectedUnits.length);
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

  /** Map a sidebar Y coordinate to the item index, accounting for category headers */
  private sidebarItemAtY(sy: number): number {
    const items = this.getAvailableItems();
    const filteredItems = items.filter(it => getItemCategory(it) === this.activeTab);
    const itemH = 22;
    const tabBarH = 14;
    const itemStartY = ((this.powerProduced > 0 || this.powerConsumed > 0) ? 36 : 28) + tabBarH;
    const tabScroll = this.tabScrollPositions[this.activeTab];
    const relY = sy - itemStartY + tabScroll;
    if (relY < 0) return -1;
    const filteredIdx = Math.floor(relY / itemH);
    if (filteredIdx < 0 || filteredIdx >= filteredItems.length) return -1;
    // Map back to index in the full items array
    const targetItem = filteredItems[filteredIdx];
    return items.indexOf(targetItem);
  }

  /** Handle clicks on the sidebar production panel */
  private handleSidebarClick(sx: number, sy: number): void {
    const sidebarX = this.canvas.width - Game.SIDEBAR_W;

    // Tab bar click detection
    const tabBarY = (this.powerProduced > 0 || this.powerConsumed > 0) ? 36 : 28;
    const tabBarH = 14;
    if (sy >= tabBarY && sy < tabBarY + tabBarH) {
      const margin = 2;
      const tabW = Math.floor((Game.SIDEBAR_W - margin * 2) / 3);
      const relX = sx - sidebarX - margin;
      if (relX >= 0 && relX < tabW) this.activeTab = 'infantry';
      else if (relX >= tabW && relX < tabW * 2) this.activeTab = 'vehicle';
      else if (relX >= tabW * 2) this.activeTab = 'structure';
      return;
    }

    // Sell/Repair button click detection
    const sellRepairY = this.renderer.getSellRepairButtonY();
    const btnH = 14;
    if (sy >= sellRepairY && sy < sellRepairY + btnH) {
      const margin = 2;
      const gap = 4;
      const btnW = Math.floor((Game.SIDEBAR_W - margin * 2 - gap) / 2);
      const relX = sx - sidebarX - margin;
      if (relX >= 0 && relX < btnW) {
        this.sellMode = !this.sellMode;
        this.repairMode = false;
      } else if (relX >= btnW + gap && relX < btnW * 2 + gap) {
        this.repairMode = !this.repairMode;
        this.sellMode = false;
      }
      return;
    }

    // Radar toggle — clicking minimap label area
    const mmSize = Game.SIDEBAR_W - 8;
    const mmY = this.canvas.height - mmSize - 6;
    if (this.hasBuilding('DOME') && sy >= mmY - 12 && sy < mmY) {
      this.radarEnabled = !this.radarEnabled;
      return;
    }

    // Check superweapon button clicks (at bottom of sidebar, above minimap)
    const swClick = this.handleSuperweaponButtonClick(sy);
    if (swClick) return;

    const items = this.getAvailableItems();
    const itemIdx = this.sidebarItemAtY(sy);
    if (itemIdx < 0 || itemIdx >= items.length) return;
    const item = items[itemIdx];
    // startProduction handles both new builds and queueing
    this.startProduction(item);
  }

  /** Check if a sidebar click hit a superweapon button. Returns true if handled. */
  private handleSuperweaponButtonClick(sy: number): boolean {
    // Superweapon buttons are rendered at the bottom of sidebar, above minimap
    const mmSize = Game.SIDEBAR_W - 8;
    const mmY = this.canvas.height - mmSize - 6;
    const btnH = 20;
    const playerSws = this.getPlayerSuperweapons();
    if (playerSws.length === 0) return false;

    const buttonsStartY = mmY - playerSws.length * btnH - 4;
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
      if (state.house !== House.Spain && state.house !== House.Greece) continue;
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
      case 'Dragon': case 'RedEye': case 'MammothTusk': return 'rocket';
      case 'Grenade': return 'grenade';
      default: return 'bullet';
    }
  }

  /** Map weapon name to muzzle flash color (RGB) */
  private weaponMuzzleColor(name: string): string {
    switch (name) {
      case 'TeslaZap': return '120,180,255';           // blue electric
      case 'FireballLauncher': case 'Flamer': case 'Napalm': return '255,140,30';  // orange fire
      case '75mm': case '90mm': case '105mm': case '120mm': case '155mm': return '255,220,100'; // warm yellow
      case 'Dragon': case 'RedEye': case 'MammothTusk': return '255,180,60';    // rocket orange
      case 'Mandible': return '200,255,200';            // green organic
      default: return '255,255,180';                    // standard gunfire white-yellow
    }
  }

  /** Play a positional sound at a world location (spatial stereo panning) */
  private playSoundAt(name: SoundName, worldX: number, worldY: number): void {
    this.audio.playAt(name, worldX, worldY, this.camera.x, this.camera.viewWidth);
  }

  /** Play EVA announcement with 3-second throttle (45 ticks at 15fps) */
  private playEva(sound: SoundName): void {
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
    // Record base attack for AI defense system
    const aiState = this.aiStates.get(s.house);
    if (aiState) {
      aiState.lastBaseAttackTick = this.tick;
      aiState.underAttack = true;
    }
    // EVA "base under attack" for player structures (throttled)
    if ((s.house === House.Spain || s.house === House.Greece) &&
        this.tick - this.lastBaseAttackEva > GAME_TICKS_PER_SEC * 5) {
      this.lastBaseAttackEva = this.tick;
      this.audio.play('eva_base_attack');
      this.minimapAlert(s.cx, s.cy);
    }
    if (s.hp <= 0) {
      s.alive = false;
      s.rubble = true;
      // Clear terrain footprint so units can walk through rubble
      this.clearStructureFootprint(s);
      // Spawn destruction explosion chain — small pops then big blast (like original RA)
      const wx = s.cx * CELL_SIZE + CELL_SIZE;
      const wy = s.cy * CELL_SIZE + CELL_SIZE;
      const [fw, fh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
      // Small pre-explosions scattered across the building footprint
      for (let i = 0; i < 4; i++) {
        const ox = (Math.random() - 0.5) * fw * CELL_SIZE;
        const oy = (Math.random() - 0.5) * fh * CELL_SIZE;
        this.effects.push({
          type: 'explosion', x: wx + ox, y: wy + oy,
          frame: -i * 3, maxFrames: 12, size: 8, // staggered start via negative frame
          sprite: 'veh-hit1', spriteStart: 0,
        });
      }
      // Final large explosion
      this.effects.push({
        type: 'explosion', x: wx, y: wy,
        frame: 0, maxFrames: 22, size: 20,
        sprite: 'fball1', spriteStart: 0,
      });
      // Flying debris
      this.effects.push({
        type: 'debris', x: wx, y: wy,
        frame: 0, maxFrames: 20, size: fw * CELL_SIZE * 0.8,
      });
      this.renderer.screenShake = Math.max(this.renderer.screenShake, 12);
      this.renderer.screenFlash = Math.max(this.renderer.screenFlash, 5);
      this.playSoundAt('building_explode', wx, wy);
      if (s.house === House.Spain || s.house === House.Greece) {
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
        e.takeDamage(blastDmg, 'HE');
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
      entity.flightAltitude = Math.max(0, entity.flightAltitude - 2);
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

    // Harvester AI — automatic ore gathering
    if (entity.alive && entity.type === UnitType.V_HARV && entity.isPlayerUnit &&
        entity.mission === Mission.GUARD && !entity.target) {
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
        if (dist < CELL_SIZE * 1.2) {
          // Close enough — check if move target was the transport
          const tgtDist = worldDist(entity.moveTarget, other.pos);
          if (tgtDist < CELL_SIZE * 2) {
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
    5: Mission.GUARD,       // MISSION_GUARD
    10: Mission.AREA_GUARD, // MISSION_GUARD_AREA
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

        if (entity.mission !== Mission.MOVE || !entity.moveTarget) {
          entity.mission = Mission.MOVE;
          entity.moveTarget = target;
          entity.target = null;
          entity.path = findPath(this.map, entity.cell, { cx: wp.cx, cy: wp.cy }, true, entity.isNavalUnit, entity.stats.speedClass);
          entity.pathIndex = 0;
        } else if (worldDist(entity.pos, target) < 2) {
          // Arrived at waypoint — advance to next mission
          entity.teamMissionIndex++;
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
        if (entity.mission !== Mission.MOVE || !entity.moveTarget) {
          entity.mission = Mission.MOVE;
          entity.moveTarget = target;
          entity.path = findPath(this.map, entity.cell, { cx: wp.cx, cy: wp.cy }, true, entity.isNavalUnit, entity.stats.speedClass);
          entity.pathIndex = 0;
        } else if (worldDist(entity.pos, target) < 2) {
          entity.teamMissionIndex++;
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
      if (this.entitiesAllied(other, vehicle)) continue; // no friendly crush
      const oc = other.cell;
      if (oc.cx === vc.cx && oc.cy === vc.cy) {
        other.takeDamage(other.hp + 10, 'Super'); // instant kill, always die2
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

  /** Harvester AI — seek ore, harvest, return to refinery, unload */
  private updateHarvester(entity: Entity): void {
    switch (entity.harvesterState) {
      case 'idle': {
        // Find nearest ore cell
        const ec = entity.cell;
        const oreCell = this.map.findNearestOre(ec.cx, ec.cy, 30);
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
        } else if (entity.mission === Mission.GUARD) {
          // Arrived but no ore here — re-seek
          entity.harvesterState = 'idle';
        } else if (entity.path.length === 0 && entity.pathIndex >= 0) {
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
          const gained = this.map.depleteOre(ec.cx, ec.cy);
          if (gained > 0) {
            entity.oreLoad += gained;
          }
          // Check if full or current cell depleted
          if (entity.oreLoad >= Entity.ORE_CAPACITY) {
            entity.harvesterState = 'returning';
          } else if (gained === 0) {
            // No more ore at this cell — look for adjacent ore
            const newOre = this.map.findNearestOre(ec.cx, ec.cy, 20);
            if (newOre && entity.oreLoad < Entity.ORE_CAPACITY) {
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
        // When move completes (mission returns to GUARD), transition to unloading or re-seek
        if (entity.mission !== Mission.GUARD) break; // still moving, wait
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
        entity.harvestTick++;
        // Unload over 30 ticks (~2 seconds)
        if (entity.harvestTick >= 30) {
          let added: number;
          if (this.isPlayerControlled(entity)) {
            added = this.addCredits(entity.oreLoad);
            this.audio.play('heal'); // credit received sound
          } else {
            // AI harvester — deposit into houseCredits
            added = entity.oreLoad;
            const cur = this.houseCredits.get(entity.house) ?? 0;
            this.houseCredits.set(entity.house, cur + added);
          }
          // Floating "+N" credits text (show actual amount stored, not raw ore load)
          this.effects.push({
            type: 'text', x: entity.pos.x, y: entity.pos.y - 8,
            frame: 0, maxFrames: 30, size: 0,
            text: `+${added}`, textColor: 'rgba(80,255,80,1)',
          });
          entity.oreLoad = 0;
          entity.harvesterState = 'idle';
        }
        break;
      }
    }
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
        if (dist > CELL_SIZE * 2) {
          entity.animState = AnimState.WALK;
          entity.moveToward({ x: waveCX, y: waveCY }, this.movementSpeed(entity, 0.3));
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
      if (s.house !== House.Spain && s.house !== House.Greece) continue;
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
        return;
      }
    }

    // Air units fly directly to destination — no pathfinding, no terrain collision
    if (entity.isAirUnit && entity.moveTarget) {
      // Ascend to flight altitude
      if (entity.flightAltitude < Entity.FLIGHT_ALTITUDE) {
        entity.flightAltitude = Math.min(Entity.FLIGHT_ALTITUDE, entity.flightAltitude + 3);
      }
      if (entity.moveToward(entity.moveTarget, this.movementSpeed(entity, 0.7))) {
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
      // Check if next cell is blocked by another unit — recalculate path (with cooldown)
      const occ = this.map.getOccupancy(nextCell.cx, nextCell.cy);
      if (occ > 0 && occ !== entity.id && entity.moveTarget &&
          this.tick - entity.lastPathRecalc > 5) {
        entity.lastPathRecalc = this.tick;
        entity.path = findPath(
          this.map, entity.cell,
          worldToCell(entity.moveTarget.x, entity.moveTarget.y), true,
          entity.isNavalUnit, entity.stats.speedClass
        );
        entity.pathIndex = 0;
        if (entity.path.length === 0) {
          // Can't find alternate route — wait a moment
          return;
        }
      }
      const target: WorldPos = {
        x: nextCell.cx * CELL_SIZE + CELL_SIZE / 2,
        y: nextCell.cy * CELL_SIZE + CELL_SIZE / 2,
      };
      // M1: terrain speed by SpeedClass, M2: damage-based speed reduction
      if (entity.moveToward(target, this.movementSpeed(entity))) {
        entity.pathIndex++;
      }
    } else if (entity.moveTarget) {
      // M3: Close-enough distance (C++ Rule.CloseEnoughDistance ~2.5 cells)
      // Unit considers itself "arrived" if within 2.5 cells of final destination
      const closeEnough = CELL_SIZE * 2.5;
      const distToTarget = worldDist(entity.pos, entity.moveTarget);
      if (distToTarget <= closeEnough && entity.moveQueue.length === 0) {
        entity.moveTarget = null;
        entity.mission = this.idleMission(entity);
        entity.animState = AnimState.IDLE;
      } else {
        if (entity.moveToward(entity.moveTarget, this.movementSpeed(entity))) {
          entity.moveTarget = null;
          // Check for queued waypoints
          if (entity.moveQueue.length > 0) {
            const next = entity.moveQueue.shift()!;
            entity.moveTarget = next;
            entity.path = findPath(this.map, entity.cell, worldToCell(next.x, next.y), true, entity.isNavalUnit, entity.stats.speedClass);
            entity.pathIndex = 0;
          } else {
            entity.mission = this.idleMission(entity);
            entity.animState = AnimState.IDLE;
          }
        }
      }
    } else {
      entity.mission = this.idleMission(entity);
      entity.animState = AnimState.IDLE;
    }
  }

  /** Attack target */
  private updateAttack(entity: Entity): void {
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
        if (d > CELL_SIZE * 1.5) {
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
      const dist = worldDist(entity.pos, entity.target.pos); // returns cells
      if (dist < entity.weapon.minRange) {
        // Target too close — retreat away from target (clamped to map bounds)
        entity.animState = AnimState.WALK;
        const dx = entity.pos.x - entity.target.pos.x;
        const dy = entity.pos.y - entity.target.pos.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const minX = this.map.boundsX * CELL_SIZE;
        const maxX = (this.map.boundsX + this.map.boundsW) * CELL_SIZE;
        const minY = this.map.boundsY * CELL_SIZE;
        const maxY = (this.map.boundsY + this.map.boundsH) * CELL_SIZE;
        const retreatX = Math.max(minX, Math.min(maxX, entity.pos.x + (dx / len) * CELL_SIZE * 2));
        const retreatY = Math.max(minY, Math.min(maxY, entity.pos.y + (dy / len) * CELL_SIZE * 2));
        entity.moveToward({ x: retreatX, y: retreatY }, this.movementSpeed(entity, 0.4));
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
          // New burst — set cooldown on the appropriate weapon timer
          if (isSecondary) {
            entity.attackCooldown2 = activeWeapon.rof;
          } else {
            entity.attackCooldown = activeWeapon.rof;
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
        const effectiveInaccuracy = isMoving ? Math.max(baseInaccuracy, 1.0) : baseInaccuracy;
        if (effectiveInaccuracy > 0) {
          // C2: Distance-dependent scatter (C++ bullet.cpp:717-729)
          // Scatter radius scales with distance — close shots are more accurate
          const targetDist = worldDist(entity.pos, entity.target.pos);
          const distFactor = Math.min(1.0, targetDist / activeWeapon.range);
          const scatter = effectiveInaccuracy * CELL_SIZE * distFactor;
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * scatter;
          impactX += Math.cos(angle) * dist;
          impactY += Math.sin(angle) * dist;
          // Check if scattered shot still hits the target (within half-cell)
          const dx = impactX - entity.target.pos.x;
          const dy = impactY - entity.target.pos.y;
          directHit = Math.sqrt(dx * dx + dy * dy) < CELL_SIZE * 0.6;
        }

        // Apply warhead-vs-armor damage multiplier + veterancy bonus + house firepower bias (C8)
        const mult = this.getWarheadMult(activeWeapon.warhead, entity.target.stats.armor);
        const houseBias = this.getFirepowerBias(entity.house);
        // If warhead does 0% vs this armor (e.g. Organic vs vehicles), skip entirely
        let damage = mult <= 0 ? 0 : Math.max(1, Math.round(activeWeapon.damage * mult * entity.damageMultiplier * houseBias));
        // C3: MinDamage/MaxDamage rules (C++ combat.cpp:122-127, rules.cpp:227)
        if (damage > 0) {
          const targetDist = worldDist(entity.pos, entity.target.pos);
          if (targetDist <= CELL_SIZE * 2) damage = Math.max(damage, 1);
          damage = Math.min(damage, MAX_DAMAGE);
        }
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
          const killed = directHit ? entity.target.takeDamage(damage, activeWeapon.warhead) : false;

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
            const ktx = entity.target.pos.x;
            const kty = entity.target.pos.y;
            this.effects.push({ type: 'explosion', x: ktx, y: kty, frame: 0, maxFrames: 18, size: 16,
              sprite: 'fball1', spriteStart: 0 });
            if (!entity.target.stats.isInfantry) {
              this.effects.push({ type: 'debris', x: ktx, y: kty, frame: 0, maxFrames: 12, size: 18 });
            }
            this.renderer.screenShake = Math.max(this.renderer.screenShake, 8);
            const tc2 = worldToCell(ktx, kty);
            this.map.addDecal(tc2.cx, tc2.cy, entity.target.stats.isInfantry ? 6 : 10, 0.6);
            if (entity.target.isAnt) this.playSoundAt('die_ant', ktx, kty);
            else if (entity.target.stats.isInfantry) this.playSoundAt('die_infantry', ktx, kty);
            else this.playSoundAt('die_vehicle', ktx, kty);
            this.playSoundAt('explode_lg', ktx, kty);
            if (this.isPlayerControlled(entity)) this.killCount++;
            else if (this.isPlayerControlled(entity.target)) {
              this.lossCount++;
              this.playEva('eva_unit_lost');
              this.minimapAlert(tc2.cx, tc2.cy);
            }
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
            sprite: 'piffpiff', spriteStart: 0, startX: sx, startY: sy, endX: tx, endY: ty });
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
            sprite: 'piffpiff', spriteStart: 0, startX: sx, startY: sy, endX: tx, endY: ty });
        } else {
          // Muzzle flash at attacker — color matches active weapon
          this.effects.push({ type: 'muzzle', x: sx, y: sy, frame: 0, maxFrames: 4, size: 5,
            sprite: 'piff', spriteStart: 0, muzzleColor: this.weaponMuzzleColor(activeWeapon.name) });

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
          const impactSprite = WARHEAD_PROPS[activeWeapon.warhead]?.explosionSet ?? 'veh-hit1';
          this.effects.push({ type: 'explosion', x: impactX, y: impactY, frame: 0, maxFrames: 17, size: 8,
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
          entity.path = findPath(this.map, entity.cell, worldToCell(entity.moveTarget.x, entity.moveTarget.y), true, entity.isNavalUnit, entity.stats.speedClass);
          entity.pathIndex = 0;
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
      // Use pathfinding to reach target (recalc periodically, staggered by entity ID)
      const targetCell = worldToCell(entity.target.pos.x, entity.target.pos.y);
      if (entity.path.length === 0 || entity.pathIndex >= entity.path.length ||
          ((this.tick + entity.id) % 15 === 0)) {
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
        if (worldDist(entity.pos, other.pos) <= 4 * CELL_SIZE) {
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
        if (worldDist(entity.pos, other.pos) <= 3 * CELL_SIZE) {
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
        // Auto-cloak when idle, no enemies nearby, and sonar pulse expired
        if (entity.sonarPulseTimer > 0) break;
        if (entity.mission === Mission.ATTACK) break; // don't cloak while attacking
        // Check for enemies within 3 cells
        let enemyNearby = false;
        for (const other of this.entities) {
          if (!other.alive || this.entitiesAllied(entity, other)) continue;
          if (worldDist(entity.pos, other.pos) <= 3) {
            enemyNearby = true;
            break;
          }
        }
        if (!enemyNearby) {
          entity.cloakState = CloakState.CLOAKING;
          entity.cloakTimer = CLOAK_TRANSITION_FRAMES;
        }
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
    // A4: Area guard configurable range (C++ Threat_Range(1)/2 from origin)
    const guardRange = entity.stats.guardRange ?? entity.stats.sight;
    const scanRange = guardRange * 1.5;

    // If too far from origin (> guardRange cells), return home — but still attack enemies en route
    const distFromOrigin = worldDist(entity.pos, origin);
    const ec = entity.cell;
    if (distFromOrigin > guardRange) {
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
      entity.mission = Mission.MOVE;
      entity.moveTarget = { x: origin.x, y: origin.y };
      entity.target = null;
      entity.targetStructure = null;
      entity.path = findPath(this.map, ec, worldToCell(origin.x, origin.y), true, entity.isNavalUnit, entity.stats.speedClass);
      entity.pathIndex = 0;
      return;
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
      entity.animState = AnimState.WALK;
      const dx = entity.pos.x - structPos.x;
      const dy = entity.pos.y - structPos.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const minX = this.map.boundsX * CELL_SIZE;
      const maxX = (this.map.boundsX + this.map.boundsW) * CELL_SIZE;
      const minY = this.map.boundsY * CELL_SIZE;
      const maxY = (this.map.boundsY + this.map.boundsH) * CELL_SIZE;
      const retreatX = Math.max(minX, Math.min(maxX, entity.pos.x + (dx / len) * CELL_SIZE * 2));
      const retreatY = Math.max(minY, Math.min(maxY, entity.pos.y + (dy / len) * CELL_SIZE * 2));
      entity.moveToward({ x: retreatX, y: retreatY }, this.movementSpeed(entity, 0.4));
      return;
    }

    if (dist <= range) {
      // Engineer capture/damage (C++ infantry.cpp:618 — capture requires ConditionRed)
      if (entity.type === UnitType.I_E6 && entity.isPlayerUnit) {
        // Friendly repair: engineer heals allied structure by 33% HP
        if ((s.house === House.Spain || s.house === House.Greece) && s.hp < s.maxHp) {
          s.hp = Math.min(s.maxHp, s.hp + Math.ceil(s.maxHp * 0.33));
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
          s.house = House.Spain;
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
        if (s.house !== House.Spain && s.house !== House.Greece) {
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

      entity.desiredFacing = directionTo(entity.pos, structPos);
      entity.tickRotation();
      if (entity.stats.noMovingFire && entity.facing !== entity.desiredFacing) {
        entity.animState = AnimState.IDLE;
        return;
      }
      entity.animState = AnimState.ATTACK;
      if (entity.attackCooldown <= 0 && entity.weapon) {
        // Scale damage: base 0.15× multiplier calibrated for 256-HP structures, scale with maxHp
        const hpScale = s.maxHp / 256;
        const structHouseBias = this.getFirepowerBias(entity.house);
        const damage = Math.max(1, Math.round(entity.weapon.damage * 0.15 * hpScale * structHouseBias));
        const destroyed = this.damageStructure(s, damage);
        entity.attackCooldown = entity.weapon.rof;
        if (entity.hasTurret) entity.isInRecoilState = true; // M6
        this.playSoundAt(this.audio.weaponSound(entity.weapon.name), entity.pos.x, entity.pos.y);
        // Muzzle + impact effects
        this.effects.push({
          type: 'muzzle', x: entity.pos.x, y: entity.pos.y,
          frame: 0, maxFrames: 4, size: 5, sprite: 'piff', spriteStart: 0,
          muzzleColor: this.weaponMuzzleColor(entity.weapon.name),
        });
        // R8: Impact explosion sprite from warhead's explosionSet (C++ warhead.cpp)
        const structImpactSprite = WARHEAD_PROPS[entity.weapon.warhead]?.explosionSet ?? 'veh-hit1';
        this.effects.push({
          type: 'explosion', x: structPos.x, y: structPos.y,
          frame: 0, maxFrames: 10, size: 8,
          sprite: structImpactSprite, spriteStart: 0,
        });
        if (destroyed) {
          if (this.isPlayerControlled(entity)) this.killCount++;
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
          muzzleColor: this.weaponMuzzleColor(entity.weapon.name),
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
        const ffImpactSprite = WARHEAD_PROPS[entity.weapon.warhead]?.explosionSet ?? 'veh-hit1';
        this.effects.push({
          type: 'explosion', x: impactX, y: impactY,
          frame: 0, maxFrames: 17, size: 8, sprite: ffImpactSprite, spriteStart: 0,
        });
        const tc = worldToCell(impactX, impactY);
        this.map.addDecal(tc.cx, tc.cy, 3, 0.3);
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

  private updateStructureCombat(): void {
    const isLowPower = this.powerConsumed > this.powerProduced && this.powerProduced > 0;
    for (const s of this.structures) {
      if (!s.alive || !s.weapon || s.sellProgress !== undefined) continue;
      // Severe brownout: defensive structures cannot fire at all
      if (this.powerConsumed > this.powerProduced * 1.5 && this.powerProduced > 0 && Game.DEFENSE_TYPES.has(s.type)) {
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

      // Find closest enemy in range
      let bestTarget: Entity | null = null;
      let bestDist = Infinity;
      for (const e of this.entities) {
        if (!e.alive) continue;
        if (this.isAllied(s.house, e.house)) continue; // don't shoot friendlies
        const dist = worldDist(structPos, e.pos);
        if (dist < range && dist < bestDist) {
          // LOS check
          const ec = e.cell;
          if (!this.map.hasLineOfSight(s.cx, s.cy, ec.cx, ec.cy)) continue;
          bestTarget = e;
          bestDist = dist;
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
          bestDist = bestAirDist;
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
        // Apply warhead-vs-armor multiplier
        const wh = (s.weapon.warhead ?? 'HE') as WarheadType;
        const mult = this.getWarheadMult(wh, bestTarget.stats.armor);
        const damage = Math.max(1, Math.round(s.weapon.damage * mult));
        const killed = bestTarget.takeDamage(damage, wh);

        // Fire effects — color based on structure type
        const structMuzzleColor = (s.type === 'TSLA' || s.type === 'QUEE') ? '120,180,255'
          : s.type === 'FTUR' ? '255,140,30' : '255,255,180';
        this.effects.push({
          type: 'muzzle', x: sx, y: sy,
          frame: 0, maxFrames: 4, size: 5, sprite: 'piff', spriteStart: 0,
          muzzleColor: structMuzzleColor,
        });

        // Tesla coil and Queen Ant get special effect
        if (s.type === 'TSLA' || s.type === 'QUEE') {
          this.effects.push({
            type: 'tesla', x: bestTarget.pos.x, y: bestTarget.pos.y,
            frame: 0, maxFrames: 8, size: 12, sprite: 'piffpiff', spriteStart: 0,
            startX: sx, startY: sy, endX: bestTarget.pos.x, endY: bestTarget.pos.y,
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
          this.effects.push({
            type: 'explosion', x: bestTarget.pos.x, y: bestTarget.pos.y,
            frame: 0, maxFrames: 10, size: 6,
            // R8: Impact explosion sprite from warhead's explosionSet (C++ warhead.cpp)
            sprite: WARHEAD_PROPS[wh]?.explosionSet ?? 'veh-hit1', spriteStart: 0,
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
          this.effects.push({
            type: 'explosion', x: bestTarget.pos.x, y: bestTarget.pos.y,
            frame: 0, maxFrames: 18, size: 16, sprite: 'fball1', spriteStart: 0,
          });
          this.renderer.screenShake = Math.max(this.renderer.screenShake, 4);
          const tc = worldToCell(bestTarget.pos.x, bestTarget.pos.y);
          this.map.addDecal(tc.cx, tc.cy, bestTarget.stats.isInfantry ? 4 : 8, 0.5);
          if (s.house === House.Spain || s.house === House.Greece) this.killCount++;
          if (bestTarget.isAnt) {
            this.playSoundAt('die_ant', bestTarget.pos.x, bestTarget.pos.y);
          } else if (bestTarget.stats.isInfantry) {
            this.playSoundAt('die_infantry', bestTarget.pos.x, bestTarget.pos.y);
          } else {
            this.playSoundAt('die_vehicle', bestTarget.pos.x, bestTarget.pos.y);
          }
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
      if (s.house === House.Spain || s.house === House.Greece) continue; // player queens don't spawn
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
        // Ascend 3px/tick until at flight altitude
        entity.flightAltitude = Math.min(Entity.FLIGHT_ALTITUDE, entity.flightAltitude + 3);
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
          entity.moveToward(targetPos, this.movementSpeed(entity, 0.7));
        } else if (entity.mission === Mission.MOVE && entity.moveTarget) {
          // Simple move — fly to destination
          if (entity.moveToward(entity.moveTarget, this.movementSpeed(entity, 0.7))) {
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
        entity.animState = AnimState.WALK;
        // Find home pad
        const padIdx = this.findLandingPad(entity);
        if (padIdx < 0) {
          // No pad available — orbit in place
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
          entity.moveToward(padPos, this.movementSpeed(entity, 0.7));
        }
        return true;
      }

      case 'landing': {
        // Descend 2px/tick
        entity.flightAltitude = Math.max(0, entity.flightAltitude - 2);
        entity.animState = AnimState.IDLE;
        if (entity.flightAltitude <= 0) {
          entity.flightAltitude = 0;
          if (entity.ammo >= 0 && entity.ammo < entity.maxAmmo) {
            entity.aircraftState = 'rearming';
            entity.rearmTimer = 30;
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
            entity.rearmTimer = 30; // next ammo tick
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

    const speed = this.movementSpeed(entity, 0.7);
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

  /** Helicopter hover + strafe: close to range, face target, fire, lateral oscillation */
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
      entity.moveToward(targetPos, this.movementSpeed(entity, 0.7));
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

    // Lateral strafe oscillation (±0.5px/tick, flip every 30 ticks)
    const strafePhase = Math.sin(this.tick * 0.21) * 0.5;
    const perpDx = -(targetPos.y - entity.pos.y);
    const perpDy = (targetPos.x - entity.pos.x);
    const perpLen = Math.sqrt(perpDx * perpDx + perpDy * perpDy) || 1;
    entity.pos.x += (perpDx / perpLen) * strafePhase;
    entity.pos.y += (perpDy / perpLen) * strafePhase;

    // Out of ammo — RTB
    if (entity.ammo === 0) {
      entity.aircraftState = 'returning';
      entity.mission = Mission.GUARD;
      entity.target = null;
      entity.targetStructure = null;
    }

    return true;
  }

  /** Fire weapon at entity target (helper for aircraft) */
  private fireWeaponAt(attacker: Entity, target: Entity, weapon: WeaponStats): void {
    const wh = weapon.warhead as WarheadType;
    const mult = this.getWarheadMult(wh, target.stats.armor);
    const damage = Math.max(1, Math.round(weapon.damage * mult * attacker.damageMultiplier));
    const killed = target.takeDamage(damage, wh);
    if (killed) {
      attacker.creditKill();
    }
    // Fire effect
    this.effects.push({
      type: 'muzzle',
      x: attacker.pos.x, y: attacker.pos.y - attacker.flightAltitude,
      frame: 0, maxFrames: 4, size: 4, sprite: 'piff', spriteStart: 0,
    });
  }

  /** Fire weapon at structure target (helper for aircraft) */
  private fireWeaponAtStructure(attacker: Entity, s: MapStructure, weapon: WeaponStats): void {
    const wh = (weapon.warhead ?? 'HE') as WarheadType;
    const armorIdx = 4; // concrete for structures
    const overridden = this.warheadOverrides[wh];
    const mult = overridden ? overridden[armorIdx] ?? 1 : WARHEAD_VS_ARMOR[wh]?.[armorIdx] ?? 1;
    const damage = Math.max(1, Math.round(weapon.damage * mult * attacker.damageMultiplier));
    s.hp -= damage;
    if (s.hp <= 0) {
      s.hp = 0;
      s.alive = false;
      s.rubble = true;
      attacker.creditKill();
    }
    this.effects.push({
      type: 'muzzle',
      x: attacker.pos.x, y: attacker.pos.y - attacker.flightAltitude,
      frame: 0, maxFrames: 4, size: 4, sprite: 'piff', spriteStart: 0,
    });
  }

  private threatScore(scanner: Entity, target: Entity, dist: number): number {
    const isTargetAttackingAlly = !!(target.target && target.mission === Mission.ATTACK &&
      this.entitiesAllied(scanner, target.target));
    // A9: Closing speed — positive means target is approaching (approximated via prevPos)
    const prevDist = worldDist(scanner.pos, target.prevPos);
    const closingSpeed = prevDist - dist;
    return computeThreatScore(scanner, target, dist, isTargetAttackingAlly, closingSpeed);
  }

  private getWarheadMult(warhead: WarheadType, armor: ArmorType): number {
    const armorIdx = armor === 'none' ? 0 : armor === 'wood' ? 1 : armor === 'light' ? 2 : armor === 'heavy' ? 3 : 4;
    const overridden = this.warheadOverrides[warhead];
    if (overridden) return overridden[armorIdx] ?? 1;
    return WARHEAD_VS_ARMOR[warhead]?.[armorIdx] ?? 1;
  }

  /** Damage-based speed reduction (C++ drive.cpp:1159-1161).
   *  Single tier: <=50% HP = 75% speed (ConditionYellow). */
  private damageSpeedFactor(entity: Entity): number {
    const ratio = entity.hp / entity.maxHp;
    if (ratio <= 0.5) return 0.75;   // ConditionYellow: three-quarters speed
    return 1.0;
  }

  /** M1+M2: Compute movement speed with terrain and damage multipliers.
   *  All moveToward calls should use this instead of flat speed * 0.5. */
  private movementSpeed(entity: Entity, speedFraction = 0.5): number {
    return entity.stats.speed * speedFraction
      * this.map.getSpeedMultiplier(entity.cell.cx, entity.cell.cy, entity.stats.speedClass)
      * this.damageSpeedFactor(entity);
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
        const killed = target.takeDamage(proj.damage, proj.weapon.warhead);

        if (!killed && attacker) {
          this.triggerRetaliation(target, attacker);
          this.scatterInfantry(target, { x: proj.impactX, y: proj.impactY });
        }

        if (killed) {
          if (attacker) attacker.creditKill();
          this.effects.push({ type: 'explosion', x: target.pos.x, y: target.pos.y,
            frame: 0, maxFrames: 18, size: 16, sprite: 'fball1', spriteStart: 0 });
          if (!target.stats.isInfantry) {
            this.effects.push({ type: 'debris', x: target.pos.x, y: target.pos.y,
              frame: 0, maxFrames: 12, size: 18 });
          }
          this.renderer.screenShake = Math.max(this.renderer.screenShake, 8);
          const tc = worldToCell(target.pos.x, target.pos.y);
          this.map.addDecal(tc.cx, tc.cy, target.stats.isInfantry ? 6 : 10, 0.6);
          if (target.isAnt) this.playSoundAt('die_ant', target.pos.x, target.pos.y);
          else if (target.stats.isInfantry) this.playSoundAt('die_infantry', target.pos.x, target.pos.y);
          else this.playSoundAt('die_vehicle', target.pos.x, target.pos.y);
          if (proj.attackerIsPlayer) this.killCount++;
          else if (this.isPlayerControlled(target)) {
            this.lossCount++;
            this.playEva('eva_unit_lost');
            this.minimapAlert(tc.cx, tc.cy);
          }
        }
      }

      // Splash damage at impact point
      if (proj.weapon.splash && proj.weapon.splash > 0) {
        const attackerHouse = attacker?.house ?? (proj.attackerIsPlayer ? House.Spain : House.USSR);
        this.applySplashDamage(
          { x: proj.impactX, y: proj.impactY }, proj.weapon,
          proj.directHit && target ? target.id : -1,
          attackerHouse, attacker ?? undefined,
        );
      }

      // R8: Impact explosion sprite from warhead's explosionSet (C++ warhead.cpp)
      const projImpactSprite = WARHEAD_PROPS[proj.weapon.warhead]?.explosionSet ?? 'veh-hit1';
      this.effects.push({ type: 'explosion', x: proj.impactX, y: proj.impactY,
        frame: 0, maxFrames: 17, size: 8, sprite: projImpactSprite, spriteStart: 0 });
    }
  }

  /** Apply AOE splash damage to entities near an impact point */
  private applySplashDamage(
    center: WorldPos, weapon: { damage: number; warhead: WarheadType; splash?: number },
    primaryTargetId: number, attackerHouse: House, attacker?: Entity,
  ): void {
    const splashRange = weapon.splash ?? 0;
    if (splashRange <= 0) return;
    const attackerIsPlayerControlled = attackerHouse === House.Spain || attackerHouse === House.Greece;

    for (const other of this.entities) {
      if (!other.alive || other.id === primaryTargetId) continue;
      // H2: Splash damage hits ALL units in radius including friendlies (C++ Explosion_Damage)
      const isFriendly = this.isAllied(other.house, attackerHouse);
      const dist = worldDist(center, other.pos);
      if (dist > splashRange) continue;

      // C6: SpreadFactor falloff (C++ combat.cpp:107 — distance /= SpreadFactor * (PIXEL_LEPTON_W/2))
      // Higher SpreadFactor = divide distance by more = LESS damage reduction = WIDER splash
      // spreadFactor 1=linear, 2=wider (slower falloff), 3=even wider
      const spreadFactor = WARHEAD_META[weapon.warhead]?.spreadFactor ?? 1;
      const ratio = dist / splashRange;
      const falloff = Math.pow(1 - ratio, 1 / spreadFactor);
      const mult = this.getWarheadMult(weapon.warhead, other.stats.armor);
      if (mult <= 0) continue; // warhead does 0% vs this armor
      // H3: No 0.5x multiplier — C++ splash uses damage / distance directly
      const splashDmg = Math.max(1, Math.round(weapon.damage * mult * falloff));
      const killed = other.takeDamage(splashDmg, weapon.warhead);

      // Retaliation from splash damage
      if (!killed && attacker) {
        this.triggerRetaliation(other, attacker);
      }

      // Infantry scatter: push nearby infantry away from explosion
      if (other.alive && other.stats.isInfantry && dist < splashRange * 0.8) {
        const angle = Math.atan2(other.pos.y - center.y, other.pos.x - center.x);
        const pushDist = CELL_SIZE * (1 - dist / splashRange);
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
        // Credit kill only for enemy kills (not friendly fire)
        if (!isFriendly && attacker) attacker.creditKill();
        this.effects.push({
          type: 'explosion', x: other.pos.x, y: other.pos.y,
          frame: 0, maxFrames: 18, size: 12,
          sprite: 'fball1', spriteStart: 0,
        });
        this.renderer.screenShake = Math.max(this.renderer.screenShake, 4);
        if (other.isAnt) this.playSoundAt('die_ant', other.pos.x, other.pos.y);
        else if (other.stats.isInfantry) this.playSoundAt('die_infantry', other.pos.x, other.pos.y);
        else this.playSoundAt('die_vehicle', other.pos.x, other.pos.y);
        // Track kills/losses from splash
        if (!isFriendly && attackerIsPlayerControlled) this.killCount++;
        else if (!isFriendly && this.isPlayerControlled(other)) {
          this.lossCount++;
          this.playEva('eva_unit_lost');
          const oc = other.cell;
          this.minimapAlert(oc.cx, oc.cy);
        }
        // Friendly fire kills still count as losses
        if (isFriendly && attackerIsPlayerControlled) {
          this.lossCount++;
          this.playEva('eva_unit_lost');
          const oc = other.cell;
          this.minimapAlert(oc.cx, oc.cy);
        }
      }
    }

    // Tree destruction: large explosions (splash >= 1.5) can destroy trees in the blast radius
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
    [House.Ukraine]: 4, [House.Germany]: 5,
    [House.Turkey]: 7, [House.Neutral]: 10,
  };

  /** Build trigger game state snapshot for event checks (uses precomputed shared state) */
  private buildTriggerState(trigger: ScenarioTrigger, shared: {
    structureTypes: Set<string>; destroyedTriggerNames: Set<string>;
    enemyUnitsAlive: number; playerFactories: number;
    houseAlive: Map<number, boolean>; builtStructureTypes: Set<string>;
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
      houseAlive: shared.houseAlive,
      builtStructureTypes: shared.builtStructureTypes,
      isLowPower: this.powerConsumed > this.powerProduced && this.powerProduced > 0,
      playerCredits: this.credits,
    };
  }

  /** Process trigger system — check conditions and fire actions */
  private processTriggers(): void {
    // Tick mission timer (processTriggers runs every 15 ticks, so decrement by 15)
    if (this.missionTimer > 0) {
      this.missionTimer -= 15;
      if (this.missionTimer <= 0) {
        this.missionTimerExpired = true;
      }
    }

    // Precompute shared state once for all triggers (avoids O(N*M) recomputation)
    const structureTypes = new Set<string>();
    const destroyedTriggerNames = new Set<string>();
    const houseAlive = new Map<number, boolean>();
    let playerFactories = 0;
    for (const s of this.structures) {
      if (s.alive) {
        structureTypes.add(s.type);
        if ((s.house === House.Spain || s.house === House.Greece) &&
            (s.type === 'FACT' || s.type === 'WEAP' || s.type === 'TENT')) {
          playerFactories++;
        }
        const hi = Game.HOUSE_TO_INDEX[s.house];
        if (hi !== undefined) houseAlive.set(hi, true);
      } else if (s.triggerName) {
        destroyedTriggerNames.add(s.triggerName);
      }
    }
    let enemyUnitsAlive = 0;
    for (const e of this.entities) {
      if (e.alive && !this.isPlayerControlled(e) && !e.isCivilian) enemyUnitsAlive++;
      if (e.alive) {
        const hi = Game.HOUSE_TO_INDEX[e.house];
        if (hi !== undefined) houseAlive.set(hi, true);
      }
    }
    const shared = { structureTypes, destroyedTriggerNames, enemyUnitsAlive, playerFactories, houseAlive, builtStructureTypes: this.builtStructureTypes };

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
        const result = executeTriggerAction(
          action, this.teamTypes, this.waypoints, this.globals, this.triggers
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
        }
        if (result.timerExtend !== undefined) {
          this.missionTimer += result.timerExtend * TIME_UNIT_TICKS;
          this.missionTimerExpired = false;
        }
        // Autocreate: enable AI auto-spawning (queen spawning + base rebuild)
        if (result.autocreate) this.autocreateEnabled = true;
        // Airstrike: explosion + damage at trigger waypoint
        if (result.airstrike) {
          const wp = this.waypoints.get(0);
          if (wp) {
            const wx = wp.cx * CELL_SIZE + CELL_SIZE / 2;
            const wy = wp.cy * CELL_SIZE + CELL_SIZE / 2;
            this.effects.push({ type: 'explosion', x: wx, y: wy, frame: 0, maxFrames: 20, size: 24, sprite: 'art-exp1', spriteStart: 0 });
            for (const e of this.entities) {
              if (!e.alive) continue;
              if (worldDist(e.pos, { x: wx, y: wy }) <= 4 * CELL_SIZE) e.takeDamage(200, 'HE');
            }
            this.audio.play('explode_lg');
          }
        }
        // Nuke: massive explosion at map center
        if (result.nuke) {
          const cx = (this.map.boundsX + this.map.boundsW / 2) * CELL_SIZE;
          const cy = (this.map.boundsY + this.map.boundsH / 2) * CELL_SIZE;
          this.effects.push({ type: 'explosion', x: cx, y: cy, frame: 0, maxFrames: 30, size: 48, sprite: 'art-exp1', spriteStart: 0 });
          for (const e of this.entities) {
            if (!e.alive) continue;
            if (worldDist(e.pos, { x: cx, y: cy }) <= 8 * CELL_SIZE) e.takeDamage(500, 'HE');
          }
        }
        // Center camera on waypoint
        if (result.centerView !== undefined) {
          const wp = this.waypoints.get(result.centerView);
          if (wp) {
            this.camera.centerOn(wp.cx * CELL_SIZE + CELL_SIZE / 2, wp.cy * CELL_SIZE + CELL_SIZE / 2);
          }
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
        // Destroy the unit that triggered this (e.g. hazard zone kill)
        if (result.destroyTriggeringUnit) {
          for (const e of this.entities) {
            if (!e.alive || !e.isPlayerUnit) continue;
            const cellIdx = e.cell.cy * MAP_CELLS + e.cell.cx;
            const trigName = this.map.cellTriggers.get(cellIdx);
            if (trigName === trigger.name) {
              e.takeDamage(9999);
              this.effects.push({
                type: 'explosion', x: e.pos.x, y: e.pos.y,
                frame: 0, maxFrames: 18, size: 12,
                sprite: 'fball1', spriteStart: 0,
              });
            }
          }
        }
      };

      executeAction(trigger.action1);
      if (trigger.actionControl === 1) {
        executeAction(trigger.action2);
      }
    }
  }

  /** Display an EVA text message (by trigger data ID) */
  private showEvaMessage(id: number): void {
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
        if (!s.alive || (s.house !== House.Spain && s.house !== House.Greece)) continue;
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
      b.alive && b.type === 'TENT' && (b.house === House.Spain || b.house === House.Greece)
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
      const inf = new Entity(types[i], House.Spain, rx, ry);
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
      s.house !== House.Spain && s.house !== House.Greece
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
    }
  }

  /** Check if player has a building of the given type */
  hasBuilding(type: string): boolean {
    return this.structures.some(s => s.alive && s.type === type &&
      this.isAllied(s.house, this.playerHouse));
  }

  /** Calculate total silo storage capacity from alive player structures.
   *  C++ parity: HouseClass::Adjust_Capacity() — PROC provides 2000, SILO provides 1500. */
  calculateSiloCapacity(): number {
    let capacity = 0;
    for (const s of this.structures) {
      if (!s.alive || !this.isAllied(s.house, this.playerHouse)) continue;
      if (s.buildProgress !== undefined && s.buildProgress < 1) continue; // under construction
      if (s.type === 'PROC') capacity += 2000;
      else if (s.type === 'SILO') capacity += 1500;
    }
    return capacity;
  }

  /** Recalculate silo capacity and cap credits if they exceed new capacity.
   *  C++ parity: HouseClass::Adjust_Capacity() caps credits when storage is lost. */
  recalculateSiloCapacity(): void {
    this.siloCapacity = this.calculateSiloCapacity();
    if (this.siloCapacity > 0 && this.credits > this.siloCapacity) {
      this.credits = this.siloCapacity;
    } else if (this.siloCapacity === 0) {
      this.credits = 0;
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
    // EVA "silos needed" warning when credits exceed 80% capacity (throttled to 30s)
    if (this.siloCapacity > 0 && this.credits >= this.siloCapacity * 0.8 &&
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
    return PRODUCTION_ITEMS.filter(item => {
      // Must have primary prerequisite building
      if (!this.hasBuilding(item.prerequisite)) return false;
      // Faction filter: player only sees items matching their faction or 'both'
      if (item.faction !== 'both' && item.faction !== this.playerFaction) return false;
      // Tech prerequisite (e.g. Artillery needs Radar Dome)
      if (item.techPrereq && !this.hasBuilding(item.techPrereq)) return false;
      return true;
    });
  }

  /** Start building an item (called from sidebar click) */
  startProduction(item: ProductionItem): void {
    const category = getItemCategory(item);
    const effectiveCost = this.getEffectiveCost(item);
    const existing = this.productionQueue.get(category);
    if (existing) {
      // Already building — queue another of the same item (max 5 total)
      if (existing.item.type === item.type && existing.queueCount < 5) {
        if (this.credits < effectiveCost) {
          this.playEva('eva_insufficient_funds');
          return;
        }
        this.credits -= effectiveCost;
        existing.queueCount++;
      }
      return;
    }
    if (this.credits < effectiveCost) {
      this.playEva('eva_insufficient_funds');
      return;
    }
    this.credits -= effectiveCost;
    this.productionQueue.set(category, { item, progress: 0, queueCount: 1 });
    this.audio.play('eva_building');
  }

  /** Cancel production in a category — removes one from queue, or cancels active build */
  cancelProduction(category: string): void {
    const entry = this.productionQueue.get(category);
    if (!entry) return;
    const effectiveCost = this.getEffectiveCost(entry.item);
    if (entry.queueCount > 1) {
      // Dequeue one — refund full cost of queued item
      entry.queueCount--;
      this.addCredits(effectiveCost, true);
    } else {
      // Cancel active build — refund based on remaining progress
      const refund = Math.floor(effectiveCost * (1 - entry.progress / entry.item.buildTime));
      this.addCredits(refund, true);
      this.productionQueue.delete(category);
    }
  }

  /** Advance production queues each tick */
  private tickProduction(): void {
    // Low power: production runs at 25% speed (C++ parity)
    const lowPower = this.powerConsumed > this.powerProduced && this.powerProduced > 0;
    const powerMult = lowPower ? 0.25 : 1.0;
    for (const [category, entry] of this.productionQueue) {
      // Check prerequisite still exists
      if (!this.hasBuilding(entry.item.prerequisite)) {
        this.cancelProduction(category);
        continue;
      }
      // Multi-factory speed bonus: 1 factory=1x, 2=1.5x, 3=1.75x, 4+=2x
      const factoryCount = this.countPlayerBuildings(entry.item.prerequisite);
      const speedMult = factoryCount <= 1 ? 1.0
        : factoryCount === 2 ? 1.5
        : factoryCount === 3 ? 1.75
        : 2.0;
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

  /** AI base rebuild — compare alive structures against blueprint, rebuild missing ones */
  private updateBaseRebuild(): void {
    if (this.baseBlueprint.length === 0) return;

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
    }

    // Process one rebuild per cycle
    if (this.baseRebuildQueue.length > 0) {
      const bp = this.baseRebuildQueue.shift()!;
      if (!aiHousesWithFact.has(bp.house)) return;

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
      const entity = new Entity(unitType, House.Spain, spawnX, spawnY);
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
    const entity = new Entity(unitType, House.Spain, spawnX, spawnY);
    entity.mission = Mission.GUARD;
    this.entities.push(entity);
    this.entityById.set(entity.id, entity);

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
    // Must be adjacent to an existing player structure (footprint-based AABB)
    let adjacent = false;
    for (const s of this.structures) {
      if (!s.alive || (s.house !== House.Spain && s.house !== House.Greece)) continue;
      const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
      const exL = s.cx - 1, exT = s.cy - 1, exR = s.cx + sw + 1, exB = s.cy + sh + 1;
      const nL = cx, nT = cy, nR = cx + fw, nB = cy + fh;
      if (nL < exR && nR > exL && nT < exB && nB > exT) { adjacent = true; break; }
    }
    if (!adjacent) return false;

    const image = item.type.toLowerCase();
    const maxHp = STRUCTURE_MAX_HP[item.type] ?? 256;
    // Create structure with construction animation
    const newStruct: MapStructure = {
      type: item.type,
      image,
      house: House.Spain,
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
      const harv = new Entity(UnitType.V_HARV, House.Spain,
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
      house: House.Spain,
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
    money: 'money', heal: 'heal', veterancy: 'veterancy', unit: 'unit',
    armor: 'armor', firepower: 'firepower', speed: 'speed',
    reveal: 'reveal', darkness: 'darkness', explosion: 'explosion',
    squad: 'squad', heal_base: 'heal_base', napalm: 'napalm',
    cloak: 'cloak', invulnerability: 'invulnerability',
  };

  /** Spawn a crate on a random revealed, passable cell */
  private spawnCrate(): void {
    // Build crate distribution — silver crates are common, wood rarer
    // Default: money×2, heal, veterancy, unit. Overrides from [General] replace silver/wood/water types.
    const crateTypes: CrateType[] = [
      'money', 'money', 'heal', 'veterancy', 'unit',  // common (existing)
      'reveal', 'squad', 'heal_base',                   // medium
      'speed', 'armor', 'firepower',                     // uncommon
      'explosion', 'napalm', 'darkness',                 // risky
      'cloak', 'invulnerability',                        // rare/powerful
    ];
    if (this.crateOverrides.silver) {
      const t = Game.CRATE_NAME_MAP[this.crateOverrides.silver];
      if (t) { crateTypes[0] = t; crateTypes[1] = t; } // silver = first 2 slots
    }
    if (this.crateOverrides.wood) {
      const t = Game.CRATE_NAME_MAP[this.crateOverrides.wood];
      if (t) crateTypes[4] = t; // wood = last slot
    }
    if (this.crateOverrides.water) {
      const t = Game.CRATE_NAME_MAP[this.crateOverrides.water];
      if (t) crateTypes[2] = t; // water = middle slot
    }
    const type = crateTypes[Math.floor(Math.random() * crateTypes.length)];
    // Try up to 20 random cells to find a valid spawn
    for (let attempt = 0; attempt < 20; attempt++) {
      const cx = this.map.boundsX + Math.floor(Math.random() * this.map.boundsW);
      const cy = this.map.boundsY + Math.floor(Math.random() * this.map.boundsH);
      if (!this.map.isPassable(cx, cy)) continue;
      if (this.map.getVisibility(cx, cy) === 0) continue; // must be explored
      const x = cx * CELL_SIZE + CELL_SIZE / 2;
      const y = cy * CELL_SIZE + CELL_SIZE / 2;
      this.crates.push({ x, y, type, tick: this.tick });
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
        this.addCredits(500, true);
        this.evaMessages.push({ text: 'MONEY CRATE', tick: this.tick });
        break;
      case 'heal':
        unit.hp = unit.maxHp;
        this.evaMessages.push({ text: 'UNIT HEALED', tick: this.tick });
        break;
      case 'veterancy':
        if (unit.veterancy < 2) {
          unit.kills = unit.veterancy === 0 ? 3 : 6;
          unit.creditKill(); // triggers promotion
        }
        this.evaMessages.push({ text: 'UNIT PROMOTED', tick: this.tick });
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
        const bonus = new Entity(uType, House.Spain, crate.x + CELL_SIZE, crate.y);
        bonus.mission = Mission.GUARD;
        this.entities.push(bonus);
        this.entityById.set(bonus.id, bonus);
        this.evaMessages.push({ text: 'REINFORCEMENTS', tick: this.tick });
        break;
      }
      case 'armor':
        // Double HP (like RA Armor crate — increases maxHp and heals to new max)
        unit.maxHp = Math.round(unit.maxHp * 2);
        unit.hp = unit.maxHp;
        this.evaMessages.push({ text: 'ARMOR UPGRADE', tick: this.tick });
        break;
      case 'firepower':
        // Promote to elite (max veterancy — 1.5× damage)
        if (unit.veterancy < 2) {
          unit.kills = 6;
          unit.creditKill();
        }
        this.evaMessages.push({ text: 'FIREPOWER UPGRADE', tick: this.tick });
        break;
      case 'speed':
        // 1.5× speed boost (M7 parity)
        unit.speedBias = 1.5;
        this.evaMessages.push({ text: 'SPEED UPGRADE', tick: this.tick });
        break;
      case 'reveal': {
        // Reveal 5x5 cells around crate
        const cc = worldToCell(crate.x, crate.y);
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            this.map.setVisibility(cc.cx + dx, cc.cy + dy, 2);
          }
        }
        this.evaMessages.push({ text: 'MAP REVEALED', tick: this.tick });
        break;
      }
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
            e.takeDamage(200, 'HE');
          }
        }
        this.effects.push({ type: 'explosion', x: crate.x, y: crate.y, frame: 0, maxFrames: 17, size: 20, sprite: 'atomsfx', spriteStart: 0 });
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
          const inf = new Entity(t, House.Spain, crate.x + ox, crate.y + oy);
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
          if (s.alive && (s.house === House.Spain || s.house === House.Greece)) {
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
            this.effects.push({ type: 'explosion', x: fx, y: fy, frame: 0, maxFrames: 15, size: 12, sprite: 'napalm1', spriteStart: 0 });
            // Damage units in each cell
            for (const e of this.entities) {
              if (!e.alive) continue;
              const d = worldDist(e.pos, { x: fx, y: fy });
              if (d <= 1) e.takeDamage(80, 'Fire');
            }
          }
        }
        this.evaMessages.push({ text: 'NAPALM STRIKE', tick: this.tick });
        break;
      }
      case 'cloak':
        // 30 seconds invisibility (450 ticks)
        unit.cloakTick = 450;
        this.evaMessages.push({ text: 'UNIT CLOAKED', tick: this.tick });
        break;
      case 'invulnerability':
        // 20 seconds invincibility (300 ticks)
        unit.invulnTick = 300;
        this.evaMessages.push({ text: 'INVULNERABILITY', tick: this.tick });
        break;
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
            (s.house === House.Spain || s.house === House.Greece)) ? 0.25 : 1;
          state.chargeTick = Math.min(state.chargeTick + chargeRate, def.rechargeTicks);
          if (state.chargeTick >= def.rechargeTicks) {
            state.ready = true;
            // EVA announcement for player
            if (s.house === House.Spain || s.house === House.Greece) {
              this.pushEva(`${def.name} ready`);
            }
          }
        }

        // Auto-fire GPS Satellite (one-shot)
        if (def.type === SuperweaponType.GPS_SATELLITE && state.ready && !state.fired) {
          this.map.revealAll();
          state.fired = true;
          state.ready = false;
          if (s.house === House.Spain || s.house === House.Greece) {
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
          if (s.house === House.Spain || s.house === House.Greece) {
            this.pushEva('Sonar pulse activated');
          }
        }
      }
    }

    // Remove entries for destroyed buildings
    for (const [key] of this.superweapons) {
      if (!activeBuildings.has(key)) {
        this.superweapons.delete(key);
      }
    }

    // AI superweapon usage
    for (const [, state] of this.superweapons) {
      if (!state.ready) continue;
      if (state.house === House.Spain || state.house === House.Greece) continue;
      const def = SUPERWEAPON_DEFS[state.type];
      if (!def.needsTarget) continue; // GPS/Sonar auto-fire handled above

      if (state.type === SuperweaponType.NUKE) {
        // AI nuke: target player's highest-value structure cluster
        const target = this.findBestNukeTarget(state.house);
        if (target) {
          this.activateSuperweapon(SuperweaponType.NUKE, state.house, target);
        }
      } else if (state.type === SuperweaponType.IRON_CURTAIN) {
        // AI Iron Curtain: apply to own unit with most HP
        const bestUnit = this.entities
          .filter(e => e.alive && e.house === state.house && !e.stats.isInfantry)
          .sort((a, b) => b.hp - a.hp)[0];
        if (bestUnit) {
          this.activateSuperweapon(SuperweaponType.IRON_CURTAIN, state.house, bestUnit.pos);
        }
      }
      // AI does not use Chronosphere (too complex for basic AI)
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
        // Teleport first selected player unit to target
        const selected = this.entities.filter(e =>
          e.alive && e.selected && e.house === house && !e.stats.isInfantry
        );
        const unit = selected[0];
        if (unit) {
          const origin = { x: unit.pos.x, y: unit.pos.y };
          unit.pos.x = target.x;
          unit.pos.y = target.y;
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
          if (house === House.Spain || house === House.Greece) {
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
          if (d < bestDist && d < CELL_SIZE * 3) {
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
          if (house === House.Spain || house === House.Greece) {
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
          if (house === House.Spain || house === House.Greece) {
            this.pushEva('Nuclear warhead launched');
          } else {
            // Warn player when enemy launches nuke
            this.pushEva('Warning: nuclear launch detected');
          }
        }
        break;
      }
    }
  }

  /** Detonate nuclear warhead at target position */
  private detonateNuke(target: WorldPos): void {
    // Screen flash
    this.renderer.screenFlash = 15;
    this.renderer.screenShake = 20;

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
      const killed = e.takeDamage(dmg, 'Super');
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
        this.effects.push({
          type: 'explosion', x: sx, y: sy,
          frame: 0, maxFrames: 20, size: 32,
          sprite: 'fball1', spriteStart: 0,
        });
      }
    }

    // Mushroom cloud effect (large, long-lasting)
    this.effects.push({
      type: 'explosion', x: target.x, y: target.y,
      frame: 0, maxFrames: 45, size: 48,
      sprite: 'atomsfx', spriteStart: 0,
    });

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
        if (dist < CELL_SIZE * 5) score++;
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
    this.renderer.sidebarCredits = this.displayCredits;
    this.renderer.sidebarSiloCapacity = this.siloCapacity;
    this.renderer.sidebarPowerProduced = this.powerProduced;
    this.renderer.sidebarPowerConsumed = this.powerConsumed;
    this.renderer.sidebarItems = this.cachedAvailableItems ?? this.getAvailableItems();
    this.renderer.sidebarQueue = this.productionQueue;
    this.renderer.sidebarScroll = this.tabScrollPositions[this.activeTab];
    this.renderer.sidebarW = Game.SIDEBAR_W;
    this.renderer.activeTab = this.activeTab;
    this.renderer.tabScrollPositions = this.tabScrollPositions;
    this.renderer.radarEnabled = this.radarEnabled;
    // Radar requires DOME and sufficient power
    const lowPwr = this.powerConsumed > this.powerProduced && this.powerProduced > 0;
    this.renderer.hasRadar = this.hasBuilding('DOME') && !lowPwr;
    this.renderer.crates = this.crates;
    // Selected structure info for info panel + highlight
    this.renderer.selectedStructureIdx = this.selectedStructureIdx;
    if (this.selectedStructureIdx >= 0 && this.selectedIds.size === 0) {
      const ss = this.structures[this.selectedStructureIdx];
      if (ss?.alive) {
        const prodItem = PRODUCTION_ITEMS.find(p => p.type === ss.type);
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
        if (!s.alive || (s.house !== House.Spain && s.house !== House.Greece)) continue;
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
      const structsBuilt = this.structures.filter(s => s.house === House.Spain || s.house === House.Greece).length;
      const structsLost = this.structures.filter(s => !s.alive && (s.house === House.Spain || s.house === House.Greece)).length;
      // Build survivors roster for victory screen
      const survivors = this.state === 'won'
        ? this.entities.filter(e => e.alive && e.isPlayerUnit).map(e => ({
            type: e.type, name: e.stats.name, hp: e.hp, maxHp: e.maxHp, vet: e.veterancy,
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

  /** Calculate formation positions for a group move order.
   *  Returns array of offset positions centered on the target. */
  private calculateFormation(centerX: number, centerY: number, count: number): WorldPos[] {
    if (count <= 1) return [{ x: centerX, y: centerY }];
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const positions: WorldPos[] = [];
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      // Center the grid on the target point
      const offsetX = (col - (cols - 1) / 2) * CELL_SIZE;
      const offsetY = (row - (rows - 1) / 2) * CELL_SIZE;
      // Add slight jitter to avoid robotic alignment
      const jitterX = (Math.random() - 0.5) * CELL_SIZE * 0.5;
      const jitterY = (Math.random() - 0.5) * CELL_SIZE * 0.5;
      positions.push({
        x: centerX + offsetX + jitterX,
        y: centerY + offsetY + jitterY,
      });
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
      // Power consumption by structure type (RA defaults)
      switch (s.type) {
        case 'TENT': case 'BARR': power += 20; break;
        case 'WEAP': power += 30; break;
        case 'PROC': power += 30; break;
        case 'DOME': power += 40; break;
        case 'GUN': power += 20; break;
        case 'HBOX': power += 10; break;
        case 'TSLA': power += 150; break;
        case 'SAM': power += 20; break;
        case 'AGUN': power += 20; break;
        case 'ATEK': case 'STEK': power += 50; break;
        case 'HPAD': power += 10; break;
        case 'AFLD': power += 20; break;
        case 'GAP': power += 60; break;
        case 'FIX': power += 30; break;
        case 'IRON': case 'PDOX': case 'MSLO': power += 100; break;
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

          // Check adjacency to existing house structure (dist ≤ 4 cells)
          let adjacent = false;
          for (const s of this.structures) {
            if (!s.alive || s.house !== house) continue;
            const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
            const scx = s.cx + sw / 2;
            const scy = s.cy + sh / 2;
            const pcx = cx + fw / 2;
            const pcy = cy + fh / 2;
            if (Math.abs(pcx - scx) <= 4 && Math.abs(pcy - scy) <= 4) {
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
      // Need a ConYard
      if (this.aiCountStructure(house, 'FACT') === 0) continue;

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
      const prodItem = PRODUCTION_ITEMS.find(p => p.type === buildType && p.isStructure);
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

    const items = PRODUCTION_ITEMS.filter(p =>
      (p.prerequisite === prereq || (category === 'infantry' && p.prerequisite === 'BARR')) &&
      !p.isStructure &&
      (p.faction === 'both' || p.faction === faction) &&
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

      // If 0 harvesters and has refinery + war factory → force-produce
      if (state.harvesterCount === 0 && state.refineryCount > 0 &&
          this.aiCountStructure(house, 'WEAP') > 0) {
        const credits = this.houseCredits.get(house) ?? 0;
        const harvItem = PRODUCTION_ITEMS.find(p => p.type === 'HARV');
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
        if (dist < CELL_SIZE * 8) {
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
        if (dist < CELL_SIZE * 10) {
          // Find nearest enemy near base
          let nearestEnemy: Entity | null = null;
          let nearestDist = Infinity;
          for (const enemy of this.entities) {
            if (!enemy.alive || this.isAllied(enemy.house, house)) continue;
            const eDist = worldDist(enemy.pos, centerPos);
            if (eDist < CELL_SIZE * 12 && eDist < nearestDist) {
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
      if (e.type === UnitType.V_HARV) continue; // harvesters don't retreat
      if (e.isAnt) continue; // ants never retreat

      const state = this.aiStates.get(e.house);
      if (!state) continue;

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
      const hasTent = this.aiHasPrereq(house, 'TENT');
      const hasWeap = this.structures.some(s => s.alive && s.house === house && s.type === 'WEAP');

      // Strategic AI: Harvester priority — if harvesterCount < refineryCount
      if (state && hasWeap && state.harvesterCount < state.refineryCount) {
        const harvItem = PRODUCTION_ITEMS.find(p => p.type === 'HARV');
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

      if (hasTent && credits >= 100) {
        const pick = state
          ? this.getAIProductionPick(house, 'infantry')
          : (() => {
              const houseFaction = HOUSE_FACTION[house] ?? 'both';
              const infItems = PRODUCTION_ITEMS.filter(p =>
                (p.prerequisite === 'TENT' || p.prerequisite === 'BARR') &&
                !p.isStructure &&
                (p.faction === 'both' || p.faction === houseFaction)
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

      const currentCredits = this.houseCredits.get(house) ?? 0;
      if (hasWeap && currentCredits >= 600) {
        const pick = state
          ? this.getAIProductionPick(house, 'vehicle')
          : (() => {
              const houseFaction = HOUSE_FACTION[house] ?? 'both';
              const vehItems = PRODUCTION_ITEMS.filter(p =>
                p.prerequisite === 'WEAP' &&
                !p.isStructure &&
                (p.faction === 'both' || p.faction === houseFaction)
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

    switch (structure.type) {
      case 'PROC':
        // Steal 50% of house credits
        const stolen = Math.floor((this.houseCredits?.get(targetHouse) ?? 0) * 0.5);
        if (this.houseCredits) this.houseCredits.set(targetHouse, (this.houseCredits.get(targetHouse) ?? 0) - stolen);
        this.addCredits(stolen, true);
        this.evaMessages.push({ text: `CREDITS STOLEN: ${stolen}`, tick: this.tick });
        break;
      case 'DOME':
        // Reveal map for 60 seconds (900 ticks) — set fog disabled temporarily
        this.fogDisabled = true;
        this.fogReEnableTick = 900;
        this.evaMessages.push({ text: 'RADAR INFILTRATED', tick: this.tick });
        break;
      case 'POWR':
      case 'APWR':
        // Disable power for 45 seconds — sabotage the targeted building
        structure.hp = Math.max(1, Math.floor(structure.hp * 0.25));
        this.evaMessages.push({ text: 'POWER SABOTAGED', tick: this.tick });
        break;
      default:
        this.evaMessages.push({ text: 'BUILDING INFILTRATED', tick: this.tick });
        break;
    }

    // Spy is consumed on infiltration
    spy.alive = false;
    spy.mission = Mission.DIE;
    spy.disguisedAs = null;
    this.audio.play('eva_acknowledged');
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
}
