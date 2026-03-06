import { describe, it, expect, beforeEach } from 'vitest';
import {
  createHolidayCalendar,
  listHolidayCalendars,
  deleteHolidayCalendar,
  addEntryToCalendar,
  removeEntryFromCalendar,
  resolveHolidaysForSchedule,
} from '../holidays';

describe('Holiday Calendar CRUD', () => {
  let calId: string;

  beforeEach(() => {
    // Clean up any prior calendars
    for (const c of listHolidayCalendars()) {
      deleteHolidayCalendar(c.id);
    }
  });

  it('creates a holiday calendar', () => {
    const cal = createHolidayCalendar({
      name: 'US Holidays',
      description: 'Federal holidays',
      entries: [{ name: 'Christmas', date: '2026-12-25' }],
    });
    calId = cal.id;
    expect(cal.name).toBe('US Holidays');
    expect(cal.entries).toHaveLength(1);
    expect(cal.entries[0].name).toBe('Christmas');
  });

  it('lists holiday calendars', () => {
    createHolidayCalendar({ name: 'Cal A' });
    createHolidayCalendar({ name: 'Cal B' });
    expect(listHolidayCalendars().length).toBeGreaterThanOrEqual(2);
  });

  it('adds an entry to a calendar', () => {
    const cal = createHolidayCalendar({ name: 'Test' });
    const updated = addEntryToCalendar(cal.id, { name: "New Year's", date: '2026-01-01' });
    expect(updated).not.toBeNull();
    expect(updated!.entries).toHaveLength(1);
  });

  it('removes an entry from a calendar', () => {
    const cal = createHolidayCalendar({
      name: 'Test',
      entries: [{ name: 'A', date: '2026-01-01' }, { name: 'B', date: '2026-07-04' }],
    });
    expect(cal.entries).toHaveLength(2);
    const updated = removeEntryFromCalendar(cal.id, cal.entries[0].id);
    expect(updated!.entries).toHaveLength(1);
    expect(updated!.entries[0].name).toBe('B');
  });

  it('deletes a calendar', () => {
    const cal = createHolidayCalendar({ name: 'ToDelete' });
    expect(deleteHolidayCalendar(cal.id)).toBe(true);
    expect(listHolidayCalendars(cal.id)).toHaveLength(0);
  });
});

describe('resolveHolidaysForSchedule', () => {
  beforeEach(() => {
    for (const c of listHolidayCalendars()) {
      deleteHolidayCalendar(c.id);
    }
  });

  it('flattens string holidays into HolidayEntry[]', () => {
    const result = resolveHolidaysForSchedule([], ['2026-12-25', '2026-01-01']);
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe('2026-12-25');
  });

  it('includes entries from linked calendars', () => {
    const cal = createHolidayCalendar({
      name: 'Linked',
      entries: [
        { name: 'Christmas', date: '2026-12-25', recurring: true },
        { name: 'July 4th', date: '2026-07-04' },
      ],
    });
    const result = resolveHolidaysForSchedule([cal.id]);
    expect(result).toHaveLength(2);
    expect(result[0].recurring).toBe(true);
  });

  it('merges existing holidays with calendar entries', () => {
    const cal = createHolidayCalendar({
      name: 'Cal',
      entries: [{ name: 'A', date: '2026-06-01' }],
    });
    const result = resolveHolidaysForSchedule([cal.id], ['2026-01-01']);
    expect(result).toHaveLength(2);
  });
});
