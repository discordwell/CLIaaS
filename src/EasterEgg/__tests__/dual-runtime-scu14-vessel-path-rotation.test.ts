/**
 * Dual-runtime check for DriveClass residual Path[] rotation.
 *
 * SCU14EA has a USSR LST whose C++ absolute position is already on the last TS
 * cached path cell while C++ still has residual Path[] facings. DriveClass::AI
 * rotates toward Path[0] before it can run the out-of-zone NavCom abort. TS
 * must preserve that behavior instead of clearing NavCom and entering GUARD.
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

async function wasmLST(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const lst = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((u: any) => u.id === 1966080);
    if (!lst) throw new Error('C++ SCU14EA USSR LST 1966080 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: lst.m,
      missionQueue: lst.mq,
      missionTimer: lst.mt,
      nav: typeof lst.nlx === 'number' ? { lx: lst.nlx, ly: lst.nly } : null,
      path0: lst.p0,
      isDriving: lst.drv,
      lepton: { lx: lst.lx, ly: lst.ly },
      primaryFacing256: lst.pf,
      desiredFacing256: lst.pfd,
    };
  });
}

async function tsLST(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const lst = game.entities.find((e: any) =>
      e.alive !== false &&
      e.type === 'LST' &&
      e.house === 'USSR' &&
      e.cell.cx === 77 &&
      e.cell.cy === 104);
    if (!lst) throw new Error('TS SCU14EA USSR LST missing');

    return {
      tick: game.tick,
      rngState: state.rngState,
      mission: lst.mission,
      missionQueue: lst.missionQueue,
      missionTimer: lst.missionTimer,
      nav: lst.moveTarget ? { lx: lst.moveTarget.lx, ly: lst.moveTarget.ly } : null,
      path0: lst.drivePathFacings[0] ?? null,
      isDriving: lst.isDriving,
      lepton: { lx: lst.leptonX, ly: lst.leptonY },
      primaryFacing256: lst.bodyFacing256,
      desiredFacing256: lst.desiredFacing256,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU14 vessel residual path rotation', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('rotates on residual Path[0] instead of clearing an out-of-zone LST NavCom early', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 402);
      const cpp = await wasmLST(handle.wasm);
      const ts = await tsLST(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.mission).toBe(2);
      expect(ts.mission).toBe('MOVE');
      expect(ts.missionQueue).toBeNull();
      expect(ts.missionTimer).toBe(cpp.missionTimer);
      expect(ts.nav).toEqual(cpp.nav);
      expect(ts.path0).toBe(cpp.path0);
      expect(ts.primaryFacing256).toBe(cpp.primaryFacing256);
      expect(ts.desiredFacing256).toBe(cpp.desiredFacing256);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('preserves PathDelay when a team reassigns the repaired LST path', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 407);
      const blockedCpp = await wasmLST(handle.wasm);
      const blockedTs = await tsLST(handle.ts);

      expect(blockedTs.tick).toBe(blockedCpp.tick);
      expect(blockedTs.rngState >>> 0).toBe(blockedCpp.rngState >>> 0);
      expect(blockedCpp.mission).toBe(5);
      expect(blockedCpp.missionQueue).toBe(-1);
      expect(blockedTs.mission).toBe('GUARD');
      expect(blockedTs.missionQueue).toBeNull();
      expect(blockedTs.missionTimer).toBe(blockedCpp.missionTimer);
      expect(blockedTs.nav).toBeNull();
      expect(blockedTs.path0).toBeNull();
      expect(blockedTs.isDriving).toBe(false);

      await stepBoth(handle, 1);
      const startedCpp = await wasmLST(handle.wasm);
      const startedTs = await tsLST(handle.ts);

      expect(startedTs.tick).toBe(startedCpp.tick);
      expect(startedTs.rngState >>> 0).toBe(startedCpp.rngState >>> 0);
      expect(startedCpp.mission).toBe(5);
      expect(startedCpp.missionQueue).toBe(2);
      expect(startedTs.mission).toBe('GUARD');
      expect(startedTs.missionQueue).toBe('MOVE');
      expect(startedTs.missionTimer).toBe(startedCpp.missionTimer);
      expect(startedTs.nav).toEqual(startedCpp.nav);
      expect(startedTs.path0).toBe(startedCpp.path0);
      expect(startedTs.isDriving).toBe(startedCpp.isDriving);
      expect(startedTs.lepton).toEqual(startedCpp.lepton);
      expect(startedTs.primaryFacing256).toBe(startedCpp.primaryFacing256);
      expect(startedTs.desiredFacing256).toBe(startedCpp.desiredFacing256);
    }, { wasmSeed: 0 });
  }, 300_000);
});
