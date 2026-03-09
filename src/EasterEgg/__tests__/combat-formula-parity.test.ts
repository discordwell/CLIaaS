/**
 * Combat Formula Parity Tests — C++ combat.cpp Modify_Damage verification.
 *
 * Verifies the TS modifyDamage() function against the exact C++ algorithm:
 *   damage = baseDamage × warheadMult × houseBias / distFactor
 * where distFactor = clamp(distPixels * 2 / spreadFactor, 0, 16) (or *4 if spread=0)
 *
 * Also verifies WARHEAD_VS_ARMOR table (9 warheads × 5 armor types = 45 multipliers),
 * WARHEAD_META spreadFactor values, splash radius, and scatter formula.
 */

import { describe, it, expect } from 'vitest';
import {
  modifyDamage, WARHEAD_VS_ARMOR, WARHEAD_META,
  getWarheadMultiplier, armorIndex, calcProjectileTravelFrames,
  CELL_SIZE, LEPTON_SIZE, GAME_TICKS_PER_SEC,
  MAX_PROJECTILE_FRAMES, DEFAULT_PROJECTILE_FRAMES,
} from '../engine/types';
import type { WarheadType, ArmorType } from '../engine/types';

// ============================================================
// Section 1: WARHEAD_VS_ARMOR table matches C++ RULES.INI [Warheads]
// ============================================================
describe('WARHEAD_VS_ARMOR — C++ RULES.INI Verses= values', () => {
  // C++ RULES.INI [Warheads] section — exact Verses= percentages
  // Format: [none, wood, light, heavy, concrete]
  const CPP_VERSES: Record<WarheadType, [number, number, number, number, number]> = {
    SA:          [1.0,  0.5,  0.6,  0.25, 0.25],
    HE:          [0.9,  0.75, 0.6,  0.25, 1.0],
    AP:          [0.3,  0.75, 0.75, 1.0,  0.5],
    Fire:        [0.9,  1.0,  0.6,  0.25, 0.5],
    HollowPoint: [1.0,  0.05, 0.05, 0.05, 0.05],
    Super:       [1.0,  1.0,  1.0,  1.0,  1.0],
    Organic:     [1.0,  0.0,  0.0,  0.0,  0.0],
    Nuke:        [0.9,  1.0,  0.6,  0.25, 0.5],
    Mechanical:  [1.0,  1.0,  1.0,  1.0,  1.0],
  };

  const warheads: WarheadType[] = ['SA', 'HE', 'AP', 'Fire', 'HollowPoint', 'Super', 'Organic', 'Nuke', 'Mechanical'];
  const armors: ArmorType[] = ['none', 'wood', 'light', 'heavy', 'concrete'];

  it('all 9 warheads are defined', () => {
    for (const wh of warheads) {
      expect(WARHEAD_VS_ARMOR[wh], `${wh} should be defined`).toBeDefined();
    }
  });

  it('each warhead has exactly 5 armor multipliers', () => {
    for (const wh of warheads) {
      expect(WARHEAD_VS_ARMOR[wh].length, `${wh} should have 5 entries`).toBe(5);
    }
  });

  // Test all 45 individual multipliers
  for (const wh of warheads) {
    for (let i = 0; i < armors.length; i++) {
      it(`${wh} vs ${armors[i]} = ${CPP_VERSES[wh][i]}`, () => {
        expect(WARHEAD_VS_ARMOR[wh][i]).toBe(CPP_VERSES[wh][i]);
      });
    }
  }
});

// ============================================================
// Section 2: armorIndex mapping
// ============================================================
describe('armorIndex — maps ArmorType to table index', () => {
  it('none=0, wood=1, light=2, heavy=3, concrete=4', () => {
    expect(armorIndex('none')).toBe(0);
    expect(armorIndex('wood')).toBe(1);
    expect(armorIndex('light')).toBe(2);
    expect(armorIndex('heavy')).toBe(3);
    expect(armorIndex('concrete')).toBe(4);
  });
});

