/**
 * Shroud shadow lookup — faithful port of C++ DisplayClass::Cell_Shadow.
 *
 * 256-entry table maps 8-neighbor bitmask → SHADOW.SHP frame index.
 * Bit layout (clockwise from NW):
 *   NW=0x40 N=0x80 NE=0x01 W=0x20 E=0x02 SW=0x10 S=0x08 SE=0x04
 *
 * A bit is set when that neighbor is unmapped (visibility === 0).
 *
 * Return values:
 *  -1 → no shadow (all neighbors mapped)
 *  -2 → solid black (cell fully surrounded by unmapped)
 *  0–46 → SHADOW.SHP frame index for edge transition
 */

export const SHADOW_TABLE: Int8Array = new Int8Array([
  -1,33, 2, 2,34,37, 2, 2,  4,26, 6, 6, 4,26, 6, 6,
  35,45,17,17,38,41,17,17,  4,26, 6, 6, 4,26, 6, 6,
   8,21,10,10,27,31,10,10, 12,23,14,14,12,23,14,14,
   8,21,10,10,27,31,10,10, 12,23,14,14,12,23,14,14,

  32,36,25,25,44,40,25,25, 19,30,20,20,19,30,20,20,
  39,43,29,29,42,46,29,29, 19,30,20,20,19,30,20,20,
   8,21,10,10,27,31,10,10, 12,23,14,14,12,23,14,14,
   8,21,10,10,27,31,10,10, 12,23,14,14,12,23,14,14,

   1, 1, 3, 3,16,16, 3, 3,  5, 5, 7, 7, 5, 5, 7, 7,
  24,24,18,18,28,28,18,18,  5, 5, 7, 7, 5, 5, 7, 7,
   9, 9,11,11,22,22,11,11, 13,13,-2,-2,13,13,-2,-2,
   9, 9,11,11,22,22,11,11, 13,13,-2,-2,13,13,-2,-2,

   1, 1, 3, 3,16,16, 3, 3,  5, 5, 7, 7, 5, 5, 7, 7,
  24,24,18,18,28,28,18,18,  5, 5, 7, 7, 5, 5, 7, 7,
   9, 9,11,11,22,22,11,11, 13,13,-2,-2,13,13,-2,-2,
   9, 9,11,11,22,22,11,11, 13,13,-2,-2,13,13,-2,-2,
]);

/** Neighbor bit positions (C++ Cell_Shadow convention) */
export const SHADOW_BIT_NW = 0x40;
export const SHADOW_BIT_N  = 0x80;
export const SHADOW_BIT_NE = 0x01;
export const SHADOW_BIT_W  = 0x20;
export const SHADOW_BIT_E  = 0x02;
export const SHADOW_BIT_SW = 0x10;
export const SHADOW_BIT_S  = 0x08;
export const SHADOW_BIT_SE = 0x04;

/** Build 8-neighbor bitmask for shadow lookup.
 *  @param getVis - function returning visibility at (cx, cy): 0=shroud, 1=fog, 2=visible
 */
export function cellShadowIndex(
  cx: number, cy: number,
  getVis: (x: number, y: number) => number,
): number {
  let idx = 0;
  if (getVis(cx - 1, cy - 1) === 0) idx |= SHADOW_BIT_NW;
  if (getVis(cx,     cy - 1) === 0) idx |= SHADOW_BIT_N;
  if (getVis(cx + 1, cy - 1) === 0) idx |= SHADOW_BIT_NE;
  if (getVis(cx - 1, cy    ) === 0) idx |= SHADOW_BIT_W;
  if (getVis(cx + 1, cy    ) === 0) idx |= SHADOW_BIT_E;
  if (getVis(cx - 1, cy + 1) === 0) idx |= SHADOW_BIT_SW;
  if (getVis(cx,     cy + 1) === 0) idx |= SHADOW_BIT_S;
  if (getVis(cx + 1, cy + 1) === 0) idx |= SHADOW_BIT_SE;
  return idx;
}

export const RA_COLOR_BLACK = 12;
export const RA_COLOR_DKGREY = 13;
export const RA_COLOR_LTGREY = 14;
export const RA_COLOR_YELLOW = 5;
export const RA_COLOR_WHITE = 15;
export const RA_COLOR_WHITE_PLUS_ONE = 16;
export const RA_SHADOW_RANGE_START = 240;
export const RA_SHADOW_RANGE_END = 254;

function colorDifference(a: readonly number[], b: readonly number[]): number {
  const r = a[0] - b[0];
  const g = a[1] - b[1];
  const bl = a[2] - b[2];
  return r * r + g * g + bl * bl;
}

function paletteGun(component: number): number {
  return (component & 0xff) >> 2;
}

function paletteGuns(color: readonly number[]): number[] {
  return [paletteGun(color[0]), paletteGun(color[1]), paletteGun(color[2])];
}

/** C++ RGBClass::Adjust(ratio, dest): move raw 0..63 palette guns toward dest by ratio/256. */
function adjustGunColorToward(source: readonly number[], dest: readonly number[], ratio: number): number[] {
  const frac = ratio & 0xFF;
  return [
    source[0] + Math.trunc(((dest[0] - source[0]) * frac) / 256),
    source[1] + Math.trunc(((dest[1] - source[1]) * frac) / 256),
    source[2] + Math.trunc(((dest[2] - source[2]) * frac) / 256),
  ];
}

