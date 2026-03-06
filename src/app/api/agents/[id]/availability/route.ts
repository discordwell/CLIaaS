import { NextRequest, NextResponse } from 'next/server';
import { availability } from '@/lib/routing/availability';
import { requirePerm } from '@/lib/rbac';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePerm(request, 'admin:users', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const VALID_STATUSES = ['online', 'away', 'offline'] as const;
  const status = (body.status as string) ?? 'online';
  if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
    return NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
  }
  const userName = (body.userName as string) ?? id;
  availability.setAvailability(id, userName, status as 'online' | 'away' | 'offline');
  return NextResponse.json({ userId: id, status });
}
