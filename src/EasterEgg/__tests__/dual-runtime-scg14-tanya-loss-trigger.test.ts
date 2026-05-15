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
});
