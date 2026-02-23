import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getApproval,
  approveEntry,
  rejectEntry,
  editEntry,
} from '@/lib/ai/approval-queue';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const entry = getApproval(id);
  if (!entry) {
    return NextResponse.json({ error: 'Approval entry not found' }, { status: 404 });
  }
  return NextResponse.json({ entry });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const { action, editedReply, reviewedBy } = body as {
      action?: 'approve' | 'reject' | 'edit';
      editedReply?: string;
      reviewedBy?: string;
    };

    const reviewer = reviewedBy ?? 'agent';

    let result;
    switch (action) {
      case 'approve':
        result = approveEntry(id, reviewer);
        break;
      case 'reject':
        result = rejectEntry(id, reviewer);
        break;
      case 'edit':
        if (!editedReply) {
          return NextResponse.json({ error: 'editedReply is required for edit action' }, { status: 400 });
        }
        result = editEntry(id, editedReply, reviewer);
        break;
      default:
        return NextResponse.json({ error: 'action must be approve, reject, or edit' }, { status: 400 });
    }

    if (!result) {
      return NextResponse.json({ error: 'Entry not found or already processed' }, { status: 404 });
    }

    return NextResponse.json({ entry: result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Update failed' },
      { status: 500 },
    );
  }
}
