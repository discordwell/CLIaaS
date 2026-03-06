/**
 * Holiday calendar management — CRUD and resolution for business hours integration.
 */

import type { HolidayCalendar, HolidayCalendarEntry, HolidayEntry } from './types';
import { getHolidayCalendars, addHolidayCalendar, updateHolidayCalendar, removeHolidayCalendar, genId } from './store';

export function listHolidayCalendars(id?: string): HolidayCalendar[] {
  return getHolidayCalendars(id);
}

export function createHolidayCalendar(
  input: { name: string; description?: string; entries?: Omit<HolidayCalendarEntry, 'id'>[] },
): HolidayCalendar {
  const now = new Date().toISOString();
  const calendar: HolidayCalendar = {
    id: genId('hc'),
    name: input.name,
    description: input.description,
    entries: (input.entries ?? []).map(e => ({ ...e, id: genId('he') })),
    createdAt: now,
    updatedAt: now,
  };
  addHolidayCalendar(calendar);
  return calendar;
}

export function updateCalendar(
  id: string,
  updates: Partial<Pick<HolidayCalendar, 'name' | 'description'>>,
): HolidayCalendar | null {
  return updateHolidayCalendar(id, updates);
}

export function deleteHolidayCalendar(id: string): boolean {
  return removeHolidayCalendar(id);
}

export function addEntryToCalendar(
  calendarId: string,
  entry: Omit<HolidayCalendarEntry, 'id'>,
): HolidayCalendar | null {
  const calendars = getHolidayCalendars(calendarId);
  if (calendars.length === 0) return null;
  const cal = calendars[0];
  const newEntry: HolidayCalendarEntry = { ...entry, id: genId('he') };
  const updatedEntries = [...cal.entries, newEntry];
  return updateHolidayCalendar(calendarId, { entries: updatedEntries });
}

export function removeEntryFromCalendar(
  calendarId: string,
  entryId: string,
): HolidayCalendar | null {
  const calendars = getHolidayCalendars(calendarId);
  if (calendars.length === 0) return null;
  const cal = calendars[0];
  const updatedEntries = cal.entries.filter(e => e.id !== entryId);
  return updateHolidayCalendar(calendarId, { entries: updatedEntries });
}

/**
 * Resolve all holidays for a business hours schedule by flattening
 * linked holiday calendar entries into HolidayEntry[].
 */
export function resolveHolidaysForSchedule(
  calendarIds: string[],
  existingHolidays: (string | HolidayEntry)[] = [],
): HolidayEntry[] {
  const result: HolidayEntry[] = [];

  // Convert existing string holidays to HolidayEntry
  for (const h of existingHolidays) {
    if (typeof h === 'string') {
      result.push({ date: h });
    } else {
      result.push(h);
    }
  }

  // Flatten linked calendar entries
  for (const calId of calendarIds) {
    const cals = getHolidayCalendars(calId);
    if (cals.length === 0) continue;
    for (const entry of cals[0].entries) {
      result.push({
        date: entry.date,
        name: entry.name,
        recurring: entry.recurring,
        startTime: entry.startTime,
        endTime: entry.endTime,
      });
    }
  }

  return result;
}
