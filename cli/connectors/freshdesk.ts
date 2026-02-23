import type {
  Ticket, Message, Customer, Organization, KBArticle, Rule, ExportManifest, TicketStatus, TicketPriority,
} from '../schema/types.js';
import {
  createClient, paginatePages, setupExport, appendJsonl, writeManifest, exportSpinner,
} from './base/index.js';

export interface FreshdeskAuth {
  subdomain: string;
  apiKey: string;
}

// ---- Freshdesk API types ----

interface FDTicket {
  id: number;
  subject: string;
  status: number; // 2=Open, 3=Pending, 4=Resolved, 5=Closed
  priority: number; // 1=Low, 2=Medium, 3=High, 4=Urgent
  responder_id: number | null;
  requester_id: number;
  tags: string[];
  created_at: string;
  updated_at: string;
  custom_fields?: Record<string, unknown>;
  type: string | null;
  source: number;
}

interface FDConversation {
  id: number;
  body: string;
  body_text: string;
  user_id: number;
  private: boolean;
  incoming: boolean;
  created_at: string;
  updated_at: string;
}

interface FDContact {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  mobile: string | null;
  company_id: number | null;
}

interface FDCompany {
  id: number;
  name: string;
  domains: string[];
}

interface FDAgent {
  id: number;
  contact: { name: string; email: string; phone: string | null };
}

interface FDCategory { id: number; name: string; }
interface FDFolder { id: number; name: string; category_id: number; }
interface FDArticle { id: number; title: string; description: string; folder_id: number; category_id: number; }
interface FDSLAPolicy { id: number; name: string; description: string; is_default: boolean; applicable_to: unknown; sla_target: unknown; }

// ---- Client ----

function createFreshdeskClient(auth: FreshdeskAuth) {
  return createClient({
    baseUrl: `https://${auth.subdomain}.freshdesk.com`,
    authHeaders: () => ({
      Authorization: `Basic ${Buffer.from(`${auth.apiKey}:X`).toString('base64')}`,
    }),
    sourceName: 'Freshdesk',
    defaultRetryAfterSeconds: 30,
  });
}

/** @deprecated Use createFreshdeskClient() + client.request() instead. Kept for backward compatibility. */
export async function freshdeskFetch<T>(auth: FreshdeskAuth, path: string, options?: {
  method?: string;
  body?: unknown;
}): Promise<T> {
  return createFreshdeskClient(auth).request<T>(path, options);
}

// ---- Mapping helpers ----

function mapStatus(status: number): TicketStatus {
  const map: Record<number, TicketStatus> = { 2: 'open', 3: 'pending', 4: 'solved', 5: 'closed' };
  return map[status] ?? 'open';
}

function mapPriority(priority: number): TicketPriority {
  const map: Record<number, TicketPriority> = { 1: 'low', 2: 'normal', 3: 'high', 4: 'urgent' };
  return map[priority] ?? 'normal';
}

// ---- Export ----

