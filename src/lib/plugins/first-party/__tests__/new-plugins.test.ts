import { describe, it, expect } from 'vitest';
import type { PluginHookContext } from '../../types';

import { handle as slaEscalatorHandle } from '../sla-escalator/handler';
import { handle as csatSurveyHandle } from '../csat-survey/handler';
import { handle as webhookRelayHandle } from '../webhook-relay/handler';
import { handle as fieldSyncHandle } from '../field-sync/handler';
import { handle as aiSummaryHandle } from '../ai-summary/handler';

function makeContext(overrides: Partial<PluginHookContext> = {}): PluginHookContext {
  return {
    event: 'ticket.created',
    data: {},
    timestamp: '2026-03-07T12:00:00.000Z',
    workspaceId: 'ws-test',
    pluginId: 'test',
    config: {},
    ...overrides,
  };
}

// ---- SLA Escalator ----

describe('SLA Escalator plugin', () => {
  it('can be called without errors', async () => {
    const result = await slaEscalatorHandle(makeContext({ event: 'sla.breached' }));
    expect(result.ok).toBe(true);
  });

  it('escalates priority from normal to high on SLA breach', async () => {
    const result = await slaEscalatorHandle(makeContext({
      event: 'sla.breached',
      data: { ticketId: 'T-100', priority: 'normal', slaMetric: 'first_reply_time' },
    }));

    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.action).toBe('escalate');
    expect(result.data!.previousPriority).toBe('normal');
    expect(result.data!.newPriority).toBe('high');
    expect(result.data!.ticketId).toBe('T-100');
  });

  it('escalates priority from low to normal', async () => {
    const result = await slaEscalatorHandle(makeContext({
      event: 'sla.breached',
      data: { ticketId: 'T-101', priority: 'low', slaMetric: 'resolution_time' },
    }));

    expect(result.data!.previousPriority).toBe('low');
    expect(result.data!.newPriority).toBe('normal');
  });

  it('caps escalation at urgent', async () => {
    const result = await slaEscalatorHandle(makeContext({
      event: 'sla.breached',
      data: { ticketId: 'T-102', priority: 'urgent', slaMetric: 'first_reply_time' },
    }));

    expect(result.data!.previousPriority).toBe('urgent');
    expect(result.data!.newPriority).toBe('urgent');
  });

  it('includes group and tag when configured', async () => {
    const result = await slaEscalatorHandle(makeContext({
      event: 'sla.breached',
      data: { ticketId: 'T-103', priority: 'normal', slaMetric: 'first_reply_time' },
      config: { escalateToGroup: 'tier-2', addTag: 'sla-breach' },
    }));

    expect(result.data!.escalateToGroup).toBe('tier-2');
    expect(result.data!.tag).toBe('sla-breach');
    expect((result.data!.note as string)).toContain('tier-2');
    expect((result.data!.note as string)).toContain('sla-breach');
  });

  it('skips non-sla.breached events', async () => {
    const result = await slaEscalatorHandle(makeContext({
      event: 'ticket.created',
      data: { ticketId: 'T-104' },
    }));

    expect(result.ok).toBe(true);
    expect(result.data!.skipped).toBe(true);
  });
});

// ---- CSAT Survey Trigger ----

describe('CSAT Survey Trigger plugin', () => {
  it('can be called without errors', async () => {
    const result = await csatSurveyHandle(makeContext({ event: 'ticket.resolved' }));
    expect(result.ok).toBe(true);
  });

  it('schedules survey on ticket resolved', async () => {
    const result = await csatSurveyHandle(makeContext({
      event: 'ticket.resolved',
      data: { ticketId: 'T-200', requesterEmail: 'user@example.com' },
      config: { delayMinutes: 30 },
    }));

    expect(result.ok).toBe(true);
    expect(result.data!.action).toBe('schedule_survey');
    expect(result.data!.ticketId).toBe('T-200');
    expect(result.data!.requesterEmail).toBe('user@example.com');
    expect(result.data!.delayMinutes).toBe(30);
    expect(result.data!.surveyType).toBe('csat');
    expect(result.data!.scheduledAt).toBeDefined();
  });

  it('uses default 60 minute delay', async () => {
    const result = await csatSurveyHandle(makeContext({
      event: 'ticket.resolved',
      data: { ticketId: 'T-201' },
    }));

    expect(result.data!.delayMinutes).toBe(60);
  });

  it('skips tickets with excluded tags', async () => {
    const result = await csatSurveyHandle(makeContext({
      event: 'ticket.resolved',
      data: { ticketId: 'T-202', tags: ['internal', 'vip'] },
      config: { excludeTags: ['internal', 'spam'] },
    }));

    expect(result.ok).toBe(true);
    expect(result.data!.skipped).toBe(true);
    expect((result.data!.reason as string)).toContain('internal');
  });

  it('sends survey when tags do not match exclusion list', async () => {
    const result = await csatSurveyHandle(makeContext({
      event: 'ticket.resolved',
      data: { ticketId: 'T-203', tags: ['billing', 'vip'] },
      config: { excludeTags: ['internal', 'spam'] },
    }));

    expect(result.data!.action).toBe('schedule_survey');
  });

  it('skips non-ticket.resolved events', async () => {
    const result = await csatSurveyHandle(makeContext({
      event: 'ticket.created',
    }));

    expect(result.data!.skipped).toBe(true);
  });
});

