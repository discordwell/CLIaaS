import type {
  Ticket, Message, Customer, Organization, KBArticle, Rule, ExportManifest, TicketStatus, TicketPriority,
} from '../schema/types';
import {
  paginateOffset, paginateCursor, setupExport, appendJsonl, writeManifest, exportSpinner,
  type FetchFn,
} from './base/index';

export interface KayakoAuth {
  domain: string;
  email: string;
  password: string;
}

// Session management: Kayako requires X-Session-ID after first auth
let sessionId: string | null = null;

// ---- Kayako API types ----

interface KayakoPaginatedResponse {
  status?: number;
  total_count?: number;
  data: unknown[];
  resource?: string;
}

interface KayakoCase {
  id: number;
  subject: string;
  status: { label: string } | string;
  priority: { label: string } | string | null;
  assigned_agent: { id: number; full_name: string } | null;
  requester: { id: number; full_name: string; email?: string } | null;
  tags: Array<{ name: string }>;
  created_at: string;
  updated_at: string;
}

interface KayakoPost {
  id: number;
  contents: string;
  subject?: string;
  creator: { id: number; full_name?: string; resource_type?: string } | null;
  source: 'API' | 'AGENT' | 'MAIL' | 'MESSENGER' | 'MOBILE' | 'HELPCENTER' | string;
  post_status?: string;
  created_at: string;
}

interface KayakoUser {
  id: number;
  full_name: string;
  emails?: Array<{ email: string; is_primary?: boolean }>;
  phones?: Array<{ number?: string; phone?: string }>;
  organization?: { id: number } | null;
  role?: string;
}

interface KayakoOrg {
  id: number;
  name: string;
  domains?: Array<{ id: number; resource_type: string } | string>;
}

interface KayakoTrigger {
  id: number;
  title: string;
  is_enabled: boolean;
  predicate_collections?: unknown;
  conditions?: unknown;
  actions: unknown;
}

interface KayakoArticle {
  id: number;
  titles?: Array<{ translation: string; locale?: string }>;
  title?: string;
  contents?: Array<{ translation: string; locale?: string }>;
  body?: string;
  section_id?: number;
  section?: { id: number; titles?: Array<{ translation: string }> } | null;
}

// ---- Fetch with session ID capture ----
// Kayako requires response header / body access for session ID management,
// so we keep kayakoFetch as the primary fetch function rather than createClient().

