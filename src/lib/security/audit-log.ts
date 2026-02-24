/**
 * Immutable append-only audit log with SHA-256 hash chain.
 * Provides tamper-evident logging for SOC 2 compliance.
 * Uses JSONL persistence via shared store helpers.
 */

import { createHash, randomUUID } from 'crypto';
import { readJsonlFile, writeJsonlFile } from '@/lib/jsonl-store';
import { createLogger } from '@/lib/logger';
import { walEnqueue, walFlush } from '@/lib/audit-wal';

const logger = createLogger('secure-audit');

// ---- Types ----

export interface SecureAuditEntry {
  id: string;
  sequence: number;
  timestamp: string;
  actor: {
    type: 'user' | 'system' | 'api';
    id: string;
    name: string;
    ip: string;
  };
  action: string;
  resource: { type: string; id: string };
  outcome: 'success' | 'failure' | 'denied';
  details: Record<string, unknown>;
  hash: string;
  prevHash: string;
  workspaceId?: string;
}

export interface SecureAuditFilters {
  action?: string;
  resource?: string;
  actorId?: string;
  outcome?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

// ---- Global singleton ----

const JSONL_FILE = 'secure-audit-log.jsonl';
const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

declare global {
  // eslint-disable-next-line no-var
  var __cliaasSecureAudit: SecureAuditEntry[] | undefined;
  // eslint-disable-next-line no-var
  var __cliaasSecureAuditLoaded: boolean | undefined;
}

function getStore(): SecureAuditEntry[] {
  if (!globalThis.__cliaasSecureAudit) {
    globalThis.__cliaasSecureAudit = [];
  }
  return globalThis.__cliaasSecureAudit;
}

function computeHash(
  prevHash: string,
  sequence: number,
  timestamp: string,
  action: string,
  details: Record<string, unknown>,
): string {
  const payload = prevHash + sequence + timestamp + action + JSON.stringify(details);
  return createHash('sha256').update(payload).digest('hex');
}

// ---- Seed demo data ----

function ensureDefaults(): void {
  if (globalThis.__cliaasSecureAuditLoaded) return;
  globalThis.__cliaasSecureAuditLoaded = true;

  const store = getStore();

  // Try to load from JSONL first
  const persisted = readJsonlFile<SecureAuditEntry>(JSONL_FILE);
  if (persisted.length > 0) {
    store.push(...persisted);
    return;
  }

  // Seed 15 demo entries
  const now = Date.now();
  const demoEntries: Omit<SecureAuditEntry, 'id' | 'sequence' | 'hash' | 'prevHash' | 'timestamp'>[] = [
    { actor: { type: 'user', id: 'user-1', name: 'Alice Chen', ip: '192.168.1.10' }, action: 'auth.login', resource: { type: 'session', id: 'sess-101' }, outcome: 'success', details: { method: 'password', mfa: true } },
    { actor: { type: 'user', id: 'user-2', name: 'Bob Martinez', ip: '192.168.1.22' }, action: 'auth.login', resource: { type: 'session', id: 'sess-102' }, outcome: 'success', details: { method: 'sso', provider: 'okta' } },
    { actor: { type: 'user', id: 'user-3', name: 'Charlie Park', ip: '10.0.0.5' }, action: 'auth.login', resource: { type: 'session', id: 'sess-103' }, outcome: 'failure', details: { reason: 'invalid_password', attempts: 3 } },
    { actor: { type: 'user', id: 'user-1', name: 'Alice Chen', ip: '192.168.1.10' }, action: 'data.access', resource: { type: 'ticket', id: 'tkt-501' }, outcome: 'success', details: { fields: ['subject', 'description', 'customer_email'] } },
    { actor: { type: 'api', id: 'api-key-1', name: 'Zendesk Sync', ip: '203.0.113.50' }, action: 'data.export', resource: { type: 'tickets', id: 'batch-1' }, outcome: 'success', details: { count: 150, format: 'json' } },
    { actor: { type: 'user', id: 'user-1', name: 'Alice Chen', ip: '192.168.1.10' }, action: 'config.change', resource: { type: 'settings', id: 'workspace' }, outcome: 'success', details: { setting: 'retention_days', from: 90, to: 365 } },
    { actor: { type: 'user', id: 'user-4', name: 'Dana Kim', ip: '10.0.0.99' }, action: 'auth.login', resource: { type: 'session', id: 'sess-104' }, outcome: 'denied', details: { reason: 'account_locked', lockReason: 'too_many_failures' } },
    { actor: { type: 'system', id: 'system', name: 'CLIaaS System', ip: '127.0.0.1' }, action: 'system.backup', resource: { type: 'database', id: 'primary' }, outcome: 'success', details: { sizeBytes: 52428800, duration: '12s' } },
    { actor: { type: 'user', id: 'user-2', name: 'Bob Martinez', ip: '192.168.1.22' }, action: 'permission.change', resource: { type: 'user', id: 'user-5' }, outcome: 'success', details: { role: { from: 'agent', to: 'admin' } } },
    { actor: { type: 'user', id: 'user-5', name: 'Eve Foster', ip: '10.0.0.42' }, action: 'auth.login', resource: { type: 'session', id: 'sess-105' }, outcome: 'denied', details: { reason: 'ip_blocked', blockedRange: '10.0.0.0/24' } },
    { actor: { type: 'api', id: 'api-key-2', name: 'Slack Integration', ip: '34.192.10.1' }, action: 'webhook.receive', resource: { type: 'integration', id: 'slack-1' }, outcome: 'success', details: { event: 'message.posted', channel: '#support' } },
    { actor: { type: 'user', id: 'user-1', name: 'Alice Chen', ip: '192.168.1.10' }, action: 'config.change', resource: { type: 'sla', id: 'sla-premium' }, outcome: 'success', details: { field: 'response_time', from: '4h', to: '2h' } },
    { actor: { type: 'system', id: 'system', name: 'CLIaaS System', ip: '127.0.0.1' }, action: 'system.maintenance', resource: { type: 'index', id: 'search-rebuild' }, outcome: 'success', details: { documentsIndexed: 12500, duration: '45s' } },
    { actor: { type: 'user', id: 'user-3', name: 'Charlie Park', ip: '10.0.0.5' }, action: 'auth.login', resource: { type: 'session', id: 'sess-106' }, outcome: 'success', details: { method: 'password', mfa: true, previousFailures: 3 } },
    { actor: { type: 'user', id: 'user-2', name: 'Bob Martinez', ip: '192.168.1.22' }, action: 'data.delete', resource: { type: 'customer', id: 'cust-789' }, outcome: 'success', details: { reason: 'gdpr_erasure', recordsRemoved: 23 } },
  ];

  demoEntries.forEach((entry, i) => {
    const prevHash = store.length > 0
      ? store[store.length - 1].hash
      : GENESIS_HASH;
    const sequence = store.length + 1;
    const timestamp = new Date(now - (demoEntries.length - i) * 3600000).toISOString();
    const hash = computeHash(prevHash, sequence, timestamp, entry.action, entry.details);

    store.push({
      ...entry,
      id: randomUUID(),
      sequence,
      timestamp,
      hash,
      prevHash,
    });
  });

  persist();
}

function persist(): void {
  writeJsonlFile(JSONL_FILE, getStore());
}

async function persistToDb(record: SecureAuditEntry): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const { db } = await import('@/db');
  const schema = await import('@/db/schema');

