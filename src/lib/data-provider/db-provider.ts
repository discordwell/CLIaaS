/**
 * DbProvider — reads/writes via Drizzle + Postgres. Hosted or local DB backend.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type {
  DataProvider,
  ProviderCapabilities,
  Ticket,
  TicketSource,
  TicketStatus,
  TicketPriority,
  Message,
  KBArticle,
  Customer,
  Organization,
  RuleRecord,
  CSATRating,
  TicketCreateParams,
  TicketUpdateParams,
  MessageCreateParams,
  KBArticleCreateParams,
} from './types';

type DbContext = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  schema: typeof import('@/db/schema');
};

let _dbContextPromise: Promise<DbContext | null> | null = null;

async function getDbContext(): Promise<DbContext | null> {
  if (!process.env.DATABASE_URL) return null;
  if (!_dbContextPromise) {
    _dbContextPromise = (async () => {
      try {
        const [{ db }, schema] = await Promise.all([
          import('@/db'),
          import('@/db/schema'),
        ]);
        return { db, schema } as DbContext;
      } catch {
        _dbContextPromise = null;
        return null;
      }
    })();
  }
  return _dbContextPromise;
}

async function getWorkspaceId(
  db: DbContext['db'],
  schema: DbContext['schema'],
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

async function requireDb(): Promise<{ db: DbContext['db']; schema: DbContext['schema']; workspaceId: string }> {
  const ctx = await getDbContext();
  if (!ctx) throw new Error('Database not configured. Set DATABASE_URL.');
  const workspaceId = await getWorkspaceId(ctx.db, ctx.schema);
  if (!workspaceId) throw new Error('No workspace found.');
  return { ...ctx, workspaceId };
}

export class DbProvider implements DataProvider {
  readonly capabilities: ProviderCapabilities = {
    mode: 'db',
    supportsWrite: true,
    supportsSync: true,
    supportsRag: !!process.env.RAG_DATABASE_URL || !!process.env.DATABASE_URL,
  };

  async loadTickets(): Promise<Ticket[]> {
    const { db, schema, workspaceId } = await requireDb();

    const rows: Array<{
      id: string; subject: string; status: string; priority: string;
      source: string | null; createdAt: Date; updatedAt: Date;
      assigneeName: string | null; assigneeEmail: string | null;
      requesterName: string | null; requesterEmail: string | null;
    }> = await db
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

    return rows.map(row => ({
      id: row.id,
      externalId: externalById.get(row.id) ?? row.id.slice(0, 8),
      source: (row.source ?? 'zendesk') as TicketSource,
      subject: row.subject,
      status: row.status as TicketStatus,
      priority: row.priority as TicketPriority,
      assignee: row.assigneeName ?? row.assigneeEmail ?? undefined,
      requester: row.requesterEmail ?? row.requesterName ?? 'unknown',
      tags: tagsByTicket.get(row.id) ?? [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async loadMessages(ticketId?: string): Promise<Message[]> {
    const { db, schema, workspaceId } = await requireDb();

    const conditions = [eq(schema.tickets.workspaceId, workspaceId)];
    if (ticketId) conditions.push(eq(schema.tickets.id, ticketId));

    const rows: Array<{
      id: string; ticketId: string; authorType: string; authorId: string | null;
      body: string; visibility: string | null; createdAt: Date;
    }> = await db
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
      const userRows: Array<{ id: string; name: string | null; email: string | null }> = await db
        .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
        .from(schema.users)
        .where(inArray(schema.users.id, Array.from(userIds)));
      for (const row of userRows) {
        userMap.set(row.id, row.name ?? row.email ?? row.id);
      }
    }

    const customerMap = new Map<string, string>();
    if (customerIds.size > 0) {
      const customerRows: Array<{ id: string; name: string | null; email: string | null }> = await db
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
        ? 'system' as const
        : row.visibility === 'internal'
          ? 'note' as const
          : 'reply' as const;

      return { id: row.id, ticketId: row.ticketId, author, body: row.body, type, createdAt: row.createdAt.toISOString() };
    });
  }

  async loadKBArticles(): Promise<KBArticle[]> {
    const { db, schema, workspaceId } = await requireDb();

    const rows: Array<{
      id: string; title: string; body: string; categoryPath: string[] | null;
      status: string; updatedAt: Date;
    }> = await db
      .select({
        id: schema.kbArticles.id,
        title: schema.kbArticles.title,
        body: schema.kbArticles.body,
        categoryPath: schema.kbArticles.categoryPath,
        status: schema.kbArticles.status,
        updatedAt: schema.kbArticles.updatedAt,
      })
      .from(schema.kbArticles)
      .where(eq(schema.kbArticles.workspaceId, workspaceId));

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      body: row.body,
      categoryPath: row.categoryPath ?? [],
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async loadCustomers(): Promise<Customer[]> {
    const { db, schema, workspaceId } = await requireDb();

    const rows = await db
      .select({
        id: schema.customers.id,
        name: schema.customers.name,
        email: schema.customers.email,
        createdAt: schema.customers.createdAt,
      })
      .from(schema.customers)
      .where(eq(schema.customers.workspaceId, workspaceId));

    return rows.map((r: { id: string; name: string; email: string | null; createdAt: Date }) => ({
      id: r.id,
      name: r.name,
      email: r.email ?? '',
      source: 'zendesk' as const,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async loadOrganizations(): Promise<Organization[]> {
    const { db, schema, workspaceId } = await requireDb();

    const rows = await db
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
      })
      .from(schema.organizations)
      .where(eq(schema.organizations.workspaceId, workspaceId));

    return rows.map((r: { id: string; name: string }) => ({
      id: r.id,
      name: r.name,
      source: 'zendesk' as const,
    }));
  }

  async loadRules(): Promise<RuleRecord[]> {
    const { db, schema, workspaceId } = await requireDb();

    const rows = await db
      .select({
        id: schema.rules.id,
        type: schema.rules.type,
        name: schema.rules.name,
        enabled: schema.rules.enabled,
        conditions: schema.rules.conditions,
        actions: schema.rules.actions,
        source: schema.rules.source,
      })
      .from(schema.rules)
      .where(eq(schema.rules.workspaceId, workspaceId));

    return rows.map((r: { id: string; type: string; name: string; enabled: boolean; conditions: unknown; actions: unknown; source: string | null }) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      enabled: r.enabled,
      conditions: r.conditions,
      actions: r.actions,
      source: r.source ?? 'zendesk',
    }));
  }

  async loadCSATRatings(): Promise<CSATRating[]> {
    const { db, schema, workspaceId } = await requireDb();

    const rows = await db
      .select({
        ticketId: schema.csatRatings.ticketId,
        rating: schema.csatRatings.rating,
        createdAt: schema.csatRatings.createdAt,
      })
      .from(schema.csatRatings)
      .innerJoin(schema.tickets, eq(schema.tickets.id, schema.csatRatings.ticketId))
      .where(eq(schema.tickets.workspaceId, workspaceId));

    return rows.map((r: { ticketId: string; rating: number; createdAt: Date }) => ({
      ticketId: r.ticketId,
      rating: r.rating,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async createTicket(params: TicketCreateParams): Promise<{ id: string }> {
    const { db, schema, workspaceId } = await requireDb();

    const [row] = await db
      .insert(schema.tickets)
      .values({
        workspaceId,
        subject: params.subject,
        description: params.description ?? '',
        priority: params.priority ?? 'normal',
        status: 'open',
        tags: params.tags ?? [],
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: schema.tickets.id });

    return { id: row.id };
  }

  async updateTicket(ticketId: string, params: TicketUpdateParams): Promise<void> {
    const { db, schema } = await requireDb();

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (params.status !== undefined) set.status = params.status;
    if (params.priority !== undefined) set.priority = params.priority;
    if (params.subject !== undefined) set.subject = params.subject;

    await db.update(schema.tickets).set(set).where(eq(schema.tickets.id, ticketId));
  }

  async createMessage(params: MessageCreateParams): Promise<{ id: string }> {
    const { db, schema } = await requireDb();

    const convRows = await db
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(eq(schema.conversations.ticketId, params.ticketId))
      .limit(1);

    let conversationId = convRows[0]?.id;
    if (!conversationId) {
      const [convRow] = await db
        .insert(schema.conversations)
        .values({
          ticketId: params.ticketId,
          channelType: 'email',
          startedAt: new Date(),
          lastActivityAt: new Date(),
        })
        .returning({ id: schema.conversations.id });
      conversationId = convRow.id;
    }

    const [row] = await db
      .insert(schema.messages)
      .values({
        conversationId,
        authorType: params.authorType ?? 'system',
        authorId: params.authorId ?? null,
        body: params.body,
        visibility: params.visibility ?? 'public',
        createdAt: new Date(),
      })
      .returning({ id: schema.messages.id });

    return { id: row.id };
  }

  async createKBArticle(params: KBArticleCreateParams): Promise<{ id: string }> {
    const { db, schema, workspaceId } = await requireDb();

    const [row] = await db
      .insert(schema.kbArticles)
      .values({
        workspaceId,
        title: params.title.trim(),
        body: params.body.trim(),
        categoryPath: params.categoryPath ?? [],
        status: params.status ?? 'published',
      })
      .returning({ id: schema.kbArticles.id });

    return { id: row.id };
  }
}
