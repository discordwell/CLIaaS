/**
 * Dual-runtime visual regression for ore mine TerrainClass objects.
 *
 * SCG20EA has two TERRAIN_MINE objects visible in the first viewport. These
 * are C++ TerrainClass objects using MINE.TEM, not invisible BuildingClass
 * MINP/MINV land mines. If MINE.TEM is missing from TS assets, the renderer
 * silently queues nothing and leaves two stable 24x24 visual holes.
 */
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ensureParityServer,
  isDevServerAvailable,
  stepBoth,
  stopParityServer,
  withDualScenario,
  type ParityServerHandle,
} from './dual-runtime-test-utils.js';

const serverUp = isDevServerAvailable();
let serverHandle: ParityServerHandle | undefined;

type EvalPage = {
  evaluate<T>(fn: () => T): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

function dataUrlToPng(dataUrl: string): PNG {
  return PNG.sync.read(Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
}

function cropPng(source: PNG, box: { x: number; y: number; w: number; h: number }): PNG {
  const out = new PNG({ width: box.w, height: box.h });
  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      const si = ((box.y + y) * source.width + box.x + x) * 4;
      const di = (y * box.w + x) * 4;
      out.data[di] = source.data[si];
      out.data[di + 1] = source.data[si + 1];
      out.data[di + 2] = source.data[si + 2];
      out.data[di + 3] = source.data[si + 3];
    }
  }
  return out;
}

async function wasmRenderedFrame(adapter: unknown): Promise<PNG> {
  const dataUrl = await adapterPage(adapter).evaluate(() => {
    const module = (window as any).Module;
    module.ccall('agent_render', null, [], []);
    const ptr = (window as any).__agentFramePtr;
    if (!ptr || !module.HEAPU8) throw new Error('agent render frame buffer is unavailable');
    const w = 640;
    const h = 400;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(w, h);
    const heap = module.HEAPU8;
    for (let i = 0; i < w * h * 4; i++) image.data[i] = heap[ptr + i];
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  });
  return dataUrlToPng(dataUrl);
}

async function tsRenderedFrame(adapter: unknown): Promise<PNG> {
  const dataUrl = await adapterPage(adapter).evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) throw new Error('TS canvas is unavailable');
    return canvas.toDataURL('image/png');
  });
  return dataUrlToPng(dataUrl);
}

function expectCropMatch(wasmPng: PNG, tsPng: PNG, box: { x: number; y: number; w: number; h: number }): void {
  const wasmCrop = cropPng(wasmPng, box);
  const tsCrop = cropPng(tsPng, box);
  const diff = new PNG({ width: box.w, height: box.h });
  const mismatch = pixelmatch(wasmCrop.data, tsCrop.data, diff.data, box.w, box.h, {
    threshold: 0.1,
    includeAA: true,
  });
  expect(mismatch).toBe(0);
}

async function tsVisibleTerrainMines(adapter: unknown): Promise<Array<{ type: string; cx: number; cy: number }>> {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const camera = game.camera;
    const terrainObjects = game.map.terrainObjects instanceof Map
      ? Array.from(game.map.terrainObjects.values())
      : Array.from(game.map.terrainObjects ?? []);
    return terrainObjects
      .filter((entry: any) => entry.type === 'mine')
      .map((entry: any) => ({
        type: entry.type,
        cx: entry.cx,
        cy: entry.cy,
        screenX: entry.cx * 24 - camera.x,
        screenY: entry.cy * 24 - camera.y,
      }))
      .filter((entry: any) => entry.screenX >= 0 && entry.screenX < 480 && entry.screenY >= 0 && entry.screenY < 384);
  }) as Promise<Array<{ type: string; cx: number; cy: number }>>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG20 TerrainClass mine rendering', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('draws MINE.TEM TerrainClass objects in the ground layer', async () => {
    await withDualScenario('SCG20EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 100);

      await expect(tsVisibleTerrainMines(handle.ts)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'mine', cx: 17, cy: 51 }),
          expect.objectContaining({ type: 'mine', cx: 29, cy: 52 }),
        ]),
      );

      const [wasmPng, tsPng] = await Promise.all([
        wasmRenderedFrame(handle.wasm),
        tsRenderedFrame(handle.ts),
      ]);

      expectCropMatch(wasmPng, tsPng, { x: 16, y: 44, w: 40, h: 40 });
      expectCropMatch(wasmPng, tsPng, { x: 304, y: 68, w: 40, h: 40 });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 180_000);
});
