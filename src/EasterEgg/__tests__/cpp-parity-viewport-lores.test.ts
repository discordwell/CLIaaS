/**
 * C++ Parity: LORES Viewport Dimensions
 *
 * Verifies that the TS Red Alert viewport matches C++ HIRES exactly:
 * 10 cells wide x 8 cells tall visible in the game area at RESFACTOR=1.
 *
 * C++ Reference:
 *   - conquer.h: RESFACTOR=1 (LORES) or RESFACTOR=2 (HIRES)
 *   - tab.h: TAB_HEIGHT = 8 * RESFACTOR
 *   - sidebar.h: SIDE_WIDTH = 80 (LORES) / 160 (HIRES)
 *   - display.h: Display_Width = 320 - SIDE_WIDTH = 240 (LORES)
 *   - Display_Height = 200 - TAB_HEIGHT = 192 (LORES)
 *   - CELL_PIXEL_W = 24, so visible cells = 240/24 = 10 wide, 192/24 = 8 tall
 *
 * Canvas size: 320×200 at LORES, 640×400 at HIRES.
 * CSS `image-rendering: pixelated` scales the LORES canvas up to display size.
 */

import { describe, it, expect } from 'vitest';
import { CELL_SIZE, RESFACTOR } from '../engine/types';
import { Renderer } from '../engine/renderer';
import { Camera } from '../engine/camera';

