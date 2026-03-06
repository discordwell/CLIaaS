/**
 * Chatbot analytics: per-node metrics and session tracking.
 */

import { tryDb, withRls } from '../store-helpers';

export async function recordNodeEntry(chatbotId: string, nodeId: string, workspaceId?: string): Promise<void> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const today = new Date().toISOString().split('T')[0];
      await db
        .insert(schema.chatbotAnalytics)
        .values({ chatbotId, workspaceId, nodeId, date: today, entries: 1, exits: 0, dropOffs: 0 })
        .onConflictDoUpdate({
          target: [schema.chatbotAnalytics.chatbotId, schema.chatbotAnalytics.nodeId, schema.chatbotAnalytics.date],
          set: { entries: (await import('drizzle-orm')).sql`${schema.chatbotAnalytics.entries} + 1` },
        });
    });
    if (result !== null) return;
  }
  const ctx = await tryDb();
  if (!ctx) return;

  const { db, schema } = ctx;
  const today = new Date().toISOString().split('T')[0];

  await db
    .insert(schema.chatbotAnalytics)
    .values({ chatbotId, workspaceId: workspaceId ?? '', nodeId, date: today, entries: 1, exits: 0, dropOffs: 0 })
    .onConflictDoUpdate({
      target: [schema.chatbotAnalytics.chatbotId, schema.chatbotAnalytics.nodeId, schema.chatbotAnalytics.date],
      set: {
        entries: (await import('drizzle-orm')).sql`${schema.chatbotAnalytics.entries} + 1`,
      },
    });
}

export async function recordNodeExit(chatbotId: string, nodeId: string, workspaceId?: string): Promise<void> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const today = new Date().toISOString().split('T')[0];
      await db
        .insert(schema.chatbotAnalytics)
        .values({ chatbotId, workspaceId, nodeId, date: today, entries: 0, exits: 1, dropOffs: 0 })
        .onConflictDoUpdate({
          target: [schema.chatbotAnalytics.chatbotId, schema.chatbotAnalytics.nodeId, schema.chatbotAnalytics.date],
          set: { exits: (await import('drizzle-orm')).sql`${schema.chatbotAnalytics.exits} + 1` },
        });
    });
    if (result !== null) return;
  }
  const ctx = await tryDb();
  if (!ctx) return;

  const { db, schema } = ctx;
  const today = new Date().toISOString().split('T')[0];

  await db
    .insert(schema.chatbotAnalytics)
    .values({ chatbotId, workspaceId: workspaceId ?? '', nodeId, date: today, entries: 0, exits: 1, dropOffs: 0 })
    .onConflictDoUpdate({
      target: [schema.chatbotAnalytics.chatbotId, schema.chatbotAnalytics.nodeId, schema.chatbotAnalytics.date],
      set: {
        exits: (await import('drizzle-orm')).sql`${schema.chatbotAnalytics.exits} + 1`,
      },
    });
}

export async function recordDropOff(chatbotId: string, nodeId: string, workspaceId?: string): Promise<void> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const today = new Date().toISOString().split('T')[0];
      await db
        .insert(schema.chatbotAnalytics)
        .values({ chatbotId, workspaceId, nodeId, date: today, entries: 0, exits: 0, dropOffs: 1 })
        .onConflictDoUpdate({
          target: [schema.chatbotAnalytics.chatbotId, schema.chatbotAnalytics.nodeId, schema.chatbotAnalytics.date],
          set: { dropOffs: (await import('drizzle-orm')).sql`${schema.chatbotAnalytics.dropOffs} + 1` },
        });
    });
    if (result !== null) return;
  }
  const ctx = await tryDb();
  if (!ctx) return;

  const { db, schema } = ctx;
  const today = new Date().toISOString().split('T')[0];

  await db
    .insert(schema.chatbotAnalytics)
    .values({ chatbotId, workspaceId: workspaceId ?? '', nodeId, date: today, entries: 0, exits: 0, dropOffs: 1 })
    .onConflictDoUpdate({
      target: [schema.chatbotAnalytics.chatbotId, schema.chatbotAnalytics.nodeId, schema.chatbotAnalytics.date],
      set: {
        dropOffs: (await import('drizzle-orm')).sql`${schema.chatbotAnalytics.dropOffs} + 1`,
      },
    });
}

export interface FlowAnalyticsRow {
  nodeId: string;
  date: string;
  entries: number;
  exits: number;
  dropOffs: number;
}

export async function getFlowAnalytics(
  chatbotId: string,
  days = 30,
  workspaceId?: string,
): Promise<FlowAnalyticsRow[]> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq, gte, and } = await import('drizzle-orm');
      const since = new Date();
      since.setDate(since.getDate() - days);
      const sinceStr = since.toISOString().split('T')[0];
      const rows = await db
        .select()
        .from(schema.chatbotAnalytics)
        .where(and(eq(schema.chatbotAnalytics.chatbotId, chatbotId), gte(schema.chatbotAnalytics.date, sinceStr)));
      return rows.map((r) => ({ nodeId: r.nodeId, date: r.date, entries: r.entries, exits: r.exits, dropOffs: r.dropOffs }));
    });
    if (result !== null) return result;
  }
  const ctx = await tryDb();
  if (!ctx) return [];

  const { db, schema } = ctx;
  const { eq, gte, and } = await import('drizzle-orm');
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];

  const rows = await db
    .select()
    .from(schema.chatbotAnalytics)
    .where(
      and(
        eq(schema.chatbotAnalytics.chatbotId, chatbotId),
        gte(schema.chatbotAnalytics.date, sinceStr),
      ),
    );

  return rows.map((r) => ({
    nodeId: r.nodeId,
    date: r.date,
    entries: r.entries,
    exits: r.exits,
    dropOffs: r.dropOffs,
  }));
}

export interface FlowSummary {
  totalSessions: number;
  completedSessions: number;
  abandonedSessions: number;
  handoffSessions: number;
  avgNodesPerSession: number;
  topDropOffNodes: Array<{ nodeId: string; dropOffs: number }>;
}

export async function getFlowSummary(chatbotId: string, days = 30): Promise<FlowSummary> {
  const analytics = await getFlowAnalytics(chatbotId, days);

  // Aggregate by node
  const nodeMap = new Map<string, { entries: number; exits: number; dropOffs: number }>();
  for (const row of analytics) {
    const existing = nodeMap.get(row.nodeId) ?? { entries: 0, exits: 0, dropOffs: 0 };
    existing.entries += row.entries;
    existing.exits += row.exits;
    existing.dropOffs += row.dropOffs;
    nodeMap.set(row.nodeId, existing);
  }

  const totalEntries = Array.from(nodeMap.values()).reduce((s, n) => s + n.entries, 0);
  const totalDropOffs = Array.from(nodeMap.values()).reduce((s, n) => s + n.dropOffs, 0);
  const totalExits = Array.from(nodeMap.values()).reduce((s, n) => s + n.exits, 0);

  const topDropOffNodes = Array.from(nodeMap.entries())
    .filter(([, v]) => v.dropOffs > 0)
    .sort((a, b) => b[1].dropOffs - a[1].dropOffs)
    .slice(0, 5)
    .map(([nodeId, v]) => ({ nodeId, dropOffs: v.dropOffs }));

  return {
    totalSessions: Math.max(totalEntries, 1),
    completedSessions: totalExits,
    abandonedSessions: totalDropOffs,
    handoffSessions: 0,
    avgNodesPerSession: totalEntries > 0 ? Math.round((totalEntries + totalExits) / Math.max(totalEntries, 1)) : 0,
    topDropOffNodes,
  };
}
