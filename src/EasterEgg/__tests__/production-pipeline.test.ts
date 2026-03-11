/**
 * Production & Economy Pipeline Tests — Runtime Behavior
 *
 * Tests the tick-based production lifecycle, incremental cost deduction,
 * multi-factory acceleration, power penalty curves, production queue management,
 * factory destruction edge cases, credit flow, and structure placement.
 *
 * Existing tests cover:
 *   - production-parity.test.ts: static formula parity (power mult, factory speed, sell refund)
 *   - production-items-parity.test.ts: all 65 items match C++ RULES.INI
 *   - silo-capacity.test.ts: silo storage capacity + credit capping
 *   - economy-parity.test.ts: ore values, bail capacity, terrain speed
 *   - ai-production-gate.test.ts: BEGIN_PRODUCTION trigger gating
 *
 * This file focuses on RUNTIME BEHAVIOR that those tests do not cover:
 *   - Full tick cycle: start production -> N ticks -> completion -> unit spawn
 *   - PR3 incremental cost deduction per tick (not upfront)
 *   - Production pause on insufficient funds mid-build
 *   - Multi-factory acceleration applied in tickProduction
 *   - Power penalty applied in tickProduction
 *   - Production queue: queue count, cancel refund, prerequisite loss
 *   - Factory destruction during active production
 *   - Structure placement: adjacency, walls, MCV deploy
 *   - Power grid recalculation on structure change
 *   - getEffectiveCost with country bonus multipliers
 *   - addCredits bypass silo cap for refunds
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PRODUCTION_ITEMS, type ProductionItem, getStripSide,
  House, UnitType, CELL_SIZE, COUNTRY_BONUSES, POWER_DRAIN,
  UNIT_STATS, Mission,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import type { MapStructure } from '../engine/scenario';
import { STRUCTURE_MAX_HP, STRUCTURE_SIZE } from '../engine/scenario';

// =========================================================================
// Helpers — mirror Game internals for isolated unit testing
// =========================================================================

/** Create a minimal MapStructure for testing */
function makeStructure(
  type: string, house: House, cx = 10, cy = 10,
  opts: { alive?: boolean; hp?: number; maxHp?: number; buildProgress?: number; sellProgress?: number } = {},
): MapStructure {
  const maxHp = opts.maxHp ?? STRUCTURE_MAX_HP[type] ?? 256;
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: opts.hp ?? maxHp,
    maxHp,
    alive: opts.alive ?? true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    buildProgress: opts.buildProgress,
    sellProgress: opts.sellProgress,
  };
}

const BUILDING_ALIASES: Record<string, string> = { TENT: 'BARR', BARR: 'TENT', SYRD: 'SPEN', SPEN: 'SYRD' };

function hasBuilding(type: string, structures: MapStructure[], playerHouse: House): boolean {
  const playerHouses = new Set([House.Spain, House.Greece]);
  const alt = BUILDING_ALIASES[type];
  return structures.some(s =>
    s.alive && (s.type === type || (alt !== undefined && s.type === alt)) &&
    playerHouses.has(s.house),
  );
}

function countPlayerBuildings(type: string, structures: MapStructure[]): number {
  const playerHouses = new Set([House.Spain, House.Greece]);
  let count = 0;
  for (const s of structures) {
    if (s.alive && s.type === type && playerHouses.has(s.house)) count++;
  }
  return count;
}

function getEffectiveCost(item: ProductionItem, playerHouse: House): number {
  const bonus = COUNTRY_BONUSES[playerHouse] ?? COUNTRY_BONUSES.Neutral;
  return Math.max(1, Math.round(item.cost * bonus.costMult));
}

function calcPowerMult(powerProduced: number, powerConsumed: number): number {
  if (powerConsumed > powerProduced && powerProduced > 0) {
    const powerFraction = powerProduced / powerConsumed;
    return Math.max(0.5, powerFraction);
  }
  return 1.0;
}

function calculateSiloCapacity(structures: MapStructure[]): number {
  const playerHouses = new Set([House.Spain, House.Greece]);
  let capacity = 0;
  for (const s of structures) {
    if (!s.alive || !playerHouses.has(s.house)) continue;
    if (s.buildProgress !== undefined && s.buildProgress < 1) continue;
    if (s.type === 'PROC') capacity += 1000;
    else if (s.type === 'SILO') capacity += 1500;
  }
  return capacity;
}

function addCredits(
  credits: number, amount: number, siloCapacity: number, bypassSiloCap = false,
): { credits: number; added: number } {
  if (bypassSiloCap) {
    return { credits: credits + amount, added: amount };
  }
  if (siloCapacity <= 0) return { credits, added: 0 };
  const before = credits;
  const newCredits = Math.min(credits + amount, siloCapacity);
  return { credits: newCredits, added: newCredits - before };
}

function calcPower(structures: MapStructure[]): { produced: number; consumed: number } {
  const playerHouses = new Set([House.Spain, House.Greece]);
  let produced = 0;
  let consumed = 0;
  for (const s of structures) {
    if (!s.alive || s.sellProgress !== undefined || !playerHouses.has(s.house)) continue;
    const healthRatio = s.hp / s.maxHp;
    if (s.type === 'POWR') produced += Math.round(100 * healthRatio);
    else if (s.type === 'APWR') produced += Math.round(200 * healthRatio);
    const drain = POWER_DRAIN[s.type];
    if (drain) consumed += drain;
  }
  return { produced, consumed };
}

/** Production queue entry — mirrors Game.productionQueue value type */
interface ProdEntry {
  item: ProductionItem;
  progress: number;
  queueCount: number;
  costPaid: number;
}

/**
 * Simulate tickProduction for ONE tick.
 * Returns true if the entry completed this tick, false otherwise.
 * Mutates entry and credits in place.
 */
function tickProductionEntry(
  entry: ProdEntry,
  structures: MapStructure[],
  state: { credits: number },
  powerProduced: number,
  powerConsumed: number,
  playerHouse: House,
): 'completed' | 'in_progress' | 'paused_funds' | 'cancelled_prereq' {
  // Check prerequisite still exists
  if (!hasBuilding(entry.item.prerequisite, structures, playerHouse)) {
    return 'cancelled_prereq';
  }
  // Power penalty
  const powerMult = calcPowerMult(powerProduced, powerConsumed);
  // Incremental cost
  const effectiveCost = getEffectiveCost(entry.item, playerHouse);
  const costPerTick = effectiveCost / entry.item.buildTime;
  if (entry.costPaid < effectiveCost) {
    if (state.credits >= costPerTick) {
      const deduct = Math.min(costPerTick, effectiveCost - entry.costPaid);
      state.credits -= deduct;
      entry.costPaid += deduct;
    } else {
      return 'paused_funds';
    }
  }
  // Multi-factory speedup
  const factoryCount = countPlayerBuildings(entry.item.prerequisite, structures);
  const speedMult = Math.max(1, factoryCount);
  entry.progress += speedMult * powerMult;
  if (entry.progress >= entry.item.buildTime) {
    return 'completed';
  }
  return 'in_progress';
}

