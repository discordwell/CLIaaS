import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requirePerm } from '@/lib/rbac';
import { getObjectType, listRecords, createRecord, validateRecordData } from '@/lib/custom-objects';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ typeId: string }> },
) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  const { typeId } = await params;
  const workspaceId = auth.user.workspaceId ?? 'default';
  const records = listRecords(typeId, workspaceId);
  return NextResponse.json({ records });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ typeId: string }> },
) {
  const auth = await requirePerm(request, 'admin:settings');
  if ('error' in auth) return auth.error;

  const { typeId } = await params;
  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  const workspaceId = auth.user.workspaceId ?? 'default';
  const typeDef = getObjectType(typeId);
  if (!typeDef) return NextResponse.json({ error: 'Type not found' }, { status: 404 });

  const data = (body.data as Record<string, unknown>) ?? body;
  const validation = validateRecordData(typeDef, data);
  if (!validation.valid) {
    return NextResponse.json({ error: 'Validation failed', details: validation.errors }, { status: 400 });
  }

  const record = createRecord({
    workspaceId,
    typeId,
    data,
    createdBy: auth.user.id,
  });

  return NextResponse.json({ record }, { status: 201 });
}
