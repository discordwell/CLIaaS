import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock api-auth to test auth guard behavior
const mockRequireAuth = vi.fn();
const mockRequireScope = vi.fn();
const mockRequireRole = vi.fn();

vi.mock('@/lib/api-auth', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  requireScope: (...args: unknown[]) => mockRequireScope(...args),
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

vi.mock('@/lib/routing/store', () => ({
  getRoutingQueues: vi.fn().mockReturnValue([]),
  createRoutingQueue: vi.fn().mockReturnValue({ id: 'q1', name: 'Test' }),
  getRoutingRules: vi.fn().mockReturnValue([]),
  getRoutingConfig: vi.fn().mockReturnValue({}),
  getRoutingLog: vi.fn().mockReturnValue([]),
}));

vi.mock('@/lib/routing/availability', () => ({
  availability: {
    getAllAvailability: vi.fn().mockReturnValue([]),
  },
}));

function makeRequest(method = 'GET', body?: unknown): Request {
  const init: RequestInit = { method, headers: { 'content-type': 'application/json' } };
  if (body) init.body = JSON.stringify(body);
  return new Request('http://localhost/api/routing/queues', init);
}

const authError = {
  error: new Response(JSON.stringify({ error: 'Authentication required' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  }),
};

const authSuccess = {
  user: { id: 'user-1', role: 'admin', workspaceId: 'ws-1', email: 'test@test.com' },
};

describe('routing API auth guards', () => {
  beforeEach(() => {
    mockRequireAuth.mockReset();
    mockRequireScope.mockReset();
    mockRequireRole.mockReset();
  });

  it('queues GET returns 401 without auth', async () => {
    mockRequireScope.mockResolvedValue(authError);
    const { GET } = await import('../../routing/queues/route');
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(401);
  });

  it('queues GET returns 200 with valid auth', async () => {
    mockRequireScope.mockResolvedValue(authSuccess);
    const { GET } = await import('../../routing/queues/route');
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
  });

  it('queues POST validates strategy enum', async () => {
    mockRequireScope.mockResolvedValue(authSuccess);
    const { POST } = await import('../../routing/queues/route');
    const req = makeRequest('POST', { name: 'Test', strategy: 'invalid_strategy' });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Invalid strategy');
  });

  it('queues POST accepts valid strategy', async () => {
    mockRequireScope.mockResolvedValue(authSuccess);
    const { POST } = await import('../../routing/queues/route');
    const req = makeRequest('POST', { name: 'Test', strategy: 'round_robin' });
    const res = await POST(req as any);
    expect(res.status).toBe(201);
  });

  it('agents availability GET returns 401 without auth', async () => {
    mockRequireAuth.mockResolvedValue(authError);
    const { GET } = await import('../../agents/availability/route');
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(401);
  });

  it('log GET caps limit at 200', async () => {
    mockRequireScope.mockResolvedValue(authSuccess);
    const { getRoutingLog } = await import('@/lib/routing/store');
    const { GET } = await import('../../routing/log/route');
    const req = new Request('http://localhost/api/routing/log?limit=999');
    await GET(req as any);
    expect(getRoutingLog).toHaveBeenCalledWith(undefined, 200);
  });
});
