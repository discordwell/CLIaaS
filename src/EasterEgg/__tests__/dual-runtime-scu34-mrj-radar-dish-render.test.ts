/**
 * Dual-runtime visual regression for radar-equipped unit overlays.
 *
 * SCU34EA starts with six visible Soviet MRJs. C++ UnitClass::Draw_It draws
 * the MRJ body, then a rotating radar dish frame from the same SHP at y - 5.
 * Without that second Techno_Draw_Object pass, TS leaves remapped body pixels
 * where C++ shows the grey radar dish.
 */
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

async function wasmPixel(adapter: unknown, x: number, y: number): Promise<number[]> {
  return adapterPage(adapter).evaluate(({ x, y }) => {
    const module = (window as any).Module;
    module.ccall('agent_render', null, [], []);
    const ptr = (window as any).__agentFramePtr;
    if (!ptr || !module.HEAPU8) throw new Error('agent render frame buffer is unavailable');
    const offset = (y * 640 + x) * 4;
    return [
      module.HEAPU8[ptr + offset],
      module.HEAPU8[ptr + offset + 1],
      module.HEAPU8[ptr + offset + 2],
      module.HEAPU8[ptr + offset + 3],
    ];
  }, { x, y });
}

async function tsPixel(adapter: unknown, x: number, y: number): Promise<number[]> {
  return adapterPage(adapter).evaluate(({ x, y }) => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) throw new Error('TS canvas is unavailable');
    const data = canvas.getContext('2d')!.getImageData(x, y, 1, 1).data;
    return [data[0], data[1], data[2], data[3]];
  }, { x, y });
}

async function tsMrjProbe(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const mrj = game.entities.find((e: any) => e.type === 'MRJ' && e.cell?.cx === 96 && e.cell?.cy === 22);
    if (!mrj) throw new Error('SCU34EA MRJ at (96,22) not found');
    const screen = game.camera.worldToScreen(mrj.pos.x, mrj.pos.y);
    return {
      type: mrj.type,
      house: mrj.house,
      bodyFacing32: mrj.bodyFacing32,
      alive: mrj.alive,
      inLimbo: mrj.inLimbo,
      screenX: Math.round(screen.x),
      screenY: Math.round(screen.y),
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU34 MRJ radar dish rendering', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('draws the MRJ radar dish overlay above the remapped vehicle body', async () => {
    await withDualScenario('SCU34EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 1);

      await expect(tsMrjProbe(handle.ts)).resolves.toEqual({
        type: 'MRJ',
        house: 'USSR',
        bodyFacing32: 16,
        alive: true,
        inLimbo: false,
        screenX: 312,
        screenY: 64,
      });

      const [cpp, ts] = await Promise.all([
        wasmPixel(handle.wasm, 308, 58),
        tsPixel(handle.ts, 308, 58),
      ]);

      expect(ts).toEqual(cpp);

      await stepBoth(handle, 99);
      const [cppT100, tsT100] = await Promise.all([
        wasmPixel(handle.wasm, 308, 60),
        tsPixel(handle.ts, 308, 60),
      ]);

      expect(tsT100).toEqual(cppT100);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 180_000);
});
