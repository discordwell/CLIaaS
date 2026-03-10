/**
 * MV1: Track-table movement system — faithfully ported from C++ drive.cpp
 *
 * C++ RA uses pre-computed track tables for smooth vehicle turning.
 * 13 base tracks, each a sequence of {COORDINATE offset, DirType facing} steps.
 * Offsets are in leptons (256 per cell) relative to Head_To_Coord (target cell center).
 * Each step represents ~1 pixel of movement (PIXEL_LEPTON_W ≈ 10.67 leptons).
 *
 * TrackControl[67] maps (currentFacing8 × 8 + nextFacing8) to the appropriate
 * track + transformation flags. Smooth_Turn applies F_T/F_X/F_Y flag transforms
 * to adapt base tracks for all 8 starting directions.
 *
 * Tracks 1-2: straight (cardinal/diagonal), single cell
 * Tracks 3-6: long 2-cell curves (used when at speed with track jumping)
 * Tracks 7-10: short 1-cell curves (used when starting from rest)
 * Tracks 11-13: harvester/factory special purpose
 *
 * We use short tracks (StartTrack) for turns — this is what C++ does when
 * vehicles start driving. Infantry are exempt (FOOT speedClass).
 */

import { CELL_SIZE, SpeedClass } from './types';

// === Constants ===

/** Lepton-to-pixel conversion factor: 24px / 256 leptons = 0.09375 px/lepton */
export const LP = CELL_SIZE / 256;

/** C++ PIXEL_LEPTON_W = CELL_LEPTON_W / ICON_PIXEL_W = 256/24 = 10 (integer division) */
export const PIXEL_LEPTON_W = Math.floor(256 / CELL_SIZE);

// TrackControl flag constants (C++ drive.h)
export const F_  = 0x00; // No transformation
export const F_T = 0x01; // Transpose X and Y components
export const F_X = 0x02; // Reverse X component sign
export const F_Y = 0x04; // Reverse Y component sign
export const F_D = 0x08; // Two-cell consumption (use StartTrack for single-cell)

// C++ DirType constants (0-255 direction system)
const DIR_N  = 0;
const DIR_NE = 32;
const DIR_E  = 64;
const DIR_SE = 96;
const DIR_S  = 128;
const DIR_SW = 160;
const DIR_SW_X1 = 152;
const DIR_SW_X2 = 144;
const DIR_W  = 192;
const DIR_NW = 224;

// === Track Step Type ===

/** A single step in a C++ track: lepton offsets from target cell center + DirType facing */
export interface TrackStep {
  x: number;      // X offset in leptons from target cell center (signed)
  y: number;      // Y offset in leptons from target cell center (signed)
  facing: number; // DirType (0-255)
}

// === Coordinate Decoding ===

/** Decode C++ packed COORDINATE 0xYYYYXXXX to signed lepton offsets */
function decodeCoord(packed: number): [number, number] {
  // Low 16 bits = X, High 16 bits = Y (little-endian COORD_COMPOSITE)
  let x = packed & 0xFFFF;
  let y = (packed >>> 16) & 0xFFFF;
  // Sign-extend 16-bit values
  if (x > 0x7FFF) x -= 0x10000;
  if (y > 0x7FFF) y -= 0x10000;
  return [x, y];
}

/** Build TrackStep array from C++ hex data: [packedCoord, dirType][] */
function buildTrack(data: readonly (readonly [number, number])[]): TrackStep[] {
  return data.map(([packed, dir]) => {
    const [x, y] = decodeCoord(packed);
    return { x, y, facing: dir };
  });
}

// === C++ Track Data (exact hex values from DRIVE.CPP) ===

// Track 1: Straight N movement (24 steps)
const Track1 = buildTrack([
  [0x00F50000, 0], [0x00EA0000, 0], [0x00DF0000, 0], [0x00D40000, 0],
  [0x00C90000, 0], [0x00BE0000, 0], [0x00B30000, 0], [0x00A80000, 0],
  [0x009D0000, 0], [0x00920000, 0], [0x00870000, 0], [0x007C0000, 0],
  [0x00710000, 0], [0x00660000, 0], [0x005B0000, 0], [0x00500000, 0],
  [0x00450000, 0], [0x003A0000, 0], [0x002F0000, 0], [0x00240000, 0],
  [0x00190000, 0], [0x000E0000, 0], [0x00030000, 0], [0x00000000, 0],
]);