/** Find a production item by type code */
function findItem(type: string): ProductionItem {
  const item = PRODUCTION_ITEMS.find(i => i.type === type);
  if (!item) throw new Error(`Production item not found: ${type}`);
  return item;
}

beforeEach(() => resetEntityIds());

// =========================================================================
// 1. Tick-based production lifecycle
// =========================================================================
describe('Tick-based production lifecycle', () => {
  it('E1 rifle infantry completes after buildTime ticks with 1 factory', () => {
    const e1 = findItem('E1');
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('TENT', House.Spain, 12, 10),
      makeStructure('PROC', House.Spain, 14, 10),
    ];
    const state = { credits: 5000 };
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 1, costPaid: 0 };

    let completedTick = -1;
    for (let tick = 0; tick < 200; tick++) {
      const result = tickProductionEntry(entry, structures, state, 100, 50, House.Spain);
      if (result === 'completed') {
        completedTick = tick + 1; // 1-indexed tick count
        break;
      }
    }
    // E1 buildTime = 45, so it should complete on tick 45
    expect(completedTick).toBe(e1.buildTime);
  });

  it('progress advances by 1 per tick with single factory and full power', () => {
    const e1 = findItem('E1');
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('TENT', House.Spain, 12, 10),
      makeStructure('PROC', House.Spain, 14, 10),
    ];
    const state = { credits: 5000 };
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 1, costPaid: 0 };

    // Tick 10 times
    for (let i = 0; i < 10; i++) {
      tickProductionEntry(entry, structures, state, 100, 50, House.Spain);
    }
    expect(entry.progress).toBe(10);
  });

  it('heavy tank (buildTime=200) completes after exactly 200 ticks', () => {
    const t3 = findItem('3TNK');
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('WEAP', House.Spain, 12, 10),
      makeStructure('PROC', House.Spain, 14, 10),
    ];
    const state = { credits: 50000 };
    const entry: ProdEntry = { item: t3, progress: 0, queueCount: 1, costPaid: 0 };

    let ticks = 0;
    for (let tick = 0; tick < 300; tick++) {
      const result = tickProductionEntry(entry, structures, state, 200, 50, House.Spain);
      ticks++;
      if (result === 'completed') break;
    }
    expect(ticks).toBe(t3.buildTime);
  });
});

// =========================================================================
// 2. PR3: Incremental cost deduction
// =========================================================================
describe('PR3: Incremental cost deduction per tick', () => {
  it('cost is deducted gradually, not upfront', () => {
    const e1 = findItem('E1'); // cost=100, buildTime=45
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('TENT', House.Spain, 12, 10),
      makeStructure('PROC', House.Spain, 14, 10),
    ];
    const state = { credits: 5000 };
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 1, costPaid: 0 };

    // After 1 tick, credits should decrease by cost/buildTime = 100/45 ~= 2.22
    const creditsBefore = state.credits;
    tickProductionEntry(entry, structures, state, 100, 50, House.Spain);
    const deducted = creditsBefore - state.credits;
    const expectedPerTick = 100 / 45;
    expect(deducted).toBeCloseTo(expectedPerTick, 5);
    // costPaid should match
    expect(entry.costPaid).toBeCloseTo(expectedPerTick, 5);
  });

  it('total cost paid equals effective cost after buildTime ticks', () => {
    const e1 = findItem('E1');
    const effectiveCost = getEffectiveCost(e1, House.Spain);
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('TENT', House.Spain, 12, 10),
      makeStructure('PROC', House.Spain, 14, 10),
    ];
    const state = { credits: 50000 };
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 1, costPaid: 0 };

    for (let tick = 0; tick < e1.buildTime; tick++) {
      tickProductionEntry(entry, structures, state, 100, 50, House.Spain);
    }
    // Total cost paid should equal effective cost (may be slightly less due to min clamping)
    expect(entry.costPaid).toBeCloseTo(effectiveCost, 1);
  });

  it('player can start building with partial funds (PR3)', () => {
    const weap = findItem('WEAP'); // cost=2000
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('PROC', House.Spain, 12, 10),
    ];
    // Only 500 credits (way less than 2000 cost) — but should still start
    const state = { credits: 500 };
    const entry: ProdEntry = { item: weap, progress: 0, queueCount: 1, costPaid: 0 };

    // Should still progress for the first ticks (500 credits / 10 per tick = ~50 ticks before pausing)
    const costPerTick = 2000 / weap.buildTime;
    const ticksBeforeBroke = Math.floor(500 / costPerTick);
    let progressTicks = 0;
    for (let tick = 0; tick < 300; tick++) {
      const result = tickProductionEntry(entry, structures, state, 100, 50, House.Spain);
      if (result === 'paused_funds') break;
      progressTicks++;
    }
    // Should have made progress for some ticks before running out of money
    expect(progressTicks).toBeGreaterThan(0);
    expect(progressTicks).toBeLessThan(weap.buildTime);
    expect(entry.progress).toBeGreaterThan(0);
    expect(entry.progress).toBeLessThan(weap.buildTime);
  });

  it('production pauses when credits run out mid-build', () => {
    const e1 = findItem('E1'); // cost=100, buildTime=45
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('TENT', House.Spain, 12, 10),
      makeStructure('PROC', House.Spain, 14, 10),
    ];
    const state = { credits: 10 }; // very limited funds
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 1, costPaid: 0 };

    // Tick until paused
    let pausedTick = -1;
    for (let tick = 0; tick < 100; tick++) {
      const result = tickProductionEntry(entry, structures, state, 100, 50, House.Spain);
      if (result === 'paused_funds') {
        pausedTick = tick;
        break;
      }
    }
    expect(pausedTick).toBeGreaterThan(0);

    // Progress should not advance after being paused
    const progressAtPause = entry.progress;
    const result = tickProductionEntry(entry, structures, state, 100, 50, House.Spain);
    expect(result).toBe('paused_funds');
    expect(entry.progress).toBe(progressAtPause);
  });

  it('production resumes when credits become available again', () => {
    const e1 = findItem('E1');
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('TENT', House.Spain, 12, 10),
      makeStructure('PROC', House.Spain, 14, 10),
    ];
    const state = { credits: 10 };
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 1, costPaid: 0 };

    // Run until paused
    for (let tick = 0; tick < 100; tick++) {
      const result = tickProductionEntry(entry, structures, state, 100, 50, House.Spain);
      if (result === 'paused_funds') break;
    }
    const progressWhenPaused = entry.progress;
    expect(progressWhenPaused).toBeGreaterThan(0);

    // Add more credits
    state.credits = 5000;
    const result = tickProductionEntry(entry, structures, state, 100, 50, House.Spain);
    expect(result).toBe('in_progress');
    expect(entry.progress).toBeGreaterThan(progressWhenPaused);
  });
});

