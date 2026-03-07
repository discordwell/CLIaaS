/**
 * AI Admin Controls API — channel policies, circuit breaker, audit trail, usage reporting.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import {
  getChannelPolicies, setChannelPolicy,
  getCircuitBreakerStatus, resetCircuitBreaker,
  getAuditTrail,
  getUsageSummary, getUsageReport,
} from '@/lib/ai/admin-controls';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings');
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const view = searchParams.get('view') ?? 'overview';

  switch (view) {
    case 'channel-policies':
      return NextResponse.json({ policies: getChannelPolicies() });

    case 'circuit-breaker':
      return NextResponse.json({ circuitBreaker: getCircuitBreakerStatus() });

    case 'audit': {
      const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 500);
      const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10), 0);
      const action = searchParams.get('action') ?? undefined;
      const ticketId = searchParams.get('ticketId') ?? undefined;
      const result = getAuditTrail({
        workspaceId: auth.user.workspaceId,
        action,
        ticketId,
        limit,
        offset,
      });
      return NextResponse.json(result);
    }

    case 'usage': {
      const from = searchParams.get('from') ?? undefined;
      const to = searchParams.get('to') ?? undefined;
      const summary = getUsageSummary(auth.user.workspaceId, { from, to });
      const report = getUsageReport(auth.user.workspaceId, { from, to });
      return NextResponse.json({ summary, hourly: report });
    }

    default: {
      // Overview: all admin surfaces in one response
      const policies = getChannelPolicies();
      const circuitBreaker = getCircuitBreakerStatus();
      const usage = getUsageSummary(auth.user.workspaceId);
      const { entries: recentAudit, total: auditTotal } = getAuditTrail({
        workspaceId: auth.user.workspaceId,
        limit: 10,
      });
      return NextResponse.json({
        channelPolicies: policies,
        circuitBreaker,
        usage,
        recentAudit,
        auditTotal,
      });
    }
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<Record<string, unknown>>(request);
  if ('error' in parsed) return parsed.error;

  const { action } = parsed.data;

  switch (action) {
    case 'set_channel_policy': {
      const policy = parsed.data.policy as Record<string, unknown>;
      if (!policy?.channel) {
        return NextResponse.json({ error: 'channel is required' }, { status: 400 });
      }
      const result = setChannelPolicy({
        channel: policy.channel as string,
        enabled: (policy.enabled as boolean) ?? true,
        mode: (policy.mode as 'suggest' | 'approve' | 'auto') ?? 'suggest',
        maxAutoResolvesPerHour: (policy.maxAutoResolvesPerHour as number) ?? 50,
        confidenceThreshold: (policy.confidenceThreshold as number) ?? 0.7,
        excludedTopics: (policy.excludedTopics as string[]) ?? [],
      });
      return NextResponse.json({ policy: result });
    }

    case 'reset_circuit_breaker': {
      resetCircuitBreaker();
      return NextResponse.json({ circuitBreaker: getCircuitBreakerStatus() });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${String(action).slice(0, 50)}` }, { status: 400 });
  }
}
