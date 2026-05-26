/**
 * Dual-runtime visual regression for Counterstrike ant unit rendering.
 *
 * SCA04EA exposes two ANT3 units near the starting camera at tick 100. The
 * C++ reference must load EXPAND.MIX so ANT3.SHP is present, and TS must draw
 * live ants with UnitClass::Shape_Number frames/remap rather than the legacy
 * green placeholder sheet or stale AnimState frame.
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
    image.data.set(module.HEAPU8.subarray(ptr, ptr + w * h * 4));
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

function antCropMismatch(wasmPng: PNG, tsPng: PNG): number {
  const box = { x: 238, y: 204, w: 42, h: 42 };
  const wasmCrop = cropPng(wasmPng, box);
  const tsCrop = cropPng(tsPng, box);
  const diff = new PNG({ width: box.w, height: box.h });
  return pixelmatch(wasmCrop.data, tsCrop.data, diff.data, box.w, box.h, {
    threshold: 0.1,
    includeAA: true,
  });
}

async function tsAntProbe(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    return game.entities
      .filter((e: any) => e.type === 'ANT3' && e.house === 'Germany' && e.cell.cx === 111 && (e.cell.cy === 64 || e.cell.cy === 65))
      .map((e: any) => ({
        id: e.id,
        cy: e.cell.cy,
        bodyFacing256: e.bodyFacing256,
        attackCooldown: e.attackCooldown,
        isDriving: e.isDriving,
        cppUnitIndexHint: e.cppUnitIndexHint,
      }))
      .sort((a: any, b: any) => a.cy - b.cy);
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCA04 ant expansion rendering', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('draws live ANT3 frames and remap colors against the loaded C++ expansion SHP', async () => {
    await withDualScenario('SCA04EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 100);

      await expect(tsAntProbe(handle.ts)).resolves.toEqual([
        expect.objectContaining({
          cy: 64,
          bodyFacing256: 91,
          attackCooldown: 0,
          isDriving: false,
          cppUnitIndexHint: 41,
        }),
        expect.objectContaining({
          cy: 65,
          bodyFacing256: 57,
          attackCooldown: 8,
          isDriving: false,
          cppUnitIndexHint: 7,
        }),
      ]);

      const [wasmPng, tsPng] = await Promise.all([
        wasmRenderedFrame(handle.wasm),
        tsRenderedFrame(handle.ts),
      ]);

      expect(antCropMismatch(wasmPng, tsPng)).toBeLessThanOrEqual(50);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);
});
