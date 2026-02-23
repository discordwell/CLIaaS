import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireSCIMAuth } from '@/lib/scim/auth';
import { toSCIMGroup, scimError, applyGroupPatchOps, type SCIMPatchOp } from '@/lib/scim/schema';
import { getGroups, setGroups } from '@/lib/scim/store';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireSCIMAuth(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const group = getGroups().find(g => g.id === id);
  if (!group) {
    return NextResponse.json(scimError(404, 'Group not found'), { status: 404 });
  }

  return NextResponse.json(toSCIMGroup(group));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireSCIMAuth(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const groups = getGroups();
  const idx = groups.findIndex(g => g.id === id);
  if (idx === -1) {
    return NextResponse.json(scimError(404, 'Group not found'), { status: 404 });
  }

  try {
    const parsed = await parseJsonBody<SCIMPatchOp>(request);
    if ('error' in parsed) return parsed.error;
    const body = parsed.data;
    const group = groups[idx];
    applyGroupPatchOps(group, body);
    setGroups(groups);
    return NextResponse.json(toSCIMGroup(group));
  } catch (err) {
    return NextResponse.json(
      scimError(500, err instanceof Error ? err.message : 'Update failed'),
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireSCIMAuth(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const groups = getGroups();
  const idx = groups.findIndex(g => g.id === id);
  if (idx === -1) {
    return NextResponse.json(scimError(404, 'Group not found'), { status: 404 });
  }

  groups.splice(idx, 1);
  setGroups(groups);
  return new NextResponse(null, { status: 204 });
}
