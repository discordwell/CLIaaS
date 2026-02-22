import { ingestZendeskData, recordZendeskWebhookEvent } from './ingest';
import { mapPriority, mapStatus, zendeskFetch } from './api';
import type {
  ZendeskAuth,
  ZendeskTicket,
  ZendeskComment,
  ZendeskUser,
  ZendeskOrganization,
  ZendeskGroup,
  ZendeskBrand,
  ZendeskTicketForm,
} from './api';
import type { Ticket, Message, Attachment, Customer, Organization, KBArticle, Rule, Group, Brand, TicketForm } from './types';

export interface ZendeskSyncOptions {
  auth?: ZendeskAuth;
  tenant: string;
  workspace: string;
  ticketId: string;
  rawEvent?: unknown;
}

function getAuthFromEnv(): ZendeskAuth {
  const subdomain = process.env.ZENDESK_SUBDOMAIN;
  const email = process.env.ZENDESK_EMAIL;
  const token = process.env.ZENDESK_TOKEN;
  if (!subdomain || !email || !token) {
    throw new Error('Missing Zendesk credentials (ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_TOKEN)');
  }
  return { subdomain, email, token };
}

async function fetchTicket(auth: ZendeskAuth, ticketId: string): Promise<ZendeskTicket> {
  const data = await zendeskFetch<{ ticket: ZendeskTicket }>(auth, `/api/v2/tickets/${ticketId}.json`);
  return data.ticket;
}

async function fetchComments(auth: ZendeskAuth, ticketId: string): Promise<ZendeskComment[]> {
  const comments: ZendeskComment[] = [];
  let url: string | null = `/api/v2/tickets/${ticketId}/comments.json`;
  while (url) {
    const data = await zendeskFetch<{ comments: ZendeskComment[]; next_page: string | null }>(auth, url);
    comments.push(...data.comments);
    url = data.next_page;
  }
  return comments;
}

async function fetchUser(auth: ZendeskAuth, userId: number): Promise<ZendeskUser | null> {
  try {
    const data = await zendeskFetch<{ user: ZendeskUser }>(auth, `/api/v2/users/${userId}.json`);
    return data.user;
  } catch {
    return null;
  }
}

async function fetchOrganization(auth: ZendeskAuth, orgId: number): Promise<ZendeskOrganization | null> {
  try {
    const data = await zendeskFetch<{ organization: ZendeskOrganization }>(auth, `/api/v2/organizations/${orgId}.json`);
    return data.organization;
  } catch {
    return null;
  }
}

async function fetchGroup(auth: ZendeskAuth, groupId: number): Promise<ZendeskGroup | null> {
  try {
    const data = await zendeskFetch<{ group: ZendeskGroup }>(auth, `/api/v2/groups/${groupId}.json`);
    return data.group;
  } catch {
    return null;
  }
}

async function fetchBrand(auth: ZendeskAuth, brandId: number): Promise<ZendeskBrand | null> {
  try {
    const data = await zendeskFetch<{ brand: ZendeskBrand }>(auth, `/api/v2/brands/${brandId}.json`);
    return data.brand;
  } catch {
    return null;
  }
}

async function fetchTicketForm(auth: ZendeskAuth, formId: number): Promise<ZendeskTicketForm | null> {
  try {
    const data = await zendeskFetch<{ ticket_form: ZendeskTicketForm }>(auth, `/api/v2/ticket_forms/${formId}.json`);
    return data.ticket_form;
  } catch {
    return null;
  }
}

