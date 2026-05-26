/**
 * Dual-runtime visual regression for TerrainClass draw gating under shroud.
 *
 * In SCU01EA, a TC04 tree overlaps the visible shroud edge while its origin
 * cell is still unmapped. C++ does not draw that TerrainClass object into the
 * tactical layer yet; only the clear snow cell underneath is shadow-remapped.
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
  evaluate<T>(fn: () => T): Promise<T>;
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

async function tsTreeProbe(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const originIdx = 72 * 128 + 32;
    const overlapIdx = 73 * 128 + 34;
    const tree = game.map.getTreeAtOrigin(32, 72);
    return {
      treeType: tree?.type,
      originDisplay: game.map.displayVisibility[originIdx],
      overlapDisplay: game.map.displayVisibility[overlapIdx],
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU01 unmapped tree shroud rendering', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not draw a TerrainClass tree whose origin cell is still unmapped', async () => {
    await withDualScenario('SCU01EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 1);

      await expect(tsTreeProbe(handle.ts)).resolves.toEqual({
        treeType: 'tc04',
        originDisplay: 0,
        overlapDisplay: 1,
      });

      const [cpp, ts] = await Promise.all([
        wasmPixel(handle.wasm, 0, 118),
        tsPixel(handle.ts, 0, 118),
      ]);

      expect(ts).toEqual(cpp);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 180_000);
});
