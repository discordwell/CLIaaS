import { sql } from 'drizzle-orm';
import { getDb, type AppDb } from '@/db';
import { createLogger } from '@/lib/logger';

const logger = createLogger('rls');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Execute a function within a tenant-scoped transaction.
 * Sets PostgreSQL session variables for RLS policy evaluation.
 * Uses SET LOCAL which is transaction-scoped and pool-safe.
 */
export async function withTenantContext<T>(
  workspaceId: string,
  tenantId: string,
  fn: (tx: AppDb) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(workspaceId) || !UUID_RE.test(tenantId)) {
    throw new Error('Invalid UUID for RLS context');
  }
  const db = getDb();
  if (!db) {
    throw new Error('Database not available — cannot use RLS context in demo mode');
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.current_workspace_id = '${sql.raw(workspaceId)}'`);
    await tx.execute(sql`SET LOCAL app.current_tenant_id = '${sql.raw(tenantId)}'`);
    return fn(tx as unknown as AppDb);
  });
}

/**
 * Execute a function in system context (no RLS restrictions).
 * Used for admin/migration operations.
 * Note: Only works when connected as a superuser or the table owner role.
 */
export async function withSystemContext<T>(
  fn: (db: AppDb) => Promise<T>,
): Promise<T> {
  const db = getDb();
  if (!db) {
    throw new Error('Database not available — cannot use system context in demo mode');
  }
  return fn(db);
}

/**
 * Check if RLS is properly configured by testing session variable setting.
 */
export async function verifyRlsSetup(): Promise<{
  available: boolean;
  error?: string;
}> {
  const db = getDb();
  if (!db) {
    return { available: false, error: 'Database not configured' };
  }

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL app.current_workspace_id = '00000000-0000-0000-0000-000000000000'`);
      const result = await tx.execute(sql`SELECT current_setting('app.current_workspace_id', true) as ws_id`);
      const wsId = (result as unknown as { rows: Array<{ ws_id: string }> }).rows?.[0]?.ws_id;
      if (wsId !== '00000000-0000-0000-0000-000000000000') {
        throw new Error('RLS session variable not set correctly');
      }
    });
    return { available: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.warn({ err }, 'RLS verification failed');
    return { available: false, error: message };
  }
}
