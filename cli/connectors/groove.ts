import type {
  Ticket, Message, Customer, Organization, KBArticle, ExportManifest, TicketStatus,
} from '../schema/types.js';
import {
  createClient, paginatePages, setupExport, appendJsonl, writeManifest, exportSpinner,
} from './base/index.js';

export interface GrooveAuth {
  apiToken: string;
}

// ---- Groove API types ----

interface GVTicket {
  number: number;
  title: string;
  state: string; // unread, opened, pending, closed, spam
  tags: string[];
  starred: boolean;
  message_count: number;
  created_at: string;
  updated_at: string;
  assigned_group: string | null;
  closed_by: string | null;
  priority: string | null;
  links: {
    assignee?: { href: string };
    customer?: { href: string };
    messages?: { href: string };
  };
}

interface GVMessage {
  href: string;
  created_at: string;
  updated_at: string;
  body: string;
  plain_text_body: string;
  note: boolean;
  links: {
    author?: { href: string };
    ticket?: { href: string };
  };
}

interface GVCustomer {
  email: string;
  name: string | null;
  about: string | null;
  company_name: string | null;
  phone_number: string | null;
  location: string | null;
}

interface GVAgent {
  email: string;
  first_name: string;
  last_name: string;
}

interface GVKB {
  id: string;
  title: string;
  subdomain: string;
}

