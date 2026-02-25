import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { listWorkspaceUsers, sanitizeUser } from '@/lib/user-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const rows = await listWorkspaceUsers(auth.user.workspaceId);
    return NextResponse.json({ users: rows.map(sanitizeUser) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
