import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Workflow } from '@/lib/workflow/types';

// ---- Mocks ----

const mockWorkflows: Workflow[] = [];

vi.mock('@/lib/workflow/store', () => ({
  getWorkflows: vi.fn(async () => mockWorkflows),
  getWorkflow: vi.fn(async (id: string) => mockWorkflows.find((w) => w.id === id) ?? null),
  upsertWorkflow: vi.fn(async (wf: Workflow) => {
    const idx = mockWorkflows.findIndex((w) => w.id === wf.id);
    if (idx >= 0) mockWorkflows[idx] = wf;
    else mockWorkflows.push(wf);
    return wf;
  }),
  deleteWorkflow: vi.fn(async (id: string) => {
    const idx = mockWorkflows.findIndex((w) => w.id === id);
    if (idx < 0) return false;
    mockWorkflows.splice(idx, 1);
    return true;
  }),
  getActiveWorkflows: vi.fn(async () => mockWorkflows.filter((w) => w.enabled)),
}));

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(async () => ({
    user: { id: 'u1', email: 'admin@test.com', role: 'admin', workspaceId: 'ws1' },
  })),
}));

const { GET, POST } = await import('../route');

function makeRequest(url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) {
  return new NextRequest(new URL(url, 'http://localhost:3000'), options);
}

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'wf-1',
    name: 'Test Workflow',
    nodes: {
      t1: { id: 't1', type: 'trigger', data: { event: 'create' }, position: { x: 0, y: 0 } },
      s1: { id: 's1', type: 'state', data: { label: 'Open' }, position: { x: 0, y: 100 } },
    },
    transitions: [
      { id: 'tr1', fromNodeId: 't1', toNodeId: 's1' },
    ],
    entryNodeId: 't1',
    enabled: false,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockWorkflows.length = 0;
});

// ---- GET /api/workflows ----

describe('GET /api/workflows', () => {
  it('returns demo workflows when store is empty', async () => {
    const res = await GET(makeRequest('/api/workflows'));
    const data = await res.json();

    expect(res.status).toBe(200);
    // Should have demo workflows (3 templates)
    expect(data.workflows.length).toBeGreaterThan(0);
  });

  it('returns existing workflows', async () => {
    mockWorkflows.push(makeWorkflow());
    const res = await GET(makeRequest('/api/workflows'));
    const data = await res.json();

    expect(data.workflows).toHaveLength(1);
    expect(data.workflows[0].name).toBe('Test Workflow');
  });
});

// ---- POST /api/workflows ----

describe('POST /api/workflows', () => {
  it('creates a new workflow', async () => {
    const res = await POST(
      makeRequest('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My Workflow',
          nodes: {
            t1: { id: 't1', type: 'trigger', data: { event: 'create' }, position: { x: 0, y: 0 } },
            s1: { id: 's1', type: 'state', data: { label: 'Open' }, position: { x: 0, y: 100 } },
          },
          transitions: [{ id: 'tr1', fromNodeId: 't1', toNodeId: 's1' }],
          entryNodeId: 't1',
        }),
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.workflow.name).toBe('My Workflow');
    expect(data.workflow.id).toBeTruthy();
    expect(data.workflow.enabled).toBe(false);
    expect(data.workflow.version).toBe(1);
  });

  it('rejects missing name', async () => {
    const res = await POST(
      makeRequest('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: { t1: { id: 't1', type: 'trigger', data: { event: 'create' }, position: { x: 0, y: 0 } } },
          transitions: [],
          entryNodeId: 't1',
        }),
      }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('name');
  });

  it('rejects missing nodes', async () => {
    const res = await POST(
      makeRequest('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Workflow' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects invalid entryNodeId', async () => {
    const res = await POST(
      makeRequest('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Workflow',
          nodes: { t1: { id: 't1', type: 'trigger', data: { event: 'create' }, position: { x: 0, y: 0 } } },
          transitions: [],
          entryNodeId: 'nonexistent',
        }),
      }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('entryNodeId');
  });

  it('creates from templateKey', async () => {
    const res = await POST(
      makeRequest('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Lifecycle', templateKey: 'simple-lifecycle' }),
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.workflow.name).toBe('My Lifecycle');
    expect(Object.keys(data.workflow.nodes).length).toBeGreaterThan(2);
    expect(data.workflow.transitions.length).toBeGreaterThan(2);
    expect(data.workflow.entryNodeId).toBeTruthy();
    expect(data.workflow.nodes[data.workflow.entryNodeId]).toBeDefined();
  });

  it('rejects unknown templateKey', async () => {
    const res = await POST(
      makeRequest('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bad', templateKey: 'nonexistent' }),
      }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('nonexistent');
  });

  it('rejects workflow that fails validation', async () => {
    // Trigger node with no outgoing transitions
    const res = await POST(
      makeRequest('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Bad Workflow',
          nodes: {
            t1: { id: 't1', type: 'trigger', data: { event: 'create' }, position: { x: 0, y: 0 } },
            orphan: { id: 'orphan', type: 'state', data: { label: 'Alone' }, position: { x: 100, y: 0 } },
          },
          transitions: [],
          entryNodeId: 't1',
        }),
      }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details).toBeDefined();
    expect(data.details.length).toBeGreaterThan(0);
  });
});

