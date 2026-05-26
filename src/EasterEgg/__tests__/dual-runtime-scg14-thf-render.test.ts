/**
 * Dual-runtime visual regression for SCG14 thief rendering.
 *
 * C++ idata.cpp defines InfantryTypeClass E9 with image name "THF". Rendering
 * the thief through E1.SHP keeps game state parity but draws the wrong infantry
 * body in the final Allied mission's opening beach group.
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

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG14 thief rendering', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('draws THF infantry with THF.SHP rather than the E1 sprite at tick 100', async () => {
    await withDualScenario('SCG14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 100);

      const cppThieves = await adapterPage(handle.wasm).evaluate(() => {
        const module = (window as any).Module;
        const layer = JSON.parse(module.ccall(
          'agent_dump_layer',
          'string',
          ['number', 'number', 'number', 'number', 'number'],
          [1, 108, 74, 108, 74],
        ));
        return (layer.objects ?? [])
          .filter((entry: any) => entry.name === 'THF')
          .map((entry: any) => ({ logicIndex: entry.logicIndex, name: entry.name, cx: entry.cx, cy: entry.cy }))
          .sort((a: any, b: any) => a.logicIndex - b.logicIndex);
      });
      expect(cppThieves).toEqual([
        { logicIndex: 415, name: 'THF', cx: 108, cy: 74 },
        { logicIndex: 416, name: 'THF', cx: 108, cy: 74 },
      ]);

      const tsThieves = await adapterPage(handle.ts).evaluate(() => {
        const game = (window as any).__agentGame;
        return (game.entities ?? [])
          .filter((entry: any) => entry.logicIndexHint === 415 || entry.logicIndexHint === 416)
          .map((entry: any) => ({
            logicIndex: entry.logicIndexHint,
            type: entry.type,
            image: entry.stats?.image,
            cx: entry.cell?.cx,
            cy: entry.cell?.cy,
          }))
          .sort((a: any, b: any) => a.logicIndex - b.logicIndex);
      });
      expect(tsThieves).toEqual([
        { logicIndex: 415, type: 'THF', image: 'thf', cx: 108, cy: 74 },
        { logicIndex: 416, type: 'THF', image: 'thf', cx: 108, cy: 74 },
      ]);

      const [wasmPng, tsPng] = await Promise.all([
        wasmRenderedFrame(handle.wasm),
        tsRenderedFrame(handle.ts),
      ]);
      expectCropMatch(wasmPng, tsPng, { x: 395, y: 176, w: 60, h: 64 });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);

  it('uses FillSilos starting Tiberium for enemy SILO fill frames', async () => {
    await withDualScenario('SCG14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 50);

      const cppSilo = await adapterPage(handle.wasm).evaluate(() => {
        const module = (window as any).Module;
        const layer = JSON.parse(module.ccall(
          'agent_dump_layer',
          'string',
          ['number', 'number', 'number', 'number', 'number'],
          [1, 104, 78, 104, 78],
        ));
        return (layer.objects ?? []).find((entry: any) => entry.name === 'SILO');
      });
      expect(cppSilo).toMatchObject({ name: 'SILO', cx: 104, cy: 78 });

      const [wasmPng, tsPng] = await Promise.all([
        wasmRenderedFrame(handle.wasm),
        tsRenderedFrame(handle.ts),
      ]);
      expectCropMatch(wasmPng, tsPng, { x: 312, y: 276, w: 24, h: 32 });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);
});
