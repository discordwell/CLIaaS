/**
 * Red Alert palette reader
 *
 * Palettes are 768 bytes: 256 RGB triplets.
 * VGA values are 6-bit (0-63). Red Alert's RGBClass exposes these to the
 * renderer as value << 2, so the maximum visible component is 252.
 */

export interface Palette {
  colors: Uint8Array; // 256 * 4 (RGBA)
}

export function parsePalette(data: Buffer): Palette {
  const colors = new Uint8Array(256 * 4);

  for (let i = 0; i < 256; i++) {
    // C++ RGBClass::{Red,Green,Blue}_Component: component << 2.
    const r6 = data[i * 3];
    const g6 = data[i * 3 + 1];
    const b6 = data[i * 3 + 2];

    colors[i * 4] = r6 << 2;
    colors[i * 4 + 1] = g6 << 2;
    colors[i * 4 + 2] = b6 << 2;
    if (i === 0) {
      // Index 0 = transparent background
      colors[i * 4 + 3] = 0;
    } else if (i === 4) {
      // Index 4 = LTGREEN shadow/remap marker. Preserve the palette RGB for
      // C++ fading-table lookups; alpha 130 is only a TS draw-time sentinel.
      colors[i * 4 + 3] = 130;
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
