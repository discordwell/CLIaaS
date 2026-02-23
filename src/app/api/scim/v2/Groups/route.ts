import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireSCIMAuth } from '@/lib/scim/auth';
import { toSCIMGroup, wrapListResponse, scimError, type SCIMGroup } from '@/lib/scim/schema';
import { getGroups, setGroups } from '@/lib/scim/store';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = requireSCIMAuth(request);
  if (!auth.ok) return auth.response;

  const groups = getGroups();
  const scimGroups = groups.map(toSCIMGroup);
  return NextResponse.json(wrapListResponse(scimGroups, scimGroups.length));
}

export async function POST(request: NextRequest) {
  const auth = requireSCIMAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const parsed = await parseJsonBody<Partial<SCIMGroup>>(request);
    if ('error' in parsed) return parsed.error;
    const body = parsed.data;
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
    setGroups(groups);

    return NextResponse.json(toSCIMGroup(group), { status: 201 });
  } catch (err) {
    return NextResponse.json(
      scimError(500, err instanceof Error ? err.message : 'Create failed'),
      { status: 500 },
    );
  }
}
