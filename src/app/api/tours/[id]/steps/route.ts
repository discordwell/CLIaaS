import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getTourSteps, addTourStep, reorderTourSteps } from '@/lib/tours/tour-store';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:view');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const steps = await getTourSteps(id);
  return NextResponse.json({ steps });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const parsed = await parseJsonBody<{
    action?: 'reorder';
    stepIds?: string[];
    targetSelector?: string;
    title?: string;
    body?: string;
    placement?: string;
    highlightTarget?: boolean;
    actionLabel?: string;
  }>(request);
  if ('error' in parsed) return parsed.error;

  if (parsed.data.action === 'reorder' && parsed.data.stepIds) {
    const steps = await reorderTourSteps(id, parsed.data.stepIds);
    return NextResponse.json({ steps });
  }

  if (!parsed.data.targetSelector || !parsed.data.title) {
    return NextResponse.json({ error: 'targetSelector and title are required' }, { status: 400 });
  }

  const step = await addTourStep(
    {
      tourId: id,
      targetSelector: parsed.data.targetSelector,
      title: parsed.data.title,
      body: parsed.data.body,
      placement: parsed.data.placement as 'top' | 'bottom' | 'left' | 'right' | 'center',
      highlightTarget: parsed.data.highlightTarget,
      actionLabel: parsed.data.actionLabel,
    },
    auth.user.workspaceId,
  );

  return NextResponse.json({ step }, { status: 201 });
}
