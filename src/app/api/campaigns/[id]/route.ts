import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getCampaign, updateCampaign } from '@/lib/campaigns/campaign-store';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:view');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const campaign = getCampaign(id, auth.user.workspaceId);

  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  return NextResponse.json({ campaign });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const parsed = await parseJsonBody<{
    name?: string;
    subject?: string;
    templateBody?: string;
    templateVariables?: Record<string, unknown>;
    segmentQuery?: Record<string, unknown>;
    scheduledAt?: string;
    status?: 'draft' | 'scheduled' | 'cancelled';
  }>(request);
  if ('error' in parsed) return parsed.error;

  const campaign = updateCampaign(id, parsed.data, auth.user.workspaceId);

  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  return NextResponse.json({ campaign });
}
