import { NextResponse } from 'next/server';
import { getComplianceStatus } from '@/lib/compliance';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await getComplianceStatus();
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get compliance status' },
      { status: 500 }
    );
  }
}
