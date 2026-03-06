import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionResult, TicketContext } from '../engine';

// Mock all notification infrastructure
vi.mock('@/lib/email/sender', () => ({
  sendNotification: vi.fn().mockResolvedValue({ success: true }),
}));
const mockSlackSend = vi.fn().mockResolvedValue({ ok: true });
vi.mock('@/lib/integrations/slack', () => ({
  SlackIntegration: class { sendNotification = mockSlackSend; },
}));
const mockTeamsSend = vi.fn().mockResolvedValue({ ok: true });
vi.mock('@/lib/integrations/teams', () => ({
  TeamsIntegration: class { sendNotification = mockTeamsSend; },
}));
vi.mock('@/lib/push', () => ({
  sendPush: vi.fn().mockResolvedValue({ sent: 1, failed: 0 }),
}));

// Mock fetch for webhooks
const mockFetch = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal('fetch', mockFetch);

const { dispatchSideEffects } = await import('../side-effects');
const { sendNotification } = await import('@/lib/email/sender');
const { sendPush } = await import('@/lib/push');

const baseTicket: TicketContext = {
  id: 'ticket-1',
  subject: 'Test ticket',
  status: 'open',
  priority: 'normal',
  requester: 'user@test.com',
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function makeResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    ruleId: 'rule-1',
    ruleName: 'Test rule',
    matched: true,
    actionsExecuted: 1,
    errors: [],
    changes: {},
    notifications: [],
    webhooks: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({ ok: true });
});

describe('dispatchSideEffects', () => {
  it('dispatches email notifications', async () => {
    const result = makeResult({
      notifications: [{ type: 'email', to: 'admin@test.com', template: 'escalation' }],
    });
    const report = await dispatchSideEffects(result, baseTicket);
    expect(sendNotification).toHaveBeenCalledWith({
      to: 'admin@test.com',
      template: 'escalation',
      data: expect.objectContaining({ ticketId: 'ticket-1' }),
    });
    expect(report.notificationsSent).toBe(1);
    expect(report.errors).toHaveLength(0);
  });

  it('dispatches slack notifications', async () => {
    const result = makeResult({
      notifications: [{ type: 'slack', to: '#support' }],
    });
    const report = await dispatchSideEffects(result, baseTicket);
    expect(mockSlackSend).toHaveBeenCalled();
    expect(report.notificationsSent).toBe(1);
  });

  it('dispatches teams notifications', async () => {
    const result = makeResult({
      notifications: [{ type: 'teams', to: 'team-channel' }],
    });
    const report = await dispatchSideEffects(result, baseTicket);
    expect(mockTeamsSend).toHaveBeenCalled();
    expect(report.notificationsSent).toBe(1);
  });

  it('dispatches push notifications', async () => {
    const result = makeResult({
      notifications: [{ type: 'push', to: 'all' }],
    });
    const report = await dispatchSideEffects(result, baseTicket);
    expect(sendPush).toHaveBeenCalledWith({
      title: 'Rule: Test rule',
      body: 'Ticket ticket-1: Test ticket',
      url: '/tickets/ticket-1',
    });
    expect(report.notificationsSent).toBe(1);
  });

  it('fires webhooks via fetch', async () => {
    const result = makeResult({
      webhooks: [{ url: 'https://hook.example.com', method: 'POST', body: { event: 'test' } }],
    });
    const report = await dispatchSideEffects(result, baseTicket);
    expect(mockFetch).toHaveBeenCalledWith('https://hook.example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'test' }),
    });
    expect(report.webhooksFired).toBe(1);
  });

  it('does nothing when no notifications or webhooks', async () => {
    const result = makeResult();
    const report = await dispatchSideEffects(result, baseTicket);
    expect(report.notificationsSent).toBe(0);
    expect(report.webhooksFired).toBe(0);
    expect(report.errors).toHaveLength(0);
  });

  it('collects errors without cascading', async () => {
    vi.mocked(sendNotification).mockRejectedValueOnce(new Error('SMTP down'));
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = makeResult({
      notifications: [
        { type: 'email', to: 'fail@test.com' },
        { type: 'push', to: 'all' },
      ],
      webhooks: [{ url: 'https://fail.example.com', method: 'POST', body: {} }],
    });
    const report = await dispatchSideEffects(result, baseTicket);
    // Push should still succeed even though email failed
    expect(report.notificationsSent).toBe(1);
    expect(report.webhooksFired).toBe(0);
    expect(report.errors).toHaveLength(2);
    const allErrors = report.errors.join(' | ');
    expect(allErrors).toContain('SMTP down');
    expect(allErrors).toContain('Network error');
  });

  it('handles unknown notification type gracefully', async () => {
    const result = makeResult({
      notifications: [{ type: 'sms', to: '+1234567890' }],
    });
    const report = await dispatchSideEffects(result, baseTicket);
    expect(report.notificationsSent).toBe(0);
    expect(report.errors).toContain('Unknown notification type: sms');
  });
});
