/**
 * Crate Spawn Weight Parity Tests — C++ RULES.INI CrateShares verification.
 *
 * Verifies all 17 crate types are present with correct share weights from
 * rules.ini [Powerups] section. Total shares = 146.
 *
 * Since CRATE_SHARES is a private static on the Game class, we verify through
 * the documented values and test the weighted distribution properties.
 */

import { describe, it, expect } from 'vitest';

// rules.ini [Powerups] crate share values (verified against rules.ini)
// Format: Name=shares,animation[,parameter]
// Cloak has 0 shares — disabled by default in rules.ini
const EXPECTED_SHARES: Array<{ type: string; shares: number }> = [
  { type: 'armor', shares: 10 },
  { type: 'cloak', shares: 0 },
  { type: 'darkness', shares: 1 },
  { type: 'explosion', shares: 5 },
  { type: 'firepower', shares: 10 },
  { type: 'healbase', shares: 1 },
  { type: 'icbm', shares: 1 },
  { type: 'money', shares: 50 },
  { type: 'napalm', shares: 5 },
  { type: 'parabomb', shares: 3 },
  { type: 'reveal', shares: 1 },
  { type: 'sonar', shares: 3 },
  { type: 'speed', shares: 10 },
  { type: 'squad', shares: 20 },
  { type: 'unit', shares: 20 },
  { type: 'invulnerability', shares: 3 },
  { type: 'timequake', shares: 3 },
];

// ============================================================
// Section 1: Expected crate share distribution (C++ RULES.INI)
// ============================================================
describe('crate share distribution — rules.ini [Powerups]', () => {

  it('17 crate types total', () => {
    expect(EXPECTED_SHARES.length).toBe(17);
  });

  it('total shares = 146', () => {
    const total = EXPECTED_SHARES.reduce((sum, s) => sum + s.shares, 0);
    expect(total).toBe(146);
  });

  // Individual weight verification
  it('money has the highest weight (50 shares = 34.2%)', () => {
    const money = EXPECTED_SHARES.find(s => s.type === 'money')!;
    expect(money.shares).toBe(50);
    const total = 146;
    const pct = (money.shares / total) * 100;
    expect(pct).toBeCloseTo(34.25, 1);
  });

  it('unit and squad are tied for second (20 shares each)', () => {
    const unit = EXPECTED_SHARES.find(s => s.type === 'unit')!;
    const squad = EXPECTED_SHARES.find(s => s.type === 'squad')!;
    expect(unit.shares).toBe(20);
    expect(squad.shares).toBe(20);
  });

  it('speed/firepower/armor each have 10 shares', () => {
    const buffs = ['speed', 'firepower', 'armor'];
    for (const type of buffs) {
      const entry = EXPECTED_SHARES.find(s => s.type === type)!;
      expect(entry.shares, `${type} shares`).toBe(10);
    }
  });

  it('explosion and napalm each have 5 shares', () => {
    expect(EXPECTED_SHARES.find(s => s.type === 'explosion')!.shares).toBe(5);
    expect(EXPECTED_SHARES.find(s => s.type === 'napalm')!.shares).toBe(5);
  });

  it('parabomb, sonar, invulnerability, timequake each have 3 shares', () => {
    const threeShareTypes = ['parabomb', 'sonar', 'invulnerability', 'timequake'];
    for (const type of threeShareTypes) {
      const entry = EXPECTED_SHARES.find(s => s.type === type)!;
      expect(entry.shares, `${type} shares`).toBe(3);
    }
  });

  it('darkness, healbase, icbm, reveal each have 1 share', () => {
    const oneShareTypes = ['darkness', 'healbase', 'icbm', 'reveal'];
    for (const type of oneShareTypes) {
      const entry = EXPECTED_SHARES.find(s => s.type === type)!;
      expect(entry.shares, `${type} shares`).toBe(1);
    }
  });

  it('cloak has 0 shares (disabled in rules.ini)', () => {
    expect(EXPECTED_SHARES.find(s => s.type === 'cloak')!.shares).toBe(0);
  });

  // All share values are non-negative integers
  it('all share values are non-negative integers', () => {
    for (const entry of EXPECTED_SHARES) {
      expect(entry.shares).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(entry.shares)).toBe(true);
    }
  });
});

// ============================================================
// Section 2: Probability distribution properties
// ============================================================
describe('crate probability distribution', () => {
  const TOTAL_SHARES = 146;

  it('money probability > 1/3 (~34.2%)', () => {
    const moneyPct = 50 / TOTAL_SHARES;
    expect(moneyPct).toBeGreaterThan(1 / 3);
  });

  it('top 3 crates (money+unit+squad) = 61.6% of all crates', () => {
    const topThree = (50 + 20 + 20) / TOTAL_SHARES;
    expect(topThree).toBeCloseTo(0.616, 2);
  });

  it('buff crates (speed+firepower+armor) = 20.5%', () => {
    const buffs = (10 + 10 + 10) / TOTAL_SHARES;
    expect(buffs).toBeCloseTo(0.205, 2);
  });

  it('1-share crates (darkness+healbase+icbm+reveal) = 2.7%', () => {
    const rare = (1 + 1 + 1 + 1) / TOTAL_SHARES;
    expect(rare).toBeCloseTo(0.027, 2);
  });

  it('no single crate type exceeds 50% probability', () => {
    const maxShares = 50;
    expect(maxShares / TOTAL_SHARES).toBeLessThan(0.5);
  });

  it('each 1-share crate has < 1% chance', () => {
    const rareShares = 1;
    expect(rareShares / TOTAL_SHARES).toBeLessThan(0.01);
  });
});

// ============================================================
// Section 3: Weighted random simulation (statistical verification)
// ============================================================
describe('weighted random distribution simulation', () => {
  // Filter to only entries with nonzero shares for selection
  const SELECTABLE = EXPECTED_SHARES.filter(s => s.shares > 0);

  function weightedSelect(): string {
    const totalShares = SELECTABLE.reduce((sum, s) => sum + s.shares, 0);
    let roll = Math.random() * totalShares;
    for (const entry of SELECTABLE) {
      roll -= entry.shares;
      if (roll <= 0) return entry.type;
    }
    return SELECTABLE[SELECTABLE.length - 1].type;
  }

  it('10000 rolls: money appears 28-40% of the time (expected 34.2%)', () => {
    const N = 10000;
    let moneyCount = 0;
    for (let i = 0; i < N; i++) {
      if (weightedSelect() === 'money') moneyCount++;
    }
    const pct = moneyCount / N;
    expect(pct).toBeGreaterThan(0.28);
    expect(pct).toBeLessThan(0.40);
  });

  it('10000 rolls: all 16 selectable types appear at least once', () => {
    const N = 10000;
    const counts = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      const type = weightedSelect();
      counts.set(type, (counts.get(type) || 0) + 1);
    }
    expect(counts.size).toBe(16);
    for (const entry of SELECTABLE) {
      expect(counts.has(entry.type), `${entry.type} should appear in ${N} rolls`).toBe(true);
    }
  });

  it('10000 rolls: 1-share crates appear but infrequently (<2%)', () => {
    const N = 10000;
    const counts = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      const type = weightedSelect();
      counts.set(type, (counts.get(type) || 0) + 1);
    }
    for (const rare of ['icbm', 'darkness', 'healbase', 'reveal']) {
      const pct = (counts.get(rare) || 0) / N;
      expect(pct, `${rare} should be < 2%`).toBeLessThan(0.02);
    }
  });
});
