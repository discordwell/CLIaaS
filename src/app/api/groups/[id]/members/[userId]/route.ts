import { NextRequest, NextResponse } from 'next/server';
import { removeGroupMember } from '@/lib/routing/store';
import { requireRole } from '@/lib/api-auth';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const { id, userId } = await params;
  const removed = removeGroupMember(id, userId);
  if (!removed) return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
