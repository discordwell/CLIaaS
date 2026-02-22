import { mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import type {
  Ticket, Message, Customer, Organization, KBArticle, Rule, ExportManifest, TicketStatus, TicketPriority,
} from '../schema/types.js';

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

interface FDCategory {
  id: number;
  name: string;
}

interface FDFolder {
  id: number;
  name: string;
  category_id: number;
}

interface FDArticle {
  id: number;
  title: string;
  description: string;
  folder_id: number;
  category_id: number;
}

interface FDSLAPolicy {
  id: number;
  name: string;
  description: string;
  is_default: boolean;
  applicable_to: unknown;
  sla_target: unknown;
}

// ---- Fetch wrapper ----

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function freshdeskFetch<T>(auth: FreshdeskAuth, path: string, options?: {
  method?: string;
  body?: unknown;
}): Promise<T> {
  const url = path.startsWith('http') ? path : `https://${auth.subdomain}.freshdesk.com${path}`;
  const credentials = Buffer.from(`${auth.apiKey}:X`).toString('base64');

  let retries = 0;
  const maxRetries = 5;

  while (true) {
    const res = await fetch(url, {
      method: options?.method ?? 'GET',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (res.status === 429) {
      const rawRetryAfter = parseInt(res.headers.get('Retry-After') ?? '30', 10);
      const retryAfter = isNaN(rawRetryAfter) ? 30 : rawRetryAfter;
      if (retries >= maxRetries) throw new Error('Rate limit exceeded after max retries');
      retries++;
      await sleep(retryAfter * 1000);
      continue;
    }

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(`Freshdesk API error: ${res.status} ${res.statusText} for ${url}${errorBody ? ` — ${errorBody.slice(0, 200)}` : ''}`);
    }

    return res.json() as Promise<T>;
  }
}

// ---- Mapping helpers ----

function mapStatus(status: number): TicketStatus {
  const map: Record<number, TicketStatus> = {
    2: 'open', 3: 'pending', 4: 'solved', 5: 'closed',
  };
  return map[status] ?? 'open';
}

function mapPriority(priority: number): TicketPriority {
  const map: Record<number, TicketPriority> = {
    1: 'low', 2: 'normal', 3: 'high', 4: 'urgent',
  };
  return map[priority] ?? 'normal';
}

function appendJsonl(filePath: string, record: unknown): void {
  appendFileSync(filePath, JSON.stringify(record) + '\n');
}

// ---- Export ----

export async function exportFreshdesk(auth: FreshdeskAuth, outDir: string): Promise<ExportManifest> {
  mkdirSync(outDir, { recursive: true });

  const ticketsFile = join(outDir, 'tickets.jsonl');
  const messagesFile = join(outDir, 'messages.jsonl');
  const customersFile = join(outDir, 'customers.jsonl');
  const orgsFile = join(outDir, 'organizations.jsonl');
  const kbFile = join(outDir, 'kb_articles.jsonl');
  const rulesFile = join(outDir, 'rules.jsonl');

  for (const f of [ticketsFile, messagesFile, customersFile, orgsFile, kbFile, rulesFile]) {
    writeFileSync(f, '');
  }

  const counts = { tickets: 0, messages: 0, customers: 0, organizations: 0, kbArticles: 0, rules: 0 };

  // Export tickets (page-based, max 100 per page)
  const ticketSpinner = ora('Exporting tickets...').start();
  let ticketPage = 1;
  let hasMoreTickets = true;

  while (hasMoreTickets) {
    const tickets = await freshdeskFetch<FDTicket[]>(auth, `/api/v2/tickets?per_page=100&page=${ticketPage}`);

    for (const t of tickets) {
      const ticket: Ticket = {
        id: `fd-${t.id}`,
        externalId: String(t.id),
        source: 'freshdesk',
        subject: t.subject ?? `Ticket #${t.id}`,
        status: mapStatus(t.status),
        priority: mapPriority(t.priority),
        assignee: t.responder_id ? String(t.responder_id) : undefined,
        requester: String(t.requester_id),
        tags: t.tags ?? [],
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        customFields: t.custom_fields,
      };
      appendJsonl(ticketsFile, ticket);
      counts.tickets++;

      // Hydrate conversations for each ticket
      try {
        let convPage = 1;
        let hasMoreConvs = true;
        while (hasMoreConvs) {
          const convs = await freshdeskFetch<FDConversation[]>(
            auth, `/api/v2/tickets/${t.id}/conversations?per_page=100&page=${convPage}`,
          );
          for (const c of convs) {
            const message: Message = {
              id: `fd-msg-${c.id}`,
              ticketId: `fd-${t.id}`,
              author: String(c.user_id),
              body: c.body_text ?? c.body ?? '',
              bodyHtml: c.body,
              type: c.private ? 'note' : 'reply',
              createdAt: c.created_at,
            };
            appendJsonl(messagesFile, message);
            counts.messages++;
          }
          hasMoreConvs = convs.length >= 100;
          convPage++;
        }
      } catch {
        ticketSpinner.text = `Exporting tickets... ${counts.tickets} (conversations failed for #${t.id})`;
      }
    }

    ticketSpinner.text = `Exporting tickets... ${counts.tickets} exported`;
    hasMoreTickets = tickets.length >= 100;
    ticketPage++;
  }
  ticketSpinner.succeed(`${counts.tickets} tickets exported (${counts.messages} messages)`);

  // Export contacts
  const contactSpinner = ora('Exporting contacts...').start();
  let contactPage = 1;
  let hasMoreContacts = true;

  while (hasMoreContacts) {
    const contacts = await freshdeskFetch<FDContact[]>(auth, `/api/v2/contacts?per_page=100&page=${contactPage}`);
    for (const c of contacts) {
      const customer: Customer = {
        id: `fd-user-${c.id}`,
        externalId: String(c.id),
        source: 'freshdesk',
        name: c.name ?? c.email ?? `Contact ${c.id}`,
        email: c.email ?? '',
        phone: c.phone ?? c.mobile ?? undefined,
        orgId: c.company_id ? `fd-org-${c.company_id}` : undefined,
      };
      appendJsonl(customersFile, customer);
      counts.customers++;
    }
    contactSpinner.text = `Exporting contacts... ${counts.customers} exported`;
    hasMoreContacts = contacts.length >= 100;
    contactPage++;
  }
  contactSpinner.succeed(`${counts.customers} contacts exported`);

  // Export agents as customers too
  const agentSpinner = ora('Exporting agents...').start();
  try {
    const agents = await freshdeskFetch<FDAgent[]>(auth, '/api/v2/agents?per_page=100');
    for (const a of agents) {
      const customer: Customer = {
        id: `fd-agent-${a.id}`,
        externalId: `agent-${a.id}`,
        source: 'freshdesk',
        name: a.contact.name,
        email: a.contact.email,
        phone: a.contact.phone ?? undefined,
      };
      appendJsonl(customersFile, customer);
      counts.customers++;
    }
    agentSpinner.succeed(`${agents.length} agents exported`);
  } catch (err) {
    agentSpinner.warn(`Agents: ${err instanceof Error ? err.message : 'not available'}`);
  }

  // Export companies
  const companySpinner = ora('Exporting companies...').start();
  let companyPage = 1;
  let hasMoreCompanies = true;

  while (hasMoreCompanies) {
    try {
      const companies = await freshdeskFetch<FDCompany[]>(auth, `/api/v2/companies?per_page=100&page=${companyPage}`);
      for (const o of companies) {
        const org: Organization = {
          id: `fd-org-${o.id}`,
          externalId: String(o.id),
          source: 'freshdesk',
          name: o.name,
          domains: o.domains ?? [],
        };
        appendJsonl(orgsFile, org);
        counts.organizations++;
      }
      companySpinner.text = `Exporting companies... ${counts.organizations} exported`;
      hasMoreCompanies = companies.length >= 100;
      companyPage++;
    } catch {
      hasMoreCompanies = false;
    }
  }
  companySpinner.succeed(`${counts.organizations} companies exported`);

  // Export KB articles (categories → folders → articles)
  const kbSpinner = ora('Exporting KB articles...').start();
  try {
    const categories = await freshdeskFetch<FDCategory[]>(auth, '/api/v2/solutions/categories');
    for (const cat of categories) {
      try {
        const folders = await freshdeskFetch<FDFolder[]>(auth, `/api/v2/solutions/categories/${cat.id}/folders`);
        for (const folder of folders) {
          try {
            let articlePage = 1;
            let hasMoreArticles = true;
            while (hasMoreArticles) {
              const articles = await freshdeskFetch<FDArticle[]>(
                auth, `/api/v2/solutions/folders/${folder.id}/articles?per_page=100&page=${articlePage}`,
              );
              for (const a of articles) {
                const article: KBArticle = {
                  id: `fd-kb-${a.id}`,
                  externalId: String(a.id),
                  source: 'freshdesk',
                  title: a.title,
                  body: a.description ?? '',
                  categoryPath: [cat.name, folder.name],
                };
                appendJsonl(kbFile, article);
                counts.kbArticles++;
              }
              hasMoreArticles = articles.length >= 100;
              articlePage++;
            }
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
  const rulesSpinner = ora('Exporting business rules...').start();
  try {
    const slas = await freshdeskFetch<FDSLAPolicy[]>(auth, '/api/v2/sla_policies');
    for (const s of slas) {
      const rule: Rule = {
        id: `fd-sla-${s.id}`,
        externalId: String(s.id),
        source: 'freshdesk',
        type: 'sla',
        title: s.name,
        conditions: s.applicable_to,
        actions: s.sla_target,
        active: true,
      };
      appendJsonl(rulesFile, rule);
      counts.rules++;
    }
  } catch { /* SLA not available */ }
  rulesSpinner.succeed(`${counts.rules} business rules exported`);

  const manifest: ExportManifest = {
    source: 'freshdesk',
    exportedAt: new Date().toISOString(),
    counts,
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(chalk.green(`\nExport complete → ${outDir}/manifest.json`));
  return manifest;
}

// ---- Verify ----

export async function freshdeskVerifyConnection(auth: FreshdeskAuth): Promise<{
  success: boolean;
  userName?: string;
  ticketCount?: number;
  error?: string;
}> {
  try {
    const me = await freshdeskFetch<FDAgent>(auth, '/api/v2/agents/me');
    // Get first page to estimate count
    const tickets = await freshdeskFetch<FDTicket[]>(auth, '/api/v2/tickets?per_page=1');
    return {
      success: true,
      userName: me.contact.name,
      ticketCount: tickets.length,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---- Write operations ----

export async function freshdeskUpdateTicket(auth: FreshdeskAuth, ticketId: number, updates: {
  status?: number;
  priority?: number;
  responder_id?: number;
  tags?: string[];
}): Promise<void> {
  await freshdeskFetch(auth, `/api/v2/tickets/${ticketId}`, {
    method: 'PUT',
    body: updates,
  });
}

export async function freshdeskReply(auth: FreshdeskAuth, ticketId: number, body: string): Promise<void> {
  await freshdeskFetch(auth, `/api/v2/tickets/${ticketId}/reply`, {
    method: 'POST',
    body: { body },
  });
}

export async function freshdeskAddNote(auth: FreshdeskAuth, ticketId: number, body: string): Promise<void> {
  await freshdeskFetch(auth, `/api/v2/tickets/${ticketId}/notes`, {
    method: 'POST',
    body: { body, private: true },
  });
}

export async function freshdeskCreateTicket(auth: FreshdeskAuth, subject: string, description: string, options?: {
  email?: string;
  priority?: number;
  status?: number;
  tags?: string[];
}): Promise<{ id: number }> {
  const ticket: Record<string, unknown> = {
    subject,
    description,
    email: options?.email ?? `devops@${auth.subdomain}.freshdesk.com`,
    status: options?.status ?? 2,
    priority: options?.priority ?? 1,
  };
  if (options?.tags) ticket.tags = options.tags;

  const result = await freshdeskFetch<{ id: number }>(auth, '/api/v2/tickets', {
    method: 'POST',
    body: ticket,
  });
  return { id: result.id };
}
