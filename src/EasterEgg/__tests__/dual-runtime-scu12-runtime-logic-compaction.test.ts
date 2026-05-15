/**
 * Dual-runtime check for C++ Logic DynamicVector compaction.
 *
 * SCU12EA fires several one-shot aircraft/reinforcement teams before the USSR
 * assault group reaches the player base. In C++, dead aircraft and destroyed
 * vehicles are deleted from Logic, shifting later runtime reinforcements down.
 * TS must not keep stale insertion indices for those later objects, or their
 * guard timers/RNG dispatch happen at the wrong point in the Logic pass.
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

async function wasmRuntimeAssaultState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const logicRows = (state.logicLayer ?? []).filter((row: any[]) =>
      row[2] === 'USSR' &&
      (
        (row[1] === '3TNK' && row[3] === 38 && row[4] === 41) ||
        (row[1] === 'E2' && row[3] === 36 && row[4] === 40)
      ));

    return {
      tick: state.tick,
      rngState: state.rngState,
      runtimeRows: logicRows.map((row: any[]) => ({
        logicIndex: row[0],
        type: row[1],
        cx: row[3],
        cy: row[4],
        mission: row[7],
        missionTimer: row[8],
      })),
    };
  });
}

async function tsRuntimeAssaultState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const entities = game.entities.filter((entity: any) =>
      entity.house === 'USSR' &&
      entity.alive &&
      !entity.inLimbo &&
      (
        (entity.type === '3TNK' && entity.cell?.cx === 38 && entity.cell?.cy === 41) ||
        (entity.type === 'E2' && entity.cell?.cx === 36 && entity.cell?.cy === 40)
      ));

    return {
      tick: state.tick,
      rngState: state.rngState,
      runtimeRows: entities.map((entity: any) => ({
        logicIndex: entity.logicIndexHint,
        type: entity.type,
        cx: entity.cell?.cx,
        cy: entity.cell?.cy,
        mission: entity.mission === 'GUARD' ? 5 : entity.mission,
        missionTimer: entity.missionTimer,
      })).sort((a: any, b: any) => a.logicIndex - b.logicIndex),
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU12 runtime Logic compaction', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('compacts deleted runtime aircraft before later USSR assault guards run', async () => {
    await withDualScenario('SCU12EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 510);
      const [cpp, ts] = await Promise.all([
        wasmRuntimeAssaultState(handle.wasm),
        tsRuntimeAssaultState(handle.ts),
      ]);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);

      const cppTank = cpp.runtimeRows.find(row => row.type === '3TNK');
      const tsTank = ts.runtimeRows.find(row => row.type === '3TNK');
      expect(tsTank).toMatchObject(cppTank!);

      const cppE2Indices = cpp.runtimeRows
        .filter(row => row.type === 'E2')
        .map(row => row.logicIndex);
      const tsE2Indices = ts.runtimeRows
        .filter(row => row.type === 'E2')
        .map(row => row.logicIndex);
      expect(tsE2Indices).toEqual(cppE2Indices);
    }, { wasmSeed: 0 });
  }, 300_000);
});
