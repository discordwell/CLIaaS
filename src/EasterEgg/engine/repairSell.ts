/**
 * Repair, sell, and power calculation subsystem.
 * Extracted from Game class (engine/index.ts) into pure + context-based functions.
 */

import {
  type WorldPos, type ProductionItem,
  REPAIR_STEP, REPAIR_PERCENT, UREPAIR_STEP, UREPAIR_PERCENT,
  POWER_DRAIN, CELL_SIZE,
  type House, Mission,
  worldDist,
} from './types';
import { type MapStructure, STRUCTURE_SIZE } from './scenario';
import { type Entity } from './entity';
import { type Effect, BUILDING_FRAME_TABLE } from './renderer';
import { computeRearmDelay } from './aircraft';

// ---------------------------------------------------------------------------
// Context interface — minimal fields needed by mutating functions
// ---------------------------------------------------------------------------

export interface RepairSellContext {
  structures: MapStructure[];
  entities: Entity[];
  credits: number;
  tick: number;
  playerHouse: House;
  powerProduced: number;
  powerConsumed: number;
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

// C++ fixed-point 8.8 raw values derived from rules.ini percentages.
// fixed(n,d).Raw = floor(n * 256 / d)
// RepairPercent=20% → floor(0.20 * 256) = 51
// URepairPercent=20% → floor(0.20 * 256) = 51
const REPAIR_PERCENT_RAW = Math.floor(REPAIR_PERCENT * 256);   // 51 for 20%
const UREPAIR_PERCENT_RAW = Math.floor(UREPAIR_PERCENT * 256); // 51 for 20%

/** Calculate repair cost per step for a structure type.
 *  C++ techno.cpp:6144: (Raw_Cost() / (MaxStrength / Rule.RepairStep)) * Rule.RepairPercent
 *  Uses integer division at each step, then 8.8 fixed-point multiply.
 *  RepairPercent raw = floor(0.20*256) = 51; int*fixed = ((51*val)+128)/256
 *
 *  NOTE: C++ building repair (building.cpp:5432 Repair_AI) does NOT clamp to min 1.
 *  The max(Repair_Cost(),1) clamp at techno.cpp:989 is only in the Service Depot
 *  (unit repair) loop. Buildings with low cost/high HP (BARR, TENT: 300/800) get
 *  Repair_Cost()=0 and repair for FREE — matching C++ behavior. */
export function repairCostPerStep(buildCost: number, maxHp: number): number {
  const stepsToFull = Math.trunc(maxHp / REPAIR_STEP);        // C++ int / int
  if (stepsToFull <= 0) return 0;                              // guard: maxHp < step
  const costPerFullStep = Math.trunc(buildCost / stepsToFull); // C++ int / int
  // C++ int * fixed: result = ((raw * intVal) + 128) / 256
  // No min-1 clamp — buildings can repair for free (C++ building.cpp:5432 Repair_AI)
  return Math.trunc((REPAIR_PERCENT_RAW * costPerFullStep + 128) / 256);
}

/** Calculate repair cost per step for a unit (foot) at Service Depot.
 *  C++ techno.cpp:6141-6142: (Raw_Cost()/(MaxStrength/Rule.URepairStep)) * Rule.URepairPercent
 *  Same integer division + fixed-point formula as buildings. */
export function unitRepairCostPerStep(buildCost: number, maxHp: number): number {
  const stepsToFull = Math.trunc(maxHp / UREPAIR_STEP);
  if (stepsToFull <= 0) return 1;                              // guard: maxHp < step is C++ UB
  const costPerFullStep = Math.trunc(buildCost / stepsToFull);
  // C++ call site clamps: max(Repair_Cost(), 1) (techno.cpp:989)
  return Math.max(1, Math.trunc((UREPAIR_PERCENT_RAW * costPerFullStep + 128) / 256));
}

/** Calculate sell refund for a structure — no health scaling.
 *  C++ techno.cpp:5743-5761 Refund_Amount: AI gets 100% refund, human gets Rule.RefundPercent (50%). */
export function sellRefund(buildCost: number, isHuman = true): number {
  // C++ fixed-point multiply: ((128 * cost) + 128) / 256 — rounds half-up
  return isHuman ? Math.trunc((128 * buildCost + 128) / 256) : buildCost;
}

/** Spend credits with Tiberium-first priority (C++ house.cpp:1886-1900).
 *  C++ spends from the silo-stored Tiberium pool FIRST, preserving the uncapped Credits pool.
 *  In the TS single-bucket model, storedOre = min(credits, siloCapacity) represents Tiberium.
 *  Returns { credits, oreSpent, cashSpent } so callers can track internal allocation. */
export function spendCredits(
  credits: number, amount: number, siloCapacity: number,
): { credits: number; oreSpent: number; cashSpent: number } {
  const ore = Math.min(credits, Math.max(0, siloCapacity)); // Tiberium portion
  if (amount <= ore) {
    return { credits: credits - amount, oreSpent: amount, cashSpent: 0 };
  }
  const oreSpent = ore;
  const cashSpent = amount - ore;
  return { credits: credits - amount, oreSpent, cashSpent };
}

/** Emulate C++ 8.8 fixed-point power output: fixed(hp, maxHp) * ratedPower.
 *  C++ building.cpp:4613: return(Class->Power * fixed(LastStrength, Class->MaxStrength));
 *  C++ fixed.cpp:64: fixed(n,d) truncates to floor(n * 256 / d) (8.8 format). */
export function fixedPowerOutput(ratedPower: number, hp: number, maxHp: number): number {
  if (maxHp <= 0 || hp <= 0) return 0;
  const fixedRaw = Math.floor((hp * 256) / maxHp);           // fixed(hp, maxHp) — truncation
  return Math.floor((fixedRaw * ratedPower + 128) / 256);     // fixed * int → int (rounded)
}

/** Calculate power output for a structure at given health.
 *  C++ building.cpp:4613 Power_Output — uses 8.8 fixed-point arithmetic.
 *  POWR=100W, APWR=200W at full health. */
export function powerOutput(type: string, hp: number, maxHp: number): number {
  if (type === 'POWR') return fixedPowerOutput(100, hp, maxHp);
  if (type === 'APWR') return fixedPowerOutput(200, hp, maxHp);
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
    if (s.type === 'POWR') produced += fixedPowerOutput(100, s.hp, s.maxHp);
    else if (s.type === 'APWR') produced += fixedPowerOutput(200, s.hp, s.maxHp);
    const drain = POWER_DRAIN[s.type];
    if (drain) consumed += drain;
  }
  return { produced, consumed };
}

