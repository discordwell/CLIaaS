import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { and, eq, inArray } from 'drizzle-orm';

// Canonical types (subset for web display)
export interface Ticket {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove';
  subject: string;
  status: string;
  priority: string;
  assignee?: string | null;
  requester: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  ticketId: string;
  author: string;
  body: string;
  type: 'reply' | 'note' | 'system';
  createdAt: string;
}

export interface KBArticle {
  id: string;
  title: string;
  body: string;
  categoryPath: string[];
}

export interface TicketStats {
  total: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byAssignee: Record<string, number>;
  topTags: Array<{ tag: string; count: number }>;
  recentTickets: Ticket[];
}

type DbContext = {
  db: any;
  schema: typeof import('@/db/schema');
};

function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  const results: T[] = [];
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      results.push(JSON.parse(line) as T);
    } catch {
      // Skip malformed lines
    }
  }
  return results;
}

const EXPORT_DIRS = [
  '/tmp/cliaas-demo',
  './exports/zendesk',
  './exports/kayako',
  './exports/kayako-classic',
  './exports/helpcrunch',
  './exports/freshdesk',
  './exports/groove',
  './exports',
];

export function findExportDir(): string | null {
  for (const dir of EXPORT_DIRS) {
    if (existsSync(join(dir, 'manifest.json'))) return dir;
  }
  return null;
}

function findAllExportDirs(): string[] {
  return EXPORT_DIRS.filter(dir => existsSync(join(dir, 'manifest.json')));
}

function loadAllFromDirs<T>(filename: string): T[] {
  const dirs = findAllExportDirs();
  const seen = new Set<string>();
  const results: T[] = [];

  for (const dir of dirs) {
    for (const item of readJsonl<T & { id?: string }>(join(dir, filename))) {
      const key = item.id ?? JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        results.push(item);
      }
    }
  }
  return results;
}

async function getDbContext(): Promise<DbContext | null> {
  if (!process.env.DATABASE_URL) return null;
  const [{ db }, schema] = await Promise.all([
    import('@/db'),
    import('@/db/schema'),
  ]);
  return { db, schema };
}

async function getWorkspaceId(
  db: DbContext['db'],
  schema: DbContext['schema']
): Promise<string | null> {
  const workspaceName = process.env.CLIAAS_WORKSPACE;
  if (workspaceName) {
    const byName = await db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.name, workspaceName))
      .limit(1);
    if (byName[0]) return byName[0].id;
  }

  const rows = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .orderBy(schema.workspaces.createdAt)
    .limit(1);
  return rows[0]?.id ?? null;
}