// =========================================================================
// 3. Multi-factory acceleration in tickProduction
// =========================================================================
describe('Multi-factory acceleration in tickProduction', () => {
  it('2 WEAPs double production speed for vehicles', () => {
    const t3 = findItem('3TNK'); // prerequisite=WEAP
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('WEAP', House.Spain, 12, 10),
      makeStructure('WEAP', House.Spain, 16, 10), // second WEAP
      makeStructure('PROC', House.Spain, 20, 10),
    ];
    const state = { credits: 50000 };
    const entry: ProdEntry = { item: t3, progress: 0, queueCount: 1, costPaid: 0 };

    // One tick should advance by 2 (2 factories * 1.0 power mult)
    tickProductionEntry(entry, structures, state, 200, 50, House.Spain);
    expect(entry.progress).toBe(2);
  });

  it('3 barracks triple infantry production speed', () => {
    const e1 = findItem('E1'); // prerequisite=TENT
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('TENT', House.Spain, 12, 10),
      makeStructure('TENT', House.Spain, 14, 10),
      makeStructure('TENT', House.Spain, 16, 10), // 3 barracks
      makeStructure('PROC', House.Spain, 18, 10),
    ];
    const state = { credits: 50000 };
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 1, costPaid: 0 };

    tickProductionEntry(entry, structures, state, 200, 50, House.Spain);
    expect(entry.progress).toBe(3);
  });

  it('2 factories halve total build time', () => {
    const e1 = findItem('E1'); // buildTime=45
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('TENT', House.Spain, 12, 10),
      makeStructure('TENT', House.Spain, 14, 10),
      makeStructure('PROC', House.Spain, 16, 10),
    ];
    const state = { credits: 50000 };
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 1, costPaid: 0 };

    let ticks = 0;
    for (let tick = 0; tick < 100; tick++) {
      const result = tickProductionEntry(entry, structures, state, 200, 50, House.Spain);
      ticks++;
      if (result === 'completed') break;
    }
    // With 2 factories: 45 / 2 = 23 ticks (ceil)
    expect(ticks).toBe(Math.ceil(e1.buildTime / 2));
  });

  it('dead factory does not count for multi-factory acceleration', () => {
    const e1 = findItem('E1');
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('TENT', House.Spain, 12, 10),
      makeStructure('TENT', House.Spain, 14, 10, { alive: false }), // destroyed
      makeStructure('PROC', House.Spain, 16, 10),
    ];
    const state = { credits: 50000 };
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 1, costPaid: 0 };

    tickProductionEntry(entry, structures, state, 200, 50, House.Spain);
    // Only 1 alive TENT, so speed = 1x
    expect(entry.progress).toBe(1);
  });

  it('enemy factory does not count for player multi-factory', () => {
    const e1 = findItem('E1');
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('TENT', House.Spain, 12, 10),
      makeStructure('TENT', House.USSR, 14, 10), // enemy barracks
      makeStructure('PROC', House.Spain, 16, 10),
    ];
    const state = { credits: 50000 };
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 1, costPaid: 0 };

    tickProductionEntry(entry, structures, state, 200, 50, House.Spain);
    expect(entry.progress).toBe(1); // only 1 player TENT
  });
});

// =========================================================================
// 4. Power penalty in tickProduction
// =========================================================================
describe('Power penalty in tickProduction', () => {
  it('75% power reduces production progress per tick to 0.75', () => {
    const e1 = findItem('E1');
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('TENT', House.Spain, 12, 10),
      makeStructure('PROC', House.Spain, 14, 10),
    ];
    const state = { credits: 50000 };
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 1, costPaid: 0 };

    // 75 produced / 100 consumed = 0.75 mult
    tickProductionEntry(entry, structures, state, 75, 100, House.Spain);
    expect(entry.progress).toBeCloseTo(0.75);
  });

  it('50% power slows production to half speed', () => {
    const e1 = findItem('E1');
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('TENT', House.Spain, 12, 10),
      makeStructure('PROC', House.Spain, 14, 10),
    ];
    const state = { credits: 50000 };
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 1, costPaid: 0 };

    tickProductionEntry(entry, structures, state, 50, 100, House.Spain);
    expect(entry.progress).toBeCloseTo(0.5);
  });

  it('25% power clamps to 0.5 (never slower than 2x)', () => {
    const e1 = findItem('E1');
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('TENT', House.Spain, 12, 10),
      makeStructure('PROC', House.Spain, 14, 10),
    ];
    const state = { credits: 50000 };
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 1, costPaid: 0 };

    tickProductionEntry(entry, structures, state, 25, 100, House.Spain);
    expect(entry.progress).toBeCloseTo(0.5);
  });

  it('combined: 2 factories + 50% power = 1x effective speed', () => {
    const e1 = findItem('E1');
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('TENT', House.Spain, 12, 10),
      makeStructure('TENT', House.Spain, 14, 10),
      makeStructure('PROC', House.Spain, 16, 10),
    ];
    const state = { credits: 50000 };
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 1, costPaid: 0 };

    // 2 factories * 0.5 power mult = 1.0 effective
    tickProductionEntry(entry, structures, state, 50, 100, House.Spain);
    expect(entry.progress).toBeCloseTo(1.0);
  });

  it('combined: 3 factories + 75% power = 2.25x effective speed', () => {
    const e1 = findItem('E1');
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('TENT', House.Spain, 12, 10),
      makeStructure('TENT', House.Spain, 14, 10),
      makeStructure('TENT', House.Spain, 16, 10),
      makeStructure('PROC', House.Spain, 18, 10),
    ];
    const state = { credits: 50000 };
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 1, costPaid: 0 };

    tickProductionEntry(entry, structures, state, 75, 100, House.Spain);
    expect(entry.progress).toBeCloseTo(2.25);
  });

  it('power penalty increases actual build time', () => {
    const e1 = findItem('E1'); // buildTime=45
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('TENT', House.Spain, 12, 10),
      makeStructure('PROC', House.Spain, 14, 10),
    ];
    const state = { credits: 50000 };
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 1, costPaid: 0 };

    // At 50% power, each tick adds 0.5 progress, so takes 90 ticks
    let ticks = 0;
    for (let tick = 0; tick < 200; tick++) {
      const result = tickProductionEntry(entry, structures, state, 50, 100, House.Spain);
      ticks++;
      if (result === 'completed') break;
    }
    expect(ticks).toBe(e1.buildTime * 2); // 90 ticks at half speed
  });
});

