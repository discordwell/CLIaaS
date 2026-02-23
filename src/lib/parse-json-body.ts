/**
 * Safe JSON body parser with discriminated union return type.
 *
 * Usage (same 2-line guard as requireAuth):
 *   const parsed = await parseJsonBody(request);
 *   if ('error' in parsed) return parsed.error;
 *   // parsed.data is now the typed body
 */

import { NextResponse } from 'next/server';

type ParseSuccess<T> = { data: T };
type ParseError = { error: NextResponse };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function parseJsonBody<T = Record<string, any>>(
  request: Request,
): Promise<ParseSuccess<T> | ParseError> {
  try {
    const data = (await request.json()) as T;
    return { data };
  } catch {
    return {
      error: NextResponse.json(
        { error: 'Invalid request body: expected valid JSON' },
        { status: 400 },
      ),
    };
  }
}
