/**
 * Bidirectional sync engine for engineering tool integrations (Jira, Linear).
 * Handles: status sync, comment sync, link creation, webhook processing.
 */
import { JiraClient, type JiraIssue, type JiraComment } from './jira-client';
import { LinearClient, type LinearIssue, type LinearComment } from './linear-client';
import { mapToCliaas, mapFromCliaas, type CLIaaSStatus, type StatusMapping } from './status-mapper';
import * as linkStore from './link-store';

// ---- Types ----

export interface SyncResult {
  linksProcessed: number;
  statusUpdates: number;
  commentsSync: number;
  errors: string[];
}

export interface EngineeringProvider {
  provider: 'jira' | 'linear';
  jira?: JiraClient;
  linear?: LinearClient;
}

// ---- Create Issue from Ticket ----

export async function createIssueFromTicket(
  client: EngineeringProvider,
  opts: {
    workspaceId: string;
    ticketId: string;
    ticketSubject: string;
    ticketDescription?: string;
    // Jira-specific
    projectKey?: string;
    issueType?: string;
    // Linear-specific
    teamId?: string;
  },
): Promise<linkStore.ExternalLink> {
  if (client.provider === 'jira' && client.jira) {
    if (!opts.projectKey) throw new Error('projectKey is required for Jira');
    const issue = await client.jira.createIssue({
      projectKey: opts.projectKey,
      issueType: opts.issueType ?? 'Task',
      summary: opts.ticketSubject,
      description: opts.ticketDescription,
      labels: ['cliaas'],
    });
    return linkStore.createExternalLink({
      workspaceId: opts.workspaceId,
      ticketId: opts.ticketId,
      provider: 'jira',
      externalId: issue.key,
      externalUrl: client.jira.browseUrl(issue.key),
      externalStatus: issue.fields.status.name,
      externalTitle: issue.fields.summary,
      direction: 'outbound',
      metadata: { projectKey: issue.fields.project.key, issueType: issue.fields.issuetype.name },
      syncEnabled: true,
    });
  }

  if (client.provider === 'linear' && client.linear) {
    if (!opts.teamId) throw new Error('teamId is required for Linear');
    const issue = await client.linear.createIssue({
      teamId: opts.teamId,
      title: opts.ticketSubject,
      description: opts.ticketDescription,
    });
    return linkStore.createExternalLink({
      workspaceId: opts.workspaceId,
      ticketId: opts.ticketId,
      provider: 'linear',
      externalId: issue.id,
      externalUrl: issue.url,
      externalStatus: issue.state.name,
      externalTitle: issue.title,
      direction: 'outbound',
      metadata: { identifier: issue.identifier, teamKey: issue.team.key },
      syncEnabled: true,
    });
  }

  throw new Error(`Unsupported provider: ${client.provider}`);
}

// ---- Link Existing Issue ----

export async function linkExistingIssue(
  client: EngineeringProvider,
  opts: {
    workspaceId: string;
    ticketId: string;
    issueKey: string; // PROJ-123 for Jira, ENG-42 or UUID for Linear
  },
): Promise<linkStore.ExternalLink> {
  if (client.provider === 'jira' && client.jira) {
    const issue = await client.jira.getIssue(opts.issueKey);
    return linkStore.createExternalLink({
      workspaceId: opts.workspaceId,
      ticketId: opts.ticketId,
      provider: 'jira',
      externalId: issue.key,
      externalUrl: client.jira.browseUrl(issue.key),
      externalStatus: issue.fields.status.name,
      externalTitle: issue.fields.summary,
      direction: 'inbound',
      metadata: { projectKey: issue.fields.project.key, issueType: issue.fields.issuetype.name },
      syncEnabled: true,
    });
  }

  if (client.provider === 'linear' && client.linear) {
    // Try by identifier (ENG-42) first, then by UUID
    let issue: LinearIssue | null = null;
    if (opts.issueKey.includes('-') && !opts.issueKey.includes(' ')) {
      issue = await client.linear.getIssueByIdentifier(opts.issueKey);
    }
    if (!issue) {
      issue = await client.linear.getIssue(opts.issueKey);
    }
    return linkStore.createExternalLink({
      workspaceId: opts.workspaceId,
      ticketId: opts.ticketId,
      provider: 'linear',
      externalId: issue.id,
      externalUrl: issue.url,
      externalStatus: issue.state.name,
      externalTitle: issue.title,
      direction: 'inbound',
      metadata: { identifier: issue.identifier, teamKey: issue.team.key },
      syncEnabled: true,
    });
  }

  throw new Error(`Unsupported provider: ${client.provider}`);
}

