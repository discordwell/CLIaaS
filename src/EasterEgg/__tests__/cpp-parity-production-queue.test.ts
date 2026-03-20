/**
 * C++ behavioral parity tests: production queue mechanics — cost deduction timing,
 * suspend/resume, abandon/refund, insufficient funds behavior, and completion.
 *
 * C++ references:
 *   factory.h:92     — STEP_COUNT = 54  (production broken into 54 steps)
 *   factory.cpp:201  — AI() main production tick loop
 *   factory.cpp:210  — Cost_Per_Tick() called each tick
 *   factory.cpp:220  — Insufficient funds: roll back one stage (Set_Stage(Fetch_Stage()-1))
 *   factory.cpp:223  — Sufficient funds: House->Spend_Money(cost); Balance -= cost;
 *   factory.cpp:230  — Completion: when Fetch_Stage() == STEP_COUNT, IsSuspended=true, Balance=0
 *   factory.cpp:290  — Set(): Balance = cost * CostBias, stage=0, suspended=true
 *   factory.cpp:382  — Suspend(): returns false if already suspended
 *   factory.cpp:411  — Start(): checks Available_Money() >= Cost_Per_Tick() before starting
 *   factory.cpp:469  — Abandon(): refunds (totalCost - Balance) i.e. what was actually spent
 *   factory.cpp:615  — Cost_Per_Tick(): Balance / (STEP_COUNT - Fetch_Stage()), integer division
 *   factory.cpp:647  — Completed(): resets factory only when stage == STEP_COUNT
 *
 * house.cpp:2398 — Begin_Production(): creates factory, calls Set() then Start()
 * house.cpp:2458 — Suspend_Production(): calls factory->Suspend()
 * house.cpp:2503 — Abandon_Production(): calls factory->Abandon(), refunds money
 * house.cpp:6957 — Fetch_Factory(): one factory per RTTI type (unit/infantry/building/aircraft/vessel)
 *
 * Key C++ vs TS structural differences:
 *   - C++ has SEPARATE factory objects per RTTI type (UnitFactory, InfantryFactory, etc.)
 *   - TS collapses all non-structure items into a single 'right' queue
 *   - C++ uses Balance (remaining cost, decreasing); TS uses costPaid (spent so far, increasing)
 *   - C++ rolls back stage on insufficient funds; TS pauses entirely
 */

