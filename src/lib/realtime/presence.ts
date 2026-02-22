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
  private entries: Map<string, PresenceEntry> = new Map();
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

  update(userId: string, userName: string, ticketId: string, activity: 'viewing' | 'typing'): void {
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
      eventBus.emit({
        type: 'presence:left',
        data: { userId: entry.userId, userName: entry.userName, ticketId },
        timestamp: Date.now(),
      });
    }
  }

  getViewers(ticketId: string): Array<{ userId: string; userName: string; activity: string }> {
    const viewers: Array<{ userId: string; userName: string; activity: string }> = [];
    for (const entry of this.entries.values()) {
      if (entry.ticketId === ticketId) {
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
    const staleThreshold = Date.now() - 60_000; // 60s timeout
    for (const [key, entry] of this.entries) {
      if (entry.lastSeen < staleThreshold) {
        this.entries.delete(key);
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
  }
}

// Singleton
declare global {
  var __cliaasPresence: PresenceTracker | undefined;
}

export const presence: PresenceTracker =
  global.__cliaasPresence ?? (global.__cliaasPresence = new PresenceTracker());
