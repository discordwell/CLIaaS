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

async function stepBothChunked(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<Awaited<ReturnType<typeof stepBoth>>> {
  let result: Awaited<ReturnType<typeof stepBoth>> | undefined;
  for (let remaining = ticks; remaining > 0;) {
    const step = Math.min(remaining, 300);
    result = await stepBoth(handle, step);
    remaining -= step;
  }
  if (!result) throw new Error('stepBothChunked requires a positive tick count');
  return result;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU09 starting cash and silo spill', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not spill initial Credits when storage capacity changes before harvesting', async () => {
    await withDualScenario('SCU09EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBothChunked(handle, 2000);

      expect(result.wasm.state.credits).toBe(8000);
      expect(result.ts.state.credits).toBe(result.wasm.state.credits);
      expect(result.ts.state.unitCount).toBe(result.wasm.state.unitCount);
      expect(result.ts.state.enemyCount).toBe(result.wasm.state.enemyCount);
      expect(result.ts.state.structureCount).toBe(result.wasm.state.structureCount);
    }, { wasmSeed: 0 });
  }, 300_000);
});
