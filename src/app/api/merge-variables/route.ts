import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { MERGE_VARIABLE_CATALOG } from '@/lib/canned/merge';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  return NextResponse.json({ variables: MERGE_VARIABLE_CATALOG });
}