export async function exportFreshdesk(auth: FreshdeskAuth, outDir: string): Promise<ExportManifest> {
  const client = createFreshdeskClient(auth);
  const files = setupExport(outDir);
  const counts = { tickets: 0, messages: 0, customers: 0, organizations: 0, kbArticles: 0, rules: 0 };

  // Export tickets (page-based, max 100 per page)
  const ticketSpinner = exportSpinner('Exporting tickets...');
  await paginatePages<FDTicket>({
    fetch: client.request.bind(client),
    path: '/api/v2/tickets',
    onPage: async (tickets) => {
      for (const t of tickets) {
        const ticket: Ticket = {
          id: `fd-${t.id}`, externalId: String(t.id), source: 'freshdesk',
          subject: t.subject ?? `Ticket #${t.id}`,
          status: mapStatus(t.status), priority: mapPriority(t.priority),
          assignee: t.responder_id ? String(t.responder_id) : undefined,
          requester: String(t.requester_id), tags: t.tags ?? [],
          createdAt: t.created_at, updatedAt: t.updated_at, customFields: t.custom_fields,
        };
        appendJsonl(files.tickets, ticket);
        counts.tickets++;

        // Hydrate conversations
        try {
          await paginatePages<FDConversation>({
            fetch: client.request.bind(client),
            path: `/api/v2/tickets/${t.id}/conversations`,
            onPage: (convs) => {
              for (const c of convs) {
                const message: Message = {
                  id: `fd-msg-${c.id}`, ticketId: `fd-${t.id}`, author: String(c.user_id),
                  body: c.body_text ?? c.body ?? '', bodyHtml: c.body,
                  type: c.private ? 'note' : 'reply', createdAt: c.created_at,
                };
                appendJsonl(files.messages, message);
                counts.messages++;
              }
            },
          });
        } catch {
          ticketSpinner.text = `Exporting tickets... ${counts.tickets} (conversations failed for #${t.id})`;
        }
      }
      ticketSpinner.text = `Exporting tickets... ${counts.tickets} exported`;
    },
  });
  ticketSpinner.succeed(`${counts.tickets} tickets exported (${counts.messages} messages)`);

  // Export contacts
  const contactSpinner = exportSpinner('Exporting contacts...');
  await paginatePages<FDContact>({
    fetch: client.request.bind(client),
    path: '/api/v2/contacts',
    onPage: (contacts) => {
      for (const c of contacts) {
        const customer: Customer = {
          id: `fd-user-${c.id}`, externalId: String(c.id), source: 'freshdesk',
          name: c.name ?? c.email ?? `Contact ${c.id}`, email: c.email ?? '',
          phone: c.phone ?? c.mobile ?? undefined,
          orgId: c.company_id ? `fd-org-${c.company_id}` : undefined,
        };
        appendJsonl(files.customers, customer);
        counts.customers++;
      }
      contactSpinner.text = `Exporting contacts... ${counts.customers} exported`;
    },
  });
  contactSpinner.succeed(`${counts.customers} contacts exported`);

  // Export agents as customers too
  const agentSpinner = exportSpinner('Exporting agents...');
  try {
    const agents = await client.request<FDAgent[]>('/api/v2/agents?per_page=100');
    for (const a of agents) {
      const customer: Customer = {
        id: `fd-agent-${a.id}`, externalId: `agent-${a.id}`, source: 'freshdesk',
        name: a.contact.name, email: a.contact.email, phone: a.contact.phone ?? undefined,
      };
      appendJsonl(files.customers, customer);
      counts.customers++;
    }
    agentSpinner.succeed(`${agents.length} agents exported`);
  } catch (err) {
    agentSpinner.warn(`Agents: ${err instanceof Error ? err.message : 'not available'}`);
  }

  // Export companies
  const companySpinner = exportSpinner('Exporting companies...');
  try {
    await paginatePages<FDCompany>({
      fetch: client.request.bind(client),
      path: '/api/v2/companies',
      onPage: (companies) => {
        for (const o of companies) {
          const org: Organization = {
            id: `fd-org-${o.id}`, externalId: String(o.id), source: 'freshdesk',
            name: o.name, domains: o.domains ?? [],
          };
          appendJsonl(files.organizations, org);
          counts.organizations++;
        }
        companySpinner.text = `Exporting companies... ${counts.organizations} exported`;
      },
    });
  } catch { /* companies endpoint may not be available */ }
  companySpinner.succeed(`${counts.organizations} companies exported`);

  // Export KB articles (categories → folders → articles)
  const kbSpinner = exportSpinner('Exporting KB articles...');
  try {
    const categories = await client.request<FDCategory[]>('/api/v2/solutions/categories');
    for (const cat of categories) {
      try {
        const folders = await client.request<FDFolder[]>(`/api/v2/solutions/categories/${cat.id}/folders`);
        for (const folder of folders) {
          try {
            await paginatePages<FDArticle>({
              fetch: client.request.bind(client),
              path: `/api/v2/solutions/folders/${folder.id}/articles`,
              onPage: (articles) => {
                for (const a of articles) {
                  const article: KBArticle = {
                    id: `fd-kb-${a.id}`, externalId: String(a.id), source: 'freshdesk',
                    title: a.title, body: a.description ?? '', categoryPath: [cat.name, folder.name],
                  };
                  appendJsonl(files.kb_articles, article);
                  counts.kbArticles++;
                }
              },
            });
          } catch { /* folder articles failed */ }
        }
      } catch { /* category folders failed */ }
    }
  } catch (err) {
    kbSpinner.warn(`KB: ${err instanceof Error ? err.message : 'not available'}`);
  }
  if (counts.kbArticles > 0) kbSpinner.succeed(`${counts.kbArticles} KB articles exported`);
  else kbSpinner.info('0 KB articles (Solutions not configured)');

  // Export SLA policies as rules
  const rulesSpinner = exportSpinner('Exporting business rules...');
  try {
    const slas = await client.request<FDSLAPolicy[]>('/api/v2/sla_policies');
    for (const s of slas) {
      const rule: Rule = {
        id: `fd-sla-${s.id}`, externalId: String(s.id), source: 'freshdesk',
        type: 'sla', title: s.name, conditions: s.applicable_to, actions: s.sla_target, active: true,
      };
      appendJsonl(files.rules, rule);
      counts.rules++;
    }
  } catch { /* SLA not available */ }
  rulesSpinner.succeed(`${counts.rules} business rules exported`);

  return writeManifest(outDir, 'freshdesk', counts);
}

