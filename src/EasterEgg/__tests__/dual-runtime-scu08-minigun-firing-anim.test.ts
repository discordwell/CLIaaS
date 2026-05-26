/**
 * Dual-runtime visual regression for C++ weapon firing animations.
 *
 * C++ TechnoClass::Fire_At creates an AnimClass from weapon->Anim and attaches
 * it to the firing object. SCU08 tick 50 exposes a jeep M60mg shot that C++
 * renders as an attached MINIGUN AnimClass; TS previously drew a generic
 * one-off muzzle Effect that kept gameplay state synced but changed pixels.
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

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU08 minigun firing animation', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('uses the attached MINIGUN AnimClass for a jeep M60mg shot at tick 50', async () => {
    await withDualScenario('SCU08EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 50);

      const cppMinigun = await adapterPage(handle.wasm).evaluate(() => {
        const module = (window as any).Module;
        const layer = JSON.parse(module.ccall(
          'agent_dump_layer',
          'string',
          ['number', 'number', 'number', 'number', 'number'],
          [1, 85, 92, 85, 92],
        ));
        return (layer.objects ?? [])
          .filter((entry: any) => entry.name === 'MINIGUN')
          .map((entry: any) => ({
            logicIndex: entry.logicIndex,
            name: entry.name,
            cx: entry.cx,
            cy: entry.cy,
            lx: entry.lx,
            ly: entry.ly,
            rx: entry.rx,
            ry: entry.ry,
            sx: entry.sx,
            sy: entry.sy,
            display: entry.display,
          }));
      });
      expect(cppMinigun).toEqual([
        {
          logicIndex: 201,
          name: 'MINIGUN',
          cx: 85,
          cy: 92,
          lx: 21932,
          ly: 23649,
          rx: 21932,
          ry: 23649,
          sx: 21888,
          sy: 23809,
          display: true,
        },
      ]);

      const tsMinigun = await adapterPage(handle.ts).evaluate(() => {
        const game = (window as any).__agentGame;
        return (game.logicAnims ?? [])
          .filter((anim: any) => anim.logicIndexHint === 201)
          .map((anim: any) => ({
            anim,
            entity: (game.entities ?? []).find((entry: any) => entry.id === anim.attachedEntityId),
          }))
          .map(({ anim, entity }: any) => {
            const target = entity?.targetCoordLeptons?.() ?? { lx: entity?.leptonX, ly: entity?.leptonY };
            const lx = target.lx + (anim.attachedEntityOffsetLX ?? 0);
            const ly = target.ly + (anim.attachedEntityOffsetLY ?? 0);
            return {
              type: anim.type,
              logicIndex: anim.logicIndexHint,
              attachedEntityLogicIndex: entity?.logicIndexHint,
              attachedOffsetLX: anim.attachedEntityOffsetLX,
              attachedOffsetLY: anim.attachedEntityOffsetLY,
              startFrame: anim.startFrame,
              renderLX: lx,
              renderLY: ly,
              x: Number((lx * 24 / 256).toFixed(3)),
              y: Number((ly * 24 / 256).toFixed(3)),
            };
          });
      });
      expect(tsMinigun).toEqual([
        {
          type: 'minigun',
          logicIndex: 201,
          attachedEntityLogicIndex: 80,
          attachedOffsetLX: 44,
          attachedOffsetLY: -31,
          startFrame: 36,
          renderLX: 21932,
          renderLY: 23649,
          x: 2056.125,
          y: 2217.094,
        },
      ]);

      const [wasmPng, tsPng] = await Promise.all([
        wasmRenderedFrame(handle.wasm),
        tsRenderedFrame(handle.ts),
      ]);
      expectCropMatch(wasmPng, tsPng, { x: 70, y: 180, w: 60, h: 50 });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);
});
