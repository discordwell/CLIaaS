/**
 * Shared collision-check utility.
 * Checks for new replies on a ticket since a given timestamp.
 */

import type { Message } from '@/lib/data-provider/types';

export interface CollisionReply {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  type?: string;
}

export interface CollisionCheckResult {
  hasNewReplies: boolean;
  newReplies: CollisionReply[];
}

/**
 * Check for new replies on a ticket since a given date.
 * Uses `loadMessagesSince` if the provider supports it, otherwise falls back
 * to `loadMessages` + client-side filter.
 */
export async function checkForNewReplies(
  ticketId: string,
  since: Date,
  dir?: string,
): Promise<CollisionCheckResult> {
  const { getDataProvider } = await import('@/lib/data-provider/index');
  const provider = await getDataProvider(dir);

  let messages: Message[];
  if (provider.loadMessagesSince) {
    messages = await provider.loadMessagesSince(ticketId, since);
  } else {
    const all = await provider.loadMessages(ticketId);
    messages = all.filter(
      (m) => new Date(m.createdAt).getTime() > since.getTime(),
    );
  }

  return {
    hasNewReplies: messages.length > 0,
    newReplies: messages.map((m) => ({
      id: m.id,
      author: m.author,
      body: m.body.slice(0, 200),
      createdAt: m.createdAt,
      type: m.type,
    })),
  };
}
