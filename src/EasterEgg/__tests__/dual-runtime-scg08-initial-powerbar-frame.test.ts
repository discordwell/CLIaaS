/**
 * Dual-runtime visual regressions for sidebar/powerbar frame caching.
 *
 * C++ agent_step(1) leaves the startup HidPage visible while the first logic
 * tick has advanced state. TS must also honor C++ PowerClass redraw requests
 * that come from building Limbo, even when the structure has no power/drain
 * contribution.
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

describe.skipIf(!serverUp)('Dual runtime C++ parity: sidebar powerbar frame cache', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps the startup powerbar chrome visible after agent_step(1)', async () => {
    await withDualScenario('SCG08EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 1);

      const [wasmPng, tsPng] = await Promise.all([
        wasmRenderedFrame(handle.wasm),
        tsRenderedFrame(handle.ts),
      ]);

      expectCropMatch(wasmPng, tsPng, { x: 480, y: 176, w: 20, h: 224 });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);

  it('advances uncaptured frame-zero power AI for later stepped captures', async () => {
    await withDualScenario('SCU02EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 1);
      await stepBoth(handle, 49);

      const [wasmPng, tsPng] = await Promise.all([
        wasmRenderedFrame(handle.wasm),
        tsRenderedFrame(handle.ts),
      ]);

      expectCropMatch(wasmPng, tsPng, { x: 482, y: 278, w: 18, h: 18 });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);

  it('draws the drain marker from active player structures, not all hidden scenario buildings', async () => {
    await withDualScenario('SCU31EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 100);

      const [wasmPng, tsPng] = await Promise.all([
        wasmRenderedFrame(handle.wasm),
        tsRenderedFrame(handle.ts),
      ]);

      expectCropMatch(wasmPng, tsPng, { x: 482, y: 200, w: 18, h: 40 });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);

  it('redraws player power chrome when a zero-power building enters Limbo', async () => {
    await withDualScenario('SCU07EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 65);

      const [wasmPng, tsPng] = await Promise.all([
        wasmRenderedFrame(handle.wasm),
        tsRenderedFrame(handle.ts),
      ]);

      expectCropMatch(wasmPng, tsPng, { x: 498, y: 176, w: 2, h: 210 });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);

  it('keeps the zero-height power marker after a Limbo-triggered power redraw', async () => {
    await withDualScenario('SCU07EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 100);

      const [wasmPng, tsPng] = await Promise.all([
        wasmRenderedFrame(handle.wasm),
        tsRenderedFrame(handle.ts),
      ]);

      expectCropMatch(wasmPng, tsPng, { x: 482, y: 390, w: 18, h: 10 });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);

  it('does not invent a first-tick sidebar redraw in no-base missions', async () => {
    await withDualScenario('SCG20EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 100);

      const [wasmPng, tsPng] = await Promise.all([
        wasmRenderedFrame(handle.wasm),
        tsRenderedFrame(handle.ts),
      ]);

      expectCropMatch(wasmPng, tsPng, { x: 480, y: 176, w: 20, h: 224 });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);

  it('leaves empty-sidebar missions side-over-power until a real power redraw', async () => {
    await withDualScenario('SCG10EB', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 100);

      const [wasmPng, tsPng] = await Promise.all([
        wasmRenderedFrame(handle.wasm),
        tsRenderedFrame(handle.ts),
      ]);

      expectCropMatch(wasmPng, tsPng, { x: 480, y: 176, w: 20, h: 224 });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);

});