export async function kayakoFetch<T>(auth: KayakoAuth, path: string, options?: {
  method?: string;
  body?: unknown;
}): Promise<T> {
  const url = path.startsWith('http') ? path : `https://${auth.domain}${path}`;
  const credentials = Buffer.from(`${auth.email}:${auth.password}`).toString('base64');

  let retries = 0;
  const maxRetries = 5;

  while (true) {
    const headers: Record<string, string> = {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
    };

    // Include session ID if we have one from a previous request
    if (sessionId) {
      headers['X-Session-ID'] = sessionId;
    }

    const res = await fetch(url, {
      method: options?.method ?? 'GET',
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (res.status === 429) {
      const rawRetryAfter = parseInt(res.headers.get('Retry-After') ?? '10', 10);
      const retryAfter = isNaN(rawRetryAfter) ? 10 : rawRetryAfter;
      if (retries >= maxRetries) throw new Error('Kayako rate limit exceeded after max retries');
      retries++;
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      continue;
    }

    // Handle MFA challenge (403 with OTP_EXPECTED)
    if (res.status === 403) {
      const body = await res.text();
      if (body.includes('OTP_EXPECTED')) {
        throw new Error('Kayako account requires MFA (2FA). Please disable MFA for the API user or use OAuth.');
      }
      throw new Error(`Kayako API forbidden: ${res.status} ${res.statusText} for ${url}`);
    }

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(`Kayako API error: ${res.status} ${res.statusText} for ${url}${errorBody ? ` — ${errorBody.slice(0, 200)}` : ''}`);
    }

    const json = await res.json() as T;

    // Capture session_id from response for subsequent requests
    const jsonAny = json as Record<string, unknown>;
    if (jsonAny && typeof jsonAny === 'object' && 'session_id' in jsonAny && typeof jsonAny.session_id === 'string') {
      sessionId = jsonAny.session_id;
    }

    return json;
  }
}

/** Reset session state (useful between test runs) */
export function resetSession(): void {
  sessionId = null;
}

/**
 * Adapt kayakoFetch to the FetchFn signature expected by base pagination helpers.
 * Wraps kayakoFetch so it can be passed to paginateOffset/paginateCursor.
 */
function createKayakoFetchFn(auth: KayakoAuth): FetchFn {
  return <T>(path: string, options?: { method?: string; body?: unknown }) =>
    kayakoFetch<T>(auth, path, options);
}

// ---- Mapping helpers ----

function getStatusLabel(status: KayakoCase['status']): string {
  if (typeof status === 'string') return status;
  return status?.label ?? 'open';
}

function getPriorityLabel(priority: KayakoCase['priority']): string | null {
  if (!priority) return null;
  if (typeof priority === 'string') return priority;
  return priority?.label ?? null;
}

function mapStatus(label: string): TicketStatus {
  const lower = label.toLowerCase();
  if (lower.includes('new') || lower.includes('open')) return 'open';
  if (lower.includes('pending')) return 'pending';
  if (lower.includes('hold') || lower.includes('wait')) return 'on_hold';
  if (lower.includes('solved') || lower.includes('resolved') || lower.includes('completed')) return 'solved';
  if (lower.includes('closed')) return 'closed';
  return 'open';
}

function mapPriority(label: string | null): TicketPriority {
  if (!label) return 'normal';
  const lower = label.toLowerCase();
  if (lower.includes('low')) return 'low';
  if (lower.includes('high')) return 'high';
  if (lower.includes('urgent') || lower.includes('critical')) return 'urgent';
  return 'normal';
}

// ----- Write Operations -----

export async function kayakoUpdateCase(auth: KayakoAuth, caseId: number, updates: {
  status?: string;
  priority?: string;
  assigned_agent?: number;
  tags?: string[];
}): Promise<void> {
  // Build PATCH body
  const body: Record<string, unknown> = {};
  if (updates.status) body.status = updates.status;
  if (updates.priority) body.priority = updates.priority;
  if (updates.assigned_agent !== undefined) body.assigned_agent = { id: updates.assigned_agent };
  if (updates.tags) body.tags = updates.tags.map(name => ({ name }));

  await kayakoFetch(auth, `/api/v1/cases/${caseId}.json`, {
    method: 'PATCH',
    body,
  });
}

export async function kayakoPostReply(auth: KayakoAuth, caseId: number, contents: string): Promise<void> {
  await kayakoFetch(auth, `/api/v1/cases/${caseId}/reply.json`, {
    method: 'POST',
    body: { contents },
  });
}

export async function kayakoPostNote(auth: KayakoAuth, caseId: number, bodyText: string): Promise<void> {
  await kayakoFetch(auth, `/api/v1/cases/${caseId}/notes.json`, {
    method: 'POST',
    body: { body_text: bodyText },
  });
}

export async function kayakoCreateCase(auth: KayakoAuth, subject: string, contents: string, options?: {
  requester_id?: number;
  priority?: string;
  tags?: string[];
}): Promise<{ id: number }> {
  const body: Record<string, unknown> = {
    subject,
    contents,
  };
  if (options?.requester_id) body.requester = { id: options.requester_id };
  if (options?.priority) body.priority = options.priority;
  if (options?.tags) body.tags = options.tags.map(name => ({ name }));

  const result = await kayakoFetch<{ data: { id: number } }>(auth, '/api/v1/cases.json', {
    method: 'POST',
    body,
  });
  return { id: result.data.id };
}

export async function kayakoVerifyConnection(auth: KayakoAuth): Promise<{
  success: boolean;
  userName?: string;
  caseCount?: number;
  error?: string;
}> {
  try {
    // Test auth by fetching current user (first page of users with limit 1)
    const userData = await kayakoFetch<KayakoPaginatedResponse & { data: KayakoUser[] }>(
      auth,
      '/api/v1/users.json?limit=1',
    );
    const user = userData.data?.[0];

    // Get case count
    const caseData = await kayakoFetch<KayakoPaginatedResponse>(
      auth,
      '/api/v1/cases.json?limit=1',
    );

    return {
      success: true,
      userName: user?.full_name ?? 'Unknown',
      caseCount: caseData.total_count ?? 0,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ----- Export -----

export async function exportKayako(auth: KayakoAuth, outDir: string): Promise<ExportManifest> {
  const files = setupExport(outDir);
  const counts = { tickets: 0, messages: 0, customers: 0, organizations: 0, kbArticles: 0, rules: 0 };
  const fetchFn = createKayakoFetchFn(auth);

  // Reset session for fresh export
  resetSession();

  // Export cases (tickets) — offset-based with nested cursor pagination for posts
  const caseSpinner = exportSpinner('Exporting cases...');

  await paginateOffset<KayakoCase>({
    fetch: fetchFn,
    path: '/api/v1/cases.json',
    limit: 100,
    dataKey: 'data',
    onPage: async (cases) => {
      for (const c of cases) {
        const ticket: Ticket = {
          id: `ky-${c.id}`,
          externalId: String(c.id),
          source: 'kayako',
          subject: c.subject,
          status: mapStatus(getStatusLabel(c.status)),
          priority: mapPriority(getPriorityLabel(c.priority)),
          assignee: c.assigned_agent ? c.assigned_agent.full_name : undefined,
          requester: c.requester?.email ?? String(c.requester?.id ?? 'unknown'),
          tags: (c.tags ?? []).map(t => t.name),
          createdAt: c.created_at,
          updatedAt: c.updated_at,
        };
        appendJsonl(files.tickets, ticket);
        counts.tickets++;

        // Hydrate posts (messages) using cursor pagination (after_id parameter)
        try {
          await paginateCursor<KayakoPost>({
            fetch: fetchFn,
            initialUrl: `/api/v1/cases/${c.id}/posts.json?limit=100`,
            getData: (response) => (response.data as KayakoPost[]) ?? [],
            getNextUrl: (response) => {
              const posts = (response.data as KayakoPost[]) ?? [];
              if (posts.length < 100) return null;
              const lastId = posts[posts.length - 1]?.id;
              return lastId ? `/api/v1/cases/${c.id}/posts.json?after_id=${lastId}&limit=100` : null;
            },
            onPage: (posts) => {
              for (const p of posts) {
                // Determine message type from source field
                // AGENT source = internal/agent message, others = customer reply
                const isAgent = p.source === 'AGENT' || p.source === 'API';
                const message: Message = {
                  id: `ky-msg-${p.id}`,
                  ticketId: `ky-${c.id}`,
                  author: p.creator?.full_name ?? String(p.creator?.id ?? 'unknown'),
                  body: p.contents,
                  type: isAgent ? 'note' : 'reply',
                  createdAt: p.created_at,
                };
                appendJsonl(files.messages, message);
                counts.messages++;
              }
            },
          });
        } catch {
          caseSpinner.text = `Exporting cases... ${counts.tickets} (posts fetch failed for #${c.id})`;
        }

        // Also fetch internal notes separately
        try {
          const notes = await kayakoFetch<KayakoPaginatedResponse & { data: Array<{
            id: number;
            body_text?: string;
            user?: { id: number; full_name?: string } | null;
            created_at: string;
          }> }>(auth, `/api/v1/cases/${c.id}/notes.json?limit=100`);
          for (const n of notes.data) {
            const message: Message = {
              id: `ky-note-${n.id}`,
              ticketId: `ky-${c.id}`,
              author: n.user?.full_name ?? String(n.user?.id ?? 'system'),
              body: n.body_text ?? '',
              type: 'note',
              createdAt: n.created_at,
            };
            appendJsonl(files.messages, message);
            counts.messages++;
          }
        } catch {
          // Notes endpoint may not be available on all Kayako versions
        }
      }

      caseSpinner.text = `Exporting cases... ${counts.tickets} exported`;
    },
  });
  caseSpinner.succeed(`${counts.tickets} cases exported (${counts.messages} messages)`);

  // Export users
  const userSpinner = exportSpinner('Exporting users...');
  await paginateOffset<KayakoUser>({
    fetch: fetchFn,
    path: '/api/v1/users.json',
    limit: 100,
    dataKey: 'data',
    onPage: (users) => {
      for (const u of users) {
        // Emails may be inline or separate identity resources
        // Try inline first, fall back to email from first identity
        let primaryEmail = '';
        if (u.emails && u.emails.length > 0) {
          primaryEmail = u.emails.find(e => e.is_primary)?.email ?? u.emails[0]?.email ?? '';
        }
        const customer: Customer = {
          id: `ky-user-${u.id}`,
          externalId: String(u.id),
          source: 'kayako',
          name: u.full_name,
          email: primaryEmail,
          phone: u.phones?.[0]?.number ?? u.phones?.[0]?.phone,
          orgId: u.organization?.id ? String(u.organization.id) : undefined,
        };
        appendJsonl(files.customers, customer);
        counts.customers++;
      }
      userSpinner.text = `Exporting users... ${counts.customers} exported`;
    },
  });
  userSpinner.succeed(`${counts.customers} users exported`);

  // Export organizations
  const orgSpinner = exportSpinner('Exporting organizations...');
  try {
    await paginateOffset<KayakoOrg>({
      fetch: fetchFn,
      path: '/api/v1/organizations.json',
      limit: 100,
      dataKey: 'data',
      onPage: (orgs) => {
        for (const o of orgs) {
          // Domains are resource references {id, resource_type: "identity_domain"}, not plain strings
          const domainStrings: string[] = (o.domains ?? []).map(d => {
            if (typeof d === 'string') return d;
            return String(d.id); // Store the domain ID; would need /api/v1/identity_domains/:id for actual domain string
          });
          const org: Organization = {
            id: `ky-org-${o.id}`,
            externalId: String(o.id),
            source: 'kayako',
            name: o.name,
            domains: domainStrings,
          };
          appendJsonl(files.organizations, org);
          counts.organizations++;
        }
      },
    });
  } catch (err) {
    orgSpinner.warn(`Organizations: ${err instanceof Error ? err.message : 'endpoint error'}`);
  }
  orgSpinner.succeed(`${counts.organizations} organizations exported`);

  // Export KB articles -- correct endpoint is /api/v1/articles.json (not /helpcenter/articles.json)
  const kbSpinner = exportSpinner('Exporting KB articles...');
  try {
    await paginateOffset<KayakoArticle>({
      fetch: fetchFn,
      path: '/api/v1/articles.json',
      limit: 100,
      dataKey: 'data',
      onPage: (articles) => {
        for (const a of articles) {
          // Articles may have titles/contents as localized arrays OR as direct fields
          const title = a.titles?.[0]?.translation ?? a.title ?? `Article ${a.id}`;
          const body = a.contents?.[0]?.translation ?? a.body ?? '';
          // section is section_id (integer), not a nested object with titles
          const sectionPath: string[] = [];
          if (a.section_id) {
            sectionPath.push(String(a.section_id));
          } else if (a.section) {
            sectionPath.push(a.section.titles?.[0]?.translation ?? String(a.section.id));
          }
          const article: KBArticle = {
            id: `ky-kb-${a.id}`,
            externalId: String(a.id),
            source: 'kayako',
            title,
            body,
            categoryPath: sectionPath,
          };
          appendJsonl(files.kb_articles, article);
          counts.kbArticles++;
        }
      },
    });
  } catch (err) {
    kbSpinner.warn(`KB Articles: ${err instanceof Error ? err.message : 'endpoint error'}`);
  }
  kbSpinner.succeed(`${counts.kbArticles} KB articles exported`);

  // Export triggers -- conditions field is actually predicate_collections
  const rulesSpinner = exportSpinner('Exporting triggers...');
  try {
    const data = await kayakoFetch<KayakoPaginatedResponse & { data: KayakoTrigger[] }>(
      auth,
      '/api/v1/triggers.json?limit=200',
    );
    for (const t of data.data) {
      const rule: Rule = {
        id: `ky-trigger-${t.id}`,
        externalId: String(t.id),
        source: 'kayako',
        type: 'trigger',
        title: t.title,
        conditions: t.predicate_collections ?? t.conditions,
        actions: t.actions,
        active: t.is_enabled,
      };
      appendJsonl(files.rules, rule);
      counts.rules++;
    }
  } catch {
    // Triggers may not be accessible (requires admin/configuration scope)
  }
  rulesSpinner.succeed(`${counts.rules} business rules exported`);

  return writeManifest(outDir, 'kayako', counts);
}
