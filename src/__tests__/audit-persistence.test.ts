import { describe, it, expect, beforeEach } from 'vitest';
import { walEnqueue, walFlush, walSize, walClear } from '@/lib/audit-wal';

describe('audit-wal', () => {
  beforeEach(() => {
    walClear('__cliaasAuditWal');
    walClear('__cliaasSecureAuditWal');
  });

  it('enqueues a failed entry', () => {
    walEnqueue('__cliaasAuditWal', { id: 'test-1', action: 'test' });
    expect(walSize('__cliaasAuditWal')).toBe(1);
  });

  it('flushes entries with a successful writer', async () => {
    walEnqueue('__cliaasAuditWal', { id: 'test-1' });
    walEnqueue('__cliaasAuditWal', { id: 'test-2' });

    const written: unknown[] = [];
    const flushed = await walFlush('__cliaasAuditWal', async (payload) => {
      written.push(payload);
    });

    expect(flushed).toBe(2);
    expect(written).toHaveLength(2);
    expect(walSize('__cliaasAuditWal')).toBe(0);
  });

  it('retains entries on writer failure', async () => {
    walEnqueue('__cliaasAuditWal', { id: 'test-1' });

    const flushed = await walFlush('__cliaasAuditWal', async () => {
      throw new Error('DB down');
    });

    expect(flushed).toBe(0);
    expect(walSize('__cliaasAuditWal')).toBe(1);
  });

  it('drops entries after max retry attempts', async () => {
    walEnqueue('__cliaasAuditWal', { id: 'test-1' });

    // Exhaust all 5 attempts (1 initial + 4 retries in flush)
    for (let i = 0; i < 5; i++) {
      await walFlush('__cliaasAuditWal', async () => {
        throw new Error('DB down');
      });
    }

    expect(walSize('__cliaasAuditWal')).toBe(0);
  });

  it('separate WAL buffers for audit and secure audit', () => {
    walEnqueue('__cliaasAuditWal', { type: 'audit' });
    walEnqueue('__cliaasSecureAuditWal', { type: 'secure' });

    expect(walSize('__cliaasAuditWal')).toBe(1);
    expect(walSize('__cliaasSecureAuditWal')).toBe(1);

    walClear('__cliaasAuditWal');
    expect(walSize('__cliaasAuditWal')).toBe(0);
    expect(walSize('__cliaasSecureAuditWal')).toBe(1);
  });
});

describe('recordAudit async', () => {
  it('recordAudit is async and returns an AuditEntry', async () => {
    const { recordAudit } = await import('@/lib/audit');
    const entry = await recordAudit({
      userId: 'test-user',
      userName: 'Test User',
      action: 'test.async',
      resource: 'test',
      resourceId: 'test-1',
      details: {},
      ipAddress: '127.0.0.1',
    });

    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeTruthy();
    expect(entry.action).toBe('test.async');
  });

  it('queryAudit falls back to in-memory when no DB', async () => {
    const { recordAudit, queryAudit } = await import('@/lib/audit');
    await recordAudit({
      userId: 'mem-user',
      userName: 'Mem User',
      action: 'test.memory',
      resource: 'test',
      resourceId: 'test-2',
      details: {},
      ipAddress: '127.0.0.1',
    });

    const result = await queryAudit({ action: 'test.memory' });
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries[0].action).toBe('test.memory');
  });

  it('recordAudit accepts workspaceId', async () => {
    const { recordAudit } = await import('@/lib/audit');
    const entry = await recordAudit({
      userId: 'test-user',
      userName: 'Test User',
      action: 'test.workspace',
      resource: 'test',
      resourceId: 'test-3',
      details: {},
      ipAddress: '127.0.0.1',
      workspaceId: 'ws-123',
    });

    expect(entry.workspaceId).toBe('ws-123');
  });
});
