/**
 * OracleStrategy: Rule-based strategy for playing Red Alert missions.
 *
 * Observe → Decide → Act loop:
 * - Idle units attack-move toward nearest enemy
 * - Injured units retreat toward base
 * - If no enemies visible, explore the map
 * - If structures + credits, produce E1 infantry
 * - Detect game over (no units + no structures) / victory (no enemies after exploring)
 */

import type { RAGameState, RAEntity, RAStructure } from './WasmAdapter.js';

export interface OracleDecision {
  commands: Array<Record<string, unknown>>;
  reason: string;
}

export type OracleResult = 'playing' | 'victory' | 'defeat' | 'timeout';

// Mission enum values from C++ (MISSION_*)
const MISSION_SLEEP = 0;
const MISSION_GUARD = 5;
const MISSION_GUARD_AREA = 18;

// HP threshold for retreat (fraction of max HP)
const RETREAT_HP_FRACTION = 0.3;

// Exploration waypoints — spiral pattern covering 64x64 cell map
const EXPLORE_WAYPOINTS = [
  { cx: 32, cy: 32 },
  { cx: 10, cy: 10 },
  { cx: 54, cy: 10 },
  { cx: 54, cy: 54 },
  { cx: 10, cy: 54 },
  { cx: 32, cy: 10 },
  { cx: 54, cy: 32 },
  { cx: 32, cy: 54 },
  { cx: 10, cy: 32 },
  { cx: 20, cy: 20 },
  { cx: 44, cy: 20 },
  { cx: 44, cy: 44 },
  { cx: 20, cy: 44 },
];

export class OracleStrategy {
  private exploreIndex = 0;
  private ticksSinceLastEnemy = 0;
  private lastEnemyCount = 0;
  private peakUnits = 0;
  private peakStructures = 0;

  decide(state: RAGameState): OracleDecision {
    const commands: Array<Record<string, unknown>> = [];
    const reasons: string[] = [];

    // Track peaks for game-over detection
    this.peakUnits = Math.max(this.peakUnits, state.units.length);
    this.peakStructures = Math.max(this.peakStructures, state.structures.length);

    // Track enemy visibility for exploration
    if (state.enemies.length > 0) {
      this.ticksSinceLastEnemy = 0;
      this.lastEnemyCount = state.enemies.length;
    } else {
      this.ticksSinceLastEnemy += 30; // approximate ticks per step
    }

    // 1. Injured units retreat toward base
    const injured = state.units.filter(
      (u) => u.hp / u.mhp < RETREAT_HP_FRACTION && u.hp > 0,
    );
    if (injured.length > 0 && state.structures.length > 0) {
      const base = this.findBase(state.structures);
      commands.push({
        cmd: 'move',
        ids: injured.map((u) => u.id),
        cx: base.cx,
        cy: base.cy,
      });
      reasons.push(`retreat ${injured.length} injured`);
    }

    const healthy = state.units.filter(
      (u) => u.hp / u.mhp >= RETREAT_HP_FRACTION,
    );

    // 2. If enemies visible, attack-move idle units toward nearest enemy
    if (state.enemies.length > 0 && healthy.length > 0) {
      const idle = healthy.filter((u) => this.isIdle(u));
      if (idle.length > 0) {
        const target = this.nearestEnemy(idle[0], state.enemies);
        commands.push({
          cmd: 'attack_move',
          ids: idle.map((u) => u.id),
          cx: target.cx,
          cy: target.cy,
        });
        reasons.push(`attack ${idle.length} → (${target.cx},${target.cy})`);
      }
    }

    // 3. No enemies visible — explore
    if (state.enemies.length === 0 && healthy.length > 0) {
      const idle = healthy.filter((u) => this.isIdle(u));
      // Also send exploring units if they've been idle too long
      if (idle.length > 0 || this.ticksSinceLastEnemy > 300) {
        const explorers = idle.length > 0 ? idle : healthy;
        const wp = EXPLORE_WAYPOINTS[this.exploreIndex % EXPLORE_WAYPOINTS.length];
        commands.push({
          cmd: 'attack_move',
          ids: explorers.map((u) => u.id),
          cx: wp.cx,
          cy: wp.cy,
        });
        this.exploreIndex++;
        reasons.push(`explore → (${wp.cx},${wp.cy})`);
      }
    }

    // 4. Production: one unit at a time (game only supports single production queue per type)
    if (state.production.length === 0) {
      // Prefer tanks over infantry when we can afford them
      if (state.credits >= 600) {
        const hasFactory = state.structures.some((s) => s.t === 'WEAP');
        if (hasFactory) {
          commands.push({ cmd: 'produce', type: 'LTNK' });
          reasons.push('produce LTNK');
        } else if (state.credits >= 100) {
          const hasBarracks = state.structures.some(
            (s) => s.t === 'BARR' || s.t === 'TENT',
          );
          if (hasBarracks) {
            commands.push({ cmd: 'produce', type: 'E1' });
            reasons.push('produce E1');
          }
        }
      } else if (state.credits >= 100) {
        const hasBarracks = state.structures.some(
          (s) => s.t === 'BARR' || s.t === 'TENT',
        );
        if (hasBarracks) {
          commands.push({ cmd: 'produce', type: 'E1' });
          reasons.push('produce E1');
        }
      }
    }

    return {
      commands,
      reason: reasons.join('; ') || 'waiting',
    };
  }

  /** Check if the game has ended */
  checkResult(state: RAGameState): OracleResult {
    // Defeat: no units and no structures (after game has started)
    if (
      state.units.length === 0 &&
      state.structures.length === 0 &&
      state.tick > 100 &&
      this.peakUnits > 0
    ) {
      return 'defeat';
    }

    // Victory: no enemies visible after extended exploration
    if (
      state.enemies.length === 0 &&
      state.tick > 200 &&
      this.ticksSinceLastEnemy > 3000 &&
      this.lastEnemyCount > 0 &&
      this.exploreIndex >= EXPLORE_WAYPOINTS.length
    ) {
      return 'victory';
    }

    return 'playing';
  }

  /** Format a state summary line for logging */
  summarize(state: RAGameState, iteration: number, decision: OracleDecision): string {
    const unitTypes = this.countTypes(state.units);
    const enemyTypes = this.countTypes(state.enemies);
    return (
      `[Oracle] #${iteration} tick=${state.tick} ` +
      `units=${state.units.length}(${unitTypes}) ` +
      `enemies=${state.enemies.length}(${enemyTypes}) ` +
      `structs=${state.structures.length} ` +
      `credits=${state.credits} ` +
      `power=${state.power.produced}/${state.power.consumed} ` +
      `| ${decision.reason}`
    );
  }

  private isIdle(unit: RAEntity): boolean {
    return (
      unit.m === MISSION_SLEEP ||
      unit.m === MISSION_GUARD ||
      unit.m === MISSION_GUARD_AREA
    );
  }

  private nearestEnemy(from: RAEntity, enemies: RAEntity[]): RAEntity {
    let best = enemies[0];
    let bestDist = Infinity;
    for (const e of enemies) {
      const dx = e.cx - from.cx;
      const dy = e.cy - from.cy;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    return best;
  }

  private findBase(structures: RAStructure[]): RAStructure {
    // Prefer construction yard, then any structure
    return (
      structures.find((s) => s.t === 'FACT') ||
      structures.find((s) => s.t === 'PROC') ||
      structures[0]
    );
  }

  private countTypes(entities: RAEntity[]): string {
    const counts: Record<string, number> = {};
    for (const e of entities) {
      counts[e.t] = (counts[e.t] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([t, n]) => `${n}${t}`)
      .join(',') || 'none';
  }
}
