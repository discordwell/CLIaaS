import { NextResponse } from 'next/server';
import { generateAccessReview } from '@/lib/security/access-review';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const report = generateAccessReview();
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate access review' },
      { status: 500 },
    );
  }
}
