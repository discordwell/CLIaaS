import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OracleStrategy } from '../oracle/OracleStrategy.js';
import { SharedTsOracleStrategy } from '../oracle/SharedOracleBridge.js';
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
  evaluate<T, A = undefined>(fn: (arg: A) => T, arg?: A): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function stepBothInCppSizedChunks(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<Awaited<ReturnType<typeof stepBoth>>> {
  let result: Awaited<ReturnType<typeof stepBoth>> | null = null;
  let remaining = ticks;
  while (remaining > 0) {
    const step = Math.min(remaining, 15);
    result = await stepBoth(handle, step);
    remaining -= step;
  }
  if (!result) throw new Error('No ticks stepped');
  return result;
}

async function tsDeferredLossState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    return {
      gameState: game.state,
      isToLose: Boolean(game.isToLose),
      borrowedTime: game.borrowedTime,
      rngState: state.rngState >>> 0,
    };
  }) as Promise<{
    gameState: string;
    isToLose: boolean;
    borrowedTime: number;
    rngState: number;
  }>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG14EA Tanya loss trigger', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('reports the pending loss when los1 fires after the Tanya team is destroyed', async () => {
    await withDualScenario('SCG14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const tsOracle = new SharedTsOracleStrategy('SCG14EA');
      const wasmOracle = new OracleStrategy('SCG14EA');
      let tsState = handle.tsState;
      let wasmState = handle.wasmState;

      for (let tick = 0; tick < 150; tick += 10) {
        const tsDecision = tsOracle.decide(tsState);
        const wasmDecision = wasmOracle.decide(wasmState);
        const result = await stepBoth(handle, 10, tsDecision.commands, wasmDecision.commands);
        tsState = result.ts.state;
        wasmState = result.wasm.state;

        if (wasmState.losePending || (tsState as { losePending?: boolean }).losePending) {
          break;
        }
      }

      expect(wasmState.losePending).toBe(true);
      expect(tsState.triggers.find((trigger) => trigger.name === 'los1')?.fired).toBe(true);
      expect((tsState as { losePending?: boolean }).losePending).toBe(true);
    });
  }, 300_000);

  it('runs the final object AI frame before resolving the deferred loss', async () => {
    await withDualScenario('SCG14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const pending = await stepBothInCppSizedChunks(handle, 153);
      const tsPending = await tsDeferredLossState(handle.ts);

      expect(pending.wasm.state.losePending).toBe(true);
      expect(tsPending.isToLose).toBe(true);
      expect(tsPending.borrowedTime).toBe(0);
      expect(tsPending.gameState).not.toBe('lost');
      expect(tsPending.rngState).toBe(pending.wasm.state.rngState! >>> 0);

      const resolved = await stepBothInCppSizedChunks(handle, 1);
      const tsResolved = await tsDeferredLossState(handle.ts);

      expect(tsResolved.gameState).toBe('lost');
      expect(tsResolved.rngState).toBe(resolved.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
