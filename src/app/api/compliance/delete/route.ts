import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { deleteUserData } from '@/lib/compliance';
import { requireRole } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    const result = await deleteUserData(userId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete user data' },
      { status: 500 }
    );
  }
}
