/**
 * Agent presence tracking for collision detection.
 * Tracks which agents are viewing/typing on which tickets.
 */

import { eventBus } from './events';

interface PresenceEntry {
  userId: string;
  userName: string;
  ticketId: string;
  activity: 'viewing' | 'typing';
  lastSeen: number;
}

class PresenceTracker {
  private static MAX_ENTRIES = 10_000;

  private entries: Map<string, PresenceEntry> = new Map();
  private ticketIndex: Map<string, Set<string>> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Clean up stale entries every 30s
    if (typeof setInterval !== 'undefined') {
      this.cleanupInterval = setInterval(() => this.cleanup(), 30_000);
    }
  }

  private key(userId: string, ticketId: string): string {
    return `${userId}:${ticketId}`;
  }

  private addToIndex(ticketId: string, key: string): void {
    let set = this.ticketIndex.get(ticketId);
    if (!set) {
      set = new Set();
      this.ticketIndex.set(ticketId, set);
    }
    set.add(key);
  }

  private removeFromIndex(ticketId: string, key: string): void {
    const set = this.ticketIndex.get(ticketId);
    if (set) {
      set.delete(key);
      if (set.size === 0) this.ticketIndex.delete(ticketId);
    }
  }

  update(userId: string, userName: string, ticketId: string, activity: 'viewing' | 'typing'): void {
    // Enforce max entries cap
    if (this.entries.size >= PresenceTracker.MAX_ENTRIES) {
      this.cleanup();
      if (this.entries.size >= PresenceTracker.MAX_ENTRIES) {
        // Evict oldest entry by lastSeen
        let oldestKey: string | null = null;
        let oldestTime = Infinity;
        for (const [k, e] of this.entries) {
          if (e.lastSeen < oldestTime) {
            oldestTime = e.lastSeen;
            oldestKey = k;
          }
        }
        if (oldestKey) {
          const evicted = this.entries.get(oldestKey)!;
          this.entries.delete(oldestKey);
          this.removeFromIndex(evicted.ticketId, oldestKey);
        }
      }
    }

    const k = this.key(userId, ticketId);
    const existing = this.entries.get(k);
    const isNew = !existing;

    this.entries.set(k, {
      userId,
      userName,
      ticketId,
      activity,
      lastSeen: Date.now(),
    });

    if (isNew) {
      this.addToIndex(ticketId, k);
    }

    if (isNew || existing?.activity !== activity) {
      eventBus.emit({
        type: activity === 'typing' ? 'presence:typing' : 'presence:viewing',
        data: { userId, userName, ticketId, activity },
        timestamp: Date.now(),
      });
    }
  }

  leave(userId: string, ticketId: string): void {
    const k = this.key(userId, ticketId);
    const entry = this.entries.get(k);
    if (entry) {
      this.entries.delete(k);
      this.removeFromIndex(ticketId, k);
      eventBus.emit({
        type: 'presence:left',
        data: { userId: entry.userId, userName: entry.userName, ticketId },
        timestamp: Date.now(),
      });
    }
  }

  getViewers(ticketId: string): Array<{ userId: string; userName: string; activity: string }> {
    const keys = this.ticketIndex.get(ticketId);
    if (!keys) return [];
    const viewers: Array<{ userId: string; userName: string; activity: string }> = [];
    for (const k of keys) {
      const entry = this.entries.get(k);
      if (entry) {
        viewers.push({
          userId: entry.userId,
          userName: entry.userName,
          activity: entry.activity,
        });
      }
    }
    return viewers;
  }

  private cleanup(): void {
    const staleThreshold = Date.now() - 30_000; // 30s timeout
    for (const [key, entry] of this.entries) {
      if (entry.lastSeen < staleThreshold) {
        this.entries.delete(key);
        this.removeFromIndex(entry.ticketId, key);
        eventBus.emit({
          type: 'presence:left',
          data: { userId: entry.userId, userName: entry.userName, ticketId: entry.ticketId },
          timestamp: Date.now(),
        });
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.entries.clear();
    this.ticketIndex.clear();
  }

  // ---- Test helpers ----

  /** Clear all entries and indexes. For tests only. */
  _testClear(): void {
    this.entries.clear();
    this.ticketIndex.clear();
  }

  /** Run the cleanup cycle. For tests only. */
  _testRunCleanup(): void {
    this.cleanup();
  }

  /** Set the lastSeen timestamp for a specific entry. For tests only. */
  _testSetLastSeen(userId: string, ticketId: string, timestamp: number): void {
    const k = this.key(userId, ticketId);
    const entry = this.entries.get(k);
    if (entry) entry.lastSeen = timestamp;
  }

  /** Override the max entries cap. For tests only. Returns restore function. */
  _testSetMaxEntries(max: number): () => void {
    const original = PresenceTracker.MAX_ENTRIES;
    PresenceTracker.MAX_ENTRIES = max;
    return () => { PresenceTracker.MAX_ENTRIES = original; };
  }

  /** Get the current entry count. For tests only. */
  _testEntryCount(): number {
    return this.entries.size;
  }
}

// Singleton
declare global {
  var __cliaasPresence: PresenceTracker | undefined;
}

export const presence: PresenceTracker =
  global.__cliaasPresence ?? (global.__cliaasPresence = new PresenceTracker());
