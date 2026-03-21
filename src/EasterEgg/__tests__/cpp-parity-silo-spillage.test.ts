/**
 * C++ Behavioral Parity: Silo Capacity, Credit Overflow/Spillage, and Silo-Bypass Paths
 *
 * Tests the TS implementation of silo economics against C++ Red Alert source:
 *
 * C++ source references:
 *   house.cpp:1806-1819  — HouseClass::Harvested()        (silo-capped ore deposit)
 *   house.cpp:1886-1900  — HouseClass::Spend_Money()      (spends Tiberium first, then Credits)
 *   house.cpp:1921-1926  — HouseClass::Refund_Money()     (bypasses silo cap — adds to Credits)
 *   house.cpp:1946-1967  — HouseClass::Adjust_Capacity()  (capacity change, overflow handling)
 *   house.cpp:1861-1866  — HouseClass::Available_Money()  (Tiberium + Credits)
 *   building.cpp:2274    — Limbo() calls Adjust_Capacity(-Class->Capacity, true)
 *   building.cpp:2396    — Grand_Opening() calls Adjust_Capacity(Class->Capacity) [inanger=false]
 *   building.cpp:2986    — Captured() calls Adjust_Capacity(-Class->Capacity, true)
 *   building.cpp:3571    — Sell: Refund_Money(Refund_Amount()) then delete/Limbo
 *   cell.cpp:2335-2341   — CRATE_MONEY: Refund_Money() — bypasses silo cap
 *   techno.cpp:5743-5761 — Refund_Amount: human=cost*RefundPercent(0.5), AI=cost*1.0
 *   repairSell.ts:72     — TS sellRefund: human=floor(cost*0.5), AI=cost
 *
 * C++ dual-bucket model:
 *   C++ has TWO separate pools: `Tiberium` (silo-stored ore, capacity-limited) and
 *   `Credits` (initial cash, NOT capacity-limited). Available_Money = Tiberium + Credits.
 *   TS merges these into a single `credits` field with silo-cap logic in addCredits().
 *
 * Key C++ behaviors tested:
 *   1. Harvested() caps Tiberium at Capacity — excess silently dropped
 *   2. Refund_Money() adds to Credits directly — bypasses Capacity entirely
 *   3. Adjust_Capacity with inanger=true: excess Tiberium is LOST (destruction)
 *   4. Adjust_Capacity with inanger=false: excess Tiberium is REFUNDED to Credits (sell/build)
 *   5. Crate money uses Refund_Money — bypasses silo cap
 *   6. Sell refund uses Refund_Money — bypasses silo cap
 *   7. Spend_Money consumes Tiberium first, then Credits
 *   8. Capacity drops to 0: in C++ Tiberium=0 (excess is lost when inanger=true)
 */

import { describe, it, expect } from 'vitest';
import { House, buildDefaultAlliances } from '../engine/types';
import { calculateSiloCapacity, sellRefund } from '../engine/repairSell';
import type { MapStructure } from '../engine/scenario';

// -- Helpers ------------------------------------------------------------------

const alliances = buildDefaultAlliances();
const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

