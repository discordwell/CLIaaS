import { describe, it, expect, beforeEach } from 'vitest';
import { setPipelineConfig, getPipelineConfig, DEFAULT_PIPELINE_CONFIG } from '../resolution-pipeline';

beforeEach(() => {
  global.__cliaasAIPipelineConfig = undefined;
  global.__cliaasApprovalQueue = [];
  global.__cliaasROIMetrics = undefined;
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
    const { resolveTicket } = await import('../resolution-pipeline');
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
