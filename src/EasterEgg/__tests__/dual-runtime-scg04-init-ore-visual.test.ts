/**
 * Dual-runtime check for scenario-init ore visual variants.
 *
 * SCG04EA has a large starting ore field. C++ MapClass::Overpass calls
 * CellClass::Tiberium_Adjust(true), which consumes one gameplay RNG pick per
 * ore cell to randomize OVERLAY_GOLD1..4 visual variants. The TS agent harness
 * must only run that scenario-init path once; otherwise the active map keeps the
 * right OverlayData density but draws shifted ore art.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TsAgentAdapter } from '../oracle/TsAgentAdapter.js';
import { WasmAdapter } from '../oracle/WasmAdapter.js';
import {
  ensureParityServer,
  isDevServerAvailable,
  RA_PARITY_BASE_URL,
  stopParityServer,
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

const ORE_SAMPLE_CELLS = [
  { cx: 71, cy: 56 },
  { cx: 72, cy: 56 },
  { cx: 73, cy: 57 },
  { cx: 74, cy: 57 },
  { cx: 78, cy: 58 },
  { cx: 74, cy: 59 },
] as const;

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG04 init ore visuals', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('runs Map.Overpass once so initial ore visual variants match C++', async () => {
    const ts = new TsAgentAdapter({
      url: RA_PARITY_BASE_URL,
      headless: true,
      viewport: { width: 1200, height: 800 },
    });
    const wasm = new WasmAdapter({
      scenario: 'SCG04EA',
      headless: true,
      autoplay: true,
      url: new URL('/ra/original.html', RA_PARITY_BASE_URL).toString(),
      seed: 0,
    });

    await ts.connect();
    try {
      const tsState = await ts.loadScenario('SCG04EA', 'normal', { preserveSourceFog: true });
      await wasm.connect();
      try {
        const wasmState = await wasm.observe();
        expect(tsState.tick).toBe(0);
        expect(wasmState.tick).toBe(0);
        expect(tsState.rngState >>> 0).toBe(wasmState.rngState! >>> 0);

        const cppCells = await adapterPage(wasm).evaluate((cells) => {
          const M = (window as any).Module;
          return cells.map(({ cx, cy }) => {
            const info = JSON.parse(M.ccall('agent_get_cell_info', 'string', ['number', 'number', 'number'], [cx, cy, -1]));
            return { cx, cy, overlay: info.overlay, overlayData: info.overlayData };
          });
        }, ORE_SAMPLE_CELLS);

        const tsCells = await adapterPage(ts).evaluate((cells) => {
          const game = (window as any).__agentGame;
          return cells.map(({ cx, cy }) => {
            const idx = cy * 128 + cx;
            return {
              cx,
              cy,
              overlay: game.map.overlay[idx],
              overlayData: game.map.oreDensity[idx],
            };
          });
        }, ORE_SAMPLE_CELLS);

        expect(tsCells).toEqual(cppCells);
      } finally {
        await wasm.disconnect();
      }
    } finally {
      await ts.disconnect();
    }
  }, 180_000);
});
