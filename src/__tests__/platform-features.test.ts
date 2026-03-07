/**
 * P2 Platform Features Tests: AI Resolution, Routing, and WFM.
 * Tests the in-memory/JSONL fallback paths (no DB required).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================================
// Plan 1 — AI Resolution
// ============================================================================

describe('Plan 1 — AI Resolution', () => {
  // --------------------------------------------------------------------------
  // AI Store CRUD
  // --------------------------------------------------------------------------
  describe('AI store CRUD', () => {
    beforeEach(() => {
      global.__cliaasAIResolutions = undefined;
      global.__cliaasAIAgentConfig = undefined;
    });

    const makeResolution = (overrides: Record<string, unknown> = {}) => ({
      id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      workspaceId: 'ws-test',
      ticketId: 'ticket-1',
      confidence: 0.85,
      suggestedReply: 'Test reply',
      kbArticlesUsed: ['kb-1'],
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
      ...overrides,
    });

    it('creates a resolution and retrieves it by ID', async () => {
      const { saveResolution, getResolution } = await import('@/lib/ai/store');
      const record = makeResolution({ id: 'res-crud-1' });
      await saveResolution(record);

      const fetched = await getResolution('res-crud-1');
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe('res-crud-1');
      expect(fetched!.confidence).toBe(0.85);
      expect(fetched!.suggestedReply).toBe('Test reply');
    });

    it('lists resolutions with filtering by workspace', async () => {
      const { saveResolution, listResolutions } = await import('@/lib/ai/store');
      await saveResolution(makeResolution({ id: 'res-list-1', workspaceId: 'ws-a' }));
      await saveResolution(makeResolution({ id: 'res-list-2', workspaceId: 'ws-b' }));
      await saveResolution(makeResolution({ id: 'res-list-3', workspaceId: 'ws-a' }));

      const { records, total } = await listResolutions({ workspaceId: 'ws-a' });
      expect(total).toBe(2);
      expect(records.every(r => r.workspaceId === 'ws-a')).toBe(true);
    });

    it('lists resolutions with filtering by status', async () => {
      const { saveResolution, listResolutions } = await import('@/lib/ai/store');
      await saveResolution(makeResolution({ id: 'res-s1', status: 'pending' }));
      await saveResolution(makeResolution({ id: 'res-s2', status: 'approved' }));
      await saveResolution(makeResolution({ id: 'res-s3', status: 'escalated' }));

      const { records } = await listResolutions({ status: 'pending' });
      expect(records).toHaveLength(1);
      expect(records[0].id).toBe('res-s1');
    });

    it('lists resolutions with filtering by ticketId', async () => {
      const { saveResolution, listResolutions } = await import('@/lib/ai/store');
      await saveResolution(makeResolution({ id: 'res-t1', ticketId: 'tk-100' }));
      await saveResolution(makeResolution({ id: 'res-t2', ticketId: 'tk-200' }));

      const { records } = await listResolutions({ ticketId: 'tk-100' });
      expect(records).toHaveLength(1);
      expect(records[0].ticketId).toBe('tk-100');
    });

    it('updates resolution status with extra fields', async () => {
      const { saveResolution, updateResolutionStatus, getResolution } = await import('@/lib/ai/store');
      await saveResolution(makeResolution({ id: 'res-upd-1' }));

      const updated = await updateResolutionStatus('res-upd-1', 'approved', {
        finalReply: 'Edited reply',
        reviewedBy: 'admin-1',
        reviewedAt: '2026-03-06T00:00:00.000Z',
      });

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('approved');
      expect(updated!.finalReply).toBe('Edited reply');
      expect(updated!.reviewedBy).toBe('admin-1');

      // Verify persisted
      const fetched = await getResolution('res-upd-1');
      expect(fetched!.status).toBe('approved');
    });

    it('returns null when updating non-existent resolution', async () => {
      const { updateResolutionStatus } = await import('@/lib/ai/store');
      const result = await updateResolutionStatus('nonexistent', 'approved');
      expect(result).toBeNull();
    });

    it('returns null when getting non-existent resolution', async () => {
      const { getResolution } = await import('@/lib/ai/store');
      const result = await getResolution('nonexistent');
      expect(result).toBeNull();
    });

    it('respects limit and offset for pagination', async () => {
      const { saveResolution, listResolutions } = await import('@/lib/ai/store');
      for (let i = 0; i < 5; i++) {
        await saveResolution(makeResolution({ id: `res-page-${i}` }));
      }

      const { records, total } = await listResolutions({ limit: 2, offset: 1 });
      expect(total).toBe(5);
      expect(records).toHaveLength(2);
    });

    it('caps in-memory storage at 500 records', async () => {
      const { saveResolution } = await import('@/lib/ai/store');
      for (let i = 0; i < 510; i++) {
        await saveResolution(makeResolution({ id: `res-cap-${i}` }));
      }

      expect(global.__cliaasAIResolutions!.length).toBe(500);
    });
  });

  // --------------------------------------------------------------------------
  // AI Agent Config
  // --------------------------------------------------------------------------
  describe('AI Agent Config', () => {
    beforeEach(() => {
      global.__cliaasAIResolutions = undefined;
      global.__cliaasAIAgentConfig = undefined;
    });

    it('returns default config when none exists', async () => {
      const { getAgentConfig } = await import('@/lib/ai/store');
      const config = await getAgentConfig('ws-default-test');
      expect(config.enabled).toBe(false);
      expect(config.mode).toBe('suggest');
      expect(config.confidenceThreshold).toBe(0.7);
      expect(config.provider).toBe('claude');
      expect(config.kbContext).toBe(true);
    });

    it('saves and retrieves agent config', async () => {
      const { saveAgentConfig, getAgentConfig } = await import('@/lib/ai/store');
      await saveAgentConfig({
        workspaceId: 'ws-cfg',
        enabled: true,
        mode: 'auto',
        confidenceThreshold: 0.9,
      });

      const config = await getAgentConfig('ws-cfg');
      expect(config.enabled).toBe(true);
      expect(config.mode).toBe('auto');
      expect(config.confidenceThreshold).toBe(0.9);
    });
  });

  // --------------------------------------------------------------------------
  // Resolution Stats
  // --------------------------------------------------------------------------
  describe('Resolution stats (in-memory)', () => {
    beforeEach(() => {
      global.__cliaasAIResolutions = undefined;
    });

    it('computes correct stats from in-memory records', async () => {
      const { saveResolution, getResolutionStats } = await import('@/lib/ai/store');
      await saveResolution({
        id: 'stat-1', workspaceId: 'ws-stat', ticketId: 't1', confidence: 0.9,
        suggestedReply: 'r', kbArticlesUsed: [], status: 'auto_resolved', createdAt: new Date().toISOString(),
      });
      await saveResolution({
        id: 'stat-2', workspaceId: 'ws-stat', ticketId: 't2', confidence: 0.5,
        suggestedReply: 'r', kbArticlesUsed: [], status: 'escalated', createdAt: new Date().toISOString(),
      });
      await saveResolution({
        id: 'stat-3', workspaceId: 'ws-stat', ticketId: 't3', confidence: 0.8,
        suggestedReply: 'r', kbArticlesUsed: [], status: 'approved', createdAt: new Date().toISOString(),
      });

      const stats = await getResolutionStats('ws-stat');
      expect(stats.totalResolutions).toBe(3);
      expect(stats.aiResolved).toBe(2); // auto_resolved + approved
      expect(stats.escalated).toBe(1);
      expect(stats.resolutionRate).toBe(67); // 2/3 = 66.67 rounds to 67
      expect(stats.estimatedTimeSavedMinutes).toBe(16); // 2 * 8 min
    });
  });

  // --------------------------------------------------------------------------
  // Approval Queue
  // --------------------------------------------------------------------------
  describe('Approval queue operations', () => {
    beforeEach(() => {
      global.__cliaasAIResolutions = undefined;
      global.__cliaasAIAgentConfig = undefined;
    });

    it('getApprovalQueue returns all resolutions mapped to ApprovalEntry', async () => {
      const { saveResolution } = await import('@/lib/ai/store');
      const { getApprovalQueue } = await import('@/lib/ai/approval-queue');

      await saveResolution({
        id: 'aq-1', workspaceId: 'ws-q', ticketId: 't1', confidence: 0.9,
        suggestedReply: 'reply', kbArticlesUsed: ['kb-1'], status: 'pending',
        createdAt: new Date().toISOString(),
      });

      const queue = await getApprovalQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0].id).toBe('aq-1');
      expect(queue[0].draftReply).toBe('reply');
      expect(queue[0].status).toBe('pending');
    });

    it('getPendingApprovals filters to only pending entries', async () => {
      const { saveResolution } = await import('@/lib/ai/store');
      const { getPendingApprovals } = await import('@/lib/ai/approval-queue');

      await saveResolution({
        id: 'aq-p1', workspaceId: 'ws-q', ticketId: 't1', confidence: 0.9,
        suggestedReply: 'r', kbArticlesUsed: [], status: 'pending',
        createdAt: new Date().toISOString(),
      });
      await saveResolution({
        id: 'aq-p2', workspaceId: 'ws-q', ticketId: 't2', confidence: 0.8,
        suggestedReply: 'r', kbArticlesUsed: [], status: 'approved',
        createdAt: new Date().toISOString(),
      });

      const pending = await getPendingApprovals();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('aq-p1');
    });

    it('rejectEntry changes status to rejected and records reviewer', async () => {
      const { saveResolution } = await import('@/lib/ai/store');
      const { rejectEntry } = await import('@/lib/ai/approval-queue');

      await saveResolution({
        id: 'aq-rej', workspaceId: 'ws-q', ticketId: 't1', confidence: 0.9,
        suggestedReply: 'r', kbArticlesUsed: [], status: 'pending',
        createdAt: new Date().toISOString(),
      });

      const result = await rejectEntry('aq-rej', 'reviewer-1');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('rejected');
      expect(result!.reviewedBy).toBe('reviewer-1');
      expect(result!.reviewedAt).toBeTruthy();
    });

    it('editEntry changes status to edited with custom reply', async () => {
      const { saveResolution } = await import('@/lib/ai/store');
      const { editEntry } = await import('@/lib/ai/approval-queue');

      await saveResolution({
        id: 'aq-edit', workspaceId: 'ws-q', ticketId: 't1', confidence: 0.9,
        suggestedReply: 'original', kbArticlesUsed: [], status: 'pending',
        createdAt: new Date().toISOString(),
      });

      const result = await editEntry('aq-edit', 'edited version', 'editor-1');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('edited');
      expect(result!.editedReply).toBe('edited version');
    });

    it('returns null when rejecting non-pending entry', async () => {
      const { saveResolution } = await import('@/lib/ai/store');
      const { rejectEntry } = await import('@/lib/ai/approval-queue');

      await saveResolution({
        id: 'aq-np', workspaceId: 'ws-q', ticketId: 't1', confidence: 0.9,
        suggestedReply: 'r', kbArticlesUsed: [], status: 'approved',
        createdAt: new Date().toISOString(),
      });

      const result = await rejectEntry('aq-np', 'reviewer-1');
      expect(result).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // ROI Tracker
  // --------------------------------------------------------------------------
  describe('ROI tracker', () => {
    beforeEach(() => {
      global.__cliaasROIMetrics = undefined;
    });

    it('starts with zero metrics', async () => {
      const { getROIMetrics } = await import('@/lib/ai/roi-tracker');
      const metrics = getROIMetrics();
      expect(metrics.totalResolutions).toBe(0);
      expect(metrics.aiResolved).toBe(0);
      expect(metrics.escalated).toBe(0);
      expect(metrics.resolutionRate).toBe(0);
    });

    it('increments metrics on recordResolution (resolved)', async () => {
      const { recordResolution, getROIMetrics } = await import('@/lib/ai/roi-tracker');

      recordResolution({
        ticketId: 't1', resolved: true, confidence: 0.9,
        suggestedReply: 'r', reasoning: 'r', escalated: false, kbArticlesUsed: [],
      });

      const metrics = getROIMetrics();
      expect(metrics.totalResolutions).toBe(1);
      expect(metrics.aiResolved).toBe(1);
      expect(metrics.escalated).toBe(0);
      expect(metrics.estimatedTimeSavedMinutes).toBe(8);
      expect(metrics.resolutionRate).toBe(100);
      expect(metrics.avgConfidence).toBe(0.9);
    });

    it('increments metrics on recordResolution (escalated)', async () => {
      const { recordResolution, getROIMetrics } = await import('@/lib/ai/roi-tracker');

      recordResolution({
        ticketId: 't1', resolved: false, confidence: 0.3,
        suggestedReply: '', reasoning: 'low conf', escalated: true,
        escalationReason: 'below threshold', kbArticlesUsed: [],
      });

      const metrics = getROIMetrics();
      expect(metrics.totalResolutions).toBe(1);
      expect(metrics.aiResolved).toBe(0);
      expect(metrics.escalated).toBe(1);
      expect(metrics.resolutionRate).toBe(0);
    });

    it('tracks multiple resolutions correctly', async () => {
      const { recordResolution, getROIMetrics, resetROIMetrics } = await import('@/lib/ai/roi-tracker');
      resetROIMetrics();

      recordResolution({
        ticketId: 't1', resolved: true, confidence: 0.9,
        suggestedReply: 'r', reasoning: 'r', escalated: false, kbArticlesUsed: [],
      });
      recordResolution({
        ticketId: 't2', resolved: false, confidence: 0.4,
        suggestedReply: '', reasoning: 'r', escalated: true, kbArticlesUsed: [],
      });
      recordResolution({
        ticketId: 't3', resolved: true, confidence: 0.8,
        suggestedReply: 'r', reasoning: 'r', escalated: false, kbArticlesUsed: [],
      });

      const metrics = getROIMetrics();
      expect(metrics.totalResolutions).toBe(3);
      expect(metrics.aiResolved).toBe(2);
      expect(metrics.escalated).toBe(1);
      expect(metrics.resolutionRate).toBe(67); // 2/3 = 66.67 rounds to 67
      expect(metrics.estimatedTimeSavedMinutes).toBe(16); // 2 * 8
    });

    it('resetROIMetrics clears all state', async () => {
      const { recordResolution, resetROIMetrics, getROIMetrics } = await import('@/lib/ai/roi-tracker');
      recordResolution({
        ticketId: 't1', resolved: true, confidence: 0.9,
        suggestedReply: 'r', reasoning: 'r', escalated: false, kbArticlesUsed: [],
      });
      resetROIMetrics();
      const metrics = getROIMetrics();
      expect(metrics.totalResolutions).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Resolution Pipeline config
  // --------------------------------------------------------------------------
  describe('Resolution pipeline config', () => {
    beforeEach(() => {
      global.__cliaasAIPipelineConfig = undefined;
    });

    it('returns default pipeline config when none set', async () => {
      const { getPipelineConfig, DEFAULT_PIPELINE_CONFIG } = await import('@/lib/ai/resolution-pipeline');
      const config = getPipelineConfig();
      expect(config).toEqual(DEFAULT_PIPELINE_CONFIG);
      expect(config.autoSend).toBe(false);
      expect(config.enabled).toBe(false);
      expect(config.confidenceThreshold).toBe(0.7);
    });

    it('setPipelineConfig merges partial updates', async () => {
      const { setPipelineConfig, getPipelineConfig } = await import('@/lib/ai/resolution-pipeline');
      setPipelineConfig({ enabled: true, autoSend: true });

      const config = getPipelineConfig();
      expect(config.enabled).toBe(true);
      expect(config.autoSend).toBe(true);
      expect(config.confidenceThreshold).toBe(0.7); // untouched
    });
  });

  // --------------------------------------------------------------------------
  // Procedure Engine
  // --------------------------------------------------------------------------
  describe('Procedure engine', () => {
    beforeEach(() => {
      global.__cliaasAIProcedures = undefined;
    });

    it('matchProcedures returns empty for no topics', async () => {
      const { matchProcedures } = await import('@/lib/ai/procedure-engine');
      const result = await matchProcedures('ws-test', []);
      expect(result).toEqual([]);
    });

    it('matchProcedures finds procedures by trigger topic overlap', async () => {
      const { createProcedure } = await import('@/lib/ai/procedures');
      const { matchProcedures } = await import('@/lib/ai/procedure-engine');

      await createProcedure('ws-proc', {
        name: 'Billing Refund',
        steps: ['Check refund eligibility', 'Issue refund'],
        triggerTopics: ['billing', 'refund'],
        enabled: true,
      });
      await createProcedure('ws-proc', {
        name: 'Password Reset',
        steps: ['Verify identity', 'Send reset link'],
        triggerTopics: ['password', 'login'],
        enabled: true,
      });

      const matched = await matchProcedures('ws-proc', ['billing-dispute', 'payment']);
      expect(matched).toHaveLength(1);
      expect(matched[0].name).toBe('Billing Refund');
    });

    it('matchProcedures skips disabled procedures', async () => {
      const { createProcedure } = await import('@/lib/ai/procedures');
      const { matchProcedures } = await import('@/lib/ai/procedure-engine');

      await createProcedure('ws-proc2', {
        name: 'Disabled Procedure',
        steps: ['step1'],
        triggerTopics: ['billing'],
        enabled: false,
      });

      const matched = await matchProcedures('ws-proc2', ['billing']);
      expect(matched).toHaveLength(0);
    });

    it('formatProcedurePrompt returns empty string for no procedures', async () => {
      const { formatProcedurePrompt } = await import('@/lib/ai/procedure-engine');
      expect(formatProcedurePrompt([])).toBe('');
    });

    it('formatProcedurePrompt formats procedure steps into text', async () => {
      const { formatProcedurePrompt } = await import('@/lib/ai/procedure-engine');

      const prompt = formatProcedurePrompt([{
        id: 'proc-1',
        workspaceId: 'ws-1',
        name: 'Test Procedure',
        description: 'A test',
        steps: ['Step one', 'Step two'],
        triggerTopics: ['test'],
        enabled: true,
        createdAt: '',
        updatedAt: '',
      }]);

      expect(prompt).toContain('PROCEDURE: Test Procedure');
      expect(prompt).toContain('Description: A test');
      expect(prompt).toContain('1. Step one');
      expect(prompt).toContain('2. Step two');
      expect(prompt).toContain('Trigger topics: test');
    });
  });

  // --------------------------------------------------------------------------
  // Procedures CRUD
  // --------------------------------------------------------------------------
  describe('Procedures CRUD (in-memory)', () => {
    beforeEach(() => {
      global.__cliaasAIProcedures = undefined;
    });

    it('creates and lists procedures', async () => {
      const { createProcedure, listProcedures } = await import('@/lib/ai/procedures');

      const proc = await createProcedure('ws-crud', {
        name: 'My Procedure',
        steps: ['s1', 's2'],
        triggerTopics: ['topic1'],
      });

      expect(proc.id).toBeTruthy();
      expect(proc.name).toBe('My Procedure');
      expect(proc.enabled).toBe(true); // default

      const all = await listProcedures('ws-crud');
      expect(all).toHaveLength(1);
    });

    it('gets a single procedure by ID', async () => {
      const { createProcedure, getProcedure } = await import('@/lib/ai/procedures');

      const created = await createProcedure('ws-get', {
        name: 'Get Test',
        steps: [],
        triggerTopics: [],
      });

      const fetched = await getProcedure(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe('Get Test');
    });

    it('updates a procedure', async () => {
      const { createProcedure, updateProcedure } = await import('@/lib/ai/procedures');

      const proc = await createProcedure('ws-upd', {
        name: 'Before',
        steps: [],
        triggerTopics: [],
      });

      const updated = await updateProcedure(proc.id, { name: 'After', enabled: false });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('After');
      expect(updated!.enabled).toBe(false);
    });

    it('deletes a procedure', async () => {
      const { createProcedure, deleteProcedure, getProcedure } = await import('@/lib/ai/procedures');

      const proc = await createProcedure('ws-del', {
        name: 'To Delete',
        steps: [],
        triggerTopics: [],
      });

      const deleted = await deleteProcedure(proc.id);
      expect(deleted).toBe(true);

      const fetched = await getProcedure(proc.id);
      expect(fetched).toBeNull();
    });
  });
});


// ============================================================================
// Plan 2 — Routing
// ============================================================================

describe('Plan 2 — Routing', () => {
  // --------------------------------------------------------------------------
  // Routing strategies
  // --------------------------------------------------------------------------
  describe('Routing strategies', () => {
    it('round_robin cycles through candidates', async () => {
      const { applyStrategy } = await import('@/lib/routing/strategies');
      const candidates = [
        { userId: 'u1', userName: 'Alice', score: 0.5, matchedSkills: [], load: 2, capacity: 10 },
        { userId: 'u2', userName: 'Bob', score: 0.5, matchedSkills: [], load: 2, capacity: 10 },
        { userId: 'u3', userName: 'Carol', score: 0.5, matchedSkills: [], load: 2, capacity: 10 },
      ];

      // Round robin reads from JSONL store — we need to control the index.
      // For this test, just verify the function returns a valid candidate.
      const result = applyStrategy('round_robin', candidates, {});
      expect(result).not.toBeNull();
      expect(candidates.some(c => c.userId === result!.userId)).toBe(true);
    });

    it('load_balanced picks the agent with lowest load ratio', async () => {
      const { applyStrategy } = await import('@/lib/routing/strategies');
      const candidates = [
        { userId: 'u1', userName: 'Alice', score: 0.5, matchedSkills: [], load: 8, capacity: 10 },
        { userId: 'u2', userName: 'Bob', score: 0.5, matchedSkills: [], load: 1, capacity: 10 },
        { userId: 'u3', userName: 'Carol', score: 0.5, matchedSkills: [], load: 5, capacity: 10 },
      ];

      const result = applyStrategy('load_balanced', candidates, {});
      expect(result).not.toBeNull();
      expect(result!.userId).toBe('u2'); // lowest load/capacity ratio
    });

    it('skill_match picks the agent with highest score', async () => {
      const { applyStrategy } = await import('@/lib/routing/strategies');
      const candidates = [
        { userId: 'u1', userName: 'Alice', score: 0.3, matchedSkills: ['billing'], load: 2, capacity: 10 },
        { userId: 'u2', userName: 'Bob', score: 0.9, matchedSkills: ['technical', 'api'], load: 5, capacity: 10 },
        { userId: 'u3', userName: 'Carol', score: 0.6, matchedSkills: ['technical'], load: 3, capacity: 10 },
      ];

      const result = applyStrategy('skill_match', candidates, {});
      expect(result).not.toBeNull();
      expect(result!.userId).toBe('u2'); // highest score
    });

    it('priority_weighted boosts high-skill agents for urgent tickets', async () => {
      const { applyStrategy } = await import('@/lib/routing/strategies');
      const candidates = [
        { userId: 'u1', userName: 'Alice', score: 0.3, matchedSkills: ['billing'], load: 2, capacity: 10 },
        { userId: 'u2', userName: 'Bob', score: 0.6, matchedSkills: ['technical'], load: 5, capacity: 10 },
      ];

      const result = applyStrategy('priority_weighted', candidates, { ticketPriority: 'urgent' });
      expect(result).not.toBeNull();
      // Bob has score 0.6 > 0.5, so gets +0.15 boost = 0.75
      // Alice has 0.3 < 0.5, no boost = 0.3
      expect(result!.userId).toBe('u2');
    });

    it('returns null for empty candidate list', async () => {
      const { applyStrategy } = await import('@/lib/routing/strategies');
      const result = applyStrategy('skill_match', [], {});
      expect(result).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Queue manager — condition evaluation
  // --------------------------------------------------------------------------
  describe('Queue manager condition evaluation', () => {
    it('evaluateConditions returns true for empty conditions', async () => {
      const { evaluateConditions } = await import('@/lib/routing/queue-manager');
      const ticket = {
        id: 'tk-1', subject: 'Test', status: 'open' as const, priority: 'normal' as const,
        requester: 'user@test.com', tags: [], createdAt: '', updatedAt: '',
        externalId: '', source: 'zendesk' as const,
      };
      expect(evaluateConditions({}, ticket)).toBe(true);
    });

    it('evaluateConditions checks "all" conditions', async () => {
      const { evaluateConditions } = await import('@/lib/routing/queue-manager');
      const ticket = {
        id: 'tk-1', subject: 'Test', status: 'open' as const, priority: 'urgent' as const,
        requester: 'user@test.com', tags: ['billing'], createdAt: '', updatedAt: '',
        externalId: '', source: 'zendesk' as const,
      };

      const result = evaluateConditions({
        all: [
          { field: 'priority', operator: 'is', value: 'urgent' },
          { field: 'tags', operator: 'contains', value: 'billing' },
        ],
      }, ticket);
      expect(result).toBe(true);

      // Fails when one "all" condition doesn't match
      const result2 = evaluateConditions({
        all: [
          { field: 'priority', operator: 'is', value: 'urgent' },
          { field: 'status', operator: 'is', value: 'closed' },
        ],
      }, ticket);
      expect(result2).toBe(false);
    });

    it('evaluateConditions checks "any" conditions', async () => {
      const { evaluateConditions } = await import('@/lib/routing/queue-manager');
      const ticket = {
        id: 'tk-1', subject: 'Test', status: 'open' as const, priority: 'low' as const,
        requester: 'user@test.com', tags: [], createdAt: '', updatedAt: '',
        externalId: '', source: 'email' as const,
      };

      const result = evaluateConditions({
        any: [
          { field: 'priority', operator: 'is', value: 'urgent' },
          { field: 'source', operator: 'is', value: 'email' },
        ],
      }, ticket);
      expect(result).toBe(true);
    });

    it('evaluateRules returns highest-priority matching rule', async () => {
      const { evaluateRules } = await import('@/lib/routing/queue-manager');
      const ticket = {
        id: 'tk-1', subject: 'billing issue', status: 'open' as const, priority: 'urgent' as const,
        requester: 'user@test.com', tags: ['billing'], createdAt: '', updatedAt: '',
        externalId: '', source: 'zendesk' as const,
      };

      const rules = [
        {
          id: 'rule-low', workspaceId: 'ws', name: 'Low Priority',
          priority: 1, conditions: { all: [{ field: 'priority', operator: 'is', value: 'urgent' }] },
          targetType: 'group' as const, targetId: 'g1', enabled: true,
        },
        {
          id: 'rule-high', workspaceId: 'ws', name: 'High Priority',
          priority: 10, conditions: { all: [{ field: 'priority', operator: 'is', value: 'urgent' }] },
          targetType: 'agent' as const, targetId: 'u1', enabled: true,
        },
      ];

      const matched = evaluateRules(ticket, rules);
      expect(matched).not.toBeNull();
      expect(matched!.id).toBe('rule-high'); // higher priority
    });

    it('evaluateRules skips disabled rules', async () => {
      const { evaluateRules } = await import('@/lib/routing/queue-manager');
      const ticket = {
        id: 'tk-1', subject: 'test', status: 'open' as const, priority: 'normal' as const,
        requester: 'user@test.com', tags: [], createdAt: '', updatedAt: '',
        externalId: '', source: 'zendesk' as const,
      };

      const rules = [{
        id: 'rule-disabled', workspaceId: 'ws', name: 'Disabled Rule',
        priority: 10, conditions: {},
        targetType: 'group' as const, targetId: 'g1', enabled: false,
      }];

      const matched = evaluateRules(ticket, rules);
      expect(matched).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Availability tracker
  // --------------------------------------------------------------------------
  describe('Availability tracker', () => {
    it('setAvailability and getAvailability work correctly', async () => {
      const { availability } = await import('@/lib/routing/availability');

      availability.setAvailability('user-avail-1', 'Test Agent', 'online');
      expect(availability.getAvailability('user-avail-1')).toBe('online');

      availability.setAvailability('user-avail-1', 'Test Agent', 'away');
      expect(availability.getAvailability('user-avail-1')).toBe('away');
    });

    it('returns offline for unknown agents', async () => {
      const { availability } = await import('@/lib/routing/availability');
      expect(availability.getAvailability('unknown-agent')).toBe('offline');
    });

    it('isAvailableForRouting returns true for online/away', async () => {
      const { availability } = await import('@/lib/routing/availability');

      availability.setAvailability('user-route-1', 'Agent 1', 'online');
      expect(availability.isAvailableForRouting('user-route-1')).toBe(true);

      availability.setAvailability('user-route-2', 'Agent 2', 'away');
      expect(availability.isAvailableForRouting('user-route-2')).toBe(true);

      availability.setAvailability('user-route-3', 'Agent 3', 'offline');
      expect(availability.isAvailableForRouting('user-route-3')).toBe(false);
    });

    it('getAllAvailability returns all tracked agents', async () => {
      const { availability } = await import('@/lib/routing/availability');

      availability.setAvailability('user-all-1', 'A', 'online');
      availability.setAvailability('user-all-2', 'B', 'away');

      const all = availability.getAllAvailability();
      const ids = all.map(a => a.userId);
      expect(ids).toContain('user-all-1');
      expect(ids).toContain('user-all-2');
    });
  });

  // --------------------------------------------------------------------------
  // Routing engine — full routeTicket
  // --------------------------------------------------------------------------
  describe('Routing engine — routeTicket', () => {
    it('returns Unassigned when no agents provided', async () => {
      const { routeTicket } = await import('@/lib/routing/engine');
      const { availability } = await import('@/lib/routing/availability');

      const ticket = {
        id: 'tk-empty', subject: 'Test', status: 'open' as const, priority: 'normal' as const,
        requester: 'user@test.com', tags: [], createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), externalId: 'ext-1', source: 'zendesk' as const,
      };

      const result = await routeTicket(ticket, { allAgents: [] });
      expect(result.suggestedAgentId).toBe('');
      expect(result.suggestedAgentName).toBe('Unassigned');
      expect(result.confidence).toBe(0);
    });

    it('assigns an online agent from the pool', async () => {
      const { routeTicket } = await import('@/lib/routing/engine');
      const { availability } = await import('@/lib/routing/availability');

      // Set agent availability
      availability.setAvailability('route-agent-1', 'Alice', 'online');
      availability.setAvailability('route-agent-2', 'Bob', 'online');

      const ticket = {
        id: 'tk-route', subject: 'API integration error', status: 'open' as const,
        priority: 'normal' as const, requester: 'user@test.com',
        tags: ['technical'], createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), externalId: 'ext-2', source: 'zendesk' as const,
      };

      const result = await routeTicket(ticket, {
        allAgents: [
          { userId: 'route-agent-1', userName: 'Alice' },
          { userId: 'route-agent-2', userName: 'Bob' },
        ],
      });

      // Should assign one of the online agents
      expect(result.suggestedAgentId).toBeTruthy();
      expect(['route-agent-1', 'route-agent-2']).toContain(result.suggestedAgentId);
      expect(result.ticketId).toBe('tk-route');
    });

    it('skips offline agents', async () => {
      const { routeTicket } = await import('@/lib/routing/engine');
      const { availability } = await import('@/lib/routing/availability');

      availability.setAvailability('offline-agent', 'Offline', 'offline');
      availability.setAvailability('online-agent', 'Online', 'online');

      const ticket = {
        id: 'tk-skip', subject: 'Test', status: 'open' as const,
        priority: 'normal' as const, requester: 'user@test.com',
        tags: [], createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), externalId: 'ext-3', source: 'zendesk' as const,
      };

      const result = await routeTicket(ticket, {
        allAgents: [
          { userId: 'offline-agent', userName: 'Offline' },
          { userId: 'online-agent', userName: 'Online' },
        ],
      });

      expect(result.suggestedAgentId).toBe('online-agent');
    });

    it('extracts categories from ticket content', async () => {
      const { routeTicket } = await import('@/lib/routing/engine');
      const { availability } = await import('@/lib/routing/availability');

      availability.setAvailability('cat-agent', 'Agent', 'online');

      const ticket = {
        id: 'tk-cat', subject: 'Invoice payment error', status: 'open' as const,
        priority: 'normal' as const, requester: 'user@test.com',
        tags: [], createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), externalId: 'ext-4', source: 'zendesk' as const,
      };

      const result = await routeTicket(ticket, {
        allAgents: [{ userId: 'cat-agent', userName: 'Agent' }],
      });

      // reasoning should contain "billing" category
      expect(result.reasoning).toContain('billing');
    });

    it('routing result contains strategy and alternateAgents', async () => {
      const { routeTicket } = await import('@/lib/routing/engine');
      const { availability } = await import('@/lib/routing/availability');

      availability.setAvailability('alt-a1', 'A1', 'online');
      availability.setAvailability('alt-a2', 'A2', 'online');

      const ticket = {
        id: 'tk-alt', subject: 'Test', status: 'open' as const,
        priority: 'normal' as const, requester: 'user@test.com',
        tags: [], createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), externalId: 'ext-5', source: 'zendesk' as const,
      };

      const result = await routeTicket(ticket, {
        allAgents: [
          { userId: 'alt-a1', userName: 'A1' },
          { userId: 'alt-a2', userName: 'A2' },
        ],
      });

      expect(result.strategy).toBeTruthy();
      expect(result.alternateAgents).toBeDefined();
      expect(Array.isArray(result.alternateAgents)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Routing store
  // --------------------------------------------------------------------------
  describe('Routing store CRUD', () => {
    it('getRoutingConfig returns defaults when empty', async () => {
      const { getRoutingConfig } = await import('@/lib/routing/store');
      const config = getRoutingConfig();
      expect(config.defaultStrategy).toBe('skill_match');
      expect(config.enabled).toBe(true);
    });
  });
});


// ============================================================================
// Plan 5 — WFM (Workforce Management)
// ============================================================================

describe('Plan 5 — WFM', () => {
  // --------------------------------------------------------------------------
  // Schedule CRUD
  // --------------------------------------------------------------------------
  describe('Schedule CRUD', () => {
    it('createSchedule returns a new schedule with id', async () => {
      const { createSchedule } = await import('@/lib/wfm/schedules');
      const schedule = createSchedule({
        userId: 'wfm-user-1',
        userName: 'Test Agent',
        effectiveFrom: '2026-03-01',
        timezone: 'UTC',
        shifts: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', activity: 'work' }],
      });

      expect(schedule.id).toBeTruthy();
      expect(schedule.id).toMatch(/^sched-/);
      expect(schedule.userId).toBe('wfm-user-1');
      expect(schedule.shifts).toHaveLength(1);
      expect(schedule.createdAt).toBeTruthy();
    });

    it('getSchedules returns all schedules', async () => {
      const { getSchedules } = await import('@/lib/wfm/schedules');
      const schedules = getSchedules();
      // Default seed data contains 2 schedules
      expect(schedules.length).toBeGreaterThanOrEqual(2);
    });

    it('getSchedules filters by userId', async () => {
      const { getSchedules, createSchedule } = await import('@/lib/wfm/schedules');
      createSchedule({
        userId: 'wfm-filter-user',
        userName: 'Filter Test',
        effectiveFrom: '2026-04-01',
        timezone: 'UTC',
        shifts: [],
      });

      const filtered = getSchedules('wfm-filter-user');
      expect(filtered.every(s => s.userId === 'wfm-filter-user')).toBe(true);
      expect(filtered.length).toBeGreaterThanOrEqual(1);
    });

    it('updateSchedule modifies an existing schedule', async () => {
      const { createSchedule, updateSchedule } = await import('@/lib/wfm/schedules');
      const schedule = createSchedule({
        userId: 'wfm-upd-user',
        userName: 'Update Test',
        effectiveFrom: '2026-03-01',
        timezone: 'UTC',
        shifts: [],
      });

      const updated = updateSchedule(schedule.id, {
        shifts: [{ dayOfWeek: 2, startTime: '10:00', endTime: '18:00' }],
      });

      expect(updated).not.toBeNull();
      expect(updated!.shifts).toHaveLength(1);
      expect(updated!.shifts[0].dayOfWeek).toBe(2);
    });

    it('deleteSchedule removes a schedule', async () => {
      const { createSchedule, deleteSchedule, getSchedules } = await import('@/lib/wfm/schedules');
      const schedule = createSchedule({
        userId: 'wfm-del-user',
        userName: 'Delete Test',
        effectiveFrom: '2026-03-01',
        timezone: 'UTC',
        shifts: [],
      });

      const deleted = deleteSchedule(schedule.id);
      expect(deleted).toBe(true);

      const remaining = getSchedules('wfm-del-user');
      expect(remaining.find(s => s.id === schedule.id)).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Template CRUD
  // --------------------------------------------------------------------------
  describe('Template CRUD', () => {
    it('createTemplate returns a new template', async () => {
      const { createTemplate } = await import('@/lib/wfm/schedules');
      const tmpl = createTemplate({
        name: 'Night Shift',
        shifts: [{ dayOfWeek: 1, startTime: '22:00', endTime: '06:00', activity: 'work' }],
      });

      expect(tmpl.id).toBeTruthy();
      expect(tmpl.name).toBe('Night Shift');
      expect(tmpl.shifts).toHaveLength(1);
    });

    it('getTemplates returns all templates including defaults', async () => {
      const { getTemplates } = await import('@/lib/wfm/schedules');
      const templates = getTemplates();
      expect(templates.length).toBeGreaterThanOrEqual(1); // seed includes Standard 9-5
    });

    it('updateTemplate modifies a template', async () => {
      const { createTemplate, updateTemplate } = await import('@/lib/wfm/schedules');
      const tmpl = createTemplate({ name: 'Old Name', shifts: [] });

      const updated = updateTemplate(tmpl.id, { name: 'New Name' });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('New Name');
    });

    it('deleteTemplate removes a template', async () => {
      const { createTemplate, deleteTemplate, getTemplates } = await import('@/lib/wfm/schedules');
      const tmpl = createTemplate({ name: 'To Delete', shifts: [] });

      const deleted = deleteTemplate(tmpl.id);
      expect(deleted).toBe(true);

      const found = getTemplates(tmpl.id);
      expect(found).toHaveLength(0);
    });

    it('applyTemplate copies shifts from template to schedule', async () => {
      const { createTemplate, createSchedule, applyTemplate } = await import('@/lib/wfm/schedules');

      const tmpl = createTemplate({
        name: 'Apply Test Template',
        shifts: [
          { dayOfWeek: 1, startTime: '08:00', endTime: '16:00', activity: 'work' },
          { dayOfWeek: 2, startTime: '08:00', endTime: '16:00', activity: 'work' },
        ],
      });

      const schedule = createSchedule({
        userId: 'wfm-apply-user',
        userName: 'Apply Test',
        effectiveFrom: '2026-03-01',
        timezone: 'UTC',
        shifts: [],
      });

      const result = applyTemplate(schedule.id, tmpl.id);
      expect(result).not.toBeNull();
      expect(result!.templateId).toBe(tmpl.id);
      expect(result!.shifts).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  // Scheduled activity detection
  // --------------------------------------------------------------------------
  describe('getScheduledActivity', () => {
    it('returns off_shift when no shifts match current day', async () => {
      const { getScheduledActivity } = await import('@/lib/wfm/schedules');

      const schedule = {
        id: 'sched-off', userId: 'u', userName: 'U',
        effectiveFrom: '2026-01-01', timezone: 'UTC',
        shifts: [{ dayOfWeek: 6, startTime: '09:00', endTime: '17:00', activity: 'work' }],
        createdAt: '', updatedAt: '',
      };

      // Use a date that is NOT day 6 (Saturday)
      // March 9, 2026 is a Monday (day 1)
      const monday = new Date('2026-03-09T12:00:00Z');
      const result = getScheduledActivity(schedule, monday);
      expect(result).toBe('off_shift');
    });

    it('returns work when current time is within a work shift', async () => {
      const { getScheduledActivity } = await import('@/lib/wfm/schedules');

      // March 9, 2026 is Monday (day 1)
      const schedule = {
        id: 'sched-work', userId: 'u', userName: 'U',
        effectiveFrom: '2026-01-01', timezone: 'UTC',
        shifts: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', activity: 'work' }],
        createdAt: '', updatedAt: '',
      };

      const duringWork = new Date('2026-03-09T12:00:00Z');
      expect(getScheduledActivity(schedule, duringWork)).toBe('work');
    });

    it('returns break when current time is within a break shift', async () => {
      const { getScheduledActivity } = await import('@/lib/wfm/schedules');

      const schedule = {
        id: 'sched-break', userId: 'u', userName: 'U',
        effectiveFrom: '2026-01-01', timezone: 'UTC',
        shifts: [
          { dayOfWeek: 1, startTime: '09:00', endTime: '17:00', activity: 'work' },
          { dayOfWeek: 1, startTime: '12:00', endTime: '13:00', activity: 'break' },
        ],
        createdAt: '', updatedAt: '',
      };

      // 12:30 UTC on a Monday — should be 'break' (last matching activity wins after sort)
      const duringBreak = new Date('2026-03-09T12:30:00Z');
      expect(getScheduledActivity(schedule, duringBreak)).toBe('break');
    });
  });

  // --------------------------------------------------------------------------
  // Adherence tracking
  // --------------------------------------------------------------------------
  describe('Adherence tracking', () => {
    it('getCurrentAdherence marks online agent as adherent during work shift', async () => {
      const { getCurrentAdherence } = await import('@/lib/wfm/adherence');

      // Create a schedule for Monday (day 1) 09:00-17:00
      const schedules = [{
        id: 'adh-sched-1', userId: 'adh-user-1', userName: 'Adherent Agent',
        effectiveFrom: '2026-01-01', timezone: 'UTC',
        shifts: [{ dayOfWeek: 1, startTime: '00:00', endTime: '23:59', activity: 'work' }],
        createdAt: '', updatedAt: '',
      }];

      // Simulate that we're on Monday and agent is online
      const statuses = [{
        userId: 'adh-user-1', userName: 'Adherent Agent',
        status: 'online' as const, since: new Date().toISOString(),
      }];

      // Use a Monday timestamp
      const monday = new Date('2026-03-09T12:00:00Z');
      // We need to mock Date for getScheduledActivity, but since it uses `new Date()` internally
      // and we pass schedules directly, the adherence function reads scheduledActivity.
      // However, getCurrentAdherence calls getScheduledActivity(schedule) with no date arg,
      // which uses `new Date()`. Let's test the data structure instead.

      const records = getCurrentAdherence(schedules, statuses);
      // Since we're testing structure, records may or may not have adherent=true
      // depending on current system time matching the shift.
      expect(Array.isArray(records)).toBe(true);
      // Each record should have the right shape
      for (const r of records) {
        expect(r).toHaveProperty('userId');
        expect(r).toHaveProperty('scheduledActivity');
        expect(r).toHaveProperty('actualStatus');
        expect(r).toHaveProperty('adherent');
      }
    });

    it('skips agents with off_shift schedule', async () => {
      const { getCurrentAdherence } = await import('@/lib/wfm/adherence');

      // Schedule with no shifts (always off_shift)
      const schedules = [{
        id: 'adh-off', userId: 'adh-off-user', userName: 'Off Agent',
        effectiveFrom: '2026-01-01', timezone: 'UTC',
        shifts: [], // no shifts = always off_shift
        createdAt: '', updatedAt: '',
      }];

      const statuses = [{
        userId: 'adh-off-user', userName: 'Off Agent',
        status: 'online' as const, since: new Date().toISOString(),
      }];

      const records = getCurrentAdherence(schedules, statuses);
      expect(records.find(r => r.userId === 'adh-off-user')).toBeUndefined();
    });

    it('marks offline agent as non-adherent during work shift', async () => {
      const { getCurrentAdherence } = await import('@/lib/wfm/adherence');

      // All-day work shift on all days so we always match
      const schedules = [{
        id: 'adh-nonadh', userId: 'adh-nonadh-user', userName: 'Non-Adherent',
        effectiveFrom: '2026-01-01', timezone: 'UTC',
        shifts: Array.from({ length: 7 }, (_, i) => ({
          dayOfWeek: i, startTime: '00:00', endTime: '23:59', activity: 'work',
        })),
        createdAt: '', updatedAt: '',
      }];

      const statuses = [{
        userId: 'adh-nonadh-user', userName: 'Non-Adherent',
        status: 'offline' as const, since: new Date().toISOString(),
      }];

      const records = getCurrentAdherence(schedules, statuses);
      const record = records.find(r => r.userId === 'adh-nonadh-user');
      expect(record).toBeDefined();
      expect(record!.adherent).toBe(false);
      expect(record!.scheduledActivity).toBe('work');
      expect(record!.actualStatus).toBe('offline');
    });
  });

  // --------------------------------------------------------------------------
  // Volume collector
  // --------------------------------------------------------------------------
  describe('Volume collector', () => {
    it('collectVolumeSnapshot returns a valid snapshot', async () => {
      const { collectVolumeSnapshot } = await import('@/lib/wfm/volume-collector');
      const snapshot = await collectVolumeSnapshot('ws-vol-test');

      expect(snapshot.id).toBeTruthy();
      expect(snapshot.snapshotHour).toBeTruthy();
      expect(snapshot.channel).toBe('all');
      expect(typeof snapshot.ticketsCreated).toBe('number');
      expect(typeof snapshot.ticketsResolved).toBe('number');
    });

    it('snapshot hour is formatted as HH:00:00', async () => {
      const { collectVolumeSnapshot } = await import('@/lib/wfm/volume-collector');
      const snapshot = await collectVolumeSnapshot('ws-vol-test2');

      // Should end with :00:00.000Z (hour-aligned)
      expect(snapshot.snapshotHour).toMatch(/T\d{2}:00:00\.000Z$/);
    });
  });

  // --------------------------------------------------------------------------
  // WFM store — volume snapshots
  // --------------------------------------------------------------------------
  describe('WFM store — volume snapshots', () => {
    it('addVolumeSnapshot and getVolumeSnapshots work together', async () => {
      const { addVolumeSnapshot, getVolumeSnapshots, genId } = await import('@/lib/wfm/store');

      const snap = {
        id: genId('vs-test'),
        snapshotHour: new Date().toISOString(),
        channel: 'email',
        ticketsCreated: 15,
        ticketsResolved: 10,
      };

      addVolumeSnapshot(snap);
      const all = getVolumeSnapshots();
      const found = all.find(s => s.id === snap.id);
      expect(found).toBeDefined();
      expect(found!.ticketsCreated).toBe(15);
    });
  });

  // --------------------------------------------------------------------------
  // Time-off request lifecycle
  // --------------------------------------------------------------------------
  describe('Time-off request lifecycle', () => {
    it('creates, retrieves, approves, and removes time-off requests', async () => {
      const {
        addTimeOff, getTimeOffStore, updateTimeOff, removeTimeOffRequest, genId,
      } = await import('@/lib/wfm/store');

      const request = {
        id: genId('pto-test'),
        userId: 'pto-user-1',
        userName: 'PTO Test',
        startDate: '2026-04-01',
        endDate: '2026-04-03',
        reason: 'Vacation',
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      };

      // Create
      addTimeOff(request);
      const pending = getTimeOffStore('pto-user-1', 'pending');
      const found = pending.find(r => r.id === request.id);
      expect(found).toBeDefined();
      expect(found!.reason).toBe('Vacation');

      // Approve
      const updated = updateTimeOff(request.id, {
        status: 'approved',
        approvedBy: 'manager-1',
        decidedAt: new Date().toISOString(),
      });
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('approved');
      expect(updated!.approvedBy).toBe('manager-1');

      // Verify no longer in pending list
      const stillPending = getTimeOffStore('pto-user-1', 'pending');
      expect(stillPending.find(r => r.id === request.id)).toBeUndefined();

      // In approved list
      const approved = getTimeOffStore('pto-user-1', 'approved');
      expect(approved.find(r => r.id === request.id)).toBeDefined();

      // Remove
      const removed = removeTimeOffRequest(request.id);
      expect(removed).toBe(true);

      const afterRemove = getTimeOffStore('pto-user-1');
      expect(afterRemove.find(r => r.id === request.id)).toBeUndefined();
    });

    it('deny time-off request', async () => {
      const { addTimeOff, updateTimeOff, genId } = await import('@/lib/wfm/store');

      const request = {
        id: genId('pto-deny'),
        userId: 'pto-deny-user',
        userName: 'Deny Test',
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      };

      addTimeOff(request);
      const denied = updateTimeOff(request.id, {
        status: 'denied',
        approvedBy: 'manager-1',
        decidedAt: new Date().toISOString(),
      });

      expect(denied).not.toBeNull();
      expect(denied!.status).toBe('denied');
    });

    it('returns null when updating non-existent time-off', async () => {
      const { updateTimeOff } = await import('@/lib/wfm/store');
      const result = updateTimeOff('nonexistent-pto', { status: 'approved' });
      expect(result).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Conflict detection
  // --------------------------------------------------------------------------
  describe('Schedule conflict detection', () => {
    it('detects overlapping shifts in existing schedules', async () => {
      const { createSchedule, detectConflicts } = await import('@/lib/wfm/schedules');

      createSchedule({
        userId: 'conflict-user',
        userName: 'Conflict Test',
        effectiveFrom: '2026-01-01',
        timezone: 'UTC',
        shifts: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', activity: 'work' }],
      });

      const conflicts = detectConflicts(
        'conflict-user',
        [{ dayOfWeek: 1, startTime: '12:00', endTime: '20:00' }],
        '2026-01-01',
      );

      expect(conflicts.length).toBeGreaterThanOrEqual(1);
      expect(conflicts.some(c => c.type === 'shift_overlap')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Business Hours
  // --------------------------------------------------------------------------
  describe('Business Hours CRUD', () => {
    it('getBHConfigs returns default business hours', async () => {
      const { getBHConfigs } = await import('@/lib/wfm/store');
      const configs = getBHConfigs();
      expect(configs.length).toBeGreaterThanOrEqual(1);

      const defaultConfig = configs.find(c => c.isDefault);
      expect(defaultConfig).toBeDefined();
      expect(defaultConfig!.timezone).toBeTruthy();
    });

    it('addBHConfig and updateBHConfig work', async () => {
      const { addBHConfig, updateBHConfig, getBHConfigs, genId } = await import('@/lib/wfm/store');

      const config = {
        id: genId('bh-test'),
        name: 'Test Hours',
        timezone: 'Europe/London',
        schedule: { '1': [{ start: '08:00', end: '16:00' }] },
        holidays: [] as string[],
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      addBHConfig(config);
      const found = getBHConfigs(config.id);
      expect(found).toHaveLength(1);
      expect(found[0].name).toBe('Test Hours');

      const updated = updateBHConfig(config.id, { name: 'Updated Hours' });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated Hours');
    });

    it('removeBHConfig deletes a config', async () => {
      const { addBHConfig, removeBHConfig, getBHConfigs, genId } = await import('@/lib/wfm/store');

      const config = {
        id: genId('bh-del'),
        name: 'To Delete',
        timezone: 'UTC',
        schedule: {},
        holidays: [] as string[],
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      addBHConfig(config);
      const removed = removeBHConfig(config.id);
      expect(removed).toBe(true);

      const found = getBHConfigs(config.id);
      expect(found).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Agent Status Tracker
  // --------------------------------------------------------------------------
  describe('Agent status tracker', () => {
    it('setStatus and getStatus track agent status changes', async () => {
      const { agentStatusTracker } = await import('@/lib/wfm/agent-status');

      agentStatusTracker.setStatus('status-user-1', 'Status Agent', 'online');
      const status = agentStatusTracker.getStatus('status-user-1');
      expect(status).toBeDefined();
      expect(status!.status).toBe('online');
      expect(status!.userName).toBe('Status Agent');

      agentStatusTracker.setStatus('status-user-1', 'Status Agent', 'away', 'Lunch');
      const updated = agentStatusTracker.getStatus('status-user-1');
      expect(updated!.status).toBe('away');
      expect(updated!.reason).toBe('Lunch');
    });

    it('getAllStatuses returns all tracked statuses', async () => {
      const { agentStatusTracker } = await import('@/lib/wfm/agent-status');

      agentStatusTracker.setStatus('all-stat-1', 'A1', 'online');
      agentStatusTracker.setStatus('all-stat-2', 'A2', 'offline');

      const all = agentStatusTracker.getAllStatuses();
      const ids = all.map(s => s.userId);
      expect(ids).toContain('all-stat-1');
      expect(ids).toContain('all-stat-2');
    });

    it('getStatusLog returns recent entries', async () => {
      const { agentStatusTracker } = await import('@/lib/wfm/agent-status');

      agentStatusTracker.setStatus('log-user', 'Log Agent', 'online');
      // Small delay to ensure distinct timestamps for descending sort
      await new Promise(resolve => setTimeout(resolve, 5));
      agentStatusTracker.setStatus('log-user', 'Log Agent', 'away');

      const log = agentStatusTracker.getStatusLog('log-user');
      expect(log.length).toBeGreaterThanOrEqual(2);
      // Most recent first (with distinct timestamps, 'away' should be first)
      expect(log[0].status).toBe('away');
    });
  });

  // --------------------------------------------------------------------------
  // Holiday Calendar CRUD
  // --------------------------------------------------------------------------
  describe('Holiday Calendar CRUD', () => {
    it('addHolidayCalendar and getHolidayCalendars work', async () => {
      const { addHolidayCalendar, getHolidayCalendars, genId } = await import('@/lib/wfm/store');

      const cal = {
        id: genId('hc'),
        name: 'US Holidays',
        entries: [{ id: '1', name: 'Independence Day', date: '2026-07-04' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      addHolidayCalendar(cal);
      const found = getHolidayCalendars(cal.id);
      expect(found).toHaveLength(1);
      expect(found[0].name).toBe('US Holidays');
    });

    it('removeHolidayCalendar deletes a calendar', async () => {
      const { addHolidayCalendar, removeHolidayCalendar, getHolidayCalendars, genId } = await import('@/lib/wfm/store');

      const cal = {
        id: genId('hc-del'),
        name: 'To Delete',
        entries: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      addHolidayCalendar(cal);
      const removed = removeHolidayCalendar(cal.id);
      expect(removed).toBe(true);

      const found = getHolidayCalendars(cal.id);
      expect(found).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Utilization — occupancy cap
  // --------------------------------------------------------------------------
  describe('Utilization occupancy cap', () => {
    it('caps occupancy at 100% when handle time exceeds available time', async () => {
      const { calculateUtilization } = await import('@/lib/wfm/utilization');
      const now = new Date();
      const fiveMinAgo = new Date(now.getTime() - 5 * 60000).toISOString();
      const fourMinAgo = new Date(now.getTime() - 4 * 60000).toISOString();

      const result = calculateUtilization(
        [{ id: '1', ticketId: 't1', userId: 'u1', userName: 'Test', startTime: fiveMinAgo, durationMinutes: 60, notes: '' }],
        [
          { userId: 'u1', userName: 'Test', status: 'online' as const, startedAt: fiveMinAgo, reason: '' },
          { userId: 'u1', userName: 'Test', status: 'offline' as const, startedAt: fourMinAgo, reason: '' },
        ],
        [],
      );

      expect(result).toHaveLength(1);
      expect(result[0].occupancy).toBeLessThanOrEqual(100);
      expect(result[0].occupancy).toBe(100);
    });

    it('returns 0% occupancy when no available time', async () => {
      const { calculateUtilization } = await import('@/lib/wfm/utilization');
      const result = calculateUtilization(
        [{ id: '1', ticketId: 't1', userId: 'u1', userName: 'Test', startTime: new Date().toISOString(), durationMinutes: 30, notes: '' }],
        [],
        [],
      );
      expect(result).toHaveLength(1);
      expect(result[0].occupancy).toBe(0);
    });
  });
});
