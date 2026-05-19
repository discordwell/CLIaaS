/**
 * Dual-runtime check for airfield repair handoff with a full-ammo aircraft.
 *
 * BuildingClass::Mission_Repair for airstrips/helipads returns to GUARD when
 * the docked aircraft reports RADIO_PREPARED. A fully armed fixed-wing aircraft
 * must not leave the pad in REPAIR and must not run Guard jitter on that same
 * frame.
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

async function stepBothInChunks(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<void> {
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 900);
    await stepBoth(handle, chunk);
    remaining -= chunk;
  }
}

async function wasmAirfieldState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const module = (window as any).Module;
    const state = JSON.parse(module.ccall('agent_get_state', 'string', [], []));
    const row = ((state.logicLayer ?? []) as any[][]).find(entry =>
      entry[1] === 'AFLD' && entry[3] === 29 && entry[4] === 98);
    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: row?.[7],
      missionTimer: row?.[8],
    };
  });
}

async function tsAirfieldState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const pad = ((game?.structures ?? []) as any[]).find(structure =>
      structure.type === 'AFLD' && structure.cx === 29 && structure.cy === 98);
    const mig = ((game?.entities ?? []) as any[]).find(entity => entity.type === 'MIG');
    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: pad?.mission,
      missionTimer: pad?.missionTimer,
      missionQueue: pad?.missionQueue ?? null,
      ready: pad?.isReadyToCommence ?? false,
      migAmmo: mig?.ammo,
      migMaxAmmo: mig?.maxAmmo,
      migState: mig?.aircraftState,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU34 full-ammo airfield repair handoff', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('returns a full-ammo landed MiG pad to GUARD without same-frame guard jitter', async () => {
    await withDualScenario('SCU34EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 253);
      const cpp = await wasmAirfieldState(handle.wasm);
      const ts = await tsAirfieldState(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.migAmmo).toBe(ts.migMaxAmmo);
      expect(ts.migState).toBe('landed');
      expect(cpp.mission).toBe(5); // MISSION_GUARD
      expect(ts.mission).toBe('GUARD');
      expect(ts.missionTimer).toBe(cpp.missionTimer);
      expect(ts.missionQueue).toBeNull();
      expect(ts.ready).toBe(false);
    });
  }, 60_000);
});