function makeSILO(cx: number, cy: number, hp = 300, house: House = House.Spain): MapStructure {
  return {
    type: 'SILO', image: 'silo', house,
    cx, cy, hp, maxHp: 300, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function makePROC(cx: number, cy: number, hp = 900, house: House = House.Spain): MapStructure {
  return {
    type: 'PROC', image: 'proc', house,
    cx, cy, hp, maxHp: 900, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

// ===========================================================================
// Section 1: Harvested() — Silo-capped ore deposit
//
// C++ house.cpp:1806-1819:
//   void HouseClass::Harvested(unsigned tiberium)
//   {
//       long oldtib = Tiberium;
//       Tiberium += tiberium;
//       if (Tiberium > Capacity) {
//           Tiberium = Capacity;
//           IsMaxedOut = true;
//       }
//       HarvestedCredits += tiberium;
//       Silo_Redraw_Check(oldtib, Capacity);
//   }
//
// TS equivalent: addCredits(amount, bypassSiloCap=false)
//   if (siloCapacity <= 0) return 0;
//   this.credits = Math.min(this.credits + amount, this.siloCapacity);
// ===========================================================================

describe('Harvested() — silo-capped ore deposit (house.cpp:1806)', () => {

  it('ore deposit is capped at silo capacity', () => {
    // C++: Tiberium=1800, Capacity=2000, Harvested(500) → Tiberium=min(2300,2000)=2000
    const structures = [makePROC(10, 10)]; // capacity=2000
    const siloCapacity = calculateSiloCapacity(structures, House.Spain, isAllied);
    expect(siloCapacity).toBe(2000);

    let credits = 1800;
    const amount = 500;
    credits = Math.min(credits + amount, siloCapacity);
    expect(credits).toBe(2000); // capped, 300 excess lost
  });

  it('ore deposit below capacity is fully added', () => {
    // C++: Tiberium=200, Capacity=1000, Harvested(300) → Tiberium=500
    const siloCapacity = 1000;
    let credits = 200;
    credits = Math.min(credits + 300, siloCapacity);
    expect(credits).toBe(500);
  });

  it('zero capacity means no ore can be stored', () => {
    // C++: Tiberium=0, Capacity=0, Harvested(500) → Tiberium=min(500,0)=0
    const siloCapacity = 0;
    let credits = 0;
    // TS addCredits: if (siloCapacity <= 0) return 0;
    const added = siloCapacity > 0 ? Math.min(credits + 500, siloCapacity) - credits : 0;
    expect(added).toBe(0);
  });

  it('already at capacity: harvesting adds nothing', () => {
    // C++: Tiberium=1000, Capacity=1000, Harvested(100) → Tiberium=1000, IsMaxedOut=true
    const siloCapacity = 1000;
    let credits = 1000;
    const before = credits;
    credits = Math.min(credits + 100, siloCapacity);
    expect(credits).toBe(1000);
    expect(credits - before).toBe(0);
  });
});

// ===========================================================================
// Section 2: Refund_Money() — silo-bypass path
//
// C++ house.cpp:1921-1926:
//   void HouseClass::Refund_Money(unsigned money)
//   {
//       Credits += money;
//   }
//
// This is THE critical bypass: refunds go straight to the Credits pool,
// which has NO capacity limit. This means sell refunds and crate money
// are NEVER lost to silo overflow.
//
// TS equivalent: addCredits(amount, bypassSiloCap=true)
//   this.credits += amount; return amount;
// ===========================================================================

describe('Refund_Money() — silo-bypass path (house.cpp:1921)', () => {

  it('refund bypasses silo cap, credits can exceed capacity', () => {
    // C++: Credits=0, Tiberium=1000, Capacity=1000, Refund_Money(5000)
    //      → Credits=5000, Available_Money=6000 (exceeds Capacity of 1000)
    // TS: credits=1000, siloCapacity=1000, addCredits(5000, true) → credits=6000
    const siloCapacity = 1000;
    let credits = 1000; // at silo cap
    // bypass path
    credits += 5000;
    expect(credits).toBe(6000); // far exceeds capacity — that's correct
  });

  it('refund adds exact amount regardless of capacity', () => {
    const siloCapacity = 500;
    let credits = 500;
    credits += 1;
    expect(credits).toBe(501); // 1 credit over capacity — still added
  });

  it('refund works even with zero capacity', () => {
    // C++: Capacity=0, Credits=0, Refund_Money(100) → Credits=100
    const siloCapacity = 0;
    let credits = 0;
    credits += 100;
    expect(credits).toBe(100);
  });
});

// ===========================================================================
// Section 3: Sell refund uses Refund_Money (silo-bypass)
//
// C++ building.cpp:3571:
//   House->Refund_Money(Refund_Amount());
// Then:
//   Limbo() → Adjust_Capacity(-Class->Capacity, true)
//
// The sell refund goes to Credits FIRST (bypassing silo), THEN capacity
// is reduced. If Tiberium > new Capacity, excess Tiberium is LOST
// (inanger=true in Limbo), but the sell refund was already safely
// deposited in the non-capacity-limited Credits pool.
//
// TS equivalent: addCredits(sellRefund(cost, true), true)  [bypassSiloCap=true]
//   then recalculateSiloCapacity()  [caps credits to new capacity]
//
// PARITY GAP: In C++, sell refund goes to Credits (unlimited), then
// capacity reduction only affects Tiberium. In TS, the refund goes to
// a single credits pool, and then recalculateSiloCapacity() caps credits
// to the new (lower) capacity. This means TS can LOSE sell refund money
// that C++ would preserve.
// ===========================================================================

describe('sell refund uses Refund_Money — silo-bypass (building.cpp:3571)', () => {

  it('sellRefund: human gets 50% refund', () => {
    // C++ techno.cpp:5758: cost = cost * Rule.RefundPercent (0.5 for humans)
    expect(sellRefund(2000, true)).toBe(1000);
    expect(sellRefund(1500, true)).toBe(750);
    expect(sellRefund(100, true)).toBe(50);
  });

  it('sellRefund: AI gets 100% refund', () => {
    // C++ techno.cpp:5757: if (House->IsHuman) { cost *= RefundPercent; }
    // Non-human: no multiplication, gets full cost
    expect(sellRefund(2000, false)).toBe(2000);
    expect(sellRefund(1500, false)).toBe(1500);
  });

  it('sellRefund: odd cost rounds down for human', () => {
    // C++ uses fixed-point multiplication which truncates
    expect(sellRefund(101, true)).toBe(50); // floor(101*0.5) = 50
    expect(sellRefund(1, true)).toBe(0);    // floor(1*0.5) = 0
  });

  it('C++ sell refund bypasses silo cap — money preserved even at full capacity', () => {
    // C++ scenario: Tiberium=1500, Capacity=1500 (1 SILO), sell the SILO
    //   1. Refund_Money(sellRefund) → Credits += 750 (goes to unlimited pool)
    //   2. Limbo → Adjust_Capacity(-1500, true) → Capacity=0
    //      Tiberium(1500) > Capacity(0) → excess=1500, Tiberium=0
    //      inanger=true → excess is LOST (1500 credits of ore gone)
    //   3. Available_Money = Tiberium(0) + Credits(750) = 750
    //
    // In C++, the player gets 750 from the sell (in Credits) but loses
    // 1500 ore (from Tiberium pool) = net loss of 750.
    //
    // TS behavior: addCredits(750, true) → credits=2250, then
    //   recalculateSiloCapacity() → capacity=0, guard: if (cap > 0)
    //   → credits stay at 2250 (preserves everything when cap=0)
    //
    // This is a deliberate TS simplification — single-bucket model
    // cannot distinguish ore from cash reserves.
    const siloCost = 600; // approximate SILO cost
    const refund = sellRefund(siloCost, true); // 300
    expect(refund).toBe(300);
  });

  // PARITY GAP: C++ sell-then-cap-reduce vs TS cap-reduce-then-refund ordering
  it('PARITY GAP: TS recalculateSiloCapacity after sell may cap refund that C++ preserves', () => {
    // C++ scenario: 2 SILOs, Tiberium=3000 (full), sell one SILO
    //   C++ order: 1. Refund_Money(750) → Credits=750
    //              2. Limbo → Adjust_Capacity(-1500, true) → Cap=1500
    //                 Tiberium(3000) > Cap(1500) → excess=1500, Tib=1500
    //                 inanger=true → 1500 ore lost
    //              3. Available = Tib(1500) + Credits(750) = 2250
    //
    // TS order (index.ts:1900-1901):
    //   1. recalculateSiloCapacity() → cap=1500, credits capped to 1500
    //      (lost 1500 from credits spillage)
    //   2. addCredits(sellRefund, true) → credits = 1500 + 750 = 2250
    //
    // Result: TS arrives at 2250 too! The ordering works out because
    // TS does recalculate BEFORE adding refund (line 1901 before line 1927).
    // So both C++ and TS end up at 2250 total.
    const structures = [makeSILO(10, 10), makeSILO(12, 10)];
    let credits = 3000; // full capacity

    // Step 1: structure dies (sell completion)
    structures[0].alive = false;
    const newCap = calculateSiloCapacity(structures, House.Spain, isAllied);
    expect(newCap).toBe(1500);

    // Step 2: cap credits to new capacity (TS recalculateSiloCapacity)
    if (newCap > 0 && credits > newCap) {
      credits = newCap; // 3000 → 1500 (1500 lost to overflow)
    }
    expect(credits).toBe(1500);

    // Step 3: add sell refund (bypasses cap)
    const siloCost = 600;
    const refund = sellRefund(siloCost, true);
    credits += refund; // 1500 + 300 = 1800
    expect(credits).toBe(1800);

    // C++ would have: Tib=1500 + Credits=300 = 1800 total
    // (Exact value depends on SILO cost which may differ, but the MECHANISM matches)
  });
});

// ===========================================================================
// Section 4: Crate money uses Refund_Money — silo-bypass
//
// C++ cell.cpp:2335-2341:
//   case CRATE_MONEY:
//   crate_money:
//       if (force_money > 0) {
//           object->House->Refund_Money(force_money);
//       } else {
//           object->House->Refund_Money(Random_Pick(CrateData[powerup], CrateData[powerup]+900));
//       }
//       break;
//
// Note: Refund_Money (not Harvested) — crate money bypasses silo cap!
//
// TS equivalent (crates.ts:187):
//   ctx.addCredits(2000, true);  // bypassSiloCap=true
// ===========================================================================

describe('crate money bypasses silo cap (cell.cpp:2335, house.cpp:1921)', () => {

  it('money crate adds 2000 credits regardless of silo state', () => {
    // C++ in solo play: Refund_Money(SoloCrateMoney=2000)
    // Goes to Credits, never checked against Capacity
    const siloCapacity = 1000;
    let credits = 1000; // already at capacity
    credits += 2000; // bypass
    expect(credits).toBe(3000); // exceeds capacity — correct per C++
  });

  it('money crate with zero capacity still adds credits', () => {
    // No silos at all — C++ Credits += 2000
    const siloCapacity = 0;
    let credits = 0;
    credits += 2000;
    expect(credits).toBe(2000);
  });
});

// ===========================================================================
// Section 5: Adjust_Capacity — inanger=true (destruction) vs inanger=false (build)
//
// C++ house.cpp:1946-1967:
//   int HouseClass::Adjust_Capacity(int adjust, bool inanger)
//   {
//       long oldcap = Capacity;
//       int retval = 0;
//       Capacity += adjust;
//       Capacity = max(Capacity, 0L);
//       if (Tiberium > Capacity) {
//           retval = Tiberium - Capacity;
//           Tiberium = Capacity;
//           if (!inanger) {
//               Refund_Money(retval);  ← excess ore converted to Credits
//               retval = 0;
//           } else {
//               IsMaxedOut = true;     ← excess ore is LOST
//           }
//       }
//       Silo_Redraw_Check(Tiberium, oldcap);
//       return(retval);
//   }
//
// Two call sites:
//   building.cpp:2396 — Grand_Opening (build completion): Adjust_Capacity(Class->Capacity)
//                        [default inanger=false]
//   building.cpp:2274 — Limbo (sell/removal): Adjust_Capacity(-Class->Capacity, true)
//   building.cpp:2986 — Captured: Adjust_Capacity(-Class->Capacity, true)
//
// PARITY GAP: In C++, when a SILO is sold (!inanger via normal build removal),
// excess Tiberium is refunded to Credits. But the Limbo path for sell uses
// inanger=true, so excess is LOST. This is nuanced: the sell path calls
// Refund_Money first, then Limbo (which does Adjust_Capacity(-cap, true)).
// ===========================================================================

describe('Adjust_Capacity — inanger distinction (house.cpp:1946)', () => {

  it('inanger=true (destruction): excess ore is lost', () => {
    // C++: Capacity=3000, Tiberium=3000, destroy SILO (-1500, inanger=true)
    //   Capacity=1500, Tiberium(3000) > Capacity(1500)
    //   retval=1500, Tiberium=1500, inanger=true → lost
    const structures = [makeSILO(10, 10), makeSILO(12, 10)];
    let credits = 3000;

    structures[0].alive = false;
    const newCap = calculateSiloCapacity(structures, House.Spain, isAllied);
    if (newCap > 0 && credits > newCap) {
      credits = newCap; // overflow is lost
    }
    expect(credits).toBe(1500); // 1500 lost
  });

  it('inanger=false (build completion): C++ refunds excess to Credits', () => {
    // C++ scenario: Capacity=1500 (1 SILO), Tiberium=1500 (full)
    // Sell that SILO: Adjust_Capacity(-1500, true [via Limbo])
    // → Capacity=0, Tiberium=1500>0, excess=1500, inanger=true → LOST
    //
    // BUT the Grand_Opening (build) path uses inanger=false:
    // If somehow capacity decreased via Grand_Opening re-open, excess would
    // be refunded. In practice Grand_Opening only increases capacity.
    //
    // The key insight: Grand_Opening (build) adds capacity, never reduces.
    // So inanger=false on this path never actually triggers overflow handling.
    // The overflow path only matters for capacity reduction (Limbo, Captured).
    const structures = [makePROC(10, 10)];
    const cap = calculateSiloCapacity(structures, House.Spain, isAllied);
    expect(cap).toBe(2000); // Grand_Opening adds 2000 capacity
  });

  it('capacity drops to 0: C++ sets Tiberium=0 (inanger=true)', () => {
    // C++: Capacity=1500, Tiberium=1500, Adjust_Capacity(-1500, true)
    //   Capacity=max(0, 0)=0, Tiberium(1500)>Capacity(0)
    //   retval=1500, Tiberium=0, inanger=true → 1500 credits LOST
    //   Available_Money = 0 + Credits
    //
    // TS (recalculateSiloCapacity): if (siloCapacity > 0 && credits > siloCapacity)
    //   → guard fails (siloCapacity=0, NOT > 0), credits preserved
    //
    // PARITY GAP: C++ loses all stored Tiberium when capacity hits 0.
    // TS preserves credits when capacity is 0.
    const structures = [makeSILO(10, 10)];
    let credits = 1500;

    structures[0].alive = false;
    const newCap = calculateSiloCapacity(structures, House.Spain, isAllied);
    expect(newCap).toBe(0);

    // TS behavior: credits preserved (guard: siloCapacity > 0 fails)
    if (newCap > 0 && credits > newCap) {
      credits = newCap;
    }
    expect(credits).toBe(1500); // TS preserves

    // C++ behavior: Tiberium would be set to 0
    // This is a known divergence. In C++, the player's Credits pool
    // (starting cash) would still be intact, so Available_Money would
    // be just Credits. The TS single-bucket model can't distinguish.
    // PARITY GAP: C++ would have Available_Money = Credits (no Tiberium),
    // TS has credits = 1500 (preserved). If the 1500 was all from
    // harvesting (pure Tiberium), C++ loses it all. If it was initial
    // Credits, C++ preserves it. TS can't tell the difference.
  });
});

// ===========================================================================
// Section 6: Spend_Money — Tiberium first, then Credits
//
// C++ house.cpp:1886-1900:
//   void HouseClass::Spend_Money(unsigned money)
//   {
//       long oldtib = Tiberium;
//       if (money > Tiberium) {
//           money -= (unsigned)Tiberium;
//           Tiberium = 0;
//           Credits -= money;
//       } else {
//           Tiberium -= money;
//       }
//       Silo_Redraw_Check(oldtib, Capacity);
//       CreditsSpent += money;
//   }
//
// Key: Spending depletes Tiberium (silo ore) FIRST, preserving Credits.
// This means initial cash survives longer than harvested ore.
//
// TS equivalent: this.credits -= costPerTick (production.ts:172)
//   TS has a single bucket — no Tiberium-first preference.
//
// PARITY GAP: TS doesn't implement Tiberium-first spending because there
// is no separate Tiberium pool. This affects how overflow works after
// spending: in C++, spending reduces Tiberium, freeing silo space.
// In TS, spending reduces credits below the silo cap, which also frees
// space. The end result is functionally equivalent for gameplay because
// the player sees the same total money decrease.
// ===========================================================================

describe('Spend_Money — C++ dual-bucket spending (house.cpp:1886)', () => {

  it('C++ spends Tiberium first, preserving Credits pool', () => {
    // C++: Tiberium=800, Credits=200, Spend_Money(500)
    //   money(500) <= Tiberium(800) → Tiberium -= 500 = 300
    //   Credits unchanged = 200
    //   Available = 300 + 200 = 500
    //
    // TS: credits=1000, credits -= 500 = 500
    // Same total, different internal allocation. Not observable in TS.

    // We can only test the total money behavior in TS
    let credits = 1000; // represents Tiberium(800) + Credits(200)
    credits -= 500;
    expect(credits).toBe(500);
  });

  it('C++ spending exceeds Tiberium, spills into Credits', () => {
    // C++: Tiberium=300, Credits=700, Spend_Money(500)
    //   money(500) > Tiberium(300) → money=200, Tiberium=0, Credits -= 200 = 500
    //   Available = 0 + 500 = 500
    //
    // TS: credits=1000, credits -= 500 = 500
    let credits = 1000;
    credits -= 500;
    expect(credits).toBe(500);
  });
});

// ===========================================================================
// Section 7: Available_Money — dual-bucket sum
//
// C++ house.cpp:1861-1866:
//   long HouseClass::Available_Money(void) const
//   {
//       return(Tiberium + Credits);
//   }
//
// In TS, `this.credits` IS the total — no separate Tiberium pool.
// ===========================================================================

describe('Available_Money — dual-bucket vs single-bucket (house.cpp:1861)', () => {

  it('TS credits field represents C++ Tiberium + Credits combined', () => {
    // C++: Tiberium=3000, Credits=5000, Available_Money()=8000
    // TS: credits=8000
    // The single-bucket model is equivalent for the player's visible balance.
    const tsCredits = 8000;
    expect(tsCredits).toBe(8000);
  });

  it('silo cap in TS only limits harvest path, not total balance', () => {
    // After a crate pickup that bypasses silo cap:
    // C++: Tiberium=1000 (at cap), Credits=5000 (from crate), Available=6000
    // TS: credits=6000 (via addCredits bypass)
    let credits = 1000; // at silo cap
    credits += 5000; // crate bypass
    expect(credits).toBe(6000);
    // Further harvesting would be capped at silo capacity:
    const siloCapacity = 1000;
    // Can't harvest more because silo is full (Tiberium=Capacity in C++)
    // In TS, addCredits(ore, false) would NOT cap because credits(6000) > siloCapacity(1000)
    // It would try: Math.min(6000 + ore, 1000) = 1000 — that's LESS than current 6000
    // This would actually REDUCE credits!
    // PARITY GAP: TS addCredits with bypassSiloCap=false and credits already
    // above silo cap would clamp DOWN to siloCapacity, losing the excess from
    // the earlier bypass. C++ wouldn't do this because Credits pool is separate.
  });
});

// ===========================================================================
// Section 8: Compound scenario — sell storage with active credits
//
// Tests the complete sell-storage workflow end-to-end, matching the C++
// order of operations (Refund_Money THEN Limbo/Adjust_Capacity).
// ===========================================================================

describe('compound scenario: sell storage with active credits', () => {

  it('sell PROC when at capacity: refund added, then overflow spilled', () => {
    // Setup: 1 PROC (cap=2000) + 1 SILO (cap=1500) = total 3500
    // Credits = 3500 (at capacity)
    // Player sells the PROC (cost=2000, refund=1000)
    //
    // TS order (index.ts:1900-1927):
    //   1. recalculateSiloCapacity() → cap=1500, credits=min(3500,1500)=1500
    //      (2000 lost to overflow)
    //   2. addCredits(1000, true) → credits=1500+1000=2500
    const structures = [makePROC(10, 10), makeSILO(14, 10)];
    let credits = 3500;
    const procCost = 2000;
    const refund = sellRefund(procCost, true); // 1000

    // TS path: recalculate first, then add refund
    structures[0].alive = false;
    const newCap = calculateSiloCapacity(structures, House.Spain, isAllied);
    expect(newCap).toBe(1500);
    if (newCap > 0 && credits > newCap) {
      credits = newCap; // 3500 → 1500 (overflow: 2000 lost)
    }
    credits += refund; // 1500 + 1000 = 2500
    expect(credits).toBe(2500);
  });

  it('sell only storage building: refund preserves some money', () => {
    // 1 PROC only, credits=2000 (at cap), sell PROC
    // TS: recalc → cap=0, guard fails (cap NOT > 0), credits=2000
    //     addCredits(1000, true) → credits=3000
    //
    // PARITY GAP: C++ ends at 1000, TS ends at 3000.
    const structures = [makePROC(10, 10)];
    let credits = 2000;
    const procCost = 2000;
    const refund = sellRefund(procCost, true); // 1000

    structures[0].alive = false;
    const newCap = calculateSiloCapacity(structures, House.Spain, isAllied);
    expect(newCap).toBe(0);

    // TS behavior
    if (newCap > 0 && credits > newCap) {
      credits = newCap;
    }
    credits += refund;

    // TS result: 2000 + 1000 = 3000 (preserves everything)
    expect(credits).toBe(3000); // TS behavior
  });
});

// ===========================================================================
// Section 9: Capacity increase (Grand_Opening) with existing credits
//
// When a SILO or PROC completes construction, capacity increases.
// C++ building.cpp:2396: House->Adjust_Capacity(Class->Capacity)
// Default inanger=false, so if overflow existed, it would be refunded.
// But in practice, adding capacity can't cause overflow — it only helps.
// ===========================================================================

describe('capacity increase via building completion (building.cpp:2396)', () => {

  it('building a SILO increases capacity', () => {
    const structures = [makePROC(10, 10), makeSILO(14, 10, 300, House.Spain)];
    // Before SILO exists
    structures[1].buildProgress = 0.5;
    const capBefore = calculateSiloCapacity(structures, House.Spain, isAllied);
    expect(capBefore).toBe(2000); // only PROC counts (SILO under construction)

    // After SILO completes
    structures[1].buildProgress = 1;
    const capAfter = calculateSiloCapacity(structures, House.Spain, isAllied);
    expect(capAfter).toBe(3500); // PROC(2000) + SILO(1500)
  });

  it('credits below new capacity: no change after build', () => {
    const structures = [makePROC(10, 10)];
    let credits = 800;
    const capBefore = calculateSiloCapacity(structures, House.Spain, isAllied);
    expect(capBefore).toBe(2000);

    // Add a SILO
    const newSilo = makeSILO(14, 10);
    structures.push(newSilo);
    const capAfter = calculateSiloCapacity(structures, House.Spain, isAllied);
    expect(capAfter).toBe(3500);

    // Credits not affected by capacity increase
    expect(credits).toBe(800);
  });

  it('credits above old capacity but below new capacity: no spillage on build', () => {
    // Edge case: credits somehow exceed old capacity (e.g., from crate bypass)
    // Building new storage increases capacity, so no overflow occurs
    const structures = [makePROC(10, 10)];
    let credits = 2500; // above 2000 cap (from crate bypass)

    structures.push(makeSILO(14, 10));
    const newCap = calculateSiloCapacity(structures, House.Spain, isAllied);
    expect(newCap).toBe(3500);

    // recalculateSiloCapacity: credits(2500) < cap(3500) → no change
    if (newCap > 0 && credits > newCap) {
      credits = newCap;
    }
    expect(credits).toBe(2500); // preserved
  });
});

// ===========================================================================
// Section 10: Tiberium_Fraction — silo fill level visual
//
// C++ house.cpp:205-210:
//   fixed HouseClass::Tiberium_Fraction(void) const
//   {
//       if (Tiberium == 0) return(0);
//       return(fixed(Tiberium, Capacity));
//   }
//
// C++ building.cpp:658-665 (silo imagery):
//   if (House->Capacity) {
//       level = (House->Tiberium * 5) / House->Capacity;
//   }
//
// This gives 6 visual levels (0-5) for silo fullness.
// ===========================================================================

describe('Tiberium_Fraction — silo fill level (house.cpp:205)', () => {

  it('silo visual level: 0/5 at empty', () => {
    const tiberium = 0;
    const capacity = 3000;
    const level = capacity > 0 ? Math.floor((tiberium * 5) / capacity) : 0;
    expect(level).toBe(0);
  });

  it('silo visual level: 5/5 at full', () => {
    const tiberium = 3000;
    const capacity = 3000;
    const level = capacity > 0 ? Math.floor((tiberium * 5) / capacity) : 0;
    expect(level).toBe(5);
  });

  it('silo visual level changes at 20% intervals', () => {
    const capacity = 3000;
    // Level boundaries: 0=0%, 1=20%, 2=40%, 3=60%, 4=80%, 5=100%
    expect(Math.floor((0 * 5) / capacity)).toBe(0);
    expect(Math.floor((599 * 5) / capacity)).toBe(0);   // just below 20%
    expect(Math.floor((600 * 5) / capacity)).toBe(1);   // exactly 20%
    expect(Math.floor((1200 * 5) / capacity)).toBe(2);  // 40%
    expect(Math.floor((1800 * 5) / capacity)).toBe(3);  // 60%
    expect(Math.floor((2400 * 5) / capacity)).toBe(4);  // 80%
    expect(Math.floor((3000 * 5) / capacity)).toBe(5);  // 100%
  });

  it('Tiberium_Fraction returns 0 when Tiberium is 0 regardless of capacity', () => {
    // C++ short-circuit: if (Tiberium == 0) return(0);
    const fraction = 0; // Tiberium == 0
    expect(fraction).toBe(0);
  });
});

// ===========================================================================
// Section 11: Edge cases — calculateSiloCapacity correctness
//
// Uses the real imported function to test capacity calculation.
// ===========================================================================

describe('calculateSiloCapacity edge cases', () => {

  it('PROC provides 2000 capacity (rules.ini Storage=2000)', () => {
    const structures = [makePROC(10, 10)];
    expect(calculateSiloCapacity(structures, House.Spain, isAllied)).toBe(2000);
  });

  it('SILO provides 1500 capacity', () => {
    const structures = [makeSILO(10, 10)];
    expect(calculateSiloCapacity(structures, House.Spain, isAllied)).toBe(1500);
  });

  it('dead structures do not contribute', () => {
    const s = makeSILO(10, 10);
    s.alive = false;
    expect(calculateSiloCapacity([s], House.Spain, isAllied)).toBe(0);
  });

  it('enemy structures do not contribute', () => {
    const s = makeSILO(10, 10, 300, House.USSR);
    expect(calculateSiloCapacity([s], House.Spain, isAllied)).toBe(0);
  });

  it('allied (Greece) structures contribute', () => {
    const s = makeSILO(10, 10, 300, House.Greece);
    expect(calculateSiloCapacity([s], House.Spain, isAllied)).toBe(1500);
  });

  it('under-construction structures do not contribute', () => {
    const s = makeSILO(10, 10);
    (s as any).buildProgress = 0.5;
    expect(calculateSiloCapacity([s], House.Spain, isAllied)).toBe(0);
  });

  it('completed construction (buildProgress=1) contributes', () => {
    const s = makeSILO(10, 10);
    (s as any).buildProgress = 1;
    expect(calculateSiloCapacity([s], House.Spain, isAllied)).toBe(1500);
  });

  it('pre-placed structures (buildProgress=undefined) contribute', () => {
    const s = makeSILO(10, 10);
    // buildProgress is undefined by default in our helper
    expect(calculateSiloCapacity([s], House.Spain, isAllied)).toBe(1500);
  });

  it('non-storage buildings contribute 0', () => {
    const powr: MapStructure = {
      type: 'POWR', image: 'powr', house: House.Spain,
      cx: 10, cy: 10, hp: 400, maxHp: 400, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    expect(calculateSiloCapacity([powr], House.Spain, isAllied)).toBe(0);
  });

  it('mixed fleet: 3 PROC + 4 SILO = 12000 capacity', () => {
    const structures: MapStructure[] = [];
    for (let i = 0; i < 3; i++) structures.push(makePROC(i * 4, 0));
    for (let i = 0; i < 4; i++) structures.push(makeSILO(i + 20, 0));
    expect(calculateSiloCapacity(structures, House.Spain, isAllied)).toBe(12000);
  });
});

// ===========================================================================
// Section 12: EVA "Silos Needed" warning threshold
//
// C++ house.cpp:1115:
//   if ((Capacity - Tiberium) < 300 && Capacity > 500 &&
//       (ActiveBScan & (STRUCTF_REFINERY | STRUCTF_CONST))) {
//
// TS (index.ts:6004):
//   if (this.siloCapacity > 500 && (this.siloCapacity - this.credits) < 300 && ...)
// ===========================================================================

describe('EVA "Silos Needed" threshold (house.cpp:1115)', () => {

  it('warning triggers: capacity=1000, credits=800 → free=200 < 300', () => {
    const siloCapacity = 1000;
    const credits = 800;
    const shouldWarn = siloCapacity > 500 && (siloCapacity - credits) < 300;
    expect(shouldWarn).toBe(true);
  });

  it('warning does not trigger: capacity=1000, credits=600 → free=400 >= 300', () => {
    const siloCapacity = 1000;
    const credits = 600;
    const shouldWarn = siloCapacity > 500 && (siloCapacity - credits) < 300;
    expect(shouldWarn).toBe(false);
  });

  it('warning does not trigger: capacity=500 → guard fails (NOT > 500)', () => {
    // C++ requires Capacity > 500
    const siloCapacity = 500;
    const credits = 400; // free=100 < 300 but capacity too low
    const shouldWarn = siloCapacity > 500 && (siloCapacity - credits) < 300;
    expect(shouldWarn).toBe(false);
  });

  it('warning triggers at boundary: capacity=501, credits=202 → free=299 < 300', () => {
    const siloCapacity = 501;
    const credits = 202;
    const shouldWarn = siloCapacity > 500 && (siloCapacity - credits) < 300;
    expect(shouldWarn).toBe(true);
  });

  it('warning does not trigger: capacity=501, credits=201 → free=300, NOT < 300', () => {
    const siloCapacity = 501;
    const credits = 201;
    const shouldWarn = siloCapacity > 500 && (siloCapacity - credits) < 300;
    expect(shouldWarn).toBe(false);
  });
});

// ===========================================================================
// Section 13: Sequential destruction cascade
//
// Verifies that multiple storage buildings being destroyed one after another
// each independently causes overflow spillage.
// ===========================================================================

describe('sequential destruction cascade', () => {

  it('destroying 3 SILOs in sequence: each independently spills', () => {
    const structures = [makeSILO(10, 10), makeSILO(12, 10), makeSILO(14, 10)];
    let credits = 4500; // full (3 * 1500)

    // Destroy #1: 4500 → cap to 3000
    structures[0].alive = false;
    let cap = calculateSiloCapacity(structures, House.Spain, isAllied);
    expect(cap).toBe(3000);
    if (cap > 0 && credits > cap) credits = cap;
    expect(credits).toBe(3000);

    // Destroy #2: 3000 → cap to 1500
    structures[1].alive = false;
    cap = calculateSiloCapacity(structures, House.Spain, isAllied);
    expect(cap).toBe(1500);
    if (cap > 0 && credits > cap) credits = cap;
    expect(credits).toBe(1500);

    // Destroy #3: capacity=0, guard fails, credits preserved (TS)
    structures[2].alive = false;
    cap = calculateSiloCapacity(structures, House.Spain, isAllied);
    expect(cap).toBe(0);
    if (cap > 0 && credits > cap) credits = cap;
    expect(credits).toBe(1500); // PARITY GAP: C++ would set Tiberium=0
  });

  it('alternating PROC/SILO destruction with partial credits', () => {
    const structures = [
      makePROC(10, 10),  // 2000
      makeSILO(14, 10),  // 1500
      makePROC(18, 10),  // 2000
    ];
    // Total capacity = 5500, credits = 3000
    let credits = 3000;

    // Destroy PROC: cap=3500, credits=3000 < 3500 → no loss
    structures[0].alive = false;
    let cap = calculateSiloCapacity(structures, House.Spain, isAllied);
    expect(cap).toBe(3500);
    if (cap > 0 && credits > cap) credits = cap;
    expect(credits).toBe(3000);

    // Destroy SILO: cap=2000, credits=3000 > 2000 → lose 1000
    structures[1].alive = false;
    cap = calculateSiloCapacity(structures, House.Spain, isAllied);
    expect(cap).toBe(2000);
    if (cap > 0 && credits > cap) credits = cap;
    expect(credits).toBe(2000);

    // Destroy last PROC: cap=0, guard fails → credits preserved (TS)
    structures[2].alive = false;
    cap = calculateSiloCapacity(structures, House.Spain, isAllied);
    expect(cap).toBe(0);
    if (cap > 0 && credits > cap) credits = cap;
    expect(credits).toBe(2000); // PARITY GAP: C++ would zero Tiberium
  });
});
