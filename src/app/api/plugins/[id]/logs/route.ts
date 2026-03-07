import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { getExecutionLogs } from '@/lib/plugins/execution-log';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') ?? '50', 10);
  const since = searchParams.get('since') ?? undefined;

  try {
    const logs = await getExecutionLogs(id, { limit, since });
    return NextResponse.json({ logs });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to get logs') },
      { status: 500 }
    );
  }
}
