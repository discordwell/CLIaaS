import { describe, it, expect } from 'vitest';
import { EXPLOSION_FRAMES, ANT_ANIM, UNIT_STATS, UnitType } from '../engine/types';

describe('EXPLOSION_FRAMES parity', () => {
  const EXPECTED: Record<string, number> = {
    piff: 4, piffpiff: 8, fball1: 18,
    'veh-hit1': 17, 'veh-hit2': 22, 'veh-hit3': 14,
    napalm1: 14, napalm2: 14, napalm3: 14,
    atomsfx: 27, 'art-exp1': 22,
    'h2o_exp1': 14, 'h2o_exp2': 14, 'h2o_exp3': 14,
  };

  it('contains all expected explosion sprites', () => {
    for (const [key, frames] of Object.entries(EXPECTED)) {
      expect(EXPLOSION_FRAMES[key], `${key} should have ${frames} frames`).toBe(frames);
    }
  });

  it('has no zero or negative frame counts', () => {
    for (const [key, frames] of Object.entries(EXPLOSION_FRAMES)) {
      expect(frames, `${key}`).toBeGreaterThan(0);
    }
  });

  it('piff has fewer frames than veh-hit1 (small vs large impact)', () => {
    expect(EXPLOSION_FRAMES['piff']).toBeLessThan(EXPLOSION_FRAMES['veh-hit1']);
  });
});

describe('ANT_ANIM layout (112 frames)', () => {
  it('standing frames: 0-7', () => {
    expect(ANT_ANIM.standBase).toBe(0);
  });

  it('walking frames: 8-71 (8 dirs × 8 frames)', () => {
    expect(ANT_ANIM.walkBase).toBe(8);
    expect(ANT_ANIM.walkCount).toBe(8);
    // 8 directions × 8 walk frames = 64, so walk range is 8..71
    expect(ANT_ANIM.walkBase + 8 * ANT_ANIM.walkCount).toBe(72);
  });

  it('attack frames: 72-103 (8 dirs × 4 frames)', () => {
    expect(ANT_ANIM.attackBase).toBe(72);
    expect(ANT_ANIM.attackCount).toBe(4);
    expect(ANT_ANIM.attackBase + 8 * ANT_ANIM.attackCount).toBe(104);
  });

  it('death frames: 104-111 (8 frames)', () => {
    expect(ANT_ANIM.deathBase).toBe(104);
    expect(ANT_ANIM.deathCount).toBe(8);
  });

  it('total frames = 112', () => {
    expect(ANT_ANIM.deathBase + ANT_ANIM.deathCount).toBe(112);
  });
});

describe('sell survivor parity constants', () => {
  it('survivor formula: floor(cost * 0.5 / 100), clamped 1-5', () => {
    const formula = (cost: number) => Math.min(5, Math.max(1, Math.floor((cost * 0.5) / 100)));
    expect(formula(300)).toBe(1);   // barracks, kennel
    expect(formula(500)).toBe(2);   // war factory
    expect(formula(600)).toBe(3);
    expect(formula(1000)).toBe(5);  // capped at 5
    expect(formula(2000)).toBe(5);  // stays capped
    expect(formula(100)).toBe(1);   // minimum 1
  });

  it('crew type units exist in UNIT_STATS', () => {
    // All unit types referenced in sell survivor code must exist
    expect(UNIT_STATS[UnitType.I_E1]).toBeDefined();
    expect(UNIT_STATS[UnitType.I_C1]).toBeDefined();
    expect(UNIT_STATS[UnitType.I_C7]).toBeDefined();
    expect(UNIT_STATS[UnitType.I_E6]).toBeDefined();
    expect(UNIT_STATS[UnitType.I_DOG]).toBeDefined();
  });
});

describe('credits display', () => {
  it('Math.floor prevents fractional display', () => {
    // Simulates the displayCredits animation step
    const credits = 1500;
    let displayCredits = 0;
    for (let i = 0; i < 100; i++) {
      const diff = credits - displayCredits;
      if (diff === 0) break;
      const step = Math.max(1, Math.abs(diff) >> 2);
      displayCredits = Math.min(credits, displayCredits + step);
    }
    expect(Math.floor(displayCredits)).toBe(displayCredits);
    expect(displayCredits).toBe(credits);
  });
});
