import type {
  Ticket, Message, Customer, Organization, KBArticle, ExportManifest, TicketStatus, TicketPriority,
} from '../schema/types.js';
import {
  createClient, paginateCursor, paginatePages, setupExport, appendJsonl, writeManifest, exportSpinner,
} from './base/index.js';

export interface IntercomAuth {
  accessToken: string;
}

// ---- Intercom API types ----

interface ICConversation {
  id: string;
  title: string | null;
  state: string; // open, closed, snoozed
  priority: string; // priority, not_priority
  created_at: number;
  updated_at: number;
  waiting_since: number | null;
  snoozed_until: number | null;
  source: { author: { id: string; type: string; email?: string }; body: string; delivered_as: string };
  assignee: { id: string | null; type: string } | null;
  tags: { tags: Array<{ id: string; name: string }> };
  contacts: { contacts: Array<{ id: string; type: string }> };
  conversation_parts?: { conversation_parts: ICConversationPart[] };
  statistics?: { time_to_assignment?: number; time_to_first_close?: number };
}

interface ICConversationPart {
  id: string;
  part_type: string; // comment, note, assignment, close, open
  body: string | null;
  author: { id: string; type: string; email?: string };
  created_at: number;
}

interface ICContact {
  id: string;
  type: string;
  role: string; // user, lead
  email: string | null;
  name: string | null;
  phone: string | null;
  created_at: number;
  companies: { data: Array<{ id: string }> } | null;
}

interface ICCompany {
  id: string;
  name: string;
  company_id: string;
  website: string | null;
  plan: { name: string } | null;
  created_at: number;
}

interface ICArticle {
  id: string;
  title: string;
  body: string;
  state: string;
  parent_id: number | null;
  parent_type: string | null;
  created_at: number;
  updated_at: number;
}

interface ICAdmin {
  id: string;
  name: string;
  email: string;
  type: string;
}

// ---- Client ----

function createIntercomClient(auth: IntercomAuth, apiVersion?: string) {
  return createClient({
    baseUrl: 'https://api.intercom.io',
    authHeaders: () => ({
      Authorization: `Bearer ${auth.accessToken}`,
    }),
    sourceName: 'Intercom',
    defaultRetryAfterSeconds: 10,
    extraHeaders: {
      'Intercom-Version': apiVersion ?? '2.11',
    },
  });
}

/** @deprecated Use createIntercomClient() + client.request() instead. Kept for backward compatibility. */
export async function intercomFetch<T>(auth: IntercomAuth, path: string, options?: {
  method?: string;
  body?: unknown;
  apiVersion?: string;
}): Promise<T> {
  return createIntercomClient(auth, options?.apiVersion).request<T>(path, {
    method: options?.method,
    body: options?.body,
  });
}

// ---- Mapping helpers ----

function mapState(state: string): TicketStatus {
  const map: Record<string, TicketStatus> = {
    open: 'open', closed: 'closed', snoozed: 'on_hold',
  };
  return map[state] ?? 'open';
}

function mapPriority(priority: string): TicketPriority {
  return priority === 'priority' ? 'high' : 'normal';
}

function epochToISO(epoch: number): string {
  return new Date(epoch * 1000).toISOString();
}

// ---- Export ----

