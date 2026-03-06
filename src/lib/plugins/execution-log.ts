/**
 * Plugin execution log store: DB + JSONL fallback.
 */

import { randomUUID } from 'crypto';
import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { tryDb } from '../store-helpers';
import type { PluginExecutionLog } from './types';

const EXEC_LOGS_FILE = 'plugin-execution-logs.jsonl';

export async function logExecution(data: {
  installationId: string;
  workspaceId: string;
  hookName: string;
  status: string;
  durationMs: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
}): Promise<void> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    await db.insert(schema.pluginExecutionLogs).values({
      installationId: data.installationId,
      workspaceId: data.workspaceId,
      hookName: data.hookName,
      status: data.status,
      durationMs: data.durationMs,
      input: data.input ?? null,
      output: data.output ?? null,
      error: data.error ?? null,
    });
    return;
  }

  // JSONL path
  const all = readJsonlFile<PluginExecutionLog>(EXEC_LOGS_FILE);
  all.push({
    id: randomUUID(),
    installationId: data.installationId,
    workspaceId: data.workspaceId,
    hookName: data.hookName,
    status: data.status,
    durationMs: data.durationMs,
    input: data.input,
    output: data.output,
    error: data.error,
    createdAt: new Date().toISOString(),
  });
  // Keep last 1000 entries to prevent unbounded growth
  const trimmed = all.length > 1000 ? all.slice(-1000) : all;
  writeJsonlFile(EXEC_LOGS_FILE, trimmed);
}

export async function getExecutionLogs(
  installationId: string,
  opts?: { limit?: number; since?: string },
): Promise<PluginExecutionLog[]> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq, and, gte, desc } = await import('drizzle-orm');
    const conditions = [eq(schema.pluginExecutionLogs.installationId, installationId)];

    if (opts?.since) {
      conditions.push(gte(schema.pluginExecutionLogs.createdAt, new Date(opts.since)));
    }

    const rows = await db.select().from(schema.pluginExecutionLogs)
      .where(conditions.length > 1 ? and(...conditions) : conditions[0])
      .orderBy(desc(schema.pluginExecutionLogs.createdAt))
      .limit(opts?.limit ?? 50);

    return rows.map(rowToLog);
  }

  // JSONL path
  let logs = readJsonlFile<PluginExecutionLog>(EXEC_LOGS_FILE)
    .filter(l => l.installationId === installationId);

  if (opts?.since) {
    const since = new Date(opts.since).getTime();
    logs = logs.filter(l => new Date(l.createdAt).getTime() >= since);
  }

  logs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return logs.slice(0, opts?.limit ?? 50);
}

// ---- Helpers ----

function rowToLog(row: {
  id: string;
  installationId: string;
  workspaceId: string;
  hookName: string;
  status: string;
  durationMs: number;
  input: unknown;
  output: unknown;
  error: string | null;
  createdAt: Date;
}): PluginExecutionLog {
  return {
    id: row.id,
    installationId: row.installationId,
    workspaceId: row.workspaceId,
    hookName: row.hookName,
    status: row.status,
    durationMs: row.durationMs,
    input: (row.input ?? undefined) as Record<string, unknown> | undefined,
    output: (row.output ?? undefined) as Record<string, unknown> | undefined,
    error: row.error ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}
