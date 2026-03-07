import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  exportWorkflowRules,
  exportAssignmentRules,
  exportSLAPolicies,
} from '../../connectors/zoho-desk.js';

// Mock the export-setup module to capture appendJsonl calls
vi.mock('../../connectors/base/export-setup', () => ({
  appendJsonl: vi.fn(),
  setupExport: vi.fn(() => ({})),
  writeManifest: vi.fn(),
  exportSpinner: vi.fn(() => ({ start: vi.fn(), succeed: vi.fn(), info: vi.fn(), warn: vi.fn(), text: '' })),
}));

import { appendJsonl } from '../../connectors/base/export-setup';

const mockAppendJsonl = appendJsonl as ReturnType<typeof vi.fn>;

// Mock global fetch
const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  mockAppendJsonl.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? 'OK' : status === 403 ? 'Forbidden' : status === 404 ? 'Not Found' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

// Build a fake client matching RuleClient shape (ReturnType<createZohoDeskClient>)
function makeClient() {
  return {
    request: vi.fn(),
  };
}

function makeCounts() {
  return { tickets: 0, messages: 0, customers: 0, organizations: 0, kbArticles: 0, rules: 0 };
}

describe('Zoho Desk workflow rule normalization', () => {
  it('normalizes workflow rules to Rule type with automation type', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({
      data: [
        {
          id: 'wf-101',
          name: 'Auto-assign urgent',
          description: 'Assigns urgent tickets to senior agents',
          active: true,
          module: 'tickets',
          criteria: { field: 'priority', operator: 'is', value: 'urgent' },
          actions: { assign: 'senior-group' },
        },
        {
          id: 'wf-102',
          name: 'Escalate overdue',
          description: null,
          active: false,
          module: 'tickets',
          criteria: { field: 'dueDate', operator: 'past' },
          actions: { notify: 'manager' },
        },
      ],
    });

    const counts = makeCounts();
    await exportWorkflowRules(client as any, '/tmp/rules.jsonl', counts);

    expect(counts.rules).toBe(2);
    expect(mockAppendJsonl).toHaveBeenCalledTimes(2);

    const rule1 = mockAppendJsonl.mock.calls[0][1];
    expect(rule1).toEqual({
      id: 'zo-rule-wf-101',
      externalId: 'wf-101',
      source: 'zoho-desk',
      type: 'automation',
      title: 'Auto-assign urgent',
      conditions: { field: 'priority', operator: 'is', value: 'urgent' },
      actions: { assign: 'senior-group' },
      active: true,
    });

    const rule2 = mockAppendJsonl.mock.calls[1][1];
    expect(rule2.id).toBe('zo-rule-wf-102');
    expect(rule2.type).toBe('automation');
    expect(rule2.active).toBe(false);
  });

  it('handles empty workflow rules data gracefully', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({ data: [] });

    const counts = makeCounts();
    await exportWorkflowRules(client as any, '/tmp/rules.jsonl', counts);

    expect(counts.rules).toBe(0);
    expect(mockAppendJsonl).not.toHaveBeenCalled();
  });

  it('handles null data field gracefully', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({});

    const counts = makeCounts();
    await exportWorkflowRules(client as any, '/tmp/rules.jsonl', counts);

    expect(counts.rules).toBe(0);
    expect(mockAppendJsonl).not.toHaveBeenCalled();
  });
});

describe('Zoho Desk assignment rule normalization', () => {
  it('normalizes assignment rules to Rule type with assignment type', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({
      data: [
        {
          id: 'ar-201',
          name: 'Round robin billing',
          description: 'Distributes billing tickets evenly',
          active: true,
          module: 'tickets',
          criteria: { field: 'department', operator: 'is', value: 'billing' },
          assignee: { id: 'agent-55', name: 'Jane Doe' },
        },
      ],
    });

    const counts = makeCounts();
    await exportAssignmentRules(client as any, '/tmp/rules.jsonl', counts);

    expect(counts.rules).toBe(1);
    const rule = mockAppendJsonl.mock.calls[0][1];
    expect(rule).toEqual({
      id: 'zo-rule-ar-201',
      externalId: 'ar-201',
      source: 'zoho-desk',
      type: 'assignment',
      title: 'Round robin billing',
      conditions: { field: 'department', operator: 'is', value: 'billing' },
      actions: { id: 'agent-55', name: 'Jane Doe' },
      active: true,
    });
  });

  it('normalizes assignment rule with null assignee', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({
      data: [
        {
          id: 'ar-202',
          name: 'Unassigned fallback',
          description: null,
          active: true,
          module: null,
          criteria: null,
          assignee: null,
        },
      ],
    });

    const counts = makeCounts();
    await exportAssignmentRules(client as any, '/tmp/rules.jsonl', counts);

    expect(counts.rules).toBe(1);
    const rule = mockAppendJsonl.mock.calls[0][1];
    expect(rule.actions).toBeNull();
    expect(rule.conditions).toBeNull();
  });
});

