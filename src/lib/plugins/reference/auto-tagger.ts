/**
 * Auto-Tagger reference plugin.
 * Demonstrates keyword-based tag assignment, conditional logic,
 * and ticket-write permissions.
 */

import type { PluginHookContext, PluginHandlerResult } from '../types';

export const manifest = {
  id: 'auto-tagger',
  name: 'Auto-Tagger',
  version: '1.0.0',
  description: 'Automatically tags tickets based on keywords in the subject and body. Supports custom keyword-to-tag mappings and priority-based tagging.',
  author: 'CLIaaS',
  hooks: [
    'ticket.created',
    'ticket.updated',
    'message.created',
  ] as const,
  permissions: ['tickets:read' as const, 'tickets:write' as const],
  actions: [
    {
      id: 're-tag',
      name: 'Re-Tag Ticket',
      description: 'Re-evaluate and update tags for the current ticket',
    },
  ],
  uiSlots: [],
  oauthRequirements: [],
  configSchema: {
    type: 'object',
    properties: {
      keywordMappings: {
        type: 'object',
        description: 'Map of keyword patterns (regex) to tag names. Example: { "billing|invoice|payment": "billing", "bug|error|crash": "bug-report" }',
        default: {
          'billing|invoice|payment|refund': 'billing',
          'bug|error|crash|broken': 'bug-report',
          'feature|request|suggestion|enhancement': 'feature-request',
          'urgent|asap|emergency|critical': 'urgent',
          'cancel|unsubscribe|close account': 'churn-risk',
        },
      },
      tagOnCreate: {
        type: 'boolean',
        description: 'Apply tags when a ticket is first created',
        default: true,
      },
      tagOnUpdate: {
        type: 'boolean',
        description: 'Re-evaluate tags when a ticket is updated',
        default: false,
      },
      tagOnMessage: {
        type: 'boolean',
        description: 'Evaluate tags when a new message is added',
        default: true,
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Use case-sensitive keyword matching',
        default: false,
      },
    },
  },
  runtime: 'node' as const,
  category: 'Automation',
  icon: 'tag',
};

/**
 * Default keyword-to-tag mappings used when none are configured.
 */
const DEFAULT_MAPPINGS: Record<string, string> = {
  'billing|invoice|payment|refund': 'billing',
  'bug|error|crash|broken': 'bug-report',
  'feature|request|suggestion|enhancement': 'feature-request',
  'urgent|asap|emergency|critical': 'urgent',
  'cancel|unsubscribe|close account': 'churn-risk',
};

export async function handle(context: PluginHookContext): Promise<PluginHandlerResult> {
  const { event, data, config } = context;
  const cfg = config ?? {};

  // Check per-event toggles
  if (event === 'ticket.created' && cfg.tagOnCreate === false) {
    return { ok: true, data: { skipped: true, reason: 'tagOnCreate disabled' } };
  }
  if (event === 'ticket.updated' && cfg.tagOnUpdate === false) {
    return { ok: true, data: { skipped: true, reason: 'tagOnUpdate disabled' } };
  }
  if (event === 'message.created' && cfg.tagOnMessage === false) {
    return { ok: true, data: { skipped: true, reason: 'tagOnMessage disabled' } };
  }

  // Build text to scan
  const subject = (data.subject as string) || '';
  const body = (data.body as string) || (data.messageBody as string) || '';
  const text = `${subject} ${body}`;

  // Get keyword mappings
  const mappings = (cfg.keywordMappings as Record<string, string>) || DEFAULT_MAPPINGS;
  const flags = cfg.caseSensitive ? '' : 'i';

  // Evaluate each keyword pattern
  const matchedTags: string[] = [];
  const matchDetails: Array<{ pattern: string; tag: string }> = [];

  for (const [pattern, tag] of Object.entries(mappings)) {
    try {
      const regex = new RegExp(pattern, flags);
      if (regex.test(text)) {
        matchedTags.push(tag);
        matchDetails.push({ pattern, tag });
      }
    } catch {
      // Skip invalid regex patterns
    }
  }

  if (matchedTags.length === 0) {
    return {
      ok: true,
      data: {
        tagsAdded: [],
        message: 'No keyword matches found',
      },
    };
  }

  // In production: use the SDK to add tags to the ticket
  // await cliaas.tickets.addTags(data.ticketId, matchedTags);

  return {
    ok: true,
    data: {
      tagsAdded: matchedTags,
      matchDetails,
      message: `Added ${matchedTags.length} tag(s): ${matchedTags.join(', ')}`,
      ticketId: data.ticketId || data.id,
    },
  };
}
