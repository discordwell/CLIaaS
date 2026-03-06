import { describe, it, expect, beforeEach, vi } from 'vitest';
import { routeTicket } from '../engine';
import { setAgentSkills, setAgentCapacity, createRoutingQueue, createRoutingRule } from '../store';
import { availability } from '../availability';
import { loadTracker } from '../load-tracker';
import { writeJsonlFile } from '../../jsonl-store';
import type { Ticket } from '@/lib/data-provider/types';

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
    loadTracker.destroy();
    vi.restoreAllMocks();
    // Mock loadTracker.ensureLoaded to skip data provider load in tests
    vi.spyOn(loadTracker, 'ensureLoaded').mockResolvedValue(undefined);
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

  // ---- Phase 1: Proficiency scoring ----

  it('proficiency 0.5 scores lower than proficiency 1.0', async () => {
    setAgentSkills('agent-1', 'ws-1', [{ skillName: 'technical', proficiency: 0.5 }]);
    setAgentSkills('agent-2', 'ws-1', [{ skillName: 'technical', proficiency: 1.0 }]);

    const result = await routeTicket(makeTicket(), { allAgents: makeAgents() });

    // Agent-2 should be preferred due to higher proficiency
    expect(result.suggestedAgentId).toBe('agent-2');
    expect(result.confidence).toBeGreaterThan(0);
  });

  // ---- Phase 1: Business hours penalty ----

  it('business hours penalty fires when outside hours', async () => {
    setAgentSkills('agent-1', 'ws-1', [{ skillName: 'technical' }]);
    setAgentSkills('agent-2', 'ws-1', [{ skillName: 'technical' }]);

    // Mock the WFM business-hours module (used via dynamic import in engine)
    const bhMod = await import('../../wfm/business-hours');
    const getBusinessHoursSpy = vi.spyOn(bhMod, 'getBusinessHours').mockReturnValue(
      [{ id: 'bh-1', isDefault: true, timezone: 'UTC', schedule: {}, name: 'Test', holidays: [], createdAt: '', updatedAt: '' }] as any
    );
    const isWithinSpy = vi.spyOn(bhMod, 'isWithinBusinessHours').mockReturnValue(false);

    const result = await routeTicket(makeTicket(), { allAgents: makeAgents() });

    expect(result.reasoning).toContain('Categories:');
    // Score = coverage * proficiency * 0.7 penalty = 1 * 1 * 0.7 = 0.7
    expect(result.confidence).toBeLessThanOrEqual(0.7);
    expect(result.confidence).toBeGreaterThan(0);

    getBusinessHoursSpy.mockRestore();
    isWithinSpy.mockRestore();
  });

  // ---- Phase 1: Load-balanced differentiates by load ----

  it('load-balanced strategy differentiates by load', async () => {
    const twoAgents = [
      { userId: 'agent-1', userName: 'Alice' },
      { userId: 'agent-2', userName: 'Bob' },
    ];
    setAgentSkills('agent-1', 'ws-1', [{ skillName: 'technical' }]);
    setAgentSkills('agent-2', 'ws-1', [{ skillName: 'technical' }]);
    setAgentCapacity('agent-1', 'ws-1', [{ channelType: 'all', maxConcurrent: 20 }]);
    setAgentCapacity('agent-2', 'ws-1', [{ channelType: 'all', maxConcurrent: 20 }]);

    // Mock load tracker: agent-1 has 10 tickets, agent-2 has 2
    vi.spyOn(loadTracker, 'getLoad').mockImplementation((name: string) => {
      if (name === 'Alice') return 10;
      if (name === 'Bob') return 2;
      return 0;
    });

    createRoutingQueue({
      workspaceId: 'ws-1',
      name: 'Tech Queue',
      priority: 10,
      conditions: { all: [{ field: 'tags', operator: 'contains', value: 'api' }] },
      strategy: 'load_balanced',
      enabled: true,
    });

    const result = await routeTicket(makeTicket(), { allAgents: twoAgents, workspaceId: 'ws-1' });

    // Load-balanced should prefer Bob (lower load ratio: 2/20 vs 10/20)
    expect(result.suggestedAgentId).toBe('agent-2');
  });

  // ---- Phase 3: SLA boost tests ----

  it('SLA-breached ticket gets +0.3 boost in reasoning', async () => {
    setAgentSkills('agent-1', 'ws-1', [{ skillName: 'technical' }]);

    // Mock SLA check to return breached
    vi.doMock('../../sla', () => ({
      checkTicketSLA: vi.fn().mockResolvedValue([{
        ticketId: 'ticket-1',
        policyId: 'sla-high',
        policyName: 'High Priority',
        firstResponse: { status: 'breached', targetMinutes: 60, elapsedMinutes: 120, remainingMinutes: 0 },
        resolution: { status: 'ok', targetMinutes: 480, elapsedMinutes: 120, remainingMinutes: 360 },
        escalations: [],
      }]),
    }));

    const result = await routeTicket(makeTicket(), { allAgents: makeAgents() });
    expect(result.reasoning).toContain('SLA breached');

    vi.doUnmock('../../sla');
  });

  it('SLA-warning ticket gets +0.15 boost in reasoning', async () => {
    setAgentSkills('agent-1', 'ws-1', [{ skillName: 'technical' }]);

    vi.doMock('../../sla', () => ({
      checkTicketSLA: vi.fn().mockResolvedValue([{
        ticketId: 'ticket-1',
        policyId: 'sla-high',
        policyName: 'High Priority',
        firstResponse: { status: 'warning', targetMinutes: 60, elapsedMinutes: 50, remainingMinutes: 10 },
        resolution: { status: 'ok', targetMinutes: 480, elapsedMinutes: 50, remainingMinutes: 430 },
        escalations: [],
      }]),
    }));

    const result = await routeTicket(makeTicket(), { allAgents: makeAgents() });
    expect(result.reasoning).toContain('SLA warning');

    vi.doUnmock('../../sla');
  });

  it('SLA boost does not inflate score for agents with no skill match', async () => {
    // Agent-1 has matching skills, Agent-2 has none
    setAgentSkills('agent-1', 'ws-1', [{ skillName: 'technical' }]);
    setAgentSkills('agent-2', 'ws-1', [{ skillName: 'unrelated' }]);

    vi.doMock('../../sla', () => ({
      checkTicketSLA: vi.fn().mockResolvedValue([{
        ticketId: 'ticket-1',
        policyId: 'sla-high',
        policyName: 'High Priority',
        firstResponse: { status: 'breached', targetMinutes: 60, elapsedMinutes: 120, remainingMinutes: 0 },
        resolution: { status: 'ok', targetMinutes: 480, elapsedMinutes: 120, remainingMinutes: 360 },
        escalations: [],
      }]),
    }));

    const result = await routeTicket(makeTicket(), { allAgents: makeAgents() });

    // Agent-1 should be preferred (has skills), not Agent-2 (no skills but would have SLA boost)
    expect(result.suggestedAgentId).toBe('agent-1');
    // Agents with 0 skill score should still have 0 score even with SLA boost
    const noSkillAlternate = result.alternateAgents?.find(a => a.agentId === 'agent-2');
    if (noSkillAlternate) {
      expect(noSkillAlternate.score).toBe(0);
    }

    vi.doUnmock('../../sla');
  });

  // ---- Phase 4: Overflow timeout ----

  it('ticket older than overflow timeout routes to overflow queue', async () => {
    setAgentSkills('agent-1', 'ws-1', [{ skillName: 'billing' }]);
    setAgentSkills('agent-2', 'ws-1', [{ skillName: 'billing' }]);

    const overflowQueue = createRoutingQueue({
      workspaceId: 'ws-1',
      name: 'Overflow Queue',
      priority: 0,
      conditions: {},
      strategy: 'round_robin',
      enabled: true,
    });

    createRoutingQueue({
      workspaceId: 'ws-1',
      name: 'Primary Queue',
      priority: 10,
      conditions: { all: [{ field: 'tags', operator: 'contains', value: 'billing' }] },
      strategy: 'skill_match',
      overflowQueueId: overflowQueue.id,
      overflowTimeoutSecs: 60, // 1 minute
      enabled: true,
    });

    // Create ticket that was created 2 minutes ago (older than 60s timeout)
    const oldDate = new Date(Date.now() - 120_000).toISOString();
    const ticket = makeTicket({ tags: ['billing'], subject: 'Billing issue', createdAt: oldDate });

    const result = await routeTicket(ticket, { allAgents: makeAgents(), workspaceId: 'ws-1' });

    expect(result.reasoning).toContain('Overflow timeout');
    expect(result.queueId).toBe(overflowQueue.id);
  });

  it('ticket newer than overflow timeout stays in primary queue', async () => {
    setAgentSkills('agent-1', 'ws-1', [{ skillName: 'billing' }]);

    const overflowQueue = createRoutingQueue({
      workspaceId: 'ws-1',
      name: 'Overflow Queue',
      priority: 0,
      conditions: {},
      strategy: 'round_robin',
      enabled: true,
    });

    const primaryQueue = createRoutingQueue({
      workspaceId: 'ws-1',
      name: 'Primary Queue',
      priority: 10,
      conditions: { all: [{ field: 'tags', operator: 'contains', value: 'billing' }] },
      strategy: 'skill_match',
      overflowQueueId: overflowQueue.id,
      overflowTimeoutSecs: 300, // 5 minutes
      enabled: true,
    });

    // Create ticket just now (well within 5 min timeout)
    const ticket = makeTicket({ tags: ['billing'], subject: 'Billing issue' });

    const result = await routeTicket(ticket, { allAgents: makeAgents(), workspaceId: 'ws-1' });

    expect(result.reasoning).not.toContain('Overflow timeout');
    expect(result.queueId).toBe(primaryQueue.id);
  });
});
