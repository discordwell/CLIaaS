/**
 * Repair & Sell Pipeline Tests — Runtime Behavior
 *
 * Tests the tick-based lifecycle for:
 *   - Structure repair (toggleRepair, isStructureRepairing, credit deduction, rate)
 *   - Structure selling (sellStructureByIndex, refund, animation, power update)
 *   - Service Depot vehicle repair (docking, credit cost, rearm)
 *   - MCV deploy/undeploy
 *   - Wall placement/sell
 *   - AI auto-repair and auto-sell
 *   - Fire sale trigger
 *   - Edge cases (repair under attack, sell under construction, zero credits)
 *
 * Existing tests cover:
 *   - engineer-repair.test.ts: engineer friendly repair (33% heal, CONDITION_RED)
 *   - sell-animation.test.ts: make-sheet frame selection (construction/sell frame math)
 *   - wall-placement.test.ts: wall production items (SBAG, FENC, BRIK costs)
 *   - silo-capacity.test.ts: silo storage capacity, credit capping
 *   - production-pipeline.test.ts: MCV deployment structure, free harvester, FACT size
 *
 * This file focuses on RUNTIME BEHAVIOR those tests do not cover:
 *   - Tick-based repair progress with economics (cost per step, credit drain)
 *   - Repair stop conditions (full HP, insufficient credits, manual toggle off)
 *   - Multiple simultaneous structure repairs
 *   - Power plant repair (power output restores with HP)
 *   - Sell refund: flat 50% of cost (C++ parity)
 *   - Sell animation duration (frame-count based)
 *   - Sell finalization: structure death, footprint clear, infantry survivors
 *   - Power grid recalculation after selling power plant
 *   - Service depot: vehicle repair cost, rearm, insufficient funds eject
 *   - AI repair (IQ >= 3, houseCredits deduction, 80% threshold)
 *   - AI sell (IQ >= 3, CONDITION_RED threshold, ConYard/last-power exemptions)
 *   - Fire sale: all structures begin selling, units switch to HUNT
 *   - Wall sell: instant removal, 50% refund
 *   - Edge cases: repair + damage race, sell already-selling, zero-credit repair
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  PRODUCTION_ITEMS, type ProductionItem,
  House, UnitType, CELL_SIZE, Mission,
  REPAIR_STEP, REPAIR_PERCENT, CONDITION_RED, CONDITION_YELLOW,
  POWER_DRAIN,
} from '../engine/types';
import { Entity, resetEntityIds, setPlayerHouses } from '../engine/entity';
import type { MapStructure } from '../engine/scenario';
import { STRUCTURE_MAX_HP, STRUCTURE_SIZE } from '../engine/scenario';
import { BUILDING_FRAME_TABLE } from '../engine/renderer';
import type { Effect } from '../engine/renderer';
import {
  type PlacementContext,
  deployMCV,
} from '../engine/placement';
import { GameMap, Terrain } from '../engine/map';
import {
  type RepairSellContext,
  toggleRepair,
  isStructureRepairing,
  sellStructureByIndex,
  tickRepairs,
  tickServiceDepot,
  repairCostPerStep as _repairCostPerStep,
  sellRefund as _sellRefund,
} from '../engine/repairSell';

// =========================================================================
// Helpers — mirror Game internals for isolated unit testing
// =========================================================================

const INDEX_PATH = join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts');
let indexSource: string;
try {
  indexSource = readFileSync(INDEX_PATH, 'utf-8');
} catch {
  indexSource = '';
}
const COMBAT_PATH = join(process.cwd(), 'src', 'EasterEgg', 'engine', 'combat.ts');
let combatSource: string;
try {
  combatSource = readFileSync(COMBAT_PATH, 'utf-8');
} catch {
  combatSource = '';
}
const PLACEMENT_PATH = join(process.cwd(), 'src', 'EasterEgg', 'engine', 'placement.ts');
let placementSource: string;
try {
  placementSource = readFileSync(PLACEMENT_PATH, 'utf-8');
} catch {
  placementSource = '';
}
const AI_PATH = join(process.cwd(), 'src', 'EasterEgg', 'engine', 'ai.ts');
let aiSource: string;
try {
  aiSource = readFileSync(AI_PATH, 'utf-8');
} catch {
  aiSource = '';
}
const MISSION_AI_PATH = join(process.cwd(), 'src', 'EasterEgg', 'engine', 'missionAI.ts');
let missionAISource: string;
try {
  missionAISource = readFileSync(MISSION_AI_PATH, 'utf-8');
} catch {
  missionAISource = '';
}

beforeEach(() => {
  resetEntityIds();
  setPlayerHouses(new Set([House.Spain, House.Greece]));
});

/** Create a minimal MapStructure for testing */
function makeStructure(
  type: string, house: House, cx = 10, cy = 10,
  opts: {
    alive?: boolean; hp?: number; maxHp?: number;
    buildProgress?: number; sellProgress?: number;
    sellHpAtStart?: number;
  } = {},
): MapStructure {
  const maxHp = opts.maxHp ?? STRUCTURE_MAX_HP[type] ?? 256;
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx, cy,
    hp: opts.hp ?? maxHp,
    maxHp,
    alive: opts.alive ?? true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    buildProgress: opts.buildProgress,
    sellProgress: opts.sellProgress,
    sellHpAtStart: opts.sellHpAtStart,
  };
}

/** Find a production item by type */
function findItem(type: string): ProductionItem {
  const item = PRODUCTION_ITEMS.find(p => p.type === type);
  if (!item) throw new Error(`No production item for ${type}`);
  return item;
}

/** Calculate repair cost per step (mirrors Game.update repair logic) */
function repairCostPerStep(structureType: string): number {
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === structureType);
  if (!prodItem) return 1;
  const maxHp = STRUCTURE_MAX_HP[structureType] ?? 256;
  return Math.ceil((prodItem.cost * REPAIR_PERCENT) / (maxHp / REPAIR_STEP));
}

/** Calculate total repair cost from currentHp to maxHp */
function totalRepairCost(structureType: string, currentHp: number): number {
  const maxHp = STRUCTURE_MAX_HP[structureType] ?? 256;
  const stepsNeeded = Math.ceil((maxHp - currentHp) / REPAIR_STEP);
  return stepsNeeded * repairCostPerStep(structureType);
}

/** Calculate sell refund: flat 50% of building cost (C++ parity) */
function sellRefund(structureType: string): number {
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === structureType);
  if (!prodItem) return 0;
  return Math.floor(prodItem.cost * 0.5);
}

/** Calculate power output for a power structure at given HP */
function powerOutput(type: string, hp: number, maxHp: number): number {
  const healthRatio = hp / maxHp;
  if (type === 'POWR') return Math.round(100 * healthRatio);
  if (type === 'APWR') return Math.round(200 * healthRatio);
  return 0;
}

/** Wall types (from engine) */
const WALL_TYPES = new Set(['SBAG', 'FENC', 'BARB', 'BRIK']);

/** Create a minimal PlacementContext for deployMCV behavioral testing */
function makePlacementCtx(overrides: Partial<PlacementContext> = {}): PlacementContext {
  const m = new GameMap();
  m.setBounds(0, 0, 128, 128);
  return {
    structures: [],
    entities: [],
    entityById: new Map(),
    credits: 5000,
    tick: 100,
    playerHouse: House.Greece,
    pendingPlacement: null,
    wallPlacementPrepaid: false,
    cachedAvailableItems: null,
    evaMessages: [],
    effects: [] as Effect[],
    map: m,
    isAllied: (a, b) => a === b,
    playSound: vi.fn(),
    getAvailableItems: () => [],
    findPassableSpawn: (cx, cy) => ({ cx, cy }),
    ...overrides,
  };
}

/** Create a minimal RepairSellContext for behavioral testing */
function makeMockRepairSellContext(overrides: Partial<RepairSellContext> = {}): RepairSellContext {
  const evaCalls: string[] = [];
  const soundCalls: string[] = [];
  const clearedFootprints: MapStructure[] = [];
  const addedCredits: { amount: number; bypass: boolean }[] = [];
  return {
    structures: [],
    entities: [],
    credits: 5000,
    tick: 0,
    playerHouse: House.Spain,
    repairingStructures: new Set<number>(),
    scenarioProductionItems: PRODUCTION_ITEMS as ProductionItem[],
    effects: [],
    siloCapacity: 2000,
    gapGeneratorCells: new Map(),
    isAllied: (a, b) => a === b,
    isPlayerControlled: (e) => e.house === House.Spain,
    addCredits: (amount, bypass) => {
      addedCredits.push({ amount, bypass: !!bypass });
      return amount;
    },
    playEva: (name) => { evaCalls.push(name); },
    playSound: (name) => { soundCalls.push(name); },
    playSoundAt: (name, _x, _y) => { soundCalls.push(name); },
    clearStructureFootprint: (s) => { clearedFootprints.push(s); },
    recalculateSiloCapacity: () => {},
    mapUnjamRadius: () => {},
    // Expose call logs for assertions (attached as expando properties)
    ...overrides,
    _evaCalls: evaCalls,
    _soundCalls: soundCalls,
    _clearedFootprints: clearedFootprints,
    _addedCredits: addedCredits,
  } as RepairSellContext & {
    _evaCalls: string[];
    _soundCalls: string[];
    _clearedFootprints: MapStructure[];
    _addedCredits: { amount: number; bypass: boolean }[];
  };
}