// ---- Webhook Relay ----

describe('Webhook Relay plugin', () => {
  it('can be called without errors', async () => {
    const result = await webhookRelayHandle(makeContext({
      config: { url: 'https://example.com/webhook' },
    }));
    expect(result.ok).toBe(true);
  });

  it('formats outbound payload correctly', async () => {
    const result = await webhookRelayHandle(makeContext({
      event: 'ticket.created',
      data: { ticketId: 'T-300', subject: 'Help needed' },
      config: { url: 'https://hooks.example.com/events' },
    }));

    expect(result.ok).toBe(true);
    expect(result.data!.action).toBe('relay');
    expect(result.data!.url).toBe('https://hooks.example.com/events');
    expect(result.data!.method).toBe('POST');

    const payload = result.data!.payload as Record<string, unknown>;
    expect(payload.event).toBe('ticket.created');
    expect((payload.data as Record<string, unknown>).ticketId).toBe('T-300');
    expect(payload.timestamp).toBe('2026-03-07T12:00:00.000Z');
    expect(payload.workspaceId).toBe('ws-test');
  });

  it('includes HMAC signature when secret is configured', async () => {
    const result = await webhookRelayHandle(makeContext({
      event: 'ticket.updated',
      data: { ticketId: 'T-301' },
      config: { url: 'https://hooks.example.com/events', secret: 'my-secret-key' },
    }));

    expect(result.ok).toBe(true);
    expect(result.data!.signed).toBe(true);
    const headers = result.data!.headers as Record<string, string>;
    expect(headers['X-CLIaaS-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(headers['X-CLIaaS-Event']).toBe('ticket.updated');
  });

  it('does not include signature without secret', async () => {
    const result = await webhookRelayHandle(makeContext({
      config: { url: 'https://hooks.example.com/events' },
    }));

    expect(result.data!.signed).toBe(false);
    const headers = result.data!.headers as Record<string, string>;
    expect(headers['X-CLIaaS-Signature']).toBeUndefined();
  });

  it('returns error when URL is not configured', async () => {
    const result = await webhookRelayHandle(makeContext({ config: {} }));

    expect(result.ok).toBe(false);
    expect(result.error).toContain('URL is required');
  });

  it('filters events based on configured events list', async () => {
    const result = await webhookRelayHandle(makeContext({
      event: 'ticket.deleted',
      config: { url: 'https://hooks.example.com', events: ['ticket.created', 'ticket.updated'] },
    }));

    expect(result.ok).toBe(true);
    expect(result.data!.skipped).toBe(true);
  });

  it('relays event when it matches the allowed list', async () => {
    const result = await webhookRelayHandle(makeContext({
      event: 'ticket.created',
      config: { url: 'https://hooks.example.com', events: ['ticket.created', 'ticket.updated'] },
    }));

    expect(result.data!.action).toBe('relay');
  });
});

// ---- Field Sync ----

describe('Field Sync plugin', () => {
  it('can be called without errors', async () => {
    const result = await fieldSyncHandle(makeContext({
      event: 'ticket.created',
      config: { mappings: [] },
    }));
    expect(result.ok).toBe(true);
  });

  it('applies field mappings correctly', async () => {
    const result = await fieldSyncHandle(makeContext({
      event: 'ticket.created',
      data: {
        ticketId: 'T-400',
        fields: {
          department: 'Engineering',
          region: 'US-West',
          priority_override: 'high',
        },
      },
      config: {
        mappings: [
          { source: 'department', target: 'team' },
          { source: 'region', target: 'location' },
        ],
      },
    }));

    expect(result.ok).toBe(true);
    expect(result.data!.action).toBe('sync_fields');
    expect(result.data!.ticketId).toBe('T-400');

    const applied = result.data!.applied as Array<{ source: string; target: string; value: unknown }>;
    expect(applied).toHaveLength(2);
    expect(applied[0]).toEqual({ source: 'department', target: 'team', value: 'Engineering' });
    expect(applied[1]).toEqual({ source: 'region', target: 'location', value: 'US-West' });
  });

  it('skips mappings when source field is missing', async () => {
    const result = await fieldSyncHandle(makeContext({
      event: 'ticket.updated',
      data: {
        ticketId: 'T-401',
        fields: { department: 'Sales' },
      },
      config: {
        mappings: [
          { source: 'department', target: 'team' },
          { source: 'missing_field', target: 'target_field' },
        ],
      },
    }));

    const applied = result.data!.applied as Array<Record<string, unknown>>;
    const skipped = result.data!.skipped as Array<Record<string, unknown>>;
    expect(applied).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].source).toBe('missing_field');
    expect(skipped[0].reason).toContain('empty or missing');
  });

  it('skips when no mappings are configured', async () => {
    const result = await fieldSyncHandle(makeContext({
      event: 'ticket.created',
      config: { mappings: [] },
    }));

    expect(result.data!.skipped).toBe(true);
    expect((result.data!.reason as string)).toContain('No field mappings');
  });

  it('skips unsupported events', async () => {
    const result = await fieldSyncHandle(makeContext({
      event: 'ticket.resolved',
      config: { mappings: [{ source: 'a', target: 'b' }] },
    }));

    expect(result.data!.skipped).toBe(true);
  });

  it('works on ticket.updated events', async () => {
    const result = await fieldSyncHandle(makeContext({
      event: 'ticket.updated',
      data: { ticketId: 'T-402', fields: { src: 'val' } },
      config: { mappings: [{ source: 'src', target: 'dst' }] },
    }));

    expect(result.data!.action).toBe('sync_fields');
  });
});

