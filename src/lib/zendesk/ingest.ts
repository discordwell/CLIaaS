import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  tenants,
  workspaces,
  integrations,
  externalObjects,
  rawRecords,
  groups,
  organizations,
  customers,
  users,
  tickets,
  conversations,
  messages,
  attachments,
  tags,
  ticketTags,
  kbArticles,
  customFields,
  views,
  slaPolicies,
  ticketForms,
  brands,
  auditEvents,
  csatRatings,
  timeEntries,
  rules,
} from '@/db/schema';
import type {
  Ticket,
  Message,
  Customer,
  Organization,
  KBArticle,
  Rule,
  Group,
  CustomField,
  View,
  SLAPolicy,
  TicketForm,
  Brand,
  AuditEvent,
  CSATRating,
  TimeEntry,
} from './types';

export interface IngestOptions {
  dir: string;
  tenant: string;
  workspace: string;
}

export interface IngestData {
  tickets: Ticket[];
  messages: Message[];
  customers: Customer[];
  organizations: Organization[];
  kbArticles: KBArticle[];
  rules: Rule[];
  groups: Group[];
  customFields: CustomField[];
  views: View[];
  slaPolicies: SLAPolicy[];
  ticketForms: TicketForm[];
  brands: Brand[];
  auditEvents: AuditEvent[];
  csatRatings: CSATRating[];
  timeEntries: TimeEntry[];
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

export async function ensureZendeskContext(opts: { tenant: string; workspace: string }): Promise<{ workspaceId: string; integrationId: string }> {
  const tenantId = await getOrCreateTenant(opts.tenant);
  const workspaceId = await getOrCreateWorkspace(tenantId, opts.workspace);
  const integrationId = await getOrCreateIntegration(workspaceId);
  return { workspaceId, integrationId };
}

export async function ingestZendeskExportDir(opts: IngestOptions): Promise<void> {
  const manifestPath = join(opts.dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing manifest.json in ${opts.dir}`);
  }

  const data: IngestData = {
    tickets: readJsonl<Ticket>(join(opts.dir, 'tickets.jsonl')),
    messages: readJsonl<Message>(join(opts.dir, 'messages.jsonl')),
    customers: readJsonl<Customer>(join(opts.dir, 'customers.jsonl')),
    organizations: readJsonl<Organization>(join(opts.dir, 'organizations.jsonl')),
    kbArticles: readJsonl<KBArticle>(join(opts.dir, 'kb_articles.jsonl')),
    rules: readJsonl<Rule>(join(opts.dir, 'rules.jsonl')),
    groups: readJsonl<Group>(join(opts.dir, 'groups.jsonl')),
    customFields: readJsonl<CustomField>(join(opts.dir, 'custom_fields.jsonl')),
    views: readJsonl<View>(join(opts.dir, 'views.jsonl')),
    slaPolicies: readJsonl<SLAPolicy>(join(opts.dir, 'sla_policies.jsonl')),
    ticketForms: readJsonl<TicketForm>(join(opts.dir, 'ticket_forms.jsonl')),
    brands: readJsonl<Brand>(join(opts.dir, 'brands.jsonl')),
    auditEvents: readJsonl<AuditEvent>(join(opts.dir, 'audit_events.jsonl')),
    csatRatings: readJsonl<CSATRating>(join(opts.dir, 'csat_ratings.jsonl')),
    timeEntries: readJsonl<TimeEntry>(join(opts.dir, 'time_entries.jsonl')),
  };

  await ingestZendeskData({ tenant: opts.tenant, workspace: opts.workspace, data });
}

export async function ingestZendeskData(opts: { tenant: string; workspace: string; data: IngestData }): Promise<void> {
  const { workspaceId, integrationId } = await ensureZendeskContext({ tenant: opts.tenant, workspace: opts.workspace });

  const {
    tickets: ticketsData,
    messages: messagesData,
    customers: customersData,
    organizations: orgsData,
    kbArticles: kbData,
    rules: rulesData,
    groups: groupsData,
    customFields: fieldsData,
    views: viewsData,
    slaPolicies: slaPoliciesData,
    ticketForms: ticketFormsData,
    brands: brandsData,
    auditEvents: auditEventsData,
    csatRatings: csatRatingsData,
    timeEntries: timeEntriesData,
  } = opts.data;

  const agentExternalIds = new Set<string>();
  for (const t of ticketsData) {
    if (t.assignee) agentExternalIds.add(t.assignee);
  }
  for (const m of messagesData) {
    if (m.type === 'note') agentExternalIds.add(m.author);
  }

  const orgIdByExternal = new Map<string, string>();
  const groupIdByExternal = new Map<string, string>();
  const brandIdByExternal = new Map<string, string>();
  const ticketFormIdByExternal = new Map<string, string>();
  const customerIdByExternal = new Map<string, string>();
  const userIdByExternal = new Map<string, string>();
  const ticketIdByCanonical = new Map<string, string>();
  const conversationIdByTicket = new Map<string, string>();
  const tagIdByName = new Map<string, string>();

  for (const group of groupsData) {
    await upsertRawRecord(integrationId, 'group', group.externalId, group);
    const existingId = await findExternalInternalId(integrationId, 'group', group.externalId);
    if (existingId) {
      await db
        .update(groups)
        .set({ name: group.name, updatedAt: new Date() })
        .where(eq(groups.id, existingId));
      groupIdByExternal.set(group.externalId, existingId);
      continue;
    }
    const [row] = await db
      .insert(groups)
      .values({ workspaceId, name: group.name, createdAt: new Date(), updatedAt: new Date() })
      .returning({ id: groups.id });
    await upsertExternalObject(integrationId, 'group', group.externalId, row.id);
    groupIdByExternal.set(group.externalId, row.id);
  }

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

  for (const brand of brandsData) {
    await upsertRawRecord(integrationId, 'brand', brand.externalId, brand);
    const existingId = await findExternalInternalId(integrationId, 'brand', brand.externalId);
    if (existingId) {
      await db
        .update(brands)
        .set({
          name: brand.name,
          raw: brand.raw ?? null,
          updatedAt: new Date(),
        })
        .where(eq(brands.id, existingId));
      brandIdByExternal.set(brand.externalId, existingId);
      continue;
    }
    const [row] = await db
      .insert(brands)
      .values({
        workspaceId,
        name: brand.name,
        raw: brand.raw ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: brands.id });
    await upsertExternalObject(integrationId, 'brand', brand.externalId, row.id);
    brandIdByExternal.set(brand.externalId, row.id);
  }

  for (const form of ticketFormsData) {
    await upsertRawRecord(integrationId, 'ticket_form', form.externalId, form);
    const existingId = await findExternalInternalId(integrationId, 'ticket_form', form.externalId);
    if (existingId) {
      await db
        .update(ticketForms)
        .set({
          name: form.name,
          active: form.active ?? true,
          position: form.position ?? null,
          fieldIds: form.fieldIds ?? [],
          raw: form.raw ?? null,
          updatedAt: new Date(),
        })
        .where(eq(ticketForms.id, existingId));
      ticketFormIdByExternal.set(form.externalId, existingId);
      continue;
    }
    const [row] = await db
      .insert(ticketForms)
      .values({
        workspaceId,
        name: form.name,
        active: form.active ?? true,
        position: form.position ?? null,
        fieldIds: form.fieldIds ?? [],
        raw: form.raw ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: ticketForms.id });
    await upsertExternalObject(integrationId, 'ticket_form', form.externalId, row.id);
    ticketFormIdByExternal.set(form.externalId, row.id);
  }

  for (const field of fieldsData) {
    await upsertRawRecord(integrationId, 'custom_field', field.externalId, field);
    const existingId = await findExternalInternalId(integrationId, 'custom_field', field.externalId);
    if (existingId) {
      await db
        .update(customFields)
        .set({
          objectType: field.objectType,
          name: field.name,
          fieldType: field.fieldType,
          options: field.options ?? null,
          required: field.required ?? false,
        })
        .where(eq(customFields.id, existingId));
      continue;
    }
    const [row] = await db
      .insert(customFields)
      .values({
        workspaceId,
        objectType: field.objectType,
        name: field.name,
        fieldType: field.fieldType,
        options: field.options ?? null,
        required: field.required ?? false,
        createdAt: new Date(),
      })
      .returning({ id: customFields.id });
    await upsertExternalObject(integrationId, 'custom_field', field.externalId, row.id);
  }

  for (const view of viewsData) {
    await upsertRawRecord(integrationId, 'view', view.externalId, view);
    const existingId = await findExternalInternalId(integrationId, 'view', view.externalId);
    if (existingId) {
      await db
        .update(views)
        .set({
          name: view.name,
          query: view.query ?? {},
          active: view.active ?? true,
        })
        .where(eq(views.id, existingId));
      continue;
    }
    const [row] = await db
      .insert(views)
      .values({
        workspaceId,
        name: view.name,
        query: view.query ?? {},
        active: view.active ?? true,
        createdAt: new Date(),
      })
      .returning({ id: views.id });
    await upsertExternalObject(integrationId, 'view', view.externalId, row.id);
  }

  for (const policy of slaPoliciesData) {
    await upsertRawRecord(integrationId, 'sla_policy', policy.externalId, policy);
    const existingId = await findExternalInternalId(integrationId, 'sla_policy', policy.externalId);
    if (existingId) {
      await db
        .update(slaPolicies)
        .set({
          name: policy.name,
          enabled: policy.enabled,
          targets: policy.targets ?? null,
          schedules: policy.schedules ?? null,
        })
        .where(eq(slaPolicies.id, existingId));
      continue;
    }
    const [row] = await db
      .insert(slaPolicies)
      .values({
        workspaceId,
        name: policy.name,
        enabled: policy.enabled,
        targets: policy.targets ?? null,
        schedules: policy.schedules ?? null,
        createdAt: new Date(),
      })
      .returning({ id: slaPolicies.id });
    await upsertExternalObject(integrationId, 'sla_policy', policy.externalId, row.id);
  }

  const existingTags = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.workspaceId, workspaceId));
  for (const tag of existingTags) {
    tagIdByName.set(tag.name, tag.id);
  }

  for (const ticket of ticketsData) {
    await upsertRawRecord(integrationId, 'ticket', ticket.externalId, ticket);
    const existingId = await findExternalInternalId(integrationId, 'ticket', ticket.externalId);
    const requesterId = customerIdByExternal.get(ticket.requester);
    const assigneeId = ticket.assignee ? userIdByExternal.get(ticket.assignee) : undefined;
    const groupId = ticket.groupId ? groupIdByExternal.get(ticket.groupId) : undefined;
    const brandId = ticket.brandId ? brandIdByExternal.get(ticket.brandId) : undefined;
    const ticketFormId = ticket.ticketFormId ? ticketFormIdByExternal.get(ticket.ticketFormId) : undefined;

    if (existingId) {
      await db
        .update(tickets)
        .set({
          subject: ticket.subject,
          status: ticket.status,
          priority: ticket.priority,
          requesterId,
          assigneeId,
          groupId,
          brandId,
          ticketFormId,
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
          groupId,
          brandId,
          ticketFormId,
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

  for (const audit of auditEventsData) {
    await upsertRawRecord(integrationId, 'audit_event', audit.externalId, audit);
    const existingId = await findExternalInternalId(integrationId, 'audit_event', audit.externalId);
    const ticketInternalId = ticketIdByCanonical.get(audit.ticketId);
    if (!ticketInternalId) continue;
    const authorId = audit.authorId ? userIdByExternal.get(audit.authorId) ?? customerIdByExternal.get(audit.authorId) : undefined;
    if (existingId) {
      await db
        .update(auditEvents)
        .set({
          actorType: audit.authorId ? 'user' : 'system',
          actorId: authorId,
          action: audit.eventType,
          objectType: 'ticket',
          objectId: ticketInternalId,
          createdAt: new Date(audit.createdAt),
          diff: audit.raw ?? null,
        })
        .where(eq(auditEvents.id, existingId));
      continue;
    }
    const [row] = await db
      .insert(auditEvents)
      .values({
        workspaceId,
        actorType: audit.authorId ? 'user' : 'system',
        actorId: authorId,
        action: audit.eventType,
        objectType: 'ticket',
        objectId: ticketInternalId,
        createdAt: new Date(audit.createdAt),
        diff: audit.raw ?? null,
      })
      .returning({ id: auditEvents.id });
    await upsertExternalObject(integrationId, 'audit_event', audit.externalId, row.id);
  }

  for (const rating of csatRatingsData) {
    await upsertRawRecord(integrationId, 'csat_rating', rating.externalId, rating);
    const existingId = await findExternalInternalId(integrationId, 'csat_rating', rating.externalId);
    const ticketInternalId = ticketIdByCanonical.get(rating.ticketId);
    if (!ticketInternalId) continue;
    if (existingId) {
      await db
        .update(csatRatings)
        .set({
          ticketId: ticketInternalId,
          rating: rating.rating,
          comment: rating.comment ?? null,
          createdAt: new Date(rating.createdAt),
        })
        .where(eq(csatRatings.id, existingId));
      continue;
    }
    const [row] = await db
      .insert(csatRatings)
      .values({
        ticketId: ticketInternalId,
        rating: rating.rating,
        comment: rating.comment ?? null,
        createdAt: new Date(rating.createdAt),
      })
      .returning({ id: csatRatings.id });
    await upsertExternalObject(integrationId, 'csat_rating', rating.externalId, row.id);
  }

  for (const entry of timeEntriesData) {
    await upsertRawRecord(integrationId, 'time_entry', entry.externalId, entry);
    const existingId = await findExternalInternalId(integrationId, 'time_entry', entry.externalId);
    const ticketInternalId = ticketIdByCanonical.get(entry.ticketId);
    if (!ticketInternalId) continue;
    const agentId = entry.agentId ? userIdByExternal.get(entry.agentId) : undefined;
    if (existingId) {
      await db
        .update(timeEntries)
        .set({
          ticketId: ticketInternalId,
          userId: agentId,
          minutes: entry.minutes,
          note: entry.note ?? null,
          createdAt: new Date(entry.createdAt),
        })
        .where(eq(timeEntries.id, existingId));
      continue;
    }
    const [row] = await db
      .insert(timeEntries)
      .values({
        ticketId: ticketInternalId,
        userId: agentId,
        minutes: entry.minutes,
        note: entry.note ?? null,
        createdAt: new Date(entry.createdAt),
      })
      .returning({ id: timeEntries.id });
    await upsertExternalObject(integrationId, 'time_entry', entry.externalId, row.id);
  }

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

    let messageInternalId = existingId;
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
      messageInternalId = row.id;
    }

    if (messageInternalId && message.attachments && message.attachments.length > 0) {
      for (const attachment of message.attachments) {
        await upsertRawRecord(integrationId, 'attachment', attachment.externalId, attachment);
        const existingAttachmentId = await findExternalInternalId(integrationId, 'attachment', attachment.externalId);
        if (existingAttachmentId) {
          await db
            .update(attachments)
            .set({
              filename: attachment.filename,
              size: attachment.size ?? 0,
              contentType: attachment.contentType ?? null,
              storageKey: attachment.contentUrl ?? null,
              createdAt: new Date(),
            })
            .where(eq(attachments.id, existingAttachmentId));
          continue;
        }
        const [row] = await db
          .insert(attachments)
          .values({
            messageId: messageInternalId,
            filename: attachment.filename,
            size: attachment.size ?? 0,
            contentType: attachment.contentType ?? null,
            storageKey: attachment.contentUrl ?? null,
            createdAt: new Date(),
          })
          .returning({ id: attachments.id });
        await upsertExternalObject(integrationId, 'attachment', attachment.externalId, row.id);
      }
    }
  }

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
}

export async function recordZendeskWebhookEvent(opts: {
  tenant: string;
  workspace: string;
  payload: unknown;
  externalId?: string;
}): Promise<void> {
  const { integrationId } = await ensureZendeskContext({ tenant: opts.tenant, workspace: opts.workspace });
  await upsertRawRecord(integrationId, 'webhook_event', opts.externalId, opts.payload);
}
