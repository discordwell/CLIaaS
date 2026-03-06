import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { updateTourStep, deleteTourStep } from '@/lib/tours/tour-store';

export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const { stepId } = await params;
  const parsed = await parseJsonBody<{
    targetSelector?: string;
    title?: string;
    body?: string;
    placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
    highlightTarget?: boolean;
    actionLabel?: string;
    position?: number;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { targetSelector, title, body, placement, highlightTarget, actionLabel, position } = parsed.data;
  const step = updateTourStep(stepId, { targetSelector, title, body, placement, highlightTarget, actionLabel, position });
  if (!step) return NextResponse.json({ error: 'Step not found' }, { status: 404 });

  return NextResponse.json({ step });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const { stepId } = await params;
  const deleted = deleteTourStep(stepId);
  if (!deleted) return NextResponse.json({ error: 'Step not found' }, { status: 404 });

  return NextResponse.json({ deleted: true });
}
