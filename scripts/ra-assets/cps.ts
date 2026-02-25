/**
 * CPS format decoder — RA PALETTE.CPS (320×200 indexed image with embedded palette).
 *
 * Format: 2-byte fileSize + 2-byte compression + 4-byte uncompressedSize + 2-byte paletteFlag
 *         + optional 768-byte palette + LCW-compressed pixel data.
 */

import { lcwDecompress } from './lcw.js';

export interface CpsImage {
  width: number;   // always 320
  height: number;  // always 200
  pixels: Uint8Array; // 64000 indexed pixels
}

export function parseCps(data: Buffer): CpsImage {
  const fileSize = data.readUInt16LE(0);
  const compression = data.readUInt16LE(2);
  const uncompSize = data.readUInt32LE(4);
  const palFlag = data.readUInt16LE(8);

  let offset = 10;
  // palFlag is the size of the embedded palette (768 = 256 × 3 RGB triplets, or 0 if none)
  if (palFlag > 0) {
    offset += palFlag;
  }

  const pixels = new Uint8Array(64000); // 320 × 200
  const source = new Uint8Array(data.buffer, data.byteOffset + offset, data.length - offset);
  lcwDecompress(source, pixels, 64000);

  return { width: 320, height: 200, pixels };
}
