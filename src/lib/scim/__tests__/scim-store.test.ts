import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'fs';

const TEST_DIR = '/tmp/cliaas-test-scim-store-' + process.pid;

describe('SCIM store', () => {
  beforeEach(() => {
    process.env.CLIAAS_DATA_DIR = TEST_DIR;
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    // Reset globals
    delete (global as Record<string, unknown>).__cliaasScimUsers;
    delete (global as Record<string, unknown>).__cliaasScimUsersLoaded;
    delete (global as Record<string, unknown>).__cliaasScimGroups;
    delete (global as Record<string, unknown>).__cliaasScimGroupsLoaded;
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    delete process.env.CLIAAS_DATA_DIR;
    delete (global as Record<string, unknown>).__cliaasScimUsers;
    delete (global as Record<string, unknown>).__cliaasScimUsersLoaded;
    delete (global as Record<string, unknown>).__cliaasScimGroups;
    delete (global as Record<string, unknown>).__cliaasScimGroupsLoaded;
  });

  // ---- User CRUD ----

  describe('user CRUD', () => {
    it('createUser returns a user with generated id and timestamps', async () => {
      const { createUser } = await import('../store');
      const user = createUser({
        email: 'alice@example.com',
        name: 'Alice',
        role: 'agent',
        status: 'active',
      });
      expect(user.id).toBeTruthy();
      expect(user.email).toBe('alice@example.com');
      expect(user.name).toBe('Alice');
      expect(user.role).toBe('agent');
      expect(user.status).toBe('active');
      expect(user.createdAt).toBeTruthy();
      expect(user.updatedAt).toBeTruthy();
    });

    it('getUser retrieves a user by id', async () => {
      const { createUser, getUser } = await import('../store');
      const created = createUser({
        email: 'bob@example.com',
        name: 'Bob',
        role: 'admin',
        status: 'active',
      });
      const fetched = getUser(created.id);
      expect(fetched).toBeDefined();
      expect(fetched!.email).toBe('bob@example.com');
    });

    it('getUser returns undefined for nonexistent id', async () => {
      const { getUser } = await import('../store');
      expect(getUser('nonexistent-id')).toBeUndefined();
    });

    it('getUserByEmail retrieves a user by email', async () => {
      const { createUser, getUserByEmail } = await import('../store');
      createUser({
        email: 'carol@example.com',
        name: 'Carol',
        role: 'viewer',
        status: 'active',
      });
      const fetched = getUserByEmail('carol@example.com');
      expect(fetched).toBeDefined();
      expect(fetched!.name).toBe('Carol');
    });

    it('getUserByEmail returns undefined when email not found', async () => {
      const { getUserByEmail } = await import('../store');
      expect(getUserByEmail('nobody@example.com')).toBeUndefined();
    });

    it('updateUser modifies fields and updates timestamp', async () => {
      const { createUser, updateUser, getUser } = await import('../store');
      const created = createUser({
        email: 'dave@example.com',
        name: 'Dave',
        role: 'agent',
        status: 'active',
      });
      // Small delay so updatedAt differs
      await new Promise(r => setTimeout(r, 5));
      const updated = updateUser(created.id, { name: 'David', role: 'admin' });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('David');
      expect(updated!.role).toBe('admin');
      expect(updated!.email).toBe('dave@example.com'); // unchanged
      expect(updated!.updatedAt).not.toBe(created.updatedAt);

      // Verify via getUser
      const fetched = getUser(created.id);
      expect(fetched!.name).toBe('David');
    });

    it('updateUser returns null for nonexistent id', async () => {
      const { updateUser } = await import('../store');
      expect(updateUser('nonexistent', { name: 'Nope' })).toBeNull();
    });

    it('deleteUser removes a user and returns true', async () => {
      const { createUser, deleteUser, getUser } = await import('../store');
      const created = createUser({
        email: 'eve@example.com',
        name: 'Eve',
        role: 'agent',
        status: 'active',
      });
      expect(deleteUser(created.id)).toBe(true);
      expect(getUser(created.id)).toBeUndefined();
    });

    it('deleteUser returns false for nonexistent id', async () => {
      const { deleteUser } = await import('../store');
      expect(deleteUser('nonexistent')).toBe(false);
    });
  });

  // ---- Group CRUD ----

  describe('group CRUD', () => {
    it('createGroup returns a group with generated id and timestamps', async () => {
      const { createGroup } = await import('../store');
      const group = createGroup({
        name: 'Engineering',
        workspaceId: 'ws-1',
      });
      expect(group.id).toBeTruthy();
      expect(group.name).toBe('Engineering');
      expect(group.workspaceId).toBe('ws-1');
      expect(group.createdAt).toBeTruthy();
      expect(group.updatedAt).toBeTruthy();
    });

    it('getGroup retrieves a group by id', async () => {
      const { createGroup, getGroup } = await import('../store');
      const created = createGroup({ name: 'Support' });
      const fetched = getGroup(created.id);
      expect(fetched).toBeDefined();
      expect(fetched!.name).toBe('Support');
    });

    it('getGroup returns undefined for nonexistent id', async () => {
      const { getGroup } = await import('../store');
      expect(getGroup('nonexistent')).toBeUndefined();
    });

    it('updateGroup modifies fields and updates timestamp', async () => {
      const { createGroup, updateGroup } = await import('../store');
      const created = createGroup({ name: 'Old Name' });
      await new Promise(r => setTimeout(r, 5));
      const updated = updateGroup(created.id, {
        name: 'New Name',
        members: [{ id: 'u-1', name: 'Alice' }],
      });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('New Name');
      expect(updated!.members).toHaveLength(1);
      expect(updated!.updatedAt).not.toBe(created.updatedAt);
    });

    it('updateGroup returns null for nonexistent id', async () => {
      const { updateGroup } = await import('../store');
      expect(updateGroup('nonexistent', { name: 'Nope' })).toBeNull();
    });

    it('deleteGroup removes a group and returns true', async () => {
      const { createGroup, deleteGroup, getGroup } = await import('../store');
      const created = createGroup({ name: 'Temp' });
      expect(deleteGroup(created.id)).toBe(true);
      expect(getGroup(created.id)).toBeUndefined();
    });

    it('deleteGroup returns false for nonexistent id', async () => {
      const { deleteGroup } = await import('../store');
      expect(deleteGroup('nonexistent')).toBe(false);
    });
  });

  // ---- JSONL Persistence ----

  describe('JSONL persistence', () => {
    it('user data survives global reset and re-import', async () => {
      const store1 = await import('../store');
      const created = store1.createUser({
        email: 'persist@example.com',
        name: 'Persist',
        role: 'agent',
        status: 'active',
        workspaceId: 'ws-1',
      });

      // Reset globals to simulate fresh process
      delete (global as Record<string, unknown>).__cliaasScimUsers;
      delete (global as Record<string, unknown>).__cliaasScimUsersLoaded;

      // Re-import loads from JSONL
      const store2 = await import('../store');
      const fetched = store2.getUser(created.id);
      expect(fetched).toBeDefined();
      expect(fetched!.email).toBe('persist@example.com');
      expect(fetched!.name).toBe('Persist');
    });

    it('group data survives global reset and re-import', async () => {
      const store1 = await import('../store');
      const created = store1.createGroup({
        name: 'Persistent Group',
        workspaceId: 'ws-2',
      });

      // Reset globals
      delete (global as Record<string, unknown>).__cliaasScimGroups;
      delete (global as Record<string, unknown>).__cliaasScimGroupsLoaded;

      const store2 = await import('../store');
      const fetched = store2.getGroup(created.id);
      expect(fetched).toBeDefined();
      expect(fetched!.name).toBe('Persistent Group');
    });
  });

  // ---- Workspace Scoping ----

  describe('workspace scoping', () => {
    it('getUsers filters by workspaceId', async () => {
      const { createUser, getUsers } = await import('../store');
      createUser({ email: 'a@test.com', name: 'A', role: 'agent', status: 'active', workspaceId: 'ws-1' });
      createUser({ email: 'b@test.com', name: 'B', role: 'agent', status: 'active', workspaceId: 'ws-2' });
      createUser({ email: 'c@test.com', name: 'C', role: 'agent', status: 'active', workspaceId: 'ws-1' });
      // No workspaceId set — should be included in both filtered and unfiltered
      createUser({ email: 'd@test.com', name: 'D', role: 'agent', status: 'active' });

      const ws1Users = getUsers('ws-1');
      expect(ws1Users).toHaveLength(3); // A, C, and D (no workspaceId = included)
      expect(ws1Users.map((u: { email: string }) => u.email).sort()).toEqual(
        ['a@test.com', 'c@test.com', 'd@test.com'],
      );

      const ws2Users = getUsers('ws-2');
      expect(ws2Users).toHaveLength(2); // B and D

      const allUsers = getUsers();
      expect(allUsers).toHaveLength(4);
    });

    it('getGroups filters by workspaceId', async () => {
      const { createGroup, getGroups } = await import('../store');
      createGroup({ name: 'G1', workspaceId: 'ws-1' });
      createGroup({ name: 'G2', workspaceId: 'ws-2' });
      createGroup({ name: 'G3' }); // no workspaceId

      const ws1Groups = getGroups('ws-1');
      expect(ws1Groups).toHaveLength(2); // G1 + G3 (no workspaceId = included)

      const allGroups = getGroups();
      expect(allGroups).toHaveLength(3);
    });
  });
});
