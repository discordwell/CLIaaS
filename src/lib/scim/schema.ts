/**
 * SCIM 2.0 User/Group schema mapping for CLIaaS.
 * Maps between SCIM wire format and internal user/group data.
 */

export interface SCIMUser {
  schemas: string[];
  id: string;
  userName: string;
  name?: {
    givenName?: string;
    familyName?: string;
    formatted?: string;
  };
  emails?: Array<{ value: string; type?: string; primary?: boolean }>;
  active: boolean;
  groups?: Array<{ value: string; display?: string }>;
  meta: {
    resourceType: 'User';
    created: string;
    lastModified: string;
  };
}

export interface SCIMGroup {
  schemas: string[];
  id: string;
  displayName: string;
  members?: Array<{ value: string; display?: string }>;
  meta: {
    resourceType: 'Group';
    created: string;
    lastModified: string;
  };
}

export interface SCIMListResponse<T> {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export const SCIM_SCHEMAS = {
  user: 'urn:ietf:params:scim:schemas:core:2.0:User',
  group: 'urn:ietf:params:scim:schemas:core:2.0:Group',
  listResponse: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  error: 'urn:ietf:params:scim:api:messages:2.0:Error',
};

export function toSCIMUser(user: {
  id: string;
  email?: string | null;
  name: string;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}): SCIMUser {
  return {
    schemas: [SCIM_SCHEMAS.user],
    id: user.id,
    userName: user.email ?? user.id,
    name: {
      formatted: user.name,
    },
    emails: user.email ? [{ value: user.email, type: 'work', primary: true }] : [],
    active: user.status === 'active',
    meta: {
      resourceType: 'User',
      created: user.createdAt,
      lastModified: user.updatedAt,
    },
  };
}

export function toSCIMGroup(group: {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  members?: Array<{ id: string; name: string }>;
}): SCIMGroup {
  return {
    schemas: [SCIM_SCHEMAS.group],
    id: group.id,
    displayName: group.name,
    members: group.members?.map(m => ({ value: m.id, display: m.name })),
    meta: {
      resourceType: 'Group',
      created: group.createdAt,
      lastModified: group.updatedAt,
    },
  };
}

export function wrapListResponse<T>(resources: T[], total: number, startIndex = 1): SCIMListResponse<T> {
  return {
    schemas: [SCIM_SCHEMAS.listResponse],
    totalResults: total,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

export function scimError(status: number, detail: string) {
  return {
    schemas: [SCIM_SCHEMAS.error],
    status: String(status),
    detail,
  };
}

// ---- SCIM PatchOp (RFC 7644 §3.5.2) ----

export interface SCIMPatchOp {
  schemas: string[];
  Operations: Array<{
    op: 'add' | 'remove' | 'replace';
    path?: string;
    value?: unknown;
  }>;
}

export function applyUserPatchOps(
  user: { name: string; email: string; status: string; updatedAt: string },
  patch: SCIMPatchOp,
): void {
  if (!Array.isArray(patch.Operations)) return;
  for (const op of patch.Operations) {
    if (op.op === 'remove' && op.path) {
      if (op.path === 'name.formatted') user.name = '';
      continue;
    }
    if ((op.op === 'add' || op.op === 'replace') && op.path) {
      if (op.path === 'name.formatted' && typeof op.value === 'string') {
        user.name = op.value;
      } else if (op.path === 'emails' && Array.isArray(op.value) && op.value[0]?.value) {
        user.email = String(op.value[0].value);
      } else if (op.path === 'active' && typeof op.value === 'boolean') {
        user.status = op.value ? 'active' : 'inactive';
      }
    }
  }
  user.updatedAt = new Date().toISOString();
}

export function applyGroupPatchOps(
  group: { name: string; updatedAt: string; members?: Array<{ id: string; name: string }> },
  patch: SCIMPatchOp,
): void {
  if (!Array.isArray(patch.Operations)) return;
  for (const op of patch.Operations) {
    if (op.path === 'displayName' && typeof op.value === 'string' && op.op !== 'remove') {
      group.name = op.value;
    }
    if (op.path === 'members' && Array.isArray(op.value)) {
      const newMembers = op.value.map((m: { value: string; display?: string }) => ({
        id: m.value,
        name: m.display ?? '',
      }));
      if (op.op === 'add') {
        group.members = [...(group.members ?? []), ...newMembers];
      } else if (op.op === 'replace') {
        group.members = newMembers;
      }
    }
    if (op.op === 'remove' && op.path === 'members') {
      group.members = [];
    }
  }
  group.updatedAt = new Date().toISOString();
}
