import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { querySecureAudit } from '@/lib/security/audit-log';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const filters = {
      action: searchParams.get('action') ?? undefined,
      resource: searchParams.get('resource') ?? undefined,
      actorId: searchParams.get('actorId') ?? undefined,
      outcome: searchParams.get('outcome') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      limit: searchParams.get('limit')
        ? parseInt(searchParams.get('limit')!, 10)
        : undefined,
      offset: searchParams.get('offset')
        ? parseInt(searchParams.get('offset')!, 10)
        : undefined,
    };

    const result = querySecureAudit(filters);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to query secure audit log' },
      { status: 500 },
    );
  }
}
