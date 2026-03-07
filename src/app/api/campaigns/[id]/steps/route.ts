import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getCampaignSteps, addCampaignStep, reorderCampaignSteps, type CampaignStepType } from '@/lib/campaigns/campaign-store';

export const dynamic = 'force-dynamic';

const VALID_STEP_TYPES: CampaignStepType[] = ['send_email', 'send_sms', 'send_in_app', 'send_push', 'wait_delay', 'wait_event', 'condition', 'branch', 'update_tag', 'webhook'];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:view');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const steps = await getCampaignSteps(id, auth.user.workspaceId);
  return NextResponse.json({ steps, total: steps.length });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const parsed = await parseJsonBody<{
    stepType: CampaignStepType;
    name: string;
    config?: Record<string, unknown>;
    delaySeconds?: number;
    conditionQuery?: Record<string, unknown>;
    stepIds?: string[];
  }>(request);
  if ('error' in parsed) return parsed.error;

  // Handle reorder
  if (parsed.data.stepIds) {
    const reordered = await reorderCampaignSteps(id, parsed.data.stepIds);
    return NextResponse.json({ steps: reordered });
  }

  const { stepType, name, config, delaySeconds, conditionQuery } = parsed.data;

  if (!stepType || !name) {
    return NextResponse.json({ error: 'stepType and name are required' }, { status: 400 });
  }
  if (!VALID_STEP_TYPES.includes(stepType)) {
    return NextResponse.json({ error: `Invalid stepType: ${stepType}` }, { status: 400 });
  }

  const step = await addCampaignStep(
    { campaignId: id, stepType, name, config, delaySeconds, conditionQuery },
    auth.user.workspaceId,
  );

  return NextResponse.json({ step }, { status: 201 });
}
