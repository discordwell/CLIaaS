import { NextResponse } from 'next/server';
import { isDemoMode, getConfig } from '@/lib/channels/twilio';
import { getAllConversations } from '@/lib/channels/sms-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const conversations = getAllConversations();
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
