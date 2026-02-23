import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateSCIMAuth } from '@/lib/scim/auth';
import { toSCIMUser, scimError, type SCIMUser } from '@/lib/scim/schema';

export const dynamic = 'force-dynamic';

function getUsers() {
  return global.__cliaasScimUsers ?? [];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!validateSCIMAuth(request.headers.get('authorization'))) {
    return NextResponse.json(scimError(401, 'Unauthorized'), { status: 401 });
  }

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
  if (!validateSCIMAuth(request.headers.get('authorization'))) {
    return NextResponse.json(scimError(401, 'Unauthorized'), { status: 401 });
  }

  const { id } = await params;
  const users = getUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) {
    return NextResponse.json(scimError(404, 'User not found'), { status: 404 });
  }

  try {
    const body = await request.json() as Partial<SCIMUser>;
    const user = users[idx];

    if (body.name?.formatted) user.name = body.name.formatted;
    if (body.emails?.[0]?.value) user.email = body.emails[0].value;
    if (body.active !== undefined) user.status = body.active ? 'active' : 'inactive';
    user.updatedAt = new Date().toISOString();

    global.__cliaasScimUsers = users;
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
  if (!validateSCIMAuth(request.headers.get('authorization'))) {
    return NextResponse.json(scimError(401, 'Unauthorized'), { status: 401 });
  }

  const { id } = await params;
  const users = getUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) {
    return NextResponse.json(scimError(404, 'User not found'), { status: 404 });
  }

  users.splice(idx, 1);
  global.__cliaasScimUsers = users;
  return new NextResponse(null, { status: 204 });
}
