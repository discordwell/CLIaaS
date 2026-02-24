/**
 * DB integration tests for audit persistence.
 * Requires a running Postgres with DATABASE_URL set.
 * Run: pnpm test:db
 */

import { describe, it, expect, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@/db/schema';
import { recordAudit, queryAudit } from '@/lib/audit';

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('audit DB persistence', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('recordAudit persists to auditEntries table', async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool, { schema });

    const entry = await recordAudit({
      userId: 'test-user-db',
      userName: 'DB Test User',
      action: 'test.action',
      resource: 'test',
      resourceId: 'test-123',
      details: { integration: true },
      ipAddress: '127.0.0.1',
    });

    // Check DB
    const { eq } = await import('drizzle-orm');
    const rows = await db
      .select()
      .from(schema.auditEntries)
      .where(eq(schema.auditEntries.action, 'test.action'));

    expect(rows.length).toBeGreaterThan(0);
    const dbEntry = rows.find((r) => r.userId === 'test-user-db');
    expect(dbEntry).toBeDefined();
    expect(dbEntry?.userName).toBe('DB Test User');
    expect(entry.id).toBeDefined();
  });

  it('queryAudit reads from DB when available', async () => {
    const result = await queryAudit({ action: 'test.action', limit: 10 });
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.total).toBeGreaterThan(0);
  });
});
