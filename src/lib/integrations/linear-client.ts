/**
 * Linear GraphQL API client.
 * Auth: Personal API key (Bearer token).
 * Docs: https://developers.linear.app/docs/graphql/working-with-the-graphql-api
 */

export interface LinearAuth {
  apiKey: string;
}

export interface LinearIssue {
  id: string;
  identifier: string;   // e.g. 'ENG-42'
  title: string;
  description?: string;
  url: string;
  state: { id: string; name: string; type: string };
  priority: number;     // 0=none, 1=urgent, 2=high, 3=medium, 4=low
  assignee?: { id: string; name: string; email?: string };
  team: { id: string; key: string; name: string };
  labels: { nodes: Array<{ id: string; name: string }> };
  createdAt: string;
  updatedAt: string;
  comments?: { nodes: LinearComment[] };
}

export interface LinearComment {
  id: string;
  body: string;
  user?: { name: string; email?: string };
  createdAt: string;
  updatedAt: string;
}

export interface LinearTeam {
  id: string;
  key: string;
  name: string;
  states: { nodes: Array<{ id: string; name: string; type: string }> };
}

export interface LinearSearchResult {
  issues: LinearIssue[];
  pageInfo: { hasNextPage: boolean; endCursor?: string };
}

// ---- Client ----

const LINEAR_API = 'https://api.linear.app/graphql';

export class LinearClient {
  private apiKey: string;

  constructor(auth: LinearAuth) {
    this.apiKey = auth.apiKey;
  }

  private async gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(LINEAR_API, {
      method: 'POST',
      headers: {
        'Authorization': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Linear API failed (${res.status}): ${text.slice(0, 500)}`);
    }

    const json = await res.json() as { data?: T; errors?: Array<{ message: string }> };
    if (json.errors?.length) {
      throw new Error(`Linear GraphQL error: ${json.errors.map(e => e.message).join(', ')}`);
    }
    return json.data as T;
  }

  // ---- Verify ----

  async verify(): Promise<{ userId: string; name: string; email: string }> {
    const data = await this.gql<{ viewer: { id: string; name: string; email: string } }>(`
      query { viewer { id name email } }
    `);
    return { userId: data.viewer.id, name: data.viewer.name, email: data.viewer.email };
  }

  // ---- Issues ----

  async getIssue(issueId: string): Promise<LinearIssue> {
    const data = await this.gql<{ issue: LinearIssue }>(`
      query($id: String!) {
        issue(id: $id) {
          id identifier title description url
          state { id name type }
          priority
          assignee { id name email }
          team { id key name }
          labels { nodes { id name } }
          createdAt updatedAt
          comments { nodes { id body user { name email } createdAt updatedAt } }
        }
      }
    `, { id: issueId });
    return data.issue;
  }

  async getIssueByIdentifier(identifier: string): Promise<LinearIssue | null> {
    const parts = identifier.split('-');
    if (parts.length < 2) return null;
    const teamKey = parts[0];
    const number = parseInt(parts.slice(1).join('-'));
    if (isNaN(number)) return null;

    const data = await this.gql<{ issues: { nodes: LinearIssue[] } }>(`
      query($filter: IssueFilter) {
        issues(filter: $filter, first: 1) {
          nodes {
            id identifier title description url
            state { id name type }
            priority
            assignee { id name email }
            team { id key name }
            labels { nodes { id name } }
            createdAt updatedAt
            comments { nodes { id body user { name email } createdAt updatedAt } }
          }
        }
      }
    `, {
      filter: {
        team: { key: { eq: teamKey } },
        number: { eq: number },
      },
    });
    return data.issues.nodes[0] ?? null;
  }

  async createIssue(opts: {
    teamId: string;
    title: string;
    description?: string;
    priority?: number;
    labelIds?: string[];
    stateId?: string;
  }): Promise<LinearIssue> {
    const data = await this.gql<{ issueCreate: { issue: LinearIssue; success: boolean } }>(`
      mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id identifier title description url
            state { id name type }
            priority
            assignee { id name email }
            team { id key name }
            labels { nodes { id name } }
            createdAt updatedAt
          }
        }
      }
    `, {
      input: {
        teamId: opts.teamId,
        title: opts.title,
        description: opts.description,
        priority: opts.priority,
        labelIds: opts.labelIds,
        stateId: opts.stateId,
      },
    });
    return data.issueCreate.issue;
  }

  async updateIssue(issueId: string, input: Record<string, unknown>): Promise<LinearIssue> {
    const data = await this.gql<{ issueUpdate: { issue: LinearIssue; success: boolean } }>(`
      mutation($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue {
            id identifier title description url
            state { id name type }
            priority
            assignee { id name email }
            team { id key name }
            labels { nodes { id name } }
            createdAt updatedAt
          }
        }
      }
    `, { id: issueId, input });
    return data.issueUpdate.issue;
  }

  async searchIssues(query: string, first = 50): Promise<LinearSearchResult> {
    const data = await this.gql<{ issueSearch: { nodes: LinearIssue[]; pageInfo: { hasNextPage: boolean; endCursor?: string } } }>(`
      query($query: String!, $first: Int) {
        issueSearch(query: $query, first: $first) {
          nodes {
            id identifier title description url
            state { id name type }
            priority
            assignee { id name email }
            team { id key name }
            labels { nodes { id name } }
            createdAt updatedAt
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { query, first });
    return { issues: data.issueSearch.nodes, pageInfo: data.issueSearch.pageInfo };
  }

  // ---- Comments ----

  async getComments(issueId: string): Promise<LinearComment[]> {
    const data = await this.gql<{ issue: { comments: { nodes: LinearComment[] } } }>(`
      query($id: String!) {
        issue(id: $id) {
          comments { nodes { id body user { name email } createdAt updatedAt } }
        }
      }
    `, { id: issueId });
    return data.issue.comments.nodes;
  }

  async addComment(issueId: string, body: string): Promise<LinearComment> {
    const data = await this.gql<{ commentCreate: { comment: LinearComment; success: boolean } }>(`
      mutation($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment { id body user { name email } createdAt updatedAt }
        }
      }
    `, { input: { issueId, body } });
    return data.commentCreate.comment;
  }

  // ---- Teams ----

  async listTeams(): Promise<LinearTeam[]> {
    const data = await this.gql<{ teams: { nodes: LinearTeam[] } }>(`
      query {
        teams {
          nodes {
            id key name
            states { nodes { id name type } }
          }
        }
      }
    `);
    return data.teams.nodes;
  }

  // ---- State transitions ----

  async transitionByName(issueId: string, stateName: string, teamId: string): Promise<boolean> {
    const teams = await this.listTeams();
    const team = teams.find(t => t.id === teamId);
    if (!team) return false;
    const state = team.states.nodes.find(s => s.name.toLowerCase() === stateName.toLowerCase());
    if (!state) return false;
    await this.updateIssue(issueId, { stateId: state.id });
    return true;
  }
}
