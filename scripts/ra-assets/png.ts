/**
 * Minimal PNG encoder using Node.js built-in zlib.
 * No external dependencies needed.
 */

import { deflateSync } from 'zlib';

function crc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    table[n] = c;
  }
  return table;
}

const CRC_TABLE = crc32Table();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i);

  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  writeUint32BE(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);

  // CRC over type + data
  const crcData = new Uint8Array(4 + data.length);
  crcData.set(typeBytes, 0);
  crcData.set(data, 4);
  writeUint32BE(chunk, 8 + data.length, crc32(crcData));

  return chunk;
}

/**
 * Encode RGBA pixel data as a PNG file.
 * @param rgba - RGBA pixel data (width * height * 4 bytes)
 * @param width - Image width
 * @param height - Image height
 * @returns PNG file as Buffer
 */
export function encodePNG(
  rgba: Uint8Array,
  width: number,
  height: number
): Buffer {
  // PNG signature
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = new Uint8Array(13);
  writeUint32BE(ihdr, 0, width);
  writeUint32BE(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Prepare raw data with filter bytes
  const rawData = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // filter: none
    rawData.set(
      rgba.subarray(y * width * 4, (y + 1) * width * 4),
      y * (1 + width * 4) + 1
    );
  }

  // Compress with zlib
  const compressed = deflateSync(Buffer.from(rawData));

  // IEND chunk
  const iend = new Uint8Array(0);

  // Assemble PNG
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', new Uint8Array(compressed));
  const iendChunk = makeChunk('IEND', iend);

  const png = Buffer.alloc(
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  );
  let offset = 0;
  png.set(signature, offset);
  offset += signature.length;
  png.set(ihdrChunk, offset);
  offset += ihdrChunk.length;
  png.set(idatChunk, offset);
  offset += idatChunk.length;
  png.set(iendChunk, offset);

  return png;
}
