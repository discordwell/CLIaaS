/**
 * Permission resolution — resolves a user's effective permissions
 * from their built-in role and optional custom role overrides.
 *
 * In demo/JSONL mode (no DATABASE_URL), uses the hardcoded BUILTIN_ROLE_MATRIX.
 * In DB mode, reads from role_permissions table (with workspace-level overrides).
 */

import { BUILTIN_ROLE_MATRIX } from './constants';
import { encodeBitfield } from './bitfield';
import type { BuiltinRole } from './types';

/**
 * Resolve effective permission keys for a user based on their role.
 * In the future, this will also consider custom_role_id and workspace overrides.
 */
export async function resolveUserPermissions(
  role: string,
  _workspaceId?: string,
  _customRoleId?: string | null,
): Promise<string[]> {
  // Fast path: use hardcoded matrix when no DB or for built-in roles
  if (!process.env.DATABASE_URL) {
    return getBuiltinPermissions(role);
  }

  // DB path: query role_permissions table
  try {
    const { db } = await import('@/db');
    const { rolePermissions } = await import('@/db/schema');
    const { eq, isNull, or, and } = await import('drizzle-orm');

    // Get global defaults for this role
    const rows = await db
      .select({ permissionKey: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(
        and(
          eq(rolePermissions.role, role),
          or(
            isNull(rolePermissions.workspaceId),
            _workspaceId ? eq(rolePermissions.workspaceId, _workspaceId) : isNull(rolePermissions.workspaceId),
          ),
        ),
      );

    if (rows.length === 0) {
      // Fall back to hardcoded matrix if DB has no data (e.g. seed hasn't run)
      return getBuiltinPermissions(role);
    }

    let permissionKeys = [...new Set(rows.map(r => r.permissionKey))];

    // If user has a custom role, apply grants/denies on top
    if (_customRoleId) {
      permissionKeys = await applyCustomRoleOverrides(permissionKeys, _customRoleId);
    }

    return permissionKeys;
  } catch (err) {
    // DB error — fall back to hardcoded matrix, but log the error
    console.error('[rbac] DB query failed, falling back to hardcoded matrix:', err instanceof Error ? err.message : err);
    return getBuiltinPermissions(role);
  }
}

/**
 * Get the BigInt bitfield for a user's resolved permissions.
 */
export async function getUserBitfield(
  role: string,
  workspaceId?: string,
  customRoleId?: string | null,
): Promise<bigint> {
  const keys = await resolveUserPermissions(role, workspaceId, customRoleId);
  return encodeBitfield(keys);
}

/**
 * Resolve a user's permissions from their role and check a single permission.
 * Used as fallback when the JWT has no bitfield claim.
 */
export async function resolveAndCheck(role: string, permission: string): Promise<boolean> {
  const keys = await resolveUserPermissions(role);
  return keys.includes(permission);
}

/**
 * Resolve a user's permissions and check if ANY of the given permissions are present.
 */
export async function resolveAndCheckAny(role: string, permissions: string[]): Promise<boolean> {
  const keys = await resolveUserPermissions(role);
  return permissions.some(p => keys.includes(p));
}

/** Look up built-in role permissions from the hardcoded matrix. */
function getBuiltinPermissions(role: string): string[] {
  const perms = BUILTIN_ROLE_MATRIX[role as BuiltinRole];
  return perms ? [...perms] : [];
}

/**
 * Apply custom role overrides (grants/denies) on top of base permissions.
 * Custom roles can grant additional permissions or revoke base ones.
 */
async function applyCustomRoleOverrides(
  basePermissions: string[],
  customRoleId: string,
): Promise<string[]> {
  try {
    const { db } = await import('@/db');
    const { customRolePermissions } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');

    const overrides = await db
      .select({
        permissionKey: customRolePermissions.permissionKey,
        granted: customRolePermissions.granted,
      })
      .from(customRolePermissions)
      .where(eq(customRolePermissions.customRoleId, customRoleId));

    const permSet = new Set(basePermissions);
    for (const { permissionKey, granted } of overrides) {
      if (granted) {
        permSet.add(permissionKey);
      } else {
        permSet.delete(permissionKey);
      }
    }
    return [...permSet];
  } catch {
    // custom_role_permissions table doesn't exist yet (Phase 6)
    return basePermissions;
  }
}
