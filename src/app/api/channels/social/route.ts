import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isMetaDemoMode } from '@/lib/channels/meta';
import { isTwitterDemoMode } from '@/lib/channels/twitter';
import { getAllConversations } from '@/lib/channels/social-store';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'channels:view');
  if ('error' in auth) return auth.error;

  // Scope by workspace to prevent cross-workspace data leakage
  const conversations = getAllConversations(auth.user.workspaceId);

  return NextResponse.json({
    conversations,
    platforms: {
      facebook: { demo: isMetaDemoMode() },
      instagram: { demo: isMetaDemoMode() },
      twitter: { demo: isTwitterDemoMode() },
    },
  });
}
