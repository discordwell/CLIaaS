import { readJsonlFile, writeJsonlFile } from './jsonl-store';

// ---- Types ----

export interface TimeEntry {
  id: string;
  ticketId: string;
  userId: string;
  userName: string;
  startTime: string;
  endTime: string | null;
  durationMinutes: number;
  billable: boolean;
  notes: string;
  customerId?: string;
  groupId?: string;
}

export interface TimeReport {
  totalMinutes: number;
  billableMinutes: number;
  byAgent: Array<{
    userId: string;
    userName: string;
    totalMinutes: number;
    billableMinutes: number;
  }>;
  byTicket: Array<{
    ticketId: string;
    totalMinutes: number;
    billableMinutes: number;
  }>;
  byDay: Array<{
    date: string;
    totalMinutes: number;
    billableMinutes: number;
  }>;
  byCustomer: Array<{
    customerId: string;
    totalMinutes: number;
    billableMinutes: number;
  }>;
  byGroup: Array<{
    groupId: string;
    totalMinutes: number;
    billableMinutes: number;
  }>;
}

export interface TimeFilters {
  ticketId?: string;
  userId?: string;
  from?: string;
  to?: string;
  billable?: boolean;
  customerId?: string;
  groupId?: string;
}

// ---- JSONL persistence ----

const TIME_ENTRIES_FILE = 'time-entries.jsonl';

function persistEntries(): void {
  writeJsonlFile(TIME_ENTRIES_FILE, entries);
}

// ---- In-memory store ----

const entries: TimeEntry[] = [];
const activeTimers: Map<string, TimeEntry> = new Map();
let defaultsLoaded = false;

function ensureDefaults(): void {
  if (defaultsLoaded) return;
  defaultsLoaded = true;

  // Try loading from persisted JSONL file
  const saved = readJsonlFile<TimeEntry>(TIME_ENTRIES_FILE);
  if (saved.length > 0) {
    entries.push(...saved);
    return;
  }

  // Fall back to demo defaults
  const now = Date.now();
  const demoEntries: Omit<TimeEntry, 'id'>[] = [
    {
      ticketId: 'tkt-101',
      userId: 'user-1',
      userName: 'Alice Chen',
      startTime: new Date(now - 6 * 3600000).toISOString(),
      endTime: new Date(now - 5.5 * 3600000).toISOString(),
      durationMinutes: 30,
      billable: true,
      notes: 'Initial investigation',
    },
    {
      ticketId: 'tkt-101',
      userId: 'user-2',
      userName: 'Bob Martinez',
      startTime: new Date(now - 5 * 3600000).toISOString(),
      endTime: new Date(now - 4.25 * 3600000).toISOString(),
      durationMinutes: 45,
      billable: true,
      notes: 'Debugging and fix',
    },
    {
      ticketId: 'tkt-102',
      userId: 'user-1',
      userName: 'Alice Chen',
      startTime: new Date(now - 4 * 3600000).toISOString(),
      endTime: new Date(now - 3.67 * 3600000).toISOString(),
      durationMinutes: 20,
      billable: false,
      notes: 'Internal review',
    },
    {
      ticketId: 'tkt-102',
      userId: 'user-3',
      userName: 'Charlie Park',
      startTime: new Date(now - 3 * 3600000).toISOString(),
      endTime: new Date(now - 2 * 3600000).toISOString(),
      durationMinutes: 60,
      billable: true,
      notes: 'Customer communication and resolution',
    },
    {
      ticketId: 'tkt-103',
      userId: 'user-2',
      userName: 'Bob Martinez',
      startTime: new Date(now - 2 * 3600000).toISOString(),
      endTime: new Date(now - 1.75 * 3600000).toISOString(),
      durationMinutes: 15,
      billable: true,
      notes: 'Quick fix deployment',
    },
  ];

  demoEntries.forEach((entry, i) => {
    entries.push({
      ...entry,
      id: `time-${i + 1}`,
    });
  });
}

// ---- Timer API ----

function timerKey(ticketId: string, userId: string): string {
  return `${ticketId}:${userId}`;
}

export function startTimer(
  ticketId: string,
  userId: string,
  userName: string
): TimeEntry {
  ensureDefaults();
  const key = timerKey(ticketId, userId);

  // If already running, return existing
  const existing = activeTimers.get(key);
  if (existing) return existing;

  const entry: TimeEntry = {
    id: `time-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ticketId,
    userId,
    userName,
    startTime: new Date().toISOString(),
    endTime: null,
    durationMinutes: 0,
    billable: true,
    notes: '',
  };

  activeTimers.set(key, entry);
  return entry;
}

export function stopTimer(
  ticketId: string,
  userId: string
): TimeEntry | null {
  ensureDefaults();
  const key = timerKey(ticketId, userId);
  const entry = activeTimers.get(key);
  if (!entry) return null;

  const endTime = new Date();
  const startTime = new Date(entry.startTime);
  const durationMinutes = Math.round(
    (endTime.getTime() - startTime.getTime()) / 60000
  );

  entry.endTime = endTime.toISOString();
  entry.durationMinutes = Math.max(1, durationMinutes);

  activeTimers.delete(key);
  entries.push(entry);
  persistEntries();
  return entry;
}

export function getActiveTimers(): TimeEntry[] {
  ensureDefaults();
  return Array.from(activeTimers.values());
}

// ---- Manual time logging ----

export function logManualTime(
  input: Omit<TimeEntry, 'id' | 'startTime' | 'endTime'>
): TimeEntry {
  ensureDefaults();
  const now = new Date();
  const entry: TimeEntry = {
    ...input,
    id: `time-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startTime: new Date(
      now.getTime() - input.durationMinutes * 60000
    ).toISOString(),
    endTime: now.toISOString(),
  };
  entries.push(entry);
  persistEntries();
  return entry;
}

