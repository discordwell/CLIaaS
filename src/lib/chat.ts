/**
 * In-memory chat storage with global singleton pattern.
 * Stores chat sessions and messages for the live chat widget.
 * When DATABASE_URL is available, also persists to the database.
 */

import { readJsonlFile, writeJsonlFile } from './jsonl-store';
import type { ChatbotSessionState } from './chatbot/types';

// ---- Types ----

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'customer' | 'agent' | 'system' | 'bot';
  body: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ChatSession {
  id: string;
  customerName: string;
  customerEmail: string;
  status: 'waiting' | 'active' | 'closed';
  messages: ChatMessage[];
  startedAt: number;
  lastActivity: number;
  agentTyping: boolean;
  customerTyping: boolean;
  ticketId?: string;
  botState?: ChatbotSessionState;
}

// ---- JSONL persistence ----

const CHAT_SESSIONS_FILE = 'chat-sessions.jsonl';

function persistSessions(store: Map<string, ChatSession>): void {
  writeJsonlFile(CHAT_SESSIONS_FILE, Array.from(store.values()));
}

// ---- Global singleton storage ----

declare global {
  // eslint-disable-next-line no-var
  var __cliaasChats: Map<string, ChatSession> | undefined;
  // eslint-disable-next-line no-var
  var __cliaasChatsLoaded: boolean | undefined;
}

function getStore(): Map<string, ChatSession> {
  if (!global.__cliaasChats) {
    global.__cliaasChats = new Map();
  }
  // Load persisted sessions on first access
  if (!global.__cliaasChatsLoaded) {
    global.__cliaasChatsLoaded = true;
    const saved = readJsonlFile<ChatSession>(CHAT_SESSIONS_FILE);
    for (const session of saved) {
      global.__cliaasChats.set(session.id, session);
    }
  }
  return global.__cliaasChats;
}

// ---- Helpers ----

export function generateId(): string {
  return crypto.randomUUID();
}

// ---- Session operations ----

export function createSession(
  customerName: string,
  customerEmail: string,
): ChatSession {
  const store = getStore();
  const session: ChatSession = {
    id: generateId(),
    customerName,
    customerEmail,
    status: 'waiting',
    messages: [],
    startedAt: Date.now(),
    lastActivity: Date.now(),
    agentTyping: false,
    customerTyping: false,
  };

  // Add system greeting
  const greeting: ChatMessage = {
    id: generateId(),
    sessionId: session.id,
    role: 'system',
    body: `${customerName} started a chat session. An agent will be with you shortly.`,
    timestamp: Date.now(),
  };
  session.messages.push(greeting);

  store.set(session.id, session);
  persistSessions(store);
  return session;
}

export function getSession(sessionId: string): ChatSession | undefined {
  return getStore().get(sessionId);
}

export function getAllSessions(): ChatSession[] {
  const store = getStore();
  return Array.from(store.values()).sort(
    (a, b) => b.lastActivity - a.lastActivity,
  );
}

export function getActiveSessions(): ChatSession[] {
  return getAllSessions().filter((s) => s.status !== 'closed');
}

// ---- Message operations ----

export function addMessage(
  sessionId: string,
  role: ChatMessage['role'],
  body: string,
  metadata?: Record<string, unknown>,
): ChatMessage | null {
  const store = getStore();
  const session = store.get(sessionId);
  if (!session) return null;

  const message: ChatMessage = {
    id: generateId(),
    sessionId,
    role,
    body,
    timestamp: Date.now(),
  };
  if (metadata) message.metadata = metadata;

  session.messages.push(message);
  session.lastActivity = Date.now();

  // If agent replies, mark session as active
  if (role === 'agent' && session.status === 'waiting') {
    session.status = 'active';
  }

  // Reset typing indicators on message send
  if (role === 'agent') {
    session.agentTyping = false;
  } else if (role === 'customer') {
    session.customerTyping = false;
  }

  store.set(sessionId, session);
  persistSessions(store);
  return message;
}

// ---- Bot state operations ----

export function setBotState(
  sessionId: string,
  botState: ChatbotSessionState | undefined,
): void {
  const store = getStore();
  const session = store.get(sessionId);
  if (!session) return;

  session.botState = botState;
  store.set(sessionId, session);
  persistSessions(store);
}

export function getMessages(
  sessionId: string,
  afterTimestamp?: number,
): ChatMessage[] {
  const session = getStore().get(sessionId);
  if (!session) return [];

  if (afterTimestamp) {
    return session.messages.filter((m) => m.timestamp > afterTimestamp);
  }
  return session.messages;
}

// ---- Session state operations ----

export function closeSession(sessionId: string): ChatSession | null {
  const store = getStore();
  const session = store.get(sessionId);
  if (!session) return null;

  session.status = 'closed';
  session.lastActivity = Date.now();

  const closeMsg: ChatMessage = {
    id: generateId(),
    sessionId,
    role: 'system',
    body: 'Chat session ended.',
    timestamp: Date.now(),
  };
  session.messages.push(closeMsg);

  store.set(sessionId, session);
  persistSessions(store);
  return session;
}

export function setTyping(
  sessionId: string,
  role: 'agent' | 'customer',
  typing: boolean,
): void {
  const store = getStore();
  const session = store.get(sessionId);
  if (!session) return;

  if (role === 'agent') {
    session.agentTyping = typing;
  } else {
    session.customerTyping = typing;
  }
  store.set(sessionId, session);
}

// ---- Ticket creation from chat ----

export function buildTicketFromChat(session: ChatSession): {
  subject: string;
  body: string;
  requester: string;
  email: string;
} {
  const customerMessages = session.messages
    .filter((m) => m.role === 'customer')
    .map((m) => m.body);

  const subject =
    customerMessages.length > 0
      ? customerMessages[0].slice(0, 100)
      : `Chat from ${session.customerName}`;

  const body = session.messages
    .filter((m) => m.role !== 'system')
    .map(
      (m) =>
        `[${m.role.toUpperCase()}] ${new Date(m.timestamp).toLocaleTimeString()}: ${m.body}`,
    )
    .join('\n');

  return {
    subject,
    body,
    requester: session.customerName,
    email: session.customerEmail,
  };
}
