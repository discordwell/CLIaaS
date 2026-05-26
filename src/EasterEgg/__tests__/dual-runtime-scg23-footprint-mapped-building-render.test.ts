/**
 * Dual-runtime visual regression for multi-cell building render gating.
 *
 * In SCG23EA, a Spain V04 village building has an unmapped origin cell while
 * its lower footprint cells are display-mapped. C++ redraws the BuildingClass
 * through those mapped Cell_Occupier cells, so the lower visible body pixels
 * still appear under the shroud edge.
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

async function tsVillageProbe(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const structure = game.structures.find((s: any) => s.type === 'V04' && s.cx === 68 && s.cy === 79);
    if (!structure) throw new Error('SCG23EA V04 at (68,79) not found');
    const originIdx = 79 * 128 + 68;
    const lowerLeftIdx = 80 * 128 + 68;
    const lowerRightIdx = 80 * 128 + 69;
    return {
      type: structure.type,
      house: structure.house,
      originDisplay: game.map.displayVisibility[originIdx],
      lowerLeftDisplay: game.map.displayVisibility[lowerLeftIdx],
      lowerRightDisplay: game.map.displayVisibility[lowerRightIdx],
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG23 footprint-mapped building rendering', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('draws a multi-cell building when a footprint cell is mapped even if its origin is unmapped', async () => {
    await withDualScenario('SCG23EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 100);

      await expect(tsVillageProbe(handle.ts)).resolves.toEqual({
        type: 'V04',
        house: 'Spain',
        originDisplay: 0,
        lowerLeftDisplay: 1,
        lowerRightDisplay: 1,
      });

      const [cpp, ts] = await Promise.all([
        wasmPixel(handle.wasm, 189, 150),
        tsPixel(handle.ts, 189, 150),
      ]);

      expect(ts).toEqual(cpp);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 180_000);
});
