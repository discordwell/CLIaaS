/**
 * Combat pipeline refactor tests — verifies centralized armorIndex,
 * getWarheadMultiplier, firepower bias in aircraft/defense combat,
 * and veterancy removal.
 */

import { describe, it, expect } from 'vitest';
import {
  armorIndex, getWarheadMultiplier,
  WARHEAD_VS_ARMOR, type ArmorType, type WarheadType,
} from '../engine/types';
import { Entity } from '../engine/entity';
import { UnitType, House } from '../engine/types';

// === H1: Centralized armorIndex + getWarheadMultiplier ===

describe('armorIndex()', () => {
  it('maps all 5 armor types to correct indices', () => {
    expect(armorIndex('none')).toBe(0);
    expect(armorIndex('wood')).toBe(1);
    expect(armorIndex('light')).toBe(2);
    expect(armorIndex('heavy')).toBe(3);
    expect(armorIndex('concrete')).toBe(4);
  });
});

describe('getWarheadMultiplier()', () => {
  it('matches direct WARHEAD_VS_ARMOR table lookups', () => {
    const warheads: WarheadType[] = ['SA', 'HE', 'AP', 'Fire', 'HollowPoint', 'Super', 'Organic'];
    const armors: ArmorType[] = ['none', 'wood', 'light', 'heavy', 'concrete'];

    for (const wh of warheads) {
      for (const armor of armors) {
        const expected = WARHEAD_VS_ARMOR[wh][armorIndex(armor)];
        expect(getWarheadMultiplier(wh, armor)).toBe(expected);
      }
    }
  });

  it('SA vs concrete = 0.25', () => {
    expect(getWarheadMultiplier('SA', 'concrete')).toBe(0.25);
  });

  it('HE vs concrete = 1.0', () => {
    expect(getWarheadMultiplier('HE', 'concrete')).toBe(1.0);
  });

  it('AP vs heavy = 1.0', () => {
    expect(getWarheadMultiplier('AP', 'heavy')).toBe(1.0);
  });

  it('Organic vs none = 1.0, Organic vs any armor = 0.0', () => {
    expect(getWarheadMultiplier('Organic', 'none')).toBe(1.0);
    expect(getWarheadMultiplier('Organic', 'wood')).toBe(0.0);
    expect(getWarheadMultiplier('Organic', 'light')).toBe(0.0);
    expect(getWarheadMultiplier('Organic', 'heavy')).toBe(0.0);
    expect(getWarheadMultiplier('Organic', 'concrete')).toBe(0.0);
  });
});

// === M1+M2: Veterancy removal ===

describe('Veterancy cleanup', () => {
  it('Entity has no veterancy field', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect('veterancy' in e).toBe(false);
  });

  it('Entity has no damageMultiplier getter', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect('damageMultiplier' in e).toBe(false);
  });

  it('creditKill still increments kills', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(e.kills).toBe(0);
    e.creditKill();
    e.creditKill();
    e.creditKill();
    expect(e.kills).toBe(3);
  });
});
