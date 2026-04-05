/**
 * Harvester economy subsystem — ore seeking, harvesting, refinery return, and unloading.
 * Extracted from Game class (engine/index.ts) into pure + context-based functions.
 */

import {
  CELL_SIZE, MAP_CELLS,
  type House, Mission, AnimState, UnitType, Dir,
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
  return mission === Mission.GUARD || mission === Mission.AREA_GUARD || mission === Mission.HARVEST;
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

  // C++ ring search with anti-clustering: scan expanding ring perimeters,
  // skip ore cells within 5 cells of another harvester's target.
  // Returns first valid untargeted cell found on any ring perimeter.
  const r = maxRange;

  // Helper to check ore and anti-clustering at a cell
  const checkCell = (rx: number, ry: number): { cx: number; cy: number } | null => {
    if (rx < 0 || rx >= MAP_CELLS || ry < 0 || ry >= MAP_CELLS) return null;
    const ovl = ctx.map.overlay[ry * MAP_CELLS + rx];
    if (ovl < 0x03 || ovl > 0x12) return null; // not ore
    for (const ft of friendlyTargets) {
      const tdx = Math.abs(ft.cx - rx);
      const tdy = Math.abs(ft.cy - ry);
      if (tdx <= 5 && tdy <= 5) return null; // targeted by another harvester
    }
    return { cx: rx, cy: ry };
  };

  // Check center cell first
  const center = checkCell(cx, cy);
  if (center) return center;

  // Ring search — expanding perimeters
  for (let radius = 1; radius <= r; radius++) {
    for (let x = -radius; x <= radius; x++) {
      const hit = checkCell(cx + x, cy - radius) ?? checkCell(cx + x, cy + radius);
      if (hit) return hit;
    }
    for (let y = -radius + 1; y <= radius - 1; y++) {
      const hit = checkCell(cx - radius, cy + y) ?? checkCell(cx + radius, cy + y);
      if (hit) return hit;
    }
  }

  // Fallback: if all ore is targeted, just use nearest ore (better than doing nothing)
  return ctx.map.findNearestOre(cx, cy, maxRange);
}

