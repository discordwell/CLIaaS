import type { NextRequest } from 'next/server';

export function getPortalEmail(request: NextRequest): string | null {
  return request.cookies.get('cliaas-portal-email')?.value ?? null;
}
