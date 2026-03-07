import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireSCIMAuth } from '@/lib/scim/auth';
import { toSCIMUser, scimError, applyUserPatchOps, type SCIMPatchOp } from '@/lib/scim/schema';
import { getUsers, setUsers, getUser, updateUserAsync, deleteUserAsync } from '@/lib/scim/store';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireSCIMAuth(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const user = getUser(id);
  if (!user) {
    return NextResponse.json(scimError(404, 'User not found'), { status: 404 });
  }

  return NextResponse.json(toSCIMUser(user));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireSCIMAuth(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = getUser(id);
  if (!existing) {
    return NextResponse.json(scimError(404, 'User not found'), { status: 404 });
  }

  try {
    const parsed = await parseJsonBody<SCIMPatchOp>(request);
    if ('error' in parsed) return parsed.error;
    const body = parsed.data;
    // Apply patch ops to a mutable copy
    const mutable = { ...existing };
    applyUserPatchOps(mutable, body);
    const workspaceId = existing.workspaceId ?? 'default';
    const updated = await updateUserAsync(id, {
      email: mutable.email,
      name: mutable.name,
      role: mutable.role,
      status: mutable.status,
    }, workspaceId);
    return NextResponse.json(toSCIMUser(updated ?? mutable));
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
  const existing = getUser(id);
  if (!existing) {
    return NextResponse.json(scimError(404, 'User not found'), { status: 404 });
  }

  const workspaceId = existing.workspaceId ?? 'default';
  await deleteUserAsync(id, workspaceId);
  return new NextResponse(null, { status: 204 });
}
