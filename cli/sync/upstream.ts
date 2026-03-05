/**
 * Upstream Sync Engine — push changes back to source helpdesk platforms.
 *
 * Flow:
 *   1. Actions (ticket_update, ticket_reply, etc.) call enqueueUpstream()
 *   2. User explicitly triggers upstreamPush() via CLI or MCP tool
 *   3. Engine loads pending entries, resolves auth, gets adapter, pushes
 *   4. Results are recorded in the upstream_outbox table
 *
 * Graceful degradation: enqueueUpstream() is a no-op without DATABASE_URL.
 */

import { eq, and, lt } from 'drizzle-orm';
import { resolveConnectorAuth } from './auth.js';
import { getUpstreamAdapter } from './upstream-adapters/index.js';

// ---- Types ----

export type UpstreamOperation = 'create_ticket' | 'update_ticket' | 'create_reply' | 'create_note';

export interface EnqueueParams {
  connector: string;
  operation: UpstreamOperation;
  ticketId: string;
  externalId?: string;
  payload: Record<string, unknown>;
  workspaceId?: string;
}

export type DedupeAction = 'enqueued' | 'skipped' | 'merged';

export interface UpstreamPushResult {
  pushed: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export interface UpstreamStatusResult {
  connector: string;
  pending: number;
  pushed: number;
  failed: number;
  skipped: number;
}

// ---- DB context helper ----

type DbContext = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  schema: typeof import('@/db/schema');
  workspaceId: string;
};

async function requireDbContext(): Promise<DbContext> {
  if (!process.env.DATABASE_URL) {
    throw new Error('Upstream sync requires DATABASE_URL.');
  }

  const [{ db }, schema] = await Promise.all([
    import('@/db'),
    import('@/db/schema'),
  ]);

  const workspaceName = process.env.CLIAAS_WORKSPACE;
  let workspaceId: string | null = null;

  if (workspaceName) {
    const byName = await db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.name, workspaceName))
      .limit(1);
    if (byName[0]) workspaceId = byName[0].id;
  }

  if (!workspaceId) {
    const rows = await db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .orderBy(schema.workspaces.createdAt)
      .limit(1);
    workspaceId = rows[0]?.id ?? null;
  }

  if (!workspaceId) throw new Error('No workspace found. Run setup first.');
  return { db, schema, workspaceId };
}

// ---- Enqueue ----

/**
 * Insert a pending entry into the upstream_outbox with dedup protection.
 * No-op if DATABASE_URL is not set (JSONL mode).
 *
 * Dedup rules:
 *  - create_ticket: skip if a pending create already exists for same connector+ticketId
 *  - update_ticket: merge payload (latest fields overwrite) if a pending update exists
 *  - create_reply / create_note: skip if a pending entry has identical body; allow otherwise
 */
export async function enqueueUpstream(params: EnqueueParams): Promise<DedupeAction> {
  if (!process.env.DATABASE_URL) return 'skipped'; // JSONL mode — silently skip

  try {
    const ctx = await requireDbContext();
    const { db, schema, workspaceId } = ctx;

    // Check for existing pending entry with same (connector, operation, ticketId)
    const wsId = params.workspaceId ?? workspaceId;
    const existing = await db
      .select()
      .from(schema.upstreamOutbox)
      .where(
        and(
          eq(schema.upstreamOutbox.workspaceId, wsId),
          eq(schema.upstreamOutbox.connector, params.connector),
          eq(schema.upstreamOutbox.operation, params.operation),
          eq(schema.upstreamOutbox.ticketId, params.ticketId),
          eq(schema.upstreamOutbox.status, 'pending'),
        ),
      );

    if (existing.length > 0) {
      const match = existing[0];

      switch (params.operation) {
        case 'create_ticket':
          // Duplicate create — skip silently
          return 'skipped';

        case 'update_ticket': {
          // Merge payload — latest fields overwrite
          const mergedPayload = {
            ...(match.payload as Record<string, unknown>),
            ...params.payload,
          };
          await db
            .update(schema.upstreamOutbox)
            .set({ payload: mergedPayload })
            .where(eq(schema.upstreamOutbox.id, match.id));
          return 'merged';
        }

        case 'create_reply':
        case 'create_note': {
          // Skip if body is identical; allow if different
          const existingBody = (match.payload as Record<string, unknown>)?.body;
          const newBody = params.payload?.body;
          if (existingBody === newBody) {
            return 'skipped';
          }
          // Different body — fall through to insert
          break;
        }
      }
    }

    await db.insert(schema.upstreamOutbox).values({
      workspaceId: wsId,
      connector: params.connector,
      operation: params.operation,
      ticketId: params.ticketId,
      externalId: params.externalId ?? null,
      payload: params.payload,
      status: 'pending',
    });
    return 'enqueued';
  } catch {
    // Enqueue is fire-and-forget — don't let it break the action
    return 'skipped';
  }
}

