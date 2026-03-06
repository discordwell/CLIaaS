import { NextResponse } from 'next/server';
import { getAgentSkills } from '@/lib/routing/store';

export async function GET() {
  return NextResponse.json(getAgentSkills());
}