// Track 2: Straight NE diagonal (32 steps)
const Track2 = buildTrack([
  [0x00F8FF08, DIR_NE], [0x00F0FF10, DIR_NE], [0x00E8FF18, DIR_NE], [0x00E0FF20, DIR_NE],
  [0x00D8FF28, DIR_NE], [0x00D0FF30, DIR_NE], [0x00C8FF38, DIR_NE], [0x00C0FF40, DIR_NE],
  [0x00B8FF48, DIR_NE], [0x00B0FF50, DIR_NE], [0x00A8FF58, DIR_NE], [0x00A0FF60, DIR_NE],
  [0x0098FF68, DIR_NE], [0x0090FF70, DIR_NE], [0x0088FF78, DIR_NE], [0x0080FF80, DIR_NE],
  [0x0078FF88, DIR_NE], [0x0070FF90, DIR_NE], [0x0068FF98, DIR_NE], [0x0060FFA0, DIR_NE],
  [0x0058FFA8, DIR_NE], [0x0050FFB0, DIR_NE], [0x0048FFB8, DIR_NE], [0x0040FFC0, DIR_NE],
  [0x0038FFC8, DIR_NE], [0x0030FFD0, DIR_NE], [0x0028FFD8, DIR_NE], [0x0020FFE0, DIR_NE],
  [0x0018FFE8, DIR_NE], [0x0010FFF0, DIR_NE], [0x0008FFF8, DIR_NE], [0x00000000, DIR_NE],
]);

// Track 3: Long 2-cell N→NE curve (55 steps) — Jump@37, Entry@12, Cell@22
const Track3 = buildTrack([
  [0x01F5FF00, 0], [0x01EAFF00, 0], [0x01DFFF00, 0], [0x01D4FF00, 0],
  [0x01C9FF00, 0], [0x01BEFF00, 0], [0x01B3FF00, 0], [0x01A8FF00, 0],
  [0x019DFF00, 0], [0x0192FF00, 0], [0x0187FF00, 0], [0x0180FF00, 0],
  [0x0175FF00, 0],  // Entry@12
  [0x016BFF00, 0], [0x0160FF02, 1], [0x0155FF04, 3], [0x014CFF06, 4],
  [0x0141FF08, 5], [0x0137FF0B, 7], [0x012EFF0F, 8], [0x0124FF13, 9],
  [0x011AFF17, 11], [0x0110FF1B, 12],
  [0x0107FF1F, 13], // Cell@22
  [0x00FCFF24, 15], [0x00F3FF28, 16], [0x00ECFF2C, 17], [0x00E0FF32, 19],
  [0x00D7FF36, 20], [0x00CFFF3D, 21], [0x00C6FF42, 23], [0x00BAFF49, 24],
  [0x00B0FF4D, 25], [0x00A8FF58, 27], [0x00A0FF60, 28], [0x0098FF68, 29],
  [0x0090FF70, 31], [0x0088FF78, DIR_NE],
  [0x0080FF80, DIR_NE], // Jump@37
  [0x0078FF88, DIR_NE], [0x0070FF90, DIR_NE], [0x0068FF98, DIR_NE],
  [0x0060FFA0, DIR_NE], [0x0058FFA8, DIR_NE], [0x0050FFB0, DIR_NE],
  [0x0048FFB8, DIR_NE], [0x0040FFC0, DIR_NE], [0x0038FFC8, DIR_NE],
  [0x0030FFD0, DIR_NE], [0x0028FFD8, DIR_NE], [0x0020FFE0, DIR_NE],
  [0x0018FFE8, DIR_NE], [0x0010FFF0, DIR_NE], [0x0008FFF8, DIR_NE],
  [0x00000000, DIR_NE],
]);

// Track 4: Long 2-cell N→E curve (39 steps) — Jump@26, Entry@11, Cell@19
const Track4 = buildTrack([
  [0x00F5FF00, 0], [0x00EBFF00, 0], [0x00E0FF00, 0], [0x00D5FF00, 0],
  [0x00CBFF01, 0], [0x00C0FF03, 0], [0x00B5FF05, 1], [0x00ABFF07, 1],
  [0x00A0FF0A, 2], [0x0095FF0D, 3], [0x008BFF10, 4],
  [0x0080FF14, 5],  // Entry@11
  [0x0075FF18, 8], [0x006DFF1C, 12], [0x0063FF22, 16], [0x005AFF25, 20],
  [0x0052FF2B, 23], [0x0048FF32, 27], [0x0040FF37, DIR_NE],
  [0x0038FF3D, 36], [0x0030FF46, 39], [0x002BFF4F, 43], [0x0024FF58, 47],
  [0x0020FF60, 51], [0x001BFF6D, 54], [0x0017FF79, 57],
  [0x0014FF82, 60], // Jump@26
  [0x0011FF8F, 62], [0x000DFF98, 63], [0x0009FFA2, DIR_E],
  [0x0006FFAC, DIR_E], [0x0004FFB5, 66], [0x0003FFC0, DIR_E],
  [0x0002FFCB, DIR_E], [0x0001FFD5, DIR_E], [0x0000FFE0, DIR_E],
  [0x0000FFEB, DIR_E], [0x0000FFF5, DIR_E], [0x00000000, DIR_E],
]);

