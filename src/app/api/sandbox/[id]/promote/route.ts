import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { promoteSandbox } from '@/lib/sandbox';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { selectedEntryIds } = body as { selectedEntryIds?: string[] };

  const result = promoteSandbox(id, selectedEntryIds);
  if (!result) {
    return NextResponse.json({ error: 'Sandbox not found' }, { status: 404 });
  }

  return NextResponse.json({
    sandbox: result.sandbox,
    promoted: true,
    applied: result.applied,
    errors: result.errors,
  });
}
