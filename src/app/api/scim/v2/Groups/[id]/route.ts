import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateSCIMAuth } from '@/lib/scim/auth';
import { toSCIMGroup, scimError, type SCIMGroup } from '@/lib/scim/schema';

export const dynamic = 'force-dynamic';

function getGroups() {
  return global.__cliaasScimGroups ?? [];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!validateSCIMAuth(request.headers.get('authorization'))) {
    return NextResponse.json(scimError(401, 'Unauthorized'), { status: 401 });
  }

  const { id } = await params;
  const group = getGroups().find(g => g.id === id);
  if (!group) {
    return NextResponse.json(scimError(404, 'Group not found'), { status: 404 });
  }

  return NextResponse.json(toSCIMGroup(group));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!validateSCIMAuth(request.headers.get('authorization'))) {
    return NextResponse.json(scimError(401, 'Unauthorized'), { status: 401 });
  }

  const { id } = await params;
  const groups = getGroups();
  const idx = groups.findIndex(g => g.id === id);
  if (idx === -1) {
    return NextResponse.json(scimError(404, 'Group not found'), { status: 404 });
  }

  try {
    const body = await request.json() as Partial<SCIMGroup>;
    const group = groups[idx];

    if (body.displayName) group.name = body.displayName;
    if (body.members) {
      group.members = body.members.map(m => ({ id: m.value, name: m.display ?? '' }));
    }
    group.updatedAt = new Date().toISOString();

    global.__cliaasScimGroups = groups;
    return NextResponse.json(toSCIMGroup(group));
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
  const groups = getGroups();
  const idx = groups.findIndex(g => g.id === id);
  if (idx === -1) {
    return NextResponse.json(scimError(404, 'Group not found'), { status: 404 });
  }

  groups.splice(idx, 1);
  global.__cliaasScimGroups = groups;
  return new NextResponse(null, { status: 204 });
}