// ---- GET/PUT/DELETE /api/workflows/:id ----

describe('single workflow routes', () => {
  let routeModule: typeof import('../[id]/route');

  beforeEach(async () => {
    routeModule = await import('../[id]/route');
  });

  it('GET returns 404 for unknown ID', async () => {
    const res = await routeModule.GET(
      makeRequest('/api/workflows/unknown'),
      { params: Promise.resolve({ id: 'unknown' }) },
    );
    expect(res.status).toBe(404);
  });

  it('GET returns the workflow', async () => {
    mockWorkflows.push(makeWorkflow());
    const res = await routeModule.GET(
      makeRequest('/api/workflows/wf-1'),
      { params: Promise.resolve({ id: 'wf-1' }) },
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.workflow.id).toBe('wf-1');
  });

  it('PUT updates the workflow and increments version', async () => {
    mockWorkflows.push(makeWorkflow());
    const res = await routeModule.PUT(
      makeRequest('/api/workflows/wf-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Workflow', enabled: true }),
      }),
      { params: Promise.resolve({ id: 'wf-1' }) },
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.workflow.name).toBe('Updated Workflow');
    expect(data.workflow.enabled).toBe(true);
    expect(data.workflow.version).toBe(2);
  });

  it('DELETE removes the workflow', async () => {
    mockWorkflows.push(makeWorkflow());
    const res = await routeModule.DELETE(
      makeRequest('/api/workflows/wf-1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'wf-1' }) },
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(mockWorkflows).toHaveLength(0);
  });

  it('DELETE returns 404 for unknown ID', async () => {
    const res = await routeModule.DELETE(
      makeRequest('/api/workflows/unknown', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'unknown' }) },
    );
    expect(res.status).toBe(404);
  });
});

// ---- Export endpoint ----

describe('GET /api/workflows/:id/export', () => {
  let exportModule: typeof import('../[id]/export/route');

  beforeEach(async () => {
    exportModule = await import('../[id]/export/route');
  });

  it('returns WorkflowExport with decomposed rules', async () => {
    mockWorkflows.push(makeWorkflow());
    const res = await exportModule.GET(
      makeRequest('/api/workflows/wf-1/export'),
      { params: Promise.resolve({ id: 'wf-1' }) },
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.format).toBe('cliaas-workflow-v1');
    expect(data.workflow).toBeDefined();
    expect(data.workflow.id).toBe('wf-1');
    expect(data.exportedAt).toBeTruthy();
    expect(data.rules).toBeDefined();
    expect(Array.isArray(data.rules)).toBe(true);
    expect(data.rules.length).toBeGreaterThan(0);
  });

  it('returns 404 for unknown workflow', async () => {
    const res = await exportModule.GET(
      makeRequest('/api/workflows/unknown/export'),
      { params: Promise.resolve({ id: 'unknown' }) },
    );
    expect(res.status).toBe(404);
  });
});
