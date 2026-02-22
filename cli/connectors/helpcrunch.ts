import { mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import type {
  Ticket, Message, Customer, Organization, ExportManifest, TicketStatus,
} from '../schema/types.js';

export interface HelpcrunchAuth {
  apiKey: string;
}

// ---- HelpCrunch API types ----

interface HCChat {
  id: number;
  status: number; // 1=New, 2=Opened, 3=Pending, 4=On-hold, 5=Closed, 6=No-comm, 7=Empty
  createdAt: string; // UNIX epoch string
  closedAt: string | null;
  lastMessageAt: string | null;
  lastMessageText: string | null;
  customer: { id: number; name?: string; email?: string } | null;
  assignee: { id: number; name?: string; email?: string } | null;
  agents: Array<{ id: number; name?: string }>;
  department: { id: number; name?: string } | null;
}

interface HCMessage {
  id: number;
  text: string;
  type: string;
  from: 'agent' | 'customer';
  createdAt: string; // UNIX epoch string
  agent?: { id: number; name?: string; email?: string };
  read: boolean;
}

interface HCCustomer {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  userId: string | null;
  createdFrom: string | null;
}

interface HCAgent {
  id: number;
  name: string;
  email: string;
  role: string;
}

// ---- Fetch wrapper ----

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function helpcrunchFetch<T>(auth: HelpcrunchAuth, path: string, options?: {
  method?: string;
  body?: unknown;
}): Promise<T> {
  const url = path.startsWith('http') ? path : `https://api.helpcrunch.com/v1${path}`;

  let retries = 0;
  const maxRetries = 5;

  while (true) {
    const res = await fetch(url, {
      method: options?.method ?? 'GET',
      headers: {
        'Authorization': `Bearer ${auth.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (res.status === 429) {
      const rawRetryAfter = parseInt(res.headers.get('Retry-After') ?? '5', 10);
      const retryAfter = isNaN(rawRetryAfter) ? 5 : rawRetryAfter;
      if (retries >= maxRetries) throw new Error('Rate limit exceeded after max retries');
      retries++;
      await sleep(retryAfter * 1000);
      continue;
    }

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(`HelpCrunch API error: ${res.status} ${res.statusText} for ${url}${errorBody ? ` — ${errorBody.slice(0, 200)}` : ''}`);
    }

    return res.json() as Promise<T>;
  }
}

// ---- Mapping helpers ----

function mapChatStatus(status: number): TicketStatus {
  const map: Record<number, TicketStatus> = {
    1: 'open',     // New
    2: 'open',     // Opened
    3: 'pending',  // Pending
    4: 'on_hold',  // On-hold
    5: 'closed',   // Closed
    6: 'closed',   // No communication
    7: 'closed',   // Empty
  };
  return map[status] ?? 'open';
}

function epochToISO(epoch: string | null): string {
  if (!epoch) return new Date().toISOString();
  const num = parseInt(epoch, 10);
  if (isNaN(num)) return new Date().toISOString();
  return new Date(num * 1000).toISOString();
}

function appendJsonl(filePath: string, record: unknown): void {
  appendFileSync(filePath, JSON.stringify(record) + '\n');
}

// ---- Export ----

export async function exportHelpcrunch(auth: HelpcrunchAuth, outDir: string): Promise<ExportManifest> {
  mkdirSync(outDir, { recursive: true });

  const ticketsFile = join(outDir, 'tickets.jsonl');
  const messagesFile = join(outDir, 'messages.jsonl');
  const customersFile = join(outDir, 'customers.jsonl');
  const orgsFile = join(outDir, 'organizations.jsonl');
  const kbFile = join(outDir, 'kb_articles.jsonl');
  const rulesFile = join(outDir, 'rules.jsonl');

  // Full export — clear existing files
  for (const f of [ticketsFile, messagesFile, customersFile, orgsFile, kbFile, rulesFile]) {
    writeFileSync(f, '');
  }

  const counts = { tickets: 0, messages: 0, customers: 0, organizations: 0, kbArticles: 0, rules: 0 };

  // Export chats (= tickets)
  const chatSpinner = ora('Exporting chats...').start();
  let chatOffset = 0;
  const chatLimit = 100;
  let hasMoreChats = true;

  while (hasMoreChats) {
    const data = await helpcrunchFetch<{ data: HCChat[]; meta: { total: number } }>(
      auth, `/chats?offset=${chatOffset}&limit=${chatLimit}`,
    );

    for (const chat of data.data) {
      const ticket: Ticket = {
        id: `hc-${chat.id}`,
        externalId: String(chat.id),
        source: 'helpcrunch',
        subject: chat.lastMessageText?.slice(0, 100) ?? `Chat #${chat.id}`,
        status: mapChatStatus(chat.status),
        priority: 'normal', // HelpCrunch chats don't have priority
        assignee: chat.assignee ? String(chat.assignee.id) : undefined,
        requester: chat.customer ? String(chat.customer.id) : 'unknown',
        tags: chat.department ? [chat.department.name ?? `dept-${chat.department.id}`] : [],
        createdAt: epochToISO(chat.createdAt),
        updatedAt: epochToISO(chat.lastMessageAt ?? chat.createdAt),
      };
      appendJsonl(ticketsFile, ticket);
      counts.tickets++;

      // Hydrate messages for each chat
      try {
        let msgOffset = 0;
        let hasMoreMsgs = true;
        while (hasMoreMsgs) {
          const msgData = await helpcrunchFetch<{ data: HCMessage[] }>(
            auth, `/chats/${chat.id}/messages?offset=${msgOffset}&limit=100`,
          );
          for (const m of msgData.data) {
            const message: Message = {
              id: `hc-msg-${m.id}`,
              ticketId: `hc-${chat.id}`,
              author: m.from === 'agent' && m.agent ? String(m.agent.id) : String(chat.customer?.id ?? 'customer'),
              body: m.text ?? '',
              type: 'reply',
              createdAt: epochToISO(m.createdAt),
            };
            appendJsonl(messagesFile, message);
            counts.messages++;
          }
          if (msgData.data.length < 100) {
            hasMoreMsgs = false;
          } else {
            msgOffset += 100;
          }
        }
      } catch {
        chatSpinner.text = `Exporting chats... ${counts.tickets} (messages failed for #${chat.id})`;
      }
    }

    chatSpinner.text = `Exporting chats... ${counts.tickets} exported`;

    if (data.data.length < chatLimit || chatOffset + chatLimit >= data.meta.total) {
      hasMoreChats = false;
    } else {
      chatOffset += chatLimit;
    }
  }
  chatSpinner.succeed(`${counts.tickets} chats exported (${counts.messages} messages)`);

  // Export customers (also collect org names in same pass)
  const customerSpinner = ora('Exporting customers...').start();
  const orgNames = new Set<string>();
  let custOffset = 0;
  let hasMoreCust = true;

  while (hasMoreCust) {
    const data = await helpcrunchFetch<{ data: HCCustomer[]; total: number }>(
      auth, `/customers?offset=${custOffset}&limit=100`,
    );

    for (const c of data.data) {
      if (c.company) orgNames.add(c.company);
      const customer: Customer = {
        id: `hc-user-${c.id}`,
        externalId: String(c.id),
        source: 'helpcrunch',
        name: c.name ?? c.email ?? `Customer ${c.id}`,
        email: c.email ?? '',
        phone: c.phone ?? undefined,
        orgId: c.company ? `hc-org-${c.company}` : undefined,
      };
      appendJsonl(customersFile, customer);
      counts.customers++;
    }

    customerSpinner.text = `Exporting customers... ${counts.customers} exported`;

    if (data.data.length < 100 || custOffset + 100 >= data.total) {
      hasMoreCust = false;
    } else {
      custOffset += 100;
    }
  }
  customerSpinner.succeed(`${counts.customers} customers exported`);

  // Export agents as customers too (for author resolution)
  const agentSpinner = ora('Exporting agents...').start();
  try {
    const agents = await helpcrunchFetch<{ data: HCAgent[] }>(auth, '/agents');
    for (const a of agents.data) {
      const customer: Customer = {
        id: `hc-agent-${a.id}`,
        externalId: `agent-${a.id}`,
        source: 'helpcrunch',
        name: a.name,
        email: a.email,
      };
      appendJsonl(customersFile, customer);
      counts.customers++;
    }
    agentSpinner.succeed(`${agents.data.length} agents exported`);
  } catch (err) {
    agentSpinner.warn(`Agents: ${err instanceof Error ? err.message : 'endpoint not available'}`);
  }

  // Write organizations from company names collected during customer export
  const orgSpinner = ora('Collecting organizations...').start();
  for (const name of orgNames) {
    const org: Organization = {
      id: `hc-org-${name}`,
      externalId: name,
      source: 'helpcrunch',
      name,
      domains: [],
    };
    appendJsonl(orgsFile, org);
    counts.organizations++;
  }
  orgSpinner.succeed(`${counts.organizations} organizations collected`);

  // No KB or Rules API available
  ora('KB articles: not available via HelpCrunch API').info();
  ora('Business rules: not available via HelpCrunch API').info();

  const manifest: ExportManifest = {
    source: 'helpcrunch',
    exportedAt: new Date().toISOString(),
    counts,
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(chalk.green(`\nExport complete → ${outDir}/manifest.json`));
  return manifest;
}

// ---- Verify ----

export async function helpcrunchVerifyConnection(auth: HelpcrunchAuth): Promise<{
  success: boolean;
  agentCount?: number;
  chatCount?: number;
  error?: string;
}> {
  try {
    const agents = await helpcrunchFetch<{ data: HCAgent[] }>(auth, '/agents');
    const chats = await helpcrunchFetch<{ data: HCChat[]; meta: { total: number } }>(auth, '/chats?offset=0&limit=1');

    return {
      success: true,
      agentCount: agents.data.length,
      chatCount: chats.meta.total,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---- Write operations ----

export async function helpcrunchUpdateChat(auth: HelpcrunchAuth, chatId: number, updates: {
  status?: number;
  assignee?: number;
  department?: number;
}): Promise<void> {
  if (updates.status !== undefined) {
    await helpcrunchFetch(auth, `/chats/${chatId}/status`, {
      method: 'PUT',
      body: { status: updates.status },
    });
  }
  if (updates.assignee !== undefined) {
    await helpcrunchFetch(auth, `/chats/${chatId}/assignee`, {
      method: 'PUT',
      body: { assignee: updates.assignee },
    });
  }
  if (updates.department !== undefined) {
    await helpcrunchFetch(auth, `/chats/${chatId}/department`, {
      method: 'PUT',
      body: { department: updates.department },
    });
  }
}

export async function helpcrunchPostMessage(auth: HelpcrunchAuth, chatId: number, body: string): Promise<void> {
  await helpcrunchFetch(auth, `/chats/${chatId}/messages`, {
    method: 'POST',
    body: { text: body, type: 'message' },
  });
}

export async function helpcrunchCreateChat(auth: HelpcrunchAuth, customerId: number, message: string): Promise<{ id: number }> {
  const result = await helpcrunchFetch<{ id: number }>(auth, '/chats', {
    method: 'POST',
    body: { customer: customerId, message: { text: message } },
  });
  return { id: result.id };
}