/** Calculate power production multiplier for tick-based systems.
 *  C++ factory.cpp:434: rate = time / Bound(Power_Fraction(), fixed(1,16), fixed(1))
 *  C++ house.cpp:4160: Power_Fraction() returns Power/Drain (or 0 if no power).
 *  At 100%+ power: 1.0. At <100%: powerFraction clamped to [1/16, 1.0].
 *  At 0% power: clamped to 1/16 (0.0625) = 16x slower production. */
export function powerMultiplier(produced: number, consumed: number): number {
  if (consumed <= 0 || consumed <= produced) return 1.0;
  if (produced <= 0) return 1 / 16; // C++ Bound(0, fixed(1,16), fixed(1)) = 1/16
  return Math.max(1 / 16, produced / consumed);
}

/** Calculate silo storage capacity from structures.
 *  PROC=2000, SILO=1500 (C++ rules.ini Storage= values) */
export function calculateSiloCapacity(
  structures: MapStructure[],
  playerHouse: House,
  isAllied: (a: House, b: House) => boolean,
): number {
  let capacity = 0;
  for (const s of structures) {
    if (!s.alive || !isAllied(s.house, playerHouse)) continue;
    if (s.buildProgress !== undefined && s.buildProgress < 1) continue;
    if (s.type === 'PROC') capacity += 2000;
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
    if (prodItem) ctx.credits += sellRefund(prodItem.cost, true); // sell mode = human
    return true;
  }
  s.sellProgress = 0;
  s.sellHpAtStart = s.hp;
  return true;
}

/** Tick structure repairs — called every 14 ticks from game loop.
 *  C++ rules.cpp:228-229 RepairStep=5, RepairPercent=0.25 */
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
 *  Called every 14 ticks. C++ parity: UREPAIR_STEP HP per tick (techno.cpp:987-1016). */
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
      // C++ building.cpp: docking distance is 0x10 leptons (~0.0625 cells).
      // Use 0.7 cells to match tightened auto-load proximity while remaining practical.
      if (dist < 0.7 && dist < bestDist) {
        docked = e;
        bestDist = dist;
      }
    }
    if (docked) {
      if (docked.hp < docked.maxHp) {
        const unitCost = ctx.scenarioProductionItems.find(p => p.type === docked!.type)?.cost ?? 400;
        const cost = unitRepairCostPerStep(unitCost, docked.maxHp);
        if (ctx.credits >= cost) {
          ctx.credits -= cost;
          docked.hp = Math.min(docked.maxHp, docked.hp + UREPAIR_STEP);
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
      // Rearm alongside repair (free) — C++ building.cpp:4023-4025 formula
      // tickServiceDepot runs every 14 game ticks, so decrement by 14 to match per-tick rate
      if (docked.maxAmmo > 0 && docked.ammo < docked.maxAmmo) {
        docked.rearmTimer = (docked.rearmTimer ?? 0) - 14;
        if (docked.rearmTimer <= 0) {
          docked.ammo++;
          const pfrac = ctx.powerConsumed <= 0 ? 1.0
            : Math.min(1.0, ctx.powerProduced / ctx.powerConsumed);
          docked.rearmTimer = computeRearmDelay(pfrac);
        }
      }
    }
  }
}
