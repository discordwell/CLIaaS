import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSlackIntegration } from '@/lib/integrations/slack';
import type { SlackCommandPayload } from '@/lib/integrations/slack';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const slack = getSlackIntegration();
    const status = slack.getStatus();
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get Slack status' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') ?? '';
    const slack = getSlackIntegration();

    // Handle URL-encoded slash commands
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData();
      const payload: SlackCommandPayload = {
        command: formData.get('command') as string ?? '',
        text: formData.get('text') as string ?? '',
        response_url: formData.get('response_url') as string ?? '',
        user_id: formData.get('user_id') as string ?? '',
        user_name: formData.get('user_name') as string ?? '',
        channel_id: formData.get('channel_id') as string ?? '',
        channel_name: formData.get('channel_name') as string ?? '',
      };

      const response = slack.handleSlashCommand(payload);
      return NextResponse.json(response);
    }

    // Handle JSON event payloads
    const body = await request.json().catch(() => ({} as Record<string, unknown>));

    // Slack URL verification challenge
    if (body.type === 'url_verification') {
      return NextResponse.json({ challenge: body.challenge });
    }

    // Handle events
    if (body.type === 'event_callback') {
      const event = body.event as Record<string, unknown> | undefined;
      if (event?.type === 'message' && event.text) {
        // Could create a ticket from the message
        return NextResponse.json({ ok: true });
      }
    }

    // Handle test notification
    if (body.action === 'test') {
      const result = await slack.sendNotification({
        title: 'Test Notification',
        message: 'This is a test notification from CLIaaS.',
        priority: 'normal',
      });
      return NextResponse.json(result);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to process Slack event' },
      { status: 500 }
    );
  }
}
