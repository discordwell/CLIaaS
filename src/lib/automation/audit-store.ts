/**
 * Persistent audit store for rule executions.
 * Uses DB when available, falls back to in-memory.
 */

import { tryDb } from '@/lib/store-helpers';
import type { AuditEntry } from './executor';

export interface PersistentAuditEntry extends AuditEntry {
  ruleType?: string;
  matched?: boolean;
  actionsExecuted?: number;
  changes?: Record<string, unknown>;
  errors?: string[];
  notificationsSent?: number;
  webhooksFired?: number;
  durationMs?: number;
}

/** Persist an audit entry to DB (fire-and-forget) with in-memory fallback. */
export async function persistAuditEntry(entry: PersistentAuditEntry): Promise<void> {
  // Always store in-memory for immediate access
  storeInMemory(entry);

  // Try DB persistence (fire-and-forget)
  try {
    const conn = await tryDb();
    if (!conn) return;
    const { db, schema } = conn;
    await db.insert(schema.ruleExecutions).values({
      workspaceId: entry.workspaceId!,
      ruleId: entry.ruleId,
      ruleName: entry.ruleName,
      ruleType: (entry.ruleType ?? 'trigger') as 'trigger' | 'macro' | 'automation' | 'sla',
      ticketId: entry.ticketId,
      event: entry.event,
      matched: entry.matched ?? true,
      dryRun: entry.dryRun,
      actionsExecuted: entry.actionsExecuted ?? 0,
      changes: entry.changes ?? entry.actions,
      errors: entry.errors ?? [],
      notificationsSent: entry.notificationsSent ?? 0,
      webhooksFired: entry.webhooksFired ?? 0,
      durationMs: entry.durationMs,
    });
  } catch {
    // DB write failed — entry is still in-memory
  }
}

/** Query audit entries from DB or in-memory fallback. */
export async function queryAuditLog(filters: {
  workspaceId?: string;
  ruleId?: string;
  ticketId?: string;
  since?: Date;
  limit?: number;
}): Promise<PersistentAuditEntry[]> {
  try {
    const conn = await tryDb();
    if (!conn) return queryInMemory(filters);

    const { db, schema } = conn;
    const { eq, and, gte, desc } = await import('drizzle-orm');

    const conditions = [];
    if (filters.workspaceId) conditions.push(eq(schema.ruleExecutions.workspaceId, filters.workspaceId));
    if (filters.ruleId) conditions.push(eq(schema.ruleExecutions.ruleId, filters.ruleId));
    if (filters.ticketId) conditions.push(eq(schema.ruleExecutions.ticketId, filters.ticketId));
    if (filters.since) conditions.push(gte(schema.ruleExecutions.createdAt, filters.since));

    const rows = await db
      .select()
      .from(schema.ruleExecutions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.ruleExecutions.createdAt))
      .limit(filters.limit ?? 100);

    return rows.map(row => ({
      id: row.id,
      ruleId: row.ruleId,
      ruleName: row.ruleName,
      ruleType: row.ruleType,
      ticketId: row.ticketId,
      event: row.event,
      matched: row.matched,
      dryRun: row.dryRun,
      actionsExecuted: row.actionsExecuted,
      changes: row.changes as Record<string, unknown>,
      errors: row.errors as string[],
      notificationsSent: row.notificationsSent ?? 0,
      webhooksFired: row.webhooksFired ?? 0,
      durationMs: row.durationMs ?? undefined,
      actions: row.changes as Record<string, unknown>,
      timestamp: row.createdAt.toISOString(),
      workspaceId: row.workspaceId,
    }));
  } catch {
    return queryInMemory(filters);
  }
}

// ---- In-memory fallback ----

function storeInMemory(entry: PersistentAuditEntry): void {
  const log = global.__cliaasAutomationAudit ?? [];
  log.unshift(entry);
  if (log.length > 500) log.length = 500;
  global.__cliaasAutomationAudit = log;
}

function queryInMemory(filters: {
  workspaceId?: string;
  ruleId?: string;
  ticketId?: string;
  since?: Date;
  limit?: number;
}): PersistentAuditEntry[] {
  let log = (global.__cliaasAutomationAudit ?? []) as PersistentAuditEntry[];
  if (filters.workspaceId) log = log.filter(e => e.workspaceId === filters.workspaceId);
  if (filters.ruleId) log = log.filter(e => e.ruleId === filters.ruleId);
  if (filters.ticketId) log = log.filter(e => e.ticketId === filters.ticketId);
  if (filters.since) log = log.filter(e => new Date(e.timestamp) >= filters.since!);
  return log.slice(0, filters.limit ?? 100);
}
