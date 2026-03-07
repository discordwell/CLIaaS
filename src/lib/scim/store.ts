/**
 * SCIM user/group store — JSONL-persistent with workspace scoping.
 * Replaces bare in-memory globals with persistent storage.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';

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
