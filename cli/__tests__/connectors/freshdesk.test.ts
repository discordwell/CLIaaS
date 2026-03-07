import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

const testAuth = { subdomain: 'testco', apiKey: 'test-key' };

describe('Freshdesk agent pagination', () => {
  it('paginates agents across multiple pages', async () => {
    // Generate 150 agents to span 2 pages (100 per page)
    const page1Agents = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      contact: { name: `Agent ${i + 1}`, email: `agent${i + 1}@test.com`, phone: null },
    }));
    const page2Agents = Array.from({ length: 50 }, (_, i) => ({
      id: i + 101,
      contact: { name: `Agent ${i + 101}`, email: `agent${i + 101}@test.com`, phone: null },
    }));

    mockFetch
      // Tickets page 1 (empty — no tickets to export)
      .mockResolvedValueOnce(jsonResponse([]))
      // Contacts page 1 (empty)
      .mockResolvedValueOnce(jsonResponse([]))
      // Agents page 1 (100 agents — triggers pagination for next page)
      .mockResolvedValueOnce(jsonResponse(page1Agents))
      // Agents page 2 (50 agents — less than pageSize, stops pagination)
      .mockResolvedValueOnce(jsonResponse(page2Agents))
      // Companies page 1 (empty)
      .mockResolvedValueOnce(jsonResponse([]))
      // KB categories
      .mockResolvedValueOnce(jsonResponse([]))
      // SLA policies
      .mockResolvedValueOnce(jsonResponse([]))
      // Dispatch rules
      .mockResolvedValueOnce(jsonResponse([]))
      // Observer rules
      .mockResolvedValueOnce(jsonResponse([]))
      // Scenario automations
      .mockResolvedValueOnce(jsonResponse([]));

    const { exportFreshdesk } = await import('../../connectors/freshdesk.js');
    const fs = await import('fs');
    const tmpDir = `/tmp/freshdesk-agent-pagination-test-${Date.now()}`;

    const manifest = await exportFreshdesk(testAuth, tmpDir);

    // All 150 agents should be exported as customers
    expect(manifest.counts.customers).toBe(150);

    const customerLines = fs.readFileSync(`${tmpDir}/customers.jsonl`, 'utf-8').trim().split('\n');
    expect(customerLines).toHaveLength(150);

    // Verify first and last agent
    const first = JSON.parse(customerLines[0]);
    expect(first.id).toBe('fd-agent-1');
    expect(first.name).toBe('Agent 1');

    const last = JSON.parse(customerLines[149]);
    expect(last.id).toBe('fd-agent-150');
    expect(last.name).toBe('Agent 150');

    // Verify that pagination was used (check for page=2 in the fetch calls)
    const agentCalls = mockFetch.mock.calls.filter(
      (call: [string, ...unknown[]]) => (call[0] as string).includes('/api/v2/agents'),
    );
    expect(agentCalls.length).toBe(2);
    expect(agentCalls[0][0]).toContain('page=1');
    expect(agentCalls[1][0]).toContain('page=2');

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles single page of agents without unnecessary extra requests', async () => {
    const agents = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      contact: { name: `Agent ${i + 1}`, email: `agent${i + 1}@test.com`, phone: null },
    }));

    mockFetch
      // Tickets page 1 (empty)
      .mockResolvedValueOnce(jsonResponse([]))
      // Contacts page 1 (empty)
      .mockResolvedValueOnce(jsonResponse([]))
      // Agents page 1 (5 agents — less than pageSize, no further pages)
      .mockResolvedValueOnce(jsonResponse(agents))
      // Companies page 1 (empty)
      .mockResolvedValueOnce(jsonResponse([]))
      // KB categories
      .mockResolvedValueOnce(jsonResponse([]))
      // SLA policies
      .mockResolvedValueOnce(jsonResponse([]))
      // Dispatch rules
      .mockResolvedValueOnce(jsonResponse([]))
      // Observer rules
      .mockResolvedValueOnce(jsonResponse([]))
      // Scenario automations
      .mockResolvedValueOnce(jsonResponse([]));

    const { exportFreshdesk } = await import('../../connectors/freshdesk.js');
    const fs = await import('fs');
    const tmpDir = `/tmp/freshdesk-agent-single-page-test-${Date.now()}`;

    const manifest = await exportFreshdesk(testAuth, tmpDir);
    expect(manifest.counts.customers).toBe(5);

    // Only one agent fetch call (no second page)
    const agentCalls = mockFetch.mock.calls.filter(
      (call: [string, ...unknown[]]) => (call[0] as string).includes('/api/v2/agents'),
    );
    expect(agentCalls.length).toBe(1);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
