import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { saveTeamsConfig } from '@/lib/channels/teams-intake';

export const dynamic = 'force-dynamic';

/**
 * POST /api/channels/teams/auth
 * Save MS Teams Bot Framework app credentials.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'channels:edit');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    appId: string;
    appPassword: string;
    botName?: string;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { appId, appPassword, botName } = parsed.data;

  if (!appId || !appPassword) {
    return NextResponse.json(
      { error: 'appId and appPassword are required' },
      { status: 400 },
    );
  }

  const config = saveTeamsConfig({
    appId,
    appPassword,
    botName,
    workspaceId: auth.user.workspaceId,
  });

  return NextResponse.json({
    success: true,
    configId: config.id,
    botName: config.botName,
    message: 'Teams bot credentials saved. Configure the Bot Framework messaging endpoint to point to /api/channels/teams/messages.',
  });
}
