import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { sendMessage } from '@/lib/channels/meta';
import { addMessage } from '@/lib/channels/social-store';
import { requireAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { recipientId, text, conversationId } = parsed.data as {
      recipientId: string;
      text: string;
      conversationId?: string;
    };

    if (!recipientId || !text) {
      return NextResponse.json(
        { error: 'Missing required fields: recipientId, text' },
        { status: 400 },
      );
    }

    const result = await sendMessage(recipientId, text, 'instagram');

    // Track outbound message if conversationId provided
    if (conversationId) {
      addMessage(conversationId, 'outbound', text, result.messageId);
    }

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
    });
  } catch (error) {
    console.error('[Instagram Send] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send message' },
      { status: 500 },
    );
  }
}
