import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { promoteSandbox } from '@/lib/sandbox';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sandbox = promoteSandbox(id);
  if (!sandbox) {
    return NextResponse.json({ error: 'Sandbox not found' }, { status: 404 });
  }
  return NextResponse.json({ sandbox, promoted: true });
}
