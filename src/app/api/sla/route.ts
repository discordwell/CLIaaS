import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listPolicies, createPolicy } from '@/lib/sla';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'automation:view');
  if ('error' in auth) return auth.error;

  try {
    // Scope by workspace to prevent cross-workspace data leakage
    const policies = await listPolicies(auth.user.workspaceId);
    return NextResponse.json({ policies });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to load SLA policies') },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  try {
    const parsed = await parseJsonBody<{
      name?: string;
      conditions?: { priority?: string[]; tags?: string[]; source?: string[] };
      targets?: { firstResponse?: number; resolution?: number };
      escalation?: Array<{ afterMinutes: number; action: 'notify' | 'escalate' | 'reassign'; to?: string }>;
      businessHoursId?: string;
      enabled?: boolean;
    }>(request);
    if ('error' in parsed) return parsed.error;
    const { name, conditions, targets, escalation, businessHoursId, enabled } = parsed.data;

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: 'name is required' },
        { status: 400 }
      );
    }

    if (!targets?.firstResponse || !targets?.resolution) {
      return NextResponse.json(
        { error: 'targets.firstResponse and targets.resolution are required (in minutes)' },
        { status: 400 }
      );
    }

    if (targets.firstResponse <= 0 || targets.resolution <= 0) {
      return NextResponse.json(
        { error: 'Target times must be positive numbers' },
        { status: 400 }
      );
    }

    // Scope by workspace to prevent cross-workspace data leakage
    const policy = await createPolicy({
      name: name.trim(),
      conditions: conditions ?? {},
      targets: {
        firstResponse: targets.firstResponse,
        resolution: targets.resolution,
      },
      escalation: escalation ?? [],
      businessHoursId: businessHoursId || undefined,
      enabled: enabled ?? true,
    }, auth.user.workspaceId);

    return NextResponse.json({ policy }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create SLA policy') },
      { status: 500 }
    );
  }
}
