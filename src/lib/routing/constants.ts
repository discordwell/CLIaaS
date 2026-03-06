/**
 * Constants for routing condition builder UI.
 */

export const ROUTING_CONDITION_FIELDS = [
  'status',
  'priority',
  'assignee',
  'requester',
  'subject',
  'tags',
  'source',
  'channel',
  'group',
] as const;

export const ROUTING_CONDITION_OPERATORS = [
  'is',
  'is_not',
  'contains',
  'not_contains',
  'in',
  'is_empty',
  'is_not_empty',
] as const;

export const ROUTING_FIELD_VALUE_PRESETS: Record<string, string[]> = {
  status: ['new', 'open', 'pending', 'on_hold', 'solved', 'closed'],
  priority: ['urgent', 'high', 'normal', 'low'],
  source: ['zendesk', 'freshdesk', 'intercom', 'email', 'chat', 'phone', 'api'],
  channel: ['zendesk', 'freshdesk', 'intercom', 'email', 'chat', 'phone', 'api'],
};
