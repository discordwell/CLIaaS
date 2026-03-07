import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import * as linkStore from '@/lib/integrations/link-store';
import { JiraClient } from '@/lib/integrations/jira-client';
import { LinearClient } from '@/lib/integrations/linear-client';
import { syncLink } from '@/lib/integrations/engineering-sync';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  const auth = await requirePerm(request, 'tickets:update_status');
  if ('error' in auth) return auth.error;

  const { linkId } = await params;
  const link = await linkStore.getExternalLink(linkId);
  if (!link) return NextResponse.json({ error: 'Link not found' }, { status: 404 });

  // Scope by workspace to prevent cross-workspace sync triggers
  const workspaceId = auth.user.workspaceId ?? 'default';
  if (link.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Link not found' }, { status: 404 });
  }
  const creds = await linkStore.getCredentials(workspaceId, link.provider);
  if (!creds) {
    return NextResponse.json({ error: `${link.provider} not configured` }, { status: 400 });
  }

  try {
    const credData = creds.credentials as Record<string, string>;
    const client = link.provider === 'jira'
      ? { provider: 'jira' as const, jira: new JiraClient({ baseUrl: credData.baseUrl, email: credData.email, apiToken: credData.apiToken }) }
      : { provider: 'linear' as const, linear: new LinearClient({ apiKey: credData.apiKey }) };

    const result = await syncLink(client, link);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 },
    );
  }
}
