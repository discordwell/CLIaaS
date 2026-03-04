/**
 * Tests for TMP terrain template parser — verifies correct header offset reading.
 *
 * The key fix: image index array is at header byte +36 (indexStart),
 * NOT +24 (which is uninitialized garbage in original build tools).
 * Verified against OpenRA TmpRALoader.cs.
 */

import { describe, it, expect } from 'vitest';
import { parseTmp } from '../../../scripts/ra-assets/tmp.js';

/** Build a minimal valid TMP buffer with known tile data and index array. */
function makeTmpBuffer(opts: {
  blocksX: number;
  blocksY: number;
  tileCount: number;
  index: number[]; // one byte per slot: 0xFF = empty, else image index
}): Buffer {
  const { blocksX, blocksY, tileCount, index } = opts;
  const tileW = 24, tileH = 24;
  const tileSize = tileW * tileH; // 576
  const headerSize = 40;
  const imgDataSize = tileCount * tileSize;
  const indexStart = headerSize + imgDataSize;
  const indexEnd = indexStart + index.length;
  const terrainSize = index.length; // terrain type array (same size as index)
  const fileSize = indexEnd + terrainSize;

  const buf = Buffer.alloc(fileSize, 0);

  // Header
  buf.writeUInt16LE(tileW, 0);      // +0: tileWidth
  buf.writeUInt16LE(tileH, 2);      // +2: tileHeight
  buf.writeUInt32LE(tileCount, 4);   // +4: tileCount
  buf.writeUInt16LE(blocksX, 8);     // +8: blocksX
  buf.writeUInt16LE(blocksY, 10);    // +10: blocksY
  buf.writeUInt32LE(fileSize, 12);   // +12: fileSize
  buf.writeUInt32LE(headerSize, 16); // +16: imgStart (always 40)
  buf.writeUInt32LE(0, 20);          // +20: padding (0)
  buf.writeUInt32LE(0xDEADBEEF, 24); // +24: GARBAGE (uninitialized in original tools)
  buf.writeInt32LE(indexEnd, 28);     // +28: indexEnd
  buf.writeUInt32LE(0, 32);          // +32: padding
  buf.writeInt32LE(indexStart, 36);   // +36: indexStart

  // Image data — fill each tile with a unique byte value for identification
  for (let t = 0; t < tileCount; t++) {
    const offset = headerSize + t * tileSize;
    buf.fill(t + 1, offset, offset + tileSize); // tile 0 → all 1s, tile 1 → all 2s, etc.
  }

  // Index array
  for (let i = 0; i < index.length; i++) {
    buf[indexStart + i] = index[i];
  }

  // Terrain type array (after index)
  for (let i = 0; i < terrainSize; i++) {
    buf[indexEnd + i] = 0; // all clear terrain
  }

  return buf;
}

describe('parseTmp — header offset correctness', () => {
  it('reads image index from header offset +36 (not +24)', () => {
    // 2x2 grid, 3 unique tiles, slot 2 is empty
    const index = [0, 1, 0xFF, 2];
    const buf = makeTmpBuffer({ blocksX: 2, blocksY: 2, tileCount: 3, index });
    const tmp = parseTmp(buf);

    expect(tmp.tiles[0]).not.toBeNull();
    expect(tmp.tiles[1]).not.toBeNull();
    expect(tmp.tiles[2]).toBeNull(); // 0xFF = empty
    expect(tmp.tiles[3]).not.toBeNull();
    expect(tmp.tileCount).toBe(3);
  });

  it('maps correct image data to correct slots via index', () => {
    // 3x1 grid, 2 unique tiles, index maps: slot0→tile1, slot1→tile0, slot2→tile1
    const index = [1, 0, 1];
    const buf = makeTmpBuffer({ blocksX: 3, blocksY: 1, tileCount: 2, index });
    const tmp = parseTmp(buf);

    // tile 0 filled with byte value 1, tile 1 filled with byte value 2
    expect(tmp.tiles[0]!.pixels[0]).toBe(2); // slot 0 → image 1 → byte 2
    expect(tmp.tiles[1]!.pixels[0]).toBe(1); // slot 1 → image 0 → byte 1
    expect(tmp.tiles[2]!.pixels[0]).toBe(2); // slot 2 → image 1 → byte 2
  });

  it('ignores garbage at header offset +24', () => {
    const index = [0, 0xFF, 1];
    const buf = makeTmpBuffer({ blocksX: 3, blocksY: 1, tileCount: 2, index });
    // Byte 24 contains 0xDEADBEEF — should be completely ignored
    expect(buf.readUInt32LE(24)).toBe(0xDEADBEEF);

    const tmp = parseTmp(buf);
    expect(tmp.tiles[0]).not.toBeNull();
    expect(tmp.tiles[1]).toBeNull();
    expect(tmp.tiles[2]).not.toBeNull();
  });

  it('handles 0xFF gaps in multi-tile shoreline templates', () => {
    // Simulates SH01-like: 4x5=20 slots, 11 unique tiles, scattered 0xFF
    const index = [
      0xFF, 0xFF, 0xFF, 0,
      0xFF, 1, 2, 3,
      4, 5, 6, 7,
      8, 9, 0xFF, 0xFF,
      10, 0xFF, 0xFF, 0xFF,
    ];
    const buf = makeTmpBuffer({ blocksX: 4, blocksY: 5, tileCount: 11, index });
    const tmp = parseTmp(buf);

    const nonNull = tmp.tiles.filter(t => t !== null).length;
    expect(nonNull).toBe(11);
    expect(tmp.tiles[0]).toBeNull();
    expect(tmp.tiles[3]).not.toBeNull();
    expect(tmp.tiles[16]).not.toBeNull(); // slot 16 → image 10
  });

  it('falls back to sequential for 1x1 templates without valid index', () => {
    // Simple 1x1 — indexStart=0 (no index), should read sequentially
    const tileW = 24, tileH = 24;
    const tileSize = tileW * tileH;
    const headerSize = 40;
    const buf = Buffer.alloc(headerSize + tileSize, 0);

    buf.writeUInt16LE(tileW, 0);
    buf.writeUInt16LE(tileH, 2);
    buf.writeUInt32LE(1, 4); // 1 tile
    buf.writeUInt16LE(1, 8);
    buf.writeUInt16LE(1, 10);
    buf.writeUInt32LE(buf.length, 12);
    buf.writeUInt32LE(headerSize, 16);
    buf.writeInt32LE(0, 28); // no index
    buf.writeInt32LE(0, 36); // no index
    buf.fill(42, headerSize, headerSize + tileSize);

    const tmp = parseTmp(buf);
    expect(tmp.tileCount).toBe(1);
    expect(tmp.tiles[0]!.pixels[0]).toBe(42);
  });
});
