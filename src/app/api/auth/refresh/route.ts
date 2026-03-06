import { NextResponse } from 'next/server';
import { getSession, createToken, setSessionCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Re-issues the current user's JWT with updated permissions bitfield.
 * Call this after a role change or custom role edit to pick up new permissions.
 */
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  // createToken auto-computes the bitfield when RBAC is enabled
  const token = await createToken({
    id: session.id,
    email: session.email,
    name: session.name,
    role: session.role,
    workspaceId: session.workspaceId,
    tenantId: session.tenantId,
    // Omit `p` so createToken re-computes it from DB
  });

  await setSessionCookie(token);

  return NextResponse.json({ refreshed: true });
}
