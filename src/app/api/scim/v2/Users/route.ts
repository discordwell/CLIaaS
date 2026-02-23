import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireSCIMAuth } from '@/lib/scim/auth';
import { toSCIMUser, wrapListResponse, scimError, type SCIMUser } from '@/lib/scim/schema';
import { getUsers, setUsers } from '@/lib/scim/store';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = requireSCIMAuth(request);
  if (!auth.ok) return auth.response;

  const users = getUsers();
  const scimUsers = users.map(toSCIMUser);
  return NextResponse.json(wrapListResponse(scimUsers, scimUsers.length));
}

export async function POST(request: NextRequest) {
  const auth = requireSCIMAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const parsed = await parseJsonBody<Partial<SCIMUser>>(request);
    if ('error' in parsed) return parsed.error;
    const body = parsed.data;
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
    setUsers(users);

    return NextResponse.json(toSCIMUser(user), { status: 201 });
  } catch (err) {
    return NextResponse.json(
      scimError(500, err instanceof Error ? err.message : 'Create failed'),
      { status: 500 },
    );
  }
}
