/**
 * C++ parity tests: damage falloff formula
 *
 * C++ source: combat.cpp:106-125
 *   SpreadFactor==0: distance /= PIXEL_LEPTON_W/4  (=10/4=2 integer)
 *   SpreadFactor >0: distance /= SpreadFactor * (PIXEL_LEPTON_W/2)  (=SpreadFactor*5)
 *
 * PIXEL_LEPTON_W = ICON_LEPTON_W / ICON_PIXEL_W = 256/24 = 10 (integer division)
 * display.h:45-55
 *
 * In pixel space (TS coordinates):
 *   SpreadFactor==0: distFactor = floor(floor(distPixels * 256/24) / 2)
 *   SpreadFactor >0: distFactor = distPixels * 2 / SpreadFactor
 */

import { describe, it, expect } from 'vitest';
import { modifyDamage } from '../engine/types';

describe('Damage falloff — C++ parity', () => {
  // SpreadFactor=0 warheads: Organic, Mechanical

  it('SpreadFactor=0: distFactor = distPixels * 5 (C++ PIXEL_LEPTON_W/4 = 2)', () => {
    // At distPixels=1: distFactor = 1*5 = 5, damage = baseDamage / 5
    // Organic warhead vs none armor: mult = 1.0
    const dmg = modifyDamage(100, 'Organic', 'none', 1, 1.0, undefined, 0);
    // distFactor = floor(1 * 5) = 5, clamped to [0,16] = 5
    // damage = 100 * 1.0 / 5 = 20
    expect(dmg).toBe(20);
  });

  it('SpreadFactor=0: zero distance = full damage', () => {
    const dmg = modifyDamage(100, 'Organic', 'none', 0, 1.0, undefined, 0);
    // distFactor = 0, so no division — full damage
    expect(dmg).toBe(100);
  });

  it('SpreadFactor=0: 3px distance gives distFactor=16 after lepton truncation', () => {
    const dmg = modifyDamage(100, 'Organic', 'none', 3, 1.0, undefined, 0);
    // distLeptons = floor(3 * 256 / 24) = 32.
    // distFactor = floor(32 / (10/4 integer => 2)) = 16.
    // damage = trunc(100 / 16) = 6.
    expect(dmg).toBe(6);
  });

  it('SpreadFactor=0: 4px distance clamps distFactor to 16', () => {
    const dmg = modifyDamage(100, 'Organic', 'none', 4, 1.0, undefined, 0);
    // distFactor = floor(4 * 5) = 20, clamped to 16
    // damage = 100 / 16 = 6.25
    expect(dmg).toBeCloseTo(100 / 16, 0);
  });

  // SpreadFactor>0 warheads: SA(3), HE(6), AP(3), Fire(8)

  it('SpreadFactor=6 (HE): distFactor = distPixels * 2 / 6', () => {
    // At distPixels=3: distFactor = floor(3*2/6) = floor(1) = 1
    // Use warheadMultOverride=1 to isolate falloff from warhead-vs-armor table
    const dmg = modifyDamage(100, 'HE', 'none', 3, 1.0, 1, 6);
    // distFactor=1, damage = 100/1 = 100 (but MinDamage applies since distFactor<4)
    expect(dmg).toBe(100);
  });

  it('SpreadFactor=3 (AP): higher falloff than HE at same distance', () => {
    // At distPixels=6: distFactor = floor(6*2/3) = 4
    const dmg = modifyDamage(100, 'AP', 'none', 6, 1.0, 1, 3);
    // distFactor=4, damage = 100/4 = 25
    expect(dmg).toBe(25);
  });
});
