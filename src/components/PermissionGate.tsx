'use client';

import { createContext, useContext, type ReactNode } from 'react';

interface PermissionContextValue {
  bitfield: bigint;
  role: string;
}

const PermissionContext = createContext<PermissionContextValue>({ bitfield: BigInt(0), role: 'viewer' });

const BIT_INDEX_MAP: Record<string, number> = {
  'tickets:view': 0, 'tickets:reply_public': 1, 'tickets:reply_internal': 2,
  'tickets:create': 3, 'tickets:update_status': 4, 'tickets:update_priority': 5,
  'tickets:update_assignee': 6, 'tickets:delete': 7, 'tickets:merge': 8,
  'kb:view': 9, 'kb:edit': 10, 'customers:view': 11, 'customers:edit': 12,
  'customers:merge': 13, 'customers:delete': 14, 'analytics:view': 15,
  'analytics:export': 16, 'automation:view': 17, 'automation:edit': 18,
  'admin:users': 19, 'admin:settings': 20, 'admin:billing': 21,
  'admin:api_keys': 22, 'admin:sso': 23, 'admin:roles': 24,
  'channels:view': 25, 'channels:edit': 26, 'qa:view': 27, 'qa:review': 28,
  'forums:view': 29, 'forums:moderate': 30, 'campaigns:view': 31,
  'campaigns:send': 32, 'time:view': 33, 'time:log': 34,
};

function hasPerm(bitfield: bigint, permission: string): boolean {
  const idx = BIT_INDEX_MAP[permission];
  if (idx === undefined) return false;
  return (bitfield & (BigInt(1) << BigInt(idx))) !== BigInt(0);
}

// Minimal role→permission mapping for client-side legacy fallback
const LEGACY_ROLE_PERMS: Record<string, string[]> = {
  owner: Object.keys(BIT_INDEX_MAP),
  admin: Object.keys(BIT_INDEX_MAP).filter(k => k !== 'admin:billing'),
  agent: ['tickets:view', 'tickets:reply_public', 'tickets:reply_internal', 'tickets:create',
    'tickets:update_status', 'tickets:update_priority', 'tickets:update_assignee', 'tickets:merge',
    'kb:view', 'kb:edit', 'customers:view', 'customers:edit', 'customers:merge',
    'analytics:view', 'automation:view', 'channels:view', 'qa:view', 'qa:review',
    'forums:view', 'campaigns:view', 'campaigns:send', 'time:view', 'time:log'],
  light_agent: ['tickets:view', 'tickets:reply_internal', 'kb:view', 'customers:view', 'forums:view'],
  collaborator: ['tickets:view', 'tickets:reply_internal'],
  viewer: ['kb:view', 'analytics:view', 'forums:view'],
};

export function PermissionProvider({
  bitfield,
  role = 'viewer',
  children,
}: {
  bitfield: string;
  role?: string;
  children: ReactNode;
}) {
  let parsed: bigint;
  try {
    parsed = BigInt(bitfield || '0');
  } catch {
    parsed = BigInt(0);
  }
  return (
    <PermissionContext.Provider value={{ bitfield: parsed, role }}>
      {children}
    </PermissionContext.Provider>
  );
}

export function usePermission(permission: string): boolean {
  const { bitfield, role } = useContext(PermissionContext);
  if (bitfield === BigInt(0)) {
    // Legacy mode — fall back to role-based check
    const perms = LEGACY_ROLE_PERMS[role] ?? [];
    return perms.includes(permission);
  }
  return hasPerm(bitfield, permission);
}

export function PermissionGate({
  permission,
  children,
  fallback = null,
}: {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const allowed = usePermission(permission);
  return <>{allowed ? children : fallback}</>;
}
