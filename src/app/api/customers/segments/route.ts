import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import {
  getCustomerSegments,
  createCustomerSegment,
} from '@/lib/customers/customer-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'customers:view');
  if ('error' in auth) return auth.error;

  try {
    const segments = await getCustomerSegments(auth.user.workspaceId);
    return NextResponse.json({ segments });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to load segments') },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'customers:edit');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { name, description, query } = parsed.data;

    if (!name) {
      return NextResponse.json(
        { error: 'name is required' },
        { status: 400 },
      );
    }

    const segment = createCustomerSegment({
      name,
      description: description ?? undefined,
      query: query ?? {},
      customerCount: 0,
      createdBy: auth.user.id,
    });

    return NextResponse.json({ segment }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create segment') },
      { status: 500 },
    );
  }
}