// Track 5: Long 2-cell large arc (61 steps) — Jump@45, Entry@15, Cell@31
const Track5 = buildTrack([
  [0xFFF8FE08, DIR_NE], [0xFFF0FE10, DIR_NE], [0xFFE8FE18, DIR_NE], [0xFFE0FE20, DIR_NE],
  [0xFFD8FE28, DIR_NE], [0xFFD0FE30, DIR_NE], [0xFFC8FE38, DIR_NE], [0xFFC0FE40, DIR_NE],
  [0xFFB8FE48, DIR_NE], [0xFFB0FE50, DIR_NE], [0xFFA8FE58, DIR_NE], [0xFFA0FE60, DIR_NE],
  [0xFF98FE68, DIR_NE], [0xFF90FE70, DIR_NE], [0xFF88FE78, DIR_NE],
  [0xFF80FE80, DIR_NE], // Entry@15
  [0xFF78FE88, DIR_NE], [0xFF71FE90, DIR_NE], [0xFF6AFE97, DIR_NE],
  [0xFF62FE9F, DIR_NE], [0xFF5AFEA8, DIR_NE], [0xFF53FEB0, 35],
  [0xFF4BFEB7, 38], [0xFF44FEBE, 41], [0xFF3EFEC4, 44],
  [0xFF39FECE, 47], [0xFF34FED8, 50], [0xFF30FEE0, 53],
  [0xFF2DFEEB, 56], [0xFF2CFEF5, 59], [0xFF2BFF00, 62],
  [0xFF2CFF0B, 66], // Cell@31
  [0xFF2DFF15, 69], [0xFF30FF1F, 72], [0xFF34FF28, 75],
  [0xFF39FF30, 78], [0xFF3EFF3A, 81], [0xFF44FF44, 84],
  [0xFF4BFF4B, 87], [0xFF53FF50, 90], [0xFF5AFF58, 93],
  [0xFF62FF60, DIR_SE], [0xFF6AFF68, DIR_SE], [0xFF71FF70, DIR_SE],
  [0xFF78FF78, DIR_SE],
  [0xFF80FF80, DIR_SE], // Jump@45
  [0xFF88FF88, DIR_SE], [0xFF90FF90, DIR_SE], [0xFF98FF98, DIR_SE],
  [0xFFA0FFA0, DIR_SE], [0xFFA8FFA8, DIR_SE], [0xFFB0FFB0, DIR_SE],
  [0xFFB8FFB8, DIR_SE], [0xFFC0FFC0, DIR_SE], [0xFFC8FFC8, DIR_SE],
  [0xFFD0FFD0, DIR_SE], [0xFFD8FFD8, DIR_SE], [0xFFE0FFE0, DIR_SE],
  [0xFFE8FFE8, DIR_SE], [0xFFF0FFF0, DIR_SE], [0xFFF8FFF8, DIR_SE],
  [0x00000000, DIR_SE],
]);

