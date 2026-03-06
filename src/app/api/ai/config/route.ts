import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireScope, requireScopeAndRole } from '@/lib/api-auth';
import { getAgentConfig, saveAgentConfig } from '@/lib/ai/store';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireScope(request, 'ai:read');
  if ('error' in auth) return auth.error;

  const config = await getAgentConfig(auth.user.workspaceId);
  return NextResponse.json({ config });
}

export async function PUT(request: NextRequest) {
  const auth = await requireScopeAndRole(request, 'ai:write', 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<Record<string, unknown>>(request);
  if ('error' in parsed) return parsed.error;

  const config = await saveAgentConfig({
    workspaceId: auth.user.workspaceId,
    tenantId: auth.user.tenantId,
    ...parsed.data,
  });

  return NextResponse.json({ config });
}
