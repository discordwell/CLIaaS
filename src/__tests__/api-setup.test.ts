import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildPostRequest } from './helpers';

describe('Setup API route', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // ── POST /api/setup ─────────────────────────────────────────────────────

  describe('POST /api/setup', () => {
    it('rejects requests from non-localhost', async () => {
      const { POST } = await import('@/app/api/setup/route');
      const req = new Request('https://example.com/api/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          host: 'example.com',
        },
        body: JSON.stringify({
          databaseUrl: 'postgresql://localhost/cliaas',
          llmProvider: 'claude',
        }),
      });
      const res = await POST(req as any);
      expect(res.status).toBe(403);
    });

    it('returns 400 when body is missing databaseUrl', async () => {
      const { POST } = await import('@/app/api/setup/route');
      const req = buildPostRequest('/api/setup', {
        llmProvider: 'claude',
      });
      const res = await POST(req as any);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/databaseUrl/i);
    });

    it('returns 400 when llmProvider is invalid', async () => {
      const { POST } = await import('@/app/api/setup/route');
      const req = buildPostRequest('/api/setup', {
        databaseUrl: 'postgresql://localhost/test',
        llmProvider: 'gpt-99',
      });
      const res = await POST(req as any);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/llmProvider/i);
    });

    it('returns 400 when llmProvider is missing', async () => {
      const { POST } = await import('@/app/api/setup/route');
      const req = buildPostRequest('/api/setup', {
        databaseUrl: 'postgresql://localhost/test',
      });
      const res = await POST(req as any);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/llmProvider/i);
    });

    it('returns 400 when databaseUrl has invalid scheme', async () => {
      const { POST } = await import('@/app/api/setup/route');
      const req = buildPostRequest('/api/setup', {
        databaseUrl: 'mysql://localhost/test',
        llmProvider: 'claude',
      });
      const res = await POST(req as any);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/postgresql/i);
    });

    it('returns 422 when database connection fails', async () => {
      // Mock pg to simulate a connection failure
      vi.doMock('pg', () => ({
        default: {
          Client: class MockClient {
            connect() {
              return Promise.reject(new Error('Connection refused'));
            }
            end() {
              return Promise.resolve();
            }
          },
        },
      }));

      const { POST } = await import('@/app/api/setup/route');
      const req = buildPostRequest('/api/setup', {
        databaseUrl: 'postgresql://bad:bad@localhost:9999/nonexistent',
        llmProvider: 'claude',
      });
      const res = await POST(req as any);
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toMatch(/connection failed/i);
      expect(body.step).toBe('database');
    });

    it('returns 200 with success when database connects', async () => {
      // Mock pg to simulate a successful connection
      vi.doMock('pg', () => ({
        default: {
          Client: class MockClient {
            connect() {
              return Promise.resolve();
            }
            query() {
              return Promise.resolve({ rows: [{ ok: 1 }] });
            }
            end() {
              return Promise.resolve();
            }
          },
        },
      }));

      const { POST } = await import('@/app/api/setup/route');
      const req = buildPostRequest('/api/setup', {
        databaseUrl: 'postgresql://cliaas:cliaas@localhost:5432/cliaas',
        llmProvider: 'claude',
        llmApiKey: 'sk-ant-test-key-12345',
      });
      const res = await POST(req as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.database.connected).toBe(true);
      expect(body.llm.provider).toBe('claude');
      expect(body.llm.keyProvided).toBe(true);
      expect(body.nextSteps).toBeInstanceOf(Array);
      expect(body.nextSteps.length).toBeGreaterThan(0);
    });

    it('masks database password in response', async () => {
      vi.doMock('pg', () => ({
        default: {
          Client: class MockClient {
            connect() {
              return Promise.resolve();
            }
            query() {
              return Promise.resolve({ rows: [{ ok: 1 }] });
            }
            end() {
              return Promise.resolve();
            }
          },
        },
      }));

      const { POST } = await import('@/app/api/setup/route');
      const req = buildPostRequest('/api/setup', {
        databaseUrl: 'postgresql://myuser:supersecret@localhost:5432/cliaas',
        llmProvider: 'openai',
      });
      const res = await POST(req as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.database.url).not.toContain('supersecret');
      expect(body.database.url).toContain('****');
    });

    it('warns on malformed Claude API key', async () => {
      vi.doMock('pg', () => ({
        default: {
          Client: class MockClient {
            connect() {
              return Promise.resolve();
            }
            query() {
              return Promise.resolve({ rows: [{ ok: 1 }] });
            }
            end() {
              return Promise.resolve();
            }
          },
        },
      }));

      const { POST } = await import('@/app/api/setup/route');
      const req = buildPostRequest('/api/setup', {
        databaseUrl: 'postgresql://localhost/cliaas',
        llmProvider: 'claude',
        llmApiKey: 'bad-key-format',
      });
      const res = await POST(req as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.llm.keyValid).toBe(false);
      expect(body.llm.warning).toMatch(/sk-ant/i);
    });

    it('warns on malformed OpenAI API key', async () => {
      vi.doMock('pg', () => ({
        default: {
          Client: class MockClient {
            connect() {
              return Promise.resolve();
            }
            query() {
              return Promise.resolve({ rows: [{ ok: 1 }] });
            }
            end() {
              return Promise.resolve();
            }
          },
        },
      }));

      const { POST } = await import('@/app/api/setup/route');
      const req = buildPostRequest('/api/setup', {
        databaseUrl: 'postgresql://localhost/cliaas',
        llmProvider: 'openai',
        llmApiKey: 'bad-key-format',
      });
      const res = await POST(req as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.llm.keyValid).toBe(false);
      expect(body.llm.warning).toMatch(/sk-/i);
    });

    it('includes connector info when provided', async () => {
      vi.doMock('pg', () => ({
        default: {
          Client: class MockClient {
            connect() {
              return Promise.resolve();
            }
            query() {
              return Promise.resolve({ rows: [{ ok: 1 }] });
            }
            end() {
              return Promise.resolve();
            }
          },
        },
      }));

      const { POST } = await import('@/app/api/setup/route');
      const req = buildPostRequest('/api/setup', {
        databaseUrl: 'postgresql://localhost/cliaas',
        llmProvider: 'claude',
        connector: 'zendesk',
      });
      const res = await POST(req as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.connector).toBeDefined();
      expect(body.connector.name).toBe('zendesk');
      expect(body.connector.valid).toBe(true);
    });

    it('returns null connector when not provided', async () => {
      vi.doMock('pg', () => ({
        default: {
          Client: class MockClient {
            connect() {
              return Promise.resolve();
            }
            query() {
              return Promise.resolve({ rows: [{ ok: 1 }] });
            }
            end() {
              return Promise.resolve();
            }
          },
        },
      }));

      const { POST } = await import('@/app/api/setup/route');
      const req = buildPostRequest('/api/setup', {
        databaseUrl: 'postgresql://localhost/cliaas',
        llmProvider: 'claude',
      });
      const res = await POST(req as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.connector).toBeNull();
    });

    it('accepts postgres:// scheme as well as postgresql://', async () => {
      vi.doMock('pg', () => ({
        default: {
          Client: class MockClient {
            connect() {
              return Promise.resolve();
            }
            query() {
              return Promise.resolve({ rows: [{ ok: 1 }] });
            }
            end() {
              return Promise.resolve();
            }
          },
        },
      }));

      const { POST } = await import('@/app/api/setup/route');
      const req = buildPostRequest('/api/setup', {
        databaseUrl: 'postgres://cliaas:cliaas@localhost:5432/cliaas',
        llmProvider: 'claude',
      });
      const res = await POST(req as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });
  });

  // ── GET /api/setup ──────────────────────────────────────────────────────

  describe('GET /api/setup', () => {
    it('returns not configured when DATABASE_URL is unset', async () => {
      delete process.env.DATABASE_URL;
      vi.resetModules();

      const { GET } = await import('@/app/api/setup/route');
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.configured).toBe(false);
      expect(body.database.connected).toBe(false);
      expect(body.database.url).toBeNull();
    });

    it('returns configured when DATABASE_URL is set but unreachable', async () => {
      process.env.DATABASE_URL = 'postgresql://bad:bad@localhost:9999/nonexistent';
      vi.resetModules();

      // Mock pg to simulate connection failure
      vi.doMock('pg', () => ({
        default: {
          Client: class MockClient {
            connect() {
              return Promise.reject(new Error('Connection refused'));
            }
            end() {
              return Promise.resolve();
            }
          },
        },
      }));

      const { GET } = await import('@/app/api/setup/route');
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.configured).toBe(true);
      expect(body.database.connected).toBe(false);
    });

    it('detects LLM key presence', async () => {
      delete process.env.DATABASE_URL;
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      process.env.OPENAI_API_KEY = '';
      vi.resetModules();

      const { GET } = await import('@/app/api/setup/route');
      const res = await GET();
      const body = await res.json();
      expect(body.llm.anthropic).toBe(true);
      expect(body.llm.openai).toBe(false);
    });
  });
});
