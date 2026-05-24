/**
 * Westwood FNT bitmap font parser
 *
 * FNT file layout (from SDLLIB/include/font.h + drawbuff.cpp:590-720):
 *
 * Header (14 bytes):
 *   bytes 0-3:   magic/version
 *   bytes 4-5:   uint16 LE → offset to info block
 *   bytes 6-7:   uint16 LE → offset to offset block (per-char uint16 data offsets)
 *   bytes 8-9:   uint16 LE → offset to width block (per-char uint8 widths)
 *   bytes 10-11: uint16 LE → offset to data block
 *   bytes 12-13: uint16 LE → offset to height block (per-char uint16: low=topBlank, high=charHeight)
 *
 * Info block: byte +4 = maxHeight, byte +5 = maxWidth
 *
 * Glyph data: 4-bit packed nibbles (2 pixels per byte, low nibble first).
 * Nibble 0 = transparent/background, non-zero nibbles are font-palette
 * indices. Gradient/metal fonts rely on the exact nibble value.
 */

export interface FntGlyph {
  width: number;
  height: number;     // actual glyph rows (charHeight)
  topBlank: number;   // blank rows above glyph
  /** 4-bit font palette indices. 0=transparent. Width × height. */
  bitmap: Uint8Array;
}

export interface FntFont {
  maxWidth: number;
  maxHeight: number;
  glyphs: Map<number, FntGlyph>;  // charCode → glyph
}

export function parseFnt(data: Buffer): FntFont {
  const infoOff = data.readUInt16LE(4);
  const offsetOff = data.readUInt16LE(6);
  const widthOff = data.readUInt16LE(8);
  const heightOff = data.readUInt16LE(12);

  const maxHeight = data[infoOff + 4];
  const maxWidth = data[infoOff + 5];

  const glyphs = new Map<number, FntGlyph>();

  // Parse printable ASCII (32-127) + some extended chars
  for (let ch = 0; ch < 256; ch++) {
    if (widthOff + ch >= data.length) break;
    const charWidth = data[widthOff + ch];
    if (charWidth === 0) continue;

    if (offsetOff + ch * 2 + 1 >= data.length) continue;
    const charDataOff = data.readUInt16LE(offsetOff + ch * 2);
    if (heightOff + ch * 2 + 1 >= data.length) continue;
    const heightVal = data.readUInt16LE(heightOff + ch * 2);
    const topBlank = heightVal & 0xFF;
    const charHeight = (heightVal >> 8) & 0xFF;

    if (charHeight === 0) {
      glyphs.set(ch, { width: charWidth, height: 0, topBlank, bitmap: new Uint8Array(0) });
      continue;
    }
    if (charDataOff >= data.length) continue;

    // Decode 4-bit packed nibble data → font palette indices.
    const bitmap = new Uint8Array(charWidth * charHeight);
    let dataIdx = charDataOff;
    for (let y = 0; y < charHeight; y++) {
      for (let x = 0; x < charWidth; ) {
        if (dataIdx >= data.length) break;
        const byte = data[dataIdx++];

        // Low nibble = first pixel
        const lo = byte & 0x0F;
        bitmap[y * charWidth + x] = lo;
        x++;

        // High nibble = second pixel (if width allows)
        if (x < charWidth) {
          const hi = (byte >> 4) & 0x0F;
          bitmap[y * charWidth + x] = hi;
          x++;
        }
      }
    }

    glyphs.set(ch, { width: charWidth, height: charHeight, topBlank, bitmap });
  }

  return { maxWidth, maxHeight, glyphs };
}

/**
 * Generate a glyph atlas PNG data. Renders all glyphs into a grid with
 * indexed foreground on transparent background. RGB encodes the 4-bit font
 * palette index as index*17, while alpha remains an ordinary glyph mask.
 * Each glyph occupies maxWidth × maxHeight cells.
 *
 * Returns: { rgba, atlasWidth, atlasHeight, glyphMeta }
 * glyphMeta[charCode] = { x, y, width, height, topBlank }
 */
export function generateGlyphAtlas(font: FntFont): {
  rgba: Uint8Array;
  atlasWidth: number;
  atlasHeight: number;
  glyphMeta: Record<number, { ax: number; ay: number; w: number; h: number; topBlank: number }>;
} {
  const COLS = 16;
  const cellW = font.maxWidth;
  const cellH = font.maxHeight;
  const chars = Array.from(font.glyphs.keys()).sort((a, b) => a - b);
  const rows = Math.ceil(chars.length / COLS);
  const atlasWidth = COLS * cellW;
  const atlasHeight = rows * cellH;
  const rgba = new Uint8Array(atlasWidth * atlasHeight * 4);
  const glyphMeta: Record<number, { ax: number; ay: number; w: number; h: number; topBlank: number }> = {};

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const glyph = font.glyphs.get(ch)!;
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const ox = col * cellW;
    const oy = row * cellH;

    glyphMeta[ch] = { ax: ox, ay: oy, w: glyph.width, h: glyph.height, topBlank: glyph.topBlank };

    // Render glyph into atlas at correct vertical position
    for (let gy = 0; gy < glyph.height; gy++) {
      for (let gx = 0; gx < glyph.width; gx++) {
        const fontIndex = glyph.bitmap[gy * glyph.width + gx];
        if (fontIndex) {
          const px = ox + gx;
          const py = oy + glyph.topBlank + gy;
          const idx = (py * atlasWidth + px) * 4;
          const encoded = fontIndex * 17;
          rgba[idx] = encoded;
          rgba[idx + 1] = encoded;
          rgba[idx + 2] = encoded;
          rgba[idx + 3] = 255; // A
        }
      }
    }
  }

  return { rgba, atlasWidth, atlasHeight, glyphMeta };
}
