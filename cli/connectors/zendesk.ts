import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type {
  Ticket, Message, Attachment, Customer, Organization, KBArticle, Rule,
  Group, CustomField, View, SLAPolicy, TicketForm, Brand, AuditEvent,
  CSATRating, TimeEntry, ExportManifest, TicketStatus, TicketPriority,
} from '../schema/types';
import {
  createClient, paginateCursor, paginateNextPage,
  setupExport, appendJsonl, writeManifest, exportSpinner,
} from './base/index';

export interface ZendeskAuth {
  subdomain: string;
  email: string;
  token: string;
}

// ---- Zendesk API types ----

interface ZendeskTicket {
  id: number; subject: string; status: string; priority: string | null;
  assignee_id: number | null; group_id?: number | null; brand_id?: number | null;
  ticket_form_id?: number | null; requester_id: number; tags: string[];
  created_at: string; updated_at: string;
  custom_fields?: Array<{ id: number; value: unknown }>;
}

interface ZendeskUser {
  id: number; name: string; email: string; phone: string | null;
  organization_id: number | null;
}

interface ZendeskOrg { id: number; name: string; domain_names: string[]; }
interface ZendeskComment {
  id: number; author_id: number; body: string; html_body: string;
  public: boolean; created_at: string; attachments?: ZendeskAttachment[];
}
interface ZendeskAttachment {
  id: number; file_name: string; content_type: string; size: number; content_url: string;
}
interface ZendeskArticle { id: number; title: string; body: string; section_id: number; }
interface ZendeskMacro { id: number; title: string; active: boolean; restriction: unknown; actions: unknown[]; }
interface ZendeskGroup { id: number; name: string; }
interface ZendeskView { id: number; title: string; active: boolean; conditions: unknown; execution?: unknown; }
interface ZendeskTicketField {
  id: number; title: string; type: string; required: boolean;
  custom_field_options?: Array<{ name: string; value: string }>;
}
interface ZendeskTicketForm { id: number; name: string; active: boolean; position?: number; ticket_field_ids?: number[]; }
interface ZendeskBrand { id: number; name: string; subdomain?: string; }
interface ZendeskTrigger { id: number; title: string; active: boolean; conditions: unknown; actions: unknown[]; }
interface ZendeskAutomation { id: number; title: string; active: boolean; conditions: unknown; actions: unknown[]; }
interface ZendeskSLAPolicy { id: number; title: string; filter: unknown; policy_metrics: unknown[]; }
interface ZendeskAudit { id: number; ticket_id: number; author_id: number | null; created_at: string; events: Array<{ type: string }>; }
interface ZendeskCSAT { id: number; score: string | null; comment: string | null; ticket_id: number; created_at: string; updated_at: string; }
interface ZendeskTimeEntry { id: number; ticket_id: number; user_id: number | null; time_spent: number; created_at: string; updated_at: string; }

// ---- Client ----

function createZendeskClient(auth: ZendeskAuth) {
  return createClient({
    baseUrl: `https://${auth.subdomain}.zendesk.com`,
    authHeaders: () => ({
      Authorization: `Basic ${Buffer.from(`${auth.email}/token:${auth.token}`).toString('base64')}`,
    }),
    sourceName: 'Zendesk',
  });
}

/** @deprecated Use createZendeskClient() + client.request() instead. Kept for backward compatibility. */
export async function zendeskFetch<T>(auth: ZendeskAuth, path: string, options?: {
  method?: string; body?: unknown;
}): Promise<T> {
  return createZendeskClient(auth).request<T>(path, options);
}

// ---- Mapping helpers ----

function mapStatus(status: string): TicketStatus {
  const map: Record<string, TicketStatus> = {
    new: 'open', open: 'open', pending: 'pending', hold: 'on_hold', solved: 'solved', closed: 'closed',
  };
  return map[status] ?? 'open';
}

function mapPriority(priority: string | null): TicketPriority {
  if (!priority) return 'normal';
  const map: Record<string, TicketPriority> = { low: 'low', normal: 'normal', high: 'high', urgent: 'urgent' };
  return map[priority] ?? 'normal';
}

// ---- Export ----

const ZENDESK_EXTRA_FILES = [
  'groups.jsonl', 'custom_fields.jsonl', 'views.jsonl', 'sla_policies.jsonl',
  'ticket_forms.jsonl', 'brands.jsonl', 'audit_events.jsonl', 'csat_ratings.jsonl', 'time_entries.jsonl',
];

