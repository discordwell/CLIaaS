import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getTelegramConfig, getAllConversations } from '@/lib/channels/telegram-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const config = getTelegramConfig(auth.user.workspaceId);
  const conversations = getAllConversations();

  return NextResponse.json({
    configured: !!config,
    botUsername: config?.botUsername ?? null,
    conversations,
    totalConversations: conversations.length,
  });
}
