import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { getSensitivityRules, upsertSensitivityRules } from '@/lib/compliance/pii-rules';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  try {
    const rules = await getSensitivityRules(auth.user.workspaceId);
    return NextResponse.json({ rules });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to get sensitivity rules') },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { rules } = parsed.data;

    if (!rules || !Array.isArray(rules) || rules.length === 0) {
      return NextResponse.json(
        { error: 'rules must be a non-empty array' },
        { status: 400 },
      );
    }

    const result = await upsertSensitivityRules(auth.user.workspaceId, rules);
    return NextResponse.json({ rules: result });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to upsert sensitivity rules') },
      { status: 500 },
    );
  }
}
