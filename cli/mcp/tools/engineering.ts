import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';

export function registerEngineeringTools(server: McpServer): void {
  server.tool(
    'jira_create_issue',
    'Create a Jira issue from a CLIaaS ticket context',
    {
      ticketId: z.string().describe('CLIaaS ticket ID'),
      project: z.string().describe('Jira project key (e.g. PROJ)'),
      issueType: z.string().optional().describe('Jira issue type (default: Task)'),
      summary: z.string().optional().describe('Issue summary (default: ticket subject)'),
      description: z.string().optional().describe('Issue description'),
      confirm: z.boolean().default(true).describe('Must be true to execute'),
    },
    async ({ ticketId, project, issueType, summary, description, confirm }) => {
      if (!confirm) return textResult({ message: 'Set confirm=true to create issue' });
      try {
        const linkStore = await import('@/lib/integrations/link-store.js');
        const { JiraClient } = await import('@/lib/integrations/jira-client.js');
        const { createIssueFromTicket } = await import('@/lib/integrations/engineering-sync.js');

        const creds = linkStore.getCredentials('default', 'jira');
        if (!creds) return errorResult('Jira not configured. Use the engineering configure API first.');

        const c = creds.credentials as Record<string, string>;
        const client = { provider: 'jira' as const, jira: new JiraClient({ baseUrl: c.baseUrl, email: c.email, apiToken: c.apiToken }) };
        const link = await createIssueFromTicket(client, {
          workspaceId: 'default',
          ticketId,
          ticketSubject: summary ?? `Ticket ${ticketId}`,
          ticketDescription: description,
          projectKey: project,
          issueType: issueType ?? 'Task',
        });
        return textResult({ created: link.externalId, url: link.externalUrl, status: link.externalStatus });
      } catch (err) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'jira_link_issue',
    'Link an existing Jira issue to a CLIaaS ticket',
    {
      ticketId: z.string().describe('CLIaaS ticket ID'),
      issueKey: z.string().describe('Jira issue key (e.g. PROJ-123)'),
      confirm: z.boolean().default(true).describe('Must be true to execute'),
    },
    async ({ ticketId, issueKey, confirm }) => {
      if (!confirm) return textResult({ message: 'Set confirm=true to link issue' });
      try {
        const linkStore = await import('@/lib/integrations/link-store.js');
        const { JiraClient } = await import('@/lib/integrations/jira-client.js');
        const { linkExistingIssue } = await import('@/lib/integrations/engineering-sync.js');

        const creds = linkStore.getCredentials('default', 'jira');
        if (!creds) return errorResult('Jira not configured.');

        const c = creds.credentials as Record<string, string>;
        const client = { provider: 'jira' as const, jira: new JiraClient({ baseUrl: c.baseUrl, email: c.email, apiToken: c.apiToken }) };
        const link = await linkExistingIssue(client, { workspaceId: 'default', ticketId, issueKey });
        return textResult({ linked: link.externalId, url: link.externalUrl, status: link.externalStatus, title: link.externalTitle });
      } catch (err) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'jira_sync',
    'Trigger sync of all linked Jira issues (pull status + comments)',
    {
      ticketId: z.string().optional().describe('Optional: scope sync to a single ticket'),
    },
    async ({ ticketId }) => {
      try {
        const linkStore = await import('@/lib/integrations/link-store.js');
        const { JiraClient } = await import('@/lib/integrations/jira-client.js');
        const { syncWorkspaceLinks, syncTicketLinks } = await import('@/lib/integrations/engineering-sync.js');

        const creds = linkStore.getCredentials('default', 'jira');
        if (!creds) return errorResult('Jira not configured.');

        const c = creds.credentials as Record<string, string>;
        const client = { provider: 'jira' as const, jira: new JiraClient({ baseUrl: c.baseUrl, email: c.email, apiToken: c.apiToken }) };
        const result = ticketId
          ? await syncTicketLinks(client, ticketId)
          : await syncWorkspaceLinks(client, 'default');
        return textResult(result);
      } catch (err) {
        return errorResult(`Sync failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'linear_create_issue',
    'Create a Linear issue from a CLIaaS ticket context',
    {
      ticketId: z.string().describe('CLIaaS ticket ID'),
      teamId: z.string().describe('Linear team ID'),
      title: z.string().optional().describe('Issue title'),
      description: z.string().optional().describe('Issue description'),
      confirm: z.boolean().default(true).describe('Must be true to execute'),
    },
    async ({ ticketId, teamId, title, description, confirm }) => {
      if (!confirm) return textResult({ message: 'Set confirm=true to create issue' });
      try {
        const linkStore = await import('@/lib/integrations/link-store.js');
        const { LinearClient } = await import('@/lib/integrations/linear-client.js');
        const { createIssueFromTicket } = await import('@/lib/integrations/engineering-sync.js');

        const creds = linkStore.getCredentials('default', 'linear');
        if (!creds) return errorResult('Linear not configured.');

        const c = creds.credentials as Record<string, string>;
        const client = { provider: 'linear' as const, linear: new LinearClient({ apiKey: c.apiKey }) };
        const link = await createIssueFromTicket(client, {
          workspaceId: 'default',
          ticketId,
          ticketSubject: title ?? `Ticket ${ticketId}`,
          ticketDescription: description,
          teamId,
        });
        return textResult({ created: (link.metadata as Record<string, string>).identifier, url: link.externalUrl, status: link.externalStatus });
      } catch (err) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'linear_link_issue',
    'Link an existing Linear issue to a CLIaaS ticket',
    {
      ticketId: z.string().describe('CLIaaS ticket ID'),
      issueId: z.string().describe('Linear issue identifier (e.g. ENG-42) or UUID'),
      confirm: z.boolean().default(true).describe('Must be true to execute'),
    },
    async ({ ticketId, issueId, confirm }) => {
      if (!confirm) return textResult({ message: 'Set confirm=true to link issue' });
      try {
        const linkStore = await import('@/lib/integrations/link-store.js');
        const { LinearClient } = await import('@/lib/integrations/linear-client.js');
        const { linkExistingIssue } = await import('@/lib/integrations/engineering-sync.js');

        const creds = linkStore.getCredentials('default', 'linear');
        if (!creds) return errorResult('Linear not configured.');

        const c = creds.credentials as Record<string, string>;
        const client = { provider: 'linear' as const, linear: new LinearClient({ apiKey: c.apiKey }) };
        const link = await linkExistingIssue(client, { workspaceId: 'default', ticketId, issueKey: issueId });
        return textResult({ linked: (link.metadata as Record<string, string>).identifier, url: link.externalUrl, status: link.externalStatus, title: link.externalTitle });
      } catch (err) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'linear_sync',
    'Trigger sync of all linked Linear issues (pull status + comments)',
    {
      ticketId: z.string().optional().describe('Optional: scope sync to a single ticket'),
    },
    async ({ ticketId }) => {
      try {
        const linkStore = await import('@/lib/integrations/link-store.js');
        const { LinearClient } = await import('@/lib/integrations/linear-client.js');
        const { syncWorkspaceLinks, syncTicketLinks } = await import('@/lib/integrations/engineering-sync.js');

        const creds = linkStore.getCredentials('default', 'linear');
        if (!creds) return errorResult('Linear not configured.');

        const c = creds.credentials as Record<string, string>;
        const client = { provider: 'linear' as const, linear: new LinearClient({ apiKey: c.apiKey }) };
        const result = ticketId
          ? await syncTicketLinks(client, ticketId)
          : await syncWorkspaceLinks(client, 'default');
        return textResult(result);
      } catch (err) {
        return errorResult(`Sync failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'ticket_external_links',
    'List all external engineering links (Jira/Linear) for a ticket',
    {
      ticketId: z.string().describe('CLIaaS ticket ID'),
    },
    async ({ ticketId }) => {
      try {
        const linkStore = await import('@/lib/integrations/link-store.js');
        const links = linkStore.listExternalLinks(ticketId);
        if (!links.length) return textResult({ message: 'No external links found for this ticket' });

        const result = links.map(l => ({
          id: l.id,
          provider: l.provider,
          externalId: l.externalId,
          url: l.externalUrl,
          status: l.externalStatus,
          title: l.externalTitle,
          direction: l.direction,
          syncEnabled: l.syncEnabled,
          lastSynced: l.lastSyncedAt,
        }));
        return textResult({ links: result });
      } catch (err) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );
}