export async function exportZendesk(auth: ZendeskAuth, outDir: string, cursorState?: Record<string, string>): Promise<ExportManifest> {
  const client = createZendeskClient(auth);
  const files = cursorState ? {} as Record<string, string> : setupExport(outDir, ZENDESK_EXTRA_FILES);

  // If resuming, build file paths manually without clearing
  if (cursorState) {
    const { mkdirSync } = await import('fs');
    const { join: pathJoin } = await import('path');
    mkdirSync(outDir, { recursive: true });
    for (const name of ['tickets', 'messages', 'groups', 'custom_fields', 'views', 'sla_policies', 'ticket_forms', 'brands', 'audit_events', 'csat_ratings', 'time_entries', 'customers', 'organizations', 'kb_articles', 'rules']) {
      files[name] = pathJoin(outDir, `${name}.jsonl`);
    }
  }

  const counts = {
    tickets: 0, messages: 0, attachments: 0, customers: 0, organizations: 0,
    kbArticles: 0, rules: 0, groups: 0, customFields: 0, views: 0,
    slaPolicies: 0, ticketForms: 0, brands: 0, auditEvents: 0, csatRatings: 0, timeEntries: 0,
  };
  const newCursorState: Record<string, string> = { ...cursorState };

  // Export tickets with cursor-based incremental pagination
  const ticketSpinner = exportSpinner('Exporting tickets...');
  const ticketStartUrl = cursorState?.ticketCursor
    ? `/api/v2/incremental/tickets/cursor.json?cursor=${cursorState.ticketCursor}`
    : '/api/v2/incremental/tickets/cursor.json?start_time=0';

  await paginateCursor<ZendeskTicket>({
    fetch: client.request.bind(client),
    initialUrl: ticketStartUrl,
    getData: (r) => (r.tickets as ZendeskTicket[]) ?? [],
    getNextUrl: (r) => {
      if (r.end_of_stream) return null;
      if (r.after_cursor) {
        newCursorState.ticketCursor = r.after_cursor as string;
        return `/api/v2/incremental/tickets/cursor.json?cursor=${r.after_cursor}`;
      }
      return null;
    },
    onPage: async (tickets) => {
      for (const t of tickets) {
        const ticket: Ticket = {
          id: `zd-${t.id}`, externalId: String(t.id), source: 'zendesk',
          subject: t.subject, status: mapStatus(t.status), priority: mapPriority(t.priority),
          assignee: t.assignee_id ? String(t.assignee_id) : undefined,
          groupId: t.group_id ? String(t.group_id) : undefined,
          brandId: t.brand_id ? String(t.brand_id) : undefined,
          ticketFormId: t.ticket_form_id ? String(t.ticket_form_id) : undefined,
          requester: String(t.requester_id), tags: t.tags,
          createdAt: t.created_at, updatedAt: t.updated_at,
          customFields: t.custom_fields ? Object.fromEntries(t.custom_fields.map(f => [String(f.id), f.value])) : undefined,
        };
        appendJsonl(files.tickets, ticket);
        counts.tickets++;

        // Hydrate comments
        try {
          await paginateNextPage<ZendeskComment>({
            fetch: client.request.bind(client),
            initialUrl: `/api/v2/tickets/${t.id}/comments.json`,
            dataKey: 'comments',
            onPage: (comments) => {
              for (const c of comments) {
                let attachments: Attachment[] | undefined;
                if (c.attachments && c.attachments.length > 0) {
                  attachments = c.attachments.map((a) => ({
                    id: `zd-att-${a.id}`, externalId: String(a.id), messageId: `zd-msg-${c.id}`,
                    filename: a.file_name, size: a.size, contentType: a.content_type, contentUrl: a.content_url,
                  }));
                  counts.attachments += attachments.length;
                }
                const message: Message = {
                  id: `zd-msg-${c.id}`, ticketId: `zd-${t.id}`, author: String(c.author_id),
                  body: c.body, bodyHtml: c.html_body, type: c.public ? 'reply' : 'note',
                  createdAt: c.created_at, attachments,
                };
                appendJsonl(files.messages, message);
                counts.messages++;
              }
            },
          });
        } catch {
          ticketSpinner.text = `Exporting tickets... ${counts.tickets} (comment fetch failed for #${t.id})`;
        }
      }
      ticketSpinner.text = `Exporting tickets... ${counts.tickets} exported`;
    },
  });
  ticketSpinner.succeed(`${counts.tickets} tickets exported (${counts.messages} messages)`);

  // Export users with cursor-based incremental pagination
  const userSpinner = exportSpinner('Exporting users...');
  const userStartUrl = cursorState?.userCursor
    ? `/api/v2/incremental/users/cursor.json?cursor=${cursorState.userCursor}`
    : '/api/v2/incremental/users/cursor.json?start_time=0';

  await paginateCursor<ZendeskUser>({
    fetch: client.request.bind(client),
    initialUrl: userStartUrl,
    getData: (r) => (r.users as ZendeskUser[]) ?? [],
    getNextUrl: (r) => {
      if (r.end_of_stream) return null;
      if (r.after_cursor) {
        newCursorState.userCursor = r.after_cursor as string;
        return `/api/v2/incremental/users/cursor.json?cursor=${r.after_cursor}`;
      }
      return null;
    },
    onPage: (users) => {
      for (const u of users) {
        const customer: Customer = {
          id: `zd-user-${u.id}`, externalId: String(u.id), source: 'zendesk',
          name: u.name, email: u.email, phone: u.phone ?? undefined,
          orgId: u.organization_id ? String(u.organization_id) : undefined,
        };
        appendJsonl(files.customers, customer);
        counts.customers++;
      }
      userSpinner.text = `Exporting users... ${counts.customers} exported`;
    },
  });
  userSpinner.succeed(`${counts.customers} users exported`);

  // Helper for next_page link paginated resources
  async function exportNextPageResource<T>(
    label: string, url: string, dataKey: string,
    countKey: keyof typeof counts,
    transform: (item: T) => void,
  ): Promise<void> {
    const spinner = exportSpinner(`Exporting ${label}...`);
    try {
      await paginateNextPage<T>({
        fetch: client.request.bind(client),
        initialUrl: url,
        dataKey,
        onPage: (items) => { for (const item of items) transform(item); },
      });
    } catch (err) {
      spinner.warn(`${label}: ${err instanceof Error ? err.message : 'endpoint not available'}`);
      return;
    }
    const count = counts[countKey];
    if (count > 0) spinner.succeed(`${count} ${label.toLowerCase()} exported`);
    else spinner.info(`0 ${label.toLowerCase()} exported (endpoint may not be available)`);
  }

  // Organizations (links.next pagination)
  const orgSpinner = exportSpinner('Exporting organizations...');
  try {
    await paginateNextPage<ZendeskOrg>({
      fetch: client.request.bind(client),
      initialUrl: '/api/v2/organizations.json?page[size]=100',
      dataKey: 'organizations',
      nextPageKey: 'links.next',
      onPage: (orgs) => {
        for (const o of orgs) {
          const org: Organization = {
            id: `zd-org-${o.id}`, externalId: String(o.id), source: 'zendesk',
            name: o.name, domains: o.domain_names,
          };
          appendJsonl(files.organizations, org);
          counts.organizations++;
        }
      },
    });
  } catch (err) {
    orgSpinner.warn(`Organizations: ${err instanceof Error ? err.message : 'endpoint not available'}`);
  }
  if (counts.organizations > 0) orgSpinner.succeed(`${counts.organizations} organizations exported`);
  else orgSpinner.info('0 organizations exported (endpoint may not be available)');

  // Groups
  await exportNextPageResource<ZendeskGroup>('Groups', '/api/v2/groups.json?page[size]=100', 'groups', 'groups', (g) => {
    const group: Group = { id: `zd-group-${g.id}`, externalId: String(g.id), source: 'zendesk', name: g.name };
    appendJsonl(files.groups, group);
    counts.groups++;
  });

  // Ticket fields
  await exportNextPageResource<ZendeskTicketField>('CustomFields', '/api/v2/ticket_fields.json?page[size]=100', 'ticket_fields', 'customFields', (f) => {
    const field: CustomField = {
      id: `zd-field-${f.id}`, externalId: String(f.id), source: 'zendesk',
      objectType: 'ticket', name: f.title, fieldType: f.type, required: f.required,
      options: f.custom_field_options?.map((o) => ({ value: o.value, label: o.name })) ?? undefined,
    };
    appendJsonl(files.custom_fields, field);
    counts.customFields++;
  });

  // Views
  await exportNextPageResource<ZendeskView>('Views', '/api/v2/views.json?page[size]=100', 'views', 'views', (v) => {
    const view: View = {
      id: `zd-view-${v.id}`, externalId: String(v.id), source: 'zendesk',
      name: v.title, query: v.conditions ?? v.execution ?? null, active: v.active,
    };
    appendJsonl(files.views, view);
    counts.views++;
  });

  // Ticket forms
  await exportNextPageResource<ZendeskTicketForm>('TicketForms', '/api/v2/ticket_forms.json?page[size]=100', 'ticket_forms', 'ticketForms', (f) => {
    const form: TicketForm = {
      id: `zd-form-${f.id}`, externalId: String(f.id), source: 'zendesk',
      name: f.name, active: f.active, position: f.position, fieldIds: f.ticket_field_ids, raw: f,
    };
    appendJsonl(files.ticket_forms, form);
    counts.ticketForms++;
  });

  // Brands
  await exportNextPageResource<ZendeskBrand>('Brands', '/api/v2/brands.json?page[size]=100', 'brands', 'brands', (b) => {
    const brand: Brand = { id: `zd-brand-${b.id}`, externalId: String(b.id), source: 'zendesk', name: b.name, raw: b };
    appendJsonl(files.brands, brand);
    counts.brands++;
  });

  // Audit events
  await exportNextPageResource<ZendeskAudit>('AuditEvents', '/api/v2/ticket_audits.json?page[size]=100', 'audits', 'auditEvents', (audit) => {
    const event: AuditEvent = {
      id: `zd-audit-${audit.id}`, externalId: String(audit.id), source: 'zendesk',
      ticketId: `zd-${audit.ticket_id}`, authorId: audit.author_id ? String(audit.author_id) : undefined,
      eventType: audit.events[0]?.type ?? 'audit', createdAt: audit.created_at, raw: audit,
    };
    appendJsonl(files.audit_events, event);
    counts.auditEvents++;
  });

  // CSAT ratings
  await exportNextPageResource<ZendeskCSAT>('CsatRatings', '/api/v2/satisfaction_ratings.json?page[size]=100', 'satisfaction_ratings', 'csatRatings', (rating) => {
    const csat: CSATRating = {
      id: `zd-csat-${rating.id}`, externalId: String(rating.id), source: 'zendesk',
      ticketId: `zd-${rating.ticket_id}`, rating: rating.score === 'good' ? 1 : rating.score === 'bad' ? -1 : 0,
      comment: rating.comment ?? undefined, createdAt: rating.created_at,
    };
    appendJsonl(files.csat_ratings, csat);
    counts.csatRatings++;
  });

  // Time entries
  await exportNextPageResource<ZendeskTimeEntry>('TimeEntries', '/api/v2/time_entries.json?page[size]=100', 'time_entries', 'timeEntries', (entry) => {
    const timeEntry: TimeEntry = {
      id: `zd-time-${entry.id}`, externalId: String(entry.id), source: 'zendesk',
      ticketId: `zd-${entry.ticket_id}`, agentId: entry.user_id ? String(entry.user_id) : undefined,
      minutes: Math.round(entry.time_spent / 60), createdAt: entry.created_at,
    };
    appendJsonl(files.time_entries, timeEntry);
    counts.timeEntries++;
  });

  // KB articles
  const kbSpinner = exportSpinner('Exporting KB articles...');
  try {
    await paginateNextPage<ZendeskArticle>({
      fetch: client.request.bind(client),
      initialUrl: '/api/v2/help_center/articles.json?per_page=100',
      dataKey: 'articles',
      onPage: (articles) => {
        for (const a of articles) {
          const article: KBArticle = {
            id: `zd-kb-${a.id}`, externalId: String(a.id), source: 'zendesk',
            title: a.title, body: a.body, categoryPath: [String(a.section_id)],
          };
          appendJsonl(files.kb_articles, article);
          counts.kbArticles++;
        }
      },
    });
  } catch (err) {
    kbSpinner.warn(`KB Articles: ${err instanceof Error ? err.message : 'Help Center not enabled'}`);
  }
  if (counts.kbArticles > 0) kbSpinner.succeed(`${counts.kbArticles} KB articles exported`);
  else kbSpinner.info('0 KB articles exported (Help Center may not be enabled)');

  // Business rules (macros, triggers, automations, SLA policies)
  const rulesSpinner = exportSpinner('Exporting business rules...');
  try {
    const macros = await client.request<{ macros: ZendeskMacro[] }>('/api/v2/macros.json');
    for (const m of macros.macros) {
      const rule: Rule = {
        id: `zd-macro-${m.id}`, externalId: String(m.id), source: 'zendesk',
        type: 'macro', title: m.title, conditions: m.restriction, actions: m.actions, active: m.active,
      };
      appendJsonl(files.rules, rule);
      counts.rules++;
    }
  } catch { /* endpoint may require admin access */ }
  try {
    const triggers = await client.request<{ triggers: ZendeskTrigger[] }>('/api/v2/triggers.json');
    for (const t of triggers.triggers) {
      const rule: Rule = {
        id: `zd-trigger-${t.id}`, externalId: String(t.id), source: 'zendesk',
        type: 'trigger', title: t.title, conditions: t.conditions, actions: t.actions, active: t.active,
      };
      appendJsonl(files.rules, rule);
      counts.rules++;
    }
  } catch { /* endpoint may require admin access */ }
  try {
    const autos = await client.request<{ automations: ZendeskAutomation[] }>('/api/v2/automations.json');
    for (const a of autos.automations) {
      const rule: Rule = {
        id: `zd-auto-${a.id}`, externalId: String(a.id), source: 'zendesk',
        type: 'automation', title: a.title, conditions: a.conditions, actions: a.actions, active: a.active,
      };
      appendJsonl(files.rules, rule);
      counts.rules++;
    }
  } catch { /* endpoint may require admin access */ }
  try {
    const slas = await client.request<{ sla_policies: ZendeskSLAPolicy[] }>('/api/v2/slas/policies.json');
    for (const s of slas.sla_policies) {
      const rule: Rule = {
        id: `zd-sla-${s.id}`, externalId: String(s.id), source: 'zendesk',
        type: 'sla', title: s.title, conditions: s.filter, actions: s.policy_metrics, active: true,
      };
      appendJsonl(files.rules, rule);
      counts.rules++;

      const policy: SLAPolicy = {
        id: `zd-sla-${s.id}`, externalId: String(s.id), source: 'zendesk',
        name: s.title, enabled: true, targets: s.policy_metrics, schedules: s.filter,
      };
      appendJsonl(files.sla_policies, policy);
      counts.slaPolicies++;
    }
  } catch { /* endpoint may require admin access */ }
  rulesSpinner.succeed(`${counts.rules} business rules exported`);

  return writeManifest(outDir, 'zendesk', counts, { cursorState: newCursorState });
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
  status?: string; priority?: string; assignee_id?: number; tags?: string[];
  subject?: string; custom_fields?: Array<{ id: number; value: unknown }>;
}): Promise<void> {
  await createZendeskClient(auth).request(`/api/v2/tickets/${ticketId}.json`, { method: 'PUT', body: { ticket: updates } });
}

