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

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU12 player active scan loss gate', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not satisfy ALL_DESTROYED while locked player reinforcements are active under shroud', async () => {
    await withDualScenario('SCU12EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBoth(handle, 135);

      expect(result.wasm.state.rngState! >>> 0).toBe(result.ts.state.rngState >>> 0);
      expect(result.wasm.state.losePending).toBe(false);
      expect(result.ts.state.losePending).toBe(false);
      expect(result.ts.state.state).not.toBe('lost');
    }, { wasmSeed: 0 });
  }, 300_000);
});
