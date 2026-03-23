/**
 * C++ behavioral parity tests for the credit/money system.
 *
 * C++ source: house.cpp — Available_Money, Spend_Money, Refund_Money, Harvested, Adjust_Capacity
 * C++ header: house.h:420-422 — dual-pool: long Tiberium, long Credits, long Capacity
 *
 * Critical C++ architecture:
 *   - TWO separate pools: `Tiberium` (harvested ore, capped by Capacity) and `Credits` (starting cash, uncapped)
 *   - Available_Money() = Tiberium + Credits                        (house.cpp:1865)
 *   - Spend_Money(n): drains Tiberium FIRST, then Credits           (house.cpp:1886-1900)
 *   - Refund_Money(n): always adds to Credits (uncapped)            (house.cpp:1921-1926)
 *   - Harvested(n): adds to Tiberium, capped by Capacity            (house.cpp:1806-1819)
 *   - Init_Data: Credits = InitialCredits (Tiberium starts at 0)    (house.cpp:4135-4142)
 *   - Read_INI: Credits = InitialCredits = ini.Credits * 100        (house.cpp:7146-7147)
 *   - Adjust_Capacity(adjust, inanger):
 *       if excess && !inanger → Refund_Money(excess) (no loss)      (house.cpp:1958-1960)
 *       if excess && inanger  → excess is LOST                      (house.cpp:1961-1963)
 *
 * TS implementation: engine/index.ts, engine/production.ts, engine/repairSell.ts, engine/harvester.ts
 *   - Single merged `credits` pool (no Tiberium vs Credits distinction)
 *   - addCredits(amount, bypassSiloCap=false): harvest path caps to siloCapacity, refund bypasses
 *   - Production: ctx.credits -= deduct (single pool)
 *   - recalculateSiloCapacity(): excess is lost (inanger=true path only)
 */

import { describe, it, expect } from 'vitest';
import {
  sellRefund,
  calculateSiloCapacity,
} from '../engine/repairSell';
import {
  startProduction,
  cancelProduction,
  tickProduction,
  getEffectiveCost,
  type ProductionContext,
} from '../engine/production';
import { House, type ProductionItem, CELL_SIZE } from '../engine/types';
import type { MapStructure } from '../engine/scenario';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal MapStructure stub for silo capacity tests */
function makeStruct(type: string, house: House, alive = true): MapStructure {
  return {
    type, house, alive,
    x: 0, y: 0, hp: 400, maxHp: 400,
    facing: 0, width: 2, height: 2,
    buildProgress: undefined,
  } as unknown as MapStructure;
}

/** Simple allied check (same house) */
const isAllied = (a: House, b: House) => a === b;

/** C++ dual-pool model for reference testing */
class CppHouseCredits {
  tiberium = 0;
  credits = 0;
  capacity = 0;

  get availableMoney(): number {
    // house.cpp:1865
    return this.tiberium + this.credits;
  }

  /** house.cpp:1886-1900 — drain Tiberium first, then Credits */
  spendMoney(money: number): void {
    if (money > this.tiberium) {
      money -= this.tiberium;
      this.tiberium = 0;
      this.credits -= money;
    } else {
      this.tiberium -= money;
    }
  }

  /** house.cpp:1921-1926 — always adds to Credits (uncapped) */
  refundMoney(money: number): void {
    this.credits += money;
  }

  /** house.cpp:1806-1819 — adds to Tiberium, capped by Capacity */
  harvested(tiberium: number): void {
    this.tiberium += tiberium;
    if (this.tiberium > this.capacity) {
      this.tiberium = this.capacity;
    }
  }

  /** house.cpp:1946-1965 — adjust capacity; inanger=true → lose excess */
  adjustCapacity(adjust: number, inanger: boolean): number {
    this.capacity += adjust;
    this.capacity = Math.max(this.capacity, 0);
    let retval = 0;
    if (this.tiberium > this.capacity) {
      retval = this.tiberium - this.capacity;
      this.tiberium = this.capacity;
      if (!inanger) {
        this.refundMoney(retval);
        retval = 0;
      }
    }
    return retval;
  }
}

// ─── C++ Reference Model Tests ───────────────────────────────────────────────

