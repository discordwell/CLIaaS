/**
 * Dual-runtime visual shroud check for SCG11EA south-edge MCV reinforcements.
 *
 * C++ places the MCVs on the display-only perimeter ring at tick 1. Their origin
 * cell is outside Map.In_Radar, so the initial All_To_Look pass must not reveal
 * the playable cells above them. Later vehicle PCP_END calls use Look(true),
 * which is incremental and also leaves the interior MCV cells shrouded.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ensureParityServer,
  isDevServerAvailable,
  stepBoth,
  stopParityServer,
  withDualScenario,
  type DualRuntimeHandle,
  type ParityServerHandle,
} from './dual-runtime-test-utils.js';

const serverUp = isDevServerAvailable();
let serverHandle: ParityServerHandle | undefined;

type EvalPage = {
  evaluate<T, Arg>(fn: (arg: Arg) => T, arg: Arg): Promise<T>;
  evaluate<T>(fn: () => T): Promise<T>;
};

type CellProbe = {
  cx: number;
  cy: number;
  mapped: boolean;
  visible: boolean;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function readCells(handle: DualRuntimeHandle, cells: Array<[number, number]>) {
  const cpp = await adapterPage(handle.wasm).evaluate((probeCells: Array<[number, number]>) => {
    const M = (window as any).Module;
    return probeCells.map(([cx, cy]) => {
      const cell = JSON.parse(M.ccall('agent_get_cell_info', 'string', ['number', 'number', 'number'], [cx, cy, -1]));
      return { cx, cy, mapped: cell.mapped, visible: cell.visible };
    });
  }, cells) as CellProbe[];

  const ts = await adapterPage(handle.ts).evaluate((probeCells: Array<[number, number]>) => {
    const game = (window as any).__agentGame;
    return probeCells.map(([cx, cy]) => {
      const display = game.map.getDisplayVisibility(cx, cy);
      return { cx, cy, mapped: display > 0, visible: display === 2 };
    });
  }, cells) as CellProbe[];

  return { cpp, ts };
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG11 MCV display shroud', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps south-edge MCV reinforcement cells shrouded through tick 100', async () => {
    await withDualScenario('SCG11EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 50);

      const tick50 = await readCells(handle, [[22, 103], [28, 103], [22, 102], [28, 102]]);
      expect(tick50.ts).toEqual(tick50.cpp);
      expect(tick50.ts.every(cell => !cell.mapped && !cell.visible)).toBe(true);

      await stepBoth(handle, 50);

      const tick100 = await readCells(handle, [[21, 102], [22, 102], [23, 102], [27, 102], [28, 102], [29, 102]]);
      expect(tick100.ts).toEqual(tick100.cpp);
      expect(tick100.ts.every(cell => !cell.mapped && !cell.visible)).toBe(true);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
