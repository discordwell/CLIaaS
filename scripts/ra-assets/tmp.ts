/**
 * Red Alert TMP (terrain template) reader
 *
 * TMP files store terrain tiles for a theatre (TEMPERATE, SNOW, INTERIOR).
 * Each template can contain one or more 24x24 pixel tiles arranged in a grid.
 *
 * Header (40 bytes):
 *   uint16 tileWidth   (always 24)
 *   uint16 tileHeight  (always 24)
 *   uint32 tileCount   (total tiles in this template)
 *   uint16 blocksX     (tiles wide)
 *   uint16 blocksY     (tiles tall)
 *   uint32 fileSize
 *   uint32 imgStart    (offset to image data, always 0x28 = 40)
 *   uint32 unknown1
 *   uint32 unknown2
 *   uint32 indexOffset  (offset to tile index array)
 *   uint32 unknown3
 *   uint32 footerOffset (offset to terrain type footer)
 *
 * Image data: tileCount * (tileWidth * tileHeight) bytes of palette-indexed pixels.
 * Index array at indexOffset: one byte per logical tile slot (blocksX * blocksY).
 *   Value 0xFF means that slot is empty/transparent.
 *   Otherwise, value is the image index (0-based).
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

  // Read the tile index array if available
  // The index array tells us which logical slot maps to which image tile.
  // In many RA TMP files the index is at offset 0x24 (footerOffset) or
  // we can compute tile positions sequentially.
  //
  // For simple templates (1x1), the image data starts at imgStart and
  // there's just one tile.
  //
  // For multi-tile templates, the tiles are stored sequentially in the
  // image data area, but some slots may be empty (0xFF in the index).

  const tiles: (TmpTile | null)[] = new Array(slotCount).fill(null);

  // Try to read tiles sequentially from imgStart
  // Each actual tile is tileSize bytes of indexed pixel data
  let tilesRead = 0;

  // If there's an index/footer, parse it to know which slots have tiles
  // The index offset is at byte 0x18 (24) in the header
  const indexOffset = data.readUInt32LE(24);

  if (indexOffset > 0 && indexOffset + slotCount <= data.length) {
    // Use the index array to map slots to tile images
    for (let slot = 0; slot < slotCount; slot++) {
      const tileIdx = data[indexOffset + slot];
      if (tileIdx === 0xFF) {
        // Empty slot
        continue;
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
    // No index — read tiles sequentially
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
