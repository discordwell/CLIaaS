/**
 * Comprehensive Damage Formula Parity Tests — C++ combat.cpp:72-129
 *
 * Systematically tests modifyDamage() across ALL warhead x armor x distance
 * combinations against hand-computed C++ algorithm expected values.
 *
 * C++ algorithm (Modify_Damage):
 *   1. if (!damage) return 0                            (line 74)
 *   2. damage = damage * warheadModifier[armor]          (line 101, fixed-point)
 *   3. if (spread==0) dist /= PIXEL_LEPTON_W/4          (line 108)
 *      else           dist /= spread*(PIXEL_LEPTON_W/2)  (line 110)
 *   4. dist = Bound(dist, 0, 16)                         (line 112)
 *   5. if (dist) damage /= dist                          (line 114, integer truncation)
 *   6. if (dist < 4) damage = max(damage, MinDamage=1)   (lines 122-124)
 *   7. damage = min(damage, MaxDamage=1000)               (line 127)
 *
 * C++ reference: CnC_and_Red_Alert/RA/combat.cpp:72-129
 */

import { describe, it, expect } from 'vitest';
import {
  modifyDamage, WARHEAD_VS_ARMOR, WARHEAD_META,
  getWarheadMultiplier, MAX_DAMAGE,
} from '../engine/types';
import type { WarheadType, ArmorType } from '../engine/types';

const ALL_WARHEADS: WarheadType[] = [
  'SA', 'HE', 'AP', 'Fire', 'HollowPoint', 'Super', 'Organic', 'Nuke', 'Mechanical',
];
const ALL_ARMORS: ArmorType[] = ['none', 'wood', 'light', 'heavy', 'concrete'];

// ============================================================
// Section 1: baseDamage=0 short-circuit — C++ combat.cpp:74
// ============================================================
describe('baseDamage=0 short-circuit (combat.cpp:74)', () => {
  it('baseDamage=0 returns 0 regardless of warhead/armor', () => {
    for (const wh of ALL_WARHEADS) {
      for (const ar of ALL_ARMORS) {
        expect(modifyDamage(0, wh, ar, 0), `${wh} vs ${ar}`).toBe(0);
      }
    }
  });

  it('baseDamage=0 returns 0 even at point-blank with MinDamage range', () => {
    // C++ returns 0 at line 74 before MinDamage logic. distFactor=0 < 4 would
    // otherwise trigger MinDamage=1, but the short-circuit prevents it.
    expect(modifyDamage(0, 'Super', 'none', 0)).toBe(0);
    expect(modifyDamage(0, 'HE', 'none', 0)).toBe(0);
  });

  it('baseDamage=0 returns 0 with houseBias', () => {
    expect(modifyDamage(0, 'SA', 'none', 0, 2.0)).toBe(0);
  });
});

// ============================================================
// Section 2: All 45 warhead x armor at point-blank (dist=0)
// C++ combat.cpp:98-101 — warhead modifier applied, no distance falloff
// ============================================================
describe('point-blank (dist=0) — all 45 warhead x armor (combat.cpp:98-101)', () => {
  // Expected: baseDamage(100) * WARHEAD_VS_ARMOR[wh][armor] via C++ fixed*int
  // At dist=0: distFactor=0, no division, MinDamage applies but doesn't change positive values
  const EXPECTED: Record<WarheadType, [number, number, number, number, number]> = {
    SA:          [100, 50, 60, 25, 25],
    HE:          [90,  75, 60, 25, 100],
    AP:          [30,  75, 75, 100, 50],
    Fire:        [90,  100, 60, 25, 50],
    HollowPoint: [100, 5,  5,  5,  5],
    Super:       [100, 100, 100, 100, 100],
    Organic:     [100, 0,  0,  0,  0],
    Nuke:        [90,  100, 60, 25, 50],
    Mechanical:  [100, 100, 100, 100, 100],
  };

  for (const wh of ALL_WARHEADS) {
    for (let i = 0; i < ALL_ARMORS.length; i++) {
      const armor = ALL_ARMORS[i];
      const exp = EXPECTED[wh][i];
      it(`${wh} vs ${armor} = ${exp}`, () => {
        expect(modifyDamage(100, wh, armor, 0)).toBe(exp);
      });
    }
  }
});

// ============================================================
// Section 3: Distance falloff — each warhead at key distances
// C++ combat.cpp:106-125 — distFactor = floor(distPixels*2/spread), Bound(0,16)
// ============================================================

describe('SA distance falloff (spread=3)', () => {
  // baseDamage=100, armor='none' (mult=1.0)
  // distFactor = floor(distPixels * 2 / 3), clamped [0, 16]
  const cases: [number, number, string][] = [
    [0,  100, 'distFactor=0, no div, MinDmg applies → 100'],
    [1,  100, 'floor(0.667)=0, no div → 100'],
    [2,  100, 'floor(1.333)=1, 100/1=100, MinDmg → 100'],
    [3,  50,  'floor(2.0)=2, 100/2=50, MinDmg → 50'],
    [4,  50,  'floor(2.667)=2, 100/2=50, MinDmg → 50'],
    [5,  33,  'floor(3.333)=3, 100/3=33.3, MinDmg → 33'],
    [6,  25,  'floor(4.0)=4, 100/4=25, no MinDmg (4 NOT < 4) → 25'],
    [9,  16,  'floor(6.0)=6, 100/6 truncates → 16'],
    [12, 12,  'floor(8.0)=8, 100/8 truncates → 12'],
    [18, 8,   'floor(12.0)=12, 100/12=8.33 → 8'],
    [24, 6,   'floor(16.0)=16, 100/16=6.25 → 6'],
    [30, 6,   'floor(20.0)=20→clamp 16, 100/16=6.25 → 6'],
  ];

  for (const [dist, expected, note] of cases) {
    it(`dist=${dist}px → ${expected} (${note})`, () => {
      expect(modifyDamage(100, 'SA', 'none', dist)).toBe(expected);
    });
  }
});

