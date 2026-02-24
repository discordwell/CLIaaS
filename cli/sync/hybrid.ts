/**
 * Hybrid Sync Operations — pull, push, conflict management.
 *
 * Shared logic consumed by both CLI commands and MCP tools.
 * All operations are explicit (no silent merges).
 */

import { eq, and, isNull } from 'drizzle-orm';
import type { LocalChange, HostedEntity, SyncConflict } from './conflict.js';
import { partitionChanges } from './conflict.js';

// ---- Types ----

export interface PullResult {
  ticketsPulled: number;
  articlesPulled: number;
  conflicts: number;
  errors: string[];
}

export interface PushResult {
  pushed: number;
  conflicts: number;
  failed: number;
  errors: string[];
}

export interface ConflictRecord {
  id: string;
  entityType: string;
  entityId: string;
  localVersion: unknown;
  hostedVersion: unknown;
  localUpdatedAt: string;
  hostedUpdatedAt: string;
  createdAt: string;
}

// ---- DB context helper (same pattern as db-provider) ----

type DbContext = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  schema: typeof import('@/db/schema');
  workspaceId: string;
};

async function requireDbContext(): Promise<DbContext> {
  if (!process.env.DATABASE_URL) {
    throw new Error('Hybrid sync requires DATABASE_URL. Set it or switch to a different mode.');
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

// ---- Remote provider helper ----

async function getRemoteProvider() {
  const { RemoteProvider } = await import('@/lib/data-provider/remote-provider.js');
  return new RemoteProvider();
}

// ---- Pull: hosted → local DB ----

/**
 * Pull data from the hosted API and merge into local DB.
 *
 * Hosted always wins — remote data overwrites local for matching entities.
 * New entities on hosted side are inserted. Local-only entities are left as-is.
 */
export async function syncPull(): Promise<PullResult> {
  const result: PullResult = { ticketsPulled: 0, articlesPulled: 0, conflicts: 0, errors: [] };

  let remote;
  try {
    remote = await getRemoteProvider();
  } catch (err) {
    result.errors.push(`Failed to connect to hosted API: ${err instanceof Error ? err.message : err}`);
    return result;
  }

  const ctx = await requireDbContext();
  const { db, schema, workspaceId } = ctx;

  // Pull tickets
  try {
    const hostedTickets = await remote.loadTickets();
    for (const ticket of hostedTickets) {
      // Upsert: check if entity exists locally
      const existing = await db
        .select({ id: schema.tickets.id })
        .from(schema.tickets)
        .where(eq(schema.tickets.id, ticket.id))
        .limit(1);

      if (existing.length > 0) {
        // Update local with hosted version (hosted wins)
        await db.update(schema.tickets).set({
          subject: ticket.subject,
          status: ticket.status,
          priority: ticket.priority,
          updatedAt: new Date(ticket.updatedAt),
        }).where(eq(schema.tickets.id, ticket.id));
      }
      // Note: we don't insert new tickets from hosted — those would need
      // full requester/workspace setup. For now, pull updates existing only.
      if (existing.length > 0) result.ticketsPulled++;
    }
  } catch (err) {
    result.errors.push(`Ticket pull failed: ${err instanceof Error ? err.message : err}`);
  }

  // Pull KB articles
  try {
    const hostedArticles = await remote.loadKBArticles();
    for (const article of hostedArticles) {
      const existing = await db
        .select({ id: schema.kbArticles.id })
        .from(schema.kbArticles)
        .where(eq(schema.kbArticles.id, article.id))
        .limit(1);

      if (existing.length > 0) {
        await db.update(schema.kbArticles).set({
          title: article.title,
          body: article.body,
          categoryPath: article.categoryPath,
          status: article.status ?? 'published',
          updatedAt: article.updatedAt ? new Date(article.updatedAt) : new Date(),
        }).where(eq(schema.kbArticles.id, article.id));
        result.articlesPulled++;
      }
    }
  } catch (err) {
    result.errors.push(`KB article pull failed: ${err instanceof Error ? err.message : err}`);
  }

  return result;
}

// ---- Push: outbox → hosted API ----

/**
 * Push pending outbox entries to the hosted API.
 *
 * 1. Load all pending_push outbox entries
 * 2. For update operations, fetch hosted versions and detect conflicts
 * 3. Push safe entries to hosted API
 * 4. Mark pushed entries; flag conflicts
 */
export async function syncPush(): Promise<PushResult> {
  const result: PushResult = { pushed: 0, conflicts: 0, failed: 0, errors: [] };

  const ctx = await requireDbContext();
  const { db, schema, workspaceId } = ctx;

  // 1. Load pending outbox entries
  const pendingRows = await db
    .select()
    .from(schema.syncOutbox)
    .where(
      and(
        eq(schema.syncOutbox.workspaceId, workspaceId),
        eq(schema.syncOutbox.status, 'pending_push'),
      ),
    );

  if (pendingRows.length === 0) return result;

  // 2. Build LocalChange array
  const localChanges: LocalChange[] = pendingRows.map((row: {
    id: string;
    entityType: 'ticket' | 'message' | 'kb_article';
    entityId: string;
    operation: 'create' | 'update';
    payload: unknown;
    createdAt: Date;
  }) => ({
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    operation: row.operation,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  }));

  // 3. Fetch hosted versions for update operations (conflict detection)
  let remote;
  try {
    remote = await getRemoteProvider();
  } catch (err) {
    result.errors.push(`Failed to connect to hosted API: ${err instanceof Error ? err.message : err}`);
    return result;
  }

  const hostedLookup = new Map<string, HostedEntity>();
  const updateChanges = localChanges.filter(c => c.operation === 'update');

  if (updateChanges.length > 0) {
    try {
      // Fetch hosted tickets for conflict checking
      const hostedTickets = await remote.loadTickets();
      for (const t of hostedTickets) {
        hostedLookup.set(t.id, { id: t.id, updatedAt: t.updatedAt, data: t });
      }

      const hostedArticles = await remote.loadKBArticles();
      for (const a of hostedArticles) {
        hostedLookup.set(a.id, { id: a.id, updatedAt: a.updatedAt ?? '', data: a });
      }
    } catch (err) {
      result.errors.push(`Failed to fetch hosted data for conflict check: ${err instanceof Error ? err.message : err}`);
      return result;
    }
  }

  // 4. Partition into safe and conflicted
  const { safe, conflicted } = partitionChanges(localChanges, hostedLookup);

  // 5. Record conflicts in DB
  for (const conflict of conflicted) {
    try {
      await db.insert(schema.syncConflicts).values({
        workspaceId,
        entityType: conflict.entityType,
        entityId: conflict.entityId,
        localVersion: conflict.localChange,
        hostedVersion: conflict.hostedVersion,
        localUpdatedAt: new Date(conflict.localChangedAt),
        hostedUpdatedAt: conflict.hostedUpdatedAt ? new Date(conflict.hostedUpdatedAt) : new Date(),
      });

      await db.update(schema.syncOutbox).set({
        status: 'conflict',
        error: conflict.reason,
      }).where(eq(schema.syncOutbox.id, conflict.outboxId));

      result.conflicts++;
    } catch (err) {
      result.errors.push(`Failed to record conflict for ${conflict.entityId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 6. Push safe entries
  for (const change of safe) {
    try {
      if (change.entityType === 'ticket') {
        if (change.operation === 'create') {
          await remote.createTicket(change.payload as import('@/lib/data-provider/types.js').TicketCreateParams);
        } else {
          await remote.updateTicket(change.entityId, change.payload as import('@/lib/data-provider/types.js').TicketUpdateParams);
        }
      } else if (change.entityType === 'message') {
        if (change.operation === 'create') {
          await remote.createMessage(change.payload as import('@/lib/data-provider/types.js').MessageCreateParams);
        }
      } else if (change.entityType === 'kb_article') {
        if (change.operation === 'create') {
          await remote.createKBArticle(change.payload as import('@/lib/data-provider/types.js').KBArticleCreateParams);
        }
      }

      // Mark as pushed
      await db.update(schema.syncOutbox).set({
        status: 'pushed',
        pushedAt: new Date(),
      }).where(eq(schema.syncOutbox.id, change.id));

      result.pushed++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await db.update(schema.syncOutbox).set({
        status: 'failed',
        error: errorMsg,
      }).where(eq(schema.syncOutbox.id, change.id));

      result.failed++;
      result.errors.push(`Push failed for ${change.entityType}/${change.entityId}: ${errorMsg}`);
    }
  }

  return result;
}

// ---- Conflict management ----

/**
 * List unresolved sync conflicts.
 */
export async function listConflicts(): Promise<ConflictRecord[]> {
  const ctx = await requireDbContext();
  const { db, schema, workspaceId } = ctx;

  const rows = await db
    .select()
    .from(schema.syncConflicts)
    .where(
      and(
        eq(schema.syncConflicts.workspaceId, workspaceId),
        isNull(schema.syncConflicts.resolvedAt),
      ),
    );

  return rows.map((row: {
    id: string;
    entityType: string;
    entityId: string;
    localVersion: unknown;
    hostedVersion: unknown;
    localUpdatedAt: Date;
    hostedUpdatedAt: Date;
    createdAt: Date;
  }) => ({
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    localVersion: row.localVersion,
    hostedVersion: row.hostedVersion,
    localUpdatedAt: row.localUpdatedAt.toISOString(),
    hostedUpdatedAt: row.hostedUpdatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * Resolve a conflict by keeping either the local or hosted version.
 *
 * - `keep: 'hosted'` — discard local change, hosted version is already in DB from pull
 * - `keep: 'local'` — re-queue the local change for push (skipping conflict check)
 */
export async function resolveConflict(
  conflictId: string,
  keep: 'local' | 'hosted',
): Promise<{ resolved: boolean; error?: string }> {
  const ctx = await requireDbContext();
  const { db, schema, workspaceId } = ctx;

  // Find the conflict
  const rows = await db
    .select()
    .from(schema.syncConflicts)
    .where(
      and(
        eq(schema.syncConflicts.id, conflictId),
        eq(schema.syncConflicts.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    return { resolved: false, error: `Conflict ${conflictId} not found` };
  }

  const conflict = rows[0] as {
    id: string;
    entityType: 'ticket' | 'message' | 'kb_article';
    entityId: string;
    localVersion: unknown;
    hostedVersion: unknown;
  };

  // Mark conflict as resolved
  await db.update(schema.syncConflicts).set({
    resolvedAt: new Date(),
    resolution: keep,
  }).where(eq(schema.syncConflicts.id, conflictId));

  if (keep === 'local') {
    // Re-queue the local change for push
    await db.insert(schema.syncOutbox).values({
      workspaceId,
      operation: 'update' as const,
      entityType: conflict.entityType,
      entityId: conflict.entityId,
      payload: conflict.localVersion,
      status: 'pending_push',
    });
  }

  // If keeping hosted, no further action needed — hosted version is already
  // the source of truth and will be pulled on next sync pull.

  return { resolved: true };
}
