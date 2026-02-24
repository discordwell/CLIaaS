import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { eq, and, lt } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const logger = createLogger('retention-scheduler');

export interface EnforcementResult {
  resource: string;
  action: string;
  recordsAffected: number;
}

/**
 * Enforces all retention policies for a workspace.
 * Queries records older than the cutoff per policy and deletes/archives them.
 */
export async function enforceRetentionPolicies(
  workspaceId: string,
): Promise<EnforcementResult[]> {
  const db = getDb();
  if (!db) {
    logger.info('Demo mode — retention enforcement skipped');
    return [];
  }

  const results: EnforcementResult[] = [];

  try {
    // Fetch retention policies for this workspace
    const policies = await db
      .select()
      .from(schema.retentionPolicies)
      .where(eq(schema.retentionPolicies.workspaceId, workspaceId));

    for (const policy of policies) {
      const cutoff = new Date(Date.now() - policy.retentionDays * 86400000);
      let recordsAffected = 0;

      try {
        if (policy.resource === 'tickets' && policy.action === 'delete') {
          const result = await db
            .delete(schema.tickets)
            .where(
              and(
                eq(schema.tickets.workspaceId, workspaceId),
                lt(schema.tickets.createdAt, cutoff),
              ),
            );
          recordsAffected = result.rowCount ?? 0;
        } else if (policy.resource === 'messages' && policy.action === 'delete') {
          const result = await db
            .delete(schema.messages)
            .where(
              and(
                eq(schema.messages.workspaceId, workspaceId),
                lt(schema.messages.createdAt, cutoff),
              ),
            );
          recordsAffected = result.rowCount ?? 0;
        } else if (policy.resource === 'audit_logs' && policy.action === 'delete') {
          const result = await db
            .delete(schema.auditEntries)
            .where(
              and(
                eq(schema.auditEntries.workspaceId, workspaceId),
                lt(schema.auditEntries.timestamp, cutoff),
              ),
            );
          recordsAffected = result.rowCount ?? 0;
        }
        // Archive action: for now, log that archival was requested (no archive store yet)
        if (policy.action === 'archive' && recordsAffected === 0) {
          logger.info({ resource: policy.resource, workspaceId }, 'Archive retention action — no archive store configured');
        }
      } catch (err) {
        logger.error({ err, resource: policy.resource }, 'Retention enforcement failed for resource');
      }

      results.push({
        resource: policy.resource,
        action: policy.action,
        recordsAffected,
      });
    }
  } catch (err) {
    logger.error({ err }, 'Retention enforcement failed');
  }

  return results;
}

let _intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the retention scheduler. Runs daily (or on the provided interval).
 * Falls back to setInterval when BullMQ is unavailable.
 */
export function startRetentionScheduler(
  workspaceId: string,
  intervalMs: number = 24 * 60 * 60 * 1000,
): void {
  if (_intervalHandle) return; // Already running

  logger.info({ workspaceId, intervalMs }, 'Starting retention scheduler');
  _intervalHandle = setInterval(async () => {
    try {
      const results = await enforceRetentionPolicies(workspaceId);
      logger.info({ results }, 'Retention enforcement completed');
    } catch (err) {
      logger.error({ err }, 'Retention enforcement error');
    }
  }, intervalMs);
}

/**
 * Stop the retention scheduler.
 */
export function stopRetentionScheduler(): void {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
}
