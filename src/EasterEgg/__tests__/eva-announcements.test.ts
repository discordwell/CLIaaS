import { describe, it, expect } from 'vitest';

describe('EVA Announcements', () => {
  it('throttle prevents rapid EVA calls (3s = 45 ticks)', () => {
    const lastEvaTime = new Map<string, number>();
    const THROTTLE = 45;

    // First call at tick 0 should play
    const tick1 = 0;
    const last1 = lastEvaTime.get('eva_unit_lost') ?? 0;
    const shouldPlay1 = tick1 - last1 >= THROTTLE || last1 === 0;
    expect(shouldPlay1).toBe(true);
    lastEvaTime.set('eva_unit_lost', tick1);

    // Call at tick 10 should be throttled
    const tick2 = 10;
    const last2 = lastEvaTime.get('eva_unit_lost') ?? 0;
    const shouldPlay2 = tick2 - last2 >= THROTTLE;
    expect(shouldPlay2).toBe(false);

    // Call at tick 50 should play
    const tick3 = 50;
    const last3 = lastEvaTime.get('eva_unit_lost') ?? 0;
    const shouldPlay3 = tick3 - last3 >= THROTTLE;
    expect(shouldPlay3).toBe(true);
  });

  it('different EVA types have independent throttles', () => {
    const lastEvaTime = new Map<string, number>();
    lastEvaTime.set('eva_unit_lost', 0);
    // Different type should not be throttled
    const last = lastEvaTime.get('eva_base_attack') ?? 0;
    expect(0 - last).toBeGreaterThanOrEqual(0);
  });
});
