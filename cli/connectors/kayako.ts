import { mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import type {
  Ticket, Message, Customer, Organization, KBArticle, Rule, ExportManifest, TicketStatus, TicketPriority,
} from '../schema/types.js';

interface KayakoAuth {
  domain: string;
  email: string;
  password: string;
}

interface KayakoPaginatedResponse {
  total_count?: number;
  data: unknown[];
}

interface KayakoCase {
  id: number;
  subject: string;
  status: { label: string };
  priority: { label: string } | null;
  assigned_agent: { id: number; full_name: string } | null;
  requester: { id: number; full_name: string; email: string };
  tags: Array<{ name: string }>;
  created_at: string;
  updated_at: string;
}

interface KayakoPost {
  id: number;
  contents: string;
  contents_html?: string;
  creator: { id: number; full_name: string };
  is_requester: boolean;
  created_at: string;
}

interface KayakoUser {
  id: number;
  full_name: string;
  emails: Array<{ email: string; is_primary: boolean }>;
  phones: Array<{ phone: string }>;
  organization: { id: number } | null;
}

interface KayakoOrg {
  id: number;
  name: string;
  domains: string[];
}

interface KayakoTrigger {
  id: number;
  title: string;
  is_enabled: boolean;
  conditions: unknown;
  actions: unknown;
}

interface KayakoArticle {
  id: number;
  titles: Array<{ translation: string }>;
  contents: Array<{ translation: string }>;
  section: { id: number; titles: Array<{ translation: string }> } | null;
}

async function kayakoFetch<T>(auth: KayakoAuth, path: string): Promise<T> {
  const url = `https://${auth.domain}${path}`;
  const credentials = Buffer.from(`${auth.email}:${auth.password}`).toString('base64');

  let retries = 0;
  const maxRetries = 5;

  while (true) {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '10', 10);
      if (retries >= maxRetries) throw new Error('Rate limit exceeded after max retries');
      retries++;
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      continue;
    }

    if (!res.ok) {
      throw new Error(`Kayako API error: ${res.status} ${res.statusText} for ${url}`);
    }

    return res.json() as Promise<T>;
  }
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

  // Export cases (tickets)
  const caseSpinner = ora('Exporting cases...').start();
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const data = await kayakoFetch<KayakoPaginatedResponse & { data: KayakoCase[] }>(
      auth,
      `/api/v1/cases.json?offset=${offset}&limit=${limit}&include=requester,assigned_agent,tag`,
    );

    for (const c of data.data) {
      const ticket: Ticket = {
        id: `ky-${c.id}`,
        externalId: String(c.id),
        source: 'kayako',
        subject: c.subject,
        status: mapStatus(c.status?.label ?? 'open'),
        priority: mapPriority(c.priority?.label ?? null),
        assignee: c.assigned_agent ? c.assigned_agent.full_name : undefined,
        requester: c.requester?.email ?? String(c.requester?.id),
        tags: (c.tags ?? []).map(t => t.name),
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      };
      appendJsonl(ticketsFile, ticket);
      counts.tickets++;

      // Hydrate posts (messages) for each case
      try {
        let postOffset = 0;
        let hasMorePosts = true;
        while (hasMorePosts) {
          const posts = await kayakoFetch<KayakoPaginatedResponse & { data: KayakoPost[] }>(
            auth,
            `/api/v1/cases/${c.id}/posts.json?offset=${postOffset}&limit=100`,
          );
          for (const p of posts.data) {
            const message: Message = {
              id: `ky-msg-${p.id}`,
              ticketId: `ky-${c.id}`,
              author: p.creator?.full_name ?? String(p.creator?.id),
              body: p.contents,
              bodyHtml: p.contents_html,
              type: p.is_requester ? 'reply' : 'note',
              createdAt: p.created_at,
            };
            appendJsonl(messagesFile, message);
            counts.messages++;
          }
          hasMorePosts = posts.data.length === 100;
          postOffset += 100;
        }
      } catch {
        // Skip post hydration errors
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
      const primaryEmail = u.emails?.find(e => e.is_primary)?.email ?? u.emails?.[0]?.email ?? '';
      const customer: Customer = {
        id: `ky-user-${u.id}`,
        externalId: String(u.id),
        source: 'kayako',
        name: u.full_name,
        email: primaryEmail,
        phone: u.phones?.[0]?.phone,
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
        const org: Organization = {
          id: `ky-org-${o.id}`,
          externalId: String(o.id),
          source: 'kayako',
          name: o.name,
          domains: o.domains ?? [],
        };
        appendJsonl(orgsFile, org);
        counts.organizations++;
      }
      hasMore = data.data.length === limit;
      offset += limit;
    } catch {
      hasMore = false;
    }
  }
  orgSpinner.succeed(`${counts.organizations} organizations exported`);

  // Export KB articles
  const kbSpinner = ora('Exporting KB articles...').start();
  offset = 0;
  hasMore = true;
  while (hasMore) {
    try {
      const data = await kayakoFetch<KayakoPaginatedResponse & { data: KayakoArticle[] }>(
        auth,
        `/api/v1/helpcenter/articles.json?offset=${offset}&limit=${limit}`,
      );
      for (const a of data.data) {
        const article: KBArticle = {
          id: `ky-kb-${a.id}`,
          externalId: String(a.id),
          source: 'kayako',
          title: a.titles?.[0]?.translation ?? `Article ${a.id}`,
          body: a.contents?.[0]?.translation ?? '',
          categoryPath: a.section ? [a.section.titles?.[0]?.translation ?? String(a.section.id)] : [],
        };
        appendJsonl(kbFile, article);
        counts.kbArticles++;
      }
      hasMore = data.data.length === limit;
      offset += limit;
    } catch {
      hasMore = false;
    }
  }
  kbSpinner.succeed(`${counts.kbArticles} KB articles exported`);

  // Export triggers
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
        conditions: t.conditions,
        actions: t.actions,
        active: t.is_enabled,
      };
      appendJsonl(rulesFile, rule);
      counts.rules++;
    }
  } catch {
    // Triggers may not be accessible
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
