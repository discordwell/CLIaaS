/**
 * Dual-runtime check for building Mission_Attack rearm ordering.
 *
 * C++ TechnoClass::Can_Fire returns FIRE_REARM before the building-specific
 * electric charge gate. A Tesla coil can therefore go to sleep for Arm while
 * TechnoClass::AI clears TarCom afterward; Guard jitter must not run until the
 * rearm timer expires.
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

async function wasmTeslaState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const module = (window as any).Module;
    const state = JSON.parse(module.ccall('agent_get_state', 'string', [], []));
    const row = ((state.logicLayer ?? []) as any[][]).find(entry =>
      entry[1] === 'TSLA' && entry[3] === 87 && entry[4] === 35);
    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: row?.[7],
      missionTimer: row?.[8],
      arm: row?.[23],
      primaryCurrent: row?.[28],
      primaryDesired: row?.[29],
      tarKind: row?.[30],
    };
  });
}

async function tsTeslaState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const tesla = ((game?.structures ?? []) as any[]).find(structure =>
      structure.type === 'TSLA' && structure.cx === 87 && structure.cy === 35);
    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: tesla?.mission,
      missionTimer: tesla?.missionTimer,
      target: tesla?.targetEntityId ?? null,
      attackCooldown: tesla?.attackCooldown,
      ammo: tesla?.ammo,
      maxAmmo: tesla?.maxAmmo,
      primaryCurrent: tesla?.turretFacing256,
      primaryDesired: tesla?.desiredTurretFacing256,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU34 Tesla rearm TarCom clear', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps Mission_Attack asleep on Arm after TarCom is cleared during rearm', async () => {
    await withDualScenario('SCU34EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 403);
      const cpp = await wasmTeslaState(handle.wasm);
      const ts = await tsTeslaState(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.mission).toBe(1); // MISSION_ATTACK
      expect(cpp.tarKind).toBe(-1);
      expect(ts.mission).toBe('ATTACK');
      expect(ts.target).toBeNull();
      expect(ts.missionTimer).toBe(cpp.missionTimer);
      expect(ts.attackCooldown).toBe(cpp.arm);
      expect(ts.ammo).toBe(ts.maxAmmo);

      await stepBoth(handle, 1);
      const postCpp = await wasmTeslaState(handle.wasm);
      const postTs = await tsTeslaState(handle.ts);
      expect(postTs.tick).toBe(postCpp.tick);
      expect(postTs.rngState >>> 0).toBe(postCpp.rngState >>> 0);
    });
  }, 60_000);

  it('keeps non-turret Tesla PrimaryFacing desired during rearm damage', async () => {
    await withDualScenario('SCU34EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 414);
      const cpp = await wasmTeslaState(handle.wasm);
      const ts = await tsTeslaState(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.primaryDesired).not.toBe(cpp.primaryCurrent);
      expect(ts.primaryCurrent).toBe(cpp.primaryCurrent);
      expect(ts.primaryDesired).toBe(cpp.primaryDesired);

      const step = await stepBoth(handle, 1);
      expect(step.ts.state.tick).toBe(step.wasm.state.tick);
      expect(step.ts.state.rngState! >>> 0).toBe(step.wasm.state.rngState! >>> 0);
    });
  }, 60_000);
});
