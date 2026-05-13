/**
 * Dual-runtime check for C++ TEVENT_NUNITS_DESTROYED house scoping.
 *
 * SCU09EA has a GoodGuy-owned win trigger:
 *   win3 = House GoodGuy, event NUNITS_DESTROYED, threshold 1.
 *
 * C++ evaluates that as GoodGuy HouseClass::UnitsLost >= 1. The player can
 * kill other Allied units before the truck is destroyed, but those casualties
 * must not trip GoodGuy's trigger or end the mission early.
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

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU09EA NUNITS_DESTROYED house scope', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not fire GoodGuy win3 from non-GoodGuy unit losses before tick 253', async () => {
    await withDualScenario('SCU09EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const tick253 = await stepBoth(handle, 253);

      expect(tick253.wasm.state.winPending).toBe(false);
      expect(tick253.ts.state.state).not.toBe('won');
      expect(tick253.ts.state.state).not.toBe('lost');
      expect(tick253.ts.state.tick).toBe(253);
      expect(tick253.ts.state.rngState >>> 0).toBe(tick253.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);
});
