/**
 * Harvester economy subsystem — ore seeking, harvesting, refinery return, and unloading.
 * Extracted from Game class (engine/index.ts) into pure + context-based functions.
 */

import {
  CELL_SIZE, MAP_CELLS,
  type House, Mission, AnimState, UnitType,
} from './types';
import { Entity } from './entity';
import { type MapStructure, STRUCTURE_SIZE } from './scenario';
import { type GameMap } from './map';
import { findPath } from './pathfinding';

// ---------------------------------------------------------------------------
// Context interface — minimal fields needed by harvester functions
// ---------------------------------------------------------------------------

export interface HarvesterContext {
  entities: Entity[];
  structures: MapStructure[];
  houseCredits: Map<House, number>;
  map: GameMap;

  // Callbacks
  isAllied(a: House, b: House): boolean;
  isPlayerControlled(e: Entity): boolean;
  playSound(name: string): void;
  addCredits(amount: number): void;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Check if a mission is an idle/arrival mission (GUARD or AREA_GUARD) */
function isIdleMission(mission: Mission): boolean {
  return mission === Mission.GUARD || mission === Mission.AREA_GUARD;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/** Find nearest ore for a harvester, with spread logic for AI harvesters.
 *  C++ parity: AI harvesters avoid ore cells that another friendly harvester is already targeting,
 *  preventing all AI harvesters from clustering on the same ore patch. */
export function findHarvesterOre(
  ctx: HarvesterContext, entity: Entity, cx: number, cy: number, maxRange: number,
): { cx: number; cy: number } | null {
  // Player harvesters use simple nearest-ore (no spreading needed — player manages them)
  if (ctx.isPlayerControlled(entity)) {
    return ctx.map.findNearestOre(cx, cy, maxRange);
  }

  // Build set of cells targeted by other friendly harvesters (within 2-cell radius counts as same patch)
  const friendlyTargets: { cx: number; cy: number }[] = [];
  for (const other of ctx.entities) {
    if (other === entity || !other.alive || other.house !== entity.house) continue;
    if (other.type !== UnitType.V_HARV) continue;
    if (other.moveTarget) {
      friendlyTargets.push({
        cx: Math.floor(other.moveTarget.x / CELL_SIZE),
        cy: Math.floor(other.moveTarget.y / CELL_SIZE),
      });
    } else if (other.harvesterState === 'harvesting') {
      friendlyTargets.push(other.cell);
    }
  }

  // Search for nearest ore that isn't within 3 cells of another harvester's target
  let bestDist = Infinity;
  let best: { cx: number; cy: number } | null = null;
  const r = maxRange;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const rx = cx + dx;
      const ry = cy + dy;
      if (rx < 0 || rx >= MAP_CELLS || ry < 0 || ry >= MAP_CELLS) continue;
      const ovl = ctx.map.overlay[ry * MAP_CELLS + rx];
      if (ovl < 0x03 || ovl > 0x12) continue; // not ore
      const dist = dx * dx + dy * dy;
      if (dist >= bestDist) continue;

      // Check if another friendly harvester is already targeting nearby
      let isTargeted = false;
      for (const ft of friendlyTargets) {
        const tdx = Math.abs(ft.cx - rx);
        const tdy = Math.abs(ft.cy - ry);
        if (tdx <= 3 && tdy <= 3) { isTargeted = true; break; }
      }
      if (isTargeted) continue;

      bestDist = dist;
      best = { cx: rx, cy: ry };
    }
  }

  // Fallback: if all ore is targeted, just use nearest ore (better than doing nothing)
  if (!best) {
    return ctx.map.findNearestOre(cx, cy, maxRange);
  }
  return best;
}