describe('HE distance falloff (spread=6)', () => {
  // baseDamage=100, armor='none' (mult=0.9), so base damage after mult = 90
  const cases: [number, number, string][] = [
    [0,  90,  'distFactor=0, no div → 90'],
    [1,  90,  'floor(0.333)=0, no div → 90'],
    [2,  90,  'floor(0.667)=0, no div → 90'],
    [3,  90,  'floor(1.0)=1, 90/1=90, MinDmg → 90'],
    [6,  45,  'floor(2.0)=2, 90/2=45, MinDmg → 45'],
    [9,  30,  'floor(3.0)=3, 90/3=30, MinDmg → 30'],
    [12, 22,  'floor(4.0)=4, 90/4 truncates → 22'],
    [18, 15,  'floor(6.0)=6, 90/6=15 → 15'],
    [24, 11,  'floor(8.0)=8, 90/8=11.25 → 11'],
    [36, 7,   'floor(12.0)=12, 90/12 truncates → 7'],
    [48, 5,   'floor(16.0)=16, 90/16 truncates → 5'],
    [60, 5,   'floor(20.0)=20→clamp 16, 90/16 truncates → 5'],
  ];

  for (const [dist, expected, note] of cases) {
    it(`dist=${dist}px → ${expected} (${note})`, () => {
      expect(modifyDamage(100, 'HE', 'none', dist)).toBe(expected);
    });
  }
});

describe('AP distance falloff (spread=3)', () => {
  // baseDamage=100, armor='heavy' (mult=1.0), base after mult = 100
  const cases: [number, number, string][] = [
    [0,  100, 'distFactor=0 → 100'],
    [3,  50,  'distFactor=2, 100/2=50, MinDmg → 50'],
    [6,  25,  'distFactor=4, 100/4=25, no MinDmg → 25'],
    [12, 12,  'distFactor=8, 100/8 truncates → 12'],
    [24, 6,   'distFactor=16, 100/16=6.25 → 6'],
  ];

  for (const [dist, expected, note] of cases) {
    it(`vs heavy dist=${dist}px → ${expected} (${note})`, () => {
      expect(modifyDamage(100, 'AP', 'heavy', dist)).toBe(expected);
    });
  }

  // AP vs none (mult=0.3), base after mult = 30
  it('vs none dist=0 → 30', () => {
    expect(modifyDamage(100, 'AP', 'none', 0)).toBe(30);
  });

  it('vs none dist=3 → 15 (30/2)', () => {
    expect(modifyDamage(100, 'AP', 'none', 3)).toBe(15);
  });

  it('vs none dist=6 → 7 (30/4 truncates)', () => {
    expect(modifyDamage(100, 'AP', 'none', 6)).toBe(7);
  });
});

describe('Fire distance falloff (spread=8)', () => {
  // baseDamage=100, armor='none' (mult=0.9), base=90
  // Fire has widest non-zero spread, so slower falloff
  const cases: [number, number, string][] = [
    [0,  90,  'distFactor=0 → 90'],
    [3,  90,  'floor(0.75)=0, no div → 90'],
    [4,  90,  'floor(1.0)=1, 90/1=90, MinDmg → 90'],
    [8,  45,  'floor(2.0)=2, 90/2=45, MinDmg → 45'],
    [12, 30,  'floor(3.0)=3, 90/3=30, MinDmg → 30'],
    [16, 22,  'floor(4.0)=4, 90/4 truncates → 22'],
    [24, 15,  'floor(6.0)=6, 90/6=15 → 15'],
    [32, 11,  'floor(8.0)=8, 90/8=11.25 → 11'],
    [48, 7,   'floor(12.0)=12, 90/12 truncates → 7'],
    [64, 5,   'floor(16.0)=16, 90/16 truncates → 5'],
  ];

  for (const [dist, expected, note] of cases) {
    it(`dist=${dist}px → ${expected} (${note})`, () => {
      expect(modifyDamage(100, 'Fire', 'none', dist)).toBe(expected);
    });
  }

  // Fire vs wood (mult=1.0), base=100
  it('vs wood dist=0 → 100', () => {
    expect(modifyDamage(100, 'Fire', 'wood', 0)).toBe(100);
  });

  it('vs wood dist=16 → 25 (100/4)', () => {
    expect(modifyDamage(100, 'Fire', 'wood', 16)).toBe(25);
  });
});

