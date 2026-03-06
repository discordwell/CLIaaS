import { NextResponse } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { PERMISSION_KEYS, PERMISSION_LABELS, PERMISSION_CATEGORIES, BIT_INDEX_MAP } from '@/lib/rbac/constants';

export const dynamic = 'force-dynamic';

/**
 * GET /api/permissions — List all 35 permissions (catalog).
 * Any authenticated user can view the catalog.
 */
export async function GET(request: Request) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  const permissions = PERMISSION_KEYS.map(key => ({
    key,
    label: PERMISSION_LABELS[key] ?? key,
    category: PERMISSION_CATEGORIES[key] ?? 'other',
    bitIndex: BIT_INDEX_MAP[key],
  }));

  return NextResponse.json({ permissions });
}
