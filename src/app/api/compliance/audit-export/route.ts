import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { generateAuditReport } from '@/lib/compliance/audit-report';
import { requireRole } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const report = await generateAuditReport();
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Audit export failed' },
      { status: 500 },
    );
  }
}
