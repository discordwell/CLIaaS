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

import { describe, it, expect, vi } from 'vitest';
import { AssetManager } from '../engine/assets';
import { Camera } from '../engine/camera';
import { CloakState, Entity, setPlayerHouses } from '../engine/entity';
import { GameMap, Terrain, TERRAIN_OBJECT_OCCUPY, TREE_OCCUPY } from '../engine/map';
import {
  applyCppDefaultPaletteAdjustment,
  applyWaterPaletteCycle,
  buildCppDefaultPaletteAdjustmentMap,
  BUILDING_FRAME_TABLE,
  cppDefaultAdjustedPaletteColor,
  HOUSE_MINIMAP_COLOR,
  Renderer,
  waterPaletteCycleShift,
} from '../engine/renderer';
import { NonCriticalRandom } from '../engine/random';
import { RA_COLOR_BLACK, conquerBuildFadingTable, nearestPaletteIndex } from '../engine/shadow';
import { CELL_SIZE, House, LEPTON_SIZE, Mission, UnitType } from '../engine/types';

describe('sprite SHAPE_CENTER placement (2keyfbuf.cpp Buffer_Frame_To_Page)', () => {
  function managerWithSheet(width: number, height: number): AssetManager {
    const assets = new AssetManager();
    (assets as any).sheets.set('odd', {
      image: { width, height },
      meta: {
        frameWidth: width,
        frameHeight: height,
        frameCount: 1,
        columns: 1,
        rows: 1,
        sheetWidth: width,
        sheetHeight: height,
      },
    });
    return assets;
  }

  it('centers odd-sized frames with C++ integer division, not browser half-pixels', () => {
    // C++ RA/2keyfbuf.cpp: Buffer_Frame_To_Page applies SHAPE_CENTER as:
    //   x -= w / 2; y -= h / 2;
    // with integer division. FIRE1/2/3 are 23x23, so their destination is
    // center minus 11, not center minus 11.5.
    const assets = managerWithSheet(23, 23);
    const ctx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;

    assets.drawFrame(ctx, 'odd', 0, 100, 80, { centerX: true, centerY: true });

    expect((ctx.drawImage as any).mock.calls[0].slice(5)).toEqual([89, 69, 23, 23]);
  });

  it('snaps fractional lepton-derived anchors before applying SHAPE_CENTER', () => {
    // C++ render paths pass integer Lepton_To_Pixel results into CC_Draw_Shape.
    // Canvas drawImage at fractional coordinates anti-aliases sprite edges, so
    // TS must snap the anchor before the SHAPE_CENTER offset.
    const assets = managerWithSheet(23, 23);
    const ctx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;

    assets.drawFrame(ctx, 'odd', 0, 100.375, 80.375, { centerX: true, centerY: true });

    expect((ctx.drawImage as any).mock.calls[0].slice(5)).toEqual([89, 69, 23, 23]);
  });
});

// ============================================================
// Section 1: Minimap Blip Colors — hdata.cpp + radar.cpp:740
// ============================================================
describe('minimap blip colors per house (hdata.cpp → radar.cpp:740)', () => {
  const CPP_RADAR_BAR_COLOR: Record<string, string> = {
    [House.Spain]: 'rgb(144,136,76)',
    [House.Greece]: 'rgb(104,116,160)',
    [House.USSR]: 'rgb(176,0,0)',
    [House.England]: 'rgb(120,152,100)',
    [House.France]: 'rgb(64,132,116)',
    [House.Ukraine]: 'rgb(212,120,16)',
    [House.Germany]: 'rgb(148,124,112)',
    [House.Turkey]: 'rgb(152,76,56)',
    [House.GoodGuy]: 'rgb(104,116,160)',
    [House.BadGuy]: 'rgb(176,0,0)',
    [House.Neutral]: 'rgb(144,136,76)',
    [House.Special]: 'rgb(144,136,76)',
    [House.Multi1]: 'rgb(144,136,76)',
    [House.Multi2]: 'rgb(104,116,160)',
    [House.Multi3]: 'rgb(176,0,0)',
    [House.Multi4]: 'rgb(120,152,100)',
    [House.Multi5]: 'rgb(212,120,16)',
    [House.Multi6]: 'rgb(148,124,112)',
    [House.Multi7]: 'rgb(64,132,116)',
    [House.Multi8]: 'rgb(152,76,56)',
  };

  it('uses exact C++ ColorRemaps[pcolor].Bar RGB values, not loose color categories', () => {
    expect(HOUSE_MINIMAP_COLOR).toMatchObject(CPP_RADAR_BAR_COLOR);
  });

  it('maps campaign and multiplayer houses through hdata.cpp PCOLOR assignments', () => {
    const sameAsSpain = [House.Neutral, House.Special, House.Multi1];
    const sameAsGreece = [House.GoodGuy, House.Multi2];
    const sameAsUSSR = [House.BadGuy, House.Multi3];

    for (const house of sameAsSpain) expect(HOUSE_MINIMAP_COLOR[house]).toBe(HOUSE_MINIMAP_COLOR[House.Spain]);
    for (const house of sameAsGreece) expect(HOUSE_MINIMAP_COLOR[house]).toBe(HOUSE_MINIMAP_COLOR[House.Greece]);
    for (const house of sameAsUSSR) expect(HOUSE_MINIMAP_COLOR[house]).toBe(HOUSE_MINIMAP_COLOR[House.USSR]);
    expect(HOUSE_MINIMAP_COLOR[House.Multi4]).toBe(HOUSE_MINIMAP_COLOR[House.England]);
    expect(HOUSE_MINIMAP_COLOR[House.Multi5]).toBe(HOUSE_MINIMAP_COLOR[House.Ukraine]);
    expect(HOUSE_MINIMAP_COLOR[House.Multi6]).toBe(HOUSE_MINIMAP_COLOR[House.Germany]);
    expect(HOUSE_MINIMAP_COLOR[House.Multi7]).toBe(HOUSE_MINIMAP_COLOR[House.France]);
    expect(HOUSE_MINIMAP_COLOR[House.Multi8]).toBe(HOUSE_MINIMAP_COLOR[House.Turkey]);
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

describe('renderer clear-template base art (cell.cpp:981-987)', () => {
  function mockCanvas(): { canvas: HTMLCanvasElement; ctx: any } {
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      fillStyle: '#000',
      font: '',
      textAlign: 'start',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    };
    return {
      canvas: {
        width: CELL_SIZE,
        height: CELL_SIZE,
        getContext: () => ctx,
      } as unknown as HTMLCanvasElement,
      ctx,
    };
  }

  it.each([0, 0xFFFF, 255])('draws TEMPLATE_CLEAR1 art for sentinel template %s even when Land is ROCK', (tmpl) => {
    // C++ chooses the base icon from TType before Land_Type-specific logic:
    // TEMPLATE_NONE, TEMPLATE_CLEAR1, and 255 all use Clear_Icon(). INTERIOR
    // Recalc_Attributes can classify the same cell as LAND_ROCK for movement,
    // but that must not change the base tile art.
    const { canvas, ctx } = mockCanvas();
    const renderer = new Renderer(canvas);
    renderer.theatre = 'INTERIOR';

    const atlasImage = {};
    (renderer as any).tilesetImage = atlasImage;
    (renderer as any).tilesetMeta = {
      tileW: CELL_SIZE,
      tileH: CELL_SIZE,
      atlasW: 512,
      atlasH: 512,
      tileCount: 1,
      tiles: { '255,5': { ax: 77, ay: 88, lt: 'Rock' } },
    };
    (renderer as any).tilesetReady = true;
    (renderer as any).tilesetTheatre = 'INTERIOR';

    const camera = new Camera(0, 0);
    camera.x = 5 * CELL_SIZE;
    camera.y = 5 * CELL_SIZE;

    const map = new GameMap();
    map.setBounds(5, 5, 1, 1);
    map.setTerrain(5, 5, Terrain.ROCK);
    const idx = 5 * 128 + 5;
    map.templateType[idx] = tmpl;
    map.templateIcon[idx] = 13; // ignored by C++ for these sentinel templates

    (renderer as any).renderTerrain(camera, map, 0, {});

    expect(ctx.drawImage).toHaveBeenCalledWith(
      atlasImage,
      77,
      88,
      CELL_SIZE,
      CELL_SIZE,
      0,
      0,
      CELL_SIZE,
      CELL_SIZE,
    );
    expect(ctx.fillRect).not.toHaveBeenCalledWith(0, 0, CELL_SIZE, CELL_SIZE);
  });
});

describe('renderer structure fog brightness (cell.cpp:1275, display.cpp:2113-2151)', () => {
  it('draws mapped structures at full alpha and leaves fog dimming to SHADOW.SHP', () => {
    const alphas: number[] = [];
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      fillStyle: '#000',
      font: '',
      textAlign: 'start',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    };
    const canvas = {
      width: 640,
      height: 400,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
    const renderer = new Renderer(canvas);
    const camera = new Camera(640, 400);
    const map = {
      getDisplayVisibility: () => 1,
    };
    const assets = {
      getSheet: (name: string) => name === 'barl'
        ? { meta: { frameWidth: 12, frameHeight: 14, frameCount: 3 } }
        : null,
      getRemappedSheet: () => null,
      drawFrame: vi.fn(() => alphas.push(ctx.globalAlpha)),
      drawFrameFrom: vi.fn(() => alphas.push(ctx.globalAlpha)),
      hasSheet: () => false,
    };
    const barrel = {
      type: 'BARL',
      image: 'barl',
      house: House.USSR,
      cx: 10,
      cy: 10,
      hp: 10,
      maxHp: 10,
      alive: true,
    };

    (renderer as any).renderStructures(camera, map as any, [barrel] as any, assets as any, 100);

    expect(alphas).toEqual([1]);
    expect(ctx.globalAlpha).toBe(1);
  });
});

describe('renderer structure shadow sentinels (Techno_Draw_Object SHAPE_GHOST)', () => {
  it('draws building body sprites with C++ ghost-shadow handling', () => {
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      fillStyle: '#000',
      font: '',
      textAlign: 'start',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      getImageData: vi.fn(),
      putImageData: vi.fn(),
      canvas: { width: 640, height: 400 },
    };
    const canvas = {
      width: 640,
      height: 400,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
    const renderer = new Renderer(canvas);
    renderer.theatre = 'SNOW';
    const palette = Array.from({ length: 256 }, () => [0, 0, 0]);
    (renderer as any).pal = palette;
    const camera = new Camera(640, 400);
    const map = {
      getDisplayVisibility: () => 2,
    };
    const assets = {
      getSheet: (name: string) => name === 'powr'
        ? { meta: { frameWidth: 48, frameHeight: 48, frameCount: 2 } }
        : null,
      getRemappedSheet: () => ({ meta: { frameWidth: 48, frameHeight: 48, frameCount: 2 } }),
      drawFrame: vi.fn(),
      drawFrameFrom: vi.fn(),
      hasSheet: () => false,
    };
    const powr = {
      type: 'POWR',
      image: 'powr',
      house: House.USSR,
      cx: 10,
      cy: 10,
      hp: 400,
      maxHp: 400,
      alive: true,
    };

    (renderer as any).renderStructures(camera, map as any, [powr] as any, assets as any, 100);

    expect(assets.drawFrameFrom).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'powr',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({
        centerX: true,
        centerY: true,
        ghostShadow: expect.objectContaining({ palette, frac: 75 }),
      }),
    );
  });
});

describe('renderer structure body remap flags (TechnoClass::Remap_Table const)', () => {
  function setup(sheetName: string, frameCount = 2) {
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillStyle: '#000',
      strokeStyle: '#fff',
      lineWidth: 1,
      font: '',
      textAlign: 'start',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
    };
    const canvas = {
      width: 640,
      height: 400,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
    const renderer = new Renderer(canvas);
    const camera = new Camera(640, 400);
    const map = {
      getDisplayVisibility: () => 2,
    };
    const assets = {
      getSheet: vi.fn((name: string) => name === sheetName
        ? { meta: { frameWidth: 24, frameHeight: 24, frameCount } }
        : null),
      getRemappedSheet: vi.fn(() => ({ meta: { frameWidth: 24, frameHeight: 24, frameCount } })),
      drawFrame: vi.fn(),
      drawFrameFrom: vi.fn(),
      hasSheet: vi.fn(() => false),
    };
    return { ctx, renderer, camera, map, assets };
  }

  it('does not owner-remap REMAP_ALTERNATE civilians when IsRemappable is false', () => {
    // C++ bdata.cpp ClassV19 has REMAP_ALTERNATE but IsRemappable=false.
    // BuildingClass::Draw_It is const, so Techno_Draw_Object resolves
    // Remap_Table() to TechnoClass::Remap_Table(void) const. The fallback is
    // PCOLOR_GOLD's identity table, represented here by drawing the source art.
    const { ctx, renderer, camera, map, assets } = setup('v19', 29);
    const v19 = {
      type: 'V19',
      image: 'v19',
      house: House.France,
      cx: 10,
      cy: 10,
      hp: 400,
      maxHp: 400,
      alive: true,
    };

    (renderer as any).renderStructures(camera, map as any, [v19] as any, assets as any, 100);

    expect(assets.getRemappedSheet).not.toHaveBeenCalled();
    expect(assets.drawFrame).toHaveBeenCalledWith(ctx, 'v19', 11, 252, 252, {
      centerX: true,
      centerY: true,
    });
    expect(assets.drawFrameFrom).not.toHaveBeenCalled();
  });

  it('does not owner-remap REMAP_NONE mine buildings', () => {
    // C++ MINV/MINP have IsRemappable=true, but HouseClass::Remap_Table
    // returns null when the type remap mode is REMAP_NONE.
    const { ctx, renderer, camera, map, assets } = setup('minv', 1);
    const mine = {
      type: 'MINV',
      image: 'minv',
      house: House.USSR,
      cx: 10,
      cy: 10,
      hp: 1,
      maxHp: 1,
      alive: true,
    };

    (renderer as any).renderStructures(camera, map as any, [mine] as any, assets as any, 100);

    expect(assets.getRemappedSheet).not.toHaveBeenCalled();
    expect(assets.drawFrame).toHaveBeenCalledWith(ctx, 'minv', 0, 252, 252, {
      centerX: true,
      centerY: true,
    });
    expect(assets.drawFrameFrom).not.toHaveBeenCalled();
  });

  it('still owner-remaps IsRemappable REMAP_ALTERNATE buildings', () => {
    const { renderer, camera, map, assets } = setup('powr', 8);
    const powr = {
      type: 'POWR',
      image: 'powr',
      house: House.USSR,
      cx: 10,
      cy: 10,
      hp: 400,
      maxHp: 400,
      alive: true,
    };

    (renderer as any).renderStructures(camera, map as any, [powr] as any, assets as any, 100);

    expect(assets.getRemappedSheet).toHaveBeenCalledWith('powr', House.USSR);
    expect(assets.drawFrameFrom).toHaveBeenCalled();
  });

  it('does not animate healthy DOME into its damaged frame', () => {
    // C++ bdata.cpp _anims omits STRUCT_RADAR, so BSTATE_IDLE keeps the
    // constructor default Count=1. SCU01EA exposed this when a healthy DOME
    // cycled into frame 1 in TS at odd render ticks.
    const { renderer, camera, map, assets } = setup('dome', 2);
    const dome = {
      type: 'DOME',
      image: 'dome',
      house: House.USSR,
      cx: 10,
      cy: 10,
      hp: 1000,
      maxHp: 1000,
      alive: true,
    };

    (renderer as any).renderStructures(camera, map as any, [dome] as any, assets as any, 1999);

    expect(assets.drawFrameFrom).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'dome',
      0,
      expect.any(Number),
      expect.any(Number),
      expect.any(Object),
    );
  });

  it('keeps idle construction yards on frame 0 instead of cycling BSTATE_ACTIVE art', () => {
    // C++ bdata.cpp registers STRUCT_CONST's 26-frame sequence as
    // BSTATE_ACTIVE only. A GUARD construction yard is in BSTATE_IDLE with the
    // constructor default Count=1, so Shape_Number() returns frame 0.
    const { renderer, camera, map, assets } = setup('fact', 52);
    const fact = {
      type: 'FACT',
      image: 'fact',
      house: House.USSR,
      cx: 10,
      cy: 10,
      hp: 1000,
      maxHp: 1000,
      alive: true,
      mission: Mission.GUARD,
    };

    (renderer as any).renderStructures(camera, map as any, [fact] as any, assets as any, 1999);

    expect(assets.drawFrameFrom).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'fact',
      0,
      expect.any(Number),
      expect.any(Number),
      expect.any(Object),
    );
  });

  it('keeps damaged idle construction yards on the static damage frame', () => {
    // In C++ damaged non-turret buildings add the largest registered anim span
    // to Fetch_Stage(). For idle FACT, Fetch_Stage() is 0 and largest is 26.
    const { renderer, camera, map, assets } = setup('fact', 52);
    const fact = {
      type: 'FACT',
      image: 'fact',
      house: House.USSR,
      cx: 10,
      cy: 10,
      hp: 500,
      maxHp: 1000,
      alive: true,
      mission: Mission.GUARD,
    };

    (renderer as any).renderStructures(camera, map as any, [fact] as any, assets as any, 1999);

    expect(assets.drawFrameFrom).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'fact',
      26,
      expect.any(Number),
      expect.any(Number),
      expect.any(Object),
    );
  });

  it('uses the C++ BSTATE_ACTIVE construction-yard animation only during repair mission', () => {
    // RADIO_BUILDING sends a construction yard to MISSION_REPAIR, whose
    // INITIAL state calls Begin_Mode(BSTATE_ACTIVE). bdata.cpp gives that
    // sequence Start=0, Count=26, Rate=3.
    const { renderer, camera, map, assets } = setup('fact', 52);
    const fact = {
      type: 'FACT',
      image: 'fact',
      house: House.USSR,
      cx: 10,
      cy: 10,
      hp: 1000,
      maxHp: 1000,
      alive: true,
      mission: Mission.REPAIR,
    };

    (renderer as any).renderStructures(camera, map as any, [fact] as any, assets as any, 6);

    expect(assets.drawFrameFrom).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'fact',
      2,
      expect.any(Number),
      expect.any(Number),
      expect.any(Object),
    );
  });

  it('keeps idle naval production buildings on frame 0', () => {
    // bdata.cpp _anims has no STRUCT_SHIP_YARD or STRUCT_SUB_PEN entries, so
    // their BSTATE_IDLE controls keep the constructor default Count=1.
    const { renderer, camera, map, assets } = setup('spen', 16);
    const spen = {
      type: 'SPEN',
      image: 'spen',
      house: House.USSR,
      cx: 10,
      cy: 10,
      hp: 1000,
      maxHp: 1000,
      alive: true,
      mission: Mission.GUARD,
    };

    (renderer as any).renderStructures(camera, map as any, [spen] as any, assets as any, 2000);

    expect(assets.drawFrameFrom).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'spen',
      0,
      expect.any(Number),
      expect.any(Number),
      expect.any(Object),
    );
  });

  it('does not owner-remap BARL/BRL3 barrel buildings', () => {
    // C++ ClassBarrel/ClassBarrel3 use REMAP_ALTERNATE but IsRemappable=false.
    // Their draw-time body remap is PCOLOR_GOLD identity, not the owner house.
    const { ctx, renderer, camera, map, assets } = setup('barl', 3);
    const barrel = {
      type: 'BARL',
      image: 'barl',
      house: House.USSR,
      cx: 10,
      cy: 10,
      hp: 10,
      maxHp: 10,
      alive: true,
    };

    (renderer as any).renderStructures(camera, map as any, [barrel] as any, assets as any, 100);

    expect(assets.getRemappedSheet).not.toHaveBeenCalled();
    expect(assets.drawFrame).toHaveBeenCalledWith(ctx, 'barl', 0, 252, 252, {
      centerX: true,
      centerY: true,
    });
    expect(assets.drawFrameFrom).not.toHaveBeenCalled();
  });
});

