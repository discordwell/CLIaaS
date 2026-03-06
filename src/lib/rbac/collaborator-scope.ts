/**
 * Collaborator scoping — restricts collaborator-role users
 * to only see tickets they've been explicitly added to.
 */

import { eq, and } from 'drizzle-orm';

/**
 * Check if a collaborator user can access a specific ticket.
 */
export async function canCollaboratorAccessTicket(
  userId: string,
  ticketId: string,
  workspaceId: string,
): Promise<boolean> {
  if (!process.env.DATABASE_URL) return true; // demo mode

  try {
    const { db } = await import('@/db');
    const { ticketCollaborators } = await import('@/db/schema');

    const rows = await db
      .select({ id: ticketCollaborators.id })
      .from(ticketCollaborators)
      .where(
        and(
          eq(ticketCollaborators.userId, userId),
          eq(ticketCollaborators.ticketId, ticketId),
          eq(ticketCollaborators.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get all ticket IDs a collaborator can access.
 */
export async function getCollaboratorTicketIds(
  userId: string,
  workspaceId: string,
): Promise<string[]> {
  if (!process.env.DATABASE_URL) return []; // demo mode

  try {
    const { db } = await import('@/db');
    const { ticketCollaborators } = await import('@/db/schema');

    const rows = await db
      .select({ ticketId: ticketCollaborators.ticketId })
      .from(ticketCollaborators)
      .where(
        and(
          eq(ticketCollaborators.userId, userId),
          eq(ticketCollaborators.workspaceId, workspaceId),
        ),
      );

    return rows.map(r => r.ticketId);
  } catch {
    return [];
  }
}
