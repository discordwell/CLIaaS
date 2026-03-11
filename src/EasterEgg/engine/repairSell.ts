/**
 * Repair, sell, and power calculation subsystem.
 * Extracted from Game class (engine/index.ts) into pure + context-based functions.
 */

import {
  type WorldPos, type ProductionItem,
  REPAIR_STEP, REPAIR_PERCENT, POWER_DRAIN, CELL_SIZE,
  type House, Mission,
  worldDist,
} from './types';
import { type MapStructure, STRUCTURE_SIZE } from './scenario';
import { type Entity } from './entity';
import { type Effect, BUILDING_FRAME_TABLE } from './renderer';

// ---------------------------------------------------------------------------
// Context interface — minimal fields needed by mutating functions
// ---------------------------------------------------------------------------

export interface RepairSellContext {
  structures: MapStructure[];
  entities: Entity[];
  credits: number;
  tick: number;
  playerHouse: House;
  repairingStructures: Set<number>;
  scenarioProductionItems: ProductionItem[];
  effects: Effect[];
  siloCapacity: number;
  gapGeneratorCells: Map<number, { cx: number; cy: number; radius: number }>;

  // Callbacks
  isAllied(a: House, b: House): boolean;
  isPlayerControlled(e: Entity): boolean;
  playEva(name: string): void;
  playSound(name: string): void;
  playSoundAt(name: string, x: number, y: number): void;
  clearStructureFootprint(s: MapStructure): void;
}

// ---------------------------------------------------------------------------
// Pure exported functions — formalize inline calculations
// ---------------------------------------------------------------------------

/** Calculate repair cost per step for a structure type.
 *  Formula: ceil(buildCost * REPAIR_PERCENT / (maxHp / REPAIR_STEP))
 *  C++ rules.cpp:228-229 RepairStep, RepairPercent */
export function repairCostPerStep(buildCost: number, maxHp: number): number {
  return Math.ceil((buildCost * REPAIR_PERCENT) / (maxHp / REPAIR_STEP));
}

/** Calculate sell refund for a structure — flat 50% of build cost (C++ parity, no health scaling) */
export function sellRefund(buildCost: number): number {
  return Math.floor(buildCost * 0.5);
}

/** Calculate power output for a structure at given health.
 *  C++ building.cpp:4613 Power_Output — scales linearly with health ratio.
 *  POWR=100W, APWR=200W at full health. */
export function powerOutput(type: string, hp: number, maxHp: number): number {
  const healthRatio = maxHp > 0 ? hp / maxHp : 0;
  if (type === 'POWR') return Math.round(100 * healthRatio);
  if (type === 'APWR') return Math.round(200 * healthRatio);
  return 0;
}

/** Calculate full power grid for player structures.
 *  Returns { produced, consumed }. */
export function calculatePowerGrid(
  structures: MapStructure[],
  playerHouse: House,
  isAllied: (a: House, b: House) => boolean,
): { produced: number; consumed: number } {
  let produced = 0;
  let consumed = 0;
  for (const s of structures) {
    if (!s.alive || s.sellProgress !== undefined || !isAllied(s.house, playerHouse)) continue;
    const healthRatio = s.hp / s.maxHp;
    if (s.type === 'POWR') produced += Math.round(100 * healthRatio);
    else if (s.type === 'APWR') produced += Math.round(200 * healthRatio);
    const drain = POWER_DRAIN[s.type];
    if (drain) consumed += drain;
  }
  return { produced, consumed };
}

/** Calculate power production multiplier for tick-based systems.
 *  At 100%+ power: 1.0. At <100%: powerFraction clamped to [0.5, 1.0]. */
export function powerMultiplier(produced: number, consumed: number): number {
  if (consumed <= produced || produced <= 0) return 1.0;
  return Math.max(0.5, produced / consumed);
}

/** Calculate silo storage capacity from structures.
 *  PROC=1000, SILO=1500 (C++ building.cpp Capacity()) */
export function calculateSiloCapacity(
  structures: MapStructure[],
  playerHouse: House,
  isAllied: (a: House, b: House) => boolean,
): number {
  let capacity = 0;
  for (const s of structures) {
    if (!s.alive || !isAllied(s.house, playerHouse)) continue;
    if (s.buildProgress !== undefined && s.buildProgress < 1) continue;
    if (s.type === 'PROC') capacity += 1000;
    else if (s.type === 'SILO') capacity += 1500;
  }
  return capacity;
}

// ---------------------------------------------------------------------------
// Mutating functions — operate on RepairSellContext
// ---------------------------------------------------------------------------

