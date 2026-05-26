/**
 * Dual-runtime visual regression for C++ structure turret frame selection.
 *
 * SCU12 tick 50 exposes two guard turrets with PrimaryFacing values 32 and 224.
 * C++ BuildingClass::Shape_Number maps those through Dir_To_32 before indexing
 * BodyShape. Rendering from the rounded 8-way turretDir mirrors the turret art.
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

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU12 guard turret facing', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('renders GUN turrets from 32-way PrimaryFacing frames at tick 50', async () => {
    await withDualScenario('SCU12EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 50);

      const cppGuns = await adapterPage(handle.wasm).evaluate(() => {
        const module = (window as any).Module;
        const state = JSON.parse(module.ccall('agent_get_state', 'string', [], []));
        return (state.logicLayer ?? [])
          .filter((row: any[]) => row[1] === 'GUN' && (row[3] === 32 || row[3] === 38) && row[4] === 42)
          .map((row: any[]) => ({
            logicIndex: row[0],
            type: row[1],
            house: row[2],
            cx: row[3],
            cy: row[4],
            turretFacing256: row[28],
          }))
          .sort((a: any, b: any) => a.cx - b.cx);
      });
      expect(cppGuns).toEqual([
        { logicIndex: 249, type: 'GUN', house: 'Greece', cx: 32, cy: 42, turretFacing256: 32 },
        { logicIndex: 248, type: 'GUN', house: 'GoodGuy', cx: 38, cy: 42, turretFacing256: 224 },
      ]);

      const tsGuns = await adapterPage(handle.ts).evaluate(() => {
        const game = (window as any).__agentGame;
        return (game.structures ?? [])
          .filter((s: any) => s.type === 'GUN' && (s.cx === 32 || s.cx === 38) && s.cy === 42)
          .map((s: any) => ({
            type: s.type,
            house: s.house,
            cx: s.cx,
            cy: s.cy,
            turretDir: s.turretDir,
            turretFacing256: s.turretFacing256,
          }))
          .sort((a: any, b: any) => a.cx - b.cx);
      });
      expect(tsGuns).toEqual([
        { type: 'GUN', house: 'Greece', cx: 32, cy: 42, turretDir: 1, turretFacing256: 32 },
        { type: 'GUN', house: 'GoodGuy', cx: 38, cy: 42, turretDir: 7, turretFacing256: 224 },
      ]);

      const [wasmPng, tsPng] = await Promise.all([
        wasmRenderedFrame(handle.wasm),
        tsRenderedFrame(handle.ts),
      ]);
      expectCropMatch(wasmPng, tsPng, { x: 130, y: 140, w: 200, h: 45 });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);
});
