import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  verifySlackSignature,
  getSlackSigningSecret,
} from '@/lib/channels/slack-intake';

export const dynamic = 'force-dynamic';

interface SlackInteractionPayload {
  type: string;
  trigger_id?: string;
  user?: {
    id: string;
    name: string;
  };
  actions?: Array<{
    action_id: string;
    block_id: string;
    value?: string;
    type: string;
  }>;
  response_url?: string;
}

export async function POST(request: NextRequest) {
  // Read the raw body for signature verification
  const rawBody = await request.text();
  const signingSecret = getSlackSigningSecret();

  // Verify Slack signature — fail closed when no signing secret is configured
  if (!signingSecret) {
    return NextResponse.json(
      { error: 'Slack signing secret not configured' },
      { status: 503 },
    );
  }

  const signature = request.headers.get('x-slack-signature') ?? '';
  const timestamp = request.headers.get('x-slack-request-timestamp') ?? '';

  if (!verifySlackSignature(signingSecret, signature, timestamp, rawBody)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Parse the interaction payload (Slack sends it as form-encoded with a 'payload' field)
  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get('payload');

  if (!payloadStr) {
    return NextResponse.json({ error: 'Missing payload' }, { status: 400 });
  }

  let payload: SlackInteractionPayload;
  try {
    payload = JSON.parse(payloadStr) as SlackInteractionPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid payload JSON' }, { status: 400 });
  }

  // Handle block actions (button clicks)
  if (payload.type === 'block_actions' && payload.actions) {
    for (const action of payload.actions) {
      switch (action.action_id) {
        case 'create_ticket':
          // In a full implementation, create a ticket from the action value
          return NextResponse.json({
            text: `Ticket creation triggered by ${payload.user?.name ?? 'unknown'}. Value: ${action.value ?? 'none'}`,
            replace_original: false,
          });

        case 'view_ticket':
          return NextResponse.json({
            text: `View ticket: ${action.value ?? 'unknown'}`,
            replace_original: false,
          });

        default:
          return NextResponse.json({
            text: `Action "${action.action_id}" acknowledged.`,
            replace_original: false,
          });
      }
    }
  }

  // Acknowledge all other interaction types
  return NextResponse.json({ ok: true });
}
