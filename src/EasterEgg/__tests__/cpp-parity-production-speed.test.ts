/**
 * C++ behavioral parity tests: single-item production speed is independent
 * of factory count.
 *
 * C++ reference: factory.cpp:206 — FactoryClass::AI() loop:
 *   for (int index = 0; index < 1; index++) { ... }
 * The loop runs exactly ONCE per tick per FactoryClass object. Each physical
 * factory building is a separate FactoryClass instance with its own queue.
 * Having 2 War Factories lets you build 2 units simultaneously (in separate
 * factory objects), but does NOT speed up a single item's production.
 *
 * The TS production system uses a single queue per category. This test ensures
 * that production progress for a single queued item advances at 1 per tick
 * regardless of how many prerequisite buildings the player owns.
 */

import { describe, it, expect } from 'vitest';
import {
  tickProduction,
  startProduction,
  countPlayerBuildings,
  type ProductionContext,
} from '../engine/production';
import type { ProductionItem, House, Faction, WorldPos } from '../engine/types';
import type { MapStructure } from '../engine/scenario';
import type { GameMap } from '../engine/map';

// ── Test helpers ────────────────────────────────────────────────────────────

/** A minimal ProductionItem for testing */
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

/** Create a minimal alive structure of a given type for a given house */
const makeStructure = (type: string, house: House = 'Greece'): MapStructure => ({
  type,
  house,
  cx: 10,
  cy: 10,
  alive: true,
  hp: 400,
  maxHp: 400,
} as MapStructure);