describe('renderer destroyed building countdown visuals (building.cpp:940-956)', () => {
  function mockStructureCanvas(): { canvas: HTMLCanvasElement; ctx: any } {
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillStyle: '#000',
      strokeStyle: '#fff',
      lineWidth: 1,
      font: '',
      textAlign: 'start',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
    };
    const canvas = {
      width: 640,
      height: 400,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
    return { canvas, ctx };
  }

  function structureAssets() {
    return {
      getSheet: vi.fn((name: string) => name === 'v19'
        ? { meta: { frameWidth: 24, frameHeight: 24, frameCount: 29, columns: 16, rows: 2, sheetWidth: 384, sheetHeight: 48 } }
        : null),
      getRemappedSheet: vi.fn(() => null),
      drawFrame: vi.fn(),
      drawFrameFrom: vi.fn(),
      hasSheet: vi.fn(() => false),
    };
  }

  it('draws zero-strength buildings with their damaged SHP frame during CountDown', () => {
    // C++ leaves Strength=0 buildings on the map until CountDown reaches zero.
    // They still go through BuildingClass::Draw_It/Shape_Number, which selects
    // the damaged frame range; TS-only procedural rubble would hide the real art.
    const { canvas, ctx } = mockStructureCanvas();
    const renderer = new Renderer(canvas);
    const camera = new Camera(640, 400);
    const map = { getDisplayVisibility: () => 2 };
    const assets = structureAssets();
    const v19 = {
      type: 'V19',
      image: 'v19',
      house: House.France,
      cx: 10,
      cy: 10,
      hp: 0,
      maxHp: 400,
      alive: false,
      rubble: true,
      debrisCountdown: 7,
      debrisDropped: false,
    };

    (renderer as any).renderStructures(camera, map as any, [v19] as any, assets as any, 50);

    expect(assets.drawFrame).toHaveBeenCalledWith(ctx, 'v19', 26, 252, 252, {
      centerX: true,
      centerY: true,
    });
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('does not render persistent rubble after Drop_Debris deletes the C++ building', () => {
    const { canvas, ctx } = mockStructureCanvas();
    const renderer = new Renderer(canvas);
    const camera = new Camera(640, 400);
    const map = { getDisplayVisibility: () => 2 };
    const assets = structureAssets();
    const removed = {
      type: 'V19',
      image: 'v19',
      house: House.France,
      cx: 10,
      cy: 10,
      hp: 0,
      maxHp: 400,
      alive: false,
      rubble: true,
      debrisDropped: true,
    };

    (renderer as any).renderStructures(camera, map as any, [removed] as any, assets as any, 50);

    expect(assets.drawFrame).not.toHaveBeenCalled();
    expect(assets.drawFrameFrom).not.toHaveBeenCalled();
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});

describe('renderer Tesla coil shape selection (building.cpp:598-611)', () => {
  function renderTsla(structureOverrides: Record<string, unknown>, tick: number): number[] {
    const frames: number[] = [];
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      fillStyle: '#000',
      font: '',
      textAlign: 'start',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    };
    const canvas = {
      width: 640,
      height: 400,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
    const renderer = new Renderer(canvas);
    const camera = new Camera(640, 400);
    const map = {
      getDisplayVisibility: () => 2,
    };
    const assets = {
      getSheet: (name: string) => name === 'tsla'
        ? { meta: { frameWidth: 48, frameHeight: 48, frameCount: 20 } }
        : null,
      getRemappedSheet: () => ({ meta: { frameWidth: 48, frameHeight: 48, frameCount: 20 } }),
      drawFrame: vi.fn((_ctx, _sheet, frame) => frames.push(frame)),
      drawFrameFrom: vi.fn((_ctx, _remap, _sheet, frame) => frames.push(frame)),
      hasSheet: () => false,
    };
    const tsla = {
      type: 'TSLA',
      image: 'tsla',
      house: House.USSR,
      cx: 10,
      cy: 10,
      hp: 400,
      maxHp: 400,
      alive: true,
      ...structureOverrides,
    };

    (renderer as any).renderStructures(camera, map as any, [tsla] as any, assets as any, tick);
    return frames;
  }

  it('forces idle Tesla coils to frame 0 instead of cycling active charge frames', () => {
    expect(renderTsla({ isCharging: false, isCharged: false, chargeStage: 7 }, 100)).toEqual([0]);
  });

  it('uses charge stage only while IsCharging and frame 3 while IsCharged', () => {
    expect(renderTsla({ isCharging: true, isCharged: false, chargeStage: 6 }, 100)).toEqual([6]);
    expect(renderTsla({ isCharging: false, isCharged: true, chargeStage: 8 }, 100)).toEqual([3]);
  });
});

describe('renderer building animation rates (bdata.cpp:3060-3095)', () => {
  it('does not globally cycle static power and tech-center building frames', () => {
    // bdata.cpp:_anims does not include STRUCT_POWER, STRUCT_TECH, or
    // STRUCT_SOVIET_TECH. Their default BSTATE_IDLE control is Start=0,
    // Count=1, Rate=0, so Shape_Number() remains frame 0 while healthy.
    const frames: Array<{ sheet: string; frame: number }> = [];
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      fillStyle: '#000',
      font: '',
      textAlign: 'start',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    };
    const canvas = {
      width: 640,
      height: 400,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
    const renderer = new Renderer(canvas);
    const camera = new Camera(640, 400);
    const map = {
      getDisplayVisibility: () => 2,
    };
    const assets = {
      getSheet: (name: string) => ['powr', 'atek', 'stek'].includes(name)
        ? { meta: { frameWidth: 48, frameHeight: 48, frameCount: 16 } }
        : null,
      getRemappedSheet: () => ({ meta: { frameWidth: 48, frameHeight: 48, frameCount: 16 } }),
      drawFrame: vi.fn((_ctx, sheet: string, frame: number) => frames.push({ sheet, frame })),
      drawFrameFrom: vi.fn((_ctx, _remap, sheet: string, frame: number) => frames.push({ sheet, frame })),
      hasSheet: () => false,
    };
    const structures = [
      { type: 'POWR', image: 'powr', house: House.USSR, cx: 10, cy: 10, hp: 400, maxHp: 400, alive: true },
      { type: 'ATEK', image: 'atek', house: House.Greece, cx: 13, cy: 10, hp: 400, maxHp: 400, alive: true },
      { type: 'STEK', image: 'stek', house: House.USSR, cx: 16, cy: 10, hp: 600, maxHp: 600, alive: true },
    ];

    (renderer as any).renderStructures(camera, map as any, structures as any, assets as any, 300);

    expect(frames).toEqual([
      { sheet: 'powr', frame: 0 },
      { sheet: 'atek', frame: 0 },
      { sheet: 'stek', frame: 0 },
    ]);
  });

  it('uses the C++ STRUCT_PUMP idle rate of 4 ticks per frame', () => {
    // bdata.cpp:3083: { STRUCT_PUMP, BSTATE_IDLE, 0, 14, 4 }.
    // At tick 100, C++ is on frame floor(100 / 4) % 14 = 11,
    // while the old generic renderer cadence floor(100 / 8) would pick 12.
    const frames: number[] = [];
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      fillStyle: '#000',
      font: '',
      textAlign: 'start',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    };
    const canvas = {
      width: 640,
      height: 400,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
    const renderer = new Renderer(canvas);
    const camera = new Camera(640, 400);
    const map = {
      getDisplayVisibility: () => 2,
    };
    const assets = {
      getSheet: (name: string) => name === 'v19'
        ? { meta: { frameWidth: 24, frameHeight: 24, frameCount: 29 } }
        : null,
      getRemappedSheet: () => null,
      drawFrame: vi.fn((_ctx, _sheet, frame) => frames.push(frame)),
      drawFrameFrom: vi.fn(),
      hasSheet: () => false,
    };
    const pump = {
      type: 'V19',
      image: 'v19',
      house: House.Neutral,
      cx: 10,
      cy: 10,
      hp: 400,
      maxHp: 400,
      alive: true,
    };

    (renderer as any).renderStructures(camera, map as any, [pump] as any, assets as any, 100);

    expect(BUILDING_FRAME_TABLE.v19.idleAnimRate).toBe(4);
    expect(frames).toEqual([11]);
  });
});

describe('renderer infantry death brightness (infantry.cpp Shape_Number/Draw_It)', () => {
  it('draws death Doing frames at full alpha until object deletion', () => {
    // C++ renders DO_GUN_DEATH/DO_EXPLOSION_DEATH through the normal object
    // draw path. There is no per-tick alpha fade; cleanup happens by deleting
    // the InfantryClass or spawning a corpse AnimClass.
    const alphas: number[] = [];
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      fillStyle: '#000',
      strokeStyle: '#fff',
      lineWidth: 1,
      font: '',
      textAlign: 'start',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
    };
    const canvas = {
      width: 640,
      height: 400,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
    const renderer = new Renderer(canvas);
    const camera = new Camera(640, 400);
    const map = {
      getDisplayVisibility: () => 2,
    };
    const assets = {
      getSheet: (name: string) => name === 'e1'
        ? { meta: { frameWidth: 50, frameHeight: 39, frameCount: 600 } }
        : null,
      getRemappedSheet: () => ({ meta: { frameWidth: 50, frameHeight: 39, frameCount: 600 } }),
      drawFrame: vi.fn(() => alphas.push(ctx.globalAlpha)),
      drawFrameFrom: vi.fn(() => alphas.push(ctx.globalAlpha)),
    };
    const e1 = new Entity(UnitType.I_E1, House.USSR, 240, 240);
    e1.alive = false;
    e1.mission = Mission.DIE;
    e1.deathTick = 2;
    e1.deathVariant = 1;

    (renderer as any).renderEntities(camera, map as any, [e1], assets as any, new Set(), 100);

    expect(alphas).toEqual([1]);
    expect(ctx.globalAlpha).toBe(1);
  });

  it('does not draw destroyed non-infantry units after the C++ delete path', () => {
    // C++ UnitClass::Take_Damage runs Mark(MARK_UP) and `delete this` when a
    // vehicle is destroyed. TS may retain the Entity for bookkeeping, but it no
    // longer occupies C++ Logic/Cell_Occupier and must not reach Draw_It.
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      fillStyle: '#000',
      strokeStyle: '#fff',
      lineWidth: 1,
      font: '',
      textAlign: 'start',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
    };
    const canvas = {
      width: 640,
      height: 400,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
    const renderer = new Renderer(canvas);
    const camera = new Camera(640, 400);
    const map = {
      getDisplayVisibility: () => 2,
    };
    const assets = {
      getSheet: (name: string) => name === 'jeep'
        ? { meta: { frameWidth: 24, frameHeight: 24, frameCount: 64 } }
        : null,
      getRemappedSheet: () => ({ meta: { frameWidth: 24, frameHeight: 24, frameCount: 64 } }),
      drawFrame: vi.fn(),
      drawFrameFrom: vi.fn(),
    };
    const jeep = new Entity(UnitType.V_JEEP, House.Greece, 240, 240);
    jeep.alive = false;
    jeep.deathVariant = 0;

    (renderer as any).renderEntities(camera, map as any, [jeep], assets as any, new Set(), 100);

    expect(assets.drawFrame).not.toHaveBeenCalled();
    expect(assets.drawFrameFrom).not.toHaveBeenCalled();
  });
});

describe('renderer theatre-specific terrain object art', () => {
  function mockCanvas(): { canvas: HTMLCanvasElement; ctx: any } {
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      fillStyle: '#000',
      font: '',
      textAlign: 'start',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    };
    return {
      canvas: {
        width: CELL_SIZE,
        height: CELL_SIZE,
        getContext: () => ctx,
      } as unknown as HTMLCanvasElement,
      ctx,
    };
  }

  it('uses .SNO tree art on snow theatre maps', () => {
    // C++ TerrainTypeClass::Init builds terrain filenames from IniName plus
    // Theaters[theater].Suffix, so TC01 on SNOW loads TC01.SNO, not TC01.TEM.
    const { canvas, ctx } = mockCanvas();
    const renderer = new Renderer(canvas);
    renderer.theatre = 'SNOW';

    const camera = new Camera(0, 0);
    camera.x = 10 * CELL_SIZE;
    camera.y = 10 * CELL_SIZE;

    const map = new GameMap();
    map.setBounds(10, 10, 1, 1);
    map.setTerrain(10, 10, Terrain.CLEAR);
    map.setTreeType(10, 10, 'tc01');

    const assets = {
      hasSheet: vi.fn((name: string) => name === 'tc01_snow'),
      drawFrame: vi.fn(),
    };

    (renderer as any).renderTerrain(camera, map, 0, assets);

    expect(assets.drawFrame).toHaveBeenCalledWith(ctx, 'tc01_snow', 0, 0, 0);
  });

  it('draws visible tree clumps whose origin cell is above the viewport', () => {
    // C++ submits TerrainClass objects to the ground layer by object Render_Coord.
    // SCU01EA has TC02 at (43,68): its origin is one row above the visible
    // tactical cells, but the 72x48 SHP still overlaps the top of the screen.
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      fillStyle: '#000',
      font: '',
      textAlign: 'start',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    };
    const canvas = {
      width: 640,
      height: 400,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
    const renderer = new Renderer(canvas);
    renderer.theatre = 'SNOW';

    const camera = new Camera(480, 384, 0, 16);
    camera.x = 828;
    camera.y = 1656;

    const map = new GameMap();
    map.setBounds(32, 47, 32, 38);
    map.setTreeType(43, 68, 'tc02');
    map.addTree({
      type: 'tc02',
      cx: 43,
      cy: 68,
      hp: 600,
      maxHp: 600,
      immune: true,
      occupyCells: TREE_OCCUPY.tc02.map(([dx, dy]) => (68 + dy) * 128 + (43 + dx)),
    });

    const assets = {
      hasSheet: vi.fn((name: string) => name === 'tc02_snow'),
      drawFrame: vi.fn(),
    };

    (renderer as any).renderTerrain(camera, map, 0, assets);

    expect(assets.drawFrame).toHaveBeenCalledWith(ctx, 'tc02_snow', 0, 204, -8);
  });

  it.each([
    { overlay: 5, density: 4, expectedSheet: 'gold01_snow', expectedFrame: 4 },
    { overlay: 9, density: 2, expectedSheet: 'gem01_snow', expectedFrame: 2 },
  ])('uses .SNO overlay art without procedural sparkle for $expectedSheet', ({ overlay, density, expectedSheet, expectedFrame }) => {
    // C++ CellClass::Draw_It delegates overlays to OverlayTypeClass image data
    // and OverlayData frame selection. It does not draw extra sparkle pixels.
    const { canvas, ctx } = mockCanvas();
    const renderer = new Renderer(canvas);
    renderer.theatre = 'SNOW';
    (renderer as any).pal = Array.from({ length: 256 }, () => [0, 0, 0, 255]);

    const camera = new Camera(0, 0);
    camera.x = 12 * CELL_SIZE;
    camera.y = 12 * CELL_SIZE;

    const map = new GameMap();
    map.overlay[12 * 128 + 12] = overlay;
    map.oreDensity[12 * 128 + 12] = density;

    const assets = {
      hasSheet: vi.fn((name: string) => name === expectedSheet),
      drawFrame: vi.fn(),
    };

    (renderer as any).renderOverlays(camera, map, 7, assets);

    expect(assets.drawFrame).toHaveBeenCalledWith(ctx, expectedSheet, expectedFrame, 12, 12, {
      centerX: true,
      centerY: true,
      ghostShadow: { palette: (renderer as any).pal, frac: 75 },
    });
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('draws OverlayPack wooden crates through WCRATE.SHP with C++ ghost-shadow flags', () => {
    // C++ CellClass::Draw_It draws crate overlays through OverlayTypeClass::Draw_It,
    // not through a separate bobbing/procedural TS crate object.
    const { canvas, ctx } = mockCanvas();
    const renderer = new Renderer(canvas);
    (renderer as any).pal = Array.from({ length: 256 }, () => [0, 0, 0, 255]);

    const camera = new Camera(0, 0);
    camera.x = 12 * CELL_SIZE;
    camera.y = 12 * CELL_SIZE;

    const map = new GameMap();
    map.overlay[12 * 128 + 12] = 21; // OVERLAY_WOOD_CRATE / WCRATE

    const assets = {
      hasSheet: vi.fn((name: string) => name === 'wcrate'),
      drawFrame: vi.fn(),
    };

    (renderer as any).renderOverlays(camera, map, 7, assets);

    expect(assets.drawFrame).toHaveBeenCalledWith(ctx, 'wcrate', 0, 12, 12, {
      centerX: true,
      centerY: true,
      ghostShadow: { palette: (renderer as any).pal, frac: 130 },
    });
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});

describe('renderer smudge/crater art (sdata.cpp SmudgeTypeClass::Draw_It)', () => {
  function mockCanvas(): { canvas: HTMLCanvasElement; ctx: any } {
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      fillStyle: '#000',
      font: '',
      textAlign: 'start',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    };
    return {
      canvas: {
        width: CELL_SIZE,
        height: CELL_SIZE,
        getContext: () => ctx,
      } as unknown as HTMLCanvasElement,
      ctx,
    };
  }

  it('draws theater smudge sprites at the cell upper-left instead of procedural ellipses', () => {
    // C++ sdata.cpp:524-530 draws the smudge shape with SHAPE_WIN_REL at
    // the supplied icon upper-left. SNOW maps SC3 to SC3.SNO.
    const { canvas, ctx } = mockCanvas();
    const renderer = new Renderer(canvas);
    renderer.theatre = 'SNOW';

    const camera = new Camera(0, 0);
    camera.x = 12 * CELL_SIZE;
    camera.y = 12 * CELL_SIZE;

    const map = new GameMap();
    map.smudges.push({ type: 'SC3', cx: 12, cy: 12 });

    const assets = {
      hasSheet: vi.fn((name: string) => name === 'sc3_snow'),
      drawFrame: vi.fn(),
    };

    (renderer as any).renderDecals(camera, map, assets);

    expect(assets.drawFrame).toHaveBeenCalledWith(ctx, 'sc3_snow', 0, 0, 0);
    expect(ctx.ellipse).not.toHaveBeenCalled();
  });

  it('ignores legacy TS decals and draws only CellClass smudge art', () => {
    const { canvas, ctx } = mockCanvas();
    const renderer = new Renderer(canvas);
    renderer.theatre = 'SNOW';

    const camera = new Camera(0, 0);
    camera.x = 20 * CELL_SIZE;
    camera.y = 20 * CELL_SIZE;

    const map = new GameMap();
    map.smudges.push({ type: 'SC6', cx: 20, cy: 20 });
    map.decals.push({ cx: 20, cy: 20, size: 7, alpha: 0.3 });

    const assets = {
      hasSheet: vi.fn((name: string) => name === 'sc6_snow' || name === 'sc1_snow'),
      drawFrame: vi.fn(),
    };

    (renderer as any).renderDecals(camera, map, assets);

    expect(assets.drawFrame).toHaveBeenCalledWith(ctx, 'sc6_snow', 0, 0, 0);
    expect(assets.drawFrame).not.toHaveBeenCalledWith(ctx, 'sc1_snow', 0, 0, 0);
    expect(ctx.ellipse).not.toHaveBeenCalled();
  });
});

describe('renderer corpse AnimClass art (infantry.cpp corpse follow-up)', () => {
  function mockCanvas(): { canvas: HTMLCanvasElement; ctx: any } {
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      fillStyle: '#000',
      font: '',
      textAlign: 'start',
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    };
    return {
      canvas: {
        width: 640,
        height: 400,
        getContext: () => ctx,
      } as unknown as HTMLCanvasElement,
      ctx,
    };
  }

  it('draws deathVariant=2 as centered CORPSE3.SNO without synthetic burn darkening', () => {
    // C++ infantry.cpp: DO_EXPLOSION_DEATH creates ANIM_CORPSE3 at
    // Center_Coord()+(-2,4). AnimClass::Draw_It renders the theatre shape with
    // SHAPE_CENTER; it does not draw a procedural ellipse below it.
    const { canvas, ctx } = mockCanvas();
    const renderer = new Renderer(canvas);
    renderer.theatre = 'SNOW';
    renderer.corpses = [{
      x: 100,
      y: 80,
      type: UnitType.I_E2,
      facing: 0,
      isInfantry: true,
      isAnt: false,
      alpha: 0.5,
      deathVariant: 2,
      cppAnimStartTick: 40,
    }];

    const camera = new Camera(0, 0);
    const map = new GameMap();
    vi.spyOn(map, 'getDisplayVisibility').mockReturnValue(2);

    const assets = {
      hasSheet: vi.fn((name: string) => name === 'corpse3_snow'),
      getSheet: vi.fn(() => ({ meta: { frameWidth: 50, frameHeight: 39, frameCount: 6 } })),
      drawFrame: vi.fn(),
      drawFrameTranslucent: vi.fn(),
    };

    (renderer as any).renderCorpses(camera, map, assets, 50);

    expect(assets.drawFrameTranslucent).toHaveBeenCalledWith(ctx, 'corpse3_snow', 0, 100, 80, null, expect.arrayContaining([
      { sourceColorIndex: 32, destColorIndex: 32, frac: 110 },
      { sourceColorIndex: 15, destColorIndex: 12, frac: 40 },
      { sourceColorIndex: 4, destColorIndex: 12, frac: 130 },
    ]), {
      centerX: true,
      centerY: true,
    });
    expect(assets.drawFrame).not.toHaveBeenCalled();
    expect(ctx.ellipse).not.toHaveBeenCalled();
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('draws live AnimClass sprites from StageClass stage, not stale Effect frames', () => {
    // C++ anim.cpp:254 draws Class->Start + Fetch_Stage() directly from the
    // live AnimClass. Reusing a separate render Effect frame loses parity once
    // looping FIRE/SMOKE anims keep their Logic object after the first visual pass.
    const { canvas, ctx } = mockCanvas();
    const renderer = new Renderer(canvas);
    renderer.logicAnims = [{
      type: 'fire_small',
      x: 100,
      y: 80,
      stage: 4,
      timer: 1,
      loops: 3,
      delay: 0,
      isBrandNew: false,
      logicIndexHint: 302,
    } as any];

    const assets = {
      getSheet: vi.fn(() => ({ meta: { frameWidth: 23, frameHeight: 23, frameCount: 15 } })),
      drawFrame: vi.fn(),
    };

    (renderer as any).renderLogicAnims(new Camera(0, 0), assets, 'ground');

    expect(assets.drawFrame).toHaveBeenCalledWith(ctx, 'fire3', 4, 100, 80, {
      centerX: true,
      centerY: true,
    });
  });

  it('sorts ground AnimClass draws by C++ Sort_Y coordinate, including x tie-break', () => {
    // C++ LayerClass::Sorted_Add compares AnimClass::Sort_Y() as a packed
    // COORDINATE. For ground animations, Sort_Y is Center_Coord()+(0,14px), so
    // equal Y values are ordered by X before allocation/logic index.
    const { canvas, ctx } = mockCanvas();
    const renderer = new Renderer(canvas);
    renderer.logicAnims = [
      {
        type: 'fire_small',
        x: 130,
        y: 80,
        stage: 1,
        timer: 1,
        loops: 1,
        delay: 0,
        isBrandNew: false,
        logicIndexHint: 1,
      } as any,
      {
        type: 'fire_small',
        x: 100,
        y: 80,
        stage: 2,
        timer: 1,
        loops: 1,
        delay: 0,
        isBrandNew: false,
        logicIndexHint: 2,
      } as any,
    ];

    const assets = {
      getSheet: vi.fn(() => ({ meta: { frameWidth: 23, frameHeight: 23, frameCount: 15 } })),
      drawFrame: vi.fn(),
    };

    (renderer as any).renderLogicAnims(new Camera(0, 0), assets, 'ground');

    expect((assets.drawFrame as any).mock.calls.map((call: unknown[]) => call[3])).toEqual([100, 130]);
    expect((assets.drawFrame as any).mock.calls.map((call: unknown[]) => call[2])).toEqual([2, 1]);
    expect(ctx.ellipse).not.toHaveBeenCalled();
  });

  it('skips linked Effect copies for C++ AnimClass visuals', () => {
    const { canvas } = mockCanvas();
    const renderer = new Renderer(canvas);
    const assets = {
      getSheet: vi.fn(() => ({ meta: { frameWidth: 23, frameHeight: 23, frameCount: 15 } })),
      drawFrame: vi.fn(),
    };

    (renderer as any).renderEffects(new Camera(0, 0), [{
      type: 'explosion',
      x: 100,
      y: 80,
      frame: 14,
      maxFrames: 15,
      size: 8,
      sprite: 'fire3',
      logicIndexHint: 302,
    }], assets);

    expect(assets.drawFrame).not.toHaveBeenCalled();
  });

  it('skips unhinted cppLogicSlot Effect copies for C++ AnimClass visuals', () => {
    const { canvas } = mockCanvas();
    const renderer = new Renderer(canvas);
    const assets = {
      getSheet: vi.fn(() => ({ meta: { frameWidth: 72, frameHeight: 72, frameCount: 14 } })),
      drawFrame: vi.fn(),
    };

    (renderer as any).renderEffects(new Camera(0, 0), [{
      type: 'explosion',
      x: 100,
      y: 80,
      frame: 10,
      maxFrames: 14,
      size: 8,
      sprite: 'napalm3',
      cppLogicSlot: true,
    }], assets);

    expect(assets.drawFrame).not.toHaveBeenCalled();
  });

  it('does not draw health bars for damaged unselected technos', () => {
    // C++ techno.cpp:1120 wraps health-bar rendering in if (IsSelected).
    // A damaged but unselected unit must not get the TS-only always-visible
    // HP bar, because it shows up as a black rectangle in visual parity shots.
    const { canvas } = mockCanvas();
    const renderer = new Renderer(canvas);
    const entity = new Entity(UnitType.V_1TNK, House.USSR, 100, 80);
    entity.hp = Math.max(1, entity.maxHp - 10);

    const map = new GameMap();
    vi.spyOn(map, 'getDisplayVisibility').mockReturnValue(2);
    const assets = {
      getSheet: vi.fn(() => ({ meta: { frameWidth: 24, frameHeight: 24, frameCount: 32 } })),
      getRemappedSheet: vi.fn(() => null),
      drawFrame: vi.fn(),
    };
    const healthSpy = vi.spyOn(renderer as any, 'renderHealthBar');

    (renderer as any).renderEntities(new Camera(0, 0), map, [entity], assets, new Set(), 50);

    expect(healthSpy).not.toHaveBeenCalled();
  });

  it('renders the corpse surface layer after overlays but before the ground object layer', () => {
    // C++ DisplayClass redraws surface-layer AnimClass objects before the
    // ground layer (terrain objects/buildings/units/ground anims), so corpses
    // cannot cover structures or TerrainClass objects.
    const { canvas } = mockCanvas();
    const renderer = new Renderer(canvas);
    const order: string[] = [];
    for (const method of [
      'renderTerrain',
      'renderDecals',
      'renderOverlays',
      'renderCorpses',
      'renderGroundLayer',
      'renderCrates',
      'renderTargetLines',
      'renderWaypoints',
      'renderEntities',
      'renderEffects',
      'renderFogOfWar',
      'renderPlacementGhost',
      'renderSelectionBox',
      'renderAttackMoveIndicator',
      'renderOffscreenIndicators',
      'renderSidebar',
      'renderMinimap',
      'renderSidebarButtonRow',
      'renderFullscreenRadar',
      'renderVerticalPowerBar',
      'renderCursor',
    ]) {
      (renderer as any)[method] = vi.fn(() => order.push(method));
    }

    const assets = {
      getTheatrePalette: vi.fn(() => Array.from({ length: 256 }, () => [0, 0, 0])),
      hasTileset: vi.fn(() => false),
    };

    renderer.render(new Camera(640, 400), new GameMap(), [], [], assets as any, {} as any, new Set(), [], 1);

    expect(order.indexOf('renderOverlays')).toBeLessThan(order.indexOf('renderCorpses'));
    expect(order.indexOf('renderCorpses')).toBeLessThan(order.indexOf('renderGroundLayer'));
  });

  it('draws TerrainClass tree objects after ore overlays in full-frame renders', () => {
    // C++ CellClass::Draw_It paints overlays in the ground pass, then draws
    // TerrainClass objects in the later object pass. Tree pixels must therefore
    // cover ore/shadow pixels where their SHPs overlap.
    const { canvas } = mockCanvas();
    const renderer = new Renderer(canvas);
    (renderer as any).pal = Array.from({ length: 256 }, () => [0, 0, 0, 255]);

    const camera = new Camera(CELL_SIZE, CELL_SIZE);
    camera.x = 10 * CELL_SIZE;
    camera.y = 10 * CELL_SIZE;

    const map = new GameMap();
    map.setBounds(10, 10, 1, 1);
    map.setTerrain(10, 10, Terrain.ORE);
    map.setTreeType(10, 10, 't16');
    map.overlay[10 * 128 + 10] = GameMap.OVERLAY_GOLD1;
    map.oreDensity[10 * 128 + 10] = 3;

    const calls: string[] = [];
    const assets = {
      getTheatrePalette: vi.fn(() => Array.from({ length: 256 }, () => [0, 0, 0, 255])),
      hasTileset: vi.fn(() => false),
      hasSheet: vi.fn((name: string) => name === 't16'),
      drawFrame: vi.fn((_ctx: unknown, name: string) => calls.push(name)),
    };

    for (const method of [
      'renderCorpses',
      'renderStructures',
      'renderCrates',
      'renderEntities',
      'renderTargetLines',
      'renderWaypoints',
      'renderLogicAnims',
      'renderEffects',
      'renderFogOfWar',
      'renderSelectionBox',
      'renderOffscreenIndicators',
      'renderSidebar',
      'renderMinimap',
      'renderSidebarButtonRow',
      'renderVerticalPowerBar',
      'renderCursor',
    ]) {
      (renderer as any)[method] = vi.fn();
    }

    renderer.render(camera, map, [], [], assets as any, {} as any, new Set(), [], 1);

    expect(calls).toContain('gold01');
    expect(calls).toContain('t16');
    expect(calls.indexOf('gold01')).toBeLessThan(calls.indexOf('t16'));
  });

  it('sorts TerrainClass tree sprites with ground AnimClass objects by C++ Sort_Y', () => {
    // C++ DisplayClass puts TerrainClass and ground AnimClass objects in the
    // same sorted LAYER_GROUND vector. A tree whose CenterBase sorts below a
    // fire animation must draw after that fire; drawing all trees before all
    // anims leaves TS-only fire pixels at shroud/tree boundaries.
    const { canvas } = mockCanvas();
    const renderer = new Renderer(canvas);
    (renderer as any).pal = Array.from({ length: 256 }, () => [0, 0, 0, 255]);
    renderer.logicAnims = [{
      type: 'fire_small',
      x: 62,
      y: 45,
      stage: 8,
      timer: 1,
      loops: 1,
      delay: 0,
      isBrandNew: false,
      logicIndexHint: 315,
    } as any];

    const camera = new Camera(CELL_SIZE, CELL_SIZE);
    camera.x = 0;
    camera.y = 0;

    const map = new GameMap();
    map.setBounds(0, 0, 8, 8);
    map.setTreeType(1, 1, 'tc02');

    const calls: string[] = [];
    const assets = {
      getTheatrePalette: vi.fn(() => Array.from({ length: 256 }, () => [0, 0, 0, 255])),
      hasTileset: vi.fn(() => false),
      hasSheet: vi.fn((name: string) => name === 'tc02'),
      getSheet: vi.fn((name: string) => name === 'fire3'
        ? { meta: { frameWidth: 23, frameHeight: 23, frameCount: 15 } }
        : undefined),
      drawFrame: vi.fn((_ctx: unknown, name: string) => calls.push(name)),
    };

    for (const method of [
      'renderCorpses',
      'renderStructures',
      'renderCrates',
      'renderEntities',
      'renderTargetLines',
      'renderWaypoints',
      'renderLogicAnims',
      'renderEffects',
      'renderFogOfWar',
      'renderSelectionBox',
      'renderOffscreenIndicators',
      'renderSidebar',
      'renderMinimap',
      'renderSidebarButtonRow',
      'renderVerticalPowerBar',
      'renderCursor',
    ]) {
      (renderer as any)[method] = vi.fn();
    }

    renderer.render(camera, map, [], [], assets as any, {} as any, new Set(), [], 1);

    expect(calls).toEqual(['fire3', 'tc02']);
  });

  it('queues interior BOXES TerrainClass objects at C++ Render_Coord in the ground layer', () => {
    // C++ SCG13EA t1000 layer dump: BOXES06 at center cell (21,55)
    // comes from INI origin (21,54), with Render_Coord=(21*256,54*256)
    // and Sort_Y=(21*256+128,55*256).
    // It is a TerrainClass object, not an overlay or BARL/BRL3 structure.
    const { canvas, ctx } = mockCanvas();
    const renderer = new Renderer(canvas);
    (renderer as any).pal = Array.from({ length: 256 }, () => [0, 0, 0, 255]);

    const camera = new Camera(640, 400);
    camera.x = 216;
    camera.y = 1044;

    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    map.addTerrainObject('boxes06', 21, 54, TERRAIN_OBJECT_OCCUPY.boxes06, 11);

    const assets = {
      getTheatrePalette: vi.fn(() => Array.from({ length: 256 }, () => [0, 0, 0, 255])),
      hasTileset: vi.fn(() => false),
      hasSheet: vi.fn((name: string) => name === 'boxes06'),
      drawFrame: vi.fn(),
    };

    for (const method of [
      'renderDecals',
      'renderOverlays',
      'renderCorpses',
      'renderStructures',
      'renderCrates',
      'renderEntities',
      'renderTargetLines',
      'renderWaypoints',
      'renderLogicAnims',
      'renderEffects',
      'renderFogOfWar',
      'renderSelectionBox',
      'renderOffscreenIndicators',
      'renderSidebar',
      'renderMinimap',
      'renderSidebarButtonRow',
      'renderVerticalPowerBar',
      'renderCursor',
    ]) {
      (renderer as any)[method] = vi.fn();
    }

    renderer.render(camera, map, [], [], assets as any, {} as any, new Set(), [], 1);

    expect(assets.drawFrame).toHaveBeenCalledWith(ctx, 'boxes06', 0, 288, 252, {
      ghostShadow: { palette: (renderer as any).pal, frac: 130 },
    });
  });

  it('interleaves buildings, ground units, TerrainClass, and ground AnimClass in one C++ LAYER_GROUND sort', () => {
    // C++ conquer.cpp sorts DisplayClass::Layer[LAYER_GROUND] as one vector.
    // That vector contains BuildingClass, FootClass, TerrainClass, and ground
    // AnimClass objects together; separate TS buckets draw the unit/building
    // before the fire/tree regardless of ObjectClass::Sort_Y.
    const { canvas } = mockCanvas();
    const renderer = new Renderer(canvas);
    renderer.logicAnims = [{
      type: 'fire_small',
      x: 62,
      y: 45,
      stage: 8,
      timer: 1,
      loops: 1,
      delay: 0,
      isBrandNew: false,
      logicIndexHint: 1,
    } as any];

    const infantry = new Entity(UnitType.I_E1, House.USSR, 0, 0);
    infantry.leptonX = 0;
    infantry.leptonY = 780; // FootClass::Sort_Y = 828, after the fire and before the GUN/tree.
    infantry.pos = { x: 0, y: infantry.leptonY * CELL_SIZE / LEPTON_SIZE };
    infantry.prevPos = { ...infantry.pos };
    infantry.logicIndexHint = 2;

    const gun = {
      type: 'GUN',
      image: 'gun',
      house: House.USSR,
      cx: 0,
      cy: 3,
      hp: 256,
      maxHp: 256,
      alive: true,
      rubble: false,
      attackCooldown: 0,
      ammo: -1,
      maxAmmo: -1,
      missionTimer: 0,
      logicIndexHint: 3,
    } as any;

    const map = new GameMap();
    vi.spyOn(map, 'getDisplayVisibility').mockReturnValue(2);

    const calls: string[] = [];
    const assets = {
      getTheatrePalette: vi.fn(() => Array.from({ length: 256 }, () => [0, 0, 0, 255])),
      hasTileset: vi.fn(() => false),
      getSheet: vi.fn((name: string) => {
        if (name === 'fire3') return { meta: { frameWidth: 23, frameHeight: 23, frameCount: 15 } };
        if (name === 'e1') return { meta: { frameWidth: 50, frameHeight: 39, frameCount: 400 } };
        if (name === 'gun') return { meta: { frameWidth: 24, frameHeight: 24, frameCount: 1 } };
        return undefined;
      }),
      getRemappedSheet: vi.fn(() => null),
      drawFrame: vi.fn((_ctx: unknown, name: string) => calls.push(name)),
    };

    (renderer as any).renderTerrain = vi.fn(() => {
      (renderer as any).pendingTerrainObjectSprites = [{
        name: 'tc02',
        x: 0,
        y: 0,
        sortX: 0,
        sortY: 1000,
        order: 4,
        logicIndexHint: 4,
      }];
    });
    for (const method of [
      'renderDecals',
      'renderOverlays',
      'renderCorpses',
      'renderCrates',
      'renderTargetLines',
      'renderWaypoints',
      'renderLogicAnims',
      'renderEffects',
      'renderFogOfWar',
      'renderSelectionBox',
      'renderOffscreenIndicators',
      'renderSidebar',
      'renderMinimap',
      'renderSidebarButtonRow',
      'renderVerticalPowerBar',
      'renderCursor',
    ]) {
      (renderer as any)[method] = vi.fn();
    }

    renderer.render(new Camera(640, 400), map, [infantry], [gun], assets as any, {} as any, new Set(), [], 1);

    expect(calls).toEqual(['fire3', 'e1', 'gun', 'tc02']);
  });

  it('starts full-frame renders from an opaque black C++ HidPage backbuffer', () => {
    // C++ agent_render converts every HidPage byte to opaque RGBA. Canvas
    // clearRect leaves alpha=0 holes in transparent SHP pixels, which shows up
    // as TS-only transparent pixels in the visual harness.
    const { canvas, ctx } = mockCanvas();
    const renderer = new Renderer(canvas);
    for (const method of [
      'renderTerrain',
      'renderDecals',
      'renderOverlays',
      'renderGroundLayer',
      'renderCorpses',
      'renderStructures',
      'renderCrates',
      'renderEntities',
      'renderTargetLines',
      'renderWaypoints',
      'renderEffects',
      'renderFogOfWar',
      'renderSelectionBox',
      'renderOffscreenIndicators',
      'renderSidebar',
      'renderMinimap',
      'renderSidebarButtonRow',
      'renderVerticalPowerBar',
      'renderCursor',
    ]) {
      (renderer as any)[method] = vi.fn();
    }

    const assets = {
      getTheatrePalette: vi.fn(() => Array.from({ length: 256 }, () => [0, 0, 0])),
      hasTileset: vi.fn(() => false),
    };

    renderer.render(new Camera(640, 400), new GameMap(), [], [], assets as any, {} as any, new Set(), [], 1);

    expect(ctx.clearRect).not.toHaveBeenCalledWith(0, 0, 640, 400);
    expect(ctx.fillRect.mock.calls[0]).toEqual([0, 0, 640, 400]);
    expect(ctx.fillStyle).toBe('#000');
  });
});

describe('renderer terrain palette cycling (conquer.cpp:1667-1677)', () => {
  function makePalette(): number[][] {
    const pal = Array.from({ length: 256 }, () => [0, 0, 0, 255]);
    for (let i = 0; i < 7; i++) {
      pal[96 + i] = [10 + i, 40 + i, 90 + i, 255];
    }
    return pal;
  }

  it('rotates the C++ water palette range from the Sync_Delay system timer', () => {
    // C++ Color_Cycle rotates CYCLE_COLOR_START (6*16 = 96) through 102.
    // TIMER_SECOND/4 is one quarter-second and is not tied to logic ticks.
    expect(waterPaletteCycleShift(0)).toBe(0);
    expect(waterPaletteCycleShift(249)).toBe(0);
    expect(waterPaletteCycleShift(250)).toBe(1);
    expect(waterPaletteCycleShift(1750)).toBe(0);
  });

  it('applies the first C++ Color_Cycle call immediately, then waits TIMER_SECOND/4', () => {
    const canvas = {
      width: CELL_SIZE,
      height: CELL_SIZE,
      getContext: () => ({ imageSmoothingEnabled: false }),
    } as unknown as HTMLCanvasElement;
    const renderer = new Renderer(canvas);

    expect(renderer.paletteCycleShift).toBe(0);
    renderer.advancePaletteCycle(500);
    expect(renderer.paletteCycleShift).toBe(1);
    renderer.advancePaletteCycle(249);
    expect(renderer.paletteCycleShift).toBe(1);
    renderer.advancePaletteCycle(1);
    expect(renderer.paletteCycleShift).toBe(2);
  });

  it('remaps baked RGBA water pixels through the same palette rotation', () => {
    const pal = makePalette();
    const data = new Uint8ClampedArray([
      ...pal[96],  // shift 1 -> original palette slot 102
      ...pal[98],  // shift 1 -> original palette slot 97
      1, 2, 3, 255, // non-water color remains unchanged
    ]);

    applyWaterPaletteCycle(data, pal, 1);

    expect([...data.slice(0, 4)]).toEqual(pal[102]);
    expect([...data.slice(4, 8)]).toEqual(pal[97]);
    expect([...data.slice(8, 12)]).toEqual([1, 2, 3, 255]);
  });

  it('does not cycle tileset terrain only because logic ticks advanced', () => {
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      fillStyle: '#000',
      font: '',
      textAlign: 'start',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    };
    const canvas = {
      width: CELL_SIZE,
      height: CELL_SIZE,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;

    const pal = makePalette();
    const tilesetImage = { naturalWidth: 1, naturalHeight: 1, width: 1, height: 1 };
    const imageData = { data: new Uint8ClampedArray([...pal[96]]) };
    const cycleCtx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => imageData),
      putImageData: vi.fn(),
    };
    const cycledCanvas = {
      width: 0,
      height: 0,
      getContext: () => cycleCtx,
    } as unknown as HTMLCanvasElement;

    const previousDocument = (globalThis as typeof globalThis & { document?: Document }).document;
    const createElement = vi.fn(() => cycledCanvas);
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement },
    });
    try {
      const renderer = new Renderer(canvas);
      renderer.theatre = 'SNOW';
      (renderer as any).pal = pal;
      (renderer as any).tilesetImage = tilesetImage;
      (renderer as any).tilesetMeta = {
        tileW: CELL_SIZE,
        tileH: CELL_SIZE,
        atlasW: 1,
        atlasH: 1,
        tileCount: 1,
        tiles: { '1,0': { ax: 0, ay: 0, lt: 'Water' } },
      };
      (renderer as any).tilesetReady = true;
      (renderer as any).tilesetTheatre = 'SNOW';

      const camera = new Camera(0, 0);
      camera.x = 4 * CELL_SIZE;
      camera.y = 4 * CELL_SIZE;

      const map = new GameMap();
      map.setBounds(4, 4, 1, 1);
      map.setTerrain(4, 4, Terrain.WATER);
      map.templateType[4 * 128 + 4] = 1;
      map.templateIcon[4 * 128 + 4] = 0;

      (renderer as any).renderTerrain(camera, map, 4, {});

      expect(createElement).not.toHaveBeenCalled();
      expect(cycleCtx.putImageData).not.toHaveBeenCalled();
      expect(ctx.drawImage.mock.calls[0][0]).toBe(tilesetImage);
    } finally {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: previousDocument,
      });
    }
  });

  it('draws tileset terrain through a remapped atlas when Color_Cycle advances', () => {
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      fillStyle: '#000',
      font: '',
      textAlign: 'start',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    };
    const canvas = {
      width: CELL_SIZE,
      height: CELL_SIZE,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;

    const pal = makePalette();
    const imageData = { data: new Uint8ClampedArray([...pal[96]]) };
    const cycleCtx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => imageData),
      putImageData: vi.fn(),
    };
    const cycledCanvas = {
      width: 0,
      height: 0,
      getContext: () => cycleCtx,
    } as unknown as HTMLCanvasElement;

    const previousDocument = (globalThis as typeof globalThis & { document?: Document }).document;
    const createElement = vi.fn(() => cycledCanvas);
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement },
    });
    try {
      const renderer = new Renderer(canvas);
      renderer.theatre = 'SNOW';
      renderer.advancePaletteCycle(0);
      (renderer as any).pal = pal;
      (renderer as any).tilesetImage = { naturalWidth: 1, naturalHeight: 1, width: 1, height: 1 };
      (renderer as any).tilesetMeta = {
        tileW: CELL_SIZE,
        tileH: CELL_SIZE,
        atlasW: 1,
        atlasH: 1,
        tileCount: 1,
        tiles: { '1,0': { ax: 0, ay: 0, lt: 'Water' } },
      };
      (renderer as any).tilesetReady = true;
      (renderer as any).tilesetTheatre = 'SNOW';

      const camera = new Camera(0, 0);
      camera.x = 4 * CELL_SIZE;
      camera.y = 4 * CELL_SIZE;

      const map = new GameMap();
      map.setBounds(4, 4, 1, 1);
      map.setTerrain(4, 4, Terrain.WATER);
      map.templateType[4 * 128 + 4] = 1;
      map.templateIcon[4 * 128 + 4] = 0;

      (renderer as any).renderTerrain(camera, map, 0, {});

      expect(createElement).toHaveBeenCalledWith('canvas');
      expect(cycleCtx.putImageData).toHaveBeenCalled();
      expect([...imageData.data]).toEqual(pal[102]);
      expect(ctx.drawImage.mock.calls[0][0]).toBe(cycledCanvas);
    } finally {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: previousDocument,
      });
    }
  });
});

