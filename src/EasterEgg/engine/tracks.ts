/**
 * MV1: Track-table movement system — ported from C++ drive.cpp
 *
 * C++ RA uses pre-computed track tables for smooth vehicle turning.
 * 7 track types covering straight movement, 45°/90°/180° turns.
 * Each track is a sequence of {x, y, facing} coordinate offsets
 * defined in a North-facing reference frame.
 *
 * At runtime, offsets are rotated to the vehicle's actual facing via
 * `rotateTrackOffset()` — exact integer transforms for cardinal
 * directions, √2/2 scaling for diagonals (matching C++ coordinate
 * transform tables from drive.cpp).
 *
 * Infantry are exempt — they keep free-form moveToward() (FOOT speedClass).
 */

import { CELL_SIZE, SpeedClass } from './types';

/** A single step in a track: pixel offsets from cell center and desired facing (0-31 scale) */
export interface TrackStep {
  x: number;   // pixel X offset from cell origin
  y: number;   // pixel Y offset from cell origin
  facing: number; // 32-step facing index
}

/**
 * C++ drive.cpp track data — 7 tracks in North-facing reference frame.
 *
 * Track 0: straight ahead
 * Track 1: 45° right turn
 * Track 2: 45° left turn
 * Track 3: 90° right turn
 * Track 4: 90° left turn
 * Track 5: 180° U-turn right
 * Track 6: 180° U-turn left
 *
 * Coordinates are sub-cell offsets. In C++ these are leptons (0-255 per cell).
 * We scale to pixels: lepton * CELL_SIZE / 256.
 *
 * Other starting directions (E/S/W/diagonals) are derived by rotating
 * these North-reference tracks via `rotateTrackOffset()`.
 */

const LP = CELL_SIZE / 256; // lepton to pixel conversion factor

// Track 0: Straight movement (facing stays constant)
const TRACK_STRAIGHT: TrackStep[] = [
  { x: 0, y: -32 * LP, facing: 0 },
  { x: 0, y: -64 * LP, facing: 0 },
  { x: 0, y: -96 * LP, facing: 0 },
  { x: 0, y: -128 * LP, facing: 0 },
  { x: 0, y: -160 * LP, facing: 0 },
  { x: 0, y: -192 * LP, facing: 0 },
  { x: 0, y: -224 * LP, facing: 0 },
  { x: 0, y: -256 * LP, facing: 0 },
];

// Track 1: 45° right turn (N → NE) — gentle curve + straight extension to cell center
// Original C++ track ends at (128,-128) leptons = half a diagonal cell.
// Extended with NE straight-line steps to reach (256,-256) = full diagonal cell center.
const TRACK_45R: TrackStep[] = [
  { x: 4 * LP,   y: -30 * LP,  facing: 0 },
  { x: 12 * LP,  y: -58 * LP,  facing: 1 },
  { x: 24 * LP,  y: -84 * LP,  facing: 1 },
  { x: 40 * LP,  y: -108 * LP, facing: 2 },
  { x: 60 * LP,  y: -128 * LP, facing: 2 },
  { x: 84 * LP,  y: -148 * LP, facing: 3 },
  { x: 112 * LP, y: -164 * LP, facing: 3 },
  { x: 128 * LP, y: -128 * LP, facing: 4 },
  // Straight NE extension to reach diagonal cell center
  { x: 160 * LP, y: -160 * LP, facing: 4 },
  { x: 192 * LP, y: -192 * LP, facing: 4 },
  { x: 224 * LP, y: -224 * LP, facing: 4 },
  { x: 256 * LP, y: -256 * LP, facing: 4 },
];

// Track 2: 45° left turn (N → NW) — mirror of track 1 + straight extension to cell center
const TRACK_45L: TrackStep[] = [
  { x: -4 * LP,   y: -30 * LP,  facing: 0 },
  { x: -12 * LP,  y: -58 * LP,  facing: 31 },
  { x: -24 * LP,  y: -84 * LP,  facing: 31 },
  { x: -40 * LP,  y: -108 * LP, facing: 30 },
  { x: -60 * LP,  y: -128 * LP, facing: 30 },
  { x: -84 * LP,  y: -148 * LP, facing: 29 },
  { x: -112 * LP, y: -164 * LP, facing: 29 },
  { x: -128 * LP, y: -128 * LP, facing: 28 },
  // Straight NW extension to reach diagonal cell center
  { x: -160 * LP, y: -160 * LP, facing: 28 },
  { x: -192 * LP, y: -192 * LP, facing: 28 },
  { x: -224 * LP, y: -224 * LP, facing: 28 },
  { x: -256 * LP, y: -256 * LP, facing: 28 },
];

// Track 3: 90° right turn (N → E) — sharp curve with smoothed final approach
const TRACK_90R: TrackStep[] = [
  { x: 8 * LP,   y: -24 * LP,  facing: 0 },
  { x: 24 * LP,  y: -48 * LP,  facing: 2 },
  { x: 48 * LP,  y: -64 * LP,  facing: 4 },
  { x: 80 * LP,  y: -72 * LP,  facing: 5 },
  { x: 112 * LP, y: -72 * LP,  facing: 6 },
  { x: 144 * LP, y: -64 * LP,  facing: 7 },
  { x: 176 * LP, y: -48 * LP,  facing: 8 },
  { x: 216 * LP, y: -24 * LP,  facing: 8 },
  { x: 256 * LP, y: 0,         facing: 8 },
];

