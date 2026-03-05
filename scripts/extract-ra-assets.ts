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
import { parseCps } from './ra-assets/cps.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const GAMEDATA_PATH = join(PROJECT_ROOT, 'public/ra/gamedata.data');
const GAMEDATA_JS = join(PROJECT_ROOT, 'public/ra/gamedata.js');
const OUTPUT_DIR = join(PROJECT_ROOT, 'public/ra/assets');
// EXPAND2.MIX: Aftermath expansion data (env var override or default path from extract-freeware-ant-originals.sh)
const EXPAND2_PATH = process.env.EXPAND2_PATH || '/tmp/ra_ant_extract/am_patch_work/EXPAND2.MIX';

// --- Helper generators for bulk sprite categories ---

/** Building construction animations: {BLDG}MAKE.SHP in CONQUER.MIX */
function generateMakeAssets(): [string, string, string][] {
  const buildings = [
    'FACT', 'POWR', 'APWR', 'BARR', 'TENT', 'WEAP', 'PROC', 'SILO',
    'DOME', 'FIX', 'GUN', 'SAM', 'TSLA', 'AGUN', 'GAP', 'PBOX',
    'HPAD', 'AFLD', 'ATEK', 'STEK', 'IRON', 'PDOX', 'KENN',
    'SYRD', 'SPEN', 'BIO', 'MISS', 'FCOM', 'HOSP',
  ];
  const entries: [string, string, string][] = buildings.map(b =>
    ['CONQUER.MIX', `${b}MAKE.SHP`, `${b.toLowerCase()}make`]
  );
  // Theater-specific construction TEM files
  entries.push(['TEMPERAT.MIX', 'HBOXMAKE.TEM', 'hboxmake']);
  entries.push(['TEMPERAT.MIX', 'MSLOMAKE.TEM', 'mslomake']);
  return entries;
}

/** Sidebar icons: {TYPE}ICON.SHP in LORES.MIX */
function generateIconAssets(): [string, string, string][] {
  const types = [
    // Vehicles
    '1TNK', '2TNK', '3TNK', '4TNK', 'JEEP', 'APC', 'HARV', 'MCV',
    'ARTY', 'TRUK', 'MNLY', 'MGG', 'V2RL', 'MLRS', 'FTNK', 'STNK',
    // Infantry
    'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'DOG', 'SPY', 'MEDI', 'THF',
    // Naval
    'SS', 'DD', 'CA', 'PT', 'LST', 'MSUB',
    // Aircraft
    'HIND', 'HELI', 'TRAN', 'MIG', 'YAK', 'BADR', 'U2',
    // Buildings
    'FACT', 'POWR', 'APWR', 'BARR', 'TENT', 'WEAP', 'PROC', 'SILO',
    'DOME', 'FIX', 'GUN', 'SAM', 'HBOX', 'TSLA', 'AGUN', 'GAP', 'PBOX',
    'HPAD', 'AFLD', 'MSLO', 'ATEK', 'STEK', 'IRON', 'PDOX', 'KENN',
    'SYRD', 'SPEN', 'BIO', 'MISS', 'FCOM', 'HOSP',
    // Walls
    'FENC', 'BRIK', 'SBAG', 'BARB', 'WOOD', 'CYCL',
  ];
  return types.map(t =>
    ['LORES.MIX', `${t}ICON.SHP`, `${t.toLowerCase()}icon`] as [string, string, string]
  );
}

/** Smudge/crater templates: SC1-SC6, CR1-CR6 in TEMPERAT.MIX */
function generateSmudgeAssets(): [string, string, string][] {
  const entries: [string, string, string][] = [];
  for (let i = 1; i <= 6; i++) {
    entries.push(['TEMPERAT.MIX', `SC${i}.TEM`, `sc${i}`]);   // Scorch marks
    entries.push(['TEMPERAT.MIX', `CR${i}.TEM`, `cr${i}`]);   // Craters
  }
  return entries;
}

