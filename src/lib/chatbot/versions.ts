/**
 * Chatbot version management: publish, rollback, version history.
 */

import { tryDb } from '../store-helpers';
import { getChatbot, upsertChatbot } from './store';
import type { ChatbotFlow, ChatbotVersion } from './types';

export async function publishChatbot(
  id: string,
  userId?: string,
  summary?: string,
): Promise<{ version: number } | null> {
  const flow = await getChatbot(id);
  if (!flow) return null;

  const newVersion = (flow.version ?? 0) + 1;

  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    // Save snapshot to chatbot_versions
    await db.insert(schema.chatbotVersions).values({
      chatbotId: id,
      version: newVersion,
      flow: { nodes: flow.nodes, rootNodeId: flow.rootNodeId },
      summary: summary ?? null,
      createdBy: userId ?? null,
    });

    // Update chatbot with new version + published state
    const { eq } = await import('drizzle-orm');
    await db
      .update(schema.chatbots)
      .set({
        version: newVersion,
        status: 'published',
        publishedFlow: { nodes: flow.nodes, rootNodeId: flow.rootNodeId },
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.chatbots.id, id));
  } else {
    // JSONL path: just bump version on the flow
    flow.version = newVersion;
    flow.status = 'published';
    flow.updatedAt = new Date().toISOString();
    await upsertChatbot(flow);
  }

  return { version: newVersion };
}

export async function rollbackChatbot(
  id: string,
  targetVersion: number,
): Promise<ChatbotFlow | null> {
  const ctx = await tryDb();
  if (!ctx) return null;

  const { db, schema } = ctx;
  const { eq, and } = await import('drizzle-orm');

  const [versionRow] = await db
    .select()
    .from(schema.chatbotVersions)
    .where(
      and(
        eq(schema.chatbotVersions.chatbotId, id),
        eq(schema.chatbotVersions.version, targetVersion),
      ),
    );

  if (!versionRow) return null;

  const flowData = versionRow.flow as { nodes: ChatbotFlow['nodes']; rootNodeId: string };

  await db
    .update(schema.chatbots)
    .set({
      flow: flowData,
      version: targetVersion,
      status: 'published',
      publishedFlow: flowData,
      publishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.chatbots.id, id));

  return getChatbot(id);
}

export async function getChatbotVersions(id: string): Promise<ChatbotVersion[]> {
  const ctx = await tryDb();
  if (!ctx) return [];

  const { db, schema } = ctx;
  const { eq, desc } = await import('drizzle-orm');

  const rows = await db
    .select()
    .from(schema.chatbotVersions)
    .where(eq(schema.chatbotVersions.chatbotId, id))
    .orderBy(desc(schema.chatbotVersions.version));

  return rows.map((r) => ({
    id: r.id,
    chatbotId: r.chatbotId,
    version: r.version,
    flow: r.flow as ChatbotVersion['flow'],
    summary: r.summary ?? undefined,
    createdBy: r.createdBy ?? undefined,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getChatbotVersion(
  id: string,
  version: number,
): Promise<ChatbotVersion | null> {
  const ctx = await tryDb();
  if (!ctx) return null;

  const { db, schema } = ctx;
  const { eq, and } = await import('drizzle-orm');

  const [row] = await db
    .select()
    .from(schema.chatbotVersions)
    .where(
      and(
        eq(schema.chatbotVersions.chatbotId, id),
        eq(schema.chatbotVersions.version, version),
      ),
    );

  if (!row) return null;

  return {
    id: row.id,
    chatbotId: row.chatbotId,
    version: row.version,
    flow: row.flow as ChatbotVersion['flow'],
    summary: row.summary ?? undefined,
    createdBy: row.createdBy ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}
