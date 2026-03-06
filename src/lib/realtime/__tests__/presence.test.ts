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
    presence._testClear();
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
      presence._testSetLastSeen('user-1', 'ticket-1', Date.now() - 31_000);
      presence._testRunCleanup();
      expect(presence.getViewers('ticket-1')).toHaveLength(0);
    });
  });

  describe('ticketIndex', () => {
    it('should use O(1) lookup via ticketIndex', () => {
      // Add viewers for different tickets
      for (let i = 0; i < 100; i++) {
        presence.update(`user-${i}`, `User${i}`, `ticket-${i}`, 'viewing');
      }
      presence.update('target-user', 'Target', 'target-ticket', 'viewing');

      const viewers = presence.getViewers('target-ticket');
      expect(viewers).toHaveLength(1);
      expect(viewers[0].userId).toBe('target-user');
    });

    it('should update ticketIndex on leave', () => {
      presence.update('user-1', 'Alice', 'ticket-1', 'viewing');
      presence.update('user-2', 'Bob', 'ticket-1', 'viewing');
      presence.leave('user-1', 'ticket-1');
      const viewers = presence.getViewers('ticket-1');
      expect(viewers).toHaveLength(1);
      expect(viewers[0].userId).toBe('user-2');
    });

    it('should update ticketIndex on cleanup', () => {
      presence.update('user-1', 'Alice', 'ticket-1', 'viewing');
      presence.update('user-2', 'Bob', 'ticket-1', 'viewing');
      presence._testSetLastSeen('user-1', 'ticket-1', Date.now() - 31_000);
      presence._testRunCleanup();
      const viewers = presence.getViewers('ticket-1');
      expect(viewers).toHaveLength(1);
      expect(viewers[0].userId).toBe('user-2');
    });
  });

  describe('max entries cap', () => {
    it('should evict stale entries via cleanup when at capacity', () => {
      const restore = presence._testSetMaxEntries(3);
      try {
        presence.update('u1', 'A', 't1', 'viewing');
        presence.update('u2', 'B', 't2', 'viewing');
        presence.update('u3', 'C', 't3', 'viewing');
        // Make u1 stale
        presence._testSetLastSeen('u1', 't1', Date.now() - 31_000);
        // Adding u4 should trigger cleanup which removes u1
        presence.update('u4', 'D', 't4', 'viewing');
        expect(presence._testEntryCount()).toBe(3);
        expect(presence.getViewers('t1')).toHaveLength(0);
        expect(presence.getViewers('t4')).toHaveLength(1);
      } finally {
        restore();
      }
    });

    it('should evict oldest entry when cleanup is insufficient', () => {
      const restore = presence._testSetMaxEntries(3);
      try {
        presence.update('u1', 'A', 't1', 'viewing');
        presence.update('u2', 'B', 't2', 'viewing');
        presence.update('u3', 'C', 't3', 'viewing');
        // Make u1 oldest but not stale (cleanup won't remove it)
        presence._testSetLastSeen('u1', 't1', Date.now() - 5_000);
        // Adding u4 should force-evict u1 as oldest
        presence.update('u4', 'D', 't4', 'viewing');
        expect(presence._testEntryCount()).toBe(3);
        expect(presence.getViewers('t1')).toHaveLength(0);
        expect(presence.getViewers('t4')).toHaveLength(1);
      } finally {
        restore();
      }
    });

    it('should maintain ticketIndex after eviction', () => {
      const restore = presence._testSetMaxEntries(2);
      try {
        presence.update('u1', 'A', 'shared-ticket', 'viewing');
        presence.update('u2', 'B', 'shared-ticket', 'viewing');
        presence._testSetLastSeen('u1', 'shared-ticket', Date.now() - 31_000);
        // u3 triggers cleanup, evicts u1
        presence.update('u3', 'C', 'other-ticket', 'viewing');
        const viewers = presence.getViewers('shared-ticket');
        expect(viewers).toHaveLength(1);
        expect(viewers[0].userId).toBe('u2');
      } finally {
        restore();
      }
    });
  });
});
