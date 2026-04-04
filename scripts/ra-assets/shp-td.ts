/**
 * TD-style SHP parser (Tiberian Dawn / shared format used by MOUSE.SHP in Red Alert)
 *
 * File layout (ShapeBlock from SDLLIB/include/shape.h):
 *   uint16  NumShapes
 *   uint32  Offsets[NumShapes+1]  (last = end-of-file sentinel)
 *
 * Per-frame layout (Shape_Type with #pragma pack(1)):
 *   bytes 0-1:  uint16 ShapeType  (0=LCW compressed)
 *   bytes 2-3:  padding/unused
 *   byte  4:    uint8  Width
 *   byte  5:    uint8  Height (OriginalHeight in struct)
 *   bytes 6-7:  unused
 *   bytes 8-9:  uint16 DataLength (uncompressed intermediate size)
 *   bytes 10+:  LCW compressed data
 *
 * After LCW decompression, pixel data uses RLE encoding:
 *   nonzero byte = literal pixel (palette index)
 *   zero byte + count byte = run of 'count' transparent pixels
 *
 * Reference: SDLLIB/mouse.cpp lines 32-75 (Set_Cursor decoding)
 */

import { lcwDecompress } from './lcw.js';

export interface TdShpFrame {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface TdShpFile {
  frameCount: number;
  maxWidth: number;
  maxHeight: number;
  frames: TdShpFrame[];
}

export function parseTdShp(data: Buffer): TdShpFile {
  const numShapes = data.readUInt16LE(0);

  // Offset table: numShapes + 1 entries starting at byte 2
  const offsets: number[] = [];
  for (let i = 0; i <= numShapes; i++) {
    offsets.push(data.readUInt32LE(2 + i * 4));
  }

  let maxWidth = 0;
  let maxHeight = 0;
  const frames: TdShpFrame[] = [];

  for (let i = 0; i < numShapes; i++) {
    const off = offsets[i];
    const nextOff = offsets[i + 1] ?? data.length;
    const frameSize = nextOff - off;

    if (frameSize < 10 || off >= data.length) {
      frames.push({ width: 1, height: 1, pixels: new Uint8Array(1) });
      continue;
    }

    // Per-frame header — width/height as uint8 at bytes 4,5
    const width = data[off + 4];
    const height = data[off + 5];
    const dataLength = data.readUInt16LE(off + 8);

    if (width === 0 || height === 0 || dataLength === 0) {
      frames.push({ width: 1, height: 1, pixels: new Uint8Array(1) });
      continue;
    }

    maxWidth = Math.max(maxWidth, width);
    maxHeight = Math.max(maxHeight, height);

    // Step 1: LCW decompress (data starts at byte 10)
    const compData = data.subarray(off + 10, off + frameSize);
    const lcwOut = new Uint8Array(dataLength);
    try {
      lcwDecompress(compData, lcwOut, dataLength);
    } catch {
      frames.push({ width, height, pixels: new Uint8Array(width * height) });
      continue;
    }

    // Step 2: RLE decode (mouse.cpp:56-75)
    // nonzero = literal pixel, zero + count = run of transparent
    const pixelCount = width * height;
    const pixels = new Uint8Array(pixelCount);
    let remaining = pixelCount;
    let inIdx = 0;
    let outIdx = 0;
    while (remaining > 0 && inIdx < lcwOut.length) {
      const pixel = lcwOut[inIdx++];
      if (pixel !== 0) {
        pixels[outIdx++] = pixel;
        remaining--;
      } else {
        if (inIdx >= lcwOut.length) break;
        const count = lcwOut[inIdx++];
        for (let c = 0; c < count && remaining > 0; c++) {
          pixels[outIdx++] = 0;
          remaining--;
        }
      }
    }

    frames.push({ width, height, pixels });
  }

  return { frameCount: numShapes, maxWidth, maxHeight, frames };
}
