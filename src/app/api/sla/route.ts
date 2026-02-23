import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listPolicies, createPolicy } from '@/lib/sla';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const policies = await listPolicies();
    return NextResponse.json({ policies });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load SLA policies' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody<{
      name?: string;
      conditions?: { priority?: string[]; tags?: string[]; source?: string[] };
      targets?: { firstResponse?: number; resolution?: number };
      escalation?: Array<{ afterMinutes: number; action: 'notify' | 'escalate' | 'reassign'; to?: string }>;
      enabled?: boolean;
    }>(request);
    if ('error' in parsed) return parsed.error;
    const { name, conditions, targets, escalation, enabled } = parsed.data;

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

    const policy = await createPolicy({
      name: name.trim(),
      conditions: conditions ?? {},
      targets: {
        firstResponse: targets.firstResponse,
        resolution: targets.resolution,
      },
      escalation: escalation ?? [],
      enabled: enabled ?? true,
    });

    return NextResponse.json({ policy }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create SLA policy' },
      { status: 500 }
    );
  }
}
