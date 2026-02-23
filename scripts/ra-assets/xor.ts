/**
 * Westwood XOR Delta decompression (a.k.a. "Format 40").
 *
 * This mutates `dest` in-place by applying XOR commands from `source`.
 * Used by TD/RA SHP delta frames and WSA animations.
 */

export function xorDeltaApply(
  source: Uint8Array,
  dest: Uint8Array,
  destLength: number
): number {
  let sp = 0;
  let dp = 0;
  const end = Math.min(destLength, dest.length);

  while (sp < source.length && dp < end) {
    const cmd = source[sp++];

    // Bit7=1: skip/big commands
    if ((cmd & 0x80) !== 0) {
      if (cmd !== 0x80) {
        // Short skip: 1xxxxxxx
        dp = Math.min(end, dp + (cmd & 0x7f));
        continue;
      }

      // 0x80-prefixed big command.
      if (sp + 1 >= source.length) break;
      let count = source[sp] | (source[sp + 1] << 8);
      sp += 2;

      // 0x80 00 00 terminator
      if (count === 0) break;

      const type = (count & 0xc000) >>> 14;
      if (type === 0 || type === 1) {
        // Long skip
        dp = Math.min(end, dp + count);
      } else if (type === 2) {
        // Long XOR with source bytes
        count &= 0x3fff;
        while (count-- > 0 && dp < end && sp < source.length) {
          dest[dp++] ^= source[sp++];
        }
      } else {
        // Long XOR with repeated value
        count &= 0x3fff;
        if (sp >= source.length) break;
        const value = source[sp++];
        while (count-- > 0 && dp < end) {
          dest[dp++] ^= value;
        }
      }

      continue;
    }

    // Bit7=0: short XOR commands
    let count = cmd;
    if (count === 0) {
      // Long XOR with repeated value: 00 <count> <value>
      if (sp + 1 >= source.length) break;
      count = source[sp++];
      const value = source[sp++];
      while (count-- > 0 && dp < end) {
        dest[dp++] ^= value;
      }
    } else {
      // Short XOR with source bytes
      while (count-- > 0 && dp < end && sp < source.length) {
        dest[dp++] ^= source[sp++];
      }
    }
  }

  return dp;
}
