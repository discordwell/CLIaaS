/**
 * Sandbox diff engine.
 * Compares sandbox data against production to detect changes.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getSourceDir, getSandboxDir } from './sandbox-clone';

// ---- Types ----

export type DiffAction = 'added' | 'modified' | 'deleted';

export interface DiffEntry {
  file: string;
  id: string;
  action: DiffAction;
  changes?: Record<string, { from: unknown; to: unknown }>;
}

export interface SandboxDiff {
  sandboxId: string;
  entries: DiffEntry[];
  summary: {
    added: number;
    modified: number;
    deleted: number;
    total: number;
  };
  generatedAt: string;
}

function parseJsonlFile(filePath: string): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  if (!existsSync(filePath)) return map;

  const content = readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const id = (obj.id as string) ?? '';
      if (id) map.set(id, obj);
    } catch {
      // Skip malformed lines
    }
  }
  return map;
}

function deepCompare(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  ignoreFields: string[] = ['createdAt', 'updatedAt'],
): Record<string, { from: unknown; to: unknown }> | null {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of allKeys) {
    if (ignoreFields.includes(key)) continue;
    const aVal = a[key];
    const bVal = b[key];

    if (JSON.stringify(aVal) !== JSON.stringify(bVal)) {
      changes[key] = { from: aVal, to: bVal };
    }
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

// ---- Diff ----

export function diffSandbox(sandboxId: string): SandboxDiff {
  const sourceDir = getSourceDir();
  const sandboxDir = getSandboxDir(sandboxId);
  const entries: DiffEntry[] = [];

  // Get the manifest to know the ID mappings
  const manifestPath = join(sandboxDir, '_manifest.json');
  let reverseIdMap: Record<string, string> = {};

  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      // Reverse the mapping: sandbox ID -> production ID
      const idMappings = manifest.idMappings as Record<string, string>;
      for (const [prodId, sbxId] of Object.entries(idMappings)) {
        reverseIdMap[sbxId] = prodId;
      }
    } catch {
      // Continue without mapping
    }
  }

  // Compare each JSONL file in sandbox against production
  const jsonlFiles = existsSync(sandboxDir)
    ? readdirSync(sandboxDir).filter((f: string) => f.endsWith('.jsonl'))
    : [];

  for (const file of jsonlFiles) {
    const prodData = parseJsonlFile(join(sourceDir, file));
    const sbxData = parseJsonlFile(join(sandboxDir, file));

    // Check for modified and deleted items
    // For each sandbox item, find its production counterpart via reverse mapping
    for (const [sbxId, sbxObj] of sbxData) {
      const prodId = reverseIdMap[sbxId];

      if (prodId && prodData.has(prodId)) {
        // Item existed in production — check for modifications
        const prodObj = prodData.get(prodId)!;
        // Compare ignoring the id field (since sandbox has remapped IDs)
        const sbxCompare = { ...sbxObj, id: prodId };
        const changes = deepCompare(prodObj, sbxCompare);
        if (changes) {
          entries.push({ file, id: sbxId, action: 'modified', changes });
        }
      } else if (!prodId) {
        // New item added in sandbox (no reverse mapping = truly new)
        entries.push({ file, id: sbxId, action: 'added' });
      }
    }

    // Check for items deleted in sandbox
    for (const [prodId] of prodData) {
      // Find if any sandbox ID maps back to this production ID
      const sbxId = Object.entries(reverseIdMap).find(([, pid]) => pid === prodId)?.[0];
      if (sbxId && !sbxData.has(sbxId)) {
        entries.push({ file, id: prodId, action: 'deleted' });
      }
    }
  }

  const summary = {
    added: entries.filter((e) => e.action === 'added').length,
    modified: entries.filter((e) => e.action === 'modified').length,
    deleted: entries.filter((e) => e.action === 'deleted').length,
    total: entries.length,
  };

  return {
    sandboxId,
    entries,
    summary,
    generatedAt: new Date().toISOString(),
  };
}

// ---- Apply diff (promote) ----

export function applyDiff(
  sandboxId: string,
  selectedEntryIds?: string[],
): { applied: number; errors: string[] } {
  const sourceDir = getSourceDir();
  const sandboxDir = getSandboxDir(sandboxId);
  const errors: string[] = [];
  let applied = 0;

  const diff = diffSandbox(sandboxId);
  const entriesToApply = selectedEntryIds
    ? diff.entries.filter((e) => selectedEntryIds.includes(e.id))
    : diff.entries;

  // Get manifest for ID mappings
  const manifestPath = join(sandboxDir, '_manifest.json');
  let idMappings: Record<string, string> = {};
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      idMappings = manifest.idMappings ?? {};
    } catch {
      // Continue without
    }
  }
  const reverseIdMap: Record<string, string> = {};
  for (const [prodId, sbxId] of Object.entries(idMappings)) {
    reverseIdMap[sbxId] = prodId;
  }

  // Group entries by file
  const byFile = new Map<string, DiffEntry[]>();
  for (const entry of entriesToApply) {
    const existing = byFile.get(entry.file) ?? [];
    existing.push(entry);
    byFile.set(entry.file, existing);
  }

  for (const [file, fileEntries] of byFile) {
    try {
      const prodPath = join(sourceDir, file);
      const sbxPath = join(sandboxDir, file);
      const prodData = parseJsonlFile(prodPath);
      const sbxData = parseJsonlFile(sbxPath);

      for (const entry of fileEntries) {
        if (entry.action === 'modified') {
          const prodId = reverseIdMap[entry.id];
          if (prodId && sbxData.has(entry.id)) {
            const sbxObj = { ...sbxData.get(entry.id)!, id: prodId };
            prodData.set(prodId, sbxObj);
            applied++;
          }
        } else if (entry.action === 'added') {
          const newObj = sbxData.get(entry.id);
          if (newObj) {
            prodData.set(entry.id, newObj);
            applied++;
          }
        } else if (entry.action === 'deleted') {
          prodData.delete(entry.id);
          applied++;
        }
      }

      // Write updated production file
      const lines = Array.from(prodData.values()).map((obj) => JSON.stringify(obj));
      writeFileSync(prodPath, lines.join('\n') + '\n', 'utf-8');
    } catch (err) {
      errors.push(`${file}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  return { applied, errors };
}