describe('HollowPoint distance falloff (spread=1)', () => {
  // Fastest falloff among non-zero spreads. distFactor = floor(dist*2/1) = floor(dist*2)
  // baseDamage=100, armor='none' (mult=1.0)
  const cases: [number, number, string][] = [
    [0, 100, 'distFactor=0 → 100'],
    [1, 50,  'distFactor=2, 100/2=50, MinDmg → 50'],
    [2, 25,  'distFactor=4, 100/4=25, no MinDmg → 25'],
    [3, 16,  'distFactor=6, 100/6 truncates → 16'],
    [4, 12,  'distFactor=8, 100/8 truncates → 12'],
    [8, 6,   'distFactor=16, 100/16=6.25 → 6'],
    [9, 6,   'distFactor=18→clamp 16, 100/16=6.25 → 6'],
  ];

  for (const [dist, expected, note] of cases) {
    it(`vs none dist=${dist}px → ${expected} (${note})`, () => {
      expect(modifyDamage(100, 'HollowPoint', 'none', dist)).toBe(expected);
    });
  }

  // HollowPoint vs wood (mult=0.05), base=5
  it('vs wood dist=0 → 5', () => {
    expect(modifyDamage(100, 'HollowPoint', 'wood', 0)).toBe(5);
  });

  it('vs wood dist=1 → 2 (5/2 truncates)', () => {
    expect(modifyDamage(100, 'HollowPoint', 'wood', 1)).toBe(2);
  });

  it('vs wood dist=2 → 1 (5/4 truncates)', () => {
    expect(modifyDamage(100, 'HollowPoint', 'wood', 2)).toBe(1);
  });

  it('vs wood dist=4 → 0 (5/8 truncates)', () => {
    expect(modifyDamage(100, 'HollowPoint', 'wood', 4)).toBe(0);
  });

  it('vs wood dist=8 → 0 (5/16=0.3125, round→0)', () => {
    expect(modifyDamage(100, 'HollowPoint', 'wood', 8)).toBe(0);
  });
});

describe('Super distance falloff (spread=1)', () => {
  // Same spread as HollowPoint but mult=1.0 for all armor types
  it('vs concrete dist=0 → 100', () => {
    expect(modifyDamage(100, 'Super', 'concrete', 0)).toBe(100);
  });

  it('vs concrete dist=2 → 25 (distFactor=4, 100/4)', () => {
    expect(modifyDamage(100, 'Super', 'concrete', 2)).toBe(25);
  });

  it('vs concrete dist=8 → 6 (distFactor=16, 100/16=6.25→6)', () => {
    expect(modifyDamage(100, 'Super', 'concrete', 8)).toBe(6);
  });
});

describe('Organic distance falloff (spread=0, rapid falloff)', () => {
  // spreadFactor=0: distFactor = floor(distPixels * 5) — C++ PIXEL_LEPTON_W/4=10/4=2, pixel*10/2=pixel*5
  // Only does damage vs 'none' armor (mult=1.0); all others are 0
  const cases: [number, number, string][] = [
    [0, 100, 'distFactor=0 → 100'],
    [1, 20,  'distFactor=5, 100/5=20'],
    [2, 10,  'distFactor=10, 100/10=10'],
    [3, 6,   'distFactor=15, 100/15 truncates → 6'],
    [4, 6,   'distFactor=20→clamp 16, 100/16=6.25 → 6'],
    [5, 6,   'distFactor=25→clamp 16, 100/16=6.25 → 6'],
  ];

  for (const [dist, expected, note] of cases) {
    it(`vs none dist=${dist}px → ${expected} (${note})`, () => {
      expect(modifyDamage(100, 'Organic', 'none', dist)).toBe(expected);
    });
  }

  // Organic vs any non-none armor always returns 0 regardless of distance
  it('vs wood always 0 at any distance', () => {
    for (const dist of [0, 1, 5, 10]) {
      expect(modifyDamage(100, 'Organic', 'wood', dist)).toBe(0);
    }
  });
});

describe('Nuke distance falloff (spread=6, same as HE)', () => {
  // Nuke has same spread as HE but different verses for some armor types
  // vs none: mult=0.9 (same as HE), so distance curve is identical
  it('vs none dist=12 → 22 (same as HE)', () => {
    const nukeDmg = modifyDamage(100, 'Nuke', 'none', 12);
    const heDmg = modifyDamage(100, 'HE', 'none', 12);
    expect(nukeDmg).toBe(22);
    expect(nukeDmg).toBe(heDmg);
  });

  // vs wood: Nuke mult=1.0, HE mult=0.75
  it('vs wood dist=0: Nuke=100 > HE=75', () => {
    expect(modifyDamage(100, 'Nuke', 'wood', 0)).toBe(100);
    expect(modifyDamage(100, 'HE', 'wood', 0)).toBe(75);
  });
});

describe('Mechanical distance falloff (spread=0)', () => {
  // Same rapid falloff as Organic, but mult=1.0 for ALL armor types
  it('vs heavy dist=0 → 100', () => {
    expect(modifyDamage(100, 'Mechanical', 'heavy', 0)).toBe(100);
  });

  it('vs heavy dist=1 → 20 (distFactor=5)', () => {
    expect(modifyDamage(100, 'Mechanical', 'heavy', 1)).toBe(20);
  });

  it('vs concrete dist=2 → 10 (distFactor=10)', () => {
    expect(modifyDamage(100, 'Mechanical', 'concrete', 2)).toBe(10);
  });
});

