/**
 * GameInspector — automated QA assertion engine.
 *
 * Hooks into Game.onTick. Runs 19 assertions on game state each tick.
 * Reports anomalies with severity, category, and suspected source location.
 * Deduplicates: same assertion + same entity fires at most once per 150 ticks.
 */

import { type Game } from './index';
import { Entity } from './entity';
import { Mission, UnitType, MAP_CELLS } from './types';

// === Anomaly types ===

export type AnomalySeverity = 'critical' | 'warning' | 'info';
export type AnomalyCategory = 'physics' | 'behavior' | 'combat' | 'visual' | 'economy' | 'performance';

export interface Anomaly {
  id: string;           // assertion ID (e.g. 'P1', 'B1')
  tick: number;
  severity: AnomalySeverity;
  category: AnomalyCategory;
  message: string;
  entityId?: number;
  entityType?: string;
  suspects: string;     // suspected source code location
}

// === Per-entity tracking ===

interface EntityTracker {
  lastHarvesterState: string;
  stateEnteredTick: number;
  lastHp: number;
  lastHpChangeTick: number;
  lastFacing: number;
  facingStuckTick: number;
}

// === Dedup key ===

function dedupKey(assertionId: string, entityId: number | undefined): string {
  return `${assertionId}:${entityId ?? 'global'}`;
}

const DEDUP_INTERVAL = 150; // 10 seconds at 15 FPS

export class GameInspector {
  private trackers = new Map<number, EntityTracker>();
  private lastFired = new Map<string, number>(); // dedupKey → tick

  /** Run all assertions against current game state. Returns anomalies found this tick. */
  check(game: Game): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const tick = game.tick;
    const entities = game.entities;
    const aliveEntities = entities.filter(e => e.alive);

    // Update per-entity trackers
    for (const e of aliveEntities) {
      this.ensureTracker(e, tick);
    }

    // --- Physics assertions ---
    for (const e of aliveEntities) {
      // P1: Ground unit at altitude
      if (e.flightAltitude > 0 && e.type !== UnitType.V_TRAN) {
        this.emit(anomalies, tick, 'P1', 'critical', 'physics',
          `Ground unit ${e.stats.name} (${e.id}) at altitude ${e.flightAltitude}`,
          e, 'index.ts — altitude not reset on unload');
      }

      // P2: Out of bounds
      const cell = e.cell;
      if (cell.cx < 0 || cell.cy < 0 || cell.cx >= MAP_CELLS || cell.cy >= MAP_CELLS) {
        this.emit(anomalies, tick, 'P2', 'critical', 'physics',
          `Entity ${e.stats.name} (${e.id}) out of bounds at (${cell.cx},${cell.cy})`,
          e, 'pathfinding edge case');
      }

      // P3: NaN position
      if (isNaN(e.pos.x) || isNaN(e.pos.y)) {
        this.emit(anomalies, tick, 'P3', 'critical', 'physics',
          `Entity ${e.stats.name} (${e.id}) has NaN position`,
          e, 'division by zero');
      }

    }

    // P4: Dead but moving (iterate ALL entities — dead entities may still be in the list)
    for (const e of entities) {
      if (!e.alive && e.mission !== Mission.DIE) {
        this.emit(anomalies, tick, 'P4', 'warning', 'physics',
          `Entity ${e.stats.name} (${e.id}) dead but mission=${e.mission}`,
          e, 'cleanup race');
      }
    }

