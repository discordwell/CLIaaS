import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import type {
  Ticket, Message, Customer, Organization, KBArticle, Rule, ExportManifest, TicketStatus, TicketPriority,
} from '../schema/types.js';

export interface ZendeskAuth {
  subdomain: string;
  email: string;
  token: string;
}

interface ZendeskPaginatedResponse {
  end_of_stream?: boolean;
  after_cursor?: string;
  count?: number;
}

interface ZendeskTicketResponse extends ZendeskPaginatedResponse {
  tickets: ZendeskTicket[];
}

interface ZendeskUserResponse extends ZendeskPaginatedResponse {
  users: ZendeskUser[];
}


interface ZendeskTicket {
  id: number;
  subject: string;
  status: string;
  priority: string | null;
  assignee_id: number | null;
  requester_id: number;
  tags: string[];
  created_at: string;
  updated_at: string;
  custom_fields?: Array<{ id: number; value: unknown }>;
}

interface ZendeskUser {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  organization_id: number | null;
}

interface ZendeskOrg {
  id: number;
  name: string;
  domain_names: string[];
}

interface ZendeskComment {
  id: number;
  author_id: number;
  body: string;
  html_body: string;
  public: boolean;
  created_at: string;
}

interface ZendeskCommentsResponse {
  comments: ZendeskComment[];
  next_page: string | null;
}

interface ZendeskArticle {
  id: number;
  title: string;
  body: string;
  section_id: number;
}

interface ZendeskArticlesResponse {
  articles: ZendeskArticle[];
  next_page: string | null;
}

interface ZendeskMacro {
  id: number;
  title: string;
  active: boolean;
  restriction: unknown;
  actions: unknown[];
}

interface ZendeskTrigger {
  id: number;
  title: string;
  active: boolean;
  conditions: unknown;
  actions: unknown[];
}

interface ZendeskAutomation {
  id: number;
  title: string;
  active: boolean;
  conditions: unknown;
  actions: unknown[];
}

interface ZendeskSLAPolicy {
  id: number;
  title: string;
  filter: unknown;
  policy_metrics: unknown[];
}

export async function zendeskFetch<T>(auth: ZendeskAuth, path: string, options?: {
  method?: string;
  body?: unknown;
}): Promise<T> {
  const url = path.startsWith('http') ? path : `https://${auth.subdomain}.zendesk.com${path}`;
  const credentials = Buffer.from(`${auth.email}/token:${auth.token}`).toString('base64');

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
      const rawRetryAfter = parseInt(res.headers.get('Retry-After') ?? '10', 10);
      const retryAfter = isNaN(rawRetryAfter) ? 10 : rawRetryAfter;
      if (retries >= maxRetries) throw new Error('Rate limit exceeded after max retries');
      retries++;
      await sleep(retryAfter * 1000);
      continue;
    }

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(`Zendesk API error: ${res.status} ${res.statusText} for ${url}${errorBody ? ` — ${errorBody.slice(0, 200)}` : ''}`);
    }

    return res.json() as Promise<T>;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mapStatus(status: string): TicketStatus {
  const map: Record<string, TicketStatus> = {
    new: 'open', open: 'open', pending: 'pending',
    hold: 'on_hold', solved: 'solved', closed: 'closed',
  };
  return map[status] ?? 'open';
}

function mapPriority(priority: string | null): TicketPriority {
  if (!priority) return 'normal';
  const map: Record<string, TicketPriority> = {
    low: 'low', normal: 'normal', high: 'high', urgent: 'urgent',
  };
  return map[priority] ?? 'normal';
}

function appendJsonl(filePath: string, record: unknown): void {
  appendFileSync(filePath, JSON.stringify(record) + '\n');
}

