import { mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import type {
  Ticket, Message, Customer, Organization, KBArticle, ExportManifest, TicketStatus,
} from '../schema/types.js';

export interface HelpScoutAuth {
  appId: string;
  appSecret: string;
}

// ---- Help Scout API types ----

interface HSConversation {
  id: number;
  number: number;
  subject: string;
  status: string; // active, pending, closed, spam
  state: string;
  priority: string | null;
  mailboxId: number;
  assignee?: { id: number; email: string; first: string; last: string };
  primaryCustomer: { id: number; email?: string };
  tags: Array<{ id: number; tag: string }>;
  createdAt: string;
  closedAt: string | null;
  userUpdatedAt: string;
  customFields?: Array<{ id: number; name: string; value: unknown }>;
}

interface HSThread {
  id: number;
  type: string; // customer, reply, note, lineitem, phone, forwardchild, forwardparent, chat
  body: string;
  status: string;
  createdAt: string;
  createdBy: { id: number; type: string; email?: string };
}

interface HSCustomer {
  id: number;
  firstName: string;
  lastName: string;
  emails: Array<{ id: number; value: string }>;
  phones: Array<{ id: number; value: string }>;
  organization: string | null;
  createdAt: string;
}

interface HSMailbox {
  id: number;
  name: string;
  email: string;
}

interface HSUser {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
}

interface HSCollection {
  id: string;
  name: string;
  siteId: string;
  slug: string;
}

interface HSArticle {
  id: string;
  collectionId: string;
  name: string;
  text: string;
  status: string;
  categories: Array<{ id: string; name: string }>;
  createdAt: string;
}

// ---- OAuth2 token management ----

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(auth: HelpScoutAuth): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const res = await fetch('https://api.helpscout.net/v2/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: auth.appId,
      client_secret: auth.appSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Help Scout OAuth error: ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

// ---- Fetch wrapper ----

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function helpscoutFetch<T>(auth: HelpScoutAuth, path: string, options?: {
  method?: string;
  body?: unknown;
}): Promise<T> {
  const url = path.startsWith('http') ? path : `https://api.helpscout.net/v2${path}`;
  const token = await getAccessToken(auth);

  let retries = 0;
  const maxRetries = 5;

  while (true) {
    const res = await fetch(url, {
      method: options?.method ?? 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
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
      throw new Error(`Help Scout API error: ${res.status} ${res.statusText} for ${url}${errorBody ? ` — ${errorBody.slice(0, 200)}` : ''}`);
    }

    // 201/204 responses may have no body — return Location header if present
    if (res.status === 201 || res.status === 204) {
      const location = res.headers.get('Location') ?? '';
      return { location } as T;
    }

    return res.json() as Promise<T>;
  }
}

// ---- Mapping helpers ----

function mapStatus(status: string): TicketStatus {
  const map: Record<string, TicketStatus> = {
    active: 'open', pending: 'pending', closed: 'closed', spam: 'closed',
  };
  return map[status] ?? 'open';
}

function appendJsonl(filePath: string, record: unknown): void {
  appendFileSync(filePath, JSON.stringify(record) + '\n');
}

// ---- Export ----

export async function exportHelpScout(auth: HelpScoutAuth, outDir: string): Promise<ExportManifest> {
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
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const data = await helpscoutFetch<{
      _embedded: { conversations: HSConversation[] };
      page: { totalPages: number; number: number };
    }>(auth, `/conversations?page=${page}&status=all`);

    for (const conv of data._embedded.conversations) {
      const ticket: Ticket = {
        id: `hs-${conv.id}`,
        externalId: String(conv.id),
        source: 'helpscout',
        subject: conv.subject ?? `Conversation #${conv.number}`,
        status: mapStatus(conv.status),
        priority: 'normal', // Help Scout doesn't have priority on conversations
        assignee: conv.assignee ? String(conv.assignee.id) : undefined,
        requester: conv.primaryCustomer?.email ?? String(conv.primaryCustomer?.id ?? 'unknown'),
        tags: (conv.tags ?? []).map(t => t.tag),
        createdAt: conv.createdAt,
        updatedAt: conv.userUpdatedAt,
        customFields: conv.customFields ? Object.fromEntries(conv.customFields.map(f => [f.name, f.value])) : undefined,
      };
      appendJsonl(ticketsFile, ticket);
      counts.tickets++;

      // Hydrate threads (= messages)
      try {
        let threadPage = 1;
        let hasMoreThreads = true;
        while (hasMoreThreads) {
          const threadData = await helpscoutFetch<{
            _embedded: { threads: HSThread[] };
            page: { totalPages: number };
          }>(auth, `/conversations/${conv.id}/threads?page=${threadPage}`);

          for (const t of threadData._embedded.threads) {
            if (!t.body) continue;
            const message: Message = {
              id: `hs-msg-${t.id}`,
              ticketId: `hs-${conv.id}`,
              author: String(t.createdBy?.id ?? 'unknown'),
              body: t.body,
              type: t.type === 'note' ? 'note' : 'reply',
              createdAt: t.createdAt,
            };
            appendJsonl(messagesFile, message);
            counts.messages++;
          }

          hasMoreThreads = threadPage < threadData.page.totalPages;
          threadPage++;
        }
      } catch {
        convSpinner.text = `Exporting conversations... ${counts.tickets} (threads failed for #${conv.id})`;
      }
    }

    convSpinner.text = `Exporting conversations... ${counts.tickets} exported`;
    hasMore = page < data.page.totalPages;
    page++;
  }
  convSpinner.succeed(`${counts.tickets} conversations exported (${counts.messages} messages)`);

  // Export customers
  const customerSpinner = ora('Exporting customers...').start();
  const orgNames = new Set<string>();
  page = 1;
  hasMore = true;

  while (hasMore) {
    const data = await helpscoutFetch<{
      _embedded: { customers: HSCustomer[] };
      page: { totalPages: number };
    }>(auth, `/customers?page=${page}`);

    for (const c of data._embedded.customers) {
      const email = c.emails?.[0]?.value ?? '';
      if (c.organization) orgNames.add(c.organization);
      const customer: Customer = {
        id: `hs-user-${c.id}`,
        externalId: String(c.id),
        source: 'helpscout',
        name: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || email || `Customer ${c.id}`,
        email,
        phone: c.phones?.[0]?.value ?? undefined,
        orgId: c.organization ? `hs-org-${c.organization}` : undefined,
      };
      appendJsonl(customersFile, customer);
      counts.customers++;
    }

    customerSpinner.text = `Exporting customers... ${counts.customers} exported`;
    hasMore = page < data.page.totalPages;
    page++;
  }
  customerSpinner.succeed(`${counts.customers} customers exported`);

  // Export users (agents)
  const userSpinner = ora('Exporting users...').start();
  try {
    page = 1;
    hasMore = true;
    while (hasMore) {
      const data = await helpscoutFetch<{
        _embedded: { users: HSUser[] };
        page: { totalPages: number };
      }>(auth, `/users?page=${page}`);

      for (const u of data._embedded.users) {
        const customer: Customer = {
          id: `hs-agent-${u.id}`,
          externalId: `agent-${u.id}`,
          source: 'helpscout',
          name: `${u.firstName} ${u.lastName}`.trim(),
          email: u.email,
        };
        appendJsonl(customersFile, customer);
        counts.customers++;
      }

      hasMore = page < data.page.totalPages;
      page++;
    }
    userSpinner.succeed('Users exported');
  } catch (err) {
    userSpinner.warn(`Users: ${err instanceof Error ? err.message : 'not available'}`);
  }

  // Write organizations from names collected during customer export
  const orgSpinner = ora('Collecting organizations...').start();
  for (const name of orgNames) {
    const org: Organization = {
      id: `hs-org-${name}`, externalId: name, source: 'helpscout', name, domains: [],
    };
    appendJsonl(orgsFile, org);
    counts.organizations++;
  }
  orgSpinner.succeed(`${counts.organizations} organizations collected`);

  // Export Docs KB articles
  const kbSpinner = ora('Exporting KB articles...').start();
  try {
    const collectionsData = await helpscoutFetch<{
      collections: { items: HSCollection[] };
    }>(auth, '/docs/collections');

    for (const coll of collectionsData.collections.items) {
      page = 1;
      hasMore = true;
      while (hasMore) {
        try {
          const articlesData = await helpscoutFetch<{
            articles: { items: HSArticle[] };
            pages: { totalPages: number };
          }>(auth, `/docs/collections/${coll.id}/articles?page=${page}`);

          for (const a of articlesData.articles.items) {
            const article: KBArticle = {
              id: `hs-kb-${a.id}`,
              externalId: a.id,
              source: 'helpscout',
              title: a.name,
              body: a.text ?? '',
              categoryPath: [coll.name, ...(a.categories ?? []).map(c => c.name)],
            };
            appendJsonl(kbFile, article);
            counts.kbArticles++;
          }

          hasMore = page < articlesData.pages.totalPages;
          page++;
        } catch {
          hasMore = false;
        }
      }
    }
  } catch (err) {
    kbSpinner.warn(`Docs: ${err instanceof Error ? err.message : 'not available'}`);
  }
  if (counts.kbArticles > 0) kbSpinner.succeed(`${counts.kbArticles} articles exported`);
  else kbSpinner.info('0 articles exported');

  // No rules API
  ora('Business rules: not available via Help Scout API').info();

  const manifest: ExportManifest = {
    source: 'helpscout',
    exportedAt: new Date().toISOString(),
    counts,
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(chalk.green(`\nExport complete → ${outDir}/manifest.json`));
  return manifest;
}

// ---- Verify ----

export async function helpscoutVerifyConnection(auth: HelpScoutAuth): Promise<{
  success: boolean;
  userName?: string;
  mailboxCount?: number;
  error?: string;
}> {
  try {
    const mailboxes = await helpscoutFetch<{
      _embedded: { mailboxes: HSMailbox[] };
    }>(auth, '/mailboxes');

    const users = await helpscoutFetch<{
      _embedded: { users: HSUser[] };
    }>(auth, '/users?page=1');

    const me = users._embedded.users[0];
    return {
      success: true,
      userName: me ? `${me.firstName} ${me.lastName}` : 'Unknown',
      mailboxCount: mailboxes._embedded.mailboxes.length,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---- Write operations ----

export async function helpscoutCreateConversation(auth: HelpScoutAuth, mailboxId: number, subject: string, body: string, options?: {
  customerEmail?: string;
  tags?: string[];
  assignTo?: number;
}): Promise<{ id: number }> {
  const conversation: Record<string, unknown> = {
    type: 'email',
    mailboxId,
    subject,
    status: 'active',
    threads: [{
      type: 'customer',
      customer: { email: options?.customerEmail ?? 'unknown@example.com' },
      text: body,
    }],
  };
  if (options?.tags) conversation.tags = options.tags;
  if (options?.assignTo) conversation.assignTo = options.assignTo;

  const result = await helpscoutFetch<{ location: string }>(auth, '/conversations', {
    method: 'POST',
    body: conversation,
  });

  // Extract conversation ID from Location header (e.g., "https://api.helpscout.net/v2/conversations/12345")
  const id = parseInt(result.location?.split('/').pop() ?? '0', 10);
  return { id };
}

export async function helpscoutReply(auth: HelpScoutAuth, conversationId: number, body: string): Promise<void> {
  await helpscoutFetch(auth, `/conversations/${conversationId}/reply`, {
    method: 'POST',
    body: { text: body },
  });
}

export async function helpscoutAddNote(auth: HelpScoutAuth, conversationId: number, body: string): Promise<void> {
  await helpscoutFetch(auth, `/conversations/${conversationId}/notes`, {
    method: 'POST',
    body: { text: body },
  });
}
