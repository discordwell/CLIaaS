/**
 * Business hours management.
 * Timezone-aware checks using Intl.DateTimeFormat, elapsed business-minute
 * calculation, and next-open-time lookup.
 *
 * Handles both schedule formats:
 * - Array of { day, startTime, endTime } (BusinessHoursWindow[])
 * - Record<string, Array<{ start, end }>> keyed by dayOfWeek number
 */

import type { BusinessHoursConfig, HolidayEntry } from './types';
import { getBHConfigs, addBHConfig, updateBHConfig, removeBHConfig, genId } from './store';

// ---- Helpers ----

const DAY_NAME_TO_NUM: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

function getTimeInZone(timezone: string, date: Date): { dayOfWeek: number; hours: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false,
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(date);
  const weekday = parts.find(p => p.type === 'weekday')?.value ?? '';
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = dayMap[weekday] ?? 0;
  const hours = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
  const minutes = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
  return { dayOfWeek, hours, minutes };
}

function getDateInZone(timezone: string, date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

interface TimeWindow { start: string; end: string }

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
 * Check whether a given timestamp (or now) falls within this config's business hours.
 * Timezone-aware: converts timestamp to the config's timezone before checking.
 */
export function isWithinBusinessHours(config: BusinessHoursConfig, timestamp?: Date): boolean {
  const date = timestamp ?? new Date();
  const { dayOfWeek, hours, minutes } = getTimeInZone(config.timezone, date);

  const dateStr = getDateInZone(config.timezone, date);
  const holiday = isHoliday(config, dateStr);
  if (holiday === true) return false;

  const windows = getWindowsForDay(config, dayOfWeek);
  if (windows.length === 0) return false;

  const currentMinutes = hours * 60 + minutes;

  // For partial-day holidays, exclude the blocked range
  const blockedStart = typeof holiday === 'object' ? timeToMinutes(holiday.startTime) : -1;
  const blockedEnd = typeof holiday === 'object' ? timeToMinutes(holiday.endTime) : -1;

  return windows.some(w => {
    const start = timeToMinutes(w.start);
    const end = timeToMinutes(w.end);
    if (currentMinutes < start || currentMinutes >= end) return false;
    if (blockedStart >= 0 && currentMinutes >= blockedStart && currentMinutes < blockedEnd) return false;
    return true;
  });
}

/**
 * Calculate elapsed business minutes between two dates.
 * Walks day-by-day, computing overlap with business hour windows, skipping holidays.
 */
export function getElapsedBusinessMinutes(
  config: BusinessHoursConfig,
  start: Date,
  end: Date,
): number {
  if (end <= start) return 0;

  let totalMinutes = 0;
  const cursor = new Date(start);

  while (cursor < end) {
    const { dayOfWeek, hours, minutes: mins } = getTimeInZone(config.timezone, cursor);
    const dateStr = getDateInZone(config.timezone, cursor);

    const holiday = isHoliday(config, dateStr);
    if (holiday === true) {
      cursor.setTime(cursor.getTime() + (24 - hours) * 3600000 - mins * 60000);
      continue;
    }

    const windows = getWindowsForDay(config, dayOfWeek);
    if (windows.length === 0) {
      cursor.setTime(cursor.getTime() + (24 - hours) * 3600000 - mins * 60000);
      continue;
    }

    const currentDayMinutes = hours * 60 + mins;
    const blockedStart = typeof holiday === 'object' ? timeToMinutes(holiday.startTime) : -1;
    const blockedEnd = typeof holiday === 'object' ? timeToMinutes(holiday.endTime) : -1;

    for (const window of windows) {
      const winStart = timeToMinutes(window.start);
      const winEnd = timeToMinutes(window.end);
      const dayStartAbsolute = new Date(cursor.getTime() - currentDayMinutes * 60000);
      const windowStartAbs = new Date(dayStartAbsolute.getTime() + winStart * 60000);
      const windowEndAbs = new Date(dayStartAbsolute.getTime() + winEnd * 60000);

      const overlapStart = Math.max(start.getTime(), windowStartAbs.getTime());
      const overlapEnd = Math.min(end.getTime(), windowEndAbs.getTime());

      if (overlapEnd > overlapStart) {
        let overlap = (overlapEnd - overlapStart) / 60000;

        // Subtract partial-day holiday blocked range if it overlaps this window
        if (blockedStart >= 0) {
          const blockedStartAbs = new Date(dayStartAbsolute.getTime() + blockedStart * 60000);
          const blockedEndAbs = new Date(dayStartAbsolute.getTime() + blockedEnd * 60000);
          const bStart = Math.max(overlapStart, blockedStartAbs.getTime());
          const bEnd = Math.min(overlapEnd, blockedEndAbs.getTime());
          if (bEnd > bStart) overlap -= (bEnd - bStart) / 60000;
        }

        totalMinutes += overlap;
      }
    }

    cursor.setTime(cursor.getTime() + (24 - hours) * 3600000 - mins * 60000);
  }

  return Math.round(totalMinutes);
}

/**
 * Find the next time business hours start, from a given timestamp (or now).
 * If currently within business hours, returns the current time.
 */
export function nextBusinessHourStart(config: BusinessHoursConfig, from?: Date): Date {
  const start = from ?? new Date();
  if (isWithinBusinessHours(config, start)) return start;

  const cursor = new Date(start);
  for (let attempt = 0; attempt < 8 * 24; attempt++) {
    const { dayOfWeek, hours, minutes } = getTimeInZone(config.timezone, cursor);
    const dateStr = getDateInZone(config.timezone, cursor);

    const holiday = isHoliday(config, dateStr);
    if (holiday === true) {
      cursor.setTime(cursor.getTime() + (24 - hours) * 3600000 - minutes * 60000);
      continue;
    }

    const windows = getWindowsForDay(config, dayOfWeek);
    if (windows.length === 0) {
      cursor.setTime(cursor.getTime() + (24 - hours) * 3600000 - minutes * 60000);
      continue;
    }

    const currentMinutes = hours * 60 + minutes;
    const blockedStart = typeof holiday === 'object' ? timeToMinutes(holiday.startTime) : -1;
    const blockedEnd = typeof holiday === 'object' ? timeToMinutes(holiday.endTime) : -1;
    const sorted = [...windows].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

    for (const window of sorted) {
      const winStart = timeToMinutes(window.start);
      const winEnd = timeToMinutes(window.end);

      if (currentMinutes < winStart) {
        // If the window start is inside blocked range, skip past it
        if (blockedStart >= 0 && winStart >= blockedStart && winStart < blockedEnd) {
          if (blockedEnd < winEnd) {
            return new Date(cursor.getTime() + (blockedEnd - currentMinutes) * 60000);
          }
          continue;
        }
        return new Date(cursor.getTime() + (winStart - currentMinutes) * 60000);
      }
      if (currentMinutes >= winStart && currentMinutes < winEnd) {
        // Inside window — but are we in a blocked range?
        if (blockedStart >= 0 && currentMinutes >= blockedStart && currentMinutes < blockedEnd) {
          if (blockedEnd < winEnd) {
            return new Date(cursor.getTime() + (blockedEnd - currentMinutes) * 60000);
          }
          continue;
        }
        return cursor;
      }
    }

    cursor.setTime(cursor.getTime() + (24 - hours) * 3600000 - minutes * 60000);
  }

  return new Date(start.getTime() + 7 * 86400000);
}

/**
 * Find the next time the current business window closes, from a given timestamp.
 * If outside business hours, returns the current time.
 */
export function nextBusinessHourClose(config: BusinessHoursConfig, from?: Date): Date {
  const date = from ?? new Date();
  if (!isWithinBusinessHours(config, date)) return date;

  const { dayOfWeek, hours, minutes } = getTimeInZone(config.timezone, date);
  const dateStr = getDateInZone(config.timezone, date);
  const holiday = isHoliday(config, dateStr);
  const windows = getWindowsForDay(config, dayOfWeek);
  const currentMinutes = hours * 60 + minutes;
  const blockedStart = typeof holiday === 'object' ? timeToMinutes(holiday.startTime) : -1;

  const sorted = [...windows].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  for (const w of sorted) {
    const winStart = timeToMinutes(w.start);
    const winEnd = timeToMinutes(w.end);
    if (currentMinutes >= winStart && currentMinutes < winEnd) {
      // If a partial-day holiday starts before window end, that's the effective close
      const effectiveEnd = (blockedStart >= 0 && blockedStart > currentMinutes && blockedStart < winEnd)
        ? blockedStart : winEnd;
      return new Date(date.getTime() + (effectiveEnd - currentMinutes) * 60000);
    }
  }
  return date;
}

/**
 * Add a given number of business minutes to a starting timestamp.
 * Walks forward through business windows, skipping non-business time and holidays.
 */
export function addBusinessMinutes(config: BusinessHoursConfig, from: Date, minutesToAdd: number): Date {
  if (minutesToAdd <= 0) return from;

  let remaining = minutesToAdd;
  let cursor = nextBusinessHourStart(config, from);

  for (let safety = 0; safety < 365 * 24 && remaining > 0; safety++) {
    const closeTime = nextBusinessHourClose(config, cursor);
    const availableMs = closeTime.getTime() - cursor.getTime();
    const availableMinutes = availableMs / 60000;

    if (availableMinutes <= 0) {
      // Degenerate window — advance past it to prevent infinite loop
      cursor = nextBusinessHourStart(config, new Date(closeTime.getTime() + 60000));
      continue;
    }

    if (remaining <= availableMinutes) {
      return new Date(cursor.getTime() + remaining * 60000);
    }

    remaining -= availableMinutes;
    // Advance past the close and find next open
    cursor = nextBusinessHourStart(config, new Date(closeTime.getTime() + 60000));
  }

  // Fallback: shouldn't happen with valid schedules
  return new Date(from.getTime() + minutesToAdd * 60000);
}
