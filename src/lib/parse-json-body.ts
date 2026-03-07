/**
 * Safe JSON body parser with discriminated union return type.
 *
 * Usage (same 2-line guard as requireAuth):
 *   const parsed = await parseJsonBody(request);
 *   if ('error' in parsed) return parsed.error;
 *   // parsed.data is now the typed body
 */

import { NextResponse } from 'next/server';

/**
 * Sanitize error messages for API responses — prevents SQL/internal detail leakage.
 * Returns the original message only if it looks safe (no SQL keywords, short enough).
 */
const SQL_LEAK_PATTERN = /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|INTO|VALUES|SET\s+LOCAL|CREATE|ALTER|DROP|pg_|drizzle|workspace_id)\b/i;

export function safeErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const msg = err.message;
  if (msg.length > 200 || SQL_LEAK_PATTERN.test(msg)) return fallback;
  return msg;
}

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
