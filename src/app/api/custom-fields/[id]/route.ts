import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { updateField, deleteField } from '@/lib/custom-fields';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;
  const field = updateField(id, body);
  if (!field) {
    return NextResponse.json({ error: 'Field not found' }, { status: 404 });
  }
  return NextResponse.json({ field });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const deleted = deleteField(id);
  if (!deleted) {
    return NextResponse.json({ error: 'Field not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
