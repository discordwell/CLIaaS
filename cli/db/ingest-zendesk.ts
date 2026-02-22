import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { and, eq } from 'drizzle-orm';
import type { Ticket, Message, Customer, Organization, KBArticle, Rule } from '../schema/types.js';
import { db, pool } from '../../src/db/index.js';
import {
  tenants,
  workspaces,
  integrations,
  externalObjects,
  rawRecords,
  organizations,
  customers,
  users,
  tickets,
  conversations,
  messages,
  tags,
  ticketTags,
  kbArticles,
  rules,
} from '../../src/db/schema.js';

interface IngestOptions {
  dir: string;
  tenant: string;
  workspace: string;
}

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

async function getOrCreateTenant(name: string): Promise<string> {
  const existing = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.name, name))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const [row] = await db.insert(tenants).values({ name }).returning({ id: tenants.id });
  return row.id;
}

async function getOrCreateWorkspace(tenantId: string, name: string): Promise<string> {
  const existing = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.tenantId, tenantId), eq(workspaces.name, name)))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const [row] = await db
    .insert(workspaces)
    .values({ tenantId, name, timezone: 'UTC' })
    .returning({ id: workspaces.id });
  return row.id;
}

async function getOrCreateIntegration(workspaceId: string): Promise<string> {
  const existing = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, 'zendesk')))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const [row] = await db
    .insert(integrations)
    .values({ workspaceId, provider: 'zendesk', status: 'active' })
    .returning({ id: integrations.id });
  return row.id;
}

async function findExternalInternalId(integrationId: string, objectType: string, externalId: string): Promise<string | null> {
  const existing = await db
    .select({ internalId: externalObjects.internalId })
    .from(externalObjects)
    .where(
      and(
        eq(externalObjects.integrationId, integrationId),
        eq(externalObjects.objectType, objectType),
        eq(externalObjects.externalId, externalId),
      ),
    )
    .limit(1);
  return existing[0]?.internalId ?? null;
}

async function upsertExternalObject(
  integrationId: string,
  objectType: string,
  externalId: string,
  internalId: string,
): Promise<void> {
  await db
    .insert(externalObjects)
    .values({
      integrationId,
      objectType,
      externalId,
      internalId,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [externalObjects.integrationId, externalObjects.objectType, externalObjects.externalId],
      set: { internalId, lastSeenAt: new Date() },
    });
}

async function upsertRawRecord(
  integrationId: string,
  objectType: string,
  externalId: string | undefined,
  payload: unknown,
): Promise<void> {
  await db
    .insert(rawRecords)
    .values({ integrationId, objectType, externalId, payload, receivedAt: new Date() })
    .onConflictDoUpdate({
      target: [rawRecords.integrationId, rawRecords.objectType, rawRecords.externalId],
      set: { payload, receivedAt: new Date() },
    });
}

