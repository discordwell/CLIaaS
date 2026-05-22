/**
 * C++ visual parity: wall overlays render from their SHP connection frames.
 *
 * OverlayPack wall IDs are overlays, not generic filled rectangles. C++
 * Wall_Update writes the NESW connection mask into the low nibble used as the
 * wall sprite frame.
 */

import { describe, expect, it, vi } from 'vitest';
import { Camera } from '../engine/camera';
import { GameMap, Terrain } from '../engine/map';
import { Renderer } from '../engine/renderer';
import { CELL_SIZE } from '../engine/types';

function mockCanvas(): HTMLCanvasElement {
  return {
    width: 640,
    height: 400,
    getContext: () => ({
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 0 }),
      createRadialGradient: () => ({ addColorStop: vi.fn() }),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray(0) }),
      putImageData: vi.fn(),
      canvas: { width: 640, height: 400 },
    }),
  } as unknown as HTMLCanvasElement;
}

describe('wall overlay rendering', () => {
  it('draws BARB OverlayPack cells with the real wall SHP connection frame', () => {
    const renderer = new Renderer(mockCanvas());
    const camera = new Camera(640, 400);
    const map = new GameMap();
    const idx = 10 * 128 + 10;
    map.overlay[idx] = 3; // OVERLAY_BARB
    map.setWallType(9, 10, 'BARB');
    map.setWallType(10, 10, 'BARB');
    map.setWallType(11, 10, 'BARB');

    const assets = { drawFrame: vi.fn() };
    (renderer as any).renderOverlays(camera, map, 0, assets);

    expect(assets.drawFrame).toHaveBeenCalledWith(
      (renderer as any).ctx,
      'barb',
      10, // E + W connection mask
      10 * CELL_SIZE,
      10 * CELL_SIZE,
    );
  });

  it('draws normal ground under wall overlays instead of leaving a black cell', () => {
    const renderer = new Renderer(mockCanvas());
    const camera = new Camera(CELL_SIZE, CELL_SIZE);
    camera.x = 10 * CELL_SIZE;
    camera.y = 10 * CELL_SIZE;
    const map = new GameMap();
    map.setTerrain(10, 10, Terrain.WALL);
    map.setWallType(10, 10, 'BARB');

    const renderGrassCell = vi.fn();
    (renderer as any).renderGrassCell = renderGrassCell;

    (renderer as any).renderTerrain(camera, map, 0, {});

    expect(renderGrassCell).toHaveBeenCalledWith(
      (renderer as any).ctx,
      0,
      0,
      10,
      10,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
  });
});