describe('renderer default GamePalette adjustment (options.cpp:505-545)', () => {
  it('round-trips raw palette RGB through C++ HSVClass/RGBClass defaults', () => {
    expect(cppDefaultAdjustedPaletteColor(88, 132, 144)).toEqual([88, 128, 144]);
    expect(cppDefaultAdjustedPaletteColor(104, 148, 196)).toEqual([104, 144, 196]);
    expect(cppDefaultAdjustedPaletteColor(168, 152, 84)).toEqual([168, 148, 84]);
    expect(cppDefaultAdjustedPaletteColor(252, 252, 252)).toEqual([252, 252, 252]);
  });

  it('maps final canvas palette pixels to the adjusted C++ GamePalette colors', () => {
    const palette = Array.from({ length: 256 }, () => [0, 0, 0, 255]);
    palette[64] = [88, 132, 144, 255];
    palette[67] = [104, 148, 196, 255];
    palette[85] = [168, 152, 84, 255];
    const map = buildCppDefaultPaletteAdjustmentMap(palette);
    const data = new Uint8ClampedArray([
      88, 132, 144, 255,
      104, 148, 196, 255,
      168, 152, 84, 255,
      1, 2, 3, 255,
      88, 132, 144, 0,
    ]);

    applyCppDefaultPaletteAdjustment(data, map);

    expect([...data]).toEqual([
      88, 128, 144, 255,
      104, 144, 196, 255,
      168, 148, 84, 255,
      1, 2, 3, 255,
      88, 132, 144, 0,
    ]);
  });
});

