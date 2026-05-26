/**
 * SCG08EB owns both ATEK and PDOX, but Greece is TechLevel=8 while the
 * Chronosphere building type remains TechLevel=12. C++ gates the Chronosphere
 * special by the provider BuildingTypeClass level, so only the GPS special
 * appears in the sidebar.
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
      const si = ((box.y + y) * source.width + (box.x + x)) * 4;
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

async function tsSpecials(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = (window as any).__agentState();
    return (state.superweapons ?? []).map((entry: any) => entry.type).sort();
  }) as Promise<string[]>;
}

async function wasmGreeceTechLevel(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const module = (window as any).Module;
    const state = JSON.parse(module.ccall('agent_get_state', 'string', [], []));
    const house = (state.houses ?? []).find((entry: any) => entry.house === 'Greece');
    return house ? house.techLevel : null;
  }) as Promise<number | null>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG08EB Chronosphere tech gate', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not expose Chronosphere when the provider building tech level exceeds house tech', async () => {
    await withDualScenario('SCG08EB', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 50);

      expect(await wasmGreeceTechLevel(handle.wasm)).toBe(8);
      expect(await tsSpecials(handle.ts)).toEqual(['GPS_SATELLITE']);

      const wasmPng = await wasmRenderedFrame(handle.wasm);
      const tsPng = await tsRenderedFrame(handle.ts);
      const box = { x: 500, y: 168, w: 136, h: 92 };
      const wasmCrop = cropPng(wasmPng, box);
      const tsCrop = cropPng(tsPng, box);
      const diff = new PNG({ width: box.w, height: box.h });
      const mismatch = pixelmatch(wasmCrop.data, tsCrop.data, diff.data, box.w, box.h, {
        threshold: 0.1,
        includeAA: true,
      });

      expect(mismatch).toBe(0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);
});
