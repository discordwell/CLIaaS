/**
 * MV1: Track-table movement system — ported from C++ drive.cpp
 *
 * C++ RA uses pre-computed track tables for smooth vehicle turning.
 * 13 track types covering straight movement, 45°/90°/180° turns.
 * Each track is a sequence of {x, y, facing} coordinate offsets.
 *
 * Infantry are exempt — they keep free-form moveToward() (FOOT speedClass).
 */

import { type WorldPos, CELL_SIZE, SpeedClass } from './types';

/** A single step in a track: pixel offsets from cell center and desired facing (0-31 scale) */
export interface TrackStep {
  x: number;   // pixel X offset from cell origin
  y: number;   // pixel Y offset from cell origin
  facing: number; // 32-step facing index
}

/**
 * C++ drive.cpp track data — 13 tracks covering all turn types.
 * Track 0: straight ahead
 * Tracks 1-4: 45° turns (slight curve)
 * Tracks 5-8: 90° turns (sharp curve)
 * Tracks 9-12: 180° U-turns
 *
 * Coordinates are sub-cell offsets. In C++ these are leptons (0-255 per cell).
 * We scale to pixels: lepton * CELL_SIZE / 256.
 *
 * The tracks were derived from the C++ DriveClass track tables in drive.cpp.
 * Simplified to 8-step sequences (C++ has variable-length) for tractability.
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

// Track 1: 45° right turn (N → NE) — gentle curve
const TRACK_45R: TrackStep[] = [
  { x: 4 * LP,   y: -30 * LP,  facing: 0 },
  { x: 12 * LP,  y: -58 * LP,  facing: 1 },
  { x: 24 * LP,  y: -84 * LP,  facing: 1 },
  { x: 40 * LP,  y: -108 * LP, facing: 2 },
  { x: 60 * LP,  y: -128 * LP, facing: 2 },
  { x: 84 * LP,  y: -148 * LP, facing: 3 },
  { x: 112 * LP, y: -164 * LP, facing: 3 },
  { x: 128 * LP, y: -128 * LP, facing: 4 }, // normalized to NE cell
];

// Track 2: 45° left turn (N → NW) — mirror of track 1
const TRACK_45L: TrackStep[] = [
  { x: -4 * LP,   y: -30 * LP,  facing: 0 },
  { x: -12 * LP,  y: -58 * LP,  facing: 31 },
  { x: -24 * LP,  y: -84 * LP,  facing: 31 },
  { x: -40 * LP,  y: -108 * LP, facing: 30 },
  { x: -60 * LP,  y: -128 * LP, facing: 30 },
  { x: -84 * LP,  y: -148 * LP, facing: 29 },
  { x: -112 * LP, y: -164 * LP, facing: 29 },
  { x: -128 * LP, y: -128 * LP, facing: 28 }, // NW cell
];

// Track 3: 45° right (E → SE)
const TRACK_45R_E: TrackStep[] = [
  { x: 30 * LP,  y: 4 * LP,   facing: 8 },
  { x: 58 * LP,  y: 12 * LP,  facing: 9 },
  { x: 84 * LP,  y: 24 * LP,  facing: 9 },
  { x: 108 * LP, y: 40 * LP,  facing: 10 },
  { x: 128 * LP, y: 60 * LP,  facing: 10 },
  { x: 148 * LP, y: 84 * LP,  facing: 11 },
  { x: 164 * LP, y: 112 * LP, facing: 11 },
  { x: 128 * LP, y: 128 * LP, facing: 12 },
];

// Track 4: 45° left (E → NE)
const TRACK_45L_E: TrackStep[] = [
  { x: 30 * LP,  y: -4 * LP,   facing: 8 },
  { x: 58 * LP,  y: -12 * LP,  facing: 7 },
  { x: 84 * LP,  y: -24 * LP,  facing: 7 },
  { x: 108 * LP, y: -40 * LP,  facing: 6 },
  { x: 128 * LP, y: -60 * LP,  facing: 6 },
  { x: 148 * LP, y: -84 * LP,  facing: 5 },
  { x: 164 * LP, y: -112 * LP, facing: 5 },
  { x: 128 * LP, y: -128 * LP, facing: 4 },
];

// Track 5: 90° right turn (N → E)
const TRACK_90R: TrackStep[] = [
  { x: 8 * LP,   y: -24 * LP,  facing: 0 },
  { x: 24 * LP,  y: -48 * LP,  facing: 2 },
  { x: 48 * LP,  y: -64 * LP,  facing: 4 },
  { x: 80 * LP,  y: -72 * LP,  facing: 5 },
  { x: 112 * LP, y: -72 * LP,  facing: 6 },
  { x: 144 * LP, y: -64 * LP,  facing: 7 },
  { x: 176 * LP, y: -48 * LP,  facing: 8 },
  { x: 256 * LP, y: 0,         facing: 8 }, // arrived at E cell
];

// Track 6: 90° left turn (N → W)
const TRACK_90L: TrackStep[] = [
  { x: -8 * LP,   y: -24 * LP,  facing: 0 },
  { x: -24 * LP,  y: -48 * LP,  facing: 30 },
  { x: -48 * LP,  y: -64 * LP,  facing: 28 },
  { x: -80 * LP,  y: -72 * LP,  facing: 27 },
  { x: -112 * LP, y: -72 * LP,  facing: 26 },
  { x: -144 * LP, y: -64 * LP,  facing: 25 },
  { x: -176 * LP, y: -48 * LP,  facing: 24 },
  { x: -256 * LP, y: 0,         facing: 24 }, // arrived at W cell
];

// Track 7: 90° right (E → S)
const TRACK_90R_E: TrackStep[] = [
  { x: 24 * LP,  y: 8 * LP,   facing: 8 },
  { x: 48 * LP,  y: 24 * LP,  facing: 10 },
  { x: 64 * LP,  y: 48 * LP,  facing: 12 },
  { x: 72 * LP,  y: 80 * LP,  facing: 13 },
  { x: 72 * LP,  y: 112 * LP, facing: 14 },
  { x: 64 * LP,  y: 144 * LP, facing: 15 },
  { x: 48 * LP,  y: 176 * LP, facing: 16 },
  { x: 0,        y: 256 * LP, facing: 16 },
];

// Track 8: 90° left (E → N)
const TRACK_90L_E: TrackStep[] = [
  { x: 24 * LP,  y: -8 * LP,   facing: 8 },
  { x: 48 * LP,  y: -24 * LP,  facing: 6 },
  { x: 64 * LP,  y: -48 * LP,  facing: 4 },
  { x: 72 * LP,  y: -80 * LP,  facing: 3 },
  { x: 72 * LP,  y: -112 * LP, facing: 2 },
  { x: 64 * LP,  y: -144 * LP, facing: 1 },
  { x: 48 * LP,  y: -176 * LP, facing: 0 },
  { x: 0,        y: -256 * LP, facing: 0 },
];

// Track 9: 180° U-turn right (N → S via E)
const TRACK_180R: TrackStep[] = [
  { x: 16 * LP,  y: -20 * LP,  facing: 2 },
  { x: 40 * LP,  y: -32 * LP,  facing: 4 },
  { x: 60 * LP,  y: -32 * LP,  facing: 8 },
  { x: 72 * LP,  y: -16 * LP,  facing: 10 },
  { x: 72 * LP,  y: 16 * LP,   facing: 14 },
  { x: 60 * LP,  y: 40 * LP,   facing: 16 },
  { x: 32 * LP,  y: 56 * LP,   facing: 16 },
  { x: 0,        y: 256 * LP,  facing: 16 },
];

// Track 10: 180° U-turn left (N → S via W)
const TRACK_180L: TrackStep[] = [
  { x: -16 * LP,  y: -20 * LP,  facing: 30 },
  { x: -40 * LP,  y: -32 * LP,  facing: 28 },
  { x: -60 * LP,  y: -32 * LP,  facing: 24 },
  { x: -72 * LP,  y: -16 * LP,  facing: 22 },
  { x: -72 * LP,  y: 16 * LP,   facing: 18 },
  { x: -60 * LP,  y: 40 * LP,   facing: 16 },
  { x: -32 * LP,  y: 56 * LP,   facing: 16 },
  { x: 0,         y: 256 * LP,  facing: 16 },
];

// Track 11: 180° U-turn right (E → W via S)
const TRACK_180R_E: TrackStep[] = [
  { x: 20 * LP,  y: 16 * LP,   facing: 10 },
  { x: 32 * LP,  y: 40 * LP,   facing: 12 },
  { x: 32 * LP,  y: 60 * LP,   facing: 16 },
  { x: 16 * LP,  y: 72 * LP,   facing: 18 },
  { x: -16 * LP, y: 72 * LP,   facing: 22 },
  { x: -40 * LP, y: 60 * LP,   facing: 24 },
  { x: -56 * LP, y: 32 * LP,   facing: 24 },
  { x: -256 * LP, y: 0,        facing: 24 },
];

// Track 12: 180° U-turn left (E → W via N)
const TRACK_180L_E: TrackStep[] = [
  { x: 20 * LP,  y: -16 * LP,  facing: 6 },
  { x: 32 * LP,  y: -40 * LP,  facing: 4 },
  { x: 32 * LP,  y: -60 * LP,  facing: 0 },
  { x: 16 * LP,  y: -72 * LP,  facing: 30 },
  { x: -16 * LP, y: -72 * LP,  facing: 26 },
  { x: -40 * LP, y: -60 * LP,  facing: 24 },
  { x: -56 * LP, y: -32 * LP,  facing: 24 },
  { x: -256 * LP, y: 0,        facing: 24 },
];

/** All 13 track types indexed by track number */
export const TRACKS: TrackStep[][] = [
  TRACK_STRAIGHT,  // 0: straight
  TRACK_45R,       // 1: 45° right
  TRACK_45L,       // 2: 45° left
  TRACK_45R_E,     // 3: 45° right (E-axis)
  TRACK_45L_E,     // 4: 45° left (E-axis)
  TRACK_90R,       // 5: 90° right
  TRACK_90L,       // 6: 90° left
  TRACK_90R_E,     // 7: 90° right (E-axis)
  TRACK_90L_E,     // 8: 90° left (E-axis)
  TRACK_180R,      // 9: 180° right
  TRACK_180L,      // 10: 180° left
  TRACK_180R_E,    // 11: 180° right (E-axis)
  TRACK_180L_E,    // 12: 180° left (E-axis)
];

