/** Built-in roles that ship with every workspace. */
export type BuiltinRole =
  | 'owner'
  | 'admin'
  | 'agent'
  | 'light_agent'
  | 'collaborator'
  | 'viewer';

/** A permission record as stored in the DB. */
export interface Permission {
  id: string;
  key: string;
  category: string;
  label: string;
  description: string | null;
  bitIndex: number;
  createdAt: Date;
}

/** A role ↔ permission mapping as stored in the DB. */
export interface RolePermission {
  id: string;
  role: string;
  permissionKey: string;
  workspaceId: string | null; // null = global default
  createdAt: Date;
}

/** Expanded role type used across the RBAC module. */
export type ExpandedRole = BuiltinRole | string; // string for custom roles
