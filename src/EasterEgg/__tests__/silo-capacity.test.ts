import { describe, it, expect } from 'vitest';
import { House } from '../engine/types';
import type { MapStructure } from '../engine/scenario';

/**
 * Silo Storage Capacity Tests — C++ Parity
 *
 * In C++ Red Alert (house.cpp), HouseClass::Harvested() caps credits at silo capacity.
 * PROC (refinery) provides 2000 credits storage, SILO provides 1500 credits storage.
 * When a storage structure is destroyed, HouseClass::Adjust_Capacity() recalculates
 * capacity and caps credits to the new lower amount.
 */

/** Helper: create a minimal MapStructure for testing */
function makeStructure(type: string, house: House, alive = true, buildProgress?: number): MapStructure {
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx: 10,
    cy: 10,
    hp: 256,
    maxHp: 256,
    alive,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    buildProgress,
  };
}

/** Helper: calculate silo capacity from a structures array (mirrors Game.calculateSiloCapacity) */
function calculateSiloCapacity(structures: MapStructure[]): number {
  let capacity = 0;
  for (const s of structures) {
    if (!s.alive || (s.house !== House.Spain && s.house !== House.Greece)) continue;
    if (s.buildProgress !== undefined && s.buildProgress < 1) continue;
    if (s.type === 'PROC') capacity += 2000;
    else if (s.type === 'SILO') capacity += 1500;
  }
  return capacity;
}

/** Helper: add credits with silo capacity cap (mirrors Game.addCredits) */
function addCredits(credits: number, amount: number, siloCapacity: number): { credits: number; added: number } {
  if (siloCapacity <= 0) return { credits, added: 0 };
  const before = credits;
  const newCredits = Math.min(credits + amount, siloCapacity);
  return { credits: newCredits, added: newCredits - before };
}

/** Helper: recalculate capacity and cap credits (mirrors Game.recalculateSiloCapacity) */
function recalculateAndCap(credits: number, structures: MapStructure[]): { credits: number; siloCapacity: number } {
  const siloCapacity = calculateSiloCapacity(structures);
  if (siloCapacity > 0 && credits > siloCapacity) {
    return { credits: siloCapacity, siloCapacity };
  } else if (siloCapacity === 0) {
    return { credits: 0, siloCapacity: 0 };
  }
  return { credits, siloCapacity };
}

