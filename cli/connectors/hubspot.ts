import type {
  Ticket, Message, Customer, Organization, ExportManifest, TicketStatus, TicketPriority,
} from '../schema/types';
import {
  createClient, paginateCursor, setupExport, appendJsonl, writeManifest, exportSpinner,
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

export async function exportHubSpot(auth: HubSpotAuth, outDir: string): Promise<ExportManifest> {
  const client = createHubSpotClient(auth);
  const files = setupExport(outDir);
  const counts = { tickets: 0, messages: 0, customers: 0, organizations: 0, kbArticles: 0, rules: 0 };

  // Export tickets
  const ticketProperties = 'subject,content,hs_pipeline_stage,hs_ticket_priority,hubspot_owner_id,createdate,hs_lastmodifieddate,hs_ticket_category';
  const ticketSpinner = exportSpinner('Exporting tickets...');

  await paginateCursor<HSTicket>({
    fetch: client.request.bind(client),
    initialUrl: hubspotCursorUrl('/crm/v3/objects/tickets', ticketProperties),
    getData: hsGetData,
    getNextUrl: hsGetNextUrl('/crm/v3/objects/tickets', ticketProperties),
    onPage: async (tickets) => {
      for (const t of tickets) {
        const p = t.properties;
        const ticket: Ticket = {
          id: `hub-${t.id}`,
          externalId: t.id,
          source: 'hubspot',
          subject: p.subject ?? `Ticket #${t.id}`,
          status: mapPipelineStage(p.hs_pipeline_stage),
          priority: mapPriority(p.hs_ticket_priority),
          assignee: p.hubspot_owner_id ?? undefined,
          requester: 'unknown', // resolved via associations below
          tags: p.hs_ticket_category ? [p.hs_ticket_category] : [],
          createdAt: p.createdate ?? new Date().toISOString(),
          updatedAt: p.hs_lastmodifieddate ?? new Date().toISOString(),
        };

        // Get associated contacts
        try {
          const assoc = await client.request<{
            results: Array<{ id: string; type: string }>;
          }>(`/crm/v3/objects/tickets/${t.id}/associations/contacts`);
          if (assoc.results.length > 0) {
            ticket.requester = assoc.results[0].id;
          }
        } catch { /* no associations */ }

        appendJsonl(files.tickets, ticket);
        counts.tickets++;

        // Get notes associated with this ticket
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
      }

      ticketSpinner.text = `Exporting tickets... ${counts.tickets} exported`;
    },
  });
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

  // No KB articles via standard API (HubSpot KB is part of CMS Hub)
  exportSpinner('KB articles: requires CMS Hub (not exported)').info();
  exportSpinner('Business rules: not available via HubSpot API').info();

  return writeManifest(outDir, 'hubspot', counts);
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
