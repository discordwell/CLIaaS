/**
 * AutoQA configuration JSONL store.
 * One config per workspace. Dual-mode: DB primary, JSONL fallback.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { withRls } from '../store-helpers';

export interface AutoQAConfig {
  id: string;
  workspaceId: string;
  enabled: boolean;
  scorecardId?: string;
  triggerOnResolved: boolean;
  triggerOnClosed: boolean;
  provider: 'claude' | 'openai';
  model?: string;
  sampleRate: number; // 0.00 - 1.00
  customInstructions?: string;
  createdAt: string;
  updatedAt: string;
}

const FILE = 'autoqa-configs.jsonl';
const configs: AutoQAConfig[] = [];
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  const saved = readJsonlFile<AutoQAConfig>(FILE);
  if (saved.length > 0) configs.push(...saved);
}

function persist(): void {
  writeJsonlFile(FILE, configs);
}

export function getAutoQAConfig(workspaceId: string): AutoQAConfig | null {
  ensureLoaded();
  return configs.find(c => c.workspaceId === workspaceId) ?? null;
}

export function upsertAutoQAConfig(
  workspaceId: string,
  input: Partial<Omit<AutoQAConfig, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'>>,
): AutoQAConfig {
  ensureLoaded();
  const now = new Date().toISOString();
  const idx = configs.findIndex(c => c.workspaceId === workspaceId);

  if (idx >= 0) {
    configs[idx] = { ...configs[idx], ...input, updatedAt: now };
    persist();
    return configs[idx];
  }

  const config: AutoQAConfig = {
    id: `aqc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId,
    enabled: false,
    triggerOnResolved: true,
    triggerOnClosed: false,
    provider: 'claude',
    sampleRate: 1.0,
    ...input,
    createdAt: now,
    updatedAt: now,
  };
  configs.push(config);
  persist();
  return config;
}
