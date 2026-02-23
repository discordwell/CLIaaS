import { readJsonlFile, writeJsonlFile } from './jsonl-store';
import { cloneToSandbox, teardownSandbox, getCloneManifest, type CloneOptions, type CloneManifest } from './sandbox-clone';
import { diffSandbox, applyDiff, type SandboxDiff } from './sandbox-diff';

// ---- Types ----

export interface SandboxConfig {
  id: string;
  name: string;
  createdAt: string;
  sourceWorkspaceId: string;
  status: 'active' | 'archived';
  promotedAt?: string;
  cloneManifest?: CloneManifest;
  expiresAt?: string;
  cloneOptions?: CloneOptions;
}

// ---- JSONL persistence ----

const SANDBOXES_FILE = 'sandboxes.jsonl';
const EXPIRY_DAYS = 30;

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
    // Clean expired sandboxes
    cleanExpired();
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
      expiresAt: new Date(Date.now() + 23 * 86400000).toISOString(),
    },
    {
      id: 'sandbox-test',
      name: 'QA Testing',
      createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
      sourceWorkspaceId: 'ws-main',
      status: 'active',
      expiresAt: new Date(Date.now() + 27 * 86400000).toISOString(),
    }
  );
}

function cleanExpired(): void {
  const now = new Date();
  for (let i = sandboxes.length - 1; i >= 0; i--) {
    const sb = sandboxes[i];
    if (sb.expiresAt && new Date(sb.expiresAt) < now && sb.status === 'active') {
      sb.status = 'archived';
      teardownSandbox(sb.id);
    }
  }
  persistSandboxes();
}

// ---- Public API ----

export function listSandboxes(): SandboxConfig[] {
  ensureDefaults();
  cleanExpired();
  return [...sandboxes];
}

export function getSandbox(id: string): SandboxConfig | undefined {
  ensureDefaults();
  return sandboxes.find((s) => s.id === id);
}

export function createSandbox(name: string, options?: CloneOptions): SandboxConfig {
  ensureDefaults();
  const id = `sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 86400000).toISOString();

  // Clone data into sandbox
  const manifest = cloneToSandbox(id, options);

  const sandbox: SandboxConfig = {
    id,
    name,
    createdAt: new Date().toISOString(),
    sourceWorkspaceId: 'ws-main',
    status: 'active',
    cloneManifest: manifest,
    expiresAt,
    cloneOptions: options,
  };
  sandboxes.push(sandbox);
  persistSandboxes();
  return sandbox;
}

export function deleteSandbox(id: string): boolean {
  ensureDefaults();
  const idx = sandboxes.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  teardownSandbox(id);
  sandboxes.splice(idx, 1);
  persistSandboxes();
  return true;
}

export function diffSandboxById(id: string): SandboxDiff | null {
  ensureDefaults();
  const sandbox = sandboxes.find((s) => s.id === id);
  if (!sandbox || sandbox.status !== 'active') return null;
  return diffSandbox(id);
}

export function promoteSandbox(
  id: string,
  selectedEntryIds?: string[],
): { sandbox: SandboxConfig; applied: number; errors: string[] } | null {
  ensureDefaults();
  const sandbox = sandboxes.find((s) => s.id === id);
  if (!sandbox) return null;

  const result = applyDiff(id, selectedEntryIds);

  sandbox.status = 'archived';
  sandbox.promotedAt = new Date().toISOString();
  persistSandboxes();

  return { sandbox, ...result };
}
