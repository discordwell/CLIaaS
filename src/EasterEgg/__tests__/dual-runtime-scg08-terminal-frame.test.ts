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
    const step = Math.min(remaining, 900);
    result = await stepBoth(handle, step);
    remaining -= step;
  }
  if (!result) throw new Error('stepBothChunked requires a positive tick count');
  return result;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG08 terminal frame', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps the exported frame and mission timer frozen when loss returns before Frame++', async () => {
    await withDualScenario('SCG08EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBothChunked(handle, 1883);
      expect(result.ts.state.tick).toBe(result.wasm.state.tick);
      expect(result.ts.state.missionTimer).toBe(result.wasm.state.missionTimer);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      result = await stepBoth(handle, 1);
      expect(result.ts.state.state).toBe('lost');
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
      expect(result.ts.state.tick).toBe(result.wasm.state.tick);
      expect(result.ts.state.missionTimer).toBe(result.wasm.state.missionTimer);
    }, { wasmSeed: 0 });
  }, 300_000);
});
