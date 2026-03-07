import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listFields, createField } from '@/lib/custom-fields';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  try {
    const fields = listFields();
    return NextResponse.json({ fields });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to list fields') },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { name, key, type, required, options, conditions, sortOrder } = parsed.data;

    if (!name || !key || !type) {
      return NextResponse.json(
        { error: 'name, key, and type are required' },
        { status: 400 }
      );
    }

    if (!['text', 'number', 'select', 'checkbox', 'date'].includes(type)) {
      return NextResponse.json(
        { error: 'type must be text, number, select, checkbox, or date' },
        { status: 400 }
      );
    }

    const field = createField({
      name,
      key,
      type,
      required: required ?? false,
      options: options ?? [],
      conditions: conditions ?? {},
      sortOrder: sortOrder ?? 0,
    });

    return NextResponse.json({ field }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create field') },
      { status: 500 }
    );
  }
}
