/**
 * Production queue subsystem — extracted from Game class (index.ts).
 * Handles building/unit production: availability checks, queue management,
 * incremental cost deduction, multi-factory speedup, and unit spawning.
 */

import {
  type WorldPos, CELL_SIZE,
  type House, type Faction, UnitType, Mission,
  type ProductionItem, getStripSide,
  COUNTRY_BONUSES, UNIT_STATS,
  worldToCell,
} from './types';
import { Entity } from './entity';
import { type MapStructure, STRUCTURE_SIZE } from './scenario';
import { type GameMap } from './map';
import { findPath } from './pathfinding';

// ── Local constants ──────────────────────────────────────────────────────────

const WALL_TYPES = new Set(['SBAG', 'FENC', 'BARB', 'BRIK']);

// ── Context interface ────────────────────────────────────────────────────────

export interface ProductionContext {
  structures: MapStructure[];
  entities: Entity[];
  entityById: Map<number, Entity>;
  credits: number;
  playerHouse: House;
  playerFaction: Faction;
  playerTechLevel: number;
  baseDiscovered: boolean;
  scenarioProductionItems: ProductionItem[];
  productionQueue: Map<string, { item: ProductionItem; progress: number; queueCount: number; costPaid: number }>;
  pendingPlacement: ProductionItem | null;
  wallPlacementPrepaid: boolean;
  map: GameMap;
  tick: number;
  powerProduced: number;
  powerConsumed: number;
  builtUnitTypes: Set<string>;
  builtInfantryTypes: Set<string>;
  builtAircraftTypes: Set<string>;
  rallyPoints: Map<string, WorldPos>;

  // Callbacks
  isAllied(a: House, b: House): boolean;
  hasBuilding(type: string): boolean;
  playSound(name: string): void;
  playEva(name: string): void;
  addCredits(amount: number, bypassSiloCap?: boolean): number;
  addEntity(entity: Entity): void;
  findPassableSpawn(cx: number, cy: number, structCX: number, structCY: number, fw: number, fh: number): { cx: number; cy: number };
}

// ── Pure functions ───────────────────────────────────────────────────────────

/** Get effective cost for an item, applying country bonus multiplier */
export function getEffectiveCost(item: ProductionItem, playerHouse: House): number {
  const bonus = COUNTRY_BONUSES[playerHouse] ?? COUNTRY_BONUSES.Neutral;
  return Math.max(1, Math.round(item.cost * bonus.costMult));
}

/** Count alive player buildings of a given type */
export function countPlayerBuildings(
  structures: MapStructure[], type: string, playerHouse: House,
  isAllied: (a: House, b: House) => boolean,
): number {
  let count = 0;
  for (const s of structures) {
    if (s.alive && s.type === type && isAllied(s.house, playerHouse)) count++;
  }
  return count;
}

// ── Mutating functions ───────────────────────────────────────────────────────

/** Get buildable items based on current structures + faction + tech prereqs */
export function getAvailableItems(ctx: ProductionContext): ProductionItem[] {
  // No production until player discovers their base
  if (!ctx.baseDiscovered) return [];
  return ctx.scenarioProductionItems.filter(item => {
    // Must have primary prerequisite building
    if (!ctx.hasBuilding(item.prerequisite)) return false;
    // Faction filter: player only sees items matching their faction or 'both'
    if (item.faction !== 'both' && item.faction !== ctx.playerFaction) return false;
    // Tech prerequisite (e.g. Artillery needs Radar Dome)
    if (item.techPrereq && !ctx.hasBuilding(item.techPrereq)) return false;
    // TechLevel filter: items above player's scenario tech level are hidden
    if (item.techLevel !== undefined && (item.techLevel < 0 || item.techLevel > ctx.playerTechLevel)) return false;
    return true;
  });
}

/** Start building an item (called from sidebar click).
 *  PR3: C++ incremental cost — don't deduct full cost upfront; deduct per-tick during tickProduction.
 *  Players can start building with partial funds; production pauses when broke. */