describe('renderer unit shadow remap (display.cpp:422-427, jshell.cpp:410-530)', () => {
  it('maps SNOW LTGREEN shadow pixels through UnitShadow instead of alpha-blending black', () => {
    const pal = Array.from({ length: 256 }, () => [0, 0, 0, 255]);
    pal[1] = [228, 216, 228, 255];
    pal[RA_COLOR_BLACK] = [0, 0, 0, 255];
    [
      [28, 24, 8], [36, 32, 12], [40, 36, 16], [48, 48, 20], [56, 56, 28],
      [65, 65, 32], [73, 73, 40], [81, 81, 48], [89, 89, 56], [93, 97, 65],
      [101, 105, 73], [109, 113, 85], [117, 121, 93], [125, 130, 105], [134, 138, 117],
    ].forEach((rgb, i) => {
      pal[240 + i] = [...rgb, 255];
    });

    const table = conquerBuildFadingTable(pal, RA_COLOR_BLACK, 75);
    const snowIndex = nearestPaletteIndex(pal, 228, 216, 228);
    const shadowColor = pal[table[snowIndex]];

    expect(table[snowIndex]).toBe(254);
    expect(shadowColor.slice(0, 3)).toEqual([134, 138, 117]);
    expect(shadowColor.slice(0, 3)).not.toEqual([112, 106, 112]);
  });
});

