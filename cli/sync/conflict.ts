/**
 * Conflict Detection — compares local outbox changes against hosted data.
 *
 * A conflict exists when the hosted version of an entity was modified after
 * the local change was created (i.e. someone else changed it on the hosted
 * side while we had pending local changes).
 *
 * Hosted always wins by default; local→hosted is an explicit user action
 * with conflict warnings.
 */

export interface LocalChange {
  id: string;
  entityType: 'ticket' | 'message' | 'kb_article';
  entityId: string;
  operation: 'create' | 'update';
  payload: unknown;
  createdAt: string; // ISO timestamp of when the local change was made
}

export interface HostedEntity {
  id: string;
  updatedAt: string; // ISO timestamp from hosted
  data: unknown;
}

export interface SyncConflict {
  outboxId: string;
  entityType: 'ticket' | 'message' | 'kb_article';
  entityId: string;
  localChange: unknown;
  hostedVersion: unknown;
  localChangedAt: string;
  hostedUpdatedAt: string;
  reason: string;
}

/**
 * Detect conflicts between local outbox changes and hosted data.
 *
 * For each local change (update operations only — creates cannot conflict),
 * checks whether the hosted version was modified after the local change was
 * created. If so, flags as a conflict with both versions for user resolution.
 *
 * @param localChanges - pending outbox entries
 * @param hostedLookup - map of entityId → hosted entity data
 * @returns list of detected conflicts
 */
export function detectConflicts(
  localChanges: LocalChange[],
  hostedLookup: Map<string, HostedEntity>,
): SyncConflict[] {
  const conflicts: SyncConflict[] = [];

  for (const change of localChanges) {
    // Create operations cannot conflict — the entity doesn't exist on hosted yet
    if (change.operation === 'create') continue;

    const hosted = hostedLookup.get(change.entityId);
    if (!hosted) {
      // Entity deleted on hosted side — flag as conflict
      conflicts.push({
        outboxId: change.id,
        entityType: change.entityType,
        entityId: change.entityId,
        localChange: change.payload,
        hostedVersion: null,
        localChangedAt: change.createdAt,
        hostedUpdatedAt: '',
        reason: 'Entity was deleted on hosted side',
      });
      continue;
    }

    const hostedTime = new Date(hosted.updatedAt).getTime();
    const localTime = new Date(change.createdAt).getTime();

    // Conflict: hosted was modified after our local change was queued
    if (hostedTime > localTime) {
      conflicts.push({
        outboxId: change.id,
        entityType: change.entityType,
        entityId: change.entityId,
        localChange: change.payload,
        hostedVersion: hosted.data,
        localChangedAt: change.createdAt,
        hostedUpdatedAt: hosted.updatedAt,
        reason: `Hosted was updated at ${hosted.updatedAt}, after local change at ${change.createdAt}`,
      });
    }
  }

  return conflicts;
}

/**
 * Partition outbox entries into safe-to-push and conflicted groups.
 */
export function partitionChanges(
  localChanges: LocalChange[],
  hostedLookup: Map<string, HostedEntity>,
): { safe: LocalChange[]; conflicted: SyncConflict[] } {
  const conflicts = detectConflicts(localChanges, hostedLookup);
  const conflictedIds = new Set(conflicts.map(c => c.outboxId));

  return {
    safe: localChanges.filter(c => !conflictedIds.has(c.id)),
    conflicted: conflicts,
  };
}
