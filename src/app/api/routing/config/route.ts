import { NextRequest, NextResponse } from 'next/server';
import { getRoutingConfig, setRoutingConfig } from '@/lib/routing/store';
import { requireScope } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const auth = await requireScope(request, 'routing:read');
  if ('error' in auth) return auth.error;

  return NextResponse.json(getRoutingConfig());
}

export async function PUT(request: NextRequest) {
  const auth = await requireScope(request, 'routing:write');
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const config = {
    defaultStrategy: (body.defaultStrategy as string) ?? 'skill_match',
    enabled: (body.enabled as boolean) ?? true,
    autoRouteOnCreate: (body.autoRouteOnCreate as boolean) ?? true,
    llmEnhanced: (body.llmEnhanced as boolean) ?? false,
  };
  setRoutingConfig(config);
  return NextResponse.json(config);
}
