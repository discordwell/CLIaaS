import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { queryAuditLog } from '@/lib/automation/audit-store';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:view');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const { searchParams } = request.nextUrl;
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 500);

  try {
    const entries = await queryAuditLog({
      workspaceId: auth.user.workspaceId,
      ruleId: id,
      limit,
    });

    return NextResponse.json({ executions: entries });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to load executions') },
      { status: 500 },
    );
  }
}
