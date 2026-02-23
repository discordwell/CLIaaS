#!/usr/bin/env tsx
/**
 * Red Alert TEMPERATE Tileset Extraction Script
 *
 * Extracts all .TEM tile files from TEMPERAT.MIX, builds a tile atlas PNG
 * and a JSON lookup mapping (templateType, templateIcon) -> atlas position.
 *
 * Output:
 *   public/ra/assets/tileset.png     — atlas of all 24x24 tiles
 *   public/ra/assets/tileset.json    — lookup: { tiles: { "type,icon": { ax, ay } }, atlasW, atlasH, tileW, tileH }
 *
 * Usage: pnpm extract-tiles
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MixFile } from './ra-assets/mix.js';
import { extractAllMIX } from './ra-assets/gamedata.js';
import { parsePalette, type Palette } from './ra-assets/palette.js';
import { parseTmp, type TmpFile } from './ra-assets/tmp.js';
import { encodePNG } from './ra-assets/png.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const GAMEDATA_PATH = join(PROJECT_ROOT, 'public/ra/gamedata.data');
const GAMEDATA_JS = join(PROJECT_ROOT, 'public/ra/gamedata.js');
const OUTPUT_DIR = join(PROJECT_ROOT, 'public/ra/assets');

const TILE_W = 24;
const TILE_H = 24;

// Template type ID → .TEM filename mapping (from OpenRA temperat.yaml)
// Only IDs 0-255 are relevant since MapPack stores types as Uint8Array
const TEMPLATE_MAP: Record<number, string> = {
  // Clear
  255: 'CLEAR1.TEM',
  // Water
  1: 'W1.TEM',
  2: 'W2.TEM',
  // Shore transitions
  3: 'SH01.TEM', 4: 'SH02.TEM', 5: 'SH03.TEM', 6: 'SH04.TEM',
  7: 'SH05.TEM', 8: 'SH06.TEM', 9: 'SH07.TEM', 10: 'SH08.TEM',
  11: 'SH09.TEM', 12: 'SH10.TEM', 13: 'SH11.TEM', 14: 'SH12.TEM',
  15: 'SH13.TEM', 16: 'SH14.TEM', 17: 'SH15.TEM', 18: 'SH16.TEM',
  19: 'SH17.TEM', 20: 'SH18.TEM', 21: 'SH19.TEM', 22: 'SH20.TEM',
  23: 'SH21.TEM', 24: 'SH22.TEM', 25: 'SH23.TEM', 26: 'SH24.TEM',
  27: 'SH25.TEM', 28: 'SH26.TEM', 29: 'SH27.TEM', 30: 'SH28.TEM',
  31: 'SH29.TEM', 32: 'SH30.TEM', 33: 'SH31.TEM', 34: 'SH32.TEM',
  35: 'SH33.TEM', 36: 'SH34.TEM', 37: 'SH35.TEM', 38: 'SH36.TEM',
  39: 'SH37.TEM', 40: 'SH38.TEM', 41: 'SH39.TEM', 42: 'SH40.TEM',
  43: 'SH41.TEM', 44: 'SH42.TEM', 45: 'SH43.TEM', 46: 'SH44.TEM',
  47: 'SH45.TEM', 48: 'SH46.TEM', 49: 'SH47.TEM', 50: 'SH48.TEM',
  51: 'SH49.TEM', 52: 'SH50.TEM', 53: 'SH51.TEM', 54: 'SH52.TEM',
  55: 'SH53.TEM', 56: 'SH54.TEM',
  57: 'SH55.TEM', 58: 'SH56.TEM',
  // Water cliffs
  59: 'WC01.TEM', 60: 'WC02.TEM', 61: 'WC03.TEM', 62: 'WC04.TEM',
  63: 'WC05.TEM', 64: 'WC06.TEM', 65: 'WC07.TEM', 66: 'WC08.TEM',
  67: 'WC09.TEM', 68: 'WC10.TEM', 69: 'WC11.TEM', 70: 'WC12.TEM',
  71: 'WC13.TEM', 72: 'WC14.TEM', 73: 'WC15.TEM', 74: 'WC16.TEM',
  75: 'WC17.TEM', 76: 'WC18.TEM', 77: 'WC19.TEM', 78: 'WC20.TEM',
  79: 'WC21.TEM', 80: 'WC22.TEM', 81: 'WC23.TEM', 82: 'WC24.TEM',
  83: 'WC25.TEM', 84: 'WC26.TEM', 85: 'WC27.TEM', 86: 'WC28.TEM',
  87: 'WC29.TEM', 88: 'WC30.TEM', 89: 'WC31.TEM', 90: 'WC32.TEM',
  91: 'WC33.TEM', 92: 'WC34.TEM', 93: 'WC35.TEM', 94: 'WC36.TEM',
  95: 'WC37.TEM', 96: 'WC38.TEM',
  // Rock/boulder formations
  97: 'B1.TEM', 98: 'B2.TEM', 99: 'B3.TEM',
  // Patches
  103: 'P01.TEM', 104: 'P02.TEM', 105: 'P03.TEM', 106: 'P04.TEM',
  107: 'P07.TEM', 108: 'P08.TEM', 109: 'P13.TEM', 110: 'P14.TEM',
  // River segments
  112: 'RV01.TEM', 113: 'RV02.TEM', 114: 'RV03.TEM', 115: 'RV04.TEM',
  116: 'RV05.TEM', 117: 'RV06.TEM', 118: 'RV07.TEM', 119: 'RV08.TEM',
  120: 'RV09.TEM', 121: 'RV10.TEM', 122: 'RV11.TEM', 123: 'RV12.TEM',
  124: 'RV13.TEM',
  // Falls / fords
  125: 'FALLS1.TEM', 126: 'FALLS1A.TEM', 127: 'FALLS2.TEM', 128: 'FALLS2A.TEM',
  129: 'FORD1.TEM', 130: 'FORD2.TEM',
  // Bridges
  131: 'BRIDGE1.TEM', 132: 'BRIDGE1D.TEM', 133: 'BRIDGE2.TEM', 134: 'BRIDGE2D.TEM',
  // Cliffs / slopes
  135: 'S01.TEM', 136: 'S02.TEM', 137: 'S03.TEM', 138: 'S04.TEM',
  139: 'S05.TEM', 140: 'S06.TEM', 141: 'S07.TEM', 142: 'S08.TEM',
  143: 'S09.TEM', 144: 'S10.TEM', 145: 'S11.TEM', 146: 'S12.TEM',
  147: 'S13.TEM', 148: 'S14.TEM', 149: 'S15.TEM', 150: 'S16.TEM',
  151: 'S17.TEM', 152: 'S18.TEM', 153: 'S19.TEM', 154: 'S20.TEM',
  155: 'S21.TEM', 156: 'S22.TEM', 157: 'S23.TEM', 158: 'S24.TEM',
  159: 'S25.TEM', 160: 'S26.TEM', 161: 'S27.TEM', 162: 'S28.TEM',
  163: 'S29.TEM', 164: 'S30.TEM', 165: 'S31.TEM', 166: 'S32.TEM',
  167: 'S33.TEM', 168: 'S34.TEM', 169: 'S35.TEM', 170: 'S36.TEM',
  171: 'S37.TEM', 172: 'S38.TEM',
  // Roads
  173: 'D01.TEM', 174: 'D02.TEM', 175: 'D03.TEM', 176: 'D04.TEM',
  177: 'D05.TEM', 178: 'D06.TEM', 179: 'D07.TEM', 180: 'D08.TEM',
  181: 'D09.TEM', 182: 'D10.TEM', 183: 'D11.TEM', 184: 'D12.TEM',
  185: 'D13.TEM', 186: 'D14.TEM', 187: 'D15.TEM', 188: 'D16.TEM',
  189: 'D17.TEM', 190: 'D18.TEM', 191: 'D19.TEM', 192: 'D20.TEM',
  193: 'D21.TEM', 194: 'D22.TEM', 195: 'D23.TEM', 196: 'D24.TEM',
  197: 'D25.TEM', 198: 'D26.TEM', 199: 'D27.TEM', 200: 'D28.TEM',
  201: 'D29.TEM', 202: 'D30.TEM', 203: 'D31.TEM', 204: 'D32.TEM',
  205: 'D33.TEM', 206: 'D34.TEM', 207: 'D35.TEM', 208: 'D36.TEM',
  209: 'D37.TEM', 210: 'D38.TEM', 211: 'D39.TEM', 212: 'D40.TEM',
  213: 'D41.TEM', 214: 'D42.TEM', 215: 'D43.TEM',
  // Road filler
  216: 'RF01.TEM', 217: 'RF02.TEM', 218: 'RF03.TEM', 219: 'RF04.TEM',
  220: 'RF05.TEM', 221: 'RF06.TEM', 222: 'RF07.TEM', 223: 'RF08.TEM',
  224: 'RF09.TEM', 225: 'RF10.TEM', 226: 'RF11.TEM',
  227: 'D44.TEM', 228: 'D45.TEM',
  // River crossings
  229: 'RV14.TEM', 230: 'RV15.TEM',
  231: 'RC01.TEM', 232: 'RC02.TEM', 233: 'RC03.TEM', 234: 'RC04.TEM',
  // Bridge pieces
  235: 'BR1A.TEM', 236: 'BR1B.TEM', 237: 'BR1C.TEM',
  238: 'BR2A.TEM', 239: 'BR2B.TEM', 240: 'BR2C.TEM',
  241: 'BR3A.TEM', 242: 'BR3B.TEM', 243: 'BR3C.TEM',
  244: 'BR3D.TEM', 245: 'BR3E.TEM', 246: 'BR3F.TEM',
  // Fences / misc
  247: 'F01.TEM', 248: 'F02.TEM', 249: 'F03.TEM',
  250: 'F04.TEM', 251: 'F05.TEM', 252: 'F06.TEM',
};

function log(msg: string): void {
  console.log(`[tiles] ${msg}`);
}

async function main(): Promise<void> {
  if (!existsSync(GAMEDATA_PATH)) {
    console.error(`ERROR: ${GAMEDATA_PATH} not found.`);
    process.exit(1);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  log('Extracting MIX files from gamedata.data...');
  const mixFiles = extractAllMIX(GAMEDATA_PATH, GAMEDATA_JS);

  // Parse TEMPERAT.MIX
  const temperatData = mixFiles.get('TEMPERAT.MIX');
  if (!temperatData) {
    console.error('ERROR: TEMPERAT.MIX not found in gamedata');
    process.exit(1);
  }
  const temperatMix = MixFile.fromBuffer(temperatData);
  log(`Parsed TEMPERAT.MIX (${temperatData.length} bytes, ${temperatMix.entryCount} entries)`);

  // Load palette from LOCAL.MIX or TEMPERAT.MIX
  let palette: Palette;
  const paletteJsonPath = join(OUTPUT_DIR, 'palette.json');
  if (existsSync(paletteJsonPath)) {
    // Use already-extracted palette
    const palJson = JSON.parse(readFileSync(paletteJsonPath, 'utf-8')) as number[][];
    const colors = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      colors[i * 4] = palJson[i][0];
      colors[i * 4 + 1] = palJson[i][1];
      colors[i * 4 + 2] = palJson[i][2];
      colors[i * 4 + 3] = i === 0 ? 0 : 255;
    }
    palette = { colors };
    log('Using existing palette.json');
  } else {
    // Try to extract from MIX
    let palData: Buffer | null = null;
    for (const mixName of ['LOCAL.MIX', 'TEMPERAT.MIX']) {
      const mix = mixFiles.get(mixName);
      if (mix) {
        const parsed = MixFile.fromBuffer(mix);
        palData = parsed.readFile('TEMPERAT.PAL');
        if (palData) {
          log(`Found TEMPERAT.PAL in ${mixName}`);
          break;
        }
      }
    }
    if (!palData) {
      console.error('ERROR: TEMPERAT.PAL not found');
      process.exit(1);
    }
    palette = parsePalette(palData);
  }

  // Extract all .TEM files and collect tiles
  interface TileEntry {
    templateType: number;
    icon: number;       // icon index within the template
    pixels: Uint8Array; // 24*24 palette-indexed
  }

  const tileEntries: TileEntry[] = [];
  let templatesExtracted = 0;
  let templatesSkipped = 0;

  for (const [templateType, filename] of Object.entries(TEMPLATE_MAP)) {
    const typeId = parseInt(templateType);
    const fileData = temperatMix.readFile(filename) ?? temperatMix.readFile(filename.toLowerCase());
    if (!fileData || fileData.length < 40) {
      log(`  SKIP ${filename} (type ${typeId}): too small (${fileData?.length ?? 0} bytes)`);
      templatesSkipped++;
      continue;
    }

    try {
      const tmp = parseTmp(fileData);
      for (let icon = 0; icon < tmp.tiles.length; icon++) {
        const tile = tmp.tiles[icon];
        if (tile) {
          tileEntries.push({
            templateType: typeId,
            icon,
            pixels: tile.pixels,
          });
        }
      }
      templatesExtracted++;
    } catch (e) {
      log(`  ERROR ${filename} (type ${typeId}): ${e}`);
      templatesSkipped++;
    }
  }

  log(`Extracted ${templatesExtracted} templates (${tileEntries.length} tiles), skipped ${templatesSkipped}`);

  if (tileEntries.length === 0) {
    console.error('ERROR: No tiles extracted');
    process.exit(1);
  }

  // Build atlas
  // Arrange tiles in a grid. Use 32 tiles per row for a reasonable atlas width.
  const TILES_PER_ROW = 32;
  const atlasW = TILES_PER_ROW * TILE_W;
  const atlasRows = Math.ceil(tileEntries.length / TILES_PER_ROW);
  const atlasH = atlasRows * TILE_H;

  const rgba = new Uint8Array(atlasW * atlasH * 4);

  // Lookup map: "type,icon" -> { col, row } in atlas
  const lookup: Record<string, { ax: number; ay: number }> = {};

  for (let i = 0; i < tileEntries.length; i++) {
    const entry = tileEntries[i];
    const col = i % TILES_PER_ROW;
    const row = Math.floor(i / TILES_PER_ROW);

    // Convert palette-indexed pixels to RGBA and copy into atlas
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

    // Store lookup
    const key = `${entry.templateType},${entry.icon}`;
    lookup[key] = { ax: col * TILE_W, ay: row * TILE_H };
  }

  // Encode and write atlas PNG
  const png = encodePNG(rgba, atlasW, atlasH);
  writeFileSync(join(OUTPUT_DIR, 'tileset.png'), png);

  // Write lookup JSON
  const tilesetMeta = {
    tileW: TILE_W,
    tileH: TILE_H,
    atlasW,
    atlasH,
    tileCount: tileEntries.length,
    tiles: lookup,
  };
  writeFileSync(join(OUTPUT_DIR, 'tileset.json'), JSON.stringify(tilesetMeta));

  log(`Atlas: ${atlasW}x${atlasH}px (${tileEntries.length} tiles)`);
  log(`Written: tileset.png + tileset.json`);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
