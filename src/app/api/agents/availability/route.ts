import { NextResponse } from 'next/server';
import { availability } from '@/lib/routing/availability';

export async function GET() {
  return NextResponse.json(availability.getAllAvailability());
}