// ---- AI Summary ----

describe('AI Summary plugin', () => {
  it('can be called without errors', async () => {
    const result = await aiSummaryHandle(makeContext({
      event: 'ticket.resolved',
      data: { messages: [{ from: 'agent', body: 'Hello' }] },
    }));
    expect(result.ok).toBe(true);
  });

  it('returns summary data on ticket resolved', async () => {
    const messages = [
      { from: 'customer@example.com', body: 'I cannot log in' },
      { from: 'agent@support.com', body: 'Have you tried resetting your password?' },
      { from: 'customer@example.com', body: 'That worked, thanks!' },
    ];

    const result = await aiSummaryHandle(makeContext({
      event: 'ticket.resolved',
      data: { ticketId: 'T-500', subject: 'Login issue', messages },
      config: { maxTokens: 200, model: 'gpt-4o' },
    }));

    expect(result.ok).toBe(true);
    expect(result.data!.action).toBe('generate_summary');
    expect(result.data!.ticketId).toBe('T-500');
    expect(result.data!.model).toBe('gpt-4o');
    expect(result.data!.maxTokens).toBe(200);
    expect(result.data!.messageCount).toBe(3);
    expect(result.data!.prompt).toBeDefined();
    expect((result.data!.prompt as string)).toContain('Login issue');
    expect((result.data!.prompt as string)).toContain('customer@example.com');
    expect(result.data!.note).toBeDefined();
  });

  it('uses default model and maxTokens', async () => {
    const result = await aiSummaryHandle(makeContext({
      event: 'ticket.resolved',
      data: { ticketId: 'T-501', messages: [{ from: 'a', body: 'b' }] },
    }));

    expect(result.data!.model).toBe('gpt-4o-mini');
    expect(result.data!.maxTokens).toBe(150);
  });

  it('skips when no messages are present', async () => {
    const result = await aiSummaryHandle(makeContext({
      event: 'ticket.resolved',
      data: { ticketId: 'T-502', messages: [] },
    }));

    expect(result.ok).toBe(true);
    expect(result.data!.skipped).toBe(true);
    expect((result.data!.reason as string)).toContain('No messages');
  });

  it('skips non-ticket.resolved events', async () => {
    const result = await aiSummaryHandle(makeContext({
      event: 'ticket.created',
    }));

    expect(result.data!.skipped).toBe(true);
  });

  it('builds prompt with all message authors and bodies', async () => {
    const messages = [
      { author: 'Alice', text: 'First message' },
      { author: 'Bob', text: 'Reply here' },
    ];

    const result = await aiSummaryHandle(makeContext({
      event: 'ticket.resolved',
      data: { ticketId: 'T-503', subject: 'Test', messages },
    }));

    const prompt = result.data!.prompt as string;
    expect(prompt).toContain('Alice');
    expect(prompt).toContain('Bob');
    expect(prompt).toContain('First message');
    expect(prompt).toContain('Reply here');
  });
});