export async function zendeskPostComment(auth: ZendeskAuth, ticketId: number, body: string, isPublic = true): Promise<void> {
  await createZendeskClient(auth).request(`/api/v2/tickets/${ticketId}.json`, {
    method: 'PUT', body: { ticket: { comment: { body, public: isPublic } } },
  });
}

export async function zendeskCreateTicket(auth: ZendeskAuth, subject: string, body: string, options?: {
  requester_id?: number; priority?: string; tags?: string[]; assignee_id?: number;
}): Promise<{ id: number }> {
  const ticket: Record<string, unknown> = { subject, comment: { body } };
  if (options?.requester_id) ticket.requester_id = options.requester_id;
  if (options?.priority) ticket.priority = options.priority;
  if (options?.tags) ticket.tags = options.tags;
  if (options?.assignee_id) ticket.assignee_id = options.assignee_id;
  const result = await createZendeskClient(auth).request<{ ticket: { id: number } }>('/api/v2/tickets.json', { method: 'POST', body: { ticket } });
  return { id: result.ticket.id };
}

export async function zendeskVerifyConnection(auth: ZendeskAuth): Promise<{
  success: boolean; userName?: string; ticketCount?: number; plan?: string; error?: string;
}> {
  try {
    const client = createZendeskClient(auth);
    const me = await client.request<{ user: { name: string; email: string; role: string } }>('/api/v2/users/me.json');
    const countData = await client.request<{ count: { value: number } }>('/api/v2/tickets/count.json');
    return { success: true, userName: me.user.name, ticketCount: countData.count.value };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function zendeskDeleteTicket(auth: ZendeskAuth, ticketId: number): Promise<void> {
  await createZendeskClient(auth).request(`/api/v2/tickets/${ticketId}.json`, { method: 'DELETE' });
}
