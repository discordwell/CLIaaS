import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  it('returns 200 status', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('returns JSON with status ok', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('cliaas');
  });

  it('includes a valid ISO timestamp', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.timestamp).toBeDefined();
    const parsed = new Date(body.timestamp);
    expect(parsed.getTime()).not.toBeNaN();
  });
});
