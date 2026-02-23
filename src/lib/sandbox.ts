import { readJsonlFile, writeJsonlFile } from './jsonl-store';

// ---- Types ----

export interface SandboxConfig {
  id: string;
  name: string;
  createdAt: string;
  sourceWorkspaceId: string;
  status: 'active' | 'archived';
  promotedAt?: string;
}

// ---- JSONL persistence ----

const SANDBOXES_FILE = 'sandboxes.jsonl';

function persistSandboxes(): void {
  writeJsonlFile(SANDBOXES_FILE, sandboxes);
}

// ---- In-memory store ----

const sandboxes: SandboxConfig[] = [];
let defaultsLoaded = false;

function ensureDefaults(): void {
  if (defaultsLoaded) return;
  defaultsLoaded = true;

  // Try loading from persisted JSONL file
  const saved = readJsonlFile<SandboxConfig>(SANDBOXES_FILE);
  if (saved.length > 0) {
    sandboxes.push(...saved);
    return;
  }

  // Fall back to demo defaults
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
  persistSandboxes();
  return sandbox;
}

export function deleteSandbox(id: string): boolean {
  ensureDefaults();
  const idx = sandboxes.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  sandboxes.splice(idx, 1);
  persistSandboxes();
  return true;
}

export function promoteSandbox(id: string): SandboxConfig | null {
  ensureDefaults();
  const sandbox = sandboxes.find((s) => s.id === id);
  if (!sandbox) return null;
  sandbox.status = 'archived';
  sandbox.promotedAt = new Date().toISOString();
  persistSandboxes();
  return sandbox;
}