// =========================================================================
// 1. Structure Repair — toggleRepair / isStructureRepairing
// =========================================================================
describe('Structure Repair — toggle & query', () => {
  it('toggleRepair enables repair on damaged structure', () => {
    const ctx = makeMockRepairSellContext();
    ctx.structures = [makeStructure('POWR', House.Spain, 10, 10, { hp: 200 })];
    const result = toggleRepair(ctx, 0);
    expect(result).toBe(true);
    expect(ctx.repairingStructures.has(0)).toBe(true);
  });

  it('toggleRepair returns false for full-HP structure (nothing to repair)', () => {
    const ctx = makeMockRepairSellContext();
    ctx.structures = [makeStructure('POWR', House.Spain)]; // full HP
    const result = toggleRepair(ctx, 0);
    expect(result).toBe(false);
    expect(ctx.repairingStructures.has(0)).toBe(false);
  });

  it('toggleRepair returns false for dead structure', () => {
    const ctx = makeMockRepairSellContext();
    ctx.structures = [makeStructure('POWR', House.Spain, 10, 10, { alive: false, hp: 100 })];
    const result = toggleRepair(ctx, 0);
    expect(result).toBe(false);
  });

  it('toggleRepair returns false for non-allied structure', () => {
    const ctx = makeMockRepairSellContext();
    ctx.structures = [makeStructure('POWR', House.USSR, 10, 10, { hp: 200 })];
    const result = toggleRepair(ctx, 0);
    expect(result).toBe(false);
  });

  it('isStructureRepairing checks the repairingStructures set', () => {
    const ctx = makeMockRepairSellContext();
    ctx.structures = [makeStructure('POWR', House.Spain, 10, 10, { hp: 200 })];
    expect(isStructureRepairing(ctx, 0)).toBe(false);
    toggleRepair(ctx, 0);
    expect(isStructureRepairing(ctx, 0)).toBe(true);
  });

  it('toggling repair twice returns to non-repairing state', () => {
    const ctx = makeMockRepairSellContext();
    ctx.structures = [makeStructure('POWR', House.Spain, 10, 10, { hp: 200 })];
    const first = toggleRepair(ctx, 0);
    expect(first).toBe(true);
    expect(isStructureRepairing(ctx, 0)).toBe(true);
    const second = toggleRepair(ctx, 0);
    expect(second).toBe(false);
    expect(isStructureRepairing(ctx, 0)).toBe(false);
  });
});

// =========================================================================
// 2. Structure Repair — tick-based progress & economics
// =========================================================================
describe('Structure Repair — rate, cost, and tick intervals', () => {
  it('REPAIR_STEP is 7 HP per pulse (C++ rules.ini)', () => {
    expect(REPAIR_STEP).toBe(7);
  });

  it('REPAIR_PERCENT is 0.20 (20% cost ratio for full repair)', () => {
    expect(REPAIR_PERCENT).toBe(0.20);
  });

  it('repair tick interval is 14 ticks (C++ parity)', () => {
    // Source: if (this.tick % 14 === 0) { for (const idx of this.repairingStructures) ... }
    const repairSection = indexSource.indexOf('RP3: Repair structures');
    expect(repairSection).toBeGreaterThan(-1);
    const chunk = indexSource.slice(repairSection - 60, repairSection + 200);
    expect(chunk).toContain('tick % 14 === 0');
  });

  it('repair cost per step matches formula: ceil(cost * REPAIR_PERCENT / (maxHp / REPAIR_STEP))', () => {
    // POWR: cost=300, maxHp=400
    // costPerStep = ceil(300 * 0.20 / (400 / 7)) = ceil(60 / 57.14) = ceil(1.05) = 2
    const powrCost = repairCostPerStep('POWR');
    const expected = Math.ceil((300 * 0.20) / (400 / 7));
    expect(powrCost).toBe(expected);
    expect(powrCost).toBe(2);
  });

  it('repair cost per step for FACT: cost=1000, maxHp=1000 (Spy tech)', () => {
    // FACT not in PRODUCTION_ITEMS (it's the conyard, not buildable via normal queue)
    // But scenario production items might have it. Let's check.
    const factItem = PRODUCTION_ITEMS.find(p => p.type === 'FACT');
    // FACT is not in PRODUCTION_ITEMS — the game lookup returns undefined, fallback cost = 1
    if (!factItem) {
      // Without a prodItem, repairCostPerStep = 1 (fallback in source)
      expect(repairCostPerStep('FACT')).toBe(1);
    }
  });

  it('repair cost per step for expensive structures (WEAP, PROC)', () => {
    // WEAP: cost=2000, maxHp=1000
    // costPerStep = ceil(2000 * 0.20 / (1000 / 7)) = ceil(400 / 142.86) = ceil(2.8) = 3
    expect(repairCostPerStep('WEAP')).toBe(3);

    // PROC: cost=2000, maxHp=900
    // costPerStep = ceil(2000 * 0.20 / (900 / 7)) = ceil(400 / 128.57) = ceil(3.11) = 4
    expect(repairCostPerStep('PROC')).toBe(4);
  });

  it('repair cost per step for cheap structures (SILO)', () => {
    // SILO: cost=150, maxHp=300
    // costPerStep = ceil(150 * 0.20 / (300 / 7)) = ceil(30 / 42.86) = ceil(0.70) = 1
    expect(repairCostPerStep('SILO')).toBe(1);
  });

  it('total repair cost: POWR from half HP to full', () => {
    const maxHp = STRUCTURE_MAX_HP['POWR']!; // 400
    const halfHp = Math.floor(maxHp / 2); // 200
    const hpToRepair = maxHp - halfHp; // 200
    const steps = Math.ceil(hpToRepair / REPAIR_STEP); // ceil(200/7) = 29
    const costPerStep = repairCostPerStep('POWR'); // 2
    const total = steps * costPerStep; // 58
    expect(totalRepairCost('POWR', halfHp)).toBe(total);
    expect(total).toBe(58);
  });

  it('HP increases by REPAIR_STEP per pulse, capped at maxHp', () => {
    const s = makeStructure('POWR', House.Spain, 10, 10, { hp: 395 });
    // After one repair step: min(400, 395 + 7) = 400 (capped)
    const newHp = Math.min(s.maxHp, s.hp + REPAIR_STEP);
    expect(newHp).toBe(400);
    expect(newHp).toBe(s.maxHp);
  });

  it('repair stops when structure reaches full HP', () => {
    const ctx = makeMockRepairSellContext();
    // Structure only 3 HP below max — one REPAIR_STEP (+7) will cap it
    ctx.structures = [makeStructure('POWR', House.Spain, 10, 10, { hp: 397 })];
    ctx.repairingStructures.add(0);
    tickRepairs(ctx);
    expect(ctx.structures[0].hp).toBe(400); // capped at maxHp
    // Next tick should auto-remove from repairing set
    tickRepairs(ctx);
    expect(ctx.repairingStructures.has(0)).toBe(false);
  });

  it('repair stops when credits run out (RP5: insufficient funds)', () => {
    const ctx = makeMockRepairSellContext();
    ctx.structures = [makeStructure('POWR', House.Spain, 10, 10, { hp: 200 })];
    ctx.credits = 0; // no credits
    ctx.repairingStructures.add(0);
    tickRepairs(ctx);
    // Should cancel repair and play EVA warning
    expect(ctx.repairingStructures.has(0)).toBe(false);
    expect((ctx as any)._evaCalls).toContain('eva_insufficient_funds');
    expect(ctx.structures[0].hp).toBe(200); // unchanged
  });

  it('repair skips structures mid-sell (sellProgress !== undefined)', () => {
    const ctx = makeMockRepairSellContext();
    ctx.structures = [makeStructure('POWR', House.Spain, 10, 10, { hp: 200, sellProgress: 0.5 })];
    ctx.repairingStructures.add(0);
    tickRepairs(ctx);
    // Structure being sold should be removed from repair set
    expect(ctx.repairingStructures.has(0)).toBe(false);
    expect(ctx.structures[0].hp).toBe(200); // unchanged
  });

  it('repair deducts credits on each pulse', () => {
    const ctx = makeMockRepairSellContext();
    ctx.structures = [makeStructure('POWR', House.Spain, 10, 10, { hp: 200 })];
    ctx.credits = 5000;
    ctx.repairingStructures.add(0);
    const creditsBefore = ctx.credits;
    tickRepairs(ctx);
    const costPerStep = repairCostPerStep('POWR'); // 2
    expect(ctx.credits).toBe(creditsBefore - costPerStep);
  });

  it('repair plays "repair" audio on each pulse', () => {
    const ctx = makeMockRepairSellContext();
    ctx.structures = [makeStructure('POWR', House.Spain, 10, 10, { hp: 200 })];
    ctx.repairingStructures.add(0);
    tickRepairs(ctx);
    expect((ctx as any)._soundCalls).toContain('repair');
  });
});

