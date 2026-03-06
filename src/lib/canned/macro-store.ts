/**
 * Macro store — JSONL-backed in-memory storage for native macros.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { withRls } from '../store-helpers';

export type MacroActionType =
  | 'set_status'
  | 'set_priority'
  | 'add_tag'
  | 'remove_tag'
  | 'assign'
  | 'assign_group'
  | 'add_reply'
  | 'add_note'
  | 'set_custom_field';

export interface MacroAction {
  type: MacroActionType;
  value?: string;
  field?: string;
}

export interface Macro {
  id: string;
  workspaceId?: string;
  createdBy?: string;
  name: string;
  description?: string;
  actions: MacroAction[];
  scope: 'personal' | 'shared';
  enabled: boolean;
  usageCount: number;
  position?: number;
  createdAt: string;
  updatedAt: string;
}

const MACROS_FILE = 'macros.jsonl';

function persist(): void {
  writeJsonlFile(MACROS_FILE, macros);
}

const macros: Macro[] = [];
let defaultsLoaded = false;

function ensureDefaults(): void {
  if (defaultsLoaded) return;
  defaultsLoaded = true;

  const saved = readJsonlFile<Macro>(MACROS_FILE);
  if (saved.length > 0) {
    macros.push(...saved);
    return;
  }

  const now = new Date().toISOString();
  const defaults: Macro[] = [
    {
      id: 'macro-demo-1',
      name: 'Close & Tag Resolved',
      description: 'Set status to solved and add "resolved" tag',
      actions: [
        { type: 'set_status', value: 'solved' },
        { type: 'add_tag', value: 'resolved' },
      ],
      scope: 'shared',
      enabled: true,
      usageCount: 34,
      position: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'macro-demo-2',
      name: 'Escalate to Tier 2',
      description: 'Set priority to high and add "escalated" tag',
      actions: [
        { type: 'set_priority', value: 'high' },
        { type: 'add_tag', value: 'escalated' },
        { type: 'add_note', value: 'Escalated to Tier 2 support team.' },
      ],
      scope: 'shared',
      enabled: true,
      usageCount: 12,
      position: 2,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'macro-demo-3',
      name: 'Acknowledge Receipt',
      description: 'Send acknowledgement reply and set to pending',
      actions: [
        { type: 'set_status', value: 'pending' },
        { type: 'add_reply', value: 'Hi {{customer.name}},\n\nThank you for contacting us. We\'ve received your request and will get back to you shortly.\n\nBest,\n{{agent.name}}' },
      ],
      scope: 'shared',
      enabled: true,
      usageCount: 27,
      position: 3,
      createdAt: now,
      updatedAt: now,
    },
  ];

  macros.push(...defaults);
  persist();
}

// ---- Public API ----

export async function getMacros(filters?: {
  scope?: 'personal' | 'shared';
  enabled?: boolean;
  createdBy?: string;
}, workspaceId?: string): Promise<Macro[]> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const rows = await db.select().from(schema.nativeMacros);
      return rows.map(r => ({
        id: r.id,
        workspaceId: r.workspaceId,
        createdBy: r.createdBy ?? undefined,
        name: r.name,
        description: r.description ?? undefined,
        actions: r.actions as MacroAction[],
        scope: r.scope as 'personal' | 'shared',
        enabled: r.enabled,
        usageCount: r.usageCount,
        position: r.position ?? undefined,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));
    });
    if (result !== null) {
      let filtered = result;
      if (filters?.scope) filtered = filtered.filter(m => m.scope === filters.scope);
      if (filters?.enabled !== undefined) filtered = filtered.filter(m => m.enabled === filters.enabled);
      if (filters?.createdBy) filtered = filtered.filter(m => m.scope === 'shared' || m.createdBy === filters.createdBy);
      return filtered.sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
    }
  }
  ensureDefaults();
  let result = [...macros];
  if (filters?.scope) {
    result = result.filter(m => m.scope === filters.scope);
  }
  if (filters?.enabled !== undefined) {
    result = result.filter(m => m.enabled === filters.enabled);
  }
  if (filters?.createdBy) {
    result = result.filter(m => m.scope === 'shared' || m.createdBy === filters.createdBy);
  }
  return result.sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
}

export function getMacro(id: string): Macro | undefined {
  ensureDefaults();
  return macros.find(m => m.id === id);
}

export function createMacro(input: {
  name: string;
  description?: string;
  actions: MacroAction[];
  scope?: 'personal' | 'shared';
  createdBy?: string;
}): Macro {
  ensureDefaults();
  const now = new Date().toISOString();
  const macro: Macro = {
    id: `macro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    description: input.description,
    actions: input.actions,
    scope: input.scope ?? 'shared',
    enabled: true,
    usageCount: 0,
    position: macros.length + 1,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  macros.push(macro);
  persist();
  return macro;
}

export function updateMacro(
  id: string,
  updates: Partial<Pick<Macro, 'name' | 'description' | 'actions' | 'scope' | 'enabled' | 'position'>>,
): Macro | null {
  ensureDefaults();
  const idx = macros.findIndex(m => m.id === id);
  if (idx === -1) return null;
  macros[idx] = {
    ...macros[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  persist();
  return macros[idx];
}

export function deleteMacro(id: string): boolean {
  ensureDefaults();
  const idx = macros.findIndex(m => m.id === id);
  if (idx === -1) return false;
  macros.splice(idx, 1);
  persist();
  return true;
}

export function incrementMacroUsage(id: string): void {
  ensureDefaults();
  const m = macros.find(m => m.id === id);
  if (m) {
    m.usageCount++;
    m.updatedAt = new Date().toISOString();
    persist();
  }
}
