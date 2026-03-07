import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getTours, createTour } from '@/lib/tours/tour-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'automation:view');
  if ('error' in auth) return auth.error;

  const tours = await getTours(auth.user.workspaceId);
  return NextResponse.json({ tours, total: tours.length });
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    name: string;
    description?: string;
    targetUrlPattern?: string;
    segmentQuery?: Record<string, unknown>;
    priority?: number;
  }>(request);
  if ('error' in parsed) return parsed.error;

  if (!parsed.data.name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const tour = createTour(
    { ...parsed.data, createdBy: auth.user.id },
    auth.user.workspaceId,
  );

  return NextResponse.json({ tour }, { status: 201 });
}
