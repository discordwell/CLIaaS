/**
 * In-memory event bus for real-time updates.
 * Uses Server-Sent Events (SSE) for browser delivery.
 */

export type EventType =
  | 'ticket:created'
  | 'ticket:updated'
  | 'ticket:reply'
  | 'ticket:assigned'
  | 'ticket:status_changed'
  | 'presence:viewing'
  | 'presence:typing'
  | 'presence:left'
  | 'rule:executed'
  | 'notification';

export interface AppEvent {
  type: EventType;
  data: Record<string, unknown>;
  timestamp: number;
  workspaceId?: string;
}

type Listener = (event: AppEvent) => void;

class EventBus {
  private listeners: Map<string, Set<Listener>> = new Map();
  private globalListeners: Set<Listener> = new Set();

  on(type: EventType, listener: Listener): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
    return () => this.listeners.get(type)?.delete(listener);
  }

  onAny(listener: Listener): () => void {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  }

  emit(event: AppEvent): void {
    event.timestamp = event.timestamp || Date.now();

    // Type-specific listeners
    const typed = this.listeners.get(event.type);
    if (typed) {
      for (const listener of typed) {
        try { listener(event); } catch { /* ignore */ }
      }
    }

    // Global listeners
    for (const listener of this.globalListeners) {
      try { listener(event); } catch { /* ignore */ }
    }
  }
}

// Singleton event bus
declare global {
  var __cliaasEventBus: EventBus | undefined;
}

export const eventBus: EventBus =
  global.__cliaasEventBus ?? (global.__cliaasEventBus = new EventBus());