/** Toggle repair on a structure by index. Returns true if repair is now active. */
export function toggleRepair(ctx: RepairSellContext, idx: number): boolean {
  const s = ctx.structures[idx];
  if (!s || !s.alive || !ctx.isAllied(s.house, ctx.playerHouse)) return false;
  if (ctx.repairingStructures.has(idx)) {
    ctx.repairingStructures.delete(idx);
    return false;
  }
  if (s.hp < s.maxHp) {
    ctx.repairingStructures.add(idx);
    return true;
  }
  return false;
}

/** Check if a structure is currently being repaired. */
export function isStructureRepairing(ctx: RepairSellContext, idx: number): boolean {
  return ctx.repairingStructures.has(idx);
}

/** Initiate sell on a structure by index. Returns true if sell started. */
export function sellStructureByIndex(ctx: RepairSellContext, idx: number): boolean {
  const WALL_TYPES = new Set(['SBAG', 'FENC', 'BARB', 'BRIK']);
  const s = ctx.structures[idx];
  if (!s || !s.alive || s.sellProgress !== undefined) return false;
  if (!ctx.isAllied(s.house, ctx.playerHouse)) return false;
  if (WALL_TYPES.has(s.type)) {
    s.alive = false;
    ctx.clearStructureFootprint(s);
    const prodItem = ctx.scenarioProductionItems.find(p => p.type === s.type);
    if (prodItem) ctx.credits += Math.floor(prodItem.cost * 0.5);
    return true;
  }
  s.sellProgress = 0;
  s.sellHpAtStart = s.hp;
  return true;
}

/** Tick structure repairs — called every 14 ticks from game loop.
 *  C++ rules.cpp:228-229 RepairStep=7, RepairPercent=.02 */
export function tickRepairs(ctx: RepairSellContext): void {
  for (const idx of ctx.repairingStructures) {
    const s = ctx.structures[idx];
    if (!s || !s.alive || s.hp >= s.maxHp || s.sellProgress !== undefined) {
      ctx.repairingStructures.delete(idx);
      continue;
    }
    const prodItem = ctx.scenarioProductionItems.find(p => p.type === s.type);
    const cost = prodItem ? repairCostPerStep(prodItem.cost, s.maxHp) : 1;
    if (ctx.credits < cost) {
      ctx.repairingStructures.delete(idx);
      ctx.playEva('eva_insufficient_funds');
      continue;
    }
    ctx.credits -= cost;
    s.hp = Math.min(s.maxHp, s.hp + REPAIR_STEP);
    ctx.playSound('repair');
  }
}

/** Tick service depot repair — one docked vehicle at a time, costs credits.
 *  Called every 14 ticks. C++ parity: REPAIR_STEP HP per tick. */
export function tickServiceDepot(ctx: RepairSellContext): void {
  for (const s of ctx.structures) {
    if (!s.alive || s.type !== 'FIX') continue;
    if (!ctx.isAllied(s.house, ctx.playerHouse)) continue;
    const sx = s.cx * CELL_SIZE + CELL_SIZE;
    const sy = s.cy * CELL_SIZE + CELL_SIZE;
    let docked: Entity | null = null;
    let bestDist = Infinity;
    for (const e of ctx.entities) {
      if (!e.alive || !ctx.isPlayerControlled(e)) continue;
      if (e.stats.isInfantry) continue;
      const needsRepair = e.hp < e.maxHp;
      const needsRearm = e.maxAmmo > 0 && e.ammo < e.maxAmmo;
      if (!needsRepair && !needsRearm) continue;
      const dist = worldDist({ x: sx, y: sy }, e.pos);
      if (dist < 1.5 && dist < bestDist) {
        docked = e;
        bestDist = dist;
      }
    }
    if (docked) {
      if (docked.hp < docked.maxHp) {
        const unitCost = ctx.scenarioProductionItems.find(p => p.type === docked!.type)?.cost ?? 400;
        const cost = repairCostPerStep(unitCost, docked.maxHp);
        if (ctx.credits >= cost) {
          ctx.credits -= cost;
          docked.hp = Math.min(docked.maxHp, docked.hp + REPAIR_STEP);
          ctx.effects.push({
            type: 'muzzle', x: docked.pos.x, y: docked.pos.y - 4,
            frame: 0, maxFrames: 4, size: 3, sprite: 'piff', spriteStart: 0,
          } as Effect);
        } else {
          // C++ parity: eject unit when insufficient funds
          docked.mission = Mission.GUARD;
          docked.moveTarget = { x: docked.pos.x + CELL_SIZE * 3, y: docked.pos.y + CELL_SIZE * 3 };
        }
      }
      // Rearm alongside repair (free)
      if (docked.maxAmmo > 0 && docked.ammo < docked.maxAmmo) {
        docked.rearmTimer = (docked.rearmTimer ?? 0) - 1;
        if (docked.rearmTimer <= 0) {
          docked.ammo++;
          docked.rearmTimer = 36;
        }
      }
    }
  }
}
