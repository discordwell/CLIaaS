import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { deleteForm } from '@/lib/custom-fields';

export const dynamic = 'force-dynamic';

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Custom forms don't have an update function in the spec,
  // but the route exists for completeness
  const { id } = await params;
  return NextResponse.json({ message: `Form ${id} update not yet implemented` });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const deleted = deleteForm(id);
  if (!deleted) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
