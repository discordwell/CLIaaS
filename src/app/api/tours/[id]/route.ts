import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getTour, updateTour, deleteTour, toggleTour } from '@/lib/tours/tour-store';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:view');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const tour = await getTour(id, auth.user.workspaceId);
  if (!tour) return NextResponse.json({ error: 'Tour not found' }, { status: 404 });

  return NextResponse.json({ tour });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const parsed = await parseJsonBody<{
    name?: string;
    description?: string;
    targetUrlPattern?: string;
    segmentQuery?: Record<string, unknown>;
    priority?: number;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { name, description, targetUrlPattern, segmentQuery, priority } = parsed.data;
  const tour = updateTour(id, { name, description, targetUrlPattern, segmentQuery, priority }, auth.user.workspaceId);
  if (!tour) return NextResponse.json({ error: 'Tour not found' }, { status: 404 });

  return NextResponse.json({ tour });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const deleted = deleteTour(id, auth.user.workspaceId);
  if (!deleted) return NextResponse.json({ error: 'Tour not found' }, { status: 404 });

  return NextResponse.json({ deleted: true });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const tour = await toggleTour(id, auth.user.workspaceId);
  if (!tour) return NextResponse.json({ error: 'Tour not found' }, { status: 404 });

  return NextResponse.json({ tour });
}