// Track 4: 90° left turn (N → W) — smoothed final approach
const TRACK_90L: TrackStep[] = [
  { x: -8 * LP,   y: -24 * LP,  facing: 0 },
  { x: -24 * LP,  y: -48 * LP,  facing: 30 },
  { x: -48 * LP,  y: -64 * LP,  facing: 28 },
  { x: -80 * LP,  y: -72 * LP,  facing: 27 },
  { x: -112 * LP, y: -72 * LP,  facing: 26 },
  { x: -144 * LP, y: -64 * LP,  facing: 25 },
  { x: -176 * LP, y: -48 * LP,  facing: 24 },
  { x: -216 * LP, y: -24 * LP,  facing: 24 },
  { x: -256 * LP, y: 0,         facing: 24 },
];

// Track 5: 180° U-turn right (N → S via E) — smoothed final approach
const TRACK_180R: TrackStep[] = [
  { x: 16 * LP,  y: -20 * LP,  facing: 2 },
  { x: 40 * LP,  y: -32 * LP,  facing: 4 },
  { x: 60 * LP,  y: -32 * LP,  facing: 8 },
  { x: 72 * LP,  y: -16 * LP,  facing: 10 },
  { x: 72 * LP,  y: 16 * LP,   facing: 14 },
  { x: 60 * LP,  y: 40 * LP,   facing: 16 },
  { x: 32 * LP,  y: 56 * LP,   facing: 16 },
  { x: 24 * LP,  y: 106 * LP,  facing: 16 },
  { x: 16 * LP,  y: 156 * LP,  facing: 16 },
  { x: 8 * LP,   y: 206 * LP,  facing: 16 },
  { x: 0,        y: 256 * LP,  facing: 16 },
];

// Track 6: 180° U-turn left (N → S via W) — smoothed final approach
const TRACK_180L: TrackStep[] = [
  { x: -16 * LP,  y: -20 * LP,  facing: 30 },
  { x: -40 * LP,  y: -32 * LP,  facing: 28 },
  { x: -60 * LP,  y: -32 * LP,  facing: 24 },
  { x: -72 * LP,  y: -16 * LP,  facing: 22 },
  { x: -72 * LP,  y: 16 * LP,   facing: 18 },
  { x: -60 * LP,  y: 40 * LP,   facing: 16 },
  { x: -32 * LP,  y: 56 * LP,   facing: 16 },
  { x: -24 * LP,  y: 106 * LP,  facing: 16 },
  { x: -16 * LP,  y: 156 * LP,  facing: 16 },
  { x: -8 * LP,   y: 206 * LP,  facing: 16 },
  { x: 0,         y: 256 * LP,  facing: 16 },
];

/** All 7 track types indexed by track number */
export const TRACKS: TrackStep[][] = [
  TRACK_STRAIGHT,  // 0: straight
  TRACK_45R,       // 1: 45° right
  TRACK_45L,       // 2: 45° left
  TRACK_90R,       // 3: 90° right
  TRACK_90L,       // 4: 90° left
  TRACK_180R,      // 5: 180° right
  TRACK_180L,      // 6: 180° left
];

/**
 * Select track number based on current facing and desired facing.
 * Both facings are in 32-step format (0-31).
 *
 * C++ drive.cpp selects tracks based on (currentFacing, desiredFacing) delta.
 * Compute angular difference in 32-step ring, pick appropriate track category.
 *
 * @returns track index (0-6)
 */
export function selectTrack(currentFacing32: number, desiredFacing32: number): number {
  if (currentFacing32 === desiredFacing32) return 0; // straight

  const diff = (desiredFacing32 - currentFacing32 + 32) % 32;
  const isRight = diff <= 16;
  const absDiff = isRight ? diff : (32 - diff);

  if (absDiff <= 4) {
    return isRight ? 1 : 2;   // 45° turn
  } else if (absDiff <= 12) {
    return isRight ? 3 : 4;   // 90° turn
  } else {
    return isRight ? 5 : 6;   // 180° turn
  }
}

/**
 * Rotate a North-reference track offset to match the vehicle's actual facing.
 *
 * C++ drive.cpp uses coordinate transform tables (not trig) to rotate track
 * data for each starting direction. We replicate this with exact integer
 * transforms for the 4 cardinal directions and √2/2 scaling for diagonals.
 *
 * Tracks always end at 8-dir facings (multiples of 4 in 32-step), so the
 * next track always starts at an exact 8-dir — no precision loss accumulates.
 *
 * @param x Track step X offset (North-reference)
 * @param y Track step Y offset (North-reference)
 * @param facing8 Vehicle's starting direction (0-7, from facing32 / 4)
 * @returns Rotated [rx, ry] in world coordinates
 */
const S = Math.SQRT2 / 2; // exact √2/2 = 0.7071067811865476

export function rotateTrackOffset(x: number, y: number, facing8: number): [number, number] {
  switch (facing8) {
    case 0: return [x, y];                          // N: identity
    case 1: return [(x - y) * S, (x + y) * S];     // NE: 45° CW
    case 2: return [-y, x];                         // E:  90° CW (exact)
    case 3: return [(-x - y) * S, (x - y) * S];    // SE: 135° CW
    case 4: return [-x, -y];                        // S:  180° (exact)
    case 5: return [(y - x) * S, (-x - y) * S];    // SW: 225° CW
    case 6: return [y, -x];                         // W:  270° CW (exact)
    case 7: return [(x + y) * S, (y - x) * S];     // NW: 315° CW
    default: return [x, y];
  }
}

/**
 * Check if an entity should use track-table movement.
 * Only non-infantry, non-aircraft ground/naval vehicles use tracks.
 */
export function usesTrackMovement(speedClass: SpeedClass, isInfantry: boolean, isAircraft: boolean): boolean {
  if (isInfantry || isAircraft) return false;
  return speedClass === SpeedClass.WHEEL || speedClass === SpeedClass.TRACK || speedClass === SpeedClass.FLOAT;
}
