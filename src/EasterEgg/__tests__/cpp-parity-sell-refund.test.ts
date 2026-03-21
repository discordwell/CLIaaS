/**
 * C++ parity test: sell refund mechanics — full formula coverage.
 *
 * C++ source: techno.cpp:5743-5761 TechnoClass::Refund_Amount()
 *
 *   int cost = Techno_Type_Class()->Raw_Cost() * House->CostBias;
 *   if (House->IsHuman) {
 *       cost = cost * Rule.RefundPercent;  // Rule.RefundPercent = fixed(1,2) = 0.5
 *   }
 *   return(cost);
 *
 * Key behaviors:
 *   1. AI gets 100% of Raw_Cost * CostBias (no RefundPercent applied)
 *   2. Human gets Raw_Cost * CostBias * 0.5 (RefundPercent = 50%)
 *   3. No health scaling — refund is independent of building HP
 *   4. CostBias is a per-house difficulty multiplier (default 1.0)
 *   5. C++ int multiplication truncates fractional results (floor)
 *
 * C++ source: building.cpp:3567-3572 Mission_Deconstruction (sell completion)
 *   House->Refund_Money(Refund_Amount());
 *   No health ratio applied — full Refund_Amount regardless of damage.
 *
 * C++ source: foot.cpp:2123-2137 FootClass::Sell_Back (unit sell on repair bay)
 *   House->Refund_Money(Refund_Amount());
 *   Same formula — units use identical refund calculation.
 *
 * C++ source: house.cpp:7322-7335 Fire_Sale
 *   Calls Sell_Back(1) on each building → enters MISSION_DECONSTRUCTION
 *   → eventually calls Refund_Money(Refund_Amount())
 *   AI Fire_Sale gets 100% refund per building (no RefundPercent, no health scaling)
 *
 * C++ source: rules.cpp:265 RefundPercent initialization
 *   RefundPercent(fixed(1, 2))  — initialized to 0.5
 *
 * See also: cpp-parity-ai-sell-refund.test.ts for basic AI vs human refund tests.
 * This file covers: CostBias interaction, health independence, Fire_Sale parity,
 * unit sell, integer truncation edge cases, and structural invariants.
 */

import { describe, it, expect } from 'vitest';
import { sellRefund } from '../engine/repairSell';
import { aiFireSale, type AIContext } from '../engine/ai';

// ============================================================
// Section 1: CostBias interaction — C++ techno.cpp:5747
// cost = Raw_Cost() * House->CostBias
// CostBias defaults to 1.0 but can vary by difficulty.
// TS sellRefund() takes buildCost (= Raw_Cost * CostBias already applied).
// ============================================================
describe('CostBias interaction (techno.cpp:5747)', () => {
  // C++: cost = Raw_Cost * CostBias, then optionally * RefundPercent
  // TS: sellRefund(buildCost) where buildCost is pre-multiplied by CostBias
  // We test that the caller must apply CostBias before calling sellRefund.

  it('CostBias=1.0 (default): 2000 cost → human gets 1000', () => {
    const rawCost = 2000;
    const costBias = 1.0;
    const effectiveCost = rawCost * costBias;
    expect(sellRefund(effectiveCost, true)).toBe(1000);
  });

  it('CostBias=1.0 (default): 2000 cost → AI gets 2000', () => {
    const rawCost = 2000;
    const costBias = 1.0;
    const effectiveCost = rawCost * costBias;
    expect(sellRefund(effectiveCost, false)).toBe(2000);
  });

  it('CostBias=0.8 (easy difficulty): 2000 raw → effective 1600 → human gets 800', () => {
    const rawCost = 2000;
    const costBias = 0.8;
    const effectiveCost = Math.floor(rawCost * costBias); // C++ int truncation
    expect(sellRefund(effectiveCost, true)).toBe(800);
  });

  it('CostBias=1.2 (hard difficulty): 2000 raw → effective 2400 → AI gets 2400', () => {
    const rawCost = 2000;
    const costBias = 1.2;
    const effectiveCost = Math.floor(rawCost * costBias);
    expect(sellRefund(effectiveCost, false)).toBe(2400);
  });

  it('CostBias with odd raw cost: 300 * 1.3 = 390 → human gets 195', () => {
    const rawCost = 300;
    const costBias = 1.3;
    const effectiveCost = Math.floor(rawCost * costBias); // 390
    expect(sellRefund(effectiveCost, true)).toBe(195);
  });
});

