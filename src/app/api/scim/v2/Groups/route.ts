import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireSCIMAuth } from '@/lib/scim/auth';
import { toSCIMGroup, wrapListResponse, scimError, type SCIMGroup } from '@/lib/scim/schema';
import { getGroups, setGroups, getGroupsAsync, createGroupAsync } from '@/lib/scim/store';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = requireSCIMAuth(request);
  if (!auth.ok) return auth.response;

  const workspaceId = (auth as unknown as { workspaceId?: string }).workspaceId ?? 'default';
  const groups = await getGroupsAsync(workspaceId);
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

    const workspaceId = (auth as unknown as { workspaceId?: string }).workspaceId ?? 'default';
    const group = await createGroupAsync({
      name: displayName,
      workspaceId,
      members: body.members?.map(m => ({ id: m.value, name: m.display ?? '' })),
    }, workspaceId);

    return NextResponse.json(toSCIMGroup(group), { status: 201 });
  } catch (err) {
    return NextResponse.json(
      scimError(500, safeErrorMessage(err, 'Create failed')),
      { status: 500 },
    );
  }
}
