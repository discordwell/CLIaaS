/**
 * AutoQA engine tests.
 * Tests the scoring pipeline, flag creation, CSAT prediction, and config management.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the logger to suppress output
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock the JSONL store to use in-memory
vi.mock('@/lib/jsonl-store', () => ({
  readJsonlFile: () => [],
  writeJsonlFile: vi.fn(),
}));

describe('AutoQA Config Store', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns null for unknown workspace', async () => {
    const { getAutoQAConfig } = await import('@/lib/qa/autoqa-config-store');
    const config = await getAutoQAConfig('nonexistent');
    expect(config).toBeNull();
  });

  it('creates config on first upsert', async () => {
    const { upsertAutoQAConfig, getAutoQAConfig } = await import('@/lib/qa/autoqa-config-store');
    const config = upsertAutoQAConfig('ws-1', { enabled: true, sampleRate: 0.5 });
    expect(config.enabled).toBe(true);
    expect(config.sampleRate).toBe(0.5);
    expect(config.workspaceId).toBe('ws-1');

    const fetched = await getAutoQAConfig('ws-1');
    expect(fetched?.id).toBe(config.id);
  });

  it('updates existing config', async () => {
    const { upsertAutoQAConfig } = await import('@/lib/qa/autoqa-config-store');
    upsertAutoQAConfig('ws-2', { enabled: true });
    const updated = upsertAutoQAConfig('ws-2', { enabled: false, sampleRate: 0.3 });
    expect(updated.enabled).toBe(false);
    expect(updated.sampleRate).toBe(0.3);
  });
});

describe('QA Flags Store', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('creates and retrieves flags', async () => {
    const { createFlag, getFlags } = await import('@/lib/qa/qa-flags-store');
    createFlag({
      workspaceId: 'ws-1',
      reviewId: 'r-1',
      ticketId: 't-1',
      category: 'tone',
      severity: 'warning',
      message: 'Dismissive language detected',
    });
    createFlag({
      workspaceId: 'ws-1',
      reviewId: 'r-1',
      ticketId: 't-1',
      category: 'accuracy',
      severity: 'critical',
      message: 'Incorrect information',
    });

    const all = await getFlags({ workspaceId: 'ws-1' });
    expect(all).toHaveLength(2);

    const critical = await getFlags({ severity: 'critical' });
    expect(critical).toHaveLength(1);
    expect(critical[0].category).toBe('accuracy');
  });

  it('dismisses a flag', async () => {
    const { createFlag, dismissFlag, getFlags } = await import('@/lib/qa/qa-flags-store');
    const flag = createFlag({
      workspaceId: 'ws-1',
      reviewId: 'r-2',
      category: 'brand_voice',
      severity: 'info',
      message: 'Test flag',
    });

    const result = dismissFlag(flag.id, 'user-1');
    expect(result?.dismissed).toBe(true);
    expect(result?.dismissedBy).toBe('user-1');

    const active = await getFlags({ dismissed: false });
    expect(active.find(f => f.id === flag.id)).toBeUndefined();
  });
});

describe('CSAT Prediction Store', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('creates and retrieves predictions', async () => {
    const { createPrediction, getPredictions } = await import('@/lib/predictions/csat-prediction-store');
    createPrediction({
      workspaceId: 'ws-1',
      ticketId: 't-1',
      predictedScore: 4.2,
      confidence: 0.75,
      riskLevel: 'low',
      factors: { resolutionSpeed: 'fast' },
    });

    const preds = await getPredictions({ workspaceId: 'ws-1' });
    expect(preds).toHaveLength(1);
    expect(preds[0].predictedScore).toBe(4.2);
    expect(preds[0].riskLevel).toBe('low');
  });

  it('records actual score and computes accuracy', async () => {
    const { createPrediction, recordActualScore, getAccuracyStats } = await import('@/lib/predictions/csat-prediction-store');
    createPrediction({
      workspaceId: 'ws-1',
      ticketId: 't-2',
      predictedScore: 4.0,
      confidence: 0.7,
      riskLevel: 'low',
      factors: {},
    });

    const updated = recordActualScore('t-2', 5);
    expect(updated?.actualScore).toBe(5);

    const stats = await getAccuracyStats('ws-1');
    expect(stats.totalPredictions).toBe(1);
    expect(stats.withActual).toBe(1);
    expect(stats.avgError).toBe(1); // |4.0 - 5| = 1
  });
});

describe('CSAT Predictor (heuristic)', () => {
  it('predicts higher CSAT for fast resolution with positive signals', async () => {
    const { predictCSAT } = await import('@/lib/predictions/csat-predictor');
    const now = Date.now();
    const result = predictCSAT({
      ticket: {
        id: 't-1',
        externalId: 'ext-1',
        source: 'zendesk',
        subject: 'Login issue',
        status: 'solved',
        priority: 'normal',
        requester: 'customer@test.com',
        tags: [],
        createdAt: new Date(now - 30 * 60 * 1000).toISOString(), // 30 min ago
        updatedAt: new Date(now).toISOString(),
      },
      messages: [
        { id: 'm-1', ticketId: 't-1', author: 'customer@test.com', body: 'I cannot log in', type: 'reply', createdAt: new Date(now - 30 * 60 * 1000).toISOString() },
        { id: 'm-2', ticketId: 't-1', author: 'agent@test.com', body: 'Please try resetting your password', type: 'reply', createdAt: new Date(now - 20 * 60 * 1000).toISOString() },
        { id: 'm-3', ticketId: 't-1', author: 'customer@test.com', body: 'Thanks, that worked! Great help.', type: 'reply', createdAt: new Date(now - 10 * 60 * 1000).toISOString() },
      ],
    });

    expect(result.score).toBeGreaterThanOrEqual(4);
    expect(result.riskLevel).toBe('low');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('predicts lower CSAT for frustrated customer with slow resolution', async () => {
    const { predictCSAT } = await import('@/lib/predictions/csat-predictor');
    const now = Date.now();
    const result = predictCSAT({
      ticket: {
        id: 't-2',
        externalId: 'ext-2',
        source: 'zendesk',
        subject: 'Billing error',
        status: 'open',
        priority: 'urgent',
        requester: 'angry@test.com',
        tags: [],
        createdAt: new Date(now - 96 * 60 * 60 * 1000).toISOString(), // 96 hours ago
        updatedAt: new Date(now).toISOString(),
      },
      messages: [
        { id: 'm-1', ticketId: 't-2', author: 'angry@test.com', body: 'This is unacceptable, I was charged twice', type: 'reply', createdAt: new Date(now - 96 * 60 * 60 * 1000).toISOString() },
        { id: 'm-2', ticketId: 't-2', author: 'agent@test.com', body: 'Looking into it', type: 'reply', createdAt: new Date(now - 72 * 60 * 60 * 1000).toISOString() },
        { id: 'm-3', ticketId: 't-2', author: 'angry@test.com', body: 'Still not fixed, this is the worst support', type: 'reply', createdAt: new Date(now - 48 * 60 * 60 * 1000).toISOString() },
      ],
    });

    expect(result.score).toBeLessThanOrEqual(2.5);
    expect(result.riskLevel).toBe('high');
  });
});

describe('Customer Health Score Store', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('upserts and retrieves health scores', async () => {
    const { upsertHealthScore, getHealthScore } = await import('@/lib/customers/health-score-store');
    upsertHealthScore({
      workspaceId: 'ws-1',
      customerId: 'c-1',
      overallScore: 75,
      csatScore: 80,
      sentimentScore: 70,
      effortScore: 75,
      resolutionScore: 80,
      engagementScore: 60,
      trend: 'stable',
      signals: {},
    });

    const score = await getHealthScore('ws-1', 'c-1');
    expect(score?.overallScore).toBe(75);
    expect(score?.trend).toBe('stable');
  });

  it('identifies at-risk customers', async () => {
    const { upsertHealthScore, getAtRiskCustomers } = await import('@/lib/customers/health-score-store');
    upsertHealthScore({ workspaceId: 'ws-1', customerId: 'c-good', overallScore: 85, trend: 'improving', signals: {} });
    upsertHealthScore({ workspaceId: 'ws-1', customerId: 'c-bad', overallScore: 25, trend: 'declining', signals: {} });
    upsertHealthScore({ workspaceId: 'ws-1', customerId: 'c-mid', overallScore: 50, trend: 'stable', signals: {} });

    const atRisk = await getAtRiskCustomers('ws-1');
    expect(atRisk).toHaveLength(1);
    expect(atRisk[0].customerId).toBe('c-bad');
  });
});

describe('Health Engine', () => {
  it('computes health score from signals', async () => {
    const { computeHealthScore } = await import('@/lib/customers/health-engine');
    const now = Date.now();
    const result = await computeHealthScore({
      workspaceId: 'ws-1',
      customer: {
        id: 'c-test',
        name: 'Test Customer',
        email: 'test@test.com',
        createdAt: new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString(),
      } as any,
      tickets: [
        {
          id: 't-1',
          status: 'solved',
          createdAt: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
          updatedAt: new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString(),
          requester: 'Test Customer',
          subject: 'Help',
          priority: 'normal',
          tags: [],
          source: 'zendesk',
          externalId: 'ext-1',
        },
      ],
      messages: [
        { id: 'm-1', ticketId: 't-1', author: 'Test Customer', body: 'Thanks for the quick help!', type: 'reply', createdAt: new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString() },
      ],
      csatRatings: [
        { rating: 5, createdAt: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString() },
      ],
    });

    expect(result.overallScore).toBeGreaterThan(50);
    expect(result.csatScore).toBe(100); // 5/5 = 100%
    expect(result.trend).toBe('stable'); // no previous score
  });
});

describe('AutoQA Engine', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('skips when disabled', async () => {
    const { runAutoQA } = await import('@/lib/ai/autoqa');
    const result = await runAutoQA('t-1', 'ws-nonexistent', {
      ticket: { id: 't-1', subject: 'Test', status: 'solved', priority: 'normal', requester: 'user', tags: [], createdAt: '', updatedAt: '', source: 'email', externalId: 'ext' } as any,
      messages: [],
      responseText: 'Hello',
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain('disabled');
  });

  it('runs successfully with skipSampling when scorecard exists', async () => {
    // The qa-store seeds a default scorecard with 3 criteria (Accuracy, Tone & Empathy, Resolution Efficiency)
    // each with maxScore 5, so maxPossibleScore = 15
    const { runAutoQA } = await import('@/lib/ai/autoqa');
    const result = await runAutoQA('t-1', 'ws-1', {
      ticket: { id: 't-1', subject: 'Login issue', status: 'solved', priority: 'normal', requester: 'user@test.com', tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: 'email', externalId: 'ext' } as any,
      messages: [
        { id: 'm-1', ticketId: 't-1', author: 'user@test.com', body: 'I need help logging in', type: 'reply', createdAt: new Date().toISOString() },
        { id: 'm-2', ticketId: 't-1', author: 'agent@test.com', body: 'Here are the steps to resolve your login issue. Please try resetting your password.', type: 'reply', createdAt: new Date().toISOString() },
      ],
      responseText: 'Here are the steps to resolve your login issue. Please try resetting your password.',
    }, { skipSampling: true });

    expect(result.skipped).toBe(false);
    expect(result.review.totalScore).toBeGreaterThan(0);
    expect(result.review.maxPossibleScore).toBe(15);
    expect(result.review.reviewType).toBe('auto');
    expect(result.csatPrediction).toBeDefined();
    expect(result.csatPrediction?.score).toBeGreaterThan(0);
    expect(result.csatPrediction?.riskLevel).toBeDefined();
  });
});

describe('QA Coaching Store', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('creates and updates coaching assignments', async () => {
    const { createCoachingAssignment, getCoachingAssignments, updateCoachingAssignment } = await import('@/lib/qa/qa-coaching-store');

    const assignment = createCoachingAssignment({
      workspaceId: 'ws-1',
      reviewId: 'r-1',
      agentId: 'agent-1',
      assignedBy: 'manager-1',
      notes: 'Please review your tone in this conversation',
    });

    expect(assignment.status).toBe('pending');
    expect(assignment.agentId).toBe('agent-1');

    const updated = updateCoachingAssignment(assignment.id, { status: 'acknowledged' });
    expect(updated?.status).toBe('acknowledged');
    expect(updated?.acknowledgedAt).toBeDefined();

    const completed = updateCoachingAssignment(assignment.id, { status: 'completed', agentResponse: 'I will improve my tone' });
    expect(completed?.status).toBe('completed');
    expect(completed?.completedAt).toBeDefined();

    const all = await getCoachingAssignments({ agentId: 'agent-1' });
    expect(all).toHaveLength(1);
  });
});
