import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAllConnectorStatuses, getEntityCapabilities } from '@/lib/connector-service';
import type { ConnectorId } from '@/lib/connector-registry';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings');
  if ('error' in auth) return auth.error;
  const connectors = getAllConnectorStatuses();
  const capabilities = Object.fromEntries(
    connectors.map(c => [
      c.id,
      {
        connector: c.capabilities,
        entities: getEntityCapabilities(c.id as ConnectorId),
      },
    ]),
  );
  return NextResponse.json({ capabilities });
}
