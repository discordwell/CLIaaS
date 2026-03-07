import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/** Returns the SCIM bearer token to authenticated admins only. */
export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const token = process.env.SCIM_BEARER_TOKEN ?? '';
  return NextResponse.json({ token: token || null });
}
