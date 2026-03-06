/**
 * Hello World reference plugin.
 * Demonstrates the simplest possible plugin: logs every event it receives.
 * Use this as a starting point for building your own plugins.
 */

import type { PluginHookContext, PluginHandlerResult } from '../types';

export const manifest = {
  id: 'hello-world',
  name: 'Hello World',
  version: '1.0.0',
  description: 'A minimal reference plugin that logs every event it receives. Use as a starting template for building your own plugins.',
  author: 'CLIaaS',
  hooks: [
    'ticket.created',
    'ticket.updated',
    'ticket.resolved',
    'message.created',
  ] as const,
  permissions: ['tickets:read' as const],
  actions: [
    {
      id: 'greet',
      name: 'Say Hello',
      description: 'Logs a greeting message for the current ticket',
    },
  ],
  uiSlots: [],
  oauthRequirements: [],
  configSchema: {
    type: 'object',
    properties: {
      greeting: {
        type: 'string',
        description: 'Custom greeting message',
        default: 'Hello from CLIaaS!',
      },
    },
  },
  runtime: 'node' as const,
  category: 'Developer Tools',
  icon: 'wand',
};

export async function handle(context: PluginHookContext): Promise<PluginHandlerResult> {
  const { event, data, config } = context;
  const greeting = (config?.greeting as string) || 'Hello from CLIaaS!';
  const ticketId = (data.ticketId as string) || (data.id as string) || 'unknown';

  return {
    ok: true,
    data: {
      message: `${greeting} Event: ${event}, Ticket: ${ticketId}`,
      event,
      ticketId,
      processedAt: new Date().toISOString(),
    },
  };
}