// ---- Verify ----

export async function freshdeskVerifyConnection(auth: FreshdeskAuth): Promise<{
  success: boolean; userName?: string; ticketCount?: number; error?: string;
}> {
  try {
    const client = createFreshdeskClient(auth);
    const me = await client.request<FDAgent>('/api/v2/agents/me');
    const tickets = await client.request<FDTicket[]>('/api/v2/tickets?per_page=1');
    return { success: true, userName: me.contact.name, ticketCount: tickets.length };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---- Write operations ----

export async function freshdeskUpdateTicket(auth: FreshdeskAuth, ticketId: number, updates: {
  status?: number; priority?: number; responder_id?: number; tags?: string[];
}): Promise<void> {
  await createFreshdeskClient(auth).request(`/api/v2/tickets/${ticketId}`, { method: 'PUT', body: updates });
}

export async function freshdeskReply(auth: FreshdeskAuth, ticketId: number, body: string): Promise<void> {
  await createFreshdeskClient(auth).request(`/api/v2/tickets/${ticketId}/reply`, { method: 'POST', body: { body } });
}

export async function freshdeskAddNote(auth: FreshdeskAuth, ticketId: number, body: string): Promise<void> {
  await createFreshdeskClient(auth).request(`/api/v2/tickets/${ticketId}/notes`, { method: 'POST', body: { body, private: true } });
}

export async function freshdeskCreateTicket(auth: FreshdeskAuth, subject: string, description: string, options?: {
  email?: string; priority?: number; status?: number; tags?: string[];
}): Promise<{ id: number }> {
  const ticket: Record<string, unknown> = {
    subject, description,
    email: options?.email ?? `devops@${auth.subdomain}.freshdesk.com`,
    status: options?.status ?? 2, priority: options?.priority ?? 1,
  };
  if (options?.tags) ticket.tags = options.tags;
  const result = await createFreshdeskClient(auth).request<{ id: number }>('/api/v2/tickets', { method: 'POST', body: ticket });
  return { id: result.id };
}

export async function freshdeskDeleteTicket(auth: FreshdeskAuth, ticketId: number): Promise<void> {
  await createFreshdeskClient(auth).request(`/api/v2/tickets/${ticketId}`, { method: 'DELETE' });
}
