/**
 * AutoPlayer — bot AI that plays ant missions to completion.
 *
 * Two layers:
 * - Reactive (every tick): armed GUARD-mode units auto-engage enemies in aggro range
 * - Strategic (every 15 ticks): focus-fire nearest enemy with all idle/guard units
 *
 * Uses the same entity mutation pattern as processInput():
 * sets entity.mission, entity.target, entity.moveTarget, entity.path, entity.pathIndex.
 */

import { type Game } from './index';
import { type Entity } from './entity';
import { Mission, worldDist, worldToCell } from './types';
import { findPath } from './pathfinding';

const AGGRO_RANGE = 12;        // cells — reactive engagement range
const STRATEGIC_INTERVAL = 15; // ticks between strategic scans
const MAX_PATHS_PER_TICK = 5;  // cap pathfinding calls per strategic scan

export class AutoPlayer {
  private lastStrategicTick = 0;

  /** Called every game tick via game.onTick */
  update(game: Game): void {
    this.reactiveLayer(game);

    if (game.tick - this.lastStrategicTick >= STRATEGIC_INTERVAL) {
      this.lastStrategicTick = game.tick;
      this.strategicLayer(game);
    }
  }

  /** Reactive: GUARD-mode armed units engage nearest enemy in aggro range */
  private reactiveLayer(game: Game): void {
    for (const unit of game.entities) {
      if (!unit.alive || !unit.isPlayerUnit || !unit.weapon) continue;
      if (unit.mission !== Mission.GUARD) continue;

      let nearest: Entity | null = null;
      let nearestDist = AGGRO_RANGE;

      for (const enemy of game.entities) {
        if (!enemy.alive || enemy.isPlayerUnit) continue;
        const dist = worldDist(unit.pos, enemy.pos);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = enemy;
        }
      }

      if (nearest) {
        unit.mission = Mission.ATTACK;
        unit.target = nearest;
      }
    }
  }

  /** Strategic: focus-fire — find nearest enemy to army centroid, assign all idle units */
  private strategicLayer(game: Game): void {
    const armed = game.entities.filter(
      e => e.alive && e.isPlayerUnit && e.weapon
    );
    if (armed.length === 0) return;

    const enemies = game.entities.filter(e => e.alive && e.isAnt);
    if (enemies.length === 0) return;

    // Compute army centroid
    let cx = 0, cy = 0;
    for (const u of armed) {
      cx += u.pos.x;
      cy += u.pos.y;
    }
    cx /= armed.length;
    cy /= armed.length;

    // Find nearest enemy to centroid
    let target: Entity | null = null;
    let targetDist = Infinity;
    for (const e of enemies) {
      const dx = e.pos.x - cx;
      const dy = e.pos.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < targetDist) {
        targetDist = dist;
        target = e;
      }
    }
    if (!target) return;

    // Assign idle/guard units to attack or move toward target
    let pathsComputed = 0;
    for (const unit of armed) {
      if (unit.mission === Mission.ATTACK && unit.target?.alive) continue;

      if (unit.inRange(target)) {
        unit.mission = Mission.ATTACK;
        unit.target = target;
      } else if (pathsComputed < MAX_PATHS_PER_TICK) {
        unit.mission = Mission.MOVE;
        unit.target = null;
        unit.moveTarget = { x: target.pos.x, y: target.pos.y };
        unit.path = findPath(
          game.map,
          unit.cell,
          worldToCell(target.pos.x, target.pos.y),
          true,
        );
        unit.pathIndex = 0;
        pathsComputed++;
      }
    }
  }
}
