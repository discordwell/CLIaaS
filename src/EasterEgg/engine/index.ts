/**
 * Main game loop — ties all engine systems together.
 * Fixed timestep at 15 FPS (matching original Red Alert game speed).
 */

import {
  type WorldPos, CELL_SIZE, MAP_CELLS, GAME_TICKS_PER_SEC,
  Mission, AnimState, House, UnitType, Stance, worldDist, directionTo, worldToCell,
  WARHEAD_VS_ARMOR, type WarheadType,
  PRODUCTION_ITEMS, type ProductionItem,
} from './types';
import { AssetManager } from './assets';
import { AudioManager, type SoundName } from './audio';
import { Camera } from './camera';
import { InputManager } from './input';
import { Entity, resetEntityIds } from './entity';
import { GameMap, Terrain } from './map';
import { Renderer, type Effect } from './renderer';
import { findPath } from './pathfinding';
import {
  loadScenario,
  type TeamType, type ScenarioTrigger, type MapStructure,
  checkTriggerEvent, executeTriggerAction, STRUCTURE_WEAPONS, STRUCTURE_SIZE, STRUCTURE_MAX_HP,
  saveCarryover,
} from './scenario';
export { MISSIONS, getMission, getMissionIndex, loadProgress, saveProgress } from './scenario';
export type { MissionInfo } from './scenario';
export { AudioManager } from './audio';

export type GameState = 'loading' | 'playing' | 'won' | 'lost' | 'paused';

/** Defensive structure types that ants prioritize attacking */
const ANT_TARGET_DEFENSE_TYPES = new Set(['HBOX', 'PBOX', 'GUN', 'TSLA', 'SAM', 'AGUN', 'FTUR']);

/** Crate bonus types */
type CrateType = 'money' | 'heal' | 'veterancy' | 'unit';
interface Crate {
  x: number;
  y: number;
  type: CrateType;
  tick: number; // tick when spawned
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
  controlGroups: Map<number, Set<number>> = new Map(); // 1-9 → entity IDs
  attackMoveMode = false;
  sellMode = false;
  repairMode = false;
  /** Set of structure indices currently being repaired */
  private repairingStructures = new Set<number>();
  /** Tick when last EVA base attack warning played (throttle to once per 5s) */
  private lastBaseAttackEva = 0;
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
  // Economy
  credits = 0;
  displayCredits = 0; // animated counter shown in sidebar (ticks toward credits)
  /** Production queue: active build + queued repeats per category (max 5 total) */
  productionQueue: Map<string, { item: ProductionItem; progress: number; queueCount: number }> = new Map();
  /** Structure placement: waiting to be placed on map */
  pendingPlacement: ProductionItem | null = null;
  placementValid = false;
  placementCx = 0;
  placementCy = 0;
  // Power system
  powerProduced = 0;
  powerConsumed = 0;
  // Sidebar dimensions
  static readonly SIDEBAR_W = 100;
  sidebarScroll = 0; // scroll offset for sidebar items
  private cachedAvailableItems: ProductionItem[] | null = null;
  /** Rally points: produced units auto-move here (per factory type) */
  private rallyPoints = new Map<string, WorldPos>(); // factory type → world position

  // Crate system
  crates: Crate[] = [];
  private nextCrateTick = 0;

  // Stats tracking
  killCount = 0;
  lossCount = 0;
  effects: Effect[] = [];
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

  // Turbo mode (for E2E test runner)
  turboMultiplier = 1;

  // Callbacks
  onStateChange?: (state: GameState) => void;
  onLoadProgress?: (loaded: number, total: number) => void;
  onTick?: (game: Game) => void;