/** Harvester AI — seek ore, harvest, return to refinery, unload */
export function updateHarvester(ctx: HarvesterContext, entity: Entity): void {
  switch (entity.harvesterState) {
    case 'idle': {
      // Only start auto-harvest from idle mission (GUARD/AREA_GUARD), not during manual MOVE
      if (!isIdleMission(entity.mission)) break;
      // Find nearest ore cell — AI harvesters spread to avoid clustering
      const ec = entity.cell;
      const oreCell = findHarvesterOre(ctx, entity, ec.cx, ec.cy, 30);
      if (oreCell) {
        entity.harvesterState = 'seeking';
        entity.mission = Mission.MOVE;
        entity.moveTarget = { x: oreCell.cx * CELL_SIZE + CELL_SIZE / 2, y: oreCell.cy * CELL_SIZE + CELL_SIZE / 2 };
        entity.path = findPath(ctx.map, ec, oreCell, true);
        entity.pathIndex = 0;
      }
      break;
    }
    case 'seeking': {
      // Check if we've arrived at ore
      const ec = entity.cell;
      const ovl = ctx.map.overlay[ec.cy * MAP_CELLS + ec.cx];
      if (ovl >= 0x03 && ovl <= 0x12) {
        entity.harvesterState = 'harvesting';
        entity.harvestTick = 0;
        entity.mission = Mission.GUARD;
        entity.animState = AnimState.IDLE;
      } else if (isIdleMission(entity.mission)) {
        // Arrived (move completed → GUARD/AREA_GUARD) but no ore here — re-seek
        entity.harvesterState = 'idle';
      } else if (entity.mission === Mission.MOVE && entity.path.length === 0 && entity.pathIndex >= 0) {
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
        const bailCredits = ctx.map.depleteOre(ec.cx, ec.cy);
        if (bailCredits > 0) {
          // EC3: bail-based capacity — track bail count, not credit amount
          entity.oreLoad += 1;
          entity.oreCreditValue += bailCredits;
          // EC4: gem bonus bails — C++ unit.cpp:2306-2308, 2 extra bails per gem harvest
          if (bailCredits >= 110) {
            entity.oreLoad += 2;
            entity.oreCreditValue += 220; // 2 bonus bails × 110 credits
          }
        }
        // Check if full or current cell depleted
        if (entity.oreLoad >= Entity.BAIL_COUNT) {
          entity.harvesterState = 'returning';
        } else if (bailCredits === 0) {
          // No more ore at this cell — look for adjacent ore
          const newOre = ctx.map.findNearestOre(ec.cx, ec.cy, 20);
          if (newOre && entity.oreLoad < Entity.BAIL_COUNT) {
            entity.harvesterState = 'seeking';
            entity.mission = Mission.MOVE;
            entity.moveTarget = { x: newOre.cx * CELL_SIZE + CELL_SIZE / 2, y: newOre.cy * CELL_SIZE + CELL_SIZE / 2 };
            entity.path = findPath(ctx.map, ec, newOre, true);
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
      // When move completes (mission returns to GUARD/AREA_GUARD), transition to unloading or re-seek
      if (!isIdleMission(entity.mission)) break; // still moving, wait
      // Check if we're near a refinery
      const ec = entity.cell;
      let bestProc: MapStructure | null = null;
      let bestDist = Infinity;
      for (const s of ctx.structures) {
        if (!s.alive || s.type !== 'PROC') continue;
        if (!ctx.isAllied(s.house, entity.house)) continue;
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
        entity.path = findPath(ctx.map, ec, target, true);
        entity.pathIndex = 0;
        entity.harvestTick = 0;
      }
      break;
    }
    case 'unloading': {
      // EC5: lump-sum unload after 14-tick dump animation (C++ parity)
      entity.harvestTick++;
      // Credit sound every 5 ticks during dump animation
      if (entity.harvestTick % 5 === 0 && ctx.isPlayerControlled(entity)) {
        ctx.playSound('heal');
      }
      if (entity.harvestTick >= 14) {
        // Dump all credits at once after animation completes
        const totalCredits = entity.oreCreditValue;
        if (totalCredits > 0) {
          if (ctx.isPlayerControlled(entity)) {
            ctx.addCredits(totalCredits);
          } else {
            // AI harvester — deposit into houseCredits
            const cur = ctx.houseCredits.get(entity.house) ?? 0;
            ctx.houseCredits.set(entity.house, cur + totalCredits);
          }
        }
        entity.oreLoad = 0;
        entity.oreCreditValue = 0;
        entity.harvesterState = 'idle';
        entity.harvestTick = 0;
      }
      break;
    }
  }
}