  // Use the workspaceId from the record if provided, otherwise try first workspace
  let workspaceId = record.workspaceId;
  if (!workspaceId) {
    const workspaceRows = await db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .limit(1);
    workspaceId = workspaceRows[0]?.id;
    if (!workspaceId) return;
  }

  await db.insert(schema.auditEvents).values({
    workspaceId,
    actorType: record.actor.type,
    actorId: null,
    action: record.action,
    objectType: record.resource.type,
    objectId: null,
    createdAt: new Date(record.timestamp),
    diff: {
      outcome: record.outcome,
      actor: record.actor,
      resource: record.resource,
      details: record.details,
      hash: record.hash,
      prevHash: record.prevHash,
      sequence: record.sequence,
    },
  });
}

// ---- Promise-based mutex for hash chain integrity ----

let _chainLock: Promise<void> = Promise.resolve();

/** @internal Reset the chain lock between tests */
export function _resetChainLock(): void {
  _chainLock = Promise.resolve();
}

// ---- Public API ----

export async function recordSecureAudit(
  entry: Omit<SecureAuditEntry, 'id' | 'sequence' | 'hash' | 'prevHash' | 'timestamp'> & { workspaceId?: string },
): Promise<SecureAuditEntry> {
  let release: () => void;
  const prev = _chainLock;
  _chainLock = new Promise(r => { release = r; });
  await prev;

  try {
    ensureDefaults();
    const store = getStore();

    const prevHash = store.length > 0
      ? store[store.length - 1].hash
      : GENESIS_HASH;
    const sequence = store.length + 1;
    const timestamp = new Date().toISOString();
    const hash = computeHash(prevHash, sequence, timestamp, entry.action, entry.details);

    const record: SecureAuditEntry = {
      ...entry,
      id: randomUUID(),
      sequence,
      timestamp,
      hash,
      prevHash,
      workspaceId: entry.workspaceId,
    };

    store.push(record);
    persist();

    // Synchronous DB persistence with WAL fallback
    try {
      await persistToDb(record);
      // On success, flush any pending WAL entries
      await walFlush<SecureAuditEntry>('__cliaasSecureAuditWal', persistToDb);
    } catch (err) {
      logger.warn({ err }, 'Secure audit DB write failed, queuing to WAL');
      walEnqueue('__cliaasSecureAuditWal', record);
    }

    return record;
  } finally {
    release!();
  }
}