// Track 6: Long 2-cell turn (57 steps) — Jump@44, Entry@16, Cell@27
const Track6 = buildTrack([
  [0x0100FE00, DIR_NE], [0x00F8FE08, DIR_NE], [0x00F0FE10, DIR_NE], [0x00E8FE18, DIR_NE],
  [0x00E0FE20, DIR_NE], [0x00D8FE28, DIR_NE], [0x00D0FE30, DIR_NE], [0x00C8FE38, DIR_NE],
  [0x00C0FE40, DIR_NE], [0x00B8FE48, DIR_NE], [0x00B0FE50, DIR_NE], [0x00A8FE58, DIR_NE],
  [0x00A0FE60, DIR_NE], [0x0098FE68, DIR_NE], [0x0090FE70, DIR_NE], [0x0088FE78, DIR_NE],
  [0x0080FE80, DIR_NE], // Entry@16
  [0x0078FE88, DIR_NE], [0x0070FE90, DIR_NE], [0x0068FE98, DIR_NE],
  [0x0060FEA0, DIR_NE], [0x0058FEA8, DIR_NE], [0x0055FEAE, DIR_NE],
  [0x004EFEB8, 35], [0x0048FEC0, 37], [0x0042FEC9, 40],
  [0x003BFED2, 43],
  [0x0037FEDA, 45], // Cell@27
  [0x0032FEE3, 48], [0x002BFEEB, 51], [0x0026FEF5, 53],
  [0x0022FEFE, 56], [0x001CFF08, 59], [0x0019FF12, 61],
  [0x0015FF1B, DIR_E], [0x0011FF26, DIR_E], [0x000EFF30, DIR_E],
  [0x000BFF39, DIR_E], [0x0009FF43, DIR_E], [0x0007FF4E, DIR_E],
  [0x0005FF57, DIR_E], [0x0003FF62, DIR_E], [0x0001FF6D, DIR_E],
  [0x0000FF77, DIR_E],
  [0x0000FF80, DIR_E], // Jump@44
  [0x0000FF8B, DIR_E], [0x0000FF95, DIR_E], [0x0000FFA0, DIR_E],
  [0x0000FFAB, DIR_E], [0x0000FFB5, DIR_E], [0x0000FFC0, DIR_E],
  [0x0000FFCB, DIR_E], [0x0000FFD5, DIR_E], [0x0000FFE0, DIR_E],
  [0x0000FFEB, DIR_E], [0x0000FFF5, DIR_E], [0x00000000, DIR_E],
]);

// Track 7: Short 1-cell 45° curve (28 steps) — StartTrack for Track3
const Track7 = buildTrack([
  [0x0006FFFF, 0], [0x000CFFFE, 4], [0x0011FFFC, 8], [0x0018FFFA, 12],
  [0x001FFFF6, 16], [0x0024FFF3, 19], [0x002BFFF0, 22], [0x0030FFFD, 23],
  [0x0035FFEB, 24], [0x0038FFE8, 25], [0x003CFFE6, 26], [0x0040FFE3, 27],
  [0x0043FFE0, 28], [0x0046FFDD, 29], [0x0043FFDF, 30], [0x0040FFE1, 30],
  [0x003CFFE3, 30], [0x0038FFE5, 30], [0x0035FFE7, 31], [0x0030FFE9, 31],
  [0x002BFFEB, 31], [0x0024FFED, 31], [0x001FFFF1, 31], [0x0018FFF4, DIR_NE],
  [0x0011FFF7, DIR_NE], [0x000CFFFA, DIR_NE], [0x0006FFFD, DIR_NE],
  [0x00000000, DIR_NE],
]);

// Track 8: Short 1-cell tight curve (22 steps) — StartTrack for Track6
const Track8 = buildTrack([
  [0x0003FFFC, DIR_NE], [0x0006FFF7, 36], [0x000AFFF1, 40], [0x000CFFEB, 44],
  [0x000DFFE4, 46], [0x000EFFDC, 48], [0x000FFFD5, 50], [0x0010FFD0, 52],
  [0x0011FFC9, 54], [0x0012FFC2, 56], [0x0011FFC0, 58], [0x0010FFC2, 60],
  [0x000EFFC9, 62], [0x000CFFCF, DIR_E], [0x000AFFD5, DIR_E],
  [0x0008FFDA, DIR_E], [0x0006FFE2, DIR_E], [0x0004FFE9, DIR_E],
  [0x0002FFEF, DIR_E], [0x0001FFF5, DIR_E], [0x0000FFF9, DIR_E],
  [0x00000000, DIR_E],
]);

// Track 9: Short 1-cell 90° curve (31 steps) — StartTrack for Track4
const Track9 = buildTrack([
  [0xFFF50002, 0], [0xFFEB0004, 2], [0xFFE00006, 4], [0xFFD50009, 6],
  [0xFFCE000C, 9], [0xFFC8000F, 11], [0xFFC00012, 13], [0xFFB80015, 16],
  [0xFFC00012, 18], [0xFFC8000E, 20], [0xFFCE000A, 22], [0xFFD50004, 24],
  [0xFFDE0000, 26], [0xFFE9FFF8, 28], [0xFFEEFFF2, 30], [0xFFF5FFEB, DIR_NE],
  [0xFFFDFFE1, 34], [0x0002FFD8, 36], [0x0007FFD2, 39], [0x000BFFCB, 41],
  [0x0010FFC5, 43], [0x0013FFBE, 45], [0x0015FFB7, 48], [0x0013FFBE, 50],
  [0x0011FFC5, 52], [0x000BFFCC, 54], [0x0008FFD4, 56], [0x0005FFDF, 58],
  [0x0003FFEB, 62], [0x0001FFF5, DIR_E], [0x00000000, DIR_E],
]);

