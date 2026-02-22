/**
 * Main game loop — ties all engine systems together.
 * Fixed timestep at 15 FPS (matching original Red Alert game speed).
 */

import {
  type WorldPos, CELL_SIZE, MAP_CELLS, GAME_TICKS_PER_SEC,
  Mission, AnimState, worldDist, directionTo, worldToCell,
  WARHEAD_VS_ARMOR,
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

    // Clean up dead entities after death animation (use deathTick instead of animFrame)
    const before = this.entities.length;
    this.entities = this.entities.filter(
      e => e.alive || e.deathTick < 45 // ~3 seconds at 15fps
    );
    if (this.entities.length < before) {
      this.entityById.clear();
      for (const e of this.entities) this.entityById.set(e.id, e);
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
    const { leftClick, rightClick, doubleClick, dragBox, ctrlHeld, keys } = this.input.state;

    // --- Pause toggle (P or Escape) ---
    if (keys.has('p') || keys.has('Escape')) {
      keys.delete('p');
      keys.delete('Escape');
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
        unit.moveTarget = null;
        unit.path = [];
        unit.animState = AnimState.IDLE;
      }
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

    // A key: toggle attack-move mode
    if (keys.has('a') && !keys.has('ArrowLeft')) {
      this.attackMoveMode = true;
      keys.delete('a');
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
      const target = this.findEntityAt(world);

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
          unit.moveTarget = null;
        } else {
          // Spread units in a grid around the target point
          const spread = units.length > 1 ? this.spreadOffset(spreadIdx, units.length) : { x: 0, y: 0 };
          spreadIdx++;
          const goalX = world.x + spread.x;
          const goalY = world.y + spread.y;
          unit.mission = Mission.MOVE;
          unit.moveTarget = { x: goalX, y: goalY };
          unit.target = null;
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
      if (commandIssued) {
        const isAttack = target && !target.isPlayerUnit;
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

  /** Ant AI — hunt nearest visible player unit (fog-aware) */
  private updateAntAI(entity: Entity): void {
    if (entity.mission === Mission.ATTACK && entity.target?.alive) return;

    let nearest: Entity | null = null;
    let nearestDist = Infinity;

    for (const other of this.entities) {
      if (!other.alive || !other.isPlayerUnit) continue;
      const dist = worldDist(entity.pos, other.pos);
      // Fog-aware: ants can only see units within their sight range
      if (dist > entity.stats.sight * 1.5) continue;
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
        entity.mission = Mission.GUARD;
        entity.animState = AnimState.IDLE;
      }
    } else {
      entity.mission = Mission.GUARD;
      entity.animState = AnimState.IDLE;
    }
  }

  /** Attack target */
  private updateAttack(entity: Entity): void {
    if (!entity.target?.alive) {
      entity.target = null;
      entity.mission = Mission.GUARD;
      entity.animState = AnimState.IDLE;
      return;
    }

    if (entity.inRange(entity.target)) {
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
        // Apply warhead-vs-armor damage multiplier
        const armorIdx = entity.target.stats.armor === 'none' ? 0
          : entity.target.stats.armor === 'light' ? 1 : 2;
        const mult = WARHEAD_VS_ARMOR[entity.weapon.warhead]?.[armorIdx] ?? 1;
        const damage = Math.max(1, Math.round(entity.weapon.damage * mult));
        const killed = entity.target.takeDamage(damage);
        entity.attackCooldown = entity.weapon.rof;

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

          // Projectile travel from attacker to target
          const projStyle = this.weaponProjectileStyle(entity.weapon.name);
          if (projStyle !== 'bullet' || worldDist(entity.pos, entity.target.pos) > 2) {
            const travelFrames = projStyle === 'bullet' ? 3
              : projStyle === 'shell' || projStyle === 'rocket' ? 8 : 5;
            this.effects.push({
              type: 'projectile', x: sx, y: sy, frame: 0, maxFrames: travelFrames, size: 3,
              startX: sx, startY: sy, endX: tx, endY: ty, projStyle,
            });
          }

          // Impact at target
          this.effects.push({ type: 'explosion', x: tx, y: ty, frame: 0, maxFrames: 17, size: 8,
            sprite: 'veh-hit1', spriteStart: 0 });
        }

        if (killed) {
          this.effects.push({ type: 'explosion', x: tx, y: ty, frame: 0, maxFrames: 18, size: 16,
            sprite: 'fball1', spriteStart: 0 });
          // Screen shake on large explosion
          this.renderer.screenShake = Math.max(this.renderer.screenShake, 8);
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

  /** Guard mode — attack nearby enemies (rate-limited to every 15 ticks) */
  private updateGuard(entity: Entity): void {
    entity.animState = AnimState.IDLE;

    if (this.tick - entity.lastGuardScan < 15) return;
    entity.lastGuardScan = this.tick;

    const isPlayer = entity.isPlayerUnit;
    for (const other of this.entities) {
      if (!other.alive) continue;
      if (isPlayer === other.isPlayerUnit) continue;
      const dist = worldDist(entity.pos, other.pos);
      if (dist < entity.stats.sight) {
        entity.mission = Mission.ATTACK;
        entity.target = other;
        break;
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
