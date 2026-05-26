/**
 * Production queue subsystem — extracted from Game class (index.ts).
 * Handles building/unit production: availability checks, queue management,
 * incremental cost deduction, and unit spawning.
 */

import {
  type WorldPos, CELL_SIZE,
  type House, type Faction, UnitType, Mission,
  type ProductionItem, getFactoryType,
  COUNTRY_BONUSES, UNIT_STATS,
  worldToCell, pixelToLepton,
} from './types';
import { Entity, aircraftPoseDir256, setAircraftUnlimboFacing256 } from './entity';
import { type MapStructure, STRUCTURE_SIZE } from './scenario';
import { type GameMap } from './map';
import { findPath } from './pathfinding';

// ── Local constants ──────────────────────────────────────────────────────────

const WALL_TYPES = new Set(['SBAG', 'FENC', 'BARB', 'BRIK']);
const NEW_UNITS_GATED_TYPES = new Set([
  'SHOK', 'MECH',
  'CTNK', 'TTNK', 'QTNK', 'DTRK', 'STNK',
  'MSUB', 'CARR',
]);

// ── Context interface ────────────────────────────────────────────────────────

export interface ProductionContext {
  structures: MapStructure[];
  entities: Entity[];
  entityById: Map<number, Entity>;
  credits: number;
  playerHouse: House;
  playerFaction: Faction;
  playerTechLevel: number;
  /** Legacy compatibility field; C++ production is not gated by base discovery. */
  baseDiscovered?: boolean;
  scenarioProductionItems: ProductionItem[];
  /** C++ global NewUnitsEnabled gate for Counterstrike/Aftermath-only buildables. */
  newUnitsEnabled?: boolean;
  productionQueue: Map<string, { item: ProductionItem; progress: number; queueCount: number; costPaid: number; powerMult: number }>;
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
  addEntity(entity: Entity): void;
  findPassableSpawn(cx: number, cy: number, structCX: number, structCY: number, fw: number, fh: number): { cx: number; cy: number };
}

// ── Pure functions ───────────────────────────────────────────────────────────

/**
 * Compute the C++ Power_Fraction (house.cpp:4160-4170).
 * Raw power ratio, NOT clamped.
 */
export function powerFraction(produced: number, consumed: number): number {
  if (produced >= consumed || consumed === 0) return 1;
  if (produced > 0) return produced / consumed;
  return 0;
}

/**
 * C++ Mechanism 1: TechnoClass::Time_To_Build power quantization (techno.cpp:677-682).
 * Quantizes power into bands with specific thresholds:
 *   - power >= 1.0:            speed factor = 1.0 (normal)
 *   - 0.75 < power < 1.0:     snapped to 0.75 -> speed = 0.75
 *   - 0.50 <= power <= 0.75:  actual fraction used
 *   - power < 0.50:           clamped to 0.50 -> speed = 0.50
 *
 * Returns the SPEED FACTOR (0.5 to 1.0). Multiply by base build time to get
 * effective speed. The C++ code applies 1/power to TIME, which is equivalent
 * to multiplying SPEED by power.
 */
export function timeToBuildSpeedFactor(fraction: number): number {
  let power = fraction;
  if (power > 1) power = 1;
  if (power < 1 && power > 0.75) power = 0.75;   // snap (0.75, 1.0) -> 0.75
  if (power < 0.5) power = 0.5;                    // floor at 0.50
  return power;
}

/**
 * C++ Mechanism 2: FactoryClass::Start() rate penalty (factory.cpp:434).
 * Clamps power fraction to [1/16, 1] and uses it as a speed factor.
 */
export function factoryStartSpeedFactor(fraction: number): number {
  return Math.max(1 / 16, Math.min(1, fraction));
}

/**
 * Compute the combined production speed multiplier using both C++ mechanisms.
 *
 * C++ has TWO separate power-penalty mechanisms that BOTH apply multiplicatively:
 *
 * Mechanism 1 (techno.cpp:677-682): Time_To_Build quantizes power into bands.
 *   Speed factor: snap (0.75,1.0)->0.75, use actual for [0.50,0.75], floor at 0.50.
 *
 * Mechanism 2 (factory.cpp:434): FactoryClass::Start() clamps power to [1/16, 1].
 *   Speed factor: linear fraction clamped to [1/16, 1].
 *
 * Combined: speed = mechanism1 * mechanism2
 *
 * Examples:
 *   Full power:  1.0 * 1.0 = 1.0
 *   90% power:   0.75 * 0.9 = 0.675  (was incorrectly 0.9 with single mechanism)
 *   50% power:   0.5 * 0.5 = 0.25    (was incorrectly 0.5)
 *   25% power:   0.5 * 0.25 = 0.125  (was incorrectly 0.25)
 *   0% power:    0.5 * 1/16 = 1/32   (was incorrectly 1/16)
 */
