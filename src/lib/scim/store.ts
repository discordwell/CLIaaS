/**
 * Shared in-memory SCIM user/group stores.
 * Consolidates global declarations previously duplicated across route files.
 */

export interface SCIMUserRecord {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SCIMGroupRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  members?: Array<{ id: string; name: string }>;
}

declare global {
  // eslint-disable-next-line no-var
  var __cliaasScimUsers: SCIMUserRecord[] | undefined;
  // eslint-disable-next-line no-var
  var __cliaasScimGroups: SCIMGroupRecord[] | undefined;
}

export function getUsers(): SCIMUserRecord[] {
  return global.__cliaasScimUsers ?? [];
}

export function setUsers(users: SCIMUserRecord[]): void {
  global.__cliaasScimUsers = users;
}

export function getGroups(): SCIMGroupRecord[] {
  return global.__cliaasScimGroups ?? [];
}

export function setGroups(groups: SCIMGroupRecord[]): void {
  global.__cliaasScimGroups = groups;
}
