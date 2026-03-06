/**
 * Unit tests for PresenceTracker
 */
import { describe, it, expect, beforeEach } from 'vitest';

// Reset global singleton before importing
delete (global as Record<string, unknown>).__cliaasPresence;
delete (global as Record<string, unknown>).__cliaasEventBus;

import { presence } from '../presence';
import { eventBus } from '../events';

describe('PresenceTracker', () => {
  beforeEach(() => {
    (presence as unknown as { entries: Map<string, unknown> }).entries.clear();
  });

  describe('update', () => {
    it('should track a viewer on a ticket', () => {
      presence.update('user-1', 'Alice', 'ticket-1', 'viewing');
      const viewers = presence.getViewers('ticket-1');
      expect(viewers).toHaveLength(1);
      expect(viewers[0]).toEqual({
        userId: 'user-1',
        userName: 'Alice',
        activity: 'viewing',
      });
    });

    it('should update activity from viewing to typing', () => {
      presence.update('user-1', 'Alice', 'ticket-1', 'viewing');
      presence.update('user-1', 'Alice', 'ticket-1', 'typing');
      const viewers = presence.getViewers('ticket-1');
      expect(viewers).toHaveLength(1);
      expect(viewers[0].activity).toBe('typing');
    });

    it('should track multiple viewers on the same ticket', () => {
      presence.update('user-1', 'Alice', 'ticket-1', 'viewing');
      presence.update('user-2', 'Bob', 'ticket-1', 'typing');
      const viewers = presence.getViewers('ticket-1');
      expect(viewers).toHaveLength(2);
    });

    it('should separate viewers by ticket', () => {
      presence.update('user-1', 'Alice', 'ticket-1', 'viewing');
      presence.update('user-2', 'Bob', 'ticket-2', 'viewing');
      expect(presence.getViewers('ticket-1')).toHaveLength(1);
      expect(presence.getViewers('ticket-2')).toHaveLength(1);
    });

    it('should emit presence:viewing event on first view', () => {
      const events: unknown[] = [];
      const unsub = eventBus.on('presence:viewing', (e) => events.push(e));
      presence.update('user-1', 'Alice', 'ticket-1', 'viewing');
      unsub();
      expect(events).toHaveLength(1);
    });

    it('should emit presence:typing when activity changes to typing', () => {
      const events: unknown[] = [];
      presence.update('user-1', 'Alice', 'ticket-1', 'viewing');
      const unsub = eventBus.on('presence:typing', (e) => events.push(e));
      presence.update('user-1', 'Alice', 'ticket-1', 'typing');
      unsub();
      expect(events).toHaveLength(1);
    });

    it('should not re-emit event for same activity', () => {
      presence.update('user-1', 'Alice', 'ticket-1', 'viewing');
      const events: unknown[] = [];
      const unsub = eventBus.on('presence:viewing', (e) => events.push(e));
      presence.update('user-1', 'Alice', 'ticket-1', 'viewing');
      unsub();
      expect(events).toHaveLength(0);
    });
  });

  describe('leave', () => {
    it('should remove a viewer', () => {
      presence.update('user-1', 'Alice', 'ticket-1', 'viewing');
      presence.leave('user-1', 'ticket-1');
      expect(presence.getViewers('ticket-1')).toHaveLength(0);
    });

    it('should emit presence:left event', () => {
      presence.update('user-1', 'Alice', 'ticket-1', 'viewing');
      const events: unknown[] = [];
      const unsub = eventBus.on('presence:left', (e) => events.push(e));
      presence.leave('user-1', 'ticket-1');
      unsub();
      expect(events).toHaveLength(1);
    });

    it('should be a no-op for non-existent viewer', () => {
      const events: unknown[] = [];
      const unsub = eventBus.on('presence:left', (e) => events.push(e));
      presence.leave('non-existent', 'ticket-1');
      unsub();
      expect(events).toHaveLength(0);
    });
  });

  describe('getViewers', () => {
    it('should return empty array for unknown ticket', () => {
      expect(presence.getViewers('unknown')).toEqual([]);
    });
  });

  describe('cleanup', () => {
    it('should remove stale entries (entries older than 30s)', () => {
      presence.update('user-1', 'Alice', 'ticket-1', 'viewing');

      // Manually age the entry
      const entries = (presence as unknown as { entries: Map<string, { lastSeen: number }> }).entries;
      for (const entry of entries.values()) {
        entry.lastSeen = Date.now() - 31_000;
      }

      // Trigger cleanup manually
      (presence as unknown as { cleanup: () => void }).cleanup();

      expect(presence.getViewers('ticket-1')).toHaveLength(0);
    });
  });
});
