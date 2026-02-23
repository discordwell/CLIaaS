import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  handleCrcChallenge,
  parseAccountActivity,
  isTwitterDemoMode,
  validateSignature,
} from '@/lib/channels/twitter';
import {
  findByExternalUser,
  createConversation,
  addMessage,
} from '@/lib/channels/social-store';

export const dynamic = 'force-dynamic';

/**
 * GET: Twitter CRC challenge response.
 * Twitter sends crc_token as a query param to verify webhook ownership.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const crcToken = searchParams.get('crc_token');

  if (!crcToken) {
    return NextResponse.json(
      { error: 'Missing crc_token parameter' },
      { status: 400 },
    );
  }

  const responseToken = handleCrcChallenge(crcToken);

  return NextResponse.json({ response_token: responseToken });
}

/**
 * POST: Twitter Account Activity webhook.
 * Receives DM events and stores them in the social-store.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // Validate webhook signature (skip in demo mode)
    if (!isTwitterDemoMode()) {
      const signature = request.headers.get('x-twitter-webhooks-signature') ?? '';
      if (!validateSignature(rawBody, signature)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
      }
    }

    const body = JSON.parse(rawBody);
    const dms = parseAccountActivity(body);

    for (const dm of dms) {
      // Find or create conversation
      let conversation = findByExternalUser('twitter', dm.senderId);
      if (!conversation) {
        conversation = createConversation(
          'twitter',
          dm.senderId,
          `X User ${dm.senderId.slice(-6)}`,
        );
      }

      // Add inbound message
      addMessage(conversation.id, 'inbound', dm.text, dm.id);
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('[Twitter Webhook] Error processing:', error);
    return NextResponse.json({ status: 'ok' });
  }
}
