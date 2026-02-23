import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listForms, createForm } from '@/lib/custom-fields';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const forms = listForms();
    return NextResponse.json({ forms });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list forms' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { name, fields, ticketType } = parsed.data;

    if (!name || !fields || !Array.isArray(fields)) {
      return NextResponse.json(
        { error: 'name and fields (array) are required' },
        { status: 400 }
      );
    }

    const form = createForm({
      name,
      fields,
      ticketType: ticketType ?? '',
    });

    return NextResponse.json({ form }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create form' },
      { status: 500 }
    );
  }
}