    // --- Behavior assertions ---
    for (const e of aliveEntities) {
      const tracker = this.trackers.get(e.id)!;

      // Update harvester state tracking
      if (e.type === UnitType.V_HARV) {
        if (e.harvesterState !== tracker.lastHarvesterState) {
          tracker.lastHarvesterState = e.harvesterState;
          tracker.stateEnteredTick = tick;
        }
        const stuckDuration = tick - tracker.stateEnteredTick;

        // B1: Harvester stuck seeking
        if (e.harvesterState === 'seeking' && stuckDuration > 150) {
          this.emit(anomalies, tick, 'B1', 'critical', 'behavior',
            `Harvester (${e.id}) stuck seeking for ${stuckDuration} ticks`,
            e, 'index.ts:2198 — path not clearing');
        }

        // B2: Harvester stuck any state
        if (stuckDuration > 900) {
          this.emit(anomalies, tick, 'B2', 'warning', 'behavior',
            `Harvester (${e.id}) stuck in '${e.harvesterState}' for ${stuckDuration} ticks`,
            e, 'state machine deadlock');
        }
      }

      // B3: Ant rotation lock — only for slow-rotating ants (rot < 8).
      // Ants with rot >= 8 snap instantly, so same-facing is normal (target in same direction).
      if (e.isAnt && e.stats.rot < 8 && e.mission === Mission.ATTACK && e.target && e.target.alive && e.inRange(e.target)) {
        if (e.facing === tracker.lastFacing) {
          const facingStuckDur = tick - tracker.facingStuckTick;
          if (facingStuckDur > 45) {
            this.emit(anomalies, tick, 'B3', 'critical', 'behavior',
              `Ant ${e.stats.name} (${e.id}) rotation-locked for ${facingStuckDur} ticks`,
              e, 'index.ts:2549 — noMovingFire blocks attack');
          }
        } else {
          tracker.lastFacing = e.facing;
          tracker.facingStuckTick = tick;
        }
      } else {
        // Reset facing tracker when not in attack/range
        tracker.lastFacing = e.facing;
        tracker.facingStuckTick = tick;
      }

      // B4: Dead target reference
      if (e.target && !e.target.alive) {
        // Check if target has been dead for >15 ticks (approximate)
        if (e.target.deathTick > 15) {
          this.emit(anomalies, tick, 'B4', 'warning', 'behavior',
            `Entity ${e.stats.name} (${e.id}) targeting dead unit for ${e.target.deathTick} ticks`,
            e, 'target cleanup');
        }
      }

      // B5: Unit permanently idle
      if (e.weapon && e.mission === Mission.GUARD && e.isPlayerUnit) {
        const hasEnemies = aliveEntities.some(o => !o.isPlayerUnit && o.alive);
        if (hasEnemies && tick > 900) {
          // Only flag if unit has been idle since the start (crude check)
          // We use a heuristic: if guard for a very long time
          if (tracker.stateEnteredTick === 0 || (tick - tracker.stateEnteredTick > 900)) {
            this.emit(anomalies, tick, 'B5', 'info', 'behavior',
              `Armed unit ${e.stats.name} (${e.id}) idle for ${tick - tracker.stateEnteredTick} ticks with enemies present`,
              e, 'AutoPlayer gap');
          }
        }
      }
    }

    // --- Combat assertions ---
    for (const e of aliveEntities) {
      const tracker = this.trackers.get(e.id)!;

      // C1: Weapon cooldown stuck
      if (e.weapon && e.attackCooldown > e.weapon.rof * 3) {
        this.emit(anomalies, tick, 'C1', 'warning', 'combat',
          `Entity ${e.stats.name} (${e.id}) cooldown ${e.attackCooldown} > 3x rof ${e.weapon.rof}`,
          e, 'cooldown reset bug');
      }

      // C3: Invincible entity
      if (e.hp !== tracker.lastHp) {
        tracker.lastHp = e.hp;
        tracker.lastHpChangeTick = tick;
      } else if (tick - tracker.lastHpChangeTick > 300 && e.mission === Mission.ATTACK) {
        // Being attacked but HP unchanged for 300 ticks
        const isBeingTargeted = aliveEntities.some(o => o.target === e && o.mission === Mission.ATTACK);
        if (isBeingTargeted) {
          this.emit(anomalies, tick, 'C3', 'warning', 'combat',
            `Entity ${e.stats.name} (${e.id}) appears invincible — HP unchanged for 300 ticks while targeted`,
            e, 'damage calc');
        }
      }
    }

