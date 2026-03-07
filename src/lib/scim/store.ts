/**
 * SCIM user/group store — JSONL-persistent with workspace scoping.
 * Replaces bare in-memory globals with persistent storage.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { withRls } from '../store-helpers';

export interface SCIMUserRecord {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  workspaceId?: string;
  externalId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SCIMGroupRecord {
  id: string;
  name: string;
  workspaceId?: string;
  createdAt: string;
  updatedAt: string;
  members?: Array<{ id: string; name: string }>;
}

// ---- JSONL files ----

const USERS_FILE = 'scim-users.jsonl';
const GROUPS_FILE = 'scim-groups.jsonl';

// ---- Global singleton with JSONL load ----

declare global {
  // eslint-disable-next-line no-var
  var __cliaasScimUsers: SCIMUserRecord[] | undefined;
  // eslint-disable-next-line no-var
  var __cliaasScimUsersLoaded: boolean | undefined;
  // eslint-disable-next-line no-var
  var __cliaasScimGroups: SCIMGroupRecord[] | undefined;
  // eslint-disable-next-line no-var
  var __cliaasScimGroupsLoaded: boolean | undefined;
}

function loadUsers(): SCIMUserRecord[] {
  if (!global.__cliaasScimUsers || !global.__cliaasScimUsersLoaded) {
    global.__cliaasScimUsers = readJsonlFile<SCIMUserRecord>(USERS_FILE);
    global.__cliaasScimUsersLoaded = true;
  }
  return global.__cliaasScimUsers;
}

function loadGroups(): SCIMGroupRecord[] {
  if (!global.__cliaasScimGroups || !global.__cliaasScimGroupsLoaded) {
    global.__cliaasScimGroups = readJsonlFile<SCIMGroupRecord>(GROUPS_FILE);
    global.__cliaasScimGroupsLoaded = true;
  }
  return global.__cliaasScimGroups;
}

function persistUsers(): void {
  writeJsonlFile(USERS_FILE, loadUsers());
}

function persistGroups(): void {
  writeJsonlFile(GROUPS_FILE, loadGroups());
}

// ---- User operations ----

export function getUsers(workspaceId?: string): SCIMUserRecord[] {
  const users = loadUsers();
  if (workspaceId) return users.filter(u => !u.workspaceId || u.workspaceId === workspaceId);
  return [...users];
}

export function getUser(id: string): SCIMUserRecord | undefined {
  return loadUsers().find(u => u.id === id);
}

export function getUserByEmail(email: string): SCIMUserRecord | undefined {
  return loadUsers().find(u => u.email === email);
}

export function setUsers(users: SCIMUserRecord[]): void {
  global.__cliaasScimUsers = users;
  global.__cliaasScimUsersLoaded = true;
  persistUsers();
}

export function createUser(user: Omit<SCIMUserRecord, 'id' | 'createdAt' | 'updatedAt'>): SCIMUserRecord {
  const users = loadUsers();
  const now = new Date().toISOString();
  const record: SCIMUserRecord = {
    ...user,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  users.push(record);
  persistUsers();
  return record;
}

export function updateUser(id: string, updates: Partial<Omit<SCIMUserRecord, 'id' | 'createdAt'>>): SCIMUserRecord | null {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return null;
  users[idx] = { ...users[idx], ...updates, updatedAt: new Date().toISOString() };
  persistUsers();
  return users[idx];
}

export function deleteUser(id: string): boolean {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return false;
  users.splice(idx, 1);
  persistUsers();
  return true;
}

// ---- Group operations ----

export function getGroups(workspaceId?: string): SCIMGroupRecord[] {
  const groups = loadGroups();
  if (workspaceId) return groups.filter(g => !g.workspaceId || g.workspaceId === workspaceId);
  return [...groups];
}

export function getGroup(id: string): SCIMGroupRecord | undefined {
  return loadGroups().find(g => g.id === id);
}

export function setGroups(groups: SCIMGroupRecord[]): void {
  global.__cliaasScimGroups = groups;
  global.__cliaasScimGroupsLoaded = true;
  persistGroups();
}

export function createGroup(group: Omit<SCIMGroupRecord, 'id' | 'createdAt' | 'updatedAt'>): SCIMGroupRecord {
  const groups = loadGroups();
  const now = new Date().toISOString();
  const record: SCIMGroupRecord = {
    ...group,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  groups.push(record);
  persistGroups();
  return record;
}

export function updateGroup(id: string, updates: Partial<Omit<SCIMGroupRecord, 'id' | 'createdAt'>>): SCIMGroupRecord | null {
  const groups = loadGroups();
  const idx = groups.findIndex(g => g.id === id);
  if (idx === -1) return null;
  groups[idx] = { ...groups[idx], ...updates, updatedAt: new Date().toISOString() };
  persistGroups();
  return groups[idx];
}

export function deleteGroup(id: string): boolean {
  const groups = loadGroups();
  const idx = groups.findIndex(g => g.id === id);
  if (idx === -1) return false;
  groups.splice(idx, 1);
  persistGroups();
  return true;
}

// ---- Async DB-first variants (JSONL fallback) ----

export async function getUsersAsync(workspaceId: string): Promise<SCIMUserRecord[]> {
  const dbResult = await withRls(workspaceId, async ({ db, schema }) => {
    const rows = await db.select().from(schema.scimUsers);
    return rows.map(r => ({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      status: r.status,
      workspaceId: r.workspaceId,
      externalId: r.externalId ?? undefined,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
  return dbResult ?? getUsers(workspaceId);
}

export async function createUserAsync(
  user: Omit<SCIMUserRecord, 'id' | 'createdAt' | 'updatedAt'>,
  workspaceId: string,
): Promise<SCIMUserRecord> {
  const dbResult = await withRls(workspaceId, async ({ db, schema }) => {
    const [row] = await db.insert(schema.scimUsers).values({
      workspaceId,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      externalId: user.externalId ?? null,
    }).returning();
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      status: row.status,
      workspaceId: row.workspaceId,
      externalId: row.externalId ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
  return dbResult ?? createUser(user);
}

export async function updateUserAsync(
  id: string,
  updates: Partial<Omit<SCIMUserRecord, 'id' | 'createdAt'>>,
  workspaceId: string,
): Promise<SCIMUserRecord | null> {
  const dbResult = await withRls(workspaceId, async ({ db, schema }) => {
    const { eq } = await import('drizzle-orm');
    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(updates)) {
      if (k !== 'updatedAt') set[k] = v ?? null;
    }
    const [row] = await db.update(schema.scimUsers)
      .set(set).where(eq(schema.scimUsers.id, id)).returning();
    if (!row) return null;
    return {
      id: row.id, email: row.email, name: row.name,
      role: row.role, status: row.status, workspaceId: row.workspaceId,
      externalId: row.externalId ?? undefined,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  });
  return dbResult ?? updateUser(id, updates);
}

export async function deleteUserAsync(id: string, workspaceId: string): Promise<boolean> {
  const dbResult = await withRls(workspaceId, async ({ db, schema }) => {
    const { eq } = await import('drizzle-orm');
    const result = await db.delete(schema.scimUsers).where(eq(schema.scimUsers.id, id));
    return (result.rowCount ?? 0) > 0;
  });
  return dbResult ?? deleteUser(id);
}

export async function getGroupsAsync(workspaceId: string): Promise<SCIMGroupRecord[]> {
  const dbResult = await withRls(workspaceId, async ({ db, schema }) => {
    const { eq } = await import('drizzle-orm');
    const groups = await db.select().from(schema.scimGroups);
    const result: SCIMGroupRecord[] = [];
    for (const g of groups) {
      const memberRows = await db.select({
        userId: schema.scimGroupMembers.userId,
      }).from(schema.scimGroupMembers)
        .where(eq(schema.scimGroupMembers.groupId, g.id));

      const members: Array<{ id: string; name: string }> = [];
      for (const m of memberRows) {
        const [user] = await db.select({ id: schema.scimUsers.id, name: schema.scimUsers.name })
          .from(schema.scimUsers).where(eq(schema.scimUsers.id, m.userId)).limit(1);
        if (user) members.push({ id: user.id, name: user.name });
      }
      result.push({
        id: g.id, name: g.name, workspaceId: g.workspaceId,
        createdAt: g.createdAt.toISOString(), updatedAt: g.updatedAt.toISOString(),
        members,
      });
    }
    return result;
  });
  return dbResult ?? getGroups(workspaceId);
}

export async function createGroupAsync(
  group: Omit<SCIMGroupRecord, 'id' | 'createdAt' | 'updatedAt'>,
  workspaceId: string,
): Promise<SCIMGroupRecord> {
  const dbResult = await withRls(workspaceId, async ({ db, schema }) => {
    const [row] = await db.insert(schema.scimGroups).values({
      workspaceId,
      name: group.name,
    }).returning();
    // Add members if provided
    if (group.members?.length) {
      for (const m of group.members) {
        await db.insert(schema.scimGroupMembers).values({
          groupId: row.id, userId: m.id, workspaceId,
        }).onConflictDoNothing();
      }
    }
    return {
      id: row.id, name: row.name, workspaceId: row.workspaceId,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      members: group.members ?? [],
    };
  });
  return dbResult ?? createGroup(group);
}