export function computePowerMult(ctx: ProductionContext): number {
  const fraction = powerFraction(ctx.powerProduced, ctx.powerConsumed);
  const m1 = timeToBuildSpeedFactor(fraction);
  const m2 = factoryStartSpeedFactor(fraction);
  return m1 * m2;
}

/**
 * Get effective cost for an item, applying country bonus and optional difficulty CostBias.
 * C++ house.cpp:294,304: effective cost = item.cost * HouseType.CostBias * Diff[handicap].CostBias
 * @param costBias — difficulty CostBias from AI_DIFFICULTY_MODS (default 1.0)
 */
export function getEffectiveCost(item: ProductionItem, playerHouse: House, costBias = 1.0): number {
  const bonus = COUNTRY_BONUSES[playerHouse] ?? COUNTRY_BONUSES.Neutral;
  return Math.max(1, Math.round(item.cost * bonus.costMult * costBias));
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
  return ctx.scenarioProductionItems.filter(item => {
    // C++ HouseClass::Can_Build rejects CSII-only infantry/unit/vessel types
    // unless NewUnitsEnabled was enabled by scenario rules or multiplayer setup.
    if (!ctx.newUnitsEnabled && NEW_UNITS_GATED_TYPES.has(item.type)) return false;
    // BuildingTypeClass production requires an active construction yard/factory.
    // Tech prerequisites such as PROC/ATEK unlock specific buildings, but they
    // do not themselves create the building production factory.
    if (item.isStructure && !ctx.hasBuilding('FACT')) return false;
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
 *  C++ parity: incremental cost deduction per tick using integer division (factory.cpp:615).
 *  factory.cpp:416: validates player has at minimum cost-per-tick before starting.
 *  C++ parity: factory occupation check — if a structure has completed production
 *  but is awaiting placement (Has_Completed() returns true), new production cannot
 *  start in that factory until Completed() is called (factory.cpp:647). */
export function startProduction(ctx: ProductionContext, item: ProductionItem): void {
  const category = getFactoryType(item);
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
  // C++ parity: factory occupation check (factory.cpp:647).
  // If a structure is awaiting placement in the same category, the factory is
  // still "occupied" — block new production until placement is completed.
  if (item.isStructure && ctx.pendingPlacement) {
    return;
  }
  // C++ parity (factory.cpp:416): validate player has at minimum cost-per-tick.
  // Cost_Per_Tick at stage 0 = Balance / STEP_COUNT = effectiveCost / buildTime.
  // C++ uses integer division, so the minimum is floor(cost / buildTime).
  const effectiveCost = getEffectiveCost(item, ctx.playerHouse);
  const minCostPerTick = Math.max(1, Math.floor(effectiveCost / item.buildTime));
  if (ctx.credits < minCostPerTick) {
    ctx.playEva('eva_insufficient_funds');
    return;
  }
  // C++ parity (factory.cpp:434): snapshot power fraction at production start time.
  // Rate is LOCKED — changing power mid-production has no effect until suspend+restart.
  const powerMult = computePowerMult(ctx);
  ctx.productionQueue.set(category, { item, progress: 0, queueCount: 1, costPaid: 0, powerMult });
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
 *  C++ parity: integer cost tracking (factory.cpp:615), force-spend at completion
 *  (factory.cpp:233), stage regression on insufficient funds (factory.cpp:220-221).
 *  Power fraction is snapshotted at Start() time and locked (factory.cpp:434). */
export function tickProduction(ctx: ProductionContext): void {
  for (const [category, entry] of ctx.productionQueue) {
    // Check prerequisite still exists
    if (!ctx.hasBuilding(entry.item.prerequisite)) {
      cancelProduction(ctx, category);
      continue;
    }
    // C++ parity (house.cpp:855,880): check ALL prerequisite bits, including techPrereq.
    // In C++, Prerequisite is a single bitmask combining primary + tech prereqs.
    // If ANY prereq building is destroyed, (pre & flags) != pre → production abandoned.
    if (entry.item.techPrereq && !ctx.hasBuilding(entry.item.techPrereq)) {
      cancelProduction(ctx, category);
      continue;
    }
    // C++ parity (factory.cpp:615): Cost_Per_Tick = Balance / (STEP_COUNT - stage)
    // Uses integer division: remaining cost divided by remaining steps.
    // Balance = effectiveCost - costPaid (remaining cost to deduct).
    const effectiveCost = getEffectiveCost(entry.item, ctx.playerHouse);
    const remainingCost = effectiveCost - entry.costPaid;
    const remainingSteps = Math.max(1, entry.item.buildTime - Math.floor(entry.progress));
    // C++ integer division: floor(remainingCost / remainingSteps)
    const costThisTick = Math.max(1, Math.floor(remainingCost / remainingSteps));
    if (entry.costPaid < effectiveCost) {
      if (ctx.credits >= costThisTick) {
        const deduct = Math.min(costThisTick, remainingCost);
        ctx.credits -= deduct;
        entry.costPaid += deduct;
      } else {
        // C++ parity (factory.cpp:220-221): insufficient funds — regress one stage.
        // C++: Set_Stage(Fetch_Stage() - 1) — rolls back progress by one step.
        entry.progress = Math.max(0, entry.progress - 1);
        continue;
      }
    }
    // C++ parity (factory.cpp:206): each factory is an independent FactoryClass
    // object. The AI() loop runs exactly once per tick per factory:
    //   for (int index = 0; index < 1; index++) { ... }
    // Multiple factories let you build multiple items simultaneously (separate
    // queues), but do NOT speed up a single item's production. Progress
    // advances by 1 per tick regardless of how many factories the player owns.
    // C++ parity: use the LOCKED power fraction from Start() time, not current power
    entry.progress += entry.powerMult;
    if (entry.progress >= entry.item.buildTime) {
      // C++ parity (factory.cpp:233): force-spend remaining balance on completion.
      // House->Spend_Money(Balance); Balance=0; — guarantees exact total cost.
      const unspent = effectiveCost - entry.costPaid;
      if (unspent > 0) {
        ctx.credits -= unspent;
        entry.costPaid = effectiveCost;
      }
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
          entry.powerMult = computePowerMult(ctx); // C++ parity: re-snapshot power on restart
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
    if (factory.type === 'HPAD') {
      spawnX = factory.cx * CELL_SIZE + 24;
      spawnY = factory.cy * CELL_SIZE + 18;
    } else if (factory.type === 'AFLD') {
      spawnX = factory.cx * CELL_SIZE + CELL_SIZE + CELL_SIZE / 2;
      spawnY = factory.cy * CELL_SIZE + 28;
    } else {
      spawnX = (factory.cx + padW / 2) * CELL_SIZE;
      spawnY = (factory.cy + padH / 2) * CELL_SIZE;
    }
    const entity = new Entity(unitType, ctx.playerHouse, spawnX, spawnY);
    setAircraftUnlimboFacing256(entity, aircraftPoseDir256(entity));
    entity.mission = Mission.GUARD;
    entity.aircraftState = 'landed';
    entity.flightAltitude = 0;
    entity.aircraftHeightLeptons = 0;
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

  // C++ building.cpp:1949-1956: vessels always get MISSION_GUARD (no IQ gate, no AREA_GUARD)
  if (unitStats?.isVessel) {
    entity.mission = Mission.GUARD;
  }
  // C++ building.cpp:1972-1981: harvesters get MISSION_HARVEST from the refinery exit path
  else if (unitType === UnitType.V_HARV) {
    entity.mission = Mission.HARVEST;
    entity.harvesterState = 'idle';
  }
  // C++ building.cpp:4539,2030: human player units (IQ < IQGuardArea) exit with MISSION_MOVE.
  // AI units with rally (IQ >= IQGuardArea) get AREA_GUARD below.
  else {
    entity.mission = Mission.MOVE;
  }

  ctx.entities.push(entity);
  ctx.entityById.set(entity.id, entity);
  // Track built unit types for TEVENT_BUILD_UNIT / TEVENT_BUILD_INFANTRY
  if (unitStats?.isInfantry) ctx.builtInfantryTypes.add(item.type);
  else ctx.builtUnitTypes.add(item.type);

  // C++ building.cpp:2038-2039: rally-pointed units get MISSION_GUARD_AREA with
  // ArchiveTarget = Where_To_Go(), so they patrol around rally and return if displaced.
  // C++ building.cpp:1949-1966: vessels are excluded — no GUARD_AREA upgrade for vessels.
  const rally = ctx.rallyPoints.get(factoryType);
  if (rally && unitType !== UnitType.V_HARV && !unitStats?.isVessel) {
    entity.mission = Mission.AREA_GUARD;
    entity.moveTarget = { lx: pixelToLepton(rally.x), ly: pixelToLepton(rally.y) };
    entity.guardOrigin = { x: rally.x, y: rally.y };
    // C++ building.cpp:2039: ArchiveTarget = rally position (used for return-to-rally leash)
    entity.archiveTarget = worldToCell(rally.x, rally.y);
    entity.archiveTargetEntity = null;
    entity.archiveTargetLeptons = null;
    entity.path = findPath(ctx.map, entity.cell, worldToCell(rally.x, rally.y), true, entity.isNavalUnit, entity.stats.speedClass);
    entity.pathIndex = 0;
  }
}
