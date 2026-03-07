import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { getCampaignFunnel } from '@/lib/campaigns/campaign-store';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:view');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const funnel = await getCampaignFunnel(id, auth.user.workspaceId);
  return NextResponse.json({ funnel, totalSteps: funnel.length });
}
