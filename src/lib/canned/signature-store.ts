/**
 * Agent signature store — JSONL-backed in-memory storage.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';

export interface AgentSignature {
  id: string;
  workspaceId?: string;
  userId?: string;
  name: string;
  bodyHtml: string;
  bodyText: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

const SIGNATURES_FILE = 'agent-signatures.jsonl';

function persist(): void {
  writeJsonlFile(SIGNATURES_FILE, signatures);
}

const signatures: AgentSignature[] = [];
let defaultsLoaded = false;

function ensureDefaults(): void {
  if (defaultsLoaded) return;
  defaultsLoaded = true;

  const saved = readJsonlFile<AgentSignature>(SIGNATURES_FILE);
  if (saved.length > 0) {
    signatures.push(...saved);
    return;
  }

  const now = new Date().toISOString();
  const defaults: AgentSignature[] = [
    {
      id: 'sig-demo-1',
      name: 'Default',
      bodyHtml: '<p>Best regards,<br><strong>Support Team</strong><br><em>CLIaaS — Command-Line Native Support</em></p>',
      bodyText: 'Best regards,\nSupport Team\nCLIaaS — Command-Line Native Support',
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sig-demo-2',
      name: 'Formal',
      bodyHtml: '<p>Kind regards,<br><strong>Customer Support Department</strong><br>CLIaaS Inc.<br><a href="https://cliaas.com">cliaas.com</a></p>',
      bodyText: 'Kind regards,\nCustomer Support Department\nCLIaaS Inc.\nhttps://cliaas.com',
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    },
  ];

  signatures.push(...defaults);
  persist();
}

// ---- Public API ----

export function getSignatures(filters?: {
  userId?: string;
}): AgentSignature[] {
  ensureDefaults();
  let result = [...signatures];
  if (filters?.userId) {
    result = result.filter(s => !s.userId || s.userId === filters.userId);
  }
  return result.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
}

export function getSignature(id: string): AgentSignature | undefined {
  ensureDefaults();
  return signatures.find(s => s.id === id);
}

export function getDefaultSignature(userId?: string): AgentSignature | undefined {
  ensureDefaults();
  if (userId) {
    const userDefault = signatures.find(s => s.userId === userId && s.isDefault);
    if (userDefault) return userDefault;
  }
  return signatures.find(s => s.isDefault && !s.userId);
}

export function createSignature(input: {
  name: string;
  bodyHtml: string;
  bodyText: string;
  isDefault?: boolean;
  userId?: string;
}): AgentSignature {
  ensureDefaults();
  const now = new Date().toISOString();

  if (input.isDefault) {
    for (const s of signatures) {
      if ((!input.userId || s.userId === input.userId) && s.isDefault) {
        s.isDefault = false;
      }
    }
  }

  const sig: AgentSignature = {
    id: `sig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    bodyHtml: input.bodyHtml,
    bodyText: input.bodyText,
    isDefault: input.isDefault ?? false,
    userId: input.userId,
    createdAt: now,
    updatedAt: now,
  };
  signatures.push(sig);
  persist();
  return sig;
}

export function updateSignature(
  id: string,
  updates: Partial<Pick<AgentSignature, 'name' | 'bodyHtml' | 'bodyText' | 'isDefault'>>,
): AgentSignature | null {
  ensureDefaults();
  const idx = signatures.findIndex(s => s.id === id);
  if (idx === -1) return null;

  if (updates.isDefault) {
    const target = signatures[idx];
    for (const s of signatures) {
      if (s.id !== id && (!target.userId || s.userId === target.userId) && s.isDefault) {
        s.isDefault = false;
      }
    }
  }

  signatures[idx] = {
    ...signatures[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  persist();
  return signatures[idx];
}

export function deleteSignature(id: string): boolean {
  ensureDefaults();
  const idx = signatures.findIndex(s => s.id === id);
  if (idx === -1) return false;
  signatures.splice(idx, 1);
  persist();
  return true;
}
