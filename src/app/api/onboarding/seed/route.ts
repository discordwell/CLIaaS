import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { seedWorkspaceWithSampleData } from '@/lib/onboarding/seed-sample-data';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 }
    );
  }

  const { workspaceId, tenantId } = auth.user;
  if (!tenantId) {
    return NextResponse.json(
      { error: 'No tenant associated with this account' },
      { status: 400 }
    );
  }

  try {
    await seedWorkspaceWithSampleData({ tenantId, workspaceId });
    return NextResponse.json({ ok: true, message: 'Sample data loaded successfully' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to seed data';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
