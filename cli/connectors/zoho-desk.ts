import type {
  Ticket, Message, Customer, Organization, KBArticle, ExportManifest, TicketStatus, TicketPriority,
} from '../schema/types.js';
import {
  createClient, paginateOffset, setupExport, appendJsonl, writeManifest, exportSpinner,
} from './base/index.js';

export interface ZohoDeskAuth {
  orgId: string;
  accessToken: string;
}

// ---- Zoho Desk API types ----

interface ZDTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  status: string;
  priority: string | null;
  assigneeId: string | null;
  contactId: string;
  departmentId: string | null;
  channel: string;
  category: string | null;
  tags: string[] | null;
  createdTime: string;
  modifiedTime: string;
  customFields?: Record<string, unknown>;
}

interface ZDThread {
  id: string;
  direction: string; // in, out
  type: string; // reply, note
  content: string;
  contentType: string;
  createdTime: string;
  author: { id: string; name: string; type: string } | null;
  isPrivate?: boolean;
}

interface ZDComment {
  id: string;
  content: string;
  commentedTime: string;
  commenter: { id: string; name: string } | null;
  isPublic: boolean;
}

interface ZDContact {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  accountId: string | null;
}

interface ZDAccount {
  id: string;
  accountName: string;
  website: string | null;
  industry: string | null;
}

interface ZDArticle {
  id: string;
  title: string;
  answer: string;
  categoryId: string | null;
  sectionId: string | null;
  status: string;
  createdTime: string;
}

interface ZDAgent {
  id: string;
  name: string;
  emailId: string;
  roleId: string | null;
}

// ---- Client ----

function createZohoDeskClient(auth: ZohoDeskAuth) {
  return createClient({
    baseUrl: 'https://desk.zoho.com/api/v1',
    authHeaders: () => ({
      Authorization: `Zoho-oauthtoken ${auth.accessToken}`,
    }),
    extraHeaders: {
      orgId: auth.orgId,
    },
    sourceName: 'Zoho Desk',
    defaultRetryAfterSeconds: 30,
  });
}

/** @deprecated Use createZohoDeskClient() + client.request() instead. Kept for backward compatibility. */
export async function zodeskFetch<T>(auth: ZohoDeskAuth, path: string, options?: {
  method?: string;
  body?: unknown;
}): Promise<T> {
  return createZohoDeskClient(auth).request<T>(path, options);
}

// ---- Mapping helpers ----

function mapStatus(status: string): TicketStatus {
  const lower = status.toLowerCase();
  if (lower === 'open' || lower === 'new') return 'open';
  if (lower === 'on hold') return 'on_hold';
  if (lower === 'escalated') return 'pending';
  if (lower === 'closed') return 'closed';
  return 'open';
}

function mapPriority(priority: string | null): TicketPriority {
  if (!priority) return 'normal';
  const lower = priority.toLowerCase();
  if (lower === 'low') return 'low';
  if (lower === 'medium' || lower === 'normal') return 'normal';
  if (lower === 'high') return 'high';
  if (lower === 'urgent') return 'urgent';
  return 'normal';
}

// ---- Export ----

