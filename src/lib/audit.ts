// ---- Types ----

export interface AuditEntry {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  action: string;
  resource: string;
  resourceId: string;
  details: Record<string, unknown>;
  ipAddress: string;
}

export interface AuditFilters {
  action?: string;
  resource?: string;
  userId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

// ---- Circular buffer (last 10,000 entries) ----

const MAX_ENTRIES = 10000;
const buffer: AuditEntry[] = [];
let defaultsLoaded = false;

function ensureDefaults(): void {
  if (defaultsLoaded) return;
  defaultsLoaded = true;

  const now = Date.now();
  const demoEntries: Omit<AuditEntry, 'id' | 'timestamp'>[] = [
    { userId: 'user-1', userName: 'Alice Chen', action: 'user.login', resource: 'session', resourceId: 'sess-1', details: { method: 'password' }, ipAddress: '192.168.1.10' },
    { userId: 'user-1', userName: 'Alice Chen', action: 'ticket.create', resource: 'ticket', resourceId: 'tkt-101', details: { subject: 'Login issue' }, ipAddress: '192.168.1.10' },
    { userId: 'user-2', userName: 'Bob Martinez', action: 'ticket.assign', resource: 'ticket', resourceId: 'tkt-101', details: { assignee: 'Charlie' }, ipAddress: '192.168.1.22' },
    { userId: 'user-2', userName: 'Bob Martinez', action: 'ticket.update', resource: 'ticket', resourceId: 'tkt-101', details: { field: 'priority', from: 'normal', to: 'high' }, ipAddress: '192.168.1.22' },
    { userId: 'user-3', userName: 'Charlie Park', action: 'ticket.close', resource: 'ticket', resourceId: 'tkt-101', details: { resolution: 'Password reset sent' }, ipAddress: '192.168.1.35' },
    { userId: 'user-1', userName: 'Alice Chen', action: 'rule.create', resource: 'rule', resourceId: 'rule-1', details: { name: 'Auto-escalate urgent' }, ipAddress: '192.168.1.10' },
    { userId: 'user-2', userName: 'Bob Martinez', action: 'settings.change', resource: 'settings', resourceId: 'workspace', details: { setting: 'timezone', value: 'America/New_York' }, ipAddress: '192.168.1.22' },
    { userId: 'user-1', userName: 'Alice Chen', action: 'ticket.create', resource: 'ticket', resourceId: 'tkt-102', details: { subject: 'API rate limit error' }, ipAddress: '192.168.1.10' },
    { userId: 'user-3', userName: 'Charlie Park', action: 'rule.update', resource: 'rule', resourceId: 'rule-1', details: { field: 'enabled', value: false }, ipAddress: '192.168.1.35' },
    { userId: 'user-2', userName: 'Bob Martinez', action: 'user.logout', resource: 'session', resourceId: 'sess-2', details: {}, ipAddress: '192.168.1.22' },
  ];

  demoEntries.forEach((entry, i) => {
    buffer.push({
      ...entry,
      id: `audit-${i + 1}`,
      timestamp: new Date(now - (demoEntries.length - i) * 3600000).toISOString(),
    });
  });
}

// ---- Secure audit log delegation ----

import { recordSecureAudit } from './security/audit-log';

// ---- Public API ----

export function recordAudit(
  entry: Omit<AuditEntry, 'id' | 'timestamp'>
): AuditEntry {
  ensureDefaults();
  const record: AuditEntry = {
    ...entry,
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  };
  buffer.push(record);
  // Enforce circular buffer limit
  while (buffer.length > MAX_ENTRIES) {
    buffer.shift();
  }
  // Also write to immutable secure audit log
  try {
    recordSecureAudit({
      actor: { type: 'user', id: entry.userId, name: entry.userName, ip: entry.ipAddress },
      action: entry.action,
      resource: { type: entry.resource, id: entry.resourceId },
      outcome: 'success',
      details: entry.details,
    });
  } catch {
    // Don't let secure audit failures break the main audit flow
  }
  return record;
}

export function queryAudit(filters: AuditFilters = {}): {
  entries: AuditEntry[];
  total: number;
} {
  ensureDefaults();
  let results = [...buffer];

  if (filters.action) {
    results = results.filter((e) => e.action === filters.action);
  }
  if (filters.resource) {
    results = results.filter((e) => e.resource === filters.resource);
  }
  if (filters.userId) {
    results = results.filter((e) => e.userId === filters.userId);
  }
  if (filters.from) {
    const fromTime = new Date(filters.from).getTime();
    results = results.filter(
      (e) => new Date(e.timestamp).getTime() >= fromTime
    );
  }
  if (filters.to) {
    const toTime = new Date(filters.to).getTime();
    results = results.filter(
      (e) => new Date(e.timestamp).getTime() <= toTime
    );
  }

  // Sort newest first
  results.sort(
    (a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const total = results.length;
  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? 50;
  const entries = results.slice(offset, offset + limit);

  return { entries, total };
}

export function exportAudit(
  format: 'json' | 'csv',
  filters: AuditFilters = {}
): string {
  const { entries } = queryAudit({ ...filters, limit: MAX_ENTRIES });

  if (format === 'json') {
    return JSON.stringify(entries, null, 2);
  }

  // CSV
  const headers = [
    'id',
    'timestamp',
    'userId',
    'userName',
    'action',
    'resource',
    'resourceId',
    'details',
    'ipAddress',
  ];
  const rows = entries.map((e) =>
    headers
      .map((h) => {
        const val = e[h as keyof AuditEntry];
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val ?? '');
      })
      .map((v) => `"${v.replace(/"/g, '""')}"`)
      .join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}
