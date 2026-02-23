/**
 * Sandbox data cloning engine.
 * Copies JSONL data files into isolated sandbox directories.
 * Supports filtered cloning and ID remapping.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

// ---- Types ----

export interface CloneOptions {
  includeTickets?: boolean;
  includeKB?: boolean;
  includeRules?: boolean;
  includeSLA?: boolean;
  includeCustomFields?: boolean;
  includeWebhooks?: boolean;
  includePlugins?: boolean;
}

export interface CloneManifest {
  sandboxId: string;
  sourceDir: string;
  sandboxDir: string;
  clonedFiles: string[];
  idMappings: Record<string, string>;  // old ID -> new ID
  clonedAt: string;
  options: CloneOptions;
}

// ---- File categories ----

const FILE_CATEGORIES: Record<string, string[]> = {
  tickets: ['tickets.jsonl', 'messages.jsonl', 'ticket-tags.jsonl'],
  kb: ['kb-articles.jsonl', 'kb-categories.jsonl'],
  rules: ['automation-rules.jsonl'],
  sla: ['sla-policies.jsonl'],
  customFields: ['custom-fields.jsonl'],
  webhooks: ['webhooks.jsonl', 'webhook-logs.jsonl'],
  plugins: ['plugins.jsonl'],
};

function getSourceDir(): string {
  return process.env.CLIAAS_DATA_DIR || '/tmp/cliaas-demo';
}

function getSandboxDir(sandboxId: string): string {
  const baseDir = process.env.CLIAAS_DATA_DIR || '/tmp/cliaas-demo';
  return join(baseDir, 'sandboxes', sandboxId);
}

// ---- ID Remapping ----

function remapId(oldId: string, prefix: string): string {
  return `${prefix}-sbx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function remapJsonlIds(
  lines: string[],
  idField: string,
  foreignKeyFields: string[],
  idMappings: Record<string, string>,
): string[] {
  return lines.map((line) => {
    if (!line.trim()) return line;
    try {
      const obj = JSON.parse(line);

      // Remap primary ID
      if (obj[idField]) {
        const oldId = obj[idField];
        if (!idMappings[oldId]) {
          idMappings[oldId] = remapId(oldId, idField === 'id' ? 'sbx' : idField);
        }
        obj[idField] = idMappings[oldId];
      }

      // Remap foreign keys
      for (const fk of foreignKeyFields) {
        if (obj[fk] && idMappings[obj[fk]]) {
          obj[fk] = idMappings[obj[fk]];
        }
      }

      return JSON.stringify(obj);
    } catch {
      return line;
    }
  });
}

// ---- Clone ----

export function cloneToSandbox(
  sandboxId: string,
  options: CloneOptions = {},
): CloneManifest {
  const sourceDir = getSourceDir();
  const sandboxDir = getSandboxDir(sandboxId);

  // Create sandbox directory
  if (!existsSync(sandboxDir)) {
    mkdirSync(sandboxDir, { recursive: true });
  }

  // Determine which files to clone
  const defaults: CloneOptions = {
    includeTickets: true,
    includeKB: true,
    includeRules: true,
    includeSLA: true,
    includeCustomFields: true,
    includeWebhooks: false,
    includePlugins: false,
  };
  const opts = { ...defaults, ...options };

  const filesToClone: string[] = [];
  if (opts.includeTickets) filesToClone.push(...FILE_CATEGORIES.tickets);
  if (opts.includeKB) filesToClone.push(...FILE_CATEGORIES.kb);
  if (opts.includeRules) filesToClone.push(...FILE_CATEGORIES.rules);
  if (opts.includeSLA) filesToClone.push(...FILE_CATEGORIES.sla);
  if (opts.includeCustomFields) filesToClone.push(...FILE_CATEGORIES.customFields);
  if (opts.includeWebhooks) filesToClone.push(...FILE_CATEGORIES.webhooks);
  if (opts.includePlugins) filesToClone.push(...FILE_CATEGORIES.plugins);

  const clonedFiles: string[] = [];
  const idMappings: Record<string, string> = {};

  // Foreign key mappings for each file type
  const fkMap: Record<string, { idField: string; foreignKeys: string[] }> = {
    'tickets.jsonl': { idField: 'id', foreignKeys: [] },
    'messages.jsonl': { idField: 'id', foreignKeys: ['ticketId'] },
    'ticket-tags.jsonl': { idField: 'id', foreignKeys: ['ticketId'] },
    'kb-articles.jsonl': { idField: 'id', foreignKeys: ['categoryId'] },
    'kb-categories.jsonl': { idField: 'id', foreignKeys: [] },
    'automation-rules.jsonl': { idField: 'id', foreignKeys: [] },
    'sla-policies.jsonl': { idField: 'id', foreignKeys: [] },
    'custom-fields.jsonl': { idField: 'id', foreignKeys: [] },
    'webhooks.jsonl': { idField: 'id', foreignKeys: [] },
    'webhook-logs.jsonl': { idField: 'id', foreignKeys: ['webhookId'] },
    'plugins.jsonl': { idField: 'id', foreignKeys: [] },
  };

  for (const file of filesToClone) {
    const sourcePath = join(sourceDir, file);
    if (!existsSync(sourcePath)) continue;

    const content = readFileSync(sourcePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());

    const fk = fkMap[file] ?? { idField: 'id', foreignKeys: [] };
    const remapped = remapJsonlIds(lines, fk.idField, fk.foreignKeys, idMappings);

    writeFileSync(join(sandboxDir, file), remapped.join('\n') + '\n', 'utf-8');
    clonedFiles.push(file);
  }

  const manifest: CloneManifest = {
    sandboxId,
    sourceDir,
    sandboxDir,
    clonedFiles,
    idMappings,
    clonedAt: new Date().toISOString(),
    options: opts,
  };

  // Save manifest
  writeFileSync(
    join(sandboxDir, '_manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );

  return manifest;
}

// ---- Teardown ----

export function teardownSandbox(sandboxId: string): boolean {
  const sandboxDir = getSandboxDir(sandboxId);
  if (!existsSync(sandboxDir)) return false;
  rmSync(sandboxDir, { recursive: true });
  return true;
}

// ---- Get Manifest ----

export function getCloneManifest(sandboxId: string): CloneManifest | null {
  const sandboxDir = getSandboxDir(sandboxId);
  const manifestPath = join(sandboxDir, '_manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

// ---- List sandbox data files ----

export function listSandboxFiles(sandboxId: string): string[] {
  const sandboxDir = getSandboxDir(sandboxId);
  if (!existsSync(sandboxDir)) return [];
  return readdirSync(sandboxDir).filter((f) => f.endsWith('.jsonl'));
}
