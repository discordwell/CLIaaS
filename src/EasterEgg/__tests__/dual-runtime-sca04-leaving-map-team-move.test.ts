/**
 * Dual-runtime regression for off-radar team movement in SCA04EA.
 *
 * C++ keeps INTERIOR MapPack floor terrain outside the [Map] rectangle, so a
 * team whose current TMISSION_MOVE waypoint is off-radar can Basic_Path through
 * those cells and leave the map. TS must not treat that full-map terrain as the
 * default rock border.
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
  evaluate<T>(fn: (...args: never[]) => T): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function stepBothInChunks(handle: Parameters<typeof stepBoth>[0], ticks: number): Promise<void> {
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(15, remaining);
    await stepBoth(handle, chunk);
    remaining -= chunk;
  }
}

async function wasmLeavingAnt(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const ant = [
      ...(state.units ?? []),
      ...(state.enemies ?? []),
      ...(state.vessels ?? []),
    ].find((unit: any) =>
      unit.t === 'ANT3' &&
      unit.house === 'Germany' &&
      unit.nlx === 21128 &&
      unit.nly === 9352);
    if (!ant) throw new Error('C++ SCA04EA leaving ANT3 not found');
    return {
      tick: state.tick,
      mission: ant.m,
      missionQueue: ant.mq,
      isDriving: ant.drv,
      cell: { cx: ant.cx, cy: ant.cy },
      lx: ant.lx,
      ly: ant.ly,
      nav: { lx: ant.nlx, ly: ant.nly },
      headTo: { lx: ant.hlx, ly: ant.hly },
      path: [ant.p0, ant.p1, ant.p2, ant.p3].filter((face: number) => face >= 0),
    };
  });
}

async function tsLeavingAnt(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const ant = game.entities.find((entity: any) =>
      entity.alive !== false &&
      entity.type === 'ANT3' &&
      entity.house === 'Germany' &&
      entity.cell?.cx === 82 &&
      entity.cell?.cy === 38);
    if (!ant) throw new Error('TS SCA04EA leaving ANT3 not found');
    return {
      tick: state.tick,
      mission: ant.mission,
      missionQueue: ant.missionQueue,
      isDriving: ant.isDriving,
      teamRef: !!ant.teamRef,
      isLeavingMap: ant.teamRef?.isLeavingMap?.(game.map, game.waypoints) ?? false,
      cell: { cx: ant.cell.cx, cy: ant.cell.cy },
      lx: ant.leptonX,
      ly: ant.leptonY,
      nav: ant.moveTarget ? { lx: ant.moveTarget.lx, ly: ant.moveTarget.ly } : null,
      headTo: { lx: ant.headToLX, ly: ant.headToLY },
      path: ant.drivePathFacings.slice(0, 4),
      terrainToExit: {
        y37: game.map.getTerrain(82, 37),
        y36: game.map.getTerrain(82, 36),
      },
      canEnterToExit: {
        y37: game.canEnterTrackJumpCell(ant, 82, 37),
        y36: game.canEnterTrackJumpCell(ant, 82, 36),
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCA04 leaving-map team move', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps the team ant driving through off-radar INTERIOR floor cells', async () => {
    await withDualScenario('SCA04EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBothInChunks(handle, 1920);

      const cpp = await wasmLeavingAnt(handle.wasm);
      const ts = await tsLeavingAnt(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.terrainToExit).toEqual({ y37: 0, y36: 0 });
      expect(ts.canEnterToExit.y37).not.toBe(5);
      expect(ts.canEnterToExit.y36).toBe(0);
      expect(ts.teamRef).toBe(true);
      expect(ts.isLeavingMap).toBe(true);
      expect(ts.isDriving).toBe(cpp.isDriving);
      expect(ts.nav).toEqual(cpp.nav);
      expect(ts.headTo).toEqual(cpp.headTo);
      expect(ts.cell).toEqual(cpp.cell);
      expect(ts.ly).toBe(cpp.ly);
      expect(ts.path[0]).toBe(cpp.path[0]);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 180_000);
});
