import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { exportUserData } from '@/lib/compliance';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    const data = await exportUserData(userId);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to export user data' },
      { status: 500 }
    );
  }
}
