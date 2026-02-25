import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { inviteUser, sanitizeUser } from '@/lib/user-service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const { email, name, role } = body;

    if (!email || !name) {
      return NextResponse.json(
        { error: 'Email and name are required' },
        { status: 400 },
      );
    }

    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email address' },
        { status: 400 },
      );
    }

    const user = await inviteUser(
      auth.user.workspaceId,
      { email, name, role },
      auth.user.tenantId,
    );
    return NextResponse.json({ user: sanitizeUser(user) }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invite failed';
    const status = message.includes('already exists') ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