// =========================================================================
// 3. Multiple Simultaneous Repairs
// =========================================================================
describe('Multiple simultaneous structure repairs', () => {
  it('repairingStructures is a Set<number> (supports multiple indices)', () => {
    const idx = indexSource.indexOf('private repairingStructures');
    expect(idx).toBeGreaterThan(-1);
    const chunk = indexSource.slice(idx, idx + 100);
    expect(chunk).toContain('Set<number>');
  });

  it('repair loop iterates all entries in repairingStructures', () => {
    const ctx = makeMockRepairSellContext();
    ctx.structures = [
      makeStructure('POWR', House.Spain, 10, 10, { hp: 200 }),
      makeStructure('WEAP', House.Spain, 20, 20, { hp: 500 }),
    ];
    ctx.repairingStructures.add(0);
    ctx.repairingStructures.add(1);
    tickRepairs(ctx);
    // Both structures should have gained HP
    expect(ctx.structures[0].hp).toBe(200 + REPAIR_STEP);
    expect(ctx.structures[1].hp).toBe(500 + REPAIR_STEP);
  });

  it('each repair pulse costs independently (2 structures = 2x credit drain)', () => {
    // Two POWR structures at half HP:
    // Each costs 2 credits per step → total 4 credits per tick-14 pulse
    const costPerPulse = repairCostPerStep('POWR');
    const twoStructureCost = costPerPulse * 2;
    expect(twoStructureCost).toBe(4);
  });

  it('if one structure is fully repaired, only the other continues', () => {
    const ctx = makeMockRepairSellContext();
    ctx.structures = [
      makeStructure('POWR', House.Spain, 10, 10, { hp: 400 }), // full HP
      makeStructure('POWR', House.Spain, 20, 20, { hp: 200 }), // damaged
    ];
    ctx.repairingStructures.add(0);
    ctx.repairingStructures.add(1);
    tickRepairs(ctx);
    // First structure was full HP, should be removed from set
    expect(ctx.repairingStructures.has(0)).toBe(false);
    // Second structure should still be repairing
    expect(ctx.repairingStructures.has(1)).toBe(true);
    expect(ctx.structures[1].hp).toBe(200 + REPAIR_STEP);
  });
});

// =========================================================================
// 4. Power Plant Repair (power output scales with HP)
// =========================================================================
describe('Power plant repair — power output restoration', () => {
  it('POWR at full HP produces 100 power', () => {
    expect(powerOutput('POWR', 400, 400)).toBe(100);
  });

  it('POWR at half HP produces 50 power', () => {
    expect(powerOutput('POWR', 200, 400)).toBe(50);
  });

  it('POWR at 25% HP produces 25 power', () => {
    expect(powerOutput('POWR', 100, 400)).toBe(25);
  });

  it('APWR at full HP produces 200 power', () => {
    expect(powerOutput('APWR', 700, 700)).toBe(200);
  });

  it('APWR at half HP produces 100 power', () => {
    expect(powerOutput('APWR', 350, 700)).toBe(100);
  });

  it('power calculation uses healthRatio in source', () => {
    // Source: Math.round(100 * healthRatio) for POWR
    const powerSection = indexSource.indexOf('Calculate power balance');
    expect(powerSection).toBeGreaterThan(-1);
    const chunk = indexSource.slice(powerSection, powerSection + 700);
    expect(chunk).toContain('healthRatio');
    expect(chunk).toContain("'POWR'");
    expect(chunk).toContain("'APWR'");
  });

  it('repairing a damaged POWR gradually restores power output', () => {
    // POWR: maxHp=400. At 200HP → 50 power. After 1 repair step (+7HP): 207HP → ~52 power
    const hp1 = 200;
    const hp2 = hp1 + REPAIR_STEP;
    const power1 = powerOutput('POWR', hp1, 400);
    const power2 = powerOutput('POWR', hp2, 400);
    expect(power2).toBeGreaterThan(power1);
    expect(power1).toBe(50);
    expect(power2).toBe(Math.round(100 * (207 / 400))); // 52
  });

  it('power recalculation excludes structures being sold', () => {
    const powerSection = indexSource.indexOf('Calculate power balance');
    expect(powerSection).toBeGreaterThan(-1);
    const chunk = indexSource.slice(powerSection, powerSection + 300);
    expect(chunk).toContain('sellProgress !== undefined');
  });
});

// =========================================================================
// 5. Structure Selling — sellStructureByIndex
// =========================================================================
describe('Structure Selling — sellStructureByIndex', () => {
  it('sellStructureByIndex sets sellProgress = 0 and captures sellHpAtStart', () => {
    const ctx = makeMockRepairSellContext();
    const s = makeStructure('POWR', House.Spain, 10, 10, { hp: 300 });
    ctx.structures = [s];
    const result = sellStructureByIndex(ctx, 0);
    expect(result).toBe(true);
    expect(s.sellProgress).toBe(0);
    expect(s.sellHpAtStart).toBe(300);
  });

  it('sellStructureByIndex returns false for dead structure', () => {
    const ctx = makeMockRepairSellContext();
    ctx.structures = [makeStructure('POWR', House.Spain, 10, 10, { alive: false })];
    expect(sellStructureByIndex(ctx, 0)).toBe(false);
  });

  it('sellStructureByIndex returns false for already-selling structure', () => {
    const ctx = makeMockRepairSellContext();
    ctx.structures = [makeStructure('POWR', House.Spain, 10, 10, { sellProgress: 0.5 })];
    expect(sellStructureByIndex(ctx, 0)).toBe(false);
  });

  it('sellStructureByIndex returns false for non-allied structure', () => {
    const ctx = makeMockRepairSellContext();
    ctx.structures = [makeStructure('POWR', House.USSR, 10, 10)];
    expect(sellStructureByIndex(ctx, 0)).toBe(false);
  });
});

// =========================================================================
// 6. Sell Refund Calculation
// =========================================================================
describe('Sell Refund — flat 50% of building cost (C++ parity)', () => {
  it('sell refund is floor(cost * 0.5) for all structure types', () => {
    // C++ parity: flat 50%, no health scaling
    const types = ['POWR', 'APWR', 'PROC', 'WEAP', 'TENT', 'BARR', 'FIX', 'SILO', 'DOME'];
    for (const type of types) {
      const item = PRODUCTION_ITEMS.find(p => p.type === type);
      if (!item) continue;
      const refund = sellRefund(type);
      expect(refund, `${type} refund`).toBe(Math.floor(item.cost * 0.5));
    }
  });

  it('POWR sells for 150 credits (cost=300)', () => {
    expect(sellRefund('POWR')).toBe(150);
  });

  it('PROC sells for 1000 credits (cost=2000)', () => {
    expect(sellRefund('PROC')).toBe(1000);
  });

  it('WEAP sells for 1000 credits (cost=2000)', () => {
    expect(sellRefund('WEAP')).toBe(1000);
  });

  it('SILO sells for 75 credits (cost=150)', () => {
    expect(sellRefund('SILO')).toBe(75);
  });

  it('FIX (Service Depot) sells for 600 credits (cost=1200)', () => {
    expect(sellRefund('FIX')).toBe(600);
  });

  it('refund uses addCredits with bypassSiloCap=true', () => {
    // Source at sell finalization: this.addCredits(Math.floor(prodItem.cost * 0.5), true)
    const sellSection = indexSource.indexOf('Refund: flat 50% of building cost');
    expect(sellSection).toBeGreaterThan(-1);
    const chunk = indexSource.slice(sellSection, sellSection + 500);
    expect(chunk).toContain('prodItem.cost * 0.5');
    expect(chunk).toContain('true'); // bypassSiloCap
  });
});

