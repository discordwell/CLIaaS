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
  getChannelPoliciesAsync, setChannelPolicyAsync,
  getCircuitBreakerStatusAsync,
  getAuditTrailAsync,
  getUsageReportAsync,
} from '@/lib/ai/admin-controls';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings');
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const view = searchParams.get('view') ?? 'overview';

  const wsId = auth.user.workspaceId;

  switch (view) {
    case 'channel-policies':
      return NextResponse.json({ policies: await getChannelPoliciesAsync(wsId) });

    case 'circuit-breaker':
      return NextResponse.json({ circuitBreaker: await getCircuitBreakerStatusAsync(wsId) });

    case 'audit': {
      const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 500);
      const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10), 0);
      const action = searchParams.get('action') ?? undefined;
      const ticketId = searchParams.get('ticketId') ?? undefined;
      const result = await getAuditTrailAsync({
        workspaceId: wsId,
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
      const summary = getUsageSummary(wsId, { from, to });
      const report = await getUsageReportAsync(wsId, { from, to });
      return NextResponse.json({ summary, hourly: report });
    }

    default: {
      // Overview: all admin surfaces in one response
      const policies = await getChannelPoliciesAsync(wsId);
      const circuitBreaker = await getCircuitBreakerStatusAsync(wsId);
      const usage = getUsageSummary(wsId);
      const { entries: recentAudit, total: auditTotal } = await getAuditTrailAsync({
        workspaceId: wsId,
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
      const policyInput = {
        channel: policy.channel as string,
        enabled: (policy.enabled as boolean) ?? true,
        mode: (policy.mode as 'suggest' | 'approve' | 'auto') ?? 'suggest',
        maxAutoResolvesPerHour: (policy.maxAutoResolvesPerHour as number) ?? 50,
        confidenceThreshold: (policy.confidenceThreshold as number) ?? 0.7,
        excludedTopics: (policy.excludedTopics as string[]) ?? [],
      };
      const result = await setChannelPolicyAsync(policyInput, auth.user.workspaceId);
      return NextResponse.json({ policy: result });
    }

    case 'trip_circuit_breaker': {
      // Manually trip the circuit breaker from admin UI
      const { recordAIFailure } = await import('@/lib/ai/admin-controls');
      for (let i = 0; i < 6; i++) recordAIFailure('Manual trip from safety dashboard');
      return NextResponse.json({ circuitBreaker: await getCircuitBreakerStatusAsync(auth.user.workspaceId) });
    }

    case 'reset_circuit_breaker': {
      resetCircuitBreaker();
      return NextResponse.json({ circuitBreaker: await getCircuitBreakerStatusAsync(auth.user.workspaceId) });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${String(action).slice(0, 50)}` }, { status: 400 });
  }
}
