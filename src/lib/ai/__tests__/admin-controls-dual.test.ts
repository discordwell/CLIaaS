/**
 * Tests for AI admin controls dual-mode (DB + JSONL fallback).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock store-helpers to simulate DB unavailable (JSONL fallback)
vi.mock('@/lib/store-helpers', () => ({
  withRls: vi.fn().mockResolvedValue(null),
  tryDb: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/jsonl-store', () => {
  const store: Record<string, unknown[]> = {};
  return {
    readJsonlFile: vi.fn((file: string) => store[file] ?? []),
    writeJsonlFile: vi.fn((file: string, data: unknown[]) => { store[file] = data; }),
    __store: store,
  };
});

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

describe('AI admin controls — JSONL fallback path', () => {
  beforeEach(() => {
    // Reset globals
    global.__cliaasAIChannelPolicies = undefined;
    global.__cliaasAICircuitBreaker = undefined;
  });

  it('getChannelPoliciesAsync falls back to JSONL when DB unavailable', async () => {
    const { getChannelPoliciesAsync } = await import('../admin-controls');
    const result = await getChannelPoliciesAsync('ws-123');
    expect(Array.isArray(result)).toBe(true);
  });

  it('setChannelPolicyAsync falls back to JSONL sync version', async () => {
    const { setChannelPolicyAsync, getChannelPolicies } = await import('../admin-controls');
    const policy = {
      channel: 'email',
      enabled: true,
      mode: 'auto' as const,
      maxAutoResolvesPerHour: 100,
      confidenceThreshold: 0.85,
      excludedTopics: ['billing'],
    };
    const result = await setChannelPolicyAsync(policy, 'ws-123');
    expect(result.channel).toBe('email');
    expect(result.mode).toBe('auto');

    const all = getChannelPolicies();
    expect(all.find(p => p.channel === 'email')).toBeDefined();
  });

  it('getCircuitBreakerStatusAsync falls back to sync version', async () => {
    const { getCircuitBreakerStatusAsync } = await import('../admin-controls');
    const status = await getCircuitBreakerStatusAsync('ws-123');
    expect(status.state).toBe('closed');
    expect(status.failureCount).toBe(0);
  });

  it('recordAISuccessAsync falls back to sync version', async () => {
    const { recordAISuccessAsync, getCircuitBreakerStatus } = await import('../admin-controls');
    await recordAISuccessAsync('ws-123');
    const status = getCircuitBreakerStatus();
    expect(status.state).toBe('closed');
  });

  it('recordAIFailureAsync falls back to sync version', async () => {
    const { recordAIFailureAsync, getCircuitBreakerStatus } = await import('../admin-controls');
    // Record multiple failures to test circuit breaker
    for (let i = 0; i < 5; i++) {
      await recordAIFailureAsync('test error', 'ws-123');
    }
    const status = getCircuitBreakerStatus();
    expect(status.state).toBe('open');
  });

  it('appendAuditEntryAsync falls back to JSONL', async () => {
    const { appendAuditEntryAsync, getAuditTrail } = await import('../admin-controls');
    const entry = await appendAuditEntryAsync({
      workspaceId: 'ws-123',
      action: 'resolution_created',
      ticketId: 'tkt-1',
      details: { model: 'test' },
    });
    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeTruthy();

    const trail = getAuditTrail({ workspaceId: 'ws-123' });
    expect(trail.total).toBeGreaterThanOrEqual(1);
  });

  it('getAuditTrailAsync falls back to JSONL', async () => {
    const { getAuditTrailAsync } = await import('../admin-controls');
    const result = await getAuditTrailAsync({ workspaceId: 'ws-123', limit: 10 });
    expect(result).toHaveProperty('entries');
    expect(result).toHaveProperty('total');
  });

  it('getUsageReportAsync falls back to JSONL', async () => {
    const { getUsageReportAsync } = await import('../admin-controls');
    const report = await getUsageReportAsync('ws-123');
    expect(Array.isArray(report)).toBe(true);
  });
});