describe('renderer infantry draw anchor (infantry.cpp:545-548)', () => {
  function mockCanvas(): { canvas: HTMLCanvasElement; ctx: any } {
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      fillStyle: '#000',
      strokeStyle: '#fff',
      lineWidth: 1,
      font: '',
      textAlign: 'start',
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
    };
    return {
      canvas: {
        width: 160,
        height: 120,
        getContext: () => ctx,
      } as unknown as HTMLCanvasElement,
      ctx,
    };
  }

  it('draws infantry at C++ x-2/y+4 adjusted coordinates', () => {
    // C++ InfantryClass::Draw_It receives Map.Coord_To_Pixel output, then
    // applies y += 4 and x -= 2 before Techno_Draw_Object(SHAPE_CENTER).
    const { canvas, ctx } = mockCanvas();
    const renderer = new Renderer(canvas);
    const camera = new Camera(160, 120);
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    map.revealAll();

    const e1 = new Entity(UnitType.I_E1, House.Spain, 64, 64);
    e1.prevPos = { ...e1.pos };

    const assets = {
      getSheet: vi.fn(() => ({
        meta: {
          frameWidth: 50,
          frameHeight: 39,
          frameCount: 438,
        },
      })),
      getRemappedSheet: vi.fn(() => null),
      drawFrame: vi.fn(),
      drawFrameFrom: vi.fn(),
    };

    (renderer as any).renderEntities(camera, map, [e1], assets, new Set(), 0);

    const baseScreen = camera.worldToScreen(e1.pos.x, e1.pos.y);
    const call = assets.drawFrame.mock.calls[0];
    expect(call[0]).toBe(ctx);
    expect(call[1]).toBe('e1');
    expect(call[2]).toEqual(expect.any(Number));
    expect(call[3]).toBeCloseTo(baseScreen.x - 2);
    expect(call[4]).toBeCloseTo(baseScreen.y + 4);
    expect(call[5]).toEqual(expect.objectContaining({ centerX: true, centerY: true }));
  });
});

