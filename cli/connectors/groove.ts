import { mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import type {
  Ticket, Message, Customer, Organization, KBArticle, ExportManifest, TicketStatus,
} from '../schema/types.js';

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

interface GVPagination {
  current_page: number;
  total_pages: number;
  total_count: number;
  next_page: string | null;
}

// ---- Fetch wrapper ----

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function grooveFetch<T>(auth: GrooveAuth, path: string, options?: {
  method?: string;
  body?: unknown;
}): Promise<T> {
  const url = path.startsWith('http') ? path : `https://api.groovehq.com/v1${path}`;

  let retries = 0;
  const maxRetries = 10;

  // Pre-request delay to stay under Groove's rate limit (~30 req/min)
  await sleep(2500);

  while (true) {
    const res = await fetch(url, {
      method: options?.method ?? 'GET',
      headers: {
        'Authorization': `Bearer ${auth.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (res.status === 429 || res.status === 503) {
      const rawRetryAfter = parseInt(res.headers.get('Retry-After') ?? '90', 10);
      const retryAfter = isNaN(rawRetryAfter) ? 90 : Math.max(rawRetryAfter, 60);
      if (retries >= maxRetries) throw new Error('Rate limit exceeded after max retries');
      retries++;
      process.stderr.write(`  [rate-limit ${res.status}] retry ${retries}/${maxRetries}, waiting ${retryAfter}s...\n`);
      await sleep(retryAfter * 1000);
      continue;
    }

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(`Groove API error: ${res.status} ${res.statusText} for ${url}${errorBody ? ` — ${errorBody.slice(0, 200)}` : ''}`);
    }

    return res.json() as Promise<T>;
  }
}

// ---- Mapping helpers ----

function mapState(state: string): TicketStatus {
  const map: Record<string, TicketStatus> = {
    unread: 'open', opened: 'open', pending: 'pending', closed: 'closed', spam: 'closed',
  };
  return map[state] ?? 'open';
}

function appendJsonl(filePath: string, record: unknown): void {
  appendFileSync(filePath, JSON.stringify(record) + '\n');
}

function extractIdFromHref(href: string): string {
  // Extract the last segment from href like https://api.groovehq.com/v1/messages/12345
  const parts = href.split('/');
  return parts[parts.length - 1] ?? href;
}

// ---- Export ----

export async function exportGroove(auth: GrooveAuth, outDir: string): Promise<ExportManifest> {
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

  // Export tickets (page-based, max 50 per page)
  const ticketSpinner = ora('Exporting tickets...').start();
  let ticketPage = 1;
  let hasMoreTickets = true;

  while (hasMoreTickets) {
    const data = await grooveFetch<{ tickets: GVTicket[]; meta: { pagination: GVPagination } }>(
      auth, `/tickets?per_page=50&page=${ticketPage}`,
    );

    for (const t of data.tickets) {
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
      appendJsonl(ticketsFile, ticket);
      counts.tickets++;

      // Hydrate messages for each ticket
      try {
        let msgPage = 1;
        let hasMoreMsgs = true;
        while (hasMoreMsgs) {
          const msgData = await grooveFetch<{ messages: GVMessage[]; meta: { pagination: GVPagination } }>(
            auth, `/tickets/${t.number}/messages?per_page=50&page=${msgPage}`,
          );
          for (const m of msgData.messages) {
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
            appendJsonl(messagesFile, message);
            counts.messages++;
          }
          hasMoreMsgs = msgData.meta.pagination.next_page !== null;
          msgPage++;
        }
      } catch {
        ticketSpinner.text = `Exporting tickets... ${counts.tickets} (messages failed for #${t.number})`;
      }
    }

    ticketSpinner.text = `Exporting tickets... ${counts.tickets} exported`;
    hasMoreTickets = data.meta.pagination.next_page !== null;
    ticketPage++;
  }
  ticketSpinner.succeed(`${counts.tickets} tickets exported (${counts.messages} messages)`);

  // Export customers (also collect org names in same pass)
  const customerSpinner = ora('Exporting customers...').start();
  const orgNames = new Set<string>();
  let custPage = 1;
  let hasMoreCust = true;

  while (hasMoreCust) {
    const data = await grooveFetch<{ customers: GVCustomer[]; meta: { pagination: GVPagination } }>(
      auth, `/customers?per_page=50&page=${custPage}`,
    );
    for (const c of data.customers) {
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
      appendJsonl(customersFile, customer);
      counts.customers++;
    }
    customerSpinner.text = `Exporting customers... ${counts.customers} exported`;
    hasMoreCust = data.meta.pagination.next_page !== null;
    custPage++;
  }
  customerSpinner.succeed(`${counts.customers} customers exported`);

  // Export agents
  const agentSpinner = ora('Exporting agents...').start();
  try {
    const data = await grooveFetch<{ agents: GVAgent[] }>(auth, '/agents');
    for (const a of data.agents) {
      const customer: Customer = {
        id: `gv-agent-${a.email}`,
        externalId: `agent-${a.email}`,
        source: 'groove',
        name: `${a.first_name} ${a.last_name}`.trim(),
        email: a.email,
      };
      appendJsonl(customersFile, customer);
      counts.customers++;
    }
    agentSpinner.succeed(`${data.agents.length} agents exported`);
  } catch (err) {
    agentSpinner.warn(`Agents: ${err instanceof Error ? err.message : 'not available'}`);
  }

  // Write organizations from company names collected during customer export
  const orgSpinner = ora('Collecting organizations...').start();
  for (const name of orgNames) {
    const org: Organization = {
      id: `gv-org-${name}`, externalId: name, source: 'groove', name, domains: [],
    };
    appendJsonl(orgsFile, org);
    counts.organizations++;
  }
  orgSpinner.succeed(`${counts.organizations} organizations collected`);

  // Export KB articles
  const kbSpinner = ora('Exporting KB articles...').start();
  try {
    const kbsData = await grooveFetch<{ knowledge_bases: GVKB[] }>(auth, '/kb');
    for (const kb of kbsData.knowledge_bases) {
      // Search all articles (empty keyword returns all)
      let articlePage = 1;
      let hasMoreArticles = true;
      while (hasMoreArticles) {
        try {
          const artData = await grooveFetch<{ articles: GVKBArticle[]; meta: { pagination: GVPagination } }>(
            auth, `/kb/${kb.id}/articles/search?per_page=50&page=${articlePage}`,
          );
          for (const a of artData.articles) {
            const article: KBArticle = {
              id: `gv-kb-${a.id}`,
              externalId: a.id,
              source: 'groove',
              title: a.title,
              body: a.body ?? '',
              categoryPath: [kb.title, a.category_id],
            };
            appendJsonl(kbFile, article);
            counts.kbArticles++;
          }
          hasMoreArticles = artData.meta.pagination.next_page !== null;
          articlePage++;
        } catch {
          hasMoreArticles = false;
        }
      }
    }
  } catch (err) {
    kbSpinner.warn(`KB: ${err instanceof Error ? err.message : 'not available'}`);
  }
  if (counts.kbArticles > 0) kbSpinner.succeed(`${counts.kbArticles} KB articles exported`);
  else kbSpinner.info('0 KB articles');

  // No automation rules API
  ora('Business rules: not available via Groove API').info();

  const manifest: ExportManifest = {
    source: 'groove',
    exportedAt: new Date().toISOString(),
    counts,
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(chalk.green(`\nExport complete → ${outDir}/manifest.json`));
  return manifest;
}

// ---- Verify ----

export async function grooveVerifyConnection(auth: GrooveAuth): Promise<{
  success: boolean;
  agentCount?: number;
  error?: string;
}> {
  try {
    const data = await grooveFetch<{ agents: GVAgent[] }>(auth, '/agents');
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
  if (updates.state) {
    await grooveFetch(auth, `/tickets/${ticketNumber}/state`, {
      method: 'PUT', body: { state: updates.state },
    });
  }
  if (updates.assignee) {
    await grooveFetch(auth, `/tickets/${ticketNumber}/assignee`, {
      method: 'PUT', body: { assignee: updates.assignee },
    });
  }
  if (updates.tags) {
    await grooveFetch(auth, `/tickets/${ticketNumber}/tags`, {
      method: 'PUT', body: updates.tags,
    });
  }
}

export async function groovePostMessage(auth: GrooveAuth, ticketNumber: number, body: string, isNote = false): Promise<void> {
  await grooveFetch(auth, `/tickets/${ticketNumber}/messages`, {
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

  const result = await grooveFetch<{ ticket: { number: number } }>(auth, '/tickets', {
    method: 'POST', body: ticket,
  });
  return { number: result.ticket.number };
}
