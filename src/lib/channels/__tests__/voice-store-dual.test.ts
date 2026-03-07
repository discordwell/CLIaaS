/**
 * Tests for voice-store dual-mode (DB + JSONL fallback).
 * Mocks withRls to return null, verifying all async functions
 * fall back to their sync JSONL counterparts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/store-helpers', () => ({
  withRls: vi.fn().mockResolvedValue(null),
  tryDb: vi.fn().mockResolvedValue(null),
}));

let mockJsonlStore: Record<string, unknown[]> = {};

vi.mock('@/lib/jsonl-store', () => {
  return {
    readJsonlFile: vi.fn((file: string) => mockJsonlStore[file] ?? []),
    writeJsonlFile: vi.fn((file: string, data: unknown[]) => { mockJsonlStore[file] = data; }),
  };
});

describe('voice-store — JSONL fallback path', () => {
  beforeEach(() => {
    mockJsonlStore = {};
    global.__cliaasVoiceCalls = undefined;
    global.__cliaasVoiceCallsLoaded = undefined;
    global.__cliaasVoiceAgents = undefined;
    global.__cliaasVoiceAgentsLoaded = undefined;
  });

  // ---- Call operations ----

  it('createCallAsync falls back to JSONL sync version', async () => {
    const { createCallAsync, getAllCalls } = await import('../voice-store');
    const call = await createCallAsync('CA-DUAL-1', 'inbound', '+15551111111', '+15552222222', 'ws-abc');
    expect(call.id).toBeTruthy();
    expect(call.callSid).toBe('CA-DUAL-1');
    expect(call.status).toBe('ringing');
    expect(call.direction).toBe('inbound');

    const all = getAllCalls('ws-abc');
    expect(all.find(c => c.callSid === 'CA-DUAL-1')).toBeDefined();
  });

  it('getCallAsync falls back to JSONL sync version', async () => {
    const { createCallAsync, getCallAsync } = await import('../voice-store');
    const call = await createCallAsync('CA-DUAL-GET', 'outbound', '+15553333333', '+15554444444', 'ws-abc');

    const found = await getCallAsync(call.id, 'ws-abc');
    expect(found).toBeDefined();
    expect(found?.callSid).toBe('CA-DUAL-GET');
  });

  it('getAllCallsAsync falls back to JSONL sync version', async () => {
    const { createCallAsync, getAllCallsAsync } = await import('../voice-store');
    await createCallAsync('CA-ALL-1', 'inbound', '+1111', '+2222', 'ws-abc');
    await createCallAsync('CA-ALL-2', 'outbound', '+3333', '+4444', 'ws-abc');

    const all = await getAllCallsAsync('ws-abc');
    expect(all.length).toBe(2);
    const sids = all.map(c => c.callSid);
    expect(sids).toContain('CA-ALL-1');
    expect(sids).toContain('CA-ALL-2');
  });

  it('updateCallAsync falls back to JSONL sync version', async () => {
    const { createCallAsync, updateCallAsync, getCallAsync } = await import('../voice-store');
    const call = await createCallAsync('CA-UPD', 'inbound', '+1111', '+2222', 'ws-abc');

    const updated = await updateCallAsync(call.id, {
      status: 'completed',
      duration: 300,
      recordingUrl: 'https://example.com/rec.mp3',
    }, 'ws-abc');

    expect(updated).not.toBeNull();
    expect(updated?.status).toBe('completed');
    expect(updated?.duration).toBe(300);

    const fetched = await getCallAsync(call.id, 'ws-abc');
    expect(fetched?.recordingUrl).toBe('https://example.com/rec.mp3');
  });

  it('updateCallAsync returns null for missing call', async () => {
    const { updateCallAsync } = await import('../voice-store');
    const result = await updateCallAsync('nonexistent-id', { status: 'completed' }, 'ws-abc');
    expect(result).toBeNull();
  });

  // ---- Agent operations ----

  it('registerAgentAsync falls back to JSONL sync version', async () => {
    const { registerAgentAsync, getAgents } = await import('../voice-store');
    const agent = await registerAgentAsync(
      { id: 'ag-1', name: 'Test Agent', extension: '100', phoneNumber: '+15550001' },
      'ws-abc',
    );
    expect(agent.id).toBe('ag-1');
    expect(agent.name).toBe('Test Agent');
    expect(agent.status).toBe('available');

    const all = getAgents();
    expect(all.find(a => a.id === 'ag-1')).toBeDefined();
  });

  it('registerAgentAsync upserts existing agent', async () => {
    const { registerAgentAsync, getAgents } = await import('../voice-store');
    await registerAgentAsync(
      { id: 'ag-upsert', name: 'Original', extension: '200', phoneNumber: '+15550002' },
      'ws-abc',
    );
    await registerAgentAsync(
      { id: 'ag-upsert', name: 'Updated', extension: '201', phoneNumber: '+15550003', status: 'busy' },
      'ws-abc',
    );

    const all = getAgents();
    const matches = all.filter(a => a.id === 'ag-upsert');
    expect(matches.length).toBe(1);
    expect(matches[0].name).toBe('Updated');
    expect(matches[0].status).toBe('busy');
  });

  it('getAgentsAsync falls back to JSONL sync version', async () => {
    const { registerAgentAsync, getAgentsAsync } = await import('../voice-store');
    await registerAgentAsync(
      { id: 'ag-list', name: 'List Agent', extension: '300', phoneNumber: '+15550004', workspaceId: 'ws-abc' },
      'ws-abc',
    );

    const agents = await getAgentsAsync('ws-abc');
    expect(agents.length).toBeGreaterThanOrEqual(1);
    expect(agents.find(a => a.id === 'ag-list')).toBeDefined();
  });

  it('updateAgentStatusAsync falls back to JSONL sync version', async () => {
    const { registerAgentAsync, updateAgentStatusAsync } = await import('../voice-store');
    await registerAgentAsync(
      { id: 'ag-status', name: 'Status Agent', extension: '400', phoneNumber: '+15550005' },
      'ws-abc',
    );

    const updated = await updateAgentStatusAsync('ag-status', 'busy', 'call-999', 'ws-abc');
    expect(updated).not.toBeNull();
    expect(updated?.status).toBe('busy');
    expect(updated?.currentCallId).toBe('call-999');
  });

  it('updateAgentStatusAsync returns null for missing agent', async () => {
    const { updateAgentStatusAsync } = await import('../voice-store');
    const result = await updateAgentStatusAsync('nonexistent', 'busy', undefined, 'ws-abc');
    expect(result).toBeNull();
  });

  // ---- Queue metrics ----

  it('recordQueueMetricsAsync falls back to JSONL sync version', async () => {
    const { recordQueueMetricsAsync, getQueueMetrics } = await import('../voice-store');
    const ts = Date.now();
    await recordQueueMetricsAsync({
      queueId: 'q-dual', name: 'Support', waitingCalls: 5,
      avgWaitMs: 15000, longestWaitMs: 45000, availableAgents: 3, timestamp: ts,
    }, 'ws-abc');

    const metrics = getQueueMetrics('q-dual');
    expect(metrics.length).toBe(1);
    expect(metrics[0].waitingCalls).toBe(5);
    expect(metrics[0].queueId).toBe('q-dual');
  });

  it('getQueueMetricsAsync falls back to JSONL sync version', async () => {
    const { recordQueueMetricsAsync, getQueueMetricsAsync } = await import('../voice-store');
    const ts = Date.now();
    await recordQueueMetricsAsync({
      queueId: 'q-get', name: 'Sales', waitingCalls: 2,
      avgWaitMs: 8000, longestWaitMs: 20000, availableAgents: 1, timestamp: ts,
    }, 'ws-abc');

    const metrics = await getQueueMetricsAsync('ws-abc', 'q-get');
    expect(metrics.length).toBe(1);
    expect(metrics[0].name).toBe('Sales');
  });

  it('getQueueMetricsAsync respects limit parameter', async () => {
    const { recordQueueMetricsAsync, getQueueMetricsAsync } = await import('../voice-store');
    for (let i = 0; i < 5; i++) {
      await recordQueueMetricsAsync({
        queueId: 'q-limit', name: 'Billing', waitingCalls: i,
        avgWaitMs: 1000, longestWaitMs: 2000, availableAgents: 1, timestamp: Date.now() + i,
      }, 'ws-abc');
    }

    const limited = await getQueueMetricsAsync('ws-abc', 'q-limit', 3);
    expect(limited.length).toBe(3);
  });

  it('getQueueMetricsAsync returns all queues when queueId omitted', async () => {
    const { recordQueueMetricsAsync, getQueueMetricsAsync } = await import('../voice-store');
    await recordQueueMetricsAsync({
      queueId: 'q-a', name: 'Alpha', waitingCalls: 1,
      avgWaitMs: 1000, longestWaitMs: 2000, availableAgents: 1, timestamp: Date.now(),
    }, 'ws-abc');
    await recordQueueMetricsAsync({
      queueId: 'q-b', name: 'Beta', waitingCalls: 2,
      avgWaitMs: 2000, longestWaitMs: 4000, availableAgents: 2, timestamp: Date.now(),
    }, 'ws-abc');

    const all = await getQueueMetricsAsync('ws-abc');
    expect(all.length).toBeGreaterThanOrEqual(2);
    const ids = all.map(m => m.queueId);
    expect(ids).toContain('q-a');
    expect(ids).toContain('q-b');
  });
});
