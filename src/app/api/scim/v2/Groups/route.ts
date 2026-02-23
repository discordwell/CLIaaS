import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateSCIMAuth } from '@/lib/scim/auth';
import { toSCIMGroup, wrapListResponse, scimError, type SCIMGroup } from '@/lib/scim/schema';

export const dynamic = 'force-dynamic';

declare global {
  // eslint-disable-next-line no-var
  var __cliaasScimGroups: Array<{
    id: string; name: string; createdAt: string; updatedAt: string;
    members?: Array<{ id: string; name: string }>;
  }> | undefined;
}

function getGroups() {
  return global.__cliaasScimGroups ?? [];
}

export async function GET(request: NextRequest) {
  if (!validateSCIMAuth(request.headers.get('authorization'))) {
    return NextResponse.json(scimError(401, 'Unauthorized'), { status: 401 });
  }

  const groups = getGroups();
  const scimGroups = groups.map(toSCIMGroup);
  return NextResponse.json(wrapListResponse(scimGroups, scimGroups.length));
}

export async function POST(request: NextRequest) {
  if (!validateSCIMAuth(request.headers.get('authorization'))) {
    return NextResponse.json(scimError(401, 'Unauthorized'), { status: 401 });
  }

  try {
    const body = await request.json() as Partial<SCIMGroup>;
    const displayName = body.displayName;

    if (!displayName) {
      return NextResponse.json(scimError(400, 'displayName is required'), { status: 400 });
    }

    const now = new Date().toISOString();
    const group = {
      id: crypto.randomUUID(),
      name: displayName,
      createdAt: now,
      updatedAt: now,
      members: body.members?.map(m => ({ id: m.value, name: m.display ?? '' })),
    };

    const groups = getGroups();
    groups.push(group);
    global.__cliaasScimGroups = groups;

    return NextResponse.json(toSCIMGroup(group), { status: 201 });
  } catch (err) {
    return NextResponse.json(
      scimError(500, err instanceof Error ? err.message : 'Create failed'),
      { status: 500 },
    );
  }
}
