import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'fs';

const TEST_DIR = '/tmp/cliaas-test-voice-' + process.pid;

describe('voice-store', () => {
  beforeEach(() => {
    process.env.CLIAAS_DATA_DIR = TEST_DIR;
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    // Reset globals for clean state
    delete (global as Record<string, unknown>).__cliaasVoiceCalls;
    delete (global as Record<string, unknown>).__cliaasVoiceCallsLoaded;
    delete (global as Record<string, unknown>).__cliaasVoiceAgents;
    delete (global as Record<string, unknown>).__cliaasVoiceAgentsLoaded;
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    delete process.env.CLIAAS_DATA_DIR;
    delete (global as Record<string, unknown>).__cliaasVoiceCalls;
    delete (global as Record<string, unknown>).__cliaasVoiceCallsLoaded;
    delete (global as Record<string, unknown>).__cliaasVoiceAgents;
    delete (global as Record<string, unknown>).__cliaasVoiceAgentsLoaded;
  });

  it('starts empty without auto-seeding', async () => {
    const { getAllCalls, getAgents } = await import('@/lib/channels/voice-store');
    expect(getAllCalls()).toEqual([]);
    expect(getAgents()).toEqual([]);
  });

  it('creates and retrieves a call', async () => {
    const { createCall, getCall } = await import('@/lib/channels/voice-store');
    const call = createCall('CA123', 'inbound', '+15551234567', '+15559876543');
    expect(call.callSid).toBe('CA123');
    expect(call.status).toBe('ringing');

    const found = getCall(call.id);
    expect(found).toBeDefined();
    expect(found?.callSid).toBe('CA123');
  });

  it('finds a call by SID', async () => {
    const { createCall, getCallBySid } = await import('@/lib/channels/voice-store');
    createCall('CA456', 'inbound', '+15551111111', '+15552222222');
    const found = getCallBySid('CA456');
    expect(found).toBeDefined();
    expect(found?.from).toBe('+15551111111');
  });

  it('updates call properties', async () => {
    const { createCall, updateCall, getCall } = await import('@/lib/channels/voice-store');
    const call = createCall('CA789', 'inbound', '+15553333333', '+15554444444');

    updateCall(call.id, {
      status: 'completed',
      duration: 120,
      recordingUrl: 'https://example.com/recording.mp3',
    });

    const updated = getCall(call.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.duration).toBe(120);
    expect(updated?.recordingUrl).toBe('https://example.com/recording.mp3');
  });

  it('returns active calls only', async () => {
    const { createCall, updateCall, getActiveCalls } = await import('@/lib/channels/voice-store');

    const call1 = createCall('CA-A1', 'inbound', '+1111', '+2222');
    const call2 = createCall('CA-A2', 'inbound', '+3333', '+4444');

    updateCall(call1.id, { status: 'in-progress' });
    updateCall(call2.id, { status: 'completed' });

    const active = getActiveCalls();
    const activeSids = active.map((c) => c.callSid);
    expect(activeSids).toContain('CA-A1');
    expect(activeSids).not.toContain('CA-A2');
  });

  it('registers and retrieves agents', async () => {
    const { registerAgent, getAgents } = await import('@/lib/channels/voice-store');
    registerAgent({ id: 'a1', name: 'Test Agent', extension: '100', phoneNumber: '+15550001' });
    const agents = getAgents();
    expect(agents.length).toBe(1);
    expect(agents[0].name).toBe('Test Agent');
    expect(agents[0].status).toBe('available');
  });

  it('selects available agent with round-robin', async () => {
    const { registerAgent, getAvailableAgent } = await import('@/lib/channels/voice-store');
    registerAgent({ id: 'a1', name: 'Agent 1', extension: '101', phoneNumber: '+15550001' });
    registerAgent({ id: 'a2', name: 'Agent 2', extension: '102', phoneNumber: '+15550002', status: 'offline' });
    const agent = getAvailableAgent();
    expect(agent).toBeDefined();
    expect(agent?.id).toBe('a1');
  });

  it('updates agent status', async () => {
    const { registerAgent, updateAgentStatus } = await import('@/lib/channels/voice-store');
    registerAgent({ id: 'a1', name: 'Agent 1', extension: '101', phoneNumber: '+15550001' });
    const updated = updateAgentStatus('a1', 'busy', 'call-123');
    expect(updated?.status).toBe('busy');
    expect(updated?.currentCallId).toBe('call-123');
  });

  it('seeds demo data only when explicitly called', async () => {
    const { getAllCalls, getAgents, seedDemoData } = await import('@/lib/channels/voice-store');
    expect(getAllCalls()).toEqual([]);
    expect(getAgents()).toEqual([]);

    seedDemoData();
    expect(getAgents().length).toBe(3);
    expect(getAllCalls().length).toBeGreaterThan(0);
  });

  it('supports workspace-scoped queries', async () => {
    const { createCall, getAllCalls, registerAgent, getAgents } = await import('@/lib/channels/voice-store');
    createCall('CA-WS1', 'inbound', '+1111', '+2222', 'ws-1');
    createCall('CA-WS2', 'inbound', '+3333', '+4444', 'ws-2');

    expect(getAllCalls('ws-1').length).toBe(1);
    expect(getAllCalls('ws-1')[0].callSid).toBe('CA-WS1');

    registerAgent({ id: 'a1', name: 'Agent 1', extension: '101', phoneNumber: '+15550001', workspaceId: 'ws-1' });
    registerAgent({ id: 'a2', name: 'Agent 2', extension: '102', phoneNumber: '+15550002', workspaceId: 'ws-2' });
    expect(getAgents('ws-1').length).toBe(1);
  });

  it('records and retrieves queue metrics', async () => {
    const { recordQueueMetrics, getQueueMetrics } = await import('@/lib/channels/voice-store');
    recordQueueMetrics({
      queueId: 'q1', name: 'Support', waitingCalls: 3,
      avgWaitMs: 12000, longestWaitMs: 30000, availableAgents: 2, timestamp: Date.now(),
    });
    const metrics = getQueueMetrics('q1');
    expect(metrics.length).toBe(1);
    expect(metrics[0].waitingCalls).toBe(3);
  });

  it('persists calls to JSONL', async () => {
    const { createCall } = await import('@/lib/channels/voice-store');
    createCall('CA-PERSIST', 'inbound', '+1111', '+2222');

    expect(existsSync(`${TEST_DIR}/voice-calls.jsonl`)).toBe(true);
  });
});
