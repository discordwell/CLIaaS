import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { requirePermission } from '@/lib/rbac/check';
import { isRbacEnabled } from '@/lib/rbac/feature-flag';
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
  const auth = isRbacEnabled()
    ? await requirePermission(request, 'tickets:view')
    : await requireAuth(request);
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
  const auth = isRbacEnabled()
    ? await requirePermission(request, 'tickets:update_assignee')
    : await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id: ticketId } = await params;
  if (!UUID_RE.test(ticketId)) {
    return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 });
  }

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;
  const { userId, canReply } = parsed.data;

  if (!userId || !UUID_RE.test(userId)) {
    return NextResponse.json({ error: 'Valid userId is required' }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database required' }, { status: 503 });
  }

  try {
    const { db } = await import('@/db');
    const { ticketCollaborators } = await import('@/db/schema');

    const [created] = await db
      .insert(ticketCollaborators)
      .values({
        workspaceId: auth.user.workspaceId,
        ticketId,
        userId,
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
 * Expects { userId } in the body.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = isRbacEnabled()
    ? await requirePermission(request, 'tickets:update_assignee')
    : await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id: ticketId } = await params;
  if (!UUID_RE.test(ticketId)) {
    return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 });
  }

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;
  const { userId } = parsed.data;

  if (!userId || !UUID_RE.test(userId)) {
    return NextResponse.json({ error: 'Valid userId is required' }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database required' }, { status: 503 });
  }

  try {
    const { db } = await import('@/db');
    const { ticketCollaborators } = await import('@/db/schema');
    const { eq, and } = await import('drizzle-orm');

    const [deleted] = await db
      .delete(ticketCollaborators)
      .where(
        and(
          eq(ticketCollaborators.ticketId, ticketId),
          eq(ticketCollaborators.userId, userId),
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
