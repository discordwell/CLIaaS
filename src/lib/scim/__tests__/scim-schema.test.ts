import { describe, it, expect } from 'vitest';
import { toSCIMUser, toSCIMGroup, wrapListResponse, scimError, SCIM_SCHEMAS } from '../schema';

describe('SCIM schema mapping', () => {
  it('toSCIMUser maps user data', () => {
    const result = toSCIMUser({
      id: 'u-1',
      email: 'a@b.com',
      name: 'Alice',
      role: 'agent',
      status: 'active',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    });

    expect(result.schemas).toContain(SCIM_SCHEMAS.user);
    expect(result.id).toBe('u-1');
    expect(result.userName).toBe('a@b.com');
    expect(result.name?.formatted).toBe('Alice');
    expect(result.emails).toHaveLength(1);
    expect(result.active).toBe(true);
    expect(result.meta.resourceType).toBe('User');
  });

  it('toSCIMUser handles inactive user', () => {
    const result = toSCIMUser({
      id: 'u-2',
      email: null,
      name: 'Bob',
      role: 'viewer',
      status: 'inactive',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });

    expect(result.active).toBe(false);
    expect(result.userName).toBe('u-2');
    expect(result.emails).toEqual([]);
  });

  it('toSCIMGroup maps group data', () => {
    const result = toSCIMGroup({
      id: 'g-1',
      name: 'Support',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      members: [{ id: 'u-1', name: 'Alice' }],
    });

    expect(result.schemas).toContain(SCIM_SCHEMAS.group);
    expect(result.displayName).toBe('Support');
    expect(result.members).toHaveLength(1);
    expect(result.members![0].value).toBe('u-1');
  });

  it('wrapListResponse creates proper envelope', () => {
    const items = [{ id: '1' }, { id: '2' }];
    const list = wrapListResponse(items, 2);
    expect(list.totalResults).toBe(2);
    expect(list.Resources).toHaveLength(2);
    expect(list.schemas).toContain(SCIM_SCHEMAS.listResponse);
  });

  it('scimError returns proper error structure', () => {
    const err = scimError(404, 'Not found');
    expect(err.status).toBe('404');
    expect(err.detail).toBe('Not found');
    expect(err.schemas).toContain(SCIM_SCHEMAS.error);
  });
});
