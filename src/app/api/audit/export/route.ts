import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { exportAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const format = (searchParams.get('format') ?? 'json') as 'json' | 'csv';
    const filters = {
      action: searchParams.get('action') ?? undefined,
      resource: searchParams.get('resource') ?? undefined,
      userId: searchParams.get('userId') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
    };

    const data = exportAudit(format, filters);
    const contentType =
      format === 'csv' ? 'text/csv' : 'application/json';
    const ext = format === 'csv' ? 'csv' : 'json';

    return new NextResponse(data, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="audit-log.${ext}"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to export audit log' },
      { status: 500 }
    );
  }
}
