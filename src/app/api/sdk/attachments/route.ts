import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateSession, updateSessionActivity } from '@/lib/channels/sdk-session';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sdk/attachments — Upload a file attachment (stub).
 * Returns a mock URL for now; real implementation would store to S3/GCS.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');

  if (!token) {
    return NextResponse.json(
      { error: 'SDK session token required' },
      { status: 401 },
    );
  }

  const session = validateSession(token);
  if (!session) {
    return NextResponse.json(
      { error: 'Invalid or expired session token' },
      { status: 401 },
    );
  }

  updateSessionActivity(session.id);

  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: 'File is required (multipart form field "file")' },
        { status: 400 },
      );
    }

    // Stub: generate a mock attachment ID and URL
    const attachmentId = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const mockUrl = `/api/sdk/attachments/${attachmentId}/${encodeURIComponent(file.name)}`;

    return NextResponse.json(
      { id: attachmentId, url: mockUrl },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to upload attachment' },
      { status: 500 },
    );
  }
}
