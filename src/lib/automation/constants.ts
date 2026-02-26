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
