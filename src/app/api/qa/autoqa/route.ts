import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getAutoQAConfig, upsertAutoQAConfig } from '@/lib/qa/autoqa-config-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/qa/autoqa — get AutoQA config
 */
export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'qa:view');
  if ('error' in auth) return auth.error;

  const wsId = auth.user.workspaceId ?? 'default';
  const config = getAutoQAConfig(wsId);
  return NextResponse.json({ config: config ?? { enabled: false, workspaceId: wsId } });
}

/**
 * PUT /api/qa/autoqa — create/update AutoQA config
 */
export async function PUT(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    enabled?: boolean;
    scorecardId?: string;
    triggerOnResolved?: boolean;
    triggerOnClosed?: boolean;
    provider?: 'claude' | 'openai';
    model?: string;
    sampleRate?: number;
    customInstructions?: string;
  }>(request);
  if ('error' in parsed) return parsed.error;

  // Validate sample rate
  if (parsed.data.sampleRate !== undefined) {
    if (parsed.data.sampleRate < 0 || parsed.data.sampleRate > 1) {
      return NextResponse.json({ error: 'sampleRate must be between 0 and 1' }, { status: 400 });
    }
  }

  // Validate customInstructions length
  if (parsed.data.customInstructions !== undefined && parsed.data.customInstructions.length > 2000) {
    return NextResponse.json({ error: 'customInstructions must be 2000 characters or fewer' }, { status: 400 });
  }

  const wsId = auth.user.workspaceId ?? 'default';
  const config = upsertAutoQAConfig(wsId, parsed.data);
  return NextResponse.json({ config });
}
