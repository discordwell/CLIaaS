import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  verifySlackSignature,
  messageToTicket,
  findMappingByChannel,
  findConversation,
  createSlackConversation,
  addSlackMessage,
  getSlackSigningSecret,
} from '@/lib/channels/slack-intake';

export const dynamic = 'force-dynamic';

interface SlackEventPayload {
  type: string;
  token?: string;
  challenge?: string;
  event?: {
    type: string;
    subtype?: string;
    channel: string;
    user: string;
    text: string;
    ts: string;
    thread_ts?: string;
    event_ts?: string;
    bot_id?: string;
  };
}

export async function POST(request: NextRequest) {
  // Read the raw body for signature verification
  const rawBody = await request.text();
  const signingSecret = getSlackSigningSecret();

  // Parse the JSON payload
  let payload: SlackEventPayload;
  try {
    payload = JSON.parse(rawBody) as SlackEventPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Handle URL verification challenge (no signature check needed for this)
  if (payload.type === 'url_verification') {
    return NextResponse.json({ challenge: payload.challenge });
  }

  // Verify Slack signature (skip in demo mode when no secret is configured)
  if (signingSecret) {
    const signature = request.headers.get('x-slack-signature') ?? '';
    const timestamp = request.headers.get('x-slack-request-timestamp') ?? '';

    if (!verifySlackSignature(signingSecret, signature, timestamp, rawBody)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  // Handle event callbacks
  if (payload.type === 'event_callback' && payload.event) {
    const event = payload.event;

    // Ignore bot messages to prevent loops
    if (event.bot_id || event.subtype === 'bot_message') {
      return NextResponse.json({ ok: true });
    }

    // Only process message events
    if (event.type === 'message' && event.text) {
      const mapping = findMappingByChannel(event.channel);
      const channelName = mapping?.slackChannelName ?? event.channel;

      // Find or create conversation
      let conversation = findConversation(event.channel, event.user);
      if (!conversation) {
        conversation = createSlackConversation(event.channel, event.user, event.thread_ts);
      }

      // Add the inbound message
      addSlackMessage(conversation.id, 'inbound', event.text, event.ts);

      // If a mapping exists and auto-create is enabled, the ticket can be created
      // (In a full implementation, this would call the ticket store)
      if (mapping?.autoCreateTicket && !conversation.ticketId) {
        const _ticketData = messageToTicket(
          {
            type: event.type,
            channel: event.channel,
            user: event.user,
            text: event.text,
            ts: event.ts,
            thread_ts: event.thread_ts,
          },
          channelName,
        );
        // Ticket creation would happen here via the data provider
      }
    }
  }

  return NextResponse.json({ ok: true });
}
