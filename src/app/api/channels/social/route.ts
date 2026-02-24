import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isMetaDemoMode } from '@/lib/channels/meta';
import { isTwitterDemoMode } from '@/lib/channels/twitter';
import { getAllConversations } from '@/lib/channels/social-store';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const conversations = getAllConversations();

  return NextResponse.json({
    conversations,
    platforms: {
      facebook: { demo: isMetaDemoMode() },
      instagram: { demo: isMetaDemoMode() },
      twitter: { demo: isTwitterDemoMode() },
    },
  });
}