// ============================================================
// Section 2: C++ integer truncation — fixed(1,2) multiplication
// In C++, `int * fixed` uses: ((raw * intVal) + 128) / 256
// fixed(1,2) raw = 128, so: ((128 * cost) + 128) / 256 — rounds half-up.
// TS uses Math.trunc((128 * cost + 128) / 256) to match C++.
// ============================================================
describe('integer truncation parity — C++ int * fixed(1,2) (techno.cpp:5758)', () => {
  it('even cost: 300 * 0.5 = 150 (exact)', () => {
    expect(sellRefund(300, true)).toBe(150);
  });

  it('even cost: 2000 * 0.5 = 1000 (exact)', () => {
    expect(sellRefund(2000, true)).toBe(1000);
  });

  it('odd cost: 25 → C++ fixed-point rounds half-up: (128*25+128)/256 = 13', () => {
    expect(sellRefund(25, true)).toBe(13);
  });

  it('odd cost: 1 → C++ fixed-point rounds half-up: (128*1+128)/256 = 1', () => {
    expect(sellRefund(1, true)).toBe(1);
  });

  it('odd cost: 3 → C++ fixed-point rounds half-up: (128*3+128)/256 = 2', () => {
    expect(sellRefund(3, true)).toBe(2);
  });

  it('odd cost: 99 → C++ fixed-point rounds half-up: (128*99+128)/256 = 50', () => {
    expect(sellRefund(99, true)).toBe(50);
  });

  it('odd cost: 151 → C++ fixed-point rounds half-up: (128*151+128)/256 = 76', () => {
    expect(sellRefund(151, true)).toBe(76);
  });

  it('very large cost: 99999 → C++ fixed-point: (128*99999+128)/256 = 50000', () => {
    expect(sellRefund(99999, true)).toBe(50000);
  });
});

// ============================================================
// Section 3: Health independence — C++ Refund_Amount has NO health scaling
// C++ building.cpp:3567-3572: House->Refund_Money(Refund_Amount())
// Refund_Amount() does NOT factor in health ratio.
// ============================================================
describe('health independence — no HP scaling in refund (techno.cpp:5743-5761)', () => {
  // C++ Refund_Amount() doesn't take health as a parameter at all.
  // The TS sellRefund() correctly has no health parameter.
  // Verify that the TS function signature enforces this.

  it('sellRefund takes only (buildCost, isHuman) — no health parameter', () => {
    // Verify the function works with exactly 2 args (no health scaling)
    const fullHpRefund = sellRefund(2000, true);
    // If we could pass health, a half-health building should give same refund
    // Since there's no health param, this just confirms the API contract
    expect(fullHpRefund).toBe(1000);
    expect(sellRefund(2000, true)).toBe(fullHpRefund); // idempotent
  });

  it('AI refund is 100% regardless of implied health', () => {
    // In C++, a building at 1HP still refunds 100% of Raw_Cost * CostBias
    expect(sellRefund(2000, false)).toBe(2000);
    expect(sellRefund(500, false)).toBe(500);
    expect(sellRefund(150, false)).toBe(150);
  });

  it('human refund is 50% regardless of implied health', () => {
    // In C++, a building at 1HP still refunds 50% of Raw_Cost * CostBias
    expect(sellRefund(2000, true)).toBe(1000);
    expect(sellRefund(500, true)).toBe(250);
    expect(sellRefund(150, true)).toBe(75);
  });
});

