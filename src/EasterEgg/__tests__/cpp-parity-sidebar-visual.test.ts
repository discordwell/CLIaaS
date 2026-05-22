/**
 * C++ visual parity: sidebar cameos already contain their label art.
 *
 * The original sidebar does not draw custom TS credit strips, power numbers, or
 * cost text over idle production cameos. Those overlays create visible jukes.
 */

import { describe, expect, it, vi } from 'vitest';
import { Renderer } from '../engine/renderer';
import { PRODUCTION_ITEMS } from '../engine/types';

function mockCanvas(): HTMLCanvasElement {
  return {
    width: 640,
    height: 400,
    getContext: () => ({
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      filter: 'none',
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
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

describe('sidebar production visuals', () => {
  it('does not draw TS cost text over idle cameos', () => {
    const renderer = new Renderer(mockCanvas());
    const drawBitmapText = vi.fn();
    (renderer as any).drawBitmapText = drawBitmapText;
    renderer.sidebarCredits = 10000;

    const assets = {
      getSheet: () => null,
      drawFrame: vi.fn(),
    };
    const item = PRODUCTION_ITEMS.find(p => p.type === 'E1')!;

    (renderer as any).renderStrip(
      (renderer as any).ctx,
      assets,
      0,
      0,
      [item],
      0,
      false,
      'left',
    );

    expect(drawBitmapText).not.toHaveBeenCalledWith(
      expect.anything(),
      '$100',
      expect.any(Number),
      expect.any(Number),
      expect.any(String),
      expect.any(String),
      expect.anything(),
    );
  });
});
