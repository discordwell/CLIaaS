#!/usr/bin/env tsx

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const UPSTREAM_REPO = 'https://github.com/Daft-Freak/CnC_and_Red_Alert.git';
const SOURCE_DIR = path.join(process.cwd(), 'src', 'EasterEgg', 'CnC_and_Red_Alert');
const CACHE_DIR = process.env.RA_SOURCE_CACHE_DIR
  ? path.resolve(process.env.RA_SOURCE_CACHE_DIR)
  : path.join(os.homedir(), '.cache', 'cliaas', 'ra-source', 'CnC_and_Red_Alert');

const REQUIRED_FILES = [
  path.join('RA', 'bdata.cpp'),
  path.join('RA', 'building.cpp'),
  path.join('RA', 'rules.cpp'),
  'CMakeLists.txt',
];

interface CopyStats {
  copied: number;
  preserved: number;
}

function hasRequiredFiles(root: string): boolean {
  return REQUIRED_FILES.every(file => fs.existsSync(path.join(root, file)));
}

function ensureCache(): void {
  if (hasRequiredFiles(CACHE_DIR)) {
    return;
  }

  fs.mkdirSync(path.dirname(CACHE_DIR), { recursive: true });
  if (fs.existsSync(CACHE_DIR)) {
    throw new Error(
      `RA source cache exists but is incomplete: ${CACHE_DIR}\n` +
      `Delete it or set RA_SOURCE_CACHE_DIR to a clean directory, then rerun this command.`,
    );
  }

  console.log(`Cloning Red Alert source into cache: ${CACHE_DIR}`);
  execFileSync('git', ['clone', '--depth', '1', UPSTREAM_REPO, CACHE_DIR], {
    stdio: 'inherit',
  });
}

function copyMissingFiles(fromDir: string, toDir: string, stats: CopyStats): void {
  fs.mkdirSync(toDir, { recursive: true });

  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    if (entry.name === '.git') {
      continue;
    }

    const sourcePath = path.join(fromDir, entry.name);
    const destPath = path.join(toDir, entry.name);

    if (entry.isDirectory()) {
      copyMissingFiles(sourcePath, destPath, stats);
      continue;
    }

    if (fs.existsSync(destPath)) {
      stats.preserved++;
      continue;
    }

    fs.copyFileSync(sourcePath, destPath);
    stats.copied++;
  }
}

function main(): void {
  fs.mkdirSync(SOURCE_DIR, { recursive: true });

  if (hasRequiredFiles(SOURCE_DIR)) {
    console.log(`Red Alert source already populated: ${SOURCE_DIR}`);
    return;
  }

  ensureCache();

  const stats: CopyStats = { copied: 0, preserved: 0 };
  copyMissingFiles(CACHE_DIR, SOURCE_DIR, stats);

  if (!hasRequiredFiles(SOURCE_DIR)) {
    const missing = REQUIRED_FILES
      .filter(file => !fs.existsSync(path.join(SOURCE_DIR, file)))
      .join(', ');
    throw new Error(`Red Alert source population incomplete; missing: ${missing}`);
  }

  console.log(
    `Red Alert source ready: copied ${stats.copied} missing files, ` +
    `preserved ${stats.preserved} existing harness/source files.`,
  );
}

main();
