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

describe('overnight (cross-midnight) windows', () => {
  // Monday 22:00 → Tuesday 06:00 (end <= start ⇒ the window wraps past midnight).
  // Only Monday is scheduled, so the early-morning hours belong to Monday's shift.
  const cfg = makeConfig({ schedule: { '1': [{ start: '22:00', end: '06:00' }] } });

  it('is open in the evening portion (same calendar day)', () => {
    // Monday 23:00 UTC
    expect(isWithinBusinessHours(cfg, new Date('2026-03-02T23:00:00Z'))).toBe(true);
  });

  it('is open in the early-morning tail (next calendar day)', () => {
    // Tuesday 05:00 UTC — still inside Monday's overnight window
    expect(isWithinBusinessHours(cfg, new Date('2026-03-03T05:00:00Z'))).toBe(true);
  });

  it('is closed once the tail ends', () => {
    // Tuesday 07:00 UTC — after the 06:00 close
    expect(isWithinBusinessHours(cfg, new Date('2026-03-03T07:00:00Z'))).toBe(false);
  });

  it('is closed before the window opens', () => {
    // Monday 21:00 UTC — before the 22:00 open
    expect(isWithinBusinessHours(cfg, new Date('2026-03-02T21:00:00Z'))).toBe(false);
  });

  it('counts elapsed minutes across midnight', () => {
    // Mon 22:00 → Tue 06:00 = 8h
    expect(getElapsedBusinessMinutes(cfg, new Date('2026-03-02T22:00:00Z'), new Date('2026-03-03T06:00:00Z'))).toBe(480);
  });

  it('counts a sub-range that straddles midnight', () => {
    // Mon 23:00 → Tue 02:00 = 3h
    expect(getElapsedBusinessMinutes(cfg, new Date('2026-03-02T23:00:00Z'), new Date('2026-03-03T02:00:00Z'))).toBe(180);
  });

  it('addBusinessMinutes wraps past midnight', () => {
    // Mon 23:00 + 60 min of business time → Tue 00:00
    const result = addBusinessMinutes(cfg, new Date('2026-03-02T23:00:00Z'), 60);
    expect(result.toISOString()).toBe('2026-03-03T00:00:00.000Z');
  });

  it('nextBusinessHourStart finds the evening opening', () => {
    const result = nextBusinessHourStart(cfg, new Date('2026-03-02T20:00:00Z')); // Mon 20:00
    expect(result.toISOString()).toBe('2026-03-02T22:00:00.000Z');
  });

  it('nextBusinessHourClose returns the post-midnight close', () => {
    const result = nextBusinessHourClose(cfg, new Date('2026-03-02T23:00:00Z')); // within window
    expect(result.toISOString()).toBe('2026-03-03T06:00:00.000Z');
  });

  it('supports the array schedule format too', () => {
    const arrayCfg = makeConfig({
      schedule: [{ day: 'monday', startTime: '22:00', endTime: '06:00' }] as unknown as BusinessHoursConfig['schedule'],
    });
    expect(isWithinBusinessHours(arrayCfg, new Date('2026-03-03T05:00:00Z'))).toBe(true);
  });
});