export async function exportIntercom(auth: IntercomAuth, outDir: string): Promise<ExportManifest> {
  const client = createIntercomClient(auth);
  const files = setupExport(outDir);
  const counts = { tickets: 0, messages: 0, customers: 0, organizations: 0, kbArticles: 0, rules: 0 };

  // Export conversations (= tickets)
  const convSpinner = exportSpinner('Exporting conversations...');

  await paginateCursor<ICConversation>({
    fetch: client.request.bind(client),
    initialUrl: '/conversations?per_page=50',
    getData: (response) => (response as unknown as { conversations: ICConversation[] }).conversations ?? [],
    getNextUrl: (response) => {
      const pages = (response as unknown as { pages: { next?: { starting_after: string } } }).pages;
      const startingAfter = pages?.next?.starting_after;
      return startingAfter ? `/conversations?per_page=50&starting_after=${startingAfter}` : null;
    },
    onPage: async (conversations) => {
      for (const conv of conversations) {
        const contactId = conv.contacts?.contacts?.[0]?.id ?? 'unknown';
        const ticket: Ticket = {
          id: `ic-${conv.id}`,
          externalId: conv.id,
          source: 'intercom',
          subject: conv.title ?? conv.source?.body?.slice(0, 100) ?? `Conversation #${conv.id}`,
          status: mapState(conv.state),
          priority: mapPriority(conv.priority),
          assignee: conv.assignee?.id ?? undefined,
          requester: contactId,
          tags: (conv.tags?.tags ?? []).map((t: { id: string; name: string }) => t.name),
          createdAt: epochToISO(conv.created_at),
          updatedAt: epochToISO(conv.updated_at),
        };
        appendJsonl(files.tickets, ticket);
        counts.tickets++;

        // First message from source
        if (conv.source?.body) {
          const msg: Message = {
            id: `ic-msg-${conv.id}-source`,
            ticketId: `ic-${conv.id}`,
            author: conv.source.author?.id ?? 'unknown',
            body: conv.source.body,
            type: 'reply',
            createdAt: epochToISO(conv.created_at),
          };
          appendJsonl(files.messages, msg);
          counts.messages++;
        }

        // Hydrate conversation parts (messages)
        try {
          const partsData = await client.request<{
            conversation_parts: { conversation_parts: ICConversationPart[] };
          }>(`/conversations/${conv.id}`);

          for (const part of partsData.conversation_parts?.conversation_parts ?? []) {
            if (!part.body) continue;
            const message: Message = {
              id: `ic-msg-${part.id}`,
              ticketId: `ic-${conv.id}`,
              author: part.author?.id ?? 'unknown',
              body: part.body,
              type: part.part_type === 'note' ? 'note' : 'reply',
              createdAt: epochToISO(part.created_at),
            };
            appendJsonl(files.messages, message);
            counts.messages++;
          }
        } catch {
          convSpinner.text = `Exporting conversations... ${counts.tickets} (parts failed for #${conv.id})`;
        }
      }

      convSpinner.text = `Exporting conversations... ${counts.tickets} exported`;
    },
  });
  convSpinner.succeed(`${counts.tickets} conversations exported (${counts.messages} messages)`);

  // Export contacts (= customers)
  const contactSpinner = exportSpinner('Exporting contacts...');

  await paginateCursor<ICContact>({
    fetch: client.request.bind(client),
    initialUrl: '/contacts?per_page=50',
    getData: (response) => (response as unknown as { data: ICContact[] }).data ?? [],
    getNextUrl: (response) => {
      const pages = (response as unknown as { pages: { next?: { starting_after: string } } }).pages;
      const startingAfter = pages?.next?.starting_after;
      return startingAfter ? `/contacts?per_page=50&starting_after=${startingAfter}` : null;
    },
    onPage: (contacts) => {
      for (const c of contacts) {
        const customer: Customer = {
          id: `ic-user-${c.id}`,
          externalId: c.id,
          source: 'intercom',
          name: c.name ?? c.email ?? `Contact ${c.id}`,
          email: c.email ?? '',
          phone: c.phone ?? undefined,
          orgId: c.companies?.data?.[0]?.id ? `ic-org-${c.companies.data[0].id}` : undefined,
        };
        appendJsonl(files.customers, customer);
        counts.customers++;
      }
      contactSpinner.text = `Exporting contacts... ${counts.customers} exported`;
    },
  });
  contactSpinner.succeed(`${counts.customers} contacts exported`);

  // Export admins as customers
  const adminSpinner = exportSpinner('Exporting admins...');
  try {
    const admins = await client.request<{ admins: ICAdmin[] }>('/admins');
    for (const a of admins.admins) {
      const customer: Customer = {
        id: `ic-admin-${a.id}`,
        externalId: `admin-${a.id}`,
        source: 'intercom',
        name: a.name,
        email: a.email,
      };
      appendJsonl(files.customers, customer);
      counts.customers++;
    }
    adminSpinner.succeed(`${admins.admins.length} admins exported`);
  } catch (err) {
    adminSpinner.warn(`Admins: ${err instanceof Error ? err.message : 'not available'}`);
  }

  // Export companies (= organizations) using scroll pagination
  const companySpinner = exportSpinner('Exporting companies...');

  try {
    await paginateCursor<ICCompany>({
      fetch: client.request.bind(client),
      initialUrl: '/companies/scroll',
      getData: (response) => (response as unknown as { data: ICCompany[] }).data ?? [],
      getNextUrl: (response) => {
        const raw = response as unknown as { data: ICCompany[]; scroll_param: string | null };
        return raw.data.length > 0 && raw.scroll_param
          ? `/companies/scroll?scroll_param=${raw.scroll_param}`
          : null;
      },
      onPage: (companies) => {
        for (const co of companies) {
          const org: Organization = {
            id: `ic-org-${co.id}`,
            externalId: co.id,
            source: 'intercom',
            name: co.name,
            domains: co.website ? [co.website] : [],
          };
          appendJsonl(files.organizations, org);
          counts.organizations++;
        }
        companySpinner.text = `Exporting companies... ${counts.organizations} exported`;
      },
    });
  } catch (err) {
    companySpinner.warn(`Companies: ${err instanceof Error ? err.message : 'not available'}`);
  }
  if (counts.organizations > 0) companySpinner.succeed(`${counts.organizations} companies exported`);
  else companySpinner.info('0 companies exported');

  // Export articles (= KB) — page-based pagination
  const kbSpinner = exportSpinner('Exporting articles...');

  try {
    await paginatePages<ICArticle>({
      fetch: client.request.bind(client),
      path: '/articles',
      pageSize: 50,
      dataKey: 'data',
      totalPagesKey: undefined,
      onPage: (articles) => {
        for (const a of articles) {
          const article: KBArticle = {
            id: `ic-kb-${a.id}`,
            externalId: a.id,
            source: 'intercom',
            title: a.title,
            body: a.body ?? '',
            categoryPath: a.parent_id ? [String(a.parent_id)] : [],
          };
          appendJsonl(files.kb_articles, article);
          counts.kbArticles++;
        }
      },
    });
  } catch (err) {
    kbSpinner.warn(`Articles: ${err instanceof Error ? err.message : 'Help Center not enabled'}`);
  }
  if (counts.kbArticles > 0) kbSpinner.succeed(`${counts.kbArticles} articles exported`);
  else kbSpinner.info('0 articles exported');

  // No automation rules API
  exportSpinner('Business rules: not available via Intercom API').info();

  return writeManifest(outDir, 'intercom', counts);
}

