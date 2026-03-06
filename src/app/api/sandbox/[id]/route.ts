import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSandbox, deleteSandbox } from '@/lib/sandbox';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const sandbox = getSandbox(id);
  if (!sandbox) {
    return NextResponse.json({ error: 'Sandbox not found' }, { status: 404 });
  }
  return NextResponse.json({ sandbox });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const deleted = deleteSandbox(id);
  if (!deleted) {
    return NextResponse.json({ error: 'Sandbox not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
