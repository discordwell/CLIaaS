import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Tests for the hallucination guard in the resolution pipeline.
 * When requireKbCitation is true and the AI response references no KB articles
 * despite KB articles being provided, the result should be escalated.
 */

beforeEach(() => {
  (globalThis as Record<string, unknown>).__cliaasAIPipelineConfig = undefined;
  (globalThis as Record<string, unknown>).__cliaasAIResolutions = undefined;
  (globalThis as Record<string, unknown>).__cliaasAIAgentConfig = undefined;
  (globalThis as Record<string, unknown>).__cliaasROIMetrics = undefined;
  (globalThis as Record<string, unknown>).__cliaasAIProcedures = undefined;
});

// Mock the AI agent to return a confident result with NO KB citations.
// Must return a fresh object each call to avoid cross-test mutation.
vi.mock('../agent', () => ({
  runAgent: vi.fn().mockImplementation(async () => ({
    ticketId: 't-1',
    resolved: true,
    confidence: 0.95,
    suggestedReply: 'Here is my answer without citing any KB article.',
    reasoning: 'I made up the answer.',
    escalated: false,
    kbArticlesUsed: [],
  })),
  DEFAULT_AGENT_CONFIG: {
    enabled: false,
    confidenceThreshold: 0.7,
    maxTokens: 1024,
    provider: 'claude',
    model: undefined,
    excludeTopics: ['billing', 'legal', 'security'],
    kbContext: true,
  },
}));

// Mock reply sender
vi.mock('../reply-sender', () => ({
  sendAIReply: vi.fn().mockResolvedValue(undefined),
}));

describe('hallucination guard', () => {
  it('escalates when requireKbCitation=true and no KB articles cited', async () => {
    const { resolveTicket } = await import('../resolution-pipeline');

    const ticket = {
      id: 't-1',
      externalId: 't-1',
      source: 'zendesk' as const,
      subject: 'How do I reset my password',
      status: 'open' as const,
      priority: 'normal' as const,
      requester: 'user@example.com',
      tags: ['password'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const kbArticles = [
      {
        id: 'kb-1',
        title: 'Password Reset Guide',
        body: 'Go to settings > security > reset password.',
        categoryPath: ['Account'],
        externalId: 'kb-1',
        locale: 'en',
        draft: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const configOverride = {
      id: 'cfg-1',
      workspaceId: 'ws-1',
      enabled: true,
      mode: 'auto' as const,
      confidenceThreshold: 0.7,
      provider: 'claude',
      maxTokens: 1024,
      excludedTopics: [],
      kbContext: true,
      piiDetection: false,
      maxAutoResolvesPerHour: 50,
      requireKbCitation: true,
      channels: [],
    };

    const outcome = await resolveTicket(ticket, [], kbArticles, {
      configOverride,
      workspaceId: 'ws-1',
    });

    // The hallucination guard should have escalated the result
    expect(outcome.result.escalated).toBe(true);
    expect(outcome.result.resolved).toBe(false);
    expect(outcome.result.escalationReason).toBe('No KB citation (hallucination guard)');
    expect(outcome.action).toBe('escalated');
  });

  it('does NOT escalate when requireKbCitation=false', async () => {
    const { resolveTicket } = await import('../resolution-pipeline');

    const ticket = {
      id: 't-2',
      externalId: 't-2',
      source: 'zendesk' as const,
      subject: 'How do I reset my password',
      status: 'open' as const,
      priority: 'normal' as const,
      requester: 'user@example.com',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const kbArticles = [
      {
        id: 'kb-1',
        title: 'Password Reset Guide',
        body: 'Go to settings > security > reset password.',
        categoryPath: ['Account'],
        externalId: 'kb-1',
        locale: 'en',
        draft: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const configOverride = {
      id: 'cfg-2',
      workspaceId: 'ws-1',
      enabled: true,
      mode: 'auto' as const,
      confidenceThreshold: 0.7,
      provider: 'claude',
      maxTokens: 1024,
      excludedTopics: [],
      kbContext: true,
      piiDetection: false,
      maxAutoResolvesPerHour: 50,
      requireKbCitation: false,
      channels: [],
    };

    const outcome = await resolveTicket(ticket, [], kbArticles, {
      configOverride,
      workspaceId: 'ws-1',
    });

    // Should NOT be escalated — guard is disabled
    expect(outcome.result.escalated).toBe(false);
    expect(outcome.result.resolved).toBe(true);
    expect(outcome.action).toBe('auto_sent');
  });
});
