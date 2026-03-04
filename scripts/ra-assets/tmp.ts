/**
 * Red Alert TMP (terrain template) reader
 *
 * TMP files store terrain tiles for a theatre (TEMPERATE, SNOW, INTERIOR).
 * Each template can contain one or more 24x24 pixel tiles arranged in a grid.
 *
 * Header (40 bytes) — verified against OpenRA TmpRALoader.cs:
 *   +0   uint16 tileWidth   (always 24)
 *   +2   uint16 tileHeight  (always 24)
 *   +4   uint32 tileCount   (number of unique tile images)
 *   +8   uint16 blocksX     (tiles wide)
 *   +10  uint16 blocksY     (tiles tall)
 *   +12  uint32 fileSize
 *   +16  uint32 imgStart    (offset to image data, always 0x28 = 40)
 *   +20  uint32 (padding/validation — always 0)
 *   +24  uint32 (padding — uninitialized, garbage in practice)
 *   +28  int32  indexEnd    (end of tile index array = start of terrain types)
 *   +32  uint32 (padding)
 *   +36  int32  indexStart  (offset to tile index array)
 *
 * Image data: tileCount * (tileWidth * tileHeight) bytes of palette-indexed pixels.
 * Index array at indexStart: (indexEnd - indexStart) bytes, one per slot (blocksX * blocksY).
 *   Value 0xFF means that slot is empty/transparent.
 *   Otherwise, value is the image index (0-based) into the image data.
 */

export interface TmpTile {
  /** Palette-indexed pixel data (24*24 = 576 bytes) */
  pixels: Uint8Array;
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

  const tiles: (TmpTile | null)[] = new Array(slotCount).fill(null);
  let tilesRead = 0;

  // Image index array offset — at header byte +36 (verified against OpenRA TmpRALoader.cs)
  const indexStart = data.readInt32LE(36);
  const indexEnd = data.readInt32LE(28);

  if (indexStart > 0 && indexStart + slotCount <= data.length) {
    // Use the index array to map slots to tile images
    for (let slot = 0; slot < slotCount; slot++) {
      const tileIdx = data[indexStart + slot];
      if (tileIdx === 0xFF) {
        continue; // Empty slot
      }
      const pixelOffset = imgStart + tileIdx * tileSize;
      if (pixelOffset + tileSize <= data.length) {
        const pixels = new Uint8Array(tileSize);
        pixels.set(new Uint8Array(data.buffer, data.byteOffset + pixelOffset, tileSize));
        tiles[slot] = { pixels };
        tilesRead++;
      }
    }
  } else {
    // Fallback: no valid index — read tiles sequentially (1x1 templates)
    for (let i = 0; i < tileCount && i < slotCount; i++) {
      const pixelOffset = imgStart + i * tileSize;
      if (pixelOffset + tileSize <= data.length) {
        const pixels = new Uint8Array(tileSize);
        pixels.set(new Uint8Array(data.buffer, data.byteOffset + pixelOffset, tileSize));
        tiles[i] = { pixels };
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
