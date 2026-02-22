/**
 * Westwood CRC algorithm - ported from RA/crc.cpp
 * Used by MIX file format to hash filenames for lookup.
 *
 * Not a true CRC — it's a fast rolling hash:
 *   crc = rotl32(crc, 1) + next_dword
 */

export function calculateCRC(data: Uint8Array, length: number): number {
  let crc = 0;
  let index = 0;
  const staging = new DataView(new ArrayBuffer(4));
  let pos = 0;

  // Bulk process 4-byte aligned chunks
  while (pos + 4 <= length) {
    const val =
      data[pos] |
      (data[pos + 1] << 8) |
      (data[pos + 2] << 16) |
      (data[pos + 3] << 24);
    crc = (((crc << 1) | (crc >>> 31)) + val) | 0;
    pos += 4;
  }

  // Process trailing bytes into staging buffer
  while (pos < length) {
    staging.setUint8(index++, data[pos++]);
  }

  // If staging buffer has partial data, fold it in
  if (index !== 0) {
    crc = (((crc << 1) | (crc >>> 31)) + staging.getInt32(0, true)) | 0;
  }

  return crc;
}

/** Compute MIX file CRC for a filename (uppercased) */
export function filenameCRC(name: string): number {
  const upper = name.toUpperCase();
  const bytes = new Uint8Array(upper.length);
  for (let i = 0; i < upper.length; i++) {
    bytes[i] = upper.charCodeAt(i);
  }
  return calculateCRC(bytes, bytes.length);
}