export async function querySecureAuditFromDb(
  filters: SecureAuditFilters = {},
): Promise<{ entries: SecureAuditEntry[]; total: number } | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { desc, sql, eq, gte, lte, and } = await import('drizzle-orm');

    const conditions: unknown[] = [];
    if (filters.action) {
      conditions.push(eq(schema.auditEvents.action, filters.action));
    }
    if (filters.actorId) {
      conditions.push(sql`${schema.auditEvents.diff}->>'actor' IS NOT NULL AND ${schema.auditEvents.diff}->'actor'->>'id' = ${filters.actorId}`);
    }
    if (filters.from) {
      conditions.push(gte(schema.auditEvents.createdAt, new Date(filters.from)));
    }
    if (filters.to) {
      conditions.push(lte(schema.auditEvents.createdAt, new Date(filters.to)));
    }

    const whereClause = conditions.length > 0
      ? and(...(conditions as Parameters<typeof and>))
      : undefined;

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.auditEvents)
      .where(whereClause);
    const total = Number(countResult[0]?.count ?? 0);

    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 50;

    const rows = await db
      .select()
      .from(schema.auditEvents)
      .where(whereClause)
      .orderBy(desc(schema.auditEvents.createdAt))
      .offset(offset)
      .limit(limit);

    const entries: SecureAuditEntry[] = rows.map((r: typeof rows[0]) => {
      const diff = (r.diff as Record<string, unknown>) ?? {};
      return {
        id: r.id,
        sequence: (diff.sequence as number) ?? 0,
        timestamp: r.createdAt.toISOString(),
        actor: (diff.actor as SecureAuditEntry['actor']) ?? { type: 'system', id: r.actorType, name: '', ip: '' },
        action: r.action,
        resource: (diff.resource as SecureAuditEntry['resource']) ?? { type: r.objectType, id: r.objectId ?? '' },
        outcome: (diff.outcome as SecureAuditEntry['outcome']) ?? 'success',
        details: (diff.details as Record<string, unknown>) ?? {},
        hash: (diff.hash as string) ?? '',
        prevHash: (diff.prevHash as string) ?? '',
        workspaceId: r.workspaceId ?? undefined,
      };
    });

    return { entries, total };
  } catch (err) {
    logger.warn({ err }, 'Failed to query secure audit from DB');
    return null;
  }
}

export function querySecureAudit(
  filters: SecureAuditFilters = {},
): { entries: SecureAuditEntry[]; total: number } {
  ensureDefaults();
  let results = [...getStore()];

  if (filters.action) {
    results = results.filter((e) => e.action === filters.action);
  }
  if (filters.resource) {
    results = results.filter((e) => e.resource.type === filters.resource);
  }
  if (filters.actorId) {
    results = results.filter((e) => e.actor.id === filters.actorId);
  }
  if (filters.outcome) {
    results = results.filter((e) => e.outcome === filters.outcome);
  }
  if (filters.from) {
    const fromTime = new Date(filters.from).getTime();
    results = results.filter((e) => new Date(e.timestamp).getTime() >= fromTime);
  }
  if (filters.to) {
    const toTime = new Date(filters.to).getTime();
    results = results.filter((e) => new Date(e.timestamp).getTime() <= toTime);
  }

  // Sort newest first
  results.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const total = results.length;
  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? 50;
  const entries = results.slice(offset, offset + limit);

  return { entries, total };
}

export function verifyChainIntegrity(): {
  valid: boolean;
  brokenAt?: number;
  totalEntries: number;
} {
  ensureDefaults();
  const store = getStore();

  for (let i = 0; i < store.length; i++) {
    const entry = store[i];
    const expectedPrev = i === 0 ? GENESIS_HASH : store[i - 1].hash;

    if (entry.prevHash !== expectedPrev) {
      return { valid: false, brokenAt: entry.sequence, totalEntries: store.length };
    }

    const expectedHash = computeHash(
      entry.prevHash,
      entry.sequence,
      entry.timestamp,
      entry.action,
      entry.details,
    );

    if (entry.hash !== expectedHash) {
      return { valid: false, brokenAt: entry.sequence, totalEntries: store.length };
    }
  }

  return { valid: true, totalEntries: store.length };
}

export function getChainHead(): { hash: string; sequence: number } | null {
  ensureDefaults();
  const store = getStore();
  if (store.length === 0) return null;
  const last = store[store.length - 1];
  return { hash: last.hash, sequence: last.sequence };
}

export function exportSecureAudit(
  format: 'json' | 'csv',
  filters: SecureAuditFilters = {},
): string {
  const { entries } = querySecureAudit({ ...filters, limit: 100000 });

  if (format === 'json') {
    return JSON.stringify(entries, null, 2);
  }

  // CSV
  const headers = [
    'id', 'sequence', 'timestamp', 'actor_type', 'actor_id', 'actor_name',
    'actor_ip', 'action', 'resource_type', 'resource_id', 'outcome', 'details',
    'hash', 'prevHash',
  ];
  const rows = entries.map((e) =>
    [
      e.id, e.sequence, e.timestamp, e.actor.type, e.actor.id, e.actor.name,
      e.actor.ip, e.action, e.resource.type, e.resource.id, e.outcome,
      JSON.stringify(e.details), e.hash, e.prevHash,
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  );
  return [headers.join(','), ...rows].join('\n');
}