// ============================================================
// Section 4: Fire_Sale parity — AI sells all buildings at 100%
// C++ house.cpp:7322-7335: Fire_Sale calls Sell_Back(1) on each building
// Sell_Back → Mission_Deconstruction → Refund_Money(Refund_Amount())
// AI gets 100% refund, no health scaling.
//
// TS ai.ts:868-887: aiFireSale applies 50% * hpRatio — WRONG
// PARITY GAP: AI fire sale should give 100% refund, no health scaling
// ============================================================
describe('Fire_Sale parity — AI gets 100% refund (house.cpp:7322-7335)', () => {
  function makeFireSaleContext(buildings: Array<{
    type: string; hp: number; maxHp: number; house: string;
    cost: number;
  }>): AIContext {
    const structures = buildings.map((b, i) => ({
      type: b.type,
      hp: b.hp,
      maxHp: b.maxHp,
      house: b.house as any,
      alive: true,
      rubble: false,
      cx: i, cy: 0,
      w: 2, h: 2,
      sellProgress: undefined as number | undefined,
      sellHpAtStart: undefined as number | undefined,
      buildProgress: undefined as number | undefined,
    }));

    const houseCredits = new Map<any, number>();
    houseCredits.set('Soviet' as any, 0);

    return {
      structures,
      entities: [],
      credits: 0,
      tick: 100,
      playerHouse: 'Greece' as any,
      houseCredits,
      scenarioProductionItems: buildings.map(b => ({
        type: b.type,
        cost: b.cost,
        isStructure: true,
        buildTime: 100,
        prerequisites: [],
        techLevel: 1,
        faction: 'soviet' as any,
      })),
      clearStructureFootprint: () => {},
      isAllied: (a: any, b: any) => a === b,
    } as any;
  }

  it('PARITY GAP: AI fire sale should refund 100%, not 50% * hpRatio', () => {
    // C++: AI sells POWR (cost=300) at full health → Refund_Amount = 300 (100%)
    // TS aiFireSale: Math.floor(300 * 0.5 * 1.0) = 150 (WRONG — applies 50%)
    const ctx = makeFireSaleContext([
      { type: 'POWR', hp: 200, maxHp: 200, house: 'Soviet', cost: 300 },
    ]);

    aiFireSale(ctx, 'Soviet' as any);

    const credits = ctx.houseCredits.get('Soviet' as any) ?? 0;
    // C++ expected: 300 (AI gets 100%)
    // TS actual: 150 (50% of 300) — PARITY GAP
    expect(credits).toBe(300); // PARITY GAP — TS gives 150
  });

  it('PARITY GAP: AI fire sale at half health — C++ still gives 100%', () => {
    // C++: AI sells PROC (cost=2000) at 50% health → Refund_Amount = 2000
    // Refund_Amount() has NO health scaling.
    // TS: Math.floor(2000 * 0.5 * 0.5) = 500 (WRONG — applies 50% AND health)
    const ctx = makeFireSaleContext([
      { type: 'PROC', hp: 500, maxHp: 1000, house: 'Soviet', cost: 2000 },
    ]);

    aiFireSale(ctx, 'Soviet' as any);

    const credits = ctx.houseCredits.get('Soviet' as any) ?? 0;
    // C++ expected: 2000 (AI gets 100%, no health scaling)
    // TS actual: 500 (50% * 50% health = 25%) — PARITY GAP
    expect(credits).toBe(2000); // PARITY GAP — TS gives 500
  });

  it('PARITY GAP: AI fire sale multiple buildings — cumulative 100% refund', () => {
    // C++: AI sells POWR (300) + BARR (300) + WEAP (2000) = 2600 total
    const ctx = makeFireSaleContext([
      { type: 'POWR', hp: 200, maxHp: 200, house: 'Soviet', cost: 300 },
      { type: 'BARR', hp: 400, maxHp: 400, house: 'Soviet', cost: 300 },
      { type: 'WEAP', hp: 1000, maxHp: 1000, house: 'Soviet', cost: 2000 },
    ]);

    aiFireSale(ctx, 'Soviet' as any);

    const credits = ctx.houseCredits.get('Soviet' as any) ?? 0;
    // C++ expected: 300 + 300 + 2000 = 2600
    // TS actual: 150 + 150 + 1000 = 1300 — PARITY GAP
    expect(credits).toBe(2600); // PARITY GAP — TS gives 1300
  });
});

// ============================================================
// Section 5: Unit sell on repair bay — C++ foot.cpp:2123-2137
// FootClass::Sell_Back calls Refund_Money(Refund_Amount())
// Same formula as buildings: AI 100%, human 50%, no health scaling.
// ============================================================
describe('unit sell on repair bay — same formula (foot.cpp:2123-2137)', () => {
  // C++ FootClass::Sell_Back(1):
  //   House->Refund_Money(Refund_Amount());
  // Refund_Amount() from TechnoClass — identical formula for units.

  it('human unit sell: 700 cost vehicle → refund 350 (50%)', () => {
    // C++: 700 * 0.5 = 350 (human RefundPercent)
    expect(sellRefund(700, true)).toBe(350);
  });

  it('AI unit sell: 700 cost vehicle → refund 700 (100%)', () => {
    // C++: 700 (AI gets full refund)
    expect(sellRefund(700, false)).toBe(700);
  });

  it('human unit sell: 950 cost (odd) → refund 475 (exact)', () => {
    expect(sellRefund(950, true)).toBe(475);
  });

  it('AI unit sell: 950 cost → refund 950', () => {
    expect(sellRefund(950, false)).toBe(950);
  });
});

// ============================================================
// Section 6: ConYard → MCV reversion refund rules
// C++ building.cpp:3509-3549: if ConYard can revert to MCV, NO refund
// If MCV can't be placed, THEN Refund_Money(money) where money = Refund_Amount()
// ============================================================
describe('ConYard → MCV reversion — conditional refund (building.cpp:3509-3549)', () => {
  // The refund logic for ConYard sell-back:
  // 1. Calculate money = Refund_Amount() before deleting building
  // 2. Try to place MCV
  // 3. If MCV placed successfully → NO refund
  // 4. If MCV can't be placed → House->Refund_Money(money)
  //
  // The sellRefund function itself is correct for this — the game engine
  // must implement the conditional logic.

  it('ConYard refund when MCV cannot spawn: human gets 50%', () => {
    expect(sellRefund(2000, true)).toBe(1000);
  });

  it('ConYard refund when MCV cannot spawn: AI gets 100%', () => {
    expect(sellRefund(2000, false)).toBe(2000);
  });
});

