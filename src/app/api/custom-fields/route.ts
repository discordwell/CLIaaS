import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listFields, createField } from '@/lib/custom-fields';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const fields = listFields();
    return NextResponse.json({ fields });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list fields' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, key, type, required, options, conditions, sortOrder } = body;

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
      { error: err instanceof Error ? err.message : 'Failed to create field' },
      { status: 500 }
    );
  }
}