// Track 10: Short 1-cell large arc (28 steps) — StartTrack for Track5
const Track10 = buildTrack([
  [0xFFF6000B, DIR_NE], [0xFFF00015, 37], [0xFFEB0020, 42], [0xFFE9002B, 47],
  [0xFFE50032, 52], [0xFFE30038, 57], [0xFFE00040, 60], [0xFFE20038, 62],
  [0xFFE40032, DIR_E], [0xFFE5002A, 68], [0xFFE6001E, 70], [0xFFE70015, 72],
  [0xFFE8000B, 74], [0xFFE90000, 76], [0xFFE8FFF5, 78], [0xFFE7FFEB, 80],
  [0xFFE6FFE0, 82], [0xFFE5FFD5, 84], [0xFFE4FFCE, 86], [0xFFE2FFC5, 88],
  [0xFFE0FFC0, 90], [0xFFE3FFC5, 92], [0xFFE5FFCE, 94], [0xFFE9FFD5, 95],
  [0xFFEBFFE0, DIR_SE], [0xFFF0FFEB, DIR_SE], [0xFFF6FFF5, DIR_SE],
  [0x00000000, DIR_SE],
]);

// Track 11: Harvester backup into refinery (14 steps)
const Track11 = buildTrack([
  [0x01000000, DIR_SW], [0x00F30008, DIR_SW], [0x00E50010, DIR_SW_X1],
  [0x00D60018, DIR_SW_X1], [0x00C80020, DIR_SW_X1], [0x00B90028, DIR_SW_X1],
  [0x00AB0030, DIR_SW_X2], [0x009C0038, DIR_SW_X2], [0x008D0040, DIR_SW_X2],
  [0x007F0048, DIR_SW_X2], [0x00710050, DIR_SW_X2], [0x00640058, DIR_SW_X2],
  [0x00550060, DIR_SW_X2], [0x00000000, DIR_SW_X2],
]);

// Track 12: Drive back into refinery (13 steps)
const Track12 = buildTrack([
  [0xFF550060, DIR_SW_X2], [0xFF640058, DIR_SW_X2], [0xFF710050, DIR_SW_X2],
  [0xFF7F0048, DIR_SW_X2], [0xFF8D0040, DIR_SW_X2], [0xFF9C0038, DIR_SW_X2],
  [0xFFAB0030, DIR_SW_X2], [0xFFB90028, DIR_SW_X1], [0xFFC80020, DIR_SW_X1],
  [0xFFD60018, DIR_SW_X1], [0xFFE50010, DIR_SW_X1], [0xFFF30008, DIR_SW],
  [0x00000000, DIR_SW],
]);

// Track 13: Drive out of weapons factory (36 steps) — uses pixel coords converted to leptons
// XYP_COORD(0, y) = Pixel_To_Lepton(y) in Y, 0 in X. Pixel_To_Lepton(p) = (p*256+12)/24
const Track13 = buildTrack(
  Array.from({ length: 35 }, (_, i) => {
    const py = -(35 - i); // -35 to -1
    const ly = Math.floor((py * 256 + (py < 0 ? -12 : 12)) / 24); // C++ integer rounding
    return [(ly & 0xFFFF) << 16, DIR_S] as const;
  }).concat([[0x00000000, DIR_S]])
);

// === All 13 tracks indexed 0-12 (C++ uses 1-indexed: Track1=index 0) ===
export const TRACK_DATA: TrackStep[][] = [
  Track1, Track2, Track3, Track4, Track5, Track6,
  Track7, Track8, Track9, Track10, Track11, Track12, Track13,
];

// === RawTracks metadata (C++ DRIVE.CPP line 2239) ===

export interface RawTrackMeta {
  jump: number;  // Index where track jumping occurs (-1 = no jump)
  entry: number; // Entry point when jumping TO this track (0 = no entry)
  cell: number;  // Per-cell process index (-1 = none)
}