// ---- Sync a Single Link ----

export async function syncLink(
  client: EngineeringProvider,
  link: linkStore.ExternalLink,
  customMappings?: StatusMapping[],
): Promise<{ statusChanged: boolean; newStatus?: string; commentsSynced: number }> {
  let statusChanged = false;
  let newStatus: string | undefined;
  let commentsSynced = 0;

  if (client.provider === 'jira' && client.jira) {
    const issue = await client.jira.getIssue(link.externalId);
    const currentStatus = issue.fields.status.name;

    if (currentStatus !== link.externalStatus) {
      linkStore.updateExternalLink(link.id, {
        externalStatus: currentStatus,
        externalTitle: issue.fields.summary,
        lastSyncedAt: new Date().toISOString(),
      });
      statusChanged = true;
      newStatus = currentStatus;
    }

    // Sync comments from Jira → CLIaaS
    const existingComments = linkStore.listLinkComments(link.id);
    const jiraComments = await client.jira.getComments(link.externalId);
    for (const jc of jiraComments) {
      const already = existingComments.find(c => c.externalCommentId === jc.id);
      if (!already) {
        linkStore.createLinkComment({
          linkId: link.id,
          workspaceId: link.workspaceId,
          direction: 'from_external',
          externalCommentId: jc.id,
          body: JiraClient.adfToText(jc.body),
          authorName: jc.author.displayName,
        });
        commentsSynced++;
      }
    }
  }

  if (client.provider === 'linear' && client.linear) {
    const issue = await client.linear.getIssue(link.externalId);
    const currentStatus = issue.state.name;

    if (currentStatus !== link.externalStatus) {
      linkStore.updateExternalLink(link.id, {
        externalStatus: currentStatus,
        externalTitle: issue.title,
        lastSyncedAt: new Date().toISOString(),
      });
      statusChanged = true;
      newStatus = currentStatus;
    }

    // Sync comments from Linear → CLIaaS
    const existingComments = linkStore.listLinkComments(link.id);
    const linearComments = issue.comments?.nodes ?? await client.linear.getComments(link.externalId);
    for (const lc of linearComments) {
      const already = existingComments.find(c => c.externalCommentId === lc.id);
      if (!already) {
        linkStore.createLinkComment({
          linkId: link.id,
          workspaceId: link.workspaceId,
          direction: 'from_external',
          externalCommentId: lc.id,
          body: lc.body,
          authorName: lc.user?.name,
        });
        commentsSynced++;
      }
    }
  }

  return { statusChanged, newStatus, commentsSynced };
}

// ---- Push Comment to External ----

export async function pushComment(
  client: EngineeringProvider,
  link: linkStore.ExternalLink,
  body: string,
  authorName?: string,
): Promise<linkStore.ExternalLinkComment> {
  const prefix = authorName ? `[${authorName}] ` : '';
  const fullBody = `${prefix}${body}`;

  let externalCommentId: string | undefined;

  if (client.provider === 'jira' && client.jira) {
    const comment = await client.jira.addComment(link.externalId, fullBody);
    externalCommentId = comment.id;
  }

  if (client.provider === 'linear' && client.linear) {
    const comment = await client.linear.addComment(link.externalId, fullBody);
    externalCommentId = comment.id;
  }

  return linkStore.createLinkComment({
    linkId: link.id,
    workspaceId: link.workspaceId,
    direction: 'to_external',
    externalCommentId,
    body,
    authorName,
  });
}

// ---- Push Status Change to External ----

