import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

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
    statusText: status === 200 ? 'OK' : status === 403 ? 'Forbidden' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    statusText: status === 403 ? 'Forbidden' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

const testAuth = { subdomain: 'testco', apiKey: 'test-key' };

/** Set up mock responses for the export flow with rule data injected at the right positions */
function setupExportMocks(opts: {
  slas?: unknown[];
  dispatches?: unknown[] | 'forbidden';
  observers?: unknown[] | 'forbidden';
  scenarios?: unknown[] | 'forbidden';
}) {
  const mocks: Response[] = [
    // Tickets (empty)
    jsonResponse([]),
    // Contacts (empty)
    jsonResponse([]),
    // Agents (empty)
    jsonResponse([]),
    // Companies (empty)
    jsonResponse([]),
    // KB categories (empty)
    jsonResponse([]),
    // SLA policies
    jsonResponse(opts.slas ?? []),
  ];

  // Dispatch rules
  if (opts.dispatches === 'forbidden') {
    mocks.push(errorResponse(403, '{"message":"You are not authorized to perform this action."}'));
  } else {
    mocks.push(jsonResponse(opts.dispatches ?? []));
  }

  // Observer rules
  if (opts.observers === 'forbidden') {
    mocks.push(errorResponse(403, '{"message":"You are not authorized to perform this action."}'));
  } else {
    mocks.push(jsonResponse(opts.observers ?? []));
  }

  // Scenario automations
  if (opts.scenarios === 'forbidden') {
    mocks.push(errorResponse(403, '{"message":"You are not authorized to perform this action."}'));
  } else {
    mocks.push(jsonResponse(opts.scenarios ?? []));
  }

  for (const mock of mocks) {
    mockFetch.mockResolvedValueOnce(mock);
  }
}