export const RAW_TRACKS: RawTrackMeta[] = [
  { jump: -1, entry: 0,  cell: -1 }, // Track 1
  { jump: -1, entry: 0,  cell: -1 }, // Track 2
  { jump: 37, entry: 12, cell: 22 }, // Track 3
  { jump: 26, entry: 11, cell: 19 }, // Track 4
  { jump: 45, entry: 15, cell: 31 }, // Track 5
  { jump: 44, entry: 16, cell: 27 }, // Track 6
  { jump: -1, entry: 0,  cell: -1 }, // Track 7
  { jump: -1, entry: 0,  cell: -1 }, // Track 8
  { jump: -1, entry: 0,  cell: -1 }, // Track 9
  { jump: -1, entry: 0,  cell: -1 }, // Track 10
  { jump: -1, entry: 0,  cell: -1 }, // Track 11
  { jump: -1, entry: 0,  cell: -1 }, // Track 12
  { jump: -1, entry: 0,  cell: -1 }, // Track 13
];

// === TrackControl table (C++ DRIVE.CPP line 2261) ===
// Index = currentFacing8 * 8 + nextFacing8
// track: C++ track number (1-13), 0 = impossible turn
// startTrack: short-track alternative number (0 = none)
// facing: end DirType (0-255)
// flag: F_T|F_X|F_Y|F_D combination

export interface TrackControlEntry {
  track: number;       // Track number (1-13, 0=invalid)
  startTrack: number;  // Short track for starting (0=use main track)
  facing: number;      // End DirType (0-255)
  flag: number;        // TrackControlType flags
}

