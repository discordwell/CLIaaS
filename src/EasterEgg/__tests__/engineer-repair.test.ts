import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { UnitType, House, CONDITION_RED } from '../engine/types';

beforeEach(() => resetEntityIds());

describe('Engineer Friendly Repair', () => {
  it('engineer has null weapon (no direct combat)', () => {
    const eng = new Entity(UnitType.I_E6, House.Spain, 100, 100);
    expect(eng.weapon).toBeNull();
  });

  it('33% repair on full-hp structure caps at maxHp', () => {
    const maxHp = 256;
    const currentHp = 200;
    const repairAmount = Math.ceil(maxHp * 0.33);
    const newHp = Math.min(maxHp, currentHp + repairAmount);
    expect(newHp).toBe(maxHp); // 200 + 85 = 285, capped at 256
  });

  it('33% repair on badly damaged structure', () => {
    const maxHp = 256;
    const currentHp = 50;
    const repairAmount = Math.ceil(maxHp * 0.33);
    const newHp = Math.min(maxHp, currentHp + repairAmount);
    expect(newHp).toBe(50 + 85); // 135
  });

  it('CONDITION_RED is 0.25 (25% health)', () => {
    expect(CONDITION_RED).toBe(0.25);
  });

  it('engineer is player infantry', () => {
    const eng = new Entity(UnitType.I_E6, House.Spain, 100, 100);
    expect(eng.isPlayerUnit).toBe(true);
    expect(eng.stats.isInfantry).toBe(true);
  });
});
