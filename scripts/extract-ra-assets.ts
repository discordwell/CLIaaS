#!/usr/bin/env tsx
/**
 * Red Alert Asset Extraction Script
 *
 * Reads gamedata.data -> extracts MIX files -> parses SHP sprites and palettes
 * -> outputs PNG sprite sheets + JSON metadata to public/ra/assets/
 *
 * Usage: pnpm extract-assets
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MixFile } from './ra-assets/mix.js';
import { extractAllMIX } from './ra-assets/gamedata.js';
import { parseShp, type ShpFile } from './ra-assets/shp.js';
import { parsePalette, indexedToRGBA, type Palette } from './ra-assets/palette.js';
import { encodePNG } from './ra-assets/png.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const GAMEDATA_PATH = join(PROJECT_ROOT, 'public/ra/gamedata.data');
const GAMEDATA_JS = join(PROJECT_ROOT, 'public/ra/gamedata.js');
const OUTPUT_DIR = join(PROJECT_ROOT, 'public/ra/assets');

// Assets to extract: [mixFile, internalFilename, outputName]
// Asset locations verified by searching all MIX files
const SPRITE_ASSETS: [string, string, string][] = [
  // Vehicles (CONQUER.MIX) — RA uses 1TNK/2TNK/3TNK/4TNK naming
  ['CONQUER.MIX', '1TNK.SHP', '1tnk'],    // Light tank
  ['CONQUER.MIX', '2TNK.SHP', '2tnk'],    // Medium tank
  ['CONQUER.MIX', '3TNK.SHP', '3tnk'],    // Heavy/Mammoth tank
  ['CONQUER.MIX', '4TNK.SHP', '4tnk'],    // Tesla tank
  ['CONQUER.MIX', 'JEEP.SHP', 'jeep'],    // Ranger
  ['CONQUER.MIX', 'APC.SHP', 'apc'],      // APC
  ['CONQUER.MIX', 'HARV.SHP', 'harv'],    // Harvester
  ['CONQUER.MIX', 'MCV.SHP', 'mcv'],      // MCV
  ['CONQUER.MIX', 'ARTY.SHP', 'arty'],    // Artillery
  ['CONQUER.MIX', 'TRUK.SHP', 'truk'],    // Supply truck / transport
  ['CONQUER.MIX', 'MNLY.SHP', 'mnly'],    // Minelayer
  ['CONQUER.MIX', 'MGG.SHP', 'mgg'],      // Mobile gap generator
  ['CONQUER.MIX', 'V2RL.SHP', 'v2rl'],    // V2 rocket launcher
  // Infantry (LORES.MIX — not CONQUER.MIX!)
  ['LORES.MIX', 'E1.SHP', 'e1'],          // Rifle infantry
  ['LORES.MIX', 'E2.SHP', 'e2'],          // Grenadier
  ['LORES.MIX', 'E3.SHP', 'e3'],          // Rocket soldier
  ['LORES.MIX', 'E4.SHP', 'e4'],          // Flamethrower
  ['LORES.MIX', 'E6.SHP', 'e6'],          // Engineer
  ['LORES.MIX', 'DOG.SHP', 'dog'],        // Attack dog
  ['LORES.MIX', 'SPY.SHP', 'spy'],        // Spy
  ['LORES.MIX', 'MEDI.SHP', 'medi'],      // Medic
  ['LORES.MIX', 'THF.SHP', 'thf'],        // Thief
  ['LORES.MIX', 'SHOK.SHP', 'shok'],      // Shock trooper
  // Ant units (EXPAND.MIX — Counterstrike content)
  ['EXPAND.MIX', 'ANT1.SHP', 'ant1'],     // Small ant
  ['EXPAND.MIX', 'ANT2.SHP', 'ant2'],     // Medium ant
  ['EXPAND.MIX', 'ANT3.SHP', 'ant3'],     // Large ant
  // Ant structures (EXPAND.MIX)
  ['EXPAND.MIX', 'QUEE.SHP', 'queen'],    // Ant queen
  ['EXPAND.MIX', 'LAR1.SHP', 'lar1'],     // Ant larva 1
  ['EXPAND.MIX', 'LAR2.SHP', 'lar2'],     // Ant larva 2
  // Explosions/effects (CONQUER.MIX)
  ['CONQUER.MIX', 'PIFF.SHP', 'piff'],
  ['CONQUER.MIX', 'PIFFPIFF.SHP', 'piffpiff'],
  ['CONQUER.MIX', 'FBALL1.SHP', 'fball1'],
  ['CONQUER.MIX', 'VEH-HIT1.SHP', 'veh-hit1'],
  ['CONQUER.MIX', 'NAPALM.SHP', 'napalm'],
  ['CONQUER.MIX', 'ATOMSFX.SHP', 'atomsfx'],     // Nuclear explosion
  ['CONQUER.MIX', 'SMOKEY.SHP', 'smokey'],        // Smoke effect
  ['CONQUER.MIX', 'LITNING.SHP', 'litning'],      // Lightning effect
  // Buildings — production (CONQUER.MIX)
  ['CONQUER.MIX', 'FACT.SHP', 'fact'],    // Construction Yard
  ['CONQUER.MIX', 'POWR.SHP', 'powr'],    // Power Plant
  ['CONQUER.MIX', 'APWR.SHP', 'apwr'],    // Advanced Power Plant
  ['CONQUER.MIX', 'BARR.SHP', 'barr'],    // Allied Barracks
  ['CONQUER.MIX', 'TENT.SHP', 'tent'],    // Soviet Barracks
  ['CONQUER.MIX', 'WEAP.SHP', 'weap'],    // War Factory
  ['CONQUER.MIX', 'PROC.SHP', 'proc'],    // Ore Refinery
  ['CONQUER.MIX', 'SILO.SHP', 'silo'],    // Ore Silo
  ['CONQUER.MIX', 'DOME.SHP', 'dome'],    // Radar Dome
  ['CONQUER.MIX', 'FIX.SHP', 'fix'],      // Service Depot
  // Buildings — defense
  ['CONQUER.MIX', 'GUN.SHP', 'gun'],      // Turret
  ['CONQUER.MIX', 'SAM.SHP', 'sam'],      // SAM site
  ['CONQUER.MIX', 'HBOX.SHP', 'hbox'],    // Pillbox
  ['CONQUER.MIX', 'TSLA.SHP', 'tsla'],    // Tesla Coil
  ['CONQUER.MIX', 'AGUN.SHP', 'agun'],    // Anti-Aircraft Gun
  ['CONQUER.MIX', 'GAP.SHP', 'gap'],      // Gap Generator
  ['CONQUER.MIX', 'PBOX.SHP', 'pbox'],    // Camo Pillbox
  // Buildings — tech/special
  ['CONQUER.MIX', 'HPAD.SHP', 'hpad'],    // Helipad
  ['CONQUER.MIX', 'AFLD.SHP', 'afld'],    // Airfield
  ['CONQUER.MIX', 'MSLO.SHP', 'mslo'],    // Missile Silo
  ['CONQUER.MIX', 'ATEK.SHP', 'atek'],    // Allied Tech Center
  ['CONQUER.MIX', 'STEK.SHP', 'stek'],    // Soviet Tech Center
  ['CONQUER.MIX', 'IRON.SHP', 'iron'],    // Iron Curtain
  ['CONQUER.MIX', 'PDOX.SHP', 'pdox'],    // Chronosphere
  ['CONQUER.MIX', 'KENN.SHP', 'kenn'],    // Kennel
  // Walls / fences
  ['CONQUER.MIX', 'FENC.SHP', 'fenc'],    // Chain-link fence
  ['CONQUER.MIX', 'BRIK.SHP', 'brik'],    // Concrete wall
  ['CONQUER.MIX', 'SBAG.SHP', 'sbag'],    // Sandbags
  ['CONQUER.MIX', 'BARB.SHP', 'barb'],    // Barbed wire
  ['CONQUER.MIX', 'WOOD.SHP', 'wood'],    // Wooden fence
];

function log(msg: string): void {
  console.log(`[extract] ${msg}`);
}

function createSpriteSheet(
  shp: ShpFile,
  palette: Palette,
  framesPerRow: number = 16
): { png: Buffer; meta: object } {
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

    // Copy frame RGBA into sprite sheet
    for (let y = 0; y < shp.height; y++) {
      const srcOff = y * shp.width * 4;
      const dstOff =
        ((row * shp.height + y) * sheetWidth + col * shp.width) * 4;
      rgba.set(frameRGBA.subarray(srcOff, srcOff + shp.width * 4), dstOff);
    }
  }

  const png = encodePNG(rgba, sheetWidth, sheetHeight);

  const meta = {
    frameWidth: shp.width,
    frameHeight: shp.height,
    frameCount: shp.frameCount,
    columns: cols,
    rows,
    sheetWidth,
    sheetHeight,
  };

  return { png, meta };
}

async function main(): Promise<void> {
  if (!existsSync(GAMEDATA_PATH)) {
    console.error(
      `ERROR: ${GAMEDATA_PATH} not found. Run the game data packager first.`
    );
    process.exit(1);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  log('Extracting MIX files from gamedata.data...');
  const mixFiles = extractAllMIX(GAMEDATA_PATH, GAMEDATA_JS);
  log(`Found ${mixFiles.size} MIX files: ${[...mixFiles.keys()].join(', ')}`);

  // Parse MIX files (including nested MIX archives)
  const mixParsed = new Map<string, MixFile>();
  for (const [name, data] of mixFiles) {
    try {
      mixParsed.set(name, MixFile.fromBuffer(data));
      log(`  Parsed ${name} (${data.length} bytes, ${mixParsed.get(name)!.entryCount} entries)`);
    } catch (e) {
      log(`  WARNING: Failed to parse ${name}: ${e}`);
    }
  }

  // Also try to parse nested MIX files inside LORES.MIX, EXPAND.MIX etc.
  // LORES.MIX contains infantry sprites directly, not as a nested MIX
  // But some files might be inside nested archives
  for (const parentName of ['LORES.MIX', 'EXPAND.MIX']) {
    const parent = mixParsed.get(parentName);
    if (!parent) continue;
    // Check for nested MIX files
    for (const nestedName of ['CONQUER.MIX', 'GENERAL.MIX']) {
      const nestedData = parent.readFile(nestedName);
      if (nestedData) {
        const key = `${parentName}/${nestedName}`;
        try {
          mixParsed.set(key, MixFile.fromBuffer(nestedData));
          log(`  Parsed nested ${key} (${nestedData.length} bytes)`);
        } catch (e) {
          log(`  WARNING: Failed to parse nested ${key}: ${e}`);
        }
      }
    }
  }

  // Extract palette — TEMPERAT.PAL is in LOCAL.MIX (verified)
  log('Extracting palette...');
  let palette: Palette;

  // Search for TEMPERAT.PAL across all parsed MIX files
  let palData: Buffer | null = null;
  for (const searchMix of ['LOCAL.MIX', 'TEMPERAT.MIX', 'CONQUER.MIX']) {
    const mix = mixParsed.get(searchMix);
    if (mix) {
      palData = mix.readFile('TEMPERAT.PAL');
      if (palData) {
        log(`  Found TEMPERAT.PAL in ${searchMix} (${palData.length} bytes)`);
        break;
      }
    }
  }

  if (palData) {
    palette = parsePalette(palData);
    // Save palette as JSON
    const palJSON = [];
    for (let i = 0; i < 256; i++) {
      palJSON.push([
        palette.colors[i * 4],
        palette.colors[i * 4 + 1],
        palette.colors[i * 4 + 2],
        palette.colors[i * 4 + 3],
      ]);
    }
    writeFileSync(join(OUTPUT_DIR, 'palette.json'), JSON.stringify(palJSON));
  } else {
    log('  WARNING: TEMPERAT.PAL not found, using default palette');
    palette = makeDefaultPalette();
  }

  // Extract sprite assets
  log('Extracting sprites...');
  const assetManifest: Record<string, object> = {};
  let extracted = 0;
  let skipped = 0;

  for (const [mixName, shpName, outputName] of SPRITE_ASSETS) {
    // Search in the specified MIX file first, then fall back to others
    let shpData: Buffer | null = null;
    let foundIn = '';

    // Try specified MIX first
    const primaryMix = mixParsed.get(mixName);
    if (primaryMix) {
      shpData = primaryMix.readFile(shpName);
      if (shpData) foundIn = mixName;
    }

    // Fall back: search all MIX files
    if (!shpData) {
      for (const [mName, mix] of mixParsed) {
        if (mName === mixName) continue;
        shpData = mix.readFile(shpName);
        if (shpData) {
          foundIn = mName;
          break;
        }
      }
    }

    if (!shpData) {
      log(`  SKIP ${shpName}: not found in any MIX file`);
      skipped++;
      continue;
    }

    try {
      const shp = parseShp(shpData);
      const { png, meta } = createSpriteSheet(shp, palette);

      writeFileSync(join(OUTPUT_DIR, `${outputName}.png`), png);
      assetManifest[outputName] = meta;
      log(
        `  ${outputName}: ${shp.frameCount} frames, ${shp.width}x${shp.height}px (from ${foundIn})`
      );
      extracted++;
    } catch (e) {
      log(`  ERROR ${shpName}: ${e}`);
      skipped++;
    }
  }

  // Extract scenario INI files from EXPAND.MIX
  log('Extracting scenario data...');
  const expandMix = mixParsed.get('EXPAND.MIX');
  if (expandMix) {
    for (const scenario of ['SCA01EA', 'SCA02EA', 'SCA03EA', 'SCA04EA']) {
      const iniName = `${scenario}.INI`;
      const iniData = expandMix.readFile(iniName);
      if (iniData) {
        writeFileSync(join(OUTPUT_DIR, `${scenario}.ini`), iniData);
        log(`  ${iniName}: ${iniData.length} bytes`);
      } else {
        log(`  SKIP ${iniName}: not found in EXPAND.MIX`);
      }
    }
  } else {
    log('  WARNING: EXPAND.MIX not found');
  }

  // Write asset manifest
  writeFileSync(
    join(OUTPUT_DIR, 'manifest.json'),
    JSON.stringify(assetManifest, null, 2)
  );

  log(`Done! Extracted ${extracted} sprites, skipped ${skipped}`);
  log(`Assets written to ${OUTPUT_DIR}`);
}

function makeDefaultPalette(): Palette {
  const colors = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    colors[i * 4] = i;
    colors[i * 4 + 1] = i;
    colors[i * 4 + 2] = i;
    colors[i * 4 + 3] = i === 0 ? 0 : 255;
  }
  return { colors };
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
