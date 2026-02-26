/**
 * Canonical lists of fields, operators, action types, and events
 * used by the automation engine. Shared across all UI pages
 * (rules, workflows, chatbots) to keep vocabulary consistent.
 */

export const CONDITION_FIELDS = [
  'status',
  'priority',
  'assignee',
  'requester',
  'subject',
  'tags',
  'source',
  'event',
  'hours_since_created',
  'hours_since_updated',
  'message_body',
] as const;

export const CONDITION_OPERATORS = [
  'is',
  'is_not',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'greater_than',
  'less_than',
  'is_empty',
  'is_not_empty',
  'changed',
  'changed_to',
  'in',
  'matches',
] as const;

export const ACTION_TYPES = [
  'set_status',
  'set_priority',
  'set_assignee',
  'assign_to',
  'unassign',
  'add_tag',
  'remove_tag',
  'set_field',
  'add_internal_note',
  'send_notification',
  'webhook',
  'close',
  'reopen',
  'escalate',
] as const;

export const TICKET_EVENTS = [
  'create',
  'update',
  'reply',
  'status_change',
  'assignment',
] as const;

/** Smart defaults: preset values for condition fields. */
export const FIELD_VALUE_PRESETS: Record<string, string[]> = {
  status: ['open', 'pending', 'on_hold', 'solved', 'closed'],
  priority: ['low', 'normal', 'high', 'urgent'],
  source: ['email', 'web', 'zendesk', 'freshdesk', 'intercom'],
};

/** Smart defaults: preset values for action types. */
export const ACTION_VALUE_PRESETS: Record<string, string[]> = {
  set_status: ['open', 'pending', 'on_hold', 'solved', 'closed'],
  set_priority: ['low', 'normal', 'high', 'urgent'],
};

/** Human-readable descriptions for condition operators. */
export const OPERATOR_DESCRIPTIONS: Record<string, string> = {
  is: 'Exact match',
  is_not: 'Does not match',
  contains: 'Field contains substring',
  not_contains: 'Field does not contain substring',
  starts_with: 'Field starts with value',
  ends_with: 'Field ends with value',
  greater_than: 'Numeric: greater than',
  less_than: 'Numeric: less than',
  is_empty: 'Field has no value',
  is_not_empty: 'Field has a value',
  changed: 'Field was modified',
  changed_to: 'Field was changed to value',
  in: 'Value is in list',
  matches: 'Regex pattern match',
};
