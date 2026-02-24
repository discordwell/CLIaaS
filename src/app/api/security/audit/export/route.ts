import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { exportSecureAudit } from '@/lib/security/audit-log';
import { requireRole } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = request.nextUrl;
    const format = (searchParams.get('format') === 'csv' ? 'csv' : 'json') as 'json' | 'csv';
    const filters = {
      action: searchParams.get('action') ?? undefined,
      resource: searchParams.get('resource') ?? undefined,
      actorId: searchParams.get('actorId') ?? undefined,
      outcome: searchParams.get('outcome') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
    };

    const data = exportSecureAudit(format, filters);
    const contentType = format === 'csv' ? 'text/csv' : 'application/json';
    const ext = format === 'csv' ? 'csv' : 'json';

    return new NextResponse(data, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="secure-audit-log.${ext}"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to export secure audit log' },
      { status: 500 },
    );
  }
}
