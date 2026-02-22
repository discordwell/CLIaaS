import { createHmac, randomBytes } from 'crypto';
import { mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { XMLParser } from 'fast-xml-parser';
import type {
  Ticket, Message, Customer, Organization, KBArticle, Rule, ExportManifest, TicketStatus, TicketPriority,
} from '../schema/types.js';

export interface KayakoClassicAuth {
  domain: string; // e.g. "classichelp.kayako.com"
  apiKey: string;
  secretKey: string;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => {
    // These elements should always be parsed as arrays even when there's only one
    const arrayTags = [
      'ticket', 'ticketpost', 'ticketnote', 'user', 'userorganization',
      'kbarticle', 'department', 'ticketstatus', 'ticketpriority',
      'tickettype', 'staff',
    ];
    return arrayTags.includes(name);
  },
});

// ----- Authentication -----

function generateSignature(secretKey: string): { salt: string; signature: string } {
  const salt = randomBytes(16).toString('hex');
  const hmac = createHmac('sha256', secretKey);
  hmac.update(salt);
  const signature = hmac.digest('base64');
  return { salt, signature };
}

function buildAuthParams(auth: KayakoClassicAuth): string {
  const { salt, signature } = generateSignature(auth.secretKey);
  return `apikey=${encodeURIComponent(auth.apiKey)}&salt=${encodeURIComponent(salt)}&signature=${encodeURIComponent(signature)}`;
}

// ----- Core Fetch -----

export async function kayakoClassicFetch(
  auth: KayakoClassicAuth,
  endpoint: string,
  options?: { method?: string; body?: Record<string, string> },
): Promise<unknown> {
  const method = options?.method ?? 'GET';
  const baseUrl = `https://${auth.domain}/api/index.php`;

  let retries = 0;
  const maxRetries = 5;

  while (true) {
    // Regenerate auth params on each attempt (fresh salt/signature per request)
    const authParams = buildAuthParams(auth);

    let url: string;
    let fetchOptions: RequestInit;

    if (method === 'GET' || method === 'DELETE') {
      // Auth params in query string alongside endpoint
      url = `${baseUrl}?e=${endpoint}&${authParams}`;
      fetchOptions = { method };
    } else {
      // POST/PUT: auth params in body along with data
      url = `${baseUrl}?e=${endpoint}`;
      const bodyParts = [authParams];
      if (options?.body) {
        for (const [key, value] of Object.entries(options.body)) {
          bodyParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
        }
      }
      fetchOptions = {
        method,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: bodyParts.join('&'),
      };
    }

    const res = await fetch(url, fetchOptions);

    if (res.status === 429) {
      const rawRetryAfter = parseInt(res.headers.get('Retry-After') ?? '10', 10);
      const retryAfter = isNaN(rawRetryAfter) ? 10 : rawRetryAfter;
      if (retries >= maxRetries) throw new Error('Rate limit exceeded after max retries');
      retries++;
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      continue;
    }

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(`Kayako Classic API error: ${res.status} ${res.statusText} for ${endpoint}${errorBody ? ` — ${errorBody.slice(0, 200)}` : ''}`);
    }

    const text = await res.text();
    if (!text || !text.trim()) {
      return {};
    }

    // Parse XML response
    try {
      return xmlParser.parse(text);
    } catch {
      throw new Error(`Failed to parse XML response from ${endpoint}: ${text.slice(0, 200)}`);
    }
  }
}

// ----- XML Helpers -----

function getText(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (typeof node === 'object' && '#text' in (node as Record<string, unknown>)) {
    return String((node as Record<string, unknown>)['#text']);
  }
  return String(node);
}

function getNumber(node: unknown): number {
  const n = parseInt(getText(node), 10);
  return isNaN(n) ? 0 : n;
}

