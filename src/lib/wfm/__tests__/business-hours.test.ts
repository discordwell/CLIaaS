import { describe, it, expect } from 'vitest';
import { isWithinBusinessHours, getElapsedBusinessMinutes, nextBusinessHourStart } from '../business-hours';
import type { BusinessHoursConfig } from '../types';

function makeConfig(overrides?: Partial<BusinessHoursConfig>): BusinessHoursConfig {
  return {
    id: 'bh-test',
    name: 'Test Hours',
    timezone: 'UTC',
    schedule: {
      '1': [{ start: '09:00', end: '17:00' }],
      '2': [{ start: '09:00', end: '17:00' }],
      '3': [{ start: '09:00', end: '17:00' }],
      '4': [{ start: '09:00', end: '17:00' }],
      '5': [{ start: '09:00', end: '17:00' }],
    },
    holidays: [],
    isDefault: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('isWithinBusinessHours', () => {
  it('returns true during business hours on a weekday', () => {
    const config = makeConfig();
    // 2026-03-02 is a Monday, 10:00 UTC
    const date = new Date('2026-03-02T10:00:00Z');
    expect(isWithinBusinessHours(config, date)).toBe(true);
  });

  it('returns false outside business hours on a weekday', () => {
    const config = makeConfig();
    // Monday 07:00 UTC — before 09:00
    const date = new Date('2026-03-02T07:00:00Z');
    expect(isWithinBusinessHours(config, date)).toBe(false);
  });

  it('returns false on weekends', () => {
    const config = makeConfig();
    // 2026-03-01 is a Sunday, 10:00 UTC
    const date = new Date('2026-03-01T10:00:00Z');
    expect(isWithinBusinessHours(config, date)).toBe(false);
  });

  it('returns false on holidays', () => {
    const config = makeConfig({ holidays: ['2026-03-02'] });
    // Monday during business hours, but it's a holiday
    const date = new Date('2026-03-02T10:00:00Z');
    expect(isWithinBusinessHours(config, date)).toBe(false);
  });

  it('handles array-format schedules', () => {
    const config = makeConfig({
      schedule: [
        { day: 'monday', startTime: '09:00', endTime: '17:00' },
        { day: 'tuesday', startTime: '09:00', endTime: '17:00' },
      ] as unknown as BusinessHoursConfig['schedule'],
    });
    const monday10am = new Date('2026-03-02T10:00:00Z');
    expect(isWithinBusinessHours(config, monday10am)).toBe(true);
  });

  it('handles timezone-aware checks', () => {
    const config = makeConfig({ timezone: 'America/New_York' });
    // 2026-03-02 Monday 14:00 UTC = 09:00 ET (within hours)
    expect(isWithinBusinessHours(config, new Date('2026-03-02T14:00:00Z'))).toBe(true);
    // 2026-03-02 Monday 13:00 UTC = 08:00 ET (before hours)
    expect(isWithinBusinessHours(config, new Date('2026-03-02T13:00:00Z'))).toBe(false);
  });
});

describe('getElapsedBusinessMinutes', () => {
  it('returns 0 when end is before start', () => {
    const config = makeConfig();
    const start = new Date('2026-03-02T12:00:00Z');
    const end = new Date('2026-03-02T10:00:00Z');
    expect(getElapsedBusinessMinutes(config, start, end)).toBe(0);
  });

  it('counts minutes within a single business day', () => {
    const config = makeConfig();
    // Monday 10:00 to 12:00 = 120 minutes
    const start = new Date('2026-03-02T10:00:00Z');
    const end = new Date('2026-03-02T12:00:00Z');
    expect(getElapsedBusinessMinutes(config, start, end)).toBe(120);
  });

  it('skips non-business hours', () => {
    const config = makeConfig();
    // Monday 16:00 to Tuesday 10:00 = 1 hour Monday + 1 hour Tuesday = 120 minutes
    const start = new Date('2026-03-02T16:00:00Z');
    const end = new Date('2026-03-03T10:00:00Z');
    expect(getElapsedBusinessMinutes(config, start, end)).toBe(120);
  });

  it('skips holidays', () => {
    const config = makeConfig({ holidays: ['2026-03-02'] });
    // Monday (holiday) to Tuesday 10:00 = only 1 hour Tuesday
    const start = new Date('2026-03-02T10:00:00Z');
    const end = new Date('2026-03-03T10:00:00Z');
    expect(getElapsedBusinessMinutes(config, start, end)).toBe(60);
  });
});

describe('nextBusinessHourStart', () => {
  it('returns current time if within business hours', () => {
    const config = makeConfig();
    const now = new Date('2026-03-02T10:00:00Z');
    const result = nextBusinessHourStart(config, now);
    expect(result.getTime()).toBe(now.getTime());
  });

  it('finds next morning if after hours on a weekday', () => {
    const config = makeConfig();
    const fridayEvening = new Date('2026-03-06T18:00:00Z');
    const result = nextBusinessHourStart(config, fridayEvening);
    // Next business day is Monday 2026-03-09 at 09:00 UTC
    expect(result.getUTCDay()).toBe(1); // Monday
    expect(result.getUTCHours()).toBe(9);
  });

  it('skips holidays', () => {
    const config = makeConfig({ holidays: ['2026-03-02'] });
    const sundayEvening = new Date('2026-03-01T18:00:00Z');
    const result = nextBusinessHourStart(config, sundayEvening);
    // Monday is a holiday, so next open is Tuesday 09:00
    expect(result.getUTCDay()).toBe(2); // Tuesday
    expect(result.getUTCHours()).toBe(9);
  });
});
