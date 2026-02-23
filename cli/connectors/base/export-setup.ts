/**
 * Shared export utilities: directory setup, JSONL writing, manifest, spinners.
 * Replaces 10 copies of identical boilerplate.
 */

import { mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import type { ExportManifest } from '../../schema/types.js';
import type { ConnectorSource } from './types.js';

/** Standard export file names shared across connectors. */
const STANDARD_FILES = [
  'tickets.jsonl',
  'messages.jsonl',
  'customers.jsonl',
  'organizations.jsonl',
  'kb_articles.jsonl',
  'rules.jsonl',
] as const;

/**
 * Create output directory and initialize JSONL files.
 * Returns an object mapping logical names to file paths.
 */
export function setupExport(
  outDir: string,
  extraFiles?: string[],
): Record<string, string> {
  mkdirSync(outDir, { recursive: true });

  const allFiles = [...STANDARD_FILES, ...(extraFiles ?? [])];
  const paths: Record<string, string> = {};

  for (const filename of allFiles) {
    const filePath = join(outDir, filename);
    writeFileSync(filePath, '');
    // Key: "tickets" from "tickets.jsonl", "sla_policies" from "sla_policies.jsonl"
    const key = filename.replace('.jsonl', '');
    paths[key] = filePath;
  }

  return paths;
}

/** Append a single record as a JSONL line. */
export function appendJsonl(filePath: string, record: unknown): void {
  appendFileSync(filePath, JSON.stringify(record) + '\n');
}

/** Write the export manifest to outDir/manifest.json. */
export function writeManifest(
  outDir: string,
  source: ConnectorSource,
  counts: ExportManifest['counts'],
  extra?: Record<string, unknown>,
): ExportManifest {
  const manifest: ExportManifest = {
    source,
    exportedAt: new Date().toISOString(),
    counts,
    ...extra,
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(chalk.green(`\nExport complete → ${outDir}/manifest.json`));
  return manifest;
}

/** Create a labeled ora spinner. */
export function exportSpinner(label: string): Ora {
  return ora(label).start();
}
