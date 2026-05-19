/**
 * Dual-runtime check for LST retreat movement while the door is open.
 *
 * SCU14EA's Greek LST unloads cargo at the eastern shore, then auto-retreats
 * south. C++ gates VesselClass's post-DriveClass Commence call while the LST
 * door is open, but DriveClass::AI itself keeps consuming track movement. TS
 * must not treat an open door as a movement-cycle stop, or the LST lingers
 * until the next retreat timer refresh instead of leaving the map at tick 890.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AgentState, AgentUnit } from '../engine/agentHarness.js';
import type { RAEntity, RAGameState } from '../oracle/WasmAdapter.js';
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

const WASM_MISSION_RETREAT = 4;

type EvalPage = {
  evaluate<T>(fn: () => T): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

function findWasmEasternGreekLST(state: RAGameState): RAEntity | undefined {
  return [...state.units, ...state.enemies]
    .find(u => u.t === 'LST' && u.house === 'Greece' && u.cx >= 90);
}

function findTsEasternGreekLST(state: AgentState): AgentUnit | undefined {
  return [...state.units, ...state.enemies]
    .find(u => u.t === 'LST' && u.h === 'Greece' && u.cx >= 90);
}

function findWasmLateGreekArty(state: RAGameState) {
  const arty = [...state.units, ...state.enemies]
    .find(u =>
      u.t === 'ARTY' &&
      u.house === 'Greece' &&
      u.lx === 23680 &&
      u.ly === 20608 &&
      u.hp === 75);
  if (!arty) throw new Error('C++ SCU14EA late Greek ARTY missing');
  return {
    tick: state.tick,
    mission: arty.m,
    missionTimer: arty.mt,
    nav: { lx: arty.nlx, ly: arty.nly },
    path: [arty.p0, arty.p1, arty.p2, arty.p3, arty.p4, arty.p5]
      .filter((facing): facing is number => typeof facing === 'number' && facing >= 0),
  };
}

function findWasmVehicleFlagClearedGreekE1(state: RAGameState) {
  const infantry = [...state.units, ...state.enemies]
    .find(u => u.id === 852024 && u.t === 'E1' && u.house === 'Greece');
  if (!infantry) throw new Error('C++ SCU14EA Greek E1 852024 missing');
  return {
    tick: state.tick,
    mission: infantry.m,
    missionTimer: infantry.mt,
    nav: { lx: infantry.nlx, ly: infantry.nly },
    path: [infantry.p0, infantry.p1, infantry.p2, infantry.p3, infantry.p4, infantry.p5]
      .filter((facing): facing is number => typeof facing === 'number' && facing >= 0),
  };
}

async function stepBothOneTickAtATime(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<Awaited<ReturnType<typeof stepBoth>>> {
  let result: Awaited<ReturnType<typeof stepBoth>> | null = null;
  for (let i = 0; i < ticks; i++) {
    result = await stepBoth(handle, 1);
  }
  if (!result) throw new Error('No ticks stepped');
  return result;
}

async function tsMapExitedLSTLogicSlots(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    return (game.entities ?? [])
      .filter((entity: any) =>
        entity.type === 'LST' &&
        entity.alive === false &&
        entity.inLimbo !== true &&
        entity.logicIndexHint !== undefined)
      .map((entity: any) => ({
        id: entity.id,
        house: entity.house,
        logicIndexHint: entity.logicIndexHint,
        mission: entity.mission,
        cx: entity.cell?.cx,
        cy: entity.cell?.cy,
      }));
  }) as Promise<Array<{
    id: number;
    house: string;
    logicIndexHint: number;
    mission: string;
    cx: number;
    cy: number;
  }>>;
}

async function tsLateGreekArty(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const arty = (game.entities ?? []).find((entity: any) =>
      entity.type === 'ARTY' &&
      entity.house === 'Greece' &&
      entity.leptonX === 23680 &&
      entity.leptonY === 20608 &&
      entity.hp === 75);
    if (!arty) throw new Error('TS SCU14EA late Greek ARTY missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: arty.mission,
      missionTimer: arty.missionTimer,
      nav: arty.moveTarget ? { lx: arty.moveTarget.lx, ly: arty.moveTarget.ly } : null,
      path: (arty.drivePathFacings ?? [])
        .filter((facing: number) => facing >= 0)
        .slice(0, 6),
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    mission: string;
    missionTimer: number;
    nav: { lx: number; ly: number } | null;
    path: number[];
  }>;
}

async function tsVehicleFlagClearedGreekE1(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const infantry = (game.entities ?? []).find((entity: any) =>
      entity.id === 225 &&
      entity.type === 'E1' &&
      entity.house === 'Greece');
    if (!infantry) throw new Error('TS SCU14EA Greek E1 225 missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: infantry.mission,
      missionTimer: infantry.missionTimer,
      nav: infantry.moveTarget ? { lx: infantry.moveTarget.lx, ly: infantry.moveTarget.ly } : null,
      path: (infantry.drivePathFacings ?? [])
        .filter((facing: number) => facing >= 0)
        .slice(0, 6),
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    mission: string;
    missionTimer: number;
    nav: { lx: number; ly: number } | null;
    path: number[];
  }>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU14 LST retreat with open door', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps the retreating Greek LST driving and deletes it at the C++ edge tick', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBoth(handle, 790);
      const cppDriving = findWasmEasternGreekLST(result.wasm.state);
      const tsDriving = findTsEasternGreekLST(result.ts.state);

      expect(cppDriving, 'C++ eastern Greek LST at tick 790').toMatchObject({
        t: 'LST',
        house: 'Greece',
        cx: 98,
        cy: 101,
        m: WASM_MISSION_RETREAT,
        mt: 62,
        drv: true,
      });
      expect(tsDriving, 'TS eastern Greek LST at tick 790').toMatchObject({
        t: 'LST',
        h: 'Greece',
        cx: cppDriving!.cx,
        cy: cppDriving!.cy,
        m: 'RETREAT',
        mt: cppDriving!.mt,
        drv: cppDriving!.drv,
      });
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      result = await stepBoth(handle, 100);
      expect(findWasmEasternGreekLST(result.wasm.state), 'C++ deletes eastern Greek LST at tick 890')
        .toBeUndefined();
      expect(findTsEasternGreekLST(result.ts.state), 'TS deletes eastern Greek LST at tick 890')
        .toBeUndefined();
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('removes map-exited LSTs and preserves late approach fallbacks', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBothOneTickAtATime(handle, 1586);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
      expect(await tsMapExitedLSTLogicSlots(handle.ts)).toEqual([]);

      const cppArty = findWasmLateGreekArty(result.wasm.state);
      const tsArty = await tsLateGreekArty(handle.ts);
      expect(cppArty.nav).toEqual({ lx: 21640, ly: 21896 });
      expect(cppArty.path).toEqual([5, 6, 5, 5, 5]);
      expect(tsArty).toEqual({
        tick: cppArty.tick,
        rngState: result.wasm.state.rngState! >>> 0,
        mission: 'ATTACK',
        missionTimer: cppArty.missionTimer,
        nav: cppArty.nav,
        path: cppArty.path,
      });

      result = await stepBothOneTickAtATime(handle, 43);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      const cppInfantry = findWasmVehicleFlagClearedGreekE1(result.wasm.state);
      const tsInfantry = await tsVehicleFlagClearedGreekE1(handle.ts);
      expect(cppInfantry.nav).toEqual({ lx: 22408, ly: 21384 });
      expect(cppInfantry.path).toEqual([4, 4, 4, 3, 4]);
      expect(tsInfantry).toEqual({
        tick: cppInfantry.tick,
        rngState: result.wasm.state.rngState! >>> 0,
        mission: 'HUNT',
        missionTimer: cppInfantry.missionTimer,
        nav: cppInfantry.nav,
        path: cppInfantry.path,
      });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 360_000);
});
