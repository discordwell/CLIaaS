/**
 * Dual-runtime check for BuildingClass::Repair_AI on lightly damaged AI buildings.
 *
 * SCG05EA has two BadGuy barracks marked rebuild/repairable. C++ repairs even
 * one point of damage: Repair_AI starts IsRepairing, seeds House::RepairTimer,
 * then the per-building RepairRate pulse heals to full and clears IsRepairing.
 * A late TS-only "repair below 80%" sweep left these buildings stuck repairing,
 * causing the later tick-1802 RepairTimer RNG draw to be skipped.
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

async function wasmRepairSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const barr = state.structures.find((s: any) =>
      s.t === 'BARR' && s.house === 'BadGuy' && s.cx === 56 && s.cy === 83);
    const ftur = state.logicLayer.find((r: any[]) =>
      r[1] === 'FTUR' && r[2] === 'USSR' && r[3] === 36 && r[4] === 88);
    if (!barr || !ftur) throw new Error('C++ SCG05EA repair snapshot target missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      barr: {
        hp: barr.hp,
        maxHp: barr.mhp,
        repairing: barr.repairing,
      },
      ftur: {
        missionTimer: ftur[8],
      },
    };
  });
}

async function tsRepairSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const barr = game.structures.find((s: any) =>
      s.type === 'BARR' && s.house === 'BadGuy' && s.cx === 56 && s.cy === 83);
    const ftur = game.structures.find((s: any) =>
      s.type === 'FTUR' && s.house === 'USSR' && s.cx === 36 && s.cy === 88);
    if (!barr || !ftur) throw new Error('TS SCG05EA repair snapshot target missing');
    return {
      tick: game.tick,
      rngState: (window as any).__agentState().rngState,
      barr: {
        hp: barr.hp,
        maxHp: barr.maxHp,
        repairing: barr.isRepairing === true,
      },
      ftur: {
        missionTimer: ftur.missionTimer,
      },
    };
  });
}

async function stepBothOneTickAtATime(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<Awaited<ReturnType<typeof stepBoth>>> {
  let result: Awaited<ReturnType<typeof stepBoth>> | null = null;
  for (let i = 0; i < ticks; i++) {
    result = await stepBoth(handle, 1);
  }
  if (!result) throw new Error('No ticks stepped');
  return result;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG05EA AI Repair_AI timer', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('clears lightly damaged AI barracks repair state before the next RepairTimer draw', async () => {
    await withDualScenario('SCG05EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBothOneTickAtATime(handle, 1801);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      const cppBefore = await wasmRepairSnapshot(handle.wasm);
      const tsBefore = await tsRepairSnapshot(handle.ts);
      expect(cppBefore.barr).toEqual({ hp: 799, maxHp: 800, repairing: false });
      expect(tsBefore.barr).toEqual(cppBefore.barr);

      result = await stepBoth(handle, 1);

      const cppAfter = await wasmRepairSnapshot(handle.wasm);
      const tsAfter = await tsRepairSnapshot(handle.ts);
      expect(cppAfter.barr).toEqual({ hp: 799, maxHp: 800, repairing: true });
      expect(tsAfter.barr).toEqual(cppAfter.barr);
      expect(tsAfter.ftur.missionTimer).toBe(cppAfter.ftur.missionTimer);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);
});
