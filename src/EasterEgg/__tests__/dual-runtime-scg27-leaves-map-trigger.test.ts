/**
 * Dual-runtime check for TEVENT_LEAVES_MAP team matching.
 *
 * SCG27EA has convoy-loss triggers (`los1`/`los2`/`los3`) whose events are
 * `LEAVES_MAP` for specific TeamType indices. C++ only trips the event when a
 * matching team object is empty and marked IsLeaveMap; an unrelated unit exit
 * must not fire every LEAVES_MAP trigger.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ensureParityServer,
  isDevServerAvailable,
  stepBoth,
  stopParityServer,
  withDualScenario,
  type DualStepResult,
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

async function stepBothOneTickAtATime(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<DualStepResult> {
  let result: DualStepResult | null = null;
  for (let i = 0; i < ticks; i++) {
    result = await stepBoth(handle, 1);
  }
  if (!result) throw new Error('No step result produced');
  return result;
}

async function wasmOutcome(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    return {
      tick: state.tick,
      rngState: state.rngState,
      winPending: Boolean(state.winPending),
      losePending: Boolean(state.losePending),
    };
  });
}

async function tsOutcome(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = (window as any).__agentState();
    const game = (window as any).__agentGame;
    const losTriggers = game.triggers
      .filter((trigger: any) => ['los1', 'los2', 'los3'].includes(trigger.name))
      .map((trigger: any) => ({ name: trigger.name, fired: trigger.fired }));
    return {
      tick: state.tick,
      rngState: state.rngState,
      state: state.state,
      losePending: Boolean(state.losePending),
      unitsLeftMap: state.unitsLeftMap,
      losTriggers,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG27EA LEAVES_MAP triggers', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not fire convoy-loss triggers for an unrelated map exit', async () => {
    await withDualScenario('SCG27EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothOneTickAtATime(handle, 1085);
      const [cpp1085, ts1085] = await Promise.all([
        wasmOutcome(handle.wasm),
        tsOutcome(handle.ts),
      ]);

      expect(ts1085.tick).toBe(cpp1085.tick);
      expect(cpp1085.losePending).toBe(false);
      expect(ts1085.state).not.toBe('lost');
      expect(ts1085.losePending).toBe(false);
      expect(ts1085.unitsLeftMap).toBeGreaterThan(0);
      expect(ts1085.losTriggers).toEqual([
        { name: 'los1', fired: false },
        { name: 'los2', fired: false },
        { name: 'los3', fired: false },
      ]);

      await stepBothOneTickAtATime(handle, 2);
      const [cpp1087, ts1087] = await Promise.all([
        wasmOutcome(handle.wasm),
        tsOutcome(handle.ts),
      ]);

      expect(ts1087.tick).toBe(cpp1087.tick);
      expect(ts1087.rngState >>> 0).toBe(cpp1087.rngState >>> 0);
      expect(ts1087.state).not.toBe('lost');
    }, { wasmSeed: 0 });
  }, 300_000);
});