/** C++ SDLLIB/misc.cpp Fade_Gun byte math used by Build_Fading_Table. */
function fadeGun(orig: number, target: number, frac: number): number {
  const clampedFrac = frac > 255 ? 255 : frac;
  const delta = (orig & 0xff) - (target & 0xff);
  const product16 = (delta * (clampedFrac >> 1)) & 0xffff;
  const doubled16 = (product16 << 1) & 0xffff;
  const highByte = (doubled16 >> 8) & 0xff;
  return ((orig & 0xff) - highByte) & 0xff;
}

/** Faithful port of RA/jshell.cpp Conquer_Build_Fading_Table. */
export function conquerBuildFadingTable(
  palette: readonly (readonly number[])[],
  destColorIndex: number,
  frac: number,
): Uint8Array {
  const table = new Uint8Array(256);
  const dest = paletteGuns(palette[destColorIndex] ?? [0, 0, 0, 255]);

  for (let index = 0; index < 256; index++) {
    if (index > 256 - 16 || index === 0) {
      table[index] = index;
      continue;
    }

    const tryColor = adjustGunColorToward(paletteGuns(palette[index] ?? [0, 0, 0, 255]), dest, frac);
    let best = RA_SHADOW_RANGE_START;
    let bestValue = Number.POSITIVE_INFINITY;
    for (let id = RA_SHADOW_RANGE_START; id < 256 - 1; id++) {
      const diff = colorDifference(paletteGuns(palette[id] ?? [0, 0, 0, 255]), tryColor);
      if (diff < bestValue) {
        best = id;
        bestValue = diff;
      }
    }
    table[index] = best;
  }

  return table;
}

/** Faithful port of SDLLIB/misc.cpp Build_Fading_Table.
 * Transparent black slot 0 never remaps. Every other source palette slot fades
 * toward `destColorIndex`, then searches palette slots 1..255 for the closest
 * raw 0..63 palette-gun match, excluding the source slot itself. */
export function makeFadingTable(
  palette: readonly (readonly number[])[],
  destColorIndex: number,
  frac: number,
): Uint8Array {
  const table = new Uint8Array(256);
  const dest = paletteGuns(palette[destColorIndex] ?? [0, 0, 0, 255]);
  table[0] = 0;

  for (let index = 1; index < 256; index++) {
    const orig = paletteGuns(palette[index] ?? [0, 0, 0, 255]);
    const ideal = [
      fadeGun(orig[0], dest[0], frac),
      fadeGun(orig[1], dest[1], frac),
      fadeGun(orig[2], dest[2], frac),
    ];
    let best = destColorIndex;
    let bestValue = Number.POSITIVE_INFINITY;

    for (let colorIndex = 1; colorIndex < Math.min(256, palette.length); colorIndex++) {
      if (colorIndex === index) continue;
      const color = palette[colorIndex];
      if (!color) continue;
      const diff = colorDifference(paletteGuns(color), ideal);
      if (diff === 0) {
        best = colorIndex;
        break;
      }
      if (diff < bestValue) {
        best = colorIndex;
        bestValue = diff;
      }
    }

    table[index] = best;
  }

  return table;
}

export function nearestPaletteIndex(
  palette: readonly (readonly number[])[],
  r: number,
  g: number,
  b: number,
): number {
  let best = 0;
  let bestValue = Number.POSITIVE_INFINITY;
  for (let i = 0; i < Math.min(256, palette.length); i++) {
    const color = palette[i];
    if (!color || color[3] === 0 || color[3] === 130) continue;
    const diff = colorDifference(color, [r, g, b]);
    if (diff < bestValue) {
      best = i;
      bestValue = diff;
      if (diff === 0) break;
    }
  }
  return best;
}

/** C++ display.cpp builds ShadowTrans from:
 *   {WHITE+1->BLACK,130}, {WHITE->BLACK,170}, {LTGRAY->BLACK,250}, {DKGRAY->BLACK,250}.
 * SHADOW.SHP is extracted through the RA palette, so the renderer matches
 * those source control pixels by their RGB values and then remaps the already
 * drawn destination pixel through the corresponding Build_Fading_Table row. */
export function shadowTransFadeForRGBA(r: number, g: number, b: number, a: number): number | null {
  if (a === 0) return null;
  if (r === 16 && g === 12 && b === 12) return 130;  // WHITE+1 palette slot.
  if ((r === 252 && g === 252 && b === 252) || (r === 255 && g === 255 && b === 255)) return 170;
  if ((r === 168 && g === 168 && b === 168) || (r === 170 && g === 170 && b === 170)) return 250;
  if ((r === 84 && g === 84 && b === 84) || (r === 85 && g === 85 && b === 85)) return 250;
  return null;
}

export function shadowGhostRemapColor(
  palette: readonly (readonly number[])[],
  destR: number,
  destG: number,
  destB: number,
  srcR: number,
  srcG: number,
  srcB: number,
  srcA: number,
): [number, number, number, number] | null {
  const frac = shadowTransFadeForRGBA(srcR, srcG, srcB, srcA);
  if (frac === null) return null;
  const table = makeFadingTable(palette, RA_COLOR_BLACK, frac);
  const destIndex = nearestPaletteIndex(palette, destR, destG, destB);
  const remapped = palette[table[destIndex]];
  if (!remapped) return null;
  return [remapped[0], remapped[1], remapped[2], 255];
}
