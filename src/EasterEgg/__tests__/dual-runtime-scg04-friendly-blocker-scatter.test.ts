/**
 * Dual-runtime check for UnitClass::Scatter(0,true) from a friendly movement
 * blocker.
 *
 * SCG04EA set3 reaches waypoint 12 with one 3TNK parked on the target cell.
 * When the trailing 3TNK tries to start its next movement step, C++ calls
 * CellClass::Incoming(0,true,false) on the blocker. UnitClass::Scatter then
 * chooses a nearby clear cell by Map.Nearby_Location using the C++ Frame
 * modulo. TS must use the same frame phase, not the post-incremented TS tick,
 * otherwise the blocker scatters west instead of southeast and later blocks
 * the trailing tank.
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

async function wasmSet3Blocker(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const team = (state.teams ?? []).find((t: any) => t.cls === 'set3');
    if (!team) throw new Error('C++ SCG04EA set3 team not found');

    const blocker = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((u: any) =>
        u.t === '3TNK' &&
        u.house === 'BadGuy' &&
        u.cx === 48 &&
        u.cy === 43 &&
        u.m === 5);
    if (!blocker) throw new Error('C++ SCG04EA set3 blocker 3TNK not found');

    return {
      tick: state.tick,
      rngState: state.rngState,
      tank: {
        cx: blocker.cx,
        cy: blocker.cy,
        lx: blocker.lx,
        ly: blocker.ly,
        mission: blocker.m,
        missionTimer: blocker.mt,
        isDriving: blocker.drv === true,
        nav: blocker.nlx === undefined ? null : { lx: blocker.nlx, ly: blocker.nly },
        path: [blocker.p0, blocker.p1, blocker.p2, blocker.p3].filter((p: number) => p >= 0),
      },
    };
  }, undefined);
}

async function tsSet3Blocker(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const teams = typeof (window as any).__rawTeams === 'function'
      ? (window as any).__rawTeams()
      : [];
    const team = teams.find((t: any) => t.typeName === 'set3');
    if (!team) throw new Error('TS SCG04EA set3 team not found');

    const blocker = game.entities.find((e: any) =>
      e.alive !== false &&
      e.type === '3TNK' &&
      e.house === 'BadGuy' &&
      e.cell.cx === 48 &&
      e.cell.cy === 43 &&
      e.mission === 'GUARD');
    if (!blocker) throw new Error('TS SCG04EA set3 blocker 3TNK not found');

    return {
      tick: game.tick,
      rngState: state.rngState,
      tank: {
        cx: blocker.cell.cx,
        cy: blocker.cell.cy,
        lx: blocker.leptonX,
        ly: blocker.leptonY,
        mission: blocker.mission,
        missionTimer: blocker.missionTimer,
        isDriving: blocker.isDriving === true,
        nav: blocker.moveTarget ? { lx: blocker.moveTarget.lx, ly: blocker.moveTarget.ly } : null,
        path: blocker.drivePathFacings.slice(0, 4),
      },
    };
  }, undefined);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG04 friendly blocker scatter', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('uses the C++ Frame phase for UnitClass no-threat scatter', async () => {
    await withDualScenario('SCG04EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 422);
      const cpp = await wasmSet3Blocker(handle.wasm);
      const ts = await tsSet3Blocker(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.tank).toEqual({
        cx: cpp.tank.cx,
        cy: cpp.tank.cy,
        lx: cpp.tank.lx,
        ly: cpp.tank.ly,
        mission: 'GUARD',
        missionTimer: cpp.tank.missionTimer,
        isDriving: cpp.tank.isDriving,
        nav: cpp.tank.nav,
        path: cpp.tank.path,
      });
      expect(cpp.tank.nav).toEqual({ lx: 12680, ly: 11400 });
      expect(cpp.tank.path).toEqual([3]);
    }, { wasmSeed: 0 });
  }, 180_000);
});
