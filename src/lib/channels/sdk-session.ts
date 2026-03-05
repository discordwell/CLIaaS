/**
 * SDK session management for the embeddable support widget.
 * Uses JSONL persistence following the same pattern as sms-store.ts.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { createLogger } from '../logger';
import crypto from 'crypto';

const logger = createLogger('channels:sdk');

// ---- Types ----

interface SDKSession {
  id: string;
  workspaceId: string;
  customerId: string;
  token: string;
  conversationId?: string;
  createdAt: string;
  lastActivityAt: string;
}

// ---- JSONL persistence ----

const SESSIONS_FILE = 'sdk-sessions.jsonl';

function persistSessions(store: Map<string, SDKSession>): void {
  writeJsonlFile(SESSIONS_FILE, Array.from(store.values()));
}

// ---- Global singleton storage ----

declare global {
  // eslint-disable-next-line no-var
  var __cliaasSdkSessions: Map<string, SDKSession> | undefined;
  // eslint-disable-next-line no-var
  var __cliaasSdkSessionsLoaded: boolean | undefined;
  // eslint-disable-next-line no-var
  var __cliaasSdkByToken: Map<string, string> | undefined;
}

function getStore(): Map<string, SDKSession> {
  if (!global.__cliaasSdkSessions) {
    global.__cliaasSdkSessions = new Map();
    global.__cliaasSdkByToken = new Map();
  }

  if (!global.__cliaasSdkSessionsLoaded) {
    global.__cliaasSdkSessionsLoaded = true;
    const saved = readJsonlFile<SDKSession>(SESSIONS_FILE);
    if (saved.length > 0) {
      for (const session of saved) {
        global.__cliaasSdkSessions.set(session.id, session);
        global.__cliaasSdkByToken!.set(session.token, session.id);
      }
      logger.info(`Loaded ${saved.length} SDK sessions from disk`);
    }
  }

  return global.__cliaasSdkSessions;
}

function getTokenIndex(): Map<string, string> {
  getStore(); // Ensure loaded
  return global.__cliaasSdkByToken!;
}

// ---- Session operations ----

/**
 * Create a new SDK session for a customer.
 */
export function createSession(workspaceId: string, customerId: string): SDKSession {
  const store = getStore();
  const tokenIndex = getTokenIndex();

  const now = new Date().toISOString();
  const session: SDKSession = {
    id: crypto.randomUUID(),
    workspaceId,
    customerId,
    token: crypto.randomUUID(),
    createdAt: now,
    lastActivityAt: now,
  };

  store.set(session.id, session);
  tokenIndex.set(session.token, session.id);
  persistSessions(store);

  logger.info({ sessionId: session.id, customerId, workspaceId }, 'SDK session created');
  return session;
}

/**
 * Validate a session token. Returns the session if valid, null otherwise.
 */
export function validateSession(token: string): SDKSession | null {
  const tokenIndex = getTokenIndex();
  const sessionId = tokenIndex.get(token);
  if (!sessionId) return null;

  const store = getStore();
  return store.get(sessionId) ?? null;
}

/**
 * Get a session by ID.
 */
export function getSession(sessionId: string): SDKSession | null {
  const store = getStore();
  return store.get(sessionId) ?? null;
}

/**
 * Update the last activity timestamp on a session.
 */
export function updateSessionActivity(sessionId: string): void {
  const store = getStore();
  const session = store.get(sessionId);
  if (!session) return;

  session.lastActivityAt = new Date().toISOString();
  store.set(sessionId, session);
  persistSessions(store);
}

export type { SDKSession };