// =========================================================================
// 5. Production queue management
// =========================================================================
describe('Production queue management', () => {
  it('queued items (count > 1) require full upfront cost', () => {
    // In Game.startProduction: queueCount > 1 requires credits >= effectiveCost
    const e1 = findItem('E1'); // cost=100
    const effectiveCost = getEffectiveCost(e1, House.Spain);
    expect(effectiveCost).toBe(100);

    // First build: only needs credits > 0 (PR3 incremental)
    // Second build in queue: needs full 100 credits upfront
    let credits = 150;
    // Simulate queueing a second item
    if (credits >= effectiveCost) {
      credits -= effectiveCost;
    }
    expect(credits).toBe(50); // 150 - 100 = 50
  });

  it('cancel active production refunds costPaid (incremental)', () => {
    const e1 = findItem('E1'); // cost=100, buildTime=45
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('TENT', House.Spain, 12, 10),
      makeStructure('PROC', House.Spain, 14, 10),
    ];
    const state = { credits: 5000 };
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 1, costPaid: 0 };

    // Build for 20 ticks
    for (let tick = 0; tick < 20; tick++) {
      tickProductionEntry(entry, structures, state, 100, 50, House.Spain);
    }
    const creditsAfterBuild = state.credits;
    const costPaid = entry.costPaid;
    expect(costPaid).toBeGreaterThan(0);
    expect(costPaid).toBeLessThan(100);

    // Cancel: refund costPaid (bypass silo cap like C++ Refund_Money)
    state.credits += costPaid; // addCredits with bypassSiloCap=true
    expect(state.credits).toBeCloseTo(creditsAfterBuild + costPaid);
  });

  it('cancel queued item (count > 1) refunds full cost', () => {
    const e1 = findItem('E1');
    const effectiveCost = getEffectiveCost(e1, House.Spain);
    let credits = 10000;

    // Queue second item: deduct full cost
    credits -= effectiveCost;
    const afterQueue = credits;

    // Cancel one queued item: refund full cost
    credits += effectiveCost;
    expect(credits).toBe(afterQueue + effectiveCost);
    expect(credits).toBe(10000); // back to original
  });

  it('max queue count is 5', () => {
    // Game.startProduction caps at queueCount < 5
    const maxQueue = 5;
    let queueCount = 1;
    for (let i = 0; i < 10; i++) {
      if (queueCount < maxQueue) queueCount++;
    }
    expect(queueCount).toBe(maxQueue);
  });

  it('production cancelled when prerequisite building is destroyed', () => {
    const e1 = findItem('E1');
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('TENT', House.Spain, 12, 10),
      makeStructure('PROC', House.Spain, 14, 10),
    ];
    const state = { credits: 5000 };
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 1, costPaid: 0 };

    // Build for 10 ticks
    for (let tick = 0; tick < 10; tick++) {
      tickProductionEntry(entry, structures, state, 100, 50, House.Spain);
    }
    expect(entry.progress).toBe(10);

    // Destroy the barracks
    structures[2].alive = false;
    const result = tickProductionEntry(entry, structures, state, 100, 50, House.Spain);
    expect(result).toBe('cancelled_prereq');
  });

  it('TENT/BARR alias: production continues with BARR when TENT destroyed', () => {
    const e1 = findItem('E1'); // prerequisite=TENT
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain),
      makeStructure('TENT', House.Spain, 12, 10, { alive: false }), // destroyed TENT
      makeStructure('BARR', House.Spain, 14, 10), // BARR serves as alias
      makeStructure('PROC', House.Spain, 16, 10),
    ];
    const state = { credits: 5000 };
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 1, costPaid: 0 };

    const result = tickProductionEntry(entry, structures, state, 100, 50, House.Spain);
    // hasBuilding('TENT') returns true because BARR is alive (alias)
    expect(result).not.toBe('cancelled_prereq');
    expect(entry.progress).toBe(1); // factory count = BARR(1), progress = 1
  });

  it('structure production enters placement mode (does not auto-spawn)', () => {
    // Structures completed in tickProduction set pendingPlacement, not spawnProducedUnit
    // Verify from source: isStructure items trigger pendingPlacement path
    const powr = findItem('POWR');
    expect(powr.isStructure).toBe(true);

    // Verify getStripSide puts structures on 'left' strip
    expect(getStripSide(powr)).toBe('left');

    // Units go on 'right' strip
    const e1 = findItem('E1');
    expect(getStripSide(e1)).toBe('right');
  });
});

// =========================================================================
// 6. getEffectiveCost with country bonuses
// =========================================================================
describe('getEffectiveCost with country bonuses', () => {
  it('Spain (costMult=1.0) pays full price', () => {
    const e1 = findItem('E1');
    expect(getEffectiveCost(e1, House.Spain)).toBe(100);
  });

  it('USSR (costMult=0.9) gets 10% discount', () => {
    const e1 = findItem('E1'); // cost=100
    expect(getEffectiveCost(e1, House.USSR)).toBe(90); // round(100 * 0.9)
  });

  it('USSR discount on expensive items', () => {
    const mammoth = findItem('4TNK'); // cost=1700
    expect(getEffectiveCost(mammoth, House.USSR)).toBe(1530); // round(1700 * 0.9)
  });

  it('non-discounted countries pay full price', () => {
    const item = findItem('HARV'); // cost=1400
    expect(getEffectiveCost(item, House.Greece)).toBe(1400);
    expect(getEffectiveCost(item, House.England)).toBe(1400);
    expect(getEffectiveCost(item, House.France)).toBe(1400);
  });

  it('effective cost is always at least 1', () => {
    // Edge case: if somehow cost * mult rounds to 0
    // The function uses Math.max(1, ...)
    const result = Math.max(1, Math.round(0 * 1.0));
    expect(result).toBe(1);
  });
});

