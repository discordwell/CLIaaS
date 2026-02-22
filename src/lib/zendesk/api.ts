export interface ZendeskAuth {
  subdomain: string;
  email: string;
  token: string;
}

export interface ZendeskTicket {
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

export interface ZendeskComment {
  id: number;
  author_id: number;
  body: string;
  html_body: string;
  public: boolean;
  created_at: string;
  attachments?: ZendeskAttachment[];
}

export interface ZendeskAttachment {
  id: number;
  file_name: string;
  content_type: string;
  size: number;
  content_url: string;
}

export interface ZendeskUser {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  organization_id: number | null;
}

export interface ZendeskOrganization {
  id: number;
  name: string;
  domain_names: string[];
}

export interface ZendeskGroup {
  id: number;
  name: string;
}

export interface ZendeskTicketForm {
  id: number;
  name: string;
  active: boolean;
  position?: number;
  ticket_field_ids?: number[];
}

export interface ZendeskBrand {
  id: number;
  name: string;
  subdomain?: string;
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
      const retryAfter = Number.isNaN(rawRetryAfter) ? 10 : rawRetryAfter;
      if (retries >= maxRetries) throw new Error('Zendesk API rate limit exceeded');
      retries++;
      await sleep(retryAfter * 1000);
      continue;
    }

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(`Zendesk API error: ${res.status} ${res.statusText} for ${url}${errorBody ? ` — ${errorBody.slice(0, 200)}` : ''}`);
    }

    return res.json() as Promise<T>;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function mapStatus(status: string): 'open' | 'pending' | 'on_hold' | 'solved' | 'closed' {
  const map: Record<string, 'open' | 'pending' | 'on_hold' | 'solved' | 'closed'> = {
    new: 'open',
    open: 'open',
    pending: 'pending',
    hold: 'on_hold',
    solved: 'solved',
    closed: 'closed',
  };
  return map[status] ?? 'open';
}

export function mapPriority(priority: string | null): 'low' | 'normal' | 'high' | 'urgent' {
  if (!priority) return 'normal';
  const map: Record<string, 'low' | 'normal' | 'high' | 'urgent'> = {
    low: 'low',
    normal: 'normal',
    high: 'high',
    urgent: 'urgent',
  };
  return map[priority] ?? 'normal';
}