function ensureArray<T>(val: T | T[] | undefined | null): T[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

// ----- Interfaces for parsed XML -----

interface ClassicTicket {
  id: unknown;
  displayid: unknown;
  subject: unknown;
  departmentid: unknown;
  statusid: unknown;
  priorityid: unknown;
  typeid: unknown;
  userid: unknown;
  userorganization: unknown;
  userorganizationid: unknown;
  ownerstaffid: unknown;
  ownerstaffname: unknown;
  fullname: unknown;
  email: unknown;
  creationtime: unknown;
  lastactivity: unknown;
  lastreplier: unknown;
  replies: unknown;
  tags: unknown;
}

interface ClassicTicketPost {
  id: unknown;
  ticketpostid: unknown;
  ticketid: unknown;
  dateline: unknown;
  userid: unknown;
  fullname: unknown;
  email: unknown;
  contents: unknown;
  isprivate: unknown;
  creator: unknown; // STAFF or CLIENT
  ishtml: unknown;
  staffid: unknown;
}

interface ClassicTicketNote {
  id: unknown;
  ticketnoteid: unknown;
  ticketid: unknown;
  notecolor: unknown;
  creatorstaffid: unknown;
  creatorstaffname: unknown;
  creationdate: unknown;
  contents: unknown;
}

interface ClassicUser {
  id: unknown;
  fullname: unknown;
  email: unknown;
  phone: unknown;
  userorganizationid: unknown;
  userrole: unknown;
  isenabled: unknown;
  dateline: unknown;
}

interface ClassicOrg {
  id: unknown;
  name: unknown;
  organizationtype: unknown;
  slaplanid: unknown;
}

interface ClassicKBArticle {
  kbarticleid: unknown;
  subject: unknown;
  contents: unknown;
  contentstext: unknown;
  creator: unknown;
  creatorid: unknown;
  editedstaffid: unknown;
  articlestatus: unknown;
  categoryid: unknown;
  dateline: unknown;
}

interface ClassicDepartment {
  id: unknown;
  title: unknown;
  type: unknown;
  module: unknown;
}

// ----- Status/Priority lookups -----
// Kayako Classic uses numeric IDs for status/priority.
// We cache the lookups from the API.

interface StatusMap { [id: string]: string }
interface PriorityMap { [id: string]: string }

async function fetchStatusMap(auth: KayakoClassicAuth): Promise<StatusMap> {
  try {
    const data = await kayakoClassicFetch(auth, '/Tickets/TicketStatus') as Record<string, unknown>;
    const container = data?.ticketstatuses as Record<string, unknown> | undefined;
    const statuses = ensureArray(container?.ticketstatus) as Array<Record<string, unknown>>;
    const map: StatusMap = {};
    for (const s of statuses) {
      map[getText(s.id)] = getText(s.title);
    }
    return map;
  } catch {
    return { '1': 'Open', '2': 'In Progress', '3': 'Closed' };
  }
}

async function fetchPriorityMap(auth: KayakoClassicAuth): Promise<PriorityMap> {
  try {
    const data = await kayakoClassicFetch(auth, '/Tickets/TicketPriority') as Record<string, unknown>;
    const container = data?.ticketpriorities as Record<string, unknown> | undefined;
    const priorities = ensureArray(container?.ticketpriority) as Array<Record<string, unknown>>;
    const map: PriorityMap = {};
    for (const p of priorities) {
      map[getText(p.id)] = getText(p.title);
    }
    return map;
  } catch {
    return { '1': 'Normal', '2': 'High', '3': 'Urgent', '4': 'Low' };
  }
}

function mapStatus(label: string): TicketStatus {
  const lower = label.toLowerCase();
  if (lower.includes('open') || lower.includes('new')) return 'open';
  if (lower.includes('in progress') || lower.includes('pending') || lower.includes('on hold')) return 'pending';
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
  if (lower.includes('urgent') || lower.includes('critical') || lower.includes('emergency')) return 'urgent';
  return 'normal';
}

function appendJsonl(filePath: string, record: unknown): void {
  appendFileSync(filePath, JSON.stringify(record) + '\n');
}

// ----- Write Operations -----

export async function kayakoClassicVerifyConnection(auth: KayakoClassicAuth): Promise<{
  success: boolean;
  departments?: string[];
  ticketCount?: number;
  error?: string;
}> {
  try {
    // Verify by fetching departments (lightweight endpoint)
    const deptData = await kayakoClassicFetch(auth, '/Base/Department') as Record<string, unknown>;
    const deptContainer = deptData?.departments as Record<string, unknown> | undefined;
    const depts = ensureArray(deptContainer?.department) as Array<Record<string, unknown>>;

    // Get ticket count via dedicated TicketCount endpoint
    let ticketCount = 0;
    try {
      const countData = await kayakoClassicFetch(auth, '/Tickets/TicketCount') as Record<string, unknown>;
      // Response contains department-level counts; sum them for total
      const tcContainer = countData?.ticketcount as Record<string, unknown> | undefined;
      const deptsContainer = tcContainer?.departments as Record<string, unknown> | undefined;
      const deptCounts = ensureArray(deptsContainer?.department) as Array<Record<string, unknown>>;
      for (const dc of deptCounts) {
        ticketCount += getNumber(dc?.totalitems);
      }
      // If that didn't work, fallback to listing
      if (ticketCount === 0) {
        const ticketData = await kayakoClassicFetch(auth, '/Tickets/Ticket/ListAll/-1/-1/-1/-1/1/0') as Record<string, unknown>;
        const ticketsContainer = ticketData?.tickets as Record<string, unknown> | undefined;
        const tickets = ensureArray(ticketsContainer?.ticket) as Array<Record<string, unknown>>;
        ticketCount = getNumber(ticketsContainer?.['@_count']) || tickets.length;
      }
    } catch {
      // Ticket endpoints may require specific permissions
    }

    return {
      success: true,
      departments: depts.map(d => getText(d.title)),
      ticketCount,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function kayakoClassicUpdateTicket(
  auth: KayakoClassicAuth,
  ticketId: number,
  updates: {
    subject?: string;
    statusid?: number;
    priorityid?: number;
    departmentid?: number;
    ownerstaffid?: number;
  },
): Promise<void> {
  const body: Record<string, string> = {};
  if (updates.subject) body.subject = updates.subject;
  if (updates.statusid !== undefined) body.ticketstatusid = String(updates.statusid);
  if (updates.priorityid !== undefined) body.ticketpriorityid = String(updates.priorityid);
  if (updates.departmentid !== undefined) body.departmentid = String(updates.departmentid);
  if (updates.ownerstaffid !== undefined) body.ownerstaffid = String(updates.ownerstaffid);

  await kayakoClassicFetch(auth, `/Tickets/Ticket/${ticketId}`, {
    method: 'PUT',
    body,
  });
}

export async function kayakoClassicPostReply(
  auth: KayakoClassicAuth,
  ticketId: number,
  contents: string,
  staffId?: number,
): Promise<void> {
  const body: Record<string, string> = {
    subject: contents.substring(0, 60),
    contents,
  };
  if (staffId) body.staffid = String(staffId);

  await kayakoClassicFetch(auth, `/Tickets/TicketPost/Ticket/${ticketId}`, {
    method: 'POST',
    body,
  });
}

export async function kayakoClassicPostNote(
  auth: KayakoClassicAuth,
  ticketId: number,
  contents: string,
  staffId?: number,
): Promise<void> {
  const body: Record<string, string> = {
    contents,
  };
  if (staffId) body.staffid = String(staffId);

  // notecolor: 1=yellow, 2=purple, 3=blue, 4=green, 5=red
  body.notecolor = '1';

  await kayakoClassicFetch(auth, `/Tickets/TicketNote/Ticket/${ticketId}`, {
    method: 'POST',
    body,
  });
}

export async function kayakoClassicCreateTicket(
  auth: KayakoClassicAuth,
  subject: string,
  contents: string,
  options: {
    departmentid: number;
    fullname?: string;
    email?: string;
    statusid?: number;
    priorityid?: number;
    typeid?: number;
    staffid?: number;
    autouserid?: boolean;
  },
): Promise<{ id: number; displayId: string }> {
  const body: Record<string, string> = {
    subject,
    contents,
    departmentid: String(options.departmentid),
  };

  if (options.fullname) body.fullname = options.fullname;
  if (options.email) body.email = options.email;
  if (options.statusid) body.ticketstatusid = String(options.statusid);
  if (options.priorityid) body.ticketpriorityid = String(options.priorityid);
  if (options.typeid) body.tickettypeid = String(options.typeid);
  if (options.staffid) body.staffid = String(options.staffid);
  if (options.autouserid) body.autouserid = '1';

  const result = await kayakoClassicFetch(auth, '/Tickets/Ticket', {
    method: 'POST',
    body,
  }) as Record<string, unknown>;

  const ticketsContainer = result?.tickets as Record<string, unknown> | undefined;
  const tickets = ensureArray(ticketsContainer?.ticket) as Array<Record<string, unknown>>;
  const ticket = tickets[0];
  if (!ticket) {
    // Try alternate response structure
    const directTicket = (result as Record<string, unknown>)?.ticket as Record<string, unknown>;
    if (directTicket) {
      return {
        id: getNumber(directTicket.id),
        displayId: getText(directTicket.displayid),
      };
    }
    throw new Error('No ticket returned in create response');
  }

  return {
    id: getNumber(ticket.id),
    displayId: getText(ticket.displayid),
  };
}

// ----- Export -----

export async function exportKayakoClassic(auth: KayakoClassicAuth, outDir: string): Promise<ExportManifest> {
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

  // Fetch status and priority maps first for label resolution
  const statusMap = await fetchStatusMap(auth);
  const priorityMap = await fetchPriorityMap(auth);

  // ----- Export Tickets -----
  const ticketSpinner = ora('Exporting tickets...').start();
  const batchSize = 100;
  let start = 0;
  let hasMore = true;

  while (hasMore) {
    // ListAll/{deptId}/{statusId}/{staffId}/{userId}/{count}/{start}
    // Use -1 for all filters
    const data = await kayakoClassicFetch(
      auth,
      `/Tickets/Ticket/ListAll/-1/-1/-1/-1/${batchSize}/${start}`,
    ) as Record<string, unknown>;

    const ticketsContainer = (data as Record<string, unknown>)?.tickets as Record<string, unknown>;
    const rawTickets = ensureArray(ticketsContainer?.ticket) as ClassicTicket[];

    if (rawTickets.length === 0) {
      hasMore = false;
      break;
    }

    for (const t of rawTickets) {
      const statusLabel = statusMap[getText(t.statusid)] ?? 'Open';
      const priorityLabel = priorityMap[getText(t.priorityid)] ?? 'Normal';

      // Parse tags - may be comma-separated string or empty
      const tagStr = getText(t.tags);
      const tags = tagStr ? tagStr.split(',').map(s => s.trim()).filter(Boolean) : [];

      const ticket: Ticket = {
        id: `kyc-${getText(t.id)}`,
        externalId: getText(t.displayid) || getText(t.id),
        source: 'kayako-classic',
        subject: getText(t.subject),
        status: mapStatus(statusLabel),
        priority: mapPriority(priorityLabel),
        assignee: getText(t.ownerstaffname) || undefined,
        requester: getText(t.email) || getText(t.fullname) || String(getNumber(t.userid)),
        tags,
        createdAt: new Date(getNumber(t.creationtime) * 1000).toISOString(),
        updatedAt: new Date(getNumber(t.lastactivity) * 1000).toISOString(),
      };
      appendJsonl(ticketsFile, ticket);
      counts.tickets++;

      // Fetch posts for this ticket
      try {
        const postsData = await kayakoClassicFetch(
          auth,
          `/Tickets/TicketPost/ListAll/${getText(t.id)}`,
        ) as Record<string, unknown>;
        const postsContainer = (postsData as Record<string, unknown>)?.ticketposts as Record<string, unknown>;
        const rawPosts = ensureArray(postsContainer?.ticketpost) as ClassicTicketPost[];

        for (const p of rawPosts) {
          const isPrivate = getText(p.isprivate) === '1';
          const message: Message = {
            id: `kyc-msg-${getText(p.ticketpostid) || getText(p.id)}`,
            ticketId: `kyc-${getText(t.id)}`,
            author: getText(p.fullname) || getText(p.email) || 'Unknown',
            body: getText(p.contents),
            bodyHtml: getText(p.ishtml) === '1' ? getText(p.contents) : undefined,
            type: isPrivate ? 'note' : 'reply',
            createdAt: new Date(getNumber(p.dateline) * 1000).toISOString(),
          };
          appendJsonl(messagesFile, message);
          counts.messages++;
        }
      } catch {
        ticketSpinner.text = `Exporting tickets... ${counts.tickets} (posts fetch failed for #${getText(t.id)})`;
      }

      // Fetch notes for this ticket
      try {
        const notesData = await kayakoClassicFetch(
          auth,
          `/Tickets/TicketNote/ListAll/${getText(t.id)}`,
        ) as Record<string, unknown>;
        const notesContainer = (notesData as Record<string, unknown>)?.ticketnotes as Record<string, unknown>;
        const rawNotes = ensureArray(notesContainer?.ticketnote) as ClassicTicketNote[];

        for (const n of rawNotes) {
          const message: Message = {
            id: `kyc-note-${getText(n.ticketnoteid) || getText(n.id)}`,
            ticketId: `kyc-${getText(t.id)}`,
            author: getText(n.creatorstaffname) || String(getNumber(n.creatorstaffid)),
            body: getText(n.contents),
            type: 'note',
            createdAt: new Date(getNumber(n.creationdate) * 1000).toISOString(),
          };
          appendJsonl(messagesFile, message);
          counts.messages++;
        }
      } catch {
        // Notes endpoint may not be available for all tickets
      }
    }

    ticketSpinner.text = `Exporting tickets... ${counts.tickets} exported (${counts.messages} messages)`;
    hasMore = rawTickets.length === batchSize;
    start += batchSize;
  }
  ticketSpinner.succeed(`${counts.tickets} tickets exported (${counts.messages} messages)`);

  // ----- Export Users -----
  const userSpinner = ora('Exporting users...').start();
  let marker = 1;
  hasMore = true;
  while (hasMore) {
    try {
      const data = await kayakoClassicFetch(
        auth,
        `/Base/User/Filter/${marker}/1000`,
      ) as Record<string, unknown>;
      const usersContainer = (data as Record<string, unknown>)?.users as Record<string, unknown>;
      const rawUsers = ensureArray(usersContainer?.user) as ClassicUser[];

      if (rawUsers.length === 0) {
        hasMore = false;
        break;
      }

      for (const u of rawUsers) {
        // Multiple emails may be in nested emailaddresses
        const customer: Customer = {
          id: `kyc-user-${getText(u.id)}`,
          externalId: getText(u.id),
          source: 'kayako-classic',
          name: getText(u.fullname),
          email: getText(u.email),
          phone: getText(u.phone) || undefined,
          orgId: getNumber(u.userorganizationid) ? getText(u.userorganizationid) : undefined,
        };
        appendJsonl(customersFile, customer);
        counts.customers++;
      }

      userSpinner.text = `Exporting users... ${counts.customers} exported`;
      // Marker-based: if we got a full page, there may be more
      hasMore = rawUsers.length === 1000;
      marker = getNumber(rawUsers[rawUsers.length - 1]?.id) + 1;
    } catch (err) {
      userSpinner.warn(`Users: ${err instanceof Error ? err.message : 'endpoint error'}`);
      hasMore = false;
    }
  }
  userSpinner.succeed(`${counts.customers} users exported`);

  // ----- Export Organizations -----
  const orgSpinner = ora('Exporting organizations...').start();
  try {
    const data = await kayakoClassicFetch(auth, '/Base/UserOrganization') as Record<string, unknown>;
    const orgsContainer = (data as Record<string, unknown>)?.userorganizations as Record<string, unknown>;
    const rawOrgs = ensureArray(orgsContainer?.userorganization) as ClassicOrg[];

    for (const o of rawOrgs) {
      const org: Organization = {
        id: `kyc-org-${getText(o.id)}`,
        externalId: getText(o.id),
        source: 'kayako-classic',
        name: getText(o.name),
        domains: [],
      };
      appendJsonl(orgsFile, org);
      counts.organizations++;
    }
  } catch (err) {
    orgSpinner.warn(`Organizations: ${err instanceof Error ? err.message : 'endpoint error'}`);
  }
  orgSpinner.succeed(`${counts.organizations} organizations exported`);

  // ----- Export KB Articles -----
  const kbSpinner = ora('Exporting KB articles...').start();
  try {
    const data = await kayakoClassicFetch(auth, '/Knowledgebase/Article') as Record<string, unknown>;
    const kbContainer = (data as Record<string, unknown>)?.kbarticles as Record<string, unknown>;
    const rawArticles = ensureArray(kbContainer?.kbarticle) as ClassicKBArticle[];

    for (const a of rawArticles) {
      const article: KBArticle = {
        id: `kyc-kb-${getText(a.kbarticleid)}`,
        externalId: getText(a.kbarticleid),
        source: 'kayako-classic',
        title: getText(a.subject),
        body: getText(a.contentstext) || getText(a.contents),
        categoryPath: getNumber(a.categoryid) ? [getText(a.categoryid)] : [],
      };
      appendJsonl(kbFile, article);
      counts.kbArticles++;
    }
  } catch (err) {
    kbSpinner.warn(`KB Articles: ${err instanceof Error ? err.message : 'endpoint error'}`);
  }
  kbSpinner.succeed(`${counts.kbArticles} KB articles exported`);

  // ----- Export Departments as rules (for reference) -----
  const rulesSpinner = ora('Exporting departments...').start();
  try {
    const data = await kayakoClassicFetch(auth, '/Base/Department') as Record<string, unknown>;
    const deptContainer = (data as Record<string, unknown>)?.departments as Record<string, unknown>;
    const rawDepts = ensureArray(deptContainer?.department) as ClassicDepartment[];

    for (const d of rawDepts) {
      const rule: Rule = {
        id: `kyc-dept-${getText(d.id)}`,
        externalId: getText(d.id),
        source: 'kayako-classic',
        type: 'automation',
        title: `Department: ${getText(d.title)}`,
        conditions: { module: getText(d.module), type: getText(d.type) },
        actions: {},
        active: true,
      };
      appendJsonl(rulesFile, rule);
      counts.rules++;
    }
  } catch {
    // Departments may not be accessible
  }
  rulesSpinner.succeed(`${counts.rules} departments exported`);

  const manifest: ExportManifest = {
    source: 'kayako-classic',
    exportedAt: new Date().toISOString(),
    counts,
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(chalk.green(`\nExport complete → ${outDir}/manifest.json`));
  return manifest;
}
