import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireSCIMAuth } from '@/lib/scim/auth';
import { toSCIMUser, wrapListResponse, scimError, type SCIMUser } from '@/lib/scim/schema';
import { getUsers, setUsers, getUsersAsync, createUserAsync } from '@/lib/scim/store';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = requireSCIMAuth(request);
  if (!auth.ok) return auth.response;

  const workspaceId = (auth as unknown as { workspaceId?: string }).workspaceId ?? 'default';
  const users = await getUsersAsync(workspaceId);
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

    const workspaceId = (auth as unknown as { workspaceId?: string }).workspaceId ?? 'default';
    const user = await createUserAsync({
      email,
      name,
      role: 'agent',
      status: body.active !== false ? 'active' : 'inactive',
      workspaceId,
    }, workspaceId);

    return NextResponse.json(toSCIMUser(user), { status: 201 });
  } catch (err) {
    return NextResponse.json(
      scimError(500, safeErrorMessage(err, 'Create failed')),
      { status: 500 },
    );
  }
}
