/**
 * Dual-runtime regression for DisplayClass::ShadowTrans on interior shroud edges.
 *
 * C++ builds ShadowTrans with Build_Translucent_Table, which delegates to
 * Build_Fading_Table. Interior missions expose this on mapped-but-not-visible
 * cells: the shroud edge remaps black back-buffer pixels to the first dark
 * palette slot instead of leaving them pure black.
 */
import { PNG } from 'pngjs';
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
  evaluate<T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

function dataUrlToPng(dataUrl: string): PNG {
  return PNG.sync.read(Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
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

function pixelAt(png: PNG, x: number, y: number): [number, number, number, number] {
  const off = (y * png.width + x) * 4;
  return [
    png.data[off],
    png.data[off + 1],
    png.data[off + 2],
    png.data[off + 3],
  ];
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: interior ShadowTrans shroud edges', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('remaps mapped interior shroud-edge pixels with the same fading table as C++', async () => {
    await withDualScenario('SCG21EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 100);

      const wasmCell = await adapterPage(handle.wasm).evaluate(() => {
        const module = (window as any).Module;
        return JSON.parse(module.ccall(
          'agent_get_cell_info',
          'string',
          ['number', 'number', 'number'],
          [6, 54, -1],
        ));
      });
      expect(wasmCell).toMatchObject({ cx: 6, cy: 54, mapped: true, visible: false });

      const tsSample = await adapterPage(handle.ts).evaluate(() => {
        const game = (window as any).__agentGame;
        const cx = 6;
        const cy = 54;
        return {
          displayVisibility: game.map.displayVisibility[cy * 128 + cx],
          x: Math.round(cx * 24 - game.camera.x + game.camera.screenX + 7),
          y: Math.round(cy * 24 - game.camera.y + game.camera.screenY + 12),
        };
      });
      expect(tsSample.displayVisibility).toBe(1);

      const [wasmPng, tsPng] = await Promise.all([
        wasmRenderedFrame(handle.wasm),
        tsRenderedFrame(handle.ts),
      ]);
      const wasmPixel = pixelAt(wasmPng, tsSample.x, tsSample.y);
      const tsPixel = pixelAt(tsPng, tsSample.x, tsSample.y);

      expect(wasmPixel.slice(0, 3)).not.toEqual([0, 0, 0]);
      expect(tsPixel).toEqual(wasmPixel);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 180_000);
});
