import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSandbox, deleteSandbox } from '@/lib/sandbox';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sandbox = getSandbox(id);
  if (!sandbox) {
    return NextResponse.json({ error: 'Sandbox not found' }, { status: 404 });
  }
  return NextResponse.json({ sandbox });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const deleted = deleteSandbox(id);
  if (!deleted) {
    return NextResponse.json({ error: 'Sandbox not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
