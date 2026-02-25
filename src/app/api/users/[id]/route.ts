import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { updateUser, removeUser, sanitizeUser } from '@/lib/user-service';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  if (id === auth.user.id) {
    return NextResponse.json(
      { error: 'Use /api/auth/me to update your own profile' },
      { status: 400 },
    );
  }

  try {
    const body = await request.json();
    const updated = await updateUser(id, auth.user.workspaceId, body, auth.user.role);
    return NextResponse.json({ user: sanitizeUser(updated) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Update failed';
    const status = message.includes('not found') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  try {
    await removeUser(id, auth.user.workspaceId, auth.user.id);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Remove failed';
    const status = message.includes('not found') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