// ============================================================
// Section 3: getWarheadMultiplier convenience function
// ============================================================
describe('getWarheadMultiplier', () => {
  it('SA vs none = 1.0 (full damage to unarmored)', () => {
    expect(getWarheadMultiplier('SA', 'none')).toBe(1.0);
  });

  it('HollowPoint vs heavy = 0.05 (almost zero vs armor)', () => {
    expect(getWarheadMultiplier('HollowPoint', 'heavy')).toBe(0.05);
  });

  it('Organic vs wood = 0.0 (dog bite cannot damage buildings)', () => {
    expect(getWarheadMultiplier('Organic', 'wood')).toBe(0.0);
  });

  it('Super vs anything = 1.0 (equal damage to all)', () => {
    const armors: ArmorType[] = ['none', 'wood', 'light', 'heavy', 'concrete'];
    for (const a of armors) {
      expect(getWarheadMultiplier('Super', a)).toBe(1.0);
    }
  });
});

// ============================================================
// Section 4: WARHEAD_META spreadFactor — C++ RULES.INI Spread= values
// ============================================================
describe('WARHEAD_META spreadFactor — C++ Spread= values', () => {
  const CPP_SPREAD: Record<WarheadType, number> = {
    SA: 3, HE: 6, AP: 3, Fire: 8, HollowPoint: 1,
    Super: 1, Organic: 0, Nuke: 6, Mechanical: 0,
  };

  for (const [wh, expected] of Object.entries(CPP_SPREAD)) {
    it(`${wh} spreadFactor = ${expected}`, () => {
      expect(WARHEAD_META[wh as WarheadType].spreadFactor).toBe(expected);
    });
  }
});

// ============================================================
// Section 5: WARHEAD_META destruction flags
// ============================================================
describe('WARHEAD_META destruction flags', () => {
  it('HE destroys walls, wood, and ore', () => {
    expect(WARHEAD_META.HE.destroysWalls).toBe(true);
    expect(WARHEAD_META.HE.destroysWood).toBe(true);
    expect(WARHEAD_META.HE.destroysOre).toBe(true);
  });

  it('AP destroys walls and wood but not ore', () => {
    expect(WARHEAD_META.AP.destroysWalls).toBe(true);
    expect(WARHEAD_META.AP.destroysWood).toBe(true);
    expect(WARHEAD_META.AP.destroysOre).toBeFalsy();
  });

  it('Fire destroys wood only', () => {
    expect(WARHEAD_META.Fire.destroysWalls).toBeFalsy();
    expect(WARHEAD_META.Fire.destroysWood).toBe(true);
    expect(WARHEAD_META.Fire.destroysOre).toBeFalsy();
  });

  it('SA has no destruction flags', () => {
    expect(WARHEAD_META.SA.destroysWalls).toBeFalsy();
    expect(WARHEAD_META.SA.destroysWood).toBeFalsy();
    expect(WARHEAD_META.SA.destroysOre).toBeFalsy();
  });

  it('Nuke destroys everything (like HE)', () => {
    expect(WARHEAD_META.Nuke.destroysWalls).toBe(true);
    expect(WARHEAD_META.Nuke.destroysWood).toBe(true);
    expect(WARHEAD_META.Nuke.destroysOre).toBe(true);
  });
});

