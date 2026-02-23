import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateSCIMAuth } from '@/lib/scim/auth';
import { toSCIMUser, wrapListResponse, scimError, type SCIMUser } from '@/lib/scim/schema';

export const dynamic = 'force-dynamic';

declare global {
  // eslint-disable-next-line no-var
  var __cliaasScimUsers: Array<{
    id: string; email: string; name: string; role: string;
    status: string; createdAt: string; updatedAt: string;
  }> | undefined;
}

function getUsers() {
  return global.__cliaasScimUsers ?? [];
}

export async function GET(request: NextRequest) {
  if (!validateSCIMAuth(request.headers.get('authorization'))) {
    return NextResponse.json(scimError(401, 'Unauthorized'), { status: 401 });
  }

  const users = getUsers();
  const scimUsers = users.map(toSCIMUser);
  return NextResponse.json(wrapListResponse(scimUsers, scimUsers.length));
}

export async function POST(request: NextRequest) {
  if (!validateSCIMAuth(request.headers.get('authorization'))) {
    return NextResponse.json(scimError(401, 'Unauthorized'), { status: 401 });
  }

  try {
    const body = await request.json() as Partial<SCIMUser>;
    const email = body.emails?.[0]?.value ?? body.userName ?? '';
    const name = body.name?.formatted ?? body.name?.givenName ?? email;

    if (!email) {
      return NextResponse.json(scimError(400, 'userName or emails required'), { status: 400 });
    }

    const now = new Date().toISOString();
    const user = {
      id: crypto.randomUUID(),
      email,
      name,
      role: 'agent' as const,
      status: body.active !== false ? 'active' : 'inactive',
      createdAt: now,
      updatedAt: now,
    };

    const users = getUsers();
    users.push(user);
    global.__cliaasScimUsers = users;

    return NextResponse.json(toSCIMUser(user), { status: 201 });
  } catch (err) {
    return NextResponse.json(
      scimError(500, err instanceof Error ? err.message : 'Create failed'),
      { status: 500 },
    );
  }
}