// ---- Query ----

export function getTimeEntries(filters: TimeFilters = {}): TimeEntry[] {
  ensureDefaults();
  let results = [...entries];

  if (filters.ticketId) {
    results = results.filter((e) => e.ticketId === filters.ticketId);
  }
  if (filters.userId) {
    results = results.filter((e) => e.userId === filters.userId);
  }
  if (filters.billable !== undefined) {
    results = results.filter((e) => e.billable === filters.billable);
  }
  if (filters.from) {
    const fromTime = new Date(filters.from).getTime();
    results = results.filter(
      (e) => new Date(e.startTime).getTime() >= fromTime
    );
  }
  if (filters.to) {
    const toTime = new Date(filters.to).getTime();
    results = results.filter(
      (e) => new Date(e.startTime).getTime() <= toTime
    );
  }
  if (filters.customerId) {
    results = results.filter((e) => e.customerId === filters.customerId);
  }
  if (filters.groupId) {
    results = results.filter((e) => e.groupId === filters.groupId);
  }

  return results.sort(
    (a, b) =>
      new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
  );
}

// ---- Report ----

export function getTimeReport(filters: TimeFilters = {}): TimeReport {
  const filtered = getTimeEntries(filters);

  let totalMinutes = 0;
  let billableMinutes = 0;

  const agentMap = new Map<
    string,
    { userName: string; totalMinutes: number; billableMinutes: number }
  >();
  const ticketMap = new Map<
    string,
    { totalMinutes: number; billableMinutes: number }
  >();
  const dayMap = new Map<
    string,
    { totalMinutes: number; billableMinutes: number }
  >();
  const customerMap = new Map<
    string,
    { totalMinutes: number; billableMinutes: number }
  >();
  const groupMap = new Map<
    string,
    { totalMinutes: number; billableMinutes: number }
  >();

  for (const entry of filtered) {
    totalMinutes += entry.durationMinutes;
    if (entry.billable) billableMinutes += entry.durationMinutes;

    // By agent
    const agent = agentMap.get(entry.userId) ?? {
      userName: entry.userName,
      totalMinutes: 0,
      billableMinutes: 0,
    };
    agent.totalMinutes += entry.durationMinutes;
    if (entry.billable) agent.billableMinutes += entry.durationMinutes;
    agentMap.set(entry.userId, agent);

    // By ticket
    const ticket = ticketMap.get(entry.ticketId) ?? {
      totalMinutes: 0,
      billableMinutes: 0,
    };
    ticket.totalMinutes += entry.durationMinutes;
    if (entry.billable) ticket.billableMinutes += entry.durationMinutes;
    ticketMap.set(entry.ticketId, ticket);

    // By day
    const day = entry.startTime.slice(0, 10);
    const dayData = dayMap.get(day) ?? {
      totalMinutes: 0,
      billableMinutes: 0,
    };
    dayData.totalMinutes += entry.durationMinutes;
    if (entry.billable) dayData.billableMinutes += entry.durationMinutes;
    dayMap.set(day, dayData);

    // By customer
    if (entry.customerId) {
      const customer = customerMap.get(entry.customerId) ?? {
        totalMinutes: 0,
        billableMinutes: 0,
      };
      customer.totalMinutes += entry.durationMinutes;
      if (entry.billable) customer.billableMinutes += entry.durationMinutes;
      customerMap.set(entry.customerId, customer);
    }

    // By group
    if (entry.groupId) {
      const group = groupMap.get(entry.groupId) ?? {
        totalMinutes: 0,
        billableMinutes: 0,
      };
      group.totalMinutes += entry.durationMinutes;
      if (entry.billable) group.billableMinutes += entry.durationMinutes;
      groupMap.set(entry.groupId, group);
    }
  }

  return {
    totalMinutes,
    billableMinutes,
    byAgent: Array.from(agentMap.entries()).map(([userId, data]) => ({
      userId,
      ...data,
    })),
    byTicket: Array.from(ticketMap.entries()).map(([ticketId, data]) => ({
      ticketId,
      ...data,
    })),
    byDay: Array.from(dayMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    byCustomer: Array.from(customerMap.entries()).map(
      ([customerId, data]) => ({ customerId, ...data })
    ),
    byGroup: Array.from(groupMap.entries()).map(([groupId, data]) => ({
      groupId,
      ...data,
    })),
  };
}