async function loadTicketsFromDb(): Promise<Ticket[]> {
  const ctx = await getDbContext();
  if (!ctx) return [];
  const { db, schema } = ctx;
  const workspaceId = await getWorkspaceId(db, schema);
  if (!workspaceId) return [];

  const rows = await db
    .select({
      id: schema.tickets.id,
      subject: schema.tickets.subject,
      status: schema.tickets.status,
      priority: schema.tickets.priority,
      source: schema.tickets.source,
      createdAt: schema.tickets.createdAt,
      updatedAt: schema.tickets.updatedAt,
      assigneeName: schema.users.name,
      assigneeEmail: schema.users.email,
      requesterName: schema.customers.name,
      requesterEmail: schema.customers.email,
    })
    .from(schema.tickets)
    .leftJoin(schema.users, eq(schema.users.id, schema.tickets.assigneeId))
    .leftJoin(schema.customers, eq(schema.customers.id, schema.tickets.requesterId))
    .where(eq(schema.tickets.workspaceId, workspaceId));

  if (rows.length === 0) return [];

  const ticketIds = rows.map(row => row.id);
  const externalRows = await db
    .select({
      internalId: schema.externalObjects.internalId,
      externalId: schema.externalObjects.externalId,
    })
    .from(schema.externalObjects)
    .where(
      and(
        eq(schema.externalObjects.objectType, 'ticket'),
        inArray(schema.externalObjects.internalId, ticketIds),
      ),
    );
  const externalById = new Map<string, string>();
  for (const row of externalRows) {
    if (row.externalId) externalById.set(row.internalId, row.externalId);
  }

  const tagRows = await db
    .select({
      ticketId: schema.ticketTags.ticketId,
      name: schema.tags.name,
    })
    .from(schema.ticketTags)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.ticketTags.tagId))
    .where(inArray(schema.ticketTags.ticketId, ticketIds));
  const tagsByTicket = new Map<string, string[]>();
  for (const row of tagRows) {
    const existing = tagsByTicket.get(row.ticketId) ?? [];
    existing.push(row.name);
    tagsByTicket.set(row.ticketId, existing);
  }

  return rows.map(row => {
    const requester = row.requesterEmail ?? row.requesterName ?? 'unknown';
    const assignee = row.assigneeName ?? row.assigneeEmail ?? null;
    return {
      id: row.id,
      externalId: externalById.get(row.id) ?? row.id.slice(0, 8),
      source: row.source ?? 'zendesk',
      subject: row.subject,
      status: row.status,
      priority: row.priority,
      assignee,
      requester,
      tags: tagsByTicket.get(row.id) ?? [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

async function loadMessagesFromDb(ticketId?: string): Promise<Message[]> {
  const ctx = await getDbContext();
  if (!ctx) return [];
  const { db, schema } = ctx;
  const workspaceId = await getWorkspaceId(db, schema);
  if (!workspaceId) return [];

  const conditions = [eq(schema.tickets.workspaceId, workspaceId)];
  if (ticketId) conditions.push(eq(schema.tickets.id, ticketId));

  const rows = await db
    .select({
      id: schema.messages.id,
      ticketId: schema.tickets.id,
      authorType: schema.messages.authorType,
      authorId: schema.messages.authorId,
      body: schema.messages.body,
      visibility: schema.messages.visibility,
      createdAt: schema.messages.createdAt,
    })
    .from(schema.messages)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
    .innerJoin(schema.tickets, eq(schema.tickets.id, schema.conversations.ticketId))
    .where(and(...conditions));

  if (rows.length === 0) return [];

  const userIds = new Set<string>();
  const customerIds = new Set<string>();
  for (const row of rows) {
    if (!row.authorId) continue;
    if (row.authorType === 'user') userIds.add(row.authorId);
    if (row.authorType === 'customer') customerIds.add(row.authorId);
  }

  const userMap = new Map<string, string>();
  if (userIds.size > 0) {
    const userRows = await db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(inArray(schema.users.id, Array.from(userIds)));
    for (const row of userRows) {
      userMap.set(row.id, row.name ?? row.email ?? row.id);
    }
  }

  const customerMap = new Map<string, string>();
  if (customerIds.size > 0) {
    const customerRows = await db
      .select({ id: schema.customers.id, name: schema.customers.name, email: schema.customers.email })
      .from(schema.customers)
      .where(inArray(schema.customers.id, Array.from(customerIds)));
    for (const row of customerRows) {
      customerMap.set(row.id, row.email ?? row.name ?? row.id);
    }
  }

  return rows.map(row => {
    const author = row.authorId
      ? row.authorType === 'user'
        ? userMap.get(row.authorId) ?? row.authorId
        : row.authorType === 'customer'
          ? customerMap.get(row.authorId) ?? row.authorId
          : row.authorType
      : row.authorType;

    const type = row.authorType === 'system' || row.authorType === 'bot'
      ? 'system'
      : row.visibility === 'internal'
        ? 'note'
        : 'reply';

    return {
      id: row.id,
      ticketId: row.ticketId,
      author,
      body: row.body,
      type,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

async function loadKBArticlesFromDb(): Promise<KBArticle[]> {
  const ctx = await getDbContext();
  if (!ctx) return [];
  const { db, schema } = ctx;
  const workspaceId = await getWorkspaceId(db, schema);
  if (!workspaceId) return [];

  const rows = await db
    .select({
      id: schema.kbArticles.id,
      title: schema.kbArticles.title,
      body: schema.kbArticles.body,
      categoryPath: schema.kbArticles.categoryPath,
    })
    .from(schema.kbArticles)
    .where(eq(schema.kbArticles.workspaceId, workspaceId));

  return rows.map(row => ({
    id: row.id,
    title: row.title,
    body: row.body,
    categoryPath: row.categoryPath ?? [],
  }));
}

export async function loadTickets(): Promise<Ticket[]> {
  if (process.env.DATABASE_URL) {
    return loadTicketsFromDb();
  }
  return loadAllFromDirs<Ticket>('tickets.jsonl');
}

export async function loadMessages(ticketId?: string): Promise<Message[]> {
  if (process.env.DATABASE_URL) {
    return loadMessagesFromDb(ticketId);
  }
  const messages = loadAllFromDirs<Message>('messages.jsonl');
  return ticketId ? messages.filter(m => m.ticketId === ticketId) : messages;
}

export async function loadKBArticles(): Promise<KBArticle[]> {
  if (process.env.DATABASE_URL) {
    return loadKBArticlesFromDb();
  }
  return loadAllFromDirs<KBArticle>('kb_articles.jsonl');
}

export function computeStats(tickets: Ticket[]): TicketStats {
  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  const byAssignee: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};

  for (const t of tickets) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
    const assignee = t.assignee ?? 'unassigned';
    byAssignee[assignee] = (byAssignee[assignee] ?? 0) + 1;
    for (const tag of t.tags) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    }
  }

  const topTags = Object.entries(tagCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  const recentTickets = [...tickets]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  return { total: tickets.length, byStatus, byPriority, byAssignee, topTags, recentTickets };
}