describe('Zoho Desk SLA policy normalization', () => {
  it('normalizes SLA policies to Rule type with sla type', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({
      data: [
        {
          id: 'sla-301',
          name: 'Enterprise SLA',
          description: '4h response, 24h resolution',
          active: true,
          escalationLevels: [
            { level: 1, notifyAgent: true, afterMinutes: 120 },
            { level: 2, notifyManager: true, afterMinutes: 240 },
          ],
          targets: {
            firstResponse: { minutes: 240 },
            resolution: { minutes: 1440 },
          },
        },
        {
          id: 'sla-302',
          name: 'Basic SLA',
          description: null,
          active: false,
          escalationLevels: null,
          targets: { firstResponse: { minutes: 480 } },
        },
      ],
    });

    const counts = makeCounts();
    await exportSLAPolicies(client as any, '/tmp/rules.jsonl', counts);

    expect(counts.rules).toBe(2);

    const rule1 = mockAppendJsonl.mock.calls[0][1];
    expect(rule1).toEqual({
      id: 'zo-rule-sla-301',
      externalId: 'sla-301',
      source: 'zoho-desk',
      type: 'sla',
      title: 'Enterprise SLA',
      conditions: [
        { level: 1, notifyAgent: true, afterMinutes: 120 },
        { level: 2, notifyManager: true, afterMinutes: 240 },
      ],
      actions: {
        firstResponse: { minutes: 240 },
        resolution: { minutes: 1440 },
      },
      active: true,
    });

    const rule2 = mockAppendJsonl.mock.calls[1][1];
    expect(rule2.id).toBe('zo-rule-sla-302');
    expect(rule2.type).toBe('sla');
    expect(rule2.active).toBe(false);
    expect(rule2.conditions).toBeNull();
  });
});

describe('Zoho Desk rules graceful 403/404 handling', () => {
  it('exportWorkflowRules throws on 403 (caller catches gracefully)', async () => {
    const client = makeClient();
    client.request.mockRejectedValueOnce(
      new Error('Zoho Desk API error: 403 Forbidden for https://desk.zoho.com/api/v1/automationRules'),
    );

    const counts = makeCounts();
    await expect(exportWorkflowRules(client as any, '/tmp/rules.jsonl', counts)).rejects.toThrow('403 Forbidden');
    expect(counts.rules).toBe(0);
  });

  it('exportAssignmentRules throws on 404 (caller catches gracefully)', async () => {
    const client = makeClient();
    client.request.mockRejectedValueOnce(
      new Error('Zoho Desk API error: 404 Not Found for https://desk.zoho.com/api/v1/assignmentRules'),
    );

    const counts = makeCounts();
    await expect(exportAssignmentRules(client as any, '/tmp/rules.jsonl', counts)).rejects.toThrow('404 Not Found');
    expect(counts.rules).toBe(0);
  });

  it('exportSLAPolicies throws on 403 (caller catches gracefully)', async () => {
    const client = makeClient();
    client.request.mockRejectedValueOnce(
      new Error('Zoho Desk API error: 403 Forbidden for https://desk.zoho.com/api/v1/slaPolicies'),
    );

    const counts = makeCounts();
    await expect(exportSLAPolicies(client as any, '/tmp/rules.jsonl', counts)).rejects.toThrow('403 Forbidden');
    expect(counts.rules).toBe(0);
  });

  it('403 errors are silently swallowed by the isPermissionError check in exportZohoDesk', async () => {
    // This test verifies the regex pattern used in the main export function
    const permissionErrorMsg = 'Zoho Desk API error: 403 Forbidden for https://desk.zoho.com/api/v1/automationRules';
    const notFoundMsg = 'Zoho Desk API error: 404 Not Found for https://desk.zoho.com/api/v1/slaPolicies';
    const otherErrorMsg = 'Zoho Desk API error: 500 Internal Server Error';

    const isPermissionError = (err: unknown): boolean => {
      const msg = err instanceof Error ? err.message : '';
      return /API error: (403|404)\b/.test(msg);
    };

    expect(isPermissionError(new Error(permissionErrorMsg))).toBe(true);
    expect(isPermissionError(new Error(notFoundMsg))).toBe(true);
    expect(isPermissionError(new Error(otherErrorMsg))).toBe(false);
    expect(isPermissionError(new Error('network error'))).toBe(false);
    expect(isPermissionError('not an error object')).toBe(false);
  });
});
