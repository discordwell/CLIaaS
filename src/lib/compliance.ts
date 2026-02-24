import { loadTickets, loadMessages } from '@/lib/data';
import { createLogger } from '@/lib/logger';

const logger = createLogger('compliance');

// ---- Types ----

export interface RetentionPolicy {
  id: string;
  resource: string;
  retentionDays: number;
  action: 'delete' | 'archive';
  createdAt: string;
  workspaceId?: string;
}

export interface UserDataExport {
  userId: string;
  exportedAt: string;
  tickets: Array<{
    id: string;
    subject: string;
    status: string;
    createdAt: string;
  }>;
  messages: Array<{
    id: string;
    ticketId: string;
    body: string;
    createdAt: string;
  }>;
}

export interface ComplianceStatus {
  totalRetentionPolicies: number;
  policySummary: Array<{
    resource: string;
    retentionDays: number;
    action: string;
  }>;
  dataSubjects: number;
}

// ---- In-memory store (fallback when no DB) ----

const retentionPolicies: RetentionPolicy[] = [];
let defaultsLoaded = false;

function ensureDefaults(): void {
  if (defaultsLoaded) return;
  defaultsLoaded = true;

  retentionPolicies.push(
    {
      id: 'ret-tickets',
      resource: 'tickets',
      retentionDays: 365,
      action: 'archive',
      createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
    },
    {
      id: 'ret-messages',
      resource: 'messages',
      retentionDays: 180,
      action: 'delete',
      createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
    },
    {
      id: 'ret-logs',
      resource: 'audit_logs',
      retentionDays: 90,
      action: 'delete',
      createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    }
  );
}

// ---- DB helpers for retention policies ----

async function getRetentionDbContext() {
  if (!process.env.DATABASE_URL) return null;
  try {
    const { getDb } = await import('@/db');
    const db = getDb();
    if (!db) return null;
    const schema = await import('@/db/schema');
    const orm = await import('drizzle-orm');
    return { db, schema, orm };
  } catch {
    return null;
  }
}

// ---- Retention Policies ----

export async function listRetentionPolicies(workspaceId?: string): Promise<RetentionPolicy[]> {
  const ctx = await getRetentionDbContext();
  if (ctx && workspaceId) {
    try {
      const { db, schema, orm } = ctx;
      const rows = await db
        .select()
        .from(schema.retentionPolicies)
        .where(orm.eq(schema.retentionPolicies.workspaceId, workspaceId));
      return rows.map((r: typeof rows[0]) => ({
        id: r.id,
        resource: r.resource,
        retentionDays: r.retentionDays,
        action: r.action as 'delete' | 'archive',
        createdAt: r.createdAt.toISOString(),
        workspaceId: r.workspaceId,
      }));
    } catch (err) {
      logger.warn({ err }, 'Failed to query retention policies from DB');
    }
  }

  // Fallback to in-memory
  ensureDefaults();
  return [...retentionPolicies];
}

export async function createRetentionPolicy(
  input: Omit<RetentionPolicy, 'id' | 'createdAt'> & { workspaceId?: string }
): Promise<RetentionPolicy> {
  const ctx = await getRetentionDbContext();
  if (ctx && input.workspaceId) {
    try {
      const { db, schema } = ctx;
      const [row] = await db
        .insert(schema.retentionPolicies)
        .values({
          workspaceId: input.workspaceId,
          resource: input.resource,
          retentionDays: input.retentionDays,
          action: input.action,
        })
        .onConflictDoUpdate({
          target: [schema.retentionPolicies.workspaceId, schema.retentionPolicies.resource],
          set: {
            retentionDays: input.retentionDays,
            action: input.action,
          },
        })
        .returning();
      return {
        id: row.id,
        resource: row.resource,
        retentionDays: row.retentionDays,
        action: row.action as 'delete' | 'archive',
        createdAt: row.createdAt.toISOString(),
        workspaceId: row.workspaceId,
      };
    } catch (err) {
      logger.warn({ err }, 'Failed to persist retention policy to DB');
    }
  }

  // Fallback to in-memory
  ensureDefaults();
  const policy: RetentionPolicy = {
    ...input,
    id: `ret-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  retentionPolicies.push(policy);
  return policy;
}

export async function deleteRetentionPolicy(id: string): Promise<boolean> {
  const ctx = await getRetentionDbContext();
  if (ctx) {
    try {
      const { db, schema, orm } = ctx;
      const deleted = await db
        .delete(schema.retentionPolicies)
        .where(orm.eq(schema.retentionPolicies.id, id))
        .returning();
      if (deleted.length > 0) return true;
    } catch (err) {
      logger.warn({ err }, 'Failed to delete retention policy from DB');
    }
  }

  // Fallback to in-memory
  ensureDefaults();
  const idx = retentionPolicies.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  retentionPolicies.splice(idx, 1);
  return true;
}

export async function checkRetention(): Promise<
  Array<{ resource: string; expiredCount: number; action: string }>
> {
  ensureDefaults();
  const now = Date.now();
  const results: Array<{
    resource: string;
    expiredCount: number;
    action: string;
  }> = [];

  for (const policy of retentionPolicies) {
    const cutoff = now - policy.retentionDays * 86400000;
    let expiredCount = 0;

    if (policy.resource === 'tickets') {
      const tickets = await loadTickets();
      expiredCount = tickets.filter(
        (t) => new Date(t.createdAt).getTime() < cutoff
      ).length;
    } else if (policy.resource === 'messages') {
      const messages = await loadMessages();
      expiredCount = messages.filter(
        (m) => new Date(m.createdAt).getTime() < cutoff
      ).length;
    }

    results.push({
      resource: policy.resource,
      expiredCount,
      action: policy.action,
    });
  }

  return results;
}

// ---- GDPR Data Export ----

export async function exportUserData(
  userId: string
): Promise<UserDataExport> {
  const tickets = await loadTickets();
  const messages = await loadMessages();

  const userTickets = tickets.filter(
    (t) => t.requester === userId || t.assignee === userId
  );
  const ticketIds = new Set(userTickets.map((t) => t.id));
  const userMessages = messages.filter(
    (m) => ticketIds.has(m.ticketId) || m.author === userId
  );

  return {
    userId,
    exportedAt: new Date().toISOString(),
    tickets: userTickets.map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      createdAt: t.createdAt,
    })),
    messages: userMessages.map((m) => ({
      id: m.id,
      ticketId: m.ticketId,
      body: m.body,
      createdAt: m.createdAt,
    })),
  };
}

// ---- GDPR Data Deletion (anonymize) ----

export async function deleteUserData(
  userId: string
): Promise<{ anonymizedTickets: number; anonymizedMessages: number }> {
  // In demo mode, we simulate anonymization
  const tickets = await loadTickets();
  const messages = await loadMessages();

  const ticketCount = tickets.filter(
    (t) => t.requester === userId || t.assignee === userId
  ).length;
  const messageCount = messages.filter((m) => m.author === userId).length;

  return {
    anonymizedTickets: ticketCount,
    anonymizedMessages: messageCount,
  };
}

// ---- Status overview ----

export async function getComplianceStatus(): Promise<ComplianceStatus> {
  ensureDefaults();
  const tickets = await loadTickets();
  const uniqueRequesters = new Set(tickets.map((t) => t.requester));

  return {
    totalRetentionPolicies: retentionPolicies.length,
    policySummary: retentionPolicies.map((p) => ({
      resource: p.resource,
      retentionDays: p.retentionDays,
      action: p.action,
    })),
    dataSubjects: uniqueRequesters.size,
  };
}