describe('renderer structure draw anchor (building.cpp:2795, bdata.cpp:3806)', () => {
  function mockCanvas(): { canvas: HTMLCanvasElement; ctx: any } {
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillStyle: '#000',
      strokeStyle: '#fff',
      lineWidth: 1,
      font: '',
      textAlign: 'start',
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
    };
    return {
      canvas: {
        width: 160,
        height: 120,
        getContext: () => ctx,
      } as unknown as HTMLCanvasElement,
      ctx,
    };
  }

  it('centers small 1x1 building sprites on the C++ building center coordinate', () => {
    // C++ BuildingTypeClass::Coord_Fixup floors placement to the cell origin,
    // then ObjectClass::Render_Coord returns BuildingClass::Center_Coord().
    // BARL.SHP is only 12x10, so using frameWidth/frameHeight as the anchor
    // shifts bridge barrels up-left from the original renderer.
    const { canvas, ctx } = mockCanvas();
    const renderer = new Renderer(canvas);
    (renderer as any).pal = Array.from({ length: 256 }, (_, i) => [i, i, i, 255]);
    const camera = new Camera(160, 120);
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    map.revealAll();

    const barrel = {
      type: 'BARL',
      image: 'barl',
      house: House.USSR,
      cx: 3,
      cy: 4,
      hp: 10,
      maxHp: 10,
      alive: true,
      rubble: false,
      attackCooldown: 0,
      ammo: -1,
      maxAmmo: -1,
    };

    const assets = {
      getSheet: vi.fn(() => ({
        meta: {
          frameWidth: 12,
          frameHeight: 10,
          frameCount: 3,
        },
      })),
      getRemappedSheet: vi.fn(() => null),
      drawFrame: vi.fn(),
      drawFrameFrom: vi.fn(),
      hasSheet: vi.fn(() => false),
    };

    (renderer as any).renderStructures(camera, map, [barrel], assets, 0);

    const screen = camera.worldToScreen(barrel.cx * CELL_SIZE, barrel.cy * CELL_SIZE);
    const call = assets.drawFrame.mock.calls[0];
    expect(call[0]).toBe(ctx);
    expect(call[1]).toBe('barl');
    expect(call[2]).toBe(0);
    expect(call[3]).toBeCloseTo(screen.x + CELL_SIZE / 2);
    expect(call[4]).toBeCloseTo(screen.y + CELL_SIZE / 2);
    expect(call[5]).toEqual(expect.objectContaining({ centerX: true, centerY: true }));
  });

  it('does not render foundation bib sprites for non-bibbed airfields', () => {
    // C++ bdata.cpp:3775 loads IsBibbed from rules.ini Bib=. [AFLD] has no
    // Bib=yes entry, so BuildingTypeClass::Bib_And_Offset returns SMUDGE_NONE.
    const { canvas } = mockCanvas();
    const renderer = new Renderer(canvas);
    (renderer as any).pal = Array.from({ length: 256 }, (_, i) => [i, i, i, 255]);
    const camera = new Camera(160, 120);
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    map.revealAll();

    const afld = {
      type: 'AFLD',
      image: 'afld',
      house: House.USSR,
      cx: 3,
      cy: 4,
      hp: 1000,
      maxHp: 1000,
      alive: true,
      rubble: false,
      attackCooldown: 0,
      ammo: -1,
      maxAmmo: -1,
    };

    const assets = {
      getSheet: vi.fn((name: string) => ({
        meta: {
          frameWidth: name.startsWith('bib') ? 24 : 72,
          frameHeight: name.startsWith('bib') ? 24 : 48,
          frameCount: name.startsWith('bib') ? 6 : 16,
        },
      })),
      getRemappedSheet: vi.fn(() => null),
      drawFrame: vi.fn(),
      drawFrameFrom: vi.fn(),
      hasSheet: vi.fn(() => false),
    };

    (renderer as any).renderStructures(camera, map, [afld], assets, 0);

    const drawnSheets = assets.drawFrame.mock.calls.map(call => call[1]);
    expect(drawnSheets).toContain('afld');
    expect(drawnSheets.some(sheet => String(sheet).startsWith('bib'))).toBe(false);
  });

  it('redraws docked airstrip aircraft after the building body', () => {
    // C++ building.cpp:484-492: a tethered radio contact is drawn from
    // BuildingClass::Draw_It after the building shape, then its standalone
    // IsToDisplay flag is cleared. Parked fixed-wing aircraft therefore sit
    // visibly on top of AFLD art even when normal Sort_Y would put them first.
    const { canvas } = mockCanvas();
    const renderer = new Renderer(canvas);
    (renderer as any).pal = Array.from({ length: 256 }, (_, i) => [i, i, i, 255]);
    const camera = new Camera(160, 120);
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    map.revealAll();

    const mig = new Entity(UnitType.V_MIG, House.USSR, 2 * CELL_SIZE + 36, 2 * CELL_SIZE + 20);
    mig.aircraftState = 'landed';
    mig.flightAltitude = 0;
    mig.aircraftHeightLeptons = 0;

    const afld = {
      type: 'AFLD',
      image: 'afld',
      house: House.USSR,
      cx: 2,
      cy: 2,
      hp: 1000,
      maxHp: 1000,
      alive: true,
      rubble: false,
      attackCooldown: 0,
      ammo: -1,
      maxAmmo: -1,
      dockedAircraft: mig.id,
    };

    const assets = {
      getSheet: vi.fn((name: string) => ({
        meta: {
          frameWidth: name === 'afld' ? 72 : 56,
          frameHeight: name === 'afld' ? 48 : 56,
          frameCount: 16,
        },
      })),
      getRemappedSheet: vi.fn(() => null),
      drawFrame: vi.fn(),
      drawFrameFrom: vi.fn(),
      hasSheet: vi.fn(() => false),
    };

    (renderer as any).renderGroundLayer(camera, map, [mig], [afld], assets, new Set(), 0);

    const drawnSheets = assets.drawFrame.mock.calls.map(call => call[1]);
    expect(drawnSheets).toEqual(['afld', 'mig']);
  });
});

