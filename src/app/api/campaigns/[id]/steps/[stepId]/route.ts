import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getCampaignStep, updateCampaignStep, removeCampaignStep } from '@/lib/campaigns/campaign-store';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> },
) {
  const auth = await requirePerm(request, 'automation:view');
  if ('error' in auth) return auth.error;

  const { stepId } = await params;
  const step = await getCampaignStep(stepId);
  if (!step) {
    return NextResponse.json({ error: 'Step not found' }, { status: 404 });
  }
  return NextResponse.json({ step });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const { stepId } = await params;
  const parsed = await parseJsonBody<{
    name?: string;
    config?: Record<string, unknown>;
    delaySeconds?: number;
    conditionQuery?: Record<string, unknown>;
    nextStepId?: string;
    branchTrueStepId?: string;
    branchFalseStepId?: string;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const step = updateCampaignStep(stepId, parsed.data);
  if (!step) {
    return NextResponse.json({ error: 'Step not found' }, { status: 404 });
  }
  return NextResponse.json({ step });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const { stepId } = await params;
  const removed = removeCampaignStep(stepId);
  if (!removed) {
    return NextResponse.json({ error: 'Step not found' }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
