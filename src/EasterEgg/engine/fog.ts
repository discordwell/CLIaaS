/**
 * Fog of war subsystem — visibility, sub detection, and gap generators.
 * Extracted from the Game class to keep the main file focused.
 */

import {
  CELL_SIZE, MAP_CELLS, CONDITION_RED,
  House, worldDist,
} from './types';
import { type Entity, CloakState, CLOAK_TRANSITION_FRAMES, SONAR_PULSE_DURATION } from './entity';
import { type MapStructure, STRUCTURE_SIZE } from './scenario';
import { type GameMap } from './map';

// ---------------------------------------------------------------------------
// Constants (moved from Game class static members)
// ---------------------------------------------------------------------------

export const GAP_RADIUS = 10;
export const GAP_UPDATE_INTERVAL = 90;
export const DEFENSE_TYPES = new Set(['HBOX', 'GUN', 'TSLA', 'SAM', 'PBOX', 'GAP', 'AGUN']);

// ---------------------------------------------------------------------------
// Context interface — thin view into the Game class
// ---------------------------------------------------------------------------

export interface FogContext {
  entities: Entity[];
  structures: MapStructure[];
  map: GameMap;
  tick: number;
  playerHouse: House;
  fogDisabled: boolean;
  powerProduced: number;
  powerConsumed: number;
  gapGeneratorCells: Map<number, { cx: number; cy: number; radius: number }>;

  // Callbacks
  isAllied(a: House, b: House): boolean;
  entitiesAllied(a: Entity, b: Entity): boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Recalculate fog-of-war visibility for all player units and structures.
 * Units at CONDITION_RED health have their sight reduced to 1.
 */
export function updateFogOfWar(ctx: FogContext): void {
  if (ctx.fogDisabled) {
    ctx.map.revealAll();
    return;
  }

  const units: Array<{ x: number; y: number; sight: number }> = [];

  for (const e of ctx.entities) {
    if (e.alive && e.isPlayerUnit) {
      const sight = (e.hp / e.maxHp) < CONDITION_RED ? 1 : e.stats.sight;
      units.push({ x: e.pos.x, y: e.pos.y, sight });
    }
  }

  for (const s of ctx.structures) {
    if (s.alive && ctx.isAllied(s.house, ctx.playerHouse)) {
      const baseSight = DEFENSE_TYPES.has(s.type) ? 7 : 5;
      const sight = (s.hp / s.maxHp) < CONDITION_RED ? 1 : baseSight;
      const wx = s.cx * CELL_SIZE + CELL_SIZE / 2;
      const wy = s.cy * CELL_SIZE + CELL_SIZE / 2;
      units.push({ x: wx, y: wy, sight });
    }
  }

  ctx.map.updateFogOfWar(units);
  updateSubDetection(ctx);
}

/**
 * Detect submerged/cloaked units within sonar range of anti-sub units.
 * Detected subs are forced into the UNCLOAKING state.
 */
export function updateSubDetection(ctx: FogContext): void {
  for (const dd of ctx.entities) {
    if (!dd.alive || !dd.stats.isAntiSub) continue;
    const sight = dd.stats.sight;

    for (const sub of ctx.entities) {
      if (!sub.alive || !sub.stats.isCloakable) continue;
      if (ctx.entitiesAllied(dd, sub)) continue;
      if (sub.cloakState !== CloakState.CLOAKED && sub.cloakState !== CloakState.CLOAKING) continue;

      const dist = worldDist(dd.pos, sub.pos);
      if (dist <= sight) {
        sub.sonarPulseTimer = SONAR_PULSE_DURATION;
        if (sub.cloakState === CloakState.CLOAKED || sub.cloakState === CloakState.CLOAKING) {
          sub.cloakState = CloakState.UNCLOAKING;
          sub.cloakTimer = CLOAK_TRANSITION_FRAMES;
        }
      }
    }
  }
}

/**
 * Reveal all cells within a circular radius around the given cell.
 * Pure function — only needs the map instance.
 */
export function revealAroundCell(map: GameMap, cx: number, cy: number, radius: number): void {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= r2) {
        const rx = cx + dx;
        const ry = cy + dy;
        if (rx >= 0 && rx < MAP_CELLS && ry >= 0 && ry < MAP_CELLS) {
          map.setVisibility(rx, ry, 2);
        }
      }
    }
  }
}

/**
 * Update gap generator jamming — runs every GAP_UPDATE_INTERVAL ticks.
 * When powered, gap generators jam visibility around themselves.
 * When unpowered (or destroyed), jamming is removed.
 */
export function updateGapGenerators(ctx: FogContext): void {
  if (ctx.tick % GAP_UPDATE_INTERVAL !== 0) return;

  const pf = ctx.powerProduced > 0
    ? ctx.powerProduced / Math.max(ctx.powerConsumed, 1)
    : 0;

  const activeGaps = new Set<number>();

  for (let si = 0; si < ctx.structures.length; si++) {
    const s = ctx.structures[si];
    if (s.type !== 'GAP' || !s.alive) continue;

    if (pf < 1.0) {
      if (ctx.gapGeneratorCells.has(si)) {
        const prev = ctx.gapGeneratorCells.get(si)!;
        ctx.map.unjamRadius(prev.cx, prev.cy, prev.radius);
        ctx.gapGeneratorCells.delete(si);
      }
      continue;
    }

    activeGaps.add(si);
    if (ctx.gapGeneratorCells.has(si)) continue;

    const [gw, gh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
    const cx = s.cx + Math.floor(gw / 2);
    const cy = s.cy + Math.floor(gh / 2);
    const r = GAP_RADIUS;
    const r2 = r * r;

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r2) {
          ctx.map.jamCell(cx + dx, cy + dy);
        }
      }
    }

    ctx.gapGeneratorCells.set(si, { cx, cy, radius: r });
  }

  for (const [si, prev] of ctx.gapGeneratorCells) {
    if (!activeGaps.has(si)) {
      ctx.map.unjamRadius(prev.cx, prev.cy, prev.radius);
      ctx.gapGeneratorCells.delete(si);
    }
  }
}
