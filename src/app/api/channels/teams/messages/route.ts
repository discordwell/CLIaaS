import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  verifyTeamsToken,
  getTeamsConfig,
  getTeamsToken,
  sendTeamsMessage,
  findTeamsConversation,
  createTeamsConversation,
  addTeamsMessage,
} from '@/lib/channels/teams-intake';

export const dynamic = 'force-dynamic';

interface BotFrameworkActivity {
  type: string;
  id: string;
  timestamp: string;
  serviceUrl: string;
  channelId: string;
  conversation: {
    id: string;
    tenantId?: string;
  };
  from: {
    id: string;
    name?: string;
    aadObjectId?: string;
  };
  recipient?: {
    id: string;
    name?: string;
  };
  text?: string;
  membersAdded?: Array<{
    id: string;
    name?: string;
  }>;
}

export async function POST(request: NextRequest) {
  // Verify Bot Framework token
  const authHeader = request.headers.get('authorization') ?? '';
  const isValid = await verifyTeamsToken(authHeader);

  if (!isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let activity: BotFrameworkActivity;
  try {
    activity = await request.json() as BotFrameworkActivity;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const config = getTeamsConfig();

  // Handle message activity
  if (activity.type === 'message' && activity.text) {
    const conversationId = activity.conversation.id;

    // Find or create conversation
    let conversation = findTeamsConversation(conversationId);
    if (!conversation) {
      conversation = createTeamsConversation(
        conversationId,
        activity.serviceUrl,
        activity.from.name,
        activity.conversation.tenantId,
      );
    }

    // Add the inbound message
    addTeamsMessage(conversation.id, 'inbound', activity.text, activity.id);

    // Send an acknowledgment reply if config is available
    if (config) {
      try {
        const token = await getTeamsToken(config.appId, config.appPassword);
        await sendTeamsMessage(
          activity.serviceUrl,
          conversationId,
          activity.id,
          `Thank you for your message. A support ticket has been created. We will get back to you shortly.`,
          token,
        );
      } catch {
        // Failed to send reply — log but don't error
      }
    }

    return NextResponse.json({}, { status: 200 });
  }

  // Handle conversationUpdate (welcome message)
  if (activity.type === 'conversationUpdate' && activity.membersAdded) {
    const botId = activity.recipient?.id;

    // Check if the bot itself was added
    const botAdded = activity.membersAdded.some(m => m.id === botId);

    if (botAdded && config) {
      try {
        const token = await getTeamsToken(config.appId, config.appPassword);
        await sendTeamsMessage(
          activity.serviceUrl,
          activity.conversation.id,
          activity.id,
          `Hello! I am the CLIaaS support bot. Send me a message and I will create a support ticket for you.`,
          token,
        );
      } catch {
        // Failed to send welcome — log but don't error
      }
    }

    return NextResponse.json({}, { status: 200 });
  }

  // Acknowledge all other activity types
  return NextResponse.json({}, { status: 200 });
}
