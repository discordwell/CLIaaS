/**
 * C++ parity tests: production build times
 *
 * C++ source: techno.cpp:6075-6078
 *   int TechnoTypeClass::Time_To_Build(void) const {
 *     return(Cost * Rule.BuildSpeedBias * fixed(TICKS_PER_MINUTE, 1000));
 *   }
 *
 * Constants:
 *   TICKS_PER_MINUTE = 15 * 60 = 900 (defines.h:3032)
 *   Rule.BuildSpeedBias = 0.8 (rules.ini BuildSpeed=.8, line 79)
 *
 * TS engine now runs at 15 Hz (matching C++ TICKS_PER_SECOND), no scaling needed.
 *
 * Formula: buildTime = floor(Cost * 0.8 * 900 / 1000) = floor(Cost * 0.72)
 */

import { describe, it, expect } from 'vitest';
import { PRODUCTION_ITEMS } from '../engine/types';

function cppBuildTime(cost: number): number {
  return Math.floor(cost * 0.8 * 900 / 1000);
}

describe('Production build times — C++ parity', () => {
  it('POWR buildTime matches C++ formula', () => {
    const powr = PRODUCTION_ITEMS.find(i => i.type === 'POWR');
    expect(powr).toBeDefined();
    expect(powr!.buildTime).toBe(cppBuildTime(300)); // 288
  });

  it('E3 buildTime matches C++ formula', () => {
    const e3 = PRODUCTION_ITEMS.find(i => i.type === 'E3');
    expect(e3).toBeDefined();
    expect(e3!.buildTime).toBe(cppBuildTime(300)); // 288
  });

  it('2TNK buildTime matches C++ formula', () => {
    const tank = PRODUCTION_ITEMS.find(i => i.type === '2TNK');
    expect(tank).toBeDefined();
    expect(tank!.buildTime).toBe(cppBuildTime(800)); // 768
  });

  it('WEAP buildTime matches C++ formula', () => {
    const weap = PRODUCTION_ITEMS.find(i => i.type === 'WEAP');
    expect(weap).toBeDefined();
    expect(weap!.buildTime).toBe(cppBuildTime(2000)); // 1920
  });

  it('all items have buildTime = floor(cost * 0.72)', () => {
    for (const item of PRODUCTION_ITEMS) {
      const expected = cppBuildTime(item.cost);
      expect(item.buildTime, `${item.type} (cost=${item.cost})`).toBe(expected);
    }
  });

  it('build times are proportional to cost (C++ design invariant)', () => {
    const powr = PRODUCTION_ITEMS.find(i => i.type === 'POWR')!;
    const weap = PRODUCTION_ITEMS.find(i => i.type === 'WEAP')!;
    // WEAP costs 6.67x more than POWR, build time should scale similarly
    const costRatio = weap.cost / powr.cost;
    const timeRatio = weap.buildTime / powr.buildTime;
    expect(Math.abs(costRatio - timeRatio)).toBeLessThan(0.1);
  });
});