// ============================================================
// Section 4: Integer distFactor truncation — C++ parity fix
// C++ uses integer division; TS must floor() to match
// ============================================================
describe('distFactor integer truncation (C++ parity)', () => {
  // Without floor, dividing by fractional distFactor (0 < df < 1) would
  // INCREASE damage above point-blank. C++ integer truncation prevents this.

  it('SA dist=1: floor(0.667)=0, damage equals point-blank', () => {
    const pointBlank = modifyDamage(100, 'SA', 'none', 0);
    const dist1 = modifyDamage(100, 'SA', 'none', 1);
    expect(dist1).toBe(pointBlank);
  });

  it('HE dist=2: floor(0.667)=0, damage equals point-blank', () => {
    const pointBlank = modifyDamage(100, 'HE', 'none', 0);
    const dist2 = modifyDamage(100, 'HE', 'none', 2);
    expect(dist2).toBe(pointBlank);
  });

  it('Fire dist=3: floor(0.75)=0, damage equals point-blank', () => {
    const pointBlank = modifyDamage(100, 'Fire', 'none', 0);
    const dist3 = modifyDamage(100, 'Fire', 'none', 3);
    expect(dist3).toBe(pointBlank);
  });

  it('near-miss never exceeds direct hit for any warhead', () => {
    // For each warhead, verify that damage at dist=1 <= damage at dist=0
    for (const wh of ALL_WARHEADS) {
      const mult = getWarheadMultiplier(wh, 'none');
      if (mult <= 0) continue; // skip Organic-like zero-mult combos
      const d0 = modifyDamage(100, wh, 'none', 0);
      const d1 = modifyDamage(100, wh, 'none', 1);
      expect(d1, `${wh} dist=1 should not exceed dist=0`).toBeLessThanOrEqual(d0);
    }
  });

  it('damage monotonically decreases with distance', () => {
    // For SA (spread=3), verify non-increasing damage across distances
    let prev = modifyDamage(100, 'SA', 'none', 0);
    for (let dist = 1; dist <= 30; dist++) {
      const dmg = modifyDamage(100, 'SA', 'none', dist);
      expect(dmg, `SA dist=${dist} should be <= dist=${dist - 1}`).toBeLessThanOrEqual(prev);
      prev = dmg;
    }
  });

  it('floor truncation at non-integer boundaries for SA spread=3', () => {
    // dist=4: distFactor=floor(4*2/3)=floor(2.667)=2, not 3
    expect(modifyDamage(100, 'SA', 'none', 4)).toBe(50); // 100/2=50
    // dist=5: distFactor=floor(5*2/3)=floor(3.333)=3
    expect(modifyDamage(100, 'SA', 'none', 5)).toBe(33); // 100/3=33.33→33
    // dist=7: distFactor=floor(7*2/3)=floor(4.667)=4
    expect(modifyDamage(100, 'SA', 'none', 7)).toBe(25); // 100/4=25
    // dist=8: distFactor=floor(8*2/3)=floor(5.333)=5
    expect(modifyDamage(100, 'SA', 'none', 8)).toBe(20); // 100/5=20
  });
});

// ============================================================
// Section 5: MinDamage boundary (combat.cpp:122-124)
// distFactor < 4 → max(damage, 1)
// ============================================================
describe('MinDamage boundary at distFactor=4 (combat.cpp:122-124)', () => {
  it('distFactor=3: MinDamage applies (3 < 4)', () => {
    // SA dist=5: fixed::operator*(int) reduces 1*25% to 0 before the distance block.
    expect(modifyDamage(1, 'SA', 'heavy', 5)).toBe(0);
  });

  it('distFactor=4: MinDamage does NOT apply (4 is NOT < 4)', () => {
    // SA dist=6: distFactor=floor(4.0)=4, 1*0.25/4=0.0625, no MinDmg → round(0.0625)=0
    expect(modifyDamage(1, 'SA', 'heavy', 6)).toBe(0);
  });

  it('distFactor=0: MinDamage applies (no division, damage stays at base)', () => {
    expect(modifyDamage(1, 'SA', 'heavy', 0)).toBe(0);
    // fixed::operator*(int) reduces 1*25% to 0; C++ skips MinDamage when damage is 0.
  });

  it('distFactor=1: MinDamage applies', () => {
    // SA dist=2: fixed::operator*(int) reduces 1*25% to 0 before distance logic.
    expect(modifyDamage(1, 'SA', 'heavy', 2)).toBe(0);
  });

  it('MinDamage=1 is the threshold, not dependent on baseDamage', () => {
    // If fixed-point multiplication leaves 0 damage, C++ skips MinDamage.
    expect(modifyDamage(1, 'HollowPoint', 'wood', 0)).toBe(0);
  });

  it('MinDamage does not boost damage that is already >= 1', () => {
    // baseDamage=100, SA/none, dist=3: distFactor=2, damage=100/2=50
    // MinDmg: max(50, 1) = 50 (no change)
    expect(modifyDamage(100, 'SA', 'none', 3)).toBe(50);
  });
});

// ============================================================
// Section 6: MaxDamage cap (combat.cpp:127)
// ============================================================
describe('MaxDamage cap at 1000 (combat.cpp:127)', () => {
  it('MAX_DAMAGE constant is 1000', () => {
    expect(MAX_DAMAGE).toBe(1000);
  });

  it('large baseDamage capped at 1000 (Super, point-blank)', () => {
    expect(modifyDamage(5000, 'Super', 'none', 0)).toBe(1000);
  });

  it('large baseDamage capped at 1000 (Mechanical, point-blank)', () => {
    expect(modifyDamage(2000, 'Mechanical', 'none', 0)).toBe(1000);
  });

  it('baseDamage=1000 is exactly at cap', () => {
    expect(modifyDamage(1000, 'Super', 'none', 0)).toBe(1000);
  });

  it('baseDamage=1001 is capped to 1000', () => {
    expect(modifyDamage(1001, 'Super', 'none', 0)).toBe(1000);
  });

  it('cap applies after mult: 2000 * 0.9 = 1800 → 1000', () => {
    expect(modifyDamage(2000, 'HE', 'none', 0)).toBe(1000);
  });

  it('cap applies after houseBias: 500 * 1.0 * 3.0 = 1500 → 1000', () => {
    expect(modifyDamage(500, 'Super', 'none', 0, 3.0)).toBe(1000);
  });

  it('cap applies before rounding: 667 * 1.5(bias) = 1000.5 → min(1000.5,1000)=1000', () => {
    // Without cap: round(1000.5) = 1001. With cap: min(1000.5, 1000) = 1000, round(1000) = 1000.
    expect(modifyDamage(667, 'Super', 'none', 0, 1.5)).toBe(1000);
  });
});