// Assets to extract: [mixFile, internalFilename, outputName]
// Asset locations verified by searching all MIX files
const SPRITE_ASSETS_MANUAL: [string, string, string][] = [
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
  ['CONQUER.MIX', 'MLRS.SHP', 'mlrs'],    // Mobile Launcher Rocket System
  ['CONQUER.MIX', 'FTNK.SHP', 'ftnk'],    // Flame tank
  // Infantry (LORES.MIX — not CONQUER.MIX!)
  ['LORES.MIX', 'E1.SHP', 'e1'],          // Rifle infantry
  ['LORES.MIX', 'E2.SHP', 'e2'],          // Grenadier
  ['LORES.MIX', 'E3.SHP', 'e3'],          // Rocket soldier
  ['LORES.MIX', 'E4.SHP', 'e4'],          // Flamethrower
  ['LORES.MIX', 'E5.SHP', 'e5'],          // Tanya
  ['LORES.MIX', 'E6.SHP', 'e6'],          // Engineer
  ['LORES.MIX', 'DOG.SHP', 'dog'],        // Attack dog
  ['LORES.MIX', 'SPY.SHP', 'spy'],        // Spy
  ['LORES.MIX', 'MEDI.SHP', 'medi'],      // Medic
  ['LORES.MIX', 'THF.SHP', 'thf'],        // Thief
  ['LORES.MIX', 'E7.SHP', 'shok'],        // Shock trooper (E7 in LORES)
  ['LORES.MIX', 'C1.SHP', 'c1'],          // Civilian 1
  ['LORES.MIX', 'C2.SHP', 'c2'],          // Civilian 2
  ['LORES.MIX', 'C3.SHP', 'c3'],          // Civilian 3
  ['LORES.MIX', 'C4.SHP', 'c4'],          // Civilian 4
  ['LORES.MIX', 'C5.SHP', 'c5'],          // Civilian 5
  ['LORES.MIX', 'C6.SHP', 'c6'],          // Civilian 6
  ['LORES.MIX', 'C7.SHP', 'c7'],          // Civilian 7
  ['LORES.MIX', 'C8.SHP', 'c8'],          // Civilian 8
  ['LORES.MIX', 'C9.SHP', 'c9'],          // Civilian 9
  ['LORES.MIX', 'C10.SHP', 'c10'],        // Civilian 10
  ['LORES.MIX', 'CHAN.SHP', 'chan'],       // Civilian Chan
  ['LORES.MIX', 'DELPHI.SHP', 'delphi'],  // Civilian Delphi
  ['LORES.MIX', 'EINSTEIN.SHP', 'einstein'], // Einstein
  ['LORES.MIX', 'GNRL.SHP', 'gnrl'],      // General
  ['LORES.MIX', 'MECH.SHP', 'mech'],      // Mechanic
  // Naval vessels (CONQUER.MIX — confirmed via BFILE.MAK)
  ['CONQUER.MIX', 'SS.SHP', 'ss'],          // Submarine
  ['CONQUER.MIX', 'DD.SHP', 'dd'],          // Destroyer
  ['CONQUER.MIX', 'CA.SHP', 'ca'],          // Cruiser
  ['CONQUER.MIX', 'PT.SHP', 'pt'],          // Gunboat
  ['CONQUER.MIX', 'LST.SHP', 'lst'],        // Landing ship transport
  ['CONQUER.MIX', 'MSUB.SHP', 'msub'],      // Missile Submarine (Aftermath)
  ['EXPAND2.MIX', 'CARR.SHP', 'carr'],      // Helicarrier (Aftermath)
  // Aircraft (CONQUER.MIX)
  ['CONQUER.MIX', 'HIND.SHP', 'hind'],      // Hind attack helicopter
  ['CONQUER.MIX', 'HELI.SHP', 'heli'],      // Longbow helicopter
  ['CONQUER.MIX', 'TRAN.SHP', 'tran'],      // Chinook transport helicopter
  ['CONQUER.MIX', 'MIG.SHP', 'mig'],        // MiG-29 fighter
  ['CONQUER.MIX', 'YAK.SHP', 'yak'],        // Yak attack plane
  ['CONQUER.MIX', 'BADR.SHP', 'badr'],      // Badger bomber
  ['CONQUER.MIX', 'U2.SHP', 'u2'],          // Spy plane
  ['CONQUER.MIX', 'ORCA.SHP', 'orca'],      // Orca (TD crossover)
  // Counterstrike expansion — STNK is in base CONQUER.MIX (reused from TD)
  ['CONQUER.MIX', 'STNK.SHP', 'stnk'],    // Phase Transport (stealth tank)
  // Aftermath expansion vehicles (from EXPAND2.MIX — extracted via extract-freeware-ant-originals.sh)
  ['EXPAND2.MIX', 'CTNK.SHP', 'ctnk'],    // Chrono Tank
  ['EXPAND2.MIX', 'QTNK.SHP', 'qtnk'],    // M.A.D. Tank
  ['EXPAND2.MIX', 'DTRK.SHP', 'dtrk'],    // Demolition Truck
  ['EXPAND2.MIX', 'TTNK.SHP', 'ttnk'],    // Tesla Tank
  // Ant sprites are procedurally generated by scripts/generate-ant-sprites.ts
  // Explosions/effects (CONQUER.MIX)
  ['CONQUER.MIX', 'PIFF.SHP', 'piff'],
  ['CONQUER.MIX', 'PIFFPIFF.SHP', 'piffpiff'],
  ['CONQUER.MIX', 'FBALL1.SHP', 'fball1'],
  ['CONQUER.MIX', 'VEH-HIT1.SHP', 'veh-hit1'],
  ['CONQUER.MIX', 'VEH-HIT2.SHP', 'veh-hit2'],
  ['CONQUER.MIX', 'VEH-HIT3.SHP', 'veh-hit3'],
  ['CONQUER.MIX', 'NAPALM1.SHP', 'napalm1'],     // Napalm (3 parts)
  ['CONQUER.MIX', 'NAPALM2.SHP', 'napalm2'],
  ['CONQUER.MIX', 'NAPALM3.SHP', 'napalm3'],
  ['CONQUER.MIX', 'ATOMSFX.SHP', 'atomsfx'],      // Nuclear explosion
  ['CONQUER.MIX', 'SMOKEY.SHP', 'smokey'],         // Smoke effect
  ['CONQUER.MIX', 'LITNING.SHP', 'litning'],       // Lightning effect
  ['CONQUER.MIX', 'FIRE1.SHP', 'fire1'],           // Structure fire 1
  ['CONQUER.MIX', 'FIRE2.SHP', 'fire2'],           // Structure fire 2
  ['CONQUER.MIX', 'FIRE3.SHP', 'fire3'],           // Small fire
  ['CONQUER.MIX', 'FIRE4.SHP', 'fire4'],           // Fire variant 4
  ['CONQUER.MIX', 'FRAG1.SHP', 'frag1'],           // Fragmentation
  ['CONQUER.MIX', 'ART-EXP1.SHP', 'art-exp1'],     // Artillery explosion
  ['CONQUER.MIX', 'SMOKE_M.SHP', 'smoke_m'],       // Medium smoke
  ['CONQUER.MIX', 'WAKE.SHP', 'wake'],             // Naval wake
  ['CONQUER.MIX', 'ELECTDOG.SHP', 'electdog'],     // Tesla dog zap
  ['CONQUER.MIX', 'SAMFIRE.SHP', 'samfire'],        // SAM firing effect
  ['CONQUER.MIX', 'DRAGON.SHP', 'dragon'],          // Dragon missile trail
  ['CONQUER.MIX', 'BOMB.SHP', 'bomb'],              // Bomb projectile
  ['CONQUER.MIX', 'BOMBLET.SHP', 'bomblet'],        // Cluster bomblet
  ['CONQUER.MIX', 'MISSILE.SHP', 'missile'],        // Missile projectile
  ['CONQUER.MIX', '120MM.SHP', '120mm'],            // 120mm shell
  ['CONQUER.MIX', '50CAL.SHP', '50cal'],            // 50 caliber tracer
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
  ['TEMPERAT.MIX', 'HBOX.TEM', 'hbox'],    // Pillbox (theater-specific .TEM)
  ['CONQUER.MIX', 'TSLA.SHP', 'tsla'],    // Tesla Coil
  ['CONQUER.MIX', 'AGUN.SHP', 'agun'],    // Anti-Aircraft Gun
  ['CONQUER.MIX', 'GAP.SHP', 'gap'],      // Gap Generator
  ['CONQUER.MIX', 'PBOX.SHP', 'pbox'],    // Camo Pillbox
  // Buildings — tech/special
  ['CONQUER.MIX', 'HPAD.SHP', 'hpad'],    // Helipad
  ['CONQUER.MIX', 'AFLD.SHP', 'afld'],    // Airfield
  ['TEMPERAT.MIX', 'MSLO.TEM', 'mslo'],    // Missile Silo (theater-specific .TEM)
  ['CONQUER.MIX', 'ATEK.SHP', 'atek'],    // Allied Tech Center
  ['CONQUER.MIX', 'STEK.SHP', 'stek'],    // Soviet Tech Center
  ['CONQUER.MIX', 'IRON.SHP', 'iron'],    // Iron Curtain
  ['CONQUER.MIX', 'PDOX.SHP', 'pdox'],    // Chronosphere
  ['CONQUER.MIX', 'KENN.SHP', 'kenn'],    // Kennel
  // Civilian / neutral buildings
  ['CONQUER.MIX', 'SYRD.SHP', 'syrd'],    // Shipyard
  ['CONQUER.MIX', 'SPEN.SHP', 'spen'],    // Sub Pen
  ['CONQUER.MIX', 'BIO.SHP', 'bio'],      // Bio-Research Lab
  ['CONQUER.MIX', 'MISS.SHP', 'miss'],    // Mission Control
  ['CONQUER.MIX', 'V19.SHP', 'v19'],      // Oil Derrick
  ['CONQUER.MIX', 'FCOM.SHP', 'fcom'],    // Forward Command
  ['CONQUER.MIX', 'HOSP.SHP', 'hosp'],    // Hospital
  // Walls / fences
  ['CONQUER.MIX', 'FENC.SHP', 'fenc'],    // Chain-link fence
  ['CONQUER.MIX', 'BRIK.SHP', 'brik'],    // Concrete wall
  ['CONQUER.MIX', 'SBAG.SHP', 'sbag'],    // Sandbags
  ['CONQUER.MIX', 'BARB.SHP', 'barb'],    // Barbed wire
  ['CONQUER.MIX', 'WOOD.SHP', 'wood'],    // Wooden fence
  ['CONQUER.MIX', 'CYCL.SHP', 'cycl'],    // Cyclone fence
  // Overlays — mines and crates
  ['CONQUER.MIX', 'MINP.SHP', 'minp'],    // Anti-personnel mine
  ['CONQUER.MIX', 'MINV.SHP', 'minv'],    // Anti-vehicle mine
  ['CONQUER.MIX', 'WCRATE.SHP', 'wcrate'], // Wooden crate
  // Fog of war shroud overlays (47 frames, one per edge pattern)
  ['CONQUER.MIX', 'SHADOW.SHP', 'shadow'],
  // UI elements
  // ['LORES.MIX', 'MOUSE.SHP', 'mouse'],    // Skipped: variable-size frames produce 0-height sheet
  ['LORES.MIX', 'SELECT.SHP', 'select'],     // Selection box
  ['LORES.MIX', 'POWERBAR.SHP', 'powerbar'], // Power bar
  ['LORES.MIX', 'SIDEBAR.SHP', 'sidebar'],   // Sidebar background
  ['LORES.MIX', 'STRIP.SHP', 'strip'],       // Sidebar strip
  ['LORES.MIX', 'TABS.SHP', 'tabs'],         // Sidebar tabs
  ['LORES.MIX', 'REPAIR.SHP', 'repair'],     // Repair button icon
  ['LORES.MIX', 'SELL.SHP', 'sell'],         // Sell button icon
  ['LORES.MIX', 'MAP.SHP', 'map_btn'],       // Map button icon
  ['LORES.MIX', 'CLOCK.SHP', 'clock'],       // Clock overlay for build progress
  // Ore/gem overlays (theater-specific .TEM files, SHP format)
  // Gold: 12 frames each (density 0-11), Gems: 3 frames each (density 0-2)
  ['TEMPERAT.MIX', 'GOLD01.TEM', 'gold01'],
  ['TEMPERAT.MIX', 'GOLD02.TEM', 'gold02'],
  ['TEMPERAT.MIX', 'GOLD03.TEM', 'gold03'],
  ['TEMPERAT.MIX', 'GOLD04.TEM', 'gold04'],
  ['TEMPERAT.MIX', 'GEM01.TEM', 'gem01'],
  ['TEMPERAT.MIX', 'GEM02.TEM', 'gem02'],
  ['TEMPERAT.MIX', 'GEM03.TEM', 'gem03'],
  ['TEMPERAT.MIX', 'GEM04.TEM', 'gem04'],
  // Trees (theater-specific .TEM files from TEMPERAT.MIX)
  // T01-T17 single trees (T04, T09 don't exist in C++ source)
  ['TEMPERAT.MIX', 'T01.TEM', 't01'],
  ['TEMPERAT.MIX', 'T02.TEM', 't02'],
  ['TEMPERAT.MIX', 'T03.TEM', 't03'],
  ['TEMPERAT.MIX', 'T05.TEM', 't05'],
  ['TEMPERAT.MIX', 'T06.TEM', 't06'],
  ['TEMPERAT.MIX', 'T07.TEM', 't07'],
  ['TEMPERAT.MIX', 'T08.TEM', 't08'],
  ['TEMPERAT.MIX', 'T10.TEM', 't10'],
  ['TEMPERAT.MIX', 'T11.TEM', 't11'],
  ['TEMPERAT.MIX', 'T12.TEM', 't12'],
  ['TEMPERAT.MIX', 'T13.TEM', 't13'],
  ['TEMPERAT.MIX', 'T14.TEM', 't14'],
  ['TEMPERAT.MIX', 'T15.TEM', 't15'],
  ['TEMPERAT.MIX', 'T16.TEM', 't16'],
  ['TEMPERAT.MIX', 'T17.TEM', 't17'],
  // TC01-TC05 tree clumps
  ['TEMPERAT.MIX', 'TC01.TEM', 'tc01'],
  ['TEMPERAT.MIX', 'TC02.TEM', 'tc02'],
  ['TEMPERAT.MIX', 'TC03.TEM', 'tc03'],
  ['TEMPERAT.MIX', 'TC04.TEM', 'tc04'],
  ['TEMPERAT.MIX', 'TC05.TEM', 'tc05'],
];

