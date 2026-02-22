import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import type {
  Ticket,
  Message,
  Attachment,
  Customer,
  Organization,
  KBArticle,
  Rule,
  Group,
  CustomField,
  View,
  SLAPolicy,
  TicketForm,
  Brand,
  AuditEvent,
  CSATRating,
  TimeEntry,
  ExportManifest,
  TicketStatus,
  TicketPriority,
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
  group_id?: number | null;
  brand_id?: number | null;
  ticket_form_id?: number | null;
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
  attachments?: ZendeskAttachment[];
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

interface ZendeskGroup {
  id: number;
  name: string;
}

interface ZendeskView {
  id: number;
  title: string;
  active: boolean;
  conditions: unknown;
  execution?: unknown;
}

interface ZendeskTicketField {
  id: number;
  title: string;
  type: string;
  required: boolean;
  custom_field_options?: Array<{ name: string; value: string }>;
}

interface ZendeskTicketForm {
  id: number;
  name: string;
  active: boolean;
  position?: number;
  ticket_field_ids?: number[];
}

interface ZendeskBrand {
  id: number;
  name: string;
  subdomain?: string;
}

interface ZendeskAttachment {
  id: number;
  file_name: string;
  content_type: string;
  size: number;
  content_url: string;
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

interface ZendeskAudit {
  id: number;
  ticket_id: number;
  author_id: number | null;
  created_at: string;
  events: Array<{ type: string }>;
}

interface ZendeskCSAT {
  id: number;
  score: string | null;
  comment: string | null;
  ticket_id: number;
  created_at: string;
  updated_at: string;
}

interface ZendeskTimeEntry {
  id: number;
  ticket_id: number;
  user_id: number | null;
  time_spent: number;
  created_at: string;
  updated_at: string;
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

    if (res.status === 204) return {} as T;
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
  const groupsFile = join(outDir, 'groups.jsonl');
  const fieldsFile = join(outDir, 'custom_fields.jsonl');
  const viewsFile = join(outDir, 'views.jsonl');
  const slaPoliciesFile = join(outDir, 'sla_policies.jsonl');
  const formsFile = join(outDir, 'ticket_forms.jsonl');
  const brandsFile = join(outDir, 'brands.jsonl');
  const auditsFile = join(outDir, 'audit_events.jsonl');
  const csatFile = join(outDir, 'csat_ratings.jsonl');
  const timeEntriesFile = join(outDir, 'time_entries.jsonl');
  const customersFile = join(outDir, 'customers.jsonl');
  const orgsFile = join(outDir, 'organizations.jsonl');
  const kbFile = join(outDir, 'kb_articles.jsonl');
  const rulesFile = join(outDir, 'rules.jsonl');

  // Clear existing files if no cursor state (full export)
  if (!cursorState) {
    for (const f of [ticketsFile, messagesFile, groupsFile, fieldsFile, viewsFile, slaPoliciesFile, formsFile, brandsFile, auditsFile, csatFile, timeEntriesFile, customersFile, orgsFile, kbFile, rulesFile]) {
      writeFileSync(f, '');
    }
  }

  const counts = {
    tickets: 0,
    messages: 0,
    attachments: 0,
    customers: 0,
    organizations: 0,
    kbArticles: 0,
    rules: 0,
    groups: 0,
    customFields: 0,
    views: 0,
    slaPolicies: 0,
    ticketForms: 0,
    brands: 0,
    auditEvents: 0,
    csatRatings: 0,
    timeEntries: 0,
  };
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
        groupId: t.group_id ? String(t.group_id) : undefined,
        brandId: t.brand_id ? String(t.brand_id) : undefined,
        ticketFormId: t.ticket_form_id ? String(t.ticket_form_id) : undefined,
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
            let attachments: Attachment[] | undefined;
            if (c.attachments && c.attachments.length > 0) {
              attachments = c.attachments.map((a) => ({
                id: `zd-att-${a.id}`,
                externalId: String(a.id),
                messageId: `zd-msg-${c.id}`,
                filename: a.file_name,
                size: a.size,
                contentType: a.content_type,
                contentUrl: a.content_url,
              }));
              counts.attachments += attachments.length;
            }
            const message: Message = {
              id: `zd-msg-${c.id}`,
              ticketId: `zd-${t.id}`,
              author: String(c.author_id),
              body: c.body,
              bodyHtml: c.html_body,
              type: c.public ? 'reply' : 'note',
              createdAt: c.created_at,
              attachments,
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

  // Export groups
  const groupSpinner = ora('Exporting groups...').start();
  try {
    let groupUrl: string | null = '/api/v2/groups.json?page[size]=100';
    while (groupUrl) {
      const data: { groups: ZendeskGroup[]; next_page: string | null } = await zendeskFetch(auth, groupUrl);
      for (const g of data.groups) {
        const group: Group = {
          id: `zd-group-${g.id}`,
          externalId: String(g.id),
          source: 'zendesk',
          name: g.name,
        };
        appendJsonl(groupsFile, group);
        counts.groups++;
      }
      groupUrl = data.next_page;
    }
  } catch (err) {
    groupSpinner.warn(`Groups: ${err instanceof Error ? err.message : 'endpoint not available'}`);
  }
  if (counts.groups > 0) groupSpinner.succeed(`${counts.groups} groups exported`);
  else groupSpinner.info('0 groups exported (endpoint may not be available)');

  // Export ticket fields
  const fieldSpinner = ora('Exporting ticket fields...').start();
  try {
    let fieldsUrl: string | null = '/api/v2/ticket_fields.json?page[size]=100';
    while (fieldsUrl) {
      const data: { ticket_fields: ZendeskTicketField[]; next_page: string | null } = await zendeskFetch(auth, fieldsUrl);
      for (const f of data.ticket_fields) {
        const field: CustomField = {
          id: `zd-field-${f.id}`,
          externalId: String(f.id),
          source: 'zendesk',
          objectType: 'ticket',
          name: f.title,
          fieldType: f.type,
          required: f.required,
          options: f.custom_field_options?.map((o) => ({ value: o.value, label: o.name })) ?? undefined,
        };
        appendJsonl(fieldsFile, field);
        counts.customFields++;
      }
      fieldsUrl = data.next_page;
    }
  } catch (err) {
    fieldSpinner.warn(`Ticket fields: ${err instanceof Error ? err.message : 'endpoint not available'}`);
  }
  if (counts.customFields > 0) fieldSpinner.succeed(`${counts.customFields} ticket fields exported`);
  else fieldSpinner.info('0 ticket fields exported (endpoint may not be available)');

  // Export views
  const viewSpinner = ora('Exporting views...').start();
  try {
    let viewsUrl: string | null = '/api/v2/views.json?page[size]=100';
    while (viewsUrl) {
      const data: { views: ZendeskView[]; next_page: string | null } = await zendeskFetch(auth, viewsUrl);
      for (const v of data.views) {
        const view: View = {
          id: `zd-view-${v.id}`,
          externalId: String(v.id),
          source: 'zendesk',
          name: v.title,
          query: v.conditions ?? v.execution ?? null,
          active: v.active,
        };
        appendJsonl(viewsFile, view);
        counts.views++;
      }
      viewsUrl = data.next_page;
    }
  } catch (err) {
    viewSpinner.warn(`Views: ${err instanceof Error ? err.message : 'endpoint not available'}`);
  }
  if (counts.views > 0) viewSpinner.succeed(`${counts.views} views exported`);
  else viewSpinner.info('0 views exported (endpoint may not be available)');

  // Export ticket forms
  const formSpinner = ora('Exporting ticket forms...').start();
  try {
    let formsUrl: string | null = '/api/v2/ticket_forms.json?page[size]=100';
    while (formsUrl) {
      const data: { ticket_forms: ZendeskTicketForm[]; next_page: string | null } = await zendeskFetch(auth, formsUrl);
      for (const f of data.ticket_forms) {
        const form: TicketForm = {
          id: `zd-form-${f.id}`,
          externalId: String(f.id),
          source: 'zendesk',
          name: f.name,
          active: f.active,
          position: f.position,
          fieldIds: f.ticket_field_ids,
          raw: f,
        };
        appendJsonl(formsFile, form);
        counts.ticketForms++;
      }
      formsUrl = data.next_page;
    }
  } catch (err) {
    formSpinner.warn(`Ticket forms: ${err instanceof Error ? err.message : 'endpoint not available'}`);
  }
  if (counts.ticketForms > 0) formSpinner.succeed(`${counts.ticketForms} ticket forms exported`);
  else formSpinner.info('0 ticket forms exported (endpoint may not be available)');

  // Export brands
  const brandSpinner = ora('Exporting brands...').start();
  try {
    let brandsUrl: string | null = '/api/v2/brands.json?page[size]=100';
    while (brandsUrl) {
      const data: { brands: ZendeskBrand[]; next_page: string | null } = await zendeskFetch(auth, brandsUrl);
      for (const b of data.brands) {
        const brand: Brand = {
          id: `zd-brand-${b.id}`,
          externalId: String(b.id),
          source: 'zendesk',
          name: b.name,
          raw: b,
        };
        appendJsonl(brandsFile, brand);
        counts.brands++;
      }
      brandsUrl = data.next_page;
    }
  } catch (err) {
    brandSpinner.warn(`Brands: ${err instanceof Error ? err.message : 'endpoint not available'}`);
  }
  if (counts.brands > 0) brandSpinner.succeed(`${counts.brands} brands exported`);
  else brandSpinner.info('0 brands exported (endpoint may not be available)');

  // Export audit events (ticket audits)
  const auditSpinner = ora('Exporting ticket audits...').start();
  try {
    let auditsUrl: string | null = '/api/v2/ticket_audits.json?page[size]=100';
    while (auditsUrl) {
      const data: { audits: ZendeskAudit[]; next_page: string | null } = await zendeskFetch(auth, auditsUrl);
      for (const audit of data.audits) {
        const event: AuditEvent = {
          id: `zd-audit-${audit.id}`,
          externalId: String(audit.id),
          source: 'zendesk',
          ticketId: `zd-${audit.ticket_id}`,
          authorId: audit.author_id ? String(audit.author_id) : undefined,
          eventType: audit.events[0]?.type ?? 'audit',
          createdAt: audit.created_at,
          raw: audit,
        };
        appendJsonl(auditsFile, event);
        counts.auditEvents++;
      }
      auditsUrl = data.next_page;
    }
  } catch (err) {
    auditSpinner.warn(`Ticket audits: ${err instanceof Error ? err.message : 'endpoint not available'}`);
  }
  if (counts.auditEvents > 0) auditSpinner.succeed(`${counts.auditEvents} audit events exported`);
  else auditSpinner.info('0 audit events exported (endpoint may not be available)');

  // Export CSAT ratings
  const csatSpinner = ora('Exporting CSAT ratings...').start();
  try {
    let csatUrl: string | null = '/api/v2/satisfaction_ratings.json?page[size]=100';
    while (csatUrl) {
      const data: { satisfaction_ratings: ZendeskCSAT[]; next_page: string | null } = await zendeskFetch(auth, csatUrl);
      for (const rating of data.satisfaction_ratings) {
        const csat: CSATRating = {
          id: `zd-csat-${rating.id}`,
          externalId: String(rating.id),
          source: 'zendesk',
          ticketId: `zd-${rating.ticket_id}`,
          rating: rating.score ? parseInt(rating.score, 10) : 0,
          comment: rating.comment ?? undefined,
          createdAt: rating.created_at,
        };
        appendJsonl(csatFile, csat);
        counts.csatRatings++;
      }
      csatUrl = data.next_page;
    }
  } catch (err) {
    csatSpinner.warn(`CSAT: ${err instanceof Error ? err.message : 'endpoint not available'}`);
  }
  if (counts.csatRatings > 0) csatSpinner.succeed(`${counts.csatRatings} CSAT ratings exported`);
  else csatSpinner.info('0 CSAT ratings exported (endpoint may not be available)');

  // Export time entries
  const timeSpinner = ora('Exporting time entries...').start();
  try {
    let timeUrl: string | null = '/api/v2/time_entries.json?page[size]=100';
    while (timeUrl) {
      const data: { time_entries: ZendeskTimeEntry[]; next_page: string | null } = await zendeskFetch(auth, timeUrl);
      for (const entry of data.time_entries) {
        const timeEntry: TimeEntry = {
          id: `zd-time-${entry.id}`,
          externalId: String(entry.id),
          source: 'zendesk',
          ticketId: `zd-${entry.ticket_id}`,
          agentId: entry.user_id ? String(entry.user_id) : undefined,
          minutes: Math.round(entry.time_spent / 60),
          createdAt: entry.created_at,
        };
        appendJsonl(timeEntriesFile, timeEntry);
        counts.timeEntries++;
      }
      timeUrl = data.next_page;
    }
  } catch (err) {
    timeSpinner.warn(`Time entries: ${err instanceof Error ? err.message : 'endpoint not available'}`);
  }
  if (counts.timeEntries > 0) timeSpinner.succeed(`${counts.timeEntries} time entries exported`);
  else timeSpinner.info('0 time entries exported (endpoint may not be available)');

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

      const policy: SLAPolicy = {
        id: `zd-sla-${s.id}`,
        externalId: String(s.id),
        source: 'zendesk',
        name: s.title,
        enabled: true,
        targets: s.policy_metrics,
        schedules: s.filter,
      };
      appendJsonl(slaPoliciesFile, policy);
      counts.slaPolicies++;
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

export async function zendeskDeleteTicket(auth: ZendeskAuth, ticketId: number): Promise<void> {
  await zendeskFetch(auth, `/api/v2/tickets/${ticketId}.json`, { method: 'DELETE' });
}
