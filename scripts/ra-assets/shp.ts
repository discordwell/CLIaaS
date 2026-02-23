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
 *   0x40 = XOR base frame (xor-delta vs referenced keyframe by data offset)
 *   0x20 = XOR chain frame (xor-delta vs previous decoded frame)
 *
 * Frame data uses LCW for keyframes and Westwood XOR-Delta for deltas.
 */

import { lcwDecompress } from './lcw.js';
import { xorDeltaApply } from './xor.js';

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

  // Some SHPs use delta frames that are not contiguous in the index table.
  // Use the next greater file offset globally (not just the next index entry).
  const frameOffsets = [...new Set(entries
    .map((e) => e.offset)
    .filter((off) => off > 0 && off < data.length))]
    .sort((a, b) => a - b);
  const nextOffsetByOffset = new Map<number, number>();
  for (let i = 0; i < frameOffsets.length; i++) {
    nextOffsetByOffset.set(frameOffsets[i], frameOffsets[i + 1] ?? data.length);
  }

  // Build maps for delta references.
  const decodedByOffset = new Map<number, Uint8Array>();
  const decodedByIndex: Uint8Array[] = [];

  for (let i = 0; i < frameCount; i++) {
    const pixels = new Uint8Array(frameSize);
    const entry = entries[i];

    if (entry.offset === 0 && entry.flags === 0) {
      // Empty/transparent frame
      frames.push({ width, height, pixels });
      continue;
    }

    const frameDataEnd = nextOffsetByOffset.get(entry.offset) ?? data.length;
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
      // Standalone LCW-compressed keyframe.
      lcwDecompress(frameData, pixels, frameSize);
      decodedByOffset.set(entry.offset, new Uint8Array(pixels));
    } else if (entry.flags & 0x40) {
      // XOR base: apply xor-delta against a referenced keyframe by data offset.
      const refPixels = decodedByOffset.get(entry.refOffset);
      if (refPixels) {
        pixels.set(refPixels);
      } else if (entry.refOffset > 0 && entry.refOffset < data.length) {
        // If missing, decode the referenced LCW keyframe directly by offset.
        const refEnd = nextOffsetByOffset.get(entry.refOffset) ?? data.length;
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

      xorDeltaApply(frameData, pixels, frameSize);
      decodedByOffset.set(entry.offset, new Uint8Array(pixels));
    } else if (entry.flags & 0x20) {
      // XOR chain: apply xor-delta against previous decoded frame in chain.
      const prev = i > 0 ? decodedByIndex[i - 1] : null;
      if (prev) pixels.set(prev);
      xorDeltaApply(frameData, pixels, frameSize);
      decodedByOffset.set(entry.offset, new Uint8Array(pixels));
    } else if (entry.flags === 0) {
      // Rare fallback: treat as raw frame bytes.
      pixels.set(frameData.subarray(0, Math.min(frameSize, frameData.length)));
      decodedByOffset.set(entry.offset, new Uint8Array(pixels));
    } else {
      // Unknown flags — try LCW decompression as fallback
      lcwDecompress(frameData, pixels, frameSize);
      decodedByOffset.set(entry.offset, new Uint8Array(pixels));
    }

    decodedByIndex.push(new Uint8Array(pixels));
    frames.push({ width, height, pixels });
  }

  return { width, height, frameCount, frames };
}