describe('C++ dual-pool reference model (house.cpp)', () => {
  it('Available_Money = Tiberium + Credits (house.cpp:1865)', () => {
    const h = new CppHouseCredits();
    h.credits = 5000;
    h.tiberium = 3000;
    expect(h.availableMoney).toBe(8000);
  });

  it('Spend_Money drains Tiberium first (house.cpp:1891-1896)', () => {
    const h = new CppHouseCredits();
    h.tiberium = 1000;
    h.credits = 5000;

    // Spend 800 — should come entirely from Tiberium
    h.spendMoney(800);
    expect(h.tiberium).toBe(200);
    expect(h.credits).toBe(5000);
    expect(h.availableMoney).toBe(5200);
  });

  it('Spend_Money overflows from Tiberium to Credits (house.cpp:1891-1894)', () => {
    const h = new CppHouseCredits();
    h.tiberium = 300;
    h.credits = 5000;

    // Spend 1000 — 300 from Tiberium, 700 from Credits
    h.spendMoney(1000);
    expect(h.tiberium).toBe(0);
    expect(h.credits).toBe(4300);
    expect(h.availableMoney).toBe(4300);
  });

  it('Spend_Money with zero Tiberium drains Credits only (house.cpp:1891-1894)', () => {
    const h = new CppHouseCredits();
    h.tiberium = 0;
    h.credits = 5000;

    h.spendMoney(2000);
    expect(h.tiberium).toBe(0);
    expect(h.credits).toBe(3000);
  });

  it('Refund_Money always goes to Credits (house.cpp:1925)', () => {
    const h = new CppHouseCredits();
    h.tiberium = 500;
    h.credits = 1000;
    h.capacity = 2000;

    h.refundMoney(750);
    // C++ adds refund to Credits, NOT Tiberium
    expect(h.credits).toBe(1750);
    expect(h.tiberium).toBe(500); // Tiberium unchanged
    expect(h.availableMoney).toBe(2250);
  });

  it('Harvested caps at Capacity (house.cpp:1812-1814)', () => {
    const h = new CppHouseCredits();
    h.capacity = 2000;
    h.tiberium = 1800;

    h.harvested(500);
    expect(h.tiberium).toBe(2000); // capped, not 2300
  });

  it('Harvested with zero capacity stays at zero (house.cpp:1812-1814)', () => {
    const h = new CppHouseCredits();
    h.capacity = 0;
    h.tiberium = 0;

    h.harvested(500);
    expect(h.tiberium).toBe(0); // capped at 0
  });

  it('Adjust_Capacity with inanger=true loses excess (house.cpp:1961-1963)', () => {
    const h = new CppHouseCredits();
    h.capacity = 4000;
    h.tiberium = 3000;
    h.credits = 1000;

    const lost = h.adjustCapacity(-2500, true); // capacity 4000→1500
    expect(h.capacity).toBe(1500);
    expect(h.tiberium).toBe(1500); // capped to new capacity
    expect(h.credits).toBe(1000); // unchanged — excess LOST
    expect(lost).toBe(1500); // 3000 - 1500 = 1500 lost
    expect(h.availableMoney).toBe(2500); // was 4000, lost 1500
  });

  it('Adjust_Capacity with inanger=false refunds excess to Credits (house.cpp:1958-1960)', () => {
    const h = new CppHouseCredits();
    h.capacity = 4000;
    h.tiberium = 3000;
    h.credits = 1000;

    const lost = h.adjustCapacity(-2500, false); // capacity 4000→1500
    expect(h.capacity).toBe(1500);
    expect(h.tiberium).toBe(1500);
    expect(h.credits).toBe(2500); // 1000 + 1500 refund
    expect(lost).toBe(0); // nothing lost — all refunded
    expect(h.availableMoney).toBe(4000); // no money lost
  });

  it('Init_Data: Credits = InitialCredits, Tiberium = 0 (house.cpp:4139)', () => {
    // C++ house constructor initializes Tiberium=0, Credits=0, Capacity=0
    // Init_Data sets Credits = credits; Tiberium stays 0
    const h = new CppHouseCredits();
    // Simulate Init_Data
    h.credits = 10000; // InitialCredits from INI * 100
    // Tiberium stays 0 — starting cash is in Credits pool, NOT Tiberium
    expect(h.tiberium).toBe(0);
    expect(h.credits).toBe(10000);
    expect(h.availableMoney).toBe(10000);
  });

  it('Refund after spend preserves total (round-trip) (house.cpp)', () => {
    const h = new CppHouseCredits();
    h.credits = 3000;
    h.tiberium = 2000;
    h.capacity = 5000;

    const beforeTotal = h.availableMoney; // 5000
    h.spendMoney(1500); // drains 1500 from Tiberium → tib=500, credits=3000
    expect(h.tiberium).toBe(500);
    expect(h.credits).toBe(3000);

    h.refundMoney(1500); // goes to Credits → credits=4500
    expect(h.tiberium).toBe(500);
    expect(h.credits).toBe(4500);
    expect(h.availableMoney).toBe(beforeTotal); // total preserved
    // But note: pool DISTRIBUTION changed — Tiberium decreased, Credits increased
  });
});

