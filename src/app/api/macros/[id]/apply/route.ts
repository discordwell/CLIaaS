import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireAuth } from '@/lib/api-auth';
import { getMacro, incrementMacroUsage, type MacroAction } from '@/lib/canned/macro-store';
import { executeMacroActions } from '@/lib/canned/macro-executor';
import type { MergeContext } from '@/lib/canned/merge';
import { loadTickets, loadMessages } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const parsed = await parseJsonBody<{ ticketId: string }>(request);
  if ('error' in parsed) return parsed.error;

  const { ticketId } = parsed.data;
  if (!ticketId) {
    return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
  }

  try {
    // Try DB-backed macros first
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');

      const [macroRow] = await db.select().from(schema.nativeMacros)
        .where(and(eq(schema.nativeMacros.id, id), eq(schema.nativeMacros.workspaceId, auth.user.workspaceId)))
        .limit(1);

      if (!macroRow) {
        return NextResponse.json({ error: 'Macro not found' }, { status: 404 });
      }

      const [ticketRow] = await db.select().from(schema.tickets)
        .where(and(eq(schema.tickets.id, ticketId), eq(schema.tickets.workspaceId, auth.user.workspaceId)))
        .limit(1);

      if (!ticketRow) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
      }

      const mergeContext: MergeContext = {
        ticket: { id: ticketRow.id, subject: ticketRow.subject ?? '', status: ticketRow.status ?? 'open', priority: ticketRow.priority ?? 'normal' },
        agent: { name: auth.user.name ?? auth.user.email, email: auth.user.email },
      };

      const ticketCtx = {
        id: ticketRow.id,
        status: ticketRow.status ?? 'open',
        priority: ticketRow.priority ?? 'normal',
        assignee: ticketRow.assigneeId ?? null,
        tags: (ticketRow.tags as string[]) ?? [],
      };

      const result = executeMacroActions(macroRow.actions as MacroAction[], ticketCtx, mergeContext);

      // Persist ticket changes
      if (Object.keys(result.changes).length > 0) {
        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (result.changes.status) updates.status = result.changes.status;
        if (result.changes.priority) updates.priority = result.changes.priority;
        if (result.changes.assignee !== undefined) updates.assignee = result.changes.assignee;
        if (result.changes.addTags || result.changes.removeTags) updates.tags = ticketCtx.tags;
        await db.update(schema.tickets).set(updates).where(eq(schema.tickets.id, ticketId));
      }

      // Increment usage
      await db.update(schema.nativeMacros)
        .set({ usageCount: (macroRow.usageCount ?? 0) + 1, updatedAt: new Date() })
        .where(eq(schema.nativeMacros.id, id));

      return NextResponse.json({
        applied: true,
        macroId: macroRow.id,
        macroName: macroRow.name,
        ticketId,
        changes: result.changes,
        actionsExecuted: result.actionsExecuted,
        replies: result.replies,
        notes: result.notes,
        errors: result.errors,
      });
    }

    // JSONL fallback
    const macro = getMacro(id);
    if (!macro) {
      return NextResponse.json({ error: 'Macro not found' }, { status: 404 });
    }

    const tickets = await loadTickets();
    const ticket = tickets.find(t => t.id === ticketId || t.externalId === ticketId);
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const mergeContext: MergeContext = {
      ticket: { id: ticket.id, subject: ticket.subject, status: ticket.status, priority: ticket.priority },
      agent: { name: auth.user.name ?? auth.user.email, email: auth.user.email },
      customer: { name: ticket.requester, email: ticket.requester },
    };

    const ticketCtx = {
      id: ticket.id,
      status: ticket.status,
      priority: ticket.priority,
      assignee: ticket.assignee ?? null,
      tags: [...ticket.tags],
    };

    const result = executeMacroActions(macro.actions, ticketCtx, mergeContext);
    incrementMacroUsage(id);

    return NextResponse.json({
      applied: true,
      macroId: macro.id,
      macroName: macro.name,
      ticketId: ticket.id,
      changes: result.changes,
      actionsExecuted: result.actionsExecuted,
      replies: result.replies,
      notes: result.notes,
      errors: result.errors,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to apply macro' },
      { status: 500 },
    );
  }
}
