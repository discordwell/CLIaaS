import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  verifyWebhook,
  parseWebhookPayload,
  validateSignature,
  isMetaDemoMode,
} from '@/lib/channels/meta';
import {
  findByExternalUser,
  createConversation,
  addMessage,
} from '@/lib/channels/social-store';
import { createLogger } from '@/lib/logger';

const logger = createLogger('channels:facebook:webhook');

export const dynamic = 'force-dynamic';

/**
 * GET: Meta webhook verification.
 * Facebook sends hub.mode, hub.verify_token, hub.challenge as query params.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode') ?? '';
  const token = searchParams.get('hub.verify_token') ?? '';
  const challenge = searchParams.get('hub.challenge') ?? '';

  const result = verifyWebhook(mode, token, challenge);

  if (result !== null) {
    return new Response(result, { status: 200 });
  }

  return new Response('Forbidden', { status: 403 });
}

/**
 * POST: Receive Facebook Messenger messages.
 * Validates X-Hub-Signature-256, parses payload, stores in social-store.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // Validate signature (skip in demo mode)
    if (!isMetaDemoMode()) {
      const signature = request.headers.get('X-Hub-Signature-256') ?? '';
      if (!validateSignature(rawBody, signature)) {
        return new Response('Forbidden', { status: 403 });
      }
    }

    const body = JSON.parse(rawBody);
    const messages = parseWebhookPayload(body);

    for (const msg of messages) {
      // Find or create conversation
      let conversation = findByExternalUser('facebook', msg.senderId);
      if (!conversation) {
        conversation = createConversation(
          'facebook',
          msg.senderId,
          `FB User ${msg.senderId.slice(-6)}`,
        );
      }

      // Add inbound message
      addMessage(conversation.id, 'inbound', msg.text, msg.messageId);
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : 'Unknown' }, 'Facebook webhook processing failed');
    return NextResponse.json({ status: 'ok' });
  }
}
