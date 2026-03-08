/**
 * In-memory presence store for agent collision detection.
 *
 * Tracks which agents are viewing or replying to which tickets.
 * Entries auto-expire after 60 seconds of no heartbeat.
 *
 * Keyed by ticketId -> userId -> presence info.
 */

export interface PresenceEntry {
  userId: string;
  userName: string;
  status: 'viewing' | 'replying';
  since: string; // ISO timestamp
  lastHeartbeat: number; // epoch ms for TTL checks
}

const EXPIRY_MS = 60_000; // 60 seconds

class PresenceStore {
  /** ticketId -> (userId -> PresenceEntry) */
  private store: Map<string, Map<string, PresenceEntry>> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Run cleanup every 15 seconds to reap expired entries
    if (typeof setInterval !== 'undefined') {
      this.cleanupTimer = setInterval(() => this.cleanupExpired(), 15_000);
    }
  }

  /**
   * Register or update a user's presence on a ticket.
   */
  setPresence(
    ticketId: string,
    userId: string,
    userName: string,
    status: 'viewing' | 'replying',
  ): void {
    let ticketMap = this.store.get(ticketId);
    if (!ticketMap) {
      ticketMap = new Map();
      this.store.set(ticketId, ticketMap);
    }

    const existing = ticketMap.get(userId);
    ticketMap.set(userId, {
      userId,
      userName,
      status,
      since: existing?.since ?? new Date().toISOString(),
      lastHeartbeat: Date.now(),
    });
  }

  /**
   * Get all active presence entries for a ticket.
   * Filters out expired entries inline.
   */
  getPresence(ticketId: string): PresenceEntry[] {
    const ticketMap = this.store.get(ticketId);
    if (!ticketMap) return [];

    const now = Date.now();
    const result: PresenceEntry[] = [];

    for (const [userId, entry] of ticketMap) {
      if (now - entry.lastHeartbeat > EXPIRY_MS) {
        ticketMap.delete(userId);
      } else {
        result.push({ ...entry });
      }
    }

    if (ticketMap.size === 0) {
      this.store.delete(ticketId);
    }

    return result;
  }

  /**
   * Remove a user's presence from a ticket.
   */
  removePresence(ticketId: string, userId: string): void {
    const ticketMap = this.store.get(ticketId);
    if (!ticketMap) return;

    ticketMap.delete(userId);
    if (ticketMap.size === 0) {
      this.store.delete(ticketId);
    }
  }

  /**
   * Remove all expired entries across all tickets.
   */
  cleanupExpired(): void {
    const now = Date.now();
    for (const [ticketId, ticketMap] of this.store) {
      for (const [userId, entry] of ticketMap) {
        if (now - entry.lastHeartbeat > EXPIRY_MS) {
          ticketMap.delete(userId);
        }
      }
      if (ticketMap.size === 0) {
        this.store.delete(ticketId);
      }
    }
  }

  /**
   * Get all ticket IDs that have active presence entries.
   * Used by the ticket list to show presence indicators.
   */
  getActiveTicketIds(): string[] {
    const now = Date.now();
    const active: string[] = [];
    for (const [ticketId, ticketMap] of this.store) {
      for (const entry of ticketMap.values()) {
        if (now - entry.lastHeartbeat <= EXPIRY_MS) {
          active.push(ticketId);
          break;
        }
      }
    }
    return active;
  }

  /**
   * Get a summary of presence across multiple tickets.
   * Returns a map of ticketId -> array of presence entries (only non-expired).
   */
  getPresenceBatch(ticketIds: string[]): Record<string, PresenceEntry[]> {
    const result: Record<string, PresenceEntry[]> = {};
    for (const ticketId of ticketIds) {
      const entries = this.getPresence(ticketId);
      if (entries.length > 0) {
        result[ticketId] = entries;
      }
    }
    return result;
  }

  // ---- Test helpers ----

  /** Clear all entries. For tests only. */
  _testClear(): void {
    this.store.clear();
  }

  /** Get raw store size (number of tickets tracked). For tests only. */
  _testTicketCount(): number {
    return this.store.size;
  }

  /** Manually set lastHeartbeat for testing expiry. For tests only. */
  _testSetHeartbeat(ticketId: string, userId: string, timestamp: number): void {
    const ticketMap = this.store.get(ticketId);
    if (ticketMap) {
      const entry = ticketMap.get(userId);
      if (entry) {
        entry.lastHeartbeat = timestamp;
      }
    }
  }

  destroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.store.clear();
  }
}

// Singleton — survives hot reloads in dev
declare global {
  // eslint-disable-next-line no-var
  var __cliaasPresenceStore: PresenceStore | undefined;
}

export const presenceStore: PresenceStore =
  global.__cliaasPresenceStore ??
  (global.__cliaasPresenceStore = new PresenceStore());
