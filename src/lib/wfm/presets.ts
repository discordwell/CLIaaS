/**
 * Holiday calendar presets — US Federal, UK Bank, Canada Statutory, Australia Public.
 * Includes floating holiday calculations (nth weekday of month).
 */

import type { HolidayCalendarEntry } from './types';

export interface HolidayPreset {
  id: string;
  name: string;
  country: string;
  description: string;
  getEntries: (year: number) => Omit<HolidayCalendarEntry, 'id'>[];
}

// All holiday dates are computed and formatted in UTC. Dates MUST be built with
// `Date.UTC(...)` (and read with `getUTC*`) so they agree with `fmt()` below,
// which serializes via `toISOString()` (UTC). Building with the local-time
// `new Date(y, m, d)` constructor instead drifts the result one calendar day
// whenever the runtime timezone has a positive UTC offset (e.g. a server set to
// Australia/Sydney), because local midnight falls on the previous UTC day.

/** Get the nth occurrence of a weekday in a month (1-indexed). */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): Date {
  const first = new Date(Date.UTC(year, month, 1));
  let dayOffset = (weekday - first.getUTCDay() + 7) % 7;
  dayOffset += (nth - 1) * 7;
  return new Date(Date.UTC(year, month, 1 + dayOffset));
}

/** Get last occurrence of a weekday in a month. */
function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, month + 1, 0)); // last day of month
  const dayOffset = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month, last.getUTCDate() - dayOffset));
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Compute Easter Sunday (Gregorian) as a UTC date. */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month, day));
}

function entry(name: string, date: string, recurring = false): Omit<HolidayCalendarEntry, 'id'> {
  return { name, date, recurring };
}

export const HOLIDAY_PRESETS: HolidayPreset[] = [
  {
    id: 'us-federal',
    name: 'US Federal Holidays',
    country: 'US',
    description: 'US federal holidays including floating holidays (MLK Day, Presidents Day, etc.)',
    getEntries: (year: number) => [
      entry("New Year's Day", `${year}-01-01`),
      entry('MLK Jr. Day', fmt(nthWeekdayOfMonth(year, 0, 1, 3))),           // 3rd Monday Jan
      entry("Presidents' Day", fmt(nthWeekdayOfMonth(year, 1, 1, 3))),       // 3rd Monday Feb
      entry('Memorial Day', fmt(lastWeekdayOfMonth(year, 4, 1))),            // Last Monday May
      entry('Juneteenth', `${year}-06-19`),
      entry('Independence Day', `${year}-07-04`),
      entry('Labor Day', fmt(nthWeekdayOfMonth(year, 8, 1, 1))),             // 1st Monday Sep
      entry('Columbus Day', fmt(nthWeekdayOfMonth(year, 9, 1, 2))),          // 2nd Monday Oct
      entry('Veterans Day', `${year}-11-11`),
      entry('Thanksgiving', fmt(nthWeekdayOfMonth(year, 10, 4, 4))),         // 4th Thursday Nov
      entry('Christmas Day', `${year}-12-25`),
    ],
  },
  {
    id: 'uk-bank',
    name: 'UK Bank Holidays',
    country: 'GB',
    description: 'England and Wales bank holidays',
    getEntries: (year: number) => {
      const easter = easterSunday(year);
      const goodFriday = new Date(easter.getTime() - 2 * 86400000);
      const easterMonday = new Date(easter.getTime() + 86400000);

      return [
        entry("New Year's Day", `${year}-01-01`),
        entry('Good Friday', fmt(goodFriday)),
        entry('Easter Monday', fmt(easterMonday)),
        entry('Early May Bank Holiday', fmt(nthWeekdayOfMonth(year, 4, 1, 1))),  // 1st Monday May
        entry('Spring Bank Holiday', fmt(lastWeekdayOfMonth(year, 4, 1))),        // Last Monday May
        entry('Summer Bank Holiday', fmt(lastWeekdayOfMonth(year, 7, 1))),        // Last Monday Aug
        entry('Christmas Day', `${year}-12-25`),
        entry('Boxing Day', `${year}-12-26`),
      ];
    },
  },
  {
    id: 'ca-statutory',
    name: 'Canada Statutory Holidays',
    country: 'CA',
    description: 'Canadian federal statutory holidays',
    getEntries: (year: number) => [
      entry("New Year's Day", `${year}-01-01`),
      entry('Good Friday', fmt(new Date(easterSunday(year).getTime() - 2 * 86400000))),
      entry('Victoria Day', fmt((() => {
        // Monday on or before May 24 (the Monday preceding May 25).
        const may25 = new Date(Date.UTC(year, 4, 25));
        const daysBefore = may25.getUTCDay() === 1 ? 7 : (may25.getUTCDay() + 6) % 7;
        return new Date(Date.UTC(year, 4, 25 - daysBefore));
      })())),
      entry('Canada Day', `${year}-07-01`),
      entry('Labour Day', fmt(nthWeekdayOfMonth(year, 8, 1, 1))),            // 1st Monday Sep
      entry('National Truth & Reconciliation Day', `${year}-09-30`),
      entry('Thanksgiving', fmt(nthWeekdayOfMonth(year, 9, 1, 2))),          // 2nd Monday Oct
      entry('Remembrance Day', `${year}-11-11`),
      entry('Christmas Day', `${year}-12-25`),
      entry('Boxing Day', `${year}-12-26`),
    ],
  },
  {
    id: 'au-public',
    name: 'Australia Public Holidays',
    country: 'AU',
    description: 'Australian national public holidays',
    getEntries: (year: number) => {
      const easter = easterSunday(year);
      const goodFriday = new Date(easter.getTime() - 2 * 86400000);
      const easterSaturday = new Date(easter.getTime() - 86400000);
      const easterMonday = new Date(easter.getTime() + 86400000);

      return [
        entry("New Year's Day", `${year}-01-01`),
        entry('Australia Day', `${year}-01-26`),
        entry('Good Friday', fmt(goodFriday)),
        entry('Easter Saturday', fmt(easterSaturday)),
        entry('Easter Monday', fmt(easterMonday)),
        entry('Anzac Day', `${year}-04-25`),
        entry("Queen's Birthday", fmt(nthWeekdayOfMonth(year, 5, 1, 2))),     // 2nd Monday Jun
        entry('Christmas Day', `${year}-12-25`),
        entry('Boxing Day', `${year}-12-26`),
      ];
    },
  },
];

export function getPresetById(id: string): HolidayPreset | undefined {
  return HOLIDAY_PRESETS.find(p => p.id === id);
}

export function listPresets(): Array<{ id: string; name: string; country: string; description: string }> {
  return HOLIDAY_PRESETS.map(({ id, name, country, description }) => ({ id, name, country, description }));
}

export function generatePresetEntries(
  presetId: string,
  year?: number,
): Omit<HolidayCalendarEntry, 'id'>[] {
  const preset = getPresetById(presetId);
  if (!preset) return [];
  return preset.getEntries(year ?? new Date().getFullYear());
}
