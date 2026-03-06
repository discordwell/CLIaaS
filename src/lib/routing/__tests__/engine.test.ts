import { describe, it, expect, beforeEach } from 'vitest';
import { routeTicket } from '../engine';
import { setAgentSkills, setAgentCapacity, createRoutingQueue, createRoutingRule } from '../store';
import { availability } from '../availability';
import { writeJsonlFile } from '../../jsonl-store';
import type { Ticket, Message } from '@/lib/data-provider/types';

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'ticket-1',
    externalId: 'ext-1',
    source: 'zendesk',
    subject: 'API error 500 on integration webhook',
    status: 'open',
    priority: 'high',
    requester: 'user@test.com',
    tags: ['api', 'error'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAgents() {
  return [
    { userId: 'agent-1', userName: 'Alice' },
    { userId: 'agent-2', userName: 'Bob' },
    { userId: 'agent-3', userName: 'Carol' },
  ];
}

function clearStores() {
  for (const f of [
    'routing-skills.jsonl', 'routing-capacity.jsonl', 'routing-queues.jsonl',
    'routing-rules.jsonl', 'routing-log.jsonl', 'group-memberships.jsonl',
    'routing-config.jsonl', 'routing-rr-index.jsonl', 'routing-availability.jsonl',
  ]) {
    writeJsonlFile(f, []);
  }
}

describe('routeTicket', () => {
  beforeEach(() => {
    clearStores();
    // Set all agents online
    for (const a of makeAgents()) {
      availability.setAvailability(a.userId, a.userName, 'online');
    }
  });

  it('routes to agent with matching skills', async () => {
    setAgentSkills('agent-1', 'ws-1', [{ skillName: 'technical' }, { skillName: 'api' }]);
    setAgentSkills('agent-2', 'ws-1', [{ skillName: 'billing' }]);
    setAgentSkills('agent-3', 'ws-1', [{ skillName: 'onboarding' }]);

    const result = await routeTicket(makeTicket(), { allAgents: makeAgents() });

    expect(result.suggestedAgentId).toBe('agent-1');
    expect(result.matchedSkills).toContain('technical');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('returns unassigned when no agents available', async () => {
    const result = await routeTicket(makeTicket(), { allAgents: [] });

    expect(result.suggestedAgentId).toBe('');
    expect(result.suggestedAgentName).toBe('Unassigned');
  });

  it('skips offline agents', async () => {
    setAgentSkills('agent-1', 'ws-1', [{ skillName: 'technical' }, { skillName: 'api' }]);
    setAgentSkills('agent-2', 'ws-1', [{ skillName: 'technical' }]);
    availability.setAvailability('agent-1', 'Alice', 'offline');

    const result = await routeTicket(makeTicket(), { allAgents: makeAgents() });

    expect(result.suggestedAgentId).not.toBe('agent-1');
  });

  it('uses queue strategy when queue matches', async () => {
    setAgentSkills('agent-1', 'ws-1', [{ skillName: 'billing' }]);
    setAgentSkills('agent-2', 'ws-1', [{ skillName: 'billing' }]);

    createRoutingQueue({
      workspaceId: 'ws-1',
      name: 'Billing Queue',
      priority: 10,
      conditions: { all: [{ field: 'tags', operator: 'contains', value: 'billing' }] },
      strategy: 'round_robin',
      enabled: true,
    });

    const ticket = makeTicket({ tags: ['billing'], subject: 'Billing question' });
    const result = await routeTicket(ticket, { allAgents: makeAgents(), workspaceId: 'ws-1' });

    expect(result.queueId).toBeDefined();
    expect(result.strategy).toBe('round_robin');
  });

  it('applies routing rules before queue matching', async () => {
    setAgentSkills('agent-3', 'ws-1', [{ skillName: 'security' }]);

    createRoutingRule({
      workspaceId: 'ws-1',
      name: 'Security to Carol',
      priority: 100,
      conditions: { all: [{ field: 'tags', operator: 'contains', value: 'security' }] },
      targetType: 'agent',
      targetId: 'agent-3',
      enabled: true,
    });

    const ticket = makeTicket({ tags: ['security'], subject: 'Security breach' });
    const result = await routeTicket(ticket, { allAgents: makeAgents(), workspaceId: 'ws-1' });

    expect(result.suggestedAgentId).toBe('agent-3');
    expect(result.ruleId).toBeDefined();
  });
});