/** Create a minimal ProductionContext with N factories of the prerequisite type */
const makeContext = (factoryCount: number, overrides: Partial<ProductionContext> = {}): ProductionContext => {
  const factories: MapStructure[] = [];
  for (let i = 0; i < factoryCount; i++) {
    factories.push(makeStructure('WEAP', 'Greece'));
  }
  // Also add a construction yard (needed for structures, not for units, but harmless)
  factories.push(makeStructure('FACT', 'Greece'));

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

/**
 * Tick production N times and return the progress of the entry in the given category.
 * Returns undefined if the category was removed (completed/cancelled).
 */
function tickNTimes(ctx: ProductionContext, n: number, category = 'right'): number | undefined {
  for (let i = 0; i < n; i++) {
    tickProduction(ctx);
    ctx.tick++;
  }
  return ctx.productionQueue.get(category)?.progress;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('C++ parity: production speed is independent of factory count (factory.cpp:206)', () => {
  // ── Core invariant: factory count must not affect speed ────────────────

  it('single factory: progress advances by 1 per tick', () => {
    const ctx = makeContext(1);
    const item = makeItem({ buildTime: 100 });
    startProduction(ctx, item);

    tickProduction(ctx);
    const progress = ctx.productionQueue.get('right')?.progress;
    expect(progress).toBe(1);
  });

  it('2 factories do NOT speed up single-item production', () => {
    const ctx1 = makeContext(1);
    const ctx2 = makeContext(2);
    const item = makeItem({ buildTime: 100 });

    startProduction(ctx1, item);
    startProduction(ctx2, item);

    // Tick both 10 times
    const progress1 = tickNTimes(ctx1, 10);
    const progress2 = tickNTimes(ctx2, 10);

    expect(progress1).toBe(progress2);
    expect(progress1).toBe(10);
  });

  it('3 factories do NOT speed up single-item production', () => {
    const ctx1 = makeContext(1);
    const ctx3 = makeContext(3);
    const item = makeItem({ buildTime: 100 });

    startProduction(ctx1, item);
    startProduction(ctx3, item);

    const progress1 = tickNTimes(ctx1, 25);
    const progress3 = tickNTimes(ctx3, 25);

    expect(progress1).toBe(progress3);
    expect(progress1).toBe(25);
  });

  it('5 factories do NOT speed up single-item production', () => {
    const ctx1 = makeContext(1);
    const ctx5 = makeContext(5);
    const item = makeItem({ buildTime: 100 });

    startProduction(ctx1, item);
    startProduction(ctx5, item);

    const progress1 = tickNTimes(ctx1, 50);
    const progress5 = tickNTimes(ctx5, 50);

    expect(progress1).toBe(progress5);
    expect(progress1).toBe(50);
  });

  // ── Completion tick is the same regardless of factory count ────────────

  it('production completes at exactly buildTime ticks with 1 factory', () => {
    const buildTime = 40;
    const ctx = makeContext(1);
    const item = makeItem({ buildTime, isStructure: true });
    startProduction(ctx, item);

    // Tick buildTime - 1 times: should NOT be complete
    tickNTimes(ctx, buildTime - 1);
    expect(ctx.productionQueue.has('left')).toBe(true);

    // One more tick: completes (structure goes to pendingPlacement)
    tickProduction(ctx);
    // Once complete, for structures the entry is deleted and pendingPlacement is set
    expect(ctx.pendingPlacement).not.toBeNull();
  });

  it('production completes at the same tick with 1 vs 2 factories', () => {
    const buildTime = 30;
    const item = makeItem({ buildTime, isStructure: true });

    // With 1 factory
    const ctx1 = makeContext(1);
    startProduction(ctx1, item);
    tickNTimes(ctx1, buildTime - 1, 'left');
    expect(ctx1.productionQueue.has('left')).toBe(true);
    tickProduction(ctx1);
    expect(ctx1.pendingPlacement).not.toBeNull();

    // With 2 factories — should complete at the SAME tick
    const ctx2 = makeContext(2);
    startProduction(ctx2, item);
    tickNTimes(ctx2, buildTime - 1, 'left');
    expect(ctx2.productionQueue.has('left')).toBe(true);
    tickProduction(ctx2);
    expect(ctx2.pendingPlacement).not.toBeNull();
  });

  it('production completes at the same tick with 1 vs 3 factories', () => {
    const buildTime = 50;
    const item = makeItem({ buildTime, isStructure: true });

    const ctx1 = makeContext(1);
    startProduction(ctx1, item);
    tickNTimes(ctx1, buildTime, 'left');
    expect(ctx1.pendingPlacement).not.toBeNull();

    const ctx3 = makeContext(3);
    startProduction(ctx3, item);
    tickNTimes(ctx3, buildTime, 'left');
    expect(ctx3.pendingPlacement).not.toBeNull();
  });

  // ── Progress is exactly 1 per tick (no multiplier) ────────────────────

  it('progress at each tick is exactly tick count with full power', () => {
    const ctx = makeContext(2);
    const item = makeItem({ buildTime: 100 });
    startProduction(ctx, item);

    for (let tick = 1; tick <= 20; tick++) {
      tickProduction(ctx);
      const progress = ctx.productionQueue.get('right')?.progress;
      expect(progress, `progress at tick ${tick}`).toBe(tick);
    }
  });

  // ── Power penalty still works (orthogonal to factory count) ───────────

  it('low power slows production the same regardless of factory count', () => {
    // 50% power → powerMult = 0.5
    const makeCtxLowPower = (factories: number) => makeContext(factories, {
      powerProduced: 50,
      powerConsumed: 100,
    });

    const ctx1 = makeCtxLowPower(1);
    const ctx2 = makeCtxLowPower(2);
    const item = makeItem({ buildTime: 100 });

    startProduction(ctx1, item);
    startProduction(ctx2, item);

    tickNTimes(ctx1, 10);
    tickNTimes(ctx2, 10);

    const p1 = ctx1.productionQueue.get('right')?.progress;
    const p2 = ctx2.productionQueue.get('right')?.progress;
    expect(p1).toBe(p2);
    // At 50% power, progress per tick is 0.5, so after 10 ticks = 5
    expect(p1).toBe(5);
  });

  // ── countPlayerBuildings helper itself still works ────────────────────

  it('countPlayerBuildings correctly counts alive factories', () => {
    const structures: MapStructure[] = [
      makeStructure('WEAP', 'Greece'),
      makeStructure('WEAP', 'Greece'),
      makeStructure('WEAP', 'USSR'),   // enemy — should not count
      makeStructure('BARR', 'Greece'),  // different type — should not count
    ];
    const isAllied = (a: House, b: House) => a === b;
    expect(countPlayerBuildings(structures, 'WEAP', 'Greece' as House, isAllied)).toBe(2);
  });

  it('countPlayerBuildings does not count dead factories', () => {
    const dead = makeStructure('WEAP', 'Greece');
    dead.alive = false;
    const structures: MapStructure[] = [
      makeStructure('WEAP', 'Greece'),
      dead,
    ];
    const isAllied = (a: House, b: House) => a === b;
    expect(countPlayerBuildings(structures, 'WEAP', 'Greece' as House, isAllied)).toBe(1);
  });

  // ── Regression guard: if someone re-adds a speed multiplier ───────────

  it('adding a factory mid-production does NOT change remaining build time', () => {
    const ctx = makeContext(1);
    const item = makeItem({ buildTime: 100 });
    startProduction(ctx, item);

    // Tick 30 times with 1 factory
    tickNTimes(ctx, 30);
    const progressBefore = ctx.productionQueue.get('right')?.progress;
    expect(progressBefore).toBe(30);

    // Now add a second factory
    ctx.structures.push(makeStructure('WEAP', 'Greece'));

    // Tick 10 more times — progress should still be exactly +10, not +20
    tickNTimes(ctx, 10);
    const progressAfter = ctx.productionQueue.get('right')?.progress;
    expect(progressAfter).toBe(40); // 30 + 10, NOT 30 + 20
  });

  it('removing a factory mid-production does NOT change build speed', () => {
    const ctx = makeContext(2);
    const item = makeItem({ buildTime: 100 });
    startProduction(ctx, item);

    // Tick 20 times with 2 factories
    tickNTimes(ctx, 20);
    expect(ctx.productionQueue.get('right')?.progress).toBe(20);

    // Destroy one factory (mark as dead)
    const weaps = ctx.structures.filter(s => s.type === 'WEAP');
    weaps[0].alive = false;

    // Tick 10 more — speed unchanged, still +1/tick
    tickNTimes(ctx, 10);
    expect(ctx.productionQueue.get('right')?.progress).toBe(30);
  });
});