export function startProduction(ctx: ProductionContext, item: ProductionItem): void {
  const category = getStripSide(item);
  const existing = ctx.productionQueue.get(category);
  if (existing) {
    // Already building — queue another of the same item (max 5 total)
    // Queued items still require full cost upfront (only active build is incremental)
    if (existing.item.type === item.type && existing.queueCount < 5) {
      const effectiveCost = getEffectiveCost(item, ctx.playerHouse);
      if (ctx.credits < effectiveCost) {
        ctx.playEva('eva_insufficient_funds');
        return;
      }
      ctx.credits -= effectiveCost;
      existing.queueCount++;
    }
    return;
  }
  // PR3: Only check if player has ANY credits (can start building with partial funds)
  if (ctx.credits <= 0) {
    ctx.playEva('eva_insufficient_funds');
    return;
  }
  ctx.productionQueue.set(category, { item, progress: 0, queueCount: 1, costPaid: 0 });
  ctx.playSound('eva_building');
}

/** Cancel production in a category — removes one from queue, or cancels active build */
export function cancelProduction(ctx: ProductionContext, category: string): void {
  const entry = ctx.productionQueue.get(category);
  if (!entry) return;
  const effectiveCost = getEffectiveCost(entry.item, ctx.playerHouse);
  if (entry.queueCount > 1) {
    // Dequeue one — refund full cost of queued item (queued items were paid upfront)
    entry.queueCount--;
    ctx.credits += effectiveCost;
  } else {
    // PR3: Cancel active build — refund costPaid (incremental deduction)
    ctx.credits += entry.costPaid;
    ctx.productionQueue.delete(category);
  }
}

/** Advance production queues each tick.
 *  PR3: C++ incremental cost — deducts costPerTick each tick; pauses if insufficient funds. */
export function tickProduction(ctx: ProductionContext): void {
  // Continuous power penalty (C++ parity): multiplier = powerFraction, clamped to [0.5, 1.0]
  // At 100%+ power: normal speed. At 50% power: 2x slower. Below 50%: capped at 2x slower.
  let powerMult = 1.0;
  if (ctx.powerConsumed > ctx.powerProduced && ctx.powerProduced > 0) {
    const powerFraction = ctx.powerProduced / ctx.powerConsumed;
    powerMult = Math.max(0.5, powerFraction);
  }
  for (const [category, entry] of ctx.productionQueue) {
    // Check prerequisite still exists
    if (!ctx.hasBuilding(entry.item.prerequisite)) {
      cancelProduction(ctx, category);
      continue;
    }
    // PR3: Incremental cost deduction — deduct costPerTick each tick
    const effectiveCost = getEffectiveCost(entry.item, ctx.playerHouse);
    const costPerTick = effectiveCost / entry.item.buildTime;
    const costThisTick = costPerTick; // deduct one tick's worth of cost
    if (entry.costPaid < effectiveCost) {
      if (ctx.credits >= costThisTick) {
        const deduct = Math.min(costThisTick, effectiveCost - entry.costPaid);
        ctx.credits -= deduct;
        entry.costPaid += deduct;
      } else {
        // PR3: Insufficient funds — pause production (don't advance progress)
        continue;
      }
    }
    // Multi-factory linear speedup (C++ parity): N factories = Nx speed
    const factoryCount = countPlayerBuildings(ctx.structures, entry.item.prerequisite, ctx.playerHouse, ctx.isAllied);
    const speedMult = Math.max(1, factoryCount);
    entry.progress += speedMult * powerMult;
    if (entry.progress >= entry.item.buildTime) {
      // Build complete
      if (entry.item.isStructure) {
        // Structure: go into placement mode
        ctx.pendingPlacement = entry.item;
        ctx.wallPlacementPrepaid = WALL_TYPES.has(entry.item.type);
        ctx.productionQueue.delete(category);
        ctx.playSound('eva_construction_complete');
      } else {
        // Unit: spawn at the producing structure
        spawnProducedUnit(ctx, entry.item);
        ctx.playSound('eva_unit_ready');
        // If more queued, restart for next unit; otherwise remove
        if (entry.queueCount > 1) {
          entry.queueCount--;
          entry.progress = 0;
          entry.costPaid = 0; // reset for next queued item
        } else {
          ctx.productionQueue.delete(category);
        }
      }
    }
  }
}

