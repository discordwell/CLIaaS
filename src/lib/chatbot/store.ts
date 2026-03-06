/**
 * Chatbot flow storage: CRUD operations with DB + JSONL fallback.
 * Same dual-path pattern used by the rules engine.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { tryDb, getDefaultWorkspaceId, withRls } from '../store-helpers';
import type { ChatbotFlow } from './types';

const CHATBOTS_FILE = 'chatbots.jsonl';

// ---- JSONL helpers ----

function readAll(): ChatbotFlow[] {
  return readJsonlFile<ChatbotFlow>(CHATBOTS_FILE);
}

function writeAll(flows: ChatbotFlow[]): void {
  writeJsonlFile(CHATBOTS_FILE, flows);
}

// ---- Public API ----

export async function getChatbots(workspaceId?: string): Promise<ChatbotFlow[]> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const rows = await db.select().from(schema.chatbots).orderBy(schema.chatbots.createdAt);
      return rows.map(rowToFlow);
    });
    if (result !== null) return result;
  }
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const rows = await db.select().from(schema.chatbots).orderBy(schema.chatbots.createdAt);
    return rows.map(rowToFlow);
  }
  return readAll();
}

export async function getChatbot(id: string, workspaceId?: string): Promise<ChatbotFlow | null> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      const [row] = await db.select().from(schema.chatbots).where(eq(schema.chatbots.id, id));
      return row ? rowToFlow(row) : null;
    });
    if (result !== null) return result;
  }
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select().from(schema.chatbots).where(eq(schema.chatbots.id, id));
    return row ? rowToFlow(row) : null;
  }
  return readAll().find((f) => f.id === id) ?? null;
}

export async function getActiveChatbot(workspaceId?: string): Promise<ChatbotFlow | null> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      const [row] = await db
        .select()
        .from(schema.chatbots)
        .where(eq(schema.chatbots.enabled, true))
        .limit(1);
      return row ? rowToFlow(row) : null;
    });
    if (result !== null) return result;
  }
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    const [row] = await db
      .select()
      .from(schema.chatbots)
      .where(eq(schema.chatbots.enabled, true))
      .limit(1);
    return row ? rowToFlow(row) : null;
  }
  return readAll().find((f) => f.enabled) ?? null;
}

export async function upsertChatbot(flow: ChatbotFlow, workspaceId?: string): Promise<ChatbotFlow> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      const [existing] = await db
        .select({ id: schema.chatbots.id })
        .from(schema.chatbots)
        .where(eq(schema.chatbots.id, flow.id));

      const values = {
        name: flow.name,
        flow: { nodes: flow.nodes, rootNodeId: flow.rootNodeId },
        enabled: flow.enabled,
        greeting: flow.greeting ?? null,
        version: flow.version ?? 1,
        status: flow.status ?? 'published',
        channels: flow.channels ?? ['web'],
        description: flow.description ?? null,
        updatedAt: new Date(),
      };

      if (existing) {
        await db.update(schema.chatbots).set(values).where(eq(schema.chatbots.id, flow.id));
      } else {
        await db.insert(schema.chatbots).values({ id: flow.id, workspaceId, ...values });
      }
      return flow;
    });
    if (result !== null) return result;
  }

  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');

    // Check if exists
    const [existing] = await db
      .select({ id: schema.chatbots.id })
      .from(schema.chatbots)
      .where(eq(schema.chatbots.id, flow.id));

    const values = {
      name: flow.name,
      flow: { nodes: flow.nodes, rootNodeId: flow.rootNodeId },
      enabled: flow.enabled,
      greeting: flow.greeting ?? null,
      version: flow.version ?? 1,
      status: flow.status ?? 'published',
      channels: flow.channels ?? ['web'],
      description: flow.description ?? null,
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(schema.chatbots).set(values).where(eq(schema.chatbots.id, flow.id));
    } else {
      await db.insert(schema.chatbots).values({
        id: flow.id,
        workspaceId: await getDefaultWorkspaceId(db, schema),
        ...values,
      });
    }

    return flow;
  }

  // JSONL path
  const all = readAll();
  const idx = all.findIndex((f) => f.id === flow.id);
  if (idx >= 0) {
    all[idx] = flow;
  } else {
    all.push(flow);
  }
  writeAll(all);
  return flow;
}

export async function deleteChatbot(id: string, workspaceId?: string): Promise<boolean> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      const r = await db.delete(schema.chatbots).where(eq(schema.chatbots.id, id));
      return (r.rowCount ?? 0) > 0;
    });
    if (result !== null) return result;
  }
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    const result = await db.delete(schema.chatbots).where(eq(schema.chatbots.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  const all = readAll();
  const filtered = all.filter((f) => f.id !== id);
  if (filtered.length === all.length) return false;
  writeAll(filtered);
  return true;
}

// ---- Helpers ----

function rowToFlow(row: {
  id: string;
  name: string;
  flow: unknown;
  enabled: boolean;
  greeting: string | null;
  version?: number;
  status?: string | null;
  channels?: unknown;
  description?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ChatbotFlow {
  const flowData = row.flow as { nodes: ChatbotFlow['nodes']; rootNodeId: string };
  return {
    id: row.id,
    name: row.name,
    nodes: flowData.nodes,
    rootNodeId: flowData.rootNodeId,
    enabled: row.enabled,
    greeting: row.greeting ?? undefined,
    version: row.version ?? 1,
    status: (row.status as ChatbotFlow['status']) ?? 'published',
    channels: (row.channels as ChatbotFlow['channels']) ?? undefined,
    description: row.description ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
