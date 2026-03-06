import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { queryAudit } from '@/lib/audit';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = request.nextUrl;
    const filters = {
      action: searchParams.get('action') ?? undefined,
      resource: searchParams.get('resource') ?? undefined,
      userId: searchParams.get('userId') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      limit: searchParams.get('limit')
        ? parseInt(searchParams.get('limit')!, 10)
        : undefined,
      offset: searchParams.get('offset')
        ? parseInt(searchParams.get('offset')!, 10)
        : undefined,
      // Scope by workspace to prevent cross-workspace data leakage
      workspaceId: auth.user.workspaceId,
    };

    const result = await queryAudit(filters);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to query audit log' },
      { status: 500 }
    );
  }
}
