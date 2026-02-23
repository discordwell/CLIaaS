import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireSCIMAuth } from '@/lib/scim/auth';
import { toSCIMUser, scimError, applyUserPatchOps, type SCIMPatchOp } from '@/lib/scim/schema';
import { getUsers, setUsers } from '@/lib/scim/store';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireSCIMAuth(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const user = getUsers().find(u => u.id === id);
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
  const users = getUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) {
    return NextResponse.json(scimError(404, 'User not found'), { status: 404 });
  }

  try {
    const parsed = await parseJsonBody<SCIMPatchOp>(request);
    if ('error' in parsed) return parsed.error;
    const body = parsed.data;
    const user = users[idx];
    applyUserPatchOps(user, body);
    setUsers(users);
    return NextResponse.json(toSCIMUser(user));
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
  const users = getUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) {
    return NextResponse.json(scimError(404, 'User not found'), { status: 404 });
  }

  users.splice(idx, 1);
  setUsers(users);
  return new NextResponse(null, { status: 204 });
}
