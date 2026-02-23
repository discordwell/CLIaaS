import { NextResponse } from 'next/server';
import { isMetaDemoMode } from '@/lib/channels/meta';
import { isTwitterDemoMode } from '@/lib/channels/twitter';
import { getAllConversations } from '@/lib/channels/social-store';

export const dynamic = 'force-dynamic';

export async function GET() {
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