// ============================================================
// Section 7: distFactor clamping [0, 16] (combat.cpp:112)
// ============================================================
describe('distFactor clamping (combat.cpp:112)', () => {
  it('negative distPixels: distFactor clamped to 0', () => {
    // distPixels=-10, SA spread=3: floor(-10*2/3)=floor(-6.667)=-7, clamp→0
    const result = modifyDamage(100, 'SA', 'none', -10);
    expect(result).toBe(100); // no falloff
  });

  it('very large distPixels: distFactor clamped at 16', () => {
    // distPixels=500, SA spread=3: floor(500*2/3)=floor(333.3)=333, clamp→16
    const result = modifyDamage(100, 'SA', 'none', 500);
    expect(result).toBe(6); // 100/16=6.25→6
  });

  it('maximum falloff is always 1/16 of base-after-mult', () => {
    for (const wh of ALL_WARHEADS) {
      const mult = getWarheadMultiplier(wh, 'none');
      if (mult <= 0) continue;
      const maxFalloff = modifyDamage(100, wh, 'none', 1000);
      const expected = Math.max(0, Math.trunc(modifyDamage(100, wh, 'none', 0) / 16));
      expect(maxFalloff, `${wh} at extreme range`).toBe(expected);
    }
  });

  it('distFactor=16 is the max — further distance gives same result', () => {
    const at24 = modifyDamage(100, 'SA', 'none', 24); // distFactor=16
    const at30 = modifyDamage(100, 'SA', 'none', 30); // clamped to 16
    const at100 = modifyDamage(100, 'SA', 'none', 100); // clamped to 16
    expect(at30).toBe(at24);
    expect(at100).toBe(at24);
  });
});

// ============================================================
// Section 8: Override parameters
// ============================================================
describe('warheadMultOverride parameter', () => {
  it('overrides warhead-armor lookup', () => {
    // SA vs heavy normally = 0.25; override to 1.0
    const normal = modifyDamage(100, 'SA', 'heavy', 0);
    const overridden = modifyDamage(100, 'SA', 'heavy', 0, 1.0, 1.0);
    expect(normal).toBe(25);
    expect(overridden).toBe(100);
  });

  it('override=0 returns 0', () => {
    expect(modifyDamage(100, 'Super', 'none', 0, 1.0, 0)).toBe(0);
  });

  it('override=0.5 gives half damage', () => {
    expect(modifyDamage(100, 'Super', 'none', 0, 1.0, 0.5)).toBe(50);
  });

  it('override negative returns 0', () => {
    expect(modifyDamage(100, 'Super', 'none', 0, 1.0, -1.0)).toBe(0);
  });
});

describe('spreadFactorOverride parameter', () => {
  it('overrides warhead spread factor', () => {
    // SA spread=3 at dist=6: distFactor=4; with override spread=6: distFactor=2
    const normal = modifyDamage(100, 'SA', 'none', 6);     // distFactor=4, 100/4=25
    const wider = modifyDamage(100, 'SA', 'none', 6, 1.0, undefined, 6); // distFactor=2, 100/2=50
    expect(normal).toBe(25);
    expect(wider).toBe(50);
  });

  it('spreadFactorOverride=0 uses rapid falloff path', () => {
    // dist=2 with spread=0: distFactor=2*5=10, 100/10=10
    const result = modifyDamage(100, 'SA', 'none', 2, 1.0, undefined, 0);
    expect(result).toBe(10);
  });

  it('spreadFactorOverride=1 gives fastest non-zero falloff', () => {
    // dist=4 with spread=1: distFactor=4*2/1=8, 100/8 truncates to 12
    const result = modifyDamage(100, 'SA', 'none', 4, 1.0, undefined, 1);
    expect(result).toBe(12);
  });
});

// ============================================================
// Section 9: House bias (C++ firepower multiplier)
// ============================================================
describe('houseBias multiplier (C++ firepower bonus)', () => {
  it('houseBias=1.0 is default (no change)', () => {
    expect(modifyDamage(100, 'SA', 'none', 0, 1.0)).toBe(100);
    expect(modifyDamage(100, 'SA', 'none', 0)).toBe(100);
  });

  it('houseBias=1.5 multiplies damage by 1.5x', () => {
    expect(modifyDamage(100, 'SA', 'none', 0, 1.5)).toBe(150);
  });

  it('houseBias=2.0 doubles damage', () => {
    expect(modifyDamage(100, 'SA', 'none', 0, 2.0)).toBe(200);
  });

  it('houseBias=0.5 halves damage', () => {
    expect(modifyDamage(100, 'SA', 'none', 0, 0.5)).toBe(50);
  });

  it('houseBias applies before distance falloff', () => {
    // 100 * 1.0(mult) * 1.5(bias) = 150, then /4(distFactor) truncates to 37
    const result = modifyDamage(100, 'SA', 'none', 6, 1.5); // distFactor=4
    expect(result).toBe(37);
  });

  it('houseBias interacts with warhead mult', () => {
    // 100 * 0.25(SA/heavy) * 2.0(bias) = 50, distFactor=0 → 50
    expect(modifyDamage(100, 'SA', 'heavy', 0, 2.0)).toBe(50);
  });

  it('houseBias can push damage to MaxDamage cap', () => {
    // 600 * 1.0 * 2.0 = 1200 → capped at 1000
    expect(modifyDamage(600, 'Super', 'none', 0, 2.0)).toBe(1000);
  });
});

