/**
 * Dual-runtime regression for player production availability.
 *
 * C++ HouseClass::Can_Build checks ActiveBScan for human houses, not every
 * alive owned building. SCU31 starts with several player structures under
 * shroud/inactive; they exist in BScan, but do not unlock sidebar production
 * until they are IsLocked and IsDiscoveredByPlayer.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ensureParityServer,
  isDevServerAvailable,
  stopParityServer,
  withDualScenario,
  type DualRuntimeHandle,
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

async function wasmPlayerScan(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const player = (state.houses ?? []).find((house: any) => house.house === state.playerHouse);
    if (!player) throw new Error(`C++ player house ${state.playerHouse} missing`);

    const structOrder = [
      'ATEK', 'IRON', 'WEAP', 'PDOX', 'PBOX', 'HBOX', 'DOME', 'GAP',
      'GUN', 'AGUN', 'FTUR', 'FACT', 'PROC', 'SILO', 'HPAD', 'SAM',
      'AFLD', 'POWR', 'APWR', 'STEK', 'HOSP', 'BARR', 'TENT', 'KENN',
      'FIX', 'BIO', 'MISS', 'SYRD', 'SPEN', 'MSLO', 'FCOM', 'TSLA',
    ];
    const activeTypes = structOrder.filter((_, index) => ((player.activeBScan >>> 0) & (1 << index)) !== 0);
    const allTypes = structOrder.filter((_, index) => ((player.bscan >>> 0) & (1 << index)) !== 0);

    return {
      tick: state.tick,
      playerHouse: state.playerHouse,
      activeTypes,
      allTypes,
      buildable: state.buildable,
    };
  });
}

async function tsProductionAvailability(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = (window as any).__agentState();
    const availableItems = state.availableItems ?? [];
    return {
      tick: state.tick,
      left: availableItems.filter((item: any) => item.side === 'left').map((item: any) => item.t),
      right: availableItems.filter((item: any) => item.side === 'right').map((item: any) => item.t),
    };
  });
}

async function stepBothBatched(handle: Pick<DualRuntimeHandle, 'ts' | 'wasm'>, ticks: number) {
  let remaining = ticks;
  while (remaining > 0) {
    const batch = Math.min(remaining, 300);
    remaining -= batch;
    await Promise.all([
      handle.ts.step(batch),
      handle.wasm.step(batch),
    ]);
  }
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU31 active scan gates production availability', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not unlock factories or tech from player buildings absent from ActiveBScan', async () => {
    await withDualScenario('SCU31EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothBatched(handle, 2000);
      const [cpp, ts] = await Promise.all([
        wasmPlayerScan(handle.wasm),
        tsProductionAvailability(handle.ts),
      ]);

      expect(ts.tick).toBe(cpp.tick);
      expect(cpp.allTypes).toEqual(expect.arrayContaining(['FACT', 'PROC', 'WEAP', 'SPEN']));
      expect(cpp.activeTypes).not.toEqual(expect.arrayContaining(['FACT', 'PROC', 'WEAP', 'SPEN']));
      expect(cpp.activeTypes).toEqual(expect.arrayContaining(['APWR', 'BARR', 'STEK']));
      expect(cpp.buildable.infantry).toEqual(['E1', 'E2', 'E4', 'E6']);
      expect(cpp.buildable.infantry).not.toContain('SHOK');

      expect(ts.left).toEqual([]);
      expect(ts.right).toEqual(['E1', 'E2', 'E4', 'E6']);
      expect(ts.right).not.toEqual(expect.arrayContaining(['3TNK', '4TNK', 'HARV', 'SS', 'MSUB']));
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);
});
