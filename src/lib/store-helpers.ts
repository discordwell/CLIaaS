/**
 * Shared helpers for dual-path (DB + JSONL) stores.
 * Both chatbot and workflow stores use these.
 */

import { sql } from 'drizzle-orm';
import type { AppDb } from '@/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Execute a store operation inside a workspace-scoped RLS transaction.
 * Sets `app.current_workspace_id` (and optionally `app.current_tenant_id`)
 * via SET LOCAL, so the session vars are pool-safe and auto-cleared on commit.
 * Returns null on any failure (missing DB, bad query, etc.) — callers fall through to tryDb/JSONL.
 */
export async function withRls<T>(
  workspaceId: string,
  fn: (ctx: { db: AppDb; schema: typeof import('@/db/schema') }) => Promise<T>,
  tenantId?: string,
): Promise<T | null> {
  if (!UUID_RE.test(workspaceId)) return null;
  if (tenantId && !UUID_RE.test(tenantId)) return null;
  try {
    const { getRlsDb } = await import('@/db');
    const db = getRlsDb();
    if (!db) return null;
    const schema = await import('@/db/schema');
    return db.transaction(async (tx) => {
      // SET LOCAL doesn't support parameterized values ($1), so we use sql.raw().
      // UUID format is validated above to prevent SQL injection.
      await tx.execute(sql`SET LOCAL app.current_workspace_id = '${sql.raw(workspaceId)}'`);
      if (tenantId) {
        await tx.execute(sql`SET LOCAL app.current_tenant_id = '${sql.raw(tenantId)}'`);
      }
      return fn({ db: tx as unknown as AppDb, schema });
    });
  } catch {
    return null;
  }
}

export async function tryDb() {
  try {
    const { getDb } = await import('@/db');
    const db = getDb();
    if (!db) return null;
    const schema = await import('@/db/schema');
    return { db, schema };
  } catch {
    return null;
  }
}

export async function getDefaultWorkspaceId(
  db: Awaited<ReturnType<typeof import('@/db')['getDb']>>,
  schema: typeof import('@/db/schema'),
): Promise<string> {
  if (!db) throw new Error('DB not available');
  const [ws] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).limit(1);
  if (!ws) throw new Error('No workspace found');
  return ws.id;
}
