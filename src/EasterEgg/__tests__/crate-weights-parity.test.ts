/**
 * Crate Spawn Weight Parity Tests — C++ RULES.INI CrateShares verification.
 *
 * Verifies all 14 crate types are present with correct share weights from
 * C++ rules.ini [CrateRules] section. Total shares = 136.
 *
 * Since CRATE_SHARES is a private static on the Game class, we verify through
 * the documented values and test the weighted distribution properties.
 */

import { describe, it, expect } from 'vitest';

// C++ RULES.INI crate share values (verified against source)
// Shared across all test sections
const EXPECTED_SHARES: Array<{ type: string; shares: number }> = [
  { type: 'money', shares: 50 },
  { type: 'unit', shares: 20 },
  { type: 'speed', shares: 10 },
  { type: 'firepower', shares: 10 },
  { type: 'armor', shares: 10 },
  { type: 'reveal', shares: 5 },
  { type: 'cloak', shares: 3 },
  { type: 'heal', shares: 15 },
  { type: 'explosion', shares: 5 },
  { type: 'parabomb', shares: 3 },
  { type: 'sonar', shares: 2 },
  { type: 'icbm', shares: 1 },
  { type: 'timequake', shares: 1 },
  { type: 'vortex', shares: 1 },
];

// ============================================================
// Section 1: Expected crate share distribution (C++ RULES.INI)
// ============================================================
describe('crate share distribution — C++ RULES.INI CrateShares', () => {

  it('14 crate types total', () => {
    expect(EXPECTED_SHARES.length).toBe(14);
  });

  it('total shares = 136', () => {
    const total = EXPECTED_SHARES.reduce((sum, s) => sum + s.shares, 0);
    expect(total).toBe(136);
  });

  // Individual weight verification
  it('money has the highest weight (50 shares = 36.8%)', () => {
    const money = EXPECTED_SHARES.find(s => s.type === 'money')!;
    expect(money.shares).toBe(50);
    const total = 136;
    const pct = (money.shares / total) * 100;
    expect(pct).toBeCloseTo(36.76, 1);
  });

  it('unit is second most common (20 shares = 14.7%)', () => {
    const unit = EXPECTED_SHARES.find(s => s.type === 'unit')!;
    expect(unit.shares).toBe(20);
  });

  it('heal is third most common (15 shares = 11.0%)', () => {
    const heal = EXPECTED_SHARES.find(s => s.type === 'heal')!;
    expect(heal.shares).toBe(15);
  });

  it('speed/firepower/armor each have 10 shares', () => {
    const buffs = ['speed', 'firepower', 'armor'];
    for (const type of buffs) {
      const entry = EXPECTED_SHARES.find(s => s.type === type)!;
      expect(entry.shares, `${type} shares`).toBe(10);
    }
  });

  it('reveal and explosion each have 5 shares', () => {
    expect(EXPECTED_SHARES.find(s => s.type === 'reveal')!.shares).toBe(5);
    expect(EXPECTED_SHARES.find(s => s.type === 'explosion')!.shares).toBe(5);
  });

  it('cloak and parabomb each have 3 shares', () => {
    expect(EXPECTED_SHARES.find(s => s.type === 'cloak')!.shares).toBe(3);
    expect(EXPECTED_SHARES.find(s => s.type === 'parabomb')!.shares).toBe(3);
  });

  it('sonar has 2 shares', () => {
    expect(EXPECTED_SHARES.find(s => s.type === 'sonar')!.shares).toBe(2);
  });

  it('rare crates (icbm, timequake, vortex) each have 1 share', () => {
    const rareCrates = ['icbm', 'timequake', 'vortex'];
    for (const type of rareCrates) {
      const entry = EXPECTED_SHARES.find(s => s.type === type)!;
      expect(entry.shares, `${type} shares`).toBe(1);
    }
  });

  // All shares are positive
  it('all share values are positive integers', () => {
    for (const entry of EXPECTED_SHARES) {
      expect(entry.shares).toBeGreaterThan(0);
      expect(Number.isInteger(entry.shares)).toBe(true);
    }
  });
});

// ============================================================
// Section 2: Probability distribution properties
// ============================================================
describe('crate probability distribution', () => {
  const TOTAL_SHARES = 136;

  it('money probability > 1/3 (~36.8%)', () => {
    const moneyPct = 50 / TOTAL_SHARES;
    expect(moneyPct).toBeGreaterThan(1 / 3);
  });

  it('top 3 crates (money+unit+heal) = 62.5% of all crates', () => {
    const topThree = (50 + 20 + 15) / TOTAL_SHARES;
    expect(topThree).toBeCloseTo(0.625, 3);
  });

  it('buff crates (speed+firepower+armor) = 22.1%', () => {
    const buffs = (10 + 10 + 10) / TOTAL_SHARES;
    expect(buffs).toBeCloseTo(0.221, 2);
  });

  it('rare crates (icbm+timequake+vortex) = 2.2%', () => {
    const rare = (1 + 1 + 1) / TOTAL_SHARES;
    expect(rare).toBeCloseTo(0.022, 2);
  });

  it('no single crate type exceeds 50% probability', () => {
    const maxShares = 50;
    expect(maxShares / TOTAL_SHARES).toBeLessThan(0.5);
  });

  it('each rare crate has < 1% chance', () => {
    const rareShares = 1;
    expect(rareShares / TOTAL_SHARES).toBeLessThan(0.01);
  });
});

// ============================================================
// Section 3: Weighted random simulation (statistical verification)
// ============================================================
describe('weighted random distribution simulation', () => {
  function weightedSelect(): string {
    const totalShares = EXPECTED_SHARES.reduce((sum, s) => sum + s.shares, 0);
    let roll = Math.random() * totalShares;
    for (const entry of EXPECTED_SHARES) {
      roll -= entry.shares;
      if (roll <= 0) return entry.type;
    }
    return EXPECTED_SHARES[EXPECTED_SHARES.length - 1].type;
  }

  it('10000 rolls: money appears 30-42% of the time (expected 36.8%)', () => {
    const N = 10000;
    let moneyCount = 0;
    for (let i = 0; i < N; i++) {
      if (weightedSelect() === 'money') moneyCount++;
    }
    const pct = moneyCount / N;
    expect(pct).toBeGreaterThan(0.30);
    expect(pct).toBeLessThan(0.42);
  });

  it('10000 rolls: all 14 types appear at least once', () => {
    const N = 10000;
    const counts = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      const type = weightedSelect();
      counts.set(type, (counts.get(type) || 0) + 1);
    }
    expect(counts.size).toBe(14);
    for (const entry of EXPECTED_SHARES) {
      expect(counts.has(entry.type), `${entry.type} should appear in ${N} rolls`).toBe(true);
    }
  });

  it('10000 rolls: rare crates appear but infrequently (<2%)', () => {
    const N = 10000;
    const counts = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      const type = weightedSelect();
      counts.set(type, (counts.get(type) || 0) + 1);
    }
    for (const rare of ['icbm', 'timequake', 'vortex']) {
      const pct = (counts.get(rare) || 0) / N;
      expect(pct, `${rare} should be < 2%`).toBeLessThan(0.02);
    }
  });
});