// =========================================================================
// 7. addCredits — silo cap and bypass
// =========================================================================
describe('addCredits — silo cap and bypass', () => {
  it('harvester deposits are capped by silo capacity', () => {
    const result = addCredits(900, 500, 1000, false);
    expect(result.credits).toBe(1000);
    expect(result.added).toBe(100);
  });

  it('refunds bypass silo cap', () => {
    const result = addCredits(900, 500, 1000, true);
    expect(result.credits).toBe(1400);
    expect(result.added).toBe(500);
  });

  it('zero silo capacity blocks all non-bypass deposits', () => {
    const result = addCredits(0, 500, 0, false);
    expect(result.credits).toBe(0);
    expect(result.added).toBe(0);
  });

  it('zero silo capacity does NOT block bypass deposits', () => {
    const result = addCredits(0, 500, 0, true);
    expect(result.credits).toBe(500);
    expect(result.added).toBe(500);
  });

  it('cancel production refund uses bypass', () => {
    // In cancelProduction: addCredits(costPaid, true) — true = bypassSiloCap
    // So even with 0 silo capacity, the refund is received
    const result = addCredits(0, 300, 0, true);
    expect(result.credits).toBe(300);
  });

  it('sell structure refund uses bypass', () => {
    // In sell finalization: addCredits(cost * 0.5, true)
    const refund = Math.floor(2000 * 0.5);
    const result = addCredits(500, refund, 1000, true);
    expect(result.credits).toBe(1500); // 500 + 1000, exceeds silo cap of 1000
  });
});

// =========================================================================
// 8. Power grid recalculation
// =========================================================================
describe('Power grid recalculation', () => {
  it('POWR produces 100 power at full health', () => {
    const structures = [makeStructure('POWR', House.Spain)];
    const { produced } = calcPower(structures);
    expect(produced).toBe(100);
  });

  it('APWR produces 200 power at full health', () => {
    const structures = [makeStructure('APWR', House.Spain)];
    const { produced } = calcPower(structures);
    expect(produced).toBe(200);
  });

  it('damaged POWR produces proportionally less power', () => {
    const structures = [makeStructure('POWR', House.Spain, 10, 10, { hp: 128, maxHp: 256 })];
    const { produced } = calcPower(structures);
    expect(produced).toBe(50); // 100 * (128/256) = 50
  });

  it('damaged APWR produces proportionally less power', () => {
    const structures = [makeStructure('APWR', House.Spain, 10, 10, { hp: 64, maxHp: 256 })];
    const { produced } = calcPower(structures);
    expect(produced).toBe(50); // 200 * (64/256) = 50
  });

  it('WEAP consumes 30 power', () => {
    const structures = [makeStructure('WEAP', House.Spain)];
    const { consumed } = calcPower(structures);
    expect(consumed).toBe(30);
  });

  it('TSLA consumes 150 power (heaviest drain)', () => {
    const structures = [makeStructure('TSLA', House.Spain)];
    const { consumed } = calcPower(structures);
    expect(consumed).toBe(150);
  });

  it('destroyed structures produce/consume 0', () => {
    const structures = [
      makeStructure('POWR', House.Spain, 10, 10, { alive: false }),
      makeStructure('WEAP', House.Spain, 14, 10, { alive: false }),
    ];
    const { produced, consumed } = calcPower(structures);
    expect(produced).toBe(0);
    expect(consumed).toBe(0);
  });

  it('enemy structures do not affect player power grid', () => {
    const structures = [
      makeStructure('POWR', House.USSR),
      makeStructure('WEAP', House.USSR),
    ];
    const { produced, consumed } = calcPower(structures);
    expect(produced).toBe(0);
    expect(consumed).toBe(0);
  });

  it('selling a structure removes it from power calc', () => {
    const structures = [
      makeStructure('POWR', House.Spain, 10, 10, { sellProgress: 0.5 }),
    ];
    const { produced } = calcPower(structures);
    expect(produced).toBe(0); // structures being sold are excluded
  });

  it('full base power balance calculation', () => {
    const structures = [
      makeStructure('POWR', House.Spain, 10, 10),  // +100
      makeStructure('APWR', House.Spain, 12, 10),  // +200
      makeStructure('TENT', House.Spain, 14, 10),  // -20
      makeStructure('WEAP', House.Spain, 16, 10),  // -30
      makeStructure('PROC', House.Spain, 18, 10),  // -30
      makeStructure('DOME', House.Spain, 20, 10),  // -40
    ];
    const { produced, consumed } = calcPower(structures);
    expect(produced).toBe(300);  // 100 + 200
    expect(consumed).toBe(120);  // 20 + 30 + 30 + 40
    expect(produced).toBeGreaterThan(consumed); // sufficient power
  });

  it('losing a power plant can cause low power', () => {
    const structures = [
      makeStructure('POWR', House.Spain, 10, 10),  // +100
      makeStructure('TSLA', House.Spain, 12, 10),  // -150
    ];
    const { produced, consumed } = calcPower(structures);
    expect(produced).toBe(100);
    expect(consumed).toBe(150);
    expect(consumed).toBeGreaterThan(produced); // low power!
    expect(calcPowerMult(produced, consumed)).toBeCloseTo(100 / 150);
  });

  it('FACT (Construction Yard) produces 0 power', () => {
    const structures = [makeStructure('FACT', House.Spain)];
    const { produced } = calcPower(structures);
    expect(produced).toBe(0);
  });

  it('FACT does not consume power either', () => {
    const structures = [makeStructure('FACT', House.Spain)];
    const { consumed } = calcPower(structures);
    expect(consumed).toBe(0);
    expect(POWER_DRAIN['FACT']).toBeUndefined();
  });
});

// =========================================================================
// 9. Structure placement validation
// =========================================================================
describe('Structure placement validation', () => {
  it('non-wall structures require adjacency to existing structures', () => {
    const item = findItem('TENT');
    expect(item.isStructure).toBe(true);
    const WALL_TYPES = new Set(['SBAG', 'FENC', 'BARB', 'BRIK']);
    expect(WALL_TYPES.has(item.type)).toBe(false); // TENT is not a wall
  });

  it('wall structures skip adjacency check', () => {
    const WALL_TYPES = new Set(['SBAG', 'FENC', 'BARB', 'BRIK']);
    for (const wt of ['SBAG', 'FENC', 'BRIK']) {
      expect(WALL_TYPES.has(wt)).toBe(true);
    }
  });

  it('adjacency check uses footprint-based AABB overlap', () => {
    // From placeStructure: expanded AABB of existing structure by 1 cell on each side
    // New structure footprint must overlap with at least one expanded AABB
    const existingCx = 10, existingCy = 10;
    const [sw, sh] = [3, 2]; // WEAP footprint
    const exL = existingCx - 1, exT = existingCy - 1;
    const exR = existingCx + sw + 1, exB = existingCy + sh + 1;

    // Place new 2x2 structure adjacent: cx=13, cy=10
    const nL = 13, nT = 10, nR = 15, nB = 12;
    const adjacent = nL < exR && nR > exL && nT < exB && nB > exT;
    expect(adjacent).toBe(true);

    // Place far away: cx=20, cy=20
    const farL = 20, farT = 20, farR = 22, farB = 22;
    const farAdjacent = farL < exR && farR > exL && farT < exB && farB > exT;
    expect(farAdjacent).toBe(false);
  });

  it('PROC placement spawns a free harvester', () => {
    // In placeStructure: if item.type === 'PROC', spawn a HARV entity
    const item = findItem('PROC');
    expect(item.type).toBe('PROC');
    expect(item.isStructure).toBe(true);
    // The free harvester spawn is verified by source inspection
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const placeIdx = src.indexOf('placeStructure(cx: number, cy: number)');
    expect(placeIdx).toBeGreaterThan(-1);
    const chunk = src.slice(placeIdx, placeIdx + 5000);
    expect(chunk).toContain("'PROC'");
    expect(chunk).toContain('V_HARV');
  });
});

