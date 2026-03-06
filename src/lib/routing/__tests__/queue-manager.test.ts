import { describe, it, expect } from 'vitest';
import { evaluateRules, matchQueue, evaluateConditions, getOverflowQueue } from '../queue-manager';
import type { RoutingRule, RoutingQueue } from '../types';
import type { Ticket } from '@/lib/data-provider/types';

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'ticket-1',
    externalId: 'ext-1',
    source: 'zendesk',
    subject: 'Test ticket',
    status: 'open',
    priority: 'normal',
    requester: 'user@test.com',
    tags: ['billing'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('evaluateConditions', () => {
  it('matches all conditions (AND)', () => {
    const result = evaluateConditions(
      { all: [
        { field: 'status', operator: 'is', value: 'open' },
        { field: 'priority', operator: 'is', value: 'normal' },
      ]},
      makeTicket(),
    );
    expect(result).toBe(true);
  });

  it('fails when one all condition fails', () => {
    const result = evaluateConditions(
      { all: [
        { field: 'status', operator: 'is', value: 'open' },
        { field: 'priority', operator: 'is', value: 'urgent' },
      ]},
      makeTicket(),
    );
    expect(result).toBe(false);
  });

  it('matches any conditions (OR)', () => {
    const result = evaluateConditions(
      { any: [
        { field: 'priority', operator: 'is', value: 'urgent' },
        { field: 'tags', operator: 'contains', value: 'billing' },
      ]},
      makeTicket(),
    );
    expect(result).toBe(true);
  });

  it('returns true for empty conditions', () => {
    expect(evaluateConditions({}, makeTicket())).toBe(true);
  });
});

describe('evaluateRules', () => {
  const rules: RoutingRule[] = [
    {
      id: 'r1', workspaceId: 'ws-1', name: 'Low priority rule',
      priority: 1, conditions: { all: [{ field: 'priority', operator: 'is', value: 'low' }] },
      targetType: 'agent', targetId: 'agent-1', enabled: true,
    },
    {
      id: 'r2', workspaceId: 'ws-1', name: 'Billing rule',
      priority: 10, conditions: { all: [{ field: 'tags', operator: 'contains', value: 'billing' }] },
      targetType: 'queue', targetId: 'queue-1', enabled: true,
    },
    {
      id: 'r3', workspaceId: 'ws-1', name: 'Disabled rule',
      priority: 100, conditions: { all: [{ field: 'tags', operator: 'contains', value: 'billing' }] },
      targetType: 'agent', targetId: 'agent-3', enabled: false,
    },
  ];

  it('returns highest-priority matching rule', () => {
    const result = evaluateRules(makeTicket(), rules);
    expect(result?.id).toBe('r2');
  });

  it('skips disabled rules', () => {
    const result = evaluateRules(makeTicket(), rules);
    expect(result?.id).not.toBe('r3');
  });

  it('returns null when no rules match', () => {
    const result = evaluateRules(makeTicket({ tags: [] }), rules);
    expect(result).toBeNull();
  });
});

describe('matchQueue', () => {
  const queues: RoutingQueue[] = [
    {
      id: 'q1', workspaceId: 'ws-1', name: 'Billing Queue',
      priority: 10, conditions: { all: [{ field: 'tags', operator: 'contains', value: 'billing' }] },
      strategy: 'skill_match', enabled: true,
    },
    {
      id: 'q2', workspaceId: 'ws-1', name: 'General Queue',
      priority: 0, conditions: {},
      strategy: 'round_robin', enabled: true,
    },
  ];

  it('matches highest-priority queue', () => {
    const result = matchQueue(makeTicket(), queues);
    expect(result?.id).toBe('q1');
  });

  it('falls back to general queue when specific doesn\'t match', () => {
    const result = matchQueue(makeTicket({ tags: [] }), queues);
    expect(result?.id).toBe('q2');
  });
});

describe('getOverflowQueue', () => {
  it('returns overflow queue when configured', () => {
    const queues: RoutingQueue[] = [
      { id: 'q1', workspaceId: 'ws-1', name: 'Main', priority: 10, conditions: {}, strategy: 'skill_match', enabled: true, overflowQueueId: 'q2' },
      { id: 'q2', workspaceId: 'ws-1', name: 'Overflow', priority: 0, conditions: {}, strategy: 'round_robin', enabled: true },
    ];
    const result = getOverflowQueue(queues[0], queues);
    expect(result?.id).toBe('q2');
  });

  it('returns null when no overflow configured', () => {
    const queue: RoutingQueue = { id: 'q1', workspaceId: 'ws-1', name: 'Main', priority: 10, conditions: {}, strategy: 'skill_match', enabled: true };
    expect(getOverflowQueue(queue, [])).toBeNull();
  });
});
