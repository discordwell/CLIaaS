import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { getResolution } from '@/lib/ai/store';
import { approveEntry } from '@/lib/ai/approval-queue';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  // Verify workspace ownership before mutating
  const resolution = await getResolution(id);
  if (!resolution || resolution.workspaceId !== auth.user.workspaceId) {
    return NextResponse.json(
      { error: 'Resolution not found or not in pending status' },
      { status: 404 },
    );
  }

  const result = await approveEntry(id, auth.user.id);

  if (!result) {
    return NextResponse.json(
      { error: 'Resolution not found or not in pending status' },
      { status: 404 },
    );
  }

  return NextResponse.json({ resolution: result });
}