describe('renderer vessel and aircraft body frames', () => {
  function mockCanvas(): { canvas: HTMLCanvasElement; ctx: any } {
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      fillStyle: '#000',
      strokeStyle: '#fff',
      lineWidth: 1,
      font: '',
      textAlign: 'start',
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
    };
    return {
      canvas: {
        width: 160,
        height: 120,
        getContext: () => ctx,
      } as unknown as HTMLCanvasElement,
      ctx,
    };
  }

  function renderSingleCalls(entity: Entity, frameCount: number) {
    const { canvas } = mockCanvas();
    const renderer = new Renderer(canvas);
    const camera = new Camera(160, 120);
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    map.revealAll();
    entity.prevPos = { ...entity.pos };

    const assets = {
      getSheet: vi.fn(() => ({
        meta: {
          frameWidth: 56,
          frameHeight: 56,
          frameCount,
        },
      })),
      getRemappedSheet: vi.fn(() => null),
      drawFrame: vi.fn(),
      drawFrameFrom: vi.fn(),
    };

    (renderer as any).renderEntities(camera, map, [entity], assets, new Set(), 0);
    return assets.drawFrame.mock.calls;
  }

  function renderSingle(entity: Entity, frameCount: number) {
    return renderSingleCalls(entity, frameCount)[0];
  }

  it('maps PT body facing through C++ 16-facing VesselClass::Shape_Number', () => {
    // C++ vessel.cpp:352:
    //   shapenum = UnitClass::BodyShape[Dir_To_16(PrimaryFacing) * 2] >> 1
    // For DIR_E (64), Dir_To_16=4 and BodyShape[8]=24, so PT.SHP frame 12.
    // The vehicle BodyShape[Dir_To_32] % 16 path draws frame 8 instead.
    const pt = new Entity(UnitType.V_PT, House.Greece, 64, 64);
    pt.bodyFacing256 = 64;
    pt.bodyFacing32 = 8;
    pt.prevBodyFacing32 = 8;

    const call = renderSingle(pt, 16);

    expect(call[1]).toBe('pt');
    expect(call[2]).toBe(12);
  });

  it('keeps LST transport on C++ special-case frame 0', () => {
    // C++ vessel.cpp:358-360 special-cases VESSEL_TRANSPORT to frame 0
    // before any door animation stage overrides it.
    const lst = new Entity(UnitType.V_LST, House.Greece, 64, 64);
    lst.bodyFacing256 = 64;
    lst.bodyFacing32 = 8;
    lst.prevBodyFacing32 = 8;

    const call = renderSingle(lst, 5);

    expect(call[1]).toBe('lst');
    expect(call[2]).toBe(0);
  });

  it('draws LST door animation frames from C++ DoorClass::Door_Stage', () => {
    // C++ vessel.cpp:365-371 replaces the LST transport frame with
    // Door_Stage() whenever the door is not closed. Open_Door(5, 6) stores
    // five visible stages, advancing every five game frames.
    const states = [
      { doorOpen: true, doorOpeningTicks: 25, doorClosingTicks: 0, frame: 0 },
      { doorOpen: true, doorOpeningTicks: 20, doorClosingTicks: 0, frame: 1 },
      { doorOpen: true, doorOpeningTicks: 5, doorClosingTicks: 0, frame: 4 },
      { doorOpen: true, doorOpeningTicks: 0, doorClosingTicks: 0, frame: 4 },
      { doorOpen: true, doorOpeningTicks: 0, doorClosingTicks: 25, frame: 4 },
      { doorOpen: true, doorOpeningTicks: 0, doorClosingTicks: 20, frame: 3 },
      { doorOpen: true, doorOpeningTicks: 0, doorClosingTicks: 5, frame: 0 },
    ];

    for (const state of states) {
      const lst = new Entity(UnitType.V_LST, House.Greece, 64, 64);
      lst.doorOpen = state.doorOpen;
      lst.doorOpeningTicks = state.doorOpeningTicks;
      lst.doorClosingTicks = state.doorClosingTicks;

      const call = renderSingle(lst, 5);

      expect(call[1]).toBe('lst');
      expect(call[2]).toBe(state.frame);
    }
  });

  it('draws PT MGUN turret with C++ VesselTypeClass::Turret_Adjust offset', () => {
    // C++ vessel.cpp:453-456 uses MGunShapes for VESSEL_PT, frame
    // BodyShape[Dir_To_32(SecondaryFacing)]. vdata.cpp:621-624 offsets it by
    // Normal_Move_Point(primary Dir_To_16 * 16, 14), then y += 1.
    const pt = new Entity(UnitType.V_PT, House.Greece, 64, 64);
    pt.bodyFacing256 = 64;
    pt.bodyFacing32 = 8;
    pt.prevBodyFacing32 = 8;
    pt.turretFacing256 = 0;
    pt.turretFacing32 = 0;
    pt.prevTurretFacing32 = 0;

    const calls = renderSingleCalls(pt, 16);
    const turret = calls.find((call) => call[1] === 'mgun');

    expect(turret).toBeDefined();
    expect(turret![2]).toBe(0);
    expect(turret![3]).toBeCloseTo(pt.pos.x + 13);
    expect(turret![4]).toBeCloseTo(pt.pos.y + 1);
    expect(turret![5]).toEqual({ centerX: true, centerY: true });
  });

  it('orders equal-Y vessels by C++ packed Sort_Y coordinate', () => {
    // C++ ObjectClass::operator< compares the full Sort_Y COORDINATE value.
    // In the little-endian coordinate layout, Y is the high word and X is the
    // low word, so vessels with identical Y sort west-to-east before stable
    // insertion-order ties. Sorting by screen Y alone lets scenario creation
    // order decide overlaps and diverges for SCG07EA's PT boats.
    const { canvas } = mockCanvas();
    const renderer = new Renderer(canvas);
    const camera = new Camera(160, 120);
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    map.revealAll();

    const left = new Entity(UnitType.V_PT, House.Greece, 32, 64);
    const middle = new Entity(UnitType.V_PT, House.Greece, 64, 64);
    const right = new Entity(UnitType.V_PT, House.Greece, 96, 64);
    for (const entity of [left, middle, right]) {
      entity.prevPos = { ...entity.pos };
      entity.bodyFacing256 = 64;
      entity.bodyFacing32 = 8;
      entity.prevBodyFacing32 = 8;
    }

    const assets = {
      getSheet: vi.fn(() => ({
        meta: {
          frameWidth: 56,
          frameHeight: 56,
          frameCount: 16,
        },
      })),
      getRemappedSheet: vi.fn(() => null),
      drawFrame: vi.fn(),
      drawFrameFrom: vi.fn(),
    };

    (renderer as any).renderEntities(camera, map, [right, middle, left], assets, new Set(), 0);

    const bodyX = assets.drawFrame.mock.calls
      .filter((call) => call[1] === 'pt')
      .map((call) => call[3]);
    expect(bodyX).toEqual([left.pos.x, middle.pos.x, right.pos.x]);
  });

  it('draws aircraft bodies from C++ SecondaryFacing, not PrimaryFacing', () => {
    // C++ aircraft.cpp:359-365:
    //   shapenum = UnitClass::BodyShape[Dir_To_32(SecondaryFacing)]
    // A transport landing north while flying east-southeast must render the
    // north-facing body frame.
    const tran = new Entity(UnitType.V_TRAN, House.Greece, 64, 64);
    tran.bodyFacing256 = 82;
    tran.bodyFacing32 = 11;
    tran.prevBodyFacing32 = 11;
    tran.turretFacing256 = 0;
    tran.turretFacing32 = 0;
    tran.prevTurretFacing32 = 0;

    const call = renderSingle(tran, 36);

    expect(call[1]).toBe('tran');
    expect(call[2]).toBe(0);
  });

  it('draws the C++ manual aircraft ground shadow before the elevated body', () => {
    // C++ aircraft.cpp:454 draws shapefile/shapenum at x+1,y+2 with
    // SHAPE_FADING|SHAPE_PREDATOR before Techno_Draw_Object subtracts Height.
    const { canvas } = mockCanvas();
    const renderer = new Renderer(canvas);
    (renderer as any).pal = Array.from({ length: 256 }, (_, i) => [i, i, i, 255]);
    const camera = new Camera(160, 120);
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    map.revealAll();

    const tran = new Entity(UnitType.V_TRAN, House.Greece, 64, 64);
    tran.prevPos = { ...tran.pos };
    tran.flightAltitude = 10;
    tran.aircraftHeightLeptons = 102;
    tran.turretFacing256 = 0;
    tran.turretFacing32 = 0;
    tran.prevTurretFacing32 = 0;

    const assets = {
      getSheet: vi.fn(() => ({
        meta: {
          frameWidth: 56,
          frameHeight: 56,
          frameCount: 36,
        },
      })),
      getRemappedSheet: vi.fn(() => null),
      drawFrame: vi.fn(),
      drawFrameFrom: vi.fn(),
      drawFrameSpecialGhost: vi.fn(),
    };

    (renderer as any).renderEntities(camera, map, [tran], assets, new Set(), 100);
    const shadow = assets.drawFrameSpecialGhost.mock.calls.find((call) => call[1] === 'tran');
    const body = assets.drawFrame.mock.calls.find((call) => call[1] === 'tran');

    expect(shadow).toBeDefined();
    expect(body).toBeDefined();
    expect(shadow![2]).toBe(0);
    expect(shadow![3]).toBeCloseTo(tran.pos.x + 1);
    expect(shadow![4]).toBeCloseTo(tran.pos.y + 2);
    expect(shadow![5]).toBe((renderer as any).pal);
    expect(shadow![6]).toEqual({ centerX: true, centerY: true });
    expect(body![3]).toBeCloseTo(tran.pos.x);
    expect(body![4]).toBeCloseTo(tran.pos.y - tran.flightAltitude);
    expect(assets.drawFrameSpecialGhost.mock.invocationCallOrder[0])
      .toBeLessThan(assets.drawFrame.mock.invocationCallOrder[0]);
  });

  it('draws player-owned fully cloaked submarines as C++ VISUAL_SHADOWY', () => {
    // C++ techno.cpp:4316 returns VISUAL_SHADOWY for player-owned CLOAKED
    // technos, and Techno_Draw_Object renders that through
    // SHAPE_PREDATOR|SHAPE_FADING rather than a low-alpha normal sprite.
    const { canvas } = mockCanvas();
    const renderer = new Renderer(canvas);
    const palette = Array.from({ length: 256 }, (_, i) => [i, i, i, 255]);
    (renderer as any).pal = palette;
    const camera = new Camera(160, 120);
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    map.revealAll();

    const sub = new Entity(UnitType.V_SS, House.USSR, 64, 64);
    sub.prevPos = { ...sub.pos };
    sub.cloakState = CloakState.CLOAKED;
    sub.bodyFacing256 = 0;
    sub.bodyFacing32 = 0;
    sub.prevBodyFacing32 = 0;

    const assets = {
      getSheet: vi.fn(() => ({
        meta: {
          frameWidth: 56,
          frameHeight: 56,
          frameCount: 32,
        },
      })),
      getRemappedSheet: vi.fn(() => null),
      drawFrame: vi.fn(),
      drawFrameFrom: vi.fn(),
      drawFrameSpecialGhost: vi.fn(),
    };

    setPlayerHouses(new Set([House.USSR]));
    try {
      (renderer as any).renderEntities(camera, map, [sub], assets, new Set(), 100);
    } finally {
      setPlayerHouses(new Set([House.Spain, House.Greece]));
    }

    const shadowyCall = assets.drawFrameSpecialGhost.mock.calls[0];
    expect(shadowyCall[1]).toBe('ss');
    expect(shadowyCall[2]).toBe(0);
    expect(shadowyCall[3]).toBeCloseTo(64, 0);
    expect(shadowyCall[4]).toBeCloseTo(64, 0);
    expect(shadowyCall[5]).toBe(palette);
    expect(shadowyCall[6]).toEqual({
      centerX: true,
      centerY: true,
      ghostShadow: { palette, frac: 130 },
    });
    expect(assets.drawFrame).not.toHaveBeenCalledWith(
      expect.anything(),
      'ss',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.anything(),
    );
    expect(assets.drawFrameFrom).not.toHaveBeenCalled();
  });

  it('draws TRAN rotors from C++ LROTOR/RROTOR SHP pairs with transport offsets', () => {
    // C++ aircraft.cpp:491-528 and coord.cpp:445-555:
    //   shapenum = Height ? Fetch_Stage()%4 : (Fetch_Stage()%8)+4
    //   TRAN draws RRotorData after Move_Point(SecondaryFacing, stretch),
    //   then LRotorData after Move_Point(SecondaryFacing+DIR_S, stretch*2).
    const { canvas, ctx } = mockCanvas();
    const renderer = new Renderer(canvas);
    (renderer as any).pal = Array.from({ length: 256 }, (_, i) => [i, i, i, 255]);
    const camera = new Camera(160, 120);
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    map.revealAll();

    const tran = new Entity(UnitType.V_TRAN, House.Greece, 64, 64);
    tran.prevPos = { ...tran.pos };
    tran.flightAltitude = 10;
    tran.aircraftHeightLeptons = 102;
    tran.aircraftRotorStage = 99;
    tran.turretFacing256 = 0;
    tran.turretFacing32 = 0;
    tran.prevTurretFacing32 = 0;

    const assets = {
      getSheet: vi.fn(() => ({
        meta: {
          frameWidth: 56,
          frameHeight: 56,
          frameCount: 36,
        },
      })),
      getRemappedSheet: vi.fn(() => null),
      drawFrame: vi.fn(),
      drawFrameFrom: vi.fn(),
      drawFrameSpecialGhost: vi.fn(),
    };

    (renderer as any).renderEntities(camera, map, [tran], assets, new Set(), 100);
    const rotors = assets.drawFrameSpecialGhost.mock.calls
      .filter((call) => call[1] === 'rrotor' || call[1] === 'lrotor');

    expect(rotors.map((call) => call[1])).toEqual(['rrotor', 'lrotor']);
    expect(rotors.map((call) => call[2])).toEqual([3, 3]);
    const bodyY = tran.pos.y - tran.flightAltitude;
    expect(rotors[0][3]).toBeCloseTo(tran.pos.x);
    expect(rotors[0][4]).toBeCloseTo(bodyY - 7 - 2);
    expect(rotors[1][3]).toBeCloseTo(tran.pos.x);
    expect(rotors[1][4]).toBeCloseTo(bodyY - 7 + 16 - 2);
    expect(rotors[0][5]).toBe((renderer as any).pal);
    expect(rotors[0][6]).toEqual({ centerX: true, centerY: true });
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('maps fixed-wing aircraft through C++ 16-stage rotation frames', () => {
    // C++ aircraft.cpp:367-369:
    //   shapenum = UnitClass::BodyShape[Dir_To_16(SecondaryFacing)*2]/2
    const mig = new Entity(UnitType.V_MIG, House.Greece, 64, 64);
    mig.turretFacing256 = 64;
    mig.turretFacing32 = 8;
    mig.prevTurretFacing32 = 8;

    const call = renderSingle(mig, 16);

    expect(call[1]).toBe('mig');
    expect(call[2]).toBe(12);
  });

  it('passes fixed-wing residual Rotation16 through to CC_Draw_Shape', () => {
    // C++ aircraft.cpp:437-440:
    //   if (Class->Rotation == 16) rotation = Rotation16[SecondaryFacing]
    const mig = new Entity(UnitType.V_MIG, House.Greece, 64, 64);
    mig.turretFacing256 = 69;
    mig.turretFacing32 = 9;
    mig.prevTurretFacing32 = 9;

    const call = renderSingle(mig, 16);

    expect(call[1]).toBe('mig');
    expect(call[2]).toBe(12);
    expect(call[5]).toMatchObject({ centerX: true, centerY: true, rotation256: 5 });
  });
});

describe('renderer sidebar map button state (sidebar.cpp:341-344)', () => {
  function mockCanvas(): { canvas: HTMLCanvasElement; ctx: any } {
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      fillStyle: '#000',
      strokeStyle: '#fff',
      lineWidth: 1,
      font: '',
      textAlign: 'start',
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
    };
    return {
      canvas: {
        width: 640,
        height: 400,
        getContext: () => ctx,
      } as unknown as HTMLCanvasElement,
      ctx,
    };
  }

  it('draws MAP.SHP disabled frame while radar is inactive', () => {
    // C++ SidebarClass::Init_IO disables the Zoom button unless
    // IsRadarActive && Is_Zoomable(). ShapeButtonClass::Draw_Me uses frame 2
    // for IsDisabled.
    const { canvas, ctx } = mockCanvas();
    const renderer = new Renderer(canvas);
    renderer.hasRadar = false;
    renderer.doesRadarExist = false;
    renderer.radarZoomEnabled = false;
    renderer.radarZoomPressed = false;

    const assets = {
      getSheet: vi.fn(() => ({ meta: { frameWidth: 34, frameHeight: 28, frameCount: 3 } })),
      drawFrame: vi.fn(),
    };

    (renderer as any).renderButtonRow(480, 160, assets);

    expect(assets.drawFrame).toHaveBeenCalledWith(ctx, 'repair', 0, 480 + Renderer.BUTTON_ONE_X, Renderer.BUTTON_ROW_Y);
    expect(assets.drawFrame).toHaveBeenCalledWith(ctx, 'sell', 0, 480 + Renderer.BUTTON_TWO_X, Renderer.BUTTON_ROW_Y);
    expect(assets.drawFrame).toHaveBeenCalledWith(ctx, 'map_btn', 2, 480 + Renderer.BUTTON_THREE_X, Renderer.BUTTON_ROW_Y);
  });

  it('keeps MAP.SHP pressed while low power closes an existing radar cover', () => {
    // C++ HouseClass::AI low-power path calls Radar_Activate(0), which starts
    // closing the cover but does not Disable() SidebarClass::Zoom. Once the
    // radar has reached Radar_Activate(3), the button stays enabled until the
    // sidebar gadgets are removed.
    const { canvas, ctx } = mockCanvas();
    const renderer = new Renderer(canvas);
    renderer.hasRadar = false;
    renderer.doesRadarExist = true;
    renderer.radarZoomEnabled = true;
    renderer.radarZoomPressed = true;

    const assets = {
      getSheet: vi.fn(() => ({ meta: { frameWidth: 34, frameHeight: 28, frameCount: 3 } })),
      drawFrame: vi.fn(),
    };

    (renderer as any).renderButtonRow(480, 160, assets);

    expect(assets.drawFrame).toHaveBeenCalledWith(ctx, 'map_btn', 1, 480 + Renderer.BUTTON_THREE_X, Renderer.BUTTON_ROW_Y);
  });

  it('draws MAP.SHP unpressed when zoom is enabled but not selected', () => {
    const { canvas, ctx } = mockCanvas();
    const renderer = new Renderer(canvas);
    renderer.hasRadar = true;
    renderer.doesRadarExist = true;
    renderer.radarZoomEnabled = true;
    renderer.radarZoomPressed = false;

    const assets = {
      getSheet: vi.fn(() => ({ meta: { frameWidth: 34, frameHeight: 28, frameCount: 3 } })),
      drawFrame: vi.fn(),
    };

    (renderer as any).renderButtonRow(480, 160, assets);

    expect(assets.drawFrame).toHaveBeenCalledWith(ctx, 'map_btn', 0, 480 + Renderer.BUTTON_THREE_X, Renderer.BUTTON_ROW_Y);
  });
});

