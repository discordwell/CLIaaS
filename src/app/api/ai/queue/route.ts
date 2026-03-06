import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { listResolutions } from '@/lib/ai/store';

export const dynamic = 'force-dynamic';

/** @deprecated Use /api/ai/resolutions instead */
export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'automation:view');
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');

  const { records, total } = await listResolutions({
    workspaceId: auth.user.workspaceId,
    status: status && status !== 'all' ? status : undefined,
    limit: 50,
  });

  return NextResponse.json({ entries: records, total });
}