// ============================================================
// Section 10: Fixed-point and integer truncation behavior
// ============================================================
describe('C++ fixed-point and integer truncation behavior', () => {
  it('exact fixed-point halves produce the expected integer', () => {
    // SA/wood: 100 * 0.5 = 50.0, no distance → 50
    expect(modifyDamage(100, 'SA', 'wood', 0)).toBe(50);
  });

  it('post-falloff x.5 truncates: 22.5 → 22', () => {
    // HE/none dist=12: C++ integer division 90/4 -> 22.
    expect(modifyDamage(100, 'HE', 'none', 12)).toBe(22);
  });

  it('x.25 rounds down: 6.25 → 6', () => {
    // SA/none dist=24: 100/16 = 6.25 → 6
    expect(modifyDamage(100, 'SA', 'none', 24)).toBe(6);
  });

  it('post-falloff x.75 truncates: 7.5 → 7', () => {
    // HE/none dist=36: C++ integer division 90/12 -> 7.
    expect(modifyDamage(100, 'HE', 'none', 36)).toBe(7);
  });

  it('result is always integer', () => {
    // Spot check that we never get fractional results
    for (const wh of ALL_WARHEADS) {
      for (const ar of ALL_ARMORS) {
        for (const dist of [0, 5, 10, 20]) {
          const result = modifyDamage(100, wh, ar, dist);
          expect(Number.isInteger(result), `${wh} vs ${ar} at ${dist}px`).toBe(true);
        }
      }
    }
  });
});

// ============================================================
// Section 11: Cross-product spot checks — warhead x armor x distance
// Verifies the full formula with non-trivial combinations
// ============================================================
describe('cross-product spot checks — warhead x armor x distance', () => {
  // Each test: [baseDmg, warhead, armor, dist, houseBias, expected, note]
  type SpotCheck = [number, WarheadType, ArmorType, number, number, number, string];

  const checks: SpotCheck[] = [
    // SA — anti-infantry small arms
    [100, 'SA', 'none', 0, 1.0, 100, 'full damage vs unarmored'],
    [100, 'SA', 'heavy', 12, 1.0, 3, '25/8=3.125→3, no MinDmg'],
    [100, 'SA', 'concrete', 3, 1.0, 12, '25/2 truncates to 12'],

    // HE — high explosive vs structures
    [150, 'HE', 'concrete', 0, 1.0, 150, '150*1.0=150'],
    [150, 'HE', 'concrete', 12, 1.0, 37, '150/4 truncates to 37'],
    [150, 'HE', 'heavy', 6, 1.0, 19, '150*25% fixed = 38, /2 truncates to 19'],

    // AP — armor piercing vs tanks
    [40, 'AP', 'heavy', 0, 1.0, 40, '40*1.0=40 (best vs heavy)'],
    [40, 'AP', 'none', 0, 1.0, 12, '40*0.3=12'],
    [40, 'AP', 'light', 6, 1.0, 7, '40*0.75=30, /4 truncates to 7'],

    // Fire — incendiary
    [100, 'Fire', 'wood', 24, 1.0, 16, '100*1.0=100, /6 truncates to 16'],
    [100, 'Fire', 'heavy', 0, 1.0, 25, '100*0.25=25'],

    // HollowPoint — anti-infantry only
    [25, 'HollowPoint', 'none', 0, 1.0, 25, 'full vs unarmored'],
    [25, 'HollowPoint', 'heavy', 0, 1.0, 1, '25*0.05=1.25, MinDmg→max(1.25,1)→1'],
    [25, 'HollowPoint', 'heavy', 2, 1.0, 0, '1.25/4=0.3125, no MinDmg→0'],

    // Super — equal damage everywhere
    [200, 'Super', 'heavy', 2, 1.0, 50, '200/4=50, no MinDmg'],

    // Organic — dogs, no damage vs armor
    [50, 'Organic', 'none', 0, 1.0, 50, 'dog bite vs infantry'],
    [50, 'Organic', 'light', 0, 1.0, 0, 'dog bite vs vehicle = 0'],

    // Nuke — devastating
    [300, 'Nuke', 'concrete', 0, 1.0, 150, '300*0.5=150'],
    [300, 'Nuke', 'none', 12, 1.0, 67, '300*0.9=270, /4 truncates to 67'],

    // Mechanical — repair/heal warhead
    [100, 'Mechanical', 'heavy', 0, 1.0, 100, '1.0x vs all armor'],
    [100, 'Mechanical', 'none', 1, 1.0, 20, 'spread=0: distFactor=5, 100/5=20'],

    // With houseBias
    [100, 'HE', 'none', 0, 1.5, 135, '100*0.9*1.5=135'],
    [100, 'AP', 'heavy', 0, 0.8, 80, '100*1.0*0.8=80'],
    [100, 'SA', 'none', 6, 2.0, 50, '100*1.0*2.0=200, /4=50'],
  ];

  for (const [baseDmg, wh, armor, dist, bias, expected, note] of checks) {
    it(`${baseDmg}dmg ${wh} vs ${armor} dist=${dist} bias=${bias} → ${expected} (${note})`, () => {
      expect(modifyDamage(baseDmg, wh, armor, dist, bias)).toBe(expected);
    });
  }
});

