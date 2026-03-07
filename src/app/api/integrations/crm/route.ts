import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requirePerm } from '@/lib/rbac';
import * as linkStore from '@/lib/integrations/link-store';
import { SalesforceClient } from '@/lib/integrations/salesforce-client';
import { HubSpotCrmClient } from '@/lib/integrations/hubspot-crm-client';

export const dynamic = 'force-dynamic';

// GET: Show CRM configuration status
export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const workspaceId = auth.user.workspaceId ?? 'default';
  const sfCreds = await linkStore.getCredentials(workspaceId, 'salesforce');
  const hubCreds = await linkStore.getCredentials(workspaceId, 'hubspot-crm');

  return NextResponse.json({
    salesforce: { configured: !!sfCreds },
    hubspot: { configured: !!hubCreds },
  });
}

// POST: Save CRM credentials + verify connection
export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  const workspaceId = auth.user.workspaceId ?? 'default';
  const provider = body.provider as string;

  if (provider === 'salesforce') {
    const { instanceUrl, accessToken } = body;
    if (!instanceUrl || !accessToken) {
      return NextResponse.json({ error: 'instanceUrl and accessToken are required' }, { status: 400 });
    }
    try {
      const client = new SalesforceClient({ instanceUrl, accessToken });
      const info = await client.verify();
      linkStore.saveCredentials({
        workspaceId,
        provider: 'salesforce',
        authType: 'oauth2',
        credentials: { instanceUrl, accessToken },
        scopes: ['read', 'write'],
      });
      return NextResponse.json({ ok: true, provider: 'salesforce', displayName: info.displayName });
    } catch (err) {
      return NextResponse.json(
        { error: `Salesforce connection failed: ${safeErrorMessage(err, "connection failed")}` },
        { status: 400 },
      );
    }
  }

  if (provider === 'hubspot-crm') {
    const { accessToken } = body;
    if (!accessToken) {
      return NextResponse.json({ error: 'accessToken is required' }, { status: 400 });
    }
    try {
      const client = new HubSpotCrmClient({ accessToken });
      const info = await client.verify();
      linkStore.saveCredentials({
        workspaceId,
        provider: 'hubspot-crm',
        authType: 'pat',
        credentials: { accessToken },
        scopes: ['read', 'write'],
      });
      return NextResponse.json({ ok: true, provider: 'hubspot-crm', portalId: info.portalId });
    } catch (err) {
      return NextResponse.json(
        { error: `HubSpot connection failed: ${safeErrorMessage(err, "connection failed")}` },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
}