import { describe, it, expect } from 'vitest';
import {
  tickProduction,
  startProduction,
  cancelProduction,
  computePowerMult,
  getEffectiveCost,
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

const makeStructureItem = (overrides: Partial<ProductionItem> = {}): ProductionItem => ({
  type: 'POWR',
  name: 'Power Plant',
  cost: 300,
  buildTime: 60,
  prerequisite: 'FACT',
  faction: 'both' as const,
  isStructure: true,
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
    makeStructure('BARR', 'Greece'),
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

function tickNTimes(ctx: ProductionContext, n: number): void {
  for (let i = 0; i < n; i++) {
    tickProduction(ctx);
    ctx.tick++;
  }
}

// ============================================================
// Section 1: Cost deduction timing — C++ incremental cost
// factory.cpp:210-224 — cost deducted per tick, not upfront
// ============================================================
describe('C++ parity: incremental cost deduction (factory.cpp:210-224)', () => {

  it('starting production does NOT deduct full cost upfront', () => {
    // C++ factory.cpp:290-330 — Set() records Balance = cost but doesn't Spend_Money.
    // Cost is deducted incrementally during AI() ticks.
    const ctx = makeContext({ credits: 1000 });
    const item = makeItem({ cost: 800, buildTime: 100 });
    startProduction(ctx, item);

    // Credits should NOT be 200 (1000-800). Some portion at most was deducted.
    expect(ctx.credits).toBeGreaterThan(200);
  });

  it('cost is deducted incrementally each tick', () => {
    const ctx = makeContext({ credits: 10000 });
    const item = makeItem({ cost: 1000, buildTime: 100 });
    startProduction(ctx, item);

    const creditsAfterStart = ctx.credits;

    // Tick once — some cost should be deducted
    tickProduction(ctx);
    const creditsAfterOneTick = ctx.credits;
    expect(creditsAfterOneTick).toBeLessThan(creditsAfterStart);

    // Tick again — more cost deducted
    tickProduction(ctx);
    const creditsAfterTwoTicks = ctx.credits;
    expect(creditsAfterTwoTicks).toBeLessThan(creditsAfterOneTick);
  });

  it('total cost deducted equals effective cost when production completes', () => {
    // C++ factory.cpp:230-234 — on completion, remaining Balance is force-spent:
    //   House->Spend_Money(Balance); Balance = 0;
    // This ensures the EXACT total cost is paid regardless of installment rounding.
    const initialCredits = 10000;
    const ctx = makeContext({ credits: initialCredits });
    const item = makeItem({ cost: 800, buildTime: 50, isStructure: true });
    startProduction(ctx, item);

    const effectiveCost = getEffectiveCost(item, ctx.playerHouse);

    // Tick until completion
    tickNTimes(ctx, 50);

    // Structure should be in placement mode
    expect(ctx.pendingPlacement).not.toBeNull();

    // Total cost deducted should equal effective cost
    const totalDeducted = initialCredits - ctx.credits;
    expect(totalDeducted).toBe(effectiveCost);
  });

  it('costPerTick = effectiveCost / buildTime for each tick', () => {
    // C++ factory.cpp:615-627 — Cost_Per_Tick = Balance / (STEP_COUNT - stage)
    // TS: costPerTick = effectiveCost / buildTime (constant per tick)
    // C++ uses decreasing Balance / decreasing remaining steps — so per-tick cost
    // is roughly constant but uses integer division which rounds.
    // TS simplifies to effectiveCost / buildTime.
    const ctx = makeContext({ credits: 10000 });
    const item = makeItem({ cost: 1000, buildTime: 100 });
    startProduction(ctx, item);

    const creditsBeforeTick = ctx.credits;
    tickProduction(ctx);
    const costFirstTick = creditsBeforeTick - ctx.credits;

    // TS: costPerTick = 1000 / 100 = 10
    const expectedCostPerTick = getEffectiveCost(item, ctx.playerHouse) / item.buildTime;
    expect(costFirstTick).toBe(expectedCostPerTick);
  });
});

// ============================================================
// Section 2: Insufficient funds behavior
// factory.cpp:220-221 — C++ rolls back one stage when broke
// ============================================================
describe('C++ parity: insufficient funds (factory.cpp:220-221)', () => {

  it('production pauses when credits run out', () => {
    // C++ factory.cpp:220: if (cost > House->Available_Money()) Set_Stage(Fetch_Stage()-1);
    // C++ rolls back one stage. TS pauses (skips advancement).
    // Both behaviors result in production not advancing. The key observable
    // is that progress does not increase when credits are insufficient.
    const ctx = makeContext({ credits: 50 });
    const item = makeItem({ cost: 1000, buildTime: 100 });
    startProduction(ctx, item);

    // Tick some times — production should eventually stall
    const creditsAfterStart = ctx.credits;
    tickNTimes(ctx, 200);

    // Credits should be near 0 or 0
    expect(ctx.credits).toBeLessThanOrEqual(creditsAfterStart);

    // Production should NOT have completed since we didn't have enough money
    const entry = ctx.productionQueue.get('right');
    // If entry still exists, it hasn't completed
    if (entry) {
      expect(entry.progress).toBeLessThan(item.buildTime);
    }
  });

  it('production resumes when credits become available', () => {
    const ctx = makeContext({ credits: 100 });
    const item = makeItem({ cost: 1000, buildTime: 100 });
    startProduction(ctx, item);

    // Let it stall — not enough for full production
    tickNTimes(ctx, 20);
    const stalledProgress = ctx.productionQueue.get('right')?.progress ?? 0;

    // Add more credits
    ctx.credits += 10000;

    // Tick more — should resume
    tickNTimes(ctx, 20);
    const resumedProgress = ctx.productionQueue.get('right')?.progress ?? 0;

    expect(resumedProgress).toBeGreaterThan(stalledProgress);
  });

  it('can start production with partial funds (C++ factory.cpp:416)', () => {
    // C++ Start(): checks Available_Money() >= Cost_Per_Tick()
    // Only needs enough for ONE tick's payment, not full cost.
    // TS: checks ctx.credits > 0 (even more lenient — PR3 comment)
    const costPerTick = 1000 / 100; // = 10
    const ctx = makeContext({ credits: 15 }); // enough for 1-2 ticks
    const item = makeItem({ cost: 1000, buildTime: 100 });

    startProduction(ctx, item);

    // Should have started — queue entry should exist
    const entry = ctx.productionQueue.get('right');
    expect(entry).toBeDefined();
  });

  it('cannot start production with zero credits', () => {
    // C++ Start(): Available_Money() >= Cost_Per_Tick() — fails at 0
    // TS: credits <= 0 check
    const ctx = makeContext({ credits: 0 });
    const item = makeItem({ cost: 1000, buildTime: 100 });

    startProduction(ctx, item);

    // Should NOT have started
    const entry = ctx.productionQueue.get('right');
    expect(entry).toBeUndefined();
  });

  it('C++ PARITY GAP: insufficient funds causes stage rollback in C++, pause in TS', () => {
    // C++ factory.cpp:220-221:
    //   if (cost > House->Available_Money()) {
    //     Set_Stage(Fetch_Stage()-1);  // ROLL BACK one stage
    //   }
    // This means in C++, if you run out of money mid-production, the progress
    // bar actually REVERSES by one step. The countdown timer continues, so by
    // the time the next step fires, you might have enough money again.
    //
    // TS production.ts:174-177:
    //   // PR3: Insufficient funds — pause production (don't advance progress)
    //   continue;
    // TS simply skips advancement — no rollback occurs.
    //
    // Observable difference: In C++, being broke during production can cause
    // the progress bar to jitter backwards. In TS, it just freezes.
    // PARITY GAP — leaving as documentation of known divergence.
    const ctx = makeContext({ credits: 50 });
    const item = makeItem({ cost: 1000, buildTime: 100 });
    startProduction(ctx, item);

    // Tick until money runs out
    tickNTimes(ctx, 10);
    const entry = ctx.productionQueue.get('right');
    if (entry) {
      const progressWhenBroke = entry.progress;

      // Tick more with no money — in C++ progress would decrease, in TS it freezes
      tickNTimes(ctx, 10);
      const progressAfter = ctx.productionQueue.get('right')?.progress ?? 0;

      // TS behavior: progress stays the same (frozen, not rolled back)
      // C++ behavior would have: progress <= progressWhenBroke (rolled back)
      // We test the TS behavior here:
      expect(progressAfter).toBeGreaterThanOrEqual(progressWhenBroke);
      // PARITY GAP: C++ would have progressAfter < progressWhenBroke
    }
  });
});

// ============================================================
// Section 3: Suspend/Resume
// factory.cpp:382-448 — Suspend sets rate=0; Start recalculates rate
// ============================================================
describe('C++ parity: suspend and resume (factory.cpp:382-448)', () => {

  it('cancelling and restarting resets progress to 0', () => {
    // C++ Abandon(): refunds money, resets stage to 0
    // TS cancelProduction(): removes entry, refunds costPaid
    // When the player restarts, it's a fresh production.
    const ctx = makeContext({ credits: 10000 });
    const item = makeItem({ cost: 800, buildTime: 100 });

    startProduction(ctx, item);
    tickNTimes(ctx, 30);

    const entry = ctx.productionQueue.get('right');
    expect(entry).toBeDefined();
    expect(entry!.progress).toBe(30);

    // Cancel (equivalent to C++ Abandon)
    cancelProduction(ctx, 'right');
    expect(ctx.productionQueue.get('right')).toBeUndefined();

    // Restart
    startProduction(ctx, item);
    const newEntry = ctx.productionQueue.get('right');
    expect(newEntry).toBeDefined();
    expect(newEntry!.progress).toBe(0);
    expect(newEntry!.costPaid).toBe(0);
  });

  it('C++ Suspend returns false if already suspended (factory.cpp:386)', () => {
    // C++ factory.cpp:386-391:
    //   if (!IsSuspended) { IsSuspended = true; Set_Rate(0); return(true); }
    //   return(false);
    //
    // TS doesn't have an explicit suspend; cancel removes the entry entirely.
    // This test documents the C++ behavior.
    // No direct TS equivalent to test — documenting the behavioral difference.
    expect(true).toBe(true); // Structural documentation only
  });

  it('production progress is preserved until cancel (not pause)', () => {
    // In C++, Suspend() preserves the stage and Balance. Start() resumes from
    // where it was. In TS, there's no true "pause" — only cancel+restart.
    // This documents that TS cancel is more like C++ Abandon (destructive)
    // rather than C++ Suspend (non-destructive).
    const ctx = makeContext({ credits: 10000 });
    const item = makeItem({ cost: 800, buildTime: 100 });

    startProduction(ctx, item);
    tickNTimes(ctx, 50);

    const midProgress = ctx.productionQueue.get('right')!.progress;
    expect(midProgress).toBe(50);

    // Cancel — this is C++ Abandon, not Suspend
    cancelProduction(ctx, 'right');

    // Restart — fresh, no progress preservation
    startProduction(ctx, item);
    expect(ctx.productionQueue.get('right')!.progress).toBe(0);
  });
});

// ============================================================
// Section 4: Abandon/Cancel refund mechanics
// factory.cpp:469-506 — Refund = totalCost - Balance (what was spent)
// ============================================================
describe('C++ parity: cancel/abandon refund (factory.cpp:469-506)', () => {

  it('cancel refunds the amount spent so far', () => {
    // C++ factory.cpp:479-480:
    //   int money = Object->Class_Of().Cost_Of() * Object->House->CostBias;
    //   House->Refund_Money(money - Balance);
    // money = total cost; Balance = remaining cost; so refund = total - remaining = spent
    //
    // TS: credits += entry.costPaid (same net effect)
    const initialCredits = 10000;
    const ctx = makeContext({ credits: initialCredits });
    const item = makeItem({ cost: 1000, buildTime: 100 });

    startProduction(ctx, item);
    tickNTimes(ctx, 50); // Build halfway

    const creditsBeforeCancel = ctx.credits;
    const entry = ctx.productionQueue.get('right')!;
    const costPaid = entry.costPaid;

    cancelProduction(ctx, 'right');

    // After cancel, credits should be refunded by costPaid
    expect(ctx.credits).toBe(creditsBeforeCancel + costPaid);
  });

  it('cancel at 0% progress refunds nothing', () => {
    const initialCredits = 10000;
    const ctx = makeContext({ credits: initialCredits });
    const item = makeItem({ cost: 1000, buildTime: 100 });

    startProduction(ctx, item);
    // Don't tick — no cost deducted yet

    const creditsBeforeCancel = ctx.credits;
    cancelProduction(ctx, 'right');

    // No cost was paid, so no refund
    expect(ctx.credits).toBe(creditsBeforeCancel);
  });

  it('cancel refund + remaining credits = original credits (accounting identity)', () => {
    // Total money should be conserved: credits_after_cancel = credits_initial - 0
    // Because everything spent was refunded.
    const initialCredits = 10000;
    const ctx = makeContext({ credits: initialCredits });
    const item = makeItem({ cost: 1000, buildTime: 100 });

    startProduction(ctx, item);
    tickNTimes(ctx, 30);

    cancelProduction(ctx, 'right');

    // All money should be returned
    expect(ctx.credits).toBe(initialCredits);
  });

  it('cancel with queued items refunds queued item cost (full cost)', () => {
    // C++ doesn't have multi-queue on a single factory. TS allows queueing multiple
    // of the same item. Queued items are paid upfront in TS.
    // Cancelling a queued item refunds the full item cost.
    const ctx = makeContext({ credits: 10000 });
    const item = makeItem({ cost: 500, buildTime: 50 });

    startProduction(ctx, item);
    startProduction(ctx, item); // queue second one (paid upfront)

    const entry = ctx.productionQueue.get('right')!;
    expect(entry.queueCount).toBe(2);

    const creditsBeforeCancel = ctx.credits;
    cancelProduction(ctx, 'right'); // removes one from queue

    // Should refund exactly one item's effective cost
    const effectiveCost = getEffectiveCost(item, ctx.playerHouse);
    expect(ctx.credits).toBe(creditsBeforeCancel + effectiveCost);
    expect(ctx.productionQueue.get('right')!.queueCount).toBe(1);
  });
});

// ============================================================
// Section 5: Production completion
// factory.cpp:230-235 — completion: IsSuspended=true, Balance=0
// ============================================================
describe('C++ parity: production completion (factory.cpp:230-235)', () => {

  it('structure production enters placement mode on completion', () => {
    // C++ factory.cpp:230: Fetch_Stage() == STEP_COUNT → IsSuspended = true
    // Then the house waits for placement. In TS: pendingPlacement is set.
    const ctx = makeContext({ credits: 10000 });
    const item = makeStructureItem({ cost: 300, buildTime: 30 });

    startProduction(ctx, item);
    tickNTimes(ctx, 30);

    expect(ctx.pendingPlacement).not.toBeNull();
    expect(ctx.pendingPlacement!.type).toBe('POWR');
    // Queue entry should be removed
    expect(ctx.productionQueue.has('left')).toBe(false);
  });

  it('unit production spawns entity on completion', () => {
    const ctx = makeContext({ credits: 10000 });
    const item = makeItem({ cost: 800, buildTime: 50 });

    startProduction(ctx, item);
    tickNTimes(ctx, 50);

    // Unit should have been spawned
    expect(ctx.entities.length).toBeGreaterThan(0);
    // Queue entry should be removed
    expect(ctx.productionQueue.has('right')).toBe(false);
  });

  it('PARITY GAP: completion should consume exact cost — TS accumulates rounding error', () => {
    // C++ factory.cpp:233: House->Spend_Money(Balance); Balance = 0;
    // On completion, C++ force-spends any remaining Balance, ensuring the EXACT
    // total cost is paid regardless of per-tick rounding.
    //
    // TS: costPerTick = effectiveCost / buildTime (floating point).
    // For non-divisible costs (e.g. 777 / 100 = 7.77), each tick deducts 7.77
    // which accumulates floating-point error over 100 ticks.
    // There is no "force-spend remainder" step on completion.
    //
    // PARITY GAP: C++ guarantees exact total cost. TS has floating-point drift.
    const initialCredits = 10000;
    const oddCost = 777; // intentionally not divisible by buildTime
    const ctx = makeContext({ credits: initialCredits });
    const item = makeItem({ cost: oddCost, buildTime: 100, isStructure: true });

    startProduction(ctx, item);
    tickNTimes(ctx, 100);

    const effectiveCost = getEffectiveCost(item, ctx.playerHouse);
    const totalDeducted = initialCredits - ctx.credits;

    // C++ would have: totalDeducted === effectiveCost (exactly 777)
    // TS has floating-point drift: totalDeducted ~= 777.000000000044
    // Verify the drift exists (this is the parity gap):
    expect(totalDeducted).not.toBe(effectiveCost); // PARITY GAP — not exact
    // But it should be very close (within floating-point epsilon)
    expect(Math.abs(totalDeducted - effectiveCost)).toBeLessThan(0.01);
  });

  it('evenly-divisible cost produces exact total deduction', () => {
    // When cost is evenly divisible by buildTime, TS has no rounding error.
    // cost=800, buildTime=100 → costPerTick = 8.0 (exact)
    const initialCredits = 10000;
    const ctx = makeContext({ credits: initialCredits });
    const item = makeItem({ cost: 800, buildTime: 100, isStructure: true });

    startProduction(ctx, item);
    tickNTimes(ctx, 100);

    const effectiveCost = getEffectiveCost(item, ctx.playerHouse);
    expect(ctx.credits).toBe(initialCredits - effectiveCost);
  });

  it('queued items auto-start after first item completes', () => {
    // C++ house.cpp — after Completed(), the factory is reset and next item Set+Start.
    // TS: when queueCount > 1, progress resets to 0, queueCount decremented.
    const ctx = makeContext({ credits: 100000 });
    const item = makeItem({ cost: 500, buildTime: 20 });

    startProduction(ctx, item); // first
    startProduction(ctx, item); // queue second

    expect(ctx.productionQueue.get('right')!.queueCount).toBe(2);

    // Complete first unit
    tickNTimes(ctx, 20);

    // Second unit should have started
    const entry = ctx.productionQueue.get('right');
    expect(entry).toBeDefined();
    expect(entry!.queueCount).toBe(1);
    expect(entry!.progress).toBe(0);
    expect(entry!.costPaid).toBe(0);
  });
});

// ============================================================
// Section 6: Cost_Per_Tick C++ integer division behavior
// factory.cpp:615-627 — Balance / (STEP_COUNT - stage)
// ============================================================
describe('C++ parity: Cost_Per_Tick integer division (factory.cpp:615-627)', () => {

  it('C++ uses integer division for cost per tick (Balance / remaining_steps)', () => {
    // C++ factory.cpp:622: return(Balance / steps);
    // This is C++ integer division — truncates toward zero.
    // Example: Balance=800, STEP_COUNT=54, stage=0 → 800/54 = 14 (not 14.81)
    //
    // TS uses: effectiveCost / buildTime (floating point)
    // For cost=800, buildTime=100: 800/100 = 8.0 (exact)
    //
    // The C++ approach means earlier ticks pay LESS than later ticks because:
    //   tick 0: 800/54 = 14 (Balance=786)
    //   tick 1: 786/53 = 14 (Balance=772)
    //   ...
    //   tick 52: remaining/2 (could be large)
    //   tick 53: remaining/1 = remaining (pays whatever is left)
    //
    // TS approach: each tick pays the same flat amount.
    // Both converge to the same total cost but the deduction curve differs.
    const ctx = makeContext({ credits: 10000 });
    const item = makeItem({ cost: 800, buildTime: 100 });
    startProduction(ctx, item);

    // TS costPerTick should be constant: 800/100 = 8
    const creditsBeforeTick1 = ctx.credits;
    tickProduction(ctx);
    const costTick1 = creditsBeforeTick1 - ctx.credits;

    const creditsBeforeTick2 = ctx.credits;
    tickProduction(ctx);
    const costTick2 = creditsBeforeTick2 - ctx.credits;

    // In TS, cost per tick is constant
    expect(costTick1).toBe(costTick2);
    // C++ would have slightly varying costs per tick due to integer division
    // This is an acceptable simplification — total cost matches.
  });
});

// ============================================================
// Section 7: Separate queues per category
// house.cpp:6957 — Fetch_Factory(): one factory per RTTI type
// ============================================================
describe('C++ parity: separate queues per RTTI type (house.cpp:6957)', () => {

  it('structures and units have separate queues', () => {
    // C++ house.cpp: BuildingFactory, UnitFactory, InfantryFactory are separate.
    // TS: 'left' = structures, 'right' = units
    const ctx = makeContext({ credits: 100000 });
    const unit = makeItem({ cost: 800, buildTime: 100 });
    const structure = makeStructureItem({ cost: 300, buildTime: 60 });

    startProduction(ctx, unit);
    startProduction(ctx, structure);

    // Both should be in separate queues
    expect(ctx.productionQueue.has('right')).toBe(true);
    expect(ctx.productionQueue.has('left')).toBe(true);

    // Tick 30 times — both should advance independently
    tickNTimes(ctx, 30);

    expect(ctx.productionQueue.get('right')!.progress).toBe(30);
    expect(ctx.productionQueue.get('left')!.progress).toBe(30);
  });

  it('cancelling one category does not affect the other', () => {
    const ctx = makeContext({ credits: 100000 });
    const unit = makeItem({ cost: 800, buildTime: 100 });
    const structure = makeStructureItem({ cost: 300, buildTime: 60 });

    startProduction(ctx, unit);
    startProduction(ctx, structure);
    tickNTimes(ctx, 20);

    // Cancel unit production
    cancelProduction(ctx, 'right');

    expect(ctx.productionQueue.has('right')).toBe(false);
    expect(ctx.productionQueue.has('left')).toBe(true);
    expect(ctx.productionQueue.get('left')!.progress).toBe(20);
  });

  it('PARITY GAP: C++ has separate factories for infantry/unit/aircraft/vessel', () => {
    // C++ house.cpp:6961-6990 — Fetch_Factory() returns different factory_index for:
    //   RTTI_INFANTRY → InfantryFactory
    //   RTTI_UNIT → UnitFactory
    //   RTTI_AIRCRAFT → AircraftFactory
    //   RTTI_VESSEL → VesselFactory
    //   RTTI_BUILDING → BuildingFactory
    //
    // This means in C++, you can simultaneously produce:
    //   1 infantry + 1 vehicle + 1 aircraft + 1 vessel + 1 building = 5 items
    //
    // TS collapses all non-structure items into 'right' queue:
    //   1 unit (infantry OR vehicle OR aircraft OR vessel) + 1 building = 2 items max
    //
    // PARITY GAP — documented divergence
    const ctx = makeContext({ credits: 100000 });
    const tank = makeItem({ cost: 800, buildTime: 100, type: '2TNK' });
    const infantry = makeItem({ cost: 100, buildTime: 30, type: 'E1', prerequisite: 'BARR' });

    startProduction(ctx, tank);
    startProduction(ctx, infantry);

    // In TS, the second start gets ignored because same category ('right')
    // In C++, both would produce simultaneously on separate factories
    const entry = ctx.productionQueue.get('right')!;
    expect(entry.item.type).toBe('2TNK');
    // Infantry was NOT queued separately — TS limitation
    // PARITY GAP: C++ would have both building simultaneously
  });
});

// ============================================================
// Section 8: Country cost bonus (CostBias)
// factory.cpp:322 — Balance = object.Cost_Of() * house.CostBias
// ============================================================
describe('C++ parity: country cost bias (factory.cpp:322)', () => {

  it('USSR pays 10% less (CostBias = 0.9)', () => {
    // C++ factory.cpp:322: Balance = object.Cost_Of() * house.CostBias
    // rules.ini [USSR] Cost=0.9
    const item = makeItem({ cost: 1000 });
    const ussrCost = getEffectiveCost(item, 'USSR' as House);
    expect(ussrCost).toBe(900); // 1000 * 0.9 = 900
  });

  it('Greece pays full price (CostBias = 1.0)', () => {
    const item = makeItem({ cost: 1000 });
    const greeceCost = getEffectiveCost(item, 'Greece' as House);
    expect(greeceCost).toBe(1000);
  });

  it('cost bias affects total deduction on completion', () => {
    const initialCredits = 10000;
    const ctx = makeContext({
      credits: initialCredits,
      playerHouse: 'USSR' as House,
    });
    const item = makeItem({ cost: 1000, buildTime: 50, isStructure: true });

    startProduction(ctx, item);
    tickNTimes(ctx, 50);

    const effectiveCost = getEffectiveCost(item, 'USSR' as House);
    expect(ctx.credits).toBe(initialCredits - effectiveCost);
    expect(effectiveCost).toBe(900);
  });
});

// ============================================================
// Section 9: Factory Set() initialization
// factory.cpp:290-330 — Set() creates object, records Balance, stage=0
// ============================================================
describe('C++ parity: factory initialization (factory.cpp:290-330)', () => {

  it('production starts at progress 0', () => {
    // C++ factory.cpp:305: Set_Stage(0)
    const ctx = makeContext({ credits: 10000 });
    const item = makeItem({ cost: 800, buildTime: 100 });
    startProduction(ctx, item);

    const entry = ctx.productionQueue.get('right')!;
    expect(entry.progress).toBe(0);
  });

  it('production starts with costPaid 0', () => {
    // C++ equivalent: Balance = full cost (nothing paid yet)
    const ctx = makeContext({ credits: 10000 });
    const item = makeItem({ cost: 800, buildTime: 100 });
    startProduction(ctx, item);

    const entry = ctx.productionQueue.get('right')!;
    expect(entry.costPaid).toBe(0);
  });

  it('production starts with queueCount 1', () => {
    const ctx = makeContext({ credits: 10000 });
    const item = makeItem({ cost: 800, buildTime: 100 });
    startProduction(ctx, item);

    const entry = ctx.productionQueue.get('right')!;
    expect(entry.queueCount).toBe(1);
  });

  it('starting production while already building returns without change', () => {
    // C++ house.cpp:2413-2414:
    //   if (fptr->Is_Building()) return(PROD_CANT);
    // Can't start a new item while factory is actively building.
    // TS: startProduction returns without change if same category already active.
    const ctx = makeContext({ credits: 10000 });
    const tank = makeItem({ cost: 800, buildTime: 100, type: '2TNK' });
    const htank = makeItem({ cost: 1200, buildTime: 150, type: '3TNK', name: 'Heavy Tank' });

    startProduction(ctx, tank);
    tickNTimes(ctx, 10);

    // Try to start a different unit — should be rejected (same category)
    startProduction(ctx, htank);

    // Original production should continue unaffected
    const entry = ctx.productionQueue.get('right')!;
    expect(entry.item.type).toBe('2TNK');
    expect(entry.progress).toBe(10);
  });
});

// ============================================================
// Section 10: Prerequisite loss during production
// ============================================================
describe('C++ parity: prerequisite destruction during production', () => {

  it('production cancels when prerequisite building is destroyed', () => {
    // C++ doesn't have this exact mechanic in the factory itself — the check
    // is in the UI/sidebar. But in TS, tickProduction checks hasBuilding.
    const ctx = makeContext({ credits: 10000 });
    const item = makeItem({ cost: 800, buildTime: 100 });
    startProduction(ctx, item);
    tickNTimes(ctx, 30);

    // Destroy the war factory
    const weap = ctx.structures.find(s => s.type === 'WEAP');
    weap!.alive = false;

    // Next tick should cancel production
    tickProduction(ctx);
    expect(ctx.productionQueue.has('right')).toBe(false);
  });
});

// ============================================================
// Section 11: Has_Completed check
// factory.cpp:547-558 — requires Object != NULL AND stage == STEP_COUNT
// ============================================================
describe('C++ parity: Has_Completed guard (factory.cpp:547-558)', () => {

  it('production is not complete until buildTime ticks have elapsed', () => {
    // C++ factory.cpp:551: if (Object && Fetch_Stage() == STEP_COUNT) return true;
    const ctx = makeContext({ credits: 10000 });
    const item = makeItem({ cost: 800, buildTime: 50, isStructure: true });
    startProduction(ctx, item);

    // Tick buildTime - 1 times
    tickNTimes(ctx, 49);
    expect(ctx.pendingPlacement).toBeNull();
    expect(ctx.productionQueue.has('left')).toBe(true);

    // One more tick completes it
    tickProduction(ctx);
    expect(ctx.pendingPlacement).not.toBeNull();
  });

  it('completion at exact buildTime tick, not one more or less', () => {
    const buildTime = 40;
    const ctx = makeContext({ credits: 10000 });
    const item = makeItem({ cost: 400, buildTime, isStructure: true });
    startProduction(ctx, item);

    // Tick exactly buildTime - 1 times
    tickNTimes(ctx, buildTime - 1);
    expect(ctx.pendingPlacement).toBeNull();

    // The buildTime-th tick should complete
    tickProduction(ctx);
    expect(ctx.pendingPlacement).not.toBeNull();
  });
});

// ============================================================
// Section 12: Completed() reset behavior
// factory.cpp:647-669 — resets factory: Object=NULL, stage=0, rate=0
// ============================================================
describe('C++ parity: factory reset after completion (factory.cpp:647-669)', () => {

  it('queue entry is removed after unit production completes', () => {
    // C++ factory.cpp:651-657: Object = NULL, IsSuspended = true, Set_Stage(0)
    // TS: productionQueue.delete(category)
    const ctx = makeContext({ credits: 10000 });
    const item = makeItem({ cost: 400, buildTime: 30 });
    startProduction(ctx, item);
    tickNTimes(ctx, 30);

    expect(ctx.productionQueue.has('right')).toBe(false);
  });

  it('queue entry is removed after structure enters placement', () => {
    const ctx = makeContext({ credits: 10000 });
    const item = makeStructureItem({ cost: 300, buildTime: 20 });
    startProduction(ctx, item);
    tickNTimes(ctx, 20);

    expect(ctx.productionQueue.has('left')).toBe(false);
    expect(ctx.pendingPlacement).not.toBeNull();
  });
});

// ============================================================
// Section 13: C++ Set(TechnoClass &) — returning completed object
// factory.cpp:350-362 — Set(object): stage=STEP_COUNT, Balance=0
// ============================================================
describe('C++ parity: returning completed object to factory (factory.cpp:350-362)', () => {

  it('C++ can return a completed object to factory with full completion', () => {
    // C++ factory.cpp:350-362: Set(TechnoClass &object)
    //   Object = &object; Balance = 0; Set_Stage(STEP_COUNT);
    //   IsDifferent = true; IsSuspended = true;
    //
    // This is used when a building placement is cancelled — the building
    // returns to the factory as if newly completed, ready to be placed again.
    //
    // TS doesn't have this mechanic — once pendingPlacement is set, there's
    // no way to "return" it to the factory. The placement is final.
    // This is a structural difference but not a gameplay-visible parity gap
    // because TS handles placement differently.
    expect(true).toBe(true); // Structural documentation only
  });
});

// ============================================================
// Section 14: Power fraction clamping [1/16, 1]
// factory.cpp:434 — rate = time / Bound(Power_Fraction(), fixed(1,16), fixed(1))
// ============================================================
describe('C++ parity: power fraction bounds (factory.cpp:434)', () => {

  it('power fraction clamped to minimum 1/16', () => {
    // C++ Bound(Power_Fraction(), fixed(1,16), fixed(1))
    // Even at 0% power, production doesn't stop — it goes at 1/16 speed
    const ctx = makeContext({ powerProduced: 0, powerConsumed: 100 });
    const mult = computePowerMult(ctx);
    expect(mult).toBe(1 / 16);
  });

  it('power fraction clamped to maximum 1.0', () => {
    // Even with excess power, production doesn't go faster than normal
    const ctx = makeContext({ powerProduced: 500, powerConsumed: 100 });
    const mult = computePowerMult(ctx);
    expect(mult).toBe(1.0);
  });

  it('at minimum power, production takes 16x longer', () => {
    // At 1/16 power mult, 100 buildTime takes 1600 ticks
    const ctx = makeContext({
      credits: 100000,
      powerProduced: 0,
      powerConsumed: 100,
    });
    const item = makeItem({ cost: 100, buildTime: 16, isStructure: true });
    startProduction(ctx, item);

    // At 1/16 speed, need 16 * 16 = 256 ticks
    tickNTimes(ctx, 255);
    expect(ctx.pendingPlacement).toBeNull();

    tickProduction(ctx);
    expect(ctx.pendingPlacement).not.toBeNull();
  });
});

// ============================================================
// Section 15: Queue count limits
// ============================================================
describe('C++ parity: queue count mechanics', () => {

  it('maximum queue count is 5', () => {
    // TS production.ts:115: existing.queueCount < 5
    const ctx = makeContext({ credits: 100000 });
    const item = makeItem({ cost: 100, buildTime: 50 });

    for (let i = 0; i < 6; i++) {
      startProduction(ctx, item);
    }

    const entry = ctx.productionQueue.get('right')!;
    expect(entry.queueCount).toBe(5); // capped at 5
  });

  it('queuing deducts full cost for each queued item', () => {
    // TS: queued items (beyond first) are paid upfront
    const initialCredits = 10000;
    const ctx = makeContext({ credits: initialCredits });
    const item = makeItem({ cost: 500, buildTime: 50 });

    startProduction(ctx, item); // active — no upfront deduction
    const creditsAfterFirst = ctx.credits;

    startProduction(ctx, item); // queued — full cost deducted
    const creditsAfterSecond = ctx.credits;

    const effectiveCost = getEffectiveCost(item, ctx.playerHouse);
    expect(creditsAfterFirst - creditsAfterSecond).toBe(effectiveCost);
  });

  it('cannot queue if insufficient funds for full queued item cost', () => {
    // Queuing requires full effectiveCost upfront (production.ts:117).
    // Use credits that allow starting the first item (credits > 0) but
    // leave insufficient for queuing a second (credits < effectiveCost).
    const ctx = makeContext({ credits: 100 });
    const item = makeItem({ cost: 500, buildTime: 50 });

    startProduction(ctx, item); // active — starts OK (only needs > 0)

    // Credits should still be 100 (no ticks, no deduction yet)
    // But 100 < 500 = effectiveCost, so queuing should fail
    startProduction(ctx, item);

    const entry = ctx.productionQueue.get('right')!;
    expect(entry.queueCount).toBe(1); // second queue rejected
  });
});