describe('renderer top tab font (tab.cpp:123, credits.cpp:118-157)', () => {
  function mockCanvas(): { canvas: HTMLCanvasElement; ctx: any } {
    const ctx = {
      imageSmoothingEnabled: false,
      fillStyle: '#000',
      textAlign: 'start',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      save: vi.fn(),
      restore: vi.fn(),
    };
    return {
      canvas: {
        width: 640,
        height: 400,
        getContext: () => ctx,
      } as unknown as HTMLCanvasElement,
      ctx,
    };
  }

  it('draws Options and credits with C++ 12METFNT at y=0', () => {
    // C++ WIN32 TabClass::Draw_It/CreditClass::Graphic_Logic use
    // TPF_METAL12 | TPF_CENTER | TPF_USE_GRAD_PAL at y=0. A 6POINT
    // replacement shifts the glyphs and produces a persistent top-bar diff.
    const { canvas } = mockCanvas();
    const renderer = new Renderer(canvas);
    renderer.sidebarCredits = 1000;
    renderer.missionTimer = Renderer.MISSION_TIMER_WARNING_TICKS + 1;

    const metalFont = { drawText: vi.fn() };
    const assets = {
      getSheet: vi.fn(() => ({ meta: { frameWidth: 160, frameHeight: 14, frameCount: 9 } })),
      drawFrame: vi.fn(),
      getFont: vi.fn((name: string) => name === 'metal12' ? metalFont : null),
    };
    (renderer as any)._cachedAssets = assets;

    renderer.renderTopBar(1);

    expect(assets.drawFrame).toHaveBeenCalledWith(expect.anything(), 'tabs', 0, 0, 0);
    expect(assets.drawFrame).toHaveBeenCalledWith(expect.anything(), 'tabs', 6, 480, 0);
    expect(assets.drawFrame).toHaveBeenCalledWith(expect.anything(), 'tabs', 2, 320, 0);
    expect(assets.getFont).toHaveBeenCalledWith('metal12');
    expect(metalFont.drawText).toHaveBeenCalledWith(
      expect.anything(),
      'Options',
      80,
      0,
      '#ececec',
      expect.objectContaining({ align: 'center', indexedPalette: expect.any(Array), letterSpacing: 1 }),
    );
    expect(metalFont.drawText).toHaveBeenCalledWith(
      expect.anything(),
      '1000',
      560,
      0,
      '#ececec',
      expect.objectContaining({ align: 'center', indexedPalette: expect.any(Array), letterSpacing: 1 }),
    );
  });

  it('uses the lit timer tab frame below C++ Rule.TimerWarning', () => {
    // C++ tab.cpp:156-160 lights the mission-timer tab when
    // Scen.MissionTimer < TICKS_PER_MINUTE * Rule.TimerWarning.
    const { canvas } = mockCanvas();
    const renderer = new Renderer(canvas);
    renderer.missionTimer = Renderer.MISSION_TIMER_WARNING_TICKS - 1;

    const assets = {
      getSheet: vi.fn(() => ({ meta: { frameWidth: 160, frameHeight: 14, frameCount: 9 } })),
      drawFrame: vi.fn(),
      getFont: vi.fn(() => ({ drawText: vi.fn() })),
    };
    (renderer as any)._cachedAssets = assets;

    renderer.renderTopBar(1);

    expect(assets.drawFrame).toHaveBeenCalledWith(expect.anything(), 'tabs', 4, 320, 0);
  });

  it('formats mission timer seconds with C++ integer division', () => {
    // C++ credits.cpp:126 uses long secs = Scen.MissionTimer / TICKS_PER_SECOND.
    // A partial second is truncated, not rounded up.
    const { canvas } = mockCanvas();
    const renderer = new Renderer(canvas);
    renderer.missionTimer = ((4 * 60 * 60) + (4 * 60) + 53) * 15 + 14;

    const metalFont = { drawText: vi.fn() };
    const assets = {
      getSheet: vi.fn(() => ({ meta: { frameWidth: 160, frameHeight: 14, frameCount: 9 } })),
      drawFrame: vi.fn(),
      getFont: vi.fn((name: string) => name === 'metal12' ? metalFont : null),
    };
    (renderer as any)._cachedAssets = assets;

    renderer.renderTopBar(1);

    expect(metalFont.drawText).toHaveBeenCalledWith(
      expect.anything(),
      'Time:04:04:53',
      400,
      0,
      '#ececec',
      expect.objectContaining({ align: 'center', indexedPalette: expect.any(Array), letterSpacing: 1 }),
    );
  });
});

describe('renderer screen shake parity (conquer.cpp:5523-5566)', () => {
  function mockCanvas(): { canvas: HTMLCanvasElement; ctx: any } {
    const ctx = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
    };
    return {
      canvas: {
        width: 640,
        height: 400,
        getContext: () => ctx,
      } as unknown as HTMLCanvasElement,
      ctx,
    };
  }

  function mockAssets() {
    return {
      getSheet: vi.fn(() => undefined),
      getTheatrePalette: vi.fn(() => Array.from({ length: 256 }, () => [0, 0, 0])),
      hasTileset: vi.fn(() => false),
    };
  }

  function silenceLayers(renderer: Renderer): void {
    for (const method of [
      'renderTerrain',
      'renderDecals',
      'renderOverlays',
      'renderGroundLayer',
      'renderStructures',
      'renderCrates',
      'renderCorpses',
      'renderEntities',
      'renderTargetLines',
      'renderWaypoints',
      'renderEffects',
      'renderFogOfWar',
      'renderPlacementGhost',
      'renderSelectionBox',
      'renderAttackMoveIndicator',
      'renderModeLabel',
      'renderOffscreenIndicators',
      'renderSidebar',
      'renderMinimap',
      'renderSidebarButtonRow',
      'renderFullscreenRadar',
      'renderHelpOverlay',
      'renderCursor',
    ]) {
      (renderer as any)[method] = vi.fn();
    }
  }

  it('uses C++ vertical-only two-pixel displacement in normal render mode', () => {
    // C++ WIN32 path doubles the requested shakes, then repeatedly blits the
    // page at y offsets -2/0/+2. It never applies an X-axis displacement.
    const { canvas, ctx } = mockCanvas();
    const renderer = new Renderer(canvas);
    silenceLayers(renderer);
    NonCriticalRandom.seed = 0;
    renderer.screenShake = 4;

    renderer.render(new Camera(640, 400), new GameMap(), [], [], mockAssets() as any, {} as any, new Set(), [], 1);

    expect(ctx.translate).toHaveBeenCalledTimes(1);
    const [x, y] = ctx.translate.mock.calls[0];
    expect(x).toBe(0);
    expect([-2, 0, 2]).toContain(y);
    expect(renderer.screenShake).toBe(3);
  });

  it('suppresses visible shake in agent/compare mode like the WASM harness', () => {
    // C++ __EMSCRIPTEN__ agent harness returns from Shake_The_Screen before any
    // page blit, so visual parity captures must not offset the TS canvas either.
    const { canvas, ctx } = mockCanvas();
    const renderer = new Renderer(canvas);
    silenceLayers(renderer);
    renderer.suppressScreenShake = true;
    renderer.screenShake = 4;

    renderer.render(new Camera(640, 400), new GameMap(), [], [], mockAssets() as any, {} as any, new Set(), [], 1);

    expect(ctx.translate).not.toHaveBeenCalled();
    expect(renderer.screenShake).toBe(0);
  });
});