describe('Freshdesk dispatch rules export', () => {
  it('normalizes dispatch rules to trigger type', async () => {
    const dispatchRules = [
      { id: 101, name: 'Route billing tickets', conditions: { ticket: { priority: [3, 4] } }, actions: { group_id: 42 }, active: true },
      { id: 102, name: 'Tag VIP emails', conditions: { contact: { email: { contains: 'vip' } } }, actions: { add_tag: 'vip' }, active: false },
    ];
    setupExportMocks({ dispatches: dispatchRules });

    const { exportFreshdesk } = await import('../../connectors/freshdesk.js');
    const tmpDir = `/tmp/fd-dispatch-test-${Date.now()}`;

    const manifest = await exportFreshdesk(testAuth, tmpDir);
    expect(manifest.counts.rules).toBe(2);

    const lines = fs.readFileSync(`${tmpDir}/rules.jsonl`, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const rule1 = JSON.parse(lines[0]);
    expect(rule1.id).toBe('fd-rule-101');
    expect(rule1.externalId).toBe('101');
    expect(rule1.source).toBe('freshdesk');
    expect(rule1.type).toBe('trigger');
    expect(rule1.title).toBe('Route billing tickets');
    expect(rule1.conditions).toEqual({ ticket: { priority: [3, 4] } });
    expect(rule1.actions).toEqual({ group_id: 42 });
    expect(rule1.active).toBe(true);

    const rule2 = JSON.parse(lines[1]);
    expect(rule2.id).toBe('fd-rule-102');
    expect(rule2.type).toBe('trigger');
    expect(rule2.active).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('Freshdesk observer rules export', () => {
  it('normalizes observer rules to automation type and includes event_type', async () => {
    const observerRules = [
      { id: 201, name: 'Escalate stale tickets', conditions: { hours_since_created: 48 }, actions: { priority: 4 }, event_type: 'time_based', active: true },
    ];
    setupExportMocks({ observers: observerRules });

    const { exportFreshdesk } = await import('../../connectors/freshdesk.js');
    const tmpDir = `/tmp/fd-observer-test-${Date.now()}`;

    const manifest = await exportFreshdesk(testAuth, tmpDir);
    expect(manifest.counts.rules).toBe(1);

    const lines = fs.readFileSync(`${tmpDir}/rules.jsonl`, 'utf-8').trim().split('\n');
    const rule = JSON.parse(lines[0]);
    expect(rule.id).toBe('fd-rule-201');
    expect(rule.type).toBe('automation');
    expect(rule.title).toBe('Escalate stale tickets');
    expect(rule.conditions).toEqual({ event_type: 'time_based', hours_since_created: 48 });
    expect(rule.actions).toEqual({ priority: 4 });
    expect(rule.active).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes conditions through when no event_type present', async () => {
    const observerRules = [
      { id: 202, name: 'Simple observer', conditions: { status: 'open' }, actions: { notify: true } },
    ];
    setupExportMocks({ observers: observerRules });

    const { exportFreshdesk } = await import('../../connectors/freshdesk.js');
    const tmpDir = `/tmp/fd-observer-noevent-test-${Date.now()}`;

    const manifest = await exportFreshdesk(testAuth, tmpDir);
    const lines = fs.readFileSync(`${tmpDir}/rules.jsonl`, 'utf-8').trim().split('\n');
    const rule = JSON.parse(lines[0]);
    expect(rule.conditions).toEqual({ status: 'open' });
    // active defaults to true when not specified
    expect(rule.active).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('Freshdesk scenario automations export', () => {
  it('normalizes scenario automations to macro type with description in conditions', async () => {
    const scenarios = [
      { id: 301, name: 'Close and Thank', description: 'Close ticket with thank you note', actions: { status: 5, reply: 'Thanks!' }, active: true },
    ];
    setupExportMocks({ scenarios });

    const { exportFreshdesk } = await import('../../connectors/freshdesk.js');
    const tmpDir = `/tmp/fd-scenario-test-${Date.now()}`;

    const manifest = await exportFreshdesk(testAuth, tmpDir);
    expect(manifest.counts.rules).toBe(1);

    const lines = fs.readFileSync(`${tmpDir}/rules.jsonl`, 'utf-8').trim().split('\n');
    const rule = JSON.parse(lines[0]);
    expect(rule.id).toBe('fd-rule-301');
    expect(rule.type).toBe('macro');
    expect(rule.title).toBe('Close and Thank');
    expect(rule.conditions).toEqual({ description: 'Close ticket with thank you note' });
    expect(rule.actions).toEqual({ status: 5, reply: 'Thanks!' });
    expect(rule.active).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('uses empty conditions when description is absent', async () => {
    const scenarios = [
      { id: 302, name: 'Quick resolve', description: '', actions: { status: 4 } },
    ];
    setupExportMocks({ scenarios });

    const { exportFreshdesk } = await import('../../connectors/freshdesk.js');
    const tmpDir = `/tmp/fd-scenario-nodesc-test-${Date.now()}`;

    await exportFreshdesk(testAuth, tmpDir);
    const lines = fs.readFileSync(`${tmpDir}/rules.jsonl`, 'utf-8').trim().split('\n');
    const rule = JSON.parse(lines[0]);
    expect(rule.conditions).toEqual({});

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('Freshdesk rules 403 handling', () => {
  it('gracefully handles 403 on all admin endpoints without failing export', async () => {
    setupExportMocks({
      dispatches: 'forbidden',
      observers: 'forbidden',
      scenarios: 'forbidden',
    });

    const { exportFreshdesk } = await import('../../connectors/freshdesk.js');
    const tmpDir = `/tmp/fd-rules-403-test-${Date.now()}`;

    // Should not throw despite 403 on all admin endpoints
    const manifest = await exportFreshdesk(testAuth, tmpDir);
    expect(manifest.counts.rules).toBe(0);
    expect(manifest.source).toBe('freshdesk');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exports available rules even when some endpoints return 403', async () => {
    const dispatches = [
      { id: 401, name: 'Dispatch available', conditions: {}, actions: { assign: 1 }, active: true },
    ];
    setupExportMocks({
      dispatches,
      observers: 'forbidden',
      scenarios: 'forbidden',
    });

    const { exportFreshdesk } = await import('../../connectors/freshdesk.js');
    const tmpDir = `/tmp/fd-rules-partial-403-test-${Date.now()}`;

    const manifest = await exportFreshdesk(testAuth, tmpDir);
    // Only the dispatch rule should be counted (observers and scenarios 403'd)
    expect(manifest.counts.rules).toBe(1);

    const lines = fs.readFileSync(`${tmpDir}/rules.jsonl`, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const rule = JSON.parse(lines[0]);
    expect(rule.id).toBe('fd-rule-401');
    expect(rule.type).toBe('trigger');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('Freshdesk combined rules export', () => {
  it('exports SLAs alongside dispatch, observer, and scenario rules with correct counts', async () => {
    const slas = [
      { id: 1, name: 'Default SLA', description: 'Default', is_default: true, applicable_to: { priority: [1, 2, 3, 4] }, sla_target: { first_response: 3600 } },
    ];
    const dispatches = [
      { id: 10, name: 'Dispatch 1', conditions: { from: 'a@b.com' }, actions: { group_id: 1 }, active: true },
    ];
    const observers = [
      { id: 20, name: 'Observer 1', conditions: { age: '>24h' }, actions: { escalate: true }, event_type: 'time_based', active: true },
    ];
    const scenarios = [
      { id: 30, name: 'Scenario 1', description: 'Auto-close', actions: { status: 5 }, active: true },
    ];
    setupExportMocks({ slas, dispatches, observers, scenarios });

    const { exportFreshdesk } = await import('../../connectors/freshdesk.js');
    const tmpDir = `/tmp/fd-combined-rules-test-${Date.now()}`;

    const manifest = await exportFreshdesk(testAuth, tmpDir);
    expect(manifest.counts.rules).toBe(4); // 1 SLA + 1 dispatch + 1 observer + 1 scenario

    const lines = fs.readFileSync(`${tmpDir}/rules.jsonl`, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(4);

    const types = lines.map(l => JSON.parse(l).type);
    expect(types).toContain('sla');
    expect(types).toContain('trigger');
    expect(types).toContain('automation');
    expect(types).toContain('macro');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
