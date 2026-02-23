import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const TEST_DIR = '/tmp/cliaas-test-sandbox-clone-' + process.pid;

describe('sandbox-clone', () => {
  beforeEach(() => {
    process.env.CLIAAS_DATA_DIR = TEST_DIR;
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });

    // Seed some production data
    const tickets = [
      JSON.stringify({ id: 'tk-1', subject: 'Login issue', status: 'open', priority: 'high' }),
      JSON.stringify({ id: 'tk-2', subject: 'Billing question', status: 'pending', priority: 'normal' }),
    ].join('\n') + '\n';

    const messages = [
      JSON.stringify({ id: 'msg-1', ticketId: 'tk-1', body: 'Cannot login', type: 'message' }),
      JSON.stringify({ id: 'msg-2', ticketId: 'tk-1', body: 'Reset done', type: 'reply' }),
      JSON.stringify({ id: 'msg-3', ticketId: 'tk-2', body: 'Invoice query', type: 'message' }),
    ].join('\n') + '\n';

    const rules = [
      JSON.stringify({ id: 'rule-1', name: 'Auto-assign', enabled: true }),
    ].join('\n') + '\n';

    writeFileSync(join(TEST_DIR, 'tickets.jsonl'), tickets);
    writeFileSync(join(TEST_DIR, 'messages.jsonl'), messages);
    writeFileSync(join(TEST_DIR, 'automation-rules.jsonl'), rules);
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    delete process.env.CLIAAS_DATA_DIR;
  });

  it('clones all default data into sandbox directory', async () => {
    const { cloneToSandbox } = await import('@/lib/sandbox-clone');
    const manifest = cloneToSandbox('test-sbx-1');

    expect(manifest.sandboxId).toBe('test-sbx-1');
    expect(manifest.clonedFiles).toContain('tickets.jsonl');
    expect(manifest.clonedFiles).toContain('messages.jsonl');
    expect(manifest.clonedFiles).toContain('automation-rules.jsonl');

    // Verify files exist in sandbox dir
    const sbxDir = join(TEST_DIR, 'sandboxes', 'test-sbx-1');
    expect(existsSync(join(sbxDir, 'tickets.jsonl'))).toBe(true);
    expect(existsSync(join(sbxDir, 'messages.jsonl'))).toBe(true);
    expect(existsSync(join(sbxDir, '_manifest.json'))).toBe(true);
  });

  it('remaps IDs in cloned data', async () => {
    const { cloneToSandbox } = await import('@/lib/sandbox-clone');
    const manifest = cloneToSandbox('test-sbx-2');

    // IDs should be remapped
    expect(Object.keys(manifest.idMappings).length).toBeGreaterThan(0);
    expect(manifest.idMappings['tk-1']).toBeDefined();
    expect(manifest.idMappings['tk-1']).not.toBe('tk-1');

    // Read cloned tickets and verify new IDs
    const sbxDir = join(TEST_DIR, 'sandboxes', 'test-sbx-2');
    const clonedTickets = readFileSync(join(sbxDir, 'tickets.jsonl'), 'utf-8')
      .split('\n')
      .filter(l => l.trim())
      .map(l => JSON.parse(l));

    expect(clonedTickets[0].id).toBe(manifest.idMappings['tk-1']);
    expect(clonedTickets[1].id).toBe(manifest.idMappings['tk-2']);
  });

  it('remaps foreign keys in messages', async () => {
    const { cloneToSandbox } = await import('@/lib/sandbox-clone');
    const manifest = cloneToSandbox('test-sbx-3');

    const sbxDir = join(TEST_DIR, 'sandboxes', 'test-sbx-3');
    const clonedMsgs = readFileSync(join(sbxDir, 'messages.jsonl'), 'utf-8')
      .split('\n')
      .filter(l => l.trim())
      .map(l => JSON.parse(l));

    // Messages' ticketId should be remapped to match cloned ticket IDs
    const remappedTicketId = manifest.idMappings['tk-1'];
    const msgsForTk1 = clonedMsgs.filter((m: { ticketId: string }) => m.ticketId === remappedTicketId);
    expect(msgsForTk1.length).toBe(2);
  });

  it('respects clone options — exclude rules', async () => {
    const { cloneToSandbox } = await import('@/lib/sandbox-clone');
    const manifest = cloneToSandbox('test-sbx-4', { includeRules: false });

    expect(manifest.clonedFiles).not.toContain('automation-rules.jsonl');
    const sbxDir = join(TEST_DIR, 'sandboxes', 'test-sbx-4');
    expect(existsSync(join(sbxDir, 'automation-rules.jsonl'))).toBe(false);
  });

  it('teardown removes sandbox directory', async () => {
    const { cloneToSandbox, teardownSandbox } = await import('@/lib/sandbox-clone');
    cloneToSandbox('test-sbx-5');

    const sbxDir = join(TEST_DIR, 'sandboxes', 'test-sbx-5');
    expect(existsSync(sbxDir)).toBe(true);

    teardownSandbox('test-sbx-5');
    expect(existsSync(sbxDir)).toBe(false);
  });

  it('getCloneManifest retrieves saved manifest', async () => {
    const { cloneToSandbox, getCloneManifest } = await import('@/lib/sandbox-clone');
    cloneToSandbox('test-sbx-6');

    const manifest = getCloneManifest('test-sbx-6');
    expect(manifest).not.toBeNull();
    expect(manifest?.sandboxId).toBe('test-sbx-6');
  });

  it('rejects path traversal in sandbox ID', async () => {
    const { getSandboxDir } = await import('@/lib/sandbox-clone');

    expect(() => getSandboxDir('../../etc')).toThrow('Invalid sandbox ID');
    expect(() => getSandboxDir('../..')).toThrow('Invalid sandbox ID');
    expect(() => getSandboxDir('test/../../etc')).toThrow('Invalid sandbox ID');
    expect(() => getSandboxDir('')).toThrow('Invalid sandbox ID');

    // Valid IDs should work
    expect(() => getSandboxDir('valid-sandbox-123')).not.toThrow();
    expect(() => getSandboxDir('sandbox_test')).not.toThrow();
  });
});
