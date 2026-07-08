import { describe, it, expect, beforeEach } from 'vitest';
import { setPipelineConfig, getPipelineConfig, DEFAULT_PIPELINE_CONFIG, resolveTicket } from '../resolution-pipeline';

beforeEach(() => {
  (globalThis as Record<string, unknown>).__cliaasAIPipelineConfig = undefined;
  (globalThis as Record<string, unknown>).__cliaasAIResolutions = undefined;
  (globalThis as Record<string, unknown>).__cliaasAIAgentConfig = undefined;
  (globalThis as Record<string, unknown>).__cliaasROIMetrics = undefined;
  (globalThis as Record<string, unknown>).__cliaasAIChannelPolicies = undefined;
  (globalThis as Record<string, unknown>).__cliaasAICircuitBreaker = undefined;
});

describe('pipeline config', () => {
  it('returns default config when not set', () => {
    const config = getPipelineConfig();
    expect(config.enabled).toBe(false);
    expect(config.autoSend).toBe(false);
    expect(config.confidenceThreshold).toBe(0.7);
  });

  it('sets and gets config', () => {
    setPipelineConfig({ enabled: true, autoSend: true });
    const config = getPipelineConfig();
    expect(config.enabled).toBe(true);
    expect(config.autoSend).toBe(true);
    // Other fields preserved
    expect(config.confidenceThreshold).toBe(0.7);
  });
});

describe('pipeline disabled behavior', () => {
  it('resolveTicket returns escalated when disabled', async () => {
    const outcome = await resolveTicket(
      {
        id: 't-1',
        externalId: 't-1',
        source: 'zendesk',
        subject: 'Test',
        status: 'open',
        priority: 'normal',
        requester: 'a@b.com',
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      [],
    );
    expect(outcome.action).toBe('escalated');
    expect(outcome.result.escalated).toBe(true);
  });
});

describe('channel-policy overrides do not leak into shared config', () => {
  // A per-ticket channel policy tightens confidenceThreshold and can force
  // autoSend off for that ticket. Those overrides must stay local: resolving a
  // ticket must never mutate the global pipeline singleton (or the module-level
  // DEFAULT_PIPELINE_CONFIG), or every subsequent ticket inherits the tightened
  // threshold / disabled auto-send. The subject uses an excluded topic so the
  // agent short-circuits before any network call.
  const emailTicket = {
    id: 't-chan',
    externalId: 't-chan',
    source: 'zendesk',
    subject: 'Billing question about my invoice',
    status: 'open',
    priority: 'normal',
    requester: 'a@b.com',
    tags: [] as string[],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    channel: 'email',
  } as unknown as Parameters<typeof resolveTicket>[0];

  function setEmailPolicy() {
    (globalThis as Record<string, unknown>).__cliaasAIChannelPolicies = [
      {
        channel: 'email',
        enabled: true,
        mode: 'suggest', // not 'auto' -> forces config.autoSend = false for this ticket
        maxAutoResolvesPerHour: 100,
        confidenceThreshold: 0.9, // higher than the global 0.5
        excludedTopics: [],
      },
    ];
  }

  it('leaves the global singleton config unchanged after a resolve', async () => {
    setPipelineConfig({ enabled: true, confidenceThreshold: 0.5, autoSend: true });
    setEmailPolicy();

    await resolveTicket(emailTicket, []);

    const after = getPipelineConfig();
    expect(after.confidenceThreshold).toBe(0.5); // NOT raised to the channel's 0.9
    expect(after.autoSend).toBe(true);           // NOT forced off by the 'suggest' channel
  });

  it('does not mutate DEFAULT_PIPELINE_CONFIG', async () => {
    setPipelineConfig({ enabled: true, confidenceThreshold: 0.5, autoSend: true });
    setEmailPolicy();

    await resolveTicket(emailTicket, []);

    expect(DEFAULT_PIPELINE_CONFIG.confidenceThreshold).toBe(0.7);
    expect(DEFAULT_PIPELINE_CONFIG.autoSend).toBe(false);
  });

  it('a channel policy still applies to the ticket it resolves', async () => {
    // Sanity: the override must still take effect locally — a 'suggest' channel
    // must never auto-send, even if the global config has autoSend = true.
    setPipelineConfig({ enabled: true, confidenceThreshold: 0.5, autoSend: true });
    setEmailPolicy();

    const outcome = await resolveTicket(emailTicket, []);
    expect(outcome.action).not.toBe('auto_sent');
  });
});