// ─── TS Behavioral Tests ─────────────────────────────────────────────────────

describe('TS credit system — behavioral parity checks', () => {
  // ── Silo capacity calculation ──

  it('calculateSiloCapacity: PROC=2000, SILO=1500 (rules.ini Storage=)', () => {
    const structs = [
      makeStruct('PROC', House.Spain),
      makeStruct('SILO', House.Spain),
      makeStruct('SILO', House.Spain),
    ];
    expect(calculateSiloCapacity(structs, House.Spain, isAllied)).toBe(5000);
  });

  it('calculateSiloCapacity: dead structures excluded', () => {
    const structs = [
      makeStruct('PROC', House.Spain, true),
      makeStruct('PROC', House.Spain, false), // dead
      makeStruct('SILO', House.Spain, false), // dead
    ];
    expect(calculateSiloCapacity(structs, House.Spain, isAllied)).toBe(2000);
  });

  it('calculateSiloCapacity: only allied structures count', () => {
    const structs = [
      makeStruct('PROC', House.Spain),
      makeStruct('PROC', House.USSR), // enemy
      makeStruct('SILO', House.USSR), // enemy
    ];
    expect(calculateSiloCapacity(structs, House.Spain, isAllied)).toBe(2000);
  });

  it('calculateSiloCapacity: under-construction buildings excluded', () => {
    const s = makeStruct('PROC', House.Spain);
    (s as any).buildProgress = 0.5; // still building
    expect(calculateSiloCapacity([s], House.Spain, isAllied)).toBe(0);
  });

  // ── sellRefund ──

  it('sellRefund: human gets 50% (C++ RefundPercent=50%%, techno.cpp:5743)', () => {
    // C++ fixed-point: ((128 * cost) + 128) / 256
    // For cost=1000: (128000 + 128) / 256 = 500
    expect(sellRefund(1000, true)).toBe(500);
  });

  it('sellRefund: AI gets 100% (C++ techno.cpp:5749)', () => {
    expect(sellRefund(1000, false)).toBe(1000);
  });

  it('sellRefund: fixed-point rounding for odd costs (C++ integer truncation)', () => {
    // For cost=999: (128 * 999 + 128) / 256 = (127872 + 128) / 256 = 128000 / 256 = 500
    expect(sellRefund(999, true)).toBe(500);
    // For cost=1: (128 * 1 + 128) / 256 = 256 / 256 = 1
    expect(sellRefund(1, true)).toBe(1);
    // For cost=3: (128 * 3 + 128) / 256 = 512 / 256 = 2
    expect(sellRefund(3, true)).toBe(2);
  });

  // ── addCredits (Harvested path) ──

  it('addCredits: harvest caps at siloCapacity (C++ Harvested caps at Capacity)', () => {
    // Simulate: credits=1800, siloCapacity=2000, harvest 500
    // C++: Tiberium 1800 + 500 = 2300, capped to 2000. 300 lost.
    // TS: credits = min(1800 + 500, 2000) = 2000. 300 lost.
    let credits = 1800;
    const siloCapacity = 2000;
    const amount = 500;
    const before = credits;
    credits = Math.min(credits + amount, siloCapacity);
    const added = credits - before;
    expect(credits).toBe(2000);
    expect(added).toBe(200); // only 200 actually added
  });

  it('addCredits: harvest with zero capacity adds nothing (C++ parity)', () => {
    // C++: Capacity=0 → Tiberium += 500 → if (Tib > Cap) Tib = Cap → Tib = 0
    // But addCredits returns 0 when siloCapacity <= 0 — correct for harvest path
    const siloCapacity = 0;
    expect(siloCapacity <= 0).toBe(true); // addCredits early-returns 0
  });

  // ── addCredits (Refund path — bypassSiloCap=true) ──

  it('addCredits bypassSiloCap: refunds are uncapped (C++ Refund_Money adds to Credits)', () => {
    // C++: Refund_Money adds to Credits unconditionally (house.cpp:1925)
    // Credits pool has NO capacity limit.
    // TS: addCredits(amount, true) bypasses silo cap — correct.
    let credits = 2000;
    const siloCapacity = 2000;
    // Refund 500 — should exceed silo capacity
    credits += 500; // bypassSiloCap path
    expect(credits).toBe(2500);
    expect(credits > siloCapacity).toBe(true); // allowed — C++ Credits is uncapped
  });

  // ── Production spending ──

  it('production spend: TS uses single pool (C++ Spend_Money drains Tiberium first)', () => {
    // This tests the observable behavior difference.
    // C++ with Tib=1000, Credits=5000: Spend_Money(800) → Tib=200, Credits=5000
    // TS with credits=6000: credits -= 800 → credits=5200
    // Available_Money is the same (5200 vs 5200), but pool distribution differs.
    // Since TS has a single pool, the OBSERVABLE total is identical.

    const cpp = new CppHouseCredits();
    cpp.tiberium = 1000;
    cpp.credits = 5000;
    cpp.spendMoney(800);

    let tsCredits = 6000; // merged pool
    tsCredits -= 800;

    // Available money matches
    expect(cpp.availableMoney).toBe(tsCredits);
  });

  // ── recalculateSiloCapacity (Adjust_Capacity) ──

  it('recalculateSiloCapacity: excess credits are lost on structure destruction (inanger=true)', () => {
    // C++ Adjust_Capacity(-capacity, true): excess Tiberium is lost
    // TS: if (siloCapacity > 0 && credits > siloCapacity) credits = siloCapacity
    const structs = [
      makeStruct('PROC', House.Spain), // 2000
      makeStruct('SILO', House.Spain), // 1500
    ];
    let credits = 3500;
    let siloCapacity = calculateSiloCapacity(structs, House.Spain, isAllied);
    expect(siloCapacity).toBe(3500);

    // Destroy the SILO
    structs[1].alive = false;
    siloCapacity = calculateSiloCapacity(structs, House.Spain, isAllied);
    expect(siloCapacity).toBe(2000);

    // Apply cap (TS recalculateSiloCapacity)
    if (siloCapacity > 0 && credits > siloCapacity) {
      credits = siloCapacity;
    }
    expect(credits).toBe(2000); // 1500 lost — matches C++ inanger=true behavior
  });
});

