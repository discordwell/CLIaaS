/**
 * MapPack parser for Red Alert INI files.
 *
 * Decodes Base64 + LCW-compressed map data to extract TType (template type)
 * and TIcon (template icon) arrays. Used to detect water cells for coastal
 * shipyard placement without recompiling C++.
 *
 * LCW (Format80) decompression ported from:
 *   CnC_and_Red_Alert/RA/lcwuncmp.cpp — LCW_Uncompress()
 *
 * MapPack format (NewINIFormat >= 3):
 *   - 16384 uint16 TType values (32768 bytes)
 *   - 16384 uint8  TIcon values (16384 bytes)
 *   Total decompressed: 49152 bytes
 */

const MAP_W = 128;
const MAP_CELL_TOTAL = MAP_W * MAP_W; // 16384

// Template type IDs that represent pure water terrain.
// TEMPLATE_WATER = 1, TEMPLATE_WATER2 = 2
const WATER_TEMPLATES = new Set([1, 2]);

// ---------------------------------------------------------------------------
// LCW (Format80) Decompression
// ---------------------------------------------------------------------------

/**
 * Decompress LCW-encoded (Format80) data from `source` starting at `srcStart`
 * into `dest`, writing at most `destLength` bytes.
 *
 * Faithfully ported from lcwuncmp.cpp — LCW_Uncompress().
 * Terminates on op_code 0x80 or when `destLength` bytes have been written.
 * Returns the source position after decompression (for chaining).
 */
export function lcwDecompress(
  source: Uint8Array,
  srcStart: number,
  dest: Uint8Array,
  destOffset: number,
  destLength: number,
): number {
  let sp = srcStart;
  let dp = destOffset;
  const destEnd = destOffset + destLength;

  while (dp < destEnd && sp < source.length) {
    const opCode = source[sp++];

    if (!(opCode & 0x80)) {
      // Short copy from destination (back-reference)
      let count = (opCode >> 4) + 3;
      if (count > destEnd - dp) count = destEnd - dp;
      if (!count) return sp;
      const offset = source[sp++] + ((opCode & 0x0f) << 8);
      let cp = dp - offset;
      if (cp < destOffset) return sp; // invalid back-reference
      for (let i = 0; i < count; i++) {
        dest[dp++] = dest[cp++];
      }

    } else if (!(opCode & 0x40)) {

      if (opCode === 0x80) {
        // End of data
        return sp;
      }

      // Medium copy from source
      let count = opCode & 0x3f;
      while (count-- > 0 && sp < source.length) {
        dest[dp++] = source[sp++];
      }

    } else {

      if (opCode === 0xfe) {
        // Long run (fill)
        let count = source[sp] + (source[sp + 1] << 8);
        const data = source[sp + 2];
        sp += 3;
        if (count > destEnd - dp) count = destEnd - dp;
        for (let i = 0; i < count; i++) {
          dest[dp++] = data;
        }

      } else if (opCode === 0xff) {
        // Long copy from destination (absolute offset into chunk dest)
        const count = source[sp] + (source[sp + 1] << 8);
        let cp = destOffset + source[sp + 2] + (source[sp + 3] << 8);
        sp += 4;
        for (let i = 0; i < count; i++) {
          dest[dp++] = dest[cp++];
        }

      } else {
        // Medium copy from destination (absolute offset into chunk dest)
        const count = (opCode & 0x3f) + 3;
        let cp = destOffset + source[sp] + (source[sp + 1] << 8);
        sp += 2;
        for (let i = 0; i < count; i++) {
          dest[dp++] = dest[cp++];
        }
      }
    }
  }

  return sp;
}

/**
 * Decompress RA section-chunked data.
 *
 * The compressed stream is split into chunks, each prefixed by a 4-byte header:
 *   [compressedSize: uint16 LE] [decompressedSize: uint16 LE]
 * followed by `compressedSize` bytes of LCW-compressed data.
 *
 * This matches the C++ INIClass::Get_UUBlock / WWStego chunked format
 * used by Red Alert for MapPack and OverlayPack sections.
 *
 * Returns the source offset after all chunks for the requested `destSize` bytes.
 */
export function decompressRASections(
  bytes: Uint8Array,
  start: number,
  dest: Uint8Array,
  destSize: number,
): number {
  let sp = start;
  let dp = 0;
  while (dp < destSize && sp + 4 <= bytes.length) {
    const compressedSize = bytes[sp] | (bytes[sp + 1] << 8);
    const decompressedSize = bytes[sp + 2] | (bytes[sp + 3] << 8);
    sp += 4;
    if (compressedSize === 0 || sp + compressedSize > bytes.length) break;
    // Decompress this chunk into a temporary buffer
    const chunk = new Uint8Array(decompressedSize);
    lcwDecompress(bytes, sp, chunk, 0, decompressedSize);
    const copyLen = Math.min(decompressedSize, destSize - dp);
    dest.set(chunk.subarray(0, copyLen), dp);
    dp += copyLen;
    sp += compressedSize;
  }
  return sp;
}

