/**
 * Tests for reference plugins: hello-world, slack-notifier, auto-tagger
 */

import { describe, it, expect } from 'vitest';
import { handle as handleHello, manifest as helloManifest } from '@/lib/plugins/reference/hello-world';
import { handle as handleSlack, manifest as slackManifest } from '@/lib/plugins/reference/slack-notifier';
import { handle as handleTagger, manifest as taggerManifest } from '@/lib/plugins/reference/auto-tagger';
import type { PluginHookContext } from '@/lib/plugins/types';

function makeContext(overrides: Partial<PluginHookContext> = {}): PluginHookContext {
  return {
    event: 'ticket.created',
    data: { ticketId: 'ticket-1', subject: 'Test ticket' },
    timestamp: new Date().toISOString(),
    workspaceId: 'ws-1',
    pluginId: 'test-plugin',
    config: {},
    ...overrides,
  };
}

describe('Hello World plugin', () => {
  it('has a valid manifest', () => {
    expect(helloManifest.id).toBe('hello-world');
    expect(helloManifest.hooks.length).toBeGreaterThan(0);
    expect(helloManifest.runtime).toBe('node');
  });

  it('returns ok for any event', async () => {
    const result = await handleHello(makeContext());
    expect(result.ok).toBe(true);
    expect(result.data?.event).toBe('ticket.created');
    expect(result.data?.ticketId).toBe('ticket-1');
  });

  it('uses custom greeting from config', async () => {
    const result = await handleHello(makeContext({ config: { greeting: 'Hey there!' } }));
    expect(result.ok).toBe(true);
    expect(result.data?.message).toContain('Hey there!');
  });
});

describe('Slack Notifier plugin', () => {
  it('has a valid manifest', () => {
    expect(slackManifest.id).toBe('slack-notifier');
    expect(slackManifest.hooks).toContain('ticket.created');
    expect(slackManifest.hooks).toContain('sla.breached');
    expect(slackManifest.permissions).toContain('tickets:read');
  });

  it('sends to default channel for normal priority', async () => {
    const result = await handleSlack(makeContext({
      config: { defaultChannel: '#support', urgentChannel: '#urgent' },
      data: { ticketId: 'ticket-1', subject: 'Help', priority: 'normal' },
    }));
    expect(result.ok).toBe(true);
    expect(result.data?.channel).toBe('#support');
  });

  it('routes urgent tickets to urgent channel', async () => {
    const result = await handleSlack(makeContext({
      config: { defaultChannel: '#support', urgentChannel: '#urgent' },
      data: { ticketId: 'ticket-1', subject: 'Down!', priority: 'urgent' },
    }));
    expect(result.ok).toBe(true);
    expect(result.data?.channel).toBe('#urgent');
  });

  it('skips when notifyOnCreate is disabled', async () => {
    const result = await handleSlack(makeContext({
      event: 'ticket.created',
      config: { notifyOnCreate: false },
    }));
    expect(result.ok).toBe(true);
    expect(result.data?.skipped).toBe(true);
  });

  it('skips when notifyOnResolve is disabled', async () => {
    const result = await handleSlack(makeContext({
      event: 'ticket.resolved',
      config: { notifyOnResolve: false },
    }));
    expect(result.ok).toBe(true);
    expect(result.data?.skipped).toBe(true);
  });

  it('uses rotating_light emoji for SLA breach', async () => {
    const result = await handleSlack(makeContext({
      event: 'sla.breached',
      data: { ticketId: 'ticket-1', subject: 'SLA missed' },
    }));
    expect(result.ok).toBe(true);
    expect(result.data?.emoji).toBe(':rotating_light:');
  });
});

describe('Auto-Tagger plugin', () => {
  it('has a valid manifest', () => {
    expect(taggerManifest.id).toBe('auto-tagger');
    expect(taggerManifest.hooks).toContain('ticket.created');
    expect(taggerManifest.permissions).toContain('tickets:write');
  });

  it('tags billing tickets', async () => {
    const result = await handleTagger(makeContext({
      data: { ticketId: 'ticket-1', subject: 'Invoice question', body: '' },
    }));
    expect(result.ok).toBe(true);
    expect(result.data?.tagsAdded).toContain('billing');
  });

  it('tags bug reports', async () => {
    const result = await handleTagger(makeContext({
      data: { ticketId: 'ticket-1', subject: 'App crash on login', body: '' },
    }));
    expect(result.ok).toBe(true);
    expect(result.data?.tagsAdded).toContain('bug-report');
  });

  it('applies multiple tags when multiple patterns match', async () => {
    const result = await handleTagger(makeContext({
      data: { ticketId: 'ticket-1', subject: 'Urgent billing bug', body: '' },
    }));
    expect(result.ok).toBe(true);
    const tags = result.data?.tagsAdded as string[];
    expect(tags).toContain('billing');
    expect(tags).toContain('bug-report');
    expect(tags).toContain('urgent');
  });

  it('returns empty tags when no keywords match', async () => {
    const result = await handleTagger(makeContext({
      data: { ticketId: 'ticket-1', subject: 'Hello', body: 'Just saying hi' },
    }));
    expect(result.ok).toBe(true);
    expect(result.data?.tagsAdded).toHaveLength(0);
  });

  it('skips when tagOnCreate is disabled', async () => {
    const result = await handleTagger(makeContext({
      event: 'ticket.created',
      config: { tagOnCreate: false },
      data: { ticketId: 'ticket-1', subject: 'Invoice' },
    }));
    expect(result.ok).toBe(true);
    expect(result.data?.skipped).toBe(true);
  });

  it('uses custom keyword mappings from config', async () => {
    const result = await handleTagger(makeContext({
      config: {
        keywordMappings: { 'vip|enterprise': 'high-value' },
      },
      data: { ticketId: 'ticket-1', subject: 'VIP customer issue', body: '' },
    }));
    expect(result.ok).toBe(true);
    expect(result.data?.tagsAdded).toContain('high-value');
  });

  it('scans message body as well', async () => {
    const result = await handleTagger(makeContext({
      data: { ticketId: 'ticket-1', subject: 'Help please', body: 'I need to cancel my subscription' },
    }));
    expect(result.ok).toBe(true);
    expect(result.data?.tagsAdded).toContain('churn-risk');
  });
});
