/**
 * Voice call tracking store — JSONL-persistent with DB-ready interface.
 * No demo seed data in production; explicit seed function for dev/test.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';

// ---- Types ----

export interface VoiceCall {
  id: string;
  callSid: string;
  direction: 'inbound' | 'outbound';
  from: string;
  to: string;
  status: 'ringing' | 'in-progress' | 'completed' | 'busy' | 'no-answer' | 'failed' | 'voicemail';
  duration?: number;         // seconds
  recordingUrl?: string;
  transcription?: string;
  agentId?: string;
  ticketId?: string;
  queueId?: string;
  queueWaitMs?: number;
  ivrPath?: string[];        // digits pressed through IVR
  workspaceId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface VoiceAgent {
  id: string;
  name: string;
  extension: string;
  phoneNumber: string;
  status: 'available' | 'busy' | 'offline' | 'wrap-up';
  currentCallId?: string;
  workspaceId?: string;
}

export interface VoiceQueueMetrics {
  queueId: string;
  name: string;
  waitingCalls: number;
  avgWaitMs: number;
  longestWaitMs: number;
  availableAgents: number;
  timestamp: number;
}

// ---- JSONL persistence ----

const CALLS_FILE = 'voice-calls.jsonl';
const AGENTS_FILE = 'voice-agents.jsonl';
const QUEUE_METRICS_FILE = 'voice-queue-metrics.jsonl';

function persistCalls(store: Map<string, VoiceCall>): void {
  writeJsonlFile(CALLS_FILE, Array.from(store.values()));
}

function persistAgents(agents: VoiceAgent[]): void {
  writeJsonlFile(AGENTS_FILE, agents);
}

// ---- Global singleton storage ----

declare global {
  // eslint-disable-next-line no-var
  var __cliaasVoiceCalls: Map<string, VoiceCall> | undefined;
  // eslint-disable-next-line no-var
  var __cliaasVoiceCallsLoaded: boolean | undefined;
  // eslint-disable-next-line no-var
  var __cliaasVoiceAgents: VoiceAgent[] | undefined;
  // eslint-disable-next-line no-var
  var __cliaasVoiceAgentsLoaded: boolean | undefined;
}

function getCallStore(): Map<string, VoiceCall> {
  if (!global.__cliaasVoiceCalls) {
    global.__cliaasVoiceCalls = new Map();
  }
  if (!global.__cliaasVoiceCallsLoaded) {
    const saved = readJsonlFile<VoiceCall>(CALLS_FILE);
    for (const call of saved) {
      global.__cliaasVoiceCalls.set(call.id, call);
    }
    global.__cliaasVoiceCallsLoaded = true;
  }
  return global.__cliaasVoiceCalls;
}

function getAgentStore(): VoiceAgent[] {
  if (!global.__cliaasVoiceAgents) {
    global.__cliaasVoiceAgents = [];
  }
  if (!global.__cliaasVoiceAgentsLoaded) {
    const saved = readJsonlFile<VoiceAgent>(AGENTS_FILE);
    if (saved.length > 0) {
      global.__cliaasVoiceAgents = saved;
    }
    global.__cliaasVoiceAgentsLoaded = true;
  }
  return global.__cliaasVoiceAgents;
}

// ---- Call operations ----

export function createCall(
  callSid: string,
  direction: VoiceCall['direction'],
  from: string,
  to: string,
  workspaceId?: string,
): VoiceCall {
  const store = getCallStore();
  const call: VoiceCall = {
    id: crypto.randomUUID(),
    callSid,
    direction,
    from,
    to,
    status: 'ringing',
    workspaceId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store.set(call.id, call);
  persistCalls(store);
  return call;
}

export function getCall(id: string): VoiceCall | undefined {
  return getCallStore().get(id);
}

export function getCallBySid(sid: string): VoiceCall | undefined {
  for (const call of getCallStore().values()) {
    if (call.callSid === sid) return call;
  }
  return undefined;
}

export function getAllCalls(workspaceId?: string): VoiceCall[] {
  let calls = Array.from(getCallStore().values());
  if (workspaceId) {
    calls = calls.filter(c => !c.workspaceId || c.workspaceId === workspaceId);
  }
  return calls.sort(
    (a, b) => b.createdAt - a.createdAt,
  );
}

export function updateCall(
  id: string,
  updates: Partial<Pick<VoiceCall, 'status' | 'duration' | 'recordingUrl' | 'transcription' | 'agentId' | 'ticketId' | 'ivrPath' | 'queueId' | 'queueWaitMs'>>,
): VoiceCall | null {
  const store = getCallStore();
  const call = store.get(id);
  if (!call) return null;

  Object.assign(call, updates, { updatedAt: Date.now() });
  store.set(id, call);
  persistCalls(store);
  return call;
}

export function getActiveCalls(workspaceId?: string): VoiceCall[] {
  return getAllCalls(workspaceId).filter(
    (c) => c.status === 'ringing' || c.status === 'in-progress',
  );
}

// ---- Agent operations ----

export function getAgents(workspaceId?: string): VoiceAgent[] {
  const agents = [...getAgentStore()];
  if (workspaceId) return agents.filter(a => !a.workspaceId || a.workspaceId === workspaceId);
  return agents;
}

export function registerAgent(agent: Omit<VoiceAgent, 'status'> & { status?: VoiceAgent['status'] }): VoiceAgent {
  const agents = getAgentStore();
  const existing = agents.findIndex(a => a.id === agent.id);
  const full: VoiceAgent = { status: 'available', ...agent };
  if (existing >= 0) {
    agents[existing] = full;
  } else {
    agents.push(full);
  }
  persistAgents(agents);
  return full;
}

export function getAvailableAgent(workspaceId?: string): VoiceAgent | undefined {
  const agents = getAgents(workspaceId);
  const available = agents.filter((a) => a.status === 'available');
  if (available.length === 0) return undefined;
  const activeCalls = getActiveCalls(workspaceId);
  return available.sort((a, b) => {
    const aCount = activeCalls.filter((c) => c.agentId === a.id).length;
    const bCount = activeCalls.filter((c) => c.agentId === b.id).length;
    return aCount - bCount;
  })[0];
}

export function updateAgentStatus(id: string, status: VoiceAgent['status'], currentCallId?: string): VoiceAgent | null {
  const agents = getAgentStore();
  const agent = agents.find((a) => a.id === id);
  if (!agent) return null;
  agent.status = status;
  if (currentCallId !== undefined) agent.currentCallId = currentCallId;
  persistAgents(agents);
  return agent;
}

// ---- Queue metrics ----

export function recordQueueMetrics(metrics: VoiceQueueMetrics): void {
  const existing = readJsonlFile<VoiceQueueMetrics>(QUEUE_METRICS_FILE);
  existing.push(metrics);
  // Keep last 1000 snapshots
  const trimmed = existing.slice(-1000);
  writeJsonlFile(QUEUE_METRICS_FILE, trimmed);
}

export function getQueueMetrics(queueId?: string, limit = 100): VoiceQueueMetrics[] {
  const all = readJsonlFile<VoiceQueueMetrics>(QUEUE_METRICS_FILE);
  const filtered = queueId ? all.filter(m => m.queueId === queueId) : all;
  return filtered.slice(-limit);
}

// ---- Demo seed (explicit, not auto-loaded) ----

export function seedDemoData(): void {
  const agents = getAgentStore();
  if (agents.length > 0) return; // Already has data

  const demoAgents: VoiceAgent[] = [
    { id: 'agent-1', name: 'Sarah Chen', extension: '101', phoneNumber: '+15005550001', status: 'available' },
    { id: 'agent-2', name: 'Mike Johnson', extension: '102', phoneNumber: '+15005550002', status: 'available' },
    { id: 'agent-3', name: 'Emma Davis', extension: '103', phoneNumber: '+15005550003', status: 'offline' },
  ];
  global.__cliaasVoiceAgents = demoAgents;
  persistAgents(demoAgents);

  const now = Date.now();
  const store = getCallStore();
  const demoCalls: VoiceCall[] = [
    {
      id: crypto.randomUUID(),
      callSid: 'CA' + crypto.randomUUID().replace(/-/g, '').slice(0, 32),
      direction: 'inbound', from: '+14155559876', to: '+15005550006',
      status: 'completed', duration: 245, agentId: 'agent-1', ivrPath: ['2'],
      createdAt: now - 7200000, updatedAt: now - 7200000 + 245000,
    },
    {
      id: crypto.randomUUID(),
      callSid: 'CA' + crypto.randomUUID().replace(/-/g, '').slice(0, 32),
      direction: 'inbound', from: '+447700900456', to: '+15005550006',
      status: 'voicemail', duration: 35,
      recordingUrl: 'https://api.twilio.com/demo/recording/RE001.mp3',
      transcription: 'Hi, this is James. I need help with my subscription renewal. Please call me back.',
      ivrPath: ['0'], createdAt: now - 3600000, updatedAt: now - 3600000 + 35000,
    },
  ];
  for (const call of demoCalls) store.set(call.id, call);
  persistCalls(store);
}