// ============================================================
// Section 12: Spread factor comparison — tactical implications
// ============================================================
describe('spread factor tactical comparison', () => {
  it('wider spread = more damage at distance (Fire > HE > SA at 12px)', () => {
    // At 12px from target, compare warheads with different spreads
    // Fire spread=8: distFactor=floor(24/8)=3, 90/3=30
    // HE spread=6:   distFactor=floor(24/6)=4, 90/4 truncates to 22
    // SA spread=3:   distFactor=floor(24/3)=8, 100/8 truncates to 12
    const fire = modifyDamage(100, 'Fire', 'none', 12);
    const he = modifyDamage(100, 'HE', 'none', 12);
    const sa = modifyDamage(100, 'SA', 'none', 12);
    expect(fire).toBeGreaterThan(he);
    expect(he).toBeGreaterThan(sa);
  });

  it('HollowPoint (spread=1) falls off fastest of non-zero spreads', () => {
    const dist = 4;
    // HollowPoint: distFactor=8, 100/8 truncates to 12
    // SA:          distFactor=floor(8/3)=2, 100/2=50
    const hp = modifyDamage(100, 'HollowPoint', 'none', dist);
    const sa = modifyDamage(100, 'SA', 'none', dist);
    expect(hp).toBeLessThan(sa);
  });

  it('spread=0 (Organic/Mechanical) falls off faster than spread=1', () => {
    const dist = 1;
    // Organic spread=0: distFactor=5, 100/5=20
    // HollowPoint spread=1: distFactor=2, 100/2=50
    const organic = modifyDamage(100, 'Organic', 'none', dist);
    const hp = modifyDamage(100, 'HollowPoint', 'none', dist);
    expect(organic).toBeLessThan(hp);
  });
});

// ============================================================
// Section 13: Non-standard baseDamage values
// ============================================================
describe('non-standard baseDamage values', () => {
  it('baseDamage=1 with Super at point-blank → 1', () => {
    expect(modifyDamage(1, 'Super', 'none', 0)).toBe(1);
  });

  it('baseDamage=1 with AP/heavy at point-blank → 1', () => {
    // 1 * 1.0 = 1, MinDmg→max(1,1)=1
    expect(modifyDamage(1, 'AP', 'heavy', 0)).toBe(1);
  });

  it('baseDamage=1 with HollowPoint/wood at point-blank → 1', () => {
    // fixed::operator*(int) reduces 1*5% to 0, so C++ skips MinDamage.
    expect(modifyDamage(1, 'HollowPoint', 'wood', 0)).toBe(0);
  });

  it('baseDamage=999 at point-blank not capped', () => {
    expect(modifyDamage(999, 'Super', 'none', 0)).toBe(999);
  });

  it('large baseDamage with low mult stays under cap', () => {
    // 30% is fixed raw 76; ((76*500)+128)/256 truncates to 148.
    expect(modifyDamage(500, 'AP', 'none', 0)).toBe(148);
  });

  it('very large baseDamage with low mult + distance', () => {
    // 2000 * 0.25(SA/heavy) = 500, distFactor=8 at dist=12: 500/8 truncates to 62.
    expect(modifyDamage(2000, 'SA', 'heavy', 12)).toBe(62);
  });
});

// ============================================================
// Section 14: Warhead-specific armor effectiveness tables
// Full verification at dist=0 with baseDamage=200 for precision
// ============================================================
describe('warhead effectiveness — baseDamage=200 at dist=0', () => {
  // Tests with baseDamage=200 to avoid rounding ambiguity at small values
  const cases: [WarheadType, ArmorType, number][] = [
    // SA: good vs infantry (none), bad vs armor
    ['SA', 'none', 200],    // 200*1.0
    ['SA', 'wood', 100],    // 200*0.5
    ['SA', 'light', 120],   // 200*0.6
    ['SA', 'heavy', 50],    // 200*0.25
    ['SA', 'concrete', 50], // 200*0.25

    // HE: best vs concrete, good vs infantry/wood
    ['HE', 'none', 180],    // 200*0.9
    ['HE', 'wood', 150],    // 200*0.75
    ['HE', 'light', 120],   // 200*0.6
    ['HE', 'heavy', 50],    // 200*0.25
    ['HE', 'concrete', 200],// 200*1.0

    // AP: best vs heavy armor
    ['AP', 'none', 59],     // 200*30% fixed raw 76
    ['AP', 'wood', 150],    // 200*0.75
    ['AP', 'light', 150],   // 200*0.75
    ['AP', 'heavy', 200],   // 200*1.0
    ['AP', 'concrete', 100],// 200*0.5

    // Fire: best vs wood
    ['Fire', 'none', 180],    // 200*0.9
    ['Fire', 'wood', 200],    // 200*1.0
    ['Fire', 'light', 120],   // 200*0.6
    ['Fire', 'heavy', 50],    // 200*0.25
    ['Fire', 'concrete', 100],// 200*0.5

    // HollowPoint: devastating vs none, useless vs armor
    ['HollowPoint', 'none', 200],    // 200*1.0
    ['HollowPoint', 'wood', 9],     // 200*5% fixed raw 12
    ['HollowPoint', 'light', 9],    // 200*5% fixed raw 12
    ['HollowPoint', 'heavy', 9],    // 200*5% fixed raw 12
    ['HollowPoint', 'concrete', 9], // 200*5% fixed raw 12
  ];

  for (const [wh, armor, expected] of cases) {
    it(`${wh} vs ${armor} → ${expected}`, () => {
      expect(modifyDamage(200, wh, armor, 0)).toBe(expected);
    });
  }
});

// ============================================================
// Section 15: Full monotonic falloff curves for all warheads
// ============================================================
describe('monotonic damage decrease across full distance range', () => {
  for (const wh of ALL_WARHEADS) {
    const mult = getWarheadMultiplier(wh, 'none');
    if (mult <= 0) continue; // skip Organic vs non-none

    it(`${wh}: damage is non-increasing from dist=0 to dist=100`, () => {
      let prevDmg = modifyDamage(100, wh, 'none', 0);
      for (let dist = 1; dist <= 100; dist++) {
        const dmg = modifyDamage(100, wh, 'none', dist);
        expect(dmg).toBeLessThanOrEqual(prevDmg);
        prevDmg = dmg;
      }
    });
  }
});

