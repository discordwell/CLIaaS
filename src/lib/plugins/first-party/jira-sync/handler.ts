/**
 * Jira Sync plugin handler.
 * In production, this would use the Jira REST API.
 */

import type { PluginHookContext, PluginHandlerResult } from '../../types';

export async function handle(context: PluginHookContext): Promise<PluginHandlerResult> {
  const { event, data, config } = context;
  const cfg = config ?? {};

  if (event === 'ticket.created' && cfg.autoCreate) {
    const projectKey = (cfg.projectKey as string) || 'SUP';
    const issueType = (cfg.issueType as string) || 'Task';
    const subject = (data.subject as string) || 'Support ticket';

    // In production: POST to Jira API
    return {
      ok: true,
      data: {
        action: 'create_issue',
        projectKey,
        issueType,
        summary: subject,
      },
    };
  }

  if (event === 'ticket.resolved' && cfg.syncStatus !== false) {
    return {
      ok: true,
      data: {
        action: 'transition_issue',
        transition: 'Done',
      },
    };
  }

  if (event === 'ticket.updated') {
    return {
      ok: true,
      data: {
        action: 'sync_update',
        ticketId: data.ticketId,
      },
    };
  }

  return { ok: true };
}
