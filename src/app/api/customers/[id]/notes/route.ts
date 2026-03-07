import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import {
  getCustomerNotes,
  addCustomerNote,
} from '@/lib/customers/customer-store';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'customers:view');
  if ('error' in auth) return auth.error;

  try {
    const { id } = await params;
    const notes = await getCustomerNotes(id);

    return NextResponse.json({ notes });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to load notes') },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'customers:edit');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { id } = await params;
    const { noteType, body, authorId } = parsed.data;

    if (!body) {
      return NextResponse.json(
        { error: 'body is required' },
        { status: 400 },
      );
    }

    const note = addCustomerNote({
      customerId: id,
      noteType: noteType ?? 'note',
      body,
      authorId: authorId ?? auth.user.id,
    });

    return NextResponse.json({ note }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create note') },
      { status: 500 },
    );
  }
}
