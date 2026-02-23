import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  parseInbound,
  validateSignature,
  generateTwiml,
  isDemoMode,
} from '@/lib/channels/twilio';
import {
  findByPhone,
  createConversation,
  addMessage,
} from '@/lib/channels/sms-store';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const inbound = parseInbound(formData);

    // Validate Twilio signature (skip in demo mode)
    if (!isDemoMode()) {
      const signature = request.headers.get('X-Twilio-Signature') ?? '';
      const url = request.url;
      const params: Record<string, string> = {};
      formData.forEach((value, key) => {
        params[key] = value.toString();
      });

      if (!validateSignature(url, params, signature)) {
        return new Response('Forbidden', { status: 403 });
      }
    }

    // Determine channel from phone number format
    const isWhatsApp = inbound.From.startsWith('whatsapp:');
    const channel: 'sms' | 'whatsapp' = isWhatsApp ? 'whatsapp' : 'sms';
    const phoneNumber = inbound.From.replace(/^whatsapp:/, '');

    // Find or create conversation
    let conversation = findByPhone(phoneNumber);
    if (!conversation) {
      conversation = createConversation(phoneNumber, channel);

      // Create a ticket stub in the data store for new conversations
      // (Ticket creation is left to the main ticket system; we just link via ticketId)
    }

    // Add inbound message
    addMessage(
      conversation.id,
      'inbound',
      inbound.Body,
      inbound.MessageSid,
    );

    // Return TwiML response
    return new Response(generateTwiml(), {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    });
  } catch (error) {
    console.error('[SMS Inbound] Error processing webhook:', error);
    // Return empty TwiML on error so Twilio doesn't retry
    return new Response(generateTwiml(), {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    });
  }
}