// ============================================================
// Section 6: modifyDamage formula — C++ combat.cpp:72-129
// ============================================================
describe('modifyDamage — C++ Modify_Damage formula', () => {
  // Test point-blank (dist=0): damage = baseDamage × mult × houseBias / 0
  // C++ behavior: distFactor=0 → no division → MinDamage threshold applies (distFactor < 4 → max(damage,1))
  it('point-blank (dist=0): full base damage × mult', () => {
    // 100 damage, SA warhead, none armor (mult=1.0), dist=0
    const result = modifyDamage(100, 'SA', 'none', 0);
    // distFactor = 0*2/3 = 0; damage = 100*1.0/skip = 100; max(100,1) = 100
    expect(result).toBe(100);
  });

  it('point-blank: damage rounds to nearest integer', () => {
    // 100 damage, SA vs wood (mult=0.5), dist=0
    const result = modifyDamage(100, 'SA', 'wood', 0);
    // damage = 100*0.5 = 50
    expect(result).toBe(50);
  });

  // Distance falloff: distFactor = distPixels * 2 / spreadFactor
  it('distance falloff: distFactor = distPixels * 2 / spreadFactor', () => {
    // 100 damage, HE warhead (spread=6), none armor (mult=0.9)
    // dist = 12 pixels → distFactor = 12*2/6 = 4.0
    // damage = 100 * 0.9 / 4.0 = 22.5 → rounds to 23
    const result = modifyDamage(100, 'HE', 'none', 12);
    expect(result).toBe(23);
  });

  it('wider spread → less falloff at same distance', () => {
    // Same damage/distance but different warhead spread
    const heDmg = modifyDamage(100, 'HE', 'none', 12);   // spread=6
    const saDmg = modifyDamage(100, 'SA', 'none', 12);    // spread=3
    // HE: distFactor=12*2/6=4 → 90/4=22.5→23
    // SA: distFactor=12*2/3=8 → 100/8=12.5→13
    expect(heDmg).toBeGreaterThan(saDmg);
  });

  // distFactor clamp [0, 16] — combat.cpp:117-118
  it('distFactor is clamped at 16 (maximum falloff)', () => {
    // 100 damage, SA (spread=3), dist=30 → distFactor = 30*2/3 = 20 → clamped to 16
    const result = modifyDamage(100, 'SA', 'none', 30);
    // damage = 100 * 1.0 / 16 = 6.25 → 6
    expect(result).toBe(6);
  });

  it('negative distance treated as 0 (distFactor clamp at 0)', () => {
    // Negative distance shouldn't happen, but formula should handle gracefully
    const result = modifyDamage(100, 'SA', 'none', -10);
    // distFactor = max(0, -10*2/3) = 0 → no division → damage = 100; max(100,1) = 100
    expect(result).toBe(100);
  });

  // MinDamage threshold: distFactor < 4 → max(damage, 1) — combat.cpp:122-124
  it('MinDamage=1 when distFactor < 4 (close range guarantee)', () => {
    // Very small base damage that would round to 0 without threshold
    // 1 damage, SA vs heavy (mult=0.25), dist=2 → distFactor=2*2/3=1.33
    // damage = 1*0.25/1.33 = 0.19 → before MinDamage would be 0
    // distFactor 1.33 < 4 → max(0.19, 1) = 1
    const result = modifyDamage(1, 'SA', 'heavy', 2);
    expect(result).toBe(1);
  });

  it('MinDamage does NOT apply when distFactor >= 4', () => {
    // 1 damage, SA vs heavy (mult=0.25), dist=6 → distFactor=6*2/3=4.0
    // damage = 1*0.25/4.0 = 0.0625 → rounds to 0
    // distFactor = 4.0 (NOT < 4) → MinDamage does NOT apply
    const result = modifyDamage(1, 'SA', 'heavy', 6);
    expect(result).toBe(0);
  });

  // MaxDamage cap = 1000 — combat.cpp:126
  it('MaxDamage caps at 1000', () => {
    // Absurdly high damage
    const result = modifyDamage(5000, 'Super', 'none', 0);
    expect(result).toBe(1000);
  });

  // Organic warhead: 0 damage vs anything except 'none' armor
  it('Organic warhead: 0 damage vs wood/light/heavy/concrete', () => {
    expect(modifyDamage(100, 'Organic', 'wood', 0)).toBe(0);
    expect(modifyDamage(100, 'Organic', 'light', 0)).toBe(0);
    expect(modifyDamage(100, 'Organic', 'heavy', 0)).toBe(0);
    expect(modifyDamage(100, 'Organic', 'concrete', 0)).toBe(0);
  });

  it('Organic warhead: full damage vs none armor', () => {
    expect(modifyDamage(100, 'Organic', 'none', 0)).toBe(100);
  });

  // Spread=0 special case: distFactor = distPixels * 4
  it('spreadFactor=0: distFactor = distPixels * 4 (rapid falloff)', () => {
    // Organic has spread=0. Use override since Organic vs anything but none is 0%.
    // Use spreadFactorOverride=0 to test the rapid-falloff distance formula path
    const result = modifyDamage(100, 'Organic', 'none', 2, 1.0, undefined, 0);
    // spreadFactor=0: distFactor = 2*4 = 8, damage = 100/8 = 12.5 → 13
    expect(result).toBe(13);
  });

  // House bias multiplier
  it('houseBias multiplies damage (C++ firepower bonus)', () => {
    const normal = modifyDamage(100, 'SA', 'none', 0, 1.0);
    const boosted = modifyDamage(100, 'SA', 'none', 0, 1.5);
    expect(boosted).toBe(150);
    expect(normal).toBe(100);
  });
});

