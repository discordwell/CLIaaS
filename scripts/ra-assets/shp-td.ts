/**
 * TD-style SHP parser (Tiberian Dawn / shared format used by MOUSE.SHP in Red Alert)
 *
 * File layout:
 *   uint16  NumShapes
 *   uint32  Offsets[NumShapes+1]  (last = end-of-file sentinel)
 *
 * Per-frame Shape_Type header (SDLLIB/include/shape.h):
 *   uint16  ShapeType     (0=LCW compressed, 2=uncompressed)
 *   uint8   Height
 *   uint16  Width
 *   uint8   OriginalHeight
 *   uint16  ShapeSize     (total frame size including header)
 *   uint16  DataLength    (uncompressed pixel data size)
 *   uint8   Colortable[16] (optional compact color table)
 *
 * Pixel data follows the header. For ShapeType=0 (LCW), data is LCW-compressed.
 * For ShapeType=2 (uncompressed), data is raw palette indices.
 */

import { lcwDecompress } from './lcw.js';

export interface TdShpFrame {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface TdShpFile {
  frameCount: number;
  /** Maximum frame dimensions across all frames */
  maxWidth: number;
  maxHeight: number;
  frames: TdShpFrame[];
}

export function parseTdShp(data: Buffer): TdShpFile {
  const numShapes = data.readUInt16LE(0);

  // Read offset table: numShapes + 1 entries (last = EOF sentinel)
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

    if (frameSize < 8 || off >= data.length) {
      // Empty/invalid frame
      frames.push({ width: 1, height: 1, pixels: new Uint8Array(1) });
      continue;
    }

    // Parse Shape_Type header
    const shapeType = data.readUInt16LE(off);
    const height = data[off + 2];
    const width = data.readUInt16LE(off + 3);
    const _originalHeight = data[off + 5];
    const _shapeSize = data.readUInt16LE(off + 6);
    const dataLength = data.readUInt16LE(off + 8);

    if (width === 0 || height === 0) {
      frames.push({ width: 1, height: 1, pixels: new Uint8Array(1) });
      continue;
    }

    maxWidth = Math.max(maxWidth, width);
    maxHeight = Math.max(maxHeight, height);

    const pixelCount = width * height;
    let pixels: Uint8Array;

    // Header is 10 bytes (without color table). ShapeType bit 0 = has color table (16 bytes).
    const hasColorTable = (shapeType & 1) !== 0;
    const headerSize = 10 + (hasColorTable ? 16 : 0);
    const pixelDataStart = off + headerSize;

    if ((shapeType & 2) !== 0) {
      // Uncompressed — raw pixel data
      pixels = new Uint8Array(pixelCount);
      const available = Math.min(pixelCount, data.length - pixelDataStart);
      for (let j = 0; j < available; j++) {
        pixels[j] = data[pixelDataStart + j];
      }
    } else {
      // LCW compressed
      try {
        const compressed = data.subarray(pixelDataStart, pixelDataStart + frameSize - headerSize);
        const decompressed = new Uint8Array(dataLength || pixelCount);
        lcwDecompress(compressed, decompressed);
        pixels = decompressed.subarray(0, pixelCount);
      } catch {
        pixels = new Uint8Array(pixelCount);
      }
    }

    // Apply color table remapping if present
    if (hasColorTable) {
      const colorTable = data.subarray(off + 10, off + 26);
      for (let j = 0; j < pixels.length; j++) {
        if (pixels[j] < 16) {
          pixels[j] = colorTable[pixels[j]];
        }
      }
    }

    frames.push({ width, height, pixels });
  }

  return { frameCount: numShapes, maxWidth, maxHeight, frames };
}
