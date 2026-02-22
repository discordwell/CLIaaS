import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getTeamsIntegration } from '@/lib/integrations/teams';
import type { TeamsActivityPayload } from '@/lib/integrations/teams';

export const dynamic = 'force-dynamic';

export async function GET() {
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
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
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