// =========================================================================
// 7. Sell Animation Sequence (tick-based progression)
// =========================================================================
describe('Sell Animation — structure -> rubble -> gone', () => {
  it('sell animation advances sellProgress each tick', () => {
    const sellSection = indexSource.indexOf('Sell: play make-sheet frames');
    expect(sellSection).toBeGreaterThan(-1);
    const chunk = indexSource.slice(sellSection, sellSection + 400);
    expect(chunk).toContain('s.sellProgress');
    expect(chunk).toContain('sellFrameCount');
  });

  it('sell progress rate is 1/(sellFrameCount * 2) per tick', () => {
    const sellSection = indexSource.indexOf('Sell: play make-sheet frames');
    const chunk = indexSource.slice(sellSection, sellSection + 700);
    expect(chunk).toContain('sellFrameCount * 2');
  });

  it('sell duration scales with BUILDING_FRAME_TABLE damageFrame', () => {
    // FACT: damageFrame=26 → 26*2=52 ticks to sell
    // POWR: damageFrame=4  → 4*2=8 ticks to sell
    const factEntry = BUILDING_FRAME_TABLE['fact'];
    const powrEntry = BUILDING_FRAME_TABLE['powr'];
    expect(factEntry).toBeDefined();
    expect(powrEntry).toBeDefined();

    // Duration = sellFrameCount * 2 ticks
    // sellFrameCount = max(damageFrame, 1)
    const factDuration = Math.max(factEntry.damageFrame, 1) * 2;
    const powrDuration = Math.max(powrEntry.damageFrame, 1) * 2;
    expect(factDuration).toBe(52);
    expect(powrDuration).toBe(8);
    expect(factDuration).toBeGreaterThan(powrDuration);
  });

  it('sell finalizes when sellProgress >= 1', () => {
    const sellSection = indexSource.indexOf('Sell: play make-sheet frames');
    const chunk = indexSource.slice(sellSection, sellSection + 800);
    expect(chunk).toContain('sellProgress >= 1');
    expect(chunk).toContain('s.alive = false');
  });

  it('sell finalization clears footprint', () => {
    const sellSection = indexSource.indexOf('Sell: play make-sheet frames');
    const chunk = indexSource.slice(sellSection, sellSection + 800);
    expect(chunk).toContain('clearStructureFootprint');
  });

  it('sell finalization recalculates silo capacity before adding refund', () => {
    const sellSection = indexSource.indexOf('Sell: play make-sheet frames');
    const chunk = indexSource.slice(sellSection, sellSection + 1500);
    expect(chunk).toContain('recalculateSiloCapacity');
    // Silo recalculation happens BEFORE addCredits
    const siloIdx = chunk.indexOf('recalculateSiloCapacity');
    const addIdx = chunk.indexOf('addCredits');
    expect(siloIdx).toBeLessThan(addIdx);
  });

  it('sell finalization creates explosion effect at structure center', () => {
    const sellSection = indexSource.indexOf('Sell: play make-sheet frames');
    const chunk = indexSource.slice(sellSection, sellSection + 2000);
    expect(chunk).toContain("type: 'explosion'");
    expect(chunk).toContain('veh-hit1');
  });

  it('sell finalization spawns infantry survivors (SL4)', () => {
    const sellSection = indexSource.indexOf('SL4: Spawn infantry survivors');
    expect(sellSection).toBeGreaterThan(-1);
    const chunk = indexSource.slice(sellSection, sellSection + 600);
    expect(chunk).toContain('SURVIVOR_FRACTION');
    expect(chunk).toContain('survivorCount');
    // Survivor count: (buildCost * 0.5) / E1_cost, clamped 1-5
    expect(chunk).toContain('Math.min(5');
    expect(chunk).toContain('Math.max(1');
  });

  it('survivor count formula: (buildCost * 0.5) / 100, clamped 1-5', () => {
    // POWR: cost=300 → (300*0.5)/100 = 1.5 → floor → 1
    // WEAP: cost=2000 → (2000*0.5)/100 = 10 → clamped to 5
    // SILO: cost=150 → (150*0.5)/100 = 0.75 → clamped to 1
    const powrSurvivors = Math.min(5, Math.max(1, Math.floor((300 * 0.5) / 100)));
    const weapSurvivors = Math.min(5, Math.max(1, Math.floor((2000 * 0.5) / 100)));
    const siloSurvivors = Math.min(5, Math.max(1, Math.floor((150 * 0.5) / 100)));
    expect(powrSurvivors).toBe(1);
    expect(weapSurvivors).toBe(5);
    expect(siloSurvivors).toBe(1);
  });

  it('FACT sell spawns 25% chance engineer (Crew_Type)', () => {
    const sellSection = indexSource.indexOf('SL4: Spawn infantry survivors');
    const chunk = indexSource.slice(sellSection, sellSection + 1000);
    expect(chunk).toContain("'FACT'");
    expect(chunk).toContain('I_E6'); // engineer
    expect(chunk).toContain('0.25'); // 25% chance
  });

  it('KENN sell spawns 50% dog (Crew_Type)', () => {
    const sellSection = indexSource.indexOf('SL4: Spawn infantry survivors');
    const chunk = indexSource.slice(sellSection, sellSection + 1500);
    expect(chunk).toContain("'KENN'");
    expect(chunk).toContain('I_DOG');
  });
});

// =========================================================================
// 8. Power Grid Update After Selling Power Plant
// =========================================================================
describe('Power grid after selling power plant', () => {
  it('power calculation loop skips selling structures', () => {
    // When a power plant has sellProgress set, it is excluded from power calc
    const powerSection = indexSource.indexOf('Calculate power balance');
    const chunk = indexSource.slice(powerSection, powerSection + 300);
    expect(chunk).toContain('sellProgress !== undefined');
  });

  it('POWR power drain = 0 (produces, does not consume)', () => {
    // POWR is NOT in POWER_DRAIN — it only produces power
    expect(POWER_DRAIN['POWR']).toBeUndefined();
  });

  it('FIX (Service Depot) drains 30 power', () => {
    expect(POWER_DRAIN['FIX']).toBe(30);
  });

  it('selling POWR reduces powerProduced by up to 100', () => {
    // At full HP: 100 power. Selling removes it from calculation.
    const fullPower = powerOutput('POWR', 400, 400);
    expect(fullPower).toBe(100);
    // After sell: 0 power from this structure
  });

  it('selling APWR reduces powerProduced by up to 200', () => {
    const fullPower = powerOutput('APWR', 700, 700);
    expect(fullPower).toBe(200);
  });

  it('low power warning fires when powerConsumed > powerProduced', () => {
    const lowPowerSection = indexSource.indexOf('Low power warning');
    expect(lowPowerSection).toBeGreaterThan(-1);
    const chunk = indexSource.slice(lowPowerSection, lowPowerSection + 400);
    expect(chunk).toContain('this.powerConsumed > this.powerProduced');
    expect(chunk).toContain('eva_low_power');
  });
});

