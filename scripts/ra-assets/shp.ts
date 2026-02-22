/**
 * SHP sprite reader for Westwood Red Alert KeyFrame format
 *
 * KeyFrameHeaderType (14 bytes):
 *   uint16 frameCount
 *   uint16 x (origin/hotspot)
 *   uint16 y
 *   uint16 width
 *   uint16 height
 *   uint16 largestFrameSize
 *   int16  flags
 *
 * Then (frameCount + 2) offset entries, each 8 bytes:
 *   uint32 LE: bits 0-23 = file offset, bits 24-31 = frame flags
 *   uint32 LE: bits 0-23 = reference offset, bits 24-31 = ref flags
 *
 * Frame flags:
 *   0x80 = standalone LCW compressed frame (keyframe)
 *   0x40 = XOR delta frame (LCW compressed delta, apply to reference)
 *   0x20 = uncompressed raw pixel data
 *
 * Frame data is LCW-compressed indexed pixel data (palette indices).
 */

import { lcwDecompress } from './lcw.js';

export interface ShpFrame {
  width: number;
  height: number;
  pixels: Uint8Array; // palette-indexed pixel data
}

export interface ShpFile {
  width: number;
  height: number;
  frameCount: number;
  frames: ShpFrame[];
}

interface FrameEntry {
  offset: number;   // file offset to frame data (bits 0-23)
  flags: number;    // frame type flags (bits 24-31)
  refOffset: number; // reference frame data offset
  refFlags: number;  // reference frame flags
}

export function parseShp(data: Buffer): ShpFile {
  // 14-byte header (KeyFrameHeaderType)
  const frameCount = data.readUInt16LE(0);
  const _x = data.readUInt16LE(2);
  const _y = data.readUInt16LE(4);
  const width = data.readUInt16LE(6);
  const height = data.readUInt16LE(8);
  const _largestFrame = data.readUInt16LE(10);
  const _headerFlags = data.readInt16LE(12);

  // Read offset table: (frameCount + 2) entries, each 8 bytes, starting at byte 14
  const entries: FrameEntry[] = [];
  let pos = 14;

  for (let i = 0; i < frameCount + 2; i++) {
    const raw0 = data.readUInt32LE(pos);
    const raw1 = data.readUInt32LE(pos + 4);

    entries.push({
      offset: raw0 & 0x00FFFFFF,
      flags: (raw0 >>> 24) & 0xFF,
      refOffset: raw1 & 0x00FFFFFF,
      refFlags: (raw1 >>> 24) & 0xFF,
    });
    pos += 8;
  }

  const frameSize = width * height;
  const frames: ShpFrame[] = [];

  // Build a map from file offset → decoded pixel buffer for XOR delta references
  const decodedByOffset = new Map<number, Uint8Array>();

  for (let i = 0; i < frameCount; i++) {
    const pixels = new Uint8Array(frameSize);
    const entry = entries[i];

    if (entry.offset === 0 && entry.flags === 0) {
      // Empty/transparent frame
      frames.push({ width, height, pixels });
      continue;
    }

    // Calculate frame data length from offset to next entry's offset
    const nextOffset = entries[i + 1].offset;
    const frameDataEnd = nextOffset > entry.offset ? nextOffset : data.length;
    const frameLen = frameDataEnd - entry.offset;

    if (entry.offset >= data.length || frameLen <= 0) {
      // Out of bounds — empty frame
      frames.push({ width, height, pixels });
      continue;
    }

    const frameData = new Uint8Array(
      data.buffer,
      data.byteOffset + entry.offset,
      Math.min(frameLen, data.length - entry.offset)
    );

    if (entry.flags & 0x80) {
      // Standalone LCW compressed keyframe
      lcwDecompress(frameData, pixels, frameSize);
      decodedByOffset.set(entry.offset, new Uint8Array(pixels));
    } else if (entry.flags & 0x40) {
      // XOR delta frame — decompress delta, then XOR with reference
      // Find reference frame pixels by file offset
      const refPixels = decodedByOffset.get(entry.refOffset);
      if (refPixels) {
        pixels.set(refPixels);
      } else if (entry.refOffset > 0 && entry.refOffset < data.length) {
        // Reference not yet decoded — decode it now
        const refEnd = findNextOffset(entries, entry.refOffset);
        const refLen = refEnd - entry.refOffset;
        if (refLen > 0) {
          const refData = new Uint8Array(
            data.buffer,
            data.byteOffset + entry.refOffset,
            Math.min(refLen, data.length - entry.refOffset)
          );
          lcwDecompress(refData, pixels, frameSize);
          decodedByOffset.set(entry.refOffset, new Uint8Array(pixels));
        }
      }

      // Decompress the delta
      const tempBuf = new Uint8Array(frameSize);
      lcwDecompress(frameData, tempBuf, frameSize);

      // XOR delta onto reference
      for (let j = 0; j < frameSize; j++) {
        pixels[j] ^= tempBuf[j];
      }
      decodedByOffset.set(entry.offset, new Uint8Array(pixels));
    } else if (entry.flags & 0x20) {
      // Uncompressed raw pixel data
      pixels.set(frameData.subarray(0, Math.min(frameSize, frameData.length)));
      decodedByOffset.set(entry.offset, new Uint8Array(pixels));
    } else {
      // Unknown flags — try LCW decompression as fallback
      lcwDecompress(frameData, pixels, frameSize);
      decodedByOffset.set(entry.offset, new Uint8Array(pixels));
    }

    frames.push({ width, height, pixels });
  }

  return { width, height, frameCount, frames };
}

/** Find the smallest offset in entries that is strictly greater than targetOffset */
function findNextOffset(entries: FrameEntry[], targetOffset: number): number {
  let best = Infinity;
  for (const e of entries) {
    if (e.offset > targetOffset && e.offset < best) {
      best = e.offset;
    }
  }
  return best === Infinity ? targetOffset + 4096 : best;
}
