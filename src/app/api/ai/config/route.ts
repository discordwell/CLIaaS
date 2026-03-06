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

const ALLOWED_CONFIG_FIELDS = [
  'enabled', 'mode', 'confidenceThreshold', 'provider', 'model',
  'maxTokens', 'excludedTopics', 'kbContext', 'piiDetection',
  'maxAutoResolvesPerHour', 'requireKbCitation', 'channels',
] as const;

export async function PUT(request: NextRequest) {
  const auth = await requireScopeAndRole(request, 'ai:write', 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<Record<string, unknown>>(request);
  if ('error' in parsed) return parsed.error;

  // Only allow known config fields — prevent workspaceId/tenantId/id injection
  const safeData: Record<string, unknown> = {};
  for (const key of ALLOWED_CONFIG_FIELDS) {
    if (key in parsed.data) {
      safeData[key] = parsed.data[key];
    }
  }

  const config = await saveAgentConfig({
    workspaceId: auth.user.workspaceId,
    tenantId: auth.user.tenantId,
    ...safeData,
  });

  return NextResponse.json({ config });
}
