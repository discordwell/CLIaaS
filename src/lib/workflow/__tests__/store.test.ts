import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Workflow } from '../types';

// Mock JSONL store before importing the module
const mockRead = vi.fn<() => Workflow[]>().mockReturnValue([]);
const mockWrite = vi.fn();

vi.mock('@/lib/jsonl-store', () => ({
  readJsonlFile: (...args: unknown[]) => mockRead(...(args as [])),
  writeJsonlFile: (...args: unknown[]) => mockWrite(...(args as [])),
}));

// Mock DB as unavailable (JSONL path)
vi.mock('@/db', () => ({
  getDb: () => null,
}));

const { getWorkflows, getWorkflow, getActiveWorkflows, upsertWorkflow, deleteWorkflow } =
  await import('../store');

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'wf-1',
    name: 'Test Workflow',
    nodes: {
      t1: { id: 't1', type: 'trigger', data: { event: 'create' }, position: { x: 0, y: 0 } },
    },
    transitions: [],
    entryNodeId: 't1',
    enabled: false,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRead.mockReturnValue([]);
});

describe('getWorkflows', () => {
  it('returns all workflows from JSONL', async () => {
    const items = [makeWorkflow(), makeWorkflow({ id: 'wf-2', name: 'Second' })];
    mockRead.mockReturnValue(items);

    const result = await getWorkflows();
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Test Workflow');
  });

  it('returns empty array when no workflows', async () => {
    const result = await getWorkflows();
    expect(result).toEqual([]);
  });
});

describe('getWorkflow', () => {
  it('finds a workflow by ID', async () => {
    mockRead.mockReturnValue([makeWorkflow()]);

    const result = await getWorkflow('wf-1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('wf-1');
  });

  it('returns null for unknown ID', async () => {
    const result = await getWorkflow('nonexistent');
    expect(result).toBeNull();
  });
});

describe('getActiveWorkflows', () => {
  it('returns only enabled workflows', async () => {
    mockRead.mockReturnValue([
      makeWorkflow({ id: 'wf-1', enabled: false }),
      makeWorkflow({ id: 'wf-2', enabled: true, name: 'Active' }),
      makeWorkflow({ id: 'wf-3', enabled: true, name: 'Also Active' }),
    ]);

    const result = await getActiveWorkflows();
    expect(result).toHaveLength(2);
    expect(result.every(w => w.enabled)).toBe(true);
  });

  it('returns empty array when no workflows are enabled', async () => {
    mockRead.mockReturnValue([makeWorkflow({ enabled: false })]);

    const result = await getActiveWorkflows();
    expect(result).toHaveLength(0);
  });
});

describe('upsertWorkflow', () => {
  it('adds a new workflow', async () => {
    const wf = makeWorkflow();
    await upsertWorkflow(wf);

    expect(mockWrite).toHaveBeenCalledTimes(1);
    const written = mockWrite.mock.calls[0][1] as Workflow[];
    expect(written).toHaveLength(1);
    expect(written[0].id).toBe('wf-1');
  });

  it('updates an existing workflow by ID', async () => {
    mockRead.mockReturnValue([makeWorkflow()]);

    const updated = makeWorkflow({ name: 'Updated Name' });
    await upsertWorkflow(updated);

    const written = mockWrite.mock.calls[0][1] as Workflow[];
    expect(written).toHaveLength(1);
    expect(written[0].name).toBe('Updated Name');
  });
});

describe('deleteWorkflow', () => {
  it('removes a workflow by ID', async () => {
    mockRead.mockReturnValue([makeWorkflow(), makeWorkflow({ id: 'wf-2' })]);

    const result = await deleteWorkflow('wf-1');
    expect(result).toBe(true);

    const written = mockWrite.mock.calls[0][1] as Workflow[];
    expect(written).toHaveLength(1);
    expect(written[0].id).toBe('wf-2');
  });

  it('returns false for unknown ID', async () => {
    const result = await deleteWorkflow('nonexistent');
    expect(result).toBe(false);
  });
});
