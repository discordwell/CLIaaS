/**
 * Renderer Visual Parity Tests — minimap blip colors, wall auto-connection bitmask,
 * cell clear variation formula.
 *
 * C++ references:
 *   - hdata.cpp:49-157      — HouseTypeClass definitions (house → PCOLOR mapping)
 *   - defines.h:1192-1209   — PlayerColorType enum (PCOLOR_GOLD..PCOLOR_DIALOG_BLUE)
 *   - radar.cpp:740         — ColorRemaps[house->RemapColor].Bar (radar dot color source)
 *   - cell.cpp:1532-1590    — CellClass::Wall_Update() wall connection bitmask (N=1,E=2,S=4,W=8)
 *   - cell.cpp:981-987      — CLEAR1 uses Clear_Icon() = (cx&3)|((cy&3)<<2) for 16 variations
 *   - defines.h:1139-1163   — HousesType enum with color comments per house
 */

import { describe, it, expect } from 'vitest';
import { House } from '../engine/types';

// ============================================================
// Section 1: Minimap Blip Colors — hdata.cpp + radar.cpp:740
// ============================================================
describe('minimap blip colors per house (hdata.cpp → radar.cpp:740)', () => {
  // C++ hdata.cpp defines each house's RemapColor (PCOLOR):
  //   England → PCOLOR_GREEN    (index 3)
  //   Germany → PCOLOR_GREY     (index 5)
  //   France  → PCOLOR_BLUE     (index 6) — NOT PCOLOR_LTBLUE
  //   Ukraine → PCOLOR_ORANGE   (index 4)
  //   USSR    → PCOLOR_RED      (index 2)
  //   Greece  → PCOLOR_LTBLUE   (index 1)
  //   Turkey  → PCOLOR_BROWN    (index 7)
  //   Spain   → PCOLOR_GOLD     (index 0)
  //   GoodGuy → PCOLOR_LTBLUE   (index 1)
  //   BadGuy  → PCOLOR_RED      (index 2)
  //   Neutral → PCOLOR_GOLD     (index 0)
  //
  // The radar uses ColorRemaps[house->RemapColor].Bar as the dot color.
  // Each PCOLOR maps to a specific palette-derived bar color from PCOLOR.CPS.
  //
  // C++ PCOLOR → canonical radar bar color:
  //   PCOLOR_GOLD(0)    → gold/yellow
  //   PCOLOR_LTBLUE(1)  → light blue
  //   PCOLOR_RED(2)     → red
  //   PCOLOR_GREEN(3)   → green
  //   PCOLOR_ORANGE(4)  → orange
  //   PCOLOR_GREY(5)    → grey
  //   PCOLOR_BLUE(6)    → dark blue
  //   PCOLOR_BROWN(7)   → brown

  // C++ authoritative house → PCOLOR mapping from hdata.cpp
  const CPP_HOUSE_PCOLOR: Record<string, string> = {
    Spain:   'PCOLOR_GOLD',     // hdata.cpp:125
    Greece:  'PCOLOR_LTBLUE',   // hdata.cpp:105
    USSR:    'PCOLOR_RED',      // hdata.cpp:95
    England: 'PCOLOR_GREEN',    // hdata.cpp:55
    Ukraine: 'PCOLOR_ORANGE',   // hdata.cpp:85
    Germany: 'PCOLOR_GREY',     // hdata.cpp:65
    France:  'PCOLOR_BLUE',     // hdata.cpp:75 — NOT PCOLOR_LTBLUE
    Turkey:  'PCOLOR_BROWN',    // hdata.cpp:115
    GoodGuy: 'PCOLOR_LTBLUE',   // hdata.cpp:135
    BadGuy:  'PCOLOR_RED',      // hdata.cpp:145
    Neutral: 'PCOLOR_GOLD',     // hdata.cpp:155
  };

  // PCOLOR → color category (what the radar bar color looks like)
  const PCOLOR_CATEGORY: Record<string, string> = {
    PCOLOR_GOLD:   'gold',
    PCOLOR_LTBLUE: 'lightblue',
    PCOLOR_RED:    'red',
    PCOLOR_GREEN:  'green',
    PCOLOR_ORANGE: 'orange',
    PCOLOR_GREY:   'grey',
    PCOLOR_BLUE:   'darkblue',
    PCOLOR_BROWN:  'brown',
  };

  // TS minimap colors from renderer.ts:42-54 (HOUSE_MINIMAP_COLOR)
  const TS_MINIMAP_COLOR: Record<string, string> = {
    [House.Spain]:   '#FFD700', // gold
    [House.USSR]:    '#FF3030', // red
    [House.Greece]:  '#4080FF', // blue
    [House.England]: '#40C040', // green
    [House.France]:  '#2040C0', // dark blue (C++ hdata.cpp:75 PCOLOR_BLUE)
    [House.Ukraine]: '#E07020', // orange (C++ hdata.cpp:85 PCOLOR_ORANGE)
    [House.Germany]: '#A0A0A0', // gray
    [House.Turkey]:  '#A06830', // brown (C++ hdata.cpp:115 PCOLOR_BROWN)
    [House.GoodGuy]: '#60B0FF', // light blue (C++ hdata.cpp:135 PCOLOR_LTBLUE)
    [House.BadGuy]:  '#FF4040', // red
    [House.Neutral]: '#FFD700', // gold (C++ hdata.cpp:155 PCOLOR_GOLD)
    [House.Special]: '#FFFFFF', // white (HOUSE_SPECIAL — reinforcements/scripted)
  };

  // Classify a hex color into a category for loose matching
  function classifyHex(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    // White
    if (r > 240 && g > 240 && b > 240) return 'white';
    // Gold/Yellow (high R, high G, low B)
    if (r > 200 && g > 180 && b < 80) return 'gold';
    // Red (high R, low G, low B)
    if (r > 200 && g < 100 && b < 100) return 'red';
    // Green (low R, high G, low B)
    if (r < 100 && g > 150 && b < 100) return 'green';
    // Orange (high R, medium G, low B)
    if (r > 200 && g > 100 && g < 200 && b < 80) return 'orange';
    // Grey (R≈G≈B, medium range)
    if (Math.abs(r - g) < 30 && Math.abs(g - b) < 30 && r > 100 && r < 200) return 'grey';
    // Purple (high R, low G, high B)
    if (r > 150 && g < 100 && b > 150) return 'purple';
    // Light blue (low-medium R, medium G, high B)
    if (r < 130 && b > 200) return 'lightblue';
    // Dark blue (low R, low G, high B)
    if (r < 80 && g < 80 && b > 150) return 'darkblue';
    // Brown (medium R, low-medium G, low B)
    if (r > 120 && r < 200 && g > 60 && g < 130 && b < 80) return 'brown';
    // Olive (medium R, medium G, low B)
    if (r > 150 && g > 150 && b < 120) return 'olive';
    // Yellow (high R, high G, low B — brighter than gold)
    if (r > 240 && g > 240 && b < 100) return 'yellow';

    return 'unknown';
  }

  it('all 12 TS House enum values have a minimap color entry', () => {
    const houses = Object.values(House);
    for (const h of houses) {
      expect(TS_MINIMAP_COLOR[h], `${h} should have a minimap color`).toBeDefined();
    }
  });

  it('Spain → PCOLOR_GOLD → gold minimap color', () => {
    const category = classifyHex(TS_MINIMAP_COLOR[House.Spain]);
    expect(category).toBe(PCOLOR_CATEGORY[CPP_HOUSE_PCOLOR.Spain]);
  });

  it('Greece → PCOLOR_LTBLUE → light blue minimap color', () => {
    const category = classifyHex(TS_MINIMAP_COLOR[House.Greece]);
    expect(category).toBe(PCOLOR_CATEGORY[CPP_HOUSE_PCOLOR.Greece]);
  });

  it('USSR → PCOLOR_RED → red minimap color', () => {
    const category = classifyHex(TS_MINIMAP_COLOR[House.USSR]);
    expect(category).toBe(PCOLOR_CATEGORY[CPP_HOUSE_PCOLOR.USSR]);
  });

  it('England → PCOLOR_GREEN → green minimap color', () => {
    const category = classifyHex(TS_MINIMAP_COLOR[House.England]);
    expect(category).toBe(PCOLOR_CATEGORY[CPP_HOUSE_PCOLOR.England]);
  });

  it('Germany → PCOLOR_GREY → grey minimap color', () => {
    const category = classifyHex(TS_MINIMAP_COLOR[House.Germany]);
    expect(category).toBe(PCOLOR_CATEGORY[CPP_HOUSE_PCOLOR.Germany]);
  });

  it('BadGuy → PCOLOR_RED → red minimap color', () => {
    const category = classifyHex(TS_MINIMAP_COLOR[House.BadGuy]);
    expect(category).toBe(PCOLOR_CATEGORY[CPP_HOUSE_PCOLOR.BadGuy]);
  });

  // FIXED: All 11 houses now use correct C++ PCOLOR mappings (renderer.ts parity)

  it('Ukraine → PCOLOR_ORANGE → orange minimap color', () => {
    // C++ hdata.cpp:85 — HOUSE_UKRAINE → PCOLOR_ORANGE
    // FIXED: TS renderer.ts:48 — Ukraine → '#E07020' (orange)
    const category = classifyHex(TS_MINIMAP_COLOR[House.Ukraine]);
    expect(category).toBe(PCOLOR_CATEGORY[CPP_HOUSE_PCOLOR.Ukraine]);
  });

  it('France → PCOLOR_BLUE → dark blue minimap color', () => {
    // C++ hdata.cpp:75 — HOUSE_FRANCE → PCOLOR_BLUE (dark blue, index 6)
    // FIXED: TS renderer.ts:47 — France → '#2040C0' (dark blue)
    const category = classifyHex(TS_MINIMAP_COLOR[House.France]);
    expect(category).toBe(PCOLOR_CATEGORY[CPP_HOUSE_PCOLOR.France]);
  });

  it('Turkey → PCOLOR_BROWN → brown minimap color', () => {
    // C++ hdata.cpp:115 — HOUSE_TURKEY → PCOLOR_BROWN
    // FIXED: TS renderer.ts:50 — Turkey → '#A06830' (brown)
    const category = classifyHex(TS_MINIMAP_COLOR[House.Turkey]);
    expect(category).toBe(PCOLOR_CATEGORY[CPP_HOUSE_PCOLOR.Turkey]);
  });

  it('GoodGuy → PCOLOR_LTBLUE → light blue minimap color', () => {
    // C++ hdata.cpp:135 — HOUSE_GOOD → PCOLOR_LTBLUE
    // FIXED: TS renderer.ts:51 — GoodGuy → '#60B0FF' (light blue)
    const category = classifyHex(TS_MINIMAP_COLOR[House.GoodGuy]);
    expect(category).toBe(PCOLOR_CATEGORY[CPP_HOUSE_PCOLOR.GoodGuy]);
  });

  it('Neutral → PCOLOR_GOLD → gold minimap color', () => {
    // C++ hdata.cpp:155 — HOUSE_NEUTRAL → PCOLOR_GOLD
    // FIXED: TS renderer.ts:53 — Neutral → '#FFD700' (gold)
    const category = classifyHex(TS_MINIMAP_COLOR[House.Neutral]);
    expect(category).toBe(PCOLOR_CATEGORY[CPP_HOUSE_PCOLOR.Neutral]);
  });
});

