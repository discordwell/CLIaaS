/**
 * Shared JSONL file persistence helpers.
 * Used by in-memory stores to survive server restarts.
 * Files are stored in /tmp/cliaas-demo/ (same dir as the demo export data).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

function getStoreDir(): string {
  return process.env.CLIAAS_DATA_DIR || '/tmp/cliaas-demo';
}

function ensureDir(): void {
  const dir = getStoreDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function readJsonlFile<T>(filename: string): T[] {
  const filePath = join(getStoreDir(), filename);
  if (!existsSync(filePath)) return [];
  const results: T[] = [];
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      results.push(JSON.parse(line) as T);
    } catch {
      // Skip malformed lines
    }
  }
  return results;
}

export function writeJsonlFile<T>(filename: string, items: T[]): void {
  ensureDir();
  const filePath = join(getStoreDir(), filename);
  const content = items.map((item) => JSON.stringify(item)).join('\n');
  writeFileSync(filePath, content + '\n', 'utf-8');
}