export async function exportZohoDesk(auth: ZohoDeskAuth, outDir: string): Promise<ExportManifest> {
  const client = createZohoDeskClient(auth);
  const files = setupExport(outDir);
  const counts = { tickets: 0, messages: 0, customers: 0, organizations: 0, kbArticles: 0, rules: 0 };

  // Export tickets (offset-based via "from" param)
  const ticketSpinner = exportSpinner('Exporting tickets...');
  await paginateOffset<ZDTicket>({
    fetch: client.request.bind(client),
    path: '/tickets?sortBy=createdTime',
    dataKey: 'data',
    offsetParam: 'from',
    onPage: async (tickets) => {
      for (const t of tickets) {
        const ticket: Ticket = {
          id: `zd-desk-${t.id}`,
          externalId: t.id,
          source: 'zoho-desk',
          subject: t.subject ?? `Ticket #${t.ticketNumber}`,
          status: mapStatus(t.status),
          priority: mapPriority(t.priority),
          assignee: t.assigneeId ?? undefined,
          requester: t.contactId ?? 'unknown',
          tags: t.tags ?? [],
          createdAt: t.createdTime,
          updatedAt: t.modifiedTime,
          customFields: t.customFields,
        };
        appendJsonl(files.tickets, ticket);
        counts.tickets++;

        // Hydrate threads (replies)
        try {
          await paginateOffset<ZDThread>({
            fetch: client.request.bind(client),
            path: `/tickets/${t.id}/threads`,
            dataKey: 'data',
            offsetParam: 'from',
            onPage: (threads) => {
              for (const th of threads) {
                const message: Message = {
                  id: `zd-desk-msg-${th.id}`,
                  ticketId: `zd-desk-${t.id}`,
                  author: th.author?.name ?? th.author?.id ?? 'unknown',
                  body: th.content ?? '',
                  type: th.type === 'note' || th.isPrivate ? 'note' : 'reply',
                  createdAt: th.createdTime,
                };
                appendJsonl(files.messages, message);
                counts.messages++;
              }
            },
          });
        } catch {
          ticketSpinner.text = `Exporting tickets... ${counts.tickets} (threads failed for #${t.ticketNumber})`;
        }

        // Hydrate comments (internal notes)
        try {
          const comments = await client.request<{ data: ZDComment[] }>(
            `/tickets/${t.id}/comments?from=0&limit=100`,
          );
          for (const c of comments.data ?? []) {
            const message: Message = {
              id: `zd-desk-note-${c.id}`,
              ticketId: `zd-desk-${t.id}`,
              author: c.commenter?.name ?? c.commenter?.id ?? 'unknown',
              body: c.content ?? '',
              type: c.isPublic ? 'reply' : 'note',
              createdAt: c.commentedTime,
            };
            appendJsonl(files.messages, message);
            counts.messages++;
          }
        } catch { /* comments not available */ }
      }
      ticketSpinner.text = `Exporting tickets... ${counts.tickets} exported`;
    },
  });
  ticketSpinner.succeed(`${counts.tickets} tickets exported (${counts.messages} messages)`);

  // Export contacts (= customers)
  const contactSpinner = exportSpinner('Exporting contacts...');
  await paginateOffset<ZDContact>({
    fetch: client.request.bind(client),
    path: '/contacts',
    dataKey: 'data',
    offsetParam: 'from',
    onPage: (contacts) => {
      for (const c of contacts) {
        const customer: Customer = {
          id: `zd-desk-user-${c.id}`,
          externalId: c.id,
          source: 'zoho-desk',
          name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || `Contact ${c.id}`,
          email: c.email ?? '',
          phone: c.phone ?? c.mobile ?? undefined,
          orgId: c.accountId ? `zd-desk-org-${c.accountId}` : undefined,
        };
        appendJsonl(files.customers, customer);
        counts.customers++;
      }
      contactSpinner.text = `Exporting contacts... ${counts.customers} exported`;
    },
  });
  contactSpinner.succeed(`${counts.customers} contacts exported`);

  // Export agents
  const agentSpinner = exportSpinner('Exporting agents...');
  try {
    const agents = await client.request<{ data: ZDAgent[] }>('/agents?from=0&limit=200');
    for (const a of agents.data ?? []) {
      const customer: Customer = {
        id: `zd-desk-agent-${a.id}`,
        externalId: `agent-${a.id}`,
        source: 'zoho-desk',
        name: a.name,
        email: a.emailId,
      };
      appendJsonl(files.customers, customer);
      counts.customers++;
    }
    agentSpinner.succeed(`${(agents.data ?? []).length} agents exported`);
  } catch (err) {
    agentSpinner.warn(`Agents: ${err instanceof Error ? err.message : 'not available'}`);
  }

  // Export accounts (= organizations)
  const accountSpinner = exportSpinner('Exporting accounts...');
  try {
    await paginateOffset<ZDAccount>({
      fetch: client.request.bind(client),
      path: '/accounts',
      dataKey: 'data',
      offsetParam: 'from',
      onPage: (accounts) => {
        for (const a of accounts) {
          const org: Organization = {
            id: `zd-desk-org-${a.id}`,
            externalId: a.id,
            source: 'zoho-desk',
            name: a.accountName,
            domains: a.website ? [a.website] : [],
          };
          appendJsonl(files.organizations, org);
          counts.organizations++;
        }
      },
    });
  } catch { /* accounts endpoint may not be available */ }
  accountSpinner.succeed(`${counts.organizations} accounts exported`);

  // Export KB articles
  const kbSpinner = exportSpinner('Exporting KB articles...');
  try {
    await paginateOffset<ZDArticle>({
      fetch: client.request.bind(client),
      path: '/articles',
      dataKey: 'data',
      offsetParam: 'from',
      onPage: (articles) => {
        for (const a of articles) {
          const article: KBArticle = {
            id: `zd-desk-kb-${a.id}`,
            externalId: a.id,
            source: 'zoho-desk',
            title: a.title,
            body: a.answer ?? '',
            categoryPath: [a.categoryId, a.sectionId].filter(Boolean) as string[],
          };
          appendJsonl(files.kb_articles, article);
          counts.kbArticles++;
        }
      },
    });
  } catch (err) {
    kbSpinner.warn(`Articles: ${err instanceof Error ? err.message : 'not available'}`);
  }
  if (counts.kbArticles > 0) kbSpinner.succeed(`${counts.kbArticles} articles exported`);
  else kbSpinner.info('0 articles exported');

  exportSpinner('Business rules: not exported via Zoho Desk API').info();

  return writeManifest(outDir, 'zoho-desk', counts);
}

// ---- Verify ----

export async function zodeskVerifyConnection(auth: ZohoDeskAuth): Promise<{
  success: boolean;
  orgName?: string;
  agentCount?: number;
  error?: string;
}> {
  try {
    const client = createZohoDeskClient(auth);
    const agents = await client.request<{ data: ZDAgent[] }>('/agents?from=0&limit=1');
    return {
      success: true,
      orgName: `Org ${auth.orgId}`,
      agentCount: (agents.data ?? []).length,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---- Write operations ----

export async function zodeskCreateTicket(auth: ZohoDeskAuth, subject: string, description: string, options?: {
  contactId?: string;
  priority?: string;
  status?: string;
  departmentId?: string;
}): Promise<{ id: string }> {
  const ticket: Record<string, unknown> = { subject, description };
  if (options?.contactId) ticket.contactId = options.contactId;
  if (options?.priority) ticket.priority = options.priority;
  if (options?.status) ticket.status = options.status;
  if (options?.departmentId) ticket.departmentId = options.departmentId;

  const result = await createZohoDeskClient(auth).request<{ id: string }>('/tickets', {
    method: 'POST',
    body: ticket,
  });
  return { id: result.id };
}

export async function zodeskSendReply(auth: ZohoDeskAuth, ticketId: string, content: string): Promise<void> {
  await createZohoDeskClient(auth).request(`/tickets/${ticketId}/sendReply`, {
    method: 'POST',
    body: { content, channel: 'EMAIL' },
  });
}

export async function zodeskAddComment(auth: ZohoDeskAuth, ticketId: string, content: string, isPublic = false): Promise<void> {
  await createZohoDeskClient(auth).request(`/tickets/${ticketId}/comments`, {
    method: 'POST',
    body: { content, isPublic },
  });
}
