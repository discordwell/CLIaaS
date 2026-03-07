/**
 * In-app message store — JSONL-backed in-memory storage for targeted messages and impressions.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { withRls } from '../store-helpers';

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

export async function getMessages(workspaceId?: string): Promise<InAppMessage[]> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const rows = await db.select().from(schema.inAppMessages);
      return rows.map(r => ({
        id: r.id,
        workspaceId: r.workspaceId,
        name: r.name,
        messageType: r.messageType,
        title: r.title,
        body: r.body,
        ctaText: r.ctaText ?? undefined,
        ctaUrl: r.ctaUrl ?? undefined,
        targetUrlPattern: r.targetUrlPattern,
        segmentQuery: (r.segmentQuery as Record<string, unknown>) ?? {},
        isActive: r.isActive,
        priority: r.priority,
        startAt: r.startAt?.toISOString(),
        endAt: r.endAt?.toISOString(),
        maxImpressions: r.maxImpressions,
        createdBy: r.createdBy ?? undefined,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      } as InAppMessage)).sort((a, b) => b.priority - a.priority);
    });
    if (result !== null) return result;
  }
  ensureLoaded();
  return messages
    .filter(m => !workspaceId || !m.workspaceId || m.workspaceId === workspaceId)
    .sort((a, b) => b.priority - a.priority);
}

export async function getMessage(id: string, workspaceId?: string): Promise<InAppMessage | undefined> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      const [r] = await db.select().from(schema.inAppMessages).where(eq(schema.inAppMessages.id, id));
      if (!r) return undefined;
      return {
        id: r.id,
        workspaceId: r.workspaceId,
        name: r.name,
        messageType: r.messageType,
        title: r.title,
        body: r.body,
        ctaText: r.ctaText ?? undefined,
        ctaUrl: r.ctaUrl ?? undefined,
        targetUrlPattern: r.targetUrlPattern,
        segmentQuery: (r.segmentQuery as Record<string, unknown>) ?? {},
        isActive: r.isActive,
        priority: r.priority,
        startAt: r.startAt?.toISOString(),
        endAt: r.endAt?.toISOString(),
        maxImpressions: r.maxImpressions,
        createdBy: r.createdBy ?? undefined,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      } as InAppMessage;
    });
    if (result !== null) return result;
  }
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

export async function toggleMessage(id: string, workspaceId?: string): Promise<InAppMessage | null> {
  ensureLoaded();
  const msg = await getMessage(id, workspaceId);
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

export async function getImpressionCount(messageId: string, customerId: string, workspaceId?: string): Promise<number> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq, and } = await import('drizzle-orm');
      const rows = await db.select().from(schema.inAppMessageImpressions)
        .where(and(
          eq(schema.inAppMessageImpressions.messageId, messageId),
          eq(schema.inAppMessageImpressions.customerId, customerId),
          eq(schema.inAppMessageImpressions.action, 'displayed'),
        ));
      return rows.length;
    });
    if (result !== null) return result;
  }
  ensureLoaded();
  return impressions.filter(i => i.messageId === messageId && i.customerId === customerId && i.action === 'displayed').length;
}

export async function getMessageAnalytics(messageId: string, workspaceId?: string): Promise<MessageAnalytics> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      const rows = await db.select().from(schema.inAppMessageImpressions)
        .where(eq(schema.inAppMessageImpressions.messageId, messageId));
      return {
        messageId,
        displayed: rows.filter(r => r.action === 'displayed').length,
        dismissed: rows.filter(r => r.action === 'dismissed').length,
        clicked: rows.filter(r => r.action === 'clicked').length,
        ctaClicked: rows.filter(r => r.action === 'cta_clicked').length,
      };
    });
    if (result !== null) return result;
  }
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
