/**
 * Sync health monitoring store: DB with JSONL fallback.
 * Records sync results per connector and exposes health queries.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { tryDb, getDefaultWorkspaceId } from '../store-helpers';

const SYNC_HEALTH_FILE = 'sync-health.jsonl';

export interface SyncHealthRecord {
  id: string;
  workspaceId: string;
  connector: string;
  lastSyncAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  cursorState: object | null;
  recordsSynced: number;
  status: 'idle' | 'syncing' | 'error';
  createdAt: string;
  updatedAt: string;
}

export interface SyncResultInput {
  success: boolean;
  error?: string;
  recordsSynced: number;
  cursorState?: object;
}

// ---- JSONL helpers ----

function readAll(): SyncHealthRecord[] {
  return readJsonlFile<SyncHealthRecord>(SYNC_HEALTH_FILE);
}

function writeAll(records: SyncHealthRecord[]): void {
  writeJsonlFile(SYNC_HEALTH_FILE, records);
}

// ---- DB row mapper ----

function rowToRecord(row: Record<string, unknown>): SyncHealthRecord {
  return {
    id: row.id as string,
    workspaceId: row.workspaceId as string,
    connector: row.connector as string,
    lastSyncAt: (row.lastSyncAt as Date | null)?.toISOString() ?? new Date().toISOString(),
    lastSuccessAt: (row.lastSuccessAt as Date | null)?.toISOString() ?? null,
    lastError: (row.lastError as string) ?? null,
    cursorState: (row.cursorState as object) ?? null,
    recordsSynced: (row.recordsSynced as number) ?? 0,
    status: (row.status as SyncHealthRecord['status']) ?? 'idle',
    createdAt: (row.createdAt as Date)?.toISOString() ?? new Date().toISOString(),
    updatedAt: (row.updatedAt as Date)?.toISOString() ?? new Date().toISOString(),
  };
}

// ---- Public API ----

/**
 * Record the outcome of a sync cycle for a connector.
 */
export async function recordSyncResult(
  workspaceId: string,
  connector: string,
  result: SyncResultInput,
): Promise<void> {
  const ctx = await tryDb();
  const now = new Date();

  if (ctx) {
    const { db, schema } = ctx;
    const wsId = workspaceId === 'default'
      ? await getDefaultWorkspaceId(db, schema).catch(() => 'demo-workspace')
      : workspaceId;

    await db
      .insert(schema.syncHealth)
      .values({
        workspaceId: wsId,
        connector,
        lastSyncAt: now,
        lastSuccessAt: result.success ? now : undefined,
        lastError: result.error ?? null,
        cursorState: result.cursorState ?? {},
        recordsSynced: result.recordsSynced,
        status: result.success ? 'idle' : 'error',
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.syncHealth.workspaceId, schema.syncHealth.connector],
        set: {
          lastSyncAt: now,
          ...(result.success ? { lastSuccessAt: now } : {}),
          lastError: result.error ?? null,
          cursorState: result.cursorState ?? {},
          recordsSynced: result.recordsSynced,
          status: result.success ? 'idle' : 'error',
          updatedAt: now,
        },
      });
    return;
  }

  // JSONL fallback
  const records = readAll();
  const existing = records.find(
    (r) => r.workspaceId === workspaceId && r.connector === connector,
  );

  if (existing) {
    existing.lastSyncAt = now.toISOString();
    if (result.success) existing.lastSuccessAt = now.toISOString();
    existing.lastError = result.error ?? null;
    existing.cursorState = result.cursorState ?? null;
    existing.recordsSynced = result.recordsSynced;
    existing.status = result.success ? 'idle' : 'error';
    existing.updatedAt = now.toISOString();
  } else {
    records.push({
      id: crypto.randomUUID(),
      workspaceId,
      connector,
      lastSyncAt: now.toISOString(),
      lastSuccessAt: result.success ? now.toISOString() : null,
      lastError: result.error ?? null,
      cursorState: result.cursorState ?? null,
      recordsSynced: result.recordsSynced,
      status: result.success ? 'idle' : 'error',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  }

  writeAll(records);
}

/**
 * Get sync health records for all connectors in a workspace.
 */
export async function getSyncHealth(
  workspaceId: string,
): Promise<SyncHealthRecord[]> {
  const ctx = await tryDb();

  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    const wsId = workspaceId === 'default'
      ? await getDefaultWorkspaceId(db, schema).catch(() => 'demo-workspace')
      : workspaceId;

    const rows = await db
      .select()
      .from(schema.syncHealth)
      .where(eq(schema.syncHealth.workspaceId, wsId));
    return rows.map(rowToRecord);
  }

  // JSONL fallback
  return readAll().filter((r) => r.workspaceId === workspaceId);
}

/**
 * Get sync health for a specific connector in a workspace.
 */
export async function getSyncHealthForConnector(
  workspaceId: string,
  connector: string,
): Promise<SyncHealthRecord | null> {
  const ctx = await tryDb();

  if (ctx) {
    const { db, schema } = ctx;
    const { eq, and } = await import('drizzle-orm');
    const wsId = workspaceId === 'default'
      ? await getDefaultWorkspaceId(db, schema).catch(() => 'demo-workspace')
      : workspaceId;

    const [row] = await db
      .select()
      .from(schema.syncHealth)
      .where(
        and(
          eq(schema.syncHealth.workspaceId, wsId),
          eq(schema.syncHealth.connector, connector),
        ),
      );
    return row ? rowToRecord(row) : null;
  }

  // JSONL fallback
  return (
    readAll().find(
      (r) => r.workspaceId === workspaceId && r.connector === connector,
    ) ?? null
  );
}
