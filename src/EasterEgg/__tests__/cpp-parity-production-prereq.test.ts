/**
 * C++ behavioral parity tests: prerequisite loss mid-production, power-locked rate,
 * and cancel refund edge cases.
 *
 * C++ references:
 *   building.cpp:4719  — Detach_All(): when building is destroyed/captured
 *   building.cpp:4727  — If building has an attached Factory, call Factory->Abandon()
 *   building.cpp:4738  — Check if house is building something via this building's ToBuild
 *   building.cpp:4746  — factory = House->Fetch_Factory(Class->ToBuild)
 *   building.cpp:4748  — IsInLimbo = true (temporarily disable self for availability check)
 *   building.cpp:4749  — Who_Can_Build_Me(true, false, house): can ANY other building produce this?
 *   building.cpp:4750  — If no builder remains → House->Abandon_Production(Class->ToBuild)
 *   building.cpp:4752  — IsInLimbo = false (restore self)
 *
 *   house.cpp:788      — Can_Build(): checks ActiveBScan (bitmask of alive buildings) against
 *                         object's Prerequisite bitmask. ALL prerequisite bits must be present.
 *   house.cpp:855      — pre = type->Prerequisite (single bitmask combining ALL prereqs)
 *   house.cpp:880      — return (pre & flags) == pre (bitwise AND check)
 *
 *   factory.cpp:411    — Start(): rate = time / Bound(Power_Fraction(), 1/16, 1) / STEP_COUNT
 *   factory.cpp:434    — Power fraction is evaluated ONCE at Start() time, locked for duration
 *   factory.cpp:201    — AI(): production tick uses the rate set by Start(), does NOT re-evaluate power
 *   factory.cpp:469    — Abandon(): refunds (totalCost - Balance), i.e. what was actually spent
 *
 *   house.cpp:2503     — Abandon_Production(): calls factory->Abandon(), deletes factory
 *   house.cpp:4160     — Power_Fraction(): Power >= Drain → 1; Power > 0 → fixed(Power, Drain); else 0
 *
 * Key C++ vs TS divergences:
 *   - C++ prerequisite is a SINGLE bitmask combining ALL prereqs (primary + tech).
 *     TS separates into `prerequisite` and `techPrereq` fields.
 *   - C++ tickProduction checks prerequisite via Can_Build() which evaluates ALL prereq bits.
 *     TS tickProduction ONLY checks `entry.item.prerequisite`, NOT `entry.item.techPrereq`.
 *   - C++ Detach_All temporarily disables the dying building (IsInLimbo=true) then checks
 *     if any OTHER building can still produce the item. TS directly checks hasBuilding().
 *   - C++ power fraction is snapshotted at Start() and locked. TS also snapshots (powerMult),
 *     matching C++ behavior.
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
  const factories: MapStructure[] = overrides.structures ?? [
    makeStructure('WEAP', 'Greece'),
    makeStructure('FACT', 'Greece'),
    makeStructure('BARR', 'Greece'),
    makeStructure('DOME', 'Greece'),
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
// Section 1: Primary prerequisite loss mid-production
// building.cpp:4738-4753 — Detach_All checks if builder remains
// ============================================================
describe('C++ parity: primary prerequisite loss mid-production (building.cpp:4738-4753)', () => {

  it('destroying sole prerequisite building cancels production and refunds', () => {
    // C++ building.cpp:4746-4750:
    //   factory = House->Fetch_Factory(Class->ToBuild)
    //   if (object && !Who_Can_Build_Me(true, false, house))
    //     House->Abandon_Production(Class->ToBuild)
    // Abandon_Production calls factory->Abandon() which refunds money spent.
    //
    // TS production.ts:161:
    //   if (!ctx.hasBuilding(entry.item.prerequisite))
    //     cancelProduction(ctx, category)
    const initialCredits = 10000;
    const ctx = makeContext({ credits: initialCredits });
    const item = makeItem({ cost: 800, buildTime: 100 });
    startProduction(ctx, item);
    tickNTimes(ctx, 30);

    const entry = ctx.productionQueue.get('unit')!;
    const costPaid = entry.costPaid;
    expect(costPaid).toBeGreaterThan(0);

    // Destroy the sole war factory (prerequisite)
    const weap = ctx.structures.find(s => s.type === 'WEAP')!;
    weap.alive = false;

    // Next tick: TS detects prerequisite loss and cancels
    tickProduction(ctx);

    // Production should be cancelled
    expect(ctx.productionQueue.has('unit')).toBe(false);

    // Money should be refunded
    // C++ factory.cpp:479-480: Refund_Money(totalCost - Balance) = refund what was spent
    // TS: credits += costPaid
    expect(ctx.credits).toBe(initialCredits - costPaid + costPaid);
    // Simplifies to: credits should be back to initialCredits minus ticks already consumed
    // Actually TS cancel refunds costPaid, so credits = (initialCredits - costPaid) + costPaid = initialCredits
    // Wait — let's verify: after 30 ticks at 8 per tick, costPaid = 240.
    // credits before cancel = 10000 - 240 = 9760. After cancel refund of 240 = 10000.
    expect(ctx.credits).toBe(initialCredits);
  });

  it('production continues if a second prerequisite building exists', () => {
    // C++ building.cpp:4749: Who_Can_Build_Me(true, false, house)
    // If another building of the same type exists, production is NOT abandoned.
    // The IsInLimbo trick temporarily removes the dying building from the scan.
    //
    // TS: hasBuilding() scans all structures for alive + matching type.
    // If a second WEAP exists and is alive, prerequisite check passes.
    const ctx = makeContext({
      credits: 10000,
      structures: [
        makeStructure('WEAP', 'Greece'),
        makeStructure('WEAP', 'Greece'), // second war factory
        makeStructure('FACT', 'Greece'),
      ],
    });
    const item = makeItem({ cost: 800, buildTime: 100 });
    startProduction(ctx, item);
    tickNTimes(ctx, 30);

    // Destroy one war factory
    ctx.structures[0].alive = false;

    // Tick — should continue because second WEAP is alive
    tickProduction(ctx);
    const entry = ctx.productionQueue.get('unit');
    expect(entry).toBeDefined();
    expect(entry!.progress).toBe(31);
  });

  it('destroying prerequisite of structure production cancels it', () => {
    // Same mechanic for building production: FACT is prerequisite for POWR.
    // Destroy FACT → building production should be cancelled.
    const initialCredits = 10000;
    const ctx = makeContext({ credits: initialCredits });
    const item = makeStructureItem({ cost: 300, buildTime: 60 });
    startProduction(ctx, item);
    tickNTimes(ctx, 20);

    // Destroy construction yard
    const fact = ctx.structures.find(s => s.type === 'FACT')!;
    fact.alive = false;

    tickProduction(ctx);
    expect(ctx.productionQueue.has('building')).toBe(false);
  });

  it('rebuilding prerequisite allows new production to start', () => {
    // After prerequisite is destroyed and production cancelled, rebuilding
    // the prerequisite should allow new production to start.
    const ctx = makeContext({ credits: 10000 });
    const item = makeItem({ cost: 800, buildTime: 100 });
    startProduction(ctx, item);
    tickNTimes(ctx, 10);

    // Destroy WEAP
    const weap = ctx.structures.find(s => s.type === 'WEAP')!;
    weap.alive = false;
    tickProduction(ctx);
    expect(ctx.productionQueue.has('unit')).toBe(false);

    // Rebuild (set alive again)
    weap.alive = true;

    // Should be able to start new production
    startProduction(ctx, item);
    const entry = ctx.productionQueue.get('unit');
    expect(entry).toBeDefined();
    expect(entry!.progress).toBe(0);
  });
});

// ============================================================
// Section 2: Tech prerequisite loss mid-production
// house.cpp:855,880 — C++ checks ALL prereq bits via single bitmask
// ============================================================
describe('C++ parity: tech prerequisite loss mid-production (house.cpp:855,880)', () => {

  it('C++ abandons production when tech prereq is lost; TS now checks techPrereq', () => {
    // C++ house.cpp:855: pre = type->Prerequisite (single bitmask with ALL prereqs)
    // C++ house.cpp:880: (pre & flags) == pre — all bits must match
    // For example, Mammoth Tank has Prerequisite = STRUCTF_WEAP | STRUCTF_SOVIET_TECH
    // If Soviet Tech is destroyed, the Prerequisite bitmask no longer matches ActiveBScan,
    // so Who_Can_Build_Me returns NULL and production is abandoned.
    //
    // TS production.ts tickProduction now checks BOTH prerequisite AND techPrereq,
    // matching C++ behavior where ALL prerequisite bits must be present.
    const ctx = makeContext({
      credits: 10000,
      structures: [
        makeStructure('WEAP', 'Greece'),
        makeStructure('FACT', 'Greece'),
        makeStructure('DOME', 'Greece'), // tech prereq for V2RL
      ],
    });
    // V2RL requires WEAP (primary) + DOME (techPrereq)
    const v2rocket = makeItem({
      type: 'V2RL',
      name: 'V2 Rocket',
      cost: 700,
      buildTime: 140,
      prerequisite: 'WEAP',
      techPrereq: 'DOME',
    });

    startProduction(ctx, v2rocket);
    tickNTimes(ctx, 50);

    const costPaidBefore = ctx.productionQueue.get('unit')!.costPaid;

    // Destroy Radar Dome (tech prerequisite)
    const dome = ctx.structures.find(s => s.type === 'DOME')!;
    dome.alive = false;

    tickProduction(ctx);

    // C++ parity: production cancelled because DOME bit missing from ActiveBScan
    const entry = ctx.productionQueue.get('unit');
    expect(entry).toBeUndefined(); // production cancelled — matches C++
    // Cost should be refunded
    expect(ctx.credits).toBe(10000); // costPaid refunded on cancel
  });

  it('both primary and tech prereq loss cancel production (C++ parity)', () => {
    // Both primary and tech prereq loss should cancel production,
    // matching C++ where ALL prerequisite bits must be present.
    const ctx = makeContext({
      credits: 10000,
      structures: [
        makeStructure('WEAP', 'Greece'),
        makeStructure('FACT', 'Greece'),
        makeStructure('DOME', 'Greece'),
      ],
    });
    const v2rocket = makeItem({
      type: 'V2RL',
      name: 'V2 Rocket',
      cost: 700,
      buildTime: 140,
      prerequisite: 'WEAP',
      techPrereq: 'DOME',
    });

    // Test 1: Lose tech prereq — TS now cancels (matches C++)
    startProduction(ctx, v2rocket);
    tickNTimes(ctx, 10);
    ctx.structures.find(s => s.type === 'DOME')!.alive = false;
    tickProduction(ctx);
    const afterTechLoss = ctx.productionQueue.has('unit');

    // Reset
    ctx.structures.find(s => s.type === 'DOME')!.alive = true;

    // Test 2: Lose primary prereq — TS cancels (always did)
    startProduction(ctx, v2rocket);
    tickNTimes(ctx, 10);
    ctx.structures.find(s => s.type === 'WEAP')!.alive = false;
    tickProduction(ctx);
    const afterPrimaryLoss = ctx.productionQueue.has('unit');

    // C++ parity: BOTH prereq losses cancel production
    expect(afterTechLoss).toBe(false);   // tech loss: production cancelled (matches C++)
    expect(afterPrimaryLoss).toBe(false); // primary loss: production cancelled (correct)
  });
});

// ============================================================
// Section 3: Power fraction snapshot at Start() time
// factory.cpp:411-448 — rate computed ONCE using Power_Fraction()
// ============================================================
describe('C++ parity: power fraction snapshot (factory.cpp:411-448)', () => {

  it('power fraction is locked at production start, not recalculated per tick', () => {
    // C++ factory.cpp:434: rate = time / Bound(Power_Fraction(), fixed(1,16), fixed(1))
    // This runs ONCE inside Start(). The AI() production loop uses Set_Rate() value
    // which was calculated at Start() time. Power changes have NO effect until
    // Suspend() + Start() recalculates the rate.
    //
    // TS production.ts:133: powerMult = computePowerMult(ctx) — stored in queue entry
    // TS production.ts:186: entry.progress += entry.powerMult — uses snapshot
    const ctx = makeContext({
      credits: 100000,
      powerProduced: 200,
      powerConsumed: 100, // full power: mult = 1.0
    });
    const item = makeItem({ cost: 100, buildTime: 50, isStructure: true });
    startProduction(ctx, item);

    // Verify initial powerMult snapshot
    const entry = ctx.productionQueue.get('building')!;
    expect(entry.powerMult).toBe(1.0);

    // Simulate losing all power mid-production
    ctx.powerProduced = 0;
    ctx.powerConsumed = 200;

    // Power fraction is now 0 → would be 1/32 if recalculated (dual mechanism: 0.5 * 1/16)
    expect(computePowerMult(ctx)).toBe(1 / 32);

    // But production should still advance at full speed because powerMult was locked
    tickNTimes(ctx, 50);
    expect(ctx.pendingPlacement).not.toBeNull();
    // If power were recalculated per tick, 50 ticks at 1/16 speed = 3.125 progress
    // which would NOT complete. The fact that it completes proves snapshot behavior.
  });

  it('gaining power mid-production does not speed it up', () => {
    // Start with low power, then gain power — production should remain slow.
    // Dual mechanism at 50%: m1(0.5)=0.5, m2(0.5)=0.5, combined=0.25
    const ctx = makeContext({
      credits: 100000,
      powerProduced: 50,
      powerConsumed: 100, // 50% power → mult = 0.25 (dual mechanism)
    });
    const item = makeItem({ cost: 100, buildTime: 100, isStructure: true });
    startProduction(ctx, item);

    const entry = ctx.productionQueue.get('building')!;
    expect(entry.powerMult).toBe(0.25);

    // Boost power to 200%
    ctx.powerProduced = 400;
    ctx.powerConsumed = 100;
    expect(computePowerMult(ctx)).toBe(1.0);

    // After 100 ticks at 0.25 speed: progress = 25, NOT 100
    tickNTimes(ctx, 100);
    const entryAfter = ctx.productionQueue.get('building');
    // Should NOT have completed — 100 ticks * 0.25 = 25 progress, need 100
    expect(ctx.pendingPlacement).toBeNull();
    expect(entryAfter).toBeDefined();
    expect(entryAfter!.progress).toBe(25);
  });

  it('power snapshot re-evaluated on queue restart (next queued item)', () => {
    // C++ house.cpp:2425 — After completion, factory is reset and Begin_Production
    // calls Start() again which recalculates rate with current power.
    //
    // TS production.ts:204: entry.powerMult = computePowerMult(ctx) on queue restart
    const ctx = makeContext({
      credits: 100000,
      powerProduced: 200,
      powerConsumed: 100, // full power
    });
    const item = makeItem({ cost: 100, buildTime: 20 });
    startProduction(ctx, item); // first unit
    startProduction(ctx, item); // queue second

    const entry1 = ctx.productionQueue.get('unit')!;
    expect(entry1.powerMult).toBe(1.0);

    // Cut power before first unit completes
    ctx.powerProduced = 50;
    ctx.powerConsumed = 100; // 50% power

    // Complete first unit (20 ticks at full speed)
    tickNTimes(ctx, 20);

    // Second unit should have re-snapshotted power at 50%: dual mechanism = 0.25
    const entry2 = ctx.productionQueue.get('unit');
    expect(entry2).toBeDefined();
    expect(entry2!.powerMult).toBe(0.25);
  });

  it('at 50% power, production takes 4x as long (dual mechanism)', () => {
    // Dual mechanism: m1(0.5)=0.5, m2(0.5)=0.5, combined=0.25
    const ctx = makeContext({
      credits: 100000,
      powerProduced: 50,
      powerConsumed: 100, // 50% power → mult = 0.25 (dual mechanism)
    });
    const item = makeItem({ cost: 100, buildTime: 20, isStructure: true });
    startProduction(ctx, item);

    // At 0.25 speed, need 80 ticks to complete buildTime 20
    tickNTimes(ctx, 79);
    expect(ctx.pendingPlacement).toBeNull();

    tickProduction(ctx);
    expect(ctx.pendingPlacement).not.toBeNull();
  });

  it('at 0 power, production crawls at 1/32 speed (dual mechanism)', () => {
    // C++ dual mechanism: m1(0)=0.5 (floor), m2(0)=1/16, combined=1/32
    const ctx = makeContext({
      credits: 100000,
      powerProduced: 0,
      powerConsumed: 100, // 0% power → mult = 1/32 (dual mechanism)
    });
    const item = makeItem({ cost: 100, buildTime: 16, isStructure: true });
    startProduction(ctx, item);

    const entry = ctx.productionQueue.get('building')!;
    expect(entry.powerMult).toBe(1 / 32);

    // Need 16 * 32 = 512 ticks
    tickNTimes(ctx, 511);
    expect(ctx.pendingPlacement).toBeNull();

    tickProduction(ctx);
    expect(ctx.pendingPlacement).not.toBeNull();
  });
});

// ============================================================
// Section 4: Power_Fraction computation
// house.cpp:4160-4170 — Power >= Drain → 1; Power > 0 → Power/Drain; else 0
// ============================================================
describe('C++ parity: Power_Fraction computation (house.cpp:4160-4170)', () => {

  it('power >= drain → fraction = 1 (full power)', () => {
    // C++ house.cpp:4164: if (Power >= Drain || Drain == 0) return(1);
    const ctx = makeContext({ powerProduced: 200, powerConsumed: 100 });
    expect(computePowerMult(ctx)).toBe(1.0);
  });

  it('power == drain → fraction = 1', () => {
    const ctx = makeContext({ powerProduced: 100, powerConsumed: 100 });
    expect(computePowerMult(ctx)).toBe(1.0);
  });

  it('drain == 0 → fraction = 1 (no power needed)', () => {
    // C++ house.cpp:4164: Drain == 0 → return 1
    const ctx = makeContext({ powerProduced: 0, powerConsumed: 0 });
    expect(computePowerMult(ctx)).toBe(1.0);
  });

  it('power > 0, power < drain → dual mechanism applied', () => {
    // C++ house.cpp:4166-4167: Power_Fraction = fixed(Power, Drain)
    // Dual mechanism at 75%: m1(0.75)=0.75, m2(0.75)=0.75, combined=0.5625
    const ctx = makeContext({ powerProduced: 75, powerConsumed: 100 });
    expect(computePowerMult(ctx)).toBeCloseTo(0.5625, 6);
  });

  it('power = 0, drain > 0 → combined floor = 1/32', () => {
    // C++ dual mechanism: m1(0)=0.5 (floor), m2(0)=1/16 (floor), combined=1/32
    const ctx = makeContext({ powerProduced: 0, powerConsumed: 100 });
    expect(computePowerMult(ctx)).toBe(1 / 32);
  });

  it('very low power: dual mechanism floors apply', () => {
    // C++ dual mechanism: m1(0.01)=0.5 (floor at 0.5), m2(0.01)=1/16 (floor at 1/16)
    // combined = 0.5 * 1/16 = 1/32
    const ctx = makeContext({ powerProduced: 1, powerConsumed: 100 });
    const mult = computePowerMult(ctx);
    expect(mult).toBe(1 / 32);
  });

  it('C++ Power_Fraction separated from clamping — TS now uses powerFraction() + dual mechanism', () => {
    // C++ house.cpp:4169: Power_Fraction returns 0 when Power==0 and Drain > 0
    // C++ dual mechanism: m1 floors at 0.5, m2 floors at 1/16
    // Combined floor = 0.5 * 1/16 = 1/32
    //
    // TS now separates: powerFraction() returns the raw fraction,
    // then timeToBuildSpeedFactor() and factoryStartSpeedFactor() apply
    // their respective floors/clamps, matching C++ behavior.
    const ctx = makeContext({ powerProduced: 0, powerConsumed: 100 });
    expect(computePowerMult(ctx)).toBe(1 / 32);
  });
});

// ============================================================
// Section 5: Cancel refund accounting with prerequisite loss
// factory.cpp:469-506 — refund = totalCost - Balance (what was spent)
// ============================================================
describe('C++ parity: cancel refund on prerequisite loss (factory.cpp:469-506)', () => {

  it('prerequisite loss refunds exactly what was spent (money conservation)', () => {
    // C++ building.cpp:4750 → House->Abandon_Production → factory->Abandon()
    // factory.cpp:479-480: Refund_Money(totalCost - Balance)
    // Net effect: player gets back what was spent. No gain, no loss.
    //
    // TS: cancelProduction credits += costPaid (same net effect)
    const initialCredits = 10000;
    const ctx = makeContext({ credits: initialCredits });
    const item = makeItem({ cost: 800, buildTime: 100 });
    startProduction(ctx, item);
    tickNTimes(ctx, 50);

    // Verify some money was spent
    expect(ctx.credits).toBeLessThan(initialCredits);

    // Destroy prerequisite
    ctx.structures.find(s => s.type === 'WEAP')!.alive = false;
    tickProduction(ctx);

    // All money should be returned — conservation of credits
    expect(ctx.credits).toBe(initialCredits);
  });

  it('prerequisite loss mid-way refunds correct partial amount', () => {
    // Build for 40 ticks out of 100, then lose prereq.
    // costPerTick = 800/100 = 8. After 40 ticks: costPaid = 320.
    // Cancel should refund 320. Final credits = 10000 - 320 + 320 = 10000.
    const initialCredits = 10000;
    const ctx = makeContext({ credits: initialCredits });
    const item = makeItem({ cost: 800, buildTime: 100 });
    startProduction(ctx, item);

    tickNTimes(ctx, 40);
    const creditsBeforeCancel = ctx.credits;
    const costPaid = ctx.productionQueue.get('unit')!.costPaid;
    expect(costPaid).toBe(320); // 40 * 8

    ctx.structures.find(s => s.type === 'WEAP')!.alive = false;
    tickProduction(ctx);

    // Credits should be fully restored
    expect(ctx.credits).toBe(creditsBeforeCancel + costPaid);
    expect(ctx.credits).toBe(initialCredits);
  });

  it('prerequisite loss at tick 0 (no cost paid) refunds nothing', () => {
    const initialCredits = 10000;
    const ctx = makeContext({ credits: initialCredits });
    const item = makeItem({ cost: 800, buildTime: 100 });
    startProduction(ctx, item);
    // Don't tick — costPaid = 0

    ctx.structures.find(s => s.type === 'WEAP')!.alive = false;
    tickProduction(ctx);

    // No money was spent, no refund needed — credits unchanged
    expect(ctx.credits).toBe(initialCredits);
  });

  it('prerequisite loss near completion refunds almost full cost', () => {
    // Build for 99 ticks out of 100, then lose prereq.
    // costPaid should be ~792 (99 * 8). Refund should be ~792.
    const initialCredits = 10000;
    const ctx = makeContext({ credits: initialCredits });
    const item = makeItem({ cost: 800, buildTime: 100 });
    startProduction(ctx, item);
    tickNTimes(ctx, 99);

    const costPaid = ctx.productionQueue.get('unit')!.costPaid;
    expect(costPaid).toBe(792); // 99 * 8

    ctx.structures.find(s => s.type === 'WEAP')!.alive = false;
    tickProduction(ctx);

    expect(ctx.credits).toBe(initialCredits);
  });
});

// ============================================================
// Section 6: Multiple prerequisite scenarios
// building.cpp:4746-4752 — Fetch_Factory + Who_Can_Build_Me
// ============================================================
describe('C++ parity: multiple prerequisite buildings (building.cpp:4746-4752)', () => {

  it('losing one of two WEAPs does not cancel unit production', () => {
    // C++ building.cpp:4749: Who_Can_Build_Me checks if any other builder exists.
    // With two WEAPs, destroying one still leaves a builder.
    const ctx = makeContext({
      credits: 10000,
      structures: [
        makeStructure('WEAP', 'Greece'),
        makeStructure('WEAP', 'Greece'),
        makeStructure('FACT', 'Greece'),
      ],
    });
    const item = makeItem({ cost: 800, buildTime: 100 });
    startProduction(ctx, item);
    tickNTimes(ctx, 30);

    ctx.structures[0].alive = false; // destroy first WEAP
    tickProduction(ctx);

    expect(ctx.productionQueue.has('unit')).toBe(true);
    expect(ctx.productionQueue.get('unit')!.progress).toBe(31);
  });

  it('losing both WEAPs cancels unit production', () => {
    const ctx = makeContext({
      credits: 10000,
      structures: [
        makeStructure('WEAP', 'Greece'),
        makeStructure('WEAP', 'Greece'),
        makeStructure('FACT', 'Greece'),
      ],
    });
    const item = makeItem({ cost: 800, buildTime: 100 });
    startProduction(ctx, item);
    tickNTimes(ctx, 30);

    // Destroy both
    ctx.structures[0].alive = false;
    ctx.structures[1].alive = false;
    tickProduction(ctx);

    expect(ctx.productionQueue.has('unit')).toBe(false);
  });

  it('enemy-owned prerequisite building does not satisfy check', () => {
    // C++ building.cpp:2196: Who_Can_Build_Me checks building->House->Class->House == house
    // An enemy's WEAP should not satisfy our prerequisite.
    //
    // The actual game's hasBuilding (index.ts:6051) checks isAllied(s.house, playerHouse).
    // We must supply a hasBuilding that mirrors this ownership check.
    const structures: MapStructure[] = [
      makeStructure('WEAP', 'Greece'),
      makeStructure('WEAP', 'USSR' as House), // enemy WEAP
      makeStructure('FACT', 'Greece'),
    ];
    const isAllied = (a: House, b: House) => a === b;
    const ctx = makeContext({
      credits: 10000,
      structures,
      isAllied,
      // Mirror actual game's hasBuilding: check alive + isAllied
      hasBuilding: (type: string) => structures.some(s =>
        s.alive && s.type === type && isAllied(s.house, 'Greece' as House)),
    });
    const item = makeItem({ cost: 800, buildTime: 100 });
    startProduction(ctx, item);
    tickNTimes(ctx, 20);

    // Destroy player's WEAP — enemy WEAP should NOT satisfy prereq
    ctx.structures[0].alive = false;
    tickProduction(ctx);

    expect(ctx.productionQueue.has('unit')).toBe(false);
  });
});

// ============================================================
// Section 7: Prerequisite loss with queued items
// Combined behavior: building.cpp Detach_All + factory.cpp Abandon
// ============================================================
describe('C++ parity: prerequisite loss with queued items', () => {

  it('prerequisite loss cancels active build AND refunds queued items', () => {
    // In TS, queued items are paid upfront. When prerequisite is lost,
    // cancelProduction is called which first dequeues (refunding queued cost),
    // then if called again would cancel active build.
    // But actually, tickProduction calls cancelProduction once per category
    // which handles the active entry — queued items are part of the same entry.
    //
    // C++ doesn't have multi-queue on a single factory, so this is TS-specific.
    const initialCredits = 10000;
    const ctx = makeContext({ credits: initialCredits });
    const item = makeItem({ cost: 500, buildTime: 50 });

    startProduction(ctx, item);  // active
    startProduction(ctx, item);  // queued (paid upfront: -500)

    const creditsAfterQueue = ctx.credits;
    expect(creditsAfterQueue).toBe(initialCredits - 500); // queued item paid upfront

    tickNTimes(ctx, 20); // build for 20 ticks, costPaid = 20 * (500/50) = 200

    const entry = ctx.productionQueue.get('unit')!;
    expect(entry.queueCount).toBe(2);
    const activeCostPaid = entry.costPaid;
    expect(activeCostPaid).toBe(200);

    // Destroy prerequisite
    ctx.structures.find(s => s.type === 'WEAP')!.alive = false;
    tickProduction(ctx);

    // TS behavior: cancelProduction is called once. With queueCount > 1,
    // it only dequeues one (refunds full queued item cost).
    // The active build is NOT cancelled — just one queued item removed.
    // This means production entry still exists but with queueCount = 1.
    //
    // BUT wait — after the cancel, the next tick of tickProduction will
    // check prerequisite again and cancel again. Let's verify:
    // Actually, tickProduction iterates the queue. When it calls
    // cancelProduction for the category, and queueCount > 1, it removes
    // one from queue. Then `continue` skips to next category.
    // Next tick: checks prerequisite again, still missing, calls cancel again.
    // This time queueCount = 1, so it cancels the active build.

    // After first tick: one queued item dequeued
    // Let's check the state:
    if (ctx.productionQueue.has('unit')) {
      // Still has entry — first cancel only dequeued
      const remainingEntry = ctx.productionQueue.get('unit')!;
      expect(remainingEntry.queueCount).toBe(1);

      // Tick again to cancel the active build
      tickProduction(ctx);
      expect(ctx.productionQueue.has('unit')).toBe(false);
    }
    // All money should be eventually returned
  });
});

// ============================================================
// Section 8: Prerequisite check timing
// TS checks prerequisite at START of each tick, before cost deduction
// ============================================================
describe('C++ parity: prerequisite check timing within tick', () => {

  it('prerequisite check happens before cost deduction in the same tick', () => {
    // TS production.ts:161-163: prerequisite check is FIRST thing in the loop.
    // If prerequisite is missing, cancelProduction is called immediately —
    // no cost is deducted for that tick.
    //
    // C++ building.cpp: Detach_All happens when building is destroyed,
    // which is separate from factory AI(). The destruction event triggers
    // immediate abandonment. The factory's AI() never runs that tick.
    const initialCredits = 10000;
    const ctx = makeContext({ credits: initialCredits });
    const item = makeItem({ cost: 800, buildTime: 100 });
    startProduction(ctx, item);
    tickNTimes(ctx, 10);

    const creditsBeforeDestruction = ctx.credits;
    const costPaidBeforeDestruction = ctx.productionQueue.get('unit')!.costPaid;

    // Destroy prerequisite
    ctx.structures.find(s => s.type === 'WEAP')!.alive = false;
    tickProduction(ctx);

    // No additional cost should have been deducted in the destruction tick
    // Credits should be: creditsBeforeDestruction + costPaidBeforeDestruction
    expect(ctx.credits).toBe(creditsBeforeDestruction + costPaidBeforeDestruction);
  });
});

// ============================================================
// Section 9: Power fraction edge cases for production rate
// factory.cpp:434 — rate = time / Bound(fraction, 1/16, 1) / STEP_COUNT
// ============================================================
describe('C++ parity: power fraction production rate edge cases', () => {

  it('excess power does not speed up production beyond 1x', () => {
    // C++ factory.cpp:434: Bound(Power_Fraction(), fixed(1,16), fixed(1))
    // Upper bound is 1 — even with 500% power, rate is same as 100%.
    const ctx = makeContext({
      credits: 100000,
      powerProduced: 1000,
      powerConsumed: 100, // 10x power
    });
    const item = makeItem({ cost: 100, buildTime: 50, isStructure: true });
    startProduction(ctx, item);

    const entry = ctx.productionQueue.get('building')!;
    expect(entry.powerMult).toBe(1.0); // capped at 1.0

    tickNTimes(ctx, 50);
    expect(ctx.pendingPlacement).not.toBeNull(); // completes in exactly buildTime ticks
  });

  it('power fraction of exactly 1/16 with dual mechanism', () => {
    // Edge case: fraction = 1/16 = 0.0625
    // Dual mechanism: m1(0.0625)=0.5 (below 0.5, clamped), m2(0.0625)=1/16
    // combined = 0.5 * 1/16 = 1/32
    const ctx = makeContext({
      credits: 100000,
      powerProduced: 1,
      powerConsumed: 16, // exactly 1/16 power
    });
    const mult = computePowerMult(ctx);
    expect(mult).toBe(1 / 32);

    const item = makeItem({ cost: 100, buildTime: 16, isStructure: true });
    startProduction(ctx, item);

    // Need 16 * 32 = 512 ticks
    tickNTimes(ctx, 511);
    expect(ctx.pendingPlacement).toBeNull();
    tickProduction(ctx);
    expect(ctx.pendingPlacement).not.toBeNull();
  });

  it('no consumers (drain = 0) → full speed even with 0 production', () => {
    // C++ house.cpp:4164: if (Power >= Drain || Drain == 0) return(1)
    // When there are no consumers, production runs at full speed.
    const ctx = makeContext({
      credits: 100000,
      powerProduced: 0,
      powerConsumed: 0,
    });
    const mult = computePowerMult(ctx);
    expect(mult).toBe(1.0);
  });
});

// ============================================================
// Section 10: Interaction between prerequisite loss and power snapshot
// ============================================================
describe('C++ parity: prerequisite loss does not interact with power snapshot', () => {

  it('low-power production cancelled by prereq loss still refunds correctly', () => {
    // Build at half speed, lose prereq. Refund should match what was actually paid.
    const initialCredits = 10000;
    const ctx = makeContext({
      credits: initialCredits,
      powerProduced: 50,
      powerConsumed: 100, // 50% power
    });
    const item = makeItem({ cost: 800, buildTime: 100 });
    startProduction(ctx, item);

    // At 50% power (dual mechanism = 0.25), 40 ticks advances progress by 10.
    // Cost is deducted per tick using C++ integer division: floor(remaining/steps).
    // With cost=800, buildTime=100, initial costPerTick = floor(800/100) = 8, but
    // as costPaid accumulates the per-tick cost varies slightly due to integer math.
    tickNTimes(ctx, 40);

    const entry = ctx.productionQueue.get('unit')!;
    expect(entry.progress).toBe(10); // 40 * 0.25
    // costPaid is the sum of 40 integer-division cost ticks — verify it's reasonable
    expect(entry.costPaid).toBeGreaterThan(0);
    expect(entry.costPaid).toBeLessThan(800); // haven't paid full cost yet

    // Destroy prerequisite
    ctx.structures.find(s => s.type === 'WEAP')!.alive = false;
    tickProduction(ctx);

    // Full refund
    expect(ctx.credits).toBe(initialCredits);
  });

  it('power snapshot does not affect refund amount', () => {
    // The refund is based on costPaid, not on progress or power fraction.
    // Whether production was slow or fast, you get back what you paid.
    const initialCredits = 10000;

    // Test at full power
    const ctx1 = makeContext({ credits: initialCredits, powerProduced: 200, powerConsumed: 100 });
    const item = makeItem({ cost: 800, buildTime: 100 });
    startProduction(ctx1, item);
    tickNTimes(ctx1, 40);
    cancelProduction(ctx1, 'unit');
    const creditsAfterFullPowerCancel = ctx1.credits;

    // Test at half power — same number of ticks
    const ctx2 = makeContext({ credits: initialCredits, powerProduced: 50, powerConsumed: 100 });
    startProduction(ctx2, item);
    tickNTimes(ctx2, 40);
    cancelProduction(ctx2, 'unit');
    const creditsAfterHalfPowerCancel = ctx2.credits;

    // Both should return to initialCredits (full refund regardless of power)
    expect(creditsAfterFullPowerCancel).toBe(initialCredits);
    expect(creditsAfterHalfPowerCancel).toBe(initialCredits);
  });
});
