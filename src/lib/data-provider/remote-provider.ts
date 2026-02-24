/**
 * RemoteProvider — implements DataProvider via HTTP calls to a CLIaaS hosted API.
 *
 * Reads hostedApiUrl / hostedApiKey from env vars (CLIAAS_HOSTED_URL,
 * CLIAAS_HOSTED_API_KEY) with fallback to CLI config (~/.cliaas/config.json).
 *
 * Handles:
 *   - Paginated GET endpoints (auto-fetches all pages)
 *   - Auth errors (401/403) with clear messages
 *   - Non-JSON responses
 *   - Network errors with retry-friendly messages
 */

import type {
  DataProvider,
  ProviderCapabilities,
  Ticket,
  Message,
  KBArticle,
  Customer,
  Organization,
  RuleRecord,
  CSATRating,
  TicketCreateParams,
  TicketUpdateParams,
  MessageCreateParams,
  KBArticleCreateParams,
} from './types';

export class RemoteProvider implements DataProvider {
  readonly capabilities: ProviderCapabilities = {
    mode: 'remote',
    supportsWrite: true,
    supportsSync: false,
    supportsRag: true,
  };

  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env.CLIAAS_HOSTED_URL ?? '';
    this.apiKey = process.env.CLIAAS_HOSTED_API_KEY ?? '';

    // Fallback to CLI config if env vars are not set
    if (!this.baseUrl || !this.apiKey) {
      try {
        // Dynamic require to avoid hard dependency — config module may not be
        // available in all environments (e.g. browser builds).
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { loadConfig } = require('../../../cli/config.js') as typeof import('../../../cli/config.js');
        const cfg = loadConfig();
        if (!this.baseUrl && cfg.hostedApiUrl) this.baseUrl = cfg.hostedApiUrl;
        if (!this.apiKey && cfg.hostedApiKey) this.apiKey = cfg.hostedApiKey;
      } catch {
        // Config module unavailable — ignore
      }
    }

