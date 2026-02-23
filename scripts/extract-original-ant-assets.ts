#!/usr/bin/env tsx
/**
 * Convert original ant SHP assets to PNG sheets and wire ANT1/2/3 into active assets.
 *
 * Usage:
 *   pnpm tsx scripts/extract-original-ant-assets.ts <expand2-unpack-dir>
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { extractAllMIX } from './ra-assets/gamedata.js';
import { MixFile } from './ra-assets/mix.js';
import { parsePalette, indexedToRGBA, type Palette } from './ra-assets/palette.js';
import { encodePNG } from './ra-assets/png.js';
import { parseShp, type ShpFile } from './ra-assets/shp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const GAMEDATA_PATH = join(PROJECT_ROOT, 'public/ra/gamedata.data');
const GAMEDATA_JS = join(PROJECT_ROOT, 'public/ra/gamedata.js');
const ACTIVE_ASSETS_DIR = join(PROJECT_ROOT, 'public/ra/assets');
const ORIGINAL_ASSETS_DIR = join(ACTIVE_ASSETS_DIR, 'original');
const ACTIVE_MANIFEST_PATH = join(ACTIVE_ASSETS_DIR, 'manifest.json');
const ORIGINAL_MANIFEST_PATH = join(ORIGINAL_ASSETS_DIR, 'manifest.json');

const ASSETS: Array<{ shp: string; name: string; promote: boolean }> = [
  { shp: 'ANT1.SHP', name: 'ant1', promote: true },
  { shp: 'ANT2.SHP', name: 'ant2', promote: true },
  { shp: 'ANT3.SHP', name: 'ant3', promote: true },
  { shp: 'LAR1.SHP', name: 'lar1', promote: true },
  { shp: 'LAR2.SHP', name: 'lar2', promote: true },
  { shp: 'QUEE.SHP', name: 'quee', promote: true },
  { shp: 'ANTDIE.SHP', name: 'antdie', promote: true },
];

interface SpriteSheetMeta {
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  columns: number;
  rows: number;
  sheetWidth: number;
  sheetHeight: number;
}

function log(msg: string): void {
  console.log(`[ant-assets] ${msg}`);
}

function createSpriteSheet(
  shp: ShpFile,
  palette: Palette,
  framesPerRow: number = 16,
  indexRemap?: Map<number, number>
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
    const sourcePixels = indexRemap ? new Uint8Array(frame.pixels) : frame.pixels;
    if (indexRemap) {
      for (let p = 0; p < sourcePixels.length; p++) {
        const mapped = indexRemap.get(sourcePixels[p]);
        if (mapped !== undefined) sourcePixels[p] = mapped;
      }
    }
    const frameRGBA = indexedToRGBA(sourcePixels, palette, shp.width, shp.height);

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

function loadPalette(): Palette {
  if (!existsSync(GAMEDATA_PATH)) {
    throw new Error(`${GAMEDATA_PATH} not found. Run package-gamedata first.`);
  }
  const mixFiles = extractAllMIX(GAMEDATA_PATH, GAMEDATA_JS);
  const localMixData = mixFiles.get('LOCAL.MIX');
  if (!localMixData) throw new Error('LOCAL.MIX not found in gamedata package.');
  const localMix = MixFile.fromBuffer(localMixData);
  const palData = localMix.readFile('TEMPERAT.PAL');
  if (!palData) throw new Error('TEMPERAT.PAL not found in LOCAL.MIX.');
  return parsePalette(palData);
}

function main(): void {
  const sourceDir = process.argv[2] ?? '/tmp/ra_ant_extract/am_expand2_unpack';
  if (!existsSync(sourceDir)) {
    throw new Error(`Source directory not found: ${sourceDir}`);
  }

  mkdirSync(ORIGINAL_ASSETS_DIR, { recursive: true });
  mkdirSync(ACTIVE_ASSETS_DIR, { recursive: true });

  const palette = loadPalette();
  const originalManifest: Record<string, SpriteSheetMeta> = {};
  const activeManifest = existsSync(ACTIVE_MANIFEST_PATH)
    ? JSON.parse(readFileSync(ACTIVE_MANIFEST_PATH, 'utf-8'))
    : {};

  for (const asset of ASSETS) {
    const shpPath = join(sourceDir, asset.shp);
    if (!existsSync(shpPath)) {
      throw new Error(`Missing source SHP: ${shpPath}`);
    }

    const shpData = readFileSync(shpPath);
    const shp = parseShp(shpData);
    const { png, meta } = createSpriteSheet(shp, palette);

    copyFileSync(shpPath, join(ORIGINAL_ASSETS_DIR, asset.shp));
    writeFileSync(join(ORIGINAL_ASSETS_DIR, `${asset.name}.png`), png);
    originalManifest[asset.name] = meta;

    if (asset.promote) {
      // ANT SHPs use index 4 as a remap color mask. In web extraction this appears neon green.
      // Bake a neutral brown remap for active runtime sheets while preserving raw originals.
      const activeRemap = new Map<number, number>([[4, 92]]);
      const promotedPng = createSpriteSheet(
        shp,
        palette,
        16,
        asset.name.startsWith('ant') ? activeRemap : undefined
      ).png;

      writeFileSync(join(ACTIVE_ASSETS_DIR, `${asset.name}.png`), promotedPng);
      activeManifest[asset.name] = meta;
    }

    log(`${asset.name}: ${meta.frameCount} frames, ${meta.frameWidth}x${meta.frameHeight}`);
  }

  writeFileSync(ORIGINAL_MANIFEST_PATH, JSON.stringify(originalManifest, null, 2));
  writeFileSync(ACTIVE_MANIFEST_PATH, JSON.stringify(activeManifest, null, 2));

  log(`Wrote originals to ${ORIGINAL_ASSETS_DIR}`);
  log('Updated active sheets and manifest in public/ra/assets');

  // === Extra Aftermath assets available but NOT extracted ===
  // These files exist in the Aftermath EXPAND2.MIX but are not used by the
  // ant mission engine. Listed here for reference if future missions need them.
  //
  // Sounds (AUD format):
  //   ANTBITE.AUD  — ant melee attack sound
  //   ANTDIE.AUD   — ant death scream
  //   BUZZY1.AUD   — ambient ant hive buzzing
  //   TANK01.AUD   — tank engine loop
  //
  // Vehicles (SHP sprites):
  //   CARR.SHP     — Aircraft Carrier
  //   CTNK.SHP     — Chrono Tank
  //   DTRK.SHP     — Demolition Truck
  //   MSUB.SHP     — Missile Submarine
  //   QTNK.SHP     — MAD Tank
  //   STNK.SHP     — Stealth Tank (Phase Transport)
  //
  // Stavros voice lines (AUD format):
  //   STAVCMDR.AUD — "Commander..." (mission briefing)
  //   STAVCRSE.AUD — "Curse them!" (unit lost)
  //   STAVMOV.AUD  — "Move out!" (unit ordered)
  //   STAVYES.AUD  — "Yes!" (acknowledged)
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
