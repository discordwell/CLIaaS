import { mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import type {
  Ticket, Message, Customer, Organization, KBArticle, ExportManifest, TicketStatus, TicketPriority,
} from '../schema/types.js';

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

// ---- Fetch wrapper ----

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function zodeskFetch<T>(auth: ZohoDeskAuth, path: string, options?: {
  method?: string;
  body?: unknown;
}): Promise<T> {
  const url = path.startsWith('http') ? path : `https://desk.zoho.com/api/v1${path}`;

  let retries = 0;
  const maxRetries = 5;

  while (true) {
    const res = await fetch(url, {
      method: options?.method ?? 'GET',
      headers: {
        'Authorization': `Zoho-oauthtoken ${auth.accessToken}`,
        'orgId': auth.orgId,
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
      throw new Error(`Zoho Desk API error: ${res.status} ${res.statusText} for ${url}${errorBody ? ` — ${errorBody.slice(0, 200)}` : ''}`);
    }

    // 204 No Content
    if (res.status === 204) return {} as T;

    return res.json() as Promise<T>;
  }
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

function appendJsonl(filePath: string, record: unknown): void {
  appendFileSync(filePath, JSON.stringify(record) + '\n');
}

// ---- Export ----

export async function exportZohoDesk(auth: ZohoDeskAuth, outDir: string): Promise<ExportManifest> {
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

  // Export tickets
  const ticketSpinner = ora('Exporting tickets...').start();
  let from = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const data = await zodeskFetch<{ data: ZDTicket[] }>(
      auth, `/tickets?from=${from}&limit=${limit}&sortBy=createdTime`,
    );

    for (const t of data.data ?? []) {
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
      appendJsonl(ticketsFile, ticket);
      counts.tickets++;

      // Hydrate threads (replies)
      try {
        let threadFrom = 0;
        let hasMoreThreads = true;
        while (hasMoreThreads) {
          const threads = await zodeskFetch<{ data: ZDThread[] }>(
            auth, `/tickets/${t.id}/threads?from=${threadFrom}&limit=100`,
          );
          for (const th of threads.data ?? []) {
            const message: Message = {
              id: `zd-desk-msg-${th.id}`,
              ticketId: `zd-desk-${t.id}`,
              author: th.author?.name ?? th.author?.id ?? 'unknown',
              body: th.content ?? '',
              type: th.type === 'note' || th.isPrivate ? 'note' : 'reply',
              createdAt: th.createdTime,
            };
            appendJsonl(messagesFile, message);
            counts.messages++;
          }
          hasMoreThreads = (threads.data ?? []).length >= 100;
          threadFrom += 100;
        }
      } catch {
        ticketSpinner.text = `Exporting tickets... ${counts.tickets} (threads failed for #${t.ticketNumber})`;
      }

      // Hydrate comments (internal notes)
      try {
        const comments = await zodeskFetch<{ data: ZDComment[] }>(
          auth, `/tickets/${t.id}/comments?from=0&limit=100`,
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
          appendJsonl(messagesFile, message);
          counts.messages++;
        }
      } catch { /* comments not available */ }
    }

    ticketSpinner.text = `Exporting tickets... ${counts.tickets} exported`;
    hasMore = (data.data ?? []).length >= limit;
    from += limit;
  }
  ticketSpinner.succeed(`${counts.tickets} tickets exported (${counts.messages} messages)`);

  // Export contacts (= customers)
  const contactSpinner = ora('Exporting contacts...').start();
  from = 0;
  hasMore = true;

  while (hasMore) {
    const data = await zodeskFetch<{ data: ZDContact[] }>(
      auth, `/contacts?from=${from}&limit=${limit}`,
    );

    for (const c of data.data ?? []) {
      const customer: Customer = {
        id: `zd-desk-user-${c.id}`,
        externalId: c.id,
        source: 'zoho-desk',
        name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || `Contact ${c.id}`,
        email: c.email ?? '',
        phone: c.phone ?? c.mobile ?? undefined,
        orgId: c.accountId ? `zd-desk-org-${c.accountId}` : undefined,
      };
      appendJsonl(customersFile, customer);
      counts.customers++;
    }

    contactSpinner.text = `Exporting contacts... ${counts.customers} exported`;
    hasMore = (data.data ?? []).length >= limit;
    from += limit;
  }
  contactSpinner.succeed(`${counts.customers} contacts exported`);

  // Export agents
  const agentSpinner = ora('Exporting agents...').start();
  try {
    const agents = await zodeskFetch<{ data: ZDAgent[] }>(auth, '/agents?from=0&limit=200');
    for (const a of agents.data ?? []) {
      const customer: Customer = {
        id: `zd-desk-agent-${a.id}`,
        externalId: `agent-${a.id}`,
        source: 'zoho-desk',
        name: a.name,
        email: a.emailId,
      };
      appendJsonl(customersFile, customer);
      counts.customers++;
    }
    agentSpinner.succeed(`${(agents.data ?? []).length} agents exported`);
  } catch (err) {
    agentSpinner.warn(`Agents: ${err instanceof Error ? err.message : 'not available'}`);
  }

  // Export accounts (= organizations)
  const accountSpinner = ora('Exporting accounts...').start();
  from = 0;
  hasMore = true;

  while (hasMore) {
    try {
      const data = await zodeskFetch<{ data: ZDAccount[] }>(
        auth, `/accounts?from=${from}&limit=${limit}`,
      );

      for (const a of data.data ?? []) {
        const org: Organization = {
          id: `zd-desk-org-${a.id}`,
          externalId: a.id,
          source: 'zoho-desk',
          name: a.accountName,
          domains: a.website ? [a.website] : [],
        };
        appendJsonl(orgsFile, org);
        counts.organizations++;
      }

      hasMore = (data.data ?? []).length >= limit;
      from += limit;
    } catch {
      hasMore = false;
    }
  }
  accountSpinner.succeed(`${counts.organizations} accounts exported`);

  // Export KB articles
  const kbSpinner = ora('Exporting KB articles...').start();
  from = 0;
  hasMore = true;

  while (hasMore) {
    try {
      const data = await zodeskFetch<{ data: ZDArticle[] }>(
        auth, `/articles?from=${from}&limit=${limit}`,
      );

      for (const a of data.data ?? []) {
        const article: KBArticle = {
          id: `zd-desk-kb-${a.id}`,
          externalId: a.id,
          source: 'zoho-desk',
          title: a.title,
          body: a.answer ?? '',
          categoryPath: [a.categoryId, a.sectionId].filter(Boolean) as string[],
        };
        appendJsonl(kbFile, article);
        counts.kbArticles++;
      }

      hasMore = (data.data ?? []).length >= limit;
      from += limit;
    } catch (err) {
      kbSpinner.warn(`Articles: ${err instanceof Error ? err.message : 'not available'}`);
      hasMore = false;
    }
  }
  if (counts.kbArticles > 0) kbSpinner.succeed(`${counts.kbArticles} articles exported`);
  else kbSpinner.info('0 articles exported');

  ora('Business rules: not exported via Zoho Desk API').info();

  const manifest: ExportManifest = {
    source: 'zoho-desk',
    exportedAt: new Date().toISOString(),
    counts,
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(chalk.green(`\nExport complete → ${outDir}/manifest.json`));
  return manifest;
}

// ---- Verify ----

export async function zodeskVerifyConnection(auth: ZohoDeskAuth): Promise<{
  success: boolean;
  orgName?: string;
  agentCount?: number;
  error?: string;
}> {
  try {
    const agents = await zodeskFetch<{ data: ZDAgent[] }>(auth, '/agents?from=0&limit=1');
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

  const result = await zodeskFetch<{ id: string }>(auth, '/tickets', {
    method: 'POST',
    body: ticket,
  });
  return { id: result.id };
}

export async function zodeskSendReply(auth: ZohoDeskAuth, ticketId: string, content: string): Promise<void> {
  await zodeskFetch(auth, `/tickets/${ticketId}/sendReply`, {
    method: 'POST',
    body: { content, channel: 'FORUMS' },
  });
}

export async function zodeskAddComment(auth: ZohoDeskAuth, ticketId: string, content: string, isPublic = false): Promise<void> {
  await zodeskFetch(auth, `/tickets/${ticketId}/comments`, {
    method: 'POST',
    body: { content, isPublic },
  });
}