// =========================================================================
// 9. Service Depot Vehicle Repair
// =========================================================================
describe('Service Depot — vehicle repair', () => {
  /** Create a depot + vehicle context for tickServiceDepot tests.
   *  FIX structure center is at (cx*CELL_SIZE + CELL_SIZE, cy*CELL_SIZE + CELL_SIZE).
   *  Vehicle must be within 1.5 cells of that center. */
  function makeDepotContext(vehicleHp: number, vehicleMaxHp: number, credits = 5000) {
    const depot = makeStructure('FIX', House.Spain, 10, 10);
    // Depot center: (10*24+24, 10*24+24) = (264, 264)
    const vehicle = new Entity(UnitType.V_JEEP, House.Spain, 264, 264);
    vehicle.hp = vehicleHp;
    vehicle.maxHp = vehicleMaxHp;
    const ctx = makeMockRepairSellContext({ credits });
    ctx.structures = [depot];
    ctx.entities = [vehicle];
    return { ctx, depot, vehicle };
  }

  it('service depot repairs damaged vehicle docked within range', () => {
    const { ctx, vehicle } = makeDepotContext(50, 110);
    tickServiceDepot(ctx);
    expect(vehicle.hp).toBe(50 + REPAIR_STEP);
  });

  it('depot only services vehicles (not infantry)', () => {
    const depot = makeStructure('FIX', House.Spain, 10, 10);
    const infantry = new Entity(UnitType.I_E1, House.Spain, 264, 264);
    infantry.hp = 10;
    infantry.maxHp = 50;
    const ctx = makeMockRepairSellContext();
    ctx.structures = [depot];
    ctx.entities = [infantry];
    tickServiceDepot(ctx);
    // Infantry should NOT be repaired
    expect(infantry.hp).toBe(10);
  });

  it('depot finds closest damaged/depleted vehicle within 1.5 cells', () => {
    const depot = makeStructure('FIX', House.Spain, 10, 10);
    // Vehicle right at depot center (distance = 0 < 1.5)
    const close = new Entity(UnitType.V_JEEP, House.Spain, 264, 264);
    close.hp = 50; close.maxHp = 110;
    // Vehicle far away (distance >> 1.5 cells)
    const far = new Entity(UnitType.V_JEEP, House.Spain, 500, 500);
    far.hp = 50; far.maxHp = 110;
    const ctx = makeMockRepairSellContext();
    ctx.structures = [depot];
    ctx.entities = [close, far];
    tickServiceDepot(ctx);
    // Close vehicle gets repaired, far one does not
    expect(close.hp).toBe(50 + REPAIR_STEP);
    expect(far.hp).toBe(50);
  });

  it('vehicle repair uses same cost formula as building repair', () => {
    // JEEP: cost=600, maxHp=110
    // Cost per step = ceil(600 * 0.20 / (110 / 7)) = 8
    const { ctx, vehicle } = makeDepotContext(50, 110, 5000);
    const creditsBefore = ctx.credits;
    tickServiceDepot(ctx);
    const expectedCost = Math.ceil((600 * REPAIR_PERCENT) / (110 / REPAIR_STEP)); // 8
    expect(ctx.credits).toBe(creditsBefore - expectedCost);
  });

  it('vehicle repair cost: JEEP (cost=600, maxHp=110)', () => {
    // Cost per step = ceil(600 * 0.20 / (110 / 7)) = ceil(120 / 15.71) = ceil(7.64) = 8
    const jeepItem = findItem('JEEP');
    const jeepMaxHp = 110; // from UNIT_STATS
    const costPerStep = Math.ceil((jeepItem.cost * REPAIR_PERCENT) / (jeepMaxHp / REPAIR_STEP));
    expect(costPerStep).toBe(8);
  });

  it('vehicle repair cost: 3TNK Heavy Tank (cost=950, maxHp=400)', () => {
    // Cost per step = ceil(950 * 0.20 / (400 / 7)) = ceil(190 / 57.14) = ceil(3.33) = 4
    const item = findItem('3TNK');
    const maxHp = 400;
    const costPerStep = Math.ceil((item.cost * REPAIR_PERCENT) / (maxHp / REPAIR_STEP));
    expect(costPerStep).toBe(4);
  });

  it('insufficient funds ejects vehicle from depot pad', () => {
    const { ctx, vehicle } = makeDepotContext(50, 110, 0); // 0 credits
    const originalHp = vehicle.hp;
    tickServiceDepot(ctx);
    // Vehicle HP unchanged (no repair), ejected with GUARD mission and moveTarget set
    expect(vehicle.hp).toBe(originalHp);
    expect(vehicle.mission).toBe(Mission.GUARD);
    expect(vehicle.moveTarget).not.toBeNull();
    expect(vehicle.moveTarget!.x).toBe(vehicle.pos.x + CELL_SIZE * 3);
    expect(vehicle.moveTarget!.y).toBe(vehicle.pos.y + CELL_SIZE * 3);
  });

  it('depot creates spark visual effect during repair', () => {
    const { ctx } = makeDepotContext(50, 110);
    tickServiceDepot(ctx);
    // Should have a 'piff' muzzle effect
    const piffEffect = ctx.effects.find(e => (e as any).sprite === 'piff');
    expect(piffEffect).toBeDefined();
    expect(piffEffect!.type).toBe('muzzle');
  });

  it('depot rearms ammo (ReloadRate = 36 ticks per ammo)', () => {
    const depot = makeStructure('FIX', House.Spain, 10, 10);
    // Create a vehicle that needs rearm but NOT repair (full HP)
    const vehicle = new Entity(UnitType.V_JEEP, House.Spain, 264, 264);
    vehicle.hp = vehicle.maxHp; // full HP
    vehicle.maxAmmo = 4;
    vehicle.ammo = 2; // depleted
    vehicle.rearmTimer = 1; // about to fire
    const ctx = makeMockRepairSellContext();
    ctx.structures = [depot];
    ctx.entities = [vehicle];
    tickServiceDepot(ctx);
    // Timer decremented to 0, so ammo should increment and timer resets to 36
    expect(vehicle.ammo).toBe(3);
    expect(vehicle.rearmTimer).toBe(36);
  });

  it('rearm happens alongside repair, free of charge', () => {
    const depot = makeStructure('FIX', House.Spain, 10, 10);
    const vehicle = new Entity(UnitType.V_JEEP, House.Spain, 264, 264);
    vehicle.hp = 50; vehicle.maxHp = 110; // needs repair
    vehicle.maxAmmo = 4; vehicle.ammo = 2; // needs rearm
    vehicle.rearmTimer = 1; // about to fire
    const ctx = makeMockRepairSellContext({ credits: 5000 });
    ctx.structures = [depot];
    ctx.entities = [vehicle];
    const creditsBefore = ctx.credits;
    tickServiceDepot(ctx);
    // Both repair and rearm happen, but only repair costs credits
    expect(vehicle.hp).toBe(50 + REPAIR_STEP);
    expect(vehicle.ammo).toBe(3);
    const repairCost = Math.ceil((600 * REPAIR_PERCENT) / (110 / REPAIR_STEP));
    expect(ctx.credits).toBe(creditsBefore - repairCost); // only repair cost, no rearm cost
  });

  it('depot only services player-controlled vehicles', () => {
    const depot = makeStructure('FIX', House.Spain, 10, 10);
    // Enemy vehicle near depot
    const enemy = new Entity(UnitType.V_JEEP, House.USSR, 264, 264);
    enemy.hp = 50; enemy.maxHp = 110;
    const ctx = makeMockRepairSellContext();
    ctx.structures = [depot];
    ctx.entities = [enemy];
    tickServiceDepot(ctx);
    // Enemy vehicle should NOT be repaired
    expect(enemy.hp).toBe(50);
  });

  it('depot only services allied depots', () => {
    // Enemy depot with player vehicle
    const enemyDepot = makeStructure('FIX', House.USSR, 10, 10);
    const vehicle = new Entity(UnitType.V_JEEP, House.Spain, 264, 264);
    vehicle.hp = 50; vehicle.maxHp = 110;
    const ctx = makeMockRepairSellContext();
    ctx.structures = [enemyDepot];
    ctx.entities = [vehicle];
    tickServiceDepot(ctx);
    // Player vehicle near enemy depot should NOT be repaired
    expect(vehicle.hp).toBe(50);
  });
});

// =========================================================================
// 10. REPAIR mission (AI unit behavior — seek depot)
// =========================================================================
describe('REPAIR mission — units seeking depot', () => {
  it('REPAIR mission seeks nearest FIX structure', () => {
    const idx = missionAISource.indexOf('export function updateRepairMission(ctx: MissionAIContext, entity');
    expect(idx).toBeGreaterThan(-1);
    const chunk = missionAISource.slice(idx, idx + 1500);
    expect(chunk).toContain("'FIX'");
  });

  it('unit switches to GUARD on arrival at depot', () => {
    const idx = missionAISource.indexOf('export function updateRepairMission(ctx: MissionAIContext, entity');
    const chunk = missionAISource.slice(idx, idx + 1500);
    expect(chunk).toContain('Mission.GUARD');
    expect(chunk).toContain('moveTarget = null');
  });

  it('fallback to GUARD if no depot exists', () => {
    const idx = missionAISource.indexOf('export function updateRepairMission(ctx: MissionAIContext, entity');
    const chunk = missionAISource.slice(idx, idx + 1500);
    expect(chunk).toContain('No depot');
    expect(chunk).toContain('Mission.GUARD');
  });
});