export async function exportZendesk(auth: ZendeskAuth, outDir: string, cursorState?: Record<string, string>): Promise<ExportManifest> {
  mkdirSync(outDir, { recursive: true });

  const ticketsFile = join(outDir, 'tickets.jsonl');
  const messagesFile = join(outDir, 'messages.jsonl');
  const customersFile = join(outDir, 'customers.jsonl');
  const orgsFile = join(outDir, 'organizations.jsonl');
  const kbFile = join(outDir, 'kb_articles.jsonl');
  const rulesFile = join(outDir, 'rules.jsonl');

  // Clear existing files if no cursor state (full export)
  if (!cursorState) {
    for (const f of [ticketsFile, messagesFile, customersFile, orgsFile, kbFile, rulesFile]) {
      writeFileSync(f, '');
    }
  }

  const counts = { tickets: 0, messages: 0, customers: 0, organizations: 0, kbArticles: 0, rules: 0 };
  const newCursorState: Record<string, string> = { ...cursorState };

  // Export tickets with cursor-based pagination
  const ticketSpinner = ora('Exporting tickets...').start();
  let ticketUrl = cursorState?.ticketCursor
    ? `/api/v2/incremental/tickets/cursor.json?cursor=${cursorState.ticketCursor}`
    : '/api/v2/incremental/tickets/cursor.json?start_time=0';
  let ticketEndOfStream = false;

  while (!ticketEndOfStream) {
    const data = await zendeskFetch<ZendeskTicketResponse>(auth, ticketUrl);

    for (const t of data.tickets) {
      const ticket: Ticket = {
        id: `zd-${t.id}`,
        externalId: String(t.id),
        source: 'zendesk',
        subject: t.subject,
        status: mapStatus(t.status),
        priority: mapPriority(t.priority),
        assignee: t.assignee_id ? String(t.assignee_id) : undefined,
        requester: String(t.requester_id),
        tags: t.tags,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        customFields: t.custom_fields ? Object.fromEntries(t.custom_fields.map(f => [String(f.id), f.value])) : undefined,
      };
      appendJsonl(ticketsFile, ticket);
      counts.tickets++;

      // Hydrate comments for each ticket
      try {
        let commentsUrl: string | null = `/api/v2/tickets/${t.id}/comments.json`;
        while (commentsUrl) {
          const commentsData: ZendeskCommentsResponse = await zendeskFetch<ZendeskCommentsResponse>(auth, commentsUrl);
          for (const c of commentsData.comments) {
            const message: Message = {
              id: `zd-msg-${c.id}`,
              ticketId: `zd-${t.id}`,
              author: String(c.author_id),
              body: c.body,
              bodyHtml: c.html_body,
              type: c.public ? 'reply' : 'note',
              createdAt: c.created_at,
            };
            appendJsonl(messagesFile, message);
            counts.messages++;
          }
          commentsUrl = commentsData.next_page;
        }
      } catch {
        // Log but continue — individual ticket comment failures shouldn't halt export
        ticketSpinner.text = `Exporting tickets... ${counts.tickets} (comment fetch failed for #${t.id})`;
      }
    }

    ticketSpinner.text = `Exporting tickets... ${counts.tickets} exported`;
    ticketEndOfStream = data.end_of_stream ?? true;
    if (data.after_cursor) {
      newCursorState.ticketCursor = data.after_cursor;
      ticketUrl = `/api/v2/incremental/tickets/cursor.json?cursor=${data.after_cursor}`;
    } else {
      ticketEndOfStream = true;
    }
  }
  ticketSpinner.succeed(`${counts.tickets} tickets exported (${counts.messages} messages)`);

  // Export users
  const userSpinner = ora('Exporting users...').start();
  let userUrl = cursorState?.userCursor
    ? `/api/v2/incremental/users/cursor.json?cursor=${cursorState.userCursor}`
    : '/api/v2/incremental/users/cursor.json?start_time=0';
  let userEndOfStream = false;

  while (!userEndOfStream) {
    const data = await zendeskFetch<ZendeskUserResponse>(auth, userUrl);

    for (const u of data.users) {
      const customer: Customer = {
        id: `zd-user-${u.id}`,
        externalId: String(u.id),
        source: 'zendesk',
        name: u.name,
        email: u.email,
        phone: u.phone ?? undefined,
        orgId: u.organization_id ? String(u.organization_id) : undefined,
      };
      appendJsonl(customersFile, customer);
      counts.customers++;
    }

    userSpinner.text = `Exporting users... ${counts.customers} exported`;
    userEndOfStream = data.end_of_stream ?? true;
    if (data.after_cursor) {
      newCursorState.userCursor = data.after_cursor;
      userUrl = `/api/v2/incremental/users/cursor.json?cursor=${data.after_cursor}`;
    } else {
      userEndOfStream = true;
    }
  }
  userSpinner.succeed(`${counts.customers} users exported`);

  // Export organizations
  const orgSpinner = ora('Exporting organizations...').start();
  try {
    let orgPage: string | null = '/api/v2/organizations.json?page[size]=100';
    while (orgPage) {
      const data: { organizations: ZendeskOrg[]; links: { next?: string } } = await zendeskFetch(auth, orgPage);
      for (const o of data.organizations) {
        const org: Organization = {
          id: `zd-org-${o.id}`,
          externalId: String(o.id),
          source: 'zendesk',
          name: o.name,
          domains: o.domain_names,
        };
        appendJsonl(orgsFile, org);
        counts.organizations++;
      }
      orgPage = data.links?.next ?? null;
    }
  } catch (err) {
    orgSpinner.warn(`Organizations: ${err instanceof Error ? err.message : 'endpoint not available'}`);
  }
  if (counts.organizations > 0) orgSpinner.succeed(`${counts.organizations} organizations exported`);
  else orgSpinner.info('0 organizations exported (endpoint may not be available)');

  // Export KB articles
  const kbSpinner = ora('Exporting KB articles...').start();
  try {
    let articlesUrl: string | null = '/api/v2/help_center/articles.json?per_page=100';
    while (articlesUrl) {
      const data: ZendeskArticlesResponse = await zendeskFetch<ZendeskArticlesResponse>(auth, articlesUrl);
      for (const a of data.articles) {
        const article: KBArticle = {
          id: `zd-kb-${a.id}`,
          externalId: String(a.id),
          source: 'zendesk',
          title: a.title,
          body: a.body,
          categoryPath: [String(a.section_id)],
        };
        appendJsonl(kbFile, article);
        counts.kbArticles++;
      }
      articlesUrl = data.next_page;
    }
  } catch (err) {
    kbSpinner.warn(`KB Articles: ${err instanceof Error ? err.message : 'Help Center not enabled'}`);
  }
  if (counts.kbArticles > 0) kbSpinner.succeed(`${counts.kbArticles} KB articles exported`);
  else kbSpinner.info('0 KB articles exported (Help Center may not be enabled)');

  // Export business rules
  const rulesSpinner = ora('Exporting business rules...').start();
  try {
    // Macros
    const macros = await zendeskFetch<{ macros: ZendeskMacro[] }>(auth, '/api/v2/macros.json');
    for (const m of macros.macros) {
      const rule: Rule = {
        id: `zd-macro-${m.id}`, externalId: String(m.id), source: 'zendesk',
        type: 'macro', title: m.title, conditions: m.restriction, actions: m.actions, active: m.active,
      };
      appendJsonl(rulesFile, rule);
      counts.rules++;
    }
  } catch { /* endpoint may require admin access */ }
  try {
    // Triggers
    const triggers = await zendeskFetch<{ triggers: ZendeskTrigger[] }>(auth, '/api/v2/triggers.json');
    for (const t of triggers.triggers) {
      const rule: Rule = {
        id: `zd-trigger-${t.id}`, externalId: String(t.id), source: 'zendesk',
        type: 'trigger', title: t.title, conditions: t.conditions, actions: t.actions, active: t.active,
      };
      appendJsonl(rulesFile, rule);
      counts.rules++;
    }
  } catch { /* endpoint may require admin access */ }
  try {
    // Automations
    const autos = await zendeskFetch<{ automations: ZendeskAutomation[] }>(auth, '/api/v2/automations.json');
    for (const a of autos.automations) {
      const rule: Rule = {
        id: `zd-auto-${a.id}`, externalId: String(a.id), source: 'zendesk',
        type: 'automation', title: a.title, conditions: a.conditions, actions: a.actions, active: a.active,
      };
      appendJsonl(rulesFile, rule);
      counts.rules++;
    }
  } catch { /* endpoint may require admin access */ }
  try {
    // SLA Policies
    const slas = await zendeskFetch<{ sla_policies: ZendeskSLAPolicy[] }>(auth, '/api/v2/slas/policies.json');
    for (const s of slas.sla_policies) {
      const rule: Rule = {
        id: `zd-sla-${s.id}`, externalId: String(s.id), source: 'zendesk',
        type: 'sla', title: s.title, conditions: s.filter, actions: s.policy_metrics, active: true,
      };
      appendJsonl(rulesFile, rule);
      counts.rules++;
    }
  } catch { /* endpoint may require admin access */ }
  rulesSpinner.succeed(`${counts.rules} business rules exported`);

  const manifest: ExportManifest = {
    source: 'zendesk',
    exportedAt: new Date().toISOString(),
    counts,
    cursorState: newCursorState,
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(chalk.green(`\nExport complete → ${outDir}/manifest.json`));
  return manifest;
}

export function loadManifest(outDir: string): ExportManifest | null {
  const manifestPath = join(outDir, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

// ----- Write Operations -----

export async function zendeskUpdateTicket(auth: ZendeskAuth, ticketId: number, updates: {
  status?: string;
  priority?: string;
  assignee_id?: number;
  tags?: string[];
  subject?: string;
  custom_fields?: Array<{ id: number; value: unknown }>;
}): Promise<void> {
  await zendeskFetch(auth, `/api/v2/tickets/${ticketId}.json`, {
    method: 'PUT',
    body: { ticket: updates },
  });
}

export async function zendeskPostComment(auth: ZendeskAuth, ticketId: number, body: string, isPublic = true): Promise<void> {
  await zendeskFetch(auth, `/api/v2/tickets/${ticketId}.json`, {
    method: 'PUT',
    body: {
      ticket: {
        comment: {
          body,
          public: isPublic,
        },
      },
    },
  });
}

export async function zendeskCreateTicket(auth: ZendeskAuth, subject: string, body: string, options?: {
  requester_id?: number;
  priority?: string;
  tags?: string[];
  assignee_id?: number;
}): Promise<{ id: number }> {
  const ticket: Record<string, unknown> = {
    subject,
    comment: { body },
  };
  if (options?.requester_id) ticket.requester_id = options.requester_id;
  if (options?.priority) ticket.priority = options.priority;
  if (options?.tags) ticket.tags = options.tags;
  if (options?.assignee_id) ticket.assignee_id = options.assignee_id;

  const result = await zendeskFetch<{ ticket: { id: number } }>(auth, '/api/v2/tickets.json', {
    method: 'POST',
    body: { ticket },
  });
  return { id: result.ticket.id };
}

export async function zendeskVerifyConnection(auth: ZendeskAuth): Promise<{
  success: boolean;
  userName?: string;
  ticketCount?: number;
  plan?: string;
  error?: string;
}> {
  try {
    // Test auth by getting current user
    const me = await zendeskFetch<{ user: { name: string; email: string; role: string } }>(
      auth,
      '/api/v2/users/me.json',
    );

    // Get ticket count
    const countData = await zendeskFetch<{ count: { value: number } }>(
      auth,
      '/api/v2/tickets/count.json',
    );

    return {
      success: true,
      userName: me.user.name,
      ticketCount: countData.count.value,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
