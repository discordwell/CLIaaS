import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { sendDM } from '@/lib/channels/twitter';
import { addMessage } from '@/lib/channels/social-store';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const { recipientId, text, conversationId } = body as {
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

    const result = await sendDM(recipientId, text);

    // Track outbound message if conversationId provided
    if (conversationId) {
      addMessage(conversationId, 'outbound', text, result.id);
    }

    return NextResponse.json({
      success: true,
      id: result.id,
    });
  } catch (error) {
    console.error('[Twitter Send] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send message' },
      { status: 500 },
    );
  }
}