describe('DST transitions (America/New_York)', () => {
  // Open every day 09:00–17:00 local, so the transition day itself is a business day.
  const cfg = makeConfig({
    timezone: 'America/New_York',
    schedule: Object.fromEntries(
      [0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), [{ start: '09:00', end: '17:00' }]]),
    ) as BusinessHoursConfig['schedule'],
  });

  it('does not double-count on a 25-hour fall-back day', () => {
    // 2025-11-02: clocks fall back 02:00 EDT → 01:00 EST, so midnight-to-midnight
    // is 25 calendar hours. The 09:00–17:00 window is still a flat 8 business hours.
    // (The old fixed-24h day advance re-walked the day and reported 960.)
    const start = new Date('2025-11-02T04:00:00Z'); // 00:00 ET (EDT, -04:00)
    const end = new Date('2025-11-03T05:00:00Z');   // 00:00 ET next day (EST, -05:00)
    expect(getElapsedBusinessMinutes(cfg, start, end)).toBe(480);
  });

  it('places the window correctly across a 23-hour spring-forward day', () => {
    // 2025-03-09: clocks spring forward 02:00 EST → 03:00 EDT. A range that opens
    // before the transition (01:00 EST) and closes after it (12:00 EDT) must count
    // the real 09:00–12:00 window = 180 min. (The old day advance reported 120.)
    const start = new Date('2025-03-09T06:00:00Z'); // 01:00 ET (EST, -05:00)
    const end = new Date('2025-03-09T16:00:00Z');   // 12:00 ET (EDT, -04:00)
    expect(getElapsedBusinessMinutes(cfg, start, end)).toBe(180);
  });

  it('addBusinessMinutes lands on the correct wall-clock instant after fall-back', () => {
    // Sunday 2025-11-02 16:30 ET (EST) + 60 business min ⇒ next open is Monday 09:00 ET.
    // 16:30 EST = 21:30 UTC; remaining 30 min that day reaches 17:00 EST (22:00 UTC),
    // then 30 min Monday from 09:00 EST (14:00 UTC) ⇒ 09:30 EST = 14:30 UTC.
    const result = addBusinessMinutes(cfg, new Date('2025-11-02T21:30:00Z'), 60);
    expect(result.toISOString()).toBe('2025-11-03T14:30:00.000Z');
  });
});

describe('24/7 schedules', () => {
  const cfg = makeConfig({
    schedule: Object.fromEntries(
      [0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), [{ start: '00:00', end: '24:00' }]]),
    ) as BusinessHoursConfig['schedule'],
  });

  it('is always within business hours', () => {
    expect(isWithinBusinessHours(cfg, new Date('2026-03-01T03:00:00Z'))).toBe(true); // Sunday 03:00
    expect(isWithinBusinessHours(cfg, new Date('2026-03-04T23:59:00Z'))).toBe(true); // Wednesday 23:59
  });

  it('elapsed equals full calendar minutes (days merge into one block)', () => {
    const start = new Date('2026-03-02T00:00:00Z');
    const end = new Date('2026-03-05T00:00:00Z'); // exactly 3 days
    expect(getElapsedBusinessMinutes(cfg, start, end)).toBe(3 * 24 * 60);
  });
});

describe('multi-day contiguous blocks (24/5)', () => {
  // Open around the clock Monday–Friday: Mon 00:00 through Sat 00:00 is a single
  // continuous 5-day open block (each day's 24h window touches the next).
  const cfg = makeConfig({
    schedule: Object.fromEntries(
      [1, 2, 3, 4, 5].map((d) => [String(d), [{ start: '00:00', end: '24:00' }]]),
    ) as BusinessHoursConfig['schedule'],
  });

  it('nextBusinessHourClose returns the end of the whole block, regardless of entry point', () => {
    // 2026-03-02 is Monday; the block closes Saturday 2026-03-07 at 00:00.
    const expected = '2026-03-07T00:00:00.000Z';
    expect(nextBusinessHourClose(cfg, new Date('2026-03-02T12:00:00Z')).toISOString()).toBe(expected); // Mon
    expect(nextBusinessHourClose(cfg, new Date('2026-03-04T12:00:00Z')).toISOString()).toBe(expected); // Wed
    expect(nextBusinessHourClose(cfg, new Date('2026-03-06T23:00:00Z')).toISOString()).toBe(expected); // Fri
  });

  it('stays open continuously across the whole work week', () => {
    expect(isWithinBusinessHours(cfg, new Date('2026-03-04T03:00:00Z'))).toBe(true);  // Wed 03:00
    expect(isWithinBusinessHours(cfg, new Date('2026-03-07T12:00:00Z'))).toBe(false); // Sat — closed
  });
});
