import type {
  Ticket, Message, Customer, Organization, KBArticle, ExportManifest, TicketStatus,
} from '../schema/types.js';
import {
  createClient, paginatePages, setupExport, appendJsonl, writeManifest, exportSpinner,
  type FetchFn,
} from './base/index.js';

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

// ---- OAuth2 token management (helpscout-specific) ----

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

// ---- Client ----

function createHelpScoutClient(auth: HelpScoutAuth) {
  return createClient({
    baseUrl: 'https://api.helpscout.net/v2',
    authHeaders: async () => ({ Authorization: `Bearer ${await getAccessToken(auth)}` }),
    sourceName: 'Help Scout',
    defaultRetryAfterSeconds: 10,
  });
}

/**
 * Create a fetch adapter that unwraps Help Scout's _embedded pagination responses
 * into the flat structure expected by paginatePages().
 *
 * Help Scout returns: { _embedded: { <key>: [...] }, page: { totalPages: N } }
 * paginatePages expects: { <key>: [...], totalPages: N }
 */
function createHSPaginatedFetch(baseFetch: FetchFn, embeddedKey: string): FetchFn {
  return async <T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> => {
    const response = await baseFetch<Record<string, unknown>>(path, options);
    const embedded = response._embedded as Record<string, unknown> | undefined;
    const page = response.page as { totalPages: number } | undefined;

    return {
      [embeddedKey]: embedded?.[embeddedKey] ?? [],
      totalPages: page?.totalPages ?? 1,
    } as T;
  };
}

/** @deprecated Use createHelpScoutClient() + client.request() instead. Kept for backward compatibility. */
export async function helpscoutFetch<T>(auth: HelpScoutAuth, path: string, options?: {
  method?: string;
  body?: unknown;
}): Promise<T> {
  return createHelpScoutClient(auth).request<T>(path, options);
}

// ---- Mapping helpers ----

function mapStatus(status: string): TicketStatus {
  const map: Record<string, TicketStatus> = {
    active: 'open', pending: 'pending', closed: 'closed', spam: 'closed',
  };
  return map[status] ?? 'open';
}

// ---- Export ----

