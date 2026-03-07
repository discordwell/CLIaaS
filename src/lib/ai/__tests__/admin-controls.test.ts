import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'fs';

const TEST_DIR = '/tmp/cliaas-test-admin-controls-' + process.pid;

describe('AI admin controls', () => {
  beforeEach(() => {
    process.env.CLIAAS_DATA_DIR = TEST_DIR;
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    // Reset all relevant globals
    delete (global as Record<string, unknown>).__cliaasAIChannelPolicies;
    delete (global as Record<string, unknown>).__cliaasAICircuitBreaker;
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    delete process.env.CLIAAS_DATA_DIR;
    delete (global as Record<string, unknown>).__cliaasAIChannelPolicies;
    delete (global as Record<string, unknown>).__cliaasAICircuitBreaker;
  });

  // ---- Channel Policy ----

  describe('channel policy', () => {
    it('getChannelPolicies returns empty array initially', async () => {
      const { getChannelPolicies } = await import('../admin-controls');
      expect(getChannelPolicies()).toEqual([]);
    });

    it('setChannelPolicy adds a new policy', async () => {
      const { setChannelPolicy, getChannelPolicies } = await import('../admin-controls');
      const policy = {
        channel: 'email',
        enabled: true,
        mode: 'suggest' as const,
        maxAutoResolvesPerHour: 50,
        confidenceThreshold: 0.8,
        excludedTopics: ['billing'],
      };
      const result = setChannelPolicy(policy);
      expect(result).toEqual(policy);
      expect(getChannelPolicies()).toHaveLength(1);
      expect(getChannelPolicies()[0].channel).toBe('email');
    });

    it('setChannelPolicy updates existing policy for same channel', async () => {
      const { setChannelPolicy, getChannelPolicies } = await import('../admin-controls');
      setChannelPolicy({
        channel: 'chat',
        enabled: true,
        mode: 'suggest' as const,
        maxAutoResolvesPerHour: 10,
        confidenceThreshold: 0.7,
        excludedTopics: [],
      });
      setChannelPolicy({
        channel: 'chat',
        enabled: false,
        mode: 'auto' as const,
        maxAutoResolvesPerHour: 100,
        confidenceThreshold: 0.9,
        excludedTopics: ['returns'],
      });
      const policies = getChannelPolicies();
      expect(policies).toHaveLength(1);
      expect(policies[0].enabled).toBe(false);
      expect(policies[0].mode).toBe('auto');
    });

    it('getChannelPolicy returns specific channel policy', async () => {
      const { setChannelPolicy, getChannelPolicy } = await import('../admin-controls');
      setChannelPolicy({
        channel: 'voice',
        enabled: true,
        mode: 'approve' as const,
        maxAutoResolvesPerHour: 5,
        confidenceThreshold: 0.95,
        excludedTopics: [],
      });
      const result = getChannelPolicy('voice');
      expect(result).toBeDefined();
      expect(result!.channel).toBe('voice');
      expect(result!.mode).toBe('approve');
    });

    it('getChannelPolicy falls back to wildcard policy', async () => {
      const { setChannelPolicy, getChannelPolicy } = await import('../admin-controls');
      setChannelPolicy({
        channel: '*',
        enabled: true,
        mode: 'suggest' as const,
        maxAutoResolvesPerHour: 100,
        confidenceThreshold: 0.7,
        excludedTopics: [],
      });
      // Query for a channel that has no specific policy
      const result = getChannelPolicy('social');
      expect(result).toBeDefined();
      expect(result!.channel).toBe('*');
    });

    it('getChannelPolicy returns undefined when no policy exists', async () => {
      const { getChannelPolicy } = await import('../admin-controls');
      expect(getChannelPolicy('nonexistent')).toBeUndefined();
    });

    it('isChannelAllowed returns true when no policy exists (fail open)', async () => {
      const { isChannelAllowed } = await import('../admin-controls');
      expect(isChannelAllowed('email')).toBe(true);
    });

    it('isChannelAllowed returns policy enabled state', async () => {
      const { setChannelPolicy, isChannelAllowed } = await import('../admin-controls');
      setChannelPolicy({
        channel: 'email',
        enabled: false,
        mode: 'suggest' as const,
        maxAutoResolvesPerHour: 0,
        confidenceThreshold: 1,
        excludedTopics: [],
      });
      expect(isChannelAllowed('email')).toBe(false);
    });
  });

  // ---- Circuit Breaker ----

  describe('circuit breaker', () => {
    it('shouldAllowAIRequest returns true when closed (default)', async () => {
      const { shouldAllowAIRequest } = await import('../admin-controls');
      expect(shouldAllowAIRequest()).toBe(true);
    });

    it('shouldAllowAIRequest returns false when open', async () => {
      const { recordAIFailure, shouldAllowAIRequest } = await import('../admin-controls');
      // Trigger 5 failures to open the breaker
      for (let i = 0; i < 5; i++) {
        recordAIFailure('test error');
      }
      expect(shouldAllowAIRequest()).toBe(false);
    });

    it('recordAIFailure opens circuit after 5 failures', async () => {
      const { recordAIFailure, getCircuitBreakerStatus } = await import('../admin-controls');
      for (let i = 0; i < 4; i++) {
        recordAIFailure('error');
      }
      expect(getCircuitBreakerStatus().state).toBe('closed');
      recordAIFailure('error');
      expect(getCircuitBreakerStatus().state).toBe('open');
      expect(getCircuitBreakerStatus().failureCount).toBe(5);
    });

    it('recordAISuccess decrements failure count in closed state', async () => {
      const { recordAIFailure, recordAISuccess, getCircuitBreakerStatus } = await import('../admin-controls');
      recordAIFailure('err');
      recordAIFailure('err');
      expect(getCircuitBreakerStatus().failureCount).toBe(2);
      recordAISuccess();
      expect(getCircuitBreakerStatus().failureCount).toBe(1);
    });

    it('recordAISuccess does not go below 0 failures', async () => {
      const { recordAISuccess, getCircuitBreakerStatus } = await import('../admin-controls');
      recordAISuccess();
      recordAISuccess();
      expect(getCircuitBreakerStatus().failureCount).toBe(0);
    });

    it('resetCircuitBreaker returns to closed state', async () => {
      const { recordAIFailure, resetCircuitBreaker, getCircuitBreakerStatus } = await import('../admin-controls');
      for (let i = 0; i < 5; i++) recordAIFailure('err');
      expect(getCircuitBreakerStatus().state).toBe('open');
      resetCircuitBreaker();
      const status = getCircuitBreakerStatus();
      expect(status.state).toBe('closed');
      expect(status.failureCount).toBe(0);
      expect(status.halfOpenAttempts).toBe(0);
    });

    it('getCircuitBreakerStatus returns initial closed state', async () => {
      const { getCircuitBreakerStatus } = await import('../admin-controls');
      const status = getCircuitBreakerStatus();
      expect(status.state).toBe('closed');
      expect(status.failureCount).toBe(0);
      expect(status.halfOpenAttempts).toBe(0);
    });

    it('records lastFailureAt timestamp on failure', async () => {
      const { recordAIFailure, getCircuitBreakerStatus } = await import('../admin-controls');
      recordAIFailure('timeout');
      const status = getCircuitBreakerStatus();
      expect(status.lastFailureAt).toBeDefined();
      expect(new Date(status.lastFailureAt!).getTime()).toBeGreaterThan(0);
    });

    it('records lastSuccessAt timestamp on success', async () => {
      const { recordAISuccess, getCircuitBreakerStatus } = await import('../admin-controls');
      recordAISuccess();
      const status = getCircuitBreakerStatus();
      expect(status.lastSuccessAt).toBeDefined();
      expect(new Date(status.lastSuccessAt!).getTime()).toBeGreaterThan(0);
    });
  });

  // ---- Audit Trail ----

  describe('audit trail', () => {
    it('recordAuditEntry creates an entry with id and timestamp', async () => {
      const { recordAuditEntry } = await import('../admin-controls');
      const entry = recordAuditEntry({
        workspaceId: 'ws-1',
        action: 'resolution_created' as const,
        ticketId: 'tk-1',
        details: { confidence: 0.95 },
      });
      expect(entry.id).toBeTruthy();
      expect(entry.timestamp).toBeTruthy();
      expect(entry.workspaceId).toBe('ws-1');
      expect(entry.action).toBe('resolution_created');
      expect(entry.ticketId).toBe('tk-1');
    });

    it('getAuditTrail returns recorded entries', async () => {
      const { recordAuditEntry, getAuditTrail } = await import('../admin-controls');
      recordAuditEntry({ workspaceId: 'ws-1', action: 'resolution_created' as const, details: {} });
      recordAuditEntry({ workspaceId: 'ws-1', action: 'resolution_approved' as const, details: {} });
      const result = getAuditTrail();
      expect(result.total).toBe(2);
      expect(result.entries).toHaveLength(2);
    });

    it('getAuditTrail filters by workspaceId', async () => {
      const { recordAuditEntry, getAuditTrail } = await import('../admin-controls');
      recordAuditEntry({ workspaceId: 'ws-1', action: 'resolution_created' as const, details: {} });
      recordAuditEntry({ workspaceId: 'ws-2', action: 'resolution_created' as const, details: {} });
      recordAuditEntry({ workspaceId: 'ws-1', action: 'config_changed' as const, details: {} });
      const result = getAuditTrail({ workspaceId: 'ws-1' });
      expect(result.total).toBe(2);
      expect(result.entries.every((e: { workspaceId: string }) => e.workspaceId === 'ws-1')).toBe(true);
    });

    it('getAuditTrail filters by action', async () => {
      const { recordAuditEntry, getAuditTrail } = await import('../admin-controls');
      recordAuditEntry({ workspaceId: 'ws-1', action: 'resolution_created' as const, details: {} });
      recordAuditEntry({ workspaceId: 'ws-1', action: 'resolution_approved' as const, details: {} });
      recordAuditEntry({ workspaceId: 'ws-1', action: 'resolution_created' as const, details: {} });
      const result = getAuditTrail({ action: 'resolution_created' });
      expect(result.total).toBe(2);
    });

    it('getAuditTrail filters by ticketId', async () => {
      const { recordAuditEntry, getAuditTrail } = await import('../admin-controls');
      recordAuditEntry({ workspaceId: 'ws-1', action: 'resolution_created' as const, ticketId: 'tk-1', details: {} });
      recordAuditEntry({ workspaceId: 'ws-1', action: 'resolution_created' as const, ticketId: 'tk-2', details: {} });
      const result = getAuditTrail({ ticketId: 'tk-1' });
      expect(result.total).toBe(1);
      expect(result.entries[0].ticketId).toBe('tk-1');
    });

    it('getAuditTrail supports pagination (limit and offset)', async () => {
      const { recordAuditEntry, getAuditTrail } = await import('../admin-controls');
      for (let i = 0; i < 10; i++) {
        recordAuditEntry({ workspaceId: 'ws-1', action: 'resolution_created' as const, details: { i } });
      }
      const page1 = getAuditTrail({ limit: 3, offset: 0 });
      expect(page1.total).toBe(10);
      expect(page1.entries).toHaveLength(3);

      const page2 = getAuditTrail({ limit: 3, offset: 3 });
      expect(page2.total).toBe(10);
      expect(page2.entries).toHaveLength(3);

      const lastPage = getAuditTrail({ limit: 3, offset: 9 });
      expect(lastPage.total).toBe(10);
      expect(lastPage.entries).toHaveLength(1);
    });
  });

  // ---- Usage Reporting ----

  describe('usage reporting', () => {
    const baseSnapshot = {
      workspaceId: 'ws-1',
      period: '2026-03-06T00:00:00Z',
      totalRequests: 100,
      autoResolved: 80,
      escalated: 15,
      errors: 5,
      totalTokens: 50000,
      promptTokens: 30000,
      completionTokens: 20000,
      totalCostCents: 250,
      avgLatencyMs: 200,
      avgConfidence: 0.85,
    };

    it('recordUsageSnapshot stores a snapshot', async () => {
      const { recordUsageSnapshot, getUsageReport } = await import('../admin-controls');
      recordUsageSnapshot(baseSnapshot);
      const report = getUsageReport('ws-1');
      expect(report).toHaveLength(1);
      expect(report[0].totalRequests).toBe(100);
    });

    it('recordUsageSnapshot merges snapshots for same workspace+period', async () => {
      const { recordUsageSnapshot, getUsageReport } = await import('../admin-controls');
      recordUsageSnapshot(baseSnapshot);
      recordUsageSnapshot({
        ...baseSnapshot,
        totalRequests: 50,
        autoResolved: 40,
        escalated: 8,
        errors: 2,
        totalTokens: 25000,
        promptTokens: 15000,
        completionTokens: 10000,
        totalCostCents: 125,
        avgLatencyMs: 300,
        avgConfidence: 0.9,
      });
      const report = getUsageReport('ws-1');
      expect(report).toHaveLength(1);
      // Merged values
      expect(report[0].totalRequests).toBe(150); // 100 + 50
      expect(report[0].autoResolved).toBe(120);  // 80 + 40
      expect(report[0].escalated).toBe(23);       // 15 + 8
      expect(report[0].errors).toBe(7);           // 5 + 2
      expect(report[0].totalTokens).toBe(75000);  // 50000 + 25000
      expect(report[0].promptTokens).toBe(45000);
      expect(report[0].completionTokens).toBe(30000);
      expect(report[0].totalCostCents).toBe(375);
      // avgLatencyMs = Math.round((200 + 300) / 2) = 250
      expect(report[0].avgLatencyMs).toBe(250);
      // avgConfidence = Math.round(((0.85 + 0.9) / 2) * 100) / 100 = 0.88
      expect(report[0].avgConfidence).toBe(0.88);
    });

    it('recordUsageSnapshot creates separate entries for different periods', async () => {
      const { recordUsageSnapshot, getUsageReport } = await import('../admin-controls');
      recordUsageSnapshot(baseSnapshot);
      recordUsageSnapshot({
        ...baseSnapshot,
        period: '2026-03-06T01:00:00Z',
      });
      const report = getUsageReport('ws-1');
      expect(report).toHaveLength(2);
    });

    it('getUsageReport filters by workspaceId', async () => {
      const { recordUsageSnapshot, getUsageReport } = await import('../admin-controls');
      recordUsageSnapshot(baseSnapshot);
      recordUsageSnapshot({ ...baseSnapshot, workspaceId: 'ws-2' });
      expect(getUsageReport('ws-1')).toHaveLength(1);
      expect(getUsageReport('ws-2')).toHaveLength(1);
      expect(getUsageReport('ws-3')).toHaveLength(0);
    });

    it('getUsageReport filters by from/to date range', async () => {
      const { recordUsageSnapshot, getUsageReport } = await import('../admin-controls');
      recordUsageSnapshot({ ...baseSnapshot, period: '2026-03-01T00:00:00Z' });
      recordUsageSnapshot({ ...baseSnapshot, period: '2026-03-03T00:00:00Z' });
      recordUsageSnapshot({ ...baseSnapshot, period: '2026-03-06T00:00:00Z' });
      const report = getUsageReport('ws-1', {
        from: '2026-03-02T00:00:00Z',
        to: '2026-03-05T00:00:00Z',
      });
      expect(report).toHaveLength(1);
      expect(report[0].period).toBe('2026-03-03T00:00:00Z');
    });

    it('getUsageSummary returns zero summary when no data', async () => {
      const { getUsageSummary } = await import('../admin-controls');
      const summary = getUsageSummary('ws-nonexistent');
      expect(summary.totalRequests).toBe(0);
      expect(summary.autoResolved).toBe(0);
      expect(summary.resolutionRate).toBe(0);
      expect(summary.avgLatencyMs).toBe(0);
      expect(summary.avgConfidence).toBe(0);
    });

    it('getUsageSummary aggregates across snapshots', async () => {
      const { recordUsageSnapshot, getUsageSummary } = await import('../admin-controls');
      recordUsageSnapshot({
        ...baseSnapshot,
        period: '2026-03-06T00:00:00Z',
        totalRequests: 100,
        autoResolved: 80,
        escalated: 15,
        errors: 5,
      });
      recordUsageSnapshot({
        ...baseSnapshot,
        period: '2026-03-06T01:00:00Z',
        totalRequests: 200,
        autoResolved: 150,
        escalated: 40,
        errors: 10,
      });
      const summary = getUsageSummary('ws-1');
      expect(summary.totalRequests).toBe(300);
      expect(summary.autoResolved).toBe(230);
      expect(summary.escalated).toBe(55);
      expect(summary.errors).toBe(15);
      // resolutionRate = Math.round((230/300)*100) = 77
      expect(summary.resolutionRate).toBe(77);
    });
  });
});
