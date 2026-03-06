import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock auth to always pass
vi.mock('@/lib/api-auth', () => ({
  requireRole: () => ({ user: { id: 'user-1', role: 'admin' } }),
}));

vi.mock('@/lib/parse-json-body', () => ({
  parseJsonBody: async (req: Request) => {
    const body = await req.json();
    return { data: body };
  },
}));

// Mock plugin stores
const mockGetInstallation = vi.fn().mockResolvedValue(null);
const mockUpdateInstallation = vi.fn().mockResolvedValue(null);
const mockUninstallPlugin = vi.fn().mockResolvedValue(false);

vi.mock('@/lib/plugins/store', () => ({
  getInstallation: (...args: unknown[]) => mockGetInstallation(...args),
  getInstallationByPluginId: vi.fn().mockResolvedValue(null),
  updateInstallation: (...args: unknown[]) => mockUpdateInstallation(...args),
  uninstallPlugin: (...args: unknown[]) => mockUninstallPlugin(...args),
  getInstallations: vi.fn().mockResolvedValue([]),
  installPlugin: vi.fn().mockResolvedValue({ id: 'inst-1', pluginId: 'test' }),
}));

vi.mock('@/lib/plugins/marketplace-store', () => ({
  getListing: vi.fn().mockResolvedValue(null),
  getListings: vi.fn().mockResolvedValue([]),
  upsertListing: vi.fn().mockResolvedValue({ pluginId: 'test', status: 'published' }),
  incrementInstallCount: vi.fn(),
}));

vi.mock('@/lib/plugins/execution-log', () => ({
  getExecutionLogs: vi.fn().mockResolvedValue([]),
}));

// Mock legacy plugin registry
vi.mock('@/lib/plugins', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    PluginRegistry: {
      list: () => [],
      getPlugin: () => undefined,
      register: vi.fn(),
      unregister: vi.fn().mockReturnValue(false),
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/plugins', () => {
  it('returns plugins list', async () => {
    const { GET } = await import('../app/api/plugins/route');
    const req = new Request('http://localhost/api/plugins');
    const res = await GET(req as never);
    const body = await res.json();
    expect(body.plugins).toBeDefined();
  });
});

describe('GET /api/plugins/:id', () => {
  it('returns 404 for missing plugin', async () => {
    const { GET } = await import('../app/api/plugins/[id]/route');
    const req = new Request('http://localhost/api/plugins/nonexistent');
    const res = await GET(req as never, { params: Promise.resolve({ id: 'nonexistent' }) });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/plugins/:id', () => {
  it('returns 404 when installation not found', async () => {
    const { PATCH } = await import('../app/api/plugins/[id]/route');
    const req = new Request('http://localhost/api/plugins/missing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    const res = await PATCH(req as never, { params: Promise.resolve({ id: 'missing' }) });
    expect(res.status).toBe(404);
  });

  it('updates installation when found', async () => {
    mockUpdateInstallation.mockResolvedValueOnce({
      id: 'inst-1',
      pluginId: 'test',
      enabled: true,
      config: {},
    });

    const { PATCH } = await import('../app/api/plugins/[id]/route');
    const req = new Request('http://localhost/api/plugins/inst-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    const res = await PATCH(req as never, { params: Promise.resolve({ id: 'inst-1' }) });
    const body = await res.json();
    expect(body.installation).toBeDefined();
    expect(body.installation.enabled).toBe(true);
  });
});

describe('GET /api/marketplace', () => {
  it('returns listings', async () => {
    const { GET } = await import('../app/api/marketplace/route');
    const req = new Request('http://localhost/api/marketplace');
    const res = await GET(req as never);
    const body = await res.json();
    expect(body.listings).toBeDefined();
  });
});

describe('GET /api/plugins/:id/logs', () => {
  it('returns execution logs', async () => {
    const { GET } = await import('../app/api/plugins/[id]/logs/route');
    const req = new Request('http://localhost/api/plugins/inst-1/logs');
    const res = await GET(req as never, { params: Promise.resolve({ id: 'inst-1' }) });
    const body = await res.json();
    expect(body.logs).toBeDefined();
  });
});