// ---- Verify ----

export async function intercomVerifyConnection(auth: IntercomAuth): Promise<{
  success: boolean;
  appName?: string;
  adminCount?: number;
  error?: string;
}> {
  try {
    const client = createIntercomClient(auth);
    const me = await client.request<{ app: { name: string }; type: string }>('/me');
    const admins = await client.request<{ admins: ICAdmin[] }>('/admins');
    return {
      success: true,
      appName: me.app?.name ?? 'Unknown',
      adminCount: admins.admins.length,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---- Write operations ----

export async function intercomCreateConversation(auth: IntercomAuth, fromContactId: string, body: string): Promise<{ id: string }> {
  const result = await createIntercomClient(auth).request<{ conversation_id: string }>('/conversations', {
    method: 'POST',
    body: {
      from: { type: 'user', id: fromContactId },
      body,
    },
  });
  return { id: result.conversation_id };
}

export async function intercomReplyToConversation(auth: IntercomAuth, conversationId: string, body: string, adminId: string): Promise<void> {
  await createIntercomClient(auth).request(`/conversations/${conversationId}/reply`, {
    method: 'POST',
    body: {
      message_type: 'comment',
      type: 'admin',
      admin_id: adminId,
      body,
    },
  });
}

export async function intercomAddNote(auth: IntercomAuth, conversationId: string, body: string, adminId: string): Promise<void> {
  await createIntercomClient(auth).request(`/conversations/${conversationId}/reply`, {
    method: 'POST',
    body: {
      message_type: 'note',
      type: 'admin',
      admin_id: adminId,
      body,
    },
  });
}

export async function intercomDeleteConversation(auth: IntercomAuth, conversationId: string): Promise<void> {
  await createIntercomClient(auth, 'Unstable').request(`/conversations/${conversationId}`, { method: 'DELETE' });
}

export async function intercomDeleteContact(auth: IntercomAuth, contactId: string): Promise<void> {
  await createIntercomClient(auth).request(`/contacts/${contactId}`, { method: 'DELETE' });
}
