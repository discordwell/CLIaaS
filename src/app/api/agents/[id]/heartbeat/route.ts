import { NextRequest, NextResponse } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { availability } from '@/lib/routing/availability';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'admin:users', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  // Prevent IDOR: agents can only heartbeat themselves
  if (auth.user.id !== id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  availability.heartbeat(id);

  return NextResponse.json({ ok: true });
}
