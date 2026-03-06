import { NextResponse } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/tickets/[id]/collaborators — List collaborators on a ticket.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  const { id: ticketId } = await params;
  if (!UUID_RE.test(ticketId)) {
    return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ collaborators: [] });
  }

  try {
    const { db } = await import('@/db');
    const { ticketCollaborators, users } = await import('@/db/schema');
    const { eq, and } = await import('drizzle-orm');

    const rows = await db
      .select({
        id: ticketCollaborators.id,
        userId: ticketCollaborators.userId,
        canReply: ticketCollaborators.canReply,
        addedBy: ticketCollaborators.addedBy,
        createdAt: ticketCollaborators.createdAt,
        userName: users.name,
        userEmail: users.email,
        userRole: users.role,
      })
      .from(ticketCollaborators)
      .innerJoin(users, eq(users.id, ticketCollaborators.userId))
      .where(
        and(
          eq(ticketCollaborators.ticketId, ticketId),
          eq(ticketCollaborators.workspaceId, auth.user.workspaceId),
        ),
      );

    return NextResponse.json({ collaborators: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list collaborators';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/tickets/[id]/collaborators — Add a collaborator.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'tickets:update_assignee');
  if ('error' in auth) return auth.error;

  const { id: ticketId } = await params;
  if (!UUID_RE.test(ticketId)) {
    return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 });
  }

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;
  const { userId, email, canReply } = parsed.data;

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database required' }, { status: 503 });
  }

  // Resolve userId from email if needed
  let resolvedUserId = userId;
  if (!resolvedUserId && email) {
    try {
      const { db: dbInstance } = await import('@/db');
      const { users } = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');
      const [user] = await dbInstance
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, email), eq(users.workspaceId, auth.user.workspaceId)))
        .limit(1);
      if (user) resolvedUserId = user.id;
    } catch {
      // Fall through
    }
  }

  if (!resolvedUserId || !UUID_RE.test(resolvedUserId)) {
    return NextResponse.json({ error: 'Valid userId or email is required' }, { status: 400 });
  }

  try {
    const { db } = await import('@/db');
    const { ticketCollaborators } = await import('@/db/schema');

    const [created] = await db
      .insert(ticketCollaborators)
      .values({
        workspaceId: auth.user.workspaceId,
        ticketId,
        userId: resolvedUserId,
        addedBy: auth.user.id,
        canReply: canReply === true,
      })
      .onConflictDoNothing()
      .returning();

    if (!created) {
      return NextResponse.json({ message: 'User is already a collaborator' });
    }

    return NextResponse.json({ collaborator: created }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to add collaborator';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/tickets/[id]/collaborators — Remove a collaborator.
 * Expects { userId } or { collaboratorId } in the body.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'tickets:update_assignee');
  if ('error' in auth) return auth.error;

  const { id: ticketId } = await params;
  if (!UUID_RE.test(ticketId)) {
    return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 });
  }

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;
  const { userId, collaboratorId } = parsed.data;

  // Accept either userId or collaboratorId (record ID)
  const targetId = userId || collaboratorId;
  if (!targetId || !UUID_RE.test(targetId)) {
    return NextResponse.json({ error: 'Valid userId or collaboratorId is required' }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database required' }, { status: 503 });
  }

  try {
    const { db } = await import('@/db');
    const { ticketCollaborators } = await import('@/db/schema');
    const { eq, and, or } = await import('drizzle-orm');

    const [deleted] = await db
      .delete(ticketCollaborators)
      .where(
        and(
          eq(ticketCollaborators.ticketId, ticketId),
          or(eq(ticketCollaborators.userId, targetId), eq(ticketCollaborators.id, targetId)),
          eq(ticketCollaborators.workspaceId, auth.user.workspaceId),
        ),
      )
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: 'Collaborator not found' }, { status: 404 });
    }

    return NextResponse.json({ removed: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to remove collaborator';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
