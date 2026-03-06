/**
 * Agent availability tracking — online/away/offline.
 * In-memory with JSONL persistence.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { eventBus } from '../realtime/events';
import type { AgentAvailabilityStatus } from './types';

interface AvailabilityEntry {
  userId: string;
  userName: string;
  status: AgentAvailabilityStatus;
  lastSeenAt: number;
}

const JSONL_FILE = 'routing-availability.jsonl';
const AUTO_OFFLINE_MS = 30 * 60 * 1000; // 30 minutes

class AvailabilityTracker {
  private entries: Map<string, AvailabilityEntry> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Load from disk
    for (const entry of readJsonlFile<AvailabilityEntry>(JSONL_FILE)) {
      this.entries.set(entry.userId, entry);
    }
    // Auto-offline cleanup every 5 min
    if (typeof setInterval !== 'undefined') {
      this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    }
  }

  setAvailability(userId: string, userName: string, status: AgentAvailabilityStatus): void {
    const prev = this.entries.get(userId);
    this.entries.set(userId, { userId, userName, status, lastSeenAt: Date.now() });
    this.persist();

    if (!prev || prev.status !== status) {
      eventBus.emit({
        type: 'ticket:updated', // reuse existing event type for SSE
        data: {
          _routingEvent: 'agent:availability_changed',
          userId,
          userName,
          status,
          previousStatus: prev?.status ?? 'offline',
        },
        timestamp: Date.now(),
      });
    }
  }

  getAvailability(userId: string): AgentAvailabilityStatus {
    const entry = this.entries.get(userId);
    if (!entry) return 'offline';
    if (Date.now() - entry.lastSeenAt > AUTO_OFFLINE_MS && entry.status !== 'offline') {
      entry.status = 'offline';
      this.persist();
    }
    return entry.status;
  }

  getAllAvailability(): AvailabilityEntry[] {
    this.cleanup();
    return Array.from(this.entries.values());
  }

  heartbeat(userId: string): void {
    const entry = this.entries.get(userId);
    if (entry) {
      entry.lastSeenAt = Date.now();
      this.persist();
    }
  }

  isAvailableForRouting(userId: string): boolean {
    const status = this.getAvailability(userId);
    return status === 'online' || status === 'away';
  }

  private cleanup(): void {
    const now = Date.now();
    let changed = false;
    for (const entry of this.entries.values()) {
      if (now - entry.lastSeenAt > AUTO_OFFLINE_MS && entry.status !== 'offline') {
        entry.status = 'offline';
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  private persist(): void {
    writeJsonlFile(JSONL_FILE, Array.from(this.entries.values()));
  }

  destroy(): void {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.entries.clear();
  }
}

// Singleton
declare global {
  var __cliaasAvailability: AvailabilityTracker | undefined;
}

export const availability: AvailabilityTracker =
  global.__cliaasAvailability ?? (global.__cliaasAvailability = new AvailabilityTracker());
