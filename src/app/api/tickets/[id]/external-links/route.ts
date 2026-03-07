import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { requirePerm } from '@/lib/rbac';
import * as linkStore from '@/lib/integrations/link-store';
import { JiraClient } from '@/lib/integrations/jira-client';
import { LinearClient } from '@/lib/integrations/linear-client';
import { createIssueFromTicket, linkExistingIssue } from '@/lib/integrations/engineering-sync';

export const dynamic = 'force-dynamic';

// GET: List external links for a ticket
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const links = await linkStore.listExternalLinks(id);
  return NextResponse.json({ links });
}

// POST: Create a new external link (create issue or link existing)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'tickets:update_status');
  if ('error' in auth) return auth.error;

  const { id: ticketId } = await params;
  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  const workspaceId = auth.user.workspaceId ?? 'default';
  const provider = body.provider as string;
  const action = body.action as string; // 'create' | 'link'

  if (!provider || !['jira', 'linear'].includes(provider)) {
    return NextResponse.json({ error: 'provider must be jira or linear' }, { status: 400 });
  }

  const creds = await linkStore.getCredentials(workspaceId, provider);
  if (!creds) {
    return NextResponse.json({ error: `${provider} not configured. Set up credentials first.` }, { status: 400 });
  }

  try {
    const credData = creds.credentials as Record<string, string>;
    const client = provider === 'jira'
      ? { provider: 'jira' as const, jira: new JiraClient({ baseUrl: credData.baseUrl, email: credData.email, apiToken: credData.apiToken }) }
      : { provider: 'linear' as const, linear: new LinearClient({ apiKey: credData.apiKey }) };

    if (action === 'create') {
      const link = await createIssueFromTicket(client, {
        workspaceId,
        ticketId,
        ticketSubject: (body.subject as string) ?? 'CLIaaS Ticket',
        ticketDescription: body.description as string,
        projectKey: body.projectKey as string,
        issueType: body.issueType as string,
        teamId: body.teamId as string,
      });
      return NextResponse.json({ link }, { status: 201 });
    }

    if (action === 'link') {
      const issueKey = body.issueKey as string;
      if (!issueKey) return NextResponse.json({ error: 'issueKey is required' }, { status: 400 });
      const link = await linkExistingIssue(client, { workspaceId, ticketId, issueKey });
      return NextResponse.json({ link }, { status: 201 });
    }

    return NextResponse.json({ error: 'action must be "create" or "link"' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create link') },
      { status: 500 },
    );
  }
}