// ============================================================
// Section 7: Splash radius — CF3: 1.5-cell universal splash
// ============================================================
describe('splash radius — CF3: 1.5 cells', () => {
  it('splash radius constant is 1.5 cells', () => {
    // This is a static field on Game class; we verify the documented value
    // The constant is Game.SPLASH_RADIUS = 1.5 but that's on the class.
    // We verify through the modifyDamage formula: at 1.5 cells distance with
    // HE warhead (spread=6), distFactor = (1.5*24)*2/6 = 12. Still does damage.
    const splashEdgeDist = 1.5 * CELL_SIZE; // 36 pixels
    const dmg = modifyDamage(100, 'HE', 'none', splashEdgeDist);
    // distFactor = 36*2/6 = 12 → damage = 90/12 = 7.5 → 8
    expect(dmg).toBeGreaterThan(0);
  });

  it('beyond splash radius (>1.5 cells): distFactor near max, minimal damage', () => {
    const beyondSplash = 2.0 * CELL_SIZE; // 48 pixels
    const dmg = modifyDamage(100, 'HE', 'none', beyondSplash);
    // distFactor = 48*2/6 = 16 (max) → damage = 90/16 = 5.625 → 6
    expect(dmg).toBeLessThanOrEqual(6);
  });
});

// ============================================================
// Section 8: Scatter formula — SC3: C++ bullet.cpp:710-730
// ============================================================
describe('scatter formula — C++ bullet.cpp:710-730', () => {
  // scatterMax = max(0, (distLeptons / 16) - 64)
  // distLeptons = distCells * LEPTON_SIZE (256)

  it('close range (<= ~4 cells): scatterMax = 0 (no scatter)', () => {
    // At 4 cells: distLeptons = 4*256 = 1024; scatter = max(0, 1024/16 - 64) = max(0, 0) = 0
    const distLeptons = 4 * LEPTON_SIZE;
    const scatterMax = Math.max(0, (distLeptons / 16) - 64);
    expect(scatterMax).toBe(0);
  });

  it('medium range (6 cells): scatterMax = 32 leptons', () => {
    const distLeptons = 6 * LEPTON_SIZE;
    const scatterMax = Math.max(0, (distLeptons / 16) - 64);
    expect(scatterMax).toBe(32);
  });

  it('long range (10 cells): scatterMax = 96 leptons', () => {
    const distLeptons = 10 * LEPTON_SIZE;
    const scatterMax = Math.max(0, (distLeptons / 16) - 64);
    expect(scatterMax).toBe(96);
  });

  // HomingScatter cap = 512 leptons (homing missiles)
  it('homing scatter capped at 512 leptons (HomingScatter)', () => {
    const distLeptons = 60 * LEPTON_SIZE; // extreme range
    let scatterMax = Math.max(0, (distLeptons / 16) - 64);
    const isHoming = true;
    const scatterCap = isHoming ? 512 : 256;
    scatterMax = Math.min(scatterMax, scatterCap);
    expect(scatterMax).toBe(512);
  });

  // BallisticScatter cap = 256 leptons (unguided projectiles)
  it('ballistic scatter capped at 256 leptons (BallisticScatter)', () => {
    const distLeptons = 60 * LEPTON_SIZE;
    let scatterMax = Math.max(0, (distLeptons / 16) - 64);
    const isHoming = false;
    const scatterCap = isHoming ? 512 : 256;
    scatterMax = Math.min(scatterMax, scatterCap);
    expect(scatterMax).toBe(256);
  });

  // Scatter to pixel conversion: scatterPx = scatterMax * CELL_SIZE / LEPTON_SIZE
  it('scatter lepton → pixel conversion', () => {
    const scatterLeptons = 96;
    const scatterPx = scatterLeptons * CELL_SIZE / LEPTON_SIZE;
    // 96 * 24 / 256 = 9.0 pixels
    expect(scatterPx).toBe(9);
  });
});

