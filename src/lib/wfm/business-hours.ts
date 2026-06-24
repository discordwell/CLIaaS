/**
 * Business hours management.
 * Timezone-aware checks using Intl.DateTimeFormat, elapsed business-minute
 * calculation, and next-open-time lookup.
 *
 * Handles both schedule formats:
 * - Array of { day, startTime, endTime } (BusinessHoursWindow[])
 * - Record<string, Array<{ start, end }>> keyed by dayOfWeek number
 *
 * Design — one correct core, five thin wrappers:
 * Every public function is expressed in terms of `businessIntervals()`, a
 * generator that yields the *absolute* (UTC) [start, end) instants the business
 * is open, in chronological order, with adjacent/overlapping windows merged.
 * Building those instants with a real wall-clock→UTC conversion
 * (`wallTimeToUtc`) makes the module correct across two cases the previous
 * day-walk got wrong:
 *   1. Cross-midnight ("overnight") windows, e.g. 22:00–06:00, where the close
 *      time is on the *following* calendar day. A window whose end <= start is
 *      treated as wrapping past midnight.
 *   2. Daylight-saving transitions. The old code advanced the day cursor by a
 *      fixed `(24 - hours)` hours, which double-counted on 25-hour fall-back
 *      days and skipped an hour on 23-hour spring-forward days. Computing each
 *      window boundary from its wall-clock time resolves the offset per instant.
 *
 * A window is owned by the local calendar day it is scheduled on; its overnight
 * tail and its holiday status both follow that start day (so a holiday declared
 * on Tuesday does not retroactively cancel the tail of a shift that opened
 * Monday night). For non-overnight windows this is identical to the prior
 * behavior, since the window starts and ends on the same day.
 */

import type { BusinessHoursConfig, HolidayEntry } from './types';
import { getBHConfigs, addBHConfig, updateBHConfig, removeBHConfig, genId } from './store';

// ---- Helpers ----

const DAY_NAME_TO_NUM: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/** Cached one-per-timezone formatter used to read a timezone's UTC offset. */
const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timezone: string): Intl.DateTimeFormat {
  let fmt = offsetFormatterCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, hourCycle: 'h23',
    });
    offsetFormatterCache.set(timezone, fmt);
  }
  return fmt;
}

/**
 * Offset, in milliseconds, that the timezone is ahead of UTC at `instant`.
 * (e.g. America/New_York in winter returns -5h.) Computed by formatting the
 * instant as wall-clock in the zone and diffing against the same fields read
 * as if they were UTC.
 */
function getZoneOffsetMs(timezone: string, instant: number): number {
  const parts = offsetFormatter(timezone).formatToParts(new Date(instant));
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10);
  }
  let hour = map.hour ?? 0;
  if (hour === 24) hour = 0; // some engines emit '24' at midnight under h23
  const asUtc = Date.UTC(map.year, (map.month ?? 1) - 1, map.day ?? 1, hour, map.minute ?? 0, map.second ?? 0);
  return asUtc - instant;
}

/**
 * Convert a wall-clock time (year/month/day + minutes-into-the-day) in a given
 * timezone to the absolute UTC instant (ms). Uses the standard two-pass offset
 * resolution so that DST transitions are handled correctly — the second pass
 * re-reads the offset at the candidate instant, which fixes boundaries that
 * straddle a transition. `minutes` may be >= 1440 (e.g. 1440 == "24:00"), in
 * which case the result rolls into the next day, exactly as Date.UTC overflow
 * dictates.
 */
function wallTimeToUtc(timezone: string, year: number, month: number, day: number, minutes: number): number {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset1 = getZoneOffsetMs(timezone, guess);
  let utc = guess - offset1;
  const offset2 = getZoneOffsetMs(timezone, utc);
  if (offset2 !== offset1) {
    utc = guess - offset2;
  }
  return utc;
}

