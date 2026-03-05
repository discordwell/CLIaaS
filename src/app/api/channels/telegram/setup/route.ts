import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getMe, setWebhook } from '@/lib/channels/telegram';
import { saveTelegramConfig } from '@/lib/channels/telegram-store';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    botToken: string;
    webhookUrl?: string;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { botToken, webhookUrl } = parsed.data;

  if (!botToken) {
    return NextResponse.json({ error: 'botToken is required' }, { status: 400 });
  }

  // Verify the bot token by calling getMe
  const meResult = await getMe(botToken) as { ok?: boolean; result?: { username?: string } };

  if (!meResult.ok) {
    return NextResponse.json({ error: 'Invalid bot token — getMe failed' }, { status: 400 });
  }

  const botUsername = meResult.result?.username;
  const webhookSecret = crypto.randomBytes(32).toString('hex');

  // If a webhook URL was provided, register it with Telegram
  if (webhookUrl) {
    const webhookResult = await setWebhook(botToken, webhookUrl, webhookSecret) as { ok?: boolean; description?: string };
    if (!webhookResult.ok) {
      return NextResponse.json(
        { error: `Failed to set webhook: ${webhookResult.description ?? 'Unknown error'}` },
        { status: 400 },
      );
    }
  }

  // Save the config
  const config = saveTelegramConfig({
    botToken,
    botUsername,
    webhookSecret,
    workspaceId: auth.user.workspaceId,
  });

  return NextResponse.json({
    success: true,
    botUsername,
    webhookSecret,
    configId: config.id,
    webhookRegistered: !!webhookUrl,
  });
}
