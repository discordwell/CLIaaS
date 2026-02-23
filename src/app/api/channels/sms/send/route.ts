import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { sendMessage as twilioSend } from '@/lib/channels/twilio';
import { addMessage } from '@/lib/channels/sms-store';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const { to, body: messageBody, channel, conversationId } = body as {
      to: string;
      body: string;
      channel: 'sms' | 'whatsapp';
      conversationId?: string;
    };

    if (!to || !messageBody || !channel) {
      return NextResponse.json(
        { error: 'Missing required fields: to, body, channel' },
        { status: 400 },
      );
    }

    if (channel !== 'sms' && channel !== 'whatsapp') {
      return NextResponse.json(
        { error: 'Channel must be "sms" or "whatsapp"' },
        { status: 400 },
      );
    }

    // Send via Twilio (or mock in demo mode)
    const result = await twilioSend({ to, body: messageBody, channel });

    // If conversationId provided, track the outbound message
    if (conversationId) {
      addMessage(conversationId, 'outbound', messageBody, result.sid);
    }

    return NextResponse.json({
      success: true,
      sid: result.sid,
      message: result,
    });
  } catch (error) {
    console.error('[SMS Send] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send message' },
      { status: 500 },
    );
  }
}
