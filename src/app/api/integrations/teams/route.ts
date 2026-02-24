import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getTeamsIntegration } from '@/lib/integrations/teams';
import type { TeamsActivityPayload } from '@/lib/integrations/teams';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireRole } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const teams = getTeamsIntegration();
    const status = teams.getStatus();
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get Teams status' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const parsed = await parseJsonBody<Record<string, unknown>>(request);
    if ('error' in parsed) return parsed.error;
    const body = parsed.data;
    const teams = getTeamsIntegration();

    // Handle incoming activity from Teams
    if (body.type === 'message') {
      const payload: TeamsActivityPayload = {
        type: body.type as string,
        text: body.text as string ?? '',
        from: body.from as { id: string; name: string } ?? { id: '', name: '' },
        channelId: body.channelId as string ?? '',
        conversation: body.conversation as { id: string } ?? { id: '' },
        serviceUrl: body.serviceUrl as string ?? '',
      };

      const response = teams.handleIncomingActivity(payload);
      return NextResponse.json(response);
    }

    // Handle test notification
    if (body.action === 'test') {
      const result = await teams.sendNotification({
        title: 'Test Notification',
        message: 'This is a test notification from CLIaaS.',
        priority: 'normal',
      });
      return NextResponse.json(result);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to process Teams event' },
      { status: 500 }
    );
  }
}