// ============================================================
// Section 7: Structural invariants from C++ code
// ============================================================
describe('structural invariants (techno.cpp:5743-5761)', () => {
  it('AI refund is always >= human refund for any cost', () => {
    for (let cost = 0; cost <= 5000; cost += 7) {
      const ai = sellRefund(cost, false);
      const human = sellRefund(cost, true);
      expect(ai, `cost=${cost}`).toBeGreaterThanOrEqual(human);
    }
  });

  it('AI refund is exactly 2x human refund for all even costs', () => {
    for (let cost = 0; cost <= 5000; cost += 2) {
      const ai = sellRefund(cost, false);
      const human = sellRefund(cost, true);
      expect(ai, `cost=${cost}`).toBe(human * 2);
    }
  });

  it('AI refund equals build cost (100%) for all costs', () => {
    for (let cost = 0; cost <= 5000; cost += 13) {
      expect(sellRefund(cost, false), `cost=${cost}`).toBe(cost);
    }
  });

  it('human refund equals C++ fixed-point (128*cost+128)/256 for all costs', () => {
    for (let cost = 0; cost <= 5000; cost += 13) {
      expect(sellRefund(cost, true), `cost=${cost}`).toBe(Math.trunc((128 * cost + 128) / 256));
    }
  });

  it('refund is non-negative for any non-negative cost', () => {
    for (let cost = 0; cost <= 1000; cost++) {
      expect(sellRefund(cost, true), `human cost=${cost}`).toBeGreaterThanOrEqual(0);
      expect(sellRefund(cost, false), `AI cost=${cost}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('refund is always an integer', () => {
    for (let cost = 0; cost <= 500; cost++) {
      expect(Number.isInteger(sellRefund(cost, true)), `human cost=${cost}`).toBe(true);
      expect(Number.isInteger(sellRefund(cost, false)), `AI cost=${cost}`).toBe(true);
    }
  });
});

// ============================================================
// Section 8: RefundPercent constant verification
// C++ rules.cpp:265: RefundPercent(fixed(1, 2))
// fixed(1,2) in C++ RA = 1/2 = 0.5
// ============================================================
describe('RefundPercent = fixed(1,2) = 0.5 (rules.cpp:265)', () => {
  it('human refund ratio is exactly 0.5 for large even costs', () => {
    const testCosts = [100, 200, 500, 1000, 2000, 5000, 10000];
    for (const cost of testCosts) {
      const refund = sellRefund(cost, true);
      expect(refund / cost, `cost=${cost}`).toBe(0.5);
    }
  });

  it('human refund ratio approaches 0.5 for large odd costs', () => {
    const cost = 99999;
    const refund = sellRefund(cost, true);
    // C++ fixed-point: (128*99999+128)/256 = 50000, ratio = 50000/99999 ≈ 0.50000...
    expect(refund / cost).toBeCloseTo(0.5, 4);
  });
});

// ============================================================
// Section 9: Default parameter behavior
// TS sellRefund(cost) defaults isHuman=true (backward compat)
// ============================================================
describe('default isHuman parameter (backward compat)', () => {
  it('sellRefund(cost) without isHuman defaults to true (human = 50%)', () => {
    expect(sellRefund(2000)).toBe(1000);
    expect(sellRefund(300)).toBe(150);
    expect(sellRefund(25)).toBe(13);  // C++ fixed-point rounds half-up for odd
    expect(sellRefund(1)).toBe(1);    // C++ fixed-point: (128+128)/256 = 1
    expect(sellRefund(0)).toBe(0);
  });

  it('sellRefund(cost) matches sellRefund(cost, true) for all costs', () => {
    for (let cost = 0; cost <= 500; cost++) {
      expect(sellRefund(cost)).toBe(sellRefund(cost, true));
    }
  });
});

// ============================================================
// Section 10: Zero and boundary costs
// ============================================================
describe('zero and boundary costs', () => {
  it('zero cost: human and AI both get 0', () => {
    expect(sellRefund(0, true)).toBe(0);
    expect(sellRefund(0, false)).toBe(0);
  });

  it('cost=1: human gets 1 (C++ fixed-point rounds half-up), AI gets 1', () => {
    expect(sellRefund(1, true)).toBe(1);
    expect(sellRefund(1, false)).toBe(1);
  });

  it('cost=2: human gets 1, AI gets 2', () => {
    expect(sellRefund(2, true)).toBe(1);
    expect(sellRefund(2, false)).toBe(2);
  });

  it('very large cost: 100000 → human 50000, AI 100000', () => {
    expect(sellRefund(100000, true)).toBe(50000);
    expect(sellRefund(100000, false)).toBe(100000);
  });
});