// ---- Push ----

/**
 * Push pending upstream outbox entries to their source platforms.
 * Optionally filter by connector name.
 */
export async function upstreamPush(connector?: string): Promise<UpstreamPushResult> {
  const result: UpstreamPushResult = { pushed: 0, skipped: 0, failed: 0, errors: [] };

  const ctx = await requireDbContext();
  const { db, schema, workspaceId } = ctx;

  // Load pending entries (scoped to current workspace)
  const conditions = [
    eq(schema.upstreamOutbox.status, 'pending'),
    eq(schema.upstreamOutbox.workspaceId, workspaceId),
  ];
  if (connector) {
    conditions.push(eq(schema.upstreamOutbox.connector, connector));
  }

  const pendingRows = await db
    .select()
    .from(schema.upstreamOutbox)
    .where(and(...conditions));

  if (pendingRows.length === 0) return result;

  // Group by connector
  const byConnector = new Map<string, typeof pendingRows>();
  for (const row of pendingRows) {
    const existing = byConnector.get(row.connector) ?? [];
    existing.push(row);
    byConnector.set(row.connector, existing);
  }

  // Process each connector group
  for (const [connectorName, rows] of byConnector) {
    const auth = resolveConnectorAuth(connectorName);
    if (!auth) {
      // No auth configured — mark all as skipped
      for (const row of rows) {
        await db.update(schema.upstreamOutbox).set({
          status: 'skipped',
          error: `No auth configured for ${connectorName}`,
        }).where(eq(schema.upstreamOutbox.id, row.id));
        result.skipped++;
      }
      continue;
    }

    const adapter = getUpstreamAdapter(connectorName, auth);
    if (!adapter) {
      for (const row of rows) {
        await db.update(schema.upstreamOutbox).set({
          status: 'skipped',
          error: `No upstream adapter for ${connectorName}`,
        }).where(eq(schema.upstreamOutbox.id, row.id));
        result.skipped++;
      }
      continue;
    }

    // Push each entry
    for (const row of rows) {
      try {
        const payload = row.payload as Record<string, unknown>;

        switch (row.operation) {
          case 'update_ticket': {
            if (!adapter.supportsUpdate) {
              await db.update(schema.upstreamOutbox).set({
                status: 'skipped',
                error: `${connectorName} does not support ticket updates`,
              }).where(eq(schema.upstreamOutbox.id, row.id));
              result.skipped++;
              continue;
            }
            if (!row.externalId) {
              await db.update(schema.upstreamOutbox).set({
                status: 'skipped',
                error: 'No external ID for ticket update',
              }).where(eq(schema.upstreamOutbox.id, row.id));
              result.skipped++;
              continue;
            }
            await adapter.updateTicket(row.externalId, payload);
            break;
          }
          case 'create_reply': {
            if (!adapter.supportsReply) {
              await db.update(schema.upstreamOutbox).set({
                status: 'skipped',
                error: `${connectorName} does not support replies`,
              }).where(eq(schema.upstreamOutbox.id, row.id));
              result.skipped++;
              continue;
            }
            if (!row.externalId) {
              await db.update(schema.upstreamOutbox).set({
                status: 'skipped',
                error: 'No external ID for reply',
              }).where(eq(schema.upstreamOutbox.id, row.id));
              result.skipped++;
              continue;
            }
            await adapter.postReply(row.externalId, payload as { body: string });
            break;
          }
          case 'create_note': {
            if (!row.externalId) {
              await db.update(schema.upstreamOutbox).set({
                status: 'skipped',
                error: 'No external ID for note',
              }).where(eq(schema.upstreamOutbox.id, row.id));
              result.skipped++;
              continue;
            }
            await adapter.postNote(row.externalId, payload as { body: string });
            break;
          }
          case 'create_ticket': {
            const createResult = await adapter.createTicket(payload as {
              subject: string;
              description: string;
              priority?: string;
              requester?: string;
              tags?: string[];
            });
            // Store the external ID from the created ticket
            await db.update(schema.upstreamOutbox).set({
              externalResult: createResult,
            }).where(eq(schema.upstreamOutbox.id, row.id));
            break;
          }
        }

        // Mark as pushed
        await db.update(schema.upstreamOutbox).set({
          status: 'pushed',
          pushedAt: new Date(),
        }).where(eq(schema.upstreamOutbox.id, row.id));
        result.pushed++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await db.update(schema.upstreamOutbox).set({
          status: 'failed',
          error: errorMsg,
          retryCount: (row.retryCount ?? 0) + 1,
        }).where(eq(schema.upstreamOutbox.id, row.id));
        result.failed++;
        result.errors.push(`${connectorName}/${row.operation} for ticket ${row.ticketId}: ${errorMsg}`);
      }
    }
  }

  return result;
}

