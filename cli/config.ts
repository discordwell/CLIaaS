import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface CLIConfig {
  provider: 'claude' | 'openai' | 'openclaw';
  claude?: { apiKey: string; model?: string };
  openai?: { apiKey: string; model?: string };
  openclaw?: { baseUrl: string; apiKey?: string; model: string };
  rag?: {
    embeddingModel?: string;
    chunkSize?: number;
    chunkOverlap?: number;
    topK?: number;
    hybridWeight?: number;
  };
}

const CONFIG_DIR = join(homedir(), '.cliaas');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: CLIConfig = {
  provider: 'claude',
};

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function loadConfig(): CLIConfig {
  if (!existsSync(CONFIG_PATH)) {
    return DEFAULT_CONFIG;
  }
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: CLIConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  chmodSync(CONFIG_PATH, 0o600);
}

export function ensureConfigDir(): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
}
