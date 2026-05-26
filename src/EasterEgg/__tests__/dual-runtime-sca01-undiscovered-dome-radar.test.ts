/**
 * Dual-runtime regression for radar availability.
 *
 * C++ HouseClass::AI gates radar activation on ActiveBScan, not on every alive
 * player-owned DOME in the scenario. SCA01 starts with an owned DOME that is
 * still undiscovered/inactive, so the sidebar radar must remain closed.
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

async function wasmRadarState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const module = (window as any).Module;
    return JSON.parse(module.ccall('agent_get_radar_info', 'string', [], []));
  });
}

async function tsRadarState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    return {
      tick: game.tick,
      radar: { ...game.radarVisual },
      renderer: {
        hasRadar: game.renderer.hasRadar,
        doesRadarExist: game.renderer.doesRadarExist,
        radarCoverFrame: game.renderer.radarCoverFrame,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCA01 undiscovered DOME does not activate radar', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps radar inactive when a player DOME is absent from ActiveBScan', async () => {
    await withDualScenario('SCA01EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 100);

      const [cpp, ts] = await Promise.all([
        wasmRadarState(handle.wasm),
        tsRadarState(handle.ts),
      ]);

      expect(cpp.isActive).toBe(false);
      expect(cpp.doesExist).toBe(false);
      expect(ts.radar.isRadarActive).toBe(false);
      expect(ts.radar.doesRadarExist).toBe(false);
      expect(ts.renderer.hasRadar).toBe(false);
      expect(ts.renderer.doesRadarExist).toBe(false);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);
});
