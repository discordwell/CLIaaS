import { NextRequest, NextResponse } from 'next/server';
import { removeGroupMember } from '@/lib/routing/store';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await params;
  const removed = removeGroupMember(id, userId);
  if (!removed) return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