export async function exportHelpScout(auth: HelpScoutAuth, outDir: string): Promise<ExportManifest> {
  const client = createHelpScoutClient(auth);
  const files = setupExport(outDir);
  const counts = { tickets: 0, messages: 0, customers: 0, organizations: 0, kbArticles: 0, rules: 0 };

  // Export conversations (= tickets)
  const convSpinner = exportSpinner('Exporting conversations...');
  const convFetch = createHSPaginatedFetch(client.request.bind(client), 'conversations');

  await paginatePages<HSConversation>({
    fetch: convFetch,
    path: '/conversations?status=all',
    dataKey: 'conversations',
    totalPagesKey: 'totalPages',
    onPage: async (conversations) => {
      for (const conv of conversations) {
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
        appendJsonl(files.tickets, ticket);
        counts.tickets++;

        // Hydrate threads (= messages)
        const threadFetch = createHSPaginatedFetch(client.request.bind(client), 'threads');
        try {
          await paginatePages<HSThread>({
            fetch: threadFetch,
            path: `/conversations/${conv.id}/threads`,
            dataKey: 'threads',
            totalPagesKey: 'totalPages',
            onPage: (threads) => {
              for (const t of threads) {
                if (!t.body) continue;
                const message: Message = {
                  id: `hs-msg-${t.id}`,
                  ticketId: `hs-${conv.id}`,
                  author: String(t.createdBy?.id ?? 'unknown'),
                  body: t.body,
                  type: t.type === 'note' ? 'note' : 'reply',
                  createdAt: t.createdAt,
                };
                appendJsonl(files.messages, message);
                counts.messages++;
              }
            },
          });
        } catch {
          convSpinner.text = `Exporting conversations... ${counts.tickets} (threads failed for #${conv.id})`;
        }
      }
      convSpinner.text = `Exporting conversations... ${counts.tickets} exported`;
    },
  });
  convSpinner.succeed(`${counts.tickets} conversations exported (${counts.messages} messages)`);

  // Export customers
  const customerSpinner = exportSpinner('Exporting customers...');
  const orgNames = new Set<string>();
  const customerFetch = createHSPaginatedFetch(client.request.bind(client), 'customers');

  await paginatePages<HSCustomer>({
    fetch: customerFetch,
    path: '/customers',
    dataKey: 'customers',
    totalPagesKey: 'totalPages',
    onPage: (customers) => {
      for (const c of customers) {
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
        appendJsonl(files.customers, customer);
        counts.customers++;
      }
      customerSpinner.text = `Exporting customers... ${counts.customers} exported`;
    },
  });
  customerSpinner.succeed(`${counts.customers} customers exported`);

  // Export users (agents)
  const userSpinner = exportSpinner('Exporting users...');
  const userFetch = createHSPaginatedFetch(client.request.bind(client), 'users');
  try {
    await paginatePages<HSUser>({
      fetch: userFetch,
      path: '/users',
      dataKey: 'users',
      totalPagesKey: 'totalPages',
      onPage: (users) => {
        for (const u of users) {
          const customer: Customer = {
            id: `hs-agent-${u.id}`,
            externalId: `agent-${u.id}`,
            source: 'helpscout',
            name: `${u.firstName} ${u.lastName}`.trim(),
            email: u.email,
          };
          appendJsonl(files.customers, customer);
          counts.customers++;
        }
      },
    });
    userSpinner.succeed('Users exported');
  } catch (err) {
    userSpinner.warn(`Users: ${err instanceof Error ? err.message : 'not available'}`);
  }

  // Write organizations from names collected during customer export
  const orgSpinner = exportSpinner('Collecting organizations...');
  for (const name of orgNames) {
    const org: Organization = {
      id: `hs-org-${name}`, externalId: name, source: 'helpscout', name, domains: [],
    };
    appendJsonl(files.organizations, org);
    counts.organizations++;
  }
  orgSpinner.succeed(`${counts.organizations} organizations collected`);

  // Export Docs KB articles
  const kbSpinner = exportSpinner('Exporting KB articles...');
  try {
    const collectionsData = await client.request<{
      collections: { items: HSCollection[] };
    }>('/docs/collections');

    for (const coll of collectionsData.collections.items) {
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        try {
          const articlesData = await client.request<{
            articles: { items: HSArticle[] };
            pages: { totalPages: number };
          }>(`/docs/collections/${coll.id}/articles?page=${page}`);

          for (const a of articlesData.articles.items) {
            const article: KBArticle = {
              id: `hs-kb-${a.id}`,
              externalId: a.id,
              source: 'helpscout',
              title: a.name,
              body: a.text ?? '',
              categoryPath: [coll.name, ...(a.categories ?? []).map(c => c.name)],
            };
            appendJsonl(files.kb_articles, article);
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
  exportSpinner('Business rules: not available via Help Scout API').info();

  return writeManifest(outDir, 'helpscout', counts);
}

// ---- Verify ----

export async function helpscoutVerifyConnection(auth: HelpScoutAuth): Promise<{
  success: boolean;
  userName?: string;
  mailboxCount?: number;
  error?: string;
}> {
  try {
    const client = createHelpScoutClient(auth);

    const mailboxes = await client.request<{
      _embedded: { mailboxes: HSMailbox[] };
    }>('/mailboxes');

    const users = await client.request<{
      _embedded: { users: HSUser[] };
    }>('/users?page=1');

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

  // Help Scout returns 201 with no JSON body, only a Location header.
  // The base client can't surface headers, so we fetch directly for this endpoint.
  const token = await getAccessToken(auth);
  const res = await fetch('https://api.helpscout.net/v2/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(conversation),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error(`Help Scout API error: ${res.status} ${res.statusText}${errorBody ? ` — ${errorBody.slice(0, 200)}` : ''}`);
  }

  // Extract conversation ID from Location header (e.g., "https://api.helpscout.net/v2/conversations/12345")
  const location = res.headers.get('Location') ?? '';
  const id = parseInt(location.split('/').pop() ?? '0', 10);
  return { id };
}

export async function helpscoutReply(auth: HelpScoutAuth, conversationId: number, body: string): Promise<void> {
  await createHelpScoutClient(auth).request(`/conversations/${conversationId}/reply`, {
    method: 'POST',
    body: { text: body },
  });
}

export async function helpscoutAddNote(auth: HelpScoutAuth, conversationId: number, body: string): Promise<void> {
  await createHelpScoutClient(auth).request(`/conversations/${conversationId}/notes`, {
    method: 'POST',
    body: { text: body },
  });
}
