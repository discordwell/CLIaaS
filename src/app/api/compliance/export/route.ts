import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { exportUserData } from '@/lib/compliance';
import { exportUserDataFromDb } from '@/lib/compliance/gdpr-db';
import { requireRole } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { recordAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { userId } = parsed.data;

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    // Use DB export when available, fallback to demo
    let data;
    if (process.env.DATABASE_URL && auth.user.workspaceId) {
      data = await exportUserDataFromDb(userId, auth.user.workspaceId);
    } else {
      data = await exportUserData(userId);
    }

    // Audit the export operation
    await recordAudit({
      userId: auth.user.id,
      userName: auth.user.email,
      action: 'compliance.export',
      resource: 'user_data',
      resourceId: userId,
      details: { format: 'json' },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      workspaceId: auth.user.workspaceId,
    });

    const jsonStr = JSON.stringify(data, null, 2);
    return new NextResponse(jsonStr, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="gdpr-export-${userId}-${Date.now()}.json"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to export user data' },
      { status: 500 }
    );
  }
}