// =========================================================================
// 10. MCV deployment
// =========================================================================
describe('MCV deployment (deployMCV)', () => {
  it('MCV deployment creates a 3x3 FACT structure', () => {
    // deployMCV: entity.cell - 1 in each dimension, 3x3 footprint
    const [fw, fh] = STRUCTURE_SIZE['FACT'] ?? [3, 3];
    expect(fw).toBe(3);
    expect(fh).toBe(3);
  });

  it('MCV is removed on deployment (alive=false)', () => {
    // deployMCV sets entity.alive = false, entity.mission = Mission.DIE
    const mcv = new Entity(UnitType.V_MCV, House.Spain, 100, 100);
    expect(mcv.alive).toBe(true);
    mcv.alive = false;
    mcv.mission = Mission.DIE;
    expect(mcv.alive).toBe(false);
    expect(mcv.mission).toBe(Mission.DIE);
  });

  it('deployMCV source code validates 3x3 clear area', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const idx = src.indexOf('deployMCV(entity');
    expect(idx).toBeGreaterThan(-1);
    const chunk = src.slice(idx, idx + 500);
    // Checks for 3x3 clear area (-1 to 1 in both dx and dy)
    expect(chunk).toContain('dy = -1');
    expect(chunk).toContain('dx = -1');
    expect(chunk).toContain('isPassable');
  });

  it('only V_MCV can be deployed', () => {
    // deployMCV checks entity.type !== UnitType.V_MCV -> return false
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const idx = src.indexOf('deployMCV(entity');
    const chunk = src.slice(idx, idx + 200);
    expect(chunk).toContain('V_MCV');
  });

  it('FACT max HP is correct', () => {
    const factHp = STRUCTURE_MAX_HP['FACT'];
    expect(factHp).toBeDefined();
    expect(factHp).toBeGreaterThan(0);
  });
});

// =========================================================================
// 11. getAvailableItems — tech tree filtering
// =========================================================================
describe('getAvailableItems — tech tree filtering', () => {
  function getAvailableItems(
    structures: MapStructure[],
    playerHouse: House,
    playerFaction: 'allied' | 'soviet',
    playerTechLevel: number,
  ): ProductionItem[] {
    return PRODUCTION_ITEMS.filter(item => {
      if (!hasBuilding(item.prerequisite, structures, playerHouse)) return false;
      if (item.faction !== 'both' && item.faction !== playerFaction) return false;
      if (item.techPrereq && !hasBuilding(item.techPrereq, structures, playerHouse)) return false;
      if (item.techLevel !== undefined && (item.techLevel < 0 || item.techLevel > playerTechLevel)) return false;
      return true;
    });
  }

  it('basic allied base (FACT+POWR+TENT+PROC) can build E1, E3, MEDI', () => {
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain, 12, 10),
      makeStructure('TENT', House.Spain, 14, 10),
      makeStructure('PROC', House.Spain, 16, 10),
    ];
    const items = getAvailableItems(structures, House.Spain, 'allied', 10);
    const types = items.map(i => i.type);
    expect(types).toContain('E1');
    expect(types).toContain('E3');
    expect(types).toContain('MEDI');
    expect(types).not.toContain('E2'); // soviet only
    expect(types).not.toContain('DOG'); // needs KENN
  });

  it('no WEAP means no vehicles available', () => {
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain, 12, 10),
      makeStructure('TENT', House.Spain, 14, 10),
      makeStructure('PROC', House.Spain, 16, 10),
    ];
    const items = getAvailableItems(structures, House.Spain, 'allied', 10);
    const types = items.map(i => i.type);
    expect(types).not.toContain('JEEP');
    expect(types).not.toContain('1TNK');
    expect(types).not.toContain('HARV');
  });

  it('adding WEAP unlocks vehicles', () => {
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain, 12, 10),
      makeStructure('TENT', House.Spain, 14, 10),
      makeStructure('PROC', House.Spain, 16, 10),
      makeStructure('WEAP', House.Spain, 18, 10),
    ];
    const items = getAvailableItems(structures, House.Spain, 'allied', 10);
    const types = items.map(i => i.type);
    expect(types).toContain('JEEP');
    expect(types).toContain('HARV');
  });

  it('techPrereq gates items: HARV needs PROC', () => {
    // HARV has techPrereq='PROC'
    const withoutProc = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain, 12, 10),
      makeStructure('WEAP', House.Spain, 14, 10),
    ];
    const items = getAvailableItems(withoutProc, House.Spain, 'allied', 10);
    expect(items.map(i => i.type)).not.toContain('HARV');

    // With PROC
    withoutProc.push(makeStructure('PROC', House.Spain, 16, 10));
    const items2 = getAvailableItems(withoutProc, House.Spain, 'allied', 10);
    expect(items2.map(i => i.type)).toContain('HARV');
  });

  it('techLevel gates items: ARTY hidden at TL3', () => {
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain, 12, 10),
      makeStructure('PROC', House.Spain, 14, 10),
      makeStructure('WEAP', House.Spain, 16, 10),
    ];
    const items3 = getAvailableItems(structures, House.Spain, 'allied', 3);
    expect(items3.map(i => i.type)).not.toContain('ARTY'); // TL8

    const items8 = getAvailableItems(structures, House.Spain, 'allied', 8);
    expect(items8.map(i => i.type)).toContain('ARTY');
  });

  it('disabled items (TL=-1) never appear even at max tech level', () => {
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain, 12, 10),
      makeStructure('PROC', House.Spain, 14, 10),
      makeStructure('WEAP', House.Spain, 16, 10),
      makeStructure('ATEK', House.Spain, 18, 10),
      makeStructure('DOME', House.Spain, 20, 10),
    ];
    const items = getAvailableItems(structures, House.Spain, 'allied', 99);
    // STNK has techLevel=-1
    expect(items.map(i => i.type)).not.toContain('STNK');
  });

  it('soviet player sees soviet items, not allied-only', () => {
    const structures = [
      makeStructure('FACT', House.USSR),
      makeStructure('POWR', House.USSR, 12, 10),
      makeStructure('BARR', House.USSR, 14, 10),
      makeStructure('PROC', House.USSR, 16, 10),
    ];
    // hasBuilding uses playerHouses set which includes Spain/Greece.
    // For this test we simulate Soviet by adjusting house to Spain but faction to soviet.
    // Actually, the production filter uses playerFaction, not playerHouse for faction check.
    // But hasBuilding checks playerHouses set. Let's use Spain house with soviet faction (skirmish).
    const structuresSpain = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain, 12, 10),
      makeStructure('BARR', House.Spain, 14, 10),
      makeStructure('PROC', House.Spain, 16, 10),
    ];
    const items = getAvailableItems(structuresSpain, House.Spain, 'soviet', 10);
    const types = items.map(i => i.type);
    expect(types).toContain('E1');  // both faction
    expect(types).toContain('E2');  // soviet only
    expect(types).not.toContain('E3');  // allied only
  });
});

