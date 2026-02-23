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

  it('seeds demo calls on first access', async () => {
    const { getAllCalls } = await import('@/lib/channels/voice-store');
    const calls = getAllCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toHaveProperty('callSid');
    expect(calls[0]).toHaveProperty('from');
    expect(calls[0]).toHaveProperty('status');
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
    // Active should include call1 (in-progress) but not call2 (completed)
    // Plus any demo seed calls that are in-progress
    const activeSids = active.map((c) => c.callSid);
    expect(activeSids).toContain('CA-A1');
    expect(activeSids).not.toContain('CA-A2');
  });

  it('seeds demo agents on first access', async () => {
    const { getAgents } = await import('@/lib/channels/voice-store');
    const agents = getAgents();
    expect(agents.length).toBeGreaterThan(0);
    expect(agents[0]).toHaveProperty('name');
    expect(agents[0]).toHaveProperty('extension');
  });

  it('selects available agent with round-robin', async () => {
    const { getAvailableAgent } = await import('@/lib/channels/voice-store');
    const agent = getAvailableAgent();
    expect(agent).toBeDefined();
    expect(agent?.status).toBe('available');
  });

  it('updates agent status', async () => {
    const { getAgents, updateAgentStatus } = await import('@/lib/channels/voice-store');
    const agents = getAgents();
    const agent = agents[0];
    const updated = updateAgentStatus(agent.id, 'busy');
    expect(updated?.status).toBe('busy');
  });

  it('persists calls to JSONL', async () => {
    const { createCall } = await import('@/lib/channels/voice-store');
    createCall('CA-PERSIST', 'inbound', '+1111', '+2222');

    expect(existsSync(`${TEST_DIR}/voice-calls.jsonl`)).toBe(true);
  });
});
