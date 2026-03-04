#!/usr/bin/env tsx
/**
 * Red Alert Multi-Theatre Tileset Extraction Script
 *
 * Extracts tile files from TEMPERAT.MIX, SNOW.MIX, and INTERIOR.MIX,
 * building a tile atlas PNG + JSON lookup for each theatre.
 *
 * Output per theatre:
 *   public/ra/assets/{prefix}_tileset.png   — atlas of all 24x24 tiles
 *   public/ra/assets/{prefix}_tileset.json  — lookup: { tiles: { "type,icon": { ax, ay } }, ... }
 *
 * TEMPERATE outputs to tileset.png / tileset.json (backwards compatible).
 *
 * Usage: pnpm extract-tiles
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MixFile } from './ra-assets/mix.js';
import { extractAllMIX } from './ra-assets/gamedata.js';
import { parsePalette, type Palette } from './ra-assets/palette.js';
import { parseTmp } from './ra-assets/tmp.js';
import { encodePNG } from './ra-assets/png.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const GAMEDATA_PATH = join(PROJECT_ROOT, 'public/ra/gamedata.data');
const GAMEDATA_JS = join(PROJECT_ROOT, 'public/ra/gamedata.js');
const OUTPUT_DIR = join(PROJECT_ROOT, 'public/ra/assets');

const TILE_W = 24;
const TILE_H = 24;

// ── Theatre configurations ──────────────────────────────────────

interface TheatreConfig {
  name: string;           // display name
  mixName: string;        // MIX file containing tile templates
  paletteName: string;    // PAL file name inside MIX
  paletteJson: string;    // pre-extracted palette JSON filename (in OUTPUT_DIR)
  paletteFallbackMIXes: string[]; // MIX files to search for palette
  extension: string;      // file extension for templates (.TEM, .SNO, .INT)
  outputPrefix: string;   // output filename prefix ('' for TEMPERATE backwards compat)
  templates: Record<number, string>; // template ID → base filename (without extension)
}

// TEMPERATE template type ID → base filename mapping (from OpenRA temperat.yaml)
const TEMPERATE_TEMPLATES: Record<number, string> = {
  // Clear
  255: 'CLEAR1',
  // Water
  1: 'W1', 2: 'W2',
  // Shore transitions
  3: 'SH01', 4: 'SH02', 5: 'SH03', 6: 'SH04',
  7: 'SH05', 8: 'SH06', 9: 'SH07', 10: 'SH08',
  11: 'SH09', 12: 'SH10', 13: 'SH11', 14: 'SH12',
  15: 'SH13', 16: 'SH14', 17: 'SH15', 18: 'SH16',
  19: 'SH17', 20: 'SH18', 21: 'SH19', 22: 'SH20',
  23: 'SH21', 24: 'SH22', 25: 'SH23', 26: 'SH24',
  27: 'SH25', 28: 'SH26', 29: 'SH27', 30: 'SH28',
  31: 'SH29', 32: 'SH30', 33: 'SH31', 34: 'SH32',
  35: 'SH33', 36: 'SH34', 37: 'SH35', 38: 'SH36',
  39: 'SH37', 40: 'SH38', 41: 'SH39', 42: 'SH40',
  43: 'SH41', 44: 'SH42', 45: 'SH43', 46: 'SH44',
  47: 'SH45', 48: 'SH46', 49: 'SH47', 50: 'SH48',
  51: 'SH49', 52: 'SH50', 53: 'SH51', 54: 'SH52',
  55: 'SH53', 56: 'SH54',
  57: 'SH55', 58: 'SH56',
  // Water cliffs
  59: 'WC01', 60: 'WC02', 61: 'WC03', 62: 'WC04',
  63: 'WC05', 64: 'WC06', 65: 'WC07', 66: 'WC08',
  67: 'WC09', 68: 'WC10', 69: 'WC11', 70: 'WC12',
  71: 'WC13', 72: 'WC14', 73: 'WC15', 74: 'WC16',
  75: 'WC17', 76: 'WC18', 77: 'WC19', 78: 'WC20',
  79: 'WC21', 80: 'WC22', 81: 'WC23', 82: 'WC24',
  83: 'WC25', 84: 'WC26', 85: 'WC27', 86: 'WC28',
  87: 'WC29', 88: 'WC30', 89: 'WC31', 90: 'WC32',
  91: 'WC33', 92: 'WC34', 93: 'WC35', 94: 'WC36',
  95: 'WC37', 96: 'WC38',
  // Rock/boulder formations
  97: 'B1', 98: 'B2', 99: 'B3',
  // Patches
  103: 'P01', 104: 'P02', 105: 'P03', 106: 'P04',
  107: 'P07', 108: 'P08', 109: 'P13', 110: 'P14',
  // River segments
  112: 'RV01', 113: 'RV02', 114: 'RV03', 115: 'RV04',
  116: 'RV05', 117: 'RV06', 118: 'RV07', 119: 'RV08',
  120: 'RV09', 121: 'RV10', 122: 'RV11', 123: 'RV12',
  124: 'RV13',
  // Falls / fords
  125: 'FALLS1', 126: 'FALLS1A', 127: 'FALLS2', 128: 'FALLS2A',
  129: 'FORD1', 130: 'FORD2',
  // Bridges
  131: 'BRIDGE1', 132: 'BRIDGE1D', 133: 'BRIDGE2', 134: 'BRIDGE2D',
  // Cliffs / slopes
  135: 'S01', 136: 'S02', 137: 'S03', 138: 'S04',
  139: 'S05', 140: 'S06', 141: 'S07', 142: 'S08',
  143: 'S09', 144: 'S10', 145: 'S11', 146: 'S12',
  147: 'S13', 148: 'S14', 149: 'S15', 150: 'S16',
  151: 'S17', 152: 'S18', 153: 'S19', 154: 'S20',
  155: 'S21', 156: 'S22', 157: 'S23', 158: 'S24',
  159: 'S25', 160: 'S26', 161: 'S27', 162: 'S28',
  163: 'S29', 164: 'S30', 165: 'S31', 166: 'S32',
  167: 'S33', 168: 'S34', 169: 'S35', 170: 'S36',
  171: 'S37', 172: 'S38',
  // Roads
  173: 'D01', 174: 'D02', 175: 'D03', 176: 'D04',
  177: 'D05', 178: 'D06', 179: 'D07', 180: 'D08',
  181: 'D09', 182: 'D10', 183: 'D11', 184: 'D12',
  185: 'D13', 186: 'D14', 187: 'D15', 188: 'D16',
  189: 'D17', 190: 'D18', 191: 'D19', 192: 'D20',
  193: 'D21', 194: 'D22', 195: 'D23', 196: 'D24',
  197: 'D25', 198: 'D26', 199: 'D27', 200: 'D28',
  201: 'D29', 202: 'D30', 203: 'D31', 204: 'D32',
  205: 'D33', 206: 'D34', 207: 'D35', 208: 'D36',
  209: 'D37', 210: 'D38', 211: 'D39', 212: 'D40',
  213: 'D41', 214: 'D42', 215: 'D43',
  // Road filler
  216: 'RF01', 217: 'RF02', 218: 'RF03', 219: 'RF04',
  220: 'RF05', 221: 'RF06', 222: 'RF07', 223: 'RF08',
  224: 'RF09', 225: 'RF10', 226: 'RF11',
  227: 'D44', 228: 'D45',
  // River crossings
  229: 'RV14', 230: 'RV15',
  231: 'RC01', 232: 'RC02', 233: 'RC03', 234: 'RC04',
  // Bridge pieces
  235: 'BR1A', 236: 'BR1B', 237: 'BR1C',
  238: 'BR2A', 239: 'BR2B', 240: 'BR2C',
  241: 'BR3A', 242: 'BR3B', 243: 'BR3C',
  244: 'BR3D', 245: 'BR3E', 246: 'BR3F',
  // Fences / misc
  247: 'F01', 248: 'F02', 249: 'F03',
  250: 'F04', 251: 'F05', 252: 'F06',
  // --- Extended templates (IDs > 255, reachable via uint16 MapPack) ---
  // Bridge variants
  378: 'BRIDGE1H', 379: 'BRIDGE2H',
  380: 'BR1X', 381: 'BR2X',
  382: 'BRIDGE1X', 383: 'BRIDGE2X',
  // Hill formation
  400: 'HILL01',
  // Cliff slopes
  401: 'S39', 402: 'S40', 403: 'S41', 404: 'S42',
  405: 'S43', 406: 'S44', 407: 'S45', 408: 'S46',
  // Shore debris
  500: 'SH57', 501: 'SH58', 502: 'SH59', 503: 'SH60',
  504: 'SH61', 505: 'SH62', 506: 'SH63', 507: 'SH64', 508: 'SH65',
  // Small bridges
  519: 'BR4A', 520: 'BR4B', 521: 'BR4C', 522: 'BR4D',
  523: 'BR4E', 524: 'BR4F',
  525: 'BR5A', 526: 'BR5B', 527: 'BR5C', 528: 'BR5D',
  529: 'BR5E', 530: 'BR5F',
  531: 'BR6A', 532: 'BR6B', 533: 'BR6C', 534: 'BR6D',
  // Cliff corners
  550: 'WC39', 551: 'WC40', 552: 'WC41', 553: 'WC42',
  554: 'WC43', 555: 'WC44', 556: 'WC45', 557: 'WC46',
  // Decay debris
  580: 'D46', 581: 'D47', 582: 'D48', 583: 'D49',
  584: 'D50', 585: 'D51', 586: 'D52', 587: 'D53', 588: 'D54',
  // Fjord crossings
  590: 'FORD3', 591: 'FORD4',
};

// INTERIOR template IDs (from OpenRA interior.yaml) — IDs 253-399
const INTERIOR_TEMPLATES: Record<number, string> = {
  // Clear floor
  255: 'CLEAR1',
  // Arrow/marking tiles (1x1)
  253: 'ARRO0001', 254: 'ARRO0002',
  256: 'ARRO0003', 257: 'ARRO0004', 258: 'ARRO0005', 259: 'ARRO0006',
  260: 'ARRO0007', 261: 'ARRO0008', 262: 'ARRO0009', 263: 'ARRO0010',
  264: 'ARRO0011', 265: 'ARRO0012', 266: 'ARRO0013', 267: 'ARRO0014',
  // Floor tiles (1x1)
  268: 'FLOR0001', 269: 'FLOR0002', 270: 'FLOR0003', 271: 'FLOR0004',
  272: 'FLOR0005', 273: 'FLOR0006', 274: 'FLOR0007',
  // Green floor tiles (1x1)
  275: 'GFLR0001', 276: 'GFLR0002', 277: 'GFLR0003', 278: 'GFLR0004', 279: 'GFLR0005',
  // Grate/stripe tiles (1x1)
  280: 'GSTR0001', 281: 'GSTR0002', 282: 'GSTR0003', 283: 'GSTR0004',
  284: 'GSTR0005', 285: 'GSTR0006', 286: 'GSTR0007', 287: 'GSTR0008',
  288: 'GSTR0009', 289: 'GSTR0010', 290: 'GSTR0011',
  // Light wall tiles (1x1)
  291: 'LWAL0001', 292: 'LWAL0002', 293: 'LWAL0003', 294: 'LWAL0004',
  295: 'LWAL0005', 296: 'LWAL0006', 297: 'LWAL0007', 298: 'LWAL0008',
  299: 'LWAL0009', 300: 'LWAL0010', 301: 'LWAL0011', 302: 'LWAL0012',
  303: 'LWAL0013', 304: 'LWAL0014', 305: 'LWAL0015', 306: 'LWAL0016',
  307: 'LWAL0017', 308: 'LWAL0018', 309: 'LWAL0019', 310: 'LWAL0020',
  311: 'LWAL0021', 312: 'LWAL0022', 313: 'LWAL0023', 314: 'LWAL0024',
  315: 'LWAL0025', 316: 'LWAL0026', 317: 'LWAL0027',
  // Stripe tiles (1x1)
  318: 'STRP0001', 319: 'STRP0002', 320: 'STRP0003', 321: 'STRP0004',
  322: 'STRP0005', 323: 'STRP0006', 324: 'STRP0007', 325: 'STRP0008',
  326: 'STRP0009', 327: 'STRP0010', 328: 'STRP0011',
  // Wall tiles (1x1 to 3x3)
  329: 'WALL0001', 330: 'WALL0002', 331: 'WALL0003', 332: 'WALL0004',
  333: 'WALL0005', 334: 'WALL0006', 335: 'WALL0007', 336: 'WALL0008',
  337: 'WALL0009', 338: 'WALL0010', 339: 'WALL0011', 340: 'WALL0012',
  341: 'WALL0013', 342: 'WALL0014', 343: 'WALL0015', 344: 'WALL0016',
  345: 'WALL0017', 346: 'WALL0018', 347: 'WALL0019', 348: 'WALL0020',
  349: 'WALL0021', 350: 'WALL0022', 351: 'WALL0023', 352: 'WALL0024',
  353: 'WALL0025', 354: 'WALL0026', 355: 'WALL0027', 356: 'WALL0028',
  357: 'WALL0029', 358: 'WALL0030', 359: 'WALL0031', 360: 'WALL0032',
  361: 'WALL0033', 362: 'WALL0034', 363: 'WALL0035', 364: 'WALL0036',
  365: 'WALL0037', 366: 'WALL0038', 367: 'WALL0039', 368: 'WALL0040',
  369: 'WALL0041', 370: 'WALL0042', 371: 'WALL0043', 372: 'WALL0044',
  373: 'WALL0045', 374: 'WALL0046', 375: 'WALL0047', 376: 'WALL0048',
  377: 'WALL0049',
  // Extra tiles (various sizes)
  384: 'XTRA0001', 385: 'XTRA0002', 386: 'XTRA0003', 387: 'XTRA0004',
  388: 'XTRA0005', 389: 'XTRA0006', 390: 'XTRA0007', 391: 'XTRA0008',
  392: 'XTRA0009', 393: 'XTRA0010', 394: 'XTRA0011', 395: 'XTRA0012',
  396: 'XTRA0013', 397: 'XTRA0014', 398: 'XTRA0015', 399: 'XTRA0016',
};

const THEATRE_CONFIGS: TheatreConfig[] = [
  {
    name: 'TEMPERATE',
    mixName: 'TEMPERAT.MIX',
    paletteName: 'TEMPERAT.PAL',
    paletteJson: 'palette.json',
    paletteFallbackMIXes: ['LOCAL.MIX', 'TEMPERAT.MIX'],
    extension: '.TEM',
    outputPrefix: '',  // backwards compatible: tileset.png / tileset.json
    templates: TEMPERATE_TEMPLATES,
  },
  {
    name: 'SNOW',
    mixName: 'SNOW.MIX',
    paletteName: 'SNOW.PAL',
    paletteJson: 'snow-palette.json',
    paletteFallbackMIXes: ['LOCAL.MIX', 'SNOW.MIX'],
    extension: '.SNO',
    outputPrefix: 'snow_',
    // SNOW uses the same template IDs as TEMPERATE (same filenames, different extension)
    templates: TEMPERATE_TEMPLATES,
  },
  {
    name: 'INTERIOR',
    mixName: 'INTERIOR.MIX',
    paletteName: 'INTERIOR.PAL',
    paletteJson: 'interior-palette.json',
    paletteFallbackMIXes: ['LOCAL.MIX', 'INTERIOR.MIX'],
    extension: '.INT',
    outputPrefix: 'interior_',
    templates: INTERIOR_TEMPLATES,
  },
];

// ── Shared extraction logic ─────────────────────────────────────

function log(msg: string): void {
  console.log(`[tiles] ${msg}`);
}

interface TileEntry {
  templateType: number;
  icon: number;
  pixels: Uint8Array;
}

/** Load palette from pre-extracted JSON or from MIX files */
function loadPalette(
  config: TheatreConfig,
  mixFiles: Map<string, Buffer>,
): Palette {
  const paletteJsonPath = join(OUTPUT_DIR, config.paletteJson);
  if (existsSync(paletteJsonPath)) {
    const palJson = JSON.parse(readFileSync(paletteJsonPath, 'utf-8')) as number[][];
    const colors = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      colors[i * 4] = palJson[i][0];
      colors[i * 4 + 1] = palJson[i][1];
      colors[i * 4 + 2] = palJson[i][2];
      colors[i * 4 + 3] = i === 0 ? 0 : 255;
    }
    log(`  Using existing ${config.paletteJson}`);
    return { colors };
  }

  // Try to extract from MIX
  for (const mixName of config.paletteFallbackMIXes) {
    const mix = mixFiles.get(mixName);
    if (mix) {
      const parsed = MixFile.fromBuffer(mix);
      const palData = parsed.readFile(config.paletteName);
      if (palData) {
        log(`  Found ${config.paletteName} in ${mixName}`);
        return parsePalette(palData);
      }
    }
  }
  throw new Error(`${config.paletteName} not found`);
}

