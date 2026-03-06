import { NextRequest, NextResponse } from 'next/server';
import { getRoutingConfig, setRoutingConfig } from '@/lib/routing/store';

export async function GET() {
  return NextResponse.json(getRoutingConfig());
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const config = {
    defaultStrategy: body.defaultStrategy ?? 'skill_match',
    enabled: body.enabled ?? true,
    autoRouteOnCreate: body.autoRouteOnCreate ?? true,
    llmEnhanced: body.llmEnhanced ?? false,
  };
  setRoutingConfig(config);
  return NextResponse.json(config);
}
