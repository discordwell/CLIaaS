/**
 * Integration test helpers for API route testing.
 * Provides JWT creation, request builders, and common fixtures.
 */

import { createToken, type SessionUser } from '@/lib/auth';

// ---- Test Fixtures ----

export const TEST_USER: SessionUser = {
  id: 'test-user-001',
  email: 'agent@cliaas.test',
  name: 'Test Agent',
  role: 'admin',
  workspaceId: 'ws-test-001',
  tenantId: 'tenant-test-001',
};

export const TEST_USER_AGENT: SessionUser = {
  id: 'test-user-002',
  email: 'agent2@cliaas.test',
  name: 'Second Agent',
  role: 'agent',
  workspaceId: 'ws-test-001',
  tenantId: 'tenant-test-001',
};

// ---- Token Helpers ----

/**
 * Create a valid JWT token for the given user (defaults to TEST_USER).
 */
export async function createTestToken(user: SessionUser = TEST_USER): Promise<string> {
  return createToken(user);
}

// ---- Request Builders ----

const BASE_URL = 'http://localhost:3000';

/**
 * Build a GET Request with optional auth token and query params.
 */
export function buildGetRequest(
  path: string,
  options?: {
    token?: string;
    params?: Record<string, string>;
    headers?: Record<string, string>;
  },
): Request {
  const url = new URL(path, BASE_URL);
  if (options?.params) {
    for (const [key, value] of Object.entries(options.params)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    ...options?.headers,
  };
  if (options?.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
    headers['Cookie'] = `cliaas-session=${options.token}`;
  }

  return new Request(url.toString(), {
    method: 'GET',
    headers,
  });
}

/**
 * Build a POST Request with JSON body and optional auth token.
 */
export function buildPostRequest(
  path: string,
  body: unknown,
  options?: {
    token?: string;
    headers?: Record<string, string>;
  },
): Request {
  const url = new URL(path, BASE_URL);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options?.headers,
  };
  if (options?.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
    headers['Cookie'] = `cliaas-session=${options.token}`;
  }

  return new Request(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/**
 * Build a PATCH Request with JSON body and optional auth token.
 */
export function buildPatchRequest(
  path: string,
  body: unknown,
  options?: {
    token?: string;
    headers?: Record<string, string>;
  },
): Request {
  const url = new URL(path, BASE_URL);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options?.headers,
  };
  if (options?.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
    headers['Cookie'] = `cliaas-session=${options.token}`;
  }

  return new Request(url.toString(), {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
}

/**
 * Build headers that simulate middleware-set auth headers.
 * Useful for testing route-level auth guards (requireAuth, requireRole).
 */
export function buildAuthHeaders(
  user: Partial<SessionUser> = TEST_USER,
): Record<string, string> {
  return {
    'x-user-id': user.id ?? TEST_USER.id,
    'x-workspace-id': user.workspaceId ?? TEST_USER.workspaceId,
    'x-user-role': user.role ?? TEST_USER.role,
    'x-user-email': user.email ?? TEST_USER.email,
  };
}

/**
 * Build a DELETE Request with optional auth token.
 */
export function buildDeleteRequest(
  path: string,
  options?: {
    token?: string;
    headers?: Record<string, string>;
  },
): Request {
  const url = new URL(path, BASE_URL);

  const headers: Record<string, string> = {
    ...options?.headers,
  };
  if (options?.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
    headers['Cookie'] = `cliaas-session=${options.token}`;
  }

  return new Request(url.toString(), {
    method: 'DELETE',
    headers,
  });
}

/**
 * Build a POST Request with FormData (for Twilio webhooks, etc.).
 */
export function buildFormPostRequest(
  path: string,
  formFields: Record<string, string>,
  options?: {
    headers?: Record<string, string>;
  },
): Request {
  const url = new URL(path, BASE_URL);
  const formData = new FormData();
  for (const [key, value] of Object.entries(formFields)) {
    formData.set(key, value);
  }

  return new Request(url.toString(), {
    method: 'POST',
    headers: options?.headers,
    body: formData,
  });
}