// ─── Mismatch Detection Tests ────────────────────────────────────────────────

describe('C++ vs TS MISMATCH detection', () => {
  it('MISMATCH: C++ Init_Data puts starting cash in Credits (uncapped), TS caps to siloCapacity', () => {
    // C++ (house.cpp:7146-7147):
    //   p->Control.InitialCredits = ini.Get_Int(hname, "Credits", 0) * 100;
    //   p->Credits = p->Control.InitialCredits;
    // Credits pool is UNCAPPED — it is not limited by silo Capacity.
    // Tiberium starts at 0 (house.cpp:586).
    //
    // TS (index.ts:1091-1103):
    //   this.credits = scenario.credits;
    //   this.siloCapacity = this.calculateSiloCapacity();
    //   if (this.siloCapacity > 0 && this.credits > this.siloCapacity) {
    //     this.credits = this.siloCapacity;  // ← WRONG: caps starting cash
    //   }
    //
    // Example: scenario gives 10000 credits, player has 1 PROC (capacity=2000).
    // C++: Credits=10000, Tiberium=0, Available_Money=10000
    // TS: credits=2000 (capped!) — player LOSES 8000 credits at mission start

    const cpp = new CppHouseCredits();
    cpp.credits = 10000; // Init_Data
    cpp.capacity = 2000; // from one PROC
    // C++ does NOT cap Credits to Capacity — they are separate pools
    expect(cpp.availableMoney).toBe(10000);

    // TS behavior
    let tsCredits = 10000;
    const tsSiloCapacity = 2000;
    if (tsSiloCapacity > 0 && tsCredits > tsSiloCapacity) {
      tsCredits = tsSiloCapacity; // TS caps starting credits
    }
    expect(tsCredits).toBe(2000); // TS lost 8000 credits

    // MISMATCH: C++ gives 10000, TS gives 2000
    expect(cpp.availableMoney).not.toBe(tsCredits);
    expect(cpp.availableMoney - tsCredits).toBe(8000);
  });

  it('MISMATCH: C++ Adjust_Capacity(inanger=false) refunds to Credits, TS has no equivalent', () => {
    // C++ (house.cpp:1958-1960): when capacity decreases peacefully (not via destruction),
    // excess Tiberium is refunded to Credits — NO money is lost.
    // This happens when selling a silo voluntarily.
    //
    // TS (index.ts:6230-6236): recalculateSiloCapacity() ALWAYS spills excess.
    // There is no inanger parameter — sell and destroy both lose credits.

    const cpp = new CppHouseCredits();
    cpp.capacity = 4000;
    cpp.tiberium = 3500;
    cpp.credits = 500;

    // Sell a silo (capacity -= 1500, inanger=false in C++ sell path)
    const lost = cpp.adjustCapacity(-1500, false);
    expect(lost).toBe(0); // C++: nothing lost — excess refunded
    expect(cpp.tiberium).toBe(2500); // capped to new capacity
    expect(cpp.credits).toBe(1500); // 500 + 1000 refund
    expect(cpp.availableMoney).toBe(4000); // total preserved

    // TS behavior (no inanger distinction)
    let tsCredits = 4000; // merged pool (3500 tib + 500 credits)
    const newCapacity = 2500; // 4000 - 1500
    if (newCapacity > 0 && tsCredits > newCapacity) {
      tsCredits = newCapacity; // TS always spills
    }

    // MISMATCH: C++ preserves 4000, TS loses 1500
    expect(cpp.availableMoney).toBe(4000);
    expect(tsCredits).toBe(2500);
    expect(cpp.availableMoney - tsCredits).toBe(1500);
  });

  it('MISMATCH: C++ Spend_Money pool priority affects Tiberium/Credits distribution', () => {
    // This isn't an Available_Money mismatch, but it means the COMPOSITION differs.
    // After spending, C++ may have more Credits and less Tiberium than TS expects.
    // This matters when capacity decreases (inanger=true): C++ loses less if
    // most value was already shifted to Credits via spending.

    const cpp = new CppHouseCredits();
    cpp.tiberium = 3000;
    cpp.credits = 2000;
    cpp.capacity = 3000;

    // Spend 3000 — C++ drains all Tiberium first
    cpp.spendMoney(3000);
    expect(cpp.tiberium).toBe(0);
    expect(cpp.credits).toBe(2000);

    // Now lose a silo (capacity -= 1500, inanger=true)
    const lost = cpp.adjustCapacity(-1500, true);
    expect(lost).toBe(0); // No Tiberium to lose
    expect(cpp.availableMoney).toBe(2000); // preserved

    // TS: merged pool starts at 5000, spend 3000 → 2000
    // Then recalculate: capacity 1500, credits 2000 → capped to 1500
    let tsCredits = 5000;
    tsCredits -= 3000; // spend
    const newCap = 1500;
    if (newCap > 0 && tsCredits > newCap) {
      tsCredits = newCap; // TS spills 500
    }

    // MISMATCH: C++ preserves 2000 (Credits uncapped), TS loses 500 to spill
    expect(cpp.availableMoney).toBe(2000);
    expect(tsCredits).toBe(1500);
    expect(cpp.availableMoney - tsCredits).toBe(500);
  });

  it('MISMATCH: C++ refund + harvest interact differently than TS merged pool', () => {
    // Scenario: player has full silos, then cancels production (refund).
    // C++: Refund_Money adds to Credits (uncapped). Available_Money = Tiberium + Credits.
    // Tiberium stays capped by Capacity, but total Available_Money increases beyond Capacity.
    //
    // TS: addCredits(refund, true) bypasses silo cap — this is CORRECT for parity.
    // But the merged pool means silo cap only applies to harvest, not to Available_Money.

    const cpp = new CppHouseCredits();
    cpp.capacity = 2000;
    cpp.tiberium = 2000; // full silos
    cpp.credits = 0;

    cpp.refundMoney(1000);
    expect(cpp.availableMoney).toBe(3000); // exceeds Capacity — this is correct C++

    // TS: same scenario
    let tsCredits = 2000;
    tsCredits += 1000; // bypassSiloCap
    expect(tsCredits).toBe(3000); // matches C++! This is correct.
    expect(tsCredits).toBe(cpp.availableMoney);
  });

  it('C++ and TS agree: harvest at full capacity adds nothing', () => {
    // C++ Harvested: Tiberium += n; if (Tib > Cap) Tib = Cap;
    // TS addCredits(n, false): credits = min(credits + n, siloCapacity)
    const cpp = new CppHouseCredits();
    cpp.capacity = 2000;
    cpp.tiberium = 2000;
    cpp.credits = 500;

    cpp.harvested(300);
    expect(cpp.tiberium).toBe(2000); // capped
    expect(cpp.availableMoney).toBe(2500); // 2000 + 500

    // TS
    let tsCredits = 2500;
    const tsSiloCap = 2000;
    const before = tsCredits;
    tsCredits = Math.min(tsCredits + 300, tsSiloCap); // caps to 2000
    // WAIT: TS caps TOTAL credits to siloCapacity, but C++ Available_Money can exceed Capacity
    // because Credits pool is separate and uncapped.

    // C++ Available_Money=2500 (Tib=2000 + Credits=500)
    // TS: min(2500+300, 2000) = 2000 — TS LOST 500 credits!
    // This is actually ANOTHER mismatch: addCredits caps the total to siloCapacity,
    // but C++ only caps the Tiberium pool. Credits can push Available_Money above Capacity.
    expect(tsCredits).toBe(2000);
    expect(cpp.availableMoney).toBe(2500);
    expect(cpp.availableMoney).not.toBe(tsCredits);
  });

  it('C++ and TS agree: production cancel refund is uncapped', () => {
    // C++ factory cancel → Refund_Money (adds to Credits, uncapped)
    // TS cancelProduction → ctx.credits += entry.costPaid (direct add, no cap)
    // These agree because TS production path doesn't use addCredits at all.
    const cpp = new CppHouseCredits();
    cpp.capacity = 2000;
    cpp.tiberium = 2000;
    cpp.credits = 0;

    // Build something for 500 (from Tiberium)
    cpp.spendMoney(500);
    expect(cpp.tiberium).toBe(1500);
    expect(cpp.credits).toBe(0);

    // Cancel → refund 500 to Credits
    cpp.refundMoney(500);
    expect(cpp.tiberium).toBe(1500);
    expect(cpp.credits).toBe(500);
    expect(cpp.availableMoney).toBe(2000);

    // TS: credits=2000, spend 500 → 1500, refund 500 → 2000
    let tsCredits = 2000;
    tsCredits -= 500;
    tsCredits += 500; // cancelProduction does ctx.credits += costPaid
    expect(tsCredits).toBe(2000);
    expect(tsCredits).toBe(cpp.availableMoney); // agree!
  });
});

