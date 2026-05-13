/**
 * Dual-runtime check for C++ bib-smudge movement semantics.
 *
 * SCU05EA starts a Greece HARV on the refinery bib at (65,45). C++ bibs are
 * SmudgeClass objects: they block later building placement, but
 * CellClass::Is_Clear_To_Move ignores them. The harvester can therefore scan
 * its normal movement zone, pick the ore at (36,44), and take the
 * Mission_Harvest fallthrough delay.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AgentState, AgentUnit } from '../engine/agentHarness.js';
import type { RAEntity, RAGameState } from '../oracle/WasmAdapter.js';
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

function allTsUnits(state: AgentState): AgentUnit[] {
  return [...state.units, ...state.enemies];
}

function allWasmUnits(state: RAGameState): RAEntity[] {
  return [...state.units, ...state.enemies];
}

function wasmGreeceHarvester(state: RAGameState): RAEntity {
  const harvester = allWasmUnits(state).find(u => u.t === 'HARV' && u.house === 'Greece');
  expect(harvester, 'C++ Greece HARV').toBeDefined();
  return harvester!;
}

function tsGreeceHarvester(state: AgentState): AgentUnit {
  const harvester = allTsUnits(state).find(u => u.t === 'HARV' && u.h === 'Greece');
  expect(harvester, 'TS Greece HARV').toBeDefined();
  return harvester!;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU05EA harvester on refinery bib', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('treats the refinery bib as a build-blocking smudge, not a movement blocker', async () => {
    await withDualScenario('SCU05EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await adapterPage(handle.ts).evaluate(() => {
        (window as any).__rngTagControl?.('enable');
        (window as any).__rngTagControl?.('reset');
      });

      const result = await stepBoth(handle, 1);
      const tsRng = await adapterPage(handle.ts).evaluate(() => (window as any).__rngTagControl?.('read'));

      const cppHarvester = wasmGreeceHarvester(result.wasm.state);
      const tsHarvester = tsGreeceHarvester(result.ts.state);

      expect(cppHarvester.cx).toBe(65);
      expect(cppHarvester.cy).toBe(45);
      expect(tsHarvester.cx).toBe(65);
      expect(tsHarvester.cy).toBe(45);

      expect(Math.floor((cppHarvester.nlx ?? 0) / 256)).toBe(36);
      expect(Math.floor((cppHarvester.nly ?? 0) / 256)).toBe(44);
      expect(tsHarvester).toMatchObject({
        m: 'HARVEST',
        mtx: 36,
        mty: 44,
        mt: cppHarvester.mt,
      });

      const cppHarvSeeds = (result.wasm.state.rngLog ?? [])
        .filter(entry => entry[2] === 11051)
        .map(entry => entry[0] >>> 0);
      const tsHarvSeeds = ((tsRng?.seedLog ?? []) as Array<[number, number, number]>)
        .filter(entry => entry[2] === 11051)
        .map(entry => entry[0] >>> 0);

      expect(cppHarvSeeds.length, 'C++ HARV should consume Mission_Harvest fallback jitter').toBeGreaterThan(0);
      expect(tsHarvSeeds).toEqual(cppHarvSeeds);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);
});
