/**
 * Tests for SCIM store dual-mode (DB + JSONL fallback).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/store-helpers', () => ({
  withRls: vi.fn().mockResolvedValue(null),
  tryDb: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/jsonl-store', () => {
  const store: Record<string, unknown[]> = {};
  return {
    readJsonlFile: vi.fn((file: string) => store[file] ?? []),
    writeJsonlFile: vi.fn((file: string, data: unknown[]) => { store[file] = data; }),
    __store: store,
  };
});

describe('SCIM store — JSONL fallback path', () => {
  beforeEach(() => {
    global.__cliaasScimUsers = undefined;
    global.__cliaasScimUsersLoaded = undefined;
    global.__cliaasScimGroups = undefined;
    global.__cliaasScimGroupsLoaded = undefined;
  });

  it('getUsersAsync falls back to JSONL when DB unavailable', async () => {
    const { getUsersAsync } = await import('../store');
    const result = await getUsersAsync('ws-123');
    expect(Array.isArray(result)).toBe(true);
  });

  it('createUserAsync falls back to JSONL sync version', async () => {
    const { createUserAsync, getUsers } = await import('../store');
    const user = await createUserAsync({
      email: 'test@example.com',
      name: 'Test User',
      role: 'agent',
      status: 'active',
      workspaceId: 'ws-123',
    }, 'ws-123');
    expect(user.id).toBeTruthy();
    expect(user.email).toBe('test@example.com');

    const all = getUsers('ws-123');
    expect(all.find(u => u.email === 'test@example.com')).toBeDefined();
  });

  it('updateUserAsync falls back to JSONL sync version', async () => {
    const { createUserAsync, updateUserAsync } = await import('../store');
    const user = await createUserAsync({
      email: 'upd@example.com',
      name: 'Update Me',
      role: 'agent',
      status: 'active',
      workspaceId: 'ws-123',
    }, 'ws-123');

    const updated = await updateUserAsync(user.id, { name: 'Updated Name' }, 'ws-123');
    expect(updated?.name).toBe('Updated Name');
  });

  it('deleteUserAsync falls back to JSONL sync version', async () => {
    const { createUserAsync, deleteUserAsync, getUsers } = await import('../store');
    const user = await createUserAsync({
      email: 'del@example.com',
      name: 'Delete Me',
      role: 'agent',
      status: 'active',
      workspaceId: 'ws-123',
    }, 'ws-123');

    const deleted = await deleteUserAsync(user.id, 'ws-123');
    expect(deleted).toBe(true);

    const all = getUsers('ws-123');
    expect(all.find(u => u.email === 'del@example.com')).toBeUndefined();
  });

  it('getGroupsAsync falls back to JSONL when DB unavailable', async () => {
    const { getGroupsAsync } = await import('../store');
    const result = await getGroupsAsync('ws-123');
    expect(Array.isArray(result)).toBe(true);
  });

  it('createGroupAsync falls back to JSONL sync version', async () => {
    const { createGroupAsync, getGroups } = await import('../store');
    const group = await createGroupAsync({
      name: 'Test Group',
      workspaceId: 'ws-123',
    }, 'ws-123');
    expect(group.id).toBeTruthy();
    expect(group.name).toBe('Test Group');

    const all = getGroups('ws-123');
    expect(all.find(g => g.name === 'Test Group')).toBeDefined();
  });
});