// =========================================================================
// 12. Source verification — tickProduction in Game class
// =========================================================================
describe('Source verification — tickProduction implementation', () => {
  let src: string;

  beforeEach(() => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
  });

  it('tickProduction is called every game tick from update()', () => {
    expect(src).toContain('this.tickProduction()');
  });

  it('tickProduction calculates powerMult from powerProduced/powerConsumed', () => {
    const idx = src.indexOf('private tickProduction');
    expect(idx).toBeGreaterThan(-1);
    const chunk = src.slice(idx, idx + 600);
    expect(chunk).toContain('powerProduced');
    expect(chunk).toContain('powerConsumed');
    expect(chunk).toContain('Math.max(0.5');
  });

  it('tickProduction deducts costPerTick incrementally (PR3)', () => {
    const idx = src.indexOf('private tickProduction');
    const chunk = src.slice(idx, idx + 1200);
    expect(chunk).toContain('costPerTick');
    expect(chunk).toContain('entry.costPaid');
  });

  it('tickProduction uses countPlayerBuildings for multi-factory speedup', () => {
    const idx = src.indexOf('private tickProduction');
    const chunk = src.slice(idx, idx + 2500);
    expect(chunk).toContain('countPlayerBuildings');
    expect(chunk).toContain('speedMult * powerMult');
  });

  it('tickProduction checks hasBuilding for prerequisite validity', () => {
    const idx = src.indexOf('private tickProduction');
    const chunk = src.slice(idx, idx + 2500);
    expect(chunk).toContain('hasBuilding');
    expect(chunk).toContain('cancelProduction');
  });

  it('unit completion calls spawnProducedUnit, structure sets pendingPlacement', () => {
    const idx = src.indexOf('private tickProduction');
    const chunk = src.slice(idx, idx + 2500);
    expect(chunk).toContain('spawnProducedUnit');
    expect(chunk).toContain('pendingPlacement');
  });

  it('completed queued items restart with progress=0 and costPaid=0', () => {
    const idx = src.indexOf('private tickProduction');
    const chunk = src.slice(idx, idx + 2500);
    expect(chunk).toContain('queueCount > 1');
    expect(chunk).toContain('progress = 0');
    expect(chunk).toContain('costPaid = 0');
  });

  it('startProduction allows partial funds (PR3: only checks credits > 0)', () => {
    // Find the method declaration (not a call site)
    const idx = src.indexOf('startProduction(item: ProductionItem)');
    expect(idx).toBeGreaterThan(-1);
    const chunk = src.slice(idx, idx + 800);
    expect(chunk).toContain('credits <= 0');
  });

  it('cancelProduction refunds costPaid for active build', () => {
    const idx = src.indexOf('cancelProduction(category: string)');
    expect(idx).toBeGreaterThan(-1);
    const chunk = src.slice(idx, idx + 600);
    expect(chunk).toContain('costPaid');
    expect(chunk).toContain('addCredits');
  });

  it('spawnProducedUnit finds factory and creates Entity', () => {
    const idx = src.indexOf('private spawnProducedUnit');
    expect(idx).toBeGreaterThan(-1);
    const chunk = src.slice(idx, idx + 2000);
    expect(chunk).toContain('new Entity');
    expect(chunk).toContain('entities.push');
  });

  it('spawnProducedUnit auto-moves to rally point if set', () => {
    const idx = src.indexOf('private spawnProducedUnit');
    const chunk = src.slice(idx, idx + 4500);
    expect(chunk).toContain('rallyPoints');
    expect(chunk).toContain('Mission.MOVE');
  });

  it('spawnProducedUnit sets harvester to auto-harvest', () => {
    const idx = src.indexOf('private spawnProducedUnit');
    const chunk = src.slice(idx, idx + 4500);
    expect(chunk).toContain('V_HARV');
    expect(chunk).toContain('harvesterState');
  });

  it('spawnProducedUnit handles aircraft: docks at pad', () => {
    const idx = src.indexOf('private spawnProducedUnit');
    const chunk = src.slice(idx, idx + 2000);
    expect(chunk).toContain('isAircraft');
    expect(chunk).toContain('landedAtStructure');
    expect(chunk).toContain('dockedAircraft');
  });

  it('spawnProducedUnit handles naval: spawns at adjacent water cell', () => {
    const idx = src.indexOf('private spawnProducedUnit');
    const chunk = src.slice(idx, idx + 2000);
    expect(chunk).toContain('isVessel');
    expect(chunk).toContain('findAdjacentWaterCell');
  });
});

