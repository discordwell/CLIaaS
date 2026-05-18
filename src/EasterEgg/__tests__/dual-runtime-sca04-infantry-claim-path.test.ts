/**
 * Dual-runtime check for vehicle Basic_Path through infantry occupy flags.
 *
 * SCA04EA tick 70 has a Germany ANT3 trying to route around a barrel at
 * (112,64). C++ Find_Path accepts the enemy infantry reservation at (112,65) at
 * MOVE_DESTROYABLE threshold, then DriveClass::Start_Of_Move clears Path[0]
 * because that cell has no physical Cell_Object() to attack. TS must not treat
 * that reservation as a friendly/temp blocker and route north instead.
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

async function wasmAnt3(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const ant = [
      ...(state.units ?? []),
      ...(state.enemies ?? []),
      ...(state.vessels ?? []),
    ].find((u: any) => u.t === 'ANT3' && u.house === 'Germany' && u.cx === 111 && u.cy === 65);
    if (!ant) throw new Error('C++ SCA04EA Germany ANT3 path probe not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: ant.m,
      missionTimer: ant.mt,
      path: [ant.p0, ant.p1, ant.p2, ant.p3, ant.p4],
      pathThreshold: ant.pth,
      primaryFacing: ant.pf,
      desiredFacing: ant.pfd,
      isDriving: ant.drv,
      navCell: { cx: ant.ncx, cy: ant.ncy },
    };
  });
}

async function tsAnt3(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const ant = game.entities.find((entity: any) =>
      entity.alive !== false &&
      entity.type === 'ANT3' &&
      entity.house === 'Germany' &&
      entity.cell?.cx === 111 &&
      entity.cell?.cy === 65);
    if (!ant) throw new Error('TS SCA04EA Germany ANT3 path probe not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: ant.mission,
      missionTimer: ant.missionTimer,
      path: ant.path.slice(0, 5).map((cell: any) => ({ cx: cell.cx, cy: cell.cy })),
      pathFacings: ant.drivePathFacings.slice(0, 5),
      pathThreshold: ant.pathThreshold,
      primaryFacing: ant.bodyFacing256,
      desiredFacing: ant.desiredFacing256,
      isDriving: ant.isDriving,
      moveTarget: ant.moveTarget
        ? { cx: Math.floor(ant.moveTarget.lx / 256), cy: Math.floor(ant.moveTarget.ly / 256) }
        : null,
      target: ant.target
        ? { type: ant.target.type, cx: ant.target.cell.cx, cy: ant.target.cell.cy }
        : null,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCA04 infantry reservation pathing', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('clears the east-first path instead of routing north through an infantry claim', async () => {
    await withDualScenario('SCA04EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBoth(handle, 70);
      expect(result.ts.state.tick).toBe(result.wasm.state.tick);

      const cpp = await wasmAnt3(handle.wasm);
      const ts = await tsAnt3(handle.ts);

      expect(cpp.tick).toBe(70);
      expect(cpp.path).toEqual([-1, 1, 2, 1, -1]);
      expect(cpp.pathThreshold).toBe(3);
      expect(cpp.primaryFacing).toBe(64);
      expect(cpp.desiredFacing).toBe(64);
      expect(cpp.isDriving).toBe(false);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.mission).toBe('HUNT');
      expect(ts.path).toEqual([]);
      expect(ts.pathThreshold).toBe(cpp.pathThreshold);
      expect(ts.primaryFacing).toBe(cpp.primaryFacing);
      expect(ts.desiredFacing).toBe(cpp.desiredFacing);
      expect(ts.isDriving).toBe(false);
      expect(ts.moveTarget).toEqual(cpp.navCell);

      result = await stepBoth(handle, 10);
      expect(result.ts.state.tick).toBe(80);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 180_000);
});
