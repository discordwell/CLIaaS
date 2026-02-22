import { mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import type {
  Ticket, Message, Customer, Organization, KBArticle, ExportManifest, TicketStatus, TicketPriority,
} from '../schema/types.js';

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

// ---- Fetch wrapper ----

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function intercomFetch<T>(auth: IntercomAuth, path: string, options?: {
  method?: string;
  body?: unknown;
  apiVersion?: string;
}): Promise<T> {
  const url = path.startsWith('http') ? path : `https://api.intercom.io${path}`;

  let retries = 0;
  const maxRetries = 5;

  while (true) {
    const res = await fetch(url, {
      method: options?.method ?? 'GET',
      headers: {
        'Authorization': `Bearer ${auth.accessToken}`,
        'Content-Type': 'application/json',
        'Intercom-Version': options?.apiVersion ?? '2.11',
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (res.status === 429) {
      const rawRetryAfter = parseInt(res.headers.get('Retry-After') ?? '10', 10);
      const retryAfter = isNaN(rawRetryAfter) ? 10 : rawRetryAfter;
      if (retries >= maxRetries) throw new Error('Rate limit exceeded after max retries');
      retries++;
      await sleep(retryAfter * 1000);
      continue;
    }

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(`Intercom API error: ${res.status} ${res.statusText} for ${url}${errorBody ? ` — ${errorBody.slice(0, 200)}` : ''}`);
    }

    if (res.status === 204) return {} as T;
    return res.json() as Promise<T>;
  }
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

function appendJsonl(filePath: string, record: unknown): void {
  appendFileSync(filePath, JSON.stringify(record) + '\n');
}

// ---- Export ----

export async function exportIntercom(auth: IntercomAuth, outDir: string): Promise<ExportManifest> {
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

  // Export conversations (= tickets)
  const convSpinner = ora('Exporting conversations...').start();
  let startingAfter: string | null = null;
  let hasMore = true;

  while (hasMore) {
    const url: string = startingAfter
      ? `/conversations?per_page=50&starting_after=${startingAfter}`
      : '/conversations?per_page=50';

    const data: { conversations: ICConversation[]; pages: { next?: { starting_after: string } } } =
      await intercomFetch(auth, url);

    for (const conv of data.conversations) {
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
      appendJsonl(ticketsFile, ticket);
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
        appendJsonl(messagesFile, msg);
        counts.messages++;
      }

      // Hydrate conversation parts (messages)
      try {
        const partsData = await intercomFetch<{
          conversation_parts: { conversation_parts: ICConversationPart[] };
        }>(auth, `/conversations/${conv.id}`);

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
          appendJsonl(messagesFile, message);
          counts.messages++;
        }
      } catch {
        convSpinner.text = `Exporting conversations... ${counts.tickets} (parts failed for #${conv.id})`;
      }
    }

    convSpinner.text = `Exporting conversations... ${counts.tickets} exported`;
    startingAfter = data.pages?.next?.starting_after ?? null;
    hasMore = startingAfter !== null;
  }
  convSpinner.succeed(`${counts.tickets} conversations exported (${counts.messages} messages)`);

  // Export contacts (= customers)
  const contactSpinner = ora('Exporting contacts...').start();
  startingAfter = null;
  hasMore = true;

  while (hasMore) {
    const url: string = startingAfter
      ? `/contacts?per_page=50&starting_after=${startingAfter}`
      : '/contacts?per_page=50';

    const data: { data: ICContact[]; pages: { next?: { starting_after: string } } } =
      await intercomFetch(auth, url);

    for (const c of data.data) {
      const customer: Customer = {
        id: `ic-user-${c.id}`,
        externalId: c.id,
        source: 'intercom',
        name: c.name ?? c.email ?? `Contact ${c.id}`,
        email: c.email ?? '',
        phone: c.phone ?? undefined,
        orgId: c.companies?.data?.[0]?.id ? `ic-org-${c.companies.data[0].id}` : undefined,
      };
      appendJsonl(customersFile, customer);
      counts.customers++;
    }

    contactSpinner.text = `Exporting contacts... ${counts.customers} exported`;
    startingAfter = data.pages?.next?.starting_after ?? null;
    hasMore = startingAfter !== null;
  }
  contactSpinner.succeed(`${counts.customers} contacts exported`);

  // Export admins as customers
  const adminSpinner = ora('Exporting admins...').start();
  try {
    const admins = await intercomFetch<{ admins: ICAdmin[] }>(auth, '/admins');
    for (const a of admins.admins) {
      const customer: Customer = {
        id: `ic-admin-${a.id}`,
        externalId: `admin-${a.id}`,
        source: 'intercom',
        name: a.name,
        email: a.email,
      };
      appendJsonl(customersFile, customer);
      counts.customers++;
    }
    adminSpinner.succeed(`${admins.admins.length} admins exported`);
  } catch (err) {
    adminSpinner.warn(`Admins: ${err instanceof Error ? err.message : 'not available'}`);
  }

  // Export companies (= organizations)
  const companySpinner = ora('Exporting companies...').start();
  let companyScrollParam: string | null = null;
  let hasMoreCompanies = true;

  while (hasMoreCompanies) {
    try {
      const url: string = companyScrollParam
        ? `/companies/scroll?scroll_param=${companyScrollParam}`
        : '/companies/scroll';

      const data: { data: ICCompany[]; scroll_param: string | null } =
        await intercomFetch(auth, url);

      for (const co of data.data) {
        const org: Organization = {
          id: `ic-org-${co.id}`,
          externalId: co.id,
          source: 'intercom',
          name: co.name,
          domains: co.website ? [co.website] : [],
        };
        appendJsonl(orgsFile, org);
        counts.organizations++;
      }

      companySpinner.text = `Exporting companies... ${counts.organizations} exported`;
      companyScrollParam = data.data.length > 0 ? data.scroll_param : null;
      hasMoreCompanies = companyScrollParam !== null && data.data.length > 0;
    } catch (err) {
      companySpinner.warn(`Companies: ${err instanceof Error ? err.message : 'not available'}`);
      hasMoreCompanies = false;
    }
  }
  if (counts.organizations > 0) companySpinner.succeed(`${counts.organizations} companies exported`);
  else companySpinner.info('0 companies exported');

  // Export articles (= KB)
  const kbSpinner = ora('Exporting articles...').start();
  let articlePage = 1;
  let hasMoreArticles = true;

  while (hasMoreArticles) {
    try {
      const data = await intercomFetch<{
        data: ICArticle[];
        pages: { next?: string; total_pages: number; page: number };
      }>(auth, `/articles?per_page=50&page=${articlePage}`);

      for (const a of data.data) {
        const article: KBArticle = {
          id: `ic-kb-${a.id}`,
          externalId: a.id,
          source: 'intercom',
          title: a.title,
          body: a.body ?? '',
          categoryPath: a.parent_id ? [String(a.parent_id)] : [],
        };
        appendJsonl(kbFile, article);
        counts.kbArticles++;
      }

      hasMoreArticles = articlePage < data.pages.total_pages;
      articlePage++;
    } catch (err) {
      kbSpinner.warn(`Articles: ${err instanceof Error ? err.message : 'Help Center not enabled'}`);
      hasMoreArticles = false;
    }
  }
  if (counts.kbArticles > 0) kbSpinner.succeed(`${counts.kbArticles} articles exported`);
  else kbSpinner.info('0 articles exported');

  // No automation rules API
  ora('Business rules: not available via Intercom API').info();

  const manifest: ExportManifest = {
    source: 'intercom',
    exportedAt: new Date().toISOString(),
    counts,
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(chalk.green(`\nExport complete → ${outDir}/manifest.json`));
  return manifest;
}

// ---- Verify ----

export async function intercomVerifyConnection(auth: IntercomAuth): Promise<{
  success: boolean;
  appName?: string;
  adminCount?: number;
  error?: string;
}> {
  try {
    const me = await intercomFetch<{ app: { name: string }; type: string }>(auth, '/me');
    const admins = await intercomFetch<{ admins: ICAdmin[] }>(auth, '/admins');
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
  const result = await intercomFetch<{ conversation_id: string }>(auth, '/conversations', {
    method: 'POST',
    body: {
      from: { type: 'user', id: fromContactId },
      body,
    },
  });
  return { id: result.conversation_id };
}

export async function intercomReplyToConversation(auth: IntercomAuth, conversationId: string, body: string, adminId: string): Promise<void> {
  await intercomFetch(auth, `/conversations/${conversationId}/reply`, {
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
  await intercomFetch(auth, `/conversations/${conversationId}/reply`, {
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
  await intercomFetch(auth, `/conversations/${conversationId}`, { method: 'DELETE', apiVersion: 'Unstable' });
}

export async function intercomDeleteContact(auth: IntercomAuth, contactId: string): Promise<void> {
  await intercomFetch(auth, `/contacts/${contactId}`, { method: 'DELETE' });
}
