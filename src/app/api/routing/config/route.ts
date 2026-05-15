import { NextRequest, NextResponse } from 'next/server';
import { getRoutingConfig, setRoutingConfig } from '@/lib/routing/store';
import type { RoutingStrategy } from '@/lib/routing/types';
import { requirePerm } from '@/lib/rbac';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'automation:view');
  if ('error' in auth) return auth.error;

  return NextResponse.json(getRoutingConfig());
}

export async function PUT(request: NextRequest) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const strategies: RoutingStrategy[] = ['round_robin', 'load_balanced', 'skill_match', 'priority_weighted'];
  const requestedStrategy = body.defaultStrategy;
  const defaultStrategy = typeof requestedStrategy === 'string' && strategies.includes(requestedStrategy as RoutingStrategy)
    ? requestedStrategy as RoutingStrategy
    : 'skill_match';
  const config = {
    defaultStrategy,
    enabled: (body.enabled as boolean) ?? true,
    autoRouteOnCreate: (body.autoRouteOnCreate as boolean) ?? true,
    llmEnhanced: (body.llmEnhanced as boolean) ?? false,
  };
  setRoutingConfig(config);
  return NextResponse.json(config);
}
