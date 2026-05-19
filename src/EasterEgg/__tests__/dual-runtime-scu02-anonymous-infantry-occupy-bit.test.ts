/**
 * Dual-runtime check for anonymous InfantryClass occupy bits.
 *
 * SCU02EB leaves a raw C++ CellClass infantry bit in cell (54,77) after an
 * earlier DogJaw unlimbo/move handoff. There is no Cell_Occupier owner there,
 * but CellClass::Closest_Free_Spot still treats the upper-left subcell as
 * occupied. The next dog entering that cell must therefore reserve center.
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

async function stepBothInCppSizedChunks(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<void> {
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 15);
    await stepBoth(handle, chunk);
    remaining -= chunk;
  }
}

async function wasmDogAndCell(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const all = [...(state.units ?? []), ...(state.enemies ?? [])];
    const dog = all.find((e: any) => e.id === 851974);
    if (!dog) throw new Error('C++ SCU02EB dog 851974 missing');
    const cell = JSON.parse(
      (window as any).Module.ccall(
        'agent_get_cell_info',
        'string',
        ['number', 'number', 'number'],
        [54, 77, 851974],
      ),
    );
    return {
      tick: state.tick,
      rngState: state.rngState,
      dog: {
        leptonX: dog.lx,
        leptonY: dog.ly,
        headToLeptonX: dog.hlx,
        headToLeptonY: dog.hly,
        isDriving: dog.drv,
      },
      cellFlag: cell.flag,
    };
  });
}

async function tsDogAndCell(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const dog = game.entities.find((e: any) => e.id === 42);
    if (!dog) throw new Error('TS SCU02EB dog 42 missing');
    const cellIdx = 77 * 128 + 54;
    const slots = game.map.subCellOccupancy.get(cellIdx) ?? [0, 0, 0, 0, 0];
    return {
      tick: game.tick,
      rngState: state.rngState,
      dog: {
        leptonX: dog.leptonX,
        leptonY: dog.leptonY,
        headToLeptonX: dog.headToLX,
        headToLeptonY: dog.headToLY,
        isDriving: dog.isDriving,
      },
      slots,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU02EB anonymous infantry occupy bit', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps stale subcell flags visible to Closest_Free_Spot', async () => {
    await withDualScenario('SCU02EB', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBothInCppSizedChunks(handle, 894);

      const cpp = await wasmDogAndCell(handle.wasm);
      const ts = await tsDogAndCell(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.cellFlag & 0x02).toBe(0x02);
      expect(cpp.dog.isDriving).toBe(true);
      expect(ts.dog.isDriving).toBe(true);
      expect(ts.slots[1] !== 0).toBe(true);
      expect(ts.dog.leptonX).toBe(cpp.dog.leptonX);
      expect(ts.dog.leptonY).toBe(cpp.dog.leptonY);
      expect(ts.dog.headToLeptonX).toBe(cpp.dog.headToLeptonX);
      expect(ts.dog.headToLeptonY).toBe(cpp.dog.headToLeptonY);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
