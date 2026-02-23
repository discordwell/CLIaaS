import type {
  Ticket, Message, Customer, Organization, ExportManifest, TicketStatus,
} from '../schema/types';
import {
  createClient, paginateOffset, setupExport, appendJsonl, writeManifest, exportSpinner,
} from './base/index';

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

// ---- Client ----

function createHelpcrunchClient(auth: HelpcrunchAuth) {
  return createClient({
    baseUrl: 'https://api.helpcrunch.com/v1',
    authHeaders: () => ({
      Authorization: `Bearer ${auth.apiKey}`,
    }),
    sourceName: 'HelpCrunch',
    defaultRetryAfterSeconds: 5,
  });
}

/** @deprecated Use createHelpcrunchClient() + client.request() instead. Kept for backward compatibility. */
export async function helpcrunchFetch<T>(auth: HelpcrunchAuth, path: string, options?: {
  method?: string;
  body?: unknown;
}): Promise<T> {
  return createHelpcrunchClient(auth).request<T>(path, options);
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

// ---- Export ----

export async function exportHelpcrunch(auth: HelpcrunchAuth, outDir: string): Promise<ExportManifest> {
  const client = createHelpcrunchClient(auth);
  const files = setupExport(outDir);
  const counts = { tickets: 0, messages: 0, customers: 0, organizations: 0, kbArticles: 0, rules: 0 };

  // Export chats (= tickets)
  const chatSpinner = exportSpinner('Exporting chats...');
  await paginateOffset<HCChat>({
    fetch: client.request.bind(client),
    path: '/chats',
    limit: 100,
    dataKey: 'data',
    onPage: async (chats) => {
      for (const chat of chats) {
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
        appendJsonl(files.tickets, ticket);
        counts.tickets++;

        // Hydrate messages for each chat
        try {
          await paginateOffset<HCMessage>({
            fetch: client.request.bind(client),
            path: `/chats/${chat.id}/messages`,
            limit: 100,
            dataKey: 'data',
            onPage: (messages) => {
              for (const m of messages) {
                const message: Message = {
                  id: `hc-msg-${m.id}`,
                  ticketId: `hc-${chat.id}`,
                  author: m.from === 'agent' && m.agent ? String(m.agent.id) : String(chat.customer?.id ?? 'customer'),
                  body: m.text ?? '',
                  type: 'reply',
                  createdAt: epochToISO(m.createdAt),
                };
                appendJsonl(files.messages, message);
                counts.messages++;
              }
            },
          });
        } catch {
          chatSpinner.text = `Exporting chats... ${counts.tickets} (messages failed for #${chat.id})`;
        }
      }
      chatSpinner.text = `Exporting chats... ${counts.tickets} exported`;
    },
  });
  chatSpinner.succeed(`${counts.tickets} chats exported (${counts.messages} messages)`);

  // Export customers (also collect org names in same pass)
  const customerSpinner = exportSpinner('Exporting customers...');
  const orgNames = new Set<string>();
  await paginateOffset<HCCustomer>({
    fetch: client.request.bind(client),
    path: '/customers',
    limit: 100,
    dataKey: 'data',
    onPage: (customers) => {
      for (const c of customers) {
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
        appendJsonl(files.customers, customer);
        counts.customers++;
      }
      customerSpinner.text = `Exporting customers... ${counts.customers} exported`;
    },
  });
  customerSpinner.succeed(`${counts.customers} customers exported`);

  // Export agents as customers too (for author resolution)
  const agentSpinner = exportSpinner('Exporting agents...');
  try {
    const agents = await client.request<{ data: HCAgent[] }>('/agents');
    for (const a of agents.data) {
      const customer: Customer = {
        id: `hc-agent-${a.id}`,
        externalId: `agent-${a.id}`,
        source: 'helpcrunch',
        name: a.name,
        email: a.email,
      };
      appendJsonl(files.customers, customer);
      counts.customers++;
    }
    agentSpinner.succeed(`${agents.data.length} agents exported`);
  } catch (err) {
    agentSpinner.warn(`Agents: ${err instanceof Error ? err.message : 'endpoint not available'}`);
  }

  // Write organizations from company names collected during customer export
  const orgSpinner = exportSpinner('Collecting organizations...');
  for (const name of orgNames) {
    const org: Organization = {
      id: `hc-org-${name}`,
      externalId: name,
      source: 'helpcrunch',
      name,
      domains: [],
    };
    appendJsonl(files.organizations, org);
    counts.organizations++;
  }
  orgSpinner.succeed(`${counts.organizations} organizations collected`);

  // No KB or Rules API available
  exportSpinner('KB articles: not available via HelpCrunch API').info();
  exportSpinner('Business rules: not available via HelpCrunch API').info();

  return writeManifest(outDir, 'helpcrunch', counts);
}

// ---- Verify ----

export async function helpcrunchVerifyConnection(auth: HelpcrunchAuth): Promise<{
  success: boolean;
  agentCount?: number;
  chatCount?: number;
  error?: string;
}> {
  try {
    const client = createHelpcrunchClient(auth);
    const agents = await client.request<{ data: HCAgent[] }>('/agents');
    const chats = await client.request<{ data: HCChat[]; meta: { total: number } }>('/chats?offset=0&limit=1');

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
  const client = createHelpcrunchClient(auth);
  if (updates.status !== undefined) {
    await client.request(`/chats/${chatId}/status`, {
      method: 'PUT',
      body: { status: updates.status },
    });
  }
  if (updates.assignee !== undefined) {
    await client.request(`/chats/${chatId}/assignee`, {
      method: 'PUT',
      body: { assignee: updates.assignee },
    });
  }
  if (updates.department !== undefined) {
    await client.request(`/chats/${chatId}/department`, {
      method: 'PUT',
      body: { department: updates.department },
    });
  }
}

export async function helpcrunchPostMessage(auth: HelpcrunchAuth, chatId: number, body: string): Promise<void> {
  await createHelpcrunchClient(auth).request(`/chats/${chatId}/messages`, {
    method: 'POST',
    body: { text: body, type: 'message' },
  });
}

export async function helpcrunchCreateChat(auth: HelpcrunchAuth, customerId: number, message: string): Promise<{ id: number }> {
  const result = await createHelpcrunchClient(auth).request<{ id: number }>('/chats', {
    method: 'POST',
    body: { customer: customerId, message: { text: message } },
  });
  return { id: result.id };
}
