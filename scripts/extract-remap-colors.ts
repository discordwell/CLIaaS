#!/usr/bin/env tsx
/**
 * Minimal standalone extractor: regenerate public/ra/assets/remap-colors.json
 * from gamedata.data's PALETTE.CPS. Adds England (GREEN) and France (BLUE) rows
 * that the main extract-ra-assets.ts was missing.
 *
 * Usage: pnpm tsx scripts/extract-remap-colors.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MixFile } from './ra-assets/mix.js';
import { extractAllMIX } from './ra-assets/gamedata.js';
import { parsePalette } from './ra-assets/palette.js';
import { parseCps } from './ra-assets/cps.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const GAMEDATA_PATH = join(PROJECT_ROOT, 'public/ra/gamedata.data');
const GAMEDATA_JS = join(PROJECT_ROOT, 'public/ra/gamedata.js');
const OUTPUT = join(PROJECT_ROOT, 'public/ra/assets/remap-colors.json');

const log = (msg: string) => process.stdout.write(msg + '\n');

const mixBuffers = extractAllMIX(GAMEDATA_PATH, GAMEDATA_JS);
const mixParsed = new Map<string, MixFile>();
for (const [name, buf] of mixBuffers) {
  try { mixParsed.set(name, new MixFile(buf)); }
  catch (e) { log(`  skip ${name}: ${e}`); }
}

// Palette: TEMPERAT.PAL is in LOCAL.MIX / TEMPERAT.MIX / CONQUER.MIX (search order from extract-ra-assets.ts:490)
let palData: Buffer | null = null;
for (const searchMix of ['LOCAL.MIX', 'TEMPERAT.MIX', 'CONQUER.MIX']) {
  const mix = mixParsed.get(searchMix);
  if (mix) {
    palData = mix.readFile('TEMPERAT.PAL');
    if (palData) { log(`Found TEMPERAT.PAL in ${searchMix}`); break; }
  }
}
if (!palData) throw new Error('TEMPERAT.PAL not found');
const palette = parsePalette(palData);

// PALETTE.CPS from CONQUER/LORES/LOCAL
let cpsData: Buffer | null = null;
for (const searchMix of ['LORES.MIX', 'CONQUER.MIX', 'LOCAL.MIX']) {
  const mix = mixParsed.get(searchMix);
  if (mix) {
    cpsData = mix.readFile('PALETTE.CPS');
    if (cpsData) { log(`Found PALETTE.CPS in ${searchMix}`); break; }
  }
}
if (!cpsData) throw new Error('PALETTE.CPS not found');

const cps = parseCps(cpsData);

// Row 0 = source gold gradient; rows 1..7 = PCOLOR remaps (16 pixels wide).
// House→PCOLOR from hdata.cpp + defines.h:1192-1209.
const HOUSE_PCOLOR: Record<string, number> = {
  Spain: 0,    // PCOLOR_GOLD
  Greece: 1,   // PCOLOR_LTBLUE
  USSR: 2,     // PCOLOR_RED
  England: 3,  // PCOLOR_GREEN
  Ukraine: 4,  // PCOLOR_ORANGE
  Germany: 5,  // PCOLOR_GREY
  France: 6,   // PCOLOR_BLUE
  Turkey: 7,   // PCOLOR_BROWN
};

const sourceIndices: number[] = [];
for (let x = 0; x < 16; x++) sourceIndices.push(cps.pixels[0 * 320 + x]);
const sourceColors = sourceIndices.map(idx => [
  palette.colors[idx * 4],
  palette.colors[idx * 4 + 1],
  palette.colors[idx * 4 + 2],
]);

const houses: Record<string, number[][]> = {};
for (const [houseName, pcolorRow] of Object.entries(HOUSE_PCOLOR)) {
  const houseColors: number[][] = [];
  for (let x = 0; x < 16; x++) {
    const palIdx = cps.pixels[pcolorRow * 320 + x];
    houseColors.push([
      palette.colors[palIdx * 4],
      palette.colors[palIdx * 4 + 1],
      palette.colors[palIdx * 4 + 2],
    ]);
  }
  houses[houseName] = houseColors;
}

// Aliases (same object references) for house enum names without direct PCOLOR slots.
// C++ hdata.cpp: GoodGuy=LTBLUE, BadGuy=RED, Neutral=GOLD, Special=GOLD.
// Multi6=GREY, Multi7=BLUE, Multi8=BROWN (unused in single-player but keep for parity).
houses.GoodGuy = houses.Greece;   // PCOLOR_LTBLUE
houses.BadGuy = houses.USSR;      // PCOLOR_RED
houses.Neutral = houses.Spain;    // PCOLOR_GOLD
houses.Special = houses.Spain;    // PCOLOR_GOLD
houses.Multi6 = houses.Germany;   // PCOLOR_GREY
houses.Multi7 = houses.France;    // PCOLOR_BLUE
houses.Multi8 = houses.Turkey;    // PCOLOR_BROWN

writeFileSync(OUTPUT, JSON.stringify({ source: sourceColors, houses }));
log(`Wrote ${OUTPUT}`);
log(`Houses: ${Object.keys(houses).join(', ')}`);
for (const h of ['England', 'France']) {
  log(`  ${h}[0..3]: ${houses[h].slice(0, 4).map(c => `rgb(${c.join(',')})`).join(' ')}`);
}
