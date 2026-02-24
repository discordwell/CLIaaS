import { describe, it, expect, beforeEach } from 'vitest';
import { _resetChainLock } from '@/lib/security/audit-log';

function makeActor() {
  return { type: 'user' as const, id: 'u1', name: 'Test', ip: '127.0.0.1' };
}

describe('audit-log', () => {
  beforeEach(() => {
    // Reset global state between tests
    globalThis.__cliaasSecureAudit = [];
    globalThis.__cliaasSecureAuditLoaded = true; // skip demo seeding
    _resetChainLock();
    // Set a temp dir so writes don't collide
    process.env.CLIAAS_DATA_DIR = '/tmp/cliaas-audit-test-' + process.pid;
  });

  it('records an event and returns it with hash chain', async () => {
    const { recordSecureAudit } = await import('@/lib/security/audit-log');
    const entry = await recordSecureAudit({
      actor: makeActor(),
      action: 'test.action',
      resource: { type: 'test', id: 't1' },
      outcome: 'success',
      details: { foo: 'bar' },
    });
    expect(entry.id).toBeTruthy();
    expect(entry.sequence).toBe(1);
    expect(entry.hash).toBeTruthy();
    expect(entry.prevHash).toMatch(/^0{64}$/);
  });

  it('chain links consecutive entries', async () => {
    const { recordSecureAudit } = await import('@/lib/security/audit-log');
    const e1 = await recordSecureAudit({
      actor: makeActor(),
      action: 'a1',
      resource: { type: 'r', id: '1' },
      outcome: 'success',
      details: {},
    });
    const e2 = await recordSecureAudit({
      actor: makeActor(),
      action: 'a2',
      resource: { type: 'r', id: '2' },
      outcome: 'success',
      details: {},
    });
    expect(e2.prevHash).toBe(e1.hash);
    expect(e2.sequence).toBe(2);
  });

  it('verifyChainIntegrity returns valid for clean chain', async () => {
    const { recordSecureAudit, verifyChainIntegrity } = await import('@/lib/security/audit-log');
    await recordSecureAudit({
      actor: makeActor(),
      action: 'a1',
      resource: { type: 'r', id: '1' },
      outcome: 'success',
      details: {},
    });
    await recordSecureAudit({
      actor: makeActor(),
      action: 'a2',
      resource: { type: 'r', id: '2' },
      outcome: 'success',
      details: {},
    });
    const result = verifyChainIntegrity();
    expect(result.valid).toBe(true);
    expect(result.totalEntries).toBe(2);
  });

  it('detects tampered entry', async () => {
    const { recordSecureAudit, verifyChainIntegrity } = await import('@/lib/security/audit-log');
    await recordSecureAudit({
      actor: makeActor(),
      action: 'a1',
      resource: { type: 'r', id: '1' },
      outcome: 'success',
      details: {},
    });
    await recordSecureAudit({
      actor: makeActor(),
      action: 'a2',
      resource: { type: 'r', id: '2' },
      outcome: 'success',
      details: {},
    });
    // Tamper with the first entry's hash — detected at that entry's sequence
    globalThis.__cliaasSecureAudit![0].hash = 'tampered';
    const result = verifyChainIntegrity();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it('exportSecureAudit JSON format', async () => {
    const { recordSecureAudit, exportSecureAudit } = await import('@/lib/security/audit-log');
    await recordSecureAudit({
      actor: makeActor(),
      action: 'export.test',
      resource: { type: 'r', id: '1' },
      outcome: 'success',
      details: { key: 'val' },
    });
    const json = exportSecureAudit('json');
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].action).toBe('export.test');
  });

  it('concurrent calls produce unique sequences and intact chain', async () => {
    const { recordSecureAudit, verifyChainIntegrity } = await import('@/lib/security/audit-log');
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        recordSecureAudit({
          actor: makeActor(),
          action: `concurrent.${i}`,
          resource: { type: 'r', id: String(i) },
          outcome: 'success',
          details: { idx: i },
        }),
      ),
    );
    const sequences = results.map(r => r.sequence);
    expect(new Set(sequences).size).toBe(5);
    expect(sequences.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);

    const integrity = verifyChainIntegrity();
    expect(integrity.valid).toBe(true);
    expect(integrity.totalEntries).toBe(5);
  });

  it('exportSecureAudit CSV format', async () => {
    const { recordSecureAudit, exportSecureAudit } = await import('@/lib/security/audit-log');
    await recordSecureAudit({
      actor: makeActor(),
      action: 'csv.test',
      resource: { type: 'r', id: '1' },
      outcome: 'success',
      details: {},
    });
    const csv = exportSecureAudit('csv');
    const lines = csv.split('\n');
    expect(lines[0]).toContain('id,sequence,timestamp');
    expect(lines[1]).toContain('csv.test');
  });
});