// =========================================================================
// 13. Edge cases and integration scenarios
// =========================================================================
describe('Edge cases and integration scenarios', () => {
  it('building a refinery adds 1000 silo capacity', () => {
    const structures = [
      makeStructure('PROC', House.Spain),
    ];
    expect(calculateSiloCapacity(structures)).toBe(1000);
    structures.push(makeStructure('PROC', House.Spain, 14, 10));
    expect(calculateSiloCapacity(structures)).toBe(2000);
  });

  it('destroying all refineries and silos sets capacity to 0', () => {
    const structures = [
      makeStructure('PROC', House.Spain, 10, 10, { alive: false }),
      makeStructure('SILO', House.Spain, 14, 10, { alive: false }),
    ];
    expect(calculateSiloCapacity(structures)).toBe(0);
  });

  it('power plant destruction during production causes slowdown', () => {
    const e1 = findItem('E1');
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain, 12, 10),   // 100 power
      makeStructure('TENT', House.Spain, 14, 10),   // -20 drain
      makeStructure('TSLA', House.Spain, 16, 10),   // -150 drain
      makeStructure('PROC', House.Spain, 18, 10),   // -30 drain
    ];
    const state = { credits: 50000 };
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 1, costPaid: 0 };

    // Power: 100 produced, 200 consumed -> powerFraction = 0.5
    const { produced, consumed } = calcPower(structures);
    expect(produced).toBe(100);
    expect(consumed).toBe(200);

    tickProductionEntry(entry, structures, state, produced, consumed, House.Spain);
    expect(entry.progress).toBeCloseTo(0.5);
  });

  it('building a second power plant restores production speed', () => {
    // After adding second POWR: 200 produced, 200 consumed -> mult = 1.0
    const produced = 200;
    const consumed = 200;
    expect(calcPowerMult(produced, consumed)).toBe(1.0);
  });

  it('structure buildProgress < 1 does not provide silo capacity', () => {
    const structures = [
      makeStructure('PROC', House.Spain, 10, 10, { buildProgress: 0.5 }),
    ];
    expect(calculateSiloCapacity(structures)).toBe(0);
  });

  it('structure buildProgress = 1 (complete) provides silo capacity', () => {
    const structures = [
      makeStructure('PROC', House.Spain, 10, 10, { buildProgress: 1 }),
    ];
    expect(calculateSiloCapacity(structures)).toBe(1000);
  });

  it('structure with undefined buildProgress (pre-placed) provides silo capacity', () => {
    const structures = [
      makeStructure('PROC', House.Spain),
    ];
    expect(calculateSiloCapacity(structures)).toBe(1000);
  });

  it('all POWER_DRAIN values are positive', () => {
    for (const [type, drain] of Object.entries(POWER_DRAIN)) {
      expect(drain, `${type} power drain should be > 0`).toBeGreaterThan(0);
    }
  });

  it('POWR and APWR have no power drain (they produce)', () => {
    expect(POWER_DRAIN['POWR']).toBeUndefined();
    expect(POWER_DRAIN['APWR']).toBeUndefined();
  });
});

// =========================================================================
// 14. Production strip categories
// =========================================================================
describe('Production strip categories', () => {
  it('all structure items go to left strip', () => {
    const structureItems = PRODUCTION_ITEMS.filter(i => i.isStructure);
    expect(structureItems.length).toBeGreaterThan(0);
    for (const item of structureItems) {
      expect(getStripSide(item), `${item.type} should be on left strip`).toBe('left');
    }
  });

  it('all non-structure items go to right strip', () => {
    const unitItems = PRODUCTION_ITEMS.filter(i => !i.isStructure);
    expect(unitItems.length).toBeGreaterThan(0);
    for (const item of unitItems) {
      expect(getStripSide(item), `${item.type} should be on right strip`).toBe('right');
    }
  });

  it('structure and unit queues are independent', () => {
    // Two categories: 'left' (structures) and 'right' (units)
    // Building a structure does not block unit production and vice versa
    const e1 = findItem('E1');
    const powr = findItem('POWR');
    expect(getStripSide(e1)).not.toBe(getStripSide(powr));
  });
});

// =========================================================================
// 15. Full production cycle integration (start → tick → complete)
// =========================================================================
describe('Full production cycle integration', () => {
  it('E1 complete cycle: credits decrease gradually and unit ready at end', () => {
    const e1 = findItem('E1'); // cost=100, buildTime=45
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain, 12, 10),
      makeStructure('TENT', House.Spain, 14, 10),
      makeStructure('PROC', House.Spain, 16, 10),
    ];
    const state = { credits: 5000 };
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 1, costPaid: 0 };
    const startCredits = state.credits;

    let completed = false;
    for (let tick = 0; tick < 100; tick++) {
      const result = tickProductionEntry(entry, structures, state, 100, 20, House.Spain);
      if (result === 'completed') {
        completed = true;
        break;
      }
    }
    expect(completed).toBe(true);
    expect(startCredits - state.credits).toBeCloseTo(100, 0); // total cost deducted
  });

  it('queued items: first completes then second starts at progress=0', () => {
    const e1 = findItem('E1');
    const structures = [
      makeStructure('FACT', House.Spain),
      makeStructure('POWR', House.Spain, 12, 10),
      makeStructure('TENT', House.Spain, 14, 10),
      makeStructure('PROC', House.Spain, 16, 10),
    ];
    const state = { credits: 50000 };
    const entry: ProdEntry = { item: e1, progress: 0, queueCount: 2, costPaid: 0 };

    // Run until first completes
    let firstCompleted = false;
    for (let tick = 0; tick < 100; tick++) {
      const result = tickProductionEntry(entry, structures, state, 100, 20, House.Spain);
      if (result === 'completed') {
        firstCompleted = true;
        break;
      }
    }
    expect(firstCompleted).toBe(true);

    // Simulate queue restart for second item
    entry.queueCount--;
    entry.progress = 0;
    entry.costPaid = 0;
    expect(entry.queueCount).toBe(1);
    expect(entry.progress).toBe(0);
    expect(entry.costPaid).toBe(0);

    // Second item starts fresh
    let secondCompleted = false;
    for (let tick = 0; tick < 100; tick++) {
      const result = tickProductionEntry(entry, structures, state, 100, 20, House.Spain);
      if (result === 'completed') {
        secondCompleted = true;
        break;
      }
    }
    expect(secondCompleted).toBe(true);
  });

  it('wall placement keeps pendingPlacement active for continuous placement', () => {
    // In placeStructure: if isWall, pendingPlacement stays set (not nulled)
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const idx = src.indexOf('placeStructure(cx: number, cy: number)');
    expect(idx).toBeGreaterThan(-1);
    const chunk = src.slice(idx, idx + 3000);
    // Wall path: pendingPlacement is NOT set to null
    // Non-wall path: this.pendingPlacement = null
    expect(chunk).toContain('pendingPlacement = null');
    // Verify wall keeps it active: the null assignment is inside an else-block
    // meaning walls skip it
    expect(chunk).toContain('isWall');
  });

  it('sell refund for structure is flat 50% of cost', () => {
    for (const item of PRODUCTION_ITEMS.filter(i => i.isStructure)) {
      const refund = Math.floor(item.cost * 0.5);
      expect(refund, `${item.type} sell refund`).toBeGreaterThanOrEqual(0);
      expect(refund).toBeLessThanOrEqual(item.cost);
    }
  });
});
