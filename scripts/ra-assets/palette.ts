/**
 * Red Alert palette reader
 *
 * Palettes are 768 bytes: 256 RGB triplets.
 * VGA values are 6-bit (0-63), need conversion to 8-bit (0-255).
 */

export interface Palette {
  colors: Uint8Array; // 256 * 4 (RGBA)
}

export function parsePalette(data: Buffer): Palette {
  const colors = new Uint8Array(256 * 4);

  for (let i = 0; i < 256; i++) {
    // 6-bit VGA to 8-bit: (val << 2) | (val >> 4)
    const r6 = data[i * 3];
    const g6 = data[i * 3 + 1];
    const b6 = data[i * 3 + 2];

    colors[i * 4] = (r6 << 2) | (r6 >> 4);
    colors[i * 4 + 1] = (g6 << 2) | (g6 >> 4);
    colors[i * 4 + 2] = (b6 << 2) | (b6 >> 4);
    if (i === 0) {
      // Index 0 = transparent background
      colors[i * 4 + 3] = 0;
    } else if (i === 4) {
      // Index 4 = shadow pixel (C++ SHAPE_GHOST / UnitShadow).
      // C++ blends background toward BLACK at ~50% (UShadowCols: LTGREEN→BLACK,130/255).
      // Render as semi-transparent black so shadows show through terrain underneath.
      colors[i * 4] = 0;      // R
      colors[i * 4 + 1] = 0;  // G
      colors[i * 4 + 2] = 0;  // B
      colors[i * 4 + 3] = 130; // A — matches C++ translucency factor 130/255
    } else {
      colors[i * 4 + 3] = 255;
    }
  }

  return { colors };
}

/** Convert palette-indexed pixels to RGBA */
export function indexedToRGBA(
  indexed: Uint8Array,
  palette: Palette,
  width: number,
  height: number
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const idx = indexed[i];
    rgba[i * 4] = palette.colors[idx * 4];
    rgba[i * 4 + 1] = palette.colors[idx * 4 + 1];
    rgba[i * 4 + 2] = palette.colors[idx * 4 + 2];
    rgba[i * 4 + 3] = palette.colors[idx * 4 + 3];
  }
  return rgba;
}
