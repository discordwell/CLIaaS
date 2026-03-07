/**
 * SCIM user/group store — JSONL-persistent with workspace scoping.
 * Replaces bare in-memory globals with persistent storage.
 */

import { readJsonlFile, writeJsonlFile, appendJsonlLine } from '../jsonl-store';
import { withRls, tryDb } from '../store-helpers';

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

// ---- Audit logging ----

export interface SCIMAuditEntry {
  id: string;
  workspaceId: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId?: string;
  changes?: unknown;
  timestamp: string;
}

const AUDIT_FILE = 'scim-audit.jsonl';

declare global {
  // eslint-disable-next-line no-var
  var __cliaasScimAuditLog: SCIMAuditEntry[] | undefined;
  // eslint-disable-next-line no-var
  var __cliaasScimAuditLogLoaded: boolean | undefined;
}

function loadAuditLog(): SCIMAuditEntry[] {
  if (!global.__cliaasScimAuditLog || !global.__cliaasScimAuditLogLoaded) {
    global.__cliaasScimAuditLog = readJsonlFile<SCIMAuditEntry>(AUDIT_FILE);
    global.__cliaasScimAuditLogLoaded = true;
  }
  return global.__cliaasScimAuditLog;
}

/**
 * Fire-and-forget audit log writer.
 * Tries DB first via tryDb(), falls back to JSONL file append.
 */
export function logScimAudit(entry: Omit<SCIMAuditEntry, 'id' | 'timestamp'>): void {
  const record: SCIMAuditEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };

  // Append to in-memory list (for query)
  const log = loadAuditLog();
  log.push(record);

  // Fire-and-forget: try DB, fall back to JSONL
  void (async () => {
    try {
      const ctx = await tryDb();
      if (ctx) {
        await ctx.db.insert(ctx.schema.scimAuditLog).values({
          workspaceId: record.workspaceId,
          action: record.action,
          entityType: record.entityType,
          entityId: record.entityId,
          actorId: record.actorId ?? null,
          changes: record.changes ?? null,
          timestamp: new Date(record.timestamp),
        });
        return;
      }
    } catch {
      // DB write failed — fall through to JSONL
    }
    appendJsonlLine(AUDIT_FILE, record);
  })();
}

export function getScimAuditLog(
  workspaceId: string,
  options?: { entityType?: string; entityId?: string; limit?: number },
): SCIMAuditEntry[] {
  const log = loadAuditLog();
  let results = log.filter(e => e.workspaceId === workspaceId);
  if (options?.entityType) {
    results = results.filter(e => e.entityType === options.entityType);
  }
  if (options?.entityId) {
    results = results.filter(e => e.entityId === options.entityId);
  }
  // Reverse chronological order
  results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const limit = options?.limit ?? 100;
  return results.slice(0, limit);
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
  logScimAudit({
    workspaceId: record.workspaceId ?? 'default',
    action: 'user.created',
    entityType: 'user',
    entityId: record.id,
    changes: record,
  });
  return record;
}

export function updateUser(id: string, updates: Partial<Omit<SCIMUserRecord, 'id' | 'createdAt'>>): SCIMUserRecord | null {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return null;
  users[idx] = { ...users[idx], ...updates, updatedAt: new Date().toISOString() };
  persistUsers();
  logScimAudit({
    workspaceId: users[idx].workspaceId ?? 'default',
    action: 'user.updated',
    entityType: 'user',
    entityId: id,
    changes: updates,
  });
  return users[idx];
}

export function deleteUser(id: string): boolean {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return false;
  const deleted = users[idx];
  users.splice(idx, 1);
  persistUsers();
  logScimAudit({
    workspaceId: deleted.workspaceId ?? 'default',
    action: 'user.deleted',
    entityType: 'user',
    entityId: id,
  });
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
  logScimAudit({
    workspaceId: record.workspaceId ?? 'default',
    action: 'group.created',
    entityType: 'group',
    entityId: record.id,
    changes: record,
  });
  return record;
}

export function updateGroup(id: string, updates: Partial<Omit<SCIMGroupRecord, 'id' | 'createdAt'>>): SCIMGroupRecord | null {
  const groups = loadGroups();
  const idx = groups.findIndex(g => g.id === id);
  if (idx === -1) return null;
  groups[idx] = { ...groups[idx], ...updates, updatedAt: new Date().toISOString() };
  persistGroups();
  logScimAudit({
    workspaceId: groups[idx].workspaceId ?? 'default',
    action: 'group.updated',
    entityType: 'group',
    entityId: id,
    changes: updates,
  });
  return groups[idx];
}