    // --- Visual assertions ---
    // V1: Effects explosion
    if (game.effects.length > 200) {
      this.emit(anomalies, tick, 'V1', 'warning', 'visual',
        `Effects count ${game.effects.length} > 200`,
        undefined, 'renderer effects leak');
    }

    // V2: Entity count explosion
    if (aliveEntities.length > 200) {
      this.emit(anomalies, tick, 'V2', 'warning', 'visual',
        `Alive entity count ${aliveEntities.length} > 200`,
        undefined, 'spawn control');
    }

    // V3: Corpse cap saturated
    if (game.corpses.length >= 100) {
      this.emit(anomalies, tick, 'V3', 'info', 'visual',
        `Corpse cap saturated at ${game.corpses.length}`,
        undefined, 'visual density');
    }

    // --- Economy assertions ---
    // E1: Negative credits
    if (game.credits < 0) {
      this.emit(anomalies, tick, 'E1', 'critical', 'economy',
        `Credits = ${game.credits} (negative)`,
        undefined, 'cost deduction bug');
    }

    // E2: Display divergence
    if (tick > 300 && Math.abs(game.credits - game.displayCredits) > 5000) {
      this.emit(anomalies, tick, 'E2', 'warning', 'economy',
        `Display credits ${game.displayCredits} diverges from actual ${game.credits} by ${Math.abs(game.credits - game.displayCredits)}`,
        undefined, 'counter animation');
    }

    // --- Performance assertions ---
    // F2: Path saturation
    const movingWithNoPath = aliveEntities.filter(e =>
      e.mission === Mission.MOVE && e.path.length === 0
    ).length;
    if (aliveEntities.length > 0 && movingWithNoPath / aliveEntities.length > 0.5) {
      this.emit(anomalies, tick, 'F2', 'warning', 'performance',
        `${movingWithNoPath}/${aliveEntities.length} entities have MOVE mission with empty path`,
        undefined, 'pathfinding failure');
    }

    // Clean up trackers for dead entities periodically
    if (tick % 150 === 0) {
      const aliveIds = new Set(aliveEntities.map(e => e.id));
      for (const [id] of this.trackers) {
        if (!aliveIds.has(id)) this.trackers.delete(id);
      }
      // Clean up old dedup entries
      for (const [key, lastTick] of this.lastFired) {
        if (tick - lastTick > DEDUP_INTERVAL * 2) this.lastFired.delete(key);
      }
    }

    return anomalies;
  }

  /** Check a tick duration (called by QATestRunner with wall-clock measurement) */
  checkTickDuration(tick: number, durationMs: number): Anomaly | null {
    if (durationMs > 100) {
      const key = dedupKey('F1', undefined);
      const last = this.lastFired.get(key);
      if (last !== undefined && tick - last < DEDUP_INTERVAL) return null;
      this.lastFired.set(key, tick);
      return {
        id: 'F1', tick, severity: 'warning', category: 'performance',
        message: `Tick ${tick} took ${durationMs.toFixed(1)}ms (>100ms)`,
        suspects: 'pathfinding O(n^2)',
      };
    }
    return null;
  }

  /** Reset state for a new mission */
  reset(): void {
    this.trackers.clear();
    this.lastFired.clear();
  }

  private ensureTracker(e: Entity, tick: number): void {
    if (this.trackers.has(e.id)) return;
    this.trackers.set(e.id, {
      lastHarvesterState: e.harvesterState,
      stateEnteredTick: tick,
      lastHp: e.hp,
      lastHpChangeTick: tick,
      lastFacing: e.facing,
      facingStuckTick: tick,
    });
  }

  private emit(
    anomalies: Anomaly[], tick: number,
    id: string, severity: AnomalySeverity, category: AnomalyCategory,
    message: string, entity: Entity | undefined, suspects: string,
  ): void {
    const key = dedupKey(id, entity?.id);
    const last = this.lastFired.get(key);
    if (last !== undefined && tick - last < DEDUP_INTERVAL) return;
    this.lastFired.set(key, tick);

    anomalies.push({
      id, tick, severity, category, message,
      entityId: entity?.id,
      entityType: entity?.type,
      suspects,
    });
  }
}