export async function syncZendeskTicketById(options: ZendeskSyncOptions): Promise<void> {
  const auth = options.auth ?? getAuthFromEnv();
  const ticket = await fetchTicket(auth, options.ticketId);
  const comments = await fetchComments(auth, options.ticketId);

  const canonicalTicket: Ticket = {
    id: `zd-${ticket.id}`,
    externalId: String(ticket.id),
    source: 'zendesk',
    subject: ticket.subject,
    status: mapStatus(ticket.status),
    priority: mapPriority(ticket.priority),
    assignee: ticket.assignee_id ? String(ticket.assignee_id) : undefined,
    groupId: ticket.group_id ? String(ticket.group_id) : undefined,
    brandId: ticket.brand_id ? String(ticket.brand_id) : undefined,
    ticketFormId: ticket.ticket_form_id ? String(ticket.ticket_form_id) : undefined,
    requester: String(ticket.requester_id),
    tags: ticket.tags ?? [],
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    customFields: ticket.custom_fields ? Object.fromEntries(ticket.custom_fields.map(f => [String(f.id), f.value])) : undefined,
  };

  const canonicalMessages: Message[] = comments.map(comment => {
    let attachments: Attachment[] | undefined;
    if (comment.attachments && comment.attachments.length > 0) {
      attachments = comment.attachments.map(att => ({
        id: `zd-att-${att.id}`,
        externalId: String(att.id),
        messageId: `zd-msg-${comment.id}`,
        filename: att.file_name,
        size: att.size,
        contentType: att.content_type,
        contentUrl: att.content_url,
      }));
    }

    return {
      id: `zd-msg-${comment.id}`,
      ticketId: `zd-${ticket.id}`,
      author: String(comment.author_id),
      body: comment.body,
      bodyHtml: comment.html_body,
      type: comment.public ? 'reply' : 'note',
      createdAt: comment.created_at,
      attachments,
    };
  });

  const userIds = new Set<number>();
  userIds.add(ticket.requester_id);
  if (ticket.assignee_id) userIds.add(ticket.assignee_id);
  for (const comment of comments) {
    userIds.add(comment.author_id);
  }

  const users: ZendeskUser[] = [];
  for (const userId of userIds) {
    const user = await fetchUser(auth, userId);
    if (user) users.push(user);
  }

  const orgMap = new Map<number, ZendeskOrganization>();
  for (const user of users) {
    if (!user.organization_id) continue;
    if (orgMap.has(user.organization_id)) continue;
    const org = await fetchOrganization(auth, user.organization_id);
    if (org) orgMap.set(user.organization_id, org);
  }

  const canonicalOrganizations: Organization[] = Array.from(orgMap.values()).map(org => ({
    id: `zd-org-${org.id}`,
    externalId: String(org.id),
    source: 'zendesk',
    name: org.name,
    domains: org.domain_names ?? [],
  }));

  const canonicalGroups: Group[] = [];
  if (ticket.group_id) {
    const group = await fetchGroup(auth, ticket.group_id);
    if (group) {
      canonicalGroups.push({
        id: `zd-group-${group.id}`,
        externalId: String(group.id),
        source: 'zendesk',
        name: group.name,
      });
    }
  }

  const canonicalBrands: Brand[] = [];
  if (ticket.brand_id) {
    const brand = await fetchBrand(auth, ticket.brand_id);
    if (brand) {
      canonicalBrands.push({
        id: `zd-brand-${brand.id}`,
        externalId: String(brand.id),
        source: 'zendesk',
        name: brand.name,
        raw: brand,
      });
    }
  }

  const canonicalForms: TicketForm[] = [];
  if (ticket.ticket_form_id) {
    const form = await fetchTicketForm(auth, ticket.ticket_form_id);
    if (form) {
      canonicalForms.push({
        id: `zd-form-${form.id}`,
        externalId: String(form.id),
        source: 'zendesk',
        name: form.name,
        active: form.active,
        position: form.position,
        fieldIds: form.ticket_field_ids,
        raw: form,
      });
    }
  }

  const canonicalCustomers: Customer[] = users.map(user => ({
    id: `zd-user-${user.id}`,
    externalId: String(user.id),
    source: 'zendesk',
    name: user.name,
    email: user.email,
    phone: user.phone ?? undefined,
    orgId: user.organization_id ? String(user.organization_id) : undefined,
  }));

  const data = {
    tickets: [canonicalTicket],
    messages: canonicalMessages,
    customers: canonicalCustomers,
    organizations: canonicalOrganizations,
    groups: canonicalGroups,
    customFields: [],
    views: [],
    slaPolicies: [],
    ticketForms: canonicalForms,
    brands: canonicalBrands,
    kbArticles: [] as KBArticle[],
    rules: [] as Rule[],
  };

  await ingestZendeskData({ tenant: options.tenant, workspace: options.workspace, data });

  if (options.rawEvent) {
    await recordZendeskWebhookEvent({
      tenant: options.tenant,
      workspace: options.workspace,
      payload: options.rawEvent,
      externalId: String(ticket.id),
    });
  }
}
