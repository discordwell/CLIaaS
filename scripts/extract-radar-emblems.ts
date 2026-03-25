#!/usr/bin/env tsx
/**
 * Extract NATORADR.SHP and USSRRADR.SHP from game MIX files → PNG sprite sheets.
 *
 * These are the Allied/Soviet radar emblems shown when no radar dome exists.
 * C++ radar.cpp lines 370-381 selects natoradr.shp or ussrradr.shp based on house.
 *
 * Usage:
 *   pnpm tsx scripts/extract-radar-emblems.ts
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { extractAllMIX } from './ra-assets/gamedata.js';
import { MixFile } from './ra-assets/mix.js';
import { parsePalette, indexedToRGBA, type Palette } from './ra-assets/palette.js';
import { encodePNG } from './ra-assets/png.js';
import { parseShp, type ShpFile } from './ra-assets/shp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const GAMEDATA_PATH = join(PROJECT_ROOT, 'public/ra/gamedata.data');
const GAMEDATA_JS = join(PROJECT_ROOT, 'public/ra/gamedata.js');
const ASSETS_DIR = join(PROJECT_ROOT, 'public/ra/assets');
const MANIFEST_PATH = join(ASSETS_DIR, 'manifest.json');

const TARGETS = ['NATORADR.SHP', 'USSRRADR.SHP'];

interface SpriteSheetMeta {
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  columns: number;
  rows: number;
  sheetWidth: number;
  sheetHeight: number;
}

function createSpriteSheet(
  shp: ShpFile,
  palette: Palette,
  framesPerRow = 16,
): { png: Buffer; meta: SpriteSheetMeta } {
  const cols = Math.min(framesPerRow, shp.frameCount);
  const rows = Math.ceil(shp.frameCount / cols);
  const sheetWidth = cols * shp.width;
  const sheetHeight = rows * shp.height;
  const rgba = new Uint8Array(sheetWidth * sheetHeight * 4);

  for (let i = 0; i < shp.frameCount; i++) {
    const frame = shp.frames[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const frameRGBA = indexedToRGBA(frame.pixels, palette, shp.width, shp.height);
    for (let y = 0; y < shp.height; y++) {
      const srcOff = y * shp.width * 4;
      const dstOff = ((row * shp.height + y) * sheetWidth + col * shp.width) * 4;
      rgba.set(frameRGBA.subarray(srcOff, srcOff + shp.width * 4), dstOff);
    }
  }

  return {
    png: encodePNG(rgba, sheetWidth, sheetHeight),
    meta: {
      frameWidth: shp.width,
      frameHeight: shp.height,
      frameCount: shp.frameCount,
      columns: cols,
      rows,
      sheetWidth,
      sheetHeight,
    },
  };
}

function main(): void {
  if (!existsSync(GAMEDATA_PATH)) {
    throw new Error(`${GAMEDATA_PATH} not found.`);
  }

  // Load palette from LOCAL.MIX → TEMPERAT.PAL
  const mixFiles = extractAllMIX(GAMEDATA_PATH, GAMEDATA_JS);
  const localMixData = mixFiles.get('LOCAL.MIX');
  if (!localMixData) throw new Error('LOCAL.MIX not found in gamedata.');
  const localMix = MixFile.fromBuffer(localMixData);
  const palData = localMix.readFile('TEMPERAT.PAL');
  if (!palData) throw new Error('TEMPERAT.PAL not found in LOCAL.MIX.');
  const palette = parsePalette(palData);

  // Search all MIX files for each target SHP
  const manifest = existsSync(MANIFEST_PATH)
    ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
    : {};

  for (const target of TARGETS) {
    let shpData: Buffer | null = null;
    let foundIn = '';

    for (const [mixName, mixBuf] of mixFiles) {
      const mix = MixFile.fromBuffer(mixBuf);
      const data = mix.readFile(target);
      if (data) {
        shpData = data;
        foundIn = mixName;
        break;
      }
    }

    if (!shpData) {
      console.error(`[radar] ${target} not found in any MIX file.`);
      continue;
    }

    console.log(`[radar] Found ${target} in ${foundIn}`);
    const shp = parseShp(shpData);
    console.log(`[radar]   ${shp.frameCount} frames, ${shp.width}×${shp.height}`);

    const { png, meta } = createSpriteSheet(shp, palette);
    const name = target.replace('.SHP', '').toLowerCase();
    const outPath = join(ASSETS_DIR, `${name}.png`);
    writeFileSync(outPath, png);
    manifest[name] = meta;
    console.log(`[radar]   → ${outPath}`);
  }

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log('[radar] Manifest updated.');
}

main();