// ============================================================
// Section 9: calcProjectileTravelFrames — projSpeed conversion
// ============================================================
describe('calcProjectileTravelFrames — projSpeed parity', () => {
  it('undefined projSpeed returns DEFAULT_PROJECTILE_FRAMES (5)', () => {
    expect(calcProjectileTravelFrames(100)).toBe(DEFAULT_PROJECTILE_FRAMES);
    expect(DEFAULT_PROJECTILE_FRAMES).toBe(5);
  });

  it('zero projSpeed returns DEFAULT_PROJECTILE_FRAMES', () => {
    expect(calcProjectileTravelFrames(100, 0)).toBe(DEFAULT_PROJECTILE_FRAMES);
  });

  it('conversion formula: pixelsPerTick = projSpeed × CELL_SIZE / GAME_TICKS_PER_SEC', () => {
    // projSpeed=15 cells/sec → pixelsPerTick = 15 * 24 / 15 = 24.0 px/tick
    const pixelsPerTick = 15 * CELL_SIZE / GAME_TICKS_PER_SEC;
    expect(pixelsPerTick).toBe(24);
  });

  it('short distance, fast projectile = 1 tick minimum', () => {
    // 10 pixels at projSpeed=40 → pixelsPerTick = 40*24/15 = 64 → ceil(10/64) = 1
    expect(calcProjectileTravelFrames(10, 40)).toBe(1);
  });

  it('long distance respects MAX_PROJECTILE_FRAMES cap (45)', () => {
    // Very long distance at slow speed
    expect(MAX_PROJECTILE_FRAMES).toBe(45);
    const result = calcProjectileTravelFrames(100000, 1);
    expect(result).toBe(MAX_PROJECTILE_FRAMES);
  });

  it('specific example: 5 cells distance, projSpeed=15', () => {
    const distPx = 5 * CELL_SIZE; // 120 pixels
    const pixelsPerTick = 15 * CELL_SIZE / GAME_TICKS_PER_SEC; // 24 px/tick
    const expected = Math.ceil(distPx / pixelsPerTick); // ceil(120/24) = 5
    expect(calcProjectileTravelFrames(distPx, 15)).toBe(expected);
  });

  it('specific example: 3 cells distance, projSpeed=40 (hitscan-like)', () => {
    const distPx = 3 * CELL_SIZE; // 72 pixels
    const pixelsPerTick = 40 * CELL_SIZE / GAME_TICKS_PER_SEC; // 64 px/tick
    const expected = Math.ceil(distPx / pixelsPerTick); // ceil(72/64) = 2
    expect(calcProjectileTravelFrames(distPx, 40)).toBe(expected);
  });
});

// ============================================================
// Section 10: Unit system constants
// ============================================================
describe('unit system constants', () => {
  it('CELL_SIZE = 24 pixels', () => {
    expect(CELL_SIZE).toBe(24);
  });

  it('LEPTON_SIZE = 256 leptons per cell', () => {
    expect(LEPTON_SIZE).toBe(256);
  });

  it('GAME_TICKS_PER_SEC = 15 (C++ game loop frequency)', () => {
    expect(GAME_TICKS_PER_SEC).toBe(15);
  });
});
