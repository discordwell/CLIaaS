/**
 * Business hours management.
 * Timezone-aware checks using Intl.DateTimeFormat, elapsed business-minute
 * calculation, and next-open-time lookup.
 *
 * Handles both schedule formats:
 * - Array of { day, startTime, endTime } (BusinessHoursWindow[])
 * - Record<string, Array<{ start, end }>> keyed by dayOfWeek number
 */

import type { BusinessHoursConfig } from './types';
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
 * Handles holidays as string[] or as { date: string }[].
 */
function isHoliday(config: BusinessHoursConfig, dateStr: string): boolean {
  if (!config.holidays || config.holidays.length === 0) return false;
  return config.holidays.includes(dateStr);
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
  if (isHoliday(config, dateStr)) return false;

  const windows = getWindowsForDay(config, dayOfWeek);
  if (windows.length === 0) return false;

  const currentMinutes = hours * 60 + minutes;
  return windows.some(w => {
    const start = timeToMinutes(w.start);
    const end = timeToMinutes(w.end);
    return currentMinutes >= start && currentMinutes < end;
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

    if (isHoliday(config, dateStr)) {
      cursor.setTime(cursor.getTime() + (24 - hours) * 3600000 - mins * 60000);
      continue;
    }

    const windows = getWindowsForDay(config, dayOfWeek);
    if (windows.length === 0) {
      cursor.setTime(cursor.getTime() + (24 - hours) * 3600000 - mins * 60000);
      continue;
    }

    const currentDayMinutes = hours * 60 + mins;

    for (const window of windows) {
      const winStart = timeToMinutes(window.start);
      const winEnd = timeToMinutes(window.end);
      const dayStartAbsolute = new Date(cursor.getTime() - currentDayMinutes * 60000);
      const windowStartAbs = new Date(dayStartAbsolute.getTime() + winStart * 60000);
      const windowEndAbs = new Date(dayStartAbsolute.getTime() + winEnd * 60000);

      const overlapStart = Math.max(start.getTime(), windowStartAbs.getTime());
      const overlapEnd = Math.min(end.getTime(), windowEndAbs.getTime());

      if (overlapEnd > overlapStart) {
        totalMinutes += (overlapEnd - overlapStart) / 60000;
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

    if (isHoliday(config, dateStr)) {
      cursor.setTime(cursor.getTime() + (24 - hours) * 3600000 - minutes * 60000);
      continue;
    }

    const windows = getWindowsForDay(config, dayOfWeek);
    if (windows.length === 0) {
      cursor.setTime(cursor.getTime() + (24 - hours) * 3600000 - minutes * 60000);
      continue;
    }

    const currentMinutes = hours * 60 + minutes;
    const sorted = [...windows].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

    for (const window of sorted) {
      const winStart = timeToMinutes(window.start);
      if (currentMinutes < winStart) {
        return new Date(cursor.getTime() + (winStart - currentMinutes) * 60000);
      }
      const winEnd = timeToMinutes(window.end);
      if (currentMinutes >= winStart && currentMinutes < winEnd) {
        return cursor;
      }
    }

    cursor.setTime(cursor.getTime() + (24 - hours) * 3600000 - minutes * 60000);
  }

  return new Date(start.getTime() + 7 * 86400000);
}
