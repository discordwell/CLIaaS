/**
 * In-app message store — JSONL-backed in-memory storage for targeted messages and impressions.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';

// ---- Types ----

export type InAppMessageType = 'banner' | 'modal' | 'tooltip' | 'slide_in';

export interface InAppMessage {
  id: string;
  workspaceId?: string;
  name: string;
  messageType: InAppMessageType;
  title: string;
  body: string;
  ctaText?: string;
  ctaUrl?: string;
  targetUrlPattern: string;
  segmentQuery: Record<string, unknown>;
  isActive: boolean;
  priority: number;
  startAt?: string;
  endAt?: string;
  maxImpressions: number;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InAppMessageImpression {
  id: string;
  messageId: string;
  workspaceId?: string;
  customerId: string;
  action: 'displayed' | 'dismissed' | 'clicked' | 'cta_clicked';
  createdAt: string;
}

export interface MessageAnalytics {
  messageId: string;
  displayed: number;
  dismissed: number;
  clicked: number;
  ctaClicked: number;
}

// ---- JSONL persistence ----

const MESSAGES_FILE = 'in-app-messages.jsonl';
const IMPRESSIONS_FILE = 'in-app-message-impressions.jsonl';

const messages: InAppMessage[] = [];
const impressions: InAppMessageImpression[] = [];

function persistMessages(): void { writeJsonlFile(MESSAGES_FILE, messages); }
function persistImpressions(): void { writeJsonlFile(IMPRESSIONS_FILE, impressions); }

let loaded = false;
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  messages.push(...readJsonlFile<InAppMessage>(MESSAGES_FILE));
  impressions.push(...readJsonlFile<InAppMessageImpression>(IMPRESSIONS_FILE));

  if (messages.length === 0) {
    const now = new Date().toISOString();
    messages.push({
      id: 'msg-demo-1',
      name: 'Welcome Banner',
      messageType: 'banner',
      title: 'Welcome to CLIaaS!',
      body: 'Get started by creating your first ticket or exploring the knowledge base.',
      ctaText: 'Create Ticket',
      ctaUrl: '/portal/tickets/new',
      targetUrlPattern: '/portal*',
      segmentQuery: {},
      isActive: true,
      priority: 10,
      maxImpressions: 3,
      createdAt: now,
      updatedAt: now,
    });
    persistMessages();
  }
}

// ---- Message CRUD ----

export function getMessages(workspaceId?: string): InAppMessage[] {
  ensureLoaded();
  return messages
    .filter(m => !workspaceId || !m.workspaceId || m.workspaceId === workspaceId)
    .sort((a, b) => b.priority - a.priority);
}

export function getMessage(id: string, workspaceId?: string): InAppMessage | undefined {
  ensureLoaded();
  const msg = messages.find(m => m.id === id);
  if (!msg) return undefined;
  if (workspaceId && msg.workspaceId && msg.workspaceId !== workspaceId) return undefined;
  return msg;
}

export function createMessage(
  input: Pick<InAppMessage, 'name' | 'messageType' | 'title'> & Partial<Pick<InAppMessage, 'body' | 'ctaText' | 'ctaUrl' | 'targetUrlPattern' | 'segmentQuery' | 'priority' | 'startAt' | 'endAt' | 'maxImpressions' | 'createdBy'>>,
  workspaceId?: string,
): InAppMessage {
  ensureLoaded();
  const now = new Date().toISOString();
  const msg: InAppMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId,
    name: input.name,
    messageType: input.messageType,
    title: input.title,
    body: input.body ?? '',
    ctaText: input.ctaText,
    ctaUrl: input.ctaUrl,
    targetUrlPattern: input.targetUrlPattern ?? '*',
    segmentQuery: input.segmentQuery ?? {},
    isActive: false,
    priority: input.priority ?? 0,
    startAt: input.startAt,
    endAt: input.endAt,
    maxImpressions: input.maxImpressions ?? 0,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  messages.push(msg);
  persistMessages();
  return msg;
}

export function updateMessage(id: string, updates: Partial<Omit<InAppMessage, 'id' | 'createdAt'>>, workspaceId?: string): InAppMessage | null {
  ensureLoaded();
  const idx = messages.findIndex(m => m.id === id && (!workspaceId || !m.workspaceId || m.workspaceId === workspaceId));
  if (idx === -1) return null;
  messages[idx] = { ...messages[idx], ...updates, updatedAt: new Date().toISOString() };
  persistMessages();
  return messages[idx];
}

export function deleteMessage(id: string, workspaceId?: string): boolean {
  ensureLoaded();
  const idx = messages.findIndex(m => m.id === id && (!workspaceId || !m.workspaceId || m.workspaceId === workspaceId));
  if (idx === -1) return false;
  messages.splice(idx, 1);
  for (let i = impressions.length - 1; i >= 0; i--) {
    if (impressions[i].messageId === id) impressions.splice(i, 1);
  }
  persistMessages();
  persistImpressions();
  return true;
}

export function toggleMessage(id: string, workspaceId?: string): InAppMessage | null {
  ensureLoaded();
  const msg = getMessage(id, workspaceId);
  if (!msg) return null;
  return updateMessage(id, { isActive: !msg.isActive }, workspaceId);
}

// ---- Impressions ----

export function recordImpression(
  messageId: string,
  customerId: string,
  action: InAppMessageImpression['action'],
  workspaceId?: string,
): InAppMessageImpression {
  ensureLoaded();
  const impression: InAppMessageImpression = {
    id: `imp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    messageId,
    workspaceId,
    customerId,
    action,
    createdAt: new Date().toISOString(),
  };
  impressions.push(impression);
  persistImpressions();
  return impression;
}

export function getImpressionCount(messageId: string, customerId: string): number {
  ensureLoaded();
  return impressions.filter(i => i.messageId === messageId && i.customerId === customerId && i.action === 'displayed').length;
}

export function getMessageAnalytics(messageId: string): MessageAnalytics {
  ensureLoaded();
  const msgImpressions = impressions.filter(i => i.messageId === messageId);
  return {
    messageId,
    displayed: msgImpressions.filter(i => i.action === 'displayed').length,
    dismissed: msgImpressions.filter(i => i.action === 'dismissed').length,
    clicked: msgImpressions.filter(i => i.action === 'clicked').length,
    ctaClicked: msgImpressions.filter(i => i.action === 'cta_clicked').length,
  };
}
