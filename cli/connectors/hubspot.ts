import { mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import type {
  Ticket, Message, Customer, Organization, ExportManifest, TicketStatus, TicketPriority,
} from '../schema/types.js';

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

// ---- Fetch wrapper ----

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function hubspotFetch<T>(auth: HubSpotAuth, path: string, options?: {
  method?: string;
  body?: unknown;
}): Promise<T> {
  const url = path.startsWith('http') ? path : `https://api.hubapi.com${path}`;

  let retries = 0;
  const maxRetries = 5;

  while (true) {
    const res = await fetch(url, {
      method: options?.method ?? 'GET',
      headers: {
        'Authorization': `Bearer ${auth.accessToken}`,
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
      throw new Error(`HubSpot API error: ${res.status} ${res.statusText} for ${url}${errorBody ? ` — ${errorBody.slice(0, 200)}` : ''}`);
    }

    if (res.status === 204) return {} as T;
    return res.json() as Promise<T>;
  }
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

function appendJsonl(filePath: string, record: unknown): void {
  appendFileSync(filePath, JSON.stringify(record) + '\n');
}

// ---- Export ----

export async function exportHubSpot(auth: HubSpotAuth, outDir: string): Promise<ExportManifest> {
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

  // Export tickets
  const ticketSpinner = ora('Exporting tickets...').start();
  let after: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      limit: '100',
      properties: 'subject,content,hs_pipeline_stage,hs_ticket_priority,hubspot_owner_id,createdate,hs_lastmodifieddate,hs_ticket_category',
    });
    if (after) params.set('after', after);

    const data = await hubspotFetch<{
      results: HSTicket[];
      paging?: { next?: { after: string } };
    }>(auth, `/crm/v3/objects/tickets?${params}`);

    for (const t of data.results) {
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
        const assoc = await hubspotFetch<{
          results: Array<{ id: string; type: string }>;
        }>(auth, `/crm/v3/objects/tickets/${t.id}/associations/contacts`);
        if (assoc.results.length > 0) {
          ticket.requester = assoc.results[0].id;
        }
      } catch { /* no associations */ }

      appendJsonl(ticketsFile, ticket);
      counts.tickets++;

      // Get notes associated with this ticket
      try {
        const notes = await hubspotFetch<{
          results: Array<{ id: string; type: string }>;
        }>(auth, `/crm/v3/objects/tickets/${t.id}/associations/notes`);

        for (const noteRef of notes.results) {
          try {
            const note = await hubspotFetch<HSNote>(
              auth, `/crm/v3/objects/notes/${noteRef.id}?properties=hs_note_body,hs_timestamp,hubspot_owner_id`,
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
              appendJsonl(messagesFile, message);
              counts.messages++;
            }
          } catch { /* individual note fetch failed */ }
        }
      } catch { /* notes association not available */ }
    }

    ticketSpinner.text = `Exporting tickets... ${counts.tickets} exported`;
    after = data.paging?.next?.after;
    hasMore = after !== undefined;
  }
  ticketSpinner.succeed(`${counts.tickets} tickets exported (${counts.messages} messages)`);

  // Export contacts (= customers)
  const contactSpinner = ora('Exporting contacts...').start();
  after = undefined;
  hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      limit: '100',
      properties: 'firstname,lastname,email,phone,company,associatedcompanyid',
    });
    if (after) params.set('after', after);

    const data = await hubspotFetch<{
      results: HSContact[];
      paging?: { next?: { after: string } };
    }>(auth, `/crm/v3/objects/contacts?${params}`);

    for (const c of data.results) {
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
      appendJsonl(customersFile, customer);
      counts.customers++;
    }

    contactSpinner.text = `Exporting contacts... ${counts.customers} exported`;
    after = data.paging?.next?.after;
    hasMore = after !== undefined;
  }
  contactSpinner.succeed(`${counts.customers} contacts exported`);

  // Export owners (agents)
  const ownerSpinner = ora('Exporting owners...').start();
  try {
    const owners = await hubspotFetch<{ results: HSOwner[] }>(auth, '/crm/v3/owners');
    for (const o of owners.results) {
      const customer: Customer = {
        id: `hub-agent-${o.id}`,
        externalId: `agent-${o.id}`,
        source: 'hubspot',
        name: `${o.firstName} ${o.lastName}`.trim(),
        email: o.email,
      };
      appendJsonl(customersFile, customer);
      counts.customers++;
    }
    ownerSpinner.succeed(`${owners.results.length} owners exported`);
  } catch (err) {
    ownerSpinner.warn(`Owners: ${err instanceof Error ? err.message : 'not available'}`);
  }

  // Export companies (= organizations)
  const companySpinner = ora('Exporting companies...').start();
  after = undefined;
  hasMore = true;

  while (hasMore) {
    try {
      const params = new URLSearchParams({
        limit: '100',
        properties: 'name,domain,website,industry',
      });
      if (after) params.set('after', after);

      const data = await hubspotFetch<{
        results: HSCompany[];
        paging?: { next?: { after: string } };
      }>(auth, `/crm/v3/objects/companies?${params}`);

      for (const co of data.results) {
        const p = co.properties;
        const org: Organization = {
          id: `hub-org-${co.id}`,
          externalId: co.id,
          source: 'hubspot',
          name: p.name ?? `Company ${co.id}`,
          domains: [p.domain, p.website].filter(Boolean) as string[],
        };
        appendJsonl(orgsFile, org);
        counts.organizations++;
      }

      companySpinner.text = `Exporting companies... ${counts.organizations} exported`;
      after = data.paging?.next?.after;
      hasMore = after !== undefined;
    } catch {
      hasMore = false;
    }
  }
  companySpinner.succeed(`${counts.organizations} companies exported`);

  // No KB articles via standard API (HubSpot KB is part of CMS Hub)
  ora('KB articles: requires CMS Hub (not exported)').info();
  ora('Business rules: not available via HubSpot API').info();

  const manifest: ExportManifest = {
    source: 'hubspot',
    exportedAt: new Date().toISOString(),
    counts,
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(chalk.green(`\nExport complete → ${outDir}/manifest.json`));
  return manifest;
}

// ---- Verify ----

export async function hubspotVerifyConnection(auth: HubSpotAuth): Promise<{
  success: boolean;
  portalId?: string;
  ownerCount?: number;
  error?: string;
}> {
  try {
    const account = await hubspotFetch<{ portalId: number }>(auth, '/account-info/v3/details');
    const owners = await hubspotFetch<{ results: HSOwner[] }>(auth, '/crm/v3/owners');
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

  const result = await hubspotFetch<{ id: string }>(auth, '/crm/v3/objects/tickets', {
    method: 'POST',
    body: { properties },
  });
  return { id: result.id };
}

export async function hubspotCreateNote(auth: HubSpotAuth, ticketId: string, body: string, options?: {
  ownerId?: string;
}): Promise<{ id: string }> {
  const properties: Record<string, unknown> = {
    hs_note_body: body,
    hs_timestamp: new Date().toISOString(),
  };
  if (options?.ownerId) properties.hubspot_owner_id = options.ownerId;

  const note = await hubspotFetch<{ id: string }>(auth, '/crm/v3/objects/notes', {
    method: 'POST',
    body: { properties },
  });

  // Associate note with ticket
  await hubspotFetch(auth, `/crm/v3/objects/notes/${note.id}/associations/tickets/${ticketId}/note_to_ticket`, {
    method: 'PUT',
  });

  return { id: note.id };
}