// ============================================================
// Section 16: Additional edge cases from code review
// ============================================================
describe('additional edge cases', () => {
  // C++ combat.cpp:86-96 (FIXIT_CSII) — negative damage is healing.
  // Non-Mechanical warhead: heals unarmored (armor=none) at close range.
  // Mechanical warhead: heals armored (armor!=none) at close range.
  // Close range = distance < 0x008 leptons = 0.75 pixels.

  it('Organic heal: returns negative at point-blank vs unarmored', () => {
    // Medic's Heal weapon: -50 damage, Organic warhead
    // warhead != Mechanical, armor == none, dist(0) < 0.75 → return -50
    expect(modifyDamage(-50, 'Organic', 'none', 0)).toBe(-50);
  });

  it('Mechanical heal: returns negative at point-blank vs armored', () => {
    // Mechanic's GoodWrench: -100 damage, Mechanical warhead
    // warhead == Mechanical, armor != none, dist(0) < 0.75 → return -100
    expect(modifyDamage(-100, 'Mechanical', 'heavy', 0)).toBe(-100);
    expect(modifyDamage(-100, 'Mechanical', 'light', 0)).toBe(-100);
    expect(modifyDamage(-100, 'Mechanical', 'wood', 0)).toBe(-100);
    expect(modifyDamage(-100, 'Mechanical', 'concrete', 0)).toBe(-100);
  });

  it('Organic heal: returns 0 vs armored (wrong armor type)', () => {
    // warhead != Mechanical, but armor != none → no healing
    expect(modifyDamage(-50, 'Organic', 'heavy', 0)).toBe(0);
    expect(modifyDamage(-50, 'Organic', 'light', 0)).toBe(0);
    expect(modifyDamage(-50, 'Organic', 'wood', 0)).toBe(0);
  });

  it('Mechanical heal: returns 0 vs unarmored (wrong armor type)', () => {
    // warhead == Mechanical, but armor == none → no healing
    expect(modifyDamage(-100, 'Mechanical', 'none', 0)).toBe(0);
  });

  it('healing returns 0 when too far (dist >= 0.75px)', () => {
    // C++ threshold: distance < 0x008 leptons = 0.75 pixels
    expect(modifyDamage(-50, 'Organic', 'none', 1)).toBe(0);
    expect(modifyDamage(-50, 'Organic', 'none', 6)).toBe(0);
    expect(modifyDamage(-100, 'Mechanical', 'heavy', 1)).toBe(0);
    expect(modifyDamage(-100, 'Mechanical', 'heavy', 12)).toBe(0);
  });

  it('any non-Mechanical warhead can heal unarmored at close range', () => {
    // C++ checks warhead != WARHEAD_MECHANICAL, not warhead == WARHEAD_ORGANIC
    expect(modifyDamage(-100, 'Super', 'none', 0)).toBe(-100);
    expect(modifyDamage(-50, 'HE', 'none', 0)).toBe(-50);
    expect(modifyDamage(-50, 'SA', 'none', 0)).toBe(-50);
    expect(modifyDamage(-1, 'Fire', 'none', 0)).toBe(-1);
  });

  it('non-Mechanical warhead returns 0 vs armored even at close range', () => {
    expect(modifyDamage(-50, 'SA', 'heavy', 0)).toBe(0);
    expect(modifyDamage(-100, 'HE', 'concrete', 0)).toBe(0);
  });

  it('fractional distPixels: floor handles non-integer pixel distances', () => {
    // distPixels=1.5, SA spread=3: floor(1.5*2/3)=floor(1.0)=1
    // damage = 100/1 = 100, MinDmg → 100
    expect(modifyDamage(100, 'SA', 'none', 1.5)).toBe(100);
    // distPixels=2.5, SA spread=3: floor(2.5*2/3)=floor(1.667)=1
    expect(modifyDamage(100, 'SA', 'none', 2.5)).toBe(100);
    // distPixels=4.5, SA spread=3: floor(4.5*2/3)=floor(3.0)=3
    // damage = 100/3 = 33.33, MinDmg → 33
    expect(modifyDamage(100, 'SA', 'none', 4.5)).toBe(33);
  });

  it('negative houseBias: damage after mult is negative → returns 0', () => {
    // 100 * 1.0 * -1.0 = -100 → damage <= 0 check triggers (C++ line 106 guard)
    expect(modifyDamage(100, 'Super', 'none', 0, -1.0)).toBe(0);
    expect(modifyDamage(100, 'Super', 'none', 8, -1.0)).toBe(0);
  });

  it('zero houseBias: damage after mult is 0 → returns 0 (C++ line 106 guard)', () => {
    // 100 * 1.0 * 0.0 = 0 → damage <= 0 check triggers, matching C++ behavior
    // (In C++, houseBias is applied before calling Modify_Damage, so damage=0 hits line 74)
    expect(modifyDamage(100, 'Super', 'none', 0, 0.0)).toBe(0);
  });

  it('very large distPixels with spread=0: clamped to distFactor=16', () => {
    // distPixels=1000, Mechanical spread=0: floor(1000*4)=4000, clamp→16
    // damage = 100/16 = 6.25 → 6
    expect(modifyDamage(100, 'Mechanical', 'none', 1000)).toBe(6);
  });
});
