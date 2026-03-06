/**
 * Real volume snapshot collection from the database.
 * Counts tickets created/resolved in the last hour and inserts a
 * volumeSnapshots row. Uses tryDb pattern — falls back to JSONL if
 * DB is unavailable.
 */

import { tryDb } from '@/lib/store-helpers';
import { addVolumeSnapshot, genId, addVolumeSnapshotAsync } from './store';
import type { VolumeSnapshot } from './types';

/**
 * Collect a real volume snapshot for the given workspace.
 * Queries the tickets table for rows created/resolved within the last hour,
 * then inserts a volumeSnapshots row.
 */
export async function collectVolumeSnapshot(
  workspaceId: string,
): Promise<VolumeSnapshot> {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 3600_000);
  const snapshotHour =
    now.toISOString().slice(0, 11) +
    now.toISOString().slice(11, 13) +
    ':00:00.000Z';

  let ticketsCreated = 0;
  let ticketsResolved = 0;

  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq, and, gte, sql } = await import('drizzle-orm');

    // Count tickets created in the last hour
    const [createdRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.tickets)
      .where(
        and(
          eq(schema.tickets.workspaceId, workspaceId),
          gte(schema.tickets.createdAt, hourAgo),
        ),
      );
    ticketsCreated = createdRow?.count ?? 0;

    // Count tickets resolved in the last hour (status = 'solved' or 'closed' with recent updatedAt)
    const [resolvedRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.tickets)
      .where(
        and(
          eq(schema.tickets.workspaceId, workspaceId),
          sql`${schema.tickets.status} IN ('solved', 'closed')`,
          gte(schema.tickets.updatedAt, hourAgo),
        ),
      );
    ticketsResolved = resolvedRow?.count ?? 0;
  }

  const snapshot: VolumeSnapshot = {
    id: genId('vs'),
    snapshotHour,
    channel: 'all',
    ticketsCreated,
    ticketsResolved,
  };

  // Persist — prefer DB, fall back to JSONL
  await addVolumeSnapshotAsync(snapshot, workspaceId);

  return snapshot;
}
