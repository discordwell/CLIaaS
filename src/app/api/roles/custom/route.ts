import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac/check';
import { requireAuth } from '@/lib/api-auth';
import { isRbacEnabled } from '@/lib/rbac/feature-flag';
import { BUILTIN_ROLE_MATRIX } from '@/lib/rbac/constants';
import { parseJsonBody } from '@/lib/parse-json-body';
import type { BuiltinRole } from '@/lib/rbac/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/roles/custom — List custom roles in the workspace.
 */
export async function GET(request: Request) {
  const auth = isRbacEnabled()
    ? await requirePermission(request, 'admin:roles')
    : await requireAuth(request);
  if ('error' in auth) return auth.error;

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ customRoles: [] });
  }

  try {
    const { db } = await import('@/db');
    const { customRoles } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');

    const rows = await db
      .select()
      .from(customRoles)
      .where(eq(customRoles.workspaceId, auth.user.workspaceId));

    return NextResponse.json({ customRoles: rows });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}

/**
 * POST /api/roles/custom — Create a custom role.
 */
export async function POST(request: Request) {
  const auth = isRbacEnabled()
    ? await requirePermission(request, 'admin:roles')
    : await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  const { name, description, baseRole } = parsed.data;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }
  if (!baseRole || !BUILTIN_ROLE_MATRIX[baseRole as BuiltinRole]) {
    return NextResponse.json({ error: 'Invalid baseRole' }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database required for custom roles' }, { status: 503 });
  }

  try {
    const { db } = await import('@/db');
    const { customRoles } = await import('@/db/schema');

    const [created] = await db
      .insert(customRoles)
      .values({
        workspaceId: auth.user.workspaceId,
        name: name.trim(),
        description: description || null,
        baseRole,
      })
      .returning();

    return NextResponse.json({ customRole: created }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json({ error: 'A custom role with that name already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
