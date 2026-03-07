import type {
  Ticket, Message, Customer, Organization, KBArticle, Rule, ExportManifest, TicketStatus, TicketPriority,
} from '../schema/types';
import {
  createClient, paginateCursor, setupExport, appendJsonl, writeManifest, exportSpinner,
  initCounts,
} from './base/index';

export interface HubSpotAuth {
  accessToken: string;
}

// ---- HubSpot API types ----

interface HSTicket {
  id: string;
  properties: {
    subject?: string;
    content?: string;
    hs_pipeline_stage?: string;
    hs_ticket_priority?: string;
    hubspot_owner_id?: string;
    createdate?: string;
    hs_lastmodifieddate?: string;
    hs_ticket_category?: string;
    [key: string]: unknown;
  };
}

interface HSContact {
  id: string;
  properties: {
    firstname?: string;
    lastname?: string;
    email?: string;
    phone?: string;
    company?: string;
    associatedcompanyid?: string;
    createdate?: string;
    [key: string]: unknown;
  };
}

interface HSCompany {
  id: string;
  properties: {
    name?: string;
    domain?: string;
    website?: string;
    industry?: string;
    createdate?: string;
    [key: string]: unknown;
  };
}

interface HSNote {
  id: string;
  properties: {
    hs_note_body?: string;
    hs_timestamp?: string;
    hubspot_owner_id?: string;
    [key: string]: unknown;
  };
}