export const TRACK_CONTROL: TrackControlEntry[] = [
  // Row 0: current=N (facing8=0)
  { track: 1,  startTrack: 0,  facing: DIR_N,  flag: F_ },            // 0-0 N→N
  { track: 3,  startTrack: 7,  facing: DIR_NE, flag: F_D },           // 0-1 N→NE
  { track: 4,  startTrack: 9,  facing: DIR_E,  flag: F_D },           // 0-2 N→E
  { track: 0,  startTrack: 0,  facing: DIR_SE, flag: F_ },            // 0-3 N→SE !
  { track: 0,  startTrack: 0,  facing: DIR_S,  flag: F_ },            // 0-4 N→S !
  { track: 0,  startTrack: 0,  facing: DIR_SW, flag: F_ },            // 0-5 N→SW !
  { track: 4,  startTrack: 9,  facing: DIR_W,  flag: F_X | F_D },     // 0-6 N→W
  { track: 3,  startTrack: 7,  facing: DIR_NW, flag: F_X | F_D },     // 0-7 N→NW

  // Row 1: current=NE (facing8=1)
  { track: 6,  startTrack: 8,  facing: DIR_N,  flag: F_T|F_X|F_Y|F_D }, // 1-0 NE→N
  { track: 2,  startTrack: 0,  facing: DIR_NE, flag: F_ },              // 1-1 NE→NE
  { track: 6,  startTrack: 8,  facing: DIR_E,  flag: F_D },             // 1-2 NE→E
  { track: 5,  startTrack: 10, facing: DIR_SE, flag: F_D },             // 1-3 NE→SE
  { track: 0,  startTrack: 0,  facing: DIR_S,  flag: F_ },              // 1-4 NE→S !
  { track: 0,  startTrack: 0,  facing: DIR_SW, flag: F_ },              // 1-5 NE→SW !
  { track: 0,  startTrack: 0,  facing: DIR_W,  flag: F_ },              // 1-6 NE→W !
  { track: 5,  startTrack: 10, facing: DIR_NW, flag: F_T|F_X|F_Y|F_D }, // 1-7 NE→NW

  // Row 2: current=E (facing8=2)
  { track: 4,  startTrack: 9,  facing: DIR_N,  flag: F_T|F_X|F_Y|F_D }, // 2-0 E→N
  { track: 3,  startTrack: 7,  facing: DIR_NE, flag: F_T|F_X|F_Y|F_D }, // 2-1 E→NE
  { track: 1,  startTrack: 0,  facing: DIR_E,  flag: F_T | F_X },       // 2-2 E→E
  { track: 3,  startTrack: 7,  facing: DIR_SE, flag: F_T|F_X|F_D },     // 2-3 E→SE
  { track: 4,  startTrack: 9,  facing: DIR_S,  flag: F_T|F_X|F_D },     // 2-4 E→S
  { track: 0,  startTrack: 0,  facing: DIR_SW, flag: F_ },              // 2-5 E→SW !
  { track: 0,  startTrack: 0,  facing: DIR_W,  flag: F_ },              // 2-6 E→W !
  { track: 0,  startTrack: 0,  facing: DIR_NW, flag: F_ },              // 2-7 E→NW !

  // Row 3: current=SE (facing8=3)
  { track: 0,  startTrack: 0,  facing: DIR_N,  flag: F_ },              // 3-0 SE→N !
  { track: 5,  startTrack: 10, facing: DIR_NE, flag: F_Y | F_D },       // 3-1 SE→NE
  { track: 6,  startTrack: 8,  facing: DIR_E,  flag: F_Y | F_D },       // 3-2 SE→E
  { track: 2,  startTrack: 0,  facing: DIR_SE, flag: F_Y },             // 3-3 SE→SE
  { track: 6,  startTrack: 8,  facing: DIR_S,  flag: F_T|F_X|F_D },     // 3-4 SE→S
  { track: 5,  startTrack: 10, facing: DIR_SW, flag: F_T|F_X|F_D },     // 3-5 SE→SW
  { track: 0,  startTrack: 0,  facing: DIR_W,  flag: F_ },              // 3-6 SE→W !
  { track: 0,  startTrack: 0,  facing: DIR_NW, flag: F_ },              // 3-7 SE→NW !

  // Row 4: current=S (facing8=4)
  { track: 0,  startTrack: 0,  facing: DIR_N,  flag: F_ },              // 4-0 S→N !
  { track: 0,  startTrack: 0,  facing: DIR_NE, flag: F_ },              // 4-1 S→NE !
  { track: 4,  startTrack: 9,  facing: DIR_E,  flag: F_Y | F_D },       // 4-2 S→E
  { track: 3,  startTrack: 7,  facing: DIR_SE, flag: F_Y | F_D },       // 4-3 S→SE
  { track: 1,  startTrack: 0,  facing: DIR_S,  flag: F_Y },             // 4-4 S→S
  { track: 3,  startTrack: 7,  facing: DIR_SW, flag: F_X|F_Y|F_D },     // 4-5 S→SW
  { track: 4,  startTrack: 9,  facing: DIR_W,  flag: F_X|F_Y|F_D },     // 4-6 S→W
  { track: 0,  startTrack: 0,  facing: DIR_NW, flag: F_ },              // 4-7 S→NW !

  // Row 5: current=SW (facing8=5)
  { track: 0,  startTrack: 0,  facing: DIR_N,  flag: F_ },              // 5-0 SW→N !
  { track: 0,  startTrack: 0,  facing: DIR_NE, flag: F_ },              // 5-1 SW→NE !
  { track: 0,  startTrack: 0,  facing: DIR_E,  flag: F_ },              // 5-2 SW→E !
  { track: 5,  startTrack: 10, facing: DIR_SE, flag: F_T | F_D },       // 5-3 SW→SE
  { track: 6,  startTrack: 8,  facing: DIR_S,  flag: F_T | F_D },       // 5-4 SW→S
  { track: 2,  startTrack: 0,  facing: DIR_SW, flag: F_T },             // 5-5 SW→SW
  { track: 6,  startTrack: 8,  facing: DIR_W,  flag: F_X|F_Y|F_D },     // 5-6 SW→W
  { track: 5,  startTrack: 10, facing: DIR_NW, flag: F_X|F_Y|F_D },     // 5-7 SW→NW

  // Row 6: current=W (facing8=6)
  { track: 4,  startTrack: 9,  facing: DIR_N,  flag: F_T|F_Y|F_D },     // 6-0 W→N
  { track: 0,  startTrack: 0,  facing: DIR_NE, flag: F_ },              // 6-1 W→NE !
  { track: 0,  startTrack: 0,  facing: DIR_E,  flag: F_ },              // 6-2 W→E !
  { track: 0,  startTrack: 0,  facing: DIR_SE, flag: F_ },              // 6-3 W→SE !
  { track: 4,  startTrack: 9,  facing: DIR_S,  flag: F_T | F_D },       // 6-4 W→S
  { track: 3,  startTrack: 7,  facing: DIR_SW, flag: F_T | F_D },       // 6-5 W→SW
  { track: 1,  startTrack: 0,  facing: DIR_W,  flag: F_T },             // 6-6 W→W
  { track: 3,  startTrack: 7,  facing: DIR_NW, flag: F_T|F_Y|F_D },     // 6-7 W→NW

  // Row 7: current=NW (facing8=7)
  { track: 6,  startTrack: 8,  facing: DIR_N,  flag: F_T|F_Y|F_D },     // 7-0 NW→N
  { track: 5,  startTrack: 10, facing: DIR_NE, flag: F_T|F_Y|F_D },     // 7-1 NW→NE
  { track: 0,  startTrack: 0,  facing: DIR_E,  flag: F_ },              // 7-2 NW→E !
  { track: 0,  startTrack: 0,  facing: DIR_SE, flag: F_ },              // 7-3 NW→SE !
  { track: 0,  startTrack: 0,  facing: DIR_S,  flag: F_ },              // 7-4 NW→S !
  { track: 5,  startTrack: 10, facing: DIR_SW, flag: F_X | F_D },       // 7-5 NW→SW
  { track: 6,  startTrack: 8,  facing: DIR_W,  flag: F_X | F_D },       // 7-6 NW→W
  { track: 2,  startTrack: 0,  facing: DIR_NW, flag: F_X },             // 7-7 NW→NW

  // Special entries (64-66): harvester/factory
  { track: 11, startTrack: 11, facing: DIR_SW,    flag: F_ },  // Harvester backup
  { track: 12, startTrack: 12, facing: DIR_SW_X2, flag: F_ },  // Drive into refinery
  { track: 13, startTrack: 13, facing: DIR_SW,    flag: F_ },  // Factory exit
];

