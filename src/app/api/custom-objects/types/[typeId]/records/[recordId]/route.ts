import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requirePerm } from '@/lib/rbac';
import { getRecord, updateRecord, deleteRecord, getObjectType, validateRecordData } from '@/lib/custom-objects';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ typeId: string; recordId: string }> },
) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  const { recordId } = await params;
  const record = getRecord(recordId);
  if (!record) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

  // Scope by workspace to prevent cross-workspace data leakage
  const workspaceId = auth.user.workspaceId ?? 'default';
  if (record.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  }

  return NextResponse.json({ record });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ typeId: string; recordId: string }> },
) {
  const auth = await requirePerm(request, 'admin:settings');
  if ('error' in auth) return auth.error;

  const { typeId, recordId } = await params;

  // Scope by workspace to prevent cross-workspace modification
  const workspaceId = auth.user.workspaceId ?? 'default';
  const existing = getRecord(recordId);
  if (!existing || existing.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  }

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  const typeDef = getObjectType(typeId);
  if (typeDef) {
    const data = (body.data as Record<string, unknown>) ?? body;
    const merged = { ...existing.data, ...data };
    const validation = validateRecordData(typeDef, merged as Record<string, unknown>);
    if (!validation.valid) {
      return NextResponse.json({ error: 'Validation failed', details: validation.errors }, { status: 400 });
    }
  }

  const updated = updateRecord(recordId, { data: (body.data as Record<string, unknown>) ?? body });
  if (!updated) return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  return NextResponse.json({ record: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ typeId: string; recordId: string }> },
) {
  const auth = await requirePerm(request, 'admin:settings');
  if ('error' in auth) return auth.error;

  const { recordId } = await params;

  // Scope by workspace to prevent cross-workspace deletion
  const workspaceId = auth.user.workspaceId ?? 'default';
  const existing = getRecord(recordId);
  if (!existing || existing.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  }

  deleteRecord(recordId);
  return NextResponse.json({ ok: true });
}
