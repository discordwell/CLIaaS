import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getCampaigns, createCampaign } from '@/lib/campaigns/campaign-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'automation:view');
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') as 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | null;
  const channel = searchParams.get('channel') as 'email' | 'sms' | 'whatsapp' | null;

  const campaigns = getCampaigns({
    status: status ?? undefined,
    channel: channel ?? undefined,
    workspaceId: auth.user.workspaceId,
  });

  return NextResponse.json({ campaigns, total: campaigns.length });
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    name: string;
    channel: 'email' | 'sms' | 'whatsapp';
    subject?: string;
    templateBody?: string;
    templateVariables?: Record<string, unknown>;
    segmentQuery?: Record<string, unknown>;
    scheduledAt?: string;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { name, channel, subject, templateBody, templateVariables, segmentQuery, scheduledAt } = parsed.data;

  if (!name || !channel) {
    return NextResponse.json({ error: 'name and channel are required' }, { status: 400 });
  }

  const campaign = createCampaign(
    { name, channel, subject, templateBody, templateVariables, segmentQuery, scheduledAt, createdBy: auth.user.id },
    auth.user.workspaceId,
  );

  return NextResponse.json({ campaign }, { status: 201 });
}
