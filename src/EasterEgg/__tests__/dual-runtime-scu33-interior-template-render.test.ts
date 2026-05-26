/**
 * Dual-runtime visual regression for first-viewport SCU33 rendering.
 *
 * SCU33EA draws C++ interior arrow templates 256, 257, and 259 in the first
 * viewport. TS previously used an OpenRA-derived mapping that shifted those
 * raw TemplateType IDs one ARRO*.INT file early, creating stable visual
 * divergence while all gameplay state still matched.
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

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU33 first-viewport rendering', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('draws interior arrows, PDOX animation stage, and General sprite from C++ assets', async () => {
    await withDualScenario('SCU33EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 100);

      const cppCells = await adapterPage(handle.wasm).evaluate(() => {
        const module = (window as any).Module;
        return [
          JSON.parse(module.ccall('agent_get_cell_info', 'string', ['number', 'number', 'number'], [45, 72, -1])),
          JSON.parse(module.ccall('agent_get_cell_info', 'string', ['number', 'number', 'number'], [46, 72, -1])),
          JSON.parse(module.ccall('agent_get_cell_info', 'string', ['number', 'number', 'number'], [47, 72, -1])),
        ].map((cell: any) => ({ cx: cell.cx, cy: cell.cy, ttype: cell.ttype, ticon: cell.ticon }));
      });
      expect(cppCells).toEqual([
        { cx: 45, cy: 72, ttype: 257, ticon: 0 },
        { cx: 46, cy: 72, ttype: 259, ticon: 0 },
        { cx: 47, cy: 72, ttype: 256, ticon: 0 },
      ]);

      const [wasmPng, tsPng] = await Promise.all([
        wasmRenderedFrame(handle.wasm),
        tsRenderedFrame(handle.ts),
      ]);

      expectCropMatch(wasmPng, tsPng, { x: 324, y: 112, w: 72, h: 24 });
      expectCropMatch(wasmPng, tsPng, { x: 0, y: 104, w: 105, h: 60 });
      expectCropMatch(wasmPng, tsPng, { x: 340, y: 30, w: 32, h: 32 });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);
});
