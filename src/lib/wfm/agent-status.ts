/**
 * Agent status tracking singleton.
 * Follows the singleton pattern from src/lib/realtime/presence.ts.
 * Emits events via the shared eventBus.
 */

import { eventBus } from '@/lib/realtime/events';
import type { AgentCurrentStatus, AgentStatusEntry } from './types';
import { getStatusLog as getAgentStatusEntries, addStatusEntry as addAgentStatusEntry, genId } from './store';

/** Read the timestamp from a status entry. */
function entryTime(e: AgentStatusEntry): string {
  return e.startedAt ?? '';
}

class AgentStatusTracker {
  private statuses: Map<string, AgentCurrentStatus> = new Map();
  private initialized = false;

  /** Lazy-load current statuses from the persisted log. */
  private ensureInit(): void {
    if (this.initialized) return;
    this.initialized = true;

    const entries = getAgentStatusEntries();
    const latest = new Map<string, AgentStatusEntry>();
    for (const e of entries) {
      const existing = latest.get(e.userId);
      if (!existing || entryTime(e) > entryTime(existing)) {
        latest.set(e.userId, e);
      }
    }
    for (const e of latest.values()) {
      this.statuses.set(e.userId, {
        userId: e.userId,
        userName: e.userName,
        status: e.status,
        reason: e.reason,
        since: entryTime(e),
      });
    }
  }

  /**
   * Update an agent's status.
   * Persists a log entry and emits wfm:status_changed.
   */
  setStatus(
    userId: string,
    userName: string,
    status: AgentCurrentStatus['status'],
    reason?: string,
  ): AgentCurrentStatus {
    this.ensureInit();
    const now = new Date().toISOString();

    const current: AgentCurrentStatus = { userId, userName, status, reason, since: now };
    this.statuses.set(userId, current);

    const entry: AgentStatusEntry = {
      id: genId('ast'),
      userId,
      userName,
      status,
      reason,
      startedAt: now,
    };
    addAgentStatusEntry(entry);

    // Emit event (cast to satisfy strict EventType union)
    eventBus.emit({
      type: 'wfm:status_changed' as Parameters<typeof eventBus.emit>[0]['type'],
      data: { userId, userName, status, reason },
      timestamp: Date.now(),
    });

    return current;
  }

  /** Get a single agent's current status. */
  getStatus(userId: string): AgentCurrentStatus | undefined {
    this.ensureInit();
    return this.statuses.get(userId);
  }

  /** Get all current agent statuses. */
  getAllStatuses(): AgentCurrentStatus[] {
    this.ensureInit();
    return Array.from(this.statuses.values());
  }

  /**
   * Query the status change log.
   * Optionally filter by userId, from, and to timestamps.
   */
  getStatusLog(userId?: string, from?: string, to?: string): AgentStatusEntry[] {
    let entries = getAgentStatusEntries();
    if (userId) entries = entries.filter((e) => e.userId === userId);

    let results = [...entries];
    if (from) results = results.filter((e) => entryTime(e) >= from);
    if (to) results = results.filter((e) => entryTime(e) <= to);

    return results.sort((a, b) => entryTime(b).localeCompare(entryTime(a)));
  }
}

// Singleton
declare global {
  var __cliaasAgentStatusTracker: AgentStatusTracker | undefined;
}

export const agentStatusTracker: AgentStatusTracker =
  global.__cliaasAgentStatusTracker ?? (global.__cliaasAgentStatusTracker = new AgentStatusTracker());