    if (!this.baseUrl) {
      throw new Error(
        'RemoteProvider requires a hosted API URL. Set CLIAAS_HOSTED_URL env var or run: cliaas config set-mode remote --url <url>',
      );
    }
  }

  // ---- Internal HTTP layer ----

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, '')}${path}`;

    let res: Response;
    try {
      res = await globalThis.fetch(url, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          ...init?.headers,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Network error reaching ${url}: ${message}`);
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Authentication failed (${res.status}) for ${path}. Check your API key with: cliaas config show`,
      );
    }

    if (!res.ok) {
      // Try to extract server error message
      let detail = res.statusText;
      try {
        const body = await res.json();
        if (body && typeof body === 'object' && 'error' in body) {
          detail = String(body.error);
        }
      } catch {
        // Non-JSON error body — use statusText
      }
      throw new Error(`Remote API error ${res.status}: ${detail} (${path})`);
    }

    // Guard against non-JSON success responses
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      throw new Error(
        `Unexpected content-type "${contentType}" from ${path}. Expected application/json.`,
      );
    }

    return res.json() as Promise<T>;
  }

  /**
   * Auto-paginate a list endpoint that returns { <key>: T[], total, limit, offset }.
   * Fetches all pages and returns the merged array.
   */
  private async fetchAllPages<T>(
    path: string,
    key: string,
    pageSize = 200,
  ): Promise<T[]> {
    const results: T[] = [];
    let offset = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const separator = path.includes('?') ? '&' : '?';
      const url = `${path}${separator}limit=${pageSize}&offset=${offset}`;
      const body = await this.request<Record<string, unknown>>(url);

      const items = (body[key] ?? []) as T[];
      results.push(...items);

      const total = typeof body.total === 'number' ? body.total : undefined;

      // If the server reports total, use it to decide when to stop.
      // Otherwise stop when we get fewer items than the page size.
      if (total !== undefined) {
        if (results.length >= total) break;
      } else {
        if (items.length < pageSize) break;
      }

      offset += pageSize;
    }

    return results;
  }

  // ---- Reads ----

  async loadTickets(): Promise<Ticket[]> {
    // GET /api/tickets returns { tickets: Ticket[], total, limit, offset }
    return this.fetchAllPages<Ticket>('/api/tickets', 'tickets');
  }

  async loadMessages(ticketId?: string): Promise<Message[]> {
    if (ticketId) {
      // GET /api/tickets/:id returns { ticket, messages }
      const body = await this.request<{ ticket: Ticket; messages: Message[] }>(
        `/api/tickets/${encodeURIComponent(ticketId)}`,
      );
      return body.messages;
    }
    // No server-side all-messages endpoint — fetch all tickets then their messages.
    // This is expensive but correct. Callers should prefer passing ticketId.
    const tickets = await this.loadTickets();
    const batches = await Promise.all(
      tickets.map((t) => this.loadMessages(t.id)),
    );
    return batches.flat();
  }

  async loadKBArticles(): Promise<KBArticle[]> {
    // GET /api/kb returns { articles: KBArticle[], total }
    const body = await this.request<{ articles: KBArticle[]; total: number }>('/api/kb');
    return body.articles;
  }

  async loadCustomers(): Promise<Customer[]> {
    // GET /api/customers returns { customers, organizations }
    const body = await this.request<{ customers: Customer[]; organizations: Organization[] }>(
      '/api/customers',
    );
    return body.customers;
  }

  async loadOrganizations(): Promise<Organization[]> {
    // GET /api/customers returns { customers, organizations }
    const body = await this.request<{ customers: Customer[]; organizations: Organization[] }>(
      '/api/customers',
    );
    return body.organizations;
  }

  async loadRules(): Promise<RuleRecord[]> {
    // GET /api/rules returns { rules }
    const body = await this.request<{ rules: RuleRecord[] }>('/api/rules');
    return body.rules;
  }

  async loadCSATRatings(): Promise<CSATRating[]> {
    // GET /api/csat/ratings returns { ratings }
    // Falls back to empty array if endpoint doesn't exist (csat route returns stats only)
    try {
      const body = await this.request<{ ratings: CSATRating[] }>('/api/csat/ratings');
      return body.ratings;
    } catch {
      // The base /api/csat endpoint returns aggregated stats, not raw ratings.
      // Return empty if the detailed endpoint isn't available.
      return [];
    }
  }

  // ---- Writes ----

  async createTicket(params: TicketCreateParams): Promise<{ id: string }> {
    // POST /api/tickets/create expects { source, subject, message, ... }
    // Adapt DataProvider params to API shape
    return this.request<{ id: string }>('/api/tickets/create', {
      method: 'POST',
      body: JSON.stringify({
        source: params.source ?? 'api',
        subject: params.subject,
        message: params.description ?? params.subject,
        priority: params.priority,
        tags: params.tags,
      }),
    });
  }

  async updateTicket(ticketId: string, params: TicketUpdateParams): Promise<void> {
    await this.request(`/api/tickets/${encodeURIComponent(ticketId)}`, {
      method: 'PATCH',
      body: JSON.stringify(params),
    });
  }

  async createMessage(params: MessageCreateParams): Promise<{ id: string }> {
    // POST /api/tickets/:id/reply expects { message, isNote? }
    const body = {
      message: params.body,
      isNote: params.visibility === 'internal',
    };
    const result = await this.request<{ status: string }>(
      `/api/tickets/${encodeURIComponent(params.ticketId)}/reply`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
    // The reply endpoint returns { status: 'ok' } — synthesize an id
    return { id: `msg-${Date.now()}` };
  }

  async createKBArticle(params: KBArticleCreateParams): Promise<{ id: string }> {
    // POST /api/kb returns { article: { id, ... } }
    const body = await this.request<{ article: { id: string } }>('/api/kb', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    return { id: body.article.id };
  }
}
