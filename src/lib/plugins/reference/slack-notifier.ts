/**
 * Slack Notifier reference plugin.
 * Demonstrates channel-based routing, conditional notification,
 * and credential usage for the Slack Web API.
 */

import type { PluginHookContext, PluginHandlerResult } from '../types';

export const manifest = {
  id: 'slack-notifier',
  name: 'Slack Notifier',
  version: '1.0.0',
  description: 'Posts rich notifications to Slack channels based on ticket events. Supports multiple channels, priority-based routing, and customizable message templates.',
  author: 'CLIaaS',
  hooks: [
    'ticket.created',
    'ticket.updated',
    'ticket.resolved',
    'ticket.assigned',
    'sla.breached',
  ] as const,
  permissions: ['tickets:read' as const, 'oauth:external' as const],
  actions: [
    {
      id: 'send-notification',
      name: 'Send Slack Notification',
      description: 'Manually post a notification about this ticket to Slack',
    },
    {
      id: 'send-summary',
      name: 'Send Daily Summary',
      description: 'Post a summary of open tickets to the configured channel',
    },
  ],
  uiSlots: [],
  oauthRequirements: [
    {
      provider: 'slack',
      scopes: ['chat:write', 'channels:read'],
    },
  ],
  configSchema: {
    type: 'object',
    properties: {
      defaultChannel: {
        type: 'string',
        description: 'Default Slack channel (e.g. #support-alerts)',
        default: '#support-alerts',
      },
      urgentChannel: {
        type: 'string',
        description: 'Channel for urgent/high priority tickets (e.g. #urgent-support)',
      },
      notifyOnCreate: {
        type: 'boolean',
        description: 'Notify when a ticket is created',
        default: true,
      },
      notifyOnResolve: {
        type: 'boolean',
        description: 'Notify when a ticket is resolved',
        default: true,
      },
      notifyOnAssign: {
        type: 'boolean',
        description: 'Notify when a ticket is assigned',
        default: false,
      },
      notifyOnBreach: {
        type: 'boolean',
        description: 'Notify when SLA is breached',
        default: true,
      },
      includeLink: {
        type: 'boolean',
        description: 'Include a link to the ticket in the notification',
        default: true,
      },
    },
  },
  runtime: 'node' as const,
  category: 'Communication',
  icon: 'slack',
};

export async function handle(context: PluginHookContext): Promise<PluginHandlerResult> {
  const { event, data, config } = context;
  const cfg = config ?? {};

  // Check per-event toggles
  if (event === 'ticket.created' && cfg.notifyOnCreate === false) {
    return { ok: true, data: { skipped: true, reason: 'notifyOnCreate disabled' } };
  }
  if (event === 'ticket.resolved' && cfg.notifyOnResolve === false) {
    return { ok: true, data: { skipped: true, reason: 'notifyOnResolve disabled' } };
  }
  if (event === 'ticket.assigned' && cfg.notifyOnAssign === false) {
    return { ok: true, data: { skipped: true, reason: 'notifyOnAssign disabled' } };
  }
  if (event === 'sla.breached' && cfg.notifyOnBreach === false) {
    return { ok: true, data: { skipped: true, reason: 'notifyOnBreach disabled' } };
  }

  // Route to urgent channel if priority is high/urgent
  const priority = (data.priority as string) || 'normal';
  const isUrgent = priority === 'urgent' || priority === 'high';
  const channel = isUrgent && cfg.urgentChannel
    ? (cfg.urgentChannel as string)
    : (cfg.defaultChannel as string) || '#support-alerts';

  const subject = (data.subject as string) || (data.ticketId as string) || 'Unknown ticket';
  const assignee = (data.assignee as string) || 'Unassigned';

  // Build emoji based on event type
  const emoji = event === 'sla.breached' ? ':rotating_light:'
    : event === 'ticket.created' ? ':ticket:'
    : event === 'ticket.resolved' ? ':white_check_mark:'
    : event === 'ticket.assigned' ? ':bust_in_silhouette:'
    : ':bell:';

  // In production: POST to Slack Web API with credentials from encrypted store
  return {
    ok: true,
    data: {
      channel,
      emoji,
      message: `${emoji} [${event}] ${subject}`,
      priority,
      assignee,
      event,
      includeLink: cfg.includeLink !== false,
    },
  };
}
