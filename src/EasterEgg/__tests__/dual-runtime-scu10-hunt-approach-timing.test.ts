/**
 * Dual-runtime check for HUNT target acquisition and same-tick drive startup.
 *
 * SCU10EA exposes a real C++ timing path: the Greek 2TNK at (99,59) has its
 * Mission_Hunt timer fire on tick 135. C++ Target_Something_Nearby assigns
 * TarCom, FootClass::Approach_Target assigns NavCom, and the later
 * DriveClass::AI pass starts movement in that same object AI tick. If TS waits
 * until a later tick to acquire the target or start the driver, the tank is
 * several cells late by tick 199 and misses the firing RNG call there.
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

async function wasmHuntTank(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const tank = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((u: any) => u.id === 1835009);
    if (!tank) throw new Error('C++ SCU10EA Greek 2TNK 1835009 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      tank: {
        cx: tank.cx,
        cy: tank.cy,
        lx: tank.lx,
        ly: tank.ly,
        mission: tank.m,
        missionTimer: tank.mt,
        isDriving: tank.drv === true,
        target: tank.tlx === undefined ? null : { lx: tank.tlx, ly: tank.tly },
        nav: tank.nlx === undefined ? null : { lx: tank.nlx, ly: tank.nly },
        trackIndex: tank.ti,
        speedAccum: tank.sa,
      },
    };
  });
}

async function tsHuntTank(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const tank = game.entities.find((e: any) =>
      e.type === '2TNK' &&
      e.house === 'Greece' &&
      e.cell.cx >= 99 &&
      e.cell.cx <= 100 &&
      e.cell.cy === 59);
    if (!tank) throw new Error('TS SCU10EA Greek 2TNK at (99,59) missing');

    return {
      tick: game.tick,
      rngState: state.rngState,
      tank: {
        id: tank.id,
        cx: tank.cell.cx,
        cy: tank.cell.cy,
        lx: tank.leptonX,
        ly: tank.leptonY,
        mission: tank.mission,
        missionTimer: tank.missionTimer,
        isDriving: tank.isDriving === true,
        target: tank.target ? {
          lx: tank.target.leptonX,
          ly: tank.target.leptonY,
          type: tank.target.type,
          house: tank.target.house,
          cx: tank.target.cell.cx,
          cy: tank.target.cell.cy,
        } : null,
        nav: tank.moveTarget ? { lx: tank.moveTarget.lx, ly: tank.moveTarget.ly } : null,
        trackIndex: tank.trackIndex,
        speedAccum: tank.speedAccum,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU10 HUNT approach timing', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('acquires TarCom, assigns NavCom, and starts DriveClass movement on the timer tick', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 135);
      const cpp = await wasmHuntTank(handle.wasm);
      const ts = await tsHuntTank(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.tank).toMatchObject({
        cx: cpp.tank.cx,
        cy: cpp.tank.cy,
        lx: cpp.tank.lx,
        ly: cpp.tank.ly,
        mission: 'HUNT',
        missionTimer: cpp.tank.missionTimer,
        isDriving: cpp.tank.isDriving,
        target: cpp.tank.target,
        nav: cpp.tank.nav,
        trackIndex: cpp.tank.trackIndex,
        speedAccum: cpp.tank.speedAccum,
      });
    }, { wasmSeed: 0 });
  }, 300_000);
});