// Combine manual entries with generated bulk categories
const SPRITE_ASSETS: [string, string, string][] = [
  ...SPRITE_ASSETS_MANUAL,
  ...generateMakeAssets(),
  ...generateIconAssets(),
  ...generateSmudgeAssets(),
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

  // Load EXPAND2.MIX from filesystem if available (Aftermath expansion data)
  if (existsSync(EXPAND2_PATH)) {
    try {
      const expand2 = MixFile.fromFile(EXPAND2_PATH);
      mixParsed.set('EXPAND2.MIX', expand2);
      log(`  Loaded EXPAND2.MIX from ${EXPAND2_PATH} (${expand2.entryCount} entries)`);
    } catch (e) {
      log(`  WARNING: Failed to parse EXPAND2.MIX: ${e}`);
    }
  } else {
    log(`  NOTE: EXPAND2.MIX not found at ${EXPAND2_PATH} — Aftermath sprites will be skipped`);
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

  // --- Non-sprite asset extraction ---

  // Extract additional palettes (SNOW.PAL, INTERIOR.PAL) from LOCAL.MIX
  log('Extracting additional palettes...');
  for (const [palName, outName] of [['SNOW.PAL', 'snow-palette.json'], ['INTERIOR.PAL', 'interior-palette.json']] as const) {
    let extraPalData: Buffer | null = null;
    for (const searchMix of ['LOCAL.MIX', 'TEMPERAT.MIX', 'CONQUER.MIX']) {
      const mix = mixParsed.get(searchMix);
      if (mix) {
        extraPalData = mix.readFile(palName);
        if (extraPalData) {
          log(`  Found ${palName} in ${searchMix} (${extraPalData.length} bytes)`);
          break;
        }
      }
    }
    if (extraPalData) {
      try {
        const pal = parsePalette(extraPalData);
        const palJSON = [];
        for (let i = 0; i < 256; i++) {
          palJSON.push([pal.colors[i * 4], pal.colors[i * 4 + 1], pal.colors[i * 4 + 2], pal.colors[i * 4 + 3]]);
        }
        writeFileSync(join(OUTPUT_DIR, outName), JSON.stringify(palJSON));
        log(`  Wrote ${outName}`);
      } catch (e) {
        log(`  WARNING: Failed to parse ${palName}: ${e}`);
      }
    } else {
      log(`  SKIP ${palName}: not found`);
    }
  }

  // Extract CPS background images (TITLE.CPS, PROLOG.CPS) as PNGs
  log('Extracting CPS backgrounds...');
  for (const [cpsName, outName] of [['TITLE.CPS', 'title.png'], ['PROLOG.CPS', 'prolog.png']] as const) {
    let bgCpsData: Buffer | null = null;
    let bgFoundIn = '';
    for (const [mName, mix] of mixParsed) {
      bgCpsData = mix.readFile(cpsName);
      if (bgCpsData) {
        bgFoundIn = mName;
        break;
      }
    }
    if (bgCpsData) {
      try {
        const cpsImg = parseCps(bgCpsData);
        // Use embedded palette if available, otherwise fall back to TEMPERAT.PAL
        let cpsPalette: Palette;
        if (cpsImg.palette && cpsImg.palette.length >= 768) {
          // CPS embedded palette: 256 entries × 3 bytes (RGB), 6-bit VGA values (0-63)
          const colors = new Uint8Array(256 * 4);
          for (let i = 0; i < 256; i++) {
            colors[i * 4]     = Math.min(255, cpsImg.palette[i * 3] * 4);
            colors[i * 4 + 1] = Math.min(255, cpsImg.palette[i * 3 + 1] * 4);
            colors[i * 4 + 2] = Math.min(255, cpsImg.palette[i * 3 + 2] * 4);
            colors[i * 4 + 3] = i === 0 ? 0 : 255;
          }
          cpsPalette = { colors };
          log(`  ${cpsName}: using embedded palette`);
        } else {
          cpsPalette = palette;
          log(`  ${cpsName}: using TEMPERAT.PAL (no embedded palette)`);
        }
        const rgba = indexedToRGBA(cpsImg.pixels, cpsPalette, cpsImg.width, cpsImg.height);
        const png = encodePNG(rgba, cpsImg.width, cpsImg.height);
        writeFileSync(join(OUTPUT_DIR, outName), png);
        log(`  Wrote ${outName} (${cpsImg.width}x${cpsImg.height}) from ${bgFoundIn}`);
      } catch (e) {
        log(`  WARNING: Failed to extract ${cpsName}: ${e}`);
      }
    } else {
      log(`  SKIP ${cpsName}: not found`);
    }
  }

  // Extract RULES.INI from MIX archives
  log('Extracting RULES.INI...');
  let rulesData: Buffer | null = null;
  let rulesFoundIn = '';
  for (const [mName, mix] of mixParsed) {
    rulesData = mix.readFile('RULES.INI');
    if (rulesData) {
      rulesFoundIn = mName;
      break;
    }
  }
  if (rulesData) {
    writeFileSync(join(OUTPUT_DIR, 'rules.ini'), rulesData);
    log(`  Wrote rules.ini (${rulesData.length} bytes from ${rulesFoundIn})`);
  } else {
    log('  SKIP RULES.INI: not found');
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

  // Extract campaign mission INIs from all MIX archives
  log('Extracting campaign mission INIs...');
  let campaignFound = 0;
  const campaignScenarios: string[] = [];
  // Allied campaign: SCG01EA-SCG14EA (+ EB variants for alternate paths)
  for (let i = 1; i <= 14; i++) {
    const num = i.toString().padStart(2, '0');
    campaignScenarios.push(`SCG${num}EA`, `SCG${num}EB`);
  }
  // Soviet campaign: SCU01EA-SCU14EA (+ EB variants)
  for (let i = 1; i <= 14; i++) {
    const num = i.toString().padStart(2, '0');
    campaignScenarios.push(`SCU${num}EA`, `SCU${num}EB`);
  }
  // Counterstrike: SCG15EA-SCG40EA, SCU15EA-SCU40EA (probe range)
  for (let i = 15; i <= 40; i++) {
    const num = i.toString().padStart(2, '0');
    campaignScenarios.push(`SCG${num}EA`, `SCU${num}EA`);
  }
  // Aftermath: SCG41EA-SCG60EA, SCU41EA-SCU60EA (probe range)
  for (let i = 41; i <= 60; i++) {
    const num = i.toString().padStart(2, '0');
    campaignScenarios.push(`SCG${num}EA`, `SCU${num}EA`);
  }
  // Search all parsed MIX files for each campaign scenario
  for (const scenario of campaignScenarios) {
    const iniName = `${scenario}.INI`;
    const outPath = join(OUTPUT_DIR, `${scenario}.ini`);
    if (existsSync(outPath)) continue; // already extracted (e.g. from ant missions)
    let found = false;
    for (const [mName, mix] of mixParsed) {
      const iniData = mix.readFile(iniName);
      if (iniData) {
        writeFileSync(outPath, iniData);
        log(`  ${iniName}: ${iniData.length} bytes (from ${mName})`);
        campaignFound++;
        found = true;
        break;
      }
    }
    // Don't log skips for probed ranges — too noisy
  }
  log(`  Found ${campaignFound} campaign mission INIs`);

  // Extract Aftermath rules from EXPAND2.MIX (unit overrides, not mission maps)
  const expand2Mix = mixParsed.get('EXPAND2.MIX');
  if (expand2Mix) {
    for (const iniName of ['AFTRMATH.INI', 'MISSION.INI']) {
      const iniData = expand2Mix.readFile(iniName);
      if (iniData) {
        writeFileSync(join(OUTPUT_DIR, iniName.toLowerCase()), iniData);
        log(`  ${iniName}: ${iniData.length} bytes`);
      } else {
        log(`  SKIP ${iniName}: not found in EXPAND2.MIX`);
      }
    }
  }

  // Extract PALETTE.CPS for house-color remap data (C++ Init_Color_Remaps)
  log('Extracting house color remap data...');
  let cpsData: Buffer | null = null;
  for (const searchMix of ['LORES.MIX', 'CONQUER.MIX', 'LOCAL.MIX']) {
    const mix = mixParsed.get(searchMix);
    if (mix) {
      cpsData = mix.readFile('PALETTE.CPS');
      if (cpsData) {
        log(`  Found PALETTE.CPS in ${searchMix} (${cpsData.length} bytes)`);
        break;
      }
    }
  }
  if (cpsData && palData) {
    try {
      const cps = parseCps(cpsData);
      // PALETTE.CPS is a 320×200 indexed image. Top-left 16×12 pixel grid encodes remap colors:
      //   Row 0 (y=0): 16 source palette indices (the default unit gold gradient)
      //   Rows 1-11 (y=1..11): per-PCOLOR target palette indices
      // House→PCOLOR mapping from hdata.cpp: Spain=0(GOLD), Greece=1(LTBLUE), USSR=2(RED),
      //   row3=GREEN, Ukraine=4(ORANGE), Germany=5(GREY), row6=BLUE, row7=BROWN, etc.
      const HOUSE_PCOLOR: Record<string, number> = {
        Spain: 0,    // PCOLOR_GOLD
        Greece: 1,   // PCOLOR_LTBLUE
        USSR: 2,     // PCOLOR_RED
        Ukraine: 4,  // PCOLOR_ORANGE
        Germany: 5,  // PCOLOR_GREY
        Turkey: 7,   // PCOLOR_BROWN
      };
      const sourceIndices: number[] = [];
      for (let x = 0; x < 16; x++) {
        sourceIndices.push(cps.pixels[0 * 320 + x]); // row 0
      }
      // Resolve source indices through palette to RGBA
      const sourceColors: number[][] = sourceIndices.map(idx => [
        palette.colors[idx * 4],
        palette.colors[idx * 4 + 1],
        palette.colors[idx * 4 + 2],
      ]);
      const houses: Record<string, number[][]> = {};
      for (const [houseName, pcolorRow] of Object.entries(HOUSE_PCOLOR)) {
        const rowY = pcolorRow; // Row index in the 16×12 grid (row 0 = source = Spain's own colors)
        const houseColors: number[][] = [];
        for (let x = 0; x < 16; x++) {
          const palIdx = cps.pixels[rowY * 320 + x];
          houseColors.push([
            palette.colors[palIdx * 4],
            palette.colors[palIdx * 4 + 1],
            palette.colors[palIdx * 4 + 2],
          ]);
        }
        houses[houseName] = houseColors;
      }
      const remapJson = { source: sourceColors, houses };
      writeFileSync(join(OUTPUT_DIR, 'remap-colors.json'), JSON.stringify(remapJson));
      log(`  Wrote remap-colors.json (${sourceIndices.length} source colors, ${Object.keys(houses).length} houses)`);
    } catch (e) {
      log(`  WARNING: Failed to extract remap colors: ${e}`);
    }
  } else {
    log('  WARNING: PALETTE.CPS not found, house color remapping will use fallback tint');
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
