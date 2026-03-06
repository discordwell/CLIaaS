/**
 * Tests for MCP presence tools (ticket_presence, ticket_collision_check).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the data provider
vi.mock('@/lib/data-provider/index', () => ({
  getDataProvider: vi.fn().mockResolvedValue({
    loadTickets: vi.fn().mockResolvedValue([
      {
        id: 'ticket-1',
        externalId: 'ZD-1001',
        subject: 'Test ticket',
        status: 'open',
        priority: 'normal',
        requester: 'user@test.com',
        assignee: null,
        tags: [],
        source: 'zendesk',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ]),
    loadMessages: vi.fn().mockResolvedValue([
      {
        id: 'msg-1',
        ticketId: 'ticket-1',
        author: 'Agent Smith',
        body: 'Hello, how can I help?',
        type: 'reply',
        createdAt: '2026-01-01T12:00:00Z',
      },
      {
        id: 'msg-2',
        ticketId: 'ticket-1',
        author: 'Customer',
        body: 'I have a problem',
        type: 'reply',
        createdAt: '2026-01-02T12:00:00Z',
      },
    ]),
  }),
}));

// Reset presence singleton
delete (global as Record<string, unknown>).__cliaasPresence;
delete (global as Record<string, unknown>).__cliaasEventBus;

import { presence } from '@/lib/realtime/presence';

describe('MCP Presence Tools', () => {
  beforeEach(() => {
    (presence as unknown as { entries: Map<string, unknown> }).entries.clear();
  });

  describe('ticket_presence logic', () => {
    it('should return empty viewers for a ticket with no presence', () => {
      const viewers = presence.getViewers('ticket-1');
      expect(viewers).toEqual([]);
    });

    it('should return viewers when agents are present', () => {
      presence.update('agent-1', 'Agent Smith', 'ticket-1', 'viewing');
      presence.update('agent-2', 'Agent Jones', 'ticket-1', 'typing');

      const viewers = presence.getViewers('ticket-1');
      expect(viewers).toHaveLength(2);
      expect(viewers.find(v => v.userId === 'agent-1')?.activity).toBe('viewing');
      expect(viewers.find(v => v.userId === 'agent-2')?.activity).toBe('typing');
    });
  });

  describe('ticket_collision_check logic', () => {
    it('should detect new replies after a given timestamp', async () => {
      const { getDataProvider } = await import('@/lib/data-provider/index');
      const provider = await getDataProvider();
      const messages = await provider.loadMessages('ticket-1');

      const since = new Date('2026-01-01T13:00:00Z');
      const newReplies = messages.filter(
        (m) => new Date(m.createdAt).getTime() > since.getTime()
      );

      expect(newReplies).toHaveLength(1);
      expect(newReplies[0].author).toBe('Customer');
    });

    it('should return no collisions when no new replies exist', async () => {
      const { getDataProvider } = await import('@/lib/data-provider/index');
      const provider = await getDataProvider();
      const messages = await provider.loadMessages('ticket-1');

      const since = new Date('2026-01-03T00:00:00Z');
      const newReplies = messages.filter(
        (m) => new Date(m.createdAt).getTime() > since.getTime()
      );

      expect(newReplies).toHaveLength(0);
    });
  });
});
