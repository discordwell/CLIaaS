import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listRetentionPolicies, createRetentionPolicy } from '@/lib/compliance';
import { requireRole } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const policies = listRetentionPolicies();
    return NextResponse.json({ policies });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list retention policies' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { resource, retentionDays, action } = parsed.data;

    if (!resource || !retentionDays || !action) {
      return NextResponse.json(
        { error: 'resource, retentionDays, and action are required' },
        { status: 400 }
      );
    }

    if (!['delete', 'archive'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be "delete" or "archive"' },
        { status: 400 }
      );
    }

    const policy = createRetentionPolicy({
      resource,
      retentionDays: parseInt(retentionDays, 10),
      action,
    });

    return NextResponse.json({ policy }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create retention policy' },
      { status: 500 }
    );
  }
}
