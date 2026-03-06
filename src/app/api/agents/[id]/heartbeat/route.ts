import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { availability } from '@/lib/routing/availability';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;

  // Prevent IDOR: agents can only heartbeat themselves
  if (auth.user.id !== id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  availability.heartbeat(id);

  return NextResponse.json({ ok: true });
}
