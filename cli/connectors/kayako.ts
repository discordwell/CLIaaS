import { mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import type {
  Ticket, Message, Customer, Organization, KBArticle, Rule, ExportManifest, TicketStatus, TicketPriority,
} from '../schema/types.js';

export interface KayakoAuth {
  domain: string;
  email: string;
  password: string;
}

// Session management: Kayako requires X-Session-ID after first auth
let sessionId: string | null = null;

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
      if (retries >= maxRetries) throw new Error('Rate limit exceeded after max retries');
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

function appendJsonl(filePath: string, record: unknown): void {
  appendFileSync(filePath, JSON.stringify(record) + '\n');
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

  // Reset session for fresh export
  resetSession();

  // Export cases (tickets)
  const caseSpinner = ora('Exporting cases...').start();
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const data = await kayakoFetch<KayakoPaginatedResponse & { data: KayakoCase[] }>(
      auth,
      `/api/v1/cases.json?offset=${offset}&limit=${limit}`,
    );

    for (const c of data.data) {
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
      appendJsonl(ticketsFile, ticket);
      counts.tickets++;

      // Hydrate posts (messages) for each case using cursor pagination
      try {
        let afterId: number | null = null;
        let hasMorePosts = true;
        while (hasMorePosts) {
          const postsUrl: string = afterId
            ? `/api/v1/cases/${c.id}/posts.json?after_id=${afterId}&limit=100`
            : `/api/v1/cases/${c.id}/posts.json?limit=100`;
          const posts: KayakoPaginatedResponse & { data: KayakoPost[] } = await kayakoFetch<KayakoPaginatedResponse & { data: KayakoPost[] }>(
            auth,
            postsUrl,
          );
          for (const p of posts.data as KayakoPost[]) {
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
            appendJsonl(messagesFile, message);
            counts.messages++;
            afterId = p.id; // Track last ID for cursor pagination
          }
          hasMorePosts = posts.data.length === 100;
        }
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
          appendJsonl(messagesFile, message);
          counts.messages++;
        }
      } catch {
        // Notes endpoint may not be available on all Kayako versions
      }
    }

    caseSpinner.text = `Exporting cases... ${counts.tickets} exported`;
    hasMore = data.data.length === limit;
    offset += limit;
  }
  caseSpinner.succeed(`${counts.tickets} cases exported (${counts.messages} messages)`);

  // Export users
  const userSpinner = ora('Exporting users...').start();
  offset = 0;
  hasMore = true;
  while (hasMore) {
    const data = await kayakoFetch<KayakoPaginatedResponse & { data: KayakoUser[] }>(
      auth,
      `/api/v1/users.json?offset=${offset}&limit=${limit}`,
    );
    for (const u of data.data) {
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
      appendJsonl(customersFile, customer);
      counts.customers++;
    }
    userSpinner.text = `Exporting users... ${counts.customers} exported`;
    hasMore = data.data.length === limit;
    offset += limit;
  }
  userSpinner.succeed(`${counts.customers} users exported`);

  // Export organizations
  const orgSpinner = ora('Exporting organizations...').start();
  offset = 0;
  hasMore = true;
  while (hasMore) {
    try {
      const data = await kayakoFetch<KayakoPaginatedResponse & { data: KayakoOrg[] }>(
        auth,
        `/api/v1/organizations.json?offset=${offset}&limit=${limit}`,
      );
      for (const o of data.data) {
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
        appendJsonl(orgsFile, org);
        counts.organizations++;
      }
      hasMore = data.data.length === limit;
      offset += limit;
    } catch (err) {
      orgSpinner.warn(`Organizations: ${err instanceof Error ? err.message : 'endpoint error'}`);
      hasMore = false;
    }
  }
  orgSpinner.succeed(`${counts.organizations} organizations exported`);

  // Export KB articles — correct endpoint is /api/v1/articles.json (not /helpcenter/articles.json)
  const kbSpinner = ora('Exporting KB articles...').start();
  offset = 0;
  hasMore = true;
  while (hasMore) {
    try {
      const data = await kayakoFetch<KayakoPaginatedResponse & { data: KayakoArticle[] }>(
        auth,
        `/api/v1/articles.json?offset=${offset}&limit=${limit}`,
      );
      for (const a of data.data) {
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
        appendJsonl(kbFile, article);
        counts.kbArticles++;
      }
      hasMore = data.data.length === limit;
      offset += limit;
    } catch (err) {
      kbSpinner.warn(`KB Articles: ${err instanceof Error ? err.message : 'endpoint error'}`);
      hasMore = false;
    }
  }
  kbSpinner.succeed(`${counts.kbArticles} KB articles exported`);

  // Export triggers — conditions field is actually predicate_collections
  const rulesSpinner = ora('Exporting triggers...').start();
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
      appendJsonl(rulesFile, rule);
      counts.rules++;
    }
  } catch {
    // Triggers may not be accessible (requires admin/configuration scope)
  }
  rulesSpinner.succeed(`${counts.rules} business rules exported`);

  const manifest: ExportManifest = {
    source: 'kayako',
    exportedAt: new Date().toISOString(),
    counts,
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(chalk.green(`\nExport complete → ${outDir}/manifest.json`));
  return manifest;
}
