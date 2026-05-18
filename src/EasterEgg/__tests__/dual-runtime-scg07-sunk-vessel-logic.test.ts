/**
 * Dual-runtime check for sunk VesselClass objects that remain in C++ Logic.
 *
 * SCG07EA tick 310 reduces a USSR SS to Strength=0. C++ keeps that object in
 * Logic/Cell_Occupier long enough for its Arm timer and low-health Cloaking_AI
 * to keep ticking; the RNG stream splits at tick 333 if TS removes it from the
 * Logic pass immediately.
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

async function wasmSunkSubState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((entry: any[]) => entry[6] === 1966084);
    if (!row) throw new Error('C++ SCG07EA sunk SS Logic row missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      sub: {
        logicIndex: row[0],
        mission: row[7],
        missionTimer: row[8],
        lx: row[12],
        ly: row[13],
        hp: row[14],
        arm: row[23],
      },
    };
  });
}

async function tsSunkSubState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const sub = game.entities.find((entity: any) => entity.id === 114);
    if (!sub) throw new Error('TS SCG07EA sunk SS missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      sub: {
        alive: sub.alive,
        logicIndex: sub.logicIndexHint,
        missionTimer: sub.missionTimer,
        lx: sub.leptonX,
        ly: sub.leptonY,
        hp: sub.hp,
        arm: sub.attackCooldown,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG07 sunk vessel Logic', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps a sunk SS in Logic until its cloak RNG matches C++', async () => {
    await withDualScenario('SCG07EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 333);
      const cpp = await wasmSunkSubState(handle.wasm);
      const ts = await tsSunkSubState(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);

      expect(cpp.sub.hp).toBe(0);
      expect(ts.sub.alive).toBe(false);
      expect(ts.sub.hp).toBe(cpp.sub.hp);
      expect(ts.sub.logicIndex).toBe(cpp.sub.logicIndex);
      expect(ts.sub.missionTimer).toBe(cpp.sub.missionTimer);
      expect(ts.sub.arm).toBe(cpp.sub.arm);
      expect(ts.sub.lx).toBe(cpp.sub.lx);
      expect(ts.sub.ly).toBe(cpp.sub.ly);
    }, { wasmSeed: 0 });
  }, 300_000);
});
