import { describe, it, expect } from 'vitest';
import { parseJsonBody } from '../parse-json-body';

function buildJsonRequest(body: string): Request {
  return new Request('http://localhost:3000/api/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

describe('parseJsonBody', () => {
  it('returns data for valid JSON', async () => {
    const req = buildJsonRequest(JSON.stringify({ name: 'test', value: 42 }));
    const result = await parseJsonBody(req);

    expect('data' in result).toBe(true);
    if ('data' in result) {
      expect(result.data).toEqual({ name: 'test', value: 42 });
    }
  });

  it('returns 400 error for malformed JSON', async () => {
    const req = buildJsonRequest('{not valid json');
    const result = await parseJsonBody(req);

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(400);
      const body = await result.error.json();
      expect(body.error).toBe('Invalid request body: expected valid JSON');
    }
  });

  it('returns 400 error for empty body', async () => {
    const req = new Request('http://localhost:3000/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const result = await parseJsonBody(req);

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(400);
    }
  });

  it('supports generic type parameter', async () => {
    interface MyBody {
      name: string;
      count: number;
    }
    const req = buildJsonRequest(JSON.stringify({ name: 'x', count: 5 }));
    const result = await parseJsonBody<MyBody>(req);

    expect('data' in result).toBe(true);
    if ('data' in result) {
      expect(result.data.name).toBe('x');
      expect(result.data.count).toBe(5);
    }
  });
});
