/**
 * Unit tests for ticket merge & split business logic.
 * Uses mock DB context to test logic without a real database.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  TicketMergeParams,
  TicketSplitParams,
  TicketUnmergeParams,
} from '@/lib/data-provider/types';

// Mock DB rows
let tickets: Array<Record<string, unknown>> = [];
let conversations: Array<Record<string, unknown>> = [];
let messages: Array<Record<string, unknown>> = [];
let mergeLog: Array<Record<string, unknown>> = [];
let splitLog: Array<Record<string, unknown>> = [];
let idCounter = 0;

function makeId() {
  return `uuid-${++idCounter}`;
}

// Minimal mock schema that satisfies .id, .workspaceId etc
const mockSchema = {
  tickets: {
    id: 'id',
    workspaceId: 'workspace_id',
    status: 'status',
    mergedIntoTicketId: 'merged_into_ticket_id',
    splitFromTicketId: 'split_from_ticket_id',
  },
  conversations: {
    id: 'id',
    ticketId: 'ticket_id',
  },
  messages: {
    id: 'id',
    conversationId: 'conversation_id',
  },
  ticketMergeLog: {
    id: 'id',
    workspaceId: 'workspace_id',
    primaryTicketId: 'primary_ticket_id',
    mergedTicketId: 'merged_ticket_id',
  },
  ticketSplitLog: {
    id: 'id',
    workspaceId: 'workspace_id',
    sourceTicketId: 'source_ticket_id',
    newTicketId: 'new_ticket_id',
  },
};

// Since the real merge-split.ts uses drizzle queries directly, we test via
// the DataProvider interface. We'll mock at the module level instead.

// Test the validation logic by importing and calling the functions
// with a mock DB context that simulates drizzle behavior.

function createMockDb() {
  // Track the chain of operations
  let currentTable = '';
  let currentConditions: unknown[] = [];
  let currentValues: Record<string, unknown> = {};
  let currentSet: Record<string, unknown> = {};

  const chainable = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn((table: unknown) => {
      if (table === mockSchema.tickets) currentTable = 'tickets';
      else if (table === mockSchema.conversations) currentTable = 'conversations';
      else if (table === mockSchema.messages) currentTable = 'messages';
      else if (table === mockSchema.ticketMergeLog) currentTable = 'mergeLog';
      else if (table === mockSchema.ticketSplitLog) currentTable = 'splitLog';
      return chainable;
    }),
    where: vi.fn((_cond: unknown) => {
      return chainable;
    }),
    limit: vi.fn((_n: number) => {
      // Return appropriate data based on currentTable
      if (currentTable === 'tickets') return tickets;
      if (currentTable === 'conversations') return conversations;
      if (currentTable === 'messages') return messages;
      if (currentTable === 'mergeLog') return mergeLog;
      if (currentTable === 'splitLog') return splitLog;
      return [];
    }),
    insert: vi.fn((_table: unknown) => chainable),
    values: vi.fn((vals: Record<string, unknown>) => {
      currentValues = vals;
      return chainable;
    }),
    returning: vi.fn(() => {
      const id = makeId();
      return [{ id, ...currentValues }];
    }),
    update: vi.fn((_table: unknown) => chainable),
    set: vi.fn((vals: Record<string, unknown>) => {
      currentSet = vals;
      return chainable;
    }),
    // where for update resolves void
    then: undefined,
  };

  return chainable;
}

describe('Ticket Merge & Split', () => {
  describe('Merge validation', () => {
    it('rejects merging a ticket with itself', async () => {
      const { mergeTickets } = await import('@/lib/tickets/merge-split');
      const mockDb = createMockDb();

      const params: TicketMergeParams = {
        primaryTicketId: 'ticket-1',
        mergedTicketIds: ['ticket-1'],
      };

      await expect(
        mergeTickets(
          { db: mockDb, schema: mockSchema as never, workspaceId: 'ws-1' },
          params,
        ),
      ).rejects.toThrow('Cannot merge a ticket with itself');
    });

    it('rejects merge with empty mergedTicketIds', async () => {
      const { mergeTickets } = await import('@/lib/tickets/merge-split');
      const mockDb = createMockDb();

      const params: TicketMergeParams = {
        primaryTicketId: 'ticket-1',
        mergedTicketIds: [],
      };

      await expect(
        mergeTickets(
          { db: mockDb, schema: mockSchema as never, workspaceId: 'ws-1' },
          params,
        ),
      ).rejects.toThrow('At least one ticket to merge is required');
    });
  });

  describe('Split validation', () => {
    it('rejects split with empty messageIds', async () => {
      const { splitTicket } = await import('@/lib/tickets/merge-split');
      const mockDb = createMockDb();

      const params: TicketSplitParams = {
        ticketId: 'ticket-1',
        messageIds: [],
      };

      await expect(
        splitTicket(
          { db: mockDb, schema: mockSchema as never, workspaceId: 'ws-1' },
          params,
        ),
      ).rejects.toThrow('At least one message must be selected');
    });
  });

  describe('Type interfaces', () => {
    it('TicketMergeParams has required fields', () => {
      const params: TicketMergeParams = {
        primaryTicketId: 'a',
        mergedTicketIds: ['b'],
      };
      expect(params.primaryTicketId).toBe('a');
      expect(params.mergedTicketIds).toHaveLength(1);
    });

    it('TicketSplitParams has required fields', () => {
      const params: TicketSplitParams = {
        ticketId: 'a',
        messageIds: ['m1'],
        newSubject: 'Split: test',
      };
      expect(params.ticketId).toBe('a');
      expect(params.messageIds).toHaveLength(1);
      expect(params.newSubject).toBe('Split: test');
    });

    it('TicketUnmergeParams has required fields', () => {
      const params: TicketUnmergeParams = {
        mergeLogId: 'log-1',
        unmergedBy: 'user-1',
      };
      expect(params.mergeLogId).toBe('log-1');
    });
  });
});
