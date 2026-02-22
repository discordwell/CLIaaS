/**
 * Main game loop — ties all engine systems together.
 * Fixed timestep at 15 FPS (matching original Red Alert game speed).
 */

import {
  type WorldPos, CELL_SIZE, GAME_TICKS_PER_SEC,
  Mission, AnimState, worldDist, directionTo, worldToCell,
} from './types';
import { AssetManager } from './assets';
import { Camera } from './camera';
import { InputManager } from './input';
import { Entity, resetEntityIds } from './entity';
import { GameMap } from './map';
import { Renderer, type Effect } from './renderer';
import { findPath } from './pathfinding';
import {
  loadScenario,
  type TeamType, type ScenarioTrigger,
  checkTriggerEvent, executeTriggerAction,
} from './scenario';
export { MISSIONS, getMission, getMissionIndex, loadProgress, saveProgress } from './scenario';
export type { MissionInfo } from './scenario';

export type GameState = 'loading' | 'playing' | 'won' | 'lost' | 'paused';

export class Game {
  // Core systems
  assets: AssetManager;
  camera: Camera;
  input: InputManager;
  map: GameMap;
  renderer: Renderer;

  // Game state
  entities: Entity[] = [];
  entityById = new Map<number, Entity>();
  selectedIds = new Set<number>();
  effects: Effect[] = [];
  state: GameState = 'loading';
  tick = 0;
  missionName = '';
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

    // Load sprite sheets
    await this.assets.loadAll((loaded, total) => {
      this.onLoadProgress?.(loaded, total);
    });

    // Load scenario
    const { map, entities, name, waypoints, teamTypes, triggers } = await loadScenario(scenarioId);
    this.map = map;
    this.entities = entities;
    this.entityById.clear();
    for (const e of entities) this.entityById.set(e.id, e);
    this.missionName = name;
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
  }

  /** Main game loop — uses setTimeout fallback when RAF is throttled */
  private gameLoop = (): void => {
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

    // Update camera scrolling
    this.camera.keyScroll(this.input.state.keys);
    this.camera.edgeScroll(this.input.state.mouseX, this.input.state.mouseY, this.input.state.mouseActive);

    // Update fog of war
    this.updateFogOfWar();

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

  /** Process player input — selection and commands */
  private processInput(): void {
    const { leftClick, rightClick, dragBox } = this.input.state;

    if (leftClick) {
      const world = this.camera.screenToWorld(leftClick.x, leftClick.y);
      const clicked = this.findEntityAt(world);

      if (clicked && clicked.isPlayerUnit) {
        this.selectedIds.clear();
        for (const e of this.entities) e.selected = false;
        this.selectedIds.add(clicked.id);
        clicked.selected = true;
      } else {
        for (const e of this.entities) e.selected = false;
        this.selectedIds.clear();
      }
    }

    if (dragBox) {
      this.selectedIds.clear();
      for (const e of this.entities) {
        e.selected = false;
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

      for (const id of this.selectedIds) {
        const unit = this.entityById.get(id);
        if (!unit || !unit.alive) continue;

        if (target && !target.isPlayerUnit && target.alive) {
          unit.mission = Mission.ATTACK;
          unit.target = target;
          unit.moveTarget = null;
        } else {
          unit.mission = Mission.MOVE;
          unit.moveTarget = { x: world.x, y: world.y };
          unit.target = null;
          unit.path = findPath(
            this.map,
            unit.cell,
            worldToCell(world.x, world.y),
            true
          );
          unit.pathIndex = 0;
        }
      }
    }
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
    // Ant AI: HUNT behavior (rate-limited to every 8 ticks)
    if (entity.isAnt && entity.mission !== Mission.DIE) {
      if (this.tick - entity.lastAIScan >= 8) {
        entity.lastAIScan = this.tick;
        this.updateAntAI(entity);
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

  /** Ant AI — continuously hunt nearest player unit */
  private updateAntAI(entity: Entity): void {
    if (entity.mission === Mission.ATTACK && entity.target?.alive) return;

    let nearest: Entity | null = null;
    let nearestDist = Infinity;

    for (const other of this.entities) {
      if (!other.alive || !other.isPlayerUnit) continue;
      const dist = worldDist(entity.pos, other.pos);
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
      entity.facing = directionTo(entity.pos, entity.target.pos);
      entity.animState = AnimState.ATTACK;

      if (entity.attackCooldown <= 0 && entity.weapon) {
        const killed = entity.target.takeDamage(entity.weapon.damage);
        entity.attackCooldown = entity.weapon.rof;

        // Spawn attack effect at target using sprite sheets
        const tx = entity.target.pos.x;
        const ty = entity.target.pos.y;
        if (entity.isAnt && entity.type === 'ANT3') {
          this.effects.push({ type: 'tesla', x: tx, y: ty, frame: 0, maxFrames: 8, size: 12,
            sprite: 'piffpiff', spriteStart: 0 });
        } else if (entity.isAnt) {
          this.effects.push({ type: 'blood', x: tx, y: ty, frame: 0, maxFrames: 8, size: 6,
            sprite: 'piffpiff', spriteStart: 0 });
        } else {
          this.effects.push({ type: 'muzzle', x: entity.pos.x, y: entity.pos.y, frame: 0, maxFrames: 4, size: 5,
            sprite: 'piff', spriteStart: 0 });
          this.effects.push({ type: 'explosion', x: tx, y: ty, frame: 0, maxFrames: 17, size: 8,
            sprite: 'veh-hit1', spriteStart: 0 });
        }

        if (killed) {
          this.effects.push({ type: 'explosion', x: tx, y: ty, frame: 0, maxFrames: 18, size: 16,
            sprite: 'fball1', spriteStart: 0 });
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
      entity.mission = Mission.GUARD;
      return;
    }

    if (entity.inRange(entity.target)) {
      entity.mission = Mission.ATTACK;
      this.updateAttack(entity);
    } else {
      entity.animState = AnimState.WALK;
      entity.moveToward(entity.target.pos, entity.stats.speed * 0.5);
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

  /** Process trigger system — check conditions and fire actions */
  private processTriggers(): void {
    for (const trigger of this.triggers) {
      // Volatile (0) and semi-persistent (1): skip once fired
      // Persistent (2): allowed to re-fire after timer reset
      if (trigger.fired && trigger.persistence <= 1) continue;

      // Check event conditions
      const e1Met = checkTriggerEvent(trigger.event1, this.tick, this.globals, trigger.timerTick);
      const e2Met = checkTriggerEvent(trigger.event2, this.tick, this.globals, trigger.timerTick);

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
    this.renderer.render(
      this.camera,
      this.map,
      this.entities,
      this.assets,
      this.input.state,
      this.selectedIds,
      this.effects,
      this.tick,
    );
  }
}