// === Smooth_Turn: Transform offset using TrackControl flags (C++ drive.cpp:525-556) ===

/**
 * Apply C++ Smooth_Turn flag transformations to a track offset.
 * F_T: transpose X↔Y, dir = DIR_W - dir
 * F_X: negate X, dir = -dir
 * F_Y: negate Y, dir = DIR_S - dir
 *
 * @returns Transformed offset (leptons) and facing (DirType 0-255)
 */
export function smoothTurn(
  offsetX: number, offsetY: number, facing: number, flags: number
): { x: number; y: number; facing: number } {
  let x = offsetX;
  let y = offsetY;
  let dir = facing;

  if (flags & F_T) {
    const temp = x;
    x = y;
    y = temp;
    dir = (DIR_W - dir) & 0xFF;
  }

  if (flags & F_X) {
    x = -x;
    dir = (-dir) & 0xFF;
  }

  if (flags & F_Y) {
    y = -y;
    dir = (DIR_S - dir) & 0xFF;
  }

  // Normalize -0 to 0 (JS artifact from negating 0; C++ integers don't have -0)
  return { x: x || 0, y: y || 0, facing: dir };
}

// === Track Selection ===

/**
 * Look up the TrackControl entry for a facing transition.
 * @param currentFacing8 Current body facing (0-7, Dir enum)
 * @param nextFacing8 Direction to target cell (0-7, Dir enum)
 * @returns TrackControlEntry from the 64-entry table
 */
export function lookupTrackControl(currentFacing8: number, nextFacing8: number): TrackControlEntry {
  return TRACK_CONTROL[currentFacing8 * 8 + nextFacing8];
}

/**
 * Get the effective track number (1-13) for a TrackControl entry.
 * Uses StartTrack for F_D entries (single-cell short version).
 * Returns 0 for impossible turns (Track=0).
 */
export function getEffectiveTrack(ctrl: TrackControlEntry): number {
  if (ctrl.track === 0) return 0;
  if ((ctrl.flag & F_D) && ctrl.startTrack > 0) return ctrl.startTrack;
  return ctrl.track;
}

/**
 * Get the track step array for a C++ track number (1-13).
 * @param trackNum C++ track number (1-indexed)
 * @returns Track step array, or null if invalid
 */
export function getTrackArray(trackNum: number): TrackStep[] | null {
  if (trackNum < 1 || trackNum > 13) return null;
  return TRACK_DATA[trackNum - 1];
}

// === Legacy Exports (backward compatibility for tests) ===

/** @deprecated Use TRACK_DATA, lookupTrackControl, smoothTurn instead */
export const TRACKS = TRACK_DATA;

/** @deprecated Use lookupTrackControl + getEffectiveTrack */
export function selectTrack(currentFacing32: number, desiredFacing32: number): number {
  const cf8 = Math.floor(currentFacing32 / 4) % 8;
  const df8 = Math.floor(desiredFacing32 / 4) % 8;
  const ctrl = lookupTrackControl(cf8, df8);
  return getEffectiveTrack(ctrl);
}

/** @deprecated Use smoothTurn with TrackControl flags instead */
export function rotateTrackOffset(x: number, y: number, facing8: number): [number, number] {
  const S = Math.SQRT2 / 2;
  switch (facing8) {
    case 0: return [x, y];
    case 1: return [(x - y) * S, (x + y) * S];
    case 2: return [-y, x];
    case 3: return [(-x - y) * S, (x - y) * S];
    case 4: return [-x, -y];
    case 5: return [(y - x) * S, (-x - y) * S];
    case 6: return [y, -x];
    case 7: return [(x + y) * S, (y - x) * S];
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
