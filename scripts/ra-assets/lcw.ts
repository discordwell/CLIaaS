/**
 * LCW decompression — ported from RA/lcwuncmp.cpp
 *
 * Command codes:
 *   0xxxyyyy,yyyyyyyy    — short copy back y bytes, run x+3 from dest
 *   10xxxxxx,n1..nx+1    — medium copy x+1 bytes from source
 *   10000000              — end of data
 *   11xxxxxx,w1           — medium copy from dest x+3 bytes at offset w1
 *   11111110,w1,b1        — long run of byte b1 for w1 bytes
 *   11111111,w1,w2        — long copy from dest w1 bytes at offset w2
 */

export function lcwDecompress(
  source: Uint8Array,
  dest: Uint8Array,
  destLength: number
): number {
  let sp = 0;
  let dp = 0;
  const destEnd = destLength;

  while (dp < destEnd) {
    const opCode = source[sp++];

    if (!(opCode & 0x80)) {
      // Short copy from destination (back-reference)
      let count = (opCode >> 4) + 3;
      if (count > destEnd - dp) count = destEnd - dp;
      if (!count) return dp;

      const offset = source[sp++] + ((opCode & 0x0f) << 8);
      let cp = dp - offset;
      while (count-- > 0) dest[dp++] = dest[cp++];
    } else {
      if (!(opCode & 0x40)) {
        if (opCode === 0x80) {
          // End of data
          return dp;
        } else {
          // Medium copy from source (literal bytes)
          let count = opCode & 0x3f;
          while (count-- > 0) dest[dp++] = source[sp++];
        }
      } else {
        if (opCode === 0xfe) {
          // Long run (fill)
          let count = source[sp] + (source[sp + 1] << 8);
          const data = source[sp + 2];
          sp += 3;
          if (count > destEnd - dp) count = destEnd - dp;
          while (count-- > 0) dest[dp++] = data;
        } else if (opCode === 0xff) {
          // Long copy from destination (absolute back-reference)
          let count = source[sp] + (source[sp + 1] << 8);
          let cp = source[sp + 2] + (source[sp + 3] << 8);
          sp += 4;
          while (count-- > 0) dest[dp++] = dest[cp++];
        } else {
          // Medium copy from destination (absolute back-reference)
          let count = (opCode & 0x3f) + 3;
          let cp = source[sp] + (source[sp + 1] << 8);
          sp += 2;
          while (count-- > 0) dest[dp++] = dest[cp++];
        }
      }
    }
  }

  return dp;
}
