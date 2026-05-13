/**
 * Dual-runtime check for DriveClass::Start_Of_Move close-enough MOVE_TEMP.
 *
 * SCG10EA sends Greek reinforcements to waypoint 28. When the rear 2TNK reaches
 * the last path cell, the waypoint cell is occupied by the just-released MCV.
 * C++ drive.cpp:1114-1124 clears the 2TNK NavCom because it is close enough,
 * but still calls CellClass::Incoming(0,true,true) for the saved MOVE_TEMP
 * result. That incoming call makes the MCV scatter east while staying in GUARD.
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
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function wasmMcvScatterState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const units = [...(state.units ?? []), ...(state.enemies ?? [])];
    const mcv = units.find((u: any) => u.t === 'MCV' && u.house === 'Greece');
    if (!mcv) throw new Error('C++ SCG10EA Greek MCV not found');

    const blocker = units.find((u: any) =>
      u.t === '2TNK' &&
      u.house === 'Greece' &&
      u.cx === 28 &&
      u.cy === 93);
    if (!blocker) throw new Error('C++ SCG10EA close-enough 2TNK not found');

    return {
      tick: state.tick,
      rngState: state.rngState,
      mcv: {
        cx: mcv.cx,
        cy: mcv.cy,
        lx: mcv.lx,
        ly: mcv.ly,
        mission: mcv.m,
        missionTimer: mcv.mt,
        isDriving: mcv.drv === true,
        nav: mcv.nlx === undefined ? null : { lx: mcv.nlx, ly: mcv.nly },
        head: mcv.hlx === undefined ? null : { lx: mcv.hlx, ly: mcv.hly },
        trackControlIndex: mcv.tn,
        trackIndex: mcv.ti,
      },
      blocker: {
        cx: blocker.cx,
        cy: blocker.cy,
        mission: blocker.m,
        nav: blocker.nlx === undefined ? null : { lx: blocker.nlx, ly: blocker.nly },
        path0: blocker.p0,
      },
    };
  }, undefined);
}

async function tsMcvScatterState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const mcv = game.entities.find((e: any) =>
      e.alive !== false &&
      e.type === 'MCV' &&
      e.house === 'Greece');
    if (!mcv) throw new Error('TS SCG10EA Greek MCV not found');

    const blocker = game.entities.find((e: any) =>
      e.alive !== false &&
      e.type === '2TNK' &&
      e.house === 'Greece' &&
      e.cell.cx === 28 &&
      e.cell.cy === 93);
    if (!blocker) throw new Error('TS SCG10EA close-enough 2TNK not found');

    return {
      tick: game.tick,
      rngState: state.rngState,
      mcv: {
        cx: mcv.cell.cx,
        cy: mcv.cell.cy,
        lx: mcv.leptonX,
        ly: mcv.leptonY,
        mission: mcv.mission,
        missionTimer: mcv.missionTimer,
        isDriving: mcv.isDriving === true,
        nav: mcv.moveTarget ? { lx: mcv.moveTarget.lx, ly: mcv.moveTarget.ly } : null,
        head: (mcv.headToLX || mcv.headToLY) ? { lx: mcv.headToLX, ly: mcv.headToLY } : null,
        trackControlIndex: mcv.trackControlIndex,
        trackIndex: mcv.trackIndex,
      },
      blocker: {
        cx: blocker.cell.cx,
        cy: blocker.cell.cy,
        mission: blocker.mission,
        nav: blocker.moveTarget ? { lx: blocker.moveTarget.lx, ly: blocker.moveTarget.ly } : null,
        path0: blocker.drivePathFacings[0] ?? -1,
      },
    };
  }, undefined);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG10 close-enough incoming scatter', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('still scatters the temporary blocker after clearing close-enough NavCom', async () => {
    await withDualScenario('SCG10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 168);
      const cpp = await wasmMcvScatterState(handle.wasm);
      const ts = await tsMcvScatterState(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.mcv).toEqual({
        cx: cpp.mcv.cx,
        cy: cpp.mcv.cy,
        lx: cpp.mcv.lx,
        ly: cpp.mcv.ly,
        mission: 'GUARD',
        missionTimer: cpp.mcv.missionTimer,
        isDriving: cpp.mcv.isDriving,
        nav: cpp.mcv.nav,
        head: cpp.mcv.head,
        trackControlIndex: cpp.mcv.trackControlIndex,
        trackIndex: cpp.mcv.trackIndex,
      });
      expect(ts.blocker).toEqual({
        cx: cpp.blocker.cx,
        cy: cpp.blocker.cy,
        mission: 'GUARD',
        nav: cpp.blocker.nav,
        path0: cpp.blocker.path0,
      });

      expect(cpp.mcv.nav).toEqual({ lx: 7816, ly: 23688 });
      expect(cpp.mcv.head).toEqual({ lx: 7808, ly: 23680 });
      expect(cpp.mcv.isDriving).toBe(true);
      expect(cpp.blocker.nav).toBeNull();
    }, { wasmSeed: 0 });
  }, 180_000);
});
