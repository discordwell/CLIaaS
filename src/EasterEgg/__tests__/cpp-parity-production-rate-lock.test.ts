/**
 * C++ behavioral parity tests: production rate is locked at Start() time.
 *
 * C++ reference: factory.cpp:434 — FactoryClass::Start():
 *   int rate = time / Bound(House->Power_Fraction(), fixed(1,16), fixed(1));
 *   rate /= STEP_COUNT;
 *   rate = Bound(rate, 1, 255);
 *   Set_Rate(rate);
 *
 * The rate is calculated ONCE when production starts (or restarts after suspend).
 * Once set, the rate does NOT change even if power changes mid-production.
 * The only way to get a new rate is to suspend and restart production.
 *
 * The TS production system stores powerMult on the queue entry at start time.
 * This test ensures that changing power after production starts has no effect.
 */

import { describe, it, expect } from 'vitest';
import {
  tickProduction,
  startProduction,
  cancelProduction,
  computePowerMult,
  type ProductionContext,
} from '../engine/production';
import type { ProductionItem, House, Faction, WorldPos } from '../engine/types';
import type { MapStructure } from '../engine/scenario';
import type { GameMap } from '../engine/map';

// ── Test helpers ────────────────────────────────────────────────────────────

const makeItem = (overrides: Partial<ProductionItem> = {}): ProductionItem => ({
  type: '2TNK',
  name: 'Medium Tank',
  cost: 800,
  buildTime: 100,
  prerequisite: 'WEAP',
  faction: 'both' as const,
  isStructure: false,
  ...overrides,
});

const makeStructure = (type: string, house: House = 'Greece'): MapStructure => ({
  type,
  house,
  cx: 10,
  cy: 10,
  alive: true,
  hp: 400,
  maxHp: 400,
} as MapStructure);

const makeContext = (overrides: Partial<ProductionContext> = {}): ProductionContext => {
  const factories: MapStructure[] = [
    makeStructure('WEAP', 'Greece'),
    makeStructure('FACT', 'Greece'),
  ];

  return {
    structures: factories,
    entities: [],
    entityById: new Map(),
    credits: 100000,
    playerHouse: 'Greece' as House,
    playerFaction: 'allies' as Faction,
    playerTechLevel: 10,
    baseDiscovered: true,
    scenarioProductionItems: [],
    productionQueue: new Map(),
    pendingPlacement: null,
    wallPlacementPrepaid: false,
    map: {} as GameMap,
    tick: 0,
    powerProduced: 200,
    powerConsumed: 100,
    builtUnitTypes: new Set(),
    builtInfantryTypes: new Set(),
    builtAircraftTypes: new Set(),
    rallyPoints: new Map(),
    isAllied: (a: House, b: House) => a === b,
    hasBuilding: (type: string) => factories.some(s => s.type === type && s.alive),
    playSound: () => {},
    playEva: () => {},
    addEntity: () => {},
    findPassableSpawn: (cx, cy) => ({ cx, cy }),
    ...overrides,
  };
};

