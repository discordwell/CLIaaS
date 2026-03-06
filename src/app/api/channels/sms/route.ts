import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isDemoMode, getConfig } from '@/lib/channels/twilio';
import { getAllConversations } from '@/lib/channels/sms-store';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'channels:view');
  if ('error' in auth) return auth.error;

  // Scope by workspace to prevent cross-workspace data leakage
  const conversations = getAllConversations(auth.user.workspaceId);
  const config = getConfig();
  const demo = isDemoMode();

  return NextResponse.json({
    conversations,
    config: {
      demo,
      phoneNumber: config?.phoneNumber ?? '+15005550006',
      whatsappNumber: config?.whatsappNumber ?? 'whatsapp:+15005550006',
    },
  });
}
