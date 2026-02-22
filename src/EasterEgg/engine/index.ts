/**
 * Main game loop — ties all engine systems together.
 * Fixed timestep at 15 FPS (matching original Red Alert game speed).
 */

import {
  type WorldPos, CELL_SIZE, GAME_TICKS_PER_SEC,
  Mission, AnimState, worldDist, directionTo, worldToCell,
  PLAYER_HOUSES, ANT_HOUSES,
} from './types';
import { AssetManager } from './assets';
import { Camera } from './camera';
import { InputManager } from './input';
import { Entity } from './entity';
import { GameMap } from './map';
import { Renderer } from './renderer';
import { findPath } from './pathfinding';
import { loadScenario } from './scenario';

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
  selectedIds = new Set<number>();
  state: GameState = 'loading';
  tick = 0;
  missionName = '';

  // Callbacks
  onStateChange?: (state: GameState) => void;
  onLoadProgress?: (loaded: number, total: number) => void;

  // Internal
  private canvas: HTMLCanvasElement;
  private animFrameId = 0;
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
    this.onStateChange?.('loading');

    // Load sprite sheets
    await this.assets.loadAll((loaded, total) => {
      this.onLoadProgress?.(loaded, total);
    });

    // Load scenario
    const { map, entities, name, waypoints } = await loadScenario(scenarioId);
    this.map = map;
    this.entities = entities;
    this.missionName = name;

    // Center camera on player start (waypoint 98 = player start in ant missions)
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

    this.state = 'playing';
    this.onStateChange?.('playing');
    this.lastTime = performance.now();
    this.gameLoop(this.lastTime);
  }

  /** Stop the game */
  stop(): void {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    this.animFrameId = 0;
    this.input.destroy();
  }

  /** Main game loop */
  private gameLoop = (time: number): void => {
    this.animFrameId = requestAnimationFrame(this.gameLoop);

    const dt = time - this.lastTime;
    this.lastTime = time;
    // Cap accumulator to prevent spiral of death on first frame or after pause
    this.accumulator += Math.min(dt, 200);

    // Fixed timestep updates
    while (this.accumulator >= this.tickInterval) {
      this.accumulator -= this.tickInterval;
      if (this.state === 'playing') {
        this.update();
      }
    }

    // Render every frame (not just on tick)
    this.render();
    this.input.clearEvents();
  };

  /** Fixed-timestep game update */
  private update(): void {
    this.tick++;

    // Process input
    this.processInput();

    // Update camera scrolling
    this.camera.keyScroll(this.input.state.keys);
    this.camera.edgeScroll(this.input.state.mouseX, this.input.state.mouseY);

    // Update all entities
    for (const entity of this.entities) {
      if (!entity.alive) {
        entity.tickAnimation();
        continue;
      }
      this.updateEntity(entity);
    }

    // Clean up dead entities after death animation
    this.entities = this.entities.filter(
      e => e.alive || e.animFrame < 15
    );

    // Check win/lose conditions
    this.checkVictoryConditions();
  }

  /** Process player input — selection and commands */
  private processInput(): void {
    const { leftClick, rightClick, dragBox } = this.input.state;

    // Left click = select unit
    if (leftClick) {
      const world = this.camera.screenToWorld(leftClick.x, leftClick.y);
      const clicked = this.findEntityAt(world);

      if (clicked && clicked.isPlayerUnit) {
        this.selectedIds.clear();
        this.selectedIds.add(clicked.id);
        clicked.selected = true;
      } else {
        // Deselect all
        for (const e of this.entities) e.selected = false;
        this.selectedIds.clear();
      }
    }

    // Drag box = select multiple units
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

    // Right click = command selected units
    if (rightClick) {
      const world = this.camera.screenToWorld(rightClick.x, rightClick.y);
      const target = this.findEntityAt(world);

      for (const id of this.selectedIds) {
        const unit = this.entities.find(e => e.id === id);
        if (!unit || !unit.alive) continue;

        if (target && !target.isPlayerUnit && target.alive) {
          // Attack command
          unit.mission = Mission.ATTACK;
          unit.target = target;
          unit.moveTarget = null;
        } else {
          // Move command
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
    let closestDist = 20; // pick radius in pixels

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
    // Ant AI: HUNT behavior
    if (entity.isAnt && entity.mission !== Mission.DIE) {
      this.updateAntAI(entity);
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
    // Already attacking? Keep at it
    if (entity.mission === Mission.ATTACK && entity.target?.alive) return;

    // Find nearest player unit
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

    // Follow path
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

    const dist = worldDist(entity.pos, entity.target.pos);

    if (entity.inRange(entity.target)) {
      // In range — face target and fire
      entity.facing = directionTo(entity.pos, entity.target.pos);
      entity.animState = AnimState.ATTACK;

      if (entity.attackCooldown <= 0 && entity.weapon) {
        entity.target.takeDamage(entity.weapon.damage);
        entity.attackCooldown = entity.weapon.rof;
      }
    } else {
      // Move toward target
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

    // Same as attack but repath periodically
    if (entity.inRange(entity.target)) {
      entity.mission = Mission.ATTACK;
      this.updateAttack(entity);
    } else {
      entity.animState = AnimState.WALK;
      entity.moveToward(entity.target.pos, entity.stats.speed * 0.5);
    }
  }

  /** Guard mode — attack nearby enemies */
  private updateGuard(entity: Entity): void {
    entity.animState = AnimState.IDLE;

    // Auto-attack nearby enemies
    const isPlayer = entity.isPlayerUnit;
    for (const other of this.entities) {
      if (!other.alive) continue;
      if (isPlayer === other.isPlayerUnit) continue; // skip allies
      const dist = worldDist(entity.pos, other.pos);
      if (dist < (entity.stats.sight * CELL_SIZE)) {
        entity.mission = Mission.ATTACK;
        entity.target = other;
        break;
      }
    }
  }

  /** Check win/lose conditions (grace period: first 3 seconds are safe) */
  private checkVictoryConditions(): void {
    if (this.tick < GAME_TICKS_PER_SEC * 3) return; // 3-second grace period

    const playerAlive = this.entities.some(e => e.alive && e.isPlayerUnit);
    const antsAlive = this.entities.some(e => e.alive && e.isAnt);

    if (!playerAlive) {
      this.state = 'lost';
      this.onStateChange?.('lost');
    } else if (!antsAlive) {
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
    );
  }
}
