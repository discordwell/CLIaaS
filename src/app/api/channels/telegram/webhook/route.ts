import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyWebhookSecret } from '@/lib/channels/telegram';
import {
  getTelegramConfig,
  findConversationByChatId,
  createConversation,
  addMessage,
} from '@/lib/channels/telegram-store';

export const dynamic = 'force-dynamic';

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    text?: string;
    date: number;
  };
}

export async function POST(request: NextRequest) {
  const config = getTelegramConfig();

  if (!config) {
    return NextResponse.json({ error: 'Telegram not configured' }, { status: 503 });
  }

  // Verify webhook secret
  if (!verifyWebhookSecret(request, config.webhookSecret)) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await request.json() as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Only process text messages
  const message = update.message;
  if (!message?.text) {
    return NextResponse.json({ ok: true });
  }

  const chatId = String(message.chat.id);
  const customerName = [message.from?.first_name, message.from?.last_name]
    .filter(Boolean)
    .join(' ') || message.from?.username || `User ${chatId}`;

  // Find or create conversation
  let conversation = findConversationByChatId(chatId);
  if (!conversation) {
    conversation = createConversation(chatId, customerName);
  }

  // Add the inbound message
  addMessage(conversation.id, 'inbound', message.text, message.message_id);

  // Respond 200 to acknowledge the update
  return NextResponse.json({ ok: true });
}
