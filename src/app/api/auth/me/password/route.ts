import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { changePassword } from '@/lib/user-service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'Current password and new password are required' },
        { status: 400 },
      );
    }

    await changePassword(session.id, currentPassword, newPassword);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Password change failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