function getDateInZone(timezone: string, date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

interface TimeWindow { start: string; end: string }
interface AbsInterval { start: number; end: number } // epoch ms, [start, end)

function ymdFromDateStr(dateStr: string): { y: number; mo: number; d: number } {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return { y, mo, d };
}

function addDays(y: number, mo: number, d: number, delta: number): { y: number; mo: number; d: number } {
  const dt = new Date(Date.UTC(y, mo - 1, d + delta));
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function fmtDate(y: number, mo: number, d: number): string {
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Gregorian day-of-week (0=Sun) for a local calendar date. */
function dayOfWeekFor(y: number, mo: number, d: number): number {
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

/** Subtract a [bStart, bEnd) range from an interval, yielding 0–2 intervals. */
function subtractRange(seg: AbsInterval, bStart: number, bEnd: number): AbsInterval[] {
  if (bEnd <= seg.start || bStart >= seg.end) return [seg];
  const out: AbsInterval[] = [];
  if (bStart > seg.start) out.push({ start: seg.start, end: Math.min(bStart, seg.end) });
  if (bEnd < seg.end) out.push({ start: Math.max(bEnd, seg.start), end: seg.end });
  return out;
}

/**
 * Extract time windows for a given dayOfWeek from a BusinessHoursConfig.
 * Handles both schedule formats (Record and Array).
 */
function getWindowsForDay(config: BusinessHoursConfig, dayOfWeek: number): TimeWindow[] {
  const schedule = config.schedule as unknown;

  // Record format: { "1": [{ start, end }], ... }
  if (schedule && typeof schedule === 'object' && !Array.isArray(schedule)) {
    const rec = schedule as Record<string, Array<{ start: string; end: string }>>;
    return rec[String(dayOfWeek)] ?? [];
  }

  // Array format: [{ day: "monday", startTime: "09:00", endTime: "17:00" }, ...]
  if (Array.isArray(schedule)) {
    return (schedule as Array<{ day?: string; startTime?: string; endTime?: string }>)
      .filter(w => {
        if (!w.day) return false;
        return DAY_NAME_TO_NUM[w.day.toLowerCase()] === dayOfWeek;
      })
      .map(w => ({ start: w.startTime ?? '', end: w.endTime ?? '' }));
  }

  return [];
}

/**
 * Check if a date string is a holiday in the config.
 * Handles holidays as string[], HolidayEntry[], or mixed.
 * Returns false (not holiday), true (full-day holiday), or
 * { partial: true, startTime, endTime } for partial-day holidays.
 */
function isHoliday(
  config: BusinessHoursConfig,
  dateStr: string,
): boolean | { partial: true; startTime: string; endTime: string } {
  if (!config.holidays || config.holidays.length === 0) return false;
  const mmdd = dateStr.slice(5); // "MM-DD"

  for (const h of config.holidays) {
    if (typeof h === 'string') {
      if (h === dateStr) return true;
    } else {
      const entry = h as HolidayEntry;
      const matches = entry.recurring
        ? entry.date.slice(5) === mmdd
        : entry.date === dateStr;
      if (matches) {
        if (entry.startTime && entry.endTime) {
          return { partial: true, startTime: entry.startTime, endTime: entry.endTime };
        }
        return true;
      }
    }
  }
  return false;
}

/**
 * Absolute open intervals contributed by a single local calendar day's
 * schedule. Overnight windows (end <= start) extend into the following day;
 * full-day holidays remove the day entirely; partial-day holidays carve their
 * range out of each window. Returned sorted by start.
 */
function dayBusinessSegments(config: BusinessHoursConfig, y: number, mo: number, d: number): AbsInterval[] {
  const dateStr = fmtDate(y, mo, d);
  const holiday = isHoliday(config, dateStr);
  if (holiday === true) return [];

  const windows = getWindowsForDay(config, dayOfWeekFor(y, mo, d));
  if (windows.length === 0) return [];

  const tz = config.timezone;
  const next = addDays(y, mo, d, 1);

  let blockStart = -1;
  let blockEnd = -1;
  if (typeof holiday === 'object') {
    blockStart = wallTimeToUtc(tz, y, mo, d, timeToMinutes(holiday.startTime));
    blockEnd = wallTimeToUtc(tz, y, mo, d, timeToMinutes(holiday.endTime));
  }

  const segs: AbsInterval[] = [];
  for (const w of windows) {
    if (!w.start || !w.end) continue;
    const ws = timeToMinutes(w.start);
    const we = timeToMinutes(w.end);
    if (we === ws) continue; // zero-length window

    const startAbs = wallTimeToUtc(tz, y, mo, d, ws);
    // end <= start ⇒ window wraps past midnight, so its close is the next day.
    const endAbs = we > ws
      ? wallTimeToUtc(tz, y, mo, d, we)
      : wallTimeToUtc(tz, next.y, next.mo, next.d, we);

    let pieces: AbsInterval[] = [{ start: startAbs, end: endAbs }];
    if (blockStart >= 0) pieces = pieces.flatMap(p => subtractRange(p, blockStart, blockEnd));
    for (const p of pieces) {
      if (p.end > p.start) segs.push(p);
    }
  }

  segs.sort((a, b) => a.start - b.start);
  return segs;
}

/**
 * Yield merged, absolute open intervals in chronological order, starting from
 * the local day *before* `from` (so an overnight window that opened the prior
 * evening and still covers `from` is included). Scans at most `maxDays` local
 * days forward. Adjacent or overlapping windows (including an overnight tail
 * meeting the next morning's window) are merged into a single interval.
 */
function* businessIntervals(
  config: BusinessHoursConfig,
  from: Date,
  maxDays: number,
): Generator<AbsInterval> {
  const tz = config.timezone;
  let { y, mo, d } = ymdFromDateStr(getDateInZone(tz, from));
  ({ y, mo, d } = addDays(y, mo, d, -1));

  let pending: AbsInterval | null = null;
  for (let i = 0; i <= maxDays; i++) {
    const segs = dayBusinessSegments(config, y, mo, d);
    for (const seg of segs) {
      if (pending && seg.start <= pending.end) {
        if (seg.end > pending.end) pending.end = seg.end;
      } else {
        if (pending) yield pending;
        pending = { start: seg.start, end: seg.end };
      }
    }
    ({ y, mo, d } = addDays(y, mo, d, 1));
  }
  if (pending) yield pending;
}

// ---- Public API ----

export function getBusinessHours(id?: string): BusinessHoursConfig[] {
  return getBHConfigs(id);
}

export function createBusinessHours(
  input: Omit<BusinessHoursConfig, 'id' | 'createdAt' | 'updatedAt'>,
): BusinessHoursConfig {
  const now = new Date().toISOString();
  const config: BusinessHoursConfig = { ...input, id: genId('bh'), createdAt: now, updatedAt: now };
  addBHConfig(config);
  return config;
}

export function updateBusinessHours(
  id: string,
  updates: Partial<Omit<BusinessHoursConfig, 'id' | 'createdAt'>>,
): BusinessHoursConfig | null {
  return updateBHConfig(id, updates);
}

export function deleteBusinessHours(id: string): boolean {
  return removeBHConfig(id);
}

/**
 * Check whether a given timestamp (or now) falls within this config's business
 * hours. Timezone-aware and overnight-aware (a window opened the previous
 * evening that runs past midnight still counts).
 */
export function isWithinBusinessHours(config: BusinessHoursConfig, timestamp?: Date): boolean {
  const date = timestamp ?? new Date();
  const t = date.getTime();
  // Two local days are enough: the prior day (overnight tail) and the current
  // day (the open interval covering `t` is anchored on one of them).
  for (const iv of businessIntervals(config, date, 2)) {
    if (iv.start > t) break;
    if (t >= iv.start && t < iv.end) return true;
  }
  return false;
}

/**
 * Calculate elapsed business minutes between two dates by summing the overlap
 * of [start, end] with each open interval. Skips non-business time and
 * holidays, and is correct across midnight and DST transitions.
 */
export function getElapsedBusinessMinutes(
  config: BusinessHoursConfig,
  start: Date,
  end: Date,
): number {
  if (end <= start) return 0;

  const startMs = start.getTime();
  const endMs = end.getTime();
  // Bound the scan to the actual span (+slack for the prior-day backstep and
  // any overnight tail at the far end).
  const spanDays = Math.ceil((endMs - startMs) / MS_PER_DAY) + 3;

  let total = 0;
  for (const iv of businessIntervals(config, start, spanDays)) {
    if (iv.start >= endMs) break;
    if (iv.end <= startMs) continue;
    total += (Math.min(iv.end, endMs) - Math.max(iv.start, startMs)) / MS_PER_MINUTE;
  }
  return Math.round(total);
}

/**
 * Find the next time business hours start, from a given timestamp (or now).
 * If currently within business hours, returns the current time.
 */
export function nextBusinessHourStart(config: BusinessHoursConfig, from?: Date): Date {
  const start = from ?? new Date();
  const fromMs = start.getTime();

  for (const iv of businessIntervals(config, start, 366)) {
    if (iv.end <= fromMs) continue;     // entirely in the past
    if (iv.start <= fromMs) return start; // currently open
    return new Date(iv.start);          // first opening after `from`
  }
  // Fallback: no business hours found within the horizon (degenerate schedule).
  return new Date(fromMs + 7 * MS_PER_DAY);
}

/**
 * Find the next time the current business window closes, from a given
 * timestamp. If outside business hours, returns the current time. Adjacent
 * windows are treated as continuous, so the close is the end of the contiguous
 * open block (including an overnight tail).
 */
export function nextBusinessHourClose(config: BusinessHoursConfig, from?: Date): Date {
  const date = from ?? new Date();
  const t = date.getTime();

  // Scan far enough to reach the end of the *contiguous* open block — adjacent
  // windows and overnight tails are merged, so the block can run for days before
  // the next gap (e.g. a 24/5 "Mon–Fri around the clock" schedule is one
  // continuous 5-day block, and chained overnight shifts behave similarly). Two
  // weeks covers any weekly-periodic schedule. A schedule that never closes
  // within this window (true 24/7) has no meaningful next close and returns the
  // far edge of the scan.
  for (const iv of businessIntervals(config, date, 14)) {
    if (iv.start > t) break;
    if (t >= iv.start && t < iv.end) return new Date(iv.end);
  }
  return date; // outside business hours
}

/**
 * Add a given number of business minutes to a starting timestamp.
 * Walks forward through open intervals, skipping non-business time and
 * holidays.
 */
export function addBusinessMinutes(config: BusinessHoursConfig, from: Date, minutesToAdd: number): Date {
  if (minutesToAdd <= 0) return from;

  const fromMs = from.getTime();
  let remaining = minutesToAdd;

  for (const iv of businessIntervals(config, from, 366)) {
    const segStart = Math.max(iv.start, fromMs);
    if (segStart >= iv.end) continue; // interval is wholly before `from`
    const available = (iv.end - segStart) / MS_PER_MINUTE;
    if (remaining <= available) {
      return new Date(segStart + remaining * MS_PER_MINUTE);
    }
    remaining -= available;
  }

  // Fallback: shouldn't happen with valid schedules within the horizon.
  return new Date(fromMs + minutesToAdd * MS_PER_MINUTE);
}
