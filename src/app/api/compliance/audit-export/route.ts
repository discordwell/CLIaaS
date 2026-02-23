import { NextResponse } from 'next/server';
import { generateAuditReport } from '@/lib/compliance/audit-report';

export const dynamic = 'force-dynamic';

export async function GET() {
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