/** Spawn a produced unit at its factory */
export function spawnProducedUnit(ctx: ProductionContext, item: ProductionItem): void {
  const factoryType = item.prerequisite;
  // Find the factory building
  let factory: MapStructure | null = null;
  for (const s of ctx.structures) {
    if (s.alive && s.type === factoryType && ctx.isAllied(s.house, ctx.playerHouse)) {
      factory = s;
      break;
    }
  }
  if (!factory) return;

  const unitType = item.type as UnitType;
  const unitStats = UNIT_STATS[item.type];
  const [factW, factH] = STRUCTURE_SIZE[factory.type] ?? [3, 2];

  // Aircraft production: spawn at pad center, docked
  let spawnX: number, spawnY: number;
  if (unitStats?.isAircraft) {
    const [padW, padH] = STRUCTURE_SIZE[factory.type] ?? [2, 2];
    spawnX = (factory.cx + padW / 2) * CELL_SIZE;
    spawnY = (factory.cy + padH / 2) * CELL_SIZE;
    const entity = new Entity(unitType, ctx.playerHouse, spawnX, spawnY);
    entity.mission = Mission.GUARD;
    entity.aircraftState = 'landed';
    entity.flightAltitude = 0;
    // Dock at factory
    for (let i = 0; i < ctx.structures.length; i++) {
      if (ctx.structures[i] === factory) {
        entity.landedAtStructure = i;
        factory.dockedAircraft = entity.id;
        break;
      }
    }
    ctx.entities.push(entity);
    ctx.entityById.set(entity.id, entity);
    ctx.builtAircraftTypes.add(item.type);
    return;
  }

  // Naval production: spawn vessel at adjacent water cell
  if (unitStats?.isVessel) {
    const waterCell = ctx.map.findAdjacentWaterCell(factory.cx, factory.cy, factW, factH);
    if (!waterCell) return; // no water cell found — production stalls
    spawnX = waterCell.cx * CELL_SIZE + CELL_SIZE / 2;
    spawnY = waterCell.cy * CELL_SIZE + CELL_SIZE / 2;
  } else {
    const spawn = ctx.findPassableSpawn(factory.cx + 1, factory.cy + 2, factory.cx, factory.cy, factW, factH);
    spawnX = spawn.cx * CELL_SIZE + CELL_SIZE / 2;
    spawnY = spawn.cy * CELL_SIZE + CELL_SIZE / 2;
  }
  const entity = new Entity(unitType, ctx.playerHouse, spawnX, spawnY);
  entity.mission = Mission.GUARD;
  ctx.entities.push(entity);
  ctx.entityById.set(entity.id, entity);
  // Track built unit types for TEVENT_BUILD_UNIT / TEVENT_BUILD_INFANTRY
  if (unitStats?.isInfantry) ctx.builtInfantryTypes.add(item.type);
  else ctx.builtUnitTypes.add(item.type);

  // If harvester, set it to auto-harvest
  if (unitType === UnitType.V_HARV) {
    entity.harvesterState = 'idle';
  }

  // Auto-move to rally point if set
  const rally = ctx.rallyPoints.get(factoryType);
  if (rally && unitType !== UnitType.V_HARV) {
    entity.mission = Mission.MOVE;
    entity.moveTarget = { x: rally.x, y: rally.y };
    entity.path = findPath(ctx.map, entity.cell, worldToCell(rally.x, rally.y), true, entity.isNavalUnit, entity.stats.speedClass);
    entity.pathIndex = 0;
  }
}
