/**
 * C++ parity test: AI gets 100% sell refund, human gets 50%.
 *
 * C++ source: techno.cpp:5743-5761 TechnoClass::Refund_Amount()
 *
 *   int cost = Techno_Type_Class()->Raw_Cost() * House->CostBias;
 *   if (House->IsHuman) {
 *       cost = cost * Rule.RefundPercent;  // Rule.RefundPercent = 0.5
 *   }
 *   return(cost);
 *
 * AI players receive full build cost when selling. Human players receive
 * Rule.RefundPercent (50%) of build cost. No health scaling in either case.
 */

import { describe, it, expect } from 'vitest';
import { sellRefund } from '../engine/repairSell';

describe('C++ parity: AI sell refund (techno.cpp:5743-5761)', () => {
  // Representative build costs for common structures
  const STRUCTURES = [
    { type: 'POWR', cost: 300 },
    { type: 'APWR', cost: 500 },
    { type: 'PROC', cost: 2000 },
    { type: 'BARR', cost: 300 },
    { type: 'TENT', cost: 300 },
    { type: 'WEAP', cost: 2000 },
    { type: 'FACT', cost: 2000 },
    { type: 'SILO', cost: 150 },
    { type: 'FIX',  cost: 1200 },
    { type: 'HPAD', cost: 1500 },
    { type: 'AFLD', cost: 600 },
    { type: 'DOME', cost: 1000 },
    { type: 'GAP',  cost: 800 },
    { type: 'ATEK', cost: 1500 },
    { type: 'STEK', cost: 1500 },
    { type: 'PDOX', cost: 2800 },
    { type: 'IRON', cost: 2800 },
    { type: 'MSLO', cost: 2500 },
  ];

  describe('human player gets 50% refund (Rule.RefundPercent)', () => {
    for (const { type, cost } of STRUCTURES) {
      it(`${type} (cost=${cost}): human refund = ${Math.floor(cost * 0.5)}`, () => {
        expect(sellRefund(cost, true)).toBe(Math.floor(cost * 0.5));
      });
    }
  });

  describe('AI player gets 100% refund (no RefundPercent penalty)', () => {
    for (const { type, cost } of STRUCTURES) {
      it(`${type} (cost=${cost}): AI refund = ${cost}`, () => {
        expect(sellRefund(cost, false)).toBe(cost);
      });
    }
  });

  describe('edge cases', () => {
    it('zero cost building: human and AI both get 0', () => {
      expect(sellRefund(0, true)).toBe(0);
      expect(sellRefund(0, false)).toBe(0);
    });

    it('odd cost (e.g. 25 for walls): human gets floor(25*0.5) = 12', () => {
      expect(sellRefund(25, true)).toBe(12);
      expect(sellRefund(25, false)).toBe(25);
    });

    it('AI refund is always >= human refund', () => {
      for (const { cost } of STRUCTURES) {
        expect(sellRefund(cost, false)).toBeGreaterThanOrEqual(sellRefund(cost, true));
      }
    });

    it('AI refund is exactly 2x human refund for even costs', () => {
      const evenCosts = STRUCTURES.filter(s => s.cost % 2 === 0);
      for (const { cost } of evenCosts) {
        expect(sellRefund(cost, false)).toBe(sellRefund(cost, true) * 2);
      }
    });

    it('default isHuman parameter is true (backward compat)', () => {
      // sellRefund(cost) without second arg should behave as human (50%)
      expect(sellRefund(2000)).toBe(1000);
      expect(sellRefund(300)).toBe(150);
    });
  });

  describe('AI vs human refund ratio matches C++ behavior', () => {
    it('human always gets exactly 50% (Rule.RefundPercent = 0.5)', () => {
      for (const { cost } of STRUCTURES) {
        const humanRefund = sellRefund(cost, true);
        expect(humanRefund / cost).toBeCloseTo(0.5, 5);
      }
    });

    it('AI always gets exactly 100%', () => {
      for (const { cost } of STRUCTURES) {
        const aiRefund = sellRefund(cost, false);
        expect(aiRefund / cost).toBe(1.0);
      }
    });
  });
});
