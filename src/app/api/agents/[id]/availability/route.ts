import { NextRequest, NextResponse } from 'next/server';
import { availability } from '@/lib/routing/availability';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const status = body.status ?? 'online';
  const userName = body.userName ?? id;
  availability.setAvailability(id, userName, status);
  return NextResponse.json({ userId: id, status });
}