export function deleteGroup(id: string): boolean {
  const groups = loadGroups();
  const idx = groups.findIndex(g => g.id === id);
  if (idx === -1) return false;
  const deleted = groups[idx];
  groups.splice(idx, 1);
  persistGroups();
  logScimAudit({
    workspaceId: deleted.workspaceId ?? 'default',
    action: 'group.deleted',
    entityType: 'group',
    entityId: id,
  });
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
    const record = {
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
    logScimAudit({
      workspaceId,
      action: 'user.created',
      entityType: 'user',
      entityId: record.id,
      changes: record,
    });
    return record;
  });
  // sync fallback already calls logScimAudit inside createUser
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
    logScimAudit({
      workspaceId,
      action: 'user.updated',
      entityType: 'user',
      entityId: id,
      changes: updates,
    });
    return {
      id: row.id, email: row.email, name: row.name,
      role: row.role, status: row.status, workspaceId: row.workspaceId,
      externalId: row.externalId ?? undefined,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  });
  // sync fallback already calls logScimAudit inside updateUser
  return dbResult ?? updateUser(id, updates);
}

export async function deleteUserAsync(id: string, workspaceId: string): Promise<boolean> {
  const dbResult = await withRls(workspaceId, async ({ db, schema }) => {
    const { eq } = await import('drizzle-orm');
    const result = await db.delete(schema.scimUsers).where(eq(schema.scimUsers.id, id));
    const deleted = (result.rowCount ?? 0) > 0;
    if (deleted) {
      logScimAudit({
        workspaceId,
        action: 'user.deleted',
        entityType: 'user',
        entityId: id,
      });
    }
    return deleted;
  });
  // sync fallback already calls logScimAudit inside deleteUser
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
    const record = {
      id: row.id, name: row.name, workspaceId: row.workspaceId,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      members: group.members ?? [],
    };
    logScimAudit({
      workspaceId,
      action: 'group.created',
      entityType: 'group',
      entityId: record.id,
      changes: record,
    });
    return record;
  });
  // sync fallback already calls logScimAudit inside createGroup
  return dbResult ?? createGroup(group);
}

export async function updateGroupAsync(
  id: string,
  updates: Partial<Omit<SCIMGroupRecord, 'id' | 'createdAt'>>,
  workspaceId: string,
): Promise<SCIMGroupRecord | null> {
  const dbResult = await withRls(workspaceId, async ({ db, schema }) => {
    const { eq } = await import('drizzle-orm');
    const [row] = await db.update(schema.scimGroups)
      .set({ name: updates.name, updatedAt: new Date() })
      .where(eq(schema.scimGroups.id, id))
      .returning();
    if (!row) return null;
    logScimAudit({
      workspaceId,
      action: 'group.updated',
      entityType: 'group',
      entityId: id,
      changes: updates,
    });
    return {
      id: row.id, name: row.name, workspaceId: row.workspaceId,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      members: updates.members,
    };
  });
  // sync fallback already calls logScimAudit inside updateGroup
  return dbResult ?? updateGroup(id, updates);
}

export async function deleteGroupAsync(id: string, workspaceId: string): Promise<boolean> {
  const dbResult = await withRls(workspaceId, async ({ db, schema }) => {
    const { eq } = await import('drizzle-orm');
    const result = await db.delete(schema.scimGroups).where(eq(schema.scimGroups.id, id));
    const deleted = (result.rowCount ?? 0) > 0;
    if (deleted) {
      logScimAudit({
        workspaceId,
        action: 'group.deleted',
        entityType: 'group',
        entityId: id,
      });
    }
    return deleted;
  });
  // sync fallback already calls logScimAudit inside deleteGroup
  return dbResult ?? deleteGroup(id);
}

export async function getUserAsync(id: string, workspaceId: string): Promise<SCIMUserRecord | undefined> {
  const dbResult = await withRls(workspaceId, async ({ db, schema }) => {
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select().from(schema.scimUsers).where(eq(schema.scimUsers.id, id)).limit(1);
    if (!row) return undefined;
    return {
      id: row.id, email: row.email, name: row.name,
      role: row.role, status: row.status, workspaceId: row.workspaceId,
      externalId: row.externalId ?? undefined,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  });
  return dbResult ?? getUser(id);
}

export async function getGroupAsync(id: string, workspaceId: string): Promise<SCIMGroupRecord | undefined> {
  const dbResult = await withRls(workspaceId, async ({ db, schema }) => {
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select().from(schema.scimGroups).where(eq(schema.scimGroups.id, id)).limit(1);
    if (!row) return undefined;
    const memberRows = await db.select({ userId: schema.scimGroupMembers.userId })
      .from(schema.scimGroupMembers).where(eq(schema.scimGroupMembers.groupId, row.id));
    const members: Array<{ id: string; name: string }> = [];
    for (const m of memberRows) {
      const [user] = await db.select({ id: schema.scimUsers.id, name: schema.scimUsers.name })
        .from(schema.scimUsers).where(eq(schema.scimUsers.id, m.userId)).limit(1);
      if (user) members.push({ id: user.id, name: user.name });
    }
    return {
      id: row.id, name: row.name, workspaceId: row.workspaceId,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      members,
    };
  });
  return dbResult ?? getGroup(id);
}
