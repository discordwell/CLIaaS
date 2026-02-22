/**
 * Main game loop — ties all engine systems together.
 * Fixed timestep at 15 FPS (matching original Red Alert game speed).
 */

import {
  type WorldPos, CELL_SIZE, MAP_CELLS, GAME_TICKS_PER_SEC,
  Mission, AnimState, House, UnitType, worldDist, directionTo, worldToCell,
  WARHEAD_VS_ARMOR, type WarheadType,
} from './types';
import { AssetManager } from './assets';
import { AudioManager } from './audio';
import { Camera } from './camera';
import { InputManager } from './input';
import { Entity, resetEntityIds } from './entity';
import { GameMap } from './map';
import { Renderer, type Effect } from './renderer';
import { findPath } from './pathfinding';
import {
  loadScenario,
  type TeamType, type ScenarioTrigger, type MapStructure,
  checkTriggerEvent, executeTriggerAction,
} from './scenario';
export { MISSIONS, getMission, getMissionIndex, loadProgress, saveProgress } from './scenario';
export type { MissionInfo } from './scenario';
export { AudioManager } from './audio';

export type GameState = 'loading' | 'playing' | 'won' | 'lost' | 'paused';

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
  private cellInfCount = new Map<number, number>(); // reused each tick for sub-cell assignment
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
    this.camera = new Camera(canvas.width, canvas.height);
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
    const { map, entities, structures, name, briefing, waypoints, teamTypes, triggers, cellTriggers } = await loadScenario(scenarioId);
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
    this.globals.clear();
    // Set global 1 immediately — simulates the player discovering the ant area.
    // In the original, this is set by cell-entry triggers when the player explores,
    // but for gameplay pacing we enable it at start so ant waves begin spawning.
    this.globals.add(1);

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

    // Defensive structure auto-fire
    this.updateStructureCombat();

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

  // Minimap dimensions (must match renderer)
  private static readonly MM_SIZE = 90;
  private static readonly MM_MARGIN = 6;

  /** Check if a screen click is on the minimap; if so, scroll camera there */
  private handleMinimapClick(sx: number, sy: number): boolean {
    const mmX = this.canvas.width - Game.MM_SIZE - Game.MM_MARGIN;
    const mmY = Game.MM_MARGIN;
    if (sx < mmX || sx > mmX + Game.MM_SIZE || sy < mmY || sy > mmY + Game.MM_SIZE) {
      return false;
    }
    // Convert minimap click to world coordinates
    const scale = Game.MM_SIZE / Math.max(this.map.boundsW, this.map.boundsH);
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
    const { leftClick, rightClick, doubleClick, dragBox, ctrlHeld, shiftHeld, keys } = this.input.state;

    // --- Pause toggle (P or Escape) ---
    if (keys.has('p') || keys.has('Escape')) {
      keys.delete('p');
      keys.delete('Escape');
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
      // 1-9 without ctrl: recall control group (but not while typing other stuff)
      for (let g = 1; g <= 9; g++) {
        if (keys.has(String(g))) {
          const group = this.controlGroups.get(g);
          if (group && group.size > 0) {
            for (const e of this.entities) e.selected = false;
            this.selectedIds.clear();
            for (const id of group) {
              const unit = this.entityById.get(id);
              if (unit?.alive) {
                this.selectedIds.add(id);
                unit.selected = true;
              }
            }
            if (this.selectedIds.size > 0) this.audio.play('select');
          }
          keys.delete(String(g)); // consume
        }
      }
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
        this.audio.play('select');
      }
    }

    // --- Left click ---
    if (leftClick) {
      // Check minimap click first
      if (this.handleMinimapClick(leftClick.x, leftClick.y)) return;

      // Sell mode: click on player structure to sell it
      if (this.sellMode) {
        const world = this.camera.screenToWorld(leftClick.x, leftClick.y);
        const s = this.findStructureAt(world);
        if (s && s.alive && (s.house === 'Spain' || s.house === 'Greece')) {
          s.alive = false;
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
        this.audio.play('select');
      } else {
        if (!ctrlHeld) {
          for (const e of this.entities) e.selected = false;
          this.selectedIds.clear();
        }
      }
    }

    if (dragBox) {
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
        this.audio.play(isAttack ? 'attack_ack' : 'move_ack');
        // Spawn command marker at destination
        this.effects.push({
          type: 'marker', x: world.x, y: world.y, frame: 0, maxFrames: 15, size: 10,
          markerColor: isAttack ? 'rgba(255,60,60,1)' : 'rgba(80,255,80,1)',
        });
      }
    }
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
      // Check if click is within structure footprint (rough 2x2 area)
      if (cx >= s.cx && cx <= s.cx + 2 && cy >= s.cy && cy <= s.cy + 2) {
        return s;
      }
    }
    return null;
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
    }
    if (s.hp <= 0) {
      s.alive = false;
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
    if (entity.isAnt && entity.mission !== Mission.DIE) {
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

  /** Ant AI — hunt nearest visible player unit (fog-aware, LOS-aware) */
  private updateAntAI(entity: Entity): void {
    if (entity.mission === Mission.ATTACK && entity.target?.alive) return;

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
    }
  }

  /** Move toward move target along path */
  private updateMove(entity: Entity): void {
    if (!entity.moveTarget && entity.path.length === 0) {
      entity.mission = Mission.GUARD;
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
          entity.mission = Mission.GUARD;
          entity.animState = AnimState.IDLE;
        }
      }
    } else {
      entity.mission = Mission.GUARD;
      entity.animState = AnimState.IDLE;
    }
  }

  /** Attack target */
  private updateAttack(entity: Entity): void {
    // Handle structure targets
    if (entity.targetStructure) {
      if (!entity.targetStructure.alive) {
        entity.targetStructure = null;
        entity.mission = Mission.GUARD;
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
      entity.mission = Mission.GUARD;
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
        entity.turretFacing = directionTo(entity.pos, entity.target.pos);
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

        // Apply warhead-vs-armor damage multiplier
        const armorIdx = entity.target.stats.armor === 'none' ? 0
          : entity.target.stats.armor === 'light' ? 1 : 2;
        const mult = WARHEAD_VS_ARMOR[entity.weapon.warhead]?.[armorIdx] ?? 1;
        const damage = Math.max(1, Math.round(entity.weapon.damage * mult));
        const killed = directHit ? entity.target.takeDamage(damage) : false;

        // AOE splash damage to nearby units (at impact point, not target)
        if (entity.weapon.splash && entity.weapon.splash > 0) {
          const splashCenter = { x: impactX, y: impactY };
          this.applySplashDamage(
            splashCenter, entity.weapon, directHit ? entity.target.id : -1,
            entity.isPlayerUnit,
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
          }
        }
      }
    } else {
      entity.animState = AnimState.WALK;
      entity.moveToward(entity.target.pos, entity.stats.speed * 0.5);
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
        entity.mission = Mission.GUARD;
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

    const isPlayer = entity.isPlayerUnit;
    const ec = entity.cell;
    const isDog = entity.type === 'DOG';
    let bestTarget: Entity | null = null;
    let bestDist = Infinity;
    let bestIsInfantry = false;
    for (const other of this.entities) {
      if (!other.alive) continue;
      if (isPlayer === other.isPlayerUnit) continue;
      const dist = worldDist(entity.pos, other.pos);
      if (dist >= entity.stats.sight) continue;
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
        const damage = Math.max(1, Math.round(entity.weapon.damage * 0.15)); // structures use 256-scale HP
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
            entity.isPlayerUnit,
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
        // Apply warhead-vs-armor multiplier (structures use HE warhead)
        const armorIdx = bestTarget.stats.armor === 'none' ? 0
          : bestTarget.stats.armor === 'light' ? 1 : 2;
        const mult = WARHEAD_VS_ARMOR['HE' as WarheadType]?.[armorIdx] ?? 1;
        const damage = Math.max(1, Math.round(s.weapon.damage * mult));
        const killed = bestTarget.takeDamage(damage);

        // Fire effects
        this.effects.push({
          type: 'muzzle', x: sx, y: sy,
          frame: 0, maxFrames: 4, size: 5, sprite: 'piff', spriteStart: 0,
        });

        // Tesla coil gets special effect
        if (s.type === 'TSLA') {
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
            { damage: s.weapon.damage, warhead: 'HE' as WarheadType, splash: s.weapon.splash },
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
    primaryTargetId: number, attackerIsPlayer: boolean,
  ): void {
    const splashRange = weapon.splash ?? 0;
    if (splashRange <= 0) return;

    for (const other of this.entities) {
      if (!other.alive || other.id === primaryTargetId) continue;
      // Don't splash friendly units (no friendly fire)
      if (other.isPlayerUnit === attackerIsPlayer) continue;
      const dist = worldDist(center, other.pos);
      if (dist > splashRange) continue;

      // Splash damage falls off linearly with distance (100% at center, 25% at edge)
      const falloff = 1 - (dist / splashRange) * 0.75;
      const armorIdx = other.stats.armor === 'none' ? 0
        : other.stats.armor === 'light' ? 1 : 2;
      const mult = WARHEAD_VS_ARMOR[weapon.warhead]?.[armorIdx] ?? 1;
      const splashDmg = Math.max(1, Math.round(weapon.damage * mult * falloff * 0.5));
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
        if (attackerIsPlayer) this.killCount++;
        else this.lossCount++;
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

    if (!playerAlive) {
      this.state = 'lost';
      this.onStateChange?.('lost');
    } else if (!antsAlive && !pendingAntTriggers) {
      this.state = 'won';
      this.onStateChange?.('won');
    }
  }

  /** Render the current frame */
  private render(): void {
    this.renderer.attackMoveMode = this.attackMoveMode;
    this.renderer.sellMode = this.sellMode;
    this.renderer.repairMode = this.repairMode;
    this.renderer.repairingStructures = this.repairingStructures;
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
