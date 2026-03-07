import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireSCIMAuth } from '@/lib/scim/auth';
import { toSCIMGroup, scimError, applyGroupPatchOps, type SCIMPatchOp } from '@/lib/scim/schema';
import { getGroups, setGroups, getGroup, updateGroup, deleteGroup } from '@/lib/scim/store';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireSCIMAuth(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const group = getGroup(id);
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
  const existing = getGroup(id);
  if (!existing) {
    return NextResponse.json(scimError(404, 'Group not found'), { status: 404 });
  }

  try {
    const parsed = await parseJsonBody<SCIMPatchOp>(request);
    if ('error' in parsed) return parsed.error;
    const body = parsed.data;
    const mutable = { ...existing };
    applyGroupPatchOps(mutable, body);
    const updated = updateGroup(id, { name: mutable.name, members: mutable.members });
    return NextResponse.json(toSCIMGroup(updated ?? mutable));
  } catch (err) {
    return NextResponse.json(
      scimError(500, safeErrorMessage(err, 'Update failed')),
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
  const existing = getGroup(id);
  if (!existing) {
    return NextResponse.json(scimError(404, 'Group not found'), { status: 404 });
  }

  deleteGroup(id);
  return new NextResponse(null, { status: 204 });
}
