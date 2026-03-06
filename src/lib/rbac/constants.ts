import type { BuiltinRole } from './types';

/**
 * All 35 permission keys with stable bit-index assignments.
 * NEVER reorder — bit indices are baked into JWTs.
 */
export const PERMISSION_KEYS = [
  'tickets:view',            // 0
  'tickets:reply_public',    // 1
  'tickets:reply_internal',  // 2
  'tickets:create',          // 3
  'tickets:update_status',   // 4
  'tickets:update_priority', // 5
  'tickets:update_assignee', // 6
  'tickets:delete',          // 7
  'tickets:merge',           // 8
  'kb:view',                 // 9
  'kb:edit',                 // 10
  'customers:view',          // 11
  'customers:edit',          // 12
  'customers:merge',         // 13
  'customers:delete',        // 14
  'analytics:view',          // 15
  'analytics:export',        // 16
  'automation:view',         // 17
  'automation:edit',         // 18
  'admin:users',             // 19
  'admin:settings',          // 20
  'admin:billing',           // 21
  'admin:api_keys',          // 22
  'admin:sso',               // 23
  'admin:roles',             // 24
  'channels:view',           // 25
  'channels:edit',           // 26
  'qa:view',                 // 27
  'qa:review',               // 28
  'forums:view',             // 29
  'forums:moderate',         // 30
  'campaigns:view',          // 31
  'campaigns:send',          // 32
  'time:view',               // 33
  'time:log',                // 34
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/** Maps permission key → bit index. */
export const BIT_INDEX_MAP: Record<string, number> = Object.fromEntries(
  PERMISSION_KEYS.map((key, i) => [key, i]),
);

/** Human-readable category for each permission. */
export const PERMISSION_CATEGORIES: Record<string, string> = {
  'tickets:view': 'tickets',
  'tickets:reply_public': 'tickets',
  'tickets:reply_internal': 'tickets',
  'tickets:create': 'tickets',
  'tickets:update_status': 'tickets',
  'tickets:update_priority': 'tickets',
  'tickets:update_assignee': 'tickets',
  'tickets:delete': 'tickets',
  'tickets:merge': 'tickets',
  'kb:view': 'kb',
  'kb:edit': 'kb',
  'customers:view': 'customers',
  'customers:edit': 'customers',
  'customers:merge': 'customers',
  'customers:delete': 'customers',
  'analytics:view': 'analytics',
  'analytics:export': 'analytics',
  'automation:view': 'automation',
  'automation:edit': 'automation',
  'admin:users': 'admin',
  'admin:settings': 'admin',
  'admin:billing': 'admin',
  'admin:api_keys': 'admin',
  'admin:sso': 'admin',
  'admin:roles': 'admin',
  'channels:view': 'channels',
  'channels:edit': 'channels',
  'qa:view': 'qa',
  'qa:review': 'qa',
  'forums:view': 'forums',
  'forums:moderate': 'forums',
  'campaigns:view': 'campaigns',
  'campaigns:send': 'campaigns',
  'time:view': 'time',
  'time:log': 'time',
};

/** Human-readable labels for each permission. */
export const PERMISSION_LABELS: Record<string, string> = {
  'tickets:view': 'View tickets',
  'tickets:reply_public': 'Send public replies',
  'tickets:reply_internal': 'Add internal notes',
  'tickets:create': 'Create tickets',
  'tickets:update_status': 'Update ticket status',
  'tickets:update_priority': 'Update ticket priority',
  'tickets:update_assignee': 'Reassign tickets',
  'tickets:delete': 'Delete tickets',
  'tickets:merge': 'Merge tickets',
  'kb:view': 'View knowledge base',
  'kb:edit': 'Edit KB articles',
  'customers:view': 'View customers',
  'customers:edit': 'Edit customers',
  'customers:merge': 'Merge customers',
  'customers:delete': 'Delete customers',
  'analytics:view': 'View analytics',
  'analytics:export': 'Export analytics',
  'automation:view': 'View automation rules',
  'automation:edit': 'Edit automation rules',
  'admin:users': 'Manage users',
  'admin:settings': 'Manage settings',
  'admin:billing': 'Manage billing',
  'admin:api_keys': 'Manage API keys',
  'admin:sso': 'Manage SSO',
  'admin:roles': 'Manage roles',
  'channels:view': 'View channels',
  'channels:edit': 'Edit channels',
  'qa:view': 'View QA reviews',
  'qa:review': 'Perform QA reviews',
  'forums:view': 'View forums',
  'forums:moderate': 'Moderate forums',
  'campaigns:view': 'View campaigns',
  'campaigns:send': 'Send campaigns',
  'time:view': 'View time entries',
  'time:log': 'Log time',
};

/**
 * Built-in role → permission key matrix.
 * Each role gets the listed permission keys by default.
 */
export const BUILTIN_ROLE_MATRIX: Record<BuiltinRole, readonly string[]> = {
  owner: [...PERMISSION_KEYS],

  admin: PERMISSION_KEYS.filter((k) => k !== 'admin:billing'),

  agent: [
    'tickets:view',
    'tickets:reply_public',
    'tickets:reply_internal',
    'tickets:create',
    'tickets:update_status',
    'tickets:update_priority',
    'tickets:update_assignee',
    'tickets:merge',
    'kb:view',
    'kb:edit',
    'customers:view',
    'customers:edit',
    'customers:merge',
    'analytics:view',
    'automation:view',
    'channels:view',
    'qa:view',
    'qa:review',
    'forums:view',
    'campaigns:view',
    'time:view',
    'time:log',
  ],

  light_agent: [
    'tickets:view',
    'tickets:reply_internal',
    'kb:view',
    'customers:view',
    'forums:view',
  ],

  collaborator: [
    'tickets:view',
    'tickets:reply_internal',
  ],

  viewer: [
    'kb:view',
    'analytics:view',
    'forums:view',
  ],
};