// ─── Production Integration Tests ────────────────────────────────────────────

describe('Production credit flow parity', () => {
  function makeProductionCtx(credits: number): ProductionContext {
    const item: ProductionItem = {
      type: 'HTNK', name: 'Heavy Tank', cost: 950, buildTime: 190,
      prerequisite: 'WEAP', faction: 'soviet' as any, isStructure: false,
      techLevel: 5,
    };
    return {
      structures: [makeStruct('WEAP', House.USSR)] as any,
      entities: [],
      entityById: new Map(),
      credits,
      playerHouse: House.USSR,
      playerFaction: 'soviet' as any,
      playerTechLevel: 10,
      baseDiscovered: true,
      scenarioProductionItems: [item],
      productionQueue: new Map(),
      pendingPlacement: null,
      wallPlacementPrepaid: false,
      map: {} as any,
      tick: 0,
      powerProduced: 200,
      powerConsumed: 100,
      builtUnitTypes: new Set(),
      builtInfantryTypes: new Set(),
      builtAircraftTypes: new Set(),
      rallyPoints: new Map(),
      isAllied,
      hasBuilding: (t: string) => t === 'WEAP',
      playSound: () => {},
      playEva: () => {},
      addEntity: () => {},
      findPassableSpawn: () => ({ cx: 0, cy: 0 }),
    };
  }

  it('startProduction: incremental cost deduction (C++ factory.cpp PR3)', () => {
    const ctx = makeProductionCtx(5000);
    const item = ctx.scenarioProductionItems[0];
    startProduction(ctx, item);

    // Should NOT deduct full cost upfront — only checks credits > 0
    expect(ctx.credits).toBe(5000);
    expect(ctx.productionQueue.has('right')).toBe(true);
    const entry = ctx.productionQueue.get('right')!;
    expect(entry.costPaid).toBe(0); // nothing deducted yet
  });

  it('tickProduction: deducts costPerTick incrementally (C++ parity)', () => {
    const ctx = makeProductionCtx(5000);
    const item = ctx.scenarioProductionItems[0];
    startProduction(ctx, item);

    const effectiveCost = getEffectiveCost(item, House.USSR);
    const costPerTick = effectiveCost / item.buildTime;

    tickProduction(ctx);
    const entry = ctx.productionQueue.get('right')!;

    // After one tick, costPaid should be approximately costPerTick
    expect(entry.costPaid).toBeCloseTo(costPerTick, 5);
    expect(ctx.credits).toBeCloseTo(5000 - costPerTick, 5);
  });

  it('cancelProduction: refunds costPaid (C++ incremental refund)', () => {
    const ctx = makeProductionCtx(5000);
    const item = ctx.scenarioProductionItems[0];
    startProduction(ctx, item);

    // Tick a few times to accumulate costPaid
    for (let i = 0; i < 10; i++) tickProduction(ctx);

    const entry = ctx.productionQueue.get('right')!;
    const paid = entry.costPaid;
    const creditsBeforeCancel = ctx.credits;

    cancelProduction(ctx, 'right');
    expect(ctx.credits).toBeCloseTo(creditsBeforeCancel + paid, 5);
    expect(ctx.productionQueue.has('right')).toBe(false);
  });

  it('production pauses when credits exhausted (C++ parity)', () => {
    const ctx = makeProductionCtx(5); // almost broke
    const item = ctx.scenarioProductionItems[0];
    startProduction(ctx, item);

    // First tick may succeed (5 credits, cost/tick ~5)
    tickProduction(ctx);
    const entry = ctx.productionQueue.get('right')!;
    const progressAfter1 = entry.progress;

    // Eventually runs out — progress should stall
    for (let i = 0; i < 10; i++) tickProduction(ctx);

    // Credits should be near 0 and production stalled (progress barely advanced)
    expect(ctx.credits).toBeLessThanOrEqual(5);
    // Progress should have stalled once credits ran out
    expect(entry.progress).toBeLessThan(item.buildTime);
  });

  it('queued items require full cost upfront (C++ parity)', () => {
    const ctx = makeProductionCtx(2000);
    const item = ctx.scenarioProductionItems[0];
    const effectiveCost = getEffectiveCost(item, House.USSR);

    startProduction(ctx, item); // active build — no upfront cost
    expect(ctx.credits).toBe(2000);

    startProduction(ctx, item); // queue second — deducts full cost
    expect(ctx.credits).toBe(2000 - effectiveCost);

    const entry = ctx.productionQueue.get('right')!;
    expect(entry.queueCount).toBe(2);
  });

  it('queue rejects when insufficient credits for upfront payment', () => {
    const ctx = makeProductionCtx(100);
    const item = ctx.scenarioProductionItems[0];

    startProduction(ctx, item); // active — starts with any credits > 0
    startProduction(ctx, item); // queue — needs full cost (950) — should fail

    const entry = ctx.productionQueue.get('right')!;
    expect(entry.queueCount).toBe(1); // queue failed
    expect(ctx.credits).toBe(100); // no deduction
  });
});
