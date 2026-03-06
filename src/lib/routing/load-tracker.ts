/**
 * Agent load tracker — counts open/pending tickets per assignee.
 * Lazy-init singleton with 5-minute TTL cache and event-driven invalidation.
 */

import { eventBus } from '../realtime/events';

const CACHE_TTL_MS = 5 * 60 * 1000;

class LoadTracker {
  private loadMap: Map<string, number> = new Map();
  private lastLoadedAt = 0;
  private loading: Promise<void> | null = null;
  private unsubscribers: Array<() => void> = [];

  constructor() {
    this.unsubscribers.push(
      eventBus.on('ticket:routed', () => this.invalidate()),
      eventBus.on('ticket:updated', () => this.invalidate()),
      eventBus.on('ticket:assigned', () => this.invalidate()),
    );
  }

  async ensureLoaded(): Promise<void> {
    if (Date.now() - this.lastLoadedAt < CACHE_TTL_MS && this.loadMap.size > 0) {
      return;
    }
    if (this.loading) return this.loading;
    this.loading = this.refresh();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  private async refresh(): Promise<void> {
    try {
      const { getDataProvider } = await import('../data-provider/index');
      const provider = await getDataProvider();
      const tickets = await provider.loadTickets();

      const counts = new Map<string, number>();
      const activeStatuses = new Set(['open', 'pending', 'on_hold', 'new']);

      for (const ticket of tickets) {
        if (!ticket.assignee || !activeStatuses.has(ticket.status)) continue;
        counts.set(ticket.assignee, (counts.get(ticket.assignee) ?? 0) + 1);
      }

      this.loadMap = counts;
      this.lastLoadedAt = Date.now();
    } catch {
      // If data provider fails, keep existing cache (or empty map)
    }
  }

  getLoad(userName: string): number {
    return this.loadMap.get(userName) ?? 0;
  }

  invalidate(): void {
    this.lastLoadedAt = 0;
  }

  destroy(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    this.loadMap.clear();
    this.lastLoadedAt = 0;
  }
}

declare global {
  var __cliaasLoadTracker: LoadTracker | undefined;
}

export const loadTracker: LoadTracker =
  global.__cliaasLoadTracker ?? (global.__cliaasLoadTracker = new LoadTracker());
