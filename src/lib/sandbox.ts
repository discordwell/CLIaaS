// ---- Types ----

export interface SandboxConfig {
  id: string;
  name: string;
  createdAt: string;
  sourceWorkspaceId: string;
  status: 'active' | 'archived';
  promotedAt?: string;
}

// ---- In-memory store ----

const sandboxes: SandboxConfig[] = [];
let defaultsLoaded = false;

function ensureDefaults(): void {
  if (defaultsLoaded) return;
  defaultsLoaded = true;

  sandboxes.push(
    {
      id: 'sandbox-staging',
      name: 'Staging Environment',
      createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
      sourceWorkspaceId: 'ws-main',
      status: 'active',
    },
    {
      id: 'sandbox-test',
      name: 'QA Testing',
      createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
      sourceWorkspaceId: 'ws-main',
      status: 'active',
    }
  );
}

// ---- Public API ----

export function listSandboxes(): SandboxConfig[] {
  ensureDefaults();
  return [...sandboxes];
}

export function getSandbox(id: string): SandboxConfig | undefined {
  ensureDefaults();
  return sandboxes.find((s) => s.id === id);
}

export function createSandbox(name: string): SandboxConfig {
  ensureDefaults();
  const sandbox: SandboxConfig = {
    id: `sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    createdAt: new Date().toISOString(),
    sourceWorkspaceId: 'ws-main',
    status: 'active',
  };
  sandboxes.push(sandbox);
  return sandbox;
}

export function deleteSandbox(id: string): boolean {
  ensureDefaults();
  const idx = sandboxes.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  sandboxes.splice(idx, 1);
  return true;
}

export function promoteSandbox(id: string): SandboxConfig | null {
  ensureDefaults();
  const sandbox = sandboxes.find((s) => s.id === id);
  if (!sandbox) return null;
  sandbox.status = 'archived';
  sandbox.promotedAt = new Date().toISOString();
  return sandbox;
}