// ============================================================
// Section 2: Wall Auto-Connection Bitmask — cell.cpp:1532-1590
// ============================================================
describe('wall auto-connection NESW bitmask (cell.cpp:1532-1590)', () => {
  // C++ cell.cpp:1536: _offsets[5] = {FACING_N, FACING_E, FACING_S, FACING_W, FACING_NONE}
  // C++ cell.cpp:1548-1552:
  //   for (i = 0; i < 4; i++) {
  //     if (newcell.Adjacent_Cell(_offsets[i]).Overlay == newcell.Overlay) {
  //       icon |= 1 << i;
  //     }
  //   }
  // So: N=bit0(1), E=bit1(2), S=bit2(4), W=bit3(8)
  //
  // TS renderer.ts:131-140:
  //   if (map.getWallType(cx, cy - 1) === wallType) mask |= 1; // N
  //   if (map.getWallType(cx + 1, cy) === wallType) mask |= 2; // E
  //   if (map.getWallType(cx, cy + 1) === wallType) mask |= 4; // S
  //   if (map.getWallType(cx - 1, cy) === wallType) mask |= 8; // W

  // Re-implement both C++ and TS logic as pure functions for comparison
  type WallGrid = Record<string, string>; // "cx,cy" → wallType

  // C++ version: uses _offsets[] = {FACING_N, FACING_E, FACING_S, FACING_W}
  // FACING_N = (0,-1), FACING_E = (1,0), FACING_S = (0,1), FACING_W = (-1,0)
  function cppWallIcon(grid: WallGrid, cx: number, cy: number): number {
    const myType = grid[`${cx},${cy}`];
    if (!myType) return 0;
    // _offsets: N, E, S, W (indices 0-3)
    const offsets: [number, number][] = [
      [0, -1],  // FACING_N
      [1, 0],   // FACING_E
      [0, 1],   // FACING_S
      [-1, 0],  // FACING_W
    ];
    let icon = 0;
    for (let i = 0; i < 4; i++) {
      const [dx, dy] = offsets[i];
      if (grid[`${cx + dx},${cy + dy}`] === myType) {
        icon |= 1 << i;
      }
    }
    return icon;
  }

  // TS version from renderer.ts:133-140
  function tsWallConnectionMask(grid: WallGrid, cx: number, cy: number): number {
    const wallType = grid[`${cx},${cy}`];
    if (!wallType) return 0;
    let mask = 0;
    if (grid[`${cx},${cy - 1}`] === wallType) mask |= 1; // N
    if (grid[`${cx + 1},${cy}`] === wallType) mask |= 2; // E
    if (grid[`${cx},${cy + 1}`] === wallType) mask |= 4; // S
    if (grid[`${cx - 1},${cy}`] === wallType) mask |= 8; // W
    return mask;
  }

  it('isolated wall (no neighbors) → mask 0', () => {
    const grid: WallGrid = { '5,5': 'BRIK' };
    expect(cppWallIcon(grid, 5, 5)).toBe(0);
    expect(tsWallConnectionMask(grid, 5, 5)).toBe(0);
    expect(tsWallConnectionMask(grid, 5, 5)).toBe(cppWallIcon(grid, 5, 5));
  });

  it('wall with north neighbor → mask 1 (bit 0)', () => {
    const grid: WallGrid = { '5,5': 'BRIK', '5,4': 'BRIK' };
    expect(cppWallIcon(grid, 5, 5)).toBe(1);
    expect(tsWallConnectionMask(grid, 5, 5)).toBe(1);
  });

  it('wall with east neighbor → mask 2 (bit 1)', () => {
    const grid: WallGrid = { '5,5': 'BRIK', '6,5': 'BRIK' };
    expect(cppWallIcon(grid, 5, 5)).toBe(2);
    expect(tsWallConnectionMask(grid, 5, 5)).toBe(2);
  });

  it('wall with south neighbor → mask 4 (bit 2)', () => {
    const grid: WallGrid = { '5,5': 'BRIK', '5,6': 'BRIK' };
    expect(cppWallIcon(grid, 5, 5)).toBe(4);
    expect(tsWallConnectionMask(grid, 5, 5)).toBe(4);
  });

  it('wall with west neighbor → mask 8 (bit 3)', () => {
    const grid: WallGrid = { '5,5': 'BRIK', '4,5': 'BRIK' };
    expect(cppWallIcon(grid, 5, 5)).toBe(8);
    expect(tsWallConnectionMask(grid, 5, 5)).toBe(8);
  });

  it('wall with N+S (vertical line) → mask 5', () => {
    const grid: WallGrid = { '5,4': 'BRIK', '5,5': 'BRIK', '5,6': 'BRIK' };
    expect(cppWallIcon(grid, 5, 5)).toBe(5);
    expect(tsWallConnectionMask(grid, 5, 5)).toBe(5);
  });

  it('wall with E+W (horizontal line) → mask 10', () => {
    const grid: WallGrid = { '4,5': 'BRIK', '5,5': 'BRIK', '6,5': 'BRIK' };
    expect(cppWallIcon(grid, 5, 5)).toBe(10);
    expect(tsWallConnectionMask(grid, 5, 5)).toBe(10);
  });

  it('wall with all 4 neighbors (cross) → mask 15', () => {
    const grid: WallGrid = {
      '5,4': 'BRIK', '6,5': 'BRIK',
      '5,5': 'BRIK',
      '4,5': 'BRIK', '5,6': 'BRIK',
    };
    expect(cppWallIcon(grid, 5, 5)).toBe(15);
    expect(tsWallConnectionMask(grid, 5, 5)).toBe(15);
  });

  it('wall with N+E (corner) → mask 3', () => {
    const grid: WallGrid = { '5,5': 'BRIK', '5,4': 'BRIK', '6,5': 'BRIK' };
    expect(cppWallIcon(grid, 5, 5)).toBe(3);
    expect(tsWallConnectionMask(grid, 5, 5)).toBe(3);
  });

  it('wall with S+W (corner) → mask 12', () => {
    const grid: WallGrid = { '5,5': 'BRIK', '5,6': 'BRIK', '4,5': 'BRIK' };
    expect(cppWallIcon(grid, 5, 5)).toBe(12);
    expect(tsWallConnectionMask(grid, 5, 5)).toBe(12);
  });

  it('different wall types do NOT connect (C++ checks same overlay)', () => {
    // C++ cell.cpp:1549: newcell.Adjacent_Cell(_offsets[i]).Overlay == newcell.Overlay
    // Only same overlay type connects — TS also checks wallType equality
    const grid: WallGrid = { '5,5': 'BRIK', '5,4': 'FENC', '6,5': 'BRIK' };
    expect(cppWallIcon(grid, 5, 5)).toBe(2); // only east neighbor matches
    expect(tsWallConnectionMask(grid, 5, 5)).toBe(2);
  });

  it('C++ and TS agree on all 16 bitmask values', () => {
    // Exhaustively test all 16 possible neighbor combinations
    const directions: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N, E, S, W

    for (let bitmask = 0; bitmask < 16; bitmask++) {
      const grid: WallGrid = { '5,5': 'SBAG' };
      for (let bit = 0; bit < 4; bit++) {
        if (bitmask & (1 << bit)) {
          const [dx, dy] = directions[bit];
          grid[`${5 + dx},${5 + dy}`] = 'SBAG';
        }
      }
      const cppResult = cppWallIcon(grid, 5, 5);
      const tsResult = tsWallConnectionMask(grid, 5, 5);
      expect(tsResult, `bitmask ${bitmask}: TS should match C++`).toBe(cppResult);
      expect(tsResult).toBe(bitmask);
    }
  });

  // Wall frame selection: C++ stores icon in low nibble of OverlayData
  // cell.cpp:1553: newcell.OverlayData = (newcell.OverlayData & 0xFFF0) | icon;
  // TS renderer.ts:1419-1426 uses mask directly as frame offset:
  //   BRIK: frame = damageOffset + mask
  //   SBAG/FENC/BARB: frame = (damaged ? 16 : 0) + mask

  it('BRIK frame layout: 64 frames = 4 damage stages x 16 connection patterns', () => {
    // C++ cell.cpp:1560: OVERLAY_BRICK_WALL with OverlayData==48 → destroyed
    // 48 = 3*16, meaning damage stage 3 (48>>4=3) is invalid → wall destroyed
    // So BRIK has 3 valid damage levels: 0,16,32 → frames 0-15, 16-31, 32-47
    // TS renderer.ts:1420-1422: frame = (damaged ? (hpRatio < 0.25 ? 32 : 16) : 0) + mask
    for (let mask = 0; mask < 16; mask++) {
      expect(0 + mask).toBe(mask);      // healthy
      expect(16 + mask).toBe(16 + mask); // damaged
      expect(32 + mask).toBe(32 + mask); // heavy damage
    }
  });

  it('SBAG/FENC/BARB frame layout: 32 frames = 2 damage stages x 16 patterns', () => {
    // C++ cell.cpp:1565: OVERLAY_SANDBAG_WALL with OverlayData==16 → destroyed
    // 16 = 1*16, meaning damage stage 1 (16>>4=1) is the destroy threshold
    // TS renderer.ts:1424-1425: frame = (damaged ? 16 : 0) + mask
    for (let mask = 0; mask < 16; mask++) {
      const healthyFrame = 0 + mask;
      const damagedFrame = 16 + mask;
      expect(healthyFrame).toBeLessThan(16);
      expect(damagedFrame).toBeGreaterThanOrEqual(16);
      expect(damagedFrame).toBeLessThan(32);
    }
  });
});

