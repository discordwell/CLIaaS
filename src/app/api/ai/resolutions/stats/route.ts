import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { getResolutionStats } from '@/lib/ai/store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'automation:view');
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;

  const stats = await getResolutionStats(
    auth.user.workspaceId,
    from && to ? { from, to } : undefined,
  );

  return NextResponse.json({ stats });
}