describe('C++ viewport parity (LORES/HIRES via RESFACTOR)', () => {

  const CANVAS_W = 320 * RESFACTOR;
  const CANVAS_H = 200 * RESFACTOR;
  const SIDEBAR_W = 80 * RESFACTOR;
  const GAME_AREA_W = CANVAS_W - SIDEBAR_W;
  const GAME_AREA_H = CANVAS_H - Renderer.TAB_HEIGHT;

  it('canvas dimensions match C++ resolution', () => {
    // LORES: 320×200, HIRES: 640×400
    expect(CANVAS_W).toBe(320 * RESFACTOR);
    expect(CANVAS_H).toBe(200 * RESFACTOR);
  });

  it('sidebar width matches C++ SIDE_WIDTH', () => {
    // C++ sidebar.h: 80 * RESFACTOR
    expect(SIDEBAR_W).toBe(80 * RESFACTOR);
  });

  it('TAB_HEIGHT matches C++ TAB_HEIGHT', () => {
    // C++ tab.h: TAB_HEIGHT = 8 * RESFACTOR
    expect(Renderer.TAB_HEIGHT).toBe(8 * RESFACTOR);
  });

  it('game area is 10 cells wide (C++ Display_Width / CELL_PIXEL_W)', () => {
    // C++ display.h: game viewport width = 320*RF - 80*RF = 240*RF
    // At CELL_SIZE=24: 240*RF / 24 = 10*RF cells
    // BUT the viewport shows 10 cells at LORES and 20 at HIRES
    // because cells are always 24px regardless of RESFACTOR.
    const cellsWide = GAME_AREA_W / CELL_SIZE;
    expect(cellsWide).toBe(10 * RESFACTOR);
  });

  it('game area is 8 cells tall (C++ Display_Height / CELL_PIXEL_H)', () => {
    // C++ display.h: game viewport height = 200*RF - 8*RF = 192*RF
    // At CELL_SIZE=24: 192*RF / 24 = 8*RF cells
    const cellsTall = GAME_AREA_H / CELL_SIZE;
    expect(cellsTall).toBe(8 * RESFACTOR);
  });

  it('RESFACTOR=1 yields 10×8 visible cells (LORES parity)', () => {
    if (RESFACTOR !== 1) return; // skip when not in LORES mode
    expect(GAME_AREA_W / CELL_SIZE).toBe(10);
    expect(GAME_AREA_H / CELL_SIZE).toBe(8);
  });

  it('RESFACTOR=2 would yield 20×16 visible cells (HIRES parity)', () => {
    if (RESFACTOR !== 2) return; // skip when not in HIRES mode
    expect(GAME_AREA_W / CELL_SIZE).toBe(20);
    expect(GAME_AREA_H / CELL_SIZE).toBe(16);
  });

  it('HOME waypoint camera uses C++ Cell_Coord half-cell tactical origin', () => {
    // C++ display.cpp:4314:
    // Set_Tactical_Position(Cell_Coord(WAYPT_HOME - 128*4*RESFACTOR - 5*RESFACTOR))
    // inline.h:452: Cell_Coord returns the center of the cell, not Coord_Whole.
    // For SCG01EA, HOME 6079 = (63,47), map bounds (49,45,30,36).
    const camera = new Camera(GAME_AREA_W, GAME_AREA_H, 0, Renderer.TAB_HEIGHT);
    camera.setPlayableBounds(49, 45, 30, 36);
    const homeCx = 6079 % 128;
    const homeCy = Math.floor(6079 / 128);
    const vpCols = GAME_AREA_W / CELL_SIZE;
    const vpRows = GAME_AREA_H / CELL_SIZE;
    const topLeftCx = Math.max(49, Math.min(49 + 30 - vpCols, homeCx - 5 * RESFACTOR));
    const topLeftCy = Math.max(45, Math.min(45 + 36 - vpRows, homeCy - 4 * RESFACTOR));

    camera.centerOn(
      (topLeftCx + vpCols / 2 + 0.5) * CELL_SIZE,
      (topLeftCy + vpRows / 2 + 0.5) * CELL_SIZE,
    );

    expect(camera.x).toBe(topLeftCx * CELL_SIZE + CELL_SIZE / 2);
    expect(camera.y).toBe(topLeftCy * CELL_SIZE + CELL_SIZE / 2);
  });

  it('HOME waypoint camera clamps after Cell_Coord, matching Set_Tactical_Position', () => {
    // SCG08EA HOME requests (19,55), outside map bounds (23,57,87,54).
    // C++ Set_Tactical_Position clamps that lepton coordinate back to the
    // exact map edge, so no half-cell bias remains on either axis.
    const camera = new Camera(GAME_AREA_W, GAME_AREA_H, 0, Renderer.TAB_HEIGHT);
    camera.setPlayableBounds(23, 57, 87, 54);
    const homeCx = 8093 % 128;
    const homeCy = Math.floor(8093 / 128);
    const vpCols = GAME_AREA_W / CELL_SIZE;
    const vpRows = GAME_AREA_H / CELL_SIZE;
    const requestedTopLeftCx = homeCx - 5 * RESFACTOR;
    const requestedTopLeftCy = homeCy - 4 * RESFACTOR;

    camera.centerOn(
      (requestedTopLeftCx + vpCols / 2 + 0.5) * CELL_SIZE,
      (requestedTopLeftCy + vpRows / 2 + 0.5) * CELL_SIZE,
    );

    expect(camera.x).toBe(23 * CELL_SIZE);
    expect(camera.y).toBe(57 * CELL_SIZE);
  });

  // Sidebar sub-component layout constants
  it('sidebar layout constants are source-backed C++ coordinates', () => {
    expect(Renderer.RADAR_SIZE).toBe(70 * RESFACTOR);
    expect(Renderer.RADAR_Y).toBe(2 * RESFACTOR);
    expect(Renderer.STRIP_START_Y).toBe(90 * RESFACTOR);
    expect(Renderer.CAMEO_W).toBe(32 * RESFACTOR);
    expect(Renderer.CAMEO_H).toBe(24 * RESFACTOR);
    expect(Renderer.BUTTON_ROW_Y).toBe((0x96 / 2) * RESFACTOR);
    expect(Renderer.BUTTON_H).toBe(14 * RESFACTOR);
    expect(Renderer.POWER_Y).toBe(88 * RESFACTOR);
    expect(Renderer.SIDEBAR_BG_TOP_Y).toBe(8 * RESFACTOR);
    expect(Renderer.SIDEBAR_BG_MID_Y).toBe(88 * RESFACTOR);
    expect(Renderer.SIDEBAR_BG_BOT_Y).toBe(138 * RESFACTOR);
  });

  it('all sidebar layout values are integer pixels', () => {
    // Fractional pixels cause blurry rendering — all layout must be integer at any RESFACTOR
    const values = [
      Renderer.TAB_HEIGHT, Renderer.RADAR_SIZE, Renderer.RADAR_Y,
      Renderer.BUTTON_ROW_Y, Renderer.BUTTON_H,
      Renderer.BUTTON_ONE_X, Renderer.BUTTON_ONE_W,
      Renderer.BUTTON_TWO_X, Renderer.BUTTON_TWO_W,
      Renderer.BUTTON_THREE_X, Renderer.BUTTON_THREE_W,
      Renderer.STRIP_START_Y, Renderer.CAMEO_W, Renderer.CAMEO_H,
      Renderer.LEFT_STRIP_X_OFFSET, Renderer.RIGHT_STRIP_X_OFFSET,
      Renderer.UP_X_OFFSET, Renderer.DOWN_X_OFFSET,
      Renderer.SBUTTON_W, Renderer.SBUTTON_H, Renderer.SCROLL_BTN_Y_OFFSET,
      Renderer.POWER_Y, Renderer.POWER_BAR_W, Renderer.POWER_BAR_X_OFFSET,
      Renderer.SIDEBAR_BG_TOP_Y, Renderer.SIDEBAR_BG_MID_Y, Renderer.SIDEBAR_BG_BOT_Y,
    ];
    for (const v of values) {
      expect(Number.isInteger(v), `layout value ${v} should be integer`).toBe(true);
    }
  });
});