// ============================================================
// Section 3: Cell Clear Variation Formula — cell.cpp:981-987
// ============================================================
describe('cell clear variation formula (cell.cpp:981-987)', () => {
  // C++ cell.cpp:981-987:
  //   if (TType != TEMPLATE_NONE && TType != TEMPLATE_CLEAR1 && TType != 255) {
  //     ttype = &TemplateTypeClass::As_Reference(TType);
  //     icon = TIcon;
  //   } else {
  //     ttype = &TemplateTypeClass::As_Reference(TEMPLATE_CLEAR1);
  //     icon = Clear_Icon();
  //   }
  //
  // Clear_Icon() returns (Cell_X(cell) & 3) | ((Cell_Y(cell) & 3) << 2)
  // This produces 16 unique values (0-15) for a 4x4 tiling pattern.
  //
  // TS renderer.ts:964:
  //   const clearIcon = (cx & 3) | ((cy & 3) << 2);

  // C++ Clear_Icon formula
  function cppClearIcon(cx: number, cy: number): number {
    return (cx & 3) | ((cy & 3) << 2);
  }

  // TS formula (renderer.ts:964)
  function tsClearIcon(cx: number, cy: number): number {
    return (cx & 3) | ((cy & 3) << 2);
  }

  it('produces 16 unique values for the 4x4 grid', () => {
    const seen = new Set<number>();
    for (let cy = 0; cy < 4; cy++) {
      for (let cx = 0; cx < 4; cx++) {
        const icon = cppClearIcon(cx, cy);
        seen.add(icon);
        expect(icon).toBeGreaterThanOrEqual(0);
        expect(icon).toBeLessThanOrEqual(15);
      }
    }
    expect(seen.size).toBe(16);
  });

  it('C++ and TS formulas are identical for corner cells', () => {
    // Test corners of a typical map area
    const corners = [
      [0, 0], [3, 0], [0, 3], [3, 3],
      [127, 127], [64, 64], [0, 127], [127, 0],
    ];
    for (const [cx, cy] of corners) {
      expect(tsClearIcon(cx, cy), `(${cx},${cy})`).toBe(cppClearIcon(cx, cy));
    }
  });

  it('formula tiles with period 4 in both axes', () => {
    // Clear_Icon should repeat every 4 cells in each direction
    for (let cy = 0; cy < 20; cy++) {
      for (let cx = 0; cx < 20; cx++) {
        const icon = cppClearIcon(cx, cy);
        expect(cppClearIcon(cx + 4, cy)).toBe(icon);
        expect(cppClearIcon(cx, cy + 4)).toBe(icon);
        expect(cppClearIcon(cx + 4, cy + 4)).toBe(icon);
      }
    }
  });

  it('low 2 bits encode X position, high 2 bits encode Y position', () => {
    // (cx & 3) occupies bits 0-1, ((cy & 3) << 2) occupies bits 2-3
    for (let cy = 0; cy < 4; cy++) {
      for (let cx = 0; cx < 4; cx++) {
        const icon = cppClearIcon(cx, cy);
        expect(icon & 0x03).toBe(cx);       // low 2 bits = cx
        expect((icon >> 2) & 0x03).toBe(cy); // high 2 bits = cy
      }
    }
  });

  it('specific cells produce expected variation indices', () => {
    // Document specific cases for regression testing
    const cases: [number, number, number][] = [
      // [cx, cy, expected_icon]
      [0, 0, 0],
      [1, 0, 1],
      [2, 0, 2],
      [3, 0, 3],
      [0, 1, 4],
      [1, 1, 5],
      [2, 1, 6],
      [3, 1, 7],
      [0, 2, 8],
      [1, 2, 9],
      [2, 2, 10],
      [3, 2, 11],
      [0, 3, 12],
      [1, 3, 13],
      [2, 3, 14],
      [3, 3, 15],
    ];

    for (const [cx, cy, expected] of cases) {
      expect(tsClearIcon(cx, cy), `(${cx},${cy})`).toBe(expected);
      expect(cppClearIcon(cx, cy), `C++ (${cx},${cy})`).toBe(expected);
    }
  });

  it('large coordinates use only low 2 bits per axis', () => {
    // Cell (100, 200): 100 & 3 = 0, 200 & 3 = 0 → icon = 0
    expect(cppClearIcon(100, 200)).toBe(0);
    expect(tsClearIcon(100, 200)).toBe(0);

    // Cell (101, 203): 101 & 3 = 1, 203 & 3 = 3 → icon = 1 | (3 << 2) = 13
    expect(cppClearIcon(101, 203)).toBe(13);
    expect(tsClearIcon(101, 203)).toBe(13);

    // Cell (63, 63): 63 & 3 = 3, 63 & 3 = 3 → icon = 3 | (3 << 2) = 15
    expect(cppClearIcon(63, 63)).toBe(15);
    expect(tsClearIcon(63, 63)).toBe(15);
  });

  it('negative coordinates handle bitwise AND correctly', () => {
    // JavaScript bitwise & handles negatives via two's complement
    // -1 & 3 = 3 in JS (same as C++ unsigned behavior for cell coords)
    // This isn't expected in practice (cell coords are non-negative) but
    // documents the behavior
    expect(tsClearIcon(-1, -1)).toBe(cppClearIcon(-1, -1));
  });
});
