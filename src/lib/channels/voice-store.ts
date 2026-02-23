/**
 * In-memory voice call tracking store with global singleton pattern.
 * Mirrors sms-store.ts for voice/phone channel.
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
  ivrPath?: string[];        // digits pressed through IVR
  createdAt: number;
  updatedAt: number;
}

export interface VoiceAgent {
  id: string;
  name: string;
  extension: string;
  phoneNumber: string;
  status: 'available' | 'busy' | 'offline';
}

// ---- JSONL persistence ----

const CALLS_FILE = 'voice-calls.jsonl';
const AGENTS_FILE = 'voice-agents.jsonl';

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
    if (saved.length > 0) {
      for (const call of saved) {
        global.__cliaasVoiceCalls.set(call.id, call);
      }
    } else {
      seedDemoCalls(global.__cliaasVoiceCalls);
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
    } else {
      global.__cliaasVoiceAgents = [
        { id: 'agent-1', name: 'Sarah Chen', extension: '101', phoneNumber: '+15005550001', status: 'available' },
        { id: 'agent-2', name: 'Mike Johnson', extension: '102', phoneNumber: '+15005550002', status: 'available' },
        { id: 'agent-3', name: 'Emma Davis', extension: '103', phoneNumber: '+15005550003', status: 'offline' },
      ];
      persistAgents(global.__cliaasVoiceAgents);
    }
    global.__cliaasVoiceAgentsLoaded = true;
  }
  return global.__cliaasVoiceAgents;
}

// ---- Demo seed data ----

function seedDemoCalls(store: Map<string, VoiceCall>): void {
  const now = Date.now();

  const calls: VoiceCall[] = [
    {
      id: crypto.randomUUID(),
      callSid: 'CA' + crypto.randomUUID().replace(/-/g, '').slice(0, 32),
      direction: 'inbound',
      from: '+14155559876',
      to: '+15005550006',
      status: 'completed',
      duration: 245,
      agentId: 'agent-1',
      ivrPath: ['2'],
      createdAt: now - 7200000,
      updatedAt: now - 7200000 + 245000,
    },
    {
      id: crypto.randomUUID(),
      callSid: 'CA' + crypto.randomUUID().replace(/-/g, '').slice(0, 32),
      direction: 'inbound',
      from: '+447700900456',
      to: '+15005550006',
      status: 'voicemail',
      duration: 35,
      recordingUrl: 'https://api.twilio.com/demo/recording/RE001.mp3',
      transcription: 'Hi, this is James. I need help with my subscription renewal. Please call me back.',
      ivrPath: ['0'],
      createdAt: now - 3600000,
      updatedAt: now - 3600000 + 35000,
    },
    {
      id: crypto.randomUUID(),
      callSid: 'CA' + crypto.randomUUID().replace(/-/g, '').slice(0, 32),
      direction: 'inbound',
      from: '+12125551234',
      to: '+15005550006',
      status: 'in-progress',
      agentId: 'agent-2',
      ivrPath: ['1'],
      createdAt: now - 300000,
      updatedAt: now - 300000,
    },
  ];

  for (const call of calls) {
    store.set(call.id, call);
  }
  persistCalls(store);
}

// ---- Call operations ----

export function createCall(
  callSid: string,
  direction: VoiceCall['direction'],
  from: string,
  to: string,
): VoiceCall {
  const store = getCallStore();
  const call: VoiceCall = {
    id: crypto.randomUUID(),
    callSid,
    direction,
    from,
    to,
    status: 'ringing',
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

export function getAllCalls(): VoiceCall[] {
  return Array.from(getCallStore().values()).sort(
    (a, b) => b.createdAt - a.createdAt,
  );
}

export function updateCall(
  id: string,
  updates: Partial<Pick<VoiceCall, 'status' | 'duration' | 'recordingUrl' | 'transcription' | 'agentId' | 'ticketId' | 'ivrPath'>>,
): VoiceCall | null {
  const store = getCallStore();
  const call = store.get(id);
  if (!call) return null;

  Object.assign(call, updates, { updatedAt: Date.now() });
  store.set(id, call);
  persistCalls(store);
  return call;
}

export function getActiveCalls(): VoiceCall[] {
  return getAllCalls().filter(
    (c) => c.status === 'ringing' || c.status === 'in-progress',
  );
}

// ---- Agent operations ----

export function getAgents(): VoiceAgent[] {
  return [...getAgentStore()];
}

export function getAvailableAgent(): VoiceAgent | undefined {
  const agents = getAgentStore();
  const available = agents.filter((a) => a.status === 'available');
  if (available.length === 0) return undefined;
  // Round-robin: pick the one assigned to least active calls
  const activeCalls = getActiveCalls();
  return available.sort((a, b) => {
    const aCount = activeCalls.filter((c) => c.agentId === a.id).length;
    const bCount = activeCalls.filter((c) => c.agentId === b.id).length;
    return aCount - bCount;
  })[0];
}

export function updateAgentStatus(id: string, status: VoiceAgent['status']): VoiceAgent | null {
  const agents = getAgentStore();
  const agent = agents.find((a) => a.id === id);
  if (!agent) return null;
  agent.status = status;
  persistAgents(agents);
  return agent;
}