function tickNTimes(ctx: ProductionContext, n: number, category = 'right'): number | undefined {
  for (let i = 0; i < n; i++) {
    tickProduction(ctx);
    ctx.tick++;
  }
  return ctx.productionQueue.get(category)?.progress;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('C++ parity: production rate locked at start time (factory.cpp:434)', () => {

  // ── Core invariant: rate is snapshotted at production start ─────────────

  it('production rate is locked at start time', () => {
    const ctx = makeContext({ powerProduced: 200, powerConsumed: 100 });
    const item = makeItem({ buildTime: 100 });
    startProduction(ctx, item);

    // Verify the snapshotted powerMult is 1.0 (full power)
    const entry = ctx.productionQueue.get('right')!;
    expect(entry.powerMult).toBe(1.0);

    // Tick 10 times at full power
    tickNTimes(ctx, 10);
    expect(ctx.productionQueue.get('right')!.progress).toBe(10);
  });

  it('changing power mid-production does NOT affect rate', () => {
    // Start with full power
    const ctx = makeContext({ powerProduced: 200, powerConsumed: 100 });
    const item = makeItem({ buildTime: 100 });
    startProduction(ctx, item);

    // Tick 10 times at full power
    tickNTimes(ctx, 10);
    expect(ctx.productionQueue.get('right')!.progress).toBe(10);

    // Drop power to 50% — in old code this would slow production
    ctx.powerProduced = 50;
    ctx.powerConsumed = 100;

    // Tick 10 more — rate should still be 1.0 per tick (locked at start)
    tickNTimes(ctx, 10);
    expect(ctx.productionQueue.get('right')!.progress).toBe(20);
  });

  it('rate uses power fraction at time of start', () => {
    // Start with 50% power
    const ctx = makeContext({ powerProduced: 50, powerConsumed: 100 });
    const item = makeItem({ buildTime: 100 });
    startProduction(ctx, item);

    // Verify the snapshotted powerMult is 0.5
    const entry = ctx.productionQueue.get('right')!;
    expect(entry.powerMult).toBe(0.5);

    // Tick 10 times — each advances by 0.5
    tickNTimes(ctx, 10);
    expect(ctx.productionQueue.get('right')!.progress).toBe(5);
  });

  it('low power at start = slow rate for entire production', () => {
    // Start at 25% power
    const ctx = makeContext({ powerProduced: 25, powerConsumed: 100 });
    const item = makeItem({ buildTime: 100 });
    startProduction(ctx, item);

    const entry = ctx.productionQueue.get('right')!;
    expect(entry.powerMult).toBe(0.25);

    // Restore full power mid-production
    ctx.powerProduced = 200;
    ctx.powerConsumed = 100;

    // Tick 20 times — still at the slow 0.25 rate
    tickNTimes(ctx, 20);
    expect(ctx.productionQueue.get('right')!.progress).toBe(5); // 20 * 0.25
  });

  it('full power at start = fast rate even if power drops later', () => {
    // Start at full power
    const ctx = makeContext({ powerProduced: 200, powerConsumed: 100 });
    const item = makeItem({ buildTime: 100 });
    startProduction(ctx, item);

    expect(ctx.productionQueue.get('right')!.powerMult).toBe(1.0);

    // Tick 5 times at full speed
    tickNTimes(ctx, 5);
    expect(ctx.productionQueue.get('right')!.progress).toBe(5);

    // Now cut power to minimum (0 produced)
    ctx.powerProduced = 0;
    ctx.powerConsumed = 100;

    // Tick 5 more — still at full speed because rate was locked
    tickNTimes(ctx, 5);
    expect(ctx.productionQueue.get('right')!.progress).toBe(10);
  });

  // ── Restart re-snapshots the rate ──────────────────────────────────────

  it('restarting production re-snapshots the rate', () => {
    // Start at 50% power
    const ctx = makeContext({ powerProduced: 50, powerConsumed: 100 });
    const item = makeItem({ buildTime: 100 });
    startProduction(ctx, item);

    expect(ctx.productionQueue.get('right')!.powerMult).toBe(0.5);

    // Tick 10 times at half speed
    tickNTimes(ctx, 10);
    expect(ctx.productionQueue.get('right')!.progress).toBe(5);

    // Cancel and restart with full power
    cancelProduction(ctx, 'right');
    ctx.powerProduced = 200;
    ctx.powerConsumed = 100;
    startProduction(ctx, item);

    // New entry should snapshot 1.0
    expect(ctx.productionQueue.get('right')!.powerMult).toBe(1.0);

    // Tick 10 times at full speed
    tickNTimes(ctx, 10);
    expect(ctx.productionQueue.get('right')!.progress).toBe(10);
  });

  // ── Queued unit restart re-snapshots the rate ──────────────────────────

  it('queued unit restart after completion re-snapshots rate', () => {
    // Start with full power and queue 2 units
    const ctx = makeContext({
      powerProduced: 200,
      powerConsumed: 100,
    });
    const item = makeItem({ buildTime: 20 });

    startProduction(ctx, item);
    // Queue a second one
    startProduction(ctx, item);

    const entry = ctx.productionQueue.get('right')!;
    expect(entry.powerMult).toBe(1.0);
    expect(entry.queueCount).toBe(2);

    // Drop power to 25% before the first unit completes
    ctx.powerProduced = 25;
    ctx.powerConsumed = 100;

    // Tick 20 times to complete first unit (rate is locked at 1.0)
    tickNTimes(ctx, 20);

    // First unit should have completed, second should start with new rate
    const newEntry = ctx.productionQueue.get('right');
    if (newEntry) {
      // The re-snapshot should have captured 25% power = 0.25
      expect(newEntry.powerMult).toBe(0.25);
      expect(newEntry.queueCount).toBe(1);
      expect(newEntry.progress).toBe(0);
    }
  });

  // ── computePowerMult helper ────────────────────────────────────────────

  it('computePowerMult returns 1.0 at full power', () => {
    const ctx = makeContext({ powerProduced: 200, powerConsumed: 100 });
    expect(computePowerMult(ctx)).toBe(1.0);
  });

  it('computePowerMult returns 0.5 at half power', () => {
    const ctx = makeContext({ powerProduced: 50, powerConsumed: 100 });
    expect(computePowerMult(ctx)).toBe(0.5);
  });

  it('computePowerMult clamps to 1/16 at zero power', () => {
    const ctx = makeContext({ powerProduced: 0, powerConsumed: 100 });
    expect(computePowerMult(ctx)).toBe(1 / 16);
  });

  it('computePowerMult clamps to 1/16 for very low power fraction', () => {
    // 1% power — below 1/16 (6.25%)
    const ctx = makeContext({ powerProduced: 1, powerConsumed: 100 });
    expect(computePowerMult(ctx)).toBe(1 / 16);
  });

  it('computePowerMult returns 1.0 when power exceeds consumption', () => {
    const ctx = makeContext({ powerProduced: 500, powerConsumed: 100 });
    expect(computePowerMult(ctx)).toBe(1.0);
  });

  it('computePowerMult returns 1.0 when no power consumed', () => {
    const ctx = makeContext({ powerProduced: 100, powerConsumed: 0 });
    expect(computePowerMult(ctx)).toBe(1.0);
  });
});