/**
 * Select track number based on current facing and desired facing.
 * Both facings are in 32-step format (0-31).
 *
 * C++ drive.cpp selects tracks based on (currentFacing, desiredFacing) delta.
 * We simplify: compute angular difference in 32-step ring, pick appropriate track category.
 *
 * @returns track index (0-12), or -1 if no turn needed (same facing)
 */
export function selectTrack(currentFacing32: number, desiredFacing32: number): number {
  if (currentFacing32 === desiredFacing32) return 0; // straight

  const diff = (desiredFacing32 - currentFacing32 + 32) % 32;
  const isRight = diff <= 16;
  const absDiff = isRight ? diff : (32 - diff);

  // Classify by turn magnitude
  if (absDiff <= 4) {
    // 45° turn (1-4 steps in 32-ring ≈ 11-45°)
    return isRight ? 1 : 2;
  } else if (absDiff <= 12) {
    // 90° turn (5-12 steps ≈ 56-135°)
    return isRight ? 5 : 6;
  } else {
    // 180° turn (13-16 steps ≈ 146-180°)
    return isRight ? 9 : 10;
  }
}

/**
 * Check if an entity should use track-table movement.
 * Only non-infantry, non-aircraft ground/naval vehicles use tracks.
 */
export function usesTrackMovement(speedClass: SpeedClass, isInfantry: boolean, isAircraft: boolean): boolean {
  // Infantry keep free-form moveToward (FOOT speedClass)
  if (isInfantry || isAircraft) return false;
  // All ground vehicles (WHEEL/TRACK) and naval (FLOAT) use tracks
  return speedClass === SpeedClass.WHEEL || speedClass === SpeedClass.TRACK || speedClass === SpeedClass.FLOAT;
}
