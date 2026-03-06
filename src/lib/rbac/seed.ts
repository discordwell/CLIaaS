/**
 * Idempotent seed for permissions + role_permissions tables.
 * Called after migration 0014. Safe to run multiple times.
 */

import { db } from '@/db';
import { permissions as permissionsTable, rolePermissions } from '@/db/schema';
import {
  PERMISSION_KEYS,
  BIT_INDEX_MAP,
  PERMISSION_CATEGORIES,
  PERMISSION_LABELS,
  BUILTIN_ROLE_MATRIX,
} from './constants';
import type { BuiltinRole } from './types';

export async function seedPermissions(): Promise<{ permissionsInserted: number; mappingsInserted: number }> {
  let permissionsInserted = 0;
  let mappingsInserted = 0;

  await db.transaction(async (tx) => {
    // 1. Batch seed permissions catalog
    const permValues = PERMISSION_KEYS.map((key) => ({
      key,
      category: PERMISSION_CATEGORIES[key] ?? 'other',
      label: PERMISSION_LABELS[key] ?? key,
      description: null,
      bitIndex: BIT_INDEX_MAP[key],
    }));
    const permResult = await tx
      .insert(permissionsTable)
      .values(permValues)
      .onConflictDoNothing({ target: permissionsTable.key })
      .returning();
    permissionsInserted = permResult.length;

    // 2. Batch seed role-permission mappings (global defaults, workspace_id = null)
    const mappingValues: Array<{ role: string; permissionKey: string; workspaceId: null }> = [];
    const roles = Object.keys(BUILTIN_ROLE_MATRIX) as BuiltinRole[];
    for (const role of roles) {
      for (const permKey of BUILTIN_ROLE_MATRIX[role]) {
        mappingValues.push({ role, permissionKey: permKey, workspaceId: null });
      }
    }
    const mappingResult = await tx
      .insert(rolePermissions)
      .values(mappingValues)
      .onConflictDoNothing()
      .returning();
    mappingsInserted = mappingResult.length;
  });

  return { permissionsInserted, mappingsInserted };
}