export async function ingestZendeskToDb(opts: IngestOptions): Promise<void> {
  const manifestPath = join(opts.dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing manifest.json in ${opts.dir}`);
  }

  const ticketsData = readJsonl<Ticket>(join(opts.dir, 'tickets.jsonl'));
  const messagesData = readJsonl<Message>(join(opts.dir, 'messages.jsonl'));
  const customersData = readJsonl<Customer>(join(opts.dir, 'customers.jsonl'));
  const orgsData = readJsonl<Organization>(join(opts.dir, 'organizations.jsonl'));
  const kbData = readJsonl<KBArticle>(join(opts.dir, 'kb_articles.jsonl'));
  const rulesData = readJsonl<Rule>(join(opts.dir, 'rules.jsonl'));

  const tenantId = await getOrCreateTenant(opts.tenant);
  const workspaceId = await getOrCreateWorkspace(tenantId, opts.workspace);
  const integrationId = await getOrCreateIntegration(workspaceId);

  const agentExternalIds = new Set<string>();
  for (const t of ticketsData) {
    if (t.assignee) agentExternalIds.add(t.assignee);
  }
  for (const m of messagesData) {
    if (m.type === 'note') agentExternalIds.add(m.author);
  }

  const orgIdByExternal = new Map<string, string>();
  const customerIdByExternal = new Map<string, string>();
  const userIdByExternal = new Map<string, string>();
  const ticketIdByCanonical = new Map<string, string>();
  const conversationIdByTicket = new Map<string, string>();
  const tagIdByName = new Map<string, string>();

  const orgSpinner = ora('Upserting organizations...').start();
  for (const org of orgsData) {
    await upsertRawRecord(integrationId, 'organization', org.externalId, org);
    const existingId = await findExternalInternalId(integrationId, 'organization', org.externalId);
    if (existingId) {
      await db
        .update(organizations)
        .set({ name: org.name, domains: org.domains ?? [], updatedAt: new Date() })
        .where(eq(organizations.id, existingId));
      orgIdByExternal.set(org.externalId, existingId);
      continue;
    }
    const [row] = await db
      .insert(organizations)
      .values({
        workspaceId,
        name: org.name,
        domains: org.domains ?? [],
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: organizations.id });
    await upsertExternalObject(integrationId, 'organization', org.externalId, row.id);
    orgIdByExternal.set(org.externalId, row.id);
  }
  orgSpinner.succeed(`${orgsData.length} organizations`);

  const customerSpinner = ora('Upserting customers...').start();
  for (const customer of customersData) {
    await upsertRawRecord(integrationId, 'customer', customer.externalId, customer);
    const orgId = customer.orgId ? orgIdByExternal.get(customer.orgId) : undefined;
    const existingId = await findExternalInternalId(integrationId, 'customer', customer.externalId);
    if (existingId) {
      await db
        .update(customers)
        .set({
          name: customer.name,
          email: customer.email ?? null,
          phone: customer.phone ?? null,
          orgId,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, existingId));
      customerIdByExternal.set(customer.externalId, existingId);
    } else {
      const [row] = await db
        .insert(customers)
        .values({
          workspaceId,
          externalRef: customer.externalId,
          name: customer.name,
          email: customer.email ?? null,
          phone: customer.phone ?? null,
          orgId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: customers.id });
      await upsertExternalObject(integrationId, 'customer', customer.externalId, row.id);
      customerIdByExternal.set(customer.externalId, row.id);
    }

    if (agentExternalIds.has(customer.externalId)) {
      const existingUserId = await findExternalInternalId(integrationId, 'user', customer.externalId);
      if (existingUserId) {
        await db
          .update(users)
          .set({
            name: customer.name,
            email: customer.email ?? null,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existingUserId));
        userIdByExternal.set(customer.externalId, existingUserId);
      } else {
        const [userRow] = await db
          .insert(users)
          .values({
            workspaceId,
            name: customer.name,
            email: customer.email ?? null,
            role: 'agent',
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning({ id: users.id });
        await upsertExternalObject(integrationId, 'user', customer.externalId, userRow.id);
        userIdByExternal.set(customer.externalId, userRow.id);
      }
    }
  }
  customerSpinner.succeed(`${customersData.length} customers`);

  const existingTags = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.workspaceId, workspaceId));
  for (const tag of existingTags) {
    tagIdByName.set(tag.name, tag.id);
  }

  const ticketSpinner = ora('Upserting tickets...').start();
  for (const ticket of ticketsData) {
    await upsertRawRecord(integrationId, 'ticket', ticket.externalId, ticket);
    const existingId = await findExternalInternalId(integrationId, 'ticket', ticket.externalId);
    const requesterId = customerIdByExternal.get(ticket.requester);
    const assigneeId = ticket.assignee ? userIdByExternal.get(ticket.assignee) : undefined;

    if (existingId) {
      await db
        .update(tickets)
        .set({
          subject: ticket.subject,
          status: ticket.status,
          priority: ticket.priority,
          requesterId,
          assigneeId,
          customFields: ticket.customFields ?? null,
          updatedAt: new Date(ticket.updatedAt),
        })
        .where(eq(tickets.id, existingId));
      ticketIdByCanonical.set(ticket.id, existingId);
    } else {
      const [row] = await db
        .insert(tickets)
        .values({
          workspaceId,
          requesterId,
          assigneeId,
          subject: ticket.subject,
          status: ticket.status,
          priority: ticket.priority,
          source: 'zendesk',
          customFields: ticket.customFields ?? null,
          createdAt: new Date(ticket.createdAt),
          updatedAt: new Date(ticket.updatedAt),
        })
        .returning({ id: tickets.id });
      await upsertExternalObject(integrationId, 'ticket', ticket.externalId, row.id);
      ticketIdByCanonical.set(ticket.id, row.id);
    }

    const ticketId = ticketIdByCanonical.get(ticket.id);
    if (!ticketId) continue;

    const existingConversation = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.ticketId, ticketId))
      .limit(1);
    if (existingConversation[0]) {
      conversationIdByTicket.set(ticket.id, existingConversation[0].id);
    } else {
      const [convRow] = await db
        .insert(conversations)
        .values({
          ticketId,
          channelType: 'email',
          startedAt: new Date(ticket.createdAt),
          lastActivityAt: new Date(ticket.updatedAt),
        })
        .returning({ id: conversations.id });
      conversationIdByTicket.set(ticket.id, convRow.id);
    }

    for (const tagName of ticket.tags ?? []) {
      const trimmed = tagName.trim();
      if (!trimmed) continue;
      let tagId = tagIdByName.get(trimmed);
      if (!tagId) {
        const [tagRow] = await db
          .insert(tags)
          .values({ workspaceId, name: trimmed })
          .onConflictDoNothing()
          .returning({ id: tags.id });
        if (tagRow?.id) {
          tagId = tagRow.id;
        } else {
          const existingTag = await db
            .select({ id: tags.id })
            .from(tags)
            .where(and(eq(tags.workspaceId, workspaceId), eq(tags.name, trimmed)))
            .limit(1);
          tagId = existingTag[0]?.id;
        }
        if (tagId) tagIdByName.set(trimmed, tagId);
      }
      if (tagId) {
        await db.insert(ticketTags).values({ ticketId, tagId }).onConflictDoNothing();
      }
    }
  }
  ticketSpinner.succeed(`${ticketsData.length} tickets`);

  const messageSpinner = ora('Upserting messages...').start();
  for (const message of messagesData) {
    await upsertRawRecord(integrationId, 'message', message.id, message);
    const ticketId = ticketIdByCanonical.get(message.ticketId);
    if (!ticketId) continue;
    const conversationId = conversationIdByTicket.get(message.ticketId);
    if (!conversationId) continue;

    const existingId = await findExternalInternalId(integrationId, 'message', message.id);
    const authorUserId = userIdByExternal.get(message.author);
    const authorCustomerId = customerIdByExternal.get(message.author);
    const authorType = authorUserId ? 'user' : authorCustomerId ? 'customer' : 'system';
    const authorId = authorUserId ?? authorCustomerId ?? null;
    const visibility = message.type === 'note' ? 'internal' : 'public';

    if (existingId) {
      await db
        .update(messages)
        .set({
          conversationId,
          authorType,
          authorId,
          body: message.body,
          bodyHtml: message.bodyHtml ?? null,
          visibility,
          createdAt: new Date(message.createdAt),
        })
        .where(eq(messages.id, existingId));
    } else {
      const [row] = await db
        .insert(messages)
        .values({
          conversationId,
          authorType,
          authorId,
          body: message.body,
          bodyHtml: message.bodyHtml ?? null,
          visibility,
          createdAt: new Date(message.createdAt),
        })
        .returning({ id: messages.id });
      await upsertExternalObject(integrationId, 'message', message.id, row.id);
    }
  }
  messageSpinner.succeed(`${messagesData.length} messages`);

  const kbSpinner = ora('Upserting KB articles...').start();
  for (const article of kbData) {
    await upsertRawRecord(integrationId, 'kb_article', article.externalId, article);
    const existingId = await findExternalInternalId(integrationId, 'kb_article', article.externalId);
    if (existingId) {
      await db
        .update(kbArticles)
        .set({
          title: article.title,
          body: article.body,
          categoryPath: article.categoryPath ?? null,
          updatedAt: new Date(),
        })
        .where(eq(kbArticles.id, existingId));
      continue;
    }
    const [row] = await db
      .insert(kbArticles)
      .values({
        workspaceId,
        title: article.title,
        body: article.body,
        categoryPath: article.categoryPath ?? null,
        source: 'zendesk',
        updatedAt: new Date(),
      })
      .returning({ id: kbArticles.id });
    await upsertExternalObject(integrationId, 'kb_article', article.externalId, row.id);
  }
  kbSpinner.succeed(`${kbData.length} KB articles`);

  const ruleSpinner = ora('Upserting rules...').start();
  for (const rule of rulesData) {
    await upsertRawRecord(integrationId, 'rule', rule.externalId, rule);
    const existingId = await findExternalInternalId(integrationId, 'rule', rule.externalId);
    if (existingId) {
      await db
        .update(rules)
        .set({
          name: rule.title,
          type: rule.type,
          enabled: rule.active,
          conditions: rule.conditions ?? null,
          actions: rule.actions ?? null,
          updatedAt: new Date(),
        })
        .where(eq(rules.id, existingId));
      continue;
    }
    const [row] = await db
      .insert(rules)
      .values({
        workspaceId,
        name: rule.title,
        type: rule.type,
        enabled: rule.active,
        conditions: rule.conditions ?? null,
        actions: rule.actions ?? null,
        source: 'zendesk',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: rules.id });
    await upsertExternalObject(integrationId, 'rule', rule.externalId, row.id);
  }
  ruleSpinner.succeed(`${rulesData.length} rules`);

  console.log(chalk.green('\nZendesk ingest complete.'));
  console.log(chalk.gray(`  Workspace: ${opts.workspace} (${workspaceId})`));
  console.log(chalk.gray(`  Tickets:   ${ticketsData.length}`));
  console.log(chalk.gray(`  Messages:  ${messagesData.length}`));
  console.log(chalk.gray(`  Customers: ${customersData.length}`));
  console.log(chalk.gray(`  Orgs:      ${orgsData.length}`));
  console.log(chalk.gray(`  KB:        ${kbData.length}`));
  console.log(chalk.gray(`  Rules:     ${rulesData.length}`));
}

export async function runZendeskIngest(opts: IngestOptions): Promise<void> {
  try {
    await ingestZendeskToDb(opts);
  } finally {
    await pool.end();
  }
}
