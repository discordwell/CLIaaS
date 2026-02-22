/**
 * MIX file header decryption for Red Alert 1.
 *
 * Encrypted MIX files have:
 *   4 bytes: flags (first word=0, second word has bit 1 set for encryption)
 *   80 bytes: two 40-byte RSA-encrypted blocks
 *   Encrypted header: Blowfish ECB encrypted count + size + index entries
 *   Unencrypted body data
 *
 * The RSA public key for RA1 is well-known (from keys.ini, released by Westwood).
 * The 80 bytes decrypt to a 56-byte Blowfish key.
 */

import { Blowfish } from './blowfish.js';

// RA1 public key - Base64 DER encoded (02 28 prefix = DER INTEGER, 40 bytes)
const RA1_PUBLIC_KEY_B64 = 'AihRvNoIbTn85FZRYNZRcT+i6KpU+maCsEqr3Q5q+LDB5tH7Tz2qQ38V';
const RA1_PUBLIC_EXPONENT = 0x10001n; // 65537

/** Convert a byte array (little-endian) to BigInt */
function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

/** Convert BigInt to byte array (little-endian), padded to specified length */
function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const result = new Uint8Array(length);
  let v = value;
  for (let i = 0; i < length; i++) {
    result[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return result;
}

/** Modular exponentiation: base^exp mod mod */
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp & 1n) {
      result = (result * base) % mod;
    }
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

/** Get the RA1 RSA public key modulus */
function getModulus(): bigint {
  const derBytes = Buffer.from(RA1_PUBLIC_KEY_B64, 'base64');
  // Skip DER header (02 28 = INTEGER, 40 bytes long)
  const modulusBytes = derBytes.subarray(2);
  // The modulus is big-endian in DER, convert to BigInt
  let result = 0n;
  for (let i = 0; i < modulusBytes.length; i++) {
    result = (result << 8n) | BigInt(modulusBytes[i]);
  }
  return result;
}

/**
 * Decrypt an encrypted MIX file header.
 *
 * @param data - Full MIX file data (starting at byte 0)
 * @returns Object with decrypted header info and body offset
 */
export function decryptMixHeader(data: Buffer): {
  count: number;
  dataSize: number;
  entries: { crc: number; offset: number; size: number }[];
  bodyOffset: number;
  hasDigest: boolean;
} {
  // Read flags
  const flagsSecond = data.readUInt16LE(2);
  const hasDigest = (flagsSecond & 0x01) !== 0;
  const isEncrypted = (flagsSecond & 0x02) !== 0;

  if (!isEncrypted) {
    // Not encrypted - just read normally
    const count = data.readUInt16LE(4);
    const dataSize = data.readUInt32LE(6);
    const entries = [];
    let offset = 10;
    for (let i = 0; i < count; i++) {
      entries.push({
        crc: data.readInt32LE(offset),
        offset: data.readInt32LE(offset + 4),
        size: data.readInt32LE(offset + 8),
      });
      offset += 12;
    }
    return { count, dataSize, entries, bodyOffset: offset, hasDigest };
  }

  // Decrypt the RSA-encrypted Blowfish key
  const modulus = getModulus();
  const block1 = data.subarray(4, 44); // First 40-byte RSA block
  const block2 = data.subarray(44, 84); // Second 40-byte RSA block

  // RSA decrypt each block (little-endian integer)
  const dec1 = modPow(bytesToBigInt(block1), RA1_PUBLIC_EXPONENT, modulus);
  const dec2 = modPow(bytesToBigInt(block2), RA1_PUBLIC_EXPONENT, modulus);

  // Extract decrypted bytes: Plain_Block_Size = (320-1)/8 = 39 bytes per block
  const decBytes1 = bigIntToBytes(dec1, 39);
  const decBytes2 = bigIntToBytes(dec2, 39);

  // Combine to form the Blowfish key (first 56 of 78 decrypted bytes)
  const bfKey = Buffer.alloc(56);
  bfKey.set(decBytes1, 0);                    // 39 bytes at offset 0
  bfKey.set(decBytes2.subarray(0, 17), 39);   // 17 bytes at offset 39 → total 56

  // Create Blowfish cipher with the decrypted key
  const bf = new Blowfish(bfKey);

  // Decrypt the header using Blowfish ECB
  const encryptedHeader = data.subarray(84);

  // Decrypt first 8-byte block to get count and dataSize
  const firstBlockDec = bf.decryptECB(new Uint8Array(encryptedHeader.subarray(0, 8)));
  const firstBlock = Buffer.from(firstBlockDec);
  const count = firstBlock.readUInt16LE(0);
  const dataSize = firstBlock.readUInt32LE(2);

  // Calculate total header size (count + size + entries)
  const headerSize = 6 + count * 12;
  const encryptedSize = Math.ceil(headerSize / 8) * 8;

  // Decrypt the full header
  const fullDecrypted = Buffer.from(
    bf.decryptECB(new Uint8Array(encryptedHeader.subarray(0, encryptedSize)))
  );

  // Parse the decrypted header
  const entries = [];
  let offset = 6; // Skip count (2) + dataSize (4)
  for (let i = 0; i < count; i++) {
    entries.push({
      crc: fullDecrypted.readInt32LE(offset),
      offset: fullDecrypted.readInt32LE(offset + 4),
      size: fullDecrypted.readInt32LE(offset + 8),
    });
    offset += 12;
  }

  // Body starts after: 4 (flags) + 80 (RSA blocks) + encryptedSize
  const bodyOffset = 84 + encryptedSize;

  return { count, dataSize, entries, bodyOffset, hasDigest };
}
