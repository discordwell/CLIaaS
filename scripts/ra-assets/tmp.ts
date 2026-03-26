/**
 * Red Alert TMP (terrain template) reader
 *
 * TMP files store terrain tiles for a theatre (TEMPERATE, SNOW, INTERIOR).
 * Each template can contain one or more 24x24 pixel tiles arranged in a grid.
 *
 * Header (40 bytes) — verified against OpenRA TmpRALoader.cs and C++ compat.h IControl_Type:
 *   +0   uint16 tileWidth   (always 24)
 *   +2   uint16 tileHeight  (always 24)
 *   +4   uint32 tileCount   (number of unique tile images)
 *   +8   uint16 blocksX     (tiles wide — C++ MapWidth)
 *   +10  uint16 blocksY     (tiles tall — C++ MapHeight)
 *   +12  uint32 fileSize    (C++ Size)
 *   +16  uint32 imgStart    (offset to image data, always 0x28 = 40 — C++ Icons)
 *   +20  uint32 palettes    (C++ Palettes — unused, typically 0)
 *   +24  uint32 remaps      (C++ Remaps — unused)
 *   +28  int32  transFlag   (C++ TransFlag — transparency flag table offset)
 *   +32  int32  colorMap    (C++ ColorMap — per-icon terrain control map offset)
 *   +36  int32  indexStart  (C++ Map — tile index array offset)
 *
 * Image data: tileCount * (tileWidth * tileHeight) bytes of palette-indexed pixels.
 * Index array at indexStart: one byte per slot (blocksX * blocksY).
 *   Value 0xFF means that slot is empty/transparent.
 *   Otherwise, value is the image index (0-based) into the image data.
 * Control map at colorMap: one byte per slot (blocksX * blocksY).
 *   Each byte (0-15) indexes into the C++ _land[16] lookup table (cdata.cpp:3009-3026)
 *   to determine the terrain type for that icon.
 */

export interface TmpTile {
  /** Palette-indexed pixel data (24*24 = 576 bytes) */
  pixels: Uint8Array;
  /** Control map byte (0-15) from TMP terrain type data.
   *  Indexes into CONTROL_MAP_TO_LAND to get the LandType name.
   *  C++ ref: cdata.cpp:3028 — map[icon % (width * height)] */
  controlByte: number;
}

export interface TmpFile {
  tileWidth: number;
  tileHeight: number;
  blocksX: number;
  blocksY: number;
  /** Tiles indexed by their logical position (blocksX * blocksY).
   *  null entries mean the slot is empty. */
  tiles: (TmpTile | null)[];
  /** Total number of non-empty tiles */
  tileCount: number;
}

/**
 * C++ cdata.cpp:3009-3026 — _land[16] control-map-byte to LandType lookup.
 * Index = control map byte (0-15), value = LandType name.
 * Used during tileset extraction to bake per-icon terrain types.
 *
 * C++ LandType enum (defines.h:2841-2855):
 *   LAND_CLEAR=0, LAND_ROAD=1, LAND_WATER=2, LAND_ROCK=3,
 *   LAND_WALL=4, LAND_TIBERIUM=5, LAND_BEACH=6, LAND_ROUGH=7, LAND_RIVER=8
 */
export const CONTROL_MAP_TO_LAND: readonly string[] = [
  'Clear',  // 0
  'Clear',  // 1
  'Clear',  // 2
  'Clear',  // 3
  'Clear',  // 4
  'Clear',  // 5
  'Beach',  // 6
  'Clear',  // 7
  'Rock',   // 8
  'Road',   // 9
  'Water',  // 10
  'River',  // 11
  'Clear',  // 12
  'Clear',  // 13
  'Rough',  // 14
  'Clear',  // 15
];

export function parseTmp(data: Buffer): TmpFile {
  if (data.length < 40) {
    throw new Error(`TMP file too small: ${data.length} bytes`);
  }

  const tileWidth = data.readUInt16LE(0);
  const tileHeight = data.readUInt16LE(2);
  const tileCount = data.readUInt32LE(4);
  const blocksX = data.readUInt16LE(8);
  const blocksY = data.readUInt16LE(10);
  const _fileSize = data.readUInt32LE(12);
  const imgStart = data.readUInt32LE(16);

  const tileSize = tileWidth * tileHeight; // 576 for 24x24
  const slotCount = blocksX * blocksY;

  // C++ parity: templates like CLEAR1 have tileCount > blocksX*blocksY.
  // These are tile VARIATIONS for the same cell (e.g., 16 random clear ground tiles
  // in a 1x1 template). Use the larger of slotCount and tileCount for the array size.
  const effectiveSlots = Math.max(slotCount, tileCount);
  const tiles: (TmpTile | null)[] = new Array(effectiveSlots).fill(null);
  let tilesRead = 0;

  // Tile index array offset — at header byte +36 (C++ Map field)
  const indexStart = data.readInt32LE(36);
  // Control map offset — at header byte +32 (C++ ColorMap field)
  // Per-icon terrain classification bytes (one byte per grid slot, 0-15)
  const colorMapOffset = data.readInt32LE(32);
  const colorMapValid = colorMapOffset > 0 && colorMapOffset + slotCount <= data.length;

  if (indexStart > 0 && indexStart + effectiveSlots <= data.length) {
    // Use the index array to map slots to tile images
    for (let slot = 0; slot < effectiveSlots; slot++) {
      const tileIdx = data[indexStart + slot];
      if (tileIdx === 0xFF) {
        continue; // Empty slot
      }
      const pixelOffset = imgStart + tileIdx * tileSize;
      if (pixelOffset + tileSize <= data.length) {
        const pixels = new Uint8Array(tileSize);
        pixels.set(new Uint8Array(data.buffer, data.byteOffset + pixelOffset, tileSize));
        // C++ cdata.cpp:3028 — map[icon % (width * height)]
        // For variation templates (slot >= slotCount), wrap to control map range
        const cmSlot = slot % slotCount;
        const controlByte = (colorMapValid && cmSlot < slotCount)
          ? data[colorMapOffset + cmSlot] & 0x0F
          : 0; // default: LAND_CLEAR
        tiles[slot] = { pixels, controlByte };
        tilesRead++;
      }
    }
  } else {
    // Fallback: no valid index — read tiles sequentially (1x1 templates)
    for (let i = 0; i < tileCount && i < effectiveSlots; i++) {
      const pixelOffset = imgStart + i * tileSize;
      if (pixelOffset + tileSize <= data.length) {
        const pixels = new Uint8Array(tileSize);
        pixels.set(new Uint8Array(data.buffer, data.byteOffset + pixelOffset, tileSize));
        const cmSlot = i % slotCount;
        const controlByte = (colorMapValid && cmSlot < slotCount)
          ? data[colorMapOffset + cmSlot] & 0x0F
          : 0;
        tiles[i] = { pixels, controlByte };
        tilesRead++;
      }
    }
  }

  return {
    tileWidth,
    tileHeight,
    blocksX,
    blocksY,
    tiles,
    tileCount: tilesRead,
  };
}
