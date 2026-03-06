import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireScope } from '@/lib/api-auth';
import { rejectEntry } from '@/lib/ai/approval-queue';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireScope(request, 'ai:write');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const result = await rejectEntry(id, auth.user.id);

  if (!result) {
    return NextResponse.json(
      { error: 'Resolution not found or not in pending status' },
      { status: 404 },
    );
  }

  return NextResponse.json({ resolution: result });
}