// ---- Status ----

/**
 * Get upstream outbox counts grouped by connector and status.
 */
export async function upstreamStatus(connector?: string): Promise<UpstreamStatusResult[]> {
  const ctx = await requireDbContext();
  const { db, schema, workspaceId } = ctx;

  const conditions = [
    eq(schema.upstreamOutbox.workspaceId, workspaceId),
  ];
  if (connector) {
    conditions.push(eq(schema.upstreamOutbox.connector, connector));
  }

  const rows = await db
    .select()
    .from(schema.upstreamOutbox)
    .where(and(...conditions));

  // Aggregate by connector
  const byConnector = new Map<string, UpstreamStatusResult>();

  for (const row of rows) {
    let entry = byConnector.get(row.connector);
    if (!entry) {
      entry = { connector: row.connector, pending: 0, pushed: 0, failed: 0, skipped: 0 };
      byConnector.set(row.connector, entry);
    }
    switch (row.status) {
      case 'pending': entry.pending++; break;
      case 'pushed': entry.pushed++; break;
      case 'failed': entry.failed++; break;
      case 'skipped': entry.skipped++; break;
    }
  }

  return Array.from(byConnector.values());
}

// ---- Retry ----

/**
 * Reset failed entries (with retryCount < 3) back to pending, then push.
 */
export async function upstreamRetryFailed(connector?: string): Promise<UpstreamPushResult> {
  const ctx = await requireDbContext();
  const { db, schema, workspaceId } = ctx;

  const conditions = [
    eq(schema.upstreamOutbox.status, 'failed'),
    eq(schema.upstreamOutbox.workspaceId, workspaceId),
    lt(schema.upstreamOutbox.retryCount, 3),
  ];
  if (connector) {
    conditions.push(eq(schema.upstreamOutbox.connector, connector));
  }

  // Reset failed → pending
  await db.update(schema.upstreamOutbox).set({
    status: 'pending',
    error: null,
  }).where(and(...conditions));

  // Now push
  return upstreamPush(connector);
}
