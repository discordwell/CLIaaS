/**
 * Dual-runtime visual regression for C++ TerrainClass redraw under mapped
 * display shadow.
 *
 * SCG06EB reaches a TC02 clump whose origin is still unmapped at tick 100, but
 * several registered occupy/overlap cells are mapped shadow cells. C++
 * CellClass::Redraw_Objects marks the TerrainClass through those cells and
 * DisplayClass::Coord_To_Pixel accepts the origin inside its two-cell edge
 * zone, so the clump is redrawn under SHADOW.SHP.
 */
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TREE_OCCUPY, TREE_OVERLAP } from '../engine/map.js';
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
  evaluate<T, A = unknown>(fn: (arg: A) => T, arg?: A): Promise<T>;
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

async function tsTreeProbe(adapter: unknown) {
  const treeType = 'tc02';
  const footprint = [...(TREE_OCCUPY[treeType] ?? []), ...(TREE_OVERLAP[treeType] ?? [])];
  return adapterPage(adapter).evaluate(({ footprint }) => {
    const game = (window as any).__agentGame;
    const camera = game.camera;
    const cx = 46;
    const cy = 103;
    const tree = game.map.getTreeAtOrigin(cx, cy);
    const originIdx = cy * 128 + cx;
    const displays = footprint.map(([dx, dy]: [number, number]) => {
      const tx = cx + dx;
      const ty = cy + dy;
      return game.map.displayVisibility[ty * 128 + tx] ?? 0;
    });
    return {
      treeType: tree?.type,
      originDisplay: game.map.displayVisibility[originIdx],
      maxFootprintDisplay: Math.max(0, ...displays),
      screenX: cx * 24 - camera.x,
      screenY: cy * 24 - camera.y,
    };
  }, { footprint });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG06 mapped-shadow tree redraw', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('redraws a TerrainClass tree through mapped shadow footprint cells', async () => {
    await withDualScenario('SCG06EB', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 100);

      await expect(tsTreeProbe(handle.ts)).resolves.toEqual(expect.objectContaining({
        treeType: 'tc02',
        originDisplay: 0,
        maxFootprintDisplay: 1,
        screenX: 36,
        screenY: 168,
      }));

      const [wasmPng, tsPng] = await Promise.all([
        wasmRenderedFrame(handle.wasm),
        tsRenderedFrame(handle.ts),
      ]);

      expectCropMatch(wasmPng, tsPng, { x: 35, y: 190, w: 100, h: 70 });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);
});