  // Internal
  private canvas: HTMLCanvasElement;
  private stopped = false;
  private timerId = 0;
  private lastTime = 0;
  private accumulator = 0;
  private readonly tickInterval = 1000 / GAME_TICKS_PER_SEC;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.assets = new AssetManager();
    this.audio = new AudioManager();
    // Game viewport is narrower than canvas to leave room for sidebar
    this.camera = new Camera(canvas.width - Game.SIDEBAR_W, canvas.height);
    this.input = new InputManager(canvas);
    this.map = new GameMap();
    this.renderer = new Renderer(canvas);
  }

  /** Load assets and start a scenario */
  async start(scenarioId = 'SCA01EA'): Promise<void> {
    this.state = 'loading';
    this.stopped = false;
    this.scenarioId = scenarioId;
    this.onStateChange?.('loading');
    resetEntityIds();

    // Initialize audio (needs user gesture context — start() is called from click)
    this.audio.init();
    this.audio.resume();

    // Load sprite sheets
    await this.assets.loadAll((loaded, total) => {
      this.onLoadProgress?.(loaded, total);
    });

    // Load scenario
    const { map, entities, structures, name, briefing, waypoints, teamTypes, triggers, cellTriggers, credits, toCarryOver } = await loadScenario(scenarioId);
    this.map = map;
    this.entities = entities;
    this.structures = structures;
    this.entityById.clear();
    for (const e of entities) this.entityById.set(e.id, e);
    this.missionName = name;
    this.missionBriefing = briefing;
    this.waypoints = waypoints;
    this.teamTypes = teamTypes;
    this.triggers = triggers;
    this.credits = credits;
    this.toCarryOver = toCarryOver;
    this.productionQueue.clear();
    this.pendingPlacement = null;
    this.globals.clear();
    // Set global 1 immediately — simulates the player discovering the ant area.
    // In the original, this is set by cell-entry triggers when the player explores,
    // but for gameplay pacing we enable it at start so ant waves begin spawning.
    this.globals.add(1);
    // First crate spawns after 60 seconds
    this.nextCrateTick = GAME_TICKS_PER_SEC * 60;
    this.crates = [];

    // Initial fog of war reveal
    this.updateFogOfWar();

    // Center camera on player start
    const playerUnits = entities.filter(e => e.isPlayerUnit);
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
  }

  /** Toggle pause/unpause */
  togglePause(): void {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.onStateChange?.('paused');
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.onStateChange?.('playing');
      this.lastTime = performance.now();
      this.scheduleNext();
    }
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
    this.accumulator += Math.min(dt, 200 * this.turboMultiplier);

    // Fixed timestep updates
    while (this.accumulator >= this.tickInterval) {
      this.accumulator -= this.tickInterval;
      this.update();
      if (this.state !== 'playing') break;
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
        this.map.setOccupancy(entity.cell.cx, entity.cell.cy, entity.id);
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
      if (!entity.alive) {
        entity.tickAnimation();
        continue;
      }
      this.updateEntity(entity);
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

    // Repair structures being repaired (1 HP per tick ≈ 15 HP/sec)
    for (const idx of this.repairingStructures) {
      const s = this.structures[idx];
      if (!s || !s.alive || s.hp >= s.maxHp) {
        this.repairingStructures.delete(idx);
        continue;
      }
      s.hp = Math.min(s.maxHp, s.hp + 1);
    }

    // Queen Ant self-healing (SelfHealing=yes in INI): +1 HP every 2 ticks
    if (this.tick % 2 === 0) {
      for (const s of this.structures) {
        if (s.alive && s.type === 'QUEE' && s.hp < s.maxHp) {
          s.hp = Math.min(s.maxHp, s.hp + 1);
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

    // Tick production queue — advance build progress
    this.tickProduction();

    // Clean up dead entities after death animation (use deathTick instead of animFrame)
    const before = this.entities.length;
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
      if (!s.alive || (s.house !== House.Spain && s.house !== House.Greece)) continue;
      if (s.type === 'POWR') this.powerProduced += 100;
      else if (s.type === 'APWR') this.powerProduced += 200;
      else if (s.type === 'PROC') this.powerConsumed += 30;
      else if (s.type === 'WEAP') this.powerConsumed += 30;
      else if (s.type === 'TENT') this.powerConsumed += 20;
      else if (s.type === 'DOME') this.powerConsumed += 40;
      else if (s.type === 'TSLA') this.powerConsumed += 100;
      else if (s.type === 'HBOX' || s.type === 'PBOX' || s.type === 'GUN') this.powerConsumed += 10;
      else if (s.type === 'FIX') this.powerConsumed += 30;
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

  /** Update fog of war based on player unit positions */
  private updateFogOfWar(): void {
    const units = this.entities
      .filter(e => e.alive && e.isPlayerUnit)
      .map(e => ({ x: e.pos.x, y: e.pos.y, sight: e.stats.sight }));
    this.map.updateFogOfWar(units);
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

  /** Update cursor based on mouse position and selection state */
  private updateCursor(): void {
    if (this.sellMode) {
      this.canvas.style.cursor = 'not-allowed'; // sell cursor (changes over buildings)
      const { mouseX, mouseY } = this.input.state;
      const world = this.camera.screenToWorld(mouseX, mouseY);
      const s = this.findStructureAt(world);
      if (s && (s.house === 'Spain' || s.house === 'Greece')) {
        this.canvas.style.cursor = 'pointer';
      }
      return;
    }
    if (this.repairMode) {
      this.canvas.style.cursor = 'not-allowed';
      const { mouseX, mouseY } = this.input.state;
      const world = this.camera.screenToWorld(mouseX, mouseY);
      const s = this.findStructureAt(world);
      if (s && s.alive && (s.house === 'Spain' || s.house === 'Greece') && s.hp < s.maxHp) {
        this.canvas.style.cursor = 'pointer';
      }
      return;
    }
    if (this.selectedIds.size === 0) {
      this.canvas.style.cursor = 'default';
      return;
    }
    if (this.attackMoveMode) {
      this.canvas.style.cursor = 'crosshair';
      return;
    }
    const { mouseX, mouseY } = this.input.state;
    const world = this.camera.screenToWorld(mouseX, mouseY);
    const hovered = this.findEntityAt(world);
    if (hovered && !hovered.isPlayerUnit && hovered.alive) {
      this.canvas.style.cursor = 'crosshair'; // attack cursor
    } else {
      // Check if terrain is passable
      const cell = worldToCell(world.x, world.y);
      const passable = this.map.isPassable(cell.cx, cell.cy);
      this.canvas.style.cursor = passable ? 'pointer' : 'not-allowed';
    }
  }

  /** Process player input — selection and commands */
  private processInput(): void {
    const { leftClick, rightClick, doubleClick, dragBox, ctrlHeld, shiftHeld, keys, scrollDelta } = this.input.state;

    // Sidebar scroll (mouse wheel when cursor is over sidebar)
    if (scrollDelta !== 0 && this.input.state.mouseX >= this.canvas.width - Game.SIDEBAR_W) {
      const items = this.cachedAvailableItems ?? this.getAvailableItems();
      const maxScroll = Math.max(0, items.length * 22 - (this.canvas.height - 80));
      this.sidebarScroll = Math.max(0, Math.min(maxScroll, this.sidebarScroll + Math.sign(scrollDelta) * 22));
    }

    // --- Escape: cancel placement/modes first, then pause ---
    if (keys.has('Escape')) {
      if (this.pendingPlacement) {
        this.credits += this.pendingPlacement.cost;
        this.pendingPlacement = null;
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
            if (this.selectedIds.size > 0) this.audio.play(this.selectionSound());
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
        this.audio.play(this.selectionSound());
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
        this.audio.play(this.selectionSound());
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
        unit.path = findPath(this.map, unit.cell, worldToCell(goalX, goalY), true);
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
        this.audio.play(this.selectionSound());
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

      // Sell mode: click on player structure to sell it
      if (this.sellMode) {
        const world = this.camera.screenToWorld(leftClick.x, leftClick.y);
        const s = this.findStructureAt(world);
        if (s && s.alive && (s.house === 'Spain' || s.house === 'Greece')) {
          s.alive = false;
          // Refund 50% of building cost
          const prodItem = PRODUCTION_ITEMS.find(p => p.type === s.type);
          if (prodItem) this.credits += Math.floor(prodItem.cost * 0.5);
          // Clear terrain footprint to passable
          this.clearStructureFootprint(s);
          // Sell effect: explosion + sell sound
          const wx = s.cx * CELL_SIZE + CELL_SIZE;
          const wy = s.cy * CELL_SIZE + CELL_SIZE;
          this.effects.push({ type: 'explosion', x: wx, y: wy, frame: 0, maxFrames: 17, size: 12,
            sprite: 'veh-hit1', spriteStart: 0 });
          this.audio.play('building_explode');
          // Spawn a rifleman at the building site (representing recovered crew)
          const inf = new Entity(UnitType.I_E1, House.Spain, wx, wy);
          inf.mission = Mission.GUARD;
          this.entities.push(inf);
          this.entityById.set(inf.id, inf);
        }
        this.sellMode = false;
        return;
      }

      // Repair mode: click on damaged player structure to toggle repair
      if (this.repairMode) {
        const world = this.camera.screenToWorld(leftClick.x, leftClick.y);
        const s = this.findStructureAt(world);
        if (s && s.alive && (s.house === 'Spain' || s.house === 'Greece') && s.hp < s.maxHp) {
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
        let spreadIdx = 0;
        for (const unit of units) {
          const spread = units.length > 1 ? this.spreadOffset(spreadIdx, units.length) : { x: 0, y: 0 };
          spreadIdx++;
          unit.mission = Mission.HUNT;
          unit.moveTarget = { x: world.x + spread.x, y: world.y + spread.y };
          unit.target = null;
          unit.path = findPath(this.map, unit.cell, worldToCell(world.x + spread.x, world.y + spread.y), true);
          unit.pathIndex = 0;
        }
        if (units.length > 0) {
          this.audio.play('attack_ack');
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
        this.audio.play(this.selectionSound());
      } else {
        if (!ctrlHeld) {
          for (const e of this.entities) e.selected = false;
          this.selectedIds.clear();
        }
      }
    }

    if (dragBox) {
      this.tabCyclePool = [];
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
      // Cancel placement mode
      if (this.pendingPlacement) {
        // Refund the cost
        this.credits += this.pendingPlacement.cost;
        this.pendingPlacement = null;
        return;
      }

      // Cancel production from sidebar via right-click
      if (rightClick.x >= this.canvas.width - Game.SIDEBAR_W) {
        const items = this.getAvailableItems();
        const itemStartY = 24;
        const itemH = 22;
        const relY = rightClick.y - itemStartY + this.sidebarScroll;
        const itemIdx = Math.floor(relY / itemH);
        if (itemIdx >= 0 && itemIdx < items.length) {
          const item = items[itemIdx];
          const category = item.isStructure ? 'structure' : item.prerequisite === 'TENT' ? 'infantry' : 'vehicle';
          this.cancelProduction(category);
        }
        return;
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
        this.audio.play('attack_ack');
        this.effects.push({
          type: 'marker', x: world.x, y: world.y, frame: 0, maxFrames: 15, size: 10,
          markerColor: 'rgba(255,200,60,1)',
        });
        return;
      }

      const target = this.findEntityAt(world);
      const targetStruct = !target ? this.findStructureAt(world) : null;

      let commandIssued = false;
      // Spread group move targets so units don't all converge to one cell
      const units: Entity[] = [];
      for (const id of this.selectedIds) {
        const unit = this.entityById.get(id);
        if (unit && unit.alive) units.push(unit);
      }
      let spreadIdx = 0;
      for (const unit of units) {
        commandIssued = true;

        if (target && !target.isPlayerUnit && target.alive) {
          unit.mission = Mission.ATTACK;
          unit.target = target;
          unit.targetStructure = null;
          unit.moveTarget = null;
        } else if (targetStruct && targetStruct.alive) {
          // Attack structure
          unit.mission = Mission.ATTACK;
          unit.target = null;
          unit.targetStructure = targetStruct;
          unit.moveTarget = null;
        } else {
          // Spread units in a grid around the target point
          const spread = units.length > 1 ? this.spreadOffset(spreadIdx, units.length) : { x: 0, y: 0 };
          spreadIdx++;
          const goalX = world.x + spread.x;
          const goalY = world.y + spread.y;

          if (shiftHeld && unit.mission === Mission.MOVE) {
            // Shift+click: queue waypoint (don't change current path)
            unit.moveQueue.push({ x: goalX, y: goalY });
          } else {
            unit.mission = Mission.MOVE;
            unit.moveTarget = { x: goalX, y: goalY };
            unit.moveQueue = [];
            unit.target = null;
            unit.targetStructure = null;
            unit.forceFirePos = null;
            // Clear team mission scripts when player gives direct orders
            unit.teamMissions = [];
            unit.teamMissionIndex = 0;
            unit.path = findPath(
              this.map,
              unit.cell,
              worldToCell(goalX, goalY),
              true
            );
            unit.pathIndex = 0;
          }
        }
      }
      if (commandIssued) {
        const isAttack = (target && !target.isPlayerUnit) || targetStruct;
        this.audio.play(this.ackSound(!!isAttack));
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
        this.audio.play('move_ack');
      }
    }
  }

  /** Handle clicks on the sidebar production panel */
  private handleSidebarClick(sx: number, sy: number): void {
    const sidebarX = this.canvas.width - Game.SIDEBAR_W;
    const items = this.getAvailableItems();
    // Credits display takes top 24px, then items start
    const itemStartY = 24;
    const itemH = 22;
    const relY = sy - itemStartY + this.sidebarScroll;
    const itemIdx = Math.floor(relY / itemH);
    if (itemIdx < 0 || itemIdx >= items.length) return;
    const item = items[itemIdx];
    // startProduction handles both new builds and queueing
    this.startProduction(item);
  }

  /** Map weapon name to projectile visual style */
  private weaponProjectileStyle(name: string): 'bullet' | 'fireball' | 'shell' | 'rocket' {
    switch (name) {
      case 'FireballLauncher': case 'Flamethrower': return 'fireball';
      case 'TankGun': case 'ArtilleryShell': return 'shell';
      case 'Bazooka': case 'MammothTusk': return 'rocket';
      default: return 'bullet';
    }
  }

  /** Calculate spread offset for group move — arranges units in a grid */
  private spreadOffset(idx: number, total: number): { x: number; y: number } {
    if (total <= 1) return { x: 0, y: 0 };
    const cols = Math.ceil(Math.sqrt(total));
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    const spacing = CELL_SIZE;
    const offsetX = (col - (cols - 1) / 2) * spacing;
    const offsetY = (row - (Math.ceil(total / cols) - 1) / 2) * spacing;
    return { x: offsetX, y: offsetY };
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
      }
    }
  }

  /** Damage a structure, return true if destroyed */
  private damageStructure(s: MapStructure, damage: number): boolean {
    if (!s.alive) return false;
    s.hp = Math.max(0, s.hp - damage);
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
      // Spawn destruction explosion
      const wx = s.cx * CELL_SIZE + CELL_SIZE;
      const wy = s.cy * CELL_SIZE + CELL_SIZE;
      this.effects.push({
        type: 'explosion', x: wx, y: wy,
        frame: 0, maxFrames: 22, size: 20,
        sprite: 'fball1', spriteStart: 0,
      });
      this.renderer.screenShake = Math.max(this.renderer.screenShake, 12);
      this.audio.play('building_explode');
      // Leave large scorch mark
      this.map.addDecal(s.cx, s.cy, 14, 0.6);
      return true;
    }
    return false;
  }

  /** Update a single entity's AI and movement */
  private updateEntity(entity: Entity): void {
    // Team mission script execution (rate-limited to every 8 ticks)
    // Area Guard ants use their own patrol logic, not global hunt AI
    if (entity.isAnt && entity.mission !== Mission.DIE && entity.mission !== Mission.AREA_GUARD) {
      if (this.tick - entity.lastAIScan >= 8) {
        entity.lastAIScan = this.tick;
        if (entity.teamMissions.length > 0) {
          this.updateTeamMission(entity);
        } else {
          this.updateAntAI(entity);
        }
      }
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
    }

    // Harvester AI — automatic ore gathering
    if (entity.alive && entity.type === UnitType.V_HARV && entity.isPlayerUnit &&
        entity.mission === Mission.GUARD && !entity.target) {
      this.updateHarvester(entity);
    }

    // Vehicle crush: heavy vehicles kill infantry they drive over
    if (entity.alive && !entity.stats.isInfantry && !entity.isAnt &&
        entity.stats.speed > 0 && entity.animState === AnimState.WALK) {
      this.checkVehicleCrush(entity);
    }

    entity.tickAnimation();
  }

  // Team mission type constants (from RA TEAMTYPE.CPP)
  private static readonly TMISSION_ATTACK = 0;
  private static readonly TMISSION_ATT_WAYPT = 1;
  private static readonly TMISSION_MOVE = 3;
  private static readonly TMISSION_GUARD = 5;
  private static readonly TMISSION_LOOP = 6;
  private static readonly TMISSION_SET_GLOBAL = 11;
  private static readonly TMISSION_UNLOAD = 16;

  /** Execute team mission scripts — units follow waypoint patrol routes */
  private updateTeamMission(entity: Entity): void {
    if (entity.teamMissionIndex >= entity.teamMissions.length) {
      // Script complete — fall back to hunt AI
      this.updateAntAI(entity);
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
          entity.path = findPath(this.map, entity.cell, { cx: wp.cx, cy: wp.cy }, true);
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
            entity.path = findPath(this.map, entity.cell, { cx: wp.cx, cy: wp.cy }, true);
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
        // This runs every 8 ticks (AI scan rate), so decrement by 8
        if (entity.teamMissionWaiting === 0) {
          entity.teamMissionWaiting = tm.data * 6 * GAME_TICKS_PER_SEC;
          entity.mission = Mission.GUARD;
        }
        entity.teamMissionWaiting -= 8;
        // While guarding, still auto-attack nearby enemies
        if (entity.teamMissionWaiting <= 0) {
          entity.teamMissionWaiting = 0;
          entity.teamMissionIndex++;
        }
        break;
      }

      case Game.TMISSION_LOOP: {
        // Loop back to first mission
        entity.teamMissionIndex = 0;
        entity.teamMissionWaiting = 0;
        break;
      }

      case Game.TMISSION_SET_GLOBAL: {
        // Set a global variable
        this.globals.add(tm.data);
        entity.teamMissionIndex++;
        break;
      }

      case Game.TMISSION_UNLOAD: {
        // Unload — not relevant for ant units, skip
        entity.teamMissionIndex++;
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

  /** Vehicle crush — heavy vehicles instantly kill infantry they drive over */
  private checkVehicleCrush(vehicle: Entity): void {
    const vc = vehicle.cell;
    for (const other of this.entities) {
      if (!other.alive || other.id === vehicle.id) continue;
      if (!other.stats.isInfantry) continue;
      if (other.isPlayerUnit === vehicle.isPlayerUnit) continue; // no friendly crush
      const oc = other.cell;
      if (oc.cx === vc.cx && oc.cy === vc.cy) {
        other.takeDamage(other.hp + 10); // instant kill
        vehicle.creditKill();
        this.effects.push({
          type: 'blood', x: other.pos.x, y: other.pos.y,
          frame: 0, maxFrames: 6, size: 4, sprite: 'piffpiff', spriteStart: 0,
        });
        this.audio.play('die_infantry');
        if (vehicle.isPlayerUnit) this.killCount++;
        else {
          this.lossCount++;
          this.audio.play('eva_unit_lost');
          const oc = other.cell;
          this.minimapAlert(oc.cx, oc.cy);
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
            const newOre = this.map.findNearestOre(ec.cx, ec.cy, 5);
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
        // When move completes (mission returns to GUARD), transition to unloading or re-seek
        if (entity.mission !== Mission.GUARD) break; // still moving, wait
        // Check if we're near a refinery
        const ec = entity.cell;
        let bestProc: MapStructure | null = null;
        let bestDist = Infinity;
        for (const s of this.structures) {
          if (!s.alive || s.type !== 'PROC') continue;
          if (s.house !== House.Spain && s.house !== House.Greece) continue;
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
        // Check if we're adjacent to the refinery (within 2 cells)
        const procDist = Math.abs(bestProc.cx + 1 - ec.cx) + Math.abs(bestProc.cy + 1 - ec.cy);
        if (procDist <= 2) {
          // Arrived at refinery — start unloading
          entity.harvesterState = 'unloading';
          entity.harvestTick = 0;
        } else {
          // Not there yet — issue move to refinery
          const target = { cx: bestProc.cx + 1, cy: bestProc.cy + 1 };
          entity.mission = Mission.MOVE;
          entity.moveTarget = { x: target.cx * CELL_SIZE + CELL_SIZE / 2, y: target.cy * CELL_SIZE + CELL_SIZE / 2 };
          entity.path = findPath(this.map, ec, target, true);
          entity.pathIndex = 0;
        }
        break;
      }
      case 'unloading': {
        entity.harvestTick++;
        // Unload over 30 ticks (~2 seconds)
        if (entity.harvestTick >= 30) {
          this.credits += entity.oreLoad;
          this.audio.play('heal'); // credit received sound
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
          entity.moveToward({ x: waveCX, y: waveCY }, entity.stats.speed * 0.3);
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
      if (s.house !== 'Spain' && s.house !== 'Greece') continue;
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

    if (entity.path.length > 0 && entity.pathIndex < entity.path.length) {
      const nextCell = entity.path[entity.pathIndex];
      // Check if next cell is blocked by another unit — recalculate path (with cooldown)
      const occ = this.map.getOccupancy(nextCell.cx, nextCell.cy);
      if (occ > 0 && occ !== entity.id && entity.moveTarget &&
          this.tick - entity.lastPathRecalc > 5) {
        entity.lastPathRecalc = this.tick;
        entity.path = findPath(
          this.map, entity.cell,
          worldToCell(entity.moveTarget.x, entity.moveTarget.y), true
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
      if (entity.moveToward(target, entity.stats.speed * 0.5)) {
        entity.pathIndex++;
      }
    } else if (entity.moveTarget) {
      if (entity.moveToward(entity.moveTarget, entity.stats.speed * 0.5)) {
        entity.moveTarget = null;
        // Check for queued waypoints
        if (entity.moveQueue.length > 0) {
          const next = entity.moveQueue.shift()!;
          entity.moveTarget = next;
          entity.path = findPath(this.map, entity.cell, worldToCell(next.x, next.y), true);
          entity.pathIndex = 0;
        } else {
          entity.mission = this.idleMission(entity);
          entity.animState = AnimState.IDLE;
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
      entity.mission = this.idleMission(entity);
      entity.animState = AnimState.IDLE;
      return;
    }

    if (entity.inRange(entity.target)) {
      // Check line of sight — can't fire through walls/rocks
      const ec = entity.cell;
      const tc = entity.target.cell;
      if (!this.map.hasLineOfSight(ec.cx, ec.cy, tc.cx, tc.cy)) {
        // LOS blocked — move toward target to get clear shot
        entity.animState = AnimState.WALK;
        entity.moveToward(entity.target.pos, entity.stats.speed * 0.5);
        if (entity.attackCooldown > 0) entity.attackCooldown--;
        return;
      }

      // Turreted vehicles: turret tracks target, body may stay still
      if (entity.hasTurret) {
        entity.desiredTurretFacing = directionTo(entity.pos, entity.target.pos);
        if (!entity.tickTurretRotation()) entity.tickTurretRotation(); // 2 steps/tick
      } else {
        entity.desiredFacing = directionTo(entity.pos, entity.target.pos);
        const facingReady = entity.tickRotation();
        // NoMovingFire units must face target before attacking
        if (entity.stats.noMovingFire && !facingReady) {
          entity.animState = AnimState.IDLE;
          return;
        }
      }
      entity.animState = AnimState.ATTACK;

      if (entity.attackCooldown <= 0 && entity.weapon) {
        entity.attackCooldown = entity.weapon.rof;

        // Apply weapon inaccuracy — scatter the impact point
        let impactX = entity.target.pos.x;
        let impactY = entity.target.pos.y;
        let directHit = true;
        if (entity.weapon.inaccuracy && entity.weapon.inaccuracy > 0) {
          const scatter = entity.weapon.inaccuracy * CELL_SIZE;
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * scatter;
          impactX += Math.cos(angle) * dist;
          impactY += Math.sin(angle) * dist;
          // Check if scattered shot still hits the target (within half-cell)
          const dx = impactX - entity.target.pos.x;
          const dy = impactY - entity.target.pos.y;
          directHit = Math.sqrt(dx * dx + dy * dy) < CELL_SIZE * 0.6;
        }

        // Apply warhead-vs-armor damage multiplier + veterancy bonus
        const armorIdx = entity.target.stats.armor === 'none' ? 0
          : entity.target.stats.armor === 'light' ? 1 : 2;
        const mult = WARHEAD_VS_ARMOR[entity.weapon.warhead]?.[armorIdx] ?? 1;
        const damage = Math.max(1, Math.round(entity.weapon.damage * mult * entity.damageMultiplier));
        const killed = directHit ? entity.target.takeDamage(damage) : false;

        // AOE splash damage to nearby units (at impact point, not target)
        if (entity.weapon.splash && entity.weapon.splash > 0) {
          const splashCenter = { x: impactX, y: impactY };
          this.applySplashDamage(
            splashCenter, entity.weapon, directHit ? entity.target.id : -1,
            entity.isPlayerUnit, entity,
          );
        }

        // Play weapon sound
        this.audio.play(this.audio.weaponSound(entity.weapon.name));

        // Spawn attack effects + projectiles
        const tx = entity.target.pos.x;
        const ty = entity.target.pos.y;
        const sx = entity.pos.x;
        const sy = entity.pos.y;

        if (entity.isAnt && entity.type === 'ANT3') {
          this.effects.push({ type: 'tesla', x: tx, y: ty, frame: 0, maxFrames: 8, size: 12,
            sprite: 'piffpiff', spriteStart: 0 });
        } else if (entity.isAnt) {
          this.effects.push({ type: 'blood', x: tx, y: ty, frame: 0, maxFrames: 8, size: 6,
            sprite: 'piffpiff', spriteStart: 0 });
        } else {
          // Muzzle flash at attacker
          this.effects.push({ type: 'muzzle', x: sx, y: sy, frame: 0, maxFrames: 4, size: 5,
            sprite: 'piff', spriteStart: 0 });

          // Projectile travel from attacker to impact point (scattered for inaccurate weapons)
          const projStyle = this.weaponProjectileStyle(entity.weapon.name);
          if (projStyle !== 'bullet' || worldDist(entity.pos, entity.target.pos) > 2) {
            const travelFrames = projStyle === 'bullet' ? 3
              : projStyle === 'shell' || projStyle === 'rocket' ? 8 : 5;
            this.effects.push({
              type: 'projectile', x: sx, y: sy, frame: 0, maxFrames: travelFrames, size: 3,
              startX: sx, startY: sy, endX: impactX, endY: impactY, projStyle,
            });
          }

          // Impact explosion at scattered impact point
          this.effects.push({ type: 'explosion', x: impactX, y: impactY, frame: 0, maxFrames: 17, size: 8,
            sprite: 'veh-hit1', spriteStart: 0 });
        }

        if (killed) {
          entity.creditKill();
          this.effects.push({ type: 'explosion', x: tx, y: ty, frame: 0, maxFrames: 18, size: 16,
            sprite: 'fball1', spriteStart: 0 });
          // Screen shake on large explosion
          this.renderer.screenShake = Math.max(this.renderer.screenShake, 8);
          // Scorch mark on terrain
          const tc = worldToCell(tx, ty);
          const scorchSize = entity.target.stats.isInfantry ? 4 : 8;
          this.map.addDecal(tc.cx, tc.cy, scorchSize, 0.5);
          // Death sound
          if (entity.target.isAnt) {
            this.audio.play('die_ant');
          } else if (entity.target.stats.isInfantry) {
            this.audio.play('die_infantry');
          } else {
            this.audio.play('die_vehicle');
          }
          this.audio.play('explode_lg');
          // Track kills/losses
          if (entity.isPlayerUnit) {
            this.killCount++;
          } else {
            this.lossCount++;
            this.audio.play('eva_unit_lost');
            const tc = entity.target.cell;
            this.minimapAlert(tc.cx, tc.cy);
          }
        }
      }
    } else {
      // Defensive stance: don't chase, return to guard
      if (entity.stance === Stance.DEFENSIVE) {
        entity.target = null;
        entity.forceFirePos = null;
        entity.targetStructure = null;
        entity.mission = this.idleMission(entity);
        entity.animState = AnimState.IDLE;
      } else {
        entity.animState = AnimState.WALK;
        entity.moveToward(entity.target.pos, entity.stats.speed * 0.5);
      }
    }

    if (entity.attackCooldown > 0) entity.attackCooldown--;
  }

  /** Hunt mode — move toward target and attack */
  private updateHunt(entity: Entity): void {
    if (!entity.target?.alive) {
      entity.target = null;
      // If we have a pending moveTarget from attack-move, resume moving
      if (entity.moveTarget) {
        entity.mission = Mission.MOVE;
        entity.path = findPath(this.map, entity.cell, worldToCell(entity.moveTarget.x, entity.moveTarget.y), true);
        entity.pathIndex = 0;
      } else {
        entity.mission = this.idleMission(entity);
      }
      return;
    }

    if (entity.inRange(entity.target)) {
      entity.mission = Mission.ATTACK;
      entity.animState = AnimState.ATTACK;
    } else {
      entity.animState = AnimState.WALK;
      // Use pathfinding to reach target (recalc periodically)
      const targetCell = worldToCell(entity.target.pos.x, entity.target.pos.y);
      if (entity.path.length === 0 || entity.pathIndex >= entity.path.length ||
          (this.tick % 15 === 0)) {
        entity.path = findPath(this.map, entity.cell, targetCell, true);
        entity.pathIndex = 0;
      }
      if (entity.path.length > 0 && entity.pathIndex < entity.path.length) {
        const nextCell = entity.path[entity.pathIndex];
        const wp: WorldPos = {
          x: nextCell.cx * CELL_SIZE + CELL_SIZE / 2,
          y: nextCell.cy * CELL_SIZE + CELL_SIZE / 2,
        };
        if (entity.moveToward(wp, entity.stats.speed * 0.5)) {
          entity.pathIndex++;
        }
      } else {
        // No path found — move directly
        entity.moveToward(entity.target.pos, entity.stats.speed * 0.5);
      }
    }
  }

  /** Guard mode — attack nearby enemies or auto-heal (rate-limited to every 15 ticks) */
  private updateGuard(entity: Entity): void {
    entity.animState = AnimState.IDLE;

    // Medic heal cooldown ticks down every frame (not rate-limited)
    if (entity.type === 'MEDI' && entity.attackCooldown > 0) {
      entity.attackCooldown--;
    }

    if (this.tick - entity.lastGuardScan < 15) return;
    entity.lastGuardScan = this.tick;

    // Medic auto-heal: find nearest damaged friendly infantry
    if (entity.type === 'MEDI' && entity.isPlayerUnit) {
      let healTarget: Entity | null = null;
      let healDist = Infinity;
      for (const other of this.entities) {
        if (!other.alive || other.id === entity.id) continue;
        if (!other.isPlayerUnit || !other.stats.isInfantry) continue;
        if (other.hp >= other.maxHp) continue;
        const dist = worldDist(entity.pos, other.pos);
        if (dist < entity.stats.sight * 1.5 && dist < healDist) {
          healDist = dist;
          healTarget = other;
        }
      }
      if (healTarget) {
        // Move toward and heal
        if (healDist < 1.5) {
          entity.animState = AnimState.ATTACK; // heal animation
          if (entity.attackCooldown <= 0) {
            healTarget.hp = Math.min(healTarget.maxHp, healTarget.hp + 8);
            entity.attackCooldown = 20; // heal every ~1.3s (cooldown decremented each tick above)
            entity.desiredFacing = directionTo(entity.pos, healTarget.pos);
            entity.tickRotation();
            this.audio.play('heal');
          }
        } else {
          entity.animState = AnimState.WALK;
          entity.moveToward(healTarget.pos, entity.stats.speed * 0.5);
        }
        return;
      }
    }

    // Hold fire stance: never auto-engage
    if (entity.stance === Stance.HOLD_FIRE) return;

    // Harvesters have no weapon — don't auto-engage (would chase forever)
    if (entity.type === UnitType.V_HARV) return;

    const isPlayer = entity.isPlayerUnit;
    const ec = entity.cell;
    const isDog = entity.type === 'DOG';
    // Defensive stance: reduced scan range (weapon range only, not full sight)
    const scanRange = entity.stance === Stance.DEFENSIVE
      ? Math.min(entity.stats.sight, (entity.weapon?.range ?? 2) + 1)
      : entity.stats.sight;
    let bestTarget: Entity | null = null;
    let bestDist = Infinity;
    let bestIsInfantry = false;
    for (const other of this.entities) {
      if (!other.alive) continue;
      if (isPlayer === other.isPlayerUnit) continue;
      const dist = worldDist(entity.pos, other.pos);
      if (dist >= scanRange) continue;
      // Check line of sight — can't target through walls
      const oc = other.cell;
      if (!this.map.hasLineOfSight(ec.cx, ec.cy, oc.cx, oc.cy)) continue;

      if (isDog) {
        // Dogs prioritize infantry (useless vs vehicles)
        const otherIsInf = other.stats.isInfantry;
        if (otherIsInf && !bestIsInfantry) {
          bestTarget = other; bestDist = dist; bestIsInfantry = true;
        } else if (otherIsInf === bestIsInfantry && dist < bestDist) {
          bestTarget = other; bestDist = dist; bestIsInfantry = otherIsInf;
        }
      } else {
        // Non-dogs: pick closest enemy
        if (dist < bestDist) {
          bestTarget = other; bestDist = dist;
        }
      }
    }
    if (bestTarget) {
      entity.mission = Mission.ATTACK;
      entity.target = bestTarget;
    }
  }

  /** Area Guard — defend spawn area, attack nearby enemies but return if straying too far */
  private updateAreaGuard(entity: Entity): void {
    entity.animState = AnimState.IDLE;
    if (this.tick - entity.lastGuardScan < 15) return;
    entity.lastGuardScan = this.tick;

    const origin = entity.guardOrigin ?? entity.pos;
    const ec = entity.cell;
    const scanRange = entity.stats.sight * 1.5;

    // If too far from origin (>8 cells), return home — but still attack enemies en route
    const distFromOrigin = worldDist(entity.pos, origin);
    if (distFromOrigin > 8) {
      // Check for enemies while returning
      const isPlayer = entity.isPlayerUnit;
      for (const other of this.entities) {
        if (!other.alive || other.isPlayerUnit === isPlayer) continue;
        const dist = worldDist(entity.pos, other.pos);
        if (dist > entity.stats.sight * CELL_SIZE) continue;
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
      entity.path = findPath(this.map, ec, worldToCell(origin.x, origin.y), true);
      entity.pathIndex = 0;
      return;
    }

    // Look for enemies within scan range
    let bestTarget: Entity | null = null;
    let bestDist = Infinity;
    const isPlayer = entity.isPlayerUnit;
    for (const other of this.entities) {
      if (!other.alive || other.isPlayerUnit === isPlayer) continue;
      const dist = worldDist(entity.pos, other.pos);
      if (dist > scanRange) continue;
      const oc = other.cell;
      if (!this.map.hasLineOfSight(ec.cx, ec.cy, oc.cx, oc.cy)) continue;
      if (dist < bestDist) { bestDist = dist; bestTarget = other; }
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

    if (dist <= range) {
      // Engineer capture: consume engineer, convert building to player
      if (entity.type === UnitType.I_E6 && entity.isPlayerUnit) {
        s.house = House.Spain;
        s.hp = s.maxHp;
        // Kill the engineer (consumed)
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
        const damage = Math.max(1, Math.round(entity.weapon.damage * 0.15 * hpScale));
        const destroyed = this.damageStructure(s, damage);
        entity.attackCooldown = entity.weapon.rof;
        this.audio.play(this.audio.weaponSound(entity.weapon.name));
        // Muzzle + impact effects
        this.effects.push({
          type: 'muzzle', x: entity.pos.x, y: entity.pos.y,
          frame: 0, maxFrames: 4, size: 5, sprite: 'piff', spriteStart: 0,
        });
        this.effects.push({
          type: 'explosion', x: structPos.x, y: structPos.y,
          frame: 0, maxFrames: 10, size: 8,
          sprite: 'veh-hit1', spriteStart: 0,
        });
        if (destroyed) {
          if (entity.isPlayerUnit) this.killCount++;
        }
      }
    } else {
      entity.animState = AnimState.WALK;
      entity.moveToward(structPos, entity.stats.speed * 0.5);
    }
    if (entity.attackCooldown > 0) entity.attackCooldown--;
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
            entity.isPlayerUnit, entity,
          );
        }

        // Weapon sound + effects
        this.audio.play(this.audio.weaponSound(entity.weapon.name));
        const sx = entity.pos.x;
        const sy = entity.pos.y;
        this.effects.push({
          type: 'muzzle', x: sx, y: sy,
          frame: 0, maxFrames: 4, size: 5, sprite: 'piff', spriteStart: 0,
        });
        const projStyle = this.weaponProjectileStyle(entity.weapon.name);
        const travelFrames = projStyle === 'shell' || projStyle === 'rocket' ? 8 : 5;
        this.effects.push({
          type: 'projectile', x: sx, y: sy, frame: 0, maxFrames: travelFrames, size: 3,
          startX: sx, startY: sy, endX: impactX, endY: impactY, projStyle,
        });
        this.effects.push({
          type: 'explosion', x: impactX, y: impactY,
          frame: 0, maxFrames: 17, size: 8, sprite: 'veh-hit1', spriteStart: 0,
        });
        const tc = worldToCell(impactX, impactY);
        this.map.addDecal(tc.cx, tc.cy, 3, 0.3);
      }
    } else {
      entity.animState = AnimState.WALK;
      entity.moveToward(target, entity.stats.speed * 0.5);
    }
    if (entity.attackCooldown > 0) entity.attackCooldown--;
  }

  /** Defensive structure auto-fire — pillboxes, guard towers, tesla coils fire at nearby enemies */
  private updateStructureCombat(): void {
    for (const s of this.structures) {
      if (!s.alive || !s.weapon) continue;
      if (s.attackCooldown > 0) { s.attackCooldown--; continue; }

      const isPlayerStruct = s.house === House.Spain || s.house === House.Greece;
      const sx = s.cx * CELL_SIZE + CELL_SIZE;
      const sy = s.cy * CELL_SIZE + CELL_SIZE;
      const structPos: WorldPos = { x: sx, y: sy };
      const range = s.weapon.range;

      // Find closest enemy in range
      let bestTarget: Entity | null = null;
      let bestDist = Infinity;
      for (const e of this.entities) {
        if (!e.alive) continue;
        if (isPlayerStruct === e.isPlayerUnit) continue; // don't shoot friendlies
        const dist = worldDist(structPos, e.pos);
        if (dist < range && dist < bestDist) {
          // LOS check
          const ec = e.cell;
          if (!this.map.hasLineOfSight(s.cx, s.cy, ec.cx, ec.cy)) continue;
          bestTarget = e;
          bestDist = dist;
        }
      }

      if (bestTarget) {
        s.attackCooldown = s.weapon.rof;
        // Apply warhead-vs-armor multiplier
        const wh = (s.weapon.warhead ?? 'HE') as WarheadType;
        const armorIdx = bestTarget.stats.armor === 'none' ? 0
          : bestTarget.stats.armor === 'light' ? 1 : 2;
        const mult = WARHEAD_VS_ARMOR[wh]?.[armorIdx] ?? 1;
        const damage = Math.max(1, Math.round(s.weapon.damage * mult));
        const killed = bestTarget.takeDamage(damage);

        // Fire effects
        this.effects.push({
          type: 'muzzle', x: sx, y: sy,
          frame: 0, maxFrames: 4, size: 5, sprite: 'piff', spriteStart: 0,
        });

        // Tesla coil and Queen Ant get special effect
        if (s.type === 'TSLA' || s.type === 'QUEE') {
          this.effects.push({
            type: 'tesla', x: bestTarget.pos.x, y: bestTarget.pos.y,
            frame: 0, maxFrames: 8, size: 12, sprite: 'piffpiff', spriteStart: 0,
          });
          this.audio.play('teslazap');
        } else {
          // Projectile from structure to target
          this.effects.push({
            type: 'projectile', x: sx, y: sy, frame: 0, maxFrames: 5, size: 3,
            startX: sx, startY: sy, endX: bestTarget.pos.x, endY: bestTarget.pos.y,
            projStyle: 'bullet',
          });
          this.effects.push({
            type: 'explosion', x: bestTarget.pos.x, y: bestTarget.pos.y,
            frame: 0, maxFrames: 10, size: 6, sprite: 'veh-hit1', spriteStart: 0,
          });
          this.audio.play('machinegun');
        }

        // Splash damage
        if (s.weapon.splash && s.weapon.splash > 0) {
          this.applySplashDamage(
            bestTarget.pos,
            { damage: s.weapon.damage, warhead: wh, splash: s.weapon.splash },
            bestTarget.id, isPlayerStruct,
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
          if (isPlayerStruct) this.killCount++;
          if (bestTarget.isAnt) {
            this.audio.play('die_ant');
          } else if (bestTarget.stats.isInfantry) {
            this.audio.play('die_infantry');
          } else {
            this.audio.play('die_vehicle');
          }
        }
      }
    }
  }

  /** Apply AOE splash damage to entities near an impact point */
  private applySplashDamage(
    center: WorldPos, weapon: { damage: number; warhead: WarheadType; splash?: number },
    primaryTargetId: number, attackerIsPlayer: boolean, attacker?: Entity,
  ): void {
    const splashRange = weapon.splash ?? 0;
    if (splashRange <= 0) return;

    for (const other of this.entities) {
      if (!other.alive || other.id === primaryTargetId) continue;
      const isFriendly = other.isPlayerUnit === attackerIsPlayer;
      const dist = worldDist(center, other.pos);
      if (dist > splashRange) continue;

      // Splash damage falls off linearly with distance (100% at center, 25% at edge)
      // Friendly fire deals half splash damage
      const falloff = 1 - (dist / splashRange) * 0.75;
      const friendlyMod = isFriendly ? 0.5 : 1.0;
      const armorIdx = other.stats.armor === 'none' ? 0
        : other.stats.armor === 'light' ? 1 : 2;
      const mult = WARHEAD_VS_ARMOR[weapon.warhead]?.[armorIdx] ?? 1;
      const splashDmg = Math.max(1, Math.round(weapon.damage * mult * falloff * 0.5 * friendlyMod));
      const killed = other.takeDamage(splashDmg);

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
        if (other.isAnt) this.audio.play('die_ant');
        else if (other.stats.isInfantry) this.audio.play('die_infantry');
        else this.audio.play('die_vehicle');
        // Track kills/losses from splash
        if (!isFriendly && attackerIsPlayer) this.killCount++;
        else if (!isFriendly && other.isPlayerUnit) {
          this.lossCount++;
          this.audio.play('eva_unit_lost');
          const oc = other.cell;
          this.minimapAlert(oc.cx, oc.cy);
        }
        // Friendly fire kills still count as losses
        if (isFriendly && attackerIsPlayer) {
          this.lossCount++;
          this.audio.play('eva_unit_lost');
          const oc = other.cell;
          this.minimapAlert(oc.cx, oc.cy);
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
      if (trigName && !this.map.activatedCellTriggers.has(`${cellIdx}:${trigName}`)) {
        this.map.activatedCellTriggers.add(`${cellIdx}:${trigName}`);
        // Find matching trigger by name and mark its PLAYER_ENTERED condition as met
        for (const trigger of this.triggers) {
          if (trigger.name === trigName) {
            trigger.playerEntered = true;
          }
        }
      }
    }
  }

  /** Process trigger system — check conditions and fire actions */
  private processTriggers(): void {
    for (const trigger of this.triggers) {
      // Volatile (0) and semi-persistent (1): skip once fired
      // Persistent (2): allowed to re-fire after timer reset
      if (trigger.fired && trigger.persistence <= 1) continue;

      // Check event conditions
      const e1Met = checkTriggerEvent(trigger.event1, this.tick, this.globals, trigger.timerTick, trigger.playerEntered);
      const e2Met = checkTriggerEvent(trigger.event2, this.tick, this.globals, trigger.timerTick, trigger.playerEntered);

      let shouldFire = false;
      switch (trigger.eventControl) {
        case 0: shouldFire = e1Met; break;            // only event1
        case 1: shouldFire = e1Met && e2Met; break;   // AND
        case 2: shouldFire = e1Met || e2Met; break;   // OR
        default: shouldFire = e1Met; break;
      }

      if (!shouldFire) continue;
      trigger.fired = true;

      // Persistent triggers: reset timer so TIME events must elapse again
      if (trigger.persistence === 2) {
        trigger.timerTick = this.tick;
      }

      // Execute actions
      const executeAction = (action: typeof trigger.action1) => {
        const spawned = executeTriggerAction(
          action, this.teamTypes, this.waypoints, this.globals, this.triggers
        );
        // Tag ant spawns with wave coordination
        const ants = spawned.filter(e => e.isAnt);
        if (ants.length > 1) {
          const wid = this.nextWaveId++;
          const rallyDelay = this.tick + GAME_TICKS_PER_SEC * 2; // 2-second rally
          for (const ant of ants) {
            ant.waveId = wid;
            ant.waveRallyTick = rallyDelay;
          }
        }
        for (const entity of spawned) {
          this.entities.push(entity);
          this.entityById.set(entity.id, entity);
        }
      };

      executeAction(trigger.action1);
      if (trigger.actionControl === 1) {
        executeAction(trigger.action2);
      }
    }
  }

  /** Check win/lose conditions */
  private checkVictoryConditions(): void {
    if (this.tick < GAME_TICKS_PER_SEC * 3) return;

    const playerAlive = this.entities.some(e => e.alive && e.isPlayerUnit);
    const antsAlive = this.entities.some(e => e.alive && e.isAnt);

    // Check if any unfired triggers will still spawn ants
    const pendingAntTriggers = this.triggers.some(t => {
      if (t.fired && t.persistence <= 1) return false; // volatile/semi-persistent already fired
      // Persistent triggers that fired still re-fire — consider them pending
      // Check if any action spawns an ant team (REINFORCEMENTS=7 or CREATE_TEAM=4)
      const checksTeam = (team: number) => {
        if (team < 0 || team >= this.teamTypes.length) return false;
        return this.teamTypes[team].members.some(m => m.type.startsWith('ANT'));
      };
      const isSpawnAction = (a: number) => a === 7 || a === 4;
      const spawnsAnts = (isSpawnAction(t.action1.action) && checksTeam(t.action1.team)) ||
             (isSpawnAction(t.action2.action) && checksTeam(t.action2.team));
      if (!spawnsAnts) return false;
      // For persistent triggers that already fired, check if they'll fire again (TIME events)
      if (t.fired && t.persistence === 2) return true;
      return !t.fired;
    });

    // Check for ant hive structures (QUEE, LAR1, LAR2) — must destroy all enemy ones to win
    const ANT_STRUCTURES = new Set(['QUEE', 'LAR1', 'LAR2']);
    const antStructuresAlive = this.structures.some(s =>
      s.alive && ANT_STRUCTURES.has(s.type) &&
      s.house !== House.Spain && s.house !== House.Greece
    );

    if (!playerAlive) {
      this.state = 'lost';
      this.onStateChange?.('lost');
    } else if (!antsAlive && !pendingAntTriggers && !antStructuresAlive) {
      // Save surviving units for carry-over to next mission
      if (this.toCarryOver) {
        saveCarryover(this.entities);
      }
      this.state = 'won';
      this.onStateChange?.('won');
    }
  }

  /** Check if player has a building of the given type */
  hasBuilding(type: string): boolean {
    return this.structures.some(s => s.alive && s.type === type &&
      (s.house === House.Spain || s.house === House.Greece));
  }

  /** Get buildable items based on current structures */
  getAvailableItems(): ProductionItem[] {
    return PRODUCTION_ITEMS.filter(item => this.hasBuilding(item.prerequisite));
  }

  /** Start building an item (called from sidebar click) */
  startProduction(item: ProductionItem): void {
    const category = item.isStructure ? 'structure' : item.prerequisite === 'TENT' ? 'infantry' : 'vehicle';
    const existing = this.productionQueue.get(category);
    if (existing) {
      // Already building — queue another of the same item (max 5 total)
      if (existing.item.type === item.type && existing.queueCount < 5) {
        if (this.credits < item.cost) return;
        this.credits -= item.cost;
        existing.queueCount++;
      }
      return;
    }
    if (this.credits < item.cost) return;
    this.credits -= item.cost;
    this.productionQueue.set(category, { item, progress: 0, queueCount: 1 });
  }

  /** Cancel production in a category — removes one from queue, or cancels active build */
  cancelProduction(category: string): void {
    const entry = this.productionQueue.get(category);
    if (!entry) return;
    if (entry.queueCount > 1) {
      // Dequeue one — refund full cost of queued item
      entry.queueCount--;
      this.credits += entry.item.cost;
    } else {
      // Cancel active build — refund based on remaining progress
      const refund = Math.floor(entry.item.cost * (1 - entry.progress / entry.item.buildTime));
      this.credits += refund;
      this.productionQueue.delete(category);
    }
  }

  /** Advance production queues each tick */
  private tickProduction(): void {
    // Low power: production runs at half speed
    const lowPower = this.powerConsumed > this.powerProduced && this.powerProduced > 0;
    for (const [category, entry] of this.productionQueue) {
      // Check prerequisite still exists
      if (!this.hasBuilding(entry.item.prerequisite)) {
        this.cancelProduction(category);
        continue;
      }
      // Skip every other tick when low power
      if (lowPower && this.tick % 2 === 0) continue;
      entry.progress++;
      if (entry.progress >= entry.item.buildTime) {
        // Build complete
        if (entry.item.isStructure) {
          // Structure: go into placement mode
          this.pendingPlacement = entry.item;
          this.productionQueue.delete(category);
          this.audio.play('eva_acknowledged');
        } else {
          // Unit: spawn at the producing structure
          this.spawnProducedUnit(entry.item);
          this.audio.play('eva_acknowledged');
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

  /** Spawn a produced unit at its factory */
  private spawnProducedUnit(item: ProductionItem): void {
    const factoryType = item.prerequisite;
    // Find the factory building
    let factory: MapStructure | null = null;
    for (const s of this.structures) {
      if (s.alive && s.type === factoryType && (s.house === House.Spain || s.house === House.Greece)) {
        factory = s;
        break;
      }
    }
    if (!factory) return;

    const unitType = item.type as UnitType;
    const spawnX = (factory.cx + 1) * CELL_SIZE + CELL_SIZE / 2;
    const spawnY = (factory.cy + 2) * CELL_SIZE + CELL_SIZE / 2;
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
      entity.path = findPath(this.map, entity.cell, worldToCell(rally.x, rally.y), true);
      entity.pathIndex = 0;
    }
  }

  /** Place a completed structure on the map */
  placeStructure(cx: number, cy: number): boolean {
    if (!this.pendingPlacement) return false;
    const item = this.pendingPlacement;
    const [fw, fh] = STRUCTURE_SIZE[item.type] ?? [2, 2];
    // Validate: cells must be passable and within bounds
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        if (!this.map.isPassable(cx + dx, cy + dy)) return false;
      }
    }
    // Must be adjacent to an existing player structure
    let adjacent = false;
    for (const s of this.structures) {
      if (!s.alive || (s.house !== House.Spain && s.house !== House.Greece)) continue;
      const dist = Math.abs(s.cx - cx) + Math.abs(s.cy - cy);
      if (dist <= 4) { adjacent = true; break; }
    }
    if (!adjacent) return false;

    const image = item.type.toLowerCase();
    const maxHp = STRUCTURE_MAX_HP[item.type] ?? 256;
    // Create structure
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
    };
    this.structures.push(newStruct);
    // Mark cells as impassable
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        this.map.setTerrain(cx + dx, cy + dy, Terrain.WALL);
      }
    }
    this.pendingPlacement = null;
    this.audio.play('building_explode'); // construction complete sound
    // Spawn free harvester with refinery
    if (item.type === 'PROC') {
      const harv = new Entity(UnitType.V_HARV, House.Spain,
        (cx + 1) * CELL_SIZE + CELL_SIZE / 2, (cy + 2) * CELL_SIZE + CELL_SIZE / 2);
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

  /** Spawn a crate on a random revealed, passable cell */
  private spawnCrate(): void {
    const crateTypes: CrateType[] = ['money', 'money', 'heal', 'veterancy', 'unit'];
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
    this.audio.play('eva_acknowledged');
    this.effects.push({
      type: 'explosion', x: crate.x, y: crate.y,
      frame: 0, maxFrames: 10, size: 8, sprite: 'piffpiff', spriteStart: 0,
    });
    switch (crate.type) {
      case 'money':
        this.credits += 500;
        break;
      case 'heal':
        unit.hp = unit.maxHp;
        break;
      case 'veterancy':
        if (unit.veterancy < 2) {
          unit.kills = unit.veterancy === 0 ? 3 : 6;
          unit.creditKill(); // triggers promotion
        }
        break;
      case 'unit': {
        // Spawn a random infantry unit nearby
        const types = [UnitType.I_E1, UnitType.I_E2, UnitType.I_E3, UnitType.I_E4];
        const uType = types[Math.floor(Math.random() * types.length)];
        const bonus = new Entity(uType, House.Spain, crate.x + CELL_SIZE, crate.y);
        bonus.mission = Mission.GUARD;
        this.entities.push(bonus);
        this.entityById.set(bonus.id, bonus);
        break;
      }
    }
  }

  /** Render the current frame */
  private render(): void {
    this.renderer.attackMoveMode = this.attackMoveMode;
    this.renderer.sellMode = this.sellMode;
    this.renderer.repairMode = this.repairMode;
    this.renderer.repairingStructures = this.repairingStructures;
    // Sidebar data
    this.renderer.sidebarCredits = this.displayCredits;
    this.renderer.sidebarPowerProduced = this.powerProduced;
    this.renderer.sidebarPowerConsumed = this.powerConsumed;
    this.renderer.sidebarItems = this.cachedAvailableItems ?? this.getAvailableItems();
    this.renderer.sidebarQueue = this.productionQueue;
    this.renderer.sidebarScroll = this.sidebarScroll;
    this.renderer.sidebarW = Game.SIDEBAR_W;
    this.renderer.hasRadar = this.hasBuilding('DOME');
    this.renderer.crates = this.crates;
    // Placement ghost
    if (this.pendingPlacement) {
      const { mouseX, mouseY } = this.input.state;
      const world = this.camera.screenToWorld(mouseX, mouseY);
      this.renderer.placementItem = this.pendingPlacement;
      this.renderer.placementCx = Math.floor(world.x / CELL_SIZE);
      this.renderer.placementCy = Math.floor(world.y / CELL_SIZE);
      // Validate placement using actual footprint
      const cx = this.renderer.placementCx;
      const cy = this.renderer.placementCy;
      const [pfw, pfh] = STRUCTURE_SIZE[this.pendingPlacement.type] ?? [2, 2];
      let valid = true;
      for (let dy = 0; dy < pfh; dy++) {
        for (let dx = 0; dx < pfw; dx++) {
          if (!this.map.isPassable(cx + dx, cy + dy)) valid = false;
        }
      }
      // Check adjacency
      let adj = false;
      for (const s of this.structures) {
        if (!s.alive || (s.house !== House.Spain && s.house !== House.Greece)) continue;
        if (Math.abs(s.cx - cx) + Math.abs(s.cy - cy) <= 4) { adj = true; break; }
      }
      this.renderer.placementValid = valid && adj;
    } else {
      this.renderer.placementItem = null;
    }
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

    // Render pause overlay
    if (this.state === 'paused') {
      this.renderer.renderPauseOverlay();
    }

    // Render end screen overlay when game is over
    if (this.state === 'won' || this.state === 'lost') {
      this.renderer.renderEndScreen(
        this.state === 'won',
        this.killCount,
        this.lossCount,
        this.tick,
      );
    }
  }
}
