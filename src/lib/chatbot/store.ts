/**
 * Chatbot flow storage: CRUD operations with DB + JSONL fallback.
 * Same dual-path pattern used by the rules engine.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import type { ChatbotFlow } from './types';

const CHATBOTS_FILE = 'chatbots.jsonl';

// ---- JSONL helpers ----

function readAll(): ChatbotFlow[] {
  return readJsonlFile<ChatbotFlow>(CHATBOTS_FILE);
}

function writeAll(flows: ChatbotFlow[]): void {
  writeJsonlFile(CHATBOTS_FILE, flows);
}

// ---- DB helpers ----

async function tryDb() {
  try {
    const { getDb } = await import('@/db');
    const db = getDb();
    if (!db) return null;
    const schema = await import('@/db/schema');
    return { db, schema };
  } catch {
    return null;
  }
}

// ---- Public API ----

export async function getChatbots(): Promise<ChatbotFlow[]> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const rows = await db.select().from(schema.chatbots).orderBy(schema.chatbots.createdAt);
    return rows.map(rowToFlow);
  }
  return readAll();
}

export async function getChatbot(id: string): Promise<ChatbotFlow | null> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select().from(schema.chatbots).where(eq(schema.chatbots.id, id));
    return row ? rowToFlow(row) : null;
  }
  return readAll().find((f) => f.id === id) ?? null;
}

export async function getActiveChatbot(): Promise<ChatbotFlow | null> {
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

export async function upsertChatbot(flow: ChatbotFlow): Promise<ChatbotFlow> {
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

export async function deleteChatbot(id: string): Promise<boolean> {
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getDefaultWorkspaceId(
  db: Awaited<ReturnType<typeof import('@/db')['getDb']>>,
  schema: typeof import('@/db/schema'),
): Promise<string> {
  if (!db) throw new Error('DB not available');
  const [ws] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).limit(1);
  if (!ws) throw new Error('No workspace found');
  return ws.id;
}
