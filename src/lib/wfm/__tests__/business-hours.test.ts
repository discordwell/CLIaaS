import { describe, it, expect } from 'vitest';
import {
  isWithinBusinessHours,
  getElapsedBusinessMinutes,
  nextBusinessHourStart,
  nextBusinessHourClose,
  addBusinessMinutes,
} from '../business-hours';
import type { BusinessHoursConfig, HolidayEntry } from '../types';

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

describe('nextBusinessHourClose', () => {
  it('returns current time if outside business hours', () => {
    const config = makeConfig();
    const sunday = new Date('2026-03-01T10:00:00Z');
    const result = nextBusinessHourClose(config, sunday);
    expect(result.getTime()).toBe(sunday.getTime());
  });

  it('returns window end time during business hours', () => {
    const config = makeConfig();
    const monday10am = new Date('2026-03-02T10:00:00Z');
    const result = nextBusinessHourClose(config, monday10am);
    // 17:00 - 10:00 = 7 hours later
    expect(result.getUTCHours()).toBe(17);
    expect(result.getUTCMinutes()).toBe(0);
  });
});

describe('addBusinessMinutes', () => {
  it('adds minutes within a single day', () => {
    const config = makeConfig();
    const monday10am = new Date('2026-03-02T10:00:00Z');
    const result = addBusinessMinutes(config, monday10am, 120);
    // 10:00 + 120 min = 12:00
    expect(result.getUTCHours()).toBe(12);
    expect(result.getUTCMinutes()).toBe(0);
  });

  it('spans overnight into next business day', () => {
    const config = makeConfig();
    const monday4pm = new Date('2026-03-02T16:00:00Z');
    // 60 min left Mon (16:00-17:00) + 60 min Tue (09:00-10:00) = 120 min
    const result = addBusinessMinutes(config, monday4pm, 120);
    expect(result.getUTCDay()).toBe(2); // Tuesday
    expect(result.getUTCHours()).toBe(10);
    expect(result.getUTCMinutes()).toBe(0);
  });

  it('spans weekend', () => {
    const config = makeConfig();
    const friday4pm = new Date('2026-03-06T16:00:00Z');
    // 60 min left Fri (16:00-17:00) + need 60 more = Mon 10:00
    const result = addBusinessMinutes(config, friday4pm, 120);
    expect(result.getUTCDay()).toBe(1); // Monday
    expect(result.getUTCHours()).toBe(10);
  });

  it('spans holiday', () => {
    const config = makeConfig({ holidays: ['2026-03-03'] }); // Tuesday is holiday
    const monday4pm = new Date('2026-03-02T16:00:00Z');
    // 60 min left Mon + skip Tue (holiday) + 60 min Wed = 120 min → Wed 10:00
    const result = addBusinessMinutes(config, monday4pm, 120);
    expect(result.getUTCDay()).toBe(3); // Wednesday
    expect(result.getUTCHours()).toBe(10);
  });

  it('returns from time when adding 0 minutes', () => {
    const config = makeConfig();
    const now = new Date('2026-03-02T10:00:00Z');
    const result = addBusinessMinutes(config, now, 0);
    expect(result.getTime()).toBe(now.getTime());
  });

  it('starts from next business hour when outside hours', () => {
    const config = makeConfig();
    const saturday = new Date('2026-02-28T14:00:00Z'); // Saturday
    const result = addBusinessMinutes(config, saturday, 60);
    // Should start from Monday 09:00 + 60 min = 10:00
    expect(result.getUTCDay()).toBe(1); // Monday
    expect(result.getUTCHours()).toBe(10);
  });
});

describe('recurring holidays', () => {
  it('matches recurring holiday by month-day', () => {
    const holidays: HolidayEntry[] = [
      { date: '2020-03-02', name: 'Annual Day', recurring: true },
    ];
    const config = makeConfig({ holidays: holidays as unknown as string[] });
    // 2026-03-02 is a Monday
    const monday10am = new Date('2026-03-02T10:00:00Z');
    expect(isWithinBusinessHours(config, monday10am)).toBe(false);
  });

  it('does not match recurring holiday on wrong date', () => {
    const holidays: HolidayEntry[] = [
      { date: '2020-12-25', name: 'Christmas', recurring: true },
    ];
    const config = makeConfig({ holidays: holidays as unknown as string[] });
    const monday10am = new Date('2026-03-02T10:00:00Z');
    expect(isWithinBusinessHours(config, monday10am)).toBe(true);
  });
});

describe('partial-day holidays', () => {
  it('blocks only the specified range', () => {
    const holidays: HolidayEntry[] = [
      { date: '2026-03-02', name: 'Half Day', startTime: '12:00', endTime: '17:00' },
    ];
    const config = makeConfig({ holidays: holidays as unknown as string[] });
    // Morning should be open
    expect(isWithinBusinessHours(config, new Date('2026-03-02T10:00:00Z'))).toBe(true);
    // Afternoon should be blocked
    expect(isWithinBusinessHours(config, new Date('2026-03-02T14:00:00Z'))).toBe(false);
  });

  it('reduces elapsed minutes for partial-day holiday', () => {
    const holidays: HolidayEntry[] = [
      { date: '2026-03-02', name: 'Half Day', startTime: '12:00', endTime: '17:00' },
    ];
    const config = makeConfig({ holidays: holidays as unknown as string[] });
    // Full Monday 09:00-17:00 = 480 min, minus 12:00-17:00 = 300 min blocked → 180 min
    const start = new Date('2026-03-02T09:00:00Z');
    const end = new Date('2026-03-02T17:00:00Z');
    expect(getElapsedBusinessMinutes(config, start, end)).toBe(180);
  });
});
