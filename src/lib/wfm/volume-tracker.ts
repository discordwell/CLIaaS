/**
 * Real-time ticket volume tracker singleton.
 */

import { eventBus } from '@/lib/realtime/events';
import { addVolumeSnapshot, genId } from './store';

interface HourlyCounter {
  ticketsCreated: number;
  ticketsResolved: number;
}

class VolumeTracker {
  private counters: Map<string, HourlyCounter> = new Map();
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    eventBus.on('ticket:created', (event) => {
      this.recordTicketCreated((event.data.channel as string) ?? undefined);
    });

    eventBus.on('ticket:status_changed', (event) => {
      const newStatus = event.data.newStatus as string | undefined;
      if (newStatus === 'solved' || newStatus === 'closed') {
        this.recordTicketResolved((event.data.channel as string) ?? undefined);
      }
    });

    if (typeof setInterval !== 'undefined') {
      this.flushInterval = setInterval(() => this.flush(), 3600000);
    }
  }

  getHourKey(date?: Date): string {
    const d = date ?? new Date();
    const iso = d.toISOString();
    return iso.slice(0, 11) + iso.slice(11, 13) + ':00:00.000Z';
  }

  private counterKey(hourKey: string, channel: string): string {
    return `${hourKey}|${channel}`;
  }

  private ensureCounter(key: string): HourlyCounter {
    let counter = this.counters.get(key);
    if (!counter) { counter = { ticketsCreated: 0, ticketsResolved: 0 }; this.counters.set(key, counter); }
    return counter;
  }

  recordTicketCreated(channel?: string): void {
    const ch = channel ?? 'all';
    const hourKey = this.getHourKey();
    this.ensureCounter(this.counterKey(hourKey, ch)).ticketsCreated++;
    if (ch !== 'all') this.ensureCounter(this.counterKey(hourKey, 'all')).ticketsCreated++;
  }

  recordTicketResolved(channel?: string): void {
    const ch = channel ?? 'all';
    const hourKey = this.getHourKey();
    this.ensureCounter(this.counterKey(hourKey, ch)).ticketsResolved++;
    if (ch !== 'all') this.ensureCounter(this.counterKey(hourKey, 'all')).ticketsResolved++;
  }

  flush(): void {
    for (const [key, counter] of this.counters) {
      const [snapshotHour, channel] = key.split('|');
      if (counter.ticketsCreated > 0 || counter.ticketsResolved > 0) {
        addVolumeSnapshot({
          id: genId('vs'),
          snapshotHour,
          channel,
          ticketsCreated: counter.ticketsCreated,
          ticketsResolved: counter.ticketsResolved,
        });
      }
    }
    this.counters.clear();
  }

  destroy(): void {
    if (this.flushInterval) clearInterval(this.flushInterval);
    this.counters.clear();
  }
}

declare global {
  var __cliaasVolumeTracker: VolumeTracker | undefined;
}

export const volumeTracker: VolumeTracker =
  global.__cliaasVolumeTracker ?? (global.__cliaasVolumeTracker = new VolumeTracker());

export function initVolumeTracker(): VolumeTracker {
  return volumeTracker;
}
