import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireScope } from '@/lib/api-auth';
import { listResolutions } from '@/lib/ai/store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireScope(request, 'ai:read');
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? undefined;
  const ticketId = searchParams.get('ticketId') ?? undefined;
  const limit = parseInt(searchParams.get('limit') ?? '50', 10);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);

  const { records, total } = await listResolutions({
    workspaceId: auth.user.workspaceId,
    status,
    ticketId,
    limit: Math.min(limit, 200),
    offset,
  });

  return NextResponse.json({ resolutions: records, total, limit, offset });
}
