/**
 * Jira Cloud REST v3 API client.
 * Auth: Basic (email + API token) or OAuth 2.0.
 * Docs: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
 */

export interface JiraAuth {
  baseUrl: string;       // e.g. 'https://acme.atlassian.net'
  email: string;
  apiToken: string;
}

export interface JiraIssue {
  id: string;
  key: string;           // e.g. 'PROJ-123'
  self: string;
  fields: {
    summary: string;
    description?: unknown;
    status: { name: string; id: string };
    issuetype: { name: string; id: string };
    priority?: { name: string };
    assignee?: { displayName: string; emailAddress?: string };
    reporter?: { displayName: string; emailAddress?: string };
    project: { key: string; name: string };
    created: string;
    updated: string;
    labels?: string[];
    comment?: { comments: JiraComment[]; total: number };
  };
}

export interface JiraComment {
  id: string;
  author: { displayName: string; emailAddress?: string };
  body: unknown; // ADF (Atlassian Document Format)
  created: string;
  updated: string;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string; id: string };
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  issueTypes: Array<{ id: string; name: string; subtask: boolean }>;
}

export interface JiraSearchResult {
  issues: JiraIssue[];
  total: number;
  startAt: number;
  maxResults: number;
}

// ---- Client ----

export class JiraClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(auth: JiraAuth) {
    this.baseUrl = auth.baseUrl.replace(/\/$/, '');
    this.authHeader = 'Basic ' + Buffer.from(`${auth.email}:${auth.apiToken}`).toString('base64');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}/rest/api/3${path}`;
    const headers: Record<string, string> = {
      'Authorization': this.authHeader,
      'Accept': 'application/json',
    };
    if (body) headers['Content-Type'] = 'application/json';

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Jira API ${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  // ---- Verify ----

  async verify(): Promise<{ cloudId: string; serverTitle: string }> {
    const info = await this.request<{ cloudId?: string; serverTitle?: string }>('GET', '/serverInfo');
    return { cloudId: info.cloudId ?? '', serverTitle: info.serverTitle ?? 'Jira' };
  }

  // ---- Issues ----

  async getIssue(issueKey: string): Promise<JiraIssue> {
    return this.request<JiraIssue>('GET', `/issue/${encodeURIComponent(issueKey)}?expand=renderedFields`);
  }

  async createIssue(opts: {
    projectKey: string;
    issueType: string;
    summary: string;
    description?: string;
    priority?: string;
    labels?: string[];
  }): Promise<JiraIssue> {
    const body: Record<string, unknown> = {
      fields: {
        project: { key: opts.projectKey },
        issuetype: { name: opts.issueType },
        summary: opts.summary,
        ...(opts.description && {
          description: {
            type: 'doc',
            version: 1,
            content: [{
              type: 'paragraph',
              content: [{ type: 'text', text: opts.description }],
            }],
          },
        }),
        ...(opts.priority && { priority: { name: opts.priority } }),
        ...(opts.labels && { labels: opts.labels }),
      },
    };
    const created = await this.request<{ id: string; key: string; self: string }>('POST', '/issue', body);
    return this.getIssue(created.key);
  }

  async updateIssue(issueKey: string, fields: Record<string, unknown>): Promise<void> {
    await this.request<void>('PUT', `/issue/${encodeURIComponent(issueKey)}`, { fields });
  }

  async searchIssues(jql: string, maxResults = 50): Promise<JiraSearchResult> {
    return this.request<JiraSearchResult>('POST', '/search', {
      jql,
      maxResults,
      fields: ['summary', 'status', 'issuetype', 'priority', 'assignee', 'reporter', 'project', 'created', 'updated', 'labels'],
    });
  }

  // ---- Transitions (status changes) ----

  async getTransitions(issueKey: string): Promise<JiraTransition[]> {
    const res = await this.request<{ transitions: JiraTransition[] }>('GET', `/issue/${encodeURIComponent(issueKey)}/transitions`);
    return res.transitions;
  }

  async transitionIssue(issueKey: string, transitionId: string): Promise<void> {
    await this.request<void>('POST', `/issue/${encodeURIComponent(issueKey)}/transitions`, {
      transition: { id: transitionId },
    });
  }

  async transitionByName(issueKey: string, statusName: string): Promise<boolean> {
    const transitions = await this.getTransitions(issueKey);
    const target = transitions.find(t => t.to.name.toLowerCase() === statusName.toLowerCase());
    if (!target) return false;
    await this.transitionIssue(issueKey, target.id);
    return true;
  }

  // ---- Comments ----

  async getComments(issueKey: string): Promise<JiraComment[]> {
    const res = await this.request<{ comments: JiraComment[] }>('GET', `/issue/${encodeURIComponent(issueKey)}/comment`);
    return res.comments;
  }

  async addComment(issueKey: string, body: string): Promise<JiraComment> {
    return this.request<JiraComment>('POST', `/issue/${encodeURIComponent(issueKey)}/comment`, {
      body: {
        type: 'doc',
        version: 1,
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: body }],
        }],
      },
    });
  }

  // ---- Projects ----

  async listProjects(): Promise<JiraProject[]> {
    const res = await this.request<{ values: JiraProject[] }>('GET', '/project/search?maxResults=100');
    return res.values;
  }

  async getProject(key: string): Promise<JiraProject> {
    return this.request<JiraProject>('GET', `/project/${encodeURIComponent(key)}`);
  }

  // ---- Helper: build browsable URL ----

  browseUrl(issueKey: string): string {
    return `${this.baseUrl}/browse/${encodeURIComponent(issueKey)}`;
  }

  // ---- Helper: extract plain text from ADF ----

  static adfToText(adf: unknown): string {
    if (!adf || typeof adf !== 'object') return '';
    const doc = adf as { content?: Array<{ content?: Array<{ text?: string }> }> };
    return (doc.content ?? [])
      .flatMap(block => (block.content ?? []).map(inline => inline.text ?? ''))
      .join('\n');
  }
}