interface HSOwner {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

interface HSEmail {
  id: string;
  properties: {
    hs_email_subject?: string;
    hs_email_text?: string;
    hs_email_html?: string;
    hs_email_direction?: string; // EMAIL, INCOMING_EMAIL, FORWARDED_EMAIL
    hs_email_status?: string;
    hs_timestamp?: string;
    hubspot_owner_id?: string;
    hs_email_from_email?: string;
    hs_email_to_email?: string;
    [key: string]: unknown;
  };
}

interface HSBlogPost {
  id: string;
  name: string;
  postBody: string;
  state: string; // PUBLISHED, DRAFT
  slug: string;
  categoryId?: number;
  tagIds?: number[];
  created: string;
  updated: string;
}

interface HSKBArticle {
  id: string;
  title: string;
  body: string;
  state: string;
  categoryId?: number;
  subcategoryId?: number;
  slug: string;
  created: string;
  updated: string;
}

// ---- HubSpot cursor-based pagination response shape ----

interface HSPaginatedResponse<T> {
  results: T[];
  paging?: { next?: { after: string } };
}

// ---- Client ----

function createHubSpotClient(auth: HubSpotAuth) {
  return createClient({
    baseUrl: 'https://api.hubapi.com',
    authHeaders: () => ({
      Authorization: `Bearer ${auth.accessToken}`,
    }),
    sourceName: 'HubSpot',
    defaultRetryAfterSeconds: 10,
  });
}

/** @deprecated Use createHubSpotClient() + client.request() instead. Kept for backward compatibility. */
export async function hubspotFetch<T>(auth: HubSpotAuth, path: string, options?: {
  method?: string;
  body?: unknown;
}): Promise<T> {
  return createHubSpotClient(auth).request<T>(path, options);
}

// ---- Mapping helpers ----

function mapPipelineStage(stage: string | undefined): TicketStatus {
  if (!stage) return 'open';
  const lower = stage.toLowerCase();
  // HubSpot uses numeric stage IDs or labels depending on configuration
  if (lower.includes('new') || lower.includes('open') || lower === '1') return 'open';
  if (lower.includes('waiting') || lower.includes('pending') || lower === '2') return 'pending';
  if (lower.includes('closed') || lower.includes('resolved') || lower === '3' || lower === '4') return 'closed';
  return 'open';
}

function mapPriority(priority: string | undefined): TicketPriority {
  if (!priority) return 'normal';
  const lower = priority.toLowerCase();
  if (lower === 'low') return 'low';
  if (lower === 'medium') return 'normal';
  if (lower === 'high') return 'high';
  return 'normal';
}

// ---- Cursor pagination helper for HubSpot CRM endpoints ----

function hubspotCursorUrl(basePath: string, properties: string): string {
  const params = new URLSearchParams({ limit: '100', properties });
  return `${basePath}?${params}`;
}

function hsGetData<T>(response: Record<string, unknown>): T[] {
  return (response as unknown as HSPaginatedResponse<T>).results ?? [];
}

function hsGetNextUrl(basePath: string, properties: string) {
  return (response: Record<string, unknown>): string | null => {
    const after = (response as unknown as HSPaginatedResponse<unknown>).paging?.next?.after;
    if (!after) return null;
    const params = new URLSearchParams({ limit: '100', properties });
    params.set('after', after);
    return `${basePath}?${params}`;
  };
}

// ---- Export ----

export interface HubSpotCursorState {
  lastSyncAt?: string;
}

// ---- Workflow API types ----

interface HSWorkflow {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  insertedAt?: string;
  updatedAt?: string;
  actions?: unknown[];
  enrollmentCriteria?: unknown;
}

// ---- Ticket processing helper ----

async function processHubSpotTicket(
  client: ReturnType<typeof createHubSpotClient>,
  t: HSTicket,
  files: ReturnType<typeof setupExport>,
  counts: ReturnType<typeof initCounts>,
): Promise<void> {
  const p = t.properties;
  const ticket: Ticket = {
    id: `hub-${t.id}`,
    externalId: t.id,
    source: 'hubspot',
    subject: p.subject ?? `Ticket #${t.id}`,
    status: mapPipelineStage(p.hs_pipeline_stage),
    priority: mapPriority(p.hs_ticket_priority),
    assignee: p.hubspot_owner_id ?? undefined,
    requester: 'unknown',
    tags: p.hs_ticket_category ? [p.hs_ticket_category] : [],
    createdAt: p.createdate ?? new Date().toISOString(),
    updatedAt: p.hs_lastmodifieddate ?? new Date().toISOString(),
  };

  try {
    const assoc = await client.request<{
      results: Array<{ id: string; type: string }>;
    }>(`/crm/v3/objects/tickets/${t.id}/associations/contacts`);
    if (assoc.results.length > 0) ticket.requester = assoc.results[0].id;
  } catch { /* no associations */ }

  appendJsonl(files.tickets, ticket);
  counts.tickets++;

  try {
    const notes = await client.request<{
      results: Array<{ id: string; type: string }>;
    }>(`/crm/v3/objects/tickets/${t.id}/associations/notes`);
    for (const noteRef of notes.results) {
      try {
        const note = await client.request<HSNote>(
          `/crm/v3/objects/notes/${noteRef.id}?properties=hs_note_body,hs_timestamp,hubspot_owner_id`,
        );
        if (note.properties.hs_note_body) {
          const message: Message = {
            id: `hub-note-${note.id}`,
            ticketId: `hub-${t.id}`,
            author: note.properties.hubspot_owner_id ?? 'unknown',
            body: note.properties.hs_note_body,
            type: 'note',
            createdAt: note.properties.hs_timestamp ?? p.createdate ?? new Date().toISOString(),
          };
          appendJsonl(files.messages, message);
          counts.messages++;
        }
      } catch { /* individual note fetch failed */ }
    }
  } catch { /* notes association not available */ }

  try {
    const emailAssocs = await client.request<{
      results: Array<{ id: string; type: string }>;
    }>(`/crm/v3/objects/tickets/${t.id}/associations/emails`);
    for (const emailRef of emailAssocs.results) {
      try {
        const email = await client.request<HSEmail>(
          `/crm/v3/objects/emails/${emailRef.id}?properties=hs_email_subject,hs_email_text,hs_email_html,hs_email_direction,hs_timestamp,hubspot_owner_id,hs_email_from_email,hs_email_to_email`,
        );
        const emailBody = email.properties.hs_email_text ?? email.properties.hs_email_html ?? '';
        if (emailBody) {
          const isIncoming = email.properties.hs_email_direction === 'INCOMING_EMAIL';
          const message: Message = {
            id: `hub-email-${email.id}`,
            ticketId: `hub-${t.id}`,
            author: isIncoming
              ? (email.properties.hs_email_from_email ?? 'unknown')
              : (email.properties.hubspot_owner_id ?? 'unknown'),
            body: emailBody,
            bodyHtml: email.properties.hs_email_html ?? undefined,
            type: 'reply',
            createdAt: email.properties.hs_timestamp ?? p.createdate ?? new Date().toISOString(),
          };
          appendJsonl(files.messages, message);
          counts.messages++;
        }
      } catch { /* individual email fetch failed */ }
    }
  } catch { /* email association not available */ }
}

// ---- Incremental search helper ----

async function searchHubSpotObjects<T>(
  client: ReturnType<typeof createHubSpotClient>,
  objectType: string,
  properties: string[],
  lastSyncAt: string,
): Promise<T[]> {
  const all: T[] = [];
  let searchAfter: string | undefined;
  let hasMore = true;
  while (hasMore) {
    const searchBody: Record<string, unknown> = {
      filterGroups: [{
        filters: [{
          propertyName: 'hs_lastmodifieddate',
          operator: 'GTE',
          value: new Date(lastSyncAt).getTime(),
        }],
      }],
      properties,
      limit: 100,
    };
    if (searchAfter) searchBody.after = searchAfter;
    const result = await client.request<HSPaginatedResponse<T>>(
      `/crm/v3/objects/${objectType}/search`, { method: 'POST', body: searchBody },
    );
    all.push(...(result.results ?? []));
    searchAfter = result.paging?.next?.after;
    hasMore = !!searchAfter;
  }
  return all;
}

export async function exportHubSpot(auth: HubSpotAuth, outDir: string, cursorState?: HubSpotCursorState): Promise<ExportManifest> {
  const client = createHubSpotClient(auth);
  const files = setupExport(outDir);
  const counts = initCounts();

  // Export tickets
  const ticketPropertiesList = ['subject', 'content', 'hs_pipeline_stage', 'hs_ticket_priority', 'hubspot_owner_id', 'createdate', 'hs_lastmodifieddate', 'hs_ticket_category'];
  const ticketProperties = ticketPropertiesList.join(',');
  const ticketSpinner = exportSpinner('Exporting tickets...');

  if (cursorState?.lastSyncAt) {
    // Incremental: use search API with hs_lastmodifieddate filter
    const tickets = await searchHubSpotObjects<HSTicket>(
      client, 'tickets', ticketPropertiesList, cursorState.lastSyncAt,
    );
    for (const t of tickets) {
      await processHubSpotTicket(client, t, files, counts);
    }
    ticketSpinner.text = `Exporting tickets... ${counts.tickets} exported`;
  } else {
    await paginateCursor<HSTicket>({
      fetch: client.request.bind(client),
      initialUrl: hubspotCursorUrl('/crm/v3/objects/tickets', ticketProperties),
      getData: hsGetData,
      getNextUrl: hsGetNextUrl('/crm/v3/objects/tickets', ticketProperties),
      onPage: async (tickets) => {
        for (const t of tickets) {
          await processHubSpotTicket(client, t, files, counts);
        }
        ticketSpinner.text = `Exporting tickets... ${counts.tickets} exported`;
      },
    });
  }
  ticketSpinner.succeed(`${counts.tickets} tickets exported (${counts.messages} messages)`);

  // Export contacts (= customers)
  const contactProperties = 'firstname,lastname,email,phone,company,associatedcompanyid';
  const contactSpinner = exportSpinner('Exporting contacts...');

  await paginateCursor<HSContact>({
    fetch: client.request.bind(client),
    initialUrl: hubspotCursorUrl('/crm/v3/objects/contacts', contactProperties),
    getData: hsGetData,
    getNextUrl: hsGetNextUrl('/crm/v3/objects/contacts', contactProperties),
    onPage: (contacts) => {
      for (const c of contacts) {
        const p = c.properties;
        const customer: Customer = {
          id: `hub-user-${c.id}`,
          externalId: c.id,
          source: 'hubspot',
          name: [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email || `Contact ${c.id}`,
          email: p.email ?? '',
          phone: p.phone ?? undefined,
          orgId: p.associatedcompanyid ? `hub-org-${p.associatedcompanyid}` : undefined,
        };
        appendJsonl(files.customers, customer);
        counts.customers++;
      }
      contactSpinner.text = `Exporting contacts... ${counts.customers} exported`;
    },
  });
  contactSpinner.succeed(`${counts.customers} contacts exported`);

  // Export owners (agents)
  const ownerSpinner = exportSpinner('Exporting owners...');
  try {
    const owners = await client.request<{ results: HSOwner[] }>('/crm/v3/owners');
    for (const o of owners.results) {
      const customer: Customer = {
        id: `hub-agent-${o.id}`,
        externalId: `agent-${o.id}`,
        source: 'hubspot',
        name: `${o.firstName} ${o.lastName}`.trim(),
        email: o.email,
      };
      appendJsonl(files.customers, customer);
      counts.customers++;
    }
    ownerSpinner.succeed(`${owners.results.length} owners exported`);
  } catch (err) {
    ownerSpinner.warn(`Owners: ${err instanceof Error ? err.message : 'not available'}`);
  }

  // Export companies (= organizations)
  const companyProperties = 'name,domain,website,industry';
  const companySpinner = exportSpinner('Exporting companies...');

  try {
    await paginateCursor<HSCompany>({
      fetch: client.request.bind(client),
      initialUrl: hubspotCursorUrl('/crm/v3/objects/companies', companyProperties),
      getData: hsGetData,
      getNextUrl: hsGetNextUrl('/crm/v3/objects/companies', companyProperties),
      onPage: (companies) => {
        for (const co of companies) {
          const p = co.properties;
          const org: Organization = {
            id: `hub-org-${co.id}`,
            externalId: co.id,
            source: 'hubspot',
            name: p.name ?? `Company ${co.id}`,
            domains: [p.domain, p.website].filter(Boolean) as string[],
          };
          appendJsonl(files.organizations, org);
          counts.organizations++;
        }
        companySpinner.text = `Exporting companies... ${counts.organizations} exported`;
      },
    });
  } catch { /* companies endpoint may not be available */ }
  companySpinner.succeed(`${counts.organizations} companies exported`);

  // Export KB articles via CMS Knowledge Base API
  const kbSpinner = exportSpinner('Exporting KB articles...');
  let kbCount = 0;

  try {
    await paginateCursor<HSBlogPost>({
      fetch: client.request.bind(client),
      initialUrl: hubspotCursorUrl('/cms/v3/blogs/posts', 'id,name,postBody,state,slug,categoryId,created,updated'),
      getData: hsGetData,
      getNextUrl: hsGetNextUrl('/cms/v3/blogs/posts', 'id,name,postBody,state,slug,categoryId,created,updated'),
      onPage: (posts) => {
        for (const post of posts) {
          const article: KBArticle = {
            id: `hub-kb-${post.id}`,
            externalId: post.id,
            source: 'hubspot',
            title: post.name ?? `Article ${post.id}`,
            body: post.postBody ?? '',
            categoryPath: post.categoryId ? [String(post.categoryId)] : [],
          };
          appendJsonl(files.kb_articles, article);
          counts.kbArticles++;
          kbCount++;
        }
      },
    });
  } catch {
    try {
      await paginateCursor<HSKBArticle>({
        fetch: client.request.bind(client),
        initialUrl: '/cms/v3/knowledge-base/articles?limit=100',
        getData: hsGetData,
        getNextUrl: (response) => {
          const after = (response as unknown as HSPaginatedResponse<unknown>).paging?.next?.after;
          return after ? `/cms/v3/knowledge-base/articles?limit=100&after=${after}` : null;
        },
        onPage: (articles) => {
          for (const a of articles) {
            const article: KBArticle = {
              id: `hub-kb-${a.id}`,
              externalId: a.id,
              source: 'hubspot',
              title: a.title ?? `Article ${a.id}`,
              body: a.body ?? '',
              categoryPath: [a.categoryId, a.subcategoryId].filter(Boolean).map(String),
            };
            appendJsonl(files.kb_articles, article);
            counts.kbArticles++;
            kbCount++;
          }
        },
      });
    } catch {
      kbSpinner.warn('KB articles: requires CMS Hub or Service Hub Professional+');
    }
  }
  if (kbCount > 0) kbSpinner.succeed(`${kbCount} KB articles exported`);
  else kbSpinner.info('0 KB articles exported');

  // Export workflows (business rules) via Automation API
  const rulesSpinner = exportSpinner('Exporting workflows...');
  try {
    const flowsResult = await client.request<{ results: HSWorkflow[] }>('/automation/v4/flows?limit=100');
    const workflows = flowsResult.results ?? [];
    for (const wf of workflows) {
      const rule: Rule = {
        id: `hub-rule-${wf.id}`,
        externalId: wf.id,
        source: 'hubspot',
        type: 'automation',
        title: wf.name ?? `Workflow ${wf.id}`,
        conditions: wf.enrollmentCriteria ?? null,
        actions: wf.actions ?? null,
        active: wf.enabled ?? false,
      };
      appendJsonl(files.rules, rule);
      counts.rules++;
    }
    if (counts.rules > 0) rulesSpinner.succeed(`${counts.rules} workflows exported`);
    else rulesSpinner.info('0 workflows exported');
  } catch (err) {
    // 403 = automation scope not granted; other errors also handled gracefully
    const msg = err instanceof Error ? err.message : 'not available';
    if (msg.includes('403') || msg.includes('Forbidden')) {
      rulesSpinner.info('Workflows: automation scope not granted (requires Operations Hub)');
    } else {
      rulesSpinner.warn(`Workflows: ${msg}`);
    }
  }

  const newCursorState: Record<string, string> = { lastSyncAt: new Date().toISOString() };
  return writeManifest(outDir, 'hubspot', counts, { cursorState: newCursorState });
}

// ---- Verify ----

export async function hubspotVerifyConnection(auth: HubSpotAuth): Promise<{
  success: boolean;
  portalId?: string;
  ownerCount?: number;
  error?: string;
}> {
  try {
    const client = createHubSpotClient(auth);
    const account = await client.request<{ portalId: number }>('/account-info/v3/details');
    const owners = await client.request<{ results: HSOwner[] }>('/crm/v3/owners');
    return {
      success: true,
      portalId: String(account.portalId),
      ownerCount: owners.results.length,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---- Write operations ----

export async function hubspotCreateTicket(auth: HubSpotAuth, subject: string, content: string, options?: {
  priority?: string;
  ownerId?: string;
  pipelineStage?: string;
}): Promise<{ id: string }> {
  const properties: Record<string, unknown> = { subject, content };
  if (options?.priority) properties.hs_ticket_priority = options.priority;
  if (options?.ownerId) properties.hubspot_owner_id = options.ownerId;
  if (options?.pipelineStage) properties.hs_pipeline_stage = options.pipelineStage;

  const result = await createHubSpotClient(auth).request<{ id: string }>('/crm/v3/objects/tickets', {
    method: 'POST',
    body: { properties },
  });
  return { id: result.id };
}

export async function hubspotUpdateTicket(auth: HubSpotAuth, ticketId: string, updates: {
  status?: string;
  priority?: string;
  assignee?: string;
}): Promise<void> {
  const properties: Record<string, unknown> = {};
  if (updates.status) properties.hs_pipeline_stage = updates.status;
  if (updates.priority) properties.hs_ticket_priority = updates.priority;
  if (updates.assignee) properties.hubspot_owner_id = updates.assignee;

  await createHubSpotClient(auth).request(`/crm/v3/objects/tickets/${ticketId}`, {
    method: 'PATCH',
    body: { properties },
  });
}

export async function hubspotPostReply(auth: HubSpotAuth, ticketId: string, body: string, options?: {
  ownerId?: string;
}): Promise<{ id: string }> {
  const client = createHubSpotClient(auth);
  const properties: Record<string, unknown> = {
    hs_email_direction: 'EMAIL',
    hs_email_status: 'SENT',
    hs_email_subject: 'Reply',
    hs_email_text: body,
    hs_timestamp: new Date().toISOString(),
  };
  if (options?.ownerId) properties.hubspot_owner_id = options.ownerId;

  const email = await client.request<{ id: string }>('/crm/v3/objects/emails', {
    method: 'POST',
    body: { properties },
  });

  // Associate email with ticket
  await client.request(`/crm/v4/objects/emails/${email.id}/associations/tickets/${ticketId}`, {
    method: 'PUT',
    body: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 26 }],
  });

  return { id: email.id };
}

export async function hubspotCreateNote(auth: HubSpotAuth, ticketId: string, body: string, options?: {
  ownerId?: string;
}): Promise<{ id: string }> {
  const client = createHubSpotClient(auth);
  const properties: Record<string, unknown> = {
    hs_note_body: body,
    hs_timestamp: new Date().toISOString(),
  };
  if (options?.ownerId) properties.hubspot_owner_id = options.ownerId;

  const note = await client.request<{ id: string }>('/crm/v3/objects/notes', {
    method: 'POST',
    body: { properties },
  });

  // Associate note with ticket
  await client.request(`/crm/v4/objects/notes/${note.id}/associations/tickets/${ticketId}`, {
    method: 'PUT',
    body: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 17 }],
  });

  return { id: note.id };
}
