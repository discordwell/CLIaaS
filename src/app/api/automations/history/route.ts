import { NextResponse } from 'next/server';
import { getAuditLog } from '@/lib/automation/executor';

export const dynamic = 'force-dynamic';

export async function GET() {
  const entries = getAuditLog();
  return NextResponse.json({ entries, total: entries.length });
}
