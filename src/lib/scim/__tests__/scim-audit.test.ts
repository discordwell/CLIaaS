import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';

const TEST_DIR = '/tmp/cliaas-test-scim-audit-' + process.pid;

vi.mock('@/lib/store-helpers', () => ({
  withRls: vi.fn().mockResolvedValue(null),
  tryDb: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/jsonl-store', async () => {
  const { mkdirSync, existsSync: exists, readFileSync, writeFileSync, appendFileSync } = await import('fs');
  const { join } = await import('path');

  function getDir() {
    return process.env.CLIAAS_DATA_DIR || '/tmp/cliaas-demo';
  }

  function ensureDir() {
    if (!exists(getDir())) mkdirSync(getDir(), { recursive: true });
  }

  return {
    readJsonlFile: vi.fn((file: string) => {
      const p = join(getDir(), file);
      if (!exists(p)) return [];
      const results: unknown[] = [];
      for (const line of readFileSync(p, 'utf-8').split('\n')) {
        if (!line.trim()) continue;
        try { results.push(JSON.parse(line)); } catch { /* skip */ }
      }
      return results;
    }),
    writeJsonlFile: vi.fn((file: string, items: unknown[]) => {
      ensureDir();
      writeFileSync(join(getDir(), file), items.map(i => JSON.stringify(i)).join('\n') + '\n', 'utf-8');
    }),
    appendJsonlLine: vi.fn((file: string, item: unknown) => {
      ensureDir();
      appendFileSync(join(getDir(), file), JSON.stringify(item) + '\n', 'utf-8');
    }),
  };
});

describe('SCIM audit logging', () => {
  beforeEach(() => {
    process.env.CLIAAS_DATA_DIR = TEST_DIR;
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    // Reset all globals
    delete (global as Record<string, unknown>).__cliaasScimUsers;
    delete (global as Record<string, unknown>).__cliaasScimUsersLoaded;
    delete (global as Record<string, unknown>).__cliaasScimGroups;
    delete (global as Record<string, unknown>).__cliaasScimGroupsLoaded;
    delete (global as Record<string, unknown>).__cliaasScimAuditLog;
    delete (global as Record<string, unknown>).__cliaasScimAuditLogLoaded;
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    delete process.env.CLIAAS_DATA_DIR;
    delete (global as Record<string, unknown>).__cliaasScimUsers;
    delete (global as Record<string, unknown>).__cliaasScimUsersLoaded;
    delete (global as Record<string, unknown>).__cliaasScimGroups;
    delete (global as Record<string, unknown>).__cliaasScimGroupsLoaded;
    delete (global as Record<string, unknown>).__cliaasScimAuditLog;
    delete (global as Record<string, unknown>).__cliaasScimAuditLogLoaded;
  });

  it('creating a user logs an audit entry', async () => {
    const { createUser, getScimAuditLog } = await import('../store');
    const user = createUser({
      email: 'alice@example.com',
      name: 'Alice',
      role: 'agent',
      status: 'active',
      workspaceId: 'ws-1',
    });

    const entries = getScimAuditLog('ws-1');
    expect(entries.length).toBeGreaterThanOrEqual(1);

    const entry = entries.find(e => e.action === 'user.created' && e.entityId === user.id);
    expect(entry).toBeDefined();
    expect(entry!.entityType).toBe('user');
    expect(entry!.workspaceId).toBe('ws-1');
    expect(entry!.changes).toBeDefined();
    expect((entry!.changes as { email: string }).email).toBe('alice@example.com');
  });

  it('updating a user logs an audit entry with changes', async () => {
    const { createUser, updateUser, getScimAuditLog } = await import('../store');
    const user = createUser({
      email: 'bob@example.com',
      name: 'Bob',
      role: 'agent',
      status: 'active',
      workspaceId: 'ws-1',
    });

    updateUser(user.id, { name: 'Robert', role: 'admin' });

    const entries = getScimAuditLog('ws-1');
    const updateEntry = entries.find(e => e.action === 'user.updated' && e.entityId === user.id);
    expect(updateEntry).toBeDefined();
    expect(updateEntry!.entityType).toBe('user');
    expect((updateEntry!.changes as { name: string; role: string }).name).toBe('Robert');
    expect((updateEntry!.changes as { name: string; role: string }).role).toBe('admin');
  });

  it('deleting a user logs an audit entry', async () => {
    const { createUser, deleteUser, getScimAuditLog } = await import('../store');
    const user = createUser({
      email: 'charlie@example.com',
      name: 'Charlie',
      role: 'agent',
      status: 'active',
      workspaceId: 'ws-1',
    });

    deleteUser(user.id);

    const entries = getScimAuditLog('ws-1');
    const deleteEntry = entries.find(e => e.action === 'user.deleted' && e.entityId === user.id);
    expect(deleteEntry).toBeDefined();
    expect(deleteEntry!.entityType).toBe('user');
  });

  it('audit log returns entries in reverse chronological order', async () => {
    const { createUser, updateUser, deleteUser, getScimAuditLog } = await import('../store');

    const user1 = createUser({
      email: 'first@example.com',
      name: 'First',
      role: 'agent',
      status: 'active',
      workspaceId: 'ws-1',
    });

    // Small delay to ensure distinct timestamps
    await new Promise(r => setTimeout(r, 5));

    updateUser(user1.id, { name: 'Updated First' });

    await new Promise(r => setTimeout(r, 5));

    const user2 = createUser({
      email: 'second@example.com',
      name: 'Second',
      role: 'agent',
      status: 'active',
      workspaceId: 'ws-1',
    });

    const entries = getScimAuditLog('ws-1');
    expect(entries.length).toBeGreaterThanOrEqual(3);

    // Verify reverse chronological: each entry's timestamp >= next entry's timestamp
    for (let i = 0; i < entries.length - 1; i++) {
      expect(new Date(entries[i].timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(entries[i + 1].timestamp).getTime(),
      );
    }

    // Most recent should be user2 creation
    expect(entries[0].action).toBe('user.created');
    expect(entries[0].entityId).toBe(user2.id);
  });

  it('filtering by entityType works', async () => {
    const { createUser, createGroup, getScimAuditLog } = await import('../store');

    createUser({
      email: 'filter@example.com',
      name: 'Filter Test',
      role: 'agent',
      status: 'active',
      workspaceId: 'ws-1',
    });

    createGroup({
      name: 'Test Group',
      workspaceId: 'ws-1',
    });

    const userEntries = getScimAuditLog('ws-1', { entityType: 'user' });
    const groupEntries = getScimAuditLog('ws-1', { entityType: 'group' });
    const allEntries = getScimAuditLog('ws-1');

    expect(userEntries.length).toBeGreaterThanOrEqual(1);
    expect(groupEntries.length).toBeGreaterThanOrEqual(1);
    expect(allEntries.length).toBe(userEntries.length + groupEntries.length);

    // All user entries should have entityType 'user'
    for (const e of userEntries) {
      expect(e.entityType).toBe('user');
    }

    // All group entries should have entityType 'group'
    for (const e of groupEntries) {
      expect(e.entityType).toBe('group');
    }
  });

  it('group mutations also produce audit entries', async () => {
    const { createGroup, updateGroup, deleteGroup, getScimAuditLog } = await import('../store');

    const group = createGroup({
      name: 'Audit Group',
      workspaceId: 'ws-2',
    });

    updateGroup(group.id, { name: 'Renamed Group' });
    deleteGroup(group.id);

    const entries = getScimAuditLog('ws-2', { entityType: 'group' });
    const actions = entries.map(e => e.action);
    expect(actions).toContain('group.created');
    expect(actions).toContain('group.updated');
    expect(actions).toContain('group.deleted');
  });

  it('workspace isolation: entries only return for matching workspace', async () => {
    const { createUser, getScimAuditLog } = await import('../store');

    createUser({
      email: 'ws1@example.com',
      name: 'WS1 User',
      role: 'agent',
      status: 'active',
      workspaceId: 'ws-a',
    });

    createUser({
      email: 'ws2@example.com',
      name: 'WS2 User',
      role: 'agent',
      status: 'active',
      workspaceId: 'ws-b',
    });

    const wsAEntries = getScimAuditLog('ws-a');
    const wsBEntries = getScimAuditLog('ws-b');

    expect(wsAEntries.length).toBe(1);
    expect(wsBEntries.length).toBe(1);
    expect(wsAEntries[0].workspaceId).toBe('ws-a');
    expect(wsBEntries[0].workspaceId).toBe('ws-b');
  });
});
