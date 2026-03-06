import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requirePerm } from '@/lib/rbac';
import * as linkStore from '@/lib/integrations/link-store';
import { getCrmDataForCustomer } from '@/lib/integrations/crm-sync';

export const dynamic = 'force-dynamic';

// GET: CRM data for a customer
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'customers:edit');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const workspaceId = auth.user.workspaceId ?? 'default';
  const crmData = getCrmDataForCustomer(id, workspaceId);
  return NextResponse.json({ customerId: id, crm: crmData });
}

// POST: Link a CRM record to a customer
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'customers:edit');
  if ('error' in auth) return auth.error;

  const { id: customerId } = await params;
  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  const workspaceId = auth.user.workspaceId ?? 'default';
  const { provider, crmObjectType, crmObjectId, crmObjectUrl, crmData } = body;

  if (!provider || !crmObjectType || !crmObjectId) {
    return NextResponse.json({ error: 'provider, crmObjectType, and crmObjectId are required' }, { status: 400 });
  }

  const link = linkStore.createCrmLink({
    workspaceId,
    provider,
    entityType: 'customer',
    entityId: customerId,
    crmObjectType,
    crmObjectId,
    crmObjectUrl,
    crmData: (crmData as unknown as Record<string, unknown>) ?? {},
    lastSyncedAt: new Date().toISOString(),
  });

  return NextResponse.json({ link }, { status: 201 });
}