// ---------------------------------------------------------------------------
// MapPack INI Parsing
// ---------------------------------------------------------------------------

/**
 * Extract a named INI section's key=value entries, preserving insertion order.
 */
function extractSection(iniText: string, sectionName: string): Map<string, string> {
  const entries = new Map<string, string>();
  const lines = iniText.split(/\r?\n/);
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      inSection = trimmed.toLowerCase() === `[${sectionName.toLowerCase()}]`;
      continue;
    }
    if (inSection) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        entries.set(trimmed.slice(0, eqIdx), trimmed.slice(eqIdx + 1));
      }
    }
  }
  return entries;
}

/**
 * Read a single value from a section (e.g. NewINIFormat from [Basic]).
 */
function readIniValue(iniText: string, section: string, key: string): string | undefined {
  const entries = extractSection(iniText, section);
  return entries.get(key);
}

/**
 * Standard Base64 decode (works in both Node.js and browser).
 */
function base64Decode(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  // Browser fallback
  const binStr = atob(b64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return bytes;
}

/** Map bounds from the [Map] INI section. */
export interface MapBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Result from parseMapPack — terrain data plus map metadata. */
export interface MapPackData {
  ttype: Uint16Array;
  ticon: Uint8Array;
  bounds: MapBounds;
}

/**
 * Parse the [MapPack] section from a Red Alert INI file.
 *
 * Returns the decoded TType (template type, uint16) and TIcon (template icon, uint8)
 * arrays for all 128x128 = 16384 map cells, plus the [Map] bounds.
 *
 * Requires NewINIFormat >= 3 in the [Basic] section.
 */
export function parseMapPack(iniText: string): MapPackData {
  // Check format version
  const formatStr = readIniValue(iniText, 'Basic', 'NewINIFormat');
  const format = formatStr ? parseInt(formatStr, 10) : 0;
  if (format < 3) {
    throw new Error(`Unsupported NewINIFormat: ${format} (need >= 3)`);
  }

  // Extract [MapPack] entries, sorted numerically by key
  const mapPackEntries = extractSection(iniText, 'MapPack');
  const sortedKeys = Array.from(mapPackEntries.keys()).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  // Concatenate all Base64 values
  const b64Str = sortedKeys.map((k) => mapPackEntries.get(k)!).join('');

  // Base64 decode
  const compressed = base64Decode(b64Str);

  // Decompress using RA's chunked section format.
  // Each chunk has a 4-byte header: [compressedSize:u16LE] [decompressedSize:u16LE]
  // followed by LCW-compressed data.

  // First layer: template types (uint16 LE, 32768 bytes = 16384 cells * 2)
  const rawTypes = new Uint8Array(MAP_CELL_TOTAL * 2);
  const offset1 = decompressRASections(compressed, 0, rawTypes, MAP_CELL_TOTAL * 2);

  // Convert little-endian byte pairs to Uint16Array
  const ttype = new Uint16Array(MAP_CELL_TOTAL);
  for (let i = 0; i < MAP_CELL_TOTAL; i++) {
    ttype[i] = rawTypes[i * 2] | (rawTypes[i * 2 + 1] << 8);
  }

  // Second layer: template icons (uint8, 16384 bytes)
  const ticon = new Uint8Array(MAP_CELL_TOTAL);
  if (offset1 > 0) {
    decompressRASections(compressed, offset1, ticon, MAP_CELL_TOTAL);
  }

  // Parse [Map] bounds
  const mapSection = extractSection(iniText, 'Map');
  const bounds: MapBounds = {
    x: parseInt(mapSection.get('X') ?? '0', 10),
    y: parseInt(mapSection.get('Y') ?? '0', 10),
    w: parseInt(mapSection.get('Width') ?? '128', 10),
    h: parseInt(mapSection.get('Height') ?? '128', 10),
  };

  return { ttype, ticon, bounds };
}

// ---------------------------------------------------------------------------
// Water / Coastal Detection
// ---------------------------------------------------------------------------

/**
 * Check whether a given cell's template type represents water.
 *
 * A cell is considered water if:
 * - Its template is 1 (TEMPLATE_WATER) or 2 (TEMPLATE_WATER2), OR
 * - Its template is 0xFFFF (clear/uninitialized) AND it's within the map bounds.
 *   On SNOW maps, 0xFFFF cells between islands render as ocean and the RA engine
 *   treats them as water for building placement purposes.
 *
 * If no bounds are provided, only pure water templates (1, 2) are checked.
 */
export function isWaterCell(
  ttype: Uint16Array,
  cell: number,
  bounds?: MapBounds,
): boolean {
  const tmpl = ttype[cell];
  if (WATER_TEMPLATES.has(tmpl)) return true;
  if (tmpl === 0xFFFF && bounds) {
    const cx = cell % MAP_W;
    const cy = Math.floor(cell / MAP_W);
    return cx >= bounds.x && cx < bounds.x + bounds.w &&
           cy >= bounds.y && cy < bounds.y + bounds.h;
  }
  return false;
}

/**
 * Find cells that are NOT water but have at least one cardinal water neighbor.
 * These are valid coastal placements for shipyards.
 *
 * Searches within a bounding box of `radius` cells around (centerCx, centerCy).
 * Returns up to 10 results, ordered by spiral outward from center.
 */
export function findCoastalCells(
  ttype: Uint16Array,
  centerCx: number,
  centerCy: number,
  radius = 20,
  bounds?: MapBounds,
): Array<{ cx: number; cy: number }> {
  const results: Array<{ cx: number; cy: number }> = [];

  for (let dy = -radius; dy <= radius && results.length < 30; dy++) {
    for (let dx = -radius; dx <= radius && results.length < 30; dx++) {
      const cx = centerCx + dx;
      const cy = centerCy + dy;
      if (cx < 1 || cx >= MAP_W - 1 || cy < 1 || cy >= MAP_W - 1) continue;

      const cell = cy * MAP_W + cx;

      const cellIsWater = isWaterCell(ttype, cell, bounds);

      if (!cellIsWater) {
        // Land cell: check for water within 3 cells
        let hasWater = false;
        for (let wy = -3; wy <= 3 && !hasWater; wy++) {
          for (let wx = -3; wx <= 3 && !hasWater; wx++) {
            if (wx === 0 && wy === 0) continue;
            const nc = (cy + wy) * MAP_W + (cx + wx);
            if (nc >= 0 && nc < MAP_W * MAP_W && isWaterCell(ttype, nc, bounds)) {
              hasWater = true;
            }
          }
        }
        if (hasWater) results.push({ cx, cy });
      } else {
        // Water cell: check for land within 2 cells (SYRD straddles land/water)
        let hasLand = false;
        for (let wy = -2; wy <= 2 && !hasLand; wy++) {
          for (let wx = -2; wx <= 2 && !hasLand; wx++) {
            if (wx === 0 && wy === 0) continue;
            const nc = (cy + wy) * MAP_W + (cx + wx);
            if (nc >= 0 && nc < MAP_W * MAP_W && !isWaterCell(ttype, nc, bounds)) {
              hasLand = true;
            }
          }
        }
        if (hasLand) results.push({ cx, cy });
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Integration Helper
// ---------------------------------------------------------------------------

// Cache parsed map data per INI path to avoid redundant parsing
const mapCache = new Map<string, MapPackData>();

/**
 * Read an INI file from disk and return coastal cells near (centerCx, centerCy).
 *
 * This is the primary integration entry point for the Oracle strategy.
 * Results are cached per INI path.
 *
 * @param iniPath - Absolute or relative path to the .ini file
 * @param centerCx - X coordinate of the base center (e.g. ConYard)
 * @param centerCy - Y coordinate of the base center
 */
export function getCoastalCellsFromINI(
  iniPath: string,
  centerCx: number,
  centerCy: number,
): Array<{ cx: number; cy: number }> {
  let mapData = mapCache.get(iniPath);
  if (!mapData) {
    // In browser context, fs is unavailable — use getCoastalCellsFromText instead.
    // Dynamic require hidden from bundler static analysis.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const _r = typeof (globalThis as Record<string, unknown>).__non_webpack_require__ !== 'undefined' ? (globalThis as Record<string, unknown>).__non_webpack_require__ as NodeRequire : require;
      const fs = _r('f' + 's');
      const iniText = fs.readFileSync(iniPath, 'utf-8');
      mapData = parseMapPack(iniText);
      mapCache.set(iniPath, mapData);
    } catch {
      return []; // Browser context — caller should use getCoastalCellsFromText
    }
  }
  return findCoastalCells(mapData.ttype, centerCx, centerCy, 20, mapData.bounds);
}

/**
 * Parse INI text directly (for browser context where fs is unavailable)
 * and return coastal cells.
 */
export function getCoastalCellsFromText(
  iniText: string,
  centerCx: number,
  centerCy: number,
): Array<{ cx: number; cy: number }> {
  const { ttype, bounds } = parseMapPack(iniText);
  return findCoastalCells(ttype, centerCx, centerCy, 20, bounds);
}

/**
 * Clear the INI parse cache (useful for testing).
 */
export function clearMapCache(): void {
  mapCache.clear();
}
