/**
 * Agent status tracking singleton.
 * Follows the singleton pattern from src/lib/realtime/presence.ts.
 * Emits events via the shared eventBus.
 */

import { eventBus } from '@/lib/realtime/events';
import type { AgentCurrentStatus, AgentStatusEntry, AgentAvailability } from './types';
import { getAgentStatusEntries, addAgentStatusEntry, genId } from './store';

class AgentStatusTracker {
  private statuses: Map<string, AgentCurrentStatus> = new Map();
  private initialized = false;

  /**
   * Lazy-load current statuses from the store defaults.
   * Builds the in-memory Map from the most recent status entry per user.
   */
  private ensureInit(): void {
    if (this.initialized) return;
    this.initialized = true;

    const entries = getAgentStatusEntries();

    // Build latest status per user from the log
    const latest = new Map<string, AgentStatusEntry>();
    for (const entry of entries) {
      const existing = latest.get(entry.userId);
      if (!existing || entry.startedAt > existing.startedAt) {
        latest.set(entry.userId, entry);
      }
    }

    for (const entry of latest.values()) {
      this.statuses.set(entry.userId, {
        userId: entry.userId,
        userName: entry.userName,
        status: entry.status,
        reason: entry.reason,
        since: entry.startedAt,
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
    status: AgentAvailability,
    reason?: string,
  ): AgentCurrentStatus {
    this.ensureInit();

    const now = new Date().toISOString();

    const current: AgentCurrentStatus = {
      userId,
      userName,
      status,
      reason,
      since: now,
    };
    this.statuses.set(userId, current);

    // Persist to log
    const entry: AgentStatusEntry = {
      id: genId('ast'),
      userId,
      userName,
      status,
      reason,
      startedAt: now,
    };
    addAgentStatusEntry(entry);

    // Emit event (cast type to satisfy strict EventType union until WFM events are added)
    eventBus.emit({
      type: 'wfm:status_changed' as Parameters<typeof eventBus.emit>[0]['type'],
      data: { userId, userName, status, reason },
      timestamp: Date.now(),
    });

    return current;
  }

  /**
   * Get a single agent's current status.
   */
  getStatus(userId: string): AgentCurrentStatus | undefined {
    this.ensureInit();
    return this.statuses.get(userId);
  }

  /**
   * Get all current agent statuses.
   */
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

    if (from) {
      results = results.filter((e) => e.startedAt >= from);
    }
    if (to) {
      results = results.filter((e) => e.startedAt <= to);
    }

    return results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
}

// Singleton
declare global {
  var __cliaasAgentStatusTracker: AgentStatusTracker | undefined;
}

export const agentStatusTracker: AgentStatusTracker =
  global.__cliaasAgentStatusTracker ?? (global.__cliaasAgentStatusTracker = new AgentStatusTracker());