export async function pushStatusChange(
  client: EngineeringProvider,
  link: linkStore.ExternalLink,
  cliaasStatus: CLIaaSStatus,
  customMappings?: StatusMapping[],
): Promise<boolean> {
  const targetStatus = mapFromCliaas(link.provider, cliaasStatus, customMappings);
  if (!targetStatus) return false;

  if (client.provider === 'jira' && client.jira) {
    return client.jira.transitionByName(link.externalId, targetStatus);
  }

  if (client.provider === 'linear' && client.linear) {
    const teamKey = (link.metadata as Record<string, string>)?.teamKey;
    if (!teamKey) return false;
    const teams = await client.linear.listTeams();
    const team = teams.find(t => t.key === teamKey);
    if (!team) return false;
    return client.linear.transitionByName(link.externalId, targetStatus, team.id);
  }

  return false;
}

// ---- Sync All Links for a Ticket ----

export async function syncTicketLinks(
  client: EngineeringProvider,
  ticketId: string,
  customMappings?: StatusMapping[],
): Promise<SyncResult> {
  const links = linkStore.listExternalLinks(ticketId).filter(l =>
    l.syncEnabled && l.provider === client.provider,
  );

  const result: SyncResult = { linksProcessed: 0, statusUpdates: 0, commentsSync: 0, errors: [] };

  for (const link of links) {
    try {
      const syncRes = await syncLink(client, link, customMappings);
      result.linksProcessed++;
      if (syncRes.statusChanged) result.statusUpdates++;
      result.commentsSync += syncRes.commentsSynced;
    } catch (err) {
      result.errors.push(`Link ${link.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

// ---- Sync All Links for a Workspace ----

export async function syncWorkspaceLinks(
  client: EngineeringProvider,
  workspaceId: string,
  customMappings?: StatusMapping[],
): Promise<SyncResult> {
  const links = linkStore.listExternalLinks(undefined, workspaceId).filter(l =>
    l.syncEnabled && l.provider === client.provider,
  );

  const result: SyncResult = { linksProcessed: 0, statusUpdates: 0, commentsSync: 0, errors: [] };

  for (const link of links) {
    try {
      const syncRes = await syncLink(client, link, customMappings);
      result.linksProcessed++;
      if (syncRes.statusChanged) result.statusUpdates++;
      result.commentsSync += syncRes.commentsSynced;
    } catch (err) {
      result.errors.push(`Link ${link.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

// ---- Process Inbound Webhook (Jira) ----

export function processJiraWebhook(payload: Record<string, unknown>): {
  issueKey?: string;
  eventType: string;
  statusName?: string;
  commentId?: string;
  commentBody?: string;
  commentAuthor?: string;
} {
  const webhookEvent = payload.webhookEvent as string ?? '';
  const issue = payload.issue as Record<string, unknown> | undefined;
  const comment = payload.comment as Record<string, unknown> | undefined;

  const issueKey = (issue?.key as string) ?? undefined;
  const fields = issue?.fields as Record<string, unknown> | undefined;

  if (webhookEvent.includes('issue_updated')) {
    const statusName = (fields?.status as Record<string, string>)?.name;
    return { issueKey, eventType: 'issue_updated', statusName };
  }

  if (webhookEvent.includes('comment_created') && comment) {
    return {
      issueKey,
      eventType: 'comment_created',
      commentId: comment.id as string,
      commentBody: JiraClient.adfToText(comment.body),
      commentAuthor: (comment.author as Record<string, string>)?.displayName,
    };
  }

  return { issueKey, eventType: webhookEvent };
}

// ---- Process Inbound Webhook (Linear) ----

export function processLinearWebhook(payload: Record<string, unknown>): {
  issueId?: string;
  eventType: string;
  statusName?: string;
  commentId?: string;
  commentBody?: string;
  commentAuthor?: string;
} {
  const type = payload.type as string ?? '';
  const action = payload.action as string ?? '';
  const data = payload.data as Record<string, unknown> | undefined;

  if (type === 'Issue' && action === 'update') {
    const state = data?.state as Record<string, string> | undefined;
    return {
      issueId: data?.id as string,
      eventType: 'issue_updated',
      statusName: state?.name,
    };
  }

  if (type === 'Comment' && action === 'create') {
    const issue = data?.issue as Record<string, string> | undefined;
    const user = data?.user as Record<string, string> | undefined;
    return {
      issueId: issue?.id,
      eventType: 'comment_created',
      commentId: data?.id as string,
      commentBody: data?.body as string,
      commentAuthor: user?.name,
    };
  }

  return { issueId: data?.id as string, eventType: `${type}:${action}` };
}
