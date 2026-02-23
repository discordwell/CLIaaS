import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const TEST_DIR = '/tmp/cliaas-test-sandbox-diff-' + process.pid;

describe('sandbox-diff', () => {
  beforeEach(() => {
    process.env.CLIAAS_DATA_DIR = TEST_DIR;
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });

    // Seed production data
    writeFileSync(
      join(TEST_DIR, 'tickets.jsonl'),
      [
        JSON.stringify({ id: 'tk-1', subject: 'Login issue', status: 'open' }),
        JSON.stringify({ id: 'tk-2', subject: 'Billing', status: 'pending' }),
      ].join('\n') + '\n',
    );
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    delete process.env.CLIAAS_DATA_DIR;
  });

  it('detects no changes when sandbox matches production', async () => {
    const { cloneToSandbox } = await import('@/lib/sandbox-clone');
    const { diffSandbox } = await import('@/lib/sandbox-diff');

    cloneToSandbox('diff-test-1');
    const diff = diffSandbox('diff-test-1');

    expect(diff.summary.total).toBe(0);
    expect(diff.entries).toHaveLength(0);
  });

  it('detects modified items', async () => {
    const { cloneToSandbox, getCloneManifest } = await import('@/lib/sandbox-clone');
    const { diffSandbox } = await import('@/lib/sandbox-diff');

    cloneToSandbox('diff-test-2');

    // Modify a ticket in the sandbox
    const sbxDir = join(TEST_DIR, 'sandboxes', 'diff-test-2');
    const manifest = getCloneManifest('diff-test-2')!;
    const newTicketId = manifest.idMappings['tk-1'];

    const ticketsContent = readFileSync(join(sbxDir, 'tickets.jsonl'), 'utf-8');
    const modified = ticketsContent.replace('"open"', '"solved"');
    writeFileSync(join(sbxDir, 'tickets.jsonl'), modified);

    const diff = diffSandbox('diff-test-2');
    const modEntry = diff.entries.find(
      (e) => e.action === 'modified' && e.id === newTicketId,
    );

    expect(modEntry).toBeDefined();
    expect(modEntry?.changes?.status).toEqual({ from: 'open', to: 'solved' });
    expect(diff.summary.modified).toBeGreaterThanOrEqual(1);
  });

  it('detects added items', async () => {
    const { cloneToSandbox } = await import('@/lib/sandbox-clone');
    const { diffSandbox } = await import('@/lib/sandbox-diff');

    cloneToSandbox('diff-test-3');

    // Add a new ticket to sandbox
    const sbxDir = join(TEST_DIR, 'sandboxes', 'diff-test-3');
    const existingContent = readFileSync(join(sbxDir, 'tickets.jsonl'), 'utf-8');
    const newTicket = JSON.stringify({ id: 'new-tk-1', subject: 'New ticket', status: 'open' });
    writeFileSync(join(sbxDir, 'tickets.jsonl'), existingContent + newTicket + '\n');

    const diff = diffSandbox('diff-test-3');
    const addedEntry = diff.entries.find(
      (e) => e.action === 'added' && e.id === 'new-tk-1',
    );

    expect(addedEntry).toBeDefined();
    expect(diff.summary.added).toBeGreaterThanOrEqual(1);
  });

  it('detects deleted items', async () => {
    const { cloneToSandbox, getCloneManifest } = await import('@/lib/sandbox-clone');
    const { diffSandbox } = await import('@/lib/sandbox-diff');

    cloneToSandbox('diff-test-4');

    // Remove first ticket from sandbox
    const sbxDir = join(TEST_DIR, 'sandboxes', 'diff-test-4');
    const manifest = getCloneManifest('diff-test-4')!;
    const removedId = manifest.idMappings['tk-1'];

    const ticketsContent = readFileSync(join(sbxDir, 'tickets.jsonl'), 'utf-8');
    const lines = ticketsContent.split('\n').filter((l) => l.trim());
    const filtered = lines.filter((l) => !l.includes(removedId));
    writeFileSync(join(sbxDir, 'tickets.jsonl'), filtered.join('\n') + '\n');

    const diff = diffSandbox('diff-test-4');
    expect(diff.summary.deleted).toBeGreaterThanOrEqual(1);
  });

  it('deep compares nested object changes', async () => {
    // Add a rule with nested config
    writeFileSync(
      join(TEST_DIR, 'automation-rules.jsonl'),
      JSON.stringify({ id: 'rule-1', name: 'Auto-assign', config: { field: 'priority', value: 'high' } }) + '\n',
    );

    const { cloneToSandbox, getCloneManifest } = await import('@/lib/sandbox-clone');
    const { diffSandbox } = await import('@/lib/sandbox-diff');

    cloneToSandbox('diff-test-5');

    // Modify the nested config
    const sbxDir = join(TEST_DIR, 'sandboxes', 'diff-test-5');
    const manifest = getCloneManifest('diff-test-5')!;
    const ruleId = manifest.idMappings['rule-1'];

    const content = readFileSync(join(sbxDir, 'automation-rules.jsonl'), 'utf-8');
    const modified = content.replace('"high"', '"urgent"');
    writeFileSync(join(sbxDir, 'automation-rules.jsonl'), modified);

    const diff = diffSandbox('diff-test-5');
    const modEntry = diff.entries.find(
      (e) => e.action === 'modified' && e.id === ruleId,
    );

    expect(modEntry).toBeDefined();
    expect(modEntry?.changes?.config).toBeDefined();
  });
});