/** Extract tiles from a theatre MIX and build atlas + JSON */
function extractTheatre(
  config: TheatreConfig,
  mixFiles: Map<string, Buffer>,
): { tileCount: number; templateCount: number } {
  log(`\n── ${config.name} ──`);

  const mixData = mixFiles.get(config.mixName);
  if (!mixData) {
    log(`  WARNING: ${config.mixName} not found in gamedata — skipping`);
    return { tileCount: 0, templateCount: 0 };
  }
  const mix = MixFile.fromBuffer(mixData);
  log(`  Parsed ${config.mixName} (${mixData.length} bytes, ${mix.entryCount} entries)`);

  const palette = loadPalette(config, mixFiles);

  const tileEntries: TileEntry[] = [];
  let templatesExtracted = 0;
  let templatesSkipped = 0;

  for (const [templateType, baseName] of Object.entries(config.templates)) {
    const typeId = parseInt(templateType);
    const filename = baseName + config.extension;
    const fileData = mix.readFile(filename) ?? mix.readFile(filename.toLowerCase());
    if (!fileData || fileData.length < 40) {
      templatesSkipped++;
      continue;
    }

    try {
      const tmp = parseTmp(fileData);
      for (let icon = 0; icon < tmp.tiles.length; icon++) {
        const tile = tmp.tiles[icon];
        if (tile) {
          tileEntries.push({ templateType: typeId, icon, pixels: tile.pixels });
        }
      }
      templatesExtracted++;
    } catch (e) {
      log(`  ERROR ${filename} (type ${typeId}): ${e}`);
      templatesSkipped++;
    }
  }

  log(`  Extracted ${templatesExtracted} templates (${tileEntries.length} tiles), skipped ${templatesSkipped}`);

  if (tileEntries.length === 0) {
    log(`  WARNING: No tiles extracted for ${config.name}`);
    return { tileCount: 0, templateCount: templatesExtracted };
  }

  // Build atlas (32 tiles per row)
  const TILES_PER_ROW = 32;
  const atlasW = TILES_PER_ROW * TILE_W;
  const atlasRows = Math.ceil(tileEntries.length / TILES_PER_ROW);
  const atlasH = atlasRows * TILE_H;
  const rgba = new Uint8Array(atlasW * atlasH * 4);
  const lookup: Record<string, { ax: number; ay: number }> = {};

  for (let i = 0; i < tileEntries.length; i++) {
    const entry = tileEntries[i];
    const col = i % TILES_PER_ROW;
    const row = Math.floor(i / TILES_PER_ROW);

    for (let py = 0; py < TILE_H; py++) {
      for (let px = 0; px < TILE_W; px++) {
        const srcIdx = py * TILE_W + px;
        const palIdx = entry.pixels[srcIdx];
        const dstX = col * TILE_W + px;
        const dstY = row * TILE_H + py;
        const dstOff = (dstY * atlasW + dstX) * 4;

        rgba[dstOff] = palette.colors[palIdx * 4];
        rgba[dstOff + 1] = palette.colors[palIdx * 4 + 1];
        rgba[dstOff + 2] = palette.colors[palIdx * 4 + 2];
        rgba[dstOff + 3] = palette.colors[palIdx * 4 + 3];
      }
    }

    const key = `${entry.templateType},${entry.icon}`;
    lookup[key] = { ax: col * TILE_W, ay: row * TILE_H };
  }

  // Write files
  const pngName = `${config.outputPrefix}tileset.png`;
  const jsonName = `${config.outputPrefix}tileset.json`;
  writeFileSync(join(OUTPUT_DIR, pngName), encodePNG(rgba, atlasW, atlasH));
  writeFileSync(join(OUTPUT_DIR, jsonName), JSON.stringify({
    tileW: TILE_W,
    tileH: TILE_H,
    atlasW,
    atlasH,
    tileCount: tileEntries.length,
    tiles: lookup,
  }));

  log(`  Atlas: ${atlasW}x${atlasH}px (${tileEntries.length} tiles)`);
  log(`  Written: ${pngName} + ${jsonName}`);

  return { tileCount: tileEntries.length, templateCount: templatesExtracted };
}

// ── Main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!existsSync(GAMEDATA_PATH)) {
    console.error(`ERROR: ${GAMEDATA_PATH} not found.`);
    process.exit(1);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  log('Extracting MIX files from gamedata.data...');
  const mixFiles = extractAllMIX(GAMEDATA_PATH, GAMEDATA_JS);

  let totalTiles = 0;
  let totalTemplates = 0;

  for (const config of THEATRE_CONFIGS) {
    const result = extractTheatre(config, mixFiles);
    totalTiles += result.tileCount;
    totalTemplates += result.templateCount;
  }

  log(`\n── Summary ──`);
  log(`Total: ${totalTemplates} templates, ${totalTiles} tiles across ${THEATRE_CONFIGS.length} theatres`);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