/** Harvester AI — seek ore, harvest, return to refinery, unload */
export function updateHarvester(ctx: HarvesterContext, entity: Entity): void {
  switch (entity.harvesterState) {
    case 'idle': {
      // Only start auto-harvest from idle mission (GUARD/AREA_GUARD), not during manual MOVE
      if (!isIdleMission(entity.mission)) break;
      const ec = entity.cell;

      // C++ unit.cpp:2794-2796: if (Target_Legal(ArchiveTarget)) → head to last known ore first
      if (entity.archiveTarget) {
        const at = entity.archiveTarget;
        entity.archiveTarget = null; // C++ clears ArchiveTarget after using it
        entity.harvesterState = 'seeking';
        entity.mission = Mission.MOVE;
        entity.moveTarget = { x: at.cx * CELL_SIZE + CELL_SIZE / 2, y: at.cy * CELL_SIZE + CELL_SIZE / 2 };
        entity.path = findPath(ctx.map, ec, at, true);
        entity.pathIndex = 0;
        break;
      }

      // Find nearest ore cell — AI harvesters spread to avoid clustering
      // C++ unit.cpp:2799: Goto_Tiberium(Rule.TiberiumLongScan / CELL_LEPTON_W)
      // rules.ini OreFarScan=48
      const oreCell = findHarvesterOre(ctx, entity, ec.cx, ec.cy, 48);
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
        // C++ unit.cpp:2800 — IsHarvesting = true when scoop anim begins
        entity.isHarvesterMining = true;
        entity.harvesterAnimStage = 0;
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
      // C++ unit.cpp Shape_Number — Harvester_Load_List[9] scoop cycle (0..8)
      // Set_Rate(OreDumpRate=1) → advance 1 stage per tick; wrap via modulo.
      entity.harvesterAnimStage = (entity.harvesterAnimStage + 1) % 9;
      entity.isHarvesterMining = true;
      // C++ unit.cpp:2280: if (Tiberium_Load() < 1) — return when already full
      if (entity.oreLoad >= Entity.BAIL_COUNT) {
        entity.isHarvesterMining = false;
        entity.harvesterState = 'returning';
        break;
      }
      // Harvest every 10 ticks (~0.67s)
      if (entity.harvestTick % 10 === 0) {
        const ec = entity.cell;
        const bailCredits = ctx.map.depleteOre(ec.cx, ec.cy);
        if (bailCredits > 0) {
          // EC3: bail-based capacity — track bail count, not credit amount
          entity.oreLoad += 1;
          entity.oreCreditValue += bailCredits;
          // EC4: gem bonus bails — C++ unit.cpp:2306-2308, up to 3 extra bails per gem harvest
          // C++ guards each bonus bail with (BailCount > Tiberium) to prevent exceeding capacity
          if (bailCredits >= 50) {
            const gemValue = 50; // rules.ini GemValue
            for (let bonus = 0; bonus < 3; bonus++) {
              if (entity.oreLoad >= Entity.BAIL_COUNT) break;
              entity.oreLoad += 1;
              entity.oreCreditValue += gemValue;
            }
          }
        }
        // C++ parity: check cell state AFTER depleting — when the last ore bail is
        // taken, depleteOre() returns credits > 0 AND sets overlay to 0xFF. The
        // harvester must detect this on the SAME tick and immediately seek new ore.
        const cellOvl = ctx.map.overlay[ec.cy * MAP_CELLS + ec.cx];
        const cellDepleted = bailCredits === 0 || (bailCredits > 0 && (cellOvl < 0x03 || cellOvl > 0x12));
        // Check if full or current cell depleted
        if (entity.oreLoad >= Entity.BAIL_COUNT) {
          // C++ unit.cpp:2851: ArchiveTarget = ::As_Target(Coord_Cell(Coord));
          entity.archiveTarget = { cx: ec.cx, cy: ec.cy };
          entity.isHarvesterMining = false;
          entity.harvesterState = 'returning';
        } else if (cellDepleted) {
          // No more ore at this cell — look for adjacent ore
          const newOre = ctx.map.findNearestOre(ec.cx, ec.cy, 6);
          if (newOre && entity.oreLoad < Entity.BAIL_COUNT) {
            entity.isHarvesterMining = false;
            entity.harvesterState = 'seeking';
            entity.mission = Mission.MOVE;
            entity.moveTarget = { x: newOre.cx * CELL_SIZE + CELL_SIZE / 2, y: newOre.cy * CELL_SIZE + CELL_SIZE / 2 };
            entity.path = findPath(ctx.map, ec, newOre, true);
            entity.pathIndex = 0;
          } else {
            // No more ore nearby — return with whatever we have
            entity.isHarvesterMining = false;
            if (entity.oreLoad > 0) {
              entity.archiveTarget = { cx: ec.cx, cy: ec.cy };
              entity.harvesterState = 'returning';
            } else {
              entity.harvesterState = 'idle';
            }
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
        entity.harvesterAnimStage = 0;
        entity.isHarvesterDumping = false; // set true once rotated to DIR_W
        // C++ unit.cpp:2365-2369 — rotate to DIR_W before dump animation begins
        entity.desiredFacing = Dir.W;
      } else {
        // Not there yet — move to dock cell (C++ building.cpp:306 Adjacent_Cell(Center, DIR_S)).
        // PROC is 3x3 at (cx..cx+2, cy..cy+2). Center cell = (cx+1, cy+1).
        // DIR_S of center = (cx+1, cy+2) — the south-center cell of the footprint.
        // Harvester drives into this cell from below to dock.
        const target = { cx: bestProc.cx + 1, cy: bestProc.cy + procH - 1 };
        entity.mission = Mission.MOVE;
        entity.moveTarget = { x: target.cx * CELL_SIZE + CELL_SIZE / 2, y: target.cy * CELL_SIZE + CELL_SIZE / 2 };
        entity.path = findPath(ctx.map, ec, target, true);
        entity.pathIndex = 0;
        entity.harvestTick = 0;
      }
      break;
    }
    case 'unloading': {
      // C++ unit.cpp:2348-2390 Mission_Unload for UNIT_HARVESTER:
      //   1. If PrimaryFacing != DIR_W, call Do_Turn(DIR_W) and return 5 (5-tick rotate delay)
      //   2. Once facing W, IsDumping=true, Set_Stage(0), Set_Rate(OreDumpRate=1)
      //   3. Play 22-stage Harvester_Dump_List animation (1 stage per tick)
      //   4. At stage 22: lump-sum deposit House->Harvested(Credit_Load()), Tiberium=0
      //
      // C++ unit.cpp:2383 — lump-sum credit deposit at END of dump animation, NOT drip-feed.
      // (The refinery's Mission_Harvest drip-feeds via Offload_Tiberium_Bail, but that is
      //  #ifdef TOFIX'd out and returns 0 credits — so lump-sum is the real credit source.)

      // Phase 1: rotate to DIR_W — wait until facing matches.
      // tickRotation() is called here because harvesters in GUARD mission without a target
      // don't rotate via the missionAI scanning loop. C++ Mission_Unload drives rotation
      // directly via Do_Turn(DIR_W) in unit.cpp:2367.
      if (entity.facing !== Dir.W) {
        entity.desiredFacing = Dir.W;
        entity.isHarvesterDumping = false;
        entity.tickRotation();
        break;
      }

      // Phase 2: play 22-stage dump animation.
      entity.isHarvesterDumping = true;
      entity.harvestTick++;
      entity.harvesterAnimStage = entity.harvestTick - 1; // 0..21

      // Per-tick chime during dump (first 22 ticks)
      if (entity.harvestTick % 5 === 0 && entity.harvestTick <= 22 && ctx.isPlayerControlled(entity)) {
        ctx.playSound('heal');
      }

      // Phase 3: at tick 22, lump-sum deposit + state reset.
      if (entity.harvestTick >= 22) {
        const credits = entity.oreCreditValue;
        if (credits > 0) {
          if (ctx.isPlayerControlled(entity)) {
            ctx.addCredits(credits);
          } else {
            const cur = ctx.houseCredits.get(entity.house) ?? 0;
            ctx.houseCredits.set(entity.house, cur + credits);
          }
        }
        entity.oreLoad = 0;
        entity.oreCreditValue = 0;
        entity.isHarvesterDumping = false;
        entity.harvesterAnimStage = 0;
        entity.harvesterState = 'idle';
        entity.harvestTick = 0;
      }
      break;
    }
  }
}