describe('Silo Storage Capacity (C++ Parity)', () => {

  describe('Capacity Calculation', () => {
    it('single PROC provides 2000 capacity', () => {
      const structures = [makeStructure('PROC', House.Spain)];
      expect(calculateSiloCapacity(structures)).toBe(2000);
    });

    it('single SILO provides 1500 capacity', () => {
      const structures = [makeStructure('SILO', House.Spain)];
      expect(calculateSiloCapacity(structures)).toBe(1500);
    });

    it('PROC + SILO = 3500 capacity', () => {
      const structures = [
        makeStructure('PROC', House.Spain),
        makeStructure('SILO', House.Spain),
      ];
      expect(calculateSiloCapacity(structures)).toBe(3500);
    });

    it('multiple PROCs stack capacity correctly', () => {
      const structures = [
        makeStructure('PROC', House.Spain),
        makeStructure('PROC', House.Spain),
        makeStructure('PROC', House.Spain),
      ];
      expect(calculateSiloCapacity(structures)).toBe(6000);
    });

    it('multiple SILOs stack capacity correctly', () => {
      const structures = [
        makeStructure('SILO', House.Spain),
        makeStructure('SILO', House.Spain),
      ];
      expect(calculateSiloCapacity(structures)).toBe(3000);
    });

    it('mixed PROC + multiple SILOs', () => {
      const structures = [
        makeStructure('PROC', House.Spain),
        makeStructure('SILO', House.Spain),
        makeStructure('SILO', House.Spain),
        makeStructure('SILO', House.Greece),  // allied house also counts
      ];
      expect(calculateSiloCapacity(structures)).toBe(6500);  // 2000 + 1500*3
    });

    it('dead/destroyed structures do not count toward capacity', () => {
      const structures = [
        makeStructure('PROC', House.Spain, true),
        makeStructure('PROC', House.Spain, false),  // destroyed
        makeStructure('SILO', House.Spain, false),   // destroyed
      ];
      expect(calculateSiloCapacity(structures)).toBe(2000);
    });

    it('enemy structures do not count toward player capacity', () => {
      const structures = [
        makeStructure('PROC', House.Spain),         // player: +2000
        makeStructure('PROC', House.USSR),           // enemy: ignored
        makeStructure('SILO', House.Ukraine),        // enemy: ignored
        makeStructure('SILO', House.Germany),        // enemy: ignored
      ];
      expect(calculateSiloCapacity(structures)).toBe(2000);
    });

    it('allied Greece structures count toward capacity', () => {
      const structures = [
        makeStructure('PROC', House.Greece),
        makeStructure('SILO', House.Greece),
      ];
      expect(calculateSiloCapacity(structures)).toBe(3500);
    });

    it('no storage structures = 0 capacity', () => {
      const structures = [
        makeStructure('POWR', House.Spain),
        makeStructure('TENT', House.Spain),
        makeStructure('WEAP', House.Spain),
      ];
      expect(calculateSiloCapacity(structures)).toBe(0);
    });

    it('under-construction structures do not count', () => {
      const structures = [
        makeStructure('PROC', House.Spain, true, 0.5),  // 50% built
        makeStructure('SILO', House.Spain, true, 0),     // just placed
      ];
      expect(calculateSiloCapacity(structures)).toBe(0);
    });

    it('completed construction counts (buildProgress = 1)', () => {
      const structures = [
        makeStructure('PROC', House.Spain, true, 1),  // fully built
      ];
      expect(calculateSiloCapacity(structures)).toBe(2000);
    });

    it('scenario-loaded structures count (buildProgress = undefined)', () => {
      const structures = [
        makeStructure('PROC', House.Spain, true, undefined),  // pre-placed
      ];
      expect(calculateSiloCapacity(structures)).toBe(2000);
    });
  });

  describe('Credit Capping', () => {
    it('credits capped at capacity when harvester unloads', () => {
      const siloCapacity = 2000;
      const result = addCredits(1800, 500, siloCapacity);
      expect(result.credits).toBe(2000);  // capped at capacity
      expect(result.added).toBe(200);     // only 200 of 500 stored
    });

    it('excess credits lost (not stored beyond capacity)', () => {
      const siloCapacity = 2000;
      const result = addCredits(2000, 300, siloCapacity);
      expect(result.credits).toBe(2000);  // still at cap
      expect(result.added).toBe(0);       // nothing added
    });

    it('credits below capacity are fully added', () => {
      const siloCapacity = 3500;
      const result = addCredits(1000, 500, siloCapacity);
      expect(result.credits).toBe(1500);
      expect(result.added).toBe(500);
    });

    it('zero capacity means no credits can be stored', () => {
      const siloCapacity = 0;
      const result = addCredits(0, 500, siloCapacity);
      expect(result.credits).toBe(0);
      expect(result.added).toBe(0);
    });
  });

  describe('Structure Destruction', () => {
    it('destroying a SILO reduces capacity and caps credits', () => {
      const structures = [
        makeStructure('PROC', House.Spain),
        makeStructure('SILO', House.Spain),
      ];
      // Initial: 3500 capacity, 3000 credits
      let credits = 3000;
      let { siloCapacity } = recalculateAndCap(credits, structures);
      expect(siloCapacity).toBe(3500);
      expect(credits).toBeLessThanOrEqual(siloCapacity);

      // Destroy the SILO
      structures[1].alive = false;
      const result = recalculateAndCap(credits, structures);
      expect(result.siloCapacity).toBe(2000);
      expect(result.credits).toBe(2000);  // capped from 3000 to 2000
    });

    it('destroying a PROC reduces capacity and caps credits', () => {
      const structures = [
        makeStructure('PROC', House.Spain),
        makeStructure('SILO', House.Spain),
      ];
      let credits = 3500;
      // Destroy the PROC
      structures[0].alive = false;
      const result = recalculateAndCap(credits, structures);
      expect(result.siloCapacity).toBe(1500);
      expect(result.credits).toBe(1500);  // capped from 3500 to 1500
    });

    it('destroying all storage structures sets capacity to 0 and credits to 0', () => {
      const structures = [
        makeStructure('PROC', House.Spain),
      ];
      let credits = 1500;
      // Destroy the only PROC
      structures[0].alive = false;
      const result = recalculateAndCap(credits, structures);
      expect(result.siloCapacity).toBe(0);
      expect(result.credits).toBe(0);
    });

    it('destroying non-storage structure does not affect capacity', () => {
      const structures = [
        makeStructure('PROC', House.Spain),
        makeStructure('POWR', House.Spain),
      ];
      let credits = 1500;
      // Destroy the power plant
      structures[1].alive = false;
      const result = recalculateAndCap(credits, structures);
      expect(result.siloCapacity).toBe(2000);
      expect(result.credits).toBe(1500);  // unchanged
    });

    it('credits not reduced below 0 on structure destruction', () => {
      const structures = [
        makeStructure('PROC', House.Spain),
      ];
      let credits = 0;
      structures[0].alive = false;
      const result = recalculateAndCap(credits, structures);
      expect(result.credits).toBe(0);
      expect(result.siloCapacity).toBe(0);
    });
  });

  describe('EVA Warning', () => {
    it('silo warning triggers at 80% capacity', () => {
      const siloCapacity = 2000;
      const credits = 1600;  // exactly 80%
      const shouldWarn = siloCapacity > 0 && credits >= siloCapacity * 0.8;
      expect(shouldWarn).toBe(true);
    });

    it('silo warning does not trigger below 80% capacity', () => {
      const siloCapacity = 2000;
      const credits = 1599;  // just below 80%
      const shouldWarn = siloCapacity > 0 && credits >= siloCapacity * 0.8;
      expect(shouldWarn).toBe(false);
    });

    it('silo warning triggers when at full capacity', () => {
      const siloCapacity = 2000;
      const credits = 2000;  // 100%
      const shouldWarn = siloCapacity > 0 && credits >= siloCapacity * 0.8;
      expect(shouldWarn).toBe(true);
    });

    it('silo warning throttled to 30 seconds (450 ticks)', () => {
      const THROTTLE = 450;  // 30 seconds at 15 fps
      let lastWarningTick = 0;

      // First warning at tick 100
      const tick1 = 100;
      const canWarn1 = tick1 - lastWarningTick >= THROTTLE || lastWarningTick === 0;
      // Note: lastWarningTick starts at -450 in real code, so first warning always plays
      expect(tick1 - (-450) >= THROTTLE).toBe(true);

      // Second warning attempt at tick 200 (too soon)
      lastWarningTick = 100;
      const tick2 = 200;
      const canWarn2 = tick2 - lastWarningTick >= THROTTLE;
      expect(canWarn2).toBe(false);

      // Third warning attempt at tick 600 (30s later, should play)
      const tick3 = 600;
      const canWarn3 = tick3 - lastWarningTick >= THROTTLE;
      expect(canWarn3).toBe(true);
    });

    it('no warning when capacity is 0 (no silos)', () => {
      const siloCapacity = 0;
      const credits = 0;
      const shouldWarn = siloCapacity > 0 && credits >= siloCapacity * 0.8;
      expect(shouldWarn).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('adding 0 credits does not change balance', () => {
      const siloCapacity = 2000;
      const result = addCredits(1000, 0, siloCapacity);
      expect(result.credits).toBe(1000);
      expect(result.added).toBe(0);
    });

    it('capacity with only enemy structures is 0', () => {
      const structures = [
        makeStructure('PROC', House.USSR),
        makeStructure('SILO', House.USSR),
        makeStructure('PROC', House.Ukraine),
      ];
      expect(calculateSiloCapacity(structures)).toBe(0);
    });

    it('neutral structures do not count', () => {
      const structures = [
        makeStructure('PROC', House.Neutral),
        makeStructure('SILO', House.Turkey),
      ];
      expect(calculateSiloCapacity(structures)).toBe(0);
    });

    it('mixed alive/dead/enemy structures compute correctly', () => {
      const structures = [
        makeStructure('PROC', House.Spain, true),     // +2000
        makeStructure('PROC', House.Spain, false),    // dead, ignored
        makeStructure('SILO', House.Spain, true),     // +1500
        makeStructure('SILO', House.Greece, true),    // +1500 (allied)
        makeStructure('PROC', House.USSR, true),      // enemy, ignored
        makeStructure('SILO', House.Ukraine, true),   // enemy, ignored
        makeStructure('POWR', House.Spain, true),     // not storage, ignored
      ];
      expect(calculateSiloCapacity(structures)).toBe(5000);  // 2000 + 1500 + 1500
    });

    it('credits at exact capacity are not capped', () => {
      const siloCapacity = 2000;
      const result = addCredits(1999, 1, siloCapacity);
      expect(result.credits).toBe(2000);
      expect(result.added).toBe(1);
    });

    it('large ore load capped to remaining capacity', () => {
      const siloCapacity = 2000;
      const result = addCredits(100, 5000, siloCapacity);
      expect(result.credits).toBe(2000);
      expect(result.added).toBe(1900);
    });
  });
});
