#!/usr/bin/env tsx
/**
 * Build the small Counterstrike expansion MIX required by the C++ parity
 * harness from the original loose SHP assets already checked into public/.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { filenameCRC } from './ra-assets/crc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const SOURCE_DIR = join(PROJECT_ROOT, 'public/ra/assets/original');
const OUTPUT_PATH = join(SOURCE_DIR, 'EXPAND.MIX');

const FILES = [
  'ANT1.SHP',
  'ANT2.SHP',
  'ANT3.SHP',
  'ANTDIE.SHP',
  'LAR1.SHP',
  'LAR2.SHP',
  'QUEE.SHP',
] as const;

interface MixEntry {
  name: string;
  crc: number;
  data: Buffer;
  offset: number;
}

function signedCrcCompare(a: MixEntry, b: MixEntry): number {
  return a.crc - b.crc;
}

function buildPlainMix(entries: MixEntry[]): Buffer {
  entries.sort(signedCrcCompare);

  let dataSize = 0;
  for (const entry of entries) {
    entry.offset = dataSize;
    dataSize += entry.data.length;
  }

  const header = Buffer.alloc(2 + 4 + entries.length * 12);
  header.writeUInt16LE(entries.length, 0);
  header.writeUInt32LE(dataSize, 2);

  let headerOffset = 6;
  for (const entry of entries) {
    header.writeInt32LE(entry.crc, headerOffset);
    header.writeInt32LE(entry.offset, headerOffset + 4);
    header.writeInt32LE(entry.data.length, headerOffset + 8);
    headerOffset += 12;
  }

  return Buffer.concat([header, ...entries.map((entry) => entry.data)]);
}

function main(): void {
  mkdirSync(SOURCE_DIR, { recursive: true });

  const entries: MixEntry[] = FILES.map((name) => {
    const path = join(SOURCE_DIR, name);
    if (!existsSync(path)) {
      throw new Error(`Missing original expansion asset: ${path}`);
    }
    return {
      name,
      crc: filenameCRC(name),
      data: readFileSync(path),
      offset: 0,
    };
  });

  writeFileSync(OUTPUT_PATH, buildPlainMix(entries));
  console.log(`Wrote ${OUTPUT_PATH} (${entries.length} files)`);
}

main();
