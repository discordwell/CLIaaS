/**
 * Dual-runtime check for Basic_Path's Nearby_Location zone filter.
 *
 * SCU10EA's Turkey TRUK convoy exposes a blocked NavCom retry: the middle
 * truck's destination cell is occupied, so C++ asks Map.Nearby_Location with
 * the truck's current movement zone. When no clear same-zone nearby cell is
 * found, C++ keeps the original NavCom and paths up to the blocker. TS used to
 * ignore that zone filter, chose a nearby off-zone cell, and then reserved the
 * wrong convoy cell a few ticks later.
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

async function wasmMiddleTurkeyTruck(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const truck = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((u: any) => u.id === 1835023);
    if (!truck) throw new Error('C++ SCU10EA middle Turkey TRUK not found');
    return {
      tick: state.tick,
      cx: truck.cx,
      cy: truck.cy,
      lx: truck.lx,
      ly: truck.ly,
      mission: truck.m,
      missionTimer: truck.mt,
      isDriving: truck.drv === true,
      headToLX: truck.hlx ?? 0,
      headToLY: truck.hly ?? 0,
    };
  }, undefined);
}

async function tsMiddleTurkeyTruck(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const truck = game.entities.find((e: any) => e.id === 95);
    if (!truck) throw new Error('TS SCU10EA middle Turkey TRUK not found');
    return {
      tick: game.tick,
      cx: truck.cell.cx,
      cy: truck.cell.cy,
      lx: truck.leptonX,
      ly: truck.leptonY,
      mission: truck.mission,
      missionTimer: truck.missionTimer,
      isDriving: truck.isDriving === true,
      headToLX: truck.headToLX,
      headToLY: truck.headToLY,
    };
  }, undefined);
}

async function wasmTailTurkeyTruckPath(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const truck = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((u: any) => u.id === 1835023);
    if (!truck) throw new Error('C++ SCU10EA tail Turkey TRUK not found');
    const rawPath = [
      truck.p0, truck.p1, truck.p2, truck.p3,
      truck.p4, truck.p5, truck.p6, truck.p7,
      truck.p8, truck.p9, truck.p10, truck.p11,
    ];
    const path: number[] = [];
    for (const facing of rawPath) {
      if (facing < 0) break;
      path.push(facing);
    }
    return {
      tick: state.tick,
      rngState: state.rngState,
      truck: {
        cx: truck.cx,
        cy: truck.cy,
        lx: truck.lx,
        ly: truck.ly,
        mission: truck.m,
        missionTimer: truck.mt,
        isDriving: truck.drv === true,
        path,
        desiredFacing: truck.pfd,
      },
    };
  }, undefined);
}

async function tsTailTurkeyTruckPath(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const truck = game.entities.find((e: any) => e.id === 94);
    if (!truck) throw new Error('TS SCU10EA tail Turkey TRUK not found');
    return {
      tick: game.tick,
      rngState: state.rngState,
      truck: {
        cx: truck.cell.cx,
        cy: truck.cell.cy,
        lx: truck.leptonX,
        ly: truck.leptonY,
        mission: truck.mission,
        missionTimer: truck.missionTimer,
        isDriving: truck.isDriving === true,
        path: truck.drivePathFacings.slice(0, 12),
        desiredFacing: truck.desiredFacing256,
      },
    };
  }, undefined);
}

async function wasmLeadTurkeyTruckArrival(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const truck = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((u: any) => u.id === 1835020);
    if (!truck) throw new Error('C++ SCU10EA lead Turkey TRUK not found');
    const rawPath = [
      truck.p0, truck.p1, truck.p2, truck.p3,
      truck.p4, truck.p5, truck.p6, truck.p7,
      truck.p8, truck.p9, truck.p10, truck.p11,
    ];
    const path: number[] = [];
    for (const facing of rawPath) {
      if (facing < 0) break;
      path.push(facing);
    }
    return {
      tick: state.tick,
      rngState: state.rngState,
      truck: {
        cx: truck.cx,
        cy: truck.cy,
        lx: truck.lx,
        ly: truck.ly,
        mission: truck.m,
        missionTimer: truck.mt,
        missionQueue: truck.mq,
        isDriving: truck.drv === true,
        nav: truck.nlx === undefined ? null : { lx: truck.nlx, ly: truck.nly },
        headToLX: truck.hlx ?? null,
        headToLY: truck.hly ?? null,
        path,
      },
    };
  }, undefined);
}

async function tsLeadTurkeyTruckArrival(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const truck = game.entities.find((e: any) => e.id === 96);
    if (!truck) throw new Error('TS SCU10EA lead Turkey TRUK not found');
    return {
      tick: game.tick,
      rngState: state.rngState,
      truck: {
        cx: truck.cell.cx,
        cy: truck.cell.cy,
        lx: truck.leptonX,
        ly: truck.leptonY,
        mission: truck.mission,
        missionTimer: truck.missionTimer,
        missionQueue: truck.missionQueue,
        isDriving: truck.isDriving === true,
        nav: truck.moveTarget ? { lx: truck.moveTarget.lx, ly: truck.moveTarget.ly } : null,
        headToLX: truck.headToLX || null,
        headToLY: truck.headToLY || null,
        path: truck.drivePathFacings.slice(0, 12),
      },
    };
  }, undefined);
}

async function wasmMiddleTruckBlockedByTailReservation(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const truck = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((u: any) => u.id === 1835021);
    if (!truck) throw new Error('C++ SCU10EA middle Turkey TRUK 1835021 not found');
    const rawPath = [
      truck.p0, truck.p1, truck.p2, truck.p3,
      truck.p4, truck.p5, truck.p6, truck.p7,
      truck.p8, truck.p9, truck.p10, truck.p11,
    ];
    const path: number[] = [];
    for (const facing of rawPath) {
      if (facing < 0) break;
      path.push(facing);
    }
    return {
      tick: state.tick,
      rngState: state.rngState,
      truck: {
        cx: truck.cx,
        cy: truck.cy,
        lx: truck.lx,
        ly: truck.ly,
        mission: truck.m,
        missionTimer: truck.mt,
        isDriving: truck.drv === true,
        nav: truck.nlx === undefined ? null : { lx: truck.nlx, ly: truck.nly },
        headToLX: truck.hlx ?? null,
        headToLY: truck.hly ?? null,
        path,
      },
    };
  }, undefined);
}

async function tsMiddleTruckBlockedByTailReservation(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const truck = game.entities.find((e: any) => e.id === 95);
    if (!truck) throw new Error('TS SCU10EA middle Turkey TRUK 95 not found');
    return {
      tick: game.tick,
      rngState: state.rngState,
      truck: {
        cx: truck.cell.cx,
        cy: truck.cell.cy,
        lx: truck.leptonX,
        ly: truck.leptonY,
        mission: truck.mission,
        missionTimer: truck.missionTimer,
        isDriving: truck.isDriving === true,
        nav: truck.moveTarget ? { lx: truck.moveTarget.lx, ly: truck.moveTarget.ly } : null,
        headToLX: truck.headToLX || null,
        headToLY: truck.headToLY || null,
        path: truck.drivePathFacings.slice(0, 12),
      },
    };
  }, undefined);
}

async function wasmFourthBadGuyTankRepath(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const tank = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((u: any) => u.id === 1835016);
    if (!tank) throw new Error('C++ SCU10EA BadGuy 3TNK 1835016 not found');
    const rawPath = [
      tank.p0, tank.p1, tank.p2, tank.p3,
      tank.p4, tank.p5, tank.p6, tank.p7,
      tank.p8, tank.p9, tank.p10, tank.p11,
    ];
    const path: number[] = [];
    for (const facing of rawPath) {
      if (facing < 0) break;
      path.push(facing);
    }
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
        nav: tank.nlx === undefined ? null : { lx: tank.nlx, ly: tank.nly },
        path,
      },
    };
  }, undefined);
}

async function tsFourthBadGuyTankRepath(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const tank = game.entities.find((e: any) => e.id === 90);
    if (!tank) throw new Error('TS SCU10EA BadGuy 3TNK 90 not found');
    return {
      tick: game.tick,
      rngState: state.rngState,
      tank: {
        cx: tank.cell.cx,
        cy: tank.cell.cy,
        lx: tank.leptonX,
        ly: tank.leptonY,
        mission: tank.mission,
        missionTimer: tank.missionTimer,
        isDriving: tank.isDriving === true,
        nav: tank.moveTarget ? { lx: tank.moveTarget.lx, ly: tank.moveTarget.ly } : null,
        path: tank.drivePathFacings.slice(0, 12),
      },
    };
  }, undefined);
}

async function wasmRearBadGuyTankTeamMove(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const tank = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((u: any) => u.id === 1835019);
    if (!tank) throw new Error('C++ SCU10EA BadGuy 3TNK 1835019 not found');
    const rawPath = [
      tank.p0, tank.p1, tank.p2, tank.p3,
      tank.p4, tank.p5, tank.p6, tank.p7,
      tank.p8, tank.p9, tank.p10, tank.p11,
    ];
    const path: number[] = [];
    for (const facing of rawPath) {
      if (facing < 0) break;
      path.push(facing);
    }
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
        nav: tank.nlx === undefined ? null : { lx: tank.nlx, ly: tank.nly },
        path,
      },
    };
  }, undefined);
}

async function tsRearBadGuyTankTeamMove(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const tank = game.entities.find((e: any) => e.id === 93);
    if (!tank) throw new Error('TS SCU10EA BadGuy 3TNK 93 not found');
    return {
      tick: game.tick,
      rngState: state.rngState,
      tank: {
        cx: tank.cell.cx,
        cy: tank.cell.cy,
        lx: tank.leptonX,
        ly: tank.leptonY,
        mission: tank.mission,
        missionTimer: tank.missionTimer,
        isDriving: tank.isDriving === true,
        nav: tank.moveTarget ? { lx: tank.moveTarget.lx, ly: tank.moveTarget.ly } : null,
        path: tank.drivePathFacings.slice(0, 12),
      },
    };
  }, undefined);
}

async function wasmBlockedBadGuyTankScatter(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const tank = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((u: any) => u.id === 1835017);
    if (!tank) throw new Error('C++ SCU10EA BadGuy 3TNK 1835017 not found');
    const rawPath = [
      tank.p0, tank.p1, tank.p2, tank.p3,
      tank.p4, tank.p5, tank.p6, tank.p7,
      tank.p8, tank.p9, tank.p10, tank.p11,
    ];
    const path: number[] = [];
    for (const facing of rawPath) {
      if (facing < 0) break;
      path.push(facing);
    }
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
        nav: tank.nlx === undefined ? null : { lx: tank.nlx, ly: tank.nly },
        path,
        desiredFacing: tank.pfd,
      },
    };
  }, undefined);
}

async function tsBlockedBadGuyTankScatter(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const tank = game.entities.find((e: any) => e.id === 91);
    if (!tank) throw new Error('TS SCU10EA BadGuy 3TNK 91 not found');
    return {
      tick: game.tick,
      rngState: state.rngState,
      tank: {
        cx: tank.cell.cx,
        cy: tank.cell.cy,
        lx: tank.leptonX,
        ly: tank.leptonY,
        mission: tank.mission,
        missionTimer: tank.missionTimer,
        isDriving: tank.isDriving === true,
        nav: tank.moveTarget ? { lx: tank.moveTarget.lx, ly: tank.moveTarget.ly } : null,
        path: tank.drivePathFacings.slice(0, 12),
        desiredFacing: tank.desiredFacing256,
      },
    };
  }, undefined);
}

async function wasmConvoyTankBasicPath(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const tank = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((u: any) => u.id === 1835017);
    if (!tank) throw new Error('C++ SCU10EA BadGuy 3TNK 1835017 not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      tank: {
        cx: tank.cx,
        cy: tank.cy,
        lx: tank.lx,
        ly: tank.ly,
        nav: tank.nlx === undefined ? null : { lx: tank.nlx, ly: tank.nly },
        path: [
          tank.p0, tank.p1, tank.p2, tank.p3,
          tank.p4, tank.p5, tank.p6, tank.p7,
          tank.p8, tank.p9, tank.p10, tank.p11,
        ].filter((p: number) => p >= 0),
        desiredFacing: tank.pfd,
      },
    };
  }, undefined);
}

async function tsConvoyTankBasicPath(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const tank = game.entities.find((e: any) => e.id === 90);
    if (!tank) throw new Error('TS SCU10EA BadGuy 3TNK 90 not found');
    return {
      tick: game.tick,
      rngState: state.rngState,
      tank: {
        cx: tank.cell.cx,
        cy: tank.cell.cy,
        lx: tank.leptonX,
        ly: tank.leptonY,
        nav: tank.moveTarget ? { lx: tank.moveTarget.lx, ly: tank.moveTarget.ly } : null,
        path: tank.drivePathFacings.slice(0, 12),
        desiredFacing: tank.desiredFacing256,
      },
    };
  }, undefined);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU10 Basic_Path nearby zone', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps the convoy truck on the C++ same-zone Basic_Path route', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 274);
      const cpp274 = await wasmMiddleTurkeyTruck(handle.wasm);
      const ts274 = await tsMiddleTurkeyTruck(handle.ts);

      expect(ts274).toEqual({
        ...cpp274,
        mission: 'MOVE',
      });
      expect(cpp274.mission).toBe(2);

      await stepBoth(handle, 12);
      const cpp286 = await wasmMiddleTurkeyTruck(handle.wasm);
      const ts286 = await tsMiddleTurkeyTruck(handle.ts);

      expect(ts286).toEqual({
        ...cpp286,
        mission: 'MOVE',
      });
      expect(cpp286.mission).toBe(2);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('uses the C++ Find_Path route when the tail convoy truck repaths', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 442);
      const cpp = await wasmTailTurkeyTruckPath(handle.wasm);
      const ts = await tsTailTurkeyTruckPath(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.truck).toEqual({
        cx: cpp.truck.cx,
        cy: cpp.truck.cy,
        lx: cpp.truck.lx,
        ly: cpp.truck.ly,
        mission: 'MOVE',
        missionTimer: cpp.truck.missionTimer,
        isDriving: cpp.truck.isDriving,
        path: cpp.truck.path,
        desiredFacing: cpp.truck.desiredFacing,
      });
    }, { wasmSeed: 0 });
  }, 180_000);

  it('does not let a stale clobbered track owner clear a newer head reservation', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 500);
      const cpp = await wasmTailTurkeyTruckPath(handle.wasm);
      const ts = await tsTailTurkeyTruckPath(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.truck.path).toEqual([7, 7, 6, 6]);
      expect(ts.truck).toEqual({
        cx: cpp.truck.cx,
        cy: cpp.truck.cy,
        lx: cpp.truck.lx,
        ly: cpp.truck.ly,
        mission: 'MOVE',
        missionTimer: cpp.truck.missionTimer,
        isDriving: cpp.truck.isDriving,
        path: cpp.truck.path,
        desiredFacing: cpp.truck.desiredFacing,
      });
    }, { wasmSeed: 0 });
  }, 180_000);

  it('keeps active curve head reservations in the C++ Nearby_Location scan', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 484);
      const cpp = await wasmConvoyTankBasicPath(handle.wasm);
      const ts = await tsConvoyTankBasicPath(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.tank).toEqual({
        cx: cpp.tank.cx,
        cy: cpp.tank.cy,
        lx: cpp.tank.lx,
        ly: cpp.tank.ly,
        nav: cpp.tank.nav,
        path: cpp.tank.path,
        desiredFacing: cpp.tank.desiredFacing,
      });
    }, { wasmSeed: 0 });
  }, 180_000);

  it('stops the lead convoy truck when a close moving ally blocks the object NavCom', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 548);
      const cpp = await wasmLeadTurkeyTruckArrival(handle.wasm);
      const ts = await tsLeadTurkeyTruckArrival(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.truck).toEqual({
        cx: cpp.truck.cx,
        cy: cpp.truck.cy,
        lx: cpp.truck.lx,
        ly: cpp.truck.ly,
        mission: 'GUARD',
        missionTimer: cpp.truck.missionTimer,
        missionQueue: null,
        isDriving: cpp.truck.isDriving,
        nav: cpp.truck.nav,
        headToLX: cpp.truck.headToLX,
        headToLY: cpp.truck.headToLY,
        path: cpp.truck.path,
      });
      expect(cpp.truck.mission).toBe(5);
      expect(cpp.truck.nav).toBeNull();
    }, { wasmSeed: 0 });
  }, 180_000);

  it('uses C++ clear-to-move semantics when Basic_Path retargets a blocked team NavCom', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 678);
      const cpp = await wasmLeadTurkeyTruckArrival(handle.wasm);
      const ts = await tsLeadTurkeyTruckArrival(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.truck).toEqual({
        cx: cpp.truck.cx,
        cy: cpp.truck.cy,
        lx: cpp.truck.lx,
        ly: cpp.truck.ly,
        mission: 'MOVE',
        missionTimer: cpp.truck.missionTimer,
        missionQueue: null,
        isDriving: cpp.truck.isDriving,
        nav: cpp.truck.nav,
        headToLX: cpp.truck.headToLX,
        headToLY: cpp.truck.headToLY,
        path: cpp.truck.path,
      });
      expect(cpp.truck.mission).toBe(2);
      expect(cpp.truck.path).toEqual([2, 2]);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('keeps the middle convoy truck stopped behind the tail truck active head reservation', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 546);
      const cpp = await wasmMiddleTruckBlockedByTailReservation(handle.wasm);
      const ts = await tsMiddleTruckBlockedByTailReservation(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.truck).toEqual({
        cx: cpp.truck.cx,
        cy: cpp.truck.cy,
        lx: cpp.truck.lx,
        ly: cpp.truck.ly,
        mission: 'MOVE',
        missionTimer: cpp.truck.missionTimer,
        isDriving: cpp.truck.isDriving,
        nav: cpp.truck.nav,
        headToLX: cpp.truck.headToLX,
        headToLY: cpp.truck.headToLY,
        path: cpp.truck.path,
      });
      expect(cpp.truck.mission).toBe(2);
      expect(cpp.truck.isDriving).toBe(false);
      expect(cpp.truck.path).toEqual([6, 6]);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('consumes the final DriveClass path facing when the middle convoy truck reaches NavCom', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 710);
      const cpp = await wasmMiddleTruckBlockedByTailReservation(handle.wasm);
      const ts = await tsMiddleTruckBlockedByTailReservation(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.truck).toEqual({
        cx: cpp.truck.cx,
        cy: cpp.truck.cy,
        lx: cpp.truck.lx,
        ly: cpp.truck.ly,
        mission: 'GUARD',
        missionTimer: cpp.truck.missionTimer,
        isDriving: cpp.truck.isDriving,
        nav: cpp.truck.nav,
        headToLX: cpp.truck.headToLX,
        headToLY: cpp.truck.headToLY,
        path: cpp.truck.path,
      });
      expect(cpp.truck.mission).toBe(5);
      expect(cpp.truck.isDriving).toBe(false);
      expect(cpp.truck.path).toEqual([]);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('uses the current C++ frame for no-threat vehicle scatter Nearby_Location', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 644);
      const cpp = await wasmFourthBadGuyTankRepath(handle.wasm);
      const ts = await tsFourthBadGuyTankRepath(handle.ts);

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
      expect(cpp.tank.mission).toBe(5);
      expect(cpp.tank.nav).toEqual({ lx: 26248, ly: 15752 });
      expect(cpp.tank.path).toEqual([6]);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('clears a close-enough queued team MOVE after the rear tank hits the C++ immediate-cell block', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 669);
      const cpp = await wasmRearBadGuyTankTeamMove(handle.wasm);
      const ts = await tsRearBadGuyTankTeamMove(handle.ts);

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
      expect(cpp.tank.mission).toBe(5);
      expect(cpp.tank.nav).toBeNull();
      expect(cpp.tank.path).toEqual([]);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('does not scatter a friendly blocker when the requester aborts close enough to NavCom', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 661);
      const cpp = await wasmBlockedBadGuyTankScatter(handle.wasm);
      const ts = await tsBlockedBadGuyTankScatter(handle.ts);

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
        desiredFacing: cpp.tank.desiredFacing,
      });
      expect(cpp.tank.mission).toBe(5);
      expect(cpp.tank.nav).toBeNull();
      expect(cpp.tank.path).toEqual([]);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('uses the C++ Nearby_Location path goal for the rear BadGuy tank blocked NavCom', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 746);
      const cpp = await wasmRearBadGuyTankTeamMove(handle.wasm);
      const ts = await tsRearBadGuyTankTeamMove(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.tank).toEqual({
        cx: cpp.tank.cx,
        cy: cpp.tank.cy,
        lx: cpp.tank.lx,
        ly: cpp.tank.ly,
        mission: 'MOVE',
        missionTimer: cpp.tank.missionTimer,
        isDriving: cpp.tank.isDriving,
        nav: cpp.tank.nav,
        path: cpp.tank.path,
      });
      expect(cpp.tank.mission).toBe(2);
      expect(cpp.tank.path).toEqual([3]);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('rejects off-radar Basic_Path detours before threshold escalation', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 569);
      const cpp = await wasmFourthBadGuyTankRepath(handle.wasm);
      const ts = await tsFourthBadGuyTankRepath(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.tank).toEqual({
        cx: cpp.tank.cx,
        cy: cpp.tank.cy,
        lx: cpp.tank.lx,
        ly: cpp.tank.ly,
        mission: 'MOVE',
        missionTimer: cpp.tank.missionTimer,
        isDriving: cpp.tank.isDriving,
        nav: cpp.tank.nav,
        path: cpp.tank.path,
      });
      expect(cpp.tank.mission).toBe(2);
      expect(cpp.tank.path).toEqual([2, 2, 2]);
    }, { wasmSeed: 0 });
  }, 180_000);

});