interface GVKBArticle {
  id: string;
  title: string;
  body: string;
  state: string;
  category_id: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

// ---- Client ----

function createGrooveClient(auth: GrooveAuth) {
  return createClient({
    baseUrl: 'https://api.groovehq.com/v1',
    authHeaders: () => ({
      Authorization: `Bearer ${auth.apiToken}`,
    }),
    sourceName: 'Groove',
    maxRetries: 10,
    defaultRetryAfterSeconds: 90,
    preRequestDelayMs: 2500,
    rateLimitStatuses: [429, 503],
  });
}

/** @deprecated Use createGrooveClient() + client.request() instead. Kept for backward compatibility. */
export async function grooveFetch<T>(auth: GrooveAuth, path: string, options?: {
  method?: string;
  body?: unknown;
}): Promise<T> {
  return createGrooveClient(auth).request<T>(path, options);
}

// ---- Mapping helpers ----

function mapState(state: string): TicketStatus {
  const map: Record<string, TicketStatus> = {
    unread: 'open', opened: 'open', pending: 'pending', closed: 'closed', spam: 'closed',
  };
  return map[state] ?? 'open';
}

function extractIdFromHref(href: string): string {
  // Extract the last segment from href like https://api.groovehq.com/v1/messages/12345
  const parts = href.split('/');
  return parts[parts.length - 1] ?? href;
}

// ---- Export ----

export async function exportGroove(auth: GrooveAuth, outDir: string): Promise<ExportManifest> {
  const client = createGrooveClient(auth);
  const files = setupExport(outDir);
  const counts = { tickets: 0, messages: 0, customers: 0, organizations: 0, kbArticles: 0, rules: 0 };

  // Export tickets (page-based, max 50 per page)
  const ticketSpinner = exportSpinner('Exporting tickets...');
  await paginatePages<GVTicket>({
    fetch: client.request.bind(client),
    path: '/tickets',
    pageSize: 50,
    dataKey: 'tickets',
    onPage: async (tickets) => {
      for (const t of tickets) {
        const customerEmail = t.links.customer?.href ? extractIdFromHref(t.links.customer.href) : 'unknown';
        const assigneeEmail = t.links.assignee?.href ? extractIdFromHref(t.links.assignee.href) : undefined;

        const ticket: Ticket = {
          id: `gv-${t.number}`,
          externalId: String(t.number),
          source: 'groove',
          subject: t.title ?? `Ticket #${t.number}`,
          status: mapState(t.state),
          priority: 'normal', // Groove has priority field but it's often null
          assignee: assigneeEmail,
          requester: customerEmail,
          tags: t.tags ?? [],
          createdAt: t.created_at,
          updatedAt: t.updated_at,
        };
        appendJsonl(files.tickets, ticket);
        counts.tickets++;

        // Hydrate messages for each ticket
        try {
          await paginatePages<GVMessage>({
            fetch: client.request.bind(client),
            path: `/tickets/${t.number}/messages`,
            pageSize: 50,
            dataKey: 'messages',
            onPage: (msgs) => {
              for (const m of msgs) {
                const msgId = extractIdFromHref(m.href);
                const authorId = m.links.author?.href ? extractIdFromHref(m.links.author.href) : 'unknown';
                const message: Message = {
                  id: `gv-msg-${msgId}`,
                  ticketId: `gv-${t.number}`,
                  author: authorId,
                  body: m.plain_text_body ?? m.body ?? '',
                  bodyHtml: m.body,
                  type: m.note ? 'note' : 'reply',
                  createdAt: m.created_at,
                };
                appendJsonl(files.messages, message);
                counts.messages++;
              }
            },
          });
        } catch {
          ticketSpinner.text = `Exporting tickets... ${counts.tickets} (messages failed for #${t.number})`;
        }
      }
      ticketSpinner.text = `Exporting tickets... ${counts.tickets} exported`;
    },
  });
  ticketSpinner.succeed(`${counts.tickets} tickets exported (${counts.messages} messages)`);

  // Export customers (also collect org names in same pass)
  const customerSpinner = exportSpinner('Exporting customers...');
  const orgNames = new Set<string>();
  await paginatePages<GVCustomer>({
    fetch: client.request.bind(client),
    path: '/customers',
    pageSize: 50,
    dataKey: 'customers',
    onPage: (customers) => {
      for (const c of customers) {
        if (c.company_name) orgNames.add(c.company_name);
        const customer: Customer = {
          id: `gv-user-${c.email}`,
          externalId: c.email,
          source: 'groove',
          name: c.name ?? c.email,
          email: c.email,
          phone: c.phone_number ?? undefined,
          orgId: c.company_name ? `gv-org-${c.company_name}` : undefined,
        };
        appendJsonl(files.customers, customer);
        counts.customers++;
      }
      customerSpinner.text = `Exporting customers... ${counts.customers} exported`;
    },
  });
  customerSpinner.succeed(`${counts.customers} customers exported`);

  // Export agents
  const agentSpinner = exportSpinner('Exporting agents...');
  try {
    const data = await client.request<{ agents: GVAgent[] }>('/agents');
    for (const a of data.agents) {
      const customer: Customer = {
        id: `gv-agent-${a.email}`,
        externalId: `agent-${a.email}`,
        source: 'groove',
        name: `${a.first_name} ${a.last_name}`.trim(),
        email: a.email,
      };
      appendJsonl(files.customers, customer);
      counts.customers++;
    }
    agentSpinner.succeed(`${data.agents.length} agents exported`);
  } catch (err) {
    agentSpinner.warn(`Agents: ${err instanceof Error ? err.message : 'not available'}`);
  }

  // Write organizations from company names collected during customer export
  const orgSpinner = exportSpinner('Collecting organizations...');
  for (const name of Array.from(orgNames)) {
    const org: Organization = {
      id: `gv-org-${name}`, externalId: name, source: 'groove', name, domains: [],
    };
    appendJsonl(files.organizations, org);
    counts.organizations++;
  }
  orgSpinner.succeed(`${counts.organizations} organizations collected`);

  // Export KB articles
  const kbSpinner = exportSpinner('Exporting KB articles...');
  try {
    const kbsData = await client.request<{ knowledge_bases: GVKB[] }>('/kb');
    for (const kb of kbsData.knowledge_bases) {
      // Search all articles (empty keyword returns all)
      try {
        await paginatePages<GVKBArticle>({
          fetch: client.request.bind(client),
          path: `/kb/${kb.id}/articles/search`,
          pageSize: 50,
          dataKey: 'articles',
          onPage: (articles) => {
            for (const a of articles) {
              const article: KBArticle = {
                id: `gv-kb-${a.id}`,
                externalId: a.id,
                source: 'groove',
                title: a.title,
                body: a.body ?? '',
                categoryPath: [kb.title, a.category_id],
              };
              appendJsonl(files.kb_articles, article);
              counts.kbArticles++;
            }
          },
        });
      } catch { /* KB articles search failed for this knowledge base */ }
    }
  } catch (err) {
    kbSpinner.warn(`KB: ${err instanceof Error ? err.message : 'not available'}`);
  }
  if (counts.kbArticles > 0) kbSpinner.succeed(`${counts.kbArticles} KB articles exported`);
  else kbSpinner.info('0 KB articles');

  // No automation rules API
  exportSpinner('Business rules: not available via Groove API').info();

  return writeManifest(outDir, 'groove', counts);
}

// ---- Verify ----

export async function grooveVerifyConnection(auth: GrooveAuth): Promise<{
  success: boolean;
  agentCount?: number;
  error?: string;
}> {
  try {
    const client = createGrooveClient(auth);
    const data = await client.request<{ agents: GVAgent[] }>('/agents');
    return {
      success: true,
      agentCount: data.agents.length,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---- Write operations ----

export async function grooveUpdateTicket(auth: GrooveAuth, ticketNumber: number, updates: {
  state?: string;
  assignee?: string;
  tags?: string[];
}): Promise<void> {
  const client = createGrooveClient(auth);
  if (updates.state) {
    await client.request(`/tickets/${ticketNumber}/state`, {
      method: 'PUT', body: { state: updates.state },
    });
  }
  if (updates.assignee) {
    await client.request(`/tickets/${ticketNumber}/assignee`, {
      method: 'PUT', body: { assignee: updates.assignee },
    });
  }
  if (updates.tags) {
    await client.request(`/tickets/${ticketNumber}/tags`, {
      method: 'PUT', body: updates.tags,
    });
  }
}

export async function groovePostMessage(auth: GrooveAuth, ticketNumber: number, body: string, isNote = false): Promise<void> {
  await createGrooveClient(auth).request(`/tickets/${ticketNumber}/messages`, {
    method: 'POST',
    body: { body, note: isNote },
  });
}

export async function grooveCreateTicket(auth: GrooveAuth, to: string, body: string, options?: {
  subject?: string;
  assignee?: string;
  tags?: string[];
  from?: string;
}): Promise<{ number: number }> {
  const ticket: Record<string, unknown> = { to, body };
  if (options?.subject) ticket.subject = options.subject;
  if (options?.assignee) ticket.assignee = options.assignee;
  if (options?.tags) ticket.tags = options.tags;
  if (options?.from) ticket.from = options.from;

  const result = await createGrooveClient(auth).request<{ ticket: { number: number } }>('/tickets', {
    method: 'POST', body: ticket,
  });
  return { number: result.ticket.number };
}