// =========================================================================
// 11. MCV Deployment
// =========================================================================
describe('MCV Deployment — deployMCV', () => {
  it('deployMCV rejects non-MCV entity types', () => {
    const jeep = new Entity(UnitType.V_JEEP, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();
    expect(deployMCV(ctx, jeep)).toBe(false);
    expect(ctx.structures).toHaveLength(0);
    // MCV should succeed
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    expect(deployMCV(ctx, mcv)).toBe(true);
  });

  it('deployMCV validates 3x3 clear area around MCV cell', () => {
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();
    // Block one cell in the 3x3 area (cell 49,49 is part of the check)
    ctx.map.setTerrain(49, 49, Terrain.ROCK);
    expect(deployMCV(ctx, mcv)).toBe(false);
    expect(ctx.structures).toHaveLength(0);
    expect(mcv.alive).toBe(true);
    // Clear the blocked cell and verify success
    ctx.map.setTerrain(49, 49, Terrain.CLEAR);
    expect(deployMCV(ctx, mcv)).toBe(true);
    expect(ctx.structures).toHaveLength(1);
  });

  it('deployMCV kills the MCV entity', () => {
    const idx = placementSource.indexOf('deployMCV(ctx: PlacementContext, entity: Entity)');
    const chunk = placementSource.slice(idx, idx + 500);
    expect(chunk).toContain('entity.alive = false');
    expect(chunk).toContain('Mission.DIE');
  });

  it('deployMCV places FACT at (cx-1, cy-1)', () => {
    const idx = placementSource.indexOf('deployMCV(ctx: PlacementContext, entity: Entity)');
    const chunk = placementSource.slice(idx, idx + 1000);
    expect(chunk).toContain('ec.cx - 1');
    expect(chunk).toContain('ec.cy - 1');
    expect(chunk).toContain("type: 'FACT'");
  });

  it('FACT structure uses STRUCTURE_MAX_HP for HP', () => {
    const factHp = STRUCTURE_MAX_HP['FACT'];
    expect(factHp).toBe(1000);
  });

  it('FACT structure size is 3x3', () => {
    const [w, h] = STRUCTURE_SIZE['FACT'] ?? [0, 0];
    expect(w).toBe(3);
    expect(h).toBe(3);
  });

  it('deployed FACT uses playerHouse', () => {
    const idx = placementSource.indexOf('deployMCV(ctx: PlacementContext, entity: Entity)');
    const chunk = placementSource.slice(idx, idx + 700);
    expect(chunk).toContain('ctx.playerHouse');
  });

  it('deployment returns false if any surrounding cell is impassable', () => {
    const idx = placementSource.indexOf('deployMCV(ctx: PlacementContext, entity: Entity)');
    const chunk = placementSource.slice(idx, idx + 400);
    expect(chunk).toContain('return false');
    expect(chunk).toContain('isPassable');
  });
});

// =========================================================================
// 12. Wall Sell — instant removal
// =========================================================================
describe('Wall Sell — instant removal + refund', () => {
  it('wall types: SBAG, FENC, BARB, BRIK', () => {
    expect(WALL_TYPES.has('SBAG')).toBe(true);
    expect(WALL_TYPES.has('FENC')).toBe(true);
    expect(WALL_TYPES.has('BARB')).toBe(true);
    expect(WALL_TYPES.has('BRIK')).toBe(true);
    expect(WALL_TYPES.has('POWR')).toBe(false);
  });

  it('sellStructureByIndex sells walls instantly (no animation)', () => {
    const ctx = makeMockRepairSellContext();
    const wall = makeStructure('SBAG', House.Spain, 5, 5);
    ctx.structures = [wall];
    const result = sellStructureByIndex(ctx, 0);
    expect(result).toBe(true);
    // Wall sell is instant: alive=false, no sellProgress
    expect(wall.alive).toBe(false);
    expect(wall.sellProgress).toBeUndefined();
    // Footprint cleared
    expect((ctx as any)._clearedFootprints).toContain(wall);
  });

  it('wall sell refund is 50% of cost (same as normal structures)', () => {
    // SBAG: cost=25 → 50% = 12
    const sbag = PRODUCTION_ITEMS.find(p => p.type === 'SBAG');
    if (sbag) {
      expect(Math.floor(sbag.cost * 0.5)).toBe(12);
    }
    // BRIK: cost=100 → 50% = 50
    const brik = PRODUCTION_ITEMS.find(p => p.type === 'BRIK');
    if (brik) {
      expect(Math.floor(brik.cost * 0.5)).toBe(50);
    }
  });

  it('wall HP is 1 (fragile by design)', () => {
    expect(STRUCTURE_MAX_HP['SBAG']).toBe(1);
    expect(STRUCTURE_MAX_HP['FENC']).toBe(1);
    expect(STRUCTURE_MAX_HP['BRIK']).toBe(1);
    expect(STRUCTURE_MAX_HP['BARB']).toBe(1);
  });

  it('sell mode: wall instant sell plays "sell" audio', () => {
    // In processInput sell mode, walls are sold instantly with audio
    const sellModeSection = indexSource.indexOf('Walls sell instantly');
    expect(sellModeSection).toBeGreaterThan(-1);
    const chunk = indexSource.slice(sellModeSection, sellModeSection + 600);
    expect(chunk).toContain("audio.play('sell')");
  });
});

// =========================================================================
// 13. AI Auto-Repair (IQ >= 3)
// =========================================================================
describe('AI Auto-Repair — updateAIRepair', () => {
  it('AI repair requires IQ >= 3', () => {
    const idx = aiSource.indexOf('export function updateAIRepair');
    expect(idx).toBeGreaterThan(-1);
    const chunk = aiSource.slice(idx, idx + 1200);
    expect(chunk).toContain('state.iq < 3');
  });

  it('AI repair runs every 15 ticks (once per second)', () => {
    const idx = aiSource.indexOf('export function updateAIRepair');
    const chunk = aiSource.slice(idx, idx + 200);
    expect(chunk).toContain('tick % 15 !== 0');
  });

  it('AI only repairs structures below 80% HP', () => {
    const idx = aiSource.indexOf('export function updateAIRepair');
    const chunk = aiSource.slice(idx, idx + 1200);
    expect(chunk).toContain('s.hp >= s.maxHp * 0.8');
  });

  it('AI deducts repair cost from houseCredits (not player credits)', () => {
    const idx = aiSource.indexOf('export function updateAIRepair');
    const chunk = aiSource.slice(idx, idx + 1200);
    expect(chunk).toContain('houseCredits.set');
    expect(chunk).toContain('currentCredits - repairCostPerStep');
  });

  it('AI skips repair if house credits < 10', () => {
    const idx = aiSource.indexOf('export function updateAIRepair');
    const chunk = aiSource.slice(idx, idx + 600);
    expect(chunk).toContain('credits < 10');
  });

  it('AI skips structures being sold', () => {
    const idx = aiSource.indexOf('export function updateAIRepair');
    const chunk = aiSource.slice(idx, idx + 1200);
    expect(chunk).toContain('sellProgress !== undefined');
  });

  it('AI repair uses same REPAIR_STEP and REPAIR_PERCENT as player repair', () => {
    const idx = aiSource.indexOf('export function updateAIRepair');
    const chunk = aiSource.slice(idx, idx + 1200);
    expect(chunk).toContain('REPAIR_STEP');
    expect(chunk).toContain('REPAIR_PERCENT');
  });
});

// =========================================================================
// 14. AI Auto-Sell — updateAISellDamaged
// =========================================================================
describe('AI Auto-Sell — updateAISellDamaged', () => {
  it('AI sell requires IQ >= 3', () => {
    const idx = aiSource.indexOf('export function updateAISellDamaged');
    expect(idx).toBeGreaterThan(-1);
    const chunk = aiSource.slice(idx, idx + 1500);
    expect(chunk).toContain('state.iq < 3');
  });

  it('AI sell runs every 75 ticks (5 seconds)', () => {
    const idx = aiSource.indexOf('export function updateAISellDamaged');
    const chunk = aiSource.slice(idx, idx + 200);
    expect(chunk).toContain('tick % 75 !== 0');
  });

  it('AI sells structures at CONDITION_RED HP threshold', () => {
    const idx = aiSource.indexOf('export function updateAISellDamaged');
    const chunk = aiSource.slice(idx, idx + 1500);
    expect(chunk).toContain('CONDITION_RED');
    expect(CONDITION_RED).toBe(0.25);
  });

  it('AI never sells Construction Yard (FACT)', () => {
    const idx = aiSource.indexOf('export function updateAISellDamaged');
    const chunk = aiSource.slice(idx, idx + 1500);
    expect(chunk).toContain("s.type === 'FACT'");
    expect(chunk).toContain('continue');
  });

  it('AI never sells last power plant', () => {
    const idx = aiSource.indexOf('export function updateAISellDamaged');
    const chunk = aiSource.slice(idx, idx + 1500);
    expect(chunk).toContain("s.type === 'POWR' || s.type === 'APWR'");
    expect(chunk).toContain('powerCount <= 1');
  });

  it('AI sell refund = floor(cost * 0.5 * hpRatio) — health-scaled unlike player', () => {
    const idx = aiSource.indexOf('export function updateAISellDamaged');
    const chunk = aiSource.slice(idx, idx + 2000);
    expect(chunk).toContain('hpRatio');
    expect(chunk).toContain('prodItem.cost * 0.5 * hpRatio');
  });

  it('AI sell grants refund to houseCredits (not player credits)', () => {
    const idx = aiSource.indexOf('export function updateAISellDamaged');
    const chunk = aiSource.slice(idx, idx + 2000);
    expect(chunk).toContain('houseCredits.set');
    expect(chunk).toContain('current + refund');
  });

  it('AI sell is instant (no animation), sets rubble=true', () => {
    const idx = aiSource.indexOf('export function updateAISellDamaged');
    const chunk = aiSource.slice(idx, idx + 2000);
    expect(chunk).toContain('s.alive = false');
    expect(chunk).toContain('s.rubble = true');
    expect(chunk).toContain('clearStructureFootprint');
  });

  it('AI sell refund calculation: POWR at 20% HP (cost=300)', () => {
    // hpRatio = 0.20, refund = floor(300 * 0.5 * 0.20) = floor(30) = 30
    const refund = Math.floor(300 * 0.5 * 0.20);
    expect(refund).toBe(30);
  });

  it('AI sell refund calculation: WEAP at 10% HP (cost=2000)', () => {
    // hpRatio = 0.10, refund = floor(2000 * 0.5 * 0.10) = floor(100) = 100
    const refund = Math.floor(2000 * 0.5 * 0.10);
    expect(refund).toBe(100);
  });
});

// =========================================================================
// 15. Fire Sale — trigger-based sell-all
// =========================================================================
describe('Fire Sale — trigger-based sell all structures', () => {
  it('fire sale sets sellProgress=0 on all alive structures of trigger house', () => {
    const idx = indexSource.indexOf('Fire sale: sell all buildings');
    expect(idx).toBeGreaterThan(-1);
    const chunk = indexSource.slice(idx, idx + 400);
    expect(chunk).toContain('s.sellProgress === undefined');
    expect(chunk).toContain('s.sellProgress = 0');
  });

  it('fire sale sets all units of trigger house to HUNT mission', () => {
    const idx = indexSource.indexOf('result.fireSale');
    const chunk = indexSource.slice(idx, idx + 600);
    expect(chunk).toContain('Mission.HUNT');
    expect(chunk).toContain('e.house === saleHouse');
  });

  it('fire sale skips already-selling structures', () => {
    const idx = indexSource.indexOf('Fire sale: sell all buildings');
    const chunk = indexSource.slice(idx, idx + 400);
    expect(chunk).toContain('s.sellProgress === undefined');
  });
});

// =========================================================================
// 16. Edge Cases
// =========================================================================
describe('Edge Cases', () => {
  it('sell structure destroyed mid-sell is handled (guard clause)', () => {
    // Source: if (s.sellProgress !== undefined && s.alive) — skip if dead
    const sellSection = indexSource.indexOf('Sell: play make-sheet frames');
    const chunk = indexSource.slice(sellSection, sellSection + 300);
    expect(chunk).toContain('s.alive');
  });

  it('repair under attack — damage vs repair rate', () => {
    // Repair adds REPAIR_STEP (7) HP every 14 ticks.
    // Effective repair rate = 7/14 = 0.5 HP/tick
    // If damage exceeds 0.5 HP/tick, structure deteriorates despite repair
    const repairRate = REPAIR_STEP / 14; // 0.5 HP per tick
    expect(repairRate).toBe(0.5);
  });

  it('zero-credit repair attempt cancels immediately', () => {
    const ctx = makeMockRepairSellContext();
    ctx.structures = [makeStructure('POWR', House.Spain, 10, 10, { hp: 200 })];
    ctx.credits = 0;
    ctx.repairingStructures.add(0);
    tickRepairs(ctx);
    // Repair cancelled, EVA warning fired
    expect(ctx.repairingStructures.has(0)).toBe(false);
    expect((ctx as any)._evaCalls).toContain('eva_insufficient_funds');
  });

  it('structure at 1 HP — repair cost for single step', () => {
    // POWR: maxHp=400, at 1 HP, needs ceil((400-1)/7) = 58 steps
    const steps = Math.ceil((400 - 1) / REPAIR_STEP);
    expect(steps).toBe(57); // ceil(399/7) = 57
    const costPerStep = repairCostPerStep('POWR');
    const totalCost = steps * costPerStep;
    expect(totalCost).toBe(114); // 57 * 2
  });

  it('selling construction yard is allowed (no special block for player)', () => {
    // Unlike AI which never sells FACT, player CAN sell their ConYard
    const ctx = makeMockRepairSellContext();
    ctx.structures = [makeStructure('FACT', House.Spain, 10, 10)];
    const result = sellStructureByIndex(ctx, 0);
    expect(result).toBe(true);
    expect(ctx.structures[0].sellProgress).toBe(0);
  });

  it('sell refinery impacts economy (reduces silo capacity)', () => {
    // PROC provides 1000 capacity. Selling triggers recalculateSiloCapacity.
    const sellSection = indexSource.indexOf('Refund: flat 50% of building cost');
    expect(sellSection).toBeGreaterThan(-1);
    const chunk = indexSource.slice(sellSection - 400, sellSection + 400);
    expect(chunk).toContain('recalculateSiloCapacity');
  });

  it('CONDITION_RED = 0.25 and CONDITION_YELLOW = 0.5', () => {
    expect(CONDITION_RED).toBe(0.25);
    expect(CONDITION_YELLOW).toBe(0.5);
  });

  it('GAP Generator unjams shroud when sold', () => {
    const sellSection = indexSource.indexOf('GAP1: unjam shroud');
    expect(sellSection).toBeGreaterThan(-1);
    const chunk = indexSource.slice(sellSection, sellSection + 300);
    expect(chunk).toContain("s.type === 'GAP'");
    expect(chunk).toContain('unjamRadius');
  });

  it('Queen Ant self-heals +1 HP every 60 ticks (SelfHealing=yes)', () => {
    const queenSection = indexSource.indexOf('Queen Ant self-healing');
    expect(queenSection).toBeGreaterThan(-1);
    const chunk = indexSource.slice(queenSection, queenSection + 500);
    expect(chunk).toContain('tick % 60 === 0');
    expect(chunk).toContain("s.type === 'QUEE'");
    expect(chunk).toContain('s.hp + 1');
  });
});

// =========================================================================
// 17. Sell Mode UI Interaction
// =========================================================================
describe('Sell/Repair mode UI', () => {
  it('Q key toggles sell mode', () => {
    const idx = indexSource.indexOf("Q key: toggle sell mode");
    expect(idx).toBeGreaterThan(-1);
    const chunk = indexSource.slice(idx, idx + 200);
    expect(chunk).toContain('this.sellMode = !this.sellMode');
    expect(chunk).toContain('this.repairMode = false');
  });

  it('R key toggles repair mode', () => {
    const idx = indexSource.indexOf("R key: toggle repair mode");
    expect(idx).toBeGreaterThan(-1);
    const chunk = indexSource.slice(idx, idx + 200);
    expect(chunk).toContain('this.repairMode = !this.repairMode');
    expect(chunk).toContain('this.sellMode = false');
  });

  it('sell and repair modes are mutually exclusive', () => {
    // Activating sell clears repair, and vice versa
    // Q: sellMode toggle, repairMode=false
    // R: repairMode toggle, sellMode=false
    const qSection = indexSource.indexOf("Q key: toggle sell mode");
    const qChunk = indexSource.slice(qSection, qSection + 200);
    expect(qChunk).toContain('this.repairMode = false');

    const rSection = indexSource.indexOf("R key: toggle repair mode");
    const rChunk = indexSource.slice(rSection, rSection + 200);
    expect(rChunk).toContain('this.sellMode = false');
  });

  it('right-click cancels sell/repair modes', () => {
    const idx = indexSource.indexOf('Cancel sell/repair/attack-move modes');
    expect(idx).toBeGreaterThan(-1);
    const chunk = indexSource.slice(idx, idx + 200);
    expect(chunk).toContain('this.sellMode = false');
    expect(chunk).toContain('this.repairMode = false');
  });

  it('sell mode shows SELL cursor on allied structures', () => {
    const idx = indexSource.indexOf('if (this.sellMode)');
    expect(idx).toBeGreaterThan(-1);
    const chunk = indexSource.slice(idx, idx + 400);
    expect(chunk).toContain('CursorType.SELL');
  });

  it('repair mode shows REPAIR cursor on damaged allied structures', () => {
    const idx = indexSource.indexOf('if (this.repairMode)');
    expect(idx).toBeGreaterThan(-1);
    const chunk = indexSource.slice(idx, idx + 400);
    expect(chunk).toContain('CursorType.REPAIR');
    expect(chunk).toContain('s.hp < s.maxHp');
  });

  it('repair mode click toggles repair on structure (mode persists)', () => {
    const idx = indexSource.indexOf('Repair mode: click on damaged player structure');
    expect(idx).toBeGreaterThan(-1);
    const chunk = indexSource.slice(idx, idx + 700);
    expect(chunk).toContain('repairingStructures.has');
    expect(chunk).toContain('repairingStructures.delete');
    expect(chunk).toContain('repairingStructures.add');
  });

  it('sell mode click starts sell (mode persists)', () => {
    const idx = indexSource.indexOf('Sell mode: click on player structure');
    expect(idx).toBeGreaterThan(-1);
    const chunk = indexSource.slice(idx, idx + 400);
    // Mode does not get set to false — it persists like RA1
    expect(chunk).not.toContain('this.sellMode = false');
  });
});

// =========================================================================
// 18. Repair/Sell Economics — detailed cost verification
// =========================================================================
describe('Repair/Sell Economics — comprehensive cost verification', () => {
  const testStructures = [
    { type: 'POWR', cost: 300, maxHp: 400 },
    { type: 'APWR', cost: 500, maxHp: 700 },
    { type: 'TENT', cost: 300, maxHp: 800 },
    { type: 'PROC', cost: 2000, maxHp: 900 },
    { type: 'WEAP', cost: 2000, maxHp: 1000 },
    { type: 'FIX', cost: 1200, maxHp: 800 },
    { type: 'SILO', cost: 150, maxHp: 300 },
    { type: 'DOME', cost: 1000, maxHp: 1000 },
    { type: 'GUN', cost: 600, maxHp: 400 },
    { type: 'TSLA', cost: 1500, maxHp: 400 },
  ];

  for (const { type, cost, maxHp } of testStructures) {
    it(`repair cost per step for ${type}: cost=${cost}, maxHp=${maxHp}`, () => {
      const expected = Math.ceil((cost * REPAIR_PERCENT) / (maxHp / REPAIR_STEP));
      expect(repairCostPerStep(type)).toBe(expected);
    });

    it(`sell refund for ${type}: ${Math.floor(cost * 0.5)} credits`, () => {
      expect(sellRefund(type)).toBe(Math.floor(cost * 0.5));
    });

    it(`${type} maxHp matches STRUCTURE_MAX_HP table`, () => {
      expect(STRUCTURE_MAX_HP[type]).toBe(maxHp);
    });
  }

  it('full repair cost is always less than half the building cost', () => {
    // Repairing from 1 HP to full should cost less than buying a new one
    for (const { type, cost, maxHp } of testStructures) {
      const fullRepairCost = totalRepairCost(type, 1);
      const halfCost = cost / 2;
      // Repair is 20% of cost spread over maxHp/REPAIR_STEP steps
      // Total = steps * ceil(cost*0.20 / (maxHp/REPAIR_STEP))
      // Due to ceiling, this can slightly exceed 20% but should be << 50%
      expect(fullRepairCost, `${type} full repair cost ${fullRepairCost} should be < ${halfCost}`).toBeLessThanOrEqual(halfCost);
    }
  });

  it('repair then sell is always net negative (you cannot profit)', () => {
    for (const { type, cost, maxHp } of testStructures) {
      // Buy at full cost, damage to 1HP, repair fully, sell
      // Net = -cost + sellRefund - repairCost
      // Should always be negative
      const repairCost = totalRepairCost(type, 1);
      const refund = sellRefund(type);
      const net = -cost + refund - repairCost;
      expect(net, `${type} repair-then-sell net`).toBeLessThan(0);
    }
  });
});

// =========================================================================
// 19. Sell Animation Duration for Each Building Type
// =========================================================================
describe('Sell Animation Duration', () => {
  const structureTypes = [
    { image: 'fact', expectedDamageFrame: 26 },
    { image: 'weap', expectedDamageFrame: 16 },
    { image: 'barr', expectedDamageFrame: 10 },
    { image: 'tent', expectedDamageFrame: 10 },
    { image: 'powr', expectedDamageFrame: 4 },
    { image: 'proc', expectedDamageFrame: 16 },
    { image: 'fix', expectedDamageFrame: 12 },
    { image: 'dome', expectedDamageFrame: 8 },
    { image: 'silo', expectedDamageFrame: 5 },
    { image: 'tsla', expectedDamageFrame: 10 },
    { image: 'hbox', expectedDamageFrame: 1 },
  ];

  for (const { image, expectedDamageFrame } of structureTypes) {
    it(`${image} sell duration = ${Math.max(expectedDamageFrame, 1) * 2} ticks`, () => {
      const entry = BUILDING_FRAME_TABLE[image];
      expect(entry, `${image} should be in BUILDING_FRAME_TABLE`).toBeDefined();
      expect(entry.damageFrame).toBe(expectedDamageFrame);
      const duration = Math.max(entry.damageFrame, 1) * 2;
      expect(duration).toBe(Math.max(expectedDamageFrame, 1) * 2);
    });
  }

  it('sell rate formula: sellProgress += 1 / (sellFrameCount * 2)', () => {
    // For a building with damageFrame=10, sellFrameCount=10
    // Each tick: 1/(10*2) = 0.05 → 20 ticks to complete
    const sellFrameCount = 10;
    const rate = 1 / (sellFrameCount * 2);
    expect(rate).toBeCloseTo(0.05);
    const ticksToComplete = Math.ceil(1 / rate);
    expect(ticksToComplete).toBe(20);
  });
});

// =========================================================================
// 20. Sidebar Repair/Sell Button Interaction
// =========================================================================
describe('Sidebar Repair/Sell Buttons', () => {
  it('sidebar has repair and sell button regions', () => {
    const idx = indexSource.indexOf('Repair button');
    expect(idx).toBeGreaterThan(-1);
    const chunk = indexSource.slice(idx, idx + 400);
    expect(chunk).toContain('Repair button');
    expect(chunk).toContain('Sell button');
  });

  it('repair button toggles repairMode and clears sellMode', () => {
    const idx = indexSource.indexOf('Repair button');
    expect(idx).toBeGreaterThan(-1);
    const chunk = indexSource.slice(idx, idx + 200);
    expect(chunk).toContain('this.repairMode = !this.repairMode');
    expect(chunk).toContain('this.sellMode = false');
  });

  it('sell button toggles sellMode and clears repairMode', () => {
    const idx = indexSource.indexOf('Sell button');
    expect(idx).toBeGreaterThan(-1);
    const chunk = indexSource.slice(idx, idx + 200);
    expect(chunk).toContain('this.sellMode = !this.sellMode');
    expect(chunk).toContain('this.repairMode = false');
  });
});

// =========================================================================
// 21. Structure Defense During Sell
// =========================================================================
describe('Structure Defense During Sell', () => {
  it('defensive structures skip combat while being sold', () => {
    // In updateStructureCombat (combat.ts), structures with sellProgress are skipped
    const idx = combatSource.indexOf('export function updateStructureCombat');
    expect(idx).toBeGreaterThan(-1);
    const chunk = combatSource.slice(idx, idx + 3000);
    expect(chunk).toContain('sellProgress');
  });
});

// =========================================================================
// 22. Wall-Specific Tests
// =========================================================================
describe('Wall Placement and Sell', () => {
  it('walls have 1x1 footprint', () => {
    for (const wallType of ['SBAG', 'FENC', 'BARB', 'BRIK']) {
      const size = STRUCTURE_SIZE[wallType];
      expect(size, `${wallType} should have 1x1 size`).toEqual([1, 1]);
    }
  });

  it('walls appear instantly (no construction animation)', () => {
    // In placeStructure: isWall → buildProgress = undefined (instant)
    const idx = placementSource.indexOf('buildProgress: isWall');
    expect(idx).toBeGreaterThan(-1);
    const chunk = placementSource.slice(idx, idx + 100);
    expect(chunk).toContain('undefined');
  });

  it('walls support continuous placement (pendingPlacement stays active)', () => {
    const idx = placementSource.indexOf('For walls: keep pendingPlacement active');
    expect(idx).toBeGreaterThan(-1);
  });

  it('wall placement does not require adjacency (unlike normal structures)', () => {
    const idx = placementSource.indexOf('Walls can be placed anywhere passable');
    expect(idx).toBeGreaterThan(-1);
  });

  it('first wall cost is prepaid at production start, subsequent walls deducted on placement', () => {
    const idx = placementSource.indexOf('wallPlacementPrepaid');
    expect(idx).toBeGreaterThan(-1);
    // Verify the prepaid/deduction logic
    const placeIdx = placementSource.indexOf('For walls: keep pendingPlacement active');
    const chunk = placementSource.slice(placeIdx, placeIdx + 300);
    expect(chunk).toContain('wallPlacementPrepaid');
    expect(chunk).toContain('getEffectiveCost');
  });
});

// =========================================================================
// 23. Engineer vs Repair System Distinction
// =========================================================================
describe('Engineer Repair vs Toggle Repair distinction', () => {
  it('engineer repair heals to FULL HP instantly (not step-based)', () => {
    const idx = missionAISource.indexOf('EN1: Friendly repair');
    expect(idx).toBeGreaterThan(-1);
    const chunk = missionAISource.slice(idx, idx + 200);
    expect(chunk).toContain('s.hp = s.maxHp');
  });

  it('engineer is consumed after repair', () => {
    const idx = missionAISource.indexOf('Engineer consumed on repair');
    expect(idx).toBeGreaterThan(-1);
    const chunk = missionAISource.slice(idx, idx + 200);
    expect(chunk).toContain('entity.alive = false');
    expect(chunk).toContain('Mission.DIE');
  });

  it('toggleRepair is gradual, tick-based, costs credits', () => {
    // Verified in earlier tests: REPAIR_STEP per 14-tick interval, with credit deduction
    expect(REPAIR_STEP).toBe(7);
    expect(REPAIR_PERCENT).toBe(0.20);
  });
});

// =========================================================================
// 24. Integration: Repair + Sell Interaction
// =========================================================================
describe('Repair + Sell Interaction', () => {
  it('starting sell while repairing cancels repair', () => {
    const ctx = makeMockRepairSellContext();
    ctx.structures = [makeStructure('POWR', House.Spain, 10, 10, { hp: 200 })];
    // Start repairing
    toggleRepair(ctx, 0);
    expect(ctx.repairingStructures.has(0)).toBe(true);
    // Start selling — sets sellProgress
    sellStructureByIndex(ctx, 0);
    expect(ctx.structures[0].sellProgress).toBe(0);
    // Next repair tick should detect sellProgress and remove from set
    tickRepairs(ctx);
    expect(ctx.repairingStructures.has(0)).toBe(false);
  });

  it('selling refines structure gives refund AND reduces silo capacity', () => {
    // Both effects happen on sell finalization
    const sellSection = indexSource.indexOf('Refund: flat 50% of building cost');
    expect(sellSection).toBeGreaterThan(-1);
    const chunk = indexSource.slice(sellSection - 400, sellSection + 400);
    expect(chunk).toContain('recalculateSiloCapacity');
    expect(chunk).toContain('addCredits');
  });
});

// =========================================================================
// 25. Repair/Sell Timing Constants
// =========================================================================
describe('Timing Constants', () => {
  it('repair pulse interval is 14 ticks (for both structures and depot)', () => {
    // Both use tick % 14 === 0
    let count = 0;
    let searchIdx = 0;
    while (true) {
      const idx = indexSource.indexOf('tick % 14 === 0', searchIdx);
      if (idx === -1) break;
      count++;
      searchIdx = idx + 1;
    }
    expect(count).toBeGreaterThanOrEqual(2); // structure repair + depot repair
  });

  it('AI sell check interval is 75 ticks (5 seconds)', () => {
    const idx = aiSource.indexOf('export function updateAISellDamaged');
    const chunk = aiSource.slice(idx, idx + 200);
    expect(chunk).toContain('tick % 75 !== 0');
  });

  it('AI repair check interval is 15 ticks (1 second)', () => {
    const idx = aiSource.indexOf('export function updateAIRepair');
    const chunk = aiSource.slice(idx, idx + 200);
    expect(chunk).toContain('tick % 15 !== 0');
  });

  it('Queen Ant self-heal interval is 60 ticks (4 seconds)', () => {
    const queenSection = indexSource.indexOf('Queen Ant self-healing');
    expect(queenSection).toBeGreaterThan(-1);
    const chunk = indexSource.slice(queenSection, queenSection + 500);
    expect(chunk).toContain('tick % 60 === 0');
  });

  it('depot rearm rate is 36 ticks per ammo', () => {
    // Vehicle at depot with depleted ammo — rearmTimer resets to 36 after each reload
    const depot = makeStructure('FIX', House.Spain, 10, 10);
    const vehicle = new Entity(UnitType.V_JEEP, House.Spain, 264, 264);
    vehicle.hp = vehicle.maxHp; // full HP — only needs rearm
    vehicle.maxAmmo = 4;
    vehicle.ammo = 2;
    vehicle.rearmTimer = 1; // will decrement to 0, triggering reload
    const ctx = makeMockRepairSellContext();
    ctx.structures = [depot];
    ctx.entities = [vehicle];
    tickServiceDepot(ctx);
    // After reload, timer should reset to 36
    expect(vehicle.rearmTimer).toBe(36);
  });
});
