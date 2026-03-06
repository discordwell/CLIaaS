/**
 * Notification dispatch — creates DB records + SSE events for mentions, assignments, etc.
 */

import { eventBus } from './realtime/events';
import { createLogger } from './logger';

const logger = createLogger('notifications');

export interface DispatchMentionParams {
  messageId: string;
  ticketId: string;
  mentionedUserIds: string[];
  authorName: string;
  notePreview: string;
  workspaceId: string;
}

export async function dispatchMentionNotifications(params: DispatchMentionParams): Promise<void> {
  const { messageId, ticketId, mentionedUserIds, authorName, notePreview, workspaceId } = params;

  if (mentionedUserIds.length === 0) return;

  try {
    const { db } = await import('@/db');
    const schema = await import('@/db/schema');

    // Insert mentions
    await db.insert(schema.mentions).values(
      mentionedUserIds.map((userId) => ({
        messageId,
        mentionedUserId: userId,
        workspaceId,
      })),
    );

    // Insert notifications
    const title = `${authorName} mentioned you`;
    const body = notePreview.length > 200 ? notePreview.slice(0, 200) + '...' : notePreview;

    await db.insert(schema.notifications).values(
      mentionedUserIds.map((userId) => ({
        workspaceId,
        userId,
        type: 'mention' as const,
        title,
        body,
        resourceType: 'ticket',
        resourceId: ticketId,
      })),
    );

    // Emit SSE notification events
    for (const userId of mentionedUserIds) {
      eventBus.emit({
        type: 'notification',
        data: {
          userId,
          notificationType: 'mention',
          ticketId,
          messageId,
          authorName,
          preview: body,
        },
        timestamp: Date.now(),
        workspaceId,
      });
    }

    // Optionally email mentioned agents
    try {
      const { eq, inArray } = await import('drizzle-orm');
      const userRows = await db
        .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
        .from(schema.users)
        .where(inArray(schema.users.id, mentionedUserIds));

      const { sendNotification } = await import('./email/sender');
      for (const user of userRows) {
        if (!user.email) continue;
        void sendNotification({
          to: user.email,
          template: 'mention',
          data: {
            authorName,
            ticketId,
            notePreview: body,
            subject: `mentioned you in a note on ticket`,
          },
        }).catch((err) => {
          logger.error({ userId: user.id, error: err instanceof Error ? err.message : 'Unknown' }, 'Failed to send mention email');
        });
      }
    } catch {
      // Email sending is best-effort
    }
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : 'Unknown' }, 'Failed to dispatch mention notifications');
  }
}
