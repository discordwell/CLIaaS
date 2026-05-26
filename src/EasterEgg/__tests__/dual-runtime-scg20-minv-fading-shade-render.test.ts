/**
 * Dual-runtime visual regression for BuildingClass AP/AV mine body rendering.
 *
 * SCG20EA has Greek MINV buildings visible to PlayerPtr in the first viewport.
 * C++ bdata.cpp marks MINV/MINP as IsRemappable=true but REMAP_NONE; then
 * Techno_Draw_Object still calls CC_Draw_Shape with SHAPE_FADING|SHAPE_GHOST.
 * With a null remap table, conquer.cpp supplies DisplayClass::FadingShade for
 * body pixels while UnitShadow handles shadow pixels.
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

function expectCropMatch(
  wasmPng: PNG,
  tsPng: PNG,
  box: { x: number; y: number; w: number; h: number },
  label: string,
): void {
  const wasmCrop = cropPng(wasmPng, box);
  const tsCrop = cropPng(tsPng, box);
  const diff = new PNG({ width: box.w, height: box.h });
  const mismatch = pixelmatch(wasmCrop.data, tsCrop.data, diff.data, box.w, box.h, {
    threshold: 0.1,
    includeAA: true,
  });
  expect(mismatch, `${label} mismatch ${mismatch}/${box.w * box.h}`).toBe(0);
}

async function tsVisibleGreekVehicleMines(adapter: unknown): Promise<Array<{
  type: string;
  house: string;
  cx: number;
  cy: number;
  screenX: number;
  screenY: number;
}>> {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const camera = game.camera;
    const structures = Array.isArray(game.structures)
      ? game.structures
      : Array.from(game.structures?.values?.() ?? []);
    return structures
      .filter((entry: any) => entry.type === 'MINV' && entry.house === 'Greece' && entry.alive)
      .map((entry: any) => ({
        type: entry.type,
        house: entry.house,
        cx: entry.cx,
        cy: entry.cy,
        screenX: entry.cx * 24 - camera.x,
        screenY: entry.cy * 24 - camera.y,
      }))
      .filter((entry: any) => entry.screenX >= 0 && entry.screenX < 480 && entry.screenY >= 0 && entry.screenY < 384);
  }) as Promise<Array<{
    type: string;
    house: string;
    cx: number;
    cy: number;
    screenX: number;
    screenY: number;
  }>>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG20 REMAP_NONE mine FadingShade rendering', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('draws visible MINV bodies through DisplayClass::FadingShade while preserving UnitShadow', async () => {
    await withDualScenario('SCG20EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 100);

      await expect(tsVisibleGreekVehicleMines(handle.ts)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'MINV', house: 'Greece', cx: 27, cy: 56 }),
          expect.objectContaining({ type: 'MINV', house: 'Greece', cx: 29, cy: 56 }),
        ]),
      );

      const [wasmPng, tsPng] = await Promise.all([
        wasmRenderedFrame(handle.wasm),
        tsRenderedFrame(handle.ts),
      ]);

      expectCropMatch(wasmPng, tsPng, { x: 262, y: 174, w: 28, h: 22 }, 'left visible MINV');
      expectCropMatch(wasmPng, tsPng, { x: 310, y: 174, w: 28, h: 22 }, 'right visible MINV');
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 180_000);
});
