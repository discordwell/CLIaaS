import { describe, it, expect } from 'vitest';
import { executeViewQuery } from '../executor';
import type { ViewQuery } from '../types';
import type { Ticket } from '@/lib/data-provider/types';

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'test-1',
    externalId: 'ext-1',
    source: 'zendesk',
    subject: 'Test ticket',
    status: 'open',
    priority: 'normal',
    requester: 'user@example.com',
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

const tickets: Ticket[] = [
  makeTicket({ id: '1', status: 'open', priority: 'urgent', tags: ['billing', 'vip'], assignee: 'Alice', createdAt: '2026-01-01T00:00:00Z' }),
  makeTicket({ id: '2', status: 'pending', priority: 'normal', tags: ['support'], assignee: 'Bob', createdAt: '2026-01-02T00:00:00Z' }),
  makeTicket({ id: '3', status: 'open', priority: 'high', tags: [], createdAt: '2026-01-03T00:00:00Z' }),
  makeTicket({ id: '4', status: 'closed', priority: 'low', tags: ['billing'], createdAt: '2026-01-04T00:00:00Z' }),
  makeTicket({ id: '5', status: 'solved', priority: 'normal', tags: ['vip', 'escalated'], assignee: 'Alice', createdAt: '2026-01-05T00:00:00Z' }),
];

describe('executeViewQuery', () => {
  it('returns all tickets when no conditions', () => {
    const query: ViewQuery = { conditions: [], combineMode: 'and' };
    expect(executeViewQuery(query, tickets)).toHaveLength(5);
  });

  it('filters by status=open with "is" operator', () => {
    const query: ViewQuery = {
      conditions: [{ field: 'status', operator: 'is', value: 'open' }],
      combineMode: 'and',
    };
    const result = executeViewQuery(query, tickets);
    expect(result).toHaveLength(2);
    expect(result.every(t => t.status === 'open')).toBe(true);
  });

  it('filters by status!=closed with "is_not" operator', () => {
    const query: ViewQuery = {
      conditions: [{ field: 'status', operator: 'is_not', value: 'closed' }],
      combineMode: 'and',
    };
    expect(executeViewQuery(query, tickets)).toHaveLength(4);
  });

  it('filters by subject contains', () => {
    const query: ViewQuery = {
      conditions: [{ field: 'subject', operator: 'contains', value: 'test' }],
      combineMode: 'and',
    };
    expect(executeViewQuery(query, tickets)).toHaveLength(5);
  });

  it('filters by assignee is_empty', () => {
    const query: ViewQuery = {
      conditions: [{ field: 'assignee', operator: 'is_empty' }],
      combineMode: 'and',
    };
    const result = executeViewQuery(query, tickets);
    expect(result).toHaveLength(2); // id 3 and 4 have no assignee
  });

  it('filters by assignee is_not_empty', () => {
    const query: ViewQuery = {
      conditions: [{ field: 'assignee', operator: 'is_not_empty' }],
      combineMode: 'and',
    };
    expect(executeViewQuery(query, tickets)).toHaveLength(3);
  });

  it('filters by tag "is" (array includes)', () => {
    const query: ViewQuery = {
      conditions: [{ field: 'tag', operator: 'is', value: 'billing' }],
      combineMode: 'and',
    };
    expect(executeViewQuery(query, tickets)).toHaveLength(2);
  });

  it('filters by tag is_empty', () => {
    const query: ViewQuery = {
      conditions: [{ field: 'tag', operator: 'is_empty' }],
      combineMode: 'and',
    };
    expect(executeViewQuery(query, tickets)).toHaveLength(1);
    expect(executeViewQuery(query, tickets)[0].id).toBe('3');
  });

  it('combines conditions with AND mode', () => {
    const query: ViewQuery = {
      conditions: [
        { field: 'status', operator: 'is', value: 'open' },
        { field: 'priority', operator: 'is', value: 'urgent' },
      ],
      combineMode: 'and',
    };
    const result = executeViewQuery(query, tickets);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('combines conditions with OR mode', () => {
    const query: ViewQuery = {
      conditions: [
        { field: 'status', operator: 'is', value: 'closed' },
        { field: 'status', operator: 'is', value: 'solved' },
      ],
      combineMode: 'or',
    };
    const result = executeViewQuery(query, tickets);
    expect(result).toHaveLength(2);
  });

  it('sorts by created_at ascending', () => {
    const query: ViewQuery = {
      conditions: [],
      combineMode: 'and',
      sort: { field: 'created_at', direction: 'asc' },
    };
    const result = executeViewQuery(query, tickets);
    expect(result[0].id).toBe('1');
    expect(result[4].id).toBe('5');
  });

  it('sorts by created_at descending', () => {
    const query: ViewQuery = {
      conditions: [],
      combineMode: 'and',
      sort: { field: 'created_at', direction: 'desc' },
    };
    const result = executeViewQuery(query, tickets);
    expect(result[0].id).toBe('5');
    expect(result[4].id).toBe('1');
  });

  it('resolves $CURRENT_USER placeholder', () => {
    const query: ViewQuery = {
      conditions: [{ field: 'assignee', operator: 'is', value: '$CURRENT_USER' }],
      combineMode: 'and',
    };
    const result = executeViewQuery(query, tickets, 'Alice');
    expect(result).toHaveLength(2);
    expect(result.every(t => t.assignee === 'Alice')).toBe(true);
  });

  it('filters with greater_than on dates', () => {
    const query: ViewQuery = {
      conditions: [{ field: 'created_at', operator: 'greater_than', value: '2026-01-03T00:00:00Z' }],
      combineMode: 'and',
    };
    const result = executeViewQuery(query, tickets);
    expect(result).toHaveLength(2); // id 4 and 5
  });

  it('filters with less_than on dates', () => {
    const query: ViewQuery = {
      conditions: [{ field: 'created_at', operator: 'less_than', value: '2026-01-03T00:00:00Z' }],
      combineMode: 'and',
    };
    const result = executeViewQuery(query, tickets);
    expect(result).toHaveLength(2); // id 1 and 2
  });
});
