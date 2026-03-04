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
