/**
 * Dual-runtime shroud parity for transport passenger unlimbo.
 *
 * C++ FootClass::Unlimbo calls Revealed(House). For player-owned passengers,
 * TechnoClass::Revealed immediately calls Look(false), mapping sight from the
 * unloaded passenger before it starts clearing the landing zone.
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

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG01 transport passenger unlimbo Look', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('maps Tanya sight immediately when she exits the loaner Chinook', async () => {
    await withDualScenario('SCG01EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 139);

      const cells: Array<[number, number]> = [
        [58, 45],
        [68, 45],
        [57, 47],
        [69, 47],
      ];
      const { cpp, ts } = await readCells(handle, cells);

      expect(ts).toEqual(cpp);
      expect(ts.every(cell => cell.mapped)).toBe(true);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 180_000);
});
