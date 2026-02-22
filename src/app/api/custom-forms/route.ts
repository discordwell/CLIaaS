import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listForms, createForm } from '@/lib/custom-fields';

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
  try {
    const body = await request.json();
    const { name, fields, ticketType } = body;

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
