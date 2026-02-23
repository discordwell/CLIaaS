import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateSCIMAuth, requireSCIMAuth } from '../auth';
import { applyUserPatchOps, applyGroupPatchOps, type SCIMPatchOp, SCIM_SCHEMAS } from '../schema';
import { getUsers, setUsers, getGroups, setGroups } from '../store';

// ---- Auth timing-safe tests ----

const ORIGINAL_TOKEN = process.env.SCIM_BEARER_TOKEN;

beforeEach(() => {
  process.env.SCIM_BEARER_TOKEN = 'test-scim-token-abc123';
  global.__cliaasScimUsers = undefined;
  global.__cliaasScimGroups = undefined;
});

afterEach(() => {
  if (ORIGINAL_TOKEN) {
    process.env.SCIM_BEARER_TOKEN = ORIGINAL_TOKEN;
  } else {
    delete process.env.SCIM_BEARER_TOKEN;
  }
});

describe('timing-safe auth', () => {
  it('accepts valid token', () => {
    expect(validateSCIMAuth('Bearer test-scim-token-abc123')).toBe(true);
  });

  it('rejects token of different length without leaking length info', () => {
    // Short token — previously the early-return would leak this
    expect(validateSCIMAuth('Bearer x')).toBe(false);
    // Same length but wrong value
    expect(validateSCIMAuth('Bearer test-scim-token-abc124')).toBe(false);
    // Longer token
    expect(validateSCIMAuth('Bearer test-scim-token-abc123-extra-stuff')).toBe(false);
  });
});

describe('requireSCIMAuth guard', () => {
  it('returns ok:true for valid auth', () => {
    const req = new Request('http://localhost/api/scim/v2/Users', {
      headers: { authorization: 'Bearer test-scim-token-abc123' },
    });
    const result = requireSCIMAuth(req as never);
    expect(result.ok).toBe(true);
  });

  it('returns ok:false with 401 response for invalid token', () => {
    const req = new Request('http://localhost/api/scim/v2/Users', {
      headers: { authorization: 'Bearer wrong' },
    });
    const result = requireSCIMAuth(req as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });
});

// ---- PatchOp tests ----

describe('applyUserPatchOps', () => {
  it('replaces name', () => {
    const user = { name: 'Alice', email: 'a@b.com', status: 'active', updatedAt: '' };
    const patch: SCIMPatchOp = {
      schemas: [SCIM_SCHEMAS.user],
      Operations: [{ op: 'replace', path: 'name.formatted', value: 'Bob' }],
    };
    applyUserPatchOps(user, patch);
    expect(user.name).toBe('Bob');
  });

  it('replaces email', () => {
    const user = { name: 'Alice', email: 'a@b.com', status: 'active', updatedAt: '' };
    const patch: SCIMPatchOp = {
      schemas: [SCIM_SCHEMAS.user],
      Operations: [{ op: 'replace', path: 'emails', value: [{ value: 'new@test.com' }] }],
    };
    applyUserPatchOps(user, patch);
    expect(user.email).toBe('new@test.com');
  });

  it('deactivates user', () => {
    const user = { name: 'Alice', email: 'a@b.com', status: 'active', updatedAt: '' };
    const patch: SCIMPatchOp = {
      schemas: [SCIM_SCHEMAS.user],
      Operations: [{ op: 'replace', path: 'active', value: false }],
    };
    applyUserPatchOps(user, patch);
    expect(user.status).toBe('inactive');
  });

  it('removes name', () => {
    const user = { name: 'Alice', email: 'a@b.com', status: 'active', updatedAt: '' };
    const patch: SCIMPatchOp = {
      schemas: [SCIM_SCHEMAS.user],
      Operations: [{ op: 'remove', path: 'name.formatted' }],
    };
    applyUserPatchOps(user, patch);
    expect(user.name).toBe('');
  });
});

describe('applyGroupPatchOps', () => {
  it('replaces displayName', () => {
    const group = { name: 'Support', updatedAt: '', members: [] };
    const patch: SCIMPatchOp = {
      schemas: [SCIM_SCHEMAS.group],
      Operations: [{ op: 'replace', path: 'displayName', value: 'Engineering' }],
    };
    applyGroupPatchOps(group, patch);
    expect(group.name).toBe('Engineering');
  });

  it('adds members', () => {
    const group = { name: 'Support', updatedAt: '', members: [{ id: 'u-1', name: 'Alice' }] };
    const patch: SCIMPatchOp = {
      schemas: [SCIM_SCHEMAS.group],
      Operations: [{ op: 'add', path: 'members', value: [{ value: 'u-2', display: 'Bob' }] }],
    };
    applyGroupPatchOps(group, patch);
    expect(group.members).toHaveLength(2);
    expect(group.members![1].id).toBe('u-2');
  });

  it('replaces members', () => {
    const group = { name: 'Support', updatedAt: '', members: [{ id: 'u-1', name: 'Alice' }] };
    const patch: SCIMPatchOp = {
      schemas: [SCIM_SCHEMAS.group],
      Operations: [{ op: 'replace', path: 'members', value: [{ value: 'u-3', display: 'Charlie' }] }],
    };
    applyGroupPatchOps(group, patch);
    expect(group.members).toHaveLength(1);
    expect(group.members![0].id).toBe('u-3');
  });

  it('removes all members', () => {
    const group = { name: 'Support', updatedAt: '', members: [{ id: 'u-1', name: 'Alice' }] };
    const patch: SCIMPatchOp = {
      schemas: [SCIM_SCHEMAS.group],
      Operations: [{ op: 'remove', path: 'members' }],
    };
    applyGroupPatchOps(group, patch);
    expect(group.members).toEqual([]);
  });
});

// ---- Store tests ----

describe('SCIM store', () => {
  it('getUsers returns empty array initially', () => {
    expect(getUsers()).toEqual([]);
  });

  it('setUsers/getUsers returns consistent references', () => {
    const users = [{ id: 'u-1', email: 'a@b.com', name: 'A', role: 'agent', status: 'active', createdAt: '', updatedAt: '' }];
    setUsers(users);
    expect(getUsers()).toBe(users);
    expect(getUsers()[0].id).toBe('u-1');
  });

  it('getGroups returns empty array initially', () => {
    expect(getGroups()).toEqual([]);
  });

  it('setGroups/getGroups returns consistent references', () => {
    const groups = [{ id: 'g-1', name: 'Support', createdAt: '', updatedAt: '' }];
    setGroups(groups);
    expect(getGroups()).toBe(groups);
    expect(getGroups()[0].id).toBe('g-1');
  });
});
