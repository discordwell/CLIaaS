import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requirePerm } from '@/lib/rbac';
import * as linkStore from '@/lib/integrations/link-store';
import { JiraClient } from '@/lib/integrations/jira-client';
import { LinearClient } from '@/lib/integrations/linear-client';

export const dynamic = 'force-dynamic';

// GET: Show configuration status for engineering integrations
export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const workspaceId = auth.user.workspaceId ?? 'default';
  const jiraCreds = await linkStore.getCredentials(workspaceId, 'jira');
  const linearCreds = await linkStore.getCredentials(workspaceId, 'linear');

  return NextResponse.json({
    jira: {
      configured: !!jiraCreds,
      baseUrl: jiraCreds ? (jiraCreds.credentials as Record<string, string>).baseUrl : null,
      email: jiraCreds ? (jiraCreds.credentials as Record<string, string>).email : null,
    },
    linear: {
      configured: !!linearCreds,
    },
  });
}

// POST: Save credentials + verify connection
export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  const workspaceId = auth.user.workspaceId ?? 'default';
  const provider = body.provider as string;

  if (provider === 'jira') {
    const { baseUrl, email, apiToken } = body;
    if (!baseUrl || !email || !apiToken) {
      return NextResponse.json({ error: 'baseUrl, email, and apiToken are required' }, { status: 400 });
    }

    try {
      const client = new JiraClient({ baseUrl, email, apiToken });
      const info = await client.verify();
      linkStore.saveCredentials({
        workspaceId,
        provider: 'jira',
        authType: 'api_token',
        credentials: { baseUrl, email, apiToken },
        scopes: ['read', 'write'],
      });
      return NextResponse.json({ ok: true, provider: 'jira', serverTitle: info.serverTitle });
    } catch (err) {
      return NextResponse.json(
        { error: `Jira connection failed: ${safeErrorMessage(err, "connection failed")}` },
        { status: 400 },
      );
    }
  }

  if (provider === 'linear') {
    const { apiKey } = body;
    if (!apiKey) {
      return NextResponse.json({ error: 'apiKey is required' }, { status: 400 });
    }

    try {
      const client = new LinearClient({ apiKey });
      const viewer = await client.verify();
      linkStore.saveCredentials({
        workspaceId,
        provider: 'linear',
        authType: 'pat',
        credentials: { apiKey },
        scopes: ['read', 'write'],
      });
      return NextResponse.json({ ok: true, provider: 'linear', user: viewer.name });
    } catch (err) {
      return NextResponse.json(
        { error: `Linear connection failed: ${safeErrorMessage(err, "connection failed")}` },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
}

// DELETE: Remove credentials
export async function DELETE(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const workspaceId = auth.user.workspaceId ?? 'default';
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get('provider');

  if (!provider || !['jira', 'linear'].includes(provider)) {
    return NextResponse.json({ error: 'provider query param required (jira or linear)' }, { status: 400 });
  }

  linkStore.deleteCredentials(workspaceId, provider);
  return NextResponse.json({ ok: true, deleted: provider });
}
