import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { deleteUserData } from '@/lib/compliance';
import { deleteUserDataFromDb } from '@/lib/compliance/gdpr-db';
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
    const { userId, subjectEmail, confirmDelete } = parsed.data;

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    if (!confirmDelete) {
      return NextResponse.json(
        { error: 'confirmDelete: true is required to proceed with data deletion' },
        { status: 400 }
      );
    }

    let result;
    if (process.env.DATABASE_URL && auth.user.workspaceId) {
      result = await deleteUserDataFromDb(
        userId,
        auth.user.workspaceId,
        auth.user.id,
        subjectEmail || userId,
      );
    } else {
      const demoResult = await deleteUserData(userId);
      result = {
        requestId: `demo-${Date.now()}`,
        status: 'completed',
        recordsAffected: {
          customersAnonymized: demoResult.anonymizedTickets,
          messagesRedacted: demoResult.anonymizedMessages,
          csatDeleted: 0,
          timeEntriesDeleted: 0,
        },
      };
    }

    // Audit the deletion
    await recordAudit({
      userId: auth.user.id,
      userName: auth.user.email,
      action: 'compliance.delete',
      resource: 'user_data',
      resourceId: userId,
      details: { subjectEmail, result },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      workspaceId: auth.user.workspaceId,
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete user data' },
      { status: 500 }
    );
  }
}
